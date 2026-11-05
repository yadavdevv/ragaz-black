"""Teach the nine new ragas from real singers' own phrases (SFT data for v6).

    uv run python scripts/real_phrases.py

The v5e composer, asked for Bhairav with its notes in the prompt, still writes Bhupali's
five notes (purity 0 in 288/288 probe samples), so GRPO has nothing to reinforce: the
same lesson as Malkauns, Deshkar and rhythm. The facts have to be taught first.

Here the teaching material is the singers themselves. From each raga's *training*
recordings (held-out ones are never touched), runs of consecutive transcribed notes
are laid into Teentaal with a real-like mix of runs, pairs, single notes and holds:

  sthayi  8 bars from a passage in the middle register, resolving to Sa
  antara  8 bars from a passage where the singer really is high (≥ 25% upper octave),
          resolving to Sa

Notes outside the raga (pitch-tracking slips, brief passing tones) are dropped first.

So the order of notes (the raga's chalan) is real; only the rhythm grid is ours. Each
candidate is scored with the 16-bar v6 reward and kept only if it has no forbidden note.
"""

import json
import random
from collections import Counter
from pathlib import Path

from ragaz.ragas import SWARAS, get_raga
from ragaz.realprofile import FEATURES, PROFILES_V6
from ragaz.transcribe import load_pitch, load_tonic, transcribe
from ragaz.verify import verify

OUT = Path("data/real_long_v6.jsonl")
OLD = Path("data/long_v5.jsonl")  # v5e's own teaching set: keeps the four ragas it knows
NEW = ["bhairav", "todi", "shuddh_sarang", "madhuvanti", "marwa", "bihag", "darbari", "miyan_malhar", "basant"]
HALF_BEATS = 32  # 8 bars
MIN_REWARD = 0.35
BEAT_TYPES = {"run": 0.10, "pair": 0.27, "one": 0.27, "hold": 0.36}  # as scripts/rhythmize.py


def tok(pc: int, octave: int) -> str:
    return "." * max(0, -octave) + SWARAS[pc] + "'" * max(0, octave)


def lay(pool: list[str], raga, rng: random.Random) -> list[str] | None:
    """32 beats from consecutive notes; the last two beats resolve to Sa (S -)."""
    important = {"S", raga.vadi, raga.samvadi} | set(raga.nyas)
    beats, i = [], 0
    while len(beats) < HALF_BEATS - 2:
        if i + 4 > len(pool):
            return None
        kind = rng.choices(list(BEAT_TYPES), weights=list(BEAT_TYPES.values()))[0]
        room = HALF_BEATS - 2 - len(beats)
        bar_left = 4 - len(beats) % 4
        if kind == "hold" and pool[i].strip(".'") in important and min(bar_left, room) >= 2:
            k = rng.choice([2, 2, 3, 4][: min(bar_left, room) - 1])
            beats += [pool[i]] + ["-"] * (k - 1)
            i += 1
        elif kind == "run":
            beats.append("".join(pool[i : i + 4]))
            i += 4
        elif kind in ("pair", "hold"):
            beats.append("".join(pool[i : i + 2]))
            i += 2
        else:
            beats.append(pool[i])
            i += 1
    return beats + ["S", "-"]


def bars(beats: list[str]) -> str:
    b = [" ".join(beats[k : k + 4]) for k in range(0, len(beats), 4)]
    return "\n".join(" | ".join(b[r : r + 4]) + " |" for r in range(0, len(b), 4))


def passages(notes: list[tuple[int, int, float, float]], want_upper: bool, length: int = 60) -> list[list[str]]:
    """Runs of consecutive held notes within ±1 octave, middle-register or high."""
    out = []
    for start in range(0, len(notes) - length, length // 3):
        run = notes[start : start + length]
        if any(abs(o) > 1 for _, o, _, _ in run):
            continue
        upper = sum(d for _, o, _, d in run if o >= 1) / sum(d for _, _, _, d in run)
        if (upper >= 0.25) if want_upper else (upper < 0.1):
            out.append([tok(pc, o) for pc, o, _, _ in run])
    return out


def clean(passage: list[str], raga) -> list[str]:
    """Drop notes outside the raga (1–3% of real singing time, mostly pitch-tracking slips and
    brief passing tones) and isolated octave slips, then merge the repeats that leaves. The real
    order is otherwise kept."""
    semi = lambda t: SWARAS.index(t.strip(".'")) + 12 * (t.count("'") - t.count("."))  # noqa: E731
    kept = [t for t in passage if t.strip(".'") in raga.notes]
    # An isolated note a fifth or more away from both neighbours is usually an octave slip of
    # the pitch tracker in high passages, not singing.
    kept = [t for i, t in enumerate(kept) if not (0 < i < len(kept) - 1 and abs(semi(t) - semi(kept[i - 1])) > 7 and abs(semi(t) - semi(kept[i + 1])) > 7)]
    out = []
    for t in kept:
        if not out or out[-1] != t:
            out.append(t)
    return out


def main(per_raga: int = 120, tries: int = 5000, seed: int = 0) -> None:
    rng = random.Random(seed)
    split = json.loads(PROFILES_V6.read_text())["split"]
    kept = []
    for key in NEW:
        raga = get_raga(key)
        recs = []  # (pc, octave, start, duration) per training recording
        for stem in split[key]["train"]:
            p = FEATURES / key / f"{stem}.pitch"
            t, hz = load_pitch(p)
            recs.append([(SWARAS.index(n.swara), n.octave, n.start, n.duration) for n in transcribe(t, hz, load_tonic(p.with_suffix(".tonicFine")))])
        low = [clean(p, raga) for r in recs for p in passages(r, want_upper=False)]
        high = [clean(p, raga) for r in recs for p in passages(r, want_upper=True)]
        if not low or not high:
            print(f"{raga.name:<14} too few passages (middle {len(low)}, high {len(high)})")
            continue
        seen, cands, fails = set(), [], Counter()
        for _ in range(tries):
            a = lay(rng.choice(low), raga, rng)
            b = lay(rng.choice(high), raga, rng)
            if not a or not b:
                fails["short"] += 1
                continue
            text = bars(a) + "\n" + bars(b)
            if text in seen:
                continue
            seen.add(text)
            rep = verify(text, raga, style="v6", target_bars=16)
            if rep.scores["purity"] < 1:
                fails["forbidden note"] += 1
                continue
            cands.append((rep.reward, rep.scores.get("arc", 0), rep.scores["rhythm"], text))
        cands.sort(reverse=True)
        best = [c for c in cands[:per_raga] if c[0] >= MIN_REWARD]
        kept += [{"raga": key, "notation": t, "reward": round(r, 4), "arc": round(a, 2), "rhythm": round(rh, 3), "source": "real"} for r, a, rh, t in best]
        if best:
            mean = lambda i: sum(c[i] for c in best) / len(best)  # noqa: E731
            print(f"{raga.name:<14} passages {len(low)}/{len(high)} · {len(cands)} clean of {tries} ({dict(fails)}) · kept {len(best)}: reward {mean(0):.2f} (min {best[-1][0]:.2f}), arc {mean(1):.2f}, rhythm {mean(2):.2f}", flush=True)
            print(f"               e.g. {best[len(best) // 2][3].splitlines()[0]}")
    old = [json.loads(line) | {"source": "v5"} for line in OLD.read_text().splitlines()]
    OUT.write_text("\n".join(json.dumps(k, ensure_ascii=False) for k in kept + old) + "\n")
    print(f"wrote {len(kept)} real-phrase pieces + {len(old)} from {OLD} → {OUT}")


if __name__ == "__main__":
    main()
