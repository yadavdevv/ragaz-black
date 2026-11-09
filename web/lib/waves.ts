// A sound designed from waves: the patch the studio's synth tracks play (lib/daw/engine.ts) and
// the sound panel edits (components/WaveEditors.tsx).
//   wave      16 harmonics, sine waves at 1, 2, 3 ... 16 times the note's frequency, each with an
//             amplitude and a phase: y(θ) = Σ aₙ sin(nθ + φₙ). Web Audio plays exactly that sum
//             (a PeriodicWave with the same coefficients), so the picture is the sound.
//   unison    copies of the wave detuned a few cents apart: their beating thickens it (chorus).
//   envelope  attack, decay, sustain, release: the loudness over the note's life.
//   filter    a low-pass that removes harmonics above its cutoff; an envelope can sweep it.
//   movement  vibrato (a slow wave on the pitch) and tremolo (a slow wave on the loudness).
//   space     an echo and a room.
// Also the raga's notes as rows (used by the instruments page).

import { RATIOS, type Raga, SWARAS, isKomal, isTivra, sargam } from "./music";

export const H = 16;

export type Patch = {
  amp: number[]; // harmonic n+1: 0..1
  phase: number[]; // degrees
  voices: number;
  spread: number; // cents between the outermost unison voices
  env: { a: number; d: number; s: number; r: number }; // seconds, s 0..1
  filter: { cutoff: number; q: number; sweep: number }; // Hz, resonance, how far the envelope opens it (0..1)
  vib: { rate: number; depth: number }; // Hz, cents
  trem: { rate: number; depth: number }; // Hz, 0..1
  echo: { steps: number; feedback: number; mix: number };
  reverb: number;
};

const zeros = () => new Array(H).fill(0);
const harmonics = (f: (n: number) => number, phase: (n: number) => number = () => 0) => ({
  amp: zeros().map((_, i) => Math.max(0, Math.min(1, f(i + 1)))),
  phase: zeros().map((_, i) => phase(i + 1)),
});

/** Wave shapes as recipes of harmonics: the classic ones are Fourier series. */
export const SHAPES: { key: string; name: string; how: string; make: () => Pick<Patch, "amp" | "phase"> }[] = [
  { key: "sine", name: "Sine", how: "One harmonic alone: the purest tone there is.", make: () => harmonics((n) => (n === 1 ? 1 : 0)) },
  { key: "square", name: "Square", how: "Odd harmonics only, at 1/n: hollow, like a clarinet.", make: () => harmonics((n) => (n % 2 ? 1 / n : 0)) },
  { key: "saw", name: "Saw", how: "Every harmonic, at 1/n: buzzy and bright, like bowed strings.", make: () => harmonics((n) => 1 / n) },
  { key: "triangle", name: "Triangle", how: "Odd harmonics at 1/n², every other one flipped: soft, nearly a sine.", make: () => harmonics((n) => (n % 2 ? 1 / (n * n) : 0), (n) => (n % 4 === 3 ? 180 : 0)) },
  { key: "organ", name: "Organ", how: "A few chosen harmonics, like an organ's drawbars: 1, 2, 3, 4, 6, 8.", make: () => harmonics((n) => ({ 1: 1, 2: 0.7, 3: 0.55, 4: 0.4, 6: 0.25, 8: 0.3 })[n] ?? 0) },
  { key: "nasal", name: "Nasal", how: "Harmonics 4 to 8 lifted, as a reed's bore lifts them: a shehnai-ish buzz.", make: () => harmonics((n) => (n >= 4 && n <= 8 ? 0.8 : 0.5 / n)) },
];

export type Sound = { key: string; name: string; how: string; patch: Patch };
const base: Omit<Patch, "amp" | "phase"> = {
  voices: 1, spread: 0, env: { a: 0.01, d: 0.3, s: 0.6, r: 0.3 }, filter: { cutoff: 6000, q: 0.7, sweep: 0 },
  vib: { rate: 5.5, depth: 0 }, trem: { rate: 4, depth: 0 }, echo: { steps: 3, feedback: 0.3, mix: 0.2 }, reverb: 0.25,
};
const shape = (k: string) => SHAPES.find((s) => s.key === k)!.make();

/** Whole sounds to start from: each one a different use of the same few controls. */
export const SOUNDS: Sound[] = [
  { key: "glass", name: "Glass", how: "A sine and its octave, a soft attack, a long echo.", patch: { ...base, ...harmonics((n) => ({ 1: 1, 2: 0.35, 3: 0.08 })[n] ?? 0), env: { a: 0.01, d: 0.6, s: 0.25, r: 0.6 }, echo: { steps: 3, feedback: 0.4, mix: 0.3 }, reverb: 0.35 } },
  { key: "pluck", name: "Pluck", how: "A saw whose filter snaps shut: the attack is bright, the tail dark, like a plucked string.", patch: { ...base, ...shape("saw"), env: { a: 0.002, d: 0.35, s: 0, r: 0.25 }, filter: { cutoff: 500, q: 2, sweep: 0.8 }, echo: { steps: 3, feedback: 0.35, mix: 0.25 } } },
  { key: "reed", name: "Reed", how: "Nasal harmonics with a singer's vibrato: close to a shehnai.", patch: { ...base, ...shape("nasal"), env: { a: 0.06, d: 0.2, s: 0.85, r: 0.15 }, filter: { cutoff: 3500, q: 1, sweep: 0 }, vib: { rate: 5.5, depth: 18 }, reverb: 0.3 } },
  { key: "pad", name: "Pad", how: "Five detuned saws, a slow swell, a big room: warmth from beating.", patch: { ...base, ...shape("saw"), voices: 5, spread: 22, env: { a: 0.5, d: 0.5, s: 0.8, r: 1.2 }, filter: { cutoff: 1800, q: 0.7, sweep: 0.2 }, echo: { steps: 6, feedback: 0.3, mix: 0.15 }, reverb: 0.6 } },
  { key: "bass", name: "Bass", how: "A square, low and short, with the filter half shut.", patch: { ...base, ...shape("square"), env: { a: 0.004, d: 0.18, s: 0.5, r: 0.08 }, filter: { cutoff: 700, q: 3, sweep: 0.4 }, echo: { steps: 3, feedback: 0, mix: 0 }, reverb: 0.05 } },
  { key: "organ", name: "Organ", how: "Drawbar harmonics, a slow tremolo, no decay: it sounds as long as it's held.", patch: { ...base, ...shape("organ"), env: { a: 0.02, d: 0.1, s: 1, r: 0.12 }, trem: { rate: 5, depth: 0.25 }, reverb: 0.3 } },
];

export const clone = (p: Patch): Patch => JSON.parse(JSON.stringify(p));

/** One cycle of the wave, as drawn and as played (before normalising). */
export function cycle(p: Pick<Patch, "amp" | "phase">, n = 512, only?: number): Float32Array {
  const y = new Float32Array(n);
  for (let k = 0; k < H; k++) {
    if (!p.amp[k] || (only !== undefined && only !== k)) continue;
    const ph = (p.phase[k] * Math.PI) / 180;
    for (let i = 0; i < n; i++) y[i] += p.amp[k] * Math.sin((2 * Math.PI * (k + 1) * i) / n + ph);
  }
  return y;
}

export const peak = (y: Float32Array) => y.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;

/** The same sum for Web Audio: a sin(nθ + φ) = a cos φ · sin nθ + a sin φ · cos nθ. Scaled so the
 *  wave's peak is 1 whatever its harmonics (Web Audio's own normalisation is off). */
export function periodicWave(ctx: BaseAudioContext, p: Pick<Patch, "amp" | "phase">) {
  const real = new Float32Array(H + 1), imag = new Float32Array(H + 1), s = 1 / peak(cycle(p));
  for (let k = 0; k < H; k++) {
    const ph = (p.phase[k] * Math.PI) / 180;
    real[k + 1] = p.amp[k] * Math.sin(ph) * s;
    imag[k + 1] = p.amp[k] * Math.cos(ph) * s;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
}

// ----------------------------------------------------------------------------------- the notes

export type Row = { s: string; o: number; semis: number; label: string; ratio: number };

/** The raga's notes from mandra Pa to taar Ga (about two octaves), low to high. */
export function rows(r: Raga): Row[] {
  const out: Row[] = [];
  for (const o of [-1, 0, 1]) {
    for (const s of r.swaras) {
      const semis = SWARAS.indexOf(s) + 12 * o;
      if (semis < -5 || semis > 16) continue;
      out.push({ s, o, semis, label: sargam(s, "latin") + (isKomal(s) ? "♭" : isTivra(s) ? "♯" : "") + (o < 0 ? "̣" : o > 0 ? "̇" : ""), ratio: RATIOS[SWARAS.indexOf(s)] * 2 ** o });
    }
  }
  return out;
}

export const hzOf = (row: Row, sa: number) => sa * row.ratio;
