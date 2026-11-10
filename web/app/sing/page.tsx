"use client";

// Sing to it: hum over the tanpura, see your line written as sargam, hear which raga it lives in,
// and get an answer back in that raga. Pitch tracking, transcription and the reading all run here
// in the browser; no audio leaves the page.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bhatkhande } from "@/components/Bhatkhande";
import { Footer } from "@/components/Footer";
import { Magnetic } from "@/components/Magnetic";
import { FloralBand } from "@/components/Ornament";
import { RiseChars } from "@/components/Text";
import { getEngine } from "@/lib/audio";
import { type Frame, type Held, Mic, type Reader, read, strayNotes, tellingNotes, token, transcribe } from "@/lib/listen";
import { type Note, type Raga, SWARAS } from "@/lib/music";
import { tick, useData } from "@/lib/site";

const NAMES: Record<string, string> = { S: "Sa", r: "komal Re", R: "Re", g: "komal Ga", G: "Ga", m: "Ma", M: "tivra Ma", P: "Pa", d: "komal Dha", D: "Dha", n: "komal Ni", N: "Ni" };
const WEST = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const SECONDS = 12, MIN_SECONDS = 4;
const SA_LOW = 110, SA_HIGH = 330;
const RANGE: [number, number] = [-7, 17]; // semitones around Sa shown on the staff

const west = (hz: number) => {
  const m = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${WEST[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
};
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Held notes laid out one per beat, so the Bhatkhande sheet can print them (your rhythm is free). */
const asBeats = (held: Held[]): Note[] => held.map((n, i) => ({ s: SWARAS[n.pc], o: Math.max(-1, Math.min(1, n.octave)), t: i, d: 1, bar: Math.floor(i / 4), ok: true }));
/** The same notes with their sung durations, for playing your line back (1 beat = 1 s at 60 bpm). */
const asSung = (held: Held[]): Note[] => {
  const t0 = held[0]?.start ?? 0;
  return held.map((n) => ({ s: SWARAS[n.pc], o: Math.max(-1, Math.min(1, n.octave)), t: n.start - t0, d: Math.min(n.duration, 2.5), bar: 0, ok: true }));
};

/** A drone before we know the raga: Sa–Pa, the default tuning. */
const droneRaga = (tanpura = "P", key = "sing") => ({ key, tanpura }) as unknown as Raga;

type Phase = "tune" | "listening" | "reading";
type Cousin = { key: string; kind: "tune" | "scale"; title: string; from: string; credit: string | null; swaras: string[]; same_notes: string[]; heard: string[]; notes: Note[] };
type Turn = { held: Held[]; raga: string; answer: Note[] | null };

export default function Sing() {
  const data = useData();
  const [reader, setReader] = useState<Reader | null>(null);
  const [sa, setSa] = useState(146.83);
  const [phase, setPhase] = useState<Phase>("tune");
  const [drone, setDroneOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState<Held[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Note[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [live, setLive] = useState<{ raga: string; share: number }[]>([]);
  const [cousins, setCousins] = useState<Cousin[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [trace, setTrace] = useState<Frame[]>([]);
  const mic = useRef<Mic | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    fetch("/data/reader.json").then((r) => r.json()).then(setReader);
    fetch("/data/cousins.json").then((r) => r.json()).then(setCousins);
    return () => {
      mic.current?.stop();
      cancelAnimationFrame(raf.current);
      const eng = getEngine();
      eng.stopPiece();
      eng.stopDrone(0.6);
    };
  }, []);

  const startDrone = useCallback(async (tanpura = "P", key = "sing") => {
    const eng = getEngine();
    await eng.resume();
    eng.retune(droneRaga(tanpura, key), sa);
    if (!eng.droneOn) {
      eng.tune(droneRaga(tanpura, key), sa);
      eng.startDrone(1.2);
    }
    setDroneOn(true);
  }, [sa]);

  const stopDrone = () => {
    getEngine().stopDrone(1);
    setDroneOn(false);
  };

  // Retune the drone live while the slider moves.
  useEffect(() => {
    if (drone && phase === "tune") getEngine().retune(droneRaga(), sa);
  }, [sa, drone, phase]);

  const finish = useCallback(() => {
    const m = mic.current;
    if (!m) return;
    m.stop();
    cancelAnimationFrame(raf.current);
    const notes = transcribe(m.frames, sa);
    setTrace(m.frames.slice());
    setHeld(notes);
    setPhase("reading");
    mic.current = null;
  }, [sa]);

  const draw = useCallback(() => {
    const m = mic.current, c = canvas.current;
    if (!m || !c) return;
    const ctx = c.getContext("2d")!;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    const y = (semi: number) => h - ((semi - RANGE[0]) / (RANGE[1] - RANGE[0])) * h;
    // The staff: Sa and Pa in each octave, faint lines for the rest.
    ctx.font = `${Math.round(h / 26)}px Newsreader, serif`;
    for (let s = RANGE[0]; s <= RANGE[1]; s++) {
      const pc = ((s % 12) + 12) % 12;
      const strong = pc === 0 || pc === 7;
      ctx.strokeStyle = strong ? "rgba(19,26,43,.28)" : "rgba(19,26,43,.07)";
      ctx.lineWidth = strong ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(48, y(s)); ctx.lineTo(w, y(s)); ctx.stroke();
      if (strong) {
        ctx.fillStyle = "rgba(19,26,43,.55)";
        ctx.fillText(`${pc === 0 ? "Sa" : "Pa"}${s >= 12 ? "′" : s < 0 ? "," : ""}`, 6, y(s) + 5);
      }
    }
    const t = m.frames.length ? m.frames[m.frames.length - 1].t : 0;
    const x = (ft: number) => 48 + (ft / SECONDS) * (w - 60);
    // Held notes so far, in sindoor, under the ink line.
    for (const n of transcribe(m.frames, sa)) {
      const semi = n.pc + 12 * n.octave;
      ctx.fillStyle = "rgba(178,58,34,.22)";
      ctx.fillRect(x(n.start), y(semi) - 5, Math.max(3, x(n.start + n.duration) - x(n.start)), 10);
    }
    // The voice itself, as one ink line that lifts where you breathe.
    ctx.strokeStyle = "#131A2B";
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let pen = false;
    for (const f of m.frames) {
      if (f.hz <= 0) { pen = false; continue; }
      const semi = 12 * Math.log2(f.hz / sa);
      if (semi < RANGE[0] - 1 || semi > RANGE[1] + 1) { pen = false; continue; }
      if (pen) ctx.lineTo(x(f.t), y(semi));
      else ctx.moveTo(x(f.t), y(semi));
      pen = true;
    }
    ctx.stroke();
    setElapsed(t);
    if (reader && m.frames.length % 30 === 0) {
      const sofar = transcribe(m.frames, sa);
      if (sofar.length >= 3) setLive(read(sofar, reader).slice(0, 3));
    }
    if (t >= SECONDS) return finish();
    raf.current = requestAnimationFrame(draw);
  }, [sa, finish, reader]);

  const begin = useCallback(async () => {
    tick();
    setError(null);
    if (phase === "reading" && held.length >= 3 && ranked[0]) setTurns((t) => [...t, { held, raga: ranked[0].raga, answer }]);
    setAnswer(null);
    setHeld([]);
    setLive([]);
    try {
      await startDrone();
      const eng = getEngine();
      const m = new Mic(eng.ctx);
      await m.start();
      mic.current = m;
      if (process.env.NODE_ENV !== "production") Object.assign(window, { __mic: m, __ctx: eng.ctx }); // read by the headless browser test
      setElapsed(0);
      setPhase("listening");
      const c = canvas.current;
      if (c) {
        const r = c.getBoundingClientRect();
        c.width = r.width * devicePixelRatio;
        c.height = r.height * devicePixelRatio;
      }
      raf.current = requestAnimationFrame(draw);
    } catch {
      setError("The microphone isn't available. Allow it in your browser's site settings and try again.");
      setPhase("tune");
    }
  }, [startDrone, draw, phase, held, answer]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranked = useMemo(() => (reader && held.length >= 3 ? read(held, reader) : []), [reader, held]);
  const top = ranked[0];
  const topRaga = top && reader ? reader.ragas[top.raga] : null;
  const knows = useMemo(() => new Set(data?.latest.pieces.map((p) => p.raga) ?? []), [data]);

  // Once we have a reading: the drone retunes to that raga (Marwa's tanpura is tuned to Ni).
  useEffect(() => {
    if (phase === "reading" && topRaga && drone) getEngine().retune(droneRaga(topRaga.tanpura, top.raga), sa);
  }, [phase, topRaga, top, drone, sa]);

  /** A two-bar answer from the newest model's pieces in this raga, starting near the note you ended on. */
  const pickAnswer = useCallback(() => {
    if (!data || !top || !held.length) return null;
    const last = held[held.length - 1];
    const lastSemi = last.pc + 12 * last.octave;
    const windows: Note[][] = [];
    for (const p of data.latest.pieces.filter((x) => x.raga === top.raga)) {
      for (let b = 0; b + 2 <= p.bars; b += 2) {
        const ns = p.notes.filter((n) => n.t >= b * 4 && n.t < (b + 2) * 4);
        if (ns.length >= 4) windows.push(ns.map((n) => ({ ...n, t: n.t - b * 4, bar: n.bar - b })));
      }
    }
    if (!windows.length) return null;
    const dist = (w: Note[]) => Math.abs(SWARAS.indexOf(w[0].s) + 12 * w[0].o - lastSemi);
    const best = Math.min(...windows.map(dist));
    const near = windows.filter((w) => dist(w) <= best + 1);
    return near[Math.floor(Math.random() * near.length)];
  }, [data, top, held]);

  const playNotes = async (notes: Note[], tempo: number, which: string) => {
    tick();
    await startDrone(topRaga?.tanpura, top?.raga);
    const eng = getEngine();
    eng.timbre = "voice";
    eng.onEnd = () => setPlaying(null);
    eng.play(notes, tempo, `sing-${which}`);
    setPlaying(which);
  };

  /** The answer: the composer's phrase in the raga, sung over the tanpura, in your key (your Sa). */
  const answerIt = async () => {
    const a = answer ?? pickAnswer();
    if (!a || !top) return;
    setAnswer(a);
    const full = data?.latest.ragas.find((r) => r.key === top.raga);
    if (!full) return playNotes(a, data?.latest.tempo ?? 90, "answer");
    tick();
    const eng = getEngine();
    await eng.resume();
    eng.stopPiece();
    eng.retune(full, sa);
    if (!eng.droneOn) eng.startDrone(1);
    setDroneOn(true);
    eng.timbre = "voice";
    eng.onEnd = () => setPlaying(null);
    eng.play(a, data?.latest.tempo ?? 90, "sing-answer");
    setPlaying("answer");
  };

  const share = async () => {
    if (!topRaga) return;
    tick();
    const blob = await card(held, trace, sa, topRaga.name, topRaga.devanagari, topRaga.time);
    const file = new File([blob], `ragaz-${top.raga}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `I sang ${topRaga.name}`, text: "ragaz-black.vercel.app/sing" }).catch(() => {});
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
    }
  };

  const ev = reader?.evaluation["10s"];
  const shareOf = (k: string) => ranked.find((r) => r.raga === k)?.share ?? 0;
  const telling = top && ranked[1] && reader ? tellingNotes(held, reader.models[top.raga], reader.models[ranked[1].raga]).slice(0, 3) : [];
  const stray = topRaga ? strayNotes(held, topRaga.notes).filter((x) => x.seconds >= 0.3).slice(0, 2) : [];
  const sung = held.reduce((s, n) => s + n.duration, 0);
  const kin = top ? cousins.filter((c) => c.same_notes.includes(top.raga) || c.heard[0] === top.raga).slice(0, 3) : [];

  return (
    <main className="bg-transparent">
      <section className="relative overflow-hidden px-6 pb-10 pt-36 sm:px-10">
        <div className="pointer-events-none absolute -left-40 top-10 h-[640px] w-[640px] rounded-full bg-sindoor/10 blur-[140px]" />
        <div className="relative mx-auto max-w-[1400px]">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Call and answer</div>
          <h1 className="mt-4 font-display text-[clamp(72px,12vw,200px)] leading-[0.85]"><RiseChars text="Sing to it." /></h1>
          <p className="mt-8 max-w-[640px] text-[clamp(18px,2vw,22px)] leading-[1.5] text-kajal/80">
            Hum for ten seconds over the tanpura. It writes your line as sargam, tells you which raga it lives in and why, and answers you in that raga.
          </p>
        </div>
      </section>
      <FloralBand />

      <section className="px-6 pb-24 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[1fr_400px]">
          <div className="space-y-6">
            {/* 1 · your Sa */}
            <div className={`leaf-card border border-rule p-6 transition-opacity ${phase === "listening" ? "opacity-50" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">1 · Find your Sa</div>
                <div className="font-display text-[28px] leading-none">Sa = {west(sa)} <span className="text-[16px] text-kajal/50">{sa.toFixed(0)} Hz</span></div>
              </div>
              <input type="range" min={0} max={1} step={0.001} disabled={phase === "listening"} aria-label="Your Sa"
                value={Math.log(sa / SA_LOW) / Math.log(SA_HIGH / SA_LOW)}
                onChange={(e) => setSa(SA_LOW * (SA_HIGH / SA_LOW) ** Number(e.target.value))}
                className="mt-5 w-full accent-sindoor" />
              <div className="mt-1 flex justify-between text-[12px] text-kajal/50"><span>lower voice</span><span>higher voice</span></div>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Magnetic cursor={drone ? "Stop" : "Listen"} onClick={() => { tick(); drone ? stopDrone() : startDrone(); }}>{drone ? "Stop the tanpura" : "Play the tanpura"}</Magnetic>
                <span className="text-[14px] text-kajal/60">Move the slider until humming the drone&rsquo;s note feels easy. That note is your Sa.</span>
              </div>
            </div>

            {/* 2 · sing */}
            <div className="leaf-card relative overflow-hidden border border-rule p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">2 · Sing</div>
                {phase === "listening" && <div className="text-[14px] tabular-nums text-sindoor">listening · {Math.max(0, SECONDS - elapsed).toFixed(0)} s</div>}
              </div>
              <div className="relative mt-4 h-[300px] sm:h-[360px]">
                <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
                {phase === "listening" && live.length > 0 && reader && (
                  <div className="pointer-events-none absolute right-2 top-1 text-right">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-kajal/45">hearing</div>
                    <div className="font-deva text-[30px] leading-tight text-kajal transition-all">{reader.ragas[live[0].raga].devanagari}</div>
                    <div className="text-[13px] text-kajal/60">{live.map((l) => `${reader.ragas[l.raga].name} ${Math.round(l.share * 100)}%`).join(" · ")}</div>
                  </div>
                )}
                {phase === "reading" && (
                  <button onClick={begin} data-cursor="Sing" className="absolute right-0 top-0 rounded-full bg-sindoor px-5 py-2 text-[14px] text-paper shadow-[0_8px_24px_-10px_rgba(178,58,34,.8)] transition-transform hover:scale-105">Sing again</button>
                )}
                {phase === "tune" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center">
                    <button onClick={begin} data-cursor="Sing" aria-label="Start singing"
                      className="group relative flex h-36 w-36 items-center justify-center rounded-full bg-sindoor text-paper shadow-[0_18px_60px_-18px_rgba(178,58,34,.8)] transition-transform hover:scale-105">
                      <span className="absolute inset-[-10px] rounded-full border border-sindoor/30 transition-transform duration-700 group-hover:scale-110" />
                      <span className="font-display text-[30px]">Sing</span>
                    </button>
                    <span className="max-w-[420px] text-[14px] text-kajal/60">Start on Sa, then wander. Hum, sing &ldquo;aa&rdquo;, or sing sargam. Headphones help. Nothing you sing leaves this page.</span>
                    {error && <span className="text-[14px] text-sindoor">{error}</span>}
                  </div>
                )}
              </div>
              {phase === "listening" && (
                <div className="mt-4 flex items-center gap-4">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper2"><div className="h-full rounded-full bg-sindoor" style={{ width: `${(elapsed / SECONDS) * 100}%` }} /></div>
                  <Magnetic variant="solid" cursor="Done" onClick={() => elapsed >= MIN_SECONDS && finish()}>{elapsed >= MIN_SECONDS ? "Done" : "Keep going…"}</Magnetic>
                </div>
              )}
            </div>

            {/* your line, in Bhatkhande notation */}
            {phase === "reading" && held.length > 0 && (
              <div className="leaf-card border border-rule p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Your line</div>
                  <button onClick={() => playNotes(asSung(held), 60, "mine")} className="text-[15px] underline decoration-kajal/30 underline-offset-4 hover:decoration-kajal">{playing === "mine" ? "playing…" : "Hear it back"}</button>
                </div>
                <Bhatkhande notes={asBeats(held)} beats={Math.ceil(held.length / 4) * 4} theka={false} className="mt-4 text-[22px] sm:text-[26px]" />
                <div className="mt-3 font-mono text-[13px] tracking-wider text-sepia">{held.map(token).join(" ")}</div>
                <div className="mt-2 text-[13px] text-kajal/50">{held.length} held notes over {sung.toFixed(1)} s of singing, one per cell; your own rhythm is free.</div>
              </div>
            )}
          </div>

          {/* 3 · the reading */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="leaf-card relative border border-rule p-7 text-kajal"><span className="pointer-events-none absolute inset-[6px] border border-sindoor/40" />
              <div className="text-[12px] uppercase tracking-[0.24em] text-kajal/50">3 · The reading</div>
              {phase !== "reading" ? (
                <p className="mt-5 text-[18px] leading-[1.5] text-kajal/70">Your raga appears here, with the notes that gave it away.</p>
              ) : !topRaga ? (
                <p className="mt-5 text-[18px] leading-[1.5]">I heard fewer than three held notes. Sing a little longer, holding each note for a moment, and try again.</p>
              ) : (
                <>
                  <div className="mt-4 font-deva text-[64px] leading-[1.05]">{topRaga.devanagari}</div>
                  <div className="font-display text-[34px] leading-none">{topRaga.name}</div>
                  <div className="mt-2 text-[15px] text-kajal/60">{topRaga.time} · {topRaga.rasa}</div>
                  <div className="mt-6 space-y-2">
                    {ranked.slice(0, 3).map((r) => (
                      <div key={r.raga} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-[14px]">
                        <span className={r.raga === top.raga ? "" : "text-kajal/60"}>{reader!.ragas[r.raga].name}</span>
                        <div className="h-1.5 rounded-full bg-paper2"><div className={`h-full rounded-full ${r.raga === top.raga ? "bg-sindoor" : "bg-kajal/40"}`} style={{ width: `${shareOf(r.raga) * 100}%` }} /></div>
                        <span className="text-right tabular-nums text-kajal/60">{Math.round(shareOf(r.raga) * 100)}%</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-6 text-[17px] leading-[1.55]">
                    {telling.length > 0 && <>Your {list(telling.map((t) => NAMES[t.swara]))} {telling.length > 1 ? "point" : "points"} to {topRaga.name} over {reader!.ragas[ranked[1].raga].name}. </>}
                    {stray.length > 0 ? <>{topRaga.name} doesn&rsquo;t use {list(stray.map((s) => NAMES[s.swara]))}; you held {stray.length > 1 ? "them" : "it"} for {stray.reduce((a, s) => a + s.seconds, 0).toFixed(1)} s.</> : <>Every note you held belongs to {topRaga.name}.</>}
                  </p>
                  {kin.length > 0 && (
                    <p className="mt-4 text-[15px] leading-[1.55] text-kajal/75">
                      Its cousins elsewhere: {kin.map((c, i) => (
                        <span key={c.key}>{i > 0 && (i === kin.length - 1 ? " and " : ", ")}<button onClick={() => playNotes(c.notes, c.kind === "tune" ? 100 : 120, c.key)} className="underline decoration-sindoor/40 underline-offset-4 hover:decoration-sindoor">{c.title}</button></span>
                      ))}.
                    </p>
                  )}
                  <div className="mt-6 flex flex-wrap gap-3">
                    {knows.has(top.raga) ? (
                      <Magnetic variant="solid" cursor="Listen" onClick={answerIt}>{playing === "answer" ? "Answering…" : answer ? "Hear the answer again" : "Hear its answer"}</Magnetic>
                    ) : (
                      <span className="text-[14px] leading-[1.5] text-kajal/60">The model hasn&rsquo;t learned {topRaga.name} yet; it arrives with the next composer. It can answer in {list([...knows].map((k) => reader!.ragas[k]?.name ?? k).filter(Boolean))}.</span>
                    )}
                    <Magnetic cursor="Share" onClick={share}>Share</Magnetic>
                  </div>
                  {answer && (
                    <div className="mt-6">
                      <div className="text-[12px] uppercase tracking-[0.24em] text-kajal/50">Its answer</div>
                      <Bhatkhande notes={answer} beats={8} theka={false} className="mt-2 text-[20px]" />
                      <div className="mt-2 text-[13px] text-kajal/50">Two bars from the newest model&rsquo;s {topRaga.name}, starting near the note you ended on, sung over the tanpura in your key.</div>
                    </div>
                  )}
                </>
              )}
            </div>
            {ev && (
              <p className="mt-4 text-[13px] leading-[1.6] text-kajal/60">
                How good is the reading? On concert recordings it never saw, from 10 s of singing it named the right raga {Math.round(ev.top1 * 100)}% of the time, and the right one was in its top three {Math.round(ev.top3 * 100)}% ({ev.windows} excerpts, {Object.keys(reader!.models).length} ragas). Those were trained singers; a casual hum is harder. Learned from the CompMusic raga dataset (CC BY 4.0). Deshkar isn&rsquo;t here: there are no recordings of it to learn from.
              </p>
            )}
          </aside>
        </div>
      </section>

      {turns.length > 0 && reader && (
        <section className="px-6 pb-16 sm:px-10">
          <div className="mx-auto max-w-[1400px]">
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Earlier in this conversation</div>
            <ol className="mt-4 space-y-3">
              {turns.map((t, i) => (
                <li key={i} className="leaf-card grid gap-2 border border-rule p-4 sm:grid-cols-[9rem_1fr_1fr] sm:items-center">
                  <span className="font-display text-[20px]">{reader.ragas[t.raga].name} <span className="font-deva text-kajal/60">{reader.ragas[t.raga].devanagari}</span></span>
                  <button onClick={() => playNotes(asSung(t.held), 60, `turn-${i}`)} className="text-left font-mono text-[13px] tracking-wider text-kajal hover:text-sindoor">you · {t.held.map(token).join(" ")}</button>
                  {t.answer ? (
                    <button onClick={() => playNotes(t.answer!, data?.latest.tempo ?? 90, `turn-a-${i}`)} className="text-left font-mono text-[13px] tracking-wider text-sepia hover:text-sindoor">ragaz · {t.answer.map((n) => ".".repeat(Math.max(0, -n.o)) + n.s + "'".repeat(Math.max(0, n.o))).join(" ")}</button>
                  ) : <span className="text-[13px] text-kajal/40">no answer asked</span>}
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {cousins.length > 0 && reader && (
        <section className="px-6 pb-24 sm:px-10">
          <div className="mx-auto max-w-[1400px]">
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Cousins</div>
            <h2 className="mt-3 font-display text-[clamp(40px,6vw,84px)] leading-[0.95]">Ragas hiding in the world&rsquo;s music.</h2>
            <p className="mt-5 max-w-[720px] text-[17px] leading-[1.55] text-kajal/75">
              The reader has only ever heard Indian concert singers. Played tunes and scales from elsewhere, it still hears ragas in them. &ldquo;Same notes&rdquo; is a plain fact about the scale; &ldquo;hears&rdquo; is the reader&rsquo;s own verdict, and the two don&rsquo;t always agree.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cousins.map((c) => {
                const heard = reader.ragas[c.heard[0]];
                return (
                  <button key={c.key} onClick={() => playNotes(c.notes, c.kind === "tune" ? 100 : 120, c.key)} data-cursor="Listen"
                    className={`leaf-card group relative border p-6 text-left transition-colors ${playing === c.key ? "border-sindoor" : "border-rule hover:border-sindoor/60"}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] uppercase tracking-[0.2em] text-kajal/45">{c.kind === "tune" ? "tune" : "scale"} · {c.from}</span>
                      <span className="text-[13px] text-sindoor">{playing === c.key ? "playing…" : "▶"}</span>
                    </div>
                    <div className="mt-3 font-display text-[28px] leading-tight">{c.title}</div>
                    <div className="mt-2 font-mono text-[13px] tracking-wider text-sepia">{c.swaras.join(" ")}</div>
                    <div className="mt-5 flex items-end justify-between gap-4">
                      <div>
                        <div className="text-[12px] text-kajal/50">the reader hears</div>
                        <div className="font-deva text-[30px] leading-tight">{heard.devanagari}</div>
                        <div className="text-[15px]">{heard.name}</div>
                      </div>
                      <div className="text-right text-[13px] text-kajal/60">{c.same_notes.length ? <>same notes as<br /><span className="text-kajal">{c.same_notes.map((k) => reader.ragas[k]?.name ?? k[0].toUpperCase() + k.slice(1)).join(" and ")}</span></> : "no raga here uses exactly these notes"}</div>
                    </div>
                    {c.credit && <div className="mt-4 text-[12px] leading-[1.5] text-kajal/45">{c.credit}</div>}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      )}
      <Footer />
    </main>
  );
}

/** A shareable card: your own voice line drawn in ink, your notes in Devanagari sargam, and the
 *  raga it lives in, on paper. No two are alike. */
async function card(held: Held[], trace: Frame[], sa: number, name: string, deva: string, time: string): Promise<Blob> {
  const DEVA: Record<string, string> = { S: "सा", r: "रे", R: "रे", g: "ग", G: "ग", m: "म", M: "म", P: "प", d: "ध", D: "ध", n: "नि", N: "नि" };
  await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = 1080; c.height = 1350;
  const x = c.getContext("2d")!;
  x.fillStyle = "#F1E6CF"; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = "#B23A22"; x.lineWidth = 3; x.strokeRect(48, 48, c.width - 96, c.height - 96);
  x.strokeStyle = "rgba(178,58,34,.4)"; x.lineWidth = 1.5; x.strokeRect(64, 64, c.width - 128, c.height - 128);
  x.fillStyle = "#131A2B"; x.textAlign = "center";
  x.font = "28px Newsreader, serif"; x.fillText("I sang", 540, 230);
  x.font = "150px 'Tiro Devanagari Hindi', serif"; x.fillText(deva, 540, 420);
  x.font = "64px 'Tiro Devanagari Hindi', serif"; x.fillText(name, 540, 510);
  x.fillStyle = "rgba(19,26,43,.6)"; x.font = "28px Newsreader, serif"; x.fillText(time, 540, 565);
  // Your voice, as one ink line: pitch against time, lifting where you breathed.
  const voiced = trace.filter((f) => f.hz > 0);
  if (voiced.length > 2) {
    const semis = voiced.map((f) => 12 * Math.log2(f.hz / sa));
    const lo = Math.min(...semis) - 1, hi = Math.max(...semis) + 1;
    const t0 = trace[0].t, t1 = trace[trace.length - 1].t || 1;
    const X = (t: number) => 140 + ((t - t0) / (t1 - t0)) * 800, Y = (s: number) => 900 - ((s - lo) / Math.max(6, hi - lo)) * 240;
    x.strokeStyle = "rgba(19,26,43,.12)"; x.lineWidth = 1;
    for (let s = Math.ceil(lo); s <= hi; s++) if ((((s % 12) + 12) % 12) === 0) { x.beginPath(); x.moveTo(120, Y(s)); x.lineTo(960, Y(s)); x.stroke(); }
    for (const n of held) {
      x.fillStyle = "rgba(178,58,34,.28)";
      x.fillRect(X(n.start), Y(n.pc + 12 * n.octave) - 7, Math.max(4, X(n.start + n.duration) - X(n.start)), 14);
    }
    x.strokeStyle = "#131A2B"; x.lineWidth = 4; x.lineJoin = "round"; x.lineCap = "round";
    x.beginPath();
    let pen = false;
    for (const f of trace) {
      if (f.hz <= 0) { pen = false; continue; }
      const s = 12 * Math.log2(f.hz / sa);
      if (pen) x.lineTo(X(f.t), Y(s)); else x.moveTo(X(f.t), Y(s));
      pen = true;
    }
    x.stroke();
  }
  // The line, eight notes to a row.
  x.fillStyle = "#131A2B"; x.font = "46px 'Tiro Devanagari Hindi', serif";
  const notes = held.slice(0, 16);
  for (let r = 0; r < Math.ceil(notes.length / 8); r++) {
    const row = notes.slice(r * 8, r * 8 + 8);
    row.forEach((n, i) => {
      const s = SWARAS[n.pc];
      const cx = 540 + (i - (row.length - 1) / 2) * 110, cy = 1010 + r * 95;
      x.fillText(DEVA[s], cx, cy);
      if ("rgdn".includes(s)) x.fillRect(cx - 24, cy + 12, 48, 3);
      if (s === "M") x.fillRect(cx - 1.5, cy - 70, 3, 18);
      if (n.octave > 0) { x.beginPath(); x.arc(cx, cy - 62, 6, 0, 7); x.fill(); }
      if (n.octave < 0) { x.beginPath(); x.arc(cx, cy + 32, 6, 0, 7); x.fill(); }
    });
  }
  x.fillStyle = "#B23A22"; x.font = "30px Newsreader, serif"; x.fillText("ragaz-black.vercel.app/sing", 540, 1230);
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}
