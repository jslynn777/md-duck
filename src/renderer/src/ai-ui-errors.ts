import type { UiLang } from '../../shared/types'

// IPC errors can wrap the stable main-process code. Never display raw provider
// errors: some services echo request details or credentials in their messages.
function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
}
function codeOf(raw: string): string {
  return raw.match(/\b(?:ERR_[A-Z_]+|NO_KEY)\b/)?.[0] ?? ''
}

export function friendlyAIError(cause: unknown, ui: UiLang): string {
  const zh = ui === 'zh'
  const raw = errorText(cause)
  const code = codeOf(raw)
  const specific: Record<string, [string, string]> = {
    ERR_BAD_KEY: ['密钥无效或没有访问权限。请检查所选服务和密钥。', 'The key is invalid or lacks permission. Check the selected service and key.'],
    ERR_NO_CREDIT: ['账户额度不足。请到所选服务补充 API 额度后重试。', 'Your account has insufficient API credit. Add credit with the selected service and retry.'],
    ERR_MODEL: ['该模型不可用。请检查高级设置中的模型名称和接口地址。', 'This model is unavailable. Check the model name and API URL in advanced settings.'],
    ERR_RATE_LIMIT: ['请求过于频繁，请稍后重试。', 'Too many requests. Please try again shortly.'],
    ERR_TIMEOUT: ['连接超时，请检查网络后重试。', 'The connection timed out. Check your network and retry.'],
    ERR_AUTH_TIMEOUT: ['浏览器授权已超时，可以重新连接或填写密钥。', 'Browser authorization timed out. Connect again or enter a key.'],
    ERR_AUTH: ['浏览器授权未完成，可以重试或手动填写密钥。', 'Browser authorization did not finish. Try again or enter a key manually.'],
    ERR_CANCELLED: ['已取消连接，可以重试或填写密钥。', 'Connection canceled. Try again or enter a key.'],
    ERR_NETWORK: ['无法连接到 AI 服务。请检查网络和接口地址。', 'Could not reach the AI service. Check your network and API URL.'],
    ERR_CONFIG: ['服务设置不完整或格式有误，请检查密钥、模型名称和接口地址。', 'The service settings are incomplete or invalid. Check the key, model name, and API URL.'],
    ERR_STORAGE: ['无法安全保存密钥，请检查系统凭据存储与目录访问权限后重试。', 'Could not securely save the key. Check system credential storage and folder permissions, then retry.'],
    NO_KEY: ['请先为所选服务填写 API 密钥。', 'Add an API key for the selected service first.'],
    ERR_NO_KEY: ['请先为所选服务填写 API 密钥。', 'Add an API key for the selected service first.'],
    ERR_BAD_RESPONSE: ['AI 服务返回的内容无法读取，请重试或更换模型。', 'The AI service returned unreadable content. Try again or choose another model.'],
    ERR_NO_TEXT: ['AI 服务未返回内容，请重试或更换模型。', 'The AI service returned no content. Try again or choose another model.'],
    ERR_TRUNCATED: ['AI 服务返回的内容不完整，请重试或更换模型。', 'The AI service returned incomplete content. Try again or choose another model.'],
    ERR_STATUS: ['AI 服务暂时不可用，请稍后重试。', 'The AI service is temporarily unavailable. Please retry shortly.']
  }
  if (specific[code]) return specific[code][zh ? 0 : 1]
  if (/401|403|invalid.?key|unauthori[sz]ed|authentication|密钥.*无效|认证失败/i.test(raw)) return specific.ERR_BAD_KEY[zh ? 0 : 1]
  if (/402|insufficient|quota|credit|balance|余额|额度|充值/i.test(raw)) return specific.ERR_NO_CREDIT[zh ? 0 : 1]
  if (/429|rate.?limit|频率|限流/i.test(raw)) return specific.ERR_RATE_LIMIT[zh ? 0 : 1]
  if (/model.*(not|invalid|unavailable)|模型.*(不存在|不可用)|404/i.test(raw)) return specific.ERR_MODEL[zh ? 0 : 1]
  if (/timeout|timed.?out|超时/i.test(raw)) return specific.ERR_TIMEOUT[zh ? 0 : 1]
  if (/fetch failed|network|ECONN|ENOTFOUND|网络|连接失败/i.test(raw)) return specific.ERR_NETWORK[zh ? 0 : 1]
  if (/cancel|取消/i.test(raw)) return specific.ERR_CANCELLED[zh ? 0 : 1]
  return zh ? '操作未完成，请检查服务设置后重试。' : 'The operation could not be completed. Check the service settings and retry.'
}

export function translationError(cause: unknown, ui: UiLang): string {
  const zh = ui === 'zh'
  const raw = errorText(cause)
  const code = codeOf(raw)
  const specific: Record<string, [string, string]> = {
    ERR_TRANSLATION_SOURCE_CHANGED: ['原文已变化，请按最新内容重新翻译。', 'The source changed. Start a new translation from the latest content.'],
    ERR_TRANSLATION_TARGET_EXISTS: ['目标译文文件已存在。请选择已有译文，或先为现有文件改名。', 'The translation file already exists. Choose that file, or rename it before creating a new translation.'],
    ERR_TRANSLATION_TARGET_EMPTY: ['选择的译文文件是空的，请选择已有内容的文件。', 'The selected translation is empty. Choose a file containing translated text.'],
    ERR_TRANSLATION_INVALID_TARGET: ['请选择另一份 Markdown 译文文件，原文不能与自身对照。', 'Choose another Markdown file. An article cannot be paired with itself.'],
    ERR_TRANSLATION_TARGET_MISSING: ['找不到选择的译文文件，请重新选择。', 'The selected translation could not be found. Choose the file again.'],
    ERR_TRANSLATION_TOO_LARGE: ['文章过长，暂时无法一次翻译。可以先拆成较短的 Markdown 文件。', 'This article is too long to translate at once. Split it into shorter Markdown files first.'],
    ERR_TRANSLATION_BLOCK_TOO_LARGE: ['文章中有过长的段落，请先分段再翻译。', 'The article contains an oversized section. Split it into shorter sections before translating.'],
    ERR_TRANSLATION_BAD_RESPONSE: ['AI 返回的译文不完整，请重试或更换模型；已完成的段落会保留。', 'The AI returned an incomplete translation. Retry or choose another model; completed sections are kept.'],
    ERR_TRANSLATION_STRUCTURE: ['译文结构与原文不一致，尚未保存译文。请更换模型后重试。', 'The translation structure does not match the source, so no translation file was saved. Try another model.'],
    ERR_TRANSLATION_RUNNING: ['这篇文章正在翻译，请先停止当前任务。', 'This article is already being translated. Stop the current task first.'],
    ERR_TRANSLATION_UNSUPPORTED: ['当前文件无法自动翻译，可选择已有译文。', 'This file cannot be translated automatically. Choose an existing translation.'],
    ERR_TRANSLATION_CHINESE: ['当前文章已是中文，可选择另一份语言文件进行对照。', 'This article is already in Chinese. Choose a counterpart file to read side by side.'],
    ERR_TRANSLATION_EMPTY: ['文章还没有可以翻译的内容。', 'This article has no content to translate yet.'],
    ERR_TRANSLATION_PAUSED: ['翻译已暂停，可从已保存的进度继续。', 'Translation paused. You can continue from the saved progress.'],
    ERR_TRANSLATION_FAILED: ['翻译未完成，可以重试；已完成的段落会保留。', 'Translation did not finish. Retry to continue from completed sections.'],
    ERR_NOT_IN_FOLDER: ['无法访问文章文件，请重新选择文件或所在文件夹。', 'The article cannot be accessed. Open the file or its folder again.']
  }
  if (specific[code]) return specific[code][zh ? 0 : 1]
  if (/EACCES|EPERM|permission|写入|保存失败|权限/i.test(raw)) return zh ? '无法保存译文，请检查文章所在文件夹的写入权限。' : 'Could not save the translation. Check write access to the article folder.'
  if (/ENOENT|not found|文件不存在|文件.*删除/i.test(raw)) return zh ? '找不到文章文件，请重新打开文章。' : 'The article file could not be found. Open it again.'
  return friendlyAIError(cause, ui)
}
