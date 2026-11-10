"use client";

import { Tabla, Tanpura } from "@/components/Instruments";
import { Folio, Rubric } from "@/components/Ornament";
import { Magnetic } from "@/components/Magnetic";
import { Reveal } from "@/components/Text";

/** The instruments around the melody: the drone it is measured from, and the cycle it moves in. */
export function Ensemble() {
  return (
    <section className="relative overflow-hidden py-28">
      <div className="mx-auto max-w-[1400px] px-6 sm:px-10">
        <Reveal>
          <div className="flex items-center gap-4"><Folio n={4} /><Rubric>The ensemble</Rubric></div>
          <h2 className="mt-6 max-w-[18ch] font-display text-[clamp(46px,6.4vw,104px)] leading-[0.95] text-kajal">A melody never <span className="italic text-sindoor">sings alone.</span></h2>
        </Reveal>
        <div className="mt-10 grid items-center gap-16 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="grid items-end gap-6 sm:grid-cols-[minmax(0,210px)_1fr] sm:gap-8">
            <Tanpura className="mx-auto h-[min(62svh,520px)] w-[min(55vw,200px)] sm:h-[min(78svh,640px)] sm:w-full" />
            <div className="sm:pb-10">
              <div className="font-display text-[44px] leading-none text-kajal">Tanpura</div>
              <div className="mt-1 font-display text-[24px] text-sepia">तानपूरा</div>
              <p className="mt-5 text-[18px] leading-[1.6] text-sepia">Four strings, plucked in turn forever: Pa, Sa, Sa, low Sa. It plays no melody; it is the ground every note is heard against.</p>
              <p className="mt-4 font-sans text-[14px] text-sindoor">Sweep across its strings.</p>
              <p className="mt-4 text-[15px] leading-[1.55] text-sepia">Every piece on this site plays over a synthesised tanpura, and the model's notes are tuned to it.</p>
            </div>
          </div>
          <div>
            <Tabla />
            <div className="mt-8 grid gap-6 sm:grid-cols-[auto_1fr]">
              <div>
                <div className="font-display text-[44px] leading-none text-kajal">Tabla</div>
                <div className="mt-1 font-display text-[24px] text-sepia">तबला</div>
              </div>
              <p className="text-[18px] leading-[1.6] text-sepia">Its theka marks teentaal, the sixteen-beat cycle every piece here is written in: × the first beat (sam), ० the empty one (khali). The newest model writes sixteen bars: four turns of this cycle.</p>
            </div>
          </div>
        </div>
        <div className="mt-14 flex justify-center"><Magnetic href="/instruments" variant="solid" size="lg" cursor="Open">Play the full harmonium and more →</Magnetic></div>
      </div>
    </section>
  );
}
