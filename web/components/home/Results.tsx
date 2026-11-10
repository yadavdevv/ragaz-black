"use client";

import { Folio, Hashiya, Rubric } from "@/components/Ornament";
import { CountUp, Reveal } from "@/components/Text";
import type { Data } from "@/lib/site";
import { Evolution, WORDS, stageCount } from "./Evolution";

export function Results({ data }: { data: Data }) {
  const L = data.latest, e = L.eval;
  // Every number from the newest run's own evaluation (export_web.py: latest.eval, latest.concerts).
  const b = L.baseline, pc = (x: number) => `${Math.round(x * 100)}%`;
  const stats = [
    { v: L.ragas.length, d: 0, s: "", l: "ragas it composes in, given nothing but the raga's name", before: b ? "copied the prompt's example line, whatever the raga" : null },
    { v: e.reader_accuracy * 100, d: 0, s: "%", l: `of its pieces in the ${L.concerts.ragas} ragas with recordings, named as the raga asked for by a reader that learned ragas only from real singers`, before: b ? `${pc(b.reader_accuracy)}, about chance` : null },
    { v: e.no_wrong_notes * 100, d: 0, s: "%", l: "of its pieces use only notes the raga allows", before: b ? `${pc(b.no_wrong_notes)}, by luck` : null },
    { v: e.novel_bars * 100, d: 0, s: "%", l: "of its bars appear in none of the examples it was shown: it isn't copying", before: b ? `${pc(1 - b.copied_example)}: every piece was the example` : null },
  ];
  return (
    <section id="results" className="relative py-28">
      <div className="mx-auto max-w-[1400px] px-6 sm:px-10">
        <Reveal>
          <div className="flex items-center gap-4"><Folio n={10} /><Rubric>Results</Rubric></div>
          <h2 className="mt-6 font-display text-[clamp(46px,6.4vw,104px)] leading-[0.95] text-kajal">How good is it?</h2>
          <p className="mt-6 max-w-[62ch] text-[18px] leading-[1.6] text-sepia">The newest model ({L.label}), on {L.pieces.length} pieces it wrote, {L.pieces.length / L.ragas.length} in each raga. Its reward was built from {L.concerts.recordings} concert recordings across {L.concerts.ragas} ragas, with {L.concerts.held_out} held out to check it.{L.baseline ? ` Under each number, the same test given to Qwen3-0.6B before any training: asked the same way, it copied the prompt's example line, from another raga, every time.` : ""} <a href="/docs#results" className="underline underline-offset-4">What each number means</a></p>
        </Reveal>
        <Hashiya className="mt-12">
          <div className="leaf-card grid sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s, i) => (
              <div key={s.l} className={`p-8 ${i ? "border-t border-rule sm:border-t-0 sm:border-l" : ""}`}>
                <div className="font-display text-[clamp(60px,6.4vw,96px)] leading-none text-sindoor"><CountUp to={s.v} decimals={s.d} suffix={s.s} /></div>
                <div className="mt-4 text-[17px] leading-[1.5] text-sepia">{s.l}</div>
                {s.before && <div className="mt-4 border-t border-rule pt-3 text-[14px] text-kajal/70"><span className="uppercase tracking-[0.15em] text-[11px] text-sepia">Untrained · </span>{s.before}</div>}
              </div>
            ))}
          </div>
        </Hashiya>

        <div id="evolution" className="mt-24 scroll-mt-28">
          <Reveal>
            <Rubric>How it learned</Rubric>
            <h3 className="mt-4 font-display text-[clamp(38px,5vw,72px)] leading-[0.95] text-kajal">The same raga, <span className="italic text-sindoor">{WORDS[stageCount(data)] ?? stageCount(data)} stages.</span></h3>
            <p className="mt-5 max-w-[62ch] text-[18px] leading-[1.6] text-sepia">Hear it go from copying the example it was shown, to a metronome stepping through the right notes, to something that breathes like a raga: one piece from each stage, in the same voice.</p>
          </Reveal>
          <div className="mt-8"><Evolution data={data} /></div>
        </div>

        <div className="mt-24 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <Reveal><h3 className="font-display text-[44px] leading-none text-kajal">What it can't do yet</h3></Reveal>
          <div className="divide-y divide-rule border-y border-rule">
            {[
              ["Ornaments", "Its notation has no symbol for glides and shakes (meend, gamak). The recordings add them from measurements of real singers; the model itself doesn't choose them."],
              ["Alap", "The slow, unmetered opening of a real performance. It only writes in teentaal."],
              ["A real voice", "The recordings use a voice learned from a short training run on concert vocals: closer to a singer than a synthesiser, still not a person."],
              ["A musician's verdict", "It's measured against recordings and a reader, not yet judged by an expert's ear. The raga rules haven't been reviewed by a musician."],
            ].map(([t, d]) => (
              <Reveal key={t} className="grid gap-1 py-5 text-[18px] sm:grid-cols-[12rem_1fr] sm:gap-6"><span className="font-display text-[22px] text-kajal">{t}</span><span className="text-sepia">{d}</span></Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
