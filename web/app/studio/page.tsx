"use client";

// The studio: make a piece of up to three minutes. Tracks of clips on a timeline, every note
// editable, every sound designable from its waves, effects dragged on, all played live in the
// browser and printed as it plays. lib/daw holds the project model, the effects and the engine.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Library, FxPanel, SoundPanel } from "@/components/daw/Panels";
import { NoteEditor } from "@/components/daw/NoteEditor";
import { type Drag, HEAD, Timeline, snapTo } from "@/components/daw/Timeline";
import { Scope } from "@/components/WaveEditors";
import { getEngine } from "@/lib/audio";
import { Engine, Player, render } from "@/lib/daw/engine";
import { defaults } from "@/lib/daw/fx";
import { INSTRUMENTS, blank, newTrack, starter } from "@/lib/daw/library";
import {
  type Clip, type Clipboard, type Fx, type History, type NoteEv, type Project, type Range, type Track,
  addClip, barBeat, capped, clearRange, clock, commit, copyRange, duplicateClips, findClip, maxBeats, moveClip, paste,
  projectEnd, removeClips, repeatRange, resizeClip, secPerBeat, setClip, setNotes, setTrack, speedClip, speedRange, splitClip, uid,
} from "@/lib/daw/model";
import { ragaOfHour } from "@/lib/music";
import { tick, useData } from "@/lib/site";

const STORE = "ragaz-studio-v1", HELLO = "ragaz-studio-hello";
const SNAPS: [number, string][] = [[4, "Bar"], [1, "Beat"], [0.5, "½"], [0.25, "¼"], [0.125, "⅛"], [0, "Off"]];
const SAS = [[196, "G"], [208, "G♯"], [220, "A"], [233, "A♯"], [247, "B"], [262, "C"], [277, "C♯"], [294, "D"]] as const;

async function pack(p: Project) {
  const bytes = new Blob([JSON.stringify(p)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buf = new Uint8Array(await new Response(bytes).arrayBuffer());
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function unpack(code: string): Promise<Project | null> {
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    const p = JSON.parse(text);
    return p?.version === 1 && Array.isArray(p.tracks) ? p : null;
  } catch {
    return null;
  }
}

export default function Studio() {
  const data = useData();
  const ragas = data?.latest.ragas ?? [];
  const [project, setProject] = useState<Project | null>(null);
  const [hist, setHist] = useState<History>({ past: [], future: [] });
  const [sel, setSel] = useState<string[]>([]);
  const [selTrack, setSelTrack] = useState<string | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [ppb, setPpb] = useState(24);
  const [snap, setSnap] = useState(1);
  const [panel, setPanel] = useState<"notes" | "sound" | "fx" | "library" | null>(null);
  const [openClip, setOpenClip] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [printed, setPrinted] = useState<Float32Array>(() => new Float32Array(1));
  const [exporting, setExporting] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hello, setHello] = useState(false);
  const [follow, setFollow] = useState(true);
  const engine = useRef<Engine | null>(null);
  const player = useRef<Player | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const live = useRef<Project | null>(null);
  live.current = project;

  const raga = ragas.find((r) => r.key === project?.raga) ?? ragas[0];
  const pieces = useMemo(() => (data && raga ? data.latest.pieces.filter((p) => p.raga === raga.key).map((p) => p.notes) : []), [data, raga]);
  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600); };

  // ------------------------------------------------------------------ load: a shared link, your last session, or a first sketch
  useEffect(() => {
    if (project || !ragas.length || !data) return;
    (async () => {
      const code = window.location.hash.match(/#p=(.+)/)?.[1];
      let p = code ? await unpack(code) : null;
      if (!p) { try { const s = localStorage.getItem(STORE); if (s) p = JSON.parse(s); } catch {} }
      if (!p || !ragas.some((r) => r.key === p!.raga)) {
        const r = ragaOfHour(ragas, new Date().getHours());
        p = starter(r, data.latest.pieces.filter((x) => x.raga === r.key).map((x) => x.notes));
      }
      setProject(p);
      setSelTrack(p.tracks[0]?.id ?? null);
      try { setHello(!localStorage.getItem(HELLO)); } catch { setHello(true); }
      const w = (scroll.current?.clientWidth ?? 1200) - HEAD - 40;
      setPpb(Math.max(8, Math.min(60, w / Math.max(32, projectEnd(p) + 4))));
    })();
  }, [ragas, data, project]);

  // Save as you go (in this browser).
  useEffect(() => {
    if (!project) return;
    const t = window.setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(project)); } catch {} }, 400);
    return () => window.clearTimeout(t);
  }, [project]);

  useEffect(() => { if (project) setPrinted((old) => (old.length === maxBeats(project) * 8 ? old : new Float32Array(maxBeats(project) * 8))); }, [project?.bpm]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ edits (each one undoable)
  const edit = useCallback((f: (p: Project) => Project, msg?: string) => {
    const p = live.current;
    if (!p) return;
    const q = f(p);
    if (q === p) return;
    setHist((h) => commit(h, p));
    setProject(q);
    if (msg) say(msg);
  }, []);
  const undo = () => setHist((h) => { if (!h.past.length || !project) return h; const prev = h.past[h.past.length - 1]; setProject(prev); return { past: h.past.slice(0, -1), future: [project, ...h.future] }; });
  const redo = () => setHist((h) => { if (!h.future.length || !project) return h; const next = h.future[0]; setProject(next); return { past: [...h.past, project], future: h.future.slice(1) }; });

  // ------------------------------------------------------------------ sound
  const ensure = useCallback(async () => {
    const ctx = getEngine();
    await ctx.resume();
    if (!engine.current) {
      engine.current = new Engine(ctx.ctx);
      player.current = new Player(engine.current, () => setPlaying(false));
    }
    return engine.current;
  }, []);

  const play = async (from = playhead) => {
    if (!project) return;
    await ensure();
    const pl = player.current!;
    pl.loop = loop && range ? { a: range.a, b: range.b } : null;
    const start = pl.loop && (from < range!.a || from >= range!.b) ? range!.a : from >= projectEnd(project) ? 0 : from;
    pl.start(project, start);
    setPlaying(true);
  };
  const stop = () => { player.current?.stop(false); setPlaying(false); };
  const toggle = () => { tick(); if (playing) stop(); else play(); };
  useEffect(() => { if (playing && project) player.current?.update(project); }, [project, playing]);
  useEffect(() => { if (player.current) player.current.loop = loop && range ? { a: range.a, b: range.b } : null; }, [loop, range]);
  useEffect(() => () => player.current?.stop(false), []);

  // While playing: the playhead, the meters, and the waveform printed under the ruler.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, lastBucket = -1;
    const buf = new Float32Array(2048), tbuf = new Float32Array(1024);
    const loopFrame = () => {
      raf = requestAnimationFrame(loopFrame);
      const pl = player.current, e = engine.current, p = live.current;
      if (!pl || !e || !p) return;
      const b = pl.beatNow();
      if (b === null) return;
      setPlayhead(b);
      e.analyser.getFloatTimeDomainData(buf);
      let pk = 0;
      for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
      const k = Math.floor(b * 8);
      // Each eighth of a beat keeps the loudest moment heard in it this time round.
      setPrinted((pr) => {
        if (k < 0 || k >= pr.length) return pr;
        const nx = new Float32Array(pr);
        nx[k] = k === lastBucket ? Math.max(nx[k], pk) : pk;
        lastBucket = k;
        return nx;
      });
      const m: Record<string, number> = {};
      for (const [id, c] of e.chains) { c.meter.getFloatTimeDomainData(tbuf); let s = 0; for (let i = 0; i < tbuf.length; i++) s += tbuf[i] * tbuf[i]; m[id] = Math.sqrt(s / tbuf.length); }
      setMeters(m);
      const el = scroll.current;
      if (el && follow) { const x = b * ppbRef.current; if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEAD - 60) el.scrollLeft = Math.max(0, x - 80); }
    };
    loopFrame();
    return () => { cancelAnimationFrame(raf); setMeters({}); };
  }, [playing, follow]);
  const ppbRef = useRef(ppb);
  ppbRef.current = ppb;

  const audition = async (trackId: string, s: number) => {
    if (!project) return;
    const e = await ensure();
    if (playing) { const c = e.chains.get(trackId); if (c) e.note(project, { beat: 0, dur: 0.5, s, v: 0.85, track: trackId }, e.ctx.currentTime + 0.01); }
    else e.preview(project, trackId, s);
  };

  // ------------------------------------------------------------------ zoom
  const zoom = useCallback((next: number, anchor?: number) => {
    const el = scroll.current, z = Math.max(4, Math.min(240, next));
    const a = anchor ?? (el ? (el.scrollLeft + (el.clientWidth - HEAD) / 2) / ppb : 0);
    setPpb(z);
    requestAnimationFrame(() => { if (el) el.scrollLeft = Math.max(0, a * z - (anchor !== undefined ? (el.clientWidth - HEAD) / 2 : (el.clientWidth - HEAD) / 2)); });
  }, [ppb]);
  const fit = (a = 0, b = project ? Math.max(16, projectEnd(project)) : 64) => {
    const el = scroll.current, w = (el?.clientWidth ?? 1200) - HEAD - 40;
    const z = Math.max(4, Math.min(240, w / Math.max(1, b - a)));
    setPpb(z);
    requestAnimationFrame(() => { if (el) el.scrollLeft = Math.max(0, a * z - 20); });
  };

  // ------------------------------------------------------------------ clipboard and range tools
  const copySel = (): Clipboard | null => {
    if (!project) return null;
    if (range) return copyRange(project, range);
    const chosen = project.tracks.flatMap((t) => t.clips.filter((c) => sel.includes(c.id)).map((c) => ({ t, c })));
    if (!chosen.length) return null;
    const a = Math.min(...chosen.map((x) => x.c.start)), b = Math.max(...chosen.map((x) => x.c.start + x.c.len));
    const byTrack = new Map<string, { trackId: string; inst: Track["inst"]; clips: Clip[] }>();
    for (const { t, c } of chosen) { if (!byTrack.has(t.id)) byTrack.set(t.id, { trackId: t.id, inst: t.inst, clips: [] }); byTrack.get(t.id)!.clips.push({ ...JSON.parse(JSON.stringify(c)), start: c.start - a }); }
    return { len: b - a, tracks: [...byTrack.values()] };
  };
  const doCopy = () => { const cb = copySel(); if (cb) { setClipboard(cb); say(`Copied ${(cb.len / 4).toFixed(cb.len % 4 ? 1 : 0)} bars`); } };
  const doCut = () => { const cb = copySel(); if (!cb) return; setClipboard(cb); doDelete(); };
  const doPaste = () => {
    if (!clipboard || !project) return;
    const at = snapTo(playhead, snap || 0.25);
    edit((p) => paste(p, clipboard, at, clipboard.tracks.length === 1 && selTrack ? selTrack : undefined), `Pasted at ${barBeat(at)}`);
    setPlayhead(at + clipboard.len);
  };
  const doDelete = () => {
    if (range) { edit((p) => clearRange(p, range), "Cleared"); return; }
    if (sel.length) { edit((p) => removeClips(p, sel), `Deleted ${sel.length} clip${sel.length > 1 ? "s" : ""}`); setSel([]); if (sel.includes(openClip ?? "")) { setOpenClip(null); setPanel(null); } }
  };
  const doDuplicate = () => {
    if (range) { edit((p) => repeatRange(p, range), "Repeated"); setRange({ ...range, a: range.b, b: range.b + (range.b - range.a) }); return; }
    if (!sel.length) return;
    let ids: string[] = [];
    edit((p) => { const r = duplicateClips(p, sel); ids = r.ids; return r.project; }, "Duplicated");
    setTimeout(() => setSel(ids));
  };
  const doSplit = () => {
    if (!project) return;
    const at = snapTo(playhead, snap || 0.25);
    const targets = sel.length ? sel : project.tracks.filter((t) => t.id === selTrack).flatMap((t) => t.clips.filter((c) => c.start < at && c.start + c.len > at).map((c) => c.id));
    if (!targets.length) return say("Put the playhead over a clip to split it there");
    edit((p) => targets.reduce((q, id) => splitClip(q, id, at), p), `Split at ${barBeat(at)}`);
  };
  const doSpeed = (f: number) => {
    if (range) { edit((p) => speedRange(p, range, f), `${f > 1 ? "Faster" : "Slower"} ×${f}`); setRange({ ...range, b: range.a + (range.b - range.a) / f }); }
    else if (sel.length) edit((p) => sel.reduce((q, id) => speedClip(q, id, f), p), `${f > 1 ? "Faster" : "Slower"} ×${f}`);
  };

  // ------------------------------------------------------------------ dropping things from the library
  const placeClip = (d: Extract<Drag, { kind: "clip" }>, trackId: string | null, at: number) => {
    edit((p) => {
      let q = p, tid = trackId;
      const tr = q.tracks.find((t) => t.id === tid);
      if (!tr || (tr.inst === "drums") !== d.drums) {
        const def = INSTRUMENTS.find((x) => x.sound === d.suggest || x.inst === d.suggest) ?? INSTRUMENTS.find((x) => x.inst === (d.drums ? "drums" : "sitar"))!;
        const t = newTrack(def, q.tracks.length);
        q = { ...q, tracks: [...q.tracks, t] };
        tid = t.id;
      }
      const res = addClip(q, tid!, { ...d.clip, start: at });
      setTimeout(() => { setSel([res.id]); setSelTrack(tid); });
      return res.project;
    }, `Added ${d.clip.name} at ${barBeat(at)}`);
  };
  const addFx = (type: string, clipId?: string | null, trackId?: string | null) => {
    const f: Fx = { id: uid("f"), type, params: defaults(type) };
    if (clipId) { edit((p) => { const h = findClip(p, clipId); return h ? setClip(p, clipId, { fx: [...h.clip.fx, f] }) : p; }, "Effect added to the clip"); setPanel("fx"); }
    else if (trackId) { edit((p) => setTrack(p, trackId, { fx: [...(p.tracks.find((t) => t.id === trackId)?.fx ?? []), f] }), "Effect added to the whole track"); setPanel("fx"); }
  };
  const onDrop = (d: Drag, trackId: string | null, at: number, clipId?: string) => {
    if (d.kind === "fx") { if (clipId) addFx(d.type, clipId); else if (trackId) addFx(d.type, null, trackId); return; }
    if (d.kind === "inst") { addTrack(d.index); return; }
    placeClip(d, trackId, at);
  };
  const onAdd = (d: Drag) => {
    if (!project) return;
    if (d.kind === "fx") {
      if (sel.length) { for (const id of sel) addFx(d.type, id); }
      else if (selTrack) addFx(d.type, null, selTrack);
      else say("Select a clip or a track first, or drag the effect onto one");
      return;
    }
    if (d.kind === "inst") return addTrack(d.index);
    const at = Math.floor(playhead / 4) * 4;
    const cur = project.tracks.find((t) => t.id === selTrack);
    const fits = (t?: Track) => !!t && (t.inst === "drums") === d.drums;
    const target = fits(cur) ? cur!.id : project.tracks.find((t) => fits(t) && (d.drums || t.inst !== "drums") && (!d.suggest || t.inst === d.suggest || t.sound === d.suggest))?.id ?? project.tracks.find(fits)?.id ?? null;
    placeClip(d, target, at);
    setPlayhead(at + d.clip.len);
  };
  const addTrack = (index: number) => {
    const t = newTrack(INSTRUMENTS[index], project?.tracks.length ?? 0);
    edit((p) => ({ ...p, tracks: [...p.tracks, t] }), `Added a ${t.name} track`);
    setSelTrack(t.id);
  };

  // ------------------------------------------------------------------ keys
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "TEXTAREA" || (el?.tagName === "INPUT" && !["range", "checkbox"].includes((el as HTMLInputElement).type)) || el?.tagName === "SELECT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === " ") { e.preventDefault(); toggle(); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); doCopy(); }
      else if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); doCut(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); doPaste(); }
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); doDuplicate(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); doDelete(); }
      else if (e.key.toLowerCase() === "s" && !mod) doSplit();
      else if (e.key.toLowerCase() === "l" && !mod) setLoop((x) => !x);
      else if ((e.key === "=" || e.key === "+") && !mod) zoom(ppb * 1.3);
      else if (e.key === "-" && !mod) zoom(ppb / 1.3);
      else if (e.key === "0" && !mod) fit();
      else if (e.key === "Home" || e.key === "Enter") { setPlayhead(0); if (playing) play(0); }
      else if (e.key === "Escape") { setSel([]); setRange(null); }
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && sel.length && project) {
        e.preventDefault();
        const d = (e.key === "ArrowLeft" ? -1 : 1) * (snap || 0.25);
        edit((p) => sel.reduce((q, id) => { const h = findClip(q, id); return h ? moveClip(q, id, h.clip.start + d) : q; }, p));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ------------------------------------------------------------------ export and share
  const exportWav = async () => {
    if (!project || exporting !== null) return;
    if (!projectEnd(project)) return say("Nothing to export yet");
    tick();
    setExporting(0);
    try {
      const blob = await render(project, (x) => setExporting(x));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name.replace(/[^\w-]+/g, "-") || "ragaz"}.wav`;
      a.click();
      say("Exported");
    } finally {
      setTimeout(() => setExporting(null), 600);
    }
  };
  const share = async () => {
    if (!project) return;
    const url = `${location.origin}${location.pathname}#p=${await pack(project)}`;
    history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); say("Link copied: it opens this exact piece"); } catch { say("Link is in the address bar"); }
  };
  const saveFile = () => {
    if (!project) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: "application/json" }));
    a.download = `${project.name.replace(/[^\w-]+/g, "-") || "ragaz"}.ragaz.json`;
    a.click();
  };
  const openFile = (f: File) => f.text().then((t) => { try { const p = JSON.parse(t); if (p?.version === 1) { edit(() => p, `Opened ${p.name}`); } else say("That isn't a Ragaz studio file"); } catch { say("That isn't a Ragaz studio file"); } });
  const fresh = (kind: "sketch" | "blank") => {
    if (!raga || !data) return;
    stop();
    edit(() => (kind === "sketch" ? starter(raga, pieces, project?.sa, project?.bpm) : blank(raga, project?.sa, project?.bpm)), kind === "sketch" ? "A new sketch" : "A blank page");
    setSel([]); setRange(null); setPlayhead(0); setOpenClip(null); setPanel(null); setPrinted(new Float32Array(printed.length));
  };

  if (!project || !raga) return <main className="grid h-[100svh] place-items-center text-sepia">Opening the studio…</main>;

  const open = openClip ? findClip(project, openClip) : null;
  const curTrack = project.tracks.find((t) => t.id === selTrack) ?? null;
  const fxTarget = sel.length === 1 && findClip(project, sel[0]) ? { kind: "clip" as const, ...findClip(project, sel[0])! } : curTrack ? { kind: "track" as const, track: curTrack } : null;
  const end = projectEnd(project), spb = secPerBeat(project);
  const btn = "rounded-full border border-rule px-3 py-1.5 text-[13px] transition-colors hover:border-sindoor/60 disabled:opacity-40";

  return (
    <main className="flex min-h-[100svh] flex-col px-3 pb-3 pt-[92px] text-kajal sm:px-5 lg:h-[100svh]">
      {/* ------------------------------------------------------------ transport */}
      <div className="flex flex-wrap items-center gap-2 rounded-t-xl border border-rule bg-leaf px-3 py-2">
        <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} className="w-40 bg-transparent font-display text-[22px] leading-none outline-none focus:underline" aria-label="Piece name" />
        <button onClick={toggle} className={`h-10 w-10 rounded-full text-[16px] text-paper ${playing ? "bg-sindoor" : "bg-kajal"}`} title="Play / stop (space)">{playing ? "■" : "▶"}</button>
        <button onClick={() => { setPlayhead(0); if (playing) play(0); }} className="h-8 w-8 rounded-full border border-rule text-[12px]" title="To the start (Home)">⏮</button>
        <button onClick={() => setLoop(!loop)} className={`rounded-full border px-3 py-1.5 text-[13px] ${loop ? "border-sindoor bg-sindoor text-paper" : "border-rule"}`} title="Loop the selected range (L)">⟳ Loop</button>
        <div className="min-w-[132px] rounded-lg bg-kajal px-3 py-1 font-mono text-[13px] tabular-nums text-paper">
          {barBeat(playhead)} <span className="text-paper/60">· {clock(playhead * spb)} / {clock(Math.max(end * spb, 0))}</span>
        </div>
        <label className="flex items-center gap-1 text-[12px] text-sepia">Tempo <input type="number" min={60} max={180} value={project.bpm} onChange={(e) => { const v = Math.max(60, Math.min(180, Number(e.target.value) || 96)); edit((p) => capped({ ...p, bpm: v })); }} className="w-14 rounded border border-rule bg-paper px-1 text-kajal" /></label>
        <select value={project.raga} onChange={(e) => edit((p) => ({ ...p, raga: e.target.value }), `Now in ${ragas.find((r) => r.key === e.target.value)?.name}: the library follows`)} className="rounded-full border border-rule bg-paper px-2 py-1 text-[13px]" title="The raga: the note rows and the library follow it">
          {ragas.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
        <select value={project.sa} onChange={(e) => edit((p) => ({ ...p, sa: Number(e.target.value) }))} className="rounded-full border border-rule bg-paper px-2 py-1 text-[13px]" title="Sa, the home note">
          {SAS.map(([hz, n]) => <option key={hz} value={hz}>Sa = {n}</option>)}
        </select>
        <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} className="rounded-full border border-rule bg-paper px-2 py-1 text-[13px]" title="Snap: what moves and new notes line up to">
          {SNAPS.map(([v, n]) => <option key={v} value={v}>Snap {n}</option>)}
        </select>
        <span className="flex items-center gap-1 text-[12px] text-sepia">
          <button onClick={() => zoom(ppb / 1.3)} className="h-7 w-7 rounded-full border border-rule" title="Zoom out (−)">−</button>
          <input type="range" min={4} max={240} value={ppb} onChange={(e) => zoom(Number(e.target.value))} className="w-24 accent-sindoor" title="Zoom (⌘/Ctrl + scroll)" />
          <button onClick={() => zoom(ppb * 1.3)} className="h-7 w-7 rounded-full border border-rule" title="Zoom in (+)">+</button>
          <button onClick={() => fit()} className="rounded-full border border-rule px-2 py-1" title="Fit the piece (0)">Fit</button>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={undo} disabled={!hist.past.length} className={btn} title="Undo (⌘Z)">↶</button>
          <button onClick={redo} disabled={!hist.future.length} className={btn} title="Redo (⇧⌘Z)">↷</button>
          <details className="relative">
            <summary className={`${btn} cursor-pointer list-none`}>File</summary>
            <div className="absolute right-0 z-40 mt-1 w-52 space-y-1 rounded-lg border border-rule bg-leaf p-2 text-[13px] shadow-lg">
              <button onClick={() => fresh("sketch")} className="block w-full rounded px-2 py-1 text-left hover:bg-paper2">New sketch in {raga.name}</button>
              <button onClick={() => fresh("blank")} className="block w-full rounded px-2 py-1 text-left hover:bg-paper2">New blank piece</button>
              <button onClick={saveFile} className="block w-full rounded px-2 py-1 text-left hover:bg-paper2">Save as a file</button>
              <label className="block w-full cursor-pointer rounded px-2 py-1 hover:bg-paper2">Open a file…<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} /></label>
              <button onClick={() => setHello(true)} className="block w-full rounded px-2 py-1 text-left hover:bg-paper2">Quick start and keys</button>
            </div>
          </details>
          <button onClick={share} className={btn} title="Copy a link that opens this piece">Share</button>
          <button onClick={exportWav} className="rounded-full bg-kajal px-4 py-1.5 text-[13px] text-paper" title="Render the whole piece to a WAV">{exporting !== null ? `Rendering ${Math.round(exporting * 100)}%` : "Export WAV"}</button>
        </span>
      </div>

      {/* ------------------------------------------------------------ what you can do with the selection */}
      <div className="flex min-h-[40px] flex-wrap items-center gap-1.5 border-x border-b border-rule bg-paper2/50 px-3 py-1.5 text-[12px]">
        {range ? (
          <>
            <span className="mr-1 text-sindoor">Range {barBeat(range.a)} – {barBeat(range.b)} · {((range.b - range.a) / 4).toFixed((range.b - range.a) % 4 ? 2 : 0)} bars{range.tracks ? ` · ${range.tracks.length} track${range.tracks.length > 1 ? "s" : ""}` : " · all tracks"}</span>
            <button className={btn} onClick={doCopy} title="⌘C">Copy</button>
            <button className={btn} onClick={doCut} title="⌘X">Cut</button>
            <button className={btn} onClick={doPaste} disabled={!clipboard} title="Paste at the playhead (⌘V)">Paste at playhead</button>
            <button className={btn} onClick={doDuplicate} title="⌘D">Repeat</button>
            <button className={btn} onClick={doDelete} title="Delete">Clear</button>
            <span className="mx-1 h-4 w-px bg-rule" />
            <span className="text-sepia">Speed</span>
            {[2, 1.5, 0.75, 0.5].map((f) => <button key={f} className={btn} onClick={() => doSpeed(f)}>{f > 1 ? "faster" : "slower"} ×{f}</button>)}
            <span className="mx-1 h-4 w-px bg-rule" />
            <button className={btn} onClick={() => { setLoop(true); play(range.a); }}>Loop it</button>
            <button className={btn} onClick={() => fit(range.a, range.b)}>Zoom to it</button>
            <button className="px-2 text-sepia hover:text-sindoor" onClick={() => setRange(null)}>✕</button>
          </>
        ) : sel.length ? (
          <>
            <span className="mr-1 text-sindoor">{sel.length} clip{sel.length > 1 ? "s" : ""} selected</span>
            {sel.length === 1 && <button className={btn} onClick={() => { setOpenClip(sel[0]); setPanel("notes"); }}>Edit notes</button>}
            <button className={btn} onClick={doCopy}>Copy</button>
            <button className={btn} onClick={doPaste} disabled={!clipboard}>Paste at playhead</button>
            <button className={btn} onClick={doDuplicate} title="⌘D">Duplicate</button>
            <button className={btn} onClick={doSplit} title="S">Split at playhead</button>
            <button className={btn} onClick={() => doSpeed(2)}>Faster ×2</button>
            <button className={btn} onClick={() => doSpeed(0.5)}>Slower ×½</button>
            <button className={btn} onClick={() => setPanel("fx")}>Effects</button>
            <button className={btn} onClick={doDelete}>Delete</button>
          </>
        ) : (
          <span className="text-sepia">Drag on the ruler to select time (copy, repeat, speed it up or slow it down) · double-click a clip to edit its notes · drag from the library on the right · space plays</span>
        )}
        <label className="ml-auto flex items-center gap-1 text-sepia"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-sindoor" />follow playhead</label>
      </div>

      {/* ------------------------------------------------------------ timeline + library */}
      <div className="flex min-h-[380px] flex-1 border-x border-rule lg:min-h-0">
        <div className="h-[380px] min-w-0 flex-1 bg-leaf/60 lg:h-auto">
          <Timeline project={project} ppb={ppb} snap={snap} playhead={playhead} playing={playing} selected={sel} range={range} selTrack={selTrack} meters={meters} printed={printed}
            scrollRef={scroll}
            onSeek={(b) => { setPlayhead(b); if (playing) play(b); }}
            onSelect={(ids, t) => { setSel(ids); setRange(null); if (t) setSelTrack(t); }}
            onRange={(r) => { setRange(r); if (r) setSel([]); }}
            onSelTrack={(id) => { setSelTrack(id); setSel([]); }}
            onMove={(moves, copy) => edit((p) => {
              if (copy) { let q = p; for (const m of moves) { const h = findClip(q, m.id); if (!h) continue; const r = addClip(q, m.track ?? h.track.id, { ...h.clip, start: m.start }); q = r.project; } return q; }
              return moves.reduce((q, m) => moveClip(q, m.id, m.start, m.track), p);
            })}
            onResize={(id, len) => edit((p) => resizeClip(p, id, len))}
            onOpen={(id) => { setOpenClip(id); setSel([id]); setPanel("notes"); }}
            onCreate={(tid, at) => { let nid = ""; edit((p) => { const r = addClip(p, tid, { name: "New clip", start: at, len: 4, notes: [], fx: [] }); nid = r.id; return r.project; }, "An empty bar: click in the notes below to write"); setTimeout(() => { setOpenClip(nid); setSel([nid]); setPanel("notes"); }); }}
            onDrop={onDrop}
            onTrack={(id, patch) => edit((p) => setTrack(p, id, patch))}
            onRemoveTrack={(id) => edit((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id) }), "Track removed (undo brings it back)")}
            onZoom={(z, a) => zoom(z, a)}
          />
        </div>
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-rule bg-leaf lg:flex">
          <div className="border-b border-rule p-2">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-sepia"><span>Live · what you hear</span><span className="normal-case tracking-normal">{playing ? "playing" : "press space"}</span></div>
            {engine.current ? <Scope analyser={engine.current.analyser} /> : <div className="mt-1 grid h-[188px] place-items-center rounded border border-dashed border-rule text-center text-[12px] text-sepia">The wave and its spectrum, live, once it plays</div>}
          </div>
          <div className="min-h-0 flex-1"><Library raga={raga} pieces={pieces} onAdd={onAdd} /></div>
        </aside>
      </div>

      {/* ------------------------------------------------------------ the bottom panel */}
      <div className="rounded-b-xl border border-rule bg-leaf">
        <div className="flex items-center gap-1 border-b border-rule px-2 py-1">
          {([["notes", "Notes"], ["sound", "Sound"], ["fx", "Effects"], ["library", "Library"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => { if (k === "notes" && !openClip && sel.length === 1) setOpenClip(sel[0]); setPanel(panel === k ? null : k); }} className={`rounded-full px-3 py-1 text-[13px] ${k === "library" ? "lg:hidden" : ""} ${panel === k ? "bg-kajal text-paper" : "text-kajal/70 hover:text-sindoor"}`}>{l}</button>
          ))}
          <span className="ml-2 text-[12px] text-sepia">{panel === "notes" ? (open ? "" : "Double-click a clip to open its notes") : panel === "sound" ? (curTrack ? `The sound of ${curTrack.name}` : "Click a track's name") : panel === "fx" ? "" : `${project.tracks.length} tracks · ${project.tracks.reduce((a, t) => a + t.clips.length, 0)} clips · ${clock(end * spb)} of 3:00`}</span>
          {panel && <button onClick={() => setPanel(null)} className="ml-auto px-2 text-[12px] text-sepia hover:text-sindoor">Hide ▾</button>}
        </div>
        {panel && (
          <div className="h-[min(44vh,380px)]">
            {panel === "notes" && open && <NoteEditor clip={open.clip} track={open.track} raga={raga} snap={snap} sa={project.sa}
              playhead={playing ? playhead - open.clip.start : null}
              onChange={(notes: NoteEv[], len?: number) => edit((p) => { const q = setNotes(p, open.clip.id, notes); return len ? setClip(q, open.clip.id, { len }) : q; })}
              onAudition={(s) => audition(open.track.id, s)} onClose={() => { setOpenClip(null); setPanel(null); }} />}
            {panel === "notes" && !open && <p className="p-4 text-[14px] text-sepia">Double-click any clip on the timeline to see and change every note in it. Or double-click an empty spot in a lane to start a new bar.</p>}
            {panel === "sound" && (curTrack ? <SoundPanel track={curTrack} sa={project.sa} onTrack={(patch) => edit((p) => setTrack(p, curTrack.id, patch))} /> : <p className="p-4 text-[14px] text-sepia">Click a track's name on the left to design its sound.</p>)}
            {panel === "library" && <Library raga={raga} pieces={pieces} onAdd={onAdd} />}
            {panel === "fx" && <FxPanel target={fxTarget} onChange={(fx) => edit((p) => (fxTarget?.kind === "clip" ? setClip(p, fxTarget.clip.id, { fx }) : fxTarget ? setTrack(p, fxTarget.track.id, { fx }) : p))} />}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------ export progress, messages, quick start */}
      {exporting !== null && (
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto w-[min(92vw,520px)] rounded-xl border border-rule bg-leaf p-4 shadow-xl">
          <div className="flex justify-between text-[13px]"><span>Rendering {project.name}…</span><span className="tabular-nums">{Math.round(exporting * 100)}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper2"><div className="h-full bg-sindoor transition-[width]" style={{ width: `${exporting * 100}%` }} /></div>
          <div className="mt-1 text-[11px] text-sepia">Every track played through its effects, faster than real time, then saved as a WAV.</div>
        </div>
      )}
      {toast && <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-kajal px-5 py-2 text-[14px] text-paper shadow-lg">{toast}</div>}
      {hello && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-kajal/30 p-4" onClick={() => { setHello(false); try { localStorage.setItem(HELLO, "1"); } catch {} }}>
          <div className="leaf-card w-[min(94vw,640px)] rounded-2xl border border-rule p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Quick start</div>
            <h2 className="mt-2 font-display text-[40px] leading-none">Make a piece, up to three minutes.</h2>
            <ol className="mt-5 space-y-3 text-[15px] leading-[1.5]">
              {[
                <>Press <b>space</b> to hear the sketch it starts with: drums, bass, keys, a sitar line from the composer, a pad. Watch the waveform print itself under the ruler.</>,
                <>Drag a <b>groove</b>, a <b>phrase</b> or <b>chords</b> from the library on the right onto a lane. Below the last track, it makes a new one.</>,
                <><b>Double-click a clip</b> to see every note. Click to add, drag to move, pull the edge to lengthen, set how hard each is played underneath.</>,
                <><b>Drag on the ruler</b> to select time: copy, paste at the playhead, repeat, or speed it up and slow it down. Effects drag onto clips.</>,
                <>Click a track's name and open <b>Sound</b> to design its synth from waves. <b>Export WAV</b> when it's done.</>,
              ].map((s, i) => <li key={i} className="grid grid-cols-[1.6rem_1fr]"><span className="font-display text-[20px] text-sindoor">{i + 1}</span><span>{s}</span></li>)}
            </ol>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-rule pt-4 text-[12px] text-sepia sm:grid-cols-3">
              {[["space", "play / stop"], ["⌘C ⌘X ⌘V", "copy, cut, paste"], ["⌘D", "duplicate / repeat"], ["S", "split at playhead"], ["Delete", "delete / clear"], ["⌘Z ⇧⌘Z", "undo / redo"], ["+ − 0", "zoom, fit"], ["L", "loop the range"], ["Alt-drag", "copy a clip"]].map(([k, v]) => <div key={k}><span className="font-mono text-kajal">{k}</span> {v}</div>)}
            </div>
            <button onClick={() => { setHello(false); try { localStorage.setItem(HELLO, "1"); } catch {} }} className="mt-5 rounded-full bg-sindoor px-6 py-2.5 text-[15px] text-paper">Start</button>
          </div>
        </div>
      )}
    </main>
  );
}
