"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Footer } from "@/components/Footer";
import { FloralBand } from "@/components/Ornament";
import { Plate } from "@/components/Plate";
import { VoiceCurve } from "@/components/VoiceCurve";
import { PAINTINGS } from "@/lib/art";
import { Line } from "@/components/Line";
import { PieceCard } from "@/components/PieceCard";
import { Reveal, RiseChars } from "@/components/Text";
import { getEngine } from "@/lib/audio";
import { SWARAS } from "@/lib/music";
import { type Track, pieceTrack, singVoice, stop, toggle, useData, useSite } from "@/lib/site";
import { parse } from "@/lib/verify";
import { ABOUT } from "@/lib/about";
import { Evolution } from "@/components/home/Evolution";

const NAMES: Record<string, string> = { S: "Sa", r: "Re", R: "Re", g: "Ga", G: "Ga", m: "Ma", M: "Ma", P: "Pa", d: "Dha", D: "Dha", n: "Ni", N: "Ni" };

export default function RagaPage() {
  const { key } = useParams<{ key: string }>();
  const data = useData();
  const playing = useSite((s) => (s.playing ? s.track?.id : null));
  const curveTag = useSite((s) => s.curveTag);
  const [lit, setLit] = useState<number | null>(null);
  const raga = data?.allRagas.find((r) => r.key === key);
  const pakad: Track | null = useMemo(() => (raga ? { id: `pakad-${raga.key}`, title: `${raga.name} · signature phrase`, sub: "the pakad", raga: raga.key, notes: parse(raga.pakad).notes } : null), [raga]);
  const recAudio = useRef<HTMLAudioElement>(null);
  const [recOn, setRecOn] = useState<string | null>(null);
  useEffect(() => { recAudio.current?.pause(); setRecOn(null); }, [key]);
  if (!data || !raga || !pakad) return null;
  const rec = data.latest.recordings.find((r) => r.raga === raga.key);
  const playRec = (v: "vocal" | "expressive") => {
    const a = recAudio.current, f = rec?.files[v];
    if (!a || !f) return;
    if (recOn === v) { a.pause(); setRecOn(null); return; }
    stop();
    a.src = f; a.currentTime = 0; a.play().catch(() => {}); setRecOn(v);
  };
  const m = data.masters.ragas[raga.key] as (typeof data.masters.ragas)[string] | undefined;
  const voice = data.voices.find((v) => v.raga === raga.key);
  const newest = data.latest.pieces.filter((p) => p.raga === raga.key).sort((a, b) => b.reward - a.reward).slice(0, 3).map((p) => pieceTrack(p));
  const pieces = data.pieces.filter((p) => p.raga === raga.key && p.model === "v2").sort((a, b) => b.reward - a.reward).slice(0, 3).map((p) => pieceTrack(p));
  const order = data.allRagas.map((r) => r.key);
  const next = data.allRagas.find((r) => r.key === order[(order.indexOf(raga.key) + 1) % order.length])!;
  const tap = async (pc: number) => {
    const eng = getEngine();
    await eng.resume();
    eng.tune(raga);
    const ok = raga.notes.includes(pc);
    eng.note(SWARAS[pc], 0, ok ? 0.8 : 0.35, ok ? "note" : "wrong");
    setLit(pc);
    window.setTimeout(() => setLit(null), 400);
  };

  return (
    <main className="bg-transparent">
      <section className="wasli relative overflow-hidden px-6 pb-20 pt-36 text-kajal sm:px-10">
        <div className="mx-auto grid max-w-[1400px] items-end gap-12 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-3 text-[14px]">
            <Link href="/ragas" className="mr-2 text-sindoor hover:underline">← All ragas</Link>
            {order.map((k) => <Link key={k} href={`/ragas/${k}`} className={`rounded-full border px-4 py-1.5 ${k === raga.key ? "border-kajal bg-kajal text-paper" : "border-kajal/20 hover:border-kajal"}`}>{data.allRagas.find((r) => r.key === k)!.name}</Link>)}
          </div>
          <h1 className="mt-10 font-display text-[clamp(72px,13vw,230px)] leading-[0.82]"><RiseChars text={raga.name} step={45} /></h1>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
            <div className="font-deva text-[clamp(32px,4vw,56px)] text-kajal/60">{raga.devanagari}</div>
            <div className="grid grid-cols-3 gap-10 text-[15px]">
              <div><div className="text-kajal/50">sung</div><div className="mt-1 text-[20px]">{raga.time.split(" (")[0]}</div></div>
              <div><div className="text-kajal/50">mood</div><div className="mt-1 text-[20px]">{ABOUT[raga.key]?.mood ?? raga.rasa}</div></div>
              <div><div className="text-kajal/50">family (thaat)</div><div className="mt-1 text-[20px]">{raga.thaat}</div></div>
            </div>
          </div>
        </div>
        {PAINTINGS[raga.key] && <Plate p={PAINTINGS[raga.key]} tone="paper" className="w-[min(80vw,340px)] -rotate-1" />}
        </div>
      </section>
      <FloralBand />

      <section className="px-6 py-28 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-16 lg:grid-cols-2">
          <Reveal>
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Its notes · tap to hear</div>
            <div className="mt-6 grid grid-cols-6 gap-2">
              {Array.from({ length: 12 }, (_, pc) => {
                const ok = raga.notes.includes(pc), s = SWARAS[pc];
                return (
                  <button key={pc} data-cursor={ok ? "Sing" : "Not allowed"} onClick={() => tap(pc)}
                    className={`flex h-24 flex-col items-center justify-end rounded-2xl border pb-3 transition-all duration-300 ${ok ? "border-kajal bg-kajal text-paper" : "border-rule text-sepia opacity-50"} ${lit === pc ? (ok ? "-translate-y-2 scale-105" : "translate-x-1") : ""}`}>
                    <span className="font-display text-[21px]">{NAMES[s]}</span>
                    <span className="text-[11px] opacity-70">{"rgdn".includes(s) ? "komal" : s === "M" ? "tivra" : s === raga.vadi ? "most important" : s === raga.samvadi ? "second" : " "}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-10 space-y-4 text-[18px] leading-[1.65] text-sepia">{(ABOUT[raga.key]?.text ?? []).map((t) => <p key={t}>{t}</p>)}</div>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="flex items-baseline justify-between text-[12px] uppercase tracking-[0.24em] text-sepia">
              <span>Its signature phrase (pakad)</span>
              <button data-cursor="Play" onClick={() => toggle(pakad)} className="normal-case tracking-normal text-kajal hover:text-sindoor">{playing === pakad.id ? "Stop" : "▶ Play"}</button>
            </div>
            <button data-cursor="Play" onClick={() => toggle(pakad)} className="mt-6 block w-full text-kajal">
              <Line notes={pakad.notes} trackId={pakad.id} aspect={2.6} width={3} axis={raga.swaras} color="ink" base="ink" glow={false} />
            </button>
            <div className="mt-3 font-mono text-[15px] tracking-wider text-sepia">{raga.pakad}</div>
          </Reveal>
        </div>
      </section>

      {voice && (
        <section className="px-6 pb-28 sm:px-10">
          <div className="mx-auto max-w-[1400px] text-kajal">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">How a singer sings it</div>
                <div className="mt-2 font-display text-[clamp(36px,4vw,60px)] leading-none">Ten seconds of a real {raga.name}</div>
              </div>
              <button data-cursor={curveTag ? "Stop" : "Listen"} onClick={() => (curveTag ? stop() : singVoice(voice))} className="rounded-full border border-rule px-6 py-3 text-[15px] hover:border-sindoor hover:text-sindoor">{curveTag ? "❚❚ Stop" : "▶ Hear the line"}</button>
            </div>
            <div className="leaf-card mt-8 border border-rule p-5 text-kajal"><VoiceCurve voice={voice} axis={raga.swaras} aspect={4} /></div>
            <p className="mt-4 text-[13px] text-sepia">“{voice.title}”, resynthesised from the pitch of a concert recording (not the original audio). {voice.source}.</p>
          </div>
        </section>
      )}

      {m && <section className="bg-paper2/70 px-6 py-28 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-16 lg:grid-cols-[1fr_1.2fr]">
          <Reveal>
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">How real singers use it</div>
            <h2 className="mt-4 font-display text-[clamp(44px,5vw,80px)] leading-[0.95]">Where the time goes</h2>
            <p className="mt-6 max-w-[42ch] text-[18px] leading-[1.6] text-sepia">Share of time spent on each note, measured from {m.recordings} concert recordings, next to the model's {data.pieces.filter((p) => p.raga === raga.key && p.model === "v2").length} pieces.</p>
          </Reveal>
          <div className="space-y-4">
            {raga.notes.map((pc, i) => {
              const real = m.pc[pc], model = m.models.v2.pc[pc];
              return (
                <Reveal key={pc} delay={i * 0.06} className="grid grid-cols-[3.5rem_1fr_7rem] items-center gap-4">
                  <span className="text-[18px]">{NAMES[SWARAS[pc]]}</span>
                  <div className="relative h-9">
                    <div className="absolute inset-y-0 left-0 border border-kajal/70 bg-kajal/10" style={{ width: `${real * 220}%` }} />
                    <div className="absolute left-0 top-1/2 h-2 -translate-y-1/2 bg-gulal" style={{ width: `${model * 220}%` }} />
                  </div>
                  <span className="text-right font-sans tabular-nums text-sepia"><span className="text-kajal">{Math.round(real * 100)}%</span> · <span className="text-gulal">{Math.round(model * 100)}%</span></span>
                </Reveal>
              );
            })}
            <div className="pt-2 font-sans text-[14px] text-sepia"><span className="text-kajal">outline: real singers</span> · <span className="text-gulal">light red: the model</span></div>
          </div>
        </div>
      </section>}

      {rec && (
        <section className="px-6 pb-4 pt-28 sm:px-10">
          <div className="mx-auto max-w-[1400px]">
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Hear it sung</div>
            <div className="mt-2 font-display text-[clamp(36px,4vw,60px)] leading-none">The newest model's {raga.name}</div>
            <div className="leaf-card mt-6 flex flex-wrap items-center gap-4 border border-rule p-5">
              {(["vocal", "expressive"] as const).map((v) => rec.files[v] && (
                <button key={v} onClick={() => playRec(v)} className={`rounded-full px-5 py-2.5 text-[15px] text-paper ${recOn === v ? "bg-sindoor" : "bg-kajal"}`}>{recOn === v ? "■ Stop" : v === "vocal" ? "▶ The voice" : "▶ The flute"}</button>
              ))}
              <span className="text-[14px] text-sepia">{rec.bars} bars · {rec.tempo} bpm · the notes exactly as it wrote them, sung with breaths and ornaments measured from real singers</span>
              <audio ref={recAudio} onEnded={() => setRecOn(null)} preload="none" />
            </div>
            <p className="mt-3 max-w-[90ch] text-[13px] text-sepia">Voice: {data.latest.voices.vocal}.</p>
          </div>
        </section>
      )}

      {data.evolution.some((s) => s.raga === raga.key) && (
        <section className="px-6 pt-20 sm:px-10">
          <div className="mx-auto max-w-[1400px]">
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">How it learned {raga.name}</div>
            <div className="mt-2 font-display text-[clamp(36px,4vw,60px)] leading-none">Five stages of training</div>
            <div className="mt-6"><Evolution data={data} raga={raga.key} /></div>
          </div>
        </section>
      )}

      <section className="px-6 py-28 sm:px-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">The newest model's best {raga.name} · 16 bars · sung by your browser</div>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">{newest.map((t) => <PieceCard key={t.id} track={t} queue={newest} />)}</div>
          {pieces.length > 0 && <>
            <div className="mt-16 text-[12px] uppercase tracking-[0.24em] text-sepia">An earlier model (v2) · 8 bars</div>
            <div className="mt-8 grid gap-5 lg:grid-cols-3">{pieces.map((t) => <PieceCard key={t.id} track={t} queue={pieces} />)}</div>
          </>}
        </div>
      </section>

      <Link href={`/ragas/${next.key}`} data-cursor="Next" className="group block bg-gulal px-6 py-24 text-kajal sm:px-10">
        <div className="mx-auto max-w-[1400px]">
          <div className="font-sans text-[12px] uppercase tracking-[0.24em] text-kajal/60">Next raga</div>
          <div className="mt-2 font-display text-[clamp(72px,14vw,240px)] leading-[0.85] transition-transform duration-700 ease-out group-hover:translate-x-6">{next.name} →</div>
        </div>
      </Link>
      <Footer />
    </main>
  );
}
