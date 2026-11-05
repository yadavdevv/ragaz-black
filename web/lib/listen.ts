// "Sing to it": hear a phrase from the microphone, write it as sargam, read its raga.
// Everything runs in the browser; no audio leaves the page.
//
//   pitch       McLeod pitch method (normalised square difference + peak picking)
//   transcribe  port of src/ragaz/transcribe.py: cents above Sa → snap within ±35 c → keep holds ≥ 100 ms
//   read        port of scripts/hum_reading.py: note time-share + note-to-note moves, learned per raga
//               from real singers (CompMusic, training recordings only)

import { SWARAS } from "./music";

export type Frame = { t: number; hz: number }; // hz = 0 when unvoiced
export type Held = { pc: number; octave: number; start: number; duration: number };
export type ReaderModel = { notes: number[]; moves: number[][] };
export type ReaderRaga = { name: string; devanagari: string; notes: string[]; vadi: string; samvadi: string; pakad: string; time: string; hours: [number, number] | null; season: string | null; rasa: string; tanpura: string };
export type Reader = {
  source: string;
  w_moves: number;
  share_scale: number; // softmax sharpness, calibrated so shown confidence matches accuracy
  models: Record<string, ReaderModel>;
  ragas: Record<string, ReaderRaga>;
  evaluation: Record<string, { top1: number; top3: number; windows: number; per_raga: Record<string, { top1: number; top3: number; windows: number }> }>;
};

const TOLERANCE = 35, MIN_NOTE_S = 0.1, MERGE_GAP_S = 0.15; // as transcribe.py
const CLARITY = 0.8, MIN_HZ = 70, MAX_HZ = 1100;

/** McLeod pitch method on one buffer. Returns 0 when there is no clear pitch. */
export function mpm(buf: Float32Array, sr: number): { hz: number; clarity: number } {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < 0.01) return { hz: 0, clarity: 0 };
  const maxLag = Math.min(n - 1, Math.floor(sr / MIN_HZ));
  const minLag = Math.floor(sr / MAX_HZ);
  const nsdf = new Float32Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i < n - tau; i++) {
      acf += buf[i] * buf[i + tau];
      m += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  // Key maxima: the highest point between each positive-going and negative-going zero crossing.
  const peaks: number[] = [];
  let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++;
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = tau;
    while (tau < maxLag && nsdf[tau] > 0) {
      if (nsdf[tau] > nsdf[best]) best = tau;
      tau++;
    }
    if (best >= minLag && best < maxLag) peaks.push(best);
  }
  if (!peaks.length) return { hz: 0, clarity: 0 };
  const top = Math.max(...peaks.map((p) => nsdf[p]));
  const pick = peaks.find((p) => nsdf[p] >= 0.9 * top)!;
  // Parabolic interpolation around the chosen lag.
  const a = nsdf[pick - 1], b = nsdf[pick], c = nsdf[pick + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  const clarity = b;
  return clarity >= CLARITY ? { hz: sr / (pick + shift), clarity } : { hz: 0, clarity };
}

/** Held notes from a pitch track, relative to Sa (same rules as the transcriber used on real singers). */
export function transcribe(frames: Frame[], saHz: number): Held[] {
  if (frames.length < 2) return [];
  const hop = (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1);
  const label = frames.map(({ hz }) => {
    if (hz <= 0) return null;
    const cents = 1200 * Math.log2(hz / saHz);
    const semi = Math.round(cents / 100);
    return Math.abs(cents - semi * 100) <= TOLERANCE ? semi : null;
  });
  const notes: Held[] = [];
  for (let i = 0; i < label.length; ) {
    const semi = label[i];
    if (semi === null) { i++; continue; }
    let j = i;
    while (j + 1 < label.length && label[j + 1] === semi) j++;
    const duration = (j - i + 1) * hop;
    if (duration >= MIN_NOTE_S) {
      const octave = Math.floor(semi / 12), pc = semi - 12 * octave;
      const note = { pc, octave, start: frames[i].t, duration };
      const prev = notes[notes.length - 1];
      if (prev && prev.pc === pc && prev.octave === octave && note.start - (prev.start + prev.duration) < MERGE_GAP_S) {
        prev.duration = note.start + note.duration - prev.start; // a brief wobble inside one note
      } else notes.push(note);
    }
    i = j + 1;
  }
  return notes;
}

/** Mean log-likelihood of the phrase under one raga's model (higher = more like that raga). */
export function scorePhrase(phrase: Held[], model: ReaderModel, wMoves: number): number {
  const total = phrase.reduce((s, n) => s + n.duration, 0) || 1;
  let s = phrase.reduce((acc, n) => acc + n.duration * Math.log(model.notes[n.pc]), 0) / total;
  const steps: [number, number][] = [];
  for (let i = 1; i < phrase.length; i++) if (phrase[i].pc !== phrase[i - 1].pc) steps.push([phrase[i - 1].pc, phrase[i].pc]);
  if (steps.length) s += (wMoves * steps.reduce((acc, [a, b]) => acc + Math.log(model.moves[a][b] + 1e-12), 0)) / steps.length;
  return s;
}

/** Ragas ranked for a phrase, with a calibrated softmax share as the confidence. */
export function read(phrase: Held[], reader: Reader): { raga: string; score: number; share: number }[] {
  const scored = Object.entries(reader.models).map(([raga, m]) => ({ raga, score: scorePhrase(phrase, m, reader.w_moves) }));
  scored.sort((a, b) => b.score - a.score);
  // Scores are per-second/per-move log-likelihoods; scale by phrase size so longer phrases are more decisive,
  // then by share_scale (fitted on training recordings) so "80%" means right about 80% of the time.
  const k = Math.max(1, Math.min(phrase.length, 30)) * reader.share_scale;
  const max = scored[0]?.score ?? 0;
  const exp = scored.map((r) => Math.exp(k * (r.score - max)));
  const z = exp.reduce((a, b) => a + b, 0);
  return scored.map((r, i) => ({ ...r, share: exp[i] / z }));
}

/** Notes that tip the reading toward `a` over `b`: time held × log-likelihood ratio, strongest first. */
export function tellingNotes(phrase: Held[], a: ReaderModel, b: ReaderModel): { swara: string; weight: number }[] {
  const by = new Map<string, number>();
  for (const n of phrase) {
    const s = SWARAS[n.pc];
    by.set(s, (by.get(s) ?? 0) + n.duration * Math.log(a.notes[n.pc] / b.notes[n.pc]));
  }
  return [...by].map(([swara, weight]) => ({ swara, weight })).filter((x) => x.weight > 0).sort((x, y) => y.weight - x.weight);
}

/** The notes of the phrase that the chosen raga does not use, by time held (the "what pulled you away" line). */
export function strayNotes(phrase: Held[], allowed: string[]): { swara: string; seconds: number }[] {
  const by = new Map<string, number>();
  for (const n of phrase) {
    const s = SWARAS[n.pc];
    if (!allowed.includes(s)) by.set(s, (by.get(s) ?? 0) + n.duration);
  }
  return [...by].map(([swara, seconds]) => ({ swara, seconds })).sort((a, b) => b.seconds - a.seconds);
}

export const token = (n: Held) => ".".repeat(Math.max(0, -n.octave)) + SWARAS[n.pc] + "'".repeat(Math.max(0, n.octave));

/** Microphone → pitch frames, polled from an AnalyserNode on the shared audio context. */
export class Mic {
  frames: Frame[] = [];
  level = 0;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private buf = new Float32Array(2048);
  private half = new Float32Array(1024);
  private t0 = 0;

  constructor(private ctx: AudioContext) {}

  async start() {
    // Raw voice: echo cancellation and noise suppression smear pitch, and the drone is quiet.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser); // not connected to the speakers
    this.frames = [];
    this.t0 = this.ctx.currentTime;
    const loop = () => {
      this.analyser!.getFloatTimeDomainData(this.buf);
      let rms = 0;
      for (const x of this.buf) rms += x * x;
      this.level = Math.sqrt(rms / this.buf.length);
      // Halve the rate (pairwise mean) before MPM: a quarter of the work, and voices sit far below Nyquist.
      for (let i = 0; i < this.half.length; i++) this.half[i] = 0.5 * (this.buf[2 * i] + this.buf[2 * i + 1]);
      const { hz } = mpm(this.half, this.ctx.sampleRate / 2);
      this.frames.push({ t: this.ctx.currentTime - this.t0, hz });
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
