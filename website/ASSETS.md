# MD Duck website assets

## Original screenshots (retained)

The website uses captures of the installed `0.1.0-beta.2` app from the product review on 2026-10-04. The review used an independent empty profile, the app's built-in Christmas Ribbon example, a Chinese interface and dark appearance. No AI service was connected. Conditions and limits are recorded in `../product-review-20261004/notes.md`.

- `public/images/reading.jpg`: 1320 × 860, copied from `../product-review-20261004/screenshots/02-bilingual.jpg`. Shows the actual side-by-side reading view and article list.
- `public/images/notes.jpg`: 1320 × 860, copied from `../product-review-20261004/screenshots/04-annotation.jpg`. Shows a saved sample comment and its quoted text in the actual notes panel.

Both website files are byte-for-byte copies of those captures. Their SHA-256 values are:

```text
reading.jpg  f0d90068d1bcd39c5df21700776c577a13ed7278eb75b579812d991e69dd57e9
notes.jpg    1c3cd54fd9f1a3407e8597bee477d1680bd971270aecbfa6ce03294e1adc96b3
```

The screenshots retain the macOS capture indicator visible at the top left. It belongs to the capture environment. These images show reading and annotation behavior; they do not demonstrate a successful AI request or speech playback, and do not establish public-release readiness. Both languages use the same screenshots and link to the full image.

## Brand and downloadable sample

- `public/images/duck.png` is the existing project brand asset from `../assets/logo-mark.png`.
- `public/examples/a-slower-morning.zip` contains only `article.md` and `article.zh.md`, an original English essay and its Chinese translation. This downloadable sample is different from the Christmas Ribbon article in the current screenshots.
- Screenshot harnesses, temporary profiles and `.review/` records are not included in the downloadable sample or site assets.

## Earlier captures

`public/images/reading.png` and `public/images/notes.png` are earlier 1280 × 800 light-appearance captures made on 2026-09-28. They remain in the source tree but are no longer selected by the homepage or guide.

Those earlier images were native `webContents.capturePage()` output from a temporary harness running the compiled app with an independent profile. They showed the original morning essay, not the current Christmas Ribbon example. The harness did not alter the app's DOM or styles. It cancelled renderer HTTP/HTTPS requests and stopped the speech child process; the captures were not AI or speech acceptance evidence.

## Editorial website design (2026-10-26)

The selected website direction uses warm paper, serif headings and red proof marks. The existing logo and the original, unmodified application screenshots remain the product imagery.

- `public/images/editorial/decoration.png`: original transparent red botanical line illustration, created with the built-in ImageGen tool from the selected visual direction.
- `public/images/editorial/underline.png`: original transparent red proof underline, generated independently with ImageGen.
- `public/images/editorial/proof-arrow.png`: original transparent red annotation arrow, generated independently with ImageGen.

The proof marks are website decorations, not evidence that the pictured application supports handwritten annotations. Website text explains the actual selection and comment workflow.

Headings use a self-hosted, public-copy subset of [Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC), distributed under SIL OFL 1.1. The license and source attribution are in `public/fonts/OFL.txt` and `public/fonts/README.txt`. `scripts/prepare-editorial-font.py` can refresh the subset when public site copy changes; regular builds and page visits do not contact a font service.

`public/examples/md-duck-starter.zip` is the current two-article practice library. Both languages share its article pairs, local illustration assets, instructions and GPL license. Its deterministic build is `scripts/build-starter.mjs`.

## Practical workflow and library scenarios (2026-10-26)

The homepage and guided workflow now use seven 1440 × 940 JPEG captures in `public/images/workflow/`: `read-before`, `selection`, `read-after`, `flat-library`, `series-library`, `article-assets`, and `archive-library`.

These are genuine `webContents.capturePage()` images of the installed `0.1.0-beta.6` application's unmodified main entry, preload and renderer, hosted by local Electron with an independent profile and fictional example library. The installed archive SHA-256 was `6f2982a36146b3cfb088372759e94c66c2f81857e27762e012f8728968f3480e`. No personal library, AI key, external AI request, speech session or CMS was used. PNG originals and capture reports live in `../verification/workflow-demo-20261026/`. The selection used real Chromium mouse events; the revised view followed an actual file write and watcher refresh. Both versions passed the application's 8 / 8 structure check. Archive verification confirmed unchanged source, translation and image hashes and a preserved saved comment.

The screenshots were captured on Mac. Windows instructions cover the shared file workflow and relevant shortcuts, and do not claim Windows screen capture evidence. The folder examples are manually prepared, not automatically categorized by MD Duck. Original local SVG illustrations are reused from the project's starter library.

`public/media/md-duck-workflow-{zh,en}.mp4` are 90-second, 1920 × 1080 captioned, silent walkthroughs assembled from these actual captures. They are explicitly labeled as arranged screenshot demonstrations, not continuous recordings. All added instructional text is outside the captured application. AI revision requests and publication handoff are instructional examples; no article was sent to a live backend. Matching `.txt` transcripts and `.vtt` captions accompany the videos. The manual production script is `scripts/build-workflow-video.py` (Pillow and ffmpeg); ordinary website builds simply use the existing media. `public/images/workflow/video-poster.jpg` is the first instructional frame.

`public/examples/md-duck-workflow.zip` is the matching practical library: loose drafts, two categorized series with local images, and a before/after revision case. Open the extracted `library/` in the reader; reference snapshots and instructions stay outside it. It includes bilingual instructions, prompts and a GPL license, without app profiles or hidden review data. `scripts/build-starter.mjs md-duck-workflow` creates the deterministic archive.
