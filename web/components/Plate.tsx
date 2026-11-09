"use client";

// A ragamala painting in its mount: wasli paper, a vermilion rule and a gold hairline,
// as miniatures are mounted. Tilts toward the pointer; click to see it whole.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Painting } from "@/lib/art";
import { tick } from "@/lib/site";

export function Plate({ p, className = "", caption = true, tone = "night" }: { p: Painting; className?: string; caption?: boolean; tone?: "night" | "paper" | "gulal" }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    ref.current!.style.transform = `perspective(900px) rotateY(${x * 7}deg) rotateX(${-y * 7}deg) translateZ(0)`;
    ref.current!.style.setProperty("--sx", `${(x + 0.5) * 100}%`);
    ref.current!.style.setProperty("--sy", `${(y + 0.5) * 100}%`);
  };
  const leave = () => ref.current && (ref.current.style.transform = "");
  const sub = tone === "paper" ? "text-sepia" : tone === "gulal" ? "text-kajal/70" : "text-paper/70";

  return (
    <figure className={className}>
      <button ref={ref} data-cursor="View" onClick={() => { tick(); setOpen(true); }} onPointerMove={move} onPointerLeave={leave}
        className="wasli relative block w-full rounded-[6px] p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,.65)] transition-transform duration-500 ease-out sm:p-4">
        <div className="relative border border-sindoor/80 p-[3px]">
          <div className="border border-[#B8923F]/80">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={`${p.title}, ${p.place}, ${p.date}`} className="block w-full" loading="lazy" />
          </div>
          <span className="pointer-events-none absolute inset-0 opacity-60 mix-blend-soft-light [background:radial-gradient(60%_50%_at_var(--sx,50%)_var(--sy,30%),rgba(255,240,210,.55),transparent_70%)]" />
        </div>
      </button>
      {caption && (
        <figcaption className={`mt-3 text-[13px] leading-snug ${sub}`}>
          {p.standIn && <span className="mb-1 block not-italic text-sindoor">{p.standIn}</span>}
          <span className="italic">{p.title}</span> · {p.place}, {p.date} · {p.museum}
        </figcaption>
      )}
      {mounted && open && createPortal(
        <div className="night-sky fixed inset-0 z-[95] flex items-center justify-center p-6" onClick={() => setOpen(false)} data-cursor="Close">
          <div className="grid max-h-full w-full max-w-6xl items-center gap-10 lg:grid-cols-[1fr_22rem]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={p.title} className="mx-auto max-h-[86vh] w-auto rounded-sm shadow-2xl" />
            <div className="text-paper">
              <div className="font-sans text-[12px] uppercase tracking-[0.24em] text-gulal">Ragamala · a garland of ragas</div>
              <div className="mt-3 font-display text-[44px] leading-[0.95]">{p.title}</div>
              <div className="mt-2 text-[15px] text-paper/70">{p.place}, {p.date}</div>
              <p className="mt-6 text-[18px] leading-[1.6] text-paper/90">{p.note}</p>
              <p className="mt-6 text-[14px] leading-[1.6] text-paper/65">Ragamala paintings give each raga a scene: its mood, its hour, its characters. {p.museum}, {p.credit}. {p.licence}.</p>
              <div className="mt-6 flex gap-4 text-[14px]">
                <a href={p.url} target="_blank" rel="noreferrer" className="underline decoration-paper/40 underline-offset-4 hover:text-gulal">At the museum ↗</a>
                <button onClick={() => setOpen(false)} className="text-paper/60 hover:text-paper">Close · Esc</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </figure>
  );
}
