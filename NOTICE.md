# Licences and credits

The **code** in this repository is under the MIT licence (`LICENSE`). Several other things in it,
and the model, are **not** MIT: they keep the licences of what they came from.

| What | Where | Licence |
|---|---|---|
| Code | `src/`, `scripts/`, `tests/`, `web/` (except the folders below) | MIT, © 2026 Devesh Yadav |
| The released model (Qwen3-0.6B with the ragaz LoRA merged) | [Hugging Face: dev-y/qwen3-0.6b-grpo-indian-classical-ragaz](https://huggingface.co/dev-y/qwen3-0.6b-grpo-indian-classical-ragaz) | CC BY-NC 4.0 for the ragaz changes; the Qwen3-0.6B base stays Apache-2.0 (`licenses/Qwen3-Apache-2.0.txt`) |
| Recordings | `web/public/audio/` | CC BY-NC-SA 4.0: sung by a voice trained on Saraga (CC BY-NC-SA 4.0) |
| Site data derived from concert pitch tracks | `web/public/data/` (profiles, reader, real singers' lines) | CC BY 4.0, from the CompMusic dataset below |
| Ragamala paintings | `web/public/art/` | Each painting's own licence, listed below |

## Datasets

- **Indian Art Music Raga Recognition Dataset (features)**: S. Gulati, J. Serrà, K. K. Ganguli, S. Şentürk, X. Serra. Zenodo, 2016. [doi:10.5281/zenodo.7278506](https://doi.org/10.5281/zenodo.7278506). CC BY 4.0. Pitch tracks and tonic annotations only (no audio) are used: the real-music reward, the raga reader, the expression library, the real singers' lines. Its authors ask that these papers be cited:
  - S. Gulati, J. Serrà, K. K. Ganguli, S. Şentürk, X. Serra. *Time-delayed melody surfaces for rāga recognition.* Proc. 17th International Society for Music Information Retrieval Conference (ISMIR), New York, 2016, pp. 751–757.
  - S. Gulati, J. Serrà, V. Ishwar, S. Şentürk, X. Serra. *Phrase-based rāga recognition using vector space modeling.* Proc. 41st IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP), Shanghai, 2016, pp. 66–70.
- **Saraga: research datasets of Indian Art Music**, v1.5: B. Bozkurt, A. Srinivasamurthy, S. Gulati, X. Serra. Zenodo, 2020. [doi:10.5281/zenodo.4301737](https://doi.org/10.5281/zenodo.4301737). CC BY-NC-SA 4.0. Hindustani concert mixes, vocals separated with Demucs, train the voice behind the recordings; Carnatic vocal and violin stems trained earlier voices. Non-commercial and share-alike, so the voice and the recordings are too.
- **Hindi Wikisource** transcriptions of public-domain editions (CC BY-SA 4.0): Surdas, Kabir, Bihari, Rahim, used only for the bandish (words) experiments, not on the site.

## Models and tools

- **Qwen3-0.6B** (Apache-2.0): Qwen Team, *Qwen3 Technical Report*, arXiv:2505.09388, 2025. The released model is a modified version: LoRA weights trained with GRPO and supervised fine-tuning were merged into it.
- **MLX / mlx-lm** (MIT), Apple: training and inference on Apple silicon.
- **GRPO**: Z. Shao et al., *DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models*, arXiv:2402.03300, 2024. **LoRA**: E. Hu et al., arXiv:2106.09685, 2021.
- **DDSP**: J. Engel, L. Hantrakul, C. Gu, A. Roberts, *DDSP: Differentiable Digital Signal Processing*, ICLR 2020 (our own PyTorch implementation).
- **Demucs** (MIT): S. Rouard, F. Massa, A. Défossez, *Hybrid Transformers for Music Source Separation*, ICASSP 2023 (htdemucs), to separate vocals.
- **Fonts**: Tiro Devanagari Hindi and Newsreader (SIL Open Font License), served by Google Fonts.

## Paintings (`web/public/art/`)

| Raga | Painting | Museum | Licence |
|---|---|---|---|
| Malkauns | Malkos Raga, c. 1640–50 | The Metropolitan Museum of Art | Public domain (CC0) |
| Bhupali | Bhupala Raga, c. 1750 | Rijksmuseum, Amsterdam | Public domain |
| Deshkar | Vilaval Ragini, c. 1680 | The Metropolitan Museum of Art | Public domain (CC0) |
| Yaman | Kalyan Ragini, c. 1830 | Victoria and Albert Museum, London | © V&A, non-commercial use, with credit |
| Bhairav, Todi, Madhuvanti (stand-in), Bihag (stand-in), Darbari, Miyan Malhar | Ragamala folios | The Cleveland Museum of Art | Public domain (CC0) |
| Marwa (stand-in), Basant | Ragamala folios | The Metropolitan Museum of Art | Public domain (CC0) |
| Shuddh Sarang | Ragini Saranga, c. 1800 | Honolulu Museum of Art (photo via Wikimedia Commons) | Public domain |
| `garland/` (front page) | Folios 1630–1714 | The Metropolitan Museum of Art | Public domain (CC0) |

Every painting's title, date, accession and source link is on the site (Docs → Images) and in `web/lib/art.ts`.

## Raga rules

From standard Bhatkhande descriptions (notes, vadi and samvadi, pakad, hour). Not yet reviewed by a musician.
