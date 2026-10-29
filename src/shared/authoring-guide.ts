import type { UiLang } from './types'

/** Shared by the desktop help and website so their copyable rules stay identical. */
export const AUTHORING_FOLDER_EXAMPLE = `My articles/
  01-reading-series/
    01-first-review/
      article.md
      article.zh.md
      assets/
    02-revise-and-check/
      article.md
      article.zh.md`

/** A complete pair with no network or image dependencies, also checked by the parser. */
export const AUTHORING_EXAMPLE = {
  source: `<!-- block:title -->

# A calmer review

<!-- block:intro -->

Read one section at a time. Copy a passage or take a screenshot when a sentence needs work.

<!-- block:steps -->

## Two small steps

- <!-- block:check-meaning --> Check whether the sentence says what you mean.
- <!-- block:check-detail --> Ask for an example when an explanation feels vague.

<!-- block:review-table -->

| Step | Result |
| --- | --- |
| Review | A passage with a specific revision request |
| Revise | An updated Markdown file |

<!-- block:finish -->

Return to the article after saving the revision. Read the changed sentence again. If you left a comment, mark it as done after checking.
`,
  zh: `<!-- block:title -->

# 从容地审阅

<!-- block:intro -->

一次读一个小节。遇到需要修改的句子，就复制这段文字或截一张图。

<!-- block:steps -->

## 两个小步骤

- <!-- block:check-meaning --> 检查这句话是否表达了你真正想说的意思。
- <!-- block:check-detail --> 解释不够具体时，请补充一个例子。

<!-- block:review-table -->

| 步骤 | 结果 |
| --- | --- |
| 审阅 | 一段原文和具体的修改要求 |
| 修改 | 更新后的 Markdown 文件 |

<!-- block:finish -->

修改保存后回到文章，重新读一遍改过的句子。如果留过批注，确认后再标记为完成。
`
} as const

export function getAuthoringPrompt(language: UiLang): string {
  if (language === 'zh') return `主题：[填写主题]
读者与用途：[填写目标读者、阅读后要做的事]
篇数与顺序：[例如 10 篇，先给出系列目录]
文章库位置：[填写我指定的本地文件夹；不知道时先问我]
语言：[英文原稿 + 简体中文对照；也可改为只写单语]

请按下面的 MD Duck 规则写作。我会用自己的 AI 或编辑器写文件，在 MD Duck 中阅读，把需要修改的段落截图或复制给你，也可以集中整理成批注。MD Duck 直接读取本地 Markdown 文件，不需要导入数据库，也不要求你连接它的 API。正文由你或我的编辑器修改；MD Duck 不负责正文编辑或发布到网站。

1. 文件存放
- 几篇零散的纯文字文章可以直接放在文章库根目录，例如 ideas.md、meeting-notes.md，不必每篇建文件夹。文章多了按系列分子文件夹；有译文或图片时，推荐每篇一个独立文件夹，便于一起整理。MD Duck 不会自动给文章分类，沿用我指定的组织方式。
- 一个系列、每篇独立文件夹的示例：
${AUTHORING_FOLDER_EXAMPLE}
- 用 01-、02- 等序号表示系列和篇目顺序。按名称排序时，独立 article.md 文章使用所在文章文件夹的名称；正文标题可以自由表达，不必加序号。
- article.md 是英文原稿，article.zh.md 是同目录的中文稿。也支持 topic.md + topic.zh.md，以及 topic.markdown + topic.zh.markdown。单语文章只需一份 Markdown，不生成空译文。
- 使用 UTF-8 保存，扩展名必须是真的 .md 或 .markdown，不要变成 .md.txt。文件夹名要能在 Mac 和 Windows 使用；避免 <>:"/\\|?*、结尾空格/句点，以及 CON、PRN、AUX、NUL、COM1、LPT1 等系统保留名。
- 图片放在这篇文章的 assets/ 内，Markdown 写相对路径，例如 ![图的具体说明](assets/detail.png)。即使在 Windows，Markdown 图片路径也用 /。只引用实际存在、已获准使用的素材；没有图片时省略，不编造图片链接。不要使用本机绝对路径。

2. 双语与定位标记
- 两份稿子逐块对应：标题层级、段落分组、列表项顺序和嵌套、表格行列、图片位置一致；译文准确自然，不靠凑段落数量配对。
- 每个标题、普通段落、图片、整张表格、引用块或代码块前放一个独立标记，标记前后各空一行。示例：
<!-- block:intro -->

This is the first paragraph.

中文对应处使用相同的 <!-- block:intro -->，后接中文段落。
- ID 只能使用英文字母、数字、连字符和下划线，例如 intro、step-01；在每一份文档中唯一，两份稿子使用相同 ID 和顺序。不要用中文 ID，不要把实际标记包进代码围栏。
- 每个顶层列表项分别标记，写法为：
- <!-- block:check-source --> Check the source.
- <!-- block:check-detail --> Add one useful detail.
中文列表保留相同 ID、项目顺序和列表结构。列表前只有一个标记不会覆盖所有列表项。
- 修改已有内容时保留原 ID；新增内容才用新 ID，并同步对应译文。不要为重新排序而重编所有 ID。
- 普通无标记 Markdown 也能阅读；这里的标记用于可靠的双语对应和批注定位。结构配对通过不等于内容或翻译正确。

3. 交付和自查
- 只能写入我指定的文章文件夹。新建时如果目标已存在，先报告冲突，不覆盖旧稿。不要改动 .review/、.mdduck/、批注、词汇记录或应用设置，也不要移动/删除其他文件。
- 如果你能访问文件系统，就直接保存文件并报告实际路径；如果不能，就按“相对文件路径 + 完整代码块”分别输出，让我保存，不能声称已经写入本机。代码块外的说明不要混进文章正文。
- 完成后核对：文件名配对、素材存在、ID 无重复/遗漏、两侧 ID 顺序与块结构一致。报告实际检查结果、待确认的事实及素材来源；不要虚构检查通过。
- 我会在 MD Duck 打开这个文章库，需要修改时，把截图、摘录或批注和具体要求交给你。你修改并保存后，我回到 MD Duck 重新阅读；有双语稿时用“检查整篇”核对结构，使用过批注时再手动确认完成。发布是另一步，等我审阅通过并明确授权后再处理。`

  return `Topic: [fill in the topic]
Audience and purpose: [who will read this and what they should be able to do]
Article count and order: [for example, 10 articles; propose the series outline first]
Library location: [the local folder I specify; ask if you do not know it]
Languages: [English source + Simplified Chinese companion; or specify a single language]

Write for this MD Duck workflow: I write files with my preferred AI or editor, read in MD Duck, then send you a screenshot or copied passage with a revision request. I can also collect comments for a batch of changes. MD Duck reads local Markdown files directly. There is no database import or MD Duck API connection to set up. You or my editor change the text; MD Duck does not edit article text or publish to a website.

1. Store the files
- A few standalone text articles can live directly in the library root, such as ideas.md and meeting-notes.md; they do not each need a folder. Group a larger collection by series. An individual article folder is useful when it has a translation or images, so they can move together. MD Duck does not classify articles automatically; follow the organization I specify.
- Example of a series with one subfolder per article:
${AUTHORING_FOLDER_EXAMPLE}
- Prefix series and article folders with 01-, 02-, and so on for a deliberate order. Name sorting uses the article folder name for a standalone article.md article. The displayed article title does not need a number.
- article.md is the English source and article.zh.md is its Chinese companion in the same folder. topic.md + topic.zh.md and topic.markdown + topic.zh.markdown also work. A single-language article needs only one Markdown file; do not create an empty companion.
- Save as UTF-8 with a real .md or .markdown extension, not .md.txt. Use Mac- and Windows-compatible folder names: avoid <>:"/\\|?*, trailing spaces or dots, and reserved names such as CON, PRN, AUX, NUL, COM1 and LPT1.
- Put images inside this article's assets/ folder. Use relative Markdown paths such as ![Specific image description](assets/detail.png), with / even on Windows. Reference only existing assets that we are allowed to use. Omit images when none are available; do not invent image links or use machine-specific absolute paths.

2. Pair the languages and keep stable markers
- Match the heading levels, paragraph grouping, list item order and nesting, table dimensions and image positions in both documents. Translate naturally and accurately; equal paragraph counts alone do not establish a pair.
- Before each heading, ordinary paragraph, image, whole table, quotation block or code block, put a marker on its own line with a blank line before and after. Example:
<!-- block:intro -->

This is the first paragraph.

Use the same <!-- block:intro --> before the corresponding Chinese paragraph.
- IDs may contain only English letters, digits, hyphens and underscores, such as intro or step-01. Each ID must be unique within a document; use the same IDs in the same order in both documents. Do not put real markers inside code fences.
- Mark every top-level list item separately, using this syntax:
- <!-- block:check-source --> Check the source.
- <!-- block:check-detail --> Add one useful detail.
Keep the same IDs, item order and list structure in Chinese. A single marker before a list does not mark every item.
- Keep existing IDs when revising. Add a new ID only for new content and update its companion as well. Do not renumber all IDs to change the reading order.
- Ordinary unmarked Markdown is readable too. These markers support precise bilingual pairing and comment location. A structurally complete pair does not prove the writing or translation is correct.

3. Deliver and check
- Write only inside the article folder I specify. When creating files, report any existing destination before overwriting it. Do not modify .review/, .mdduck/, comments, word records or application settings, or move/delete unrelated files.
- If you have filesystem access, save the files and report their actual paths. Otherwise, return each relative filename followed by a complete code block for me to save; do not claim to have written local files. Keep delivery notes outside the article body.
- Check companion filenames, asset existence, missing/duplicate IDs, ID order and block structure on both sides. Report what you actually checked, any facts still needing confirmation and asset sources. Do not invent successful checks.
- I will open this folder in MD Duck and send you screenshots, excerpts or comments with specific revision requests. After you save the changes, I will reread them in MD Duck, use “Check whole document” when there is a bilingual pair, and confirm any comments myself. Publishing is a separate step after my review and explicit authorization.`
}

/** For the direct screenshot / copy-and-paste workflow; annotations are optional. */
export function getExcerptRevisionPrompt(language: UiLang): string {
  if (language === 'zh') return `文章位置：[填写文件路径；或在下方提供最新全文]
需要修改的段落：[粘贴原文，或附上截图并说明标题和前后文]
我希望怎么改：[例如补清楚操作步骤、用量和一个具体例子，保持原来的语气]

这是我在 MD Duck 阅读时发现的问题。请修改原来的文章文件，MD Duck 只用来查看保存后的结果。

- 先读取最新原稿，根据摘录或截图及上下文找到这一段。截图文字不清楚、位置不唯一或缺少原稿时，先向我要原文或位置，不要猜测。
- 只处理上述要求，保留其他内容。不要为了“优化”重写整篇，也不要编造事实或素材。已有对应译文时，同步改动含义受影响的部分。
- 保留已有 <!-- block:... --> ID、文件名和图片相对路径；新增块才使用新 ID，并同步译文中的 ID 与结构。不要修改 .review/、.mdduck/、批注状态或应用设置。
- 有本地文件权限时保存到原位置并报告实际路径；没有权限时，基于我提供的最新全文，按“文件名 + 完整替换内容”输出，由我保存。没有全文时先索取，不要把一个片段冒充完整文件。
- 简要列出改了哪里、改前改后的差别和仍需我确认的事项。我会回到 MD Duck 重新阅读。不要自动发布文章。`
  return `Article location: [file path, or provide the latest complete article below]
Passage to revise: [paste the text, or attach a screenshot with its heading and surrounding context]
What I want changed: [for example, make the steps, quantities and one practical example clearer; keep the existing voice]

I found this issue while reading in MD Duck. Revise the original article file; I use MD Duck to read the saved result.

- Read the latest source and locate this passage using the excerpt or screenshot and its context. If the screenshot is unclear, the location is ambiguous or the source is unavailable, ask for the text or location instead of guessing.
- Address only the request above and preserve the rest. Do not rewrite the entire article to “improve” it or invent facts or assets. If a companion translation exists, update the parts whose meaning changes.
- Preserve existing <!-- block:... --> IDs, filenames and relative image paths. Assign new IDs only to new blocks and keep the companion's IDs and structure in sync. Do not modify .review/, .mdduck/, comment status or application settings.
- With local filesystem access, save at the original location and report actual paths. Without access, use the latest complete text I provide and return each filename with its complete replacement content for me to save. Ask for the full text if missing; do not present a fragment as a complete file.
- Briefly explain what changed, the before/after difference and anything I still need to confirm. I will reread the result in MD Duck. Do not publish the article automatically.`
}

/** Publishing belongs to an external tool with access to the user's destination. */
export function getPublishingPrompt(language: UiLang): string {
  if (language === 'zh') return `已审阅的本地稿件：[填写最终文章路径和所需语言]
目标网站与后台：[填写网站地址和后台；不在这里填写密码或密钥]
发布要求：[标题、栏目、已有文章链接或新建、图片和其他要求]

我已在 MD Duck 阅读过这份稿件。现在请帮我准备发布；MD Duck 本身不连接后台，也不发布文章。

1. 先确认你能读取最终稿，并已获得目标后台的操作权限。没有本地或后台权限时，说明缺少什么，提供我能手动执行的交付内容；不要声称已经登录或发布。
2. 核对目标网站、语言和是新建还是更新已有文章，避免重复创建或覆盖别的文章。以本地最终稿和已确认素材为准，保留正文、图片说明和链接；需要调整时先说明，不擅自改写。
3. 准备可审阅的发布内容或后台草稿，展示标题、正文、图片、栏目、链接和拟发布状态。先给我预览，等我明确确认本次发布后，再执行公开发布；不要仅因为稿件已定稿就直接上线。
4. 发布后实际打开公开页面，核对文字、图片与链接，报告真实网址和发布结果。预览、保存草稿、提交发布和已公开要区分；未确认上线时不要声称已发布。
5. 保留本地文章、对应译文和素材，不删除或覆盖本地留存，也不修改 .review/、.mdduck/、批注或应用设置。将发布结果单独告诉我，不混入文章正文。`
  return `Reviewed local manuscript: [final article path and required language]
Destination website and CMS: [site URL and administration area; do not put passwords or keys here]
Publishing requirements: [title, category, existing article URL or new article, images and other requirements]

I have reviewed this manuscript in MD Duck. Help me prepare it for publication. MD Duck itself does not connect to a CMS or publish articles.

1. Confirm that you can read the final manuscript and are authorized to use the destination CMS. If local file or CMS access is missing, explain what is needed and provide a handoff I can carry out manually. Do not claim to have signed in or published.
2. Verify the site, language and whether this is a new article or an update. Avoid duplicates or overwriting another article. Use the final local manuscript and approved assets, preserving text, image descriptions and links. Explain any necessary adjustments before changing the writing.
3. Prepare reviewable publishing content or a CMS draft. Show the title, body, images, category, links and intended publication state. Give me a preview and wait for my explicit confirmation of this publication before making it public. A finalized manuscript alone is not permission to publish.
4. After publishing, open the public page and check its text, images and links. Report the actual URL and result. Distinguish preview, saved draft, submitted publication and publicly available content; do not claim a live publication without checking it.
5. Keep the local manuscript, companion translation and assets. Do not delete or overwrite this local copy, or modify .review/, .mdduck/, comments or application settings. Report the publication result separately from the article body.`
}

export function getRevisionPrompt(language: UiLang): string {
  if (language === 'zh') return `文章位置：[填写 article.md 所在文件夹]
修改范围：[只处理以下批注；补充其他要求]
以下是从 MD Duck 复制的审阅意见：
[在这里粘贴批注]

请先读取指定位置的最新原稿、已有的对应中文稿及我提供的批注，按块 ID、引用和上下文定位，不要只凭旧引用猜测。找不到或意见冲突时说明情况，先保留该处。

- 只修改这些意见涉及的内容；有中文稿且英文含义改变时同步中文，保持标题层级、段落、列表、表格及对应 ID 一致。单语文章不必新增译文。
- 保留已有 <!-- block:... --> ID。新增块才增加唯一 ID；不要重新编号、批量改名或无故删掉标记。需要合并、拆分或删除块时，保留能对应原意的 ID，并列出新增/移除的 ID 供我复核。
- 保持现有文件名、文章位置和图片相对路径。不要动 .review/、.mdduck/、批注状态、词汇记录或设置，不要自动替我把批注标记完成。
- 有文件权限时保存实际修改；没有权限时按“相对文件路径 + 完整替换内容”输出，明确由我保存。不要声称已经写入本机。
- 最后逐条说明修改了什么、哪些意见未处理及原因；有双语稿时核对两份稿子的 ID 和结构。不要把说明写进正文。我会回到 MD Duck 重新阅读修改处，有双语稿时检查整篇，再确认批注完成。`
  return `Article location: [the folder containing article.md]
Revision scope: [address the comments below; add any other requirements]
Review comments copied from MD Duck:
[paste the comments here]

Read the latest source, its Chinese companion if present, and the comments I provide. Locate each target by its block ID, quotation and context, rather than guessing from an old quotation. Report missing targets or conflicting instructions and leave those passages unchanged for now.

- Change only the content addressed by these comments. Update an existing Chinese companion when the English meaning changes, preserving corresponding headings, paragraphs, lists, tables and IDs. A single-language article does not need a new translation.
- Keep existing <!-- block:... --> IDs. Give only new blocks new unique IDs; do not renumber, bulk-rename or remove markers without a reason. If a block must be split, merged or deleted, retain the ID that still matches the original meaning and list added/removed IDs for my review.
- Keep filenames, article locations and relative image paths. Do not touch .review/, .mdduck/, comment status, word records or settings. Do not mark comments as done on my behalf.
- Save actual changes if you have filesystem access. Otherwise, return each relative filename with its complete replacement content and clearly ask me to save it; do not claim to have written local files.
- Finish with a comment-by-comment change summary, any unaddressed comments and why, and checks of IDs and structure when there are two documents. Keep this summary out of the article body. I will return to MD Duck, reread the changes, check the whole bilingual pair if present and confirm completed comments.`
}
