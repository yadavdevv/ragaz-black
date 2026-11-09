"use client";

// The studio: make a piece of up to three minutes. It opens on a start screen (seven finished
// pieces to listen to and open, or a sketch, or a blank page); the studio itself shows simple tools
// first, with every tool one click away. lib/daw holds the project model, effects and engine.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NoteEditor } from "@/components/daw/NoteEditor";
import { FxPanel, Library, SoundPanel } from "@/components/daw/Panels";
import { type Drag, HEAD, Timeline, snapTo } from "@/components/daw/Timeline";
import { Footer } from "@/components/Footer";
import { FloralBand } from "@/components/Ornament";
import { RiseChars } from "@/components/Text";
import { Scope } from "@/components/WaveEditors";
import { getEngine } from "@/lib/audio";
import { DEMOS } from "@/lib/daw/demos";
import { Engine, Player, prepare, render, renderBuffer } from "@/lib/daw/engine";
import { defaults } from "@/lib/daw/fx";
import { INSTRUMENTS, blank, newTrack, starter } from "@/lib/daw/library";
import {
  type Clip, type Clipboard, type Fx, type History, type NoteEv, type Project, type Range, type Track,
  addClip, barBeat, capped, clearRange, clock, commit, copyRange, duplicateClips, findClip, maxBeats, moveClip, paste,
  projectEnd, removeClips, repeatRange, resizeClip, secPerBeat, setClip, setNotes, setTrack, speedClip, speedRange, splitClip, uid,
} from "@/lib/daw/model";
import { ragaOfHour } from "@/lib/music";
import { tick, useData } from "@/lib/site";

const STORE = "ragaz-studio-v1", PREFS = "ragaz-studio-prefs";
const SNAPS: [number, string][] = [[4, "Bar"], [1, "Beat"], [0.5, "½"], [0.25, "¼"], [0.125, "⅛"], [0, "Off"]];
const SAS = [[196, "G"], [208, "G♯"], [220, "A"], [233, "A♯"], [247, "B"], [262, "C"], [277, "C♯"], [294, "D"]] as const;
const STEPS = [
  { key: "play", text: "Press play (or space) and listen", where: "play" },
  { key: "mute", text: "Mute a track (M) and hear what it was doing", where: "mute" },
  { key: "add", text: "Drag a beat or a melody from the library onto a lane", where: "lib-beats" },
  { key: "notes", text: "Double-click a clip and move one of its notes", where: "clip" },
  { key: "fx", text: "Drag an effect onto a clip", where: "lib-fx" },
  { key: "loop", text: "Drag across a few bars on the ruler, then press Loop", where: "ruler" },
] as const;
type Step = (typeof STEPS)[number]["key"];

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
const loadPrefs = (): { pro?: boolean; done?: Step[]; guide?: boolean } => { try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}"); } catch { return {}; } };
const savePrefs = (x: object) => { try { localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...x })); } catch {} };

export default function Studio() {
  const data = useData();
  const ragas = data?.latest.ragas ?? [];
  const [view, setView] = useState<"home" | "studio">("home");
  const [project, setProject] = useState<Project | null>(null);
  const [saved, setSaved] = useState<Project | null>(null);
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
  const [exporting, setExporting] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pro, setPro] = useState(false);
  const [done, setDone] = useState<Step[]>([]);
  const [guide, setGuide] = useState(true);
  const [pointAt, setPointAt] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [startRaga, setStartRaga] = useState<string | null>(null);
  const engine = useRef<Engine | null>(null);
  const player = useRef<Player | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const live = useRef<Project | null>(null);
  const printRef = useRef<Float32Array>(new Float32Array(1));
  const drawRef = useRef<(() => void) | null>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const ppbRef = useRef(ppb);
  ppbRef.current = ppb;
  live.current = project;
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") Object.assign(window, { __studio: { engine, player, project, renderBuffer, DEMOS, ragas, data } }); // read by the headless tests

  const raga = ragas.find((r) => r.key === project?.raga) ?? ragas[0];
  const piecesOf = useCallback((k: string) => (data ? data.latest.pieces.filter((p) => p.raga === k).map((p) => p.notes) : []), [data]);
  const pieces = useMemo(() => (raga ? piecesOf(raga.key) : []), [raga, piecesOf]);
  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 2600); };
  const mark = useCallback((k: Step) => setDone((d) => { if (d.includes(k)) return d; const n = [...d, k]; savePrefs({ done: n }); return n; }), []);

  // ------------------------------------------------------------------ load: a shared link opens straight in the studio; otherwise the start screen
  useEffect(() => {
    if (!ragas.length || !data || project || saved) return;
    const prefs = loadPrefs();
    setPro(!!prefs.pro); setDone(prefs.done ?? []); setGuide(prefs.guide !== false);
    setStartRaga(ragaOfHour(ragas, new Date().getHours()).key);
    (async () => {
      const code = window.location.hash.match(/#p=(.+)/)?.[1];
      const shared = code ? await unpack(code) : null;
      if (shared) return open(shared, "studio");
      try { const s = localStorage.getItem(STORE); if (s) { const p = JSON.parse(s); if (p?.version === 1 && ragas.some((r) => r.key === p.raga)) setSaved(p); } } catch {}
    })();
  }, [ragas, data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!project || view !== "studio") return;
    const t = window.setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(project)); } catch {} }, 400);
    return () => window.clearTimeout(t);
  }, [project, view]);
  useEffect(() => { if (project && printRef.current.length !== maxBeats(project) * 8) printRef.current = new Float32Array(maxBeats(project) * 8); }, [project?.bpm]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Open a project in the studio, fitted to the screen. */
  function open(p: Project, then: "studio" | "play" = "studio") {
    stop();
    setProject(p); setHist({ past: [], future: [] }); setSel([]); setRange(null); setLoop(false); setPlayhead(0); setOpenClip(null); setPanel(null);
    setSelTrack(p.tracks[0]?.id ?? null);
    printRef.current = new Float32Array(maxBeats(p) * 8);
    setView("studio");
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      const w = (scroll.current?.clientWidth ?? 1200) - HEAD - 40;
      setPpb(Math.max(6, Math.min(60, w / Math.max(32, projectEnd(p) + 2))));
      if (then === "play") setTimeout(() => playFrom(p, 0), 80);
    });
  }

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
      const e = new Engine(ctx.ctx);
      e.guard = await prepare(ctx.ctx);
      engine.current = e;
      player.current = new Player(e, () => { setPlaying(false); setPreview(null); });
    }
    return engine.current;
  }, []);

  const loopRange = (p: Project | null = project): { a: number; b: number } | null => {
    if (!loop || !p) return null;
    if (range && range.b - range.a >= 0.5) return { a: range.a, b: range.b };
    return { a: 0, b: Math.max(4, Math.ceil(projectEnd(p) / 4) * 4) }; // no range: the whole piece
  };
  const playFrom = async (p: Project, from: number, lr = loopRange(p)) => {
    await ensure();
    const pl = player.current!;
    pl.loop = lr;
    const start = lr && (from < lr.a || from >= lr.b) ? lr.a : from >= projectEnd(p) ? 0 : from;
    pl.start(p, start);
    setPlaying(true);
    mark("play");
  };
  const play = (from = playhead) => project && playFrom(project, from);
  function stop() {
    const b = player.current?.beatNow();
    player.current?.stop(false);
    setPlaying(false); setPreview(null);
    if (b !== null && b !== undefined) setPlayhead(b);
  }
  const toggle = () => { tick(); if (playing) stop(); else play(); };
  useEffect(() => { if (playing && project) player.current?.update(project); }, [project, playing]);
  // A loop switched on or off (or moved) while playing: carry on from where the playhead is, with the new loop.
  const loopKey = JSON.stringify(loopRange());
  useEffect(() => {
    if (loop && range) mark("loop");
    if (!playing || !project || !player.current || preview) return;
    if (JSON.stringify(player.current.loop) === loopKey) return;
    playFrom(project, player.current.beatNow() ?? playhead);
  }, [loopKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => player.current?.stop(false), []);

  // While playing, drawn straight to the page (not through React): the playheads, the position, the
  // meters, the waveform printed under the ruler.
  useEffect(() => {
    if (!playing) return;
    let raf = 0, lastBucket = -1;
    const buf = new Float32Array(2048), tbuf = new Float32Array(1024);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const pl = player.current, e = engine.current, p = live.current;
      if (!pl || !e || !p) return;
      const b = pl.beatNow();
      if (b === null) return;
      const z = ppbRef.current;
      document.querySelectorAll<HTMLElement>("[data-ph]").forEach((el) => (el.style.left = `${b * z}px`));
      document.querySelectorAll<HTMLElement>("[data-ph-clip]").forEach((el) => { const x = b - Number(el.dataset.start); el.style.display = x >= 0 ? "block" : "none"; el.style.left = `${x * Number(el.dataset.ppb)}px`; });
      if (posRef.current) posRef.current.textContent = `${barBeat(b)} · ${clock(b * secPerBeat(p))}`;
      e.analyser.getFloatTimeDomainData(buf);
      let pk = 0;
      for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i]));
      const k = Math.floor(b * 8), pr = printRef.current;
      if (k >= 0 && k < pr.length) { pr[k] = k === lastBucket ? Math.max(pr[k], pk) : pk; lastBucket = k; }
      drawRef.current?.();
      for (const [id, c] of e.chains) {
        c.meter.getFloatTimeDomainData(tbuf);
        let s = 0;
        for (let i = 0; i < tbuf.length; i++) s += tbuf[i] * tbuf[i];
        const el = document.querySelector<HTMLElement>(`[data-meter="${id}"]`);
        if (el) el.style.width = `${Math.min(100, Math.sqrt(s / tbuf.length) * 260)}%`;
      }
      const el = scroll.current;
      if (el && follow) { const x = b * z; if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEAD - 60) el.scrollLeft = Math.max(0, x - 80); }
    };
    frame();
    return () => { cancelAnimationFrame(raf); document.querySelectorAll<HTMLElement>("[data-meter]").forEach((el) => (el.style.width = "0")); };
  }, [playing, follow]);

  const audition = async (trackId: string, s: number) => {
    if (!project) return;
    const e = await ensure();
    if (playing) { if (e.chains.get(trackId)) e.note(project, { beat: 0, dur: 0.5, s, v: 0.85, track: trackId }, e.ctx.currentTime + 0.01); }
    else e.preview(project, trackId, s);
  };

  // ------------------------------------------------------------------ zoom
  const zoom = useCallback((next: number, anchor?: number) => {
    const el = scroll.current, z = Math.max(4, Math.min(240, next));
    const a = anchor ?? (el ? (el.scrollLeft + (el.clientWidth - HEAD) / 2) / ppb : 0);
    setPpb(z);
    requestAnimationFrame(() => { if (el) el.scrollLeft = Math.max(0, a * z - (el.clientWidth - HEAD) / 2); });
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
  const doCopy = () => { const cb = copySel(); if (cb) { setClipboard(cb); say(`Copied ${(cb.len / 4).toFixed(cb.len % 4 ? 1 : 0)} bars: put the playhead somewhere and paste`); } };
  const doDelete = () => {
    if (range) { edit((p) => clearRange(p, range), "Cleared"); return; }
    if (sel.length) { edit((p) => removeClips(p, sel), `Deleted ${sel.length} clip${sel.length > 1 ? "s" : ""}`); setSel([]); if (sel.includes(openClip ?? "")) { setOpenClip(null); setPanel(null); } }
  };
  const doCut = () => { const cb = copySel(); if (!cb) return; setClipboard(cb); doDelete(); };
  const doPaste = () => {
    if (!clipboard || !project) return;
    const at = snapTo(playhead, snap || 0.25);
    edit((p) => paste(p, clipboard, at, clipboard.tracks.length === 1 && selTrack ? selTrack : undefined), `Pasted at bar ${barBeat(at)}`);
    setPlayhead(at + clipboard.len);
  };
  const doDuplicate = () => {
    if (range) { edit((p) => repeatRange(p, range), "Repeated: the copy follows it"); setRange({ ...range, a: range.b, b: range.b + (range.b - range.a) }); return; }
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
    edit((p) => targets.reduce((q, id) => splitClip(q, id, at), p), `Split at bar ${barBeat(at)}`);
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
    }, `Added ${d.clip.name} at bar ${barBeat(at)}`);
    mark("add");
  };
  const addFx = (type: string, clipId?: string | null, trackId?: string | null) => {
    const f: Fx = { id: uid("f"), type, params: defaults(type) };
    if (clipId) { edit((p) => { const h = findClip(p, clipId); return h ? setClip(p, clipId, { fx: [...h.clip.fx, f] }) : p; }, "Effect added: it runs while this clip plays"); setPanel("fx"); mark("fx"); }
    else if (trackId) { edit((p) => setTrack(p, trackId, { fx: [...(p.tracks.find((t) => t.id === trackId)?.fx ?? []), f] }), "Effect added under the whole track"); setPanel("fx"); mark("fx"); }
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
    const target = fits(cur) ? cur!.id : project.tracks.find((t) => fits(t) && (!d.suggest || t.inst === d.suggest || t.sound === d.suggest))?.id ?? project.tracks.find(fits)?.id ?? null;
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
    if (view !== "studio") return;
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
    try { await navigator.clipboard.writeText(url); say("Link copied: it opens this exact piece"); } catch { say("The link is in the address bar"); }
  };
  const saveFile = () => {
    if (!project) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: "application/json" }));
    a.download = `${project.name.replace(/[^\w-]+/g, "-") || "ragaz"}.ragaz.json`;
    a.click();
  };
  const openFile = (f: File) => f.text().then((t) => { try { const p = JSON.parse(t); if (p?.version === 1) open(p); else say("That isn't a Ragaz studio file"); } catch { say("That isn't a Ragaz studio file"); } });
  const demo = (k: string) => DEMOS.find((x) => x.key === k)!.make(ragas, piecesOf);
  const listen = async (k: string) => {
    if (preview === k && playing) { stop(); return; }
    setPreview(k);
    await playFrom(demo(k), 0, null);
  };

  // ------------------------------------------------------------------ the start screen
  if (!data || !ragas.length) return <main className="grid h-[100svh] place-items-center text-sepia">Opening the studio…</main>;
  if (view === "home" || !project || !raga) {
    const sr = ragas.find((r) => r.key === startRaga) ?? ragas[0];
    return (
      <main className="bg-transparent">
        <section className="relative overflow-hidden px-6 pb-10 pt-36 sm:px-10">
          <div className="pointer-events-none absolute -right-40 top-0 h-[640px] w-[640px] rounded-full bg-sona/15 blur-[140px]" />
          <div className="relative mx-auto max-w-[1400px]">
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Studio</div>
            <h1 className="mt-4 font-display text-[clamp(56px,9vw,150px)] leading-[0.9]"><RiseChars text="Make music" /><br /><RiseChars text="in a raga." /></h1>
            <p className="mt-8 max-w-[640px] text-[clamp(17px,1.8vw,21px)] leading-[1.55] text-kajal/80">
              Start by listening. Each piece below was made here, from the same beats, sounds and effects you get. Open one to see how it is built and change anything in it, or start your own.
            </p>
          </div>
        </section>
        <FloralBand />
        <section className="px-6 py-14 sm:px-10">
          <div className="mx-auto max-w-[1400px]">
            {saved && (
              <div className="mb-10 flex flex-wrap items-center gap-4 rounded-xl border border-sindoor/40 bg-leaf px-5 py-4">
                <span className="text-[13px] uppercase tracking-[0.2em] text-sepia">Where you left off</span>
                <span className="font-display text-[24px]">{saved.name}</span>
                <span className="text-[13px] text-sepia">{saved.tracks.length} tracks · {clock(projectEnd(saved) * secPerBeat(saved))}</span>
                <button onClick={() => open(saved)} className="ml-auto rounded-full bg-sindoor px-5 py-2 text-[14px] text-paper">Carry on →</button>
              </div>
            )}
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">1 · Listen</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {DEMOS.map((d) => {
                const r = ragas.find((x) => x.key === d.raga);
                const on = preview === d.key && playing;
                return (
                  <div key={d.key} className={`leaf-card flex flex-col border p-5 transition-colors ${on ? "border-sindoor" : "border-rule"}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-display text-[26px] leading-none">{d.title}</span>
                      <span className="shrink-0 rounded-full bg-kajal px-2.5 py-0.5 text-[11px] text-paper">{d.style}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-sepia">{d.credit}{r && d.credit.startsWith("Original") ? ` · ${r.name}` : ""}</div>
                    <p className="mt-3 flex-1 text-[14px] leading-[1.55] text-kajal/70">{d.blurb}</p>
                    <div className="mt-4 flex gap-2">
                      <button onClick={() => listen(d.key)} className={`rounded-full px-4 py-2 text-[14px] ${on ? "bg-sindoor text-paper" : "bg-kajal text-paper"}`}>{on ? "■ Stop" : "▶ Listen"}</button>
                      <button onClick={() => { open(demo(d.key)); say(`${d.title}: everything here can be changed`); }} className="rounded-full border border-rule px-4 py-2 text-[14px] hover:border-sindoor/60">Open in the studio</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-14 text-[12px] uppercase tracking-[0.24em] text-sepia">2 · Make your own</div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="leaf-card border border-rule p-6">
                <div className="font-display text-[30px] leading-none">Start from a sketch</div>
                <p className="mt-3 text-[15px] leading-[1.55] text-kajal/70">Sixteen bars that already play: drums, bass, keys, a line the composer wrote, a pad. Change it until it is yours.</p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <select value={sr.key} onChange={(e) => setStartRaga(e.target.value)} className="rounded-full border border-rule bg-paper px-3 py-2 text-[14px]">{ragas.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>
                  <button onClick={() => open(starter(sr, piecesOf(sr.key)))} className="rounded-full bg-kajal px-5 py-2 text-[14px] text-paper">Start →</button>
                </div>
              </div>
              <div className="leaf-card border border-rule p-6">
                <div className="font-display text-[30px] leading-none">Start from nothing</div>
                <p className="mt-3 text-[15px] leading-[1.55] text-kajal/70">An empty drum track and a sitar. Drag beats and melodies in from the library, or double-click a lane and write your own notes.</p>
                <button onClick={() => open(blank(sr))} className="mt-4 rounded-full border border-rule px-5 py-2 text-[14px] hover:border-sindoor/60">A blank page in {sr.name} →</button>
              </div>
            </div>
            <p className="mt-10 max-w-[70ch] text-[13px] leading-[1.6] text-sepia">The three famous tunes are old enough to be free for anyone (Beethoven, Pachelbel, a traditional hymn); recent songs are not, so they aren't here. The four originals are built from phrases the composer wrote in each raga. Every sound is synthesised in your browser.</p>
          </div>
        </section>
        <Footer />
      </main>
    );
  }

  // ------------------------------------------------------------------ the studio
  const openHit = openClip ? findClip(project, openClip) : null;
  const curTrack = project.tracks.find((t) => t.id === selTrack) ?? null;
  const fxTarget = sel.length === 1 && findClip(project, sel[0]) ? { kind: "clip" as const, ...findClip(project, sel[0])! } : curTrack ? { kind: "track" as const, track: curTrack } : null;
  const end = projectEnd(project), spb = secPerBeat(project), lr = loopRange();
  const btn = "rounded-full border border-rule px-3 py-1.5 text-[13px] transition-colors hover:border-sindoor/60 disabled:opacity-40";
  const ring = (k: string) => (pointAt === k ? "ring-4 ring-sona ring-offset-2 ring-offset-leaf animate-pulse" : "");
  const next = STEPS.find((s) => !done.includes(s.key));

  return (
    <main className="flex min-h-[100svh] flex-col px-3 pb-3 pt-[92px] text-kajal sm:px-5 lg:h-[100svh]">
      {/* ------------------------------------------------------------ transport */}
      <div className="flex flex-wrap items-center gap-2 rounded-t-xl border border-rule bg-leaf px-3 py-2">
        <button onClick={() => { stop(); setSaved(project); setView("home"); }} className="rounded-full px-2 py-1 text-[13px] text-sepia hover:text-sindoor" title="Back to the demos">← Studio</button>
        <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} className="w-44 bg-transparent font-display text-[22px] leading-none outline-none focus:underline" aria-label="Piece name" />
        <button data-guide="play" onClick={toggle} className={`h-11 w-11 rounded-full text-[17px] text-paper ${playing ? "bg-sindoor" : "bg-kajal"} ${ring("play")}`} title="Play / stop (space)">{playing ? "■" : "▶"}</button>
        <button onClick={() => { setPlayhead(0); if (playing) play(0); }} className="h-8 w-8 rounded-full border border-rule text-[12px]" title="To the start">⏮</button>
        <button onClick={() => setLoop(!loop)} className={`rounded-full border px-3 py-1.5 text-[13px] ${loop ? "border-sona bg-sona text-paper" : "border-rule"}`} title="Loop: the selected bars, or the whole piece (L)">⟳ Loop{loop ? (range ? " bars" : " all") : ""}</button>
        <div className="min-w-[150px] rounded-lg bg-kajal px-3 py-1 font-mono text-[13px] tabular-nums text-paper">
          <span ref={posRef}>{barBeat(playhead)} · {clock(playhead * spb)}</span> <span className="text-paper/55">/ {clock(end * spb)}</span>
        </div>
        <label className="flex items-center gap-1 text-[12px] text-sepia">Tempo <input type="number" min={60} max={180} value={project.bpm} onChange={(e) => { const v = Math.max(60, Math.min(180, Number(e.target.value) || 96)); edit((p) => capped({ ...p, bpm: v })); }} className="w-14 rounded border border-rule bg-paper px-1 text-kajal" /></label>
        <select value={project.raga} onChange={(e) => edit((p) => ({ ...p, raga: e.target.value }), `Now in ${ragas.find((r) => r.key === e.target.value)?.name}: the library and note rows follow`)} className="rounded-full border border-rule bg-paper px-2 py-1 text-[13px]" title="The raga">
          {ragas.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
        </select>
        {pro && <>
          <select value={project.sa} onChange={(e) => edit((p) => ({ ...p, sa: Number(e.target.value) }))} className="rounded-full border border-rule bg-paper px-2 py-1 text-[13px]" title="Sa, the home note">{SAS.map(([hz, n]) => <option key={hz} value={hz}>Sa = {n}</option>)}</select>
          <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} className="rounded-full border border-rule bg-paper px-2 py-1 text-[13px]" title="What moves and new notes line up to">{SNAPS.map(([v, n]) => <option key={v} value={v}>Snap {n}</option>)}</select>
        </>}
        <span className="flex items-center gap-1 text-[12px] text-sepia">
          <button onClick={() => zoom(ppb / 1.3)} className="h-7 w-7 rounded-full border border-rule" title="Zoom out (−)">−</button>
          {pro && <input type="range" min={4} max={240} value={ppb} onChange={(e) => zoom(Number(e.target.value))} className="w-24 accent-sindoor" title="Zoom (⌘/Ctrl + scroll)" />}
          <button onClick={() => zoom(ppb * 1.3)} className="h-7 w-7 rounded-full border border-rule" title="Zoom in (+)">+</button>
          <button onClick={() => fit()} className="rounded-full border border-rule px-2 py-1" title="See the whole piece (0)">Fit</button>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <button onClick={undo} disabled={!hist.past.length} className={btn} title="Undo (⌘Z)">↶ Undo</button>
          {pro && <button onClick={redo} disabled={!hist.future.length} className={btn} title="Redo (⇧⌘Z)">↷</button>}
          <button onClick={() => { const v = !pro; setPro(v); savePrefs({ pro: v }); }} className={`${btn} ${pro ? "border-kajal" : ""}`} title="Show every tool, or just the main ones">{pro ? "Simple tools" : "All tools"}</button>
          <details className="relative">
            <summary className={`${btn} cursor-pointer list-none`}>⋯</summary>
            <div className="absolute right-0 z-40 mt-1 w-56 space-y-1 rounded-lg border border-rule bg-leaf p-2 text-[13px] shadow-lg">
              <button onClick={share} className="block w-full rounded px-2 py-1 text-left hover:bg-paper2">Copy a link to this piece</button>
              <button onClick={saveFile} className="block w-full rounded px-2 py-1 text-left hover:bg-paper2">Save as a file</button>
              <label className="block w-full cursor-pointer rounded px-2 py-1 hover:bg-paper2">Open a file…<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} /></label>
              <button onClick={() => { setGuide(true); savePrefs({ guide: true }); }} className="block w-full rounded px-2 py-1 text-left hover:bg-paper2">Show first steps</button>
            </div>
          </details>
          <button onClick={exportWav} className="rounded-full bg-kajal px-4 py-1.5 text-[13px] text-paper" title="Render the whole piece to a WAV">{exporting !== null ? `Rendering ${Math.round(exporting * 100)}%` : "Export WAV"}</button>
        </span>
      </div>

      {/* ------------------------------------------------------------ what you can do now */}
      <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 border-x border-b border-rule bg-paper2/50 px-3 py-1 text-[12px]">
        {range ? (
          <>
            <span className="mr-1 text-sindoor">Bars {barBeat(range.a)} – {barBeat(range.b)}{range.tracks ? ` · ${range.tracks.length} track${range.tracks.length > 1 ? "s" : ""}` : ""}</span>
            <button className={btn} onClick={() => setLoop(true)}>⟳ Loop these</button>
            <button className={btn} onClick={doCopy} title="⌘C">Copy</button>
            <button className={btn} onClick={doPaste} disabled={!clipboard} title="⌘V">Paste at playhead</button>
            <button className={btn} onClick={doDuplicate} title="⌘D">Repeat</button>
            <button className={btn} onClick={doDelete}>Clear</button>
            <span className="mx-1 h-4 w-px bg-rule" />
            <button className={btn} onClick={() => doSpeed(2)}>Twice as fast</button>
            <button className={btn} onClick={() => doSpeed(0.5)}>Half as fast</button>
            {pro && <><button className={btn} onClick={() => doSpeed(1.5)}>×1.5</button><button className={btn} onClick={() => doSpeed(0.75)}>×0.75</button><button className={btn} onClick={doCut}>Cut</button><button className={btn} onClick={() => fit(range.a, range.b)}>Zoom to it</button></>}
            <button className="px-2 text-sepia hover:text-sindoor" onClick={() => setRange(null)}>✕</button>
          </>
        ) : sel.length ? (
          <>
            <span className="mr-1 text-sindoor">{sel.length === 1 ? findClip(project, sel[0])?.clip.name : `${sel.length} clips`}</span>
            {sel.length === 1 && <button className={btn} onClick={() => { setOpenClip(sel[0]); setPanel("notes"); }}>Edit notes</button>}
            <button className={btn} onClick={doDuplicate} title="⌘D">Duplicate</button>
            <button className={btn} onClick={doCopy}>Copy</button>
            <button className={btn} onClick={() => setPanel("fx")}>Effects</button>
            <button className={btn} onClick={doDelete}>Delete</button>
            {pro && <><button className={btn} onClick={doPaste} disabled={!clipboard}>Paste at playhead</button><button className={btn} onClick={doSplit}>Split at playhead</button><button className={btn} onClick={() => doSpeed(2)}>Faster ×2</button><button className={btn} onClick={() => doSpeed(0.5)}>Slower ×½</button></>}
          </>
        ) : guide && next ? (
          <>
            <span className="flex gap-1">{STEPS.map((x) => <span key={x.key} className={`h-1.5 w-4 rounded-full ${done.includes(x.key) ? "bg-sona" : x.key === next.key ? "bg-sindoor" : "bg-kajal/15"}`} />)}</span>
            <span className="ml-1 text-kajal">Step {STEPS.indexOf(next) + 1} of {STEPS.length}: {next.text}</span>
            <button onClick={() => { if (next.where.startsWith("lib")) document.querySelector<HTMLElement>(`[data-guide="${next.where}"]`)?.click(); setPointAt(next.where); setTimeout(() => setPointAt(null), 2600); }} className="text-sindoor underline">show me</button>
            <button onClick={() => mark(next.key)} className="text-sepia hover:text-sindoor">skip</button>
            <button onClick={() => { setGuide(false); savePrefs({ guide: false }); }} className="text-sepia hover:text-sindoor">hide the steps</button>
          </>
        ) : (
          <span className="text-sepia">{guide ? "That's the heart of it. All tools adds snapping, Sa, more speeds, splitting and cutting. · " : ""}Click a clip to select it · double-click it to see its notes · drag across the ruler to pick bars · drag things in from the library</span>
        )}
        {pro && <label className="ml-auto flex items-center gap-1 text-sepia"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-sindoor" />follow playhead</label>}
      </div>

      {/* ------------------------------------------------------------ timeline + library */}
      <div className="flex min-h-[380px] flex-1 border-x border-rule lg:min-h-0">
        <div className={`relative h-[380px] min-w-0 flex-1 bg-leaf/60 lg:h-auto ${ring("ruler")} ${ring("clip")} ${ring("mute")}`}>
          <Timeline project={project} ppb={ppb} snap={snap} playhead={playhead} playing={playing} selected={sel} range={range} selTrack={selTrack} printRef={printRef} drawRef={drawRef} loopRange={lr}
            scrollRef={scroll}
            onSeek={(b) => { setPlayhead(b); if (playing) play(b); }}
            onSelect={(ids, t) => { setSel(ids); setRange(null); if (t) setSelTrack(t); }}
            onRange={(r) => { setRange(r); if (r) setSel([]); }}
            onSelTrack={(id) => { setSelTrack(id); setSel([]); }}
            onMove={(moves, copy) => edit((p) => {
              if (copy) { let q = p; for (const m of moves) { const h = findClip(q, m.id); if (!h) continue; q = addClip(q, m.track ?? h.track.id, { ...h.clip, start: m.start }).project; } return q; }
              return moves.reduce((q, m) => moveClip(q, m.id, m.start, m.track), p);
            })}
            onResize={(id, len) => edit((p) => resizeClip(p, id, len))}
            onOpen={(id) => { setOpenClip(id); setSel([id]); setPanel("notes"); }}
            onCreate={(tid, at) => { let nid = ""; edit((p) => { const r = addClip(p, tid, { name: "New clip", start: at, len: 4, notes: [], fx: [] }); nid = r.id; return r.project; }, "An empty bar: click in the notes below to write"); setTimeout(() => { setOpenClip(nid); setSel([nid]); setPanel("notes"); }); }}
            onDrop={onDrop}
            onTrack={(id, patch) => { if ("mute" in patch || "solo" in patch) mark("mute"); edit((p) => setTrack(p, id, patch)); }}
            onRemoveTrack={(id) => edit((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== id) }), "Track removed (Undo brings it back)")}
            onZoom={(z, a) => zoom(z, a)}
          />
        </div>
        <aside className={`hidden w-[300px] shrink-0 flex-col border-l border-rule bg-leaf lg:flex ${pointAt?.startsWith("lib") ? "ring-4 ring-sona" : ""}`}>
          <div className="border-b border-rule p-2">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-sepia"><span>What you hear</span><span className="normal-case tracking-normal">{playing ? "live" : "press play"}</span></div>
            {engine.current ? <Scope analyser={engine.current.analyser} /> : <div className="mt-1 grid h-[188px] place-items-center rounded border border-dashed border-rule text-center text-[12px] text-sepia">The live wave and its spectrum<br />appear here when it plays</div>}
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
          <span className="ml-2 truncate text-[12px] text-sepia">{panel === "notes" ? (openHit ? "" : "Double-click a clip to open its notes") : panel === "sound" ? (curTrack ? `The sound of ${curTrack.name}` : "Click a track's name") : panel ? "" : `${project.tracks.length} tracks · ${clock(end * spb)} of 3:00 · Notes, Sound and Effects open here`}</span>
          {panel && <button onClick={() => setPanel(null)} className="ml-auto px-2 text-[12px] text-sepia hover:text-sindoor">Hide ▾</button>}
        </div>
        {panel && (
          <div className="h-[min(44vh,380px)]">
            {panel === "notes" && openHit && <NoteEditor clip={openHit.clip} track={openHit.track} raga={raga} snap={snap} sa={project.sa}
              playhead={playing ? playhead - openHit.clip.start : null}
              onChange={(notes: NoteEv[], len?: number) => { mark("notes"); edit((p) => { const q = setNotes(p, openHit.clip.id, notes); return len ? setClip(q, openHit.clip.id, { len }) : q; }); }}
              onAudition={(s) => audition(openHit.track.id, s)} onClose={() => { setOpenClip(null); setPanel(null); }} />}
            {panel === "notes" && !openHit && <p className="p-4 text-[14px] text-sepia">Double-click any clip on the timeline to see and change every note in it. Or double-click an empty spot in a lane to start a new bar.</p>}
            {panel === "sound" && (curTrack ? <SoundPanel track={curTrack} sa={project.sa} onTrack={(patch) => edit((p) => setTrack(p, curTrack.id, patch))} /> : <p className="p-4 text-[14px] text-sepia">Click a track's name on the left to design its sound.</p>)}
            {panel === "fx" && <FxPanel target={fxTarget} onChange={(fx) => edit((p) => (fxTarget?.kind === "clip" ? setClip(p, fxTarget.clip.id, { fx }) : fxTarget ? setTrack(p, fxTarget.track.id, { fx }) : p))} />}
            {panel === "library" && <Library raga={raga} pieces={pieces} onAdd={onAdd} />}
          </div>
        )}
      </div>

      {exporting !== null && (
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto w-[min(92vw,520px)] rounded-xl border border-rule bg-leaf p-4 shadow-xl">
          <div className="flex justify-between text-[13px]"><span>Rendering {project.name}…</span><span className="tabular-nums">{Math.round(exporting * 100)}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper2"><div className="h-full bg-sindoor transition-[width]" style={{ width: `${exporting * 100}%` }} /></div>
        </div>
      )}
      {toast && <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-kajal px-5 py-2 text-[14px] text-paper shadow-lg">{toast}</div>}
    </main>
  );
}
