"""Compose with the released model, on any computer: write a raga, score it, hear it.

    pip install "ragaz[compose] @ git+https://github.com/yadavdevv/ragaz-black"
    ragaz compose yaman                     # one piece → ragaz-yaman-1.txt / .wav
    ragaz compose bhairav -n 3 --out pieces

The model (Qwen3-0.6B + the v6 LoRA, merged) comes from Hugging Face on first use and is cached.
It is asked exactly as it was evaluated: only the raga's name, 16 bars, with the rhythm hint,
sampled at temperature 0.8, top-p 0.95. Each piece is scored with the v6 reward and rendered as
a WAV: a plain sung line over a tanpura, performed with breaths and ornaments measured from real
singers. On a Mac with mlx-lm installed, `--backend mlx` runs the same model natively.
"""

import os
from pathlib import Path

REPO = "dev-y/qwen3-0.6b-grpo-indian-classical-ragaz"
BARS, TEMP, TOP_P, MAX_TOKENS = 16, 0.8, 0.95, 320


def _data(repo: str, name: str, env: str) -> None:
    """Point ragaz at its data file: the local copy if this is the repo, else the model repo's."""
    if os.environ.get(env) or Path(f"data/{name}").exists():
        return
    from huggingface_hub import hf_hub_download

    os.environ[env] = hf_hub_download(repo, f"ragaz-data/{name}")


class Composer:
    def __init__(self, repo: str = REPO, backend: str = "auto"):
        self.repo = repo
        if backend == "auto":
            try:
                import mlx_lm  # noqa: F401

                backend = "mlx"
            except ImportError:
                backend = "transformers"
        self.backend = backend
        if backend == "mlx":
            from huggingface_hub import snapshot_download
            from mlx_lm import load

            path = repo if Path(repo).is_dir() else snapshot_download(repo, allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "*.jinja"], ignore_patterns=["mlx-adapter/*"])
            self.model, self.tokenizer = load(path)
        else:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer

            self.tokenizer = AutoTokenizer.from_pretrained(repo)
            device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
            self.model = AutoModelForCausalLM.from_pretrained(repo, torch_dtype=torch.bfloat16 if device != "cpu" else torch.float32).to(device).eval()
            self.device = device

    def write(self, raga_key: str, seed: int | None = None) -> str:
        """One piece of notation, from the raga's name alone."""
        from ragaz.notation import extract
        from ragaz.prompts import chat_prompt
        from ragaz.ragas import get_raga

        ids = chat_prompt(self.tokenizer, get_raga(raga_key), "bare", BARS, rhythm=True)
        # transformers 5 hands back an encoding rather than a list of ids
        ids = ids["input_ids"] if isinstance(ids, dict) or hasattr(ids, "keys") else getattr(ids, "ids", ids)
        ids = list(ids[0]) if ids and isinstance(ids[0], list) else list(ids)
        if self.backend == "mlx":
            import mlx.core as mx
            from mlx_lm import generate
            from mlx_lm.sample_utils import make_sampler

            if seed is not None:
                mx.random.seed(seed)
            text = generate(self.model, self.tokenizer, prompt=ids, max_tokens=MAX_TOKENS, sampler=make_sampler(temp=TEMP, top_p=TOP_P), verbose=False)
        else:
            import torch

            if seed is not None:
                torch.manual_seed(seed)
            inp = torch.tensor([ids], device=self.device)
            with torch.no_grad():
                out = self.model.generate(inp, attention_mask=torch.ones_like(inp), max_new_tokens=MAX_TOKENS, do_sample=True, temperature=TEMP, top_p=TOP_P, top_k=0, pad_token_id=self.tokenizer.eos_token_id)
            text = self.tokenizer.decode(out[0, inp.shape[1] :], skip_special_tokens=True)
        return extract(text)


def score(notation: str, raga_key: str, repo: str = REPO):
    """The v6 reward and its parts (scored against real singers where the raga has recordings)."""
    _data(repo, "real_profiles_v6.json", "RAGAZ_PROFILES_V6")
    from ragaz.verify import verify

    return verify(notation, raga_key, style="v6", target_bars=BARS)


def sing(notation: str, raga_key: str, path: str | Path, repo: str = REPO, tempo: float = 90) -> None:
    """A WAV: the line sung by the plain synth over a tanpura, performed like a singer."""
    _data(repo, "expression.json", "RAGAZ_EXPRESSION")
    from ragaz.ragas import get_raga
    from ragaz.render import render, write_wav

    write_wav(path, render(notation, get_raga(raga_key), sa_hz=261.63, tempo=tempo, expressive=True, perform=True))


def main(raga: str, n: int = 1, out: str = ".", backend: str = "auto", repo: str = REPO, seed: int | None = None, wav: bool = True) -> None:
    from ragaz.ragas import load_ragas

    ragas = load_ragas()
    if raga not in ragas:
        raise SystemExit(f"unknown raga {raga!r}; try one of: {', '.join(sorted(ragas))}")
    print(f"loading {repo} ({backend})…", flush=True)
    c = Composer(repo, backend)
    Path(out).mkdir(parents=True, exist_ok=True)
    for i in range(1, n + 1):
        notation = c.write(raga, None if seed is None else seed + i)
        report = score(notation, raga, repo)
        stem = Path(out) / f"ragaz-{raga}-{i}"
        stem.with_suffix(".txt").write_text(notation + "\n")
        print(f"\n{ragas[raga].name} #{i}  ·  score {report.reward:.2f}" + (f"  ·  {report.violations[0]}" if report.violations else ""))
        print(notation)
        if wav:
            sing(notation, raga, stem.with_suffix(".wav"), repo)
            print(f"→ {stem}.txt, {stem}.wav")
