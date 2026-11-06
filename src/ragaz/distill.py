"""Collect good compositions from a hinted model, for context distillation.

    ragaz distill --adapter runs/grpo/<track-a run>/checkpoints/best --per-raga 200

Samples hinted prompts (the prompt carries the raga's notes), keeps pieces that
score at least ``--min-reward``, drops duplicates, and writes one JSONL line per
piece: {"raga", "notation", "reward"}. ``ragaz sft`` then teaches the model to
write these from the raga's *name* alone.
"""

import json
import random
from collections import Counter
from pathlib import Path

from ragaz.notation import extract
from ragaz.prompts import chat_prompt, copy_fraction
from ragaz.ragas import get_raga
from ragaz.verify import verify

TWINS = {"bhupali": "deshkar", "deshkar": "bhupali"}


def distill(
    model_id: str,
    adapter: str | None,
    ragas: list[str],
    per_raga: int,
    out: Path,
    min_reward: float = 0.85,
    max_per_raga: int = 120,
    batch: int = 8,
    temp: float = 1.0,
    memory_gb: float = 5,
    seed: int = 0,
    style: str = "v1",
    bars: int = 8,
    rhythm: bool = False,
    variant: str = "hinted",
) -> None:
    import mlx.core as mx
    from mlx_lm import batch_generate, load
    from mlx_lm.sample_utils import make_sampler

    from ragaz.watchdog import MemoryWatchdog

    mx.random.seed(seed)
    mx.set_memory_limit(int(memory_gb * 2**30))
    mx.set_cache_limit(2**30)
    watchdog = MemoryWatchdog(max_gb=memory_gb * 1.6).start()

    model, tokenizer = load(model_id, adapter_path=adapter) if adapter else load(model_id)
    sampler = make_sampler(temp=temp)
    kept: list[dict] = []
    for key in ragas:
        raga = get_raga(key)
        prompts = [chat_prompt(tokenizer, raga, variant, bars, rhythm)] * per_raga
        texts = batch_generate(model, tokenizer, prompts, max_tokens=120 if bars <= 8 else 320, sampler=sampler, completion_batch_size=batch, prefill_batch_size=min(4, batch)).texts
        mx.clear_cache()

        seen, pieces, rewards = set(), [], []
        for text in texts:
            notation = extract(text).strip()
            reward = verify(notation, raga, style=style, target_bars=bars).reward * (1 - copy_fraction(notation))
            rewards.append(reward)
            # Twins share every note: keep a piece only if it is more itself than its twin.
            twin = TWINS.get(key)
            if twin and verify(notation, twin, style=style, target_bars=bars).reward >= reward:
                continue
            if reward >= min_reward and notation not in seen:
                seen.add(notation)
                pieces.append({"raga": key, "notation": notation, "reward": round(reward, 4)})
        random.Random(seed).shuffle(pieces)
        pieces = pieces[:max_per_raga]
        kept += pieces
        good = sum(r >= min_reward for r in rewards)
        top = sorted(rewards, reverse=True)
        print(f"{raga.name:<14} {per_raga} sampled · median {top[len(top) // 2]:.2f}, p90 {top[len(top) // 10]:.2f} · {good} scored ≥ {min_reward} · {len(pieces)} distinct kept", flush=True)
    watchdog.stop()

    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        for row in kept:
            f.write(json.dumps(row) + "\n")
    counts = Counter(r["raga"] for r in kept)
    print(f"wrote {len(kept)} pieces to {out}: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
