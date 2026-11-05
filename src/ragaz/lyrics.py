"""The lyric verifier: how well a text sits on a composition, the way a bandish sets its words.

Python port of web/lib/words.ts (Brahmic scripts: Devanagari and the others that share its
Unicode layout), so the reward a lyrics model is trained with is exactly what the site shows.
Parity: scripts/lyrics_parity.py.

  heavy   long vowel, anusvara/visarga, before a conjunct, or closed by a consonant (guru)
  light   short open syllable (laghu)
  open    the vowel is a / aa / e / ai / o / au, which singers carry through runs

The setter places syllables on note onsets by dynamic programming: heavy syllables on notes
of a beat or more, at most two syllables a beat, the mukhda's last syllable on sam, lines
ending long. Its fit is the reward's core.
"""

from dataclasses import dataclass, field

BRAHMIC = [(0x0900, 0x097F), (0x0980, 0x09FF), (0x0A00, 0x0A7F), (0x0A80, 0x0AFF), (0x0B00, 0x0B7F), (0x0B80, 0x0BFF), (0x0C00, 0x0C7F), (0x0C80, 0x0CFF), (0x0D00, 0x0D7F)]
LONG_INDEPENDENT = {0x06, 0x08, 0x0A, 0x0F, 0x10, 0x13, 0x14}
LONG_SIGN = {0x3E, 0x40, 0x42, 0x47, 0x48, 0x4B, 0x4C}
OPEN_SIGN = {0x3E, 0x46, 0x47, 0x48, 0x4A, 0x4B, 0x4C}
OPEN_INDEPENDENT = {0x05, 0x06, 0x0E, 0x0F, 0x10, 0x12, 0x13, 0x14}
VIRAMA, NUKTA = 0x4D, 0x3C
DANDA = "।॥"


def _block(c: int) -> int:
    return next((a for a, b in BRAHMIC if a <= c <= b), -1)


def _off(c: int) -> int:
    return c - _block(c)


def _consonant(c: int) -> bool:
    return _block(c) >= 0 and (0x15 <= _off(c) <= 0x39 or 0x58 <= _off(c) <= 0x5F)


def _ind_vowel(c: int) -> bool:
    return _block(c) >= 0 and 0x05 <= _off(c) <= 0x14


def _sign(c: int) -> bool:
    return _block(c) >= 0 and 0x3E <= _off(c) <= 0x4C


def _mark(c: int) -> bool:
    return _block(c) >= 0 and _off(c) in (0x01, 0x02, 0x03)


@dataclass
class Syllable:
    text: str
    heavy: bool
    open: bool
    word_start: bool = False
    line_start: bool = False
    line: int = 0


def _aksharas(cs: list[int]) -> list[dict]:
    out, i = [], 0
    while i < len(cs):
        cps, consonants, sign, vowel, dead = [], 0, None, None, False
        if _ind_vowel(cs[i]):
            vowel = _off(cs[i])
            cps.append(cs[i])
            i += 1
        elif _consonant(cs[i]):
            cps.append(cs[i])
            i += 1
            consonants = 1
            if i < len(cs) and _off(cs[i]) == NUKTA:
                cps.append(cs[i])
                i += 1
            while i < len(cs) and _off(cs[i]) == VIRAMA:
                cps.append(cs[i])
                i += 1
                if i < len(cs) and _consonant(cs[i]):
                    cps.append(cs[i])
                    i += 1
                    consonants += 1
                    if i < len(cs) and _off(cs[i]) == NUKTA:
                        cps.append(cs[i])
                        i += 1
                else:
                    dead = True
                    break
            if not dead and i < len(cs) and _sign(cs[i]):
                sign = _off(cs[i])
                cps.append(cs[i])
                i += 1
        else:
            i += 1
            continue
        marks = []
        while i < len(cs) and _mark(cs[i]):
            marks.append(_off(cs[i]))
            cps.append(cs[i])
            i += 1
        out.append({"cps": cps, "consonants": consonants, "sign": sign, "vowel": vowel, "dead": dead, "marks": marks})
    return out


def _brahmic_word(word: str, devanagari: bool) -> list[Syllable]:
    ak = _aksharas([ord(ch) for ch in word])
    out: list[Syllable] = []
    for i, a in enumerate(ak):
        text = "".join(chr(c) for c in a["cps"])
        bare_final = devanagari and i == len(ak) - 1 and i > 0 and a["consonants"] == 1 and a["sign"] is None and not a["marks"]
        if (a["dead"] or bare_final) and out:
            # A dead consonant, or Hindi/Braj's silent final a (कमल = ka-mal): it closes the syllable before.
            out[-1].text += text
            out[-1].heavy = True
            continue
        long = a["vowel"] in LONG_INDEPENDENT if a["vowel"] is not None else a["sign"] is not None and a["sign"] in LONG_SIGN
        open_ = a["vowel"] in OPEN_INDEPENDENT if a["vowel"] is not None else a["sign"] is None or a["sign"] in OPEN_SIGN
        nasal_or_visarga = any(m in (0x02, 0x03) for m in a["marks"])
        out.append(Syllable(text, long or nasal_or_visarga, open_))
        if i + 1 < len(ak) and ak[i + 1]["consonants"] >= 2:
            out[-1].heavy = True  # a conjunct opens the next akshara: guru by position
    return out


def _letters(word: str) -> str:
    return "".join(ch for ch in word if _block(ord(ch)) >= 0)


def syllables(text: str) -> list[Syllable]:
    """Syllables of a Brahmic-script text, line by line. Other scripts are ignored here."""
    out: list[Syllable] = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for li, line in enumerate(lines):
        first = True
        for word in line.replace(",", " ").split():
            clean = _letters(word)
            if not clean:
                continue
            deva = any(0x0900 <= ord(ch) <= 0x097F for ch in clean)
            raw = _brahmic_word(clean, deva)
            for k, s in enumerate(raw):
                s.word_start, s.line_start, s.line = k == 0, first and k == 0, li
                out.append(s)
            first = False
    return out


def mukhda_index(syl: list[Syllable]) -> int:
    """End of the mukhda: the first two words (or the first word if long). Lands on sam."""
    words = 0
    for i, s in enumerate(syl):
        if s.word_start:
            words += 1
        next_starts = i + 1 >= len(syl) or syl[i + 1].word_start
        if next_starts and (words >= 2 or i >= 3):
            return i
    return min(len(syl) - 1, 2)


W = {"heavy_long": 1.0, "heavy_short": -1.2, "light_long": -0.4, "light_fits": 0.3, "crowded": -1.0, "extra_note": -0.18, "extra_note_open": -0.06, "sam": 4.0, "line_end_long": 1.2, "line_start_bar": 0.4, "rest": -0.3}
NEG = -1e9


@dataclass
class Fit:
    score: float
    heavy_on_long: float
    light_on_short: float
    mukhda_on_sam: bool
    line_ends_long: float
    melisma: float
    syllables: int
    starts: list[int] = field(default_factory=list)


def set_words(syl: list[Syllable], onsets: list[float], beats: float) -> Fit | None:
    """onsets: note start times in beats, in order. Same algorithm and weights as words.ts."""
    k, m = len(syl), len(onsets)
    if not k or m < k:
        return None
    mk = mukhda_index(syl)

    def end(e: int) -> float:
        return onsets[e] if e < m else beats

    def gain(i: int, j: int, e: int) -> float:
        s = syl[i]
        ln = end(e) - onsets[j]
        if s.heavy:
            g = W["heavy_long"] if ln >= 1 else W["heavy_short"] if ln < 0.5 else 0.0
        else:
            g = W["light_long"] if ln > 2 else W["light_fits"] if 0.5 <= ln <= 1 else 0.0
        if ln < 0.5:
            g += W["crowded"]
        g += (e - j - 1) * (W["extra_note_open"] if s.open else W["extra_note"])
        if i == mk and abs(onsets[j] % 16) < 1e-6:
            g += W["sam"]
        if (i == k - 1 or syl[i + 1].line != s.line) and ln >= 1.5:
            g += W["line_end_long"]
        if s.line_start and abs(onsets[j] % 4) < 1e-6:
            g += W["line_start_bar"]
        return g

    best = [[NEG] * m for _ in range(k)]
    back = [[-1] * m for _ in range(k)]
    for j in range(0, m - k + 1):
        best[0][j] = W["rest"] * min(j, 8) * 0.25
    for i in range(1, k):
        for j in range(i, m - (k - i) + 1):
            b, arg = NEG, -1
            for p in range(max(i - 1, j - 8), j):
                if best[i - 1][p] == NEG:
                    continue
                v = best[i - 1][p] + gain(i - 1, p, j)
                if v > b:
                    b, arg = v, p
            best[i][j], back[i][j] = b, arg
    total, last_j, last_e = NEG, -1, -1
    for j in range(k - 1, m):
        if best[k - 1][j] == NEG:
            continue
        for e in range(j + 1, min(m, j + 8) + 1):
            v = best[k - 1][j] + gain(k - 1, j, e)
            if v > total:
                total, last_j, last_e = v, j, e
    if last_j < 0:
        return None
    starts = [0] * k
    starts[-1] = last_j
    for i in range(k - 1, 0, -1):
        starts[i - 1] = back[i][starts[i]]
    stops = starts[1:] + [last_e]
    lens = [end(stops[i]) - onsets[j] for i, j in enumerate(starts)]
    heavy = [ln for s, ln in zip(syl, lens) if s.heavy]
    light = [ln for s, ln in zip(syl, lens) if not s.heavy]
    ends = [ln for i, ln in enumerate(lens) if i == k - 1 or syl[i + 1].line != syl[i].line]
    return Fit(
        score=total / k,
        heavy_on_long=sum(ln >= 1 for ln in heavy) / len(heavy) if heavy else 1.0,
        light_on_short=sum(ln <= 1 for ln in light) / len(light) if light else 1.0,
        mukhda_on_sam=abs(onsets[starts[mk]] % 16) < 1e-6,
        line_ends_long=sum(ln >= 1.5 for ln in ends) / len(ends) if ends else 1.0,
        melisma=sum(stops[i] - j - 1 for i, j in enumerate(starts)) / k,
        syllables=k,
        starts=starts,
    )
