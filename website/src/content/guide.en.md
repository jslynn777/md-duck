<h2 id="install">Install on Mac</h2>

MD Duck is free to use. The first beta, `0.1.0-beta.2`, is for Apple Silicon Macs. The package requires macOS 13 or later; testing has taken place on one Mac running macOS 27. Public installers are still being prepared; see [Downloads](/en/download/) for files and checksums. Intel Macs, Windows and Linux have not been validated.

Once an installer is published, open the DMG, drag MD Duck into **Applications**, then launch it from **Applications**. For a ZIP, extract it first and move MD Duck into **Applications**.

### Does macOS block the first launch?

This beta has no Apple Developer ID signature or notarization. If you are certain the file came from this project's release links and has not been altered, follow [Apple's official instructions](https://support.apple.com/en-us/102445) to allow this app:

1. Try opening MD Duck, then open **System Settings → Privacy & Security**.
2. Find the notice for MD Duck and click **Open Anyway**.
3. Click **Open** when asked again, and authenticate if prompted.

If **Open Anyway** is unavailable, or the alert says the app is damaged or will damage your computer, stop the installation. Download it again, compare its checksum with the release, and report the exact alert. A Mac managed by an organization may require its administrator's help.

<h2 id="open">Open your first article</h2>

Choose **Open folder** or **Open a file** in MD Duck, or drop a Markdown file into the window. After opening a folder, select an article from the list on the left.

For a first look, choose **Open example**. You can also download the [bilingual sample article](/examples/a-slower-morning.zip), unzip it, and open `article.md`.

Keep using your preferred editor to change the text. MD Duck refreshes the reading view when you save. Use **Typography** to adjust text size, and **Settings** to change the interface language.

<h2 id="bilingual">Read the original alongside its translation</h2>

Use **English**, **Chinese**, or **Side by side** in the toolbar to switch views. If you already have a Chinese translation, place both files in the same folder with matching names:

```text
notes.md          Original
notes.zh.md       Chinese translation
```

The same rule works for `.markdown`: pair `notes.markdown` with `notes.zh.markdown`. If your translation has a different name, click **Choose a translation** in the missing-translation notice and select a file from the current folder.

### No translation yet?

After you [connect your own AI service](#ai-setup), an article without a Chinese version offers **Generate Chinese translation**.

1. Click the translation option, check the service and model, then choose **Start translation**. The article is sent to that service in sections, using your account credit.
2. Click **Stop** whenever you need to pause. Completed sections stay on your computer, ready to resume after reopening the app.
3. When it finishes, click **Open side by side**. The translation is saved as a separate Chinese Markdown file. The original stays intact, and existing translations are not overwritten.

You can read without connecting AI. When you want a translation, click **Chinese** or **Side by side**, then choose an existing file or connect a service.

### Match paragraphs across two drafts

AI-generated translations save their paragraph alignment automatically. For translations you prepare yourself, add the same marker before matching paragraphs:

```markdown
<!-- block:morning -->
On Saturday, I leave my phone at home.
```

```markdown
<!-- block:morning -->
星期六，我把手机留在家里。
```

Give each pair a different marker name. Use **Copy convention** in Settings to share these instructions with the person or AI preparing your article. Files without matching markers can still be read in two columns, but their paragraphs will not align precisely.

<h2 id="notes">Leave a note where a change is needed</h2>

Select a sentence, choose **Note**, write your comment, and save. Open **Notes** in the toolbar to see the article’s comments together.

- Click a quotation to return to its English or Chinese source.
- Click the pencil to edit a comment. Unfinished changes are kept as local drafts.
- Copy one comment or all open comments to pass to an editor or AI tool.
- After the text changes, review comments marked **Check again** and confirm what has been resolved.

Notes are saved beside the article, without changing its text. Continue unfinished comments from **Drafts** in the notes panel. If local draft storage is unavailable, closing the app lets you return to save the note or explicitly discard unsaved drafts.

<figure class="guide-figure">
  <a href="/images/notes.jpg" target="_blank" rel="noopener" aria-label="View the full annotation screenshot">
    <img src="/images/notes.jpg" width="1320" height="860" alt="The MD Duck notes panel beside an article, showing quoted text and the related review comments." loading="lazy" />
  </a>
  <figcaption>Keep the quotation with your comment. Click a note to return to the text.</figcaption>
</figure>

<h2 id="words">Understand a word without leaving the article</h2>

Click an English word to see available phonetic transcriptions and pronunciation tips. **Say the word**, **Slowly**, and **Say the sentence** help you listen in context. You will need to [prepare the voice model](#speech) before the first playback.

With AI connected, the word card explains what the word means in that sentence. Choose **More about this word** for usage, examples, common phrases, and memory aids. Successful contextual explanations are saved with the original sentence in the article’s word list.

You can also select a phrase or passage and choose **Translate**. AI explanations and translations can be wrong, so check important meanings against the source.

Contextual AI explanations currently use Chinese.

<h2 id="speech">Listen, then read it again</h2>

Move the pointer beside a paragraph and click its read-aloud button, or listen to a word or sentence from the word card. Choose a voice and speed in Settings. Press `Esc` to stop.

Speech uses the Kokoro model on your computer. It needs an internet connection for its first download; preparation starts only when you first request playback, rather than when you open the app. Once ready, speech is synthesized locally. British and American phonetic transcriptions are provided for reference; playback uses the voice selected in Settings.

<h2 id="ai-setup">Connect your own AI service</h2>

MD Duck itself is free. Reading, annotations, and local speech with a prepared model do not need an AI key. For contextual explanations, passage translation, or a full Chinese translation, open **Settings → AI service** and choose a connection method. Your own provider account covers any API charges.

### OpenRouter: connect in your browser

Click **Connect OpenRouter in browser**, sign in and authorize on the provider’s page, then return to MD Duck. The app tests the connection automatically. Alternatively, create a key on the [OpenRouter keys page](https://openrouter.ai/keys) and paste it into the app.

### DeepSeek: paste an API key

Create a key on the [DeepSeek platform](https://platform.deepseek.com/api_keys) and check that your account has API credit. Select DeepSeek in MD Duck, paste the key, click **Save settings**, then **Test connection**. The API URL and a default model are already filled in.

### Another provider: enter a compatible endpoint

Choose **Custom service (OpenAI compatible)** and paste your key. In **Advanced settings**, enter the API base URL and model name, then save the settings and test the connection separately. The endpoint must support OpenAI Chat Completions. Leave `/chat/completions` out of the base URL.

**Wait for a successful connection test before using AI features.** Each service keeps its own configuration; save after switching providers. Leaving the key field blank preserves its saved key. Use **Remove this service’s key** to clear it.

Requests use your own service account credit. Even the short connection test may incur a small charge. A chat subscription may not include API credit. If a test fails, check the key, credit, model, or network as indicated, then try again.

<h2 id="privacy">Where your files stay, and what goes online</h2>

Your articles stay on your computer. MD Duck reads them from your folder and saves notes, word explanations, and translation progress in a nearby `.review/` directory. App settings and annotation drafts are also stored locally.

| Feature | Network activity |
| --- | --- |
| Reading and annotations | No article upload is required. Remote images in an article are loaded from their original URLs. |
| Phonetic lookup | Uses the local word list first. If a word is missing, sends the word to Free Dictionary API. |
| AI explanations and passage translation | Sends the selected text and necessary context to your chosen service. |
| Full-article translation | After you confirm, sends the article text to the selected AI service in sections. |
| English speech | Downloads the model initially, then synthesizes speech locally. |
| Connecting an AI service | Sends a short test message. Browser authorization opens the provider’s page and completes through a local callback. |

API keys are encrypted through the operating system’s secure storage and kept on your computer. They are never displayed back in the interface. The app reports an error if it cannot save a key securely. Removing a key in MD Duck only removes its local copy; revoke the key on the provider’s platform if needed.

This website has no sign-in, forms, or analytics scripts. Server access logs depend on the hosting configuration.

<h2 id="faq">When something needs attention</h2>

### Why is there no Chinese translation in the reading view?

Check the filenames first, such as `notes.md` and `notes.zh.md`. You can also use **Choose a translation** to link a file manually. For precise paragraph alignment, check that matching content has matching block markers.

### Why can I see phonetics but no explanation?

Phonetics can come from the local word list. An AI explanation for the current sentence needs a working service connection. Use **Save settings**, then **Test connection** in Settings, resolve any reported issue, then retry.

### Do I have to start over after a translation stops?

You can resume saved progress when the source text, service URL, and model are unchanged. Changing the source or configuration starts a new translation to avoid mixing old results into it. Existing translation files are not overwritten.

### Why is speech still preparing?

The first use downloads and loads the voice model. The time needed depends on your connection and computer. You can keep reading and writing notes while it prepares.

### How do I keep my notes when moving an article?

Keep the article’s `.review/` directory with it. Move the source, translation, and `.review/` together: relative links and saved translation progress remain usable when the source and configuration are unchanged. Moving only some files requires linking again. After renaming an article, preview and explicitly link its former notes and words from the new article; original records are preserved.

### What if a note fails to save?

Check the folder’s write permissions and the original file’s location. Keep the draft and retry. You can also copy your comment elsewhere; do not discard the draft after a failed save.

### Can I download it now? Which systems are supported?

The first beta, `0.1.0-beta.2`, is for Apple Silicon Macs. Public installers are still being prepared. Intel Macs, Windows and Linux have not been validated. See [Downloads and releases](/en/download/) for files, tested macOS versions and release status, or read the [Mac installation steps](#install) before your first install.
