// Waves: a synthesizer you can see. A sound is built the way additive synthesis builds it:
//   wave      16 harmonics, sine waves at 1, 2, 3 ... 16 times the note's frequency, each with an
//             amplitude and a phase: y(θ) = Σ aₙ sin(nθ + φₙ). Web Audio plays exactly that sum
//             (a PeriodicWave with the same coefficients), so the picture is the sound.
//   unison    copies of the wave detuned a few cents apart: their beating thickens it (chorus).
//   envelope  attack, decay, sustain, release: the loudness over the note's life.
//   filter    a low-pass that removes harmonics above its cutoff; an envelope can sweep it.
//   movement  vibrato (a slow wave on the pitch) and tremolo (a slow wave on the loudness).
//   space     an echo (a delay fed back into itself) and a reverb (a room, as decaying noise).
// The notes are a raga's, just-intoned (music.ts), and a 16-step loop plays them with drums (kit.ts).

import { hat, kick, snare } from "./kit";
import { RATIOS, type Raga, SWARAS, isKomal, isTivra, sargam } from "./music";
import { encodeWav } from "./studio";

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

// ----------------------------------------------------------------------------------- the synth

const DRUMS = ["kick", "snare", "hat"] as const;
export type Drum = (typeof DRUMS)[number];
export { DRUMS };

function noiseBuffer(ctx: BaseAudioContext, seconds = 2) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 7;
  for (let i = 0; i < d.length; i++) d[i] = ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return b;
}

function roomIR(ctx: BaseAudioContext, seconds = 2.4) {
  const n = Math.ceil(seconds * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = 11 + c * 7, lp = 0;
    for (let i = 0; i < n; i++) {
      const w = ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
      lp += 0.45 * (w - lp); // darker as it goes, like a real room's air
      d[i] = lp * Math.exp((-5 * i) / n);
    }
  }
  return b;
}

export type Held = { release: (at?: number) => void };

export class Synth {
  ctx: BaseAudioContext;
  patch: Patch;
  analyser: AnalyserNode;
  private wave: PeriodicWave;
  private bus: GainNode;
  private trem: GainNode;
  private tremDepth: GainNode;
  private tremLfo: OscillatorNode;
  private vibLfo: OscillatorNode;
  private vibDepth: GainNode;
  private delay: DelayNode;
  private feedback: GainNode;
  private echoSend: GainNode;
  private verbSend: GainNode;
  private noise: AudioBuffer;
  private drums: GainNode;
  stepSeconds = 0.25;
  private keep = <S extends AudioScheduledSourceNode>(s: S) => s;

  constructor(ctx: BaseAudioContext, patch: Patch, out: AudioNode = ctx.destination) {
    this.ctx = ctx;
    this.patch = clone(patch);
    this.wave = periodicWave(ctx, patch);
    this.noise = noiseBuffer(ctx);
    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -10; master.ratio.value = 4; master.attack.value = 0.005; master.release.value = 0.2;
    const out_ = ctx.createGain(); out_.gain.value = 0.85;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 4096; this.analyser.smoothingTimeConstant = 0.6;
    master.connect(out_).connect(this.analyser).connect(out);
    this.bus = ctx.createGain(); this.bus.gain.value = 0.55;
    this.trem = ctx.createGain();
    this.bus.connect(this.trem).connect(master);
    // Tremolo: the loudness = 1 − depth/2 + (depth/2)·sin(2π·rate·t).
    this.tremLfo = ctx.createOscillator(); this.tremDepth = ctx.createGain();
    this.tremLfo.connect(this.tremDepth).connect(this.trem.gain);
    // Vibrato: every voice's detune (in cents) follows depth·sin(2π·rate·t).
    this.vibLfo = ctx.createOscillator(); this.vibDepth = ctx.createGain();
    this.vibLfo.connect(this.vibDepth);
    this.tremLfo.start(); this.vibLfo.start();
    // Echo: a delay whose output is fed back into it, quieter each time round.
    this.delay = ctx.createDelay(4); this.feedback = ctx.createGain(); this.echoSend = ctx.createGain();
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 3800;
    this.trem.connect(this.echoSend).connect(this.delay).connect(tone).connect(this.feedback).connect(this.delay);
    tone.connect(master);
    this.verbSend = ctx.createGain();
    const room = ctx.createConvolver(); room.buffer = roomIR(ctx);
    this.trem.connect(this.verbSend).connect(room).connect(master);
    this.drums = ctx.createGain(); this.drums.gain.value = 0.7;
    this.drums.connect(master);
    this.set(patch, true);
  }

  /** Apply a patch: the wave and envelope for the next notes, the movement and space at once. */
  set(p: Patch, now = false) {
    const t = this.ctx.currentTime, glide = now ? 0 : 0.03;
    const to = (a: AudioParam, v: number) => (now ? a.setValueAtTime(v, t) : a.setTargetAtTime(v, t, glide));
    if (now || p.amp.some((a, i) => a !== this.patch.amp[i]) || p.phase.some((a, i) => a !== this.patch.phase[i])) this.wave = periodicWave(this.ctx, p);
    to(this.tremLfo.frequency, p.trem.rate);
    to(this.tremDepth.gain, p.trem.depth / 2);
    to(this.trem.gain, 1 - p.trem.depth / 2);
    to(this.vibLfo.frequency, p.vib.rate);
    to(this.vibDepth.gain, p.vib.depth);
    to(this.delay.delayTime, Math.min(3.9, p.echo.steps * this.stepSeconds));
    to(this.feedback.gain, Math.min(0.85, p.echo.feedback));
    to(this.echoSend.gain, p.echo.mix);
    to(this.verbSend.gain, p.reverb * 0.9);
    this.patch = clone(p);
  }

  setStep(seconds: number) {
    this.stepSeconds = seconds;
    this.delay.delayTime.setTargetAtTime(Math.min(3.9, this.patch.echo.steps * seconds), this.ctx.currentTime, 0.05);
  }

  /** A note at `hz` from `at`; held until release() (or for `dur` seconds). */
  note(hz: number, at = this.ctx.currentTime, dur?: number, velocity = 1): Held {
    const { ctx, patch: p } = this;
    const { a, d, s, r } = p.env;
    const vca = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = p.filter.q;
    const cut = Math.min(18000, p.filter.cutoff), open = Math.min(18000, cut * (1 + 12 * p.filter.sweep));
    lp.frequency.setValueAtTime(p.filter.sweep ? open : cut, at);
    if (p.filter.sweep) lp.frequency.setTargetAtTime(cut, at + a, Math.max(0.02, d / 3));
    lp.connect(vca).connect(this.bus);
    const level = (0.5 * velocity) / Math.sqrt(p.voices);
    vca.gain.setValueAtTime(0, at);
    vca.gain.linearRampToValueAtTime(level, at + Math.max(0.002, a));
    vca.gain.setTargetAtTime(level * s, at + Math.max(0.002, a), Math.max(0.01, d / 3));
    const oscs: OscillatorNode[] = [];
    for (let v = 0; v < p.voices; v++) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.value = hz;
      o.detune.value = p.voices > 1 ? p.spread * (v / (p.voices - 1) - 0.5) : 0;
      this.vibDepth.connect(o.detune);
      o.connect(lp);
      o.start(at);
      oscs.push(o);
    }
    let done = false;
    const release = (t = ctx.currentTime) => {
      if (done) return;
      done = true;
      const at2 = Math.max(t, at + 0.005);
      vca.gain.cancelScheduledValues(at2);
      // Hold the level reached so far, then let it fall: the release.
      const reached = at2 < at + a ? (level * (at2 - at)) / Math.max(0.002, a) : level * s + (level - level * s) * Math.exp(-(at2 - at - a) / Math.max(0.01, d / 3));
      vca.gain.setValueAtTime(reached, at2);
      vca.gain.setTargetAtTime(0, at2, Math.max(0.01, r / 4));
      for (const o of oscs) o.stop(at2 + r * 1.6 + 0.05);
      oscs[0].onended = () => { for (const o of oscs) { try { this.vibDepth.disconnect(o.detune); } catch {} } };
    };
    if (dur !== undefined) release(at + dur);
    return { release };
  }

  drum(kind: Drum, at: number, v = 1) {
    if (kind === "kick") kick(this.ctx, this.drums, at, v, this.keep, this.noise);
    else if (kind === "snare") snare(this.ctx, this.drums, at, 0.55 * v, this.keep, this.noise, this.verbSend);
    else hat(this.ctx, this.drums, at, 1.6 * v, this.keep);
  }
}

// ----------------------------------------------------------------------------------- the loop

export const STEPS = 16;
export type Pattern = { notes: boolean[][]; drums: Record<Drum, boolean[]>; length: number[][] }; // notes[row][step]; length in steps

export const emptyPattern = (n: number): Pattern => ({
  notes: Array.from({ length: n }, () => new Array(STEPS).fill(false)),
  length: Array.from({ length: n }, () => new Array(STEPS).fill(1)),
  drums: { kick: new Array(STEPS).fill(false), snare: new Array(STEPS).fill(false), hat: new Array(STEPS).fill(false) },
});

/** A first loop in any raga: up from Sa and back down, in the raga's own notes, with a beat. */
export function starterPattern(rs: Row[]): Pattern {
  const p = emptyPattern(rs.length);
  const sa = rs.findIndex((r) => r.semis === 0);
  const line = [0, null, 1, 2, null, 3, 2, 1, 2, null, 4, 3, 2, null, 1, 0];
  line.forEach((d, step) => {
    if (d === null) return;
    const row = Math.min(rs.length - 1, sa + d);
    p.notes[row][step] = true;
    p.length[row][step] = line[step + 1] === null ? 2 : 1;
  });
  for (let s = 0; s < STEPS; s++) {
    p.drums.hat[s] = s % 2 === 0;
    p.drums.kick[s] = s === 0 || s === 6 || s === 8 || s === 11;
    p.drums.snare[s] = s === 4 || s === 12;
  }
  return p;
}

/** Plays a pattern round and round, scheduling a little ahead (so changes are heard at the next step). */
export class Looper {
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  constructor(private synth: Synth, public get: () => { pattern: Pattern; rows: Row[]; sa: number; tempo: number; swing: number }, public onStep?: (step: number, at: number) => void) {}

  get playing() { return this.timer !== null; }

  start() {
    if (this.timer) return;
    const ctx = this.synth.ctx;
    this.next = ctx.currentTime + 0.08;
    this.step = 0;
    this.timer = setInterval(() => {
      while (this.next < ctx.currentTime + 0.12) {
        const s = this.get();
        const len = 60 / s.tempo / 2; // a step is an eighth note
        this.synth.setStep(len);
        const at = this.next + (this.step % 2 ? (s.swing - 0.5) * 2 * len : 0);
        playStep(this.synth, s, this.step, at, len);
        this.onStep?.(this.step, at);
        this.next += len;
        this.step = (this.step + 1) % STEPS;
      }
    }, 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function playStep(synth: Synth, s: { pattern: Pattern; rows: Row[]; sa: number }, step: number, at: number, len: number) {
  s.pattern.notes.forEach((cells, r) => {
    if (cells[step] && s.rows[r]) synth.note(hzOf(s.rows[r], s.sa), at, len * (s.pattern.length[r]?.[step] ?? 1) * 0.92);
  });
  for (const d of DRUMS) if (s.pattern.drums[d][step]) synth.drum(d, at, d === "hat" && step % 4 ? 0.6 : 1);
}

/** The loop played `times` over, rendered offline to a WAV. */
export async function renderLoop(patch: Patch, s: { pattern: Pattern; rows: Row[]; sa: number; tempo: number; swing: number }, times = 4, sampleRate = 44100) {
  const len = 60 / s.tempo / 2;
  const seconds = times * STEPS * len + patch.env.r + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const synth = new Synth(ctx, patch);
  synth.setStep(len);
  for (let i = 0; i < times * STEPS; i++) playStep(synth, s, i % STEPS, 0.05 + i * len + (i % 2 ? (s.swing - 0.5) * 2 * len : 0), len);
  return encodeWav(await ctx.startRendering());
}

// ----------------------------------------------------------------------------------- sharing

export type Saved = { patch: Patch; pattern: Pattern; raga: string; sa: number; tempo: number; swing: number };

export const encodeSaved = (s: Saved) => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function decodeSaved(hash: string): Saved | null {
  try {
    const s = JSON.parse(decodeURIComponent(escape(atob(hash.replace(/-/g, "+").replace(/_/g, "/")))));
    return s?.patch?.amp?.length === H && s.pattern?.notes ? s : null;
  } catch {
    return null;
  }
}
