// Things to start from: instruments, drum grooves, bass lines and chords in the raga, phrases the
// composer wrote, and a first project that already plays.

import { type Note, type Raga, SWARAS } from "../music";
import { ragaChords } from "../studio";
import { SOUNDS } from "../waves";
import { defaults } from "./fx";
import { type Clip, type Instrument, type NoteEv, type Project, type Track, uid } from "./model";

export const COLORS = ["#B23A22", "#A8853C", "#D9705A", "#131A2B", "#4A5166", "#8C6A35"];

export type InstDef = { inst: Instrument; sound?: string; name: string; blurb: string };
export const INSTRUMENTS: InstDef[] = [
  ...SOUNDS.map((s) => ({ inst: "synth" as const, sound: s.key, name: s.name, blurb: `Synth: ${s.how}` })),
  { inst: "sitar", name: "Sitar", blurb: "Plucked, buzzing strings." },
  { inst: "santoor", name: "Santoor", blurb: "Struck strings that ring on." },
  { inst: "bansuri", name: "Bansuri", blurb: "Bamboo flute: breath and a pure tone." },
  { inst: "shehnai", name: "Shehnai", blurb: "A bright, nasal reed." },
  { inst: "sarangi", name: "Sarangi", blurb: "A bowed fiddle, close to a voice." },
  { inst: "epiano", name: "E-piano", blurb: "A warm electric piano (FM)." },
  { inst: "supersaw", name: "Supersaw", blurb: "Seven detuned saws: big chords." },
  { inst: "drums", name: "Drums", blurb: "Kick, snare, clap, hats, shaker, rim, log drum." },
];

export function newTrack(def: InstDef, i: number): Track {
  const sound = SOUNDS.find((s) => s.key === def.sound);
  return { id: uid("t"), name: def.name, inst: def.inst, sound: def.sound, patch: sound ? JSON.parse(JSON.stringify(sound.patch)) : undefined, color: COLORS[i % COLORS.length], volume: 0.8, pan: 0, mute: false, solo: false, fx: [], clips: [] };
}

const n = (t: number, s: number, d = 0.25, v = 0.9): NoteEv => ({ id: uid("n"), t, d, s, v });
const clip = (name: string, len: number, notes: NoteEv[]): Omit<Clip, "id"> => ({ name, start: 0, len, notes, fx: [] });

// ------------------------------------------------------------------------------------- grooves
// 16 steps a bar, two bars. K kick, S snare, C clap, H hat, O open hat, X shaker, R rim, L log drum.
const ROW: Record<string, number> = { K: 0, S: 1, C: 2, H: 3, O: 4, X: 5, R: 6, L: 7 };
function groove(name: string, lines: Record<string, string>): Omit<Clip, "id"> {
  const notes: NoteEv[] = [];
  for (const [k, line] of Object.entries(lines)) {
    [...line.replace(/\s/g, "")].forEach((c, i) => { if (c !== ".") notes.push(n(i / 4, ROW[k], 0.25, c === "x" ? 0.55 : 0.95)); });
  }
  return clip(name, 8, notes);
}
export const GROOVES: { name: string; blurb: string; make: () => Omit<Clip, "id"> }[] = [
  { name: "Boom bap", blurb: "Lazy hip-hop: kick, snare on 2 and 4.", make: () => groove("Boom bap", { K: "X......X..X..... X......X........", S: "....X.......X... ....X.......X..x", H: "X.X.X.X.X.X.X.X. X.X.X.X.X.X.X.XX" }) },
  { name: "Four on the floor", blurb: "House: a kick on every beat, claps, open hats off the beat.", make: () => groove("Four on the floor", { K: "X...X...X...X... X...X...X...X...", C: "....X.......X... ....X.......X...", O: "..X...X...X...X. ..X...X...X...X.", H: "x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x." }) },
  { name: "Trap", blurb: "Half-time: a snare on 3, rolling hats.", make: () => groove("Trap", { K: "X......X..X..... X.....X...X.X...", S: "........X....... ........X.......", H: "X.X.X.XXX.X.X.X. X.X.XXXXX.X.X.XX" }) },
  { name: "Amapiano", blurb: "Soft four-on-the-floor, shakers, rims, the log drum.", make: () => groove("Amapiano", { K: "X...X...X...X... X...X...X...X...", R: "...X..X....X..X. ...X..X....X..X.", X: "xXxXxXxXxXxXxXxX xXxXxXxXxXxXxXxX", L: "......X...X..X.. ......X...X.X..." }) },
  { name: "Dembow", blurb: "Reggaeton's boom-ch-boom-chick.", make: () => groove("Dembow", { K: "X...X...X...X... X...X...X...X...", S: "...X..X....X..X. ...X..X....X..X.", H: "x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x." }) },
  { name: "Breakbeat", blurb: "Syncopated, busy, the drum'n'bass engine.", make: () => groove("Breakbeat", { K: "X.........X..... ..X.......X.....", S: "....X..x.X..X... ....X..x.X..X.x.", H: "X.X.X.X.X.X.X.X. X.X.X.X.X.X.X.X." }) },
  { name: "Teentaal feel", blurb: "Sixteen beats like a tabla theka: heavy on 1, open on 9.", make: () => groove("Teentaal feel", { K: "X.......X....... ........X.......", R: "X.X.X.X.X.X.X.X. X.X.X.X.....X.X.", L: "X...X...X...X... ........X...X...", X: "x.x.x.x.x.x.x.x. x.x.x.x.x.x.x.x." }) },
  { name: "Fill", blurb: "One bar of build: snares that speed up into the next section.", make: () => { const c = groove("Fill", { K: "X...X...X...X... X...............", S: "X.X.X.X.XXXXXXXX ................" }); return { ...c, len: 4, notes: c.notes.filter((x) => x.t < 4) }; } },
];

// ------------------------------------------------------------------------------------- in the raga

const semis = (x: Pick<Note, "s" | "o">) => SWARAS.indexOf(x.s) + 12 * x.o;
const deg = (r: Raga, i: number, o = 0) => { const k = r.swaras.length; return SWARAS.indexOf(r.swaras[((i % k) + k) % k]) + 12 * (o + Math.floor(i / k)); };

export function bassLines(r: Raga): { name: string; blurb: string; make: () => Omit<Clip, "id"> }[] {
  const pa = r.swaras.includes("P") ? 7 : r.swaras.includes("m") ? 5 : SWARAS.indexOf(r.swaras[Math.floor(r.swaras.length / 2)]);
  return [
    { name: "Sa pedal", blurb: "Sa, low, on the beat: the drone in the bass.", make: () => clip("Sa pedal", 8, [0, 1.5, 2, 3.5, 4, 5.5, 6, 7.5].map((t) => n(t, -12, 0.45))) },
    { name: "Sa–Pa bounce", blurb: "Sa and its fifth, bouncing an octave.", make: () => clip("Sa–Pa bounce", 8, [[0, -12], [0.75, 0], [1.5, pa - 12], [2, -12], [3, pa - 12], [3.5, pa - 12], [4, -12], [4.75, 0], [5.5, pa - 12], [6, -12], [7, deg(r, -1, -1)]].map(([t, s]) => n(t, s, 0.4))) },
    { name: "Walking", blurb: "Steps through the raga's notes, one per beat.", make: () => clip("Walking", 8, [0, 1, 2, 3, 4, 3, 2, 1].map((d, i) => n(i, deg(r, d, -1), 0.9))) },
    { name: "808 slides", blurb: "Long low notes for a trap bass.", make: () => clip("808 slides", 8, [n(0, -12, 2.5), n(3, pa - 12, 1), n(4, -12, 2.5), n(7, deg(r, -1, -1), 1)]) },
  ];
}

export function chordClips(r: Raga): { name: string; blurb: string; make: () => Omit<Clip, "id"> }[] {
  const chords = ragaChords(r.swaras);
  const at = (rhythm: number[], len: number, dur: number) => chords.slice(0, 4).flatMap((ch, i) => rhythm.flatMap((t) => ch.map((s) => n(i * len + t, s, dur, 0.7))));
  return [
    { name: "Held chords", blurb: "Four of the raga's chords, two beats each.", make: () => clip("Held chords", 8, at([0], 2, 1.9)) },
    { name: "Off-beat stabs", blurb: "Short chords on the off-beats.", make: () => clip("Off-beat stabs", 8, at([0.5, 1.5], 2, 0.3)) },
  ];
}

/** 8-beat phrases from the composer's pieces in this raga (the busiest, most varied first). */
export function phrases(pieces: Note[][], limit = 10): { name: string; make: () => Omit<Clip, "id"> }[] {
  const out: { score: number; notes: Note[]; from: number; piece: number }[] = [];
  pieces.forEach((ns, pi) => {
    const end = Math.max(0, ...ns.map((x) => x.t + x.d));
    for (let b = 0; b + 8 <= end; b += 8) {
      const w = ns.filter((x) => x.t >= b && x.t < b + 8);
      if (w.length < 6) continue;
      out.push({ score: new Set(w.map((x) => semis(x))).size + w.length * 0.2, notes: w, from: b, piece: pi });
    }
  });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((p, i) => ({
    name: `Phrase ${i + 1}`,
    make: () => clip(`Phrase ${i + 1}`, 8, p.notes.map((x) => n(x.t - p.from, semis(x), Math.min(x.d, p.from + 8 - x.t), 0.85))),
  }));
}

// ------------------------------------------------------------------------------------- a first project

const repeat = (c: Omit<Clip, "id">, starts: number[]): Clip[] => starts.map((s) => ({ ...JSON.parse(JSON.stringify(c)), id: uid("c"), start: s, notes: c.notes.map((x) => ({ ...x, id: uid("n") })) }));

/** Sixteen bars that already sound like a piece: an intro that builds, a drop, a breakdown, an ending. */
export function starter(r: Raga, pieces: Note[][], sa = 220, bpm = 96): Project {
  const find = (k: string) => INSTRUMENTS.find((d) => d.sound === k || d.inst === k)!;
  const drums = newTrack(find("drums"), 3), bass = newTrack(find("bass"), 4), keys = newTrack(find("epiano"), 1), lead = newTrack(find("sitar"), 0), pad = newTrack(find("pad"), 2);
  const ph = phrases(pieces, 4), bl = bassLines(r), ch = chordClips(r);
  const g = GROOVES[0].make(), fill = GROOVES[7].make();
  drums.clips = [...repeat(g, [16, 24, 32, 40]), ...repeat(fill, [44]), ...repeat(GROOVES[1].make(), [48, 56])];
  drums.name = "Drums";
  bass.clips = repeat(bl[1].make(), [16, 24, 32, 48, 56]);
  keys.clips = repeat(ch[1].make(), [16, 24, 48, 56]);
  pad.clips = repeat(ch[0].make(), [0, 8, 32, 40]);
  pad.clips[0].fx = [{ id: uid("f"), type: "rise", params: defaults("rise") }];
  pad.clips[1].fx = [{ id: uid("f"), type: "riser", params: defaults("riser") }];
  pad.clips[3].fx = [{ id: uid("f"), type: "fadeout", params: {} }];
  pad.volume = 0.6;
  lead.clips = ph.length ? [...repeat(ph[0].make(), [8, 24]), ...repeat(ph[1 % ph.length].make(), [32, 40]), ...repeat(ph[2 % ph.length].make(), [48, 56])] : [];
  for (const c of lead.clips.slice(2, 4)) c.fx = [{ id: uid("f"), type: "echo", params: defaults("echo") }];
  lead.fx = [{ id: uid("f"), type: "room", params: defaults("room") }];
  return { version: 1, name: `${r.name} sketch`, bpm, raga: r.key, sa, tracks: [drums, bass, keys, lead, pad] };
}

export const blank = (r: Raga, sa = 220, bpm = 96): Project => ({ version: 1, name: "Untitled", bpm, raga: r.key, sa, tracks: [newTrack(INSTRUMENTS.find((d) => d.inst === "drums")!, 3), newTrack(INSTRUMENTS.find((d) => d.inst === "sitar")!, 0)] });
