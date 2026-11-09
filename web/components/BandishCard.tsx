"use client";

// A bandish the model composed, words and notes together: the Bhatkhande sheet with the words
// printed under their beats, playable, with how it was chosen and how it scored.

import { useEffect, useRef, useState } from "react";
import { getEngine } from "@/lib/audio";
import type { Note, Raga } from "@/lib/music";
import type { Lyric } from "@/lib/phones";
import { tick } from "@/lib/site";
import { arrange, pieceFor, produce, themeFor } from "@/lib/studio";
import { usePlayhead } from "@/lib/usePlayhead";
import { Bhatkhande } from "./Bhatkhande";

export type Bandish = {
  raga: string;
  task: "free" | "set";
  words: string | null;
  source: string | null;
  text: string;
  reward: number;
  scores: Record<string, number>;
  selection: string;
  beats: number;
  bol: string[];
  notes: Note[];
};

/** Syllables and the beats they start on, from a bol line (two in one beat: the second half-way). */
export function lyricsOf(bol: string[]): Lyric[] {
  const out: Lyric[] = [];
  bol.forEach((tok, b) => {
    if (tok === "-" || tok === "ऽ") return;
    const parts = tok.split("·").filter(Boolean);
    parts.forEach((syl, i) => out.push({ t: b + i / parts.length, syl }));
  });
  return out;
}

/** Plays produced by default (the studio, in the raga's theme); "voice" plays the bare voice. */
export function BandishCard({ b, raga, tempo, title, pool = [] }: { b: Bandish; raga: Raga; tempo: number; title: string; pool?: Note[][] }) {
  const [playing, setPlaying] = useState(false);
  const [produced, setProduced] = useState(true);
  const [studioHead, setStudioHead] = useState<number | null>(null);
  const handle = useRef<ReturnType<typeof produce> | null>(null);
  const raf = useRef(0);
  const voiceHead = usePlayhead(b.notes);
  const head = produced ? studioHead : voiceHead;
  const theme = themeFor(raga.key);
  useEffect(() => () => { handle.current?.stop(); cancelAnimationFrame(raf.current); }, []);
  const bol = b.bol.map((t) => (t === "-" ? "" : t));
  const play = async () => {
    tick();
    const eng = getEngine();
    await eng.resume();
    if (playing) {
      eng.stopPiece();
      eng.stopDrone(1);
      handle.current?.stop();
      handle.current = null;
      cancelAnimationFrame(raf.current);
      setStudioHead(null);
      setPlaying(false);
      return;
    }
    if (produced) {
      const piece = pieceFor(b, raga, pool, b.raga.length);
      const arr = arrange(piece);
      const h = produce(eng.ctx, eng.ctx.destination, piece, theme);
      handle.current = h;
      setPlaying(true);
      const loop = () => {
        const t = eng.ctx.currentTime;
        if (t > h.end) { setPlaying(false); setStudioHead(null); return; }
        setStudioHead(arr.toSheet((t - h.t0) / h.beat));
        raf.current = requestAnimationFrame(loop);
      };
      loop();
      return;
    }
    eng.retune(raga);
    if (!eng.droneOn) { eng.tune(raga); eng.startDrone(1); }
    eng.timbre = "voice";
    eng.onEnd = () => { setPlaying(false); eng.stopDrone(2); };
    eng.play(b.notes, tempo, `bandish-${b.raga}-${b.task}`, lyricsOf(b.bol));
    setPlaying(true);
  };
  const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;
  return (
    <div className="leaf-card border border-rule p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">{title}</div>
          <div className="mt-1 font-display text-[24px]">{raga.name} <span className="font-deva text-kajal/60">{raga.devanagari}</span></div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-full border border-rule p-1 text-[13px]">
            {([true, false] as const).map((w) => <button key={String(w)} disabled={playing} onClick={() => { tick("soft"); setProduced(w); }} className={`rounded-full px-3 py-1 ${produced === w ? "bg-kajal text-paper" : "text-kajal"}`}>{w ? `produced · ${theme.name}` : "voice"}</button>)}
          </div>
          <button onClick={play} data-cursor={playing ? "Stop" : "Listen"} className="rounded-full bg-sindoor px-5 py-2 text-[14px] text-paper transition-transform hover:scale-105">{playing ? "❚❚ Stop" : "▶ Sing it"}</button>
        </div>
      </div>
      <Bhatkhande notes={b.notes} beats={b.beats} head={head} words={bol} theka={false} className="mt-5" />
      <p className="mt-4 text-[13px] leading-[1.6] text-kajal/55">
        {b.task === "free" ? "Words and notes both written by the model." : `The model composed the melody for these words${b.source ? ` (${b.source.split(":")[0]})` : ""}.`}{" "}
        Chosen as the {b.selection}: raga {pct(b.scores.raga)}, syllables on notes {pct(b.scores.aligned)}{b.task === "set" ? `, words kept ${pct(b.scores.fidelity)}` : `, real words ${pct(b.scores.known)}`}, mukhda on sam {b.scores.mukhda ? "✓" : "✕"}. Produced in {raga.name}&rsquo;s theme, {theme.name} (the full studio is at /studio); the voice sings the words roughly, from a simple formant voice.
      </p>
    </div>
  );
}
