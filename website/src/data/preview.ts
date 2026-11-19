// Actual application captures; release availability is controlled by release.ts.
export type SpaceCapture = {
  src: string;
  width: number;
  height: number;
  alt: { zh: string; en: string };
  caption: { zh: string; en: string };
};

// Only add actual captures of the isolated public demo. A missing capture renders
// no image or placeholder; never substitute a mock task status or user library.
export const spaceCaptures: Partial<Record<'overview' | 'switcher' | 'codex' | 'handoff', SpaceCapture>> = {
  overview: {
    src: '/images/spaces/overview.webp', width: 1440, height: 960,
    alt: { zh: 'MD Duck 空间管理界面，显示日常草稿、系列指南和双语审阅三个独立演示文件夹。', en: 'MD Duck’s space overview with three independent demo folders: everyday drafts, series guides and bilingual review.' },
    caption: { zh: 'Mac beta.10 实际截图 · 独立演示文件夹 · 点击查看完整界面', en: 'Actual Mac beta.10 capture · independent demo folders · click for the full view' },
  },
  switcher: {
    src: '/images/spaces/switcher.webp', width: 1440, height: 960,
    alt: { zh: '阅读文章时展开右上角空间菜单，切换日常草稿、系列指南和双语审阅。', en: 'The space menu at the top right of the reader, with everyday drafts, series guides and bilingual review.' },
    caption: { zh: 'Mac beta.10 实际截图 · 点击右上角名称切换空间', en: 'Actual Mac beta.10 capture · switch spaces from the name at the top right' },
  },
  codex: {
    src: '/images/spaces/codex-task.webp', width: 1440, height: 960,
    alt: { zh: 'Codex 本地任务面板，显示演示空间的工作目录、当前文章和待提交的修改要求。', en: 'The local Codex task panel showing the demo working folder, current article and a revision request ready to submit.' },
    caption: { zh: 'Mac beta.10 实际截图 · 仅填写要求，尚未提交任务', en: 'Actual Mac beta.10 capture · request entered, task not submitted' },
  },
  handoff: {
    src: '/images/spaces/ai-handoff.webp', width: 1440, height: 960,
    alt: { zh: '给 AI 的空间说明中包含演示空间标识、公开演示目录、文章相对路径及打开链接。', en: 'Space instructions for AI with a demo space ID, public demo directory, relative article path and opening link.' },
    caption: { zh: 'Mac beta.10 实际截图 · 复制你自己电脑上的说明，图中路径仅供演示', en: 'Actual Mac beta.10 capture · copy instructions from your own computer; pictured paths are for the demo' },
  },
};
