export type TranslationPhase = 'idle' | 'running' | 'paused' | 'failed' | 'complete' | 'stale'

export type TranslationState = {
  sourcePath: string
  targetPath: string
  phase: TranslationPhase
  completed: number
  total: number
  error?: string
  model?: string
}

export type TranslationInfo = {
  sourcePath: string
  targetPath: string
  hasTranslation: boolean
  canTranslate: boolean
  reason?: 'empty' | 'chinese' | 'unsupported' | 'target-exists'
  task: TranslationState | null
}

export type TranslationAlignment = {
  sourceHash: string
  targetHash: string
  pairs: Array<{ sourceKey: string; targetKey: string }>
}
