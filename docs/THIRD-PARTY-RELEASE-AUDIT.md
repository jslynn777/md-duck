# MD Duck beta.5：第三方声明与对应源码

核对日期：2026-10-10。范围：macOS arm64、Windows x64 的生产依赖和内置神经朗读资源。项目自有代码与文档采用 GPL-3.0-or-later，第三方材料保留原始声明。本文记录源码输入与构建证据；最终公开交付还必须通过两平台安装包验证，并在二进制旁提供匹配的完整对应源码下载。

## 神经朗读保留了什么

仍使用同一 Kokoro q8 模型、五个未修改声音风格数据、文本规范化和原生 CPU ONNX 推理。模型固定到 `1939ad2a8e416c0acfeecc08a694d14ef25f2231`，92,361,116 字节，SHA-256 `fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478`；只有请求朗读时才会下载，并在激活缓存前校验大小和哈希。五声音真实推理测试在代表性美英文本、数字/时间和语速变化下，与此前 Kokoro 输出逐采样相同；这项证据的范围是已测文本与固定模型，不是所有输入的数学证明。

Kokoro 的模型/声音/词表/规范化来源、归档 integrity、逐声音哈希与完整 Apache-2.0 文本在 [kokoro-voices](../src/main/data/kokoro-voices/SOURCE.json)。音标表仍保留 US MIT 与 UK GPL 的不同条件，不把 UK 数据改称 MIT。

## 四项旧问题如何处理

[release-audit.json](../scripts/notices-sources/release-audit.json) 保留旧记录与具体关闭证据。

| 旧事项 | beta.5 实际处理 |
| --- | --- |
| GUID 缺失授权全文 | 用直接原生 ONNX 推理替换未使用的 Transformers/ONNX Web 路径，GUID 包不再在生产树或安装包中。没有替该旧版本伪造授权。 |
| 旧预编译 phonemizer 引擎源码身份不明 | 替换成完整固定源码 ephone/eSpeak NG commit `4f6d246c1d3acf67a4d814e20da02fa3967bc92d` 的新构建。引擎 C/C++ 未改，英语/Unicode 输入完整，Emscripten 3.1.64 镜像按 digest 固定。两次隔离构建的引擎和英语数据字节哈希完全一致。 |
| Mac libvips 源码/传递声明未闭合 | 移除没有被朗读使用的 Transformers 图像路径及 sharp/libvips，最终包检查拒绝这些旧组件。原记录保留，不声称旧 dylib 已补齐来源。 |
| Windows libvips/MXE 对应源码未闭合 | 同样移除该图像依赖路径，最终包检查拒绝旧 DLL。Mac 的补丁没有冒充 Windows 构建证据。 |

新引擎的 [SOURCE.json](../src/main/kokoro-runtime-phonemizer/SOURCE.json) 记录源码归档大小/SHA-256、编译镜像、三处仅构建脚本兼容性调整、语言选择与生成文件哈希。[SOURCE.md](../src/main/kokoro-runtime-phonemizer/SOURCE.md) 给出重建/替换步骤。完整引擎源码含原始逐文件版权和 GPL 文本；Emscripten、musl、compiler-rt、libc++、libc++abi、libunwind 与 Unicode 的原始声明分别保留。完整源码归档保留更多上游逐文件声明，不以单一 SPDX 标签代替它们。

## 对应源码的交付和替换

公开二进制必须同时提供 `MD-Duck-0.1.0-beta.5-Corresponding-Source.tar.gz`。它由最终二进制 Git revision 的完整 MD Duck 源码和以下明确选择的公开原始输入合并：完整 ephone 源码归档、完整 Emscripten 3.1.64 源码归档、经 npm integrity 校验的 Kokoro 原始归档。`third-party/SOURCE-INPUTS.json` 给出输入来源和哈希；没有复制用户文章、设置、API 密钥、模型/音频缓存或开发审计目录。

维护者先用 `scripts/stage-neural-sources.mjs --archives <已验证归档目录> --output <源码包根目录>` 选择输入，再合并最终 `git archive`。它只接受明确记录的三个归档，不能用整个工作目录或归档目录代替选择。仅在本机整理好材料，不代表已经完成公开下载交付。

从合并源码根目录执行：

```sh
node scripts/build-phonemizer.mjs --archive third-party/source-archives/ephone-js-4f6d246.tar.gz --verify
```

省略 `--verify` 会在核对完全相同的输出哈希后重写引擎文件；需要替换为自己的构建时调整其输入/输出记录，然后用正常平台构建与打包命令生成修改版。固定容器提供重建工具链，完整 Emscripten 源码包含实际链接到 WebAssembly 的运行库源码。Windows 维护者可使用 WSL2/Docker；普通阅读用户不需要它们。

## 可执行检查

- `node scripts/verify-neural-sources.mjs` 校验内置引擎、全部运行库声明、五声音字节及被移除依赖在生产锁文件中的缺席；加 `--archives <目录>` 校验源码输入。
- `node scripts/collect-notices.mjs --release-strict` 收集安装的生产包完整声明以及新引擎/模型/声音/词表声明；缺少声明、资源漂移或未解决事项都会失败。它不读取用户状态。
- `scripts/verify-speech-runtime.cjs` 从选定实际应用加载编译引擎、美英数据、五声音及 native ONNX 测试；不下载语音模型。
- `scripts/verify-speech-offline.cjs` 用独立已校验的公开模型缓存、禁止网络、真实合成五声音，确认非静音、有限值和缓存不变。UtilityProcess IPC 另行验收。
- 两平台包检查验证项目和第三方文本、native 架构、声音/声明哈希、worker 及其动态模块 unpack、未包含用户资料与旧图像/Web/phonemizer 代码。Electron `LICENSE` 与 `LICENSES.chromium.html` 保留在分发物中。

严格检查成功表明具体记录和相应安装包检查通过；公开发布仍需将匹配源码包与最终构建一起交付，不作无限范围的合规或安全保证。
