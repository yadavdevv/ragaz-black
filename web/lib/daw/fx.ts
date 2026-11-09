// The studio's effects, ready to drop on a clip (they run while it plays) or a track (always).
// Each is built from plain Web Audio nodes: delays fed back into themselves, convolution with a
// made-up room, filters, wave-shapers, and slow oscillators moving a parameter. Note effects change
// the notes themselves before they are played.

import type { NoteEv } from "./model";

export type Param = { key: string; label: string; min: number; max: number; step: number; def: number; unit?: string };
export type Built = { input: AudioNode; output: AudioNode; apply: (p: Record<string, number>, a: number, b: number, beat: number) => void };
export type FxDef = {
  type: string; name: string; group: "Space" | "Tone" | "Motion" | "Rhythm" | "Transitions" | "Notes"; blurb: string; icon: string; params: Param[];
  build?: (ctx: BaseAudioContext) => Built;
  notes?: (notes: NoteEv[], p: Record<string, number>) => NoteEv[];
};

const mix = (p: Param[] = []): Param[] => [...p, { key: "mix", label: "Amount", min: 0, max: 1, step: 0.01, def: 0.35 }];

function room(ctx: BaseAudioContext, seconds: number, seed: number, dark = 0.45) {
  const n = Math.ceil(seconds * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let s = seed + c * 13, lp = 0;
    for (let i = 0; i < n; i++) {
      const w = ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
      lp += dark * (w - lp);
      d[i] = lp * Math.pow(1 - i / n, 2.2);
    }
  }
  return b;
}

function noise(ctx: BaseAudioContext, seconds = 2) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0);
  let s = 5;
  for (let i = 0; i < d.length; i++) d[i] = ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return b;
}

/** dry + wet, with "mix" setting the wet level (and keeping the dry at full). */
function wetDry(ctx: BaseAudioContext, wire: (input: AudioNode, wet: GainNode) => void, dry = true): Built & { wet: GainNode } {
  const input = ctx.createGain(), output = ctx.createGain(), wet = ctx.createGain();
  if (dry) input.connect(output);
  wet.connect(output);
  wire(input, wet);
  return { input, output, wet, apply: (p, a) => wet.gain.setValueAtTime(p.mix ?? 0.35, a) };
}

function lfo(ctx: BaseAudioContext, hz: number, depth: number, target: AudioParam, type: OscillatorType = "sine") {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = hz; g.gain.value = depth;
  o.connect(g).connect(target); o.start();
  return { o, g };
}

function shaper(ctx: BaseAudioContext, f: (x: number) => number) {
  const s = ctx.createWaveShaper(), n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = f((i / (n - 1)) * 2 - 1);
  s.curve = curve; s.oversample = "2x";
  return s;
}

/** Schedule a gain shape repeating every `period` seconds across [a, b]. */
function pattern(g: AudioParam, a: number, b: number, period: number, shape: (t0: number) => void) {
  const end = Math.min(b, a + 600);
  for (let t = a; t < end - 1e-4; t += period) shape(t);
}

export const FX: FxDef[] = [
  // ------------------------------------------------------------------ space
  { type: "echo", name: "Echo", group: "Space", icon: "M2 16h3M9 16h3M16 16h3M23 16h3M30 16h3 M2 4v12M9 7v9M16 10v6M23 12v4M30 14v2", blurb: "The sound comes back in time with the beat, quieter each time.",
    params: mix([{ key: "time", label: "Every", min: 1, max: 8, step: 1, def: 3, unit: "/16" }, { key: "feedback", label: "Repeats", min: 0, max: 0.85, step: 0.01, def: 0.45 }]),
    build: (ctx) => {
      let d!: DelayNode, fb!: GainNode;
      const w = wetDry(ctx, (input, wet) => {
        d = ctx.createDelay(4); fb = ctx.createGain(); fb.gain.value = 0; // no feedback until a clip sets it
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200; lp.Q.value = 0; // no peak: the loop must lose energy
        input.connect(d); d.connect(lp).connect(fb).connect(d); lp.connect(wet);
      });
      return { ...w, apply: (p, a, b, beat) => { w.apply(p, a, b, beat); d.delayTime.setValueAtTime(Math.min(3.9, (p.time * beat) / 4), a); fb.gain.setValueAtTime(Math.min(0.85, p.feedback), a); } };
    } },
  { type: "pingpong", name: "Ping-pong", group: "Space", icon: "M2 4h6M10 16h6M18 4h6M26 16h6 M5 4l8 12l8-12l8 12", blurb: "Echoes that bounce from left to right.",
    params: mix([{ key: "time", label: "Every", min: 1, max: 8, step: 1, def: 2, unit: "/16" }, { key: "feedback", label: "Repeats", min: 0, max: 0.85, step: 0.01, def: 0.5 }]),
    build: (ctx) => {
      let l!: DelayNode, r!: DelayNode, fb!: GainNode;
      const w = wetDry(ctx, (input, wet) => {
        l = ctx.createDelay(4); r = ctx.createDelay(4); fb = ctx.createGain(); fb.gain.value = 0;
        const merge = ctx.createChannelMerger(2), mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = "explicit";
        input.connect(mono).connect(l); l.connect(r); r.connect(fb).connect(l);
        l.connect(merge, 0, 0); r.connect(merge, 0, 1); merge.connect(wet);
      });
      return { ...w, apply: (p, a, b, beat) => { w.apply(p, a, b, beat); const t = Math.min(1.9, (p.time * beat) / 4); l.delayTime.setValueAtTime(t, a); r.delayTime.setValueAtTime(t, a); fb.gain.setValueAtTime(Math.min(0.85, p.feedback), a); } };
    } },
  { type: "dub", name: "Dub echo", group: "Space", icon: "M2 10c4-8 6 8 10 0s6 8 10 0s6 8 10 0", blurb: "A dark, long echo that feeds on itself, as in dub reggae.",
    params: mix([{ key: "feedback", label: "Repeats", min: 0.3, max: 0.9, step: 0.01, def: 0.68 }]),
    build: (ctx) => {
      let d!: DelayNode, fb!: GainNode;
      const w = wetDry(ctx, (input, wet) => {
        d = ctx.createDelay(4); fb = ctx.createGain(); fb.gain.value = 0;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 0.8;
        const sat = shaper(ctx, (x) => Math.tanh(1.5 * x));
        input.connect(d); d.connect(bp).connect(sat).connect(fb).connect(d); bp.connect(wet);
      });
      return { ...w, apply: (p, a, b, beat) => { w.apply(p, a, b, beat); d.delayTime.setValueAtTime(Math.min(3.9, beat * 0.75), a); fb.gain.setValueAtTime(Math.min(0.9, p.feedback), a); } };
    } },
  { type: "hall", name: "Hall", group: "Space", icon: "M2 18 Q8 2 16 10 T32 6", blurb: "A big room: the sound blooms and takes seconds to die away.",
    params: mix(), build: (ctx) => wetDry(ctx, (input, wet) => { const c = ctx.createConvolver(); c.buffer = room(ctx, 3.6, 21, 0.3); input.connect(c).connect(wet); }) },
  { type: "room", name: "Room", group: "Space", icon: "M4 18V8l12-6l12 6v10", blurb: "A small wooden room: close, warm, short.",
    params: mix(), build: (ctx) => wetDry(ctx, (input, wet) => { const c = ctx.createConvolver(); c.buffer = room(ctx, 0.8, 7, 0.55); input.connect(c).connect(wet); }) },
  { type: "wide", name: "Wide", group: "Space", icon: "M16 10L2 4M16 10L2 16M16 10L30 4M16 10L30 16", blurb: "Spreads the sound across left and right with a tiny delay on one side.",
    params: [{ key: "ms", label: "Spread", min: 5, max: 30, step: 1, def: 14, unit: "ms" }],
    build: (ctx) => {
      const input = ctx.createGain(), output = ctx.createGain(), split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2), d = ctx.createDelay(0.1);
      input.connect(split); split.connect(merge, 0, 0); split.connect(d, 1); d.connect(merge, 0, 1); merge.connect(output);
      return { input, output, apply: (p, a) => d.delayTime.setValueAtTime(p.ms / 1000, a) };
    } },
  // ------------------------------------------------------------------ tone
  { type: "lofi", name: "Lo-fi", group: "Tone", icon: "M2 16h4v-4h4v-4h4v4h4v4h4v-6h4v6h4", blurb: "Old tape: fewer levels, no highs, a slow wobble in the pitch.",
    params: [{ key: "bits", label: "Crunch", min: 3, max: 12, step: 1, def: 6 }, { key: "tone", label: "Tone", min: 1200, max: 6000, step: 50, def: 2800, unit: "Hz" }],
    build: (ctx) => {
      const input = ctx.createGain(), output = ctx.createGain(), wow = ctx.createDelay(0.05), lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; wow.delayTime.value = 0.008;
      lfo(ctx, 0.6, 0.0025, wow.delayTime);
      const crush = shaper(ctx, (x) => Math.round(x * 32) / 32);
      input.connect(wow).connect(crush).connect(lp).connect(output);
      return { input, output, apply: (p, a) => {
        const levels = 2 ** p.bits, n = 2048, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) curve[i] = Math.round(((i / (n - 1)) * 2 - 1) * levels) / levels;
        crush.curve = curve; // a curve can't be scheduled: it changes when the clip is reached
        lp.frequency.setValueAtTime(p.tone, a);
      } };
    } },
  { type: "phone", name: "Telephone", group: "Tone", icon: "M6 4c-4 4 4 16 12 12l3-3l-4-4l-2 2c-2-1-4-3-5-5l2-2l-4-4z", blurb: "Only the middle of the sound gets through, like a voice on a phone.",
    params: [], build: (ctx) => {
      const input = ctx.createGain(), output = ctx.createGain(), hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), pk = ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 450; lp.type = "lowpass"; lp.frequency.value = 2800; pk.type = "peaking"; pk.frequency.value = 1500; pk.gain.value = 6;
      const g = ctx.createGain(); g.gain.value = 1.6;
      input.connect(hp).connect(lp).connect(pk).connect(g).connect(output);
      return { input, output, apply: () => {} };
    } },
  { type: "drive", name: "Drive", group: "Tone", icon: "M2 16C8 16 8 4 16 4S24 16 32 16", blurb: "Pushes the sound into soft clipping: warmer, louder, a little dirty.",
    params: [{ key: "amount", label: "Drive", min: 1, max: 12, step: 0.1, def: 4 }],
    build: (ctx) => {
      const input = ctx.createGain(), output = ctx.createGain(), pre = ctx.createGain(), post = ctx.createGain();
      input.connect(pre).connect(shaper(ctx, (x) => Math.tanh(x))).connect(post).connect(output);
      return { input, output, apply: (p, a) => { pre.gain.setValueAtTime(p.amount, a); post.gain.setValueAtTime(1 / Math.tanh(p.amount) * 0.8, a); } };
    } },
  { type: "air", name: "Air", group: "Tone", icon: "M2 16h14c8 0 8-12 16-12", blurb: "Lifts the highest frequencies: brighter, more open.",
    params: [{ key: "gain", label: "Lift", min: 0, max: 12, step: 0.5, def: 7, unit: "dB" }],
    build: (ctx) => { const f = ctx.createBiquadFilter(); f.type = "highshelf"; f.frequency.value = 7000; return { input: f, output: f, apply: (p, a) => f.gain.setValueAtTime(p.gain, a) }; } },
  { type: "dark", name: "Dark", group: "Tone", icon: "M2 4h14c8 0 8 12 16 12", blurb: "Removes the highs, as if heard through a wall.",
    params: [{ key: "cutoff", label: "Cutoff", min: 200, max: 3000, step: 10, def: 800, unit: "Hz" }],
    build: (ctx) => { const f = ctx.createBiquadFilter(); f.type = "lowpass"; return { input: f, output: f, apply: (p, a) => f.frequency.setValueAtTime(p.cutoff, a) }; } },
  // ------------------------------------------------------------------ motion
  { type: "rise", name: "Filter rise", group: "Motion", icon: "M2 18C14 18 22 14 32 2", blurb: "Starts muffled and opens up over the clip: the classic build.",
    params: [{ key: "q", label: "Resonance", min: 0, max: 15, step: 0.5, def: 6 }],
    build: (ctx) => { const f = ctx.createBiquadFilter(); f.type = "lowpass"; return { input: f, output: f, apply: (p, a, b) => { f.Q.setValueAtTime(p.q, a); f.frequency.cancelScheduledValues(a); f.frequency.setValueAtTime(220, a); f.frequency.exponentialRampToValueAtTime(15000, Math.max(a + 0.05, Math.min(b, a + 120))); } }; } },
  { type: "fall", name: "Filter fall", group: "Motion", icon: "M2 2C12 14 20 18 32 18", blurb: "Starts bright and closes down over the clip: the sound sinks away.",
    params: [{ key: "q", label: "Resonance", min: 0, max: 15, step: 0.5, def: 4 }],
    build: (ctx) => { const f = ctx.createBiquadFilter(); f.type = "lowpass"; return { input: f, output: f, apply: (p, a, b) => { f.Q.setValueAtTime(p.q, a); f.frequency.cancelScheduledValues(a); f.frequency.setValueAtTime(15000, a); f.frequency.exponentialRampToValueAtTime(220, Math.max(a + 0.05, Math.min(b, a + 120))); } }; } },
  { type: "chorus", name: "Chorus", group: "Motion", icon: "M2 8c5-6 9 6 15 0s10 6 15 0M2 13c5-6 9 6 15 0s10 6 15 0", blurb: "Two slightly wavering copies: a thick, shimmering ensemble.",
    params: mix([{ key: "rate", label: "Speed", min: 0.1, max: 3, step: 0.05, def: 0.8, unit: "Hz" }]),
    build: (ctx) => {
      const lfos: OscillatorNode[] = [];
      const w = wetDry(ctx, (input, wet) => {
        for (const [ms, ph] of [[16, 0], [23, 0.5]]) {
          const d = ctx.createDelay(0.1); d.delayTime.value = ms / 1000;
          const l = lfo(ctx, 0.8 + ph, 0.003, d.delayTime); lfos.push(l.o);
          input.connect(d).connect(wet);
        }
      });
      return { ...w, apply: (p, a, b, beat) => { w.apply(p, a, b, beat); lfos.forEach((o, i) => o.frequency.setValueAtTime(p.rate * (1 + i * 0.27), a)); } };
    } },
  { type: "phaser", name: "Phaser", group: "Motion", icon: "M2 10c3-8 5 8 8 0s5 8 8 0s5 8 8 0s3 4 6 0", blurb: "A sweeping, hollow whoosh, as notches glide up and down the sound.",
    params: mix([{ key: "rate", label: "Speed", min: 0.05, max: 2, step: 0.05, def: 0.35, unit: "Hz" }]),
    build: (ctx) => {
      let l!: OscillatorNode;
      const w = wetDry(ctx, (input, wet) => {
        let node: AudioNode = input;
        const depth = ctx.createGain(); depth.gain.value = 900;
        l = ctx.createOscillator(); l.frequency.value = 0.35; l.connect(depth); l.start();
        for (let i = 0; i < 4; i++) { const ap = ctx.createBiquadFilter(); ap.type = "allpass"; ap.frequency.value = 1000; ap.Q.value = 0.7; depth.connect(ap.frequency); node.connect(ap); node = ap; }
        node.connect(wet);
      });
      return { ...w, apply: (p, a, b, beat) => { w.apply({ ...p, mix: Math.min(1, (p.mix ?? 0.5) * 1.5) }, a, b, beat); l.frequency.setValueAtTime(p.rate, a); } };
    } },
  { type: "tremolo", name: "Tremolo", group: "Motion", icon: "M2 10c2-6 4-6 6 0s4 6 6 0s4-6 6 0s4 6 6 0s4-6 6 0", blurb: "The volume throbs in time with the beat.",
    params: [{ key: "div", label: "Per beat", min: 1, max: 8, step: 1, def: 2 }, { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, def: 0.7 }],
    build: (ctx) => {
      const input = ctx.createGain(), output = ctx.createGain(), g = ctx.createGain();
      const l = lfo(ctx, 4, 0.35, g.gain);
      input.connect(g).connect(output);
      return { input, output, apply: (p, a, b, beat) => { l.o.frequency.setValueAtTime(p.div / beat, a); l.g.gain.setValueAtTime(p.depth / 2, a); g.gain.setValueAtTime(1 - p.depth / 2, a); } };
    } },
  { type: "autopan", name: "Auto-pan", group: "Motion", icon: "M2 10h4l6-6v12l-6-6M22 6c3 2 3 6 0 8M26 3c5 4 5 10 0 14", blurb: "The sound swings from left to right and back, in time.",
    params: [{ key: "beats", label: "Beats per swing", min: 0.5, max: 8, step: 0.5, def: 2 }],
    build: (ctx) => {
      const pan = ctx.createStereoPanner(), l = lfo(ctx, 0.5, 0.85, pan.pan);
      return { input: pan, output: pan, apply: (p, a, b, beat) => l.o.frequency.setValueAtTime(1 / (p.beats * beat), a) };
    } },
  // ------------------------------------------------------------------ rhythm
  { type: "pump", name: "Pump", group: "Rhythm", icon: "M2 4v12c4 0 6-12 8-12v12c4 0 6-12 8-12v12c4 0 6-12 8-12", blurb: "Ducks on every beat and swells back: the breathing of dance music.",
    params: [{ key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, def: 0.75 }],
    build: (ctx) => {
      const g = ctx.createGain();
      return { input: g, output: g, apply: (p, a, b, beat) => { g.gain.cancelScheduledValues(a); pattern(g.gain, a, b, beat, (t) => { g.gain.setValueAtTime(1 - p.depth, t); g.gain.linearRampToValueAtTime(1, t + beat * 0.7); }); } };
    } },
  { type: "gate", name: "Gate", group: "Rhythm", icon: "M2 16V4h5v12h3V4h5v12h3V4h5v12h3V4h4", blurb: "Chops the sound into sixteenths: a stuttering, rhythmic cut.",
    params: [{ key: "open", label: "Open", min: 0.15, max: 0.9, step: 0.05, def: 0.5 }],
    build: (ctx) => {
      const g = ctx.createGain();
      return { input: g, output: g, apply: (p, a, b, beat) => { const s = beat / 4; g.gain.cancelScheduledValues(a); pattern(g.gain, a, b, s, (t) => { g.gain.setValueAtTime(1, t); g.gain.setValueAtTime(0.02, t + s * p.open); }); g.gain.setValueAtTime(1, b); } };
    } },
  // ------------------------------------------------------------------ transitions
  { type: "fadein", name: "Fade in", group: "Transitions", icon: "M2 18L32 2V18Z", blurb: "Rises from silence over the clip.", params: [],
    build: (ctx) => { const g = ctx.createGain(); return { input: g, output: g, apply: (p, a, b) => { g.gain.cancelScheduledValues(a); g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(1, Math.min(b, a + 120)); } }; } },
  { type: "fadeout", name: "Fade out", group: "Transitions", icon: "M2 2V18H32Z", blurb: "Sinks to silence over the clip.", params: [],
    build: (ctx) => { const g = ctx.createGain(); return { input: g, output: g, apply: (p, a, b) => { g.gain.cancelScheduledValues(a); g.gain.setValueAtTime(1, a); g.gain.linearRampToValueAtTime(0.0001, Math.min(b, a + 120)); g.gain.setValueAtTime(1, b + 0.02); } }; } },
  { type: "tapestop", name: "Tape stop", group: "Transitions", icon: "M2 4h10C22 4 26 10 32 18", blurb: "At the end of the clip the music slows and drops in pitch, like a tape machine switched off.",
    params: [{ key: "beats", label: "Over", min: 0.5, max: 4, step: 0.5, def: 1.5, unit: "beats" }],
    build: (ctx) => {
      // A delay whose delay time grows ever faster plays its input slower and lower: pitch = 1 − d′(t).
      const input = ctx.createGain(), output = ctx.createGain(), d = ctx.createDelay(4), g = ctx.createGain();
      input.connect(d).connect(g).connect(output);
      return { input, output, apply: (p, a, b, beat) => {
        const T = Math.min(p.beats * beat, Math.max(0.05, b - a)), t0 = b - T, n = 64, curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * T; curve[i] = Math.min(3.9, (x * x) / (2 * T)); }
        d.delayTime.cancelScheduledValues(a); d.delayTime.setValueAtTime(0, a);
        g.gain.cancelScheduledValues(a); g.gain.setValueAtTime(1, a);
        if (t0 > a && isFinite(b)) { d.delayTime.setValueCurveAtTime(curve, t0, T); g.gain.setValueAtTime(1, t0); g.gain.linearRampToValueAtTime(0.0001, b); d.delayTime.setValueAtTime(0, b + 0.01); g.gain.setValueAtTime(1, b + 0.01); }
      } };
    } },
  { type: "riser", name: "Riser", group: "Transitions", icon: "M2 18L32 2M8 18L32 6M14 18L32 10", blurb: "A rush of noise that climbs into the next section.",
    params: [{ key: "beats", label: "Length", min: 1, max: 16, step: 1, def: 4, unit: "beats" }, { key: "level", label: "Level", min: 0, max: 1, step: 0.01, def: 0.4 }],
    build: (ctx) => {
      const input = ctx.createGain(), output = ctx.createGain(), buf = noise(ctx, 2);
      input.connect(output);
      return { input, output, apply: (p, a, b, beat) => {
        if (!isFinite(b)) return;
        const T = Math.min(p.beats * beat, b - a), t0 = b - T;
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(9000, b);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(p.level * 0.5 + 0.0001, b); g.gain.setTargetAtTime(0, b, 0.05);
        src.connect(bp).connect(g).connect(output); src.start(Math.max(ctx.currentTime, t0)); src.stop(b + 0.4);
      } };
    } },
  // ------------------------------------------------------------------ notes
  { type: "octave", name: "Octave up", group: "Notes", icon: "M4 16h10M4 16V4M18 8h10M18 8v8", blurb: "Doubles every note an octave higher, softer.",
    params: [{ key: "level", label: "Level", min: 0.1, max: 1, step: 0.05, def: 0.55 }],
    notes: (ns, p) => [...ns, ...ns.map((n) => ({ ...n, id: n.id + "o", s: n.s + 12, v: n.v * p.level }))] },
  { type: "stutter", name: "Stutter", group: "Notes", icon: "M3 16V6M8 16V8M13 16V10M18 16V12M23 16V13M28 16V14", blurb: "Each note repeats in quick fading taps.",
    params: [{ key: "rate", label: "Taps per beat", min: 2, max: 8, step: 1, def: 4 }],
    notes: (ns, p) => ns.flatMap((n) => { const step = 1 / p.rate, k = Math.max(1, Math.round(n.d / step)); return Array.from({ length: k }, (_, i) => ({ ...n, id: `${n.id}s${i}`, t: n.t + i * step, d: step * 0.8, v: n.v * Math.pow(0.82, i) })); }) },
  { type: "humanize", name: "Humanize", group: "Notes", icon: "M2 12c3 0 3-4 6-4s3 6 6 6s3-8 6-8s3 5 6 5s3-2 4-2", blurb: "Loosens the timing and touch slightly, as a player would.",
    params: [{ key: "amount", label: "Looseness", min: 0, max: 1, step: 0.05, def: 0.5 }],
    notes: (ns, p) => ns.map((n, i) => { const r = Math.sin(i * 12.9898 + n.t * 78.233) * 43758.5453, u = r - Math.floor(r); return { ...n, t: Math.max(0, n.t + (u - 0.5) * 0.06 * p.amount), v: n.v * (1 - 0.3 * p.amount * ((u * 7) % 1)) }; }) },
];

export const FX_BY = Object.fromEntries(FX.map((f) => [f.type, f])) as Record<string, FxDef>;
export const defaults = (type: string) => Object.fromEntries((FX_BY[type]?.params ?? []).map((p) => [p.key, p.def]));
export const GROUPS = ["Space", "Tone", "Motion", "Rhythm", "Transitions", "Notes"] as const;
