"use client";

import { useMemo } from "react";
import { Bhatkhande } from "@/components/Bhatkhande";
import { Folio, Hashiya, Rubric } from "@/components/Ornament";
import { ScrollWords } from "@/components/Text";
import { type Data, pieceTrack, toggle, useSite } from "@/lib/site";
import { usePlayhead } from "@/lib/usePlayhead";

export function Statement({ data }: { data: Data }) {
  const track = useMemo(() => pieceTrack([...data.latest.pieces].filter((p) => p.raga === "bhupali").sort((a, b) => b.reward - a.reward)[0]), [data]);
  const head = usePlayhead(track.notes);
  const on = useSite((s) => s.playing && s.track?.id === track.id);
  const beats = Math.ceil(track.notes[track.notes.length - 1].t + track.notes[track.notes.length - 1].d);
  return (
    <section className="relative">
      <div className="mx-auto max-w-[1400px] px-6 pb-24 pt-28 sm:px-10">
        <div className="flex items-center gap-4"><Folio n={1} /><Rubric>What this is</Rubric></div>
        <ScrollWords className="mt-8 max-w-[24ch] font-display text-[clamp(38px,5.6vw,88px)] leading-[1.08] text-kajal" dim={0.14}>
          {`A small language model that writes *ragas, ${data.latest.bars} bars at a time, from nothing but the raga's name. It learned by being *scored by a program that knows the rules, then by listening to *real singers.`}
        </ScrollWords>
        <div className="mt-16 grid gap-10 text-[18px] leading-[1.65] text-sepia sm:grid-cols-3">
          <p><span className="font-display text-[22px] text-kajal">A raga</span> is a set of notes with a grammar: which notes are allowed, which to dwell on, and the phrase that makes it recognisable.</p>
          <p><span className="font-display text-[22px] text-kajal">The model</span> writes sargam (Sa Re Ga Pa…), four beats to a bar. Your browser sings what it wrote.</p>
          <p><span className="font-display text-[22px] text-kajal">Every piece</span> on this site was written by it. None are hand-picked to sound better than they are.</p>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] px-6 pb-32 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Rubric>How it writes</Rubric>
            <div className="mt-3 font-display text-[clamp(32px,4vw,56px)] leading-none text-kajal">In Bhatkhande's notation</div>
            <p className="mt-4 max-w-[58ch] text-[17px] leading-[1.6] text-sepia">The model writes the sargam V. N. Bhatkhande standardised a century ago. Here is one of its Bhupalis, set the way his books set a composition: ऽ holds a note, × marks the first beat of the cycle, and the tabla's theka runs above.</p>
          </div>
          <button data-cursor={on ? "Stop" : "Play"} onClick={() => toggle(track)} className="rounded-full border border-kajal/25 px-6 py-3 font-sans text-[15px] transition hover:bg-kajal hover:text-paper">{on ? "❚❚ Stop" : "▶ Play it"}</button>
        </div>
        <Hashiya className="mt-10">
          <div className="leaf-card px-4 py-6 sm:px-8">
            <Bhatkhande notes={track.notes} beats={beats} head={on ? head : null} />
          </div>
        </Hashiya>
      </div>
    </section>
  );
}
