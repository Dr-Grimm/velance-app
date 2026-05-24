<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useVelanceStore } from '../store/velance.js'
import { useAuthStore } from '../store/auth.js'
import { useAmbientTracker } from '../composables/useAmbientTracker.js'
import { getRecentLocalDateKeys, getTodayLocalDateKey } from '../services/dateKey.js'
import { primeFocusLaunch } from '../services/focusLaunchService.js'
import { getTrackingLaneMeta } from '../services/activityClassification.js'
import { buildWorkspacePresentation } from '../services/workspacePresentation.js'
import { getAiModeLabel, getAiProviderMeta, hasConfiguredAiKey, normalizeAiSettings } from '../services/aiProvider.js'
import {
  buildDailyChallengeCandidates,
  buildChallengeTaskPayload,
  getDailyChallengeStats,
  getTodayChallengeTask,
  pickDailyChallengeCandidate,
  readAcceptedChallenge,
  saveAcceptedChallenge,
} from '../services/dailyChallenge.js'
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BanIcon,
  BarChartIcon,
  BrainIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  EyeIcon,
  FlameIcon,
  LightbulbIcon,
  PlayIcon,
  RefreshCwIcon,
  RocketIcon,
  SparklesIcon,
  TargetIcon,
} from 'lucide-vue-next'

const router = useRouter()
const store = useVelanceStore()
const authStore = useAuthStore()
const ambient = useAmbientTracker()

const loading = ref(false)
const error = ref('')
const insights = ref([])
const expandedInsightIds = ref(new Set())
const lastGenerated = ref(store.insightsCachedAt)
const lastEvidenceSignature = ref('')
const selectedRangeDays = ref(1)
const challengeAcceptedTick = ref(0)
const MIN_BASELINE_SESSIONS = 3
const AUTO_REFRESH_MS = 10 * 60 * 1000
let generationToken = 0
const rangeOptions = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

const categoryConfig = {
  performance: { icon: 'P', color: '#00B4D8', label: 'Performance' },
  health: { icon: 'H', color: '#52B788', label: 'Wellbeing' },
  timing: { icon: 'T', color: '#9B51E0', label: 'Timing' },
  warning: { icon: '!', color: '#F59E0B', label: 'Alert' },
  milestone: { icon: 'M', color: '#F59E0B', label: 'Milestone' },
  habit: { icon: 'R', color: '#EF4444', label: 'Habits' },
}

function syncInsightsFromStore() {
  lastGenerated.value = store.insightsCachedAt
  insights.value = store.cachedInsights.length ? [...store.cachedInsights] : []
}

const insightRangeKeys = computed(() => getRecentLocalDateKeys(selectedRangeDays.value))
const insightAmbientEntries = computed(() => ambient.getEntriesForDateKeys(insightRangeKeys.value))
const insightBrowserEvents = computed(() => ambient.getBrowserEventsForDateKeys(insightRangeKeys.value))

async function refreshInsightEvidence() {
  await ambient.attachListener()
  await ambient.refreshDates(insightRangeKeys.value)
}

onMounted(async () => {
  await ensureFreshInsights()
})

watch(() => store.currentWorkspaceId, async () => {
  lastEvidenceSignature.value = ''
  await ensureFreshInsights({ force: true })
})

watch(selectedRangeDays, async () => {
  lastEvidenceSignature.value = ''
  await ensureFreshInsights({ force: true })
})

watch(() => store.insightsCachedAt, (value) => {
  lastGenerated.value = value
})

watch(() => store.sessions.length, (newLen, oldLen) => {
  if (newLen > oldLen) {
    void store.clearInsightsCache()
    insights.value = []
    setTimeout(() => {
      void ensureFreshInsights({ force: true })
    }, 1500)
  }
})

watch(
  () => [
    store.settings.hasAiApiKey ? 'key' : 'no-key',
    store.settings.aiKeyProvider || '',
    store.settings.aiProvider || 'gemini',
    store.settings.aiModel || '',
    store.settings.aiBaseUrl || '',
    store.settings.aiInsightsEnabled === false ? 'local' : 'ai',
    store.settings.aiLastTestOk ? 'tested' : 'untested',
  ].join('|'),
  async () => {
    lastEvidenceSignature.value = ''
    await store.clearInsightsCache()
    insights.value = []
  },
)

function buildEvidenceSignature(context = ctx.value) {
  const ambientSummary = context?.ambientSummary || {}
  const browser = context?.browserEvidence || {}
  const aiMode = canUseAiCoach.value
    ? `ai:${aiSettings.value.provider}:${aiSettings.value.model}:${store.settings.aiLastTestedAt || 0}`
    : 'local'
  return [
    store.currentWorkspaceId,
    context?.sessions || 0,
    context?.avgFocusScore || 0,
    context?.totalFocusMinutes || 0,
    context?.distractionEvents || 0,
    ambientSummary.totalMinutes || 0,
    ambientSummary.productiveMinutes || 0,
    ambientSummary.distractingMinutes || 0,
    browser.totalEvents || 0,
    browser.pressureScore || 0,
    context?.taskSummary?.open || 0,
    context?.taskSummary?.overdue || 0,
    aiMode,
  ].join('|')
}

function shouldAutoRefresh(signature = buildEvidenceSignature()) {
  if (!insights.value.length || !lastGenerated.value) return true
  if ((Date.now() - Number(lastGenerated.value || 0)) > AUTO_REFRESH_MS) return true
  if (lastEvidenceSignature.value && signature !== lastEvidenceSignature.value) return true
  return false
}

async function ensureFreshInsights({ force = false } = {}) {
  await refreshInsightEvidence()
  syncInsightsFromStore()
  const context = store.buildInsightContext({
    days: selectedRangeDays.value,
    ambientEntries: insightAmbientEntries.value,
    browserEvents: insightBrowserEvents.value,
  })
  const signature = buildEvidenceSignature(context)
  if (force || shouldAutoRefresh(signature)) {
    await generateInsights({ context, signature })
  } else {
    lastEvidenceSignature.value = signature
  }
}

async function cacheInsights(nextInsights, signature = buildEvidenceSignature()) {
  insights.value = nextInsights
  await store.cacheInsights(nextInsights)
  lastGenerated.value = Date.now()
  lastEvidenceSignature.value = signature
}

async function generateInsights({ context: providedContext = null, signature = '' } = {}) {
  if (loading.value) return
  const token = ++generationToken
  loading.value = true
  error.value = ''

  const context = providedContext || store.buildInsightContext({
    days: selectedRangeDays.value,
    ambientEntries: insightAmbientEntries.value,
    browserEvents: insightBrowserEvents.value,
  })
  const evidenceSignature = signature || buildEvidenceSignature(context)

  try {
    if (canUseAiCoach.value) {
      const generated = await callAiCoach(context)
      if (token !== generationToken) return
      await cacheInsights(generated, evidenceSignature)
    } else {
      if (token !== generationToken) return
      await cacheInsights(buildLocalInsights(context), evidenceSignature)
    }
  } catch (cause) {
    console.error('[Velance Insights]', cause)
    if (token !== generationToken) return
    error.value = cause?.message || 'Failed to generate insights'
    await cacheInsights(buildLocalInsights(context), evidenceSignature)
  } finally {
    if (token === generationToken) loading.value = false
  }
}

async function callAiCoach(context) {
  const generate = window.velance?.insights?.generate
  if (!generate) throw new Error('AI integration is unavailable in this build')

  const result = await generate({
    userId: store.currentWorkspaceId,
    context,
  })

  if (!result?.ok || !Array.isArray(result?.insights)) {
    if (result?.reason === 'no_api_key') {
      throw new Error('Add your own AI API key in Settings to enable cloud insights')
    }
    throw new Error(result?.message || 'Failed to generate AI insights')
  }

  return result.insights
}

function buildLocalInsights(ctx) {
  const out = []
  const ambientSummary = ctx.ambientSummary || {}
  const sessionMix = ctx.sessionMix || {}
  const productiveMinutes = ambientSummary.productiveMinutes || sessionMix.productiveMinutes || 0
  const supportingMinutes = ambientSummary.supportingMinutes || sessionMix.supportingMinutes || 0
  const distractingMinutes = ambientSummary.distractingMinutes || sessionMix.distractingMinutes || 0
  const usageMinutes = ambientSummary.totalMinutes || (productiveMinutes + supportingMinutes + distractingMinutes + (ambientSummary.unclearMinutes || sessionMix.unclearMinutes || 0))
  const usageHours = formatMinutesCompact(usageMinutes)

  const add = (entry) => {
    out.push({
      evidence: entry.evidence || entry.metricValue || '',
      confidence: entry.confidence || ctx.dataQuality?.recommendationConfidence || 'medium',
      ...entry,
    })
  }

  if (usageMinutes > 0) {
    if (distractingMinutes >= Math.max(30, usageMinutes * 0.18)) {
      add({
        id: 'local-usage-distraction',
        category: 'warning',
        title: 'Distraction time needs a cap',
        metricLabel: 'Distracting usage',
        metricValue: formatMinutesCompact(distractingMinutes),
        insight: `${formatMinutesCompact(distractingMinutes)} of tracked app time landed in distracting context out of ${usageHours} total. That is the clearest local signal to reduce first.`,
        action: 'Pick one distracting app/site and keep it closed during the next focus block.',
        evidence: `${ambientSummary.distractingShare || 0}% distracting share`,
      })
    } else if (productiveMinutes > 0) {
      add({
        id: 'local-usage-productive',
        category: 'performance',
        title: 'Productive time is visible',
        metricLabel: 'Productive usage',
        metricValue: formatMinutesCompact(productiveMinutes),
        insight: `${formatMinutesCompact(productiveMinutes)} of tracked usage is already classified as productive. Velance should now connect that work time to tasks and focus sessions.`,
        action: 'Start the next important task from Tasks, then run a tracked focus session.',
        evidence: `${ambientSummary.productiveShare || 0}% productive share`,
      })
    } else if (supportingMinutes > 0) {
      add({
        id: 'local-usage-supporting',
        category: 'timing',
        title: 'Support work is dominating the signal',
        metricLabel: 'Supporting usage',
        metricValue: formatMinutesCompact(supportingMinutes),
        insight: `${formatMinutesCompact(supportingMinutes)} is supporting/context work. That can be useful, but it needs a protected output block after it.`,
        action: 'Convert the next research or admin stretch into one focused execution block.',
        evidence: `${ambientSummary.supportingShare || 0}% supporting share`,
      })
    }
  } else {
    add({
      id: 'local-usage-empty',
      category: 'timing',
      title: 'Usage baseline is empty',
      metricLabel: 'Tracked usage',
      metricValue: '0m',
      insight: 'Velance has no useful app-usage duration for this range yet. Keep local tracking on so system insights can build from real hours, not placeholders.',
      action: 'Enable tracking and use the app normally for one workday.',
      confidence: 'low',
    })
  }

  if (ctx.sessions === 0) {
    add({
      id: 'local-focus-baseline',
      category: 'timing',
      title: 'Focus baseline is missing',
      metricLabel: 'Focus sessions',
      metricValue: '0',
      insight: 'There are no completed focus sessions yet, so focus score and peak-hour claims should stay cautious. Usage and browser evidence can still guide the next step.',
      action: 'Complete three focus sessions on different work blocks.',
      confidence: usageMinutes > 0 ? 'medium' : 'low',
    })
  }

  if (ctx.avgFocusScore >= 75) {
    add({ id: 'local-focus-score', category: 'performance', title: 'Focus quality is strong', metricLabel: 'Avg focus', metricValue: `${ctx.avgFocusScore}/100`, insight: `${ctx.sessions} sessions averaged ${ctx.avgFocusScore}/100 with ${formatMinutesCompact(ctx.totalFocusMinutes)} of focus time. Repeat the same conditions before changing the routine.`, action: 'Schedule your next hard task inside the same work window.' })
  } else if (ctx.avgFocusScore < 55) {
    if (ctx.sessions > 0) {
      add({ id: 'local-focus-score', category: 'warning', title: 'Focus quality is below target', metricLabel: 'Avg focus', metricValue: `${ctx.avgFocusScore}/100`, insight: `${ctx.distractionEvents} distraction events showed up across ${ctx.sessions} sessions. The next improvement should come from reducing context switches, not adding more hours.`, action: 'Run one protected block with only the primary work app open.' })
    }
  } else if (ctx.sessions > 0) {
    add({ id: 'local-focus-score', category: 'performance', title: 'Focus has room to tune', metricLabel: 'Avg focus', metricValue: `${ctx.avgFocusScore}/100`, insight: `${ctx.avgFocusScore}/100 is a usable baseline. One consistent work window should make the next score easier to compare.`, action: `Try ${(ctx.peakFocusHour ?? 9)}:00 as the next protected deep-work block.` })
  }

  const trend = ctx.trend || {}
  if (Number.isFinite(Number(trend.focusDelta)) && trend.previousSessions > 0) {
    if (trend.focusDelta <= -8) {
      add({
        id: 'local-trend',
        category: 'warning',
        title: 'Focus Dropped Versus Last Period',
        metricLabel: 'Focus trend',
        metricValue: `${trend.focusDelta}`,
        insight: `Focus moved from ${trend.previousAvgFocusScore}/100 to ${ctx.avgFocusScore}/100. Check session length and browser pressure before changing the whole routine.`,
        action: 'Compare your weakest recent session in Analytics before changing the whole routine.',
        evidence: `${trend.focusDelta} focus delta`,
        confidence: ctx.dataQuality?.recommendationConfidence || 'medium',
      })
    } else if (trend.focusDelta >= 8) {
      add({
        id: 'local-trend',
        category: 'milestone',
        title: 'Focus Is Improving',
        metricLabel: 'Focus trend',
        metricValue: `+${trend.focusDelta}`,
        insight: `Average focus rose by ${trend.focusDelta} points versus the previous ${ctx.period}. Repeat the same setup so Velance can confirm the pattern.`,
        action: 'Repeat the best recent session setup one more time this week.',
        evidence: `+${trend.focusDelta} focus delta`,
        confidence: ctx.dataQuality?.recommendationConfidence || 'medium',
      })
    }
  }

  const taskSummary = ctx.taskSummary || {}
  if ((taskSummary.overdue || 0) > 0 || (taskSummary.highPriorityOpen || 0) > 0) {
    add({
      id: 'local-task-pressure',
      category: 'warning',
      title: 'Task Pressure Needs a Focus Block',
      metricLabel: 'Open tasks',
      metricValue: `${taskSummary.open || 0}`,
      insight: `${taskSummary.overdue || 0} overdue and ${taskSummary.highPriorityOpen || 0} high-priority tasks are open. Link one to a focus block so the system can see what work is reducing pressure.`,
      action: 'Pick one high-pressure task and start the next focus session from that task.',
      evidence: `${taskSummary.open || 0} open tasks`,
      confidence: 'high',
    })
  }

  if (ctx.sessions > 0 && (ctx.dataQuality?.linkedContextCoverage || 0) < 60) {
    add({
      id: 'local-context-coverage',
      category: 'habit',
      title: 'Link More Sessions to Real Work',
      metricLabel: 'Linked sessions',
      metricValue: `${ctx.dataQuality?.linkedContextCoverage || 0}%`,
      insight: `${ctx.dataQuality?.linkedContextCoverage || 0}% of sessions have task or habit context. Better links make future recommendations less generic.`,
      action: 'For the next three sessions, launch from a task or select a linked habit before starting.',
      evidence: `${ctx.linkedTaskSessions || 0} task-linked, ${ctx.linkedHabitSessions || 0} habit-linked`,
      confidence: 'high',
    })
  }

  const hour = ctx.peakFocusHour
  if (hour !== null) {
    const tod = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
    add({ id: 'local-peak-window', category: 'timing', title: `Peak window: ${hour}:00 ${tod}`, metricLabel: 'Best hour', metricValue: `${hour}:00`, insight: `Your strongest completed sessions cluster around ${hour}:00. Treat it as the best candidate for demanding work until more data says otherwise.`, action: `Schedule your hardest task near ${hour}:00 for the next few days.` })
  }

  if (ctx.currentFatigue === 'High' || ctx.fatigueHighDays > 2) {
    add({ id: 'local-fatigue', category: 'health', title: 'Recovery pressure is high', metricLabel: 'Fatigue days', metricValue: `${ctx.fatigueHighDays}`, insight: `${ctx.fatigueHighDays} recent days showed high fatigue risk. Shorter blocks are safer than forcing longer sessions right now.`, action: 'Use a shorter next block and take a real screen break first.' })
  }

  const browserEvidence = ctx.browserEvidence || {}
  if (browserEvidence.totalEvents >= 6) {
    if (browserEvidence.pressureScore >= 58 || browserEvidence.distractingShare >= 0.4) {
      add({
        id: 'local-browser',
        category: 'warning',
        title: 'Browser pressure is shaping the day',
        metricLabel: 'Browser pressure',
        metricValue: `${browserEvidence.pressureScore}/100`,
        insight: `${browserEvidence.leadSiteLabel} leads the browser evidence across ${browserEvidence.totalEvents} events. Browser drift is part of the performance story, not background noise.`,
        action: `Treat ${browserEvidence.leadSiteLabel} as a protected rule for your next block and keep the browser narrowed to one work lane.`,
        evidence: browserEvidence.leadPageLabel,
      })
    } else if (browserEvidence.dominantLane === 'productive' || browserEvidence.supportingShare >= 0.45) {
      add({
        id: 'local-browser',
        category: 'performance',
        title: 'Browser Context Is Mostly Supporting Work',
        metricLabel: 'Browser pressure',
        metricValue: `${browserEvidence.pressureScore}/100`,
        insight: `${browserEvidence.leadSiteLabel} is mostly ${browserEvidence.dominantLane || 'supporting'} context. Keep the browser narrowed so it stays useful instead of drifting.`,
        action: 'Keep using the browser intentionally as part of the workflow, but preserve one main site/page lane during deep work.',
        evidence: `${browserEvidence.totalEvents} browser events`,
      })
    }
  }

  const bestHabit = [...ctx.habits].sort((left, right) => right.avgFocus - left.avgFocus)[0]
  if (bestHabit) {
    add({ id: 'local-best-habit', category: 'habit', title: `${bestHabit.name} is the best routine`, metricLabel: 'Habit focus', metricValue: `${bestHabit.avgFocus}/100`, insight: `${bestHabit.name} has ${bestHabit.sessions} linked sessions and a ${bestHabit.streak}-day streak. Use it as the model for other routines.`, action: `Keep ${bestHabit.name} on the calendar this week.` })
  }

  const activeStreaks = ctx.habits.filter((habit) => habit.streak >= 7)
  if (activeStreaks.length > 0) {
    add({ id: 'local-streaks', category: 'milestone', title: `${activeStreaks.length} habit streak${activeStreaks.length > 1 ? 's' : ''}`, metricLabel: '7d+ streaks', metricValue: `${activeStreaks.length}`, insight: `${activeStreaks.map((habit) => habit.name).join(', ')} ${activeStreaks.length > 1 ? 'are' : 'is'} already consistent. Protect the streak with smaller sessions on low-energy days.`, action: 'Keep the streak alive with minimum viable effort.' })
  }

  const priority = { warning: 6, health: 5, performance: 4, timing: 3, habit: 2, milestone: 1 }
  return [...new Map(out.map((insight) => [insight.id, insight])).values()]
    .sort((left, right) => (priority[right.category] || 0) - (priority[left.category] || 0))
    .slice(0, 3)
}

const timeSince = computed(() => {
  if (!lastGenerated.value) return null
  const mins = Math.round((Date.now() - lastGenerated.value) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
})

const aiSettings = computed(() => normalizeAiSettings(store.settings))
const aiProviderMeta = computed(() => getAiProviderMeta(aiSettings.value.provider))
const hasApiKey = computed(() => hasConfiguredAiKey(store.settings))
const hasAiBridge = computed(() => typeof window.velance?.insights?.generate === 'function')
const aiInsightsEnabled = computed(() => store.settings.aiInsightsEnabled !== false)
const ctx = computed(() => store.buildInsightContext({
  days: selectedRangeDays.value,
  ambientEntries: insightAmbientEntries.value,
  browserEvents: insightBrowserEvents.value,
}))
const browserLaneMeta = computed(() => getTrackingLaneMeta(ctx.value.browserEvidence?.dominantLane || 'unclear'))
const accountSummary = computed(() => buildWorkspacePresentation({
  user: authStore.user,
  profile: store.userProfile,
  workspaceId: store.currentWorkspaceId,
  backendStatus: store.backendStatus,
  migrationStatus: store.migrationStatus,
}))
const aiAvailable = computed(() => hasApiKey.value && hasAiBridge.value && store.backendStatus.kind !== 'degraded')
const canUseAiCoach = computed(() => aiAvailable.value && aiInsightsEnabled.value)
const usingLocalInsights = computed(() => !canUseAiCoach.value || !!error.value)
const hasEnoughBaselineData = computed(() => ctx.value.sessions >= MIN_BASELINE_SESSIONS)
const aiStatusReason = computed(() => {
  if (store.backendStatus.kind === 'degraded') {
    return 'Velance is using built-in coaching while storage is running in degraded mode.'
  }
  if (!hasApiKey.value) {
    return 'Add your own AI API key in Settings. The key is saved there and never entered on Insights.'
  }
  if (!hasAiBridge.value) {
    return 'This build does not expose the AI bridge, so Velance is using local coaching.'
  }
  if (!aiInsightsEnabled.value) {
    return 'BYOK AI is saved but turned off for Insights. Local system insights are active.'
  }
  return `${aiProviderMeta.value.label} Coach is ready. It only receives summarized workspace context and turns it into practical next steps.`
})
const insightModeLabel = computed(() => {
  if (error.value) return 'Local fallback'
  if (canUseAiCoach.value) return getAiModeLabel(store.settings)
  return aiAvailable.value ? 'Velance local' : 'Local analysis'
})

async function toggleAiInsights() {
  if (!hasApiKey.value) return
  generationToken += 1
  loading.value = false
  store.settings.aiInsightsEnabled = !aiInsightsEnabled.value
  await store.saveSettings()
  await store.clearInsightsCache()
  insights.value = []
  await ensureFreshInsights({ force: true })
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0))
}

function formatCount(count = 0, singular = 'item', plural = `${singular}s`) {
  const safe = Number(count) || 0
  return `${safe} ${safe === 1 ? singular : plural}`
}

function formatMinutesCompact(minutes = 0) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0))
  if (safe < 60) return `${safe}m`
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

function formatPercent(value = 0) {
  return `${Math.round(clamp(value, 0, 100))}%`
}

const linkedContextCoverage = computed(() => {
  const sessions = Math.max(1, ctx.value.sessions || 0)
  const linked = Math.min(sessions, (ctx.value.linkedTaskSessions || 0) + (ctx.value.linkedHabitSessions || 0))
  return Math.round((linked / sessions) * 100)
})

const activeHabitSignals = computed(() => ctx.value.habits.filter((habit) => (
  Number(habit.sessions || 0) > 0 || Number(habit.streak || 0) > 0 || Number(habit.totalMinutes || 0) > 0
)))

const readinessScore = computed(() => {
  const c = ctx.value
  const sessionScore = Math.min((c.sessions || 0) / MIN_BASELINE_SESSIONS, 1) * 24
  const focusMinutesScore = Math.min((c.totalFocusMinutes || 0) / 150, 1) * 16
  const contextScore = Math.min(linkedContextCoverage.value / 100, 1) * 16
  const browserScore = Math.min((c.browserEvidence?.totalEvents || 0) / 12, 1) * 14
  const habitScore = Math.min(activeHabitSignals.value.length / 2, 1) * 8
  const taskScore = Math.min((c.tasks?.length || 0) / 2, 1) * 8
  const ambientScore = Math.min((c.ambientSummary?.totalMinutes || 0) / 300, 1) * 14
  return Math.round(sessionScore + focusMinutesScore + contextScore + browserScore + habitScore + taskScore + ambientScore)
})

const readinessState = computed(() => {
  if (ctx.value.sessions === 0) {
    return {
      label: (ctx.value.ambientSummary?.totalMinutes || 0) ? 'Usage signal ready' : 'Needs baseline',
      detail: (ctx.value.ambientSummary?.totalMinutes || 0)
        ? 'App usage and browser evidence are ready; focus sessions will sharpen scoring.'
        : 'No completed focus sessions are available yet.',
      tone: 'warn',
    }
  }
  if (readinessScore.value < 55) {
    return {
      label: 'Building signal',
      detail: `${Math.max(0, MIN_BASELINE_SESSIONS - ctx.value.sessions)} more session${MIN_BASELINE_SESSIONS - ctx.value.sessions === 1 ? '' : 's'} will make recommendations sharper.`,
      tone: 'warn',
    }
  }
  if (readinessScore.value < 78) {
    return {
      label: 'Usable signal',
      detail: 'Velance has enough evidence for directional coaching.',
      tone: 'steady',
    }
  }
  return {
    label: 'Strong signal',
    detail: 'Recommendations are backed by sessions, context links, and activity evidence.',
    tone: 'good',
  }
})

const briefing = computed(() => {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  const peak = c.peakFocusHour === null ? null : `${c.peakFocusHour}:00`

  if (c.sessions === 0) {
    return {
      kicker: 'Baseline brief',
      title: 'Insights are ready for real evidence.',
      body: 'The module can already combine focus sessions, habits, tasks, ambient activity, and browser context. The missing piece is enough tracked work to make the advice personal.',
      action: 'Start the first tracked focus block',
      to: '/focus',
    }
  }

  if (c.currentFatigue === 'High' || c.fatigueHighDays >= 2) {
    return {
      kicker: 'Priority risk',
      title: 'Recovery pressure is the main thing to fix next.',
      body: `${formatCount(c.fatigueHighDays, 'recent day')} showed high fatigue risk. Keep the next block shorter and watch whether the fatigue score falls before increasing session length again.`,
      action: 'Review fatigue evidence',
      to: '/analytics?tab=fatigue',
    }
  }

  if ((browser.pressureScore || 0) >= 58 || (browser.distractingShare || 0) >= 0.4) {
    return {
      kicker: 'Browser pressure',
      title: `${browser.leadSiteLabel || 'Browser context'} is shaping your focus pattern.`,
      body: `Browser pressure is at ${browser.pressureScore || 0}/100, with ${Math.round((browser.distractingShare || 0) * 100)}% of saved browser signals landing in distracting context. That is the clearest place to reduce drift.`,
      action: 'Open app evidence',
      to: '/analytics?tab=apps',
    }
  }

  if ((c.avgFocusScore || 0) >= 75) {
    return {
      kicker: 'Strong pattern',
      title: 'Your current setup is producing solid focus.',
      body: `Average focus is ${c.avgFocusScore}/100 across ${formatCount(c.sessions, 'session')}. Protect the conditions around ${peak || 'your strongest work window'} before adding more complexity.`,
      action: 'Start another clean block',
      to: '/focus',
    }
  }

  return {
    kicker: 'Next tuning pass',
    title: 'One controlled change should move the score.',
    body: `Average focus is ${c.avgFocusScore}/100. Use ${peak || 'one consistent work window'} and link each session to a task or habit so Velance can compare like with like.`,
    action: 'Choose a task',
    to: '/tasks',
  }
})

const signalCards = computed(() => {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  return [
    {
      label: 'Readiness',
      value: `${readinessScore.value}%`,
      detail: readinessState.value.label,
      tone: readinessState.value.tone,
    },
    {
      label: 'Focus pattern',
      value: c.sessions ? `${c.avgFocusScore}/100` : '--',
      detail: c.peakFocusHour === null ? 'Peak window unknown' : `Best around ${c.peakFocusHour}:00`,
      tone: c.avgFocusScore >= 75 ? 'good' : c.avgFocusScore < 55 && c.sessions ? 'warn' : 'steady',
    },
    {
      label: 'Context links',
      value: c.sessions ? formatPercent(linkedContextCoverage.value) : '--',
      detail: `${c.linkedTaskSessions || 0} task-linked | ${c.linkedHabitSessions || 0} habit-linked`,
      tone: linkedContextCoverage.value >= 70 ? 'good' : 'steady',
    },
    {
      label: 'Browser pressure',
      value: browser.totalEvents ? `${browser.pressureScore}/100` : 'Quiet',
      detail: browser.dominantPressureLabel || 'No strong browser signal',
      tone: browser.pressureScore >= 58 ? 'warn' : 'steady',
    },
  ]
})

const priorityActions = computed(() => {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  const actions = []

  if (c.sessions < MIN_BASELINE_SESSIONS) {
    actions.push({
      icon: TargetIcon,
      title: 'Complete the baseline',
      detail: `Record ${Math.max(1, MIN_BASELINE_SESSIONS - c.sessions)} more tracked focus session${MIN_BASELINE_SESSIONS - c.sessions === 1 ? '' : 's'} on different work blocks.`,
      to: '/focus',
      cta: 'Start focus',
    })
  }

  if (linkedContextCoverage.value < 70 && c.sessions > 0) {
    actions.push({
      icon: CheckSquareIcon,
      title: 'Attach work context',
      detail: 'Link sessions to tasks or habits so the app can separate planning problems from focus problems.',
      to: '/tasks',
      cta: 'Open tasks',
    })
  }

  if ((browser.pressureScore || 0) >= 50 || (browser.totalEvents || 0) >= 8) {
    actions.push({
      icon: BarChartIcon,
      title: 'Audit browser drift',
      detail: `${browser.leadSiteLabel || 'Browser activity'} is the lead browser context. Check whether it belongs in productive, supporting, or distracting work.`,
      to: '/analytics?tab=apps',
      cta: 'Review apps',
    })
  }

  if (c.currentFatigue === 'High' || c.fatigueHighDays >= 2) {
    actions.push({
      icon: SparklesIcon,
      title: 'Lower recovery pressure',
      detail: 'Use a shorter next block and keep a real break between sessions before chasing more total minutes.',
      to: '/analytics?tab=fatigue',
      cta: 'Review fatigue',
    })
  }

  if (!actions.length) {
    actions.push({
      icon: TargetIcon,
      title: 'Protect the best window',
      detail: c.peakFocusHour === null
        ? 'Try one morning and one afternoon block this week so Velance can detect your strongest window.'
        : `Put your hardest work near ${c.peakFocusHour}:00 and compare the next score against this week.`,
      to: '/focus',
      cta: 'Plan block',
    })
  }

  return actions.slice(0, 3)
})

const evidenceSections = computed(() => {
  const c = ctx.value
  const mix = c.sessionMix || {}
  const ambientSummary = c.ambientSummary || {}
  const browser = c.browserEvidence || {}
  const mixRows = [
    { label: 'Productive', value: formatMinutesCompact(ambientSummary.productiveMinutes || mix.productiveMinutes || 0), lane: 'productive' },
    { label: 'Supporting', value: formatMinutesCompact(ambientSummary.supportingMinutes || mix.supportingMinutes || 0), lane: 'supporting' },
    { label: 'Distracting', value: formatMinutesCompact(ambientSummary.distractingMinutes || mix.distractingMinutes || 0), lane: 'distracting' },
    { label: 'Unclear', value: formatMinutesCompact(ambientSummary.unclearMinutes || mix.unclearMinutes || 0), lane: 'unclear' },
  ].filter((row) => row.value !== '0m')

  const appRows = (ambientSummary.topApps?.length ? ambientSummary.topApps : c.appBreakdown || []).slice(0, 4).map((app) => ({
    label: app.app || 'Tracked app',
    value: formatMinutesCompact(app.minutes || 0),
    lane: app.lane || 'unclear',
  }))

  const contextRows = [
    ...(c.tasks || []).slice(0, 2).map((task) => ({
      label: task.title,
      value: `${task.avgFocus}/100 | ${task.totalMinutes}m`,
      lane: 'productive',
    })),
    ...activeHabitSignals.value.slice(0, 2).map((habit) => ({
      label: habit.name,
      value: `${habit.avgFocus}/100 | ${habit.streak || 0}d streak`,
      lane: 'supporting',
    })),
  ]

  const browserRows = (browser.topSites || []).slice(0, 4).map((site) => ({
    label: site.label || 'Browser site',
    value: `${Math.round(site.share || 0)}%`,
    lane: site.lane || 'unclear',
  }))

  return [
    { title: 'Usage lanes', empty: 'No usage lane mix yet.', rows: mixRows },
    { title: 'Top apps', empty: 'No app usage breakdown yet.', rows: appRows },
    { title: 'Tasks and habits', empty: 'Link sessions to tasks or habits.', rows: contextRows },
    { title: 'Browser sources', empty: 'No browser evidence saved yet.', rows: browserRows },
  ]
})

const coachingSummary = computed(() => {
  const total = insights.value.length
  const warnings = insights.value.filter((insight) => insight.category === 'warning').length
  const strengths = insights.value.filter((insight) => ['performance', 'milestone'].includes(insight.category)).length
  return {
    total,
    label: total ? `${total} coaching cards` : 'No coaching cards',
    detail: total ? `${strengths} strength signal${strengths === 1 ? '' : 's'} | ${warnings} warning${warnings === 1 ? '' : 's'}` : 'Refresh to generate a coaching feed.',
  }
})

const primaryCoachMove = computed(() => {
  const firstInsight = insights.value[0] || buildLocalInsights(ctx.value)[0]
  if (firstInsight) return firstInsight
  return {
    id: 'fallback-primary-move',
    category: 'timing',
    title: 'Build the first useful signal',
    metricLabel: 'Focus blocks',
    metricValue: '0',
    insight: 'Velance needs a few real focus blocks before it can coach with confidence. Until then, the strongest move is to create a clean baseline.',
    action: 'Start one tracked focus block and link it to a task.',
    evidence: 'No completed focus sessions',
    confidence: 'low',
  }
})

const coachState = computed(() => {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  const taskSummary = c.taskSummary || {}
  if (c.sessions < MIN_BASELINE_SESSIONS) {
    return {
      label: 'Baseline coach',
      title: 'Teach Velance your real rhythm first.',
      mood: 'Gathering signal',
      detail: 'The coach is watching app usage, browser pressure, tasks, habits, and focus blocks, but it needs more completed sessions before it should sound certain.',
      tone: 'warn',
    }
  }
  if (c.currentFatigue === 'High' || c.fatigueHighDays >= 2) {
    return {
      label: 'Recovery coach',
      title: 'Protect capacity before chasing more output.',
      mood: 'Recovery pressure',
      detail: 'Fatigue is the dominant constraint right now. The next recommendation should reduce load while keeping momentum alive.',
      tone: 'health',
    }
  }
  if ((browser.pressureScore || 0) >= 58 || (browser.distractingShare || 0) >= 0.4) {
    return {
      label: 'Attention coach',
      title: 'The browser is the main place to tighten.',
      mood: 'Drift risk',
      detail: 'Velance sees enough browser pressure to make attention design more important than adding another hour of work.',
      tone: 'warn',
    }
  }
  if ((taskSummary.overdue || 0) > 0 || (taskSummary.highPriorityOpen || 0) > 0) {
    return {
      label: 'Execution coach',
      title: 'Convert pressure into one finished block.',
      mood: 'Task pressure',
      detail: 'The work board has pressure. The coach should push toward a linked focus session so effort turns into visible progress.',
      tone: 'steady',
    }
  }
  if ((c.avgFocusScore || 0) >= 75) {
    return {
      label: 'Pattern coach',
      title: 'Repeat the conditions that already work.',
      mood: 'Strong rhythm',
      detail: 'Your focus signal is strong enough to preserve before experimenting with new routines.',
      tone: 'good',
    }
  }
  return {
    label: 'Tuning coach',
    title: 'Make one controlled change, then compare.',
    mood: 'Finding leverage',
    detail: 'Velance has enough mixed evidence to choose a small experiment instead of giving generic advice.',
    tone: 'steady',
  }
})

const coachNarrative = computed(() => {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  const ambientSummary = c.ambientSummary || {}
  const move = primaryCoachMove.value
  const range = selectedRangeDays.value === 1 ? 'today' : `the last ${selectedRangeDays.value} days`
  const workMix = ambientSummary.totalMinutes
    ? `${formatMinutesCompact(ambientSummary.productiveMinutes || 0)} productive, ${formatMinutesCompact(ambientSummary.distractingMinutes || 0)} distracted`
    : 'not enough usage time yet'
  const focus = c.sessions
    ? `${c.sessions} focus block${c.sessions === 1 ? '' : 's'} at ${c.avgFocusScore}/100 average`
    : 'no completed focus blocks yet'
  const browserLine = browser.totalEvents
    ? `${browser.leadSiteLabel || 'browser activity'} at ${browser.pressureScore}/100 pressure`
    : 'quiet browser evidence'
  return `For ${range}, Velance sees ${focus}, ${workMix}, and ${browserLine}. The coach's read is simple: ${move.title.toLowerCase()}`
})

const coachPlaybook = computed(() => {
  const move = primaryCoachMove.value
  const c = ctx.value
  const firstAction = move.action || 'Start one protected focus block.'
  const secondAction = c.peakFocusHour === null
    ? 'Use the same session length twice so Velance can compare the signal.'
    : `Place the block near ${c.peakFocusHour}:00 and keep the setup consistent.`
  const thirdAction = (c.linkedTaskSessions || 0) + (c.linkedHabitSessions || 0) < c.sessions
    ? 'Link the result to a task or habit so the next recommendation becomes less generic.'
    : 'After the block, compare the score and keep only the condition that helped.'
  return [
    { step: '01', label: 'Now', title: move.title, detail: firstAction, tone: move.category || 'timing' },
    { step: '02', label: 'Next block', title: 'Control the experiment', detail: secondAction, tone: 'timing' },
    { step: '03', label: 'After', title: 'Feed the coach better evidence', detail: thirdAction, tone: 'habit' },
  ]
})

const frictionSignals = computed(() => {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  const taskSummary = c.taskSummary || {}
  const signals = []
  if (c.sessions < MIN_BASELINE_SESSIONS) {
    signals.push({
      label: 'Baseline thin',
      detail: `${Math.max(1, MIN_BASELINE_SESSIONS - c.sessions)} more focus block${MIN_BASELINE_SESSIONS - c.sessions === 1 ? '' : 's'} needed`,
      tone: 'warn',
    })
  }
  if ((browser.pressureScore || 0) >= 50 || (browser.totalEvents || 0) >= 8) {
    signals.push({
      label: browser.leadSiteLabel || 'Browser pressure',
      detail: `${browser.pressureScore || 0}/100 pressure`,
      tone: (browser.pressureScore || 0) >= 58 ? 'danger' : 'warn',
    })
  }
  if ((taskSummary.overdue || 0) > 0) {
    signals.push({
      label: 'Overdue work',
      detail: `${taskSummary.overdue} overdue task${taskSummary.overdue === 1 ? '' : 's'}`,
      tone: 'danger',
    })
  } else if ((taskSummary.highPriorityOpen || 0) > 0) {
    signals.push({
      label: 'High priority',
      detail: `${taskSummary.highPriorityOpen} open`,
      tone: 'warn',
    })
  }
  if (c.currentFatigue === 'High' || c.fatigueHighDays >= 2) {
    signals.push({
      label: 'Recovery pressure',
      detail: `${c.fatigueHighDays} high-risk day${c.fatigueHighDays === 1 ? '' : 's'}`,
      tone: 'health',
    })
  }
  if (c.sessions > 0 && linkedContextCoverage.value < 70) {
    signals.push({
      label: 'Context missing',
      detail: `${linkedContextCoverage.value}% linked`,
      tone: 'steady',
    })
  }
  if (!signals.length) {
    signals.push({
      label: 'No major friction',
      detail: 'Protect the pattern',
      tone: 'good',
    })
  }
  return signals.slice(0, 5)
})

const coachFeed = computed(() => insights.value.slice(0, 3))
const todayKey = computed(() => getTodayLocalDateKey())
const todayChallengeTask = computed(() => getTodayChallengeTask(store.tasks, todayKey.value))
const challengeStats = computed(() => getDailyChallengeStats(store.tasks, todayKey.value))
const acceptedChallengeRecord = computed(() => {
  challengeAcceptedTick.value
  return readAcceptedChallenge(store.currentWorkspaceId, todayKey.value)
})
const hasAcceptedChallenge = computed(() => Boolean(todayChallengeTask.value || acceptedChallengeRecord.value?.taskId))

const coachReview = computed(() => {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  const taskSummary = c.taskSummary || {}
  const move = primaryCoachMove.value
  const rangeLabel = selectedRangeDays.value === 1 ? 'today' : `the last ${selectedRangeDays.value} days`

  if (c.sessions < MIN_BASELINE_SESSIONS) {
    return {
      icon: EyeIcon,
      label: 'The Read',
      accent: 'claimed',
      title: 'Your work is active, but your focus has not been claimed yet.',
      detail: `Velance can see motion across ${rangeLabel}; it needs a few deliberate focus blocks before it can separate busy from meaningful.`,
      hiddenPattern: (c.ambientSummary?.totalMinutes || 0)
        ? `${formatMinutesCompact(c.ambientSummary.totalMinutes)} of background activity exists without enough intentional focus labels.`
        : 'There is not enough tracked work rhythm yet, so the next signal matters more than another setting.',
      antiAdvice: 'Do not redesign your whole routine today. One measured block beats a perfect plan.',
      experiment: move.action || 'Start one tracked focus block and link it to a task.',
      tone: 'baseline',
    }
  }

  if (c.currentFatigue === 'High' || c.fatigueHighDays >= 2) {
    return {
      icon: LightbulbIcon,
      label: 'The Read',
      accent: 'protected',
      title: 'You do not need more pressure. You need a cleaner load.',
      detail: `The dominant signal is recovery pressure, not lack of ambition. A smaller session will produce cleaner evidence than forcing a long one.`,
      hiddenPattern: `${c.fatigueHighDays || 1} high-risk day${(c.fatigueHighDays || 1) === 1 ? '' : 's'} are shaping your output quality.`,
      antiAdvice: 'Do not use the coach as a guilt machine. Reduce the scope and still finish something real.',
      experiment: 'Run a short focus block, stop cleanly, and protect the next recovery window.',
      tone: 'recovery',
    }
  }

  if ((browser.pressureScore || 0) >= 58 || (browser.distractingShare || 0) >= 0.4) {
    return {
      icon: FlameIcon,
      label: 'The Read',
      accent: 'sealed',
      title: 'Your attention is leaking at the edges.',
      detail: `${browser.leadSiteLabel || 'Browser activity'} is creating the loudest signal. The win is not working harder; it is closing the leak before the next block starts.`,
      hiddenPattern: `${browser.pressureScore || 0}/100 browser pressure is competing with your focus rhythm.`,
      antiAdvice: 'Do not keep the distracting tab open as a test of discipline. Design the room, then work in it.',
      experiment: 'Start one focus block with the lead distraction closed for the full session.',
      tone: 'attention',
    }
  }

  if ((taskSummary.overdue || 0) > 0 || (taskSummary.highPriorityOpen || 0) > 0) {
    return {
      icon: TargetIcon,
      label: 'The Read',
      accent: 'finished',
      title: 'The board is asking for one decisive finish.',
      detail: `Task pressure is now useful only if it becomes a focused block. Pick the task that would make the day feel lighter.`,
      hiddenPattern: `${taskSummary.overdue || 0} overdue and ${taskSummary.highPriorityOpen || 0} high-priority task${(taskSummary.highPriorityOpen || 0) === 1 ? '' : 's'} are pulling attention.`,
      antiAdvice: 'Do not browse the whole task list again. Choose one task and let the session create the proof.',
      experiment: move.action || 'Link the next task to a 25-minute focus session.',
      tone: 'execution',
    }
  }

  if ((c.avgFocusScore || 0) >= 75) {
    return {
      icon: CheckCircleIcon,
      label: 'The Read',
      accent: 'protected',
      title: 'You already have a pattern worth protecting.',
      detail: `The current focus signal is strong. The best move is to repeat the conditions before adding new complexity.`,
      hiddenPattern: `${c.avgFocusScore}/100 average focus is a strong baseline; preserve the setup that created it.`,
      antiAdvice: 'Do not chase novelty when the system is already showing traction.',
      experiment: 'Repeat your best recent focus window and keep the setup unchanged.',
      tone: 'momentum',
    }
  }

  return {
    icon: BrainIcon,
    label: 'The Read',
    accent: 'measured',
    title: 'You are close to a useful rhythm. Change one variable.',
    detail: `Velance sees mixed evidence across ${rangeLabel}. The smart move is a controlled experiment, not a bigger productivity system.`,
    hiddenPattern: move.insight || 'The signal is useful, but still too mixed to justify dramatic changes.',
    antiAdvice: 'Do not stack five improvements at once. You will not know which one worked.',
    experiment: move.action || 'Run one consistent focus block and compare it to the previous one.',
    tone: 'tuning',
  }
})

const coachReviewNotes = computed(() => [
  {
    id: 'hidden-pattern',
    icon: SparklesIcon,
    label: 'Hidden pattern',
    text: coachReview.value.hiddenPattern,
  },
  {
    id: 'anti-advice',
    icon: BanIcon,
    label: 'What not to do',
    text: coachReview.value.antiAdvice,
  },
  {
    id: 'experiment',
    icon: RocketIcon,
    label: 'Tomorrow experiment',
    text: coachReview.value.experiment,
  },
])

const dailyChallengeCandidates = computed(() => buildDailyChallengeCandidates({
  context: ctx.value,
  primaryMove: primaryCoachMove.value,
  dateKey: todayKey.value,
}))

const dailyChallenge = computed(() => pickDailyChallengeCandidate(dailyChallengeCandidates.value, todayKey.value))

function playChallengeChime() {
  try {
    const ctxAudio = new (window.AudioContext || window.webkitAudioContext)()
    ;[523, 659, 784].forEach((frequency, index) => {
      const osc = ctxAudio.createOscillator()
      const gain = ctxAudio.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(0.045, ctxAudio.currentTime + index * 0.055)
      gain.gain.exponentialRampToValueAtTime(0.001, ctxAudio.currentTime + index * 0.055 + 0.18)
      osc.connect(gain)
      gain.connect(ctxAudio.destination)
      osc.start(ctxAudio.currentTime + index * 0.055)
      osc.stop(ctxAudio.currentTime + index * 0.055 + 0.18)
    })
  } catch {}
}

function launchChallengeFocus(task = todayChallengeTask.value) {
  if (!task) return
  const linkedHabit = task.habit ? store.habits.find((habit) => habit.name === task.habit) : null
  primeFocusLaunch({
    source: 'task',
    title: task.title,
    habit: task.habit || null,
    habitId: linkedHabit?.id || null,
    goal: task.title,
    taskId: task.id || null,
    durationGoalMinutes: linkedHabit?.targetMinutes || null,
    habitColor: linkedHabit?.color || null,
  })
  if (task.id && String(task.status || 'to-do') === 'to-do') {
    void store.updateTask(task.id, { status: 'in-progress' })
  }
  router.push('/focus')
}

async function acceptDailyChallenge({ startFocus = false } = {}) {
  let task = todayChallengeTask.value
  if (!task) {
    await store.addTask(buildChallengeTaskPayload(dailyChallenge.value, todayKey.value))
    task = getTodayChallengeTask(store.tasks, todayKey.value)
  }
  saveAcceptedChallenge(store.currentWorkspaceId, todayKey.value, {
    taskId: task?.id || null,
    title: dailyChallenge.value.taskTitle,
  })
  challengeAcceptedTick.value += 1
  playChallengeChime()
  if (startFocus && task) {
    launchChallengeFocus(task)
    return
  }
  router.push('/tasks')
}

const feedbackByInsightId = computed(() => Object.fromEntries(
  (store.insightFeedback || []).map((entry) => [entry.insightId, entry.feedback]),
))

function isInsightExpanded(id) {
  return expandedInsightIds.value.has(id)
}

function toggleInsightWhy(id) {
  const next = new Set(expandedInsightIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedInsightIds.value = next
}

function buildInsightWhy(insight) {
  const c = ctx.value
  const browser = c.browserEvidence || {}
  const quality = c.dataQuality || {}
  const source = canUseAiCoach.value && String(insight.id || '').startsWith('ai-')
    ? `${aiProviderMeta.value.label} summarized Velance evidence`
    : 'Velance local evidence engine'

  return [
    {
      label: 'Source',
      value: source,
    },
    {
      label: 'Evidence',
      value: insight.evidence || `${c.sessions} sessions, ${c.ambientSummary?.totalMinutes || 0}m tracked usage`,
    },
    {
      label: 'Confidence',
      value: `${insight.confidence || quality.recommendationConfidence || 'medium'} confidence, ${readinessScore.value}% readiness`,
    },
    {
      label: 'Range',
      value: `${selectedRangeDays.value === 1 ? 'Today' : `${selectedRangeDays.value} days`} | ${c.sessions} focus blocks | ${browser.totalEvents || 0} browser events`,
    },
  ]
}

async function rateInsight(insight, feedback) {
  await store.saveInsightFeedback({
    insightId: insight.id,
    feedback,
  })
}
</script>

<template>
  <div class="insights-module">
    <header class="page-header">
      <div>
        <h1 class="page-title">Insights</h1>
        <p class="page-sub">
          <span v-if="canUseAiCoach">{{ aiProviderMeta.label }} Coach is reviewing your Velance evidence and turning it into next steps.</span>
          <span v-else-if="aiAvailable">Velance system insights are active. BYOK AI is saved and can be switched on here.</span>
          <span v-else>Velance system insights are active. <router-link to="/settings" class="key-link">Open Settings</router-link> to configure BYOK AI.</span>
        </p>
      </div>
      <div class="header-actions">
        <div class="range-switcher" aria-label="Insight range">
          <button
            v-for="option in rangeOptions"
            :key="option.days"
            type="button"
            :class="{ active: selectedRangeDays === option.days }"
            @click="selectedRangeDays = option.days"
          >
            {{ option.label }}
          </button>
        </div>
        <span class="mode-pill" :class="{ local: usingLocalInsights }">{{ insightModeLabel }}</span>
        <span v-if="lastGenerated" class="last-gen">Generated {{ timeSince }}</span>
        <button class="refresh-btn" @click="generateInsights()" :disabled="loading">
          <RefreshCwIcon size="15" :class="{ spinning: loading }" />
          {{ loading ? 'Generating...' : 'Refresh' }}
        </button>
      </div>
    </header>

    <div class="mode-control-strip">
      <div class="mode-copy">
        <span>Engine</span>
        <strong>{{ canUseAiCoach ? `${aiProviderMeta.label} Coach` : 'Velance local coach' }}</strong>
        <p>{{ aiStatusReason }}</p>
      </div>
      <div class="mode-control-actions">
        <button
          v-if="hasApiKey"
          class="ai-toggle"
          :class="{ active: canUseAiCoach }"
          @click="toggleAiInsights"
        >
          <span class="toggle-track"><span></span></span>
          {{ canUseAiCoach ? 'AI coach on' : 'AI coach off' }}
        </button>
        <router-link v-else to="/settings" class="settings-link">Add AI key</router-link>
        <span class="storage-note">{{ accountSummary.storagePill }} | {{ accountSummary.migrationLabel }}</span>
      </div>
    </div>

    <section v-if="canUseAiCoach" class="coach-review-stage" :class="coachReview.tone">
      <article class="daily-read-panel">
        <div class="read-shell">
          <div class="read-topline">
            <div class="read-icon">
              <component :is="coachReview.icon" size="21" />
            </div>
            <span>{{ coachReview.label }}</span>
          </div>

          <h2 class="read-statement">
            {{ coachReview.title }}
          </h2>

          <p class="read-detail">{{ coachReview.detail }}</p>

          <div class="read-footer">
            <span>{{ aiProviderMeta.label }} review</span>
            <strong>{{ readinessScore }}% confidence</strong>
            <strong>{{ selectedRangeDays === 1 ? 'Daily read' : `${selectedRangeDays}-day read` }}</strong>
          </div>
        </div>
      </article>

      <article class="daily-challenge-panel" :class="{ accepted: hasAcceptedChallenge }">
        <div class="challenge-orbit">
          <TargetIcon size="23" />
        </div>
        <div class="challenge-copy">
          <span>{{ dailyChallenge.title }}</span>
          <h3>{{ dailyChallenge.taskTitle }}</h3>
          <p>{{ dailyChallenge.body }}</p>
          <div class="challenge-why">
            <LightbulbIcon size="14" />
            <span>{{ dailyChallenge.why }}</span>
          </div>
          <div class="challenge-stats" aria-label="Daily challenge streak">
            <span><strong>{{ challengeStats.currentStreak }}</strong> day streak</span>
            <span><strong>{{ challengeStats.completedTotal }}</strong> completed</span>
            <span><strong>{{ challengeStats.acceptedTotal }}</strong> accepted</span>
          </div>
        </div>

        <div v-if="hasAcceptedChallenge" class="challenge-accepted">
          <CheckCircleIcon size="15" />
          <span>Accepted and highlighted in Tasks.</span>
        </div>

        <div class="challenge-actions">
          <button
            v-if="!hasAcceptedChallenge"
            type="button"
            class="challenge-primary"
            @click="acceptDailyChallenge({ startFocus: true })"
          >
            Accept and start focus
            <PlayIcon size="14" />
          </button>
          <button
            v-else
            type="button"
            class="challenge-primary"
            @click="launchChallengeFocus()"
          >
            Start challenge focus
            <PlayIcon size="14" />
          </button>
          <button
            type="button"
            class="challenge-secondary"
            @click="hasAcceptedChallenge ? router.push('/tasks') : acceptDailyChallenge()"
          >
            {{ hasAcceptedChallenge ? 'Open in Tasks' : 'Add to Tasks' }}
            <ArrowRightIcon size="14" />
          </button>
        </div>
      </article>
    </section>

    <section v-if="canUseAiCoach" class="coach-review-notes">
      <div v-for="note in coachReviewNotes" :key="note.id" class="review-note">
        <div class="review-note-icon">
          <component :is="note.icon" size="15" />
        </div>
        <div>
          <span>{{ note.label }}</span>
          <strong>{{ note.text }}</strong>
        </div>
      </div>
    </section>

    <section v-else class="coach-room" :class="coachState.tone">
      <article class="coach-brief-panel">
        <div class="coach-eyebrow">
          <span>{{ coachState.label }}</span>
          <strong>{{ coachState.mood }}</strong>
          <strong>{{ readinessScore }}% confidence</strong>
        </div>
        <h2>{{ coachState.title }}</h2>
        <p>{{ coachNarrative }}</p>

        <div
          class="coach-one-move"
          :style="{ '--move-color': categoryConfig[primaryCoachMove.category]?.color || '#00B4D8' }"
        >
          <span class="move-kicker">Coach's one move</span>
          <h3>{{ primaryCoachMove.title }}</h3>
          <p>{{ primaryCoachMove.action }}</p>
          <div class="move-evidence">
            <span>{{ primaryCoachMove.metricLabel || 'Evidence' }}</span>
            <strong>{{ primaryCoachMove.metricValue || primaryCoachMove.evidence || 'Early signal' }}</strong>
          </div>
        </div>

        <div class="coach-quick-actions">
          <router-link class="coach-main-link" to="/focus">
            Start focus block
            <ArrowRightIcon size="14" />
          </router-link>
          <router-link class="coach-secondary-link" to="/tasks">
            Link work context
          </router-link>
        </div>
      </article>

    </section>

    <div v-if="!hasEnoughBaselineData" class="baseline-note slim">
      <AlertTriangleIcon size="14" />
      <span>
        {{ ctx.sessions === 0
          ? 'These are baseline recommendations until more real focus sessions are recorded.'
          : `Velance has only ${ctx.sessions} tracked session${ctx.sessions === 1 ? '' : 's'} so far. Treat these recommendations as early signals, not firm conclusions.` }}
      </span>
    </div>

    <div v-if="error" class="error-banner">
      <AlertTriangleIcon size="15" />
      <span>{{ error }}. Using local insights instead.</span>
      <button @click="error = ''">x</button>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="ld-ring"></div>
      <p>{{ canUseAiCoach ? `${aiProviderMeta.label} Coach is reading your ${ctx.period} of summarized tracking data...` : 'Refreshing Velance local analysis from your saved tracking data...' }}</p>
    </div>

    <section v-else-if="coachFeed.length" class="recommendation-panel">
      <div class="section-heading">
        <div>
          <span class="section-kicker">Recommendations</span>
          <h2>What Velance would change next</h2>
        </div>
        <span class="section-note">{{ canUseAiCoach ? `${aiProviderMeta.label} enhanced` : 'Local engine' }} | {{ coachingSummary.detail }}</span>
      </div>
      <div class="recommendation-list">
        <div
        v-for="insight in coachFeed"
        :key="insight.id"
        class="recommendation-row"
        :style="{ '--ic-color': categoryConfig[insight.category]?.color || '#00B4D8' }"
      >
          <div class="rec-main">
            <span>{{ categoryConfig[insight.category]?.label || 'Insight' }}</span>
            <h3>{{ insight.title }}</h3>
            <p>{{ insight.insight }}</p>
          </div>
          <div class="rec-action">
            <span>{{ insight.metricValue || insight.evidence || 'Signal' }}</span>
            <strong>{{ insight.action }}</strong>
            <button class="ic-why-toggle" type="button" @click="toggleInsightWhy(insight.id)">
              {{ isInsightExpanded(insight.id) ? 'Hide why' : 'Why?' }}
              <ArrowRightIcon size="13" :class="{ open: isInsightExpanded(insight.id) }" />
            </button>
          </div>
          <div v-if="isInsightExpanded(insight.id)" class="ic-why-panel">
            <div
              v-for="row in buildInsightWhy(insight)"
              :key="`${insight.id}-${row.label}`"
              class="ic-why-row"
            >
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div v-else class="empty-state">
      <div class="es-icon">I</div>
      <h3>No insights yet</h3>
      <p>Velance refreshes this page automatically from saved work evidence. Start one focus block to give the coach something real to read.</p>
    </div>

    <div v-if="usingLocalInsights && insights.length" class="source-note">
      <SparklesIcon size="13" />
      <p>
        Velance is using local coaching right now.
        <span v-if="error">The AI provider did not complete the request, so Velance kept the page useful with local recommendations.</span>
        <span v-else-if="!hasApiKey">Add and test your <router-link to="/settings" class="key-link">own AI API key</router-link> to turn on the coach.</span>
        <span v-else-if="!aiInsightsEnabled">Turn on AI coach above when you want provider-powered recommendations.</span>
        <span v-else-if="!hasEnoughBaselineData">Velance is still building your baseline, so the coach will get sharper after more sessions.</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.insights-module { padding: 34px 38px 42px; display: flex; flex-direction: column; gap: 22px; max-width: 1180px; margin: 0 auto; }
.page-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
.page-title { font-size: 28px; font-weight: 850; letter-spacing: -0.03em; margin-bottom: 6px; }
.page-sub { max-width: 640px; font-size: 13px; color: var(--text-muted); font-weight: 600; line-height: 1.55; }
.key-link { color: var(--accent-base); font-weight: 700; text-decoration: none; }
.key-link:hover { text-decoration: underline; }

.header-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.range-switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
}
.range-switcher button {
  border: none;
  border-radius: 999px;
  padding: 7px 10px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}
.range-switcher button.active {
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
  color: var(--accent-base);
}
.mode-control-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
}
.mode-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.mode-copy span {
  color: var(--accent-base);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.mode-copy strong {
  font-size: 14px;
}
.mode-copy p,
.storage-note {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}
.mode-control-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ai-toggle,
.settings-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 38px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  color: var(--text-main);
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  text-decoration: none;
}
.ai-toggle:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}
.ai-toggle.active {
  color: var(--accent-base);
  border-color: color-mix(in srgb, var(--accent-base) 36%, transparent);
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
}
.toggle-track {
  position: relative;
  width: 34px;
  height: 18px;
  border-radius: 999px;
  background: var(--border-light);
  transition: background 0.2s ease;
}
.toggle-track span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: var(--text-muted);
  transition: transform 0.2s ease, background 0.2s ease;
}
.ai-toggle.active .toggle-track {
  background: color-mix(in srgb, var(--accent-base) 30%, transparent);
}
.ai-toggle.active .toggle-track span {
  transform: translateX(16px);
  background: var(--accent-base);
}
.ai-engine-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.ai-engine-card {
  position: relative;
  overflow: hidden;
  min-height: 128px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  box-shadow: 0 12px 26px rgba(15, 23, 42, 0.05);
}
.ai-engine-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--accent-base);
  opacity: 0.9;
}
.ai-engine-card.good::before {
  background: #0f766e;
}
.ai-engine-card.warn::before {
  background: #F59E0B;
}
.ai-engine-card span {
  display: block;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.ai-engine-card strong {
  display: block;
  margin-top: 8px;
  color: var(--text-main);
  font-size: 18px;
  line-height: 1.15;
}
.ai-engine-card p {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--accent-base) 8%, transparent);
  color: var(--text-main);
  font-size: 11px;
  font-weight: 700;
}
.status-chip.warn {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
}
.status-note { font-size: 12px; color: var(--text-muted); }
.mode-pill {
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(0, 180, 216, 0.1);
  color: var(--accent-base);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.mode-pill.local {
  background: rgba(245, 158, 11, 0.12);
  color: #F59E0B;
}
.last-gen { font-size: 12px; font-weight: 600; color: var(--text-muted); }
.refresh-btn {
  display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 12px; border: 1px solid var(--border-light);
  background: var(--bg-card); color: var(--text-main); font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s;
}
.refresh-btn:hover:not(:disabled) { border-color: var(--accent-base); color: var(--accent-base); }
.refresh-btn:disabled { opacity: 0.6; cursor: not-allowed; }
@keyframes spin { to { transform: rotate(360deg); } }
.spinning { animation: spin 1s linear infinite; }

.coach-review-stage {
  display: grid;
  grid-template-columns: minmax(0, 1.18fr) minmax(330px, 0.82fr);
  gap: 16px;
  align-items: stretch;
}
.daily-read-panel,
.daily-challenge-panel {
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.08);
}
.daily-read-panel {
  min-height: 360px;
  background:
    radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--accent-base) 18%, transparent), transparent 30%),
    linear-gradient(135deg, color-mix(in srgb, var(--accent-base) 12%, transparent), transparent 40%),
    linear-gradient(150deg, transparent 58%, rgba(82, 183, 136, 0.1)),
    var(--bg-card);
}
.daily-read-panel::before {
  content: '';
  position: absolute;
  inset: -40% -20% auto -20%;
  height: 76%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.72), transparent);
  transform: translateX(-58%) rotate(7deg);
  animation: readSheen 8s ease-in-out infinite;
  pointer-events: none;
}
.daily-read-panel::after {
  content: '';
  position: absolute;
  inset: auto 24px 22px auto;
  width: 110px;
  height: 110px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent-base) 24%, transparent);
  box-shadow: 0 0 42px color-mix(in srgb, var(--accent-base) 22%, transparent);
  opacity: 0.7;
  animation: readPulse 5.5s ease-in-out infinite;
}
.read-shell {
  position: relative;
  z-index: 1;
  min-height: 360px;
  padding: 30px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.read-topline {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  color: var(--accent-base);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.read-icon,
.review-note-icon,
.challenge-orbit {
  display: grid;
  place-items: center;
  color: white;
  background: var(--accent-gradient);
}
.read-icon {
  width: 42px;
  height: 42px;
  border-radius: 15px;
  box-shadow: 0 14px 26px var(--accent-glow);
  animation: iconFloat 4.2s ease-in-out infinite;
}
.read-statement {
  max-width: 780px;
  color: var(--text-main);
  font-size: clamp(36px, 5.6vw, 62px);
  line-height: 0.94;
  letter-spacing: -0.055em;
}
.read-detail {
  max-width: 700px;
  color: var(--text-muted);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.7;
}
.read-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
}
.read-footer span,
.read-footer strong,
.challenge-accepted {
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--accent-base) 7%, var(--bg-card));
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 850;
  padding: 8px 10px;
}
.read-footer strong {
  color: var(--text-main);
}
.daily-challenge-panel {
  min-height: 360px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background:
    linear-gradient(155deg, color-mix(in srgb, var(--accent-base) 11%, transparent), transparent 48%),
    linear-gradient(20deg, rgba(82, 183, 136, 0.13), transparent 42%),
    var(--bg-card);
}
.daily-challenge-panel.accepted {
  border-color: color-mix(in srgb, #52B788 36%, var(--border-light));
  box-shadow: 0 22px 48px rgba(20, 184, 166, 0.14);
}
.challenge-orbit {
  width: 54px;
  height: 54px;
  border-radius: 18px;
  box-shadow: 0 16px 30px var(--accent-glow);
  animation: challengeGlow 3.8s ease-in-out infinite;
}
.challenge-copy {
  display: grid;
  gap: 10px;
}
.challenge-copy > span,
.review-note span {
  color: var(--accent-base);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.challenge-copy h3 {
  color: var(--text-main);
  font-size: 28px;
  line-height: 1.05;
  letter-spacing: -0.035em;
}
.challenge-copy p {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.62;
}
.challenge-why {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--accent-base) 18%, var(--border-light));
  background: color-mix(in srgb, var(--accent-base) 7%, transparent);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}
.challenge-why svg {
  flex: 0 0 auto;
  color: var(--accent-base);
  margin-top: 1px;
}
.challenge-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.challenge-stats span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 7px 9px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 70%, transparent);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}
.challenge-stats strong {
  color: var(--text-main);
  font-size: 12px;
}
.challenge-accepted {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  width: fit-content;
  color: #0f766e;
  background: rgba(82, 183, 136, 0.12);
  border-color: rgba(82, 183, 136, 0.26);
}
.challenge-actions {
  display: grid;
  gap: 9px;
  margin-top: auto;
}
.challenge-primary,
.challenge-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border-radius: 14px;
  font: inherit;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.challenge-primary {
  border: none;
  color: white;
  background: var(--accent-gradient);
  box-shadow: 0 16px 30px var(--accent-glow);
}
.challenge-secondary {
  border: 1px solid var(--border-light);
  color: var(--text-main);
  background: color-mix(in srgb, var(--accent-base) 5%, var(--bg-card));
}
.challenge-primary:hover,
.challenge-secondary:hover {
  transform: translateY(-1px);
}
.coach-review-notes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 10px;
  border-radius: 22px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 86%, transparent);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.045);
}
.review-note {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  min-height: 92px;
  padding: 13px;
  border-radius: 16px;
  transition: background 0.18s ease, transform 0.18s ease;
}
.review-note:hover {
  background: color-mix(in srgb, var(--accent-base) 5%, transparent);
  transform: translateY(-1px);
}
.review-note-icon {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
}
.review-note strong {
  display: block;
  margin-top: 5px;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.48;
}
@keyframes readSheen {
  0%, 55% { transform: translateX(-58%) rotate(7deg); opacity: 0; }
  70% { opacity: 0.72; }
  100% { transform: translateX(70%) rotate(7deg); opacity: 0; }
}
@keyframes readPulse {
  0%, 100% { transform: scale(0.92); opacity: 0.42; }
  50% { transform: scale(1.04); opacity: 0.82; }
}
@keyframes iconFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes challengeGlow {
  0%, 100% { transform: translateY(0); box-shadow: 0 16px 30px var(--accent-glow); }
  50% { transform: translateY(-3px); box-shadow: 0 22px 38px var(--accent-glow); }
}

.coach-room {
  display: block;
}
.coach-brief-panel,
.playbook-card,
.friction-map,
.proof-drawer,
.coach-feed-card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06);
}
.coach-brief-panel {
  border-radius: 24px;
  padding: 26px;
  min-height: 360px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent-base) 13%, transparent), transparent 44%),
    linear-gradient(160deg, transparent 56%, rgba(82, 183, 136, 0.08)),
    var(--bg-card);
}
.coach-room.warn .coach-brief-panel {
  background:
    linear-gradient(135deg, rgba(245, 158, 11, 0.14), transparent 42%),
    linear-gradient(160deg, transparent 58%, color-mix(in srgb, var(--accent-base) 7%, transparent)),
    var(--bg-card);
}
.coach-room.health .coach-brief-panel {
  background:
    linear-gradient(135deg, rgba(82, 183, 136, 0.15), transparent 44%),
    linear-gradient(160deg, transparent 58%, rgba(14, 165, 233, 0.08)),
    var(--bg-card);
}
.coach-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.coach-eyebrow span,
.move-kicker,
.playbook-step strong,
.friction-chip span,
.feed-topline span,
.proof-drawer summary span {
  color: var(--accent-base);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.coach-eyebrow strong {
  padding: 6px 9px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 11px;
}
.coach-brief-panel h2 {
  max-width: 720px;
  font-size: clamp(28px, 4.2vw, 46px);
  line-height: 0.98;
  letter-spacing: -0.035em;
}
.coach-brief-panel > p {
  max-width: 760px;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.65;
}
.coach-one-move {
  border-left: 4px solid var(--move-color);
  border-radius: 18px;
  padding: 16px 18px;
  background: color-mix(in srgb, var(--move-color) 8%, var(--bg-card));
  display: grid;
  gap: 9px;
}
.coach-one-move h3 {
  font-size: 20px;
  line-height: 1.2;
}
.coach-one-move p {
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.55;
}
.move-evidence {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  padding: 7px 10px;
  border-radius: 999px;
  background: var(--bg-card);
  border: 1px solid color-mix(in srgb, var(--move-color) 20%, var(--border-light));
}
.move-evidence span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.move-evidence strong {
  color: var(--move-color);
  font-size: 12px;
}
.coach-quick-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: auto;
}
.coach-main-link,
.coach-secondary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 850;
  text-decoration: none;
}
.coach-main-link {
  background: var(--accent-gradient);
  color: #fff;
  box-shadow: 0 14px 26px var(--accent-glow);
}
.coach-secondary-link {
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  color: var(--text-main);
}
.coach-proof-stack {
  display: grid;
  gap: 9px;
  margin-top: 4px;
}
.coach-proof-row {
  display: grid;
  grid-template-columns: minmax(86px, 0.85fr) minmax(72px, 0.55fr) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 13px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
}
.coach-proof-row span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 850;
}
.coach-proof-row strong {
  font-size: 14px;
}
.coach-proof-row small {
  min-width: 0;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.coach-proof-row.good strong { color: #0f766e; }
.coach-proof-row.warn strong { color: #C2410C; }
.coach-proof-compact {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.coach-proof-compact span {
  padding: 7px 9px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}
.recommendation-panel {
  display: grid;
  gap: 16px;
  padding: 22px;
  border-radius: 24px;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06);
}
.recommendation-list {
  display: grid;
  gap: 0;
  border: 1px solid var(--border-light);
  border-radius: 18px;
  overflow: hidden;
}
.recommendation-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 0.46fr);
  gap: 18px;
  padding: 18px;
  border-left: 4px solid var(--ic-color);
  background: var(--bg-card);
}
.recommendation-row + .recommendation-row {
  border-top: 1px solid var(--border-light);
}
.rec-main {
  min-width: 0;
  display: grid;
  gap: 7px;
}
.rec-main span,
.rec-action span {
  color: var(--ic-color);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.rec-main h3 {
  color: var(--text-main);
  font-size: 17px;
  line-height: 1.25;
}
.rec-main p {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.58;
}
.rec-action {
  align-self: stretch;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 13px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ic-color) 6%, var(--surface-muted));
}
.rec-action strong {
  color: var(--text-main);
  font-size: 12.5px;
  line-height: 1.5;
}
.playbook-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.playbook-card {
  position: relative;
  overflow: hidden;
  min-height: 172px;
  border-radius: 20px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.playbook-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 4px;
  background: var(--accent-gradient);
}
.playbook-card.warning::before,
.playbook-card.warn::before {
  background: linear-gradient(90deg, #F59E0B, #EF4444);
}
.playbook-card.health::before {
  background: linear-gradient(90deg, #52B788, #0EA5E9);
}
.playbook-step {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.playbook-step span {
  color: var(--text-main);
  font-size: 22px;
  font-weight: 900;
  line-height: 1;
}
.playbook-card h3 {
  font-size: 16px;
  line-height: 1.28;
}
.playbook-card p {
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.58;
}
.friction-map {
  border-radius: 20px;
  padding: 18px;
}
.friction-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}
.friction-chip {
  border-radius: 16px;
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  padding: 13px 14px;
  display: grid;
  gap: 5px;
}
.friction-chip strong {
  font-size: 13px;
  line-height: 1.35;
}
.friction-chip.good span,
.friction-chip.good strong { color: #0f766e; }
.friction-chip.danger span,
.friction-chip.danger strong { color: #be123c; }
.friction-chip.health span,
.friction-chip.health strong { color: #047857; }
.friction-chip.warn span,
.friction-chip.warn strong { color: #C2410C; }
.coach-feed-section {
  display: flex;
  flex-direction: column;
}
.coach-feed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 16px;
}
.coach-feed-card {
  position: relative;
  overflow: hidden;
  min-height: 290px;
  border-radius: 20px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 4px solid var(--ic-color);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}
.coach-feed-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.1);
  border-color: color-mix(in srgb, var(--ic-color) 34%, var(--border-light));
}
.feed-topline,
.feed-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.feed-topline strong {
  flex: 0 1 auto;
  min-width: 0;
  padding: 6px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ic-color) 8%, transparent);
  color: var(--ic-color);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.coach-feed-card h3 {
  font-size: 18px;
  line-height: 1.24;
}
.feed-insight {
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.62;
}
.feed-action {
  display: grid;
  gap: 5px;
  padding: 11px 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ic-color) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--ic-color) 14%, var(--border-light));
}
.feed-action span {
  color: var(--ic-color);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.feed-action strong {
  color: var(--text-main);
  font-size: 12.5px;
  line-height: 1.45;
}
.feed-feedback {
  display: inline-flex;
  gap: 6px;
}
.feed-feedback button {
  border: 1px solid var(--border-light);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  padding: 7px 9px;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}
.feed-feedback button.active {
  color: var(--accent-base);
  border-color: color-mix(in srgb, var(--accent-base) 34%, transparent);
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
}
.proof-drawer {
  border-radius: 18px;
  padding: 0;
  overflow: hidden;
}
.proof-drawer summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 15px 18px;
  cursor: pointer;
}
.proof-drawer summary strong {
  color: var(--text-muted);
  font-size: 12px;
}
.proof-drawer[open] {
  padding-bottom: 18px;
}
.proof-drawer .evidence-grid {
  padding: 0 18px;
}

.briefing-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.36fr) minmax(280px, 0.64fr);
  gap: 16px;
}
.briefing-panel,
.readiness-panel,
.signal-card,
.action-card,
.evidence-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  box-shadow: 0 14px 34px rgba(15, 23, 42, 0.06);
}
.briefing-panel {
  border-radius: 22px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent-base) 11%, transparent), transparent 42%),
    var(--bg-card);
}
.briefing-kicker,
.section-kicker,
.signal-card span,
.readiness-head span {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--accent-base);
}
.briefing-panel h2,
.section-heading h2 {
  font-size: 21px;
  line-height: 1.18;
}
.briefing-panel p,
.readiness-panel p,
.signal-card p,
.action-copy p,
.evidence-empty,
.section-note {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}
.briefing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}
.briefing-link,
.briefing-secondary,
.action-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}
.briefing-link {
  padding: 10px 14px;
  background: var(--accent-gradient);
  color: #fff;
  border: none;
  box-shadow: 0 12px 24px var(--accent-glow);
}
.briefing-secondary {
  padding: 10px 14px;
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  color: var(--text-main);
}
.briefing-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.readiness-panel {
  border-radius: 22px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.readiness-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.readiness-head strong {
  font-size: 28px;
  line-height: 1;
}
.readiness-meter {
  height: 9px;
  border-radius: 999px;
  background: var(--surface-muted);
  overflow: hidden;
}
.readiness-meter span {
  display: block;
  height: 100%;
  min-width: 4px;
  border-radius: inherit;
  background: var(--accent-gradient);
}
.readiness-panel.warn .readiness-meter span,
.signal-card.warn::before {
  background: linear-gradient(90deg, #F59E0B, #EF4444);
}
.readiness-panel.good .readiness-meter span,
.signal-card.good::before {
  background: linear-gradient(90deg, #52B788, #14B8A6);
}
.readiness-panel h3 {
  font-size: 16px;
}
.readiness-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.readiness-meta span,
.coaching-pill {
  padding: 7px 10px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}
.signal-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.usage-stat-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.usage-stat-card {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  padding: 16px;
  min-height: 118px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-elevation);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.usage-stat-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--accent-gradient);
}
.usage-stat-card.warn::before {
  background: linear-gradient(90deg, #F59E0B, #EF4444);
}
.usage-stat-card.good::before {
  background: linear-gradient(90deg, #52B788, #14B8A6);
}
.usage-stat-card span {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--accent-base);
}
.usage-stat-card strong {
  font-size: 24px;
  line-height: 1;
}
.usage-stat-card p {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}
.signal-card {
  position: relative;
  overflow: hidden;
  border-radius: 18px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.signal-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--accent-gradient);
}
.signal-card strong {
  font-size: 22px;
  line-height: 1;
}
.signal-card.steady::before {
  background: linear-gradient(180deg, #0EA5E9, #14B8A6);
}
.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.action-grid,
.evidence-grid {
  display: grid;
  gap: 12px;
}
.action-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.action-card {
  border-radius: 18px;
  padding: 16px;
  display: flex;
  gap: 12px;
}
.action-icon {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
  color: var(--accent-base);
}
.action-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.action-copy h3,
.evidence-panel h3 {
  font-size: 15px;
}
.action-link {
  width: fit-content;
  color: var(--accent-base);
}
.evidence-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.evidence-panel {
  border-radius: 18px;
  padding: 16px;
}
.evidence-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.evidence-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 12px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
}
.evidence-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}
.evidence-row strong {
  flex: 0 0 auto;
  color: var(--text-main);
  font-size: 12px;
}
.evidence-row.productive strong { color: #0f766e; }
.evidence-row.supporting strong { color: #5B21B6; }
.evidence-row.unclear strong { color: #C2410C; }
.evidence-row.distracting strong { color: #be123c; }
.evidence-empty {
  margin-top: 12px;
}

.context-bar {
  display: flex; align-items: center; background: var(--bg-card); border: 1px solid var(--border-light);
  border-radius: 16px; padding: 16px 24px; gap: 0;
}
.browser-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 16px;
  padding: 16px 18px;
}
.browser-bar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.browser-bar-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.browser-bar-card {
  border-radius: 14px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--accent-base) 5%, transparent);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.browser-bar-card span,
.browser-bar-card small {
  color: var(--text-muted);
}
.browser-bar-card span {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.45px;
  text-transform: uppercase;
}
.browser-bar-card strong {
  font-size: 15px;
  line-height: 1.35;
}
.browser-bar-card small {
  font-size: 12px;
  line-height: 1.5;
}
.cb-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.cb-val { font-size: 18px; font-weight: 800; }
.cb-lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text-muted); }
.cb-div { width: 1px; height: 32px; background: var(--border-light); }

.baseline-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.24);
  color: #F59E0B;
  font-size: 12px;
  font-weight: 600;
}

.error-banner { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.3); border-radius: 12px; font-size: 13px; color: #F59E0B; }
.error-banner button { margin-left: auto; background: none; border: none; cursor: pointer; color: #F59E0B; font-size: 16px; }
.loading-state { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 60px; text-align: center; }
.ld-ring { width: 40px; height: 40px; border-radius: 50%; border: 3px solid var(--border-light); border-top-color: var(--accent-base); animation: spin 0.8s linear infinite; }
.loading-state p { font-size: 13px; color: var(--text-muted); }

.insights-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 16px; }
.insight-card {
  background: var(--bg-card); border: 1px solid var(--border-light); border-radius: 16px; padding: 18px;
  display: flex; flex-direction: column; gap: 12px; min-height: 360px;
  transition: box-shadow 0.2s, transform 0.2s, border-color 0.2s;
  border-top: 3px solid var(--ic-color);
}
.insight-card:hover { transform: translateY(-2px); box-shadow: 0 16px 38px rgba(15,23,42,0.1); border-color: color-mix(in srgb, var(--ic-color) 45%, var(--border-light)); }

.ic-top { display: flex; justify-content: space-between; align-items: center; }
.ic-cat-badge { display: flex; align-items: center; gap: 6px; }
.ic-cat-icon { font-size: 13px; font-weight: 800; }
.ic-cat-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }

.ic-title { font-size: 16px; font-weight: 850; letter-spacing: -0.01em; line-height: 1.28; }
.ic-metric {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 11px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ic-color) 9%, transparent);
}
.ic-metric strong {
  font-size: 20px;
  line-height: 1;
  color: var(--ic-color);
}
.ic-metric span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ic-body {
  font-size: 12.5px;
  line-height: 1.62;
  color: var(--text-muted);
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ic-action {
  display: flex; gap: 6px; align-items: flex-start; padding: 10px 12px;
  background: color-mix(in srgb, var(--ic-color) 8%, transparent); border-radius: 10px;
  font-size: 12px; line-height: 1.45;
}
.ic-action-label { font-weight: 800; color: var(--ic-color); white-space: nowrap; }
.ic-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ic-evidence span {
  display: inline-flex;
  align-items: center;
  padding: 6px 9px;
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ic-why-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: fit-content;
  border: 1px solid color-mix(in srgb, var(--ic-color) 22%, var(--border-light));
  border-radius: 999px;
  background: color-mix(in srgb, var(--ic-color) 7%, transparent);
  color: var(--ic-color);
  padding: 7px 10px;
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
}
.ic-why-toggle svg {
  transition: transform 0.18s ease;
}
.ic-why-toggle svg.open {
  transform: rotate(90deg);
}
.ic-why-panel {
  display: grid;
  gap: 8px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--ic-color) 18%, var(--border-light));
  background: color-mix(in srgb, var(--ic-color) 5%, transparent);
  padding: 12px;
}
.ic-why-row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}
.ic-why-row span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.ic-why-row strong {
  color: var(--text-main);
  font-size: 12px;
  line-height: 1.45;
}

.ic-feedback {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 2px;
}
.ic-feedback span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}
.ic-feedback div {
  display: inline-flex;
  gap: 6px;
}
.ic-feedback button {
  border: 1px solid var(--border-light);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  padding: 6px 9px;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}
.ic-feedback button.active {
  color: var(--accent-base);
  border-color: color-mix(in srgb, var(--accent-base) 34%, transparent);
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 32px;
  text-align: center;
  border: 1px dashed color-mix(in srgb, var(--accent-base) 30%, var(--border-light));
  border-radius: 22px;
  background: color-mix(in srgb, var(--accent-base) 5%, var(--bg-card));
}
.es-icon {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: var(--accent-gradient);
  color: white;
  font-size: 24px;
  font-weight: 850;
}
.empty-state h3 { font-size: 18px; font-weight: 800; }
.empty-state p { max-width: 460px; font-size: 13px; line-height: 1.6; color: var(--text-muted); }

.source-note {
  display: flex; align-items: flex-start; gap: 10px; font-size: 12px; line-height: 1.6;
  color: var(--text-muted); padding: 14px 18px; background: var(--bg-card);
  border: 1px solid var(--border-light); border-radius: 14px;
}
.source-note svg { flex-shrink: 0; margin-top: 2px; color: var(--accent-base); }

@media (min-width: 1280px) {
  .insights-module {
    gap: 24px;
  }

  .page-sub {
    max-width: 780px;
  }

  .coach-review-stage {
    grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.65fr);
    gap: 20px;
  }

  .daily-read-panel,
  .daily-challenge-panel {
    min-height: 390px;
  }

  .read-shell {
    min-height: 390px;
    padding: 34px;
  }

  .read-statement {
    max-width: 900px;
  }

  .coach-review-notes {
    gap: 12px;
    padding: 12px;
  }

  .briefing-grid {
    grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.45fr);
    gap: 18px;
  }

  .coach-feed-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .browser-bar-grid {
    grid-template-columns: repeat(3, minmax(240px, 1fr));
  }
}

@media (max-width: 900px) {
  .insights-module { padding: 28px 22px 34px; }
  .page-header { flex-direction: column; align-items: flex-start; }
  .header-actions { justify-content: flex-start; }
  .coach-review-stage,
  .coach-review-notes,
  .coach-room,
  .recommendation-row,
  .playbook-grid,
  .coach-proof-row,
  .briefing-grid,
  .action-grid,
  .evidence-grid { grid-template-columns: 1fr; }
  .signal-grid,
  .usage-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mode-control-strip { flex-direction: column; align-items: flex-start; }
  .mode-control-actions { justify-content: flex-start; }
  .section-heading { flex-direction: column; align-items: flex-start; }
  .context-bar { flex-wrap: wrap; gap: 12px; }
  .browser-bar-grid { grid-template-columns: 1fr; }
  .cb-div { display: none; }
  .cb-item { min-width: calc(50% - 8px); }
  .feed-footer { align-items: flex-start; flex-direction: column; }
}

@media (max-width: 640px) {
  .signal-grid,
  .usage-stat-grid { grid-template-columns: 1fr; }
  .coach-brief-panel { padding: 22px; min-height: auto; }
  .coach-brief-panel h2 { font-size: 32px; }
  .coach-quick-actions,
  .briefing-actions { flex-direction: column; align-items: stretch; }
  .coach-main-link,
  .coach-secondary-link,
  .briefing-link,
  .briefing-secondary { width: 100%; }
  .action-card { flex-direction: column; }
  .friction-strip,
  .coach-feed-grid { grid-template-columns: 1fr; }
}

/* ─── DARK THEME OVERRIDES ─────────────────────────────────────────────────── */
/* Shimmer overlay that uses a hard white — replace with subtle tint in dark mode */
:global(.dark-theme .insights-module .daily-read-panel::before){
  background: linear-gradient(100deg, transparent, rgba(148, 163, 184, 0.06), transparent) !important;
}

/* Hardcoded light card backgrounds */
:global(.dark-theme .insights-module .signal-card),
:global(.dark-theme .insights-module .action-card),
:global(.dark-theme .insights-module .readiness-card),
:global(.dark-theme .insights-module .evidence-item),
:global(.dark-theme .insights-module .coach-brief-panel),
:global(.dark-theme .insights-module .briefing-panel),
:global(.dark-theme .insights-module .daily-read-panel),
:global(.dark-theme .insights-module .usage-stat-card),
:global(.dark-theme .insights-module .context-bar),
:global(.dark-theme .insights-module .friction-item),
:global(.dark-theme .insights-module .feed-item),
:global(.dark-theme .insights-module .playbook-card),
:global(.dark-theme .insights-module .ai-engine-card),
:global(.dark-theme .insights-module .insight-card),
:global(.dark-theme .insights-module .readiness-panel){
  background: var(--bg-card) !important;
  border-color: var(--surface-outline) !important;
}

/* Headings always light in dark mode */
:global(.dark-theme .insights-module h1),
:global(.dark-theme .insights-module h2),
:global(.dark-theme .insights-module h3),
:global(.dark-theme .insights-module .page-title){
  color: var(--text-main) !important;
}

/* Coach proof rows — dark semantic row labels */
:global(.dark-theme .insights-module .coach-proof-row.good strong){ color: #2dd4bf !important; }
:global(.dark-theme .insights-module .coach-proof-row.warn strong){ color: #fb923c !important; }

/* Friction chips */
:global(.dark-theme .insights-module .friction-chip.good strong){ color: #34d399 !important; }
:global(.dark-theme .insights-module .friction-chip.danger strong){ color: #fb7185 !important; }
:global(.dark-theme .insights-module .friction-chip.health strong){ color: #34d399 !important; }
:global(.dark-theme .insights-module .friction-chip.warn strong){ color: #fb923c !important; }

/* Evidence rows */
:global(.dark-theme .insights-module .evidence-row.productive strong){ color: #2dd4bf !important; }
:global(.dark-theme .insights-module .evidence-row.supporting strong){ color: #a78bfa !important; }
:global(.dark-theme .insights-module .evidence-row.unclear strong){ color: #fb923c !important; }
:global(.dark-theme .insights-module .evidence-row.distracting strong){ color: #fb7185 !important; }

/* Daily challenge panel gradient — fine in dark as it uses CSS vars */

/* Status pill tones in readiness panel */
:global(.dark-theme .insights-module .usage-stat-value.good){ color: #34d399 !important; }
:global(.dark-theme .insights-module .usage-stat-value.warn){ color: #fbbf24 !important; }
</style>
