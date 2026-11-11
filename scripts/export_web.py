"""Export real run data as static JSON for the web experience (web/public/data/).

Every number the site shows comes from here, and every piece carries the run
and step it came from. Pieces are re-scored with the v2 (real-grounded)
verifier so the page can show one reward equation for all of them; the reward
they got during training is kept as ``train_reward``.

    uv run python scripts/export_web.py
"""

import json
import statistics
from collections import Counter
from pathlib import Path

from ragaz.notation import parse
from ragaz.ragas import SWARAS, load_ragas
from ragaz.realprofile import load_profiles, pc_distribution
from ragaz.verify import WEIGHTS_V2, verify

RUNS = Path("runs/grpo")
OUT = Path("web/public/data")

# (label shown on the page, run dir, eval step)
MODELS = [
    ("v2", "track-b-v2-20261008-2148", 20),  # closest to real (see experiments.md)
    ("v1", "track-b-v1-20261008-0122", 100),
    ("sft", "track-b-v1-20261008-0122", 0),  # step 0 of v1 = the Track B SFT model, before any v1 GRPO
]

DEVANAGARI = {"bhupali": "भूपाली", "yaman": "यमन", "malkauns": "मालकौंस", "deshkar": "देशकार"}
# Hours (local, 24h) the raga is traditionally sung, for the raga clock.
HOURS = {"bhupali": [19, 22], "yaman": [18, 21], "malkauns": [0, 3]}


def raga_entry(r) -> dict:
    return {
        "key": r.key,
        "name": r.name,
        "devanagari": r.devanagari or DEVANAGARI.get(r.key, r.name),
        "thaat": r.thaat,
        "notes": sorted(SWARAS.index(s) for s in r.notes),
        "swaras": [s for s in SWARAS if s in r.notes],
        "vadi": r.vadi,
        "samvadi": r.samvadi,
        "nyas": sorted(r.nyas, key=SWARAS.index),
        "pakad": r.pakad,
        "time": r.time,
        # Seasonal ragas (Malhar, Basant) have no clock hours: the raga clock leaves them out.
        "hours": list(r.hours) if r.hours else None if r.season else HOURS.get(r.key, [6, 9]),
        "season": r.season,
        "rasa": r.rasa,
        "tanpura": r.tanpura,
    }


def piece_entry(row: dict, label: str, run: str, ragas: dict) -> dict:
    raga = ragas[row["raga"]]
    comp = parse(row["notation"])
    report = verify(row["notation"], raga, style="v2")
    return {
        "id": f"{label}-{row['raga']}-{row['_i']:02d}",
        "model": label,
        "run": run,
        "step": row["step"],
        "raga": row["raga"],
        "notation": row["notation"],
        "notes": [
            {"s": n.swara, "o": n.octave, "t": round(n.start, 4), "d": round(n.duration, 4), "bar": n.bar, "ok": n.swara in raga.notes}
            for n in comp.notes
        ],
        "beats": comp.beats,
        "reward": round(report.reward, 4),
        "scores": {k: round(v, 4) for k, v in report.scores.items()},
        "violations": report.violations,
        "train_reward": round(row["reward"], 4),
    }


def rescore(notation: str, raga) -> dict:
    report = verify(notation, raga, style="v2")
    comp = parse(notation)
    return {
        "notes": [{"s": n.swara, "o": n.octave, "t": round(n.start, 4), "d": round(n.duration, 4), "bar": n.bar, "ok": n.swara in raga.notes} for n in comp.notes],
        "beats": comp.beats,
        "bars": len(comp.bars),
        "reward_now": round(report.reward, 4),
        "scores_now": {k: round(v, 4) for k, v in report.scores.items()},
        "violations_now": report.violations,
    }


def jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open()]


def exhibits(ragas: dict) -> list[dict]:
    """The reward hacks, as real samples from the runs where they happened (see experiments.md)."""
    out = []

    def add(key, title, hack, why, fix, row, source, raga=None, **extra):
        raga = ragas[raga or row["raga"]]
        out.append({"key": key, "title": title, "hack": hack, "why": why, "fix": fix, "raga": raga.key, "notation": row["notation"],
                    "reward_then": round(row["reward"], 4) if row.get("reward") is not None else None, "source": source, **extra, **rescore(row["notation"], raga)})

    run1 = jsonl(RUNS / "grpo-0.6b-20261008-0020/eval_samples.jsonl")
    untrained = next(r for r in run1 if r["step"] == 0 and r["variant"] == "bare" and r["raga"] == "bhupali" and "D - P m" not in r["notation"])
    add("zero", "Before anything", "Asked for Bhupali, the untrained model writes komal notes that Bhupali doesn't have, in bars of the wrong length.",
        "It has never been scored on raga rules.", "—", untrained, "grpo-0.6b-20261008-0020 · step 0 (untrained Qwen3-0.6B)")

    durga = jsonl(Path("runs/baseline-durga-prompt/Qwen3-0.6B-bf16/samples.jsonl"))
    copied = max((r for r in durga if r["notation"].strip().startswith("S R m P | D - P m | R m P D | m R S - |")), key=lambda r: r["reward"])
    n_copied = sum("D - P m" in r["notation"] for r in durga)
    add("copy", "The copyist", f"It copied the prompt's format example (a Durga phrase) wholly or in part, in {n_copied} of {len(durga)} samples.",
        "The example was valid notation, so copying it earned format and tala points for free.", "an anti-copy multiplier", copied,
        "baseline Qwen3-0.6B with the Durga example prompt (before any fix)")

    base2b = jsonl(Path("runs/baseline/Qwen3.5-2B-8bit/samples.jsonl"))
    hop = max(base2b, key=lambda r: r["reward"])
    add("hop", "The octave hopper", "The best sample from the 2B baseline (0.91) leaps between octaves on almost every note.",
        "Nothing in the reward looked at the size of the jumps.", "the melody term (leaps wider than a fifth are penalised)", hop,
        "baseline Qwen3.5-2B (8-bit) · best of 300")

    loops = max((r for r in run1 if r["step"] == 20), key=lambda r: r["reward"])
    add("loop", "The 32-bar loop", "GRPO run 1 learned to write long loops of one figure, S G G G over and over.",
        "variety was averaged with other checks, so three good checks hid the repetition, and extra bars diluted every penalty.",
        "variety multiplies, and a length factor asks for exactly 8 bars", loops, "grpo-0.6b-20261008-0020 · step 20")

    run2 = jsonl(RUNS / "grpo-0.6b-run2-20261008-0026/eval_samples.jsonl")
    late = [r for r in run2 if r["step"] == 40 and r["variant"] == "bare"]
    common, count = Counter(r["notation"] for r in late).most_common(1)[0]
    row = next(r for r in late if r["notation"] == common)
    add("collapse", "The collapse", f"By step 40 of run 2 the model wrote this same piece {count} times out of {len(late)} bare samples, whatever raga was asked for.",
        "When all 8 answers in a group are identical, every advantage is 0 and learning stops.", "a within-group duplicate penalty (reward × count^-0.5)",
        row, "grpo-0.6b-run2-20261008-0026 · step 40", copies=count, of=len(late), ragas_asked=sorted({r["raga"] for r in late if r["notation"] == common}))

    tracka = jsonl(RUNS / "track-a-hinted-20261008-0043/eval_samples.jsonl")
    chop = max((r for r in tracka if r["step"] == 20 and "| P |" in r["notation"]), key=lambda r: r["reward"])
    add("chop", "The chopper", "To reach the 8 bars the length factor asked for, Track A cut pieces into 'bars' of 1–3 beats.",
        "4 beats per bar was only one part of the weighted tala term, so breaking it was cheap.", "a separate beats² multiplier", chop,
        "track-a-hinted-20261008-0043 · step 20")
    return out


def series(run: str, keys: list[str]) -> dict:
    rows = jsonl(RUNS / run / "metrics.jsonl")
    out = {}
    for k in keys:
        pts = [[r["step"], round(r[k], 4)] for r in rows if k in r]
        if pts:
            out[k] = pts
    return out


def sa_share(run: str) -> dict:
    """Share of time on Sa per eval step and raga (bare prompts), from the eval samples."""
    rows = jsonl(RUNS / run / "eval_samples.jsonl")
    out: dict[str, list] = {}
    for key in ["bhupali", "yaman", "malkauns"]:
        pts = []
        for step in sorted({r["step"] for r in rows}):
            notes = [(n.swara, n.octave, n.duration) for r in rows if r["step"] == step and r["raga"] == key and r["variant"] == "bare" for n in parse(r["notation"]).notes]
            if notes:
                pts.append([step, round(float(pc_distribution(notes)[0]), 4)])
        out[key] = pts
    return out


def distinct(run: str, variant: str) -> list:
    """Share of distinct pieces per eval step (computed from the samples; older runs didn't log it)."""
    rows = jsonl(RUNS / run / "eval_samples.jsonl")
    out = []
    for step in sorted({r["step"] for r in rows}):
        group = [r["notation"] for r in rows if r["step"] == step and r["variant"] == variant]
        out.append([step, round(len(set(group)) / len(group), 4), len(set(group)), len(group)])
    return out


def journey() -> dict:
    per_raga = [f"eval/bare/raga/{k}" for k in ["bhupali", "yaman", "malkauns"]]
    return {
        "run1": {"run": "grpo-0.6b-20261008-0020", **series("grpo-0.6b-20261008-0020", ["train/reward", "eval/bare/reward"])},
        "run2": {"run": "grpo-0.6b-run2-20261008-0026", **series("grpo-0.6b-run2-20261008-0026", ["train/reward", "eval/bare/reward", "eval/hinted/reward", "train/zero_adv_frac"]),
                 "distinct": {"hinted": distinct("grpo-0.6b-run2-20261008-0026", "hinted"), "bare": distinct("grpo-0.6b-run2-20261008-0026", "bare")}},
        "tracka": {"run": "track-a-v2-20261008-0049", **series("track-a-v2-20261008-0049", ["eval/hinted/reward", "eval/bare/reward", *per_raga])},
        "sft": {"run": "track-b-sft-20261008-0112", **series("track-b-sft-20261008-0112", ["eval/bare/reward", *per_raga])},
        "v1": {"run": "track-b-v1-20261008-0122", **series("track-b-v1-20261008-0122", ["train/reward", "eval/bare/reward", "eval/bare/good_rate", "eval/bare/pakad", *per_raga]), "sa": sa_share("track-b-v1-20261008-0122")},
        "v2": {"run": "track-b-v2-20261008-2148", **series("track-b-v2-20261008-2148", ["train/reward", "eval/bare/reward", "eval/bare/profile", "eval/bare/phrases", *per_raga]), "sa": sa_share("track-b-v2-20261008-2148")},
    }


def arena(ragas: dict) -> list[dict]:
    """Groups of 8 answers to one prompt (bare eval samples), scored the way GRPO scores a training group."""
    run = "track-b-v2-20261008-2148"
    rows = jsonl(RUNS / run / "eval_samples.jsonl")
    out = []
    for step in [0, 20]:
        for key in ragas:
            group = [r for r in rows if r["step"] == step and r["raga"] == key and r["variant"] == "bare"][:8]
            out.append({"run": run, "step": step, "raga": key, "members": [{"notation": r["notation"], "reward": round(r["reward"], 4), **rescore(r["notation"], ragas[key])} for r in group]})
    return out


def voices(ragas: dict, seconds: float = 10.0, hop: float = 0.02) -> list[dict]:
    """A real singer's pitch curve per raga: the most melodic 10 s of a training recording.

    From CompMusic predominant-pitch features (no audio). Cents above the singer's tonic,
    resampled to 20 ms; unvoiced frames are None. The site resynthesises these with a voice.
    """
    import numpy as np

    from ragaz.transcribe import load_pitch, load_tonic

    profiles = load_profiles()
    feats = Path("data/external/compmusic/features")
    out = []
    for key, raga in ragas.items():
        best = None
        allowed = {SWARAS.index(sw) for sw in raga.notes}
        for name in profiles["split"][key]["train"]:
            pitch = feats / key / f"{name}.pitch"
            if not pitch.exists():
                continue
            times, hz = load_pitch(pitch)
            tonic = load_tonic(pitch.with_suffix(".tonicFine"))
            step = float(np.median(np.diff(times)))
            n = int(seconds / step)
            cents = np.where(hz > 0, 1200 * np.log2(np.maximum(hz, 1e-9) / tonic), np.nan)
            for a in range(0, len(cents) - n, int(2 / step)):
                w = cents[a : a + n]
                v = ~np.isnan(w)
                voiced = v.mean()
                if voiced < 0.8:
                    continue
                cw = w[v]
                if cw.min() < -1000 or cw.max() > 1700:
                    continue
                # pitch-tracker octave errors: jumps of 6+ semitones between neighbouring voiced
                # frames (also across short silences) are rejected
                idx = np.flatnonzero(v)
                gaps = np.diff(idx) * step
                leaps = np.abs(np.diff(cw))
                if np.any((leaps > 600) & (gaps < 0.4)):
                    continue
                pcs = np.round(cw / 100).astype(int)
                in_raga = np.isin(pcs % 12, list(allowed)).mean()
                distinct = len({p for p in pcs if (pcs == p).mean() > 0.03})
                # phrase activity: how often the voice moves between stable notes (runs of ≥ 80 ms
                # on one semitone), and no single hold longer than 2.5 s
                runs, cur, n = [], pcs[0], 0
                for p_ in pcs:
                    if p_ == cur:
                        n += 1
                    else:
                        runs.append((cur, n))
                        cur, n = p_, 1
                runs.append((cur, n))
                stable = [r for r, k in runs if k * step >= 0.08]
                changes = sum(1 for a_, b_ in zip(stable, stable[1:]) if a_ != b_)
                longest = max(k for _, k in runs) * step
                score = voiced * in_raga ** 4 * min(1.0, distinct / 6) * min(1.0, changes / 14) * (1.0 if longest <= 2.5 else 2.5 / longest)
                if best is None or score > best[0]:
                    best = (score, name, a * step, w, step)
        if not best:
            continue
        _, name, start, w, step = best
        k = int(hop / step)
        res = [w[i : i + k] for i in range(0, len(w) - k + 1, k)]
        curve = [None if np.isnan(seg).mean() > 0.5 else round(float(np.nanmedian(seg)), 1) for seg in res]
        title = " ".join(name.split("_")[:-1]).replace(" - ", ", ").strip()
        out.append({"raga": key, "recording": name, "title": title, "start": round(start, 2), "hop": hop, "cents": curve,
                    "source": "CompMusic Indian Art Music Raga Recognition Dataset (features), Gulati et al., CC BY 4.0"})
        print(f"voice {key:<9} {title[:50]:<50} @ {start:7.1f}s")
    return out


LATEST_LABEL = "v6"  # shown on the site as "the newest model · <label>"
LATEST_RUN = "v6-grpo-20261106-0017"
LATEST_STEP = 60  # best checkpoint by real-twin score: reader 100%, twin 100%, realism 0.89
LATEST_STYLE = "v6"  # the reward the run was trained and scored with
# Previous newest: v5e-long-grpo-20261024-1940 step 30 (label v5e, reward v5).


def latest(all_ragas: dict) -> dict:
    """The newest model (LATEST_*): its 16-bar pieces for every raga it knows, plus its recordings.

    Scores are the reward the run was trained and evaluated with (the browser verifier
    implements v2, so these pieces are shown with their own run's scores, not re-scored).
    Recordings: out/<label>-<raga>-{vocal,expressive}.wav, converted to MP3 in web/public/audio.
    vocal = the DDSP voice trained on Hindustani concert vocals (hvocal); expressive = the flute synth.
    """
    import subprocess

    rows = jsonl(RUNS / LATEST_RUN / "eval_samples.jsonl")
    best = jsonl(RUNS / LATEST_RUN / "eval_best_samples.jsonl")
    pieces = []
    for key, raga in all_ragas.items():
        group = [r for r in rows if r["step"] == LATEST_STEP and r["variant"] == "bare" and r["raga"] == key]
        for i, r in enumerate(group):
            comp = parse(r["notation"])
            pieces.append({
                "id": f"{LATEST_LABEL}-{key}-{i:02d}", "model": LATEST_LABEL, "run": LATEST_RUN, "step": r["step"], "raga": key,
                "notation": r["notation"], "beats": comp.beats, "bars": len(comp.bars), "reward": round(r["reward"], 4),
                "scores": {k: round(v, 4) for k, v in r["scores"].items()}, "violations": r["violations"],
                "notes": [{"s": n.swara, "o": n.octave, "t": round(n.start, 4), "d": round(n.duration, 4), "bar": n.bar, "ok": n.swara in raga.notes} for n in comp.notes],
            })
    audio = Path("web/public/audio")
    audio.mkdir(parents=True, exist_ok=True)
    recordings = []
    for key, raga in all_ragas.items():
        txt = Path(f"out/{LATEST_LABEL}-{key}.txt")
        if not txt.exists():
            continue
        notation = txt.read_text().strip()
        flat = notation.replace("\n", " ")
        src = next((r for r in rows + best if r["notation"].strip().replace("\n", " ") == flat), None)
        files = {}
        for voice in ["vocal", "expressive"]:
            wav = Path(f"out/{LATEST_LABEL}-{key}-{voice}.wav")
            if wav.exists():
                mp3 = audio / f"{LATEST_LABEL}-{key}-{voice}.mp3"  # MP3: plays in every browser
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3)], check=True)
                files[voice] = f"/audio/{mp3.name}"
        comp = parse(notation)
        recordings.append({
            "raga": key, "notation": notation, "files": files, "tempo": 90, "bars": len(comp.bars),
            "run": LATEST_RUN, "step": src["step"] if src else None, "reward": round(src["reward"], 4) if src else None,
            "notes": [{"s": n.swara, "o": n.octave, "t": round(n.start, 4), "d": round(n.duration, 4), "bar": n.bar, "ok": n.swara in raga.notes} for n in comp.notes],
        })
    return {
        "label": LATEST_LABEL, "style": LATEST_STYLE, "run": LATEST_RUN, "step": LATEST_STEP, "bars": 16, "tempo": 90,
        # Only the ragas this model wrote pieces for (ragas.yaml may list more than it knows).
        "ragas": [raga_entry(r) for k, r in all_ragas.items() if any(p["raga"] == k for p in pieces)],
        "pieces": pieces, "recordings": recordings,
        "voices": {
            "vocal": "a DDSP voice trained on vocals separated (with Demucs) from 16 Hindustani concert recordings in Saraga 1.5 by Ajoy Chakrabarty, Kaustuv Kanti Ganguli and Brajeshwar Mukherjee (CC BY-NC-SA 4.0), a short training run; it sings the notes with glides, wavers, breaths and grace notes measured from real singers",
            "expressive": "a synthesised flute playing the same notes, performed the same way",
        },
        # The concerts behind this model's reward (data/real_profiles_v6.json): built from the train
        # split, checked on the held-out test split.
        "concerts": concerts_v6(),
        "eval": run_eval(),
        # Before training: the untrained base model on exactly this evaluation (scripts/baseline_v6.py).
        "baseline": json.loads(Path("out/baseline-v6/summary.json").read_text()) if Path("out/baseline-v6/summary.json").exists() else None,
        # How singing sounds measured the same way on real concerts and on our pieces, plain and
        # performed (scripts/real_vs_ours.py → reports/performance.json).
        "performance": json.loads(Path("reports/performance.json").read_text()) if Path("reports/performance.json").exists() else None,
    }


def run_eval() -> dict:
    """The run's own evaluation at the chosen step (metrics.jsonl): what Results quotes."""
    rows = [json.loads(line) for line in (RUNS / LATEST_RUN / "metrics.jsonl").open() if f'"step": {LATEST_STEP},' in line and "eval/bare/reward" in line]
    m = rows[-1]
    keys = {"reward": "reward", "no_wrong_notes": "no_wrong_notes", "reader_accuracy": "reader_accuracy", "novel_bars": "novel_bars", "copied_example": "copied_example", "realism": "realism"}
    out = {k: round(m[f"eval/bare/{v}"], 4) for k, v in keys.items() if f"eval/bare/{v}" in m}
    rows = [r for r in jsonl(RUNS / LATEST_RUN / "eval_samples.jsonl") if r["step"] == LATEST_STEP and r["variant"] == "bare"]
    from ragaz.prompts import EXAMPLE_BARS

    bars = [parse(r["notation"]).bars for r in rows]
    out["sixteen_bars"] = round(sum(len(b) == 16 for b in bars) / len(rows), 4)
    # As the baseline counts it: pieces at least half made of the prompt's example bars.
    out["copied_pieces"] = round(sum(sum(tuple(x) in EXAMPLE_BARS for x in b) >= 0.5 * max(1, len(b)) for b in bars) / len(rows), 4)
    return out


def concerts_v6() -> dict:
    split = json.loads(Path("data/real_profiles_v6.json").read_text())["split"]
    return {"recordings": sum(len(v["train"]) + len(v["test"]) for v in split.values()), "held_out": sum(len(v["test"]) for v in split.values()), "ragas": len(split)}


def evolution() -> list[dict]:
    """One piece per training stage for the ragas every stage knew (scripts/render_site.py), sung
    the same way, with each stage's own score and one shared yardstick (the v6 reward at the
    piece's length) broken into the parts that changed most."""
    import subprocess

    from ragaz.verify import verify

    src = Path("out/evolve/evolution.json")
    if not src.exists():
        return []
    audio = Path("web/public/audio")
    out = []
    for r in json.loads(src.read_text()):
        wav = Path(f"out/evolve/{r['raga']}-{r['stage']}.wav")
        mp3 = audio / f"evolve-{r['raga']}-{r['stage']}.mp3"
        if wav.exists():
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "128k", str(mp3)], check=True)
        v = verify(r["notation"], r["raga"], style="v6", target_bars=r.get("asked", r["bars"]))
        comp = parse(r["notation"])
        out.append({**{k: r[k] for k in ("raga", "stage", "label", "what", "notation", "bars", "asked", "own_score", "pieces", "v6_score", "outside") if k in r},
                    "file": f"/audio/{mp3.name}" if wav.exists() else None,
                    "parts": {k: round(v.scores[k], 3) for k in ("rhythm", "register", "pakad", "motion", "allowed") if k in v.scores},
                    "notes": [{"s": n.swara, "o": n.octave, "t": round(n.start, 4), "d": round(n.duration, 4), "bar": n.bar, "ok": True} for n in comp.notes]})
    return out


def main() -> None:
    profiles = load_profiles()
    # The site covers the ragas that have real-singer profiles (Deshkar has none yet).
    ragas = {k: r for k, r in load_ragas().items() if k in profiles["ragas"]}
    OUT.mkdir(parents=True, exist_ok=True)

    pieces = []
    for label, run, step in MODELS:
        rows = [json.loads(line) for line in (RUNS / run / "eval_samples.jsonl").open()]
        for key in ragas:
            chosen = [r for r in rows if r["step"] == step and r["raga"] == key and r["variant"] == "bare"]
            for i, r in enumerate(chosen):
                pieces.append(piece_entry(r | {"_i": i}, label, run, ragas))

    masters = {"source": "CompMusic Indian Art Music Raga Recognition Dataset (features), Gulati et al., Zenodo 10.5281/zenodo.7278506, CC BY 4.0", "ragas": {}}
    for key, prof in profiles["ragas"].items():
        entry = {
            "recordings": len(profiles["split"][key]["train"]) + len(profiles["split"][key]["test"]),
            "train": len(profiles["split"][key]["train"]),  # profiles are built from these; the rest are held out
            "pc": [round(x, 4) for x in prof["pc"]],
            "phrases": list(prof["phrases"])[:8],
            "models": {},
        }
        for label, _, _ in MODELS:
            group = [p for p in pieces if p["model"] == label and p["raga"] == key]
            notes = [(n["s"], n["o"], n["d"]) for p in group for n in p["notes"]]
            entry["models"][label] = {
                "pc": [round(x, 4) for x in pc_distribution(notes)],
                "reward": round(statistics.mean(p["reward"] for p in group), 4) if group else None,
            }
        masters["ragas"][key] = entry

    meta = {
        "equation": {
            "gates": ["format", "allowed²", "beats²", "variety", "length"],
            "weights": WEIGHTS_V2,
        },
        "models": [{"label": label, "run": run, "step": step} for label, run, step in MODELS],
    }

    verifier = {key: {"pc": prof["pc"], "intervals": prof["intervals"], "phrases": prof["phrases"], "calibration": prof["calibration"]} for key, prof in profiles["ragas"].items()}
    (OUT / "profiles.json").write_text(json.dumps(verifier))
    (OUT / "exhibits.json").write_text(json.dumps(exhibits(ragas), ensure_ascii=False, indent=1))
    (OUT / "journey.json").write_text(json.dumps(journey()))
    (OUT / "arena.json").write_text(json.dumps(arena(ragas)))
    (OUT / "voices.json").write_text(json.dumps(voices(ragas)))
    (OUT / "latest.json").write_text(json.dumps(latest(load_ragas()), ensure_ascii=False))
    (OUT / "evolution.json").write_text(json.dumps(evolution(), ensure_ascii=False))
    (OUT / "ragas.json").write_text(json.dumps({"ragas": [raga_entry(r) for r in ragas.values()], **meta}, ensure_ascii=False, indent=1))
    (OUT / "pieces.json").write_text(json.dumps(pieces, ensure_ascii=False))
    (OUT / "masters.json").write_text(json.dumps(masters, ensure_ascii=False, indent=1))
    for label, _, _ in MODELS:
        group = [p for p in pieces if p["model"] == label]
        print(f"{label:>10}: {len(group)} pieces, mean v2 reward {statistics.mean(p['reward'] for p in group):.3f}")
    print(f"wrote {sorted(p.name for p in OUT.glob('*.json'))}")


if __name__ == "__main__":
    main()
