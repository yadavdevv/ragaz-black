"""Train the bandish composer: words and notes written together, from the v6 composer.

    ragaz bandish-sft   --config configs/bandish-sft.yaml
    ragaz bandish-train --config configs/bandish-grpo.yaml

Two tasks (bandish.py has the format and the reward):
  set   raga + words → bandish   (logged as eval/set/...)
  free  raga → bandish           (logged as eval/free/...)

Same machinery as the composer (setup, LoRA, memory guard, GRPO update, checkpoints); prompts,
reward and evaluation are replaced. 10% of the verses (by page) are held out: evaluation sets
words the model has never seen.
"""

import hashlib
import json
import random
import statistics
from functools import cache
from pathlib import Path

from ragaz.bandish import score, split
from ragaz.grpo import duplicate_scale
from ragaz.ragas import Raga, get_raga
from ragaz.sft import SFTTrainer
from ragaz.trainer import EVAL_TEMP, EVAL_TOP_P, GRPOTrainer

DATA = Path("data/bandish_v1.jsonl")
PARTS = ["raga", "aligned", "fidelity", "fit", "mukhda", "known"]
TASKS = ("free", "set")

EXAMPLE = "S R m P | D - P m | R m P D | m R S - |\n- - - - | - - - - | - - ज य | जय ऽ ऽ ऽ |"
FORMAT = """Write it the way Bhatkhande's books print a bandish: for each cycle of 16 beats, a swar line, then a bol line under it.
- Swar line: sargam. S R G M P D N (M = tivra Ma), komal r g d n (m = shuddh Ma); .N lower octave, S' upper; `-` holds a beat; GR = two notes in one beat; 4 beats per bar, bars separated by |.
- Bol line: one token per beat: the syllable that starts on that beat, ऽ while a vowel is held, - where nothing is sung, two syllables in one beat joined by ·.
Write 16 bars (4 cycles): cycles 1–2 are the sthayi, 3–4 the antara. Hold heavy syllables on long notes, and land the first words (the mukhda) on sam, the first beat of a cycle.

Format example only (one cycle, Raga Durga, a different raga):
```
{example}
```
Reply with only the bandish inside a code block."""


def bandish_prompt(raga: Raga, words: str | None) -> str:
    mood = raga.rasa + (f", the {raga.season}" if raga.season else "")
    head = f"Compose a bandish in Raga {raga.name} (Hindustani classical music) in Teentaal, sung in the {raga.time}; its mood: {mood}."
    task = f"Set these words (two lines of sthayi, then two of antara):\n{words}\n\nSing exactly these syllables, in order (* = long: hold it; write it without the *):\n{syllable_plan(words)}" if words else "Write its words too: Braj Bhasha, in Devanagari, of the raga's hour and mood."
    return "\n\n".join([head, task, FORMAT.format(example=EXAMPLE)])


def syllable_plan(words: str) -> str:
    """The given words already split into syllables, one line per verse line, long ones marked *: the
    model only has to place them (the first bandish runs rewrote syllables, fidelity ~0.77)."""
    from ragaz.lyrics import syllables

    lines: dict[int, list[str]] = {}
    for x in syllables(words):
        lines.setdefault(x.line, []).append(x.text + ("*" if x.heavy else ""))
    return "\n".join(" ".join(v) for _, v in sorted(lines.items()))


def chat(tokenizer, text: str) -> list[int]:
    return tokenizer.apply_chat_template([{"role": "user", "content": text}], add_generation_prompt=True, enable_thinking=False)


def held_out(page: str) -> bool:
    return int(hashlib.md5(page.encode()).hexdigest(), 16) % 10 == 0


@cache
def rows(path: str = str(DATA)) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text().splitlines()]


class BandishMixin:
    def bandish_rows(self, specs, texts, completions, truncated, group: int) -> list[dict]:
        out = []
        for k, (text, completion, trunc) in enumerate(zip(texts, completions, truncated)):
            raga, task, prompt, words = specs[k // group]
            s = score(text, raga.key, words)
            notation, _ = split(text)
            out.append({"raga": raga.key, "variant": task, "prompt": prompt, "completion": completion, "truncated": trunc, "text": text,
                        "notation": notation, "reward": s["reward"], "scores": s, "copied": 0.0, "novel": 1.0})
        return out

    def data(self) -> list[dict]:
        return rows(self.cfg.sft_data or str(DATA))

    def specs(self, n: int, rng: random.Random, train: bool) -> list:
        pool = [r for r in self.data() if held_out(r["page"]) != train]
        out = []
        for i in range(n):
            raga = self.ragas[(self.step * n + i) % len(self.ragas)]
            task = rng.choice(TASKS)
            words = None
            if task == "set":
                verses = [r["words"] for r in pool if r["raga"] == raga.key] or [r["words"] for r in pool]
                words = rng.choice(verses)
            out.append((raga, task, chat(self.tokenizer, bandish_prompt(raga, words)), words))
        return out

    def rollout(self) -> list[dict]:
        cfg = self.cfg
        specs = self.specs(cfg.prompts_per_step, self.rng, train=True)
        prompts = [ids for _, _, ids, _ in specs for _ in range(cfg.group_size)]
        texts, completions, truncated = self.generate(prompts, cfg.temperature, cfg.top_p)
        out = self.bandish_rows(specs, texts, completions, truncated, cfg.group_size)
        if cfg.duplicate_penalty > 0:
            for r, (count, scale) in zip(out, duplicate_scale([r["text"] for r in out], cfg.group_size, cfg.duplicate_penalty)):
                r["dup_count"] = count
                r["reward"] *= scale
        return out

    def evaluate(self) -> dict[str, float]:
        cfg = self.cfg
        rng = random.Random(1234)  # the same held-out verses at every evaluation
        pool = [r for r in self.data() if held_out(r["page"])]
        specs = []
        for task in TASKS:
            for raga in self.ragas:
                for _ in range(cfg.eval_samples):
                    words = None
                    if task == "set":
                        verses = [r["words"] for r in pool if r["raga"] == raga.key] or [r["words"] for r in pool]
                        words = rng.choice(verses)
                    specs.append((raga, task, chat(self.tokenizer, bandish_prompt(raga, words)), words))
        texts, completions, truncated = self.generate([ids for _, _, ids, _ in specs], EVAL_TEMP, EVAL_TOP_P)
        out = self.bandish_rows(specs, texts, completions, truncated, 1)
        with open(self.run_dir / "eval_samples.jsonl", "a") as f:
            for r, (_, _, _, words) in zip(out, specs):
                f.write(json.dumps({"step": self.step, "raga": r["raga"], "task": r["variant"], "words": words, "reward": r["reward"], "scores": r["scores"], "text": r["text"]}, ensure_ascii=False) + "\n")
        metrics = {}
        for task in TASKS:
            group = [r for r in out if r["variant"] == task]
            metrics[f"eval/{task}/reward"] = statistics.mean(r["reward"] for r in group)
            metrics[f"eval/{task}/good_rate"] = sum(r["reward"] > 0.4 for r in group) / len(group)
            metrics[f"eval/{task}/distinct"] = len({r["text"] for r in group}) / len(group)
            for part in PARTS:
                metrics[f"eval/{task}/{part}"] = statistics.mean(r["scores"].get(part, 0.0) for r in group)
            for raga in self.ragas:
                vals = [r["reward"] for r in group if r["raga"] == raga.key]
                metrics[f"eval/{task}/raga/{raga.key}"] = statistics.mean(vals)
        metrics["eval/both/reward"] = (metrics["eval/free/reward"] + metrics["eval/set/reward"]) / 2
        return metrics

    def run_eval(self) -> None:
        import time

        start = time.time()
        metrics = self.evaluate()
        metrics["time/eval_s"] = time.time() - start
        self.tracker.log(metrics, self.step)
        print(f"[eval step {self.step}] set {metrics['eval/set/reward']:.3f} (aligned {metrics['eval/set/aligned']:.2f}, fidelity {metrics['eval/set/fidelity']:.2f}, raga {metrics['eval/set/raga']:.2f})"
              f" · free {metrics['eval/free/reward']:.3f} (raga {metrics['eval/free/raga']:.2f}, known words {metrics['eval/free/known']:.2f})", flush=True)
        if metrics[self.cfg.best_metric] > self.best_eval:
            self.best_eval = metrics[self.cfg.best_metric]
            self.save_checkpoint("best")


class BandishGRPOTrainer(BandishMixin, GRPOTrainer):
    def hint_probability(self) -> float:
        return 0.0


class BandishSFTTrainer(BandishMixin, SFTTrainer):
    def load_examples(self) -> list[dict]:
        examples = []
        for r in self.data():
            if held_out(r["page"]):
                continue
            raga = get_raga(r["raga"])
            completion = self.tokenizer.encode(f"```\n{r['text']}\n```") + [self.eos_id]
            examples.append({"raga": r["raga"], "prompt": chat(self.tokenizer, bandish_prompt(raga, r["words"] if r["task"] == "set" else None)), "completion": completion})
        return examples


def bandish_sft(config_path: str, overrides: list[str]) -> None:
    from ragaz.config import GRPOConfig

    BandishSFTTrainer(GRPOConfig.load(config_path, overrides)).train()


def bandish_train(config_path: str | None, overrides: list[str], resume: str | None = None) -> None:
    from ragaz.config import GRPOConfig

    cfg = GRPOConfig.load(Path(resume) / "config.yaml" if resume else config_path, overrides)
    BandishGRPOTrainer(cfg, Path(resume) if resume else None).train()
