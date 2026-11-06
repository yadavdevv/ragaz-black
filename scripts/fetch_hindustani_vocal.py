"""Voice v2 data: Hindustani vocal concerts from Saraga 1.5, separated into vocals.

    uv run --extra voice python scripts/fetch_hindustani_vocal.py fetch      # the picked mixes (~0.6 GB)
    uv run --extra voice python scripts/fetch_hindustani_vocal.py separate   # Demucs htdemucs → vocals

Saraga 1.5 Hindustani (Zenodo 10.5281/zenodo.4301737, CC BY-NC-SA 4.0) has mixes only: no vocal
stems. Picked (data/external/saraga_hindustani/picks.json): the 16 recordings led by a voice
with no harmonium, sarangi or violin (voice, tabla, tanpura only), 313 minutes from 3 singers;
melodic accompaniment that follows the voice is what separation leaks. Separation by Demucs
(MIT), vocals vs the rest. Both steps skip what is already on disk (resumable), one file at a time.
The voice model trained on the result stays non-commercial (ShareAlike).
"""

import json
import subprocess
import sys
from pathlib import Path

from remotezip import RemoteZip

URL = "https://zenodo.org/records/4301737/files/saraga1.5_hindustani.zip?download=1"
ROOT = Path("data/external/saraga_hindustani")


def fetch() -> None:
    picks = json.loads((ROOT / "picks.json").read_text())
    (ROOT / "mix").mkdir(parents=True, exist_ok=True)
    with RemoteZip(URL) as z:
        for i, meta in enumerate(picks):
            mp3 = meta.replace(".json", ".mp3.mp3")
            out = ROOT / "mix" / f"{i:02d}_{Path(meta).parts[1][:60].replace(' ', '_')}.mp3"
            if out.exists():
                continue
            tmp = out.with_suffix(".part")
            tmp.write_bytes(z.read(mp3))
            tmp.rename(out)
            print(f"{out.name}: {out.stat().st_size / 1e6:.0f} MB", flush=True)


def separate() -> None:
    out = ROOT / "sep"
    for mix in sorted((ROOT / "mix").glob("*.mp3")):
        target = out / "htdemucs" / mix.stem / "vocals.wav"
        if target.exists():
            continue
        print(f"separating {mix.name}", flush=True)
        subprocess.run([sys.executable, "-m", "demucs", "-n", "htdemucs", "--two-stems", "vocals", "-d", "mps", "-j", "1", "--segment", "7", "-o", str(out), str(mix)], check=True)
    vocals = ROOT / "vocals"
    vocals.mkdir(exist_ok=True)
    for v in sorted((out / "htdemucs").glob("*/vocals.wav")):
        link = vocals / f"{v.parent.name}.wav"
        if not link.exists():
            link.symlink_to(v.resolve())
    print(f"{len(list(vocals.glob('*.wav')))} vocal tracks in {vocals}")


if __name__ == "__main__":
    {"fetch": fetch, "separate": separate}[sys.argv[1]]()
