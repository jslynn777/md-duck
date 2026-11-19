import { createContext, useContext } from 'react'
import type { Lang } from '@shared/types'
import { useT, useUi } from './i18n'
import { documentLanguageLabel } from './document-language'

export const ReadingLanguages = createContext<{ source?: string; zh?: string }>({})

export function useReadingLanguage(side: Lang, currentDocument = true) {
  const ui = useUi()
  const tr = useT()
  const languages = useContext(ReadingLanguages)
  const tag = currentDocument ? languages[side] : undefined
  const role = tr(side === 'source' ? 'sourceRole' : 'translationRole')
  const name = documentLanguageLabel(tag, ui, role)
  const other = documentLanguageLabel(languages[side === 'source' ? 'zh' : 'source'], ui, '')
  const label = tag && other === name ? (ui === 'zh' ? name + role : name + ' · ' + role) : name
  return { tag, label }
}

// Keep the English tools available for short unlabelled originals as in older libraries.
export function supportsEnglishTools(tag?: string) {
  return !tag || tag.split('-')[0] === 'en'
}
