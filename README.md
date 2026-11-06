# ragaz

[![license](https://img.shields.io/github/license/yadavdevv/ragaz?label=license)](LICENSE)
[![demo](https://img.shields.io/badge/demo-ragaz--black.vercel.app-B23A22?logo=vercel&logoColor=white)](https://ragaz-black.vercel.app/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-4c1)](https://github.com/yadavdevv/ragaz/pulls)
[![last commit](https://img.shields.io/github/last-commit/yadavdevv/ragaz?label=last%20commit)](https://github.com/yadavdevv/ragaz/commits/main)
[![stars](https://img.shields.io/github/stars/yadavdevv/ragaz?style=flat&label=stars)](https://github.com/yadavdevv/ragaz/stargazers)

![Qwen3](https://img.shields.io/badge/Qwen3-0.6B-615CED)
![MLX](https://img.shields.io/badge/MLX-Apple%20silicon-000000?logo=apple&logoColor=white)
![GRPO](https://img.shields.io/badge/GRPO-LoRA-B23A22)
![Python](https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white)
![PyTorch](https://img.shields.io/badge/DDSP-PyTorch-EE4C2C?logo=pytorch&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Web Audio](https://img.shields.io/badge/Web%20Audio-synth-A8853C)

**A small language model that composes Hindustani ragas, trained on a MacBook with reinforcement learning where the raga's grammar is the reward.**

**Live site: [ragaz-black.vercel.app](https://ragaz-black.vercel.app/)**: listen to its pieces, play the instruments, compose and get scored by the same reward that trained it.

---

## What it is

Qwen3-0.6B, adapted with LoRA, learns to write ragas in sargam notation (`S R G P | G R S - | …`) from nothing but the raga's name. A verifier scores every piece against the raga's rules and against measurements of real concert singers; GRPO pushes the model toward whatever scores higher. Supervised fine-tuning fills in the facts reinforcement learning cannot discover on its own.

Ragas (13, a full day and the seasons): **Bhairav** (dawn), **Todi**, **Deshkar**, **Shuddh Sarang** (midday), **Madhuvanti**, **Marwa** (sunset), **Yaman**, **Bhupali**, **Bihag**, **Darbari** (midnight), **Malkauns**, **Miyan Malhar** (the monsoon), **Basant** (spring). Deshkar shares Bhupali's five notes; only emphasis and movement tell them apart.

On the site:
- **Sing to it:** hum over the tanpura; your line is written as sargam, read for its raga (with the notes that gave it away), and answered in that raga. Pitch tracking and the reading run in the browser.
- **Words:** any text, in any script, set in a raga the way a bandish sets its words; and bandishes the model composed for real verse (Kabir, Surdas, Bihari), words under the notes as Bhatkhande prints them.

## What we found

| | |
|---|---|
| **Every reward gets hacked.** | One note repeated, octave hopping, copying the prompt's example, 32-bar loops, one answer for every raga, bars chopped to 1–3 beats. Each was real, each looked like progress in the curves, and each led to a new term. The lesson: **hard rules must multiply**; anything in a weighted sum gets traded away. |
| **RL can't teach a fact.** | Asked for Malkauns by name, the model never stumbled on its notes, so every attempt scored zero for 100 steps. Fine-tuning on a few hundred good examples fixed it in 30 steps (0.00 → 0.82). |
| **Rules aren't music.** | Trained on textbook rules (v1), the model rested on Sa 7–13% of the time; real singers do 35–38%. Re-grounding the reward in 30 CompMusic concert recordings (v2) brought it to 36% / 21% / 39%. |
| **Facts first, again (v6).** | Asked for nine new ragas with their notes in the prompt, v5e still wrote Bhupali (288 of 288). Taught from real singers' own phrases first, then GRPO: a reader trained only on real singers (never a reward) names the right raga for **100%** of name-only pieces; Bhupali/Deshkar twin test 100%, no forbidden notes, realism 0.89. |
| **The reader hears ragas everywhere.** | From 10 s of singing it names the raga of held-out concerts 82% of the time (top 3: 97%, 12 ragas), calibrated. Played tunes from elsewhere: Amazing Grace is Bhupali, the Lydian mode Yaman, the Byzantine scale Bhairav, the blues' pentatonic Malkauns. |
| **Words and notes together.** | A bandish model writes notes and words in one Bhatkhande layout. Giving it the syllables raised fidelity to the words from 0.77 to 0.94; the mukhda lands on sam in 25 of 26 site bandishes. Its own words still mean nothing, so only real verse is shown. GRPO added nothing here. |
| **Closer to performance (v5e).** | 16-bar pieces with a sthayi → antara arc; ~34% of time in the upper octave (real singers 19–46%; v4: 0%); uneven runs and holds (duration CV 1.24, real 1.47; v4 0.40); median note 0.21 s (real 0.21 s). |

The full experiment log, run by run, is in the project notes (`ideas/ragaz/experiments.md` in the parent workspace).

## How it works

```
prompt ("Compose a raga: Bhupali")
  → Qwen3-0.6B + LoRA (MLX)          writes 8–16 bars of sargam
  → verifier (src/ragaz/verify.py)    rules × real-music style = reward in [0, 1]
  → GRPO                              8 answers per prompt; advantage = (r − group mean) / std
```

**The reward (v5).** Hard gates multiply; style is a weighted sum; rhythm scales the whole:

```
reward = format · purity · beats² · variety · length
         · (0.15 tala + 0.15 rank + 0.15 pakad + 0.30 phrases + 0.10 motion + 0.15 register)   [+ arc for 16+ bars]
         · (0.4 + 0.6 · rhythm)
```

- **Rules:** notes allowed in the raga, 4 beats per bar, whole Teentaal cycles, ending on Sa or a resting note, the most important notes in the right rank, the signature phrase (pakad).
- **Measured from real singers** (CompMusic pitch tracks, held-out recordings for evaluation): 4-note phrases mined per raga, melodic step sizes, time per octave (register), and rhythm shape.
- **Training recipe:** GRPO with the rules in the prompt → distil its good pieces → SFT on name-only prompts → GRPO with the real-music reward → 16-bar SFT → GRPO (v5e).

**The voices.** Notation is rendered with glides and wavers learned from real singers' pitch curves (`expression.py`), then synthesised either as a flute or with a **DDSP voice** (Engel et al., 2020) trained on 65 minutes of separately miked vocal tracks of 12 women singers from Saraga Carnatic. The DDSP model is given only pitch and loudness, so every note it sings is the composer's.

## Quick start

```bash
uv sync
uv run pytest -q

uv run ragaz ragas                                           # the raga rules
uv run ragaz verify examples/yaman.txt --raga yaman          # score a piece
uv run ragaz render examples/yaman.txt --raga yaman -o out/yaman.wav --expressive --play
uv run --extra voice ragaz render out/v5e-yaman.txt --raga yaman --tempo 90 --voice vocal -o out/yaman-vocal.wav

uv run ragaz baseline …                                      # sample an untrained model and score it
uv run ragaz train configs/v5e-long-grpo.yaml                # GRPO (LoRA, MLX)
uv run ragaz distill …  /  uv run ragaz sft configs/v5-sft-long.yaml
```

Training is memory-guarded (`watchdog.py`): runs stay around 3–5 GB on a 24 GB M4 Pro.

**Data (fetched, not committed):**
```bash
uv run python scripts/fetch_compmusic.py      # CompMusic raga features (pitch tracks + tonic), HTTP range reads
uv run python -m ragaz.realprofile            # → data/real_profiles.json (the real-music reward)
uv run python -m ragaz.expression             # → data/expression.json (glides and wavers)
uv run python scripts/fetch_vocal.py          # Saraga vocal stems
uv run --extra voice python -m ragaz.ddsp prepare vocal
uv run --extra voice python -m ragaz.ddsp train 6000 vocal
```

## Notation

```
S R G M P D N     shuddh (M = tivra Ma)        .S  lower octave
r g m d n         komal  (m = shuddh Ma)       S'  upper octave
-                 hold one more beat           |   bar line (or newline)
GR                two notes in one beat
```
One Teentaal cycle is 4 bars of 4 beats: `G R S .D | S R G - | P G D P | G R S - |`

## Layout

```
src/ragaz/
  ragas.yaml      raga rules (notes, vadi/samvadi, nyas, pakad, time, tanpura)
  notation.py     sargam parser; extracting notation from model replies
  verify.py       the reward (v1 … v5)
  realprofile.py  style measured from real recordings (profile, motion, phrases, register, rhythm)
  transcribe.py   pitch track → held notes
  expression.py   glides and wavers learned from singers, for rendering
  render.py       synth: just intonation, tanpura with jawari, expressive pitch
  ddsp.py         learned instrument voices (violin, vocal)
  grpo.py         group advantages, duplicate penalty, loss
  trainer.py      GRPO loop on MLX;  sft.py / distill.py  supervised steps
  watchdog.py     memory guard
configs/          one YAML per run (smoke … v5e)
scripts/          data fetch, analyses, export_web.py (site data)
tests/
web/              the website (Next.js) — see web/README.md
```

## Data and credits

- **CompMusic Indian Art Music Raga Recognition Dataset** (features), Gulati et al., Zenodo 10.5281/zenodo.7278506, CC BY 4.0: pitch tracks and resting-note annotations of 120 concert recordings (12 ragas) for the real-music reward and the Sing-to-it reader.
- **Hindi Wikisource** transcriptions (CC BY-SA 4.0) of public-domain editions: Surdas's *Bhramargeet-saar* (ed. Ramchandra Shukla), *Kabir Granthavali* (ed. Shyamsundar Das), *Bihari-Ratnakar* (ed. Jagannathdas Ratnakar), *Rahim-Kavitavali*: the bandish texts, cleaned by `scripts/build_lyrics_corpus.py`.
- **Saraga 1.5 Carnatic** multitrack, Zenodo 10.5281/zenodo.4301737, **CC BY-NC-SA 4.0** (research, non-commercial): vocal and violin stems for the DDSP voices.
- **Ragamala paintings** on the site: The Metropolitan Museum of Art (CC0), Rijksmuseum (public domain), Victoria and Albert Museum (non-commercial).
- Raga rules from standard Bhatkhande descriptions; **not yet reviewed by a musician**.
