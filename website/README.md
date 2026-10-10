# MD Duck 官网

Astro + TypeScript + CSS 静态网站。站点域名为 `https://mdduck.com`，这是独立于桌面程序的构建项目。

## 本地开发

需要 Node.js 22.12 或更新版本以及 npm。

```sh
npm ci
npm run dev
```

默认地址为 `http://127.0.0.1:4321/`。当前 Astro 的开发服务在后台运行，可以使用 `npx astro dev status`、`npx astro dev logs` 和 `npx astro dev stop` 管理。

```sh
npm run check
npm run build
npm run verify
npm run preview
```

`dist/` 是完整部署产物。网站本身不需要 Node 服务、数据库、账号系统、API Key 或第三方字体服务。

开发服务与生产预览共用 4321 端口。开始开发前，如已有生产预览运行，先执行 `npx astro preview stop`；停止开发服务则使用 `npx astro dev stop`。

## 页面与内容

- 中文页面：`/`、`/guide/`、`/download/`，对应 `src/pages/` 下的页面入口。
- 英文页面：`/en/`、`/en/guide/`、`/en/download/`，对应 `src/pages/en/` 下的页面入口。
- `src/components/HomePage.astro`、`GuidePage.astro`、`DownloadPage.astro`：两种语言共用的首页、指南和下载页面结构。
- `src/layouts/Layout.astro`：共用导航、语言切换、页脚和页面元数据。
- `src/content/guide.md`、`src/content/guide.en.md`：中文与英文指南正文；两份指南使用相同的章节锚点。
- `src/i18n.ts`：语言类型和页面路径转换。
- `/404.html`、`/en/404/`：中文与英文错误页面；实际未知地址的回落行为见部署说明。
- `src/data/release.ts`：唯一的版本号、仓库地址和安装包配置入口。
- `public/examples/a-slower-morning.zip`：原创双语示例，供访客体验对照阅读；当前 JPG 截图展示的是程序内置 Christmas Ribbon 示例。
- `ASSETS.md`：真实程序截图的来源、拍摄条件和限制。

页面右上角的语言入口会打开当前页面的另一语言版本，例如 `/guide/` 对应 `/en/guide/`。站点使用静态链接，不保证保留地址中的片段（如 `#ai-setup`）或当前滚动位置。指南图片和示例 ZIP 由两种语言共用。

当前网站对应 `0.1.0-beta.5` 免费测试版，下载入口面向 Apple Silicon Mac（macOS 13+）和 Windows x64（Windows 10+）。Intel Mac、Windows ARM 和 Linux 暂未提供安装包。Mac 构建使用 ad-hoc 临时签名，没有 Apple Developer ID 签名或苹果公证；Windows 安装包没有发布者签名。中英文指南保留各系统的安装提示，不要求关闭系统安全检查。Mac 安装指导依据 [苹果官方说明](https://support.apple.com/zh-cn/102445)。

项目仓库为 [jslynn777/md-duck](https://github.com/jslynn777/md-duck)，项目许可证为 GPL-3.0-or-later。安装包的发布状态由 `release.status` 控制；在公开文件验收完成前保持 `preparing`，不生成下载按钮。免费程序与第三方 AI 服务额度分别说明，AI 服务按需由用户连接。

发布安装包时，先完成同版本包的测试、签名与第三方许可材料检查，再填写已验证的 `artifacts`（`kind`、名称、系统与芯片、真实 HTTPS 下载 URL、大小、SHA-256）。`kind` 只接受 `mac-dmg` 和 `windows-setup`，中英页面共用同一份文件数据，各自显示对应语言的下载与安装说明。`sourceUrl` 指向同版本的 `MD-Duck-{version}-Corresponding-Source.tar.gz`，在开源区域显示「对应源码与朗读构建材料」链接；准备阶段保留 `null`。安装包及对应源码文件实际公开下载完整并核对校验值后，再将 `status` 改为 `published`。首页和指南的版本状态会同步变化，页面不会自动请求 GitHub 或猜测平台。

「检查整篇」的指南在两种语言中使用同一个 `#pairing-check` 锚点。检查报告段落配对和标记结构问题，行号用于返回对应原文或译文，不自动配对或改写文件，也不保证译文语义准确。

## 部署

参见 [DEPLOYMENT.md](DEPLOYMENT.md)。当前产物可以上传到用户自有服务器；没有创建外部托管项目，也没有改动域名解析。

构建检查覆盖 8 个 HTML 页面：6 个中英文正文页面和 2 个错误页面。验证范围包括文档语言、对应页面的语言切换、站内链接与锚点、静态资源、标题层级、描述和 canonical；6 个正文页面还检查 `zh-CN`、`en`、`x-default` 的 hreflang 与站点地图，错误页面检查 `noindex`。双语发布状态、安装包平台/版本/大小/校验值一致性、指南共享锚点和示例包也纳入检查。安装包可独立部署到服务器的 `downloads/` 目录，构建检查只验证其 URL 和元数据，实际 HTTP 响应、完整字节与哈希由发布步骤验收。这些检查不替代真实服务器上的 HTTPS、域名、404 HTTP 状态与下载验证。
