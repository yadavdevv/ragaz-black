// The studio's project: tracks of clips of notes on one timeline, in beats. Everything here is a
// pure function from a project to a new project, so every edit can be undone and nothing is
// mutated under the audio engine's feet.
//
//   project   tempo, raga, Sa, and up to 3 minutes of tracks
//   track     one instrument (a designed synth, a melody instrument, or drums), its level, pan,
//             mute/solo, and effects that run under the whole track
//   clip      a block of notes at a place on the timeline, with effects that run only while it plays
//   note      t and d in beats from the clip's start; s = semitones above Sa (or a drum, on a drum
//             track); v = how hard, 0..1

import type { Patch } from "../waves";

export const MAX_SECONDS = 180;

export type NoteEv = { id: string; t: number; d: number; s: number; v: number };
export type Fx = { id: string; type: string; params: Record<string, number> };
export type Clip = { id: string; name: string; start: number; len: number; notes: NoteEv[]; fx: Fx[] };
export type Instrument = "synth" | "sitar" | "santoor" | "bansuri" | "shehnai" | "sarangi" | "epiano" | "supersaw" | "drums";
export type Track = { id: string; name: string; inst: Instrument; patch?: Patch; sound?: string; color: string; volume: number; pan: number; mute: boolean; solo: boolean; fx: Fx[]; clips: Clip[] };
export type Project = { version: 1; name: string; bpm: number; raga: string; sa: number; tracks: Track[] };

export const DRUM_ROWS = ["Kick", "Snare", "Clap", "Hat", "Open hat", "Shaker", "Rim", "Log drum"] as const;

let counter = 0;
export const uid = (p = "x") => `${p}${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export const secPerBeat = (p: Pick<Project, "bpm">) => 60 / p.bpm;
export const maxBeats = (p: Pick<Project, "bpm">) => Math.floor((MAX_SECONDS * p.bpm) / 60);
export const projectEnd = (p: Project) => Math.max(0, ...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.len)));
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
export const barBeat = (beat: number) => `${Math.floor(beat / 4) + 1}.${Math.floor(beat % 4) + 1}`;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const fresh = (c: Clip): Clip => ({ ...clone(c), id: uid("c"), notes: c.notes.map((n) => ({ ...n, id: uid("n") })), fx: c.fx.map((f) => ({ ...f, id: uid("f") })) });
const mapTrack = (p: Project, id: string, f: (t: Track) => Track): Project => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? f(t) : t)) });
const mapClip = (p: Project, id: string, f: (c: Clip) => Clip): Project => ({ ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => c.id === id) ? { ...t, clips: t.clips.map((c) => (c.id === id ? f(c) : c)) } : t)) });

export const findClip = (p: Project, id: string | null) => {
  for (const t of p.tracks) for (const c of t.clips) if (c.id === id) return { track: t, clip: c };
  return null;
};

/** Keep the piece under the cap: clips past the end are cut off there. */
export function capped(p: Project): Project {
  const max = maxBeats(p);
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.start < max).map((c) => (c.start + c.len > max ? trimClip(c, max - c.start) : c)) })) };
}

function trimClip(c: Clip, len: number): Clip {
  return { ...c, len, notes: c.notes.filter((n) => n.t < len).map((n) => ({ ...n, d: Math.min(n.d, len - n.t) })) };
}

// ------------------------------------------------------------------------------------- clips

export const setTrack = (p: Project, id: string, patch: Partial<Track>) => mapTrack(p, id, (t) => ({ ...t, ...patch }));
export const setClip = (p: Project, id: string, patch: Partial<Clip>) => capped(mapClip(p, id, (c) => ({ ...c, ...patch })));
export const setNotes = (p: Project, id: string, notes: NoteEv[]) => mapClip(p, id, (c) => ({ ...c, notes: [...notes].sort((a, b) => a.t - b.t || a.s - b.s) }));

export function addClip(p: Project, trackId: string, c: Omit<Clip, "id">): { project: Project; id: string } {
  const id = uid("c");
  return { project: capped(mapTrack(p, trackId, (t) => ({ ...t, clips: [...t.clips, { ...clone(c), id, notes: c.notes.map((n) => ({ ...n, id: uid("n") })) }] }))), id };
}

export const removeClips = (p: Project, ids: string[]) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.includes(c.id)) })) });

/** Move a clip (and optionally to another track of the same kind). */
export function moveClip(p: Project, id: string, start: number, toTrack?: string): Project {
  const hit = findClip(p, id);
  if (!hit) return p;
  const c = { ...hit.clip, start: Math.max(0, start) };
  const dest = toTrack && p.tracks.find((t) => t.id === toTrack);
  if (dest && dest.id !== hit.track.id && (dest.inst === "drums") === (hit.track.inst === "drums")) {
    return capped({ ...p, tracks: p.tracks.map((t) => (t.id === hit.track.id ? { ...t, clips: t.clips.filter((x) => x.id !== id) } : t.id === dest.id ? { ...t, clips: [...t.clips, c] } : t)) });
  }
  return capped(mapClip(p, id, () => c));
}

/** Change a clip's length from its end (notes past the new end are hidden, not lost, until saved
 *  over: trimming keeps only what is inside). */
export const resizeClip = (p: Project, id: string, len: number) => capped(mapClip(p, id, (c) => ({ ...c, len: Math.max(0.25, len) })));

/** Split a clip in two at an absolute beat. */
export function splitClip(p: Project, id: string, at: number): Project {
  const hit = findClip(p, id);
  if (!hit) return p;
  const c = hit.clip, cut = at - c.start;
  if (cut <= 0.01 || cut >= c.len - 0.01) return p;
  const a: Clip = { ...c, len: cut, notes: c.notes.filter((n) => n.t < cut).map((n) => ({ ...n, d: Math.min(n.d, cut - n.t) })) };
  const b: Clip = { ...fresh(c), name: c.name, start: at, len: c.len - cut, notes: c.notes.filter((n) => n.t >= cut).map((n) => ({ ...n, id: uid("n"), t: n.t - cut })) };
  return mapTrack(p, hit.track.id, (t) => ({ ...t, clips: t.clips.flatMap((x) => (x.id === id ? [a, b] : [x])) }));
}

/** Copies of clips placed right after themselves (as a group: the block repeats). */
export function duplicateClips(p: Project, ids: string[]): { project: Project; ids: string[] } {
  const chosen = p.tracks.flatMap((t) => t.clips.filter((c) => ids.includes(c.id)));
  if (!chosen.length) return { project: p, ids: [] };
  const a = Math.min(...chosen.map((c) => c.start)), b = Math.max(...chosen.map((c) => c.start + c.len));
  const out: string[] = [];
  const q = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: [...t.clips, ...t.clips.filter((c) => ids.includes(c.id)).map((c) => { const n = { ...fresh(c), start: c.start + (b - a) }; out.push(n.id); return n; })] })) };
  return { project: capped(q), ids: out };
}

/** Play a clip faster or slower: its notes and length scale by 1/factor (×2 = twice as fast). */
export function speedClip(p: Project, id: string, factor: number): Project {
  return capped(mapClip(p, id, (c) => ({ ...c, len: c.len / factor, notes: c.notes.map((n) => ({ ...n, t: n.t / factor, d: n.d / factor })) })));
}

// ------------------------------------------------------------------------------------- ranges

export type Range = { a: number; b: number; tracks?: string[] }; // beats; tracks: all if absent
export type Clipboard = { len: number; tracks: { trackId: string; inst: Instrument; clips: Clip[] }[] };

const inRange = (r: Range, t: Track) => !r.tracks || r.tracks.includes(t.id);

/** Split every clip that crosses the range's edges, so the range holds whole clips. */
function cutAtEdges(p: Project, r: Range): Project {
  let q = p;
  for (const t of p.tracks) {
    if (!inRange(r, t)) continue;
    for (const c of t.clips) {
      if (c.start < r.a && c.start + c.len > r.a) q = splitClip(q, c.id, r.a);
    }
  }
  for (const t of q.tracks) {
    if (!inRange(r, t)) continue;
    for (const c of t.clips) if (c.start < r.b && c.start + c.len > r.b) q = splitClip(q, c.id, r.b);
  }
  return q;
}

const inside = (c: Clip, r: Range) => c.start >= r.a - 1e-6 && c.start + c.len <= r.b + 1e-6;

export function copyRange(p: Project, r: Range): Clipboard {
  const q = cutAtEdges(p, r);
  return {
    len: r.b - r.a,
    tracks: q.tracks.filter((t) => inRange(r, t)).map((t) => ({ trackId: t.id, inst: t.inst, clips: t.clips.filter((c) => inside(c, r)).map((c) => ({ ...clone(c), start: c.start - r.a })) })),
  };
}

/** Remove everything in the range, leaving silence (later music stays where it is). */
export function clearRange(p: Project, r: Range): Project {
  const q = cutAtEdges(p, r);
  return { ...q, tracks: q.tracks.map((t) => (inRange(r, t) ? { ...t, clips: t.clips.filter((c) => !inside(c, r)) } : t)) };
}

/** Paste over what is at `at` (it replaces it, as long as the clipboard is), track for track. */
export function paste(p: Project, cb: Clipboard, at: number, onto?: string): Project {
  let q = clearRange(p, { a: at, b: at + cb.len, tracks: onto ? [onto] : cb.tracks.map((x) => x.trackId).filter((id) => p.tracks.some((t) => t.id === id)) });
  for (const src of cb.tracks) {
    // Onto the same track if it still exists; a single-track clipboard can go onto any track of its kind.
    const dest = onto && cb.tracks.length === 1 ? q.tracks.find((t) => t.id === onto) : q.tracks.find((t) => t.id === src.trackId);
    if (!dest) continue;
    q = mapTrack(q, dest.id, (t) => ({ ...t, clips: [...t.clips, ...src.clips.map((c) => ({ ...fresh(c), start: c.start + at }))] }));
  }
  return capped(q);
}

/** Speed the range up or down: its music plays `factor` times as fast, and what follows it moves
 *  up (or back) so nothing overlaps. */
export function speedRange(p: Project, r: Range, factor: number): Project {
  const q = cutAtEdges(p, r);
  const shift = (r.b - r.a) / factor - (r.b - r.a);
  return capped({
    ...q,
    tracks: q.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        if (inside(c, r)) return { ...c, start: r.a + (c.start - r.a) / factor, len: c.len / factor, notes: c.notes.map((n) => ({ ...n, t: n.t / factor, d: n.d / factor })) };
        if (c.start >= r.b - 1e-6) return { ...c, start: c.start + shift };
        return c;
      }),
    })),
  });
}

/** Repeat the range right after itself, pushing what followed later. */
export function repeatRange(p: Project, r: Range): Project {
  const base = cutAtEdges(p, r);
  const cb = copyRange(base, r);
  const len = r.b - r.a;
  const pushed = { ...base, tracks: base.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (inRange(r, t) && c.start >= r.b - 1e-6 ? { ...c, start: c.start + len } : c)) })) };
  return paste(pushed, cb, r.b);
}

// ------------------------------------------------------------------------------------- history

export type History = { past: Project[]; future: Project[] };
export const commit = (h: History, before: Project): History => ({ past: [...h.past.slice(-99), before], future: [] });
