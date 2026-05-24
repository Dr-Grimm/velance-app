import { computed } from 'vue'
import { useAmbientTracker } from './useAmbientTracker.js'
import { useActivityTracker } from './useActivityTracker.js'

function fmtAgo(timestamp) {
  if (!timestamp) return 'Waiting'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 5) return 'Live now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

function formatLivePointer(tracker) {
  return tracker.isIdle.value ? 'Idle' : `${tracker.mouseIntensity.value}%`
}

function buildTimelineEntries(entries = []) {
  if (!entries.length) return []
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dayMs = 86400000

  return entries.map((entry) => ({
    ...entry,
    left: `${(((entry.ts - dayStart.getTime()) / dayMs) * 100).toFixed(3)}%`,
    width: `${Math.max(entry.duration / 864, 0.4).toFixed(3)}%`,
  }))
}

function buildLiveAppUsageFallback(appTimeline = []) {
  return appTimeline.slice(0, 6).map((item) => ({
    app: item.app,
    minutes: item.seconds < 60 ? Math.max(0.1, Math.round((item.seconds || 0) / 6) / 10) : Math.max(1, Math.round((item.seconds || 0) / 60)),
    seconds: item.seconds || 0,
    keystrokes: item.keystrokes || 0,
    category: item.category || 'Context',
    productive: item.productive ?? null,
  }))
}

export function useDailyActivitySummary() {
  const ambient = useAmbientTracker()
  const tracker = useActivityTracker()

  const todayEntries = computed(() => ambient.getVisibleEntries(ambient.getToday()))
  const categoryBreakdown = computed(() => ambient.getCategoryBreakdown(todayEntries.value))
  const appBreakdown = computed(() => ambient.getAppBreakdown(todayEntries.value))
  const productivityScore = computed(() => ambient.getProductivityScore(todayEntries.value))
  const pulse = computed(() => ambient.getProductivityPulse(todayEntries.value))
  const hourlyBreakdown = computed(() => ambient.getHourlyBreakdown(todayEntries.value))
  const topDistractors = computed(() => ambient.getTopDistractors(todayEntries.value, 5))
  const insights = computed(() => ambient.getInsights(todayEntries.value))
  const weeklyTrend = computed(() => ambient.getWeeklyTrend())
  const liveSnapshot = computed(() => ambient.getLiveSnapshot())
  const totalTrackedSeconds = computed(() => todayEntries.value.reduce((sum, entry) => sum + (entry.duration || 0), 0))
  const totalTrackedMins = computed(() => Math.round(totalTrackedSeconds.value / 60))
  const productiveSeconds = computed(() => todayEntries.value.filter((entry) => entry.productive === true).reduce((sum, entry) => sum + (entry.duration || 0), 0))
  const distractSeconds = computed(() => todayEntries.value.filter((entry) => entry.productive === false).reduce((sum, entry) => sum + (entry.duration || 0), 0))
  const neutralSeconds = computed(() => todayEntries.value.filter((entry) => entry.productive === null).reduce((sum, entry) => sum + (entry.duration || 0), 0))
  const topCategory = computed(() => categoryBreakdown.value[0] || null)
  const todayTimeline = computed(() => buildTimelineEntries(ambient.getTodayTimeline()))
  const trackerHealth = computed(() => ({
    source: tracker.telemetryStatus.value.source === 'native' ? 'Native hook' : 'Browser mode',
    signal: fmtAgo(tracker.telemetryStatus.value.lastSampleAt),
    window: liveSnapshot.value?.title || tracker.currentTitle.value || 'Waiting for visible window',
    app: liveSnapshot.value?.app || tracker.currentApp.value || 'Waiting',
  }))
  const liveTodayFallback = computed(() => {
    if (!tracker.isTracking.value) return null
    return {
      app: tracker.currentApp.value !== '-' ? tracker.currentApp.value : 'Waiting for app context',
      context: tracker.currentClassification.value?.contextLabel || tracker.currentTitle.value || 'No classified context yet',
      wpm: tracker.liveWpm.value,
      pointer: formatLivePointer(tracker),
      switches: tracker.windowSwitchCount.value,
      score: tracker.focusScore.value,
    }
  })
  const liveAppUsageFallback = computed(() => buildLiveAppUsageFallback(tracker.appTimeline.value))

  return {
    todayEntries,
    categoryBreakdown,
    appBreakdown,
    productivityScore,
    pulse,
    totalTrackedSeconds,
    totalTrackedMins,
    topCategory,
    liveTodayFallback,
    liveAppUsageFallback,
    hourlyBreakdown,
    topDistractors,
    insights,
    weeklyTrend,
    liveSnapshot,
    productiveSeconds,
    distractSeconds,
    neutralSeconds,
    trackerHealth,
    todayTimeline,
  }
}
