"""Render sargam notation to audio: a flute-like lead over a tanpura drone.

Deliberately simple numpy synthesis so we can *hear* compositions from day one.
Pitches use just intonation relative to Sa, which is how the tanpura tunes the
ear in practice.
"""

import os
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

from ragaz.notation import parse
from ragaz.ragas import SWARAS, Raga

SR = 44_100

# Just-intonation ratios above Sa, in SWARAS order (S r R g G m M P d D n N).
RATIOS = np.array([1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8])


def swara_hz(swara: str, octave: int, sa_hz: float) -> float:
    return sa_hz * RATIOS[SWARAS.index(swara)] * 2.0**octave


def performance(comp, beat: float, raga_key: str, seed: int = 0) -> dict:
    """How a singer takes the notes, beyond the notes themselves (measured against real concerts by
    scripts/real_vs_ours.py: they spend ~19% of sung time between notes, wobble ~13 cents on a
    held note, and pause or breathe ~37 times a minute):
      breaths   (start, end) seconds of silence, cut from the end of a note: after a held note or
                at a bar line, never twice within ~1.2 s, at least every ~5 s
      kan       note index -> cents of a grace note, a quick touch of the next raga note above
                (or below) at the note's start
      shift     each note's start pushed or pulled a few ms (a singer is not a sequencer)
    """
    from ragaz.ragas import get_raga

    rng = np.random.default_rng(seed + 17)
    notes = comp.notes
    raga = get_raga(raga_key)
    scale = sorted(SWARAS.index(s) for s in raga.notes)
    breaths, last = [], 0.0
    for a, b in zip(notes, notes[1:]):
        end = (a.start + a.duration) * beat
        if b.start * beat - end > 0.2:  # already a rest there
            last = b.start * beat
            continue
        since = end - last
        p = 0.75 if a.duration >= 1.0 else 0.55 if abs(b.start % 4) < 1e-6 else 0.2 if a.duration >= 0.5 else 0.0
        if since > 5.0:
            p = max(p, 0.9)
        if since < 1.2:
            p = 0.0
        if rng.random() < p:
            dur = min(rng.uniform(0.22, 0.5), 0.5 * a.duration * beat)
            if dur >= 0.12:
                breaths.append((end - dur, end))
                last = end
    kan = {}
    for i, nt in enumerate(notes):
        if nt.duration * beat >= 0.3 and rng.random() < 0.45:
            pc = SWARAS.index(nt.swara)
            up = [x for x in scale if x > pc] or [scale[0] + 12]
            down = [x for x in scale if x < pc] or [scale[-1] - 12]
            kan[i] = ((up[0] if rng.random() < 0.7 else down[-1]) - pc) * 100
    return {"breaths": breaths, "kan": kan, "shift": rng.normal(0, 0.012, len(notes)).clip(-0.03, 0.03)}


def breath_mask(perf: dict, n: int, sr: int) -> np.ndarray:
    """1 where the singer is singing, 0 in the breaths."""
    m = np.ones(n)
    for a, b in perf["breaths"]:
        m[int(a * sr) : int(b * sr)] = 0
    return m


def expressive_cents(comp, beat: float, n: int, raga_key: str, library: dict, seed: int = 0, perf: dict | None = None) -> np.ndarray:
    """Pitch curve in cents above Sa, with real glides between notes and each note's real waver.

    Glides are curves recorded from real singers for the same interval in the same raga
    (see expression.py), replayed at this piece's pitch. Waver depth and rate are the
    measured medians for that note in that raga.
    """
    rng = np.random.default_rng(seed)
    glides, waver = library["glides"].get(raga_key, {}), library["waver"].get(raga_key, {})
    micro = library.get("micro", {}).get(raga_key, {})
    note_c = [SWARAS.index(x.swara) * 100 + 1200 * x.octave for x in comp.notes]
    cents = np.full(n, float(note_c[0]))
    t = np.arange(n) / SR
    shift = perf["shift"] if perf else np.zeros(len(comp.notes))
    wob = 1.3 if perf else 1.0  # real held notes wobble ~13 cents; the replayed snippets alone give ~10
    for i, (note, c) in enumerate(zip(comp.notes, note_c)):
        a, b = int((note.start * beat + shift[i]) * SR), int((note.start + note.duration) * beat * SR)
        a = max(0, a)
        cents[a:] = c
        held = (b - a) / SR
        snippets = micro.get(note.swara)
        if snippets and held > 0.12:
            # Replay a real singer's within-note contour (the small irregular ups and downs),
            # tiled with mirroring if the note is longer than the recorded one.
            snip = np.asarray(snippets[rng.integers(len(snippets))], dtype=float)
            reps = int(np.ceil(held * 100 / len(snip))) + 1
            tiled = np.concatenate([snip if i % 2 == 0 else snip[::-1] for i in range(reps)])
            curve = np.interp(np.arange(b - a) / SR * 100, np.arange(len(tiled)), tiled)
            fade = np.clip((t[a:b] - t[a]) / 0.04, 0, 1)
            cents[a:b] += fade * curve * wob
        else:
            w = waver.get(note.swara)
            if w and held > 0.3:
                fade = np.clip((t[a:b] - t[a] - 0.15) / 0.25, 0, 1)
                cents[a:b] += fade * w["depth_cents"] * np.sin(2 * np.pi * w["rate_hz"] * (t[a:b] - t[a]) + rng.uniform(0, 2 * np.pi))
    if perf:
        # A grace note (kan): a quick touch of a neighbouring note of the raga, falling into the note.
        for i, k in perf["kan"].items():
            note = comp.notes[i]
            a = max(0, int((note.start * beat + shift[i]) * SR))
            g = int(rng.uniform(0.045, 0.085) * SR)
            fall = int(0.04 * SR)
            if a + g + fall < n:
                cents[a : a + g] += k
                cents[a + g : a + g + fall] += k * np.linspace(1, 0, fall) ** 2
        # A slow drift: no singer holds the pitch dead steady across a phrase.
        walk = np.cumsum(rng.standard_normal(n // 441 + 2))
        walk = np.convolve(walk - walk.mean(), np.ones(40) / 40, mode="same")
        walk *= 5.0 / (np.std(walk) + 1e-9)
        cents += np.interp(np.arange(n), np.arange(len(walk)) * 441, walk)
    for prev, nxt, c0, c1 in zip(comp.notes, comp.notes[1:], note_c, note_c[1:]):
        delta = c1 - c0
        if delta == 0:
            continue
        options = glides.get(str(delta))
        if not options:  # nearest recorded interval in the same direction
            keys = [int(k) for k in glides if int(k) * delta > 0]
            options = glides[str(min(keys, key=lambda k: abs(k - delta)))] if keys else None
        if not options:
            continue
        g = options[rng.integers(len(options))]
        room = beat * min(prev.duration, nxt.duration)
        dur = min(g["seconds"] * (1.6 if perf else 1.0), (0.85 if perf else 0.6) * room)  # real singers spend ~19% of sung time between notes
        boundary = nxt.start * beat
        a, b = int((boundary - 0.6 * dur) * SR), int((boundary + 0.4 * dur) * SR)
        a, b = max(a, 0), min(b, n)
        if b - a < 4:
            continue
        shape = np.interp(np.linspace(0, 1, b - a), np.linspace(0, 1, len(g["shape"])), g["shape"])
        cents[a:b] = c0 + shape * delta
    return cents


def render_lead(text: str, sa_hz: float, tempo: float, raga_key: str | None = None, library: dict | None = None, perf: dict | None = None) -> np.ndarray:
    comp = parse(text)
    if not comp.notes:
        raise ValueError("no notes to render")
    beat = 60 / tempo
    n = int((comp.beats * beat + 1.0) * SR)

    # Piecewise-constant pitch and note-age per sample.
    log_f0 = np.full(n, np.log(swara_hz(comp.notes[0].swara, comp.notes[0].octave, sa_hz)))
    age = np.zeros(n)
    amp = np.zeros(n)
    for note in comp.notes:
        a, b = int(note.start * beat * SR), int((note.start + note.duration) * beat * SR)
        log_f0[a:] = np.log(swara_hz(note.swara, note.octave, sa_hz))
        age[a:b] = np.arange(b - a) / SR
        amp[a:b] = 1.0
        # Light articulation: a short dip at each new note, like tonguing.
        dip = min(int(0.03 * SR), b - a)
        amp[a : a + dip] = np.linspace(0.55, 1.0, dip)

    # Glides between notes: smooth the pitch in the log domain (~45 ms).
    win = np.hanning(int(0.045 * SR))
    log_f0 = fftconvolve(np.pad(log_f0, len(win), mode="edge"), win / win.sum(), mode="same")[len(win) : -len(win)]

    if library is not None and raga_key is not None:
        # Expressive mode: real glides and wavers replace the generic smoothing and vibrato.
        cents = expressive_cents(comp, beat, n, raga_key, library, perf=perf)
        cents = fftconvolve(np.pad(cents, 220, mode="edge"), np.hanning(221) / np.hanning(221).sum(), mode="same")[220:-220]
        f0 = sa_hz * 2 ** (cents / 1200)
    else:
        # Vibrato that fades in once a note has been held for a moment.
        vib_depth = np.clip((age - 0.25) / 0.4, 0, 1) * 0.006
        t = np.arange(n) / SR
        f0 = np.exp(log_f0) * (1 + vib_depth * np.sin(2 * np.pi * 5.2 * t))

    if perf:
        amp = amp * breath_mask(perf, n, SR)
    # Overall envelope: soft attack and a long release after the last note.
    amp = fftconvolve(amp, np.hanning(int(0.06 * SR)) / (0.03 * SR), mode="same")
    amp = np.clip(amp, 0, 1)

    phase = 2 * np.pi * np.cumsum(f0) / SR
    harmonics = [1.0, 0.35, 0.18, 0.08, 0.04]
    tone = sum(h * np.sin((k + 1) * phase) for k, h in enumerate(harmonics))

    # Breath noise, band-passed and following the envelope.
    breath = sosfilt(butter(2, [1500, 5000], btype="band", fs=SR, output="sos"), np.random.default_rng(0).standard_normal(n))
    return amp * (tone + 0.12 * breath)


def tanpura_pluck(hz: float, seconds: float = 5.0, rng: np.random.Generator | None = None) -> np.ndarray:
    """One tanpura string: many harmonics that bloom one after another (the jawari buzz)."""
    rng = rng or np.random.default_rng(0)
    t = np.arange(int(seconds * SR)) / SR
    out = np.zeros_like(t)
    for k in range(1, 25):
        if k * hz > SR / 2.5:
            break
        t_k = 0.05 + 0.07 * k  # higher harmonics peak later
        bloom = (t / t_k) * np.exp(1 - t / t_k)
        env = k**-0.8 * np.exp(-t / 3.0) * (0.35 + 0.65 * bloom)
        out += env * np.sin(2 * np.pi * k * hz * (1 + 0.0002 * k) * t + rng.uniform(0, 2 * np.pi))
    attack = min(len(t), int(0.006 * SR))
    out[:attack] *= np.linspace(0, 1, attack)
    return out


def render_tanpura(raga: Raga, sa_hz: float, seconds: float) -> np.ndarray:
    """Cycle the four strings: first (Pa or Ma, lower octave), Sa, Sa, lower Sa."""
    low_sa = sa_hz / 2
    strings = [swara_hz(raga.tanpura, -1, sa_hz), sa_hz, sa_hz, low_sa]
    rng = np.random.default_rng(1)
    plucks = [tanpura_pluck(hz, rng=rng) for hz in strings]
    gaps = [1.1, 1.1, 1.1, 1.5]

    n = int(seconds * SR)
    out = np.zeros(n + len(plucks[0]))
    pos, i = 0.0, 0
    while pos < seconds:
        a = int(pos * SR)
        out[a : a + len(plucks[i % 4])] += plucks[i % 4] * rng.uniform(0.85, 1.0)
        pos += gaps[i % 4] * rng.uniform(0.97, 1.03)
        i += 1
    out = out[:n]
    fade = int(2.5 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def reverb(x: np.ndarray, seconds: float = 1.6, wet: float = 0.22) -> np.ndarray:
    rng = np.random.default_rng(2)
    t = np.arange(int(seconds * SR)) / SR
    ir = rng.standard_normal(len(t)) * np.exp(-t / 0.45)
    ir[: int(0.012 * SR)] = 0  # small pre-delay
    ir /= np.sqrt(np.sum(ir**2))
    return (1 - wet) * x + wet * fftconvolve(x, ir)[: len(x)]


def normalize(x: np.ndarray, peak: float = 1.0) -> np.ndarray:
    return x * (peak / max(1e-9, np.max(np.abs(x))))


def breaths_heard(perf: dict, n: int, seed: int = 4) -> np.ndarray:
    """A soft intake of breath in each pause: band-passed noise that swells and stops."""
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    sos = butter(2, [700, 3500], btype="band", fs=SR, output="sos")
    for a, b in perf["breaths"]:
        dur = min(0.28, b - a)
        if dur < 0.1:
            continue
        m = int(dur * SR)
        env = np.sin(np.linspace(0, np.pi, m)) ** 1.5 * np.linspace(0.6, 1, m)
        i = int((b - dur) * SR)
        if i + m < n:
            out[i : i + m] += sosfilt(sos, rng.standard_normal(m)) * env * rng.uniform(0.6, 1.0)
    return out


def room_tone(n: int, seed: int = 6) -> np.ndarray:
    """The faint noise of a real room and a real microphone: pink-ish, very quiet."""
    w = np.random.default_rng(seed).standard_normal(n)
    return sosfilt(butter(1, 900, btype="low", fs=SR, output="sos"), w) + 0.15 * w


def render(text: str, raga: Raga, sa_hz: float = 261.63, tempo: float = 100, intro: float = 3.0, outro: float = 3.0, expressive: bool = False, voice: str | None = None, perform: bool = False) -> np.ndarray:
    """perform: sing it as a person would (render.performance): breaths, grace notes, phrase
    dynamics, a looser pitch, an audible intake of breath and the room around it."""
    library = None
    if expressive or voice:
        import json

        path = Path(os.environ.get("RAGAZ_EXPRESSION", "data/expression.json"))  # ragaz.compose points this at a download
        if not path.exists():
            raise FileNotFoundError("expressive rendering needs data/expression.json: run `python -m ragaz.expression`")
        library = json.loads(path.read_text())
    perf = None
    if perform and library is not None:
        comp = parse(text)
        perf = performance(comp, 60 / tempo, raga.key)
    if voice in ("violin", "vocal", "hvocal"):
        # Learned DDSP violin (16 kHz) driven by the same expressive pitch curve, resampled to 44.1 kHz.
        from scipy.signal import resample_poly

        from ragaz.ddsp import render_voice

        lead = normalize(resample_poly(render_voice(text, raga.key, sa_hz, tempo, library, name=voice, perf=perf), 441, 160), 0.8)
    else:
        lead = normalize(render_lead(text, sa_hz, tempo, raga.key, library, perf=perf), 0.8)
    if perf:
        lead = lead + 0.05 * normalize(breaths_heard(perf, len(lead)))
    total = intro + len(lead) / SR + outro
    mix = 0.3 * normalize(render_tanpura(raga, sa_hz, total))
    start = int(intro * SR)
    mix[start : start + len(lead)] += lead
    if perf:
        mix += 0.004 * normalize(room_tone(len(mix)))
    return normalize(reverb(mix, wet=0.26 if perf else 0.22), 0.9)


def write_wav(path: str | Path, audio: np.ndarray) -> None:
    wavfile.write(str(path), SR, (audio * 32767).astype(np.int16))
