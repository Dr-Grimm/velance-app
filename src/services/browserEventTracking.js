import { formatLocalDateKey } from './dateKey.js'
import { classifyBrowserContext, normalizeLaneKey } from './activityClassification.js'

function normalizeString(value, fallback = '') {
  const text = String(value ?? fallback).trim()
  return text || fallback
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function normalizeBoolean(value) {
  return Boolean(value)
}

function normalizeUrl(rawUrl = '') {
  try {
    const parsed = new URL(String(rawUrl || '').trim())
    if (!/^https?:$/i.test(parsed.protocol)) {
      return { url: '', host: '' }
    }
    return {
      url: parsed.toString(),
      host: parsed.hostname || '',
    }
  } catch {
    return { url: '', host: '' }
  }
}

function buildBrowserEventId(entry = {}) {
  if (entry.id) return String(entry.id)
  const ts = normalizeNumber(entry.ts || entry.capturedAt || Date.now())
  const date = normalizeString(entry.date || entry.dateKey || formatLocalDateKey(ts), formatLocalDateKey(ts))
  const browserApp = normalizeString(entry.browserApp || 'Browser')
  const tabId = normalizeNumber(entry.tabId ?? 0)
  const eventType = normalizeString(entry.eventType || 'unknown')
  const identity = normalizeString(entry.host || entry.pageTitle || entry.url || 'context')
  return `${date}:${ts}:${browserApp}:${tabId}:${eventType}:${identity}`
}

export function normalizeBrowserEventEntry(entry = {}, { customRules = {} } = {}) {
  const ts = normalizeNumber(entry.ts || entry.capturedAt || Date.now())
  const { url, host } = normalizeUrl(entry.url || '')
  const pageTitle = normalizeString(entry.pageTitle || entry.title || '')
  const browserApp = normalizeString(entry.browserApp || 'Browser')
  const date = normalizeString(entry.date || entry.dateKey || formatLocalDateKey(ts), formatLocalDateKey(ts))
  const classification = classifyBrowserContext(browserApp, pageTitle, url, customRules)
  const productive = classification.productive === null || classification.productive === undefined
    ? null
    : Boolean(classification.productive)
  const contextLabel = normalizeString(
    entry.contextLabel || classification.contextLabel || pageTitle || host || browserApp,
    browserApp,
  )

  return {
    id: buildBrowserEventId({
      ...entry,
      ts,
      date,
      browserApp,
      host,
      pageTitle,
      url,
    }),
    date,
    ts,
    browserApp,
    browserFamily: normalizeString(entry.browserFamily || 'chromium', 'chromium'),
    eventType: normalizeString(entry.eventType || 'unknown', 'unknown'),
    tabId: Number.isFinite(Number(entry.tabId)) ? Number(entry.tabId) : null,
    windowId: Number.isFinite(Number(entry.windowId)) ? Number(entry.windowId) : null,
    openerTabId: Number.isFinite(Number(entry.openerTabId)) ? Number(entry.openerTabId) : null,
    previousTabId: Number.isFinite(Number(entry.previousTabId)) ? Number(entry.previousTabId) : null,
    url,
    host,
    pageTitle,
    contextLabel,
    category: normalizeString(entry.category || classification.category || 'Browser', 'Browser'),
    subcategory: normalizeString(entry.subcategory || classification.subcategory || '', ''),
    productive,
    lane: normalizeLaneKey(entry.lane || classification.lane, {
      productive,
      category: entry.category || classification.category || 'Browser',
      subcategory: entry.subcategory || classification.subcategory || '',
      confidence: normalizeNumber(entry.confidence ?? classification.confidence, 0.56),
      contextLabel,
      appName: browserApp,
    }),
    color: normalizeString(entry.color || classification.color || '#8E95A3', '#8E95A3'),
    confidence: normalizeNumber(entry.confidence ?? classification.confidence, 0.56),
    active: normalizeBoolean(entry.active),
    highlighted: normalizeBoolean(entry.highlighted),
    audible: normalizeBoolean(entry.audible),
    muted: normalizeBoolean(entry.muted),
    pinned: normalizeBoolean(entry.pinned),
    discarded: normalizeBoolean(entry.discarded),
    isWindowClosing: normalizeBoolean(entry.isWindowClosing),
    setActiveContext: normalizeBoolean(entry.setActiveContext),
    capturedAt: ts,
  }
}
