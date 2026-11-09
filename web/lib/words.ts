// Words for a raga, in any language: split a text into syllables, weigh them, and set them on a
// composition the way a bandish sets its text. This is also the lyric verifier: the fit score
// below is what a lyrics model will be rewarded with.
//
//   heavy   a long vowel, or a syllable closed by a consonant (Hindi/Sanskrit guru, Latin "long")
//   light   a short open syllable (laghu)
//   open    the vowel is a / e / o, which singers carry through runs
//
// Scripts: Devanagari and the other Brahmic scripts (Tamil, Bengali, Gujarati, Gurmukhi, Telugu,
// Kannada, Malayalam: their Unicode blocks share one layout), Latin, Greek, Cyrillic, Japanese kana,
// Hangul, and Han characters (one syllable each; length unknown, so light).

import type { Note } from "./music";

export type Syllable = { text: string; heavy: boolean; open: boolean; wordStart: boolean; lineStart: boolean; line: number };
export type Placement = { syllable: number; note: number }; // syllable i starts on note index j
export type Setting = {
  placements: Placement[];
  words: string[]; // per beat: syllable(s) starting there, ऽ where a vowel is held, "" for silence
  mukhda: number; // index of the syllable that lands on sam
  fit: Fit;
};
export type Fit = { score: number; heavyOnLong: number; lightOnShort: number; mukhdaOnSam: boolean; lineEndsLong: number; melisma: number; syllables: number };

// ------------------------------------------------------------------ syllables

const BRAHMIC: [number, number][] = [[0x0900, 0x097f], [0x0980, 0x09ff], [0x0a00, 0x0a7f], [0x0a80, 0x0aff], [0x0b00, 0x0b7f], [0x0b80, 0x0bff], [0x0c00, 0x0c7f], [0x0c80, 0x0cff], [0x0d00, 0x0d7f]];
// Offsets inside every Brahmic block (the shared ISCII layout).
const LONG_INDEPENDENT = new Set([0x06, 0x08, 0x0a, 0x0f, 0x10, 0x13, 0x14]);
const LONG_SIGN = new Set([0x3e, 0x40, 0x42, 0x47, 0x48, 0x4b, 0x4c]);
const OPEN_SIGN = new Set([0x3e, 0x46, 0x47, 0x48, 0x4a, 0x4b, 0x4c]); // aa, e, ai, o, au
const OPEN_INDEPENDENT = new Set([0x05, 0x06, 0x0e, 0x0f, 0x10, 0x12, 0x13, 0x14]);
const VIRAMA = 0x4d, NUKTA = 0x3c;

const brahmic = (c: number) => BRAHMIC.find(([a, b]) => c >= a && c <= b)?.[0] ?? -1;
const off = (c: number) => c - brahmic(c);
const isConsonant = (c: number) => brahmic(c) >= 0 && ((off(c) >= 0x15 && off(c) <= 0x39) || (off(c) >= 0x58 && off(c) <= 0x5f));
const isIndependentVowel = (c: number) => brahmic(c) >= 0 && off(c) >= 0x05 && off(c) <= 0x14;
const isSign = (c: number) => brahmic(c) >= 0 && off(c) >= 0x3e && off(c) <= 0x4c;
const isMark = (c: number) => brahmic(c) >= 0 && [0x01, 0x02, 0x03].includes(off(c)); // candrabindu, anusvara, visarga

type Raw = { text: string; heavy: boolean; open: boolean };

/** Aksharas as the script writes them: a consonant cluster (joined by virama) or an independent
 *  vowel, then an optional vowel sign and marks; or a dead consonant (consonant + virama, no vowel). */
function aksharas(cs: number[]) {
  const out: { cps: number[]; consonants: number; sign: number | null; vowel: number | null; dead: boolean; marks: number[] }[] = [];
  let i = 0;
  while (i < cs.length) {
    const cps: number[] = [];
    let consonants = 0, sign: number | null = null, vowel: number | null = null, dead = false;
    if (isIndependentVowel(cs[i])) {
      vowel = off(cs[i]);
      cps.push(cs[i++]);
    } else if (isConsonant(cs[i])) {
      cps.push(cs[i++]);
      consonants = 1;
      if (cs[i] !== undefined && off(cs[i]) === NUKTA) cps.push(cs[i++]);
      while (cs[i] !== undefined && off(cs[i]) === VIRAMA) {
        cps.push(cs[i++]);
        if (cs[i] !== undefined && isConsonant(cs[i])) {
          cps.push(cs[i++]);
          consonants++;
          if (cs[i] !== undefined && off(cs[i]) === NUKTA) cps.push(cs[i++]);
        } else {
          dead = true;
          break;
        }
      }
      if (!dead && cs[i] !== undefined && isSign(cs[i])) sign = off(cs[i]), cps.push(cs[i++]);
    } else {
      i++;
      continue;
    }
    const marks: number[] = [];
    while (cs[i] !== undefined && isMark(cs[i])) marks.push(off(cs[i])), cps.push(cs[i++]);
    out.push({ cps, consonants, sign, vowel, dead, marks });
  }
  return out;
}

// Hindi's silent inherent a (Ohala's rule, right to left): the final one (कमल = ka-mal), and a
// medial one between a vowel and a consonant that keeps its vowel (आपना = aap-naa, समझना = sa-majh-naa).
function silentSchwas(ak: ReturnType<typeof aksharas>): Set<number> {
  const bare = (a: (typeof ak)[number]) => a.vowel === null && !a.dead && a.consonants === 1 && a.sign === null && !a.marks.length;
  const n = ak.length;
  const silent = new Set<number>(n > 1 && bare(ak[n - 1]) ? [n - 1] : []);
  for (let i = n - 2; i > 0; i--) {
    const next = ak[i + 1];
    if (bare(ak[i]) && !silent.has(i - 1) && !ak[i - 1].dead && next.vowel === null && next.consonants === 1 && !next.dead && !silent.has(i + 1)) silent.add(i);
  }
  return silent;
}

function brahmicWord(w: string, devanagari: boolean): Raw[] {
  const ak = aksharas([...w].map((ch) => ch.codePointAt(0)!));
  const silent = devanagari ? silentSchwas(ak) : new Set<number>();
  const out: Raw[] = [];
  ak.forEach((a, i) => {
    const text = String.fromCodePoint(...a.cps);
    if ((a.dead || silent.has(i)) && out.length) {
      // A dead consonant, or a silent a (कमल = ka-mal, आपना = aap-naa): it closes the syllable before.
      out[out.length - 1].text += text;
      out[out.length - 1].heavy = true;
      return;
    }
    const long = a.vowel !== null ? LONG_INDEPENDENT.has(a.vowel) : a.sign !== null && LONG_SIGN.has(a.sign);
    const open = a.vowel !== null ? OPEN_INDEPENDENT.has(a.vowel) : a.sign === null || OPEN_SIGN.has(a.sign);
    const nasalOrVisarga = a.marks.some((m) => m === 0x02 || m === 0x03); // candrabindu only nasalises
    out.push({ text, heavy: long || nasalOrVisarga, open });
    // A conjunct opens the next akshara: its first consonant closes this syllable (guru by position).
    const next = ak[i + 1];
    if (next && next.consonants >= 2) out[out.length - 1].heavy = true;
  });
  return out;
}

const VOWELS = "aeiouyàáâäãåæèéêëìíîïòóôöõøùúûüýÿœαεηιουωάέήίόύώϊϋΐΰаеёиоуыэюяіїє";
const LONG_LETTERS = "ηωāēīōū";
const OPEN_LETTERS = "aeoàáâäãåæèéêëòóôöõøœαεοωάέόώаеёоэя";
const ONSETS = ["th", "sh", "ch", "ph", "gh", "kh", "bh", "dh", "zh", "qu", "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tr", "tw"];
// (No s-clusters: Persian, Hindi and the Romance languages split them, mis-kin, as-tro; English
// singers often do too.)

function alphabeticWord(word: string): Raw[] {
  // Work letter by letter on base forms (accents and breathings stripped), keeping the original text.
  const chars = [...word];
  let base = chars.map((c) => c.normalize("NFD")[0].toLowerCase());
  // y before a vowel is a glide (ba-ti-yan, na-ye), not a vowel.
  const isVAt = (i: number) => VOWELS.includes(base[i]) && !(base[i] === "y" && (i === 0 || VOWELS.includes(base[i + 1] ?? "")));
  const isV = (ch: string) => VOWELS.includes(ch);
  const str = () => base.join("");
  // English silent final e (grace, sweet-ne): drop it if another vowel comes before.
  let n = chars.length;
  if (/[a-z][^aeiouy]e$/.test(str()) && base.slice(0, -1).some(isV) && !/le$/.test(str())) {
    n -= 1;
    base = base.slice(0, -1);
  }
  // English -ed after a consonant other than t/d is no syllable of its own (watched, played).
  if (/[^aeioutd]ed$/.test(str()) && base.slice(0, -3).some(isV)) base[base.length - 2] = "_";
  const groups: { start: number; end: number }[] = [];
  for (let i = 0; i < base.length; ) {
    if (isVAt(i)) {
      let j = i;
      while (j + 1 < base.length && isVAt(j + 1)) j++;
      groups.push({ start: i, end: j });
      i = j + 1;
    } else i++;
  }
  if (!groups.length) return [{ text: word, heavy: true, open: false }];
  const out: Raw[] = [];
  let cut = 0;
  for (let g = 0; g < groups.length; g++) {
    const { start, end } = groups[g];
    const next = groups[g + 1];
    let stop: number, closed: boolean;
    if (!next) {
      stop = chars.length; // includes a dropped silent e
      closed = end < n - 1;
    } else {
      const between = base.slice(end + 1, next.start).join("");
      // One consonant goes with the next syllable; of two or more, the first closes this one
      // (unless the pair is a common onset like "tr").
      const onsetKeep = between.length >= 2 && ONSETS.includes(between.slice(-2)) ? 2 : 1;
      const coda = Math.max(0, between.length - onsetKeep);
      stop = end + 1 + coda;
      closed = coda > 0;
    }
    const vowel = base.slice(start, end + 1);
    const original = chars.slice(start, end + 1).map((c) => c.toLowerCase());
    const heavy = closed || vowel.length > 1 || original.some((c) => LONG_LETTERS.includes(c) || LONG_LETTERS.includes(c.normalize("NFD")[0]));
    out.push({ text: chars.slice(cut, stop).join(""), heavy, open: vowel.some((c) => OPEN_LETTERS.includes(c)) });
    cut = stop;
  }
  return out;
}

const SMALL_KANA = "ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ";
const LENGTHENERS = "ーっッんン";

function kanaWord(w: string): Raw[] {
  const out: Raw[] = [];
  for (const ch of w) {
    if ((SMALL_KANA.includes(ch) || LENGTHENERS.includes(ch)) && out.length) {
      out[out.length - 1].text += ch;
      if (LENGTHENERS.includes(ch)) out[out.length - 1].heavy = true;
    } else out.push({ text: ch, heavy: false, open: /[あかさたなはまやらわがざだばぱおこそとのほもよろごぞどぼぽえけせてねへめれげぜでべぺアカサタナハマヤラワガザダバパオコソトノホモヨロゴゾドボポエケセテネヘメレゲゼデベペ]/.test(ch) });
  }
  return out;
}

const scriptOf = (ch: string): "brahmic" | "deva" | "kana" | "hangul" | "han" | "alpha" | "other" => {
  const c = ch.codePointAt(0)!;
  if (c >= 0x0900 && c <= 0x097f) return "deva";
  if (brahmic(c) >= 0) return "brahmic";
  if ((c >= 0x3040 && c <= 0x30ff) || c === 0x30fc) return "kana";
  if (c >= 0xac00 && c <= 0xd7af) return "hangul";
  if (c >= 0x4e00 && c <= 0x9fff) return "han";
  if (/\p{L}/u.test(ch)) return "alpha";
  return "other";
};

/** Every syllable of a text, line by line (a line break or a comma-like pause starts a new line). */
export function syllables(text: string): Syllable[] {
  const out: Syllable[] = [];
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, li) => {
    const words = line.match(/[\p{L}\p{M}।॥'’-]+/gu) ?? [];
    let first = true;
    for (const word of words) {
      const clean = word.replace(/[।॥]/g, "");
      if (!clean) continue;
      const scripts = new Set([...clean].map(scriptOf).filter((s) => s !== "other"));
      let raw: Raw[];
      if (scripts.has("deva")) raw = brahmicWord(clean, true);
      else if (scripts.has("brahmic")) raw = brahmicWord(clean, false);
      else if (scripts.has("kana") || scripts.has("han")) raw = scripts.has("han") && !scripts.has("kana") ? [...clean].map((c) => ({ text: c, heavy: false, open: true })) : kanaWord(clean);
      else if (scripts.has("hangul")) raw = [...clean].map((c) => ({ text: c, heavy: (c.codePointAt(0)! - 0xac00) % 28 !== 0, open: true }));
      else raw = alphabeticWord(clean.replace(/['’-]/g, ""));
      raw.forEach((r, k) => {
        out.push({ ...r, wordStart: k === 0, lineStart: first && k === 0, line: li });
      });
      first = false;
    }
  });
  return out;
}

// ------------------------------------------------------------------ setting

/** The mukhda: the opening phrase of the text, whose last syllable should land on sam.
 *  Here, the end of the first two words (or of the first word if it is long). */
export function mukhdaIndex(syl: Syllable[]): number {
  let words = 0;
  for (let i = 0; i < syl.length; i++) {
    if (syl[i].wordStart) words++;
    const nextStartsWord = i + 1 >= syl.length || syl[i + 1].wordStart;
    if (nextStartsWord && (words >= 2 || i >= 3)) return i;
  }
  return Math.min(syl.length - 1, 2);
}

// A bandish in madhya laya sings about one syllable a beat, two at most: a syllable shorter than
// half a beat is crowded, whatever its weight.
const W = { heavyLong: 1.0, heavyShort: -1.2, lightLong: -0.4, lightFits: 0.3, crowded: -1.0, extraNote: -0.18, extraNoteOpen: -0.06, sam: 4.0, lineEndLong: 1.2, lineStartBar: 0.4, rest: -0.3, dragged: -0.6 };

/** Set the syllables on a composition's notes (best placement by dynamic programming). */
export function setWords(syl: Syllable[], notes: Note[], beats: number): Setting | null {
  const k = syl.length, m = notes.length;
  if (!k || m < k) return null;
  const mk = mukhdaIndex(syl);
  const onSam = (j: number) => Math.abs(notes[j].t % 16) < 1e-6;
  // dur(j, e): time from note j's start to note e's start (the syllable is held through the notes between).
  const end = (e: number) => (e < m ? notes[e].t : beats);
  const gain = (i: number, j: number, e: number) => {
    const s = syl[i];
    const len = end(e) - notes[j].t;
    let g = s.heavy ? (len >= 1 ? W.heavyLong : len < 0.5 ? W.heavyShort : 0) : (len > 2 ? W.lightLong : len >= 0.5 && len <= 1 ? W.lightFits : 0);
    if (len < 0.5) g += W.crowded;
    g += (e - j - 1) * (s.open ? W.extraNoteOpen : W.extraNote);
    if (i === mk && onSam(j)) g += W.sam;
    const lineEnd = i === k - 1 || syl[i + 1].line !== s.line;
    if (lineEnd && len >= 1.5) g += W.lineEndLong;
    const limit = lineEnd ? 4 : 2.5;
    if (len > limit) g += W.dragged * (len - limit); // held so long the word comes apart
    if (s.lineStart && Math.abs(notes[j].t % 4) < 1e-6) g += W.lineStartBar;
    return g;
  };
  // best[i][j] = best score with syllable i starting on note j (syllables after i not yet placed).
  const NEG = -1e9;
  const best = Array.from({ length: k }, () => new Float64Array(m).fill(NEG));
  const from = Array.from({ length: k }, () => new Int32Array(m).fill(-1));
  // The text begins in the first cycle, as a bandish does (a pickup before sam is fine); each beat
  // of waiting past beat 8 costs a little.
  for (let j = 0; j <= m - k; j++) best[0][j] = notes[j].t < 16 ? W.rest * Math.max(0, notes[j].t - 8) * 0.25 : NEG;
  for (let i = 1; i < k; i++) {
    for (let j = i; j <= m - (k - i); j++) {
      let b = NEG, arg = -1;
      for (let p = i - 1; p < j; p++) {
        if (best[i - 1][p] === NEG || j - p > 8) continue; // at most 8 notes on one syllable
        const v = best[i - 1][p] + gain(i - 1, p, j);
        if (v > b) { b = v; arg = p; }
      }
      best[i][j] = b;
      from[i][j] = arg;
    }
  }
  // The last syllable is held to the end of its phrase: up to 8 notes or the piece's end.
  let total = NEG, lastJ = -1, lastE = -1;
  for (let j = k - 1; j < m; j++) {
    if (best[k - 1][j] === NEG) continue;
    for (let e = j + 1; e <= Math.min(m, j + 8); e++) {
      const v = best[k - 1][j] + gain(k - 1, j, e);
      if (v > total) { total = v; lastJ = j; lastE = e; }
    }
  }
  if (lastJ < 0) return null;
  const starts = new Array<number>(k);
  starts[k - 1] = lastJ;
  for (let i = k - 1; i > 0; i--) starts[i - 1] = from[i][starts[i]];
  const placements = starts.map((note, syllable) => ({ syllable, note }));

  // Per beat: the syllable that starts there, ऽ while its vowel is held, "" after the text ends.
  const words = new Array<string>(beats).fill("");
  const stops = [...starts.slice(1), lastE];
  for (let i = 0; i < k; i++) {
    const t0 = notes[starts[i]].t, t1 = end(stops[i]);
    for (let b = Math.floor(t0); b < Math.ceil(t1 - 1e-6); b++) {
      if (b < 0 || b >= beats) continue;
      if (b === Math.floor(t0)) words[b] = words[b] && words[b] !== "ऽ" ? words[b] + "·" + syl[i].text : syl[i].text;
      else if (!words[b]) words[b] = "ऽ";
    }
  }
  return { placements, words, mukhda: mk, fit: fitOf(syl, notes, beats, starts, stops, mk, total) };
}

function fitOf(syl: Syllable[], notes: Note[], beats: number, starts: number[], stops: number[], mk: number, score: number): Fit {
  const end = (e: number) => (e < notes.length ? notes[e].t : beats);
  const lens = starts.map((j, i) => end(stops[i]) - notes[j].t);
  const heavy = syl.map((s, i) => [s, lens[i]] as const).filter(([s]) => s.heavy);
  const light = syl.map((s, i) => [s, lens[i]] as const).filter(([s]) => !s.heavy);
  const ends = syl.map((s, i) => i === syl.length - 1 || syl[i + 1].line !== s.line).map((e, i) => (e ? lens[i] : null)).filter((x): x is number => x !== null);
  return {
    score: score / syl.length,
    heavyOnLong: heavy.length ? heavy.filter(([, l]) => l >= 1).length / heavy.length : 1,
    lightOnShort: light.length ? light.filter(([, l]) => l <= 1).length / light.length : 1,
    mukhdaOnSam: Math.abs(notes[starts[mk]].t % 16) < 1e-6,
    lineEndsLong: ends.length ? ends.filter((l) => l >= 1.5).length / ends.length : 1,
    melisma: starts.reduce((a, j, i) => a + (stops[i] - j - 1), 0) / Math.max(1, starts.length),
    syllables: syl.length,
  };
}

/** Try every given composition (and both halves of long ones) and keep the best-fitting setting. */
export function bestSetting(syl: Syllable[], pieces: { notes: Note[]; beats: number; id: string }[]): (Setting & { id: string; notes: Note[]; beats: number }) | null {
  let best: (Setting & { id: string; notes: Note[]; beats: number }) | null = null;
  for (const p of pieces) {
    const s = setWords(syl, p.notes, p.beats);
    if (s && (!best || s.fit.score > best.fit.score)) best = { ...s, id: p.id, notes: p.notes, beats: p.beats };
  }
  return best;
}
