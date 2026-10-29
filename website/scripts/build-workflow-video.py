"""Build the captioned workflow film from genuine release screenshots.

Manual asset task: Python + Pillow and ffmpeg are required. Normal site builds
serve the committed MP4 files and do not require these tools. Screenshots are
not retouched; all instructional type is outside the captured application.
"""
from pathlib import Path
import json
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
media = root / 'public/media'
shots = root / 'public/images/workflow'
media.mkdir(exist_ok=True)
font_file = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
paper, ink, red, muted, line = '#f5f0e6', '#252321', '#b13d2c', '#726d64', '#b6aea0'
font = lambda size: ImageFont.truetype(font_file, size)
scenes = {
 'zh': [
  ('read-before', '先写下来，再认真读。', '让任意 AI 写作，保存为本地 Markdown。\n\n有文件权限的 AI 可以直接保存；聊天工具生成的内容，由你保存。', 'AI 写文件 → MD Duck 阅读 → AI 修改 → 你确认后发布'),
  ('flat-library', '几篇散稿，直接放一起。', '先把几份 .md 放进一个文件夹，\n在 MD Duck 打开就能读。\n\n不需要先设计复杂分类。', '在本地创建文件夹，再用「打开文件夹」选择它。'),
  ('series-library', '文章多了，按系列整理。', '一个系列一个文件夹，\n每篇文章一个子文件夹。\n\n用清楚的名称和 01-、02- 序号表达顺序。分类由你决定。', 'Mac 和 Windows 使用相同的文件组织方式。'),
  ('article-assets', '配图和文章，放在一起。', 'article.md 是原稿，\narticle.zh.md 是可选译文。\n\n配图放在 assets/，使用相对路径。移动、备份时保留完整文件夹。', '示例：![图的说明](assets/detail.svg)'),
  ('selection', '这一段，还是太空泛。', '选中原文复制，或截一张图。\n\nMac：⌘ C / ⇧ ⌘ 4\nWindows：Ctrl C / Win ⇧ S\n\n把文章位置也告诉 AI。', '“Tell the supplier what you need and ask for a quote.”'),
  ('selection', '把想改的地方，说具体。', '修改要求示例\n\n“这段请说清楚需要提供哪些信息：产品、尺寸、数量、收货城市和日期。不要编造未确认的数据，同步修改中文。”', '这是交给外部 AI 的要求示例；MD Duck 不修改正文。'),
  ('read-after', '保存到原处，回来复核。', '有文件权限：让 AI 保存。\n没有权限：你把完整内容保存回原文件。\n\nMD Duck 更新后，再读一遍改过的段落。', '真实演示：保存两份文件后，阅读器显示了新内容。'),
  ('read-after', '双语内容，再核对一次。', '对照意思是否一致。\n用「检查整篇」找结构问题。\n\n结构对应，不等于翻译正确。\n多处问题也可以用批注集中整理。', '示例原稿和译文均通过 8 / 8 结构配对检查。'),
  ('read-after', '确认满意，再交给发布工具。', '发布交接示例\n\n把确认的稿件与目标栏目交给有后台权限的 AI。先核对预览，再明确授权发布。\n\nMD Duck 本身不连接后台发布。', '本演示未连接真实后台，也没有发布演示文章。'),
  ('archive-library', '完成的归档，原稿留在本地。', '发布后保留文章、译文与配图。\n\n完成的内容在 MD Duck 中归档，需要更新时再恢复。定期备份整个文章库。', '下载演示文章库，按自己的节奏试一遍。'),
 ],
 'en': [
  ('read-before', 'Write first. Then read closely.', 'Use any AI to prepare local Markdown.\n\nAn AI with file access can save it. With a chat-only tool, you save the files yourself.', 'AI writes → MD Duck reads → AI revises → you approve publication'),
  ('flat-library', 'A few drafts? Keep it simple.', 'Put a few .md files in a folder.\nOpen that folder in MD Duck.\n\nYou do not need an elaborate filing system to start reading.', 'Create a local folder, then choose Open Folder in MD Duck.'),
  ('series-library', 'Give a series its own folder.', 'One folder per series.\nOne subfolder per article.\n\nUse clear names and 01-, 02- prefixes for your intended order. You decide the categories.', 'The same file organization works on Mac and Windows.'),
  ('article-assets', 'Keep images with the article.', 'article.md holds the source.\narticle.zh.md is an optional translation.\n\nKeep images in assets/ with relative paths. Move and back up the whole folder.', 'Example: ![Image description](assets/detail.svg)'),
  ('selection', 'This paragraph needs detail.', 'Copy the passage, or capture it.\n\nMac: ⌘ C / ⇧ ⌘ 4\nWindows: Ctrl C / Win ⇧ S\n\nTell your AI which article it belongs to.', '“Tell the supplier what you need and ask for a quote.”'),
  ('selection', 'Ask for a specific change.', 'EXAMPLE REVISION REQUEST\n\n“Explain which details to provide: product, size, quantity, delivery city and date. Do not invent facts. Update the Chinese version too.”', 'A request for your external AI. MD Duck does not edit the text.'),
  ('read-after', 'Save. Return. Read again.', 'Let an AI with file access save the changes, or save the complete files yourself.\n\nReturn to MD Duck and reread the revised passage after it refreshes.', 'Verified in the demo: saving both files refreshed the reader.'),
  ('read-after', 'Check both languages.', 'Compare the meaning.\nCheck the whole document for pairing issues.\n\nMatching structure is not proof of an accurate translation. Comments are optional.', 'Both sample versions passed the 8 / 8 structure check.'),
  ('read-after', 'Approve before publishing.', 'EXAMPLE PUBLISHING HANDOFF\n\nGive your approved files to an AI with backend access. Review the preview and explicitly authorize publication.\n\nMD Duck does not publish articles.', 'No real backend was connected. No sample article was published.'),
  ('archive-library', 'Keep a local source copy.', 'Retain the article, translation and images.\n\nArchive finished work in MD Duck; restore it when it needs an update. Back up the complete library regularly.', 'Download the sample library and try the workflow at your own pace.'),
 ]
}

def wrap(draw, value, face, width):
    # Preserve words in English and allow CJK to wrap at individual characters.
    import re
    result = []
    for paragraph in value.split('\n'):
        tokens = re.findall(r'[A-Za-z0-9][A-Za-z0-9/_.:,-]*\s*|.', paragraph)
        current = ''
        for token in tokens:
            if current and draw.textlength(current + token, font=face) > width:
                result.append(current.rstrip()); current = token.lstrip()
            else:
                current += token
        result.append(current)
    return result

def paragraph(draw, value, x, y, size, width, fill=ink, gap=1.45):
    face = font(size)
    for row in wrap(draw, value, face, width):
        draw.text((x, y), row, font=face, fill=fill)
        y += round(size * gap)
    return y

def timestamp(second):
    return f'{second // 3600:02}:{second // 60 % 60:02}:{second % 60:02}.000'

manifest = {}
with tempfile.TemporaryDirectory(prefix='mdduck-film-') as temporary:
    work = Path(temporary)
    for lang, parts in scenes.items():
        entries, transcript, vtt = [], [], ['WEBVTT', '']
        for i, (image_name, title, body, foot) in enumerate(parts):
            frame = Image.new('RGB', (1920, 1080), paper)
            draw = ImageDraw.Draw(frame)
            draw.text((56, 36), 'MD DUCK  /  '+('一套真实的使用流程' if lang == 'zh' else 'A PRACTICAL WORKFLOW'), font=font(26), fill=red)
            draw.text((1760, 36), f'{i + 1:02} / 10', font=font(25), fill=muted)
            draw.line((56, 89, 1864, 89), fill=line, width=1)
            screenshot = Image.open(shots / f'{image_name}.jpg').convert('RGB')
            screenshot.thumbnail((1250, 818), Image.Resampling.LANCZOS)
            x, y = 56, 141
            frame.paste(screenshot, (x, y))
            draw.rectangle((x-1, y-1, x+screenshot.width, y+screenshot.height), outline=line)
            draw.text((56, 973), 'Mac · beta.6 · '+('真实阅读器截图，步骤编排演示' if lang == 'zh' else 'Actual reader captures, arranged as a walkthrough'), font=font(22), fill=muted)
            bottom = paragraph(draw, title, 1360, 132, 43, 495, gap=1.35)
            bottom = paragraph(draw, body, 1360, bottom+38, 29, 495, gap=1.5)
            if bottom > 870: raise ValueError(f'Caption too long: {lang} {i} {bottom}')
            draw.line((1360, 900, 1864, 900), fill=line, width=1)
            foot_end = paragraph(draw, foot, 1360, 918, 22, 495, fill=muted, gap=1.35)
            if foot_end > 1040: raise ValueError(f'Footnote too long: {lang} {i}')
            for j in range(10):
                left = 56 + j*180
                draw.line((left, 1045, left+160, 1045), fill=red if j <= i else line, width=4)
            path = work / f'{lang}-{i:02}.png'; frame.save(path)
            entries += [f"file '{path}'", 'duration 9']
            transcript.append(f'{timestamp(i*9)[:-4]}  {title}\n{body}\n{foot}\n')
            vtt += [f'{timestamp(i*9)} --> {timestamp((i+1)*9)}', title, body.replace('\n\n','\n'), '']
            if i == 0 and lang == 'zh': frame.save(shots/'video-poster.jpg', quality=91)
        entries.append(f"file '{path}'")
        concat = work / f'{lang}.txt'; concat.write_text('\n'.join(entries))
        video = media / f'md-duck-workflow-{lang}.mp4'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-t','90','-vf','fps=24,format=yuv420p','-c:v','libx264','-preset','medium','-crf','21','-movflags','+faststart',str(video)],check=True)
        intro = '90 秒字幕演示，无音频。基于真实 Mac 阅读器截图编排；外部 AI 修改和发布交接为说明示例，未向真实网站发布文章。\n\n' if lang == 'zh' else '90-second captioned walkthrough, without audio. Arranged from actual Mac reader captures. External AI requests and publishing handoff are examples; no article was published to a real website.\n\n'
        (media/f'md-duck-workflow-{lang}.txt').write_text(intro+'\n'.join(transcript))
        (media/f'md-duck-workflow-{lang}.vtt').write_text('\n'.join(vtt))
        manifest[lang] = {'seconds':90,'bytes':video.stat().st_size,'scenes':len(parts),'dimensions':[1920,1080],'audio':False}
print(json.dumps(manifest))
