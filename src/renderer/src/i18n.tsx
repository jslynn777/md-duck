import { createContext, useContext } from 'react'
import { t as translate, type MessageKey } from '@shared/i18n'
import type { UiLang } from '@shared/types'

const UiContext = createContext<UiLang>('en')

export const UiProvider = UiContext.Provider

export function useUi() {
  return useContext(UiContext)
}

export function useT() {
  const lang = useUi()
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars)
}
