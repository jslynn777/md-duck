# MD Duck 免费测试版打包

当前版本为 **0.1.0-beta.4**，目标是 **macOS Apple Silicon（arm64）和 Windows x64 免费测试版**。项目选择暂不购买 Apple Developer Program。打包配置保留 ad-hoc 签名，未使用 Developer ID 签名、未提交 Apple 公证（notarization），也未启用 hardened runtime。产物名称暂保留 `local-test`；许可与安装验收完成后才能开放下载，不能宣传为苹果认可的正式版。用户安装说明见 [INSTALLING.md](INSTALLING.md)。

本文记录现有命令与验证范围，不代表 DMG 挂载、安装或其他尚未完成的检查已经通过。命令均在项目根目录执行。

## 准备与构建

在 macOS arm64 环境安装 Node.js/npm，并使用项目锁文件安装依赖：

```bash
npm ci
npm run typecheck
npm test
```

当前锁定 `electron-builder` 为 `26.15.3`，通过 override 使用 `sharp 0.35.5`。不要手动删改依赖锁文件来绕过打包或原生模块错误。

仅生成可直接启动的 `.app`：

```bash
npm run pack:mac
```

此命令依次构建主进程、预加载脚本与界面，生成第三方声明，再执行 `electron-builder --mac --arm64 --dir --publish never`。应用输出位置为：

```text
release/mac-arm64/MD Duck.app
```

生成 DMG、ZIP 和校验清单：

```bash
npm run dist:mac
```

`dist:mac` 同样先构建和生成第三方声明，随后打包 DMG/ZIP，并运行 `scripts/checksums.mjs`。当前版本的目标文件名是：

```text
release/MD-Duck-0.1.0-beta.4-macOS-arm64-local-test.dmg
release/MD-Duck-0.1.0-beta.4-macOS-arm64-local-test.zip
release/SHA256SUMS
```

两个命令都显式使用 `--publish never`，配置中的 `publish` 也为 `null`，不会自动上传或发布。校验脚本会收集 `release/` 下所有匹配名称的 DMG/ZIP/EXE；若该目录保留了旧版本，清单也会包含它们，交付时应核对版本与文件名。

## 检查生成的应用

```bash
npm run verify:mac
npm run verify:speech
```

- `verify:mac` 检查应用版本标识、主进程与界面文件、示例图片、IPA 数据与许可文件、arm64 ONNX 原生模块、应用标识，以及 `codesign --verify --deep --strict`。还会检查应用归档中是否误带若干用户资料和开发产物目录。签名校验成功只说明本机 ad-hoc 签名完整，不等于 Developer ID 签名或 Apple 公证。
- `verify:speech` 使用打包后应用自己的 Electron 运行时和依赖，检查 ONNX CPU 推理、sharp 图片生成、phonemizer、Kokoro 模块与声音资源。它禁止网络请求、不读取应用资料目录、不下载语音模型；通过也不代表已经验证完整语音合成、语音工作进程 IPC 或播放链路。

可以指定另一个 `.app` 检查结构：

```bash
npm run verify:mac -- "/absolute/path/MD Duck.app"
```

在独立测试资料目录完成首次模型下载后，可以验证完整离线语音合成：

```bash
ELECTRON_RUN_AS_NODE=1 "release/mac-arm64/MD Duck.app/Contents/MacOS/MD Duck" \
  scripts/verify-speech-offline.cjs \
  "release/mac-arm64/MD Duck.app/Contents/Resources/app.asar" \
  "/absolute/path/to/test-profile/kokoro-cache"
```

此检查禁止模型联网请求，直接用指定缓存合成短句，并检查采样率、非静音有效采样和缓存未被改写；它不会播放声音或写入音频文件。

归档生成后，在 `release/` 目录执行以下命令核对校验和：

```bash
shasum -a 256 -c SHA256SUMS
```

应用结构检查、压缩包校验和检查、DMG 挂载与安装后启动是不同的验证步骤。后两者需要针对最终产物单独记录，不能仅根据源码测试或 `.app` 检查推断已经完成。

## 使用独立资料目录启动

通过 `MD_DUCK_PROFILE_DIR` 指定独立资料目录，可以检查首次启动而不读取日常使用的应用配置。路径必须是绝对路径，不能是文件系统根目录；程序会创建该目录。

```bash
MD_DUCK_PROFILE_DIR="/tmp/md-duck-beta-profile" \
  "release/mac-arm64/MD Duck.app/Contents/MacOS/MD Duck"
```

该变量同时隔离应用 `userData` 与 `sessionData`；后者位于指定目录的 `session/`。设置、AI 配置、本机备份、浏览器存储和语音缓存随该资料目录保存。重复使用同一个目录会保留上次测试状态；检查全新启动时应换一个尚未使用的目录。不要把独立资料目录打进安装包。

资料目录隔离不会把手动打开的真实文章变成副本。批注、单词和翻译仍会写到所打开文章旁边；内测应使用示例或文章副本。

点击程序中的示例入口时，内置示例会复制到 `userData/examples/`，再从这个可写位置打开。后续仅补齐缺失文件，保留已有修改；不会在只读应用资源或 DMG 中直接写批注。示例复制排除隐藏文件和旧 `.review` 数据。

## 首次朗读与网络

应用采用 `onnx-community/Kokoro-82M-v1.0-ONNX` 的 CPU/q8 模型。全新资料目录首次请求朗读时，模型下载量约 **92 MB**，另有少量配置等文件；实际大小随上游资源变化。语音工作进程由第一次 `speech:speak` 请求启动，普通启动不提前下载模型。

模型保存在当前 `userData/kokoro-cache/`，已生成的语音片段保存在 `userData/speech-cache/`。安装包不携带个人模型缓存或朗读缓存。首次下载需要网络，完成后使用本机模型；不能把无网络的依赖检查通过描述为“首次启动完全离线可用”。

## 打包内容与第三方材料

`electron-builder.yml` 将应用代码放入 `app.asar`，将需要直接加载的语音工作进程和原生依赖解包到 `app.asar.unpacked`。示例、第三方材料与原始 IPA 词表作为资源单独复制。Mac 目标生成 arm64 包，Windows 目标生成 x64 包，不应将其标为 Intel Mac 或 Windows ARM 通用安装包。

第三方声明由以下命令离线重新生成，`pack:mac` 与 `dist:mac` 已自动调用：

```bash
node scripts/collect-notices.mjs
```

输出位于 `build/third-party/`，概要见 [第三方声明](build/THIRD_PARTY_NOTICES.md)，逐文件来源与 SHA-256 见 [manifest.json](build/third-party/manifest.json)。生成器只读取已安装生产依赖的声明文件、固定来源补充文本和项目内 IPA 数据，不读取用户配置、密钥、文章或缓存。Electron 的 `LICENSE` 与 `LICENSES.chromium.html` 随运行时保留。

完整来源、补充文本和实际未闭合项见 [第三方发布核对](docs/THIRD-PARTY-RELEASE-AUDIT.md)。`phonemizer` 包装层的 Apache 声明不能替代其内嵌 eSpeak NG 的对应源码；npm 元数据中的许可证名称不能替代缺失的版权和授权正文。内置 UK IPA 数据保留独立 GPL 文本，不标为 MIT。

可使用 `node scripts/collect-notices.mjs --strict` 将“生产包缺完整许可证文本”作为失败条件；当前已知缺口存在时该命令会返回非零退出码。

项目自有代码和文档已采用 GPL-3.0-or-later，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。免费测试版公开前仍需完成第三方授权、声明与对应源码核对，并针对最终 DMG/ZIP 验证安装、首次启动和数据恢复。官网保持 `preparing`，直到有可公开分发的真实文件和地址。Developer ID 签名和公证为后续可选发行工作，不再作为当前免费测试版的购买前提；本轮命令不自动上传安装包。

历史的 [beta.1 安装报告](release/INSTALL-TEST-REPORT.md) 仅对应当时产物，不用于证明新版本已通过首次安装。beta.2 的结果保存在 `release-prep-20261005/`；beta.3 的最终归档、校验和、安装副本与启动检查记录保存在 `release-prep-20261010/`。每次重打包都应重新检查校验值及声明，并以该轮报告的实际结果为准。

## Windows x64 构建与检查

在 Windows x64 环境使用锁文件安装依赖。不要在 Mac 上把原生依赖直接搬到 Windows 包中。

```powershell
npm ci
npm run typecheck
npm test
npm run dist:win
npm run verify:win
npm run verify:speech:win
npm run verify:startup:win
```

`dist:win` 生成 NSIS 安装程序、portable 可执行文件和 SHA256SUMS，全部禁用自动发布。未签 Windows 发布者证书。运行时分别携带 Windows x64 的 ONNX、sharp/libvips，排除其他平台的二进制；声明生成器核对本平台已安装依赖及固定来源记录。当前目标文件名为：

```text
release/MD-Duck-0.1.0-beta.4-Windows-x64-Setup-local-test.exe
release/MD-Duck-0.1.0-beta.4-Windows-x64-Portable-local-test.exe
```

- `verify:win` 检查版本、资源、私有数据排除、PE x64 架构、ONNX/sharp 原生依赖，以及安装程序和 portable 中的 payload 一致性。
- `verify:speech:win` 在 Windows 包内的 Electron 运行时执行真实 ONNX 推理、图片生成及 phonemizer 检查；不下载模型、不播放音频。
- `verify:startup:win` 真正启动打包后的 EXE，使用自动创建的独立资料目录与中英文测试稿连续启动三次，检查窗口先于初始化显示、界面文件加载、资料就绪及文章恢复，然后清理自己的测试进程和目录。
- `verify:startup:mac` 对 Mac 包执行同一启动验证；不触碰日常资料目录。

启动验证只在设置独立 `MD_DUCK_PROFILE_DIR` 时启用资料目录内的 `MD_DUCK_STARTUP_CHECK_REPORT`，记录版本、平台和阶段耗时。普通启动不写此文件，不记录文章内容或密钥。

[Windows 自动构建](.github/workflows/windows-build.yml) 在 GitHub Windows runner 运行上述检查，并静默安装至带中文和空格的临时路径后再次检查启动与原生朗读依赖。CI 产物是有限保留期的测试文件，不是 GitHub Release。portable 当前核对 payload，尚未单独验收其启动与解压清理行为。Windows 桌面的手动交互、实际扬声器播放和不同版本系统仍需验收。

ONNX 的 Windows 二进制依赖 Microsoft Visual C++ v14 x64 运行库。`verify:win` 报告应用目录内的四个相关 DLL，但不把缺失作为包完整性失败；runner 自带开发工具，朗读依赖检查通过不能证明未安装运行库的全新电脑也可朗读。安装说明中的 [微软官方运行库指引](https://learn.microsoft.com/zh-cn/cpp/windows/latest-supported-vc-redist?view=msvc-170) 属于可选朗读的前置条件，程序不自动安装第三方运行库。

Windows libvips/MXE 对应源码和可替换构建材料另有 `WINVIPS-SOURCE` 核对项，不以 Mac 的源码材料替代 Windows 二进制要求。公开安装包仍保持准备中。

Linux、Intel Mac 和 Windows ARM 当前不在打包目标中。增加目标前需要在对应环境安装原生依赖、核对第三方材料并验证文件读写、图片、批注及朗读。
