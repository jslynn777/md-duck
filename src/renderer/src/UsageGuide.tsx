import { useEffect, useId, useRef, useState } from 'react'
import { Copy, ExternalLink, X } from 'lucide-react'
import type { UiLang } from '@shared/types'
import { getAuthoringPrompt, getRevisionPrompt } from '@shared/authoring-guide'
import './usage-guide.css'

export function PromptTools({ ui }: { ui: UiLang }) {
  const zh = ui === 'zh'
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<'write' | 'revise' | null>(null)
  const previewId = useId()
  async function copy(kind: 'write' | 'revise') {
    try {
      await window.api.copyText(kind === 'write' ? getAuthoringPrompt(ui) : getRevisionPrompt(ui))
      setMessage(zh ? '已复制。粘贴到你使用的 AI，填写开头的任务信息即可。' : 'Copied. Paste into your AI and fill in the task details at the top.')
    } catch {
      setPreview(kind)
      setMessage(zh ? '自动复制失败，请从下方规则中选择并复制。' : 'Could not copy automatically. Select and copy the prompt below.')
    }
  }
  return <div className="guide-prompts">
    <div className="guide-actions">
      <button className="btn small ghost" onClick={() => void copy('write')}><Copy size={14} />{zh ? '复制写作提示词' : 'Copy writing prompt'}</button>
      <button className="btn small ghost" onClick={() => void copy('revise')}><Copy size={14} />{zh ? '复制修改提示词' : 'Copy revision prompt'}</button>
    </div>
    <p className="guide-copy-status" role="status">{message}</p>
    <button className="guide-text-button" aria-expanded={preview !== null} aria-controls={previewId}
      onClick={() => setPreview(preview ? null : 'write')}>{zh ? '查看提示词内容' : 'Read the prompts'}</button>
    <div id={previewId} hidden={!preview}>
      <div className="seg guide-prompt-tabs" role="group" aria-label={zh ? '提示词类型' : 'Prompt type'}>
        <button aria-pressed={preview === 'write'} onClick={() => setPreview('write')}>{zh ? '写作' : 'Writing'}</button>
        <button aria-pressed={preview === 'revise'} onClick={() => setPreview('revise')}>{zh ? '修改' : 'Revision'}</button>
      </div>
      <textarea readOnly aria-label={zh ? '给 AI 的完整提示词' : 'Full prompt for your AI'} rows={11}
        value={preview === 'revise' ? getRevisionPrompt(ui) : getAuthoringPrompt(ui)} />
    </div>
  </div>
}

export function UsageGuide({ ui, onClose }: { ui: UiLang; onClose: () => void }) {
  const zh = ui === 'zh'
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [platform, setPlatform] = useState<'mac' | 'win'>(window.api.platform === 'darwin' ? 'mac' : 'win')
  const [linkError, setLinkError] = useState(false)
  const modifier = platform === 'mac' ? '⌘' : 'Ctrl'
  useEffect(() => { if (!dialogRef.current?.open) dialogRef.current?.showModal() }, [])
  const steps = zh ? [
    ['准备本地文章', '让任意 AI 或编辑器把文章保存到文件夹。一个系列一个目录，一篇文章一个小文件夹；例如 01-intro、02-materials。'],
    ['打开整个文章库', '点击左下角文件夹，选择系列的上级目录。左侧默认按名称排列，编号按 1、2、10 排序；“排序”可以切换标题或手动顺序。'],
    ['阅读并留下具体意见', '切换原文、中文或对照。选中需要修改的句子，点“批注”；在批注面板复制未完成意见，粘贴给你的 AI。'],
    ['保存修改，再回来看', '让 AI 修改同一位置的文件。保存后阅读内容会更新；检查译文配对和“待复核”意见，确认后标为完成，定稿后再归档。']
  ] : [
    ['Prepare local articles', 'Use any AI or editor to save Markdown files. Give each series a folder and each article its own subfolder, such as 01-intro and 02-materials.'],
    ['Open the whole library', 'Use the folder button at the bottom left to open the parent folder. Names sort naturally: 1, 2, 10. Use Sort to choose titles or your manual order.'],
    ['Read and leave specific feedback', 'Switch between source, Chinese and bilingual views. Select a sentence to comment. Copy open notes from the notes panel and paste them into your AI.'],
    ['Save changes and review again', 'Have your AI edit the same files. Saved changes appear in the reader. Check pairing and notes marked for review, resolve confirmed fixes, then archive finished articles.']
  ]
  return <dialog ref={dialogRef} className="usage-guide" aria-labelledby={titleId} onClose={onClose}
    onCancel={(event) => { event.preventDefault(); dialogRef.current?.close() }}>
    <header className="guide-heading">
      <h2 id={titleId}>{zh ? '使用指南' : 'Using MD Duck'}</h2>
      <button className="btn icon ghost" autoFocus onClick={() => dialogRef.current?.close()} aria-label={zh ? '关闭使用指南' : 'Close guide'}><X size={18} /></button>
    </header>
    <div className="guide-body">
      <p className="guide-intro">{zh ? '用你喜欢的工具写，在 MD Duck 里读和审阅。文件夹就是你的文章库。' : 'Write with your favorite tools. Read and review in MD Duck. Your folder is your library.'}</p>
      <ol className="guide-steps">{steps.map(([title, body], index) => <li key={index}><span aria-hidden="true">{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div></li>)}</ol>
      <details className="guide-details"><summary>{zh ? 'AI 改完后，怎样找到改动？' : 'How do I find what my AI changed?'}</summary>
        <p>{zh ? '原文或译文有新内容时，文章显示“有改动”，文件夹显示数量。点击“有改动”筛选当前“全部”或“已归档”列表，顺序保持不变。' : 'Changed source or translation text gives an article an Updated marker and its folder a count. Select Updated to filter the current All or Archived list without changing its order.'}</p>
        <p>{zh ? '打开文章后点“查看改动”，对照上次确认与现在的内容，逐处查看或定位正文。读完再点“标为已查看”；仅打开不会清除标记，也不会完成批注。' : 'Open the article and select View changes to compare the last confirmed text with the current version. Step through changes or locate them in the article, then select Mark as viewed. Opening alone does not clear the marker or resolve comments.'}</p>
        <p>{zh ? '首次记录只建立比较起点，不提示已有内容是改动。本地只保留最近一次确认版本；需要完整修改历史时另存副本或使用版本管理。' : 'The first record establishes a starting point without marking existing text as changed. Only the latest confirmed version is kept locally; use copies or version control for a full revision history.'}</p>
      </details>
      <section>
        <h3>{zh ? '先把这份规则交给 AI' : 'Give your AI the file rules'}</h3>
        <p>{zh ? '包含目录、文件名、图片和双语标记规则。使用外部 AI 写文件，无需在 MD Duck 配置密钥。' : 'Includes folders, filenames, images and bilingual markers. An external AI can prepare files without connecting an API key in MD Duck.'}</p>
        <PromptTools ui={ui} />
      </section>
      <details className="guide-details"><summary>{zh ? '文件应该怎样放？' : 'How should files be organized?'}</summary>
        <pre>{`my-library/\n  01-my-series/\n    01-intro/\n      article.md\n      article.zh.md\n      assets/\n    02-next-article/\n      article.md`}</pre>
        <p>{zh ? 'article.md 是原文，article.zh.md 是可选中文译文；图片用 assets/image.jpg 这样的相对路径。双语精确对照使用相同的 block 标记，完整示例在提示词中。' : 'article.md is the source; article.zh.md is optional Chinese. Use relative image paths like assets/image.jpg. Matching block markers enable precise bilingual pairing; the prompt includes an example.'}</p>
        <p>{zh ? '文章旁的 .review 和库内的 .mdduck 保存批注、词汇和管理记录。备份、搬家时一起保留；移动或归档优先用文章的“…”菜单。' : 'Keep .review and .mdduck when backing up or moving a library: they hold notes, vocabulary and library records. Use the article’s “…” menu to move or archive it.'}</p>
        <p>{zh ? '本机设置和未保存批注草稿只在当前电脑上，换电脑前先保存草稿。' : 'App settings and unsaved note drafts stay on this computer. Save drafts before switching computers.'}</p>
      </details>
      <section className="guide-platform">
        <div className="guide-platform-heading"><h3>{zh ? '常用操作' : 'Everyday controls'}</h3><div className="seg" role="group" aria-label={zh ? '查看系统操作' : 'Platform controls'}>
          <button aria-pressed={platform === 'mac'} className={platform === 'mac' ? 'on' : ''} onClick={() => setPlatform('mac')}>Mac</button>
          <button aria-pressed={platform === 'win'} className={platform === 'win' ? 'on' : ''} onClick={() => setPlatform('win')}>Windows</button>
        </div></div>
        <dl><div><dt>{zh ? '打开文件夹' : 'Open folder'}</dt><dd>{modifier} + O</dd></div>
          <div><dt>{zh ? '保存批注' : 'Save note'}</dt><dd>{modifier} + Enter</dd></div>
          <div><dt>{zh ? '选中文字后批注' : 'Comment on selected text'}</dt><dd>{platform === 'mac' ? '⌥' : 'Alt'} + Enter</dd></div>
          <div><dt>{zh ? '原文 / 中文 / 对照' : 'Source / Chinese / Bilingual'}</dt><dd>1 / 2 / 3</dd></div>
          <div><dt>{zh ? '查看真实文件' : 'Find the actual file'}</dt><dd>{zh ? (platform === 'mac' ? '右键文章 → 在 Finder 中显示' : '右键文章 → 显示文件所在位置') : (platform === 'mac' ? 'Right-click → Show in Finder' : 'Right-click → Show in folder')}</dd></div></dl>
      </section>
    </div>
    <footer className="guide-footer">
      <button className="btn small ghost" onClick={() => {
        setLinkError(false)
        void window.api.openExternal(`https://mdduck.com/${zh ? '' : 'en/'}guide/`).catch(() => setLinkError(true))
      }}><ExternalLink size={14} />{zh ? '完整图解与示例下载' : 'Full walkthrough and examples'}</button>
      {linkError && <span role="alert">{zh ? '无法打开浏览器，请访问 mdduck.com/guide/' : 'Could not open the browser. Visit mdduck.com/en/guide/'}</span>}
      <button className="btn small primary" onClick={() => dialogRef.current?.close()}>{zh ? '返回阅读' : 'Back to reading'}</button>
    </footer>
  </dialog>
}
