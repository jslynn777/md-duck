import { describe, expect, it } from 'vitest'
import { friendlyAIError, translationError } from './ai-ui-errors'

describe('AI error messages at the IPC boundary', () => {
  it('distinguishes invalid keys, credit, and model configuration errors', () => {
    expect(friendlyAIError(new Error("Error invoking remote method 'ai:test': Error: ERR_BAD_KEY"), 'zh')).toContain('密钥无效')
    expect(friendlyAIError('ERR_NO_CREDIT', 'zh')).toContain('额度不足')
    expect(friendlyAIError('ERR_MODEL', 'zh')).toContain('模型不可用')
  })
  it('distinguishes an authorization timeout from a request timeout', () => {
    expect(friendlyAIError('ERR_AUTH_TIMEOUT', 'zh')).toContain('浏览器授权')
    expect(friendlyAIError('ERR_TIMEOUT', 'en')).toContain('connection timed out')
  })
  it('never exposes a raw error that contains request data or a key', () => {
    const secret = 'sk-provider-secret-placeholder'
    expect(friendlyAIError(`Unexpected response with token ${secret}`, 'zh')).not.toContain(secret)
    expect(translationError(`Unexpected response with token ${secret}`, 'en')).not.toContain(secret)
  })
  it('reports local key storage failures separately from remote service failures', () => {
    expect(friendlyAIError('ERR_STORAGE', 'zh')).toContain('安全保存密钥')
    expect(friendlyAIError('ERR_NETWORK', 'zh')).toContain('无法连接')
  })
  it('tells the user how to recover a source change or existing translation', () => {
    expect(translationError('ERR_TRANSLATION_SOURCE_CHANGED', 'zh')).toContain('原文已变化')
    expect(translationError('ERR_TRANSLATION_TARGET_EXISTS', 'en')).toContain('Choose that file')
    expect(translationError('ERR_TRANSLATION_STRUCTURE', 'zh')).toContain('尚未保存译文')
  })
  it('keeps service error detail when it interrupts a translation', () => {
    expect(translationError('ERR_NO_CREDIT', 'zh')).toContain('额度不足')
    expect(translationError('ERR_BAD_KEY', 'en')).toContain('key is invalid')
  })
})
