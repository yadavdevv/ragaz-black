// Shared music vocabulary. Mirrors src/ragaz/ragas.py and render.py.

export const SWARAS = "SrRgGmMPdDnN"; // index = semitones above Sa

// Just-intonation ratios above Sa, in SWARAS order (same as render.py).
export const RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];

export type Note = { s: string; o: number; t: number; d: number; bar: number; ok: boolean };

export type Raga = {
  key: string;
  name: string;
  devanagari: string;
  thaat: string;
  notes: number[];
  swaras: string[];
  vadi: string;
  samvadi: string;
  nyas: string[];
  pakad: string;
  time: string;
  hours: [number, number] | null; // null for ragas tied to a season (Malhar, Basant)
  season?: string | null;
  rasa: string;
  tanpura: string;
};

export type Piece = {
  id: string;
  model: string;
  run: string;
  step: number;
  raga: string;
  notation: string;
  notes: Note[];
  beats: number;
  reward: number;
  scores: Record<string, number>;
  violations: string[];
  train_reward: number;
};

export type RagaData = {
  ragas: Raga[];
  equation: { gates: string[]; weights: Record<string, number> };
  models: { label: string; run: string; step: number }[];
};

export type Masters = {
  source: string;
  ragas: Record<string, { recordings: number; train: number; pc: number[]; phrases: string[]; models: Record<string, { pc: number[]; reward: number }> }>;
};

export const semis = (n: Pick<Note, "s" | "o">) => SWARAS.indexOf(n.s) + 12 * n.o;

export function swaraHz(swara: string, octave: number, saHz: number) {
  return saHz * RATIOS[SWARAS.indexOf(swara)] * 2 ** octave;
}

// Display names. Uppercase = shuddh, lowercase = komal, except m = shuddh Ma, M = tivra Ma.
const LATIN: Record<string, string> = { S: "Sa", r: "Re", R: "Re", g: "Ga", G: "Ga", m: "Ma", M: "Ma", P: "Pa", d: "Dha", D: "Dha", n: "Ni", N: "Ni" };
const DEVA: Record<string, string> = { S: "सा", r: "रे", R: "रे", g: "ग", G: "ग", m: "म", M: "म", P: "प", d: "ध", D: "ध", n: "नि", N: "नि" };
export const isKomal = (s: string) => "rgdn".includes(s);
export const isTivra = (s: string) => s === "M";
export const sargam = (s: string, script: "latin" | "deva") => (script === "deva" ? DEVA[s] : LATIN[s]);
export const swaraLabel = (s: string) => LATIN[s] + (isKomal(s) ? " komal" : isTivra(s) ? " tivra" : "");

// The 12 chromatic positions on the mandala, as short letters.
export const PC_LETTERS = ["S", "r", "R", "g", "G", "m", "M", "P", "d", "D", "n", "N"];

export function pcShare(notes: Note[], upTo = Infinity): number[] {
  const d = new Array(12).fill(0);
  for (const n of notes) {
    if (n.t >= upTo) break;
    d[SWARAS.indexOf(n.s)] += Math.min(n.d, upTo - n.t);
  }
  const sum = d.reduce((a, b) => a + b, 0);
  return sum ? d.map((x) => x / sum) : d;
}

// Circular distance between an hour and a raga's [start, end] window.
export function hourDistance(hour: number, [a, b]: [number, number]) {
  const inWindow = a <= b ? hour >= a && hour < b : hour >= a || hour < b;
  if (inWindow) return 0;
  const d = (x: number) => Math.min(Math.abs(hour - x), 24 - Math.abs(hour - x));
  return Math.min(d(a), d(b));
}

export function ragaOfHour(ragas: Raga[], hour: number) {
  const timed = ragas.filter((r): r is Raga & { hours: [number, number] } => r.hours !== null);
  return [...(timed.length ? timed : ragas)].sort((x, y) => hourDistance(hour, x.hours ?? [0, 24]) - hourDistance(hour, y.hours ?? [0, 24]))[0];
}

// ---------------------------------------------------------------- acoustics

export const cents = (ratio: number) => 1200 * Math.log2(ratio);
export const JI_CENTS = RATIOS.map(cents);
export const ET_CENTS = RATIOS.map((_, i) => 100 * i);

/** Overtone k of a string, folded into one octave: where it lands on the circle. */
export function foldHarmonic(k: number) {
  const c = ((cents(k) % 1200) + 1200) % 1200;
  let best = 0;
  for (let i = 0; i < 12; i++) {
    const d = (x: number) => Math.min(Math.abs(c - x), 1200 - Math.abs(c - x));
    if (d(JI_CENTS[i]) < d(JI_CENTS[best])) best = i;
  }
  let dev = c - JI_CENTS[best];
  if (dev > 600) dev -= 1200;
  if (dev < -600) dev += 1200;
  return { cents: c, pc: best, dev };
}

/** Beating between a held tone and the drone's low-Sa overtones: the slowest audible
 *  difference between one of the tone's first 4 harmonics and a drone harmonic. 0 = in tune. */
export function beatRate(hz: number, saHz: number) {
  const base = saHz / 2;
  let best = Infinity;
  for (let p = 1; p <= 4; p++) {
    const q = Math.round((p * hz) / base);
    if (q < 1) continue;
    const b = Math.abs(p * hz - q * base);
    if (b < best) best = b;
  }
  return best;
}

const DEVA_DIGITS = "०१२३४५६७८९";
export const devaNum = (n: number) => String(n).replace(/\d/g, (d) => DEVA_DIGITS[+d]);

/** Pitch (semitones above middle Sa, fractional) → swara letter + octave, snapped. */
export function semisToSwara(s: number) {
  const r = Math.round(s);
  const pc = ((r % 12) + 12) % 12;
  return { s: SWARAS[pc], o: Math.floor(r / 12), pc };
}
