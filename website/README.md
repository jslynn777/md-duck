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

当前版本为 `0.1.0-beta.2`，按免费 Apple Silicon Mac 测试版准备发行。构建使用 ad-hoc 临时签名，没有 Apple Developer ID 签名或苹果公证；中英文下载页和指南说明了首次打开的系统提示及允许此程序的步骤。安装指导依据 [苹果官方说明](https://support.apple.com/zh-cn/102445)，不要求关闭系统安全检查。

目前没有经过公开下载验收的安装包 URL 或已确认的项目仓库地址，因此 `release.status` 保持 `preparing`，不生成虚假的下载或 GitHub 链接。免费程序与第三方 AI 服务额度分别说明，AI 服务按需由用户连接。

发布安装包时，填写已验证的 `artifacts`（名称、系统与芯片、真实下载 URL、大小、SHA-256），再把 `status` 改为 `published`。确认项目仓库及许可证后填写 `repositoryUrl`，并同步调整下载页中的开源说明、平台说明与描述元数据。页面不会自动请求 GitHub 或推断平台支持情况。

## 部署

参见 [DEPLOYMENT.md](DEPLOYMENT.md)。当前产物可以上传到用户自有服务器；没有创建外部托管项目，也没有改动域名解析。

构建检查覆盖 8 个 HTML 页面：6 个中英文正文页面和 2 个错误页面。验证范围包括文档语言、对应页面的语言切换、站内链接与锚点、静态资源、标题层级、描述和 canonical；6 个正文页面还检查 `zh-CN`、`en`、`x-default` 的 hreflang 与站点地图，错误页面检查 `noindex`。双语发布状态、指南共享锚点和示例包也纳入检查。这些检查不替代真实服务器上的 HTTPS、域名、404 HTTP 状态与下载验证。
