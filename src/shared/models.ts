import type { ModelCatalog, ModelOption } from './types'

export const RECOMMENDED_MODELS = [
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5-mini'
] as const

type RawModel = {
  id?: string
  name?: string
  created?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

const FALLBACK: ModelOption[] = [
  { id: 'openai/gpt-4o-mini', name: 'OpenAI: GPT-4o-mini', promptPerM: 0.15, completionPerM: 0.6 },
  { id: 'google/gemini-2.5-flash', name: 'Google: Gemini 2.5 Flash', promptPerM: 0.3, completionPerM: 2.5 },
  { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', promptPerM: 2, completionPerM: 10 },
  { id: 'openai/gpt-5-mini', name: 'OpenAI: GPT-5 Mini', promptPerM: 0.25, completionPerM: 2 }
]

export function buildCatalog(models: RawModel[]): ModelCatalog {
  const chat = models.flatMap((model) => {
    const option = toOption(model)
    return option && isChat(model) ? [option] : []
  })
  const byId = new Map(chat.map((model) => [model.id, model]))
  const recommended = RECOMMENDED_MODELS.flatMap((id) => {
    const live = byId.get(id)
    return live ? [live] : FALLBACK.filter((item) => item.id === id)
  })
  const latest = [...chat].sort((a, b) => b.created - a.created).slice(0, 6)
  const expensive = [...chat].sort((a, b) => b.promptPerM + b.completionPerM - (a.promptPerM + a.completionPerM)).slice(0, 6)
  return {
    recommended: recommended.length ? recommended : FALLBACK,
    latest,
    expensive,
    live: chat.length > 0
  }
}

export function fallbackCatalog(): ModelCatalog {
  return { recommended: FALLBACK, latest: [], expensive: [], live: false }
}

export function formatPrice(amount: number) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '—'
  if (value >= 10) return `$${value.toFixed(0)}`
  return `$${value.toFixed(2)}`
}

function toOption(model: RawModel): (ModelOption & { created: number }) | null {
  if (!model.id || !model.name) return null
  const prompt = Number(model.pricing?.prompt)
  const completion = Number(model.pricing?.completion)
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return null
  return {
    id: model.id,
    name: model.name,
    promptPerM: prompt * 1_000_000,
    completionPerM: completion * 1_000_000,
    created: model.created ?? 0
  }
}

function isChat(model: RawModel) {
  const id = model.id ?? ''
  if (!id || id.startsWith('~') || id.includes(':batch') || id.startsWith('stealth/')) return false
  if (/(image|embed|whisper|tts|audio|moderation)/i.test(id)) return false
  const input = model.architecture?.input_modalities ?? []
  const output = model.architecture?.output_modalities ?? []
  if (input.length && !input.includes('text')) return false
  if (output.length && !output.includes('text')) return false
  return true
}
