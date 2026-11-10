"use client";

// Docs: how to use every page of the site, step by step, then a glossary and the technical reference.

import katex from "katex";
import Link from "next/link";
import { useMemo } from "react";
import { Footer } from "@/components/Footer";
import { FloralBand, Rubric } from "@/components/Ornament";
import { RiseChars } from "@/components/Text";
import { PAINTINGS } from "@/lib/art";
import { useData } from "@/lib/site";

type Guide = { id: string; page: string; href: string; title: string; for: string; steps: React.ReactNode[]; tips?: React.ReactNode[]; behind: React.ReactNode };

const K = ({ children }: { children: React.ReactNode }) => <kbd className="rounded border border-rule bg-leaf px-1.5 py-0.5 font-mono text-[0.85em] text-kajal">{children}</kbd>;
const C = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-paper2 px-1.5 text-kajal">{children}</code>;

const GUIDES: Guide[] = [
  {
    id: "home", page: "Home", href: "/", title: "The front page",
    for: "The story of the project in one scroll: what the composer is, how it learned, and how good it got.",
    steps: [
      "Scroll. Each section plays: press any piece to hear it, sung by your browser over a tanpura drone.",
      <>Turn the drone on or off any time with <b>Tanpura</b> at the top right; it stays on as you move between pages.</>,
      <>The <b>How it works</b> and <b>Results</b> links jump to the explanation and to how good the newest model is. Under Results, <b>How it learned</b> plays the same raga from five stages of training, so you can hear it improve.</>,
      <>The newest model's recordings (in <b>The newest model</b>) are its notes sung by a learned voice, with breaths and ornaments: see <a href="#hear" className="underline underline-offset-4">What you hear</a>.</>,
    ],
    behind: "Every number on the page comes from the exported training runs; nothing is typed in by hand.",
  },
  {
    id: "ragas", page: "Ragas", href: "/ragas", title: "Ragas, and the library",
    for: "Meet the 13 ragas, then listen to everything the composer wrote in them.",
    steps: [
      <>The ragas are laid out around the clock, morning to midnight, then the seasonal ones (Malhar for the rains, Basant for spring). The one marked <b>now</b> is the raga of the current hour.</>,
      <>Open a raga for its own page: tap its notes to hear them (the greyed ones are not allowed in it), play its <b>signature phrase</b> (pakad), hear the newest model's piece <b>sung</b>, and for Bhupali, Yaman and Malkauns hear <b>how it learned</b> the raga across five stages of training. Where there are recordings, hear ten seconds of a real singer's line and see how real singers spend their time on each note.</>,
      <>Below the ragas is <b>the library</b>: every piece, filterable by raga and by model. <b>Newest</b> is the latest composer; the older models show how it improved. Sort by <b>highest score</b> or <b>as written</b>.</>,
      <><b>Play all, full screen</b> queues the whole list in the big player, with the melody drawn as it plays.</>,
    ],
    tips: ["A raga sounds most like itself at its hour: try the one marked now.", "Compare the same raga across models: the oldest ones wander off the raga's notes; the newest rarely do."],
    behind: "Raga rules follow standard Bhatkhande descriptions (not yet reviewed by a musician). The real singers' lines are resynthesised from pitch tracks of concert recordings, not the original audio.",
  },
  {
    id: "sing", page: "Sing", href: "/sing", title: "Sing to it",
    for: "Hum or sing a few notes; it tells you which raga you were in and answers you in that raga.",
    steps: [
      <><b>Find your Sa.</b> Move the slider until humming the drone's note feels easy. That note is your home note.</>,
      <><b>Sing.</b> Press Sing and allow the microphone. Start on Sa, then wander: hum, sing “aa”, or sing sargam, holding each note for a moment. It listens for up to 12 seconds (4 at least).</>,
      <><b>The reading.</b> Your line appears as sargam, and the raga it most resembles, with the notes that gave it away. Then the composer answers with a phrase it wrote in that raga, sung over the tanpura in your key. <b>Share</b> makes a picture of your line and its raga.</>,
      "Sing again to keep the conversation going; earlier turns stay listed. Share any answer.",
    ],
    tips: ["Headphones stop the answer leaking back into the microphone.", "Fewer than three held notes is not enough to read: hold notes longer rather than singing faster.", <>At the bottom, <b>Cousins</b>: ragas hiding in well-known tunes and scales from around the world.</>],
    behind: <>Pitch tracking, the note transcription and the raga reading all run in your browser: no audio leaves the page. How the reading works: <a href="#reader" className="underline underline-offset-4">The reader</a>.</>,
  },
  {
    id: "compose", page: "Compose", href: "/compose", title: "Write a melody, get it scored",
    for: "Write your own melody in a raga, beat by beat, and see it scored by the same function that trained the composer.",
    steps: [
      "Pick a raga at the top. The keyboard shows only its notes, low, middle and upper octave.",
      <>Click a key, or type <K>a</K> <K>s</K> <K>d</K> <K>f</K> … for its notes. Each note fills one beat. <K>-</K> (or the Hold key) holds the last note another beat; <K>Backspace</K> takes one away.</>,
      "The grid shows bars of four beats and cycles of sixteen (teentaal), with × on the first beat. Click a cell to move the cursor there.",
      <><b>▶ Play mine</b> sings it. The score updates as you write: a plain list of checks (only the raga's notes, four beats a bar, no loops, phrases real singers use…) and the total against the composer's average.</>,
      <>Stuck? <b>Start from its signature phrase</b>, or <b>let ragaz write one</b> and edit it. <b>Show the math</b> opens the formula; <b>Copy notation</b> and <b>Download</b> keep your piece.</>,
    ],
    tips: ["The hard rules multiply: one note outside the raga costs more than any style point earns.", "End on Sa or the raga's resting note."],
    behind: <>The score is the reward described under <a href="#reward" className="underline underline-offset-4">The reward</a>, computed in your browser (lib/verify.ts mirrors the Python verifier).</>,
  },
  {
    id: "instruments", page: "Instruments", href: "/instruments", title: "Play the instruments",
    for: "Nine instruments of Hindustani music, drawn large and playable.",
    steps: [
      <><b>Harmonium</b>: play it with the mouse or keyboard; the raga overlay shows which keys belong to a raga.</>,
      <><b>Tanpura</b>: sweep across its four strings to pluck them. <b>Tabla</b>: strike the drums, or set the teentaal theka playing.</>,
      <><b>The melody instruments</b>: pick the raga they are tuned to, then sweep across the strings of the sitar, santoor and swarmandal; rest on a hole of the bansuri or shehnai, or a point on the sarangi's bow, to hold a note, and move off to stop.</>,
    ],
    tips: ["Every string and hole is a note of the chosen raga, so nothing you play can sound wrong.", "On a phone, touch and slide."],
    behind: "All synthesised: strings by Karplus–Strong (a noise burst in a delay line one period long), the bansuri from a near-sine and breath noise, the sarangi from a bowed sawtooth through voice-like resonances, the shehnai from a reed's lifted harmonics.",
  },
];

const GLOSSARY: [string, string][] = [
  ["Sa", "The home note; every other note is heard against it. The drone keeps it sounding."],
  ["Swara", "A note. In order: Sa Re Ga Ma Pa Dha Ni (sargam), then Sa again an octave up."],
  ["Komal, tivra", "Komal is a flattened note (Re, Ga, Dha, Ni); tivra is the raised Ma. Written lowercase, and M for tivra Ma."],
  ["Raga", "A set of notes with rules for how to move through them, characteristic phrases, and a mood and hour."],
  ["Pakad", "A raga's signature phrase: the few notes that identify it."],
  ["Vadi, samvadi", "A raga's most important note and its second."],
  ["Tala, teentaal", "A rhythmic cycle; teentaal has sixteen beats in four groups."],
  ["Sam", "The first beat of the cycle, where singer and drummer meet. Marked ×."],
  ["Bandish", "A composed song in a raga: a sthayi (first part, low-middle) and an antara (second part, higher)."],
  ["Mukhda", "The bandish's opening phrase, which keeps returning and lands on sam."],
  ["Taan", "A fast run of notes."],
  ["Aakar", "Singing on an open “aa”."],
  ["Meend", "A glide from one note to another."],
  ["Just intonation", "Tuning by simple ratios of Sa (Pa = 3/2, Ga = 5/4) rather than a piano's equal steps."],
];

const UNDERSTAND = [
  { id: "hear", t: "What you hear" },
  { id: "evolution", t: "How it learned" },
  { id: "results", t: "The results, explained" },
  { id: "reader", t: "The reader" },
  { id: "faq", t: "Questions" },
];

const REFERENCE = [
  { id: "notation", t: "Notation" },
  { id: "reward", t: "The reward" },
  { id: "training", t: "Training" },
  { id: "data", t: "Data" },
  { id: "images", t: "Images" },
];

export default function Docs() {
  const data = useData();
  const eq6 = useMemo(() => katex.renderToString(String.raw`\begin{aligned}R=\;&\text{format}\cdot\text{purity}\cdot\text{beats}^2\cdot\text{variety}\cdot\text{length}\cdot(0.4+0.6\,\text{rhythm})\\&\cdot\big(0.15\,\text{tala}+0.15\,\text{rank}+0.15\,\text{pakad}+0.3\,\text{phrases}+0.1\,\text{motion}+0.15\,\text{register}\big)\end{aligned}`, { displayMode: true, throwOnError: false }), []);
  const L = data?.latest, perf = L?.performance;
  const evo = data?.evolution ?? [];
  const eq = useMemo(() => katex.renderToString(String.raw`\begin{aligned}R=\;&\text{format}\cdot\text{allowed}^2\cdot\text{beats}^2\cdot\text{variety}\cdot\text{length}\\&\cdot\big(0.2\,\text{tala}+0.35\,\text{profile}+0.1\,\text{motion}+0.35\,\text{phrases}\big)\end{aligned}`, { displayMode: true, throwOnError: false }), []);
  const ex = (data?.latest.pieces.find((p) => p.raga === "yaman")?.notation ?? "S R G P | G R D P").replace(/\n/g, " | ");
  const h2 = "font-display text-[clamp(40px,5vw,56px)] leading-none text-kajal";
  return (
    <main className="wasli text-kajal">
      <section className="px-6 pb-16 pt-40 sm:px-10">
        <div className="mx-auto max-w-[1400px]">
          <Rubric>How to use ragaz</Rubric>
          <h1 className="mt-4 font-display text-[clamp(72px,12vw,200px)] leading-[0.85]"><RiseChars text="Docs." /></h1>
          <p className="mt-8 max-w-[60ch] text-[20px] leading-[1.6] text-sepia">A guide to every page: what it is for, how to use it step by step, and what is happening underneath. New to Indian classical music? The <a href="#glossary" className="underline underline-offset-4">glossary</a> explains every word used on the site.</p>
        </div>
      </section>
      <FloralBand />
      <section className="px-6 pb-32 pt-14 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-16 lg:grid-cols-[220px_1fr]">
          <nav className="hidden space-y-6 text-[16px] lg:sticky lg:top-28 lg:block lg:self-start">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-sepia">Start</div>
              <a href="#start" className="block text-kajal/60 hover:text-kajal">Getting started</a>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-sepia">The pages</div>
              {GUIDES.map((g) => <a key={g.id} href={`#${g.id}`} className="block text-kajal/60 hover:text-kajal">{g.page}</a>)}
            </div>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-sepia">Words</div>
              <a href="#glossary" className="block text-kajal/60 hover:text-kajal">Glossary</a>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-sepia">Understanding it</div>
              {UNDERSTAND.map((s) => <a key={s.id} href={`#${s.id}`} className="block text-kajal/60 hover:text-kajal">{s.t}</a>)}
            </div>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-sepia">Reference</div>
              {REFERENCE.map((s) => <a key={s.id} href={`#${s.id}`} className="block text-kajal/60 hover:text-kajal">{s.t}</a>)}
            </div>
          </nav>

          <div className="min-w-0 max-w-[820px] space-y-24 text-[18px] leading-[1.7] text-kajal/75">
            <article id="start" className="scroll-mt-28">
              <h2 className={h2}>Getting started</h2>
              <p className="mt-6">Ragaz is a small language model that composes Hindustani classical music from nothing but a raga's name, and a set of pages to listen to it, sing with it, write against it and play the instruments of a raga. The pieces play in your browser from the notes the model wrote; the newest model's pieces can also be heard as recordings, sung by a learned voice. Nothing you sing leaves the page.</p>
              <ol className="mt-6 space-y-3">
                {[
                  <>Turn your sound on. Headphones are best, and needed on <b>Sing</b>.</>,
                  <>Open <Link href="/ragas" className="underline underline-offset-4">Ragas</Link> and play the raga marked <b>now</b>: the quickest way to hear what the composer makes.</>,
                  <>Then pick by what you want to do: <b>sing</b> and be answered (Sing), <b>write</b> a melody and get it scored (Compose), or <b>play an instrument</b> (Instruments).</>,
                ].map((s, i) => <li key={i} className="grid grid-cols-[2rem_1fr]"><span className="font-display text-[22px] text-sindoor">{i + 1}</span><span>{s}</span></li>)}
              </ol>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {GUIDES.map((g) => (
                  <a key={g.id} href={`#${g.id}`} className="leaf-card block border border-rule p-4 transition-colors hover:border-sindoor/60">
                    <div className="font-display text-[24px] text-kajal">{g.page}</div>
                    <div className="mt-1 text-[14px] leading-[1.5] text-sepia">{g.for}</div>
                  </a>
                ))}
              </div>
            </article>

            {GUIDES.map((g) => (
              <article key={g.id} id={g.id} className="scroll-mt-28">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <h2 className={h2}>{g.page}</h2>
                  <Link href={g.href} className="text-[15px] text-sindoor hover:underline">Open {g.page} →</Link>
                </div>
                <p className="mt-3 text-[15px] uppercase tracking-[0.18em] text-sepia">{g.title}</p>
                <p className="mt-5 text-[20px] text-kajal/85">{g.for}</p>
                <h3 className="mt-8 text-[13px] uppercase tracking-[0.2em] text-sepia">How to use it</h3>
                <ol className="mt-3 space-y-4">
                  {g.steps.map((s, i) => <li key={i} className="grid grid-cols-[2rem_1fr] border-t border-rule pt-3"><span className="font-display text-[22px] leading-[1.4] text-sindoor">{i + 1}</span><span>{s}</span></li>)}
                </ol>
                {g.tips && (
                  <div className="leaf-card mt-8 border border-rule p-5 text-[16px]">
                    <div className="text-[12px] uppercase tracking-[0.2em] text-sindoor">Tips</div>
                    <ul className="mt-2 space-y-2">{g.tips.map((t, i) => <li key={i} className="pl-4 -indent-4">· {t}</li>)}</ul>
                  </div>
                )}
                <p className="mt-6 text-[15px] text-sepia"><span className="text-kajal">Underneath: </span>{g.behind}</p>
              </article>
            ))}

            <article id="glossary" className="scroll-mt-28">
              <h2 className={h2}>Glossary</h2>
              <dl className="mt-6 divide-y divide-rule border-y border-rule text-[16px]">
                {GLOSSARY.map(([k, v]) => (
                  <div key={k} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-6"><dt className="font-display text-[19px] text-kajal">{k}</dt><dd>{v}</dd></div>
                ))}
              </dl>
            </article>

            <div className="border-t-2 border-kajal pt-6 text-[13px] uppercase tracking-[0.24em] text-sepia">Understanding it</div>

            <article id="hear" className="scroll-mt-28">
              <h2 className={h2}>What you hear</h2>
              <p className="mt-6">There are two ways a piece is heard here, and both sing exactly the notes the model wrote.</p>
              <h3 className="mt-6 font-display text-[26px] text-kajal">In your browser</h3>
              <p className="mt-2">Every piece in the library, every card and the full-screen player: your browser reads the notation and sings it with a small synthesiser, a voice shaped like an open “aa” (aakar), sliding between notes, tuned in just intonation over a four-string tanpura. It is plain on purpose: what you hear is the notation, nothing added. The instruments page is synthesised the same way, from oscillators, noise, filters and delay lines; no samples.</p>
              <h3 className="mt-6 font-display text-[26px] text-kajal">The recordings</h3>
              <p className="mt-2">The newest model's piece in each raga (on the front page and each raga's page) was rendered on a Mac. The voice is {L ? L.voices.vocal : "a learned DDSP voice"}. A DDSP model (Engel et al., 2020) is given only a pitch and a loudness over time, so every note it sings is the model's; the flute version plays the same line with a simple synthesiser.</p>
              <p className="mt-3">Notation can't say how to sing, so the recordings are <b>performed</b> the way a singer would: they breathe after held notes and at phrase ends, touch a neighbouring note before some notes (kan), glide into notes, waver on long ones, push and pull the timing a little, swell and ease across each phrase, and sit in a faint room tone. Each of those was measured on real concerts and on our pieces with the same transcriber:</p>
              {perf && (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-[15px] tabular-nums">
                    <thead><tr className="border-b border-rule text-[12px] uppercase tracking-[0.15em] text-sepia"><th className="py-2 font-normal" /><th className="font-normal">Real singers</th><th className="font-normal">Ours, as written</th><th className="font-normal">Ours, performed</th></tr></thead>
                    <tbody>
                      {([["Time spent gliding between notes", "in_motion", (v: number) => `${Math.round(v * 100)}%`], ["Wobble on a held note", "micro_cents", (v: number) => `${v.toFixed(1)} cents`], ["Pauses and breaths a minute", "breaths_min", (v: number) => v.toFixed(0)], ["Notes held a second or more", "holds_1s", (v: number) => `${Math.round(v * 100)}%`], ["Typical note length", "dur_p50", (v: number) => `${v.toFixed(2)} s`]] as const).map(([l, k, f]) => (
                        <tr key={k} className="border-b border-rule/60"><td className="py-2 pr-4">{l}</td><td>{f(perf.real[k])}</td><td>{f(perf.plain[k])}</td><td className="text-sindoor">{f(perf.performed[k])}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[13px] text-sepia">{perf.real.n} concert recordings of Bhupali, Yaman and Malkauns vs the newest model's {perf.plain.n} pieces in those ragas (scripts/real_vs_ours.py). Holds were already as long as real singers'; what was missing was the motion between notes, the wobble and the breathing.</p>
                </div>
              )}
              <p className="mt-4">The real singers' lines on the raga pages are different again: the pitch traced from a concert recording, sung back by your browser. No recorded audio is used anywhere.</p>
            </article>

            <article id="evolution" className="scroll-mt-28">
              <h2 className={h2}>How it learned</h2>
              <p className="mt-6">The model was trained in stages, and each stage was scored by the reward of its time, so their own scores can't be compared. To show the progress fairly, the front page and the raga pages play one piece from each stage, for the three ragas every stage knew:</p>
              <ul className="mt-4 space-y-2 text-[16px]">
                {[...new Map(evo.map((x) => [x.stage, x])).values()].map((x) => <li key={x.stage} className="grid grid-cols-[6rem_1fr] gap-4 border-t border-rule pt-2"><span className="font-display text-[19px] text-kajal">{x.label}</span><span>{x.what}; {x.bars} bars.</span></li>)}
              </ul>
              <p className="mt-4">Each stage's piece is its <b>median</b> by its own score (a typical piece, not its best), all rendered with the same voice and performance, so the only difference is what was written. Then every piece is scored with <b>one yardstick</b>: the newest reward, at the piece's own length. Under it, the early pieces lose most on <b>rhythm</b> (one note per beat, like a metronome) and <b>register</b> (they mostly stay in one octave); from v5e on, the model varies its rhythm and climbs into the upper octave, as singers do.</p>
            </article>

            <article id="results" className="scroll-mt-28">
              <h2 className={h2}>The results, explained</h2>
              <p className="mt-6">The numbers under “How good is it?” come from the newest run's own evaluation{L ? ` (run ${L.run}, step ${L.step})` : ""}: {L ? L.pieces.length : 78} pieces, written with nothing in the prompt but the raga's name.</p>
              <dl className="mt-5 divide-y divide-rule border-y border-rule text-[16px]">
                {[
                  ["Ragas", "How many ragas it was trained to write. Twelve have concert recordings behind them; Deshkar has none and is learned from rules and examples alone."],
                  ["Named by the reader", "A separate program that learned ragas only from real singers listens to each piece and names its raga. It counts as right only if its first answer is the raga that was asked for. See The reader."],
                  ["Only the raga's notes", "The share of pieces with not a single note the raga forbids."],
                  ["New bars", "The share of its bars that appear in none of the examples it was shown during training: a check that it composes rather than copies."],
                  ["Concerts", `The style measures (how real singers spend their time on each note, their rhythm, their phrases, how much of the upper octave they use) were built from ${L?.concerts.recordings ?? 118} concert recordings across ${L?.concerts.ragas ?? 12} ragas; ${L?.concerts.held_out ?? 36} were held out to check that the measures hold for singers they weren't built from.`],
                ].map(([k, v]) => <div key={k} className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-6"><dt className="font-display text-[19px] text-kajal">{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </article>

            <article id="reader" className="scroll-mt-28">
              <h2 className={h2}>The reader</h2>
              <p className="mt-6">The reader is what names a raga, on Sing and in the results. It learned each raga from real concerts only: how much time singers spend on each of the twelve notes, and which note tends to follow which. Given a line, it turns it into notes and asks which raga's habits it fits best, as a share for every raga.</p>
              <p className="mt-3">On five-second stretches of real concerts it names the right raga first about seven times in ten, and has it in its top three about nine times in ten: some ragas share most of their notes (Bhupali and Deshkar have the same five), so a short line can honestly fit two. On Sing, it reads your voice the same way; a longer line with notes held for a moment gives it more to go on.</p>
            </article>

            <article id="faq" className="scroll-mt-28">
              <h2 className={h2}>Questions</h2>
              <dl className="mt-6 divide-y divide-rule border-y border-rule text-[16px]">
                {[
                  ["Is this AI-generated music?", "The melodies are: every note was written by the model. The sound isn't a recording of anyone: your browser synthesises it, and the recordings use a voice learned from concert vocals."],
                  ["Is anything hand-picked?", "No piece is edited. The library shows every piece the evaluation produced. The front page's recording in each raga was chosen from them, and the evolution uses typical (median) pieces, not the best."],
                  ["How big is the model? What did it cost?", "Qwen3-0.6B (0.6 billion parameters) with small LoRA adapters, trained on a MacBook with MLX: no cloud GPUs."],
                  ["Can it sing words?", "Not here. It writes notes; a bandish's words were an experiment that isn't part of this site."],
                  ["Are the raga rules right?", "They follow standard Bhatkhande descriptions and were checked against recordings, but no musician has reviewed them yet. Corrections are welcome."],
                  ["Can I run the model myself?", "Yes: it is on Hugging Face as dev-y/qwen3-0.6b-grpo-indian-classical-ragaz (CC BY-NC 4.0). One command writes a raga, scores it and saves a WAV: uv run https://huggingface.co/dev-y/qwen3-0.6b-grpo-indian-classical-ragaz/resolve/main/compose.py yaman. It runs on any computer with Python, CPU included."],
                  ["Can I use the music or the code?", "The code is on GitHub. The model and several datasets behind the measures and the voice are licensed for non-commercial use only (see Data), so the site, the model and its recordings are non-commercial."],
                  ["Does Sing record me?", "No. Pitch tracking and the reading run in your browser; no audio leaves the page."],
                ].map(([q, a]) => <div key={q} className="py-4"><dt className="font-display text-[20px] text-kajal">{q}</dt><dd className="mt-1">{a}</dd></div>)}
              </dl>
            </article>

            <div className="border-t-2 border-kajal pt-6 text-[13px] uppercase tracking-[0.24em] text-sepia">Reference</div>

            <article id="notation" className="scroll-mt-28">
              <h2 className={h2}>Notation</h2>
              <p className="mt-6">The model writes plain-text sargam. Each token is one beat; <C>|</C> separates bars. Uppercase letters are natural (shuddh) notes and lowercase are flat (komal), except Ma: <C>m</C> is natural and <C>M</C> is sharp (tivra). A dot before a note means the lower octave, an apostrophe after it the upper. <C>-</C> holds the previous note for another beat; two notes in one token split the beat.</p>
              <pre className="mt-6 whitespace-pre-wrap break-words rounded-2xl bg-kajal p-6 font-mono text-[15px] leading-[1.9] tracking-wider text-paper">{ex.split(" | ").reduce((acc: string[], bar, i) => { (i % 4 ? acc[acc.length - 1] += "  |  " + bar : acc.push(bar)); return acc; }, []).join("\n")}</pre>
              <p className="mt-2 text-[14px] text-sepia">A piece by the newest model, four bars to a line.</p>
            </article>
            <article id="reward" className="scroll-mt-28">
              <h2 className={h2}>The reward</h2>
              <p className="mt-6">One function scores every piece between 0 and 1, and the model learns to raise it. It changed as the model grew: each time the model found a way to score well without sounding like the raga, the reward was fixed. Hard rules multiply, so one broken rule sinks the whole score (the model found a way to cheat every rule that was merely added); style terms are added up and measured against real recordings.</p>
              <h3 className="mt-6 font-display text-[26px] text-kajal">The newest reward ({L?.style ?? "v6"}), which trained the newest model</h3>
              <div className="no-scrollbar relative mt-4 overflow-x-auto rounded-2xl border border-rule bg-paper p-4 text-kajal sm:p-6 [&_.katex]:text-[0.72em] sm:[&_.katex]:text-[1.0em]" dangerouslySetInnerHTML={{ __html: eq6 }} />
              <p className="mt-2 text-[14px] text-sepia">For sixteen bars, a tenth of the style weight goes to <C>arc</C>.</p>
              <ul className="mt-4 space-y-2 text-[16px]">
                {[["format", "every token is valid notation"], ["purity", "no note the raga forbids (one forbidden note costs most of the score)"], ["beats", "every bar has exactly four beats"], ["variety", "no repeated bars, long runs of one note or too many holds"], ["length", "the asked-for number of bars"], ["rhythm", "note lengths spread like a real singer's, not one note per beat"], ["tala", "whole cycles, ending on Sa or a resting note"], ["rank", "the raga's most important notes (vadi, samvadi) are among its most used"], ["pakad", "uses the raga's signature phrase, without spamming it"], ["phrases", "four-note figures mined from real concerts of the raga"], ["motion", "sizes of melodic steps like real singers'"], ["register", "time in each octave like real singers' (they spend a fifth to nearly half of it in the upper one)"], ["arc", "a long piece's shape: the first half stays lower, the second rises"]].map(([k, d]) => (
                  <li key={k} className="grid grid-cols-[6rem_1fr] gap-4 border-t border-rule pt-2"><code className="text-kajal">{k}</code><span>{d}</span></li>
                ))}
              </ul>
              <h3 className="mt-8 font-display text-[26px] text-kajal">The earlier reward (v2), which scores you on Compose</h3>
              <div className="no-scrollbar relative mt-4 overflow-x-auto rounded-2xl border border-rule bg-paper p-4 text-kajal sm:p-6 [&_.katex]:text-[0.72em] sm:[&_.katex]:text-[1.0em]" dangerouslySetInnerHTML={{ __html: eq }} />
              <p className="mt-2 text-[15px]">Eight bars; <C>allowed</C> is the share of notes in the raga, <C>profile</C> the time on each note against real singers. It runs in your browser, so Compose can score you as you type.</p>
            </article>
            <article id="training" className="scroll-mt-28">
              <h2 className={h2}>Training</h2>
              <p className="mt-6">Base model: Qwen3-0.6B, adapted with LoRA, trained on a MacBook with MLX. Reinforcement learning uses GRPO: eight attempts per prompt; each attempt's advantage is its reward minus the group's mean, divided by the group's spread, so attempts better than their siblings become more likely. Reinforcement learning alone couldn't teach the notes of Malkauns (every attempt scored zero, so there was nothing to prefer), so a supervised step came first: fine-tuning on good pieces written when the rules were in the prompt. Later stages added 16 bars, rhythm, register and ten more ragas; the newest is run <C>{L?.run ?? "v6"}</C> at step {L?.step ?? 60}.</p>
            </article>
            <article id="data" className="scroll-mt-28">
              <h2 className={h2}>Data</h2>
              <ul className="mt-6 space-y-3 text-[16px]">
                <li className="border-t border-rule pt-3"><b>Concerts for the style measures and the reader:</b> pitch tracks from the CompMusic Indian Art Music Raga Recognition Dataset (features), Gulati et al., Zenodo 10.5281/zenodo.7278506, CC BY 4.0. The first measures used {data ? Object.values(data.masters.ragas).reduce((a, r) => a + r.recordings, 0) : 30} recordings of three ragas; the newest use {L?.concerts.recordings ?? 118} across {L?.concerts.ragas ?? 12} ragas, {L?.concerts.held_out ?? 36} held out. Only pitch tracks are used, never the audio.</li>
                <li className="border-t border-rule pt-3"><b>The recordings' voice:</b> trained on vocals separated with Demucs (MIT) from 16 Hindustani concerts in Saraga 1.5, Zenodo 10.5281/zenodo.4301737, CC BY-NC-SA 4.0. Non-commercial and share-alike, so the recordings are too.</li>
                <li className="border-t border-rule pt-3"><b>Raga rules:</b> standard Bhatkhande descriptions (notes, vadi and samvadi, pakad, hour), not yet reviewed by a musician.</li>
                <li className="border-t border-rule pt-3"><b>Paintings:</b> museum open-access collections, listed under Images.</li>
              </ul>
            </article>
            <article id="images" className="scroll-mt-28">
              <h2 className={h2}>Images</h2>
              <p className="mt-6">Ragamala (“garland of ragas”) paintings depict each raga as a scene of its mood and hour. Those used here:</p>
              <ul className="mt-6 space-y-3 text-[16px]">
                {Object.values(PAINTINGS).map((p) => (
                  <li key={p.src} className="border-t border-kajal/15 pt-3"><span className="italic text-kajal">{p.title}</span>, {p.place}, {p.date}. {p.museum}, {p.credit}. {p.licence}. <a href={p.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Source ↗</a></li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
