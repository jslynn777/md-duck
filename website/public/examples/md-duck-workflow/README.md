# 用自己的 AI 写，在 MD Duck 中读

这是一个可以在 Mac 和 Windows 上练习的本地文章库。包含 11 篇简短的中英双语示例：一篇修改演示、4 份散稿，以及“产品询价”“写作审阅”两个系列，每个系列 3 篇。

MD Duck 负责读取、查看和审阅本地 Markdown。你喜欢的 AI 或编辑器负责写作、修改文件。发布到后台由另行授权的外部工具完成。

## 先打开正确的文件夹

1. 先解压下载包。Mac 使用 Finder；Windows 在文件资源管理器选择“全部解压缩”。
2. 在 MD Duck 选择“文件 → 打开文件夹”。Mac 快捷键为 `Command O`，Windows 为 `Ctrl O`。
3. **选择本包里的 `library` 文件夹**，不是整个下载包。这样参考快照和说明不会混进文章列表。
4. 打开 `A clearer product inquiry`，选择“对照”。普通阅读、文字选择和批注不需要在 MD Duck 中填写 AI 密钥。

```text
md-duck-workflow/
  library/                         ← 在 MD Duck 打开这里
    01-clearer-product-inquiry/
      article.md                   ← 英文初稿
      article.zh.md                ← 中文对照
    writing-brief.md                ← 也支持根目录散稿
    writing-brief.zh.md
    quote-questions.md / quote-questions.zh.md
    image-captions.md / image-captions.zh.md
    release-checklist.md / release-checklist.zh.md
    02-产品询价系列/
      01-define-the-product/
        article.md
        article.zh.md
        assets/morning.svg
      02-size-and-quantity/
      03-delivery-details/
    03-写作审阅系列/
      01-a-useful-brief/
      02-checking-claims/
      03-publication-handoff/
  snapshots/before/                ← 询价演示初稿，仅供对比
  snapshots/after/                 ← 询价演示改稿，仅供对比
  PROMPTS.zh.txt
  PROMPTS.en.txt
```

## 练习一：把一句空泛的话改清楚

在 `A clearer product inquiry` 中找到：

> Tell the supplier what you need and ask for a quote.

这句话没有说明读者应该提供哪些信息。选中这句，复制给你的 AI，或截取相关区域。Mac 复制为 `Command C`、区域截图为 `Shift Command 4`；Windows 复制为 `Ctrl C`、区域截图为 `Win Shift S`。在 AI 对话中粘贴，并附上明确要求：

> 这段太笼统。请说明产品、尺寸、数量、收货城市和期望到货日期如何帮助供应商报价；不要虚构具体规格、数量或交期。读取我指定文件夹中的最新两份稿子，只修改 request-details 块，同步中文并保留原 block ID。如果你不能访问文件，请给我完整替换内容，不要声称已经保存。

AI 能访问本地文件时，让它把修改保存到**原来的两份文件**。不能访问时，你自己用编辑器保存。然后回到 MD Duck，等待文件刷新，再读修改后的段落。选择“检查整篇”检查双语标记与结构；它不会判断译文事实是否正确，也不会自动配对或替你改稿。

不连接 AI 也能练习：用 `snapshots/after/` 中的两份文件替换 `library/01-clearer-product-inquiry/` 中的对应两份文件。只在这份练习副本中操作。前后稿使用相同的 8 个 block ID，仅修改 `request-details` 的内容。

## 练习二：散稿和系列都可以读

`library` 根目录的 4 份散稿演示“先直接放文件”。两个系列演示“确定主题后，自己创建分类”。文件夹是真实本地文件夹；MD Duck 显示你选择的结构，不会自行判断主题或自动整理。

如果计划写十几篇，先让 AI 给出系列目录，再让它按“一篇一个文件夹”的方式存放。每篇的译文和图片跟着文章放，不要把所有素材混在一个不明归属的目录里。完整文件规则与可复制提示词见官网使用指南。

## 练习三：本地图片、批注和归档

打开 `Define the product first`。两侧插图来自文章自己的 `assets/morning.svg`；它是原创示意图，不是真实商品照片或规格证明。其他系列文章也各自带有本地插图。

选一段写批注，保存后从文章旁的管理菜单选择“归档”，确认提示。归档会实际移动本地文件；在“已归档”中打开文章，核对原文、译文、图片和批注，再尝试“恢复归档”。系列和练习稿最初均未归档，方便你自己操作。

使用后可能出现 `.review` 和 `.mdduck` 隐藏目录。备份时保留完整文章库，不要让 AI 改写这些目录。大幅改稿后，仍要检查批注是否需要重新定位或确认完成。

## 练习四：发布是独立的一步

只有你审阅通过、外部 AI 有目标后台权限，而且你明确授权本次发布时，才让它操作后台。先核对草稿，再确认发布，最后打开公开链接检查标题、正文和图片。`PROMPTS.zh.txt` 中有交接示例；这份演示包没有执行任何后台发布，也没有连接你的后台。

本地原稿、译文和图片继续保留。不要把“后台保存成功”“公开发布完成”和“MD Duck 中归档”混成同一个动作。

完整指南：https://mdduck.com/guide/

示例文章与复用的 MD Duck 原创 SVG 插图遵循 GPL-3.0-or-later，见 `LICENSE`。官网演示截图来自独立练习库中的 Mac beta.6 实际界面；流程也适用于 Windows，文件管理器与快捷键不同。
