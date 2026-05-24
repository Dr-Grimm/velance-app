import { buildRangeEvidenceBundle, summarizeBrowserSignalsForRange } from './analysisEngine.js'
import {
  getCategoryDefaultLane,
  TRACKING_LANE_KEYS,
  getTrackingLaneMeta,
  normalizeBrowserUrl,
  normalizeLaneKey,
  trimBrowserTitle,
} from './activityClassification.js'
import { normalizeBrowserEventEntry } from './browserEventTracking.js'

const EMPTY_LANE_TOTALS = Object.freeze({
  productive: 0,
  supporting: 0,
  unclear: 0,
  distracting: 0,
})

function safeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function cloneLaneTotals() {
  return {
    productive: 0,
    supporting: 0,
    unclear: 0,
    distracting: 0,
  }
}

function addLaneWeight(totals = EMPTY_LANE_TOTALS, lane = 'unclear', amount = 0) {
  const normalizedLane = TRACKING_LANE_KEYS.includes(String(lane || '').trim().toLowerCase())
    ? String(lane || '').trim().toLowerCase()
    : 'unclear'
  totals[normalizedLane] = safeNumber(totals[normalizedLane]) + Math.max(0, safeNumber(amount))
}

function sumLaneTotals(totals = EMPTY_LANE_TOTALS) {
  return TRACKING_LANE_KEYS.reduce((sum, lane) => sum + safeNumber(totals?.[lane]), 0)
}

function mergeLaneTotalsWeighted(primary = EMPTY_LANE_TOTALS, secondary = EMPTY_LANE_TOTALS, secondaryBudget = 0) {
  const merged = cloneLaneTotals()
  TRACKING_LANE_KEYS.forEach((lane) => {
    merged[lane] = safeNumber(primary?.[lane])
  })

  const safeBudget = Math.max(0, safeNumber(secondaryBudget))
  const secondaryTotal = Math.max(sumLaneTotals(secondary), 0)
  if (safeBudget <= 0 || secondaryTotal <= 0) return merged

  TRACKING_LANE_KEYS.forEach((lane) => {
    merged[lane] += (safeNumber(secondary?.[lane]) / secondaryTotal) * safeBudget
  })

  return merged
}

function getDominantLaneFromTotals(totals = EMPTY_LANE_TOTALS) {
  return TRACKING_LANE_KEYS
    .map((lane) => [lane, safeNumber(totals?.[lane])])
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'unclear'
}

function toDisplayMinutes(seconds = 0) {
  return Math.max(1, Math.round(Math.max(0, safeNumber(seconds)) / 60))
}

function humanizeBrowserHost(host = '') {
  const normalized = String(host || '').trim().toLowerCase()
  if (!normalized) return ''
  return normalized
    .replace(/^(www|app|m)\./, '')
    .replace(/\.(com|org|net|io|dev|app|ai|co|gg|tv|me|fm)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildBrowserPageLabel({
  pageTitle = '',
  contextLabel = '',
  host = '',
  browserApp = 'Browser',
} = {}) {
  const trimmedTitle = trimBrowserTitle(pageTitle || contextLabel || '')
  return trimmedTitle || humanizeBrowserHost(host) || String(browserApp || 'Browser').trim() || 'Browser page'
}

function getBrowserEventTypeWeight(event = {}) {
  const type = String(event?.eventType || '').trim().toLowerCase()
  if (type === 'tab-created') return 1.15
  if (type === 'tab-activated' || type === 'window-focus') return 1.05
  if (type === 'page-signal') return 0.9
  if (type === 'tab-updated' || type === 'manual-refresh') return 0.82
  return 0.72
}

function getBucketScore(bucket = {}) {
  return (
    safeNumber(bucket.seconds) +
    (safeNumber(bucket.eventCount) * 42) +
    (safeNumber(bucket.activeCount) * 18) +
    (safeNumber(bucket.audibleCount) * 26) +
    (safeNumber(bucket.pageSignals) * 12)
  )
}

function ensureBucket(map, key, seed = {}) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      label: seed.label || 'Browser',
      host: seed.host || '',
      pageLabel: seed.pageLabel || '',
      browserApp: seed.browserApp || 'Browser',
      eventCount: 0,
      pageSignals: 0,
      activeCount: 0,
      audibleCount: 0,
      seconds: 0,
      firstTs: 0,
      lastTs: 0,
      laneTotals: cloneLaneTotals(),
      pageLabels: new Map(),
      appLabels: new Map(),
    })
  }
  return map.get(key)
}

function stampBucket(bucket, {
  lane = 'unclear',
  amount = 0,
  ts = 0,
  pageLabel = '',
  browserApp = 'Browser',
  countEvent = false,
  active = false,
  audible = false,
  pageSignal = false,
} = {}) {
  const safeTs = safeNumber(ts)
  if (!bucket.firstTs || (safeTs > 0 && safeTs < bucket.firstTs)) bucket.firstTs = safeTs
  bucket.lastTs = Math.max(bucket.lastTs, safeTs)
  bucket.seconds += Math.max(0, safeNumber(amount))
  if (countEvent) bucket.eventCount += 1
  if (active) bucket.activeCount += 1
  if (audible) bucket.audibleCount += 1
  if (pageSignal) bucket.pageSignals += 1
  addLaneWeight(bucket.laneTotals, lane, amount)

  if (pageLabel) {
    bucket.pageLabels.set(pageLabel, safeNumber(bucket.pageLabels.get(pageLabel)) + Math.max(1, safeNumber(amount)))
  }
  if (browserApp) {
    bucket.appLabels.set(browserApp, safeNumber(bucket.appLabels.get(browserApp)) + Math.max(1, safeNumber(amount)))
  }
}

function finalizeBuckets(map, totalScore = 0, kind = 'site', limit = 4) {
  const rows = [...map.values()]
    .map((bucket) => {
      const score = getBucketScore(bucket)
      const dominantLane = getDominantLaneFromTotals(bucket.laneTotals)
      const laneMeta = getTrackingLaneMeta(dominantLane)
      const topPageLabel = [...bucket.pageLabels.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || ''
      const topAppLabel = [...bucket.appLabels.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || bucket.browserApp

      return {
        id: `${kind}-${bucket.key}`,
        key: bucket.key,
        label: bucket.label,
        host: bucket.host,
        pageLabel: bucket.pageLabel,
        topPageLabel,
        browserApp: topAppLabel,
        dominantLane,
        laneLabel: laneMeta.label,
        laneMeta,
        eventCount: bucket.eventCount,
        pageSignals: bucket.pageSignals,
        activeCount: bucket.activeCount,
        audibleCount: bucket.audibleCount,
        seconds: Math.round(bucket.seconds),
        minutes: toDisplayMinutes(bucket.seconds),
        firstTs: bucket.firstTs,
        lastTs: bucket.lastTs,
        score,
        share: totalScore > 0 ? Math.round((score / totalScore) * 100) : 0,
      }
    })
    .sort((left, right) => (
      safeNumber(right.score) - safeNumber(left.score)
      || safeNumber(right.lastTs) - safeNumber(left.lastTs)
    ))

  return rows.slice(0, Math.max(1, safeNumber(limit, 4)))
}

function normalizeAmbientBrowserEntry(entry = {}) {
  const browserUrl = String(entry?.browserUrl || entry?.url || '').trim()
  const browserInfo = normalizeBrowserUrl(browserUrl)
  const host = String(entry?.browserHost || browserInfo.host || '').trim().toLowerCase()
  const browserApp = String(entry?.app || entry?.appName || entry?.browserApp || 'Browser').trim() || 'Browser'
  const hasBrowserContext = Boolean(
    host
    || browserUrl
    || String(entry?.browserPage || '').trim()
    || /chrome|edge|firefox|safari|brave|opera|arc|vivaldi|chromium/i.test(browserApp),
  )
  if (!hasBrowserContext) return null
  const pageLabel = buildBrowserPageLabel({
    pageTitle: entry?.browserPage || entry?.title || entry?.windowTitle || '',
    contextLabel: entry?.contextLabel || '',
    host,
    browserApp,
  })

  if (!host && !pageLabel) return null

  const normalizedLane = normalizeLaneKey(entry?.lane, {
    productive: entry?.productive ?? null,
    category: entry?.category || 'Browser',
    subcategory: entry?.subcategory || '',
    confidence: entry?.confidence ?? 0.56,
    contextLabel: pageLabel,
    appName: browserApp,
  })
  const categoryLane = getCategoryDefaultLane(entry?.category || 'Browser', {
    productive: entry?.productive ?? null,
    subcategory: entry?.subcategory || '',
    contextLabel: pageLabel,
    appName: browserApp,
  })
  const lane = categoryLane === 'distracting'
    ? 'distracting'
    : (categoryLane === 'supporting' && normalizedLane === 'productive')
      ? 'supporting'
      : normalizedLane

  return {
    host,
    browserApp,
    pageLabel,
    lane,
    duration: Math.max(0, safeNumber(entry?.duration)),
    ts: safeNumber(entry?.endTs || entry?.ts),
  }
}

function normalizeBrowserEvidenceBounds(browserEvents = [], ambientEntries = []) {
  const timestamps = []
  browserEvents.forEach((entry) => {
    const ts = safeNumber(entry?.ts)
    if (ts > 0) timestamps.push(ts)
  })
  ambientEntries.forEach((entry) => {
    const ts = safeNumber(entry?.ts)
    const endTs = safeNumber(entry?.endTs)
    if (ts > 0) timestamps.push(ts)
    if (endTs > 0) timestamps.push(endTs)
  })

  if (!timestamps.length) {
    return { startTs: 0, endTs: 0 }
  }

  return {
    startTs: Math.min(...timestamps),
    endTs: Math.max(...timestamps),
  }
}

export function buildBrowserEvidenceSummary({
  browserEvents = [],
  ambientEntries = [],
  startTs = 0,
  endTs = 0,
  padMs = 30 * 1000,
  limit = 4,
} = {}) {
  const safeStart = safeNumber(startTs)
  const safeEnd = Math.max(safeStart, safeNumber(endTs))
  const hasRange = safeStart > 0 || safeEnd > 0

  const bundle = hasRange
    ? buildRangeEvidenceBundle({
      ambientEntries,
      browserEvents,
      startTs: safeStart,
      endTs: safeEnd,
      ambientPadMs: Math.round(Math.max(0, safeNumber(padMs)) / 2),
      browserPadMs: Math.max(0, safeNumber(padMs)),
      limit: Math.max(6, safeNumber(limit, 4)),
    })
    : null

  const rangedAmbientEntries = Array.isArray(bundle?.ambientEntries) ? bundle.ambientEntries : (Array.isArray(ambientEntries) ? ambientEntries : [])
  const normalizedBrowserEvents = (Array.isArray(bundle?.browserEvents) ? bundle.browserEvents : browserEvents)
    .map((entry) => normalizeBrowserEventEntry(entry))

  const normalizedBounds = normalizeBrowserEvidenceBounds(normalizedBrowserEvents, rangedAmbientEntries)
  const derivedStart = safeStart || normalizedBounds.startTs
  const derivedEnd = safeEnd || normalizedBounds.endTs
  const signals = bundle?.browserSignals || summarizeBrowserSignalsForRange(normalizedBrowserEvents, {
    startTs: derivedStart,
    endTs: derivedEnd,
    padMs,
  })

  const siteMap = new Map()
  const pageMap = new Map()
  let totalBrowserSeconds = 0
  const ambientLaneTotals = cloneLaneTotals()

  rangedAmbientEntries.forEach((entry) => {
    const context = normalizeAmbientBrowserEntry(entry)
    if (!context) return

    const siteKey = context.host || context.browserApp.toLowerCase()
    const siteLabel = humanizeBrowserHost(context.host) || context.browserApp
    const pageKey = `${siteKey}::${context.pageLabel.toLowerCase()}`
    const siteBucket = ensureBucket(siteMap, siteKey, {
      label: siteLabel,
      host: context.host,
      browserApp: context.browserApp,
    })
    const pageBucket = ensureBucket(pageMap, pageKey, {
      label: context.pageLabel,
      pageLabel: context.pageLabel,
      host: context.host,
      browserApp: context.browserApp,
    })

    stampBucket(siteBucket, {
      lane: context.lane,
      amount: context.duration,
      ts: context.ts,
      pageLabel: context.pageLabel,
      browserApp: context.browserApp,
    })
    stampBucket(pageBucket, {
      lane: context.lane,
      amount: context.duration,
      ts: context.ts,
      pageLabel: context.pageLabel,
      browserApp: context.browserApp,
    })

    addLaneWeight(ambientLaneTotals, context.lane, context.duration)
    totalBrowserSeconds += context.duration
  })

  normalizedBrowserEvents.forEach((event) => {
    const host = String(event?.host || '').trim().toLowerCase()
    const browserApp = String(event?.browserApp || 'Browser').trim() || 'Browser'
    const pageLabel = buildBrowserPageLabel({
      pageTitle: event?.pageTitle || '',
      contextLabel: event?.contextLabel || '',
      host,
      browserApp,
    })
    if (!host && !pageLabel) return

    const lane = normalizeLaneKey(event?.lane, {
      productive: event?.productive ?? null,
      category: event?.category || 'Browser',
      subcategory: event?.subcategory || '',
      confidence: event?.confidence ?? 0.56,
      contextLabel: pageLabel,
      appName: browserApp,
    })
    const weight = getBrowserEventTypeWeight(event) * 30
    const eventType = String(event?.eventType || '').trim().toLowerCase()
    const siteKey = host || browserApp.toLowerCase()
    const pageKey = `${siteKey}::${pageLabel.toLowerCase()}`
    const siteBucket = ensureBucket(siteMap, siteKey, {
      label: humanizeBrowserHost(host) || browserApp,
      host,
      browserApp,
    })
    const pageBucket = ensureBucket(pageMap, pageKey, {
      label: pageLabel,
      pageLabel,
      host,
      browserApp,
    })

    const stamp = {
      lane,
      amount: weight,
      ts: safeNumber(event?.ts),
      pageLabel,
      browserApp,
      countEvent: true,
      active: Boolean(event?.active),
      audible: Boolean(event?.audible),
      pageSignal: eventType === 'page-signal' || eventType === 'tab-updated' || eventType === 'manual-refresh',
    }

    stampBucket(siteBucket, stamp)
    stampBucket(pageBucket, stamp)
  })

  const totalSiteScore = [...siteMap.values()].reduce((sum, bucket) => sum + getBucketScore(bucket), 0)
  const totalPageScore = [...pageMap.values()].reduce((sum, bucket) => sum + getBucketScore(bucket), 0)
  const topSites = finalizeBuckets(siteMap, totalSiteScore, 'site', limit)
  const topPages = finalizeBuckets(pageMap, totalPageScore, 'page', limit)
  const leadSite = topSites[0] || null
  const leadPage = topPages[0] || null
  const activeSite = [...topSites].sort((left, right) => safeNumber(right.lastTs) - safeNumber(left.lastTs))[0] || null
  const activePage = [...topPages].sort((left, right) => safeNumber(right.lastTs) - safeNumber(left.lastTs))[0] || null
  const eventLaneTotals = signals?.laneTotals || cloneLaneTotals()
  const totalAmbientLaneWeight = sumLaneTotals(ambientLaneTotals)
  const totalEventLaneWeight = sumLaneTotals(eventLaneTotals)
  const combinedLaneTotals = totalAmbientLaneWeight > 0
    ? mergeLaneTotalsWeighted(
      ambientLaneTotals,
      eventLaneTotals,
      totalEventLaneWeight > 0 ? Math.max(totalAmbientLaneWeight * 0.45, Math.min(totalAmbientLaneWeight, 36)) : 0,
    )
    : { ...eventLaneTotals }
  const dominantLane = sumLaneTotals(combinedLaneTotals) > 0
    ? getDominantLaneFromTotals(combinedLaneTotals)
    : (leadSite?.dominantLane || signals?.dominantLane || 'unclear')
  const dominantLaneMeta = getTrackingLaneMeta(dominantLane)

  return {
    ...signals,
    dominantLane,
    dominantLaneMeta,
    laneTotals: combinedLaneTotals,
    ambientLaneTotals,
    eventLaneTotals,
    totalBrowserSeconds: Math.round(totalBrowserSeconds),
    totalBrowserMinutes: totalBrowserSeconds > 0 ? toDisplayMinutes(totalBrowserSeconds) : 0,
    leadSite,
    leadPage,
    activeSite,
    activePage,
    topSites,
    topPages,
    leadSiteLabel: leadSite?.label || 'No clear site yet',
    leadPageLabel: leadPage?.label || 'No clear page yet',
  }
}
