// The studio's sound: a project played live (scheduled a little ahead of the playhead, so edits
// are heard within a fraction of a second) or rendered offline to a WAV. Each track is a chain:
//   instrument → effect slots → (a synth's own echo and room) → volume → pan → meter → master
// An effect on a clip is a slot on its track that is switched in only while the clip plays.

import { bansuri, clap, epiano, hat, kick, logDrum, pluck, rim, sarangi, shaker, shehnai, snare, supersaw } from "../kit";
import { RATIOS } from "../music";
import { encodeWav } from "../studio";
import { periodicWave } from "../waves";
import { FX_BY, type Built } from "./fx";
import type { Clip, NoteEv, Project, Track } from "./model";
import { projectEnd, secPerBeat } from "./model";

type Keep = <S extends AudioScheduledSourceNode>(s: S) => S;
const keep: Keep = (s) => s;

export type Ev = { beat: number; dur: number; s: number; v: number; track: string };
export type Act = { track: string; type: string; params: Record<string, number>; a: number; b: number };

/** Semitones above Sa → Hz, just-intoned like the rest of the site. */
export const hzOf = (s: number, sa: number) => sa * RATIOS[((s % 12) + 12) % 12] * 2 ** Math.floor(s / 12);

const audible = (p: Project) => {
  const solo = p.tracks.some((t) => t.solo);
  return p.tracks.filter((t) => !t.mute && (!solo || t.solo));
};

/** A clip's notes as played: note effects applied, cut at the clip's end. */
export function played(c: Clip): NoteEv[] {
  let ns = c.notes;
  for (const f of c.fx) if (FX_BY[f.type]?.notes) ns = FX_BY[f.type].notes!(ns, f.params);
  return ns.filter((n) => n.t < c.len - 1e-6).map((n) => ({ ...n, d: Math.min(n.d, c.len - n.t) }));
}

/** Every note and every clip-effect window in the project, in time order. */
export function timeline(p: Project) {
  const evs: Ev[] = [], acts: Act[] = [];
  for (const t of audible(p)) {
    for (const c of t.clips) {
      for (const n of played(c)) evs.push({ beat: c.start + n.t, dur: n.d, s: n.s, v: n.v, track: t.id });
      for (const f of c.fx) if (FX_BY[f.type]?.build) acts.push({ track: t.id, type: f.type, params: f.params, a: c.start, b: c.start + c.len });
    }
  }
  evs.sort((x, y) => x.beat - y.beat);
  acts.sort((x, y) => x.a - y.a);
  return { evs, acts };
}

// ------------------------------------------------------------------------------------- instruments

const LEVEL: Record<Track["inst"], number> = { synth: 1, sitar: 1.3, santoor: 1.1, bansuri: 1.1, shehnai: 1.1, sarangi: 0.75, epiano: 1.7, supersaw: 2.4, drums: 1 };

const noises = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseOf(ctx: BaseAudioContext) {
  let b = noises.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 9;
    for (let i = 0; i < d.length; i++) d[i] = ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
    noises.set(ctx, b);
  }
  return b;
}

const waves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
function waveOf(ctx: BaseAudioContext, t: Track) {
  let m = waves.get(ctx);
  if (!m) waves.set(ctx, (m = new Map()));
  const key = JSON.stringify([t.patch!.amp, t.patch!.phase]);
  let w = m.get(key);
  if (!w) m.set(key, (w = periodicWave(ctx, t.patch!)));
  return w;
}

/** A designed synth's note: its wave (unison), a low-pass that can sweep, the envelope, vibrato. */
function synthNote(ctx: BaseAudioContext, out: AudioNode, t: Track, at: number, hz: number, dur: number, v: number) {
  const p = t.patch!, { a, d, s, r } = p.env;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = p.filter.q;
  const cut = Math.min(18000, p.filter.cutoff), open = Math.min(18000, cut * (1 + 12 * p.filter.sweep));
  lp.frequency.setValueAtTime(p.filter.sweep ? open : cut, at);
  if (p.filter.sweep) lp.frequency.setTargetAtTime(cut, at + a, Math.max(0.02, d / 3));
  const vca = ctx.createGain(), level = (0.32 * v) / Math.sqrt(p.voices);
  vca.gain.setValueAtTime(0, at);
  vca.gain.linearRampToValueAtTime(level, at + Math.max(0.003, a));
  vca.gain.setTargetAtTime(level * s, at + Math.max(0.003, a), Math.max(0.01, d / 3));
  const off = at + Math.max(dur, 0.02);
  vca.gain.setTargetAtTime(0, off, Math.max(0.01, r / 4));
  const end = off + r * 1.6 + 0.05;
  let trem: GainNode | null = null;
  if (p.trem.depth > 0) {
    trem = ctx.createGain(); trem.gain.value = 1 - p.trem.depth / 2;
    const l = keep(ctx.createOscillator()), g = ctx.createGain(); l.frequency.value = p.trem.rate; g.gain.value = p.trem.depth / 2;
    l.connect(g).connect(trem.gain); l.start(at); l.stop(end);
  }
  lp.connect(vca);
  (trem ? vca.connect(trem) : vca).connect(out);
  let vib: GainNode | null = null;
  if (p.vib.depth > 0) {
    const l = keep(ctx.createOscillator()); vib = ctx.createGain(); l.frequency.value = p.vib.rate;
    vib.gain.setValueAtTime(0, at); vib.gain.linearRampToValueAtTime(p.vib.depth, at + 0.25);
    l.connect(vib); l.start(at); l.stop(end);
  }
  const wave = waveOf(ctx, t);
  for (let k = 0; k < p.voices; k++) {
    const o = keep(ctx.createOscillator());
    o.setPeriodicWave(wave); o.frequency.value = hz;
    o.detune.value = p.voices > 1 ? p.spread * (k / (p.voices - 1) - 0.5) : 0;
    if (vib) vib.connect(o.detune);
    o.connect(lp); o.start(at); o.stop(end);
  }
}

const DRUM_PLAY: ((ctx: BaseAudioContext, out: AudioNode, at: number, v: number, sa: number) => void)[] = [
  (ctx, out, at, v) => kick(ctx, out, at, v, keep, noiseOf(ctx)),
  (ctx, out, at, v) => snare(ctx, out, at, 0.6 * v, keep, noiseOf(ctx)),
  (ctx, out, at, v) => clap(ctx, out, at, 0.7 * v, keep, noiseOf(ctx)),
  (ctx, out, at, v) => hat(ctx, out, at, 1.5 * v, keep),
  (ctx, out, at, v) => hat(ctx, out, at, 1.3 * v, keep, true),
  (ctx, out, at, v) => shaker(ctx, out, at, v, keep, noiseOf(ctx)),
  (ctx, out, at, v) => rim(ctx, out, at, v, keep),
  (ctx, out, at, v, sa) => logDrum(ctx, out, at, sa / 2, v, keep),
];

export function playNote(ctx: BaseAudioContext, out: AudioNode, t: Track, at: number, s: number, dur: number, v: number, sa: number) {
  if (t.inst === "drums") return DRUM_PLAY[s]?.(ctx, out, at, v, sa);
  const hz = hzOf(s, sa);
  switch (t.inst) {
    case "synth": return synthNote(ctx, out, t, at, hz, dur, v);
    case "sitar": return pluck(ctx, out, at, hz / 2, v, "sitar", keep);
    case "santoor": return pluck(ctx, out, at, hz, v, "santoor", keep);
    case "epiano": return epiano(ctx, out, at, hz, dur, v, keep);
    case "supersaw": return supersaw(ctx, out, at, hz, dur, v, keep);
    case "bansuri": return bansuri(ctx, out, at, hz * 2, v, keep, noiseOf(ctx))(at + dur);
    case "shehnai": return shehnai(ctx, out, at, hz * 1.0, v, keep)(at + dur);
    case "sarangi": return sarangi(ctx, out, at, hz, v, keep, noiseOf(ctx))(at + dur);
  }
}

// ------------------------------------------------------------------------------------- chains

type Slot = { built: Built; wet: GainNode; dry: GainNode };
type Chain = { input: GainNode; slots: Map<string, Slot>; always: string[]; vol: GainNode; pan: StereoPannerNode; meter: AnalyserNode; nodes: AudioNode[] };

function slotOf(ctx: BaseAudioContext, type: string): Slot | null {
  const def = FX_BY[type];
  if (!def?.build) return null;
  const built = def.build(ctx), wet = ctx.createGain(), dry = ctx.createGain();
  wet.gain.value = 0; dry.gain.value = 1;
  return { built, wet, dry };
}

/** A synth's own echo and room (from its sound design), as sends after the effects. */
function patchSpace(ctx: BaseAudioContext, t: Track, from: AudioNode, to: AudioNode, spb: number) {
  const p = t.patch;
  if (!p || t.inst !== "synth") return;
  if (p.echo.mix > 0) {
    const d = ctx.createDelay(4), fb = ctx.createGain(), send = ctx.createGain(), lp = ctx.createBiquadFilter();
    d.delayTime.value = Math.min(3.9, (p.echo.steps * spb) / 2); fb.gain.value = Math.min(0.85, p.echo.feedback); send.gain.value = p.echo.mix; lp.type = "lowpass"; lp.frequency.value = 3800;
    from.connect(send).connect(d).connect(lp).connect(fb).connect(d); lp.connect(to);
  }
  if (p.reverb > 0) {
    const c = ctx.createConvolver(), send = ctx.createGain();
    const n = Math.ceil(2.4 * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const dd = b.getChannelData(ch); let s = 11 + ch * 7, lp = 0; for (let i = 0; i < n; i++) { const w = ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1; lp += 0.45 * (w - lp); dd[i] = lp * Math.exp((-5 * i) / n); } }
    c.buffer = b; send.gain.value = p.reverb * 0.8;
    from.connect(send).connect(c).connect(to);
  }
}

export class Engine {
  ctx: BaseAudioContext;
  master: GainNode;
  analyser: AnalyserNode;
  chains = new Map<string, Chain>();
  private shape = "";

  constructor(ctx: BaseAudioContext, dest: AudioNode = ctx.destination) {
    this.ctx = ctx;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -14; glue.ratio.value = 2.5; glue.attack.value = 0.01; glue.release.value = 0.25;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3; limit.ratio.value = 20; limit.attack.value = 0.002; limit.release.value = 0.1;
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 4096; this.analyser.smoothingTimeConstant = 0.6;
    this.bus = ctx.createGain();
    this.bus.connect(glue).connect(limit).connect(this.master).connect(this.analyser).connect(dest);
  }
  bus: GainNode;

  /** The chains' structure (tracks, instruments, effect types): when it changes, they are rebuilt. */
  static shapeOf(p: Project) {
    return JSON.stringify(p.tracks.map((t) => [t.id, t.inst, t.patch?.echo, t.patch?.reverb, t.fx.map((f) => f.type), [...new Set(t.clips.flatMap((c) => c.fx.map((f) => f.type)))].sort()]));
  }

  build(p: Project) {
    for (const c of this.chains.values()) for (const n of c.nodes) { try { n.disconnect(); } catch {} }
    this.chains.clear();
    const ctx = this.ctx, spb = secPerBeat(p);
    for (const t of p.tracks) {
      const input = ctx.createGain(), vol = ctx.createGain(), pan = ctx.createStereoPanner(), meter = ctx.createAnalyser();
      input.gain.value = LEVEL[t.inst]; meter.fftSize = 1024;
      const slots = new Map<string, Slot>(), nodes: AudioNode[] = [input, vol, pan, meter];
      let node: AudioNode = input;
      const types = [...t.fx.map((f) => f.type), ...new Set(t.clips.flatMap((c) => c.fx.map((f) => f.type)))].filter((x, i, a) => a.indexOf(x) === i);
      for (const type of types) {
        const slot = slotOf(ctx, type);
        if (!slot) continue;
        const join = ctx.createGain();
        node.connect(slot.dry).connect(join);
        node.connect(slot.built.input); slot.built.output.connect(slot.wet).connect(join);
        nodes.push(slot.dry, slot.wet, join, slot.built.output, slot.built.input);
        slots.set(type, slot);
        node = join;
      }
      const post = ctx.createGain();
      node.connect(post); nodes.push(post);
      patchSpace(ctx, t, post, vol, spb);
      post.connect(vol).connect(pan).connect(meter).connect(this.bus);
      this.chains.set(t.id, { input, slots, always: t.fx.map((f) => f.type), vol, pan, meter, nodes });
    }
    this.mix(p, true);
    this.shape = Engine.shapeOf(p);
  }

  needsBuild(p: Project) { return Engine.shapeOf(p) !== this.shape; }

  /** Forget the chains (they are being torn down): the next play builds afresh. */
  reset() { this.chains.clear(); this.shape = ""; }

  /** Volume and pan, changed at once without rebuilding. */
  mix(p: Project, now = false) {
    const t0 = this.ctx.currentTime;
    for (const t of p.tracks) {
      const c = this.chains.get(t.id);
      if (!c) continue;
      const v = t.volume * t.volume; // the fader is in loudness, roughly: square it
      if (now) { c.vol.gain.value = v; c.pan.pan.value = t.pan; } else { c.vol.gain.setTargetAtTime(v, t0, 0.02); c.pan.pan.setTargetAtTime(t.pan, t0, 0.02); }
    }
  }

  /** Switch an effect slot in over [a, b] (seconds), with its parameters. */
  activate(track: string, type: string, params: Record<string, number>, a: number, b: number, spb: number) {
    const s = this.chains.get(track)?.slots.get(type);
    if (!s) return;
    s.built.apply(params, a, b, spb);
    s.wet.gain.setTargetAtTime(1, a, 0.004); s.dry.gain.setTargetAtTime(0, a, 0.004);
    if (isFinite(b)) { s.wet.gain.setTargetAtTime(0, b, 0.004); s.dry.gain.setTargetAtTime(1, b, 0.004); }
  }

  /** The always-on (track) effects from time a. */
  trackFx(p: Project, a: number) {
    for (const t of p.tracks) for (const f of t.fx) this.activate(t.id, f.type, f.params, a, Infinity, secPerBeat(p));
  }

  note(p: Project, e: Ev, at: number) {
    const t = p.tracks.find((x) => x.id === e.track), c = this.chains.get(e.track);
    if (t && c) playNote(this.ctx, c.input, t, at, e.s, e.dur * secPerBeat(p), e.v, p.sa);
  }

  /** One note right now, for auditioning in the editor. */
  preview(p: Project, trackId: string, s: number, v = 0.9) {
    if (!this.chains.size || this.needsBuild(p)) this.build(p);
    this.note(p, { beat: 0, dur: 0.6, s, v, track: trackId }, this.ctx.currentTime + 0.01);
  }
}

// ------------------------------------------------------------------------------------- live player

/** Plays a project from a beat, scheduling ~0.25 s ahead; loops a range if given. */
export class Player {
  private timer: ReturnType<typeof setInterval> | null = null;
  private evs: Ev[] = [];
  private acts: Act[] = [];
  private t0 = 0; // ctx time of beat `from`
  private from = 0;
  private done = 0; // beats scheduled up to (in "unrolled" beats from `from`)
  project!: Project;
  loop: { a: number; b: number } | null = null;

  constructor(public engine: Engine, public onEnd?: () => void) {}

  get playing() { return this.timer !== null; }

  /** Where the playhead is now, in project beats. */
  beatNow() {
    if (!this.playing) return null;
    const spb = secPerBeat(this.project);
    return this.toProject(this.from + (this.engine.ctx.currentTime - this.t0) / spb);
  }

  private toProject(u: number) {
    if (!this.loop || u < this.loop.b) return u;
    const L = this.loop.b - this.loop.a;
    return this.loop.a + ((u - this.loop.a) % L);
  }

  update(p: Project) {
    const rebuild = this.engine.needsBuild(p);
    this.project = p;
    const tl = timeline(p);
    this.evs = tl.evs; this.acts = tl.acts;
    if (rebuild && this.playing) { const b = this.beatNow() ?? 0; this.stop(false); this.start(p, b); return; }
    this.engine.mix(p);
  }

  start(p: Project, from: number) {
    this.stop(false);
    const e = this.engine, ctx = e.ctx as AudioContext;
    this.project = p;
    e.build(p);
    e.master.gain.cancelScheduledValues(ctx.currentTime); e.master.gain.setValueAtTime(0.9, ctx.currentTime);
    const tl = timeline(p);
    this.evs = tl.evs; this.acts = tl.acts;
    this.from = from; this.t0 = ctx.currentTime + 0.08; this.done = from;
    e.trackFx(p, this.t0);
    // Clips already under way when playback starts: their effects from now to their end.
    const spb = secPerBeat(p);
    for (const a of this.acts) if (a.a < from && a.b > from) e.activate(a.track, a.type, a.params, this.t0, this.t0 + (a.b - from) * spb, spb);
    this.timer = setInterval(() => this.tick(), 30);
    this.tick();
  }

  private tick() {
    const p = this.project, spb = secPerBeat(p), ctx = this.engine.ctx;
    const horizon = this.from + (ctx.currentTime + 0.25 - this.t0) / spb;
    const end = this.loop ? Infinity : projectEnd(p);
    while (this.done < horizon) {
      // Work in unrolled beats; map each window to project beats (one loop pass at a time).
      const u0 = this.done, pb0 = this.toProject(u0);
      let span = horizon - u0;
      if (this.loop && pb0 < this.loop.b) span = Math.min(span, this.loop.b - pb0);
      const pb1 = pb0 + span;
      const at = (pb: number) => this.t0 + (u0 + (pb - pb0) - this.from) * spb;
      for (const e of this.evs) {
        if (e.beat < pb0 - 1e-9) continue;
        if (e.beat >= pb1 - 1e-9) break;
        this.engine.note(p, e, at(e.beat));
      }
      for (const a of this.acts) if (a.a >= pb0 - 1e-9 && a.a < pb1 - 1e-9) this.engine.activate(a.track, a.type, a.params, at(a.a), at(a.b), spb);
      this.done = u0 + span;
      if (span <= 0) break;
    }
    if (!this.loop && this.toProject(this.from + (ctx.currentTime - this.t0) / spb) > end + 2) { this.stop(); }
  }

  stop(notify = true) {
    if (this.timer) clearInterval(this.timer);
    const was = this.timer !== null;
    this.timer = null;
    if (was) {
      const e = this.engine, t = e.ctx.currentTime;
      e.master.gain.cancelScheduledValues(t); e.master.gain.setTargetAtTime(0, t, 0.015);
      const old = [...e.chains.values()];
      setTimeout(() => { for (const c of old) for (const n of c.nodes) { try { n.disconnect(); } catch {} } }, 120);
      e.reset();
      if (notify) this.onEnd?.();
    }
  }
}

// ------------------------------------------------------------------------------------- export

/** Render the whole project offline to a WAV, reporting progress (0..1) as it goes. */
export async function render(p: Project, onProgress?: (x: number) => void, sampleRate = 44100): Promise<Blob> {
  const spb = secPerBeat(p), seconds = projectEnd(p) * spb + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const e = new Engine(ctx);
  e.build(p);
  const t0 = 0.05, { evs, acts } = timeline(p);
  e.trackFx(p, t0);
  for (const a of acts) e.activate(a.track, a.type, a.params, t0 + a.a * spb, t0 + a.b * spb, spb);
  for (const ev of evs) e.note(p, ev, t0 + ev.beat * spb);
  const steps = 20;
  for (let i = 1; i < steps; i++) {
    const q = 128 / sampleRate, t = Math.floor((seconds * i) / steps / q) * q; // suspend on a render quantum
    ctx.suspend(t).then(() => { onProgress?.(i / steps); ctx.resume(); });
  }
  const buf = await ctx.startRendering();
  onProgress?.(1);
  return encodeWav(buf);
}
