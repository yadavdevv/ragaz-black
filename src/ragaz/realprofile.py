"""Style statistics measured from real performances (the v2, "real-grounded" reward).

v1's style terms were guesses (a vadi-share band, a leap limit, literal textbook
pakad strings). Checked against 26 concert recordings, real masters scored
0.36–0.50 on them while the model scored 0.80–0.90 by over-using the "important"
notes and almost never resting on Sa. v2 measures style from the recordings:

  profile  time share of each of the 12 notes          (1 − Jensen–Shannon divergence)
  motion   distribution of intervals between notes     (1 − JSD)
  phrases  distinctive 4-note figures mined per raga   (weighted coverage)

Each raw value is then *calibrated against real excerpts of the same length*: a
piece as typical as the median real excerpt scores 1.0, so imitating real
practice is rewarded and exaggerating it is not.

Build once (needs the CompMusic features, see scripts/fetch_compmusic.py):

    uv run python -m ragaz.realprofile
"""

import json
import math
import os
import random
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from functools import cache
from pathlib import Path

import numpy as np

from ragaz.ragas import SWARAS

FEATURES = Path("data/external/compmusic/features")
PROFILES = Path("data/real_profiles.json")
# v6 adds nine ragas. Phrase distinctiveness is relative to all ragas, so the v6 profiles
# live in their own file and the v5 reward (the live site, parity) stays exactly as it was.
PROFILES_V6 = Path(os.environ.get("RAGAZ_PROFILES_V6", "data/real_profiles_v6.json"))  # ragaz.compose points this at a download
V5_RAGAS = ["bhupali", "yaman", "malkauns"]
# Recordings whose dataset tonic is wrong, left out of v6 (v5 is kept as it was trained).
# Evidence (2026-11-05): share of sung time on notes outside the raga, at the given tonic vs shifted.
V6_EXCLUDE = {
    "Raga_-_Darbari_6e4dea78-ec22-479a-9e3c-c253a6deba7c",  # 38% outside; tonic +2 semitones → 2%
    "Raga_Malkauns_-_Teental_5233f93f-4f1c-4ba1-9d3f-3d47a5f81d2e",  # 26% outside; tonic −5 → 7%
}
EXCERPT = 32
NGRAM = 4
MAX_INTERVAL = 12
TOP_PHRASES = 60


# ----------------------------------------------------------------- features


def pc_distribution(notes: list[tuple[str, int, float]]) -> np.ndarray:
    """Time share per pitch class. notes = (swara, octave, duration)."""
    d = np.zeros(12)
    for swara, _, duration in notes:
        d[SWARAS.index(swara)] += duration
    return d / d.sum() if d.sum() else d


def interval_distribution(notes: list[tuple[str, int, float]]) -> np.ndarray:
    d = np.zeros(2 * MAX_INTERVAL + 1)
    pitch = [SWARAS.index(s) + 12 * o for s, o, _ in notes]
    for a, b in zip(pitch, pitch[1:]):
        if a != b:
            d[int(np.clip(b - a, -MAX_INTERVAL, MAX_INTERVAL)) + MAX_INTERVAL] += 1
    return d / d.sum() if d.sum() else d


RHYTHM_BINS = np.arange(-3.0, 3.01, 0.5)  # log2(duration / median duration)


def rhythm_histogram(notes: list[tuple[str, int, float]]) -> np.ndarray:
    """Scale-free shape of note durations: how many notes are quick vs held, relative to the median.

    Works at any tempo (beats or seconds). Real music: a big cluster of quick notes plus
    a tail of long holds; v4's pieces: almost every note the same length.
    """
    d = np.array([x[2] for x in notes if x[2] > 0])
    if len(d) < 2:
        return np.zeros(len(RHYTHM_BINS) - 1)
    h, _ = np.histogram(np.clip(np.log2(d / np.median(d)), -2.99, 2.99), bins=RHYTHM_BINS)
    return h / h.sum()


def register_distribution(notes: list[tuple[str, int, float]]) -> np.ndarray:
    """Time share in the lower, middle and upper octave. Real singers spend 18–42% of their time
    in the upper octave; v5c spent 0% (the pitch-class profile is octave-blind, so it missed this)."""
    d = np.zeros(3)
    for _, octave, duration in notes:
        d[min(2, max(0, octave + 1))] += duration
    return d / d.sum() if d.sum() else d


def duration_cv(notes: list[tuple[str, int, float]]) -> float:
    d = np.array([x[2] for x in notes if x[2] > 0])
    return float(d.std() / d.mean()) if len(d) > 1 else 0.0


def ngrams(notes: list[tuple[str, int, float]]) -> set[str]:
    pcs = [s for s, _, _ in notes]
    return {" ".join(pcs[i : i + NGRAM]) for i in range(len(pcs) - NGRAM + 1)}


def jsd(p: np.ndarray, q: np.ndarray) -> float:
    """Jensen–Shannon divergence, base 2, in [0, 1]."""
    m = (p + q) / 2

    def kl(a: np.ndarray, b: np.ndarray) -> float:
        mask = a > 0
        return float(np.sum(a[mask] * np.log2(a[mask] / b[mask])))

    return 0.5 * kl(p, m) + 0.5 * kl(q, m)


# ------------------------------------------------------------------- build


def recording_excerpts(raga: str, exclude: frozenset[str] = frozenset()) -> dict[str, list[list[tuple[str, int, float]]]]:
    from ragaz.transcribe import load_pitch, load_tonic, transcribe

    out = {}
    for pitch in sorted((FEATURES / raga).glob("*.pitch")):
        if pitch.stem in exclude:
            continue
        tonic = pitch.with_suffix(".tonicFine")
        if not tonic.exists():
            continue
        times, hz = load_pitch(pitch)
        notes = [(n.swara, n.octave, n.duration) for n in transcribe(times, hz, load_tonic(tonic))]
        out[pitch.stem] = [notes[k : k + EXCERPT] for k in range(0, len(notes) - EXCERPT + 1, EXCERPT)]
    return out


def recorded_ragas() -> list[str]:
    """Ragas in ragas.yaml order that have CompMusic recordings on disk."""
    from ragaz.ragas import load_ragas

    return [k for k in load_ragas() if any((FEATURES / k).glob("*.pitch"))]


def build(ragas: list[str], test_fraction: float = 0.3, seed: int = 0, exclude: frozenset[str] = frozenset()) -> dict:
    rng = random.Random(seed)
    excerpts, split = {}, {}
    for raga in ragas:
        recs = recording_excerpts(raga, exclude)
        names = sorted(recs)
        rng.shuffle(names)
        n_test = max(1, round(len(names) * test_fraction))
        split[raga] = {"test": sorted(names[:n_test]), "train": sorted(names[n_test:])}
        excerpts[raga] = {name: recs[name] for name in names}

    # Phrase statistics: how often each 4-note figure occurs per raga (train excerpts only).
    counts: dict[str, Counter] = defaultdict(Counter)
    totals: dict[str, int] = {}
    for raga in ragas:
        train = [e for name in split[raga]["train"] for e in excerpts[raga][name]]
        for e in train:
            counts[raga].update(ngrams(e))
        totals[raga] = len(train)
    vocab = set().union(*counts.values())

    profiles = {"split": split, "ragas": {}}
    # Rhythm is performance practice, not raga identity: pool it across all ragas (so it
    # also applies to ragas without recordings, e.g. Deshkar).
    all_train = [e for raga in ragas for name in split[raga]["train"] for e in excerpts[raga][name]]
    rhythm = np.mean([rhythm_histogram(e) for e in all_train], axis=0)
    profiles["rhythm"] = {
        "histogram": rhythm.tolist(),
        "calibration": {
            "shape": sorted(jsd(rhythm_histogram(e), rhythm) for e in all_train),
            "cv": sorted(duration_cv(e) for e in all_train),
        },
    }
    for raga in ragas:
        train = [e for name in split[raga]["train"] for e in excerpts[raga][name]]
        pc = np.mean([pc_distribution(e) for e in train], axis=0)
        iv = np.mean([interval_distribution(e) for e in train], axis=0)
        # Distinctiveness: how much likelier a figure is in this raga than across all ragas.
        phrases = {}
        for g in vocab:
            p_here = (counts[raga][g] + 1) / (totals[raga] + 2)
            p_all = (sum(counts[r][g] for r in ragas) + 1) / (sum(totals.values()) + 2)
            lift = p_here / p_all
            if counts[raga][g] >= 5 and lift > 1.5:
                phrases[g] = p_here * math.log(lift)
        top = dict(sorted(phrases.items(), key=lambda kv: -kv[1])[:TOP_PHRASES])
        reg = np.mean([register_distribution(e) for e in train], axis=0)
        profile = {"pc": pc.tolist(), "intervals": iv.tolist(), "phrases": top, "register": reg.tolist()}
        # Calibration: raw values on this raga's own training excerpts.
        profile["calibration"] = {
            "profile": sorted(jsd(pc_distribution(e), pc) for e in train),
            "motion": sorted(jsd(interval_distribution(e), iv) for e in train),
            "phrases": sorted(phrase_raw(e, top) for e in train),
            "register": sorted(jsd(register_distribution(e), reg) for e in train),
        }
        profiles["ragas"][raga] = profile
        names = [f"{g} ({w:.3f})" for g, w in list(top.items())[:5]]
        print(f"{raga:<9} train {len(train)} excerpts · top phrases: {', '.join(names)}")
    return profiles


def phrase_raw(notes: list[tuple[str, int, float]], phrases: dict[str, float]) -> float:
    found = ngrams(notes)
    return sum(w for g, w in phrases.items() if g in found)


# ------------------------------------------------------------------- score


def rhythm_scores(notes: list[tuple[str, int, float]], profiles: dict | None = None) -> dict[str, float]:
    """Rhythm realism in [0, 1]: duration shape (JSD vs pooled real) and spread (CV), each
    calibrated so a typical real excerpt scores 1. Empty if profiles predate rhythm."""
    profiles = profiles or load_profiles()
    if not profiles or "rhythm" not in profiles:
        return {}
    r = profiles["rhythm"]
    shape = calibrated(jsd(rhythm_histogram(notes), np.array(r["histogram"])), r["calibration"]["shape"], higher_is_better=False)
    spread = calibrated(duration_cv(notes), r["calibration"]["cv"], higher_is_better=True)
    return {"rhythm": 0.5 * shape + 0.5 * spread}


@cache
def load_profiles(path: str = str(PROFILES)) -> dict | None:
    p = Path(path)
    return json.loads(p.read_text()) if p.exists() else None


def calibrated(value: float, real: list[float], higher_is_better: bool) -> float:
    """Typicality vs real excerpts: the median real excerpt scores 1.0."""
    if higher_is_better:
        share_at_least_as_good = bisect_right(real, value) / len(real)  # real excerpts ≤ value
    else:
        share_at_least_as_good = (len(real) - bisect_left(real, value)) / len(real)  # real excerpts ≥ value
    return min(1.0, 2 * share_at_least_as_good)


def profiles_path(style: str) -> str:
    """Which real profiles a reward style is scored against: v6 adds nine ragas in its own file."""
    return str(PROFILES_V6 if style == "v6" else PROFILES)


def style_scores(notes: list[tuple[str, int, float]], raga: str, path: str = str(PROFILES)) -> dict[str, float] | None:
    profiles = load_profiles(path)
    if not profiles or raga not in profiles["ragas"]:
        return None
    prof = profiles["ragas"][raga]
    cal = prof["calibration"]
    extra = {}
    if "register" in prof:
        extra["register"] = calibrated(jsd(register_distribution(notes), np.array(prof["register"])), cal["register"], higher_is_better=False)
    return rhythm_scores(notes, profiles) | extra | {
        "profile": calibrated(jsd(pc_distribution(notes), np.array(prof["pc"])), cal["profile"], higher_is_better=False),
        "motion": calibrated(jsd(interval_distribution(notes), np.array(prof["intervals"])), cal["motion"], higher_is_better=False),
        "phrases": calibrated(phrase_raw(notes, prof["phrases"]), cal["phrases"], higher_is_better=True),
    }


if __name__ == "__main__":
    import sys

    v6 = sys.argv[1:] == ["v6"]  # python -m ragaz.realprofile [v6]
    out, ragas = (PROFILES_V6, recorded_ragas()) if v6 else (PROFILES, V5_RAGAS)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(build(ragas, exclude=frozenset(V6_EXCLUDE) if v6 else frozenset())))
    print(f"wrote {out} ({', '.join(ragas)})")


# ------------------------------------------------- pooled profile (v3 reward)


def real_pc(raga: str, path: str = str(PROFILES)) -> np.ndarray | None:
    profiles = load_profiles(path)
    return np.array(profiles["ragas"][raga]["pc"]) if profiles and raga in profiles["ragas"] else None


def realism(pieces: list[list[tuple[str, int, float]]], raga: str, path: str = str(PROFILES)) -> float:
    """1 − total-variation distance between the pooled note-time profile of many pieces
    and the real profile. Stable (unlike one 32-note piece), so it's the metric that
    picks checkpoints: v2's reward rose after step 20 while this fell."""
    target = real_pc(raga, path)
    if target is None:
        return float("nan")  # no recordings for this raga
    pooled = pc_distribution([n for p in pieces for n in p])
    return 1 - 0.5 * float(np.abs(pooled - target).sum())


def group_profile_ranks(pieces: list[list[tuple[str, int, float]]], raga: str, path: str = str(PROFILES)) -> list[float]:
    """Credit each piece by how much it moves its group's pooled profile toward real.

    Leave-one-out: d_i = JSD(pool without i, real) − JSD(pool, real). Positive d_i means
    the piece helps. Returned as ranks in [0, 1] (ties averaged), which is scale-free; GRPO
    normalises within the group anyway. A group that all skips Pa rewards whoever uses it.
    """
    target = real_pc(raga, path)
    if target is None:
        return [1.0] * len(pieces)  # no recordings: neutral, the rulebook terms decide
    full = jsd(pc_distribution([n for p in pieces for n in p]), target)
    deltas = []
    for i in range(len(pieces)):
        rest = [n for j, p in enumerate(pieces) if j != i for n in p]
        deltas.append(jsd(pc_distribution(rest), target) - full if rest else 0.0)
    order = sorted(range(len(deltas)), key=lambda i: deltas[i])
    ranks = [0.0] * len(deltas)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and deltas[order[j + 1]] == deltas[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = ((i + j) / 2) / max(1, len(deltas) - 1)
        i = j + 1
    return ranks
