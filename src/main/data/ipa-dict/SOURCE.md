# Bundled English pronunciation data

Downloaded on 2026-09-28 from [open-dict-data/ipa-dict](https://github.com/open-dict-data/ipa-dict), pinned to commit `43c3570eb3553bdd19fccd2bd0091534889af023` (2025-05-24).

The two UTF-8, tab-separated files are unmodified upstream data:

| File | Entries | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `en_US.txt` | 125927 | 3180267 | `2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67` |
| `en_UK.txt` | 65119 | 1684124 | `221394caef0cf723b4f2df81a98ac33191293257b88aed5b1fb89466d3a0dc77` |

Original URLs:

- https://raw.githubusercontent.com/open-dict-data/ipa-dict/43c3570eb3553bdd19fccd2bd0091534889af023/data/en_US.txt
- https://raw.githubusercontent.com/open-dict-data/ipa-dict/43c3570eb3553bdd19fccd2bd0091534889af023/data/en_UK.txt
- https://raw.githubusercontent.com/open-dict-data/ipa-dict/43c3570eb3553bdd19fccd2bd0091534889af023/LICENSE
- https://raw.githubusercontent.com/open-dict-data/ipa-dict/43c3570eb3553bdd19fccd2bd0091534889af023/README.md

The retained `UPSTREAM-README.md` documents the compilation process: manual and semi-automatic generation, with reference checks where possible. These are precompiled phonemic transcriptions, not live AI output or a guarantee of correctness. Multiple pronunciations are retained without guessing which sense applies. Inflected forms are looked up by exact spelling; an unmatched form is never assigned its lemma's pronunciation.

## Attribution and licenses

- Repository material defaults to MIT: full text retained in `LICENSE`, copyright 2016 dohliam.
- US English is General American data based on [lingz/cmudict-ipa](https://github.com/lingz/cmudict-ipa), with stress markers using [kylebgorman/syllabify](https://github.com/kylebgorman/syllabify); upstream credits identify MIT.
- UK English is Received Pronunciation data derived from [melissaboiko/ipacards](https://github.com/melissaboiko/ipacards), under GPL 3.0. Its full license is retained in `LICENSE-UK-GPL-3.0`, downloaded from `https://raw.githubusercontent.com/melissaboiko/ipacards/master/LICENSE`, SHA-256 `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`.

The upstream project explicitly says third-party datasets retain their original licenses. Therefore UK data is not labelled MIT. Any distribution must retain the applicable notices and data source, including the UK GPL terms.

The app reads these local tables first, returns the matching regional labels and source/license links, and only calls Free Dictionary API if no exact local word exists. The fallback request contains the selected word only, never the reading passage.
