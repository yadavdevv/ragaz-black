import Link from "next/link";
import { FloralBand, Rosette } from "./Ornament";

export function Footer() {
  return (
    <footer className="night-sky relative text-paper">
      <FloralBand tone="night" />
      <div className="mx-auto max-w-[1400px] px-6 pb-28 pt-20 sm:px-10">
        <div className="flex items-center gap-5">
          <Rosette size={30} />
          <div className="font-display text-[clamp(72px,14vw,220px)] leading-[0.85] text-paper">ragaz</div>
        </div>
        <div className="mt-12 grid gap-10 border-t border-paper/15 pt-10 font-sans text-[14.5px] leading-[1.65] text-paper/65 sm:grid-cols-3">
          <div className="flex flex-col gap-2 text-[15px]">
            {[["/listen", "Listen"], ["/ragas/bhupali", "Ragas"], ["/compose", "Compose"], ["/instruments", "Instruments"], ["/docs", "Docs"]].map(([h, l]) => <Link key={h} href={h} className="text-paper hover:text-gulal">{l}</Link>)}
          </div>
          <p>Qwen3-0.6B with LoRA, trained with reinforcement learning (GRPO) and supervised fine-tuning on a MacBook. Every piece here was written by it and is sung by your browser from its notation.</p>
          <p>Reference recordings: CompMusic Indian Art Music Raga Recognition Dataset (features), Gulati et al., CC BY 4.0. The newest model's sung voice is a DDSP model trained on vocal tracks of 12 women singers from Saraga Carnatic (CC BY-NC-SA 4.0). Ragamala paintings: The Metropolitan Museum of Art (CC0), Rijksmuseum (public domain), Victoria and Albert Museum (non-commercial). Bandish texts: Surdas, Kabir, Bihari and Rahim from public-domain editions, transcribed by Hindi Wikisource contributors (CC BY-SA 4.0). Raga rules from standard Bhatkhande descriptions, not yet reviewed by a musician.</p>
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-paper/15 pt-8 font-sans text-[15px] text-paper/65">
          <p>Made by <a href="https://github.com/yadavdevv" target="_blank" rel="noreferrer" className="text-paper hover:text-gulal">yadavdevv</a></p>
          <div className="flex items-center gap-8">
            <a href="https://github.com/yadavdevv/ragaz" target="_blank" rel="noreferrer" className="text-paper hover:text-gulal">GitHub ↗</a>
            <a href="https://www.linkedin.com/in/devesh-yadav-nnl" target="_blank" rel="noreferrer" className="text-paper hover:text-gulal">LinkedIn ↗</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
