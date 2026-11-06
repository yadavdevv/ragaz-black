// Golden cases for the Python lyric verifier (src/ragaz/lyrics.py): syllables, weights and the
// setter's placements from lib/words.ts, on real pieces. Regenerate: npx tsx scripts/lyrics-golden.ts
import { readFileSync, writeFileSync } from "node:fs";
import { setWords, syllables } from "../lib/words";

const TEXTS = [
  "बुरा जो देखन मैं चला\nबुरा न मिलिया कोय",
  "कमल नयन मनमोहन श्याम",
  "बरसन लागी बदरिया सावन की\nसावन की मनभावन की",
  "जागो मोहन प्यारे\nभोर भई अब जागो",
  "अहं ब्रह्मास्मि",
  "அகர முதல எழுத்தெல்லாம்\nஆதி பகவன் முதற்றே உலகு",
];
const latest = JSON.parse(readFileSync("public/data/latest.json", "utf8"));
const pieces = latest.pieces.filter((_: unknown, i: number) => i % 9 === 0);
const cases = [];
for (const text of TEXTS) {
  const syl = syllables(text);
  for (const p of pieces) {
    const s = setWords(syl, p.notes, p.beats);
    cases.push({
      text, piece: p.id, onsets: p.notes.map((n: { t: number }) => n.t), beats: p.beats,
      syllables: syl.map((x) => [x.text, x.heavy, x.open]),
      starts: s ? s.placements.map((pl) => pl.note) : null, score: s ? s.fit.score : null, mukhdaOnSam: s?.fit.mukhdaOnSam ?? null,
    });
  }
}
writeFileSync("../tests/data/lyrics_golden.json", JSON.stringify(cases));
console.log(`${cases.length} cases`);
