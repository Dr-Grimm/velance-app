import { readonly, ref, watch } from 'vue'
import { classifyActivity, normalizeObservedAppName } from './useAmbientTracker.js'
import { useVelanceStore } from '../store/velance.js'
import { formatLocalDateKey } from '../services/dateKey.js'
import {
  computeSessionAggregateRates,
  deriveSessionMix,
  getDominantContextFromEntries,
} from '../services/sessionMetrics.js'
import {
  buildStoredSessionAnalysis,
  computeFatigueProfile,
  computeFocusProfile,
  computeInputIntensity,
  computeWeightedConfidence,
  deriveFocusDecay,
  FATIGUE_FORMULA_VERSION,
  FOCUS_FORMULA_VERSION,
  getFatigueRisk,
} from '../services/analysisEngine.js'

const SAMPLE_SECONDS = 2
const SLICE_SECONDS = 10
const IDLE_THRESHOLD_MS = 15000
const SELF_APP_PATTERN = /velance|electron/i
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const round = (value, digits = 0) => {
  const safe = Number.isFinite(value) ? value : 0
  const factor = 10 ** digits
  return Math.round(safe * factor) / factor
}
const average = (values = []) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0)
const percentage = (part = 0, total = 0) => (total > 0 ? Math.round((part / total) * 100) : 0)

function getDefaultClassification() {
  return {
    category: 'Unknown',
    subcategory: '',
    color: '#8E95A3',
    productive: null,
    confidence: 0,
    contextLabel: 'Unknown',
  }
}

function buildEmptyPillars() {
  return {
    presence: 0,
    activity: 0,
    continuity: 0,
    stability: 0,
  }
}

function buildEmptyFatigueDrivers() {
  return {
    durationLoad: 0,
    idleLoad: 0,
    switchLoad: 0,
    focusDecayLoad: 0,
  }
}

function buildEmptySessionSummary() {
  return {
    trackedSeconds: 0,
    observedSeconds: 0,
    observedRatio: 0,
    activeSeconds: 0,
    activeObservedSeconds: 0,
    activeRatio: 0,
    idleRatio: 0,
    averageKpm: 0,
    averageWpm: 0,
    totalKeystrokes: 0,
    totalMouseDistance: 0,
    totalMouseClicks: 0,
    totalScrollDelta: 0,
    mouseIntensity: 0,
    windowSwitchCount: 0,
    switchRate: 0,
    uniqueApps: 0,
    uniqueWindows: 0,
    bestFlowSeconds: 0,
    sampleCount: 0,
    dominantContext: null,
    focusScore: 0,
    fatigueScore: 0,
  }
}

function buildEmptyLatestSample() {
  return {
    timestamp: null,
    app: '',
    title: '',
    url: '',
    observed: false,
    idle: false,
    hasInput: false,
    keystrokes: 0,
    mouseDistance: 0,
    clicks: 0,
    scrollDelta: 0,
    newSwitches: 0,
    inputHookAvailable: false,
    windowHookAvailable: false,
  }
}

function isSelfContext(appName = '', title = '') {
  return SELF_APP_PATTERN.test(appName || '') || SELF_APP_PATTERN.test(title || '')
}

function normalizeClassification(appName = '', title = '', url = '') {
  if (!appName && !title && !url) return getDefaultClassification()
  if (isSelfContext(appName, title)) {
    return {
      category: 'System',
      subcategory: 'Velance',
      color: '#8E95A3',
      productive: null,
      confidence: 1,
      contextLabel: 'Velance',
    }
  }
  return classifyActivity(appName, title, url)
}

function getContextState(classification = getDefaultClassification()) {
  const lane = String(classification?.lane || '').trim().toLowerCase()
  if (lane === 'productive' || lane === 'supporting' || lane === 'unclear' || lane === 'distracting') return lane
  if (classification.productive === true) return 'productive'
  if (classification.productive === false) return 'distracting'
  return 'neutral'
}

function createLaneTotals() {
  return {
    productive: 0,
    supporting: 0,
    unclear: 0,
    distracting: 0,
  }
}

function getResolvedClassificationLane(classification = getDefaultClassification()) {
  const lane = String(classification?.lane || '').trim().toLowerCase()
  if (lane === 'productive' || lane === 'supporting' || lane === 'unclear' || lane === 'distracting') return lane
  if (classification.productive === true) return 'productive'
  if (classification.productive === false) return 'distracting'
  return 'unclear'
}

function getDominantBucketKey(totals = {}, fallback = '') {
  return Object.entries(totals || {})
    .sort((left, right) => Number(right?.[1] || 0) - Number(left?.[1] || 0))[0]?.[0] || fallback
}

function parseCategoryBucket(bucket = '', fallbackCategory = 'Other', fallbackSubcategory = '') {
  const [category = fallbackCategory, subcategory = fallbackSubcategory] = String(bucket || '').split('::')
  return {
    category: category || fallbackCategory,
    subcategory: subcategory || fallbackSubcategory,
  }
}

function getProductiveFlagFromLane(lane = 'unclear') {
  if (lane === 'productive' || lane === 'supporting') return true
  if (lane === 'distracting') return false
  return null
}

function trimWindowTitle(title = '') {
  const separators = [' - ', ' | ', ' - Google Chrome', ' - Microsoft Edge', ' - Mozilla Firefox']
  for (const separator of separators) {
    const [head] = String(title).split(separator)
    if (head?.trim()) return head.trim()
  }
  return String(title || '').trim()
}

function getLaneLabel(app = '', title = '', url = '', classification = getDefaultClassification()) {
  if (classification.contextLabel && classification.contextLabel !== 'Unknown') return classification.contextLabel
  if (url) return url
  if (trimWindowTitle(title)) return trimWindowTitle(title)
  return app || 'Unknown'
}

function buildTimelinePoint(slice) {
  return {
    t: slice.t,
    timestamp: slice.timestamp,
    score: slice.focusScore,
    fatigue: slice.fatigueScore,
    focusScore: slice.focusScore,
    fatigueScore: slice.fatigueScore,
    presence: slice.presence,
    activity: slice.activity,
    continuity: slice.continuity,
    stability: slice.stability,
    app: slice.app,
    title: slice.title,
    idle: slice.idle,
    typing: slice.typingPerMinute,
    switches: slice.switches,
  }
}

function createActivityTracker() {
  const store = useVelanceStore()
  const isTracking = ref(false)
  const isPaused = ref(false)
  const elapsedSeconds = ref(0)
  const focusScore = ref(0)
  const fatigueScore = ref(0)
  const fatigueRisk = ref('Low')
  const fatigueDrivers = ref(buildEmptyFatigueDrivers())
  const keystrokesPerMin = ref(0)
  const liveWpm = ref(0)
  const mouseIntensity = ref(0)
  const mouseClicks = ref(0)
  const scrollDelta = ref(0)
  const isIdle = ref(false)
  const idleSeconds = ref(0)
  const currentApp = ref('-')
  const currentTitle = ref('')
  const currentUrl = ref('')
  const currentClassification = ref(getDefaultClassification())
  const windowSwitchCount = ref(0)
  const deepWorkSeconds = ref(0)
  const bestFlowSeconds = ref(0)
  const focusPillars = ref(buildEmptyPillars())
  const focusQuality = ref({
    title: 'Ready',
    detail: 'Start a block to begin live focus tracking.',
    tone: 'neutral',
  })
  const liveAdvice = ref('Start a block to measure focus from real activity.')
  const recoveryCount = ref(0)
  const driftCount = ref(0)
  const productiveSeconds = ref(0)
  const supportingSeconds = ref(0)
  const unclearSeconds = ref(0)
  const distractingSeconds = ref(0)
  const telemetryStatus = ref({
    source: window.velance?.startTracking ? 'native' : 'browser',
    lastSampleAt: null,
    sampleCount: 0,
    needsWorkApp: false,
    hasWindowData: false,
    inputHookAvailable: Boolean(window.velance?.startTracking) && (store.settings.keystrokeEnabled || store.settings.mouseEnabled),
    windowHookAvailable: Boolean(window.velance?.startTracking),
  })
  const sessionMeta = ref({
    sessionId: null,
    goal: '',
    taskTitle: null,
    habit: null,
    linkedTaskId: null,
    linkedHabitId: null,
    durationGoal: 0,
    startedAt: null,
    sessionType: 'Focus',
    sessionMode: 'Observe',
  })
  const sessionSummary = ref(buildEmptySessionSummary())
  const completedSession = ref(null)
  const latestSample = ref(buildEmptyLatestSample())
  const sampleFeed = ref([])
  const appTimeline = ref([])
  const windowTimeline = ref([])
  const activityTimeline = ref([])
  const timelineSegments = ref([])
  const recentKeystrokes = ref([])
  const switchLog = ref([])
  const distractionEvents = ref([])
  const statusEvents = ref([])

  let timerInterval = null
  let scoreInterval = null
  let typingInterval = null
  let browserInterval = null
  let browserKeyHandler = null
  let browserMouseHandler = null
  let browserClickHandler = null
  let browserWheelHandler = null

  let totalKeystrokes = 0
  let totalMouseDistance = 0
  let totalMouseClicks = 0
  let totalScrollDelta = 0
  let currentIdleBurstActive = false
  let idleBurstCount = 0
  let idleBurstTimestamps = []
  let flowLocked = false
  let driftActive = false
  let lastCommittedSliceAt = 0
  let appUsageMap = new Map()
  let windowUsageMap = new Map()
  let sampleHistory = []
  let nextBreakReminderAt = 0
  let scheduledBreakIntervalSeconds = 0
  let sessionStartedAt = 0
  let totalPausedMs = 0
  let pausedAt = 0

  const focusModel = Object.freeze({
    formulaVersion: FOCUS_FORMULA_VERSION,
    fatigueFormulaVersion: FATIGUE_FORMULA_VERSION,
    mode: 'shared-analysis-engine',
  })

  function resetRuntime() {
    totalKeystrokes = 0
    totalMouseDistance = 0
    totalMouseClicks = 0
    totalScrollDelta = 0
    currentIdleBurstActive = false
    idleBurstCount = 0
    idleBurstTimestamps = []
    flowLocked = false
    driftActive = false
    lastCommittedSliceAt = 0
    appUsageMap = new Map()
    windowUsageMap = new Map()
    sampleHistory = []
    nextBreakReminderAt = 0
    scheduledBreakIntervalSeconds = 0
    sessionStartedAt = 0
    totalPausedMs = 0
    pausedAt = 0
  }

  function getTrackingBlockState() {
    if (!store.settings.trackingConsentGranted) {
      return {
        title: 'Consent required',
        detail: 'Grant local tracking consent before starting a focus session.',
        tone: 'warn',
        advice: 'Open Privacy settings and allow local tracking to begin a measured block.',
      }
    }

    if (!store.settings.trackingEnabled) {
      return {
        title: 'Tracking disabled',
        detail: 'Focus tracking is currently turned off in Privacy settings.',
        tone: 'warn',
        advice: 'Re-enable tracking in Privacy settings to start a measured block.',
      }
    }

    return null
  }

  function applyTrackingBlockState() {
    const blockedState = getTrackingBlockState()
    if (!blockedState) return false

    focusQuality.value = {
      title: blockedState.title,
      detail: blockedState.detail,
      tone: blockedState.tone,
    }
    liveAdvice.value = blockedState.advice
    telemetryStatus.value = {
      source: window.velance?.startTracking ? 'native' : 'browser',
      lastSampleAt: null,
      sampleCount: 0,
      needsWorkApp: false,
      hasWindowData: false,
      inputHookAvailable: Boolean(window.velance?.startTracking) && (store.settings.keystrokeEnabled || store.settings.mouseEnabled),
      windowHookAvailable: Boolean(window.velance?.startTracking),
    }
    return true
  }

  function shouldSendNotifications() {
    return Boolean(
      store.settings.trackingConsentGranted &&
      store.settings.trackingEnabled &&
      store.settings.notificationsEnabled,
    )
  }

  function syncBreakReminderSchedule() {
    const remindersEnabled = Boolean(
      store.settings.trackingConsentGranted &&
      store.settings.trackingEnabled &&
      store.settings.breakReminders &&
      store.settings.notificationsEnabled,
    )

    if (!remindersEnabled) {
      nextBreakReminderAt = 0
      scheduledBreakIntervalSeconds = 0
      return
    }

    const nextInterval = Math.max(30, Number(store.settings.breakIntervalMinutes || 90)) * 60
    if (!scheduledBreakIntervalSeconds) {
      scheduledBreakIntervalSeconds = nextInterval
      nextBreakReminderAt = nextInterval
      return
    }

    if (nextInterval !== scheduledBreakIntervalSeconds) {
      scheduledBreakIntervalSeconds = nextInterval
      nextBreakReminderAt = elapsedSeconds.value + nextInterval
    }
  }

  function refreshLiveTyping() {
    const cutoff = Date.now() - 60000
    recentKeystrokes.value = recentKeystrokes.value.filter((ts) => ts >= cutoff)
    keystrokesPerMin.value = recentKeystrokes.value.length
    liveWpm.value = Math.round(recentKeystrokes.value.length / 5)
  }

  function getRecentSamples(seconds) {
    if (!sampleHistory.length) return []
    const cutoff = Date.now() - (seconds * 1000)
    return sampleHistory.filter((sample) => sample.timestamp >= cutoff)
  }

  function getRecentObservedSamples(seconds) {
    return getRecentSamples(seconds).filter((sample) => sample.observed)
  }

  function countSwitches(samples) {
    return samples.reduce((sum, sample) => sum + (sample.newSwitches || 0), 0)
  }

  function getDominantLaneShare(samples) {
    const activeSamples = samples.filter((sample) => !sample.isIdle)
    if (!activeSamples.length) return 0

    const totals = new Map()
    let activeSeconds = 0

    activeSamples.forEach((sample) => {
      const seconds = sample.seconds || SAMPLE_SECONDS
      activeSeconds += seconds
      totals.set(sample.laneKey, (totals.get(sample.laneKey) || 0) + seconds)
    })

    const dominantSeconds = Math.max(0, ...totals.values())
    return activeSeconds > 0 ? dominantSeconds / activeSeconds : 0
  }

  function getFocusSnapshot() {
    const recent60 = getRecentObservedSamples(60)
    const recent120 = getRecentObservedSamples(120)
    const recent300 = getRecentObservedSamples(300)
    if (!recent120.length) {
      return {
        focusScore: 0,
        fatigueScore: 0,
        fatigueRisk: 'Low',
        pillars: buildEmptyPillars(),
        fatigueDrivers: buildEmptyFatigueDrivers(),
      }
    }
    const recentMix = deriveSessionMix(recent120)
    const activeRatio120 = recentMix.observedSeconds > 0
      ? recentMix.activeObservedSeconds / recentMix.observedSeconds
      : 0
    const observedRatio120 = Math.min(recentMix.observedSeconds / 120, 1)
    const keysLast60 = recent60.reduce((sum, sample) => sum + sample.keystrokes, 0)
    const mouseLast60 = recent60.reduce((sum, sample) => sum + sample.mouseDistance, 0)
    const clicksLast60 = recent60.reduce((sum, sample) => sum + sample.clicks, 0)
    const scrollLast60 = recent60.reduce((sum, sample) => sum + sample.scrollDelta, 0)
    const recentConfidence = computeWeightedConfidence(recent120, {
      secondsKey: 'seconds',
      confidenceKey: 'confidence',
      fallback: 0.72,
    })
    const inputIntensity = computeInputIntensity({
      keystrokes: keysLast60,
      mouseDistance: mouseLast60,
      clicks: clicksLast60,
      scrollDelta: scrollLast60,
    })
    const recentSwitches = countSwitches(recent300)
    const focusProfile = computeFocusProfile({
      totalSeconds: recentMix.observedSeconds || 120,
      productiveSeconds: recentMix.productiveSeconds,
      supportingSeconds: recentMix.supportingSeconds,
      unclearSeconds: recentMix.unclearSeconds,
      distractingSeconds: recentMix.distractingSeconds,
      activeRatio: activeRatio120,
      switches: recentSwitches,
      inputIntensity,
      weightedConfidence: recentConfidence,
      observedRatio: observedRatio120,
      sampleCount: recentMix.observedSampleCount,
    })

    const sessionMix = deriveSessionMix(sampleHistory)
    const allConfidence = computeWeightedConfidence(sampleHistory, {
      secondsKey: 'seconds',
      confidenceKey: 'confidence',
      fallback: recentConfidence,
    })
    const focusDecay = deriveFocusDecay([
      ...timelineSegments.value.map((segment) => segment.focusScore),
      focusProfile.focusScore,
    ])
    const idleRatioSession = elapsedSeconds.value > 0 ? idleSeconds.value / elapsedSeconds.value : 0
    const fatigueProfile = computeFatigueProfile({
      totalSeconds: elapsedSeconds.value || sessionMix.observedSeconds || 1,
      switches: windowSwitchCount.value,
      distractingSeconds: sessionMix.distractingSeconds,
      unclearSeconds: sessionMix.unclearSeconds,
      supportingSeconds: sessionMix.supportingSeconds,
      idleRatio: idleRatioSession,
      focusDecay,
      weightedConfidence: allConfidence,
      observedRatio: clamp(sessionMix.observedSeconds / Math.max(elapsedSeconds.value || 1, 1), 0, 1),
      activeRatio: elapsedSeconds.value > 0 ? (Math.max(0, elapsedSeconds.value - idleSeconds.value) / elapsedSeconds.value) : 0,
      sampleCount: sessionMix.observedSampleCount,
      chunkCount: timelineSegments.value.length,
    })

    return {
      focusScore: focusProfile.focusScore,
      fatigueScore: fatigueProfile.score,
      fatigueRisk: fatigueProfile.risk,
      pillars: focusProfile.pillars,
      fatigueDrivers: {
        durationLoad: fatigueProfile.durationLoad,
        idleLoad: fatigueProfile.idleLoad,
        switchLoad: fatigueProfile.switchLoad,
        focusDecayLoad: fatigueProfile.focusDecayLoad,
        distractionLoad: fatigueProfile.distractionLoad,
        ambiguityLoad: fatigueProfile.ambiguityLoad,
        supportingLoad: fatigueProfile.supportingLoad,
        lateLoad: fatigueProfile.lateLoad,
      },
    }
  }

  function syncAppTimeline() {
    const totalSeconds = Math.max(elapsedSeconds.value, 1)
    appTimeline.value = [...appUsageMap.values()]
      .map((entry) => {
        const dominantLane = getDominantBucketKey(entry.laneTotals, getResolvedClassificationLane(entry))
        const dominantCategoryBucket = getDominantBucketKey(entry.categoryTotals, `${entry.category || 'Other'}::${entry.subcategory || ''}`)
        const dominantCategory = parseCategoryBucket(
          dominantCategoryBucket,
          entry.category || 'Other',
          entry.subcategory || '',
        )
        return {
          app: entry.app,
          appName: entry.app,
          seconds: entry.seconds,
          share: round(entry.seconds / totalSeconds, 4),
          keystrokes: entry.keystrokes,
          clicks: entry.clicks,
          scrollDelta: entry.scrollDelta,
          mouseDistance: Math.round(entry.mouseDistance),
          inputSeconds: entry.inputSeconds,
          activeRatio: percentage(entry.inputSeconds, entry.seconds),
          category: dominantCategory.category,
          subcategory: dominantCategory.subcategory,
          dominantLane,
          laneTotals: { ...entry.laneTotals },
          productive: getProductiveFlagFromLane(dominantLane),
          confidence: entry.confidence,
          color: entry.categoryColors?.[dominantCategoryBucket] || entry.color,
          contextLabel: getDominantBucketKey(entry.contextTotals, entry.app),
        }
      })
      .sort((a, b) => b.seconds - a.seconds)
  }

  function syncWindowTimeline() {
    const totalSeconds = Math.max(elapsedSeconds.value, 1)
    windowTimeline.value = [...windowUsageMap.values()]
      .map((entry) => {
        const dominantLane = getDominantBucketKey(entry.laneTotals, getResolvedClassificationLane(entry))
        const dominantCategoryBucket = getDominantBucketKey(entry.categoryTotals, `${entry.category || 'Other'}::${entry.subcategory || ''}`)
        const dominantCategory = parseCategoryBucket(
          dominantCategoryBucket,
          entry.category || 'Other',
          entry.subcategory || '',
        )
        return {
          app: entry.app,
          title: entry.title,
          browserUrl: entry.browserUrl,
          seconds: entry.seconds,
          share: round(entry.seconds / totalSeconds, 4),
          keystrokes: entry.keystrokes,
          clicks: entry.clicks,
          scrollDelta: entry.scrollDelta,
          mouseDistance: Math.round(entry.mouseDistance),
          inputSeconds: entry.inputSeconds,
          activeRatio: percentage(entry.inputSeconds, entry.seconds),
          category: dominantCategory.category,
          subcategory: dominantCategory.subcategory,
          dominantLane,
          laneTotals: { ...entry.laneTotals },
          productive: getProductiveFlagFromLane(dominantLane),
          confidence: entry.confidence,
          color: entry.categoryColors?.[dominantCategoryBucket] || entry.color,
        }
      })
      .sort((a, b) => b.seconds - a.seconds)
  }

  function refreshSessionSummary() {
    const activeSeconds = Math.max(0, elapsedSeconds.value - idleSeconds.value)
    const sessionMix = deriveSessionMix(sampleHistory)
    const aggregateRates = computeSessionAggregateRates({
      totalKeystrokes,
      totalMouseDistance,
      totalMouseClicks,
      totalScrollDelta,
      observedSeconds: sessionMix.observedSeconds,
      observedSampleCount: sessionMix.observedSampleCount,
    })
    const dominantContextEntry = getDominantContextFromEntries(windowTimeline.value)
      || getDominantContextFromEntries(appTimeline.value)
    const dominantContext = dominantContextEntry?.title || dominantContextEntry?.app || null
    const switchRate = round(windowSwitchCount.value / Math.max(elapsedSeconds.value / 60, 1), 1)
    const averageSliceFocus = timelineSegments.value.length
      ? Math.round(average(timelineSegments.value.map((segment) => segment.focusScore)))
      : focusScore.value
    const averageSliceFatigue = timelineSegments.value.length
      ? Math.round(average(timelineSegments.value.map((segment) => segment.fatigueScore)))
      : fatigueScore.value

    productiveSeconds.value = sessionMix.productiveSeconds
    supportingSeconds.value = sessionMix.supportingSeconds
    distractingSeconds.value = sessionMix.distractingSeconds
    unclearSeconds.value = sessionMix.unclearSeconds

    sessionSummary.value = {
      trackedSeconds: elapsedSeconds.value,
      observedSeconds: sessionMix.observedSeconds,
      observedRatio: percentage(sessionMix.observedSeconds, elapsedSeconds.value),
      activeSeconds,
      activeObservedSeconds: sessionMix.activeObservedSeconds,
      activeRatio: percentage(activeSeconds, elapsedSeconds.value),
      idleRatio: percentage(idleSeconds.value, elapsedSeconds.value),
      averageKpm: aggregateRates.averageKpm,
      averageWpm: aggregateRates.averageWpm,
      totalKeystrokes,
      totalMouseDistance: aggregateRates.totalMouseDistance,
      totalMouseClicks: aggregateRates.totalMouseClicks,
      totalScrollDelta: aggregateRates.totalScrollDelta,
      mouseIntensity: aggregateRates.mouseIntensity,
      windowSwitchCount: windowSwitchCount.value,
      switchRate,
      uniqueApps: appTimeline.value.length,
      uniqueWindows: windowTimeline.value.length,
      bestFlowSeconds: bestFlowSeconds.value,
      sampleCount: sessionMix.observedSampleCount,
      dominantContext,
      focusScore: averageSliceFocus,
      fatigueScore: averageSliceFatigue,
    }
  }

  function updateLiveNarrative(snapshot) {
    const waitingForApp = telemetryStatus.value.needsWorkApp || !telemetryStatus.value.hasWindowData
    if (waitingForApp) {
      focusQuality.value = {
        title: 'Waiting',
        detail: 'Move into the real work app and the session will settle.',
        tone: 'neutral',
      }
      liveAdvice.value = 'Keep Velance in the background while you work in the actual app.'
      return
    }

    if (snapshot.focusScore >= 80 && snapshot.fatigueScore < 50) {
      focusQuality.value = {
        title: 'Locked in',
        detail: 'Stable focus, low drift, and clean continuity.',
        tone: 'good',
      }
      liveAdvice.value = 'Stay in this lane and avoid unnecessary switching.'
      return
    }

    if (snapshot.fatigueScore >= 65) {
      focusQuality.value = {
        title: 'Pressure rising',
        detail: 'The session still has signal, but fatigue is climbing.',
        tone: 'warn',
      }
      liveAdvice.value = 'Finish the current fragment cleanly or reset briefly before continuing.'
      return
    }

    if (snapshot.focusScore >= 62) {
      focusQuality.value = {
        title: 'Settling',
        detail: 'The session is tracking well and still stabilizing.',
        tone: 'steady',
      }
      liveAdvice.value = 'Keep the block narrow and let the score compound.'
      return
    }

    focusQuality.value = {
      title: 'Warming up',
      detail: 'Real tracking is active, but the lane is still noisy.',
      tone: 'neutral',
    }
    liveAdvice.value = 'Reduce hopping and make the next action visible.'
  }

  function recordSlice(force = false) {
    if (!isTracking.value && !force) return
    if (!force && elapsedSeconds.value - lastCommittedSliceAt < SLICE_SECONDS) return

    const snapshot = getFocusSnapshot()
    focusScore.value = snapshot.focusScore
    fatigueScore.value = snapshot.fatigueScore
    fatigueRisk.value = snapshot.fatigueRisk
    focusPillars.value = snapshot.pillars
    fatigueDrivers.value = snapshot.fatigueDrivers

    if (!sampleHistory.some((sample) => sample.observed)) {
      refreshSessionSummary()
      updateLiveNarrative(snapshot)
      return
    }

    const slice = {
      id: `slice-${Date.now()}-${timelineSegments.value.length + 1}`,
      t: elapsedSeconds.value,
      timestamp: Date.now(),
      focusScore: snapshot.focusScore,
      fatigueScore: snapshot.fatigueScore,
      score: snapshot.focusScore,
      fatigue: snapshot.fatigueScore,
      presence: snapshot.pillars.presence,
      activity: snapshot.pillars.activity,
      continuity: snapshot.pillars.continuity,
      stability: snapshot.pillars.stability,
      app: currentApp.value,
      title: currentTitle.value,
      idle: isIdle.value,
      typingPerMinute: keystrokesPerMin.value,
      switches: windowSwitchCount.value,
    }

    timelineSegments.value = [...timelineSegments.value, slice]
    activityTimeline.value = timelineSegments.value.map(buildTimelinePoint)
    lastCommittedSliceAt = elapsedSeconds.value

    if (snapshot.focusScore >= 75 && snapshot.pillars.continuity >= 65 && snapshot.pillars.presence >= 70) {
      deepWorkSeconds.value += SLICE_SECONDS
      bestFlowSeconds.value = Math.max(bestFlowSeconds.value, deepWorkSeconds.value)
      if (!flowLocked && bestFlowSeconds.value >= 300) {
        flowLocked = true
        statusEvents.value = [
          ...statusEvents.value,
          {
            id: `flow-${Date.now()}`,
            type: 'flow',
            headline: 'Flow established',
            detail: 'The session has settled into a stable working lane.',
            t: elapsedSeconds.value,
            ts: Date.now(),
          },
        ].slice(-18)
      }
    } else {
      deepWorkSeconds.value = 0
    }

    if (!driftActive && timelineSegments.value.length > 1 && snapshot.focusScore < 58) {
      driftActive = true
      driftCount.value += 1
      statusEvents.value = [
        ...statusEvents.value,
        {
          id: `drift-${Date.now()}`,
          type: 'drift',
          headline: 'Drift detected',
          detail: 'Switching or idle drag is fragmenting the block.',
          t: elapsedSeconds.value,
          ts: Date.now(),
        },
      ].slice(-18)
    } else if (driftActive && snapshot.focusScore >= 72) {
      driftActive = false
      recoveryCount.value += 1
      statusEvents.value = [
        ...statusEvents.value,
        {
          id: `recovery-${Date.now()}`,
          type: 'recovery',
          headline: 'Recovered',
          detail: 'The session returned to a cleaner focus lane.',
          t: elapsedSeconds.value,
          ts: Date.now(),
        },
      ].slice(-18)
    }

    refreshSessionSummary()
    updateLiveNarrative(snapshot)
  }

  function updateLiveScoresOnly() {
    if (!isTracking.value) return
    const snapshot = getFocusSnapshot()
    focusScore.value = snapshot.focusScore
    fatigueScore.value = snapshot.fatigueScore
    fatigueRisk.value = snapshot.fatigueRisk
    focusPillars.value = snapshot.pillars
    fatigueDrivers.value = snapshot.fatigueDrivers
    refreshSessionSummary()
    updateLiveNarrative(snapshot)
  }

  function handleTrackingSample(data = {}) {
    if (!isTracking.value || isPaused.value) return

    const timestamp = Date.now()
    const seconds = SAMPLE_SECONDS
    const usingNativeTracking = Boolean(window.velance?.startTracking)
    const app = normalizeObservedAppName(data.activeApp || '')
    const title = data.activeTitle || ''
    const url = data.activeUrl || ''
    const isSelfWindow = usingNativeTracking ? isSelfContext(app, title) : false
    const hasNamedApp = Boolean(app && app !== 'Unknown')
    const hasObservedApp = hasNamedApp && !isSelfWindow
    const classification = hasObservedApp ? normalizeClassification(app, title, url) : getDefaultClassification()
    const laneLabel = getLaneLabel(app, title, url, classification)
    const laneKey = `${app || 'Unknown'}::${laneLabel}`
    const keystrokes = store.settings.keystrokeEnabled ? Math.max(0, data.keystrokesInWindow || 0) : 0
    const mouseDistance = store.settings.mouseEnabled ? Math.max(0, data.mouseDistanceInWindow || 0) : 0
    const clicks = store.settings.mouseEnabled ? Math.max(0, data.mouseClicks || 0) : 0
    const scroll = store.settings.mouseEnabled ? Math.max(0, Math.abs(data.scrollDelta || 0)) : 0
    const latestSwitchCount = Math.max(0, data.windowSwitches || 0)
    const newSwitches = Math.max(0, latestSwitchCount - windowSwitchCount.value)
    const hasInput = keystrokes > 0 || mouseDistance > 0 || clicks > 0 || scroll > 0

    latestSample.value = {
      timestamp,
      app,
      title,
      url,
      observed: hasObservedApp,
      idle: Boolean(data.isIdle),
      hasInput,
      keystrokes,
      mouseDistance,
      clicks,
      scrollDelta: scroll,
      newSwitches,
      inputHookAvailable: data.inputHookAvailable ?? telemetryStatus.value.inputHookAvailable,
      windowHookAvailable: data.windowHookAvailable ?? telemetryStatus.value.windowHookAvailable,
    }

    telemetryStatus.value = {
      source: usingNativeTracking ? 'native' : 'browser',
      lastSampleAt: timestamp,
      sampleCount: telemetryStatus.value.sampleCount + 1,
      needsWorkApp: !hasObservedApp,
      hasWindowData: appUsageMap.size > 0 || hasObservedApp,
      inputHookAvailable: data.inputHookAvailable ?? telemetryStatus.value.inputHookAvailable,
      windowHookAvailable: data.windowHookAvailable ?? telemetryStatus.value.windowHookAvailable,
    }

    if (hasObservedApp) {
      currentApp.value = app
      currentTitle.value = title || laneLabel || app
      currentUrl.value = url || ''
      currentClassification.value = classification
    } else if (!appUsageMap.size) {
      currentApp.value = usingNativeTracking ? '-' : (app || 'Browser fallback')
      currentTitle.value = ''
      currentUrl.value = ''
      currentClassification.value = getDefaultClassification()
    }
    isIdle.value = Boolean(data.isIdle)

    if (data.windowSwitchLog && data.windowSwitchLog.length > switchLog.value.length) {
      switchLog.value = [...data.windowSwitchLog]
    }
    windowSwitchCount.value = latestSwitchCount

    if (isIdle.value) {
      idleSeconds.value += seconds
      if (!currentIdleBurstActive) {
        currentIdleBurstActive = true
        idleBurstCount += 1
        idleBurstTimestamps.push(timestamp)
      }
    } else {
      currentIdleBurstActive = false
    }

    if (hasObservedApp) {
      totalKeystrokes += keystrokes
      totalMouseDistance += mouseDistance
      totalMouseClicks += clicks
      totalScrollDelta += scroll
    }

    mouseClicks.value = totalMouseClicks
    scrollDelta.value = totalScrollDelta
    mouseIntensity.value = Math.round(Math.min(mouseDistance / 300, 1) * 100)

    if (hasObservedApp) {
      sampleFeed.value = [
        {
          id: `sample-${timestamp}`,
          timestamp,
          durationSeconds: seconds,
          app,
          title: title || laneLabel || app,
          url,
          keystrokes,
          mouseDistance,
          clicks,
          scrollDelta: scroll,
          isIdle: isIdle.value,
          newSwitches,
        },
        ...sampleFeed.value,
      ].slice(0, 60)

      const appKey = app
      const windowKey = `${appKey}::${title || ''}::${url || ''}`
      const resolvedLane = getResolvedClassificationLane(classification)
      const categoryBucket = `${classification.category || 'Other'}::${classification.subcategory || ''}`

      const appEntry = appUsageMap.get(appKey) || {
        app: appKey,
        seconds: 0,
        keystrokes: 0,
        clicks: 0,
        scrollDelta: 0,
        mouseDistance: 0,
        inputSeconds: 0,
        category: classification.category,
        subcategory: classification.subcategory,
        productive: classification.productive,
        confidence: classification.confidence ?? 0,
        color: classification.color || '#8E95A3',
        lane: resolvedLane,
        laneTotals: createLaneTotals(),
        categoryTotals: {},
        categoryColors: {},
        contextTotals: {},
      }
      appEntry.seconds += seconds
      appEntry.keystrokes += keystrokes
      appEntry.clicks += clicks
      appEntry.scrollDelta += scroll
      appEntry.mouseDistance += mouseDistance
      if (hasInput) appEntry.inputSeconds += seconds
      appEntry.category = classification.category
      appEntry.subcategory = classification.subcategory
      appEntry.productive = classification.productive
      appEntry.confidence = classification.confidence ?? 0
      appEntry.color = classification.color || '#8E95A3'
      appEntry.lane = resolvedLane
      appEntry.laneTotals[resolvedLane] = (appEntry.laneTotals[resolvedLane] || 0) + seconds
      appEntry.categoryTotals[categoryBucket] = (appEntry.categoryTotals[categoryBucket] || 0) + seconds
      appEntry.categoryColors[categoryBucket] = classification.color || '#8E95A3'
      appEntry.contextTotals[laneLabel || title || appKey] = (appEntry.contextTotals[laneLabel || title || appKey] || 0) + seconds
      appUsageMap.set(appKey, appEntry)

      const windowEntry = windowUsageMap.get(windowKey) || {
        app: appKey,
        title: title || laneLabel || appKey,
        browserUrl: url || '',
        seconds: 0,
        keystrokes: 0,
        clicks: 0,
        scrollDelta: 0,
        mouseDistance: 0,
        inputSeconds: 0,
        category: classification.category,
        subcategory: classification.subcategory,
        productive: classification.productive,
        confidence: classification.confidence ?? 0,
        color: classification.color || '#8E95A3',
        lane: resolvedLane,
        laneTotals: createLaneTotals(),
        categoryTotals: {},
        categoryColors: {},
      }
      windowEntry.seconds += seconds
      windowEntry.keystrokes += keystrokes
      windowEntry.clicks += clicks
      windowEntry.scrollDelta += scroll
      windowEntry.mouseDistance += mouseDistance
      if (hasInput) windowEntry.inputSeconds += seconds
      windowEntry.category = classification.category
      windowEntry.subcategory = classification.subcategory
      windowEntry.productive = classification.productive
      windowEntry.confidence = classification.confidence ?? 0
      windowEntry.color = classification.color || '#8E95A3'
      windowEntry.lane = resolvedLane
      windowEntry.laneTotals[resolvedLane] = (windowEntry.laneTotals[resolvedLane] || 0) + seconds
      windowEntry.categoryTotals[categoryBucket] = (windowEntry.categoryTotals[categoryBucket] || 0) + seconds
      windowEntry.categoryColors[categoryBucket] = classification.color || '#8E95A3'
      windowUsageMap.set(windowKey, windowEntry)
    }

    sampleHistory.push({
      timestamp,
      seconds,
      laneKey,
      lane: getResolvedClassificationLane(classification),
      app,
      title,
      observed: hasObservedApp,
      hasInput,
      keystrokes,
      mouseDistance,
      clicks,
      scrollDelta: scroll,
      isIdle: isIdle.value,
      newSwitches,
      productive: classification.productive,
      confidence: classification.confidence ?? 0,
    })

    syncAppTimeline()
    syncWindowTimeline()
    refreshLiveTyping()
    updateLiveScoresOnly()
  }

  function startElectronTracking() {
    window.velance?.removeTrackingListeners?.()
    window.velance?.onTrackingData?.(handleTrackingSample)
    window.velance?.onKeystroke?.(({ ts }) => {
      if (!isTracking.value || isPaused.value) return
      if (!store.settings.keystrokeEnabled) return
      recentKeystrokes.value = [...recentKeystrokes.value, ts || Date.now()]
      refreshLiveTyping()
    })
    window.velance?.startTracking?.()
  }

  function stopElectronTracking() {
    window.velance?.stopTracking?.()
    window.velance?.removeTrackingListeners?.()
  }

  function startBrowserTracking() {
    let bufferKeys = 0
    let bufferMouseDistance = 0
    let bufferClicks = 0
    let bufferScroll = 0
    let lastX = null
    let lastY = null
    let lastActivityAt = Date.now()

    browserKeyHandler = () => {
      if (!store.settings.keystrokeEnabled) return
      bufferKeys += 1
      recentKeystrokes.value = [...recentKeystrokes.value, Date.now()]
      lastActivityAt = Date.now()
      refreshLiveTyping()
    }

    browserMouseHandler = (event) => {
      if (!store.settings.mouseEnabled) return
      if (lastX === null || lastY === null) {
        lastX = event.clientX
        lastY = event.clientY
        lastActivityAt = Date.now()
        return
      }
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      bufferMouseDistance += Math.sqrt((dx * dx) + (dy * dy))
      lastX = event.clientX
      lastY = event.clientY
      lastActivityAt = Date.now()
    }

    browserClickHandler = () => {
      if (!store.settings.mouseEnabled) return
      bufferClicks += 1
      lastActivityAt = Date.now()
    }

    browserWheelHandler = (event) => {
      if (!store.settings.mouseEnabled) return
      bufferScroll += Math.abs(event.deltaY || 0)
      lastActivityAt = Date.now()
    }

    window.addEventListener('keydown', browserKeyHandler)
    window.addEventListener('mousemove', browserMouseHandler)
    window.addEventListener('mousedown', browserClickHandler)
    window.addEventListener('wheel', browserWheelHandler, { passive: true })

    browserInterval = setInterval(() => {
      if (!isTracking.value) return
      const idleMs = Date.now() - lastActivityAt
      handleTrackingSample({
        activeApp: document.title ? 'Browser fallback' : '',
        activeTitle: document.title || 'Velance browser mode',
        activeUrl: window.location?.href || '',
        keystrokesInWindow: bufferKeys,
        mouseDistanceInWindow: Math.round(bufferMouseDistance),
        mouseClicks: bufferClicks,
        scrollDelta: Math.round(bufferScroll),
        windowSwitches: 0,
        windowSwitchLog: [],
        idleMs,
        isIdle: idleMs > IDLE_THRESHOLD_MS,
        inputHookAvailable: false,
        windowHookAvailable: false,
      })
      bufferKeys = 0
      bufferMouseDistance = 0
      bufferClicks = 0
      bufferScroll = 0
    }, SAMPLE_SECONDS * 1000)
  }

  function stopBrowserTracking() {
    if (browserInterval) {
      clearInterval(browserInterval)
      browserInterval = null
    }
    if (browserKeyHandler) window.removeEventListener('keydown', browserKeyHandler)
    if (browserMouseHandler) window.removeEventListener('mousemove', browserMouseHandler)
    if (browserClickHandler) window.removeEventListener('mousedown', browserClickHandler)
    if (browserWheelHandler) window.removeEventListener('wheel', browserWheelHandler)
    browserKeyHandler = null
    browserMouseHandler = null
    browserClickHandler = null
    browserWheelHandler = null
  }

  function start(options = {}) {
    stopElectronTracking()
    stopBrowserTracking()

    if (applyTrackingBlockState()) {
      isTracking.value = false
      isPaused.value = false
      return false
    }

    isTracking.value = true
    isPaused.value = false
    elapsedSeconds.value = 0
    focusScore.value = 0
    fatigueScore.value = 0
    fatigueRisk.value = 'Low'
    fatigueDrivers.value = buildEmptyFatigueDrivers()
    keystrokesPerMin.value = 0
    liveWpm.value = 0
    mouseIntensity.value = 0
    mouseClicks.value = 0
    scrollDelta.value = 0
    isIdle.value = false
    idleSeconds.value = 0
    currentApp.value = '-'
    currentTitle.value = ''
    currentUrl.value = ''
    currentClassification.value = getDefaultClassification()
    windowSwitchCount.value = 0
    deepWorkSeconds.value = 0
    bestFlowSeconds.value = 0
    focusPillars.value = buildEmptyPillars()
    focusQuality.value = {
      title: 'Starting',
      detail: 'Velance is collecting the first live signals.',
      tone: 'neutral',
    }
    liveAdvice.value = 'Move into the real app and let the session settle.'
    recoveryCount.value = 0
    driftCount.value = 0
    productiveSeconds.value = 0
    supportingSeconds.value = 0
    unclearSeconds.value = 0
    distractingSeconds.value = 0
    telemetryStatus.value = {
      source: window.velance?.startTracking ? 'native' : 'browser',
      lastSampleAt: null,
      sampleCount: 0,
      needsWorkApp: false,
      hasWindowData: false,
      inputHookAvailable: Boolean(window.velance?.startTracking) && (store.settings.keystrokeEnabled || store.settings.mouseEnabled),
      windowHookAvailable: Boolean(window.velance?.startTracking),
    }
    sessionMeta.value = {
      sessionId: options.sessionId || `session-${Date.now()}`,
      goal: options.goal || '',
      taskTitle: options.taskTitle || null,
      habit: options.habit || null,
      linkedTaskId: options.linkedTaskId ?? null,
      linkedHabitId: options.linkedHabitId ?? null,
      durationGoal: options.durationGoalMinutes ?? options.durationGoal ?? 0,
      startedAt: Date.now(),
      sessionType: 'Focus',
      sessionMode: 'Observe',
    }
    sessionSummary.value = buildEmptySessionSummary()
    completedSession.value = null
    latestSample.value = buildEmptyLatestSample()
    sampleFeed.value = []
    appTimeline.value = []
    windowTimeline.value = []
    activityTimeline.value = []
    timelineSegments.value = []
    recentKeystrokes.value = []
    switchLog.value = []
    distractionEvents.value = []
    statusEvents.value = []
    resetRuntime()
    sessionStartedAt = Date.now()
    syncBreakReminderSchedule()

    timerInterval = setInterval(() => {
      if (!isTracking.value || isPaused.value) return
      elapsedSeconds.value = Math.round((Date.now() - sessionStartedAt - totalPausedMs) / 1000)
      syncBreakReminderSchedule()

      if (nextBreakReminderAt > 0 && elapsedSeconds.value >= nextBreakReminderAt && shouldSendNotifications()) {
        window.velance?.notify?.(
          'Velance break reminder',
          `You have been working for ${Math.round(elapsedSeconds.value / 60)} minutes. Take a short reset before the next block.`,
        )
        nextBreakReminderAt += scheduledBreakIntervalSeconds
      }

      refreshSessionSummary()
      const durationLimitSeconds = Number(sessionMeta.value.durationGoal || 0) * 60
      if (durationLimitSeconds > 0 && elapsedSeconds.value >= durationLimitSeconds) {
        stop()
        if (shouldSendNotifications()) {
          window.velance?.notify?.(
            'Velance focus session complete',
            `${sessionMeta.value.goal || 'Your focus session'} is ready to review.`,
          )
        }
      }
    }, 1000)

    scoreInterval = setInterval(() => {
      if (!isTracking.value || isPaused.value) return
      recordSlice()
    }, SLICE_SECONDS * 1000)

    typingInterval = setInterval(() => {
      if (!isTracking.value) return
      refreshLiveTyping()
    }, 2000)

    if (window.velance?.startTracking) startElectronTracking()
    else startBrowserTracking()

    return true
  }

  function pause() {
    if (!isTracking.value || isPaused.value) return
    isPaused.value = true
    pausedAt = Date.now()
  }

  function resume() {
    if (!isTracking.value || !isPaused.value) return
    if (pausedAt > 0) {
      totalPausedMs += Date.now() - pausedAt
      pausedAt = 0
    }
    isPaused.value = false
  }

  function stop(details = {}) {
    if (!isTracking.value) return completedSession.value

    isTracking.value = false
    isPaused.value = false

    if (timerInterval) {
      clearInterval(timerInterval)
      timerInterval = null
    }
    if (scoreInterval) {
      clearInterval(scoreInterval)
      scoreInterval = null
    }
    if (typingInterval) {
      clearInterval(typingInterval)
      typingInterval = null
    }

    stopElectronTracking()
    stopBrowserTracking()
    refreshLiveTyping()
    recordSlice(true)

    if (details.discard) {
      completedSession.value = null
      clearCompletedSession()
      applyTrackingBlockState()
      return null
    }

    const appBreakdown = [...appTimeline.value]
    const windowBreakdown = [...windowTimeline.value]
    const appUsage = appBreakdown.map((entry) => ({
      app: entry.app,
      appName: entry.app,
      seconds: entry.seconds,
      share: entry.share,
    }))
    const summary = {
      ...sessionSummary.value,
      focusScore: focusScore.value,
      fatigueScore: fatigueScore.value,
    }

    const primaryAppEntry = getDominantContextFromEntries(appBreakdown)
    const primaryWindowEntry = getDominantContextFromEntries(windowBreakdown)
    const primaryApp = primaryAppEntry?.app || currentApp.value || null
    const primaryWindow = primaryWindowEntry?.title || primaryAppEntry?.app || currentTitle.value || null
    const primaryBrowserUrl = primaryWindowEntry?.browserUrl || currentUrl.value || null
    const primaryClassification = normalizeClassification(primaryApp || '', primaryWindow || '', primaryBrowserUrl || '')

    let reviewTitle = 'Measured block'
    let reviewDetail = 'Real app and input telemetry were captured for this session.'
    if (focusScore.value >= 80 && fatigueScore.value < 50) {
      reviewTitle = 'Strong block'
      reviewDetail = 'The session stayed stable with low drift and healthy continuity.'
    } else if (fatigueScore.value >= 65) {
      reviewTitle = 'Fatigue-limited block'
      reviewDetail = 'The work stayed real, but session pressure rose noticeably.'
    } else if ((focusPillars.value.continuity || 0) < 55) {
      reviewTitle = 'Fragmented block'
      reviewDetail = 'Frequent switching prevented the block from fully compounding.'
    }

    const basePayload = {
      id: sessionMeta.value.sessionId || `session-${Date.now()}`,
      date: formatLocalDateKey(sessionMeta.value.startedAt || Date.now()),
      timestamp: sessionMeta.value.startedAt || Date.now(),
      createdAt: sessionMeta.value.startedAt || Date.now(),
      durationSeconds: elapsedSeconds.value,
      observedSeconds: sessionSummary.value.observedSeconds,
      observedRatio: sessionSummary.value.observedRatio,
      activeObservedSeconds: sessionSummary.value.activeObservedSeconds,
      focusScore: focusScore.value,
      fatigueScore: fatigueScore.value,
      fatigueRisk: getFatigueRisk(fatigueScore.value),
      keystrokesPerMin: sessionSummary.value.averageKpm,
      totalKeystrokes,
      totalMouseDistance: sessionSummary.value.totalMouseDistance,
      totalMouseClicks,
      totalScrollDelta,
      mouseIntensity: sessionSummary.value.mouseIntensity,
      idleSeconds: idleSeconds.value,
      idleRatio: sessionSummary.value.idleRatio,
      distractions: distractionEvents.value.length,
      distractionLog: distractionEvents.value,
      appBreakdown,
      appUsage,
      windowBreakdown,
      activityTimeline: activityTimeline.value,
      timeline: timelineSegments.value,
      timelineSegments: timelineSegments.value,
      switchLog: switchLog.value,
      statusEvents: statusEvents.value,
      telemetrySummary: telemetryStatus.value,
      windowSwitchCount: windowSwitchCount.value,
      switchRate: sessionSummary.value.switchRate,
      deepWorkSeconds: bestFlowSeconds.value,
      bestFlowSeconds: bestFlowSeconds.value,
      primaryApp,
      primaryAppCategory: primaryClassification.category,
      primaryContext: primaryWindow || primaryApp,
      primaryBrowserUrl,
      primaryContextState: getContextState(primaryClassification),
      primaryContextConfidence: primaryClassification.confidence ?? 0,
      pillarScores: { ...focusPillars.value },
      focusQuality: reviewTitle,
      focusQualityDetail: reviewDetail,
      recoveryCount: recoveryCount.value,
      driftCount: driftCount.value,
      productiveSeconds: productiveSeconds.value,
      supportingSeconds: supportingSeconds.value,
      unclearSeconds: unclearSeconds.value,
      distractingSeconds: distractingSeconds.value,
      sessionType: 'Focus',
      sessionMode: 'Observe',
      goal: details.goal || sessionMeta.value.goal || null,
      taskTitle: details.taskTitle ?? sessionMeta.value.taskTitle ?? null,
      habit: details.habit ?? sessionMeta.value.habit ?? null,
      linkedTaskId: details.linkedTaskId ?? sessionMeta.value.linkedTaskId ?? null,
      linkedHabitId: details.linkedHabitId ?? sessionMeta.value.linkedHabitId ?? null,
      durationGoal: details.durationGoalMinutes ?? details.durationGoal ?? sessionMeta.value.durationGoal ?? 0,
      durationGoalMinutes: details.durationGoalMinutes ?? details.durationGoal ?? sessionMeta.value.durationGoal ?? 0,
      sessionSummary: summary,
      fatigueDrivers: fatigueDrivers.value,
      coach: {
        summary: reviewDetail,
        strengths: [],
        frictions: [],
        nextStep: '',
      },
    }

    const analysis = buildStoredSessionAnalysis(basePayload)

    const payload = {
      ...basePayload,
      focusScore: analysis.focusScore,
      fatigueScore: analysis.fatigueScore,
      fatigueRisk: analysis.fatigueRisk,
      pillarScores: analysis.pillars,
      fatigueDrivers: analysis.fatigueDrivers,
      analysisConfidenceScore: analysis.confidenceScore,
      analysisConfidenceRatio: analysis.confidenceRatio,
      topFatigueDriverLabel: analysis.topFatigueDriverLabel,
      focusFormulaVersion: analysis.focusFormulaVersion,
      fatigueFormulaVersion: analysis.fatigueFormulaVersion,
      sessionSummary: {
        ...summary,
        focusScore: analysis.focusScore,
        fatigueScore: analysis.fatigueScore,
      },
    }

    completedSession.value = payload
    return payload
  }

  function clearCompletedSession() {
    completedSession.value = null
    if (!isTracking.value) {
      sessionSummary.value = buildEmptySessionSummary()
      focusScore.value = 0
      fatigueScore.value = 0
      fatigueRisk.value = 'Low'
      fatigueDrivers.value = buildEmptyFatigueDrivers()
      focusPillars.value = buildEmptyPillars()
      focusQuality.value = {
        title: 'Ready',
        detail: 'Start a block to begin live focus tracking.',
        tone: 'neutral',
      }
      liveAdvice.value = 'Start a block to measure focus from real activity.'
      latestSample.value = buildEmptyLatestSample()
      sampleFeed.value = []
      activityTimeline.value = []
      timelineSegments.value = []
      statusEvents.value = []
      appTimeline.value = []
      windowTimeline.value = []
      sessionMeta.value = {
        sessionId: null,
        goal: '',
        taskTitle: null,
        habit: null,
        linkedTaskId: null,
        linkedHabitId: null,
        durationGoal: 0,
        startedAt: null,
        sessionType: 'Focus',
        sessionMode: 'Observe',
      }
    }
  }

  function logDistraction(reason = 'Manual') {
    distractionEvents.value = [
      ...distractionEvents.value,
      {
        t: elapsedSeconds.value,
        reason,
        ts: Date.now(),
        app: currentApp.value,
        title: currentTitle.value,
      },
    ]
  }

  watch(
    () => [store.settings.trackingConsentGranted, store.settings.trackingEnabled],
    ([consentGranted, trackingEnabled]) => {
      if (consentGranted && trackingEnabled) {
        if (!isTracking.value && !completedSession.value) clearCompletedSession()
        return
      }
      if (isTracking.value) {
        stop({ discard: true })
        return
      }
      applyTrackingBlockState()
    },
    { immediate: true },
  )

  watch(
    () => [store.settings.breakReminders, store.settings.notificationsEnabled, store.settings.breakIntervalMinutes],
    () => {
      if (isTracking.value) syncBreakReminderSchedule()
    },
  )

  watch(
    () => [store.settings.keystrokeEnabled, store.settings.mouseEnabled],
    ([keystrokeEnabled, mouseEnabled]) => {
      telemetryStatus.value = {
        ...telemetryStatus.value,
        inputHookAvailable: Boolean(window.velance?.startTracking) && (keystrokeEnabled || mouseEnabled),
      }
    },
    { immediate: true },
  )

  return {
    isTracking: readonly(isTracking),
    isPaused: readonly(isPaused),
    elapsedSeconds: readonly(elapsedSeconds),
    focusScore: readonly(focusScore),
    fatigueScore: readonly(fatigueScore),
    fatigueRisk: readonly(fatigueRisk),
    fatigueDrivers: readonly(fatigueDrivers),
    keystrokesPerMin: readonly(keystrokesPerMin),
    liveWpm: readonly(liveWpm),
    mouseIntensity: readonly(mouseIntensity),
    mouseClicks: readonly(mouseClicks),
    scrollDelta: readonly(scrollDelta),
    isIdle: readonly(isIdle),
    idleSeconds: readonly(idleSeconds),
    currentApp: readonly(currentApp),
    currentTitle: readonly(currentTitle),
    currentUrl: readonly(currentUrl),
    currentClassification: readonly(currentClassification),
    windowSwitchCount: readonly(windowSwitchCount),
    deepWorkSeconds: readonly(deepWorkSeconds),
    bestFlowSeconds: readonly(bestFlowSeconds),
    focusPillars: readonly(focusPillars),
    focusQuality: readonly(focusQuality),
    liveAdvice: readonly(liveAdvice),
    recoveryCount: readonly(recoveryCount),
    driftCount: readonly(driftCount),
    productiveSeconds: readonly(productiveSeconds),
    supportingSeconds: readonly(supportingSeconds),
    unclearSeconds: readonly(unclearSeconds),
    distractingSeconds: readonly(distractingSeconds),
    telemetryStatus: readonly(telemetryStatus),
    sessionMeta: readonly(sessionMeta),
    sessionSummary: readonly(sessionSummary),
    completedSession: readonly(completedSession),
    latestSample: readonly(latestSample),
    sampleFeed: readonly(sampleFeed),
    appTimeline: readonly(appTimeline),
    windowTimeline: readonly(windowTimeline),
    activityTimeline: readonly(activityTimeline),
    timelineSegments: readonly(timelineSegments),
    recentKeystrokes: readonly(recentKeystrokes),
    switchLog: readonly(switchLog),
    distractionEvents: readonly(distractionEvents),
    statusEvents: readonly(statusEvents),
    focusModel,
    start,
    pause,
    resume,
    stop,
    clearCompletedSession,
    logDistraction,
  }
}

let trackerSingleton = null

export function useActivityTracker() {
  if (!trackerSingleton) trackerSingleton = createActivityTracker()
  return trackerSingleton
}
