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

/** Describes the existing local record without creating or repairing pairs. */
export type TranslationAlignmentState = 'absent' | 'valid' | 'stale' | 'invalid'
export type TranslationAlignmentInspection = {
  alignment: TranslationAlignment | null
  state: TranslationAlignmentState
}
