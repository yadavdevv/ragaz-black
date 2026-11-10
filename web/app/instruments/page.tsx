"use client";

import { Footer } from "@/components/Footer";
import { FullHarmonium } from "@/components/FullHarmonium";
import { Tabla, Tanpura } from "@/components/Instruments";
import { MoreInstruments } from "@/components/MoreInstruments";
import { FloralBand, Folio, Hashiya, Rubric } from "@/components/Ornament";
import { Reveal, RiseChars } from "@/components/Text";
import { useData } from "@/lib/site";

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="mt-8 divide-y divide-rule border-y border-rule">
      {items.map(([k, v]) => (
        <div key={k} className="grid gap-1 py-3 text-[16px] sm:grid-cols-[10rem_1fr] sm:gap-6">
          <dt className="font-display text-[19px] text-kajal">{k}</dt>
          <dd className="text-sepia">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Instruments() {
  useData(); // ragas for the harmonium's raga overlay
  return (
    <main>
      <section className="px-6 pb-14 pt-36 sm:px-10">
        <div className="mx-auto max-w-[1400px]">
          <Rubric>The instruments of a raga</Rubric>
          <h1 className="mt-5 font-display text-[clamp(52px,11vw,180px)] leading-[0.88] text-kajal"><RiseChars text="Instruments." /></h1>
          <p className="mt-6 max-w-[52ch] text-[20px] leading-[1.6] text-sepia">A Hindustani performance rests on a few instruments: a drone that never stops, a drum that keeps the cycle, and, in many concerts, a harmonium that follows the voice. Around them are the melody instruments: strings plucked, struck and bowed, a flute and a reed. All nine are playable here, and every one is synthesised in your browser. Move across them.</p>
        </div>
      </section>
      <FloralBand />

      <section className="px-6 py-24 sm:px-10">
        <div className="mx-auto max-w-[1400px]">
          <Reveal>
            <div className="flex items-center gap-4"><Folio n={1} /><Rubric>Harmonium · हारमोनियम</Rubric></div>
            <h2 className="mt-5 font-display text-[clamp(44px,6vw,96px)] leading-[0.95] text-kajal">A full harmonium.</h2>
          </Reveal>
          <div className="mt-10"><FullHarmonium /></div>
          <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <p className="text-[18px] leading-[1.65] text-sepia">The harmonium came to India with European missionaries in the nineteenth century as a foot-pumped organ. Indian makers turned it into a small hand-pumped box you play sitting on the floor, one hand on the bellows and one on the keys, and it became the most common accompaniment for singing.</p>
            <Facts items={[
              ["Keys", "42, from C to F: three and a quarter octaves, in piano layout."],
              ["Sound", "Metal reeds set vibrating by air from the bellows. Each note here uses two reeds tuned a few cents apart, which makes the shimmer."],
              ["Tuning", "Equal temperament, like a piano. Its fixed, tempered notes cannot glide, which is why All India Radio kept it off the air from 1940 to 1971."],
              ["Stops", "Drone stops hold a note while you play; a coupler doubles each note an octave below."],
            ]} />
          </div>
        </div>
      </section>

      <section className="bg-paper2/70">
        <FloralBand />
        <div className="mx-auto grid max-w-[1400px] items-center gap-14 px-6 py-24 sm:px-10 lg:grid-cols-[minmax(0,300px)_1fr]">
          <Tanpura className="mx-auto h-[min(80svh,720px)] w-[min(60vw,260px)] lg:w-full" />
          <div>
            <div className="flex items-center gap-4"><Folio n={2} /><Rubric>Tanpura · तानपूरा</Rubric></div>
            <h2 className="mt-5 font-display text-[clamp(44px,6vw,96px)] leading-[0.95] text-kajal">The drone.</h2>
            <p className="mt-6 max-w-[48ch] text-[18px] leading-[1.65] text-sepia">The tanpura plays no melody. Its four strings are plucked in turn, slowly and without end, and every note of the raga is heard against them. Sweep across its strings.</p>
            <Facts items={[
              ["Strings", "Usually Pa, Sa, Sa and low Sa. For ragas without Pa, such as Malkauns, the first string is tuned to Ma."],
              ["Jawari", "A curved bone bridge. The string grazes it as it vibrates, which makes the rich buzz of rising overtones."],
              ["Body", "A large resonating gourd (tumba) and a long hollow neck (dand)."],
            ]} />
          </div>
        </div>
        <FloralBand />
      </section>

      <section className="px-6 py-24 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-14 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <div className="flex items-center gap-4"><Folio n={3} /><Rubric>Tabla · तबला</Rubric></div>
            <h2 className="mt-5 font-display text-[clamp(44px,6vw,96px)] leading-[0.95] text-kajal">The cycle.</h2>
            <p className="mt-6 max-w-[48ch] text-[18px] leading-[1.65] text-sepia">A pair of drums. The tabla player keeps the tala, the rhythmic cycle, and marks its first beat (sam) so singer and drummer arrive there together. Every stroke has a spoken name, a bol, so a rhythm can be recited as well as played.</p>
            <Facts items={[
              ["Dayan", "The right-hand drum, carved from wood and tuned to Sa. Struck at the rim it rings (ना); on the black centre it sounds (तिं)."],
              ["Bayan", "The left-hand bass drum, of metal or clay. Pressing the palm into its head bends its pitch upward."],
              ["Syahi", "The black disc on each head, a paste of iron filings and starch laid in layers; it gives the drums a clear pitch."],
              ["Teentaal", "Sixteen beats in four groups of four. × marks sam, the first beat; ० marks khali, the empty one."],
            ]} />
          </div>
          <Hashiya><div className="leaf-card p-5 sm:p-8"><Tabla /></div></Hashiya>
        </div>
      </section>
      <section className="bg-paper2/70">
        <FloralBand />
        <div className="mx-auto max-w-[1400px] px-6 py-24 sm:px-10">
          <div className="flex items-center gap-4"><Folio n={4} /><Rubric>The melody instruments</Rubric></div>
          <h2 className="mt-5 font-display text-[clamp(44px,6vw,96px)] leading-[0.95] text-kajal">Strings, breath and reed.</h2>
          <p className="mt-6 max-w-[60ch] text-[18px] leading-[1.65] text-sepia">Six instruments that carry the raga itself, tuned to the raga you pick. Sweep across the strings to pluck them; rest on a hole or a point on the bow to hold a note, and move off to let it go.</p>
          <div className="mt-10"><MoreInstruments /></div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
