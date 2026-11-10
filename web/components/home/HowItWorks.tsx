"use client";

// The training loop, scrubbed by scroll, drawn like a manuscript diagram:
// ask → write → notation → score → learn → again.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useMemo, useRef, useState } from "react";
import { Folio, Hashiya, Rubric } from "@/components/Ornament";
import { linePoints, pathFrom, pieceEnd, pitchRange } from "@/lib/line";
import type { Data } from "@/lib/site";

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  { t: "Ask", d: "The model gets one line: the name of a raga. No notes, no rules." },
  { t: "Write", d: "A 0.6-billion-parameter language model writes a melody, one token at a time." },
  { t: "Notation", d: "Out comes sargam, four beats to a bar (eight bars at first, sixteen now). Your browser can sing it." },
  { t: "Score", d: "A program checks it: notes in the raga, rhythm intact, no loops, and how close it sounds to real singers." },
  { t: "Learn", d: "It writes eight attempts per prompt. Those that beat the group's average become more likely. Then again, thousands of times." },
];

export function HowItWorks({ data }: { data: Data }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);
  const piece = useMemo(() => [...data.pieces].filter((x) => x.model === "v2" && x.raga === "bhupali").sort((a, b) => b.reward - a.reward)[1], [data]);
  const group = useMemo(() => data.pieces.filter((x) => x.model === "v2" && x.raga === "bhupali").slice(0, 8).map((x) => x.reward), [data]);

  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px)", () => {
      setWide(true);
      const st = ScrollTrigger.create({ trigger: wrap.current, start: "top top", end: "+=360%", pin: true, scrub: true, onUpdate: (s) => setP(s.progress) });
      return () => st.kill();
    });
    mm.add("(max-width: 1023px)", () => setWide(false));
    return () => mm.revert();
  }, []);

  const step = Math.min(4, Math.floor(p * 5));
  const local = Math.min(1, (p * 5) % 1 || (p >= 1 ? 1 : 0));
  const prompt = "Compose a raga: Bhupali";
  const W = 560, H = 170;
  const [lo, hi] = pitchRange(piece.notes, 1);
  const end = pieceEnd(piece.notes);
  const d = pathFrom(linePoints(piece.notes, (t) => (t / end) * W, (s) => 10 + (1 - (s - lo) / (hi - lo)) * (H - 20)));
  const mean = group.reduce((a, b) => a + b, 0) / group.length;
  const tokens = piece.notation.split(" ");
  // five steps on a pentagon around the edge, clear of the card in the middle
  const ring = [{ x: 300, y: 38 }, { x: 548, y: 205 }, { x: 468, y: 466 }, { x: 132, y: 466 }, { x: 52, y: 205 }];
  const LABEL = [{ dx: 0, dy: -20, a: "middle" }, { dx: 0, dy: -22, a: "middle" }, { dx: 0, dy: 34, a: "middle" }, { dx: 0, dy: 34, a: "middle" }, { dx: 0, dy: -22, a: "middle" }] as const;
  const loopPath = (() => {
    // closed Catmull-Rom spline through the five nodes
    const n = ring.length, k = 1 / 6;
    let d = `M ${ring[0].x} ${ring[0].y}`;
    for (let i = 0; i < n; i++) {
      const p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[(i + 2) % n];
      d += ` C ${p1.x + (p2.x - p0.x) * k} ${p1.y + (p2.y - p0.y) * k}, ${p2.x - (p3.x - p1.x) * k} ${p2.y - (p3.y - p1.y) * k}, ${p2.x} ${p2.y}`;
    }
    return d;
  })();
  const pathRef = useRef<SVGPathElement>(null);
  const [tok, setTok] = useState({ x: ring[0].x, y: ring[0].y });
  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    const pt = el.getPointAtLength(el.getTotalLength() * Math.min(0.999, p));
    setTok({ x: pt.x, y: pt.y });
  }, [p]);

  return (
    <section id="how" ref={wrap} className="wasli relative overflow-hidden lg:h-[100svh]">
      <div className="relative mx-auto grid h-full max-w-[1400px] items-center gap-10 px-6 py-24 sm:px-10 lg:grid-cols-[0.9fr_1.1fr] lg:py-0 lg:pt-20">
        <div>
          <div className="flex items-center gap-4"><Folio n={8} /><Rubric>How it learned</Rubric></div>
          <h2 className="mt-6 font-display text-[clamp(42px,5.6vw,88px)] leading-[0.95] text-kajal">Write. Get scored.<br /><span className="italic text-sindoor">Do it again.</span></h2>
          <ol className="mt-10">
            {STEPS.map((s, i) => (
              <li key={s.t} className={`grid grid-cols-[3rem_1fr] items-baseline border-t border-rule py-4 transition-all duration-500 ${i === step || !wide ? "opacity-100" : "opacity-40"}`}>
                <span className={`font-display text-[20px] ${i === step || !wide ? "text-sindoor" : "text-sepia"}`}>{"१२३४५"[i]}</span>
                <div>
                  <div className="font-display text-[28px] leading-none text-kajal">{s.t}</div>
                  <div className={`overflow-hidden text-[17px] leading-[1.55] text-sepia transition-all duration-700 ease-out ${i === step || !wide ? "mt-2 max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative hidden aspect-[6/5] w-full lg:block">
          <svg viewBox="0 0 600 500" className="absolute inset-0 h-full w-full">
            <path ref={pathRef} d={loopPath} fill="none" stroke="#CDB690" strokeWidth="1.5" strokeDasharray="4 8" />
            <path d={loopPath} fill="none" stroke="#B23A22" strokeWidth="2" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - p} />
            {ring.map((r, i) => (
              <g key={i}>
                <circle cx={r.x} cy={r.y} r={i <= step ? 10 : 7} fill={i <= step ? "#B23A22" : "#F1E6CF"} stroke="#B23A22" strokeWidth="1.5" style={{ transition: "all .5s" }} />
                <text x={r.x + LABEL[i].dx} y={r.y + LABEL[i].dy} textAnchor={LABEL[i].a} fontSize="17" fontFamily="var(--font-display)" fill={i === step ? "#131A2B" : "#4A5166"}>{STEPS[i].t}</text>
              </g>
            ))}
            <circle cx={tok.x} cy={tok.y} r="24" fill="#D9705A" fillOpacity="0.25" />
            <circle cx={tok.x} cy={tok.y} r="7" fill="#131A2B" />
          </svg>

          <Hashiya className="absolute left-1/2 top-1/2 w-[56%] -translate-x-1/2 -translate-y-1/2" corners={false}>
            <div className="leaf-card p-5">
              {step === 0 && (
                <div>
                  <div className="font-sans text-[12px] uppercase tracking-[0.2em] text-sindoor">prompt</div>
                  <div className="mt-3 font-mono text-[21px] text-kajal">{prompt.slice(0, Math.ceil(local * prompt.length * 1.3))}<span className="animate-pulse text-sindoor">▍</span></div>
                </div>
              )}
              {step === 1 && (
                <div>
                  <div className="font-sans text-[12px] uppercase tracking-[0.2em] text-sindoor">0.6B parameters, thinking</div>
                  <div className="mt-4 grid grid-cols-[repeat(16,1fr)] gap-1.5">
                    {Array.from({ length: 96 }, (_, i) => {
                      const v = 0.5 + 0.5 * Math.sin(i * 1.7 + p * 90 + (i % 7));
                      return <span key={i} className="aspect-square rounded-full" style={{ background: `rgba(178,58,34,${0.06 + v * v * 0.75})` }} />;
                    })}
                  </div>
                </div>
              )}
              {step === 2 && (
                <div>
                  <div className="font-sans text-[12px] uppercase tracking-[0.2em] text-sindoor">notation, as written</div>
                  <div className="mt-3 min-h-[3.5em] font-mono text-[17px] leading-relaxed tracking-wider text-kajal">{tokens.slice(0, Math.ceil(local * tokens.length)).join(" ")}</div>
                  <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full">
                    <clipPath id="how-clip"><rect x="0" y="0" width={local * W} height={H} /></clipPath>
                    <path d={d} fill="none" stroke="#D9705A" strokeWidth="2.8" clipPath="url(#how-clip)" />
                  </svg>
                </div>
              )}
              {step === 3 && (
                <div>
                  <div className="font-sans text-[12px] uppercase tracking-[0.2em] text-sindoor">the score</div>
                  <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                    <div className="font-display text-[64px] leading-none text-kajal tabular-nums">{(piece.reward * Math.min(1, local * 1.4)).toFixed(2)}</div>
                    <div className="space-y-1 pb-1 text-[15px] text-kajal">
                      {["Every note in Bhupali", "Four beats in every bar", "No loops", "Sounds like real singers"].map((c, i) => (
                        <div key={c} className={`transition-all duration-500 ${local > i * 0.2 ? "opacity-100" : "translate-x-3 opacity-0"}`}><span className="text-sindoor">✓</span> {c}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {step === 4 && (
                <div>
                  <div className="font-sans text-[12px] uppercase tracking-[0.2em] text-sindoor">eight attempts, judged against their average</div>
                  <div className="mt-4 flex h-36 items-end gap-2">
                    {group.map((r, i) => {
                      const up = r > mean;
                      return (
                        <div key={i} className="flex flex-1 flex-col items-center gap-2">
                          <span className={`font-sans text-[12px] ${up ? "text-sindoor" : "text-sepia"}`}>{up ? "↑" : "↓"}</span>
                          <div className="w-full transition-all duration-700" style={{ height: `${(r * 100 * Math.min(1, local * 2)).toFixed(0)}px`, background: up ? "#B23A22" : "#CDB690" }} />
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-[15px] text-sepia">Above the line: more likely next time. Below: less. That is the whole learning signal.</div>
                </div>
              )}
            </div>
          </Hashiya>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 hidden h-1 bg-rule lg:block"><div className="h-full bg-sindoor" style={{ width: `${p * 100}%` }} /></div>
    </section>
  );
}
