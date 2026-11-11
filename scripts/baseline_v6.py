"""Before training: the untrained base model on exactly the newest model's evaluation.

    uv run python scripts/baseline_v6.py      # → out/baseline-v6/samples.jsonl, summary.json

Qwen3-0.6B as downloaded (no LoRA), asked what v6 was asked (the raga's name only, 16 bars, the
rhythm hint, chat template with thinking off), sampled the same way (temperature 0.8, top-p 0.95,
320 tokens), 6 pieces per raga, and judged by the same programs: the v6 reward, notes allowed by
the raga, the independent reader. Only the training differs.
"""

import json
import statistics
from pathlib import Path

from ragaz.notation import extract, parse
from ragaz.prompts import EXAMPLE_BARS, chat_prompt
from ragaz.ragas import load_ragas
from ragaz.reader import known, rank
from ragaz.trainer import RAGA_NOTES
from ragaz.verify import verify

BASE = "mlx-community/Qwen3-0.6B-bf16"
PER_RAGA = 6
OUT = Path("out/baseline-v6")


def main() -> None:
    import mlx.core as mx
    from mlx_lm import generate, load
    from mlx_lm.sample_utils import make_sampler

    model, tok = load(BASE)
    sampler = make_sampler(temp=0.8, top_p=0.95)
    ragas = load_ragas()
    v6 = json.loads(Path("web/public/data/latest.json").read_text())
    keys = [r["key"] for r in v6["ragas"]]
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for k in keys:
        for i in range(PER_RAGA):
            mx.random.seed(1000 + i)
            text = generate(model, tok, prompt=chat_prompt(tok, ragas[k], "bare", 16, rhythm=True), max_tokens=320, sampler=sampler, verbose=False)
            notation = extract(text)
            report = verify(notation, k, style="v6", target_bars=16)
            comp = parse(notation)
            allowed = sum(n.swara in ragas[k].notes for n in comp.notes) / max(1, len(comp.notes))
            read = (rank(RAGA_NOTES(notation))[:1] == [k]) if k in known() and comp.notes else None
            copied = sum(tuple(b) in EXAMPLE_BARS for b in comp.bars) / max(1, len(comp.bars))
            rows.append({"raga": k, "notation": notation, "reward": report.reward, "scores": report.scores, "violations": report.violations[:3], "copied": copied,
                         "notes": len(comp.notes), "bars": len(comp.bars), "allowed_share": allowed, "reader_ok": read})
        print(k, flush=True)
    (OUT / "samples.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    judged = [r for r in rows if r["reader_ok"] is not None]
    summary = {
        "model": BASE, "pieces": len(rows),
        "reward": round(statistics.mean(r["reward"] for r in rows), 4),
        "no_wrong_notes": round(sum(r["notes"] > 0 and r["allowed_share"] == 1 for r in rows) / len(rows), 4),
        "allowed_share": round(statistics.mean(r["allowed_share"] for r in rows), 4),
        "reader_accuracy": round(sum(r["reader_ok"] for r in judged) / max(1, len(judged)), 4),
        "sixteen_bars": round(sum(r["bars"] == 16 for r in rows) / len(rows), 4),
        "copied_example": round(sum(r["copied"] >= 0.5 for r in rows) / len(rows), 4),  # half or more of its bars are the prompt's example
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=1))
    print(summary)


if __name__ == "__main__":
    main()
