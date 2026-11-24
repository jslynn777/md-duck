"""Build the bilingual 108-second film from genuine beta.10 application captures.

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
images = root / 'public/images'
media.mkdir(exist_ok=True)
font_file = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
paper, ink, red, muted, line = '#f5f0e6', '#252321', '#b13d2c', '#726d64', '#b6aea0'
font = lambda size: ImageFont.truetype(font_file, size)
scenes = {
 'zh': [
  ('spaces/overview.png', '每个项目，各有空间。', '把本地文件夹添加为空间。\n\n日常草稿、系列指南、双语审阅各有位置。右上角切换，回来继续上次阅读。', '空间是本地文件夹的入口，不会另存一份文章。'),
  ('workflow/flat-library.jpg', '几篇散稿，直接开始。', '几份 Markdown 文件，\n放进同一个文件夹就能读。\n\n继续用熟悉的 AI 写作；只能聊天的工具，由你保存返回的内容。', '阅读本地文章不需要 AI 密钥，也不需要 Codex。'),
  ('workflow/series-library.jpg', '写一个系列，排好顺序。', '一个系列一个文件夹，\n每篇文章一个子文件夹。\n\n名称加上 01-、02- 序号，按名称升序查看。译文与图片随文章放好。', 'Mac 和 Windows 使用相同的文件组织方式。'),
  ('workflow/selection.jpg', '读到问题，说具体。', '选中段落复制，或截图。\n\n“补充产品、尺寸、数量、收货城市和日期。未知信息留作占位符，中英文一起改。”', 'Mac：⌘ C / ⇧ ⌘ 4；Windows：Ctrl C / Win ⇧ S。'),
  ('spaces/ai-handoff.png', '用任何 AI，先说清位置。', '复制「给 AI 的空间说明」，\n附上原文或截图和修改要求。\n\n有文件权限就保存回原处；没有权限，由你保存返回的内容。', '空间说明指定目录和文章，不会赋予 AI 文件权限。'),
  ('spaces/codex-task.png', '也可以交给本地 Codex。', '先安装并登录 Codex CLI。\n核对空间、当前文章和要求，\n再开始本地任务。\n\n任务需要时逐次批准；也可停止任务或由你接管。', '此图仅填写要求，未提交任务。不会接管外部 AI 对话。'),
  ('workflow/read-after.jpg', '保存后，阅读器会更新。', '修改仍保存在原来的文件里。\n\n这次在独立演示库中保存了原稿和译文，阅读器随后显示新内容。', '切换阅读空间，不会改变已开始的 Codex 任务目标。'),
  ('workflow/change-review.jpg', '先找到改动，再看差别。', '用「有改动」筛选文章。\n点击「查看改动」，\n对照上次确认与当前内容。\n\n仅仅打开文章，不会清除提示。', '比较的是已保存的文件；外部保存不等于 AI 任务完成。'),
  ('workflow/notes.jpg', '还有问题，留一条批注。', '把意见写在对应段落旁。\n\n多处问题可以集中整理后交给 AI。双语文章也要对照意思，检查受影响的译文。', '批注留在文章旁；是否修改正文仍由你决定。'),
  ('workflow/reviewed.jpg', '读过了，再确认已查看。', '核对事实、措辞与译文后，\n点击「标为已查看」。\n这次改动的提示随之消失。\n\n再次保存新的改动时，\n还会提示你回来复核。', '“已查看”只更新比较基准，不代表批准发布。'),
  ('workflow/article-assets.jpg', '满意的稿件，再交出去。', '用自己的后台或获授权的 AI 发布。先核对发布预览，再确认发布。\n\narticle.md、译文和 assets/ 图片目录仍在本地。', '发布为交接示例；本演示未连接后台、未发布文章。'),
  ('workflow/archive-library.jpg', '归档收好，以后还可改。', '在 MD Duck 中归档已完成的文章，需要更新时再恢复。\n\n移动或备份时保留整个文章文件夹，包括隐藏的审阅数据。', '下载演示文件，按自己的节奏走一遍。'),
 ],
 'en': [
  ('spaces/overview.png', 'A space for each project.', 'Add a local folder as a space.\n\nKeep drafts, series and bilingual reviews in separate places. Switch at the top right and resume reading.', 'Spaces point to your folders. They do not duplicate your articles.'),
  ('workflow/flat-library.jpg', 'A few drafts? Start here.', 'Put a few Markdown files in one folder and start reading.\n\nKeep writing with your usual AI. With a chat-only tool, save the returned text yourself.', 'Reading local files requires neither an API key nor Codex.'),
  ('workflow/series-library.jpg', 'Give a series an order.', 'One folder per series.\nOne subfolder per article.\n\nUse 01-, 02- name prefixes and sort by name. Keep translations and images with each article.', 'The same folder structure works on Mac and Windows.'),
  ('workflow/selection.jpg', 'Make the request specific.', 'Copy a passage or capture it.\n\n“Add product, size, quantity, delivery city and date. Use placeholders for unknown facts. Update both languages.”', 'Mac: ⌘ C / ⇧ ⌘ 4. Windows: Ctrl C / Win ⇧ S.'),
  ('spaces/ai-handoff.png', 'Give any AI the right file.', 'Copy Space instructions for AI. Add the passage or screenshot and your request.\n\nAn AI with file access saves in place. Otherwise, you save its returned text.', 'Instructions identify the folder and article; they do not grant access.'),
  ('spaces/codex-task.png', 'Or use local Codex.', 'Install and sign in to Codex CLI. Check the space, article and request, then start a local task.\n\nApprove individual requests when asked. Stop or take over when needed.', 'Request entered, not submitted. External AI chats are not controlled.'),
  ('workflow/read-after.jpg', 'Save. The reader updates.', 'The revised text stays in the original files.\n\nIn this isolated demo, saving the source and translation refreshed the article in MD Duck.', 'Switching reading spaces does not retarget a running Codex task.'),
  ('workflow/change-review.jpg', 'Find and compare changes.', 'Filter to changed articles.\nChoose View changes to compare with the last confirmed version.\n\nOpening an article alone does not clear its marker.', 'An external file save is not proof that an AI task has finished.'),
  ('workflow/notes.jpg', 'Keep feedback beside it.', 'Leave a note on the passage.\n\nCollect several comments for your AI to address. For bilingual articles, check the meaning and affected translation too.', 'Notes stay with the article. You decide what should be revised.'),
  ('workflow/reviewed.jpg', 'Reviewed? Mark as viewed.', 'After checking facts, wording and the translation, choose Mark as viewed. This revision’s marker clears.\n\nNew saved edits will appear for your next review.', 'This updates the comparison baseline. It does not approve publication.'),
  ('workflow/article-assets.jpg', 'Approve the publishing handoff.', 'Use your own CMS or an authorized AI to publish. Review its preview, then confirm publication.\n\nKeep article.md, its translation and assets/ locally.', 'Publishing is an example handoff. No backend was connected or article published.'),
  ('workflow/archive-library.jpg', 'Archive. Return when needed.', 'Archive completed work in MD Duck, then restore it when it needs an update.\n\nMove or back up the whole article folder, including hidden review data.', 'Download the examples and try the workflow at your own pace.'),
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
        assert len(parts) == 12
        entries, transcript, vtt = [], [], ['WEBVTT', '']
        for i, (image_name, title, body, foot) in enumerate(parts):
            frame = Image.new('RGB', (1920, 1080), paper)
            draw = ImageDraw.Draw(frame)
            draw.text((56, 36), 'MD DUCK  /  '+('从本地文章，到放心交付' if lang == 'zh' else 'LOCAL FILES. CAREFUL REVIEW.'), font=font(26), fill=red)
            draw.text((1760, 36), f'{i + 1:02} / 12', font=font(25), fill=muted)
            draw.line((56, 89, 1864, 89), fill=line, width=1)
            image_path = images / image_name
            if lang == 'en':
                image_path = image_path.with_stem(image_path.stem + '-en')
            screenshot = Image.open(image_path).convert('RGB')
            screenshot.thumbnail((1250, 818), Image.Resampling.LANCZOS)
            x, y = 56, 141
            frame.paste(screenshot, (x, y))
            draw.rectangle((x-1, y-1, x+screenshot.width, y+screenshot.height), outline=line)
            draw.text((56, 973), 'Mac · beta.10 · '+('真实阅读器截图，步骤编排演示' if lang == 'zh' else 'Actual reader captures, arranged as a walkthrough'), font=font(22), fill=muted)
            bottom = paragraph(draw, title, 1360, 132, 43, 495, gap=1.35)
            bottom = paragraph(draw, body, 1360, bottom+38, 29, 495, gap=1.5)
            if bottom > 870: raise ValueError(f'Caption too long: {lang} {i} {bottom}')
            draw.line((1360, 900, 1864, 900), fill=line, width=1)
            foot_end = paragraph(draw, foot, 1360, 918, 22, 495, fill=muted, gap=1.35)
            if foot_end > 1040: raise ValueError(f'Footnote too long: {lang} {i}')
            for j in range(12):
                left = 56 + j*151
                draw.line((left, 1045, left+132, 1045), fill=red if j <= i else line, width=4)
            path = work / f'{lang}-{i:02}.png'; frame.save(path)
            entries += [f"file '{path}'", 'duration 9']
            transcript.append(f'{timestamp(i*9)[:-4]}  {title}\n{body}\n{foot}\n')
            vtt += [f'{timestamp(i*9)} --> {timestamp((i+1)*9)}', title, body.replace('\n\n','\n'), foot, '']
            if i == 0: frame.save(shots / ('video-poster.jpg' if lang == 'zh' else 'video-poster-en.jpg'), quality=91)
        entries.append(f"file '{path}'")
        concat = work / f'{lang}.txt'; concat.write_text('\n'.join(entries))
        video = media / f'md-duck-workflow-{lang}.mp4'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-t','108','-vf','fps=24,format=yuv420p','-c:v','libx264','-preset','medium','-crf','21','-movflags','+faststart',str(video)],check=True)
        intro = '108 秒字幕演示，无音频。基于真实 Mac beta.10 界面截图编排，使用独立演示文章库。Codex 要求仅填写，未提交任务；文件修改在演示库完成。发布为交接说明，未连接真实后台、未发布文章。Mac 与 Windows 文件流程相同，界面和快捷键有所不同。\n\n' if lang == 'zh' else '108-second captioned walkthrough, without audio. Arranged from actual Mac beta.10 captures of an isolated demo library. The Codex request was entered, not submitted; file changes were saved in the demo library. Publishing is an example handoff: no live backend was connected and no article was published. Mac and Windows use the same file workflow, with different window appearance and shortcuts.\n\n'
        (media/f'md-duck-workflow-{lang}.txt').write_text(intro+'\n'.join(transcript))
        (media/f'md-duck-workflow-{lang}.vtt').write_text('\n'.join(vtt))
        manifest[lang] = {'seconds':108,'bytes':video.stat().st_size,'scenes':len(parts),'dimensions':[1920,1080],'audio':False,'version':'0.1.0-beta.10','captureType':'genuine screenshots arranged as a walkthrough'}
print(json.dumps(manifest))
