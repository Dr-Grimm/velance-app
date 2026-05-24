<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowUpRightIcon,
  BarChart3Icon,
  CheckIcon,
  ChevronDownIcon,
  Minimize2Icon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  SettingsIcon,
  ShieldAlertIcon,
  SquareIcon,
  TargetIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-vue-next'
import { useVelanceStore } from '../store/velance.js'
import { useActivityTracker } from '../composables/useActivityTracker.js'
import { useAmbientTracker } from '../composables/useAmbientTracker.js'
import { consumeFocusLaunch } from '../services/focusLaunchService.js'
import { buildAnalyticsLocation, getAnalyticsDateKeyFromSession, getAnalyticsEventIdForSession } from '../services/analysisNavigation.js'
import { getTodayLocalDateKey } from '../services/dateKey.js'
import { buildRangeEvidenceBundle } from '../services/analysisEngine.js'
import { buildBrowserEvidenceSummary } from '../services/browserEvidenceService.js'

const router = useRouter()
const store = useVelanceStore()
const tracker = useActivityTracker()
const ambient = useAmbientTracker()

const goal = ref('')
const durationMode = ref('60')
const durationGoalMinutes = ref(60)
const minimizeOnStart = ref(true)
const linkedTaskId = ref(null)
const linkedHabitId = ref(null)
const pickerOpen = ref(null)
const customSheetOpen = ref(false)
const customHours = ref(1)
const customMinutes = ref(0)
const customNoLimit = ref(false)
const taskQuery = ref('')
const habitQuery = ref('')
const animatedFocusScore = ref(0)
const animatedFatigueScore = ref(0)
const activeMixSegmentLabel = ref('')
const reviewDetailMode = ref('summary')

let focusAnimationFrame = null
let fatigueAnimationFrame = null

const durationPresets = [30, 60, 90]

function isNoiseAppName(name = '') {
  const label = String(name || '').trim()
  return !label || label === 'Unknown' || /velance|electron/i.test(label)
}

function clampInteger(value, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return min
  return Math.max(min, Math.min(max, parsed))
}

const running = computed(() => tracker.isTracking.value)
const completed = computed(() => tracker.completedSession.value)
const liveSample = computed(() => tracker.latestSample.value)
const hasObservedApps = computed(() => tracker.appTimeline.value.length > 0)
const hasWindowHook = computed(() => tracker.telemetryStatus.value.windowHookAvailable)
const tasks = computed(() => [...store.tasks]
  .filter((task) => task.status !== 'completed')
  .sort((a, b) => {
    if ((a.status === 'in-progress') !== (b.status === 'in-progress')) return a.status === 'in-progress' ? -1 : 1
    return String(a.title || '').localeCompare(String(b.title || ''))
  }))
const habits = computed(() => [...store.habits].sort((a, b) => a.name.localeCompare(b.name)))
const selectedTask = computed(() => tasks.value.find((task) => String(task.id) === String(linkedTaskId.value)) || null)
const selectedHabit = computed(() => habits.value.find((habit) => String(habit.id) === String(linkedHabitId.value)) || null)
const telemetryLabel = computed(() => {
  const telemetry = tracker.telemetryStatus.value
  if (telemetry.inputHookAvailable && telemetry.windowHookAvailable) return 'Native tracking ready'
  return 'Tracking limited'
})
const trackingBlockedReason = computed(() => {
  if (!store.settings.trackingConsentGranted) {
    return 'Tracking is blocked until local tracking consent is granted in Privacy settings.'
  }
  if (!store.settings.trackingEnabled) {
    return 'Tracking is currently turned off in Privacy settings.'
  }
  return ''
})
const startBlocked = computed(() => Boolean(trackingBlockedReason.value))
const trackingBlockedTitle = computed(() => {
  if (!store.settings.trackingConsentGranted) return 'Choose tracking before starting a measured block.'
  if (!store.settings.trackingEnabled) return 'Tracking is off for this workspace.'
  return 'Focus tracking is paused.'
})
const trackingBlockedCards = computed(() => ([
  'No app, window, input, or focus telemetry will start until you allow it.',
  'Tasks, habits, planning, and manual work still stay available.',
  store.settings.trackingConsentGranted
    ? 'Re-enable tracking in Privacy settings when you want live focus evidence.'
    : 'The choice is local-first and can be changed later in Settings.',
]))
const setupTitle = computed(() => goal.value.trim() || selectedTask.value?.title || selectedHabit.value?.name || 'Focus session')
const liveTitle = computed(() => tracker.sessionMeta.value.goal || tracker.sessionMeta.value.taskTitle || tracker.sessionMeta.value.habit || 'Focus session')
const reviewTitle = computed(() => completed.value?.goal || completed.value?.taskTitle || completed.value?.habit || 'Focus session')
const reviewModes = [
  { id: 'summary', label: 'Summary', detail: 'What matters now' },
  { id: 'evidence', label: 'Evidence', detail: 'Apps and browser' },
  { id: 'deep', label: 'Deep dive', detail: 'Signals and timeline' },
]
const durationChipLabel = computed(() => {
  if (durationMode.value !== 'custom') return formatDurationMinutes(durationGoalMinutes.value)
  return durationGoalMinutes.value ? formatDurationMinutes(durationGoalMinutes.value) : 'No limit'
})
const customDurationTotal = computed(() => Math.max(0, (clampInteger(customHours.value, 0, 12) * 60) + clampInteger(customMinutes.value, 0, 59)))
const customDurationPreview = computed(() => customNoLimit.value ? 'No limit' : formatDurationMinutes(customDurationTotal.value))
const customApplyDisabled = computed(() => !customNoLimit.value && customDurationTotal.value <= 0)
const filteredTasks = computed(() => {
  const needle = taskQuery.value.trim().toLowerCase()
  if (!needle) return tasks.value.slice(0, 8)
  return tasks.value.filter((task) => {
    const habitName = String(task.habit || '').toLowerCase()
    return String(task.title || '').toLowerCase().includes(needle) || habitName.includes(needle)
  }).slice(0, 8)
})
const filteredHabits = computed(() => {
  const needle = habitQuery.value.trim().toLowerCase()
  if (!needle) return habits.value.slice(0, 8)
  return habits.value.filter((habit) => String(habit.name || '').toLowerCase().includes(needle)).slice(0, 8)
})
const suggestedTaskCandidate = computed(() => {
  if (selectedTask.value) return null
  if (selectedHabit.value) {
    return tasks.value.find((task) => String(task.habit || '').trim().toLowerCase() === String(selectedHabit.value?.name || '').trim().toLowerCase()) || null
  }
  return store.suggestedTask || null
})
const suggestedHabitCandidate = computed(() => {
  if (selectedHabit.value) return null
  if (selectedTask.value?.habit) {
    return habits.value.find((habit) => String(habit.name || '').trim().toLowerCase() === String(selectedTask.value.habit || '').trim().toLowerCase()) || null
  }
  return store.habitCompletionStats?.stats
    ?.filter((habit) => !habit.isOnTrack)
    ?.sort((left, right) => Number(left.progress || 0) - Number(right.progress || 0))
    ?.map((habit) => habits.value.find((entry) => String(entry.id) === String(habit.id)) || null)
    ?.find(Boolean) || null
})
const setupWorkflowCards = computed(() => {
  const cards = []

  if (suggestedTaskCandidate.value) {
    cards.push({
      id: 'task',
      eyebrow: selectedHabit.value ? 'Task for this habit' : 'Best next task',
      title: suggestedTaskCandidate.value.title,
      detail: selectedHabit.value
        ? `This task already belongs to ${selectedHabit.value.name} and can become the next measured block.`
        : suggestedTaskCandidate.value.habit
          ? `${suggestedTaskCandidate.value.habit} is already attached, so the session can track both task and habit evidence.`
          : 'Highest-value next step from urgency, status, and planning signals.',
      cta: 'Use task',
      tone: 'focus',
    })
  }

  if (suggestedHabitCandidate.value) {
    cards.push({
      id: 'habit',
      eyebrow: selectedTask.value?.habit ? 'Task-linked habit' : 'Next habit to protect',
      title: suggestedHabitCandidate.value.name,
      detail: selectedTask.value?.habit
        ? 'This task already belongs to the habit, so linking it keeps the session tied into your routine.'
        : `${suggestedHabitCandidate.value.targetMinutes || 0}m target today. Linking it now makes the review and habit map much more useful.`,
      cta: 'Link habit',
      tone: 'habit',
    })
  }

  return cards.slice(0, 2)
})
const liveIdleRatio = computed(() => tracker.sessionSummary.value.idleRatio || 0)
const liveTyping = computed(() => tracker.keystrokesPerMin.value || 0)
const liveSwitches = computed(() => tracker.windowSwitchCount.value || 0)
const livePointer = computed(() => Math.round(liveSample.value.mouseDistance || 0))
const liveClicks = computed(() => liveSample.value.clicks || 0)
const liveStateLabel = computed(() => {
  if (tracker.isPaused.value) return 'Paused'
  if (!hasObservedApps.value && !liveSample.value.observed) return 'Waiting'
  if (!liveSample.value.observed && liveSample.value.app) return 'Background'
  return 'Tracking'
})
const currentAppLabel = computed(() => {
  if (tracker.currentApp.value && tracker.currentApp.value !== '-') return tracker.currentApp.value
  return 'No tracked app yet'
})
const currentWindowLabel = computed(() => {
  if (tracker.currentTitle.value) return tracker.currentTitle.value
  if (!hasWindowHook.value) return 'Window tracking is unavailable on this device.'
  return 'Open the work app you want this session to observe.'
})
const currentSignalLabel = computed(() => {
  if (tracker.isPaused.value) return 'The block is paused until you resume it.'
  if (!hasWindowHook.value) return 'Input can still collect when available, but app-level tracking is limited.'
  if (!hasObservedApps.value) return 'Scoring starts after the first real app window is observed.'
  if (!liveSample.value.observed && liveSample.value.app) return 'Velance is in front right now. Background it to keep app tracking active.'
  return tracker.focusQuality.value.detail
})
const liveMetrics = computed(() => ([
  {
    label: 'Typing',
    value: `${liveTyping.value}/min`,
    tone: liveTyping.value > 0 ? 'active' : '',
  },
  {
    label: 'Pointer',
    value: `${livePointer.value}px`,
    tone: livePointer.value > 0 ? 'active' : '',
  },
  {
    label: 'Clicks',
    value: String(liveClicks.value),
    tone: liveClicks.value > 0 ? 'active' : '',
  },
  {
    label: 'Idle',
    value: tracker.isIdle.value ? 'Now' : `${liveIdleRatio.value}%`,
    tone: tracker.isIdle.value ? 'warn' : '',
  },
  {
    label: 'Switches',
    value: String(liveSwitches.value),
    tone: liveSwitches.value > 0 ? 'steady' : '',
  },
]))
const liveActivityFeed = computed(() => tracker.sampleFeed.value.slice(0, 8))
const reviewRangeEvidence = computed(() => {
  if (!completed.value) return null
  const dateKey = getCompletedAnalyticsDateKey()
  if (!dateKey) return null
  const startTs = Number(completed.value?.timestamp || completed.value?.createdAt || 0)
  const endTs = startTs + (Number(completed.value?.durationSeconds || 0) * 1000)
  return buildRangeEvidenceBundle({
    ambientEntries: ambient.getEntriesForDate(dateKey),
    browserEvents: ambient.getBrowserEventsForDate(dateKey),
    startTs,
    endTs,
    ambientPadMs: 15 * 1000,
    browserPadMs: 30 * 1000,
    limit: 4,
  })
})
const reviewApps = computed(() => {
  if (reviewRangeEvidence.value?.topApps?.length) {
    return reviewRangeEvidence.value.topApps.map((entry) => ({
      ...entry,
      appName: entry.app,
      color: entry.color || '#8E95A3',
      stateLabel: entry.dominantLane === 'productive'
        ? 'Productive'
        : entry.dominantLane === 'distracting'
          ? 'Distracting'
          : entry.dominantLane === 'supporting'
            ? 'Supporting'
            : 'Neutral',
      stateTone: entry.dominantLane === 'productive'
        ? 'productive'
        : entry.dominantLane === 'distracting'
          ? 'distracting'
          : entry.dominantLane === 'supporting'
            ? 'supporting'
            : 'neutral',
      categoryLabel: entry.category || 'Unclassified',
    }))
  }
  const detailedBreakdown = Array.isArray(completed.value?.appBreakdown) && completed.value.appBreakdown.length
    ? completed.value.appBreakdown
    : []
  const fallbackUsage = Array.isArray(completed.value?.appUsage) ? completed.value.appUsage : []
  const source = detailedBreakdown.length
    ? detailedBreakdown
    : fallbackUsage
  const filtered = source
    .filter((entry) => (entry.seconds || 0) > 0 && !isNoiseAppName(entry.appName || entry.app))
    .sort((a, b) => (b.seconds || 0) - (a.seconds || 0))
    .slice(0, 8)
    .map((entry) => {
      const dominantLane = ['productive', 'supporting', 'unclear', 'distracting'].includes(String(entry.dominantLane || '').trim().toLowerCase())
        ? String(entry.dominantLane || '').trim().toLowerCase()
        : (entry.productive === true ? 'productive' : entry.productive === false ? 'distracting' : 'unclear')
      const stateLabel = dominantLane === 'productive'
        ? 'Productive'
        : dominantLane === 'supporting'
          ? 'Supporting'
          : dominantLane === 'distracting'
            ? 'Distracting'
            : 'Neutral'
      const stateTone = dominantLane === 'productive'
        ? 'productive'
        : dominantLane === 'supporting'
          ? 'supporting'
          : dominantLane === 'distracting'
            ? 'distracting'
            : 'neutral'
      const categoryLabel = [entry.category, entry.subcategory].filter(Boolean).join(' - ') || 'Unclassified'
      return {
        ...entry,
        appName: entry.appName || entry.app,
        color: entry.color || '#8E95A3',
        stateLabel,
        stateTone,
        categoryLabel,
      }
    })
  if (filtered.length) return filtered
  if (!isNoiseAppName(completed.value?.primaryApp) && (completed.value?.durationSeconds || 0) > 0) {
    return [{
      appName: completed.value.primaryApp,
      seconds: completed.value.durationSeconds,
      color: '#8E95A3',
      stateLabel: completed.value?.primaryContextState === 'productive'
        ? 'Productive'
        : completed.value?.primaryContextState === 'supporting'
          ? 'Supporting'
        : completed.value?.primaryContextState === 'distracting'
          ? 'Distracting'
          : 'Neutral',
      stateTone: completed.value?.primaryContextState === 'productive'
        ? 'productive'
        : completed.value?.primaryContextState === 'supporting'
          ? 'supporting'
        : completed.value?.primaryContextState === 'distracting'
          ? 'distracting'
          : 'neutral',
      categoryLabel: completed.value?.primaryAppCategory || 'Unclassified',
    }]
  }
  return []
})
const reviewSummary = computed(() => completed.value?.sessionSummary || {})
const linkedReviewTask = computed(() => {
  const linkedId = completed.value?.linkedTaskId
  if (linkedId !== null && linkedId !== undefined) {
    const matched = store.tasks.find((task) => String(task.id) === String(linkedId))
    if (matched) return matched
  }
  if (completed.value?.taskTitle) {
    return store.tasks.find((task) => task.title === completed.value.taskTitle) || null
  }
  return null
})
const linkedReviewHabit = computed(() => {
  const linkedId = completed.value?.linkedHabitId
  if (linkedId !== null && linkedId !== undefined) {
    const matched = store.habits.find((habit) => String(habit.id) === String(linkedId))
    if (matched) return matched
  }
  if (completed.value?.habit) {
    return store.habits.find((habit) => habit.name === completed.value.habit) || null
  }
  return null
})
const suggestedReviewHabit = computed(() => {
  if (linkedReviewHabit.value) return linkedReviewHabit.value
  if (linkedReviewTask.value?.habit) {
    return store.habits.find((habit) => String(habit.name || '').trim().toLowerCase() === String(linkedReviewTask.value.habit || '').trim().toLowerCase()) || null
  }
  if (completed.value?.habit) {
    return store.habits.find((habit) => String(habit.name || '').trim().toLowerCase() === String(completed.value.habit || '').trim().toLowerCase()) || null
  }
  return null
})
const reviewHeaderChips = computed(() => {
  const chips = []

  if (linkedReviewTask.value || completed.value?.taskTitle) {
    chips.push({
      label: linkedReviewTask.value?.status === 'completed' ? 'Task done' : 'Task',
      value: truncateLabel(linkedReviewTask.value?.title || completed.value?.taskTitle || '', 32),
      tone: linkedReviewTask.value?.status === 'completed' ? 'good' : 'neutral',
    })
  }

  if (linkedReviewHabit.value || completed.value?.habit) {
    chips.push({
      label: 'Habit',
      value: truncateLabel(linkedReviewHabit.value?.name || completed.value?.habit || '', 28),
      tone: 'steady',
    })
  }

  if (!isNoiseAppName(completed.value?.primaryApp)) {
    chips.push({
      label: 'Primary app',
      value: truncateLabel(completed.value?.primaryApp || '', 28),
      tone:
        completed.value?.primaryContextState === 'productive'
          ? 'good'
          : completed.value?.primaryContextState === 'supporting'
            ? 'steady'
          : completed.value?.primaryContextState === 'distracting'
            ? 'warn'
            : 'neutral',
    })
  }

  const observedRatio = completed.value?.observedRatio ?? reviewSummary.value.observedRatio ?? 0
  if (observedRatio > 0) {
    chips.push({
      label: 'Observed',
      value: formatRatioPercent(observedRatio),
      tone: 'neutral',
    })
  }

  return chips.slice(0, 4)
})
const reviewPillars = computed(() => completed.value?.pillarScores || {
  presence: 0,
  activity: 0,
  continuity: 0,
  stability: 0,
})
const reviewSignalTiles = computed(() => ([
  {
    label: 'Presence',
    value: reviewPillars.value.presence ?? 0,
    note: 'Idle control',
    tone: scoreBandTone(reviewPillars.value.presence ?? 0),
  },
  {
    label: 'Activity',
    value: reviewPillars.value.activity ?? 0,
    note: 'Input pace',
    tone: scoreBandTone(reviewPillars.value.activity ?? 0),
  },
  {
    label: 'Continuity',
    value: reviewPillars.value.continuity ?? 0,
    note: 'Switch rhythm',
    tone: scoreBandTone(reviewPillars.value.continuity ?? 0),
  },
  {
    label: 'Stability',
    value: reviewPillars.value.stability ?? 0,
    note: 'Lane hold',
    tone: scoreBandTone(reviewPillars.value.stability ?? 0),
  },
]))
const reviewMetrics = computed(() => ([
  {
    label: 'Observed',
    value: formatRatioPercent(completed.value?.observedRatio ?? reviewSummary.value.observedRatio ?? 0),
    note: 'Measured window',
  },
  {
    label: 'Switches',
    value: String(completed.value?.windowSwitchCount ?? reviewSummary.value.windowSwitchCount ?? 0),
    note: 'Context hops',
  },
  {
    label: 'Drifts',
    value: String(completed.value?.driftCount ?? 0),
    note: 'Focus drops',
  },
  {
    label: 'Recoveries',
    value: String(completed.value?.recoveryCount ?? 0),
    note: 'Returned cleanly',
  },
]))
const reviewBrowserEvents = computed(() => {
  return reviewRangeEvidence.value?.browserEvents || []
})
const reviewBrowserSummary = computed(() => {
  if (reviewRangeEvidence.value) {
    return buildBrowserEvidenceSummary({
      ambientEntries: reviewRangeEvidence.value.ambientEntries || [],
      browserEvents: reviewRangeEvidence.value.browserEvents || [],
      startTs: reviewRangeEvidence.value.startTs || 0,
      endTs: reviewRangeEvidence.value.endTs || 0,
      padMs: 0,
      limit: 4,
    })
  }
  return buildBrowserEvidenceSummary({
    browserEvents: [],
    ambientEntries: [],
    padMs: 0,
    limit: 4,
  })
})
const reviewRecentBrowserEvents = computed(() => (reviewRangeEvidence.value?.recentBrowserEvents || []).map((entry) => ({
  ...entry,
  note: `${entry.browserApp || 'Browser'} - ${entry.host || 'No host'}`,
})))
const reviewBrowserMetricCards = computed(() => ([
  {
    label: 'Browser switches',
    value: String(reviewBrowserSummary.value.tabSwitches || 0),
    note: 'During this block',
  },
  {
    label: 'Tabs opened',
    value: String(reviewBrowserSummary.value.tabsOpened || 0),
    note: 'New browser tabs',
  },
  {
    label: 'Audible tabs',
    value: String(reviewBrowserSummary.value.audibleMoments || 0),
    note: 'Browser audio moments',
  },
  {
    label: 'Browser pressure',
    value: `${reviewBrowserSummary.value.pressureScore || 0}/100`,
    note: reviewBrowserSummary.value.dominantPressureLabel || 'Quiet browser context',
  },
]))
const reviewBrowserContextCards = computed(() => ([
  {
    label: 'Lead site',
    value: reviewBrowserSummary.value.leadSiteLabel || 'No clear site',
    note: reviewBrowserSummary.value.leadSite?.laneLabel || 'No lane yet',
  },
  {
    label: 'Unique hosts',
    value: String(reviewBrowserSummary.value.uniqueHosts || 0),
    note: 'Sites touched',
  },
]))
const reviewBrowserLeadPageCard = computed(() => ({
  label: 'Lead page',
  value: reviewBrowserSummary.value.leadPageLabel || 'No clear page',
  note: reviewBrowserSummary.value.activePage?.browserApp || 'Browser context',
  laneLabel: reviewBrowserSummary.value.leadPage?.laneLabel || '',
}))
const reviewTimelineRows = computed(() => {
  const source = completed.value?.timeline || completed.value?.timelineSegments || []
  return Array.isArray(source) ? source : []
})
const reviewMixSegments = computed(() => {
  const segments = [
    {
      label: 'Productive',
      value: completed.value?.productiveSeconds || 0,
      color: '#14b8a6',
    },
    {
      label: 'Support',
      value: completed.value?.supportingSeconds || 0,
      color: '#0ea5e9',
    },
    {
      label: 'Unclear',
      value: completed.value?.unclearSeconds || 0,
      color: '#94a3b8',
    },
    {
      label: 'Distracting',
      value: completed.value?.distractingSeconds || 0,
      color: '#f97316',
    },
  ]
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  return segments.map((segment) => ({
    ...segment,
    share: total > 0 ? Math.round((segment.value / total) * 100) : 0,
    tone: segment.label.toLowerCase(),
    description:
      segment.label === 'Productive'
        ? 'Time spent in clearly aligned work contexts.'
        : segment.label === 'Support'
          ? 'Useful supporting work around the main task.'
          : segment.label === 'Distracting'
            ? 'Time that likely pulled the session away from the goal.'
            : 'Real tracked time that could not be confidently classified.',
  }))
})

const activeReviewMixSegment = computed(() => {
  const segments = reviewMixSegments.value
  return segments.find((segment) => segment.label === activeMixSegmentLabel.value)
    || segments.find((segment) => segment.value > 0)
    || segments[0]
    || null
})
const reviewMixStyle = computed(() => {
  const segments = reviewMixSegments.value
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  if (!total) {
    return {
      background: 'conic-gradient(rgba(148,163,184,0.18) 0deg 360deg)',
    }
  }

  let offset = 0
  const stops = segments.map((segment) => {
    const size = (segment.value / total) * 360
    const start = round(offset, 1)
    const end = round(offset + size, 1)
    offset += size
    return `${segment.color} ${start}deg ${end}deg`
  })

  return {
    background: `conic-gradient(${stops.join(', ')})`,
  }
})
const reviewAppBars = computed(() => {
  const total = reviewApps.value.reduce((sum, app) => sum + (app.seconds || 0), 0)
  return reviewApps.value.map((app) => ({
    ...app,
    share: total > 0 ? Math.max(6, Math.round(((app.seconds || 0) / total) * 100)) : 0,
  }))
})
const reviewFatigueDrivers = computed(() => {
  const source = completed.value?.fatigueDrivers || {}
  const items = [
    {
      key: 'durationLoad',
      label: 'Duration load',
      note: 'How long the block stayed under pressure.',
      value: Math.round(Number(source.durationLoad || 0)),
      tone: 'duration',
    },
    {
      key: 'switchLoad',
      label: 'Switch load',
      note: 'App and window hopping across the session.',
      value: Math.round(Number(source.switchLoad || 0)),
      tone: 'switch',
    },
    {
      key: 'focusDecayLoad',
      label: 'Focus decay',
      note: 'Drop-off between early and late slices.',
      value: Math.round(Number(source.focusDecayLoad || 0)),
      tone: 'decay',
    },
    {
      key: 'idleLoad',
      label: 'Idle drag',
      note: 'Inactive or stalled time dragging the lane.',
      value: Math.round(Number(source.idleLoad || 0)),
      tone: 'idle',
    },
  ]
  const maxValue = Math.max(0, ...items.map((item) => item.value))
  return items
    .map((item) => ({
      ...item,
      width: maxValue > 0 ? Math.max(10, Math.round((item.value / maxValue) * 100)) : 0,
    }))
    .sort((left, right) => right.value - left.value)
})
const reviewLeadDriver = computed(() => reviewFatigueDrivers.value.find((driver) => driver.value > 0) || null)
const reviewOutcome = computed(() => {
  const score = Number(completed.value?.focusScore || 0)
  const fatigue = Number(completed.value?.fatigueScore || 0)
  const bestFlow = Number(completed.value?.bestFlowSeconds || reviewSummary.value.bestFlowSeconds || 0)
  const switches = Number(completed.value?.windowSwitchCount ?? reviewSummary.value.windowSwitchCount ?? 0)

  if (score >= 82 && fatigue < 50) {
    return {
      tone: 'good',
      title: 'This was a strong work lane.',
      detail: bestFlow >= 300
        ? `Protect the same conditions next time. Your longest clean stretch lasted ${formatDuration(bestFlow)}.`
        : 'Keep the same task framing and repeat once more before changing the setup.',
      next: 'Save this as a reference block.',
    }
  }

  if (fatigue >= 68) {
    return {
      tone: 'warn',
      title: 'The block got expensive.',
      detail: reviewLeadDriver.value
        ? `${reviewLeadDriver.value.label} carried the most load. Recover before starting another heavy block.`
        : 'The fatigue signal rose enough that the next move should be shorter and cleaner.',
      next: 'Run a shorter follow-up after a reset.',
    }
  }

  if (score < 58) {
    return {
      tone: 'warn',
      title: 'The session needs a tighter boundary.',
      detail: switches > 0
        ? `${switches} context switch${switches === 1 ? '' : 'es'} interrupted the lane. Pick one app and one task for the next run.`
        : 'The telemetry was thin or unstable. Link a task and work in one app to build clearer evidence.',
      next: 'Run again with a smaller target.',
    }
  }

  return {
    tone: 'steady',
    title: 'Good enough to learn from.',
    detail: 'The block produced usable evidence. Keep the next session similar, then compare the score and strain.',
    next: 'Save it, then repeat one controlled experiment.',
  }
})
const reviewWorkflowCards = computed(() => {
  const cards = []

  if (linkedReviewTask.value) {
    cards.push({
      id: 'task',
      eyebrow: 'Linked task',
      title: linkedReviewTask.value.title,
      detail: linkedReviewTask.value.status === 'completed'
        ? 'This task is already closed. Jump back to Tasks if you want to refine or review it.'
        : 'Close the loop here if this focus block finished the task, or keep it moving in Tasks.',
      cta: linkedReviewTask.value.status === 'completed' ? 'Open in Tasks' : 'Mark complete',
      tone: linkedReviewTask.value.status === 'completed' ? 'good' : 'focus',
      action: linkedReviewTask.value.status === 'completed' ? 'open-task' : 'complete-task',
      meta: linkedReviewTask.value.habit ? `Habit: ${linkedReviewTask.value.habit}` : 'Task-linked session',
    })
  } else if (completed.value?.goal && completed.value.goal !== 'Focus session') {
    cards.push({
      id: 'follow-up',
      eyebrow: 'Follow-up',
      title: 'Create a task from this block',
      detail: 'Turn this finished session into a tracked task so the next step does not get lost after the review.',
      cta: 'Create task',
      tone: 'steady',
      action: 'create-task',
      meta: truncateLabel(completed.value.goal, 42),
    })
  }

  if (suggestedReviewHabit.value) {
    cards.push({
      id: 'habit',
      eyebrow: linkedReviewHabit.value ? 'Linked habit' : 'Suggested habit',
      title: suggestedReviewHabit.value.name,
      detail: linkedReviewHabit.value
        ? 'This session already feeds the habit trail. Open Habits to see the streak and day impact.'
        : 'Attach this habit next time to make the routine, session review, and habit map line up more clearly.',
      cta: linkedReviewHabit.value ? 'Open Habits' : 'Use next time',
      tone: linkedReviewHabit.value ? 'good' : 'habit',
      action: linkedReviewHabit.value ? 'open-habit' : 'apply-habit',
      meta: `${suggestedReviewHabit.value.targetMinutes || 0}m target`,
    })
  }

  return cards.slice(0, 2)
})
const reviewMoments = computed(() => {
  const slices = reviewTimelineRows.value
  const moments = []
  const seen = new Set()

  function pushMoment(moment) {
    if (!moment?.key || seen.has(moment.key)) return
    seen.add(moment.key)
    moments.push(moment)
  }

  const strongestSlice = slices.reduce((best, slice) => {
    const score = (slice.focusScore ?? slice.score ?? 0) - ((slice.fatigueScore ?? slice.fatigue ?? 0) * 0.35)
    const bestScore = best ? ((best.focusScore ?? best.score ?? 0) - ((best.fatigueScore ?? best.fatigue ?? 0) * 0.35)) : Number.NEGATIVE_INFINITY
    return score > bestScore ? slice : best
  }, null)

  const strainSlice = slices.reduce((best, slice) => {
    const fatigue = slice.fatigueScore ?? slice.fatigue ?? 0
    const bestFatigue = best ? (best.fatigueScore ?? best.fatigue ?? 0) : Number.NEGATIVE_INFINITY
    return fatigue > bestFatigue ? slice : best
  }, null)

  if (strongestSlice) {
    pushMoment({
      key: `strongest-${strongestSlice.id || strongestSlice.t}`,
      title: 'Strongest slice',
      detail: truncateLabel(strongestSlice.app || strongestSlice.title || 'Stable work lane', 60),
      t: strongestSlice.t || 0,
      timeLabel: formatClock(strongestSlice.t || 0),
      metricPrimary: `F ${strongestSlice.focusScore ?? strongestSlice.score ?? 0}`,
      metricSecondary: `T ${strongestSlice.fatigueScore ?? strongestSlice.fatigue ?? 0}`,
      tone: 'focus',
      priority: 5,
      analyticsTarget: {
        tab: 'focus',
        eventId: getAnalyticsEventIdForSession(completed.value, 'focus'),
      },
    })
  }

  if (strainSlice && (strainSlice.fatigueScore ?? strainSlice.fatigue ?? 0) >= 40) {
    pushMoment({
      key: `strain-${strainSlice.id || strainSlice.t}`,
      title: 'Highest strain',
      detail: truncateLabel(strainSlice.app || strainSlice.title || 'Fatigue pressure rose here.', 60),
      t: strainSlice.t || 0,
      timeLabel: formatClock(strainSlice.t || 0),
      metricPrimary: `T ${strainSlice.fatigueScore ?? strainSlice.fatigue ?? 0}`,
      metricSecondary: `F ${strainSlice.focusScore ?? strainSlice.score ?? 0}`,
      tone: 'fatigue',
      priority: 5,
      analyticsTarget: {
        tab: 'fatigue',
        eventId: getAnalyticsEventIdForSession(completed.value, 'fatigue'),
      },
    })
  }

  ;(completed.value?.statusEvents || []).forEach((event) => {
    const nearbySlice = findClosestReviewSlice(event.t || 0, slices)
    pushMoment({
      key: event.id || `${event.type}-${event.t}`,
      title: event.headline || 'Session event',
      detail: truncateLabel(event.detail || nearbySlice?.title || nearbySlice?.app || 'Measured from live telemetry.', 68),
      t: event.t || 0,
      timeLabel: formatClock(event.t || 0),
      metricPrimary: nearbySlice ? `F ${nearbySlice.focusScore ?? nearbySlice.score ?? 0}` : 'Live',
      metricSecondary: nearbySlice ? `T ${nearbySlice.fatigueScore ?? nearbySlice.fatigue ?? 0}` : 'Event',
      tone: getReviewEventTone(event.type),
      priority: event.type === 'drift' ? 5 : event.type === 'recovery' ? 4 : 3,
      analyticsTarget: {
        tab: 'focus',
        eventId: getAnalyticsEventIdForSession(completed.value, 'focus'),
      },
    })
  })

  ;(completed.value?.distractionLog || []).slice(-2).forEach((event, index) => {
    const nearbySlice = findClosestReviewSlice(event.t || 0, slices)
    pushMoment({
      key: event.id || `distraction-${index}-${event.t}`,
      title: event.reason || 'Distraction flagged',
      detail: truncateLabel(event.title || event.app || 'The block was pulled off its main lane.', 68),
      t: event.t || 0,
      timeLabel: formatClock(event.t || 0),
      metricPrimary: nearbySlice ? `F ${nearbySlice.focusScore ?? nearbySlice.score ?? 0}` : 'Flagged',
      metricSecondary: nearbySlice ? `T ${nearbySlice.fatigueScore ?? nearbySlice.fatigue ?? 0}` : 'Context',
      tone: 'warn',
      priority: 4,
      analyticsTarget: {
        tab: 'apps',
        eventId: '',
      },
    })
  })

  if (reviewBrowserSummary.value.tabSwitches > 0) {
    const latestSwitch = reviewBrowserEvents.value
      .filter((entry) => ['tab-activated', 'window-focus'].includes(String(entry.eventType || '').toLowerCase()))
      .sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0))[0]
    pushMoment({
      key: `browser-switch-${completed.value?.id || 'session'}`,
      title: reviewBrowserSummary.value.tabSwitches >= 6 ? 'Heavy browser switching' : 'Browser switching happened',
      detail: truncateLabel(
        latestSwitch?.pageTitle || latestSwitch?.host || latestSwitch?.browserApp || 'Tabs were switched during this block.',
        68,
      ),
      t: Math.max(0, Number(latestSwitch?.ts || 0) - Number(completed.value?.timestamp || completed.value?.createdAt || 0)),
      timeLabel: formatTime(latestSwitch?.ts || 0),
      metricPrimary: `${reviewBrowserSummary.value.tabSwitches} switches`,
      metricSecondary: `${reviewBrowserSummary.value.uniqueHosts || 0} hosts`,
      tone: reviewBrowserSummary.value.tabSwitches >= 6 ? 'warn' : 'browser',
      sourceKind: 'browser',
      priority: reviewBrowserSummary.value.tabSwitches >= 6 ? 4 : 2,
      analyticsTarget: {
        tab: 'apps',
        eventId: `browser-switches-${getCompletedAnalyticsDateKey()}`,
      },
    })
  }

  if (reviewBrowserSummary.value.tabsOpened > 0) {
    const latestOpen = reviewBrowserEvents.value
      .filter((entry) => String(entry.eventType || '').toLowerCase() === 'tab-created')
      .sort((left, right) => Number(right.ts || 0) - Number(left.ts || 0))[0]
    pushMoment({
      key: `browser-open-${completed.value?.id || 'session'}`,
      title: reviewBrowserSummary.value.tabsOpened === 1 ? 'New tab opened' : 'Multiple tabs opened',
      detail: truncateLabel(
        latestOpen?.pageTitle || latestOpen?.host || 'New browser tabs were opened during this block.',
        68,
      ),
      t: Math.max(0, Number(latestOpen?.ts || 0) - Number(completed.value?.timestamp || completed.value?.createdAt || 0)),
      timeLabel: formatTime(latestOpen?.ts || 0),
      metricPrimary: `${reviewBrowserSummary.value.tabsOpened} opened`,
      metricSecondary: `${reviewBrowserSummary.value.uniqueHosts || 0} hosts`,
      tone: 'browser',
      sourceKind: 'browser',
      priority: 3,
      analyticsTarget: {
        tab: 'apps',
        eventId: `browser-opened-${getCompletedAnalyticsDateKey()}`,
      },
    })
  }

  if (reviewBrowserSummary.value.latestAudible) {
    pushMoment({
      key: `browser-audio-${completed.value?.id || 'session'}`,
      title: 'Browser audio overlapped this block',
      detail: truncateLabel(
        reviewBrowserSummary.value.latestAudible.pageTitle
          || reviewBrowserSummary.value.latestAudible.host
          || reviewBrowserSummary.value.latestAudible.browserApp
          || 'An audible browser tab was active.',
        68,
      ),
      t: Math.max(0, Number(reviewBrowserSummary.value.latestAudible.ts || 0) - Number(completed.value?.timestamp || completed.value?.createdAt || 0)),
      timeLabel: formatTime(reviewBrowserSummary.value.latestAudible.ts || 0),
      metricPrimary: `${reviewBrowserSummary.value.audibleMoments} audible`,
      metricSecondary: reviewBrowserSummary.value.latestAudible.host || 'browser audio',
      tone: 'browser-audio',
      sourceKind: 'browser',
      priority: 4,
      analyticsTarget: {
        tab: 'apps',
        eventId: `browser-audio-${getCompletedAnalyticsDateKey()}`,
      },
    })
  }

  if (linkedReviewTask.value) {
    pushMoment({
      key: `task-${linkedReviewTask.value.id}`,
      title: linkedReviewTask.value.status === 'completed' ? 'Linked task closed' : 'Linked task carried forward',
      detail: truncateLabel(linkedReviewTask.value.title || completed.value?.taskTitle || 'Task', 68),
      t: completed.value?.durationSeconds || 0,
      timeLabel: formatClock(completed.value?.durationSeconds || 0),
      metricPrimary: linkedReviewTask.value.status === 'completed' ? 'Done' : linkedReviewTask.value.status || 'Linked',
      metricSecondary: `F ${completed.value?.focusScore || 0}`,
      tone: linkedReviewTask.value.status === 'completed' ? 'focus' : 'steady',
      priority: linkedReviewTask.value.status === 'completed' ? 4 : 2,
      analyticsTarget: {
        tab: 'focus',
        eventId: linkedReviewTask.value.status === 'completed'
          ? `task-complete-${linkedReviewTask.value.id}`
          : getAnalyticsEventIdForSession(completed.value, 'focus'),
      },
    })
  }

  return moments
    .sort((left, right) => right.priority - left.priority || left.t - right.t)
    .slice(0, 5)
})
const reviewTimelineTrack = computed(() => {
  const slices = reviewTimelineRows.value
  const total = Math.max(
    Number(completed.value?.durationSeconds || 0),
    Number(slices[slices.length - 1]?.t || 0),
    1,
  )

  return slices.map((slice, index) => {
    const previousT = index > 0 ? Number(slices[index - 1]?.t || 0) : 0
    const currentT = Number(slice.t || 0)
    const duration = Math.max(8, currentT - previousT || 10)
    const focus = slice.focusScore ?? slice.score ?? 0
    const fatigue = slice.fatigueScore ?? slice.fatigue ?? 0
    const tone = getReviewSliceTone(slice)

    return {
      ...slice,
      left: round((previousT / total) * 100, 2),
      width: Math.max(1.4, round((duration / total) * 100, 2)),
      height: Math.max(20, Math.round((focus / 100) * 56) + 18),
      tone,
      fill: getReviewSliceFill(tone),
      titleText: `${formatClock(currentT)} - ${slice.app || 'Unknown app'} - F ${focus} - T ${fatigue}`,
    }
  })
})
const reviewTimelineMarkers = computed(() => {
  const total = Math.max(
    Number(completed.value?.durationSeconds || 0),
    Number(reviewTimelineRows.value[reviewTimelineRows.value.length - 1]?.t || 0),
    1,
  )

  return reviewMoments.value.map((moment) => ({
    ...moment,
    left: round((Math.max(0, Number(moment.t || 0)) / total) * 100, 2),
  }))
})
const reviewTimelineCheckpoints = computed(() => {
  const slices = reviewTimelineRows.value
  if (!slices.length) return []

  const strongestSlice = slices.reduce((best, slice) => {
    const score = (slice.focusScore ?? slice.score ?? 0) - ((slice.fatigueScore ?? slice.fatigue ?? 0) * 0.35)
    const bestScore = best ? ((best.focusScore ?? best.score ?? 0) - ((best.fatigueScore ?? best.fatigue ?? 0) * 0.35)) : Number.NEGATIVE_INFINITY
    return score > bestScore ? slice : best
  }, null)

  const points = [
    {
      label: 'Start lane',
      slice: slices[0],
    },
    {
      label: 'Deepest lane',
      slice: strongestSlice || slices[Math.floor(slices.length / 2)],
    },
    {
      label: 'Finish state',
      slice: slices[slices.length - 1],
    },
  ]

  return points.map((point) => ({
    label: point.label,
    app: truncateLabel(point.slice?.app || point.slice?.title || 'Unknown app', 28),
    timeLabel: formatClock(point.slice?.t || 0),
    focusScore: point.slice?.focusScore ?? point.slice?.score ?? 0,
    fatigueScore: point.slice?.fatigueScore ?? point.slice?.fatigue ?? 0,
    tone: getReviewSliceTone(point.slice),
  }))
})
const liveSegments = computed(() => {
  const source = running.value
    ? tracker.timelineSegments.value
    : (completed.value?.timeline || completed.value?.timelineSegments || [])
  return source.slice(-18)
})

function formatClock(totalSeconds = 0) {
  const total = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatDuration(totalSeconds = 0) {
  const total = Math.max(0, Math.round(totalSeconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const hours = Math.floor(minutes / 60)
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

function formatRatioPercent(value = 0) {
  const raw = Number(value || 0)
  const percent = raw <= 1 ? raw * 100 : raw
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`
}

function getCompletedAnalyticsDateKey() {
  return getAnalyticsDateKeyFromSession(completed.value)
}

function getReviewMomentAnalyticsTarget(moment = null) {
  if (!completed.value) return null

  if (moment?.analyticsTarget?.tab) {
    return {
      tab: moment.analyticsTarget.tab,
      eventId: moment.analyticsTarget.eventId || '',
    }
  }

  return {
    tab: 'focus',
    eventId: getAnalyticsEventIdForSession(completed.value, 'focus'),
  }
}

function openReviewMomentInAnalytics(moment = null) {
  if (!completed.value) return
  const target = getReviewMomentAnalyticsTarget(moment)
  if (!target) return
  router.push(buildAnalyticsLocation({
    dateKey: getCompletedAnalyticsDateKey(),
    tab: target.tab,
    eventId: target.eventId,
  }))
}

function openCompletedSessionInAnalytics(tab = 'focus') {
  if (!completed.value) return
  const eventId = tab === 'fatigue'
    ? getAnalyticsEventIdForSession(completed.value, 'fatigue')
    : getAnalyticsEventIdForSession(completed.value, 'focus')
  router.push(buildAnalyticsLocation({
    dateKey: getCompletedAnalyticsDateKey(),
    tab,
    eventId,
  }))
}

function formatDurationMinutes(totalMinutes = 0) {
  const minutes = Math.max(0, Math.round(totalMinutes))
  if (minutes === 0) return 'No limit'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function formatAppTime(seconds = 0) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  return formatDuration(seconds)
}

function setActiveMixSegment(label) {
  activeMixSegmentLabel.value = label
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--:--'
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function scoreTone(score = 0, fatigue = 0) {
  if (score >= 80 && fatigue < 50) return 'good'
  if (fatigue >= 65 || score < 58) return 'warn'
  return 'steady'
}

function scoreBandTone(score = 0, { good = 75, warn = 55 } = {}) {
  const safe = Number.isFinite(score) ? score : 0
  if (safe >= good) return 'good'
  if (safe <= warn) return 'warn'
  return 'steady'
}

function round(value, digits = 0) {
  const safe = Number.isFinite(value) ? value : 0
  const factor = 10 ** digits
  return Math.round(safe * factor) / factor
}

function truncateLabel(value = '', limit = 36) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trim()}...` : text
}

function getReviewSliceTone(slice = {}) {
  const focus = slice.focusScore ?? slice.score ?? 0
  const fatigue = slice.fatigueScore ?? slice.fatigue ?? 0
  if (fatigue >= 72) return 'fatigue'
  if (focus >= 80 && fatigue < 55) return 'focus'
  if (focus >= 60) return 'steady'
  if (focus < 45) return 'warn'
  return 'neutral'
}

function getReviewSliceFill(tone = 'neutral') {
  if (tone === 'focus') return 'linear-gradient(180deg, rgba(20, 184, 166, 0.94), rgba(45, 212, 191, 0.68))'
  if (tone === 'fatigue') return 'linear-gradient(180deg, rgba(249, 115, 22, 0.94), rgba(251, 113, 133, 0.72))'
  if (tone === 'warn') return 'linear-gradient(180deg, rgba(251, 113, 133, 0.9), rgba(249, 115, 22, 0.68))'
  if (tone === 'steady') return 'linear-gradient(180deg, rgba(14, 165, 233, 0.88), rgba(96, 165, 250, 0.64))'
  return 'linear-gradient(180deg, rgba(148, 163, 184, 0.8), rgba(203, 213, 225, 0.52))'
}

function getReviewEventTone(type = '') {
  if (type === 'flow') return 'focus'
  if (type === 'recovery') return 'steady'
  if (type === 'drift') return 'warn'
  return 'neutral'
}

function findClosestReviewSlice(seconds = 0, slices = []) {
  if (!slices.length) return null
  return slices.reduce((best, slice) => {
    const gap = Math.abs((slice.t || 0) - seconds)
    const bestGap = best ? Math.abs((best.t || 0) - seconds) : Number.POSITIVE_INFINITY
    return gap < bestGap ? slice : best
  }, null)
}

function tweenScore(targetRef, nextValue, key) {
  const from = targetRef.value
  const to = Number.isFinite(nextValue) ? nextValue : 0
  const startAt = performance.now()
  const duration = 900
  const previousHandle = key === 'focus' ? focusAnimationFrame : fatigueAnimationFrame
  if (previousHandle) cancelAnimationFrame(previousHandle)

  const step = (now) => {
    const progress = Math.min(1, (now - startAt) / duration)
    const eased = 1 - ((1 - progress) ** 3)
    targetRef.value = Math.round(from + ((to - from) * eased))
    if (progress < 1) {
      const handle = requestAnimationFrame(step)
      if (key === 'focus') focusAnimationFrame = handle
      else fatigueAnimationFrame = handle
    }
  }

  const handle = requestAnimationFrame(step)
  if (key === 'focus') focusAnimationFrame = handle
  else fatigueAnimationFrame = handle
}

function buildWavePoints(values, height = 220, top = 26, amplitude = 126) {
  const size = values.length || 1
  return values.map((value, index) => {
    const x = size === 1 ? 0 : (index / (size - 1)) * 960
    const y = height - top - ((Math.max(0, Math.min(100, value)) / 100) * amplitude)
    return [round(x, 1), round(y, 1)]
  })
}

function buildCurve(points) {
  if (!points.length) return ''
  let path = `M ${points[0][0]} ${points[0][1]}`
  for (let index = 1; index < points.length; index += 1) {
    const [previousX, previousY] = points[index - 1]
    const [x, y] = points[index]
    const controlX = round((previousX + x) / 2, 1)
    path += ` C ${controlX} ${previousY}, ${controlX} ${y}, ${x} ${y}`
  }
  return path
}

function buildAreaPath(points, height = 220) {
  if (!points.length) return ''
  const line = buildCurve(points)
  const [firstX] = points[0]
  const [lastX] = points[points.length - 1]
  return `${line} L ${lastX} ${height} L ${firstX} ${height} Z`
}

const waveFocusPath = computed(() => {
  const values = liveSegments.value.map((segment) => segment.focusScore ?? segment.score ?? 0)
  return buildAreaPath(buildWavePoints(values))
})

const waveFocusLine = computed(() => {
  const values = liveSegments.value.map((segment) => segment.focusScore ?? segment.score ?? 0)
  return buildCurve(buildWavePoints(values))
})

const waveFatigueLine = computed(() => {
  const values = liveSegments.value.map((segment) => 100 - (segment.fatigueScore ?? segment.fatigue ?? 0))
  return buildCurve(buildWavePoints(values, 220, 72, 64))
})

function selectDuration(minutes) {
  durationMode.value = String(minutes)
  durationGoalMinutes.value = minutes
}

function applyFocusDuration(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)))
  if (durationPresets.includes(safeMinutes)) {
    durationMode.value = String(safeMinutes)
    durationGoalMinutes.value = safeMinutes
    syncCustomDraft(safeMinutes)
    return
  }
  durationMode.value = 'custom'
  durationGoalMinutes.value = safeMinutes
  syncCustomDraft(safeMinutes)
}

function applyHabitDuration(habit) {
  const minutes = Math.max(5, Math.round(Number(habit?.targetMinutes || 0)))
  if (!minutes) return
  applyFocusDuration(minutes)
}

function syncCustomDraft(minutes = 0) {
  const safeMinutes = Math.max(0, Math.round(minutes || 0))
  customNoLimit.value = safeMinutes === 0
  if (safeMinutes === 0) {
    customHours.value = 0
    customMinutes.value = 0
    return
  }
  customHours.value = clampInteger(Math.floor(safeMinutes / 60), 0, 12)
  customMinutes.value = clampInteger(safeMinutes % 60, 0, 59)
}

function openCustomSheet() {
  syncCustomDraft(durationMode.value === 'custom' ? durationGoalMinutes.value : durationGoalMinutes.value)
  customSheetOpen.value = true
}

function normalizeCustomInputs() {
  customHours.value = clampInteger(customHours.value, 0, 12)
  customMinutes.value = clampInteger(customMinutes.value, 0, 59)
}

function adjustCustomHours(delta) {
  customNoLimit.value = false
  customHours.value = clampInteger(Number(customHours.value || 0) + delta, 0, 12)
}

function adjustCustomMinutes(delta) {
  customNoLimit.value = false
  const startTotal = (clampInteger(customHours.value, 0, 12) * 60) + clampInteger(customMinutes.value, 0, 59)
  const nextTotal = Math.max(0, Math.min((12 * 60) + 59, startTotal + delta))
  customHours.value = Math.floor(nextTotal / 60)
  customMinutes.value = nextTotal % 60
}

function useNoLimit() {
  customNoLimit.value = true
}

function applyCustomSelection() {
  normalizeCustomInputs()
  if (!customNoLimit.value && customDurationTotal.value <= 0) return
  durationMode.value = 'custom'
  durationGoalMinutes.value = customNoLimit.value ? 0 : customDurationTotal.value
  customSheetOpen.value = false
}

function togglePicker(type) {
  pickerOpen.value = pickerOpen.value === type ? null : type
}

function clearTask() {
  linkedTaskId.value = null
}

function clearHabit() {
  linkedHabitId.value = null
}

function pickTask(task) {
  linkedTaskId.value = task.id
  const linkedHabit = task.habit
    ? habits.value.find((habit) => String(habit.name || '').trim().toLowerCase() === String(task.habit || '').trim().toLowerCase())
    : null
  if (linkedHabit) {
    linkedHabitId.value = linkedHabit.id
    applyHabitDuration(linkedHabit)
  }
  pickerOpen.value = null
  taskQuery.value = ''
}

function pickHabit(habit) {
  linkedHabitId.value = habit.id
  applyHabitDuration(habit)
  pickerOpen.value = null
  habitQuery.value = ''
}

function applyWorkflowCard(cardId) {
  if (cardId === 'task' && suggestedTaskCandidate.value) {
    pickTask(suggestedTaskCandidate.value)
    return
  }
  if (cardId === 'habit' && suggestedHabitCandidate.value) {
    pickHabit(suggestedHabitCandidate.value)
  }
}

async function ensureSessionPersisted(payload) {
  if (!payload?.id) return
  if (store.sessions.some((session) => session.id === payload.id)) return
  await store.addSession(payload)
}

async function startSession() {
  const task = selectedTask.value
  const habit = selectedHabit.value
  tracker.clearCompletedSession()
  const started = tracker.start({
    sessionId: `session-${Date.now()}`,
    goal: goal.value.trim() || task?.title || habit?.name || 'Focus session',
    taskTitle: task?.title || null,
    habit: habit?.name || null,
    linkedTaskId: task?.id || null,
    linkedHabitId: habit?.id || null,
    durationGoalMinutes: durationGoalMinutes.value,
  })
  if (!started) return

  if (task && task.status === 'to-do') {
    await store.updateTask(task.id, { status: 'in-progress' })
  }

  if (minimizeOnStart.value) window.velance?.minimizeWindow?.()
}

function togglePause() {
  if (!running.value) return
  if (tracker.isPaused.value) tracker.resume()
  else tracker.pause()
}

function backgroundSession() {
  window.velance?.minimizeWindow?.()
}

async function endSession() {
  if (!running.value) return
  const payload = tracker.stop()
  await ensureSessionPersisted(payload)
}

async function saveAndLeave() {
  if (!completed.value) return
  const session = completed.value
  await ensureSessionPersisted(session)
  tracker.clearCompletedSession()
  router.push(buildAnalyticsLocation({
    dateKey: getAnalyticsDateKeyFromSession(session),
    tab: 'focus',
    eventId: getAnalyticsEventIdForSession(session, 'focus'),
  }))
}

async function completeLinkedTaskFromReview() {
  if (!linkedReviewTask.value) return
  await store.completeTask(linkedReviewTask.value.id)
}

async function createFollowUpTaskFromReview() {
  const title = truncateLabel(completed.value?.goal || completed.value?.taskTitle || completed.value?.habit || 'Follow-up task', 96)
  if (!title) return
  await store.addTask({
    title,
    desc: `Follow-up captured from a focus review on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`,
    priority: 'Normal',
    habit: suggestedReviewHabit.value?.name || completed.value?.habit || '',
    due: getTodayLocalDateKey(),
    status: 'to-do',
  })
  router.push('/tasks')
}

function openTasksBoard() {
  router.push('/tasks')
}

function openHabitsBoard() {
  router.push('/habits')
}

function openPrivacySettings() {
  router.push('/settings')
}

function selectReviewDetailMode(mode) {
  if (reviewModes.some((entry) => entry.id === mode)) {
    reviewDetailMode.value = mode
  }
}

function applySuggestedHabitForNextRun() {
  if (!suggestedReviewHabit.value) return
  linkedHabitId.value = suggestedReviewHabit.value.id
  applyHabitDuration(suggestedReviewHabit.value)
  if (!goal.value.trim()) {
    goal.value = completed.value?.goal || completed.value?.taskTitle || suggestedReviewHabit.value.name || ''
  }
  tracker.clearCompletedSession()
}

async function runReviewWorkflowAction(action = '') {
  if (action === 'complete-task') {
    await completeLinkedTaskFromReview()
    return
  }
  if (action === 'create-task') {
    await createFollowUpTaskFromReview()
    return
  }
  if (action === 'open-task') {
    openTasksBoard()
    return
  }
  if (action === 'open-habit') {
    openHabitsBoard()
    return
  }
  if (action === 'apply-habit') {
    applySuggestedHabitForNextRun()
  }
}

async function runAnother() {
  if (completed.value) await ensureSessionPersisted(completed.value)
  if (completed.value?.goal) goal.value = completed.value.goal
  if (completed.value?.durationGoalMinutes !== undefined) {
    const duration = Number(completed.value.durationGoalMinutes || completed.value.durationGoal || 0)
    applyFocusDuration(duration)
  }
  linkedTaskId.value = completed.value?.linkedTaskId ?? linkedTaskId.value
  linkedHabitId.value = completed.value?.linkedHabitId ?? linkedHabitId.value
  tracker.clearCompletedSession()
}

async function deleteReview() {
  if (completed.value?.id && store.sessions.some((session) => session.id === completed.value.id)) {
    await store.deleteSession(completed.value.id)
  }
  tracker.clearCompletedSession()
}

watch(() => selectedTask.value?.title, (title) => {
  if (!goal.value.trim() && title) goal.value = title
})

watch(() => selectedTask.value?.habit, (habitName) => {
  if (!habitName || linkedHabitId.value) return
  const habit = habits.value.find((entry) => entry.name === habitName)
  if (habit) {
    linkedHabitId.value = habit.id
    applyHabitDuration(habit)
  }
})

watch(reviewMixSegments, (segments) => {
  if (!segments.length) {
    activeMixSegmentLabel.value = ''
    return
  }
  if (segments.some((segment) => segment.label === activeMixSegmentLabel.value)) return
  activeMixSegmentLabel.value = segments.find((segment) => segment.value > 0)?.label || segments[0].label
}, { immediate: true })

watch(
  () => running.value ? tracker.focusScore.value : (completed.value?.focusScore || 0),
  (value) => tweenScore(animatedFocusScore, value, 'focus'),
  { immediate: true },
)

watch(
  () => running.value ? tracker.fatigueScore.value : (completed.value?.fatigueScore || 0),
  (value) => tweenScore(animatedFatigueScore, value, 'fatigue'),
  { immediate: true },
)

watch(
  () => tracker.completedSession.value?.id,
  async (id) => {
    if (!id || !tracker.completedSession.value) return
    await ensureSessionPersisted(tracker.completedSession.value)
    await ambient.refreshDate(getAnalyticsDateKeyFromSession(tracker.completedSession.value))
  },
)

onMounted(() => {
  void ambient.attachListener()
  const preset = consumeFocusLaunch()
  if (!preset || running.value || completed.value) return

  if (preset.goal) goal.value = preset.goal
  else if (preset.title) goal.value = preset.title

  if (preset.taskId) linkedTaskId.value = preset.taskId
  let matchedHabit = null
  if (preset.habitId) {
    matchedHabit = habits.value.find((habit) => String(habit.id) === String(preset.habitId))
    if (matchedHabit) linkedHabitId.value = matchedHabit.id
  } else if (preset.habit) {
    matchedHabit = habits.value.find((habit) => habit.name === preset.habit)
    if (matchedHabit) linkedHabitId.value = matchedHabit.id
  }
  if (matchedHabit) applyHabitDuration(matchedHabit)
  if (preset.durationGoalMinutes !== null && preset.durationGoalMinutes !== undefined) {
    applyFocusDuration(preset.durationGoalMinutes)
  }
})

onUnmounted(() => {
  if (focusAnimationFrame) cancelAnimationFrame(focusAnimationFrame)
  if (fatigueAnimationFrame) cancelAnimationFrame(fatigueAnimationFrame)
})
</script>

<template>
  <div class="focus-v2" @click="pickerOpen = null">
    <div class="focus-glow focus-glow-a"></div>
    <div class="focus-glow focus-glow-b"></div>

    <section v-if="!running && !completed" class="setup-state">
      <div class="setup-card" @click.stop>
        <div class="setup-head">
          <span class="eyebrow">Focus</span>
          <div class="setup-pill">{{ telemetryLabel }}</div>
        </div>

        <div class="setup-copy">
          <h1>Start clean.</h1>
          <p>One calm block, tracked from real app and input signals.</p>
        </div>

        <label class="field-label">Goal</label>
        <input
          v-model="goal"
          class="goal-input"
          type="text"
          maxlength="120"
          placeholder="One clear target for this block"
        />

        <label class="field-label">Duration</label>
        <div class="duration-row">
          <button
            v-for="preset in durationPresets"
            :key="preset"
            class="duration-chip"
            :class="{ active: durationMode === String(preset) }"
            @click="selectDuration(preset)"
          >
            {{ preset }}m
          </button>
          <button class="duration-chip custom" :class="{ active: durationMode === 'custom' }" @click="openCustomSheet">
            {{ durationMode === 'custom' ? durationChipLabel : 'Custom' }}
          </button>
        </div>

        <div class="attach-row">
          <div class="attach-stack">
            <label class="field-label">Task</label>
            <button class="attach-field" @click.stop="togglePicker('task')">
              <div class="attach-copy">
                <span class="attach-label">Link task</span>
                <strong v-if="selectedTask">{{ selectedTask.title }}</strong>
                <span v-else>Optional</span>
              </div>
              <div class="attach-actions">
                <span v-if="selectedTask" class="clear-btn" @click.stop="clearTask">
                  <XIcon class="icon" />
                </span>
                <ChevronDownIcon class="icon chevron" />
              </div>
            </button>

            <div v-if="pickerOpen === 'task'" class="attach-popover">
              <input v-model="taskQuery" class="attach-search" type="text" placeholder="Search tasks" />
              <div class="attach-list">
                <button v-for="task in filteredTasks" :key="task.id" class="attach-option" @click="pickTask(task)">
                  <div>
                    <strong>{{ task.title }}</strong>
                    <span v-if="task.habit">{{ task.habit }}</span>
                  </div>
                  <CheckIcon v-if="selectedTask?.id === task.id" class="icon" />
                </button>
                <div v-if="!filteredTasks.length" class="attach-empty">No task found.</div>
              </div>
            </div>
          </div>

          <div class="attach-stack">
            <label class="field-label">Habit</label>
            <button
              class="attach-field habit-attach-field"
              :class="{ linked: selectedHabit }"
              :style="selectedHabit ? { '--habit-accent': selectedHabit.color || '#00B4D8' } : null"
              @click.stop="togglePicker('habit')"
            >
              <div class="attach-copy">
                <span class="attach-label">Link habit</span>
                <strong v-if="selectedHabit">{{ selectedHabit.name }}</strong>
                <span v-else>Optional</span>
                <span v-if="selectedHabit">{{ selectedHabit.targetMinutes || durationGoalMinutes }} min focus target</span>
              </div>
              <div class="attach-actions">
                <span v-if="selectedHabit" class="clear-btn" @click.stop="clearHabit">
                  <XIcon class="icon" />
                </span>
                <ChevronDownIcon class="icon chevron" />
              </div>
            </button>

            <div v-if="pickerOpen === 'habit'" class="attach-popover">
              <input v-model="habitQuery" class="attach-search" type="text" placeholder="Search habits" />
              <div class="attach-list">
                <button v-for="habit in filteredHabits" :key="habit.id" class="attach-option" @click="pickHabit(habit)">
                  <div>
                    <strong>{{ habit.name }}</strong>
                    <span>{{ habit.targetMinutes }} min target</span>
                  </div>
                  <CheckIcon v-if="selectedHabit?.id === habit.id" class="icon" />
                </button>
                <div v-if="!filteredHabits.length" class="attach-empty">No habit found.</div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="setupWorkflowCards.length" class="workflow-grid setup-workflow-grid">
          <article
            v-for="card in setupWorkflowCards"
            :key="card.id"
            class="surface workflow-card"
            :class="card.tone"
          >
            <div class="workflow-copy">
              <span class="surface-label">{{ card.eyebrow }}</span>
              <strong>{{ card.title }}</strong>
              <p>{{ card.detail }}</p>
            </div>
            <button class="workflow-action-btn" type="button" @click="applyWorkflowCard(card.id)">
              {{ card.cta }}
            </button>
          </article>
        </div>

        <article v-if="startBlocked" class="tracking-block-card">
          <div class="tracking-block-icon">
            <ShieldAlertIcon class="icon" />
          </div>
          <div class="tracking-block-copy">
            <span class="surface-label">Tracking blocked</span>
            <h2>{{ trackingBlockedTitle }}</h2>
            <p>{{ trackingBlockedReason }}</p>
            <div class="tracking-block-list">
              <span v-for="item in trackingBlockedCards" :key="item">
                <CheckIcon class="icon" />
                {{ item }}
              </span>
            </div>
          </div>
          <div class="tracking-block-actions">
            <button class="secondary-btn compact" type="button" @click="openTasksBoard">
              Use Tasks
            </button>
            <button class="primary-cta compact" type="button" @click="openPrivacySettings">
              <SettingsIcon class="icon" />
              Open Privacy
            </button>
          </div>
        </article>

        <label class="toggle-row">
          <input v-model="minimizeOnStart" type="checkbox" />
          <span>Minimize on start</span>
        </label>

        <div class="setup-footer">
          <div class="setup-mini">
            <TargetIcon class="icon" />
            <span>{{ setupTitle }}</span>
          </div>
          <div class="setup-actions">
            <button class="primary-cta" :disabled="startBlocked" @click="startSession">Start focus</button>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="running" class="live-state">
      <header class="live-head">
        <div class="live-heading">
          <span class="eyebrow">Live session</span>
          <h1>{{ liveTitle }}</h1>
        </div>
        <div class="live-pill" :class="liveStateLabel.toLowerCase()">{{ liveStateLabel }}</div>
      </header>

      <section class="surface live-overview">
        <div class="timer-cluster">
          <span class="surface-label">Timer</span>
          <strong>{{ formatClock(tracker.elapsedSeconds.value) }}</strong>
        </div>

        <div class="score-strip">
          <article class="score-tile" :class="scoreTone(tracker.focusScore.value, tracker.fatigueScore.value)">
            <span class="surface-label">Focus score</span>
            <strong>{{ animatedFocusScore }}</strong>
          </article>

          <article class="score-tile fatigue">
            <span class="surface-label">Fatigue score</span>
            <strong>{{ animatedFatigueScore }}</strong>
          </article>
        </div>
      </section>

      <div class="live-body">
        <article class="surface context-surface">
          <div class="context-head">
            <div>
              <span class="surface-label">Observed app</span>
              <strong>{{ currentAppLabel }}</strong>
            </div>
            <span class="context-state">{{ tracker.focusQuality.value.title }}</span>
          </div>
          <p>{{ currentWindowLabel }}</p>
          <small>{{ currentSignalLabel }}</small>
          <div class="metric-row live-metrics">
            <div v-for="metric in liveMetrics" :key="metric.label" class="metric-pill" :class="metric.tone">
              <span>{{ metric.label }}</span>
              <strong>{{ metric.value }}</strong>
            </div>
          </div>

          <div class="activity-list-shell">
            <div class="activity-list-head">
              <span class="surface-label">Recent activity</span>
              <span class="wave-meta">{{ liveActivityFeed.length ? `${liveActivityFeed.length} samples` : 'No samples yet' }}</span>
            </div>
            <div v-if="liveActivityFeed.length" class="activity-list">
              <article v-for="entry in liveActivityFeed" :key="entry.id" class="activity-item">
                <div class="activity-main">
                  <strong>{{ entry.app }}</strong>
                  <span>{{ entry.title }}</span>
                </div>
                <div class="activity-meta">
                  <span>{{ formatTime(entry.timestamp) }}</span>
                  <span>{{ formatAppTime(entry.durationSeconds) }}</span>
                  <span>{{ entry.keystrokes }} keys</span>
                  <span>{{ entry.clicks }} clicks</span>
                </div>
              </article>
            </div>
            <div v-else class="activity-empty">Tracked samples will appear here as soon as a real app window is observed.</div>
          </div>
        </article>

        <article class="surface wave-surface" :class="{ paused: tracker.isPaused.value, empty: !liveSegments.length }">
          <div class="wave-head">
            <span class="surface-label">Session flow</span>
            <span class="wave-meta">{{ liveSegments.length ? `${liveSegments.length} slices` : 'Waiting for first trace' }}</span>
          </div>
          <div class="wave-frame">
            <svg v-if="liveSegments.length" viewBox="0 0 960 220" class="wave-svg" preserveAspectRatio="none">
              <defs>
                <linearGradient id="focusFill" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.45" />
                  <stop offset="100%" stop-color="#14b8a6" stop-opacity="0.1" />
                </linearGradient>
                <linearGradient id="focusStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#0ea5e9" />
                  <stop offset="100%" stop-color="#14b8a6" />
                </linearGradient>
                <linearGradient id="fatigueStroke" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#f97316" stop-opacity="0.8" />
                  <stop offset="100%" stop-color="#fb7185" stop-opacity="0.45" />
                </linearGradient>
              </defs>
              <path :d="waveFocusPath" fill="url(#focusFill)" class="wave-area wave-motion" />
              <path :d="waveFocusLine" fill="none" stroke="url(#focusStroke)" stroke-width="4" stroke-linecap="round" class="wave-line wave-motion" />
              <path :d="waveFatigueLine" fill="none" stroke="url(#fatigueStroke)" stroke-width="2.5" stroke-linecap="round" class="wave-mist wave-motion-soft" />
            </svg>
            <div v-else class="wave-empty">
              <strong>Trace starts on the first observed work window.</strong>
              <span>Background Velance and move into the app you want tracked.</span>
            </div>
          </div>
        </article>
      </div>

      <footer class="control-bar">
        <button class="secondary-btn" @click="backgroundSession">
          <Minimize2Icon class="icon" />
          Background
        </button>
        <button class="secondary-btn" @click="togglePause">
          <component :is="tracker.isPaused.value ? PlayIcon : PauseIcon" class="icon" />
          {{ tracker.isPaused.value ? 'Resume' : 'Pause' }}
        </button>
        <button class="danger-btn" @click="endSession">
          <SquareIcon class="icon" />
          End
        </button>
      </footer>
    </section>

    <section v-else class="review-state">
      <div class="review-card">
        <div class="review-head">
          <div class="review-title">
            <span class="eyebrow">Review</span>
            <h1>{{ reviewTitle }}</h1>
            <p class="review-subtitle">{{ completed?.focusQualityDetail || 'Measured from live telemetry.' }}</p>
            <div v-if="reviewHeaderChips.length" class="review-chip-row">
              <div
                v-for="chip in reviewHeaderChips"
                :key="`${chip.label}-${chip.value}`"
                class="review-chip"
                :class="chip.tone"
              >
                <small>{{ chip.label }}</small>
                <strong>{{ chip.value }}</strong>
              </div>
            </div>
          </div>
          <div class="review-status-stack">
            <div class="live-pill" :class="scoreTone(completed?.focusScore || 0, completed?.fatigueScore || 0)">
              {{ completed?.focusQuality || 'Finished' }}
            </div>
            <span class="review-status-note">{{ completed?.fatigueRisk || 'Low' }} fatigue risk</span>
          </div>
        </div>

        <section class="review-decision-card" :class="reviewOutcome.tone">
          <div class="review-decision-main">
            <span class="surface-label">Coach read</span>
            <h2>{{ reviewOutcome.title }}</h2>
            <p>{{ reviewOutcome.detail }}</p>
          </div>
          <div class="review-decision-next">
            <span>Next best move</span>
            <strong>{{ reviewOutcome.next }}</strong>
          </div>
        </section>

        <div class="review-stats">
          <article class="surface mini-stat review-stat-card">
            <span class="surface-label">Duration</span>
            <strong>{{ formatDuration(completed?.durationSeconds || 0) }}</strong>
            <small class="review-stat-note">Measured block</small>
          </article>
          <article class="surface mini-stat review-stat-card" :class="scoreTone(completed?.focusScore || 0, 0)">
            <span class="surface-label">Focus score</span>
            <strong>{{ animatedFocusScore }}</strong>
            <small class="review-stat-note">Final compounded score</small>
          </article>
          <article
            class="surface mini-stat review-stat-card"
            :class="completed?.fatigueScore >= 65 ? 'warn' : completed?.fatigueScore <= 35 ? 'good' : 'steady'"
          >
            <span class="surface-label">Fatigue score</span>
            <strong>{{ animatedFatigueScore }}</strong>
            <small class="review-stat-note">Pressure across the block</small>
          </article>
          <article
            class="surface mini-stat review-stat-card"
            :class="(completed?.bestFlowSeconds || reviewSummary.bestFlowSeconds || 0) >= 300 ? 'good' : 'steady'"
          >
            <span class="surface-label">Best flow</span>
            <strong>{{ formatDuration(completed?.bestFlowSeconds || reviewSummary.bestFlowSeconds || 0) }}</strong>
            <small class="review-stat-note">Longest uninterrupted lane</small>
          </article>
        </div>

        <div v-if="reviewDetailMode !== 'summary'" class="review-mini-stats">
          <article v-for="metric in reviewMetrics" :key="metric.label" class="surface mini-stat compact quiet">
            <span class="surface-label">{{ metric.label }}</span>
            <strong>{{ metric.value }}</strong>
            <small class="review-stat-note">{{ metric.note }}</small>
          </article>
        </div>

        <div v-if="reviewWorkflowCards.length" class="workflow-grid review-workflow-grid">
          <article
            v-for="card in reviewWorkflowCards"
            :key="card.id"
            class="surface workflow-card"
            :class="card.tone"
          >
            <div class="workflow-copy">
              <span class="surface-label">{{ card.eyebrow }}</span>
              <strong>{{ card.title }}</strong>
              <p>{{ card.detail }}</p>
              <small>{{ card.meta }}</small>
            </div>
            <button class="workflow-action-btn" type="button" @click="runReviewWorkflowAction(card.action)">
              {{ card.cta }}
            </button>
          </article>
        </div>

        <nav class="review-mode-switch" aria-label="Review detail level">
          <button
            v-for="mode in reviewModes"
            :key="mode.id"
            type="button"
            :class="{ active: reviewDetailMode === mode.id }"
            @click="selectReviewDetailMode(mode.id)"
          >
            <strong>{{ mode.label }}</strong>
            <span>{{ mode.detail }}</span>
          </button>
        </nav>

        <div class="review-grid">
          <article v-if="reviewDetailMode === 'summary'" class="surface review-mix">
            <div class="review-apps-head">
              <span class="surface-label">Session mix</span>
              <span class="wave-meta">{{ completed?.focusQualityDetail || 'Measured from live telemetry' }}</span>
            </div>

            <div class="mix-layout">
              <div class="mix-ring" :style="reviewMixStyle">
                <div class="mix-core">
                  <strong>{{ animatedFocusScore }}</strong>
                  <span>Focus</span>
                </div>
              </div>

              <div v-if="activeReviewMixSegment" class="mix-detail">
                <div class="mix-detail-head">
                  <span class="mix-detail-label" :class="activeReviewMixSegment.tone">{{ activeReviewMixSegment.label }}</span>
                  <strong>{{ activeReviewMixSegment.share }}%</strong>
                </div>
                <p>{{ activeReviewMixSegment.description }}</p>
                <span class="mix-detail-time">{{ formatAppTime(activeReviewMixSegment.value) }} observed</span>
              </div>
            </div>

            <div class="mix-segment-grid">
              <button
                v-for="segment in reviewMixSegments"
                :key="segment.label"
                class="mix-segment-chip"
                :class="[segment.tone, { active: activeReviewMixSegment?.label === segment.label }]"
                @mouseenter="setActiveMixSegment(segment.label)"
                @focus="setActiveMixSegment(segment.label)"
                @click="setActiveMixSegment(segment.label)"
              >
                <span class="mix-dot" :style="{ background: segment.color }"></span>
                <span class="mix-segment-copy">
                  <strong>{{ segment.label }}</strong>
                  <small>{{ segment.share }}% - {{ formatAppTime(segment.value) }}</small>
                </span>
              </button>
            </div>
          </article>

          <article v-if="reviewDetailMode === 'summary'" class="surface review-moments">
            <div class="review-apps-head">
              <span class="surface-label">Meaningful moments</span>
              <span class="wave-meta">{{ reviewMoments.length ? `${reviewMoments.length} surfaced` : 'No major events' }}</span>
            </div>

            <div class="review-moment-list">
              <button
                v-for="moment in reviewMoments"
                :key="moment.key"
                class="review-moment-row"
                :class="{ linked: !!moment.analyticsTarget }"
                type="button"
                @click="openReviewMomentInAnalytics(moment)"
              >
                <div class="review-moment-main">
                  <div class="review-moment-head">
                    <strong>{{ moment.title }}</strong>
                    <span>{{ moment.timeLabel }}</span>
                  </div>
                  <span>{{ moment.detail }}</span>
                </div>
                <div class="review-moment-metrics">
                  <span v-if="moment.sourceKind === 'browser'" class="review-moment-tag browser">
                    {{ moment.tone === 'browser-audio' ? 'Browser audio' : 'Browser' }}
                  </span>
                  <span class="review-moment-tag" :class="moment.tone">{{ moment.metricPrimary }}</span>
                  <span class="review-moment-tag muted">{{ moment.metricSecondary }}</span>
                  <span class="review-moment-link">
                    View in Analytics
                    <ArrowUpRightIcon size="13" />
                  </span>
                </div>
              </button>
              <div v-if="!reviewMoments.length" class="activity-empty">No meaningful moments were recorded for this block.</div>
            </div>
          </article>

          <article v-if="reviewDetailMode === 'evidence'" class="surface review-browser">
            <div class="review-apps-head">
              <span class="surface-label">Browser evidence</span>
              <span class="wave-meta">{{ reviewBrowserEvents.length ? `${reviewBrowserEvents.length} saved events` : 'No browser evidence saved' }}</span>
            </div>

            <div class="signal-grid review-trust-grid review-trust-grid-metrics">
              <div v-for="card in reviewBrowserMetricCards" :key="card.label" class="signal-tile review-trust-tile review-trust-tile-metric">
                <span class="review-trust-label">{{ card.label }}</span>
                <strong class="review-trust-value">{{ card.value }}</strong>
                <small>{{ card.note }}</small>
              </div>
            </div>

            <div class="review-browser-context-grid">
              <div v-for="card in reviewBrowserContextCards" :key="card.label" class="signal-tile review-trust-tile review-trust-tile-context">
                <span class="review-trust-label">{{ card.label }}</span>
                <strong class="review-trust-value">{{ card.value }}</strong>
                <small>{{ card.note }}</small>
              </div>
            </div>

            <div class="signal-tile review-trust-tile review-trust-lead-page">
              <div class="review-lead-page-head">
                <span class="review-trust-label">{{ reviewBrowserLeadPageCard.label }}</span>
                <span v-if="reviewBrowserLeadPageCard.laneLabel" class="app-state-pill neutral">{{ reviewBrowserLeadPageCard.laneLabel }}</span>
              </div>
              <strong class="review-lead-page-title" :title="reviewBrowserLeadPageCard.value">{{ reviewBrowserLeadPageCard.value }}</strong>
              <small>{{ reviewBrowserLeadPageCard.note }}</small>
            </div>

            <div v-if="reviewRecentBrowserEvents.length" class="review-browser-list">
              <button
                v-for="entry in reviewRecentBrowserEvents"
                :key="entry.id || `${entry.eventType}-${entry.ts}`"
                class="review-browser-row"
                type="button"
                @click="openReviewMomentInAnalytics({
                  analyticsTarget: {
                    tab: 'apps',
                    eventId: entry.audible ? `browser-audio-${getCompletedAnalyticsDateKey()}` : `browser-switches-${getCompletedAnalyticsDateKey()}`,
                  },
                })"
              >
                <div class="review-browser-copy">
                  <strong>{{ entry.pageTitle || entry.host || entry.browserApp || 'Browser signal' }}</strong>
                  <span>{{ entry.browserApp || 'Browser' }} - {{ entry.host || 'No host' }}</span>
                </div>
                <div class="review-browser-meta">
                  <span class="review-moment-tag" :class="entry.audible ? 'warn' : 'steady'">{{ entry.audible ? 'Audible' : entry.eventType || 'Event' }}</span>
                  <small>{{ formatTime(entry.ts || 0) }}</small>
                </div>
              </button>
            </div>
            <div v-else class="activity-empty">No browser switches, opened tabs, or audible events were saved during this block.</div>
          </article>

          <article v-if="reviewDetailMode === 'evidence'" class="surface review-apps">
            <div class="review-apps-head">
              <span class="surface-label">Tracked apps</span>
              <span class="wave-meta">{{ reviewApps.length ? `${reviewApps.length} observed` : 'No tracked app data' }}</span>
            </div>

            <div class="review-app-list">
              <div v-for="app in reviewAppBars" :key="`${app.appName || app.app}-${app.seconds}`" class="review-app-row">
                <div class="review-app-copy">
                  <div class="review-app-headline">
                    <strong>{{ app.appName || app.app }}</strong>
                    <div class="review-app-tags">
                      <span class="app-state-pill" :class="app.stateTone">{{ app.stateLabel }}</span>
                      <span class="app-meta-pill">{{ app.categoryLabel }}</span>
                    </div>
                  </div>
                  <span>{{ formatAppTime(app.seconds || 0) }}</span>
                </div>
                <div class="review-app-bar">
                  <div class="review-app-fill" :style="{ width: `${app.share}%`, background: `linear-gradient(135deg, ${app.color || '#0ea5e9'}, color-mix(in srgb, ${app.color || '#14b8a6'} 74%, #ffffff 26%))` }"></div>
                </div>
              </div>
              <div v-if="!reviewApps.length" class="app-chip muted">No app data captured</div>
            </div>
          </article>

          <article v-if="reviewDetailMode === 'deep'" class="surface review-drivers">
            <div class="review-apps-head">
              <span class="surface-label">Fatigue drivers</span>
              <span class="wave-meta">{{ reviewLeadDriver ? `${reviewLeadDriver.label} led the load` : 'No strain signal recorded' }}</span>
            </div>

            <div class="review-driver-list">
              <div v-for="driver in reviewFatigueDrivers" :key="driver.key" class="review-driver-row">
                <div class="review-driver-head">
                  <strong>{{ driver.label }}</strong>
                  <span>{{ driver.value }}</span>
                </div>
                <div class="review-driver-bar">
                  <div class="review-driver-fill" :class="driver.tone" :style="{ width: `${driver.width}%` }"></div>
                </div>
                <small>{{ driver.note }}</small>
              </div>
            </div>
          </article>

          <article v-if="reviewDetailMode === 'deep'" class="surface review-signals">
            <div class="review-apps-head">
              <span class="surface-label">Session reads</span>
              <span class="wave-meta">The four live signals behind the final score</span>
            </div>

            <div class="signal-grid">
              <div v-for="signal in reviewSignalTiles" :key="signal.label" class="signal-tile">
                <div class="signal-head">
                  <span>{{ signal.label }}</span>
                  <strong>{{ signal.value }}</strong>
                </div>
                <div class="signal-meter">
                  <div class="signal-fill" :class="signal.tone" :style="{ width: `${signal.value}%` }"></div>
                </div>
                <small>{{ signal.note }}</small>
              </div>
            </div>
          </article>

          <article v-if="reviewDetailMode === 'deep'" class="surface review-timeline">
            <div class="review-apps-head">
              <span class="surface-label">Session timeline</span>
              <span class="wave-meta">{{ reviewTimelineRows.length ? `${reviewTimelineRows.length} measured slices` : 'No slices' }}</span>
            </div>

            <div class="review-timeline-canvas">
              <div class="review-timeline-grid">
                <span>Start</span>
                <span>Midpoint</span>
                <span>Finish</span>
              </div>
              <div class="review-timeline-track">
                <div
                  v-for="slice in reviewTimelineTrack"
                  :key="slice.id || slice.t"
                  class="review-timeline-bar"
                  :class="slice.tone"
                  :style="{
                    left: `${slice.left}%`,
                    width: `${slice.width}%`,
                    height: `${slice.height}px`,
                    background: slice.fill,
                  }"
                  :title="slice.titleText"
                ></div>
                <button
                  v-for="marker in reviewTimelineMarkers"
                  :key="marker.key"
                  class="review-event-marker"
                  :class="marker.tone"
                  type="button"
                  :style="{ left: `${marker.left}%` }"
                  @click="openReviewMomentInAnalytics(marker)"
                  :title="`${marker.title} - ${marker.timeLabel}`"
                >
                  <span></span>
                </button>
              </div>
            </div>

            <div class="review-checkpoint-grid">
              <div v-for="point in reviewTimelineCheckpoints" :key="point.label" class="review-checkpoint-card">
                <span class="surface-label">{{ point.label }}</span>
                <strong>{{ point.app }}</strong>
                <div class="review-checkpoint-meta">
                  <span>{{ point.timeLabel }}</span>
                  <span :class="point.tone">F {{ point.focusScore }}</span>
                  <span>T {{ point.fatigueScore }}</span>
                </div>
              </div>
            </div>
            <div v-if="!reviewTimelineRows.length" class="activity-empty">No timeline slices recorded.</div>
          </article>
        </div>

        <footer class="control-bar review-actions">
          <button class="secondary-btn" @click="openCompletedSessionInAnalytics('focus')">
            <BarChart3Icon class="icon" />
            Analytics
          </button>
          <button class="primary-cta alt" @click="saveAndLeave">
            <SaveIcon class="icon" />
            Save review
          </button>
          <button class="secondary-btn" @click="runAnother">
            <RotateCcwIcon class="icon" />
            Save and run again
          </button>
          <button class="secondary-btn warn" @click="deleteReview">
            <Trash2Icon class="icon" />
            Discard
          </button>
        </footer>
      </div>
    </section>

    <div v-if="customSheetOpen" class="sheet-backdrop" @click="customSheetOpen = false">
      <div class="sheet-card" @click.stop>
        <div class="sheet-head">
          <span class="eyebrow">Custom duration</span>
          <button class="clear-btn sheet-close" @click="customSheetOpen = false">
            <XIcon class="icon" />
          </button>
        </div>
        <div class="sheet-preview-card" :class="{ active: customNoLimit }">
          <span class="surface-label">Selected</span>
          <strong>{{ customDurationPreview }}</strong>
        </div>
        <div class="sheet-picker-grid">
          <div class="picker-card" :class="{ muted: customNoLimit }">
            <span class="picker-label">Hours</span>
            <div class="picker-stepper">
              <button class="stepper-btn" @click="adjustCustomHours(-1)" :disabled="customNoLimit">-</button>
              <input
                v-model.number="customHours"
                class="picker-input"
                type="number"
                min="0"
                max="12"
                :disabled="customNoLimit"
                @blur="normalizeCustomInputs"
              />
              <button class="stepper-btn" @click="adjustCustomHours(1)" :disabled="customNoLimit">+</button>
            </div>
          </div>
          <div class="picker-card" :class="{ muted: customNoLimit }">
            <span class="picker-label">Minutes</span>
            <div class="picker-stepper">
              <button class="stepper-btn" @click="adjustCustomMinutes(-5)" :disabled="customNoLimit">-</button>
              <input
                v-model.number="customMinutes"
                class="picker-input"
                type="number"
                min="0"
                max="59"
                :disabled="customNoLimit"
                @blur="normalizeCustomInputs"
              />
              <button class="stepper-btn" @click="adjustCustomMinutes(5)" :disabled="customNoLimit">+</button>
            </div>
          </div>
        </div>
        <div class="sheet-helper-row">
          <span class="sheet-helper">Pick any duration up to 12h 59m, or run without a limit.</span>
          <button class="sheet-toggle" :class="{ active: customNoLimit }" @click="useNoLimit">
            No limit
          </button>
        </div>
        <div class="sheet-actions">
          <button class="secondary-btn" @click="customSheetOpen = false">Cancel</button>
          <button class="primary-cta sheet-apply" :disabled="customApplyDisabled" @click="applyCustomSelection">
            Use {{ customDurationPreview }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.focus-v2 {
  --focus-ink: var(--text-main);
  --focus-muted: var(--text-muted);
  --focus-line: var(--surface-outline);
  --focus-line-strong: var(--surface-outline-strong);
  --focus-panel: color-mix(in srgb, var(--bg-card) 88%, transparent);
  --focus-panel-strong: color-mix(in srgb, var(--bg-card) 96%, transparent);
  --focus-panel-soft: var(--surface-muted);
  --focus-panel-solid: color-mix(in srgb, var(--bg-card) 98%, transparent);
  --focus-accent: #0ea5e9;
  --focus-accent-soft: rgba(14, 165, 233, 0.14);
  --focus-teal: #14b8a6;
  --focus-warm: #f97316;
  --focus-red: #ef4444;
  position: relative;
  min-height: calc(100vh - 64px);
  padding: 20px 24px;
  overflow: auto;
  color: var(--focus-ink);
  background:
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.12), transparent 28%),
    radial-gradient(circle at bottom left, rgba(20, 184, 166, 0.09), transparent 24%),
    var(--bg-app);
}

.focus-v2,
.focus-v2 * {
  box-sizing: border-box;
}

:global(.dark-theme .focus-v2){
  --focus-panel: rgba(18, 25, 35, 0.84);
  --focus-panel-strong: rgba(18, 25, 35, 0.94);
  --focus-panel-soft: rgba(255, 255, 255, 0.04);
  --focus-panel-solid: rgba(18, 25, 35, 0.98);
}

.focus-glow {
  position: absolute;
  border-radius: 999px;
  filter: blur(56px);
  pointer-events: none;
  opacity: 0.72;
}

.focus-glow-a {
  top: -120px;
  right: 5%;
  width: 320px;
  height: 320px;
  background: rgba(14, 165, 233, 0.18);
}

.focus-glow-b {
  left: -80px;
  bottom: -80px;
  width: 280px;
  height: 280px;
  background: rgba(20, 184, 166, 0.16);
}

.setup-state,
.live-state,
.review-state {
  position: relative;
  z-index: 1;
}

.setup-state {
  min-height: calc(100vh - 120px);
  display: grid;
  place-items: center;
  padding-block: 18px 32px;
}

.live-state {
  width: min(1320px, 100%);
  min-height: calc(100vh - 104px);
  margin: 0 auto;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 14px;
  align-content: start;
}

.review-state {
  min-height: calc(100vh - 104px);
  display: grid;
  place-items: start center;
  padding-block: 8px 28px;
}

.setup-card,
.review-card {
  max-width: 100%;
  min-width: 0;
  padding: 36px 38px;
  border-radius: 32px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-strong);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(20px);
}

.setup-card {
  width: min(1120px, 100%);
}

.review-card {
  width: min(1280px, 100%);
}

.setup-head,
.review-head,
.wave-head,
.context-head,
.setup-footer,
.sheet-head,
.live-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow,
.surface-label,
.attach-label {
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.eyebrow,
.surface-label,
.attach-label,
.setup-pill,
.live-pill,
.context-state {
  color: var(--focus-accent);
}

.setup-pill,
.live-pill,
.context-state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--focus-accent) 18%, transparent);
  background: var(--focus-panel-soft);
  font-size: 0.8rem;
  font-weight: 700;
}

.live-pill.paused,
.live-pill.warn {
  color: var(--focus-warm);
  border-color: rgba(249, 115, 22, 0.22);
}

.live-pill.tracking,
.live-pill.good {
  color: #0f766e;
  border-color: rgba(20, 184, 166, 0.22);
}

.live-pill.background {
  color: var(--focus-muted);
  border-color: rgba(17, 24, 39, 0.12);
}

.live-pill.waiting {
  color: var(--focus-accent);
}

.setup-copy,
.review-head {
  margin-top: 14px;
}

.review-head {
  margin-top: 0;
  align-items: flex-start;
}

.review-title {
  display: grid;
  gap: 8px;
}

.review-title .eyebrow {
  display: block;
}

.setup-copy h1,
.live-head h1,
.review-head h1 {
  font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
  line-height: 0.96;
  letter-spacing: -0.06em;
}

.setup-copy h1 {
  font-size: clamp(2.25rem, 4vw, 3.55rem);
}

.live-head h1,
.review-head h1 {
  font-size: clamp(1.8rem, 3vw, 2.55rem);
  margin: 0;
}

.setup-copy p,
.context-surface p,
.context-surface small {
  color: var(--focus-muted);
}

.setup-copy p {
  margin-top: 10px;
  font-size: 1.04rem;
}

.field-label {
  display: block;
  margin: 22px 0 10px;
  font-size: 0.84rem;
  font-weight: 700;
  color: var(--focus-muted);
}

.goal-input,
.attach-search {
  width: 100%;
  border: 1px solid var(--focus-line);
  border-radius: 20px;
  background: var(--focus-panel-soft);
  color: var(--focus-ink);
  font: inherit;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}

.goal-input {
  padding: 18px 20px;
  font-size: 1.02rem;
}

.goal-input:focus,
.attach-search:focus {
  border-color: rgba(14, 165, 233, 0.36);
  box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.08);
  background: var(--focus-panel-solid);
}

.duration-row,
.metric-row,
.review-stats,
.sheet-grid,
.app-chip-row {
  display: grid;
  gap: 12px;
}

.duration-row {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.duration-chip,
.sheet-chip,
.attach-field,
.primary-cta,
.secondary-btn,
.danger-btn,
.clear-btn {
  appearance: none;
  border: none;
  font: inherit;
}

.duration-chip,
.sheet-chip {
  min-height: 56px;
  border-radius: 20px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  color: var(--focus-ink);
  font-size: 0.98rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.duration-chip.active,
.sheet-chip.active {
  border-color: var(--focus-line-strong);
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.16), rgba(20, 184, 166, 0.08));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bg-card) 40%, transparent), 0 12px 24px rgba(14, 165, 233, 0.08);
}

.duration-chip:hover,
.sheet-chip:hover,
.attach-field:hover,
.primary-cta:hover,
.secondary-btn:hover,
.danger-btn:hover {
  transform: translateY(-1px);
}

.attach-row {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.attach-stack {
  position: relative;
}

.attach-field {
  width: 100%;
  min-height: 64px;
  padding: 14px 16px;
  border-radius: 22px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  color: var(--focus-ink);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.habit-attach-field.linked {
  border-color: color-mix(in srgb, var(--habit-accent) 42%, var(--focus-line));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--habit-accent) 9%, transparent), transparent 58%),
    var(--focus-panel-soft);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--habit-accent) 12%, transparent),
    0 14px 28px color-mix(in srgb, var(--habit-accent) 10%, transparent);
}

.habit-attach-field.linked .attach-label {
  color: var(--habit-accent);
}

.attach-copy {
  display: grid;
  gap: 3px;
  text-align: left;
}

.attach-copy strong {
  font-size: 0.98rem;
  font-weight: 700;
}

.attach-copy span:last-child {
  color: var(--focus-muted);
  font-size: 0.92rem;
}

.attach-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.clear-btn {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--focus-panel-soft);
  color: var(--focus-muted);
  cursor: pointer;
}

.attach-popover,
.sheet-card {
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-strong);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(18px);
}

.attach-popover {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  z-index: 4;
  padding: 14px;
  border-radius: 24px;
}

.attach-search {
  min-height: 46px;
  padding: 0 14px;
}

.attach-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  max-height: 280px;
  overflow: auto;
}

.attach-option {
  min-height: 56px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  color: var(--focus-ink);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}

.attach-option strong {
  display: block;
  font-size: 0.94rem;
}

.attach-option span,
.attach-empty,
.toggle-row span,
.setup-mini span,
.wave-meta,
.app-chip.muted {
  color: var(--focus-muted);
}

.attach-empty {
  padding: 12px 6px 2px;
  font-size: 0.92rem;
}

.toggle-row {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
  font-size: 0.94rem;
}

.toggle-row input {
  accent-color: var(--focus-accent);
}

.workflow-grid {
  display: grid;
  gap: 12px;
  margin-top: 18px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.workflow-card {
  padding: 16px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.workflow-card.focus {
  border-color: rgba(14, 165, 233, 0.18);
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.12), rgba(14, 165, 233, 0.04));
}

.workflow-card.habit,
.workflow-card.steady {
  border-color: rgba(20, 184, 166, 0.18);
  background: linear-gradient(180deg, rgba(20, 184, 166, 0.12), rgba(20, 184, 166, 0.04));
}

.workflow-card.good {
  border-color: rgba(82, 183, 136, 0.2);
  background: linear-gradient(180deg, rgba(82, 183, 136, 0.12), rgba(82, 183, 136, 0.04));
}

.workflow-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.workflow-copy strong {
  font-size: 1rem;
  letter-spacing: -0.02em;
}

.workflow-copy p,
.workflow-copy small {
  margin: 0;
  color: var(--focus-muted);
  line-height: 1.45;
}

.workflow-copy small {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.workflow-action-btn {
  flex: 0 0 auto;
  min-height: 44px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-solid);
  color: var(--focus-ink);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.workflow-action-btn:hover {
  transform: translateY(-1px);
  border-color: var(--focus-line-strong);
}

.tracking-block-card {
  margin-top: 18px;
  padding: 18px;
  border-radius: 26px;
  border: 1px solid rgba(249, 115, 22, 0.2);
  background:
    linear-gradient(135deg, rgba(249, 115, 22, 0.1), rgba(14, 165, 233, 0.06)),
    var(--focus-panel-soft);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
}

.tracking-block-icon {
  width: 52px;
  height: 52px;
  border-radius: 20px;
  display: grid;
  place-items: center;
  color: var(--focus-warm);
  background: rgba(249, 115, 22, 0.12);
  box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.18);
}

.tracking-block-icon .icon {
  width: 22px;
  height: 22px;
}

.tracking-block-copy {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.tracking-block-copy h2 {
  margin: 0;
  font-size: 1.18rem;
  line-height: 1.12;
  letter-spacing: -0.04em;
}

.tracking-block-copy p {
  margin: 0;
  color: var(--focus-muted);
  line-height: 1.45;
}

.tracking-block-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.tracking-block-list span {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--focus-line);
  background: color-mix(in srgb, var(--bg-card) 70%, transparent);
  color: var(--focus-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 700;
}

.tracking-block-list .icon {
  width: 13px;
  height: 13px;
  color: #0f766e;
}

.tracking-block-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.setup-footer {
  margin-top: 34px;
}

.setup-actions {
  display: grid;
  justify-items: end;
  gap: 10px;
}

.setup-warning {
  max-width: 320px;
  margin: 0;
  color: var(--focus-red);
  font-size: 0.88rem;
  line-height: 1.5;
  text-align: right;
}

.setup-mini {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--focus-panel-soft);
  border: 1px solid var(--focus-line);
}

.primary-cta,
.secondary-btn,
.danger-btn {
  min-height: 54px;
  padding: 0 20px;
  border-radius: 20px;
  font-size: 0.96rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.primary-cta {
  background: linear-gradient(135deg, var(--focus-accent), var(--focus-teal));
  color: white;
  box-shadow: 0 22px 34px rgba(14, 165, 233, 0.18);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.primary-cta.alt {
  min-width: 180px;
}

.primary-cta.compact,
.secondary-btn.compact {
  min-height: 44px;
  padding: 0 16px;
  border-radius: 16px;
  font-size: 0.9rem;
}

.secondary-btn {
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  color: var(--focus-ink);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.secondary-btn.warn {
  color: var(--focus-red);
}

.danger-btn {
  background: linear-gradient(135deg, #fb7185, #f97316);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.live-head {
  margin-bottom: 0;
}

.surface {
  min-width: 0;
  border-radius: 30px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(16px);
}

.live-overview,
.context-surface,
.wave-surface,
.mini-stat,
.review-apps {
  padding: 20px 22px;
}

.live-heading {
  display: grid;
  gap: 6px;
}

.live-overview {
  display: grid;
  gap: 14px;
  grid-template-columns: minmax(240px, 0.82fr) minmax(360px, 1.18fr);
}

.timer-cluster,
.score-tile,
.review-apps,
.review-card {
  display: grid;
}

.timer-cluster {
  gap: 8px;
}

.timer-cluster strong,
.score-tile strong,
.mini-stat strong {
  font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
  font-size: clamp(1.95rem, 3.8vw, 3.1rem);
  line-height: 0.92;
  letter-spacing: -0.08em;
}

.score-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.score-tile {
  gap: 8px;
  min-height: 124px;
  padding: 18px 20px;
  border-radius: 24px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
}

.score-tile.good strong {
  color: #0f766e;
}

.score-tile.warn strong,
.score-tile.fatigue strong {
  color: #c2410c;
}

.live-body {
  display: grid;
  grid-template-columns: minmax(360px, 0.94fr) minmax(520px, 1.06fr);
  gap: 18px;
  min-height: 0;
}

.context-surface {
  display: grid;
  gap: 8px;
  align-content: start;
}

.context-head strong {
  display: block;
  margin-top: 8px;
  font-size: 1.24rem;
  letter-spacing: -0.03em;
}

.context-surface p {
  font-size: 0.96rem;
  line-height: 1.4;
}

.context-surface small {
  font-size: 0.88rem;
}

.metric-row {
  grid-template-columns: repeat(auto-fit, minmax(106px, 1fr));
  margin-top: 10px;
  gap: 10px;
}

.metric-pill {
  min-height: 72px;
  padding: 12px 14px;
  border-radius: 20px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: grid;
  gap: 4px;
}

.metric-pill.active {
  border-color: rgba(20, 184, 166, 0.16);
  background: rgba(20, 184, 166, 0.08);
}

.metric-pill.warn {
  border-color: rgba(249, 115, 22, 0.16);
  background: rgba(249, 115, 22, 0.08);
}

.metric-pill.steady {
  border-color: rgba(14, 165, 233, 0.16);
  background: rgba(14, 165, 233, 0.08);
}

.metric-pill span {
  font-size: 0.76rem;
  color: var(--focus-muted);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.metric-pill strong {
  font-size: 1.02rem;
  letter-spacing: -0.03em;
}

.activity-list-shell {
  display: grid;
  gap: 10px;
  margin-top: 2px;
}

.activity-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.activity-list {
  display: grid;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
  padding-right: 2px;
}

.activity-item {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
}

.activity-main {
  display: grid;
  gap: 2px;
}

.activity-main strong {
  font-size: 0.94rem;
  letter-spacing: -0.02em;
}

.activity-main span,
.activity-meta,
.activity-empty {
  color: var(--focus-muted);
}

.activity-main span {
  font-size: 0.86rem;
  line-height: 1.3;
}

.activity-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.activity-empty {
  min-height: 88px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px dashed var(--focus-line);
  background: var(--focus-panel-soft);
  display: flex;
  align-items: center;
  font-size: 0.9rem;
  line-height: 1.4;
}

.wave-surface {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.wave-frame {
  position: relative;
  margin-top: 12px;
  min-height: 156px;
  border-radius: 24px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background:
    linear-gradient(180deg, rgba(14, 165, 233, 0.06), color-mix(in srgb, var(--bg-card) 72%, transparent)),
    radial-gradient(circle at top, color-mix(in srgb, var(--bg-card) 44%, transparent), transparent 48%);
}

.wave-frame::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--bg-card) 24%, transparent), transparent);
  transform: translateX(-100%);
  animation: shimmer 8s linear infinite;
}

.wave-svg {
  width: 100%;
  height: 156px;
}

.wave-empty {
  display: grid;
  gap: 6px;
  padding: 0 20px;
  text-align: left;
}

.wave-empty strong {
  font-size: 0.98rem;
  letter-spacing: -0.03em;
}

.wave-empty span {
  color: var(--focus-muted);
  font-size: 0.9rem;
}

.wave-motion {
  animation: driftWave 18s ease-in-out infinite alternate;
}

.wave-motion-soft {
  animation: driftWaveSoft 22s ease-in-out infinite alternate;
}

.wave-surface.paused .wave-motion,
.wave-surface.paused .wave-motion-soft,
.wave-surface.paused .wave-frame::after {
  animation-play-state: paused;
}

.control-bar {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 0;
}

.review-card {
  display: grid;
  gap: 16px;
}

.review-stats {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.review-mini-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.mini-stat strong {
  font-size: clamp(1.72rem, 2.6vw, 2.5rem);
}

.mini-stat {
  min-height: 104px;
  display: grid;
  gap: 12px;
  align-content: end;
}

.mini-stat.quiet {
  min-height: 72px;
  padding: 14px 16px;
  gap: 8px;
}

.mini-stat.compact strong {
  font-size: 1.08rem;
  line-height: 1;
}

.review-subtitle {
  margin: 8px 0 0;
  max-width: 680px;
  color: var(--focus-muted);
  font-size: 0.96rem;
  line-height: 1.5;
}

.review-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.review-chip {
  min-height: 52px;
  padding: 10px 14px;
  border-radius: 18px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: grid;
  gap: 4px;
  min-width: 132px;
}

.review-chip small,
.review-status-note,
.review-stat-note,
.review-checkpoint-meta span {
  color: var(--focus-muted);
}

.review-chip strong {
  font-size: 0.94rem;
  letter-spacing: -0.02em;
}

.review-chip.good {
  border-color: rgba(20, 184, 166, 0.18);
  background: linear-gradient(180deg, rgba(20, 184, 166, 0.12), rgba(20, 184, 166, 0.04));
}

.review-chip.warn {
  border-color: rgba(249, 115, 22, 0.18);
  background: linear-gradient(180deg, rgba(249, 115, 22, 0.12), rgba(249, 115, 22, 0.04));
}

.review-chip.steady {
  border-color: rgba(14, 165, 233, 0.18);
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.12), rgba(14, 165, 233, 0.04));
}

.review-status-stack {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.review-status-note {
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.review-decision-card {
  padding: 22px 24px;
  border-radius: 28px;
  border: 1px solid var(--focus-line);
  background:
    radial-gradient(circle at 96% 12%, rgba(14, 165, 233, 0.14), transparent 34%),
    var(--focus-panel);
  box-shadow: var(--shadow-elevation);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.34fr);
  gap: 18px;
  align-items: center;
  overflow: hidden;
}

.review-decision-card.good {
  border-color: rgba(20, 184, 166, 0.2);
}

.review-decision-card.warn {
  border-color: rgba(249, 115, 22, 0.24);
}

.review-decision-main {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.review-decision-main h2 {
  margin: 0;
  font-size: clamp(1.38rem, 2.2vw, 2rem);
  line-height: 1.02;
  letter-spacing: -0.055em;
}

.review-decision-main p {
  max-width: 780px;
  margin: 0;
  color: var(--focus-muted);
  line-height: 1.55;
}

.review-decision-next {
  min-height: 96px;
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: grid;
  align-content: center;
  gap: 8px;
}

.review-decision-next span {
  color: var(--focus-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.review-decision-next strong {
  line-height: 1.28;
  letter-spacing: -0.02em;
}

.review-stat-card {
  position: relative;
  overflow: hidden;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-card) 68%, transparent), transparent),
    var(--focus-panel);
}

.review-stat-card::after {
  content: '';
  position: absolute;
  inset: auto -10% -48% auto;
  width: 150px;
  height: 150px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.12), transparent 66%);
  pointer-events: none;
}

.review-stat-card.good strong {
  color: #0f766e;
}

.review-stat-card.warn strong {
  color: #c2410c;
}

.review-stat-card.steady strong {
  color: #0369a1;
}

.review-stat-note {
  display: block;
  font-size: 0.76rem;
  line-height: 1.35;
}

.review-mode-switch {
  padding: 6px;
  border-radius: 24px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.review-mode-switch button {
  min-height: 58px;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  color: var(--focus-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.review-mode-switch button:hover {
  transform: translateY(-1px);
  color: var(--focus-ink);
}

.review-mode-switch button.active {
  border-color: rgba(14, 165, 233, 0.22);
  background: color-mix(in srgb, var(--bg-card) 82%, transparent);
  color: var(--focus-ink);
  box-shadow: 0 12px 24px rgba(14, 165, 233, 0.08);
}

.review-mode-switch strong,
.review-mode-switch span {
  display: block;
}

.review-mode-switch strong {
  font-size: 0.92rem;
}

.review-mode-switch span {
  margin-top: 3px;
  font-size: 0.78rem;
  color: var(--focus-muted);
}

.review-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}

.review-grid > .surface {
  grid-area: auto;
}

.review-browser,
.review-signals,
.review-timeline {
  grid-column: 1 / -1;
}

.review-mix,
.review-apps,
.review-moments,
.review-drivers {
  gap: 12px;
}

.review-mix,
.review-moments,
.review-apps,
.review-drivers,
.review-browser,
.review-signals,
.review-timeline {
  padding: 20px 22px;
}

.review-mix {
  grid-area: mix;
}

.review-signals {
  grid-area: signals;
}

.review-apps {
  grid-area: apps;
  min-height: 0;
}

.review-moments {
  grid-area: moments;
  min-height: 0;
}

.review-drivers {
  grid-area: drivers;
  min-height: 0;
}

.review-timeline {
  grid-area: timeline;
  min-height: 0;
}

.review-grid > .surface {
  grid-area: auto;
}

.review-browser,
.review-signals,
.review-timeline {
  grid-column: 1 / -1;
}

.review-apps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}

.mix-layout {
  display: grid;
  grid-template-columns: 144px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
}

.mix-detail {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.mix-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mix-detail-label {
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mix-detail-label.productive {
  color: #0f766e;
}

.mix-detail-label.support {
  color: #0284c7;
}

.mix-detail-label.unclear {
  color: #64748b;
}

.mix-detail-label.distracting {
  color: #ea580c;
}

.mix-detail-head strong {
  font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
  font-size: 1.42rem;
  line-height: 1;
  letter-spacing: -0.04em;
}

.mix-detail p,
.mix-detail-time {
  color: var(--focus-muted);
}

.mix-detail p {
  margin: 0;
  font-size: 0.94rem;
  line-height: 1.5;
}

.mix-detail-time {
  font-size: 0.82rem;
  font-weight: 700;
}

.mix-ring {
  width: 144px;
  height: 144px;
  border-radius: 999px;
  padding: 12px;
  display: grid;
  place-items: center;
}

.mix-core {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--focus-panel-solid);
  display: grid;
  place-items: center;
  text-align: center;
  box-shadow: inset 0 0 0 1px var(--focus-line);
}

.mix-core strong {
  font-family: 'Segoe UI Variable Display', 'Segoe UI', sans-serif;
  font-size: 1.92rem;
  line-height: 0.92;
  letter-spacing: -0.06em;
}

.mix-core span {
  color: var(--focus-muted);
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.mix-segment-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 2px;
}

.review-app-list,
.review-moment-list,
.review-driver-list,
.review-browser-list {
  display: grid;
  gap: 10px;
  overflow: auto;
  padding-right: 4px;
}

.review-app-list {
  max-height: 334px;
}

.review-moment-list,
.review-driver-list,
.review-browser-list {
  max-height: 320px;
}

.mix-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  flex-shrink: 0;
}

.mix-segment-chip {
  appearance: none;
  width: 100%;
  padding: 12px 13px;
  border-radius: 16px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.mix-segment-chip:hover,
.mix-segment-chip.active {
  transform: translateY(-1px);
  border-color: var(--focus-line-strong);
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
}

.mix-segment-chip.productive.active {
  background: linear-gradient(180deg, rgba(20, 184, 166, 0.12), rgba(20, 184, 166, 0.05));
}

.mix-segment-chip.support.active {
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.12), rgba(14, 165, 233, 0.05));
}

.mix-segment-chip.unclear.active {
  background: linear-gradient(180deg, rgba(148, 163, 184, 0.13), rgba(148, 163, 184, 0.04));
}

.mix-segment-chip.distracting.active {
  background: linear-gradient(180deg, rgba(249, 115, 22, 0.13), rgba(249, 115, 22, 0.04));
}

.mix-segment-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.mix-segment-copy strong,
.review-app-copy strong,
.timeline-review-copy strong {
  font-size: 0.92rem;
  letter-spacing: -0.02em;
}

.mix-segment-copy small,
.review-app-copy span,
.timeline-review-copy span,
.timeline-review-metrics span {
  color: var(--focus-muted);
  font-size: 0.82rem;
}

.review-app-row,
.timeline-review-row {
  padding: 11px 13px;
  border-radius: 16px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
}

.review-app-copy,
.timeline-review-copy {
  display: grid;
  gap: 4px;
}

.review-app-headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.review-app-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.app-state-pill,
.app-meta-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.app-state-pill.productive {
  color: #0f766e;
  background: rgba(20, 184, 166, 0.12);
}

.app-state-pill.supporting {
  color: #2563eb;
  background: rgba(59, 130, 246, 0.12);
}

.app-state-pill.distracting {
  color: #c2410c;
  background: rgba(249, 115, 22, 0.12);
}

.app-state-pill.neutral {
  color: #64748b;
  background: rgba(148, 163, 184, 0.14);
}

.app-meta-pill {
  color: var(--focus-muted);
  background: rgba(148, 163, 184, 0.1);
}

.review-app-row {
  display: grid;
  gap: 8px;
}

.review-app-bar {
  height: 8px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.06);
  overflow: hidden;
}

.review-app-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--focus-accent), var(--focus-teal));
}

.signal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

.signal-tile {
  padding: 13px 14px;
  border-radius: 16px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: grid;
  gap: 6px;
}

.signal-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.signal-head span,
.signal-tile small {
  color: var(--focus-muted);
}

.signal-head span {
  font-size: 0.8rem;
  font-weight: 700;
}

.signal-head strong {
  font-size: 1.18rem;
  line-height: 1;
  letter-spacing: -0.04em;
}

.signal-tile small {
  font-size: 0.74rem;
  line-height: 1.35;
}

.signal-meter {
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  overflow: hidden;
}

.signal-fill,
.review-driver-fill {
  height: 100%;
  border-radius: 999px;
}

.signal-fill.good {
  background: linear-gradient(135deg, rgba(20, 184, 166, 0.88), rgba(45, 212, 191, 0.7));
}

.signal-fill.steady {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.88), rgba(96, 165, 250, 0.68));
}

.signal-fill.warn {
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.88), rgba(251, 113, 133, 0.7));
}

.review-moment-row,
.review-driver-row,
.review-checkpoint-card,
.review-browser-row {
  padding: 13px 14px;
  border-radius: 18px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
}

.review-moment-row {
  display: grid;
  gap: 10px;
  width: 100%;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.review-browser-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  font-family: inherit;
  text-align: left;
  color: inherit;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.review-moment-row.linked:hover,
.review-moment-row.linked:focus-visible,
.review-browser-row:hover,
.review-browser-row:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(14, 165, 233, 0.24);
  box-shadow: 0 14px 24px rgba(14, 165, 233, 0.08);
}

.review-browser-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.review-browser-copy strong {
  font-size: 0.98rem;
}

.review-browser-copy span {
  color: var(--focus-muted);
  font-size: 0.84rem;
  line-height: 1.35;
}

.review-browser-meta {
  display: grid;
  justify-items: end;
  gap: 6px;
  color: var(--focus-muted);
  font-size: 0.8rem;
}

.review-trust-grid {
  margin-top: 6px;
}

.review-trust-grid-metrics {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.review-browser-context-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.review-trust-tile {
  min-height: 94px;
}

.review-trust-tile-metric,
.review-trust-tile-context,
.review-trust-lead-page {
  align-content: start;
}

.review-trust-label {
  color: var(--focus-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.review-trust-value {
  font-size: 1.52rem;
  line-height: 1.02;
  letter-spacing: -0.05em;
  word-break: break-word;
}

.review-trust-tile-metric .review-trust-value {
  font-size: 1.74rem;
}

.review-trust-tile-context .review-trust-value {
  font-size: 1.18rem;
  line-height: 1.12;
}

.review-trust-lead-page {
  margin-top: 10px;
  gap: 10px;
}

.review-lead-page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.review-lead-page-title {
  font-size: 1.34rem;
  line-height: 1.08;
  letter-spacing: -0.04em;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

.review-trust-lead-page small {
  font-size: 0.82rem;
}

.review-moment-main {
  display: grid;
  gap: 4px;
}

.review-moment-main > span {
  color: var(--focus-muted);
  font-size: 0.86rem;
  line-height: 1.4;
}

.review-moment-head,
.review-driver-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.review-moment-head strong,
.review-driver-head strong,
.review-checkpoint-card strong {
  font-size: 0.96rem;
  letter-spacing: -0.02em;
}

.review-moment-head span,
.review-driver-head span {
  color: var(--focus-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.review-moment-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--focus-accent);
}

.review-moment-metrics,
.review-checkpoint-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.review-moment-tag {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 700;
  background: rgba(14, 165, 233, 0.1);
  color: #0369a1;
}

.review-moment-tag.focus {
  background: rgba(20, 184, 166, 0.12);
  color: #0f766e;
}

.review-moment-tag.warn,
.review-moment-tag.fatigue {
  background: rgba(249, 115, 22, 0.12);
  color: #c2410c;
}

.review-moment-tag.steady {
  background: rgba(14, 165, 233, 0.12);
  color: #0369a1;
}

.review-moment-tag.browser {
  background: rgba(59, 130, 246, 0.1);
  color: #1d4ed8;
}

.review-moment-tag.browser-audio {
  background: rgba(249, 115, 22, 0.12);
  color: #9a3412;
}

.review-moment-tag.neutral,
.review-moment-tag.muted {
  background: rgba(148, 163, 184, 0.12);
  color: #64748b;
}

.review-driver-row {
  display: grid;
  gap: 8px;
}

.review-driver-bar {
  height: 9px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  overflow: hidden;
}

.review-driver-fill.duration {
  background: linear-gradient(135deg, rgba(14, 165, 233, 0.92), rgba(45, 212, 191, 0.72));
}

.review-driver-fill.switch {
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.92), rgba(251, 113, 133, 0.72));
}

.review-driver-fill.decay {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.9), rgba(59, 130, 246, 0.7));
}

.review-driver-fill.idle {
  background: linear-gradient(135deg, rgba(148, 163, 184, 0.92), rgba(203, 213, 225, 0.72));
}

.review-driver-row small {
  color: var(--focus-muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.review-timeline-canvas {
  display: grid;
  gap: 12px;
}

.review-timeline-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  color: var(--focus-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.review-timeline-grid span:nth-child(2) {
  text-align: center;
}

.review-timeline-grid span:last-child {
  text-align: right;
}

.review-timeline-track {
  position: relative;
  min-height: 166px;
  padding: 18px 0 12px;
  border-radius: 22px;
  border: 1px solid var(--focus-line);
  background:
    linear-gradient(180deg, rgba(14, 165, 233, 0.04), rgba(14, 165, 233, 0)),
    var(--focus-panel-soft);
  overflow: hidden;
}

.review-timeline-track::before {
  content: '';
  position: absolute;
  inset: 18px 14px 20px;
  border-radius: 18px;
  background:
    linear-gradient(to right, rgba(148, 163, 184, 0.1) 0 1px, transparent 1px) 0 0 / calc(100% / 4) 100%,
    linear-gradient(to top, rgba(148, 163, 184, 0.08) 0 1px, transparent 1px) 0 100% / 100% calc(100% / 4);
  pointer-events: none;
}

.review-timeline-bar {
  position: absolute;
  bottom: 20px;
  border-radius: 14px 14px 6px 6px;
  box-shadow: 0 14px 22px rgba(15, 23, 42, 0.08);
  opacity: 0.98;
}

.review-timeline-bar.neutral {
  opacity: 0.86;
}

.review-event-marker {
  position: absolute;
  top: 16px;
  width: 14px;
  height: 14px;
  margin-left: -7px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.review-event-marker span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 18px rgba(15, 23, 42, 0.12);
}

.review-event-marker.focus span {
  background: #14b8a6;
}

.review-event-marker.steady span {
  background: #0ea5e9;
}

.review-event-marker.warn span,
.review-event-marker.fatigue span {
  background: #f97316;
}

.review-event-marker.neutral span {
  background: #94a3b8;
}

.review-checkpoint-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.review-checkpoint-card {
  display: grid;
  gap: 8px;
}

.review-checkpoint-meta .focus {
  color: #0f766e;
}

.review-checkpoint-meta .steady {
  color: #0369a1;
}

.review-checkpoint-meta .warn,
.review-checkpoint-meta .fatigue {
  color: #c2410c;
}

.app-chip {
  min-height: 48px;
  padding: 0 16px;
  border-radius: 18px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: flex;
  align-items: center;
  font-size: 0.94rem;
  font-weight: 600;
}

.review-actions {
  margin-top: 2px;
}

.sheet-backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(10px);
  z-index: 20;
}

.sheet-card {
  width: min(520px, 100%);
  padding: 24px;
  border-radius: 28px;
}

.sheet-close {
  flex: 0 0 auto;
}

.sheet-preview-card {
  margin-top: 12px;
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: grid;
  gap: 6px;
}

.sheet-preview-card.active {
  border-color: rgba(14, 165, 233, 0.34);
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.12), rgba(20, 184, 166, 0.06));
}

.sheet-preview-card strong {
  font-size: 1.8rem;
  line-height: 1;
  letter-spacing: -0.04em;
}

.sheet-picker-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.picker-card {
  padding: 16px;
  border-radius: 22px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-soft);
  display: grid;
  gap: 12px;
}

.picker-card.muted {
  opacity: 0.54;
}

.picker-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--focus-muted);
}

.picker-stepper {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 48px;
  gap: 10px;
  align-items: center;
}

.stepper-btn,
.sheet-toggle {
  min-height: 48px;
  border-radius: 18px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-solid);
  color: var(--focus-ink);
  font: inherit;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.stepper-btn:hover,
.sheet-toggle:hover {
  transform: translateY(-1px);
}

.stepper-btn:disabled,
.sheet-toggle:disabled,
.primary-cta:disabled {
  cursor: not-allowed;
  opacity: 0.5;
  transform: none;
}

.picker-input {
  width: 100%;
  min-height: 56px;
  border-radius: 18px;
  border: 1px solid var(--focus-line);
  background: var(--focus-panel-solid);
  color: var(--focus-ink);
  font: inherit;
  font-size: 1.2rem;
  font-weight: 700;
  text-align: center;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.picker-input:focus {
  border-color: rgba(14, 165, 233, 0.36);
  box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.08);
}

.picker-input::-webkit-outer-spin-button,
.picker-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.sheet-helper-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 14px;
}

.sheet-helper {
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--focus-muted);
}

.sheet-toggle {
  min-width: 128px;
  padding: 0 16px;
}

.sheet-toggle.active {
  border-color: rgba(14, 165, 233, 0.4);
  background: linear-gradient(180deg, rgba(14, 165, 233, 0.16), rgba(20, 184, 166, 0.08));
}

.sheet-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 18px;
}

.sheet-apply {
  min-width: 180px;
}

.icon {
  width: 16px;
  height: 16px;
}

@keyframes driftWave {
  0% { transform: translateX(-1.8%) translateY(0); }
  100% { transform: translateX(1.8%) translateY(-4px); }
}

@keyframes driftWaveSoft {
  0% { transform: translateX(1.2%) translateY(2px); }
  100% { transform: translateX(-1.4%) translateY(-2px); }
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

@media (max-width: 1100px) {
  .live-overview,
  .live-body,
  .attach-row,
  .workflow-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .review-grid {
    grid-template-columns: 1fr;
  }

  .review-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-decision-card {
    grid-template-columns: 1fr;
  }

  .review-mini-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .signal-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-trust-grid-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-browser-context-grid {
    grid-template-columns: 1fr;
  }

  .mix-segment-grid {
    grid-template-columns: 1fr;
  }

  .review-checkpoint-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .live-state {
    grid-template-rows: auto auto auto auto;
  }
}

@media (max-height: 760px) {
  .setup-state,
  .review-state {
    min-height: auto;
    place-items: start center;
    padding-block: 0 24px;
  }

  .setup-card,
  .review-card {
    padding: 28px;
  }

  .setup-copy h1 {
    font-size: clamp(2rem, 3.4vw, 3rem);
  }

  .field-label {
    margin-top: 16px;
  }

  .mini-stat {
    min-height: 88px;
  }
}

@media (max-width: 820px) {
  .focus-v2 {
    padding: 16px;
  }

  .setup-card,
  .review-card,
  .live-overview,
  .context-surface,
  .wave-surface {
    padding: 22px 20px;
  }

  .duration-row,
  .metric-row,
  .score-strip,
  .sheet-picker-grid,
  .mix-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-stats {
    grid-template-columns: 1fr;
  }

  .review-mini-stats,
  .signal-grid {
    grid-template-columns: 1fr;
  }

  .review-trust-grid-metrics,
  .review-browser-context-grid {
    grid-template-columns: 1fr;
  }

  .control-bar,
  .setup-footer,
  .live-head,
  .review-head,
  .review-apps-head,
  .tracking-block-card {
    flex-direction: column;
    align-items: stretch;
  }

  .tracking-block-card {
    display: grid;
    grid-template-columns: 1fr;
  }

  .tracking-block-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .review-mode-switch {
    grid-template-columns: 1fr;
  }

  .review-status-stack {
    justify-items: start;
  }

  .setup-actions {
    justify-items: stretch;
  }

  .setup-warning {
    max-width: none;
    text-align: left;
  }

  .review-grid {
    grid-template-columns: 1fr;
  }

  .mix-layout {
    grid-template-columns: 1fr;
  }

  .review-chip-row {
    flex-direction: column;
  }

  .review-checkpoint-grid {
    grid-template-columns: 1fr;
  }

  .review-app-headline {
    align-items: flex-start;
    flex-direction: column;
  }

  .review-app-tags {
    justify-content: flex-start;
  }

  .wave-frame,
  .wave-svg {
    min-height: 144px;
    height: 144px;
  }

  .sheet-helper-row,
  .sheet-actions {
    flex-direction: column;
    align-items: stretch;
  }
}

/* ─── DARK THEME OVERRIDES ─────────────────────────────────────────────────────
   FocusSession uses many dark-on-light semantic colors throughout the review
   state. These overrides provide bright equivalents suitable for dark backgrounds.
   Color mapping:
     #0f766e (dark teal)      → #2dd4bf (teal-400, bright)
     #c2410c (dark orange-red)→ #fb923c (orange-400, bright)
     #0369a1 (dark blue)      → #38bdf8 (sky-400, bright)
     #0284c7 (dark blue)      → #38bdf8 (sky-400, bright)
     #1d4ed8 (dark indigo)    → #60a5fa (blue-400, bright)
     #9a3412 (dark rust)      → #fb923c (orange-400, bright)
     #ea580c (dark orange)    → #fb923c (orange-400, bright)
     #2563eb (dark blue)      → #60a5fa (blue-400, bright)
     #64748b (dark slate)     → #94a3b8 (slate-400, lighter)
──────────────────────────────────────────────────────────────────────────────── */

/* Score tiles (live state) */
:global(.dark-theme .focus-v2 .score-tile.good strong){
  color: #2dd4bf !important;
}
:global(.dark-theme .focus-v2 .score-tile.warn strong),
:global(.dark-theme .focus-v2 .score-tile.fatigue strong){
  color: #fb923c !important;
}

/* Review stat cards */
:global(.dark-theme .focus-v2 .review-stat-card.good strong){
  color: #2dd4bf !important;
}
:global(.dark-theme .focus-v2 .review-stat-card.warn strong){
  color: #fb923c !important;
}
:global(.dark-theme .focus-v2 .review-stat-card.steady strong){
  color: #38bdf8 !important;
}

/* App state pills (review state) */
:global(.dark-theme .focus-v2 .app-state-pill.productive){
  color: #2dd4bf !important;
  background: rgba(45, 212, 191, 0.12) !important;
}
:global(.dark-theme .focus-v2 .app-state-pill.supporting){
  color: #60a5fa !important;
  background: rgba(96, 165, 250, 0.12) !important;
}
:global(.dark-theme .focus-v2 .app-state-pill.distracting){
  color: #fb923c !important;
  background: rgba(249, 115, 22, 0.12) !important;
}
:global(.dark-theme .focus-v2 .app-state-pill.neutral){
  color: #94a3b8 !important;
  background: rgba(148, 163, 184, 0.12) !important;
}

/* Mix detail labels */
:global(.dark-theme .focus-v2 .mix-detail-label.productive){
  color: #2dd4bf !important;
}
:global(.dark-theme .focus-v2 .mix-detail-label.support){
  color: #38bdf8 !important;
}
:global(.dark-theme .focus-v2 .mix-detail-label.unclear){
  color: #94a3b8 !important;
}
:global(.dark-theme .focus-v2 .mix-detail-label.distracting){
  color: #fb923c !important;
}

/* Review moment tags */
:global(.dark-theme .focus-v2 .review-moment-tag){
  color: #38bdf8 !important;
  background: rgba(56, 189, 248, 0.1) !important;
}
:global(.dark-theme .focus-v2 .review-moment-tag.focus){
  color: #2dd4bf !important;
  background: rgba(45, 212, 191, 0.12) !important;
}
:global(.dark-theme .focus-v2 .review-moment-tag.warn),
:global(.dark-theme .focus-v2 .review-moment-tag.fatigue){
  color: #fb923c !important;
  background: rgba(249, 115, 22, 0.12) !important;
}
:global(.dark-theme .focus-v2 .review-moment-tag.steady){
  color: #38bdf8 !important;
  background: rgba(56, 189, 248, 0.12) !important;
}
:global(.dark-theme .focus-v2 .review-moment-tag.browser){
  color: #60a5fa !important;
  background: rgba(96, 165, 250, 0.1) !important;
}
:global(.dark-theme .focus-v2 .review-moment-tag.browser-audio){
  color: #fb923c !important;
  background: rgba(249, 115, 22, 0.12) !important;
}
:global(.dark-theme .focus-v2 .review-moment-tag.neutral),
:global(.dark-theme .focus-v2 .review-moment-tag.muted){
  color: #94a3b8 !important;
  background: rgba(148, 163, 184, 0.12) !important;
}

/* Review checkpoint meta */
:global(.dark-theme .focus-v2 .review-checkpoint-meta .focus){
  color: #2dd4bf !important;
}
:global(.dark-theme .focus-v2 .review-checkpoint-meta .steady){
  color: #38bdf8 !important;
}
:global(.dark-theme .focus-v2 .review-checkpoint-meta .warn),
:global(.dark-theme .focus-v2 .review-checkpoint-meta .fatigue){
  color: #fb923c !important;
}

/* Review app bar track */
:global(.dark-theme .focus-v2 .review-app-bar){
  background: rgba(255, 255, 255, 0.06) !important;
}

/* Signal grid cards and review card backgrounds */
:global(.dark-theme .focus-v2 .review-card),
:global(.dark-theme .focus-v2 .setup-card){
  background: rgba(18, 25, 35, 0.94) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

/* Focus session headings */
:global(.dark-theme .focus-v2 h1),
:global(.dark-theme .focus-v2 h2),
:global(.dark-theme .focus-v2 h3),
:global(.dark-theme .focus-v2 h4){
  color: var(--text-main) !important;
}

/* Live state pills */
:global(.dark-theme .focus-v2 .live-pill.tracking),
:global(.dark-theme .focus-v2 .live-pill.good){
  color: #2dd4bf !important;
  border-color: rgba(45, 212, 191, 0.22) !important;
}

/* Tracking block list icon */
:global(.dark-theme .focus-v2 .tracking-block-list .icon){
  color: #2dd4bf !important;
}

/* Context surface context-head elements */
:global(.dark-theme .focus-v2 .context-chip.browser){
  color: #60a5fa !important;
  background: rgba(96, 165, 250, 0.1) !important;
}
:global(.dark-theme .focus-v2 .context-chip.task){
  color: #34d399 !important;
  background: rgba(52, 211, 153, 0.1) !important;
}
:global(.dark-theme .focus-v2 .context-chip.habit){
  color: #a78bfa !important;
  background: rgba(167, 139, 250, 0.1) !important;
}
</style>
