// The studio's instruments, made the way synthesizers and drum machines make them. No samples:
//   strings   Karplus–Strong: a burst of noise in a delay line the length of one period, averaged
//             each pass (a plucked string). Sitar adds a jawari buzz (the bridge's soft clipping)
//             and a sympathetic shimmer; santoor is brighter and shorter.
//   keys      FM electric piano: a sine carrier whose frequency is pushed by a second sine; a bright
//             attack that mellows (the bark and the tine of a tine piano). Supersaw: detuned saws.
//   drums     kick = click + pitch-dropping body + sub tail; snare = two tones + filtered noise; hats =
//             six detuned square waves through high filters (the 808 recipe); clap = three quick
//             bursts; shaker; rimshot; log drum = a pitched, dropping knock (amapiano's bass drum).
// Every function schedules on any BaseAudioContext at time `at`, into `out`, at velocity `v` (0..1).

type Keep = <S extends AudioScheduledSourceNode>(s: S) => S;

const cache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
function cached(ctx: BaseAudioContext, key: string, make: () => AudioBuffer) {
  let m = cache.get(ctx);
  if (!m) cache.set(ctx, (m = new Map()));
  let b = m.get(key);
  if (!b) m.set(key, (b = make()));
  return b;
}

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** A plucked string by Karplus–Strong, rendered to a buffer (cached per pitch and kind). */
export function stringBuffer(ctx: BaseAudioContext, hz: number, kind: "sitar" | "santoor", seconds = 2.2) {
  return cached(ctx, `${kind}-${hz.toFixed(1)}`, () => {
    const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(1, n, sr);
    const out = buf.getChannelData(0);
    // The averaging filter delays half a sample; a first-order allpass supplies the rest of the
    // fractional delay, so the string is in tune (an integer-length line alone runs flat).
    const delay = sr / hz - 0.5, N = Math.max(2, Math.floor(delay)), f = delay - N, c = (1 - f) / (1 + f);
    const line = new Float32Array(N);
    const r = rng(Math.round(hz * 100));
    // The pluck: noise, softened for sitar (a mizrab on a thick string), bright for santoor.
    let lp = 0;
    for (let i = 0; i < N; i++) { lp += (kind === "sitar" ? 0.5 : 0.85) * (r() * 2 - 1 - lp); line[i] = lp; }
    const decay = kind === "sitar" ? 0.9985 : 0.996; // per-pass loss: sitar rings longer
    const blend = kind === "sitar" ? 0.5 : 0.45;
    let idx = 0, apX = 0, apY = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      const a = line[idx];
      const avg = (blend * a + (1 - blend) * prev) * decay; // y[n] = avg of the last two outputs
      prev = a;
      const ap = c * avg + apX - c * apY;
      apX = avg; apY = ap;
      line[idx] = ap;
      out[i] = a;
      idx = (idx + 1) % N;
    }
    if (kind === "sitar") {
      // Jawari: the curved bridge makes the string buzz, a soft asymmetric clip; plus a faint
      // sympathetic shimmer an octave and a fifth up that blooms after the pluck.
      for (let i = 0; i < n; i++) {
        const x = out[i] * 1.8, t = i / sr;
        out[i] = 0.7 * Math.tanh(x + 0.25 * x * x) + 0.08 * Math.sin(2 * Math.PI * hz * 3 * t) * (1 - Math.exp(-t / 0.08)) * Math.exp(-t / 0.7);
      }
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
    for (let i = 0; i < n; i++) out[i] /= peak || 1;
    return buf;
  });
}

export function pluck(ctx: BaseAudioContext, out: AudioNode, at: number, hz: number, v: number, kind: "sitar" | "santoor", keep: Keep) {
  const s = keep(ctx.createBufferSource());
  s.buffer = stringBuffer(ctx, hz, kind);
  const g = ctx.createGain(); g.gain.value = 0.35 * v;
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = kind === "sitar" ? 4200 : 6500;
  s.connect(tone).connect(g).connect(out);
  s.start(at); s.stop(at + 2.3);
}

/** FM electric piano: carrier + modulator at the same pitch (the bark) + a high tine. */
export function epiano(ctx: BaseAudioContext, out: AudioNode, at: number, hz: number, dur: number, v: number, keep: Keep) {
  const car = keep(ctx.createOscillator()); car.frequency.value = hz;
  const mod = keep(ctx.createOscillator()); mod.frequency.value = hz;
  const tine = keep(ctx.createOscillator()); tine.frequency.value = hz * 14;
  const idx = ctx.createGain(), tidx = ctx.createGain();
  // The index (how hard the modulator pushes) decays: bright attack, mellow body.
  idx.gain.setValueAtTime(hz * 2.2 * v, at); idx.gain.exponentialRampToValueAtTime(hz * 0.35, at + 0.5);
  tidx.gain.setValueAtTime(hz * 1.2 * v, at); tidx.gain.exponentialRampToValueAtTime(1, at + 0.08);
  mod.connect(idx).connect(car.frequency);
  tine.connect(tidx).connect(car.frequency);
  const amp = ctx.createGain();
  const len = Math.max(0.3, dur);
  amp.gain.setValueAtTime(0, at); amp.gain.linearRampToValueAtTime(0.22 * v, at + 0.004);
  amp.gain.setTargetAtTime(0.13 * v, at + 0.05, 0.4);
  amp.gain.setTargetAtTime(0, at + len, 0.18);
  const warm = ctx.createBiquadFilter(); warm.type = "lowpass"; warm.frequency.value = 2800;
  car.connect(amp).connect(warm).connect(out);
  for (const o of [car, mod, tine]) { o.start(at); o.stop(at + len + 1); }
}

/** Supersaw: seven detuned saws, a filter that opens and settles. */
export function supersaw(ctx: BaseAudioContext, out: AudioNode, at: number, hz: number, dur: number, v: number, keep: Keep, cutoff = 2400) {
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(cutoff * 0.35, at); lp.frequency.linearRampToValueAtTime(cutoff, at + 0.08); lp.frequency.setTargetAtTime(cutoff * 0.6, at + 0.1, 0.3);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at); amp.gain.linearRampToValueAtTime(0.06 * v, at + 0.02); amp.gain.setTargetAtTime(0, at + dur, 0.15);
  lp.connect(amp).connect(out);
  for (const d of [-22, -14, -6, 0, 6, 14, 22]) {
    const o = keep(ctx.createOscillator()); o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = d;
    o.connect(lp); o.start(at); o.stop(at + dur + 1);
  }
}

// ------------------------------------------------------------------------------------------ drums

export function kick(ctx: BaseAudioContext, out: AudioNode, at: number, v: number, keep: Keep, noise: AudioBuffer, punch = 1) {
  const body = keep(ctx.createOscillator());
  body.frequency.setValueAtTime(165, at); body.frequency.exponentialRampToValueAtTime(52, at + 0.07); body.frequency.exponentialRampToValueAtTime(45, at + 0.4);
  const be = ctx.createGain();
  be.gain.setValueAtTime(0, at); be.gain.linearRampToValueAtTime(0.95 * v, at + 0.003); be.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
  body.connect(be).connect(out); body.start(at); body.stop(at + 0.5);
  const click = keep(ctx.createBufferSource()); click.buffer = noise;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
  const ce = ctx.createGain(); ce.gain.setValueAtTime(0.3 * v * punch, at); ce.gain.exponentialRampToValueAtTime(0.001, at + 0.012);
  click.connect(hp).connect(ce).connect(out); click.start(at, (at * 0.17) % 1.5); click.stop(at + 0.02);
}

export function snare(ctx: BaseAudioContext, out: AudioNode, at: number, v: number, keep: Keep, noise: AudioBuffer, room?: AudioNode) {
  for (const [hz, g] of [[185, 1.4], [330, 0.7]] as const) {
    const o = keep(ctx.createOscillator()); o.type = "triangle"; o.frequency.setValueAtTime(hz * 1.3, at); o.frequency.exponentialRampToValueAtTime(hz, at + 0.03);
    const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(g * v, at + 0.002); e.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
    o.connect(e).connect(out); o.start(at); o.stop(at + 0.15);
  }
  const n = keep(ctx.createBufferSource()); n.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3500; bp.Q.value = 0.7;
  const ne = ctx.createGain(); ne.gain.setValueAtTime(0, at); ne.gain.linearRampToValueAtTime(1.6 * v, at + 0.002); ne.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
  n.connect(bp).connect(ne).connect(out);
  if (room) ne.connect(room);
  n.start(at, (at * 0.31) % 1.5); n.stop(at + 0.25);
}

export function clap(ctx: BaseAudioContext, out: AudioNode, at: number, v: number, keep: Keep, noise: AudioBuffer, room?: AudioNode) {
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 0.9;
  bp.connect(out);
  if (room) bp.connect(room);
  for (const [off, a, len] of [[0, 0.6, 0.01], [0.011, 0.8, 0.01], [0.022, 1, 0.16]] as const) {
    const s = keep(ctx.createBufferSource()); s.buffer = noise;
    const e = ctx.createGain(); e.gain.setValueAtTime(0, at + off); e.gain.linearRampToValueAtTime(a * v * 2.4, at + off + 0.002); e.gain.exponentialRampToValueAtTime(0.001, at + off + len);
    s.connect(e).connect(bp); s.start(at + off, ((at + off) * 0.29) % 1.5); s.stop(at + off + 0.2);
  }
}

/** The 808 hat: six detuned square waves, band-passed high; closed is short, open rings. */
export function hat(ctx: BaseAudioContext, out: AudioNode, at: number, v: number, keep: Keep, open = false) {
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 10000; bp.Q.value = 0.8;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
  const e = ctx.createGain(); const len = open ? 0.28 : 0.045;
  e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.22 * v, at + 0.001); e.gain.exponentialRampToValueAtTime(0.001, at + len);
  bp.connect(hp).connect(e).connect(out);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = keep(ctx.createOscillator()); o.type = "square"; o.frequency.value = f * 1.6;
    o.connect(bp); o.start(at); o.stop(at + len + 0.05);
  }
}

export function shaker(ctx: BaseAudioContext, out: AudioNode, at: number, v: number, keep: Keep, noise: AudioBuffer) {
  const s = keep(ctx.createBufferSource()); s.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 6500; bp.Q.value = 1.4;
  const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.24 * v, at + 0.012); e.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
  s.connect(bp).connect(e).connect(out); s.start(at, (at * 0.53) % 1.5); s.stop(at + 0.09);
}

export function rim(ctx: BaseAudioContext, out: AudioNode, at: number, v: number, keep: Keep) {
  const o = keep(ctx.createOscillator()); o.type = "triangle"; o.frequency.value = 1700;
  const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.22 * v, at + 0.001); e.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
  const o2 = keep(ctx.createOscillator()); o2.type = "square"; o2.frequency.value = 480;
  const e2 = ctx.createGain(); e2.gain.setValueAtTime(0, at); e2.gain.linearRampToValueAtTime(0.06 * v, at + 0.001); e2.gain.exponentialRampToValueAtTime(0.001, at + 0.02);
  o.connect(e).connect(out); o2.connect(e2).connect(out);
  for (const x of [o, o2]) { x.start(at); x.stop(at + 0.05); }
}

/** Amapiano's log drum: a pitched knock that drops into its note, a little driven. */
export function logDrum(ctx: BaseAudioContext, out: AudioNode, at: number, hz: number, v: number, keep: Keep, len = 0.35) {
  const o = keep(ctx.createOscillator());
  o.frequency.setValueAtTime(hz * 2.4, at); o.frequency.exponentialRampToValueAtTime(hz, at + 0.035);
  const mod = keep(ctx.createOscillator()); mod.frequency.value = hz * 1.5;
  const mi = ctx.createGain(); mi.gain.setValueAtTime(hz * 1.2, at); mi.gain.exponentialRampToValueAtTime(1, at + 0.08);
  mod.connect(mi).connect(o.frequency);
  const e = ctx.createGain(); e.gain.setValueAtTime(0, at); e.gain.linearRampToValueAtTime(0.75 * v, at + 0.004); e.gain.exponentialRampToValueAtTime(0.001, at + len);
  const ws = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(2.2 * x); }
  ws.curve = curve;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
  o.connect(e).connect(ws).connect(lp).connect(out);
  for (const x of [o, mod]) { x.start(at); x.stop(at + len + 0.05); }
}

// ------------------------------------------------------------------------------------------ held voices
// Instruments that sound for as long as they are held (a breath, a bow): each returns release(t).
//   bansuri   a flute: a nearly pure tone (harmonics 1–3), breath noise around its second harmonic,
//             a chiff of air at the start, and a vibrato that only arrives once the note has settled.
//   sarangi   a bowed fiddle: a sawtooth (a bowed string's shape) through three vowel-like formant
//             resonances, which is what makes it sound like a voice; a slide up into the note.
//   shehnai   a double reed: harmonics 4–8 lifted (the nasal buzz), a bright formant, a wide vibrato.

export type Release = (at?: number) => void;

function wave(ctx: BaseAudioContext, amps: number[]) {
  const real = new Float32Array(amps.length + 1), imag = new Float32Array(amps.length + 1);
  amps.forEach((a, i) => (imag[i + 1] = a));
  return ctx.createPeriodicWave(real, imag);
}

function vibrato(ctx: BaseAudioContext, at: number, rate: number, cents: number, delay: number, keep: Keep, targets: AudioParam[]) {
  const lfo = keep(ctx.createOscillator()); lfo.frequency.value = rate;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, at); depth.gain.linearRampToValueAtTime(cents, at + delay + 0.3);
  lfo.connect(depth);
  for (const t of targets) depth.connect(t);
  lfo.start(at);
  return lfo;
}

function breath(ctx: BaseAudioContext, noise: AudioBuffer, at: number, hz: number, q: number, keep: Keep) {
  const n = keep(ctx.createBufferSource()); n.buffer = noise; n.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = hz; bp.Q.value = q;
  n.connect(bp); n.start(at, (at * 0.37) % 1.5);
  return { src: n, out: bp };
}

export function bansuri(ctx: BaseAudioContext, out: AudioNode, at: number, hz: number, v: number, keep: Keep, noise: AudioBuffer): Release {
  const o = keep(ctx.createOscillator()); o.setPeriodicWave(wave(ctx, [1, 0.18, 0.06])); o.frequency.value = hz;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(0.32 * v, at + 0.09);
  o.connect(env).connect(out);
  const air = breath(ctx, noise, at, hz * 2, 3, keep);
  const ae = ctx.createGain(); ae.gain.setValueAtTime(0.5 * v, at); ae.gain.exponentialRampToValueAtTime(0.06 * v, at + 0.12);
  air.out.connect(ae).connect(out);
  const lfo = vibrato(ctx, at, 5, 14, 0.35, keep, [o.detune]);
  o.start(at);
  return (t = ctx.currentTime) => {
    const end = Math.max(t, at + 0.1);
    for (const g of [env.gain, ae.gain]) { g.cancelScheduledValues(end); g.setTargetAtTime(0, end, 0.06); }
    for (const s of [o, air.src, lfo]) s.stop(end + 0.5);
  };
}

export function sarangi(ctx: BaseAudioContext, out: AudioNode, at: number, hz: number, v: number, keep: Keep, noise: AudioBuffer): Release {
  const o = keep(ctx.createOscillator()); o.type = "sawtooth"; o.frequency.value = hz;
  o.detune.setValueAtTime(-60, at); o.detune.setTargetAtTime(0, at, 0.06); // the slide up into the note
  const body = ctx.createGain(); body.gain.value = 0.25;
  for (const [f, q, g] of [[650, 4, 1], [1150, 5, 0.7], [2700, 6, 0.35]] as const) {
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
    const gg = ctx.createGain(); gg.gain.value = g;
    o.connect(bp).connect(gg).connect(body);
  }
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4500;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(1.3 * v, at + 0.16);
  body.connect(lp).connect(env).connect(out);
  const bow = breath(ctx, noise, at, 3000, 0.8, keep);
  const be = ctx.createGain(); be.gain.value = 0.025 * v;
  bow.out.connect(be).connect(env);
  const lfo = vibrato(ctx, at, 6, 16, 0.25, keep, [o.detune]);
  o.start(at);
  return (t = ctx.currentTime) => {
    const end = Math.max(t, at + 0.12);
    env.gain.cancelScheduledValues(end); env.gain.setTargetAtTime(0, end, 0.09);
    for (const s of [o, bow.src, lfo]) s.stop(end + 0.6);
  };
}

export function shehnai(ctx: BaseAudioContext, out: AudioNode, at: number, hz: number, v: number, keep: Keep): Release {
  const o = keep(ctx.createOscillator());
  o.setPeriodicWave(wave(ctx, [0.6, 0.45, 0.5, 0.8, 0.85, 0.8, 0.6, 0.5, 0.25, 0.15, 0.1]));
  o.frequency.value = hz;
  o.detune.setValueAtTime(-35, at); o.detune.setTargetAtTime(0, at, 0.04);
  const nose = ctx.createBiquadFilter(); nose.type = "peaking"; nose.frequency.value = 1500; nose.Q.value = 1.2; nose.gain.value = 7;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 280;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(0.16 * v, at + 0.05);
  o.connect(nose).connect(hp).connect(lp).connect(env).connect(out);
  const lfo = vibrato(ctx, at, 5.5, 22, 0.2, keep, [o.detune]);
  o.start(at);
  return (t = ctx.currentTime) => {
    const end = Math.max(t, at + 0.08);
    env.gain.cancelScheduledValues(end); env.gain.setTargetAtTime(0, end, 0.05);
    for (const s of [o, lfo]) s.stop(end + 0.4);
  };
}
