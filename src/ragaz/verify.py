"""Score a sargam composition against a raga's rules.

The same report is the GRPO reward, the evaluation metric and the explanation
shown to a listener. Every score is in [0, 1].

    reward = format · allowed² · beats² · variety · length · (0.25·tala + 0.25·emphasis + 0.2·melody + 0.3·pakad)   (v1)
    v4: allowed² → purity (0.4 per forbidden note); style = rulebook (tala, rank, pakad) + real (phrases, motion)

``format``, ``allowed`` and ``variety`` multiply, so nothing else can make up for
broken notation, wrong notes or a degenerate loop. (When variety was a weighted
term, one note repeated 16 times still scored 0.55 on tala alone, an easy hack
for RL to find.) ``melody`` was added after the 2B baseline's best sample
(0.91) jumped between octaves on almost every note. ``length`` and a
multiplicative ``variety`` were added after the first GRPO run learned to write
32-bar loops (``S G G G | S G G G | ...``) that still scored ~0.5: averaging
variety's checks let three good ones hide heavy repetition, and extra bars
diluted every per-bar penalty. ``beats`` became a multiplier after Track A
chopped pieces into 8 "bars" of 1–3 beats to satisfy ``length``.
"""

from collections import Counter
from dataclasses import dataclass, field

from ragaz.notation import Composition, parse
from ragaz.ragas import Raga, get_raga

BEATS_PER_BAR = 4  # Teentaal: 4 vibhags of 4 matras
BARS_PER_CYCLE = 4
TARGET_BARS = 8  # the prompt asks for two cycles; shorter or longer pieces are scaled down
REPEAT_ALLOWANCE = 0.75  # up to a quarter of bars may repeat (refrains are normal)

WEIGHTS = {"tala": 0.25, "emphasis": 0.25, "melody": 0.2, "pakad": 0.3}
# v2: style measured from real performances (see realprofile.py) instead of guessed.
# v4 (hybrid): rulebook identity + real-music style. Ragas without recordings (e.g.
# Deshkar) fall back to the rulebook terms alone.
WEIGHTS_V4 = {"tala": 0.15, "rank": 0.15, "pakad": 0.2, "phrases": 0.4, "motion": 0.1}
WEIGHTS_V4_RULES_ONLY = {"tala": 0.25, "rank": 0.35, "pakad": 0.4}
# v5 = v4 + rhythm measured from real performances (pooled over ragas, so every raga has it).
# Rhythm is a *multiplier* in v5 (reward × (RHYTHM_FLOOR + (1 − RHYTHM_FLOOR)·rhythm)), not a
# weighted term: as a 0.2 weight, GRPO traded it away (eval rhythm 0.36 → 0.15 in 20 steps),
# because one note per beat makes beats and phrases easier.
RHYTHM_FLOOR = 0.4
# register (time per octave vs real) added after finding v5c never left the middle octave
# while real singers spend 18–46% of their time in the upper one.
WEIGHTS_V5 = {"tala": 0.15, "rank": 0.15, "pakad": 0.15, "phrases": 0.3, "motion": 0.1, "register": 0.15}
WEIGHTS_V5_RULES_ONLY = {"tala": 0.25, "rank": 0.35, "pakad": 0.4}
FORBIDDEN_FACTOR = 0.4  # v4: each forbidden note multiplies the reward by this

# v3: like v2, but the note profile is scored per GRPO group in the trainer (pooled,
# leave-one-out), because one 32-note piece is too noisy a sample of a profile.
WEIGHTS_V3 = {"tala": 0.3, "motion": 0.1, "phrases": 0.6}
WEIGHTS_V2 = {"tala": 0.2, "profile": 0.35, "motion": 0.1, "phrases": 0.35}  # motion low: held-note transcription drops quick notes, so real music looks leapier than written notation

PAKAD_MIN_SIM = 0.6  # below this a window doesn't count as the phrase (0.5 credited any in-raga piece; 0.7 left GRPO no signal)
PAKAD_EXACT_SIM = 0.85  # "near-exact" occurrence, for the spam check
PAKAD_MAX_REPEATS = 2

BIG_LEAP = 7  # semitones; anything wider than a fifth
MAX_OCTAVE = 1  # lower (mandra) to upper (taar) octave


@dataclass
class Report:
    raga: str
    scores: dict[str, float]
    reward: float
    violations: list[str] = field(default_factory=list)
    stats: dict[str, object] = field(default_factory=dict)

    def explain(self) -> str:
        lines = [f"Raga {self.raga}: reward {self.reward:.3f}"]
        lines += [f"  {name:<9} {value:.3f}" for name, value in self.scores.items()]
        if self.stats:
            lines.append("  " + ", ".join(f"{k}={v}" for k, v in self.stats.items()))
        lines += [f"  ✗ {v}" for v in self.violations]
        return "\n".join(lines)


def band(x: float, lo: float, hi: float) -> float:
    """1 inside [lo, hi], falling linearly to 0 at 0 and at 2·hi."""
    if x < lo:
        return x / lo
    if x > hi:
        return max(0.0, 1 - (x - hi) / hi)
    return 1.0


def score_format(comp: Composition, violations: list[str]) -> float:
    if not comp.notes:
        violations.append("no notes found")
        return 0.0
    for token in comp.invalid[:5]:
        violations.append(f"invalid token {token!r}")
    return (comp.beats / comp.token_count) ** 2


def score_allowed(comp: Composition, raga: Raga, violations: list[str]) -> float:
    wrong = [n for n in comp.notes if n.swara not in raga.notes]
    for n in wrong[:5]:
        violations.append(f"{n.swara} is not in {raga.name} (bar {n.bar + 1})")
    return 1 - len(wrong) / len(comp.notes)


def score_beats(comp: Composition, violations: list[str]) -> float:
    """Share of bars with exactly 4 beats. A hard rule of Teentaal, so it multiplies."""
    bar_lengths = [len(bar) for bar in comp.bars]
    bad = [i for i, n in enumerate(bar_lengths) if n != BEATS_PER_BAR]
    for i in bad[:3]:
        violations.append(f"bar {i + 1} has {bar_lengths[i]} beats, expected {BEATS_PER_BAR}")
    return 1 - len(bad) / len(bar_lengths)


def score_tala(comp: Composition, raga: Raga, violations: list[str]) -> float:
    bar_lengths = [len(bar) for bar in comp.bars]
    cycle_ok = float(len(bar_lengths) >= BARS_PER_CYCLE and len(bar_lengths) % BARS_PER_CYCLE == 0)
    if not cycle_ok:
        violations.append(f"{len(bar_lengths)} bars is not a whole number of Teentaal cycles")

    last = comp.notes[-1].swara
    ending_ok = float(last == "S" or last in raga.nyas)
    if not ending_ok:
        violations.append(f"ends on {last}, not on Sa or a resting note")

    return 0.6 * cycle_ok + 0.4 * ending_ok


def score_emphasis(comp: Composition, raga: Raga, violations: list[str], stats: dict) -> float:
    durations = Counter()
    for n in comp.notes:
        durations[n.swara] += n.duration
    total = sum(durations.values())
    vadi_share = durations[raga.vadi] / total
    samvadi_share = durations[raga.samvadi] / total
    ranking = [s for s, _ in durations.most_common()]
    stats["vadi_share"] = round(vadi_share, 2)
    stats["samvadi_share"] = round(samvadi_share, 2)

    # Distribution match, not "more is better": a piece that sits on the vadi
    # forever scores as badly as one that ignores it.
    vadi = band(vadi_share, 0.15, 0.35)
    samvadi = band(samvadi_share, 0.08, 0.30)
    rank = 1.0 if raga.vadi in ranking[:2] else 0.5 if raga.vadi in ranking[:3] else 0.0
    if rank < 1:
        violations.append(f"vadi {raga.vadi} is not among the most prominent notes")
    return (vadi + samvadi + rank) / 3


def score_rank(comp: Composition, raga: Raga) -> float:
    """Rulebook emphasis by *rank*, not share: the vadi among the two most-used notes,
    the samvadi among the top four. Real performances agree with this (unlike v1's
    share bands, which real masters failed)."""
    durations = Counter()
    for n in comp.notes:
        durations[n.swara] += n.duration
    ranking = [s for s, _ in durations.most_common()]
    vadi = 1.0 if raga.vadi in ranking[:2] else 0.5 if raga.vadi in ranking[:3] else 0.0
    samvadi = 1.0 if raga.samvadi in ranking[:4] else 0.5 if raga.samvadi in ranking else 0.0
    return (vadi + samvadi) / 2


def score_arc(comp: Composition, violations: list[str]) -> float:
    """Shape of a long piece, from the rulebook of a bandish: the first half (sthayi) stays
    in the middle register and resolves to Sa; the second half (antara) rises and reaches
    upper Sa. Applies to pieces of 16+ bars only."""
    half = len(comp.bars) // 2
    first = [n for n in comp.notes if n.bar < half]
    second = [n for n in comp.notes if n.bar >= half]
    if not first or not second:
        return 0.0
    mean = lambda ns: sum(n.semitones * n.duration for n in ns) / sum(n.duration for n in ns)  # noqa: E731
    rises = 1.0 if mean(second) > mean(first) + 1 else 0.0
    upper_sa = 1.0 if any(n.swara == "S" and n.octave >= 1 for n in second) else 0.0
    resolves = 1.0 if first[-1].swara == "S" else 0.0
    if not rises:
        violations.append("second half does not rise above the first (antara)")
    if not upper_sa:
        violations.append("second half never reaches upper Sa (S')")
    return (rises + upper_sa + resolves) / 3


def score_purity(comp: Composition, raga: Raga) -> float:
    """One forbidden note can spoil a raga: v3 let a Pa into Malkauns at only ~6% cost."""
    return FORBIDDEN_FACTOR ** sum(n.swara not in raga.notes for n in comp.notes)


def score_variety(comp: Composition, raga: Raga, violations: list[str], stats: dict) -> float:
    used = {n.swara for n in comp.notes} & raga.notes
    coverage = min(1.0, len(used) / max(1, len(raga.notes) - 1))

    bar_keys = [tuple(bar) for bar in comp.bars]
    unique_bars = len(set(bar_keys)) / len(bar_keys)
    if unique_bars < 1:
        violations.append(f"{len(bar_keys) - len(set(bar_keys))} repeated bar(s)")

    longest = run = 1
    for prev, cur in zip(comp.notes, comp.notes[1:]):
        run = run + 1 if cur.semitones == prev.semitones else 1
        longest = max(longest, run)
    runs = 1.0 if longest <= 3 else max(0.0, 1 - (longest - 3) / 4)
    if longest > 3:
        violations.append(f"same note repeated {longest} times in a row")

    holds = sum(bar.count("-") for bar in comp.bars) / comp.beats
    hold_score = 1.0 if holds <= 0.35 else max(0.0, 1 - (holds - 0.35) / 0.35)
    if holds > 0.35:
        violations.append(f"{holds:.0%} of beats are holds")

    stats["notes_used"] = len(used)
    stats["longest_run"] = longest
    repetition = min(1.0, unique_bars / REPEAT_ALLOWANCE)
    return coverage * repetition * runs * hold_score


def score_length(comp: Composition, violations: list[str], target: int = TARGET_BARS) -> float:
    """Full credit for exactly the requested bars. Run 2 settled on 4 bars when anything up to 8 passed."""
    bars = len(comp.bars)
    if bars == target:
        return 1.0
    violations.append(f"{bars} bars, asked for {target}")
    return bars / target if bars < target else target / bars


def score_melody(comp: Composition, violations: list[str], stats: dict) -> float:
    """Raga melodies move mostly by steps and small skips, inside about two octaves."""
    intervals = [abs(b.semitones - a.semitones) for a, b in zip(comp.notes, comp.notes[1:])]
    if not intervals:
        return 0.0
    big = sum(i > BIG_LEAP for i in intervals) / len(intervals)
    if big > 0:
        violations.append(f"{big:.0%} of moves are leaps wider than a fifth")
    out_of_range = sum(abs(n.octave) > MAX_OCTAVE for n in comp.notes) / len(comp.notes)
    if out_of_range > 0:
        violations.append(f"{out_of_range:.0%} of notes are beyond the lower or upper octave")
    stats["big_leaps"] = round(big, 2)
    return max(0.0, 1 - 2.5 * big - 2 * out_of_range)


def edit_distance(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def phrase_matches(swaras: list[str], phrase: list[str]) -> list[float]:
    """Similarity (0..1) of each window of the piece to the phrase, by pitch class."""
    n = len(phrase)
    if len(swaras) < n:
        return [1 - edit_distance(swaras, phrase) / n] if swaras else []
    return [1 - edit_distance(swaras[i : i + n], phrase) / n for i in range(len(swaras) - n + 1)]


def score_pakad(comp: Composition, raga: Raga, violations: list[str], stats: dict) -> float:
    """Does the piece use the raga's signature phrases (pakad)? Fuzzy, capped, anti-spam.

    Rules alone gave valid but characterless music (and couldn't tell Bhupali from
    Deshkar, which share notes). Pakad is where a raga's identity lives.
    """
    swaras = [n.swara for n in comp.notes]
    phrases = [[n.swara for n in parse(p).notes] for p in raga.pakad.split("|") if p.strip()]
    best, spam = [], False
    for phrase in phrases:
        sims = phrase_matches(swaras, phrase)
        top = max(sims, default=0.0)
        best.append(max(0.0, (top - PAKAD_MIN_SIM) / (1 - PAKAD_MIN_SIM)))
        # Count non-overlapping near-exact occurrences.
        count, i = 0, 0
        while i < len(sims):
            if sims[i] >= PAKAD_EXACT_SIM:
                count += 1
                i += len(phrase)
            else:
                i += 1
        spam |= count > PAKAD_MAX_REPEATS
    best.sort(reverse=True)
    score = 0.7 * best[0] + 0.3 * (best[1] if len(best) > 1 else best[0])
    if spam:
        violations.append(f"signature phrase repeated more than {PAKAD_MAX_REPEATS} times")
        score *= 0.5
    if best[0] == 0:
        violations.append("no signature phrase (pakad) of the raga")
    stats["pakad"] = round(score, 2)
    return score


def verify(text: str, raga: str | Raga, style: str = "v1", target_bars: int = TARGET_BARS) -> Report:
    """``style="v1"``: hand-written style rules. ``"v2"``: style calibrated on real recordings."""
    raga = get_raga(raga) if isinstance(raga, str) else raga
    from ragaz.realprofile import profiles_path

    # v6 = the v5 reward, scored against real profiles of all twelve recorded ragas.
    path = profiles_path(style)
    style = "v5" if style == "v6" else style
    comp = parse(text)
    violations: list[str] = []
    stats: dict[str, object] = {}

    fmt = score_format(comp, violations)
    if fmt == 0:
        scores = {"format": 0.0, "allowed": 0.0, "beats": 0.0, "tala": 0.0, "emphasis": 0.0, "melody": 0.0, "pakad": 0.0, "variety": 0.0, "length": 0.0}
        if style in ("v2", "v3", "v4"):
            scores |= {"profile": 0.0, "motion": 0.0, "phrases": 0.0}
        if style in ("v4", "v5"):
            scores |= {"rank": 0.0, "purity": 0.0}
        if style == "v5":
            scores["rhythm"] = 0.0
            if target_bars >= 16:
                scores["arc"] = 0.0
        return Report(raga.name, scores, 0.0, violations, stats)

    scores = {
        "format": fmt,
        "allowed": score_allowed(comp, raga, violations),
        "beats": score_beats(comp, violations),
        "tala": score_tala(comp, raga, violations),
        "emphasis": score_emphasis(comp, raga, violations, stats),
        "melody": score_melody(comp, violations, stats),
        "pakad": score_pakad(comp, raga, violations, stats),
        "variety": score_variety(comp, raga, violations, stats),
        "length": score_length(comp, violations, target_bars),
    }
    weights = WEIGHTS
    note_gate = scores["allowed"] ** 2
    if style in ("v2", "v3", "v4", "v5"):
        from ragaz.realprofile import load_profiles, rhythm_scores, style_scores

        real = style_scores([(n.swara, n.octave, n.duration) for n in comp.notes], raga.key, path)
        if style in ("v4", "v5"):
            scores["rank"] = score_rank(comp, raga)
            scores["purity"] = note_gate = score_purity(comp, raga)
            if style == "v5":
                scores |= rhythm_scores([(n.swara, n.octave, n.duration) for n in comp.notes], load_profiles(path))
            if real is None:  # no recordings for this raga: rulebook identity only
                scores |= {"profile": 0.0, "motion": 0.0, "phrases": 0.0}
                weights = WEIGHTS_V4_RULES_ONLY if style == "v4" else WEIGHTS_V5_RULES_ONLY
            else:
                scores |= {k: v for k, v in real.items() if k != "rhythm"}
                weights = WEIGHTS_V4 if style == "v4" else WEIGHTS_V5
        else:
            if real is None:
                raise FileNotFoundError("v2/v3 style needs data/real_profiles.json and a profile for this raga")
            scores |= real
            weights = WEIGHTS_V2 if style == "v2" else WEIGHTS_V3
        if real is not None:
            stats.update({k: round(v, 2) for k, v in real.items()})
        if style in ("v2", "v3") and "rhythm" in scores:
            del scores["rhythm"]
    if style == "v5" and target_bars >= 16:
        # Long pieces: 10% of the shaped score is the sthayi → antara arc.
        scores["arc"] = score_arc(comp, violations)
        weights = {k: 0.9 * w for k, w in weights.items()} | {"arc": 0.1}
    shaped = sum(weights[k] * scores[k] for k in weights)
    rhythm_gate = RHYTHM_FLOOR + (1 - RHYTHM_FLOOR) * scores["rhythm"] if style == "v5" else 1.0
    reward = scores["format"] * note_gate * scores["beats"] ** 2 * scores["variety"] * scores["length"] * rhythm_gate * shaped
    stats["beats"] = comp.beats
    return Report(raga.name, scores, reward, violations, stats)
