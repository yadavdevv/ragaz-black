"use client";

// The panels under the timeline (Sound: design the selected track's synth, or pick its instrument;
// Effects: what runs on the selected clip or track, and its settings) and the library at the side,
// whose items are dragged onto the timeline (or clicked to drop them at the playhead).

import { useState } from "react";
import { Envelope, FilterView, Formula, Harmonics, Lfo, WavePlot } from "@/components/WaveEditors";
import { FX, FX_BY, GROUPS, defaults } from "@/lib/daw/fx";
import { GROOVES, INSTRUMENTS, bassLines, chordClips, phrases } from "@/lib/daw/library";
import { type Clip, type Fx, type Track, uid } from "@/lib/daw/model";
import type { Note, Raga } from "@/lib/music";
import { SHAPES, SOUNDS, type Patch } from "@/lib/waves";
import { DND, type Drag } from "./Timeline";

function Slider({ label, value, min, max, step, show, onChange, log }: { label: string; value: number; min: number; max: number; step?: number; show: (v: number) => string; onChange: (v: number) => void; log?: boolean }) {
  const pos = log ? Math.log(value / min) / Math.log(max / min) : value;
  return (
    <label className="block text-[12px]">
      <span className="flex justify-between text-kajal/70"><span>{label}</span><span className="tabular-nums">{show(value)}</span></span>
      <input type="range" min={log ? 0 : min} max={log ? 1 : max} step={log ? 0.001 : step} value={pos} onChange={(e) => { const v = Number(e.target.value); onChange(log ? Math.round(min * (max / min) ** v) : v); }} className="w-full accent-sindoor" />
    </label>
  );
}
const Chip = ({ on, onClick, children, title }: { on?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) => (
  <button title={title} onClick={onClick} className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${on ? "border-kajal bg-kajal text-paper" : "border-rule hover:border-sindoor/60"}`}>{children}</button>
);
const pct = (x: number) => `${Math.round(x * 100)}%`, sec = (x: number) => (x < 1 ? `${Math.round(x * 1000)} ms` : `${x.toFixed(2)} s`), hz = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} kHz` : `${Math.round(x)} Hz`);

// ------------------------------------------------------------------------------------- sound

export function SoundPanel({ track, sa, onTrack }: { track: Track; sa: number; onTrack: (patch: Partial<Track>) => void }) {
  const [focus, setFocus] = useState<number | null>(null);
  const p = track.patch;
  const edit = (f: (q: Patch) => void) => { const q: Patch = JSON.parse(JSON.stringify(p)); f(q); onTrack({ patch: q, sound: undefined }); };
  return (
    <div className="h-full overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[18px] text-kajal">{track.name}</span>
        <span className="text-[12px] text-sepia">instrument</span>
        {INSTRUMENTS.filter((d) => (d.inst === "drums") === (track.inst === "drums")).map((d) => (
          <Chip key={d.name} on={track.inst === d.inst && (d.inst !== "synth" || track.sound === d.sound)} title={d.blurb}
            onClick={() => { const s = SOUNDS.find((x) => x.key === d.sound); onTrack({ inst: d.inst, sound: d.sound, patch: s ? JSON.parse(JSON.stringify(s.patch)) : track.patch }); }}>{d.name}</Chip>
        ))}
      </div>
      {track.inst !== "synth" || !p ? (
        <p className="mt-4 max-w-[60ch] text-[14px] leading-[1.6] text-sepia">{INSTRUMENTS.find((d) => d.inst === track.inst)?.blurb} This instrument is modelled, not designed from harmonics: pick one of the synth sounds above (Glass, Pluck, Reed, Pad, Bass, Organ) to shape its waves here.</p>
      ) : (
        <div className="mt-3 grid gap-5 xl:grid-cols-[1.1fr_1fr_1fr]">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-sepia">The wave · drag the harmonics</div>
            <div className="mt-1 flex flex-wrap gap-1.5">{SHAPES.map((s) => <Chip key={s.key} onClick={() => edit((q) => { const m = s.make(); q.amp = m.amp; q.phase = m.phase; })} title={s.how}>{s.name}</Chip>)}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Harmonics patch={p} focus={focus} onFocus={setFocus} onChange={(amp, phase) => edit((q) => { q.amp = amp; q.phase = phase; })} />
              <WavePlot patch={p} focus={focus} height={170} />
            </div>
            <div className="mt-1 overflow-x-auto"><Formula patch={p} /></div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-sepia">Shape in time · drag A, D·S, R</div>
            <Envelope env={p.env} onChange={(e) => edit((q) => { q.env = e; })} />
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Slider label="Voices" value={p.voices} min={1} max={7} step={1} show={String} onChange={(v) => edit((q) => { q.voices = v; })} />
              <Slider label="Spread" value={p.spread} min={0} max={50} step={1} show={(v) => `${v}¢`} onChange={(v) => edit((q) => { q.spread = v; })} />
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-sepia">Colour and movement</div>
            <FilterView patch={p} sa={sa} />
            <div className="mt-1 grid grid-cols-3 gap-3">
              <Slider log label="Cutoff" value={p.filter.cutoff} min={80} max={16000} show={hz} onChange={(v) => edit((q) => { q.filter.cutoff = v; })} />
              <Slider label="Resonance" value={p.filter.q} min={0} max={18} step={0.1} show={(v) => `${v.toFixed(1)} dB`} onChange={(v) => edit((q) => { q.filter.q = v; })} />
              <Slider label="Sweep" value={p.filter.sweep} min={0} max={1} step={0.01} show={pct} onChange={(v) => edit((q) => { q.filter.sweep = v; })} />
              <Slider label="Vibrato" value={p.vib.depth} min={0} max={60} step={1} show={(v) => `±${v}¢`} onChange={(v) => edit((q) => { q.vib.depth = v; })} />
              <Slider label="Tremolo" value={p.trem.depth} min={0} max={1} step={0.01} show={pct} onChange={(v) => edit((q) => { q.trem.depth = v; })} />
              <Slider label="Room" value={p.reverb} min={0} max={1} step={0.01} show={pct} onChange={(v) => edit((q) => { q.reverb = v; })} />
            </div>
            <div className="mt-1 grid grid-cols-2 gap-3"><Lfo rate={p.vib.rate} depth={p.vib.depth} max={60} label="pitch" /><Lfo rate={p.trem.rate} depth={p.trem.depth} max={1} label="loudness" /></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------- effects

export function FxPanel({ target, onChange }: { target: { kind: "clip"; clip: Clip; track: Track } | { kind: "track"; track: Track } | null; onChange: (fx: Fx[]) => void }) {
  if (!target) return <p className="p-4 text-[14px] text-sepia">Select a clip (or a track) to see its effects. Drag an effect from the library onto a clip to run it while that clip plays, or onto a track's name to run it under the whole track.</p>;
  const fx = target.kind === "clip" ? target.clip.fx : target.track.fx;
  const set = (id: string, key: string, v: number) => onChange(fx.map((f) => (f.id === id ? { ...f, params: { ...f.params, [key]: v } } : f)));
  return (
    <div className="h-full overflow-auto p-3">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[18px] text-kajal">{target.kind === "clip" ? target.clip.name : target.track.name}</span>
        <span className="text-[12px] text-sepia">{target.kind === "clip" ? "effects while this clip plays" : "effects under the whole track"} · applied in order, top to bottom</span>
      </div>
      {!fx.length && <p className="mt-3 text-[14px] text-sepia">No effects yet. Drag one from the library, or add one here:</p>}
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fx.map((f, i) => {
          const def = FX_BY[f.type];
          return (
            <div key={f.id} className="rounded-lg border border-rule bg-leaf p-3">
              <div className="flex items-center gap-2">
                <FxIcon d={def.icon} />
                <span className="font-display text-[17px]">{def.name}</span>
                <span className="text-[11px] text-sepia">{def.group}</span>
                <span className="ml-auto flex gap-1 text-[12px]">
                  {i > 0 && <button title="Earlier" onClick={() => { const q = [...fx]; [q[i - 1], q[i]] = [q[i], q[i - 1]]; onChange(q); }} className="px-1 hover:text-sindoor">↑</button>}
                  <button title="Remove" onClick={() => onChange(fx.filter((x) => x.id !== f.id))} className="px-1 hover:text-sindoor">✕</button>
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-[1.45] text-kajal/60">{def.blurb}</p>
              <div className="mt-2 space-y-1">{def.params.map((pm) => <Slider key={pm.key} label={pm.label} value={f.params[pm.key] ?? pm.def} min={pm.min} max={pm.max} step={pm.step} show={(v) => `${pm.step < 1 ? (pm.max <= 1 ? pct(v) : v.toFixed(2)) : v}${pm.unit && pm.max > 1 ? ` ${pm.unit}` : ""}`} onChange={(v) => set(f.id, pm.key, v)} />)}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {FX.map((d) => <Chip key={d.type} onClick={() => onChange([...fx, { id: uid("f"), type: d.type, params: defaults(d.type) }])} title={d.blurb}>+ {d.name}</Chip>)}
      </div>
    </div>
  );
}

export const FxIcon = ({ d, className = "" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 34 20" className={`h-5 w-8 shrink-0 ${className}`}><path d={d} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" /></svg>
);

// ------------------------------------------------------------------------------------- library

type Item = { key: string; name: string; blurb?: string; drag: Drag; preview?: Clip };

/** A clip in miniature, for the library cards. */
function Thumb({ clip, drums }: { clip: Omit<Clip, "id">; drums: boolean }) {
  const ns = clip.notes, lo = drums ? 0 : Math.min(...ns.map((n) => n.s)), hi = drums ? 7 : Math.max(...ns.map((n) => n.s));
  const y = (s: number) => 2 + (hi === lo ? 9 : ((hi - s) / (hi - lo)) * 18);
  return (
    <svg viewBox={`0 0 ${clip.len * 12} 24`} preserveAspectRatio="none" className="mt-1 h-6 w-full">
      {ns.map((n) => (drums ? <circle key={n.id} cx={n.t * 12 + 1} cy={y(n.s) + 1} r={1.3} fill="#B23A22" /> : <rect key={n.id} x={n.t * 12} y={y(n.s)} width={Math.max(1.5, n.d * 12 - 1)} height={2.4} fill="#131A2B" />))}
    </svg>
  );
}

export function Library({ raga, pieces, onAdd }: { raga: Raga; pieces: Note[][]; onAdd: (d: Drag) => void }) {
  const [tab, setTab] = useState<"fx" | "grooves" | "phrases" | "bass" | "chords" | "sounds">("grooves");
  const [group, setGroup] = useState<string>("all");
  const clipItems = (list: { name: string; blurb?: string; make: () => Omit<Clip, "id"> }[], drums: boolean, suggest?: string): Item[] => list.map((x) => ({ key: x.name, name: x.name, blurb: x.blurb, drag: { kind: "clip", clip: x.make(), drums, suggest } }));
  const items: Item[] =
    tab === "fx" ? FX.filter((f) => group === "all" || f.group === group).map((f) => ({ key: f.type, name: f.name, blurb: f.blurb, drag: { kind: "fx", type: f.type } }))
    : tab === "grooves" ? clipItems(GROOVES, true, "drums")
    : tab === "phrases" ? clipItems(phrases(pieces, 12).map((x) => ({ ...x, blurb: "Eight beats the composer wrote in this raga." })), false, "sitar")
    : tab === "bass" ? clipItems(bassLines(raga), false, "bass")
    : tab === "chords" ? clipItems(chordClips(raga), false, "epiano")
    : INSTRUMENTS.map((d, i) => ({ key: d.name, name: d.name, blurb: d.blurb, drag: { kind: "inst", index: i } }));
  const TABS = [["grooves", "Grooves"], ["phrases", "Phrases"], ["bass", "Bass"], ["chords", "Chords"], ["fx", "Effects"], ["sounds", "Sounds"]] as const;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1 border-b border-rule p-2">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`rounded-full px-2.5 py-1 text-[12px] ${tab === k ? "bg-kajal text-paper" : "text-kajal/70 hover:text-sindoor"}`}>{l}</button>)}
      </div>
      {tab === "fx" && <div className="flex flex-wrap gap-1 border-b border-rule px-2 py-1.5">{["all", ...GROUPS].map((g) => <button key={g} onClick={() => setGroup(g)} className={`rounded px-1.5 text-[11px] ${group === g ? "text-sindoor underline" : "text-sepia"}`}>{g}</button>)}</div>}
      <p className="px-3 pt-2 text-[11px] leading-[1.4] text-sepia">{tab === "fx" ? "Drag onto a clip (runs while it plays) or a track's name (always). Click to add to the selection." : tab === "sounds" ? "Click to add a track with this sound." : `Drag onto a lane, or click to drop at the playhead. In ${raga.name}.`}</p>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
        {items.map((it) => (
          <div key={it.key} draggable onDragStart={(e) => { e.dataTransfer.setData(DND, JSON.stringify(it.drag)); e.dataTransfer.effectAllowed = "copy"; }}
            onClick={() => onAdd(it.drag)}
            className="cursor-grab rounded-lg border border-rule bg-leaf px-2.5 py-2 transition-colors hover:border-sindoor/60 active:cursor-grabbing">
            <div className="flex items-center gap-2">
              {it.drag.kind === "fx" && <FxIcon d={FX_BY[it.drag.type].icon} className="text-sindoor" />}
              <span className="font-display text-[15px] leading-tight text-kajal">{it.name}</span>
              {it.drag.kind === "clip" && <span className="ml-auto text-[10px] text-sepia">{it.drag.clip.len / 4} bar{it.drag.clip.len === 4 ? "" : "s"}</span>}
            </div>
            {it.blurb && <div className="mt-0.5 text-[11px] leading-[1.35] text-kajal/55">{it.blurb}</div>}
            {it.drag.kind === "clip" && <Thumb clip={it.drag.clip} drums={it.drag.drums} />}
          </div>
        ))}
      </div>
    </div>
  );
}
