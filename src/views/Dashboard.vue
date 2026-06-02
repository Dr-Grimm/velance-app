<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useVelanceStore } from '../store/velance.js'
import { useActivityTracker } from '../composables/useActivityTracker.js'
import { useAmbientTracker } from '../composables/useAmbientTracker.js'
import { primeFocusLaunch } from '../services/focusLaunchService.js'
import { formatLocalDateKey, getRecentLocalDateKeys } from '../services/dateKey.js'
import { canTrackWithSettings, hasResolvedTrackingConsent } from '../services/trackingConsent.js'
import { buildAnalyticsLocation } from '../services/analysisNavigation.js'
import { buildDashboardRecommendation, buildDashboardStatusNote } from '../services/dashboardGuidance.js'
import { getTrackingLaneMeta } from '../services/activityClassification.js'
import { buildBrowserEvidenceSummary } from '../services/browserEvidenceService.js'
import { getTodayChallengeTask, isVelanceChallengeTask } from '../services/dailyChallenge.js'
import {
  buildDashboardTrace,
  buildDashboardTraceRange,
  buildDashboardTraceSummary,
} from '../services/dashboardTrace.js'
import { ArrowRightIcon, CheckCircleIcon, CoffeeIcon, PlayIcon, SparklesIcon, TargetIcon, XIcon } from 'lucide-vue-next'

const router = useRouter()
const store = useVelanceStore()
const tracker = useActivityTracker()
const ambient = useAmbientTracker()

const now = ref(new Date())
const hoveredTracePointId = ref('')
const hoveredTraceGuideX = ref(null)
const traceZoomLevel = ref(1)
const TRACE_ZOOM_LEVELS = Object.freeze([1, 2, 4, 8, 12])
const showBreakModal = ref(false)
const breakDuration = ref(15)
const breakRemaining = ref(0)
const breakState = ref('idle')

let clockInterval = null
let breakInterval = null

onMounted(() => {
  void ambient.attachListener()
  void ambient.refreshToday()
  clockInterval = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (clockInterval) clearInterval(clockInterval)
  if (breakInterval) clearInterval(breakInterval)
})

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  if (hour < 21) return 'Good evening'
  return 'Good night'
})

const formattedDate = computed(() => now.value.toLocaleDateString('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
}))

const formattedTime = computed(() => now.value.toLocaleTimeString('en-US', {
  hour: '2-digit',
  minute: '2-digit',
}))

const todayKey = computed(() => formatLocalDateKey(now.value))
const recentWeekKeys = computed(() => new Set(getRecentLocalDateKeys(7, now.value)))

const focusIndex = computed(() => store.avgFocusToday)
const focusTrend = computed(() => {
  const values = store.focusTrendData
  const previous = values[values.length - 2] || 0
  const current = values[values.length - 1] || 0
  const diff = current - previous
  return { value: Math.abs(diff), direction: diff >= 0 ? 'up' : 'down' }
})

const dashboardTrace = computed(() => buildDashboardTrace({
  sessions: store.sessions,
  completedSession: tracker.completedSession.value,
  tracker: {
    startedAt: tracker.sessionMeta.value?.startedAt,
    timelineSegments: tracker.timelineSegments.value,
    elapsedSeconds: tracker.elapsedSeconds.value,
    focusScore: tracker.focusScore.value,
  },
  ambientEntries: ambient.getTodayTimeline(),
  browserEvents: ambient.getTodayBrowserEvents(),
  todayKey: todayKey.value,
}))

const traceSummary = computed(() => buildDashboardTraceSummary(dashboardTrace.value))
const baseTraceRange = computed(() => buildDashboardTraceRange(dashboardTrace.value, now.value))
const hasTimelineData = computed(() => dashboardTrace.value.groups.length > 0)
const DASHBOARD_TRACE_COLOR = '#14B8A6'
const DASHBOARD_TRACE_GLOW = 'rgba(20, 184, 166, 0.18)'
const TRACE_CHART = Object.freeze({
  width: 720,
  height: 188,
  left: 18,
  right: 18,
  top: 18,
  bottom: 36,
})
const traceRange = computed(() => {
  const base = baseTraceRange.value
  const zoom = Math.max(1, Number(traceZoomLevel.value || 1))
  if (zoom === 1) return base

  const baseMin = Number(base.min || Date.now())
  const baseMax = Math.max(baseMin + 1, Number(base.max || (baseMin + 1)))
  const baseSpan = Math.max(1, baseMax - baseMin)
  const targetSpan = Math.max(45 * 60 * 1000, Math.round(baseSpan / zoom))
  const hoveredTs = Number(activeTracePoint.value?.timestamp || 0)
  const blockStart = Number(activeTraceBlock.value?.startTs || 0)
  const blockEnd = Number(activeTraceBlock.value?.endTs || 0)
  const fallbackCenter = baseMin + Math.round(baseSpan / 2)
  const center = hoveredTs || (blockStart && blockEnd ? blockStart + Math.round((blockEnd - blockStart) / 2) : (blockStart || fallbackCenter))

  let min = Math.max(baseMin, center - Math.round(targetSpan / 2))
  let max = Math.min(baseMax, min + targetSpan)

  if ((max - min) < targetSpan) {
    min = Math.max(baseMin, max - targetSpan)
    max = Math.min(baseMax, min + targetSpan)
  }

  return { min, max }
})

const traceRangeSpan = computed(() => Math.max(1, Number(traceRange.value.max || 0) - Number(traceRange.value.min || 0)))
const traceWindowLabel = computed(() => `${formatTraceTime(traceRange.value.min)} - ${formatTraceTime(traceRange.value.max)}`)

function formatTraceTime(timestamp = 0) {
  if (!timestamp) return '--'
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(timestamp)).toLowerCase()
}

function cleanDashboardCopy(value = '') {
  const mojibakeDot = String.fromCharCode(0x00c2, 0x00b7)
  return String(value || '').replaceAll(mojibakeDot, '·')
}

function formatTraceAxisTime(timestamp = 0) {
  if (!timestamp) return '--'
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: traceRangeSpan.value <= (4 * 60 * 60 * 1000) ? '2-digit' : undefined,
    hour12: true,
  }).format(new Date(timestamp)).replace(/\s+/g, '').toLowerCase()
}

function normalizeDashboardCopy(value = '') {
  const mojibakeDot = String.fromCharCode(0x00c2, 0x00b7)
  const doubleMojibakeDot = String.fromCharCode(0x00c3, 0x201a, 0x00c2, 0x00b7)
  return String(value || '').replaceAll(doubleMojibakeDot, '·').replaceAll(mojibakeDot, '·')
}

function formatTraceMinutes(seconds = 0) {
  const totalMinutes = Math.max(1, Math.round(Number(seconds || 0) / 60))
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  }
  return `${totalMinutes}m`
}

function averageTraceScore(points = []) {
  if (!Array.isArray(points) || !points.length) return 0
  return Math.round(points.reduce((sum, point) => sum + Number(point?.y || 0), 0) / points.length)
}

function rangesOverlap(startA = 0, endA = 0, startB = 0, endB = 0, padding = 0) {
  const safePadding = Math.max(0, Number(padding || 0))
  const left = Math.max(Number(startA || 0) - safePadding, Number(startB || 0) - safePadding)
  const right = Math.min(Number(endA || 0) + safePadding, Number(endB || 0) + safePadding)
  return right >= left
}

function getTraceSegmentBounds(point = {}, previousEnd = null) {
  const minWidth = 10
  const rawStart = Number(point?.lineStartCx ?? point?.cx ?? 0)
  const rawEnd = Number(point?.lineEndCx ?? point?.cx ?? 0)
  let start = Math.min(rawStart, rawEnd)
  let end = Math.max(rawStart, rawEnd)

  if ((end - start) < minWidth) {
    const center = Number(point?.cx ?? ((start + end) / 2))
    start = center - (minWidth / 2)
    end = center + (minWidth / 2)
  }

  if (Number.isFinite(previousEnd) && start < previousEnd) {
    start = previousEnd
    end = Math.max(end, start + minWidth)
  }

  return { start, end }
}

function buildSmoothLinePath(points = []) {
  if (!points.length) return ''
  const first = points[0]
  const firstBounds = getTraceSegmentBounds(first)
  let path = `M ${firstBounds.start.toFixed(2)} ${first.cy.toFixed(2)} L ${firstBounds.end.toFixed(2)} ${first.cy.toFixed(2)}`
  let previousEnd = firstBounds.end

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const currentBounds = getTraceSegmentBounds(current, previousEnd)
    const gap = Math.max(0, currentBounds.start - previousEnd)

    if (gap > 1) {
      const curveInset = Math.min(14, gap / 2)
      const controlLeft = previousEnd + curveInset
      const controlRight = currentBounds.start - curveInset
      path += ` C ${controlLeft.toFixed(2)} ${previous.cy.toFixed(2)}, ${controlRight.toFixed(2)} ${current.cy.toFixed(2)}, ${currentBounds.start.toFixed(2)} ${current.cy.toFixed(2)}`
    } else {
      path += ` L ${previousEnd.toFixed(2)} ${current.cy.toFixed(2)}`
    }

    path += ` L ${currentBounds.end.toFixed(2)} ${current.cy.toFixed(2)}`
    previousEnd = currentBounds.end
  }

  return path
}

function buildAreaPath(points = []) {
  if (!points.length) return ''
  if (points.length === 1) {
    return ''
  }
  const line = buildSmoothLinePath(points)
  const last = points[points.length - 1]
  const first = points[0]
  const baseY = TRACE_CHART.height - TRACE_CHART.bottom
  return `${line} L ${last.cx.toFixed(2)} ${baseY.toFixed(2)} L ${first.cx.toFixed(2)} ${baseY.toFixed(2)} Z`
}

function buildTraceTickTimestamps(start, end) {
  const span = Math.max(1, end - start)
  let step = 4 * 60 * 60 * 1000
  if (span <= (90 * 60 * 60 * 1000)) step = 15 * 60 * 1000
  else if (span <= (3 * 60 * 60 * 1000)) step = 30 * 60 * 1000
  else if (span <= (6 * 60 * 60 * 1000)) step = 60 * 60 * 1000
  else if (span <= (12 * 60 * 60 * 1000)) step = 2 * 60 * 60 * 1000

  const first = Math.ceil(start / step) * step
  const ticks = []
  for (let timestamp = first; timestamp < end; timestamp += step) {
    ticks.push(timestamp)
  }

  if (!ticks.length || ticks[0] !== start) ticks.unshift(start)
  if (ticks[ticks.length - 1] !== end) ticks.push(end)
  return ticks
}

function buildVisibleTraceSourcePoints(data = [], start = 0, end = 0) {
  const sorted = [...data].sort((left, right) => Number(left?.x || 0) - Number(right?.x || 0))
  if (!sorted.length) return []

  const within = sorted.filter((point) => Number(point?.x || 0) >= start && Number(point?.x || 0) <= end)
  if (!within.length) {
    const nearest = sorted.reduce((best, point) => {
      const distance = Math.min(
        Math.abs(Number(point?.x || 0) - start),
        Math.abs(Number(point?.x || 0) - end),
      )
      if (!best || distance < best.distance) return { point, distance }
      return best
    }, null)?.point
    return nearest ? [{ ...nearest, x: Math.max(start, Math.min(end, Number(nearest.x || start))) }] : []
  }

  const result = []
  const firstVisible = within[0]
  const firstVisibleIndex = sorted.findIndex((point) => point === firstVisible)
  if (firstVisibleIndex > 0) {
    result.push({
      ...sorted[firstVisibleIndex - 1],
      x: start,
    })
  }

  result.push(...within)

  const lastVisible = within[within.length - 1]
  const lastVisibleIndex = sorted.findIndex((point) => point === lastVisible)
  if (lastVisibleIndex !== -1 && lastVisibleIndex < sorted.length - 1) {
    result.push({
      ...sorted[lastVisibleIndex + 1],
      x: end,
    })
  }

  return result
}

function compactTraceRenderPoints(points = []) {
  if (!Array.isArray(points) || points.length <= 2) return points

  const compacted = []
  const minGapPx = 20
  const maxYOffset = 14
  const overlapAllowance = 14

  points.forEach((point) => {
    const previous = compacted[compacted.length - 1]
    if (!previous) {
      compacted.push({ ...point })
      return
    }

    const previousLane = String(previous?.meta?.lane || previous?.tone || '')
    const pointLane = String(point?.meta?.lane || point?.tone || '')
    const closeX = Math.abs(Number(point?.cx || 0) - Number(previous?.cx || 0)) <= minGapPx
    const closeY = Math.abs(Number(point?.cy || 0) - Number(previous?.cy || 0)) <= maxYOffset
    const previousWidth = Math.max(0, Number(previous?.lineEndCx ?? previous?.cx ?? 0) - Number(previous?.lineStartCx ?? previous?.cx ?? 0))
    const pointWidth = Math.max(0, Number(point?.lineEndCx ?? point?.cx ?? 0) - Number(point?.lineStartCx ?? point?.cx ?? 0))
    const shortWindow = previousWidth <= 18 || pointWidth <= 18
    const overlappingWindow = Number(point?.lineStartCx ?? point?.cx ?? 0)
      <= (Number(previous?.lineEndCx ?? previous?.cx ?? 0) + overlapAllowance)

    if (previousLane === pointLane && overlappingWindow && (closeX || shortWindow) && closeY) {
      compacted[compacted.length - 1] = {
        ...point,
        lineStartCx: Math.min(
          Number(previous?.lineStartCx ?? previous?.cx ?? 0),
          Number(point?.lineStartCx ?? point?.cx ?? 0),
        ),
        lineEndCx: Math.max(
          Number(previous?.lineEndCx ?? previous?.cx ?? 0),
          Number(point?.lineEndCx ?? point?.cx ?? 0),
        ),
        meta: {
          ...(previous?.meta || {}),
          ...(point?.meta || {}),
          windowStart: Math.min(
            Number(previous?.meta?.windowStart || previous?.timestamp || 0),
            Number(point?.meta?.windowStart || point?.timestamp || 0),
          ),
          windowEnd: Math.max(
            Number(previous?.meta?.windowEnd || previous?.timestamp || 0),
            Number(point?.meta?.windowEnd || point?.timestamp || 0),
          ),
          trackedSeconds: Math.max(
            Number(previous?.meta?.trackedSeconds || 0),
            Number(point?.meta?.trackedSeconds || 0),
          ),
        },
      }
      return
    }

    compacted.push({ ...point })
  })

  return compacted
}

function stepTraceZoom(direction = 0) {
  const currentIndex = TRACE_ZOOM_LEVELS.findIndex((level) => level === traceZoomLevel.value)
  const safeIndex = currentIndex === -1 ? 0 : currentIndex
  const nextIndex = Math.max(0, Math.min(TRACE_ZOOM_LEVELS.length - 1, safeIndex + direction))
  traceZoomLevel.value = TRACE_ZOOM_LEVELS[nextIndex]
}

function handleTraceWheel(event) {
  if (!hasTimelineData.value) return
  if (event.deltaY < 0) stepTraceZoom(1)
  else if (event.deltaY > 0) stepTraceZoom(-1)
}

function handleTracePointerMove(event) {
  if (!tracePoints.value.length) return
  const rect = event.currentTarget.getBoundingClientRect()
  if (!rect.width) return
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  const targetX = TRACE_CHART.left + (ratio * tracePlotWidth.value)
  hoveredTraceGuideX.value = targetX

  const nearest = tracePoints.value.reduce((best, point) => {
    const distance = Math.abs(point.cx - targetX)
    if (!best || distance < best.distance) return { point, distance }
    return best
  }, null)?.point

  hoveredTracePointId.value = nearest?.id || ''
}

function clearTraceHover() {
  hoveredTracePointId.value = ''
  hoveredTraceGuideX.value = null
}

const traceTicks = computed(() => {
  const start = Number(traceRange.value.min || Date.now())
  const end = Math.max(start + 1, Number(traceRange.value.max || start + 1))
  const span = Math.max(1, end - start)
  const rawTicks = buildTraceTickTimestamps(start, end)
  const ticks = rawTicks.length > 5
    ? rawTicks.filter((_, index) => index === 0 || index === rawTicks.length - 1 || index % Math.ceil(rawTicks.length / 4) === 0)
    : rawTicks
  return ticks.map((timestamp, index) => ({
    id: `trace-tick-${index}`,
    left: `${(((timestamp - start) / span) * 100).toFixed(3)}%`,
    label: formatTraceAxisTime(timestamp),
  }))
})

const tracePlotWidth = computed(() => TRACE_CHART.width - TRACE_CHART.left - TRACE_CHART.right)
const tracePlotHeight = computed(() => TRACE_CHART.height - TRACE_CHART.top - TRACE_CHART.bottom)

const traceGroups = computed(() => {
  const start = Number(traceRange.value.min || Date.now())
  const end = Math.max(start + 1, Number(traceRange.value.max || start + 1))
  const span = Math.max(1, end - start)
  const mappedGroups = dashboardTrace.value.groups.map((group, index) => {
    const avgScore = averageTraceScore(group.data)

    let tone = group.tone || 'unclear'
    if (!group.tone) {
      if (group.kind === 'live') tone = 'productive'
      else if (avgScore >= 75) tone = 'productive'
      else if (avgScore >= 55) tone = 'supporting'
      else if (avgScore >= 32) tone = 'unclear'
      else tone = 'distracting'
    }
    const toneMeta = getTrackingLaneMeta(tone)

    const visiblePoints = buildVisibleTraceSourcePoints(group.data, start, end)
    const mappedPoints = visiblePoints.map((point) => {
      const safeX = Math.max(start, Math.min(end, Number(point.x || start)))
      const ratioX = (safeX - start) / span
      const safeScore = Number(point.y || 0)
      const cx = TRACE_CHART.left + (ratioX * tracePlotWidth.value)
      const cy = TRACE_CHART.top + ((1 - (safeScore / 100)) * tracePlotHeight.value)
      const rawWindowStart = Number(point?.meta?.windowStart || safeX)
      const rawWindowEnd = Number(point?.meta?.windowEnd || safeX)
      const boundedWindowStart = Math.max(start, Math.min(end, rawWindowStart))
      const boundedWindowEnd = Math.max(boundedWindowStart, Math.min(end, rawWindowEnd))
      const startRatio = (boundedWindowStart - start) / span
      const endRatio = (boundedWindowEnd - start) / span
      const windowStartCx = TRACE_CHART.left + (startRatio * tracePlotWidth.value)
      const windowEndCx = TRACE_CHART.left + (endRatio * tracePlotWidth.value)
      const fallbackHalfWidth = 18
      return {
        id: `${group.id}-point-${point.id || 'trace'}-${safeX}`,
        groupId: group.id,
        tone,
        toneMeta,
        timestamp: safeX,
        score: safeScore,
        timeLabel: formatTraceTime(safeX),
        meta: point.meta || {},
        cx,
        cy,
        lineStartCx: Math.max(TRACE_CHART.left, Math.min(cx - 4, windowStartCx || (cx - fallbackHalfWidth), cx - fallbackHalfWidth)),
        lineEndCx: Math.min(TRACE_CHART.width - TRACE_CHART.right, Math.max(cx + 4, windowEndCx || (cx + fallbackHalfWidth), cx + fallbackHalfWidth)),
      }
    })
    const compactedPoints = compactTraceRenderPoints(mappedPoints)
    const points = compactedPoints.map((point, pointIndex) => ({
      ...point,
      isEdge: pointIndex === 0 || pointIndex === compactedPoints.length - 1,
      showDot: compactedPoints.length <= 2 || pointIndex === 0 || pointIndex === compactedPoints.length - 1,
    }))

    return {
      ...group,
      index,
      avgScore,
      tone,
      toneMeta,
      points,
      linePath: buildSmoothLinePath(points),
      areaPath: buildAreaPath(points),
      timeLabel: `${formatTraceTime(group.startTs)} - ${formatTraceTime(group.endTs)}`,
      kindLabel: group.kindLabel || (group.kind === 'live' ? 'Live block' : group.kind === 'review' ? 'Review-ready block' : 'Tracked block'),
      pointsLabel: group.pointsLabel || `${group.pointCount} measured slice${group.pointCount === 1 ? '' : 's'}`,
    }
  })

  const ambientRanges = mappedGroups
    .filter((group) => group.kind === 'ambient')
    .map((group) => ({
      startTs: Number(group.startTs || 0),
      endTs: Number(group.endTs || 0),
    }))

  return mappedGroups.filter((group) => {
    if (group.kind === 'ambient') return true
    if (!ambientRanges.length) return true

    const overlapsAmbient = ambientRanges.some((ambientRange) => (
      rangesOverlap(group.startTs, group.endTs, ambientRange.startTs, ambientRange.endTs, 30 * 1000)
    ))

    return !overlapsAmbient
  })
})

const tracePoints = computed(() => traceGroups.value.flatMap((group) => group.points))

const activeTracePoint = computed(() => (
  tracePoints.value.find((point) => point.id === hoveredTracePointId.value)
  || tracePoints.value[tracePoints.value.length - 1]
  || null
))

const activeTraceGuideX = computed(() => hoveredTraceGuideX.value ?? activeTracePoint.value?.cx ?? null)

const activeTraceBlock = computed(() => (
  traceGroups.value.find((group) => group.id === activeTracePoint.value?.groupId)
  || traceGroups.value.find((group) => group.kind === 'live')
  || traceGroups.value[traceGroups.value.length - 1]
  || null
))

const activeTraceLaneMeta = computed(() => {
  const pointLane = activeTracePoint.value?.meta?.lane
  const blockLane = activeTraceBlock.value?.primaryLane || activeTraceBlock.value?.tone
  return getTrackingLaneMeta(pointLane || blockLane || 'unclear')
})

const activeTraceDetail = computed(() => {
  const point = activeTracePoint.value
  const block = activeTraceBlock.value
  if (!point || !block) return null

  const meta = point.meta || {}
  const laneMeta = getTrackingLaneMeta(meta.lane || block.primaryLane || block.tone || 'unclear')
  return {
    label: meta.app || block.label || block.kindLabel,
    windowLabel: `${formatTraceTime(meta.windowStart || block.startTs)} - ${formatTraceTime(meta.windowEnd || block.endTs)}`,
    laneLabel: laneMeta.label,
    laneColor: laneMeta.color,
    laneSoft: laneMeta.soft,
    chips: [
      { label: `${point.score}/100 activity`, tone: 'neutral' },
      { label: meta.trackedSeconds ? `${formatTraceMinutes(meta.trackedSeconds)} tracked` : block.pointsLabel, tone: 'neutral' },
      { label: laneMeta.label, tone: 'lane', color: laneMeta.color, soft: laneMeta.soft },
    ].filter(Boolean),
  }
})

const priorityRank = { High: 0, Normal: 1, Low: 2 }

const sortedActiveTasks = computed(() => {
  return [...store.activeTasks].sort((a, b) => {
    const aOverdue = a.due && a.due < todayKey.value ? 1 : 0
    const bOverdue = b.due && b.due < todayKey.value ? 1 : 0
    if (aOverdue !== bOverdue) return bOverdue - aOverdue
    const aToday = a.due === todayKey.value ? 1 : 0
    const bToday = b.due === todayKey.value ? 1 : 0
    if (aToday !== bToday) return bToday - aToday
    const aPriority = priorityRank[a.priority] ?? 99
    const bPriority = priorityRank[b.priority] ?? 99
    if (aPriority !== bPriority) return aPriority - bPriority
    return (a.createdAt || 0) - (b.createdAt || 0)
  })
})

const focusReadyTask = computed(() => sortedActiveTasks.value[0] || null)
const todayChallengeTask = computed(() => getTodayChallengeTask(store.tasks, todayKey.value))
const todayChallengeComplete = computed(() => String(todayChallengeTask.value?.status || '').toLowerCase() === 'completed')
const isDailyChallenge = (task) => isVelanceChallengeTask(task, todayKey.value)
const todayChallengeLabel = computed(() => {
  if (!todayChallengeTask.value) return 'No daily challenge accepted'
  if (todayChallengeComplete.value) return 'Challenge complete'
  if (String(todayChallengeTask.value.status || '').toLowerCase() === 'in-progress') return 'Challenge in motion'
  return 'Challenge waiting'
})
const upcomingTasks = computed(() => {
  const offset = focusReadyTask.value ? 1 : 0
  return sortedActiveTasks.value.slice(offset, offset + 4)
})
const overdueTasks = computed(() => sortedActiveTasks.value.filter((task) => task.due && task.due < todayKey.value))
const todaySessions = computed(() => store.sessions.filter((session) => session.date === todayKey.value))
const weeklySessions = computed(() => store.sessions.filter((session) => recentWeekKeys.value.has(session.date)).length)
const todayOutstandingTasks = computed(() => Math.max(0, store.todayTasks.length - store.completedToday))
const nextHabit = computed(() => {
  return store.habitCompletionStats.stats
    .filter((habit) => !habit.isOnTrack)
    .sort((left, right) => left.progress - right.progress)[0] || null
})

const dashboardStatusNote = computed(() => buildDashboardStatusNote({
  consentResolved: hasResolvedTrackingConsent(store.settings),
  trackingReady: canTrackWithSettings(store.settings),
  backendKind: store.backendStatus.kind,
}))

const todayBrowserEvidence = computed(() => buildBrowserEvidenceSummary({
  ambientEntries: ambient.getTodayTimeline(),
  browserEvents: ambient.getTodayBrowserEvents(),
  padMs: 0,
  limit: 3,
}))

const heroContext = computed(() => {
  const parts = []
  if (todayChallengeTask.value && !todayChallengeComplete.value) parts.push('daily challenge active')
  if (overdueTasks.value.length) parts.push(`${overdueTasks.value.length} overdue`)
  if (store.todayFocusMinutes) parts.push(`${store.todayFocusMinutes}m focused`)
  if (todaySessions.value.length) parts.push(`${todaySessions.value.length} tracked block${todaySessions.value.length === 1 ? '' : 's'}`)
  if (todayBrowserEvidence.value.totalEvents) parts.push(`${todayBrowserEvidence.value.pressureScore || 0}/100 browser pressure`)
  return parts.join(' · ') || 'Shape the day around one clear priority and one clean focus block.'
})

const shouldShowHeroNote = computed(() => dashboardStatusNote.value.tone !== 'good')

const peakHour = computed(() => {
  const best = store.getPeakHours(store.last30Days)
    .filter((entry) => entry.avg !== null)
    .reduce((currentBest, entry) => (entry.avg > currentBest.avg ? entry : currentBest), { hour: null, avg: -1 })
  return best.hour
})

const peakHourLabel = computed(() => {
  if (peakHour.value === null) return 'Next open window'
  if (peakHour.value === 0) return '12am'
  if (peakHour.value < 12) return `${peakHour.value}am`
  if (peakHour.value === 12) return '12pm'
  return `${peakHour.value - 12}pm`
})

const bestFocusDayLabel = computed(() => {
  if (!store.focusTrendData.some((value) => value > 0)) return 'No data'
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const bestIndex = store.last7Days.reduce((currentBest, day, index) => {
    return (store.focusTrendData[index] || 0) > (store.focusTrendData[currentBest] || 0) ? index : currentBest
  }, 0)
  return dayNames[new Date(store.last7Days[bestIndex]).getDay()]
})

const dashboardMetricCards = computed(() => {
  const taskPressureValue = overdueTasks.value.length > 0 ? String(overdueTasks.value.length) : (todayOutstandingTasks.value > 0 ? String(todayOutstandingTasks.value) : 'Clear')
  const taskPressureMeta = overdueTasks.value.length > 0
    ? `${overdueTasks.value.length} overdue · ${todayOutstandingTasks.value} still active`
    : todayOutstandingTasks.value > 0
      ? `${todayOutstandingTasks.value} due or in play today`
      : 'nothing pressing today'
  const fatigueMeter = store.currentFatigueRisk === 'High' ? 82 : store.currentFatigueRisk === 'Moderate' ? 56 : 24
  const browserLaneMeta = getTrackingLaneMeta(todayBrowserEvidence.value.dominantLane || 'unclear')

  return [
    {
      id: 'focus',
      label: 'Focus',
      value: String(focusIndex.value || 0),
      suffix: '/100',
      meta: `${focusTrend.value.direction === 'up' ? 'Rising' : 'Cooling'} ${focusTrend.value.value}% vs prior block`,
      rail: Math.max(8, Math.min(100, Number(focusIndex.value || 0))),
      tone: 'focus',
    },
    {
      id: 'pressure',
      label: 'Task pressure',
      value: taskPressureValue,
      suffix: overdueTasks.value.length > 0 ? ' overdue' : '',
      meta: taskPressureMeta,
      rail: Math.min(100, (overdueTasks.value.length * 22) + (todayOutstandingTasks.value * 11)),
      tone: overdueTasks.value.length > 0 ? 'pressure' : 'steady',
    },
    {
      id: 'fatigue',
      label: 'Fatigue',
      value: store.currentFatigueRisk,
      suffix: '',
      meta: 'session + background load',
      rail: fatigueMeter,
      tone: store.currentFatigueRisk === 'High' ? 'fatigue-high' : store.currentFatigueRisk === 'Moderate' ? 'fatigue-mid' : 'fatigue-low',
    },
    {
      id: 'browser',
      label: 'Browser lane',
      value: browserLaneMeta.label,
      suffix: '',
      meta: todayBrowserEvidence.value.totalEvents
        ? `${todayBrowserEvidence.value.pressureScore || 0}/100 pressure · ${todayBrowserEvidence.value.leadSiteLabel}`
        : 'No browser evidence saved today',
      rail: todayBrowserEvidence.value.totalEvents
        ? Math.max(10, Math.min(100, Number(todayBrowserEvidence.value.pressureScore || 0)))
        : 8,
      tone: todayBrowserEvidence.value.dominantLane === 'distracting'
        ? 'drift'
        : todayBrowserEvidence.value.dominantLane === 'productive'
          ? 'focus'
          : 'steady',
    },
  ]
})

const dashboardRecommendation = computed(() => buildDashboardRecommendation({
  isTracking: tracker.isTracking.value,
  hasCompletedReview: Boolean(tracker.completedSession.value),
  consentResolved: hasResolvedTrackingConsent(store.settings),
  trackingReady: canTrackWithSettings(store.settings),
  backendKind: store.backendStatus.kind,
  hasTasks: store.tasks.length > 0,
  hasHabits: store.habits.length > 0,
  hasSessions: store.sessions.length > 0,
  overdueCount: overdueTasks.value.length,
  currentFatigueRisk: store.currentFatigueRisk,
  todaySessionsCount: todaySessions.value.length,
  focusReadyTask: focusReadyTask.value,
  nextHabit: nextHabit.value,
  todayOutstandingTasks: todayOutstandingTasks.value,
  peakHour: peakHour.value,
  peakHourLabel: peakHourLabel.value,
  currentHour: now.value.getHours(),
}))

// One-click enable from the dashboard guidance card. This grants consent (and
// turns tracking on) so ambient background tracking starts immediately, instead
// of just routing the user to Settings to hunt for the toggle. Falls back to
// Settings if the verified save does not take.
const consentBusy = ref(false)
async function enableTrackingFromDashboard() {
  if (consentBusy.value) return
  consentBusy.value = true
  try {
    const granted = await store.setTrackingConsent(true)
    if (!granted) router.push('/settings')
  } catch (error) {
    console.warn('[Velance] Dashboard tracking enable failed:', error)
    router.push('/settings')
  } finally {
    consentBusy.value = false
  }
}

const handleDashboardCTA = () => {
  if (dashboardRecommendation.value.cta === 'Create First Task' || dashboardRecommendation.value.cta === 'Review Tasks') {
    router.push('/tasks')
    return
  }
  if (dashboardRecommendation.value.cta === 'Open Privacy' || dashboardRecommendation.value.cta === 'Open Settings') {
    void enableTrackingFromDashboard()
    return
  }
  if (dashboardRecommendation.value.cta === 'Set Break Timer') {
    openBreakTimer()
    return
  }
  if (dashboardRecommendation.value.cta === 'Open Habits') {
    router.push('/habits')
    return
  }
  if (dashboardRecommendation.value.cta === 'Open Analytics') {
    router.push(buildAnalyticsLocation({ dateKey: todayKey.value, tab: 'activity' }))
    return
  }
  if (dashboardRecommendation.value.cta === 'Review Session') {
    router.push('/focus')
    return
  }
  if (dashboardRecommendation.value.cta === 'Start Habit Focus' && nextHabit.value) {
    primeFocusLaunch({
      source: 'habit',
      title: '',
      habit: nextHabit.value.name,
      habitId: nextHabit.value.id || null,
      goal: nextHabit.value.name,
      taskId: null,
    })
    router.push('/focus')
    return
  }
  if (focusReadyTask.value) {
    const linkedHabit = focusReadyTask.value.habit ? store.habits.find((habit) => habit.name === focusReadyTask.value.habit) : null
    primeFocusLaunch({
      source: 'task',
      title: focusReadyTask.value.title,
      habit: focusReadyTask.value.habit || null,
      habitId: linkedHabit?.id || null,
      goal: focusReadyTask.value.title,
      taskId: focusReadyTask.value.id || null,
    })
    if (focusReadyTask.value.id && focusReadyTask.value.status === 'to-do') {
      void store.updateTask(focusReadyTask.value.id, { status: 'in-progress' })
    }
  }
  router.push('/focus')
}

const launchTaskFocus = (task) => {
  const linkedHabit = task.habit ? store.habits.find((habit) => habit.name === task.habit) : null
  primeFocusLaunch({
    source: 'task',
    title: task.title,
    habit: task.habit || null,
    habitId: linkedHabit?.id || null,
    goal: task.title,
    taskId: task.id || null,
  })
  if (task.id && task.status === 'to-do') void store.updateTask(task.id, { status: 'in-progress' })
  router.push('/focus')
}

const breakFmt = computed(() => {
  const mins = Math.floor(breakRemaining.value / 60).toString().padStart(2, '0')
  const secs = (breakRemaining.value % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
})

const BREAK_OPTS = [5, 10, 15, 20]

const openBreakTimer = () => {
  showBreakModal.value = true
  breakState.value = 'idle'
  breakRemaining.value = breakDuration.value * 60
}

const closeBreak = () => {
  showBreakModal.value = false
  breakState.value = 'idle'
  if (breakInterval) {
    clearInterval(breakInterval)
    breakInterval = null
  }
}

const playTone = (freq = 880, dur = 0.35) => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + dur)
  } catch {}
}

const startBreak = () => {
  breakState.value = 'running'
  breakRemaining.value = breakDuration.value * 60
  if (breakInterval) clearInterval(breakInterval)
  breakInterval = setInterval(() => {
    if (breakRemaining.value <= 1) {
      clearInterval(breakInterval)
      breakInterval = null
      breakState.value = 'done'
      playTone(660, 0.3)
      setTimeout(() => playTone(880, 0.3), 350)
      window.velance?.notify?.('Break Over', 'Your break is done. Time to focus again.')
    } else {
      breakRemaining.value--
    }
  }, 1000)
}

const resetBreak = () => {
  if (breakInterval) {
    clearInterval(breakInterval)
    breakInterval = null
  }
  breakState.value = 'idle'
  breakRemaining.value = breakDuration.value * 60
}
</script>

<template>
  <div class="dashboard-module">
    <section class="hero-card">
      <div class="hero-main">
        <span class="page-kicker">Daily cockpit</span>
        <h1 class="page-title">{{ greeting }}, {{ String(store.userProfile.name || 'there').split(' ')[0] }}.</h1>
        <p class="page-subtitle">{{ formattedDate }} · {{ formattedTime }}</p>
      </div>

      <div class="hero-panel">
        <span class="hero-panel-label">{{ dashboardRecommendation.label }}</span>
        <h3>{{ dashboardRecommendation.title }}</h3>
        <p>{{ dashboardRecommendation.text }}</p>
        <div class="hero-panel-actions">
          <button class="primary-action" :disabled="consentBusy" @click="handleDashboardCTA">
            {{ consentBusy ? 'Enabling...' : dashboardRecommendation.cta }}
            <ArrowRightIcon size="15" />
          </button>
          <button class="ghost-action" @click="router.push('/focus')">
            <PlayIcon size="15" /> Quick Focus
          </button>
        </div>
      </div>
    </section>

    <section class="metrics-grid">
      <article v-for="card in dashboardMetricCards" :key="card.id" class="metric-card" :class="`tone-${card.tone}`">
        <div class="metric-head">
          <span class="metric-label">{{ card.label }}</span>
          <span class="metric-glow"></span>
        </div>
        <strong class="metric-value">
          {{ card.value }}
          <small v-if="card.suffix">{{ card.suffix }}</small>
        </strong>
        <div class="metric-rail">
          <span class="metric-rail-fill" :style="{ width: `${card.rail}%` }"></span>
        </div>
        <span class="metric-meta">{{ normalizeDashboardCopy(card.meta) }}</span>
      </article>
    </section>

    <section v-if="todayChallengeTask" class="daily-challenge-banner" :class="{ complete: todayChallengeComplete }">
      <div class="challenge-badge-orb">
        <CheckCircleIcon v-if="todayChallengeComplete" size="20" />
        <TargetIcon v-else size="20" />
      </div>
      <div class="challenge-banner-copy">
        <span>{{ todayChallengeLabel }}</span>
        <h2>{{ todayChallengeTask.title }}</h2>
        <p>
          {{
            todayChallengeComplete
              ? 'That is a clean win. Let the finished challenge inform your next insight.'
              : 'Turn today into one measurable win. Start a focus block from this challenge and let Velance capture the evidence.'
          }}
        </p>
      </div>
      <div class="challenge-banner-actions">
        <button v-if="!todayChallengeComplete" class="primary-action" @click="launchTaskFocus(todayChallengeTask)">
          <PlayIcon size="15" /> Start Focus
        </button>
        <button class="ghost-action" @click="router.push('/tasks')">
          <SparklesIcon size="15" /> Open Challenge
        </button>
      </div>
    </section>

    <div class="dashboard-grid">
      <section class="surface-card timeline-card">
        <div class="section-header">
          <div>
            <span class="section-kicker">Focus trace</span>
            <h3>Today in motion</h3>
            <p class="section-support">{{ traceWindowLabel }}</p>
          </div>
          <span class="section-chip">{{ traceSummary.chipLabel }}</span>
        </div>

        <div class="chart-wrapper trace-wrapper">
          <template v-if="hasTimelineData">
            <div class="trace-shell trace-shell-line" @mouseleave="clearTraceHover" @wheel.prevent="handleTraceWheel">
              <svg
                class="trace-svg"
                :viewBox="`0 0 ${TRACE_CHART.width} ${TRACE_CHART.height}`"
                preserveAspectRatio="none"
                role="img"
                aria-label="Today's focus trace"
                @mousemove="handleTracePointerMove"
              >
                <defs>
                  <linearGradient id="dashboard-trace-strong" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="rgba(0, 180, 216, 0.92)" />
                    <stop offset="100%" stop-color="rgba(78, 205, 255, 0.62)" />
                  </linearGradient>
                  <linearGradient id="dashboard-trace-steady" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="rgba(99, 132, 255, 0.9)" />
                    <stop offset="100%" stop-color="rgba(120, 150, 255, 0.5)" />
                  </linearGradient>
                  <linearGradient id="dashboard-trace-soft" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="rgba(148, 163, 184, 0.82)" />
                    <stop offset="100%" stop-color="rgba(148, 163, 184, 0.38)" />
                  </linearGradient>
                  <linearGradient id="dashboard-trace-distracting" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="rgba(248, 113, 113, 0.92)" />
                    <stop offset="100%" stop-color="rgba(251, 146, 60, 0.58)" />
                  </linearGradient>
                </defs>

                <g class="trace-grid-svg">
                  <line
                    v-for="row in 4"
                    :key="`trace-row-${row}`"
                    :x1="TRACE_CHART.left"
                    :x2="TRACE_CHART.width - TRACE_CHART.right"
                    :y1="TRACE_CHART.top + ((tracePlotHeight / 4) * row)"
                    :y2="TRACE_CHART.top + ((tracePlotHeight / 4) * row)"
                    class="trace-grid-svg-line"
                  />
                </g>

                <line
                  v-if="activeTraceGuideX !== null"
                  class="trace-guide-line"
                  :style="{ stroke: activeTraceLaneMeta.color }"
                  :x1="activeTraceGuideX"
                  :x2="activeTraceGuideX"
                  :y1="TRACE_CHART.top"
                  :y2="TRACE_CHART.height - TRACE_CHART.bottom"
                />

                <g class="trace-series">
                  <g v-for="group in traceGroups" :key="group.id">
                    <path
                      :d="group.linePath"
                      class="trace-line"
                      :style="{
                        stroke: group.toneMeta.color,
                        filter: `drop-shadow(0 6px 12px ${group.toneMeta.accent})`,
                      }"
                    />
                  </g>
                </g>

                <g class="trace-points">
                  <g v-for="point in tracePoints" :key="point.id">
                    <circle
                      v-if="point.showDot || activeTracePoint?.id === point.id"
                      class="trace-point-dot"
                      :class="[{ active: activeTracePoint?.id === point.id, edge: point.isEdge }]"
                      :style="{
                        fill: point.toneMeta.color,
                        filter: activeTracePoint?.id === point.id ? `drop-shadow(0 0 14px ${point.toneMeta.accent})` : 'none',
                      }"
                      :cx="point.cx"
                      :cy="point.cy"
                      :r="activeTracePoint?.id === point.id ? 4.5 : 3.2"
                    />
                  </g>
                </g>
              </svg>

              <div class="trace-axis">
                <span v-for="tick in traceTicks" :key="tick.id" class="trace-tick" :style="{ left: tick.left }">{{ tick.label }}</span>
              </div>
            </div>

            <div
              v-if="activeTraceDetail"
              class="trace-detail"
              :style="{ '--trace-lane-color': activeTraceDetail.laneColor, '--trace-lane-soft': activeTraceDetail.laneSoft }"
            >
              <div>
                <span class="trace-detail-label">Activity focus</span>
                <strong>{{ activeTraceDetail.label }}</strong>
                <span class="trace-window-copy">{{ activeTraceDetail.windowLabel }}</span>
              </div>
              <div class="trace-detail-meta">
                <span
                  v-for="chip in activeTraceDetail.chips"
                  :key="chip.label"
                  :class="['trace-detail-chip', chip.tone]"
                  :style="chip.tone === 'lane' ? { '--chip-color': chip.color, '--chip-soft': chip.soft } : null"
                >
                  {{ chip.label }}
                </span>
              </div>
            </div>
          </template>

          <div v-else class="chart-empty-state">
            <p class="chart-empty-title">No trace yet</p>
            <p class="chart-empty-copy">Start one tracked focus block and the day rhythm will begin to form.</p>
          </div>
        </div>

        <div class="trace-footer">
          <span class="trace-count">{{ traceSummary.countLabel }}</span>
          <span class="trace-note">{{ traceSummary.helperText }}</span>
        </div>
      </section>

      <section class="surface-card task-card">
        <div class="section-header">
          <div>
            <span class="section-kicker">Next tasks</span>
            <h3>{{ focusReadyTask ? 'Ready to launch' : 'Quiet board' }}</h3>
            <p class="section-support">
              {{ focusReadyTask ? 'One strong launch plus the next clean handoffs from your board.' : 'Nothing urgent is pulling focus right now.' }}
            </p>
          </div>
          <button class="link-btn" @click="router.push('/tasks')">
            Open tasks <ArrowRightIcon size="14" />
          </button>
        </div>

        <div v-if="focusReadyTask" class="focus-ready">
          <div class="focus-ready-copy">
            <strong>{{ focusReadyTask.title }}</strong>
            <span>{{ focusReadyTask.habit || 'General work' }}</span>
            <div class="focus-ready-tags">
              <span class="focus-ready-tag">{{ focusReadyTask.priority || 'Normal' }} priority</span>
              <span
                v-if="focusReadyTask.due"
                class="focus-ready-tag"
                :class="{ overdue: focusReadyTask.due < todayKey, today: focusReadyTask.due === todayKey }"
              >
                {{ focusReadyTask.due === todayKey ? 'Due today' : focusReadyTask.due < todayKey ? 'Overdue' : focusReadyTask.due }}
              </span>
            </div>
          </div>
          <button class="mini-focus-btn" @click="launchTaskFocus(focusReadyTask)">
            <PlayIcon size="14" /> Focus
          </button>
        </div>

        <div class="quick-task-list">
          <button v-for="task in upcomingTasks" :key="task.id" class="quick-task" :class="{ challenge: isDailyChallenge(task) }" @click="router.push('/tasks')">
            <span class="qt-main">
              <span class="qt-dot" :class="String(task.priority || 'Normal').toLowerCase()"></span>
              <span class="qt-copy">
                <span class="qt-title">{{ task.title }}</span>
                <span class="qt-hint">{{ isDailyChallenge(task) ? 'Today challenge' : (task.habit || `${task.priority || 'Normal'} priority`) }}</span>
              </span>
            </span>
            <span class="qt-meta">
              <span class="qt-due" :class="{ today: task.due === todayKey, overdue: task.due && task.due < todayKey }">
                {{ task.due === todayKey ? 'Today' : task.due }}
              </span>
              <ArrowRightIcon size="13" />
            </span>
          </button>
          <div v-if="upcomingTasks.length === 0" class="empty-inline">
            {{ nextHabit ? `${nextHabit.name} is the next routine to protect.` : 'Nothing open right now.' }}
          </div>
        </div>
      </section>
    </div>

    <section class="summary-strip">
      <article class="summary-card">
        <span class="summary-label">Weekly focus</span>
        <strong>{{ weeklySessions ? store.weeklyAvgFocus : '--' }}<small v-if="weeklySessions">/100</small></strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Sessions</span>
        <strong>{{ weeklySessions }}</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Strongest day</span>
        <strong>{{ bestFocusDayLabel }}</strong>
      </article>
      <article class="summary-card">
        <span class="summary-label">Best hour</span>
        <strong>{{ peakHourLabel }}</strong>
      </article>
    </section>

    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showBreakModal" class="break-overlay" @click.self="closeBreak">
          <div class="break-modal">
            <button class="break-close" @click="closeBreak"><XIcon size="18" /></button>
            <div class="break-icon-wrap">
              <CoffeeIcon size="32" style="color:#00B4D8" />
            </div>
            <h2 class="break-title">{{ breakState === 'done' ? 'Break Complete' : 'Take a Break' }}</h2>
            <p v-if="breakState !== 'done'" class="break-sub">Step away for a moment. Velance will notify you when it is time to return.</p>
            <p v-else class="break-sub done-msg">Nice reset. Slide back into the next block when you are ready.</p>
            <div v-if="breakState !== 'idle' && breakState !== 'done'" class="break-countdown">{{ breakFmt }}</div>
            <div v-if="breakState === 'idle'" class="break-dur-pills">
              <button
                v-for="duration in BREAK_OPTS"
                :key="duration"
                class="break-dur-pill"
                :class="{ active: breakDuration === duration }"
                @click="breakDuration = duration; breakRemaining = duration * 60"
              >
                {{ duration }}m
              </button>
            </div>
            <div class="break-actions">
              <button v-if="breakState === 'idle'" class="primary-action" @click="startBreak">Start {{ breakDuration }}-min Break</button>
              <button v-if="breakState === 'running'" class="ghost-action" @click="resetBreak">Cancel</button>
              <button v-if="breakState === 'done'" class="primary-action" @click="closeBreak; router.push('/focus')">Start Focus</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.dashboard-module {
  padding: 28px 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1320px;
  margin: 0 auto;
  min-height: 100%;
}

.dashboard-module::-webkit-scrollbar {
  width: 4px;
}

.dashboard-module::-webkit-scrollbar-thumb {
  background: var(--border-light);
  border-radius: 999px;
}

.hero-card,
.metric-card,
.daily-challenge-banner,
.surface-card,
.summary-card,
.break-modal {
  background: radial-gradient(circle at top right, rgba(0, 180, 216, 0.08), transparent 34%), var(--bg-card);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-elevation);
}

.hero-card {
  border-radius: 28px;
  padding: 10px 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 272px;
  gap: 12px;
  animation: dashboardFadeUp 0.42s ease both;
}

.hero-main {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 2px 2px;
}

.hero-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: space-between;
}

.page-kicker,
.metric-label,
.section-kicker,
.summary-label,
.hero-panel-label,
.trace-detail-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--accent-base);
}

.page-title {
  font-size: clamp(2rem, 2.8vw, 2.7rem);
  line-height: 1.0;
  letter-spacing: -0.04em;
}

.page-subtitle,
.hero-panel p,
.metric-meta,
.chart-empty-copy,
.focus-ready-copy span,
.empty-inline,
.hero-context {
  color: var(--text-muted);
}

.page-subtitle,
.hero-context {
  font-size: 16px;
  line-height: 1.55;
}

.hero-panel p {
  font-size: 13px;
  line-height: 1.45;
}

.hero-context {
  max-width: 62ch;
}

.hero-note {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 100%;
  padding: 10px 13px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
}

.hero-note strong {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-main);
}

.hero-note span {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.hero-note.warn {
  border-color: rgba(245, 158, 11, 0.24);
}

.hero-note.blocked {
  border-color: rgba(239, 68, 68, 0.22);
}

.hero-note.info {
  border-color: rgba(0, 180, 216, 0.22);
}

.hero-panel {
  border-radius: 18px;
  padding: 10px 13px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-base) 11%, transparent),
    color-mix(in srgb, var(--accent-base) 3%, transparent)
  );
}

.hero-panel h3 {
  font-size: 1.05rem;
  letter-spacing: -0.03em;
}

.hero-panel-actions,
.section-header,
.focus-ready,
.quick-task,
.break-actions,
.break-dur-pills {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hero-panel-actions {
  flex-wrap: wrap;
  margin-top: 2px;
}

.hero-panel-actions .primary-action,
.hero-panel-actions .ghost-action {
  padding: 8px 12px;
}

.primary-action,
.ghost-action,
.mini-focus-btn,
.link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 13px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.primary-action {
  padding: 10px 14px;
  border: none;
  background: var(--accent-gradient);
  color: white;
  box-shadow: 0 14px 28px rgba(0, 180, 216, 0.2);
}

.ghost-action,
.mini-focus-btn {
  padding: 10px 14px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
}

.link-btn {
  border: none;
  background: transparent;
  color: var(--accent-base);
}

.primary-action:hover,
.ghost-action:hover,
.mini-focus-btn:hover,
.link-btn:hover {
  transform: translateY(-1px);
}

.metrics-grid,
.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.metric-card,
.summary-card {
  border-radius: 22px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  overflow: hidden;
  animation: dashboardFadeUp 0.5s ease both;
}

.metric-card::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 10%, rgba(255, 255, 255, 0.05) 50%, transparent 90%);
  opacity: 0;
  transform: translateX(-30%);
  transition: opacity 0.25s ease, transform 0.35s ease;
  pointer-events: none;
}

.metric-card:hover::before {
  opacity: 1;
  transform: translateX(0%);
}

.metric-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.metric-glow {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.24;
  box-shadow: 0 0 0 8px color-mix(in srgb, currentColor 12%, transparent);
}

.metric-value,
.summary-card strong {
  font-size: 1.72rem;
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--text-main);
}

.metric-value small,
.summary-card small {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.metric-rail {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: var(--surface-muted);
  overflow: hidden;
}

.metric-rail-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: currentColor;
  box-shadow: 0 6px 16px color-mix(in srgb, currentColor 22%, transparent);
}

.metric-card.tone-focus {
  color: #18b3db;
}

.metric-card.tone-pressure {
  color: #ff6a59;
}

.metric-card.tone-fatigue-high {
  color: #ef4444;
}

.metric-card.tone-fatigue-mid {
  color: #f59e0b;
}

.metric-card.tone-fatigue-low {
  color: #52b788;
}

.metric-card.tone-drift {
  color: #8b5cf6;
}

.metric-card.tone-steady {
  color: #6b7c93;
}

.daily-challenge-banner {
  position: relative;
  overflow: hidden;
  border-radius: 26px;
  padding: 18px 20px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  background:
    radial-gradient(circle at 8% 12%, color-mix(in srgb, var(--accent-base) 22%, transparent), transparent 32%),
    linear-gradient(90deg, color-mix(in srgb, var(--accent-base) 12%, transparent), transparent 48%),
    var(--bg-card);
  animation: dashboardFadeUp 0.58s ease both;
}

.daily-challenge-banner::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 16%, rgba(255, 255, 255, 0.16) 48%, transparent 78%);
  transform: translateX(-66%);
  animation: challengeBannerSweep 7s ease-in-out infinite;
  pointer-events: none;
}

.daily-challenge-banner.complete {
  background:
    radial-gradient(circle at 8% 12%, rgba(82, 183, 136, 0.22), transparent 32%),
    linear-gradient(90deg, rgba(82, 183, 136, 0.12), transparent 48%),
    var(--bg-card);
}

.challenge-badge-orb {
  position: relative;
  z-index: 1;
  width: 48px;
  height: 48px;
  border-radius: 17px;
  display: grid;
  place-items: center;
  color: white;
  background: var(--accent-gradient);
  box-shadow: 0 16px 30px var(--accent-glow);
  animation: challengeOrbPulse 4s ease-in-out infinite;
}

.challenge-banner-copy {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 5px;
  min-width: 0;
}

.challenge-banner-copy span {
  color: var(--accent-base);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.challenge-banner-copy h2 {
  color: var(--text-main);
  font-size: 22px;
  line-height: 1.1;
  letter-spacing: -0.035em;
}

.challenge-banner-copy p {
  max-width: 720px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.5;
}

.challenge-banner-actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  flex-wrap: wrap;
}

.quick-task.challenge {
  border-color: rgba(20, 184, 166, 0.28);
  background:
    linear-gradient(90deg, rgba(20, 184, 166, 0.08), transparent 34%),
    var(--surface-muted);
}

@keyframes challengeBannerSweep {
  0%, 55% { transform: translateX(-66%); opacity: 0; }
  72% { opacity: 1; }
  100% { transform: translateX(64%); opacity: 0; }
}

@keyframes challengeOrbPulse {
  0%, 100% { transform: translateY(0); box-shadow: 0 16px 30px var(--accent-glow); }
  50% { transform: translateY(-3px); box-shadow: 0 20px 38px var(--accent-glow); }
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.9fr);
  gap: 18px;
}

.surface-card {
  border-radius: 28px;
  padding: 18px;
  animation: dashboardFadeUp 0.56s ease both;
}

.section-header {
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
}

.section-header h3 {
  font-size: 1.08rem;
  letter-spacing: -0.03em;
}

.section-support {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.section-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.chart-wrapper {
  min-height: 214px;
}

@media (min-width: 1280px) {
  .hero-card {
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 14px;
    padding: 13px 18px;
  }

  .dashboard-grid {
    grid-template-columns: minmax(0, 1.25fr) minmax(360px, 0.9fr);
    gap: 20px;
  }

  .chart-wrapper {
    min-height: 238px;
  }

  .trace-shell {
    min-height: 226px;
  }
}

.trace-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trace-shell {
  position: relative;
  min-height: 210px;
  border-radius: 24px;
  padding: 16px 14px 12px;
  background:
    radial-gradient(circle at top center, rgba(0, 180, 216, 0.08), transparent 36%),
    var(--surface-muted);
  border: 1px solid var(--surface-outline);
}

.trace-grid {
  position: absolute;
  inset: 22px 16px 48px;
}

.trace-svg {
  display: block;
  width: 100%;
  height: 162px;
  overflow: visible;
}

.trace-grid-svg-line {
  stroke: color-mix(in srgb, var(--border-light) 70%, transparent);
  stroke-dasharray: 2 10;
  stroke-width: 1;
}

.trace-guide-line {
  opacity: 0.7;
  stroke-width: 1;
  stroke-dasharray: 3 7;
}

.trace-line {
  fill: none;
  stroke: var(--trace-series-color, var(--accent-base));
  stroke-opacity: 0.95;
  stroke-width: 4.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 6px 12px var(--trace-series-glow, rgba(20, 184, 166, 0.18)));
}

.trace-area {
  fill: url(#dashboard-trace-strong);
  opacity: 0.02;
}

.trace-series {
  isolation: isolate;
}

.trace-point-hit {
  fill: transparent;
  cursor: pointer;
}

.trace-point-dot {
  fill: var(--accent-base);
  opacity: 0.24;
  stroke: color-mix(in srgb, var(--bg-card) 92%, white);
  stroke-width: 2.4;
  transition: r 0.18s ease, filter 0.18s ease, opacity 0.18s ease;
}

.trace-point-dot.active {
  opacity: 1;
  filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent-base) 24%, transparent));
}

.trace-point-dot.edge:not(.active) {
  opacity: 0.16;
}

.trace-grid-line {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed color-mix(in srgb, var(--border-light) 72%, transparent);
}

.trace-axis {
  position: relative;
  height: 20px;
  margin-top: 8px;
}

.trace-tick {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  white-space: nowrap;
}

.trace-detail {
  --trace-lane-color: var(--accent-base);
  --trace-lane-soft: color-mix(in srgb, var(--accent-base) 12%, transparent);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 13px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--trace-lane-color) 14%, var(--surface-outline));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--trace-lane-soft) 42%, transparent), transparent 28%),
    color-mix(in srgb, var(--bg-card) 88%, transparent);
}

.trace-detail strong {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  font-weight: 800;
  color: var(--text-main);
}

.trace-window-copy {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.trace-detail-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.trace-detail-meta span {
  padding: 7px 10px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.trace-detail-chip.lane {
  --chip-color: var(--trace-lane-color);
  --chip-soft: var(--trace-lane-soft);
  background: color-mix(in srgb, var(--chip-soft) 84%, var(--bg-card));
  color: var(--chip-color);
}

.chart-empty-state {
  min-height: 220px;
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  gap: 8px;
  background: var(--surface-muted);
}

.chart-empty-title {
  font-size: 1rem;
  font-weight: 800;
}

.trace-footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--surface-outline);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.trace-count {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-main);
}

.trace-note {
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-muted);
  text-align: right;
}

.focus-ready {
  justify-content: space-between;
  padding: 12px 13px;
  border-radius: 18px;
  background: var(--surface-muted);
  margin-bottom: 10px;
}

.focus-ready-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.focus-ready-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 6px;
}

.focus-ready-tag {
  display: inline-flex;
  align-items: center;
  padding: 5px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-muted) 72%, transparent);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.focus-ready-tag.today {
  color: #f59e0b;
}

.focus-ready-tag.overdue {
  color: #ef4444;
}

.focus-ready-copy strong,
.qt-title {
  font-size: 14px;
  font-weight: 800;
}

.quick-task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-task {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--border-light);
  border-radius: 16px;
  padding: 9px 11px;
  background: var(--surface-muted);
  color: var(--text-main);
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease;
}

.quick-task:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 22%, var(--border-light));
}

.qt-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.qt-dot.high {
  background: #ef4444;
}

.qt-dot.normal {
  background: var(--accent-base);
}

.qt-dot.low {
  background: #52b788;
}

.qt-title {
  flex: 1;
  text-align: left;
}

.qt-main,
.qt-meta,
.qt-copy {
  display: flex;
  align-items: center;
}

.qt-main {
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.qt-copy {
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
}

.qt-hint {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.qt-meta {
  gap: 8px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.qt-due {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.qt-due.today {
  color: #f59e0b;
}

.qt-due.overdue {
  color: #ef4444;
}

.empty-inline {
  padding: 16px;
  border-radius: 16px;
  background: var(--surface-muted);
  text-align: center;
}

.break-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 14, 21, 0.38);
  backdrop-filter: blur(16px);
  display: grid;
  place-items: center;
  z-index: 1000;
}

.break-modal {
  width: min(460px, calc(100vw - 28px));
  border-radius: 28px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  text-align: center;
}

.break-close {
  align-self: flex-end;
  width: 34px;
  height: 34px;
  border-radius: 12px;
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  color: var(--text-muted);
  cursor: pointer;
}

.break-icon-wrap {
  width: 70px;
  height: 70px;
  border-radius: 22px;
  display: grid;
  place-items: center;
  background: rgba(0, 180, 216, 0.08);
}

.break-title {
  font-size: 2rem;
  letter-spacing: -0.05em;
}

.break-sub {
  color: var(--text-muted);
  line-height: 1.6;
}

.break-countdown {
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.06em;
}

.break-dur-pill {
  padding: 10px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.break-dur-pill.active {
  background: rgba(0, 180, 216, 0.12);
  color: var(--accent-base);
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: all 0.24s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@keyframes dashboardFadeUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes livePulse {
  0%,
  100% {
    box-shadow: 0 0 0 1px rgba(0, 180, 216, 0.14), 0 0 18px rgba(0, 180, 216, 0.18);
  }
  50% {
    box-shadow: 0 0 0 1px rgba(0, 180, 216, 0.18), 0 0 28px rgba(0, 180, 216, 0.28);
  }
}

@media (max-width: 1080px) {
  .hero-card,
  .daily-challenge-banner,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .challenge-banner-actions {
    justify-content: flex-start;
  }

  .metrics-grid,
  .summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .dashboard-module {
    padding: 24px 18px 32px;
  }

  .metrics-grid,
  .summary-strip {
    grid-template-columns: 1fr;
  }

  .hero-panel-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .trace-detail {
    flex-direction: column;
    align-items: flex-start;
  }

  .trace-detail-meta {
    justify-content: flex-start;
  }

  .trace-footer {
    flex-direction: column;
    align-items: flex-start;
  }

  .trace-note {
    text-align: left;
  }
}

/* ─── DARK THEME OVERRIDES ─────────────────────────────────────────────────── */

/* Metric card white shimmer — too bright in dark mode */
:global(.dark-theme .dashboard-module .metric-card::before){
  background: linear-gradient(115deg, transparent 10%, rgba(148, 163, 184, 0.04) 50%, transparent 90%) !important;
}

/* Challenge banner white shimmer */
:global(.dark-theme .dashboard-module .daily-challenge-banner::before){
  background: linear-gradient(115deg, transparent 16%, rgba(148, 163, 184, 0.06) 48%, transparent 78%) !important;
}

/* Metric card backgrounds in dark mode */
:global(.dark-theme .dashboard-module .metric-card),
:global(.dark-theme .dashboard-module .hero-card),
:global(.dark-theme .dashboard-module .surface-card),
:global(.dark-theme .dashboard-module .summary-card){
  background: radial-gradient(circle at top right, rgba(0, 180, 216, 0.06), transparent 34%), var(--bg-card) !important;
  border-color: var(--border-light) !important;
}

/* Hero-note tones in dark mode */
:global(.dark-theme .dashboard-module .hero-note.warn){
  border-color: rgba(251, 191, 36, 0.24) !important;
}
:global(.dark-theme .dashboard-module .hero-note.blocked){
  border-color: rgba(248, 113, 113, 0.22) !important;
}

/* Heading and title text */
:global(.dark-theme .dashboard-module .page-title),
:global(.dark-theme .dashboard-module h1),
:global(.dark-theme .dashboard-module h2),
:global(.dark-theme .dashboard-module h3){
  color: var(--text-main) !important;
}

/* Task section — secondary surfaces */
:global(.dark-theme .dashboard-module .focus-ready){
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(148,163,184,.12);
}

:global(.dark-theme .dashboard-module .quick-task){
  background: rgba(255,255,255,.04);
  border-color: rgba(148,163,184,.12);
}

:global(.dark-theme .dashboard-module .quick-task:hover){
  background: rgba(255,255,255,.07);
  border-color: rgba(0,180,216,.22);
}

:global(.dark-theme .dashboard-module .ghost-action),
:global(.dark-theme .dashboard-module .mini-focus-btn){
  background: rgba(255,255,255,.05);
  border-color: rgba(148,163,184,.16);
  color: var(--text-main);
}

:global(.dark-theme .dashboard-module .empty-inline){
  background: rgba(255,255,255,.03);
  color: var(--text-muted);
}

:global(.dark-theme .dashboard-module .section-chip){
  background: rgba(255,255,255,.04);
  border-color: rgba(148,163,184,.12);
}

/* Focus trace shell */
:global(.dark-theme .dashboard-module .trace-shell){
  background: rgba(255,255,255,.025);
  border-color: rgba(148,163,184,.14);
}

/* Break modal pills */
:global(.dark-theme .dashboard-module .break-dur-pill){
  background: rgba(255,255,255,.05);
  border-color: rgba(148,163,184,.14);
  color: var(--text-muted);
}

:global(.dark-theme .dashboard-module .break-close){
  background: rgba(255,255,255,.05);
  border-color: rgba(148,163,184,.14);
}
</style>
