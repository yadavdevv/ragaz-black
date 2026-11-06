"""Pre-generate bandishes for the site from a trained bandish checkpoint.

    uv run python scripts/generate_bandishes.py runs/grpo/<bandish run>/checkpoints/best
    → web/public/data/bandishes.json

For every raga: one bandish with words and notes both by the model (free), and one setting of a
held-out verse it never saw in training (set); plus settings of the Devanagari texts on /words.
Each is the best of N samples by the bandish reward (bandish.score), and says so. The verifier
pieces (notes per beat, words per beat) are exported so the page can play and light them.
"""

import json
import random
import sys
from pathlib import Path

import mlx.core as mx
from mlx_lm import batch_generate, load
from mlx_lm.sample_utils import make_sampler

from ragaz.bandish import score, split
from ragaz.bandish_train import bandish_prompt, chat, held_out, rows
from ragaz.notation import parse
from ragaz.ragas import load_ragas
from ragaz.watchdog import MemoryWatchdog

OUT = Path("web/public/data/bandishes.json")
N = 8
SHELF = {"kabir": "बुरा जो देखन मैं चला\nबुरा न मिलिया कोय\nजो दिल खोजा आपना\nमुझ सा बुरा न कोय"}  # Kabir's doha, public domain


def main(adapter: str, model_id: str = "mlx-community/Qwen3-0.6B-bf16") -> None:
    mx.set_memory_limit(4 * 2**30)
    watchdog = MemoryWatchdog(max_gb=7, min_free_gb=2.5).start()
    model, tok = load(model_id, adapter_path=adapter)
    ragas = load_ragas()
    rng = random.Random(0)
    pool = [r for r in rows() if held_out(r["page"])]
    jobs = []
    for key in ragas:
        jobs.append({"raga": key, "task": "free", "words": None, "source": None})
        verses = [r for r in pool if r["raga"] == key] or pool
        v = rng.choice(verses)
        jobs.append({"raga": key, "task": "set", "words": v["words"], "source": f"{v['source']}: {v['page']}"})
        for name, text in SHELF.items():
            jobs.append({"raga": key, "task": "set", "words": text, "source": name})
    sampler = make_sampler(temp=0.8, top_p=0.95)
    out = []
    for i, job in enumerate(jobs):
        prompt = chat(tok, bandish_prompt(ragas[job["raga"]], job["words"]))
        texts = batch_generate(model, tok, [prompt] * N, max_tokens=420, sampler=sampler, completion_batch_size=N, prefill_batch_size=4).texts
        mx.clear_cache()
        scored = sorted(((score(t, job["raga"], job["words"]), t) for t in texts), key=lambda x: x[0]["reward"], reverse=True)
        s, text = scored[0]
        notation, tokens = split(text)
        comp = parse(notation)
        out.append({
            **job, "text": text.replace("```", "").strip(), "reward": round(s["reward"], 4), "scores": {k: round(v, 3) for k, v in s.items()},
            "selection": f"best of {N} samples by the bandish reward", "beats": comp.beats, "bol": tokens[: int(comp.beats)],
            "notes": [{"s": n.swara, "o": n.octave, "t": round(n.start, 4), "d": round(n.duration, 4), "bar": n.bar, "ok": n.swara in ragas[job["raga"]].notes} for n in comp.notes],
        })
        print(f"[{i + 1}/{len(jobs)}] {job['raga']:<13} {job['task']:<4} {job['source'] or '':<12.12} reward {s['reward']:.2f} (raga {s['raga']:.2f}, aligned {s['aligned']:.2f}, fidelity {s['fidelity']:.2f}, mukhda {s['mukhda']:.0f})", flush=True)
    watchdog.stop()
    # Only settings of real verse go to the site: the model's own words (free task) are not yet meaningful
    # ("कही मीजो नोस यो…": Braj-sounding fragments, no sense), whatever the word check says.
    shipped = [b for b in out if b["task"] == "set"]
    OUT.write_text(json.dumps({"adapter": adapter, "n": N, "bandishes": shipped, "note": "Only settings of real verse are exported: the model's own words (the free task) are not yet meaningful."}, ensure_ascii=False))
    print(f"wrote {OUT}: {len(out)} bandishes")


if __name__ == "__main__":
    main(sys.argv[1])
