"""Load raga rules from ragas.yaml."""

from dataclasses import dataclass
from functools import cache
from pathlib import Path

import yaml

SWARAS = "SrRgGmMPdDnN"  # index = semitones above Sa


@dataclass(frozen=True)
class Raga:
    key: str
    name: str
    thaat: str
    notes: frozenset[str]
    vadi: str
    samvadi: str
    nyas: frozenset[str]
    pakad: str
    time: str
    rasa: str
    tanpura: str
    hours: tuple[int, int] | None = None  # local clock hours [start, end); may wrap past midnight
    season: str | None = None  # for ragas tied to a season rather than an hour
    devanagari: str = ""


@cache
def load_ragas() -> dict[str, Raga]:
    raw = yaml.safe_load((Path(__file__).parent / "ragas.yaml").read_text())
    ragas = {}
    for key, r in raw.items():
        notes = frozenset(r["notes"].split())
        nyas = frozenset(r["nyas"].split())
        for swara in notes | nyas | {r["vadi"], r["samvadi"], r["tanpura"]}:
            if swara not in SWARAS:
                raise ValueError(f"{key}: unknown swara {swara!r}")
        if not ({r["vadi"], r["samvadi"]} | nyas) <= notes:
            raise ValueError(f"{key}: vadi, samvadi and nyas must be raga notes")
        ragas[key] = Raga(
            key=key,
            name=r["name"],
            thaat=r["thaat"],
            notes=notes,
            vadi=r["vadi"],
            samvadi=r["samvadi"],
            nyas=nyas,
            pakad=r["pakad"],
            time=r["time"],
            rasa=r["rasa"],
            tanpura=r["tanpura"],
            hours=tuple(r["hours"]) if "hours" in r else None,
            season=r.get("season"),
            devanagari=r.get("devanagari", ""),
        )
    return ragas


def get_raga(key: str) -> Raga:
    ragas = load_ragas()
    if key.lower() not in ragas:
        raise KeyError(f"unknown raga {key!r}; known: {', '.join(ragas)}")
    return ragas[key.lower()]
