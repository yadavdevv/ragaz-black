"""A bandish as one composition: notes and words together, written the way Bhatkhande prints it.

For each cycle of Teentaal (4 bars, 16 beats), two lines:

    S R G - | P - G R | ...          swar: the notes, our sargam notation
    बु रा ऽ ऽ | जो ऽ दे खन | ...       bol: one token per beat

A bol token is a syllable (or two joined by ·, sung on the beat's notes in order), ऽ while the
previous syllable's vowel is held, or - where nothing is sung. A 16-bar bandish is four such
pairs: the first two cycles are the sthayi, the last two the antara.

score() is the reward for a model that composes both at once:

  reward = raga(notes) · aligned · fidelity · (0.35 + 0.65 · words)

  raga      the composer's v6 reward on the swar lines (16 bars)
  aligned   share of syllables that start where a note starts (none on a held "-")
  fidelity  words given: how much of them the bol line sings, in order (sequence match);
            words free: 1
  words     how the words sit on the notes the model chose: heavy syllables held a beat or more,
            light ones half a beat to a beat, not crowded, and one of the first six syllables landing on sam (the mukhda). Words
            free: × the share of the sung text that splits into real words (corpus lexicon),
            full credit from 70%
"""

import re
from difflib import SequenceMatcher

from ragaz.lyrics import syllables
from ragaz.notation import parse
from ragaz.verify import verify

HOLD, REST, JOIN = "ऽ", "-", "·"
DEVA = re.compile(r"[ऀ-ॿ]")
SWAR = re.compile(r"[SrRgGmMPdDnN]")
MUKHDA_SYLLABLES = 6


def to_text(notation: str, words: list[str]) -> str:
    """Interleave a notation (4 bars per cycle) with per-beat words (len = beats)."""
    bars = [b.strip() for line in notation.strip().splitlines() for b in line.split("|") if b.strip()]
    out = []
    for c in range(0, len(bars), 4):
        cycle = bars[c : c + 4]
        out.append(" | ".join(cycle) + " |")
        bol = [" ".join((words[(c + k) * 4 + j] or REST) for j in range(4)) for k in range(len(cycle))]
        out.append(" | ".join(bol) + " |")
    return "\n".join(out)


def split(text: str) -> tuple[str, list[str]]:
    """(notation, bol tokens per beat) from a reply. A bol line is any line with Devanagari, or
    only - / ऽ tokens, that follows a swar line."""
    swar, bol = [], []
    for raw in text.replace("```", "\n").splitlines():
        line = raw.strip()
        if not line:
            continue
        tokens = [t for t in line.replace("|", " ").split() if t]
        only_marks = tokens and all(t in (HOLD, REST) for t in tokens)
        if DEVA.search(line) or (only_marks and len(bol) < len(swar)):
            bol.append(tokens)
        elif SWAR.search(line):
            swar.append(line)
    return "\n".join(swar), [t for line in bol for t in line]


def covered(text: str, words: frozenset[str], longest: int = 14) -> float:
    """Share of characters of a word-boundary-free text that split into known words (DP)."""
    n = len(text)
    if not n:
        return 0.0
    best = [0] * (n + 1)  # best[i] = most characters covered in text[:i]
    for i in range(1, n + 1):
        best[i] = best[i - 1]
        for j in range(max(0, i - longest), i - 1):
            if text[j:i] in words:
                best[i] = max(best[i], best[j] + i - j)
    return best[n] / n


def score(text: str, raga: str, given: str | None = None) -> dict[str, float]:
    notation, tokens = split(text)
    s = {"raga": 0.0, "aligned": 0.0, "fidelity": 0.0, "fit": 0.0, "mukhda": 0.0, "known": 0.0, "reward": 0.0}
    if not notation:
        return s
    s["raga"] = verify(notation, raga, style="v6", target_bars=16).reward
    comp = parse(notation)
    beats = int(round(comp.beats))
    if not tokens or beats == 0:
        return s
    tokens = (tokens + [REST] * beats)[:beats]
    onsets = [n.start for n in comp.notes]

    # The syllables sung, and when each starts (two in one beat: the second half-way through).
    sung, starts, bad = [], [], 0
    for b, tok in enumerate(tokens):
        if tok in (HOLD, REST):
            continue
        parts = [p for p in tok.split(JOIN) if p]
        for i, p in enumerate(parts):
            t = b + i / len(parts)
            sung.append(p)
            starts.append(t)
            if not any(abs(o - t) < 0.26 for o in onsets):
                bad += 1  # nothing new is sung here: the syllable lands on a held note
    if not sung:
        return s
    s["aligned"] = 1 - bad / len(sung)

    if given:
        target = [x.text for x in syllables(given)]
        s["fidelity"] = SequenceMatcher(None, target, sung, autojunk=False).ratio()
    else:
        s["fidelity"] = 1.0

    # Weight of each sung syllable, from the text it spells (so conjuncts and silent final a count).
    syl = syllables(" ".join(sung))
    if len(syl) != len(sung):  # the bol line's own split disagrees with the syllabifier: weigh token by token
        syl = [syllables(p)[0] if syllables(p) else None for p in sung]
        keep = [i for i, x in enumerate(syl) if x is not None]
        syl, starts = [syl[i] for i in keep], [starts[i] for i in keep]
    half = beats / 2
    ends = starts[1:] + [beats]
    lens = [min(e, half if st < half else beats) - st for st, e in zip(starts, ends)]
    heavy = [ln >= 1 for x, ln in zip(syl, lens) if x.heavy]
    light = [0.5 <= ln <= 1 for x, ln in zip(syl, lens) if not x.heavy]
    crowded = sum(ln < 0.5 for ln in lens) / max(1, len(lens))
    # Word boundaries aren't visible in a bol line, so the mukhda rule is checked directly: one of
    # the sthayi's first six syllables starts exactly on sam (beat 1 of a cycle).
    s["mukhda"] = float(any(abs(t % 16) < 1e-6 and t < half for t in starts[:MUKHDA_SYLLABLES]))
    s["fit"] = (0.45 * (sum(heavy) / len(heavy) if heavy else 1.0) + 0.2 * (sum(light) / len(light) if light else 1.0)
                + 0.15 * (1 - crowded) + 0.2 * s["mukhda"])
    words = s["fit"]
    if not given:
        from ragaz.lyrics_reward import lexicon

        s["known"] = covered("".join(sung), lexicon())
        words *= min(1.0, s["known"] / 0.7)
    s["reward"] = s["raga"] * s["aligned"] * s["fidelity"] * (0.35 + 0.65 * words)
    return s


def place(verse: str, onsets: list[float], beats: float) -> list[str] | None:
    """Per-beat bol tokens for a verse set on notes (lyrics.set_words), or None if it can't fit."""
    from ragaz.lyrics import set_words

    syl = syllables(verse)
    fit = set_words(syl, onsets, beats) if syl else None
    if fit is None:
        return None
    n = int(round(beats))
    words = [""] * n
    stops = fit.starts[1:] + [None]
    for i, j in enumerate(fit.starts):
        t0 = onsets[j]
        t1 = onsets[stops[i]] if stops[i] is not None else min(beats, t0 + 4)
        first = int(t0)
        for b in range(first, min(n, max(first + 1, int(-(-t1 // 1))))):
            if b == first:
                words[b] = words[b] + JOIN + syl[i].text if words[b] and words[b] != HOLD else syl[i].text
            elif not words[b]:
                words[b] = HOLD
    return words
