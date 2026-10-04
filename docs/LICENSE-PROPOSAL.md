# MD Duck 项目许可证准备方案

状态：**项目所有者已确认，2026-10-05 已落实 GPL-3.0-or-later。** 自有代码与文档的许可授权见根目录 [NOTICE](../NOTICE)，完整 GNU GPL 第三版文本见 [LICENSE](../LICENSE)。

MD Duck 的发布计划是免费使用、公开源码。项目自有代码与文档已声明 GPL-3.0-or-later，可按相应条件复制、修改、再分发。第三方材料保持各自原有条款。

## 已采用 GPL-3.0-or-later

现有安装包包含保留 GPL 条款的 UK 音标数据，以及 phonemizer 内嵌的 eSpeak NG。MD Duck 自有代码采用 GPL-3.0-or-later，同时逐项保留第三方原始许可证，继续核对整个分发组合的条件。

项目许可证已经确定；安装包的第三方分发核对仍有实际缺口，见 [第三方发布核对](THIRD-PARTY-RELEASE-AUDIT.md)。将项目代码标成 GPL 不能代替上游版权文本、对应源码和其他分发条件。

GPL 允许商用和收费再分发；MD Duck 官方免费是项目的发布策略。再分发 GPL 覆盖的软件时仍需遵守相应的源码和许可条件。若项目所有者更希望自己的代码采用 MIT，需要先明确 GPL 组件是独立聚合还是组合的范围，必要时替换相关依赖，不能直接把整个安装包标为 MIT。

## 当前落实与公开安装包前的工作

1. 已保存完整项目许可证和 NOTICE，明确自有代码与文档适用 GPL-3.0-or-later，第三方材料各按对应条款处理。
2. 已同步 `package.json` 和根锁文件中的许可证标识；公开仓库、README 与发布说明按实际发布状态同步。
3. 保留 IPA 数据的原始文本及来源，保留语音、ONNX、libvips、Electron 的声明；对实际分发的 GPL/LGPL 组件提供核实后的对应源码和构建材料。
4. 公开安装包前再次检查缺口；签名和公证的暂缓不豁免第三方分发条件。

参考：[GNU GPL 第三版](https://www.gnu.org/licenses/gpl-3.0.html)、[GNU 关于收费再分发的说明](https://www.gnu.org/licenses/gpl-faq.html#DoesTheGPLAllowMoney)。
