// The studio: a bandish (notes + words) produced as a track. Raga melody and sung words on top, a
// production bed underneath, the way records are made: layers locked to the tala grid, a sidechain
// pump, reverb and delay on sends (the reverb ducks while the voice sings), saturation and a master
// chain for glue. The arrangement is a bandish's: sthayi → interlude (voice calls, bansuri answers)
// → antara → a taan → the mukhda returns → a wordless coda home to Sa; everything plays together
// from the first beat. Five themes, each raga with a default by its mood.
// Works on any BaseAudioContext: live in the page, or offline to a WAV.

import { Voice, tanpuraPluck, voiceWave } from "./audio";
import { clap, epiano, hat, kick, logDrum, pluck, rim, shaker, snare, supersaw } from "./kit";
import { type Note, RATIOS, type Raga, swaraHz } from "./music";
import { type Lyric, phone } from "./phones";

/** Drum patterns, 16 steps (sixteenths) per bar, repeating; one or two bars long.
 *  x = hit, o = ghost (soft), O = accent (an open hat, a hard hit), . = rest. */
export type Groove = { kick?: string; snare?: string; clap?: string; hat?: string; shaker?: string; rim?: string; log?: string; rolls?: boolean };

export type Preset = {
  key: string;
  name: string;
  blurb: string;
  tempo: number;
  reverb: { seconds: number; send: number };
  delay: { send: number; throw: number; feedback: number };
  pump: number; // how far the bed ducks on each kick (0 = none)
  groove: Groove;
  swing: number; // where the off-sixteenth falls: 0.5 straight, 0.6 lazy
  human: number; // timing scatter (ms) and velocity scatter, for hands not machines
  tabla: number;
  pad: number;
  keys: { kind: "none" | "epiano" | "supersaw" | "stabs"; level: number };
  pluck: { kind: "none" | "sitar" | "santoor"; level: number };
  bass: { level: number; kind: "sub" | "808" | "log" | "arp" | "offbeat" };
  crackle: number;
  rain: number;
  top: number; // master low-pass (Hz)
  double: boolean; // a detuned, delayed second voice, panned
  ghost: boolean; // the melody an octave below, dark and wet
  drop: boolean; // sthayi builds (filter opens), interlude breaks down, a beat of silence, the antara drops
  gatedSnare?: boolean; // the 80s snare: a big room cut short
  energy?: number; // macro: drums' level and density (0..1, default 0.75)
  voice?: number; // macro: voice level (default 0.9)
};

const base: Omit<Preset, "key" | "name" | "blurb" | "tempo"> = {
  reverb: { seconds: 2.2, send: 0.22 }, delay: { send: 0.08, throw: 0.4, feedback: 0.35 }, pump: 0, groove: {}, swing: 0.5, human: 6,
  tabla: 0, pad: 0, keys: { kind: "none", level: 0 }, pluck: { kind: "none", level: 0 }, bass: { level: 0, kind: "sub" },
  crackle: 0, rain: 0, top: 11000, double: false, ghost: false, drop: false,
};

export const PRESETS: Preset[] = [
  { ...base, key: "lofi", name: "Lo-fi", tempo: 92, blurb: "Lo-fi hip hop: a lazy boom-bap swing, a warm FM electric piano on the raga's chords, vinyl dust, a doubled voice.",
    pump: 0.3, swing: 0.62, human: 9,
    groove: { kick: "x......x..x.....x.......x.x.....", snare: "....x..o....x.......x.......x..o", hat: "x.x.x.x.x.x.x.xOx.x.x.x.x.x.x.x." },
    tabla: 0.15, keys: { kind: "epiano", level: 1 }, bass: { level: 0.4, kind: "sub" }, crackle: 0.022, top: 9000, double: true },
  { ...base, key: "amapiano", name: "Amapiano", tempo: 112, blurb: "Amapiano: a soft four-on-the-floor, shakers in sixteenths, rimshots, and the log drum's knocking bassline on the raga's notes.",
    pump: 0.35, swing: 0.56, human: 5,
    groove: { kick: "x...x...x...x...", shaker: "xoxoxoxoxoxoxoxo", rim: "..x...x...x..x.x", log: "x..x..x...x.x...", clap: "....x.......x..." },
    keys: { kind: "epiano", level: 0.7 }, pad: 0.04, bass: { level: 0.75, kind: "log" }, top: 16000 },
  { ...base, key: "synthwave", name: "Synthwave", tempo: 104, blurb: "Synthwave: the 80s, a gated-reverb snare, an octave-jumping bass in sixteenths, supersaw chords, everything wide.",
    reverb: { seconds: 3, send: 0.28 }, pump: 0.3, swing: 0.5, human: 2, gatedSnare: true,
    groove: { kick: "x.......x.......", snare: "....x.......x...", hat: "..x...x...x...x." },
    keys: { kind: "supersaw", level: 0.8 }, bass: { level: 0.5, kind: "arp" }, top: 16000, double: true },
  { ...base, key: "drop", name: "Drop", tempo: 116, blurb: "Build and drop: the sthayi builds as the filter opens, the interlude breaks down, a riser and a beat of silence, then the antara drops: four on the floor, claps, house bass, chord stabs.",
    reverb: { seconds: 2.6, send: 0.25 }, pump: 0.6, swing: 0.5, human: 2, drop: true,
    groove: { kick: "x...x...x...x...", clap: "....x.......x...", hat: "..O...O...O...O." },
    tabla: 0.12, pad: 0.05, keys: { kind: "stabs", level: 0.9 }, bass: { level: 0.6, kind: "offbeat" }, top: 16000, double: true },
  { ...base, key: "night", name: "Night", tempo: 104, blurb: "Late and heavy: a half-time trap beat, an 808 that slides between the raga's roots, hats that roll, a sitar answering in the gaps.",
    reverb: { seconds: 2.8, send: 0.25 }, pump: 0.35, swing: 0.5, human: 3,
    groove: { kick: "x.....x...x..x..x......x.x......", snare: "........x...............x.......", hat: "xxxxxxxxxxxxxxxx", rolls: true },
    tabla: 0.1, pad: 0.05, pluck: { kind: "sitar", level: 0.8 }, bass: { level: 0.55, kind: "808" }, crackle: 0.01, top: 14000, ghost: true },
  { ...base, key: "rain", name: "Rain", tempo: 98, blurb: "Dub in the monsoon: rain under everything, rimshots thrown into the delay, a deep sub, a ghost voice an octave down.",
    reverb: { seconds: 3.4, send: 0.3 }, delay: { send: 0.14, throw: 0.7, feedback: 0.5 }, pump: 0.3, swing: 0.55, human: 6,
    groove: { kick: "x.........x.....", rim: "....x.......x...", hat: "..x...x...x...x." },
    tabla: 0.18, pad: 0.05, pluck: { kind: "sitar", level: 0.5 }, bass: { level: 0.55, kind: "sub" }, rain: 0.05, top: 12000, ghost: true },
  { ...base, key: "calm", name: "Calm", tempo: 96, blurb: "Dawn and stillness: no drums, santoor strings rippling through the raga's chords, a long room, the voice doubled and far away.",
    reverb: { seconds: 4.5, send: 0.42 }, delay: { send: 0.12, throw: 0.4, feedback: 0.45 },
    pad: 0.09, pluck: { kind: "santoor", level: 0.7 }, bass: { level: 0.2, kind: "sub" }, crackle: 0.008, top: 15000, double: true, ghost: true },
];

/** Each raga's default style, by its hour and mood (any style can still be chosen). */
export const THEME_OF: Record<string, string> = {
  bhairav: "calm", todi: "calm", deshkar: "calm",
  shuddh_sarang: "amapiano", madhuvanti: "lofi", yaman: "lofi", bhupali: "synthwave", bihag: "lofi",
  marwa: "night", darbari: "night", malkauns: "night",
  miyan_malhar: "rain", basant: "drop",
};
export const themeFor = (raga: string) => PRESETS.find((p) => p.key === (THEME_OF[raga] ?? "lofi"))!;

/** The macro knobs on a style: energy, space, warmth, swing, tempo, voice. */
export type Controls = { energy: number; space: number; warmth: number; swing: number; tempo: number; voice: number };
// The voice leads but sits in the track: soloed, it was as loud as the whole mix (keys 11 dB and
// hats 30 dB under it). Defaults now put keys ~5 dB and hats ~14 dB below the voice.
export const defaultControls = (p: Preset): Controls => ({ energy: 0.75, space: 0.5, warmth: 0.5, swing: p.swing, tempo: p.tempo, voice: 0.6 });
export function withControls(p: Preset, c: Controls): Preset {
  return {
    ...p,
    tempo: c.tempo,
    swing: c.swing,
    reverb: { ...p.reverb, send: p.reverb.send * (0.4 + 1.2 * c.space) },
    delay: { ...p.delay, send: p.delay.send * (0.4 + 1.2 * c.space) },
    top: p.top * 2 ** ((0.5 - c.warmth) * 1.6), // warmer = darker
    energy: c.energy,
    voice: c.voice,
  };
}

/** The raga's chords: its own notes stacked in alternate steps (no note outside the raga), on
 *  the home degree, a second and a third, as semitones above Sa (an octave and more). */
export function ragaChords(swaras: string[]): number[][] {
  const order = "SrRgGmMPdDnN";
  const scale = [...swaras].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((s) => order.indexOf(s));
  const n = scale.length;
  const at = (i: number) => scale[i % n] + 12 * Math.floor(i / n);
  const chord = (deg: number) => (n >= 6 ? [0, 2, 4, 6] : [0, 2, 4]).map((k) => at(deg + k));
  const second = n >= 6 ? 3 : 2, third = n >= 6 ? 4 : 3;
  return [chord(0), chord(0), chord(second), chord(third)]; // one chord a bar: home, home, second, third
}

/** A bandish (notes, words) plus two wordless phrases in its raga: an interlude between sthayi and
 *  antara, and a coda after the last words (aakar, with the bansuri). */
export type Piece = { notes: Note[]; lyrics?: Lyric[]; beats: number; raga: Raga; saHz: number; interlude?: Note[]; coda?: Note[] };
export const LAYERS = ["voice", "double", "ghost", "bansuri", "keys", "pluck", "drone", "pad", "bass", "kick", "snare", "hats", "perc", "tabla", "texture", "riser"] as const;
export type Layers = Partial<Record<(typeof LAYERS)[number], boolean>>;

const OUTRO = 2; // a short tail: the track ends with the music, not a drone
const THEKA = ["dha", "dhin", "dhin", "dha", "dha", "dhin", "dhin", "dha", "dha", "tin", "tin", "ta", "ta", "dhin", "dhin", "dha"];
const SWARAS = "SrRgGmMPdDnN";

/** A taan: a fast run up the raga's notes to upper Sa and back, in sixteenths, landing on Sa. */
export function taan(raga: Raga): Note[] {
  const up = SWARAS.split("").filter((s) => raga.swaras.includes(s));
  const run = [...up.map((s) => ({ s, o: 0 })), { s: "S", o: 1 }, ...[...up].reverse().map((s) => ({ s, o: 0 }))];
  const notes = run.map((x, i) => ({ ...x, t: i * 0.25, d: 0.25, bar: 0, ok: true }));
  const last = notes[notes.length - 1];
  last.d = Math.max(0.25, 4 - last.t); // hold the final Sa to the end of the bar
  return notes;
}

/** A bandish ready for the studio: its notes and words, plus a low interlude and a coda picked
 *  from the composer's own pieces in the raga (`pool`). */
export function pieceFor(b: { notes: Note[]; beats: number; bol: string[] }, raga: Raga, pool: Note[][], seed = 0, saHz = 220): Piece {
  const lyrics: Lyric[] = [];
  b.bol.forEach((tok, i) => {
    if (tok === "-" || tok === "ऽ") return;
    const parts = tok.split("·").filter(Boolean);
    parts.forEach((syl, k) => lyrics.push({ t: i + k / parts.length, syl }));
  });
  return { notes: b.notes, lyrics, beats: b.beats, raga, saHz, interlude: pickPhrase(pool, 8, { low: true, seed }), coda: pickPhrase(pool, 8, { low: true, endOnSa: true, seed: seed + 1 }) };
}

/** The track's timeline as one run of notes and words, with its sections. A short phrase (under two
 *  cycles, e.g. Sing to it's answer) plays as it is, over the bed. */
export function arrange(p: Piece) {
  if (p.beats < 32) {
    return { notes: p.notes, lyrics: p.lyrics, flute: [] as Note[], beats: p.beats, antara: p.beats, sections: [["answer", 0, p.beats]] as [string, number, number][], toSheet: (b: number) => (b < p.beats ? b : null) };
  }
  const half = p.beats / 2, I = p.interlude?.length ? 8 : 0, C = p.coda?.length ? 8 : 0;
  const shift = <T extends { t: number }>(xs: T[], by: number) => xs.map((x) => ({ ...x, t: x.t + by }));
  // The taan bar, then the mukhda returns: the second half of the first cycle, the pickup whose last
  // syllable lands on sam (the coda's first beat).
  const T = taan(p.raga), TL = 4, M = 8, MS = 8;
  const at = { interlude: half, antara: half + I, taan: p.beats + I, mukhda: p.beats + I + TL, coda: p.beats + I + TL + M };
  const sthayi = p.notes.filter((n) => n.t < half), antara = p.notes.filter((n) => n.t >= half), mukhda = p.notes.filter((n) => n.t >= MS && n.t < MS + M);
  // Interlude: the voice calls (first 4 beats), the bansuri answers (last 4). Coda: the voice sings it
  // home, the bansuri answers its second half.
  const call = (p.interlude ?? []).filter((n) => n.t < 4), answer = (p.interlude ?? []).filter((n) => n.t >= 4);
  const notes = [...sthayi, ...shift(call, at.interlude), ...shift(antara, I), ...shift(T, at.taan), ...shift(mukhda, at.mukhda - MS), ...shift(p.coda ?? [], at.coda)];
  const lyrics = p.lyrics && [...p.lyrics.map((l) => ({ ...l, t: l.t < half ? l.t : l.t + I })), ...shift(p.lyrics.filter((l) => l.t >= MS && l.t < MS + M), at.mukhda - MS)];
  const flute = [...shift(answer, at.interlude), ...shift(T, at.taan), ...shift((p.coda ?? []).filter((n) => n.t >= 4), at.coda)];
  const beats = at.coda + C;
  const sections: [string, number, number][] = [["sthayi", 0, half], ...(I ? [["interlude", half, I] as [string, number, number]] : []), ["antara", at.antara, half], ["taan", at.taan, TL], ["mukhda", at.mukhda, M], ...(C ? [["coda", at.coda, C] as [string, number, number]] : [])];
  // The sheet shows the bandish: map a track beat back to it (null in the wordless sections).
  const toSheet = (b: number) => (b < half ? b : b >= at.antara && b < at.taan ? b - I : b >= at.mukhda && b < at.coda ? b - at.mukhda + MS : null);
  return { notes, lyrics, flute, beats, antara: at.antara, sections, toSheet };
}

export const lengthInBeats = (p: Piece) => arrange(p).beats + OUTRO;

/** A wordless phrase of `beats` from the composer's pieces in this raga, preferring the lower octave
 *  (the low run after the last words was the part that worked) and, for a coda, ending on Sa. */
export function pickPhrase(pieces: Note[][], beats = 8, opts: { low?: boolean; endOnSa?: boolean; seed?: number } = {}): Note[] {
  const windows: { ns: Note[]; score: number }[] = [];
  for (const ns of pieces) {
    const end = Math.max(...ns.map((n) => n.t + n.d));
    for (let b = 0; b + beats <= end; b += 4) {
      const w = ns.filter((n) => n.t >= b && n.t < b + beats).map((n) => ({ ...n, t: n.t - b, d: Math.min(n.d, b + beats - n.t) }));
      if (w.length < 5) continue;
      const low = w.filter((n) => n.o < 0).length / w.length;
      const last = w[w.length - 1];
      const score = (opts.low ? 2 * low : 0) + (opts.endOnSa && last.s === "S" ? 1 : 0) - w.filter((n) => n.o > 0).length / w.length;
      windows.push({ ns: w, score });
    }
  }
  if (!windows.length) return [];
  windows.sort((a, b) => b.score - a.score);
  const top = windows.slice(0, 6);
  let choice = top[(opts.seed ?? 0) % top.length].ns;
  if (opts.endOnSa && choice[choice.length - 1].s !== "S") {
    const last = choice[choice.length - 1];
    choice = [...choice.slice(0, -1), { ...last, d: Math.max(0.5, last.d - 1) }, { s: "S", o: 0, t: last.t + Math.max(0.5, last.d - 1), d: 1, bar: last.bar, ok: true }];
  }
  // The composer rarely goes this low on its own: if the phrase isn't mostly in the lower octave
  // already, sing it there (mandra), the register of the passage that worked.
  if (opts.low && choice.filter((n) => n.o < 0).length < choice.length / 2 && Math.max(...choice.map((n) => n.o)) <= 0) {
    choice = choice.map((n) => ({ ...n, o: n.o - 1 }));
  }
  return choice;
}

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

/** Rain: soft broadband wash with drops (short, pitched blips), 6 s, looped. */
function rainBuffer(ctx: BaseAudioContext) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, 6 * sr, sr);
  const d = buf.getChannelData(0);
  let s = 4321, lp = 0;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.length; i++) {
    lp += 0.25 * ((r() * 2 - 1) - lp);
    d[i] = lp * 0.5;
    if (r() < 0.0009) {
      const f = 1800 + 2500 * r(), a = 0.15 + 0.3 * r();
      for (let k = 0; k < 300 && i + k < d.length; k++) d[i + k] += a * Math.sin((2 * Math.PI * f * k) / sr) * Math.exp(-k / 60);
    }
  }
  return buf;
}

/** Build and schedule the whole track, starting at `t0`. Returns its end time and a stop(). */
export function produce(ctx: BaseAudioContext, dest: AudioNode, piece: Piece, preset: Preset, layers: Layers = {}, t0 = ctx.currentTime + 0.15) {
  const on = (k: (typeof LAYERS)[number]) => layers[k] !== false;
  const beat = 60 / preset.tempo;
  const P = (b: number) => t0 + b * beat; // a beat of the track (0 = the first note)
  const arr = arrange(piece);
  const total = arr.beats + OUTRO;
  const end = P(total) + preset.reverb.seconds;
  const sources: AudioScheduledSourceNode[] = [];
  const keep = <S extends AudioScheduledSourceNode>(s: S) => (sources.push(s), s);
  const noise = noiseBuffer(ctx);
  const sa = piece.saHz;
  const half = piece.beats / 2;
  const sec = Object.fromEntries(arr.sections.map(([n, s, l]) => [n, [s, s + l]])) as Record<string, [number, number]>;
  // In a drop track the drums wait for the antara; the interlude is a breakdown.
  const drums = (b: number) => !preset.drop || b >= arr.antara;
  const inBreakdown = (b: number) => preset.drop && sec.interlude && b >= sec.interlude[0] && b < sec.interlude[1];

  // ---------------------------------------------------------------- master and sends
  const masterIn = ctx.createGain();
  const shelf = ctx.createBiquadFilter();
  // Air on top (lo-fi stays dusty): the first mixes had almost nothing above 4 kHz.
  shelf.type = "highshelf"; shelf.frequency.value = preset.key === "lofi" ? 7000 : 10000; shelf.gain.value = preset.key === "lofi" ? -3 : 3;
  const top = ctx.createBiquadFilter();
  top.type = "lowpass"; top.frequency.value = preset.top; top.Q.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  // Smoother than before (it was squashed, ~-9 dB RMS): gentler compression, less clipping, more air.
  comp.threshold.value = -20; comp.ratio.value = 2; comp.attack.value = 0.012; comp.release.value = 0.3; comp.knee.value = 12;
  const clip = softClip(ctx, 1.05);
  const rumble = ctx.createBiquadFilter(); rumble.type = "highpass"; rumble.frequency.value = 28;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, t0);
  master.gain.linearRampToValueAtTime(0.7, t0 + 0.05); // everything together from the first beat (headroom: ~-12 dB RMS)
  masterIn.connect(rumble).connect(shelf).connect(top).connect(comp).connect(clip).connect(master).connect(dest);
  if (preset.drop) {
    // The build: the sthayi opens up as the filter rises; the breakdown dips; the drop is wide open.
    top.frequency.setValueAtTime(700, P(0));
    top.frequency.exponentialRampToValueAtTime(preset.top * 0.6, P(half));
    top.frequency.setTargetAtTime(1500, P(half), 0.3);
    top.frequency.exponentialRampToValueAtTime(preset.top, P(arr.antara) - 0.05);
  }
  top.frequency.setValueAtTime(preset.top, P(arr.beats - 2));
  top.frequency.exponentialRampToValueAtTime(900, P(total) + 0.5);
  master.gain.setValueAtTime(0.7, P(total - 2));
  master.gain.linearRampToValueAtTime(0, end);

  // The bed: everything except kick and clap goes through the pump.
  const pump = ctx.createGain();
  pump.connect(masterIn);
  if (preset.drop) {
    // A beat of silence before the drop (the reverb tail carries through it).
    pump.gain.setValueAtTime(1, P(arr.antara - 1));
    pump.gain.linearRampToValueAtTime(0.04, P(arr.antara - 1) + 0.03);
    pump.gain.setValueAtTime(0.04, P(arr.antara) - 0.01);
    pump.gain.linearRampToValueAtTime(1, P(arr.antara));
  }
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
  const drumBus = ctx.createGain(); // kick and clap: outside the pump, silent in the drop's gap
  drumBus.connect(masterIn);

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
  const lyrics = arr.lyrics ? snapLyrics(arr.lyrics, arr.notes) : undefined;
  const wave = voiceWave(ctx);
  const sing = (out: AudioNode, ns: Note[], shift = 1, lag = 0, level = 1, words = true) => {
    if (!ns.length) return;
    const v = new Voice(ctx, out, noise, wave);
    const hz = (n: Note) => swaraHz(n.s, n.o, sa) * shift;
    v.start(P(ns[0].t) + lag, hz(ns[0]));
    ns.forEach((n, i) => v.note(P(n.t) + lag, hz(n), n.d * beat, i === 0, level));
    if (words && lyrics) for (const l of lyrics) v.syllable(P(l.t) + lag, phone(l.syl), level);
    const last = ns[ns.length - 1];
    v.release(P(last.t + last.d) + lag + 0.3);
    sources.push(v.osc, v.lfo, v.wobble, v.noise);
  };
  if (on("voice")) {
    const vocal = bus(preset.voice ?? 0.6, 0, preset.reverb.send, preset.delay.send);
    // A vocal chain: a compressor evens it out, a dip at 5 kHz takes the edge off.
    const vc = ctx.createDynamicsCompressor(); vc.threshold.value = -22; vc.ratio.value = 3; vc.attack.value = 0.008; vc.release.value = 0.2;
    const ve = ctx.createBiquadFilter(); ve.type = "peaking"; ve.frequency.value = 5000; ve.Q.value = 1.2; ve.gain.value = -3;
    const vin = ctx.createGain();
    vin.connect(vc).connect(ve).connect(vocal);
    if (lyrics) {
      const throwSend = ctx.createGain();
      throwSend.gain.value = 0;
      vocal.connect(throwSend).connect(delayIn);
      lyrics.forEach((l, i) => {
        const next = lyrics[i + 1]?.t ?? arr.beats;
        if (next - l.t >= 2) { // the last syllable of a line: throw it into the delay
          throwSend.gain.setTargetAtTime(preset.delay.throw, P(l.t), 0.02);
          throwSend.gain.setTargetAtTime(0, P(l.t) + beat, 0.05);
        }
        reverbOut.gain.setTargetAtTime(0.55, P(l.t), 0.03); // the reverb ducks under the words
        reverbOut.gain.setTargetAtTime(1, P(l.t) + 0.15, 0.5); // and blooms in the gaps
      });
    }
    sing(vin, arr.notes);
    if (preset.double && on("double")) {
      sing(bus(0.3, -0.55, preset.reverb.send * 1.4), arr.notes, 1.0045, 0.014, 0.9);
      sing(bus(0.25, 0.55, preset.reverb.send * 1.4), arr.notes, 0.9965, 0.022, 0.9);
    }
    if (preset.ghost && on("ghost")) {
      const ghost = bus(0.3, 0, 0.7);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const g = ctx.createGain();
      g.connect(lp).connect(ghost);
      sing(g, arr.notes, 0.5, 0.03, 0.8);
    }
  }

  // ---------------------------------------------------------------- bansuri: answers, taan, coda
  if (arr.flute.length && on("bansuri")) {
    const flute = bus(0.42, 0.25, 0.4, 0.15);
    let phrase: Note[] = [];
    const play = (ns: Note[]) => {
      if (!ns.length) return;
      const f = new Bansuri(ctx, flute, noise);
      ns.forEach((n, i) => f.note(P(n.t), swaraHz(n.s, n.o, sa) * 2, n.d * beat, i === 0));
      f.release(P(ns[ns.length - 1].t + ns[ns.length - 1].d) + 0.2);
      sources.push(...f.sources);
    };
    for (const n of arr.flute) {
      const prev = phrase[phrase.length - 1];
      if (prev && n.t - (prev.t + prev.d) > 1) { play(phrase); phrase = []; }
      phrase.push(n);
    }
    play(phrase);
  }

  // ---------------------------------------------------------------- drone and pad
  if (on("drone")) {
    const drone = bus(0.28, 0, 0.35);
    const strings = [swaraHz(piece.raga.tanpura, -1, sa), sa, sa, sa / 2].map((hz, i) => tanpuraPluck(ctx, hz, 5, i + 1));
    const gaps = [1.1, 1.1, 1.1, 1.5];
    let t = P(0), i = 0;
    while (t < P(arr.beats)) {
      const s = keep(ctx.createBufferSource());
      s.buffer = strings[i % 4];
      const g = ctx.createGain(); g.gain.value = 0.85 + 0.15 * ((i * 7) % 5) / 5;
      s.connect(g).connect(drone);
      s.start(t);
      t += gaps[i % 4] * 0.95;
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
    env.gain.setValueAtTime(0, P(0));
    env.gain.linearRampToValueAtTime(1, P(1));
    if (preset.drop && sec.interlude) { // the breakdown: the pad swells up alone
      env.gain.setTargetAtTime(1.8, P(sec.interlude[0]), 0.4);
      env.gain.setTargetAtTime(1, P(arr.antara), 0.2);
    }
    lp.connect(env).connect(pad);
    for (const [hz, det] of [[sa / 2, 0], [sa / 2, 7], [swaraHz(piece.raga.tanpura, -1, sa), -5], [sa, 3]] as const) {
      const o = keep(ctx.createOscillator());
      o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.25;
      o.connect(g).connect(lp);
      o.start(P(0)); o.stop(end);
    }
    lfo.start(P(0)); lfo.stop(end);
  }

  // ---------------------------------------------------------------- chords, keys and strings
  const energy = preset.energy ?? 0.75;
  const chords = ragaChords(piece.raga.swaras); // one per bar, cycling every four bars
  const semiHz = (semi: number, base = sa) => base * 2 ** (Math.floor(semi / 12)) * RATIOS[((semi % 12) + 12) % 12];
  const chordAt = (b: number) => chords[Math.floor(b / 4) % 4];
  const bars = Math.ceil(arr.beats / 4);
  const playing = (b: number) => b < arr.beats && !inBreakdown(b);
  if (preset.keys.kind !== "none" && on("keys")) {
    // Two buses, left and right: chord notes alternate between them, so the keys sit wide around the voice.
    const keysL = bus(0.75 * preset.keys.level, -0.5, 0.35, 0.06), keysR = bus(0.75 * preset.keys.level, 0.5, 0.35, 0.06);
    const side = (i: number) => (i % 2 ? keysR : keysL);
    const keys = keysL;
    for (let bar = 0; bar < bars; bar++) {
      const b = bar * 4;
      if (!playing(b)) continue;
      const tones = chordAt(b);
      if (preset.keys.kind === "epiano") {
        // A chord on the bar, left hand an octave down, and a softer re-strike on the "and" of three.
        tones.forEach((semi, i) => epiano(ctx, side(i), P(b) + i * 0.012, semiHz(semi, sa / 2), 3.4 * beat, 0.9 - 0.08 * i, keep));
        epiano(ctx, keys, P(b), semiHz(tones[0], sa / 4), 3.6 * beat, 0.8, keep);
        if (bar % 2) tones.slice(1).forEach((semi, i) => epiano(ctx, side(i + 1), P(b + 2.5), semiHz(semi, sa / 2), 1.2 * beat, 0.45, keep));
      } else if (preset.keys.kind === "supersaw") {
        tones.forEach((semi, i) => supersaw(ctx, side(i), P(b), semiHz(semi, sa / 2), 4 * beat - 0.05, 0.9, keep, 2600));
      } else if (drums(b)) {
        // House stabs on the offbeats (only once the drop has landed).
        for (const off of [0.5, 1.5, 2.5, 3.5]) tones.forEach((semi, i) => supersaw(ctx, side(i), P(b + off), semiHz(semi, sa / 2), 0.22 * beat, 0.8, keep, 3400));
      }
    }
  }
  if (preset.pluck.kind !== "none" && on("pluck")) {
    const stringsL = bus(0.4 * preset.pluck.level, -0.45, 0.4, 0.1), stringsR = bus(0.4 * preset.pluck.level, 0.35, 0.4, 0.1);
    let alt = 0; // strings alternate left and right
    const kind = preset.pluck.kind;
    for (let bar = 0; bar < bars; bar++) {
      const b = bar * 4;
      if (b >= arr.beats) continue;
      const tones = chordAt(b);
      const wordless = arr.sections.some(([n, st, len]) => ["interlude", "taan", "coda"].includes(n) && b >= st && b < st + len);
      if (kind === "santoor") {
        // Santoor ripples: the chord's notes up and back in eighths, all through.
        const run = [...tones, tones[0] + 12, ...tones.slice(1).reverse()];
        for (let k = 0; k < 8; k++) pluck(ctx, alt++ % 2 ? stringsR : stringsL, P(b + k / 2), semiHz(run[k % run.length]), 0.55 + 0.1 * (k % 2 ? 0 : 1), "santoor", keep);
      } else if (wordless || bar % 4 === 0) {
        // Sitar: a stroke on sam, and a riff of the chord's notes in the wordless parts.
        if (wordless) [0, 0.75, 1.5, 2, 3].forEach((off, k) => pluck(ctx, alt++ % 2 ? stringsR : stringsL, P(b + off), semiHz(tones[k % tones.length] + (k === 4 ? 12 : 0)), 0.8, "sitar", keep));
        else pluck(ctx, alt++ % 2 ? stringsR : stringsL, P(b), semiHz(tones[0]), 0.9, "sitar", keep);
      }
    }
  }

  // ---------------------------------------------------------------- rhythm: patterns
  const G = preset.groove;
  const r = (() => { let x = 12345; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
  const kicks: number[] = [];
  const drumGlue = ctx.createDynamicsCompressor(); // drum bus glue
  drumGlue.threshold.value = -14; drumGlue.ratio.value = 4; drumGlue.attack.value = 0.003; drumGlue.release.value = 0.12;
  drumGlue.connect(drumBus);
  const drumLevel = 0.55 + 0.6 * energy;
  const kit = ctx.createGain(); kit.gain.value = drumLevel; kit.connect(drumGlue);
  const room = ctx.createGain(); room.gain.value = preset.gatedSnare ? 0.9 : 0.25; room.connect(reverbIn);
  if (preset.gatedSnare) { // the 80s gate: the room is cut a moment after each snare
    room.gain.value = 0;
  }
  const lane = (pattern: string | undefined, layer: (typeof LAYERS)[number], hit: (t: number, v: number, ch: string, b: number) => void) => {
    if (!pattern || !on(layer)) return;
    const len = pattern.length;
    for (let bar = 0; bar < bars; bar++) for (let k = 0; k < 16; k++) {
      const ch = pattern[(bar * 16 + k) % len];
      if (ch === ".") continue;
      if (ch === "o" && energy < 0.45) continue; // fewer ghosts when the energy is down
      const b = bar * 4 + k / 4 + (k % 2 ? (preset.swing - 0.5) * 0.5 : 0);
      if (b >= arr.beats || !drums(b) || inBreakdown(b)) continue;
      const jitter = ((r() - 0.5) * 2 * preset.human) / 1000;
      const v = (ch === "o" ? 0.35 : ch === "O" ? 1 : 0.85) * (1 - 0.15 * r() * (preset.human > 4 ? 1 : 0.4));
      hit(P(b) + jitter, v, ch, b);
    }
  };
  lane(G.kick, "kick", (t, v, _ch, b) => { kick(ctx, kit, t, v, keep, noise); kicks.push(b); });
  lane(G.snare, "snare", (t, v) => {
    snare(ctx, kit, t, v, keep, noise, room);
    if (preset.gatedSnare) { room.gain.setValueAtTime(0.9, t); room.gain.setValueAtTime(0.9, t + 0.22); room.gain.linearRampToValueAtTime(0, t + 0.26); }
  });
  lane(G.clap, "snare", (t, v) => clap(ctx, kit, t, v * 0.9, keep, noise, room));
  const hatOut = bus(12 * drumLevel, 0.3);
  lane(G.hat, "hats", (t, v, ch, b) => {
    if (energy < 0.4 && Math.round(b * 4) % 2) return; // sparser hats at low energy
    if (G.rolls && Math.floor(b) % 8 === 7) { // a roll on the last beat of every second bar
      if (Math.abs(b - Math.floor(b)) < 0.01) for (let k = 0; k < 8; k++) hat(ctx, hatOut, t + (k * beat) / 8, 0.35 + 0.08 * k, keep);
      return;
    }
    hat(ctx, hatOut, t, v, keep, ch === "O");
  });
  lane(G.shaker, "hats", (t, v) => shaker(ctx, hatOut, t, v, keep, noise));
  // Rimshots on their own bus: in Rain they're thrown into the delay, the dub way.
  const rims = ctx.createGain(); rims.connect(kit);
  if (preset.key === "rain") { const send = ctx.createGain(); send.gain.value = 0.5; rims.connect(send).connect(delayIn); }
  lane(G.rim, "perc", (t, v) => rim(ctx, rims, t, v, keep));
  // Sidechain pump: the bed ducks on every kick and breathes back.
  if (preset.pump) for (const b of kicks) {
    pump.gain.setTargetAtTime(1 - preset.pump * (0.6 + 0.4 * energy), P(b), 0.004);
    pump.gain.setTargetAtTime(1, P(b) + 0.04, 0.13);
  }
  if (preset.tabla && on("tabla")) {
    const tabla = bus(preset.tabla * (0.6 + 0.5 * energy), -0.2, 0.2);
    for (let b = 0; b < arr.beats; b++) if (!inBreakdown(b)) stroke(ctx, tabla, noise, sa, THEKA[b % 16], P(b), b % 16 === 0 ? 1 : 0.7, keep);
  }

  // ---------------------------------------------------------------- bass
  if (preset.bass.level && on("bass")) {
    const bass = bus(0.4 * preset.bass.level, 0); // soloed, the bass sat level with the voice: ~8 dB down
    const kind = preset.bass.kind;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = kind === "808" ? 600 : kind === "arp" ? 900 : 320;
    const sat = softClip(ctx, kind === "808" ? 2.5 : 1.8);
    lp.connect(sat).connect(bass);
    const low = sa > 160 ? sa / 4 : sa / 2; // the bass octave
    const rootHz = (b: number) => semiHz(chordAt(b)[0] % 12, low);
    const fifthHz = (b: number) => semiHz(chordAt(b)[2 % chordAt(b).length] % 12, low);
    const note = (t: number, hz: number, len: number, g = 1, type: OscillatorType = "sine") => {
      for (const [mult, gg] of [[1, 1], [2, 0.22]] as const) {
        const o = keep(ctx.createOscillator()); o.type = type; o.frequency.value = hz * mult;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g * gg, t + 0.01); e.gain.setTargetAtTime(0, t + len - 0.05, 0.05);
        o.connect(e).connect(lp); o.start(t); o.stop(t + len + 0.3);
      }
    };
    if (kind === "808") {
      // One long note a bar, sliding into the next chord's root.
      const o = keep(ctx.createOscillator());
      const e = ctx.createGain(); e.gain.value = 0;
      o.connect(e).connect(lp);
      o.frequency.setValueAtTime(rootHz(0), P(0));
      for (let bar = 0; bar < bars; bar++) {
        const b = bar * 4, t = P(b);
        if (!playing(b)) { e.gain.setTargetAtTime(0, t, 0.05); continue; }
        o.frequency.setTargetAtTime(rootHz(b), t - 0.04, 0.03);
        e.gain.setTargetAtTime(1, t, 0.008); e.gain.setTargetAtTime(0.55, t + 0.15, 0.4);
      }
      e.gain.setTargetAtTime(0, P(arr.beats), 0.1);
      o.start(P(0)); o.stop(end);
    } else if (kind === "log") {
      // The log drum carries the bassline: root, the chord's fifth, root, its octave.
      lane(G.log, "bass", (t, v, _ch, b) => {
        const step = Math.round((b % 4) * 4);
        const hz = step < 6 ? rootHz(b) : step < 11 ? fifthHz(b) : rootHz(b) * (step > 12 ? 2 : 1);
        logDrum(ctx, bass, t, hz, v, keep);
      });
    } else if (kind === "arp") {
      for (let b = 0; b < arr.beats; b += 0.25) if (playing(b)) note(P(b), rootHz(b) * (Math.round(b * 4) % 2 ? 2 : 1), 0.22 * beat, 0.8, "sawtooth");
    } else if (kind === "offbeat") {
      for (let b = 0.5; b < arr.beats; b += 1) if (playing(b) && drums(b)) note(P(b), rootHz(b), 0.4 * beat, 1);
    } else {
      for (let bar = 0; bar < bars; bar++) {
        const b = bar * 4;
        if (!playing(b) || !drums(b)) continue;
        note(P(b), rootHz(b), 3.5 * beat, 1);
      }
    }
  }

  // ---------------------------------------------------------------- texture and transitions
  if (on("texture")) {
    for (const [level, make, f, q] of [[preset.crackle, crackleBuffer, 2400, 0.4], [preset.rain, rainBuffer, 1800, 0.3]] as const) {
      if (!level) continue;
      const s = keep(ctx.createBufferSource()); s.buffer = make(ctx); s.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.value = level * 6;
      s.connect(bp).connect(g).connect(masterIn); // texture sits outside the pump
      s.start(P(0)); s.stop(end);
    }
  }
  if (on("riser")) {
    // A noise sweep into the antara: the classic build (longer before a drop).
    const len = preset.drop ? 8 : 4;
    const s = keep(ctx.createBufferSource()); s.buffer = noise; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 3;
    const g = ctx.createGain();
    const a = P(arr.antara - len), b = P(arr.antara - (preset.drop ? 1 : 0));
    bp.frequency.setValueAtTime(400, a); bp.frequency.exponentialRampToValueAtTime(7000, b);
    g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(preset.drop ? 0.14 : 0.09, b - 0.02); g.gain.linearRampToValueAtTime(0, b + 0.01);
    s.connect(bp).connect(g);
    g.connect(reverbIn);
    g.connect(masterIn);
    s.start(a); s.stop(b + 0.05);
  }

  return {
    end,
    beat,
    t0,
    stop: () => {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.08);
      for (const s of sources) { try { s.stop(now + 0.6); } catch { /* not started yet */ } }
    },
  };
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
/** A bansuri-like flute: a sine with a soft octave above, slow vibrato, breath noise, glides. */
class Bansuri {
  sources: AudioScheduledSourceNode[] = [];
  private osc: OscillatorNode;
  private oct: OscillatorNode;
  private amp: GainNode;
  private breath: GainNode;
  private vib: GainNode;
  constructor(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer) {
    this.osc = ctx.createOscillator();
    this.oct = ctx.createOscillator();
    this.oct.type = "triangle";
    const octGain = ctx.createGain(); octGain.gain.value = 0.12;
    this.amp = ctx.createGain(); this.amp.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
    this.osc.connect(this.amp);
    this.oct.connect(octGain).connect(this.amp);
    this.amp.connect(lp).connect(out);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.8;
    this.vib = ctx.createGain(); this.vib.gain.value = 0;
    lfo.connect(this.vib);
    this.vib.connect(this.osc.frequency);
    const n = ctx.createBufferSource(); n.buffer = noise; n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.9;
    this.breath = ctx.createGain(); this.breath.gain.value = 0;
    n.connect(bp).connect(this.breath).connect(out);
    this.sources.push(this.osc, this.oct, lfo, n);
  }
  note(at: number, hz: number, dur: number, first: boolean) {
    if (first) {
      for (const s of this.sources) s.start(at - 0.05);
      this.osc.frequency.setValueAtTime(hz * 0.98, at);
      this.oct.frequency.setValueAtTime(hz * 1.96, at);
    }
    this.osc.frequency.setTargetAtTime(hz, at - 0.02, 0.03);
    this.oct.frequency.setTargetAtTime(hz * 2, at - 0.02, 0.03);
    this.amp.gain.setTargetAtTime(0.32, at, first ? 0.04 : 0.02);
    this.breath.gain.setTargetAtTime(0.05, at, 0.01);
    this.breath.gain.setTargetAtTime(0.018, at + 0.08, 0.1);
    this.vib.gain.setTargetAtTime(0, at, 0.02);
    if (dur > 0.4) this.vib.gain.setTargetAtTime(hz * 0.008, at + 0.25, 0.2);
  }
  release(at: number) {
    for (const g of [this.amp.gain, this.breath.gain]) { g.cancelScheduledValues(at); g.setTargetAtTime(0, at, 0.12); }
    for (const s of this.sources) s.stop(at + 1.2);
  }
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
