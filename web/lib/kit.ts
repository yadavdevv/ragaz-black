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
