import {
  getAverageFocusForRange,
  getCurrentFatigueRisk,
  getDistractionTotal,
  getFocusMinutesToday,
  getHabitAverageFocus,
  getHabitSessions,
  getHabitStreak,
  getPeakHours,
  getSessionAppBreakdown,
  getSessionsInRange,
  getTotalFocusMinutes,
} from './analyticsService.js'
import { buildBrowserEvidenceSummary } from './browserEvidenceService.js'
import { getTodayLocalDateKey, getRecentLocalDateKeys } from './dateKey.js'
import { getAverageFatigueTrend } from './sessionMetrics.js'

function sum(values = []) {
  return values.reduce((total, value) => total + value, 0)
}

function round(value, digits = 0) {
  const safe = Number.isFinite(value) ? value : 0
  const factor = 10 ** digits
  return Math.round(safe * factor) / factor
}

function average(values = []) {
  return values.length ? sum(values) / values.length : 0
}

function getPeakHourEntry(sessions = [], days = []) {
  return getPeakHours(sessions, days)
    .filter((entry) => entry.avg !== null)
    .reduce((best, entry) => (entry.avg > best.avg ? entry : best), { hour: null, avg: -1 })
}

function buildHabitBreakdown(habits = [], sessions = [], days = []) {
  return habits.map((habit) => ({
    name: habit.name,
    sessions: getHabitSessions(sessions, habit.name).filter((session) => days.includes(session.date)).length,
    avgFocus: getHabitAverageFocus(sessions, habit.name),
    streak: getHabitStreak(sessions, habit.name),
    totalMinutes: Math.round(getHabitSessions(sessions, habit.name)
      .filter((session) => days.includes(session.date))
      .reduce((total, session) => total + (session.durationSeconds || 0), 0) / 60),
  }))
}

function buildTaskBreakdown(sessions = [], days = []) {
  const map = new Map()
  getSessionsInRange(sessions, days).forEach((session) => {
    const taskLabel = String(session?.taskTitle || '').trim()
    if (!taskLabel) return

    const current = map.get(taskLabel) || {
      title: taskLabel,
      sessions: 0,
      totalMinutes: 0,
      avgFocus: 0,
      _focusScores: [],
    }

    current.sessions += 1
    current.totalMinutes += Math.round((Number(session?.durationSeconds) || 0) / 60)
    current._focusScores.push(Number(session?.focusScore) || 0)
    map.set(taskLabel, current)
  })

  return [...map.values()]
    .map((entry) => ({
      title: entry.title,
      sessions: entry.sessions,
      totalMinutes: entry.totalMinutes,
      avgFocus: Math.round(average(entry._focusScores)),
    }))
    .sort((left, right) => right.sessions - left.sessions || right.totalMinutes - left.totalMinutes)
    .slice(0, 5)
}

function buildSessionMix(sessions = []) {
  const productiveSeconds = sum(sessions.map((session) => Number(session?.productiveSeconds) || 0))
  const supportingSeconds = sum(sessions.map((session) => Number(session?.supportingSeconds) || 0))
  const distractingSeconds = sum(sessions.map((session) => Number(session?.distractingSeconds) || 0))
  const unclearSeconds = sum(sessions.map((session) => Number(session?.unclearSeconds) || 0))

  return {
    productiveMinutes: Math.round(productiveSeconds / 60),
    supportingMinutes: Math.round(supportingSeconds / 60),
    distractingMinutes: Math.round(distractingSeconds / 60),
    unclearMinutes: Math.round(unclearSeconds / 60),
  }
}

function resolveLane(entry = {}) {
  const lane = String(entry?.lane || '').trim().toLowerCase()
  if (['productive', 'supporting', 'distracting', 'unclear'].includes(lane)) return lane
  if (entry?.productive === true) return 'productive'
  if (entry?.productive === false) return 'distracting'
  return 'unclear'
}

function resolveEntrySeconds(entry = {}) {
  if (Number.isFinite(Number(entry?.duration))) return Math.max(0, Number(entry.duration))
  if (Number.isFinite(Number(entry?.durationSeconds))) return Math.max(0, Number(entry.durationSeconds))
  const start = Number(entry?.ts || 0)
  const end = Number(entry?.endTs || 0)
  return end > start ? Math.max(0, Math.round((end - start) / 1000)) : 0
}

function minutesFromSeconds(seconds = 0) {
  return Math.round(Math.max(0, Number(seconds) || 0) / 60)
}

function buildAmbientSummary(entries = []) {
  const laneSeconds = {
    productive: 0,
    supporting: 0,
    distracting: 0,
    unclear: 0,
  }
  const appMap = new Map()

  ;(Array.isArray(entries) ? entries : []).forEach((entry) => {
    const seconds = resolveEntrySeconds(entry)
    if (!seconds) return
    const lane = resolveLane(entry)
    const app = String(entry?.appGroup || entry?.app || entry?.appName || 'Tracked app').trim() || 'Tracked app'
    laneSeconds[lane] = (laneSeconds[lane] || 0) + seconds

    const current = appMap.get(app) || {
      app,
      seconds: 0,
      productiveSeconds: 0,
      supportingSeconds: 0,
      distractingSeconds: 0,
      unclearSeconds: 0,
      laneTotals: { productive: 0, supporting: 0, distracting: 0, unclear: 0 },
    }
    current.seconds += seconds
    current[`${lane}Seconds`] += seconds
    current.laneTotals[lane] += seconds
    appMap.set(app, current)
  })

  const totalSeconds = sum(Object.values(laneSeconds))
  const topApps = [...appMap.values()]
    .map((entry) => {
      const dominantLane = Object.entries(entry.laneTotals)
        .sort((left, right) => right[1] - left[1])[0]?.[0] || 'unclear'
      return {
        app: entry.app,
        minutes: minutesFromSeconds(entry.seconds),
        lane: dominantLane,
        productiveMinutes: minutesFromSeconds(entry.productiveSeconds),
        supportingMinutes: minutesFromSeconds(entry.supportingSeconds),
        distractingMinutes: minutesFromSeconds(entry.distractingSeconds),
        unclearMinutes: minutesFromSeconds(entry.unclearSeconds),
      }
    })
    .sort((left, right) => right.minutes - left.minutes)
    .slice(0, 6)

  return {
    totalMinutes: minutesFromSeconds(totalSeconds),
    productiveMinutes: minutesFromSeconds(laneSeconds.productive),
    supportingMinutes: minutesFromSeconds(laneSeconds.supporting),
    distractingMinutes: minutesFromSeconds(laneSeconds.distracting),
    unclearMinutes: minutesFromSeconds(laneSeconds.unclear),
    productiveShare: totalSeconds ? round((laneSeconds.productive / totalSeconds) * 100) : 0,
    distractingShare: totalSeconds ? round((laneSeconds.distracting / totalSeconds) * 100) : 0,
    supportingShare: totalSeconds ? round((laneSeconds.supporting / totalSeconds) * 100) : 0,
    unclearShare: totalSeconds ? round((laneSeconds.unclear / totalSeconds) * 100) : 0,
    topApps,
  }
}

function getPreviousDateKeys(days = 7) {
  const anchor = new Date()
  anchor.setDate(anchor.getDate() - Math.max(1, Number(days) || 7))
  return getRecentLocalDateKeys(days, anchor)
}

function buildTaskSummary(tasks = [], todayKey = getTodayLocalDateKey()) {
  const safeTasks = Array.isArray(tasks) ? tasks : []
  const openTasks = safeTasks.filter((task) => task?.status !== 'completed')
  return {
    total: safeTasks.length,
    open: openTasks.length,
    completed: safeTasks.filter((task) => task?.status === 'completed').length,
    dueToday: openTasks.filter((task) => task?.due === todayKey).length,
    overdue: openTasks.filter((task) => task?.due && task.due < todayKey).length,
    highPriorityOpen: openTasks.filter((task) => String(task?.priority || '').toLowerCase() === 'high').length,
  }
}

function buildTrendSummary(sessions = [], currentDays = [], previousDays = []) {
  const currentSessions = getSessionsInRange(sessions, currentDays)
  const previousSessions = getSessionsInRange(sessions, previousDays)
  const currentFocus = getAverageFocusForRange(sessions, currentDays)
  const previousFocus = getAverageFocusForRange(sessions, previousDays)
  const currentMinutes = getTotalFocusMinutes(sessions, currentDays)
  const previousMinutes = getTotalFocusMinutes(sessions, previousDays)
  const currentDistractions = getDistractionTotal(sessions, currentDays)
  const previousDistractions = getDistractionTotal(sessions, previousDays)

  return {
    previousSessions: previousSessions.length,
    sessionDelta: currentSessions.length - previousSessions.length,
    previousAvgFocusScore: previousFocus,
    focusDelta: currentFocus - previousFocus,
    previousFocusMinutes: previousMinutes,
    focusMinutesDelta: currentMinutes - previousMinutes,
    previousDistractionEvents: previousDistractions,
    distractionDelta: currentDistractions - previousDistractions,
  }
}

function buildDataQuality({
  sessionsInRange = [],
  linkedTaskSessions = 0,
  linkedHabitSessions = 0,
  browserEvents = [],
  browserEvidence = {},
  ambientSummary = {},
} = {}) {
  const sessionCount = sessionsInRange.length
  const linkedSessions = Math.min(sessionCount, linkedTaskSessions + linkedHabitSessions)
  const linkedContextCoverage = sessionCount ? Math.round((linkedSessions / sessionCount) * 100) : 0
  const ambientMinutes = Number(ambientSummary.totalMinutes || 0)
  const readinessScore = Math.round(
    (Math.min(sessionCount / 3, 1) * 28)
    + (Math.min(sessionsInRange.reduce((sum, session) => sum + (Number(session?.durationSeconds) || 0), 0) / (150 * 60), 1) * 16)
    + (Math.min(linkedContextCoverage / 100, 1) * 16)
    + (Math.min((browserEvents.length || Number(browserEvidence.totalEvents || 0)) / 12, 1) * 14)
    + (Math.min(sessionsInRange.filter((session) => Number(session?.focusScore || 0) > 0).length / 3, 1) * 10)
    + (Math.min(ambientMinutes / 300, 1) * 16)
  )
  const recommendationConfidence = readinessScore >= 78 ? 'high' : readinessScore >= 55 ? 'medium' : 'low'

  return {
    readinessScore,
    baselineMet: sessionCount >= 3,
    linkedContextCoverage,
    browserEvidenceEvents: browserEvents.length || Number(browserEvidence.totalEvents || 0),
    ambientUsageMinutes: ambientMinutes,
    recommendationConfidence,
  }
}

export function buildInsightContext({
  sessions = [],
  tasks = [],
  habits = [],
  profile = {},
  days = 7,
  ambientEntries = [],
  browserEvents = [],
} = {}) {
  const dateKeys = getRecentLocalDateKeys(days)
  const previousDateKeys = getPreviousDateKeys(days)
  const sessionsInRange = getSessionsInRange(sessions, dateKeys)
  const avgFocus = getAverageFocusForRange(sessions, dateKeys)
  const totalFocusMinutes = getTotalFocusMinutes(sessions, dateKeys)
  const distractionEvents = getDistractionTotal(sessions, dateKeys)
  const peakHour = getPeakHourEntry(sessions, dateKeys)
  const appBreakdown = getSessionAppBreakdown(sessions, dateKeys)
  const habitBreakdown = buildHabitBreakdown(habits, sessions, dateKeys)
  const taskBreakdown = buildTaskBreakdown(sessions, dateKeys)
  const fatigueHighDays = dateKeys.filter((day) => {
    const daySessions = sessions.filter((session) => session.date === day)
    return daySessions.some((session) => session.fatigueRisk === 'High')
  }).length
  const fatigueTrend = getAverageFatigueTrend(sessionsInRange, dateKeys)
  const sessionMix = buildSessionMix(sessionsInRange)
  const ambientSummary = buildAmbientSummary(ambientEntries)
  const linkedTaskSessions = sessionsInRange.filter((session) => session.linkedTaskId || session.taskTitle).length
  const linkedHabitSessions = sessionsInRange.filter((session) => session.linkedHabitId || session.habit).length
  const browserEvidence = buildBrowserEvidenceSummary({
    ambientEntries,
    browserEvents,
    padMs: 0,
    limit: 4,
  })
  const trend = buildTrendSummary(sessions, dateKeys, previousDateKeys)
  const dataQuality = buildDataQuality({
    sessionsInRange,
    linkedTaskSessions,
    linkedHabitSessions,
    browserEvents,
    browserEvidence,
    ambientSummary,
  })

  return {
    period: `${days} days`,
    sessions: sessionsInRange.length,
    avgFocusScore: avgFocus,
    totalFocusMinutes,
    distractionEvents,
    peakFocusHour: peakHour.hour,
    peakFocusScore: peakHour.avg >= 0 ? peakHour.avg : null,
    topApps: appBreakdown.slice(0, 4).map((app) => `${app.app} (${app.minutes}m)`),
    appBreakdown: appBreakdown.slice(0, 6),
    habits: habitBreakdown,
    tasks: taskBreakdown,
    taskSummary: buildTaskSummary(tasks),
    trend,
    fatigueHighDays,
    currentFatigue: getCurrentFatigueRisk(sessions, getTodayLocalDateKey()),
    fatigueTrend,
    fatigueAverage: Math.round(average(sessionsInRange.map((session) => Number(session?.fatigueScore) || 0))),
    avgKpm: Math.round(average(sessionsInRange.map((session) => Number(session?.sessionSummary?.averageKpm ?? session?.keystrokesPerMin) || 0))),
    avgWpm: Math.round(average(sessionsInRange.map((session) => Number(session?.sessionSummary?.averageWpm ?? 0) || 0))),
    avgSessionMinutes: Math.round(average(sessionsInRange.map((session) => (Number(session?.durationSeconds) || 0) / 60))),
    sessionMix,
    ambientSummary,
    linkedTaskSessions,
    linkedHabitSessions,
    dataQuality,
    todayFocusMinutes: getFocusMinutesToday(sessions, getTodayLocalDateKey()),
    workHours: profile?.workingHours || null,
    focusGoal: profile?.goal || null,
    browserEvidence: {
      totalEvents: Number(browserEvidence.totalEvents || 0),
      pressureScore: Number(browserEvidence.pressureScore || 0),
      dominantLane: browserEvidence.dominantLane || 'unclear',
      distractingShare: Number(browserEvidence.distractingShare || 0),
      supportingShare: Number(browserEvidence.supportingShare || 0),
      totalBrowserMinutes: Number(browserEvidence.totalBrowserMinutes || 0),
      dominantPressureLabel: browserEvidence.dominantPressureLabel || 'Quiet browser context',
      leadSiteLabel: browserEvidence.leadSiteLabel || 'No clear site yet',
      leadPageLabel: browserEvidence.leadPageLabel || 'No clear page yet',
      topSites: Array.isArray(browserEvidence.topSites)
        ? browserEvidence.topSites.slice(0, 4).map((site) => ({
          label: String(site?.label || 'Browser'),
          lane: String(site?.dominantLane || 'unclear'),
          share: Number(site?.share || 0),
        }))
        : [],
    },
  }
}
