// Public release dates and changes verified against GitHub release notes.
// These are product releases, not a list of planned features or website edits.
export const releaseHistory = [
  {
    version: '0.1.0-beta.5',
    publishedAt: '2026-10-10T11:12:36Z',
    date: '2026-10-10',
    title: { zh: '两种语言，逐段读明白。', en: 'Read both versions with care.' },
    description: {
      zh: '整篇配对检查与问题定位，帮助核对原文和译文；保留本地神经朗读。Mac 与 Windows 公开测试包一同提供。',
      en: 'Whole-document pairing checks locate problems in the source and translation, alongside local neural speech. Public test builds for Mac and Windows.',
    },
  },
  {
    version: '0.1.0-beta.6',
    publishedAt: '2026-10-16T06:49:05Z',
    date: '2026-10-16',
    title: { zh: '文章多了，文件夹来整理。', en: 'Give growing collections some order.' },
    description: {
      zh: '本地目录双向同步，批量建稿、排序、移动与归档。整理文章时，译文、批注、素材和阅读位置一起保留。',
      en: 'Two-way folder updates, batch drafts, ordering, moves and archiving. Keep translations, annotations, assets and reading positions with the work.',
    },
  },
  {
    version: '0.1.0-beta.7',
    publishedAt: '2026-10-29T07:20:05Z',
    date: '2026-10-29',
    title: { zh: '改过哪一篇，回来就找到。', en: 'Find what changed. Read it again.' },
    description: {
      zh: '改动提醒、筛选与修改前后对照。打开文章不会清除提醒，检查过后，再由你标为已查看。',
      en: 'Change markers, filtering and before-and-after comparisons. Opening an article keeps the reminder; you mark it reviewed when you are done.',
    },
  },
  {
    version: '0.1.0-beta.10',
    publishedAt: '2026-11-19T14:25:40Z',
    date: '2026-11-19',
    title: { zh: '多个项目，各有自己的空间。', en: 'A space for each project.' },
    description: {
      zh: '切换空间，接着上次的位置读。复制准确的文章位置给 AI，也可启动独立 Codex 任务，完成后由你审阅。',
      en: 'Switch spaces and resume reading. Give any AI a precise article location, or start an independent local Codex task and review its saved changes.',
    },
  },
] as const;
