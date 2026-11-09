"use client";

// Remix: one of the model's bandishes, produced as a track (lib/studio.ts). Pick a bandish and a
// sound, switch layers on and off to hear what each adds, play it, or download the mix.

import { useEffect, useMemo, useRef, useState } from "react";
import { type Bandish, lyricsOf } from "@/components/BandishCard";
import { Bhatkhande } from "@/components/Bhatkhande";
import { Footer } from "@/components/Footer";
import { Magnetic } from "@/components/Magnetic";
import { FloralBand } from "@/components/Ornament";
import { RiseChars } from "@/components/Text";
import { getEngine } from "@/lib/audio";
import { ragaOfHour } from "@/lib/music";
import { tick, useData } from "@/lib/site";
import { type Controls, LAYERS, type Layers, PRESETS, type Piece, arrange, defaultControls, lengthInBeats, pickPhrase, produce, renderWav, songPiece, themeFor, withControls } from "@/lib/studio";

const SA = 220;
const LAYER_NAMES: Record<(typeof LAYERS)[number], string> = {
  voice: "Voice", double: "Double", ghost: "Ghost (octave down)", bansuri: "Bansuri", keys: "Keys", pluck: "Sitar / santoor",
  drone: "Tanpura", pad: "Pad", bass: "Bass", kick: "Kick + pump", snare: "Snare / clap", hats: "Hats / shaker", perc: "Rim", tabla: "Tabla",
  texture: "Vinyl / rain", riser: "Riser",
};
const KNOBS: { key: keyof Controls; label: string; min: number; max: number; step: number; show: (v: number) => string }[] = [
  { key: "energy", label: "Energy", min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
  { key: "space", label: "Space", min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
  { key: "warmth", label: "Warmth", min: 0, max: 1, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
  { key: "swing", label: "Swing", min: 0.5, max: 0.7, step: 0.01, show: (v) => (v <= 0.505 ? "straight" : `${Math.round((v - 0.5) * 500)}%`) },
  { key: "tempo", label: "Tempo", min: 80, max: 130, step: 1, show: (v) => `${v} bpm` },
  { key: "voice", label: "Voice", min: 0.3, max: 1.3, step: 0.01, show: (v) => `${Math.round(v * 100)}%` },
];

export default function Remix() {
  const data = useData();
  const [bandishes, setBandishes] = useState<Bandish[]>([]);
  const [pick, setPick] = useState(0);
  const [presetKey, setPresetKey] = useState(PRESETS[0].key);
  const [layers, setLayers] = useState<Layers>({});
  const [controls, setControls] = useState<Controls | null>(null);
  const [playing, setPlaying] = useState(false);
  const [beatNow, setBeatNow] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);
  const handle = useRef<ReturnType<typeof produce> | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    fetch("/data/bandishes.json").then((r) => (r.ok ? r.json() : null)).then((d) => d && setBandishes(d.bandishes)).catch(() => {});
    return () => { handle.current?.stop(); cancelAnimationFrame(raf.current); };
  }, []);

  const ragas = data?.latest.ragas ?? [];
  // Start on Kabir's doha in the raga of the hour.
  useEffect(() => {
    if (!bandishes.length || !ragas.length) return;
    const hour = ragaOfHour(ragas, new Date().getHours()).key;
    const i = bandishes.findIndex((b) => b.raga === hour && b.source === "kabir");
    if (i >= 0) setPick(i);
  }, [bandishes, ragas]);

  const b = bandishes[pick];
  useEffect(() => { if (b) setPresetKey(themeFor(b.raga).key); }, [b]);
  const raga = ragas.find((r) => r.key === b?.raga);
  const style = PRESETS.find((p) => p.key === presetKey)!;
  // Each style starts from its own defaults; the knobs then shape it.
  useEffect(() => setControls(defaultControls(style)), [style]);
  const preset = controls ? withControls(style, controls) : style;
  // The wordless parts (interlude, coda): phrases from the newest composer's pieces in this raga,
  // low-octave first, the coda coming home to Sa.
  const build = (i: number): Piece | null => {
    const x = bandishes[i], r = ragas.find((y) => y.key === x?.raga);
    if (!x || !r || !data) return null;
    const pool = data.latest.pieces.filter((p) => p.raga === r.key).map((p) => p.notes);
    return { notes: x.notes, lyrics: lyricsOf(x.bol), beats: x.beats, raga: r, saHz: SA, interlude: pickPhrase(pool, 8, { low: true, seed: i }), coda: pickPhrase(pool, 8, { low: true, endOnSa: true, seed: i + 1 }) };
  };
  const piece: Piece | null = useMemo(() => build(pick), [bandishes, ragas, data, pick]); // eslint-disable-line react-hooks/exhaustive-deps
  const arr = useMemo(() => (piece ? arrange(piece) : null), [piece]);
  const total = piece ? lengthInBeats(piece) : 0;
  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") Object.assign(window, { __studio: { renderWav, PRESETS, piece, bandish: b, bandishes, build, themeFor, arrange, song: (text: string, rk: string, seed = 0) => { const r = ragas.find((y) => y.key === rk); return r && data ? songPiece(text, r, data.latest.pieces.filter((p) => p.raga === rk).map((p) => p.notes), seed, SA) : null; } } }); // read by the headless render
  const section = beatNow === null || !arr ? null : (arr.sections.find(([, start, len]) => beatNow >= start && beatNow < start + len)?.[0] ?? null);

  const stop = () => {
    handle.current?.stop();
    handle.current = null;
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setBeatNow(null);
  };
  const play = async () => {
    if (!piece) return;
    tick();
    if (playing) return stop();
    const eng = getEngine();
    await eng.resume();
    eng.stopPiece();
    eng.stopDrone(0.3);
    const h = produce(eng.ctx, eng.ctx.destination, piece, preset, layers);
    handle.current = h;
    setPlaying(true);
    const loop = () => {
      const t = eng.ctx.currentTime;
      if (t > h.end) return stop();
      setBeatNow((t - h.t0) / h.beat);
      raf.current = requestAnimationFrame(loop);
    };
    loop();
  };
  // Changing what plays restarts it.
  useEffect(() => { if (playing) { stop(); } }, [pick, presetKey, layers, controls]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    if (!piece || !raga || !b) return;
    tick();
    setRendering(true);
    try {
      const blob = await renderWav(piece, preset, layers);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ragaz-${raga.key}-${b.source ?? "bandish"}-${preset.key}.wav`.replace(/[^a-z0-9.-]+/gi, "-");
      a.click();
    } finally {
      setRendering(false);
    }
  };

  const toggle = (k: (typeof LAYERS)[number]) => { tick("soft"); setLayers((l) => ({ ...l, [k]: !(l[k] ?? preset.on.includes(k)) })); };
  useEffect(() => setLayers({}), [presetKey]); // a new style starts from its own instruments
  // The sheet shows the bandish only: map the track's beat back to it (none during interlude and coda).
  const head = beatNow === null || !arr ? null : arr.toSheet(beatNow);

  return (
    <main className="bg-transparent">
      <section className="relative overflow-hidden px-6 pb-10 pt-36 sm:px-10">
        <div className="pointer-events-none absolute -left-40 top-0 h-[640px] w-[640px] rounded-full bg-sona/15 blur-[140px]" />
        <div className="relative mx-auto max-w-[1400px]">
          <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">Remix</div>
          <h1 className="mt-4 font-display text-[clamp(64px,10vw,170px)] leading-[0.88]"><RiseChars text="Remix it." /></h1>
          <p className="mt-8 max-w-[680px] text-[clamp(18px,2vw,22px)] leading-[1.5] text-kajal/80">
            A bandish the model composed, made into a track: the raga melody and sung words on top, a bed built the way records are made underneath, all together from the first beat. Between the sthayi and the antara, and after the last words, the voice and a bansuri carry on without words, low in the raga.
          </p>
        </div>
      </section>
      <FloralBand />

      <section className="px-6 pb-24 sm:px-10">
        <div className="mx-auto grid max-w-[1400px] gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <div className="leaf-card border border-rule p-6">
              <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">1 · The sound</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {PRESETS.map((p) => (
                  <button key={p.key} onClick={() => { tick(); setPresetKey(p.key); }}
                    className={`rounded-xl border p-4 text-left transition-colors ${p.key === presetKey ? "border-sindoor bg-paper2/60" : "border-rule hover:border-sindoor/60"}`}>
                    <div className="font-display text-[26px] leading-none">{p.name}</div>
                    <div className="mt-2 text-[13px] leading-[1.5] text-kajal/65">{p.blurb}</div>
                    <div className="mt-2 text-[12px] text-kajal/45">{p.tempo} bpm{b && themeFor(b.raga).key === p.key ? " · this raga's theme" : ""}</div>
                  </button>
                ))}
              </div>
              {controls && (
                <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {KNOBS.map((k) => (
                    <label key={k.key} className="block text-[13px]">
                      <span className="flex justify-between text-kajal/70"><span>{k.label}</span><span className="tabular-nums">{k.show(controls[k.key])}</span></span>
                      <input type="range" min={k.min} max={k.max} step={k.step} value={controls[k.key]} onChange={(e) => setControls({ ...controls, [k.key]: Number(e.target.value) })} className="mt-1 w-full accent-sindoor" />
                    </label>
                  ))}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {LAYERS.map((k) => {
                  const on = layers[k] ?? preset.on.includes(k);
                  return <button key={k} onClick={() => toggle(k)} className={`rounded-full border px-4 py-1.5 text-[14px] transition-all ${on ? "border-kajal bg-kajal text-paper" : "border-rule text-kajal/50 line-through"}`}>{LAYER_NAMES[k]}</button>;
                })}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Magnetic variant="solid" cursor={playing ? "Stop" : "Listen"} onClick={play}>{playing ? "❚❚ Stop" : "▶ Play the track"}</Magnetic>
                <Magnetic cursor="Save" onClick={download}>{rendering ? "Rendering…" : "Download WAV"}</Magnetic>
                {arr && <span className="text-[13px] text-kajal/55">{Math.round((total * 60) / preset.tempo)} s · {arr.sections.map(([n]) => n).join(", ")}</span>}
              </div>
              {arr && (
                <div className="mt-5 flex h-2 overflow-hidden rounded-full bg-paper2">
                  {arr.sections.map(([name, , len]) => (
                    <div key={name} className={`h-full border-r border-paper transition-colors ${section === name ? "bg-sindoor" : ["interlude", "taan", "coda"].includes(name) ? "bg-sona/40" : "bg-kajal/15"}`} style={{ width: `${(len / total) * 100}%` }} title={name} />
                  ))}
                </div>
              )}
              {section && <div className="mt-2 text-[13px] uppercase tracking-[0.2em] text-sindoor">{section}</div>}
            </div>

            {b && raga && piece && (
              <div className="leaf-card border border-rule p-6">
                <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">The bandish</div>
                <div className="mt-1 font-display text-[24px]">{raga.name} <span className="font-deva text-kajal/60">{raga.devanagari}</span></div>
                <Bhatkhande notes={b.notes} beats={b.beats} head={head !== null && head >= 0 && head < b.beats ? head : null} words={b.bol.map((t) => (t === "-" ? "" : t))} theka={false} className="mt-4" />
                <p className="mt-4 text-[13px] leading-[1.6] text-kajal/55">
                  Melody by the model, for {b.source === "kabir" ? "Kabir's doha" : `a verse it never saw (${b.source?.split(":")[0]})`}. The voice sings the words roughly, each syllable starting on the nearest note. Every sound here is synthesised in your browser: no samples.
                </p>
              </div>
            )}
          </div>

          <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
            <div className="text-[12px] uppercase tracking-[0.24em] text-sepia">2 · The bandish</div>
            {ragas.map((r) => {
              const own = bandishes.map((x, i) => [x, i] as const).filter(([x]) => x.raga === r.key);
              if (!own.length) return null;
              return (
                <div key={r.key} className="rounded-lg border border-rule px-4 py-3">
                  <div className="font-display text-[18px]">{r.name} <span className="font-deva text-[15px] text-kajal/55">{r.devanagari}</span></div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {own.map(([x, i]) => (
                      <button key={i} onClick={() => { tick("soft"); setPick(i); }} className={`rounded-full border px-3 py-1 text-[13px] ${i === pick ? "border-sindoor bg-sindoor text-paper" : "border-rule hover:border-sindoor/60"}`}>
                        {x.source === "kabir" ? "Kabir" : x.source?.startsWith("bhramargeet") ? "Surdas" : x.source?.startsWith("bihari") ? "Bihari" : "verse"}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </aside>
        </div>
      </section>
      <Footer />
    </main>
  );
}
