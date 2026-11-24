# MD Duck 空间示例 / Spaces examples

这是一套可自由试用的公开演示文章。解压到你打算长期保留的位置，再用 MD Duck 打开。本包没有个人文章、批注记录、AI 密钥或应用设置。

This package contains public demonstration articles. Extract it to a location you want to keep, then open it in MD Duck. It contains no private articles, review history, AI keys or application settings.

## 中文：先体验三种整理方式

| 文件夹 | 建议空间名称 | 体验内容 |
| --- | --- | --- |
| `Daily Drafts` | 日常草稿 | 三篇独立 Markdown，直接放在同一目录，适合随手记录。 |
| `Series Guides` | 系列指南 | 按顺序编号的文章文件夹；第一篇包含英文、中文译文和自己的素材图。 |
| `Bilingual Review` | 双语审阅 | 询价修改案例与丝带示例，原稿和译文成对存放，丝带配图放在 `assets/`。 |

### beta.10：添加三个空间

1. 解压 ZIP，保留上述三个文件夹及里面的结构。
2. 点击阅读器右上角的空间入口，再点“添加文件夹”。
3. 分别添加 `Daily Drafts`、`Series Guides`、`Bilingual Review`，在“管理空间”里按上表重命名。
4. 通过右上角列表切换。每个空间保留自己的阅读文章与位置；在“管理空间”中可以看到三个入口。

请分别添加这三个子文件夹，不要同时把外层 `md-duck-spaces` 也添加为空间，避免目录重叠。空间名称只影响界面显示，不会重命名你的本地文件夹。

### 跟着新版截图试

打开 `Bilingual Review/01-clearer-product-inquiry/article.md`，先读一遍，让 MD Duck 建立比较起点。点「交给 AI」：可复制「其他 AI 的空间说明」到常用对话，或在已安装并登录 Codex CLI 后填写本地任务。两种方式都先核对当前文章，再补充要求，例如「把 Make the request useful 这一段写具体，同步中文，未知信息用占位符」。

AI 不能直接访问文件时，由你把返回内容保存回原文件。有修改后，用「有改动」找到文章，点击「查看改动」，检查原文和译文后再「标为已查看」。需要完全按演示复制修改前后内容，可再下载官网的 `md-duck-workflow.zip`，按其中 README 使用 `snapshots/after/`。

任务完成、标为已查看与发布是不同的步骤。确认满意后，才用自己的后台或获得授权的 AI 发布。本包不会连接后台。

### 使用 beta.7

beta.7 可以正常读取这些 Markdown、译文和图片，但没有空间切换功能。使用“打开文件夹”一次打开其中一个目录，需要换一类文章时再打开另一个。空间切换从 beta.10 提供，beta.7 没有这些按钮。

### 试一次完整的审阅

打开 `Series Guides/01-writing-workflow/article.md`，先读原文，再切换中文或对照。把想改的一段复制给你使用的 AI，例如：

> 请把“Read first”这一节写得更具体，补一个修改前后的例子，同步更新同目录的中文译文。保留其他段落、图片相对路径和已有 block 标记。能访问本地文件时保存回原文件；不能访问时请给我可手动保存的内容。

如果使用支持空间功能的版本，可以复制“其他 AI 的空间说明”来告诉 AI 当前目录和目标文章。本示例不包含固定的空间标识或本机打开链接；这些信息由你自己的 MD Duck 生成。

AI 保存后回到 MD Duck 检查文章。是否接受内容、何时发布，由你决定。MD Duck 直接读取本地文件，文件不需要先上传或导入专有格式。

## English: try three ways to organize your writing

| Folder | Suggested space name | What to try |
| --- | --- | --- |
| `Daily Drafts` | Daily drafts | Three standalone Markdown files in one folder, for everyday notes. |
| `Series Guides` | Series guides | Numbered article folders; the first article includes an English original, a Chinese translation and its own image. |
| `Bilingual Review` | Bilingual review | A product-inquiry revision case and a ribbon article, with paired translations and a local ribbon image in `assets/`. |

### Beta.10: add three spaces

1. Extract the ZIP and keep the three folder structures intact.
2. Open the space control at the top right of the reader and choose **Add folder**.
3. Add `Daily Drafts`, `Series Guides` and `Bilingual Review` separately. Use **Manage spaces** to give each a clear display name.
4. Switch between them from the top-right list. Each space keeps its own article and reading position; **Manage spaces** shows all three entries.

Add the three child folders separately. Do not also add their outer `md-duck-spaces` folder: the roots would overlap. Renaming a space changes its display name, not its local folder name.

### Follow the updated screenshots

Open `Bilingual Review/01-clearer-product-inquiry/article.md` and read it first to establish a comparison baseline. Choose **Give to AI**: copy **Instructions for other AI** to your usual conversation, or prepare a local task after installing and signing in to Codex CLI. Check the current article, then ask for a concrete revision, for example: “Make the Make the request useful paragraph specific. Update Chinese too. Use placeholders for unknown facts.”

If your AI cannot access files, save its returned content to the original files yourself. Filter changed articles and choose **View changes**. Check the original and translation, then **Mark as viewed**. For ready-made before-and-after files, download `md-duck-workflow.zip` from the website and follow its README for `snapshots/after/`.

Task completion, marking as viewed and publication are separate steps. After reviewing, publish using your own backend or an authorized AI. This package connects to no backend.

### Using beta.7

beta.7 can read these Markdown files, translations and images, but does not provide space switching. Use **Open folder** to open one example folder at a time, then open another when needed. Space switching is available in beta.10; those controls are not included in beta.7.

### Try a complete review

Open `Series Guides/01-writing-workflow/article.md`. Read the original, then switch to Chinese or the bilingual view. Copy a paragraph into your preferred AI conversation with a request such as:

> Make the “Read first” section more specific with a before-and-after example, and update the Chinese translation in the same folder. Preserve the other sections, relative image paths and existing block markers. If you can access the local files, save to the original files; otherwise provide text I can save manually.

In a version that supports spaces, **Instructions for other AI** supplies the current folder and article. This download deliberately contains no fixed space IDs or machine-specific open links: your own MD Duck generates those.

After the AI saves, return to MD Duck to review the article. You decide whether to accept the content and when to publish it. MD Duck reads the local files directly; no proprietary import or article upload is required.

## 文件约定 / File conventions

- `article.md`：原文 / original article.
- `article.zh.md`：同目录的中文译文 / Chinese companion in the same folder.
- `assets/`：该篇文章的素材图，使用相对路径 / article images, referenced with relative paths.
- `<!-- block:... -->`：保留已有标记，便于持续审阅 / preserve existing markers for continuing review.

示例来源：日常草稿、写作指南和流程插图为本项目的原创公开演示；丝带文章与 `bow.png` 来自 MD Duck 仓库已有公开示例。包内没有 `.review/`、`.mdduck/`、用户 profile 或应用配置。

Sources: the daily drafts, writing guides and workflow illustration are original public examples for this project. The ribbon article and `bow.png` come from the existing public examples in the MD Duck repository. No `.review/`, `.mdduck/`, user profile or application configuration is included.

示例文章及原创图片依 GPL-3.0-or-later 提供，见 LICENSE。 / Example articles and original images are provided under GPL-3.0-or-later; see LICENSE.
