"""Can we tell the raga from a few seconds of singing? (the "Sing to it" reader)

    uv run python scripts/hum_reading.py            # evaluate on held-out recordings
    uv run python scripts/hum_reading.py --export   # also write web/public/data/reader.json

A short phrase has too few notes for the verifier's phrase and register terms, so the
reader uses two small statistics learned from the training recordings of each raga:

  notes        time share of each of the 12 notes (held notes, weighted by duration)
  transitions  how often each note moves to each other note (12 × 12)

Score = mean log-likelihood per second of the phrase under each raga (notes) plus per
move (transitions), both add-k smoothed. The training/held-out split is the one in
data/real_profiles_v6.json, so evaluation recordings never shape the reader.

Evaluation cuts each held-out recording into non-overlapping windows of voiced time
(5, 10, 20 s) and reports top-1 / top-3 accuracy and the most common confusions.
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

from ragaz.ragas import SWARAS, load_ragas
from ragaz.realprofile import FEATURES, PROFILES_V6
from ragaz.transcribe import load_pitch, load_tonic, transcribe

WINDOWS = (5.0, 10.0, 20.0)
K_NOTES, K_MOVES = 0.5, 0.5
W_MOVES = 1.0
OUT = Path("web/public/data/reader.json")


def held_notes(raga: str, stem: str) -> list[tuple[int, float, float]]:
    """(pitch class, start s, duration s) for one recording."""
    pitch = FEATURES / raga / f"{stem}.pitch"
    times, hz = load_pitch(pitch)
    return [(SWARAS.index(n.swara), n.start, n.duration) for n in transcribe(times, hz, load_tonic(pitch.with_suffix(".tonicFine")))]


def fit(recordings: list[list[tuple[int, float, float]]]) -> dict:
    notes = np.full(12, K_NOTES)
    moves = np.full((12, 12), K_MOVES)
    np.fill_diagonal(moves, 0)  # repeated notes are merged by the transcriber
    for rec in recordings:
        for pc, _, dur in rec:
            notes[pc] += dur
        for (a, _, _), (b, _, _) in zip(rec, rec[1:]):
            if a != b:
                moves[a, b] += 1
    moves = moves / moves.sum(1, keepdims=True)
    return {"notes": (notes / notes.sum()).tolist(), "moves": moves.tolist()}


def score(phrase: list[tuple[int, float, float]], model: dict) -> float:
    notes, moves = np.log(model["notes"]), np.log(np.array(model["moves"]) + 1e-12)
    total = sum(d for _, _, d in phrase) or 1.0
    s = sum(d * notes[pc] for pc, _, d in phrase) / total
    steps = [(a, b) for (a, _, _), (b, _, _) in zip(phrase, phrase[1:]) if a != b]
    if steps:
        s += W_MOVES * sum(moves[a, b] for a, b in steps) / len(steps)
    return float(s)


def shares(scores: list[float], n_notes: int, scale: float) -> np.ndarray:
    """Softmax over ragas; sharper for longer phrases. Same formula as web/lib/listen.ts read()."""
    k = max(1, min(n_notes, 30)) * scale
    x = np.exp(k * (np.array(scores) - max(scores)))
    return x / x.sum()


def calibrate(ragas: list[str], split: dict, cache: dict, seconds: float = 10.0) -> float:
    """Pick the softmax sharpness so shown confidence matches accuracy, on training recordings only:
    each training recording is read by models fitted without it (leave one recording out)."""
    rows = []
    for truth in ragas:
        for held_out in split[truth]["train"]:
            models = {r: fit([cache[r, s] for s in split[r]["train"] if s != held_out]) for r in ragas}
            for phrase in windows(cache[truth, held_out], seconds):
                rows.append(([score(phrase, models[r]) for r in ragas], len(phrase), ragas.index(truth)))
    grid = np.geomspace(0.01, 2, 60)
    nll = [-np.mean([np.log(shares(sc, n, c)[t] + 1e-12) for sc, n, t in rows]) for c in grid]
    best = float(grid[int(np.argmin(nll))])
    acc = np.mean([np.argmax(sc) == t for sc, _, t in rows])
    conf = np.mean([shares(sc, n, best).max() for sc, n, _ in rows])
    print(f"calibration (train, leave-one-recording-out, {len(rows)} windows): scale {best:.3f}; mean top share {conf:.0%} vs accuracy {acc:.0%}")
    return best


def windows(rec: list[tuple[int, float, float]], seconds: float):
    """Consecutive runs of held notes totalling `seconds` of sung time."""
    out, cur, t = [], [], 0.0
    for note in rec:
        cur.append(note)
        t += note[2]
        if t >= seconds:
            out.append(cur)
            cur, t = [], 0.0
    return out


def main() -> None:
    split = json.loads(PROFILES_V6.read_text())["split"]
    ragas = list(split)
    R = load_ragas()
    names = {k: r.name for k, r in R.items()}
    print(f"{len(ragas)} ragas: {', '.join(ragas)}")
    cache = {(r, s): held_notes(r, s) for r in ragas for part in ("train", "test") for s in split[r][part]}
    models = {r: fit([cache[r, s] for s in split[r]["train"]]) for r in ragas}

    results = {}
    for seconds in WINDOWS:
        top1, top3, n = Counter(), Counter(), Counter()
        confusions = Counter()
        for truth in ragas:
            for stem in split[truth]["test"]:
                for phrase in windows(cache[truth, stem], seconds):
                    ranked = sorted(ragas, key=lambda r: score(phrase, models[r]), reverse=True)
                    n[truth] += 1
                    top1[truth] += ranked[0] == truth
                    top3[truth] += truth in ranked[:3]
                    if ranked[0] != truth:
                        confusions[truth, ranked[0]] += 1
        acc1 = sum(top1.values()) / sum(n.values())
        acc3 = sum(top3.values()) / sum(n.values())
        results[seconds] = {"top1": acc1, "top3": acc3, "windows": sum(n.values()), "per_raga": {r: {"top1": top1[r] / n[r], "top3": top3[r] / n[r], "windows": n[r]} for r in ragas}}
        print(f"\n{seconds:.0f} s of singing: top-1 {acc1:.0%}, top-3 {acc3:.0%} over {sum(n.values())} held-out windows (chance {1 / len(ragas):.0%})")
        for r in ragas:
            print(f"  {names[r]:<14} top-1 {top1[r] / n[r]:4.0%}  top-3 {top3[r] / n[r]:4.0%}  ({n[r]} windows)")
        print("  most confused: " + ", ".join(f"{names[a]} → {names[b]} {c}" for (a, b), c in confusions.most_common(6)))

    if "--export" in sys.argv:
        scale = calibrate(ragas, split, cache)
        test_conf = np.mean([shares([score(ph, models[r]) for r in ragas], len(ph), scale).max() for t in ragas for st in split[t]["test"] for ph in windows(cache[t, st], 10.0)])
        print(f"held-out 10 s: mean shown confidence {test_conf:.0%} vs top-1 {results[10.0]['top1']:.0%}")
        OUT.write_text(json.dumps({
            "share_scale": round(scale, 4),
            "source": "CompMusic Indian Art Music Raga Recognition Dataset (features), CC BY 4.0; training recordings only",
            "k_notes": K_NOTES, "k_moves": K_MOVES, "w_moves": W_MOVES,
            "models": {r: {k: np.round(v, 5).tolist() for k, v in models[r].items()} for r in ragas},
            "ragas": {r: {"name": R[r].name, "devanagari": R[r].devanagari, "notes": sorted(R[r].notes, key=SWARAS.index), "vadi": R[r].vadi, "samvadi": R[r].samvadi,
                          "pakad": R[r].pakad, "time": R[r].time, "hours": R[r].hours, "season": R[r].season, "rasa": R[r].rasa, "tanpura": R[r].tanpura} for r in ragas},
            "evaluation": {f"{s:.0f}s": v for s, v in results.items()},
        }))
        print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
