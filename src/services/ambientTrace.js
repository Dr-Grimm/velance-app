import { formatLocalDateKey } from './dateKey.js'

const TRACE_PADDING_MS = 20 * 60 * 1000
const TRACE_GAP_MS = 45 * 1000
const TRACE_BUCKET_SHORT_MS = 60 * 1000
const TRACE_BUCKET_MEDIUM_MS = 2 * 60 * 1000
const TRACE_BUCKET_LONG_MS = 5 * 60 * 1000

const TRACE_TONES = {
  productive: {
    key: 'productive',
    label: 'Productive',
    helper: 'Likely focused work',
    color: '#14B8A6',
    glow: 'rgba(20, 184, 166, 0.18)',
    rowTop: '17%',
  },
  neutral: {
    key: 'neutral',
    label: 'Supportive',
    helper: 'Docs, setup, reading, planning',
    color: '#94A3B8',
    glow: 'rgba(148, 163, 184, 0.16)',
    rowTop: '46%',
  },
  distracting: {
    key: 'distracting',
    label: 'Distracting',
    helper: 'Likely off-track time',
    color: '#FB7185',
    glow: 'rgba(251, 113, 133, 0.18)',
    rowTop: '75%',
  },
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getAmbientBandScore(entry = {}) {
  const confidence = clampNumber(Number(entry?.confidence ?? 0.55), 0.15, 1)

  if (entry?.productive === true) {
    return Math.round(70 + (confidence * 18))
  }

  if (entry?.productive === false) {
    return Math.round(18 + ((1 - confidence) * 12))
  }

  return Math.round(44 + (confidence * 12))
}

function getAmbientBandVisual(entry = {}) {
  const score = getAmbientBandScore(entry)
  const confidence = clampNumber(Number(entry?.confidence ?? 0.55), 0.15, 1)

  if (entry?.productive === true) {
    return {
      score,
      tone: 'productive',
      color: '#00B4D8',
      glow: 'rgba(0, 180, 216, 0.22)',
      height: clampNumber(Math.round(68 + (confidence * 18)), 64, 88),
    }
  }

  if (entry?.productive === false) {
    return {
      score,
      tone: 'distracting',
      color: '#F87171',
      glow: 'rgba(248, 113, 113, 0.18)',
      height: clampNumber(Math.round(24 + ((1 - confidence) * 14)), 20, 38),
    }
  }

  return {
    score,
    tone: 'neutral',
    color: '#94A3B8',
    glow: 'rgba(148, 163, 184, 0.16)',
    height: clampNumber(Math.round(44 + (confidence * 16)), 42, 64),
  }
}

function formatTraceHour(timestamp = 0, { includeMinutes = false } = {}) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: includeMinutes ? '2-digit' : undefined,
    hour12: true,
  }).format(new Date(timestamp)).toLowerCase()
}

function resolveTraceTone(entry = {}) {
  if (entry?.productive === true) return TRACE_TONES.productive
  if (entry?.productive === false) return TRACE_TONES.distracting
  return TRACE_TONES.neutral
}

function getTraceBucketMs(span = 0) {
  if (span <= (3 * 60 * 60 * 1000)) return TRACE_BUCKET_SHORT_MS
  if (span <= (8 * 60 * 60 * 1000)) return TRACE_BUCKET_MEDIUM_MS
  return TRACE_BUCKET_LONG_MS
}

function getDominantBucketTone(bucket = {}) {
  const productive = Number(bucket?.productiveSeconds || 0)
  const distracting = Number(bucket?.distractingSeconds || 0)
  const neutral = Number(bucket?.neutralSeconds || 0)

  if (productive >= distracting && productive >= neutral) return TRACE_TONES.productive
  if (distracting >= productive && distracting >= neutral) return TRACE_TONES.distracting
  return TRACE_TONES.neutral
}

function addBucketApp(bucket, app = '', duration = 0) {
  const key = String(app || 'Tracked activity')
  bucket.appTotals[key] = (bucket.appTotals[key] || 0) + Number(duration || 0)
}

function addBucketCategory(bucket, category = '', duration = 0) {
  const key = String(category || 'Activity')
  bucket.categoryTotals[key] = (bucket.categoryTotals[key] || 0) + Number(duration || 0)
}

function getDominantBucketValue(map = {}, fallback = '') {
  return Object.entries(map).sort((left, right) => right[1] - left[1])[0]?.[0] || fallback
}

export function describeAmbientTraceBand(score = 0) {
  const safe = Number(score || 0)
  if (safe >= 70) return 'Likely productive'
  if (safe <= 32) return 'Likely distracting'
  return 'Neutral or supporting'
}

function buildPoint(timestamp, score, entry, suffix) {
  return {
    id: `${entry?.id || entry?.ts || timestamp}-${suffix}`,
    x: Number(timestamp || 0),
    y: Number(score || 0),
    meta: {
      app: entry?.app || 'Tracked activity',
      category: entry?.category || 'Activity',
      duration: Number(entry?.duration || 0),
      band: describeAmbientTraceBand(score),
    },
  }
}

function finalizeGroup(group = null) {
  if (!group?.data?.length) return null
  return {
    id: group.id,
    label: group.label,
    startTs: group.startTs,
    endTs: group.endTs,
    chunkCount: group.chunkCount,
    totalSeconds: group.totalSeconds,
    data: group.data,
  }
}

export function buildAmbientTrace(entries = [], { todayKey = null } = {}) {
  const filteredEntries = [...entries]
    .filter((entry) => entry?.ts && entry?.duration)
    .filter((entry) => !todayKey || formatLocalDateKey(entry.ts) === todayKey)
    .sort((left, right) => left.ts - right.ts)

  if (!filteredEntries.length) {
    return {
      groups: [],
      blockCount: 0,
      chunkCount: 0,
      firstTs: 0,
      lastTs: 0,
    }
  }

  const groups = []
  let currentGroup = null
  let firstTs = 0
  let lastTs = 0

  filteredEntries.forEach((entry, index) => {
    const startTs = Number(entry.ts || 0)
    const endTs = Number(entry.endTs || (startTs + ((Number(entry.duration || 0)) * 1000)))

    if (!startTs || !endTs || endTs < startTs) return

    const score = getAmbientBandScore(entry)
    const previousEndTs = currentGroup?.endTs || 0
    const hasGap = currentGroup && (startTs - previousEndTs) > TRACE_GAP_MS

    if (!currentGroup || hasGap) {
      const finalized = finalizeGroup(currentGroup)
      if (finalized) groups.push(finalized)
      currentGroup = {
        id: `ambient-block-${groups.length + 1}`,
        label: `Block ${groups.length + 1}`,
        startTs,
        endTs,
        chunkCount: 0,
        totalSeconds: 0,
        data: [],
      }
    }

    currentGroup.data.push(
      buildPoint(startTs, score, entry, `${index}-start`),
      buildPoint(endTs, score, entry, `${index}-end`),
    )
    currentGroup.endTs = endTs
    currentGroup.chunkCount += 1
    currentGroup.totalSeconds += Number(entry.duration || 0)

    if (!firstTs || startTs < firstTs) firstTs = startTs
    if (!lastTs || endTs > lastTs) lastTs = endTs
  })

  const finalized = finalizeGroup(currentGroup)
  if (finalized) groups.push(finalized)

  return {
    groups,
    blockCount: groups.length,
    chunkCount: filteredEntries.length,
    firstTs,
    lastTs,
  }
}

export function buildAmbientTraceRange(trace = {}, now = Date.now()) {
  if (!trace?.chunkCount) {
    const start = new Date(now)
    start.setHours(8, 0, 0, 0)
    const end = new Date(now)
    end.setHours(Math.max(18, end.getHours() + 1), 0, 0, 0)
    return {
      min: start.getTime(),
      max: end.getTime(),
    }
  }

  const first = Number(trace.firstTs || now)
  const last = Number(trace.lastTs || now)
  const spread = Math.max(last - first, 30 * 60 * 1000)
  const padding = Math.max(TRACE_PADDING_MS, Math.round(spread * 0.12))

  return {
    min: Math.max(first - padding, new Date(first).setHours(0, 0, 0, 0)),
    max: Math.max(last + padding, now + (5 * 60 * 1000)),
  }
}

export function buildAmbientTraceSummary(trace = {}) {
  if (!trace?.blockCount) {
    return {
      chipLabel: 'Waiting',
      countLabel: 'No background activity blocks yet',
      helperText: 'Measured ambient chunks will appear here as Velance records your day.',
    }
  }

  return {
    chipLabel: `${trace.blockCount} tracked block${trace.blockCount === 1 ? '' : 's'} today`,
    countLabel: `${trace.chunkCount} measured chunk${trace.chunkCount === 1 ? '' : 's'}`,
    helperText: 'Hover tiles for app context. Gaps still mean Velance was not tracking.',
  }
}

export function buildAmbientTraceAxisLabels(range = {}, segments = 5) {
  const min = Number(range?.min || 0)
  const max = Number(range?.max || 0)
  const safeSegments = Math.max(2, Number(segments || 5))
  const span = Math.max(1, max - min)
  const includeMinutes = span <= (4 * 60 * 60 * 1000)

  return Array.from({ length: safeSegments }, (_, index) => {
    const ratio = safeSegments === 1 ? 0 : index / (safeSegments - 1)
    const timestamp = min + (span * ratio)
    return {
      id: `trace-axis-${index}`,
      left: `${(ratio * 100).toFixed(2)}%`,
      label: formatTraceHour(timestamp, { includeMinutes }),
    }
  })
}

function finalizeRibbonSegment(segment = null) {
  if (!segment) return null

  return {
    ...segment,
    app: getDominantBucketValue(segment.appTotals, 'Tracked activity'),
    category: getDominantBucketValue(segment.categoryTotals, 'Activity'),
    avgScore: Math.round(segment.scoreTotal / Math.max(segment.chunkCount, 1)),
  }
}

export function buildAmbientTraceRibbon(entries = [], { todayKey = null, now = Date.now(), mode = 'focused' } = {}) {
  const filteredEntries = [...entries]
    .filter((entry) => entry?.ts && entry?.duration)
    .filter((entry) => !todayKey || formatLocalDateKey(entry.ts) === todayKey)
    .sort((left, right) => left.ts - right.ts)

  const trace = buildAmbientTrace(filteredEntries, { todayKey })
  const range = mode === 'day'
    ? {
        min: new Date(now).setHours(0, 0, 0, 0),
        max: new Date(now).setHours(24, 0, 0, 0),
      }
    : (() => {
        if (!trace?.chunkCount) return buildAmbientTraceRange(trace, now)
        const first = Number(trace.firstTs || now)
        const last = Number(trace.lastTs || now)
        const spread = Math.max(last - first, 30 * 60 * 1000)
        const padding = Math.max(12 * 60 * 1000, Math.round(spread * 0.16))
        const dayStart = new Date(first)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(first)
        dayEnd.setHours(24, 0, 0, 0)
        return {
          min: Math.max(first - padding, dayStart.getTime()),
          max: Math.min(last + padding, dayEnd.getTime()),
        }
      })()
  const span = Math.max(1, Number(range.max || 0) - Number(range.min || 0))
  const bucketMs = mode === 'day'
    ? Math.max(getTraceBucketMs(span), 15 * 60 * 1000)
    : getTraceBucketMs(span)

  const buckets = new Map()
  filteredEntries.forEach((entry) => {
    const startTs = Number(entry.ts || 0)
    const endTs = Number(entry.endTs || (startTs + ((Number(entry.duration || 0)) * 1000)))
    const duration = Number(entry.duration || 0)
    if (!startTs || !endTs || duration <= 0) return

    const bucketStart = Math.floor(startTs / bucketMs) * bucketMs
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, {
        bucketStart,
        observedStart: startTs,
        observedEnd: endTs,
        trackedSeconds: 0,
        productiveSeconds: 0,
        distractingSeconds: 0,
        neutralSeconds: 0,
        chunkCount: 0,
        scoreTotal: 0,
        appTotals: {},
        categoryTotals: {},
      })
    }

    const bucket = buckets.get(bucketStart)
    bucket.observedStart = Math.min(bucket.observedStart, startTs)
    bucket.observedEnd = Math.max(bucket.observedEnd, endTs)
    bucket.trackedSeconds += duration
    bucket.chunkCount += 1
    bucket.scoreTotal += getAmbientBandScore(entry)
    addBucketApp(bucket, entry.app, duration)
    addBucketCategory(bucket, entry.category, duration)

    if (entry.productive === true) bucket.productiveSeconds += duration
    else if (entry.productive === false) bucket.distractingSeconds += duration
    else bucket.neutralSeconds += duration
  })

  const orderedBuckets = [...buckets.values()]
    .sort((left, right) => left.bucketStart - right.bucketStart)
    .map((bucket) => ({
      ...bucket,
      toneMeta: getDominantBucketTone(bucket),
    }))

  const cells = orderedBuckets.map((bucket, index) => {
    const dominantApp = getDominantBucketValue(bucket.appTotals, 'Tracked activity')
    const dominantCategory = getDominantBucketValue(bucket.categoryTotals, 'Activity')
    const rawLeft = ((bucket.bucketStart - range.min) / span) * 100
    const rawWidth = (bucketMs / span) * 100
    const occupancy = clampNumber(bucket.trackedSeconds / (bucketMs / 1000), 0.24, 1)

    return {
      id: `trace-cell-${index + 1}`,
      tone: bucket.toneMeta.key,
      color: bucket.toneMeta.color,
      glow: bucket.toneMeta.glow,
      rowTop: bucket.toneMeta.rowTop,
      label: bucket.toneMeta.label,
      helper: bucket.toneMeta.helper,
      left: `${clampNumber(rawLeft, 0, 100).toFixed(3)}%`,
      width: `${Math.max(rawWidth - 0.15, mode === 'day' ? 0.55 : 1.1).toFixed(3)}%`,
      opacity: occupancy,
      app: dominantApp,
      category: dominantCategory,
      trackedSeconds: bucket.trackedSeconds,
      startTs: bucket.observedStart,
      endTs: bucket.observedEnd,
    }
  })

  const mergedSegments = []
  let currentSegment = null

  orderedBuckets.forEach((bucket, index) => {
    const segmentStart = bucket.observedStart
    const segmentEnd = bucket.observedEnd
    const toneMeta = bucket.toneMeta

    const shouldMerge = currentSegment &&
      currentSegment.tone === toneMeta.key &&
      (segmentStart - currentSegment.endTs) <= bucketMs

    if (!shouldMerge) {
      const finalized = finalizeRibbonSegment(currentSegment)
      if (finalized) mergedSegments.push(finalized)
      currentSegment = {
        id: `trace-ribbon-${index + 1}`,
        tone: toneMeta.key,
        color: toneMeta.color,
        glow: toneMeta.glow,
        rowTop: toneMeta.rowTop,
        label: toneMeta.label,
        helper: toneMeta.helper,
        startTs: segmentStart,
        endTs: segmentEnd,
        trackedSeconds: bucket.trackedSeconds,
        chunkCount: bucket.chunkCount,
        scoreTotal: bucket.scoreTotal,
        appTotals: { ...bucket.appTotals },
        categoryTotals: { ...bucket.categoryTotals },
      }
      return
    }

    currentSegment.endTs = Math.max(currentSegment.endTs, segmentEnd)
    currentSegment.trackedSeconds += bucket.trackedSeconds
    currentSegment.chunkCount += bucket.chunkCount
    currentSegment.scoreTotal += bucket.scoreTotal

    Object.entries(bucket.appTotals).forEach(([key, seconds]) => {
      currentSegment.appTotals[key] = (currentSegment.appTotals[key] || 0) + seconds
    })
    Object.entries(bucket.categoryTotals).forEach(([key, seconds]) => {
      currentSegment.categoryTotals[key] = (currentSegment.categoryTotals[key] || 0) + seconds
    })
  })

  const finalized = finalizeRibbonSegment(currentSegment)
  if (finalized) mergedSegments.push(finalized)

  const segments = mergedSegments.map((segment) => {
    const rawLeft = ((segment.startTs - range.min) / span) * 100
    const rawWidth = ((segment.endTs - segment.startTs) / span) * 100
    const density = clampNumber(segment.avgScore / 100, 0.35, 0.92)

    return {
      ...segment,
      left: `${clampNumber(rawLeft, 0, 100).toFixed(3)}%`,
      width: `${Math.max(rawWidth, 1.2).toFixed(3)}%`,
      opacity: density,
    }
  })

  return {
    cells,
    segments,
    labels: buildAmbientTraceAxisLabels(range, mode === 'day' ? 7 : span <= (4 * 60 * 60 * 1000) ? 6 : 5),
    lanes: Object.values(TRACE_TONES),
    range,
    blockCount: trace.blockCount,
    chunkCount: trace.chunkCount,
  }
}

export function buildAmbientTraceBlocks(entries = [], { todayKey = null, now = Date.now() } = {}) {
  const filteredEntries = [...entries]
    .filter((entry) => entry?.ts && entry?.duration)
    .filter((entry) => !todayKey || formatLocalDateKey(entry.ts) === todayKey)
    .sort((left, right) => left.ts - right.ts)

  const trace = buildAmbientTrace(filteredEntries, { todayKey })
  const range = buildAmbientTraceRange(trace, now)
  const span = Math.max(1, Number(range.max || 0) - Number(range.min || 0))

  const blocks = filteredEntries.map((entry, index) => {
    const startTs = Number(entry.ts || 0)
    const endTs = Number(entry.endTs || (startTs + ((Number(entry.duration || 0)) * 1000)))
    const visual = getAmbientBandVisual(entry)
    const rawLeft = ((startTs - range.min) / span) * 100
    const rawWidth = ((endTs - startTs) / span) * 100

    return {
      id: entry.id || `trace-block-${index}`,
      left: `${clampNumber(rawLeft, 0, 100).toFixed(3)}%`,
      width: `${Math.max(rawWidth, 0.7).toFixed(3)}%`,
      height: `${visual.height}%`,
      color: visual.color,
      glow: visual.glow,
      tone: visual.tone,
      score: visual.score,
      app: entry.app || 'Tracked activity',
      category: entry.category || 'Activity',
      duration: Number(entry.duration || 0),
      band: describeAmbientTraceBand(visual.score),
    }
  })

  return {
    blocks,
    labels: buildAmbientTraceAxisLabels(range),
    range,
    blockCount: trace.blockCount,
    chunkCount: trace.chunkCount,
  }
}
