"use client";

import katex from "katex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Footer } from "@/components/Footer";
import { FloralBand } from "@/components/Ornament";
import { Line } from "@/components/Line";
import { Magnetic } from "@/components/Magnetic";
import { RiseChars } from "@/components/Text";
import { getEngine } from "@/lib/audio";
import { type Raga } from "@/lib/music";
import { play, stop, tick, useData } from "@/lib/site";
import { usePlayhead } from "@/lib/usePlayhead";
import { WEIGHTS_V2, parse, verify } from "@/lib/verify";

const NAMES: Record<string, string> = { S: "Sa", r: "Re", R: "Re", g: "Ga", G: "Ga", m: "Ma", M: "Ma", P: "Pa", d: "Dha", D: "Dha", n: "Ni", N: "Ni" };
const KEYS = "asdfghjkl;'";
const GATES = ["format", "allowed", "beats", "variety", "length"] as const;
const PLAIN: Record<string, string> = {
  format: "Readable notation",
  allowed: "Only the raga's notes",
  beats: "Four beats in every bar",
  variety: "No loops or one-note runs",
  length: "Eight bars",
  tala: "Ends on a resting note",
  profile: "Time on each note like real singers",
  motion: "Step sizes like real singers",
  phrases: "Uses phrases real singers use",
};
const TEX = String.raw`R=\underbrace{\text{format}\cdot\text{allowed}^2\cdot\text{beats}^2\cdot\text{variety}\cdot\text{length}}_{\text{hard rules multiply}}\cdot\big(0.2\,\text{tala}+0.35\,\text{profile}+0.1\,\text{motion}+0.35\,\text{phrases}\big)`;

const token = (s: string, o: number) => ".".repeat(Math.max(0, -o)) + s + "'".repeat(Math.max(0, o));
const chunk = (t: string[]) => Array.from({ length: Math.ceil(t.length / 4) }, (_, i) => t.slice(i * 4, i * 4 + 4).join(" ")).join(" | ");

function keyboard(raga: Raga) {
  const low = raga.swaras.filter((s) => "PDdNnMm".includes(s)).map((s) => ({ s, o: -1 }));
  const mid = raga.swaras.map((s) => ({ s, o: 0 }));
  const up = raga.swaras.filter((s) => "SRrGg".includes(s)).map((s) => ({ s, o: 1 }));
  return [...low, ...mid, ...up];
}

/** A score that eases toward its new value. */
function useEased(v: number) {
  const [x, setX] = useState(v);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setX((c) => {
        const n = c + (v - c) * 0.12;
        if (Math.abs(n - v) > 0.001) raf = requestAnimationFrame(loop);
        return Math.abs(n - v) > 0.001 ? n : v;
      });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return x;
}

export default function Compose() {
  const data = useData();
  const [rk, setRk] = useState("bhupali");
  const [tokens, setTokens] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [math, setMath] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const typer = useRef<number | null>(null);
  const raga = data?.ragas.find((r) => r.key === rk);
  const text = chunk(tokens);
  const comp = useMemo(() => parse(text), [text]);
  const notes = useMemo(() => (raga ? comp.notes.map((n) => ({ ...n, ok: raga.swaras.includes(n.s) })) : []), [comp, raga]);
  const report = useMemo(() => (data && raga && comp.notes.length ? verify(text, raga, data.profiles[raga.key]) : null), [data, raga, text, comp]);
  const score = useEased(report?.reward ?? 0);
  const track = useMemo(() => (raga && notes.length ? { id: `mine-${text}`, title: `Your ${raga.name}`, sub: "composed by you", raga: raga.key, notes, notation: text, reward: report?.reward } : null), [raga, notes, text, report]);
  const head = usePlayhead(track?.notes ?? null);
  const modelAvg = useMemo(() => {
    if (!data) return 0;
    const ps = data.pieces.filter((p) => p.raga === rk && p.model === "v2");
    return ps.reduce((a, p) => a + p.reward, 0) / ps.length;
  }, [data, rk]);
  const tex = useMemo(() => katex.renderToString(TEX, { throwOnError: false, displayMode: true }), []);

  const put = useCallback((t: string) => {
    setTokens((prev) => {
      const next = [...prev];
      if (cursor < next.length) next[cursor] = t;
      else next.push(t);
      return next.slice(0, 64);
    });
    setCursor((c) => Math.min(64, c + 1));
  }, [cursor]);

  const sing = useCallback(async (s: string, o: number) => {
    if (!raga) return;
    const eng = getEngine();
    await eng.resume();
    eng.tune(raga);
    eng.note(s, o, 0.55);
    setPressed(`${s}${o}`);
    window.setTimeout(() => setPressed(null), 140);
    put(token(s, o));
  }, [raga, put]);

  const keys = useMemo(() => (raga ? keyboard(raga) : []), [raga]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea") || e.metaKey || e.ctrlKey) return;
      if (e.key === "-") return put("-");
      if (e.key === "Backspace") {
        setTokens((t) => t.filter((_, i) => i !== cursor - 1));
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      const i = KEYS.indexOf(e.key.toLowerCase());
      const mid = keys.filter((k) => k.o >= 0);
      if (i >= 0 && mid[i] && !e.repeat) sing(mid[i].s, mid[i].o);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [keys, sing, put, cursor]);

  const reset = (t: string[] = []) => {
    if (typer.current) window.clearInterval(typer.current);
    setTyping(false);
    stop();
    setTokens(t);
    setCursor(t.length);
  };

  const letModelWrite = () => {
    if (!data) return;
    const pool = data.pieces.filter((p) => p.raga === rk && p.model === "v2");
    const p = pool[Math.floor(Math.random() * pool.length)];
    const all = p.notation.split("|").flatMap((b) => b.trim().split(/\s+/));
    reset();
    setTyping(true);
    let i = 0;
    typer.current = window.setInterval(() => {
      i++;
      setTokens(all.slice(0, i));
      setCursor(i);
      if (i % 2 === 0) tick("soft");
      if (i >= all.length) {
        window.clearInterval(typer.current!);
        setTyping(false);
      }
    }, 70);
  };

  if (!data || !raga) return null;
  const fix = (v?: string) => v?.replace(/\b1 beats\b/, "1 beat").replace(/\b1 bars\b/, "1 bar");
  const verdict = !report
    ? "Tap a key, or use your keyboard. Every note is written at the cursor."
    : report.reward >= 0.8
      ? `That's a ${raga.name}. It scores like the model's best.`
      : report.reward >= 0.5
        ? `Getting there. ${fix(report.violations[0]) ?? "Keep going."}`
        : `Not ${raga.name} yet: ${fix(report.violations[0]) ?? "keep writing"}.`;
  const cells = Math.max(32, Math.ceil((tokens.length + 1) / 16) * 16);
  const beatOf = (i: number) => tokens[i];

  return (
    <main className="bg-transparent">
      <section className="relative overflow-hidden px-6 pb-10 pt-36 sm:px-10">
        <div className="pointer-events-none absolute -right-40 top-0 h-[640px] w-[640px] rounded-full bg-sindoor/10 blur-[140px]" />
        <div className="relative mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-8">
          <div>
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">The composer</div>
            <h1 className="mt-4 font-display text-[clamp(72px,12vw,200px)] leading-[0.85]"><RiseChars text="Compose." /></h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.ragas.map((r) => (
              <button key={r.key} onClick={() => { tick(); setRk(r.key); reset(); }} className={`rounded-full border px-5 py-2.5 text-[15px] transition-all ${r.key === rk ? "border-sindoor bg-sindoor text-paper" : "border-rule hover:border-sindoor/60"}`}>
                {r.name} <span className="ml-1 font-deva opacity-70">{r.devanagari}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
      <FloralBand />

      <section className="px-6 pb-24 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {/* the line, live */}
            <div className="leaf-card relative overflow-hidden border border-rule p-6 text-kajal">
              <div className="mb-2 flex items-center justify-between text-[13px] text-sepia">
                <span>{tokens.length ? `${comp.beats} beats · ${comp.bars.length} bars` : "your melody will draw itself here"}</span>
                {typing && <span className="text-sindoor">ragaz is writing…</span>}
              </div>
              <div className="min-h-[220px]">
                {notes.length > 1 ? (
                  <Line key={notes.length} notes={notes} trackId={track?.id} aspect={3.6} width={2.6} axis={raga.swaras} color="ink" base="ink" glow={false} draw={false} range={[-5, 14]} />
                ) : (
                  <div className="flex h-[220px] items-center justify-center font-display text-[40px] text-rule">♪</div>
                )}
              </div>
            </div>

            {/* the beat grid: one row per cycle of teentaal */}
            <div className="leaf-card border border-rule p-5">
              <div className="grid grid-cols-8 gap-1.5 sm:gap-x-3 sm:gap-y-3 lg:grid-cols-[repeat(16,minmax(0,1fr))]">
                {Array.from({ length: cells }, (_, i) => {
                  const t = beatOf(i);
                  const n = t ? parse(t === "-" ? "S" : t).notes[0] : null;
                  const wrong = t && t !== "-" && n && !raga.swaras.includes(n.s);
                  const isHead = head !== null && Math.floor(head) === i;
                  return (
                    <button key={i} onClick={() => { tick("soft"); setCursor(i); }} data-cursor="Write here"
                      className={`relative flex h-11 items-center justify-center rounded-lg border text-[12px] transition-all duration-200 sm:h-14 sm:rounded-xl sm:text-[15px] ${isHead ? "scale-105 border-sindoor bg-sindoor text-paper" : i === cursor ? "border-sindoor text-kajal shadow-[0_0_0_3px_rgba(178,58,34,.18)]" : t ? "border-rule text-kajal" : "border-rule/60 text-rule"} ${wrong ? "!border-sindoor !text-sindoor" : ""} ${i % 4 === 0 ? "ml-0" : ""}`}>
                      {t ? (t === "-" ? "–" : `${NAMES[n!.s]}${n!.o > 0 ? "′" : n!.o < 0 ? "," : ""}`) : i % 16 === 0 ? <span className="text-[11px] text-sindoor/60">×</span> : ""}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 text-[13px] text-sepia">Four beats to a bar, sixteen to a cycle (teentaal). × marks the first beat of a cycle. Click a cell to move the cursor.</div>
            </div>

            {/* the instrument */}
            <div className="leaf-card border border-rule p-5">
              {/* bellows, breathing as you play */}
              <div className="relative mx-3 h-11 overflow-hidden rounded-t-md border-x-[3px] border-t-[3px] border-[#5E1F14] bg-paper2">
                <div className="absolute inset-0 transition-transform duration-300 ease-out" style={{ transform: `scaleY(${pressed ? 0.78 : 1})`, transformOrigin: "bottom", backgroundImage: "repeating-linear-gradient(180deg, #F1E6CF 0 6px, #CDB690 6px 7px, #E8D8BA 7px 12px, #131A2B 12px 13px)" }} />
              </div>
              <div className="flex flex-wrap items-end gap-[3px] rounded-md border-[10px] border-[#5E1F14] bg-[#5E1F14] p-1 sm:flex-nowrap">
                {keys.map((k) => {
                  const midIndex = keys.filter((x) => x.o >= 0).indexOf(k);
                  const on = pressed === `${k.s}${k.o}`;
                  return (
                    <button key={`${k.s}${k.o}`} data-cursor="Sing" onPointerDown={() => sing(k.s, k.o)}
                      className={`relative flex flex-col items-center justify-end rounded-b-md border pb-3 shadow-[0_6px_0_#cdbb98] transition-all duration-100 ${k.o === 0 ? "h-32 w-[calc((100%-18px)/6)] border-[#cdbb98] bg-[#FBF5E6] text-kajal sm:h-40 sm:w-auto sm:min-w-0 sm:flex-1" : "h-28 w-[calc((100%-18px)/6)] border-[#cdbb98] bg-[#F3E9D2] text-sepia sm:h-32 sm:w-auto sm:min-w-0 sm:flex-1"} ${on ? "translate-y-1.5 bg-[#efe2c4] shadow-[0_2px_0_#cdbb98]" : "hover:bg-[#fffaf0]"}`}>
                      <span className="font-display text-[19px] leading-none sm:text-[26px]">{NAMES[k.s]}</span>
                      <span className="mt-1 text-[11px] opacity-70">{k.o > 0 ? "upper" : k.o < 0 ? "lower" : "rgdn".includes(k.s) ? "komal" : k.s === "M" ? "tivra" : " "}</span>
                      {midIndex >= 0 && midIndex < KEYS.length && <span className="absolute left-2 top-2 font-mono text-[10px] uppercase opacity-50">{KEYS[midIndex]}</span>}
                    </button>
                  );
                })}
                <button onClick={() => { tick(); put("-"); }} data-cursor="Hold" className="h-28 w-[calc((100%-18px)/6)] rounded-b-md border border-[#cdbb98] bg-[#F3E9D2] font-display text-kajal shadow-[0_6px_0_#cdbb98] hover:bg-[#fffaf0] sm:h-32 sm:w-auto sm:min-w-0 sm:flex-1">hold<br /><span className="font-mono text-[11px]">–</span></button>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Magnetic variant="solid" cursor={track && head !== null ? "Stop" : "Play"} onClick={() => (track ? (head !== null ? stop() : play(track)) : undefined)}>{head !== null ? "❚❚ Stop" : "▶ Play mine"}</Magnetic>
                <Magnetic cursor="Watch" onClick={letModelWrite}>Let ragaz write one</Magnetic>
                <Magnetic cursor="Load" onClick={() => reset(parse(raga.pakad).bars.flat())}>Start from its signature phrase</Magnetic>
                <Magnetic cursor="Undo" onClick={() => { setTokens((t) => t.slice(0, -1)); setCursor((c) => Math.max(0, c - 1)); }}>Undo</Magnetic>
                <Magnetic cursor="Clear" onClick={() => reset()}>Clear</Magnetic>
              </div>
            </div>
          </div>

          {/* the verdict */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="leaf-card relative border border-rule p-7 text-kajal"><span className="pointer-events-none absolute inset-[6px] border border-sindoor/40" />
              <div className="text-[12px] uppercase tracking-[0.24em] text-kajal/50">Score</div>
              <div className="mt-2 flex items-end gap-3">
                <span className={`font-display text-[112px] leading-[0.85] tabular-nums ${report && report.reward < 0.3 ? "text-sindoor" : "text-kajal"}`}>{score.toFixed(2)}</span>
                <span className="pb-3 text-[14px] text-kajal/50">/ 1</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper2"><div className="h-full rounded-full bg-sindoor transition-[width] duration-500" style={{ width: `${score * 100}%` }} /></div>
              <div className="mt-2 flex justify-between text-[12px] text-kajal/50"><span>0</span><span>its 8-bar model (v2) averages {modelAvg.toFixed(2)}</span><span>1</span></div>
              <p className="mt-6 text-[18px] leading-[1.5]">{verdict}</p>
              {report && (
                <ul className="mt-6 space-y-2.5 text-[15px]">
                  {(["allowed", "beats", "variety", "length", "profile", "phrases"] as const).map((k) => {
                    const v = report.scores[k];
                    return (
                      <li key={k} className="flex items-center gap-3">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] ${v >= 0.8 ? "bg-kajal text-paper" : v >= 0.4 ? "bg-sindoor text-paper" : "bg-sindoor text-paper"}`}>{v >= 0.8 ? "✓" : v >= 0.4 ? "~" : "✕"}</span>
                        <span className={v >= 0.8 ? "" : "text-kajal/70"}>{PLAIN[k]}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button onClick={() => { tick(); setMath(!math); }} className="mt-7 text-[15px] underline decoration-kajal/30 underline-offset-4 hover:decoration-kajal">{math ? "Hide the math" : "Show the math"}</button>
              {math && report && (
                <div className="mt-5 space-y-4">
                  <div className="overflow-x-auto text-[13px] [&_.katex]:text-[0.9em]" dangerouslySetInnerHTML={{ __html: tex }} />
                  <div className="space-y-2 text-[14px]">
                    {[...GATES, ...(Object.keys(WEIGHTS_V2) as (keyof typeof WEIGHTS_V2)[])].map((k) => (
                      <div key={k} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2">
                        <span className="text-kajal/60">{k}</span>
                        <div className="h-1.5 rounded-full bg-paper2"><div className="h-full rounded-full bg-kajal" style={{ width: `${report.scores[k] * 100}%` }} /></div>
                        <span className="text-right tabular-nums">{report.scores[k].toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[13px] text-kajal/60">gates × style = {report.gate.toFixed(3)} × {report.shaped.toFixed(3)}. The same function scored every piece the model wrote.</div>
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-3">
              <button disabled={!tokens.length} onClick={() => { tick(); navigator.clipboard?.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} className="flex-1 rounded-full border border-rule py-3 text-[14px] hover:border-sindoor disabled:opacity-40">{copied ? "Copied ✓" : "Copy notation"}</button>
              <button disabled={!tokens.length} onClick={() => { tick(); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([`Raga ${raga.name}\n${text}\n`], { type: "text/plain" })); a.download = `my-${raga.key}.txt`; a.click(); }} className="flex-1 rounded-full border border-rule py-3 text-[14px] hover:border-sindoor disabled:opacity-40">Download</button>
            </div>
            {tokens.length > 0 && <div className="mt-4 break-words font-mono text-[13px] leading-relaxed tracking-wider text-sepia">{text}</div>}
          </aside>
        </div>
      </section>
      <Footer />
    </main>
  );
}
