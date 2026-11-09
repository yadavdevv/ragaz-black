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
      <>The <b>How it works</b> and <b>Results</b> links jump to the explanation and to the scores of every model, from the first attempt to the newest.</>,
    ],
    behind: "Every number on the page comes from the exported training runs; nothing is typed in by hand.",
  },
  {
    id: "ragas", page: "Ragas", href: "/ragas", title: "Ragas, and the library",
    for: "Meet the 13 ragas, then listen to everything the composer wrote in them.",
    steps: [
      <>The ragas are laid out around the clock, morning to midnight, then the seasonal ones (Malhar for the rains, Basant for spring). The one marked <b>now</b> is the raga of the current hour.</>,
      <>Open a raga for its own page: tap its notes to hear them (the greyed ones are not allowed in it), play its <b>signature phrase</b> (pakad), hear ten seconds of a real singer's line, and see how real singers spend their time on each note.</>,
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
      <><b>The reading.</b> Your line appears as sargam, and the raga it most resembles, with the notes that gave it away. Then the composer answers with a phrase in that raga, produced as a short track.</>,
      "Sing again to keep the conversation going; earlier turns stay listed. Share any answer.",
    ],
    tips: ["Headphones stop the answer leaking back into the microphone.", "Fewer than three held notes is not enough to read: hold notes longer rather than singing faster.", <>At the bottom, <b>Cousins</b>: ragas hiding in well-known tunes and scales from around the world.</>],
    behind: "Pitch tracking, the note transcription and the raga reading all run in your browser: no audio leaves the page.",
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
    id: "studio", page: "Studio", href: "/studio", title: "Make a piece, up to three minutes",
    for: "The heart of the site: a full studio in the browser. Tracks of clips on a timeline, every note editable, every synth designed from its waves, effects dragged on, played live and exported as a WAV.",
    steps: [
      <><b>Listen first.</b> The studio opens on seven finished pieces, 1 to 2 minutes each: three famous public-domain tunes re-produced (Ode to Joy as lo-fi, Pachelbel's Canon as house, When the Saints as amapiano) and four originals in ragas built from the composer's phrases. Press <b>Listen</b> to hear one there, or <b>Open in the studio</b> to see exactly how it is built. Or start from a 16-bar sketch in any raga, or a blank page. Your last piece waits under “Where you left off”.</>,
      <><b>Press space</b> to play. As it plays, its waveform prints itself under the ruler, the scope at the side shows the live wave and spectrum, and each track's meter moves. The bar under the toolbar walks you through six first steps, one at a time, with a “show me” for each.</>,
      <><b>Add things from the library</b> (right): grooves, the composer's phrases in the raga, bass lines, chords, effects, sounds. Drag one onto a lane, or click it to drop it at the playhead. Dropped below the last track, it makes a new track. Changing the raga changes everything the library offers.</>,
      <><b>Arrange clips.</b> Drag to move (also onto another track), <K>Alt</K>-drag to copy, pull the right edge to lengthen, double-click an empty lane for a new bar. With clips selected: duplicate (<K>⌘D</K>), split at the playhead (<K>S</K>), play twice as fast or half as fast, delete.</>,
      <><b>Work on a stretch of time.</b> Drag on the ruler to select it across all tracks (or drag on empty lane space for just those tracks). Then loop it, copy (<K>⌘C</K>), paste at the playhead (<K>⌘V</K>), repeat it, clear it, or play it twice as fast or half as fast: the music after it moves to make room. <b>Loop</b> (<K>L</K>) loops the bars you picked, or the whole piece if you picked none; a gold bar on the ruler shows what is looping.</>,
      <><b>Simple tools or all of them.</b> The studio starts with the main tools only. <b>All tools</b> adds snapping, the Sa, the zoom slider, ×1.5 and ×0.75, cut, split, and redo.</>,
      <><b>Zoom</b> with the slider, <K>+</K> <K>−</K>, or <K>⌘</K>/<K>Ctrl</K> + scroll; <K>0</K> fits the whole piece. Zoomed in, the grid shows beats and sixteenths.</>,
      <><b>Edit every note.</b> Double-click a clip: its notes open below on rows of the raga's notes (tick “all 12 notes” for the others). Click to add, drag to move, pull the edge to lengthen, drag the bars underneath to set how hard each is played, double-click to delete. Step through the raga, shift octaves, quantize, reverse, humanize. Every note sounds as you place it.</>,
      <><b>Design the sound.</b> Click a track's name and open <b>Sound</b>. For a synth: drag its 16 harmonics and their phases (the wave and its formula update as you drag), its envelope, voices, filter, vibrato and room. Other instruments (sitar, santoor, bansuri, shehnai, sarangi, e-piano, supersaw) can be swapped in with one click.</>,
      <><b>Add effects.</b> 26 of them in six groups: space (echo, ping-pong, dub, hall, room, wide), tone (lo-fi, telephone, drive, air, dark), motion (filter rise and fall, chorus, phaser, tremolo, auto-pan), rhythm (pump, gate), transitions (fade in and out, tape stop, riser) and notes (octave up, stutter, humanize). On a clip, an effect runs only while that clip plays; on a track's name, under the whole track. Set them in <b>Effects</b>.</>,
      <><b>Keep it.</b> It saves itself in this browser as you go. <b>Share</b> copies a link that opens your exact piece; <b>File</b> saves and opens project files; <b>Export WAV</b> renders the whole piece, with a progress bar.</>,
    ],
    tips: ["The cap is three minutes; the dashed line on the timeline marks where it falls at your tempo.", "Undo (⌘Z) undoes anything: a deleted track, a speed change, a paste.", "Set Snap to Off or ⅛ to place things between the beats; Bar for quick arranging.", "Mute (M) and solo (S) on each track to hear one part at a time."],
    behind: "Every sound is synthesised in your browser: synths from their Fourier coefficients (a PeriodicWave, so the drawing is the sound), strings by Karplus–Strong, the bansuri, shehnai and sarangi from waves, noise and formant filters, drums the way drum machines make them. Effects are plain Web Audio nodes (delays fed back into themselves, convolution, filters, wave-shapers, slow oscillators). Playback is scheduled a quarter-second ahead, so edits are heard almost at once.",
  },
  {
    id: "remix", page: "Remix", href: "/remix", title: "A bandish, produced",
    for: "Turn a bandish (a composed song in a raga) into a produced track, with beats, chords and a structure, and download it.",
    steps: [
      <>Pick a bandish on the right, by raga and poet (Kabir, Surdas, Bihari). Its melody and words show as Bhatkhande notation.</>,
      <><b>Pick a sound</b>: Lo-fi, Amapiano, Synthwave, Drop, Night, Rain or Calm. Each raga starts on a style that suits its mood.</>,
      <>Shape it with the knobs: <b>energy</b>, <b>space</b> (reverb and echo), <b>warmth</b>, <b>swing</b>, <b>tempo</b>, <b>voice</b> level.</>,
      <>Each style starts with its own set of instruments. Tap an instrument chip to switch it on or off and hear what it adds.</>,
      <><b>▶ Play the track.</b> The bar under it shows the sections as they pass: sthayi, interlude, antara, taan, mukhda, coda. <b>Download WAV</b> renders the whole track.</>,
    ],
    tips: ["Mute everything but one layer to hear how it is built, then add layers back one at a time.", "Changing anything stops playback; press play again to hear the change."],
    behind: "Every instrument is synthesised in your browser: plucked strings by Karplus–Strong, an FM electric piano, supersaws, and drums built the way drum machines build them. No samples.",
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

const REFERENCE = [
  { id: "notation", t: "Notation" },
  { id: "reward", t: "The reward" },
  { id: "training", t: "Training" },
  { id: "data", t: "Data" },
  { id: "audio", t: "Sound" },
  { id: "images", t: "Images" },
];

export default function Docs() {
  const data = useData();
  const eq = useMemo(() => katex.renderToString(String.raw`\begin{aligned}R=\;&\text{format}\cdot\text{allowed}^2\cdot\text{beats}^2\cdot\text{variety}\cdot\text{length}\\&\cdot\big(0.2\,\text{tala}+0.35\,\text{profile}+0.1\,\text{motion}+0.35\,\text{phrases}\big)\end{aligned}`, { displayMode: true, throwOnError: false }), []);
  const ex = data?.pieces.find((p) => p.model === "v2")?.notation ?? "S R G P | G R D P | …";
  const runs = data ? Object.values(data.journey).map((j) => (j as unknown as { run: string }).run) : [];
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
              <div className="text-[11px] uppercase tracking-[0.22em] text-sepia">Reference</div>
              {REFERENCE.map((s) => <a key={s.id} href={`#${s.id}`} className="block text-kajal/60 hover:text-kajal">{s.t}</a>)}
            </div>
          </nav>

          <div className="min-w-0 max-w-[820px] space-y-24 text-[18px] leading-[1.7] text-kajal/75">
            <article id="start" className="scroll-mt-28">
              <h2 className={h2}>Getting started</h2>
              <p className="mt-6">Ragaz is a small language model that composes Hindustani classical music, and a set of pages to listen to it, sing with it, write against it and make sounds of your own. Everything plays in your browser: there are no recordings and no samples, and nothing you sing leaves the page.</p>
              <ol className="mt-6 space-y-3">
                {[
                  <>Turn your sound on. Headphones are best, and needed on <b>Sing</b>.</>,
                  <>Open <Link href="/ragas" className="underline underline-offset-4">Ragas</Link> and play the raga marked <b>now</b>: the quickest way to hear what the composer makes.</>,
                  <>Then pick by what you want to do: <b>sing</b> and be answered (Sing), <b>write</b> a melody and get it scored (Compose), <b>make a piece</b> of your own, sound by sound and note by note (Studio), <b>remix</b> one of the composer's songs in a style (Remix), or <b>play an instrument</b> (Instruments).</>,
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

            <div className="border-t-2 border-kajal pt-6 text-[13px] uppercase tracking-[0.24em] text-sepia">Reference</div>

            <article id="notation" className="scroll-mt-28">
              <h2 className={h2}>Notation</h2>
              <p className="mt-6">The model writes plain-text sargam. Each token is one beat; <C>|</C> separates bars. Uppercase letters are natural (shuddh) notes and lowercase are flat (komal), except Ma: <C>m</C> is natural and <C>M</C> is sharp (tivra). A dot before a note means the lower octave, an apostrophe after it the upper. <C>-</C> holds the previous note for another beat; two notes in one token split the beat.</p>
              <pre className="mt-6 whitespace-pre-wrap break-words rounded-2xl bg-kajal p-6 font-mono text-[15px] leading-[1.9] tracking-wider text-paper">{ex.split(" | ").reduce((acc: string[], bar, i) => { (i % 4 ? acc[acc.length - 1] += "  |  " + bar : acc.push(bar)); return acc; }, []).join("\n")}</pre>
            </article>
            <article id="reward" className="scroll-mt-28">
              <h2 className={h2}>The reward</h2>
              <p className="mt-6">One function scores every piece, between 0 and 1. The first five terms are hard rules and they multiply, so a single broken rule sinks the whole score. The model found a way to cheat every rule that was merely added. The last four are style, measured against real recordings.</p>
              <div className="no-scrollbar relative mt-6 overflow-x-auto rounded-2xl border border-rule bg-paper p-4 text-kajal sm:p-6 [&_.katex]:text-[0.72em] sm:[&_.katex]:text-[1.08em]" dangerouslySetInnerHTML={{ __html: eq }} />
              <ul className="mt-6 space-y-2 text-[16px]">
                {[["format", "share of tokens that are valid notation (squared)"], ["allowed", "share of notes that belong to the raga"], ["beats", "share of bars with exactly four beats"], ["variety", "penalises repeated bars, long runs of one note, too many holds"], ["length", "the expected number of bars (eight here; the newest models write sixteen)"], ["tala", "whole cycles, and an ending on Sa or a resting note"], ["profile", "time on each note vs real singers (calibrated Jensen–Shannon distance)"], ["motion", "sizes of melodic steps vs real singers"], ["phrases", "4-note figures mined from real concerts of the raga"]].map(([k, d]) => (
                  <li key={k} className="grid grid-cols-[7rem_1fr] gap-4 border-t border-rule pt-2"><code className="text-kajal">{k}</code><span>{d}</span></li>
                ))}
              </ul>
            </article>
            <article id="training" className="scroll-mt-28">
              <h2 className={h2}>Training</h2>
              <p className="mt-6">Base model: Qwen3-0.6B, adapted with LoRA, trained on a MacBook with MLX. Reinforcement learning uses GRPO: eight attempts per prompt, each attempt's advantage is its reward minus the group's mean, divided by the group's spread. Because reinforcement learning couldn't teach the notes of Malkauns, a supervised step came first: fine-tuning on good pieces written when the rules were in the prompt.</p>
              <ul className="mt-6 space-y-1 break-all font-mono text-[14px] text-kajal/70">{runs.map((r) => <li key={r}>{r}</li>)}</ul>
            </article>
            <article id="data" className="scroll-mt-28">
              <h2 className={h2}>Data</h2>
              <p className="mt-6">Real-singer references come from {data ? Object.values(data.masters.ragas).reduce((a, r) => a + r.recordings, 0) : 30} concert recordings in the CompMusic Indian Art Music Raga Recognition Dataset (features), Gulati et al., Zenodo 10.5281/zenodo.7278506, CC BY 4.0. Pitch tracks were turned into notes; some recordings built the style measures and the rest were held out to check them. Bandish texts (Kabir, Surdas, Bihari, Rahim) are from public-domain editions transcribed by Hindi Wikisource contributors (CC BY-SA 4.0). Raga rules follow standard Bhatkhande descriptions and have not yet been reviewed by a musician.</p>
            </article>
            <article id="audio" className="scroll-mt-28">
              <h2 className={h2}>Sound</h2>
              <p className="mt-6">Nothing here is a recording. Your browser reads the notation and sings it with a small synthesiser: a voice shaped by the formants of an open “aa” (aakar), sliding between notes, tuned in just intonation over a four-string tanpura drone. The studio, Remix and the instruments are synthesised the same way, from oscillators, noise, filters and delay lines. The newest model's recordings were rendered on a Mac with a learned voice: a DDSP model (Engel et al., 2020) trained on separately miked vocal tracks from Saraga Carnatic concerts (Zenodo 10.5281/zenodo.4301737, CC BY-NC-SA 4.0). It is given only pitch and loudness, so every note and glide it sings is the model's. The real singers' lines are resynthesised from pitch tracks of concert recordings with the same voice; no recorded audio is used.</p>
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
