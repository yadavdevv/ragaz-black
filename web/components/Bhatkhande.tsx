"use client";

// A piece printed the way Bhatkhande's books print a bandish: Devanagari swaras, ऽ for a
// held beat, dots for lower/upper octave, a line under komal notes and a stroke over tivra
// Ma, the tabla's theka above and the tala signs × २ ० ३ below. One cycle (16 beats) per
// line on wide screens; half a cycle per line on phones.

import { Fragment, useEffect, useState } from "react";
import type { Note } from "@/lib/music";

const DEVA: Record<string, string> = { S: "सा", r: "रे", R: "रे", g: "ग", G: "ग", m: "म", M: "म", P: "प", d: "ध", D: "ध", n: "नि", N: "नि" };
const SIGNS: Record<number, string> = { 0: "×", 4: "२", 8: "०", 12: "३" };
const THEKA = ["धा", "धिं", "धिं", "धा", "धा", "धिं", "धिं", "धा", "धा", "तिं", "तिं", "ता", "ता", "धिं", "धिं", "धा"];

function Swar({ n }: { n: Note }) {
  return (
    <span className="relative inline-block px-[1px] leading-none">
      {n.o > 0 && <span className="absolute -top-[0.35em] left-1/2 -translate-x-1/2 text-[0.5em]">•</span>}
      {n.s === "M" && <span className="absolute -top-[0.45em] left-1/2 h-[0.38em] w-px -translate-x-1/2 bg-current" />}
      <span className={"rgdn".includes(n.s) ? "underline decoration-1 underline-offset-[0.25em]" : ""}>{DEVA[n.s]}</span>
      {n.o < 0 && <span className="absolute -bottom-[0.55em] left-1/2 -translate-x-1/2 text-[0.5em]">•</span>}
    </span>
  );
}

function usePerRow() {
  const [per, setPer] = useState(16);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const f = () => setPer(mq.matches ? 8 : 16);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return per;
}

/** `words`, if given: what is sung in each beat (a syllable, or ऽ where a vowel is held), printed
 *  under the notes as the books print a bandish's text. */
export function Bhatkhande({ notes, beats, head = null, theka = true, words, className = "" }: { notes: Note[]; beats: number; head?: number | null; theka?: boolean; words?: string[]; className?: string }) {
  const per = usePerRow();
  const cells: Note[][] = Array.from({ length: beats }, () => []);
  for (const n of notes) cells[Math.floor(n.t + 1e-6)]?.push(n);
  const rows = Array.from({ length: Math.ceil(beats / per) }, (_, r) => r * per);
  const cur = head === null ? -1 : Math.floor(head);
  const div = (k: number) => (k % 4 === 0 && k ? "border-l border-kajal/25" : "");
  return (
    <div className={`font-deva text-kajal ${className}`}>
      <table className="w-full table-fixed border-collapse text-center">
        <tbody>
          {rows.map((start, ri) => (
            <Fragment key={start}>
              {(theka && (per === 8 || ri === 0)) && (
                <tr className="text-[12px] text-kajal/45 sm:text-[13px]">
                  {Array.from({ length: per }, (_, k) => <td key={k} className={`pb-1 pt-2 ${div(k)}`}>{THEKA[(start + k) % 16]}</td>)}
                </tr>
              )}
              <tr className="border-t border-kajal/15">
                {Array.from({ length: per }, (_, k) => {
                  const b = start + k;
                  if (b >= beats) return <td key={k} className={div(k)} />;
                  const ns = cells[b];
                  return (
                    <td key={k} className={`h-12 text-[19px] transition-colors duration-200 sm:h-14 sm:text-[22px] ${div(k)} ${b === cur ? "bg-gulal/60" : ""}`}>
                      {ns.length === 0 ? <span className="text-kajal/50">ऽ</span> : ns.length === 1 ? <Swar n={ns[0]} /> : (
                        <span className="inline-flex flex-col items-center">
                          <span className="text-[0.8em]">{ns.map((n, i) => <Swar key={i} n={n} />)}</span>
                          <svg viewBox="0 0 40 8" className="-mt-0.5 h-2 w-8"><path d="M2 2 Q20 9 38 2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {words && (
                <tr className="font-sans text-[14px] text-sindoor sm:text-[16px]">
                  {Array.from({ length: per }, (_, k) => {
                    const b = start + k;
                    const w = words[b] ?? "";
                    return <td key={k} className={`h-7 truncate px-0.5 ${div(k)} ${b === cur ? "font-semibold" : ""} ${w === "ऽ" ? "text-sindoor/45" : ""}`}>{w}</td>;
                  })}
                </tr>
              )}
              {(per === 8 || ri === rows.length - 1) && (
                <tr className="text-[13px] text-sindoor">
                  {Array.from({ length: per }, (_, k) => <td key={k} className={`pb-2 pt-1 ${div(k)}`}>{SIGNS[(start + k) % 16] ?? ""}</td>)}
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
