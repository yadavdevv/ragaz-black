"""Voice v2 data: Hindustani vocal concerts from Saraga 1.5, separated into vocals.

    uv run --extra voice python scripts/fetch_hindustani_vocal.py fetch      # the picked mixes (~0.6 GB)
    uv run --extra voice python scripts/fetch_hindustani_vocal.py separate   # Demucs htdemucs → vocals

Saraga 1.5 Hindustani (Zenodo 10.5281/zenodo.4301737, CC BY-NC-SA 4.0) has mixes only: no vocal
stems. Picked (data/external/saraga_hindustani/picks.json): the 16 recordings led by a voice
with no harmonium, sarangi or violin (voice, tabla, tanpura only), 313 minutes from 3 singers;
melodic accompaniment that follows the voice is what separation leaks. Separation by Demucs
(MIT), vocals vs the rest. Both steps skip what is already on disk (resumable), one file at a time.
The voice model trained on the result stays non-commercial (ShareAlike).
"""

import json
import subprocess
import sys
from pathlib import Path

from remotezip import RemoteZip

URL = "https://zenodo.org/records/4301737/files/saraga1.5_hindustani.zip?download=1"
ROOT = Path("data/external/saraga_hindustani")


def fetch() -> None:
    picks = json.loads((ROOT / "picks.json").read_text())
    (ROOT / "mix").mkdir(parents=True, exist_ok=True)
    with RemoteZip(URL) as z:
        for i, meta in enumerate(picks):
            mp3 = meta.replace(".json", ".mp3.mp3")
            out = ROOT / "mix" / f"{i:02d}_{Path(meta).parts[1][:60].replace(' ', '_')}.mp3"
            if out.exists():
                continue
            tmp = out.with_suffix(".part")
            tmp.write_bytes(z.read(mp3))
            tmp.rename(out)
            print(f"{out.name}: {out.stat().st_size / 1e6:.0f} MB", flush=True)


def separate() -> None:
    """Demucs htdemucs through its Python API (torchaudio's own save now needs torchcodec): decode
    with ffmpeg, separate on MPS in 7 s segments, keep the vocals, write a mono 16-bit WAV."""
    import numpy as np
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    from scipy.io import wavfile

    vocals = ROOT / "vocals"
    vocals.mkdir(parents=True, exist_ok=True)
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = get_model("htdemucs").to(device).eval()
    sr = model.samplerate
    for mix in sorted((ROOT / "mix").glob("*.mp3")):
        target = vocals / f"{mix.stem}.wav"
        if target.exists():
            continue
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(mix), "-ac", "2", "-ar", str(sr), "-f", "f32le", "-"], check=True, capture_output=True).stdout
        wav = torch.from_numpy(np.frombuffer(raw, dtype=np.float32).copy().reshape(-1, 2).T)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)
        with torch.no_grad():
            out = apply_model(model, wav[None], device=device, segment=7, split=True, overlap=0.25, progress=False)[0]
        voc = out[model.sources.index("vocals")] * (ref.std() + 1e-8) + ref.mean()
        mono = voc.mean(0).cpu().numpy()
        mono = mono / (np.abs(mono).max() + 1e-9) * 0.9
        tmp = target.with_suffix(".part.wav")
        wavfile.write(tmp, sr, (mono * 32767).astype(np.int16))
        tmp.rename(target)
        print(f"{mix.name}: {len(mono) / sr / 60:.1f} min of vocals", flush=True)
        if device == "mps":
            torch.mps.empty_cache()
    print(f"{len(list(vocals.glob('*.wav')))} vocal tracks in {vocals}")


if __name__ == "__main__":
    {"fetch": fetch, "separate": separate}[sys.argv[1]]()
