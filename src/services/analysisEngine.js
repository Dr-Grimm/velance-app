import { resolveAmbientEntryLane } from './activityClassification.js'

export const FOCUS_FORMULA_VERSION = 'focus-v4.0'
export const FATIGUE_FORMULA_VERSION = 'fatigue-v2.0'

function safeNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function round(value, digits = 0) {
  const safe = Number.isFinite(value) ? value : 0
  const factor = 10 ** digits
  return Math.round(safe * factor) / factor
}

function average(values = []) {
  const safeValues = values
    .map((value) => safeNumber(value, NaN))
    .filter((value) => Number.isFinite(value))
  return safeValues.length
    ? safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length
    : 0
}

export function getFatigueRisk(score = 0) {
  const safe = safeNumber(score)
  if (safe >= 65) return 'High'
  if (safe >= 35) return 'Moderate'
  return 'Low'
}

export function getContinuityScore(switchesPerMinute = 0) {
  const rate = safeNumber(switchesPerMinute)
  if (rate <= 0.6) return 100
  if (rate <= 2) return Math.round(100 + (((rate - 0.6) / 1.4) * (75 - 100)))
  if (rate <= 4) return Math.round(75 + (((rate - 2) / 2) * (25 - 75)))
  if (rate <= 6) return Math.round(25 + (((rate - 4) / 2) * (0 - 25)))
  return 0
}

export function getDurationLoad(minutes = 0) {
  const safe = safeNumber(minutes)
  if (safe <= 25) return round((safe / 25) * 20, 1)
  if (safe <= 50) return round(20 + (((safe - 25) / 25) * 25), 1)
  if (safe <= 90) return round(45 + (((safe - 50) / 40) * 55), 1)
  return 100
}

export function deriveFocusDecay(scores = []) {
  const safeScores = scores
    .map((value) => safeNumber(value, NaN))
    .filter((value) => Number.isFinite(value))

  if (!safeScores.length) return 0

  const chunk = Math.max(1, Math.floor(safeScores.length / 3))
  const firstThird = average(safeScores.slice(0, chunk))
  const lastThird = average(safeScores.slice(-chunk))
  return clamp((firstThird - lastThird) / 40, 0, 1)
}

export function computeWeightedConfidence(items = [], {
  secondsKey = 'seconds',
  confidenceKey = 'confidence',
  fallback = 0.72,
} = {}) {
  const weighted = items.reduce((sum, item) => {
    const seconds = Math.max(0, safeNumber(item?.[secondsKey]))
    const confidence = clamp(safeNumber(item?.[confidenceKey], fallback), 0, 1)
    return {
      seconds: sum.seconds + seconds,
      weighted: sum.weighted + (confidence * seconds),
      count: sum.count + (seconds > 0 ? 1 : 0),
    }
  }, { seconds: 0, weighted: 0, count: 0 })

  if (weighted.seconds > 0) return round(weighted.weighted / weighted.seconds, 3)
  if (weighted.count > 0) return round(weighted.weighted / weighted.count, 3)
  return fallback
}

export function computeInputIntensity({
  keystrokes = 0,
  mouseDistance = 0,
  clicks = 0,
  scrollDelta = 0,
  averageKpm = 0,
  mouseIntensity = 0,
} = {}) {
  const hasAggregateInputs = safeNumber(averageKpm) > 0 || safeNumber(mouseIntensity) > 0
  if (hasAggregateInputs) {
    const typingNorm = clamp(safeNumber(averageKpm) / 90, 0, 1)
    const pointerNorm = clamp(safeNumber(mouseIntensity) / 100, 0, 1)
    return clamp((typingNorm * 0.62) + (pointerNorm * 0.38), 0, 1)
  }

  const typingNorm = clamp(safeNumber(keystrokes) / 160, 0, 1)
  const pointerNorm = clamp(((safeNumber(mouseDistance) / 3000) + (safeNumber(clicks) / 12) + (safeNumber(scrollDelta) / 40)) / 3, 0, 1)
  return clamp((typingNorm * 0.6) + (pointerNorm * 0.4), 0, 1)
}

export function computeAnalysisConfidence({
  weightedConfidence = 0.72,
  observedRatio = 1,
  activeRatio = 1,
  sampleCount = 0,
  chunkCount = 0,
} = {}) {
  const base = clamp(safeNumber(weightedConfidence, 0.72), 0.15, 1)
  const observed = clamp(safeNumber(observedRatio, 1), 0, 1)
  const active = clamp(safeNumber(activeRatio, observed || 1), 0, 1)
  const volumeSignal = sampleCount > 0
    ? clamp(sampleCount / 12, 0.3, 1)
    : chunkCount > 0
      ? clamp(chunkCount / 6, 0.3, 1)
      : 0.7

  const ratio = clamp(
    (base * 0.62) +
    (observed * 0.2) +
    (active * 0.08) +
    (volumeSignal * 0.1),
    0,
    1,
  )

  return {
    ratio,
    score: Math.round(ratio * 100),
  }
}

export function derivePrecisionState({
  confidenceRatio = 0,
  observedRatio = 1,
  activeRatio = 1,
  browserPressure = 0,
  source = 'session',
} = {}) {
  const confidence = clamp(safeNumber(confidenceRatio), 0, 1)
  const observed = clamp(safeNumber(observedRatio, 1), 0, 1)
  const active = clamp(safeNumber(activeRatio, observed || 1), 0, 1)
  const browser = clamp(safeNumber(browserPressure) / 100, 0, 1)
  const composite = clamp(
    (confidence * 0.58) +
    (observed * 0.22) +
    (active * 0.12) +
    ((1 - browser) * 0.08),
    0,
    1,
  )

  if (composite >= 0.82) {
    return {
      id: 'measured-strongly',
      label: 'Measured strongly',
      tone: 'good',
      score: Math.round(composite * 100),
      detail: source === 'background'
        ? 'Tracked cleanly with strong coverage and stable context.'
        : 'Tracked cleanly with strong session evidence and stable context.',
    }
  }
  if (composite >= 0.58) {
    return {
      id: 'measured-lightly',
      label: 'Measured lightly',
      tone: 'steady',
      score: Math.round(composite * 100),
      detail: source === 'background'
        ? 'Useful evidence exists, but coverage or clarity was mixed.'
        : 'Useful session evidence exists, but some slices were lighter or noisier.',
    }
  }

  return {
    id: 'inferred',
    label: 'Inferred',
    tone: 'muted',
    score: Math.round(composite * 100),
    detail: 'This result is directionally useful, but confidence was limited.',
  }
}

export function deriveRecoveryProfile({
  focusScore = 0,
  fatigueScore = 0,
  driftCount = 0,
  recoveryCount = 0,
  switchRate = 0,
  browserPressure = 0,
  distractingShare = 0,
  unclearShare = 0,
} = {}) {
  const recoveryStrength = clamp(safeNumber(recoveryCount) / Math.max(safeNumber(driftCount), 1), 0, 1)
  const switchPenalty = clamp(safeNumber(switchRate) / 3.5, 0, 1)
  const browserPenalty = clamp(safeNumber(browserPressure) / 100, 0, 1)
  const disruptionPenalty = clamp(safeNumber(distractingShare) + (safeNumber(unclearShare) * 0.7), 0, 1)
  const calmRatio = clamp(
    (safeNumber(focusScore) / 100 * 0.44) +
    ((1 - (safeNumber(fatigueScore) / 100)) * 0.24) +
    ((1 - switchPenalty) * 0.12) +
    ((1 - browserPenalty) * 0.1) +
    ((1 - disruptionPenalty) * 0.1),
    0,
    1,
  )
  const recoveryRatio = clamp(
    (recoveryStrength * 0.45) +
    ((1 - browserPenalty) * 0.15) +
    ((1 - switchPenalty) * 0.15) +
    ((1 - disruptionPenalty) * 0.1) +
    ((1 - (safeNumber(fatigueScore) / 100)) * 0.15),
    0,
    1,
  )

  let state = 'strained'
  if (calmRatio >= 0.72 && recoveryRatio >= 0.52) state = 'true-calm'
  else if (calmRatio >= 0.62) state = 'recovering'
  else if (calmRatio >= 0.48) state = 'mixed-calm'

  return {
    calmScore: Math.round(calmRatio * 100),
    recoveryQuality: Math.round(recoveryRatio * 100),
    recoveryState: state,
    isCalmWindow: state === 'true-calm',
  }
}

export function computeFocusProfile({
  totalSeconds = 0,
  productiveSeconds = 0,
  supportingSeconds = 0,
  unclearSeconds = 0,
  distractingSeconds = 0,
  activeRatio = 1,
  switches = 0,
  inputIntensity = null,
  weightedConfidence = 0.72,
  observedRatio = 1,
  sampleCount = 0,
  chunkCount = 0,
} = {}) {
  const total = Math.max(1, safeNumber(totalSeconds))
  const productive = Math.max(0, safeNumber(productiveSeconds))
  const supporting = Math.max(0, safeNumber(supportingSeconds))
  const unclear = Math.max(0, safeNumber(unclearSeconds))
  const distracting = Math.max(0, safeNumber(distractingSeconds))
  const favorableShare = clamp((productive + supporting) / total, 0, 1)
  const productiveShare = clamp(productive / total, 0, 1)
  const supportingShare = clamp(supporting / total, 0, 1)
  const unclearShare = clamp(unclear / total, 0, 1)
  const distractingShare = clamp(distracting / total, 0, 1)
  const effectiveActiveRatio = clamp(safeNumber(activeRatio, favorableShare), 0, 1)
  const switchesPerMinute = safeNumber(switches) / Math.max(total / 60, 1)
  const confidence = computeAnalysisConfidence({
    weightedConfidence,
    observedRatio,
    activeRatio: effectiveActiveRatio,
    sampleCount,
    chunkCount,
  })

  const presence = Math.round(100 * clamp(
    (effectiveActiveRatio * 0.58) +
    (favorableShare * 0.28) +
    (confidence.ratio * 0.14),
    0,
    1,
  ))

  const inputSignal = inputIntensity === null || inputIntensity === undefined
    ? null
    : clamp(safeNumber(inputIntensity), 0, 1)
  const activityBase = inputSignal === null
    ? ((productiveShare * 0.72) + (supportingShare * 0.28))
    : ((productiveShare * 0.5) + (supportingShare * 0.15) + (inputSignal * 0.35))
  const activity = Math.round(100 * clamp(activityBase * (0.92 + (confidence.ratio * 0.08)), 0, 1))

  const continuityRaw = getContinuityScore(switchesPerMinute)
  const continuity = Math.round(clamp(
    (continuityRaw * 0.88) + (confidence.score * 0.12),
    0,
    100,
  ))

  const disruptiveShare = unclearShare + distractingShare
  const stability = Math.round(100 * clamp(
    ((1 - disruptiveShare) * 0.82) + (confidence.ratio * 0.18),
    0,
    1,
  ))

  const durationBoost = Math.min(total / (45 * 60), 1) * 6
  const baseFocus = (
    (presence * 0.3) +
    (activity * 0.25) +
    (continuity * 0.28) +
    (stability * 0.17)
  )
  const focusScore = Math.round(clamp(baseFocus + durationBoost - (distractingShare * 9) - (unclearShare * 4), 0, 100))

  return {
    focusScore,
    pillars: {
      presence,
      activity,
      continuity,
      stability,
    },
    confidenceScore: confidence.score,
    confidenceRatio: confidence.ratio,
    productiveShare,
    supportingShare,
    unclearShare,
    distractingShare,
    favorableShare,
    switchesPerMinute: round(switchesPerMinute, 1),
  }
}

export function computeFatigueProfile({
  totalSeconds = 0,
  switches = 0,
  distractingSeconds = 0,
  unclearSeconds = 0,
  supportingSeconds = 0,
  idleRatio = 0,
  focusDecay = 0,
  lateShare = 0,
  weightedConfidence = 0.72,
  observedRatio = 1,
  activeRatio = 1,
  sampleCount = 0,
  chunkCount = 0,
  durationMinutes = null,
} = {}) {
  const total = Math.max(1, safeNumber(totalSeconds))
  const trackedHours = Math.max(total / 3600, 0.25)
  const distractingShare = clamp(safeNumber(distractingSeconds) / total, 0, 1)
  const unclearShare = clamp(safeNumber(unclearSeconds) / total, 0, 1)
  const supportingShare = clamp(safeNumber(supportingSeconds) / total, 0, 1)
  const switchesPerHour = safeNumber(switches) / trackedHours
  const confidence = computeAnalysisConfidence({
    weightedConfidence,
    observedRatio,
    activeRatio,
    sampleCount,
    chunkCount,
  })

  const durationLoad = getDurationLoad(durationMinutes ?? (total / 60))
  const idleLoad = round(100 * clamp(safeNumber(idleRatio), 0, 1), 1)
  const switchLoad = round(100 * Math.min(switchesPerHour / 14, 1), 1)
  const focusDecayLoad = round(100 * clamp(safeNumber(focusDecay), 0, 1), 1)
  const distractionLoad = round(distractingShare * 100, 1)
  const ambiguityLoad = round(Math.min(1, unclearShare + ((1 - confidence.ratio) * 0.35)) * 100, 1)
  const supportingLoad = round(supportingShare * 100, 1)
  const lateLoad = round(clamp(safeNumber(lateShare), 0, 1) * 100, 1)

  const driverWeights = {
    durationLoad: 0.18,
    idleLoad: 0.12,
    switchLoad: 0.18,
    focusDecayLoad: 0.12,
    distractionLoad: 0.23,
    ambiguityLoad: 0.1,
    supportingLoad: 0.04,
    lateLoad: 0.03,
  }

  const score = Math.round(clamp(
    (durationLoad * driverWeights.durationLoad) +
    (idleLoad * driverWeights.idleLoad) +
    (switchLoad * driverWeights.switchLoad) +
    (focusDecayLoad * driverWeights.focusDecayLoad) +
    (distractionLoad * driverWeights.distractionLoad) +
    (ambiguityLoad * driverWeights.ambiguityLoad) +
    (supportingLoad * driverWeights.supportingLoad) +
    (lateLoad * driverWeights.lateLoad),
    0,
    100,
  ))

  const dominantDriver = [
    ['High distraction pressure', distractionLoad * driverWeights.distractionLoad],
    ['Frequent context switching', switchLoad * driverWeights.switchLoad],
    ['Low-clarity work', ambiguityLoad * driverWeights.ambiguityLoad],
    ['Duration load', durationLoad * driverWeights.durationLoad],
    ['Focus decay', focusDecayLoad * driverWeights.focusDecayLoad],
    ['Idle drag', idleLoad * driverWeights.idleLoad],
    ['Late-day load', lateLoad * driverWeights.lateLoad],
    ['Heavy supporting overhead', supportingLoad * driverWeights.supportingLoad],
  ]
    .sort((left, right) => right[1] - left[1])[0]

  return {
    score,
    risk: getFatigueRisk(score),
    confidenceScore: confidence.score,
    confidenceRatio: confidence.ratio,
    switches: safeNumber(switches),
    distractingShare,
    unclearShare,
    supportingShare,
    lateShare: clamp(safeNumber(lateShare), 0, 1),
    durationLoad,
    idleLoad,
    switchLoad,
    focusDecayLoad,
    distractionLoad,
    ambiguityLoad,
    supportingLoad,
    lateLoad,
    dominantDriver: dominantDriver?.[1] > 0 ? dominantDriver[0] : 'Stable background load',
  }
}

function normalizeBrowserEventType(value = '') {
  return String(value || '').trim().toLowerCase()
}

function summarizeBrowserHostSet(events = []) {
  return new Set(
    events
      .map((event) => String(event?.host || '').trim().toLowerCase())
      .filter(Boolean),
  )
}

function getDominantLaneFromTotals(laneTotals = {}) {
  const ranked = ['productive', 'supporting', 'unclear', 'distracting']
    .map((lane) => [lane, Math.max(0, safeNumber(laneTotals?.[lane]))])
    .sort((left, right) => right[1] - left[1])
  return ranked[0]?.[1] > 0 ? ranked[0][0] : 'unclear'
}

function mapBrowserEventLabel(event = {}) {
  return String(event?.contextLabel || event?.pageTitle || event?.host || event?.browserApp || 'Browser signal')
}

function isAmbientBrowserLikeEntry(entry = {}) {
  const browserApp = String(entry?.appGroup || entry?.app || entry?.browserApp || '').trim().toLowerCase()
  return Boolean(
    entry?.browserHost
    || entry?.browserPage
    || entry?.browserUrl
    || /chrome|edge|firefox|safari|brave|opera|arc|vivaldi|chromium|browser/.test(browserApp),
  )
}

function getAmbientEvidenceLabel(entry = {}) {
  const sourceApp = String(entry?.appGroup || entry?.app || entry?.appName || entry?.sourceApp || 'Unknown').trim() || 'Unknown'
  if (!isAmbientBrowserLikeEntry(entry)) return {
    bucketKey: `app::${sourceApp.toLowerCase()}`,
    displayLabel: sourceApp,
    sourceApp,
    browserContext: false,
  }

  const displayLabel = String(
    entry?.contextLabel
    || entry?.browserPage
    || entry?.browserHost
    || sourceApp,
  ).trim() || sourceApp

  return {
    bucketKey: `browser::${displayLabel.toLowerCase()}::${sourceApp.toLowerCase()}`,
    displayLabel,
    sourceApp,
    browserContext: true,
  }
}

function getBrowserEventWeight(event = {}) {
  const type = normalizeBrowserEventType(event?.eventType)
  let weight = 1

  if (type === 'page-signal') weight = 1.18
  else if (type === 'tab-activated' || type === 'window-focus') weight = 1.08
  else if (type === 'tab-created') weight = 0.94
  else if (type === 'tab-updated' || type === 'manual-refresh') weight = 0.78
  else if (type === 'tab-removed') weight = 0.62

  if (Boolean(event?.setActiveContext) || Boolean(event?.active)) weight += 0.18
  if (Boolean(event?.audible)) weight += 0.25
  if (!event?.host && !event?.pageTitle) weight -= 0.2

  return clamp(weight, 0.35, 1.7)
}

export function filterAmbientEntriesForRange(entries = [], {
  startTs = 0,
  endTs = 0,
  padMs = 0,
} = {}) {
  const safeStart = safeNumber(startTs)
  const safeEnd = Math.max(safeStart, safeNumber(endTs))
  const windowStart = Math.max(0, safeStart - Math.max(0, safeNumber(padMs)))
  const windowEnd = Math.max(windowStart, safeEnd + Math.max(0, safeNumber(padMs)))

  return [...entries]
    .filter((entry) => {
      const entryStart = safeNumber(entry?.ts)
      const durationSeconds = Math.max(0, safeNumber(entry?.duration))
      const entryEnd = Math.max(
        entryStart,
        safeNumber(entry?.endTs, entryStart + (durationSeconds * 1000)),
      )
      return entryEnd >= windowStart && entryStart <= windowEnd
    })
    .sort((left, right) => safeNumber(left?.ts) - safeNumber(right?.ts))
}

export function filterBrowserEventsForRange(events = [], {
  startTs = 0,
  endTs = 0,
  padMs = 0,
} = {}) {
  const safeStart = safeNumber(startTs)
  const safeEnd = Math.max(safeStart, safeNumber(endTs))
  const windowStart = Math.max(0, safeStart - Math.max(0, safeNumber(padMs)))
  const windowEnd = Math.max(windowStart, safeEnd + Math.max(0, safeNumber(padMs)))

  return [...events]
    .filter((event) => {
      const ts = safeNumber(event?.ts)
      return ts >= windowStart && ts <= windowEnd
    })
    .sort((left, right) => safeNumber(left?.ts) - safeNumber(right?.ts))
}

export function buildRangeEvidenceBundle({
  ambientEntries = [],
  browserEvents = [],
  startTs = 0,
  endTs = 0,
  ambientPadMs = 0,
  browserPadMs = 30 * 1000,
  limit = 4,
} = {}) {
  const rangeAmbientEntries = filterAmbientEntriesForRange(ambientEntries, {
    startTs,
    endTs,
    padMs: ambientPadMs,
  })
  const rangeBrowserEvents = filterBrowserEventsForRange(browserEvents, {
    startTs,
    endTs,
    padMs: browserPadMs,
  })

  const laneTotals = rangeAmbientEntries.reduce((totals, entry) => {
    const lane = resolveAmbientEntryLane(entry)
    const duration = Math.max(0, safeNumber(entry?.duration))
    if (lane === 'productive') totals.productive += duration
    else if (lane === 'supporting') totals.supporting += duration
    else if (lane === 'distracting') totals.distracting += duration
    else totals.unclear += duration
    return totals
  }, {
    productive: 0,
    supporting: 0,
    unclear: 0,
    distracting: 0,
  })

  const appMap = new Map()
  rangeAmbientEntries.forEach((entry) => {
    const { bucketKey, displayLabel, sourceApp, browserContext } = getAmbientEvidenceLabel(entry)
    const bucket = appMap.get(bucketKey) || {
      app: displayLabel,
      sourceApp,
      browserContext,
      seconds: 0,
      switches: 0,
      weightedConfidence: 0,
      categorySeconds: new Map(),
      laneSeconds: new Map(),
      contextSeconds: new Map(),
      lastTs: 0,
    }
    const seconds = Math.max(0, safeNumber(entry?.duration))
    const confidence = clamp(safeNumber(entry?.confidence, 0.72), 0, 1)
    const category = String(entry?.category || 'Other').trim() || 'Other'
    const lane = resolveAmbientEntryLane(entry)
    const context = String(entry?.contextLabel || entry?.subcategory || entry?.windowTitle || '').trim()

    bucket.seconds += seconds
    bucket.switches += safeNumber(entry?.switches)
    bucket.weightedConfidence += confidence * seconds
    bucket.categorySeconds.set(category, safeNumber(bucket.categorySeconds.get(category)) + seconds)
    bucket.laneSeconds.set(lane, safeNumber(bucket.laneSeconds.get(lane)) + seconds)
    if (context) bucket.contextSeconds.set(context, safeNumber(bucket.contextSeconds.get(context)) + seconds)
    bucket.lastTs = Math.max(bucket.lastTs, safeNumber(entry?.ts))
    appMap.set(bucketKey, bucket)
  })

  const topApps = [...appMap.values()]
    .map((app) => {
      const dominantCategory = [...app.categorySeconds.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || 'Other'
      const dominantLane = [...app.laneSeconds.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || 'unclear'
      const contextLabel = [...app.contextSeconds.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || ''
      return {
        app: app.app,
        sourceApp: app.sourceApp,
        browserContext: Boolean(app.browserContext),
        seconds: app.seconds,
        switches: app.switches,
        confidence: app.seconds > 0 ? round(app.weightedConfidence / app.seconds, 3) : 0.72,
        category: dominantCategory,
        dominantLane,
        contextLabel,
        lastTs: app.lastTs,
      }
    })
    .sort((left, right) => (
      safeNumber(right.seconds) - safeNumber(left.seconds)
      || safeNumber(right.lastTs) - safeNumber(left.lastTs)
    ))

  const browserSignals = summarizeBrowserSignalsForRange(rangeBrowserEvents, {
    startTs,
    endTs,
    padMs: browserPadMs,
  })

  const recentBrowserEvents = [...rangeBrowserEvents]
    .sort((left, right) => safeNumber(right?.ts) - safeNumber(left?.ts))
    .slice(0, Math.max(1, safeNumber(limit, 4)))
    .map((event) => ({
      id: event?.id || `${event?.eventType || 'browser'}-${event?.ts || 0}`,
      title: mapBrowserEventLabel(event),
      detail: `${event?.browserApp || 'Browser'} - ${event?.host || event?.contextLabel || 'No host'}`,
      ts: safeNumber(event?.ts),
      eventType: event?.eventType || '',
      eventLabel: event?.eventLabel || event?.eventType || 'Event',
      audible: Boolean(event?.audible),
      active: Boolean(event?.active),
      host: event?.host || '',
      browserApp: event?.browserApp || '',
      pageTitle: event?.pageTitle || '',
      contextLabel: event?.contextLabel || '',
      lane: event?.lane || 'unclear',
      category: event?.category || 'Browser',
    }))

  return {
    startTs: safeNumber(startTs),
    endTs: Math.max(safeNumber(startTs), safeNumber(endTs)),
    trackedSeconds: rangeAmbientEntries.reduce((sum, entry) => sum + Math.max(0, safeNumber(entry?.duration)), 0),
    chunkCount: rangeAmbientEntries.length,
    uniqueApps: topApps.length,
    laneTotals,
    dominantLane: getDominantLaneFromTotals(laneTotals),
    topApp: topApps[0] || null,
    topApps: topApps.slice(0, Math.max(1, safeNumber(limit, 4))),
    browserSignals,
    recentBrowserEvents,
    ambientEntries: rangeAmbientEntries,
    browserEvents: rangeBrowserEvents,
  }
}

export function summarizeBrowserSignalsForRange(events = [], {
  startTs = 0,
  endTs = 0,
  padMs = 30 * 1000,
} = {}) {
  const safeStart = safeNumber(startTs)
  const safeEnd = Math.max(safeStart, safeNumber(endTs))
  const windowStart = Math.max(0, safeStart - Math.max(0, safeNumber(padMs)))
  const windowEnd = Math.max(windowStart, safeEnd + Math.max(0, safeNumber(padMs)))
  const inRangeEvents = [...events]
    .filter((event) => {
      const ts = safeNumber(event?.ts)
      return ts >= windowStart && ts <= windowEnd
    })
    .sort((left, right) => safeNumber(left?.ts) - safeNumber(right?.ts))

  const tabSwitchEvents = inRangeEvents.filter((event) => ['tab-activated', 'window-focus'].includes(normalizeBrowserEventType(event?.eventType)))
  const tabOpenEvents = inRangeEvents.filter((event) => normalizeBrowserEventType(event?.eventType) === 'tab-created')
  const audibleEvents = inRangeEvents.filter((event) => Boolean(event?.audible))
  const pageSignalEvents = inRangeEvents.filter((event) => normalizeBrowserEventType(event?.eventType) === 'page-signal')
  const hostSet = summarizeBrowserHostSet(inRangeEvents)
  const measuredHours = Math.max((windowEnd - windowStart) / (1000 * 60 * 60), 0.2)
  const laneTotals = inRangeEvents.reduce((totals, event) => {
    const lane = String(event?.lane || 'unclear').trim().toLowerCase()
    const weight = getBrowserEventWeight(event)
    if (lane === 'productive') totals.productive += weight
    else if (lane === 'supporting') totals.supporting += weight
    else if (lane === 'distracting') totals.distracting += weight
    else totals.unclear += weight
    return totals
  }, {
    productive: 0,
    supporting: 0,
    unclear: 0,
    distracting: 0,
  })
  const laneEventCounts = inRangeEvents.reduce((totals, event) => {
    const lane = String(event?.lane || 'unclear').trim().toLowerCase()
    if (lane === 'productive') totals.productive += 1
    else if (lane === 'supporting') totals.supporting += 1
    else if (lane === 'distracting') totals.distracting += 1
    else totals.unclear += 1
    return totals
  }, {
    productive: 0,
    supporting: 0,
    unclear: 0,
    distracting: 0,
  })
  const totalLaneWeight = Math.max(
    laneTotals.productive + laneTotals.supporting + laneTotals.unclear + laneTotals.distracting,
    1,
  )

  const tabSwitches = tabSwitchEvents.length
  const tabsOpened = tabOpenEvents.length
  const audibleMoments = audibleEvents.length
  const pageSignals = pageSignalEvents.length
  const uniqueHosts = hostSet.size
  const productiveShare = round(laneTotals.productive / totalLaneWeight, 3)
  const supportingShare = round(laneTotals.supporting / totalLaneWeight, 3)
  const unclearShare = round(laneTotals.unclear / totalLaneWeight, 3)
  const distractingShare = round(laneTotals.distracting / totalLaneWeight, 3)
  const dominantLane = getDominantLaneFromTotals(laneTotals)
  const switchesPerHour = round(tabSwitches / measuredHours, 1)
  const tabsOpenedPerHour = round(tabsOpened / measuredHours, 1)
  const audiblePerHour = round(audibleMoments / measuredHours, 1)

  const countDrivenPressure = (
    (Math.min(1, switchesPerHour / 10) * 44) +
    (Math.min(1, tabsOpenedPerHour / 4) * 14) +
    (Math.min(1, audiblePerHour / 2) * 12) +
    (Math.min(1, uniqueHosts / 6) * 10)
  )
  const semanticPressureLift = (
    (distractingShare * 26) +
    (unclearShare * 8) -
    (productiveShare * 8) -
    (supportingShare * 5)
  )
  const pressureScore = Math.round(clamp(countDrivenPressure + semanticPressureLift, 0, 100))

  const continuityPenalty = Math.round(clamp(
    (switchesPerHour * 2.9) +
    (tabsOpenedPerHour * 2.1) +
    (distractingShare * 6) +
    (unclearShare * 2.5),
    0,
    24,
  ))
  const stabilityPenalty = Math.round(clamp(
    (uniqueHosts * 1.3) +
    (audiblePerHour * 4.8) +
    (distractingShare * 10) +
    (unclearShare * 4) -
    (supportingShare * 2) -
    (productiveShare * 3),
    0,
    22,
  ))
  const activityPenalty = Math.round(clamp(
    (audiblePerHour * 2.1) +
    (distractingShare * 9) +
    (unclearShare * 3) -
    (productiveShare * 2),
    0,
    16,
  ))
  const fatigueLift = Math.round(clamp(
    (pressureScore * 0.18) +
    (audiblePerHour * 3) +
    (distractingShare * 12) +
    (unclearShare * 4) -
    (productiveShare * 3) -
    (supportingShare * 2),
    0,
    24,
  ))

  let dominantPressureLabel = 'Quiet browser context'
  if (distractingShare >= 0.5 && audibleMoments > 0) dominantPressureLabel = 'Distracting browser overlap'
  else if (distractingShare >= 0.5) dominantPressureLabel = 'Distracting browser context'
  else if (unclearShare >= 0.55 && uniqueHosts >= 3) dominantPressureLabel = 'Unclear browsing spread'
  else if (productiveShare >= 0.55) dominantPressureLabel = 'Productive browser work'
  else if (supportingShare >= 0.55) dominantPressureLabel = 'Supporting browser context'
  else if (audibleMoments > 0 && audiblePerHour >= 0.8) dominantPressureLabel = 'Browser audio overlap'
  else if (tabSwitches >= 10 || switchesPerHour >= 6) dominantPressureLabel = 'Heavy browser switching'
  else if (tabsOpened >= 3 || tabsOpenedPerHour >= 1.5) dominantPressureLabel = 'Frequent new tabs'
  else if (uniqueHosts >= 4) dominantPressureLabel = 'Wide browser spread'

  return {
    totalEvents: inRangeEvents.length,
    tabSwitches,
    tabsOpened,
    audibleMoments,
    pageSignals,
    uniqueHosts,
    measuredHours: round(measuredHours, 2),
    switchesPerHour,
    tabsOpenedPerHour,
    audiblePerHour,
    dominantLane,
    laneTotals,
    laneEventCounts,
    productiveShare,
    supportingShare,
    unclearShare,
    distractingShare,
    pressureScore,
    continuityPenalty,
    stabilityPenalty,
    activityPenalty,
    fatigueLift,
    dominantPressureLabel,
    latestSwitch: [...tabSwitchEvents].sort((left, right) => safeNumber(right?.ts) - safeNumber(left?.ts))[0] || null,
    latestTabOpen: [...tabOpenEvents].sort((left, right) => safeNumber(right?.ts) - safeNumber(left?.ts))[0] || null,
    latestAudible: [...audibleEvents].sort((left, right) => safeNumber(right?.ts) - safeNumber(left?.ts))[0] || null,
    latestEvent: inRangeEvents[inRangeEvents.length - 1] || null,
  }
}

export function applyBrowserSignalsToAnalysis(baseAnalysis = {}, browserSignals = {}, {
  source = 'session',
} = {}) {
  const basePillars = baseAnalysis?.pillars || {}
  const browserPressure = safeNumber(browserSignals?.pressureScore)
  const continuityPenalty = safeNumber(browserSignals?.continuityPenalty)
  const stabilityPenalty = safeNumber(browserSignals?.stabilityPenalty)
  const activityPenalty = safeNumber(browserSignals?.activityPenalty)
  const fatigueLift = safeNumber(browserSignals?.fatigueLift)
  const productiveShare = clamp(safeNumber(browserSignals?.productiveShare), 0, 1)
  const supportingShare = clamp(safeNumber(browserSignals?.supportingShare), 0, 1)
  const unclearShare = clamp(safeNumber(browserSignals?.unclearShare), 0, 1)
  const distractingShare = clamp(safeNumber(browserSignals?.distractingShare), 0, 1)
  const semanticPresencePenalty = Math.round(clamp(
    (distractingShare * 9) + (unclearShare * 4),
    0,
    12,
  ))
  const semanticActivityPenalty = Math.round(clamp(
    (distractingShare * 8) + (unclearShare * 3) - (productiveShare * 2),
    0,
    12,
  ))
  const semanticContinuityPenalty = Math.round(clamp(
    (distractingShare * 5) + (unclearShare * 2),
    0,
    9,
  ))
  const semanticStabilityPenalty = Math.round(clamp(
    (distractingShare * 12) + (unclearShare * 5) - (supportingShare * 2) - (productiveShare * 3),
    0,
    18,
  ))
  const semanticFocusPenalty = Math.round(clamp(
    (distractingShare * 16) + (unclearShare * 6) - (productiveShare * 4) - (supportingShare * 2),
    0,
    18,
  ))
  const semanticFatigueLift = Math.round(clamp(
    (distractingShare * 12) + (unclearShare * 4) - (productiveShare * 3) - (supportingShare * 1.5),
    0,
    18,
  ))

  const adjustedPillars = {
    presence: Math.round(clamp(safeNumber(basePillars.presence) - semanticPresencePenalty, 0, 100)),
    activity: Math.round(clamp(safeNumber(basePillars.activity) - activityPenalty - semanticActivityPenalty, 0, 100)),
    continuity: Math.round(clamp(safeNumber(basePillars.continuity) - continuityPenalty - semanticContinuityPenalty, 0, 100)),
    stability: Math.round(clamp(safeNumber(basePillars.stability) - stabilityPenalty - semanticStabilityPenalty, 0, 100)),
  }

  const browserPenaltyWeight = source === 'background' ? 0.18 : 0.15
  const backgroundDisruptionPenalty = source === 'background'
    ? Math.round(clamp((distractingShare * 14) + (unclearShare * 5), 0, 12))
    : 0
  const adjustedFocusScore = Math.round(clamp(
    safeNumber(baseAnalysis?.focusScore) - (browserPressure * browserPenaltyWeight) - semanticFocusPenalty - backgroundDisruptionPenalty,
    0,
    100,
  ))
  const adjustedFatigueScore = Math.round(clamp(
    safeNumber(baseAnalysis?.fatigueScore) + fatigueLift + semanticFatigueLift,
    0,
    100,
  ))

  return {
    ...baseAnalysis,
    focusScore: adjustedFocusScore,
    fatigueScore: adjustedFatigueScore,
    pillars: adjustedPillars,
    browserSignals: {
      totalEvents: safeNumber(browserSignals?.totalEvents),
      tabSwitches: safeNumber(browserSignals?.tabSwitches),
      tabsOpened: safeNumber(browserSignals?.tabsOpened),
      audibleMoments: safeNumber(browserSignals?.audibleMoments),
      uniqueHosts: safeNumber(browserSignals?.uniqueHosts),
      measuredHours: safeNumber(browserSignals?.measuredHours),
      switchesPerHour: safeNumber(browserSignals?.switchesPerHour),
      tabsOpenedPerHour: safeNumber(browserSignals?.tabsOpenedPerHour),
      audiblePerHour: safeNumber(browserSignals?.audiblePerHour),
      dominantLane: browserSignals?.dominantLane || 'unclear',
      laneTotals: browserSignals?.laneTotals || {
        productive: 0,
        supporting: 0,
        unclear: 0,
        distracting: 0,
      },
      laneEventCounts: browserSignals?.laneEventCounts || {
        productive: 0,
        supporting: 0,
        unclear: 0,
        distracting: 0,
      },
      productiveShare,
      supportingShare,
      unclearShare,
      distractingShare,
      pressureScore: browserPressure,
      dominantPressureLabel: browserSignals?.dominantPressureLabel || 'Quiet browser context',
      latestSwitch: browserSignals?.latestSwitch || null,
      latestTabOpen: browserSignals?.latestTabOpen || null,
      latestAudible: browserSignals?.latestAudible || null,
      latestEvent: browserSignals?.latestEvent || null,
    },
  }
}

export function aggregateAmbientEntriesForAnalysis(entries = []) {
  return entries.reduce((sum, entry) => {
    const duration = Math.max(0, safeNumber(entry?.duration))
    const lane = resolveAmbientEntryLane(entry)
    const confidence = clamp(safeNumber(entry?.confidence, 0.72), 0, 1)
    const timestamp = safeNumber(entry?.ts)
    const hour = timestamp ? new Date(timestamp).getHours() : null

    sum.trackedSeconds += duration
    sum.switches += safeNumber(entry?.switches)
    if (lane === 'productive') sum.productiveSeconds += duration
    else if (lane === 'supporting') sum.supportingSeconds += duration
    else if (lane === 'distracting') sum.distractingSeconds += duration
    else sum.unclearSeconds += duration
    sum.weightedConfidence += confidence * duration
    sum.sampleCount += 1
    if (hour !== null && (hour >= 21 || hour < 6)) sum.lateSeconds += duration
    return sum
  }, {
    trackedSeconds: 0,
    switches: 0,
    productiveSeconds: 0,
    supportingSeconds: 0,
    unclearSeconds: 0,
    distractingSeconds: 0,
    weightedConfidence: 0,
    sampleCount: 0,
    lateSeconds: 0,
  })
}

export function buildBackgroundFatigueSnapshot(entries = []) {
  if (!Array.isArray(entries) || !entries.length) {
    return {
      score: 0,
      risk: 'Low',
      trackedSeconds: 0,
      switches: 0,
      distractingShare: 0,
      unclearShare: 0,
      supportingShare: 0,
      lateShare: 0,
      confidenceScore: 0,
      confidenceRatio: 0,
      dominantDriver: 'No background pressure',
    }
  }

  const aggregate = aggregateAmbientEntriesForAnalysis(entries)
  const weightedConfidence = aggregate.trackedSeconds > 0
    ? aggregate.weightedConfidence / aggregate.trackedSeconds
    : 0.72
  const profile = computeFatigueProfile({
    totalSeconds: aggregate.trackedSeconds,
    switches: aggregate.switches,
    distractingSeconds: aggregate.distractingSeconds,
    unclearSeconds: aggregate.unclearSeconds,
    supportingSeconds: aggregate.supportingSeconds,
    lateShare: aggregate.trackedSeconds > 0 ? aggregate.lateSeconds / aggregate.trackedSeconds : 0,
    weightedConfidence,
    observedRatio: 1,
    activeRatio: 1,
    sampleCount: aggregate.sampleCount,
    durationMinutes: 0,
  })

  return {
    ...profile,
    trackedSeconds: aggregate.trackedSeconds,
  }
}

export function buildBrowserAwareBackgroundFatigueSnapshot(entries = [], browserEvents = [], {
  startTs = 0,
  endTs = 0,
  padMs = 0,
} = {}) {
  const base = buildBackgroundFatigueSnapshot(entries)
  const fallbackStart = [...entries]
    .map((entry) => safeNumber(entry?.ts))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)[0] || 0
  const fallbackEnd = [...entries]
    .map((entry) => safeNumber(entry?.endTs || (safeNumber(entry?.ts) + (safeNumber(entry?.duration) * 1000))))
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0] || fallbackStart
  const signals = summarizeBrowserSignalsForRange(browserEvents, {
    startTs: safeNumber(startTs) || fallbackStart,
    endTs: Math.max(safeNumber(endTs), fallbackEnd),
    padMs,
  })
  const score = Math.round(clamp(safeNumber(base.score) + safeNumber(signals.fatigueLift), 0, 100))

  return {
    ...base,
    score,
    risk: getFatigueRisk(score),
    dominantDriver: safeNumber(signals.pressureScore) >= 44
      ? signals.dominantPressureLabel
      : (base.dominantDriver || 'Stable background load'),
    browserSignals: signals,
  }
}

export function buildBackgroundWindowAnalysis(window = {}) {
  const totalSeconds = Math.max(1, safeNumber(window.totalSeconds))
  const productiveSeconds = safeNumber(window.productiveSeconds)
  const supportingSeconds = safeNumber(window.supportingSeconds)
  const unclearSeconds = safeNumber(window.unclearSeconds)
  const distractingSeconds = safeNumber(window.distractingSeconds)
  const weightedConfidence = clamp(safeNumber(window.avgConfidence, 0.72), 0.15, 1)
  const favorableShare = clamp((productiveSeconds + supportingSeconds) / totalSeconds, 0, 1)
  const engagedShare = clamp((productiveSeconds + (supportingSeconds * 0.75) + (unclearSeconds * 0.2)) / totalSeconds, 0.08, 1)
  const chunkDensity = clamp(safeNumber(window.chunkCount, 1) / Math.max(1, totalSeconds / 75), 0.28, 1)
  const observedRatio = clamp((weightedConfidence * 0.45) + (chunkDensity * 0.3) + (favorableShare * 0.25), 0.28, 1)
  const activeRatio = clamp(engagedShare - ((distractingSeconds / totalSeconds) * 0.22), 0.08, 1)
  const focus = computeFocusProfile({
    totalSeconds,
    productiveSeconds,
    supportingSeconds,
    unclearSeconds,
    distractingSeconds,
    activeRatio,
    switches: safeNumber(window.switches),
    weightedConfidence,
    observedRatio,
    chunkCount: safeNumber(window.chunkCount, 1),
  })
  const fatigue = computeFatigueProfile({
    totalSeconds,
    switches: safeNumber(window.switches),
    distractingSeconds,
    unclearSeconds,
    supportingSeconds,
    weightedConfidence,
    observedRatio,
    activeRatio,
    chunkCount: safeNumber(window.chunkCount, 1),
    durationMinutes: 0,
  })

  return {
    ...focus,
    fatigueScore: fatigue.score,
    fatigueRisk: fatigue.risk,
    observedRatio,
    activeRatio,
    fatigueDrivers: {
      durationLoad: fatigue.durationLoad,
      idleLoad: fatigue.idleLoad,
      switchLoad: fatigue.switchLoad,
      focusDecayLoad: fatigue.focusDecayLoad,
      distractionLoad: fatigue.distractionLoad,
      ambiguityLoad: fatigue.ambiguityLoad,
      supportingLoad: fatigue.supportingLoad,
      lateLoad: fatigue.lateLoad,
    },
    topFatigueDriverLabel: fatigue.dominantDriver,
  }
}

export function buildStoredSessionAnalysis(session = {}) {
  const durationSeconds = Math.max(1, safeNumber(session.durationSeconds))
  const summary = session.sessionSummary || {}
  const observedRatioRaw = safeNumber(session.observedRatio, safeNumber(summary.observedRatio))
  const activeRatioRaw = safeNumber(summary.activeRatio)
  const observedRatio = observedRatioRaw > 1 ? observedRatioRaw / 100 : observedRatioRaw
  const activeRatio = activeRatioRaw > 1 ? activeRatioRaw / 100 : activeRatioRaw
  const idleRatioRaw = safeNumber(session.idleRatio, safeNumber(summary.idleRatio))
  const idleRatio = idleRatioRaw > 1 ? idleRatioRaw / 100 : idleRatioRaw
  const weightedConfidence = computeWeightedConfidence(session.appBreakdown || [], {
    secondsKey: 'seconds',
    confidenceKey: 'confidence',
    fallback: clamp(safeNumber(session.primaryContextConfidence, 0.72), 0.15, 1),
  })
  const inputIntensity = computeInputIntensity({
    averageKpm: safeNumber(session.keystrokesPerMin, safeNumber(summary.averageKpm)),
    mouseIntensity: safeNumber(session.mouseIntensity, safeNumber(summary.mouseIntensity)),
  })
  const focusDecay = deriveFocusDecay((session.timelineSegments || session.timeline || []).map((segment) => safeNumber(segment?.focusScore ?? segment?.score)))

  const focus = computeFocusProfile({
    totalSeconds: durationSeconds,
    productiveSeconds: safeNumber(session.productiveSeconds),
    supportingSeconds: safeNumber(session.supportingSeconds),
    unclearSeconds: safeNumber(session.unclearSeconds),
    distractingSeconds: safeNumber(session.distractingSeconds),
    activeRatio: clamp(activeRatio || (1 - idleRatio), 0, 1),
    switches: safeNumber(session.windowSwitchCount, safeNumber(summary.windowSwitchCount)),
    inputIntensity,
    weightedConfidence,
    observedRatio: clamp(observedRatio || 1, 0, 1),
    sampleCount: safeNumber(summary.sampleCount),
    chunkCount: Array.isArray(session.timelineSegments || session.timeline) ? (session.timelineSegments || session.timeline).length : 0,
  })

  const fatigue = computeFatigueProfile({
    totalSeconds: durationSeconds,
    switches: safeNumber(session.windowSwitchCount, safeNumber(summary.windowSwitchCount)),
    distractingSeconds: safeNumber(session.distractingSeconds),
    unclearSeconds: safeNumber(session.unclearSeconds),
    supportingSeconds: safeNumber(session.supportingSeconds),
    idleRatio: clamp(idleRatio, 0, 1),
    focusDecay,
    weightedConfidence,
    observedRatio: clamp(observedRatio || 1, 0, 1),
    activeRatio: clamp(activeRatio || (1 - idleRatio), 0, 1),
    sampleCount: safeNumber(summary.sampleCount),
    chunkCount: Array.isArray(session.timelineSegments || session.timeline) ? (session.timelineSegments || session.timeline).length : 0,
  })

  return {
    focusScore: focus.focusScore,
    pillars: focus.pillars,
    confidenceScore: focus.confidenceScore,
    confidenceRatio: focus.confidenceRatio,
    fatigueScore: fatigue.score,
    fatigueRisk: fatigue.risk,
    fatigueDrivers: {
      durationLoad: fatigue.durationLoad,
      idleLoad: fatigue.idleLoad,
      switchLoad: fatigue.switchLoad,
      focusDecayLoad: fatigue.focusDecayLoad,
      distractionLoad: fatigue.distractionLoad,
      ambiguityLoad: fatigue.ambiguityLoad,
      supportingLoad: fatigue.supportingLoad,
      lateLoad: fatigue.lateLoad,
    },
    topFatigueDriverLabel: fatigue.dominantDriver,
    focusFormulaVersion: FOCUS_FORMULA_VERSION,
    fatigueFormulaVersion: FATIGUE_FORMULA_VERSION,
  }
}
