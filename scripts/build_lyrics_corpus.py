"""Clean the Wikisource poetry into a verse corpus and a word list (lyrics data).

    uv run python scripts/build_lyrics_corpus.py   # → data/lyrics/corpus.jsonl, lexicon.txt, cleaning.json

Input: data/external/wikisource/*.json (scripts/fetch_wikisource.py), rendered page text. What is
removed, each counted in cleaning.json so the cleaning can be audited:

  furniture    navigation (← →, prev/next), the edition's title, page-id lines
  footnote     ↑ footnotes, and [१]-style markers inside verse
  commentary   सन्दर्भ / भावार्थ / शब्दार्थ / अर्थ / टिप्पणी / विशेष paragraphs (the edition's prose, not verse)
  prose        lines longer than a verse line (> 90 characters)
  ocr          scan damage: doubled or stacked vowel signs, halant before a vowel sign, Latin
               letters or digits inside a verse line
  duplicate    the same unit twice

Kept: Surdas's pads whole, with the raga each is labelled with (राग सारंग); dohas grouped by
their closing ॥. Verse numbers are stripped, ।। becomes ॥, joiners and stray spaces go.
"""

import json
import re
import unicodedata
from collections import Counter
from pathlib import Path

SRC = Path("data/external/wikisource")
OUT = Path("data/lyrics")

FURNITURE = {"←", "→", "पिछला पद", "अगला पद"}
COMMENTARY = re.compile(r"^[\s(\[|]*(सन्दर्भ|संदर्भ|सौंदर्भ|सँदर्भ|भावार्थ|भावर्थ|शब्दार्थ|अर्थ|टिप्पणी|विशेष|प्रसंग|अवतरण|अलंकार)\s*[)\]]?\s*[—:\-]")
# Pages that are the editors' essays, prefaces or Sanskrit, not Braj/Hindi verse.
SKIP_PAGES = re.compile(r"भूमिका|चूर्णिका|वक्तव्य|परिचय|युग|संस्कृत|खेट-कौतुक|विषय-सूची|अनुक्रम")
# Modern Hindi prose endings: the editions' commentary, rare in Braj verse.
PROSE_END = re.compile(r"(है|हैं|था|थी|थे|गया|गए|गई|रहा|रहे|रही|होता|होती|जाता|सकता)\s*।\s*$")
INLINE_DIGIT = re.compile(r"[०-९]")
GLOSS = re.compile(r"(॥|।।)\s*[०-९\d]+\s*(॥|।।)")
# The commentary's own marks and connectives: a unit with any of them still holds a gloss.
GLOSS_MARKS = re.compile(r"[=\[\]()/]|अर्थात्|इसलिए|के लिए|किया है|कहा है|टीका")
RAGA = re.compile(r"^राग\s+([ऀ-ॿ ]+)$")
OCR = [
    ("doubled vowel sign", re.compile(r"([ा-ौ])\1")),
    ("stacked vowel signs", re.compile(r"[ा-ौ][ा-ौ]")),
    ("halant before vowel sign", re.compile(r"्[ा-ौ]")),
    ("latin or digits", re.compile(r"[A-Za-z0-9]")),
]
VERSE_END = re.compile(r"(॥|।।)\s*[०-९\d]*\s*(॥|।।)?\s*$")
NUMBERS = re.compile(r"[।॥|]*\s*[०-९\d]+\s*[।॥|]+\s*$")
MARKER = re.compile(r"\[[०-९\d]+\]")
WORD = re.compile(r"[ऀ-ॣ०-ॿ]+")
MAX_LINE = 90


def normalise(line: str) -> str:
    for ch in ("​", "‌", "‍", "⁠", "﻿"):  # zero-width spaces, joiners, word joiner
        line = line.replace(ch, "")
    line = unicodedata.normalize("NFC", line).replace("\xa0", " ").replace("―", "—").replace("–", "—")
    line = MARKER.sub("", line).replace("।।", "॥")
    return re.sub(r"\s+", " ", line).strip()


def clean_page(text: str, title: str, drops: Counter, prose_check: bool) -> list[tuple[str | None, list[str]]]:
    """Units of verse on a page: (raga label or None, lines). A unit ends at a line ending in ॥."""
    units, cur, raga = [], [], None
    for raw in text.splitlines():
        line = normalise(raw)
        # A verse line may carry the edition's gloss after its number: keep the verse, cut the rest.
        m = GLOSS.search(line)
        if m and line[m.end():].strip():
            drops["gloss cut after verse number"] += 1
            line = line[: m.end()]
        if not line:
            continue
        if line in FURNITURE or line == title.split("/")[0] or re.match(r"^\d", line) or "द्वारा" in line or re.search(r"\(\d{4}\)", line):
            drops["furniture"] += 1
            continue
        if line.startswith("↑"):
            drops["footnote"] += 1
            continue
        if COMMENTARY.match(line):
            drops["commentary"] += 1
            continue
        m = RAGA.match(line)
        if m:
            raga = m.group(1).strip()
            continue
        if not re.search(r"[।॥]", line):
            drops["no danda (heading or prose)"] += 1
            continue
        if len(line) > MAX_LINE:
            drops["prose"] += 1
            continue
        if prose_check and PROSE_END.search(line):
            drops["prose (modern Hindi ending)"] += 1
            cur = []
            continue
        body = NUMBERS.sub("", line)
        bad = next((name for name, rx in OCR if rx.search(body)), None) or ("digits inside a line" if INLINE_DIGIT.search(body) else None)
        if bad:
            drops[f"ocr: {bad}"] += 1
            cur = []  # a damaged line spoils its couplet: drop the unit in progress
            continue
        ends = bool(VERSE_END.search(line))
        cur.append(NUMBERS.sub("", line).rstrip(" ।॥|").strip())
        if ends:
            units.append((raga, cur))
            cur = []
    if cur and not prose_check:  # a pad's last lines; a doha that never reached its numbered ॥ is dropped
        units.append((raga, cur))
    elif cur:
        drops["unnumbered couplet"] += 1
    return units


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    drops, rows, seen, labels = Counter(), [], set(), Counter()
    for path in sorted(SRC.glob("*.json")):
        col = json.loads(path.read_text())
        kept = 0
        for title, page in col["pages"].items():
            if SKIP_PAGES.search(title.split("/", 1)[-1]) or (col["collection"] == "kabir" and "अंग" not in title):
                drops["page skipped (essay, preface, Sanskrit)"] += 1
                continue
            units = clean_page(page["text"], title, drops, prose_check=col["form"] != "pad")
            if col["form"] != "pad":
                # A doha (or soratha) is a numbered couplet: lines before its last two are leftovers.
                whole = [(r, lines[-2:]) for r, lines in units if len(lines) >= 2]
                drops["half a couplet"] += sum(len(lines) == 1 for _, lines in units)
                units = whole
            if col["form"] == "pad":
                # A pad is one song: its couplets belong together.
                lines = [ln for _, u in units for ln in u]
                labelled = next((r for r, _ in units if r), None)
                units = [(labelled, lines)] if lines else []
            for raga, lines in units:
                if not lines:
                    continue
                if GLOSS_MARKS.search("\n".join(lines)):
                    drops["commentary left in a unit"] += 1
                    continue
                key = re.sub(r"\s+", "", "".join(lines))
                if key in seen:
                    drops["duplicate"] += 1
                    continue
                seen.add(key)
                if raga:
                    labels[raga] += 1
                rows.append({"source": col["collection"], "poet": col["poet"], "page": title, "raga_label": raga, "lines": lines,
                             "text": "\n".join(lines), "licence": col["licence"]})
                kept += 1
        print(f"{col['collection']:<12} {len(col['pages'])} pages → {kept} units")
    words = Counter(w for r in rows for w in WORD.findall(r["text"]))
    (OUT / "corpus.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")
    (OUT / "lexicon.txt").write_text("\n".join(sorted(words)) + "\n")
    report = {"units": len(rows), "lines": sum(len(r["lines"]) for r in rows), "words": len(words), "dropped": dict(drops.most_common()), "raga_labels": dict(labels.most_common())}
    (OUT / "cleaning.json").write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
