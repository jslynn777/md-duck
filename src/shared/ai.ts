export type AIProvider = 'openrouter' | 'deepseek' | 'custom'
export type AIConnectionStatus = 'unconfigured' | 'untested' | 'connected' | 'error'

export type AIProfile = {
  baseUrl: string
  model: string
  hasKey: boolean
  status: AIConnectionStatus
  error?: string
}

export type AISettings = {
  provider: AIProvider
  profiles: Record<AIProvider, AIProfile>
}

export type AIConfigInput = {
  provider: AIProvider
  baseUrl: string
  model: string
  /** Omitted keeps the saved key; null removes it. Never returned to the renderer. */
  key?: string | null
}

export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export const AI_PRESETS = {
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', helpUrl: 'https://openrouter.ai/keys' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', helpUrl: 'https://platform.deepseek.com/api_keys' },
  custom: { name: '自定义服务', baseUrl: '', model: '', helpUrl: '' }
} as const
