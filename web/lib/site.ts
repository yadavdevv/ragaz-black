"use client";

// Site-wide state: the exported data (loaded once) and the one player everything shares.

import { useEffect } from "react";
import { create } from "zustand";
import { type Timbre, getEngine, peekEngine } from "./audio";
import type { Masters, Note, Piece, Raga, RagaData } from "./music";
import type { Profiles } from "./verify";

export type Exhibit = { key: string; title: string; notes: Note[]; raga: string; reward_then: number | null; reward_now: number; notation: string; source: string };
export type Journey = Record<string, Record<string, [number, number][]> & { sa?: Record<string, [number, number][]> }>;
export type Voice = { raga: string; recording: string; title: string; start: number; hop: number; cents: (number | null)[]; source: string };
export type Recording = { raga: string; notation: string; files: Record<string, string>; tempo: number; bars: number; run: string; step: number | null; reward: number | null; notes: Note[] };
export type LatestPiece = Piece & { bars: number };
export type Latest = { label: string; style: string; run: string; step: number; bars: number; tempo: number; ragas: Raga[]; pieces: LatestPiece[]; recordings: Recording[]; voices: Record<string, string>; concerts: { recordings: number; held_out: number; ragas: number }; eval: { reward: number; no_wrong_notes: number; reader_accuracy: number; novel_bars: number; copied_example: number; realism: number }; performance: Record<"real" | "plain" | "performed", Record<string, number>> | null; baseline: { pieces: number; reward: number; no_wrong_notes: number; allowed_share: number; reader_accuracy: number; sixteen_bars: number; copied_example: number } | null };
/** `ragas` are the three with real-singer data; `allRagas` adds Deshkar (newest model only). */
// One piece per training stage, sung the same way, scored by each stage's own reward and by one
// shared yardstick (the newest reward at the piece's length). scripts/render_site.py, export_web.py.
export type Stage = { raga: string; stage: string; label: string; what: string; notation: string; bars: number; asked?: number; own_score: number; pieces: number; v6_score: number; outside: number; file: string | null; parts: Record<string, number>; notes: Note[] };
export type Data = { ragas: Raga[]; allRagas: Raga[]; pieces: Piece[]; masters: Masters; profiles: Profiles; exhibits: Exhibit[]; journey: Journey; voices: Voice[]; latest: Latest; evolution: Stage[] };

/** Anything the player can play: a piece, a phrase, or something you wrote. */
export type Track = { id: string; title: string; sub: string; raga: string; notes: Note[]; notation?: string; reward?: number };

type State = {
  data: Data | null;
  track: Track | null;
  playing: boolean;
  open: boolean; // full-screen player
  tempo: number;
  drone: boolean;
  queue: Track[];
  timbre: Timbre;
  curveTag: string | null; // a real singer's curve being sung
  set: (p: Partial<State>) => void;
};

export const useSite = create<State>((set) => ({ data: null, track: null, playing: false, open: false, tempo: 76, drone: false, queue: [], timbre: "voice", curveTag: null, set: (p) => set(p) }));

let loading: Promise<void> | null = null;
export function useData() {
  const data = useSite((s) => s.data);
  useEffect(() => {
    if (data || loading) return;
    loading = Promise.all(["ragas", "pieces", "masters", "profiles", "exhibits", "journey", "voices", "latest", "evolution"].map((n) => fetch(`/data/${n}.json`).then((r) => r.json()))).then(
      (all) => {
        const [ragas, pieces, masters, profiles, exhibits, journey, voices, latest, evolution] = all as [RagaData, Piece[], Masters, Profiles, Exhibit[], Journey, Voice[], Latest, Stage[]];
        useSite.getState().set({ data: { ragas: ragas.ragas, allRagas: latest.ragas, pieces, masters, profiles, exhibits, journey, voices, latest, evolution } });
      },
    );
  }, [data]);
  return data;
}

export const ragaOf = (key: string) => useSite.getState().data?.allRagas.find((r) => r.key === key) ?? null;

export function pieceTrack(p: Piece, label?: string): Track {
  const r = ragaOf(p.raga);
  const n = Number(p.id.split("-").pop()) + 1;
  const sub = p.model === useSite.getState().data?.latest.label ? `newest model · 16 bars · ${r?.time.split(" (")[0] ?? ""}` : `${r?.time.split(" (")[0] ?? ""} · composed from the word “${r?.name}”`;
  return { id: p.id, title: `${r?.name ?? p.raga} no. ${n}`, sub: label ?? sub, raga: p.raga, notes: p.notes, notation: p.notation, reward: p.reward };
}

/** Play a track through the shared engine (with a soft tanpura under it). */
export async function play(track: Track, opts: { open?: boolean } = {}) {
  const eng = getEngine();
  await eng.resume();
  const raga = ragaOf(track.raga);
  if (raga) eng.retune(raga);
  if (!eng.droneOn) {
    if (raga) eng.tune(raga);
    eng.startDrone(1.2);
  }
  const s = useSite.getState();
  eng.onEnd = (pb) => {
    if (pb.tag !== track.id) return;
    useSite.getState().set({ playing: false });
    if (!useSite.getState().drone) eng.stopDrone(2);
  };
  eng.timbre = s.timbre;
  eng.play(track.notes, s.tempo, track.id);
  s.set({ track, playing: true, curveTag: null, open: opts.open ?? s.open });
}

export function stop() {
  const eng = peekEngine();
  eng?.stopPiece();
  if (eng && !useSite.getState().drone) eng.stopDrone(1.5);
  useSite.getState().set({ playing: false, curveTag: null });
}

/** Sing a real singer's pitch curve (resynthesised) over the tanpura. */
export async function singVoice(v: Voice) {
  const eng = getEngine();
  await eng.resume();
  const raga = ragaOf(v.raga);
  if (raga) eng.retune(raga);
  if (!eng.droneOn) {
    if (raga) eng.tune(raga);
    eng.startDrone(1);
  }
  const tag = `voice-${v.raga}`;
  eng.onEnd = (pb) => {
    if (pb.tag !== tag) return;
    useSite.getState().set({ curveTag: null, playing: false });
    if (!useSite.getState().drone) eng.stopDrone(2);
  };
  eng.singCurve(v.cents, v.hop, tag);
  useSite.getState().set({ curveTag: tag, playing: false });
}

export function setTimbre(t: Timbre) {
  useSite.getState().set({ timbre: t });
  const eng = peekEngine();
  if (eng) eng.timbre = t;
}

export function toggle(track: Track, opts: { open?: boolean } = {}) {
  const s = useSite.getState();
  if (s.playing && s.track?.id === track.id) stop();
  else play(track, opts);
}

export async function setDrone(on: boolean) {
  const eng = getEngine();
  await eng.resume();
  const raga = ragaOf(useSite.getState().track?.raga ?? "bhupali");
  if (on) {
    if (raga) eng.tune(raga);
    eng.startDrone(2);
  } else if (!useSite.getState().playing) eng.stopDrone(1.5);
  useSite.getState().set({ drone: on });
}

/** A soft click for buttons and taps (only once audio is running). */
export function tick(kind: "tap" | "soft" = "tap") {
  peekEngine()?.tick(kind);
}
