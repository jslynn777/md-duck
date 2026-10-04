# 免费 macOS 测试版：第三方声明与源码记录

核对日期：2026-10-05。范围：当前 Apple Silicon Mac 构建的生产依赖。本文记录已经完成的整理和可执行的剩余工作。项目所有者已确认自有代码与文档采用 GPL-3.0-or-later，完整声明见 [LICENSE](../LICENSE) 和 [NOTICE](../NOTICE)；第三方二进制的核对仍未闭合。

## 已完成

- 收集 147 个已安装生产锁文件条目的声明，覆盖 146 个不同的包名与版本。23 个本机未安装的可选平台包另列清单。
- 对 `guid-typescript@1.0.9`、`phonemizer@1.2.1`、`@img/sharp-libvips-darwin-arm64@1.3.4` 下载公开 npm 原始归档，分别核对归档 SHA-512 与锁文件 integrity；归档中的 4、9、6 个文件与本机安装文件的 SHA-256 全部一致。原始归档没有写进安装包；公开来源和逐文件哈希保存在各包的 `PROVENANCE.json` 中。离线生成器每次重新核对这些文件，发生漂移会拒绝生成。
- 将 `phonemizer` 包身份固定到 npm 声明的发布提交 `6835144b7ee9043129222549c1ed2f6a27216278`，记录预编译 worker 和 data 的来源、大小与哈希。wrapper 身份已确定，嵌入引擎的原始 C/C++ 源码身份仍未确定。
- 将 sharp-libvips 发布构建固定到 `ebb95f8add54eee8bed840e3fb587e4cbec857d7`。该提交的 `versions.properties` 与本机 `versions.json` 的 28 个版本一致。28 个顶层组件都有按具体版本取得的许可文本；另外保留 Cairo 的 MPL/LGPL 全文、FreeType 的双重许可与 BDF/PCF 声明、aom/WebP 专利文本、上游构建脚本及 5 个补丁。
- IPA 数据保留 US 与 UK 的不同授权和原始来源；UK GPL 数据没有被标为 MIT。Electron 自带的 `LICENSE`、`LICENSES.chromium.html` 继续由打包器保留。

生成物：[`build/THIRD_PARTY_NOTICES.md`](../build/THIRD_PARTY_NOTICES.md)、[`build/third-party/manifest.json`](../build/third-party/manifest.json)。精确的原生组件源码 URL、声明文件和补丁对应关系见 [`COMPONENTS.json`](../build/third-party/native/@img_sharp-libvips-darwin-arm64/COMPONENTS.json)。所有上游补充文本的来源与字节哈希见 [`scripts/notices-sources/manifest.json`](../scripts/notices-sources/manifest.json)。

## 三项尚待补齐

| 编号 | 当前证据 | 具体完成条件 |
| --- | --- | --- |
| `GUID-LICENSE` | guid-typescript 包 metadata 声明 ISC，但完整 npm 归档和当前上游仓库都没有版权及授权全文；npm gitHead `1870de806c3db7ba46c5b8a1387c60fc9dda9284` 在当前仓库不能解析。上游 [issue #7](https://github.com/snico-dev/guid-typescript/issues/7) 仍开放，[PR #30](https://github.com/snico-dev/guid-typescript/pull/30) 尚未合并。 | 取得权利人对该版本发布的完整声明；或更新/替换 `kokoro-js → Transformers.js → ONNX Web → guid-typescript` 依赖链，验证最终安装包不再含此代码。未合并的第三方 PR 或标准 ISC 模板不能冒充该版本的完整授权。 |
| `ESPEAK-SOURCE` | 已知 `phonemizer` wrapper 提交和预编译文件，但该树没有固定 eSpeak 引擎提交、数据生成输入、Emscripten/runtime 版本或完整构建记录。[上游源码树](https://github.com/xenova/phonemizer.js/tree/6835144b7ee9043129222549c1ed2f6a27216278)、[生成方式讨论](https://github.com/xenova/phonemizer.js/issues/1)、[许可讨论](https://github.com/xenova/phonemizer.js/issues/6) 可供跟进；讨论中的版本猜测没有作为事实写入清单。 | 取得与发布 worker 相符的引擎/runtime 对应源码、声明及构建输入；或替换为固定版本、完整记录、可重复构建的 worker，并提供对应源码。当前保留的 eSpeak 1.52.0 声明是明确标注的参考资料，不声称匹配现有二进制。 |
| `LIBVIPS-SOURCE` | 28 个顶层组件版本、许可全文和版本化源码 URL 已有清单；仍未交付完整源码归档及传递组件/逐文件版权清单。librsvg 的 Rust 依赖需要按实际构建锁文件、features 整理。libultrahdr 构建还使用了可变的 [PR #383 补丁 URL](https://patch-diff.githubusercontent.com/raw/google/libultrahdr/pull/383.patch)。 | 固定并校验实际源码、补丁、构建配置，整理编译进 dylib 的传递/逐文件声明，提供相符的源码下载与重建/替换原生库方法；确认 libultrahdr 发布构建实际使用的补丁 revision。已经下载并哈希的当前 PR 补丁不能证明历史构建使用了同一字节版本。 |

网站介绍页、源码整理可以继续推进。上述事项未闭合时，不把现有二进制声明为完成第三方再分发审查；它们与是否支付苹果会员费无关。没有向上游发送消息或创建 issue，全部外部操作均为读取公开资料。

## 项目许可证

项目所有者已选择 **MD Duck 自有代码与文档使用 GPL-3.0-or-later**，根目录已添加完整许可文本和授权声明。第三方代码和数据保持各自原始授权，UK 数据适用的 GPL 3.0 不因项目自有代码的 `or-later` 选项而被重新授权。

这不代表整个安装包已经完成兼容性审查。Apache 基金会说明 [Apache-2.0 代码可以纳入 GPLv3 项目](https://www.apache.org/licenses/GPL-compatibility.html)，但这不能补足 guid 缺失的版权声明或预编译引擎的对应源码。若希望自有代码使用 MIT，应先确定语音引擎的许可/组合边界或替换依赖，再做最终方案；不能只增加一份 MIT 文本就覆盖现有第三方材料。

## 本地复核与发布检查

```sh
node scripts/test-collect-notices.mjs
node scripts/collect-notices.mjs
node scripts/collect-notices.mjs --strict
node scripts/collect-notices.mjs --release-strict
```

- 普通生成成功：声明整理完成，但不表示公开发布审查完成。
- `--strict`：仅当全部已安装生产 npm 包具备收集到的许可文本才成功；当前应因 guid 缺全文退出 1。
- `--release-strict`：另外要求 [`release-audit.json`](../scripts/notices-sources/release-audit.json) 中三项嵌入组件/源码事项关闭；当前应退出 1。
- 生成器也会拒绝补充声明字节不符、已核对的安装文件漂移、原生组件版本变化、声明源路径越界或输出目录被符号链接重定向。

隔离验证覆盖以上边界，避免声明收集成功被误当成发布通过。本轮没有运行应用构建或打包；现有 `.app`、DMG、ZIP 仍是此前内容，重新打包后才会包含本轮新增声明。

关闭事项时应同时更新具体证据、`release-audit.json` 和其 manifest SHA-256，再离线重生成并核对最终安装包。缺失的对应源码不能通过删除剩余事项文字来关闭。
