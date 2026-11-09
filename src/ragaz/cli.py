"""ragaz command line.

    ragaz ragas
    ragaz verify examples/yaman.txt --raga yaman
    ragaz render examples/yaman.txt --raga yaman -o yaman.wav --play
    ragaz baseline --model mlx-community/Qwen3.5-0.8B-bf16 --n 50
    ragaz train --config configs/grpo-0.8b.yaml [--set steps=50 lr=3e-5]
    ragaz train --resume runs/grpo/<run>
    ragaz distill --adapter runs/grpo/<track-a run>/checkpoints/best
    ragaz sft --config configs/track-b-sft.yaml
"""

import argparse
import subprocess
import sys
from pathlib import Path

from ragaz.notation import extract
from ragaz.ragas import get_raga, load_ragas


def read_notation(path: str) -> str:
    text = sys.stdin.read() if path == "-" else Path(path).read_text()
    return extract(text) if "```" in text else text


def main() -> None:
    parser = argparse.ArgumentParser(prog="ragaz")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("ragas", help="list known ragas")

    p_verify = sub.add_parser("verify", help="score notation against a raga")
    p_verify.add_argument("file", help="notation file, or - for stdin")
    p_verify.add_argument("--raga", required=True)

    p_render = sub.add_parser("render", help="render notation to a WAV file")
    p_render.add_argument("file", help="notation file, or - for stdin")
    p_render.add_argument("--raga", required=True)
    p_render.add_argument("-o", "--out", help="output WAV (default: <file>.wav)")
    p_render.add_argument("--tempo", type=float, default=100, help="beats per minute (100: our median note then lasts ~0.21 s, the real median)")
    p_render.add_argument("--sa", type=float, default=261.63, help="Sa frequency in Hz")
    p_render.add_argument("--play", action="store_true", help="play with afplay (macOS)")
    p_render.add_argument("--expressive", action="store_true", help="real glides and wavers learned from recordings")
    p_render.add_argument("--voice", choices=["violin", "vocal", "hvocal"], help="learned DDSP instrument (needs a trained voice run); hvocal = Hindustani vocals (v2)")

    p_base = sub.add_parser("baseline", help="sample from a model and score it")
    p_base.add_argument("--model", default="mlx-community/Qwen3.5-0.8B-bf16")
    p_base.add_argument("--n", type=int, default=50, help="samples per raga per variant")
    p_base.add_argument("--variants", nargs="+", default=["bare", "hinted"])
    p_base.add_argument("--temp", type=float, default=0.8)
    p_base.add_argument("--out", default="runs/baseline")
    p_base.add_argument("--batch", type=int, default=8, help="sequences generated at once (lower = less memory)")
    p_base.add_argument("--memory-gb", type=float, default=6, help="cap on MLX memory")

    p_train = sub.add_parser("train", help="GRPO training with LoRA on MLX")
    p_train.add_argument("--config", help="YAML config (see configs/)")
    p_train.add_argument("--set", nargs="*", default=[], metavar="KEY=VALUE", help="override config values")
    p_train.add_argument("--resume", help="run directory to resume from its latest checkpoint")

    p_distill = sub.add_parser("distill", help="collect good hinted compositions for SFT")
    p_distill.add_argument("--model", default="mlx-community/Qwen3-0.6B-bf16")
    p_distill.add_argument("--adapter", help="LoRA checkpoint dir (e.g. a Track A run's checkpoints/best)")
    p_distill.add_argument("--ragas", nargs="+", default=["bhupali", "yaman", "malkauns"])
    p_distill.add_argument("--per-raga", type=int, default=200, help="samples generated per raga")
    p_distill.add_argument("--min-reward", type=float, default=0.85)
    p_distill.add_argument("--max-per-raga", type=int, default=120, help="cap kept pieces per raga (keeps classes balanced)")
    p_distill.add_argument("--out", default="data/distilled.jsonl")
    p_distill.add_argument("--style", default="v1", help="reward style used to score pieces (v1..v6)")
    p_distill.add_argument("--bars", type=int, default=8, help="bars asked for (16 = sthayi + antara)")
    p_distill.add_argument("--rhythm", action="store_true", help="v5 rhythm prompt (quick runs and held notes)")
    p_distill.add_argument("--variant", default="hinted", choices=["hinted", "bare"])
    p_distill.add_argument("--batch", type=int, default=8, help="sequences generated at once")
    p_distill.add_argument("--memory-gb", type=float, default=5)

    p_bsft = sub.add_parser("bandish-sft", help="bandish composer (words + notes): supervised fine-tuning")
    p_bsft.add_argument("--config", required=True)
    p_bsft.add_argument("--set", nargs="*", default=[], metavar="KEY=VALUE")
    p_btrain = sub.add_parser("bandish-train", help="bandish composer: GRPO against the bandish reward")
    p_btrain.add_argument("--config")
    p_btrain.add_argument("--set", nargs="*", default=[], metavar="KEY=VALUE")
    p_btrain.add_argument("--resume")

    p_sft = sub.add_parser("sft", help="supervised fine-tuning on distilled compositions")
    p_sft.add_argument("--config", required=True)
    p_sft.add_argument("--set", nargs="*", default=[], metavar="KEY=VALUE")

    args = parser.parse_args()

    if args.command == "distill":
        from ragaz.distill import distill

        distill(args.model, args.adapter, args.ragas, args.per_raga, Path(args.out), args.min_reward, args.max_per_raga, batch=args.batch, memory_gb=args.memory_gb, style=args.style, bars=args.bars, rhythm=args.rhythm, variant=args.variant)
        return

    if args.command == "bandish-sft":
        from ragaz.bandish_train import bandish_sft

        bandish_sft(args.config, args.set)
        return

    if args.command == "bandish-train":
        from ragaz.bandish_train import bandish_train

        bandish_train(args.config, args.set, args.resume)
        return

    if args.command == "sft":
        from ragaz.sft import sft

        sft(args.config, args.set)
        return

    if args.command == "train":
        from ragaz.trainer import train

        train(args.config, args.set, args.resume)
        return

    if args.command == "baseline":
        from ragaz.baseline import run_baseline

        run_baseline(args.model, args.n, args.variants, Path(args.out), temp=args.temp, batch=args.batch, memory_gb=args.memory_gb)
        return

    if args.command == "ragas":
        for r in load_ragas().values():
            print(f"{r.key:<10} {' '.join(sorted(r.notes, key='SrRgGmMPdDnN'.index)):<15} vadi {r.vadi}, samvadi {r.samvadi} · {r.time}")
        return

    raga = get_raga(args.raga)
    text = read_notation(args.file)

    if args.command == "verify":
        from ragaz.verify import verify

        print(verify(text, raga).explain())
    elif args.command == "render":
        from ragaz.render import render, write_wav

        out = args.out or (Path(args.file).with_suffix(".wav") if args.file != "-" else Path("out.wav"))
        write_wav(out, render(text, raga, sa_hz=args.sa, tempo=args.tempo, expressive=args.expressive, voice=args.voice))
        print(f"wrote {out}")
        if args.play:
            subprocess.run(["afplay", str(out)], check=False)


if __name__ == "__main__":
    main()
