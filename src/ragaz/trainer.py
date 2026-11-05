"""GRPO training loop on MLX with LoRA.

    ragaz train --config configs/grpo-0.8b.yaml
    ragaz train --config configs/grpo-0.8b.yaml --set steps=50 lr=3e-5
    ragaz train --resume runs/grpo/<run>

Each step: sample G completions for each of P prompts → score them with the
raga verifier → GRPO update on the LoRA adapters. Every ``eval_every`` steps the
model is evaluated on fixed prompts (with and without hints), the best sample per
raga is rendered to audio, and a checkpoint is saved. Ctrl-C saves and exits.
"""

import json
import random
import shutil
import statistics
import time
from datetime import datetime
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np
import psutil
from mlx.utils import tree_flatten, tree_map, tree_unflatten

from ragaz.config import GRPOConfig
from ragaz.grpo import duplicate_scale, group_advantages, grpo_loss, make_micro_batch, token_logprobs
from ragaz.notation import extract, parse
from ragaz.prompts import chat_prompt, copy_fraction
from ragaz.ragas import get_raga
from ragaz.render import render, write_wav
from ragaz.tracking import Tracker
from ragaz.verify import verify
from ragaz.watchdog import MemoryWatchdog, ResourceGovernor

PARTS = ["format", "allowed", "beats", "tala", "emphasis", "melody", "pakad", "variety", "length"]
PARTS_V2 = ["profile", "motion", "phrases"]
PARTS_V4 = ["rank", "purity"]
PARTS_V5 = ["rhythm", "register"]
PARTS_LONG = ["arc"]
RAGA_NOTES = lambda notation: [(n.swara, n.octave, n.duration) for n in parse(notation).notes]  # noqa: E731
EVAL_TEMP, EVAL_TOP_P = 0.8, 0.95  # same as the baseline, so numbers are comparable


class GRPOTrainer:
    def __init__(self, cfg: GRPOConfig, run_dir: Path | None = None):
        self.cfg = cfg
        self.resuming = run_dir is not None
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        self.run_dir = run_dir or Path(cfg.out_dir) / f"{cfg.name}-{stamp}"
        self.run_name = self.run_dir.name
        self.step = 0
        self.best_eval = -1.0
        self.rng = random.Random(cfg.seed)

    # ------------------------------------------------------------------ setup

    def setup(self) -> None:
        from mlx_lm import load
        from mlx_lm.tuner.utils import linear_to_lora_layers

        cfg = self.cfg
        mx.random.seed(cfg.seed)
        np.random.seed(cfg.seed)
        mx.set_memory_limit(int(cfg.memory_gb * 2**30))
        mx.set_cache_limit(2**30)

        self.run_dir.mkdir(parents=True, exist_ok=True)
        (self.run_dir / "checkpoints").mkdir(exist_ok=True)
        (self.run_dir / "audio").mkdir(exist_ok=True)
        cfg.save(self.run_dir / "config.yaml")
        self.watchdog = MemoryWatchdog(
            cfg.hard_memory_gb,
            cfg.min_free_gb,
            cfg.max_swap_growth_gb,
            marker=self.run_dir / "KILLED_BY_WATCHDOG.txt",
        ).start()
        self.governor = ResourceGovernor(cfg.governor_full_gb, cfg.governor_pause_gb)

        print(f"loading {cfg.model}")
        self.model, self.tokenizer = load(cfg.model)
        self.model.freeze()
        linear_to_lora_layers(
            self.model,
            cfg.lora_layers,
            {"rank": cfg.lora_rank, "scale": cfg.lora_scale, "dropout": cfg.lora_dropout},
        )
        if cfg.init_adapter:
            adapter = Path(cfg.init_adapter)
            saved = json.loads((adapter / "adapter_config.json").read_text())
            expected = {"rank": cfg.lora_rank, "scale": cfg.lora_scale}
            got = {k: saved["lora_parameters"][k] for k in expected}
            if got != expected or saved["num_layers"] != cfg.lora_layers:
                raise ValueError(f"init_adapter LoRA shape {got}, {saved['num_layers']} layers != config {expected}, {cfg.lora_layers}")
            self.model.load_weights(list(mx.load(str(adapter / "adapters.safetensors")).items()), strict=False)
            print(f"initialised LoRA from {adapter}")
        trainable = sum(v.size for _, v in tree_flatten(self.model.trainable_parameters()))
        total = sum(v.size for _, v in tree_flatten(self.model.parameters()))
        print(f"LoRA: {trainable / 1e6:.2f}M trainable of {total / 1e6:.0f}M parameters")

        # KL anchors to the starting point (base, or base + init adapter). Only the LoRA
        # weights differ from it, so keep a snapshot of the starting LoRA (~22 MB) and swap
        # it in to compute reference log-probs, instead of loading a second model (~1.2 GB).
        self.ref_lora = dict(tree_flatten(self.model.trainable_parameters())) if cfg.beta > 0 else None

        self.pad_id = self.tokenizer.pad_token_id if self.tokenizer.pad_token_id is not None else 0
        self.eos_id = next(iter(self.tokenizer.eos_token_ids))
        self.ragas = [get_raga(r) for r in cfg.ragas]
        self.ref_bars: set[tuple[str, ...]] | None = None
        if cfg.novelty_ref:
            self.ref_bars = {tuple(b) for line in open(cfg.novelty_ref) for b in parse(json.loads(line)["notation"]).bars}

        schedule = optim.linear_schedule(cfg.lr * 0.01, cfg.lr, max(1, cfg.warmup_steps))
        self.optimizer = optim.AdamW(learning_rate=schedule, weight_decay=0.0)
        self.loss_and_grad = nn.value_and_grad(self.model, grpo_loss)

        if self.resuming:
            self.load_checkpoint(self.run_dir / "checkpoints" / "latest")

        config = {**cfg.to_dict(), "trainable_params": trainable, "run_dir": str(self.run_dir)}
        self.tracker = Tracker(cfg.tracker, cfg.project, self.run_name, config, self.run_dir, resume=self.resuming)

    # --------------------------------------------------------------- sampling

    def generate(self, prompts: list[list[int]], temp: float, top_p: float) -> tuple[list[str], list[list[int]], list[bool]]:
        from mlx_lm import batch_generate
        from mlx_lm.sample_utils import make_sampler

        self.model.eval()  # fast Metal kernels for Qwen3.5's linear attention
        result = batch_generate(
            self.model,
            self.tokenizer,
            prompts,
            max_tokens=self.cfg.max_tokens,
            sampler=make_sampler(temp=temp, top_p=top_p if top_p < 1 else 0.0),
            completion_batch_size=max(2, int(self.cfg.gen_batch * self.governor.scale)),
            prefill_batch_size=max(1, min(4, int(self.cfg.gen_batch * self.governor.scale))),
            return_token_ids=True,
        )
        completions, truncated = [], []
        for ids in result.token_ids:
            ids = list(ids)
            hit_limit = len(ids) >= self.cfg.max_tokens
            truncated.append(hit_limit)
            # batch_generate drops the stop token; put it back so the model learns to stop.
            completions.append(ids if hit_limit else ids + [self.eos_id])
        mx.clear_cache()
        return result.texts, completions, truncated

    def novel_fraction(self, notation: str) -> float:
        """Share of bars not in the novelty reference (1.0 when there is no reference)."""
        if self.ref_bars is None:
            return 1.0
        bars = [tuple(b) for b in parse(notation).bars]
        return sum(b not in self.ref_bars for b in bars) / len(bars) if bars else 0.0

    def hint_probability(self) -> float:
        cfg = self.cfg
        frac = min(1.0, self.step / max(1, cfg.hint_decay_steps))
        return cfg.hint_start + (cfg.hint_end - cfg.hint_start) * frac

    def rollout(self) -> list[dict]:
        cfg = self.cfg
        p_hint = self.hint_probability()
        specs = []
        for i in range(cfg.prompts_per_step):
            raga = self.ragas[(self.step * cfg.prompts_per_step + i) % len(self.ragas)]
            variant = "hinted" if self.rng.random() < p_hint else "bare"
            specs.append((raga, variant, chat_prompt(self.tokenizer, raga, variant, cfg.target_bars, cfg.rhythm_prompt)))

        prompts = [ids for _, _, ids in specs for _ in range(cfg.group_size)]
        texts, completions, truncated = self.generate(prompts, cfg.temperature, cfg.top_p)

        rows = []
        for k, (text, completion, trunc) in enumerate(zip(texts, completions, truncated)):
            raga, variant, prompt = specs[k // cfg.group_size]
            notation = extract(text)
            report = verify(notation, raga, style=self.cfg.reward_style, target_bars=self.cfg.target_bars)
            copied = copy_fraction(notation)
            novel = self.novel_fraction(notation)
            rows.append(
                {
                    "raga": raga.key,
                    "variant": variant,
                    "prompt": prompt,
                    "copied": copied,
                    "completion": completion,
                    "truncated": trunc,
                    "text": text,
                    "reward": report.reward * (1 - copied) * ((1 - cfg.novelty_weight) + cfg.novelty_weight * novel),
                    "novel": novel,
                    "scores": report.scores,
                }
            )

        # Group note profile (v3): credit pieces that pull their group's pooled profile toward real.
        if cfg.group_profile_weight > 0:
            from ragaz.realprofile import group_profile_ranks, profiles_path

            for g in range(0, len(rows), cfg.group_size):
                group = rows[g : g + cfg.group_size]
                ranks = group_profile_ranks([RAGA_NOTES(extract(r["text"])) for r in group], group[0]["raga"], profiles_path(cfg.reward_style))
                for r, rank in zip(group, ranks):
                    r["profile_rank"] = rank
                    r["reward"] *= (1 - cfg.group_profile_weight) + cfg.group_profile_weight * rank

        # Within-group duplicate penalty: run 2 collapsed to one piece per raga, after
        # which every advantage was 0 and learning stopped.
        if cfg.duplicate_penalty > 0:
            scales = duplicate_scale([extract(r["text"]) for r in rows], cfg.group_size, cfg.duplicate_penalty)
            for r, (count, scale) in zip(rows, scales):
                r["dup_count"] = count
                r["reward"] *= scale
        return rows

    # ----------------------------------------------------------------- update

    def update(self, rows: list[dict]) -> dict[str, float]:
        cfg = self.cfg
        rewards = np.array([r["reward"] for r in rows])
        adv = group_advantages(rewards, cfg.group_size, cfg.scale_advantages)

        keep = [
            i
            for i in range(len(rows))
            if abs(adv[i]) > 1e-8 and not (cfg.mask_truncated and rows[i]["truncated"])
        ]
        stats = {"train/zero_adv_frac": 1 - len(keep) / len(rows)}
        if not keep:
            return {**stats, "train/skipped_update": 1.0}

        keep.sort(key=lambda i: len(rows[i]["prompt"]) + len(rows[i]["completion"]))  # less padding
        n_tokens = sum(len(rows[i]["completion"]) for i in keep)
        batches = []
        micro = max(1, int(cfg.micro_batch * self.governor.scale))
        for j in range(0, len(keep), micro):
            idx = keep[j : j + micro]
            batches.append(
                make_micro_batch(
                    [rows[i]["prompt"] for i in idx],
                    [rows[i]["completion"] for i in idx],
                    [float(adv[i]) for i in idx],
                    self.pad_id,
                )
            )

        # Training mode makes Qwen3.5's linear-attention layers use plain ops instead
        # of a custom Metal kernel, which has no backward pass.
        self.model.train()
        refs = [None] * len(batches)
        if self.ref_lora is not None:
            current = list(tree_flatten(self.model.trainable_parameters()))
            self.model.load_weights(list(self.ref_lora.items()), strict=False)
            refs = [mx.stop_gradient(token_logprobs(self.model, b.tokens, b.start)) for b in batches]
            mx.eval(refs)
            self.model.load_weights(current, strict=False)
        olds = [None] * len(batches)
        if cfg.updates_per_batch > 1:
            olds = [mx.stop_gradient(token_logprobs(self.model, b.tokens, b.start)) for b in batches]
            mx.eval(olds)

        loss_total = kl_total = clip_total = grad_norm = 0.0
        for _ in range(cfg.updates_per_batch):
            grads_acc = None
            loss_sum = kl_sum = clip_sum = 0.0
            for b, old, ref in zip(batches, olds, refs):
                (loss, kl, clipped), grads = self.loss_and_grad(
                    self.model, b, old, ref, n_tokens, cfg.beta, cfg.clip_low, cfg.clip_high
                )
                grads_acc = grads if grads_acc is None else tree_map(mx.add, grads_acc, grads)
                mx.eval(grads_acc, loss, kl, clipped)
                loss_sum += loss.item()
                kl_sum += kl.item()
                clip_sum += clipped.item()

            if not np.isfinite(loss_sum):
                self.tracker.alert("non-finite loss", f"step {self.step}: loss={loss_sum}; update skipped")
                return {**stats, "train/skipped_update": 1.0}

            grads_acc, norm = optim.clip_grad_norm(grads_acc, cfg.max_grad_norm)
            self.optimizer.update(self.model, grads_acc)
            mx.eval(self.model.trainable_parameters(), self.optimizer.state)
            loss_total, kl_total, clip_total, grad_norm = loss_sum, kl_sum, clip_sum, norm.item()

        mx.clear_cache()
        return {
            **stats,
            "train/loss": loss_total,
            "train/kl": kl_total / n_tokens,
            "train/clip_frac": clip_total / n_tokens,
            "train/grad_norm": grad_norm,
            "train/skipped_update": 0.0,
        }

    # --------------------------------------------------------------- evaluate

    def evaluate(self) -> dict[str, float]:
        cfg = self.cfg
        specs = [(raga, variant) for variant in ("bare", "hinted") for raga in self.ragas]
        prompts = [chat_prompt(self.tokenizer, r, v, cfg.target_bars, cfg.rhythm_prompt) for r, v in specs for _ in range(cfg.eval_samples)]
        texts, _, _ = self.generate(prompts, EVAL_TEMP, EVAL_TOP_P)

        rows = []
        for k, text in enumerate(texts):
            raga, variant = specs[k // cfg.eval_samples]
            notation = extract(text)
            report = verify(notation, raga, style=self.cfg.reward_style, target_bars=self.cfg.target_bars)
            copied = copy_fraction(notation)
            rows.append({"raga": raga.key, "variant": variant, "reward": report.reward * (1 - copied), "copied": copied, "scores": report.scores, "notation": notation, "violations": report.violations[:6]})

        with open(self.run_dir / "eval_samples.jsonl", "a") as f:
            for row in rows:
                f.write(json.dumps({"step": self.step, **row}) + "\n")

        metrics = {}
        for variant in ("bare", "hinted"):
            group = [r for r in rows if r["variant"] == variant]
            metrics[f"eval/{variant}/reward"] = statistics.mean(r["reward"] for r in group)
            metrics[f"eval/{variant}/good_rate"] = sum(r["reward"] > 0.8 for r in group) / len(group)
            metrics[f"eval/{variant}/no_wrong_notes"] = sum(r["scores"]["allowed"] == 1 for r in group) / len(group)
            if cfg.reward_style in ("v2", "v3", "v4", "v5", "v6"):
                from ragaz.realprofile import profiles_path, realism

                vals = [realism([RAGA_NOTES(r["notation"]) for r in group if r["raga"] == raga.key], raga.key, profiles_path(cfg.reward_style)) for raga in self.ragas]
                metrics[f"eval/{variant}/realism"] = statistics.mean(v for v in vals if v == v)  # skip ragas without recordings
                metrics[f"eval/{variant}/real_score"] = metrics[f"eval/{variant}/reward"] * metrics[f"eval/{variant}/realism"]
            # Independent check: does a reader trained only on real singers name each piece's raga?
            from ragaz.reader import known, rank

            judged = [r for r in rows if r["variant"] == variant and r["raga"] in known()]
            if judged:
                metrics[f"eval/{variant}/reader_accuracy"] = sum(rank(RAGA_NOTES(r["notation"]))[:1] == [r["raga"]] for r in judged) / len(judged)
            metrics[f"eval/{variant}/distinct"] = len({r["notation"] for r in group}) / len(group)
            if self.ref_bars is not None:
                bars = [tuple(b) for r in group for b in parse(r["notation"]).bars]
                metrics[f"eval/{variant}/novel_bars"] = sum(b not in self.ref_bars for b in bars) / max(1, len(bars))
            metrics[f"eval/{variant}/copied_example"] = statistics.mean(r["copied"] for r in group)
            metrics[f"eval/{variant}/parseable"] = sum(r["scores"]["format"] > 0 for r in group) / len(group)
            for part in PARTS + (PARTS_V2 if self.cfg.reward_style in ("v2", "v3", "v4", "v5", "v6") else []) + (PARTS_V4 if self.cfg.reward_style in ("v4", "v5", "v6") else []) + (PARTS_V5 if self.cfg.reward_style in ("v5", "v6") else []) + (PARTS_LONG if self.cfg.reward_style in ("v5", "v6") and self.cfg.target_bars >= 16 else []):
                vals = [r["scores"][part] for r in group if part in r["scores"]]  # e.g. no register for Deshkar
                if vals:
                    metrics[f"eval/{variant}/{part}"] = statistics.mean(vals)
            for raga in self.ragas:
                metrics[f"eval/{variant}/raga/{raga.key}"] = statistics.mean(r["reward"] for r in group if r["raga"] == raga.key)
        metrics["eval/reward"] = statistics.mean(r["reward"] for r in rows)

        # Twin test: Bhupali and Deshkar share all five notes. A piece "knows" its raga if its
        # own raga's rules score it higher than its twin's.
        keys = {r.key for r in self.ragas}
        if {"bhupali", "deshkar"} <= keys:
            twin = {"bhupali": "deshkar", "deshkar": "bhupali"}
            for variant in ("bare", "hinted"):
                group = [r for r in rows if r["variant"] == variant and r["raga"] in twin]
                wins = [verify(r["notation"], r["raga"], style=cfg.reward_style, target_bars=cfg.target_bars).reward > verify(r["notation"], twin[r["raga"]], style=cfg.reward_style, target_bars=cfg.target_bars).reward for r in group]
                metrics[f"eval/{variant}/twin_accuracy"] = sum(wins) / len(wins)
                if f"eval/{variant}/real_score" in metrics:
                    # Picks checkpoints in runs with twins: v4 forgot Deshkar while score × realism stayed high.
                    metrics[f"eval/{variant}/real_twin_score"] = metrics[f"eval/{variant}/real_score"] * metrics[f"eval/{variant}/twin_accuracy"]

        # Best sample per (raga, variant): a table to read, and audio to hear (bare only, the real goal).
        table = []
        for raga, variant in specs:
            group = [r for r in rows if r["raga"] == raga.key and r["variant"] == variant]
            best = max(group, key=lambda r: r["reward"])
            table.append([raga.name, variant, round(best["reward"], 3), best["notation"], "; ".join(best["violations"])])
            if cfg.render_audio and variant == "bare" and best["reward"] > 0:
                path = self.run_dir / "audio" / f"step{self.step:05d}-{raga.key}.wav"
                try:
                    write_wav(path, render(best["notation"], raga))
                    self.tracker.log_audio(f"audio/{raga.key}", path, f"step {self.step} · {raga.name} · reward {best['reward']:.2f}", self.step)
                except ValueError:
                    pass
        self.tracker.log_table("eval/best_samples", ["raga", "variant", "reward", "notation", "violations"], table, self.step)
        return metrics

    # ------------------------------------------------------------ checkpoints

    def save_checkpoint(self, tag: str) -> Path:
        cfg = self.cfg
        path = self.run_dir / "checkpoints" / tag
        path.mkdir(parents=True, exist_ok=True)
        mx.save_safetensors(str(path / "adapters.safetensors"), dict(tree_flatten(self.model.trainable_parameters())))
        (path / "adapter_config.json").write_text(
            json.dumps(
                {
                    "fine_tune_type": "lora",
                    "num_layers": cfg.lora_layers,
                    "lora_parameters": {"rank": cfg.lora_rank, "scale": cfg.lora_scale, "dropout": cfg.lora_dropout},
                    "base_model": cfg.model,
                },
                indent=2,
            )
        )
        mx.save_safetensors(str(path / "optimizer.safetensors"), dict(tree_flatten(self.optimizer.state)))
        (path / "state.json").write_text(json.dumps({"step": self.step, "best_eval": self.best_eval}))
        return path

    def checkpoint(self, tag: str) -> None:
        path = self.save_checkpoint(tag)
        latest = self.run_dir / "checkpoints" / "latest"
        if path != latest:
            shutil.rmtree(latest, ignore_errors=True)
            shutil.copytree(path, latest)

    def load_checkpoint(self, path: Path) -> None:
        self.model.load_weights(list(mx.load(str(path / "adapters.safetensors")).items()), strict=False)
        self.optimizer.state = tree_unflatten(list(mx.load(str(path / "optimizer.safetensors")).items()))
        state = json.loads((path / "state.json").read_text())
        self.step, self.best_eval = state["step"], state["best_eval"]
        self.rng = random.Random(self.cfg.seed + self.step)
        print(f"resumed from {path} at step {self.step}")

    # ------------------------------------------------------------------- loop

    def run_eval(self) -> None:
        start = time.time()
        metrics = self.evaluate()
        metrics["time/eval_s"] = time.time() - start
        self.tracker.log(metrics, self.step)
        score = metrics[self.cfg.best_metric]
        print(
            f"[eval step {self.step}] bare {metrics['eval/bare/reward']:.3f} (good {metrics['eval/bare/good_rate']:.0%}, distinct {metrics['eval/bare/distinct']:.0%})"
            f" · hinted {metrics['eval/hinted/reward']:.3f} (good {metrics['eval/hinted/good_rate']:.0%}, distinct {metrics['eval/hinted/distinct']:.0%})"
            + (f" · twin {metrics['eval/bare/twin_accuracy']:.0%}" if "eval/bare/twin_accuracy" in metrics else "")
        )
        if score > self.best_eval:
            self.best_eval = score
            self.save_checkpoint("best")

    def train(self) -> None:
        cfg = self.cfg
        self.setup()
        print(f"run dir: {self.run_dir}")
        try:
            if not self.resuming:
                self.run_eval()  # step 0 = the baseline, on the same dashboard
            while self.step < cfg.steps:
                scale = self.governor.before_step()
                mx.reset_peak_memory()
                t0 = time.time()
                rows = self.rollout()
                t1 = time.time()
                stats = self.update(rows)
                t2 = time.time()
                self.step += 1

                rewards = [r["reward"] for r in rows]
                gen_tokens = sum(len(r["completion"]) for r in rows)
                metrics = {
                    **stats,
                    "train/reward": statistics.mean(rewards),
                    "train/reward_std": statistics.pstdev(rewards),
                    "train/reward_max": max(rewards),
                    "train/good_rate": sum(x > 0.8 for x in rewards) / len(rewards),
                    "train/copied_example": statistics.mean(r["copied"] for r in rows),
                    "train/distinct": statistics.mean(1 / r.get("dup_count", 1) for r in rows),
                    "train/novel_bars": statistics.mean(r["novel"] for r in rows),
                    "train/completion_len": gen_tokens / len(rows),
                    "train/truncated_frac": sum(r["truncated"] for r in rows) / len(rows),
                    "train/hint_prob": self.hint_probability(),
                    "train/hinted_frac": sum(r["variant"] == "hinted" for r in rows) / len(rows),
                    "train/lr": float(self.optimizer.learning_rate),
                    "time/rollout_s": t1 - t0,
                    "time/update_s": t2 - t1,
                    "time/gen_tokens_per_s": gen_tokens / max(1e-6, t1 - t0),
                    "memory/peak_gb": mx.get_peak_memory() / 2**30,
                    "memory/system_free_gb": psutil.virtual_memory().available / 2**30,
                    "memory/batch_scale": scale,
                    "memory/paused_s_total": self.governor.paused_s,
                }
                for part in PARTS + (PARTS_V2 if cfg.reward_style in ("v2", "v3", "v4", "v5", "v6") else []) + (PARTS_V4 if cfg.reward_style in ("v4", "v5", "v6") else []) + (PARTS_V5 if cfg.reward_style in ("v5", "v6") else []) + (PARTS_LONG if cfg.reward_style in ("v5", "v6") and cfg.target_bars >= 16 else []):
                    vals = [r["scores"][part] for r in rows if part in r["scores"]]
                    if vals:
                        metrics[f"train/{part}"] = statistics.mean(vals)
                for raga in self.ragas:
                    group = [r["reward"] for r in rows if r["raga"] == raga.key]
                    if group:
                        metrics[f"train/raga/{raga.key}"] = statistics.mean(group)
                self.tracker.log(metrics, self.step)
                print(
                    f"step {self.step:4d} | reward {metrics['train/reward']:.3f} ± {metrics['train/reward_std']:.3f}"
                    f" max {metrics['train/reward_max']:.2f} | kl {metrics.get('train/kl', 0):.4f}"
                    f" | len {metrics['train/completion_len']:.0f} | hint {metrics['train/hint_prob']:.2f}"
                    f" | {t1 - t0:.0f}s gen + {t2 - t1:.0f}s update | {metrics['memory/peak_gb']:.1f} GB"
                )

                if self.step % cfg.eval_every == 0 or self.step == cfg.steps:
                    self.run_eval()
                if self.step % cfg.save_every == 0 or self.step == cfg.steps:
                    self.checkpoint(f"step{self.step:05d}")
        except KeyboardInterrupt:
            print("\ninterrupted: saving checkpoint")
            self.checkpoint(f"step{self.step:05d}")
        finally:
            self.watchdog.stop()
            self.tracker.finish()
        print(f"done. checkpoints in {self.run_dir / 'checkpoints'} (best {self.cfg.best_metric} {self.best_eval:.3f})")


def train(config_path: str | None, overrides: list[str], resume: str | None) -> None:
    if resume:
        run_dir = Path(resume)
        cfg = GRPOConfig.load(run_dir / "config.yaml", overrides)
        GRPOTrainer(cfg, run_dir).train()
    else:
        GRPOTrainer(GRPOConfig.load(config_path, overrides)).train()
