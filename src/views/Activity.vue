<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useVelanceStore } from '../store/velance.js'
import { useAmbientTracker, CATEGORY_COLORS, getCustomRules, removeCustomRule, setCustomRule } from '../composables/useAmbientTracker.js'
import { buildActivityAxis, buildBackgroundTimelineSegments, buildFocusTimelineSegments, formatActivityDuration } from '../services/activityTimeline.js'
import { clampRangeAnchor, formatDateKeyLabel, getLocalDayRange, getTodayLocalDateKey, isFutureDateKey, shiftDateKey } from '../services/dateNavigation.js'
import { ACTIVITY_VIEW_SOURCES, buildSourceBadges } from '../services/analysisSources.js'
import { buildDailyAnalysisModel } from '../services/dailyAnalysisService.js'
import { buildBrowserEvidenceSummary } from '../services/browserEvidenceService.js'
import { getCategoryDefaultLane, getTrackingLaneMeta } from '../services/activityClassification.js'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  ClockIcon,
  MonitorIcon,
  RefreshCwIcon,
  SlidersIcon,
  TargetIcon,
  ZapIcon,
  XIcon,
} from 'lucide-vue-next'

const VueApexCharts = defineAsyncComponent(() =>
  import('vue3-apexcharts').then((module) => module.default)
)

const store = useVelanceStore()
const ambient = useAmbientTracker()
const emit = defineEmits(['update:selectedDateKey', 'activate-event'])
const props = defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
  selectedDateKey: {
    type: String,
    default: '',
  },
  highlightedEventId: {
    type: String,
    default: '',
  },
})

const todayKey = ref(getTodayLocalDateKey())
const internalSelectedDateKey = ref(props.selectedDateKey || todayKey.value)
const selectedDateKey = computed({
  get() {
    return props.selectedDateKey || internalSelectedDateKey.value
  },
  set(value) {
    internalSelectedDateKey.value = value || todayKey.value
    emit('update:selectedDateKey', internalSelectedDateKey.value)
  },
})
const isRefreshing = ref(false)
const hoveredSegment = ref(null)
const hoveredBucketIndex = ref(null)
const showRulePanel = ref(false)
const activityExplorerMode = ref('apps')
const activityExplorerSortMode = ref('seconds')
const activityExplorerQuery = ref('')
const activityExplorerLaneFilter = ref('all')
const ruleTarget = ref('')
const ruleCategory = ref('Development')
const ruleProductive = ref(true)

const customRules = computed(() => getCustomRules())
const categories = Object.keys(CATEGORY_COLORS).filter((category) => !['Unknown', 'Other'].includes(category))
const activityExplorerOptions = [
  { id: 'apps', label: 'Apps' },
  { id: 'sites', label: 'Sites' },
  { id: 'pages', label: 'Pages' },
]
const activityExplorerSortOptions = [
  { id: 'seconds', label: 'Top used' },
  { id: 'recent', label: 'Recent' },
  { id: 'switches', label: 'Most switches' },
]
const activityExplorerLaneOptions = [
  { id: 'all', label: 'All lanes' },
  { id: 'productive', label: 'Productive' },
  { id: 'supporting', label: 'Supporting' },
  { id: 'unclear', label: 'Unclear' },
  { id: 'distracting', label: 'Distracting' },
]
const RHYTHM_LANE_ORDER = ['productive', 'supporting', 'unclear', 'distracting']

function formatPercent(value = null) {
  if (value === null || value === undefined) return '--'
  return `${value}%`
}

function formatLaneLabel(lane = '') {
  return getTrackingLaneMeta(lane).label
}

function getDisplayLaneForEntry(entry = {}) {
  const storedLane = entry.lane === 'productive' || entry.lane === 'supporting' || entry.lane === 'unclear' || entry.lane === 'distracting'
    ? entry.lane
    : (entry.productive === true ? 'productive' : entry.productive === false ? 'distracting' : 'unclear')

  if (entry?.isCustom) return storedLane

  const categoryLane = getCategoryDefaultLane(entry.category, {
    productive: entry.productive,
    subcategory: entry.subcategory,
    contextLabel: entry.contextLabel,
    appName: entry.appGroup || entry.app || entry.sourceApp,
  })

  if (categoryLane === 'distracting') return 'distracting'
  if (categoryLane === 'supporting' && storedLane === 'productive') return 'supporting'
  return storedLane
}

function getProductivityTone(score = 0) {
  if (score >= 70) return 'good'
  if (score >= 45) return 'steady'
  return 'soft'
}

function createLaneTotals() {
  return {
    productive: 0,
    supporting: 0,
    unclear: 0,
    distracting: 0,
  }
}

function sumLaneTotals(totals = {}) {
  return RHYTHM_LANE_ORDER.reduce((sum, lane) => sum + Number(totals?.[lane] || 0), 0)
}

function addLaneTotals(target = createLaneTotals(), source = {}, multiplier = 1) {
  RHYTHM_LANE_ORDER.forEach((lane) => {
    target[lane] += Number(source?.[lane] || 0) * multiplier
  })
  return target
}

function getDominantLaneFromTotals(totals = {}) {
  return [...RHYTHM_LANE_ORDER]
    .sort((left, right) => Number(totals?.[right] || 0) - Number(totals?.[left] || 0))[0] || 'unclear'
}

function hasBrowserContext(entry = {}) {
  return Boolean(entry?.browserHost || entry?.browserPage || entry?.browserUrl)
}

function isBrowserMediaEntry(entry = {}) {
  const sourceApp = String(entry?.sourceApp || entry?.app || '').trim().toLowerCase()
  return /chrome|edge|firefox|safari|brave|opera|arc|vivaldi|chromium/.test(sourceApp)
}

function clipEntryToRange(entry = {}, startMs = 0, endMs = 0) {
  const safeStart = Number(startMs || 0)
  const safeEnd = Math.max(safeStart, Number(endMs || safeStart))
  const entryStart = Number(entry?.ts || 0)
  const entryEnd = Math.max(entryStart, Number(entry?.endTs || (entryStart + (Number(entry?.duration || 0) * 1000))))
  const overlapStart = Math.max(safeStart, entryStart)
  const overlapEnd = Math.min(safeEnd, entryEnd)
  if (overlapEnd <= overlapStart) return null

  return {
    ...entry,
    ts: overlapStart,
    endTs: overlapEnd,
    duration: (overlapEnd - overlapStart) / 1000,
  }
}

function formatClock(timestamp = 0) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(timestamp)).toLowerCase()
}

function addEntryOverlapToBuckets(buckets = [], startMs = 0, endMs = 0, seconds = 0, assign) {
  const safeStart = Number(startMs || 0)
  const safeEnd = Math.max(safeStart, Number(endMs || safeStart))
  const totalSeconds = Math.max(0, Number(seconds || 0))
  if (!buckets.length || safeEnd <= safeStart || totalSeconds <= 0) return

  const totalMs = Math.max(1, safeEnd - safeStart)
  for (const bucket of buckets) {
    const overlapStart = Math.max(bucket.startMs, safeStart)
    const overlapEnd = Math.min(bucket.endMs, safeEnd)
    if (overlapEnd <= overlapStart) continue
    const ratio = (overlapEnd - overlapStart) / totalMs
    const overlapSeconds = totalSeconds * ratio
    assign(bucket, overlapSeconds, {
      overlapStart,
      overlapEnd,
    })
  }
}

function buildAxisForWindow(startMs = 0, endMs = 0, ticks = 5) {
  const safeStart = Number(startMs || 0)
  const safeEnd = Math.max(safeStart + 1, Number(endMs || safeStart + 1))
  const totalTicks = Math.max(2, Number(ticks || 5))
  const span = safeEnd - safeStart

  return Array.from({ length: totalTicks }, (_, index) => {
    const ratio = totalTicks === 1 ? 0 : index / (totalTicks - 1)
    const point = safeStart + (span * ratio)
    return {
      id: `window-axis-${safeStart}-${safeEnd}-${index}`,
      left: `${(ratio * 100).toFixed(3)}%`,
      label: formatClock(point),
    }
  })
}

function projectSegmentsToWindow(segments = [], windowRange = {}) {
  const startMs = Number(windowRange?.startMs || 0)
  const endMs = Math.max(startMs + 1, Number(windowRange?.endMs || startMs + 1))
  const span = endMs - startMs

  return [...segments]
    .map((segment) => {
      const boundedStart = Math.max(startMs, Number(segment.startTs || 0))
      const boundedEnd = Math.min(endMs, Number(segment.endTs || boundedStart))
      if (boundedEnd <= boundedStart) return null

      const left = ((boundedStart - startMs) / span) * 100
      const width = Math.max(((boundedEnd - boundedStart) / span) * 100, 1.2)

      return {
        ...segment,
        left: `${left.toFixed(3)}%`,
        width: `${Math.min(width, 100 - left).toFixed(3)}%`,
      }
    })
    .filter(Boolean)
}

async function refreshSelectedDate() {
  isRefreshing.value = true
  try {
    await ambient.refreshDate(selectedDateKey.value)
  } finally {
    isRefreshing.value = false
  }
}

function selectPreviousDay() {
  selectedDateKey.value = shiftDateKey(selectedDateKey.value, -1)
}

function selectNextDay() {
  if (!canMoveForward.value) return
  selectedDateKey.value = clampRangeAnchor(shiftDateKey(selectedDateKey.value, 1), todayKey.value)
}

function jumpToToday() {
  selectedDateKey.value = todayKey.value
}

async function saveRule() {
  if (!ruleTarget.value.trim()) return
  await setCustomRule(ruleTarget.value.trim(), {
    category: ruleCategory.value,
    productive: ruleProductive.value,
    color: CATEGORY_COLORS[ruleCategory.value] || '#8E95A3',
  })
  ruleTarget.value = ''
}

async function deleteRule(key) {
  await removeCustomRule(key)
}

onMounted(async () => {
  await ambient.attachListener()
  await refreshSelectedDate()
})

watch(
  () => selectedDateKey.value,
  (nextValue) => {
    if (!nextValue) {
      selectedDateKey.value = todayKey.value
      return
    }

    if (isFutureDateKey(nextValue, todayKey.value)) {
      selectedDateKey.value = todayKey.value
      return
    }

    hoveredSegment.value = null
    hoveredBucketIndex.value = null
    void refreshSelectedDate()
  },
)

const selectedDateLabel = computed(() => (
  selectedDateKey.value === todayKey.value
    ? `Today, ${formatDateKeyLabel(selectedDateKey.value, { weekday: 'long', month: 'short', day: 'numeric' })}`
    : formatDateKeyLabel(selectedDateKey.value)
))

const canMoveForward = computed(() => selectedDateKey.value < todayKey.value)
const isSelectedToday = computed(() => selectedDateKey.value === todayKey.value)

const backgroundEntries = computed(() => ambient.getEntriesForDate(selectedDateKey.value))
const mediaEntries = computed(() => ambient.getMediaForDate(selectedDateKey.value))
const browserEvents = computed(() => ambient.getBrowserEventsForDate(selectedDateKey.value))
const browserEventSummary = computed(() => ambient.getBrowserEventSummary(browserEvents.value))
const focusSessions = computed(() => [...store.sessions]
  .filter((session) => session.date === selectedDateKey.value)
  .sort((left, right) => (left.timestamp || left.createdAt || 0) - (right.timestamp || right.createdAt || 0)))

const backgroundTotalSeconds = computed(() => backgroundEntries.value.reduce((sum, entry) => sum + Number(entry.duration || 0), 0))
const focusTotalSeconds = computed(() => focusSessions.value.reduce((sum, session) => sum + Number(session.durationSeconds || 0), 0))
const productivityScore = computed(() => ambient.getProductivityScore(backgroundEntries.value))
const categoryBreakdown = computed(() => ambient.getCategoryBreakdown(backgroundEntries.value))
const appBreakdown = computed(() => ambient.getAppBreakdown(backgroundEntries.value, { sortBy: activityExplorerSortMode.value }))
const browserContexts = computed(() => ambient.getBrowserContextBreakdown(backgroundEntries.value, { groupBy: 'host', sortBy: activityExplorerSortMode.value }))
const browserPages = computed(() => ambient.getBrowserContextBreakdown(backgroundEntries.value, { groupBy: 'page', sortBy: activityExplorerSortMode.value }))
const diagnostics = computed(() => ambient.getTrackingDiagnostics(backgroundEntries.value))
const topApp = computed(() => appBreakdown.value[0] || null)
const topCategory = computed(() => categoryBreakdown.value[0] || null)
const productiveSeconds = computed(() => {
  const diagnosticSeconds = Number(diagnostics.value?.productiveSeconds || 0)
  if (diagnosticSeconds > 0) return diagnosticSeconds
  return categoryBreakdown.value
    .filter((category) => (category.lane || getCategoryDefaultLane(category.category)) === 'productive')
    .reduce((sum, category) => sum + Number(category.seconds || 0), 0)
})
const dailySignalLabel = computed(() => {
  if (productivityScore.value === null || productivityScore.value === undefined) return 'Waiting for signal'
  if (productivityScore.value >= 70) return 'Clean work signal'
  if (productivityScore.value >= 45) return 'Mixed but usable'
  return 'Needs correction'
})
const focusAverageScore = computed(() => (
  focusSessions.value.length
    ? Math.round(focusSessions.value.reduce((sum, session) => sum + Number(session.focusScore || 0), 0) / focusSessions.value.length)
    : null
))
const hasAnyActivity = computed(() => backgroundEntries.value.length > 0 || focusSessions.value.length > 0)
const activityExplorerRows = computed(() => {
  if (activityExplorerMode.value === 'sites') {
    return browserContexts.value.map((context) => ({
      key: `site-${context.label}`,
      label: context.label,
      category: context.category,
      lane: context.dominantLane,
      seconds: context.seconds,
      switches: context.switches,
      confidence: context.confidence,
      lastTs: context.lastTs,
      helper: `${context.app} - ${Math.round((context.confidence || 0) * 100)}% confidence`,
      color: context.color,
    }))
  }
  if (activityExplorerMode.value === 'pages') {
    return browserPages.value.map((context) => ({
      key: `page-${context.host}-${context.page}`,
      label: context.page,
      category: context.category,
      lane: context.dominantLane,
      seconds: context.seconds,
      switches: context.switches,
      confidence: context.confidence,
      lastTs: context.lastTs,
      helper: `${context.host} - ${context.app}`,
      color: context.color,
    }))
  }
  return appBreakdown.value.map((app) => ({
    key: `app-${app.app}`,
    label: app.app,
    category: app.category,
    lane: app.dominantLane,
    seconds: app.seconds,
    switches: app.switches,
    confidence: app.confidence,
    lastTs: app.lastTs,
    helper: app.contextLabel || app.subcategory || app.category,
    color: app.color,
  }))
})
const filteredActivityExplorerRows = computed(() => {
  const query = String(activityExplorerQuery.value || '').trim().toLowerCase()
  const laneFilter = String(activityExplorerLaneFilter.value || 'all')
  return activityExplorerRows.value.filter((row) => {
    const queryMatch = !query || [
      row.label,
      row.category,
      row.helper,
      row.lane,
    ].some((value) => String(value || '').toLowerCase().includes(query))
    const laneMatch = laneFilter === 'all' || String(row.lane || '') === laneFilter
    return queryMatch && laneMatch
  })
})
const activityExplorerMaxSeconds = computed(() => Math.max(...activityExplorerRows.value.map((row) => Number(row.seconds || 0)), 1))
const filteredActivityExplorerMaxSeconds = computed(() => Math.max(...filteredActivityExplorerRows.value.map((row) => Number(row.seconds || 0)), 1))

const backgroundSegments = computed(() => buildBackgroundTimelineSegments(backgroundEntries.value, { dateKey: selectedDateKey.value }))
const focusSegments = computed(() => buildFocusTimelineSegments(focusSessions.value, { dateKey: selectedDateKey.value }))
const timelineAxis = computed(() => buildActivityAxis(selectedDateKey.value))
const dayRange = computed(() => getLocalDayRange(selectedDateKey.value))
const combinedTimelineSegments = computed(() => (
  [...backgroundSegments.value, ...focusSegments.value]
    .sort((left, right) => (left.startTs || 0) - (right.startTs || 0))
))
const activeTimelineWindow = computed(() => {
  const segments = combinedTimelineSegments.value
  const day = dayRange.value
  if (!segments.length) {
    return {
      startMs: day.startMs,
      endMs: day.endMs,
    }
  }

  const firstStart = Math.min(...segments.map((segment) => Number(segment.startTs || day.startMs)))
  const lastEnd = Math.max(...segments.map((segment) => Number(segment.endTs || segment.startTs || day.endMs)))
  const padding = 18 * 60 * 1000
  const minimumSpan = 2 * 60 * 60 * 1000

  let startMs = Math.max(day.startMs, firstStart - padding)
  let endMs = Math.min(day.endMs, lastEnd + padding)

  if ((endMs - startMs) < minimumSpan) {
    const midpoint = startMs + ((endMs - startMs) / 2)
    startMs = Math.max(day.startMs, midpoint - (minimumSpan / 2))
    endMs = Math.min(day.endMs, midpoint + (minimumSpan / 2))
  }

  return { startMs, endMs }
})
const activeTimelineAxis = computed(() => buildAxisForWindow(activeTimelineWindow.value.startMs, activeTimelineWindow.value.endMs, 6))
const zoomedBackgroundSegments = computed(() => projectSegmentsToWindow(backgroundSegments.value, activeTimelineWindow.value))
const zoomedFocusSegments = computed(() => projectSegmentsToWindow(focusSegments.value, activeTimelineWindow.value))
const activeWindowLabel = computed(() => `${formatClock(activeTimelineWindow.value.startMs)} - ${formatClock(activeTimelineWindow.value.endMs)}`)
const dailyRhythmBuckets = computed(() => {
  const bucketCount = 24
  const range = dayRange.value
  const bucketSpanMs = Math.max(1, (range.endMs - range.startMs) / bucketCount)
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    id: `rhythm-bucket-${selectedDateKey.value}-${index}`,
    index,
    startMs: range.startMs + (bucketSpanMs * index),
    endMs: range.startMs + (bucketSpanMs * (index + 1)),
    trackedSeconds: 0,
    focusSeconds: 0,
    laneTotals: createLaneTotals(),
    nonBrowserLaneTotals: createLaneTotals(),
    appTotals: {},
    focusTitles: {},
    browserSeconds: 0,
    browserEntries: [],
    browserMediaEntries: [],
  }))

  backgroundEntries.value.forEach((entry) => {
    const lane = getDisplayLaneForEntry(entry)
    const label = entry.appGroup || entry.app || 'Tracked activity'
    const browserContext = hasBrowserContext(entry)
    addEntryOverlapToBuckets(
      buckets,
      Number(entry.ts || 0),
      Number(entry.endTs || (Number(entry.ts || 0) + (Number(entry.duration || 0) * 1000))),
      Number(entry.duration || 0),
      (bucket, overlapSeconds, overlap) => {
        bucket.trackedSeconds += overlapSeconds
        bucket.appTotals[label] = (bucket.appTotals[label] || 0) + overlapSeconds
        if (browserContext) {
          bucket.browserSeconds += overlapSeconds
          const clippedEntry = clipEntryToRange(entry, overlap.overlapStart, overlap.overlapEnd)
          if (clippedEntry) bucket.browserEntries.push(clippedEntry)
          return
        }
        bucket.nonBrowserLaneTotals[lane] += overlapSeconds
      },
    )
  })

  mediaEntries.value
    .filter((entry) => isBrowserMediaEntry(entry))
    .forEach((entry) => {
      addEntryOverlapToBuckets(
        buckets,
        Number(entry.ts || 0),
        Number(entry.endTs || (Number(entry.ts || 0) + (Number(entry.duration || 0) * 1000))),
        Number(entry.duration || 0),
        (bucket, _overlapSeconds, overlap) => {
          const clippedEntry = clipEntryToRange(entry, overlap.overlapStart, overlap.overlapEnd)
          if (clippedEntry) bucket.browserMediaEntries.push(clippedEntry)
        },
      )
    })

  focusSessions.value.forEach((session) => {
    const startMs = Number(session.timestamp || session.createdAt || 0)
    const endMs = startMs + (Number(session.durationSeconds || 0) * 1000)
    const title = session.goal || session.taskTitle || session.habit || session.focusQuality || 'Focus block'
    addEntryOverlapToBuckets(
      buckets,
      startMs,
      endMs,
      Number(session.durationSeconds || 0),
      (bucket, overlapSeconds) => {
        bucket.focusSeconds += overlapSeconds
        bucket.focusTitles[title] = (bucket.focusTitles[title] || 0) + overlapSeconds
      },
    )
  })

  return buckets.map((bucket) => {
    const bucketBrowserEvents = browserEvents.value.filter((event) => {
      const ts = Number(event?.ts || 0)
      const isLastBucket = bucket.index === bucketCount - 1
      return ts >= bucket.startMs && (isLastBucket ? ts <= bucket.endMs : ts < bucket.endMs)
    })
    const browserEvidence = bucket.browserSeconds > 0 || bucketBrowserEvents.length
      ? buildBrowserEvidenceSummary({
        ambientEntries: bucket.browserEntries,
        browserEvents: bucketBrowserEvents,
        startTs: bucket.startMs,
        endTs: bucket.endMs,
        padMs: 0,
        limit: 3,
      })
      : null
    const laneTotals = {
      ...bucket.nonBrowserLaneTotals,
    }
    if (bucket.browserSeconds > 0) {
      const browserMediaLaneTotals = bucket.browserMediaEntries.reduce((totals, entry) => {
        totals[getDisplayLaneForEntry(entry)] += Number(entry.duration || 0)
        return totals
      }, createLaneTotals())
      const browserSignalTotals = browserEvidence?.laneTotals || createLaneTotals()
      const blendedBrowserLaneTotals = createLaneTotals()
      addLaneTotals(blendedBrowserLaneTotals, browserSignalTotals, 1)
      addLaneTotals(blendedBrowserLaneTotals, browserMediaLaneTotals, 0.9)
      const browserSignalWeight = sumLaneTotals(blendedBrowserLaneTotals)
      if (browserSignalWeight > 0) {
        RHYTHM_LANE_ORDER.forEach((lane) => {
          laneTotals[lane] += bucket.browserSeconds * (Number(blendedBrowserLaneTotals[lane] || 0) / browserSignalWeight)
        })
      } else {
        bucket.browserEntries.forEach((entry) => {
          laneTotals[getDisplayLaneForEntry(entry)] += Number(entry.duration || 0)
        })
      }
    }

    const activeRatio = Math.max(0, Math.min(1, bucket.trackedSeconds / (bucketSpanMs / 1000)))
    const focusRatio = Math.max(0, Math.min(1, bucket.focusSeconds / (bucketSpanMs / 1000)))
    const heightPct = bucket.trackedSeconds > 0 ? 18 + (activeRatio * 82) : 8
    const dominantLane = getDominantLaneFromTotals(laneTotals)
    const topAppEntry = Object.entries(bucket.appTotals)
      .sort((left, right) => right[1] - left[1])[0]
    const topFocusEntry = Object.entries(bucket.focusTitles)
      .sort((left, right) => right[1] - left[1])[0]
    const totalTracked = Math.max(1, sumLaneTotals(laneTotals))
    const stack = {
      productive: (laneTotals.productive / totalTracked) * 100,
      supporting: (laneTotals.supporting / totalTracked) * 100,
      unclear: (laneTotals.unclear / totalTracked) * 100,
      distracting: (laneTotals.distracting / totalTracked) * 100,
    }
    const browserContextLabel = browserEvidence?.activePage?.label
      || browserEvidence?.leadPage?.label
      || browserEvidence?.activeSite?.label
      || browserEvidence?.leadSite?.label
      || ''
    const primaryContext = browserContextLabel || topAppEntry?.[0] || 'No tracked app'

    return {
      ...bucket,
      activeRatio,
      focusRatio,
      heightPct,
      browserEvidence,
      laneTotals,
      stack,
      dominantLane,
      topApp: primaryContext,
      topContextKind: browserContextLabel ? 'browser' : 'app',
      topFocusTitle: topFocusEntry?.[0] || 'No focus block',
      bucketLabel: formatClock(bucket.startMs),
      bucketRangeLabel: `${formatClock(bucket.startMs)} - ${formatClock(bucket.endMs)}`,
      isActive: bucket.trackedSeconds > 0 || bucket.focusSeconds > 0,
    }
  })
})
const dailyRhythmAxis = computed(() => dailyRhythmBuckets.value
  .filter((bucket) => bucket.index % 4 === 0 || bucket.index === dailyRhythmBuckets.value.length - 1)
  .map((bucket) => ({
    id: `${bucket.id}-axis`,
    left: `${(((bucket.index + 0.5) / dailyRhythmBuckets.value.length) * 100).toFixed(3)}%`,
    label: formatClock(bucket.startMs),
  })))
const activeRhythmBucket = computed(() => {
  if (hoveredBucketIndex.value !== null) {
    return dailyRhythmBuckets.value.find((bucket) => bucket.index === hoveredBucketIndex.value) || null
  }
  return dailyRhythmBuckets.value.find((bucket) => bucket.isActive) || dailyRhythmBuckets.value[0] || null
})

const activityNarrative = computed(() => {
  if (!hasAnyActivity.value) {
    return isSelectedToday.value
      ? 'Velance is ready to capture this day. As background tracking and focus blocks land, this view will turn into your clean daily activity picture.'
      : 'Nothing was tracked on this date yet. Move through earlier or later days with the arrows, or return to today to keep building your activity history.'
  }

  const parts = []
  if (topApp.value?.app) parts.push(`${topApp.value.app} led the visible work context`)
  if (productiveSeconds.value) parts.push(`${formatActivityDuration(productiveSeconds.value)} landed in productive lanes`)
  if (focusSessions.value.length) parts.push(`${focusSessions.value.length} focus block${focusSessions.value.length === 1 ? '' : 's'} added ${formatActivityDuration(focusTotalSeconds.value)}`)
  if (browserEventSummary.value.totalEvents) parts.push(`browser pressure sat at ${browserEventSummary.value.pressureScore || 0}/100`)
  return parts.join(' ')
})

const heroStats = computed(() => ([
  { label: 'Background tracked', value: backgroundTotalSeconds.value ? formatActivityDuration(backgroundTotalSeconds.value) : '-', tone: 'cyan', icon: MonitorIcon },
  { label: 'Focus time', value: focusTotalSeconds.value ? formatActivityDuration(focusTotalSeconds.value) : '-', tone: 'teal', icon: TargetIcon },
  { label: 'Focus sessions', value: String(focusSessions.value.length), tone: 'ink', icon: ClockIcon },
  { label: 'Productive share', value: formatPercent(productivityScore.value), tone: getProductivityTone(productivityScore.value || 0), icon: ZapIcon },
  {
    label: 'Browser pressure',
    value: browserEventSummary.value.totalEvents ? `${browserEventSummary.value.pressureScore || 0}/100` : 'Quiet',
    tone: (browserEventSummary.value.distractingShare || 0) >= 0.45
      ? 'soft'
      : (browserEventSummary.value.productiveShare || 0) >= 0.35
        ? 'good'
        : 'steady',
    icon: MonitorIcon,
  },
]))

const dailyStoryStats = computed(() => ([
  { label: 'Productive time', value: productiveSeconds.value ? formatActivityDuration(productiveSeconds.value) : '--', tone: getProductivityTone(productivityScore.value || 0), icon: ZapIcon },
  { label: 'Focus blocks', value: String(focusSessions.value.length), tone: 'teal', icon: TargetIcon },
  {
    label: 'Browser pressure',
    value: browserEventSummary.value.totalEvents ? `${browserEventSummary.value.pressureScore || 0}/100` : 'Quiet',
    tone: (browserEventSummary.value.distractingShare || 0) >= 0.45
      ? 'soft'
      : (browserEventSummary.value.productiveShare || 0) >= 0.35
        ? 'good'
        : 'steady',
    icon: MonitorIcon,
  },
]))

const timelineDetail = computed(() => {
  if (hoveredSegment.value) return hoveredSegment.value
  if (focusSegments.value[0]) return { ...focusSegments.value[0], helper: 'Hover any block to inspect the day in more detail.' }
  if (backgroundSegments.value[0]) return { ...backgroundSegments.value[0], helper: 'Hover any block to inspect the day in more detail.' }
  return null
})

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

const meaningfulEvents = computed(() => dailyAnalysisModel.value.topEvents || [])
const activeMeaningfulEvent = computed(() => (
  dailyAnalysisModel.value.events?.find((event) => event.id === props.highlightedEventId)
  || meaningfulEvents.value[0]
  || null
))

const backgroundEvidenceCards = computed(() => ([
  {
    label: 'Evidence quality',
    value: diagnostics.value.avgConfidence ? `${Math.round(diagnostics.value.avgConfidence * 100)}%` : '-',
    note: `${diagnostics.value.chunkCount || 0} measured chunks`,
  },
  {
    label: 'Coverage',
    value: diagnostics.value.firstTs && diagnostics.value.lastTs ? `${formatClock(diagnostics.value.firstTs)} - ${formatClock(diagnostics.value.lastTs)}` : '-',
    note: `${diagnostics.value.uniqueApps || 0} unique apps captured`,
  },
  {
    label: 'Browser signals',
    value: String(browserEventSummary.value.totalEvents || 0),
    note: `${browserEventSummary.value.tabSwitches || 0} switches - ${browserEventSummary.value.tabsOpened || 0} opened`,
  },
  {
    label: 'Audible tabs',
    value: String(browserEventSummary.value.audibleMoments || 0),
    note: browserEventSummary.value.latestAudible?.host || 'No browser audio captured',
  },
  {
    label: 'Rule matches',
    value: String(diagnostics.value.customRuleChunks || 0),
    note: `${diagnostics.value.browserChunks || 0} browser chunks matched`,
  },
  {
    label: 'Top host',
    value: browserPages.value[0]?.host || 'None',
    note: browserPages.value[0] ? formatActivityDuration(browserPages.value[0].seconds) : 'No browser page context yet',
  },
]))

const activityBrowserSignalCards = computed(() => ([
  {
    label: 'Browser pressure',
    value: browserEventSummary.value.totalEvents ? `${browserEventSummary.value.pressureScore || 0}/100` : 'Quiet',
    note: browserEventSummary.value.dominantPressureLabel || 'Quiet browser context',
  },
  {
    label: 'Browser lane',
    value: formatLaneLabel(browserEventSummary.value.dominantLane || 'unclear'),
    note: `${Math.round((browserEventSummary.value.distractingShare || 0) * 100)}% distracting - ${Math.round((browserEventSummary.value.supportingShare || 0) * 100)}% supporting`,
  },
  {
    label: 'Switches vs tabs',
    value: `${browserEventSummary.value.tabSwitches || 0} / ${browserEventSummary.value.tabsOpened || 0}`,
    note: 'Switches versus new tabs created from the extension stream',
  },
  {
    label: 'Audible overlap',
    value: String(browserEventSummary.value.audibleMoments || 0),
    note: browserEventSummary.value.latestAudible?.host || 'No browser audio captured',
  },
]))
const topBrowserPages = computed(() => browserPages.value.slice(0, 4))
const trustStripCards = computed(() => backgroundEvidenceCards.value.slice(0, 4))
const diagnosticsCards = computed(() => backgroundEvidenceCards.value.slice(4))

function getLinkedFocusEvent(session) {
  if (!session?.id) return null
  return dailyAnalysisModel.value.events?.find((event) => event.id === `focus-end-${session.id}`)
    || dailyAnalysisModel.value.events?.find((event) => event.id === `focus-start-${session.id}`)
    || null
}

function activateMeaningfulEvent(event) {
  if (!event) return
  emit('activate-event', event)
}

function activateFocusSession(session) {
  const event = getLinkedFocusEvent(session)
  if (event) {
    activateMeaningfulEvent(event)
    return
  }

  activateMeaningfulEvent({
    id: `focus-end-${session.id}`,
    linkedTab: 'focus',
    timestamp: session.timestamp || session.createdAt || 0,
    title: session.title || session.goal || session.taskTitle || 'Focus session',
    detail: session.context || session.primaryContext || 'Measured focus block',
    tone: session.tone || 'focus',
    timeLabel: formatClock(session.timestamp || session.createdAt || 0),
    markerLabel: 'End',
  })
}

const timelineEventMarkers = computed(() => {
  const buckets = dailyRhythmBuckets.value
  const startMs = Number(dayRange.value.startMs || 0)
  const endMs = Math.max(startMs + 1, Number(dayRange.value.endMs || startMs + 1))
  const span = endMs - startMs
  const occupiedLevels = []

  return [...(dailyAnalysisModel.value.events || [])]
    .filter((event) => Number(event.timestamp || 0) >= startMs && Number(event.timestamp || 0) <= endMs)
    .sort((left, right) => Number(left.timestamp || 0) - Number(right.timestamp || 0))
    .map((event) => {
      const timestamp = Number(event.timestamp || 0)
      const bucketIndex = buckets.findIndex((bucket, index) => {
        const isLast = index === buckets.length - 1
        return timestamp >= bucket.startMs && (isLast ? timestamp <= bucket.endMs : timestamp < bucket.endMs)
      })
      const rawRatio = Math.max(0, Math.min(1, (timestamp - startMs) / span))
      const ratio = rawRatio
      let level = 0
      while (level < 4 && occupiedLevels[level] !== undefined && Math.abs(ratio - occupiedLevels[level]) < 0.045) {
        level += 1
      }
      occupiedLevels[Math.min(level, 3)] = ratio

      return {
        ...event,
        left: `${(ratio * 100).toFixed(3)}%`,
        level: Math.min(level, 3),
        markerTone: event.sourceKind === 'browser'
          ? (event.type === 'browser-audio' ? 'browser-audio' : 'browser')
          : event.sourceKind === 'task'
            ? 'task'
            : event.sourceKind === 'habit'
              ? 'habit'
          : (event.tone || 'neutral'),
        markerText: event.markerLabel || event.title,
      }
    })
})

const activeRhythmMarkers = computed(() => {
  const bucket = activeRhythmBucket.value
  if (!bucket) return []
  return timelineEventMarkers.value
    .filter((event) => Number(event.timestamp || 0) >= bucket.startMs && Number(event.timestamp || 0) <= bucket.endMs)
    .slice(0, 6)
})

const activitySourceBadges = computed(() => buildSourceBadges(ACTIVITY_VIEW_SOURCES.ids))


const LANE_COLORS = {
  productive: '#14B8A6',
  supporting: '#7C3AED',
  unclear: '#F97316',
  distracting: '#FB7185',
}

const rhythmChartSeries = computed(() => [
  { name: 'Productive', data: dailyRhythmBuckets.value.map((b) => [b.startMs, Math.round(b.laneTotals.productive)]) },
  { name: 'Supporting', data: dailyRhythmBuckets.value.map((b) => [b.startMs, Math.round(b.laneTotals.supporting)]) },
  { name: 'Unclear', data: dailyRhythmBuckets.value.map((b) => [b.startMs, Math.round(b.laneTotals.unclear)]) },
  { name: 'Distracting', data: dailyRhythmBuckets.value.map((b) => [b.startMs, Math.round(b.laneTotals.distracting)]) },
])

function buildRhythmTooltip({ dataPointIndex }) {
  const bucket = dailyRhythmBuckets.value[dataPointIndex]
  if (!bucket) return '<div></div>'
  const appLine = bucket.topContextKind === 'browser'
    ? `<span class="rtt-app browser">&#127760; ${bucket.topApp}</span>`
    : `<span class="rtt-app">${bucket.topApp}</span>`
  const lanes = [
    { key: 'productive', label: 'Productive', color: LANE_COLORS.productive },
    { key: 'supporting', label: 'Supporting', color: LANE_COLORS.supporting },
    { key: 'unclear', label: 'Unclear', color: LANE_COLORS.unclear },
    { key: 'distracting', label: 'Distracting', color: LANE_COLORS.distracting },
  ]
  const laneRows = lanes
    .filter((l) => bucket.laneTotals[l.key] > 0)
    .map((l) => `<div class="rtt-lane"><span class="rtt-dot" style="background:${l.color}"></span><span>${l.label}</span><strong>${formatActivityDuration(bucket.laneTotals[l.key])}</strong></div>`)
    .join('')
  return `<div class="rhythm-apex-tooltip">
    <div class="rtt-time">${bucket.bucketRangeLabel}</div>
    ${appLine}
    <div class="rtt-lanes">${laneRows || '<span class="rtt-empty">No tracked activity</span>'}</div>
  </div>`
}

const rhythmChartOptions = computed(() => ({
  chart: {
    type: 'area',
    stacked: true,
    height: 280,
    toolbar: {
      show: true,
      tools: { zoom: true, zoomin: true, zoomout: true, pan: true, reset: true, download: false },
      autoSelected: 'zoom',
    },
    zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
    animations: { enabled: true, speed: 400, easing: 'easeinout' },
    events: {
      dataPointMouseEnter: (_e, _ctx, opts) => {
        hoveredBucketIndex.value = opts.dataPointIndex
      },
      click: (_e, _ctx, opts) => {
        if (opts.dataPointIndex >= 0) hoveredBucketIndex.value = opts.dataPointIndex
      },
    },
  },
  colors: [LANE_COLORS.productive, LANE_COLORS.supporting, LANE_COLORS.unclear, LANE_COLORS.distracting],
  fill: {
    type: 'gradient',
    gradient: {
      shadeIntensity: 0.18,
      opacityFrom: 0.82,
      opacityTo: 0.38,
      stops: [0, 100],
    },
  },
  stroke: { curve: 'smooth', width: [2.5, 2.5, 2.5, 2.5] },
  dataLabels: { enabled: false },
  xaxis: {
    type: 'datetime',
    labels: {
      datetimeUTC: false,
      datetimeFormatter: { hour: 'h:mm tt' },
      style: { fontSize: '11px', fontFamily: 'inherit', fontWeight: 600, colors: 'var(--text-muted)' },
    },
    axisBorder: { show: false },
    axisTicks: { show: false },
    crosshairs: { show: true, stroke: { color: 'rgba(148,163,184,0.4)', width: 1 } },
    tooltip: { enabled: false },
  },
  yaxis: {
    labels: {
      formatter: (val) => val > 0 ? formatActivityDuration(val) : '',
      style: { fontSize: '10px', fontFamily: 'inherit', colors: 'var(--text-muted)' },
    },
  },
  grid: {
    borderColor: 'rgba(148, 163, 184, 0.1)',
    xaxis: { lines: { show: false } },
    yaxis: { lines: { show: true } },
    padding: { left: 4, right: 4, top: 0, bottom: 0 },
  },
  tooltip: {
    shared: true,
    custom: buildRhythmTooltip,
  },
  legend: { show: false },
}))
</script>

<template>
  <div class="activity-page" :class="{ embedded: props.embedded }">
    <header v-if="props.showHeader" class="activity-header" :class="{ embedded: props.embedded }">
      <div v-if="!props.embedded" class="header-copy">
        <span class="header-kicker">Daily activity</span>
        <h1 class="page-title">Activity</h1>
        <p class="page-subtitle">One selected day, with background tracking and focus sessions aligned in the same view.</p>
      </div>
      <div v-else class="header-copy embedded-copy">
        <span class="header-kicker">Daily analysis</span>
        <p class="page-subtitle">One selected day with background activity and focus sessions aligned together.</p>
      </div>

      <div class="header-actions">
        <div class="date-nav">
          <button class="date-icon-btn" @click="selectPreviousDay" aria-label="Previous day">
            <ArrowLeftIcon size="16" />
          </button>
          <div class="date-pill">
            <CalendarIcon size="14" />
            <span>{{ selectedDateLabel }}</span>
          </div>
          <input v-model="selectedDateKey" class="date-input" type="date" :max="todayKey" />
          <button class="date-icon-btn" :disabled="!canMoveForward" @click="selectNextDay" aria-label="Next day">
            <ArrowRightIcon size="16" />
          </button>
        </div>

        <button class="secondary-btn" :disabled="isSelectedToday" @click="jumpToToday">Today</button>
        <button class="secondary-btn" :disabled="isRefreshing" @click="refreshSelectedDate">
          <RefreshCwIcon size="14" />
          {{ isRefreshing ? 'Refreshing...' : 'Refresh' }}
        </button>
        <button class="secondary-btn" @click="showRulePanel = true">
          <SlidersIcon size="14" />
          Classify Rules
        </button>
      </div>
    </header>

    <section class="hero-card">
      <div class="hero-copy">
        <span class="hero-label">{{ isSelectedToday ? 'Daily story' : 'Selected day' }}</span>
        <h2 class="hero-title">{{ isSelectedToday ? "Today's work shape" : `How ${formatDateKeyLabel(selectedDateKey, { weekday: 'long' })} unfolded` }}</h2>
        <p class="hero-text">{{ activityNarrative }}</p>
        <div class="hero-story-meta">
          <strong>{{ dailySignalLabel }}</strong>
          <span>{{ backgroundTotalSeconds ? formatActivityDuration(backgroundTotalSeconds) : 'No background time yet' }}</span>
          <span>{{ topCategory?.category || 'No dominant category' }}</span>
        </div>
        <div class="source-badges compact">
          <span
            v-for="badge in activitySourceBadges"
            :key="badge.id"
            class="source-badge"
            :class="badge.tone"
            :title="badge.description"
          >
            {{ badge.label }}
          </span>
        </div>
      </div>

      <div class="hero-stats">
        <article v-for="stat in dailyStoryStats" :key="stat.label" class="hero-stat" :class="stat.tone">
          <component :is="stat.icon" size="15" class="hero-stat-icon" />
          <strong>{{ stat.value }}</strong>
          <span>{{ stat.label }}</span>
        </article>
      </div>
    </section>

    <section v-if="meaningfulEvents.length" class="panel events-panel">
      <div class="panel-head">
        <div>
          <h2>Meaningful moments</h2>
          <p>Click a moment to jump into the linked daily analysis tab with the right evidence already selected.</p>
        </div>
        <div class="panel-badges">
          <span class="panel-badge">{{ meaningfulEvents.length }} linked events</span>
        </div>
      </div>

      <div class="event-strip">
        <button
          v-for="event in meaningfulEvents"
          :key="event.id"
          class="event-card"
          :class="[event.tone, event.sourceKind, { active: activeMeaningfulEvent?.id === event.id }]"
          type="button"
          @click="activateMeaningfulEvent(event)"
        >
          <div class="event-meta-row">
            <span class="event-time">{{ event.timeLabel }}</span>
            <span v-if="event.sourceKind === 'browser'" class="event-origin browser">
              {{ event.type === 'browser-audio' ? 'Browser audio' : 'Browser' }}
            </span>
            <span v-else-if="event.sourceKind === 'task'" class="event-origin task">Task</span>
            <span v-else-if="event.sourceKind === 'habit'" class="event-origin habit">Habit</span>
          </div>
          <strong>{{ event.title }}</strong>
          <p>{{ event.detail }}</p>
          <span class="event-tab">{{ event.linkedTab }}</span>
        </button>
      </div>
    </section>

    <section v-if="!hasAnyActivity" class="panel empty-panel">
      <MonitorIcon size="40" />
      <h2>No tracked activity on this date</h2>
      <p>Velance keeps this page date-based now, so you can move across your history day by day. Use the arrows above to move through past days or return to today.</p>
    </section>

    <template v-else>
      <section class="panel timeline-panel">
        <div class="panel-head">
          <div>
            <h2>Daily rhythm rail</h2>
            <p>One clean read of the day: lane balance inside each hour, focus blocks on the rail, and evidence in the inspector.</p>
          </div>
        <div class="panel-badges">
          <span class="panel-badge">{{ dailyRhythmBuckets.filter((bucket) => bucket.isActive).length }} active hours</span>
          <span class="panel-badge">{{ focusSessions.length }} focus blocks</span>
          <span v-if="timelineEventMarkers.length" class="panel-badge">{{ timelineEventMarkers.length }} linked markers</span>
        </div>
      </div>

        <div class="timeline-legend" aria-label="Timeline legend">
          <span class="timeline-legend-chip productive">
            <span class="timeline-legend-dot productive"></span>
            Productive
          </span>
          <span class="timeline-legend-chip supporting">
            <span class="timeline-legend-dot supporting"></span>
            Supporting
          </span>
          <span class="timeline-legend-chip unclear">
            <span class="timeline-legend-dot unclear"></span>
            Unclear
          </span>
          <span class="timeline-legend-chip distracting">
            <span class="timeline-legend-dot distracting"></span>
            Distracting
          </span>
          <span class="timeline-legend-chip focus">
            <span class="timeline-legend-dot focus"></span>
            Focus session
          </span>
        </div>

        <div class="rhythm-area-card">
          <div class="rhythm-chart-head">
            <div>
              <span class="timeline-detail-kicker">24 hour view</span>
              <h3>{{ selectedDateLabel }}</h3>
            </div>
            <span class="timeline-lane-pill">{{ dailyRhythmBuckets.filter((b) => b.isActive).length }} active hour{{ dailyRhythmBuckets.filter((b) => b.isActive).length === 1 ? '' : 's' }}</span>
          </div>

          <div class="rhythm-area-chart">
            <VueApexCharts
              type="area"
              height="280"
              :options="rhythmChartOptions"
              :series="rhythmChartSeries"
            />
          </div>

          <div v-if="timelineEventMarkers.length" class="rhythm-events-strip">
            <button
              v-for="marker in timelineEventMarkers"
              :key="marker.id"
              class="rhythm-event-chip"
              :class="marker.markerTone"
              type="button"
              :title="`${marker.timeLabel} — ${marker.title}`"
              @click="activateMeaningfulEvent(marker)"
            >
              <span class="rhythm-event-chip-dot"></span>
              <span class="rhythm-event-chip-time">{{ marker.timeLabel }}</span>
            </button>
          </div>
        </div>

        <div v-if="activeRhythmBucket" class="rhythm-inspector-row">
          <div class="rhythm-inspector-left">
            <span class="timeline-detail-kicker">Inspector</span>
            <div class="timeline-detail-top">
              <strong>{{ activeRhythmBucket.bucketRangeLabel }}</strong>
              <span class="timeline-detail-lane" :class="activeRhythmBucket.dominantLane">{{ activeRhythmBucket.isActive ? formatLaneLabel(activeRhythmBucket.dominantLane) : 'Quiet' }}</span>
            </div>
            <div class="timeline-detail-meta">
              <span>{{ formatActivityDuration(activeRhythmBucket.trackedSeconds) }} background</span>
              <span>{{ formatActivityDuration(activeRhythmBucket.focusSeconds) }} focus</span>
            </div>

            <div class="rhythm-inspector-stats">
              <article class="rhythm-stat-card">
                <strong>{{ activeRhythmBucket.topApp }}</strong>
                <span>{{ activeRhythmBucket.topContextKind === 'browser' ? 'Lead browser context' : 'Top app in slot' }}</span>
              </article>
              <article class="rhythm-stat-card">
                <strong>{{ activeRhythmBucket.focusSeconds > 0 ? activeRhythmBucket.topFocusTitle : 'No focus block' }}</strong>
                <span>{{ activeRhythmBucket.focusSeconds > 0 ? 'Focus overlay present' : 'Background-only slot' }}</span>
              </article>
            </div>
          </div>

          <div class="rhythm-inspector-right">
            <div class="rhythm-breakdown">
              <div class="rhythm-break-row">
                <span>Productive</span>
                <div class="rhythm-break-track"><div class="rhythm-break-fill productive" :style="{ width: `${activeRhythmBucket.stack.productive}%` }"></div></div>
                <strong>{{ formatActivityDuration(activeRhythmBucket.laneTotals.productive) }}</strong>
              </div>
              <div class="rhythm-break-row">
                <span>Supporting</span>
                <div class="rhythm-break-track"><div class="rhythm-break-fill supporting" :style="{ width: `${activeRhythmBucket.stack.supporting}%` }"></div></div>
                <strong>{{ formatActivityDuration(activeRhythmBucket.laneTotals.supporting) }}</strong>
              </div>
              <div class="rhythm-break-row">
                <span>Unclear</span>
                <div class="rhythm-break-track"><div class="rhythm-break-fill unclear" :style="{ width: `${activeRhythmBucket.stack.unclear}%` }"></div></div>
                <strong>{{ formatActivityDuration(activeRhythmBucket.laneTotals.unclear) }}</strong>
              </div>
              <div class="rhythm-break-row">
                <span>Distracting</span>
                <div class="rhythm-break-track"><div class="rhythm-break-fill distracting" :style="{ width: `${activeRhythmBucket.stack.distracting}%` }"></div></div>
                <strong>{{ formatActivityDuration(activeRhythmBucket.laneTotals.distracting) }}</strong>
              </div>
            </div>

            <div v-if="activeRhythmMarkers.length" class="rhythm-event-list">
              <button
                v-for="marker in activeRhythmMarkers"
                :key="`${marker.id}-inspector`"
                class="rhythm-event-item"
                :class="[marker.markerTone, marker.sourceKind]"
                type="button"
                @click="activateMeaningfulEvent(marker)"
              >
                <span class="rhythm-event-item-time">{{ marker.timeLabel }}</span>
                <strong>{{ marker.title }}</strong>
                <div class="rhythm-event-item-meta">
                  <small>{{ marker.linkedTab }}</small>
                  <span v-if="marker.sourceKind === 'browser'" class="event-origin browser">
                    {{ marker.type === 'browser-audio' ? 'Browser audio' : 'Browser' }}
                  </span>
                  <span v-else-if="marker.sourceKind === 'task'" class="event-origin task">Task</span>
                  <span v-else-if="marker.sourceKind === 'habit'" class="event-origin habit">Habit</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div class="activity-grid single-column">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Background breakdown</h2>
              <p>Category balance and one cleaner explorer for apps, sites, and pages on this date.</p>
            </div>
          </div>

          <div v-if="categoryBreakdown.length" class="category-list">
            <article v-for="category in categoryBreakdown" :key="category.category" class="category-row">
              <div class="category-meta">
                <span class="category-dot" :style="{ background: category.color }"></span>
                <strong>{{ category.category }}</strong>
                <span
                  class="category-pill"
                  :class="category.lane || 'unclear'"
                >{{ formatLaneLabel(category.lane) }}</span>
              </div>
              <div class="category-bar">
                <div class="category-fill" :style="{ width: categoryBreakdown[0]?.seconds ? `${(category.seconds / categoryBreakdown[0].seconds) * 100}%` : '0%', background: category.color }"></div>
              </div>
              <span class="category-time">{{ formatActivityDuration(category.seconds) }}</span>
            </article>
          </div>

          <div v-if="activityExplorerRows.length" class="apps-section">
            <div class="activity-filter-dock">
              <div class="filter-group">
                <span>Source</span>
                <button
                  v-for="option in activityExplorerOptions"
                  :key="option.id"
                  type="button"
                  class="activity-filter-chip"
                  :class="{ active: activityExplorerMode === option.id }"
                  @click="activityExplorerMode = option.id"
                >
                  {{ option.label }}
                </button>
              </div>
              <div class="filter-group">
                <span>Sort</span>
                <button
                  v-for="option in activityExplorerSortOptions"
                  :key="`${activityExplorerMode}-${option.id}`"
                  type="button"
                  class="activity-filter-chip muted"
                  :class="{ active: activityExplorerSortMode === option.id }"
                  @click="activityExplorerSortMode = option.id"
                >
                  {{ option.label }}
                </button>
              </div>
              <input
                v-model="activityExplorerQuery"
                type="text"
                class="activity-search-input"
                placeholder="Search apps, sites, or pages"
              />
              <div class="filter-group lane-group">
                <span>Lane</span>
                <button
                  v-for="option in activityExplorerLaneOptions"
                  :key="`${activityExplorerMode}-${option.id}`"
                  type="button"
                  class="activity-filter-chip muted"
                  :class="{ active: activityExplorerLaneFilter === option.id }"
                  @click="activityExplorerLaneFilter = option.id"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <div class="scroll-hint explorer-count">{{ filteredActivityExplorerRows.length }} {{ filteredActivityExplorerRows.length === 1 ? 'entry' : 'entries' }} shown.</div>
            <div class="apps-scroll">
              <article v-for="app in filteredActivityExplorerRows" :key="app.key" class="app-row" :style="{ '--app-accent': app.color }">
                <div class="app-row-top">
                  <div class="app-labels">
                    <span class="app-dot" :style="{ background: app.color }"></span>
                    <strong :title="app.label">{{ app.label }}</strong>
                  </div>
                  <span class="app-time">{{ formatActivityDuration(app.seconds) }}</span>
                </div>
                <div class="app-bar">
                  <div class="app-bar-fill" :style="{ width: `${Math.max(8, Math.round((app.seconds / filteredActivityExplorerMaxSeconds) * 100))}%`, background: app.color }"></div>
                </div>
                <div class="app-meta">
                  <span>{{ app.category }} - <strong :class="['lane-inline', app.lane]">{{ formatLaneLabel(app.lane) }}</strong></span>
                  <span>{{ app.switches }} switch{{ app.switches === 1 ? '' : 'es' }}</span>
                  <span>Seen {{ formatClock(app.lastTs) }}</span>
                </div>
                <div class="scroll-hint" style="margin-top:4px">{{ app.helper }}</div>
              </article>
            </div>
          </div>

          <div class="background-evidence-grid compact-evidence-grid">
            <article v-for="card in trustStripCards" :key="card.label" class="background-evidence-card">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small>{{ card.note }}</small>
            </article>
          </div>

          <div v-if="topBrowserPages.length" class="background-browser-strip">
            <div class="background-browser-head">
              <h3>Top browser pages</h3>
              <span class="scroll-hint">Folded into the same background evidence layer.</span>
            </div>
            <div class="background-browser-list">
              <article v-for="page in topBrowserPages" :key="`${page.host}-${page.page}`" class="page-row compact">
                <div>
                  <strong :title="page.page">{{ page.page }}</strong>
                  <p>{{ page.host }} - {{ page.app }} - {{ formatLaneLabel(page.dominantLane) }}</p>
                </div>
                <span>{{ formatActivityDuration(page.seconds) }}</span>
              </article>
            </div>
          </div>
        </section>

      </div>

      <div class="support-grid">
        <section class="panel activity-diagnostics-panel">
          <div class="panel-head">
            <div>
              <h2>Tracking diagnostics</h2>
              <p>A quick read on what the tracking engine actually captured for this date.</p>
            </div>
          </div>

          <div class="trust-strip">
            <article v-for="card in trustStripCards" :key="card.label" class="trust-card">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small>{{ card.note }}</small>
            </article>
          </div>

          <div class="diagnostic-grid">
            <article v-for="card in diagnosticsCards" :key="card.label" class="diagnostic-card">
              <strong>{{ card.value }}</strong>
              <span>{{ card.label }}</span>
            </article>
          </div>

          <div v-if="browserPages.length" class="pages-list">
            <h3>Top browser pages</h3>
            <article v-for="page in browserPages" :key="`${page.host}-${page.page}`" class="page-row">
              <div>
                <strong :title="page.page">{{ page.page }}</strong>
                <p>{{ page.host }} - {{ page.app }} - {{ formatLaneLabel(page.dominantLane) }}</p>
              </div>
              <span>{{ formatActivityDuration(page.seconds) }}</span>
            </article>
          </div>
        </section>
      </div>
    </template>

    <Transition name="modal-fade">
      <div v-if="showRulePanel" class="modal-overlay" @click.self="showRulePanel = false">
        <div class="modal-card">
          <div class="modal-header">
            <div>
              <h3>Classification Rules</h3>
              <p>Override how apps or sites should be treated in tracking.</p>
            </div>
            <button class="modal-close" @click="showRulePanel = false">
              <XIcon size="16" />
            </button>
          </div>

          <div class="rule-form">
            <input v-model="ruleTarget" class="rule-input" placeholder="App name or keyword, like YouTube" />
            <select v-model="ruleCategory" class="rule-select">
              <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
            </select>
            <label class="rule-toggle">
              <input v-model="ruleProductive" type="checkbox" />
              Productive
            </label>
            <button class="primary-btn small" @click="saveRule">Save rule</button>
          </div>

          <div v-if="Object.keys(customRules).length" class="rule-list">
            <article v-for="[key, rule] in Object.entries(customRules)" :key="key" class="rule-row">
              <div>
                <strong>{{ key }}</strong>
                <p>{{ rule.category }}</p>
              </div>
              <span class="rule-badge" :class="rule.productive ? 'prod' : 'dist'">{{ rule.productive ? 'Productive' : 'Distracting' }}</span>
              <button class="rule-delete" @click="deleteRule(key)">
                <XIcon size="14" />
              </button>
            </article>
          </div>

          <p v-else class="rule-empty">No custom rules yet.</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.activity-page {
  padding: 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1380px;
  margin: 0 auto;
  min-width: 0;
}

.activity-page,
.activity-page * {
  box-sizing: border-box;
}

.activity-page.embedded {
  padding: 0;
  max-width: none;
  width: 100%;
  margin: 0;
  align-self: stretch;
}

.activity-header,
.panel-head,
.modal-header,
.header-actions,
.date-nav,
.hero-card,
.hero-chips,
.hero-stats,
.timeline-row,
.timeline-detail-top,
.timeline-detail-meta,
.app-row-top,
.app-labels,
.app-meta,
.focus-card-top,
.focus-stats,
.focus-mix,
.panel-badges,
.rule-form,
.rule-row,
.hero-stat,
.category-meta {
  display: flex;
}

.activity-header,
.panel-head,
.modal-header {
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
}

.activity-header.embedded {
  padding: 0 0 2px;
}

.embedded-copy {
  max-width: 540px;
}

.header-copy,
.hero-copy,
.sub-empty,
.modal-header > div,
.rule-row > div {
  display: flex;
  flex-direction: column;
}

.header-kicker,
.hero-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-base);
}

.page-title {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.04em;
}

.page-subtitle,
.hero-text,
.panel-head p,
.timeline-detail-copy,
.sub-empty p,
.modal-header p,
.rule-row p,
.scroll-hint,
.app-meta,
.focus-card p {
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-muted);
}

.header-actions {
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.date-nav {
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px;
  border-radius: 18px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--surface-strong, var(--bg-card)) 82%, transparent);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.date-pill,
.hero-chip,
.panel-badge,
.category-pill,
.rule-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: var(--surface-muted);
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
}

.category-pill.productive {
  color: #0f766e;
  border-color: rgba(20, 184, 166, 0.18);
  background: rgba(20, 184, 166, 0.1);
}

.category-pill.unclear {
  color: #C2410C;
  border-color: rgba(249, 115, 22, 0.2);
  background: rgba(249, 115, 22, 0.1);
}

.category-pill.distracting {
  color: #BE123C;
  border-color: rgba(251, 113, 133, 0.18);
  background: rgba(251, 113, 133, 0.1);
}

.date-icon-btn,
.secondary-btn,
.modal-close,
.rule-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 12px;
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  color: var(--text-muted);
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.date-icon-btn {
  width: 38px;
  height: 38px;
}

.secondary-btn {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 700;
}

.date-icon-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.date-input,
.rule-input,
.rule-select {
  border: 1px solid var(--border-light);
  border-radius: 12px;
  background: var(--surface-muted);
  color: var(--text-main);
  font-size: 12px;
  font-weight: 600;
  padding: 10px 12px;
  outline: none;
}

.date-input {
  min-width: 148px;
}

.hero-card,
.panel,
.modal-card {
  border-radius: 24px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.06);
}

.hero-card {
  justify-content: space-between;
  gap: 22px;
  padding: 26px;
  background:
    radial-gradient(circle at top right, rgba(0, 180, 216, 0.14), transparent 34%),
    linear-gradient(135deg, rgba(0, 180, 216, 0.08), rgba(82, 183, 136, 0.06)),
    var(--bg-card);
}

.hero-copy {
  flex: 1;
  gap: 10px;
}

.hero-title {
  font-size: clamp(26px, 3vw, 36px);
  font-weight: 800;
  letter-spacing: -0.05em;
}

.hero-story-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}

.hero-story-meta strong,
.hero-story-meta span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: color-mix(in srgb, var(--surface-muted) 86%, transparent);
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
}

.hero-story-meta strong {
  color: #0f766e;
  border-color: rgba(20, 184, 166, 0.18);
  background: rgba(20, 184, 166, 0.1);
}

.hero-chips,
.panel-badges,
.app-meta,
.focus-stats,
.focus-mix {
  flex-wrap: wrap;
  gap: 8px;
}

.hero-stats {
  flex-direction: column;
  gap: 12px;
  width: min(340px, 100%);
}

.hero-stat {
  align-items: center;
  gap: 12px;
  min-width: 100%;
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--surface-muted);
  border: 1px solid var(--border-light);
}

.hero-stat strong {
  margin-left: auto;
  font-size: 22px;
  font-weight: 800;
  color: var(--text-main);
}

.hero-stat span {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hero-stat.cyan strong { color: #0EA5E9; }
.hero-stat.teal strong,
.hero-stat.good strong { color: #14B8A6; }
.hero-stat.soft strong { color: #F59E0B; }

.panel,
.empty-panel {
  padding: 24px;
}

.empty-panel,
.sub-empty {
  min-height: 240px;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
}

.timeline-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.timeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.timeline-legend-chip,
.timeline-lane-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: var(--surface-muted);
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
}

.timeline-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.timeline-legend-dot.productive { background: #14B8A6; }
.timeline-legend-dot.supporting { background: #7C3AED; }
.timeline-legend-dot.unclear { background: #F97316; }
.timeline-legend-dot.distracting { background: #FB7185; }
.timeline-legend-dot.focus { background: #0EA5E9; }

.timeline-preview-card,
.timeline-zoom-card {
  padding: 20px;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    radial-gradient(circle at top right, rgba(14,165,233,0.07), transparent 26%),
    var(--surface-muted);
}

.timeline-preview-head,
.timeline-zoom-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.timeline-preview-head h3,
.timeline-zoom-head h3 {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.timeline-preview-track {
  position: relative;
  height: 42px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-muted) 96%, transparent), color-mix(in srgb, var(--surface-muted) 88%, transparent)),
    repeating-linear-gradient(
      90deg,
      rgba(148, 163, 184, 0.06) 0,
      rgba(148, 163, 184, 0.06) 1px,
      transparent 1px,
      transparent calc(100% / 12)
    );
  overflow: hidden;
}

.timeline-mini-segment {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 12px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  background: linear-gradient(90deg, color-mix(in srgb, var(--segment-color) 20%, #ffffff 80%), var(--segment-color));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--segment-color) 16%, #ffffff 84%),
    0 6px 14px color-mix(in srgb, var(--segment-color) 18%, transparent 82%);
}

.timeline-mini-segment.focus {
  height: 18px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--segment-color) 10%, #ffffff 90%), var(--segment-color));
}

.preview-axis {
  margin-top: 10px;
}

.timeline-board {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 320px);
  gap: 18px;
}

.timeline-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.timeline-lane-card {
  padding: 18px;
  border-radius: 22px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    radial-gradient(circle at top right, rgba(14,165,233,0.07), transparent 28%),
    var(--surface-muted);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--bg-card) 72%, transparent);
}

.focus-card-lane {
  background:
    radial-gradient(circle at top right, rgba(20,184,166,0.08), transparent 26%),
    var(--surface-muted);
}

.timeline-lane-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.timeline-row-label {
  min-width: 0;
}

.timeline-row-label span {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.timeline-row-label small {
  display: block;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.timeline-track {
  position: relative;
  flex: 1;
  height: 70px;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface-muted) 96%, transparent), color-mix(in srgb, var(--surface-muted) 88%, transparent)),
    repeating-linear-gradient(
      90deg,
      rgba(148, 163, 184, 0.06) 0,
      rgba(148, 163, 184, 0.06) 1px,
      transparent 1px,
      transparent calc(100% / 12)
    );
  overflow: hidden;
}

.focus-track {
  height: 78px;
}

.timeline-guide {
  position: absolute;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: linear-gradient(180deg, transparent, rgba(148, 163, 184, 0.14), transparent);
  transform: translateX(-0.5px);
}

.timeline-segment {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 18px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  background: linear-gradient(90deg, color-mix(in srgb, var(--segment-color) 22%, #ffffff 78%), var(--segment-color));
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--segment-color) 20%, #ffffff 80%),
    0 10px 18px color-mix(in srgb, var(--segment-accent) 42%, transparent 58%);
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
  opacity: 0.96;
}

.timeline-segment.focus {
  height: 30px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--segment-color) 12%, #ffffff 88%), var(--segment-color));
}

.timeline-segment:hover,
.timeline-segment:focus-visible {
  transform: translateY(-50%) scale(1.015);
  outline: none;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--segment-color) 12%, #ffffff 88%),
    0 14px 24px color-mix(in srgb, var(--segment-accent) 56%, transparent 44%);
}

.segment-text {
  position: absolute;
  left: 10px;
  right: 30px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: rgba(255,255,255,0.95);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
  pointer-events: none;
}

.segment-text.focus-text {
  color: rgba(255,255,255,0.98);
}

.segment-caption {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(255,255,255,0.18);
  backdrop-filter: blur(6px);
  font-size: 10px;
  font-weight: 800;
  color: #ffffff;
}

.timeline-axis {
  position: relative;
  height: 22px;
  margin: 0 6px;
}

.timeline-axis span {
  position: absolute;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.timeline-detail {
  min-height: 100%;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    radial-gradient(circle at top right, rgba(14,165,233,0.08), transparent 28%),
    rgba(248,250,252,0.94);
}

.timeline-detail.active {
  border-color: rgba(14, 165, 233, 0.18);
  box-shadow: 0 14px 28px rgba(14, 165, 233, 0.08);
}

.timeline-inspector {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 12px;
}

.timeline-detail-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-base);
}



.rhythm-area-card {
  padding: 22px;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    radial-gradient(circle at top right, rgba(14,165,233,0.06), transparent 28%),
    var(--surface-muted);
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.05);
}

.rhythm-chart-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}

.rhythm-chart-head h3 {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.rhythm-area-chart {
  min-width: 0;
}

.rhythm-area-chart :deep(.apexcharts-canvas) {
  width: 100% !important;
}

.rhythm-inspector-row {
  display: grid;
  grid-template-columns: minmax(0, 0.72fr) minmax(0, 1fr);
  gap: 18px;
  padding: 22px;
  border-radius: 24px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: var(--surface-muted);
  box-shadow: 0 18px 32px rgba(15, 23, 42, 0.05);
}

.rhythm-inspector-left {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rhythm-inspector-right {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rhythm-events-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.rhythm-event-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px 4px 7px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: var(--bg-card);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
  font-family: inherit;
  white-space: nowrap;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.rhythm-event-chip:hover,
.rhythm-event-chip:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(14, 165, 233, 0.12);
  border-color: rgba(14, 165, 233, 0.26);
  outline: none;
}

.rhythm-event-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
}

.rhythm-event-chip-time {
  color: inherit;
  opacity: 0.9;
}

.rhythm-event-chip.focus,
.rhythm-event-item.focus {
  color: #0f766e;
  border-color: rgba(20, 184, 166, 0.22);
  background: rgba(20, 184, 166, 0.1);
}

.rhythm-event-chip.good,
.rhythm-event-item.good {
  color: #047857;
  border-color: rgba(34, 197, 94, 0.2);
  background: rgba(34, 197, 94, 0.08);
}

.rhythm-event-chip.warn,
.rhythm-event-item.warn {
  color: #be123c;
  border-color: rgba(251, 113, 133, 0.22);
  background: rgba(251, 113, 133, 0.1);
}

.rhythm-event-chip.browser,
.rhythm-event-item.browser {
  color: #1d4ed8;
  border-color: rgba(59, 130, 246, 0.22);
  background: rgba(59, 130, 246, 0.1);
}

.rhythm-event-chip.browser-audio,
.rhythm-event-item.browser-audio {
  color: #7c2d12;
  border-color: rgba(249, 115, 22, 0.22);
  background: rgba(249, 115, 22, 0.12);
}

.rhythm-event-chip.task,
.rhythm-event-item.task {
  color: #047857;
  border-color: rgba(16, 185, 129, 0.22);
  background: rgba(16, 185, 129, 0.1);
}

.rhythm-event-chip.habit,
.rhythm-event-item.habit {
  color: #6d28d9;
  border-color: rgba(139, 92, 246, 0.22);
  background: rgba(139, 92, 246, 0.1);
}


.rhythm-event-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rhythm-event-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: var(--surface-muted);
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.rhythm-event-item:hover,
.rhythm-event-item:focus-visible {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(15, 23, 42, 0.08);
}

.rhythm-event-item-time {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.rhythm-event-item strong {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-main);
}

.rhythm-event-item small {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: capitalize;
}

.rhythm-event-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.rhythm-event-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rhythm-inspector-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.rhythm-stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-radius: 18px;
  background: var(--surface-muted);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.rhythm-stat-card strong {
  font-size: 14px;
  font-weight: 800;
  line-height: 1.4;
}

.rhythm-stat-card span {
  font-size: 11px;
  color: var(--text-muted);
}

.rhythm-breakdown {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.rhythm-break-row {
  display: grid;
  grid-template-columns: minmax(92px, 128px) minmax(0, 1fr) minmax(78px, auto);
  align-items: center;
  gap: 10px;
}

.rhythm-break-row span {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.rhythm-break-row strong {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-main);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.rhythm-break-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.14);
  overflow: hidden;
}

.rhythm-break-fill {
  height: 100%;
  border-radius: 999px;
}

.rhythm-break-fill.productive {
  background: linear-gradient(90deg, #45dbc8, #14B8A6);
}

.rhythm-break-fill.supporting {
  background: linear-gradient(90deg, #A78BFA, #7C3AED);
}

.rhythm-break-fill.unclear {
  background: linear-gradient(90deg, #FDBA74, #F97316);
}

.rhythm-break-fill.distracting {
  background: linear-gradient(90deg, #fb9cb0, #FB7185);
}

.zoom-axis {
  margin-top: 4px;
}

.timeline-detail-top {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.timeline-detail-top strong {
  font-size: 14px;
  font-weight: 800;
}

.timeline-detail-top span,
.timeline-detail-meta span {
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--surface-strong, var(--bg-card));
  border: 1px solid rgba(148, 163, 184, 0.14);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  color: var(--text-muted);
}

.timeline-detail-meta .timeline-detail-lane.productive {
  color: #0f766e;
  border-color: rgba(20, 184, 166, 0.22);
  background: rgba(20, 184, 166, 0.12);
}

.timeline-detail-meta .timeline-detail-lane.supporting {
  color: #5b21b6;
  border-color: rgba(124, 58, 237, 0.2);
  background: rgba(124, 58, 237, 0.12);
}

.timeline-detail-meta .timeline-detail-lane.unclear {
  color: #c2410c;
  border-color: rgba(249, 115, 22, 0.2);
  background: rgba(249, 115, 22, 0.12);
}

.timeline-detail-meta .timeline-detail-lane.distracting {
  color: #be123c;
  border-color: rgba(251, 113, 133, 0.22);
  background: rgba(251, 113, 133, 0.12);
}

.timeline-detail-meta {
  margin-top: 10px;
}

.activity-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
  gap: 20px;
}

.activity-grid.single-column {
  grid-template-columns: minmax(0, 1fr);
}

.support-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}

.activity-grid.single-column + .support-grid {
  display: none;
}

.category-list,
.apps-section,
.focus-scroll,
.rule-list {
  display: flex;
  flex-direction: column;
}
.activity-filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 11px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: color-mix(in srgb, var(--surface-muted) 90%, transparent);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.activity-filter-chip.active {
  color: #0f172a;
  border-color: rgba(14,165,233,.28);
  background: linear-gradient(135deg, rgba(224,242,254,.88), rgba(240,253,250,.94));
  transform: translateY(-1px);
}
.activity-filter-chip.muted.active {
  border-color: rgba(99,102,241,.22);
  background: rgba(99,102,241,.08);
}

.activity-filter-dock {
  display: grid;
  grid-template-columns: auto auto minmax(220px, 1fr);
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  padding: 12px;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background:
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.06), transparent 36%),
    color-mix(in srgb, var(--surface-muted) 88%, transparent);
}

.filter-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.filter-group > span {
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.lane-group {
  grid-column: 1 / -1;
}

.explorer-count {
  margin-top: 8px;
}

.category-list {
  gap: 14px;
}

.category-row {
  display: grid;
  grid-template-columns: minmax(180px, 260px) minmax(0, 1fr) minmax(70px, auto);
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}

.category-row:last-child {
  border-bottom: none;
}

.category-meta,
.app-labels,
.focus-card-top,
.rule-form,
.rule-row {
  align-items: center;
  gap: 10px;
}

.category-dot,
.app-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  flex-shrink: 0;
}

.category-bar,
.app-bar {
  height: 9px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  overflow: hidden;
}

.category-fill,
.app-bar-fill {
  height: 100%;
  border-radius: 999px;
}

.category-time,
.app-time,
.focus-score {
  font-size: 14px;
  font-weight: 800;
}

.lane-inline {
  font-weight: 800;
}

.lane-inline.productive { color: #0f766e; }
.lane-inline.supporting { color: #5B21B6; }
.lane-inline.unclear { color: #C2410C; }
.lane-inline.distracting { color: #BE123C; }

.apps-section {
  gap: 10px;
  margin-top: 22px;
}

.background-evidence-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.compact-evidence-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.background-evidence-card {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: var(--surface-muted);
}

.background-evidence-card span {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.background-evidence-card strong {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.background-evidence-card small {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}

.background-browser-strip {
  margin-top: 18px;
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: var(--surface-muted);
}

.background-browser-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.background-browser-head h3 {
  font-size: 13px;
  font-weight: 800;
}

.background-browser-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.explorer-toolbar {
  justify-content: flex-start;
}

.activity-explorer-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.activity-search-input {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: var(--surface-muted);
  color: var(--text-main);
  font-size: 13px;
  font-weight: 600;
  padding: 12px 14px;
  outline: none;
  font-family: inherit;
}

.activity-search-input:focus {
  border-color: rgba(14, 165, 233, 0.28);
  box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.08);
}

.apps-scroll,
.focus-scroll {
  max-height: 430px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}

.apps-scroll::-webkit-scrollbar,
.focus-scroll::-webkit-scrollbar {
  width: 6px;
}

.apps-scroll::-webkit-scrollbar-thumb,
.focus-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.36);
  border-radius: 999px;
}

.app-row {
  padding: 14px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.app-row:last-child,
.focus-card:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.focus-card {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: var(--surface-muted);
  margin-bottom: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.focus-card:hover,
.focus-card:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 14px 24px rgba(15, 23, 42, 0.08);
}

.source-badges {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.source-badges.compact {
  margin-top: 12px;
}

.source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: var(--surface-strong, var(--bg-card));
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.source-badge.combined {
  color: #0f766e;
  border-color: rgba(20, 184, 166, 0.2);
  background: rgba(20, 184, 166, 0.08);
}

.events-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.event-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.event-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: var(--bg-card);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.04);
  font-family: inherit;
  text-align: left;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.event-card.browser {
  border-color: rgba(59, 130, 246, 0.18);
  background: linear-gradient(180deg, rgba(239, 246, 255, 0.9), rgba(248, 250, 252, 0.96));
}

.event-card.task {
  border-color: rgba(16, 185, 129, 0.18);
  background: linear-gradient(180deg, rgba(236, 253, 245, 0.9), rgba(248, 250, 252, 0.96));
}

.event-card.habit {
  border-color: rgba(139, 92, 246, 0.18);
  background: linear-gradient(180deg, rgba(245, 243, 255, 0.92), rgba(248, 250, 252, 0.96));
}

.event-card:hover,
.event-card.active {
  transform: translateY(-2px);
  border-color: rgba(14, 165, 233, 0.2);
  box-shadow: 0 16px 28px rgba(14, 165, 233, 0.08);
}

.event-card strong {
  font-size: 14px;
  font-weight: 800;
  color: var(--text-main);
}

.event-card p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-muted);
}

.event-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.event-time,
.event-tab {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.event-origin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: var(--bg-card);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.event-origin.browser {
  color: #1d4ed8;
  border-color: rgba(59, 130, 246, 0.2);
  background: rgba(59, 130, 246, 0.08);
}

.event-origin.task {
  color: #047857;
  border-color: rgba(16, 185, 129, 0.2);
  background: rgba(16, 185, 129, 0.08);
}

.event-origin.habit {
  color: #6d28d9;
  border-color: rgba(139, 92, 246, 0.2);
  background: rgba(139, 92, 246, 0.08);
}

.hero-source-note {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-muted);
}

.focus-card.strong { border-color: rgba(20, 184, 166, 0.18); }
.focus-card.steady { border-color: rgba(14, 165, 233, 0.18); }
.focus-card.mixed { border-color: rgba(245, 158, 11, 0.2); }
.focus-card.strained { border-color: rgba(251, 113, 133, 0.22); }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: grid;
  place-items: center;
  padding: 24px;
  z-index: 120;
  backdrop-filter: blur(8px);
}

.modal-card {
  width: min(620px, 100%);
  padding: 24px;
}

.rule-form {
  flex-wrap: wrap;
  margin-top: 18px;
}

.rule-input { flex: 1 1 220px; }
.rule-select { flex: 0 0 170px; }

.rule-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.primary-btn.small {
  padding: 10px 16px;
  margin-top: 0;
}

.rule-list {
  gap: 10px;
  margin-top: 18px;
}

.rule-row {
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--bg-card);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.rule-row > div {
  flex: 1;
}

.compact-empty {
  min-height: 180px;
}

.diagnostic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.trust-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.trust-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
}

.trust-card span {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.trust-card strong {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.trust-card small {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}

.diagnostic-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  border-radius: 16px;
  background: var(--bg-card);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.diagnostic-card strong {
  font-size: 18px;
  font-weight: 800;
}

.diagnostic-card span {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.pages-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}

.pages-list h3 {
  font-size: 13px;
  font-weight: 800;
}

.page-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.page-row:last-child {
  border-bottom: none;
}

.page-row.compact {
  padding: 10px 0;
}

.page-row > div {
  min-width: 0;
}

.page-row strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-row span {
  font-size: 13px;
  font-weight: 800;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

:global(.rhythm-apex-tooltip) {
  background: #ffffff;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 14px;
  padding: 12px 14px;
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.14);
  min-width: 180px;
  font-family: inherit;
  pointer-events: none;
}

:global(.rtt-time) {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 6px;
}

:global(.rtt-app) {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

:global(.rtt-app.browser) {
  color: #1d4ed8;
}

:global(.rtt-lanes) {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

:global(.rtt-lane) {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

:global(.rtt-lane span:not(.rtt-dot)) {
  flex: 1;
  color: #475569;
}

:global(.rtt-lane strong) {
  font-size: 11px;
  font-weight: 700;
  color: #1e293b;
}

:global(.rtt-dot) {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  flex-shrink: 0;
}

:global(.rtt-empty) {
  font-size: 11px;
  color: #94a3b8;
}

:global(.dark-theme .rhythm-apex-tooltip) {
  background: #1e2d40;
  border-color: rgba(148, 163, 184, 0.18);
}

:global(.dark-theme .rtt-time) {
  color: #94a3b8;
}

:global(.dark-theme .rtt-app) {
  color: #e2e8f0;
}

:global(.dark-theme .rtt-lane span:not(.rtt-dot)) {
  color: #94a3b8;
}

:global(.dark-theme .rtt-lane strong) {
  color: #f1f5f9;
}

:global(.dark-theme .activity-page .hero-card),
:global(.dark-theme .activity-page .timeline-panel),
:global(.dark-theme .activity-page .panel){
  background: var(--bg-card);
}

:global(.dark-theme .activity-page .hero-story-meta strong){
  color: #67e8f9;
  border-color: rgba(103, 232, 249, 0.22);
  background: rgba(8, 145, 178, 0.16);
}

:global(.dark-theme .activity-page .hero-stat),
:global(.dark-theme .activity-page .rhythm-area-card),
:global(.dark-theme .activity-page .rhythm-inspector-row),
:global(.dark-theme .activity-page .rhythm-event-item),
:global(.dark-theme .activity-page .rhythm-stat-card),
:global(.dark-theme .activity-page .background-evidence-card),
:global(.dark-theme .activity-page .background-browser-strip),
:global(.dark-theme .activity-page .event-card){
  background: var(--bg-card);
  border-color: rgba(148, 163, 184, 0.18);
}

:global(.dark-theme .activity-page .activity-filter-dock){
  background: var(--bg-card);
}

:global(.dark-theme .activity-page .source-badge),
:global(.dark-theme .activity-page .activity-filter-chip),
:global(.dark-theme .activity-page .event-origin),
:global(.dark-theme .activity-page .timeline-detail-top span),
:global(.dark-theme .activity-page .timeline-detail-meta span){
  background: rgba(15, 23, 42, 0.55);
  color: var(--text-muted);
  border-color: rgba(148, 163, 184, 0.18);
}

:global(.dark-theme .activity-page .activity-filter-chip.active){
  color: #67e8f9;
  border-color: rgba(103, 232, 249, 0.26);
  background: rgba(8, 145, 178, 0.16);
}

:global(.dark-theme .activity-page .rhythm-break-track){
  background: rgba(71, 85, 105, 0.32);
}

:global(.dark-theme .activity-page .rhythm-event-item strong),
:global(.dark-theme .activity-page .rhythm-stat-card strong),
:global(.dark-theme .activity-page .rhythm-break-row strong){
  color: #f8fafc;
}

:global(.dark-theme .activity-page .rhythm-event-item small),
:global(.dark-theme .activity-page .rhythm-stat-card span),
:global(.dark-theme .activity-page .rhythm-break-row span){
  color: #9fb2c8;
}

:global(.dark-theme .activity-page .rhythm-event-chip){
  border-color: rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.72);
}

:global(.dark-theme .activity-page .category-row),
:global(.dark-theme .activity-page .app-row),
:global(.dark-theme .activity-page .page-row),
:global(.dark-theme .activity-page .trust-card),
:global(.dark-theme .activity-page .diagnostic-card),
:global(.dark-theme .activity-page .rule-row),
:global(.dark-theme .activity-page .focus-card){
  border-color: rgba(148, 163, 184, 0.14);
  color: #e5f0ff;
}

:global(.dark-theme .activity-page .app-row),
:global(.dark-theme .activity-page .page-row),
:global(.dark-theme .activity-page .trust-card),
:global(.dark-theme .activity-page .diagnostic-card),
:global(.dark-theme .activity-page .rule-row),
:global(.dark-theme .activity-page .focus-card){
  background: var(--bg-card);
}

:global(.dark-theme .activity-page .activity-search-input){
  border-color: rgba(148, 163, 184, 0.18);
  background: var(--bg-card);
  color: #e5f0ff;
}

:global(.dark-theme .activity-page .activity-search-input::placeholder){
  color: #7890aa;
}

:global(.dark-theme .activity-page .category-bar),
:global(.dark-theme .activity-page .app-bar){
  background: rgba(71, 85, 105, 0.36);
}

:global(.dark-theme .activity-page .category-time),
:global(.dark-theme .activity-page .app-time),
:global(.dark-theme .activity-page .page-row span),
:global(.dark-theme .activity-page .trust-card strong),
:global(.dark-theme .activity-page .diagnostic-card strong){
  color: #e5f0ff;
}

:global(.dark-theme .activity-page .app-labels strong),
:global(.dark-theme .activity-page .page-row strong),
:global(.dark-theme .activity-page .rule-row strong),
:global(.dark-theme .activity-page .focus-card strong),
:global(.dark-theme .activity-page .background-browser-head h3){
  color: #f8fafc;
}

:global(.dark-theme .activity-page .app-meta),
:global(.dark-theme .activity-page .page-row small),
:global(.dark-theme .activity-page .trust-card span),
:global(.dark-theme .activity-page .trust-card small),
:global(.dark-theme .activity-page .diagnostic-card span){
  color: #9fb2c8;
}

:global(.dark-theme .activity-page .rhythm-inspector-row){
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.24);
}

:global(.dark-theme .activity-page .hero-card),
:global(.dark-theme .activity-page .panel),
:global(.dark-theme .activity-page .timeline-panel),
:global(.dark-theme .activity-page .rhythm-area-card),
:global(.dark-theme .activity-page .rhythm-inspector-row),
:global(.dark-theme .activity-page .event-card),
:global(.dark-theme .activity-page .background-evidence-card),
:global(.dark-theme .activity-page .background-browser-strip){
  border-color: rgba(148, 163, 184, 0.18);
  background:
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.1), transparent 34%),
    rgba(15, 23, 42, 0.82) !important;
  color: #e5f0ff;
}

:global(.dark-theme .activity-page .hero-card h2),
:global(.dark-theme .activity-page .panel h2),
:global(.dark-theme .activity-page .event-card strong),
:global(.dark-theme .activity-page .timeline-detail-top strong){
  color: #f8fafc;
}

:global(.dark-theme .activity-page .hero-card p),
:global(.dark-theme .activity-page .panel p),
:global(.dark-theme .activity-page .event-card p),
:global(.dark-theme .activity-page .timeline-detail-top span),
:global(.dark-theme .activity-page .timeline-detail-meta span){
  color: #9fb2c8;
}

@media (max-width: 1160px) {
  .hero-card,
  .event-strip,
  .activity-grid,
  .support-grid,
  .rhythm-inspector-row {
    grid-template-columns: 1fr;
  }

  .hero-stats {
    width: 100%;
  }
}

@media (max-width: 900px) {
  .activity-page {
    padding: 28px 22px;
  }

  .activity-header,
  .panel-head,
  .rhythm-chart-head {
    flex-direction: column;
  }

  .header-actions,
  .panel-badges {
    justify-content: flex-start;
  }

  .timeline-lane-head,
  .rhythm-break-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .rhythm-inspector-row {
    grid-template-columns: 1fr;
  }

  .rhythm-inspector-stats {
    grid-template-columns: 1fr;
  }

  .rhythm-break-row {
    display: flex;
  }

  .category-row {
    grid-template-columns: 1fr;
  }

  .activity-filter-dock {
    grid-template-columns: 1fr;
  }

  .lane-group {
    grid-column: auto;
  }

  .diagnostic-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .trust-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .background-evidence-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .compact-evidence-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .activity-page {
    padding: 22px 16px;
  }

  .date-nav,
  .header-actions,
  .date-input,
  .secondary-btn {
    width: 100%;
  }

  .hero-stat {
    min-width: 100%;
  }

  .rhythm-chart {
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .rhythm-area-card,
  .rhythm-inspector-row {
    padding: 18px;
  }

  .diagnostic-grid {
    grid-template-columns: 1fr;
  }

  .trust-strip {
    grid-template-columns: 1fr;
  }

  .background-evidence-grid {
    grid-template-columns: 1fr;
  }

  .compact-evidence-grid {
    grid-template-columns: 1fr;
  }
}

:global(.dark-theme .activity-page .hero-card),
:global(.dark-theme .activity-page .panel),
:global(.dark-theme .activity-page .timeline-panel),
:global(.dark-theme .activity-page .timeline-detail),
:global(.dark-theme .activity-page .rhythm-area-card),
:global(.dark-theme .activity-page .rhythm-inspector-row),
:global(.dark-theme .activity-page .rhythm-stat-card),
:global(.dark-theme .activity-page .rhythm-event-item),
:global(.dark-theme .activity-page .background-evidence-card),
:global(.dark-theme .activity-page .background-browser-strip),
:global(.dark-theme .activity-page .event-card),
:global(.dark-theme .activity-page .category-row),
:global(.dark-theme .activity-page .app-row),
:global(.dark-theme .activity-page .page-row),
:global(.dark-theme .activity-page .diagnostic-card),
:global(.dark-theme .activity-page .trust-card),
:global(.dark-theme .activity-page .filter-dock),
:global(.dark-theme .activity-page .activity-filter-dock){
  border-color: rgba(148, 163, 184, 0.18) !important;
  background:
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.1), transparent 34%),
    rgba(15, 23, 42, 0.86) !important;
  color: #e5f0ff !important;
}

:global(.dark-theme .activity-page .hero-title),
:global(.dark-theme .activity-page .panel h2),
:global(.dark-theme .activity-page .panel h3),
:global(.dark-theme .activity-page .timeline-detail strong),
:global(.dark-theme .activity-page .rhythm-chart-head h3),
:global(.dark-theme .activity-page .rhythm-event-item strong),
:global(.dark-theme .activity-page .rhythm-stat-card strong),
:global(.dark-theme .activity-page .rhythm-break-row strong),
:global(.dark-theme .activity-page .category-row strong),
:global(.dark-theme .activity-page .app-row strong),
:global(.dark-theme .activity-page .page-row strong){
  color: #f8fafc !important;
}

:global(.dark-theme .activity-page .hero-text),
:global(.dark-theme .activity-page .panel p),
:global(.dark-theme .activity-page .timeline-detail span),
:global(.dark-theme .activity-page .rhythm-event-item small),
:global(.dark-theme .activity-page .rhythm-stat-card span),
:global(.dark-theme .activity-page .rhythm-break-row span),
:global(.dark-theme .activity-page .category-row span),
:global(.dark-theme .activity-page .app-row span),
:global(.dark-theme .activity-page .page-row span){
  color: #9fb2c8 !important;
}

:global(.dark-theme .activity-page .rhythm-break-track){
  border-color: rgba(148, 163, 184, 0.14) !important;
  background: rgba(148, 163, 184, 0.16) !important;
}

/* ApexCharts dark mode — rhythm area chart */
:global(.dark-theme .activity-page .apexcharts-text tspan),
:global(.dark-theme .activity-page .apexcharts-xaxis-label tspan),
:global(.dark-theme .activity-page .apexcharts-yaxis-label tspan),
:global(.dark-theme .activity-page .apexcharts-legend-text){
  fill: #8a96a8 !important;
  color: #8a96a8 !important;
}

:global(.dark-theme .activity-page .apexcharts-gridline){
  stroke: rgba(255, 255, 255, 0.08) !important;
}

:global(.dark-theme .activity-page .apexcharts-canvas){
  background: transparent !important;
}

:global(.dark-theme .activity-page .apexcharts-toolbar svg){
  fill: #8a96a8 !important;
}

:global(.dark-theme .activity-page .apexcharts-menu){
  background: #1a2840 !important;
  border: 1px solid rgba(148, 163, 184, 0.18) !important;
  color: #e2e8f0 !important;
}

:global(.dark-theme .activity-page .apexcharts-menu-item:hover){
  background: rgba(14, 165, 233, 0.14) !important;
}

/* Event card type-specific dark overrides — these have higher specificity than the general .event-card dark rule */
:global(.dark-theme .activity-page .event-card.browser){
  background: linear-gradient(180deg, rgba(30, 58, 138, 0.22), rgba(15, 23, 42, 0.82)) !important;
  border-color: rgba(59, 130, 246, 0.24) !important;
}

:global(.dark-theme .activity-page .event-card.task){
  background: linear-gradient(180deg, rgba(6, 78, 59, 0.22), rgba(15, 23, 42, 0.82)) !important;
  border-color: rgba(16, 185, 129, 0.24) !important;
}

:global(.dark-theme .activity-page .event-card.habit){
  background: linear-gradient(180deg, rgba(76, 29, 149, 0.22), rgba(15, 23, 42, 0.82)) !important;
  border-color: rgba(139, 92, 246, 0.24) !important;
}

/* ─── STATUS CHIP / PILL / LANE DARK OVERRIDES ───────────────────────────────
   All category pills, rhythm event chips/items, lane-inline labels, and
   timeline-detail-lane badges use dark-on-light semantic colors that are
   nearly invisible on dark card surfaces. Replacing with bright equivalents.
   Color mapping:  #0f766e → #2dd4bf  |  #047857 → #34d399
                   #C2410C → #fb923c  |  #BE123C → #fb7185
                   #1d4ed8 → #60a5fa  |  #7c2d12 → #fb923c
                   #6d28d9 → #a78bfa  |  #5b21b6 → #a78bfa
──────────────────────────────────────────────────────────────────────────────── */

/* Category pills */
:global(.dark-theme .activity-page .category-pill.productive){
  color: #2dd4bf !important;
  border-color: rgba(45, 212, 191, 0.22) !important;
  background: rgba(45, 212, 191, 0.1) !important;
}
:global(.dark-theme .activity-page .category-pill.unclear){
  color: #fb923c !important;
  border-color: rgba(249, 115, 22, 0.22) !important;
  background: rgba(249, 115, 22, 0.1) !important;
}
:global(.dark-theme .activity-page .category-pill.distracting){
  color: #fb7185 !important;
  border-color: rgba(251, 113, 133, 0.22) !important;
  background: rgba(251, 113, 133, 0.1) !important;
}

/* Rhythm event chips and items */
:global(.dark-theme .activity-page .rhythm-event-chip.focus),
:global(.dark-theme .activity-page .rhythm-event-item.focus){
  color: #2dd4bf !important;
  border-color: rgba(45, 212, 191, 0.22) !important;
  background: rgba(45, 212, 191, 0.1) !important;
}
:global(.dark-theme .activity-page .rhythm-event-chip.good),
:global(.dark-theme .activity-page .rhythm-event-item.good){
  color: #34d399 !important;
  border-color: rgba(52, 211, 153, 0.2) !important;
  background: rgba(52, 211, 153, 0.08) !important;
}
:global(.dark-theme .activity-page .rhythm-event-chip.warn),
:global(.dark-theme .activity-page .rhythm-event-item.warn){
  color: #fb7185 !important;
  border-color: rgba(251, 113, 133, 0.22) !important;
  background: rgba(251, 113, 133, 0.1) !important;
}
:global(.dark-theme .activity-page .rhythm-event-chip.browser),
:global(.dark-theme .activity-page .rhythm-event-item.browser){
  color: #60a5fa !important;
  border-color: rgba(96, 165, 250, 0.22) !important;
  background: rgba(96, 165, 250, 0.1) !important;
}
:global(.dark-theme .activity-page .rhythm-event-chip.browser-audio),
:global(.dark-theme .activity-page .rhythm-event-item.browser-audio){
  color: #fb923c !important;
  border-color: rgba(249, 115, 22, 0.22) !important;
  background: rgba(249, 115, 22, 0.1) !important;
}
:global(.dark-theme .activity-page .rhythm-event-chip.task),
:global(.dark-theme .activity-page .rhythm-event-item.task){
  color: #34d399 !important;
  border-color: rgba(16, 185, 129, 0.22) !important;
  background: rgba(16, 185, 129, 0.1) !important;
}
:global(.dark-theme .activity-page .rhythm-event-chip.habit),
:global(.dark-theme .activity-page .rhythm-event-item.habit){
  color: #a78bfa !important;
  border-color: rgba(167, 139, 250, 0.22) !important;
  background: rgba(167, 139, 250, 0.1) !important;
}

/* Lane inline labels */
:global(.dark-theme .activity-page .lane-inline.productive){ color: #2dd4bf !important; }
:global(.dark-theme .activity-page .lane-inline.supporting){ color: #a78bfa !important; }
:global(.dark-theme .activity-page .lane-inline.unclear){ color: #fb923c !important; }
:global(.dark-theme .activity-page .lane-inline.distracting){ color: #fb7185 !important; }

/* Timeline detail lane badges */
:global(.dark-theme .activity-page .timeline-detail-meta .timeline-detail-lane.productive){
  color: #2dd4bf !important;
  border-color: rgba(45, 212, 191, 0.22) !important;
  background: rgba(45, 212, 191, 0.12) !important;
}
:global(.dark-theme .activity-page .timeline-detail-meta .timeline-detail-lane.supporting){
  color: #a78bfa !important;
  border-color: rgba(167, 139, 250, 0.2) !important;
  background: rgba(167, 139, 250, 0.12) !important;
}
:global(.dark-theme .activity-page .timeline-detail-meta .timeline-detail-lane.unclear){
  color: #fb923c !important;
  border-color: rgba(249, 115, 22, 0.2) !important;
  background: rgba(249, 115, 22, 0.12) !important;
}
:global(.dark-theme .activity-page .timeline-detail-meta .timeline-detail-lane.distracting){
  color: #fb7185 !important;
  border-color: rgba(251, 113, 133, 0.22) !important;
  background: rgba(251, 113, 133, 0.12) !important;
}

/* Source badge */
:global(.dark-theme .activity-page .source-badge.combined){
  color: #2dd4bf !important;
  border-color: rgba(45, 212, 191, 0.2) !important;
  background: rgba(45, 212, 191, 0.08) !important;
}

/* Activity page headings */
:global(.dark-theme .activity-page h1),
:global(.dark-theme .activity-page h2),
:global(.dark-theme .activity-page h3),
:global(.dark-theme .activity-page .page-title),
:global(.dark-theme .activity-page .hero-title){
  color: var(--text-main) !important;
}

/* Hero story meta */
:global(.dark-theme .activity-page .hero-story-meta strong){
  color: #2dd4bf !important;
  border-color: rgba(45, 212, 191, 0.18) !important;
  background: rgba(45, 212, 191, 0.1) !important;
}

/* Event origin badges */
:global(.dark-theme .activity-page .event-origin.browser){
  color: #60a5fa !important;
  border-color: rgba(96, 165, 250, 0.2) !important;
  background: rgba(96, 165, 250, 0.08) !important;
}
:global(.dark-theme .activity-page .event-origin.task){
  color: #34d399 !important;
  border-color: rgba(52, 211, 153, 0.2) !important;
  background: rgba(52, 211, 153, 0.08) !important;
}
:global(.dark-theme .activity-page .event-origin.habit){
  color: #a78bfa !important;
  border-color: rgba(167, 139, 250, 0.2) !important;
  background: rgba(167, 139, 250, 0.08) !important;
}

/* RTT app color in dark mode */
:global(.dark-theme .rtt-app.browser){
  color: #60a5fa !important;
}
</style>
