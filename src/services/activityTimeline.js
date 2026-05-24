import { getLocalDayRange } from './dateNavigation.js'
import { getTrackingLaneMeta, resolveAmbientEntryLane } from './activityClassification.js'
import { buildBackgroundWindowAnalysis } from './analysisEngine.js'

const ACTIVITY_LANE_META = {
  productive: getTrackingLaneMeta('productive'),
  supporting: getTrackingLaneMeta('supporting'),
  unclear: getTrackingLaneMeta('unclear'),
  distracting: getTrackingLaneMeta('distracting'),
}
const BROWSER_APP_HINTS = ['chrome', 'edge', 'firefox', 'browser', 'brave', 'opera', 'arc', 'safari']

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function safeDuration(seconds = 0) {
  return Math.max(0, Math.round(Number(seconds) || 0))
}

function safeTimestamp(value = 0) {
  return Math.max(0, Number(value) || 0)
}

function toSegmentPosition(startTs, endTs, range) {
  const boundedStart = clamp(startTs, range.startMs, range.endMs)
  const boundedEnd = clamp(endTs, range.startMs, range.endMs)
  const span = Math.max(1, range.endMs - range.startMs)
  const left = ((boundedStart - range.startMs) / span) * 100
  const width = Math.max(((boundedEnd - boundedStart) / span) * 100, 0.65)

  return {
    left: `${left.toFixed(3)}%`,
    width: `${Math.min(width, 100 - left).toFixed(3)}%`,
  }
}

function getAmbientLane(entry = {}) {
  return resolveAmbientEntryLane(entry)
}

function formatClock(timestamp = 0) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(timestamp)).toLowerCase()
}

function scoreTone(score = 0) {
  const safe = Number(score || 0)
  if (safe >= 80) return {
    color: '#14B8A6',
    accent: 'rgba(20, 184, 166, 0.18)',
    label: 'Strong',
  }
  if (safe >= 62) return {
    color: '#0EA5E9',
    accent: 'rgba(14, 165, 233, 0.18)',
    label: 'Steady',
  }
  if (safe >= 45) return {
    color: '#F59E0B',
    accent: 'rgba(245, 158, 11, 0.18)',
    label: 'Mixed',
  }
  return {
    color: '#FB7185',
    accent: 'rgba(251, 113, 133, 0.2)',
    label: 'Strained',
  }
}

function formatDriverLabel(value = '') {
  return String(value || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (token) => token.toUpperCase())
    .trim()
}

function isBrowserLikeApp(label = '') {
  const normalized = String(label || '').trim().toLowerCase()
  return BROWSER_APP_HINTS.some((hint) => normalized.includes(hint))
}

function normalizeDisplayLabel(value = '', fallback = '') {
  const trimmed = String(value || '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return String(fallback || '').trim()
  return trimmed
}

function pickWindowDisplayTitle({ leadApp = '', leadContext = '' } = {}) {
  const normalizedApp = normalizeDisplayLabel(leadApp, 'Background work')
  const normalizedContext = normalizeDisplayLabel(leadContext, normalizedApp)
  if (!normalizedContext || normalizedContext === normalizedApp) {
    return {
      title: normalizedApp,
      subtitle: '',
      graphLabel: normalizedApp,
    }
  }

  if (isBrowserLikeApp(normalizedApp)) {
    return {
      title: normalizedContext,
      subtitle: normalizedApp,
      graphLabel: normalizedContext,
    }
  }

  return {
    title: normalizedApp,
    subtitle: normalizedContext,
    graphLabel: normalizedApp,
  }
}

function finalizeAmbientSegment(segment, range) {
  if (!segment) return null
  return {
    ...segment,
    ...toSegmentPosition(segment.startTs, segment.endTs, range),
    durationSeconds: Math.round(segment.durationSeconds),
    timeLabel: `${formatClock(segment.startTs)} - ${formatClock(segment.endTs)}`,
  }
}

export function buildActivityAxis(dateKey, stepHours = 4) {
  const range = getLocalDayRange(dateKey)
  const totalSteps = Math.floor(24 / stepHours) + 1

  return Array.from({ length: totalSteps }, (_, index) => {
    const hour = index * stepHours
    const point = new Date(range.startMs)
    point.setHours(Math.min(hour, 24), 0, 0, 0)

    return {
      id: `activity-axis-${dateKey}-${hour}`,
      left: `${((hour / 24) * 100).toFixed(3)}%`,
      label: point.toLocaleTimeString('en-US', {
        hour: 'numeric',
        hour12: true,
      }).toLowerCase(),
    }
  })
}

export function buildBackgroundTimelineSegments(entries = [], { dateKey, mergeGapMs = 90 * 1000 } = {}) {
  const range = getLocalDayRange(dateKey)
  const sortedEntries = [...entries]
    .filter((entry) => safeTimestamp(entry?.ts) && safeDuration(entry?.duration))
    .sort((left, right) => left.ts - right.ts)

  const segments = []
  let currentSegment = null

  sortedEntries.forEach((entry, index) => {
    const lane = getAmbientLane(entry)
    const laneMeta = ACTIVITY_LANE_META[lane] || ACTIVITY_LANE_META.unclear
    const startTs = safeTimestamp(entry.ts)
    const endTs = safeTimestamp(entry.endTs || (startTs + (safeDuration(entry.duration) * 1000)))
    const title = entry.appGroup || entry.contextLabel || entry.browserPage || entry.app || 'Tracked activity'
    const category = entry.category || 'Activity'

    if (!startTs || endTs <= startTs) return

    const shouldMerge = currentSegment &&
      currentSegment.lane === laneMeta.key &&
      currentSegment.title === title &&
      (startTs - currentSegment.endTs) <= mergeGapMs

    if (!shouldMerge) {
      const finalized = finalizeAmbientSegment(currentSegment, range)
      if (finalized) segments.push(finalized)

      currentSegment = {
        id: `background-segment-${index + 1}`,
        kind: 'background',
        lane: laneMeta.key,
        label: laneMeta.label,
        color: laneMeta.color,
        accent: laneMeta.accent,
        title,
        category,
        startTs,
        endTs,
        durationSeconds: safeDuration(entry.duration),
      }
      return
    }

    currentSegment.endTs = Math.max(currentSegment.endTs, endTs)
    currentSegment.durationSeconds += safeDuration(entry.duration)
  })

  const finalized = finalizeAmbientSegment(currentSegment, range)
  if (finalized) segments.push(finalized)

  return segments
}

export function buildFocusTimelineSegments(sessions = [], { dateKey } = {}) {
  const range = getLocalDayRange(dateKey)

  return [...sessions]
    .filter((session) => safeTimestamp(session?.timestamp || session?.createdAt) && safeDuration(session?.durationSeconds))
    .sort((left, right) => (left.timestamp || left.createdAt || 0) - (right.timestamp || right.createdAt || 0))
    .map((session, index) => {
      const startTs = safeTimestamp(session.timestamp || session.createdAt)
      const endTs = safeTimestamp(startTs + (safeDuration(session.durationSeconds) * 1000))
      const tone = scoreTone(session.focusScore)
      const title = session.goal || session.taskTitle || session.habit || session.focusQuality || `${session.sessionType || 'Focus'} block`

      return {
        id: session.id || `focus-segment-${index + 1}`,
        kind: 'focus',
        label: tone.label,
        color: tone.color,
        accent: tone.accent,
        title,
        category: session.primaryContext || session.primaryApp || 'Measured focus block',
        focusScore: Number(session.focusScore || 0),
        durationSeconds: safeDuration(session.durationSeconds),
        productiveSeconds: safeDuration(session.productiveSeconds),
        supportingSeconds: safeDuration(session.supportingSeconds),
        distractingSeconds: safeDuration(session.distractingSeconds),
        startTs,
        endTs,
        ...toSegmentPosition(startTs, endTs, range),
        timeLabel: `${formatClock(startTs)} - ${formatClock(endTs)}`,
      }
    })
}

export function buildBackgroundFocusWindows(entries = [], {
  mergeGapMs = 4 * 60 * 1000,
  minDurationSeconds = 6 * 60,
  minDepthShare = 0.68,
  maxDistractingShare = 0.12,
  maxDisruptiveShare = 0.3,
} = {}) {
  const sortedEntries = [...entries]
    .filter((entry) => safeTimestamp(entry?.ts) && safeDuration(entry?.duration))
    .sort((left, right) => left.ts - right.ts)

  const finalizedWindows = []
  let currentWindow = null
  let windowIndex = 0

  function startWindow(entry, lane) {
    const startTs = safeTimestamp(entry.ts)
    const endTs = safeTimestamp(entry.endTs || (startTs + (safeDuration(entry.duration) * 1000)))
    const favorable = lane === 'productive' || lane === 'supporting'
    currentWindow = {
      id: `background-window-${windowIndex += 1}`,
      startTs,
      endTs,
      totalSeconds: safeDuration(entry.duration),
      productiveSeconds: lane === 'productive' ? safeDuration(entry.duration) : 0,
      supportingSeconds: lane === 'supporting' ? safeDuration(entry.duration) : 0,
      unclearSeconds: lane === 'unclear' ? safeDuration(entry.duration) : 0,
      distractingSeconds: lane === 'distracting' ? safeDuration(entry.duration) : 0,
      switches: Number(entry.switches || 0),
      driftCount: favorable ? 0 : 1,
      recoveryCount: 0,
      chunkCount: 1,
      favorablePrevious: favorable,
      confidenceWeight: safeDuration(entry.duration) * Math.max(0, Number(entry.confidence || 0)),
      appTotals: { [entry.appGroup || entry.app || 'Tracked activity']: safeDuration(entry.duration) },
      contextTotals: { [entry.contextLabel || entry.browserPage || entry.browserHost || entry.appGroup || entry.app || 'Tracked activity']: safeDuration(entry.duration) },
    }
  }

  function addEntry(entry, lane) {
    if (!currentWindow) {
      startWindow(entry, lane)
      return
    }

    const startTs = safeTimestamp(entry.ts)
    const endTs = safeTimestamp(entry.endTs || (startTs + (safeDuration(entry.duration) * 1000)))
    const favorable = lane === 'productive' || lane === 'supporting'

    currentWindow.endTs = Math.max(currentWindow.endTs, endTs)
    currentWindow.totalSeconds += safeDuration(entry.duration)
    currentWindow.switches += Number(entry.switches || 0)
    currentWindow.chunkCount += 1
    currentWindow.confidenceWeight += safeDuration(entry.duration) * Math.max(0, Number(entry.confidence || 0))
    currentWindow[`${lane}Seconds`] += safeDuration(entry.duration)
    currentWindow.appTotals[entry.appGroup || entry.app || 'Tracked activity'] =
      (currentWindow.appTotals[entry.appGroup || entry.app || 'Tracked activity'] || 0) + safeDuration(entry.duration)
    currentWindow.contextTotals[entry.contextLabel || entry.browserPage || entry.browserHost || entry.appGroup || entry.app || 'Tracked activity'] =
      (currentWindow.contextTotals[entry.contextLabel || entry.browserPage || entry.browserHost || entry.appGroup || entry.app || 'Tracked activity'] || 0) + safeDuration(entry.duration)

    if (currentWindow.favorablePrevious && !favorable) currentWindow.driftCount += 1
    if (!currentWindow.favorablePrevious && favorable) currentWindow.recoveryCount += 1
    currentWindow.favorablePrevious = favorable
  }

  function finalizeWindow() {
    if (!currentWindow) return

    const productiveSeconds = Number(currentWindow.productiveSeconds || 0)
    const supportingSeconds = Number(currentWindow.supportingSeconds || 0)
    const unclearSeconds = Number(currentWindow.unclearSeconds || 0)
    const distractingSeconds = Number(currentWindow.distractingSeconds || 0)
    const totalSeconds = Math.max(1, Number(currentWindow.totalSeconds || 0))
    const depthSeconds = productiveSeconds + supportingSeconds
    const depthShare = depthSeconds / totalSeconds
    const distractingShare = distractingSeconds / totalSeconds
    const disruptiveShare = (unclearSeconds + distractingSeconds) / totalSeconds

    if (
      totalSeconds < minDurationSeconds
      || depthShare < minDepthShare
      || distractingShare > maxDistractingShare
      || disruptiveShare > maxDisruptiveShare
    ) {
      currentWindow = null
      return
    }

    const leadApp = Object.entries(currentWindow.appTotals)
      .sort((left, right) => right[1] - left[1])[0]?.[0] || 'Background work'
    const leadContext = Object.entries(currentWindow.contextTotals)
      .sort((left, right) => right[1] - left[1])[0]?.[0] || leadApp
    currentWindow.avgConfidence = totalSeconds > 0
      ? Number((Number(currentWindow.confidenceWeight || 0) / totalSeconds).toFixed(3))
      : 0
    const dominantLane = [
      ['productive', productiveSeconds],
      ['supporting', supportingSeconds],
      ['unclear', unclearSeconds],
      ['distracting', distractingSeconds],
    ].sort((left, right) => right[1] - left[1])[0]?.[0] || 'unclear'
    const analysis = buildBackgroundWindowAnalysis(currentWindow)
    const display = pickWindowDisplayTitle({
      leadApp,
      leadContext,
    })

    finalizedWindows.push({
      id: currentWindow.id,
      kind: 'background-window',
      title: display.title,
      subtitle: display.subtitle,
      graphLabel: display.graphLabel,
      leadApp,
      contextLabel: leadContext,
      startTs: currentWindow.startTs,
      endTs: currentWindow.endTs,
      timeLabel: `${formatClock(currentWindow.startTs)} - ${formatClock(currentWindow.endTs)}`,
      durationSeconds: totalSeconds,
      productiveSeconds,
      supportingSeconds,
      unclearSeconds,
      distractingSeconds,
      switchRate: Number((Number(currentWindow.switches || 0) / Math.max(totalSeconds / 60, 1)).toFixed(1)),
      driftCount: currentWindow.driftCount,
      recoveryCount: currentWindow.recoveryCount,
      focusScore: analysis.focusScore,
      fatigueScore: analysis.fatigueScore,
      fatigueRisk: analysis.fatigueRisk,
      topFatigueDriverLabel: analysis.topFatigueDriverLabel,
      pillars: analysis.pillars,
      confidenceScore: analysis.confidenceScore,
      confidenceRatio: analysis.confidenceRatio,
      observedRatio: analysis.observedRatio,
      activeRatio: analysis.activeRatio,
      fatigueDrivers: analysis.fatigueDrivers,
      dominantLane,
      tone: scoreTone(analysis.focusScore).label.toLowerCase(),
      chunkCount: currentWindow.chunkCount,
      avgConfidence: currentWindow.avgConfidence,
    })

    currentWindow = null
  }

  sortedEntries.forEach((entry) => {
    const lane = getAmbientLane(entry)
    const startTs = safeTimestamp(entry.ts)
    const favorable = lane === 'productive' || lane === 'supporting'

    if (!currentWindow) {
      startWindow(entry, lane)
      return
    }

    const gapMs = startTs - currentWindow.endTs
    const shouldBreakForDistractingShift = currentWindow.favorablePrevious && lane === 'distracting'
    const shouldBreakForRecoveryShift = !currentWindow.favorablePrevious && favorable
    if (gapMs > mergeGapMs || shouldBreakForDistractingShift || shouldBreakForRecoveryShift) {
      finalizeWindow()
      startWindow(entry, lane)
      return
    }

    addEntry(entry, lane)
  })

  finalizeWindow()

  return finalizedWindows
    .sort((left, right) => left.startTs - right.startTs)
    .map((window) => ({
      ...window,
      color: getTrackingLaneMeta(window.dominantLane).color,
      accent: getTrackingLaneMeta(window.dominantLane).accent,
    }))
}

export function formatActivityDuration(seconds = 0) {
  const safe = safeDuration(seconds)
  if (safe < 60) return `${safe}s`
  if (safe < 3600) {
    const mins = Math.floor(safe / 60)
    const rem = safe % 60
    return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
  }
  const hours = Math.floor(safe / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}
