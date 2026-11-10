"use client";

import { useMemo, useRef } from "react";
import { Magnetic } from "@/components/Magnetic";
import { PieceCard } from "@/components/PieceCard";
import { Folio, Rubric } from "@/components/Ornament";
import { Reveal } from "@/components/Text";
import { type Data, pieceTrack } from "@/lib/site";

export function ListenRail({ data }: { data: Data }) {
  const tracks = useMemo(() => {
    const out = [];
    // The newest model's best piece in each raga it knows.
    for (const r of data.latest.ragas) out.push(...data.latest.pieces.filter((p) => p.raga === r.key).sort((a, b) => b.reward - a.reward).slice(0, 1));
    return out.map((p) => pieceTrack(p));
  }, [data]);
  const rail = useRef<HTMLDivElement>(null);
  // drag to scroll
  const drag = useRef({ on: false, x: 0, left: 0, moved: false });

  return (
    <section className="relative overflow-hidden py-28">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-6 px-6 sm:px-10">
        <Reveal>
          <div className="flex items-center gap-4"><Folio n={5} /><Rubric>Listen</Rubric></div>
          <h2 className="mt-6 font-display text-[clamp(46px,6.4vw,104px)] leading-[0.95] text-kajal">Each piece has<br /><span className="italic text-sindoor">a shape.</span></h2>
          <p className="mt-6 max-w-[42ch] text-[19px] leading-[1.6] text-sepia">The line is the melody: time runs left to right, pitch rises and falls. Press any card to hear it and watch the line light up as it plays.</p>
        </Reveal>
        <Magnetic href="/ragas#library" cursor="Open">All {data.pieces.length + data.latest.pieces.length} pieces →</Magnetic>
      </div>
      <div
        ref={rail}
        className="no-scrollbar mt-16 flex cursor-grab gap-5 overflow-x-auto px-6 pb-4 active:cursor-grabbing sm:px-10"
        onPointerDown={(e) => { drag.current = { on: true, x: e.clientX, left: rail.current!.scrollLeft, moved: false }; }}
        onPointerMove={(e) => {
          if (!drag.current.on) return;
          const dx = e.clientX - drag.current.x;
          if (Math.abs(dx) > 4) drag.current.moved = true;
          rail.current!.scrollLeft = drag.current.left - dx;
        }}
        onPointerUp={() => (drag.current.on = false)}
        onPointerLeave={() => (drag.current.on = false)}
        onClickCapture={(e) => { if (drag.current.moved) { e.stopPropagation(); drag.current.moved = false; } }}
      >
        {tracks.map((t) => (
          <div key={t.id} className="w-[min(82vw,440px)] shrink-0"><PieceCard track={t} queue={tracks} /></div>
        ))}
      </div>
    </section>
  );
}
