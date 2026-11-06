"use client";

// A bandish the model composed, words and notes together: the Bhatkhande sheet with the words
// printed under their beats, playable, with how it was chosen and how it scored.

import { useState } from "react";
import { getEngine } from "@/lib/audio";
import type { Note, Raga } from "@/lib/music";
import { tick } from "@/lib/site";
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

export function BandishCard({ b, raga, tempo, title }: { b: Bandish; raga: Raga; tempo: number; title: string }) {
  const [playing, setPlaying] = useState(false);
  const head = usePlayhead(b.notes);
  const words = b.bol.map((t) => (t === "-" ? "" : t));
  const play = async () => {
    tick();
    const eng = getEngine();
    await eng.resume();
    if (playing) {
      eng.stopPiece();
      eng.stopDrone(1);
      setPlaying(false);
      return;
    }
    eng.retune(raga);
    if (!eng.droneOn) { eng.tune(raga); eng.startDrone(1); }
    eng.timbre = "voice";
    eng.onEnd = () => { setPlaying(false); eng.stopDrone(2); };
    eng.play(b.notes, tempo, `bandish-${b.raga}-${b.task}`);
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
        <button onClick={play} data-cursor={playing ? "Stop" : "Listen"} className="rounded-full bg-sindoor px-5 py-2 text-[14px] text-paper transition-transform hover:scale-105">{playing ? "❚❚ Stop" : "▶ Sing it"}</button>
      </div>
      <Bhatkhande notes={b.notes} beats={b.beats} head={head} words={words} theka={false} className="mt-5" />
      <p className="mt-4 text-[13px] leading-[1.6] text-kajal/55">
        {b.task === "free" ? "Words and notes both written by the model." : `The model composed the melody for these words${b.source ? ` (${b.source.split(":")[0]})` : ""}.`}{" "}
        Chosen as the {b.selection}: raga {pct(b.scores.raga)}, syllables on notes {pct(b.scores.aligned)}{b.task === "set" ? `, words kept ${pct(b.scores.fidelity)}` : `, real words ${pct(b.scores.known)}`}, mukhda on sam {b.scores.mukhda ? "✓" : "✕"}. The voice sings &ldquo;aa&rdquo;; the words light up in time.
      </p>
    </div>
  );
}
