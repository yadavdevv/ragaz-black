"""Can the words be heard? Whisper (openai/whisper-small, MIT) as the listener, stage by stage.

    uv run --extra voice python scripts/hear.py out/songs/*.json

Character error rate (CER) of Whisper's transcript against the true words, for each song:
  speech     the TTS saying the lines (the ceiling)
  sung       the sung vocal alone ({song}-vocal.wav)
  mix        the vocal inside the produced track ({song}-sung.wav)
The sung stages are scored against what is sung, in order (the mukhda's return included).
Lower is better; ~0.3 or less reads as understandable, ~1 as no words at all. Whisper-small's
Hindi is itself imperfect: plain TTS speech scores ~0.2.
"""

import json
import os
import re
import sys
from pathlib import Path

import certifi

os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())

import numpy as np  # noqa: E402
from scipy.io import wavfile  # noqa: E402
from scipy.signal import resample_poly  # noqa: E402

_asr = None


def asr():
    global _asr
    if _asr is None:
        from transformers import pipeline

        _asr = pipeline("automatic-speech-recognition", model="openai/whisper-small", device="cpu")
    return _asr


def transcribe(x: np.ndarray, sr: int, lang: str = "hindi") -> str:
    x = resample_poly(x.astype(np.float64), 16000, sr).astype(np.float32)
    out = asr()({"raw": x, "sampling_rate": 16000}, chunk_length_s=30, stride_length_s=4,
                generate_kwargs={"language": lang, "task": "transcribe", "no_repeat_ngram_size": 4, "num_beams": 3})
    return out["text"].strip()


def cer(ref: str, hyp: str) -> float:
    norm = lambda s: re.sub(r"[\s।॥,.!?\-'\"]", "", s.lower())  # noqa: E731
    r, h = norm(ref), norm(hyp)
    d = list(range(len(h) + 1))
    for i, rc in enumerate(r, 1):
        prev, d[0] = d[0], i
        for j, hc in enumerate(h, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (rc != hc))
    return d[len(h)] / max(1, len(r))


def load(path: str) -> tuple[np.ndarray, int]:
    sr, x = wavfile.read(path)
    x = x.astype(np.float64) / 32768
    return (x.mean(1) if x.ndim > 1 else x), sr


if __name__ == "__main__":
    from ragaz.sing import FS, speak_line

    LANG = {"hin": "hindi", "eng": "english"}
    for path in sys.argv[1:]:
        tl = json.loads(Path(path).read_text())
        lang = tl.get("lang", "hin")
        lines = [ln for ln in tl["words"].splitlines() if ln.strip()]
        sung = " ".join(x["syl"] for x in sorted(tl["lyrics"], key=lambda x: x["t"]))
        speech = np.concatenate([np.concatenate([speak_line(ln, lang)[0], np.zeros(int(0.3 * FS))]) for ln in lines])
        stages = {"speech": (speech, FS, " ".join(lines))}
        for name, suffix in [("sung", "-vocal.wav"), ("mix", "-sung.wav")]:
            wav = path.replace(".json", suffix)
            if Path(wav).exists():
                stages[name] = (*load(wav), sung)
        print(Path(path).stem)
        hyp = transcribe(speech, FS, LANG[lang])
        print(f"  speech  CER {cer(' '.join(lines), hyp):.2f}   heard: {hyp[:110]}")
        # The sung stages line by line: each sung run of a line, cut from the track by the timeline.
        lyr = sorted(tl["lyrics"], key=lambda x: x["t"])
        beat = 60 / tl["tempo"]
        runs, cur = [], [lyr[0]]
        for x in lyr[1:]:
            if x["line"] == cur[-1]["line"] and x["k"] == cur[-1]["k"] + 1:
                cur.append(x)
            else:
                runs.append(cur)
                cur = [x]
        runs.append(cur)
        for name in ("sung", "mix"):
            if name not in stages:
                continue
            x, sr, _ = stages[name]
            errs = []
            for run in runs:
                a, b = int(max(0, run[0]["t"] * beat - 0.3) * sr), int((run[-1]["t"] * beat + 1.6) * sr)
                ref = " ".join(y["syl"] for y in run)
                hyp = transcribe(x[a:b], sr, LANG[lang])
                errs.append((cer(ref, hyp), len(ref)))
                print(f"  {name:5} {errs[-1][0]:.2f}  {ref:34} heard: {hyp[:60]}")
            print(f"  {name:5} CER {sum(e * n for e, n in errs) / sum(n for _, n in errs):.2f} (by line)")
