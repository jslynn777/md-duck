import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WordCard, type WordCardProps } from './WordCard'
import { UiProvider } from './i18n'

vi.mock('@shared/i18n', async () => await import('../../shared/i18n'))

function markup(audioState?: WordCardProps['audioState'], ui: 'en' | 'zh' = 'en') {
  const props: WordCardProps = {
    word: 'ribbon', sentence: 'A ribbon holds its shape.',
    dictionaryLoading: false, loading: false, detailLoading: false, hasKey: false, voiceAccent: 'us',
    onSpeak: vi.fn(), onSlowSpeak: vi.fn(), onReadSentence: vi.fn(), onDetail: vi.fn(),
    onRetry: vi.fn(), onRetryDictionary: vi.fn(), onSettings: vi.fn(), onClose: vi.fn(), onStopAudio: vi.fn(), audioState
  }
  return renderToStaticMarkup(createElement(UiProvider, { value: ui }, createElement(WordCard, props)))
}

describe('word card playback feedback', () => {
  it('shows pending download progress next to a word and offers pause and stop', () => {
    const html = markup({ action: 'word', paused: false, preparing: true, message: 'Downloading voice files… 23%' })
    expect(html).toContain('Downloading voice files… 23%')
    expect(html).toContain('aria-label="Pause · Say the word"')
    expect(html).toContain('>Stop (Esc)</button>')
  })

  it('shows the paused intent even while the voice is still preparing', () => {
    const html = markup({ action: 'slow', paused: true, preparing: true, message: 'Downloading voice files… 23%' })
    expect(html).toContain('Paused. Audio is still being prepared.')
    expect(html).not.toContain('Downloading voice files… 23%')
    expect(html).toContain('aria-label="Resume · Slowly"')
  })

  it('reports sentence playback separately and keeps the two word actions available', () => {
    const html = markup({ action: 'sentence', paused: false, preparing: false })
    expect(html).toContain('Reading the sentence.')
    expect(html).toContain('aria-label="Pause · Say the sentence"')
    expect(html).toContain('aria-label="Say the word"')
    expect(html).toContain('aria-label="Slowly"')
  })

  it('returns to plain reading actions without a stale stop or progress message after playback ends', () => {
    const html = markup()
    expect(html).not.toContain('>Stop (Esc)</button>')
    expect(html).not.toContain('Preparing audio')
    expect(html).not.toContain('Reading the word.')
    expect(html).toContain('aria-label="Say the word"')
  })

  it('uses Chinese paused feedback in a Chinese interface', () => {
    const html = markup({ action: 'word', paused: true, preparing: false }, 'zh')
    expect(html).toContain('已暂停，点击继续播放。')
    expect(html).toContain('aria-label="继续 · 读这个词"')
  })
})
