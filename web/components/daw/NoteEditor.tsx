"use client";

// One clip's notes, close up. Rows are the raga's notes (or all twelve, or the drums); click empty
// space to add a note, drag a note to move it, pull its right edge to lengthen it, and set how hard
// each is played in the lane underneath. Every change is heard as you make it.

import { useEffect, useMemo, useRef, useState } from "react";
import { DRUM_ROWS, type Clip, type NoteEv, type Track, uid } from "@/lib/daw/model";
import { type Raga, RATIOS, SWARAS, sargam } from "@/lib/music";
import { snapTo } from "./Timeline";

const ROW = 18, KEYS = 64, VEL = 46;

type Props = {
  clip: Clip;
  track: Track;
  raga: Raga;
  snap: number;
  sa: number;
  playhead: number | null; // beats into the clip
  onChange: (notes: NoteEv[], len?: number) => void;
  onAudition: (s: number) => void;
  onClose: () => void;
};

function label(s: number) {
  const pc = ((s % 12) + 12) % 12, o = Math.floor(s / 12);
  const sw = SWARAS[pc];
  return sargam(sw, "latin") + ("rgdn".includes(sw) ? "♭" : sw === "M" ? "♯" : "") + (o < 0 ? "̣".repeat(-o) : o > 0 ? "̇".repeat(o) : "");
}

export function NoteEditor({ clip, track, raga, snap, sa, playhead, onChange, onAudition, onClose }: Props) {
  const drums = track.inst === "drums";
  const [all12, setAll12] = useState(false);
  const [ppb, setPpb] = useState(48);
  const [sel, setSel] = useState<string[]>([]);
  const [drag, setDrag] = useState<null | { mode: "move" | "resize" | "vel"; ids: string[]; x0: number; y0: number; orig: NoteEv[]; dt: number; drow: number; dlen: number; dv: number }>(null);
  const box = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const step = snap || 0.25;

  // Rows, top to bottom: drums, or pitches from taar Sa down to mandra Sa (raga notes, or all 12).
  const rows = useMemo(() => {
    if (drums) return DRUM_ROWS.map((name, i) => ({ s: i, label: name, sa: false, inRaga: true }));
    const used = clip.notes.map((n) => n.s);
    const lo = Math.min(-12, ...used), hi = Math.max(24, ...used);
    const out: { s: number; label: string; sa: boolean; inRaga: boolean }[] = [];
    for (let s = hi; s >= lo; s--) {
      const inRaga = raga.swaras.includes(SWARAS[((s % 12) + 12) % 12]);
      if (all12 || inRaga || used.includes(s)) out.push({ s, label: label(s), sa: ((s % 12) + 12) % 12 === 0, inRaga });
    }
    return out;
  }, [drums, all12, raga, clip.notes]);
  const rowOf = (s: number) => rows.findIndex((r) => r.s === s);

  // Fit the clip to the panel when a clip opens.
  useEffect(() => {
    const w = (box.current?.clientWidth ?? 900) - KEYS - 24;
    setPpb(Math.max(14, Math.min(120, w / Math.max(4, clip.len))));
    setSel([]);
  }, [clip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect();
    return { beat: Math.max(0, (e.clientX - r.left) / ppb), row: Math.floor((e.clientY - r.top) / ROW) };
  };

  useEffect(() => {
    if (!drag) return;
    const at = (e: PointerEvent) => {
      const dx = (e.clientX - d0.x0) / ppb;
      if (d0.mode === "move") return { ...d0, dt: snapTo(dx, step), drow: Math.round((e.clientY - d0.y0) / ROW) };
      if (d0.mode === "resize") return { ...d0, dlen: snapTo(dx, step) };
      return { ...d0, dv: -(e.clientY - d0.y0) / VEL };
    };
    const d0 = drag;
    const move = (e: PointerEvent) => setDrag(at(e));
    const up = (e: PointerEvent) => {
      const drag = at(e); // the release position counts, even if its last move was missed
      const changed = drag.dt || drag.drow || drag.dlen || drag.dv;
      if (changed) {
        const ids = new Set(drag.ids);
        const next = clip.notes.map((n) => {
          if (!ids.has(n.id)) return n;
          if (drag.mode === "move") {
            const r = Math.max(0, Math.min(rows.length - 1, rowOf(n.s) + drag.drow));
            return { ...n, t: Math.max(0, Math.min(clip.len - step, n.t + drag.dt)), s: rows[r]?.s ?? n.s };
          }
          if (drag.mode === "resize") return { ...n, d: Math.max(step / 2, n.d + drag.dlen) };
          return { ...n, v: Math.max(0.05, Math.min(1, n.v + drag.dv)) };
        });
        onChange(next);
        if (drag.mode === "move" && drag.drow) { const n = next.find((x) => x.id === drag.ids[0]); if (n) onAudition(n.s); }
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  });

  // Delete / select all / nudge, while the editor has the pointer.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel.length) { e.preventDefault(); e.stopPropagation(); onChange(clip.notes.filter((n) => !sel.includes(n.id))); setSel([]); }
      else if ((e.metaKey || e.ctrlKey) && e.key === "a") { e.preventDefault(); e.stopPropagation(); setSel(clip.notes.map((n) => n.id)); }
      else if (sel.length && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); e.stopPropagation(); const d = (e.key === "ArrowLeft" ? -1 : 1) * step; onChange(clip.notes.map((n) => (sel.includes(n.id) ? { ...n, t: Math.max(0, n.t + d) } : n))); }
      else if (sel.length && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); e.stopPropagation(); const d = e.key === "ArrowUp" ? -1 : 1; onChange(clip.notes.map((n) => { if (!sel.includes(n.id)) return n; const r = Math.max(0, Math.min(rows.length - 1, rowOf(n.s) + d)); return { ...n, s: rows[r].s }; })); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const H = rows.length * ROW, W = clip.len * ppb;
  const shown = (n: NoteEv) => {
    if (!drag || !drag.ids.includes(n.id)) return n;
    if (drag.mode === "move") { const r = Math.max(0, Math.min(rows.length - 1, rowOf(n.s) + drag.drow)); return { ...n, t: Math.max(0, n.t + drag.dt), s: rows[r]?.s ?? n.s }; }
    if (drag.mode === "resize") return { ...n, d: Math.max(step / 2, n.d + drag.dlen) };
    return { ...n, v: Math.max(0.05, Math.min(1, n.v + drag.dv)) };
  };
  const tool = (label: string, f: () => void, title?: string) => <button onClick={f} title={title} className="rounded-full border border-rule px-3 py-1 text-[12px] hover:border-sindoor/60">{label}</button>;
  const target = sel.length ? clip.notes.filter((n) => sel.includes(n.id)) : clip.notes;
  const apply = (f: (n: NoteEv) => NoteEv) => { const ids = new Set(target.map((n) => n.id)); onChange(clip.notes.map((n) => (ids.has(n.id) ? f(n) : n))); };
  const stepRaga = (n: NoteEv, k: number) => { if (drums) return n; const r = rows.filter((x) => x.inRaga); const i = r.findIndex((x) => x.s === n.s); return i < 0 ? n : { ...n, s: r[Math.max(0, Math.min(r.length - 1, i - k))].s }; };

  return (
    <div ref={box} className="flex h-full flex-col" onPointerEnter={() => setFocus(true)} onPointerLeave={() => setFocus(false)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2 text-[12px]">
        <span className="font-display text-[18px] text-kajal">{clip.name}</span>
        <span className="text-sepia">{track.name} · {clip.notes.length} notes · {clip.len} beats{sel.length ? ` · ${sel.length} selected` : ""}</span>
        <span className="mx-1 h-4 w-px bg-rule" />
        {!drums && tool("↑ step", () => apply((n) => stepRaga(n, 1)), "Up one note of the raga")}
        {!drums && tool("↓ step", () => apply((n) => stepRaga(n, -1)), "Down one note of the raga")}
        {!drums && tool("+ octave", () => apply((n) => ({ ...n, s: n.s + 12 })))}
        {!drums && tool("− octave", () => apply((n) => ({ ...n, s: n.s - 12 })))}
        {tool("Quantize", () => apply((n) => ({ ...n, t: snapTo(n.t, step), d: Math.max(step, snapTo(n.d, step)) })), "Snap the notes to the grid")}
        {tool("Reverse", () => { const ids = new Set(target.map((n) => n.id)); onChange(clip.notes.map((n) => (ids.has(n.id) ? { ...n, t: Math.max(0, clip.len - n.t - n.d) } : n))); }, "Play the notes backwards")}
        {tool("Humanize", () => apply((n) => ({ ...n, t: Math.max(0, n.t + (Math.random() - 0.5) * 0.05), v: Math.max(0.2, Math.min(1, n.v * (0.85 + Math.random() * 0.25))) })))}
        {tool("Clear", () => { onChange(sel.length ? clip.notes.filter((n) => !sel.includes(n.id)) : []); setSel([]); })}
        <span className="mx-1 h-4 w-px bg-rule" />
        <label className="flex items-center gap-1 text-sepia">Length <input type="number" min={1} max={64} step={1} value={clip.len} onChange={(e) => onChange(clip.notes, Math.max(1, Number(e.target.value)))} className="w-14 rounded border border-rule bg-leaf px-1" /> beats</label>
        {!drums && <label className="flex items-center gap-1 text-sepia"><input type="checkbox" checked={all12} onChange={(e) => setAll12(e.target.checked)} className="accent-sindoor" />all 12 notes</label>}
        <label className="flex items-center gap-1 text-sepia">Zoom <input type="range" min={10} max={160} value={ppb} onChange={(e) => setPpb(Number(e.target.value))} className="w-24 accent-sindoor" /></label>
        <button onClick={onClose} className="ml-auto rounded-full px-3 py-1 text-[12px] text-sepia hover:text-sindoor">Close ✕</button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative flex" style={{ width: W + KEYS + 40 }}>
          {/* the keys: each row's note; click to hear it */}
          <div className="sticky left-0 z-10 shrink-0 border-r border-rule bg-leaf" style={{ width: KEYS }}>
            {rows.map((r) => (
              <button key={r.s} onPointerDown={() => onAudition(r.s)} className={`block w-full truncate px-2 text-right text-[10px] leading-[18px] ${r.sa ? "bg-sona/15 font-semibold text-kajal" : r.inRaga ? "text-kajal/75" : "text-kajal/30"}`} style={{ height: ROW }}>
                {r.label}{!drums && <span className="ml-1 text-kajal/30">{Math.round(sa * RATIOS[((r.s % 12) + 12) % 12] * 2 ** Math.floor(r.s / 12))}</span>}
              </button>
            ))}
            <div className="border-t border-rule px-2 pt-1 text-[10px] text-sepia" style={{ height: VEL + 8 }}>how hard</div>
          </div>
          <div className="relative" style={{ width: W }}>
            <div ref={grid} className="relative cursor-crosshair" style={{ height: H }}
              onPointerDown={(e) => {
                if (e.button || (e.target as HTMLElement).dataset.note) return;
                const { beat, row } = at(e);
                if (!rows[row] || beat >= clip.len) return;
                const n: NoteEv = { id: uid("n"), t: Math.min(clip.len - step, Math.floor(beat / step) * step), d: drums ? step : Math.max(step, 0.5), s: rows[row].s, v: 0.85 };
                onChange([...clip.notes, n]); onAudition(n.s); setSel([n.id]);
              }}>
              {rows.map((r, i) => <div key={r.s} className={`pointer-events-none absolute inset-x-0 border-b ${r.sa ? "border-sona/40 bg-sona/[0.06]" : "border-rule/40"} ${!r.inRaga ? "bg-kajal/[0.04]" : ""}`} style={{ top: i * ROW, height: ROW }} />)}
              <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(to right, rgba(19,26,43,.22) 0 1px, transparent 1px ${4 * ppb}px), repeating-linear-gradient(to right, rgba(19,26,43,.09) 0 1px, transparent 1px ${ppb}px), repeating-linear-gradient(to right, rgba(19,26,43,.04) 0 1px, transparent 1px ${step * ppb}px)` }} />
              {clip.notes.map((n0) => {
                const n = shown(n0), r = rowOf(n.s), on = sel.includes(n.id);
                if (r < 0) return null;
                return (
                  <div key={n.id} data-note="1"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const ids = on ? sel : e.shiftKey ? [...sel, n.id] : [n.id];
                      setSel(ids);
                      if (e.altKey) { const copies = clip.notes.filter((x) => ids.includes(x.id)).map((x) => ({ ...x, id: uid("n") })); onChange([...clip.notes, ...copies]); }
                      setDrag({ mode: (e.target as HTMLElement).dataset.edge ? "resize" : "move", ids, x0: e.clientX, y0: e.clientY, orig: clip.notes, dt: 0, drow: 0, dlen: 0, dv: 0 });
                      onAudition(n.s);
                    }}
                    onDoubleClick={() => { onChange(clip.notes.filter((x) => x.id !== n.id)); setSel([]); }}
                    className={`absolute cursor-grab rounded-[3px] border ${on ? "border-sindoor" : "border-kajal/30"}`}
                    style={{ left: n.t * ppb, top: r * ROW + 2, width: Math.max(5, n.d * ppb - 1), height: ROW - 4, background: on ? "#B23A22" : track.color, opacity: 0.45 + 0.55 * n.v }}
                    title={`${drums ? DRUM_ROWS[n.s] : label(n.s)} · beat ${(n.t + 1).toFixed(2)} · ${n.d} beats · ${Math.round(n.v * 100)}% · double-click to delete`}>
                    <div data-note="1" data-edge="r" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
                  </div>
                );
              })}
              {playhead !== null && playhead >= 0 && playhead <= clip.len && <div className="pointer-events-none absolute top-0 w-px bg-sindoor" style={{ left: playhead * ppb, height: H }} />}
            </div>
            {/* velocity lane */}
            <div className="relative border-t border-rule" style={{ height: VEL + 8 }}>
              {clip.notes.map((n0) => {
                const n = shown(n0);
                return (
                  <div key={n.id} onPointerDown={(e) => { e.stopPropagation(); setSel([n.id]); setDrag({ mode: "vel", ids: [n.id], x0: e.clientX, y0: e.clientY, orig: clip.notes, dt: 0, drow: 0, dlen: 0, dv: 0 }); }}
                    className="absolute bottom-1 w-[5px] cursor-ns-resize rounded-t-sm" style={{ left: n.t * ppb, height: Math.max(3, n.v * VEL), background: sel.includes(n.id) ? "#B23A22" : track.color }} title={`${Math.round(n.v * 100)}%`} />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
