"use client";

import { useEffect, useMemo, useState } from "react";
import { Footer } from "@/components/Footer";
import { FloralBand } from "@/components/Ornament";
import { Magnetic } from "@/components/Magnetic";
import { PieceCard } from "@/components/PieceCard";
import { RiseChars } from "@/components/Text";
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

export default function Listen() {
  const data = useData();
  const [raga, setRaga] = useState("all");
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    const m = new URLSearchParams(window.location.search).get("model");
    if (m) setModel(m);
  }, []);
  const newest = data?.latest.label ?? "v5e";
  const current = model ?? newest;
  const MODELS = [{ key: newest, label: `Newest · ${newest}`, note: `16 bars, ${data?.latest.ragas.length ?? 4} ragas, scored by its own ${data?.latest.style ?? "v5"} reward` }, ...OLDER];
  const [sort, setSort] = useState<"best" | "order">("best");
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

  return (
    <main className="min-h-screen bg-transparent">
      <section className="relative overflow-hidden px-6 pb-12 pt-36 sm:px-10">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[640px] w-[640px] rounded-full bg-sindoor/10 blur-[140px]" />
        <div className="relative mx-auto max-w-[1400px]">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">The library</div>
          <h1 className="mt-4 font-display text-[clamp(72px,13vw,220px)] leading-[0.85]"><RiseChars text="Listen." /></h1>
          <div className="mt-10 flex flex-wrap items-end justify-between gap-8">
            <p className="max-w-[44ch] text-[19px] leading-[1.6] text-sepia">
              {data.pieces.length + data.latest.pieces.length} pieces, each written by the model from nothing but a raga's name. Showing {tracks.length} by the <span className="text-kajal">{m.label.toLowerCase()}</span>, {m.note}.
            </p>
            <Magnetic variant="solid" size="lg" cursor="Play all" onClick={() => { useSite.getState().set({ queue: tracks }); if (tracks[0]) play(tracks[0], { open: true }); }}>▶ Play all, full screen</Magnetic>
          </div>
          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-4 border-t border-rule pt-8">
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
      <FloralBand />
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
