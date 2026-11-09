// Checks the studio's editing operations (lib/daw/model.ts) on a small project: npx tsx scripts/daw-check.ts
import assert from "node:assert/strict";
import { type Project, clearRange, copyRange, maxBeats, paste, projectEnd, repeatRange, speedClip, speedRange, splitClip } from "../lib/daw/model";
import { timeline } from "../lib/daw/engine";

const note = (t: number, s: number, d = 1) => ({ id: `n${t}-${s}`, t, d, s, v: 1 });
const base = (): Project => ({
  version: 1, name: "t", bpm: 120, raga: "yaman", sa: 220,
  tracks: [
    { id: "A", name: "A", inst: "sitar", color: "", volume: 1, pan: 0, mute: false, solo: false, fx: [], clips: [{ id: "c1", name: "c1", start: 0, len: 8, notes: [0, 2, 4, 6].map((t) => note(t, t)), fx: [] }] },
    { id: "B", name: "B", inst: "drums", color: "", volume: 1, pan: 0, mute: false, solo: false, fx: [], clips: [{ id: "c2", name: "c2", start: 8, len: 4, notes: [note(0, 0), note(2, 1)], fx: [] }] },
  ],
});
const notesAt = (p: Project, track: string) => p.tracks.find((t) => t.id === track)!.clips.flatMap((c) => c.notes.map((n) => [c.start + n.t, n.s, n.d])).sort((a, b) => a[0] - b[0]);

// split keeps every note, at the same absolute time
let p = splitClip(base(), "c1", 3);
assert.equal(p.tracks[0].clips.length, 2);
assert.deepEqual(notesAt(p, "A").map((x) => x[0]), [0, 2, 4, 6]);
assert.equal(notesAt(p, "A")[1][2], 1, "a note crossing the cut is shortened to it");

// copy beats 2..6 of everything and paste at 12: notes 2,4 land at 12,14
const cb = copyRange(base(), { a: 2, b: 6 });
p = paste(base(), cb, 12);
assert.deepEqual(notesAt(p, "A").map((x) => x[0]), [0, 2, 4, 6, 12, 14]);
assert.equal(projectEnd(p), 16);

// clear 2..6 leaves silence, later music untouched
p = clearRange(base(), { a: 2, b: 6 });
assert.deepEqual(notesAt(p, "A").map((x) => x[0]), [0, 6]);
assert.deepEqual(notesAt(p, "B").map((x) => x[0]), [8, 10]);

// speed 0..8 ×2: notes at 0,1,2,3 and the drum clip moves from 8 to 4
p = speedRange(base(), { a: 0, b: 8 }, 2);
assert.deepEqual(notesAt(p, "A").map((x) => x[0]), [0, 1, 2, 3]);
assert.deepEqual(notesAt(p, "B").map((x) => x[0]), [4, 6]);
// slow 0..8 ×0.5: everything after moves back 8 beats
p = speedRange(base(), { a: 0, b: 8 }, 0.5);
assert.deepEqual(notesAt(p, "A").map((x) => x[0]), [0, 4, 8, 12]);
assert.deepEqual(notesAt(p, "B").map((x) => x[0]), [16, 18]);

// repeat 0..8 on track A only: A's notes twice, B untouched
p = repeatRange(base(), { a: 0, b: 8, tracks: ["A"] });
assert.deepEqual(notesAt(p, "A").map((x) => x[0]), [0, 2, 4, 6, 8, 10, 12, 14]);
assert.deepEqual(notesAt(p, "B").map((x) => x[0]), [8, 10]);
// a clip crossing the end of the repeated range keeps its tail
p = repeatRange(base(), { a: 0, b: 5, tracks: ["A"] });
assert.deepEqual(notesAt(p, "A").map((x) => x[0]), [0, 2, 4, 5, 7, 9, 11]);

// the 3-minute cap: at 120 bpm, 360 beats; pasting near the end is cut there
p = paste(base(), copyRange(base(), { a: 0, b: 8 }), maxBeats(base()) - 3);
assert.ok(projectEnd(p) <= maxBeats(base()) + 1e-9);

// speedClip ×2 halves the clip
p = speedClip(base(), "c1", 2);
assert.equal(p.tracks[0].clips[0].len, 4);

// the timeline: muted tracks drop out, solo wins, note effects apply
const q = base();
q.tracks[0].clips[0].fx = [{ id: "f", type: "octave", params: { level: 0.5 } }];
assert.equal(timeline(q).evs.filter((e) => e.track === "A").length, 8);
q.tracks[1].solo = true;
assert.equal(timeline(q).evs.filter((e) => e.track === "A").length, 0);
console.log("daw model: all checks passed");
