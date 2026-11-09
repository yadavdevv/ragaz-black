"""Sing the songs: every out/songs/{key}.json timeline (rendered by the studio, its voices off)
becomes {key}-vocal.wav (the sung words alone) and {key}-sung.wav (the produced track).

    uv run --extra voice python scripts/sing_songs.py [key ...]
"""

import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from ragaz.sing import FS, mix_track, sing

SA = 220.0  # the studio's Sa; the words are sung an octave below it

for path in sorted(Path("out/songs").glob("*.json")):
    if sys.argv[1:] and path.stem not in sys.argv[1:]:
        continue
    tl = json.loads(path.read_text())
    vocal = sing(tl, SA / 2, tl["tempo"])
    wavfile.write(path.with_name(f"{path.stem}-vocal.wav"), FS, (vocal * 32767).astype(np.int16))
    mix_track(str(path.with_name(f"{path.stem}-bed.wav")), tl, SA, tl["tempo"], str(path.with_name(f"{path.stem}-sung.wav")))
    print(f"{path.stem}: {len(vocal) / FS:.0f} s", flush=True)
