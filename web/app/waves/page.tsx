"use client";

// Waves: make a sound from sine waves, see every step of it, and play it in a raga (lib/waves.ts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Footer } from "@/components/Footer";
import { Magnetic } from "@/components/Magnetic";
import { FloralBand } from "@/components/Ornament";
import { RiseChars } from "@/components/Text";
import { Beating, Envelope, FilterView, Formula, Harmonics, Lfo, Scope, WavePlot } from "@/components/WaveEditors";
import { getEngine } from "@/lib/audio";
import { RATIOS, ragaOfHour } from "@/lib/music";
import { tick, useData } from "@/lib/site";
import { DRUMS, type Held, Looper, type Patch, type Pattern, SHAPES, SOUNDS, STEPS, Synth, clone, decodeSaved, encodeSaved, hzOf, renderLoop, rows as ragaRows, starterPattern } from "@/lib/waves";

const FRACTIONS = ["1", "16/15", "9/8", "6/5", "5/4", "4/3", "45/32", "3/2", "8/5", "5/3", "9/5", "15/8"];
const SWARAS = "SrRgGmMPdDnN";
const KEYS = "asdfghjkl;'qwertyuiop";
const ECHO = [[1, "1/8"], [2, "1/4"], [3, "3/8"], [4, "1/2"], [6, "3/4"]] as const;
const DRUM_NAMES = { kick: "Kick", snare: "Snare", hat: "Hat" };

function Card({ n, title, what, tryThis, children }: { n: number; title: string; what: string; tryThis?: string; children: React.ReactNode }) {
  return (
    <div className="leaf-card border border-rule p-6">
      <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">{n} · {title}</div>
      <p className="mt-2 max-w-[760px] text-[15px] leading-[1.6] text-kajal/75">{what}</p>
      {tryThis && <p className="mt-1 text-[13px] text-sindoor">Try: {tryThis}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, show, onChange, log = false }: { label: string; value: number; min: number; max: number; step?: number; show: (v: number) => string; onChange: (v: number) => void; log?: boolean }) {
  // A log slider for frequencies: equal moves are equal musical intervals.
  const pos = log ? Math.log(value / min) / Math.log(max / min) : value;
  return (
    <label className="block text-[13px]">
      <span className="flex justify-between text-kajal/70"><span>{label}</span><span className="tabular-nums">{show(value)}</span></span>
      <input type="range" min={log ? 0 : min} max={log ? 1 : max} step={log ? 0.001 : step} value={pos}
        onChange={(e) => { const v = Number(e.target.value); onChange(log ? Math.round(min * (max / min) ** v) : v); }} className="mt-1 w-full accent-sindoor" />
    </label>
  );
}

const Chip = ({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={() => { tick("soft"); onClick(); }} className={`rounded-full border px-4 py-1.5 text-[14px] transition-colors ${on ? "border-kajal bg-kajal text-paper" : "border-rule hover:border-sindoor/60"}`}>{children}</button>
);

export default function Waves() {
  const data = useData();
  const ragas = data?.latest.ragas ?? [];
  const [patch, setPatch] = useState<Patch>(() => clone(SOUNDS[0].patch));
  const [soundKey, setSoundKey] = useState<string | null>(SOUNDS[0].key);
  const [rk, setRk] = useState<string | null>(null);
  const [sa, setSa] = useState(220);
  const [tempo, setTempo] = useState(96);
  const [swing, setSwing] = useState(0.55);
  const [pattern, setPattern] = useState<Pattern | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [synth, setSynth] = useState<Synth | null>(null);
  const [down, setDown] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const looper = useRef<Looper | null>(null);
  const held = useRef(new Map<number, Held>());
  const drag = useRef<null | { row: number; step: number; moved: boolean; was: boolean }>(null);

  const raga = ragas.find((r) => r.key === rk) ?? null;
  const rs = useMemo(() => (raga ? ragaRows(raga) : []), [raga]);
  const edit = (f: (p: Patch) => void) => { setSoundKey(null); setPatch((p) => { const q = clone(p); f(q); return q; }); };

  // Start in the raga of the hour, or from a shared link.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !ragas.length) return;
    loaded.current = true;
    const s = decodeSaved(window.location.hash.replace(/^#s=/, ""));
    if (s && ragas.some((r) => r.key === s.raga)) {
      setPatch(s.patch); setSoundKey(null); setRk(s.raga); setSa(s.sa); setTempo(s.tempo); setSwing(s.swing); setPattern(s.pattern);
    } else setRk(ragaOfHour(ragas, new Date().getHours()).key);
  }, [ragas]);
  // A new raga brings its own first loop (its notes are different rows).
  const patternFor = useRef<string | null>(null);
  useEffect(() => {
    if (!raga) return;
    if (patternFor.current !== null && patternFor.current !== raga.key) setPattern(starterPattern(rs));
    else if (!pattern || pattern.notes.length !== rs.length) setPattern(starterPattern(rs));
    patternFor.current = raga.key;
  }, [raga, rs]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useRef({ pattern, rows: rs, sa, tempo, swing });
  live.current = { pattern: pattern!, rows: rs, sa, tempo, swing };

  const ensure = useCallback(async () => {
    const eng = getEngine();
    await eng.resume();
    if (synth) return synth;
    const s = new Synth(eng.ctx, patch);
    looper.current = new Looper(s, () => live.current as never, (st, at) => { const ms = Math.max(0, (at - eng.ctx.currentTime) * 1000); setTimeout(() => setStep(st), ms); });
    setSynth(s);
    return s;
  }, [synth, patch]);
  useEffect(() => { synth?.set(patch); }, [synth, patch]);
  useEffect(() => () => { looper.current?.stop(); held.current.forEach((h) => h.release()); }, []);

  const togglePlay = async () => {
    tick();
    await ensure();
    const l = looper.current!;
    if (l.playing) { l.stop(); setPlaying(false); setStep(null); } else { l.start(); setPlaying(true); }
  };

  const noteOn = async (i: number) => {
    if (!rs[i] || held.current.has(i)) return;
    const s = await ensure();
    held.current.set(i, s.note(hzOf(rs[i], sa)));
    setDown((d) => new Set(d).add(i));
  };
  const noteOff = (i: number) => {
    held.current.get(i)?.release();
    held.current.delete(i);
    setDown((d) => { const n = new Set(d); n.delete(i); return n; });
  };
  // The computer keyboard plays the raga: a s d f … from the lowest note up.
  useEffect(() => {
    const ok = (e: KeyboardEvent) => !(e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLInputElement)?.type === "text");
    const dn = (e: KeyboardEvent) => { if (e.repeat || !ok(e)) return; const i = KEYS.indexOf(e.key.toLowerCase()); if (i >= 0 && i < rs.length) { e.preventDefault(); noteOn(i); } else if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") { e.preventDefault(); togglePlay(); } };
    const up = (e: KeyboardEvent) => { const i = KEYS.indexOf(e.key.toLowerCase()); if (i >= 0) noteOff(i); };
    window.addEventListener("keydown", dn); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }); // re-bound each render: it plays with the current sound and raga

  const setCell = (row: number, st: number, on: boolean, len = 1) => setPattern((p) => {
    if (!p) return p;
    const q: Pattern = JSON.parse(JSON.stringify(p));
    q.notes[row][st] = on;
    q.length[row][st] = len;
    return q;
  });
  const covered = (row: number, st: number) => { // inside a held note that started earlier
    if (!pattern) return false;
    for (let s0 = st - 1; s0 >= 0; s0--) if (pattern.notes[row][s0]) return s0 + pattern.length[row][s0] > st;
    return false;
  };

  const download = async () => {
    if (!pattern || !raga) return;
    tick();
    setBusy(true);
    try {
      const blob = await renderLoop(patch, { pattern, rows: rs, sa, tempo, swing }, 4);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ragaz-waves-${raga.key}-${soundKey ?? "custom"}.wav`;
      a.click();
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    if (!pattern || !raga) return;
    tick();
    const url = `${location.origin}${location.pathname}#s=${encodeSaved({ patch, pattern, raga: raga.key, sa, tempo, swing })}`;
    history.replaceState(null, "", url);
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };

  const hz = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} kHz` : `${Math.round(x)} Hz`);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const sec = (x: number) => (x < 1 ? `${Math.round(x * 1000)} ms` : `${x.toFixed(2)} s`);

  return (
    <main className="bg-transparent">
      <section className="relative overflow-hidden px-6 pb-10 pt-36 sm:px-10">
        <div className="pointer-events-none absolute -right-40 top-0 h-[640px] w-[640px] rounded-full bg-sona/15 blur-[140px]" />
        <div className="relative mx-auto max-w-[1400px]">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Waves</div>
          <h1 className="mt-4 font-display text-[clamp(64px,10vw,170px)] leading-[0.88]"><RiseChars text="Make a sound." /></h1>
          <p className="mt-8 max-w-[720px] text-[clamp(18px,2vw,22px)] leading-[1.5] text-kajal/80">
            Every sound is sine waves added together. Start from one, add more, shape how it starts and fades, colour it, move it, give it a room, and play it in a raga. Each picture here is also the control, and what you see is exactly what you hear.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Magnetic variant="solid" cursor={playing ? "Stop" : "Play"} onClick={togglePlay}>{playing ? "❚❚ Stop the loop" : "▶ Play the loop"}</Magnetic>
            <span className="text-[14px] text-kajal/55">or play the keys <span className="font-mono">a s d f g h j k</span> · space starts and stops</span>
          </div>
        </div>
      </section>
      <FloralBand />

      <section className="px-6 pb-24 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[1fr_400px]">
          <aside className="order-first space-y-4 lg:order-last lg:sticky lg:top-6 lg:self-start">
            <div className="leaf-card border border-rule p-5">
              <div className="flex items-center justify-between">
                <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">What you hear</div>
                <button onClick={togglePlay} className={`rounded-full px-4 py-1.5 text-[14px] ${playing ? "bg-sindoor text-paper" : "bg-kajal text-paper"}`}>{playing ? "❚❚ Stop" : "▶ Play"}</button>
              </div>
              {synth ? <Scope analyser={synth.analyser} className="mt-3" /> : (
                <div className="mt-3 grid h-[188px] place-items-center rounded-lg border border-dashed border-rule text-center text-[14px] text-kajal/50">Press play or a key:<br />the live wave and its spectrum show here</div>
              )}
              <div className="mt-4 text-[12px] uppercase tracking-[0.2em] text-sepia">Start from a sound</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {SOUNDS.map((s) => <Chip key={s.key} on={soundKey === s.key} onClick={() => { setPatch(clone(s.patch)); setSoundKey(s.key); }}>{s.name}</Chip>)}
              </div>
              <p className="mt-2 min-h-[40px] text-[13px] leading-[1.5] text-kajal/60">{SOUNDS.find((s) => s.key === soundKey)?.how ?? "Your own sound. Pick one above to start again."}</p>
              {raga && (
                <>
                  <div className="mt-3 text-[12px] uppercase tracking-[0.2em] text-sepia">Keys · {raga.name}</div>
                  <div className="mt-2 flex gap-1">
                    {rs.map((r, i) => (
                      <button key={i} onPointerDown={(e) => { e.preventDefault(); noteOn(i); }} onPointerUp={() => noteOff(i)} onPointerLeave={() => down.has(i) && noteOff(i)}
                        className={`flex h-20 flex-1 select-none flex-col items-center justify-end rounded-b-md border pb-1 text-[11px] transition-colors ${down.has(i) ? "border-sindoor bg-sindoor text-paper" : r.o === 0 ? "border-rule bg-leaf" : "border-rule bg-paper2/70"}`}>
                        <span>{r.label}</span><span className="font-mono opacity-50">{KEYS[i]}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Magnetic cursor="Save" onClick={download}>{busy ? "Rendering…" : "Download WAV"}</Magnetic>
                <Magnetic cursor="Link" onClick={share}>{copied ? "Link copied" : "Share link"}</Magnetic>
              </div>
            </div>
          </aside>

          <div className="space-y-6">
            <Card n={1} title="The wave" what="A note is a sine wave at its frequency (harmonic 1) plus sine waves at 2, 3, 4… times that frequency. Each bar is one harmonic: drag up and down across the bars to set how loud each is. Below each bar, its phase: where in its cycle it starts." tryThis="start from Sine, then raise harmonic 3 a little, then 5; or pick a shape below.">
              <div className="flex flex-wrap gap-2">
                {SHAPES.map((s) => <Chip key={s.key} onClick={() => edit((p) => { const m = s.make(); p.amp = m.amp; p.phase = m.phase; })}>{s.name}</Chip>)}
                <Chip onClick={() => edit((p) => { p.phase = p.phase.map(() => Math.floor(Math.random() * 24) * 15); })}>Shuffle phases</Chip>
                <Chip onClick={() => edit((p) => { p.phase = p.phase.map(() => 0); })}>Phases to 0°</Chip>
              </div>
              <p className="mt-2 text-[13px] text-kajal/55">{SHAPES.find((s) => { const m = s.make(); return m.amp.every((a, i) => Math.abs(a - patch.amp[i]) < 1e-6); })?.how ?? "Shuffle the phases and listen: the shape changes a lot, the sound hardly at all. The ear hears which harmonics and how loud, not how they line up."}</p>
              <div className="mt-4 grid gap-6 xl:grid-cols-2">
                <div>
                  <Harmonics patch={patch} focus={focus} onFocus={setFocus} onChange={(amp, phase) => edit((p) => { p.amp = amp; p.phase = phase; })} />
                  <div className="mt-1 text-[12px] text-kajal/50">harmonics 1–16 · their phases (drag the dials, double-click for 0°)</div>
                </div>
                <div>
                  <WavePlot patch={patch} focus={focus} />
                  <div className="mt-1 text-[12px] text-kajal/50">two cycles of the sum (ink) and each harmonic on its own (gold{focus !== null ? `; harmonic ${focus + 1} in red` : ""})</div>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-rule bg-paper/40 px-4 py-2"><Formula patch={patch} /></div>
            </Card>

            <Card n={2} title="Pitch and tuning" what="How fast the wave repeats is its pitch. Sa is the home note; a raga's other notes are fixed ratios of it, just-intoned (Pa is exactly 3/2 of Sa). Copies of the sound a few cents apart beat against each other, which thickens it: that is chorus." tryThis="set 3 voices and a 15-cent spread, then hold a key.">
              <div className="flex flex-wrap gap-2">
                {ragas.map((r) => <Chip key={r.key} on={r.key === rk} onClick={() => setRk(r.key)}>{r.name}</Chip>)}
              </div>
              <div className="mt-4 grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <Slider label="Sa" value={sa} min={110} max={330} step={1} show={(v) => `${v} Hz`} onChange={setSa} />
                  {raga && (
                    <table className="w-full text-[13px] tabular-nums">
                      <tbody>
                        {raga.swaras.map((s) => { const i = SWARAS.indexOf(s); const r = rs.findIndex((x) => x.s === s && x.o === 0); return (
                          <tr key={s} className="cursor-pointer border-b border-rule/60 hover:text-sindoor" onPointerDown={() => noteOn(r)} onPointerUp={() => noteOff(r)} onPointerLeave={() => down.has(r) && noteOff(r)}>
                            <td className="py-1">{rs[r]?.label}</td><td className="font-mono">× {FRACTIONS[i]}</td><td className="text-right">{(sa * RATIOS[i]).toFixed(1)} Hz</td>
                          </tr>
                        ); })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="space-y-3">
                  <Slider label="Voices (unison)" value={patch.voices} min={1} max={7} step={1} show={(v) => `${v}`} onChange={(v) => edit((p) => { p.voices = v; })} />
                  <Slider label="Spread" value={patch.spread} min={0} max={50} step={1} show={(v) => `${v} cents`} onChange={(v) => edit((p) => { p.spread = v; })} />
                  <Beating hz={sa} cents={patch.voices > 1 ? patch.spread / (patch.voices - 1) : 0} voices={patch.voices} />
                  <p className="text-[12px] text-kajal/50">Two neighbouring voices, drawn slowed down: their sum swells and fades as they drift in and out of step.</p>
                </div>
              </div>
            </Card>

            <Card n={3} title="Shape in time" what="The envelope: how fast the sound rises when a key goes down (attack), how far it falls back (decay, to the sustain level), and how long it rings after the key is let go (release). A pluck has no sustain; an organ has nothing but." tryThis="drag A right for a slow swell; drag D·S to the floor for a pluck.">
              <div className="flex flex-wrap gap-2">
                {([["Pluck", { a: 0.002, d: 0.35, s: 0, r: 0.25 }], ["Piano", { a: 0.004, d: 0.9, s: 0.2, r: 0.4 }], ["Bowed", { a: 0.25, d: 0.3, s: 0.8, r: 0.5 }], ["Swell", { a: 1.2, d: 0.5, s: 0.85, r: 1.5 }], ["Organ", { a: 0.02, d: 0.1, s: 1, r: 0.1 }]] as const).map(([n, e]) => (
                  <Chip key={n} onClick={() => edit((p) => { p.env = { ...e }; })}>{n}</Chip>
                ))}
              </div>
              <div className="mt-3"><Envelope env={patch.env} onChange={(e) => edit((p) => { p.env = e; })} /></div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 text-[13px] tabular-nums text-kajal/60 sm:grid-cols-4">
                <span>attack {sec(patch.env.a)}</span><span>decay {sec(patch.env.d)}</span><span>sustain {pct(patch.env.s)}</span><span>release {sec(patch.env.r)}</span>
              </div>
            </Card>

            <Card n={4} title="Colour" what="A low-pass filter lets the harmonics below its cutoff through and turns down the ones above: the bars here are Sa's harmonics, grey where the filter takes them away. Resonance lifts the harmonics right at the cutoff. Sweep opens the filter at each note's start and lets it close over the decay: the wah of a plucked string." tryThis="start from Saw, cutoff low, sweep up.">
              <FilterView patch={patch} sa={sa} />
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Slider log label="Cutoff" value={patch.filter.cutoff} min={80} max={16000} show={hz} onChange={(v) => edit((p) => { p.filter.cutoff = v; })} />
                <Slider label="Resonance" value={patch.filter.q} min={0} max={18} step={0.1} show={(v) => `${v.toFixed(1)} dB`} onChange={(v) => edit((p) => { p.filter.q = v; })} />
                <Slider label="Sweep" value={patch.filter.sweep} min={0} max={1} step={0.01} show={pct} onChange={(v) => edit((p) => { p.filter.sweep = v; })} />
              </div>
            </Card>

            <Card n={5} title="Movement" what="Slow waves (under 10 a second, too slow to hear as pitch) moving something else. On the pitch, that is vibrato, the waver of a singer's held note. On the loudness, tremolo, the throb of an old organ." tryThis="vibrato 5.5 Hz at 20 cents on Reed.">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                  <Slider label="Vibrato rate" value={patch.vib.rate} min={0.5} max={9} step={0.1} show={(v) => `${v.toFixed(1)} Hz`} onChange={(v) => edit((p) => { p.vib.rate = v; })} />
                  <Slider label="Vibrato depth" value={patch.vib.depth} min={0} max={60} step={1} show={(v) => `±${v} cents`} onChange={(v) => edit((p) => { p.vib.depth = v; })} />
                  <Lfo rate={patch.vib.rate} depth={patch.vib.depth} max={60} label="pitch" />
                </div>
                <div className="space-y-3">
                  <Slider label="Tremolo rate" value={patch.trem.rate} min={0.5} max={12} step={0.1} show={(v) => `${v.toFixed(1)} Hz`} onChange={(v) => edit((p) => { p.trem.rate = v; })} />
                  <Slider label="Tremolo depth" value={patch.trem.depth} min={0} max={1} step={0.01} show={pct} onChange={(v) => edit((p) => { p.trem.depth = v; })} />
                  <Lfo rate={patch.trem.rate} depth={patch.trem.depth} max={1} label="loudness" />
                </div>
              </div>
            </Card>

            <Card n={6} title="Space" what="An echo is the sound delayed and fed back into the delay, quieter each time round; set to the beat, it plays rhythms of its own. A reverb is a room: the sound smeared through thousands of tiny echoes that die away.">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-kajal/60">echo every</span>
                {ECHO.map(([n, l]) => <Chip key={n} on={patch.echo.steps === n} onClick={() => edit((p) => { p.echo.steps = n; })}>{l}</Chip>)}
              </div>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Slider label="Echo level" value={patch.echo.mix} min={0} max={0.8} step={0.01} show={pct} onChange={(v) => edit((p) => { p.echo.mix = v; })} />
                <Slider label="Echo repeats" value={patch.echo.feedback} min={0} max={0.85} step={0.01} show={(v) => (v < 0.05 ? "once" : `${pct(v)} back`)} onChange={(v) => edit((p) => { p.echo.feedback = v; })} />
                <Slider label="Room" value={patch.reverb} min={0} max={1} step={0.01} show={pct} onChange={(v) => edit((p) => { p.reverb = v; })} />
              </div>
            </Card>

            {pattern && raga && (
              <Card n={7} title="The loop" what={`Sixteen steps, eighth notes, going round. Each row is a note of ${raga.name}, so whatever you draw stays in the raga. Click a cell for a note; drag along the row to hold it longer. The drums underneath are made the same way, from waves and noise.`} tryThis="clear it and draw your own line; then change the sound while it plays.">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip onClick={() => setPattern(starterPattern(rs))}>Starter</Chip>
                  <Chip onClick={() => setPattern((p) => p && { ...p, notes: p.notes.map((r) => r.map(() => false)) })}>Clear notes</Chip>
                  <Chip onClick={() => setPattern((p) => p && { ...p, drums: { kick: p.drums.kick.map(() => false), snare: p.drums.snare.map(() => false), hat: p.drums.hat.map(() => false) } })}>No drums</Chip>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <div className="min-w-[560px] select-none" onPointerUp={() => { const d = drag.current; if (d && !d.moved && d.was) setCell(d.row, d.step, false); drag.current = null; }} onPointerLeave={() => (drag.current = null)}>
                    {[...rs.keys()].reverse().map((row) => (
                      <div key={row} className="flex items-center gap-[3px] py-[1.5px]">
                        <button className="w-12 shrink-0 text-right text-[12px] text-kajal/60 hover:text-sindoor" onPointerDown={() => noteOn(row)} onPointerUp={() => noteOff(row)} onPointerLeave={() => down.has(row) && noteOff(row)}>{rs[row].label}</button>
                        {Array.from({ length: STEPS }, (_, st) => {
                          const on = pattern.notes[row][st], under = !on && covered(row, st);
                          return (
                            <div key={st}
                              onPointerDown={(e) => { (e.target as Element).releasePointerCapture?.(e.pointerId); drag.current = { row, step: st, moved: false, was: on }; if (!on) setCell(row, st, true, 1); }}
                              onPointerEnter={() => { const d = drag.current; if (d && d.row === row && st > d.step) { d.moved = true; setCell(row, d.step, true, st - d.step + 1); } }}
                              className={`h-6 flex-1 cursor-pointer rounded-[4px] transition-colors ${on ? "bg-kajal" : under ? "bg-kajal/55" : st % 4 === 0 ? "bg-paper2" : "bg-paper2/50"} ${step === st ? "ring-2 ring-sindoor/70" : ""} ${rs[row].semis === 0 ? "outline outline-1 outline-sona/40" : ""}`} />
                          );
                        })}
                      </div>
                    ))}
                    <div className="mt-2 border-t border-rule pt-2">
                      {DRUMS.map((d) => (
                        <div key={d} className="flex items-center gap-[3px] py-[1.5px]">
                          <span className="w-12 shrink-0 text-right text-[12px] text-kajal/60">{DRUM_NAMES[d]}</span>
                          {pattern.drums[d].map((on, st) => (
                            <button key={st} onClick={() => setPattern((p) => p && { ...p, drums: { ...p.drums, [d]: p.drums[d].map((x, i) => (i === st ? !x : x)) } })}
                              className={`h-5 flex-1 rounded-full transition-colors ${on ? "bg-sindoor" : st % 4 === 0 ? "bg-paper2" : "bg-paper2/50"} ${step === st ? "ring-2 ring-sindoor/50" : ""}`} />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Slider label="Tempo" value={tempo} min={60} max={160} step={1} show={(v) => `${v} bpm`} onChange={setTempo} />
                  <Slider label="Swing" value={swing} min={0.5} max={0.7} step={0.01} show={(v) => (v <= 0.505 ? "straight" : pct((v - 0.5) * 5))} onChange={setSwing} />
                </div>
              </Card>
            )}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
