// Seven finished pieces to listen to, open and pull apart: three famous public-domain melodies
// re-produced in modern styles, and four originals in ragas built from the composer's phrases.
// Each is an ordinary project, so everything in it can be changed.

import { type Note, type Raga, SWARAS } from "../music";
import { defaults } from "./fx";
import { GROOVES, INSTRUMENTS, bassLines, chordClips, newTrack, phrases } from "./library";
import { type Clip, type Fx, type NoteEv, type Project, type Track, uid } from "./model";

export type Demo = { key: string; title: string; style: string; credit: string; raga: string; blurb: string; make: (ragas: Raga[], pieces: (raga: string) => Note[][]) => Project };

// ------------------------------------------------------------------------------------- writing music down

/** Sargam in plain text: "G G m P", a dot below for the lower octave (".P"), an apostrophe for the
 *  upper ("S'"), ":2" for two beats (default one), "-" for a rest. */
export function mel(src: string, v = 0.85): NoteEv[] {
  const out: NoteEv[] = [];
  let t = 0;
  for (const tok of src.trim().split(/\s+/)) {
    const [head, dur] = tok.split(":");
    const d = dur ? Number(dur) : 1;
    if (head !== "-") {
      const down = (head.match(/^\.+/) ?? [""])[0].length, up = (head.match(/'+$/) ?? [""])[0].length;
      const s = SWARAS.indexOf(head.replace(/^\.+/, "").replace(/'+$/, "")) + 12 * (up - down);
      out.push({ id: uid("n"), t, d: d * 0.95, s, v });
    }
    t += d;
  }
  return out;
}

const n = (t: number, s: number, d: number, v = 0.8): NoteEv => ({ id: uid("n"), t, d, s, v });
const clip = (name: string, len: number, notes: NoteEv[], fx: Fx[] = []): Omit<Clip, "id"> => ({ name, start: 0, len, notes, fx });
const fx = (type: string, params: Record<string, number> = {}): Fx => ({ id: uid("f"), type, params: { ...defaults(type), ...params } });
const shift = (ns: NoteEv[], by: number) => ns.map((x) => ({ ...x, id: uid("n"), s: x.s + by }));

function track(key: string, name: string, color: number, volume = 0.8, pan = 0): Track {
  const def = INSTRUMENTS.find((d) => d.sound === key || d.inst === key)!;
  return { ...newTrack(def, color), name, volume, pan };
}

/** Put copies of a clip at the given bars (bar 0 = the start). */
function put(t: Track, c: Omit<Clip, "id">, bars: number[], extra: (bar: number, i: number) => Fx[] = () => []) {
  for (const [i, b] of bars.entries()) t.clips.push({ ...JSON.parse(JSON.stringify(c)), id: uid("c"), start: b * 4, notes: c.notes.map((x) => ({ ...x, id: uid("n") })), fx: [...c.fx.map((f) => ({ ...f, id: uid("f") })), ...extra(b, i)] });
}
const range = (a: number, b: number, step = 1) => Array.from({ length: Math.ceil((b - a) / step) }, (_, i) => a + i * step);

/** Chords as a clip: one chord per `each` beats, held (`hold` beats) or stabbed on the off-beats. */
function chords(name: string, seq: number[][], each: number, style: "held" | "stabs" | "arp" = "held", v = 0.7) {
  const ns: NoteEv[] = [];
  seq.forEach((ch, i) => {
    const t0 = i * each;
    if (style === "held") ch.forEach((s) => ns.push(n(t0, s, each * 0.96, v)));
    else if (style === "stabs") for (let k = 0.5; k < each; k += 1) ch.forEach((s) => ns.push(n(t0 + k, s, 0.3, v)));
    else { const up = [...ch, ch[0] + 12, ch[1] + 12]; for (let k = 0; k < each * 2; k++) ns.push(n(t0 + k / 2, up[[0, 1, 2, 3, 4, 3, 2, 1][k % 8]], 0.45, v * (k % 2 ? 0.7 : 1))); }
  });
  return clip(name, seq.length * each, ns);
}

/** A bass line on the chord roots: `pattern` gives (beat, octave offset) pairs within each chord. */
function bass(name: string, roots: number[], each: number, pattern: [number, number][] = [[0, 0], [each / 2, 0]]) {
  const ns: NoteEv[] = [];
  roots.forEach((r, i) => pattern.forEach(([t, o]) => ns.push(n(i * each + t, r - 12 + o, Math.min(each / 2, 1) * 0.9, 0.9))));
  return clip(name, roots.length * each, ns);
}

const groove = (name: string) => GROOVES.find((g) => g.name === name)!.make();

// ------------------------------------------------------------------------------------- the three melodies

const C = [0, 4, 7], G7 = [-5, -1, 2], F = [-7, -3, 0];

const ode: Demo = {
  key: "ode", title: "Ode to Joy", style: "Lo-fi", credit: "Beethoven, 1824 (public domain)", raga: "bihag",
  blurb: "The tune everyone knows, slowed into lo-fi: a lazy beat, warm electric piano, the melody on sitar, then an octave up on bansuri.",
  make: () => {
    const L1 = "G G m P P m G R S S R G G:1.5 R:0.5 R:2", L2 = "G G m P P m G R S S R G R:1.5 S:0.5 S:2", L3 = "R R G S R G:0.5 m:0.5 G S R G:0.5 m:0.5 G R S R .P:2";
    const theme = mel(`${L1} ${L2} ${L3} ${L2}`);
    const harm = [C, G7, C, G7, C, G7, C, C, G7, C, G7, G7, C, G7, C, C];
    const drums = track("drums", "Drums", 3, 0.75), b = track("bass", "Bass", 4, 0.7), keys = track("epiano", "Keys", 1, 0.75, -0.15), lead = track("sitar", "Sitar", 0, 0.85, 0.1), flute = track("bansuri", "Bansuri", 5, 0.7, 0.15), pad = track("pad", "Pad", 2, 0.45);
    const keysClip = chords("Keys", harm, 4, "held"), padClip = chords("Pad", harm, 4, "held", 0.5);
    put(pad, { ...padClip, len: 16, notes: padClip.notes.filter((x) => x.t < 16) }, [0], () => [fx("rise")]);
    put(keys, { ...keysClip, len: 16, notes: keysClip.notes.filter((x) => x.t < 16) }, [0]);
    put(keys, keysClip, [4, 20]);
    put(b, bass("Bass", harm.map((h) => h[0]), 4, [[0, 0], [2.5, 0], [3, 12]]), [4, 20]);
    put(drums, groove("Boom bap"), range(4, 36, 2), (bar) => (bar === 34 ? [fx("fadeout")] : []));
    put(drums, groove("Fill"), [19]);
    put(lead, clip("Theme", 64, theme), [4], () => [fx("echo", { mix: 0.18 })]);
    put(flute, clip("Theme, up", 64, shift(theme, 12)), [20]);
    put(lead, clip("Answer", 64, mel("- - S' - - - G - - - P - - - G' -:2 - - S' - - - G - - - P - - - S' -:2 - - R' - - - S' - - - P - - - .N' -:2 - - S' - - - G - - - P - - - S' -:2", 0.5)), [20]);
    put(pad, { ...padClip, len: 16, notes: padClip.notes.filter((x) => x.t < 16) }, [36], () => [fx("fadeout")]);
    put(keys, { ...keysClip, len: 16, notes: keysClip.notes.filter((x) => x.t < 16) }, [36], () => [fx("fadeout")]);
    lead.fx = [fx("room")]; keys.fx = [fx("lofi", { bits: 8, tone: 3200 })]; pad.fx = [fx("hall", { mix: 0.3 })];
    return { version: 1, name: "Ode to Joy, lo-fi", bpm: 84, raga: "bihag", sa: 262, tracks: [drums, b, keys, lead, flute, pad] };
  },
};

const canon: Demo = {
  key: "canon", title: "Canon", style: "House", credit: "Pachelbel, c. 1700 (public domain)", raga: "bihag",
  blurb: "The most famous chord sequence in music, as a house track: a slow build with a riser, the drop, a breakdown on bansuri, and the drop again.",
  make: () => {
    // D A Bm F#m G D G A, around D (= Sa).
    const fix = [[0, 4, 7], [1, 4, 9], [2, 6, 11], [1, 6, 9], [-1, 2, 7], [0, 4, 7], [-1, 2, 7], [1, 4, 9]];
    const roots = [0, -5, -3, -8, -7, -12, -7, -5];
    const theme = mel("G:2 R:2 S:2 .N:2 .D:2 .P:2 .D:2 .N:2");
    const theme2 = mel("S':2 N:2 D:2 P:2 m:2 G:2 m:2 G:1 R:1");
    const drums = track("drums", "Drums", 3, 0.75), b = track("bass", "Bass", 4, 0.75), saw = track("supersaw", "Chords", 0, 0.6), lead = track("pluck", "Lead", 1, 0.75, 0.1), arp = track("glass", "Arp", 2, 0.5, -0.2), pad = track("pad", "Pad", 5, 0.6), flute = track("bansuri", "Bansuri", 4, 0.7);
    const padC = chords("Pad", fix, 2, "held", 0.55), stabs = chords("Stabs", fix, 2, "stabs", 0.65), arps = chords("Arp", fix, 2, "arp", 0.5);
    const bl = bass("Bass", roots, 2, [[0, 0], [0.5, 12], [1, 0], [1.5, 12]]);
    put(pad, padC, [0, 4], (bar) => (bar === 0 ? [fx("rise", { q: 3 })] : [fx("riser", { beats: 8 }), fx("pump")]));
    put(lead, clip("Theme", 16, theme), [4]);
    put(arp, arps, [4], () => [fx("rise", { q: 4 })]);
    put(drums, { ...groove("Four on the floor"), notes: groove("Four on the floor").notes.filter((x) => x.s === 0) }, [4, 6]);
    // drop 1
    put(drums, groove("Four on the floor"), range(8, 24, 2));
    put(b, bl, range(8, 24, 4)); put(saw, stabs, range(8, 24, 4), () => [fx("pump")]);
    put(lead, clip("Theme", 16, theme), [8, 16]); put(lead, clip("Theme 2", 16, theme2), [12, 20]);
    put(arp, arps, [16, 20]);
    // breakdown
    put(pad, padC, [24, 28], (bar) => (bar === 28 ? [fx("riser", { beats: 8 })] : []));
    put(flute, clip("Theme", 16, shift(theme, 12)), [24]); put(flute, clip("Theme 2", 16, theme2), [28]);
    put(drums, groove("Fill"), [31]);
    // drop 2
    put(drums, groove("Four on the floor"), range(32, 48, 2));
    put(b, bl, range(32, 48, 4)); put(saw, stabs, range(32, 48, 4), () => [fx("pump")]);
    put(lead, clip("Theme 2", 16, theme2), [32, 40]); put(lead, clip("Theme", 16, shift(theme, 12)), [36, 44]);
    put(arp, arps, range(32, 48, 4));
    put(pad, padC, [48], () => [fx("fadeout")]);
    lead.fx = [fx("pingpong", { mix: 0.25 })]; pad.fx = [fx("hall", { mix: 0.35 })];
    return { version: 1, name: "Canon, house", bpm: 120, raga: "bihag", sa: 294, tracks: [drums, b, saw, lead, arp, pad, flute] };
  },
};

const saints: Demo = {
  key: "saints", title: "When the Saints", style: "Amapiano", credit: "Traditional (public domain)", raga: "bihag",
  blurb: "A New Orleans hymn on a Johannesburg groove: shakers, log drums, rimshots, and the tune on shehnai.",
  make: () => {
    const tune = mel("- S G m P:4 - S G m P:4 - S G m P:2 G:2 S:2 G:2 R:4 - G G R S:3 G P:2 P m m:4 - G m P G:2 S:2 R:4 S:4");
    const harm = [C, C, C, C, C, C, G7, G7, C, C, F, F, C, G7, C, C];
    const drums = track("drums", "Drums", 3, 0.65), b = track("bass", "Bass", 4, 0.6), keys = track("epiano", "Keys", 1, 0.55, -0.2), lead = track("shehnai", "Shehnai", 0, 0.6, 0.1), sitar = track("sitar", "Sitar", 5, 0.65), pad = track("organ", "Organ", 2, 0.3);
    const stabs = chords("Keys", harm, 4, "stabs", 0.6);
    put(drums, groove("Amapiano"), range(0, 44, 2), (bar) => (bar === 42 ? [fx("fadeout")] : []));
    put(keys, { ...stabs, len: 16, notes: stabs.notes.filter((x) => x.t < 16) }, [0]);
    put(keys, stabs, [4, 20, 28]);
    put(b, bass("Bass", harm.map((h) => h[0]), 4, [[0, 0], [1.5, 0], [2.5, 7], [3.5, 12]]), [4, 20, 28]);
    put(lead, clip("Tune", 64, tune), [4]);
    put(sitar, clip("Tune", 64, tune), [20]);
    put(lead, clip("Tune, up", 64, shift(tune, 12)), [28], () => [fx("stutter", { rate: 2 })]);
    put(pad, chords("Organ", harm, 4, "held", 0.5), [12, 28]);
    put(keys, { ...stabs, len: 16, notes: stabs.notes.filter((x) => x.t < 16) }, [44], () => [fx("tapestop", { beats: 4 })]);
    lead.fx = [fx("room")]; keys.fx = [fx("chorus", { mix: 0.3 })];
    return { version: 1, name: "When the Saints, amapiano", bpm: 112, raga: "bihag", sa: 262, tracks: [drums, b, keys, lead, sitar, pad] };
  },
};

// ------------------------------------------------------------------------------------- four originals in ragas

type Style = { bpm: number; groove: string; grooveB?: string; lead: string; counter: string; bassKind: number; chordStyle: "held" | "stabs" | "arp"; chordInst: string; leadFx: Fx[]; padFx: Fx[]; quietA?: boolean };

function original(raga: Raga, pieces: Note[][], name: string, st: Style): Project {
  const ph = phrases(pieces, 6).map((p) => p.make());
  while (ph.length < 4) ph.push(clip("Aroha", 8, raga.swaras.map((s, i) => n(i, SWARAS.indexOf(s), 0.9))));
  const ch = chordClips(raga), bl = bassLines(raga);
  const drums = track("drums", "Drums", 3, 0.75), b = track("bass", "Bass", 4, 0.7), keys = track(st.chordInst, "Chords", 1, 0.6, -0.15), lead = track(st.lead, "Lead", 0, 0.85, 0.1), counter = track(st.counter, "Answer", 5, 0.6, -0.1), pad = track("pad", "Pad", 2, 0.45);
  const chordClip = st.chordStyle === "arp" ? { ...ch[0].make(), notes: (() => { const held = ch[0].make().notes; const byT = new Map<number, number[]>(); held.forEach((x) => byT.set(x.t, [...(byT.get(x.t) ?? []), x.s])); const out: NoteEv[] = []; [...byT.entries()].forEach(([t, ss]) => { const up = [...ss.sort((a, c) => a - c), ss[0] + 12]; for (let k = 0; k < 4; k++) out.push(n(t + k / 2, up[k % up.length], 0.45, 0.55)); }); return out; })() } : st.chordStyle === "stabs" ? ch[1].make() : ch[0].make();
  // intro 4 · A 8 · B 8 · break 4 · A' 8 · outro 4 = 36 bars
  put(pad, ch[0].make(), [0, 2], (bar) => (bar === 0 ? [fx("rise")] : [fx("riser", { beats: 8 })]));
  put(keys, chordClip, [0, 2], (bar) => (bar === 0 ? [fx("fadein")] : []));
  if (!st.quietA) put(drums, groove(st.groove), range(4, 12, 2));
  put(drums, groove(st.grooveB ?? st.groove), range(12, 20, 2));
  put(drums, groove("Fill"), [19]);
  put(b, bl[st.bassKind].make(), range(4, 20, 2));
  put(keys, chordClip, range(4, 20, 2));
  put(lead, ph[0], [4, 8]); put(lead, ph[1], [6, 10]);
  put(lead, ph[2], [12, 16]); put(lead, ph[3], [14, 18]);
  put(counter, { ...ph[0], notes: shift(ph[0].notes, 12).map((x) => ({ ...x, v: 0.55 })) }, [13, 17], () => [fx("echo", { mix: 0.3 })]);
  // break: just the pad and the lead, thinned
  put(pad, ch[0].make(), [20, 22], (bar) => (bar === 22 ? [fx("riser", { beats: 8 })] : []));
  put(counter, ph[1], [20]); put(counter, ph[2], [22], () => [fx("tapestop", { beats: 2 })]);
  // A'
  put(drums, groove(st.grooveB ?? st.groove), range(24, 32, 2));
  put(b, bl[st.bassKind].make(), range(24, 32, 2)); put(keys, chordClip, range(24, 32, 2));
  put(lead, ph[0], [24]); put(lead, ph[2], [26]); put(lead, ph[3], [28]); put(lead, ph[1], [30]);
  put(counter, { ...ph[3], notes: shift(ph[3].notes, 12).map((x) => ({ ...x, v: 0.5 })) }, [25, 29]);
  // outro
  put(pad, ch[0].make(), [32, 34], (bar) => (bar === 34 ? [fx("fadeout")] : []));
  put(lead, ph[0], [32], () => [fx("dub", { mix: 0.4 })]);
  lead.fx = st.leadFx; pad.fx = st.padFx;
  return { version: 1, name, bpm: st.bpm, raga: raga.key, sa: 220, tracks: [drums, b, keys, lead, counter, pad] };
}

const raga = (key: string, title: string, style: string, blurb: string, name: string, st: Style): Demo => ({
  key, title, style, raga: key.split("-")[0], credit: "Original, from the composer's phrases", blurb,
  make: (ragas, pieces) => original(ragas.find((r) => r.key === key.split("-")[0]) ?? ragas[0], pieces(key.split("-")[0]), name, st),
});

export const DEMOS: Demo[] = [
  ode, canon, saints,
  raga("yaman-night", "Yaman, after dark", "Trap", "The evening raga over a half-time beat and sliding 808s; the sitar carries the composer's phrases and a glassy echo answers.", "Yaman, after dark",
    { bpm: 78, groove: "Trap", lead: "sitar", counter: "glass", bassKind: 3, chordStyle: "held", chordInst: "pad", leadFx: [fx("room")], padFx: [fx("hall", { mix: 0.4 })] }),
  raga("miyan_malhar-rain", "Monsoon", "Dub", "Miyan Malhar, the raga of the rains: a bansuri lead, a sarangi answering, rim shots thrown into a dub echo.", "Monsoon",
    { bpm: 86, groove: "Boom bap", grooveB: "Dembow", lead: "bansuri", counter: "sarangi", bassKind: 2, chordStyle: "stabs", chordInst: "epiano", leadFx: [fx("dub", { mix: 0.25 })], padFx: [fx("hall", { mix: 0.45 })] }),
  raga("bhairav-dawn", "Bhairav, first light", "Ambient", "The dawn raga with no drums at first: santoor arpeggios, a pad, the bansuri, and a soft sixteen-beat pulse that arrives later.", "Bhairav, first light",
    { bpm: 76, groove: "Teentaal feel", lead: "bansuri", counter: "santoor", bassKind: 0, chordStyle: "arp", chordInst: "santoor", leadFx: [fx("hall", { mix: 0.3 })], padFx: [fx("hall", { mix: 0.5 }), fx("chorus", { mix: 0.3 })], quietA: true }),
  raga("basant-drop", "Basant, the drop", "EDM", "Spring at a festival: a build with a riser, a drop on supersaw stabs and a pumping pad, a tape stop into the breakdown.", "Basant, the drop",
    { bpm: 124, groove: "Four on the floor", lead: "pluck", counter: "reed", bassKind: 1, chordStyle: "stabs", chordInst: "supersaw", leadFx: [fx("pingpong", { mix: 0.25 })], padFx: [fx("pump"), fx("hall", { mix: 0.3 })] }),
];
