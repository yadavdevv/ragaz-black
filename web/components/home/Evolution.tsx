"use client";

// How it learned: one piece from each training stage, for the ragas every stage knew, sung by the
// same voice in the same way so only the composing differs. Each stage's piece is its median by its
// own score (typical, not the best); all are scored again with one yardstick, the newest reward.

import { useEffect, useRef, useState } from "react";
import { stop as stopSite, tick, type Data } from "@/lib/site";

const PARTS: [string, string][] = [["rhythm", "rhythm like a singer's"], ["register", "uses the upper octave"], ["pakad", "the signature phrase"]];

export const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** How many training stages the evolution shows (the same for every raga in it). */
export const stageCount = (data: Data) => new Set(data.evolution.map((s) => s.stage)).size;

export function Evolution({ data, raga: only }: { data: Data; raga?: string }) {
  const ragas = [...new Set(data.evolution.map((s) => s.raga))];
  const [rk, setRk] = useState(only ?? ragas[1] ?? ragas[0]);
  const [on, setOn] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const stages = data.evolution.filter((s) => s.raga === rk);
  useEffect(() => () => audio.current?.pause(), []);
  if (!stages.length) return null;
  const name = (k: string) => data.allRagas.find((r) => r.key === k)?.name ?? k;
  const play = (file: string | null, key: string) => {
    const a = audio.current;
    if (!a || !file) return;
    tick();
    if (on === key) { a.pause(); setOn(null); return; }
    stopSite();
    a.src = file; a.currentTime = 0; a.play().catch(() => {}); setOn(key);
  };
  return (
    <div>
      {!only && (
        <div className="flex flex-wrap gap-2">
          {ragas.map((k) => <button key={k} onClick={() => { audio.current?.pause(); setOn(null); setRk(k); }} className={`rounded-full border px-5 py-2 text-[15px] transition-colors ${k === rk ? "border-kajal bg-kajal text-paper" : "border-rule hover:border-sindoor/60"}`}>{name(k)}</button>)}
        </div>
      )}
      <div className="mt-6 divide-y divide-rule border-y border-rule">
        {stages.map((s) => {
          const key = `${s.raga}-${s.stage}`;
          return (
            <div key={key} className="grid items-center gap-x-6 gap-y-2 py-4 md:grid-cols-[7.5rem_3rem_1fr_15rem]">
              <div>
                <div className="font-display text-[24px] leading-none text-kajal">{s.label}</div>
                <div className="mt-1 text-[12px] text-sepia">{s.bars} bars{s.asked && s.asked !== s.bars ? `, asked for ${s.asked}` : ""}</div>
              </div>
              <button onClick={() => play(s.file, key)} disabled={!s.file} className={`grid h-11 w-11 place-items-center rounded-full text-[15px] text-paper ${on === key ? "bg-sindoor" : "bg-kajal"}`} aria-label={`Play the ${s.label} piece`}>{on === key ? "■" : "▶"}</button>
              <div className="text-[15px] leading-[1.5] text-sepia">{s.what}</div>
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper2"><div className="h-full rounded-full bg-sindoor" style={{ width: `${s.v6_score * 100}%` }} /></div>
                  <span className="w-10 text-right font-display text-[20px] tabular-nums text-kajal">{s.v6_score.toFixed(2)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-sepia">
                  {PARTS.map(([k, l]) => <span key={k} title={l}>{k} <span className={`tabular-nums ${s.parts[k] >= 0.5 ? "text-kajal" : "text-sindoor"}`}>{(s.parts[k] ?? 0).toFixed(2)}</span></span>)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 max-w-[90ch] text-[13px] leading-[1.6] text-sepia">
        Each stage's piece is a typical one (its median by the score it was trained with), all sung by the same voice in the same way, so what changes is only what was written. The bar is one yardstick for every stage: the newest reward, at the length each stage was asked for. Early pieces move one note per beat (rhythm 0) and mostly stay in one octave; later ones vary their rhythm and climb. <a href="/docs#evolution" className="underline underline-offset-4">How this is measured</a>
      </p>
      <audio ref={audio} onEnded={() => setOn(null)} preload="none" />
    </div>
  );
}
