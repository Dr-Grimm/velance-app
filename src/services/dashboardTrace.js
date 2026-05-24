import { formatLocalDateKey } from './dateKey.js'
import {
  applyBrowserSignalsToAnalysis,
  buildBackgroundWindowAnalysis,
  summarizeBrowserSignalsForRange,
} from './analysisEngine.js'
import { buildBrowserEvidenceSummary } from './browserEvidenceService.js'
import { getCategoryDefaultLane } from './activityClassification.js'

const TRACE_PADDING_MS = 12 * 60 * 1000
const AMBIENT_GAP_MS = 24 * 60 * 1000
const AMBIENT_MIN_WINDOW_MS = 2 * 60 * 60 * 1000
const BROWSER_APP_HINTS = ['chrome', 'edge', 'firefox', 'browser', 'brave', 'opera', 'arc', 'safari', 'vivaldi', 'chromium']

function parseTraceTimestamp(value, fallback = 0) {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? timestamp : Number(fallback || 0)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return Number(fallback || 0)
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      value = numeric
    } else {
      const parsed = Date.parse(trimmed)
      return Number.isFinite(parsed) ? parsed : Number(fallback || 0)
    }
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return Number(fallback || 0)
  if (numeric < 1e11) return numeric * 1000
  return numeric
}

function clampScore(score) {
  const safe = Number(score || 0)
  return Math.max(0, Math.min(100, Math.round(safe)))
}

function sortTracePoints(points = []) {
  return [...points].sort((left, right) => left.x - right.x)
}

function normalizeAmbientLane(entry = {}) {
  const rawLane = String(entry?.lane || '').trim().toLowerCase()
  const normalizedLane = rawLane === 'productive' || rawLane === 'supporting' || rawLane === 'unclear' || rawLane === 'distracting'
    ? rawLane
    : (entry?.productive === true ? 'productive' : entry?.productive === false ? 'distracting' : 'unclear')

  if (entry?.isCustom) return normalizedLane

  const categoryLane = getCategoryDefaultLane(entry?.category || '', {
    productive: entry?.productive ?? null,
    subcategory: entry?.subcategory || '',
    contextLabel: entry?.contextLabel || entry?.browserPage || entry?.browserHost || '',
    appName: entry?.appGroup || entry?.app || entry?.sourceApp || '',
  })

  if (categoryLane === 'distracting') return 'distracting'
  if (categoryLane === 'supporting' && normalizedLane === 'productive') return 'supporting'
  return normalizedLane
}

function getBucketMs(span = 0) {
  if (span <= (90 * 60 * 1000)) return 3 * 60 * 1000
  if (span <= (4 * 60 * 60 * 1000)) return 5 * 60 * 1000
  if (span <= (8 * 60 * 60 * 1000)) return 10 * 60 * 1000
  return 15 * 60 * 1000
}

function getDominantKey(map = {}, fallback = '') {
  return Object.entries(map).sort((left, right) => right[1] - left[1])[0]?.[0] || fallback
}

function getGroupToneFromLane(lane = 'unclear') {
  if (lane === 'productive') return 'productive'
  if (lane === 'supporting') return 'supporting'
  if (lane === 'distracting') return 'distracting'
  return 'unclear'
}

function getGroupKindLabel(kind = 'ambient') {
  if (kind === 'live') return 'Live focus'
  if (kind === 'review') return 'Review-ready focus'
  if (kind === 'saved') return 'Focus session'
  return 'Activity window'
}

function getBucketLaneSeconds(bucket = {}, lane = 'unclear') {
  return Math.max(0, Number(bucket?.laneTotals?.[lane] || 0))
}

function isBrowserLikeEntry(entry = {}) {
  if (entry?.browserHost || entry?.browserPage || entry?.browserUrl) return true
  const appLabel = String(entry?.appGroup || entry?.app || '').trim().toLowerCase()
  return BROWSER_APP_HINTS.some((hint) => appLabel.includes(hint))
}

function getEntryContextLabel(entry = {}) {
  const contextLabel = String(entry?.contextLabel || entry?.browserPage || entry?.browserHost || '').trim()
  const appLabel = String(entry?.appGroup || entry?.app || 'Tracked activity').trim() || 'Tracked activity'
  if (!contextLabel) return appLabel
  if (isBrowserLikeEntry(entry)) return contextLabel
  return contextLabel === appLabel ? appLabel : contextLabel
}

function buildAmbientGroups(entries = [], {
  todayKey = '',
  now = Date.now(),
  browserEvents = [],
} = {}) {
  const filtered = [...entries]
    .filter((entry) => entry?.ts && entry?.duration)
    .filter((entry) => !todayKey || formatLocalDateKey(entry.ts) === todayKey)
    .sort((left, right) => Number(left.ts || 0) - Number(right.ts || 0))
  const normalizedBrowserEvents = Array.isArray(browserEvents)
    ? browserEvents.filter((entry) => Number(entry?.ts || 0) > 0)
    : []

  if (!filtered.length) {
    return {
      groups: [],
      pointCount: 0,
      blockCount: 0,
      includesLive: false,
      sparseBlocks: 0,
      firstTs: 0,
      lastTs: 0,
      activitySeconds: 0,
    }
  }

  const firstTs = parseTraceTimestamp(filtered[0]?.ts || now, now)
  const lastEntry = filtered[filtered.length - 1]
  const lastTs = parseTraceTimestamp(lastEntry?.endTs || lastEntry?.ts || now, parseTraceTimestamp(lastEntry?.ts || now, now))
  const initialRange = Math.max(1, lastTs - firstTs)
  const bucketMs = getBucketMs(initialRange)
  const buckets = new Map()
  let totalSeconds = 0

  filtered.forEach((entry) => {
    const startTs = parseTraceTimestamp(entry?.ts || 0)
    const durationSeconds = Math.max(1, Number(entry?.duration || 0))
    if (!startTs) return

    const lane = normalizeAmbientLane(entry)
    const bucketStart = Math.floor(startTs / bucketMs) * bucketMs
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, {
        startTs,
        endTs: startTs + (durationSeconds * 1000),
        trackedSeconds: 0,
        laneTotals: {},
        appTotals: {},
        contextTotals: {},
        weightedConfidence: 0,
        switches: 0,
        chunkCount: 0,
        browserSeconds: 0,
        points: [],
      })
    }

    const bucket = buckets.get(bucketStart)
    bucket.startTs = Math.min(bucket.startTs, startTs)
    bucket.endTs = Math.max(bucket.endTs, startTs + (durationSeconds * 1000))
    bucket.trackedSeconds += durationSeconds
    bucket.laneTotals[lane] = (bucket.laneTotals[lane] || 0) + durationSeconds
    const appName = String(entry?.appGroup || entry?.app || entry?.browserHost || 'Tracked activity')
    const contextLabel = getEntryContextLabel(entry)
    bucket.appTotals[appName] = (bucket.appTotals[appName] || 0) + durationSeconds
    bucket.contextTotals[contextLabel] = (bucket.contextTotals[contextLabel] || 0) + durationSeconds
    bucket.weightedConfidence += Math.max(0, Math.min(1, Number(entry?.confidence ?? 0.56))) * durationSeconds
    bucket.switches += Math.max(0, Number(entry?.switches || 0))
    bucket.chunkCount += 1
    if (isBrowserLikeEntry(entry)) bucket.browserSeconds += durationSeconds
    totalSeconds += durationSeconds
  })

  const orderedBuckets = [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucketStart, bucket], index) => {
      const dominantLane = getDominantKey(bucket.laneTotals, 'unclear')
      const baseAnalysis = buildBackgroundWindowAnalysis({
        totalSeconds: bucket.trackedSeconds,
        productiveSeconds: getBucketLaneSeconds(bucket, 'productive'),
        supportingSeconds: getBucketLaneSeconds(bucket, 'supporting'),
        unclearSeconds: getBucketLaneSeconds(bucket, 'unclear'),
        distractingSeconds: getBucketLaneSeconds(bucket, 'distracting'),
        switches: bucket.switches,
        chunkCount: bucket.chunkCount,
        avgConfidence: bucket.trackedSeconds > 0
          ? Number((bucket.weightedConfidence / bucket.trackedSeconds).toFixed(3))
          : 0.56,
      })
      const browserSignals = summarizeBrowserSignalsForRange(normalizedBrowserEvents, {
        startTs: bucket.startTs,
        endTs: bucket.endTs,
        padMs: 30 * 1000,
      })
      const browserEvidence = buildBrowserEvidenceSummary({
        ambientEntries: filtered,
        browserEvents: normalizedBrowserEvents,
        startTs: bucket.startTs,
        endTs: bucket.endTs,
        padMs: 30 * 1000,
        limit: 2,
      })
      const analysis = browserSignals.totalEvents
        ? applyBrowserSignalsToAnalysis(baseAnalysis, browserSignals, { source: 'background' })
        : baseAnalysis
      const score = Math.max(0, Math.min(100, Math.round(Number(analysis?.focusScore || 0))))
      const bucketLooksBrowserDriven = bucket.browserSeconds > 0 || browserEvidence.totalEvents > 0
      const resolvedLane = bucketLooksBrowserDriven
        ? String(browserEvidence.dominantLane || dominantLane || 'unclear')
        : dominantLane
      const dominantContext = getDominantKey(bucket.contextTotals, getDominantKey(bucket.appTotals, 'Tracked activity'))
      const browserPageLabel = String(browserEvidence.leadPage?.label || browserEvidence.activePage?.label || '').trim()
      const browserSiteLabel = String(browserEvidence.leadSite?.label || browserEvidence.activeSite?.label || '').trim()
      const displayLabel = bucketLooksBrowserDriven
        ? (browserPageLabel || browserSiteLabel || dominantContext)
        : dominantContext
      const siteLabel = bucketLooksBrowserDriven
        ? browserSiteLabel
        : ''

      return {
        id: `ambient-point-${index + 1}`,
        bucketStart,
        bucketEnd: bucketStart + bucketMs,
        startTs: bucket.startTs,
        endTs: bucket.endTs,
        trackedSeconds: bucket.trackedSeconds,
        dominantLane: resolvedLane,
        dominantApp: getDominantKey(bucket.appTotals, 'Tracked activity'),
        displayLabel,
        siteLabel,
        switches: bucket.switches,
        avgConfidence: bucket.trackedSeconds > 0
          ? Number((bucket.weightedConfidence / bucket.trackedSeconds).toFixed(3))
          : 0.56,
        browserSignals,
        browserEvidence,
        score,
        x: bucketStart + Math.round(bucketMs / 2),
        y: score,
      }
    })

  const groups = []
  let currentGroup = null
  orderedBuckets.forEach((bucket, index) => {
    const shouldMerge = currentGroup
      && (bucket.bucketStart - currentGroup.lastBucketStart) <= AMBIENT_GAP_MS

    if (!shouldMerge) {
      if (currentGroup) {
        currentGroup.data = sortTracePoints(currentGroup.data)
        currentGroup.pointCount = currentGroup.data.length
        currentGroup.avgScore = Math.round(currentGroup.data.reduce((sum, point) => sum + point.y, 0) / currentGroup.data.length)
        currentGroup.kindLabel = getGroupKindLabel(currentGroup.kind)
        currentGroup.pointsLabel = `${currentGroup.pointCount} measured bucket${currentGroup.pointCount === 1 ? '' : 's'}`
        groups.push(currentGroup)
      }

      currentGroup = {
        id: `ambient-group-${index + 1}`,
        kind: 'ambient',
        kindLabel: getGroupKindLabel('ambient'),
        label: bucket.displayLabel || bucket.dominantApp,
        startTs: bucket.startTs,
        endTs: bucket.endTs,
        data: [],
        pointCount: 0,
        totalTrackedSeconds: 0,
        laneTotals: {},
        appTotals: {},
        contextTotals: {},
        lastBucketStart: bucket.bucketStart,
      }
    }

    currentGroup.startTs = Math.min(currentGroup.startTs, bucket.startTs)
    currentGroup.endTs = Math.max(currentGroup.endTs, bucket.endTs)
    currentGroup.totalTrackedSeconds += bucket.trackedSeconds
    currentGroup.lastBucketStart = bucket.bucketStart
    currentGroup.laneTotals[bucket.dominantLane] = (currentGroup.laneTotals[bucket.dominantLane] || 0) + bucket.trackedSeconds
    currentGroup.appTotals[bucket.dominantApp] = (currentGroup.appTotals[bucket.dominantApp] || 0) + bucket.trackedSeconds
    currentGroup.contextTotals[bucket.displayLabel || bucket.dominantApp] = (currentGroup.contextTotals[bucket.displayLabel || bucket.dominantApp] || 0) + bucket.trackedSeconds
    currentGroup.data.push({
      id: bucket.id,
      x: bucket.x,
      y: bucket.y,
      meta: {
        lane: bucket.dominantLane,
        app: bucket.displayLabel || bucket.dominantApp,
        browserSite: bucket.siteLabel || '',
        trackedSeconds: bucket.trackedSeconds,
        windowStart: bucket.startTs,
        windowEnd: bucket.endTs,
        switches: bucket.switches,
        avgConfidence: bucket.avgConfidence,
        browserPressure: Number(bucket.browserSignals?.pressureScore || 0),
        bucketLabel: `${bucket.pointCount || 1} bucket`,
      },
    })
  })

  if (currentGroup) {
    currentGroup.data = sortTracePoints(currentGroup.data)
    currentGroup.pointCount = currentGroup.data.length
    currentGroup.avgScore = Math.round(currentGroup.data.reduce((sum, point) => sum + point.y, 0) / currentGroup.data.length)
    currentGroup.kindLabel = getGroupKindLabel(currentGroup.kind)
    currentGroup.pointsLabel = `${currentGroup.pointCount} measured bucket${currentGroup.pointCount === 1 ? '' : 's'}`
    groups.push(currentGroup)
  }

  groups.forEach((group) => {
    group.primaryLane = getDominantKey(group.laneTotals, 'unclear')
    group.label = getDominantKey(group.contextTotals, group.label || getDominantKey(group.appTotals, 'Tracked activity'))
    group.tone = getGroupToneFromLane(group.primaryLane)
  })

  return {
    groups,
    pointCount: orderedBuckets.length,
    blockCount: groups.length,
    includesLive: false,
    sparseBlocks: groups.filter((group) => group.pointCount <= 1).length,
    firstTs,
    lastTs,
    activitySeconds: totalSeconds,
  }
}

function buildTracePointsFromSession(session = {}) {
  const fallbackTimestamp = parseTraceTimestamp(session?.timestamp || session?.createdAt || 0)
  const slices = Array.isArray(session?.timeline) && session.timeline.length
    ? session.timeline
    : (Array.isArray(session?.timelineSegments) ? session.timelineSegments : [])

  if (slices.length) {
    const points = sortTracePoints(
      slices
        .map((slice, index) => {
          const timestamp = parseTraceTimestamp(
            slice?.timestamp,
            fallbackTimestamp ? fallbackTimestamp + (Number(slice?.t || 0) * 1000) : 0,
          )
          if (!timestamp) return null
          return {
            id: `${session?.id || fallbackTimestamp}-${slice?.id || index}`,
            x: timestamp,
            y: clampScore(slice?.focusScore ?? slice?.score ?? session?.focusScore ?? 0),
          }
        })
        .filter(Boolean),
    )

    if (points.length === 1 && Number(session?.durationSeconds || 0) > 0) {
      points.push({
        id: `${session?.id || fallbackTimestamp}-end`,
        x: points[0].x + (Number(session.durationSeconds) * 1000),
        y: points[0].y,
      })
    }

    return sortTracePoints(points)
  }

  if (!fallbackTimestamp) return []

  const fallbackPoints = [{
    id: `${session?.id || fallbackTimestamp}-fallback`,
    x: fallbackTimestamp,
    y: clampScore(session?.focusScore || 0),
  }]

  if (Number(session?.durationSeconds || 0) > 0) {
    fallbackPoints.push({
      id: `${session?.id || fallbackTimestamp}-fallback-end`,
      x: fallbackTimestamp + (Number(session.durationSeconds) * 1000),
      y: clampScore(session?.focusScore || 0),
    })
  }

  return fallbackPoints
}

function buildGroupLabel(session = {}, fallback = 'Block') {
  return (
    session?.goal ||
    session?.taskTitle ||
    session?.habit ||
    session?.sessionType ||
    fallback
  )
}

function buildGroup(group = {}, data = []) {
  if (!data.length) return null
  const sorted = sortTracePoints(data)
  return {
    ...group,
    startTs: sorted[0]?.x || 0,
    endTs: sorted[sorted.length - 1]?.x || 0,
    pointCount: sorted.length,
    data: sorted,
  }
}

function buildSessionGroup(session, kind = 'saved') {
  return buildGroup({
    id: `${kind}-${session?.id || session?.timestamp || Date.now()}`,
    kind,
    label: buildGroupLabel(session),
  }, buildTracePointsFromSession(session))
}

function buildLiveGroup({
  startedAt = 0,
  timelineSegments = [],
  elapsedSeconds = 0,
  focusScore = 0,
} = {}) {
  const safeStartedAt = parseTraceTimestamp(startedAt || 0)
  if (!safeStartedAt) return null

  const liveSlices = Array.isArray(timelineSegments)
    ? timelineSegments
      .map((slice, index) => {
        const timestamp = parseTraceTimestamp(
          slice?.timestamp,
          safeStartedAt + (Number(slice?.t || 0) * 1000),
        )
        if (!timestamp) return null
        return {
          id: `live-${slice?.id || index}`,
          x: timestamp,
          y: clampScore(slice?.focusScore ?? slice?.score ?? focusScore),
        }
      })
      .filter(Boolean)
    : []

  const currentPoint = elapsedSeconds > 0
    ? [{
      id: 'live-current',
      x: safeStartedAt + (Number(elapsedSeconds || 0) * 1000),
      y: clampScore(focusScore),
    }]
    : []

  return buildGroup({
    id: 'live-current',
    kind: 'live',
    label: 'Live session',
  }, [...liveSlices, ...currentPoint])
}

export function buildDashboardTrace({
  sessions = [],
  completedSession = null,
  tracker = {},
  ambientEntries = [],
  browserEvents = [],
  todayKey,
} = {}) {
  const ambientTrace = buildAmbientGroups(ambientEntries, {
    todayKey,
    browserEvents,
  })
  const traceGroups = []
  if (ambientTrace.pointCount) {
    traceGroups.push(...ambientTrace.groups)
  }

  const savedGroups = sessions
    .filter((session) => formatLocalDateKey(session?.timestamp || session?.createdAt || session?.date) === todayKey)
    .map((session) => buildSessionGroup(session, 'saved'))
    .filter(Boolean)

  traceGroups.push(...savedGroups)

  if (
    completedSession?.id &&
    !sessions.some((session) => session.id === completedSession.id) &&
    formatLocalDateKey(completedSession?.timestamp || completedSession?.createdAt || Date.now()) === todayKey
  ) {
    const reviewGroup = buildSessionGroup(completedSession, 'review')
    if (reviewGroup) traceGroups.push(reviewGroup)
  }

  const liveGroup = buildLiveGroup({
    startedAt: tracker?.startedAt,
    timelineSegments: tracker?.timelineSegments,
    elapsedSeconds: tracker?.elapsedSeconds,
    focusScore: tracker?.focusScore,
  })

  if (liveGroup && formatLocalDateKey(liveGroup.startTs) === todayKey) {
    traceGroups.push(liveGroup)
  }

  const sortedGroups = [...traceGroups].sort((left, right) => left.startTs - right.startTs)
  const allPoints = sortedGroups.flatMap((group) => group.data)
  const pointCount = allPoints.length
  const blockCount = sortedGroups.length
  const includesLive = sortedGroups.some((group) => group.kind === 'live')
  const sparseBlocks = sortedGroups.filter((group) => group.pointCount <= 1).length

  return {
    groups: sortedGroups,
    pointCount,
    blockCount,
    includesLive,
    sparseBlocks,
    firstTs: pointCount ? allPoints[0].x : 0,
    lastTs: pointCount ? allPoints[pointCount - 1].x : 0,
    activitySeconds: ambientTrace.activitySeconds || 0,
  }
}

export function buildDashboardTraceRange(trace = {}, now = Date.now()) {
  const safeNow = parseTraceTimestamp(now || Date.now(), Date.now())
  const dayStartDate = new Date(safeNow)
  dayStartDate.setHours(0, 0, 0, 0)
  const dayStart = dayStartDate.getTime()
  const dayEndDate = new Date(safeNow)
  dayEndDate.setHours(23, 59, 59, 999)
  const dayEnd = dayEndDate.getTime()

  if (!trace?.pointCount) {
    const start = new Date(safeNow)
    start.setHours(8, 0, 0, 0)
    const end = new Date(safeNow)
    end.setHours(Math.max(17, end.getHours() + 1), 0, 0, 0)
    return { min: start.getTime(), max: end.getTime() }
  }

  const first = Number(trace.firstTs || safeNow)
  const last = Number(trace.lastTs || safeNow)
  const spread = Math.max(last - first, trace.blockCount > 1 ? 60 * 60 * 1000 : 35 * 60 * 1000)
  const padding = Math.max(TRACE_PADDING_MS, Math.round(spread * 0.18))
  const minWindow = trace.activitySeconds > 0 ? AMBIENT_MIN_WINDOW_MS : 75 * 60 * 1000
  const windowStart = Math.max(dayStart, first - padding)
  const liveAnchor = trace.includesLive ? safeNow + (12 * 60 * 1000) : last + padding
  const windowEnd = Math.min(dayEnd, Math.max(last + padding, liveAnchor, windowStart + minWindow))

  return {
    min: windowStart,
    max: windowEnd,
  }
}

export function buildDashboardTraceSummary(trace = {}) {
  if (!trace?.blockCount) {
    return {
      chipLabel: 'Waiting',
      countLabel: 'No tracked blocks yet',
      helperText: 'Measured slices will appear after your first tracked focus block today.',
    }
  }

  const blockLabel = `${trace.blockCount} block${trace.blockCount === 1 ? '' : 's'} today`

  if (trace.activitySeconds > 0) {
    const minutes = Math.max(1, Math.round(trace.activitySeconds / 60))
    return {
      chipLabel: `${minutes}m tracked`,
      countLabel: blockLabel,
      helperText: 'Background tracking drives this view, with focus sessions layered in when they exist.',
    }
  }

  if (trace.includesLive) {
    return {
      chipLabel: 'Live now',
      countLabel: blockLabel,
      helperText: 'Measured slices only. Gaps mean Velance was not tracking between blocks.',
    }
  }

  if (trace.sparseBlocks > 0) {
    return {
      chipLabel: blockLabel,
      countLabel: `${trace.pointCount} measured point${trace.pointCount === 1 ? '' : 's'}`,
      helperText: 'Some blocks only have summary points, so the trace gets sharper as newer sessions are tracked.',
    }
  }

  return {
    chipLabel: blockLabel,
    countLabel: `${trace.pointCount} measured slices`,
    helperText: 'Measured slices only. Gaps mean Velance was not tracking between blocks.',
  }
}

export function getDashboardTraceColors(groups = []) {
  return groups.map((group) => {
    if (group.kind === 'live') return '#52B788'
    if (group.kind === 'review') return '#F59E0B'
    return '#00B4D8'
  })
}
