#!/bin/zsh
# v6 pipeline, one job at a time: SFT on real-phrase data, then GRPO from its best checkpoint.
#   nice -n 10 zsh scripts/run_v6.sh            (logs in logs/v6-*.log)
# Resumable: if an SFT run already finished (has checkpoints/best), it is reused.
set -e
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
sft=$(ls -td runs/grpo/v6-sft-* 2>/dev/null | head -1)
if [[ -z "$sft" || ! -d "$sft/checkpoints/best" ]]; then
  echo "== v6 SFT $(date +%H:%M)"
  uv run ragaz sft --config configs/v6-sft.yaml > logs/v6-sft.log 2>&1
  sft=$(ls -td runs/grpo/v6-sft-* | head -1)
fi
echo "== v6 GRPO from $sft/checkpoints/best $(date +%H:%M)"
uv run ragaz train --config configs/v6-grpo.yaml --set init_adapter=$sft/checkpoints/best > logs/v6-grpo.log 2>&1
echo "== done $(date +%H:%M)"
