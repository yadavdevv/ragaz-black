"""Ragas hiding in the world's music: what the reader hears in tunes and scales from elsewhere.

    uv run python scripts/world_tunes.py      # → web/public/data/cousins.json

Two answers per entry, kept apart on purpose:
  same notes   which of our ragas uses exactly this set of notes (from ragas.yaml), if any
  the reader   which raga the "Sing to it" reader, trained only on Indian concert singers,
               hears in it (note time-share + moves); it can disagree with the note set

Tunes are traditional or long out of copyright (composer died more than 70 years ago),
written relative to their tonic as Sa, with durations in beats. Scales are played up and
down with Sa held, so the reader hears mostly the note set.
"""

import json
from pathlib import Path

from ragaz.ragas import SWARAS, load_ragas
from ragaz.reader import rank

OUT = Path("web/public/data/cousins.json")

# token:beats, space separated. Tokens as in our notation: .P lower octave, S' upper.
TUNES = [
    {
        "key": "amazing-grace", "title": "Amazing Grace", "from": "Britain and America",
        "credit": "Hymn tune “New Britain”, traditional (words John Newton, 1779). Public domain.",
        "notes": ".P:1 S:2 G:.5 S:.5 G:2 R:1 S:2 .D:1 .P:2 .P:1 S:2 G:.5 S:.5 G:2 R:1 P:5 "
                 "G:1 P:1.5 G:.5 P:.5 G:.5 S:2 .P:1 .D:1.5 S:.5 S:.5 .D:.5 .P:2 .P:1 S:2 G:.5 S:.5 G:2 R:1 S:3",
    },
    {
        "key": "ode-to-joy", "title": "Ode to Joy", "from": "Germany",
        "credit": "Ludwig van Beethoven, Symphony no. 9 (1824). Public domain.",
        "notes": "G:1 G:1 m:1 P:1 P:1 m:1 G:1 R:1 S:1 S:1 R:1 G:1 G:1.5 R:.5 R:2 "
                 "G:1 G:1 m:1 P:1 P:1 m:1 G:1 R:1 S:1 S:1 R:1 G:1 R:1.5 S:.5 S:2 "
                 "R:1 R:1 G:1 S:1 R:1 G:.5 m:.5 G:1 S:1 R:1 G:.5 m:.5 G:1 R:1 S:1 R:1 .P:2",
    },
    {
        "key": "frere-jacques", "title": "Frère Jacques", "from": "France",
        "credit": "Traditional round, 18th century. Public domain.",
        "notes": "S:1 R:1 G:1 S:1 S:1 R:1 G:1 S:1 G:1 m:1 P:2 G:1 m:1 P:2 "
                 "P:.5 D:.5 P:.5 m:.5 G:1 S:1 P:.5 D:.5 P:.5 m:.5 G:1 S:1 S:1 .P:1 S:2 S:1 .P:1 S:2",
    },
    {
        "key": "scarborough-fair", "title": "Scarborough Fair", "from": "England",
        "credit": "Traditional English ballad. Public domain (the tune, not later arrangements).",
        "notes": "S:2 S:1 P:2 P:1 R:1.5 g:.5 R:1 S:3 P:1 n:1 S':1 n:2 P:1 D:1 m:1 P:3 "
                 "S':2 S':1 S':1 n:1 P:1 P:1 m:1 g:1 R:1 S:1 .n:1 S:1 P:1 m:1 g:1 R:2 S:3",
    },
]

SCALES = [
    {"key": "lydian", "title": "Lydian mode", "from": "Medieval Europe, film scores", "notes": "S R G M P D N"},
    {"key": "double-harmonic", "title": "Double harmonic (Byzantine)", "from": "Byzantine chant, Arabic Hijaz Kar", "notes": "S r G m P d N"},
    {"key": "hijaz", "title": "Phrygian dominant / Hijaz", "from": "Flamenco, klezmer Freygish, maqam Hijaz", "notes": "S r G m P d n"},
    {"key": "major-pentatonic", "title": "Major pentatonic", "from": "China, Scotland, West Africa, Appalachia", "notes": "S R G P D"},
    {"key": "minor-pentatonic", "title": "Minor pentatonic", "from": "The blues, rock", "notes": "S g m P n"},
    {"key": "dorian", "title": "Dorian mode", "from": "Celtic tunes, plainchant, jazz", "notes": "S R g m P D n"},
    {"key": "in-scale", "title": "In scale (miyako-bushi)", "from": "Japan: koto and shamisen music", "notes": "S r m P d"},
    {"key": "hungarian-minor", "title": "Hungarian minor", "from": "Romani and Hungarian music", "notes": "S R g M P d N"},
]


def parse_tune(text: str) -> list[tuple[str, int, float]]:
    out = []
    for item in text.split():
        tok, dur = item.split(":")
        octave = -tok.count(".") + tok.count("'")
        out.append((tok.strip(".'"), octave, float(dur)))
    return out


def scale_phrase(notes: str) -> list[tuple[str, int, float]]:
    up = notes.split()
    phrase = [("S", 0, 2.0)] + [(s, 0, 1.0) for s in up[1:]] + [("S", 1, 2.0)]
    phrase += [(s, 0, 1.0) for s in reversed(up[1:])] + [("S", 0, 3.0)]
    return phrase


def as_beats(notes: list[tuple[str, int, float]]) -> list[dict]:
    """For the web player: {s, o, t, d, bar, ok} with t, d in beats."""
    t, out = 0.0, []
    for s, o, d in notes:
        out.append({"s": s, "o": o, "t": round(t, 3), "d": d, "bar": int(t // 4), "ok": True})
        t += d
    return out


def main() -> None:
    ragas = load_ragas()
    by_set = {frozenset(r.notes): k for k, r in ragas.items()}
    entries = []
    for kind, items in (("tune", TUNES), ("scale", SCALES)):
        for item in items:
            notes = parse_tune(item["notes"]) if kind == "tune" else scale_phrase(item["notes"])
            used = frozenset(s for s, _, _ in notes)
            heard = rank(notes)[:3]
            same = [k for k, r in ragas.items() if frozenset(r.notes) == used]
            entries.append({
                "key": item["key"], "kind": kind, "title": item["title"], "from": item["from"], "credit": item.get("credit"),
                "swaras": sorted(used, key=SWARAS.index), "same_notes": same, "heard": heard, "notes": as_beats(notes),
            })
            print(f"{item['title']:<28} notes {' '.join(sorted(used, key=SWARAS.index)):<16} same set: {', '.join(same) or '—':<18} reader hears: {', '.join(heard)}")
    OUT.write_text(json.dumps(entries, ensure_ascii=False))
    print(f"wrote {OUT} ({len(entries)} entries)")
    _ = by_set


if __name__ == "__main__":
    main()
