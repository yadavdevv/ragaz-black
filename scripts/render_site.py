"""Render the site's recordings, sung as a person would (render.performance).

    caffeinate -i nice -n 10 uv run --extra voice python scripts/render_site.py

  recordings  out/v6-<raga>-{vocal,expressive}.wav for every raga with an out/v6-<raga>.txt:
              vocal = the Hindustani DDSP voice (hvocal), expressive = the flute synth
  evolution   out/evolve/<raga>-<stage>.wav and out/evolve/evolution.json: one piece per training
              stage (before RL, v1, v2, v5e, v6) for the ragas every stage knew, all in the same
              voice and performance, so only the composing differs. The piece is each stage's
              median by its own run's score (typical, not the best), and every piece is scored
              again with one yardstick: the v6 reward at the piece's own length.
Skips what is already rendered (delete a file to redo it). One render at a time.
"""

import json
import statistics
from pathlib import Path

from ragaz.notation import parse
from ragaz.ragas import get_raga
from ragaz.render import render, write_wav
from ragaz.verify import verify

VOICE = "hvocal"
TEMPO = 90
OUT = Path("out")
EVOLVE = OUT / "evolve"
RAGAS = ["bhupali", "yaman", "malkauns"]
V5E = Path("runs/grpo/v5e-long-grpo-20261024-1940")
V6 = Path("runs/grpo/v6-grpo-20261106-0017")
STAGES = [
    ("sft", "Before RL", "fine-tuned on examples, never scored"),
    ("v1", "v1", "reinforcement learning on the raga's rules alone"),
    ("v2", "v2", "rewarded for sounding like real recordings, 8 bars"),
    ("v5e", "v5e", "16 bars, rhythm and length learned"),
    ("v6", "v6", "13 ragas, the reward recalibrated on more concerts"),
]


def jsonl(p: Path) -> list[dict]:
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def median_piece(rows: list[dict]) -> dict:
    rows = sorted(rows, key=lambda r: r["reward"])
    return rows[len(rows) // 2]


def stage_rows(stage: str, raga: str) -> list[dict]:
    if stage in ("sft", "v1", "v2"):
        d = json.loads(Path("web/public/data/pieces.json").read_text())
        return [p for p in (d["pieces"] if isinstance(d, dict) else d) if p["model"] == stage and p["raga"] == raga]
    run = V5E if stage == "v5e" else V6
    step = json.loads((run / "checkpoints" / "best" / "state.json").read_text())["step"] if stage == "v5e" else 60
    return [r for r in jsonl(run / "eval_samples.jsonl") if r["step"] == step and r["variant"] == "bare" and r["raga"] == raga]


def go(text: str, raga: str, wav: Path, voice: str | None) -> None:
    if wav.exists():
        return
    audio = render(text, get_raga(raga), sa_hz=261.63, tempo=TEMPO, expressive=True, voice=voice, perform=True)
    write_wav(wav, audio)
    print(f"wrote {wav}", flush=True)


def main() -> None:
    for txt in sorted(OUT.glob("v6-*.txt")):
        raga = txt.stem.split("-", 1)[1]
        text = txt.read_text().strip()
        go(text, raga, OUT / f"v6-{raga}-vocal.wav", VOICE)
        go(text, raga, OUT / f"v6-{raga}-expressive.wav", None)
    EVOLVE.mkdir(parents=True, exist_ok=True)
    table = []
    for raga in RAGAS:
        for key, label, what in STAGES:
            rows = stage_rows(key, raga)
            if not rows:
                continue
            r = median_piece(rows)
            comp = parse(r["notation"])
            v = verify(r["notation"], raga, style="v6", target_bars=len(comp.bars))
            allowed = get_raga(raga).notes
            outside = sum(n.swara not in allowed for n in comp.notes) / max(1, len(comp.notes))
            go(r["notation"], raga, EVOLVE / f"{raga}-{key}.wav", VOICE)
            table.append({"raga": raga, "stage": key, "label": label, "what": what, "notation": r["notation"], "bars": len(comp.bars),
                          "own_score": round(r["reward"], 4), "own_median": round(statistics.median(x["reward"] for x in rows), 4), "pieces": len(rows),
                          "v6_score": round(v.reward, 4), "outside": round(outside, 4), "violations": v.violations[:3]})
    (EVOLVE / "evolution.json").write_text(json.dumps(table, indent=1, ensure_ascii=False))
    print(f"evolution: {len(table)} pieces")


if __name__ == "__main__":
    main()
