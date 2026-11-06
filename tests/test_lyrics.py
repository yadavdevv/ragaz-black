import json
from pathlib import Path

import pytest

from ragaz.lyrics import set_words, syllables

GOLDEN = json.loads((Path(__file__).parent / "data" / "lyrics_golden.json").read_text())


def test_hindi_scansion():
    syl = syllables("बुरा जो देखन मैं चला\nबुरा न मिलिया कोय")
    assert [s.text for s in syl[:5]] == ["बु", "रा", "जो", "दे", "खन"]  # silent final a: दे·खन
    assert [s.heavy for s in syl[:5]] == [False, True, True, True, True]
    assert syllables("कमल")[1].text == "मल"  # ka·mal


def test_tamil_keeps_final_a():
    assert [s.text for s in syllables("அகர")] == ["அ", "க", "ர"]


@pytest.mark.parametrize("case", GOLDEN, ids=lambda c: f"{c['text'][:8]}-{c['piece']}")
def test_matches_browser(case):
    syl = syllables(case["text"])
    assert [[s.text, s.heavy, s.open] for s in syl] == case["syllables"]
    fit = set_words(syl, case["onsets"], case["beats"])
    if case["starts"] is None:
        assert fit is None
        return
    assert fit.starts == case["starts"]
    assert fit.score == pytest.approx(case["score"], abs=1e-9)
    assert fit.mukhda_on_sam == case["mukhdaOnSam"]
