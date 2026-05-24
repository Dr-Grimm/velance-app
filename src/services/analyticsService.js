import { normalizeObservedAppName } from './activityClassification.js'
import { formatLocalDateKey } from './dateKey.js'
import { buildBackgroundFatigueSnapshot, buildStoredSessionAnalysis } from './analysisEngine.js'

export function getSessionsInRange(sessions, days) {
    return sessions.filter((session) => days.includes(session.date))
}

function isNoiseAppLabel(label) {
    return !label || label === '-' || label === 'Unknown' || /velance|electron/i.test(label)
}

function toDisplayMinutes(seconds = 0) {
    const safe = Math.max(0, Number(seconds) || 0)
    if (safe === 0) return 0
    if (safe < 60) return Math.max(0.1, Math.round(safe / 6) / 10)
    return Math.round(safe / 60)
}

function clamp(value, min = 0, max = 100) {
    return Math.min(max, Math.max(min, value))
}

function getDayAmbientEntries(entries = [], day = '') {
    return entries.filter((entry) => entry?.date === day || entry?.dateKey === day)
}

function getAverageNumeric(values = []) {
    const safeValues = values
        .map((value) => Number(value) || 0)
        .filter((value) => Number.isFinite(value))
    return safeValues.length
        ? Math.round(safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length)
        : 0
}

function getBackgroundFatigueModel(entries = []) {
    return buildBackgroundFatigueSnapshot(entries)
}

function getSessionAnalysis(session = {}) {
    return buildStoredSessionAnalysis(session)
}

export function getFocusTrend(sessions, days) {
    return days.map((day) => {
        const daySessions = sessions.filter((session) => session.date === day)
        return daySessions.length
            ? Math.round(daySessions.reduce((sum, session) => sum + getSessionAnalysis(session).focusScore, 0) / daySessions.length)
            : 0
    })
}

export function getAverageFocusForRange(sessions, days) {
    const values = getFocusTrend(sessions, days).filter((value) => value > 0)
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
}

export function getTotalFocusMinutes(sessions, days) {
    return Math.round(getSessionsInRange(sessions, days).reduce((sum, session) => sum + session.durationSeconds, 0) / 60)
}

export function getSessionCount(sessions, days) {
    return getSessionsInRange(sessions, days).length
}

export function getDistractionTotal(sessions, days) {
    return getSessionsInRange(sessions, days).reduce((sum, session) => sum + (session.distractions || 0), 0)
}

export function getSessionAppBreakdown(sessions, days) {
    const map = {}
    getSessionsInRange(sessions, days).forEach((session) => {
        const breakdown = Array.isArray(session.appBreakdown) && session.appBreakdown.length
            ? session.appBreakdown
            : (session.primaryApp
                ? [{
                    app: session.primaryContext || session.primaryApp,
                    seconds: session.durationSeconds || 0,
                    keystrokes: session.totalKeystrokes || 0,
                }]
                : [])

        breakdown.forEach((app) => {
            const normalizedApp = normalizeObservedAppName(app.app)
            if (isNoiseAppLabel(normalizedApp)) return
            if (!map[normalizedApp]) map[normalizedApp] = { seconds: 0, keystrokes: 0 }
            map[normalizedApp].seconds += app.seconds
            map[normalizedApp].keystrokes += app.keystrokes
        })
    })

    return Object.entries(map)
        .map(([app, value]) => ({ app, ...value, minutes: toDisplayMinutes(value.seconds) }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, 8)
}

export function getPeakHours(sessions, days) {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, count: 0 }))
    getSessionsInRange(sessions, days).forEach((session) => {
        if (!session.timestamp) return
        const hour = new Date(session.timestamp).getHours()
        hours[hour].total += getSessionAnalysis(session).focusScore
        hours[hour].count += 1
    })

    return hours.map((hour) => ({
        hour: hour.hour,
        avg: hour.count > 0 ? Math.round(hour.total / hour.count) : null,
    }))
}

export function getCurrentFatigueRisk(sessions, todayKey) {
    const todaySessions = sessions
        .filter((session) => session.date === todayKey)
        .map((session) => getSessionAnalysis(session))
    if (!todaySessions.length) return 'Low'
    if (todaySessions.some((session) => session.fatigueRisk === 'High')) return 'High'
    if (todaySessions.filter((session) => session.fatigueRisk === 'Moderate').length > 1) return 'Moderate'
    return 'Low'
}

export function getAverageFocusToday(sessions, todayKey, fallbackFocus = 0) {
    const todaySessions = sessions.filter((session) => session.date === todayKey)
    if (!todaySessions.length) return fallbackFocus
    return Math.round(todaySessions.reduce((sum, session) => sum + getSessionAnalysis(session).focusScore, 0) / todaySessions.length)
}

export function getFocusMinutesToday(sessions, todayKey) {
    return Math.round(
        sessions
            .filter((session) => session.date === todayKey)
            .reduce((sum, session) => sum + session.durationSeconds, 0) / 60
    )
}

export function getHabitStreak(sessions, habitName) {
    let streak = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = formatLocalDateKey(date)
        const hasSession = sessions.some((session) => session.date === dateStr && session.habit === habitName)
        if (hasSession) streak += 1
        else if (i > 0) break
    }
    return streak
}

function getHabitTrackedMinutesForDate(sessions = [], habitName = '', dateKey = '') {
    return Math.round(
        sessions
            .filter((session) => session.habit === habitName && session.date === dateKey)
            .reduce((sum, session) => sum + session.durationSeconds, 0) / 60
    )
}

export function getHabitTotalMinutesForDate(sessions = [], habit = {}, dateKey = '') {
    return getHabitTrackedMinutesForDate(sessions, habit.name, dateKey)
}

export function getHabitStreakWithCredits(sessions, habit = {}) {
    let streak = 0
    const today = new Date()
    for (let i = 0; i < 365; i++) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = formatLocalDateKey(date)
        const hasCredit = getHabitTotalMinutesForDate(sessions, habit, dateStr) > 0
        if (hasCredit) streak += 1
        else if (i > 0) break
    }
    return streak
}

export function getHabitSessions(sessions, habitName) {
    return sessions.filter((session) => session.habit === habitName)
}

export function getHabitAverageFocus(sessions, habitName) {
    const habitSessions = getHabitSessions(sessions, habitName)
    return habitSessions.length
        ? Math.round(habitSessions.reduce((sum, session) => sum + getSessionAnalysis(session).focusScore, 0) / habitSessions.length)
        : 0
}

export function getHabitTotalMinutes(sessions, habitName, habit = null) {
    return Math.round(getHabitSessions(sessions, habitName).reduce((sum, session) => sum + session.durationSeconds, 0) / 60)
}

export function getHabitHeatmap(sessions, habitName, days = 90, habit = null) {
    const data = []
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = formatLocalDateKey(date)
        const daySessions = sessions.filter((session) => session.date === dateStr && (!habitName || session.habit === habitName))
        data.push({
            date: dateStr,
            count: daySessions.length,
            minutes: Math.round(daySessions.reduce((sum, session) => sum + session.durationSeconds, 0) / 60),
            skipped: false,
        })
    }
    return data
}

export function getTaskUrgencyScore(task, todayKey) {
    if (!task || task.status === 'completed') return -1

    let score = 0
    if (task.due && task.due < todayKey) score += 100
    else if (task.due === todayKey) score += 60

    if (task.priority === 'High') score += 30
    else if (task.priority === 'Normal') score += 15
    else if (task.priority === 'Low') score += 5

    if (task.status === 'in-progress') score += 20
    if (task.habit) score += 5

    return score
}

export function getSuggestedTask(tasks, todayKey) {
    const ranked = [...tasks]
        .filter((task) => task.status !== 'completed')
        .map((task) => ({ ...task, urgencyScore: getTaskUrgencyScore(task, todayKey) }))
        .sort((a, b) => {
            if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore
            return (a.createdAt || 0) - (b.createdAt || 0)
        })

    return ranked[0] || null
}

export function getHabitCompletionStats(habits, sessions, todayKey) {
    const stats = habits.map((habit) => {
        const todayMinutes = getHabitTotalMinutesForDate(sessions, habit, todayKey)
        const progress = habit.targetMinutes > 0 ? todayMinutes / habit.targetMinutes : 0

        return {
            ...habit,
            todayMinutes,
            progress,
            isSkipped: false,
            isOnTrack: todayMinutes >= habit.targetMinutes,
        }
    })

    return {
        total: stats.length,
        onTrack: stats.filter((habit) => habit.isOnTrack).length,
        skipped: stats.filter((habit) => habit.isSkipped).length,
        behind: stats.filter((habit) => !habit.isOnTrack).length,
        stats,
    }
}

export function buildAnalyticsRangeModel({
    days = [],
    sessions = [],
    habits = [],
    ambientEntries = [],
    mediaEntries = [],
    ambient,
} = {}) {
    const safeAmbient = ambient || {}
    const appUsage = safeAmbient.getAppBreakdown ? safeAmbient.getAppBreakdown(ambientEntries) : []
    const browserSites = safeAmbient.getBrowserContextBreakdown ? safeAmbient.getBrowserContextBreakdown(ambientEntries, { groupBy: 'host' }) : []
    const diagnostics = safeAmbient.getTrackingDiagnostics ? safeAmbient.getTrackingDiagnostics(ambientEntries) : {
        chunkCount: 0,
        trackedSeconds: 0,
        productiveSeconds: 0,
        supportingSeconds: 0,
        unclearSeconds: 0,
        distractingSeconds: 0,
        avgConfidence: 0,
        uniqueApps: 0,
        uniqueBrowserHosts: 0,
    }
    const mediaSummary = safeAmbient.getMediaBreakdown ? safeAmbient.getMediaBreakdown(mediaEntries) : []
    const categoryBreakdown = safeAmbient.getCategoryBreakdown ? safeAmbient.getCategoryBreakdown(ambientEntries) : []
    const productivityScore = safeAmbient.getProductivityScore ? safeAmbient.getProductivityScore(ambientEntries) : null

    const trackedSeconds = ambientEntries.reduce((sum, entry) => sum + (Number(entry?.duration) || 0), 0)
    const focusTrend = getFocusTrend(sessions, days)
    const averageFocus = getAverageFocusForRange(sessions, days)
    const totalFocusMinutes = getTotalFocusMinutes(sessions, days)
    const sessionCount = getSessionCount(sessions, days)
    const distractionTotal = getDistractionTotal(sessions, days)
    const peakHours = getPeakHours(sessions, days).filter((entry) => entry.hour >= 7 && entry.hour <= 22)

    const strongestDay = days.reduce((best, day) => {
        const daySessions = sessions.filter((session) => session.date === day)
        if (!daySessions.length) return best
        const avgFocus = Math.round(daySessions.reduce((sum, session) => sum + getSessionAnalysis(session).focusScore, 0) / daySessions.length)
        if (!best || avgFocus > best.avgFocus) return { date: day, avgFocus, sessions: daySessions.length }
        return best
    }, null)

    const sessionFatigueTrend = days.map((day) => {
        const daySessions = sessions
            .filter((session) => session.date === day)
            .map((session) => getSessionAnalysis(session))
        if (!daySessions.length) return 0
        const high = daySessions.filter((session) => session.fatigueRisk === 'High').length
        const moderate = daySessions.filter((session) => session.fatigueRisk === 'Moderate').length
        return Math.round(((high * 100) + (moderate * 50)) / Math.max(daySessions.length, 1))
    })

    const backgroundFatigueTrend = days.map((day) => getBackgroundFatigueModel(getDayAmbientEntries(ambientEntries, day)).score)

    const fatigueTrend = days.map((day, index) => {
        const daySessions = sessions.filter((session) => session.date === day)
        const sessionScore = sessionFatigueTrend[index]
        const backgroundScore = backgroundFatigueTrend[index]
        if (daySessions.length && backgroundScore > 0) {
            return Math.round((sessionScore * 0.62) + (backgroundScore * 0.38))
        }
        if (daySessions.length) return sessionScore
        return backgroundScore
    })

    const fatigueWindows = days
        .map((day, index) => {
            const backgroundModel = getBackgroundFatigueModel(getDayAmbientEntries(ambientEntries, day))
            return {
            date: day,
            risk: fatigueTrend[index],
            sessionRisk: sessionFatigueTrend[index],
            backgroundRisk: backgroundFatigueTrend[index],
            sessions: sessions.filter((session) => session.date === day).length,
            trackedSeconds: backgroundModel.trackedSeconds,
            dominantDriver: backgroundModel.dominantDriver,
        }})
        .filter((entry) => entry.sessions > 0 || entry.trackedSeconds > 0)
        .sort((left, right) => right.risk - left.risk)
        .slice(0, 4)

    const laneBreakdown = [
        { key: 'productive', label: 'Productive', seconds: diagnostics.productiveSeconds || 0, tone: '#14B8A6' },
        { key: 'supporting', label: 'Supporting', seconds: diagnostics.supportingSeconds || 0, tone: '#94A3B8' },
        { key: 'unclear', label: 'Unclear', seconds: diagnostics.unclearSeconds || 0, tone: '#CBD5E1' },
        { key: 'distracting', label: 'Distracting', seconds: diagnostics.distractingSeconds || 0, tone: '#FB7185' },
    ]

    const strongestHour = peakHours
        .filter((entry) => Number.isFinite(entry?.avg) && entry.avg !== null)
        .sort((left, right) => (right.avg || 0) - (left.avg || 0))[0] || null

    const habitPatterns = habits.map((habit) => ({
        ...habit,
        totalMinutes: getHabitTotalMinutes(sessions, habit.name),
        avgFocus: getHabitAverageFocus(sessions, habit.name),
        streak: getHabitStreak(sessions, habit.name),
        sessions: getHabitSessions(sessions, habit.name).length,
    }))

    const fatigueSummary = {
        combinedAverage: getAverageNumeric(fatigueTrend),
        sessionAverage: getAverageNumeric(sessionFatigueTrend.filter((value) => value > 0)),
        backgroundAverage: getAverageNumeric(backgroundFatigueTrend.filter((value) => value > 0)),
    }

    return {
        focusTrend,
        averageFocus,
        totalFocusMinutes,
        sessionCount,
        distractionTotal,
        trackedSeconds,
        productivityScore,
        peakHours,
        strongestDay,
        strongestHour,
        fatigueTrend,
        sessionFatigueTrend,
        backgroundFatigueTrend,
        fatigueWindows,
        fatigueSummary,
        appUsage,
        browserSites,
        mediaSummary,
        categoryBreakdown,
        diagnostics,
        laneBreakdown,
        habitPatterns,
    }
}
