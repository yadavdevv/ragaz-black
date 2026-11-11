"""A DDSP voice: learn a real instrument's timbre from recordings (Engel et al., ICLR 2020).

    uv run python -m ragaz.ddsp prepare [violin|vocal]         # audio → (f0, loudness, audio) segments
    uv run python -m ragaz.ddsp train [steps] [violin|vocal]   # fit the decoder (PyTorch, MPS)

The network never generates raw audio. It maps (pitch, loudness) per frame to the
controls of classic synthesizers: the amplitude of each harmonic, and the spectrum
of a noise component (bow / breath). A harmonic oscillator bank, filtered noise and
a learned reverb do the actual synthesis. Because pitch is an *input*, every shruti
and glide the composer and expression model ask for comes out exactly.

Training data (Saraga Carnatic multitrack, Zenodo 10.5281/zenodo.4301737, CC BY-NC-SA 4.0,
research/non-commercial):
  violin  10 violin stems from 10 concerts
  vocal   12 vocal stems from 12 women singers (one each), separately miked
"""

import json
import math
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

SR = 16_000
HOP = 64  # 250 frames per second
SEG_S = 4.0
N_HARMONICS = 64
N_NOISE = 65
DATA = Path("data/voice")  # violin (the first voice); other instruments get data/voice-<name>


def data_dir(name: str = "violin") -> Path:
    return DATA if name == "violin" else Path(f"data/voice-{name}")


# ------------------------------------------------------------------ prepare


def load_audio(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def a_weighting(freqs: np.ndarray) -> np.ndarray:
    f2 = freqs**2
    ra = (12194**2 * f2**2) / ((f2 + 20.6**2) * np.sqrt((f2 + 107.7**2) * (f2 + 737.9**2)) * (f2 + 12194**2) + 1e-12)
    return 20 * np.log10(ra + 1e-12) + 2.0


def loudness(audio: np.ndarray, n_fft: int = 1024) -> np.ndarray:
    """A-weighted loudness in dB, one value per HOP."""
    pad = np.pad(audio, (n_fft // 2, n_fft // 2))
    frames = np.lib.stride_tricks.sliding_window_view(pad, n_fft)[::HOP][: len(audio) // HOP]
    spec = np.abs(np.fft.rfft(frames * np.hanning(n_fft), axis=-1))
    weight = a_weighting(np.fft.rfftfreq(n_fft, 1 / SR))
    power_db = 20 * np.log10(spec + 1e-7) + weight
    return 10 * np.log10(np.mean(10 ** (power_db / 10), axis=-1) + 1e-10)


def pitch(audio: np.ndarray, device: str) -> tuple[np.ndarray, np.ndarray]:
    import torch
    import torchcrepe

    x = torch.from_numpy(audio)[None].to(device)
    f0, periodicity = torchcrepe.predict(
        x, SR, HOP, fmin=80, fmax=1400, model="tiny", batch_size=1024, device=device, return_periodicity=True, decoder=torchcrepe.decode.viterbi
    )
    n = len(audio) // HOP
    return f0[0, :n].cpu().numpy(), periodicity[0, :n].cpu().numpy()


def prepare(src: Path, minutes_per_file: float = 6.0, min_voiced: float = 0.6, name: str = "violin") -> None:
    import torch

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    out = data_dir(name)
    out.mkdir(parents=True, exist_ok=True)
    seg_frames = int(SEG_S * SR / HOP)
    f0s, louds, audios = [], [], []
    for path in sorted([*src.glob("*.mp3"), *src.glob("*.wav")]):
        audio = load_audio(path)
        # Keep the most active stretch: a violin stem has long silences between phrases.
        keep = int(minutes_per_file * 60 * SR)
        if len(audio) > keep:
            energy = np.convolve(audio**2, np.ones(SR) / SR, mode="valid")[::SR]
            start = int(np.argmax(np.convolve(energy, np.ones(int(keep / SR)), mode="valid"))) * SR
            audio = audio[start : start + keep]
        audio = audio / (np.max(np.abs(audio)) + 1e-9) * 0.9
        f0, per = pitch(audio, device)
        ld = loudness(audio)
        kept = 0
        for s in range(0, len(f0) - seg_frames, seg_frames):
            voiced = (per[s : s + seg_frames] > 0.5).mean()
            if voiced < min_voiced:
                continue
            f0s.append(f0[s : s + seg_frames])
            louds.append(ld[s : s + seg_frames])
            audios.append(audio[s * HOP : (s + seg_frames) * HOP])
            kept += 1
        print(f"{path.name[:50]:<50} {len(audio) / SR / 60:4.1f} min → {kept} segments", flush=True)
    np.savez_compressed(out / "segments.npz", f0=np.stack(f0s), loudness=np.stack(louds), audio=np.stack(audios))
    print(f"{len(f0s)} segments × {SEG_S:.0f} s = {len(f0s) * SEG_S / 60:.1f} min → {out / 'segments.npz'}")


# -------------------------------------------------------------------- model


def build_model():
    import torch
    from torch import nn

    def mlp(i: int, h: int) -> nn.Sequential:
        return nn.Sequential(nn.Linear(i, h), nn.LayerNorm(h), nn.LeakyReLU(), nn.Linear(h, h), nn.LayerNorm(h), nn.LeakyReLU())

    class Decoder(nn.Module):
        def __init__(self, hidden: int = 512):
            super().__init__()
            self.f0_mlp, self.ld_mlp = mlp(1, hidden), mlp(1, hidden)
            self.gru = nn.GRU(2 * hidden, hidden, batch_first=True)
            self.out_mlp = mlp(3 * hidden, hidden)
            self.harm = nn.Linear(hidden, N_HARMONICS + 1)
            self.noise = nn.Linear(hidden, N_NOISE)
            self.reverb = nn.Parameter(torch.randn(SR) * 1e-3)  # 1 s learned room
            self.reverb_decay = nn.Parameter(torch.tensor(3.0))
            self.reverb_wet = nn.Parameter(torch.tensor(-2.0))

        def forward(self, f0: "torch.Tensor", ld: "torch.Tensor") -> "torch.Tensor":
            # f0 in Hz, ld in dB, both (B, frames).
            f0_in = (torch.log2(f0.clamp(min=40) / 440)[..., None] + 2) / 4
            ld_in = ((ld + 80) / 80)[..., None]
            a, b = self.f0_mlp(f0_in), self.ld_mlp(ld_in)
            h, _ = self.gru(torch.cat([a, b], -1))
            h = self.out_mlp(torch.cat([h, a, b], -1))
            harm = self.harm(h)
            amp = 2 * torch.sigmoid(harm[..., :1]) ** math.log(10) + 1e-7
            dist = torch.softmax(harm[..., 1:], -1)
            noise_mag = 2 * torch.sigmoid(self.noise(h) - 5) ** math.log(10) + 1e-7
            return self.synth(f0, amp, dist, noise_mag)

        def synth(self, f0, amp, dist, noise_mag):
            B, T = f0.shape
            n = T * HOP
            k = torch.arange(1, N_HARMONICS + 1, device=f0.device)
            dist = dist * (f0[..., None] * k < SR / 2)  # no harmonics above Nyquist (aliasing)
            dist = dist / (dist.sum(-1, keepdim=True) + 1e-7)
            up = lambda x: torch.nn.functional.interpolate(x.transpose(1, 2), size=n, mode="linear", align_corners=False).transpose(1, 2)  # noqa: E731
            f0_a = up(f0[..., None])
            phase = 2 * math.pi * torch.cumsum(f0_a / SR, dim=1)
            harmonic = (torch.sin(phase * k) * up(dist * amp)).sum(-1)
            # Filtered noise: frequency-sampled FIR per frame, applied by overlap-free frame convolution.
            ir = torch.fft.irfft(noise_mag.to(torch.complex64), n=2 * (N_NOISE - 1))
            ir = torch.roll(ir, N_NOISE - 1, -1) * torch.hann_window(ir.shape[-1], device=f0.device)
            white = (torch.rand(B, T, HOP, device=f0.device) * 2 - 1)
            frames = torch.fft.irfft(
                torch.fft.rfft(white, n=HOP + ir.shape[-1]) * torch.fft.rfft(ir, n=HOP + ir.shape[-1]), n=HOP + ir.shape[-1]
            )[..., :HOP]
            noise = frames.reshape(B, n)
            dry = harmonic + noise
            t = torch.arange(SR, device=f0.device) / SR
            ir_rev = self.reverb * torch.exp(-torch.nn.functional.softplus(self.reverb_decay) * 4 * t)
            ir_rev = torch.cat([torch.ones(1, device=f0.device), ir_rev[1:] * torch.sigmoid(self.reverb_wet)])
            size = n + SR
            wet = torch.fft.irfft(torch.fft.rfft(dry, n=size) * torch.fft.rfft(ir_rev, n=size), n=size)[..., :n]
            return wet

    return Decoder()


def spectral_loss(pred, target, ffts=(2048, 1024, 512, 256, 128, 64)):
    import torch

    loss = 0.0
    for n_fft in ffts:
        win = torch.hann_window(n_fft, device=pred.device)
        P = torch.stft(pred, n_fft, n_fft // 4, window=win, return_complex=True).abs()
        Y = torch.stft(target, n_fft, n_fft // 4, window=win, return_complex=True).abs()
        loss = loss + (P - Y).abs().mean() + (torch.log(P + 1e-7) - torch.log(Y + 1e-7)).abs().mean()
    return loss


# -------------------------------------------------------------------- train


def mel_loss(pred, target, n_fft: int = 1024, n_mels: int = 80):
    """Log-mel distance: timbre weighted the way the ear hears it (v2, with the spectral loss)."""
    import torch

    win = torch.hann_window(n_fft, device=pred.device)
    P = torch.stft(pred, n_fft, n_fft // 4, window=win, return_complex=True).abs() ** 2
    Y = torch.stft(target, n_fft, n_fft // 4, window=win, return_complex=True).abs() ** 2
    freqs = torch.linspace(0, SR / 2, P.shape[-2], device=pred.device)
    mel = lambda f: 2595 * torch.log10(1 + f / 700)  # noqa: E731
    edges = torch.linspace(mel(torch.tensor(30.0)), mel(torch.tensor(SR / 2.0)), n_mels + 2, device=pred.device)
    hz = 700 * (10 ** (edges / 2595) - 1)
    fb = torch.clamp(torch.minimum((freqs[None] - hz[:-2, None]) / (hz[1:-1, None] - hz[:-2, None]), (hz[2:, None] - freqs[None]) / (hz[2:, None] - hz[1:-1, None])), min=0)
    pm, ym = torch.einsum("mf,bft->bmt", fb, P), torch.einsum("mf,bft->bmt", fb, Y)
    return (torch.log(pm + 1e-6) - torch.log(ym + 1e-6)).abs().mean()


def train(steps: int = 6000, batch: int = 8, lr: float = 1e-3, out: Path = Path("runs/voice"), name: str = "violin", crop_s: float = 1.0, mel: float = 0.0) -> None:
    import torch

    from ragaz.watchdog import MemoryWatchdog

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    stamp = time.strftime("%Y%m%d-%H%M")
    run = out / f"{name}-{stamp}"
    run.mkdir(parents=True, exist_ok=True)
    MemoryWatchdog(max_gb=1000, min_free_gb=3.0, max_swap_growth_gb=4.0, marker=run / "KILLED_BY_WATCHDOG.txt").start()

    data = np.load(data_dir(name) / "segments.npz")
    f0, ld, audio = (torch.from_numpy(data[k]).float() for k in ("f0", "loudness", "audio"))
    n = len(f0)
    val = torch.arange(n) % 10 == 0  # every 10th segment held out
    print(f"{n} segments ({int(val.sum())} validation), device {device}")

    model = build_model().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.ExponentialLR(opt, gamma=0.98 ** (1 / 100))
    print(f"{sum(p.numel() for p in model.parameters()) / 1e6:.2f}M parameters")

    import trackio

    trackio.init(project="ragaz-voice", name=run.name, config={"steps": steps, "batch": batch, "lr": lr, "segments": n, "instrument": name}, embed=False)
    train_idx = torch.nonzero(~val).squeeze(1)
    val_idx = torch.nonzero(val).squeeze(1)[:16]
    # 1-second crops keep memory small; the GRU still sees continuous context within the crop.
    crop = int(crop_s * SR / HOP)  # v2: 3 s, so the GRU hears breath and swell across a phrase
    best = float("inf")
    for step in range(1, steps + 1):
        idx = train_idx[torch.randint(len(train_idx), (batch,))]
        start = int(torch.randint(f0.shape[1] - crop, (1,)))
        x_f0, x_ld = f0[idx, start : start + crop].to(device), ld[idx, start : start + crop].to(device)
        y = audio[idx, start * HOP : (start + crop) * HOP].to(device)
        pred = model(x_f0, x_ld)
        loss = spectral_loss(pred, y) + (mel * mel_loss(pred, y) if mel else 0.0)
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
        opt.step()
        sched.step()
        if step % 50 == 0:
            trackio.log({"train/loss": loss.item(), "train/lr": sched.get_last_lr()[0]}, step=step)
        if step % 500 == 0 or step == steps:
            model.eval()
            with torch.no_grad():
                vf0, vld, vy = f0[val_idx].to(device), ld[val_idx].to(device), audio[val_idx].to(device)
                vloss = spectral_loss(model(vf0, vld), vy).item()
                sample = model(vf0[:1], vld[:1])[0].cpu().numpy()
            model.train()
            from scipy.io import wavfile

            wav = run / f"val_step{step:05d}.wav"
            wavfile.write(wav, SR, np.concatenate([audio[val_idx[0]].numpy(), np.zeros(SR // 2, np.float32), sample / (np.abs(sample).max() + 1e-9) * 0.9]))
            trackio.log({"val/loss": vloss, "audio/val": trackio.Audio(str(wav), caption=f"step {step}: real, then resynthesised")}, step=step)
            if vloss < best:
                best = vloss
                torch.save(model.state_dict(), run / "best.pt")
            print(f"step {step:5d} | train {loss.item():.3f} | val {vloss:.3f} (best {best:.3f})", flush=True)
            if device == "mps":
                torch.mps.empty_cache()
    (run / "summary.json").write_text(json.dumps({"best_val_loss": best, "steps": steps, "segments": n}))
    trackio.finish()
    print(f"done: {run}")


if __name__ == "__main__":
    # prepare [name] [source dir] [minutes per file]; train [steps] [name] [crop seconds] [mel weight]
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "prepare":
        name = sys.argv[2] if len(sys.argv) > 2 else "violin"
        src = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(f"data/external/saraga/{name}")
        prepare(src, minutes_per_file=float(sys.argv[4]) if len(sys.argv) > 4 else 6.0, name=name, min_voiced=0.7 if len(sys.argv) > 3 else 0.6)
    elif cmd == "train":
        train(steps=int(sys.argv[2]) if len(sys.argv) > 2 else 6000, name=sys.argv[3] if len(sys.argv) > 3 else "violin",
              crop_s=float(sys.argv[4]) if len(sys.argv) > 4 else 1.0, mel=float(sys.argv[5]) if len(sys.argv) > 5 else 0.0)
    else:
        print(__doc__)


# ------------------------------------------------------------------- render


def load_voice(run: Path | None = None, name: str = "violin"):
    """The trained decoder (latest run of that instrument, best checkpoint by default), on CPU for rendering."""
    import torch

    run = run or max(Path("runs/voice").glob(f"{name}-*"), key=lambda p: p.stat().st_mtime)
    model = build_model()
    model.load_state_dict(torch.load(run / "best.pt", map_location="cpu"))
    model.eval()
    return model


def loudness_reference(name: str = "violin") -> tuple[float, float]:
    """Median and spread of voiced loudness in the training data, so rendered bowing sits in range."""
    data = np.load(data_dir(name) / "segments.npz")
    voiced = data["loudness"][data["f0"] > 0]
    return float(np.median(voiced)), float(np.percentile(voiced, 90) - np.percentile(voiced, 10))


def bowed_loudness(comp, beat: float, frames: int, level: float, spread: float, attack: float = 0.08, perf: dict | None = None) -> np.ndarray:
    """A loudness curve (dB per frame): each note swells in, sustains, and eases off; silence around.
    With a performance plan (render.performance): silent in the breaths, each phrase between them
    rising and falling a few dB, and every note a little louder or softer than the last."""
    fps = SR / HOP
    ld = np.full(frames, level - 60.0)
    rng = np.random.default_rng(5)
    for note in comp.notes:
        a, b = int(note.start * beat * fps), int((note.start + note.duration) * beat * fps)
        n = max(1, b - a)
        t = np.arange(n) / fps
        swell = np.minimum(1, t / attack)  # 80 ms bow attack
        ease = 1 - 0.25 * (t / max(t[-1], 1e-6))  # slight decay across the note
        touch = rng.normal(0, 1.2) if perf else 0.0
        ld[a:b] = level - 0.5 * spread + spread * 0.8 * swell * ease + touch
    if perf:
        # Phrase arcs: between breaths, a swell to the middle and an easing off (about ±3 dB).
        edges = [0] + [int(e * fps) for _, e in perf["breaths"]] + [frames]
        for a, b in zip(edges, edges[1:]):
            if b - a > 4:
                x = np.linspace(0, 1, b - a)
                ld[a:b] += 6 * np.sin(np.pi * x) ** 0.8 - 3
        for a, b in perf["breaths"]:
            ld[int(a * fps) : int(b * fps)] = level - 60.0
    k = max(1, int(0.02 * fps))
    return np.convolve(np.pad(ld, k, mode="edge"), np.ones(k) / k, mode="same")[k:-k]


def render_voice(text: str, raga_key: str, sa_hz: float, tempo: float, library: dict, model=None, name: str = "violin", perf: dict | None = None) -> np.ndarray:
    """Composer notation → expressive pitch (real glides/wavers) + bowed loudness → DDSP violin, at 16 kHz."""
    import torch

    from ragaz.notation import parse
    from ragaz.render import SR as RENDER_SR
    from ragaz.render import expressive_cents

    comp = parse(text)
    beat = 60 / tempo
    seconds = comp.beats * beat + 1.0
    frames = int(seconds * SR / HOP)
    n_render = int(seconds * RENDER_SR)
    cents = expressive_cents(comp, beat, n_render, raga_key, library, perf=perf)
    cents_frames = cents[(np.arange(frames) * HOP * RENDER_SR / SR).astype(int).clip(0, n_render - 1)]
    f0 = sa_hz * 2 ** (cents_frames / 1200)
    level, spread = loudness_reference(name)
    ld = bowed_loudness(comp, beat, frames, level, spread, attack=0.13 if name in ("vocal", "hvocal") else 0.08, perf=perf)  # a singer swells in more slowly than a bow
    model = model or load_voice(name=name)
    with torch.no_grad():
        audio = model(torch.from_numpy(f0).float()[None], torch.from_numpy(ld).float()[None])[0].numpy()
    return audio
