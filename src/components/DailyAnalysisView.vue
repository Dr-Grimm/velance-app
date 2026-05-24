<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useVelanceStore } from '../store/velance.js'
import { useAmbientTracker } from '../composables/useAmbientTracker.js'
import { buildAnalyticsRangeModel } from '../services/analyticsService.js'
import { ANALYTICS_TAB_SOURCES, buildSourceBadges } from '../services/analysisSources.js'
import { buildDailyAnalysisModel, buildDailyExplanationContext, buildLocalDailyExplanations } from '../services/dailyAnalysisService.js'
import { buildBrowserAwareBackgroundFatigueSnapshot, buildRangeEvidenceBundle } from '../services/analysisEngine.js'
import { explainDailyAnalysis } from '../services/dataService.js'
import { getAiModeLabel, hasConfiguredAiKey } from '../services/aiProvider.js'
import { clampRangeAnchor, formatDateKeyLabel, getLocalDayRange, getTodayLocalDateKey, shiftDateKey } from '../services/dateNavigation.js'
import { formatActivityDuration } from '../services/activityTimeline.js'
import { CATEGORY_COLORS, getTrackingLaneMeta, TRACKING_LANE_META } from '../services/activityClassification.js'
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon, CircleHelpIcon, ListTodoIcon, MonitorIcon, SlidersHorizontalIcon, TargetIcon, XIcon } from 'lucide-vue-next'

const props = defineProps({
  selectedDateKey: { type: String, default: '' },
  activeTab: { type: String, default: 'overview' },
  highlightedEventId: { type: String, default: '' },
  showHero: { type: Boolean, default: true },
  showTabs: { type: Boolean, default: true },
})

const emit = defineEmits(['update:selectedDateKey', 'update:activeTab', 'activate-event'])
const VueApexCharts = defineAsyncComponent(() =>
  import('vue3-apexcharts').then((module) => module.default)
)

const store = useVelanceStore()
const ambient = useAmbientTracker()
const todayKey = ref(getTodayLocalDateKey())
const internalSelectedDateKey = ref(props.selectedDateKey || todayKey.value)
const internalActiveTab = ref(props.activeTab || 'overview')
const explanationLoading = ref(false)
const explanationError = ref('')
const explanations = ref({ daySummary: '', focusWhy: '', fatigueWhy: '', habitWhy: '' })
const explanationCache = ref({})
const sourceModeByTab = ref({ fatigue: 'combined', habits: 'manual' })
const focusSessionSelectionId = ref('')
const appSortMode = ref('seconds')
const browserSortMode = ref('seconds')
const mediaSortMode = ref('seconds')
const browserViewMode = ref('host')
const usageExplorerMode = ref('apps')
const usageExplorerQuery = ref('')
const usageExplorerLaneFilter = ref('all')
const ruleSubmitting = ref(false)
const ruleTarget = ref('')
const ruleLabel = ref('')
const ruleSource = ref('app')
const ruleCategory = ref('Other')
const ruleLane = ref('unclear')
const showCorrectionModal = ref(false)

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'focus', label: 'Focus Depth' },
  { id: 'apps', label: 'App Usage' },
  { id: 'fatigue', label: 'Fatigue' },
  { id: 'habits', label: 'Habits' },
]

const appSortOptions = [
  { id: 'seconds', label: 'Top used' },
  { id: 'recent', label: 'Recent' },
  { id: 'switches', label: 'Most switches' },
  { id: 'productive', label: 'Most productive' },
  { id: 'distracting', label: 'Most distracting' },
]

const browserSortOptions = [
  { id: 'seconds', label: 'Top sites' },
  { id: 'recent', label: 'Recent' },
  { id: 'switches', label: 'Most switches' },
  { id: 'confidence', label: 'Highest confidence' },
]

const browserViewOptions = [
  { id: 'host', label: 'Sites' },
  { id: 'page', label: 'Pages' },
]

const mediaSortOptions = [
  { id: 'seconds', label: 'Longest' },
  { id: 'recent', label: 'Recent' },
  { id: 'alphabetical', label: 'A-Z' },
]

const usageExplorerOptions = [
  { id: 'apps', label: 'Apps' },
  { id: 'sites', label: 'Sites' },
  { id: 'pages', label: 'Pages' },
  { id: 'media', label: 'Media' },
]
const usageExplorerLaneOptions = [
  { id: 'all', label: 'All lanes' },
  { id: 'productive', label: 'Productive' },
  { id: 'supporting', label: 'Supporting' },
  { id: 'unclear', label: 'Unclear' },
  { id: 'distracting', label: 'Distracting' },
]

const correctionCategories = Object.keys(CATEGORY_COLORS).filter((category) => !['Unknown'].includes(category))
const correctionLaneOptions = [
  { id: 'productive', label: 'Productive' },
  { id: 'supporting', label: 'Supporting' },
  { id: 'unclear', label: 'Unclear' },
  { id: 'distracting', label: 'Distracting' },
]

const selectedDateKey = computed({
  get: () => props.selectedDateKey || internalSelectedDateKey.value,
  set: (value) => {
    const next = value || todayKey.value
    internalSelectedDateKey.value = next
    emit('update:selectedDateKey', next)
  },
})

const activeTab = computed({
  get: () => props.activeTab || internalActiveTab.value,
  set: (value) => {
    const next = value || 'overview'
    internalActiveTab.value = next
    emit('update:activeTab', next)
  },
})

watch(() => props.selectedDateKey, (value) => { if (value) internalSelectedDateKey.value = value })
watch(() => props.activeTab, (value) => {
  if (value) internalActiveTab.value = value
  if (value && value !== 'apps') showCorrectionModal.value = false
})
watch(() => selectedDateKey.value, (value) => {
  if (!value || value > todayKey.value) selectedDateKey.value = todayKey.value
  focusSessionSelectionId.value = ''
  showCorrectionModal.value = false
})

const currentTabSourceConfig = computed(() => ANALYTICS_TAB_SOURCES[activeTab.value] || { ids: ['combined'], note: '' })
const activeTabSourceBadges = computed(() => buildSourceBadges(currentTabSourceConfig.value.ids || []))
const activeTabSourceNote = computed(() => currentTabSourceConfig.value.note || '')
const activeSourceMode = computed({
  get() {
    const available = currentTabSourceConfig.value.ids || []
    const selected = sourceModeByTab.value[activeTab.value]
    return available.includes(selected) ? selected : (available[0] || 'combined')
  },
  set(mode) {
    sourceModeByTab.value = { ...sourceModeByTab.value, [activeTab.value]: mode }
  },
})
const canToggleSource = computed(() => activeTabSourceBadges.value.length > 1)

onMounted(async () => {
  await ambient.attachListener()
  await ambient.refreshDate(selectedDateKey.value)
})

watch(() => selectedDateKey.value, async () => {
  await ambient.refreshDate(selectedDateKey.value)
})

const backgroundEntries = computed(() => ambient.getEntriesForDate(selectedDateKey.value))
const mediaEntries = computed(() => ambient.getMediaForDate(selectedDateKey.value))
const browserEvents = computed(() => ambient.getBrowserEventsForDate(selectedDateKey.value))
const browserEventSummary = computed(() => ambient.getBrowserEventSummary(browserEvents.value))
const dayRangeModel = computed(() => buildAnalyticsRangeModel({
  days: [selectedDateKey.value],
  sessions: store.sessions,
  habits: store.habits,
  ambientEntries: backgroundEntries.value,
  mediaEntries: mediaEntries.value,
  ambient,
}))
const dailyAnalysisModel = computed(() => buildDailyAnalysisModel({
  dateKey: selectedDateKey.value,
  sessions: store.sessions,
  tasks: store.tasks,
  habits: store.habits,
  ambientEntries: backgroundEntries.value,
  mediaEntries: mediaEntries.value,
  browserEvents: browserEvents.value,
  ambient,
}))

const daySessions = computed(() => [...(dailyAnalysisModel.value.sessionAnalyses || [])]
  .sort((left, right) => Number(left.timestamp || left.createdAt || 0) - Number(right.timestamp || right.createdAt || 0))
  .map((session) => ({
    ...session,
    title: session.goal || session.taskTitle || session.habit || 'Focus session',
    durationLabel: formatActivityDuration(session.durationSeconds || 0),
  })))
const completedTasks = computed(() => dailyAnalysisModel.value.tasksCompleted || [])
const topEvents = computed(() => dailyAnalysisModel.value.topEvents || [])
const selectedEvent = computed(() => (
  dailyAnalysisModel.value.events?.find((event) => event.id === props.highlightedEventId && event.linkedTab === activeTab.value)
  || topEvents.value.find((event) => event.linkedTab === activeTab.value)
  || topEvents.value[0]
  || null
))

const appsByTime = computed(() => ambient.getAppBreakdown(backgroundEntries.value, { sortBy: 'seconds' }))
const appsByRecent = computed(() => ambient.getAppBreakdown(backgroundEntries.value, { sortBy: 'recent' }))
const appsList = computed(() => ambient.getAppBreakdown(backgroundEntries.value, { sortBy: appSortMode.value }))
const browserSites = computed(() => ambient.getBrowserContextBreakdown(backgroundEntries.value, {
  groupBy: browserViewMode.value,
  sortBy: browserSortMode.value,
}))
const mediaContext = computed(() => ambient.getMediaBreakdown(mediaEntries.value, { sortBy: mediaSortMode.value }))
const categoryBreakdown = computed(() => dayRangeModel.value.categoryBreakdown || [])
const diagnostics = computed(() => dayRangeModel.value.diagnostics || {})
const customRules = computed(() => ambient.getCustomRules() || {})
const manualHabitCards = computed(() => store.habits.map((habit) => {
  const relatedSessions = daySessions.value.filter((session) => session.habit === habit.name || String(session.linkedHabitId || '') === String(habit.id || ''))
  const totalMinutes = Math.round(relatedSessions.reduce((sum, session) => sum + Number(session.durationSeconds || 0), 0) / 60)
  const targetMinutes = Number(habit.targetMinutes || 0)
  const completedTaskCount = completedTasks.value.filter((task) => task.habit === habit.name).length
  return {
    ...habit,
    totalMinutes,
    targetMinutes,
    sessions: relatedSessions.length,
    completedTaskCount,
    achieved: targetMinutes > 0 ? totalMinutes >= targetMinutes : totalMinutes > 0,
  }
}))
const sessionHabitCards = computed(() => manualHabitCards.value
  .filter((habit) => habit.sessions > 0 || habit.completedTaskCount > 0)
  .map((habit) => ({
    ...habit,
    avgFocus: averageNumbers(
      daySessions.value
        .filter((session) => session.habit === habit.name || String(session.linkedHabitId || '') === String(habit.id || ''))
        .map((session) => Number(session.focusScore || 0))
    ),
    bestSessionScore: Math.max(
      0,
      ...daySessions.value
        .filter((session) => session.habit === habit.name || String(session.linkedHabitId || '') === String(habit.id || ''))
        .map((session) => Number(session.focusScore || 0))
    ),
  })))
const displayedHabitCards = computed(() => activeSourceMode.value === 'manual' ? manualHabitCards.value : sessionHabitCards.value)

const habitStats = computed(() => {
  const totalTargetMinutes = manualHabitCards.value.reduce((sum, habit) => sum + Number(habit.targetMinutes || 0), 0)
  const totalLoggedMinutes = manualHabitCards.value.reduce((sum, habit) => sum + Number(habit.totalMinutes || 0), 0)
  const onTrackCount = manualHabitCards.value.filter((habit) => habit.achieved).length
  const nextGapHabit = [...manualHabitCards.value]
    .filter((habit) => Number(habit.targetMinutes || 0) > Number(habit.totalMinutes || 0))
    .sort((left, right) => (Number(right.targetMinutes || 0) - Number(right.totalMinutes || 0)) - (Number(left.targetMinutes || 0) - Number(left.totalMinutes || 0)))[0] || null
  const strongestSessionHabit = [...sessionHabitCards.value]
    .sort((left, right) => (Number(right.avgFocus || 0) * Math.max(Number(right.sessions || 0), 1)) - (Number(left.avgFocus || 0) * Math.max(Number(left.sessions || 0), 1)))[0] || null
  const totalCompletedTaskWins = manualHabitCards.value.reduce((sum, habit) => sum + Number(habit.completedTaskCount || 0), 0)
  const totalHabitSessions = sessionHabitCards.value.reduce((sum, habit) => sum + Number(habit.sessions || 0), 0)
  return {
    totalTargetMinutes,
    totalLoggedMinutes,
    onTrackCount,
    nextGapHabit,
    strongestSessionHabit,
    totalCompletedTaskWins,
    totalHabitSessions,
    avgFocus: averageNumbers(sessionHabitCards.value.map((habit) => Number(habit.avgFocus || 0))),
  }
})

const explanationContext = computed(() => buildDailyExplanationContext(dailyAnalysisModel.value))
const localExplanations = computed(() => buildLocalDailyExplanations(explanationContext.value))
const hasApiKey = computed(() => hasConfiguredAiKey(store.settings))
const hasAiAnalysisBridge = computed(() => typeof window.velance?.analysis?.explainDay === 'function')
const canUseAiAnalysis = computed(() => hasApiKey.value && hasAiAnalysisBridge.value && store.backendStatus.kind !== 'degraded')
const explanationModeLabel = computed(() => explanationLoading.value ? 'Generating' : canUseAiAnalysis.value && !explanationError.value ? getAiModeLabel(store.settings) : 'Built-in analysis')

const selectedDateLabel = computed(() => (
  selectedDateKey.value === todayKey.value
    ? `Today, ${formatDateKeyLabel(selectedDateKey.value, { weekday: 'long', month: 'short', day: 'numeric' })}`
    : formatDateKeyLabel(selectedDateKey.value, { weekday: 'long', month: 'short', day: 'numeric' })
))
const canMoveForward = computed(() => selectedDateKey.value < todayKey.value)
const isSelectedToday = computed(() => selectedDateKey.value === todayKey.value)
const heroStats = computed(() => ([
  { label: 'Focus average', value: dailyAnalysisModel.value.focusAverage ? `${dailyAnalysisModel.value.focusAverage}/100` : '--' },
  { label: 'Combined fatigue', value: `${dailyAnalysisModel.value.combinedFatigue || 0}%` },
  { label: 'Tasks completed', value: String(completedTasks.value.length) },
  { label: 'Top app', value: dailyAnalysisModel.value.topApp?.app || 'None' },
]))
const fatigueCards = computed(() => {
  if (activeSourceMode.value === 'session') {
    return [
      { label: 'Session fatigue', value: `${dailyAnalysisModel.value.sessionFatigueAverage || 0}%`, detail: `${daySessions.value.length} focus session${daySessions.value.length === 1 ? '' : 's'}` },
      { label: 'Weakest session', value: dailyAnalysisModel.value.weakestSession?.goal || dailyAnalysisModel.value.weakestSession?.taskTitle || 'No weak session', detail: dailyAnalysisModel.value.weakestSession ? `${dailyAnalysisModel.value.weakestSession.fatigueScore || 0}% fatigue` : 'No session evidence yet' },
    ]
  }
  if (activeSourceMode.value === 'background') {
    return [
      { label: 'Background fatigue', value: `${dailyAnalysisModel.value.backgroundFatigue?.score || 0}%`, detail: dailyAnalysisModel.value.backgroundFatigue?.dominantDriver || 'No pressure driver yet' },
      { label: 'Switch pressure', value: String(dailyAnalysisModel.value.backgroundFatigue?.switches || 0), detail: 'Foreground window switches on this date' },
    ]
  }
  return [
    { label: 'Combined fatigue', value: `${dailyAnalysisModel.value.combinedFatigue || 0}%`, detail: 'Session strain blended with background pressure' },
    { label: 'Background fatigue', value: `${dailyAnalysisModel.value.backgroundFatigue?.score || 0}%`, detail: dailyAnalysisModel.value.backgroundFatigue?.dominantDriver || 'No pressure driver yet' },
    { label: 'Session fatigue', value: `${dailyAnalysisModel.value.sessionFatigueAverage || 0}%`, detail: `${daySessions.value.length} focus session${daySessions.value.length === 1 ? '' : 's'}` },
  ]
})

function formatCompactDuration(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0)
  if (!safe) return '0m'
  if (safe < 60) return `${Math.round(safe)}s`
  if (safe < 3600) return `${Math.round(safe / 60)}m`
  const hours = Math.floor(safe / 3600)
  const minutes = Math.round((safe % 3600) / 60)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function averageNumbers(values = []) {
  const safeValues = values
    .map((value) => Number(value) || 0)
    .filter((value) => Number.isFinite(value))
  return safeValues.length
    ? Math.round(safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length)
    : 0
}

function formatSessionTimeLabel(timestamp = 0, durationSeconds = 0) {
  if (!timestamp) return '--'
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const endTimestamp = Number(timestamp) + (Number(durationSeconds || 0) * 1000)
  return `${formatter.format(new Date(timestamp)).toLowerCase()} - ${formatter.format(new Date(endTimestamp)).toLowerCase()}`
}

function formatLastSeen(timestamp = 0) {
  if (!timestamp) return '--'
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(timestamp)).toLowerCase()
}

function formatLaneLabel(lane = '') {
  return getTrackingLaneMeta(lane).label
}

function withAlpha(color = '#0ea5e9', alpha = 1) {
  const hex = String(color || '').replace('#', '').trim()
  if (hex.length !== 6) return color
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function rangesOverlap(startA = 0, endA = 0, startB = 0, endB = 0) {
  return Math.max(Number(startA || 0), Number(startB || 0)) < Math.min(Number(endA || 0), Number(endB || 0))
}

function filterEntriesByRange(entries = [], startTs = 0, endTs = 0, padMs = 0) {
  const start = Math.max(0, Number(startTs || 0) - Number(padMs || 0))
  const end = Math.max(start, Number(endTs || 0) + Number(padMs || 0))
  return entries.filter((entry) => {
    const entryStart = Number(entry?.ts || 0)
    const entryEnd = Number(entry?.endTs || (entryStart + ((Number(entry?.duration || 0) || 0) * 1000)))
    return rangesOverlap(entryStart, entryEnd, start, end)
  })
}

function filterBrowserEventsByRange(events = [], startTs = 0, endTs = 0, padMs = 0) {
  const start = Math.max(0, Number(startTs || 0) - Number(padMs || 0))
  const end = Math.max(start, Number(endTs || 0) + Number(padMs || 0))
  return events.filter((entry) => {
    const ts = Number(entry?.ts || 0)
    return ts >= start && ts <= end
  })
}

function getLaneStyle(lane = 'unclear') {
  const meta = getTrackingLaneMeta(lane)
  return {
    '--lane-soft': meta.soft,
    '--lane-strong': meta.strong,
    '--lane-color': meta.color,
    '--lane-accent': meta.accent,
    '--lane-gradient': `linear-gradient(90deg, ${meta.gradientFrom}, ${meta.gradientTo})`,
  }
}

function formatHourLabel(hour = 0) {
  const safe = Math.max(0, Math.min(23, Number(hour) || 0))
  if (safe === 0) return '12a'
  if (safe < 12) return `${safe}a`
  if (safe === 12) return '12p'
  return `${safe - 12}p`
}

function formatBrowserEventType(type = '') {
  const normalized = String(type || '').trim().toLowerCase()
  if (normalized === 'tab-activated') return 'Switched tab'
  if (normalized === 'tab-created') return 'Opened tab'
  if (normalized === 'tab-removed') return 'Closed tab'
  if (normalized === 'tab-updated') return 'Updated page'
  if (normalized === 'window-focus') return 'Focused browser'
  if (normalized === 'manual-refresh') return 'Manual sync'
  if (normalized === 'tab-attached') return 'Moved tab'
  if (normalized === 'tab-detached') return 'Detached tab'
  return 'Browser event'
}

function formatShare(seconds = 0, total = 0) {
  if (!total) return '0%'
  return `${Math.round((Number(seconds || 0) / total) * 100)}%`
}

function truncateLabel(label = '', max = 28) {
  const safe = String(label || '').trim()
  if (safe.length <= max) return safe
  return `${safe.slice(0, Math.max(0, max - 3))}...`
}

function escapeTooltipHtml(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getFocusSessionIdFromEvent(event = null) {
  const eventId = String(event?.id || '')
  if (eventId.startsWith('focus-start-')) return eventId.slice('focus-start-'.length)
  if (eventId.startsWith('focus-end-')) return eventId.slice('focus-end-'.length)
  if (eventId.startsWith('fatigue-session-')) return eventId.slice('fatigue-session-'.length)
  return ''
}

function getFatigueState(score = 0) {
  const safe = Math.max(0, Math.round(Number(score) || 0))
  if (safe >= 72) return { label: 'Overloaded', tone: 'rose' }
  if (safe >= 56) return { label: 'Strained', tone: 'amber' }
  if (safe >= 36) return { label: 'Rising', tone: 'blue' }
  return { label: 'Stable', tone: 'teal' }
}

function formatDriverLabel(key = '') {
  return String(key || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (value) => value.toUpperCase())
    .trim()
}


const appUsageStats = computed(() => {
  const topApp = appsByTime.value[0] || null
  const recentApp = appsByRecent.value[0] || null
  const topMedia = mediaContext.value[0] || null
  const trackedSeconds = Number(diagnostics.value.trackedSeconds || dayRangeModel.value.trackedSeconds || 0)
  const browserSeconds = browserSites.value.reduce((sum, site) => sum + Number(site.seconds || 0), 0)
  const mediaSeconds = mediaContext.value.reduce((sum, media) => sum + Number(media.seconds || 0), 0)
  const switchCount = appsByTime.value.reduce((sum, app) => sum + Number(app.switches || 0), 0)

  return {
    trackedSeconds,
    topApp,
    recentApp,
    topMedia,
    browserSeconds,
    mediaSeconds,
    switchCount,
    tabSwitches: Number(browserEventSummary.value.tabSwitches || 0),
    tabsOpened: Number(browserEventSummary.value.tabsOpened || 0),
    audibleMoments: Number(browserEventSummary.value.audibleMoments || 0),
    appCount: appsByTime.value.length,
    browserCount: browserSites.value.length,
    categoryCount: categoryBreakdown.value.length,
    confidence: Math.round((Number(diagnostics.value.avgConfidence || 0) || 0) * 100),
  }
})

const appUsageHighlights = computed(() => ([
  {
    label: 'Top app',
    value: appUsageStats.value.topApp?.app || 'No app yet',
    detail: appUsageStats.value.topApp
      ? `${formatActivityDuration(appUsageStats.value.topApp.seconds || 0)} - ${appUsageStats.value.topApp.category}`
      : 'No captured background app usage for this day',
    tone: 'teal',
  },
  {
    label: 'Most recent',
    value: appUsageStats.value.recentApp?.app || 'No recent app yet',
    detail: appUsageStats.value.recentApp
      ? `Last seen ${formatLastSeen(appUsageStats.value.recentApp.lastTs)} - ${appUsageStats.value.switchCount || 0} switches across ${appUsageStats.value.appCount || 0} apps`
      : 'No captured background app usage for this day',
    tone: 'slate',
  },
  {
    label: 'Browser context',
    value: formatCompactDuration(appUsageStats.value.browserSeconds || 0),
    detail: `${appUsageStats.value.browserCount || 0} distinct hosts kept separate from app totals`,
    tone: 'violet',
  },
  {
    label: 'Background media',
    value: formatCompactDuration(appUsageStats.value.mediaSeconds || 0),
    detail: appUsageStats.value.topMedia
      ? `${appUsageStats.value.topMedia.sourceApp} - ${truncateLabel(appUsageStats.value.topMedia.label, 26)}`
      : 'No overlapping media playback detected',
    tone: 'amber',
  },
]))

const topAppsForVisual = computed(() => appsList.value.slice(0, 8))
const appUsageMaxSeconds = computed(() => Math.max(...topAppsForVisual.value.map((app) => Number(app.seconds || 0)), 1))
const appUsageCards = computed(() => topAppsForVisual.value.map((app) => ({
  ...app,
  share: formatShare(app.seconds, appUsageStats.value.trackedSeconds || 0),
  progress: Math.max(12, Math.round((Number(app.seconds || 0) / appUsageMaxSeconds.value) * 100)),
  isBrowserDriven: Number(app.browserContextCount || 0) > 0 || Number(app.browserShare || 0) >= 0.35,
})))

const appCategoryRows = computed(() => categoryBreakdown.value
  .slice(0, 5)
  .map((category) => ({
    ...category,
    share: formatShare(category.seconds, appUsageStats.value.trackedSeconds || 0),
  })))

const browserCards = computed(() => browserSites.value.slice(0, 6))
const mediaCards = computed(() => mediaContext.value.slice(0, 4))
const diagnosticsCards = computed(() => ([
  { label: 'Confidence', value: `${appUsageStats.value.confidence || 0}%` },
  { label: 'Chunks', value: String(diagnostics.value.chunkCount || 0) },
  { label: 'Browser hosts', value: String(diagnostics.value.uniqueBrowserHosts || 0) },
  { label: 'Tab switches', value: String(browserEventSummary.value.tabSwitches || 0) },
  { label: 'Tabs opened', value: String(browserEventSummary.value.tabsOpened || 0) },
  { label: 'Audible moments', value: String(browserEventSummary.value.audibleMoments || 0) },
  { label: 'Custom rules', value: String(diagnostics.value.customRuleChunks || 0) },
]))
const browserSignalCards = computed(() => ([
  {
    label: 'Tab switches',
    value: String(browserEventSummary.value.tabSwitches || 0),
    detail: browserEventSummary.value.tabSwitches ? 'Captured from tab activation and browser focus events' : 'No browser switch signal on this date',
  },
  {
    label: 'Tabs opened',
    value: String(browserEventSummary.value.tabsOpened || 0),
    detail: browserEventSummary.value.tabsOpened ? 'New browser tabs created on this date' : 'No new browser tabs opened on this date',
  },
  {
    label: 'Audible moments',
    value: String(browserEventSummary.value.audibleMoments || 0),
    detail: browserEventSummary.value.latestAudible?.host || browserEventSummary.value.latestAudible?.browserApp
      ? `Latest audible context: ${browserEventSummary.value.latestAudible.host || browserEventSummary.value.latestAudible.browserApp}`
      : 'No audible browser context captured',
  },
  {
    label: 'Tracked hosts',
    value: String(browserEventSummary.value.uniqueHosts || 0),
    detail: browserEventSummary.value.uniqueHosts ? 'Distinct browser hosts stored from the extension bridge' : 'No host-level browser evidence yet',
  },
]))
const recentBrowserEventRows = computed(() => ambient.getRecentBrowserEvents(browserEvents.value, { limit: 6 }).map((entry) => ({
  ...entry,
  timeLabel: formatLastSeen(entry.ts),
  eventLabel: formatBrowserEventType(entry.eventType),
  title: entry.pageTitle || entry.host || entry.browserApp || 'Browser event',
  detail: entry.host || entry.browserApp || 'Browser context',
  laneKey: entry.lane || 'unclear',
  laneLabel: formatLaneLabel(entry.lane || 'unclear'),
})))
const activeCustomRule = computed(() => customRules.value[String(ruleTarget.value || '').trim().toLowerCase()] || null)
const browserSiteExplorer = computed(() => ambient.getBrowserContextBreakdown(backgroundEntries.value, {
  groupBy: 'host',
  sortBy: browserSortMode.value,
}))
const browserPageExplorer = computed(() => ambient.getBrowserContextBreakdown(backgroundEntries.value, {
  groupBy: 'page',
  sortBy: browserSortMode.value,
}))
const usageExplorerSortOptions = computed(() => (
  usageExplorerMode.value === 'apps'
    ? appSortOptions
    : usageExplorerMode.value === 'media'
      ? mediaSortOptions
      : browserSortOptions
))
const usageExplorerRows = computed(() => {
  if (usageExplorerMode.value === 'apps') {
    return appsList.value.map((app) => ({
      isBrowserDriven: Number(app.browserContextCount || 0) > 0 || Number(app.browserShare || 0) >= 0.35,
      id: `app-${app.app}`,
      title: app.app,
    subtitle: `${app.category} - ${formatLaneLabel(app.dominantLane)}`,
      helper: app.contextLabel || app.subcategory || 'No dominant context',
      seconds: app.seconds,
      switches: app.switches,
      confidence: app.confidence,
      lastTs: app.lastTs,
      lane: app.dominantLane,
      color: app.color,
      correctionTarget: app.app,
      correctionLabel: app.app,
      correctionSource: 'app',
      correctionCategory: app.category,
      correctionLane: app.dominantLane,
      correctionBlocked: Number(app.browserContextCount || 0) > 0 || Number(app.browserShare || 0) >= 0.35,
      correctionNote: (Number(app.browserContextCount || 0) > 0 || Number(app.browserShare || 0) >= 0.35) ? 'Use site/page correction' : '',
    }))
  }

  if (usageExplorerMode.value === 'sites' || usageExplorerMode.value === 'pages') {
    const rows = usageExplorerMode.value === 'sites' ? browserSiteExplorer.value : browserPageExplorer.value
    return rows.map((row) => ({
      id: `${usageExplorerMode.value}-${row.label}`,
      title: row.label,
    subtitle: `${row.app} - ${row.category} - ${formatLaneLabel(row.dominantLane)}`,
      helper: `${Math.round((Number(row.confidence || 0) || 0) * 100)}% confidence`,
      seconds: row.seconds,
      switches: row.switches,
      confidence: row.confidence,
      lastTs: row.lastTs,
      lane: row.dominantLane,
      color: row.color,
      correctionTarget: usageExplorerMode.value === 'pages' ? (row.host || row.label) : (row.host || row.label),
      correctionLabel: row.label,
      correctionSource: usageExplorerMode.value === 'pages' ? 'page' : 'host',
      correctionCategory: row.category,
      correctionLane: row.dominantLane,
      correctionBlocked: false,
      correctionNote: '',
    }))
  }

  return mediaContext.value.map((media) => ({
    id: `media-${media.label}`,
    title: media.label,
    subtitle: `${media.sourceApp} - ${media.category} - ${formatLaneLabel(media.lane)}`,
    helper: media.artist ? `${media.artist}${media.lastTs ? ` - seen ${formatLastSeen(media.lastTs)}` : ''}` : `Seen ${formatLastSeen(media.lastTs)}`,
    seconds: media.seconds,
    switches: 0,
    confidence: 1,
    lastTs: media.lastTs,
    lane: media.lane,
    color: media.color,
    correctionTarget: media.sourceApp,
    correctionLabel: media.sourceApp,
    correctionSource: 'media',
    correctionCategory: media.category,
    correctionLane: media.lane,
    correctionBlocked: false,
    correctionNote: '',
  }))
})
const filteredUsageExplorerRows = computed(() => {
  const query = String(usageExplorerQuery.value || '').trim().toLowerCase()
  const laneFilter = String(usageExplorerLaneFilter.value || 'all')
  return usageExplorerRows.value.filter((row) => {
    const queryMatch = !query || [
      row.title,
      row.subtitle,
      row.helper,
      row.lane,
    ].some((value) => String(value || '').toLowerCase().includes(query))
    const laneMatch = laneFilter === 'all' || String(row.lane || '') === laneFilter
    return queryMatch && laneMatch
  })
})
const filteredUsageExplorerMaxSeconds = computed(() => Math.max(...filteredUsageExplorerRows.value.map((row) => Number(row.seconds || 0)), 1))
const usageExplorerMaxSeconds = computed(() => Math.max(...usageExplorerRows.value.map((row) => Number(row.seconds || 0)), 1))
const usageExplorerStats = computed(() => {
  const topRow = usageExplorerRows.value[0] || null
  const totalSeconds = usageExplorerRows.value.reduce((sum, row) => sum + Number(row.seconds || 0), 0)
  const avgConfidence = usageExplorerRows.value.length
    ? Math.round((usageExplorerRows.value.reduce((sum, row) => sum + (Number(row.confidence || 0) || 0), 0) / usageExplorerRows.value.length) * 100)
    : 0
  return [
    { label: 'Rows', value: String(usageExplorerRows.value.length) },
    { label: 'Tracked', value: formatCompactDuration(totalSeconds) },
    { label: 'Avg confidence', value: `${avgConfidence}%` },
    { label: 'Lead item', value: topRow?.title || 'None' },
  ]
})

const backgroundFocusWindowsDetailed = computed(() => (dailyAnalysisModel.value.backgroundFocusWindows || []).map((window) => {
  const completedTaskTitles = completedTasks.value
    .filter((task) => {
      const completedAt = Number(task.completedAt || task.updatedAt || 0)
      return completedAt > 0
        && completedAt >= Number(window.startTs || 0)
        && completedAt <= (Number(window.endTs || 0) + (15 * 60 * 1000))
    })
    .map((task) => task.title)
  const mixTotal = [
    Number(window.productiveSeconds || 0),
    Number(window.supportingSeconds || 0),
    Number(window.unclearSeconds || 0),
    Number(window.distractingSeconds || 0),
  ].reduce((sum, value) => sum + value, 0)
  const displayTitle = window.title || window.graphLabel || window.contextLabel || window.leadApp || 'Background work window'
  const contextSubtitle = window.subtitle || (
    window.contextLabel && window.contextLabel !== displayTitle
      ? window.contextLabel
      : ''
  )

  return {
    ...window,
    completedTaskTitles,
    completedTaskCount: completedTaskTitles.length,
    durationLabel: formatActivityDuration(window.durationSeconds || 0),
    leadApp: window.leadApp || window.title || 'Background work window',
    title: displayTitle,
    subtitle: contextSubtitle,
    graphLabel: window.graphLabel || displayTitle,
    timeLabel: window.timeLabel || formatSessionTimeLabel(window.startTs, window.durationSeconds),
    mixSegments: mixTotal > 0
      ? ['productive', 'supporting', 'unclear', 'distracting']
        .map((lane) => ({
          key: lane,
          color: TRACKING_LANE_META[lane].color,
          share: Math.max(4, Math.round((Number(window[`${lane}Seconds`] || 0) / mixTotal) * 100)),
          seconds: Number(window[`${lane}Seconds`] || 0),
        }))
        .filter((segment) => segment.seconds > 0)
      : [],
    browserSignals: window.browserSignals || {},
    browserPressureScore: Number(window.browserPressureScore || window.browserSignals?.pressureScore || 0),
    browserPressureLabel: window.browserPressureLabel || window.browserSignals?.dominantPressureLabel || 'Quiet browser context',
    precisionState: window.precisionState || null,
    calmScore: Number(window.calmScore || 0),
    recoveryQuality: Number(window.recoveryQuality || 0),
    recoveryState: window.recoveryState || 'strained',
    isCalmWindow: Boolean(window.isCalmWindow),
    primaryDisruptionLabel: 'Distracting share',
    primaryDisruptionValue: `${Math.round(((Number(window.distractingSeconds || 0) / Math.max(1, mixTotal)) || 0) * 100)}%`,
    tone: Number(window.focusScore || 0) >= 78 ? 'strong' : Number(window.focusScore || 0) >= 60 ? 'steady' : 'strained',
  }
}))

const focusSessionsDetailed = computed(() => daySessions.value.map((session) => {
  const start = Number(session.timestamp || session.createdAt || 0)
  const durationSeconds = Number(session.durationSeconds || 0)
  const end = start + (durationSeconds * 1000)
  const completedTaskTitles = completedTasks.value
    .filter((task) => {
      const completedAt = Number(task.completedAt || task.updatedAt || 0)
      return String(task.id || '') === String(session.linkedTaskId || '')
        || (completedAt > 0 && start > 0 && completedAt >= start && completedAt <= (end + (15 * 60 * 1000)))
    })
    .map((task) => task.title)
  const fatigueDrivers = session.fatigueDrivers || {}
  const topFatigueDriver = Object.entries(fatigueDrivers)
    .sort((left, right) => (Number(right[1]) || 0) - (Number(left[1]) || 0))[0]
  const mixTotal = [
    Number(session.productiveSeconds || 0),
    Number(session.supportingSeconds || 0),
    Number(session.unclearSeconds || 0),
    Number(session.distractingSeconds || 0),
  ].reduce((sum, value) => sum + value, 0)

  return {
    ...session,
    timeLabel: formatSessionTimeLabel(start, durationSeconds),
    leadApp: session.primaryApp || session.primaryContext || session.appBreakdown?.[0]?.app || 'No dominant app',
    completedTaskTitles,
    completedTaskCount: completedTaskTitles.length,
    topFatigueDriverLabel: topFatigueDriver?.[0]
      ? topFatigueDriver[0].replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase()).trim()
      : 'No dominant fatigue driver',
    pillars: {
      presence: Number(session.pillarScores?.presence || 0),
      activity: Number(session.pillarScores?.activity || 0),
      continuity: Number(session.pillarScores?.continuity || 0),
      stability: Number(session.pillarScores?.stability || 0),
    },
    durationLabel: formatActivityDuration(durationSeconds),
    mixSegments: mixTotal > 0
      ? ['productive', 'supporting', 'unclear', 'distracting']
        .map((lane) => ({
          key: lane,
          color: TRACKING_LANE_META[lane].color,
          share: Math.max(4, Math.round((Number(session[`${lane}Seconds`] || 0) / mixTotal) * 100)),
          seconds: Number(session[`${lane}Seconds`] || 0),
        }))
        .filter((segment) => segment.seconds > 0)
      : [],
    browserSignals: session.browserSignals || {},
    browserPressureScore: Number(session.browserPressureScore || session.browserSignals?.pressureScore || 0),
    browserPressureLabel: session.browserPressureLabel || session.browserSignals?.dominantPressureLabel || 'Quiet browser context',
    precisionState: session.precisionState || null,
    calmScore: Number(session.calmScore || 0),
    recoveryQuality: Number(session.recoveryQuality || 0),
    recoveryState: session.recoveryState || 'strained',
    isCalmWindow: Boolean(session.isCalmWindow),
    primaryDisruptionLabel: 'Distractions',
    primaryDisruptionValue: Number(session.distractions || 0),
    tone: Number(session.focusScore || 0) >= 78 ? 'strong' : Number(session.focusScore || 0) >= 60 ? 'steady' : 'strained',
  }
}))

const focusSessionStats = computed(() => ({
  totalMinutes: Math.round(focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.durationSeconds || 0), 0) / 60),
  totalDistractions: focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.distractions || 0), 0),
  totalDrift: focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.driftCount || 0), 0),
  totalRecovery: focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.recoveryCount || 0), 0),
  completedTaskCount: focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.completedTaskCount || 0), 0),
  averageSwitchRate: focusSessionsDetailed.value.length ? Number((focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.switchRate || 0), 0) / focusSessionsDetailed.value.length).toFixed(1)) : 0,
  browserSwitches: focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.browserSignals?.tabSwitches || 0), 0),
  tabsOpened: focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.browserSignals?.tabsOpened || 0), 0),
  audibleMoments: focusSessionsDetailed.value.reduce((sum, session) => sum + Number(session.browserSignals?.audibleMoments || 0), 0),
  peakBrowserPressure: Math.max(0, ...focusSessionsDetailed.value.map((session) => Number(session.browserPressureScore || 0))),
}))

const backgroundDepthStats = computed(() => ({
  totalMinutes: Math.round(backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.durationSeconds || 0), 0) / 60),
  totalDistractions: backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.distractingSeconds || 0), 0),
  totalDrift: backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.driftCount || 0), 0),
  totalRecovery: backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.recoveryCount || 0), 0),
  completedTaskCount: backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.completedTaskCount || 0), 0),
  averageSwitchRate: backgroundFocusWindowsDetailed.value.length ? Number((backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.switchRate || 0), 0) / backgroundFocusWindowsDetailed.value.length).toFixed(1)) : 0,
  browserSwitches: backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.browserSignals?.tabSwitches || 0), 0),
  tabsOpened: backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.browserSignals?.tabsOpened || 0), 0),
  audibleMoments: backgroundFocusWindowsDetailed.value.reduce((sum, window) => sum + Number(window.browserSignals?.audibleMoments || 0), 0),
  peakBrowserPressure: Math.max(0, ...backgroundFocusWindowsDetailed.value.map((window) => Number(window.browserPressureScore || 0))),
}))

const focusDepthEntries = computed(() => activeSourceMode.value === 'background' ? backgroundFocusWindowsDetailed.value : focusSessionsDetailed.value)
const focusDepthStats = computed(() => activeSourceMode.value === 'background' ? backgroundDepthStats.value : focusSessionStats.value)

watch(
  () => [activeTab.value, focusSessionsDetailed.value.length, backgroundFocusWindowsDetailed.value.length, activeSourceMode.value].join(':'),
  () => {
    if (activeTab.value !== 'focus') return
    if (activeSourceMode.value === 'session' && !focusSessionsDetailed.value.length && backgroundFocusWindowsDetailed.value.length) {
      sourceModeByTab.value = { ...sourceModeByTab.value, focus: 'background' }
      return
    }
    if (activeSourceMode.value === 'background' && !backgroundFocusWindowsDetailed.value.length && focusSessionsDetailed.value.length) {
      sourceModeByTab.value = { ...sourceModeByTab.value, focus: 'session' }
    }
  },
  { immediate: true },
)

const focusHighlightCards = computed(() => (
  activeSourceMode.value === 'background'
    ? [
        {
          label: 'Strongest window',
          value: dailyAnalysisModel.value.strongestBackgroundWindow?.title || 'No calm window',
          detail: dailyAnalysisModel.value.strongestBackgroundWindow
            ? `${dailyAnalysisModel.value.strongestBackgroundWindow.focusScore || 0}/100 depth - ${formatActivityDuration(dailyAnalysisModel.value.strongestBackgroundWindow.durationSeconds || 0)}`
            : 'No qualifying background depth window yet',
          tone: 'teal',
        },
        {
          label: 'Deep-work time',
          value: formatCompactDuration(backgroundDepthStats.value.totalMinutes * 60),
          detail: `${backgroundFocusWindowsDetailed.value.length} ${dailyAnalysisModel.value.backgroundWindowThresholdMode === 'relaxed' ? 'relaxed-fit' : 'qualifying'} window${backgroundFocusWindowsDetailed.value.length === 1 ? '' : 's'}`,
          tone: 'blue',
        },
        {
          label: 'Drift vs recovery',
          value: `${backgroundDepthStats.value.totalDrift} / ${backgroundDepthStats.value.totalRecovery}`,
          detail: 'Noise shifts versus regained steady depth across passive work windows',
          tone: 'rose',
        },
        {
          label: 'Browser pressure',
          value: `${backgroundDepthStats.value.browserSwitches || 0} switches`,
          detail: backgroundDepthStats.value.audibleMoments
            ? `${backgroundDepthStats.value.audibleMoments} audible moments - peak pressure ${backgroundDepthStats.value.peakBrowserPressure || 0}/100`
            : `${backgroundDepthStats.value.tabsOpened || 0} tabs opened - peak pressure ${backgroundDepthStats.value.peakBrowserPressure || 0}/100`,
          tone: 'amber',
        },
      ]
    : [
        {
          label: 'Strongest block',
          value: dailyAnalysisModel.value.strongestSession?.goal || dailyAnalysisModel.value.strongestSession?.taskTitle || dailyAnalysisModel.value.strongestSession?.habit || 'No focus block',
          detail: dailyAnalysisModel.value.strongestSession
            ? `${dailyAnalysisModel.value.strongestSession.focusScore || 0}/100 focus - ${formatActivityDuration(dailyAnalysisModel.value.strongestSession.durationSeconds || 0)}`
            : 'No focus evidence on this date',
          tone: 'teal',
        },
        {
          label: 'Focused time',
          value: formatCompactDuration(focusSessionStats.value.totalMinutes * 60),
          detail: `${focusSessionsDetailed.value.length} recorded session${focusSessionsDetailed.value.length === 1 ? '' : 's'}`,
          tone: 'blue',
        },
        {
          label: 'Drift vs recovery',
          value: `${focusSessionStats.value.totalDrift} / ${focusSessionStats.value.totalRecovery}`,
          detail: 'Drift moments versus recovery moments across the day',
          tone: 'rose',
        },
        {
          label: 'Browser pressure',
          value: `${focusSessionStats.value.browserSwitches || 0} switches`,
          detail: focusSessionStats.value.audibleMoments
            ? `${focusSessionStats.value.audibleMoments} audible moments - peak pressure ${focusSessionStats.value.peakBrowserPressure || 0}/100`
            : `${focusSessionStats.value.tabsOpened || 0} tabs opened - peak pressure ${focusSessionStats.value.peakBrowserPressure || 0}/100`,
          tone: 'amber',
        },
      ]
))

function getFocusTargetIdFromEvent(event = null) {
  if (event?.linkedTab === 'focus' && event?.linkedEntityId) return String(event.linkedEntityId)
  return getFocusSessionIdFromEvent(event)
}

const selectedFocusSession = computed(() => {
  const explicitSelection = focusDepthEntries.value.find((entry) => String(entry.id) === String(focusSessionSelectionId.value))
  if (explicitSelection) return explicitSelection
  const eventSelectionId = getFocusTargetIdFromEvent(selectedEvent.value)
  if (eventSelectionId) {
    const fromEvent = focusDepthEntries.value.find((entry) => String(entry.id) === String(eventSelectionId))
    if (fromEvent) return fromEvent
  }
  if (activeSourceMode.value === 'background') {
    const strongestId = String(dailyAnalysisModel.value.strongestBackgroundWindow?.id || '')
    return focusDepthEntries.value.find((entry) => String(entry.id) === strongestId)
      || focusDepthEntries.value[0]
      || null
  }
  const strongestId = String(dailyAnalysisModel.value.strongestSession?.id || '')
  return focusDepthEntries.value.find((entry) => String(entry.id) === strongestId)
    || focusDepthEntries.value[0]
    || null
})

function getFocusDepthEntryFromIndex(index = -1) {
  const safeIndex = Number(index)
  if (!Number.isInteger(safeIndex) || safeIndex < 0) return null
  return focusDepthEntries.value[safeIndex] || null
}

function selectFocusDepthFromChart(index = -1) {
  const entry = getFocusDepthEntryFromIndex(index)
  if (!entry) return
  selectFocusSession(entry)
}

const selectedFocusRange = computed(() => {
  const session = selectedFocusSession.value
  if (!session) return null
  if (activeSourceMode.value === 'background') {
    return {
      startTs: Number(session.startTs || 0),
      endTs: Number(session.endTs || 0),
    }
  }
  const startTs = Number(session.timestamp || session.createdAt || 0)
  const endTs = startTs + (Number(session.durationSeconds || 0) * 1000)
  return { startTs, endTs }
})

const selectedFocusAmbientEntries = computed(() => {
  if (!selectedFocusRange.value) return []
  return filterEntriesByRange(backgroundEntries.value, selectedFocusRange.value.startTs, selectedFocusRange.value.endTs, 15 * 1000)
})

const selectedFocusBrowserEvents = computed(() => {
  if (!selectedFocusRange.value) return []
  return filterBrowserEventsByRange(browserEvents.value, selectedFocusRange.value.startTs, selectedFocusRange.value.endTs, 30 * 1000)
})

const selectedFocusEvidence = computed(() => {
  const session = selectedFocusSession.value
  if (session?.rangeEvidence) return session.rangeEvidence
  if (!selectedFocusRange.value) return null
  return buildRangeEvidenceBundle({
    ambientEntries: backgroundEntries.value,
    browserEvents: browserEvents.value,
    startTs: selectedFocusRange.value.startTs,
    endTs: selectedFocusRange.value.endTs,
    ambientPadMs: 15 * 1000,
    browserPadMs: 30 * 1000,
    limit: 4,
  })
})

const selectedFocusAppEvidenceRowsShared = computed(() => (selectedFocusEvidence.value?.topApps || [])
  .slice(0, 4)
  .map((app) => ({
    id: `focus-evidence-${app.app}`,
    label: app.app,
    lane: formatLaneLabel(app.dominantLane),
    laneKey: app.dominantLane,
    duration: formatActivityDuration(app.seconds || 0),
    note: [
      app.sourceApp && app.sourceApp !== app.app ? app.sourceApp : '',
      `${app.switches || 0} switches - ${Math.round((Number(app.confidence || 0) || 0) * 100)}% confidence`,
    ].filter(Boolean).join(' - '),
    context: app.contextLabel || app.category || 'No dominant context',
  })))

const selectedFocusBrowserEvidenceRowsShared = computed(() => (selectedFocusEvidence.value?.recentBrowserEvents || [])
  .map((entry) => ({
    id: entry.id || `${entry.eventType}-${entry.ts}`,
    label: entry.pageTitle || entry.host || entry.browserApp || 'Browser signal',
    note: `${entry.browserApp || 'Browser'} - ${entry.host || 'No host'} - ${formatLastSeen(entry.ts || 0)}`,
    badge: entry.audible
      ? `Audible - ${formatLaneLabel(entry.lane || 'unclear')}`
      : `${entry.eventLabel || entry.eventType || 'Event'} - ${formatLaneLabel(entry.lane || 'unclear')}`,
  })))

const selectedFocusAppEvidenceRows = computed(() => ambient.getAppBreakdown(selectedFocusAmbientEntries.value, { sortBy: 'seconds' })
  .slice(0, 4)
  .map((app) => ({
    id: `focus-app-${app.app}`,
    label: app.app,
    lane: formatLaneLabel(app.dominantLane),
    laneKey: app.dominantLane,
    duration: formatActivityDuration(app.seconds || 0),
    note: `${app.switches || 0} switches - ${Math.round((Number(app.confidence || 0) || 0) * 100)}% confidence`,
    context: app.contextLabel || app.subcategory || app.category || 'No dominant context',
  })))

const selectedFocusBrowserEvidenceRows = computed(() => ambient.getRecentBrowserEvents(selectedFocusBrowserEvents.value, { limit: 4 })
  .map((entry) => ({
    id: entry.id || `${entry.eventType}-${entry.ts}`,
    label: entry.pageTitle || entry.host || entry.browserApp || 'Browser signal',
    note: `${entry.browserApp || 'Browser'} - ${entry.host || 'No host'} - ${formatLastSeen(entry.ts || 0)}`,
    badge: entry.audible
      ? `Audible - ${formatLaneLabel(entry.lane || 'unclear')}`
      : `${entry.eventLabel || entry.eventType || 'Event'} - ${formatLaneLabel(entry.lane || 'unclear')}`,
  })))

const focusScoreEvidenceRows = computed(() => {
  const session = selectedFocusSession.value
  if (!session) return []
  const totalSeconds = Math.max(1,
    Number(session.productiveSeconds || 0)
    + Number(session.supportingSeconds || 0)
    + Number(session.unclearSeconds || 0)
    + Number(session.distractingSeconds || 0)
    || Number(session.durationSeconds || 0),
  )
  const favorableShare = Math.round((((Number(session.productiveSeconds || 0) + Number(session.supportingSeconds || 0)) / totalSeconds) || 0) * 100)
  const disruptiveShare = Math.round((((Number(session.unclearSeconds || 0) + Number(session.distractingSeconds || 0)) / totalSeconds) || 0) * 100)
  const precisionState = session.precisionState || null
  return [
    {
      label: 'Precision',
      value: precisionState?.label || `${Number(session.analysisConfidenceScore || 0)}/100`,
      note: precisionState?.detail || `${Number(session.analysisConfidenceScore || 0)}% confidence across measured slices`,
      info: 'Precision tells you how strongly this block was measured from saved evidence, instead of being lightly inferred from sparse context.',
    },
    {
      label: 'Presence',
      value: `${Number(session.pillars?.presence || 0)}/100`,
      note: `${favorableShare}% favorable lane share across ${session.durationLabel || formatActivityDuration(session.durationSeconds || 0)}`,
      info: 'Presence reflects how much of this window stayed in clearly measured, favorable work instead of gaps or scattered context.',
    },
    {
      label: 'Activity',
      value: `${Number(session.pillars?.activity || 0)}/100`,
      note: `${truncateLabel(session.leadApp || 'No lead app', 28)} led the active context`,
      info: 'Activity reflects measured work intensity, lane quality, and whether the block looked like real engaged work rather than passive presence.',
    },
    {
      label: 'Continuity',
      value: `${Number(session.pillars?.continuity || 0)}/100`,
      note: `${session.switchRate || 0}/min app switching${session.browserSignals?.tabSwitches ? ` - ${session.browserSignals.tabSwitches} browser switches` : ''}`,
      info: 'Continuity drops when app switching, tab switching, or reopened contexts fragment the block too often.',
    },
    {
      label: 'Stability',
      value: `${Number(session.pillars?.stability || 0)}/100`,
      note: `${disruptiveShare}% unclear or distracting share${session.browserPressureScore ? ` - browser pressure ${session.browserPressureScore}/100` : ''}`,
      info: 'Stability measures how well the block held one coherent lane instead of drifting into unclear or distracting work.',
    },
  ]
})

const focusReadoutChips = computed(() => {
  const session = selectedFocusSession.value
  if (!session) return []
  const browserSummary = session.browserSignals?.totalEvents
    ? [
        session.browserSignals.tabSwitches ? `${session.browserSignals.tabSwitches} switch${session.browserSignals.tabSwitches === 1 ? '' : 'es'}` : '',
        session.browserSignals.tabsOpened ? `${session.browserSignals.tabsOpened} opened` : '',
        session.browserSignals.audibleMoments ? `${session.browserSignals.audibleMoments} audible` : '',
      ].filter(Boolean).join(' - ')
    : 'Quiet browser context'
  return [
    { label: 'Lead app', value: session.leadApp },
    { label: 'Precision', value: session.precisionState?.label || 'Measured lightly' },
    { label: 'Browser pressure', value: session.browserPressureScore ? `${session.browserPressureScore}/100` : 'Quiet' },
    { label: 'Browser signal', value: browserSummary || session.browserPressureLabel },
    { label: 'Task wins', value: session.completedTaskCount ? `${session.completedTaskCount} completed` : 'No linked completions' },
    { label: 'Switch rate', value: `${session.switchRate || 0}/min` },
  ]
})

const focusComparisonTicks = [100, 75, 50, 25, 0]
const focusComparisonRows = computed(() => focusDepthEntries.value.map((entry) => {
  const focusScore = Math.max(0, Math.min(100, Number(entry.focusScore || 0)))
  const isSelected = String(selectedFocusSession.value?.id || '') === String(entry.id || '')
  return {
    id: String(entry.id || ''),
    label: truncateLabel(entry.graphLabel || entry.title || (activeSourceMode.value === 'background' ? 'Window' : 'Session'), 18),
    timeLabel: entry.timeLabel || '--',
    focusScore,
    isSelected,
    raw: entry,
  }
}))

const focusPillarSeriesMeta = [
  { key: 'presence', name: 'Presence', color: '#14b8a6' },
  { key: 'activity', name: 'Activity', color: '#38bdf8' },
  { key: 'continuity', name: 'Continuity', color: '#8b5cf6' },
  { key: 'stability', name: 'Stability', color: '#22c55e' },
]

const focusDayTimelinePositions = computed(() => {
  const dayStart = Number(selectedDayRange.value?.startMs || 0)
  const span = 24 * 60 * 60 * 1000
  return focusDepthEntries.value.map((entry) => {
    const startTs = activeSourceMode.value === 'background'
      ? Number(entry.startTs || 0)
      : Number(entry.timestamp || entry.createdAt || 0)
    const durationMs = Number(entry.durationSeconds || 0) * 1000
    const endTs = activeSourceMode.value === 'background'
      ? Number(entry.endTs || startTs + durationMs)
      : startTs + durationMs
    const left = ((startTs - dayStart) / span) * 100
    const width = Math.max(0.6, ((endTs - startTs) / span) * 100)
    return {
      id: String(entry.id || ''),
      left: `${Math.max(0, Math.min(99, left)).toFixed(2)}%`,
      width: `${Math.min(width, 100 - Math.max(0, left)).toFixed(2)}%`,
      label: entry.graphLabel || entry.title || 'Session',
      score: Number(entry.focusScore || 0),
      isSelected: String(selectedFocusSession.value?.id || '') === String(entry.id || ''),
      tone: Number(entry.focusScore || 0) >= 78 ? 'strong' : Number(entry.focusScore || 0) >= 60 ? 'steady' : 'strained',
      raw: entry,
    }
  })
})

const focusPillarCardItems = computed(() => {
  const session = selectedFocusSession.value
  const totalSeconds = Math.max(1, Number(session?.durationSeconds || 1))
  const favorableShare = session
    ? Math.round(((Number(session.productiveSeconds || 0) + Number(session.supportingSeconds || 0)) / totalSeconds) * 100)
    : 0
  return [
    {
      key: 'presence',
      name: 'Presence',
      colorClass: 'teal',
      value: Number(session?.pillars?.presence || 0),
      note: session ? `${favorableShare}% favorable lane share` : 'No session selected',
    },
    {
      key: 'activity',
      name: 'Activity',
      colorClass: 'sky',
      value: Number(session?.pillars?.activity || 0),
      note: session ? `${truncateLabel(session.leadApp || 'No lead app', 24)} led context` : 'No session selected',
    },
    {
      key: 'continuity',
      name: 'Continuity',
      colorClass: 'violet',
      value: Number(session?.pillars?.continuity || 0),
      note: session ? `${session.switchRate || 0}/min app switching` : 'No session selected',
    },
    {
      key: 'stability',
      name: 'Stability',
      colorClass: 'green',
      value: Number(session?.pillars?.stability || 0),
      note: session
        ? (session.browserPressureScore ? `${session.browserPressureScore}/100 browser pressure` : 'Quiet browser')
        : 'No session selected',
    },
  ]
})

const focusPerformanceSeries = computed(() => focusPillarSeriesMeta.map((pillar) => ({
  name: pillar.name,
  data: focusDepthEntries.value.map((entry) => Math.max(0, Math.min(100, Number(entry.pillars?.[pillar.key] || 0)))),
})))

const focusPerformanceOptions = computed(() => ({
  chart: {
    type: 'bar',
    toolbar: { show: false },
    animations: { enabled: true, speed: 400, easing: 'easeinout' },
    events: {
      dataPointSelection: (_event, _chartContext, config) => {
        selectFocusDepthFromChart(config?.dataPointIndex)
      },
      click: (_event, _chartContext, config) => {
        if (Number.isInteger(config?.dataPointIndex) && config.dataPointIndex >= 0) {
          selectFocusDepthFromChart(config.dataPointIndex)
        }
      },
    },
  },
  plotOptions: {
    bar: {
      horizontal: false,
      columnWidth: focusDepthEntries.value.length <= 1 ? '34%' : focusDepthEntries.value.length <= 3 ? '52%' : '68%',
      borderRadius: 7,
      borderRadiusApplication: 'end',
      dataLabels: { position: 'top' },
    },
  },
  colors: focusPillarSeriesMeta.map((pillar) => pillar.color),
  dataLabels: { enabled: false },
  states: {
    hover: { filter: { type: 'lighten', value: 0.08 } },
    active: { allowMultipleDataPointsSelection: false, filter: { type: 'darken', value: 0.12 } },
  },
  grid: {
    borderColor: 'rgba(148,163,184,.14)',
    strokeDashArray: 4,
    padding: { left: 4, right: 16, top: 10, bottom: 4 },
  },
  xaxis: {
    categories: focusDepthEntries.value.map((entry) => entry.timeLabel || truncateLabel(entry.title, 18)),
    labels: {
      style: { colors: '#64748b', fontSize: '11px', fontWeight: 700 },
      rotate: 0,
      trim: true,
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    min: 0,
    max: 100,
    tickAmount: 5,
    labels: {
      style: { colors: '#94a3b8', fontSize: '11px' },
    },
  },
  tooltip: {
    custom: ({ dataPointIndex }) => {
      const session = focusDepthEntries.value[dataPointIndex] || {}
      const pillarRows = focusPillarSeriesMeta.map((pillar) => {
        const value = Math.round(Number(session.pillars?.[pillar.key] || 0))
        return `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>${escapeTooltipHtml(pillar.name)}</span><strong style="color:${pillar.color}">${escapeTooltipHtml(value)}/100</strong></div>`
      }).join('')
      return `
          <div style="min-width:186px;padding:12px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;box-shadow:0 18px 36px rgba(15,23,42,.26)">
          <div style="font-size:13px;font-weight:800;margin-bottom:6px">${escapeTooltipHtml(session.title || (activeSourceMode.value === 'background' ? 'Background window' : 'Focus block'))}</div>
          <div style="font-size:11px;opacity:.76;margin-bottom:8px">${escapeTooltipHtml(session.timeLabel || '--')}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>${escapeTooltipHtml(activeSourceMode.value === 'background' ? 'Depth' : 'Focus')}</span><strong>${escapeTooltipHtml(session.focusScore || 0)}/100</strong></div>
          ${pillarRows}
          <div style="font-size:11px;opacity:.74">${escapeTooltipHtml(Number(session.switchRate || 0).toFixed ? Number(session.switchRate || 0).toFixed(1) : 0)}/m switches - browser ${escapeTooltipHtml(session.browserPressureScore || 0)}/100</div>
        </div>
      `
    },
  },
  legend: {
    position: 'top',
    horizontalAlign: 'left',
    markers: { radius: 12 },
    labels: { colors: '#64748b' },
  },
}))


const fatigueState = computed(() => getFatigueState(
  activeSourceMode.value === 'session'
    ? dailyAnalysisModel.value.sessionFatigueAverage || 0
    : activeSourceMode.value === 'background'
      ? dailyAnalysisModel.value.backgroundFatigue?.score || 0
      : dailyAnalysisModel.value.combinedFatigue || 0
))

const fatigueContextRange = computed(() => {
  if (activeSourceMode.value === 'session') {
    const weakestSession = [...focusSessionsDetailed.value].sort((left, right) => Number(right.fatigueScore || 0) - Number(left.fatigueScore || 0))[0]
    if (!weakestSession) return null
    const startTs = Number(weakestSession.timestamp || weakestSession.createdAt || 0)
    return {
      startTs,
      endTs: startTs + (Number(weakestSession.durationSeconds || 0) * 1000),
      label: weakestSession.title,
    }
  }

  const bucket = activeSourceMode.value === 'background'
    ? backgroundPeakStrainBucket.value
    : (combinedPeakStrainBucket.value || backgroundPeakStrainBucket.value)

  if (bucket) {
    return {
      startTs: Number(bucket.startTs || 0),
      endTs: Number(bucket.endTs || 0),
      label: bucket.driver || 'Background strain',
    }
  }

  if (fatigueMomentCard.value?.timestamp) {
    const timestamp = Number(fatigueMomentCard.value.timestamp || 0)
    return {
      startTs: Math.max(0, timestamp - (30 * 60 * 1000)),
      endTs: timestamp + (30 * 60 * 1000),
      label: fatigueMomentCard.value.title,
    }
  }

  return null
})

const fatigueContextAmbientEntries = computed(() => {
  if (!fatigueContextRange.value) return []
  return filterEntriesByRange(backgroundEntries.value, fatigueContextRange.value.startTs, fatigueContextRange.value.endTs, 0)
})

const fatigueContextBrowserEvents = computed(() => {
  if (!fatigueContextRange.value) return []
  return filterBrowserEventsByRange(browserEvents.value, fatigueContextRange.value.startTs, fatigueContextRange.value.endTs, 0)
})

const fatigueContextEvidence = computed(() => {
  if (!fatigueContextRange.value) return null
  return buildRangeEvidenceBundle({
    ambientEntries: backgroundEntries.value,
    browserEvents: browserEvents.value,
    startTs: fatigueContextRange.value.startTs,
    endTs: fatigueContextRange.value.endTs,
    ambientPadMs: 0,
    browserPadMs: 0,
    limit: 4,
  })
})

const fatigueContextAppsShared = computed(() => (fatigueContextEvidence.value?.topApps || [])
  .slice(0, 4)
  .map((app) => ({
    id: `fatigue-evidence-${app.app}`,
    label: app.app,
    lane: formatLaneLabel(app.dominantLane),
    laneKey: app.dominantLane,
    duration: formatActivityDuration(app.seconds || 0),
    note: `${app.switches || 0} switches - ${Math.round((Number(app.confidence || 0) || 0) * 100)}% confidence`,
  })))

const fatigueContextBrowserRowsShared = computed(() => (fatigueContextEvidence.value?.recentBrowserEvents || [])
  .map((entry) => ({
    id: entry.id || `${entry.eventType}-${entry.ts}`,
    label: entry.pageTitle || entry.host || entry.browserApp || 'Browser signal',
    note: `${entry.browserApp || 'Browser'} - ${entry.host || 'No host'} - ${formatLastSeen(entry.ts || 0)}`,
    badge: entry.audible ? 'Audible' : (entry.eventLabel || entry.eventType || 'Event'),
  })))

const fatigueContextApps = computed(() => ambient.getAppBreakdown(fatigueContextAmbientEntries.value, { sortBy: 'seconds' })
  .slice(0, 4)
  .map((app) => ({
    id: `fatigue-app-${app.app}`,
    label: app.app,
    lane: formatLaneLabel(app.dominantLane),
    laneKey: app.dominantLane,
    duration: formatActivityDuration(app.seconds || 0),
    note: `${app.switches || 0} switches - ${Math.round((Number(app.confidence || 0) || 0) * 100)}% confidence`,
  })))

const fatigueContextBrowserRows = computed(() => ambient.getRecentBrowserEvents(fatigueContextBrowserEvents.value, { limit: 4 })
  .map((entry) => ({
    id: entry.id || `${entry.eventType}-${entry.ts}`,
    label: entry.pageTitle || entry.host || entry.browserApp || 'Browser signal',
    note: `${entry.browserApp || 'Browser'} - ${entry.host || 'No host'} - ${formatLastSeen(entry.ts || 0)}`,
    badge: entry.audible ? 'Audible' : (entry.eventLabel || entry.eventType || 'Event'),
  })))

const fatigueEvidenceRows = computed(() => {
  if (activeSourceMode.value === 'session') {
    const weakestSession = [...focusSessionsDetailed.value].sort((left, right) => Number(right.fatigueScore || 0) - Number(left.fatigueScore || 0))[0]
    if (!weakestSession) return []
    const precisionState = weakestSession.precisionState || null
    const recoveryStateLabel = String(weakestSession.recoveryState || 'strained')
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (value) => value.toUpperCase())
    return [
      {
        label: 'Fatigue score',
        value: `${weakestSession.fatigueScore || 0}%`,
        note: weakestSession.timeLabel || weakestSession.durationLabel,
        info: 'Session fatigue is computed from duration load, idle load, switch load, focus decay, lane pressure, and browser overlap inside the same block.',
      },
      {
        label: 'Driver',
        value: weakestSession.topFatigueDriverLabel || 'No dominant driver',
        note: `${weakestSession.distractions || 0} distractions - ${weakestSession.driftCount || 0} drift`,
        info: 'The dominant driver is the strongest weighted contributor after the fatigue formula combines the evidence in this block.',
      },
      {
        label: 'Precision',
        value: precisionState?.label || `${Number(weakestSession.analysisConfidenceScore || 0)}/100`,
        note: precisionState?.detail || `${Number(weakestSession.analysisConfidenceScore || 0)}% confidence across saved session evidence`,
        info: 'Precision marks how strongly this session fatigue score is backed by measured evidence instead of lighter inference.',
      },
      {
        label: 'Browser pressure',
        value: weakestSession.browserPressureScore ? `${weakestSession.browserPressureScore}/100` : 'Quiet',
        note: weakestSession.browserSignals?.tabSwitches
          ? `${weakestSession.browserSignals.tabSwitches} switches - ${weakestSession.browserSignals.tabsOpened || 0} opened`
          : 'No major browser churn inside this block',
        info: 'Browser pressure comes from tab switching, new tabs, audible overlap, and host spread during the same time window.',
      },
      {
        label: 'Recovery quality',
        value: `${Number(weakestSession.recoveryQuality || 0)}/100`,
        note: `${recoveryStateLabel} - calm score ${Number(weakestSession.calmScore || 0)}/100`,
        info: 'Recovery quality shows whether this session regained stability after pressure instead of simply ending while still strained.',
      },
    ]
  }

  const background = dailyAnalysisModel.value.backgroundFatigue || {}
  const strongestCalmWindow = backgroundCalmWindows.value[0] || null
  const backgroundRecoveryLabel = String(strongestCalmWindow?.recoveryState || 'strained')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase())
  return [
    {
      label: activeSourceMode.value === 'background' ? 'Background fatigue' : 'Combined fatigue',
      value: `${activeSourceMode.value === 'background' ? (background.score || 0) : (dailyAnalysisModel.value.combinedFatigue || 0)}%`,
      note: background.dominantDriver || 'No dominant driver',
      info: 'Background fatigue is deterministic. It uses distracting share, unclear share, supporting load, switching, late-day load, and now browser pressure.',
    },
    {
      label: 'Browser pressure',
      value: background.browserSignals?.pressureScore ? `${background.browserSignals.pressureScore}/100` : 'Quiet',
      note: background.browserSignals?.tabSwitches
        ? `${background.browserSignals.tabSwitches} switches - ${background.browserSignals.audibleMoments || 0} audible`
        : 'No notable browser churn in the day-level fatigue window',
      info: 'Browser pressure adds strain when tab switching, tab creation, audio overlap, and host spread suggest fragmented attention.',
    },
    {
      label: 'Recovery quality',
      value: strongestCalmWindow ? `${Number(strongestCalmWindow.recoveryQuality || 0)}/100` : 'No calm window',
      note: strongestCalmWindow
        ? `${backgroundRecoveryLabel} - ${strongestCalmWindow.timeLabel || strongestCalmWindow.durationLabel}`
        : 'No stable recovery window has been detected yet',
      info: 'Recovery quality is taken from the strongest stable low-pressure window in the day, so background and combined fatigue have an honest recovery anchor.',
    },
    {
      label: 'Recovery headroom',
      value: `${Math.max(0, 100 - Number(activeSourceMode.value === 'background' ? (background.score || 0) : (dailyAnalysisModel.value.combinedFatigue || 0)))}%`,
      note: `${backgroundCalmWindows.value.length || 0} calm windows detected`,
      info: 'Recovery headroom is the remaining space before the day would move into high fatigue. Calm windows lower pressure when the work becomes stable.',
    },
  ]
})

const backgroundCalmWindowRows = computed(() => backgroundFocusWindowsDetailed.value
  .filter((window) => (
    Boolean(window.isCalmWindow)
    || (
      Number(window.calmScore || 0) >= 68
      && Number(window.recoveryQuality || 0) >= 52
      && Number(window.browserPressureScore || 0) <= 36
    )
  ))
  .sort((left, right) => (
    Number(right.calmScore || 0) - Number(left.calmScore || 0)
    || Number(right.recoveryQuality || 0) - Number(left.recoveryQuality || 0)
    || Number(right.durationSeconds || 0) - Number(left.durationSeconds || 0)
  ))
  .slice(0, 3))

const backgroundCalmWindows = computed(() => backgroundCalmWindowRows.value)

const fatigueSpikeEvent = computed(() => (
  dailyAnalysisModel.value.events?.find((event) => event.type === 'fatigue-spike')
  || null
))

const selectedDayRange = computed(() => getLocalDayRange(selectedDateKey.value))
const backgroundHourlyStrain = computed(() => Array.from({ length: 24 }, (_, hour) => {
  const startTs = Number(selectedDayRange.value.startMs || 0) + (hour * 60 * 60 * 1000)
  const endTs = startTs + (60 * 60 * 1000)
  const entries = filterEntriesByRange(backgroundEntries.value, startTs, endTs, 0)
  const rangeBrowserEvents = filterBrowserEventsByRange(browserEvents.value, startTs, endTs, 0)
  const snapshot = buildBrowserAwareBackgroundFatigueSnapshot(entries, rangeBrowserEvents, {
    startTs,
    endTs,
    padMs: 0,
  })
  return {
    hour,
    label: formatHourLabel(hour),
    startTs,
    endTs,
    score: snapshot.score,
    trackedSeconds: entries.reduce((sum, entry) => sum + (Number(entry?.duration) || 0), 0),
    driver: snapshot.dominantDriver,
    browserSignals: snapshot.browserSignals || {},
    browserPressure: Number(snapshot.browserSignals?.pressureScore || 0),
  }
}))

const combinedHourlyStrain = computed(() => backgroundHourlyStrain.value.map((bucket) => {
  const sessionScores = focusSessionsDetailed.value
    .filter((session) => new Date(Number(session.timestamp || 0)).getHours() === bucket.hour)
    .map((session) => Number(session.fatigueScore || 0))
  const sessionScore = sessionScores.length ? averageNumbers(sessionScores) : 0
  return {
    ...bucket,
    score: sessionScore > 0 && bucket.score > 0
      ? Math.round((sessionScore * 0.62) + (bucket.score * 0.38))
      : Math.max(sessionScore, bucket.score),
  }
}))

const backgroundPeakStrainBucket = computed(() => [...backgroundHourlyStrain.value]
  .filter((bucket) => Number(bucket.trackedSeconds || 0) > 0)
  .sort((left, right) => (
    Number(right.score || 0) - Number(left.score || 0)
    || Number(right.browserPressure || 0) - Number(left.browserPressure || 0)
  ))[0] || null)

const combinedPeakStrainBucket = computed(() => [...combinedHourlyStrain.value]
  .filter((bucket) => Number(bucket.trackedSeconds || 0) > 0 || Number(bucket.score || 0) > 0)
  .sort((left, right) => (
    Number(right.score || 0) - Number(left.score || 0)
    || Number(right.browserPressure || 0) - Number(left.browserPressure || 0)
  ))[0] || null)

const fatigueMomentCard = computed(() => {
  if (activeSourceMode.value === 'session') return fatigueSpikeEvent.value

  const bucket = activeSourceMode.value === 'background'
    ? backgroundPeakStrainBucket.value
    : (combinedPeakStrainBucket.value || backgroundPeakStrainBucket.value)

  if (!bucket) return fatigueSpikeEvent.value

  return {
    id: `fatigue-bucket-${activeSourceMode.value}-${bucket.hour}`,
    timeLabel: formatSessionTimeLabel(bucket.startTs, Math.max(0, Number(bucket.endTs || bucket.startTs) - Number(bucket.startTs || 0)) / 1000),
    title: bucket.driver || 'Background strain peaked',
    detail: `${bucket.score || 0}% strain across ${formatActivityDuration(bucket.trackedSeconds || 0)} of tracked activity`,
    metrics: [
      `Strain: ${bucket.score || 0}%`,
      `Browser pressure: ${bucket.browserPressure || 0}/100`,
      `Switches: ${bucket.browserSignals?.tabSwitches || 0}`,
      `Audible moments: ${bucket.browserSignals?.audibleMoments || 0}`,
    ],
    timestamp: Number(bucket.startTs || 0),
  }
})

const fatigueTimelineSeries = computed(() => {
  if (activeSourceMode.value === 'session') {
    return [{
      name: 'Session fatigue',
      data: focusSessionsDetailed.value.map((session) => ({
        x: truncateLabel(session.timeLabel, 16),
        y: Number(session.fatigueScore || 0),
        meta: session,
      })),
    }]
  }

  const buckets = activeSourceMode.value === 'background'
    ? backgroundHourlyStrain.value
    : combinedHourlyStrain.value

  return [{
    name: activeSourceMode.value === 'background' ? 'Background strain' : 'Combined fatigue',
    data: buckets.map((bucket) => ({
      x: bucket.label,
      y: Number(bucket.score || 0),
      meta: bucket,
    })),
  }]
})

const fatigueTimelineOptions = computed(() => {
  const isSession = activeSourceMode.value === 'session'
  const seriesColor = activeSourceMode.value === 'background' ? '#ef4444' : isSession ? '#fb7185' : '#f97316'
  const sessionCount = focusSessionsDetailed.value.length
  return {
  chart: {
    type: isSession ? 'bar' : 'area',
    toolbar: { show: false },
    animations: { enabled: true, speed: 400, easing: 'easeinout' },
  },
  colors: [seriesColor],
  ...(isSession ? {
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: sessionCount <= 1 ? '32%' : sessionCount <= 3 ? '48%' : '62%',
        borderRadius: 8,
        borderRadiusApplication: 'end',
      },
    },
  } : {
    stroke: { curve: 'smooth', width: 3 },
    markers: { size: 4, strokeWidth: 2, strokeColors: '#ffffff', hover: { size: 6 } },
    fill: {
      type: 'gradient',
      gradient: {
        shade: 'light',
        type: 'vertical',
        shadeIntensity: 0.4,
        gradientToColors: ['transparent'],
        inverseColors: false,
        opacityFrom: 0.28,
        opacityTo: 0.02,
        stops: [0, 100],
      },
    },
  }),
  dataLabels: { enabled: false },
  xaxis: {
    categories: fatigueTimelineSeries.value[0]?.data?.map((point) => point.x) || [],
    labels: {
      style: { colors: '#64748b', fontSize: '11px', fontWeight: 700 },
      rotate: 0,
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    min: 0,
    max: 100,
    tickAmount: 5,
    labels: {
      style: { colors: '#94a3b8', fontSize: '11px' },
    },
  },
  grid: {
    borderColor: 'rgba(148,163,184,.14)',
    strokeDashArray: 4,
    padding: { left: 4, right: 16, top: 8, bottom: 4 },
  },
  tooltip: {
    custom: ({ seriesIndex, dataPointIndex, w }) => {
      const point = w.config.series?.[seriesIndex]?.data?.[dataPointIndex]
      const meta = point?.meta || {}
      if (activeSourceMode.value === 'session') {
        return `
          <div style="min-width:182px;padding:12px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;box-shadow:0 18px 36px rgba(15,23,42,.26)">
            <div style="font-size:13px;font-weight:800;margin-bottom:6px">${escapeTooltipHtml(meta.title || 'Focus block')}</div>
            <div style="font-size:11px;opacity:.76;margin-bottom:8px">${escapeTooltipHtml(meta.timeLabel || '--')}</div>
            <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Fatigue</span><strong>${escapeTooltipHtml(meta.fatigueScore || 0)}%</strong></div>
            <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Drift</span><strong>${escapeTooltipHtml(meta.driftCount || 0)}</strong></div>
            <div style="font-size:11px;opacity:.74">${escapeTooltipHtml(meta.topFatigueDriverLabel || 'No dominant driver')}</div>
          </div>
        `
      }
      return `
        <div style="min-width:170px;padding:12px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;box-shadow:0 18px 36px rgba(15,23,42,.26)">
          <div style="font-size:13px;font-weight:800;margin-bottom:6px">${escapeTooltipHtml(point?.x || '--')}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Strain</span><strong>${escapeTooltipHtml(meta.score || 0)}%</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Browser</span><strong>${escapeTooltipHtml(meta.browserPressure || 0)}/100</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Tracked</span><strong>${escapeTooltipHtml(formatActivityDuration(meta.trackedSeconds || 0))}</strong></div>
          <div style="font-size:11px;opacity:.74">${escapeTooltipHtml(meta.driver || 'No dominant driver')}</div>
        </div>
      `
    },
  },
  legend: { show: false },
  }
})

const fatigueDriverRows = computed(() => {
  if (activeSourceMode.value === 'session') {
    const sessionDrivers = focusSessionsDetailed.value.map((session) => session.fatigueDrivers || {})
    return [
      { label: 'Duration load', value: averageNumbers(sessionDrivers.map((item) => Number(item.durationLoad || 0))), color: '#f97316' },
      { label: 'Idle load', value: averageNumbers(sessionDrivers.map((item) => Number(item.idleLoad || 0))), color: '#94a3b8' },
      { label: 'Switch load', value: averageNumbers(sessionDrivers.map((item) => Number(item.switchLoad || 0))), color: TRACKING_LANE_META.distracting.color },
      { label: 'Focus decay', value: averageNumbers(sessionDrivers.map((item) => Number(item.focusDecayLoad || 0))), color: '#0ea5e9' },
      { label: 'Browser pressure', value: averageNumbers(focusSessionsDetailed.value.map((session) => Number(session.browserPressureScore || 0))), color: '#ef4444' },
    ]
  }

  if (activeSourceMode.value === 'background') {
    const background = dailyAnalysisModel.value.backgroundFatigue || {}
    return [
      { label: 'Distracting share', value: Math.round((Number(background.distractingShare || 0) || 0) * 100), color: TRACKING_LANE_META.distracting.color },
      { label: 'Unclear share', value: Math.round((Number(background.unclearShare || 0) || 0) * 100), color: TRACKING_LANE_META.unclear.color },
      { label: 'Supporting load', value: Math.round((Number(background.supportingShare || 0) || 0) * 100), color: TRACKING_LANE_META.supporting.color },
      { label: 'Switch pressure', value: Math.min(100, Math.round((Number(background.switches || 0) / 12) * 100)), color: '#8b5cf6' },
      { label: 'Browser pressure', value: Number(background.browserSignals?.pressureScore || 0), color: '#ef4444' },
    ]
  }

  return [
    { label: 'Session strain', value: Number(dailyAnalysisModel.value.sessionFatigueAverage || 0), color: TRACKING_LANE_META.distracting.color },
    { label: 'Background pressure', value: Number(dailyAnalysisModel.value.backgroundFatigue?.score || 0), color: '#8b5cf6' },
    { label: 'Combined fatigue', value: Number(dailyAnalysisModel.value.combinedFatigue || 0), color: '#f97316' },
    { label: 'Browser pressure', value: Number(dailyAnalysisModel.value.backgroundFatigue?.browserSignals?.pressureScore || 0), color: '#ef4444' },
    { label: 'Recovery headroom', value: Math.max(0, 100 - Number(dailyAnalysisModel.value.combinedFatigue || 0)), color: TRACKING_LANE_META.productive.color },
  ]
})

const fatigueDriverSeries = computed(() => ([{
  data: fatigueDriverRows.value.map((driver) => ({
    x: driver.label,
    y: Number(driver.value || 0),
    fillColor: driver.color,
  })),
}]))

const fatigueDriverOptions = computed(() => ({
  chart: {
    type: 'bar',
    toolbar: { show: false },
    animations: { enabled: true, speed: 360 },
  },
  plotOptions: {
    bar: {
      horizontal: true,
      barHeight: '48%',
      borderRadius: 10,
      distributed: true,
    },
  },
  dataLabels: {
    enabled: true,
    formatter: (value) => `${Math.round(value)}%`,
    style: { fontSize: '11px', fontWeight: 800 },
  },
  xaxis: {
    min: 0,
    max: 100,
    labels: {
      style: { colors: '#94a3b8', fontSize: '11px' },
      formatter: (value) => `${Math.round(value)}%`,
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: '#64748b', fontSize: '11px', fontWeight: 700 },
      maxWidth: 160,
    },
  },
  grid: {
    borderColor: 'rgba(148,163,184,.16)',
    strokeDashArray: 4,
  },
  legend: { show: false },
  tooltip: {
    y: {
      formatter: (value) => `${Math.round(value)}%`,
    },
  },
}))

const fatigueHighlightCards = computed(() => {
  if (activeSourceMode.value === 'session') {
    return [
      {
        label: 'Session fatigue',
        value: `${dailyAnalysisModel.value.sessionFatigueAverage || 0}%`,
        detail: `${focusSessionsDetailed.value.length} recorded focus session${focusSessionsDetailed.value.length === 1 ? '' : 's'}`,
        tone: fatigueState.value.tone,
      },
      {
        label: 'Weakest block',
        value: dailyAnalysisModel.value.weakestSession?.goal || dailyAnalysisModel.value.weakestSession?.taskTitle || 'No weak block',
        detail: dailyAnalysisModel.value.weakestSession ? `${dailyAnalysisModel.value.weakestSession.fatigueScore || 0}% fatigue` : 'No session strain yet',
        tone: 'rose',
      },
      {
        label: 'Recovery moments',
        value: String(focusSessionStats.value.totalRecovery || 0),
        detail: `${focusSessionStats.value.totalDrift || 0} drift moments recorded`,
        tone: 'teal',
      },
      {
        label: 'Switch rate',
        value: `${focusSessionStats.value.averageSwitchRate || 0}/m`,
        detail: 'Average focus-session switching pressure',
        tone: 'blue',
      },
    ]
  }

  if (activeSourceMode.value === 'background') {
    return [
      {
        label: 'Background fatigue',
        value: `${dailyAnalysisModel.value.backgroundFatigue?.score || 0}%`,
        detail: dailyAnalysisModel.value.backgroundFatigue?.dominantDriver || 'No dominant background driver',
        tone: fatigueState.value.tone,
      },
      {
        label: 'Switch pressure',
        value: String(dailyAnalysisModel.value.backgroundFatigue?.switches || 0),
        detail: 'Foreground app switches across background tracking',
        tone: 'violet',
      },
      {
        label: 'Distracting share',
        value: `${Math.round((Number(dailyAnalysisModel.value.backgroundFatigue?.distractingShare || 0) || 0) * 100)}%`,
        detail: 'Background time that landed in distracting lanes',
        tone: 'rose',
      },
      {
        label: 'Calm windows',
        value: String(backgroundCalmWindows.value.length || 0),
        detail: 'Longer productive or supporting windows with low switching',
        tone: 'teal',
      },
    ]
  }

  return [
    {
      label: 'Combined fatigue',
      value: `${dailyAnalysisModel.value.combinedFatigue || 0}%`,
      detail: 'Session strain blended with background pressure',
      tone: fatigueState.value.tone,
    },
    {
      label: 'Highest strain moment',
      value: fatigueMomentCard.value?.timeLabel || '--',
      detail: fatigueMomentCard.value?.title || 'No peak strain event yet',
      tone: 'rose',
    },
    {
      label: 'Recovery signal',
      value: String((focusSessionStats.value.totalRecovery || 0) + (backgroundCalmWindows.value.length || 0)),
      detail: 'Session recoveries plus calm background windows',
      tone: 'teal',
    },
    {
      label: 'Dominant driver',
      value: dailyAnalysisModel.value.backgroundFatigue?.dominantDriver || 'Stable load',
      detail: `${dailyAnalysisModel.value.sessionFatigueAverage || 0}% session fatigue average`,
      tone: 'blue',
    },
  ]
})

const habitHighlightCards = computed(() => {
  if (activeSourceMode.value === 'manual') {
    return [
      {
        label: 'On target',
        value: `${habitStats.value.onTrackCount}/${manualHabitCards.value.length || 0}`,
        detail: `${formatCompactDuration(habitStats.value.totalLoggedMinutes * 60)} logged against ${formatCompactDuration(habitStats.value.totalTargetMinutes * 60)} planned`,
        tone: 'teal',
      },
      {
        label: 'Largest gap',
        value: habitStats.value.nextGapHabit?.name || 'No gap',
        detail: habitStats.value.nextGapHabit
          ? `${Math.max(0, Number(habitStats.value.nextGapHabit.targetMinutes || 0) - Number(habitStats.value.nextGapHabit.totalMinutes || 0))}m still open`
          : "All active habits met today's target",
        tone: 'amber',
      },
      {
        label: 'Habit-linked wins',
        value: String(habitStats.value.totalCompletedTaskWins || 0),
        detail: 'Tasks completed on this day that were explicitly tied to a habit',
        tone: 'blue',
      },
      {
        label: 'Tracked habits',
        value: String(manualHabitCards.value.filter((habit) => habit.totalMinutes > 0 || habit.sessions > 0).length || 0),
        detail: 'Habits with measured time or linked focus activity on the selected day',
        tone: 'violet',
      },
    ]
  }

  return [
    {
      label: 'Habit sessions',
      value: String(habitStats.value.totalHabitSessions || 0),
      detail: `${sessionHabitCards.value.length} habits had linked focus evidence`,
      tone: 'blue',
    },
    {
      label: 'Avg focus',
      value: `${habitStats.value.avgFocus || 0}/100`,
      detail: 'Average focus across habit-linked sessions for the selected day',
      tone: 'teal',
    },
    {
      label: 'Strongest habit',
      value: habitStats.value.strongestSessionHabit?.name || 'No habit yet',
      detail: habitStats.value.strongestSessionHabit
        ? `${habitStats.value.strongestSessionHabit.avgFocus || 0}/100 focus over ${habitStats.value.strongestSessionHabit.sessions || 0} session${habitStats.value.strongestSessionHabit.sessions === 1 ? '' : 's'}`
        : 'No habit-linked focus evidence yet',
      tone: 'violet',
    },
    {
      label: 'Task wins',
      value: String(habitStats.value.totalCompletedTaskWins || 0),
      detail: "Completed tasks connected to today's habit work",
      tone: 'amber',
    },
  ]
})

const habitManualRows = computed(() => manualHabitCards.value
  .slice()
  .sort((left, right) => {
    const leftProgress = Number(left.targetMinutes || 0) > 0 ? Number(left.totalMinutes || 0) / Number(left.targetMinutes || 1) : 0
    const rightProgress = Number(right.targetMinutes || 0) > 0 ? Number(right.totalMinutes || 0) / Number(right.targetMinutes || 1) : 0
    if (rightProgress !== leftProgress) return rightProgress - leftProgress
    return Number(right.totalMinutes || 0) - Number(left.totalMinutes || 0)
  })
  .slice(0, 6))

const habitManualChartSeries = computed(() => ([
  {
    name: 'Logged',
    data: habitManualRows.value.map((habit) => Number(habit.totalMinutes || 0)),
  },
  {
    name: 'Remaining',
    data: habitManualRows.value.map((habit) => Math.max(0, Number(habit.targetMinutes || 0) - Number(habit.totalMinutes || 0))),
  },
]))

const habitManualChartOptions = computed(() => ({
  chart: {
    type: 'bar',
    stacked: true,
    toolbar: { show: false },
    animations: { enabled: true, speed: 360 },
  },
  colors: ['#14b8a6', '#e2e8f0'],
  plotOptions: {
    bar: {
      horizontal: true,
      borderRadius: 10,
      barHeight: '52%',
    },
  },
  dataLabels: { enabled: false },
  grid: {
    borderColor: 'rgba(148,163,184,.16)',
    strokeDashArray: 4,
  },
  xaxis: {
    categories: habitManualRows.value.map((habit) => truncateLabel(habit.name, 18)),
    labels: {
      style: { colors: '#94a3b8', fontSize: '11px' },
      formatter: (value) => `${Math.round(value)}m`,
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: '#64748b', fontSize: '11px', fontWeight: 700 },
      maxWidth: 160,
    },
  },
  legend: {
    position: 'top',
    horizontalAlign: 'left',
    labels: { colors: '#64748b' },
  },
  tooltip: {
    custom: ({ dataPointIndex }) => {
      const habit = habitManualRows.value[dataPointIndex]
      return `
        <div style="min-width:178px;padding:12px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;box-shadow:0 18px 36px rgba(15,23,42,.26)">
          <div style="font-size:13px;font-weight:800;margin-bottom:6px">${escapeTooltipHtml(habit?.name || 'Habit')}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Logged</span><strong>${escapeTooltipHtml(habit?.totalMinutes || 0)}m</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Target</span><strong>${escapeTooltipHtml(habit?.targetMinutes || 0)}m</strong></div>
          <div style="font-size:11px;opacity:.74">${escapeTooltipHtml(habit?.sessions || 0)} linked focus session(s)</div>
        </div>
      `
    },
  },
}))

const habitSessionRows = computed(() => sessionHabitCards.value
  .slice()
  .sort((left, right) => {
    if (Number(right.avgFocus || 0) !== Number(left.avgFocus || 0)) return Number(right.avgFocus || 0) - Number(left.avgFocus || 0)
    return Number(right.totalMinutes || 0) - Number(left.totalMinutes || 0)
  })
  .slice(0, 6))

const habitSessionChartSeries = computed(() => ([{
  data: habitSessionRows.value.map((habit) => ({
    x: truncateLabel(habit.name, 20),
    y: Number(habit.avgFocus || 0),
    fillColor: habit.color || '#0ea5e9',
    meta: habit,
  })),
}]))

const habitSessionChartOptions = computed(() => ({
  chart: {
    type: 'bar',
    toolbar: { show: false },
    animations: { enabled: true, speed: 360 },
  },
  plotOptions: {
    bar: {
      horizontal: true,
      borderRadius: 10,
      barHeight: '52%',
      distributed: true,
    },
  },
  dataLabels: {
    enabled: true,
    formatter: (value) => `${Math.round(value)}/100`,
    style: { fontSize: '11px', fontWeight: 800 },
  },
  xaxis: {
    min: 0,
    max: 100,
    labels: {
      style: { colors: '#94a3b8', fontSize: '11px' },
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: '#64748b', fontSize: '11px', fontWeight: 700 },
      maxWidth: 160,
    },
  },
  grid: {
    borderColor: 'rgba(148,163,184,.16)',
    strokeDashArray: 4,
  },
  legend: { show: false },
  tooltip: {
    custom: ({ seriesIndex, dataPointIndex, w }) => {
      const point = w.config.series?.[seriesIndex]?.data?.[dataPointIndex]
      const habit = point?.meta || {}
      return `
        <div style="min-width:184px;padding:12px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;box-shadow:0 18px 36px rgba(15,23,42,.26)">
          <div style="font-size:13px;font-weight:800;margin-bottom:6px">${escapeTooltipHtml(habit.name || 'Habit')}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Avg focus</span><strong>${escapeTooltipHtml(habit.avgFocus || 0)}/100</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Tracked</span><strong>${escapeTooltipHtml(habit.totalMinutes || 0)}m</strong></div>
          <div style="font-size:11px;opacity:.74">${escapeTooltipHtml(habit.sessions || 0)} session(s) - ${escapeTooltipHtml(habit.completedTaskCount || 0)} task win(s)</div>
        </div>
      `
    },
  },
}))

const selectedHabitLead = computed(() => activeSourceMode.value === 'manual'
  ? habitStats.value.nextGapHabit || habitManualRows.value[0] || null
  : habitStats.value.strongestSessionHabit || habitSessionRows.value[0] || null)

const appLandscapeSeries = computed(() => ([{
  data: topAppsForVisual.value.map((app) => ({
    x: truncateLabel(app.app, 22),
    y: Math.max(Number(app.seconds || 0), 1),
    fillColor: app.color || '#0ea5e9',
    meta: {
      app: app.app,
      category: app.category || 'Other',
      duration: formatActivityDuration(app.seconds || 0),
      switches: app.switches || 0,
      lane: formatLaneLabel(app.dominantLane),
      confidence: `${Math.round((Number(app.confidence || 0) || 0) * 100)}%`,
      lastSeen: formatLastSeen(app.lastTs),
      context: app.contextLabel || app.subcategory || app.category || 'No dominant context',
    },
  })),
}]))

const appLandscapeOptions = computed(() => ({
  chart: {
    type: 'treemap',
    toolbar: { show: false },
    animations: { enabled: true, speed: 420, easing: 'easeinout' },
  },
  legend: { show: false },
  plotOptions: {
    treemap: {
      distributed: true,
      enableShades: false,
    },
  },
  dataLabels: {
    enabled: true,
    style: {
      fontSize: '12px',
      fontWeight: 700,
    },
    formatter: (label) => truncateLabel(label, 18),
  },
  stroke: {
    show: true,
    width: 3,
    colors: ['rgba(255,255,255,0.78)'],
  },
  tooltip: {
    custom: ({ seriesIndex, dataPointIndex, w }) => {
      const point = w.config.series?.[seriesIndex]?.data?.[dataPointIndex]
      const meta = point?.meta || {}
      return `
        <div style="min-width:180px;padding:12px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;box-shadow:0 18px 36px rgba(15,23,42,.26)">
          <div style="font-size:13px;font-weight:800;margin-bottom:6px">${escapeTooltipHtml(meta.app)}</div>
          <div style="font-size:11px;opacity:.78;margin-bottom:8px">${escapeTooltipHtml(meta.category)}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Tracked</span><strong>${escapeTooltipHtml(meta.duration)}</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Switches</span><strong>${escapeTooltipHtml(meta.switches)}</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Last seen</span><strong>${escapeTooltipHtml(meta.lastSeen)}</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Lane</span><strong>${escapeTooltipHtml(meta.lane)}</strong></div>
          <div style="font-size:11px;opacity:.74">Lead context: ${escapeTooltipHtml(meta.context)} - ${escapeTooltipHtml(meta.confidence)} confidence</div>
        </div>
      `
    },
  },
}))

const categoryMixSeries = computed(() => appCategoryRows.value.map((category) => Math.max(Number((category.seconds / 60).toFixed(1)), 0.1)))
const categoryMixOptions = computed(() => ({
  chart: {
    type: 'donut',
    toolbar: { show: false },
    animations: { enabled: true, speed: 420 },
  },
  labels: appCategoryRows.value.map((category) => category.category),
  colors: appCategoryRows.value.map((category) => category.color || '#94a3b8'),
  legend: { show: false },
  stroke: { width: 0 },
  dataLabels: { enabled: false },
  plotOptions: {
    pie: {
      donut: {
        size: '72%',
        labels: {
          show: true,
          name: {
            show: true,
            offsetY: 18,
            color: '#64748b',
            fontSize: '11px',
            formatter: () => 'Tracked',
          },
          value: {
            show: true,
            offsetY: -8,
            color: '#0f172a',
            fontSize: '26px',
            fontWeight: 800,
            formatter: () => formatCompactDuration(appUsageStats.value.trackedSeconds || 0),
          },
          total: { show: false },
        },
      },
    },
  },
  tooltip: {
    y: {
      formatter: (_value, context) => formatActivityDuration(appCategoryRows.value[context.seriesIndex]?.seconds || 0),
    },
  },
}))

const browserUsageSeries = computed(() => ([{
  data: browserCards.value.map((site) => ({
    x: truncateLabel(site.label, 24),
    y: Number((Number(site.seconds || 0) / 60).toFixed(1)),
    fillColor: site.color || '#8b5cf6',
    meta: {
      label: site.label,
      category: site.category || 'Other',
      duration: formatActivityDuration(site.seconds || 0),
      confidence: `${Math.round((Number(site.confidence || 0) || 0) * 100)}%`,
      switches: site.switches || 0,
      lane: formatLaneLabel(site.dominantLane),
      lastSeen: formatLastSeen(site.lastTs),
    },
  })),
}]))

const browserUsageOptions = computed(() => ({
  chart: {
    type: 'bar',
    toolbar: { show: false },
    animations: { enabled: true, speed: 360 },
  },
  plotOptions: {
    bar: {
      horizontal: true,
      barHeight: '48%',
      borderRadius: 10,
      distributed: true,
    },
  },
  dataLabels: { enabled: false },
  grid: {
    borderColor: 'rgba(148,163,184,.16)',
    strokeDashArray: 4,
  },
  xaxis: {
    labels: {
      style: { colors: '#94a3b8', fontSize: '11px' },
      formatter: (value) => `${Math.round(value)}m`,
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
  },
  yaxis: {
    labels: {
      style: { colors: '#64748b', fontSize: '11px', fontWeight: 700 },
      maxWidth: 160,
    },
  },
  tooltip: {
    custom: ({ seriesIndex, dataPointIndex, w }) => {
      const point = w.config.series?.[seriesIndex]?.data?.[dataPointIndex]
      const meta = point?.meta || {}
      return `
        <div style="min-width:170px;padding:12px 14px;border-radius:14px;background:#0f172a;color:#f8fafc;box-shadow:0 18px 36px rgba(15,23,42,.26)">
          <div style="font-size:13px;font-weight:800;margin-bottom:6px">${escapeTooltipHtml(meta.label)}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Tracked</span><strong>${escapeTooltipHtml(meta.duration)}</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Confidence</span><strong>${escapeTooltipHtml(meta.confidence)}</strong></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:11px;margin-bottom:4px"><span>Last seen</span><strong>${escapeTooltipHtml(meta.lastSeen)}</strong></div>
          <div style="font-size:11px;opacity:.74">${escapeTooltipHtml(meta.category)} - ${escapeTooltipHtml(meta.lane)} - ${escapeTooltipHtml(meta.switches)} switches</div>
        </div>
      `
    },
  },
  legend: { show: false },
}))

function shiftDay(offset) {
  selectedDateKey.value = clampRangeAnchor(shiftDateKey(selectedDateKey.value, offset), todayKey.value)
}

function jumpToToday() {
  selectedDateKey.value = todayKey.value
}

function jumpToEvent(event) {
  if (!event) return
  const focusSessionId = getFocusSessionIdFromEvent(event)
  if (focusSessionId) focusSessionSelectionId.value = focusSessionId
  activeTab.value = event.linkedTab || 'overview'
  emit('activate-event', event)
}

function selectFocusSession(session) {
  focusSessionSelectionId.value = String(session?.id || '')
}

function laneToProductive(lane = 'unclear') {
  if (lane === 'productive' || lane === 'supporting') return true
  if (lane === 'distracting') return false
  return null
}

function inferLaneFromRule(rule = {}) {
  if (rule?.lane) return String(rule.lane)
  if (rule?.productive === true) return 'productive'
  if (rule?.productive === false) return 'distracting'
  return 'unclear'
}

function openRuleEditor({
  target = '',
  label = '',
  source = 'app',
  category = 'Other',
  lane = 'unclear',
} = {}) {
  const normalizedTarget = String(target || '').trim().toLowerCase()
  if (!normalizedTarget) return

  const existingRule = customRules.value[normalizedTarget]
  ruleTarget.value = normalizedTarget
  ruleLabel.value = label || target
  ruleSource.value = source
  ruleCategory.value = existingRule?.category || category || 'Other'
  ruleLane.value = inferLaneFromRule(existingRule || { lane })
  showCorrectionModal.value = true
}

function closeRuleEditor() {
  showCorrectionModal.value = false
}

async function saveRuleOverride() {
  if (!ruleTarget.value || ruleSubmitting.value) return
  ruleSubmitting.value = true
  try {
    await ambient.setCustomRule(ruleTarget.value, {
      category: ruleCategory.value || 'Other',
      subcategory: '',
      color: CATEGORY_COLORS[ruleCategory.value] || '#8E95A3',
      productive: laneToProductive(ruleLane.value),
      lane: ruleLane.value,
    })
    await ambient.refreshDate(selectedDateKey.value)
    showCorrectionModal.value = false
  } finally {
    ruleSubmitting.value = false
  }
}

async function removeRuleOverride() {
  if (!ruleTarget.value || ruleSubmitting.value || !activeCustomRule.value) return
  ruleSubmitting.value = true
  try {
    await ambient.removeCustomRule(ruleTarget.value)
    await ambient.refreshDate(selectedDateKey.value)
    showCorrectionModal.value = false
  } finally {
    ruleSubmitting.value = false
  }
}

function getExplanationCacheKey() {
  const context = explanationContext.value
  return JSON.stringify({
    dateKey: context.dateKey,
    focusAverage: context.focusAverage,
    sessionFatigueAverage: context.sessionFatigueAverage,
    backgroundFatigue: context.backgroundFatigue,
    combinedFatigue: context.combinedFatigue,
    tasksCompleted: context.tasksCompleted,
    topEventCount: context.topEvents.length,
  })
}

async function hydrateExplanations() {
  const fallback = localExplanations.value
  explanations.value = fallback
  explanationError.value = ''

  const cacheKey = getExplanationCacheKey()
  if (explanationCache.value[cacheKey]) {
    explanations.value = explanationCache.value[cacheKey]
    return
  }
  if (!canUseAiAnalysis.value) return

  explanationLoading.value = true
  try {
    const result = await explainDailyAnalysis(explanationContext.value, store.currentWorkspaceId)
    if (!result?.ok || !result?.explanations) {
      explanationError.value = result?.reason === 'no_api_key'
        ? 'Add your own AI API key in Settings to enable richer daily explanations.'
        : (result?.message || 'The AI provider could not explain this day.')
      return
    }
    const nextExplanations = {
      daySummary: result.explanations.daySummary || fallback.daySummary,
      focusWhy: result.explanations.focusWhy || fallback.focusWhy,
      fatigueWhy: result.explanations.fatigueWhy || fallback.fatigueWhy,
      habitWhy: result.explanations.habitWhy || fallback.habitWhy,
    }
    explanationCache.value = { ...explanationCache.value, [cacheKey]: nextExplanations }
    explanations.value = nextExplanations
  } catch (error) {
    explanationError.value = error?.message || 'The AI provider could not explain this day.'
  } finally {
    explanationLoading.value = false
  }
}

watch(
  () => [
    selectedDateKey.value,
    dailyAnalysisModel.value.focusAverage,
    dailyAnalysisModel.value.combinedFatigue,
    completedTasks.value.length,
    topEvents.value.map((event) => event.id).join('|'),
  ].join(':'),
  () => { void hydrateExplanations() },
  { immediate: true },
)
</script>

<template>
  <div class="daily-analysis">
    <section v-if="props.showHero" class="hero-card analysis-hero">
      <div class="hero-copy">
        <span class="hero-label">Daily analysis</span>
        <h2 class="hero-title">{{ selectedDateLabel }}</h2>
        <p class="hero-text">{{ explanations.daySummary || localExplanations.daySummary }}</p>
        <div class="hero-meta">
          <span class="meta-pill">{{ explanationModeLabel }}</span>
          <span class="meta-pill">{{ activeTabSourceNote }}</span>
        </div>
      </div>
      <div class="hero-side">
        <div class="date-nav">
          <button class="date-icon-btn" type="button" @click="shiftDay(-1)" aria-label="Previous day"><ArrowLeftIcon size="16" /></button>
          <div class="date-pill"><CalendarIcon size="14" /><span>{{ selectedDateLabel }}</span></div>
          <input v-model="selectedDateKey" class="date-input" type="date" :max="todayKey" />
          <button class="date-icon-btn" :disabled="!canMoveForward" type="button" @click="shiftDay(1)" aria-label="Next day"><ArrowRightIcon size="16" /></button>
        </div>
        <button class="secondary-btn" :disabled="isSelectedToday" type="button" @click="jumpToToday">Today</button>
        <div class="hero-stats">
          <article v-for="stat in heroStats" :key="stat.label" class="hero-stat">
            <strong>{{ stat.value }}</strong>
            <span>{{ stat.label }}</span>
          </article>
        </div>
      </div>
    </section>

    <section v-if="props.showHero && topEvents.length" class="panel">
      <div class="panel-head">
        <div>
          <h2>Top 3 meaningful events</h2>
          <p>Click an event to jump to the right daily evidence tab.</p>
        </div>
      </div>
      <div class="event-grid">
        <button v-for="event in topEvents" :key="event.id" class="event-card" :class="{ active: selectedEvent?.id === event.id }" type="button" @click="jumpToEvent(event)">
          <span class="event-time">{{ event.timeLabel }}</span>
          <strong>{{ event.title }}</strong>
          <p>{{ event.detail }}</p>
          <span class="event-link">{{ event.linkedTab }}</span>
        </button>
      </div>
    </section>

    <section class="tabs-toolbar">
      <div v-if="props.showTabs" class="tabs-row">
        <button v-for="tab in tabs" :key="tab.id" class="tab-btn" :class="{ active: activeTab === tab.id }" type="button" @click="activeTab = tab.id">{{ tab.label }}</button>
      </div>
      <div class="context-bar" :class="{ compact: !props.showTabs }">
        <p>{{ activeTabSourceNote }}</p>
        <div class="source-badges" :class="{ toggle: canToggleSource }">
          <button v-for="badge in activeTabSourceBadges" :key="badge.id" class="source-badge" :class="[badge.tone, { active: activeSourceMode === badge.id }]" :disabled="!canToggleSource" type="button" @click="activeSourceMode = badge.id">{{ badge.label }}</button>
        </div>
      </div>
    </section>

    <section v-if="activeTab === 'overview'" class="tab-grid">
      <article class="panel evidence-panel">
        <div class="panel-head">
          <div>
            <h2>Daily story</h2>
            <p>{{ explanationError || 'BYOK AI explains the day from real evidence when available. Built-in analysis takes over automatically when it is not.' }}</p>
          </div>
          <span class="panel-badge">{{ explanationModeLabel }}</span>
        </div>
        <details open class="evidence-block">
          <summary>What defined this day?</summary>
          <p>{{ explanations.daySummary || localExplanations.daySummary }}</p>
        </details>
        <details class="evidence-block">
          <summary>What were the strongest signals?</summary>
          <ul class="event-list">
            <li v-for="event in topEvents" :key="event.id">
              <button type="button" class="event-link-btn" @click="jumpToEvent(event)">
                <strong>{{ event.timeLabel }}</strong>
                <span>{{ event.title }}</span>
              </button>
            </li>
          </ul>
        </details>
      </article>
      <article class="panel">
        <div class="summary-stack">
          <article class="summary-card">
            <span>Strongest session</span>
            <strong>{{ dailyAnalysisModel.strongestSession?.goal || dailyAnalysisModel.strongestSession?.taskTitle || dailyAnalysisModel.strongestSession?.habit || 'No focus session' }}</strong>
            <p>{{ dailyAnalysisModel.strongestSession ? `${dailyAnalysisModel.strongestSession.focusScore}/100 focus` : 'No session evidence yet' }}</p>
          </article>
          <article class="summary-card">
            <span>Top category</span>
            <strong>{{ dailyAnalysisModel.topCategory?.category || 'No dominant lane' }}</strong>
            <p>{{ dailyAnalysisModel.topCategory ? formatActivityDuration(dailyAnalysisModel.topCategory.seconds || 0) : 'Background tracking is still building' }}</p>
          </article>
          <article class="summary-card">
            <span>Background load</span>
            <strong>{{ `${dailyAnalysisModel.backgroundFatigue?.score || 0}%` }}</strong>
            <p>{{ dailyAnalysisModel.backgroundFatigue?.dominantDriver || 'No strain driver yet' }}</p>
          </article>
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'focus'" class="focus-depth">
      <div class="focus-highlight-grid">
        <article
          v-for="card in focusHighlightCards"
          :key="card.label"
          class="focus-highlight-card"
          :class="card.tone"
        >
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <p>{{ card.detail }}</p>
        </article>
      </div>

      <div v-if="focusDepthEntries.length" class="focus-analysis-stack">
        <article class="panel chart-panel chart-panel-wide">
          <div class="panel-head">
            <div>
              <h2>{{ activeSourceMode === 'background' ? 'Depth across the workday' : 'Depth across focus blocks' }}</h2>
              <p>
                {{
                  activeSourceMode === 'background'
                    ? 'Four depth pillars across passive work windows, so you can see where attention held or broke.'
                    : 'Four focus pillars across intentional blocks, with the selected evidence expanded below.'
                }}
              </p>
            </div>
            <span class="panel-badge">{{ activeSourceMode === 'background' ? 'Background-based' : 'Session-based' }}</span>
          </div>

          <div class="focus-day-strip">
            <div class="focus-day-label">Day view</div>
            <div class="focus-day-track">
              <button
                v-for="pos in focusDayTimelinePositions"
                :key="`day-pos-${pos.id}`"
                class="focus-day-session-block"
                :class="[pos.tone, { active: pos.isSelected }]"
                :style="{ left: pos.left, width: pos.width }"
                :title="`${pos.label} · ${pos.score}/100`"
                type="button"
                @click="selectFocusSession(pos.raw)"
              ></button>
            </div>
            <div class="focus-day-axis">
              <span v-for="h in [0, 6, 12, 18, 23]" :key="h" :style="{ left: `${(h / 24 * 100).toFixed(1)}%` }">{{ formatHourLabel(h) }}</span>
            </div>
          </div>

          <VueApexCharts
            type="bar"
            height="320"
            :options="focusPerformanceOptions"
            :series="focusPerformanceSeries"
          />
          <div class="focus-flow-rail" :class="{ compact: focusComparisonRows.length <= 3 }">
            <button
              v-for="entry in focusComparisonRows"
              :key="`focus-flow-${entry.id}`"
              class="focus-flow-pill"
              :class="{ active: entry.isSelected }"
              type="button"
              @click="selectFocusSession(entry.raw)"
            >
              <span>{{ entry.timeLabel }}</span>
              <strong>{{ entry.label }}</strong>
              <em>{{ entry.focusScore }}/100 depth</em>
            </button>
          </div>
        </article>

        <article class="panel focus-readout-panel">
          <div class="panel-head">
            <div>
              <h2>{{ activeSourceMode === 'background' ? 'Selected window' : 'Selected session' }}</h2>
              <p>{{ selectedFocusSession?.timeLabel || `Pick a ${activeSourceMode === 'background' ? 'background window' : 'focus block'} to inspect its structure.` }}</p>
            </div>
          </div>
          <div v-if="selectedFocusSession" class="focus-readout-header">
            <strong>{{ selectedFocusSession.title }}</strong>
            <span v-if="selectedFocusSession.subtitle" class="focus-readout-subtitle">{{ selectedFocusSession.subtitle }}</span>
            <div class="focus-score-pills">
              <span class="focus-score-pill focus">{{ selectedFocusSession.focusScore || 0 }}/100 {{ activeSourceMode === 'background' ? 'depth' : 'focus' }}</span>
              <span class="focus-score-pill pressure">{{ selectedFocusSession.browserPressureScore || 0 }}/100 browser pressure</span>
            </div>
          </div>

          <div v-if="selectedFocusSession" class="focus-pillar-cards">
            <article v-for="pillar in focusPillarCardItems" :key="pillar.key" class="focus-pillar-card" :class="pillar.colorClass">
              <span>{{ pillar.name }}</span>
              <strong>{{ pillar.value }}<em>/100</em></strong>
              <p>{{ pillar.note }}</p>
            </article>
          </div>
          <div class="focus-chip-grid">
            <article v-for="chip in focusReadoutChips" :key="chip.label" class="focus-chip-card">
              <span>{{ chip.label }}</span>
              <strong>{{ chip.value }}</strong>
            </article>
          </div>
          <div v-if="selectedFocusSession" class="score-evidence-panel">
            <div class="score-evidence-head">
              <strong>Score evidence</strong>
              <span class="info-hint">
                <CircleHelpIcon size="14" />
                <span class="info-hint-bubble">These rows show the measured inputs behind the score, not AI-generated guesses. Browser pressure now feeds the same depth model too.</span>
              </span>
            </div>
            <div class="score-evidence-list">
              <article v-for="row in focusScoreEvidenceRows" :key="row.label" class="score-evidence-row">
                <div class="score-evidence-copy">
                  <div class="score-evidence-label">
                    <strong>{{ row.label }}</strong>
                    <span class="info-hint">
                      <CircleHelpIcon size="13" />
                      <span class="info-hint-bubble">{{ row.info }}</span>
                    </span>
                  </div>
                  <span>{{ row.note }}</span>
                </div>
                <strong>{{ row.value }}</strong>
              </article>
            </div>
          </div>
          <div v-if="selectedFocusSession && (selectedFocusAppEvidenceRowsShared.length || selectedFocusBrowserEvidenceRowsShared.length)" class="focus-context-grid">
            <article class="context-evidence-panel">
              <div class="score-evidence-head">
                <strong>Apps in this {{ activeSourceMode === 'background' ? 'window' : 'block' }}</strong>
                <span class="info-hint">
                  <CircleHelpIcon size="14" />
                  <span class="info-hint-bubble">These are the top tracked apps overlapping the selected time window, with durations and lane outcomes.</span>
                </span>
              </div>
              <div v-if="selectedFocusAppEvidenceRowsShared.length" class="context-evidence-list">
                <article v-for="row in selectedFocusAppEvidenceRowsShared" :key="row.id" class="context-evidence-row">
                  <div>
                    <strong>{{ row.label }}</strong>
                    <span>{{ row.context }}</span>
                  </div>
                  <div class="context-evidence-meta">
                    <span class="app-usage-chip" :class="row.laneKey">{{ row.lane }}</span>
                    <strong>{{ row.duration }}</strong>
                    <span>{{ row.note }}</span>
                  </div>
                </article>
              </div>
              <p v-else class="mini-empty">No tracked app evidence overlaps this {{ activeSourceMode === 'background' ? 'window' : 'block' }}.</p>
            </article>
            <article class="context-evidence-panel">
              <div class="score-evidence-head">
                <strong>Browser evidence</strong>
                <span class="info-hint">
                  <CircleHelpIcon size="14" />
                  <span class="info-hint-bubble">Saved extension events overlapping this same time window. These can lower continuity and explain browser-driven drift.</span>
                </span>
              </div>
              <div v-if="selectedFocusBrowserEvidenceRowsShared.length" class="context-evidence-list">
                <article v-for="row in selectedFocusBrowserEvidenceRowsShared" :key="row.id" class="context-evidence-row">
                  <div>
                    <strong>{{ truncateLabel(row.label, 40) }}</strong>
                    <span>{{ row.note }}</span>
                  </div>
                  <span class="app-usage-chip muted">{{ row.badge }}</span>
                </article>
              </div>
              <p v-else class="mini-empty">No browser switches, new tabs, or audible overlap were saved for this {{ activeSourceMode === 'background' ? 'window' : 'block' }}.</p>
            </article>
          </div>
          <details open class="evidence-block">
            <summary>Why this {{ activeSourceMode === 'background' ? 'window' : 'session' }} landed here</summary>
            <p>{{ selectedFocusSession?.focusWhy || explanations.focusWhy || localExplanations.focusWhy }}</p>
          </details>
        </article>
      </div>

      <article v-if="!focusDepthEntries.length" class="panel">
        <div class="panel-head">
          <div>
            <h2>{{ activeSourceMode === 'background' ? 'Depth windows' : 'Focus blocks' }}</h2>
            <p>
              {{
                activeSourceMode === 'background'
                  ? 'Each window shows background-derived depth, lane mix, and nearby task wins from passive work.'
                  : 'Each block keeps score, pillar shape, lane mix, and completion evidence readable at a glance.'
              }}
            </p>
          </div>
        </div>
        <div v-if="focusDepthEntries.length" class="focus-session-grid">
          <button
            v-for="session in focusDepthEntries"
            :key="session.id"
            class="focus-session-card"
            :class="[session.tone, { active: selectedFocusSession?.id === session.id }]"
            type="button"
            @click="selectFocusSession(session)"
          >
            <div class="focus-session-head">
              <div class="focus-session-copy">
                <span class="focus-session-time">{{ session.timeLabel }}</span>
                <strong>{{ session.title }}</strong>
                <span v-if="session.subtitle" class="focus-session-subtitle">{{ session.subtitle }}</span>
              </div>
              <div class="focus-session-badges">
                <span class="focus-score-pill focus">{{ session.focusScore || 0 }}/100</span>
                <span v-if="session.browserPressureScore" class="focus-score-pill pressure">{{ session.browserPressureScore }}/100 browser</span>
              </div>
            </div>

            <div class="focus-session-meta">
              <span class="focus-mini-chip">{{ session.durationLabel }}</span>
              <span class="focus-mini-chip">{{ truncateLabel(session.leadApp, 22) }}</span>
              <span v-if="session.completedTaskCount" class="focus-mini-chip warm">{{ session.completedTaskCount }} task wins</span>
              <span v-if="session.browserSignals?.tabSwitches" class="focus-mini-chip browser">{{ session.browserSignals.tabSwitches }} tab switches</span>
              <span v-if="session.browserSignals?.audibleMoments" class="focus-mini-chip warn">{{ session.browserSignals.audibleMoments }} audible</span>
              <span v-if="session.switchRate" class="focus-mini-chip muted">{{ Number(session.switchRate).toFixed(1) }}/m switches</span>
            </div>

            <div v-if="session.mixSegments.length" class="focus-mix-track">
              <span
                v-for="segment in session.mixSegments"
                :key="segment.key"
                class="focus-mix-segment"
                :style="{ width: `${segment.share}%`, background: segment.color }"
              ></span>
            </div>

            <div class="focus-session-stats">
              <article class="focus-stat">
                <span>Drift</span>
                <strong>{{ session.driftCount || 0 }}</strong>
              </article>
              <article class="focus-stat">
                <span>Recovery</span>
                <strong>{{ session.recoveryCount || 0 }}</strong>
              </article>
              <article class="focus-stat">
                <span>{{ session.primaryDisruptionLabel || 'Disruptive share' }}</span>
                <strong>{{ session.primaryDisruptionValue ?? (session.distractions || 0) }}</strong>
              </article>
              <article class="focus-stat">
                <span>Switch rate</span>
                <strong>{{ session.switchRate || 0 }}/m</strong>
              </article>
            </div>

            <div v-if="session.completedTaskTitles.length" class="focus-task-list">
              <span class="focus-task-label">Completed during or around this block</span>
              <div class="focus-task-chips">
                <span v-for="taskTitle in session.completedTaskTitles" :key="taskTitle" class="focus-task-chip">{{ taskTitle }}</span>
              </div>
            </div>
          </button>
        </div>
        <div v-else class="empty-panel compact-empty">
          <TargetIcon size="28" />
          <p>{{ activeSourceMode === 'background' ? 'No qualifying background depth windows were detected on this date yet.' : 'No focus sessions were recorded on this date yet.' }}</p>
        </div>
      </article>
    </section>

    <section v-else-if="activeTab === 'apps'" class="apps-analysis">
      <div class="apps-highlight-grid">
        <article
          v-for="card in appUsageHighlights"
          :key="card.label"
          class="apps-highlight-card"
          :class="card.tone"
        >
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <p>{{ card.detail }}</p>
        </article>
      </div>

      <div class="apps-visual-grid">
        <article class="panel chart-panel chart-panel-wide">
          <div class="panel-head">
            <div>
              <h2>App landscape</h2>
              <p>Switch the sort to inspect top apps by time, recency, switching, or quality of work.</p>
            </div>
            <div class="panel-head-actions">
              <div class="sort-chip-row">
                <button
                  v-for="option in appSortOptions"
                  :key="option.id"
                  type="button"
                  class="sort-chip"
                  :class="{ active: appSortMode === option.id }"
                  @click="appSortMode = option.id"
                >
                  {{ option.label }}
                </button>
              </div>
              <span class="panel-badge">{{ appsList.length }} tracked apps</span>
            </div>
          </div>
          <VueApexCharts
            v-if="appLandscapeSeries[0].data.length"
            type="treemap"
            height="318"
            :options="appLandscapeOptions"
            :series="appLandscapeSeries"
          />
          <div v-else class="empty-panel compact-empty">
            <MonitorIcon size="28" />
            <p>No background app usage was captured on this date.</p>
          </div>
        </article>

        <article class="panel chart-panel chart-panel-side">
          <div class="panel-head">
            <div>
              <h2>Category mix</h2>
              <p>Foreground activity grouped by the dominant work category.</p>
            </div>
          </div>
          <VueApexCharts
            v-if="categoryMixSeries.length"
            type="donut"
            height="280"
            :options="categoryMixOptions"
            :series="categoryMixSeries"
          />
          <div v-else class="empty-panel compact-empty">
            <p>No category mix is available for this day yet.</p>
          </div>
          <div class="category-row-list">
            <div v-for="category in appCategoryRows" :key="category.category" class="category-row">
              <div class="category-main">
                <span class="category-swatch" :style="{ background: category.color }"></span>
                <strong>{{ category.category }}</strong>
              </div>
              <span class="category-share">{{ category.share }}</span>
              <span class="category-time">{{ formatActivityDuration(category.seconds) }}</span>
            </div>
          </div>
        </article>
      </div>

      <article class="panel usage-explorer-panel">
        <div class="panel-head">
          <div>
            <h2>Usage explorer</h2>
            <p>One cleaner evidence rail for apps, browser context, and media instead of separate repeated lists.</p>
          </div>
          <div class="panel-head-actions">
            <div class="sort-chip-row">
              <button
                v-for="option in usageExplorerOptions"
                :key="option.id"
                type="button"
                class="sort-chip"
                :class="{ active: usageExplorerMode === option.id }"
                @click="usageExplorerMode = option.id"
              >
                {{ option.label }}
              </button>
            </div>
            <div class="sort-chip-row compact">
              <button
                v-for="option in usageExplorerSortOptions"
                :key="`${usageExplorerMode}-${option.id}`"
                type="button"
                class="sort-chip compact"
                :class="{ active: usageExplorerMode === 'apps' ? appSortMode === option.id : usageExplorerMode === 'media' ? mediaSortMode === option.id : browserSortMode === option.id }"
                @click="usageExplorerMode === 'apps' ? appSortMode = option.id : usageExplorerMode === 'media' ? mediaSortMode = option.id : browserSortMode = option.id"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="usage-explorer-stats">
          <article v-for="card in usageExplorerStats" :key="card.label" class="usage-stat-card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </article>
        </div>

        <div class="usage-explorer-toolbar">
          <input
            v-model="usageExplorerQuery"
            type="text"
            class="usage-search-input"
            placeholder="Search apps, sites, pages, or media"
          />
          <div class="sort-chip-row compact">
            <button
              v-for="option in usageExplorerLaneOptions"
              :key="`${usageExplorerMode}-lane-${option.id}`"
              type="button"
              class="sort-chip compact"
              :class="{ active: usageExplorerLaneFilter === option.id }"
              @click="usageExplorerLaneFilter = option.id"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div v-if="recentBrowserEventRows.length" class="browser-signal-strip">
          <article v-for="card in browserSignalCards" :key="card.label" class="browser-signal-chip">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </article>
        </div>

        <div v-if="filteredUsageExplorerRows.length" class="usage-explorer-scroll">
          <article v-for="row in filteredUsageExplorerRows" :key="row.id" class="usage-explorer-row">
            <div class="usage-explorer-main">
              <div class="usage-explorer-title">
                <span class="app-usage-swatch" :style="{ background: row.color }"></span>
                <div>
                  <strong>{{ truncateLabel(row.title, usageExplorerMode === 'pages' ? 56 : 32) }}</strong>
                  <span>{{ row.subtitle }}</span>
                </div>
              </div>
              <div class="usage-explorer-pills">
                <span class="app-usage-chip" :class="row.lane">{{ formatLaneLabel(row.lane) }}</span>
                <span class="app-usage-chip muted">{{ formatActivityDuration(row.seconds) }}</span>
                <span v-if="usageExplorerMode !== 'media'" class="app-usage-chip muted">{{ row.switches }} switches</span>
              </div>
            </div>

            <div class="usage-explorer-track">
              <div class="usage-explorer-fill" :style="{ width: `${Math.max(8, Math.round((Number(row.seconds || 0) / filteredUsageExplorerMaxSeconds) * 100))}%`, background: row.color }"></div>
            </div>

            <div class="usage-explorer-footer">
              <span>{{ row.helper }}</span>
              <div class="usage-explorer-meta">
                <span>Seen {{ formatLastSeen(row.lastTs) }}</span>
                <button
                  v-if="!row.correctionBlocked"
                  type="button"
                  class="evidence-action-btn icon-only"
                  title="Correct this classification"
                  @click="openRuleEditor({
                    target: row.correctionTarget,
                    label: row.correctionLabel,
                    source: row.correctionSource,
                    category: row.correctionCategory,
                    lane: row.correctionLane,
                  })"
                ><SlidersHorizontalIcon size="14" /></button>
                <span v-else class="tracked-app-note">{{ row.correctionNote }}</span>
              </div>
            </div>
          </article>
        </div>
        <div v-else class="empty-panel compact-empty">
          <p>No {{ usageExplorerMode === 'media' ? 'background media' : usageExplorerMode }} evidence matched this view yet.</p>
        </div>

        <div v-if="recentBrowserEventRows.length" class="usage-browser-feed">
          <div class="panel-subhead">
            <strong>Recent browser events</strong>
            <span>{{ recentBrowserEventRows.length }} latest saved events</span>
          </div>
          <div class="browser-event-feed">
            <article v-for="event in recentBrowserEventRows" :key="event.id" class="browser-event-row">
              <div class="browser-event-copy">
                <span class="browser-event-type">{{ event.eventLabel }}</span>
                <strong>{{ truncateLabel(event.title, 54) }}</strong>
                <span>{{ truncateLabel(event.detail, 46) }}</span>
              </div>
              <div class="browser-event-meta">
                <span>{{ event.timeLabel }}</span>
                <span class="app-usage-chip" :class="event.laneKey">{{ event.laneLabel }}</span>
                <span v-if="event.audible" class="app-usage-chip muted">Audible</span>
                <span v-if="event.active" class="app-usage-chip muted">Active</span>
              </div>
            </article>
          </div>
        </div>
      </article>
      
      <!-- consolidated usage explorer replaces older browser/media/app duplicate lists -->
      <div style="display:none">
        <article class="panel chart-panel">
          <div class="panel-head">
            <div>
              <h2>Browser contexts</h2>
              <p>
                {{
                  browserViewMode === 'page'
                    ? 'Page-level browser evidence for the selected day, kept separate from app totals.'
                    : 'Site-level browser evidence so Chrome-heavy days stay readable.'
                }}
              </p>
            </div>
            <div class="panel-head-actions">
              <div class="sort-chip-row compact">
                <button
                  v-for="option in browserViewOptions"
                  :key="option.id"
                  type="button"
                  class="sort-chip compact"
                  :class="{ active: browserViewMode === option.id }"
                  @click="browserViewMode = option.id"
                >
                  {{ option.label }}
                </button>
              </div>
              <div class="sort-chip-row compact">
                <button
                  v-for="option in browserSortOptions"
                  :key="option.id"
                  type="button"
                  class="sort-chip compact"
                  :class="{ active: browserSortMode === option.id }"
                  @click="browserSortMode = option.id"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
          <VueApexCharts
            v-if="browserUsageSeries[0].data.length"
            type="bar"
            height="268"
            :options="browserUsageOptions"
            :series="browserUsageSeries"
          />
          <div v-else class="empty-panel compact-empty">
            <p>No browser context was detected on this date.</p>
          </div>
          <div v-if="browserCards.length" class="browser-row-list">
            <article v-for="site in browserCards" :key="`${browserViewMode}-${site.label}`" class="browser-row">
              <div class="browser-row-main">
                <strong>{{ truncateLabel(site.label, browserViewMode === 'page' ? 44 : 28) }}</strong>
                <span>{{ site.app }} - {{ formatLaneLabel(site.dominantLane) }}</span>
              </div>
              <div class="browser-row-meta">
                <span>{{ formatActivityDuration(site.seconds) }}</span>
                <span>{{ Math.round((Number(site.confidence || 0) || 0) * 100) }}% confidence</span>
                <span>Seen {{ formatLastSeen(site.lastTs) }}</span>
                <button
                  type="button"
                  class="evidence-action-btn icon-only"
                  title="Correct site or page classification"
                  @click="openRuleEditor({
                    target: browserViewMode === 'page' ? (site.host || site.label) : site.host || site.label,
                    label: site.label,
                    source: browserViewMode,
                    category: site.category,
                    lane: site.dominantLane,
                  })"
                ><SlidersHorizontalIcon size="14" /></button>
              </div>
            </article>
          </div>
        </article>

        <article class="panel apps-evidence-panel">
          <div class="panel-head">
            <div>
              <h2>Media and evidence</h2>
              <p>Playback stays contextual, while diagnostics show how trustworthy the captured day is.</p>
            </div>
            <div class="sort-chip-row compact">
              <button
                v-for="option in mediaSortOptions"
                :key="option.id"
                type="button"
                class="sort-chip compact"
                :class="{ active: mediaSortMode === option.id }"
                @click="mediaSortMode = option.id"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="evidence-section">
            <span class="evidence-label">Background media</span>
            <div v-if="mediaCards.length" class="media-card-list">
              <article v-for="media in mediaCards" :key="media.label" class="media-card">
                <div class="media-head">
                  <strong>{{ truncateLabel(media.label, 28) }}</strong>
                  <span>{{ formatActivityDuration(media.seconds) }}</span>
                </div>
                <p>
                  {{ media.sourceApp }}<span v-if="media.artist"> - {{ media.artist }}</span>
              <span v-if="media.lastTs"> - last seen {{ formatLastSeen(media.lastTs) }}</span>
                </p>
                <button
                  type="button"
                  class="evidence-action-btn icon-only"
                  title="Correct media classification"
                  @click="openRuleEditor({
                    target: media.sourceApp,
                    label: media.sourceApp,
                    source: 'media',
                    category: media.category,
                    lane: media.lane,
                  })"
                ><SlidersHorizontalIcon size="14" /></button>
              </article>
            </div>
            <p v-else class="mini-empty">No background media was captured for this day.</p>
          </div>

          <div class="evidence-section">
            <span class="evidence-label">Tracking quality</span>
            <div class="diagnostics-grid">
              <article v-for="card in diagnosticsCards" :key="card.label" class="diagnostic-card">
                <span>{{ card.label }}</span>
                <strong>{{ card.value }}</strong>
              </article>
            </div>
          </div>
        </article>
      </div>

      <div style="display:none">
      <article class="panel">
        <div class="panel-head">
          <div>
            <h2>Top apps today</h2>
            <p>Each card keeps time, recency, lane, switching, and lead context visible at a glance.</p>
          </div>
          <span class="panel-badge">{{ appSortOptions.find((option) => option.id === appSortMode)?.label || 'Top used' }}</span>
        </div>
        <div v-if="appUsageCards.length" class="app-card-grid">
          <article v-for="app in appUsageCards" :key="app.app" class="app-usage-card">
            <div class="app-usage-head">
              <div class="app-usage-main">
                <span class="app-usage-swatch" :style="{ background: app.color }"></span>
                <div>
                  <strong>{{ app.app }}</strong>
                  <span>{{ app.category }}</span>
                </div>
              </div>
              <span class="app-usage-time">{{ formatActivityDuration(app.seconds) }}</span>
            </div>

            <div class="app-usage-meta">
              <span class="app-usage-chip">{{ app.share }} of tracked time</span>
              <span class="app-usage-chip muted">{{ app.switches }} switches</span>
              <span class="app-usage-chip" :class="app.dominantLane">{{ formatLaneLabel(app.dominantLane) }}</span>
            </div>

            <div class="app-usage-track">
              <div
                class="app-usage-fill"
                :style="{ width: `${app.progress}%`, background: app.color }"
              ></div>
            </div>

            <div class="app-usage-foot">
              <span>{{ truncateLabel(app.contextLabel || app.subcategory || 'No lead context', 34) }}</span>
              <span>{{ Math.round((Number(app.confidence || 0) || 0) * 100) }}% confidence - {{ formatLastSeen(app.lastTs) }}</span>
            </div>

            <button
              v-if="!app.isBrowserDriven"
              type="button"
              class="evidence-action-btn icon-only"
              title="Correct app classification"
              @click="openRuleEditor({
                target: app.app,
                label: app.app,
                source: 'app',
                category: app.category,
                lane: app.dominantLane,
              })"
            ><SlidersHorizontalIcon size="14" /></button>
            <span v-else class="app-usage-inline-note">Correct this through Sites or Pages</span>
          </article>
        </div>
        <div v-else class="empty-panel compact-empty">
          <p>No app evidence cards are available on this day yet.</p>
        </div>

        <div v-if="appsList.length" class="tracked-apps-scroll-wrap">
          <div class="panel-subhead">
            <strong>All tracked apps</strong>
            <span>{{ appsList.length }} entries</span>
          </div>
          <div class="tracked-apps-scroll">
            <article v-for="app in appsList" :key="`tracked-${app.app}`" class="tracked-app-row">
              <div class="tracked-app-main">
                <span class="app-usage-swatch" :style="{ background: app.color }"></span>
                <div>
                  <strong>{{ app.app }}</strong>
                  <span>{{ app.category }} - {{ formatLaneLabel(app.dominantLane) }}</span>
                </div>
              </div>
              <div class="tracked-app-meta">
                <span>{{ formatActivityDuration(app.seconds) }}</span>
                <span>{{ app.switches }} switches</span>
                <span>Seen {{ formatLastSeen(app.lastTs) }}</span>
                <button
                  v-if="!(Number(app.browserContextCount || 0) > 0 || Number(app.browserShare || 0) >= 0.35)"
                  type="button"
                  class="evidence-action-btn icon-only"
                  title="Correct app classification"
                  @click="openRuleEditor({
                    target: app.app,
                    label: app.app,
                    source: 'app',
                    category: app.category,
                    lane: app.dominantLane,
                  })"
                ><SlidersHorizontalIcon size="14" /></button>
                <span v-else class="tracked-app-note">Use site/page correction</span>
              </div>
            </article>
          </div>
        </div>
      </article>
      </div>

      <Transition name="modal-fade">
        <div v-if="showCorrectionModal" class="modal-overlay" @click.self="closeRuleEditor">
          <div class="modal-card correction-modal-card">
            <div class="modal-header">
              <div>
                <h3>Correction flow</h3>
                <p>Save a compact override for this workspace from the selected evidence.</p>
              </div>
              <button type="button" class="modal-close" @click="closeRuleEditor">
                <XIcon size="16" />
              </button>
            </div>

            <div class="correction-grid">
              <article class="correction-target-card">
                <span>Selected target</span>
                <strong>{{ ruleLabel || 'Nothing selected yet' }}</strong>
                <p v-if="ruleTarget">Matching key: {{ ruleTarget }}</p>
                <p v-else>Use the small control icon on an app, site, page, or media row.</p>
                <div class="correction-target-meta" v-if="ruleTarget">
                  <span class="app-usage-chip muted">{{ ruleSource }}</span>
                  <span v-if="activeCustomRule" class="app-usage-chip supporting">Existing override</span>
                </div>
              </article>

              <div class="correction-form">
                <label class="correction-field">
                  <span>Category</span>
                  <select v-model="ruleCategory" class="correction-select" :disabled="!ruleTarget || ruleSubmitting">
                    <option v-for="category in correctionCategories" :key="category" :value="category">{{ category }}</option>
                  </select>
                </label>

                <label class="correction-field">
                  <span>Lane</span>
                  <select v-model="ruleLane" class="correction-select" :disabled="!ruleTarget || ruleSubmitting">
                    <option v-for="lane in correctionLaneOptions" :key="lane.id" :value="lane.id">{{ lane.label }}</option>
                  </select>
                </label>

                <div class="correction-actions">
                  <button
                    type="button"
                    class="correction-primary-btn"
                    :disabled="!ruleTarget || ruleSubmitting"
                    @click="saveRuleOverride"
                  >
                    {{ ruleSubmitting ? 'Saving...' : 'Save override' }}
                  </button>
                  <button
                    type="button"
                    class="correction-secondary-btn"
                    :disabled="!activeCustomRule || ruleSubmitting"
                    @click="removeRuleOverride"
                  >
                    Remove rule
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </section>

    <section v-else-if="activeTab === 'fatigue'" class="fatigue-depth">
      <div class="fatigue-highlight-grid">
        <article
          v-for="card in fatigueHighlightCards"
          :key="card.label"
          class="fatigue-highlight-card"
          :class="card.tone"
        >
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <p>{{ card.detail }}</p>
        </article>
      </div>

      <div class="fatigue-analysis-stack">
        <article class="panel chart-panel chart-panel-wide">
          <div class="panel-head">
            <div>
              <h2>Strain profile</h2>
              <p>
                {{
                  activeSourceMode === 'session'
                    ? 'Session fatigue plotted in the order your focus blocks happened.'
                    : activeSourceMode === 'background'
                      ? 'Background strain mapped through the day as switching and distracting load changed.'
                      : 'Combined fatigue shows where session pressure and background strain overlapped.'
                }}
              </p>
            </div>
            <span class="panel-badge">{{ fatigueState.label }}</span>
          </div>
          <div v-if="activeSourceMode === 'session' && focusSessionsDetailed.length" class="focus-day-strip">
            <div class="focus-day-label">Sessions across the day</div>
            <div class="focus-day-track">
              <button
                v-for="pos in focusDayTimelinePositions"
                :key="`fatigue-day-${pos.id}`"
                class="focus-day-session-block"
                :class="[pos.tone, { active: pos.isSelected }]"
                :style="{ left: pos.left, width: pos.width }"
                :title="`${pos.label} · ${pos.score}/100 focus`"
                type="button"
              ></button>
            </div>
            <div class="focus-day-axis">
              <span v-for="h in [0, 6, 12, 18, 23]" :key="h" :style="{ left: `${(h / 24 * 100).toFixed(1)}%` }">{{ formatHourLabel(h) }}</span>
            </div>
          </div>

          <VueApexCharts
            :type="activeSourceMode === 'session' ? 'bar' : 'area'"
            height="340"
            :options="fatigueTimelineOptions"
            :series="fatigueTimelineSeries"
          />
        </article>

        <article class="panel fatigue-readout-panel">
          <div class="panel-head">
            <div>
              <h2>Driver ladder</h2>
              <p>{{ explanations.fatigueWhy || localExplanations.fatigueWhy }}</p>
            </div>
            <span class="info-hint">
              <CircleHelpIcon size="14" />
              <span class="info-hint-bubble">Fatigue is deterministic here. BYOK AI can explain it, but it does not set the score. The ladder is built from weighted duration, switching, lane pressure, uncertainty, late load, and browser pressure.</span>
            </span>
          </div>
          <div class="fatigue-state-pill" :class="fatigueState.tone">
            <strong>{{ fatigueState.label }}</strong>
            <span>
              {{
                activeSourceMode === 'session'
                  ? `${dailyAnalysisModel.sessionFatigueAverage || 0}% session fatigue`
                  : activeSourceMode === 'background'
                    ? `${dailyAnalysisModel.backgroundFatigue?.score || 0}% background fatigue`
                    : `${dailyAnalysisModel.combinedFatigue || 0}% combined fatigue`
              }}
            </span>
          </div>
          <div class="fatigue-driver-list">
            <article
              v-for="driver in fatigueDriverRows"
              :key="driver.label"
              class="fatigue-driver-row"
              :style="{ '--driver-color': driver.color }"
            >
              <div class="fatigue-driver-copy">
                <strong>{{ driver.label }}</strong>
                <span class="fatigue-driver-pct">{{ Math.round(driver.value || 0) }}%</span>
              </div>
              <div class="fatigue-driver-track">
                <span
                  class="fatigue-driver-fill"
                  :style="{ width: `${Math.max(3, Math.min(100, Math.round(driver.value || 0)))}%`, background: driver.color }"
                ></span>
              </div>
            </article>
          </div>
        </article>
      </div>

      <div class="fatigue-evidence-stack">
        <article class="panel fatigue-evidence-panel">
          <div class="panel-head">
            <div>
              <h2>Highest strain moment</h2>
              <p>One clear moment to inspect instead of a vague daily warning.</p>
            </div>
          </div>
          <div class="fatigue-moment-card">
            <div class="fatigue-moment-time">{{ fatigueMomentCard?.timeLabel || '--' }}</div>
            <strong>{{ fatigueMomentCard?.title || 'No clear fatigue spike recorded' }}</strong>
            <p>{{ fatigueMomentCard?.detail || 'Fatigue has not yet produced a standout event on this day.' }}</p>
            <div v-if="fatigueMomentCard?.metrics?.length" class="fatigue-metric-chips">
              <span v-for="metric in fatigueMomentCard.metrics" :key="metric" class="fatigue-metric-chip">{{ metric }}</span>
            </div>
          </div>
          <div v-if="fatigueEvidenceRows.length" class="score-evidence-panel compact">
            <div class="score-evidence-head">
              <strong>Why this scored this way</strong>
              <span class="info-hint">
                <CircleHelpIcon size="14" />
                <span class="info-hint-bubble">These rows show the exact evidence feeding the current fatigue source: session, background, or combined.</span>
              </span>
            </div>
            <div class="fatigue-evidence-feed">
              <article v-for="row in fatigueEvidenceRows" :key="row.label" class="fatigue-feed-row">
                <div class="fatigue-feed-left">
                  <div class="fatigue-feed-label">
                    <strong>{{ row.label }}</strong>
                    <span class="info-hint">
                      <CircleHelpIcon size="13" />
                      <span class="info-hint-bubble">{{ row.info }}</span>
                    </span>
                  </div>
                  <span class="fatigue-feed-note">{{ row.note }}</span>
                </div>
                <span class="fatigue-feed-value">{{ row.value }}</span>
              </article>
            </div>
          </div>
          <div v-if="fatigueContextAppsShared.length || fatigueContextBrowserRowsShared.length" class="focus-context-grid fatigue-context-grid">
            <article class="context-evidence-panel">
              <div class="score-evidence-head">
                <strong>Apps around the strain moment</strong>
                <span class="info-hint">
                  <CircleHelpIcon size="14" />
                  <span class="info-hint-bubble">These are the strongest tracked apps overlapping the highest-strain window or weakest session.</span>
                </span>
              </div>
              <div v-if="fatigueContextAppsShared.length" class="context-evidence-list">
                <article v-for="row in fatigueContextAppsShared" :key="row.id" class="context-evidence-row">
                  <div>
                    <strong>{{ row.label }}</strong>
                    <span>{{ row.note }}</span>
                  </div>
                  <div class="context-evidence-meta">
                    <span class="app-usage-chip" :class="row.laneKey">{{ row.lane }}</span>
                    <strong>{{ row.duration }}</strong>
                  </div>
                </article>
              </div>
              <p v-else class="mini-empty">No app evidence was captured around the highest-strain moment.</p>
            </article>
            <article class="context-evidence-panel">
              <div class="score-evidence-head">
                <strong>Browser signals around strain</strong>
                <span class="info-hint">
                  <CircleHelpIcon size="14" />
                  <span class="info-hint-bubble">These saved extension events overlapped the same fatigue window and can explain fragmentation or passive media overlap.</span>
                </span>
              </div>
              <div v-if="fatigueContextBrowserRowsShared.length" class="context-evidence-list">
                <article v-for="row in fatigueContextBrowserRowsShared" :key="row.id" class="context-evidence-row">
                  <div>
                    <strong>{{ truncateLabel(row.label, 40) }}</strong>
                    <span>{{ row.note }}</span>
                  </div>
                  <span class="app-usage-chip muted">{{ row.badge }}</span>
                </article>
              </div>
              <p v-else class="mini-empty">No saved browser events overlapped the highest-strain window.</p>
            </article>
          </div>
        </article>

        <article class="panel fatigue-evidence-panel">
          <div class="panel-head">
            <div>
              <h2>Recovery windows</h2>
              <p>Signals that the day gave you room to reset instead of only adding pressure.</p>
            </div>
          </div>
          <div class="fatigue-recovery-grid">
            <article class="fatigue-recovery-card">
              <span>Session recoveries</span>
              <strong>{{ focusSessionStats.totalRecovery || 0 }}</strong>
              <p>{{ focusSessionStats.totalDrift || 0 }} drift moments were matched against your recoveries.</p>
            </article>
            <article class="fatigue-recovery-card">
              <span>Calm background windows</span>
              <strong>{{ backgroundCalmWindows.length || 0 }}</strong>
              <p>Longer productive or supporting windows with low switching are counted here.</p>
            </article>
          </div>
          <div v-if="backgroundCalmWindowRows.length" class="context-evidence-list calm-window-list">
            <article v-for="window in backgroundCalmWindowRows" :key="window.id" class="context-evidence-row">
              <div>
                <strong>{{ truncateLabel(window.title, 32) }}</strong>
                <span>{{ window.timeLabel }} - {{ window.durationLabel }}</span>
              </div>
              <div class="context-evidence-meta">
                <span class="app-usage-chip productive">{{ window.focusScore || 0 }}/100 depth</span>
                <span class="app-usage-chip muted">{{ window.browserPressureScore || 0 }}/100 browser pressure</span>
              </div>
            </article>
          </div>
        </article>
      </div>
    </section>

    <section v-else class="habits-depth">
      <div class="habits-highlight-grid">
        <article
          v-for="card in habitHighlightCards"
          :key="card.label"
          class="habits-highlight-card"
          :class="card.tone"
        >
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <p>{{ card.detail }}</p>
        </article>
      </div>

      <div class="habits-visual-grid">
        <article class="panel chart-panel chart-panel-wide">
          <div class="panel-head">
            <div>
              <h2>{{ activeSourceMode === 'manual' ? 'Target progress' : 'Habit performance' }}</h2>
              <p>
                {{
                  activeSourceMode === 'manual'
                    ? 'Each bar compares logged minutes against the habit target for the selected day.'
                    : 'Habit-linked sessions are ranked by focus quality, with minutes and task wins kept in the hover details.'
                }}
              </p>
            </div>
            <span class="panel-badge">{{ activeSourceMode === 'manual' ? `${habitManualRows.length} habits` : `${habitSessionRows.length} active habits` }}</span>
          </div>
          <VueApexCharts
            v-if="activeSourceMode === 'manual' ? habitManualRows.length : habitSessionRows.length"
            type="bar"
            height="292"
            :options="activeSourceMode === 'manual' ? habitManualChartOptions : habitSessionChartOptions"
            :series="activeSourceMode === 'manual' ? habitManualChartSeries : habitSessionChartSeries"
          />
          <div v-else class="empty-panel compact-empty">
            <ListTodoIcon size="28" />
            <p>{{ activeSourceMode === 'manual' ? 'No habits are configured yet.' : 'No habit-linked sessions landed on this day.' }}</p>
          </div>
        </article>

        <article class="panel habits-evidence-panel">
          <div class="panel-head">
            <div>
              <h2>Habit impact</h2>
              <p>{{ explanations.habitWhy || localExplanations.habitWhy }}</p>
            </div>
          </div>
          <div class="habit-impact-card">
            <span>{{ activeSourceMode === 'manual' ? 'Focus today' : 'Strongest habit' }}</span>
            <strong>{{ selectedHabitLead?.name || 'No clear habit lead' }}</strong>
            <p v-if="selectedHabitLead && activeSourceMode === 'manual'">
              {{ selectedHabitLead.totalMinutes || 0 }}m of {{ selectedHabitLead.targetMinutes || 0 }}m target, with {{ selectedHabitLead.sessions || 0 }} linked focus session{{ selectedHabitLead.sessions === 1 ? '' : 's' }}.
            </p>
            <p v-else-if="selectedHabitLead">
              {{ selectedHabitLead.avgFocus || 0 }}/100 average focus across {{ selectedHabitLead.sessions || 0 }} habit-linked session{{ selectedHabitLead.sessions === 1 ? '' : 's' }} and {{ selectedHabitLead.completedTaskCount || 0 }} task win{{ selectedHabitLead.completedTaskCount === 1 ? '' : 's' }}.
            </p>
            <p v-else>No habit evidence is strong enough on this day yet.</p>
          </div>

          <div class="habit-completion-block">
            <span class="habit-block-label">Completed task evidence</span>
            <div v-if="completedTasks.length" class="habit-task-list">
              <article v-for="task in completedTasks.slice(0, 5)" :key="task.id" class="habit-task-card">
                <strong>{{ task.title }}</strong>
                <p>{{ task.habit ? `Linked to ${task.habit}` : 'Completed task' }}</p>
              </article>
            </div>
            <p v-else class="mini-empty">No task completions were recorded for this day.</p>
          </div>
        </article>
      </div>

      <article class="panel">
        <div class="panel-head">
          <div>
            <h2>{{ activeSourceMode === 'manual' ? 'Habit board' : 'Habit-linked evidence' }}</h2>
            <p>
              {{
                activeSourceMode === 'manual'
                  ? 'Daily targets, linked focus minutes, and task wins are visible in one board.'
                  : 'These cards show which habits actually translated into focused work on the selected day.'
              }}
            </p>
          </div>
        </div>
        <div v-if="displayedHabitCards.length" class="habit-card-grid">
          <article v-for="habit in displayedHabitCards" :key="habit.id || habit.name" class="habit-evidence-card">
            <div class="habit-evidence-head">
              <div>
                <strong>{{ habit.name }}</strong>
                <span>{{ activeSourceMode === 'manual' ? 'Manual target' : 'Session evidence' }}</span>
              </div>
              <span class="habit-evidence-time">{{ habit.totalMinutes || 0 }}m</span>
            </div>

            <div v-if="activeSourceMode === 'manual'" class="habit-progress-rail">
              <div
                class="habit-progress-fill-strong"
                :style="{ width: `${Math.min(100, Math.round(((Number(habit.totalMinutes || 0)) / Math.max(Number(habit.targetMinutes || 1), 1)) * 100))}%` }"
              ></div>
            </div>

            <div class="habit-evidence-meta">
              <span class="habit-evidence-chip">{{ activeSourceMode === 'manual' ? `${habit.targetMinutes || 0}m target` : `${habit.avgFocus || 0}/100 focus` }}</span>
              <span class="habit-evidence-chip muted">{{ habit.sessions || 0 }} session{{ habit.sessions === 1 ? '' : 's' }}</span>
              <span v-if="habit.completedTaskCount" class="habit-evidence-chip warm">{{ habit.completedTaskCount }} task win{{ habit.completedTaskCount === 1 ? '' : 's' }}</span>
              <span v-if="activeSourceMode === 'manual' && habit.achieved" class="habit-evidence-chip good">On target</span>
            </div>

            <p class="habit-evidence-copy" v-if="activeSourceMode === 'manual'">
              {{ habit.totalMinutes || 0 }}m logged and {{ habit.sessions || 0 }} linked focus session{{ habit.sessions === 1 ? '' : 's' }} for this day.
            </p>
            <p class="habit-evidence-copy" v-else>
              Best session reached {{ habit.bestSessionScore || 0 }}/100 focus, with {{ habit.completedTaskCount || 0 }} habit-linked completion{{ habit.completedTaskCount === 1 ? '' : 's' }}.
            </p>
          </article>
        </div>
        <div v-else class="empty-panel compact-empty">
          <ListTodoIcon size="28" />
          <p>{{ activeSourceMode === 'manual' ? 'No habits are configured yet.' : 'No habit-linked sessions landed on this day.' }}</p>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.daily-analysis { min-width: 0; max-width: 100%; }
.daily-analysis, .daily-analysis * { box-sizing: border-box; }
.daily-analysis, .hero-side, .hero-stats, .summary-stack, .session-list, .tabs-toolbar { display: flex; flex-direction: column; gap: 16px; }
.hero-card, .panel, .hero-stat, .summary-card, .event-card { border-radius: 22px; border: 1px solid var(--border-light); background: var(--bg-card); box-shadow: 0 14px 30px rgba(15,23,42,.045); }
.analysis-hero, .event-grid, .tab-grid { display: grid; gap: 18px; }
.analysis-hero { grid-template-columns: minmax(0,1.08fr) minmax(320px,.92fr); padding: 24px; background: radial-gradient(circle at top right, rgba(0,180,216,.08), transparent 28%), linear-gradient(135deg, color-mix(in srgb, var(--bg-card) 96%, transparent), color-mix(in srgb, var(--surface-muted) 88%, transparent)); }
.event-grid { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.tab-grid { grid-template-columns: minmax(0,1fr) minmax(320px,.92fr); }
.panel { padding: 22px; }
.hero-label, .summary-card span, .event-time, .event-link, .hero-stat span { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); }
.hero-title { font-size: 24px; font-weight: 800; letter-spacing: -.04em; }
.hero-text, .panel-head p, .summary-card p, .event-card p, .context-bar p, .empty-panel p, .evidence-block p { font-size: 13px; line-height: 1.58; color: var(--text-muted); }
.date-nav, .tabs-row, .context-bar, .hero-meta, .source-badges, .panel-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.panel-head, .context-bar { justify-content: space-between; align-items: flex-start; gap: 14px; }
.date-nav { padding: 8px; border-radius: 18px; border: 1px solid var(--border-light); background: color-mix(in srgb, var(--surface-strong, var(--bg-card)) 82%, transparent); }
.date-pill, .secondary-btn, .date-icon-btn, .tab-btn, .meta-pill, .panel-badge { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--border-light); background: var(--surface-muted); color: var(--text-muted); font-size: 12px; font-weight: 700; font-family: inherit; }
.secondary-btn, .date-icon-btn, .tab-btn, .event-card, .source-badges.toggle .source-badge, .event-link-btn { cursor: pointer; }
.panel-head-actions,
.sort-chip-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sort-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--surface-strong, var(--bg-card));
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .05em;
  text-transform: uppercase;
  font-family: inherit;
  cursor: pointer;
  transition: border-color .18s ease, background .18s ease, color .18s ease, transform .18s ease;
}
.sort-chip.compact {
  padding: 7px 10px;
  font-size: 10px;
}
.sort-chip:hover,
.sort-chip.active {
  color: #0f172a;
  border-color: rgba(14,165,233,.3);
  background: linear-gradient(135deg, rgba(224,242,254,.88), rgba(240,253,250,.94));
  transform: translateY(-1px);
}
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15,23,42,.28);
  backdrop-filter: blur(8px);
}
.modal-card {
  width: min(860px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  border-radius: 24px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  box-shadow: 0 28px 60px rgba(15,23,42,.18);
}
.correction-modal-card {
  padding: 22px;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}
.modal-header h3 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text-main);
}
.modal-header p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}
.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--surface-strong, var(--bg-card));
  color: var(--text-muted);
  cursor: pointer;
  transition: transform .18s ease, border-color .18s ease, color .18s ease;
}
.modal-close:hover {
  transform: translateY(-1px);
  border-color: rgba(14,165,233,.26);
  color: var(--text-main);
}
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity .18s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
.date-icon-btn { width: 38px; height: 38px; padding: 0; }
.date-input { border: 1px solid var(--border-light); border-radius: 12px; background: var(--bg-card); color: var(--text-main); font-size: 12px; font-weight: 600; padding: 10px 12px; min-width: 148px; outline: none; }
.hero-stat, .summary-card { padding: 14px 16px; background: var(--bg-card); }
.hero-stat strong, .summary-card strong, .event-card strong, .metric-list strong, .selected-event strong { display: block; font-size: 15px; font-weight: 800; color: var(--text-main); }
.event-card { text-align: left; padding: 16px; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.event-card:hover, .event-card.active, .tab-btn.active, .source-badge.active { transform: translateY(-1px); box-shadow: 0 12px 24px rgba(14,165,233,.12); }
.tab-btn.active { color: #fff; border-color: transparent; background: linear-gradient(135deg, #0ea5e9, #14b8a6); }
.context-bar { padding: 12px 16px; border-radius: 18px; border: 1px solid var(--border-light); background: var(--surface-strong, var(--bg-card)); }
.context-bar.compact { margin-top: 0; }
.source-badge { display: inline-flex; align-items: center; justify-content: center; padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(148,163,184,.18); background: var(--surface-strong, var(--bg-card)); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
.source-badge.combined { color: #0f766e; background: rgba(20,184,166,.08); }
.source-badge.session { color: #0c4a6e; background: rgba(14,165,233,.08); }
.source-badge.background { color: #7c3aed; background: rgba(139,92,246,.08); }
.source-badge.manual { color: #b45309; background: rgba(245,158,11,.1); }
.evidence-panel { display: flex; flex-direction: column; gap: 12px; }
.evidence-block { padding: 14px 16px; border-radius: 18px; border: 1px solid rgba(148,163,184,.12); background: var(--bg-card); }
.evidence-block summary { cursor: pointer; font-size: 13px; font-weight: 800; color: var(--text-main); }
.event-list, .metric-list, .selected-event ul { margin: 10px 0 0; padding: 0; list-style: none; }
.event-link-btn { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: none; background: transparent; padding: 0; text-align: left; font-family: inherit; color: inherit; }
.empty-panel { min-height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; }
.info-hint {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: var(--text-muted);
  background: var(--surface-strong, var(--bg-card));
  border: 1px solid rgba(148,163,184,.14);
  flex: 0 0 auto;
}
.info-hint-bubble {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  z-index: 12;
  width: 240px;
  padding: 10px 12px;
  border-radius: 14px;
  background: #0f172a;
  color: #f8fafc;
  box-shadow: 0 18px 36px rgba(15,23,42,.22);
  font-size: 11px;
  line-height: 1.5;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px);
  transition: opacity .16s ease, transform .16s ease;
}
.info-hint:hover .info-hint-bubble,
.info-hint:focus-within .info-hint-bubble {
  opacity: 1;
  transform: translateY(0);
}
.score-evidence-panel,
.context-evidence-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.score-evidence-panel.compact {
  margin-top: 14px;
}
.score-evidence-head,
.score-evidence-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.score-evidence-head strong,
.context-evidence-row strong {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-main);
}
.score-evidence-list,
.context-evidence-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.score-evidence-row,
.context-evidence-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.score-evidence-copy,
.context-evidence-row > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.score-evidence-copy span,
.context-evidence-row span {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}
.score-evidence-row > strong,
.context-evidence-meta strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-main);
}
.focus-context-grid,
.fatigue-context-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}
.context-evidence-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  text-align: right;
}
.calm-window-list {
  margin-top: 16px;
}
.apps-analysis,
.apps-highlight-grid,
.apps-visual-grid,
.apps-support-grid,
.app-card-grid,
.browser-row-list,
.correction-grid,
.category-row-list,
.media-card-list,
.diagnostics-grid,
.usage-explorer-stats {
  display: grid;
  gap: 16px;
}
.apps-analysis { gap: 18px; }
.apps-highlight-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.apps-highlight-card {
  padding: 18px 18px 16px;
  border-radius: 22px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--bg-card);
  box-shadow: 0 14px 28px rgba(15,23,42,.035);
}
.apps-highlight-card span,
.diagnostic-card span,
.evidence-label,
.app-usage-main span {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.apps-highlight-card strong {
  display: block;
  margin: 10px 0 8px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -.04em;
  color: var(--text-main);
}
.apps-highlight-card p,
.media-card p,
.mini-empty,
.app-usage-foot {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}
.apps-highlight-card.teal strong { color: #0f766e; }
.apps-highlight-card.slate strong { color: #334155; }
.apps-highlight-card.violet strong { color: #6d28d9; }
.apps-highlight-card.amber strong { color: #c2410c; }
.apps-visual-grid {
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, .75fr);
}
.apps-support-grid {
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr);
}
.usage-explorer-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.usage-explorer-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.usage-search-input {
  width: 100%;
  border: 1px solid rgba(148,163,184,.16);
  border-radius: 14px;
  background: var(--bg-card);
  color: var(--text-main);
  font-size: 13px;
  font-weight: 600;
  padding: 12px 14px;
  outline: none;
  font-family: inherit;
}
.usage-search-input:focus {
  border-color: rgba(14,165,233,.28);
  box-shadow: 0 0 0 4px rgba(14,165,233,.08);
}
.usage-explorer-stats {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.usage-stat-card {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.usage-stat-card span {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.usage-stat-card strong {
  display: block;
  margin-top: 8px;
  font-size: 18px;
  font-weight: 800;
  color: var(--text-main);
}
.usage-explorer-scroll {
  max-height: 620px;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.usage-explorer-scroll::-webkit-scrollbar {
  width: 6px;
}
.usage-explorer-scroll::-webkit-scrollbar-thumb {
  background: rgba(148,163,184,.34);
  border-radius: 999px;
}
.usage-explorer-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.usage-explorer-main,
.usage-explorer-title,
.usage-explorer-pills,
.usage-explorer-footer,
.usage-explorer-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.usage-explorer-main,
.usage-explorer-footer {
  justify-content: space-between;
}
.usage-explorer-title {
  min-width: 0;
}
.usage-explorer-title > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.usage-explorer-title strong {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.usage-explorer-title span,
.usage-explorer-footer span,
.usage-explorer-meta span {
  font-size: 12px;
  color: var(--text-muted);
}
.usage-explorer-pills {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.usage-explorer-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(226,232,240,.85);
  overflow: hidden;
}

:global(.dark-theme .daily-analysis .hero-card),
:global(.dark-theme .daily-analysis .panel),
:global(.dark-theme .daily-analysis .hero-stat),
:global(.dark-theme .daily-analysis .summary-card),
:global(.dark-theme .daily-analysis .event-card){
  border-color: rgba(148,163,184,.16) !important;
  background: var(--bg-card) !important;
  box-shadow: 0 18px 36px rgba(0,0,0,.2) !important;
}
:global(.dark-theme .daily-analysis .chart-panel){
  border-color: rgba(148,163,184,.16) !important;
  background: var(--bg-card) !important;
}
:global(.dark-theme .daily-analysis .context-bar),
:global(.dark-theme .daily-analysis .source-badge),
:global(.dark-theme .daily-analysis .evidence-block),
:global(.dark-theme .daily-analysis .score-evidence-panel),
:global(.dark-theme .daily-analysis .context-evidence-panel),
:global(.dark-theme .daily-analysis .score-evidence-row),
:global(.dark-theme .daily-analysis .usage-stat-card),
:global(.dark-theme .daily-analysis .usage-explorer-row),
:global(.dark-theme .daily-analysis .apps-highlight-card),
:global(.dark-theme .daily-analysis .usage-search-input){
  background: var(--bg-card);
}

:global(.dark-theme .daily-analysis .timeline-preview-card),
:global(.dark-theme .daily-analysis .timeline-zoom-card),
:global(.dark-theme .daily-analysis .timeline-lane-card),
:global(.dark-theme .daily-analysis .focus-card-lane){
  background: var(--bg-card);
}

:global(.dark-theme .daily-analysis .timeline-preview-track),
:global(.dark-theme .daily-analysis .timeline-track),
:global(.dark-theme .daily-analysis .usage-explorer-track){
  background: color-mix(in srgb, var(--surface-muted) 74%, #000 26%);
}
:global(.dark-theme .daily-analysis .sort-chip),
:global(.dark-theme .daily-analysis .date-pill),
:global(.dark-theme .daily-analysis .secondary-btn),
:global(.dark-theme .daily-analysis .date-icon-btn),
:global(.dark-theme .daily-analysis .tab-btn),
:global(.dark-theme .daily-analysis .meta-pill),
:global(.dark-theme .daily-analysis .panel-badge){
  border-color: rgba(148,163,184,.16);
  background: rgba(15,23,42,.62);
  color: #a8bdd4;
}
:global(.dark-theme .daily-analysis .sort-chip:hover),
:global(.dark-theme .daily-analysis .sort-chip.active){
  color: #67e8f9;
  border-color: rgba(103,232,249,.28);
  background: rgba(8,145,178,.16);
}
.usage-explorer-fill {
  height: 100%;
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(255,255,255,.32) inset;
}
.usage-explorer-meta {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.browser-signal-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.browser-signal-chip {
  min-width: 138px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.browser-signal-chip span,
.browser-event-type {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.browser-signal-chip strong {
  display: block;
  margin-top: 8px;
  font-size: 18px;
  font-weight: 800;
  color: var(--text-main);
}
.browser-signal-chip p,
.browser-event-copy span,
.browser-event-meta span {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}
.usage-browser-feed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.browser-event-feed {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.browser-event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.browser-event-copy,
.browser-event-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.browser-event-copy strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.browser-event-meta {
  align-items: flex-end;
  flex-shrink: 0;
}
.chart-panel {
  background:
    radial-gradient(circle at top right, rgba(14,165,233,.06), transparent 36%),
    var(--surface-muted);
}
.chart-panel-wide {
  min-height: 410px;
}
.chart-panel-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.panel-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(125,211,252,.32);
  background: rgba(224,242,254,.78);
  color: #0284c7;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.category-row-list {
  gap: 10px;
}
.browser-row-list {
  gap: 10px;
}
.category-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 16px;
  background: var(--surface-muted);
  border: 1px solid rgba(148,163,184,.12);
}
.category-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.category-main strong,
.media-head strong,
.app-usage-main strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-main);
}
.category-swatch,
.app-usage-swatch {
  width: 11px;
  height: 11px;
  border-radius: 999px;
  flex-shrink: 0;
}
.category-share,
.category-time,
.media-head span,
.app-usage-time {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-main);
}
.browser-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--surface-muted);
}
.browser-row-main,
.browser-row-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.browser-row-main {
  min-width: 0;
}
.browser-row-main strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.browser-row-main span,
.browser-row-meta span {
  font-size: 12px;
  color: var(--text-muted);
}
.browser-row-meta {
  align-items: flex-end;
  flex-shrink: 0;
}
.panel-subhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
}
.panel-subhead strong,
.tracked-app-main strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-main);
}
.panel-subhead span,
.tracked-app-main span,
.tracked-app-meta span,
.tracked-app-note,
.app-usage-inline-note {
  font-size: 12px;
  color: var(--text-muted);
}
.tracked-apps-scroll-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tracked-apps-scroll {
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tracked-apps-scroll::-webkit-scrollbar {
  width: 6px;
}
.tracked-apps-scroll::-webkit-scrollbar-thumb {
  background: rgba(148,163,184,.34);
  border-radius: 999px;
}
.tracked-app-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--surface-muted);
}
.tracked-app-main,
.tracked-app-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tracked-app-main > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.tracked-app-meta {
  flex-wrap: wrap;
  justify-content: flex-end;
}
.app-usage-inline-note {
  display: inline-flex;
  align-items: center;
  padding-top: 6px;
}
.apps-evidence-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.correction-grid {
  grid-template-columns: minmax(260px, .88fr) minmax(0, 1.12fr);
}
.correction-panel {
  background: var(--surface-muted);
}
.correction-target-card,
.correction-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.correction-target-card span,
.correction-field span {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.correction-target-card strong {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text-main);
}
.correction-target-card p {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}
.correction-target-meta,
.correction-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.correction-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.correction-select {
  border: 1px solid rgba(148,163,184,.16);
  border-radius: 14px;
  background: var(--bg-card);
  color: var(--text-main);
  font-size: 13px;
  font-weight: 700;
  padding: 12px 14px;
  outline: none;
  font-family: inherit;
}
.correction-primary-btn,
.correction-secondary-btn,
.evidence-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-family: inherit;
  font-weight: 800;
  cursor: pointer;
  transition: transform .18s ease, border-color .18s ease, background .18s ease, color .18s ease;
}
.correction-primary-btn,
.correction-secondary-btn {
  padding: 10px 14px;
  border: 1px solid transparent;
  font-size: 12px;
}
.correction-primary-btn {
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  color: #fff;
  box-shadow: 0 14px 28px rgba(14,165,233,.16);
}
.correction-secondary-btn {
  border-color: rgba(148,163,184,.18);
  background: var(--surface-muted);
  color: var(--text-muted);
}
.evidence-action-btn {
  width: fit-content;
  padding: 7px 10px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 11px;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.evidence-action-btn.icon-only {
  width: 30px;
  min-width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 10px;
}
.correction-primary-btn:hover,
.correction-secondary-btn:hover,
.evidence-action-btn:hover {
  transform: translateY(-1px);
}
.correction-primary-btn:disabled,
.correction-secondary-btn:disabled {
  opacity: .56;
  cursor: not-allowed;
  transform: none;
}
.evidence-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.media-card-list {
  gap: 10px;
}
.media-card,
.diagnostic-card,
.app-usage-card {
  border-radius: 18px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.media-card {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.media-head,
.app-usage-head,
.app-usage-main,
.app-usage-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.media-head {
  align-items: flex-start;
}
.diagnostics-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.diagnostic-card {
  padding: 12px 14px;
}
.diagnostic-card strong {
  display: block;
  margin-top: 8px;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text-main);
}
.app-card-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.app-usage-card {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 14px 30px rgba(15,23,42,.04);
}
.app-usage-main {
  justify-content: flex-start;
  min-width: 0;
}
.app-usage-main div {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}
.app-usage-main strong {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-usage-time {
  color: #0f766e;
}
.app-usage-meta {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.app-usage-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(20,184,166,.08);
  color: #0f766e;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.app-usage-chip.muted {
  background: rgba(148,163,184,.12);
  color: #64748b;
}
.app-usage-chip.productive {
  background: rgba(20,184,166,.1);
  color: #0f766e;
}
.app-usage-chip.supporting {
  background: rgba(124,58,237,.12);
  color: #5B21B6;
}
.app-usage-chip.unclear {
  background: rgba(249,115,22,.12);
  color: #C2410C;
}
.app-usage-chip.distracting {
  background: rgba(251,113,133,.12);
  color: #be123c;
}
.app-usage-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(226,232,240,.85);
  overflow: hidden;
}
.app-usage-fill {
  height: 100%;
  border-radius: 999px;
  box-shadow: 0 0 0 1px rgba(255,255,255,.32) inset;
}
.app-usage-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.focus-depth,
.focus-highlight-grid,
.focus-visual-grid,
.focus-analysis-stack,
.focus-chip-grid,
.focus-session-grid,
.focus-session-stats,
.focus-task-chips {
  display: grid;
  gap: 16px;
}
.focus-depth { gap: 18px; }
.focus-highlight-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.focus-highlight-card {
  padding: 18px;
  border-radius: 22px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--bg-card);
  box-shadow: 0 14px 28px rgba(15,23,42,.035);
}
.focus-highlight-card span,
.focus-chip-card span,
.focus-stat span,
.focus-task-label,
.focus-session-time {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.focus-highlight-card strong {
  display: block;
  margin: 10px 0 8px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -.04em;
  color: var(--text-main);
}
.focus-highlight-card p,
.focus-readout-panel p,
.focus-session-card p {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}
.focus-highlight-card.teal strong { color: #0f766e; }
.focus-highlight-card.blue strong { color: #0369a1; }
.focus-highlight-card.rose strong { color: #be123c; }
.focus-highlight-card.amber strong { color: #c2410c; }
.focus-visual-grid {
  grid-template-columns: minmax(0, 1.28fr) minmax(320px, .82fr);
}
.focus-analysis-stack {
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}
.focus-comparison-chart {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 14px;
  min-height: 298px;
  margin-top: 8px;
}
.focus-comparison-chart.compact .focus-comparison-plot {
  gap: 26px;
}
.focus-comparison-yaxis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 8px 0 50px;
}
.focus-comparison-yaxis span {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-soft);
}
.focus-comparison-plot {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  align-items: end;
  gap: 18px;
  min-height: 298px;
  padding: 8px 0 0;
}
.focus-comparison-gridline {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed rgba(148,163,184,.14);
}
.focus-comparison-gridline:nth-child(1) { top: 8px; }
.focus-comparison-gridline:nth-child(2) { top: 25%; }
.focus-comparison-gridline:nth-child(3) { top: 50%; }
.focus-comparison-gridline:nth-child(4) { top: 75%; }
.focus-comparison-gridline:nth-child(5) { bottom: 50px; }
.focus-comparison-group {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-height: 100%;
  padding: 12px 8px 0;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  transition: transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
}
.focus-comparison-group:hover,
.focus-comparison-group:focus-visible,
.focus-comparison-group.active {
  transform: translateY(-1px);
  border-color: rgba(14,165,233,.18);
  background: rgba(240,249,255,.54);
  box-shadow: 0 12px 24px rgba(14,165,233,.08);
}
.focus-comparison-bars {
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 190px;
  min-height: 190px;
}
.focus-comparison-bar {
  display: block;
  width: min(38px, 34%);
  min-width: 18px;
  border-radius: 14px 14px 10px 10px;
  box-shadow: 0 10px 22px rgba(15,23,42,.08);
  transition: transform .18s ease, opacity .18s ease;
}
.focus-comparison-group:hover .focus-comparison-bar,
.focus-comparison-group:focus-visible .focus-comparison-bar,
.focus-comparison-group.active .focus-comparison-bar {
  transform: translateY(-1px);
}
.focus-comparison-bar.focus {
  background: linear-gradient(180deg, rgba(45,212,191,.92), rgba(20,184,166,.9));
}
.focus-comparison-bar.fatigue {
  background: linear-gradient(180deg, rgba(251,113,133,.9), rgba(244,63,94,.88));
}
.focus-comparison-values {
  display: flex;
  align-items: center;
  gap: 12px;
}
.focus-comparison-values strong {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-soft);
}
.focus-comparison-label {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-main);
  text-align: center;
  line-height: 1.35;
}
.focus-comparison-time {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}
.focus-day-strip {
  margin: 12px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.focus-day-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.focus-day-track {
  position: relative;
  height: 24px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid rgba(148, 163, 184, 0.14);
  overflow: visible;
}
.focus-day-session-block {
  position: absolute;
  height: 100%;
  border-radius: 6px;
  min-width: 5px;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.focus-day-session-block.strong { background: #14b8a6; opacity: 0.65; }
.focus-day-session-block.steady { background: #38bdf8; opacity: 0.65; }
.focus-day-session-block.strained { background: #fb7185; opacity: 0.65; }
.focus-day-session-block.active { opacity: 1; box-shadow: 0 0 0 2px #ffffff, 0 0 0 3.5px currentColor; transform: scaleY(1.08); }
.focus-day-session-block:hover:not(.active) { opacity: 0.9; transform: scaleY(1.05); }
.focus-day-axis {
  position: relative;
  height: 16px;
}
.focus-day-axis span {
  position: absolute;
  font-size: 10px;
  font-weight: 600;
  color: #94a3b8;
  transform: translateX(-50%);
  white-space: nowrap;
}

.focus-pillar-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 4px;
}
.focus-pillar-card {
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.focus-pillar-card span {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #64748b;
}
.focus-pillar-card strong {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}
.focus-pillar-card strong em {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.55;
  font-style: normal;
}
.focus-pillar-card p {
  font-size: 11px;
  color: #64748b;
  line-height: 1.45;
  margin: 0;
}
.focus-pillar-card.teal strong { color: #0f766e; }
.focus-pillar-card.sky strong { color: #0369a1; }
.focus-pillar-card.violet strong { color: #6d28d9; }
.focus-pillar-card.green strong { color: #15803d; }

.focus-flow-rail {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin-top: 14px;
}
.focus-flow-rail.compact {
  grid-template-columns: repeat(auto-fit, minmax(180px, 220px));
}
.focus-flow-pill {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--bg-card);
  text-align: left;
  font-family: inherit;
  color: var(--text-main);
  cursor: pointer;
  transition: transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
}
.focus-flow-pill:hover,
.focus-flow-pill:focus-visible,
.focus-flow-pill.active {
  transform: translateY(-1px);
  border-color: rgba(20,184,166,.34);
  background: linear-gradient(135deg, rgba(236,253,245,.96), rgba(240,249,255,.9));
  box-shadow: 0 16px 30px rgba(14,165,233,.1);
}
.focus-flow-pill span {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--text-soft);
}
.focus-flow-pill strong {
  font-size: 13px;
  font-weight: 800;
  line-height: 1.25;
  color: var(--text-main);
}
.focus-flow-pill em {
  font-style: normal;
  font-size: 12px;
  font-weight: 800;
  color: #0f766e;
}
.focus-readout-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background:
    radial-gradient(circle at top right, rgba(14,165,233,.08), transparent 34%),
    var(--surface-strong, var(--bg-card));
}
.focus-readout-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.focus-readout-header strong {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text-main);
}
.focus-readout-subtitle,
.focus-session-subtitle {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text-muted);
}
.focus-score-pills,
.focus-session-badges,
.focus-session-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.focus-score-pill,
.focus-mini-chip,
.focus-task-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.focus-score-pill.focus {
  background: rgba(20,184,166,.1);
  color: #0f766e;
}
.focus-score-pill.fatigue {
  background: rgba(251,113,133,.1);
  color: #be123c;
}
.focus-score-pill.pressure {
  background: rgba(14,165,233,.1);
  color: #0369a1;
}
.focus-chip-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.focus-chip-card {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.focus-chip-card strong,
.focus-stat strong {
  display: block;
  margin-top: 8px;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-main);
}
.focus-session-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.focus-session-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid rgba(148,163,184,.14);
  background: var(--bg-card);
  box-shadow: 0 14px 30px rgba(15,23,42,.035);
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.focus-session-card:hover,
.focus-session-card.active {
  transform: translateY(-1px);
  box-shadow: 0 18px 34px rgba(14,165,233,.09);
  border-color: rgba(14,165,233,.24);
}
.focus-session-card.strong {
  background: linear-gradient(135deg, var(--bg-card), rgba(236,253,245,.96));
}
.focus-session-card.strained {
  background: linear-gradient(135deg, var(--bg-card), rgba(255,241,242,.94));
}
.focus-session-copy,
.focus-task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.focus-session-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.focus-session-copy strong {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -.03em;
  color: var(--text-main);
}
.focus-mini-chip {
  background: rgba(148,163,184,.12);
  color: #64748b;
}
.focus-mini-chip.warm {
  background: rgba(245,158,11,.12);
  color: #b45309;
}
.focus-mini-chip.browser {
  background: rgba(14,165,233,.12);
  color: #0369a1;
}
.focus-mini-chip.warn {
  background: rgba(251,113,133,.12);
  color: #be123c;
}
.focus-mini-chip.muted {
  background: rgba(226,232,240,.86);
  color: #475569;
}
.focus-mix-track {
  display: flex;
  align-items: center;
  width: 100%;
  height: 9px;
  border-radius: 999px;
  background: rgba(226,232,240,.85);
  overflow: hidden;
}
.focus-mix-segment {
  height: 100%;
}
.focus-session-stats {
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}
.focus-stat {
  padding: 12px 12px 10px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--surface-muted);
}
.focus-task-list {
  gap: 10px;
}
.focus-task-chips {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.focus-task-chip {
  justify-content: flex-start;
  background: rgba(59,130,246,.08);
  color: #1d4ed8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fatigue-depth,
.fatigue-highlight-grid,
.fatigue-visual-grid,
.fatigue-evidence-grid,
.fatigue-analysis-stack,
.fatigue-evidence-stack,
.fatigue-recovery-grid {
  display: grid;
  gap: 16px;
}
.fatigue-depth { gap: 18px; }
.fatigue-highlight-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.fatigue-highlight-card {
  padding: 18px;
  border-radius: 22px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--bg-card);
  box-shadow: 0 14px 28px rgba(15,23,42,.035);
}
.fatigue-highlight-card span,
.fatigue-recovery-card span,
.fatigue-moment-card span {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.fatigue-highlight-card strong,
.fatigue-recovery-card strong,
.fatigue-moment-card strong {
  display: block;
  margin: 10px 0 8px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -.04em;
  color: var(--text-main);
}
.fatigue-highlight-card p,
.fatigue-recovery-card p,
.fatigue-moment-card p {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}
.fatigue-highlight-card.teal strong { color: #0f766e; }
.fatigue-highlight-card.blue strong { color: #0369a1; }
.fatigue-highlight-card.rose strong { color: #be123c; }
.fatigue-highlight-card.amber strong { color: #c2410c; }
.fatigue-highlight-card.violet strong { color: #6d28d9; }
.fatigue-visual-grid,
.fatigue-evidence-grid {
  grid-template-columns: minmax(0, 1.18fr) minmax(320px, .82fr);
}
.fatigue-analysis-stack,
.fatigue-evidence-stack {
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}
.fatigue-readout-panel,
.fatigue-evidence-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background:
    radial-gradient(circle at top right, rgba(249,115,22,.08), transparent 34%),
    linear-gradient(135deg, rgba(255,255,255,.97), rgba(248,250,252,.96));
}
.fatigue-state-pill {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.fatigue-state-pill strong {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -.03em;
}
.fatigue-state-pill span {
  font-size: 13px;
  color: var(--text-muted);
}
.fatigue-state-pill.teal strong { color: #0f766e; }
.fatigue-state-pill.blue strong { color: #0369a1; }
.fatigue-state-pill.amber strong { color: #c2410c; }
.fatigue-state-pill.rose strong { color: #be123c; }
.fatigue-driver-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fatigue-driver-row {
  display: grid;
  gap: 8px;
  padding: 13px 16px 13px 20px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.12);
  border-left: 3px solid var(--driver-color, rgba(148,163,184,.4));
  background: var(--bg-card);
}
.fatigue-driver-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.fatigue-driver-copy strong {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-main);
}
.fatigue-driver-pct {
  font-size: 14px;
  font-weight: 900;
  color: var(--driver-color, var(--text-soft));
  font-variant-numeric: tabular-nums;
}
.fatigue-driver-track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: rgba(226,232,240,.82);
  overflow: hidden;
}
.fatigue-driver-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  box-shadow: 0 0 0 1px rgba(255,255,255,.22) inset;
  transition: width 0.4s ease;
}
.fatigue-moment-card,
.fatigue-recovery-card {
  padding: 18px 20px;
  border-radius: 18px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fatigue-moment-time {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.fatigue-metric-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.fatigue-metric-chip {
  display: inline-flex;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(249,115,22,.2);
  background: rgba(249,115,22,.08);
  color: #c2410c;
}
.fatigue-evidence-feed {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.fatigue-feed-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(148,163,184,.1);
}
.fatigue-feed-row:last-child { border-bottom: none; }
.fatigue-feed-left {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.fatigue-feed-label {
  display: flex;
  align-items: center;
  gap: 5px;
}
.fatigue-feed-label strong {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-main);
}
.fatigue-feed-note {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}
.fatigue-feed-value {
  font-size: 15px;
  font-weight: 900;
  color: var(--text-main);
  white-space: nowrap;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.fatigue-recovery-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.habits-depth,
.habits-highlight-grid,
.habits-visual-grid,
.habit-card-grid,
.habit-task-list {
  display: grid;
  gap: 16px;
}
.habits-depth { gap: 18px; }
.habits-highlight-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.habits-highlight-card {
  padding: 18px;
  border-radius: 22px;
  border: 1px solid rgba(148,163,184,.16);
  background: var(--bg-card);
  box-shadow: 0 14px 28px rgba(15,23,42,.035);
}
.habits-highlight-card span,
.habit-impact-card span,
.habit-block-label,
.habit-evidence-head span {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.habits-highlight-card strong,
.habit-impact-card strong,
.habit-task-card strong,
.habit-evidence-head strong {
  display: block;
  margin: 10px 0 8px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -.04em;
  color: var(--text-main);
}
.habits-highlight-card p,
.habit-impact-card p,
.habit-task-card p,
.habit-evidence-copy {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}
.habits-highlight-card.teal strong { color: #0f766e; }
.habits-highlight-card.blue strong { color: #0369a1; }
.habits-highlight-card.amber strong { color: #c2410c; }
.habits-highlight-card.violet strong { color: #6d28d9; }
.habits-visual-grid {
  grid-template-columns: minmax(0, 1.18fr) minmax(320px, .82fr);
}
.habits-evidence-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  background:
    radial-gradient(circle at top right, rgba(20,184,166,.08), transparent 34%),
    var(--surface-strong, var(--bg-card));
}
.habit-impact-card,
.habit-task-card,
.habit-evidence-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(148,163,184,.12);
  background: var(--bg-card);
}
.habit-impact-card strong {
  font-size: 20px;
}
.habit-completion-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.habit-task-list {
  gap: 10px;
}
.habit-card-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.habit-evidence-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 14px 30px rgba(15,23,42,.035);
}
.habit-evidence-head,
.habit-evidence-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.habit-evidence-head strong {
  margin: 0 0 4px;
  font-size: 18px;
}
.habit-evidence-time {
  font-size: 13px;
  font-weight: 800;
  color: #0f766e;
}
.habit-progress-rail {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: rgba(226,232,240,.85);
  overflow: hidden;
}
.habit-progress-fill-strong {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #14b8a6, #0ea5e9);
}
.habit-evidence-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(20,184,166,.08);
  color: #0f766e;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.habit-evidence-chip.muted {
  background: rgba(148,163,184,.12);
  color: #64748b;
}
.habit-evidence-chip.warm {
  background: rgba(245,158,11,.12);
  color: #b45309;
}
.habit-evidence-chip.good {
  background: rgba(34,197,94,.12);
  color: #15803d;
}
:global(.dark-theme .daily-analysis .focus-pillar-card){
  background: var(--bg-card);
  border-color: rgba(148, 163, 184, 0.18);
}
:global(.dark-theme .daily-analysis .focus-pillar-card.teal strong){ color: #2dd4bf; }
:global(.dark-theme .daily-analysis .focus-pillar-card.sky strong){ color: #38bdf8; }
:global(.dark-theme .daily-analysis .focus-pillar-card.violet strong){ color: #a78bfa; }
:global(.dark-theme .daily-analysis .focus-pillar-card.green strong){ color: #4ade80; }
:global(.dark-theme .daily-analysis .focus-pillar-card span),
:global(.dark-theme .daily-analysis .focus-pillar-card p){ color: #94a3b8; }
:global(.dark-theme .daily-analysis .focus-day-track){ background: rgba(148,163,184,.14); border-color: rgba(148,163,184,.16); }
:global(.dark-theme .daily-analysis .focus-highlight-card),
:global(.dark-theme .daily-analysis .fatigue-highlight-card),
:global(.dark-theme .daily-analysis .focus-flow-pill),
:global(.dark-theme .daily-analysis .focus-chip-card),
:global(.dark-theme .daily-analysis .focus-stat),
:global(.dark-theme .daily-analysis .focus-session-card),
:global(.dark-theme .daily-analysis .focus-session-card.strong),
:global(.dark-theme .daily-analysis .focus-session-card.strained),
:global(.dark-theme .daily-analysis .focus-comparison-group),
:global(.dark-theme .daily-analysis .score-evidence-panel),
:global(.dark-theme .daily-analysis .context-evidence-panel),
:global(.dark-theme .daily-analysis .score-evidence-row),
:global(.dark-theme .daily-analysis .context-evidence-row),
:global(.dark-theme .daily-analysis .fatigue-driver-row),
:global(.dark-theme .daily-analysis .fatigue-moment-card),
:global(.dark-theme .daily-analysis .fatigue-recovery-card),
:global(.dark-theme .daily-analysis .fatigue-state-pill){
  border-color: rgba(148,163,184,.18);
  background: var(--bg-card);
  color: #e5f0ff;
}
:global(.dark-theme .daily-analysis .focus-mini-chip),
:global(.dark-theme .daily-analysis .focus-task-chip){
  border: 1px solid rgba(148,163,184,.14);
  background: rgba(15,23,42,.68);
  color: #cbd5e1;
}
:global(.dark-theme .daily-analysis .focus-mini-chip.warm){
  color: #fbbf24;
  background: rgba(245,158,11,.14);
}
:global(.dark-theme .daily-analysis .focus-mini-chip.browser),
:global(.dark-theme .daily-analysis .focus-task-chip){
  color: #7dd3fc;
  background: rgba(14,165,233,.14);
}
:global(.dark-theme .daily-analysis .focus-mini-chip.warn){
  color: #fb7185;
  background: rgba(251,113,133,.14);
}
:global(.dark-theme .daily-analysis .focus-mini-chip.muted){
  color: #94a3b8;
  background: rgba(100,116,139,.16);
}
:global(.dark-theme .daily-analysis .focus-readout-panel),
:global(.dark-theme .daily-analysis .fatigue-readout-panel),
:global(.dark-theme .daily-analysis .fatigue-evidence-panel),
:global(.dark-theme .daily-analysis .habits-evidence-panel){
  border-color: rgba(148,163,184,.18);
  background: var(--bg-card);
}
:global(.dark-theme .daily-analysis .focus-readout-header strong),
:global(.dark-theme .daily-analysis .focus-session-copy strong),
:global(.dark-theme .daily-analysis .focus-chip-card strong),
:global(.dark-theme .daily-analysis .focus-stat strong),
:global(.dark-theme .daily-analysis .score-evidence-head strong),
:global(.dark-theme .daily-analysis .score-evidence-row > strong),
:global(.dark-theme .daily-analysis .context-evidence-row strong),
:global(.dark-theme .daily-analysis .fatigue-driver-copy strong),
:global(.dark-theme .daily-analysis .fatigue-highlight-card strong),
:global(.dark-theme .daily-analysis .fatigue-moment-card strong),
:global(.dark-theme .daily-analysis .fatigue-recovery-card strong),
:global(.dark-theme .daily-analysis .fatigue-state-pill strong){
  color: #f8fafc;
}
:global(.dark-theme .daily-analysis .score-evidence-copy span),
:global(.dark-theme .daily-analysis .focus-session-subtitle),
:global(.dark-theme .daily-analysis .focus-session-card p),
:global(.dark-theme .daily-analysis .context-evidence-row span),
:global(.dark-theme .daily-analysis .fatigue-state-pill span){
  color: #9fb2c8;
}
:global(.dark-theme .daily-analysis .focus-flow-pill:hover),
:global(.dark-theme .daily-analysis .focus-flow-pill:focus-visible),
:global(.dark-theme .daily-analysis .focus-flow-pill.active){
  border-color: rgba(34,211,238,.42);
  background: linear-gradient(135deg, rgba(14,165,233,.16), rgba(20,184,166,.1));
  box-shadow: 0 18px 34px rgba(0,0,0,.22);
}
:global(.dark-theme .daily-analysis .focus-flow-pill em),
:global(.dark-theme .daily-analysis .focus-score-pill.focus){
  color: #67e8f9;
}
:global(.dark-theme .daily-analysis .focus-score-pill.fatigue){
  color: #fb7185;
}
:global(.dark-theme .daily-analysis .focus-score-pill.pressure){
  color: #7dd3fc;
  background: rgba(14,165,233,.16);
}
:global(.dark-theme .daily-analysis .fatigue-driver-track),
:global(.dark-theme .daily-analysis .focus-mix-track),
:global(.dark-theme .daily-analysis .habit-progress-rail){
  background: color-mix(in srgb, var(--surface-muted) 72%, #000 28%);
}
:global(.dark-theme .daily-analysis .fatigue-driver-row){
  background: var(--bg-card);
  border-color: rgba(148, 163, 184, 0.12);
  border-left-color: var(--driver-color, rgba(148,163,184,.4));
}
:global(.dark-theme .daily-analysis .fatigue-moment-card),
:global(.dark-theme .daily-analysis .fatigue-recovery-card){
  background: var(--bg-card);
  border-color: rgba(148, 163, 184, 0.14);
}
:global(.dark-theme .daily-analysis .fatigue-feed-row){
  border-bottom-color: rgba(148, 163, 184, 0.1);
}
:global(.dark-theme .daily-analysis .fatigue-feed-label strong),
:global(.dark-theme .daily-analysis .fatigue-feed-value){
  color: #f8fafc;
}
:global(.dark-theme .daily-analysis .fatigue-feed-note),
:global(.dark-theme .daily-analysis .fatigue-moment-time){
  color: #94a3b8;
}
:global(.dark-theme .daily-analysis .fatigue-metric-chip){
  background: rgba(249,115,22,.12);
  border-color: rgba(249,115,22,.22);
  color: #fb923c;
}
:global(.dark-theme .daily-analysis .apexcharts-text),
:global(.dark-theme .daily-analysis .apexcharts-legend-text){
  fill: #cbd5e1 !important;
  color: #cbd5e1 !important;
}
:global(.dark-theme .daily-analysis .apexcharts-gridline){
  stroke: rgba(148,163,184,.18) !important;
}

:global(.dark-theme .daily-analysis .chart-panel),
:global(.dark-theme .daily-analysis .context-bar),
:global(.dark-theme .daily-analysis .summary-card),
:global(.dark-theme .daily-analysis .category-row),
:global(.dark-theme .daily-analysis .browser-row),
:global(.dark-theme .daily-analysis .browser-event-row),
:global(.dark-theme .daily-analysis .tracked-app-row),
:global(.dark-theme .daily-analysis .media-card),
:global(.dark-theme .daily-analysis .usage-stat-card),
:global(.dark-theme .daily-analysis .usage-explorer-row),
:global(.dark-theme .daily-analysis .app-usage-card),
:global(.dark-theme .daily-analysis .browser-signal-chip),
:global(.dark-theme .daily-analysis .habit-impact-card),
:global(.dark-theme .daily-analysis .habit-evidence-card){
  border-color: rgba(148,163,184,.16);
  background: var(--bg-card);
  color: #e5f0ff;
}

:global(.dark-theme .daily-analysis .focus-readout-panel),
:global(.dark-theme .daily-analysis .fatigue-readout-panel),
:global(.dark-theme .daily-analysis .fatigue-evidence-panel){
  color: #e5f0ff;
}

:global(.dark-theme .daily-analysis .category-main strong),
:global(.dark-theme .daily-analysis .media-head strong),
:global(.dark-theme .daily-analysis .app-usage-main strong),
:global(.dark-theme .daily-analysis .browser-row-main strong),
:global(.dark-theme .daily-analysis .browser-event-row strong),
:global(.dark-theme .daily-analysis .tracked-app-row strong),
:global(.dark-theme .daily-analysis .usage-explorer-row strong),
:global(.dark-theme .daily-analysis .habit-evidence-head strong),
:global(.dark-theme .daily-analysis .habit-impact-card strong),
:global(.dark-theme .daily-analysis .panel-head h3){
  color: #f8fafc;
}

:global(.dark-theme .daily-analysis .category-share),
:global(.dark-theme .daily-analysis .category-time),
:global(.dark-theme .daily-analysis .media-head span),
:global(.dark-theme .daily-analysis .app-usage-time),
:global(.dark-theme .daily-analysis .usage-explorer-meta),
:global(.dark-theme .daily-analysis .habit-evidence-card p),
:global(.dark-theme .daily-analysis .habit-impact-card p),
:global(.dark-theme .daily-analysis .panel-head p){
  color: #9fb2c8;
}

:global(.dark-theme .daily-analysis .usage-search-input){
  border-color: rgba(148,163,184,.18);
  background: rgba(15,23,42,.74);
  color: #e5f0ff;
}

:global(.dark-theme .daily-analysis .usage-search-input::placeholder){
  color: #7890aa;
}

:global(.dark-theme .daily-analysis .chart-panel .apexcharts-canvas){
  color: #cbd5e1;
}

.focus-analysis-stack .chart-panel,
.fatigue-analysis-stack .chart-panel {
  min-height: 500px;
}

.focus-analysis-stack .focus-readout-panel,
.fatigue-evidence-stack .fatigue-evidence-panel {
  max-width: none;
}

:global(.dark-theme .daily-analysis .panel),
:global(.dark-theme .daily-analysis .hero-card),
:global(.dark-theme .daily-analysis .hero-stat),
:global(.dark-theme .daily-analysis .event-card),
:global(.dark-theme .daily-analysis .context-bar),
:global(.dark-theme .daily-analysis .focus-highlight-card),
:global(.dark-theme .daily-analysis .fatigue-highlight-card),
:global(.dark-theme .daily-analysis .focus-readout-panel),
:global(.dark-theme .daily-analysis .fatigue-readout-panel),
:global(.dark-theme .daily-analysis .fatigue-evidence-panel){
  border-color: rgba(148, 163, 184, .18);
  background: var(--bg-card) !important;
  color: #e5f0ff;
}

:global(.dark-theme .daily-analysis .panel h2),
:global(.dark-theme .daily-analysis .hero-title),
:global(.dark-theme .daily-analysis .event-card strong),
:global(.dark-theme .daily-analysis .focus-readout-header strong),
:global(.dark-theme .daily-analysis .fatigue-moment-card strong),
:global(.dark-theme .daily-analysis .fatigue-recovery-card strong){
  color: #f8fafc;
}

:global(.dark-theme .daily-analysis .panel p),
:global(.dark-theme .daily-analysis .hero-text),
:global(.dark-theme .daily-analysis .context-bar p),
:global(.dark-theme .daily-analysis .event-card p),
:global(.dark-theme .daily-analysis .focus-readout-subtitle){
  color: #9fb2c8;
}

.focus-readout-panel {
  display: grid;
  grid-template-columns: minmax(260px, 0.54fr) minmax(0, 1fr);
  align-items: start;
  gap: 18px;
}

.focus-readout-panel > .panel-head,
.focus-readout-panel > .score-evidence-panel,
.focus-readout-panel > .focus-context-grid,
.focus-readout-panel > .evidence-block {
  grid-column: 1 / -1;
}

.focus-readout-header,
.focus-pillar-radar {
  min-width: 0;
}

.focus-readout-panel > .focus-chip-grid {
  grid-column: 2;
  align-self: stretch;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}

.focus-readout-panel .score-evidence-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
}

.focus-readout-panel .score-evidence-row,
.focus-readout-panel .context-evidence-row,
.fatigue-evidence-panel .score-evidence-row,
.fatigue-evidence-panel .context-evidence-row {
  align-items: flex-start;
}

.focus-readout-panel .focus-context-grid,
.fatigue-evidence-panel .focus-context-grid {
  grid-template-columns: repeat(auto-fit, minmax(310px, 1fr));
}
@media (max-width: 1180px) { .analysis-hero, .tab-grid, .event-grid { grid-template-columns: 1fr; } }
@media (max-width: 1180px) {
  .apps-highlight-grid,
  .app-card-grid,
  .browser-signal-grid,
  .focus-highlight-grid,
  .focus-pillar-cards,
  .focus-session-grid,
  .fatigue-highlight-grid,
  .habits-highlight-grid,
  .habit-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .apps-visual-grid,
  .apps-support-grid,
  .correction-grid,
  .focus-visual-grid,
  .fatigue-visual-grid,
  .fatigue-evidence-grid,
  .habits-visual-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 900px) {
  .context-bar,
  .panel-head,
  .panel-head-actions,
  .app-usage-foot,
  .browser-row,
  .browser-event-row,
  .tracked-app-row,
  .focus-session-head {
    flex-direction: column;
    align-items: flex-start;
  }
  .browser-row-meta {
    align-items: flex-start;
  }
  .tracked-app-meta {
    justify-content: flex-start;
  }
  .focus-session-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .focus-readout-panel {
    grid-template-columns: 1fr;
  }
  .focus-readout-panel > .focus-chip-grid {
    grid-column: 1;
  }
}
@media (max-width: 640px) { .date-nav, .date-input, .secondary-btn { width: 100%; } }
@media (max-width: 640px) {
  .apps-highlight-grid,
  .app-card-grid,
  .browser-signal-grid,
  .diagnostics-grid,
  .focus-highlight-grid,
  .focus-chip-grid,
  .focus-session-grid,
  .focus-task-chips,
  .fatigue-highlight-grid,
  .fatigue-recovery-grid,
  .habits-highlight-grid,
  .habit-card-grid {
    grid-template-columns: 1fr;
  }
  .sort-chip-row {
    width: 100%;
  }
}

:global(.dark-theme .daily-analysis .hero-card),
:global(.dark-theme .daily-analysis .panel),
:global(.dark-theme .daily-analysis .hero-stat),
:global(.dark-theme .daily-analysis .summary-card),
:global(.dark-theme .daily-analysis .event-card),
:global(.dark-theme .daily-analysis .context-bar),
:global(.dark-theme .daily-analysis .chart-panel),
:global(.dark-theme .daily-analysis .focus-highlight-card),
:global(.dark-theme .daily-analysis .fatigue-highlight-card),
:global(.dark-theme .daily-analysis .focus-flow-pill),
:global(.dark-theme .daily-analysis .focus-chip-card),
:global(.dark-theme .daily-analysis .focus-stat),
:global(.dark-theme .daily-analysis .focus-session-card),
:global(.dark-theme .daily-analysis .focus-readout-panel),
:global(.dark-theme .daily-analysis .score-evidence-panel),
:global(.dark-theme .daily-analysis .context-evidence-panel),
:global(.dark-theme .daily-analysis .score-evidence-row),
:global(.dark-theme .daily-analysis .context-evidence-row),
:global(.dark-theme .daily-analysis .fatigue-readout-panel),
:global(.dark-theme .daily-analysis .fatigue-evidence-panel),
:global(.dark-theme .daily-analysis .fatigue-driver-row),
:global(.dark-theme .daily-analysis .fatigue-moment-card),
:global(.dark-theme .daily-analysis .fatigue-recovery-card),
:global(.dark-theme .daily-analysis .usage-explorer-panel),
:global(.dark-theme .daily-analysis .usage-explorer-toolbar),
:global(.dark-theme .daily-analysis .usage-explorer-row),
:global(.dark-theme .daily-analysis .usage-stat-card),
:global(.dark-theme .daily-analysis .category-row),
:global(.dark-theme .daily-analysis .browser-row),
:global(.dark-theme .daily-analysis .browser-event-row),
:global(.dark-theme .daily-analysis .tracked-app-row),
:global(.dark-theme .daily-analysis .media-card),
:global(.dark-theme .daily-analysis .habit-impact-card),
:global(.dark-theme .daily-analysis .habit-evidence-card){
  border-color: rgba(148, 163, 184, 0.18) !important;
  background: var(--bg-card) !important;
  color: #e5f0ff !important;
}

:global(.dark-theme .daily-analysis .panel h2),
:global(.dark-theme .daily-analysis .hero-title),
:global(.dark-theme .daily-analysis .summary-card strong),
:global(.dark-theme .daily-analysis .event-card strong),
:global(.dark-theme .daily-analysis .focus-readout-header strong),
:global(.dark-theme .daily-analysis .focus-flow-pill strong),
:global(.dark-theme .daily-analysis .focus-chip-card strong),
:global(.dark-theme .daily-analysis .focus-stat strong),
:global(.dark-theme .daily-analysis .score-evidence-head strong),
:global(.dark-theme .daily-analysis .score-evidence-row > strong),
:global(.dark-theme .daily-analysis .score-evidence-label strong),
:global(.dark-theme .daily-analysis .context-evidence-row strong),
:global(.dark-theme .daily-analysis .fatigue-driver-copy strong),
:global(.dark-theme .daily-analysis .fatigue-moment-card strong),
:global(.dark-theme .daily-analysis .fatigue-recovery-card strong),
:global(.dark-theme .daily-analysis .category-main strong),
:global(.dark-theme .daily-analysis .media-head strong),
:global(.dark-theme .daily-analysis .usage-explorer-row strong){
  color: #f8fafc !important;
}

:global(.dark-theme .daily-analysis .panel p),
:global(.dark-theme .daily-analysis .hero-text),
:global(.dark-theme .daily-analysis .summary-card p),
:global(.dark-theme .daily-analysis .event-card p),
:global(.dark-theme .daily-analysis .context-bar p),
:global(.dark-theme .daily-analysis .focus-readout-subtitle),
:global(.dark-theme .daily-analysis .focus-session-subtitle),
:global(.dark-theme .daily-analysis .score-evidence-copy span),
:global(.dark-theme .daily-analysis .context-evidence-row span),
:global(.dark-theme .daily-analysis .fatigue-state-pill span),
:global(.dark-theme .daily-analysis .category-share),
:global(.dark-theme .daily-analysis .category-time),
:global(.dark-theme .daily-analysis .media-head span),
:global(.dark-theme .daily-analysis .usage-explorer-meta),
:global(.dark-theme .daily-analysis .mini-empty){
  color: #9fb2c8 !important;
}

:global(.dark-theme .daily-analysis .chart-panel .apexcharts-text),
:global(.dark-theme .daily-analysis .chart-panel .apexcharts-legend-text){
  fill: #9fb2c8 !important;
  color: #9fb2c8 !important;
}

:global(.dark-theme .daily-analysis .chart-panel .apexcharts-gridline){
  stroke: rgba(148, 163, 184, 0.16) !important;
}

:global(.dark-theme .daily-analysis .usage-search-input),
:global(.dark-theme .daily-analysis input),
:global(.dark-theme .daily-analysis select){
  border-color: rgba(148, 163, 184, 0.2) !important;
  background: rgba(15, 23, 42, 0.78) !important;
  color: #e5f0ff !important;
}

/* Correction modal dark mode */
:global(.dark-theme .daily-analysis .modal-card){
  border-color: rgba(148, 163, 184, 0.18) !important;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(22, 35, 56, 0.98)) !important;
  color: #e5f0ff !important;
}

:global(.dark-theme .daily-analysis .modal-close){
  background: rgba(15, 23, 42, 0.72) !important;
  border-color: rgba(148, 163, 184, 0.18) !important;
  color: #8a96a8 !important;
}

:global(.dark-theme .daily-analysis .modal-close:hover){
  color: #e5f0ff !important;
  border-color: rgba(103, 232, 249, 0.28) !important;
}

/* Info hint icon dark mode */
:global(.dark-theme .daily-analysis .info-hint){
  background: rgba(15, 23, 42, 0.68) !important;
  border-color: rgba(148, 163, 184, 0.18) !important;
  color: #8a96a8 !important;
}

/* App usage lane chip text — dark text colors are unreadable on dark card backgrounds */
:global(.dark-theme .daily-analysis .app-usage-chip.productive){
  color: #2dd4bf !important;
  background: rgba(20, 184, 166, 0.14) !important;
}
:global(.dark-theme .daily-analysis .app-usage-chip.supporting){
  color: #a78bfa !important;
  background: rgba(124, 58, 237, 0.14) !important;
}
:global(.dark-theme .daily-analysis .app-usage-chip.unclear){
  color: #fb923c !important;
  background: rgba(249, 115, 22, 0.14) !important;
}
:global(.dark-theme .daily-analysis .app-usage-chip.distracting){
  color: #fb7185 !important;
  background: rgba(251, 113, 133, 0.14) !important;
}
:global(.dark-theme .daily-analysis .app-usage-chip.muted){
  color: #94a3b8 !important;
  background: rgba(148, 163, 184, 0.14) !important;
}

/* ApexCharts dark mode for DailyAnalysisView charts */
:global(.dark-theme .daily-analysis .chart-panel .apexcharts-toolbar svg){
  fill: #8a96a8 !important;
}
:global(.dark-theme .daily-analysis .chart-panel .apexcharts-menu){
  background: #1a2840 !important;
  border: 1px solid rgba(148, 163, 184, 0.18) !important;
  color: #e2e8f0 !important;
}
:global(.dark-theme .daily-analysis .chart-panel .apexcharts-menu-item:hover){
  background: rgba(14, 165, 233, 0.14) !important;
}

/* Highlight card tonal value colors — dark text isn't readable on dark card bg */
:global(.dark-theme .daily-analysis .focus-highlight-card.teal strong),
:global(.dark-theme .daily-analysis .apps-highlight-card.teal strong),
:global(.dark-theme .daily-analysis .fatigue-highlight-card.teal strong),
:global(.dark-theme .daily-analysis .habits-highlight-card.teal strong){ color: #2dd4bf !important; }

:global(.dark-theme .daily-analysis .focus-highlight-card.blue strong),
:global(.dark-theme .daily-analysis .apps-highlight-card.blue strong),
:global(.dark-theme .daily-analysis .fatigue-highlight-card.blue strong),
:global(.dark-theme .daily-analysis .habits-highlight-card.blue strong){ color: #38bdf8 !important; }

:global(.dark-theme .daily-analysis .focus-highlight-card.rose strong),
:global(.dark-theme .daily-analysis .fatigue-highlight-card.rose strong){ color: #fb7185 !important; }

:global(.dark-theme .daily-analysis .focus-highlight-card.amber strong),
:global(.dark-theme .daily-analysis .apps-highlight-card.amber strong),
:global(.dark-theme .daily-analysis .fatigue-highlight-card.amber strong),
:global(.dark-theme .daily-analysis .habits-highlight-card.amber strong){ color: #fb923c !important; }

:global(.dark-theme .daily-analysis .focus-highlight-card.violet strong),
:global(.dark-theme .daily-analysis .apps-highlight-card.violet strong),
:global(.dark-theme .daily-analysis .fatigue-highlight-card.violet strong),
:global(.dark-theme .daily-analysis .habits-highlight-card.violet strong){ color: #a78bfa !important; }

:global(.dark-theme .daily-analysis .apps-highlight-card.slate strong){ color: #94a3b8 !important; }

/* Dark mode for habit impact card section labels */
:global(.dark-theme .daily-analysis .habit-impact-card span),
:global(.dark-theme .daily-analysis .habit-task-card span){ color: #8a96a8 !important; }

/* Fix sort chip hover/active teal text to be readable on dark bg */
:global(.dark-theme .daily-analysis .sort-chip.active),
:global(.dark-theme .daily-analysis .sort-chip:hover){ color: #67e8f9 !important; }

/* Fatigue state pill tonal strong colors on dark card bg */
:global(.dark-theme .daily-analysis .fatigue-state-pill.teal strong){ color: #2dd4bf !important; }
:global(.dark-theme .daily-analysis .fatigue-state-pill.blue strong){ color: #38bdf8 !important; }
:global(.dark-theme .daily-analysis .fatigue-state-pill.amber strong){ color: #fb923c !important; }
:global(.dark-theme .daily-analysis .fatigue-state-pill.rose strong){ color: #fb7185 !important; }

/* Habit evidence chips and time labels — dark teal/amber/green on dark bg */
:global(.dark-theme .daily-analysis .habit-evidence-time){ color: #2dd4bf !important; }
:global(.dark-theme .daily-analysis .habit-evidence-chip){
  color: #2dd4bf !important;
  background: rgba(45, 212, 191, 0.1) !important;
}
:global(.dark-theme .daily-analysis .habit-evidence-chip.muted){
  color: #94a3b8 !important;
  background: rgba(148, 163, 184, 0.12) !important;
}
:global(.dark-theme .daily-analysis .habit-evidence-chip.warm){
  color: #fbbf24 !important;
  background: rgba(245, 158, 11, 0.12) !important;
}
:global(.dark-theme .daily-analysis .habit-evidence-chip.good){
  color: #4ade80 !important;
  background: rgba(34, 197, 94, 0.12) !important;
}

/* Habits highlight card — missing amber variant */
:global(.dark-theme .daily-analysis .habits-highlight-card.teal strong){ color: #2dd4bf !important; }
:global(.dark-theme .daily-analysis .habits-highlight-card.blue strong){ color: #38bdf8 !important; }

/* Analysis hero gradient — remove teal tint in dark mode */
:global(.dark-theme .daily-analysis .analysis-hero){
  background: var(--bg-card);
}

/* Apps highlight card tone colors — light-mode only, override for dark */
:global(.dark-theme .daily-analysis .apps-highlight-card.teal strong){ color: #2dd4bf !important; }
:global(.dark-theme .daily-analysis .apps-highlight-card.slate strong){ color: #94a3b8 !important; }
:global(.dark-theme .daily-analysis .apps-highlight-card.violet strong){ color: #a78bfa !important; }
:global(.dark-theme .daily-analysis .apps-highlight-card.amber strong){ color: #fbbf24 !important; }

/* Source badge text — hardcoded dark colors, override for dark mode */
:global(.dark-theme .daily-analysis .source-badge.combined){ color: #2dd4bf; }
:global(.dark-theme .daily-analysis .source-badge.session){ color: #7dd3fc; }
:global(.dark-theme .daily-analysis .source-badge.background){ color: #c4b5fd; }
:global(.dark-theme .daily-analysis .source-badge.manual){ color: #fbbf24; }
</style>
