# ragaz

[![license](https://img.shields.io/github/license/yadavdevv/ragaz-black?label=license)](LICENSE)
[![demo](https://img.shields.io/badge/demo-ragaz--black.vercel.app-B23A22?logo=vercel&logoColor=white)](https://ragaz-black.vercel.app/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-4c1)](https://github.com/yadavdevv/ragaz-black/pulls)
[![last commit](https://img.shields.io/github/last-commit/yadavdevv/ragaz-black?label=last%20commit)](https://github.com/yadavdevv/ragaz-black/commits/main)
[![stars](https://img.shields.io/github/stars/yadavdevv/ragaz-black?style=flat&label=stars)](https://github.com/yadavdevv/ragaz-black/stargazers)

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

**Live site: [ragaz-black.vercel.app](https://ragaz-black.vercel.app/)**: hum to it and it names your raga and answers in it; hear how it learned, stage by stage; listen to every piece; play the instruments; compose and get scored by a reward it was trained with.

---

## What it is

Qwen3-0.6B, adapted with LoRA, learns to write ragas in sargam notation (`S R G P | G R S - | …`) from nothing but the raga's name. A verifier scores every piece against the raga's rules and against measurements of real concert singers; GRPO pushes the model toward whatever scores higher. Supervised fine-tuning fills in the facts reinforcement learning cannot discover on its own.

Ragas (13, a full day and the seasons): **Bhairav** (dawn), **Todi**, **Deshkar**, **Shuddh Sarang** (midday), **Madhuvanti**, **Marwa** (sunset), **Yaman**, **Bhupali**, **Bihag**, **Darbari** (midnight), **Malkauns**, **Miyan Malhar** (the monsoon), **Basant** (spring). Deshkar shares Bhupali's five notes; only emphasis and movement tell them apart.

On the site:
- **Sing to it:** hum over the tanpura; your line is written as sargam, read for its raga (with the notes that gave it away), and answered in that raga. Pitch tracking and the reading run in the browser.
- **Ragas:** the 13 around the clock, each with its rules, its signature phrase, a real singer's line, the newest model's piece sung, and (for Bhupali, Yaman, Malkauns) the same raga from five stages of training; below them, every piece it wrote.
- **Compose:** write a melody in a raga, beat by beat, and get scored as you type.
- **Instruments:** harmonium, tanpura, tabla, sitar, santoor, swarmandal, bansuri, shehnai, sarangi, all synthesised and playable in any raga.
- **Docs:** a guide to every page, and how everything is measured.

## What we found

| | |
|---|---|
| **Every reward gets hacked.** | One note repeated, octave hopping, copying the prompt's example, 32-bar loops, one answer for every raga, bars chopped to 1–3 beats. Each was real, each looked like progress in the curves, and each led to a new term. The lesson: **hard rules must multiply**; anything in a weighted sum gets traded away. |
| **RL can't teach a fact.** | Asked for Malkauns by name, the model never stumbled on its notes, so every attempt scored zero for 100 steps. Fine-tuning on a few hundred good examples fixed it in 30 steps (0.00 → 0.82). |
| **Rules aren't music.** | Trained on textbook rules (v1), the model rested on Sa 7–13% of the time; real singers do 35–38%. Re-grounding the reward in 30 CompMusic concert recordings (v2) brought it to 36% / 21% / 39%. |
| **Facts first, again (v6).** | Asked for nine new ragas with their notes in the prompt, v5e still wrote Bhupali (288 of 288). Taught from real singers' own phrases first, then GRPO: a reader trained only on real singers (never a reward) names the right raga for **100%** of name-only pieces; Bhupali/Deshkar twin test 100%, no forbidden notes, realism 0.89. |
| **The reader hears ragas everywhere.** | From 10 s of singing it names the raga of held-out concerts 82% of the time (top 3: 97%, 12 ragas), calibrated. Played tunes from elsewhere: Amazing Grace is Bhupali, the Lydian mode Yaman, the Byzantine scale Bhairav, the blues' pentatonic Malkauns. |
| **Words and notes together** (an experiment, not on the site). | A bandish model writes notes and words in one Bhatkhande layout. Giving it the syllables raised fidelity to the words from 0.77 to 0.94; the mukhda lands on sam in 25 of 26 site bandishes. Its own words still mean nothing, so only real verse is shown. GRPO added nothing here. |
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
- **Training recipe:** GRPO with the rules in the prompt → distil its good pieces → SFT on name-only prompts → GRPO with the real-music reward → 16-bar SFT → GRPO (v5e) → real singers' phrases taught first, thirteen ragas, GRPO (v6).

**The voices.** Notation is rendered with glides and wavers learned from real singers' pitch curves (`expression.py`), then synthesised either as a flute or with a **DDSP voice** (Engel et al., 2020). The site's recordings use `hvocal`, trained on vocals separated (Demucs) from 16 Hindustani concerts in Saraga 1.5 (a short run); an earlier `vocal` used Saraga Carnatic vocal stems. The DDSP model is given only pitch and loudness, so every note it sings is the composer's.

**Performed like a singer** (`render.performance`, `ragaz render --perform`). Measured with the same transcriber on 30 concerts and on the newest pieces (`scripts/real_vs_ours.py`), the written pieces sat on their notes (11% of sung time between notes vs 19%), wobbled less (10 vs 13 cents) and paused half as often (19 vs 37 a minute). The renderer now breathes after held notes and at bar lines, adds kan grace notes, slower glides, more wobble, a slow drift and small timing shifts, arcs the loudness across each phrase, and adds an audible breath and room tone: 17%, 13.5 cents and 40 pauses a minute.

## Quick start

```bash
uv sync
uv run pytest -q

uv run ragaz ragas                                           # the raga rules
uv run ragaz verify examples/yaman.txt --raga yaman          # score a piece
uv run ragaz render examples/yaman.txt --raga yaman -o out/yaman.wav --expressive --play
uv run --extra voice ragaz render out/v6-yaman.txt --raga yaman --tempo 90 --voice hvocal --perform -o out/yaman-vocal.wav
uv run --extra voice python scripts/render_site.py               # the site's recordings and the evolution set
uv run python scripts/export_web.py                              # → web/public/data, web/public/audio

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
  verify.py       the reward (v1 … v6)
  realprofile.py  style measured from real recordings (profile, motion, phrases, register, rhythm)
  transcribe.py   pitch track → held notes
  expression.py   glides and wavers learned from singers, for rendering
  render.py       synth: just intonation, tanpura with jawari, expressive pitch, performance (breaths, kan, dynamics)
  ddsp.py         learned instrument voices (violin, vocal, hvocal)
  grpo.py         group advantages, duplicate penalty, loss
  trainer.py      GRPO loop on MLX;  sft.py / distill.py  supervised steps
  watchdog.py     memory guard
configs/          one YAML per run (smoke … v6)
scripts/          data fetch, analyses, export_web.py (site data)
tests/
web/              the website (Next.js) — see web/README.md
```

## Data and credits

- **CompMusic Indian Art Music Raga Recognition Dataset** (features), Gulati et al., Zenodo 10.5281/zenodo.7278506, CC BY 4.0: pitch tracks and resting-note annotations of concert recordings in 12 ragas (118 used for the v6 reward, 36 of them held out) for the real-music reward and the Sing-to-it reader. Only pitch tracks, never audio.
- **Hindi Wikisource** transcriptions (CC BY-SA 4.0) of public-domain editions: Surdas's *Bhramargeet-saar* (ed. Ramchandra Shukla), *Kabir Granthavali* (ed. Shyamsundar Das), *Bihari-Ratnakar* (ed. Jagannathdas Ratnakar), *Rahim-Kavitavali*: the bandish texts for the words experiments (not on the site), cleaned by `scripts/build_lyrics_corpus.py`.
- **Saraga 1.5** (Zenodo 10.5281/zenodo.4301737), **CC BY-NC-SA 4.0** (research, non-commercial): Hindustani concert mixes, vocals separated with Demucs (MIT), for the `hvocal` voice on the site; Carnatic vocal and violin stems for the earlier voices.
- **Ragamala paintings** on the site: The Metropolitan Museum of Art and The Cleveland Museum of Art (CC0), Rijksmuseum and Honolulu Museum of Art (public domain), Victoria and Albert Museum (non-commercial). Three ragas (Madhuvanti, Marwa, Bihag) have no ragamala; their stand-ins say so on the site.
- Raga rules from standard Bhatkhande descriptions; **not yet reviewed by a musician**.
