"""Build (and optionally upload) the Hugging Face release of the newest composer.

    uv run python scripts/release_hf.py              # → out/release/<name>/, ready to inspect
    uv run python scripts/release_hf.py --upload     # then push it (needs `hf auth login`)

What goes in the repo:
  model.safetensors …   Qwen3-0.6B with the v6 LoRA merged in (mlx_lm fuse), standard HF format:
                        runs with transformers on any computer
  generation_config     the sampling the model was evaluated with
  mlx-adapter/          the 23 MB LoRA adapter alone, for MLX on a Mac
  ragaz-data/           what scoring and rendering need: real-singer profiles (v6 reward) and
                        the expression library (glides, wavers), both derived from CompMusic
  compose.py            a one-file script: `uv run <url>/compose.py yaman`
  README.md             the model card, its numbers taken from the run's own evaluation
"""

import argparse
import json
import shutil
import subprocess
from pathlib import Path

REPO = "dev-y/qwen3-0.6b-grpo-indian-classical-ragaz"
RUN = Path("runs/grpo/v6-grpo-20261106-0017")
STEP = 60
BASE = "mlx-community/Qwen3-0.6B-bf16"
OUT = Path("out/release") / REPO.split("/")[1]
GITHUB = "https://github.com/yadavdevv/ragaz-black"
SITE = "https://ragaz-black.vercel.app"

SCRIPT = f'''# /// script
# requires-python = ">=3.12"
# dependencies = ["ragaz[compose] @ git+{GITHUB}"]
# ///
"""Write a raga with ragaz, score it, and hear it.

    uv run https://huggingface.co/{REPO}/resolve/main/compose.py yaman
    uv run compose.py darbari -n 3 --out pieces

Downloads the model once (~1.2 GB), then writes each piece to a .txt (sargam notation) and a
.wav (sung over a tanpura). Ragas: bhupali yaman malkauns deshkar bhairav todi shuddh_sarang
madhuvanti marwa bihag darbari miyan_malhar basant.
"""

import argparse

from ragaz.compose import REPO, main

p = argparse.ArgumentParser()
p.add_argument("raga")
p.add_argument("-n", type=int, default=1)
p.add_argument("--out", default=".")
p.add_argument("--seed", type=int, default=None)
p.add_argument("--backend", choices=["auto", "transformers", "mlx"], default="auto")
p.add_argument("--no-wav", action="store_true")
a = p.parse_args()
main(a.raga, a.n, a.out, a.backend, REPO, a.seed, not a.no_wav)
'''


LICENSE = """ragaz: Qwen3-0.6B with the ragaz LoRA merged (and the LoRA alone, in mlx-adapter/)
Copyright (c) 2026 Devesh Yadav

The ragaz changes (the trained LoRA weights, merged or separate) are licensed under the Creative
Commons Attribution-NonCommercial 4.0 International licence (CC BY-NC 4.0):
https://creativecommons.org/licenses/by-nc/4.0/legalcode

The base model, Qwen3-0.6B by the Qwen Team, is licensed under the Apache License 2.0, a copy of
which is in LICENSE-Qwen3. See NOTICE.
"""

NOTICE = """This model is a modified version of Qwen3-0.6B (Qwen Team, Apache License 2.0,
https://huggingface.co/Qwen/Qwen3-0.6B; Qwen3 Technical Report, arXiv:2505.09388).

Modifications: LoRA adapters (rank 16, 16 layers) trained with supervised fine-tuning and GRPO
reinforcement learning to compose Hindustani ragas in sargam notation, then merged into the base
weights (mlx_lm fuse). The tokenizer and architecture are unchanged.

ragaz-data/ is derived from the Indian Art Music Raga Recognition Dataset (features), Gulati et al.,
doi:10.5281/zenodo.7278506, CC BY 4.0 (pitch tracks only). Please cite: S. Gulati, J. Serra,
K. K. Ganguli, S. Senturk, X. Serra, "Time-delayed melody surfaces for raga recognition", ISMIR 2016;
and S. Gulati, J. Serra, V. Ishwar, S. Senturk, X. Serra, "Phrase-based raga recognition using
vector space modeling", ICASSP 2016.
"""


def card() -> str:
    latest = json.loads(Path("web/public/data/latest.json").read_text())
    e, conc, b = latest["eval"], latest["concerts"], latest["baseline"]
    ragas = ", ".join(r["name"] for r in latest["ragas"])
    example = next(p for p in sorted(latest["pieces"], key=lambda p: -p["reward"]) if p["raga"] == "yaman")["notation"]
    return f"""---
license: cc-by-nc-4.0
base_model: Qwen/Qwen3-0.6B
library_name: transformers
pipeline_tag: text-generation
language:
- en
tags:
- music
- indian-classical-music
- hindustani-music
- raga
- symbolic-music
- music-generation
- grpo
- reinforcement-learning
- lora
- qwen3
- mlx
---

# ragaz: Qwen3-0.6B, taught Hindustani ragas with GRPO

A 0.6-billion-parameter language model that composes **Hindustani classical melodies in a raga from nothing but the raga's name**, written in sargam notation. Trained on a MacBook with reinforcement learning (GRPO) where the raga's grammar, and measurements of real concert singers, are the reward.

**Listen first: [{SITE.removeprefix("https://")}]({SITE})** · code: [{GITHUB.removeprefix("https://")}]({GITHUB})

## Use it

**One line** (with [uv](https://docs.astral.sh/uv/)): writes a piece, scores it, and saves a WAV sung over a tanpura.

```bash
uv run https://huggingface.co/{REPO}/resolve/main/compose.py yaman
```

**As a command:**

```bash
pip install "ragaz[compose] @ git+{GITHUB}"
ragaz compose darbari -n 3 --out pieces      # --backend mlx on a Mac with mlx-lm
```

**With transformers directly** (the model expects exactly this prompt; thinking off):

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
from ragaz.notation import extract
from ragaz.prompts import build_prompt
from ragaz.ragas import get_raga

tok = AutoTokenizer.from_pretrained("{REPO}")
model = AutoModelForCausalLM.from_pretrained("{REPO}")
messages = [{{"role": "user", "content": build_prompt(get_raga("yaman"), "bare", bars=16, rhythm=True)}}]
inputs = tok.apply_chat_template(messages, add_generation_prompt=True, enable_thinking=False, return_dict=True, return_tensors="pt")
out = model.generate(**inputs, max_new_tokens=320, do_sample=True, temperature=0.8, top_p=0.95, top_k=0)
print(extract(tok.decode(out[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True)))  # the first code block
```

On a Mac, `mlx-adapter/` holds the LoRA alone (23 MB) for `{BASE}`.

## What it writes

Sixteen bars of teentaal, four beats a bar, in sargam: uppercase notes are natural, lowercase flat (komal), `M` is tivra Ma, a dot before a note means the lower octave (`.N`) and an apostrophe after it the upper (`S'`), `-` holds a note, several notes in one beat are written together. A Yaman by this model:

```
{example}
```

Ragas: {ragas}.

## Before and after training

The same test, asked the same way (the raga's name only; the prompt's format example is a line in another raga, Durga, with "do not copy its notes"), judged by the same programs:

| | Qwen3-0.6B, untrained | This model |
|---|---|---|
| Pieces that are the prompt's example line | {b["copied_example"]:.0%} | {e["copied_pieces"]:.0%} |
| Named as the raga asked for (independent reader) | {b["reader_accuracy"]:.0%} | {e["reader_accuracy"]:.0%} |
| Pieces using only the raga's notes | {b["no_wrong_notes"]:.0%} | {e["no_wrong_notes"]:.0%} |
| Wrote the 16 bars asked for | {b["sixteen_bars"]:.0%} | {e["sixteen_bars"]:.0%} |
| Mean reward (v6, 0–1) | {b["reward"]:.3f} | {e["reward"]:.2f} |

## How good it is

From the training run's own evaluation ({latest["pieces"].__len__()} pieces, {len(latest["pieces"]) // len(latest["ragas"])} per raga, name-only prompts):

| | |
|---|---|
| Named as the raga asked for, by a reader trained only on real singers | {e["reader_accuracy"]:.0%} |
| Pieces using only the raga's notes | {e["no_wrong_notes"]:.0%} |
| Bars that appear in none of the examples it was shown | {e["novel_bars"]:.0%} |
| Mean reward (v6, 0–1) | {e["reward"]:.2f} |

The reward's style terms were built from {conc["recordings"]} concert recordings across {conc["ragas"]} ragas ({conc["held_out"]} held out). The merged weights here reproduce it: 26 fresh pieces with transformers scored a mean of 0.58, all with only the raga's notes.

## How it was trained

GRPO (eight attempts per prompt, advantage = reward minus the group mean, over its spread) with LoRA (rank 16, 16 layers) on MLX. Supervised steps taught what RL couldn't discover: a raga's notes when no attempt ever stumbled on them, and real singers' phrases before learning new ragas. The reward multiplies hard rules (valid notation, no forbidden note, four beats a bar, variety, length, rhythm) by a weighted sum of style terms measured against real singers (cycles, note ranking, signature phrase, mined phrases, melodic motion, register). Full story, every stage, and how the reward was cheated and fixed: [{SITE.removeprefix("https://")}/docs]({SITE}/docs).

## Limitations

- Notes only: no lyrics, and the notation has no symbols for ornaments (meend, gamak). The site's recordings add them from measurements of real singers.
- Metered teentaal only; no alap.
- The raga rules follow standard Bhatkhande descriptions and have not been reviewed by a musician. Deshkar has no concert recordings behind it.
- Judged by a program and a reader, not by an expert's ear.

## Licence and credits

The ragaz changes are released under **CC BY-NC 4.0** (non-commercial; `LICENSE`). This is a modified version of [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), whose licence, Apache-2.0, is in `LICENSE-Qwen3`; what changed is in `NOTICE`. The reward, the reader and `ragaz-data/` are derived from the **Indian Art Music Raga Recognition Dataset** (features), Gulati et al., doi:10.5281/zenodo.7278506, CC BY 4.0: pitch tracks only, no audio.

## Citation

```bibtex
@software{{yadav2026ragaz,
  author = {{Yadav, Devesh}},
  title  = {{ragaz: a small language model taught to compose Hindustani ragas with GRPO}},
  year   = {{2026}},
  url    = {{{GITHUB}}}
}}
```

Please also cite the data it learned from:

- S. Gulati, J. Serrà, K. K. Ganguli, S. Şentürk, X. Serra. *Time-delayed melody surfaces for rāga recognition.* ISMIR 2016, pp. 751–757.
- S. Gulati, J. Serrà, V. Ishwar, S. Şentürk, X. Serra. *Phrase-based rāga recognition using vector space modeling.* IEEE ICASSP 2016, pp. 66–70.
- Qwen Team. *Qwen3 Technical Report.* arXiv:2505.09388, 2025.
"""


def build() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if not (OUT / "model.safetensors").exists():
        subprocess.run(["python", "-m", "mlx_lm", "fuse", "--model", BASE, "--adapter-path", str(RUN / "checkpoints" / f"step{STEP:05d}"), "--save-path", str(OUT)], check=True)
    (OUT / "generation_config.json").write_text(json.dumps({"do_sample": True, "temperature": 0.8, "top_p": 0.95, "top_k": 0, "max_new_tokens": 320}, indent=1))
    (OUT / "mlx-adapter").mkdir(exist_ok=True)
    for f in ("adapters.safetensors", "adapter_config.json"):
        shutil.copy(RUN / "checkpoints" / f"step{STEP:05d}" / f, OUT / "mlx-adapter" / f)
    (OUT / "ragaz-data").mkdir(exist_ok=True)
    for f in ("real_profiles_v6.json", "expression.json"):
        shutil.copy(Path("data") / f, OUT / "ragaz-data" / f)
    (OUT / "compose.py").write_text(SCRIPT)
    # Licences: ours (CC BY-NC 4.0) for the changes, and Qwen3's Apache-2.0, which a modified version must carry.
    (OUT / "LICENSE").write_text(LICENSE)
    (OUT / "NOTICE").write_text(NOTICE)
    shutil.copy("licenses/Qwen3-Apache-2.0.txt", OUT / "LICENSE-Qwen3")
    (OUT / "README.md").write_text(card())
    size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1e9
    print(f"built {OUT} ({size:.2f} GB)")


def upload() -> None:
    from huggingface_hub import HfApi

    api = HfApi()
    api.create_repo(REPO, repo_type="model", exist_ok=True)
    api.upload_folder(repo_id=REPO, folder_path=str(OUT), commit_message="ragaz v6: Qwen3-0.6B + GRPO LoRA, merged")
    print(f"uploaded https://huggingface.co/{REPO}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true")
    a = ap.parse_args()
    build()
    if a.upload:
        upload()
