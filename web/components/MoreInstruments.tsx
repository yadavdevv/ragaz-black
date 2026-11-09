"use client";

// Six more instruments, playable in any raga: plucked (sitar, santoor, swarmandal) and held (bansuri,
// shehnai, sarangi). Move across the strings or holes; a held note sounds while the pointer stays on it.
// All synthesised (lib/kit.ts): Karplus–Strong strings, and breath, reed and bow made from waves and noise.

import { useEffect, useRef, useState } from "react";
import { getEngine } from "@/lib/audio";
import { type Release, bansuri, pluck, sarangi, shehnai } from "@/lib/kit";
import { ragaOfHour } from "@/lib/music";
import { tick, useData } from "@/lib/site";
import { type Row, rows as ragaRows } from "@/lib/waves";

const INK = "#131A2B", GOLD = "#A8853C", RED = "#B23A22", ROSE = "#D9705A", RULE = "#CDB690", LEAF = "#F8F0DF";
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

// ------------------------------------------------------------------------------- plucked strings

/** Strings across the instrument: sweep the pointer over them to pluck each one it crosses. */
function Strings({ kind, notes, sa, frets = false, frame }: { kind: Kind; notes: Row[]; sa: number; frets?: boolean; frame: "neck" | "trapezoid" }) {
  const W = 600, top = 26, gap = Math.min(22, 220 / Math.max(1, notes.length)), Hh = top * 2 + gap * (notes.length - 1);
  const amps = useRef<number[]>([]);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const last = useRef<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [lit, setLit] = useState<number | null>(null);
  const x0 = 70, x1 = W - 30;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = performance.now() / 1000;
      notes.forEach((_, i) => {
        const a = (amps.current[i] ?? 0) * 0.94;
        amps.current[i] = a;
        const y = top + i * gap, w = a * Math.sin(t * (60 + i * 5));
        paths.current[i]?.setAttribute("d", `M ${x0} ${y} Q ${(x0 + x1) / 2} ${y + w} ${x1} ${y}`);
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [notes, gap]);
  // Strings are drawn high note on top.
  const order = [...notes.keys()].reverse();
  const at = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect(), y = ((e.clientY - r.top) / r.height) * Hh;
    const i = Math.round((y - top) / gap);
    return i >= 0 && i < notes.length && Math.abs(y - (top + i * gap)) < gap * 0.5 ? i : null;
  };
  const play = (i: number) => {
    const n = notes[order[i]];
    strike(kind, sa * n.ratio, 0.9);
    amps.current[i] = Math.min(6, gap * 0.35);
    setLit(i);
  };
  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${Hh}`} className="w-full touch-none select-none" data-cursor="Sweep"
      onPointerMove={(e) => { const i = at(e); if (i !== null && i !== last.current) play(i); last.current = i; }}
      onPointerDown={(e) => { const i = at(e); if (i !== null) { tick("soft"); play(i); } last.current = i; }}
      onPointerLeave={() => { last.current = null; setLit(null); }}>
      {frame === "trapezoid"
        ? <path d={`M ${x0 - 18} 8 L ${x1 + 14} ${top - 14} L ${x1 + 14} ${Hh - top + 14} L ${x0 - 18} ${Hh - 8} Z`} fill={LEAF} stroke={GOLD} strokeWidth={1.5} />
        : <rect x={x0 - 18} y={6} width={x1 - x0 + 36} height={Hh - 12} rx={10} fill={LEAF} stroke={GOLD} strokeWidth={1.5} />}
      {frets && Array.from({ length: 14 }, (_, k) => { const x = x0 + 40 + k * 30; return <path key={k} d={`M ${x} ${top - 12} Q ${x + 6} ${Hh / 2} ${x} ${Hh - top + 12}`} fill="none" stroke={GOLD} strokeWidth={1.4} opacity={0.6} />; })}
      {frame === "trapezoid" && notes.map((_, i) => <circle key={i} cx={x0 + 120 + ((i * 97) % 300)} cy={top + i * gap} r={2.6} fill={GOLD} />)}
      {order.map((ni, i) => (
        <g key={i}>
          <text x={x0 - 24} y={top + i * gap + 4} textAnchor="end" fontSize={11} fill={lit === i ? RED : INK} opacity={0.75}>{notes[ni].label}</text>
          <path ref={(el) => { paths.current[i] = el; }} d={`M ${x0} ${top + i * gap} L ${x1} ${top + i * gap}`} stroke={lit === i ? RED : INK} strokeWidth={notes[ni].o < 0 ? 1.8 : notes[ni].o > 0 ? 0.9 : 1.3} fill="none" />
        </g>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------------------- held: holes and bow

/** A row of finger holes (or bowing points): rest the pointer on one to sound it; move off to stop. */
function Held({ kind, notes, sa, shape }: { kind: Kind; notes: Row[]; sa: number; shape: "flute" | "reed" | "bow" }) {
  const W = 600, Hh = shape === "bow" ? 150 : 110, mid = Hh / 2;
  const [on, setOn] = useState<number | null>(null);
  const rel = useRef<{ i: number; r: Promise<Release> } | null>(null);
  const x0 = shape === "reed" ? 90 : 70, x1 = shape === "reed" ? W - 120 : W - 50;
  const xs = notes.map((_, i) => x0 + ((x1 - x0) * i) / Math.max(1, notes.length - 1));
  const stop = () => { rel.current?.r.then((r) => r()); rel.current = null; setOn(null); };
  const start = (i: number) => {
    if (rel.current?.i === i) return;
    stop();
    rel.current = { i, r: hold(kind, sa * notes[i].ratio) };
    setOn(i);
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full touch-none select-none" data-cursor="Rest" onPointerLeave={stop} onPointerUp={(e) => e.pointerType === "touch" && stop()}>
      {shape === "flute" && <rect x={20} y={mid - 16} width={W - 40} height={32} rx={16} fill={LEAF} stroke={GOLD} strokeWidth={1.5} />}
      {shape === "flute" && [60, W - 70].map((x) => <line key={x} x1={x} x2={x} y1={mid - 16} y2={mid + 16} stroke={RED} strokeWidth={3} />)}
      {shape === "reed" && <path d={`M 30 ${mid - 9} L ${W - 140} ${mid - 16} Q ${W - 70} ${mid - 18} ${W - 22} ${mid - 46} L ${W - 22} ${mid + 46} Q ${W - 70} ${mid + 18} ${W - 140} ${mid + 16} L 30 ${mid + 9} Z`} fill={LEAF} stroke={GOLD} strokeWidth={1.5} />}
      {shape === "reed" && <rect x={8} y={mid - 4} width={24} height={8} rx={2} fill={INK} />}
      {shape === "bow" && <>
        <rect x={20} y={20} width={W - 40} height={Hh - 40} rx={22} fill={LEAF} stroke={GOLD} strokeWidth={1.5} />
        {[0, 1, 2].map((k) => <line key={k} x1={30} x2={W - 30} y1={mid - 14 + k * 14} y2={mid - 14 + k * 14} stroke={INK} strokeWidth={1.4 - k * 0.3} opacity={0.6} />)}
        <path d={`M 40 ${mid + 34} Q ${W / 2} ${mid + 50} ${W - 40} ${mid + 34}`} fill="none" stroke={on !== null ? RED : INK} strokeWidth={2} opacity={0.8} />
      </>}
      {notes.map((n, i) => (
        <g key={i} onPointerEnter={() => start(i)} onPointerDown={() => { tick("soft"); start(i); }}>
          <circle cx={xs[i]} cy={shape === "bow" ? mid : mid} r={shape === "bow" ? 15 : 11} fill="transparent" />
          <circle cx={xs[i]} cy={mid} r={shape === "bow" ? 6 : 8} fill={on === i ? RED : shape === "bow" ? GOLD : INK} opacity={on === i ? 1 : 0.85} />
          {on === i && <circle cx={xs[i]} cy={mid} r={15} fill="none" stroke={ROSE} strokeWidth={2}><animate attributeName="r" values="10;20;10" dur="1s" repeatCount="indefinite" /></circle>}
          <text x={xs[i]} y={shape === "bow" ? Hh - 6 : mid + 34} textAnchor="middle" fontSize={11} fill={on === i ? RED : INK} opacity={0.7}>{n.label}</text>
        </g>
      ))}
    </svg>
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
    if (kind === "sitar") return <Strings kind="sitar" notes={all} sa={SA / 2} frets frame="neck" />;
    if (kind === "santoor") return <Strings kind="santoor" notes={all} sa={SA} frame="trapezoid" />;
    if (kind === "swarmandal") return <Strings kind="swarmandal" notes={all} sa={SA * 2} frame="trapezoid" />;
    if (kind === "bansuri") return <Held kind="bansuri" notes={mid} sa={SA * 2} shape="flute" />;
    if (kind === "shehnai") return <Held kind="shehnai" notes={mid} sa={SA * 1.5} shape="reed" />;
    return <Held kind="sarangi" notes={all} sa={SA} shape="bow" />;
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
