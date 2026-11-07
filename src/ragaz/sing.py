"""Sing the words: text-to-speech turned into singing on the composer's melody (proof of concept).

    uv run --extra voice python -m ragaz.sing timeline.json out.wav [--sa 220] [--tempo 96]

timeline.json: {"raga": key, "words": the verse, "notes": [{s, o, t, d}], "lyrics": [{t, syl}]}
with t and d in beats (the studio's arranged timeline: words in the sthayi, antara and mukhda).

How:
  1. speak   Meta's MMS Hindi TTS (facebook/mms-tts-hin, CC BY-NC 4.0) says each word on its own.
  2. analyse the WORLD vocoder (pyworld) splits the spoken word into its spectral envelope (the
             vocal tract: what makes it "बुरा"), its aperiodicity (breath) and its pitch.
  3. re-sing the speech's pitch and timing are thrown away. The word's consonants keep their natural
             length (capped), its voiced part is stretched over the notes the word is sung on, and
             the pitch follows the melody with the glides and wavers learned from real singers
             (render.expressive_cents). WORLD resynthesises it; words are cross-faded into place.
Wordless notes (aakar) are left to the other voices. Expect clear words with a slightly
"auto-tuned speech" timbre: a real singer it is not.
"""

import argparse
import json
from functools import cache
from pathlib import Path
from types import SimpleNamespace

import numpy as np

FS = 16000  # the TTS model's rate; WORLD works at it too
FRAME_MS = 5.0


@cache
def tts():
    import os

    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
    from transformers import AutoTokenizer, VitsModel

    tok = AutoTokenizer.from_pretrained("facebook/mms-tts-hin")
    model = VitsModel.from_pretrained("facebook/mms-tts-hin").eval()
    return tok, model


@cache
def speak(word: str) -> np.ndarray:
    import torch

    tok, model = tts()
    torch.manual_seed(0)  # VITS samples its durations: fix them so a word always sounds the same
    with torch.no_grad():
        wav = model(**tok(word, return_tensors="pt")).waveform[0].numpy().astype(np.float64)
    return wav / (np.abs(wav).max() + 1e-9) * 0.8


def group_words(sung: list[dict], words: str) -> list[tuple[str, list[dict]]]:
    """Group sung syllables into the verse's words, in order (the mukhda's return repeats them).
    Greedy: at each position take the verse word whose syllables come next; else a lone syllable."""
    from ragaz.lyrics import syllables

    vocab: dict[tuple[str, ...], str] = {}
    current: list[str] = []
    for s in syllables(words):
        if s.word_start and current:
            vocab[tuple(current)] = "".join(current)
            current = []
        current.append(s.text)
    if current:
        vocab[tuple(current)] = "".join(current)
    longest = max((len(k) for k in vocab), default=1)
    out, i = [], 0
    while i < len(sung):
        for n in range(min(longest, len(sung) - i), 0, -1):
            key = tuple(x["syl"] for x in sung[i : i + n])
            if key in vocab:
                out.append((vocab[key], sung[i : i + n]))
                i += n
                break
        else:
            out.append((sung[i]["syl"], sung[i : i + 1]))
            i += 1
    return out


def sing(timeline: dict, sa: float, tempo: float) -> np.ndarray:
    import pyworld as pw

    from ragaz.render import SR as RSR
    from ragaz.render import expressive_cents

    beat = 60 / tempo
    notes = [SimpleNamespace(swara=n["s"], octave=n["o"], start=n["t"], duration=n["d"]) for n in timeline["notes"]]
    end_beats = max(n.start + n.duration for n in notes)
    total = end_beats * beat + 1.0
    library = json.loads(Path("data/expression.json").read_text())
    cents = expressive_cents(SimpleNamespace(notes=notes, beats=end_beats), beat, int(total * RSR), timeline["raga"], library)
    hz_at = lambda t: sa * 2 ** (np.interp(t * RSR, np.arange(len(cents)), cents) / 1200)  # noqa: E731

    # When each syllable stops: at the next syllable, or where the melody falls silent.
    lyr = sorted(timeline["lyrics"], key=lambda x: x["t"])
    def stop(i: int) -> float:
        nxt = lyr[i + 1]["t"] if i + 1 < len(lyr) else end_beats
        sounding = [n for n in notes if n.start < nxt and n.start + n.duration > lyr[i]["t"]]
        last = max((n.start + n.duration for n in sounding), default=lyr[i]["t"] + 0.5)
        return min(nxt, last)
    for i, x in enumerate(lyr):
        x["end"] = stop(i)

    out = np.zeros(int(total * FS) + FS)
    for word, syls in group_words(lyr, timeline["words"]):
        t0, t1 = syls[0]["t"] * beat, syls[-1]["end"] * beat
        if t1 - t0 < 0.08:
            continue
        x = speak(word)
        f0, t = pw.harvest(x, FS, frame_period=FRAME_MS, f0_floor=70, f0_ceil=500)
        sp = pw.cheaptrick(x, f0, t, FS)
        ap = pw.d4c(x, f0, t, FS)
        voiced = np.where(f0 > 0)[0]
        if not len(voiced):
            continue
        head, tail = voiced[0], len(f0) - 1 - voiced[-1]
        # Consonants keep their natural length (capped); the voiced part fills the rest.
        head_n = min(head, int(0.12 * 1000 / FRAME_MS))
        tail_n = min(tail, int(0.10 * 1000 / FRAME_MS))
        frames = int((t1 - t0) * 1000 / FRAME_MS)
        mid_n = max(1, frames - head_n - tail_n)
        src = np.concatenate([
            np.linspace(head - head_n, head - 1, head_n) if head_n else np.array([]),
            np.linspace(voiced[0], voiced[-1], mid_n),
            np.linspace(voiced[-1] + 1, voiced[-1] + tail_n, tail_n) if tail_n else np.array([]),
        ]).clip(0, len(f0) - 1)
        idx = np.round(src).astype(int)
        times = t0 + np.arange(len(idx)) * FRAME_MS / 1000
        f0_new = np.where(f0[idx] > 0, hz_at(times), 0.0)
        y = pw.synthesize(f0_new, np.ascontiguousarray(sp[idx]), np.ascontiguousarray(ap[idx]), FS, frame_period=FRAME_MS)
        fade = min(len(y) // 4, int(0.02 * FS))
        if fade:
            y[:fade] *= np.linspace(0, 1, fade)
            y[-fade:] *= np.linspace(1, 0, fade)
        a = int(t0 * FS)
        out[a : a + len(y)] += y[: len(out) - a]
    return out / (np.abs(out).max() + 1e-9) * 0.9


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("timeline")
    ap.add_argument("out")
    ap.add_argument("--sa", type=float, default=220.0)
    ap.add_argument("--tempo", type=float, default=96.0)
    a = ap.parse_args()
    from scipy.io import wavfile

    y = sing(json.loads(Path(a.timeline).read_text()), a.sa, a.tempo)
    wavfile.write(a.out, FS, (y * 32767).astype(np.int16))
    print(f"wrote {a.out}: {len(y) / FS:.1f} s")


if __name__ == "__main__":
    main()
