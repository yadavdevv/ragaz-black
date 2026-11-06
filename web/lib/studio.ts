// The studio: a bandish (notes + words) produced as a track. Raga melody and sung words on top, a
// production bed underneath, the way records are made: layers locked to the tala grid, a sidechain
// pump, reverb and delay on sends (the reverb ducks while the voice sings), saturation and a master
// chain for glue, and an arrangement that builds (intro → sthayi → riser → antara → outro).
// Works on any BaseAudioContext: live in the page, or offline to a WAV.

import { Voice, tanpuraPluck, voiceWave } from "./audio";
import { type Note, type Raga, swaraHz } from "./music";
import { type Lyric, phone } from "./phones";

export type Preset = {
  key: string;
  name: string;
  blurb: string;
  tempo: number;
  reverb: { seconds: number; send: number };
  delay: { send: number; throw: number; feedback: number };
  pump: number; // how far the bed ducks on each kick (0 = none)
  kick: number[]; // beats of a 16-beat cycle
  hats: { level: number; swing: number; sixteenths: boolean };
  tabla: number;
  pad: number;
  bass: { level: number; from: "sthayi" | "antara" };
  crackle: number;
  top: number; // master low-pass (Hz)
  double: boolean; // a detuned, delayed second voice, panned
  ghost: boolean; // the melody an octave below, dark and wet
};

export const PRESETS: Preset[] = [
  {
    key: "tape", name: "Tape", blurb: "Lo-fi and warm: swung hats, a soft kick the whole bed breathes with, crackle, a doubled voice.",
    tempo: 84, reverb: { seconds: 2.2, send: 0.22 }, delay: { send: 0.08, throw: 0.4, feedback: 0.35 }, pump: 0.45, kick: [0, 8],
    hats: { level: 0.05, swing: 0.6, sixteenths: false }, tabla: 0.35, pad: 0.06, bass: { level: 0.45, from: "antara" }, crackle: 0.02, top: 9000, double: true, ghost: false,
  },
  {
    key: "dub", name: "Dub", blurb: "Space and weight: a deep sub on sam and khali, long delay throws at line ends, a ghost voice an octave down.",
    tempo: 76, reverb: { seconds: 3.4, send: 0.3 }, delay: { send: 0.1, throw: 0.7, feedback: 0.5 }, pump: 0.3, kick: [0, 10],
    hats: { level: 0.035, swing: 0.55, sixteenths: true }, tabla: 0.18, pad: 0.04, bass: { level: 0.8, from: "sthayi" }, crackle: 0.01, top: 7500, double: false, ghost: true,
  },
  {
    key: "drift", name: "Drift", blurb: "Ambient: no drums, a long room, pad swells under the drone, the voice doubled and far away.",
    tempo: 66, reverb: { seconds: 5, send: 0.45 }, delay: { send: 0.12, throw: 0.4, feedback: 0.45 }, pump: 0, kick: [],
    hats: { level: 0, swing: 0.5, sixteenths: false }, tabla: 0, pad: 0.11, bass: { level: 0.25, from: "antara" }, crackle: 0.015, top: 11000, double: true, ghost: true,
  },
];

export type Piece = { notes: Note[]; lyrics?: Lyric[]; beats: number; raga: Raga; saHz: number };
export type Layers = Partial<Record<"voice" | "double" | "ghost" | "drone" | "pad" | "bass" | "kick" | "hats" | "tabla" | "crackle" | "riser", boolean>>;
export const LAYERS = ["voice", "double", "ghost", "drone", "pad", "bass", "kick", "hats", "tabla", "crackle", "riser"] as const;

const INTRO = 16, OUTRO = 8;
const THEKA = ["dha", "dhin", "dhin", "dha", "dha", "dhin", "dhin", "dha", "dha", "tin", "tin", "ta", "ta", "dhin", "dhin", "dha"];

export const lengthInBeats = (p: Piece) => INTRO + p.beats + OUTRO;

/** Snap each syllable to the nearest note start within half a beat (the model's bol line sometimes
 *  puts a syllable on a held beat; sung, it starts where a note does). */
export function snapLyrics(lyrics: Lyric[], notes: Note[]): Lyric[] {
  return lyrics.map((l) => {
    let best = l.t, d = 0.5;
    for (const n of notes) if (Math.abs(n.t - l.t) <= d) { d = Math.abs(n.t - l.t); best = n.t; }
    return { ...l, t: best };
  });
}

function noiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 7) {
  const buf = ctx.createBuffer(1, Math.floor(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = seed;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
  return buf;
}

/** A dark stereo room: decaying noise, smoothed so the tail loses its highs. */
function impulse(ctx: BaseAudioContext, seconds: number) {
  const n = Math.floor(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let s = 99 + c, lp = 0;
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const t = i / ctx.sampleRate;
      const a = 0.18 + 0.75 * Math.min(1, t / seconds); // more smoothing later in the tail
      lp += (1 - a) * ((s / 2147483647) * 2 - 1 - lp);
      d[i] = lp * Math.exp((-4.5 * t) / seconds) * (i < 0.012 * ctx.sampleRate ? i / (0.012 * ctx.sampleRate) : 1);
    }
  }
  return buf;
}

/** Record crackle: sparse clicks over a quiet hiss, 4 s, looped. */
function crackleBuffer(ctx: BaseAudioContext) {
  const buf = ctx.createBuffer(1, 4 * ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 1234;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.length; i++) {
    d[i] = (r() * 2 - 1) * 0.06;
    if (r() < 0.00035) { const a = (r() * 2 - 1) * (0.4 + r()); for (let k = 0; k < 40 && i + k < d.length; k++) d[i + k] += a * Math.exp(-k / 6); }
  }
  return buf;
}

function softClip(ctx: BaseAudioContext, drive = 1.4) {
  const ws = ctx.createWaveShaper();
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(drive * x) / Math.tanh(drive); }
  ws.curve = curve;
  ws.oversample = "2x";
  return ws;
}

/** Build and schedule the whole track, starting at `t0`. Returns its end time and a stop(). */
export function produce(ctx: BaseAudioContext, dest: AudioNode, piece: Piece, preset: Preset, layers: Layers = {}, t0 = ctx.currentTime + 0.15) {
  const on = (k: (typeof LAYERS)[number]) => layers[k] !== false;
  const beat = 60 / preset.tempo;
  const T = (b: number) => t0 + b * beat; // beat → seconds (beat 0 = start of the intro)
  const P = (b: number) => T(INTRO + b); // a beat of the piece
  const total = lengthInBeats(piece);
  const end = T(total) + preset.reverb.seconds;
  const sources: AudioScheduledSourceNode[] = [];
  const keep = <S extends AudioScheduledSourceNode>(s: S) => (sources.push(s), s);
  const noise = noiseBuffer(ctx);
  const sa = piece.saHz;
  const half = piece.beats / 2; // sthayi | antara

  // ---------------------------------------------------------------- master and sends
  const masterIn = ctx.createGain();
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf"; shelf.frequency.value = 7000; shelf.gain.value = -3;
  const top = ctx.createBiquadFilter();
  top.type = "lowpass"; top.frequency.value = preset.top; top.Q.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.25; comp.knee.value = 8;
  const clip = softClip(ctx, 1.3);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.85, t0 + 1.5);
  masterIn.connect(shelf).connect(top).connect(comp).connect(clip).connect(master).connect(dest);
  // Outro: the filter closes and the track fades.
  top.frequency.setValueAtTime(preset.top, T(total - OUTRO));
  top.frequency.exponentialRampToValueAtTime(500, T(total) + 1);
  master.gain.setValueAtTime(0.85, T(total - 2));
  master.gain.linearRampToValueAtTime(0, end);

  // The bed: everything except the kick goes through the pump.
  const pump = ctx.createGain();
  pump.connect(masterIn);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, preset.reverb.seconds);
  const reverbIn = ctx.createGain();
  const reverbOut = ctx.createGain();
  reverbIn.connect(reverb).connect(reverbOut).connect(pump);
  const delay = ctx.createDelay(4);
  delay.delayTime.value = 0.75 * beat; // dotted eighth
  const fb = ctx.createGain(); fb.gain.value = preset.delay.feedback;
  const dhp = ctx.createBiquadFilter(); dhp.type = "highpass"; dhp.frequency.value = 350;
  const dlp = ctx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2600;
  const delayIn = ctx.createGain();
  delayIn.connect(delay).connect(dhp).connect(dlp).connect(fb).connect(delay);
  dlp.connect(pump);
  dlp.connect(reverbIn);

  const bus = (level: number, pan = 0, rev = 0, del = 0) => {
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(pump);
    if (rev) { const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(reverbIn); }
    if (del) { const s = ctx.createGain(); s.gain.value = del; g.connect(s).connect(delayIn); }
    return g;
  };

  // ---------------------------------------------------------------- the voice
  const lyrics = piece.lyrics ? snapLyrics(piece.lyrics, piece.notes) : undefined;
  const wave = voiceWave(ctx);
  const sing = (out: AudioNode, shift = 1, lag = 0, level = 1) => {
    const v = new Voice(ctx, out, noise, wave);
    const hz = (n: Note) => swaraHz(n.s, n.o, sa) * shift;
    v.start(P(piece.notes[0].t) + lag, hz(piece.notes[0]));
    piece.notes.forEach((n, i) => v.note(P(n.t) + lag, hz(n), n.d * beat, i === 0, level));
    if (lyrics) for (const l of lyrics) v.syllable(P(l.t) + lag, phone(l.syl), level);
    v.release(P(piece.beats) + lag + 0.4);
    sources.push(v.osc, v.lfo, v.wobble, v.noise);
  };
  if (on("voice")) {
    const vocal = bus(0.9, 0, preset.reverb.send, preset.delay.send);
    // Delay throws: open the delay send on the last syllable of each line (a syllable followed by
    // at least two beats without a new one).
    if (lyrics) {
      const throwSend = ctx.createGain();
      throwSend.gain.value = 0;
      vocal.connect(throwSend).connect(delayIn);
      lyrics.forEach((l, i) => {
        const next = lyrics[i + 1]?.t ?? piece.beats;
        if (next - l.t >= 2) {
          throwSend.gain.setTargetAtTime(preset.delay.throw, P(l.t), 0.02);
          throwSend.gain.setTargetAtTime(0, P(l.t) + beat, 0.05);
        }
        // Reverb ducks while the voice sings and blooms in the gaps.
        reverbOut.gain.setTargetAtTime(0.55, P(l.t), 0.03);
        reverbOut.gain.setTargetAtTime(1, P(l.t) + 0.15, 0.5);
      });
    }
    sing(vocal);
    if (preset.double && on("double")) {
      sing(bus(0.3, -0.55, preset.reverb.send * 1.4), 1.0045, 0.014, 0.9);
      sing(bus(0.25, 0.55, preset.reverb.send * 1.4), 0.9965, 0.022, 0.9);
    }
    if (preset.ghost && on("ghost")) {
      const ghost = bus(0.3, 0, 0.7);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const g = ctx.createGain();
      g.connect(lp).connect(ghost);
      sing(g, 0.5, 0.03, 0.8);
    }
  }

  // ---------------------------------------------------------------- drone and pad
  if (on("drone")) {
    const drone = bus(0.32, 0, 0.35);
    const strings = [swaraHz(piece.raga.tanpura, -1, sa), sa, sa, sa / 2].map((hz, i) => tanpuraPluck(ctx, hz, 5, i + 1));
    const gaps = [1.1, 1.1, 1.1, 1.5];
    let t = T(0), i = 0;
    while (t < T(total)) {
      const s = keep(ctx.createBufferSource());
      s.buffer = strings[i % 4];
      const g = ctx.createGain(); g.gain.value = 0.85 + 0.15 * ((i * 7) % 5) / 5;
      s.connect(g).connect(drone);
      s.start(t);
      t += gaps[i % 4] * 0.95; // the tanpura keeps its own slow pulse, whatever the tempo
      i++;
    }
  }
  if (preset.pad && on("pad")) {
    const pad = bus(preset.pad, 0, 0.5);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700; lp.Q.value = 0.7;
    const lfo = keep(ctx.createOscillator()); lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 300;
    lfo.connect(lfoAmt).connect(lp.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, T(0));
    env.gain.linearRampToValueAtTime(1, T(INTRO));
    lp.connect(env).connect(pad);
    for (const [hz, det] of [[sa / 2, 0], [sa / 2, 7], [swaraHz(piece.raga.tanpura, -1, sa), -5], [sa, 3]] as const) {
      const o = keep(ctx.createOscillator());
      o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.25;
      o.connect(g).connect(lp);
      o.start(T(0)); o.stop(end);
    }
    lfo.start(T(0)); lfo.stop(end);
  }

  // ---------------------------------------------------------------- rhythm
  const cycles = Math.ceil(piece.beats / 16);
  const kicks: number[] = [];
  if (preset.kick.length && on("kick")) {
    const kickOut = ctx.createGain(); kickOut.gain.value = 0.9; kickOut.connect(masterIn);
    for (let c = 0; c < cycles; c++) for (const k of preset.kick) {
      const b = c * 16 + k;
      if (b < half) continue; // the kick enters with the antara
      kicks.push(b);
      const t = P(b);
      const o = keep(ctx.createOscillator());
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(1, t + 0.004); e.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(e).connect(kickOut);
      o.start(t); o.stop(t + 0.45);
    }
  }
  // Sidechain pump: the bed ducks on every kick and breathes back.
  if (preset.pump) for (const b of kicks) {
    pump.gain.setTargetAtTime(1 - preset.pump, P(b), 0.004);
    pump.gain.setTargetAtTime(1, P(b) + 0.04, 0.13);
  }
  if (preset.hats.level && on("hats")) {
    const hats = bus(preset.hats.level, 0.3);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
    hp.connect(hats);
    const step = preset.hats.sixteenths ? 0.25 : 0.5;
    for (let b = 0; b < piece.beats; b += step) {
      const pos = b % 1;
      const swung = pos === 0.5 ? b + (preset.hats.swing - 0.5) : b;
      const accent = pos === 0 ? 1 : 0.55;
      if (preset.hats.sixteenths && (b * 4) % 3 === 2) continue; // a sparser, broken 16th line
      const t = P(swung);
      const s = keep(ctx.createBufferSource()); s.buffer = noise;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(accent, t + 0.002); e.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      s.connect(e).connect(hp);
      s.start(t, (b * 0.37) % 1.5); s.stop(t + 0.06);
    }
  }
  if (preset.tabla && on("tabla")) {
    const tabla = bus(preset.tabla, -0.2, 0.2);
    for (let b = 0; b < piece.beats; b++) stroke(ctx, tabla, noise, sa, THEKA[b % 16], P(b), b % 16 === 0 ? 1 : 0.7, keep);
  }
  if (preset.bass.level && on("bass")) {
    const bass = bus(preset.bass.level, 0);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
    const sat = softClip(ctx, 2);
    lp.connect(sat).connect(bass);
    const root = sa > 160 ? sa / 4 : sa / 2;
    const fifth = swaraHz(piece.raga.tanpura, 0, root);
    const from = preset.bass.from === "sthayi" ? 0 : half;
    for (let c = 0; c < cycles; c++) for (const [k, hz] of [[0, root], [8, fifth]] as const) {
      const b = c * 16 + k;
      if (b < from) continue;
      const t = P(b), len = 6 * beat;
      for (const [mult, g] of [[1, 1], [2, 0.25]] as const) {
        const o = keep(ctx.createOscillator()); o.frequency.value = hz * mult;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.03); e.gain.setTargetAtTime(0, t + len - 0.3, 0.15);
        o.connect(e).connect(lp);
        o.start(t); o.stop(t + len + 0.5);
      }
    }
  }

  // ---------------------------------------------------------------- texture and transitions
  if (preset.crackle && on("crackle")) {
    const s = keep(ctx.createBufferSource()); s.buffer = crackleBuffer(ctx); s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = preset.crackle * 6;
    s.connect(bp).connect(g).connect(masterIn); // texture sits outside the pump
    s.start(T(0)); s.stop(end);
  }
  if (on("riser")) {
    // A noise sweep into the antara: the classic build.
    const s = keep(ctx.createBufferSource()); s.buffer = noise; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3;
    const g = ctx.createGain();
    const a = P(half - 4), b = P(half);
    bp.frequency.setValueAtTime(400, a); bp.frequency.exponentialRampToValueAtTime(6000, b);
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(0.09, b - 0.02); g.gain.linearRampToValueAtTime(0, b + 0.01);
    s.connect(bp).connect(g);
    g.connect(reverbIn);
    g.connect(pump);
    s.start(a); s.stop(b + 0.05);
  }

  return {
    end,
    beat,
    t0,
    pieceStart: P(0),
    stop: () => {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.08);
      for (const s of sources) { try { s.stop(now + 0.6); } catch { /* not started yet */ } }
    },
  };
}

/** One tabla stroke: the dayan's loaded membrane over Sa, the bayan's bend (as in audio.ts). */
function stroke(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, sa: number, bol: string, at: number, level: number, keep: <S extends AudioScheduledSourceNode>(s: S) => S) {
  const dayan = /^(na|ta|tin|dhin|dha)/.test(bol);
  const bayan = /^(dha|dhin)/.test(bol);
  const ring = /^(tin|dhin)/.test(bol);
  if (dayan) {
    for (const [m, g] of [[1, 1], [2, 0.5], [3, 0.3]] as const) {
      const o = keep(ctx.createOscillator()); o.frequency.value = sa * m;
      const e = ctx.createGain(); const dec = (ring ? 0.5 : 0.15) / Math.sqrt(m);
      e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.25 * g * level, at + 0.003); e.gain.exponentialRampToValueAtTime(0.0001, at + dec);
      o.connect(e).connect(out); o.start(at); o.stop(at + dec + 0.05);
    }
    const n = keep(ctx.createBufferSource()); n.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 3000;
    const e = ctx.createGain(); e.gain.setValueAtTime(0.15 * level, at); e.gain.exponentialRampToValueAtTime(0.0001, at + 0.03);
    n.connect(hp).connect(e).connect(out); n.start(at, (at * 0.13) % 1.5); n.stop(at + 0.05);
  }
  if (bayan) {
    const o = keep(ctx.createOscillator());
    o.frequency.setValueAtTime(sa / 3.2, at); o.frequency.exponentialRampToValueAtTime((sa / 3.2) * 1.35, at + 0.25);
    const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.7 * level, at + 0.006); e.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
    o.connect(e).connect(out); o.start(at); o.stop(at + 0.65);
  }
}

/** Render offline and encode a 16-bit stereo WAV. */
export async function renderWav(piece: Piece, preset: Preset, layers: Layers = {}, sampleRate = 44100): Promise<Blob> {
  const seconds = lengthInBeats(piece) * (60 / preset.tempo) + preset.reverb.seconds + 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  produce(ctx, ctx.destination, piece, preset, layers, 0.05);
  const buf = await ctx.startRendering();
  const n = buf.length, data = new DataView(new ArrayBuffer(44 + n * 4));
  const w = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); data.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true); w(36, "data"); data.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) {
    data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return new Blob([data], { type: "audio/wav" });
}
