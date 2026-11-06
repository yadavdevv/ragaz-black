// Web Audio port of src/ragaz/render.py: a flute-like lead over a tanpura drone.
// The browser plays the notation itself, so tempo and Sa can change and every
// visual reads the same clock (AudioContext.currentTime).

import { type Note, type Raga, swaraHz } from "./music";
import { type Lyric, type Phone, VOWELS, phone } from "./phones";

const HARMONICS = [1.0, 0.35, 0.18, 0.08, 0.04]; // render.py render_lead
const TANPURA_GAPS = [1.1, 1.1, 1.1, 1.5]; // render.py render_tanpura

export type Pluck = { at: number; string: number }; // string 0 = Pa/Ma, 1–2 = Sa, 3 = low Sa
export type Playback = { t0: number; beat: number; end: number; notes: Note[]; tag?: string };
export type Hit = { at: number; semis: number; hz: number; kind: "note" | "wrong" | "harmonic" };

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** One tanpura string: harmonics that bloom one after another (the jawari buzz). */
function tanpuraPluck(ctx: BaseAudioContext, hz: number, seconds = 5, seed = 0) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(1, n, sr);
  const out = buf.getChannelData(0);
  const rnd = seeded(seed);
  const decay = new Float32Array(n);
  for (let i = 0; i < n; i++) decay[i] = Math.exp(-i / sr / 3);
  for (let k = 1; k < 25; k++) {
    if (k * hz > sr / 2.5) break;
    const tk = 0.05 + 0.07 * k; // higher harmonics peak later
    const w = (2 * Math.PI * k * hz * (1 + 0.0002 * k)) / sr;
    const phase = rnd() * 2 * Math.PI;
    const amp = k ** -0.8;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] += amp * decay[i] * (0.35 + 0.65 * (t / tk) * Math.exp(1 - t / tk)) * Math.sin(w * i + phase);
    }
  }
  const attack = Math.floor(0.006 * sr);
  for (let i = 0; i < attack; i++) out[i] *= i / attack;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= peak;
  return buf;
}

function reverbIR(ctx: BaseAudioContext, seconds = 1.8) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const rnd = seeded(2 + c);
    for (let i = Math.floor(0.012 * sr); i < n; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-i / sr / 0.5);
  }
  return buf;
}

/** The lead voice: harmonic oscillator + delayed vibrato + band-passed breath. */
class Flute {
  osc: OscillatorNode;
  lfo: OscillatorNode;
  noise: AudioBufferSourceNode;
  amp: GainNode;
  breath: GainNode;
  depth: GainNode;
  constructor(ctx: AudioContext, out: AudioNode, noiseBuf: AudioBuffer, wave: PeriodicWave) {
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(wave);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 4200;
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 5.2;
    this.depth = ctx.createGain();
    this.depth.gain.value = 0;
    this.lfo.connect(this.depth).connect(this.osc.frequency);
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuf;
    this.noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2700;
    band.Q.value = 0.9;
    this.breath = ctx.createGain();
    this.breath.gain.value = 0;
    this.osc.connect(tone).connect(this.amp).connect(out);
    this.noise.connect(band).connect(this.breath).connect(out);
  }
  start(at: number, hz: number) {
    this.osc.frequency.setValueAtTime(hz, at);
    for (const s of [this.osc, this.lfo, this.noise]) s.start(at - 0.02);
  }
  /** A new note at `at`: glide (~45 ms like render.py), tonguing dip, vibrato after 250 ms. */
  note(at: number, hz: number, dur: number, first = false, level = 1) {
    if (!first) this.osc.frequency.setTargetAtTime(hz, at - 0.012, 0.014);
    this.amp.gain.setTargetAtTime(first ? level : 0.55 * level, at, first ? 0.03 : 0.004);
    this.amp.gain.setTargetAtTime(level, at + 0.012, 0.02);
    this.breath.gain.setTargetAtTime(0.1 * level, at, 0.01);
    this.breath.gain.setTargetAtTime(0.045 * level, at + 0.06, 0.08);
    this.depth.gain.setTargetAtTime(0, at, 0.02);
    if (dur > 0.3) this.depth.gain.setTargetAtTime(0.006 * hz, at + 0.25, 0.18);
  }
  release(at: number, tau = 0.12) {
    for (const g of [this.amp.gain, this.breath.gain, this.depth.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, tau);
    }
    for (const s of [this.osc, this.lfo, this.noise]) s.stop(at + tau * 10);
  }
}

/** A sung "aa" (aakar): a buzzy source through vowel formants, sliding between notes
 *  the way a Hindustani vocalist does (a scoop into each note, slow meend between them). */
class Voice {
  osc: OscillatorNode;
  lfo: OscillatorNode;
  wobble: OscillatorNode;
  noise: AudioBufferSourceNode;
  amp: GainNode;
  breath: GainNode;
  depth: GainNode;
  formants: BiquadFilterNode[] = []; // F1–F3 move per syllable when the voice sings words
  formantGains: GainNode[] = []; // and their loudness: F2 is strong in front vowels (i, e), weak in back ones (u, o)
  artic: GainNode; // consonant dips, after the note envelope so the two don't fight
  cons: BiquadFilterNode; // consonant noise: bursts, aspiration, hiss
  consGain: GainNode;
  constructor(ctx: AudioContext, out: AudioNode, noiseBuf: AudioBuffer, wave: PeriodicWave) {
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(wave);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    // "aa" formants (F1–F4), in parallel, then a gentle top roll-off.
    const sum = ctx.createGain();
    const top = ctx.createBiquadFilter();
    top.type = "lowpass";
    top.frequency.value = 5200;
    for (const [f, q, g] of [[760, 6, 1], [1180, 8, 0.6], [2620, 11, 0.32], [3450, 14, 0.12]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f;
      bp.Q.value = q;
      const gg = ctx.createGain();
      gg.gain.value = g * 3.2;
      this.osc.connect(bp).connect(gg).connect(sum);
      if (this.formants.length < 3) {
        this.formants.push(bp);
        this.formantGains.push(gg);
      }
    }
    const body = ctx.createGain(); // a little of the raw source for warmth
    body.gain.value = 0.12;
    this.osc.connect(body).connect(sum);
    this.artic = ctx.createGain();
    sum.connect(top).connect(this.amp).connect(this.artic).connect(out);
    // vibrato that blooms on held notes, plus a slow natural wobble
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 5.4;
    this.depth = ctx.createGain();
    this.depth.gain.value = 0;
    this.lfo.connect(this.depth).connect(this.osc.frequency);
    this.wobble = ctx.createOscillator();
    this.wobble.frequency.value = 0.9;
    const wd = ctx.createGain();
    wd.gain.value = 0.9;
    this.wobble.connect(wd).connect(this.osc.frequency);
    // breath through the second formant
    this.noise = ctx.createBufferSource();
    this.noise.buffer = noiseBuf;
    this.noise.loop = true;
    const nb = ctx.createBiquadFilter();
    nb.type = "bandpass";
    nb.frequency.value = 1500;
    nb.Q.value = 1.2;
    this.breath = ctx.createGain();
    this.breath.gain.value = 0;
    this.noise.connect(nb).connect(this.breath).connect(out);
    this.cons = ctx.createBiquadFilter();
    this.cons.type = "bandpass";
    this.consGain = ctx.createGain();
    this.consGain.gain.value = 0;
    this.noise.connect(this.cons).connect(this.consGain).connect(out);
  }

  /** Sing a syllable starting at `at`: glide the formants to its vowel and articulate its consonant. */
  syllable(at: number, p: Phone, level = 1) {
    const [f1, f2, f3] = this.formants;
    const to = (f: BiquadFilterNode, hz: number, when: number, tau: number) => f.frequency.setTargetAtTime(hz, when, tau);
    const dip = (depth: number, len: number) => {
      this.artic.gain.setTargetAtTime(depth, at - len, len / 4);
      this.artic.gain.setTargetAtTime(1, at, 0.02);
    };
    const burst = (hz: number, q: number, peak: number, len: number, before = 0) => {
      this.cons.frequency.setValueAtTime(hz, at - before);
      this.cons.Q.setValueAtTime(q, at - before);
      this.consGain.gain.setTargetAtTime(peak * level, at - before, 0.005);
      this.consGain.gain.setTargetAtTime(0, at - before + len, len / 3);
    };
    switch (p.onset) {
      case "stop": dip(0.08, 0.06); burst(3000, 1, 0.12, 0.015); break;
      case "aspirate": dip(0.08, 0.06); burst(1600, 0.8, 0.22, 0.07); break;
      case "sibilant": dip(0.15, 0.1); burst(5600, 1.6, 0.3, 0.1, 0.1); break;
      case "fricative": dip(0.3, 0.08); burst(1800, 0.7, 0.18, 0.08, 0.08); break;
      case "nasal": dip(0.45, 0.07); to(f1, 280, at - 0.07, 0.01); break;
      case "liquid": dip(0.7, 0.04); to(f3, 1750, at - 0.04, 0.01); break;
      case "glide-i": { const [a, b] = VOWELS["ī"]; to(f1, a, at - 0.05, 0.01); to(f2, b, at - 0.05, 0.01); break; }
      case "glide-u": { const [a, b] = VOWELS["ū"]; to(f1, a, at - 0.05, 0.01); to(f2, b, at - 0.05, 0.01); break; }
    }
    // Relative formant loudness by vowel (the "aa" defaults are 1, 0.6, 0.32).
    const front = ["i", "ī", "e", "ai"].includes(p.vowel), back = ["u", "ū", "o", "au"].includes(p.vowel);
    const [g1, g2, g3] = this.formantGains;
    g1.gain.setTargetAtTime(3.2 * (back ? 1.1 : 1), at + 0.01, 0.04);
    g2.gain.setTargetAtTime(3.2 * (front ? 1.0 : back ? 0.35 : 0.6), at + 0.01, 0.04);
    g3.gain.setTargetAtTime(3.2 * (front ? 0.55 : back ? 0.18 : 0.32), at + 0.01, 0.04);
    to(f1, p.f[0], at + 0.01, 0.035);
    to(f2, p.f[1], at + 0.01, 0.04);
    to(f3, p.f[2], at + 0.01, 0.05);
  }

  start(at: number, hz: number) {
    this.osc.frequency.setValueAtTime(hz * 0.97, at);
    for (const s of [this.osc, this.lfo, this.wobble, this.noise]) s.start(at - 0.02);
  }
  note(at: number, hz: number, dur: number, first = false, level = 1) {
    if (first) {
      this.osc.frequency.setValueAtTime(hz * 0.97, at); // a scoop up into the first note
      this.osc.frequency.setTargetAtTime(hz, at + 0.01, 0.04);
      this.amp.gain.setTargetAtTime(level, at, 0.05);
    } else {
      this.osc.frequency.setTargetAtTime(hz, at - 0.035, 0.032); // meend: a slow slide
      this.amp.gain.setTargetAtTime(level * 0.9, at - 0.02, 0.03);
      this.amp.gain.setTargetAtTime(level, at + 0.05, 0.08);
    }
    this.breath.gain.setTargetAtTime(0.035 * level, at, 0.03);
    this.breath.gain.setTargetAtTime(0.015 * level, at + 0.1, 0.1);
    this.depth.gain.setTargetAtTime(0, at, 0.03);
    if (dur > 0.35) this.depth.gain.setTargetAtTime(0.011 * hz, at + 0.3, 0.25);
  }
  release(at: number, tau = 0.12) {
    for (const g of [this.amp.gain, this.breath.gain, this.depth.gain]) {
      g.cancelScheduledValues(at);
      g.setTargetAtTime(0, at, tau);
    }
    for (const s of [this.osc, this.lfo, this.wobble, this.noise]) s.stop(at + tau * 10);
  }
}

export type Timbre = "voice" | "flute";
export type Curve = { t0: number; hop: number; end: number; tag: string };

export class Engine {
  ctx: AudioContext;
  analyser: AnalyserNode;
  plucks: Pluck[] = [];
  hits: Hit[] = [];
  saHz = 261.63;
  raga: Raga | null = null;
  playback: Playback | null = null;
  onEnd: ((p: Playback) => void) | null = null;
  private bus: GainNode;
  private droneGain: GainNode;
  private leadBus: GainNode;
  private strings: AudioBuffer[] = [];
  private droneTimer: number | null = null;
  private nextPluck = { at: 0, i: 0 };
  private piece: Flute | Voice | null = null;
  timbre: Timbre = "voice";
  curve: Curve | null = null;
  private voiceWave: PeriodicWave;
  private glide: Flute | null = null;
  private test: Flute | null = null;
  private noiseBuf: AudioBuffer;
  private wave: PeriodicWave;
  private rnd = seeded(1);
  private endTimer: number | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.85;
    this.bus = ctx.createGain();
    const dry = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver();
    conv.buffer = reverbIR(ctx);
    dry.gain.value = 0.78;
    wet.gain.value = 0.6; // IR isn't energy-normalised like render.py's; matched by ear
    this.bus.connect(dry).connect(comp);
    this.bus.connect(conv).connect(wet).connect(comp);
    comp.connect(this.analyser).connect(ctx.destination);
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.bus);
    this.leadBus = ctx.createGain();
    this.leadBus.gain.value = 0.32;
    this.leadBus.connect(this.bus);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    const r = seeded(7);
    for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;
    this.wave = ctx.createPeriodicWave(new Float32Array(HARMONICS.length + 1), new Float32Array([0, ...HARMONICS]));
    // A glottal-like source: many harmonics, falling ~1/k^1.1.
    const vk = Array.from({ length: 40 }, (_, k) => (k === 0 ? 0 : 1 / k ** 1.1));
    this.voiceWave = ctx.createPeriodicWave(new Float32Array(40), new Float32Array(vk));
  }

  get now() {
    return this.ctx.currentTime;
  }
  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }
  private flute() {
    return new Flute(this.ctx, this.leadBus, this.noiseBuf, this.wave);
  }
  private lead(): Flute | Voice {
    return this.timbre === "voice" ? new Voice(this.ctx, this.leadBus, this.noiseBuf, this.voiceWave) : this.flute();
  }

  // ------------------------------------------------------------ tanpura

  /** Tune the four strings: first string Pa (or Ma when the raga has no Pa), Sa, Sa, low Sa. */
  tune(raga: Raga, saHz = this.saHz) {
    if (this.raga?.key === raga.key && this.saHz === saHz && this.strings.length) return;
    this.raga = raga;
    this.saHz = saHz;
    const hz = [swaraHz(raga.tanpura, -1, saHz), saHz, saHz, saHz / 2];
    this.strings = hz.map((f, i) => tanpuraPluck(this.ctx, f, 5, i + 1));
  }

  startDrone(fadeIn = 1.5) {
    if (this.droneTimer !== null) return;
    const t = this.now;
    this.droneGain.gain.cancelScheduledValues(t);
    this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, t);
    this.droneGain.gain.linearRampToValueAtTime(0.16, t + fadeIn);
    this.nextPluck = { at: t + 0.05, i: 0 };
    const tick = () => {
      while (this.nextPluck.at < this.now + 0.25) {
        const { at, i } = this.nextPluck;
        const s = this.ctx.createBufferSource();
        s.buffer = this.strings[i % 4];
        const g = this.ctx.createGain();
        g.gain.value = 0.85 + 0.15 * this.rnd();
        s.connect(g).connect(this.droneGain);
        s.start(at);
        this.plucks.push({ at, string: i % 4 });
        if (this.plucks.length > 64) this.plucks.shift();
        this.nextPluck = { at: at + TANPURA_GAPS[i % 4] * (0.97 + 0.06 * this.rnd()), i: i + 1 };
      }
    };
    tick();
    this.droneTimer = window.setInterval(tick, 80);
  }

  stopDrone(fadeOut = 1.2) {
    if (this.droneTimer === null) return;
    window.clearInterval(this.droneTimer);
    this.droneTimer = null;
    const t = this.now;
    this.droneGain.gain.cancelScheduledValues(t);
    this.droneGain.gain.setValueAtTime(this.droneGain.gain.value, t);
    this.droneGain.gain.linearRampToValueAtTime(0, t + fadeOut);
  }

  /** Retune to another raga or Sa with a short crossfade (keeps the drone going). */
  retune(raga: Raga, saHz = this.saHz) {
    if (this.raga?.key === raga.key && this.saHz === saHz && this.strings.length) return;
    const was = this.droneOn;
    this.stopDrone(0.3);
    this.tune(raga, saHz);
    if (was) window.setTimeout(() => this.startDrone(0.8), 320);
  }

  get droneOn() {
    return this.droneTimer !== null;
  }

  // ------------------------------------------------------------ pieces

  /** Play notes; with `lyrics` (syllables and their start beats) the voice sings the words. */
  play(notes: Note[], tempo: number, tag?: string, lyrics?: Lyric[]): Playback {
    this.stopPiece();
    const beat = 60 / tempo;
    const t0 = this.now + 0.3;
    const last = notes[notes.length - 1];
    const end = t0 + (last.t + last.d) * beat;
    const v = this.lead();
    v.start(t0, swaraHz(notes[0].s, notes[0].o, this.saHz));
    notes.forEach((n, i) => v.note(t0 + n.t * beat, swaraHz(n.s, n.o, this.saHz), n.d * beat, i === 0));
    if (lyrics && v instanceof Voice) for (const l of lyrics) v.syllable(t0 + l.t * beat, phone(l.syl));
    v.release(end);
    this.piece = v;
    const pb = { t0, beat, end, notes, tag };
    this.playback = pb;
    if (this.endTimer) window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => this.onEnd?.(pb), (end - this.now + 0.3) * 1000);
    return pb;
  }

  stopPiece() {
    this.piece?.release(this.now, 0.05);
    this.piece = null;
    this.playback = null;
    this.curve = null;
    if (this.endTimer) window.clearTimeout(this.endTimer);
  }

  /** Sing a real singer's pitch curve (cents above Sa every `hop` s; null = silence),
   *  transposed to this Sa. This is a resynthesis of the pitch, not the recording. */
  singCurve(cents: (number | null)[], hop: number, tag: string): Curve {
    this.stopPiece();
    const t0 = this.now + 0.25;
    const first = cents.find((c) => c !== null) ?? 0;
    const v = new Voice(this.ctx, this.leadBus, this.noiseBuf, this.voiceWave);
    v.start(t0, this.saHz * 2 ** (first / 1200));
    v.depth.gain.value = 0; // the real curve already carries its own vibrato and gamak
    let voiced = false;
    cents.forEach((c, i) => {
      const at = t0 + i * hop;
      if (c === null) {
        if (voiced) v.amp.gain.setTargetAtTime(0, at, 0.03);
        voiced = false;
        return;
      }
      v.osc.frequency.linearRampToValueAtTime(this.saHz * 2 ** (c / 1200), at);
      if (!voiced) {
        v.amp.gain.setTargetAtTime(0.95, at, 0.04);
        v.breath.gain.setTargetAtTime(0.02, at, 0.05);
      }
      voiced = true;
    });
    const end = t0 + cents.length * hop;
    v.release(end, 0.15);
    this.piece = v;
    this.playback = null;
    const curve = { t0, hop, end, tag };
    this.curve = curve;
    if (this.endTimer) window.clearTimeout(this.endTimer);
    this.endTimer = window.setTimeout(() => {
      if (this.curve === curve) this.curve = null;
      this.onEnd?.({ t0, beat: 1, end, notes: [], tag });
    }, (end - this.now + 0.3) * 1000);
    return curve;
  }

  /** Resolves when the given playback finishes (or is replaced). */
  until(pb: Playback) {
    return new Promise<void>((resolve) => {
      const check = () => (this.playback !== pb || this.now > pb.end + 0.2 ? resolve() : window.setTimeout(check, 100));
      check();
    });
  }

  // ------------------------------------------------------------ playing by hand

  /** One short note (a tap on the mandala). Wrong notes sound muted. */
  note(swara: string, octave: number, dur = 0.55, kind: Hit["kind"] = "note") {
    const hz = swaraHz(swara, octave, this.saHz);
    const v = this.lead();
    const at = this.now + 0.01;
    v.start(at, hz);
    v.note(at, hz, dur, true, kind === "wrong" ? 0.3 : 0.85);
    v.release(at + dur, kind === "wrong" ? 0.06 : 0.18);
    this.log({ at, semis: "SrRgGmMPdDnN".indexOf(swara) + 12 * octave, hz, kind });
  }

  log(h: Hit) {
    this.hits.push(h);
    if (this.hits.length > 200) this.hits.shift();
  }

  /** Continuous voice for meend (glides): start, move, end. */
  glideStart(hz: number) {
    this.glideEnd();
    const v = this.flute();
    const at = this.now + 0.01;
    v.start(at, hz);
    v.amp.gain.setTargetAtTime(0.85, at, 0.04);
    v.breath.gain.setTargetAtTime(0.06, at, 0.05);
    v.depth.gain.setTargetAtTime(0.004 * hz, at + 0.35, 0.3);
    this.glide = v;
  }
  glideTo(hz: number, tau = 0.03) {
    this.glide?.osc.frequency.setTargetAtTime(hz, this.now, tau);
  }
  glideEnd() {
    this.glide?.release(this.now, 0.15);
    this.glide = null;
  }

  /** Pure overtone k of the low Sa string (the harmonic ladder). */
  harmonic(k: number, dur = 1.6) {
    const hz = (this.saHz / 2) * k;
    const o = this.ctx.createOscillator();
    o.frequency.value = hz;
    const g = this.ctx.createGain();
    const at = this.now + 0.01;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.5 / Math.sqrt(k), at + 0.03);
    g.gain.setTargetAtTime(0, at + dur * 0.6, dur * 0.25);
    o.connect(g).connect(this.leadBus);
    o.start(at);
    o.stop(at + dur * 2);
    this.log({ at, semis: 12 * Math.log2(k / 2), hz, kind: "harmonic" });
  }

  /** A held test tone for the tuning lab (no vibrato, so beating is audible). */
  testOn(hz: number) {
    if (this.test) return this.testSet(hz);
    const v = this.flute();
    const at = this.now + 0.01;
    v.start(at, hz);
    v.amp.gain.setTargetAtTime(0.7, at, 0.08);
    v.breath.gain.setTargetAtTime(0.02, at, 0.1);
    this.test = v;
  }
  testSet(hz: number) {
    this.test?.osc.frequency.setTargetAtTime(hz, this.now, 0.05);
  }
  testOff() {
    this.test?.release(this.now, 0.2);
    this.test = null;
  }
  get testing() {
    return this.test !== null;
  }

  /** Pluck one tanpura string by hand (0 = Pa/Ma, 1–2 = Sa, 3 = low Sa). */
  pluckString(i: number, level = 0.5) {
    if (!this.strings.length) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.strings[i % 4];
    const g = this.ctx.createGain();
    g.gain.value = level;
    s.connect(g).connect(this.bus);
    const at = this.now + 0.005;
    s.start(at);
    this.plucks.push({ at, string: i % 4 });
    if (this.plucks.length > 64) this.plucks.shift();
  }

  /** A tabla stroke, synthesised: the dayan (right, tuned to Sa) rings bright and short;
   *  the bayan (left) is a low boom whose pitch rises as the palm presses. */
  tabla(bol: string, at = this.now + 0.005, level = 1) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.55 * level;
    out.connect(this.bus);
    const b = bol.toLowerCase();
    const dayan = /^(na|ta|tin|tun|dhin|dha|ti|te|ra|ki|tit)/.test(b) || b === "dhin" || b === "dha";
    const bayan = /^(dha|dhin|ge|ghe|ka|kat)/.test(b);
    const ring = /^(tin|tun|dhin)/.test(b); // open, resonant strokes
    if (dayan) {
      // a few inharmonic partials of a loaded membrane, over Sa
      for (const [m, g] of [[1, 1], [2, 0.5], [3, 0.32], [4.1, 0.18]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = this.saHz * m;
        const e = ctx.createGain();
        const dec = (ring ? 0.55 : 0.16) / Math.sqrt(m);
        e.gain.setValueAtTime(0, at);
        e.gain.linearRampToValueAtTime(0.3 * g, at + 0.003);
        e.gain.exponentialRampToValueAtTime(0.0001, at + dec);
        o.connect(e).connect(out);
        o.start(at);
        o.stop(at + dec + 0.05);
      }
      // the click of the finger
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = 3000;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.25, at);
      e.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
      n.connect(f).connect(e).connect(out);
      n.start(at, Math.random());
      n.stop(at + 0.05);
    }
    if (bayan) {
      const o = ctx.createOscillator();
      const press = b.startsWith("ka") ? 0 : 1;
      o.frequency.setValueAtTime(this.saHz / 3.2, at);
      o.frequency.exponentialRampToValueAtTime((this.saHz / 3.2) * (1 + 0.35 * press), at + 0.25);
      const e = ctx.createGain();
      const dec = press ? 0.7 : 0.08;
      e.gain.setValueAtTime(0, at);
      e.gain.linearRampToValueAtTime(0.9, at + 0.006);
      e.gain.exponentialRampToValueAtTime(0.0001, at + dec);
      o.connect(e).connect(out);
      o.start(at);
      o.stop(at + dec + 0.05);
    }
  }

  /** Play teentaal's theka once (16 beats), calling back on each beat. */
  theka(tempo: number, onBeat?: (i: number) => void) {
    const bols = ["dha", "dhin", "dhin", "dha", "dha", "dhin", "dhin", "dha", "dha", "tin", "tin", "ta", "ta", "dhin", "dhin", "dha"];
    const beat = 60 / tempo;
    const t0 = this.now + 0.1;
    bols.forEach((b, i) => {
      this.tabla(b, t0 + i * beat, i === 0 ? 1.15 : 0.9);
      if (onBeat) window.setTimeout(() => onBeat(i), (t0 + i * beat - this.now) * 1000);
    });
    if (onBeat) window.setTimeout(() => onBeat(-1), (t0 + 16 * beat - this.now) * 1000);
    return 16 * beat;
  }

  // ------------------------------------------------------------ harmonium reeds

  private reeds = new Map<string, { stop: (at: number) => void }>();
  private reedWave: PeriodicWave | null = null;
  private airGain: GainNode | null = null;

  /** The bellows: every reed sounds through this, so "air" swells and settles like pumping. */
  private air() {
    if (!this.airGain) {
      this.airGain = this.ctx.createGain();
      this.airGain.gain.value = 0.75;
      const tone = this.ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 3600;
      tone.Q.value = 0.4;
      this.airGain.connect(tone).connect(this.bus);
      // a reed's spectrum: strong odd and even harmonics, a nasal peak around the 3rd–5th
      const n = 28;
      const im = new Float32Array(n);
      for (let k = 1; k < n; k++) im[k] = (1 / k ** 0.75) * (k >= 3 && k <= 5 ? 1.5 : 1) * (k % 2 ? 1 : 0.8);
      this.reedWave = this.ctx.createPeriodicWave(new Float32Array(n), im);
    }
    return this.airGain;
  }

  /** Press a harmonium key: two reeds a few cents apart (the beating that makes it shimmer). */
  reedOn(id: string, hz: number, level = 1) {
    if (this.reeds.has(id)) return;
    const ctx = this.ctx, out = this.air();
    const at = this.now + 0.004;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.11 * level, at + 0.035); // reeds speak fast
    g.gain.setTargetAtTime(0.085 * level, at + 0.05, 0.25); // and settle as the air evens out
    g.connect(out);
    const oscs = [0, 3.5].map((cents) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.reedWave!);
      o.frequency.value = hz * 2 ** (cents / 1200);
      o.connect(g);
      o.start(at);
      return o;
    });
    // breath of the bellows through the reed chamber
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.min(6000, hz * 6);
    bp.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.value = 0.012 * level;
    n.connect(bp).connect(ng).connect(g);
    n.start(at, Math.random());
    this.reeds.set(id, {
      stop: (t) => {
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, 0.045);
        for (const o of oscs) o.stop(t + 0.4);
        n.stop(t + 0.4);
      },
    });
    this.log({ at, semis: 12 * Math.log2(hz / this.saHz), hz, kind: "note" });
  }

  reedOff(id: string, after = 0) {
    const r = this.reeds.get(id);
    if (!r) return;
    this.reeds.delete(id);
    r.stop(this.now + after);
  }

  reedsOff() {
    for (const id of [...this.reeds.keys()]) this.reedOff(id);
  }

  get reedCount() {
    return this.reeds.size;
  }

  /** A tiny pluck for UI feedback: a short, quiet harmonic of Sa. */
  tick(kind: "tap" | "soft" = "tap") {
    if (this.ctx.state !== "running") return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const at = this.now + 0.005;
    o.type = "sine";
    o.frequency.value = this.saHz * (kind === "tap" ? 4 : 3);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(kind === "tap" ? 0.05 : 0.03, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    o.connect(g).connect(this.leadBus);
    o.start(at);
    o.stop(at + 0.2);
  }

  /** Energy in three bands, 0..1, for the resonance field. */
  bands(buf: Uint8Array<ArrayBuffer>) {
    this.analyser.getByteFrequencyData(buf);
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;
    const avg = (lo: number, hi: number) => {
      let s = 0;
      const a = Math.floor(lo / binHz), b = Math.ceil(hi / binHz);
      for (let i = a; i < b; i++) s += buf[i];
      return s / (b - a) / 255;
    };
    return [avg(60, 250), avg(250, 1200), avg(1200, 5000)] as const;
  }
}

let engine: Engine | null = null;
export function getEngine() {
  if (!engine) {
    engine = new Engine();
    if (process.env.NODE_ENV === "development") (window as unknown as { __engine: Engine }).__engine = engine; // local audio checks
  }
  return engine;
}
export const peekEngine = () => engine;
