// How a syllable sounds, roughly enough for a formant voice to sing it: the consonant it opens with
// (its kind) and its vowel (three formant targets). Devanagari is read from its letters; other
// scripts from their Latin, Greek or Cyrillic vowels, or kana; anything else sings "aa".

export type Onset = "none" | "stop" | "aspirate" | "fricative" | "sibilant" | "nasal" | "liquid" | "glide-i" | "glide-u";
export type Phone = { onset: Onset; vowel: string; f: [number, number, number] };

// Vowel formants (Hz), averaged across voices; Hindi short vowels are more central than long ones.
export const VOWELS: Record<string, [number, number, number]> = {
  "ə": [620, 1250, 2600], a: [780, 1220, 2600], i: [420, 1900, 2650], ī: [310, 2300, 3000],
  u: [430, 1050, 2450], ū: [330, 820, 2400], e: [460, 2050, 2700], ai: [600, 1800, 2600],
  o: [500, 900, 2500], au: [630, 980, 2500], "ṛ": [500, 1350, 1800],
};

// Devanagari (U+0900 block): vowel signs and independent vowels → vowel names.
const SIGN: Record<string, string> = { "ा": "a", "ि": "i", "ी": "ī", "ु": "u", "ू": "ū", "ृ": "ṛ", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o" };
const INDEPENDENT: Record<string, string> = { "अ": "ə", "आ": "a", "इ": "i", "ई": "ī", "उ": "u", "ऊ": "ū", "ऋ": "ṛ", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au" };
const KIND: [string, Onset][] = [
  ["कगटडतदपबचज", "stop"], ["खघठढथधफभछझ", "aspirate"], ["सशष", "sibilant"], ["हफ़ज़", "fricative"],
  ["मनणञङ", "nasal"], ["रलळ", "liquid"], ["य", "glide-i"], ["व", "glide-u"],
];

function devanagari(syl: string): Phone {
  const first = syl[0];
  const onset = INDEPENDENT[first] ? "none" : (KIND.find(([letters]) => letters.includes(first))?.[1] ?? "stop");
  let vowel = INDEPENDENT[first] ?? "ə";
  for (const ch of syl.slice(1)) if (SIGN[ch]) { vowel = SIGN[ch]; break; }
  return { onset, vowel, f: VOWELS[vowel] };
}

const LATIN_ONSET: [RegExp, Onset][] = [
  [/^(s|sh|z|x|ś|σ|ζ|ς|ш|с|з|ж)/, "sibilant"], [/^(h|f|th|v|φ|θ|х|ф)/, "fricative"], [/^(m|n|μ|ν|м|н)/, "nasal"],
  [/^(l|r|λ|ρ|л|р)/, "liquid"], [/^(y|j|й)/, "glide-i"], [/^(w|у)/, "glide-u"], [/^[aeiouyαεηιουωаеёиоуыэюя]/, "none"],
];
const LATIN_VOWEL: [RegExp, string][] = [
  [/ai|ay|ei|ey|αι|ει/, "ai"], [/au|aw|ou|αυ|ου/, "au"], [/ee|ea|ie|ī|η|ι|и|ы/, "ī"], [/oo|ū|ω|у|ю/, "ū"],
  [/a|ā|α|а|я/, "a"], [/e|ε|е|э|ё/, "e"], [/i/, "i"], [/o|ο|о/, "o"], [/u/, "u"], [/y/, "i"],
];
const KANA_VOWEL: [RegExp, string][] = [[/[あかさたなはまやらわがざだばぱアカサタナハマヤラワガザダバパ]/, "a"], [/[いきしちにひみりぎじぢびぴイキシチニヒミリギジヂビピ]/, "i"], [/[うくすつぬふむゆるぐずづぶぷウクスツヌフムユルグズヅブプ]/, "u"], [/[えけせてねへめれげぜでべぺエケセテネヘメレゲゼデベペ]/, "e"], [/[おこそとのほもよろをごぞどぼぽオコソトノホモヨロヲゴゾドボポ]/, "o"]];

/** Onset kind and vowel of one sung syllable, in any script. */
export function phone(syl: string): Phone {
  const s = syl.normalize("NFC");
  if (/[ऀ-ॿ]/.test(s)) return devanagari(s);
  if (/[぀-ヿ]/.test(s)) {
    const vowel = KANA_VOWEL.find(([rx]) => rx.test(s))?.[1] ?? "a";
    const onset: Onset = /^[あいうえおアイウエオ]/.test(s) ? "none" : /^[さしすせそざじずぜぞサシスセソザジズゼゾ]/.test(s) ? "sibilant" : /^[なにぬねのまみむめもんナニヌネノマミムメモン]/.test(s) ? "nasal" : /^[らりるれろラリルレロ]/.test(s) ? "liquid" : /^[はひふへほハヒフヘホ]/.test(s) ? "fricative" : "stop";
    return { onset, vowel, f: VOWELS[vowel] };
  }
  const base = [...s.toLowerCase()].map((c) => c.normalize("NFD")[0]).join("");
  if (/[a-zα-ωа-я]/.test(base)) {
    const onset = LATIN_ONSET.find(([rx]) => rx.test(base))?.[1] ?? "stop";
    const vowel = LATIN_VOWEL.find(([rx]) => rx.test(base))?.[1] ?? "ə";
    return { onset, vowel, f: VOWELS[vowel] };
  }
  return { onset: "none", vowel: "a", f: VOWELS.a };
}

/** A sung text event: at `t` (beats) the voice starts this syllable. */
export type Lyric = { t: number; syl: string };
