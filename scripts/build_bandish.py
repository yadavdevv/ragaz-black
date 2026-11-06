"""Teaching data for a composer that writes words and notes together (bandish v1).

    uv run python scripts/build_bandish.py      # → data/bandish_v1.jsonl

Words: the cleaned public-domain verse (data/lyrics/corpus.jsonl), cut into four bandish lines
(sthayi 2, antara 2); a line longer than 15 syllables is split at its caesura (comma) if both
halves have 5+ syllables, else at its middle word; fragments under 5 syllables are not lines. Notes: real-singer melodies of each raga (data/real_long_v6.jsonl, the composer's
v6 teaching set). Each verse is set on up to 12 melodies of a raga with the same setter /words
uses, sthayi words on bars 1–8 and antara words on bars 9–16; the best is kept only if heavy
syllables are held, nothing is crowded and the mukhda lands on sam, and the result is checked
by the bandish verifier (bandish.score).

Two tasks:
  set   raga + words → bandish        any verse, any raga: setting words is a skill of its own
  free  raga → bandish (words too)    only verse whose meaning belongs to the raga: Surdas's own
                                      raga label, or two of the raga's images
"""

import json
import random
from collections import Counter, defaultdict
from pathlib import Path

from ragaz.bandish import place, score, to_text
from ragaz.lyrics import set_words, syllables
from ragaz.lyrics_reward import IMAGERY
from ragaz.notation import parse

CORPUS = Path("data/lyrics/corpus.jsonl")
MELODIES = Path("data/real_long_v6.jsonl")
OUT = Path("data/bandish_v1.jsonl")
TRIES = 12
MAX_LINE = 15
MIN_LINE = 5

# Surdas labels each pad with a raga. Mapped to our raga where it is the same raga or its family
# (Sarang → Shuddh Sarang, Kanhara → Darbari Kanada, Malar → Miyan Malhar); others stay unmapped.
LABELS = {
    "सारंग": "shuddh_sarang", "मलार": "miyan_malhar", "मल्हार": "miyan_malhar", "बसंत": "basant", "बसन्त": "basant",
    "बिहागरो": "bihag", "विहागरो": "bihag", "बिहाग": "bihag", "बिहागड़ो": "bihag", "भैरव": "bhairav", "भैरौं": "bhairav", "टोड़ी": "todi", "टोडी": "todi",
    "कान्हरो": "darbari", "कान्हरा": "darbari", "कान्हड़ा": "darbari", "मालकोस": "malkauns", "मालकौंस": "malkauns",
    "कल्याण": "yaman", "यमन": "yaman", "भूपाली": "bhupali",
}


def segments(lines: list[str]) -> list[str]:
    out = []
    for line in lines:
        if len(syllables(line)) <= MAX_LINE:
            out.append(line)
            continue
        # Split at the caesura (a comma) only if both halves are real lines (5+ syllables);
        # otherwise at the word nearest the middle by syllables.
        halves = None
        if "," in line:
            a, b = line.split(",", 1)
            if min(len(syllables(a)), len(syllables(b))) >= MIN_LINE:
                halves = [a.strip(), b.strip()]
        if halves is None:
            words = line.split()
            counts = [len(syllables(w)) for w in words]
            total, run, cut = sum(counts), 0, 1
            for i, c in enumerate(counts[:-1]):
                run += c
                if run >= total / 2:
                    cut = i + 1
                    break
            halves = [" ".join(words[:cut]), " ".join(words[cut:])]
        out += [h.strip(" ,") for h in halves]
    return [s for s in out if len(syllables(s)) >= MIN_LINE]


def melody_onsets(notation: str) -> tuple[list[float], list[float], float]:
    comp = parse(notation)
    half = comp.beats / 2
    return [n.start for n in comp.notes if n.start < half], [n.start - half for n in comp.notes if n.start >= half], half


def main(seed: int = 0) -> None:
    rng = random.Random(seed)
    melodies = defaultdict(list)
    for line in MELODIES.read_text().splitlines():
        row = json.loads(line)
        if parse(row["notation"]).beats == 64:
            melodies[row["raga"]].append(row["notation"])
    ragas = sorted(melodies)
    verses = []
    for line in CORPUS.read_text().splitlines():
        row = json.loads(line)
        seg = segments(row["lines"])
        for k in range(0, len(seg) - 3, 4):
            verse = seg[k : k + 4]
            words = set(" ".join(verse).split())
            images = {r for r in ragas if len(words & set(IMAGERY.get(r, "").split())) >= 2}
            own = LABELS.get((row["raga_label"] or "").split()[0] if row["raga_label"] else "")
            verses.append({"verse": verse, "own": own, "images": images, "source": row["source"], "page": row["page"]})
    print(f"{len(verses)} four-line verses ({sum(bool(v['own']) for v in verses)} with Surdas's raga in our set, {sum(bool(v['images']) for v in verses)} with a raga's images)")

    out, why = [], Counter()
    for v in verses:
        task_ragas = [("free", v["own"])] if v["own"] else [("free", r) for r in sorted(v["images"])[:1]]
        task_ragas.append(("set", v["own"] or rng.choice(ragas)))
        for task, raga in task_ragas:
            sthayi, antara = "\n".join(v["verse"][:2]), "\n".join(v["verse"][2:])
            best = None
            for notation in rng.sample(melodies[raga], min(TRIES, len(melodies[raga]))):
                a_on, b_on, half = melody_onsets(notation)
                fa, fb = set_words(syllables(sthayi), a_on, half), set_words(syllables(antara), b_on, half)
                if not fa or not fb:
                    continue
                quality = (fa.score + fb.score) / 2
                if best is None or quality > best[0]:
                    best = (quality, notation, fa, fb)
            if best is None:
                why["too many syllables for every melody"] += 1
                continue
            _, notation, fa, fb = best
            if not (fa.mukhda_on_sam and min(fa.heavy_on_long, fb.heavy_on_long) >= 0.75 and min(fa.light_on_short, fb.light_on_short) >= 0.6):
                why["fit below threshold"] += 1
                continue
            a_on, b_on, half = melody_onsets(notation)
            words = place(sthayi, a_on, half) + place(antara, b_on, half)
            text = to_text(notation, words)
            given = sthayi + "\n" + antara
            check = score(text, raga, given)
            if check["aligned"] < 1 or check["fidelity"] < 0.98:
                why["failed the bandish verifier"] += 1
                continue
            out.append({"task": task, "raga": raga, "words": given, "text": text, "reward": round(check["reward"], 4), "fit": round(check["fit"], 3),
                        "source": v["source"], "page": v["page"], "raga_from": "surdas" if v["own"] == raga else "images" if task == "free" else "assigned"})
    OUT.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in out) + "\n")
    by = Counter((r["task"], r["raga"]) for r in out)
    print(f"wrote {len(out)} bandishes → {OUT}; rejected: {dict(why)}")
    for task in ("set", "free"):
        print(f"  {task}: " + ", ".join(f"{r} {by[task, r]}" for r in ragas if by[task, r]))


if __name__ == "__main__":
    main()
