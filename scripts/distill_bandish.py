"""Self-distillation for the bandish model: keep only its near-perfect bandishes, teach on them.

    uv run python scripts/distill_bandish.py runs/grpo/<bandish run>/checkpoints/best
    → data/bandish_distilled.jsonl, data/bandish_v2.jsonl (distilled + the original teaching set)

GRPO added nothing to the bandish model, but best-of-8 sampling already finds bandishes with
95%+ of syllables on notes, so (as for the composer: distil, then SFT) sample many on *training*
verses and keep one per verse only if every check passes: every syllable starts on a note,
the words are kept, the mukhda lands on sam, and the notes are in the raga.
"""

import json
import random
import sys
from pathlib import Path

import mlx.core as mx
from mlx_lm import batch_generate, load
from mlx_lm.sample_utils import make_sampler

from ragaz.bandish import score
from ragaz.bandish_train import bandish_prompt, chat, held_out, rows
from ragaz.ragas import get_raga
from ragaz.watchdog import MemoryWatchdog

OUT = Path("data/bandish_distilled.jsonl")
MIX = Path("data/bandish_v2.jsonl")
N, PROMPTS = 8, 200
KEEP = {"aligned": 0.97, "fidelity": 0.97, "mukhda": 1.0, "raga": 0.5}


def main(adapter: str, model_id: str = "mlx-community/Qwen3-0.6B-bf16", seed: int = 0) -> None:
    mx.set_memory_limit(4 * 2**30)
    watchdog = MemoryWatchdog(max_gb=7, min_free_gb=2.5).start()
    model, tok = load(model_id, adapter_path=adapter)
    sampler = make_sampler(temp=0.9, top_p=0.95)
    train = [r for r in rows() if not held_out(r["page"]) and r["task"] == "set"]
    rng = random.Random(seed)
    picks = rng.sample(train, min(PROMPTS, len(train)))
    kept, tried = [], 0
    for i, r in enumerate(picks):
        prompt = chat(tok, bandish_prompt(get_raga(r["raga"]), r["words"]))
        texts = batch_generate(model, tok, [prompt] * N, max_tokens=420, sampler=sampler, completion_batch_size=N, prefill_batch_size=4).texts
        mx.clear_cache()
        tried += N
        good = []
        for t in texts:
            s = score(t, r["raga"], r["words"])
            if all(s[k] >= v for k, v in KEEP.items()):
                good.append((s["reward"], t.replace("```", "").strip()))
        if good:
            reward, text = max(good)
            kept.append({"task": "set", "raga": r["raga"], "words": r["words"], "text": text, "reward": round(reward, 4), "page": r["page"], "source": r["source"], "raga_from": "self-distilled"})
        if (i + 1) % 20 == 0:
            print(f"{i + 1}/{len(picks)} verses: kept {len(kept)} ({len(kept) / (i + 1):.0%} of verses had a sample passing every check)", flush=True)
    watchdog.stop()
    OUT.write_text("\n".join(json.dumps(k, ensure_ascii=False) for k in kept) + "\n")
    original = Path("data/bandish_v1.jsonl").read_text().strip().splitlines()
    MIX.write_text("\n".join(original + [json.dumps(k, ensure_ascii=False) for k in kept]) + "\n")
    print(f"kept {len(kept)} of {len(picks)} verses ({tried} samples) → {OUT}; mix of {len(original) + len(kept)} → {MIX}")


if __name__ == "__main__":
    main(sys.argv[1])
