# Kokoro voice data and text normalization

These five voice style arrays are copied without modification from the integrity-verified `kokoro-js@1.2.1` npm archive. They are the same American and British voices previously selectable in MD Duck. `SOURCE.json` records the exact upstream commit, archive integrity, and per-file SHA-256 hashes. The upstream Apache-2.0 license is preserved in `LICENSE`.

`src/main/kokoro-runtime-phonemize.js` is derived from the upstream `kokoro.js/src/phonemize.js` at commit `664c76a704021239ba59c84dcbaa4d3dece01fe9`. Text normalization and punctuation/phoneme postprocessing are unchanged; its only runtime change is importing the independently source-built eSpeak phonemizer.
