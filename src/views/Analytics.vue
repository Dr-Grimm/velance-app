<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useVelanceStore } from '../store/velance.js'
import { useAmbientTracker } from '../composables/useAmbientTracker.js'
import { buildAnalyticsRangeModel } from '../services/analyticsService.js'
import { buildDailyAnalysisModel } from '../services/dailyAnalysisService.js'
import { buildBrowserEvidenceSummary } from '../services/browserEvidenceService.js'
import { clampRangeAnchor, formatDateKeyLabel, getTodayLocalDateKey, shiftDateKey } from '../services/dateNavigation.js'
import { formatActivityDuration } from '../services/activityTimeline.js'
import { getTrackingLaneMeta } from '../services/activityClassification.js'
import ActivityView from './Activity.vue'
import DailyAnalysisView from '../components/DailyAnalysisView.vue'
import { ArrowLeftIcon, ArrowRightIcon, CalendarIcon } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const store = useVelanceStore()
const ambient = useAmbientTracker()

const todayKey = ref(getTodayLocalDateKey())
const selectedDateKey = ref(todayKey.value)
const activeTab = ref('activity')
const highlightedEventId = ref('')

const tabs = [
  { id: 'activity', label: 'Activity' },
  { id: 'focus', label: 'Focus Depth' },
  { id: 'apps', label: 'App Usage' },
  { id: 'fatigue', label: 'Fatigue' },
  { id: 'habits', label: 'Habits' },
]

const validTabs = new Set(tabs.map((tab) => tab.id))

watch(
  () => route.query.date,
  (value) => {
    selectedDateKey.value = typeof value === 'string' && value ? value : todayKey.value
  },
  { immediate: true },
)

watch(
  () => route.query.tab,
  (value) => {
    activeTab.value = typeof value === 'string' && validTabs.has(value)
      ? value
      : (route.query.mode === 'activity' ? 'activity' : 'activity')
  },
  { immediate: true },
)

watch(
  () => route.query.mode,
  (value) => {
    if (value === 'activity' && activeTab.value !== 'activity') {
      activeTab.value = 'activity'
    }
  },
)

watch(
  () => route.query.event,
  (value) => {
    highlightedEventId.value = typeof value === 'string' ? value : ''
  },
  { immediate: true },
)

watch(
  () => [selectedDateKey.value, activeTab.value, highlightedEventId.value].join(':'),
  async () => {
    const nextQuery = {
      date: selectedDateKey.value,
      tab: activeTab.value,
    }
    if (highlightedEventId.value) nextQuery.event = highlightedEventId.value
    await router.replace({ path: '/analytics', query: nextQuery })
  },
)

onMounted(async () => {
  await ambient.attachListener()
  await ambient.refreshDate(selectedDateKey.value)
})

watch(
  () => selectedDateKey.value,
  async (value) => {
    if (!value || value > todayKey.value) {
      selectedDateKey.value = todayKey.value
      return
    }
    await ambient.refreshDate(value)
  },
)

const backgroundEntries = computed(() => ambient.getEntriesForDate(selectedDateKey.value))
const mediaEntries = computed(() => ambient.getMediaForDate(selectedDateKey.value))
const browserEvents = computed(() => ambient.getBrowserEventsForDate(selectedDateKey.value))
const dayRangeModel = computed(() => buildAnalyticsRangeModel({
  days: [selectedDateKey.value],
  sessions: store.sessions,
  habits: store.habits,
  ambientEntries: backgroundEntries.value,
  mediaEntries: mediaEntries.value,
  ambient,
}))
const dailyModel = computed(() => buildDailyAnalysisModel({
  dateKey: selectedDateKey.value,
  sessions: store.sessions,
  tasks: store.tasks,
  habits: store.habits,
  ambientEntries: backgroundEntries.value,
  mediaEntries: mediaEntries.value,
  browserEvents: browserEvents.value,
  ambient,
}))
const dayBrowserEvidence = computed(() => buildBrowserEvidenceSummary({
  ambientEntries: backgroundEntries.value,
  browserEvents: browserEvents.value,
  padMs: 0,
  limit: 4,
}))

const selectedDateLabel = computed(() => (
  selectedDateKey.value === todayKey.value
    ? `Today, ${formatDateKeyLabel(selectedDateKey.value, { weekday: 'long', month: 'short', day: 'numeric' })}`
    : formatDateKeyLabel(selectedDateKey.value, { weekday: 'long', month: 'short', day: 'numeric' })
))

const canMoveForward = computed(() => selectedDateKey.value < todayKey.value)
const productiveSeconds = computed(() => (
  (dayRangeModel.value.laneBreakdown || []).find((lane) => lane.key === 'productive')?.seconds || 0
))
const heroStats = computed(() => ([
  {
    label: 'Productive time',
    value: productiveSeconds.value ? formatActivityDuration(productiveSeconds.value) : '--',
    detail: productiveSeconds.value ? 'Best signal from tracked work' : 'No productive lane yet',
  },
  {
    label: 'Focus blocks',
    value: String(dayRangeModel.value.sessionCount || 0),
    detail: dayRangeModel.value.totalFocusMinutes ? `${dayRangeModel.value.totalFocusMinutes}m intentional work` : 'Start a session to measure depth',
  },
  {
    label: 'Daily strain',
    value: `${dailyModel.value.combinedFatigue || 0}%`,
    detail: dailyModel.value.backgroundFatigue?.dominantDriver || 'No strong strain driver',
  },
  {
    label: 'Browser pressure',
    value: dayBrowserEvidence.value.totalEvents ? `${dayBrowserEvidence.value.pressureScore || 0}/100` : 'Quiet',
    detail: dayBrowserEvidence.value.dominantPressureLabel || 'Quiet browser context',
  },
  {
    label: 'Top context',
    value: getTrackingLaneMeta(dayBrowserEvidence.value.dominantLane || 'unclear').label,
    detail: dayBrowserEvidence.value.totalEvents
      ? `${dayBrowserEvidence.value.leadSiteLabel} · ${dayBrowserEvidence.value.leadPageLabel}`
      : 'No saved browser context',
  },
]))

function shiftDay(offset) {
  selectedDateKey.value = clampRangeAnchor(shiftDateKey(selectedDateKey.value, offset), todayKey.value)
}

function jumpToToday() {
  selectedDateKey.value = todayKey.value
}

function activateDailyEvent(event) {
  activeTab.value = event?.linkedTab || 'focus'
  highlightedEventId.value = event?.id || ''
}
</script>

<template>
  <div class="analytics-page">
    <header class="analytics-header">
      <div class="header-copy">
        <span class="header-kicker">Analysis hub</span>
        <h1 class="page-title">Analytics</h1>
        <p class="page-subtitle">One selected day, five clean views, and stronger evidence over filler text.</p>
      </div>

      <div class="header-actions">
        <div class="date-nav">
          <button class="date-icon-btn" type="button" @click="shiftDay(-1)" aria-label="Previous day">
            <ArrowLeftIcon size="16" />
          </button>
          <div class="date-pill">
            <CalendarIcon size="14" />
            <span>{{ selectedDateLabel }}</span>
          </div>
          <input v-model="selectedDateKey" class="date-input" type="date" :max="todayKey" />
          <button class="date-icon-btn" :disabled="!canMoveForward" type="button" @click="shiftDay(1)" aria-label="Next day">
            <ArrowRightIcon size="16" />
          </button>
        </div>

        <button class="secondary-btn" :disabled="selectedDateKey === todayKey" type="button" @click="jumpToToday">Today</button>
      </div>
    </header>

    <section class="hero-strip">
      <article v-for="stat in heroStats" :key="stat.label" class="hero-stat">
        <span>{{ stat.label }}</span>
        <strong>{{ stat.value }}</strong>
        <p>{{ stat.detail }}</p>
      </article>
    </section>

    <section class="tabs-row">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: activeTab === tab.id }"
        type="button"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </section>

    <ActivityView
      v-if="activeTab === 'activity'"
      embedded
      :show-header="false"
      :selected-date-key="selectedDateKey"
      :highlighted-event-id="highlightedEventId"
      @update:selected-date-key="selectedDateKey = $event"
      @activate-event="activateDailyEvent"
    />

    <DailyAnalysisView
      v-else
      :show-hero="false"
      :show-tabs="false"
      :selected-date-key="selectedDateKey"
      :active-tab="activeTab"
      :highlighted-event-id="highlightedEventId"
      @update:selected-date-key="selectedDateKey = $event"
      @update:active-tab="activeTab = $event"
      @activate-event="activateDailyEvent"
    />
  </div>
</template>

<style scoped>
.analytics-page {
  padding: 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1380px;
  margin: 0 auto;
  min-width: 0;
}

.analytics-page,
.analytics-page * {
  box-sizing: border-box;
}

.analytics-header,
.header-actions,
.date-nav,
.tabs-row,
.hero-strip {
  display: flex;
}

.analytics-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
}

.header-copy {
  display: flex;
  flex-direction: column;
}

.header-kicker {
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
.hero-stat p {
  font-size: 13px;
  line-height: 1.58;
  color: var(--text-muted);
}

.header-actions,
.date-nav,
.tabs-row {
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.date-nav {
  max-width: 100%;
  padding: 8px;
  border-radius: 18px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-strong) 82%, transparent);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.04);
  backdrop-filter: blur(16px);
}

.date-pill,
.secondary-btn,
.date-icon-btn,
.tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.secondary-btn,
.date-icon-btn,
.tab-btn {
  cursor: pointer;
}

.secondary-btn:hover,
.date-icon-btn:hover,
.tab-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 22%, var(--surface-outline));
  color: var(--text-main);
}

.date-icon-btn {
  width: 38px;
  height: 38px;
  padding: 0;
}

.date-input {
  border: 1px solid var(--surface-outline);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-card) 92%, transparent);
  color: var(--text-main);
  font-size: 12px;
  font-weight: 600;
  padding: 10px 12px;
  min-width: 148px;
  max-width: 100%;
  outline: none;
}

.hero-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.hero-stat:nth-child(n + 5) {
  display: none;
}

.hero-stat {
  min-width: 0;
  padding: 18px 20px;
  border-radius: 20px;
  border: 1px solid var(--surface-outline);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent-soft) 42%, transparent), transparent 38%),
    var(--bg-card);
  box-shadow: var(--shadow-elevation);
}

.hero-stat span {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hero-stat strong {
  display: block;
  margin: 10px 0 6px;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--text-main);
}

.tab-btn.active {
  color: #ffffff;
  border-color: transparent;
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  box-shadow: 0 12px 24px rgba(14, 165, 233, 0.16);
}

.analytics-page :deep(.activity-page.embedded),
.analytics-page :deep(.daily-analysis) {
  min-width: 0;
  max-width: 100%;
  width: 100%;
  align-self: stretch;
}

:global(.dark-theme .analytics-page .hero-stat){
  background: var(--bg-card) !important;
}

/* Headings always correct in dark mode */
:global(.dark-theme .analytics-page h1),
:global(.dark-theme .analytics-page h2),
:global(.dark-theme .analytics-page h3),
:global(.dark-theme .analytics-page .page-title){
  color: var(--text-main) !important;
}

@media (max-width: 1180px) {
  .analytics-page {
    padding: 28px 22px;
  }

  .hero-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics-header {
    grid-template-columns: 1fr;
  }

  .header-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 760px) {
  .date-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .date-pill {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }

  .date-input {
    min-width: 0;
  }
}

@media (max-width: 640px) {
  .analytics-page {
    padding: 22px 16px;
  }

  .hero-strip {
    grid-template-columns: 1fr;
  }

  .date-nav,
  .date-input,
  .secondary-btn {
    width: 100%;
  }
}
</style>
