# MD Duck 安装 / Installation

当前准备版本 / Version being prepared: **0.1.0-beta.4**。

## 中文

MD Duck 免费使用。Mac 测试包面向 **Apple Silicon Mac（M 系列芯片）**，包内最低系统声明为 macOS 13；实际验证来自一台 macOS 27 的 Mac，其他系统版本尚未验收。公开下载地址以 [mdduck.com 下载页](https://mdduck.com/download/) 为准，页面显示准备中时，请等待正式提供的文件。

本版有本机 ad-hoc 签名，**没有 Developer ID 签名和 Apple 公证**。首次打开可能被 macOS 拦截，不能将其理解为已通过苹果安全检查的正式版。

### 安装与首次打开

1. 从项目发布页下载 DMG，打开后将 `MD Duck.app` 拖入「应用程序」。复制完成后推出磁盘映像，再从「应用程序」打开。ZIP 是另一种包装：先解压，再把 `.app` 放入「应用程序」。
2. 如果提示无法验证开发者或无法检查恶意软件，在确认下载来源可信、文件未被篡改后，打开「系统设置 → 隐私与安全性」，找到 MD Duck 对应的「仍要打开」，再按系统提示确认。
3. 如果没有「仍要打开」，或提示文件已损坏、会损坏电脑，先停止安装，重新从发布页下载并核对校验值。仍无法打开时，将 macOS 版本、芯片型号和提示文字附在反馈中。

这些步骤只允许这一个应用打开。不需要关闭系统整体的安全检查。苹果官方说明：[在 Mac 上安全地打开 App](https://support.apple.com/zh-cn/102445)。

发布页随安装包提供 SHA-256。需要核对时，在终端运行 `shasum -a 256`，随后输入一个空格，把下载文件拖进终端，再按回车；将结果与发布页上的值比较。校验值用来核对文件一致性，不替代开发者签名或安全审查。

### 开始使用

打开程序后先点「打开示例」，试试对照阅读、点击英文单词查看音标，以及选中一句话写批注。自己的文章可以用「打开文件夹」「打开文件」或拖进窗口打开。

阅读和批注不需要 AI 账户。本地朗读在第一次请求播放时下载约 92 MB 模型，需要网络，之后在本机合成。网络受限时仍可阅读和写批注；首次模型下载链路还在验收，不保证各网络都能完成。

AI 释义和翻译是可选功能，使用你自己选择的服务商和 API 额度。MD Duck 本身免费，服务商可能对请求收费。真实 AI 服务验收仍在进行；成功保存密钥不代表连接或回答质量已经验证。密钥只在程序的设置中填写。

批注、单词和译文进度保存在文章旁的 `.review/`。搬移材料时一起保留这个目录；系统中的应用设置和草稿属于本机资料。升级测试版前请保留文章及 `.review/` 的副本。详细操作见 [中文指南](https://mdduck.com/guide/)。

## English

MD Duck is free to use. The Mac beta targets **Apple Silicon Macs (M-series chips)**. The package declares macOS 13 as its minimum; testing has taken place on one Mac running macOS 27, and other system versions have not been validated. Use the [MD Duck download page](https://mdduck.com/en/download/) for public files. If it says that installers are being prepared, wait for the published files.

The beta has a local ad-hoc signature, **without Developer ID signing or Apple notarization**. macOS may block the first launch. This is not a release that has passed Apple's distribution security checks.

### Install and open

1. Download the DMG from the project's release page. Open it and drag `MD Duck.app` into **Applications**. Eject the disk image after copying, then open the installed app. For a ZIP, unzip it and move the `.app` into **Applications**.
2. If macOS cannot verify the developer or check the app for malicious software, confirm that the download is from a trustworthy source and has not been altered. Open **System Settings → Privacy & Security**, find **Open Anyway** for MD Duck, and follow the confirmation prompts.
3. If **Open Anyway** is unavailable, or macOS says the app is damaged or will damage your computer, stop. Download it again from the release page and compare its checksum. If the problem remains, include your macOS version, chip model and the exact message in your report.

This permits only this app. You do not need to disable system-wide security checks. See Apple's instructions: [Safely open apps on your Mac](https://support.apple.com/en-us/102445).

The release page supplies SHA-256 hashes. To compare a file, type `shasum -a 256` in Terminal, add a space, drag the downloaded file into Terminal and press Return. Compare the output with the release page. A matching checksum confirms file consistency; it does not replace code signing or a security review.

### Start with an article

Choose **Open example** to try side-by-side reading, click an English word for phonetics, and select a sentence to leave a note. Use **Open folder**, **Open a file**, or drag a file into the window for your own articles.

Reading and annotations need no AI account. Local speech downloads about 92 MB of model files when you first request playback, then synthesizes speech on your computer. Reading and annotations remain available if the download cannot finish. First-download network acceptance is still in progress.

AI explanations and translations are optional and use your own provider and API credit. MD Duck is free; the provider may charge for requests. Real-provider acceptance is still in progress. Saving a key alone does not verify a connection or answer quality. Enter API keys only in the app's settings.

Notes, words and translation progress live in the article's nearby `.review/` folder. Keep it with your articles when moving them. App settings and drafts are local to the computer. Keep a copy of your articles and `.review/` before upgrading a beta. See the [English guide](https://mdduck.com/en/guide/).

## Windows 测试构建 / Windows test build

Windows 构建面向 **Windows x64**，目前提供维护者测试安装程序，尚未作为公开下载版本发布。安装程序采用每用户安装，不要求管理员权限；可选择安装位置，并创建开始菜单入口。已有测试版本可安装到相同位置更新，文章及旁边的 `.review/` 保持原位。

正式提供测试文件后，运行文件名含 `Windows-x64-setup` 的 EXE 并按向导安装。文件名含 `portable` 的 EXE 不需要安装，但目前只完成包内容检查，其实际启动和退出清理仍需验收。应用未进行 Windows 发布者签名，系统可能显示来源提示；请核对发布来源与 SHA-256，不要关闭系统防护。校验命令为 `Get-FileHash -Algorithm SHA256 "文件完整路径"`。

The Windows build targets **Windows x64**. Maintainer test installers are being prepared; there is no public Windows download yet. The installer runs per user without administrator privileges, allows a destination folder and creates a Start menu entry. Install updates into the same location; keep your articles and their `.review/` folders together.

When test files are provided, run the EXE whose name includes `Windows-x64-setup` and follow the installer. The `portable` EXE needs no installation, but its launch and cleanup behavior has not yet been accepted; only its packaged payload has been checked. The app has no Windows publisher signature. Verify the download source and SHA-256 if Windows shows a source prompt; do not disable system protection. In PowerShell, use `Get-FileHash -Algorithm SHA256 "full file path"`.
