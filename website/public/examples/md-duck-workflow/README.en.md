# One local space. A complete review.

This local practice library works on Mac and Windows. It contains 11 short bilingual articles: one revision example, four loose drafts and two three-article series about product inquiries and editorial review.

MD Duck reads and reviews local Markdown files. Your AI or editor writes and revises them. An external tool with your separate authorization can handle publishing.

## Add the practice folder as a space

1. Extract the download first. Use Finder on Mac or “Extract All” in Windows File Explorer.
2. In MD Duck choose File → Open Folder: `Command O` on Mac or `Ctrl O` on Windows. If you already have a space open, use the top-right space name → Add folder….
3. **Select the `library` folder inside this package.** Reference snapshots and these instructions sit outside the library so they will not appear as duplicate articles.
4. In Manage spaces, rename this space “Review practice”. This changes its display name, not the folder on disk.
5. Open `A clearer product inquiry`, choose side-by-side reading and let it finish loading. **Open the original before saving a revision** so there is a baseline to compare against. Reading, selecting text and commenting require no AI key in MD Duck.

The main example is in `library/01-clearer-product-inquiry/`. It contains `article.md` and `article.zh.md`. Four loose draft pairs sit at the library root. `02-产品询价系列` and `03-写作审阅系列` contain three articles each, with each article's source, translation and `assets` folder kept together. `snapshots/before/` and `snapshots/after/` are reference copies of the main inquiry example, outside the live library.

## 1. Make a vague passage useful

Find this sentence:

> Tell the supplier what you need and ask for a quote.

It does not explain which details the reader should provide. Select and copy it to your AI, or capture the relevant part of the screen. Copy with `Command C` on Mac or `Ctrl C` on Windows. Capture an area with `Shift Command 4` on Mac or `Win Shift S` on Windows. Paste the passage or screenshot into your AI chat and add a specific request:

> This is too vague. Explain how the product, size, quantity, delivery city and preferred arrival date help a supplier quote. Do not invent specifications, quantities or dates. Read the latest source and Chinese companion in the folder I specify. Revise only the request-details block, update both languages and keep its existing block ID. If you cannot access local files, return the replacement text instead of claiming that you saved it.

Choose the handoff that suits you:

- **Your usual external AI:** in the current article, choose Give to AI → Instructions for other AI → Copy instructions. Paste those instructions with the request and passage or screenshot. An AI with file access saves to the original two files. With a chat-only AI, supply the latest complete source and save its full revision yourself.
- **Local Codex:** install and sign in to Codex CLI on this computer first; Windows also needs Codex sandbox setup. In Give to AI, check Working folder and Include current article, then enter the request and choose Start local task. Review any approval requests and answer its questions. Use Stop task or Take over when needed. These controls only affect the task started by MD Duck and do not undo already saved changes.

After saving, return to this space: select Updated in the sidebar, open the article and choose View changes. Compare the original and translation, then explicitly Mark as viewed. Merely opening an article leaves its update marker in place. Check whole document checks bilingual markers and structure; it does not judge factual accuracy, rewrite your text or automatically pair the article.

You can practice without connecting AI: **open the original as described above first**, then replace the two corresponding files in `library/01-clearer-product-inquiry/` with the copies in `snapshots/after/`. Do this only in your practice copy. Both versions retain the same eight block IDs; only `request-details` changes.

## 2. Use loose drafts or series folders

The four loose drafts demonstrate a simple starting point: put Markdown files in a folder and read them. The two series demonstrate a structure you choose and create yourself. These are real local folders. MD Duck does not infer topics or automatically organize your writing.

For a longer series, ask your AI for an outline first, then save one article per folder. Keep each article's translation and images with it. Use the full writing rules on the website for filenames, relative images and stable bilingual markers.

### Add separate spaces when projects grow

The two series in this practice library can share one space. For unrelated clients or projects, use independent local folders and add each as a space. Switch by name at the top right; each resumes its own article, reading position and preferences. Do not register both a folder and its parent as overlapping spaces.

For a ready-made three-folder example, download https://mdduck.com/examples/md-duck-spaces.zip. A space is a folder entry point: it does not duplicate articles or upload them. Copy or sync the complete folders yourself when moving between computers.

A submitted Codex task keeps its original working folder when you switch to read another space. When giving an external AI a new project, copy that target space’s instructions again.

## 3. Keep images and review work with the article

Open `Define the product first`. Its two illustrations load from the article's own `assets/morning.svg`. This is an original illustration, not a product photograph or evidence of specifications. Each of the other series articles also has its own local illustration.

Add and save a comment, then choose Archive from the article's management menu and confirm. Archiving moves actual local files. Open the article in Archived and check the source, translation, images and comment. Try Restore afterwards. Nothing in the downloadable library is pre-archived.

Using the app may create hidden `.review` and `.mdduck` folders. Keep them when backing up the whole library and do not ask your AI to rewrite them. After substantial revisions, check comments that need relocation or confirmation.

## 4. Hand off publication separately

After your review, an external AI or publishing tool needs access to the intended backend and your explicit authorization for that publication. Check the destination draft first, confirm publication separately, then open the public URL and compare the title, text and images. `PROMPTS.en.txt` contains a handoff example. This practice package performs no backend publication and connects to no account.

Keep the local source, translation and images. Saving a backend draft, publishing a public page and archiving in MD Duck are separate actions.

Full guide: https://mdduck.com/en/guide/

The example articles and reused original MD Duck SVG illustrations use GPL-3.0-or-later; see `LICENSE`. Website walkthrough screenshots show the actual Mac beta.10 interface with an independent practice library. The workflow also applies to Windows, with different file-manager names and shortcuts.
