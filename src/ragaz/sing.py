"""Sing the words: text-to-speech turned into singing on the composer's melody (proof of concept).

    uv run --extra voice python -m ragaz.sing timeline.json out.wav [--sa 110] [--tempo 96]

timeline.json: {"raga", "words": the verse, one line per line, "lang": "hin" | "eng",
                "notes": [{s, o, t, d}], "lyrics": [{t, syl, line, k}]}
with t and d in beats (the studio's arranged timeline) and each sung syllable's line and its index
in that line (the mukhda's return sings line 0 again).

How:
  1. speak   Meta's MMS TTS (facebook/mms-tts-hin or -eng, CC BY-NC 4.0) says each whole line,
             as speech: a word said alone comes out mangled (Whisper reads 9 in 10 characters
             wrong), the line said whole comes out clear (2 in 10). The model's own duration for
             every letter tells where each syllable sits in the speech.
  2. analyse the WORLD vocoder (pyworld) splits the speech into its spectral envelope (the vocal
             tract: what makes it "बुरा"), its aperiodicity (breath) and its pitch.
  3. re-sing each syllable is moved onto its note: its first consonants sung just before the beat
             (as singers do, so the vowel lands on it), at their natural length; only the middle of
             its vowel is stretched over the held note, by interpolating the envelope (not by
             repeating frames, which freezes the voice), and a hold stops after 1.5 s. The pitch
             follows the melody with the glides and wavers learned from real singers
             (render.expressive_cents). Syllables that follow each other in the line are
             synthesised as one stretch, so the speech's own transitions between them are kept.
Wordless notes (aakar) are left to the other voices.
"""

import argparse
import json
from functools import cache
from pathlib import Path
from types import SimpleNamespace

import numpy as np

FS = 16000  # the TTS model's rate; WORLD works at it too
FRAME_MS = 5.0
PRE_MAX = 0.09  # s: the most of a syllable's consonants sung ahead of its beat
HOLD_MAX = 1.5  # s: the longest a syllable is held


@cache
def tts(lang: str = "hin"):
    import os

    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
    from transformers import AutoTokenizer, VitsModel

    tok = AutoTokenizer.from_pretrained(f"facebook/mms-tts-{lang}")
    model = VitsModel.from_pretrained(f"facebook/mms-tts-{lang}").eval()
    return tok, model


@cache
def speak_line(line: str, lang: str = "hin") -> tuple[np.ndarray, list[str], np.ndarray]:
    """The line spoken, its letters as the model read them, and each letter's (start, end) sample."""
    import torch

    tok, model = tts(lang)
    ids = tok(line, return_tensors="pt").input_ids
    got = {}
    hook = model.duration_predictor.register_forward_hook(lambda m, i, o: got.__setitem__("log", o))
    torch.manual_seed(0)  # VITS samples its durations: fix them so a line always sounds the same
    with torch.no_grad():
        wav = model(input_ids=ids).waveform[0].numpy().astype(np.float64)
    hook.remove()
    frames = torch.ceil(torch.exp(got["log"]) / model.speaking_rate)[0, 0].numpy()
    edges = np.concatenate([[0], np.cumsum(frames)]) * len(wav) / frames.sum()
    tokens = tok.convert_ids_to_tokens(ids[0].tolist())
    # Blanks sit between the letters (add_blank): a letter owns half of the blank on either side.
    letters = tokens[1::2] if tok.add_blank else tokens
    pos = range(1, len(tokens), 2) if tok.add_blank else range(len(tokens))
    spans = np.array([((edges[p - 1] + edges[p]) / 2 if p else 0, (edges[p + 1] + edges[p + 2]) / 2 if p + 2 < len(edges) else edges[-1]) for p in pos])
    return wav / (np.abs(wav).max() + 1e-9) * 0.8, letters, spans


def syllable_spans(syls: list[str], letters: list[str], spans: np.ndarray) -> list[tuple[float, float]]:
    """Each syllable's (start, end) sample in the spoken line, by walking its letters through the
    model's (a letter the model dropped, like a nukta it lacks, is skipped)."""
    out, p = [], 0
    for syl in syls:
        hit = []
        for ch in syl.lower():
            for q in range(p, min(p + 4, len(letters))):
                if letters[q] == ch:
                    hit.append(q)
                    p = q + 1
                    break
        while p < len(letters) and letters[p] in " ,.'-":
            p += 1
        out.append((spans[hit[0]][0], spans[hit[-1]][1]) if hit else None)
    for i, x in enumerate(out):  # a syllable none of whose letters were found: between its neighbours
        if x is None:
            a = out[i - 1][1] if i and out[i - 1] else 0.0
            b = next((y[0] for y in out[i + 1 :] if y), a + 0.15 * FS)
            out[i] = (a, max(b, a + 1))
    return out


def warp(n_out: int, src: tuple[int, int], voiced: np.ndarray, pre: int) -> np.ndarray:
    """Source frame (fractional) for each of a syllable's n_out output frames: pre frames of
    consonant, then the vowel with its middle stretched (or everything squeezed evenly if short)."""
    a, b = src
    v = np.where(voiced[a:b])[0]
    n_src = b - a
    if len(v) < 4 or n_out <= n_src:
        return a + np.linspace(0, n_src - 1, n_out) if n_out > 1 else np.array([a], float)
    v0, v1 = a + v[0], a + v[-1]
    lo, hi = v0 + 0.3 * (v1 - v0), v0 + 0.7 * (v1 - v0)
    tail = b - 1 - hi
    x = [0, pre, pre + (lo - v0), n_out - 1 - tail, n_out - 1]
    if not all(np.diff(x) > 0):
        return a + np.linspace(0, n_src - 1, n_out)
    return np.interp(np.arange(n_out), x, [a, v0, lo, hi, b - 1])


@cache
def analyse(line: str, lang: str):
    import pyworld as pw

    wav, letters, spans = speak_line(line, lang)
    f0, t = pw.harvest(wav, FS, frame_period=FRAME_MS, f0_floor=70, f0_ceil=400)
    sp = pw.cheaptrick(wav, f0, t, FS)
    ap = pw.d4c(wav, f0, t, FS)
    return letters, spans, f0, np.log(sp + 1e-12), ap


def sing(timeline: dict, sa: float, tempo: float) -> np.ndarray:
    import pyworld as pw

    from ragaz.render import SR as RSR
    from ragaz.render import expressive_cents

    beat, frame = 60 / tempo, FRAME_MS / 1000
    lang = timeline.get("lang", "hin")
    lines = [ln.strip() for ln in timeline["words"].splitlines() if ln.strip()]
    notes = [SimpleNamespace(swara=n["s"], octave=n["o"], start=n["t"], duration=n["d"]) for n in timeline["notes"]]
    end_beats = max(n.start + n.duration for n in notes)
    total = end_beats * beat + 1.0
    cents = expressive_cents(SimpleNamespace(notes=notes, beats=end_beats), beat, int(total * RSR), timeline["raga"], json.loads(Path("data/expression.json").read_text()))
    hz_at = lambda t: sa * 2 ** (np.interp(t * RSR, np.arange(len(cents)), cents) / 1200)  # noqa: E731

    lyr = sorted(timeline["lyrics"], key=lambda x: x["t"])
    by_line: dict[int, dict[int, str]] = {}
    for x in lyr:
        by_line.setdefault(x["line"], {})[x["k"]] = x["syl"]
    # Each sung syllable's span (frames) in its line's speech.
    src = []
    for x in lyr:
        letters, spans, *_ = analyse(lines[x["line"]], lang)
        k_syl = by_line[x["line"]]
        ordered = [k_syl[k] for k in sorted(k_syl)]
        span = syllable_spans(ordered, letters, spans)[sorted(k_syl).index(x["k"])]
        src.append((int(span[0] / FS / frame), max(int(span[0] / FS / frame) + 1, int(np.ceil(span[1] / FS / frame)))))

    # Output windows: consonants ahead of the beat, then held until the next syllable or the melody's
    # silence, at most HOLD_MAX.
    def sounding_end(t: float, nxt: float) -> float:
        last = max((n.start + n.duration for n in notes if n.start < nxt and n.start + n.duration > t), default=t + 0.5)
        return min(nxt, last)
    starts, stops = [], []
    for i, x in enumerate(lyr):
        f0 = analyse(lines[x["line"]], lang)[2]
        a, b = src[i]
        v = np.where(f0[a:b] > 0)[0]
        pre = min(v[0] if len(v) else 0, int(PRE_MAX / frame))
        starts.append(x["t"] * beat - pre * frame)
        nxt = lyr[i + 1]["t"] if i + 1 < len(lyr) else end_beats
        stops.append(min(sounding_end(x["t"], nxt) * beat, x["t"] * beat + HOLD_MAX))
    for i in range(len(lyr) - 1):
        stops[i] = min(stops[i], starts[i + 1])

    out = np.zeros(int(total * FS) + FS)
    i = 0
    while i < len(lyr):
        # A run: the next syllables of the same line, sung back to back.
        j = i
        while j + 1 < len(lyr) and lyr[j + 1]["line"] == lyr[i]["line"] and lyr[j + 1]["k"] == lyr[j]["k"] + 1 and starts[j + 1] - stops[j] < frame:
            j += 1
        _, _, f0, logsp, ap = analyse(lines[lyr[i]["line"]], lang)
        idx = []
        for k in range(i, j + 1):
            n_out = max(1, int(round((stops[k] - starts[k]) / frame)))
            pre = int(round((lyr[k]["t"] * beat - starts[k]) / frame))
            idx.append(warp(n_out, src[k], f0 > 0, pre))
        idx = np.concatenate(idx).clip(0, len(f0) - 1)
        lo = np.floor(idx).astype(int)
        hi = np.minimum(lo + 1, len(f0) - 1)
        w = (idx - lo)[:, None]
        sp = np.exp((1 - w) * logsp[lo] + w * logsp[hi])
        ap_ = (1 - w) * ap[lo] + w * ap[hi]
        times = starts[i] + np.arange(len(idx)) * frame
        voiced = f0[np.round(idx).astype(int)] > 0
        y = pw.synthesize(np.where(voiced, hz_at(times), 0.0), np.ascontiguousarray(sp), np.ascontiguousarray(ap_), FS, frame_period=FRAME_MS)
        fade = min(len(y) // 4, int(0.015 * FS))
        if fade:
            y[:fade] *= np.linspace(0, 1, fade)
            y[-fade:] *= np.linspace(1, 0, fade)
        at = max(0, int(starts[i] * FS))
        out[at : at + len(y)] += y[: len(out) - at]
        i = j + 1
    return out / (np.abs(out).max() + 1e-9) * 0.9


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("timeline")
    ap.add_argument("out")
    ap.add_argument("--sa", type=float, default=110.0)
    ap.add_argument("--tempo", type=float, default=96.0)
    a = ap.parse_args()
    from scipy.io import wavfile

    y = sing(json.loads(Path(a.timeline).read_text()), a.sa, a.tempo)
    wavfile.write(a.out, FS, (y * 32767).astype(np.int16))
    print(f"wrote {a.out}: {len(y) / FS:.1f} s")


if __name__ == "__main__":
    main()


def aakar(notes: list[dict], raga: str, sa: float, tempo: float, name: str = "hvocal") -> np.ndarray:
    """The wordless parts sung on "aa" by a learned DDSP voice (default: the Hindustani one), at FS."""
    import torch

    from ragaz.ddsp import HOP, bowed_loudness, load_voice, loudness_reference
    from ragaz.ddsp import SR as DSR
    from ragaz.render import SR as RSR
    from ragaz.render import expressive_cents

    beat = 60 / tempo
    ns = [SimpleNamespace(swara=n["s"], octave=n["o"], start=n["t"], duration=n["d"]) for n in notes]
    if not ns:
        return np.zeros(1)
    end = max(n.start + n.duration for n in ns)
    seconds = end * beat + 1.0
    frames = int(seconds * DSR / HOP)
    comp = SimpleNamespace(notes=ns, beats=end)
    cents = expressive_cents(comp, beat, int(seconds * RSR), raga, json.loads(Path("data/expression.json").read_text()))
    f0 = sa * 2 ** (cents[(np.arange(frames) * HOP * RSR / DSR).astype(int).clip(0, len(cents) - 1)] / 1200)
    level, spread = loudness_reference(name)
    ld = bowed_loudness(comp, beat, frames, level, spread, attack=0.13)
    with torch.no_grad():
        y = load_voice(name=name)(torch.from_numpy(f0).float()[None], torch.from_numpy(ld).float()[None])[0].numpy()
    assert DSR == FS
    return y / (np.abs(y).max() + 1e-9) * 0.8


def room(x: np.ndarray, fs: int, seconds: float = 1.8, wet: float = 0.22, seed: int = 3) -> np.ndarray:
    """A plain vocal reverb: decaying filtered noise, convolved."""
    from scipy.signal import fftconvolve, lfilter

    n = int(seconds * fs)
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-4.5 * np.arange(n) / n)
    ir = lfilter([0.25], [1, -0.75], ir)
    ir /= np.sqrt((ir ** 2).sum())
    return (1 - wet) * x + wet * fftconvolve(x, ir)[: len(x)]


def mix_track(bed_wav: str, timeline: dict, sa: float, tempo: float, out: str, t0: float = 0.05) -> None:
    """The studio's bed (rendered with its own voices off) + the sung words (an octave below the
    bed's Sa: both TTS voices are low) + the wordless parts on the DDSP voice, aligned to the
    bed's start (t0). Mixed for the words: a slow leveller on the voice, ~3 dB over the bed, the
    bed ducked in the voice's band while a word sounds, one clean gain at the end; nothing clipped."""
    from scipy.io import wavfile
    from scipy.signal import butter, resample_poly, sosfilt

    sr, bed = wavfile.read(bed_wav)
    bed = bed.astype(np.float64) / 32768
    words = sing(timeline, sa / 2, tempo)
    spans = [(x["t"], x["t"] + 1) for x in timeline["lyrics"]]
    wordless = [n for n in timeline["notes"] if not any(a - 0.01 <= n["t"] < b for a, b in spans)]
    aa = aakar(wordless, timeline["raga"], sa, tempo) if wordless else np.zeros(1)
    n = max(len(words), len(aa))
    vox = np.zeros(n)
    vox[: len(words)] += words
    vox[: len(aa)] += 0.45 * aa
    vox = sosfilt(butter(2, 80, "highpass", fs=FS, output="sos"), vox)
    # Leveller: a 300 ms loudness, pulled at most 6 dB either way toward the voice's median.
    env = np.sqrt(np.convolve(vox ** 2, np.ones(int(0.3 * FS)) / (0.3 * FS), mode="same"))
    target = np.median(env[env > 0.02]) if np.any(env > 0.02) else 0.1
    vox *= np.where(env > 0.01, np.clip(target / (env + 1e-9), 0.5, 2.0), 1.0)
    vox = room(vox, FS, wet=0.16)
    vox = resample_poly(vox, sr, FS)
    word_env = np.abs(resample_poly(words, sr, FS))
    word_env = np.convolve(word_env, np.ones(int(0.12 * sr)) / (0.12 * sr), mode="same")
    rms = lambda x: np.sqrt(np.mean(x[np.abs(x) > 1e-3] ** 2)) if np.any(np.abs(x) > 1e-3) else 1.0  # noqa: E731
    vox *= 1.4 * rms(bed.mean(1)) / rms(vox)
    a = int(t0 * sr)
    total = max(len(bed), a + len(vox))
    # Duck the bed where a word sounds: -6 dB in the voice's band (300 Hz-5 kHz), -1.5 dB below it.
    on = np.zeros(total)
    on[a : a + len(word_env)] = np.clip(word_env / (word_env.max() + 1e-9) * 4, 0, 1)
    full = np.zeros((total, 2))
    full[: len(bed)] = bed
    band = sosfilt(butter(2, [300, 5000], "bandpass", fs=sr, output="sos"), full, axis=0)
    mixed = full - band * (0.5 * on)[:, None] - (full - band) * (0.16 * on)[:, None]
    mixed[a : a + len(vox)] += vox[:, None]
    mixed *= 0.94 / max(1e-9, np.abs(mixed).max())
    wavfile.write(out, sr, (mixed * 32767).astype(np.int16))
