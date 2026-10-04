import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSettingsWriter, defaultUiLanguage } from './settings-store'

const fixtures: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })))
})
async function file() {
  const root = await fs.mkdtemp(join(tmpdir(), 'md-duck-settings-test-'))
  fixtures.push(root)
  return join(root, 'profile', 'settings.json')
}
describe('settings persistence', () => {
  it('uses the first system language for first-run Chinese and preserves language priority', () => {
    expect(defaultUiLanguage(['zh-Hans-CN', 'en-US'])).toBe('zh')
    expect(defaultUiLanguage(['zh_TW'])).toBe('zh')
    expect(defaultUiLanguage(['en-US', 'zh-CN'])).toBe('en')
    expect(defaultUiLanguage([])).toBe('en')
  })
  it('captures and serializes writes, and flush waits for the latest value before exit', async () => {
    const path = await file()
    const writer = createSettingsWriter(path)
    const value = { prefs: { ui: 'en' } }
    const first = writer.write(value)
    value.prefs.ui = 'zh'
    const last = writer.write(value)
    await writer.flush()
    await Promise.all([first, last])
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual({ prefs: { ui: 'zh' } })
    expect(await fs.readdir(join(path, '..'))).toEqual(['settings.json'])
  })
  it('does not discard the last good settings after a failed write and can retry', async () => {
    const path = await file()
    const writer = createSettingsWriter(path)
    await writer.write({ ui: 'en' })
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(writer.write({ ui: 'zh' })).rejects.toThrow('disk unavailable')
    await expect(writer.flush()).rejects.toThrow('disk unavailable')
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual({ ui: 'en' })
    await writer.write({ ui: 'zh' })
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual({ ui: 'zh' })
  })
})
