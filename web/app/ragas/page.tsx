"use client";

// Ragas: every raga the composer knows, around the clock, and below them the whole library of
// pieces it wrote (what was /listen). Each raga opens its own page.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Footer } from "@/components/Footer";
import { Magnetic } from "@/components/Magnetic";
import { FloralBand } from "@/components/Ornament";
import { PieceCard } from "@/components/PieceCard";
import { RiseChars } from "@/components/Text";
import { ABOUT } from "@/lib/about";
import { PAINTINGS } from "@/lib/art";
import { ragaOfHour } from "@/lib/music";
import { pieceTrack, play, tick, useData, useSite } from "@/lib/site";

const OLDER = [
  { key: "v2", label: "v2", note: "8 bars, trained against real recordings" },
  { key: "v1", label: "Rules only", note: "trained on our rules alone" },
  { key: "sft", label: "Before RL", note: "fine-tuned on examples, no scoring yet" },
];

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={() => { tick("soft"); onClick(); }} className={`rounded-full border px-5 py-2.5 text-[15px] transition-all duration-300 ${on ? "border-sindoor bg-sindoor text-paper" : "border-rule text-kajal hover:border-sindoor/60"}`}>
      {children}
    </button>
  );
}

const clock = (h: number) => `${h % 12 || 12} ${h % 24 < 12 ? "am" : "pm"}`;

export default function Ragas() {
  const data = useData();
  const [raga, setRaga] = useState("all");
  const [model, setModel] = useState<string | null>(null);
  const [sort, setSort] = useState<"best" | "order">("best");
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("model")) setModel(q.get("model"));
    if (q.get("raga")) setRaga(q.get("raga")!);
    setHour(new Date().getHours());
  }, []);
  const newest = data?.latest.label ?? "v6";
  const current = model ?? newest;
  const MODELS = [{ key: newest, label: `Newest · ${newest}`, note: `16 bars, ${data?.latest.ragas.length ?? 13} ragas, scored by its own ${data?.latest.style ?? "v6"} reward` }, ...OLDER];
  const tracks = useMemo(() => {
    if (!data) return [];
    const pool = current === newest ? data.latest.pieces : data.pieces;
    let ps = pool.filter((p) => p.model === current && (raga === "all" || p.raga === raga));
    if (sort === "best") ps = [...ps].sort((a, b) => b.reward - a.reward);
    return ps.map((p) => pieceTrack(p));
  }, [data, raga, current, newest, sort]);
  if (!data) return null;
  const m = MODELS.find((x) => x.key === current) ?? MODELS[0];
  const chips = current === newest ? data.latest.ragas.map((r) => r.key) : data.ragas.map((r) => r.key);
  // Around the clock: ragas of the hour in time order, the seasonal ones after.
  const ragas = [...data.allRagas].sort((a, b) => (a.hours?.[0] ?? 99) - (b.hours?.[0] ?? 99));
  const now = hour === null ? null : ragaOfHour(data.latest.ragas, hour).key;
  const count = (k: string) => data.latest.pieces.filter((p) => p.raga === k).length + data.pieces.filter((p) => p.raga === k).length;

  return (
    <main className="min-h-screen bg-transparent">
      <section className="relative overflow-hidden px-6 pb-12 pt-36 sm:px-10">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[640px] w-[640px] rounded-full bg-sindoor/10 blur-[140px]" />
        <div className="relative mx-auto max-w-[1400px]">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Around the clock</div>
          <h1 className="mt-4 font-display text-[clamp(72px,13vw,220px)] leading-[0.85]"><RiseChars text="Ragas." /></h1>
          <p className="mt-8 max-w-[56ch] text-[19px] leading-[1.6] text-sepia">
            A raga is a set of notes with its own rules, its own phrases and its own hour. Here are the {data.allRagas.length} the composer knows, in the order of the day: open one to hear its notes and signature phrase and see how real singers use it. Below them, every piece the composer wrote.
          </p>
        </div>
      </section>
      <FloralBand />

      <section className="px-6 py-16 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {ragas.map((r) => {
            const art = PAINTINGS[r.key];
            return (
              <Link key={r.key} href={`/ragas/${r.key}`} onClick={() => tick("soft")} className={`leaf-card group relative flex gap-4 overflow-hidden border p-5 transition-colors ${now === r.key ? "border-sindoor" : "border-rule hover:border-sindoor/60"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-display text-[30px] leading-none group-hover:text-sindoor">{r.name}</span>
                    {now === r.key && <span className="shrink-0 rounded-full bg-sindoor px-2 py-0.5 text-[11px] uppercase tracking-[0.15em] text-paper">now</span>}
                  </div>
                  <div className="mt-1 font-deva text-[18px] text-kajal/55">{r.devanagari}</div>
                  <div className="mt-3 text-[13px] text-kajal/70">{r.hours ? `${clock(r.hours[0])} – ${clock(r.hours[1])}` : r.season ?? r.time}</div>
                  <div className="text-[13px] italic text-kajal/60">{ABOUT[r.key]?.mood ?? r.rasa}</div>
                  <div className="mt-3 font-mono text-[12px] tracking-wider text-kajal/60">{r.swaras.join(" ")}</div>
                  <div className="mt-1 text-[12px] text-sepia">{count(r.key)} pieces</div>
                </div>
                {art && <img src={art.src} alt={art.title} title={art.standIn ?? art.title} className="h-[120px] w-[84px] shrink-0 rounded-sm object-cover opacity-90 shadow-sm" />}
              </Link>
            );
          })}
        </div>
      </section>

      <section id="library" className="scroll-mt-24 px-6 pb-12 sm:px-10">
        <div className="mx-auto max-w-[1400px] border-t border-rule pt-14">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">The library</div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-8">
            <h2 className="font-display text-[clamp(48px,7vw,110px)] leading-[0.9]">Listen.</h2>
            <Magnetic variant="solid" size="lg" cursor="Play all" onClick={() => { useSite.getState().set({ queue: tracks }); if (tracks[0]) play(tracks[0], { open: true }); }}>▶ Play all, full screen</Magnetic>
          </div>
          <p className="mt-6 max-w-[60ch] text-[18px] leading-[1.6] text-sepia">
            {data.pieces.length + data.latest.pieces.length} pieces, each written by the model from nothing but a raga's name. Showing {tracks.length} by the <span className="text-kajal">{m.label.toLowerCase()}</span>, {m.note}.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-t border-rule pt-8">
            <div className="flex flex-wrap gap-2">
              {["all", ...chips].map((k) => <Chip key={k} on={raga === k} onClick={() => setRaga(k)}>{k === "all" ? "All ragas" : data.allRagas.find((r) => r.key === k)?.name ?? k}</Chip>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {MODELS.map((x) => <Chip key={x.key} on={current === x.key} onClick={() => { setModel(x.key); if (x.key !== newest && !data.ragas.some((r) => r.key === raga)) setRaga("all"); }}>{x.label}</Chip>)}
            </div>
            <div className="flex gap-2">
              <Chip on={sort === "best"} onClick={() => setSort("best")}>Highest score</Chip>
              <Chip on={sort === "order"} onClick={() => setSort("order")}>As written</Chip>
            </div>
          </div>
        </div>
      </section>
      <section className="px-6 pb-32 sm:px-10">
        <div key={`${raga}-${model}-${sort}`} className="mx-auto grid max-w-[1400px] gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tracks.map((t, i) => (
            <div key={t.id} style={{ animation: `rise .9s cubic-bezier(.16,1,.3,1) ${Math.min(i, 12) * 50}ms both` }}>
              <PieceCard track={t} queue={tracks} />
              <div className="mt-2 px-2 text-right text-[13px] tabular-nums text-sepia">score {t.reward?.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </section>
      <Footer />
    </main>
  );
}
