"use client";

// The newest model (v5e): its 16-bar pieces as actual recordings (rendered on the Mac with the
// learned DDSP voice of Carnatic women singers, or the flute synth), with the notation lit in sync.

import { useEffect, useMemo, useRef, useState } from "react";
import { Bhatkhande } from "@/components/Bhatkhande";
import { Magnetic } from "@/components/Magnetic";
import { FloralBand, Folio, Hashiya, Rubric } from "@/components/Ornament";
import { Plate } from "@/components/Plate";
import { Reveal } from "@/components/Text";
import { PAINTINGS } from "@/lib/art";
import { linePoints, pathFrom, pieceEnd, pitchRange } from "@/lib/line";
import { type Data, stop, tick, useSite } from "@/lib/site";

const INTRO = 3.0; // seconds of tanpura before the first note (ragaz render --intro)

export function Newest({ data }: { data: Data }) {
  const L = data.latest;
  const [rk, setRk] = useState("yaman");
  const [voice, setVoice] = useState<"vocal" | "expressive">("vocal");
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const rec = L.recordings.find((r) => r.raga === rk)!;
  const raga = data.allRagas.find((r) => r.key === rk)!;
  const beat = 60 / rec.tempo;
  const head = playing || t > 0 ? (t - INTRO) / beat : null;
  const beats = Math.ceil(pieceEnd(rec.notes));

  // one sound at a time: the site player pauses this, and this stops the site player
  useEffect(() => useSite.subscribe((s) => { if (s.playing) audio.current?.pause(); }), []);
  useEffect(() => {
    const a = audio.current!;
    let raf = 0;
    const loop = () => { setT(a.currentTime); raf = requestAnimationFrame(loop); };
    const onPlay = () => { setPlaying(true); raf = requestAnimationFrame(loop); };
    const onStop = () => { setPlaying(false); cancelAnimationFrame(raf); };
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onStop);
    a.addEventListener("ended", () => { onStop(); setT(0); });
    return () => { cancelAnimationFrame(raf); a.removeEventListener("play", onPlay); a.removeEventListener("pause", onStop); };
  }, []);
  // switching the voice keeps playing from the same moment; switching raga starts over
  const prev = useRef(rk);
  useEffect(() => {
    const a = audio.current!;
    const sameRaga = prev.current === rk;
    prev.current = rk;
    const at = sameRaga ? a.currentTime : 0, was = !a.paused;
    a.src = rec.files[voice];
    const seek = () => { a.currentTime = at; a.removeEventListener("loadedmetadata", seek); };
    if (at) a.addEventListener("loadedmetadata", seek);
    setT(at);
    if (was) a.play();
  }, [rk, voice, rec]);

  const toggle = () => {
    tick();
    const a = audio.current!;
    if (a.paused) {
      stop();
      a.play();
    } else a.pause();
  };

  // the melody line, lit up to the playhead
  const W = 1000, H = 230;
  const [lo, hi] = pitchRange(rec.notes, 1);
  const end = pieceEnd(rec.notes);
  const x = (b: number) => 10 + (b / end) * (W - 20);
  const d = useMemo(() => pathFrom(linePoints(rec.notes, x, (s) => 12 + (1 - (s - lo) / (hi - lo)) * (H - 24))), [rec]); // eslint-disable-line react-hooks/exhaustive-deps
  const cut = head === null ? 0 : x(Math.max(0, Math.min(end, head)));

  return (
    <section className="relative">
      <FloralBand />
      <div className="mx-auto max-w-[1400px] px-6 py-28 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <Reveal>
            <div className="flex items-center gap-4"><Folio n={3} /><Rubric>The newest model · {L.label}</Rubric></div>
            <h2 className="mt-6 max-w-[16ch] font-display text-[clamp(46px,6.4vw,104px)] leading-[0.95] text-kajal">Sixteen bars, <span className="italic text-sindoor">and it rises.</span></h2>
            <p className="mt-6 max-w-[50ch] text-[19px] leading-[1.6] text-sepia">
              The latest model writes twice as long, climbs into the upper octave the way real singers do, and moves in uneven runs and holds instead of a metronome. These are its pieces as recordings, for all {data.allRagas.length} ragas.
            </p>
          </Reveal>
          <div className="flex flex-wrap gap-2 font-sans">
            {data.allRagas.map((r) => (
              <button key={r.key} onClick={() => { tick("soft"); setRk(r.key); }} className={`rounded-full border px-5 py-2.5 text-[15px] transition-all ${r.key === rk ? "border-kajal bg-kajal text-paper" : "border-kajal/20 hover:border-sindoor"}`}>
                {r.name} <span className="ml-1 font-display opacity-70">{r.devanagari}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_300px]">
          <div>
            <Hashiya>
              <div className="leaf-card p-5 sm:p-8">
                <div className="flex flex-wrap items-center gap-4">
                  <button data-cursor={playing ? "Pause" : "Listen"} onClick={toggle} className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-sindoor text-paper transition hover:bg-kajal">
                    {playing ? "❚❚" : <span className="ml-1 text-[20px]">▶</span>}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[28px] leading-none text-kajal">{raga.name} <span className="text-[20px] text-sepia">{raga.devanagari}</span></div>
                    <div className="mt-1 font-sans text-[13.5px] text-sepia">{rec.bars} bars · {rec.tempo} bpm · {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}{head !== null && head < 0 ? " · tanpura first" : ""}</div>
                  </div>
                  <div className="flex rounded-full border border-rule p-1 font-sans text-[14px]">
                    {(["vocal", "expressive"] as const).map((v) => (
                      <button key={v} onClick={() => { tick("soft"); setVoice(v); }} className={`rounded-full px-4 py-1.5 transition ${voice === v ? "bg-kajal text-paper" : "text-kajal"}`}>{v === "vocal" ? "Voice" : "Flute"}</button>
                    ))}
                  </div>
                </div>
                <svg viewBox={`0 0 ${W} ${H}`} className="mt-6 w-full overflow-visible">
                  <clipPath id="nw-clip"><rect x="0" y="-20" width={cut} height={H + 40} /></clipPath>
                  {[12, 0].map((s) => s >= lo && s <= hi && <line key={s} x1="0" x2={W} y1={12 + (1 - (s - lo) / (hi - lo)) * (H - 24)} y2={12 + (1 - (s - lo) / (hi - lo)) * (H - 24)} stroke="#CDB690" strokeDasharray={s ? "3 7" : ""} />)}
                  <path d={d} fill="none" stroke="#131A2B" strokeOpacity={playing ? 0.25 : 0.85} strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ transition: "stroke-opacity .4s" }} />
                  <path d={d} fill="none" stroke="#B23A22" strokeWidth="2.6" clipPath="url(#nw-clip)" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="mt-6"><Bhatkhande notes={rec.notes} beats={beats} head={head !== null && head >= 0 ? head : null} /></div>
                <audio ref={audio} preload="metadata" />
              </div>
            </Hashiya>
            <p className="mt-5 max-w-[80ch] font-sans text-[13px] leading-[1.6] text-sepia">
              {voice === "vocal" ? `Voice: ${L.voices.vocal}.` : `Flute: ${L.voices.expressive}.`} Rendered on the Mac from the model's notation; the notes are exactly what it wrote. Run {rec.run}, step {rec.step}{rec.reward !== null ? `, scored ${rec.reward.toFixed(2)} by its v5 reward` : ""}.
            </p>
          </div>
          <div className="space-y-6">
            {PAINTINGS[rk] && <Plate p={PAINTINGS[rk]} tone="paper" className="mx-auto w-[min(70vw,280px)] -rotate-1" />}
            <div className="text-center"><Magnetic href={`/ragas?model=${L.label}#library`} cursor="Open">All {L.pieces.length} {L.label} pieces →</Magnetic></div>
          </div>
        </div>
      </div>
    </section>
  );
}
