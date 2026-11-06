"""The reward for the lyrics writer (Bandish mode): words that fit a composition and its raga.

A reply is four Devanagari lines: two for the sthayi (set on the piece's first 8 bars) and two
for the antara (the last 8). As for the composer, hard rules multiply and style is weighted:

  reward = lines · script · words² · copy · repetition
           · (0.5 fit + 0.2 rhyme + 0.15 imagery + 0.15 length)

  lines       exactly four lines (three or five: half)
  script      share of letters in Devanagari (Braj/Hindi), ⁴
  words       share of words found in the corpus lexicon (public-domain Braj/Hindi poetry), the
              guard against syllable-fitting gibberish; full credit from 85%
  copy        no run of 5+ words copied from the corpus (4 words: ×0.7)
  repetition  distinct words / words below 0.5 scales down (one word over and over)
  fit         the setter (lyrics.py): heavy syllables on held notes, light on quick ones, lines
              ending long, and the sthayi's mukhda landing on sam
  rhyme       antya-anupras: line 1/2 and 3/4 endings share a vowel (0.5) and consonant (1)
  imagery     words of this raga's hour, season and mood (our own list, not reviewed); two
              different ones give full credit, the same one 3+ times halves it
  length      each line has 6–16 syllables
"""

import json
import re
from functools import cache
from pathlib import Path

from ragaz.lyrics import set_words, syllables

LEXICON = Path("data/lyrics/lexicon.txt")
CORPUS = Path("data/lyrics/corpus.jsonl")
WORDS_FULL = 0.85
COPY_N = 5

# Words of each raga's hour, season and mood. Ours, for the reward; not reviewed by a poet.
IMAGERY = {
    "bhairav": "भोर प्रभात उषा जागो सवेरा शंकर शिव महादेव गंगा डमरू ध्यान आरती कमल",
    "todi": "बिरह पिया नैन अँसुवन बाट सूनो बिछुरे मृग बन बंसी सखी",
    "deshkar": "भोर सूरज उजियारा किरन जागो प्रभात सवेरा",
    "shuddh_sarang": "दुपहरी धूप घाम तपन छाँह जेठ कुंज गैया बन",
    "madhuvanti": "मधुर प्रीत प्रीतम मनभावन रस सजन मन साँवरे",
    "marwa": "साँझ संध्या गोधूलि दीप बाती बेला सूनी उदास बिरह",
    "yaman": "साँझ दीप पिया सखी मोहन श्याम बंसी प्रीत",
    "bhupali": "चाँदनी साँझ गोविंद जमुना बंसी शीतल चंदा",
    "bihag": "रैन चाँद चंदा सेज पिया नींद रतियाँ तारे जागी",
    "darbari": "निसि अँधियारी रतियाँ सूनी साहिब दरबार ध्यान गंभीर",
    "malkauns": "निसा ध्यान जोगी शिव रात तारे मौन अँधियारी",
    "miyan_malhar": "बादर बदरा बदरिया घटा बिजुरी बरसे मेघ सावन पपीहा मोर बूँद झूला कारी",
    "basant": "बसंत फागुन सरसों कोयल फूल बौर अमुवा होरी गुलाल केसर बहार",
}

DEVA = re.compile(r"[ऀ-ॿ]")
LETTER = re.compile(r"[^\W\d_]", re.U)
WORD = re.compile(r"[ऀ-ॣ०-ॿ]+")  # Devanagari words, without danda (।॥)


@cache
def lexicon() -> frozenset[str]:
    words = set(LEXICON.read_text().split()) if LEXICON.exists() else set()
    return frozenset(words | {w for ws in IMAGERY.values() for w in ws.split()})


@cache
def corpus_ngrams() -> frozenset[tuple[str, ...]]:
    grams = set()
    if CORPUS.exists():
        for line in CORPUS.read_text().splitlines():
            words = WORD.findall(json.loads(line)["text"])
            grams |= {tuple(words[i : i + 4]) for i in range(len(words) - 3)}
    return frozenset(grams)


def reply_lines(text: str) -> list[str]:
    """Lines of verse in a reply: drop code fences, labels (स्थायी:, अंतरा:) and empty lines."""
    out = []
    for raw in text.replace("```", "\n").splitlines():
        line = re.sub(r"^\s*(स्थायी|स्थाई|अंतरा|अन्तरा|sthayi|antara)\s*[:：\-–]?\s*", "", raw.strip(), flags=re.I)
        line = re.sub(r"^\s*[\d१२३४]+[.)]\s*", "", line).strip(" ।॥|,")
        if line and DEVA.search(line):
            out.append(line)
    return out


def _end_sound(line: str) -> tuple[str, str]:
    """(vowel sign or inherent a, final consonant) of a line's last syllable."""
    syl = syllables(line)
    if not syl:
        return ("", "")
    last = syl[-1].text
    vowel = next((ch for ch in reversed(last) if 0x093E <= ord(ch) <= 0x094C or 0x0905 <= ord(ch) <= 0x0914), "a")
    cons = next((ch for ch in reversed(last) if 0x0915 <= ord(ch) <= 0x0939), "")
    return (vowel, cons)


def _rhyme(a: str, b: str) -> float:
    va, ca = _end_sound(a)
    vb, cb = _end_sound(b)
    return 1.0 if (va, ca) == (vb, cb) and va else 0.5 if va == vb and va else 0.0


def score(text: str, raga: str, onsets: list[float], beats: float) -> dict[str, float]:
    """onsets: the composition's note start times in beats (16 bars = 64 beats)."""
    lines = reply_lines(text)
    s = {k: 0.0 for k in ("lines", "script", "words", "copy", "repetition", "fit", "mukhda", "rhyme", "imagery", "length")}
    if len(lines) < 2:
        return s | {"reward": 0.0}
    s["lines"] = 1.0 if len(lines) == 4 else 0.5 if len(lines) in (3, 5) else 0.2
    lines = (lines + [""] * 4)[:4]
    body = "\n".join(lines)
    letters = LETTER.findall(body)
    s["script"] = (sum(bool(DEVA.match(c)) for c in letters) / max(1, len(letters))) ** 4
    words = WORD.findall(body)
    if not words:
        return s | {"reward": 0.0}
    known = sum(w in lexicon() for w in words) / len(words)
    s["words"] = min(1.0, known / WORDS_FULL)
    grams = corpus_ngrams()
    longest = 0
    for i in range(len(words) - 3):
        if tuple(words[i : i + 4]) in grams:
            longest = max(longest, 4 + (i + 4 < len(words) and tuple(words[i + 1 : i + 5]) in grams))
    s["copy"] = 0.3 if longest >= COPY_N else 0.7 if longest == 4 else 1.0
    distinct = len(set(words)) / len(words)
    s["repetition"] = min(1.0, distinct / 0.5)

    # Fit: sthayi on bars 1–8, antara on bars 9–16 (shifted so each half starts on sam).
    half = beats / 2
    parts = [("\n".join(lines[:2]), [t for t in onsets if t < half], 0.0), ("\n".join(lines[2:]), [t - half for t in onsets if t >= half], half)]
    fits = []
    for k, (verse, ons, _) in enumerate(parts):
        syl = syllables(verse)
        fit = set_words(syl, ons, half) if syl else None
        if fit is None:
            fits.append(0.0)
            continue
        if k == 0:
            s["mukhda"] = float(fit.mukhda_on_sam)
        fits.append(0.4 * fit.heavy_on_long + 0.2 * fit.light_on_short + 0.2 * fit.line_ends_long + 0.2 * float(fit.mukhda_on_sam))
    s["fit"] = sum(fits) / 2
    s["rhyme"] = (_rhyme(lines[0], lines[1]) + _rhyme(lines[2], lines[3])) / 2
    images = [w for w in words if w in IMAGERY.get(raga, "").split()]
    s["imagery"] = min(1.0, len(set(images)) / 2) * (0.5 if any(images.count(w) >= 3 for w in set(images)) else 1.0)
    counts = [len(syllables(ln)) for ln in lines]
    s["length"] = sum(6 <= c <= 16 for c in counts) / 4

    gate = s["lines"] * s["script"] * s["words"] ** 2 * s["copy"] * s["repetition"]
    shaped = 0.5 * s["fit"] + 0.2 * s["rhyme"] + 0.15 * s["imagery"] + 0.15 * s["length"]
    return s | {"reward": gate * shaped, "gate": gate, "shaped": shaped}
