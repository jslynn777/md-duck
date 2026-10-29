# From AI draft to final copy: read it through in MD Duck

[中文](USAGE.md) · [Mac / Windows walkthrough](https://mdduck.com/en/guide/#quickstart) · [Copy the AI prompts](https://mdduck.com/en/guide/#ai-workflow)

Write with the AI you already use, save the article locally and read it in MD Duck. If a passage feels vague, send a screenshot or copied text to your AI with a specific request. Save the revision and return to read it again. When you are satisfied, publish with your usual tools or an AI authorized to use your CMS, while keeping the article locally.

MD Duck handles reading and review. It does not edit article text or publish to a website. Use bilingual comparison, comments, word lookup and speech when useful. This writing workflow needs no AI key in MD Duck and does not require a particular AI provider.

## Start with one article

1. Create an article library folder on your computer, or use an existing Markdown folder.
2. Add an `article.md` file. For Chinese comparison, put `article.zh.md` in the same directory.
3. In MD Duck, choose **File → Open folder**, select the library and click an article in the sidebar. Use **Open example** if you do not have one ready, or extract the [starter library](https://mdduck.com/examples/md-duck-starter.zip) and open its folder.
4. When a passage needs work, copy the selected text or capture it with your system's screenshot tool. Send it to your AI chat with the article location and a specific request: “This step only says to wait a moment. Explain how to tell when it is ready; leave the other paragraphs unchanged.”
5. Ask the AI to update the original file, or save its complete revised text yourself. Return to MD Duck and reread the changed passage. Check the companion as well if you use two languages.
6. When the article is ready, prepare a CMS draft yourself or use an authorized AI. Check the preview before publishing. Keep the local article and images.

You can also open one ordinary Markdown file. Series folders, translations and block markers are optional. To collect several issues before revising, select text, choose **Note** and save it. Copy comments from the **Notes** panel to your AI, then review the changes and mark addressed comments as done yourself.

## Organize only as much as you need

A few articles can share one folder. Add series folders when the collection grows. MD Duck reads the structure you choose; it does not classify articles automatically or require every article to follow the same layout.

| What you want to do | How to arrange and use the files |
| --- | --- |
| Read one draft quickly | Choose **Open a file**. You do not need to create a library first. |
| Read a few unrelated articles | Keep files such as `ideas.md` and `meeting-notes.md` in one folder and open that folder. |
| Write a series of ten or more articles | Create a series folder such as `01-home-coffee-guide/`. Number article files or subfolders with `01-`, `02-` and so on to show the intended order. |
| Keep images or a Chinese companion | Use one article folder containing `article.md`, optional `article.zh.md` and `assets/`, so they can move together. |
| Revise just one passage | Send a screenshot or excerpt to your AI and request a focused change. Save the same file and continue reading; no new article is needed. |
| Set a completed series aside | Archive it from the article or folder menu, keeping its files and review records. Restore it when needed. |

A series with translations and images can use this layout:

```text
My articles/
  01-buying-guides/
    01-how-to-choose/
      article.md
      article.zh.md
      assets/
        detail.png
    02-prepare-your-files/
      article.md
      article.zh.md
  02-care-guides/
    01-daily-care/
      article.md
```

- **Use an article folder when it has assets or a companion.** Source, translation and assets can travel together. This also gives an AI a clear place to write a series. Text-only articles can live directly inside the series folder.
- **Number folder names for a deliberate order.** The sidebar defaults to natural name order: `02-` comes before `10-`. A standalone `article.md` article uses its article folder name for sorting; its displayed title does not need a number.
- **Use the sidebar sort control.** Choose ascending name, descending name, article title or manual order. In manual order, use the article menu's **Move up / Move down** actions. Changing the sort does not rename files or edit the writing.
- **Other filenames work too.** `notes.md` pairs with `notes.zh.md`; `notes.markdown` pairs with `notes.zh.markdown`. Existing files do not need a naming migration. A single-language article needs no empty companion.
- **Keep images inside the article folder.** Write `![Specific description](assets/detail.png)` and make sure that asset exists. Use `/` in Markdown paths on both Mac and Windows.

Save files as UTF-8. On Windows, show file extensions in File Explorer and check that the name is not `article.md.txt`. Avoid `<>:"/\|?*`, trailing spaces or dots and Windows reserved names such as `CON` in folder names. Chinese folder names are supported.

## Give any AI the same handoff rules

Copy the **Writing prompt** from the app's usage guide or the website guide. Fill in the topic, audience, article count, target folder and language requirements, then send it to the AI you already use.

**An AI with local filesystem access:** provide the exact library folder and ask it to create or edit files there. Require actual saved paths and check results in its completion report.

**An AI in a web chat:** it may not have access to your computer. Ask for each filename followed by a complete code block and save those files yourself. Do not save an entire chat transcript as the article. For revisions, provide the latest complete article, your screenshot or excerpt and the requested change. A screenshot identifies an issue; it does not replace the source file.

**Change just this passage:** copy the website guide's **Screenshot / excerpt revision prompt** and add the image or text, article location and desired result. For example: “This paragraph only says to use enough water and wait a moment. Make the home-brewing instructions actionable, with quantities and a way to judge the result. Keep the voice and change only this paragraph.” The AI should locate it in the latest source, preserve other text and retain existing block IDs. Provide more source text if the screenshot is unclear or the location is ambiguous.

**Address several issues together:** use the **Comment revision prompt** with comments copied from MD Duck. They include quotations and available location details. The AI should locate them in the latest files and edit only the relevant content. Comments are useful for the next review round, but they are optional.

**Publish after confirmation:** use the website's **Publishing handoff prompt**. Supply the final local file, destination site, category and whether this is a new article or an update. Have an authorized AI prepare content or a CMS draft and show a preview. Confirm this publication before it goes live, then have it check the public page and return the actual URL. Without CMS access, it can prepare the material for you to publish manually. MD Duck does not carry out these CMS operations.

## Make the Chinese companion line up reliably

Filenames associate the two documents; block markers establish precise content pairs. Put a marker before each heading, paragraph, image, whole table, quotation block or code block, with a blank line on either side:

`article.md`:

```markdown
<!-- block:intro -->

Read one section at a time.
```

`article.zh.md`:

```markdown
<!-- block:intro -->

一次读一个小节。
```

IDs may use only English letters, digits, hyphens and underscores, such as `intro` or `step-01`. Each must be unique within its document. Both documents should use matching IDs, order and block structure. **Keep an existing ID when revising; add an ID only for new content.**

Mark each top-level list item separately:

```markdown
- <!-- block:check-source --> Check the source.
- <!-- block:check-detail --> Add one useful detail.
```

Use two corresponding list items in Chinese. Give a whole table one marker and keep the same row and column counts on both sides. A single marker before a list does not mark every item.

In bilingual mode, choose **Check whole document** and use problem locations to correct the files in your editor. The check is read-only: it does not pair or rewrite content automatically. Unmarked documents can still be read side by side. Passing the structural check does not establish that the meaning or translation is correct.

## A comfortable daily workflow

1. **Plan the series first.** Ask the AI which question each article will answer so that ten articles do not repeat one topic. Use **+ → Create multiple articles** to prepare drafts when useful, then ask your AI to fill them in.
2. **Keep your writing tool beside MD Duck.** Edit on one side and read the result on the other. Saving external files updates the reader without another import.
3. **Review one section at a time.** Check reasoning and facts before polishing wording. Send your AI a screenshot or copied passage with a concrete request, such as “Add the applicable dimensions and a worked calculation.” Leave comments when you prefer to finish reading before revising several passages.
4. **Choose the view you need.** `1` selects English, `2` Chinese and `3` comparison. Adjust text size in the reading options. Speech and word lookup can help; AI explanations and translations remain optional.
5. **Alternate revision and review.** After the AI saves, reread the changed passage in MD Duck. Check its companion if there is one. If you used comments, review those marked **Check again** and confirm them yourself. The AI's completion report describes its work; you still review the result.
6. **Publish and keep your files.** Once the text is final, publish in your CMS or delegate to an AI with access. Check the live result and keep the final local text and assets. Archive a series when you no longer need it in the main list; restore it from **Archived** later. To keep the first draft and every revision, save copies before rewriting or use version control.

## Find the articles your AI just changed

1. When saved source or translation text differs, the article shows **Updated** in the sidebar, with a count on its folder. Select **Updated** to filter the current **All** or **Archived** list while keeping your chosen order.
2. Open the article and select **View changes** to compare the last confirmed text with the current version. Use previous and next to review each change, or locate it in the article.
3. After reading, select **Mark as viewed** to make the current text the starting point for the next comparison. Opening an article does not clear its marker or resolve its comments.

The first record establishes a starting point without marking existing content as changed. Comparison records stay local and keep only the most recently confirmed version. Use separate copies or version control to keep every revision.

## Mac and Windows controls

| Action | Mac | Windows |
| --- | --- | --- |
| Open an article library | `⌘ O` | `Ctrl O` |
| Open a single file | `⇧ ⌘ O` | `Ctrl Shift O` |
| Copy the selected passage | `⌘ C` | `Ctrl C` |
| Capture part of the screen | `⇧ ⌘ 4` | `Win Shift S` |
| Paste into an AI chat | `⌘ V` | `Ctrl V` |
| Save the comment being edited | `⌘ Enter` | `Ctrl Enter` |
| Open settings | `⌘ ,` | `Ctrl ,` |
| Comment on selected text | `Option Enter` | `Alt Enter` |
| System file manager | Finder | File Explorer |
| Article management menu | Right-click, or the article's **…** | Right-click, or the article's **…** |

Both systems use the same article, translation and marker rules. In the shortcuts above, Mac `⌘` corresponds to Windows `Ctrl`, and `Option` to `Alt`. Reading shortcuts such as `1 / 2 / 3`, `B` and `Esc` apply when you are not typing into a field.

Mac screenshots save as files by default: drag the file into your AI chat, or hold `Control` while capturing to copy it to the clipboard. On Windows, paste after capturing. The AI you use must support image input; otherwise, copy the text instead.

## Organizing and backing up

Renaming, moving and archiving in the app changes the actual local files. Prefer the article or folder's **…** menu for these operations. A standalone article folder is handled with its companion, assets and associated records. A conflicting destination is not overwritten. For articles using shared assets outside their folder, follow the prompt to organize the complete containing folder.

When organizing files outside MD Duck, move complete folders where possible. If the app cannot establish an article's identity, follow its prompt to check the association. Do not delete hidden `.review/` or `.mdduck/` folders as cleanup.

For a backup or transfer, copy the **entire article library, including hidden folders**. `.review/` contains review and word data; `.mdduck/` contains library management information and change comparison records. Application settings, reading positions, unsaved comment drafts and AI configuration live separately on the current computer. Copying only the library does not transfer these local settings: save comment drafts before switching computers and configure the new installation as needed.

See the [download page](https://mdduck.com/en/download/) for installers and platform requirements, and the [full guide](https://mdduck.com/en/guide/) for troubleshooting and network behavior.
