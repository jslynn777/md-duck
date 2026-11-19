import type { UiLang } from './types'

/** The identity stays stable when a space is renamed or its folder is relocated. */
export type SpaceRecord = {
  id: string
  name: string
  root: string
  createdAt: string
  lastOpenedAt: string
}

export type SpaceRegistry = {
  version: 1
  activeSpaceId: string | null
  spaces: SpaceRecord[]
  /** Removed shortcuts retain identities so re-adding a folder restores its saved reading data. */
  removed?: SpaceRecord[]
}

/** Live reader information; it is not a second copy of the article library. */
export type SpaceSummary = SpaceRecord & {
  openPath: string | null
  lastTitle?: string
  previewText?: string
  previewImages?: string[]
  activity?: { kind: 'external-write' | 'translation'; at: string; path?: string }
  codexTask?: { phase: import('./codex-task').CodexTaskPhase; activity: string; updatedAt: string }
  changedCount?: number
  changeIssue?: boolean
  availability: 'ready' | 'missing' | 'unreadable'
  unavailableReason?: 'settings'
  windowOpen: boolean
}

export type SpaceTarget = {
  spaceId: string
  relativePath?: string
}

export type SpaceContext = {
  space: SpaceRecord
  relativePath?: string | null
}

export function validSpaceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
}

/** A protocol target is an article relative to a chosen space, never a local absolute path. */
export function normalizeSpaceArticlePath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('ERR_SPACE_TARGET')
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || path.includes(':') || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('ERR_SPACE_TARGET')
  if (!/\.(?:md|markdown)$/i.test(path)) throw new Error('ERR_SPACE_TARGET')
  return path
}

export function spaceOpenUrl(target: SpaceTarget): string {
  if (!validSpaceId(target.spaceId)) throw new Error('ERR_SPACE_TARGET')
  const url = new URL('mdduck://open')
  url.searchParams.set('space', target.spaceId)
  if (target.relativePath !== undefined) url.searchParams.set('path', normalizeSpaceArticlePath(target.relativePath))
  return url.href
}

/** This describes a target; it does not grant an AI filesystem or publishing access. */
export function spaceContextPrompt(context: SpaceContext, language: UiLang): string {
  const { space } = context
  const relativePath = context.relativePath ? normalizeSpaceArticlePath(context.relativePath) : undefined
  const url = spaceOpenUrl({ spaceId: space.id, relativePath })
  if (language === 'zh') return `请在 MD Duck 的「${space.name}」空间处理本次文章任务。

空间标识：${space.id}
本地根目录：${space.root}
当前文章（相对于根目录）：${relativePath ?? '尚未指定，请先确定要处理的文章'}
在 MD Duck 打开：${url}

工作规则：
1. 先核对这个空间的本地目录与目标文件。任务始终绑定上述空间；我切换阅读窗口或空间，不代表允许改变任务目标。
2. MD Duck 直接读取本地 Markdown。沿用现有目录：零散文章可放根目录，系列放子文件夹；有译文或图片时可每篇一个文件夹。原稿 article.md 对应 article.zh.md，图片放 assets/ 并用相对路径引用。保留现有文件名、图片路径及 <!-- block:... --> 标记；已有译文时同步修改受影响的内容。
3. 只修改我指定的文章。不要修改 .review/、.mdduck/、批注、词汇记录或应用设置，也不要移动、删除或覆盖无关文件。
4. 如果你有本地文件权限，保存回原文件并报告实际路径与改动内容；没有访问权限时明确说明，并提供我能手动保存的内容，不要声称已修改本机文件。
5. 完成后使用上面的打开链接让我回到正确空间复核。打开链接只定位阅读内容，不会自动批准修改、完成批注或发布文章。发布需要另行明确授权。

本次要求：
[补充需要处理的文章、段落或要求]`
  return `Work on this article task in the MD Duck space “${space.name}”.

Space ID: ${space.id}
Local root folder: ${space.root}
Current article (relative to the root): ${relativePath ?? 'Not specified; identify the target article first'}
Open in MD Duck: ${url}

Working rules:
1. Check this root folder and the target file first. Keep this task bound to the space above. Switching my reading window or space does not change the task target.
2. MD Duck reads local Markdown directly. Preserve the current organization: standalone articles can live in the root, series in subfolders, and articles with translations or images can have their own folders. article.md pairs with article.zh.md; keep images in assets/ and reference them with relative paths. Preserve filenames, image paths and existing <!-- block:... --> markers. Update affected parts of an existing companion translation.
3. Modify only the articles I specify. Do not modify .review/, .mdduck/, comments, word records or application settings, or move, delete or overwrite unrelated files.
4. With local filesystem access, save at the original location and report actual paths and changes. Without access, say so and provide content I can save manually; never claim that local files were changed.
5. When finished, use the link above to return me to the correct space for review. Opening the link only locates reading content; it does not approve changes, complete comments or publish articles. Publishing requires separate explicit authorization.

Task:
[Specify the articles, passages or changes to work on]`
}
