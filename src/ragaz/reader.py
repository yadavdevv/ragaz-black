"""The "Sing to it" reader, used as an independent check on the composer.

The reader (scripts/hum_reading.py) learned each raga's note time-share and note-to-note
moves from real singers only; it never sees model pieces and is never a reward. Asking it
"which raga is this piece?" tells us whether the composer's ragas sound like real singers'
ragas, which the reward's own terms can't tell us without grading their own homework.
"""

import json
from functools import cache
from pathlib import Path

import numpy as np

from ragaz.ragas import SWARAS

READER = Path("web/public/data/reader.json")


@cache
def load_reader() -> dict | None:
    return json.loads(READER.read_text()) if READER.exists() else None


def rank(notes: list[tuple[str, int, float]]) -> list[str]:
    """Ragas from most to least likely for (swara, octave, duration) notes; same score as listen.ts."""
    reader = load_reader()
    if not reader or not notes:
        return []
    total = sum(d for _, _, d in notes) or 1.0
    pcs = [SWARAS.index(s) for s, _, _ in notes]
    steps = [(a, b) for a, b in zip(pcs, pcs[1:]) if a != b]
    scores = {}
    for raga, m in reader["models"].items():
        s = sum(d * np.log(m["notes"][SWARAS.index(sw)]) for sw, _, d in notes) / total
        if steps:
            s += reader["w_moves"] * sum(np.log(m["moves"][a][b] + 1e-12) for a, b in steps) / len(steps)
        scores[raga] = s
    return sorted(scores, key=scores.get, reverse=True)


def known() -> set[str]:
    reader = load_reader()
    return set(reader["models"]) if reader else set()
