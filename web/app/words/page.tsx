"use client";

// Any words, in a raga: a line in any language is split into syllables, weighed (heavy / light),
// and set on one of the composer's pieces the way a bandish sets its text. The same fit score is
// the lyric verifier a lyrics model will be trained against.

import { useEffect, useMemo, useState } from "react";
import { type Bandish, BandishCard } from "@/components/BandishCard";
import { Bhatkhande } from "@/components/Bhatkhande";
import { Footer } from "@/components/Footer";
import { Magnetic } from "@/components/Magnetic";
import { FloralBand } from "@/components/Ornament";
import { RiseChars } from "@/components/Text";
import { getEngine } from "@/lib/audio";
import { ragaOfHour } from "@/lib/music";
import { tick, useData } from "@/lib/site";
import { usePlayhead } from "@/lib/usePlayhead";
import { bestSetting, syllables } from "@/lib/words";

type Text = { key: string; title: string; who: string; lang: string; text: string; strange?: boolean };

// All out of copyright: traditional, or the author died centuries ago.
const SHELF: Text[] = [
  { key: "khusrau", title: "Zihaal-e-miskin", who: "Amir Khusrau, c. 1300", lang: "Persian and Braj, half a line each", text: "Zihaal-e-miskin makun taghaful\nduraye naina banaye batiyan" },
  { key: "kabir", title: "Bura jo dekhan", who: "Kabir, 15th century", lang: "Hindi (Sadhukkadi)", text: "बुरा जो देखन मैं चला\nबुरा न मिलिया कोय\nजो दिल खोजा आपना\nमुझ सा बुरा न कोय" },
  { key: "basho", title: "Old pond", who: "Matsuo Bashō, 1686", lang: "Japanese", text: "ふるいけや\nかわずとびこむ\nみずのおと" },
  { key: "hwang", title: "Blue stream", who: "Hwang Jini, 16th century", lang: "Korean (sijo)", text: "청산리 벽계수야\n수이 감을 자랑 마라" },
  { key: "sappho", title: "The moon has set", who: "Sappho, c. 600 BCE", lang: "Ancient Greek", text: "Δέδυκε μὲν ἀ σελάννα\nκαὶ Πληΐαδες" },
  { key: "rumi", title: "Listen to the reed", who: "Rumi, Masnavi, 13th century", lang: "Persian", text: "Beshnow in ney chon shekayat mikonad\naz jodayiha hekayat mikonad" },
  { key: "kural", title: "A is the first", who: "Thiruvalluvar, Thirukkural", lang: "Tamil", text: "அகர முதல எழுத்தெல்லாம்\nஆதி பகவன் முதற்றே உலகு" },
  { key: "dickinson", title: "Hope", who: "Emily Dickinson, 1891", lang: "English", text: "Hope is the thing with feathers\nthat perches in the soul" },
  { key: "swahili", title: "Little by little", who: "Proverb", lang: "Swahili", text: "Haba na haba\nhujaza kibaba" },
  { key: "dies-irae", title: "Dies irae", who: "Sequence, 13th century", lang: "Latin", text: "Dies irae, dies illa\nsolvet saeclum in favilla" },
  { key: "gap", title: "Mind the gap", who: "London Underground", lang: "English, strange", text: "Mind the gap\nbetween the train and the platform", strange: true },
  { key: "hold", title: "Please hold", who: "Every helpline", lang: "English, strange", text: "Please hold\nyour call is important to us", strange: true },
];

export default function Words() {
  const data = useData();
  const ragas = data?.latest.ragas ?? [];
  const [rk, setRk] = useState<string | null>(null);
  const [text, setText] = useState(SHELF[0].text);
  const [chosen, setChosen] = useState(SHELF[0].key);
  const [playing, setPlaying] = useState(false);
  const [bandishes, setBandishes] = useState<Bandish[]>([]);

  useEffect(() => {
    fetch("/data/bandishes.json").then((r) => (r.ok ? r.json() : null)).then((d) => d && setBandishes(d.bandishes)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!rk && ragas.length) setRk(ragaOfHour(ragas, new Date().getHours()).key);
  }, [rk, ragas]);

  const syl = useMemo(() => syllables(text), [text]);
  const setting = useMemo(() => {
    if (!data || !rk || syl.length < 2) return null;
    const pieces = data.latest.pieces.filter((p) => p.raga === rk).map((p) => ({ id: p.id, notes: p.notes, beats: p.beats }));
    return bestSetting(syl, pieces);
  }, [data, rk, syl]);
  const head = usePlayhead(setting?.notes ?? null);
  const raga = ragas.find((r) => r.key === rk);
  const now = head !== null && setting ? setting.placements.filter((p) => setting.notes[p.note].t <= head + 1e-6).pop() : null;
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") Object.assign(window, { __words: { head, starts: setting?.placements.slice(0, 6).map((p) => setting.notes[p.note].t), now } }); // read by the headless browser test

  const play = async () => {
    if (!setting || !raga) return;
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
    eng.play(setting.notes, data?.latest.tempo ?? 90, `words-${setting.id}`, setting.placements.map((p) => ({ t: setting.notes[p.note].t, syl: syl[p.syllable].text })));
    setPlaying(true);
  };

  // A bandish the model composed for exactly these words, in this raga (pre-generated).
  const composed = bandishes.find((b) => b.task === "set" && b.raga === rk && b.words?.trim() === text.trim());
  // In this raga, the model's setting of a verse it never saw in training (Surdas, Bihari...).
  const unseen = bandishes.filter((b) => b.raga === rk && b.task === "set" && b.source && b.source !== "kabir");
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const heavy = syl.filter((s) => s.heavy).length;

  return (
    <main className="bg-transparent">
      <section className="relative overflow-hidden px-6 pb-10 pt-36 sm:px-10">
        <div className="pointer-events-none absolute -right-40 top-0 h-[640px] w-[640px] rounded-full bg-gulal/20 blur-[140px]" />
        <div className="relative mx-auto max-w-[1400px]">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Words</div>
          <h1 className="mt-4 font-display text-[clamp(64px,10vw,170px)] leading-[0.88]"><RiseChars text="Any words," /><br /><RiseChars text="in a raga." /></h1>
          <p className="mt-8 max-w-[680px] text-[clamp(18px,2vw,22px)] leading-[1.5] text-kajal/80">
            Write a line in any language. It is set the way a bandish sets its text: heavy syllables on held notes, open vowels carrying the runs, and the opening phrase, the mukhda, landing on sam.
          </p>
        </div>
      </section>
      <FloralBand />

      <section className="px-6 pb-16 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[1fr_400px]">
          <div className="space-y-6">
            <div className="leaf-card border border-rule p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">1 · Your words</div>
                <div className="flex flex-wrap gap-2">
                  {ragas.map((r) => (
                    <button key={r.key} onClick={() => { tick(); setRk(r.key); }} className={`rounded-full border px-4 py-1.5 text-[14px] transition-all ${r.key === rk ? "border-sindoor bg-sindoor text-paper" : "border-rule hover:border-sindoor/60"}`}>
                      {r.name} <span className="ml-1 font-deva opacity-70">{r.devanagari}</span>
                    </button>
                  ))}
                </div>
              </div>
              <textarea value={text} onChange={(e) => { setText(e.target.value); setChosen(""); }} rows={3} spellCheck={false} aria-label="Your words"
                className="mt-5 w-full resize-y rounded-lg border border-rule bg-paper/60 p-4 font-display text-[clamp(22px,2.6vw,32px)] leading-[1.35] text-kajal outline-none focus:border-sindoor" />
              <div className="mt-4 flex flex-wrap gap-x-1.5 gap-y-2">
                {syl.map((s, i) => (
                  <span key={i} title={s.heavy ? "heavy (long)" : "light (short)"}
                    className={`rounded px-1.5 py-0.5 text-[15px] ${s.heavy ? "bg-kajal text-paper" : "border border-rule text-kajal"} ${s.lineStart && i ? "ml-4" : ""} ${setting && i === setting.mukhda ? "ring-2 ring-sindoor ring-offset-1 ring-offset-paper" : ""} ${now?.syllable === i ? "!bg-sindoor !text-paper" : ""}`}>{s.text}</span>
                ))}
              </div>
              <div className="mt-3 text-[13px] text-kajal/55">
                {syl.length} syllables, {heavy} heavy (dark) and {syl.length - heavy} light. The ringed one ends the mukhda and should land on sam.
              </div>
            </div>

            {composed && raga && <BandishCard b={composed} raga={raga} tempo={data?.latest.tempo ?? 90} title="Composed for these words by the model" />}
            {!composed && raga && unseen.map((b, i) => <BandishCard key={i} b={b} raga={raga} tempo={data?.latest.tempo ?? 90} title={`A ${b.source!.startsWith("bhramargeet") ? "Surdas" : b.source!.startsWith("bihari") ? "Bihari" : b.source!.startsWith("rahim") ? "Rahim" : "Kabir"} verse it never saw, set by the model`} />)}
            {setting && raga && (
              <div className="leaf-card border border-rule p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">{composed ? "For comparison: set on an existing piece" : `2 · Set in ${raga.name}`}</div>
                  <Magnetic variant="solid" cursor={playing ? "Stop" : "Listen"} onClick={play}>{playing ? "❚❚ Stop" : "▶ Sing it"}</Magnetic>
                </div>
                <div className="mt-5 flex min-h-[90px] items-center justify-center text-center">
                  <span className="font-display text-[clamp(44px,7vw,96px)] leading-none text-kajal transition-all">{now ? syl[now.syllable].text : <span className="text-rule">{syl[0]?.text}…</span>}</span>
                </div>
                <Bhatkhande notes={setting.notes} beats={setting.beats} head={head} words={setting.words} className="mt-4" />
                <p className="mt-4 text-[13px] leading-[1.6] text-kajal/55">
                  The notes are {setting.id.replace(/^[a-z0-9]+-[a-z_]+-/, "piece no. ").replace(/no\. 0?(\d+)/, (_, n) => `no. ${Number(n) + 1}`)} by the newest model in {raga.name}, the best fit for these words of its {data?.latest.pieces.filter((p) => p.raga === rk).length} pieces. ऽ marks a vowel held across notes, as in Bhatkhande&rsquo;s books. The voice sings the words roughly (each syllable's vowel and consonant shape from a simple formant voice), and they light up in time.
                </p>
              </div>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            {setting && (
              <div className="leaf-card relative border border-rule p-7 text-kajal"><span className="pointer-events-none absolute inset-[6px] border border-sindoor/40" />
                <div className="text-[12px] uppercase tracking-[0.24em] text-kajal/50">How well it sits</div>
                <ul className="mt-5 space-y-3 text-[15px]">
                  <li className="flex justify-between gap-4"><span>Heavy syllables on held notes</span><span className="tabular-nums">{pct(setting.fit.heavyOnLong)}</span></li>
                  <li className="flex justify-between gap-4"><span>Light syllables on quick notes</span><span className="tabular-nums">{pct(setting.fit.lightOnShort)}</span></li>
                  <li className="flex justify-between gap-4"><span>Mukhda lands on sam</span><span>{setting.fit.mukhdaOnSam ? "✓" : "✕"}</span></li>
                  <li className="flex justify-between gap-4"><span>Lines end on long notes</span><span className="tabular-nums">{pct(setting.fit.lineEndsLong)}</span></li>
                  <li className="flex justify-between gap-4"><span>Notes per syllable</span><span className="tabular-nums">{(1 + setting.fit.melisma).toFixed(1)}</span></li>
                </ul>
                <p className="mt-5 text-[13px] leading-[1.6] text-kajal/55">These checks are the lyric verifier: the same rules will score the words a lyrics model writes, the way the raga&rsquo;s grammar scored the notes.</p>
              </div>
            )}
            <div>
              <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Words from everywhere</div>
              <div className="mt-3 space-y-2">
                {SHELF.map((t) => (
                  <button key={t.key} onClick={() => { tick("soft"); setText(t.text); setChosen(t.key); }}
                    className={`block w-full rounded-lg border px-4 py-3 text-left transition-colors ${chosen === t.key ? "border-sindoor bg-paper2/60" : "border-rule hover:border-sindoor/60"}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-display text-[19px]">{t.title}</span>
                      <span className={`text-[12px] ${t.strange ? "text-sindoor" : "text-kajal/50"}`}>{t.lang}</span>
                    </div>
                    <div className="text-[13px] text-kajal/55">{t.who}</div>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[12px] leading-[1.6] text-kajal/45">Every text here is out of copyright. Khusrau&rsquo;s line is half Persian, half Braj: Hindustani music has mixed languages since its beginnings.</p>
            </div>
          </aside>
        </div>
      </section>
      <Footer />
    </main>
  );
}
