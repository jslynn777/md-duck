import { LoaderCircle, Pause, Play, Volume2, X } from 'lucide-react'
import type { DictionaryResult, WordExplanation } from '@shared/word-help'
import { useT, useUi } from './i18n'

export type WordCardProps = {
  word: string
  sentence: string
  dictionary?: DictionaryResult
  dictionaryLoading: boolean
  explanation?: WordExplanation
  loading: boolean
  error?: string
  detailLoading: boolean
  detailError?: string
  details?: WordExplanation
  hasKey: boolean
  voiceAccent: 'uk' | 'us'
  audioState?: { action: 'word' | 'slow' | 'sentence'; paused: boolean; preparing: boolean; message?: string }
  onStopAudio?: () => void
  onSpeak: () => void
  onSlowSpeak: () => void
  onReadSentence: () => void
  onDetail: () => void
  onRetry: () => void
  onRetryDictionary: () => void
  onSettings: () => void
  onClose: () => void
}

export function WordCard(props: WordCardProps) {
  const tr = useT()
  const ui = useUi()
  const pronunciations = [...(props.dictionary?.pronunciations ?? [])]
    .filter((item) => item.ipa.trim())
    .sort((a, b) => Number(b.accent === props.voiceAccent) - Number(a.accent === props.voiceAccent))
    .reduce<Array<{ accent?: 'uk' | 'us'; ipas: string[] }>>((groups, item) => {
      let group = groups.find((candidate) => candidate.accent === item.accent)
      if (!group) {
        group = { accent: item.accent, ipas: [] }
        groups.push(group)
      }
      const ipa = item.ipa.trim()
      if (!group.ipas.includes(ipa)) group.ipas.push(ipa)
      return groups
    }, [])
  const hasVariants = pronunciations.some((group) => group.ipas.length > 1)
  const hint = pronunciations[0] ? pronunciationHint(pronunciations[0].ipas, tr, ui) : ''
  const explanation = props.explanation ?? props.details
  const definitions = props.dictionary?.definitions.slice(0, 2) ?? []
  const details = props.details
  const sourceUrl = safeWebUrl(props.dictionary?.sourceUrl)
  const licenseUrl = safeWebUrl(props.dictionary?.license?.url)
  const zh = ui === 'zh'
  const audioState = props.audioState
  function audioButton(action: 'word' | 'slow' | 'sentence', label: string, onClick: () => void, disabled = false) {
    const active = audioState?.action === action
    const actionLabel = active ? (audioState.paused ? tr('resume') : tr('pause')) : label
    return <button type="button" onClick={onClick} disabled={disabled} aria-label={active ? `${actionLabel} · ${label}` : label} aria-pressed={active} title={active ? `${actionLabel} · ${label}` : undefined}>
      {active ? (audioState.paused ? <Play size={14} /> : audioState.preparing ? <LoaderCircle size={14} className="spin" /> : <Pause size={14} />) : action === 'word' ? <Volume2 size={14} /> : null}
      {actionLabel}
    </button>
  }

  return (
    <div className="word-card">
      <div className="word-card-header">
        <h2 className="word-card-word" lang="en">{props.word}</h2>
        <button type="button" className="word-card-close" onClick={props.onClose} aria-label={tr('close')} title={tr('close')}><X size={16} /></button>
      </div>
      <div className="word-card-content">
        <div className="word-card-pronunciations">
          {pronunciations.map((item) => (
            <span className="word-card-pronunciation" key={item.accent ?? 'ipa'}>
              <span className="word-card-accent">{item.accent === 'uk' ? tr('wordAccentUk') : item.accent === 'us' ? tr('wordAccentUs') : 'IPA'}</span>
              <span className="word-card-ipa">{item.ipas.slice(0, 2).join(' · ')}</span>
            </span>
          ))}
          {pronunciations.length === 0 && props.dictionaryLoading && <span className="word-card-status" role="status"><LoaderCircle className="spin" size={12} />{tr('wordDictionaryLoading')}</span>}
          {pronunciations.length === 0 && !props.dictionaryLoading && props.dictionary?.status === 'found' && <span className="word-card-status">{tr('wordNoPronunciation')}</span>}
        </div>
        {hasVariants && <p className="word-card-variants">{tr('wordPronunciationVariants')}</p>}
        {hint && <p className="word-card-reading-hint">{hint}</p>}

        {explanation ? (
          <section className="word-card-context">
            <div className="word-card-label">{tr('wordContextMeaning')}{explanation.partOfSpeech && <span className="word-card-pos">{explanation.partOfSpeech}</span>}</div>
            <p className="word-card-meaning">{explanation.meaning}</p>
          </section>
        ) : definitions.length > 0 ? (
          <section className="word-card-context">
            <div className="word-card-label">{tr('wordDictionaryMeaning')}</div>
            {definitions.map((item, index) => (
              <p className="word-card-definition" key={index}>
                {item.partOfSpeech && <span className="word-card-pos">{item.partOfSpeech}</span>}
                <span lang="en">{item.definition}</span>
              </p>
            ))}
          </section>
        ) : null}

        {props.dictionary?.status !== 'found' && !props.dictionaryLoading && (
          <div className="word-card-notice">
            <span>{tr(props.dictionary?.status === 'not-found' ? 'wordDictionaryNotFound' : 'wordDictionaryUnavailable')}</span>
            {props.dictionary?.status !== 'not-found' && <button type="button" className="word-card-text-button" onClick={props.onRetryDictionary}>{tr('wordRetryDictionary')}</button>}
          </div>
        )}

        {props.sentence.trim() && <blockquote className="word-card-sentence" lang="en"><WordInSentence word={props.word} sentence={props.sentence} /></blockquote>}

        {props.loading && <p className="word-card-status" role="status"><LoaderCircle className="spin" size={12} />{tr('wordContextLoading')}</p>}
        {props.hasKey && props.error && <div className="word-card-notice word-card-error" role="alert"><span>{props.error}</span><button type="button" className="word-card-text-button" onClick={props.onRetry} disabled={props.loading}>{tr('wordRetryContext')}</button></div>}
        {!props.hasKey && <div className="word-card-key-note"><p>{tr('wordContextKeyHint')}</p><button type="button" className="word-card-text-button" onClick={props.onSettings}>{tr('wordConfigureContext')}</button></div>}

        {props.hasKey && !details && (
          <div className="word-card-detail-entry">
            <button type="button" className="word-card-detail-button" onClick={props.onDetail} disabled={props.detailLoading || props.loading}>
              {props.detailLoading && <LoaderCircle className="spin" size={13} />}
              {tr(props.detailLoading ? 'wordDetailsLoading' : props.detailError ? 'wordRetryDetails' : 'wordDetails')}
            </button>
            {props.detailError && <p className="word-card-error" role="alert">{props.detailError}</p>}
          </div>
        )}

        {details && <section className="word-card-details" aria-label={tr('wordDetails')}>
          <h3>{tr('wordDetails')}</h3>
          {(details.formNote || details.lemma.toLowerCase() !== props.word.toLowerCase()) && <div className="word-card-detail"><h4>{tr('wordForm')}</h4><p>{details.lemma && <strong className="word-card-lemma" lang="en">{details.lemma}</strong>}{details.formNote}</p></div>}
          {details.usage && <div className="word-card-detail"><h4>{tr('wordUsage')}</h4><p>{details.usage}</p></div>}
          {details.example && <div className="word-card-detail"><h4>{tr('wordExample')}</h4><p lang="en">{details.example.en}</p>{details.example.zh && <p className="word-card-example-zh" lang="zh-CN">{details.example.zh}</p>}</div>}
          {details.memoryHint && <div className="word-card-detail"><h4>{tr('wordMemoryHint')}</h4><p>{details.memoryHint}</p></div>}
          {details.confusion && <div className="word-card-detail"><h4>{tr('wordConfusion')}</h4><p>{details.confusion}</p></div>}
        </section>}

        {(sourceUrl || props.dictionary?.license) && <div className="word-card-source">
          {sourceUrl && <a href={sourceUrl} onClick={(event) => { event.preventDefault(); void window.api.openExternal(sourceUrl) }}>{tr('wordDictionarySource')}</a>}
          {props.dictionary?.license && (licenseUrl
            ? <a href={licenseUrl} onClick={(event) => { event.preventDefault(); void window.api.openExternal(licenseUrl) }}>{props.dictionary.license.name}</a>
            : <span>{props.dictionary.license.name}</span>)}
        </div>}
      </div>
      <div className="word-card-audio">
        <div className="word-card-audio-actions">
          {audioButton('word', tr('readWord'), props.onSpeak)}
          {audioButton('slow', tr('wordSlowRead'), props.onSlowSpeak)}
          {audioButton('sentence', tr('readSentence'), props.onReadSentence, !props.sentence.trim())}
          {audioState && props.onStopAudio && <button type="button" onClick={props.onStopAudio}>{tr('stop')}</button>}
        </div>
        {audioState && <p className="word-card-status" role="status">{audioState.paused
          ? (audioState.preparing ? (zh ? '已暂停，语音仍在准备。' : 'Paused. Audio is still being prepared.') : (zh ? '已暂停，点击继续播放。' : 'Paused. Resume when ready.'))
          : audioState.preparing
            ? (audioState.message || (zh ? '正在准备发音…' : 'Preparing audio…'))
            : audioState.action === 'sentence' ? (zh ? '正在朗读原句。' : 'Reading the sentence.') : (zh ? '正在朗读单词。' : 'Reading the word.')}</p>}
        <p className="word-card-voice">{tr(props.voiceAccent === 'uk' ? 'wordSyntheticUk' : 'wordSyntheticUs')}</p>
      </div>
    </div>
  )
}

function WordInSentence({ word, sentence }: { word: string; sentence: string }) {
  if (!word) return <>{sentence}</>
  const folded = sentence.toLowerCase()
  const needle = word.toLowerCase()
  const isWordPart = (character: string | undefined) => !!character && /[\p{L}\p{N}'’_-]/u.test(character)
  let index = folded.indexOf(needle)
  while (index >= 0 && (isWordPart(sentence[index - 1]) || isWordPart(sentence[index + word.length]))) {
    index = folded.indexOf(needle, index + word.length)
  }
  if (index < 0) return <>{sentence}</>
  return <>{sentence.slice(0, index)}<mark>{sentence.slice(index, index + word.length)}</mark>{sentence.slice(index + word.length)}</>
}

function safeWebUrl(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function pronunciationHint(ipas: string[], tr: ReturnType<typeof useT>, ui: 'en' | 'zh') {
  const pieces: string[] = []
  if (ipas.every((ipa) => ipa.includes('ˈ'))) pieces.push(tr('wordStressHint'))
  const sound = [
    ['θ', 'wordSoundTheta'], ['ð', 'wordSoundEth'], ['ŋ', 'wordSoundNg'],
    ['eɪ', 'wordSoundEi'], ['aɪ', 'wordSoundAi'], ['ə', 'wordSoundSchwa']
  ] as const
  const match = sound.find(([symbol]) => ipas.every((ipa) => ipa.includes(symbol)))
  if (match) pieces.push(tr(match[1]))
  return pieces.join(ui === 'zh' ? '；' : '. ')
}
