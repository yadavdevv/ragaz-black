"use client";

// Six more instruments, drawn as they look and playable in any raga: plucked (sitar, santoor,
// swarmandal) and held (bansuri, shehnai, sarangi). Sweep across strings or frets; a held note
// sounds while the pointer rests on its hole or stopping point.
// All synthesised (lib/kit.ts): Karplus–Strong strings, and breath, reed and bow made from waves and noise.

import { useEffect, useRef, useState } from "react";
import { getEngine } from "@/lib/audio";
import { type Release, bansuri, pluck, sarangi, shehnai } from "@/lib/kit";
import { tick, useData } from "@/lib/site";
import { type Row, ragaOfHour, rows as ragaRows } from "@/lib/music";

const INK = "#131A2B", GOLD = "#A8853C", RED = "#B23A22", ROSE = "#D9705A";
const SA = 220;

// One output for this page: a little room behind everything.
const outs = new WeakMap<BaseAudioContext, { out: AudioNode; noise: AudioBuffer }>();
function output(ctx: BaseAudioContext) {
  let o = outs.get(ctx);
  if (!o) {
    const n = Math.ceil(2 * ctx.sampleRate), noise = ctx.createBuffer(1, n, ctx.sampleRate), ir = ctx.createBuffer(2, n, ctx.sampleRate);
    let s = 3;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
    noise.getChannelData(0).forEach((_, i, a) => (a[i] = r()));
    for (let c = 0; c < 2; c++) ir.getChannelData(c).forEach((_, i, a) => (a[i] = r() * Math.exp((-5 * i) / n) * 0.5));
    const bus = ctx.createGain(); bus.gain.value = 0.9;
    const room = ctx.createConvolver(); room.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.18;
    bus.connect(ctx.destination); bus.connect(wet).connect(room).connect(ctx.destination);
    o = { out: bus, noise };
    outs.set(ctx, o);
  }
  return o;
}
const keep = <S extends AudioScheduledSourceNode>(s: S) => s;

async function ctxNow() {
  const eng = getEngine();
  await eng.resume();
  return eng.ctx;
}

type Kind = "sitar" | "santoor" | "swarmandal" | "bansuri" | "shehnai" | "sarangi";

async function strike(kind: Kind, hz: number, v = 1) {
  const ctx = await ctxNow(), { out } = output(ctx);
  pluck(ctx, out, ctx.currentTime + 0.005, hz, v, kind === "sitar" ? "sitar" : "santoor", keep);
}

async function hold(kind: Kind, hz: number): Promise<Release> {
  const ctx = await ctxNow(), { out, noise } = output(ctx), at = ctx.currentTime + 0.005;
  if (kind === "bansuri") return bansuri(ctx, out, at, hz, 1, keep, noise);
  if (kind === "sarangi") return sarangi(ctx, out, at, hz, 1, keep, noise);
  return shehnai(ctx, out, at, hz, 1, keep);
}

// ------------------------------------------------------------------------------- shared pieces
// Drawn like the tanpura and tabla: blue-black lacquer, gold hairlines, paper inlay, rose accents.

const INK2 = "#1F2840", PAPER = "#F1E6CF";

/** Strings that shake when plucked: a quadratic curve whose middle swings and decays. */
function useVibes(n: number) {
  const amps = useRef<number[]>([]);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const geo = useRef<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = performance.now() / 1000;
      for (let i = 0; i < n; i++) {
        const g = geo.current[i], p = paths.current[i];
        if (!g || !p) continue;
        const a = (amps.current[i] ?? 0) * 0.93;
        amps.current[i] = a;
        const w = a * Math.sin(t * (70 + i * 6));
        const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2;
        // swing perpendicular to the string
        const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) || 1, nx = -(g.y2 - g.y1) / len, ny = (g.x2 - g.x1) / len;
        p.setAttribute("d", `M ${g.x1} ${g.y1} Q ${(mx + nx * w).toFixed(1)} ${(my + ny * w).toFixed(1)} ${g.x2} ${g.y2}`);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  const string = (i: number, x1: number, y1: number, x2: number, y2: number, props: React.SVGProps<SVGPathElement>) => {
    geo.current[i] = { x1, y1, x2, y2 };
    return <path key={`s${i}`} ref={(el) => { paths.current[i] = el; }} d={`M ${x1} ${y1} L ${x2} ${y2}`} fill="none" {...props} />;
  };
  const kick = (i: number, a = 4) => { amps.current[i] = a; };
  return { string, kick };
}

/** A five-petal inlay flower, as on the tanpura's face. */
const Flower = ({ x, y, s = 1 }: { x: number; y: number; s?: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    {Array.from({ length: 5 }, (_, k) => <ellipse key={k} cx="0" cy="-4" rx="2" ry="4" fill={k % 2 ? ROSE : PAPER} transform={`rotate(${k * 72})`} />)}
    <circle r="1.4" fill={GOLD} />
  </g>
);

/** The note just played, popping up over the drawing. */
const Pop = ({ label, id }: { label: string | null; id: number }) =>
  label ? <div key={id} className="note-pop pointer-events-none absolute right-3 top-2 rounded-full bg-kajal px-3 py-1 font-display text-[16px] text-paper shadow">{label}</div> : null;

const usePointer = () => {
  const ref = useRef<SVGSVGElement>(null);
  const at = (e: React.PointerEvent, w: number, h: number) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  return { ref, at };
};

/** Where each note is stopped on a neck from the bridge (BR) to the nut. A stopped string sounds
 *  at 1/length, so the real spacing shrinks toward the bridge; drawn eased (length^0.6) so that two
 *  octaves stay readable. */
const stops = (notes: Row[], BR: number, NUT: number) => {
  const base = notes[0]?.ratio ?? 1, last = (notes[notes.length - 1]?.ratio ?? 2) / base;
  return notes.map((n) => { const f = (1 / (n.ratio / base) ** 0.6 - 1 / last ** 0.6) / (1 - 1 / last ** 0.6); return BR + 40 + f * (NUT - BR - 60); });
};

// ------------------------------------------------------------------------------- sitar

/** A sitar lying on its side: gourd at the left, the long neck to the right with its curved frets
 *  set to the raga's notes, where a real player sets them. Sweep along the neck to play. */
function Sitar({ notes, sa }: { notes: Row[]; sa: number }) {
  const W = 600, H = 240, BR = 112, NUT = 560, top = 104, bot = 136;
  const { ref, at } = usePointer();
  const { string, kick } = useVibes(4);
  const [lit, setLit] = useState<{ i: number; id: number } | null>(null);
  const last = useRef<number | null>(null);
  const xs = stops(notes, BR, NUT);
  const hit = (x: number, y: number) => {
    if (y < top - 14 || y > bot + 30) return null;
    let best: number | null = null, d = 1e9;
    xs.forEach((fx, i) => { if (Math.abs(fx - x) < d) { d = Math.abs(fx - x); best = i; } });
    return d < 14 ? best : null;
  };
  const play = (i: number) => { strike("sitar", sa * notes[i].ratio, 0.9); [0, 1, 2, 3].forEach((k) => kick(k, 2.5)); setLit({ i, id: Date.now() }); };
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" data-cursor="Sweep"
        onPointerMove={(e) => { const p = at(e, W, H), i = hit(p.x, p.y); if (i !== null && i !== last.current) play(i); last.current = i; }}
        onPointerDown={(e) => { const p = at(e, W, H), i = hit(p.x, p.y); if (i !== null) { tick("soft"); play(i); } }}
        onPointerLeave={() => (last.current = null)}>
        <defs>
          <radialGradient id="si-gourd" cx="40%" cy="35%" r="70%"><stop offset="0" stopColor={INK2} /><stop offset="1" stopColor={INK} /></radialGradient>
        </defs>
        {/* the upper resonator under the top of the neck */}
        <circle cx={508} cy={176} r={30} fill="url(#si-gourd)" stroke={GOLD} strokeWidth="1.2" />
        <Flower x={508} y={176} s={1.3} />
        {/* gourd (tumba) and its face */}
        <ellipse cx={92} cy={124} rx={86} ry={104} fill="url(#si-gourd)" stroke={GOLD} strokeWidth="1.5" />
        <ellipse cx={104} cy={124} rx={62} ry={78} fill={INK2} stroke={GOLD} strokeWidth="1" />
        {Array.from({ length: 9 }, (_, k) => { const a = (k / 9) * Math.PI * 2; return <Flower key={k} x={+(104 + 50 * Math.cos(a)).toFixed(1)} y={+(124 + 64 * Math.sin(a)).toFixed(1)} />; })}
        {/* neck (dand), with inlay down its middle and the pegs at its end */}
        <path d={`M 150 ${top - 6} L ${NUT + 14} ${top - 2} L ${NUT + 14} ${bot + 2} L 150 ${bot + 6} Z`} fill={INK2} stroke={GOLD} strokeWidth="1.2" />
        {[240, 330, 420].map((x) => <path key={x} d={`M ${x} ${top + 9} C ${x + 8} ${top + 14} ${x + 8} ${bot - 14} ${x} ${bot - 9} C ${x - 8} ${bot - 14} ${x - 8} ${top + 14} ${x} ${top + 9} Z`} fill={PAPER} opacity=".25" />)}
        <path d={`M ${NUT + 14} ${top - 2} L 594 ${top + 4} L 594 ${bot - 4} L ${NUT + 14} ${bot + 2} Z`} fill={INK} stroke={GOLD} strokeWidth="1" />
        {[528, 552, 576].map((x, k) => <g key={x}><rect x={x - 4} y={top - 30} width={8} height={26} rx={3} fill={INK} stroke={GOLD} strokeWidth=".8" /><circle cx={x} cy={top - 32} r={7} fill={k === 1 ? ROSE : PAPER} stroke={GOLD} strokeWidth="1" /></g>)}
        {Array.from({ length: 11 }, (_, k) => <circle key={k} cx={250 + k * 28} cy={bot + 13} r={3.4} fill={PAPER} stroke={GOLD} strokeWidth=".6" />)}
        <rect x={NUT - 3} y={top} width={5} height={bot - top} fill={PAPER} />
        {/* the frets: curved brass, one per note of the raga */}
        {xs.map((x, i) => (
          <g key={i}>
            <path d={`M ${x} ${top - 3} Q ${x + 7} ${(top + bot) / 2} ${x} ${bot + 3}`} fill="none" stroke={lit?.i === i ? RED : GOLD} strokeWidth={lit?.i === i ? 3 : 2.2} />
            <text x={x} y={bot + (i % 2 ? 42 : 30)} textAnchor="middle" fontSize={10} fill={lit?.i === i ? RED : INK} opacity={0.75}>{notes[i].label}</text>
          </g>
        ))}
        {/* bridge on the gourd, and the strings */}
        <rect x={BR - 4} y={top + 2} width={10} height={bot - top - 4} rx={2} fill={PAPER} stroke={GOLD} strokeWidth=".8" />
        <circle cx={14} cy={120} r={4} fill={GOLD} />
        {[0, 1, 2, 3].map((k) => <line key={k} x1={14} y1={120} x2={BR} y2={top + 8 + k * 6} stroke={PAPER} strokeWidth=".6" opacity=".6" />)}
        {[0, 1, 2, 3].map((k) => string(k, BR, top + 8 + k * 6, NUT, top + 8 + k * 6, { stroke: PAPER, strokeWidth: k === 0 ? 1.4 : 0.9 }))}
      </svg>
      <Pop label={lit && notes[lit.i].label} id={lit?.id ?? 0} />
    </div>
  );
}

// ------------------------------------------------------------------------------- santoor and swarmandal

/** A box zither: courses of strings across it, low at the bottom; sweep up and down to play.
 *  Santoor: a trapezoid with two rosettes and rows of bridges, its mallets beside it. Swarmandal:
 *  a painted board with tuning pins along one side. */
function Zither({ kind, notes, sa }: { kind: "santoor" | "swarmandal"; notes: Row[]; sa: number }) {
  const santoor = kind === "santoor";
  const W = 600, H = santoor ? 270 : 250, top = 46, bottom = santoor ? 206 : 206;
  const { ref, at } = usePointer();
  const { string, kick } = useVibes(notes.length);
  const [lit, setLit] = useState<{ i: number; id: number } | null>(null);
  const last = useRef<number | null>(null);
  const n = notes.length, gap = (bottom - top) / Math.max(1, n - 1);
  const ys = notes.map((_, i) => bottom - i * gap); // low notes at the bottom, nearest the player
  // The frame's left and right edges at height y (a trapezoid for the santoor, a slanted board for the swarmandal).
  const left = (y: number) => (santoor ? 128 - ((y - 26) / 200) * 92 : 70 + ((y - 26) / 200) * 18);
  const right = (y: number) => (santoor ? 472 + ((y - 26) / 200) * 92 : 540 - ((y - 26) / 200) * 18);
  const hit = (y: number) => { const i = Math.round((bottom - y) / gap); return i >= 0 && i < n && Math.abs(y - ys[i]) < gap / 2 ? i : null; };
  const play = (i: number) => { strike(kind, sa * notes[i].ratio, 0.85); kick(i, Math.min(5, gap * 0.4)); setLit({ i, id: Date.now() }); };
  const frame = santoor ? `M 128 26 L 472 26 L 564 226 L 36 226 Z` : `M 70 26 L 540 26 L 522 226 L 88 226 Z`;
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" data-cursor="Sweep"
        onPointerMove={(e) => { const i = hit(at(e, W, H).y); if (i !== null && i !== last.current) play(i); last.current = i; }}
        onPointerDown={(e) => { const i = hit(at(e, W, H).y); if (i !== null) { tick("soft"); play(i); } }}
        onPointerLeave={() => (last.current = null)}>
        <defs>
          <linearGradient id={`zi-${kind}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={INK2} /><stop offset="1" stopColor={INK} /></linearGradient>
        </defs>
        <path d={frame} fill={`url(#zi-${kind})`} stroke={GOLD} strokeWidth="1.6" strokeLinejoin="round" />
        <path d={frame} fill="none" stroke={GOLD} strokeWidth=".8" opacity=".6" transform="translate(300 126) scale(.94) translate(-300 -126)" />
        {santoor ? (
          <>
            {[200, 400].map((x) => <g key={x}><circle cx={x} cy={128} r={22} fill={INK} stroke={GOLD} strokeWidth="1" />{Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2; return <Flower key={k} x={+(x + 14 * Math.cos(a)).toFixed(1)} y={+(128 + 14 * Math.sin(a)).toFixed(1)} s={0.7} />; })}<Flower x={x} y={128} /></g>)}
            {/* the bridges (chess-piece shaped), alternating sides as on a real santoor */}
            {ys.map((y, i) => { const x = i % 2 ? 250 : 350; return <path key={`b${i}`} d={`M ${x - 4} ${y + 4} L ${x + 4} ${y + 4} L ${x + 2} ${y - 2} L ${x - 2} ${y - 2} Z`} fill={PAPER} stroke={GOLD} strokeWidth=".5" />; })}
            {/* the mallets (mezrab) */}
            {[0, 1].map((k) => <g key={k} transform={`translate(${190 + k * 140} ${248 + k * 6}) rotate(${k ? -4 : 3})`}><path d="M 0 0 L 110 0" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" /><path d="M 110 0 q 10 -1 12 -8" stroke={GOLD} strokeWidth="2.4" fill="none" strokeLinecap="round" /><rect x={-14} y={-3} width={18} height={6} rx={3} fill={ROSE} /></g>)}
          </>
        ) : (
          <>
            {/* painted vine border and a rosette */}
            {Array.from({ length: 12 }, (_, k) => <Flower key={k} x={110 + k * 36} y={36} s={0.8} />)}
            <circle cx={300} cy={128} r={18} fill={INK} stroke={GOLD} strokeWidth="1" />
            <Flower x={300} y={128} s={1.6} />
            {/* tuning pins (left) and hitch pins (right) */}
            {ys.map((y, i) => <circle key={`p${i}`} cx={left(y) + 18 + (i % 2) * 8} cy={y} r={3.2} fill={PAPER} stroke={GOLD} strokeWidth=".6" />)}
            {ys.map((y, i) => <circle key={`h${i}`} cx={right(y) - 14} cy={y} r={1.8} fill={GOLD} />)}
          </>
        )}
        {ys.map((y, i) => {
          const x1 = left(y) + (santoor ? 16 : 26), x2 = right(y) - (santoor ? 16 : 14), on = lit?.i === i;
          return (
            <g key={i}>
              {santoor && [-2.4, 2.4].map((d) => <line key={d} x1={x1} y1={y + d} x2={x2} y2={y + d} stroke={PAPER} strokeWidth=".5" opacity=".45" />)}
              {string(i, x1, y, x2, y, { stroke: on ? ROSE : PAPER, strokeWidth: notes[i].o < 0 ? 1.3 : 0.9 })}
              {santoor && <circle cx={x2 + 6} cy={y} r={2.4} fill={GOLD} />}
              <text x={left(y) - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill={on ? RED : INK} opacity={0.75}>{notes[i].label}</text>
            </g>
          );
        })}
      </svg>
      <Pop label={lit && notes[lit.i].label} id={lit?.id ?? 0} />
    </div>
  );
}

// ------------------------------------------------------------------------------- winds

/** Hold a note while the pointer rests on its place; move off to stop. */
function useHeld(kind: Kind, notes: Row[], sa: number) {
  const [on, setOn] = useState<number | null>(null);
  const rel = useRef<{ i: number; r: Promise<Release> } | null>(null);
  const stop = () => { rel.current?.r.then((r) => r()); rel.current = null; setOn(null); };
  const start = (i: number) => { if (rel.current?.i === i) return; stop(); rel.current = { i, r: hold(kind, sa * notes[i].ratio) }; setOn(i); };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bind = (i: number) => ({ onPointerEnter: () => start(i), onPointerDown: () => { tick("soft"); start(i); } });
  return { on, stop, bind };
}

/** A bansuri: a length of bamboo with its nodes, red thread bindings, the blowing hole and a
 *  finger hole for each note. */
function Bansuri({ notes, sa }: { notes: Row[]; sa: number }) {
  const W = 600, H = 120, y = 52, r = 15;
  const { on, stop, bind } = useHeld("bansuri", notes, sa);
  const xs = notes.map((_, i) => 210 + (i * 340) / Math.max(1, notes.length - 1));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" data-cursor="Rest" onPointerLeave={stop}>
        <defs>
          <linearGradient id="ba-bamboo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#EBD9AA" /><stop offset=".45" stopColor="#D9BC7C" /><stop offset="1" stopColor="#A9864A" /></linearGradient>
        </defs>
        <rect x={14} y={y - r} width={572} height={r * 2} rx={r} fill="url(#ba-bamboo)" stroke={GOLD} strokeWidth="1" />
        <rect x={20} y={y - r + 4} width={560} height={3} rx={1.5} fill={PAPER} opacity=".55" />
        {[150, 470].map((x) => <g key={x}><line x1={x} y1={y - r} x2={x} y2={y + r} stroke="#8C6A35" strokeWidth="2" /><line x1={x + 3} y1={y - r + 2} x2={x + 3} y2={y + r - 2} stroke={PAPER} strokeWidth=".8" opacity=".6" /></g>)}
        {[34, 44, 566, 556].map((x) => <rect key={x} x={x} y={y - r} width={5} height={r * 2} fill={RED} opacity=".85" />)}
        <ellipse cx={92} cy={y} rx={8} ry={6} fill={INK} />
        {xs.map((x, i) => (
          <g key={i} {...bind(i)} className="cursor-pointer">
            <circle cx={x} cy={y} r={14} fill="transparent" />
            <ellipse cx={x} cy={y} rx={6.5} ry={6} fill={on === i ? RED : INK} />
            {on === i && <circle cx={x} cy={y} r={12} fill="none" stroke={ROSE} strokeWidth={2}><animate attributeName="r" values="9;17;9" dur="1.1s" repeatCount="indefinite" /></circle>}
            <text x={x} y={y + 36} textAnchor="middle" fontSize={11} fill={on === i ? RED : INK} opacity={0.75}>{notes[i].label}</text>
          </g>
        ))}
      </svg>
      <Pop label={on !== null ? notes[on].label : null} id={on ?? -1} />
    </div>
  );
}

/** A shehnai: the double reed and its lip disc, a turned wooden cone with brass rings, and the
 *  flared brass bell. */
function Shehnai({ notes, sa }: { notes: Row[]; sa: number }) {
  const W = 600, H = 150, y = 70;
  const { on, stop, bind } = useHeld("shehnai", notes, sa);
  const x0 = 70, x1 = 450, half = (x: number) => 6 + ((x - x0) / (x1 - x0)) * 10;
  const xs = notes.map((_, i) => 120 + (i * 300) / Math.max(1, notes.length - 1));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" data-cursor="Rest" onPointerLeave={stop}>
        <defs>
          <linearGradient id="sh-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={INK2} /><stop offset="1" stopColor={INK} /></linearGradient>
          <linearGradient id="sh-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E3C887" /><stop offset=".5" stopColor={GOLD} /><stop offset="1" stopColor="#7E6128" /></linearGradient>
        </defs>
        {/* reed and lip disc */}
        <path d={`M 10 ${y - 5} Q 30 ${y - 4} 44 ${y - 2.5} L 44 ${y + 2.5} Q 30 ${y + 4} 10 ${y + 5} Z`} fill={PAPER} stroke={GOLD} strokeWidth=".8" />
        <ellipse cx={46} cy={y} rx={4} ry={15} fill="url(#sh-brass)" stroke={GOLD} strokeWidth=".6" />
        <rect x={50} y={y - 4} width={22} height={8} fill="url(#sh-brass)" />
        {/* the wooden cone */}
        <path d={`M ${x0} ${y - half(x0)} L ${x1} ${y - half(x1)} L ${x1} ${y + half(x1)} L ${x0} ${y + half(x0)} Z`} fill="url(#sh-wood)" stroke={GOLD} strokeWidth="1" />
        {[x0 + 4, 200, 330, x1 - 6].map((x) => <rect key={x} x={x - 2} y={y - half(x) - 1} width={4} height={half(x) * 2 + 2} fill="url(#sh-brass)" />)}
        {/* the bell */}
        <path d={`M ${x1} ${y - half(x1)} C ${x1 + 70} ${y - half(x1) - 2} ${x1 + 100} ${y - 40} ${x1 + 126} ${y - 58} L ${x1 + 126} ${y + 58} C ${x1 + 100} ${y + 40} ${x1 + 70} ${y + half(x1) + 2} ${x1} ${y + half(x1)} Z`} fill="url(#sh-brass)" stroke="#7E6128" strokeWidth="1" />
        <ellipse cx={x1 + 126} cy={y} rx={7} ry={58} fill="#7E6128" stroke={GOLD} strokeWidth="1" />
        <path d={`M ${x1 + 20} ${y - half(x1) - 2} C ${x1 + 70} ${y - 22} ${x1 + 100} ${y - 40} ${x1 + 120} ${y - 52}`} fill="none" stroke={PAPER} strokeWidth="1.2" opacity=".5" />
        {xs.map((x, i) => (
          <g key={i} {...bind(i)} className="cursor-pointer">
            <circle cx={x} cy={y} r={14} fill="transparent" />
            <circle cx={x} cy={y} r={4.6} fill={on === i ? RED : PAPER} opacity={on === i ? 1 : 0.85} />
            {on === i && <circle cx={x} cy={y} r={12} fill="none" stroke={ROSE} strokeWidth={2}><animate attributeName="r" values="8;16;8" dur="0.9s" repeatCount="indefinite" /></circle>}
            <text x={x} y={y + 38} textAnchor="middle" fontSize={11} fill={on === i ? RED : INK} opacity={0.75}>{notes[i].label}</text>
          </g>
        ))}
      </svg>
      <Pop label={on !== null ? notes[on].label : null} id={on ?? -1} />
    </div>
  );
}

// ------------------------------------------------------------------------------- sarangi

/** A sarangi lying on its side: the waisted body with its skin face and bridge, the broad neck
 *  with rows of small pegs for the sympathetic strings, three big pegs, and the bow over it,
 *  moving while a note sounds. Rest on a stopping point to bow its note. */
function Sarangi({ notes, sa }: { notes: Row[]; sa: number }) {
  const W = 600, H = 240, BR = 120, NUT = 548, top = 118, bot = 150;
  const { on, stop, bind } = useHeld("sarangi", notes, sa);
  const xs = stops(notes, BR, NUT);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" data-cursor="Rest" onPointerLeave={stop}>
        <defs>
          <linearGradient id="sa-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={INK2} /><stop offset="1" stopColor={INK} /></linearGradient>
        </defs>
        {/* body: the lower chamber with a skin face, a waist, then the upper chamber */}
        <path d={`M 20 ${top - 44} Q 12 ${(top + bot) / 2} 20 ${bot + 44} L 190 ${bot + 40} Q 206 ${bot + 14} 228 ${bot + 26} L 300 ${bot + 22} L 300 ${top - 22} L 228 ${top - 26} Q 206 ${top - 14} 190 ${top - 40} Z`} fill="url(#sa-wood)" stroke={GOLD} strokeWidth="1.4" strokeLinejoin="round" />
        <rect x={34} y={top - 34} width={142} height={bot - top + 68} rx={14} fill={PAPER} stroke={GOLD} strokeWidth="1" />
        <rect x={40} y={top - 28} width={130} height={bot - top + 56} rx={10} fill="none" stroke={GOLD} strokeWidth=".6" opacity=".6" />
        <path d={`M ${BR - 6} ${top - 4} L ${BR + 6} ${top - 4} L ${BR + 9} ${bot + 4} L ${BR - 9} ${bot + 4} Z`} fill={INK} stroke={GOLD} strokeWidth=".6" />
        {[250, 278].map((x) => <Flower key={x} x={x} y={(top + bot) / 2} s={1.2} />)}
        {/* neck and peg box */}
        <path d={`M 300 ${top - 20} L 560 ${top - 14} L 560 ${bot + 14} L 300 ${bot + 20} Z`} fill={INK2} stroke={GOLD} strokeWidth="1.2" />
        {Array.from({ length: 2 }, (_, row) => Array.from({ length: 11 }, (_, k) => <circle key={`${row}-${k}`} cx={320 + k * 22} cy={row ? bot + 26 : top - 26} r={3.4} fill={PAPER} stroke={GOLD} strokeWidth=".6" />))}
        <path d={`M 560 ${top - 14} L 592 ${top - 10} L 592 ${bot + 10} L 560 ${bot + 14} Z`} fill={INK} stroke={GOLD} strokeWidth="1" />
        {[562, 575, 588].map((x, k) => <g key={x}><rect x={x - 4} y={top - 48} width={8} height={32} rx={3} fill={INK} stroke={GOLD} strokeWidth=".8" /><circle cx={x} cy={top - 52} r={7} fill={k === 1 ? ROSE : PAPER} stroke={GOLD} strokeWidth="1" /></g>)}
        {/* strings: three main ones over the bridge to the tailpiece */}
        <rect x={10} y={top + 4} width={8} height={bot - top - 8} rx={2} fill={GOLD} />
        {[0, 1, 2].map((k) => <line key={k} x1={14} y1={top + 8 + k * 8} x2={NUT} y2={top + 8 + k * 8} stroke={on !== null && k === 1 ? ROSE : PAPER} strokeWidth={1.4 - k * 0.3} />)}
        {/* stopping points */}
        {xs.map((x, i) => (
          <g key={i} {...bind(i)} className="cursor-pointer">
            <rect x={x - 9} y={top - 6} width={18} height={bot - top + 12} fill="transparent" />
            <circle cx={x} cy={top + 16} r={4.6} fill={on === i ? RED : GOLD} />
            {on === i && <circle cx={x} cy={top + 16} r={12} fill="none" stroke={ROSE} strokeWidth={2}><animate attributeName="r" values="8;15;8" dur="1s" repeatCount="indefinite" /></circle>}
            <text x={x} y={bot + (i % 2 ? 56 : 44)} textAnchor="middle" fontSize={10} fill={on === i ? RED : INK} opacity={0.75}>{notes[i].label}</text>
          </g>
        ))}
        {/* the bow, drawn across the strings near the bridge; it moves while a note sounds */}
        <g pointerEvents="none">
          <g style={{ transform: on !== null ? undefined : "none", animation: on !== null ? "bow 1.4s ease-in-out infinite alternate" : "none" }}>
            <path d={`M 150 ${top - 70} Q 170 ${top + 70} 190 ${bot + 70}`} fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round" />
            <line x1={156} y1={top - 64} x2={186} y2={bot + 64} stroke={PAPER} strokeWidth="1.2" opacity=".9" />
            <rect x={146} y={top - 80} width={10} height={16} rx={3} fill={ROSE} transform={`rotate(-10 151 ${top - 72})`} />
          </g>
        </g>
        <style>{`@keyframes bow{from{transform:translate(-18px,-6px)}to{transform:translate(22px,8px)}}`}</style>
      </svg>
      <Pop label={on !== null ? notes[on].label : null} id={on ?? -1} />
    </div>
  );
}

// ------------------------------------------------------------------------------- the cards

const CARDS: { kind: Kind; name: string; deva: string; what: string; facts: [string, string][] }[] = [
  { kind: "sitar", name: "Sitar", deva: "सितार", what: "A long-necked lute with movable curved frets. The player pulls the string sideways across a fret to bend into a note (meend), and the bridge makes every note buzz.",
    facts: [["Sound here", "Karplus–Strong: a burst of noise circling a delay line one period long, softened each pass, like a real string losing its brightness. A soft clip adds the bridge's buzz (jawari)."], ["Strings", "Usually 6–7 played strings and 11–13 sympathetic ones under the frets that ring along in the raga's notes."]] },
  { kind: "santoor", name: "Santoor", deva: "संतूर", what: "A trapezoid box of strings struck with two light wooden mallets, from Kashmir. Notes ring on and blur into each other, like rain on water.",
    facts: [["Sound here", "The same string model, struck brighter and losing energy faster."], ["Strings", "Around 100, in groups of three or four tuned to the same note, over movable bridges."]] },
  { kind: "swarmandal", name: "Swarmandal", deva: "स्वरमंडल", what: "A small harp of many strings tuned to the raga's notes, strummed by singers between phrases for a shimmer. Sweep up and down it.",
    facts: [["Sound here", "Bright plucked strings an octave up, one per note of the raga across two octaves."], ["Tuning", "Retuned for each raga: only its notes, so any sweep sounds right."]] },
  { kind: "bansuri", name: "Bansuri", deva: "बाँसुरी", what: "A bamboo flute with six or seven holes, blown across the side. Breath is half its sound: you hear air before the note settles.",
    facts: [["Sound here", "Three harmonics (almost a sine), breath noise around the second harmonic, a puff of air at the start, and a vibrato that arrives only once the note is steady."], ["Holes", "Half-covering a hole bends the note, which is how it plays the raga's glides."]] },
  { kind: "shehnai", name: "Shehnai", deva: "शहनाई", what: "A double-reed horn, played at weddings and temple gates. Its reed makes the nasal, singing buzz; its bell throws the sound far.",
    facts: [["Sound here", "Harmonics 4 to 8 lifted (the buzz of a reed), a bright resonance near 1.5 kHz, a scoop up into each note and a wide vibrato."], ["Player", "Ustad Bismillah Khan brought it from processions to the concert stage."]] },
  { kind: "sarangi", name: "Sarangi", deva: "सारंगी", what: "A bowed fiddle carved from one block of wood, stopped not with fingertips but with the cuticles. Of all instruments it comes closest to the human voice.",
    facts: [["Sound here", "A sawtooth (the shape a bow pulls a string into) through three resonances placed like a voice's vowel formants, sliding up into each note, with bow noise."], ["Strings", "Three gut strings bowed, and up to 35 sympathetic ones."]] },
];

export function MoreInstruments() {
  const data = useData();
  const ragas = data?.latest.ragas ?? [];
  const [rk, setRk] = useState<string | null>(null);
  useEffect(() => { if (!rk && ragas.length) setRk(ragaOfHour(ragas, new Date().getHours()).key); }, [rk, ragas]);
  const raga = ragas.find((r) => r.key === rk);
  if (!raga) return null;
  const all = ragaRows(raga);
  const mid = all.filter((r) => r.semis >= 0 && r.semis <= 12);
  const play = (kind: Kind) => {
    if (kind === "sitar") return <Sitar notes={all} sa={SA / 2} />;
    if (kind === "santoor") return <Zither kind="santoor" notes={all} sa={SA} />;
    if (kind === "swarmandal") return <Zither kind="swarmandal" notes={all} sa={SA * 2} />;
    if (kind === "bansuri") return <Bansuri notes={mid} sa={SA * 2} />;
    if (kind === "shehnai") return <Shehnai notes={mid} sa={SA * 1.5} />;
    return <Sarangi notes={all} sa={SA} />;
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 text-[14px] text-sepia">Tuned to</span>
        {ragas.map((r) => (
          <button key={r.key} onClick={() => { tick("soft"); setRk(r.key); }} className={`rounded-full border px-4 py-1.5 text-[14px] transition-colors ${r.key === rk ? "border-kajal bg-kajal text-paper" : "border-rule hover:border-sindoor/60"}`}>{r.name}</button>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {CARDS.map((c) => (
          <div key={c.kind} className="leaf-card border border-rule p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-display text-[40px] leading-none text-kajal">{c.name}</h3>
              <span className="font-deva text-[22px] text-kajal/55">{c.deva}</span>
            </div>
            <p className="mt-3 text-[16px] leading-[1.6] text-sepia">{c.what}</p>
            <div className="mt-5">{play(c.kind)}</div>
            <dl className="mt-4 divide-y divide-rule border-y border-rule text-[14px]">
              {c.facts.map(([k, v]) => (
                <div key={k} className="grid gap-1 py-2 sm:grid-cols-[7rem_1fr] sm:gap-4"><dt className="text-kajal">{k}</dt><dd className="text-sepia">{v}</dd></div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
