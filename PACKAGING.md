# MD Duck 免费测试版打包

当前版本为 **0.1.0-beta.5**，目标是 **macOS Apple Silicon（arm64）和 Windows x64 免费测试版**。Mac 配置保留 ad-hoc 签名，未使用 Developer ID 签名、未提交 Apple 公证，也未启用 hardened runtime；Windows 未进行发布者签名。产物名称不带 `local-test`，公开前应完成对应版本的许可材料、打包与安装检查。用户安装说明见 [INSTALLING.md](INSTALLING.md)。

本文记录现有命令与验证范围，不代表 DMG 挂载、安装或其他尚未完成的检查已经通过。命令均在项目根目录执行。

## 准备与构建

在 macOS arm64 环境安装 Node.js/npm，并使用项目锁文件安装依赖：

```bash
npm ci
npm run typecheck
npm test
```

当前锁定 `electron-builder` 为 `26.15.3`。语音由 `onnxruntime-node` 直接运行 Kokoro q8，音素引擎从固定版本 eSpeak 源码构建；原有五种声音保留。安装和构建应使用锁文件，不要手动删改锁文件来绕过原生模块错误。

仅生成可直接启动的 `.app`：

```bash
npm run pack:mac
```

此命令依次构建主进程、预加载脚本与界面，核对神经朗读资源和发布许可材料，再生成应用。声明收集使用 `--release-strict`，最后执行 `electron-builder --mac --arm64 --dir --publish never`。应用输出位置为：

```text
release/mac-arm64/MD Duck.app
```

生成 DMG、ZIP 和校验清单：

```bash
npm run dist:mac
```

`dist:mac` 同样先构建、核对神经朗读资源并生成严格第三方声明，随后打包 DMG/ZIP，并运行 `scripts/checksums.mjs`。当前版本的目标文件名是：

```text
release/MD-Duck-0.1.0-beta.5-macOS-arm64.dmg
release/MD-Duck-0.1.0-beta.5-macOS-arm64.zip
release/SHA256SUMS
```

两个命令都显式使用 `--publish never`，配置中的 `publish` 也为 `null`，不会自动上传或发布。校验脚本会收集 `release/` 下所有匹配名称的 DMG/ZIP/EXE；若该目录保留了旧版本，清单也会包含它们，交付时应核对版本与文件名。

## 检查生成的应用

```bash
npm run verify:mac
npm run verify:speech
npm run verify:startup:mac
```

- `verify:mac` 检查应用版本标识、主进程与界面文件、示例图片、IPA 数据与许可文件、arm64 ONNX 原生模块、应用标识，以及 `codesign --verify --deep --strict`。还会检查应用归档中是否误带若干用户资料和开发产物目录。签名校验成功只说明本机 ad-hoc 签名完整，不等于 Developer ID 签名或 Apple 公证。
- `verify:speech` 使用打包后应用自己的 Electron 运行时和依赖，检查 ONNX CPU 推理、来源固定的音素引擎与五份 Kokoro 声音资源。它禁止网络请求、不读取应用资料目录、不下载语音模型；此项检查不包含完整语音合成、工作进程 IPC 或扬声器播放。
- `verify:startup:mac` 使用自动创建的独立资料目录连续启动三次，检查窗口显示、界面加载、资料初始化及原文/译文恢复，然后只清理自己的测试进程和目录。

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

此检查禁止模型联网请求，用指定缓存分别合成五种声音的短句，检查 24 kHz 采样率、所有采样有限、非静音和模型缓存未被改写；它不会播放声音或写入音频文件，也不包含语音工作进程 IPC。

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

应用采用 `onnx-community/Kokoro-82M-v1.0-ONNX` 的 CPU/q8 模型，保留既有 `af_heart`、`af_bella`、`am_michael`、`bf_emma` 和 `bm_george` 五种声音。声音文件随应用提供，音素引擎由固定源码构建，神经语音模型仍由本机推理，不改成系统音色。

全新资料目录首次请求朗读时，只下载 `onnx/model_quantized.onnx`：**92,361,116 字节**（约 92 MB），固定上游版本 `1939ad2a8e416c0acfeecc08a694d14ef25f2231`，SHA-256 为 `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478`。大小与哈希不符合时不会使用下载文件。该文件与旧版 q8 模型相同，原缓存路径保留，已有有效缓存可复用；不再要求下载 tokenizer/config 文件。语音工作进程由第一次 `speech:speak` 请求启动，普通启动不提前下载模型。

模型保存在当前 `userData/kokoro-cache/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx`，已生成的语音片段保存在 `userData/speech-cache/`。安装包不携带个人模型缓存或朗读缓存。首次下载需要网络，完成后使用本机模型。首次下载、离线合成、工作进程传输和实际音频播放应分别记录结果。

## 打包内容与第三方材料

`electron-builder.yml` 将应用代码放入 `app.asar`，将需要直接加载的语音工作进程和原生依赖解包到 `app.asar.unpacked`。示例、第三方材料与原始 IPA 词表作为资源单独复制。Mac 目标生成 arm64 包，Windows 目标生成 x64 包，不应将其标为 Intel Mac 或 Windows ARM 通用安装包。

第三方声明由以下命令离线重新生成，Mac 和 Windows 打包命令均自动调用严格发布检查：

```bash
node scripts/collect-notices.mjs --release-strict
```

输出位于 `build/third-party/`，概要见 [第三方声明](build/THIRD_PARTY_NOTICES.md)，逐文件来源与 SHA-256 见 [manifest.json](build/third-party/manifest.json)。生成器只读取已安装生产依赖的声明文件、固定来源补充文本和项目内 IPA 数据，不读取用户配置、密钥、文章或缓存。Electron 的 `LICENSE` 与 `LICENSES.chromium.html` 随运行时保留。

完整来源、补充文本和发布核对项见 [第三方发布核对](docs/THIRD-PARTY-RELEASE-AUDIT.md)。音素引擎的固定上游版本、修改、编译脚本与工具版本应与最终二进制一起提供，版权和授权正文保留；Kokoro 声音文件及文本处理代码的来源见 [SOURCE.md](src/main/data/kokoro-voices/SOURCE.md)。内置 UK IPA 数据保留独立 GPL 文本，不标为 MIT。

可使用 `node scripts/collect-notices.mjs --strict` 将生产包缺完整许可证文本作为失败条件。严格声明检查与对应源码交付仍是两个步骤，最终结果以本版审计和打包报告为准。

### 核对和重建音素引擎

引擎和英语数据位于 `src/main/kokoro-runtime-phonemizer/`，五份声音数据位于 `src/main/data/kokoro-voices/`。两处 `SOURCE.json` 记录源版本、文件大小与哈希；普通使用和从已提交资源打包不需要 Docker。

解压对应版本的 `Corresponding-Source.tar.gz` 后，在项目源码目录下核对资源与附带源归档：

```bash
node scripts/verify-neural-sources.mjs --archives third-party/source-archives/
```

`MD-Duck-0.1.0-beta.5-Corresponding-Source.tar.gz` 将版本源码与第三方材料合并，`third-party/source-archives/` 包含固定的 `ephone-js-4f6d246.tar.gz`、`emscripten-3.1.64.tar.gz` 和原始 `kokoro-js-1.2.1.tgz`。资源检查核对生成资源及 ephone/Emscripten 源归档；各材料的来源与交付范围见审计。维护者要重建引擎时，需要 Docker 支持 `linux/amd64`，构建脚本使用 `SOURCE.json` 中固定 digest 的官方 Emscripten 镜像：

```bash
node scripts/build-phonemizer.mjs \
  --archive third-party/source-archives/ephone-js-4f6d246.tar.gz --verify
```

`--verify` 在临时目录编译，核对引擎和英语数据的实际字节，不改写项目中已提交的资源。省略 `--verify` 才会在核对通过后更新生成文件。具体上游版本、构建修改和许可正文见 [引擎来源清单](src/main/kokoro-runtime-phonemizer/SOURCE.json)及[第三方发布核对](docs/THIRD-PARTY-RELEASE-AUDIT.md)。

项目自有代码和文档采用 GPL-3.0-or-later，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。公开前应完成第三方授权、声明与对应源码核对，并针对最终产物验证安装、首次启动和数据恢复。官网在有可公开分发的真实文件与地址前保持 `preparing`。Developer ID 签名和公证为后续可选发行工作；本轮命令不自动上传安装包。

历史的 [beta.1 安装报告](release/INSTALL-TEST-REPORT.md) 仅对应当时产物。beta.2 的结果保存在 `release-prep-20261005/`，beta.3 保存在 `release-prep-20261010/`，beta.4 保存在 `release-prep-20261010-windows/`。beta.5 重新打包后，需要核对本轮的实际文件、校验值和报告。

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

`dist:win` 生成 NSIS 安装程序、portable 可执行文件和 SHA256SUMS，全部禁用自动发布，未签 Windows 发布者证书。运行时携带 Windows x64 的 ONNX 与同一套源码构建的音素引擎，排除其他平台的二进制；声明生成器核对本平台已安装依赖及固定来源记录。当前目标文件名为：

```text
release/MD-Duck-0.1.0-beta.5-Windows-x64-Setup.exe
release/MD-Duck-0.1.0-beta.5-Windows-x64-Portable.exe
```

- `verify:win` 检查版本、资源、私有数据排除、PE x64 架构、ONNX 原生依赖，以及安装程序和 portable 中的 payload 一致性。
- `verify:speech:win` 在 Windows 包内的 Electron 运行时执行真实 ONNX 推理、音素转换及五份声音资源检查；不下载模型、不播放音频。
- `verify:startup:win` 真正启动打包后的 EXE，使用自动创建的独立资料目录与中英文测试稿连续启动三次，检查窗口先于初始化显示、界面文件加载、资料就绪及文章恢复，然后清理自己的测试进程和目录。

启动验证只在设置独立 `MD_DUCK_PROFILE_DIR` 时启用资料目录内的 `MD_DUCK_STARTUP_CHECK_REPORT`，记录版本、平台和阶段耗时。普通启动不写此文件，不记录文章内容或密钥。

[Windows 自动构建](.github/workflows/windows-build.yml) 在 GitHub Windows runner 运行上述检查，并静默安装至带中文和空格的临时路径后再次检查启动与原生朗读依赖。CI 产物是有限保留期的测试文件，不是 GitHub Release。portable 当前核对 payload，尚未单独验收其启动与解压清理行为。Windows 桌面的手动交互、实际扬声器播放和不同版本系统仍需验收。

ONNX 的 Windows 二进制依赖 Microsoft Visual C++ v14 x64 运行库。`verify:win` 报告应用目录内的四个相关 DLL，但不把缺失作为包完整性失败；runner 自带开发工具，朗读依赖检查通过不能证明未安装运行库的全新电脑也可朗读。安装说明中的 [微软官方运行库指引](https://learn.microsoft.com/zh-cn/cpp/windows/latest-supported-vc-redist?view=msvc-170) 属于可选朗读的前置条件，程序不自动安装第三方运行库。

beta.5 不再以 Transformers 或 sharp/libvips 作为运行依赖。对应旧版本的依赖检查和许可材料不能直接代替新包验收；以最终安装包中的生产依赖与来源清单为准。官网提供 Mac DMG 与 Windows Setup 入口，ZIP 与 Portable 的构建存在不代表其安装/启动检查已通过。

Linux、Intel Mac 和 Windows ARM 当前不在打包目标中。增加目标前需要在对应环境安装原生依赖、核对第三方材料并验证文件读写、图片、批注及朗读。
