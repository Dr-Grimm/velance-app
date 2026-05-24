export const AI_PROVIDER_OPTIONS = Object.freeze([
  {
    id: 'gemini',
    label: 'Gemini',
    defaultModel: 'gemini-3-flash-preview',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyHint: 'Google AI Studio key',
    modelHint: 'Choose a current Gemini API model',
    modelOptions: [
      {
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash',
        description: 'Current fast Gemini 3 API model for everyday Velance coaching.',
      },
      {
        id: 'gemini-3-pro-preview',
        label: 'Gemini 3 Pro',
        description: 'Current most capable Gemini 3 API model for deeper reasoning.',
      },
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Stable compatibility fallback when a key cannot access preview models.',
      },
    ],
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI / compatible',
    defaultModel: 'gpt-5.1',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHint: 'OpenAI or compatible API key',
    modelHint: 'Choose an OpenAI model or enter the exact compatible model',
    modelOptions: [
      {
        id: 'gpt-5.1',
        label: 'GPT-5.1',
        description: 'Latest flagship OpenAI option for deeper coaching reviews.',
      },
      {
        id: 'gpt-5.1-chat-latest',
        label: 'GPT-5.1 Chat',
        description: 'Current ChatGPT-style model for concise coaching responses.',
      },
      {
        id: 'gpt-5-mini',
        label: 'GPT-5 mini',
        description: 'Recommended default for fast, cost-aware coaching.',
      },
      {
        id: 'gpt-5-nano',
        label: 'GPT-5 nano',
        description: 'Lowest-cost OpenAI option for lightweight summaries.',
      },
      {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        description: 'Strong non-reasoning fallback for broad compatibility.',
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyHint: 'Anthropic API key',
    modelHint: 'Choose a Claude API model',
    modelOptions: [
      {
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        description: 'Documented speed/intelligence balance for Velance coaching.',
      },
      {
        id: 'claude-opus-4-1-20250805',
        label: 'Claude Opus 4.1',
        description: 'Documented most capable Claude option for complex reasoning.',
      },
      {
        id: 'claude-3-5-haiku-20241022',
        label: 'Claude Haiku 3.5',
        description: 'Fast documented Claude option for frequent insight refreshes.',
      },
    ],
  },
])

const PROVIDER_IDS = new Set(AI_PROVIDER_OPTIONS.map((provider) => provider.id))
const DEPRECATED_MODEL_MAP = Object.freeze({
  'models/gemini-3-pro-preview': 'gemini-3-pro-preview',
  'gemini-2.5-pro': 'gemini-3-pro-preview',
  'models/gemini-2.5-pro': 'gemini-3-pro-preview',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash',
  'models/gemini-2.5-flash-lite': 'gemini-2.5-flash',
  'gemini-2.0-flash': 'gemini-3-flash-preview',
  'models/gemini-2.0-flash': 'gemini-3-flash-preview',
  'gemini-3.1-pro-preview': 'gemini-3-pro-preview',
  'models/gemini-3.1-pro-preview': 'gemini-3-pro-preview',
  'gemini-3.1-flash-lite-preview': 'gemini-2.5-flash',
  'models/gemini-3.1-flash-lite-preview': 'gemini-2.5-flash',
  'claude-sonnet-4-6': 'claude-sonnet-4-20250514',
  'claude-opus-4-7': 'claude-opus-4-1-20250805',
  'claude-haiku-4-5-20251001': 'claude-3-5-haiku-20241022',
})

export function normalizeAiProvider(provider = 'gemini') {
  const safe = String(provider || '').trim().toLowerCase()
  return PROVIDER_IDS.has(safe) ? safe : 'gemini'
}

export function getAiProviderMeta(provider = 'gemini') {
  const safeProvider = normalizeAiProvider(provider)
  return AI_PROVIDER_OPTIONS.find((entry) => entry.id === safeProvider) || AI_PROVIDER_OPTIONS[0]
}

export function normalizeAiModel(provider = 'gemini', model = '') {
  const meta = getAiProviderMeta(provider)
  const raw = String(model || '').trim()
  const mapped = DEPRECATED_MODEL_MAP[raw] || DEPRECATED_MODEL_MAP[raw.toLowerCase()] || raw
  if (provider === 'gemini') {
    const clean = mapped.replace(/^models\//, '')
    const supported = meta.modelOptions?.some((option) => option.id === clean)
    return supported ? clean : meta.defaultModel
  }
  return mapped || meta.defaultModel || ''
}

export function normalizeAiSettings(settings = {}) {
  const provider = normalizeAiProvider(settings.aiProvider || 'gemini')
  const meta = getAiProviderMeta(provider)
  const keyProvider = settings.aiKeyProvider ? normalizeAiProvider(settings.aiKeyProvider) : ''
  const keyMatchesProvider = !keyProvider || keyProvider === provider
  const apiKey = String(settings.geminiApiKey || settings.aiApiKey || settings.apiKey || '').trim()
  const model = normalizeAiModel(provider, settings.aiModel || meta.defaultModel || '')
  const baseUrl = String(settings.aiBaseUrl || meta.defaultBaseUrl || '').trim()
  const hasDraftKey = apiKey.length > 0
  const hasStoredKey = Boolean(settings.hasAiApiKey) && keyMatchesProvider

  return {
    provider,
    providerLabel: meta.label,
    keyProvider,
    keyMatchesProvider,
    apiKey,
    model,
    baseUrl,
    keyHint: meta.keyHint,
    modelHint: meta.modelHint,
    modelOptions: meta.modelOptions || [],
    hasKey: hasDraftKey || hasStoredKey,
    hasUsableKey: hasDraftKey,
    hasModel: provider === 'gemini' ? true : model.length > 0,
  }
}

export function hasConfiguredAiKey(settings = {}) {
  return normalizeAiSettings(settings).hasKey
}

export function getAiModeLabel(settings = {}) {
  const normalized = normalizeAiSettings(settings)
  return normalized.hasKey ? `${normalized.providerLabel} BYOK` : 'Local analysis'
}
