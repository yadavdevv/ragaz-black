"""Expression learned from real performances: how singers move between and within notes.

Our model writes plain notes; real Hindustani music lives in the movement:
  - meend (glides): the pitch curve from one held note to the next
  - andolan / vibrato: the slow waver on a held note, which differs by note and raga

This builds a small library from the CompMusic pitch tracks (CC BY 4.0):
  glides[raga][interval]   → real transition curves, resampled, with their durations
  waver[raga][swara]       → depth (cents) and rate (Hz) of the waver on long notes
  micro[raga][swara]       → real detrended within-note pitch curves (100 points/s), replayed as-is

The renderer then *replays real curves*: a nonparametric (example-based) expression
model. A learned generative model can replace it later; this is the honest baseline.

    uv run python -m ragaz.expression
"""

import json
import random
from collections import defaultdict
from pathlib import Path

import numpy as np

from ragaz.ragas import SWARAS
from ragaz.transcribe import load_pitch, load_tonic, transcribe

FEATURES = Path("data/external/compmusic/features")
LIBRARY = Path("data/expression.json")
POINTS = 32  # samples per stored glide curve
MAX_GLIDE_S = 0.6
MIN_WAVER_NOTE_S = 0.6


def cents_track(times: np.ndarray, hz: np.ndarray, tonic: float) -> np.ndarray:
    c = np.full(hz.shape, np.nan)
    v = hz > 0
    c[v] = 1200 * np.log2(hz[v] / tonic)
    return c


def build(ragas: list[str], max_per_interval: int = 40, seed: int = 0) -> dict:
    rng = random.Random(seed)
    rejected = 0
    micro: dict = defaultdict(lambda: defaultdict(list))
    glides: dict = defaultdict(lambda: defaultdict(list))
    waver: dict = defaultdict(lambda: defaultdict(list))
    for raga in ragas:
        for pitch in sorted((FEATURES / raga).glob("*.pitch")):
            tonic_f = pitch.with_suffix(".tonicFine")
            if not tonic_f.exists():
                continue
            times, hz = load_pitch(pitch)
            tonic = load_tonic(tonic_f)
            cents = cents_track(times, hz, tonic)
            hop = float(np.median(np.diff(times)))
            notes = transcribe(times, hz, tonic)
            for a, b in zip(notes, notes[1:]):
                gap = b.start - (a.start + a.duration)
                if not 0 < gap <= MAX_GLIDE_S:
                    continue
                i0, i1 = int((a.start + a.duration) / hop), int(b.start / hop) + 1
                seg = cents[i0:i1]
                if len(seg) < 4 or np.isnan(seg).mean() > 0.2:
                    continue
                seg = np.interp(np.arange(len(seg)), np.flatnonzero(~np.isnan(seg)), seg[~np.isnan(seg)])
                start_c = SWARAS.index(a.swara) * 100 + 1200 * a.octave
                end_c = SWARAS.index(b.swara) * 100 + 1200 * b.octave
                if end_c == start_c:
                    continue
                # Normalise: 0 at the start note, 1 at the end note, so a curve can be reused at any pitch.
                shape = (seg - start_c) / (end_c - start_c)
                shape = np.interp(np.linspace(0, len(shape) - 1, POINTS), np.arange(len(shape)), shape)
                # Reject pitch-tracking errors (octave jumps): a real glide may overshoot its
                # target a little, but not travel far beyond either note.
                if shape.min() < -0.35 or shape.max() > 1.35:
                    rejected += 1
                    continue
                glides[raga][str(end_c - start_c)].append({"shape": np.round(shape, 3).tolist(), "seconds": round(gap, 3)})
            for n in notes:
                if n.duration < MIN_WAVER_NOTE_S:
                    continue
                # Raw contour over the note (not just frames inside the ±35-cent window
                # the transcriber used, which would cap the depth), smoothed to remove
                # frame jitter, detrended, then the dominant rate from its spectrum.
                i0, i1 = int(n.start / hop), int((n.start + n.duration) / hop)
                seg = cents[i0:i1]
                if len(seg) < 64 or np.isnan(seg).mean() > 0.1:
                    continue
                seg = np.interp(np.arange(len(seg)), np.flatnonzero(~np.isnan(seg)), seg[~np.isnan(seg)])
                k = max(1, int(0.04 / hop))
                smooth = np.convolve(seg, np.ones(k) / k, mode="valid")
                dev = smooth - np.polyval(np.polyfit(np.arange(len(smooth)), smooth, 1), np.arange(len(smooth)))
                depth = float(np.percentile(np.abs(dev), 90))
                spectrum = np.abs(np.fft.rfft(dev * np.hanning(len(dev)), n=4096))
                freqs = np.fft.rfftfreq(4096, hop)
                band = (freqs >= 0.5) & (freqs <= 12)
                rate = float(freqs[band][np.argmax(spectrum[band])])
                waver[raga][n.swara].append((depth, rate))
                # The real contour itself (light 15 ms smoothing keeps the small organic
                # ups and downs, removes tracker jitter), detrended, at 100 points/s.
                k_fine = max(1, int(0.015 / hop))
                fine = np.convolve(seg, np.ones(k_fine) / k_fine, mode="valid")
                fine = fine - np.polyval(np.polyfit(np.arange(len(fine)), fine, 1), np.arange(len(fine)))
                step = max(1, int(0.01 / hop))
                micro[raga][n.swara].append(np.round(fine[::step][:300], 1).tolist())

    print(f"rejected {rejected} glides as pitch-tracking errors")
    library = {"glides": {}, "waver": {}, "micro": {}}
    for raga in ragas:
        library["glides"][raga] = {k: rng.sample(v, min(len(v), max_per_interval)) for k, v in glides[raga].items() if len(v) >= 3}
        library["micro"][raga] = {s: rng.sample(v, min(len(v), 25)) for s, v in micro[raga].items() if len(v) >= 5}
        library["waver"][raga] = {
            s: {"depth_cents": round(float(np.median([d for d, _ in v])), 1), "rate_hz": round(float(np.median([r for _, r in v])), 2), "n": len(v)}
            for s, v in waver[raga].items()
            if len(v) >= 5
        }
    return library


def summarize(library: dict) -> None:
    for raga, by_iv in library["glides"].items():
        n = sum(len(v) for v in by_iv.values())
        secs = [g["seconds"] for v in by_iv.values() for g in v]
        print(f"{raga:<9} {n} glides over {len(by_iv)} interval types, median {np.median(secs) * 1000:.0f} ms")
        w = library["waver"][raga]
        print("          waver (cents @ Hz): " + ", ".join(f"{s} {v['depth_cents']:.0f}@{v['rate_hz']:.1f}" for s, v in sorted(w.items(), key=lambda kv: SWARAS.index(kv[0]))))


if __name__ == "__main__":
    from ragaz.realprofile import recorded_ragas

    # Built one raga at a time, so new ragas only add entries; the first three are unchanged.
    lib = build(recorded_ragas())
    LIBRARY.write_text(json.dumps(lib))
    summarize(lib)
    print(f"wrote {LIBRARY} ({LIBRARY.stat().st_size / 1e3:.0f} kB)")
