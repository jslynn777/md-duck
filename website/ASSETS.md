# MD Duck website assets

## Current screenshots

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
