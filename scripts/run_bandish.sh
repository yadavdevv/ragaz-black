#!/bin/zsh
# Bandish composer, one job at a time: SFT from the v6 composer's best checkpoint, then GRPO.
#   nice -n 10 zsh scripts/run_bandish.sh        (logs in logs/bandish-*.log)
setopt nullglob
set -e
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=2 MKL_NUM_THREADS=2
composer=(runs/grpo/v6-grpo-*(/om[1]))
[[ -d "$composer/checkpoints/best" ]] || { echo "no v6 composer checkpoint"; exit 1; }
sft=(runs/grpo/bandish-sft-*(/om[1]))
if [[ -z "$sft" || ! -d "$sft/checkpoints/best" ]]; then
  echo "== bandish SFT from $composer/checkpoints/best $(date +%H:%M)"
  uv run ragaz bandish-sft --config configs/bandish-sft.yaml --set init_adapter=$composer/checkpoints/best > logs/bandish-sft.log 2>&1
  sft=(runs/grpo/bandish-sft-*(/om[1]))
fi
echo "== bandish GRPO from $sft/checkpoints/best $(date +%H:%M)"
uv run ragaz bandish-train --config configs/bandish-grpo.yaml --set init_adapter=$sft/checkpoints/best > logs/bandish-grpo.log 2>&1
echo "== done $(date +%H:%M)"
