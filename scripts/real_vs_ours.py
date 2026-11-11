"""Measure how real performances move vs how ours do, with the same tool on both.

    uv run python scripts/real_vs_ours.py

Our pieces are rendered to a pitch curve (expressive renderer), sampled at the same
4.4 ms hop as the CompMusic pitch tracks, and run through the *same* transcriber.
Reported per side:

  notes/s        held notes per second of singing (silences > 1.5 s excluded)
  dur p10/50/90  held-note durations in seconds
  holds ≥1 s     share of notes held at least a second
  dur CV         spread of durations (std / mean): 0 = metronomic
  in motion      share of sung time *between* notes (glides, ornaments), not on one
  micro cents    typical within-note wobble (std of detrended cents on notes ≥ 0.3 s)
  breaths/min    silences of 0.25–1.5 s (a breath, a phrase ending) per minute of singing
"""

import json
import statistics
from pathlib import Path

import numpy as np

from ragaz.notation import parse
from ragaz.render import SR as RENDER_SR
from ragaz.render import breath_mask, expressive_cents, performance
from ragaz.transcribe import load_pitch, load_tonic, transcribe

FEATURES = Path("data/external/compmusic/features")
HOP = 0.0044444
RAGAS = ["bhupali", "yaman", "malkauns"]


def stats(times: np.ndarray, hz: np.ndarray, tonic: float) -> dict:
    notes = transcribe(times, hz, tonic)
    if len(notes) < 10:
        return {}
    durs = np.array([n.duration for n in notes])
    # Singing time: note span with long silences (> 1.5 s gaps) removed.
    gaps = np.array([b.start - (a.start + a.duration) for a, b in zip(notes, notes[1:])])
    sung = durs.sum() + gaps[gaps <= 1.5].sum()
    cents = np.where(hz > 0, 1200 * np.log2(np.maximum(hz, 1e-9) / tonic), np.nan)
    voiced = ~np.isnan(cents)
    off_grid = np.abs(cents - np.round(cents / 100) * 100) > 35
    wobble = []
    for n in notes:
        if n.duration < 0.3:
            continue
        i0, i1 = int(n.start / HOP), int((n.start + n.duration) / HOP)
        seg = cents[i0:i1]
        seg = seg[~np.isnan(seg)]
        if len(seg) > 20:
            x = np.arange(len(seg))
            wobble.append(float(np.std(seg - np.polyval(np.polyfit(x, seg, 1), x))))
    return {
        "notes_per_s": len(notes) / sung,
        "dur_p10": float(np.percentile(durs, 10)),
        "dur_p50": float(np.median(durs)),
        "dur_p90": float(np.percentile(durs, 90)),
        "holds_1s": float((durs >= 1.0).mean()),
        "dur_cv": float(durs.std() / durs.mean()),
        "in_motion": float((voiced & off_grid).sum() / voiced.sum()),
        "micro_cents": float(np.median(wobble)) if wobble else 0.0,
        "breaths_min": float(((gaps >= 0.25) & (gaps <= 1.5)).sum() / (sung / 60)),
    }


def ours(tempo: float, step: int = 60, run: str = "runs/grpo/v4-final-20261009-2257", rows: list[dict] | None = None, perform: bool = False) -> list[dict]:
    lib = json.loads(Path("data/expression.json").read_text())
    run = Path(run)
    rows = rows if rows is not None else [json.loads(line) for line in open(run / "eval_samples.jsonl") if f'"step": {step},' in line and '"bare"' in line]
    out = []
    for r in rows:
        if r["raga"] not in RAGAS:
            continue
        comp = parse(r["notation"])
        if not comp.notes:
            continue
        beat = 60 / tempo
        n = int((comp.beats * beat + 0.5) * RENDER_SR)
        perf = performance(comp, beat, r["raga"]) if perform else None
        cents = expressive_cents(comp, beat, n, r["raga"], lib, perf=perf)
        t = np.arange(0, n / RENDER_SR, HOP)
        idx = (t * RENDER_SR).astype(int).clip(0, n - 1)
        c = cents[idx]
        tonic = 261.63
        hz = tonic * 2 ** (c / 1200)
        if perf:
            hz = hz * breath_mask(perf, n, RENDER_SR)[idx]  # breaths are unvoiced
        s = stats(t, hz, tonic)
        if s:
            out.append(s)
    return out


SUMMARY: dict[str, dict] = {}


def summarize(label: str, rows: list[dict]) -> None:
    keys = ["notes_per_s", "dur_p10", "dur_p50", "dur_p90", "holds_1s", "dur_cv", "in_motion", "micro_cents", "breaths_min"]
    vals = {k: statistics.median(r[k] for r in rows) for k in keys}
    SUMMARY[label] = {k: round(v, 3) for k, v in vals.items()} | {"n": len(rows)}
    print(f"{label:<26}" + "".join(f"{vals[k]:>11.2f}" for k in keys))


def main() -> None:
    real = []
    for raga in RAGAS:
        for p in sorted((FEATURES / raga).glob("*.pitch")):
            t, hz = load_pitch(p)
            s = stats(t, hz, load_tonic(p.with_suffix(".tonicFine")))
            if s:
                real.append(s)
    print(f"{'':<26}" + "".join(f"{k:>11}" for k in ["notes/s", "dur p10", "dur p50", "dur p90", "holds≥1s", "dur CV", "in motion", "micro c", "breaths"]))
    summarize(f"real ({len(real)} recordings)", real)
    for tempo in (72, 120):
        summarize(f"ours v4 @ {tempo} bpm", ours(tempo))
    v5 = sorted(Path("runs/grpo").glob("v5c-rhythm-gate-*"))[-1]
    summarize("ours v5c @ 100 bpm", ours(100, 50, str(v5)))
    v5e = sorted(Path("runs/grpo").glob("v5e-long-grpo-*"))[-1]
    best = __import__("json").loads((v5e / "checkpoints" / "best" / "state.json").read_text())["step"]
    for tempo in (90, 100):
        summarize(f"ours v5e (16 bars) @ {tempo} bpm", ours(tempo, best, str(v5e)))
    latest = json.loads(Path("web/public/data/latest.json").read_text())
    v6 = [{"raga": p["raga"], "notation": p["notation"]} for p in latest["pieces"]]
    summarize(f"ours v6 (site) @ {latest['tempo']} bpm", ours(latest["tempo"], rows=v6))
    summarize("ours v6, performed", ours(latest["tempo"], rows=v6, perform=True))
    Path("reports").mkdir(exist_ok=True)
    Path("reports/real_vs_ours.json").write_text(json.dumps({"real": real}, indent=1))
    # What the site quotes (export_web.py): real singers, the v6 pieces as written, and as performed.
    keys = [k for k in SUMMARY if k.startswith("real")] + [k for k in SUMMARY if k.startswith("ours v6")]
    Path("reports/performance.json").write_text(json.dumps({"real": SUMMARY[keys[0]], "plain": SUMMARY[keys[1]], "performed": SUMMARY[keys[2]]}, indent=1))


if __name__ == "__main__":
    main()
