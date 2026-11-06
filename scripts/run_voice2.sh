#!/bin/zsh
# Voice v2, one job at a time (run under caffeinate): wait for the fetch, separate the vocals
# (Demucs), prepare segments (pitch, loudness), train the DDSP voice on 3 s crops with a mel loss.
#   caffeinate -i nice -n 10 zsh scripts/run_voice2.sh      (logs: logs/voice2-*.log)
set -e
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 PYTORCH_ENABLE_MPS_FALLBACK=1
while pgrep -f "fetch_hindustani_vocal.py fetch" >/dev/null; do sleep 30; done
uv run --extra voice python scripts/fetch_hindustani_vocal.py fetch >> logs/voice2-fetch.log 2>&1   # finishes any missing file
echo "== separate $(date +%H:%M)"
uv run --extra voice python scripts/fetch_hindustani_vocal.py separate > logs/voice2-separate.log 2>&1
echo "== prepare $(date +%H:%M)"
[[ -f data/voice-hvocal/segments.npz ]] || uv run --extra voice python -m ragaz.ddsp prepare hvocal data/external/saraga_hindustani/vocals 15 > logs/voice2-prepare.log 2>&1
echo "== train $(date +%H:%M)"
uv run --extra voice python -m ragaz.ddsp train 15000 hvocal 3 8 > logs/voice2-train.log 2>&1
echo "== done $(date +%H:%M)"
