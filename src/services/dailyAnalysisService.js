import { buildBackgroundFocusWindows, formatActivityDuration } from './activityTimeline.js'
import { formatLocalDateKey } from './dateKey.js'
import { getLocalDayRange } from './dateNavigation.js'
import {
  applyBrowserSignalsToAnalysis,
  buildBrowserAwareBackgroundFatigueSnapshot,
  buildRangeEvidenceBundle,
  buildStoredSessionAnalysis,
  derivePrecisionState,
  deriveRecoveryProfile,
  summarizeBrowserSignalsForRange,
} from './analysisEngine.js'
import { resolveAmbientEntryLane } from './activityClassification.js'

function safeNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function average(values = []) {
  const safeValues = values.map((value) => safeNumber(value, NaN)).filter((value) => Number.isFinite(value))
  if (!safeValues.length) return 0
  return Math.round(safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length)
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function formatClock(timestamp = 0) {
  if (!timestamp) return '--'
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(timestamp)).toLowerCase()
}

function formatPercent(value = 0) {
  return `${Math.max(0, Math.round(safeNumber(value, 0)))}%`
}

function formatLaneLabel(lane = 'unclear') {
  return String(lane || 'unclear')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (token) => token.toUpperCase())
}

function getWindowShares(window = {}) {
  const totalSeconds = Math.max(1, safeNumber(window.durationSeconds || window.totalSeconds))
  const productiveSeconds = safeNumber(window.productiveSeconds)
  const supportingSeconds = safeNumber(window.supportingSeconds)
  const unclearSeconds = safeNumber(window.unclearSeconds)
  const distractingSeconds = safeNumber(window.distractingSeconds)

  return {
    totalSeconds,
    favorableShare: (productiveSeconds + supportingSeconds) / totalSeconds,
    disruptiveShare: (unclearSeconds + distractingSeconds) / totalSeconds,
    distractingShare: distractingSeconds / totalSeconds,
  }
}

function qualifiesBackgroundFocusWindow(window = {}, analysis = {}) {
  const { favorableShare, disruptiveShare, distractingShare } = getWindowShares(window)
  const browserSignals = analysis.browserSignals || {}
  const browserPressure = safeNumber(browserSignals.pressureScore)
  const browserDistractingShare = clamp(safeNumber(browserSignals.distractingShare), 0, 1)
  const browserDominantLane = String(browserSignals.dominantLane || window.dominantLane || 'unclear')

  if (favorableShare < 0.72) return false
  if (distractingShare > 0.08) return false
  if (disruptiveShare > 0.24) return false
  if (safeNumber(analysis.focusScore) < 58) return false
  if (browserPressure >= 54) return false
  if (
    browserDominantLane === 'distracting'
    && (
      browserDistractingShare >= 0.24
      || safeNumber(browserSignals.audibleMoments) > 0
      || browserPressure >= 34
    )
  ) return false

  return true
}

function buildBackgroundWindowFocusWhy(window = {}) {
  const shares = getWindowShares(window)
  const favorableShare = Math.round(shares.favorableShare * 100)
  const disruptiveShare = Math.round(shares.disruptiveShare * 100)
  const browserSignals = window.browserSignals || {}
  const browserPressure = safeNumber(window.browserPressureScore || browserSignals.pressureScore)
  const browserLane = formatLaneLabel(browserSignals.dominantLane || window.dominantLane || 'unclear')
  const switchRate = safeNumber(window.switchRate)

  return `${window.title || window.contextLabel || window.leadApp || 'This window'} qualified because ${favorableShare}% of it stayed in productive or supporting lanes with ${switchRate}/min switching. Browser context stayed ${browserLane.toLowerCase()} at ${browserPressure}/100 pressure, so the window held together as passive depth instead of drift (${disruptiveShare}% disruptive share).`
}

function buildSessionFocusWhy(session = {}) {
  const totalSeconds = Math.max(1, safeNumber(session.durationSeconds))
  const favorableShare = Math.round((((safeNumber(session.productiveSeconds) + safeNumber(session.supportingSeconds)) / totalSeconds) || 0) * 100)
  const disruptiveShare = Math.round((((safeNumber(session.unclearSeconds) + safeNumber(session.distractingSeconds)) / totalSeconds) || 0) * 100)
  const browserPressure = safeNumber(session.browserPressureScore || session.browserSignals?.pressureScore)

  return `${session.goal || session.taskTitle || session.habit || 'This focus block'} scored ${safeNumber(session.focusScore)}/100 because ${favorableShare}% of the session stayed in favorable lanes with ${safeNumber(session.switchRate)}/min switching. ${disruptiveShare}% of the block was unclear or distracting${browserPressure ? `, and browser pressure added ${browserPressure}/100 of extra friction` : ''}.`
}

function summarizeBrowserLabel(event = {}) {
  return String(
    event.pageTitle
      || event.host
      || event.browserApp
      || 'browser activity',
  )
}

function getTaskCompletionDateKey(task = {}) {
  if (task.completedAt) return formatLocalDateKey(task.completedAt)
  if (task.updatedAt && task.status === 'completed') return formatLocalDateKey(task.updatedAt)
  return null
}

function getSessionTimeLabel(session = {}) {
  const start = safeNumber(session.timestamp || session.createdAt || 0)
  const end = start + (safeNumber(session.durationSeconds) * 1000)
  return start ? `${formatClock(start)} - ${formatClock(end)}` : 'Focus block'
}

function getWindowAnchorTimestamp(window = {}) {
  const start = safeNumber(window.startTs)
  const end = safeNumber(window.endTs)
  if (start > 0 && end > start) {
    return start + Math.round((end - start) / 2)
  }
  return start
}

function getBackgroundFatigueAnchor(entries = [], browserEventSummary = {}) {
  const sortedEntries = [...entries].sort((left, right) => safeNumber(right.duration) - safeNumber(left.duration))
  const biggestDistraction = sortedEntries.find((entry) => resolveAmbientEntryLane(entry) === 'distracting')
  const latestSwitchTs = safeNumber(browserEventSummary?.latestSwitch?.ts)
  const latestAudibleTs = safeNumber(browserEventSummary?.latestAudible?.ts)
  const latestTrackedTs = safeNumber(sortedEntries[0]?.ts)

  if (String(browserEventSummary?.dominantDriver || '').toLowerCase().includes('switch') && latestSwitchTs > 0) {
    return latestSwitchTs
  }
  if (biggestDistraction && safeNumber(biggestDistraction.ts) > 0) {
    return safeNumber(biggestDistraction.ts)
  }
  if (latestSwitchTs > 0) return latestSwitchTs
  if (latestAudibleTs > 0) return latestAudibleTs
  return latestTrackedTs
}

function createEvent({
  id,
  type,
  linkedTab,
  linkedEntityType = '',
  linkedEntityId = '',
  sourceKind = '',
  title,
  detail,
  timestamp = 0,
  tone = 'neutral',
  weight = 50,
  metrics = [],
  markerLabel = '',
  evidence = null,
}) {
  return {
    id,
    type,
    linkedTab,
    linkedEntityType,
    linkedEntityId: linkedEntityId === null || linkedEntityId === undefined ? '' : String(linkedEntityId),
    sourceKind,
    title,
    detail,
    timestamp,
    timeLabel: formatClock(timestamp),
    tone,
    weight,
    metrics,
    markerLabel: markerLabel || title,
    evidence,
  }
}

export function buildDailyAnalysisModel({
  dateKey = '',
  sessions = [],
  tasks = [],
  habits = [],
  ambientEntries = [],
  mediaEntries = [],
  browserEvents = [],
  ambient,
} = {}) {
  const safeAmbient = ambient || {}
  const daySessions = [...sessions]
    .filter((session) => session?.date === dateKey)
    .sort((left, right) => safeNumber(left.timestamp || left.createdAt) - safeNumber(right.timestamp || right.createdAt))
  const sortedBrowserEvents = [...browserEvents]
    .filter((entry) => String(entry?.date || '') === String(dateKey || ''))
    .sort((left, right) => safeNumber(left.ts) - safeNumber(right.ts))
  const analyzedSessions = daySessions.map((session) => {
    const startTs = safeNumber(session.timestamp || session.createdAt)
    const endTs = startTs + (safeNumber(session.durationSeconds) * 1000)
    const switchRate = safeNumber(session.windowSwitchCount) / Math.max(safeNumber(session.durationSeconds) / 60, 1)
    const baseAnalysis = buildStoredSessionAnalysis(session)
    const browserSignals = summarizeBrowserSignalsForRange(sortedBrowserEvents, {
      startTs,
      endTs,
      padMs: 30 * 1000,
    })
    const analysis = applyBrowserSignalsToAnalysis(baseAnalysis, browserSignals, { source: 'session' })
    const precisionState = derivePrecisionState({
      confidenceRatio: analysis.confidenceRatio,
      observedRatio: clamp(safeNumber(session.observedRatio, safeNumber(session.sessionSummary?.observedRatio, 1)), 0, 1),
      activeRatio: clamp(safeNumber(session.sessionSummary?.activeRatio, 1), 0, 1),
      browserPressure: analysis.browserSignals?.pressureScore,
      source: 'session',
    })
    const recoveryProfile = deriveRecoveryProfile({
      focusScore: analysis.focusScore,
      fatigueScore: analysis.fatigueScore,
      driftCount: safeNumber(session.driftCount),
      recoveryCount: safeNumber(session.recoveryCount),
      switchRate,
      browserPressure: analysis.browserSignals?.pressureScore,
      distractingShare: safeNumber(baseAnalysis.distractingShare),
      unclearShare: safeNumber(baseAnalysis.unclearShare),
    })
    const rangeEvidence = buildRangeEvidenceBundle({
      ambientEntries,
      browserEvents: sortedBrowserEvents,
      startTs,
      endTs,
      ambientPadMs: 15 * 1000,
      browserPadMs: 30 * 1000,
      limit: 4,
    })
    return {
      ...session,
      switchRate,
      baseFocusScore: baseAnalysis.focusScore,
      baseFatigueScore: baseAnalysis.fatigueScore,
      basePillars: baseAnalysis.pillars,
      focusScore: analysis.focusScore,
      fatigueScore: analysis.fatigueScore,
      fatigueRisk: analysis.fatigueRisk,
      pillarScores: analysis.pillars,
      fatigueDrivers: analysis.fatigueDrivers,
      topFatigueDriverLabel: analysis.browserSignals?.pressureScore >= 44
        ? analysis.browserSignals.dominantPressureLabel
        : analysis.topFatigueDriverLabel,
      analysisConfidenceScore: analysis.confidenceScore,
      analysisConfidenceRatio: analysis.confidenceRatio,
      focusFormulaVersion: analysis.focusFormulaVersion,
      fatigueFormulaVersion: analysis.fatigueFormulaVersion,
      browserSignals: analysis.browserSignals,
      browserPressureScore: safeNumber(analysis.browserSignals?.pressureScore),
      browserPressureLabel: analysis.browserSignals?.dominantPressureLabel || 'Quiet browser context',
      precisionState,
      calmScore: recoveryProfile.calmScore,
      recoveryQuality: recoveryProfile.recoveryQuality,
      recoveryState: recoveryProfile.recoveryState,
      isCalmWindow: recoveryProfile.isCalmWindow,
      rangeEvidence,
      focusWhy: buildSessionFocusWhy({
        ...session,
        focusScore: analysis.focusScore,
        browserSignals: analysis.browserSignals,
        browserPressureScore: safeNumber(analysis.browserSignals?.pressureScore),
        switchRate,
      }),
    }
  })
  const dayTasks = tasks.filter((task) => getTaskCompletionDateKey(task) === dateKey)
  const dayApps = safeAmbient.getAppBreakdown ? safeAmbient.getAppBreakdown(ambientEntries) : []
  const dayCategories = safeAmbient.getCategoryBreakdown ? safeAmbient.getCategoryBreakdown(ambientEntries) : []
  const dayDiagnostics = safeAmbient.getTrackingDiagnostics ? safeAmbient.getTrackingDiagnostics(ambientEntries) : {
    distractingSeconds: 0,
    avgConfidence: 0,
  }
  const dayRange = getLocalDayRange(dateKey)
  const tabSwitchEvents = sortedBrowserEvents.filter((entry) => ['tab-activated', 'window-focus'].includes(String(entry.eventType || '').toLowerCase()))
  const tabOpenEvents = sortedBrowserEvents.filter((entry) => String(entry.eventType || '').toLowerCase() === 'tab-created')
  const audibleBrowserEvents = sortedBrowserEvents.filter((entry) => Boolean(entry.audible))
  const dayBrowserSignals = summarizeBrowserSignalsForRange(sortedBrowserEvents, {
    startTs: safeNumber(dayRange.startMs),
    endTs: safeNumber(dayRange.endMs),
    padMs: 0,
  })
  const browserEventSummary = {
    ...dayBrowserSignals,
    totalEvents: sortedBrowserEvents.length,
    tabSwitches: tabSwitchEvents.length,
    tabsOpened: tabOpenEvents.length,
    audibleMoments: audibleBrowserEvents.length,
    uniqueHosts: new Set(sortedBrowserEvents.map((entry) => String(entry.host || '').trim()).filter(Boolean)).size,
    latestAudible: [...audibleBrowserEvents].sort((left, right) => safeNumber(right.ts) - safeNumber(left.ts))[0] || null,
    latestSwitch: [...tabSwitchEvents].sort((left, right) => safeNumber(right.ts) - safeNumber(left.ts))[0] || null,
    latestTabOpen: [...tabOpenEvents].sort((left, right) => safeNumber(right.ts) - safeNumber(left.ts))[0] || null,
  }
  const backgroundFatigue = {
    ...buildBrowserAwareBackgroundFatigueSnapshot(ambientEntries, sortedBrowserEvents, {
      startTs: safeNumber(dayRange.startMs),
      endTs: safeNumber(dayRange.endMs),
      padMs: 0,
    }),
    browserSignals: dayBrowserSignals,
  }
  const baseBackgroundFocusWindows = buildBackgroundFocusWindows(ambientEntries)
  const backgroundWindowThresholdMode = 'strict'
  const backgroundFocusWindows = baseBackgroundFocusWindows
    .map((window) => {
    const startTs = safeNumber(window.startTs)
    const endTs = safeNumber(window.endTs)
    const observedRatio = clamp(safeNumber(window.observedRatio, 1), 0, 1)
    const activeRatio = clamp(safeNumber(window.activeRatio, observedRatio), 0, 1)
    const browserSignals = summarizeBrowserSignalsForRange(sortedBrowserEvents, {
      startTs,
      endTs,
      padMs: 15 * 1000,
    })
    const analysis = applyBrowserSignalsToAnalysis({
      focusScore: safeNumber(window.focusScore),
      fatigueScore: safeNumber(window.fatigueScore),
      fatigueRisk: window.fatigueRisk,
      pillars: window.pillars,
      fatigueDrivers: window.fatigueDrivers,
      topFatigueDriverLabel: window.topFatigueDriverLabel,
      confidenceScore: safeNumber(window.confidenceScore),
      confidenceRatio: safeNumber(window.confidenceRatio),
    }, browserSignals, { source: 'background' })
    const precisionState = derivePrecisionState({
      confidenceRatio: analysis.confidenceRatio,
      observedRatio,
      activeRatio,
      browserPressure: analysis.browserSignals?.pressureScore,
      source: 'background',
    })
    const recoveryProfile = deriveRecoveryProfile({
      focusScore: analysis.focusScore,
      fatigueScore: analysis.fatigueScore,
      driftCount: safeNumber(window.driftCount),
      recoveryCount: safeNumber(window.recoveryCount),
      switchRate: safeNumber(window.switchRate),
      browserPressure: analysis.browserSignals?.pressureScore,
      distractingShare: Math.max(0, safeNumber(window.distractingSeconds)) / Math.max(1, safeNumber(window.durationSeconds)),
      unclearShare: Math.max(0, safeNumber(window.unclearSeconds)) / Math.max(1, safeNumber(window.durationSeconds)),
    })
    const rangeEvidence = buildRangeEvidenceBundle({
      ambientEntries,
      browserEvents: sortedBrowserEvents,
      startTs,
      endTs,
      ambientPadMs: 0,
      browserPadMs: 15 * 1000,
      limit: 4,
    })
    const qualifies = qualifiesBackgroundFocusWindow(window, analysis)

    return {
      ...window,
      thresholdMode: backgroundWindowThresholdMode,
      observedRatio,
      activeRatio,
      qualifies,
      baseFocusScore: safeNumber(window.focusScore),
      baseFatigueScore: safeNumber(window.fatigueScore),
      basePillars: window.pillars,
      focusScore: analysis.focusScore,
      fatigueScore: analysis.fatigueScore,
      fatigueRisk: analysis.fatigueRisk,
      pillars: analysis.pillars,
      browserSignals: analysis.browserSignals,
      browserPressureScore: safeNumber(analysis.browserSignals?.pressureScore),
      browserPressureLabel: analysis.browserSignals?.dominantPressureLabel || 'Quiet browser context',
      topFatigueDriverLabel: analysis.browserSignals?.pressureScore >= 40
        ? analysis.browserSignals.dominantPressureLabel
        : (analysis.topFatigueDriverLabel || window.topFatigueDriverLabel),
      analysisConfidenceScore: analysis.confidenceScore,
      analysisConfidenceRatio: analysis.confidenceRatio,
      precisionState,
      calmScore: recoveryProfile.calmScore,
      recoveryQuality: recoveryProfile.recoveryQuality,
      recoveryState: recoveryProfile.recoveryState,
      isCalmWindow: recoveryProfile.isCalmWindow,
      rangeEvidence,
    }
  })
    .filter((window) => window.qualifies)
    .map((window) => ({
      ...window,
      focusWhy: buildBackgroundWindowFocusWhy(window),
    }))
  const focusAverage = average(analyzedSessions.map((session) => safeNumber(session.focusScore)))
  const sessionFatigueAverage = average(analyzedSessions.map((session) => safeNumber(session.fatigueScore)))
  const combinedFatigue = analyzedSessions.length
    ? Math.round((sessionFatigueAverage * 0.62) + (backgroundFatigue.score * 0.38))
    : backgroundFatigue.score

  const achievedHabits = habits
    .map((habit) => {
      const relatedSessions = analyzedSessions.filter((session) => (
        session.habit === habit.name || String(session.linkedHabitId || '') === String(habit.id || '')
      ))
      const minutes = Math.round(relatedSessions.reduce((sum, session) => sum + safeNumber(session.durationSeconds), 0) / 60)
      const achieved = safeNumber(habit.targetMinutes) > 0 && minutes >= safeNumber(habit.targetMinutes)
      return {
        id: habit.id,
        name: habit.name,
        minutes,
        targetMinutes: safeNumber(habit.targetMinutes),
        achieved,
        sessions: relatedSessions.length,
        avgFocus: average(relatedSessions.map((session) => safeNumber(session.focusScore))),
      }
    })
    .filter((habit) => habit.sessions > 0 || habit.achieved)

  const strongestSession = [...analyzedSessions].sort((left, right) => safeNumber(right.focusScore) - safeNumber(left.focusScore))[0] || null
  const weakestSession = [...analyzedSessions].sort((left, right) => safeNumber(left.focusScore) - safeNumber(right.focusScore))[0] || null
  const strongestBackgroundWindow = [...backgroundFocusWindows].sort((left, right) => safeNumber(right.focusScore) - safeNumber(left.focusScore))[0] || null
  const distractingEntries = [...ambientEntries]
    .filter((entry) => resolveAmbientEntryLane(entry) === 'distracting')
    .sort((left, right) => safeNumber(right.duration) - safeNumber(left.duration))
  const biggestDistraction = distractingEntries[0] || null

  const events = []

  analyzedSessions.forEach((session) => {
    const start = safeNumber(session.timestamp || session.createdAt)
    const end = start + (safeNumber(session.durationSeconds) * 1000)
    const sessionLabel = session.goal || session.taskTitle || session.habit || 'Focus session'

    events.push(createEvent({
      id: `focus-start-${session.id}`,
      type: 'focus-start',
      linkedTab: 'focus',
      linkedEntityType: 'session',
      linkedEntityId: session.id,
      title: `Started ${sessionLabel}`,
      detail: `${session.sessionType || 'Focus'} block began`,
      timestamp: start,
      tone: 'focus',
      weight: 70,
      metrics: [
        `Goal: ${sessionLabel}`,
        `Duration: ${formatActivityDuration(session.durationSeconds)}`,
      ],
      markerLabel: 'Start',
      evidence: session.rangeEvidence,
    }))

    events.push(createEvent({
      id: `focus-end-${session.id}`,
      type: 'focus-end',
      linkedTab: 'focus',
      linkedEntityType: 'session',
      linkedEntityId: session.id,
      title: `Finished ${sessionLabel}`,
      detail: `${safeNumber(session.focusScore)}/100 focus - ${session.distractions || 0} distractions`,
      timestamp: end,
      tone: safeNumber(session.focusScore) >= 70 ? 'good' : 'warn',
      weight: 76,
      metrics: [
        `Focus score: ${safeNumber(session.focusScore)}/100`,
        `Fatigue: ${safeNumber(session.fatigueScore)}%`,
        `Drift: ${safeNumber(session.driftCount)}`,
        `Recovery: ${safeNumber(session.recoveryCount)}`,
      ],
      markerLabel: 'End',
      evidence: session.rangeEvidence,
    }))
  })

  if (strongestBackgroundWindow) {
    events.push(createEvent({
      id: `background-depth-${strongestBackgroundWindow.id}`,
      type: 'background-depth-window',
      linkedTab: 'focus',
      linkedEntityType: 'background-window',
      linkedEntityId: strongestBackgroundWindow.id,
      title: `Background depth in ${strongestBackgroundWindow.title || strongestBackgroundWindow.contextLabel || strongestBackgroundWindow.leadApp || 'work window'}`,
      detail: `${safeNumber(strongestBackgroundWindow.focusScore)} depth - ${formatActivityDuration(strongestBackgroundWindow.durationSeconds)}`,
      timestamp: getWindowAnchorTimestamp(strongestBackgroundWindow),
      tone: 'focus',
      weight: daySessions.length ? 68 : 82,
      metrics: [
        `Depth score: ${safeNumber(strongestBackgroundWindow.focusScore)}/100`,
        `Switch rate: ${safeNumber(strongestBackgroundWindow.switchRate)}/min`,
        `Fatigue: ${safeNumber(strongestBackgroundWindow.fatigueScore)}%`,
      ],
      markerLabel: 'Depth',
      evidence: strongestBackgroundWindow.rangeEvidence,
    }))
  }

  dayTasks.forEach((task) => {
    events.push(createEvent({
      id: `task-complete-${task.id}`,
      type: 'task-completed',
      linkedTab: 'focus',
      linkedEntityType: 'task',
      linkedEntityId: task.id,
      sourceKind: 'task',
      title: `Completed ${task.title}`,
      detail: task.habit ? `Habit-linked task for ${task.habit}` : 'Task completed on this day',
      timestamp: safeNumber(task.completedAt || task.updatedAt),
      tone: 'good',
      weight: 88,
      metrics: [
        `Priority: ${task.priority || 'Normal'}`,
        `Status: completed`,
      ],
      markerLabel: 'Task',
    }))
  })

  if (biggestDistraction) {
    events.push(createEvent({
      id: `distraction-${safeNumber(biggestDistraction.ts)}`,
      type: 'distraction-spike',
      linkedTab: 'apps',
      linkedEntityType: 'tracking',
      linkedEntityId: safeNumber(biggestDistraction.ts),
      title: `Distraction spike in ${biggestDistraction.appGroup || biggestDistraction.app || 'background activity'}`,
      detail: `${formatActivityDuration(biggestDistraction.duration)} in a distracting lane`,
      timestamp: safeNumber(biggestDistraction.ts),
      tone: 'warn',
      weight: 90,
      metrics: [
        `Category: ${biggestDistraction.category || 'Other'}`,
        `Confidence: ${formatPercent((safeNumber(biggestDistraction.confidence) || 0) * 100)}`,
      ],
      markerLabel: 'Spike',
      evidence: buildRangeEvidenceBundle({
        ambientEntries,
        browserEvents: sortedBrowserEvents,
        startTs: safeNumber(biggestDistraction.ts),
        endTs: safeNumber(biggestDistraction.endTs || (safeNumber(biggestDistraction.ts) + (safeNumber(biggestDistraction.duration) * 1000))),
        ambientPadMs: 0,
        browserPadMs: 15 * 1000,
        limit: 4,
      }),
    }))
  }

  if (browserEventSummary.tabSwitches >= 6 && browserEventSummary.latestSwitch) {
    events.push(createEvent({
      id: `browser-switches-${dateKey}`,
      type: 'browser-switches',
      linkedTab: 'apps',
      linkedEntityType: 'browser-event',
      linkedEntityId: browserEventSummary.latestSwitch.id || `${dateKey}-browser-switch`,
      sourceKind: 'browser',
      title: 'Browser switching picked up',
      detail: `${browserEventSummary.tabSwitches} switches clustered around ${summarizeBrowserLabel(browserEventSummary.latestSwitch)}`,
      timestamp: safeNumber(browserEventSummary.latestSwitch.ts),
      tone: browserEventSummary.tabSwitches >= 16 ? 'warn' : 'neutral',
      weight: browserEventSummary.tabSwitches >= 16 ? 76 : 64,
      metrics: [
        `Tab switches: ${browserEventSummary.tabSwitches}`,
        `Hosts: ${browserEventSummary.uniqueHosts}`,
      ],
      markerLabel: 'Switch',
      evidence: buildRangeEvidenceBundle({
        ambientEntries,
        browserEvents: sortedBrowserEvents,
        startTs: Math.max(0, safeNumber(browserEventSummary.latestSwitch.ts) - (15 * 60 * 1000)),
        endTs: safeNumber(browserEventSummary.latestSwitch.ts),
        ambientPadMs: 15 * 1000,
        browserPadMs: 0,
        limit: 4,
      }),
    }))
  }

  if (browserEventSummary.tabsOpened > 0 && browserEventSummary.latestTabOpen) {
    events.push(createEvent({
      id: `browser-opened-${dateKey}`,
      type: 'browser-tabs-opened',
      linkedTab: 'apps',
      linkedEntityType: 'browser-event',
      linkedEntityId: browserEventSummary.latestTabOpen.id || `${dateKey}-browser-open`,
      sourceKind: 'browser',
      title: `Opened ${browserEventSummary.tabsOpened} browser tab${browserEventSummary.tabsOpened === 1 ? '' : 's'}`,
      detail: `Latest new tab landed on ${summarizeBrowserLabel(browserEventSummary.latestTabOpen)}`,
      timestamp: safeNumber(browserEventSummary.latestTabOpen.ts),
      tone: 'neutral',
      weight: 58,
      metrics: [
        `New tabs: ${browserEventSummary.tabsOpened}`,
        `Hosts: ${browserEventSummary.uniqueHosts}`,
      ],
      markerLabel: 'Tab',
      evidence: buildRangeEvidenceBundle({
        ambientEntries,
        browserEvents: sortedBrowserEvents,
        startTs: Math.max(0, safeNumber(browserEventSummary.latestTabOpen.ts) - (15 * 60 * 1000)),
        endTs: safeNumber(browserEventSummary.latestTabOpen.ts),
        ambientPadMs: 15 * 1000,
        browserPadMs: 0,
        limit: 4,
      }),
    }))
  }

  if (browserEventSummary.latestAudible) {
    events.push(createEvent({
      id: `browser-audio-${dateKey}`,
      type: 'browser-audio',
      linkedTab: 'apps',
      linkedEntityType: 'browser-event',
      linkedEntityId: browserEventSummary.latestAudible.id || `${dateKey}-browser-audio`,
      sourceKind: 'browser',
      title: 'Browser audio was active',
      detail: browserEventSummary.latestAudible.pageTitle
        ? `${browserEventSummary.latestAudible.pageTitle} was audible in ${browserEventSummary.latestAudible.browserApp || 'the browser'}`
        : `${browserEventSummary.latestAudible.host || browserEventSummary.latestAudible.browserApp || 'A browser tab'} was audible`,
      timestamp: safeNumber(browserEventSummary.latestAudible.ts),
      tone: 'neutral',
      weight: 62,
      metrics: [
        `Audible moments: ${browserEventSummary.audibleMoments}`,
        `Host: ${browserEventSummary.latestAudible.host || 'Unknown'}`,
        `Window: ${formatClock(browserEventSummary.latestAudible.ts)}`,
      ],
      markerLabel: 'Audio',
      evidence: buildRangeEvidenceBundle({
        ambientEntries,
        browserEvents: sortedBrowserEvents,
        startTs: Math.max(0, safeNumber(browserEventSummary.latestAudible.ts) - (20 * 60 * 1000)),
        endTs: safeNumber(browserEventSummary.latestAudible.ts),
        ambientPadMs: 15 * 1000,
        browserPadMs: 0,
        limit: 4,
      }),
    }))
  }

  if (weakestSession && safeNumber(weakestSession.fatigueScore) >= backgroundFatigue.score) {
    events.push(createEvent({
      id: `fatigue-session-${weakestSession.id}`,
      type: 'fatigue-spike',
      linkedTab: 'fatigue',
      linkedEntityType: 'session',
      linkedEntityId: weakestSession.id,
      title: `Fatigue spiked during ${weakestSession.goal || weakestSession.taskTitle || 'a focus block'}`,
      detail: `${safeNumber(weakestSession.fatigueScore)}% fatigue with ${safeNumber(weakestSession.driftCount)} drift events`,
      timestamp: safeNumber(weakestSession.timestamp || weakestSession.createdAt),
      tone: 'warn',
      weight: 92,
      metrics: [
        `Session fatigue: ${safeNumber(weakestSession.fatigueScore)}%`,
        `Focus score: ${safeNumber(weakestSession.focusScore)}/100`,
        `Distractions: ${safeNumber(weakestSession.distractions)}`,
      ],
      markerLabel: 'Strain',
      evidence: weakestSession.rangeEvidence,
    }))
  } else if (backgroundFatigue.score > 0) {
    const fatigueAnchorTs = getBackgroundFatigueAnchor(ambientEntries, {
      ...browserEventSummary,
      dominantDriver: backgroundFatigue.dominantDriver,
    })
    events.push(createEvent({
      id: `fatigue-background-${dateKey}`,
      type: 'fatigue-spike',
      linkedTab: 'fatigue',
      linkedEntityType: 'day',
      linkedEntityId: dateKey,
      title: 'Background fatigue pressure climbed',
      detail: `${backgroundFatigue.score}% fatigue driven by ${backgroundFatigue.dominantDriver.toLowerCase()}`,
      timestamp: fatigueAnchorTs,
      tone: 'warn',
      weight: 84,
      metrics: [
        `Background fatigue: ${backgroundFatigue.score}%`,
        `Switches: ${backgroundFatigue.switches}`,
        `Driver: ${backgroundFatigue.dominantDriver}`,
      ],
      markerLabel: 'Strain',
      evidence: buildRangeEvidenceBundle({
        ambientEntries,
        browserEvents: sortedBrowserEvents,
        startTs: Math.max(0, fatigueAnchorTs - (30 * 60 * 1000)),
        endTs: fatigueAnchorTs + (15 * 60 * 1000),
        ambientPadMs: 0,
        browserPadMs: 0,
        limit: 4,
      }),
    }))
  }

  achievedHabits.forEach((habit) => {
    if (!habit.achieved) return
    const relatedSession = daySessions.find((session) => (
      session.habit === habit.name || String(session.linkedHabitId || '') === String(habit.id || '')
    ))
    events.push(createEvent({
      id: `habit-complete-${habit.id}`,
      type: 'habit-completed',
      linkedTab: 'habits',
      linkedEntityType: 'habit',
      linkedEntityId: habit.id,
      sourceKind: 'habit',
      title: `${habit.name} hit its daily target`,
      detail: `${habit.minutes}m logged against a ${habit.targetMinutes}m target`,
      timestamp: safeNumber(relatedSession?.timestamp || relatedSession?.createdAt),
      tone: 'good',
      weight: 78,
      metrics: [
        `Minutes: ${habit.minutes}m`,
        `Sessions: ${habit.sessions}`,
        `Avg focus: ${habit.avgFocus}/100`,
      ],
      markerLabel: 'Habit',
    }))
  })

  const sortedEvents = events
    .filter((event) => event.timestamp > 0 || event.type === 'fatigue-spike')
    .sort((left, right) => safeNumber(left.timestamp) - safeNumber(right.timestamp))

  const topEvents = [...sortedEvents]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 3)

  return {
    dateKey,
    focusAverage,
    sessionFatigueAverage,
    backgroundFatigue,
    combinedFatigue,
    strongestSession,
    weakestSession,
    backgroundFocusWindows,
    backgroundWindowThresholdMode,
    strongestBackgroundWindow,
    topApp: dayApps[0] || null,
    topCategory: dayCategories[0] || null,
    diagnostics: dayDiagnostics,
    habits: achievedHabits,
    tasksCompleted: dayTasks,
    sessionAnalyses: analyzedSessions,
    mediaEntries,
    browserEvents: sortedBrowserEvents,
    browserEventSummary,
    events: sortedEvents,
    topEvents,
  }
}

export function buildDailyExplanationContext(model = {}) {
  return {
    dateKey: String(model.dateKey || ''),
    focusAverage: safeNumber(model.focusAverage),
    sessionFatigueAverage: safeNumber(model.sessionFatigueAverage),
    backgroundFatigue: safeNumber(model.backgroundFatigue?.score),
    combinedFatigue: safeNumber(model.combinedFatigue),
    topApp: String(model.topApp?.app || 'No dominant app'),
    topCategory: String(model.topCategory?.category || 'No dominant category'),
    tasksCompleted: safeNumber(model.tasksCompleted?.length),
    browserEventSummary: {
      totalEvents: safeNumber(model.browserEventSummary?.totalEvents),
      tabSwitches: safeNumber(model.browserEventSummary?.tabSwitches),
      tabsOpened: safeNumber(model.browserEventSummary?.tabsOpened),
      audibleMoments: safeNumber(model.browserEventSummary?.audibleMoments),
      uniqueHosts: safeNumber(model.browserEventSummary?.uniqueHosts),
    },
    strongestSession: model.strongestSession
      ? {
          title: String(model.strongestSession.goal || model.strongestSession.taskTitle || model.strongestSession.habit || 'Focus session'),
          focusScore: safeNumber(model.strongestSession.focusScore),
          fatigueScore: safeNumber(model.strongestSession.fatigueScore),
          distractions: safeNumber(model.strongestSession.distractions),
        }
      : null,
    weakestSession: model.weakestSession
      ? {
          title: String(model.weakestSession.goal || model.weakestSession.taskTitle || model.weakestSession.habit || 'Focus session'),
          focusScore: safeNumber(model.weakestSession.focusScore),
          fatigueScore: safeNumber(model.weakestSession.fatigueScore),
          distractions: safeNumber(model.weakestSession.distractions),
          driftCount: safeNumber(model.weakestSession.driftCount),
        }
      : null,
    habits: Array.isArray(model.habits)
      ? model.habits.map((habit) => ({
          name: String(habit.name || 'Habit'),
          minutes: safeNumber(habit.minutes),
          targetMinutes: safeNumber(habit.targetMinutes),
          sessions: safeNumber(habit.sessions),
          avgFocus: safeNumber(habit.avgFocus),
          achieved: Boolean(habit.achieved),
        }))
      : [],
    topEvents: Array.isArray(model.topEvents)
      ? model.topEvents.map((event) => ({
          type: event.type,
          title: event.title,
          detail: event.detail,
          timeLabel: event.timeLabel,
          tab: event.linkedTab,
        }))
      : [],
  }
}

export function buildLocalDailyExplanations(context = {}) {
  const weakestSession = context.weakestSession || null
  const strongestHabit = [...(context.habits || [])]
    .filter((habit) => habit.achieved)
    .sort((left, right) => right.avgFocus - left.avgFocus)[0] || null

  const focusWhy = weakestSession
    ? weakestSession.focusScore < 60
      ? `${weakestSession.title} landed at ${weakestSession.focusScore}/100 because drift, distractions, or switching interrupted compounding. The biggest signal is ${weakestSession.distractions} distraction events with ${weakestSession.driftCount} drift moments.`
      : `${weakestSession.title} still held together at ${weakestSession.focusScore}/100, so focus did not truly collapse. The softer limit was fatigue pressure rather than complete fragmentation.`
    : 'No measured focus session landed on this day yet, so focus depth cannot explain more than background behavior.'

  const fatigueWhy = context.combinedFatigue >= 60
    ? `Daily fatigue reached ${context.combinedFatigue}%, with ${context.backgroundFatigue}% coming from background pressure and ${context.sessionFatigueAverage}% from focus sessions. The strongest driver was ${String(context.topEvents?.find((event) => event.type === 'fatigue-spike')?.detail || 'sustained load and switching').toLowerCase()}.`
    : `Fatigue stayed moderate at ${context.combinedFatigue}%, which suggests the day had enough recovery or lower switching than your heavier days. Background pressure remained manageable around ${context.backgroundFatigue}%.`

  const habitWhy = strongestHabit
    ? `${strongestHabit.name} performed well because it reached ${strongestHabit.minutes} of ${strongestHabit.targetMinutes} target minutes and still averaged ${strongestHabit.avgFocus}/100 across ${strongestHabit.sessions} linked sessions. That means the habit was not only completed, it was completed in a strong context.`
    : 'No habit fully broke through on this day. The clearest next step is to tie one habit to a real focus block so the app has evidence to compare.'

  return {
    daySummary: context.topEvents?.length
      ? `The day was defined by ${context.topEvents[0].title.toLowerCase()}, with ${context.topApp} leading the visible work context and ${context.tasksCompleted} task completion${context.tasksCompleted === 1 ? '' : 's'} recorded.`
      : 'The day has only a light analysis footprint so far, with limited events to explain.',
    focusWhy,
    fatigueWhy,
    habitWhy,
  }
}
