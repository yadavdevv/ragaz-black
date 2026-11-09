"use client";

// The sound designer's pictures (the studio's Sound panel), each one also the control: drag the
// harmonics, turn their phases, pull the envelope's corners, and see the filter over the harmonics
// it cuts. lib/waves.ts describes the sound.

import { useEffect, useRef, useState } from "react";
import { H, type Patch, cycle, peak } from "@/lib/waves";

const INK = "#131A2B", RED = "#B23A22", PINK = "#D9705A", GOLD = "#A8853C", RULE = "#CDB690";

/** Pointer position inside an SVG, in its viewBox units. */
function local(e: React.PointerEvent | PointerEvent, svg: SVGSVGElement, w: number, h: number) {
  const r = svg.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
}

// ------------------------------------------------------------------------------- the harmonics

/** 16 bars, one per harmonic: drag across them to paint amplitudes. Under each, a dial for its phase. */
export function Harmonics({ patch, onChange, focus, onFocus }: { patch: Patch; onChange: (amp: number[], phase: number[]) => void; focus: number | null; onFocus: (k: number | null) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<null | { kind: "amp" } | { kind: "phase"; k: number }>(null);
  const W = 640, BAR_H = 170, DIAL = 230, Hh = 262, cw = W / H;
  const paint = (e: React.PointerEvent) => {
    const p = local(e, svg.current!, W, Hh);
    if (drag.current?.kind === "amp") {
      const k = Math.max(0, Math.min(H - 1, Math.floor(p.x / cw)));
      const amp = [...patch.amp];
      amp[k] = Math.round(Math.max(0, Math.min(1, 1 - (p.y - 10) / BAR_H)) * 100) / 100;
      if (amp[k] < 0.02) amp[k] = 0;
      onChange(amp, patch.phase);
      onFocus(k);
    } else if (drag.current?.kind === "phase") {
      const k = drag.current.k, cx = k * cw + cw / 2;
      const deg = Math.round(((Math.atan2(p.x - cx, -(p.y - DIAL)) * 180) / Math.PI + 360) % 360 / 15) * 15;
      const phase = [...patch.phase];
      phase[k] = deg % 360;
      onChange(patch.amp, phase);
    }
  };
  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${Hh}`} className="w-full touch-none select-none"
      onPointerMove={(e) => { if (drag.current) paint(e); else { const p = local(e, svg.current!, W, Hh); onFocus(p.y < BAR_H + 20 ? Math.floor(p.x / cw) : null); } }}
      onPointerUp={() => (drag.current = null)} onPointerLeave={() => { drag.current = null; onFocus(null); }}>
      <rect x={0} y={0} width={W} height={BAR_H + 20} fill="transparent" onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { kind: "amp" }; paint(e); }} />
      {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={0} x2={W} y1={10 + BAR_H * (1 - g)} y2={10 + BAR_H * (1 - g)} stroke={RULE} strokeWidth={0.6} strokeDasharray="2 4" pointerEvents="none" />)}
      {patch.amp.map((a, k) => {
        const x = k * cw + 6, h = a * BAR_H, on = focus === k;
        return (
          <g key={k} pointerEvents="none">
            <rect x={x} y={10 + BAR_H - h} width={cw - 12} height={Math.max(h, 1.5)} rx={3} fill={on ? RED : a ? INK : RULE} opacity={a ? 1 : 0.6} />
            <text x={k * cw + cw / 2} y={BAR_H + 30} textAnchor="middle" fontSize={11} fill={on ? RED : INK} opacity={0.7}>{k + 1}</text>
          </g>
        );
      })}
      {patch.phase.map((ph, k) => {
        const cx = k * cw + cw / 2, r = 11, rad = (ph * Math.PI) / 180, live = patch.amp[k] > 0;
        return (
          <g key={k} className="cursor-grab" opacity={live ? 1 : 0.3}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { kind: "phase", k }; paint(e); }}
            onDoubleClick={() => { const phase = [...patch.phase]; phase[k] = 0; onChange(patch.amp, phase); }}>
            <circle cx={cx} cy={DIAL} r={r + 6} fill="transparent" />
            <circle cx={cx} cy={DIAL} r={r} fill="none" stroke={focus === k ? RED : INK} strokeWidth={1.2} />
            <line x1={cx} y1={DIAL} x2={cx + r * Math.sin(rad)} y2={DIAL - r * Math.cos(rad)} stroke={focus === k ? RED : INK} strokeWidth={2} strokeLinecap="round" />
            <text x={cx} y={DIAL + 26} textAnchor="middle" fontSize={9} fill={INK} opacity={0.55}>{ph}°</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The wave: two cycles of the sum (bold), each harmonic under it (faint), the focused one in red. */
export function WavePlot({ patch, focus, height = 200 }: { patch: Patch; focus: number | null; height?: number }) {
  const W = 640, n = 400, mid = height / 2;
  const sum = cycle(patch, n / 2), s = (mid - 12) / peak(sum);
  const path = (y: Float32Array) => Array.from({ length: n }, (_, i) => `${i ? "L" : "M"}${((i / (n - 1)) * W).toFixed(1)},${(mid - y[i % (n / 2)] * s).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke={RULE} strokeWidth={0.8} />
      <line x1={W / 2} x2={W / 2} y1={8} y2={height - 8} stroke={RULE} strokeWidth={0.6} strokeDasharray="2 4" />
      {patch.amp.map((a, k) => (a ? <path key={k} d={path(cycle(patch, n / 2, k))} fill="none" stroke={focus === k ? RED : GOLD} strokeWidth={focus === k ? 2 : 1} opacity={focus === k ? 0.95 : 0.45} /> : null))}
      <path d={path(sum)} fill="none" stroke={INK} strokeWidth={2.6} strokeLinejoin="round" />
    </svg>
  );
}

/** The sum written out: y = a₁ sin θ + a₂ sin(2θ + φ₂) + … */
export function Formula({ patch }: { patch: Patch }) {
  const terms = patch.amp.map((a, k) => ({ a, k, ph: patch.phase[k] })).filter((t) => t.a > 0);
  const shown = terms.slice(0, 6);
  return (
    <div className="font-mono text-[13px] leading-[1.9] text-kajal/80">
      y(θ) = {shown.length ? shown.map((t, i) => (
        <span key={t.k}>
          {i ? " + " : ""}<span className="text-sindoor">{t.a.toFixed(2)}</span>·sin({t.k ? `${t.k + 1}` : ""}θ{t.ph ? <> + <span className="text-sona">{t.ph}°</span></> : ""})
        </span>
      )) : "0"}
      {terms.length > shown.length ? ` + … (${terms.length - shown.length} more)` : ""}
    </div>
  );
}

// ------------------------------------------------------------------------------- the envelope

/** Attack, decay, sustain, release as one curve with three handles to drag. */
export function Envelope({ env, onChange }: { env: Patch["env"]; onChange: (e: Patch["env"]) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<null | "a" | "d" | "r">(null);
  const W = 640, Hh = 180, top = 14, bot = Hh - 22, hold = 0.6; // seconds of sustain drawn
  const span = Math.max(2.5, env.a + env.d + hold + env.r);
  const X = (t: number) => (t / span) * W, Y = (v: number) => bot - v * (bot - top);
  const ta = env.a, td = env.a + env.d, tr = td + hold, te = tr + env.r;
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = local(e, svg.current!, W, Hh), t = Math.max(0, (p.x / W) * span);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    if (drag === "a") onChange({ ...env, a: round(Math.min(2, Math.max(0.002, t))) });
    if (drag === "d") onChange({ ...env, d: round(Math.min(3, Math.max(0.02, t - env.a))), s: Math.round(Math.max(0, Math.min(1, (bot - p.y) / (bot - top))) * 100) / 100 });
    if (drag === "r") onChange({ ...env, r: round(Math.min(4, Math.max(0.02, t - tr))) });
  };
  // The decay and release are exponential, as the synth plays them.
  const curve = (t0: number, t1: number, v0: number, v1: number, tau: number) => Array.from({ length: 30 }, (_, i) => { const t = t0 + ((t1 - t0) * (i + 1)) / 30; return `L${X(t).toFixed(1)},${Y(v1 + (v0 - v1) * Math.exp(-(t - t0) / tau)).toFixed(1)}`; }).join("");
  const d = `M0,${Y(0)} L${X(ta)},${Y(1)} ${curve(ta, td, 1, env.s, env.d / 3)} L${X(tr)},${Y(env.s)} ${curve(tr, te, env.s, 0, env.r / 4)}`;
  const handle = (k: "a" | "d" | "r", x: number, y: number, label: string) => (
    <g className="cursor-grab" onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(k); }}>
      <circle cx={x} cy={y} r={16} fill="transparent" />
      <circle cx={x} cy={y} r={7} fill={drag === k ? RED : "#F8F0DF"} stroke={RED} strokeWidth={2} />
      <text x={x} y={y - 13} textAnchor="middle" fontSize={11} fill={RED}>{label}</text>
    </g>
  );
  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${Hh}`} className="w-full touch-none select-none" onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      <line x1={0} x2={W} y1={bot} y2={bot} stroke={RULE} />
      <path d={`${d} L${X(te)},${bot} Z`} fill={PINK} opacity={0.12} />
      <path d={d} fill="none" stroke={INK} strokeWidth={2.4} />
      <line x1={X(tr)} x2={X(tr)} y1={top} y2={bot} stroke={RULE} strokeDasharray="2 4" />
      <text x={X(tr) + 6} y={bot + 15} fontSize={10} fill={INK} opacity={0.5}>key let go</text>
      {[["attack", 0, ta], ["decay", ta, td], ["sustain", td, tr], ["release", tr, te]].map(([n, a, b]) => (
        <text key={n as string} x={(X(a as number) + X(b as number)) / 2} y={bot + 15} textAnchor="middle" fontSize={10} fill={INK} opacity={0.65}>{n as string}</text>
      ))}
      {handle("a", X(ta), Y(1), "A")}
      {handle("d", X(td), Y(env.s), "D · S")}
      {handle("r", X(te), Y(0), "R")}
    </svg>
  );
}

// ------------------------------------------------------------------------------- the filter

/** |H| of the low-pass the synth uses (the RBJ biquad, as Web Audio's BiquadFilterNode). */
function lowpass(f: number, fc: number, q: number, fs = 48000) {
  const w0 = (2 * Math.PI * Math.min(fc, fs / 2.05)) / fs, al = Math.sin(w0) / (2 * Math.pow(10, q / 20)), c = Math.cos(w0);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = b0, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  const w = (2 * Math.PI * f) / fs;
  const re = (x0: number, x1: number, x2: number) => x0 + x1 * Math.cos(-w) + x2 * Math.cos(-2 * w);
  const im = (x1: number, x2: number) => x1 * Math.sin(-w) + x2 * Math.sin(-2 * w);
  return Math.hypot(re(b0, b1, b2), im(b1, b2)) / Math.hypot(re(a0, a1, a2), im(a1, a2));
}

/** The harmonics of Sa on a frequency axis, the filter's curve over them, and what gets through. */
export function FilterView({ patch, sa }: { patch: Patch; sa: number }) {
  const W = 640, Hh = 190, top = 12, bot = Hh - 24, f0 = 50, f1 = 16000;
  const X = (f: number) => (Math.log(f / f0) / Math.log(f1 / f0)) * W;
  const Y = (v: number) => bot - Math.min(1.25, v) / 1.25 * (bot - top);
  const { cutoff, q } = patch.filter;
  const curve = Array.from({ length: 160 }, (_, i) => { const f = f0 * (f1 / f0) ** (i / 159); return `${i ? "L" : "M"}${X(f).toFixed(1)},${Y(lowpass(f, cutoff, q)).toFixed(1)}`; }).join("");
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full">
      <line x1={0} x2={W} y1={bot} y2={bot} stroke={RULE} />
      {[100, 1000, 10000].map((f) => <text key={f} x={X(f)} y={bot + 16} textAnchor="middle" fontSize={10} fill={INK} opacity={0.5}>{f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`}</text>)}
      {patch.amp.map((a, k) => {
        if (!a) return null;
        const f = sa * (k + 1), g = lowpass(f, cutoff, q);
        return (
          <g key={k}>
            <line x1={X(f)} x2={X(f)} y1={bot} y2={Y(a)} stroke={RULE} strokeWidth={5} strokeLinecap="round" />
            <line x1={X(f)} x2={X(f)} y1={bot} y2={Y(a * Math.min(1.25, g))} stroke={INK} strokeWidth={5} strokeLinecap="round" />
          </g>
        );
      })}
      <path d={curve} fill="none" stroke={RED} strokeWidth={2} />
      <line x1={X(cutoff)} x2={X(cutoff)} y1={top} y2={bot} stroke={RED} strokeDasharray="3 4" opacity={0.6} />
      <text x={X(cutoff) + 6} y={top + 10} fontSize={11} fill={RED}>cutoff {cutoff >= 1000 ? `${(cutoff / 1000).toFixed(1)} kHz` : `${Math.round(cutoff)} Hz`}</text>
    </svg>
  );
}

// ------------------------------------------------------------------------------- small curves

/** A few seconds of a slow wave: the pitch under vibrato, or the loudness under tremolo. */
export function Lfo({ rate, depth, max, label }: { rate: number; depth: number; max: number; label: string }) {
  const W = 300, Hh = 70, mid = Hh / 2, n = 200, sec = 2;
  const d = Array.from({ length: n }, (_, i) => `${i ? "L" : "M"}${((i / (n - 1)) * W).toFixed(1)},${(mid - (depth / max) * (mid - 6) * Math.sin(2 * Math.PI * rate * ((i / (n - 1)) * sec))).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke={RULE} />
      <path d={d} fill="none" stroke={INK} strokeWidth={2} />
      <text x={W - 4} y={Hh - 4} textAnchor="end" fontSize={10} fill={INK} opacity={0.5}>{label} · 2 s</text>
    </svg>
  );
}

/** Two copies detuned by `cents` beat: their sum swells and fades `beats` times a second. */
export function Beating({ hz, cents, voices }: { hz: number; cents: number; voices: number }) {
  const W = 300, Hh = 80, mid = 34, n = 300, sec = 2;
  const ratio = 2 ** (cents / 1200), beats = hz * (ratio - 1);
  // The loudness of two voices together over 2 s (exact), with the wave inside drawn slowed down.
  const env = (t: number) => (voices > 1 ? Math.abs(Math.cos(Math.PI * beats * t)) : 1);
  const pts = Array.from({ length: n }, (_, i) => (i / (n - 1)) * sec);
  const X = (t: number) => ((t / sec) * W).toFixed(1);
  const upper = pts.map((t, i) => `${i ? "L" : "M"}${X(t)},${(mid - (mid - 4) * env(t)).toFixed(1)}`).join("");
  const lower = [...pts].reverse().map((t) => `L${X(t)},${(mid + (mid - 4) * env(t)).toFixed(1)}`).join("");
  const wave = pts.map((t, i) => `${i ? "L" : "M"}${X(t)},${(mid - (mid - 4) * env(t) * Math.sin(2 * Math.PI * 9 * t)).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full">
      <path d={`${upper}${lower}Z`} fill={PINK} opacity={0.18} />
      <path d={wave} fill="none" stroke={INK} strokeWidth={1.2} opacity={0.7} />
      <text x={W - 4} y={Hh - 2} textAnchor="end" fontSize={10} fill={RED}>{voices > 1 && beats > 0.05 ? `${beats.toFixed(1)} beats a second` : "one voice, or no spread: no beating"}</text>
    </svg>
  );
}

// ------------------------------------------------------------------------------- the live scope

/** What is actually coming out: the waveform (held still on its rising zero crossing) and the spectrum. */
export function Scope({ analyser, className = "" }: { analyser: AnalyserNode | null; className?: string }) {
  const wave = useRef<HTMLCanvasElement>(null), spec = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!analyser) return;
    let raf = 0, gain = 1;
    const t = new Float32Array(analyser.fftSize), f = new Uint8Array(analyser.frequencyBinCount);
    const fit = (c: HTMLCanvasElement) => {
      const dpr = window.devicePixelRatio || 1, w = c.clientWidth * dpr, h = c.clientHeight * dpr;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      return c.getContext("2d")!;
    };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cw = wave.current, cs = spec.current;
      if (!cw || !cs) return;
      analyser.getFloatTimeDomainData(t);
      let g = fit(cw);
      const { width: w, height: h } = cw;
      g.clearRect(0, 0, w, h);
      g.strokeStyle = RULE; g.lineWidth = 1; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      let start = 0;
      for (let i = 1; i < t.length / 2; i++) if (t[i - 1] < 0 && t[i] >= 0) { start = i; break; }
      const span = Math.min(t.length - start, 1024);
      let top = 0.02;
      for (let i = 0; i < span; i++) top = Math.max(top, Math.abs(t[start + i]));
      const want = 0.42 / top;
      gain = want < gain ? want : gain * 0.92 + want * 0.08; // drops at once, rises slowly: a quiet wave still fills the screen
      g.strokeStyle = INK; g.lineWidth = 2 * (window.devicePixelRatio || 1); g.beginPath();
      for (let i = 0; i < span; i++) { const x = (i / span) * w, y = h / 2 - Math.max(-0.48, Math.min(0.48, t[start + i] * gain)) * h; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      analyser.getByteFrequencyData(f);
      g = fit(cs);
      const { width: sw, height: sh } = cs;
      g.clearRect(0, 0, sw, sh);
      const nyq = analyser.context.sampleRate / 2, lo = Math.log(40), hi = Math.log(12000);
      g.fillStyle = RED;
      const bars = 96;
      for (let b = 0; b < bars; b++) {
        const fa = Math.exp(lo + ((hi - lo) * b) / bars), fb = Math.exp(lo + ((hi - lo) * (b + 1)) / bars);
        let m = 0;
        for (let i = Math.floor((fa / nyq) * f.length); i <= Math.ceil((fb / nyq) * f.length) && i < f.length; i++) m = Math.max(m, f[i]);
        const bh = (m / 255) ** 1.6 * sh;
        g.globalAlpha = 0.35 + 0.65 * (m / 255);
        g.fillRect((b / bars) * sw + 1, sh - bh, sw / bars - 2, bh);
      }
      g.globalAlpha = 1;
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  return (
    <div className={className}>
      <canvas ref={wave} className="h-[120px] w-full" />
      <canvas ref={spec} className="mt-2 h-[60px] w-full" />
    </div>
  );
}
