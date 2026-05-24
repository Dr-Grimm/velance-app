/**
 * AI-assisted activity classification service.
 *
 * Sends unknown/unclear activities to the user's BYOK AI provider for
 * classification. Results are cached per-workspace in localStorage so the
 * same domain or app is never sent to the API twice (within the TTL).
 *
 * The cache is kept separate from user-defined custom rules so the two are
 * easy to distinguish, inspect, and reset independently.
 */

import { CATEGORY_COLORS, TRACKING_LANE_KEYS } from './activityClassification.js'

const AI_CACHE_KEY_PREFIX = 'velance_ai_classifications'
const AI_CACHE_MAX_ENTRIES = 600
const AI_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

// ─── Cache helpers ────────────────────────────────────────────────────────────

function cacheStorageKey(userId = '') {
  return userId ? `${AI_CACHE_KEY_PREFIX}_${userId}` : AI_CACHE_KEY_PREFIX
}

function loadCache(userId = '') {
  try {
    const raw = localStorage.getItem(cacheStorageKey(userId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function persistCache(cache = {}, userId = '') {
  try {
    localStorage.setItem(cacheStorageKey(userId), JSON.stringify(cache))
  } catch {}
}

function pruneCache(cache = {}) {
  const now = Date.now()
  return Object.fromEntries(
    Object.entries(cache)
      .filter(([, v]) => v.learnedAt && now - v.learnedAt < AI_CACHE_TTL_MS)
      .sort((a, b) => (b[1].learnedAt || 0) - (a[1].learnedAt || 0))
      .slice(0, AI_CACHE_MAX_ENTRIES),
  )
}

// ─── Lookup key ───────────────────────────────────────────────────────────────

/**
 * Build the key used to identify the same app/site across sessions.
 * Browser activities key by hostname so all pages on a domain share one
 * cached classification. Native apps key by normalised app name.
 */
export function buildAILookupKey(appName = '', browserUrl = '') {
  if (browserUrl) {
    try {
      const host = new URL(browserUrl).hostname.replace(/^www\./, '').toLowerCase()
      if (host) return `host:${host}`
    } catch {}
  }
  const name = String(appName || '').trim().toLowerCase()
  return name ? `app:${name}` : ''
}

// ─── Read / write ─────────────────────────────────────────────────────────────

/**
 * Return all AI-learned classifications as a plain object keyed by lookup key.
 * Each value matches the shape of a user custom rule so findMatchingCustomRule
 * can consume it without changes.
 */
export function getAILearnedRules(userId = '') {
  const cache = loadCache(userId)
  const rules = {}
  for (const [key, entry] of Object.entries(cache)) {
    if (entry?.classification) {
      rules[key] = { ...entry.classification, isAILearned: true }
    }
  }
  return rules
}

export function saveAILearnedRule(lookupKey, classification, userId = '') {
  if (!lookupKey || !classification) return
  const cache = pruneCache(loadCache(userId))
  cache[lookupKey] = { lookupKey, classification, learnedAt: Date.now() }
  persistCache(cache, userId)
}

export function clearAILearnedRules(userId = '') {
  try { localStorage.removeItem(cacheStorageKey(userId)) } catch {}
}

export function getAICacheStats(userId = '') {
  const entries = Object.values(loadCache(userId))
  if (!entries.length) return { count: 0, oldestAt: null, newestAt: null }
  return {
    count: entries.length,
    oldestAt: entries.reduce((m, e) => Math.min(m, e.learnedAt || Infinity), Infinity),
    newestAt: entries.reduce((m, e) => Math.max(m, e.learnedAt || 0), 0),
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(appName = '', windowTitle = '', browserUrl = '') {
  const lines = []
  if (appName)     lines.push(`App: "${appName}"`)
  if (windowTitle) lines.push(`Title: "${String(windowTitle).slice(0, 140)}"`)
  if (browserUrl)  lines.push(`URL: "${String(browserUrl).slice(0, 220)}"`)

  return `You are classifying a computer activity for a personal productivity tracker.

${lines.join('\n')}

Choose one lane:
• productive  — actively creating output (coding, writing docs, designing)
• supporting  — research, learning, communication, reference, planning, AI tools
• distracting — entertainment, social media, gaming, shopping, short-form video
• unclear     — genuinely ambiguous or too little information

Choose one category: Development | Design | Writing | Communication | Learning | Entertainment | Social Media | Shopping | System | Reading | AI Tools | Project Mgmt | Other

Write a short subcategory label (2–4 words).
Set confidence between 0.50–0.97 based on how certain you are.

Reply with ONLY compact JSON, nothing else:
{"lane":"productive","category":"Development","subcategory":"React Docs","confidence":0.91}`
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseAIResponse(text = '') {
  const cleaned = text.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (!parsed || typeof parsed !== 'object') return null

    const lane = String(parsed.lane || '').trim().toLowerCase()
    const validLane = TRACKING_LANE_KEYS.includes(lane) ? lane : 'unclear'
    const category = String(parsed.category || 'Other').trim()
    const subcategory = String(parsed.subcategory || '').trim()
    const confidence = Math.max(0.50, Math.min(0.97, Number(parsed.confidence) || 0.75))

    return {
      lane: validLane,
      category,
      subcategory,
      color: CATEGORY_COLORS[category] || CATEGORY_COLORS.Other,
      productive: validLane === 'distracting' ? false : validLane === 'unclear' ? null : true,
      confidence,
      isCustom: false,
      isAILearned: true,
    }
  } catch {
    return null
  }
}

// ─── Provider API calls ───────────────────────────────────────────────────────

async function callGemini(prompt, { apiKey, model, baseUrl }) {
  const cleanModel = String(model || 'gemini-2.5-flash').replace(/^models\//, '')
  const url = `${baseUrl}/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 250, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function callOpenAI(prompt, { apiKey, model, baseUrl }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 250,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content || ''
}

async function callAnthropic(prompt, { apiKey, model, baseUrl }) {
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || 'claude-3-haiku-20240307',
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}`)
  const data = await res.json()
  return data?.content?.[0]?.text || ''
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call the user's AI provider to classify a single activity.
 * Returns a classification object on success, throws on failure.
 */
export async function classifyWithAI(
  { appName = '', windowTitle = '', browserUrl = '' },
  { provider = 'gemini', apiKey = '', model = '', baseUrl = '' } = {},
) {
  if (!apiKey) throw new Error('No AI API key configured')

  const prompt = buildPrompt(appName, windowTitle, browserUrl)
  let rawText = ''

  if (provider === 'gemini') {
    rawText = await callGemini(prompt, { apiKey, model, baseUrl: baseUrl || 'https://generativelanguage.googleapis.com' })
  } else if (provider === 'openai-compatible') {
    rawText = await callOpenAI(prompt, { apiKey, model, baseUrl: baseUrl || 'https://api.openai.com/v1' })
  } else if (provider === 'anthropic') {
    rawText = await callAnthropic(prompt, { apiKey, model, baseUrl: baseUrl || 'https://api.anthropic.com' })
  } else {
    throw new Error(`Unknown AI provider: ${provider}`)
  }

  const classification = parseAIResponse(rawText)
  if (!classification) throw new Error('AI returned an unparseable response')
  return classification
}

/**
 * Classify then cache. Returns the cached result immediately on repeat calls.
 * Returns null if the API call fails so callers can fall back gracefully.
 */
export async function learnAndCacheClassification(
  { appName = '', windowTitle = '', browserUrl = '' },
  aiSettings = {},
  userId = '',
) {
  const key = buildAILookupKey(appName, browserUrl)
  if (!key) return null

  const existing = loadCache(userId)[key]
  if (existing?.classification) return existing.classification

  try {
    const classification = await classifyWithAI({ appName, windowTitle, browserUrl }, aiSettings)
    saveAILearnedRule(key, classification, userId)
    return classification
  } catch (err) {
    console.warn('[Velance AI Classify]', err?.message || err)
    return null
  }
}

/**
 * Batch-process recent unclear / low-confidence entries through the AI.
 * Deduplicates by lookup key so the same domain is never sent twice.
 * Runs sequentially with a small delay to respect rate limits.
 *
 * @returns {{ learned, skipped, failed }}
 */
export async function improveUnclearClassifications(
  entries = [],
  aiSettings = {},
  userId = '',
  { maxNew = 20, confidenceThreshold = 0.6 } = {},
) {
  if (!aiSettings?.apiKey) return { learned: 0, skipped: entries.length, failed: 0 }

  const cache = loadCache(userId)
  const stats = { learned: 0, skipped: 0, failed: 0 }
  const seen = new Set()
  const toLearn = []

  for (const entry of entries) {
    const key = buildAILookupKey(entry.app || '', entry.browserUrl || '')
    if (!key || seen.has(key) || cache[key]) { stats.skipped++; continue }

    const isUnclear = entry.lane === 'unclear' || Number(entry.confidence || 0) < confidenceThreshold
    if (!isUnclear) { stats.skipped++; continue }

    seen.add(key)
    toLearn.push({ key, app: entry.app, windowTitle: entry.title || '', browserUrl: entry.browserUrl || '' })
    if (toLearn.length >= maxNew) break
  }

  for (const item of toLearn) {
    try {
      const classification = await classifyWithAI(
        { appName: item.app, windowTitle: item.windowTitle, browserUrl: item.browserUrl },
        aiSettings,
      )
      saveAILearnedRule(item.key, classification, userId)
      stats.learned++
    } catch {
      stats.failed++
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  return stats
}
