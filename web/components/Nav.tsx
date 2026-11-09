"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { setDrone, tick, useSite } from "@/lib/site";
import { Rosette } from "./Ornament";

const LEFT = [
  { href: "/ragas", label: "Ragas", match: "/ragas" },
  { href: "/sing", label: "Sing" },
  { href: "/compose", label: "Compose" },
  { href: "/studio", label: "Studio" },
  { href: "/remix", label: "Remix" },
  { href: "/instruments", label: "Instruments" },
];
const RIGHT = [
  { href: "/#how", label: "How it works" },
  { href: "/#results", label: "Results" },
  { href: "/docs", label: "Docs" },
];

/** Four tanpura strings that shimmer while the drone is on. */
function Strings({ on }: { on: boolean }) {
  return (
    <span className="flex h-4 items-center gap-[3px]">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="h-4 w-px bg-current" style={{ animation: on ? `pluck ${0.5 + i * 0.13}s ease-in-out infinite alternate` : "none" }} />
      ))}
      <style>{`@keyframes pluck{from{transform:scaleX(1)}to{transform:scaleX(2.4)}}`}</style>
    </span>
  );
}

export function Nav() {
  const path = usePathname();
  const drone = useSite((s) => s.drone);
  const [menu, setMenu] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = 0;
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > last && y > 240);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setMenu(false), [path]);
  const link = (l: { href: string; label: string; match?: string }) => {
    const on = l.match ? path.startsWith(l.match) : path === l.href;
    return (
      <Link key={l.href} href={l.href} onClick={() => tick("soft")} className={`group relative ${on ? "text-sindoor" : "text-kajal"}`}>
        {l.label}
        <span className={`absolute -bottom-1 left-0 h-px bg-sindoor transition-all duration-500 ease-out ${on ? "w-full" : "w-0 group-hover:w-full"}`} />
      </Link>
    );
  };

  return (
    <>
      <header className={`wasli fixed inset-x-0 top-0 z-[60] border-b border-rule/80 transition-transform duration-500 ease-out lg:inset-x-[22px] lg:top-[22px] ${hidden && !menu ? "-translate-y-full lg:translate-y-[calc(-100%-24px)]" : ""}`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-5 py-3.5 font-sans text-[14.5px] sm:px-10">
          <nav className="hidden items-center gap-8 lg:flex">{LEFT.map(link)}</nav>
          <button className="justify-self-start text-[15px] lg:hidden" onClick={() => { tick(); setMenu(!menu); }}>{menu ? "Close" : "Menu"}</button>
          <Link href="/" data-cursor="Home" onClick={() => tick()} className="flex items-center gap-2.5">
            <Rosette size={14} />
            <span className="font-display text-[26px] leading-none text-kajal">ragaz</span>
            <Rosette size={14} />
          </Link>
          <nav className="flex items-center justify-end gap-8">
            <span className="hidden items-center gap-8 lg:flex">{RIGHT.map(link)}</span>
            <button data-cursor={drone ? "Silence" : "Drone"} onClick={() => setDrone(!drone)} aria-pressed={drone}
              className={`flex items-center gap-2 rounded-full border px-4 py-1.5 transition ${drone ? "border-sindoor bg-sindoor text-paper" : "border-kajal/25 text-kajal hover:border-sindoor hover:text-sindoor"}`}>
              <Strings on={drone} /> <span className="hidden sm:inline">Tanpura</span>
            </button>
          </nav>
        </div>
      </header>
      <div className={`wasli fixed inset-0 z-[55] flex flex-col justify-center gap-2 px-8 transition-[clip-path] duration-700 ease-out lg:hidden ${menu ? "[clip-path:circle(150%_at_0_0)]" : "pointer-events-none [clip-path:circle(0%_at_0_0)]"}`}>
        {[...LEFT, ...RIGHT].map((l) => <Link key={l.href} href={l.href} className="font-display text-[52px] leading-[1.1] text-kajal">{l.label}</Link>)}
      </div>
    </>
  );
}
