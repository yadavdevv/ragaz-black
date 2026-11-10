"use client";

import { useMemo, useState } from "react";
import { Magnetic } from "@/components/Magnetic";
import { Miniature } from "@/components/Miniature";
import { FloralBand, Rubric } from "@/components/Ornament";
import { Ridgeline } from "@/components/Ridgeline";
import { RiseChars } from "@/components/Text";
import { type Data, type Track, pieceTrack, play, useSite } from "@/lib/site";

export function Hero({ data }: { data: Data }) {
  const [hover, setHover] = useState<Track | null>(null);
  const tracks = useMemo(() => {
    const by = (k: string, m: string) => data.pieces.filter((p) => p.raga === k && p.model === m);
    const lists = ["v2", "v1"].flatMap((m) => ["bhupali", "yaman", "malkauns"].map((k) => by(k, m)));
    const out = [];
    for (let i = 0; out.length < 30; i++) for (const l of lists) if (l[i] && out.length < 30) out.push(pieceTrack(l[i]));
    return out;
  }, [data]);
  const best = useMemo(() => pieceTrack([...data.pieces].filter((p) => p.model === "v2" && p.raga === "yaman").sort((a, b) => b.reward - a.reward)[0]), [data]);

  return (
    <section className="relative overflow-hidden pt-20">
      <div className="mx-auto grid min-h-[calc(100svh-5rem)] max-w-[1500px] items-center gap-10 px-6 pb-10 sm:px-10 lg:grid-cols-[1fr_1.05fr]">
        <div className="order-2 lg:order-1">
          <Rubric>A language model that composes Hindustani ragas</Rubric>
          <h1 className="mt-6 font-display text-[clamp(56px,8.4vw,150px)] leading-[0.9] tracking-[-0.01em] text-kajal">
            <RiseChars text="Ragas, written" delay={300} />
            <br />
            <span className="italic text-sindoor"><RiseChars text="by a machine." delay={700} /></span>
          </h1>
          <p className="mt-8 max-w-[38ch] text-[20px] leading-[1.55] text-sepia">
            It was given only a raga's name, scored by a program that knows the rules, then measured against real singers. Every ripple in the painting's pond is a piece it wrote.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Magnetic variant="solid" size="lg" cursor="Play" onClick={() => { useSite.getState().set({ queue: tracks }); play(best, { open: true }); }}>▶ Play a raga</Magnetic>
            <Magnetic variant="line" size="lg" href="/ragas#library" cursor="Open">Browse 144 pieces</Magnetic>
          </div>
        </div>

        <div className="relative order-1 lg:order-2">
          <Miniature title={`राग · ${hover?.title.split(" no.")[0] ?? "रचना"}`} className="mx-auto w-full max-w-[min(560px,64svh)] -rotate-[0.6deg] drop-shadow-[0_34px_40px_rgba(19,26,43,.3)]">
            <Ridgeline tracks={tracks.slice(0, 18)} onHover={setHover} tilt={false} band={[0.14, 0.9]} />
          </Miniature>
          <div className={`mt-4 text-center transition-all duration-500 ${hover ? "opacity-100" : "opacity-0"}`}>
            <span className="font-display text-[22px] text-sindoor">{hover?.title ?? "\u00a0"}</span>
          </div>
          <div className="mt-1 text-center font-sans text-[13px] text-sepia">the ripples in the pond are pieces it wrote · touch one to hear it</div>
        </div>
      </div>
      <FloralBand />
    </section>
  );
}
