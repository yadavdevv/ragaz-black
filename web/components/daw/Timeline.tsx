"use client";

// The arrangement: a ruler, the live waveform printing as it plays, and a lane of clips per track,
// with the track's controls on the left. Drag clips to move them (Alt to copy), pull their right
// edge to resize, double-click to edit their notes; drag on the ruler (or on empty lane space) to
// select a stretch of time. Things from the library drop onto lanes; effects drop onto clips.

import { useEffect, useRef, useState } from "react";
import { FX_BY } from "@/lib/daw/fx";
import { type Clip, DRUM_ROWS, type Project, type Range, type Track, maxBeats, secPerBeat } from "@/lib/daw/model";

export const LANE = 68, HEAD = 216, RULER = 26, PRINT = 34;

export type Drag = { kind: "clip"; clip: Omit<Clip, "id">; drums: boolean; suggest?: string } | { kind: "fx"; type: string } | { kind: "inst"; index: number };
export const DND = "application/x-ragaz";

export const snapTo = (b: number, snap: number) => (snap ? Math.round(b / snap) * snap : Math.round(b * 16) / 16);

type Props = {
  project: Project;
  ppb: number;
  snap: number;
  playhead: number;
  playing: boolean;
  selected: string[];
  range: Range | null;
  selTrack: string | null;
  printRef: React.MutableRefObject<Float32Array>;
  drawRef: React.MutableRefObject<(() => void) | null>; // the page calls it each frame while playing
  loopRange: { a: number; b: number } | null;
  onSeek: (b: number) => void;
  onSelect: (ids: string[], track?: string) => void;
  onRange: (r: Range | null) => void;
  onSelTrack: (id: string) => void;
  onMove: (moves: { id: string; start: number; track?: string }[], copy: boolean) => void;
  onResize: (id: string, len: number) => void;
  onOpen: (id: string) => void;
  onCreate: (track: string, at: number) => void;
  onDrop: (d: Drag, track: string | null, at: number, clip?: string) => void;
  onTrack: (id: string, patch: Partial<Track>) => void;
  onRemoveTrack: (id: string) => void;
  onZoom: (ppb: number, anchorBeat: number) => void;
  scrollRef: React.RefObject<HTMLDivElement>;
};

/** A clip's notes in miniature: bars for melody (pitch up), dots for drum hits. */
function Mini({ clip, drums, color, ppb }: { clip: Clip; drums: boolean; color: string; ppb: number }) {
  const ns = clip.notes.filter((n) => n.t < clip.len);
  if (!ns.length) return null;
  const lo = drums ? 0 : Math.min(...ns.map((n) => n.s)), hi = drums ? DRUM_ROWS.length - 1 : Math.max(...ns.map((n) => n.s));
  const H = LANE - 26, y = (s: number) => 2 + (hi === lo ? H / 2 : ((hi - s) / (hi - lo)) * (H - 6));
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-1" height={H} width={clip.len * ppb}>
      {ns.map((n) => drums
        ? <circle key={n.id} cx={n.t * ppb + 2} cy={y(n.s) + 2} r={Math.max(1.4, Math.min(3, ppb / 10))} fill={color} opacity={0.5 + 0.5 * n.v} />
        : <rect key={n.id} x={n.t * ppb} y={y(n.s)} width={Math.max(1.5, n.d * ppb - 1)} height={3} rx={1.5} fill={color} opacity={0.55 + 0.45 * n.v} />)}
    </svg>
  );
}

export function Timeline(p: Props) {
  const { project, ppb, snap } = p;
  const cap = maxBeats(project), width = cap * ppb;
  const lanes = useRef<HTMLDivElement>(null);
  const printCanvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<null | { mode: "move" | "resize"; id: string; x0: number; y0: number; start: number; len: number; track: string; others: { id: string; start: number }[]; copy: boolean; dx: number; dTrack: number }>(null);
  const [sweep, setSweep] = useState<null | { a: number; b: number; t0: number; t1: number; ruler: boolean }>(null);
  const [hover, setHover] = useState<{ track: string | null; beat: number; clip?: string } | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const [viewW, setViewW] = useState(1200);

  const beatAt = (clientX: number) => {
    const r = lanes.current!.getBoundingClientRect();
    return Math.max(0, Math.min(cap, (clientX - r.left) / ppb));
  };
  const trackAt = (clientY: number) => {
    const r = lanes.current!.getBoundingClientRect();
    return Math.floor((clientY - r.top) / LANE);
  };

  // The printed waveform: what has played, drawn for the visible stretch.
  useEffect(() => {
    const el = p.scrollRef.current;
    if (!el) return;
    const on = () => { setScrollX(el.scrollLeft); setViewW(el.clientWidth); };
    on();
    el.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { el.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, [p.scrollRef]);
  const draw = () => {
    const c = printCanvas.current, el = p.scrollRef.current;
    if (!c || !el) return;
    const sx = el.scrollLeft, w = Math.max(1, el.clientWidth - HEAD), dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = PRINT * dpr; c.style.width = `${w}px`; }
    c.style.left = `${sx}px`;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, PRINT);
    const pr = p.printRef.current, per = 8; // buckets per beat
    const from = Math.max(0, Math.floor((sx / ppb) * per)), to = Math.min(pr.length, Math.ceil(((sx + w) / ppb) * per));
    g.fillStyle = "#131A2B";
    for (let i = from; i < to; i++) {
      const v = pr[i];
      if (!v) continue;
      const h = Math.min(1, v * 1.6) * (PRINT - 4);
      g.fillRect((i / per) * ppb - sx, PRINT / 2 - h / 2, Math.max(1, ppb / per - 0.5), h);
    }
  };
  p.drawRef.current = draw;
  useEffect(draw, [scrollX, viewW, ppb]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moving and resizing clips, and sweeping out a range.
  useEffect(() => {
    if (!drag && !sweep) return;
    // Where the pointer has taken the drag (computed again on release: a fast drag's last move can
    // arrive while the listeners are being re-attached).
    const dragAt = (e: PointerEvent) => {
      const dx = (e.clientX - drag!.x0) / ppb;
      return drag!.mode === "move"
        ? { ...drag!, dx: snapTo(drag!.start + dx, snap) - drag!.start, dTrack: Math.round((e.clientY - drag!.y0) / LANE), copy: e.altKey }
        : { ...drag!, dx: Math.max(snap || 0.25, snapTo(drag!.start + drag!.len + dx, snap) - drag!.start) - drag!.len };
    };
    const sweepAt = (e: PointerEvent) => ({ ...sweep!, b: snapTo(beatAt(e.clientX), snap || 0.25), t1: sweep!.ruler ? sweep!.t1 : Math.max(0, Math.min(project.tracks.length - 1, trackAt(e.clientY))) });
    const move = (e: PointerEvent) => {
      if (drag) setDrag(dragAt(e));
      else if (sweep) setSweep(sweepAt(e));
    };
    const up = (e: PointerEvent) => {
      const drag = dragAt0(e), sweep = sweepAt0(e);
      if (drag) {
        if (drag.mode === "move") {
          const ti = project.tracks.findIndex((t) => t.id === drag.track);
          const dest = project.tracks[Math.max(0, Math.min(project.tracks.length - 1, ti + drag.dTrack))];
          if (drag.dx || drag.dTrack) p.onMove([{ id: drag.id, start: drag.start + drag.dx, track: drag.dTrack ? dest.id : undefined }, ...drag.others.map((o) => ({ id: o.id, start: o.start + drag.dx }))], drag.copy);
        } else if (drag.dx) p.onResize(drag.id, drag.len + drag.dx);
        setDrag(null);
      }
      if (sweep) {
        const a = Math.min(sweep.a, sweep.b), b = Math.max(sweep.a, sweep.b);
        if (b - a < 0.2) { p.onRange(null); p.onSeek(sweep.a); if (!sweep.ruler) p.onSelect([]); }
        else {
          const lo = Math.min(sweep.t0, sweep.t1), hi = Math.max(sweep.t0, sweep.t1);
          p.onRange({ a, b, tracks: sweep.ruler ? undefined : project.tracks.slice(lo, hi + 1).map((t) => t.id) });
        }
        setSweep(null);
      }
    };
    const dragAt0 = (e: PointerEvent) => (drag ? dragAt(e) : null), sweepAt0 = (e: PointerEvent) => (sweep ? sweepAt(e) : null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const wheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    p.onZoom(ppb * (e.deltaY < 0 ? 1.15 : 1 / 1.15), beatAt(e.clientX));
  };

  const dropData = (e: React.DragEvent): Drag | null => { try { return JSON.parse(e.dataTransfer.getData(DND)); } catch { return null; } };
  const bars = Math.ceil(cap / 4);
  const showBeats = ppb >= 14, showSix = ppb >= 70;
  const rng = sweep ? { a: Math.min(sweep.a, sweep.b), b: Math.max(sweep.a, sweep.b), tracks: sweep.ruler ? undefined : project.tracks.slice(Math.min(sweep.t0, sweep.t1), Math.max(sweep.t0, sweep.t1) + 1).map((t) => t.id) } : p.range;
  const spb = secPerBeat(project);

  return (
    <div ref={p.scrollRef} className="relative h-full select-none overflow-auto overscroll-contain" onWheel={wheel}>
      <div style={{ width: width + HEAD + 120 }} className="relative">
        {/* ruler + printed waveform */}
        <div className="sticky top-0 z-20 flex bg-leaf/95 backdrop-blur" style={{ height: RULER + PRINT }}>
          <div className="sticky left-0 z-30 flex shrink-0 flex-col justify-end border-b border-r border-rule bg-leaf px-3 pb-1 text-[11px] text-sepia" style={{ width: HEAD }}>
            <span>bar · time</span>
            <span className="text-kajal/50">what has played, printed live</span>
          </div>
          <div className="relative cursor-text border-b border-rule" style={{ width }}
            onPointerDown={(e) => { if (e.button) return; const b = snapTo(beatAt(e.clientX), snap || 0.25); setSweep({ a: b, b, t0: 0, t1: project.tracks.length - 1, ruler: true }); }}>
            {Array.from({ length: bars + 1 }, (_, i) => (
              <div key={i} className="absolute top-0 h-[26px] border-l border-kajal/25 pl-1 text-[10px] leading-[14px] text-kajal/70" style={{ left: i * 4 * ppb }}>
                {(ppb >= 6 || i % 4 === 0) && <>{i + 1}{ppb >= 22 && <span className="ml-1 text-kajal/35">{Math.floor((i * 4 * spb) / 60)}:{String(Math.floor((i * 4 * spb) % 60)).padStart(2, "0")}</span>}</>}
              </div>
            ))}
            {showBeats && Array.from({ length: cap }, (_, i) => (i % 4 ? <div key={`b${i}`} className="absolute top-[16px] h-[10px] border-l border-kajal/15" style={{ left: i * ppb }} /> : null))}
            <canvas ref={printCanvas} className="pointer-events-none absolute" style={{ top: RULER, height: PRINT }} />
            {p.loopRange && <div className="pointer-events-none absolute top-0 h-[6px] rounded-full bg-sona" style={{ left: p.loopRange.a * ppb, width: (p.loopRange.b - p.loopRange.a) * ppb }} title="Looping" />}
            {rng && <div className="pointer-events-none absolute top-0 h-full bg-sindoor/15 ring-1 ring-sindoor/50" style={{ left: rng.a * ppb, width: (rng.b - rng.a) * ppb }} />}
            <div data-ph className="pointer-events-none absolute top-0 z-10 h-full w-px bg-sindoor" style={{ left: p.playhead * ppb }}>
              <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-sindoor" />
            </div>
          </div>
        </div>

        {/* tracks */}
        <div className="relative flex">
          <div className="sticky left-0 z-10 shrink-0 bg-leaf" style={{ width: HEAD }}>
            {project.tracks.map((t) => (
              <div key={t.id} onClick={() => p.onSelTrack(t.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const d = dropData(e); if (d?.kind === "fx") p.onDrop(d, t.id, -1); }}
                className={`group relative flex flex-col justify-between border-b border-r border-rule px-3 py-1.5 ${p.selTrack === t.id ? "bg-paper2/70" : "bg-leaf"}`} style={{ height: LANE }}>
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: t.color }} />
                <div className="flex items-center gap-1.5">
                  <input value={t.name} onChange={(e) => p.onTrack(t.id, { name: e.target.value })} className="min-w-0 flex-1 truncate bg-transparent font-display text-[16px] leading-none text-kajal outline-none focus:underline" aria-label="Track name" />
                  <button title="Mute" onClick={(e) => { e.stopPropagation(); p.onTrack(t.id, { mute: !t.mute }); }} className={`h-5 w-5 rounded text-[10px] font-bold ${t.mute ? "bg-kajal text-paper" : "border border-rule text-kajal/60"}`}>M</button>
                  <button title="Solo" onClick={(e) => { e.stopPropagation(); p.onTrack(t.id, { solo: !t.solo }); }} className={`h-5 w-5 rounded text-[10px] font-bold ${t.solo ? "bg-sona text-paper" : "border border-rule text-kajal/60"}`}>S</button>
                  <button title="Remove track" onClick={(e) => { e.stopPropagation(); p.onRemoveTrack(t.id); }} className="h-5 w-5 rounded text-[12px] text-kajal/30 opacity-0 hover:text-sindoor group-hover:opacity-100">×</button>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-sepia">
                  <span className="w-14 truncate">{t.inst === "synth" ? `synth · ${t.sound ?? "own"}` : t.inst}</span>
                  <input type="range" min={0} max={1.2} step={0.01} value={t.volume} onChange={(e) => p.onTrack(t.id, { volume: Number(e.target.value) })} onClick={(e) => e.stopPropagation()} className="h-1 w-16 accent-sindoor" title={`Volume ${Math.round(t.volume * 100)}%`} />
                  <input type="range" min={-1} max={1} step={0.05} value={t.pan} onChange={(e) => p.onTrack(t.id, { pan: Number(e.target.value) })} onDoubleClick={() => p.onTrack(t.id, { pan: 0 })} onClick={(e) => e.stopPropagation()} className="h-1 w-10 accent-kajal" title={`Pan ${t.pan === 0 ? "centre" : t.pan < 0 ? `${Math.round(-t.pan * 100)}% left` : `${Math.round(t.pan * 100)}% right`}`} />
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper2"><div data-meter={t.id} className="h-full w-0 rounded-full bg-gradient-to-r from-sona via-gulal to-sindoor" /></div>
                  {t.fx.map((f) => <span key={f.id} title={FX_BY[f.type]?.name} className="rounded bg-kajal/10 px-1 text-[9px] text-kajal/70">{FX_BY[f.type]?.name}</span>)}
                </div>
              </div>
            ))}
            <div className="flex h-12 items-center border-r border-rule px-3 text-[12px] text-sepia">Drop a groove, phrase or sound below to add a track</div>
          </div>

          <div ref={lanes} className="relative" style={{ width }}
            onDragOver={(e) => { e.preventDefault(); const ti = trackAt(e.clientY); setHover({ track: project.tracks[ti]?.id ?? null, beat: snapTo(beatAt(e.clientX), snap || 1) }); }}
            onDragLeave={() => setHover(null)}
            onDrop={(e) => { e.preventDefault(); const d = dropData(e); setHover(null); if (!d) return; const ti = trackAt(e.clientY); const clipEl = (e.target as HTMLElement).closest("[data-clip]") as HTMLElement | null; p.onDrop(d, project.tracks[ti]?.id ?? null, snapTo(beatAt(e.clientX), snap || 1), clipEl?.dataset.clip); }}>
            {/* grid */}
            {project.tracks.map((t, i) => (
              <div key={t.id} className={`absolute inset-x-0 border-b border-rule/70 ${p.selTrack === t.id ? "bg-paper2/40" : i % 2 ? "bg-paper/40" : ""}`} style={{ top: i * LANE, height: LANE }}
                onPointerDown={(e) => { if (e.button || e.target !== e.currentTarget) return; const b = snapTo(beatAt(e.clientX), snap || 0.25); setSweep({ a: b, b, t0: i, t1: i, ruler: false }); }}
                onDoubleClick={(e) => p.onCreate(t.id, Math.floor(beatAt(e.clientX) / 4) * 4)} />
            ))}
            <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: `repeating-linear-gradient(to right, rgba(19,26,43,.13) 0 1px, transparent 1px ${4 * ppb}px)${showBeats ? `, repeating-linear-gradient(to right, rgba(19,26,43,.05) 0 1px, transparent 1px ${ppb}px)` : ""}${showSix ? `, repeating-linear-gradient(to right, rgba(19,26,43,.035) 0 1px, transparent 1px ${ppb / 4}px)` : ""}`, height: project.tracks.length * LANE }} />
            {rng && project.tracks.map((t, i) => (!rng.tracks || rng.tracks.includes(t.id)) && <div key={`r${t.id}`} className="pointer-events-none absolute bg-sindoor/10" style={{ left: rng.a * ppb, width: (rng.b - rng.a) * ppb, top: i * LANE, height: LANE }} />)}
            {/* clips */}
            {project.tracks.map((t, i) => t.clips.map((c) => {
              const sel = p.selected.includes(c.id), moving = drag && (drag.id === c.id || drag.others.some((o) => o.id === c.id));
              const dx = moving && drag!.mode === "move" ? drag!.dx : 0, dy = moving && drag!.mode === "move" && drag!.id === c.id ? drag!.dTrack : 0;
              const len = drag?.id === c.id && drag.mode === "resize" ? drag.len + drag.dx : c.len;
              const hot = hover?.clip === c.id;
              return (
                <div key={c.id}>
                  {moving && drag!.copy && <div className="pointer-events-none absolute rounded-md border border-dashed opacity-60" style={{ left: c.start * ppb, top: i * LANE + 4, width: c.len * ppb, height: LANE - 8, borderColor: t.color }} />}
                  <div data-clip={c.id}
                    onDragOver={() => setHover((h) => (h?.clip === c.id ? h : { track: t.id, beat: c.start, clip: c.id }))}
                    onPointerDown={(e) => {
                      if (e.button) return;
                      e.stopPropagation();
                      const edge = (e.target as HTMLElement).dataset.edge;
                      const ids = sel ? p.selected : [c.id];
                      if (!sel) p.onSelect(e.shiftKey ? [...p.selected, c.id] : [c.id], t.id);
                      const others = (sel ? ids.filter((x) => x !== c.id) : []).map((id) => ({ id, start: project.tracks.flatMap((x) => x.clips).find((x) => x.id === id)!.start }));
                      setDrag({ mode: edge ? "resize" : "move", id: c.id, x0: e.clientX, y0: e.clientY, start: c.start, len: c.len, track: t.id, others, copy: e.altKey, dx: 0, dTrack: 0 });
                    }}
                    onDoubleClick={(e) => { e.stopPropagation(); p.onOpen(c.id); }}
                    className={`absolute cursor-grab overflow-hidden rounded-md border text-left shadow-sm transition-shadow active:cursor-grabbing ${sel ? "ring-2 ring-sindoor ring-offset-1 ring-offset-leaf" : ""} ${hot ? "ring-2 ring-sona" : ""}`}
                    style={{ left: (c.start + dx) * ppb, top: (i + dy) * LANE + 4, width: Math.max(4, len * ppb - 1), height: LANE - 8, background: `${t.color}1f`, borderColor: `${t.color}aa` }}
                    title={`${c.name} · ${c.len} beats · double-click to edit notes`}>
                    <div className="flex items-center gap-1 truncate px-1.5 pt-0.5 text-[10px] font-medium leading-[14px]" style={{ color: t.color === "#131A2B" ? "#131A2B" : t.color }}>
                      <span className="truncate">{c.name}</span>
                      {c.fx.map((f) => <span key={f.id} className="shrink-0 rounded bg-kajal/80 px-1 text-[9px] text-paper">{FX_BY[f.type]?.name}</span>)}
                    </div>
                    <Mini clip={{ ...c, len }} drums={t.inst === "drums"} color={t.color} ppb={ppb} />
                    <div data-edge="r" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-kajal/20" />
                  </div>
                </div>
              );
            }))}
            {/* where a drop will land */}
            {hover && !hover.clip && hover.track && (() => { const i = project.tracks.findIndex((t) => t.id === hover.track); return <div className="pointer-events-none absolute rounded-md border-2 border-dashed border-sindoor/70 bg-sindoor/5" style={{ left: hover.beat * ppb, top: i * LANE + 4, width: 8 * ppb, height: LANE - 8 }} />; })()}
            <div className="absolute inset-x-0 flex items-center border-t border-dashed border-rule text-[12px] text-sepia/70" style={{ top: project.tracks.length * LANE, height: 48 }}
              onDragOver={(e) => { e.preventDefault(); setHover({ track: null, beat: snapTo(beatAt(e.clientX), snap || 1) }); }}>
              {hover && !hover.track && <div className="pointer-events-none absolute h-9 rounded-md border-2 border-dashed border-sindoor/70" style={{ left: hover.beat * ppb, width: 8 * ppb }} />}
            </div>
            {/* the playhead, and the cap */}
            <div data-ph className="pointer-events-none absolute top-0 z-10 w-px bg-sindoor" style={{ left: p.playhead * ppb, height: project.tracks.length * LANE + 48 }} />
            <div className="pointer-events-none absolute top-0 border-l-2 border-dashed border-kajal/40" style={{ left: cap * ppb, height: project.tracks.length * LANE + 48 }}>
              <span className="absolute left-1 top-1 whitespace-nowrap text-[10px] text-kajal/50">3:00 · the end</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
