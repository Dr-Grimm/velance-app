<script setup>
import { computed, onMounted, ref, defineAsyncComponent } from 'vue'
import { useAmbientTracker, setCustomRule, removeCustomRule, getCustomRules, CATEGORY_COLORS } from '../composables/useAmbientTracker.js'
import { useActivityTracker } from '../composables/useActivityTracker.js'
import { useDailyActivitySummary } from '../composables/useDailyActivitySummary.js'
import {
  MonitorIcon, ZapIcon, ClockIcon, TargetIcon,
  AlertTriangleIcon, BrainIcon, SlidersIcon, XIcon, RefreshCwIcon
} from 'lucide-vue-next'

const ambient = useAmbientTracker()
const tracker = useActivityTracker()
const VueApexCharts = defineAsyncComponent(() =>
  import('vue3-apexcharts').then((module) => module.default)
)

// ── Start listening for ambient IPC data on mount ─────────────
onMounted(() => {
  ambient.attachListener()
  ambient.refreshToday()
})

const {
  todayEntries,
  hourlyBreakdown,
  categoryBreakdown: categoryBreak,
  appBreakdown,
  productivityScore,
  pulse,
  topCategory,
  topDistractors,
  insights,
  weeklyTrend,
  liveSnapshot,
  totalTrackedSeconds,
  totalTrackedMins,
  productiveSeconds,
  distractSeconds,
  neutralSeconds,
  trackerHealth,
  todayTimeline,
  liveTodayFallback,
} = useDailyActivitySummary()

function formatDuration(seconds = 0) {
  const safe = Math.max(0, Math.round(seconds || 0))
  if (safe < 60) return `${safe}s`
  if (safe < 3600) {
    const mins = Math.floor(safe / 60)
    const rem = safe % 60
    return mins < 10 && rem > 0 ? `${mins}m ${rem}s` : `${mins}m`
  }
  const hours = Math.floor(safe / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

const timelineHours = Array.from({ length: 7 }, (_, i) => i * 4)

// ── Active app expand ─────────────────────────────
const expandedApp = ref(null)

// ── Custom Rule Panel ─────────────────────────────
const showRulePanel = ref(false)
const ruleTarget = ref('')
const ruleCategory = ref('Development')
const ruleProductive = ref(true)
const customRules = computed(() => getCustomRules())
const CATEGORIES = Object.keys(CATEGORY_COLORS).filter(c => !['Unknown', 'Other'].includes(c))

async function saveRule() {
  if (!ruleTarget.value.trim()) return
  await setCustomRule(ruleTarget.value.trim(), {
    category: ruleCategory.value,
    productive: ruleProductive.value,
    color: CATEGORY_COLORS[ruleCategory.value] || '#8E95A3'
  })
  ruleTarget.value = ''
}

async function deleteRule(key) {
  await removeCustomRule(key)
}

// ── Pulse Ring ────────────────────────────────────
const pulseVal = computed(() => pulse.value ?? 0)
const pulseColor = computed(() => {
  const v = pulseVal.value
  if (v >= 75) return '#52B788'
  if (v >= 50) return '#00B4D8'
  if (v >= 30) return '#F59E0B'
  return '#EF4444'
})
const pulseLabel = computed(() => {
  const v = pulseVal.value
  if (v >= 75) return 'Excellent'
  if (v >= 50) return 'Good'
  if (v >= 30) return 'Fair'
  return 'Low'
})
const pulseCircumference = 2 * Math.PI * 52
const pulseDashArray = computed(() => {
  const filled = (pulseVal.value / 100) * pulseCircumference
  return `${filled.toFixed(1)} ${(pulseCircumference - filled).toFixed(1)}`
})
const pulseOffset = computed(() => pulseCircumference * (1 - pulseVal.value / 100))

const topApp = computed(() => appBreakdown.value[0] || null)
const overviewStateTone = computed(() => {
  if (!liveSnapshot.value && !tracker.isTracking.value) return 'muted'
  if (pulseVal.value >= 70) return 'good'
  if (pulseVal.value >= 40) return 'steady'
  return 'soft'
})
const overviewTitle = computed(() => {
  if (topApp.value?.app) return `${topApp.value.app} is shaping today`
  if (liveTodayFallback.value?.app) return `${liveTodayFallback.value.app} is active right now`
  return 'Your day is starting to take shape'
})
const overviewText = computed(() => {
  if (!todayEntries.value.length) {
    return 'Live tracking is awake, and Screen Time will build this day as more ambient chunks arrive.'
  }

  const parts = [
    `${formatDuration(totalTrackedSeconds.value)} captured so far today.`,
  ]

  if (productivityScore.value !== null && productivityScore.value !== undefined) {
    parts.push(`${productivityScore.value}% of that time is currently landing in productive lanes.`)
  }

  if (topCategory.value?.category) {
    parts.push(`${topCategory.value.category} is the dominant category.`)
  }

  if (topDistractors.value.length) {
    parts.push(`${topDistractors.value[0].label} is the main distractor to watch.`)
  }

  return parts.join(' ')
})
const overviewChips = computed(() => {
  const chips = [
    trackerHealth.value.source,
    trackerHealth.value.signal,
  ]
  if (trackerHealth.value.app && trackerHealth.value.app !== 'Waiting') {
    chips.push(trackerHealth.value.app)
  }
  if (topCategory.value?.category) {
    chips.push(topCategory.value.category)
  }
  return chips.slice(0, 4)
})
const overviewStats = computed(() => ([
  {
    label: 'Tracked',
    value: formatDuration(totalTrackedSeconds.value),
    tone: 'cyan',
  },
  {
    label: 'Productive share',
    value: productivityScore.value !== null && productivityScore.value !== undefined ? `${productivityScore.value}%` : '—',
    tone: 'green',
  },
  {
    label: 'Top app',
    value: topApp.value?.app || 'Waiting',
    tone: 'ink',
  },
  {
    label: 'Top category',
    value: topCategory.value?.category || '—',
    tone: 'amber',
  },
]))

// ── Charts ────────────────────────────────────────
const baseChart = {
  fontFamily: 'Inter, system-ui, sans-serif',
  toolbar: { show: false },
  background: 'transparent',
  animations: { enabled: true, speed: 600 }
}

const hourlyChartOpts = computed(() => ({
  chart: { ...baseChart, type: 'bar', stacked: true },
  plotOptions: { bar: { borderRadius: 3, columnWidth: '85%' } },
  colors: ['#52B788', '#EF4444', '#8E95A3'],
  dataLabels: { enabled: false },
  xaxis: {
    categories: Array.from({ length: 24 }, (_, i) => {
      if (i === 0) return '12a'
      if (i < 12) return `${i}a`
      if (i === 12) return '12p'
      return `${i - 12}p`
    }),
    axisBorder: { show: false }, axisTicks: { show: false },
    labels: { style: { colors: '#8E95A3', fontSize: '9px' }, rotate: -45 }
  },
  yaxis: { labels: { style: { colors: '#8E95A3', fontSize: '10px' }, formatter: v => `${Math.round(v)}m` } },
  grid: { borderColor: 'rgba(0,0,0,0.05)', strokeDashArray: 4 },
  legend: { position: 'top', labels: { colors: '#8E95A3' }, fontSize: '11px', fontWeight: 600 },
  tooltip: { theme: 'dark', y: { formatter: v => `${Math.round(v)} min` } }
}))
const hourlyChartSeries = computed(() => [
  { name: 'Productive', data: hourlyBreakdown.value.map(h => Math.round(h.productiveMin)) },
  { name: 'Distracting', data: hourlyBreakdown.value.map(h => Math.round(h.unproductiveMin)) },
  { name: 'Neutral', data: hourlyBreakdown.value.map(h => Math.round(h.neutralMin)) },
])

const weeklyOpts = computed(() => ({
  chart: { ...baseChart, type: 'area' },
  colors: ['#00B4D8'],
  fill: { type: 'gradient', gradient: { opacityFrom: 0.2, opacityTo: 0 } },
  dataLabels: { enabled: false },
  stroke: { curve: 'smooth', width: 2.5 },
  xaxis: {
    categories: weeklyTrend.value.map(d => d.label),
    axisBorder: { show: false }, axisTicks: { show: false },
    labels: { style: { colors: '#8E95A3', fontSize: '11px', fontWeight: 600 } }
  },
  yaxis: { min: 0, max: 100, labels: { style: { colors: '#8E95A3', fontSize: '11px' } } },
  grid: { borderColor: 'rgba(0,0,0,0.05)', strokeDashArray: 4 },
  annotations: {
    yaxis: [{ y: 70, borderColor: '#52B788', strokeDashArray: 4, label: { text: 'Great', style: { color: '#52B788', background: 'transparent', fontSize: '10px' } } }]
  },
  tooltip: { theme: 'dark', y: { formatter: v => `${v}/100 Pulse` } }
}))
const weeklySeries = computed(() => [{
  name: 'Productivity Pulse',
  data: weeklyTrend.value.map(d => d.pulse ?? 0)
}])

const donutOpts = computed(() => ({
  chart: { ...baseChart, type: 'donut' },
  colors: categoryBreak.value.map(c => c.color),
  labels: categoryBreak.value.map(c => c.category),
  plotOptions: { pie: { donut: { size: '65%', labels: { show: true, total: { show: true, label: 'Total', fontSize: '12px', fontWeight: 700, formatter: () => formatDuration(totalTrackedSeconds.value) } } } } },
  legend: { position: 'right', fontSize: '11px', fontWeight: 600, labels: { colors: '#8E95A3' } },
  dataLabels: { enabled: false },
  stroke: { width: 0 },
  tooltip: { theme: 'dark', y: { formatter: v => `${v} min` } }
}))
const donutSeries = computed(() => categoryBreak.value.map(c => c.minutes))

</script>

<template>
  <div class="st-root">
    <!-- ══ Header ══ -->
    <header class="st-header">
      <div>
        <h1 class="st-title">Screen Time</h1>
        <p class="st-sub">Real-time OS activity tracking · Today, {{ new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) }}</p>
      </div>
      <div class="st-header-actions">
        <button class="st-action-btn" @click="ambient.refreshToday()">
          <RefreshCwIcon size="14" /> Refresh
        </button>
        <button class="st-action-btn" @click="showRulePanel = true">
          <SlidersIcon size="14" /> Classify Rules
        </button>
      </div>
    </header>

    <!-- ══ Empty State ══ -->
    <div v-if="!todayEntries.length" class="st-empty">
      <MonitorIcon size="48" style="color: var(--text-muted); margin-bottom: 16px;" />
      <template v-if="liveSnapshot || tracker.isTracking.value">
        <h3>Live tracking is awake, but this day is still filling in</h3>
        <p>Velance is already seeing current activity. Screen-time chunks will keep building here as you continue working.</p>
        <div class="live-empty-grid">
          <div class="stat-card">
            <span class="stat-val">{{ trackerHealth.app }}</span>
            <span class="stat-lbl">Current App</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">{{ tracker.liveWpm.value }}</span>
            <span class="stat-lbl">Live WPM</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">{{ tracker.isIdle.value ? 'Idle' : `${tracker.mouseIntensity.value}%` }}</span>
            <span class="stat-lbl">Pointer</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">{{ tracker.windowSwitchCount.value }}</span>
            <span class="stat-lbl">Switches</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">{{ trackerHealth.signal }}</span>
            <span class="stat-lbl">Signal</span>
          </div>
          <div class="stat-card live-wide">
            <span class="stat-val live-window">{{ trackerHealth.window }}</span>
            <span class="stat-lbl">Current Window</span>
          </div>
        </div>
      </template>
      <template v-else>
        <h3>No activity tracked yet</h3>
        <p>Velance is running in the background. Data appears automatically as you work.</p>
      </template>
    </div>

    <template v-else>
      <div class="overview-card">
        <div class="overview-copy">
          <div class="overview-head">
            <span class="overview-label">Daily picture</span>
            <span class="overview-state" :class="overviewStateTone">{{ trackerHealth.signal }}</span>
          </div>
          <h2 class="overview-title">{{ overviewTitle }}</h2>
          <p class="overview-text">{{ overviewText }}</p>
          <div class="overview-chip-row">
            <span v-for="chip in overviewChips" :key="chip" class="overview-chip">{{ chip }}</span>
          </div>
        </div>
        <div class="overview-metrics">
          <div v-for="stat in overviewStats" :key="stat.label" class="overview-stat" :class="stat.tone">
            <span class="overview-stat-label">{{ stat.label }}</span>
            <strong class="overview-stat-value">{{ stat.value }}</strong>
          </div>
        </div>
      </div>

      <!-- ══ HERO ROW: Pulse + Stats ══ -->
      <div class="hero-row">

        <!-- Pulse Ring -->
        <div class="card pulse-card">
          <div class="pulse-wrap">
            <svg class="pulse-ring" viewBox="0 0 120 120" width="140" height="140">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border-light)" stroke-width="10"/>
              <circle
                cx="60" cy="60" r="52"
                fill="none"
                :stroke="pulseColor"
                stroke-width="10"
                stroke-linecap="round"
                :stroke-dasharray="pulseDashArray"
                :stroke-dashoffset="pulseOffset"
                style="transform: rotate(-90deg); transform-origin: 60px 60px; transition: stroke-dashoffset 1s cubic-bezier(0.34,1.56,0.64,1), stroke 1s ease;"
              />
              <text x="60" y="55" text-anchor="middle" class="pulse-num" :fill="pulseColor" font-size="22" font-weight="800" font-family="Inter, system-ui">{{ pulseVal }}</text>
              <text x="60" y="70" text-anchor="middle" class="pulse-sub-text" fill="#8E95A3" font-size="9" font-weight="700" font-family="Inter, system-ui">PULSE</text>
            </svg>
            <div class="pulse-meta">
              <span class="pulse-label" :style="{ color: pulseColor }">{{ pulseLabel }}</span>
              <span class="pulse-desc">Productivity Pulse</span>
              <p class="pulse-hint">A blended activity pulse based on how today splits across productive, neutral, and distracting work.</p>
            </div>
          </div>
        </div>

        <!-- Stats Grid -->
        <div class="hero-stats">
          <div class="stat-card">
            <ClockIcon size="16" class="stat-icon" style="color: #8E95A3;" />
            <span class="stat-val">{{ formatDuration(totalTrackedSeconds) }}</span>
            <span class="stat-lbl">Total Tracked</span>
          </div>
          <div class="stat-card">
            <ZapIcon size="16" class="stat-icon" style="color: #52B788;" />
            <span class="stat-val" style="color: #52B788;">{{ formatDuration(productiveSeconds) }}</span>
            <span class="stat-lbl">Productive</span>
          </div>
          <div class="stat-card">
            <AlertTriangleIcon size="16" class="stat-icon" style="color: #EF4444;" />
            <span class="stat-val" style="color: #EF4444;">{{ formatDuration(distractSeconds) }}</span>
            <span class="stat-lbl">Distracting</span>
          </div>
          <div class="stat-card">
            <BrainIcon size="16" class="stat-icon" style="color: #8E95A3;" />
            <span class="stat-val">{{ formatDuration(neutralSeconds) }}</span>
            <span class="stat-lbl">Neutral</span>
          </div>
        </div>
      </div>

      <!-- ══ Smart Insights ══ -->
      <div class="insights-row" v-if="insights.length">
        <div
          v-for="(ins, i) in insights" :key="i"
          class="insight-chip"
          :class="ins.type"
        >
          <span class="insight-icon">{{ ins.icon }}</span>
          <span class="insight-text">{{ ins.text }}</span>
        </div>
      </div>

      <!-- ══ 24h Timeline Gantt ══ -->
      <div class="card gantt-card">
        <div class="card-header">
          <h3>24-Hour Activity Timeline</h3>
          <p class="card-sub">Full day overview — hover blocks for details</p>
        </div>
        <div class="gantt-wrap">
          <div class="gantt-track">
              <div
              v-for="(entry, i) in todayTimeline" :key="i"
              class="gantt-block"
              :style="{ left: entry.left, width: entry.width, background: entry.color }"
            >
              <div class="gantt-tooltip">
                <strong>{{ entry.app }}</strong>
                <span>{{ entry.category }}</span>
                <span>{{ formatDuration(entry.duration) }}</span>
              </div>
            </div>
          </div>
          <div class="gantt-labels">
            <span v-for="h in timelineHours" :key="h" :style="{ left: (h / 24 * 100).toFixed(1) + '%' }">
              {{ h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm' }}
            </span>
          </div>
        </div>
      </div>

      <!-- ══ Two-col: Hourly Heatmap + Category Donut ══ -->
      <div class="two-col">
        <div class="card">
          <div class="card-header">
            <h3>Hourly Breakdown</h3>
            <p class="card-sub">Productive vs distracting time per hour</p>
          </div>
          <VueApexCharts type="bar" height="220" :options="hourlyChartOpts" :series="hourlyChartSeries" />
        </div>
        <div class="card">
          <div class="card-header">
            <h3>By Category</h3>
            <p class="card-sub">How you split your time today</p>
          </div>
          <VueApexCharts v-if="donutSeries.length" type="donut" height="220" :options="donutOpts" :series="donutSeries" />
          <div v-else class="chart-empty">No categories yet</div>
        </div>
      </div>

      <!-- ══ Two-col: App List + Top Distractors ══ -->
      <div class="two-col apps-layout">

        <!-- App Ranked List -->
        <div class="card">
          <div class="card-header">
            <h3>Applications</h3>
            <p class="card-sub">Top apps by time today — click to reclassify</p>
          </div>
          <div class="scroll-hint" v-if="appBreakdown.length > 7">Scroll to inspect all {{ appBreakdown.length }} tracked apps.</div>
          <div class="app-list-scroll">
            <div class="app-list">
            <div
              v-for="a in appBreakdown" :key="a.app"
              class="app-row"
              @click="expandedApp = expandedApp === a.app ? null : a.app"
            >
              <div class="app-main">
                <span class="app-dot" :style="{ background: a.color }"></span>
                  <span class="app-name" :title="a.app">{{ a.app }}</span>
                  <span class="app-badge" :class="a.productive === true ? 'prod' : a.productive === false ? 'dist' : 'neut'">
                    {{ a.productive === true ? 'Productive' : a.productive === false ? 'Distracting' : 'Neutral' }}
                  </span>
                  <span class="app-min">{{ formatDuration(a.seconds) }}</span>
              </div>
              <div class="app-bar-track">
                <div class="app-bar-fill" :style="{ width: appBreakdown[0]?.seconds > 0 ? Math.min((a.seconds / appBreakdown[0].seconds) * 100, 100) + '%' : '0%', background: a.color }"></div>
              </div>
              <div class="app-expand" v-if="expandedApp === a.app">
                <span class="ae-row"><b>Category:</b> {{ a.category }} · {{ a.subcategory }}</span>
                <span class="ae-row"><b>Switches:</b> {{ a.switches || 0 }}</span>
                <div class="ae-actions">
                  <button class="ae-btn" @click.stop="ruleTarget = a.app; ruleCategory = a.category; showRulePanel = true">
                    <SlidersIcon size="12" /> Reclassify
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>

        <!-- Top Distractors -->
        <div class="card">
          <div class="card-header">
            <h3>Top Distractors</h3>
            <p class="card-sub">Most time lost to unproductive activity</p>
          </div>
          <div v-if="topDistractors.length" class="distractor-scroll">
            <div class="distractor-list">
            <div class="distractor-row" v-for="(d, i) in topDistractors" :key="d.label">
              <span class="dist-rank">{{ i + 1 }}</span>
              <div class="dist-info">
                <span class="dist-name">{{ d.label }}</span>
                <span class="dist-cat">{{ d.category }}</span>
              </div>
              <div class="dist-bar-wrap">
              <div class="dist-bar" :style="{ width: topDistractors[0].seconds > 0 ? (d.seconds / topDistractors[0].seconds * 100) + '%' : '0%' }"></div>
              </div>
                <span class="dist-time">{{ formatDuration(d.seconds) }}</span>
                <span class="dist-stolen">~{{ formatDuration(Math.round(d.seconds * 1.2)) }} focus lost</span>
            </div>
            </div>
          </div>
          <div v-else class="chart-empty">
            <span>🎯 No distracting activity today</span>
          </div>
        </div>
      </div>

      <!-- ══ Weekly Pulse Trend ══ -->
      <div class="card">
        <div class="card-header">
          <h3>7-Day Productivity Pulse</h3>
          <p class="card-sub">Daily pulse scores over the past week — target 70+</p>
        </div>
        <VueApexCharts type="area" height="200" :options="weeklyOpts" :series="weeklySeries" />
        <div class="weekly-stats">
          <div v-for="d in weeklyTrend" :key="d.date" class="wd-col">
            <div class="wd-bar-wrap">
              <div class="wd-bar" :style="{ height: ((d.pulse ?? 0) / 100 * 48) + 'px', background: (d.pulse ?? 0) >= 70 ? '#52B788' : (d.pulse ?? 0) >= 40 ? '#F59E0B' : '#EF4444' }"></div>
            </div>
            <span class="wd-label">{{ d.label }}</span>
            <span class="wd-val" :style="{ color: (d.pulse ?? 0) >= 70 ? '#52B788' : (d.pulse ?? 0) >= 40 ? '#F59E0B' : '#8E95A3' }">{{ d.pulse ?? '—' }}</span>
          </div>
        </div>
      </div>

    </template>

    <!-- ══ Classify Rules Panel ══ -->
    <Transition name="modal-fade">
      <div class="modal-overlay" v-if="showRulePanel" @click.self="showRulePanel = false">
        <div class="modal-card modal-wide">
          <div class="modal-header">
            <h3>App Classification Rules</h3>
            <button class="modal-close" @click="showRulePanel = false"><XIcon size="16" /></button>
          </div>
          <p class="modal-sub">Override how any app or website is classified. Your rules take priority over defaults.</p>
          <div class="rule-add">
            <input v-model="ruleTarget" class="gf-input" placeholder="App name or keyword (e.g. YouTube)" />
            <select v-model="ruleCategory" class="gf-select">
              <option v-for="cat in CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
            </select>
            <label class="rule-prod-toggle">
              <input type="checkbox" v-model="ruleProductive" />
              Productive
            </label>
            <button class="modal-save-btn" @click="saveRule" style="padding: 8px 16px; font-size: 12px;">Add Rule</button>
          </div>
          <div class="rule-list" v-if="Object.keys(customRules).length">
            <div v-for="[key, rule] in Object.entries(customRules)" :key="key" class="rule-row">
              <span class="rule-key">{{ key }}</span>
              <span class="rule-cat" :style="{ color: rule.color }">{{ rule.category }}</span>
              <span class="rule-prod" :class="rule.productive ? 'prod' : 'dist'">{{ rule.productive ? 'Productive' : 'Distracting' }}</span>
              <button class="rule-del" @click="deleteRule(key)"><XIcon size="12" /></button>
            </div>
          </div>
          <p class="modal-sub" v-else>No custom rules yet. Add one above.</p>
        </div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.st-root {
  padding: 36px 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1380px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
}
.st-root::-webkit-scrollbar { width: 4px; }
.st-root::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 4px; }

/* ── Header ── */
.st-header { display: flex; justify-content: space-between; align-items: flex-end; }
.st-title { font-size: 26px; font-weight: 800; letter-spacing: -0.75px; margin-bottom: 4px; }
.st-sub { font-size: 13px; color: var(--text-muted); font-weight: 500; }
.st-header-actions { display: flex; gap: 8px; }
.st-action-btn {
  display: flex; align-items: center; gap: 7px;
  padding: 8px 16px; border-radius: 10px; border: 1px solid var(--border-light);
  background: rgba(255,255,255,0.72); color: var(--text-muted); font-size: 12px;
  font-weight: 700; cursor: pointer; transition: all 0.2s; font-family: inherit;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
}
.st-action-btn:hover { border-color: var(--accent-base); color: var(--accent-base); }

/* ── Empty ── */
.st-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; text-align: center; gap: 8px;
}
.st-empty h3 { font-size: 17px; font-weight: 700; margin: 0; }
.st-empty p { font-size: 13px; color: var(--text-muted); max-width: 420px; }
.live-empty-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 180px)); gap: 12px; width: 100%; max-width: 600px; margin-top: 8px; }
.live-wide { grid-column: 1 / -1; }
.live-window { font-size: 14px; line-height: 1.45; }

.overview-card {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.9fr);
  gap: 18px;
  padding: 22px 24px;
  border-radius: 24px;
  background:
    radial-gradient(circle at top right, rgba(0, 180, 216, 0.12), transparent 32%),
    linear-gradient(135deg, rgba(0, 180, 216, 0.08), rgba(82, 183, 136, 0.08));
  border: 1px solid rgba(0, 180, 216, 0.16);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
}
.overview-copy { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.overview-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.overview-label {
  display: inline-flex;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent-base);
}
.overview-state {
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(255,255,255,0.7);
  border: 1px solid rgba(0, 180, 216, 0.14);
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
}
.overview-state.good { color: #52B788; }
.overview-state.steady { color: #00B4D8; }
.overview-state.soft { color: #F59E0B; }
.overview-state.muted { color: var(--text-muted); }
.overview-title {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.65px;
  margin: 0;
}
.overview-text {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-muted);
  margin: 0;
  max-width: 680px;
}
.overview-chip-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.overview-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,0.68);
  border: 1px solid rgba(0, 180, 216, 0.12);
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}
.overview-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.overview-stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(255,255,255,0.72);
  border: 1px solid rgba(255,255,255,0.65);
}
.overview-stat-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.45px;
  color: var(--text-muted);
}
.overview-stat-value {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.35px;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.overview-stat.cyan .overview-stat-value { color: #00B4D8; }
.overview-stat.green .overview-stat-value { color: #52B788; }
.overview-stat.amber .overview-stat-value { color: #F59E0B; }

/* ── Card Base ── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 20px;
  padding: 22px 24px;
  transition: transform 0.2s;
}
.card:hover { transform: translateY(-1px); }
.card-header { margin-bottom: 16px; }
.card-header h3 { font-size: 15px; font-weight: 700; margin-bottom: 3px; }
.card-sub { font-size: 12px; color: var(--text-muted); }
.chart-empty { display: flex; align-items: center; justify-content: center; height: 80px; font-size: 13px; color: var(--text-muted); }

/* ── Hero Row ── */
.hero-row { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: stretch; }

/* Pulse Card */
.pulse-card { display: flex; align-items: center; }
.pulse-wrap { display: flex; align-items: center; gap: 20px; }
.pulse-ring { flex-shrink: 0; filter: drop-shadow(0 0 12px v-bind(pulseColor + '55')); }
.pulse-meta { display: flex; flex-direction: column; gap: 4px; min-width: 140px; }
.pulse-label { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
.pulse-desc { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
.pulse-hint { font-size: 11px; color: var(--text-muted); line-height: 1.5; max-width: 210px; margin-top: 6px; }

/* Hero Stats */
.hero-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-content: start; }
.stat-card {
  background: var(--bg-card); border: 1px solid var(--border-light);
  border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 4px;
  transition: transform 0.2s;
}
.stat-card:hover { transform: translateY(-2px); }
.stat-icon { margin-bottom: 4px; }
.stat-val { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; }
.stat-lbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }

/* Goal Card */
.goal-card { display: flex; flex-direction: column; gap: 10px; min-width: 200px; }
.goal-empty { align-items: center; justify-content: center; gap: 8px; cursor: pointer; flex-direction: row; color: var(--text-muted); font-size: 13px; font-weight: 600; }
.goal-header { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
.goal-pct { margin-left: auto; font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
.goal-bar-wrap { height: 7px; background: var(--bg-app); border-radius: 4px; overflow: hidden; }
.goal-bar { height: 100%; border-radius: 4px; transition: width 1s cubic-bezier(0.34, 1.56, 0.64, 1); }
.goal-detail { font-size: 12px; color: var(--text-muted); font-weight: 600; }

/* ── Insights Row ── */
.insights-row { display: flex; gap: 10px; flex-wrap: wrap; }
.insight-chip {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 14px; border-radius: 12px; font-size: 12px; font-weight: 600;
  border: 1px solid;
  flex-shrink: 0;
  transition: transform 0.2s;
}
.insight-chip:hover { transform: translateY(-1px); }
.insight-chip.positive { background: rgba(82,183,136,0.08); border-color: rgba(82,183,136,0.25); color: #52B788; }
.insight-chip.warning  { background: rgba(245,158,11,0.08); border-color: rgba(245,158,11,0.25); color: #F59E0B; }
.insight-chip.neutral  { background: rgba(142,149,163,0.08); border-color: rgba(142,149,163,0.2); color: var(--text-muted); }
.insight-icon { font-size: 14px; }
.insight-text { white-space: nowrap; }

/* ── Gantt ── */
.gantt-card { padding: 22px 24px; }
.gantt-wrap { display: flex; flex-direction: column; gap: 8px; }
.gantt-track {
  position: relative; height: 40px; background: var(--bg-app);
  border-radius: 10px; overflow: hidden; border: 1px solid var(--border-light);
}
.gantt-block {
  position: absolute; top: 0; height: 100%;
  opacity: 0.85; transition: opacity 0.2s, transform 0.2s;
  cursor: default;
}
.gantt-block:hover { opacity: 1; transform: scaleY(1.08); z-index: 2; }
.gantt-tooltip {
  display: none; position: absolute; bottom: calc(100% + 6px);
  left: 50%; transform: translateX(-50%);
  background: var(--bg-card); border: 1px solid var(--border-light);
  border-radius: 8px; padding: 6px 10px; white-space: nowrap;
  flex-direction: column; gap: 2px; font-size: 11px; font-weight: 600;
  box-shadow: 0 8px 20px rgba(0,0,0,0.2); z-index: 100;
}
.gantt-block:hover .gantt-tooltip { display: flex; }
.gantt-tooltip strong { font-size: 12px; font-weight: 700; }
.gantt-labels { position: relative; height: 18px; }
.gantt-labels span {
  position: absolute; transform: translateX(-50%);
  font-size: 10px; font-weight: 700; color: var(--text-muted); white-space: nowrap;
}

/* ── Two-col Grid ── */
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.apps-layout { grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.85fr); align-items: start; }

/* ── App List ── */
.scroll-hint {
  margin-bottom: 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}
.app-list-scroll,
.distractor-scroll {
  max-height: 440px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 4px;
}
.app-list-scroll::-webkit-scrollbar,
.distractor-scroll::-webkit-scrollbar { width: 6px; }
.app-list-scroll::-webkit-scrollbar-thumb,
.distractor-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.36);
  border-radius: 999px;
}
.app-list { display: flex; flex-direction: column; gap: 10px; }
.app-row { display: flex; flex-direction: column; gap: 6px; cursor: pointer; padding: 8px; border-radius: 10px; transition: background 0.2s; }
.app-row:hover { background: var(--bg-app); }
.app-main { display: flex; align-items: center; gap: 8px; }
.app-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.app-name { font-size: 13px; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.app-badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 6px; flex-shrink: 0; }
.app-badge.prod { background: rgba(82,183,136,0.12); color: #52B788; }
.app-badge.dist { background: rgba(239,68,68,0.12); color: #EF4444; }
.app-badge.neut { background: rgba(142,149,163,0.12); color: #8E95A3; }
.app-min { font-size: 12px; font-weight: 800; color: var(--text-muted); flex-shrink: 0; min-width: 42px; text-align: right; }
.app-bar-track { height: 4px; width: 100%; background: var(--border-light); border-radius: 2px; overflow: hidden; }
.app-bar-fill { height: 100%; border-radius: 2px; transition: width 0.8s cubic-bezier(0.34,1.56,0.64,1); }
.app-expand { padding: 8px 0 2px 16px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border-light); margin-top: 4px; }
.ae-row { font-size: 11px; color: var(--text-muted); font-weight: 500; }
.ae-actions { display: flex; gap: 8px; margin-top: 4px; }
.ae-btn {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 7px;
  border: 1px solid var(--border-light); background: transparent; color: var(--text-muted);
  cursor: pointer; transition: all 0.2s; font-family: inherit;
}
.ae-btn:hover { border-color: var(--accent-base); color: var(--accent-base); }

/* ── Distractors ── */
.distractor-list { display: flex; flex-direction: column; gap: 12px; }
.distractor-row { display: flex; align-items: center; gap: 10px; }
.dist-rank { font-size: 13px; font-weight: 800; color: var(--text-muted); width: 18px; text-align: center; flex-shrink: 0; }
.dist-info { display: flex; flex-direction: column; gap: 2px; min-width: 90px; }
.dist-name { font-size: 13px; font-weight: 700; }
.dist-cat  { font-size: 10px; color: var(--text-muted); font-weight: 600; }
.dist-bar-wrap { flex: 1; height: 5px; background: var(--border-light); border-radius: 3px; overflow: hidden; }
.dist-bar { height: 100%; background: linear-gradient(90deg, #EF4444, #F59E0B); border-radius: 3px; transition: width 0.8s; }
.dist-time { font-size: 12px; font-weight: 800; color: #EF4444; flex-shrink: 0; }
.dist-stolen { font-size: 10px; font-weight: 600; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }

/* ── Weekly Stats Row ── */
.weekly-stats { display: flex; justify-content: space-around; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light); }
.wd-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.wd-bar-wrap { height: 52px; display: flex; align-items: flex-end; }
.wd-bar { width: 24px; border-radius: 4px 4px 0 0; transition: height 0.8s cubic-bezier(0.34,1.56,0.64,1), background 0.5s; }
.wd-label { font-size: 10px; font-weight: 700; color: var(--text-muted); }
.wd-val { font-size: 11px; font-weight: 800; }

/* ── Modals ── */
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 200; backdrop-filter: blur(4px);
}
.modal-card {
  background: var(--bg-card); border: 1px solid var(--border-light);
  border-radius: 24px; padding: 28px 32px; width: 480px; max-width: 95vw;
  box-shadow: 0 24px 48px rgba(0,0,0,0.3); max-height: 80vh; overflow-y: auto;
}
.modal-wide { width: 600px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.modal-header h3 { font-size: 17px; font-weight: 700; }
.modal-close { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 6px; transition: background 0.2s; display: flex; }
.modal-close:hover { background: var(--bg-app); color: var(--text-main); }
.modal-sub { font-size: 12px; color: var(--text-muted); margin-bottom: 20px; line-height: 1.5; }
.modal-save-btn {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 12px; border-radius: 12px; border: none;
  background: var(--accent-gradient); color: white; font-size: 14px;
  font-weight: 700; cursor: pointer; justify-content: center;
  box-shadow: 0 6px 20px var(--accent-glow); transition: transform 0.2s;
  font-family: inherit; margin-top: 16px;
}
.modal-save-btn:hover { transform: translateY(-2px); }

/* Goal Form */
.goal-form { display: flex; flex-direction: column; gap: 14px; }
.goal-field { display: flex; flex-direction: column; gap: 5px; }
.gf-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
.gf-input-wrap { display: flex; align-items: center; gap: 8px; }
.gf-input {
  flex: 1; background: var(--bg-app); border: 1px solid var(--border-light);
  border-radius: 10px; padding: 9px 12px; font-size: 13px; color: var(--text-main);
  outline: none; transition: border-color 0.2s; font-family: inherit;
}
.gf-input:focus { border-color: var(--accent-base); }
.gf-unit { font-size: 12px; font-weight: 700; color: var(--text-muted); }
.gf-current { font-size: 11px; color: var(--text-muted); }
.gf-select {
  flex: 1; background: var(--bg-app); border: 1px solid var(--border-light);
  border-radius: 10px; padding: 9px 12px; font-size: 13px; color: var(--text-main);
  outline: none; cursor: pointer; font-family: inherit;
}

/* Rule Panel */
.rule-add { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
.rule-prod-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-muted); cursor: pointer; white-space: nowrap; }
.rule-list { display: flex; flex-direction: column; gap: 8px; }
.rule-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--bg-app); border-radius: 10px; }
.rule-key { font-size: 13px; font-weight: 600; flex: 1; }
.rule-cat { font-size: 12px; font-weight: 700; }
.rule-prod { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 6px; flex-shrink: 0; }
.rule-prod.prod { background: rgba(82,183,136,0.12); color: #52B788; }
.rule-prod.dist { background: rgba(239,68,68,0.12); color: #EF4444; }
.rule-del { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 5px; transition: background 0.2s; display: flex; flex-shrink: 0; }
.rule-del:hover { background: rgba(239,68,68,0.1); color: #EF4444; }

/* ── Modal Transitions ── */
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.25s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

@media (max-width: 980px) {
  .overview-card,
  .hero-row,
  .two-col { grid-template-columns: 1fr; }
  .hero-stats { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 720px) {
  .st-root {
    padding: 28px 20px;
  }

  .st-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }

  .st-header-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .overview-card,
  .card {
    padding: 18px;
  }

  .overview-metrics,
  .hero-stats {
    grid-template-columns: 1fr;
  }

  .pulse-wrap {
    flex-direction: column;
    align-items: flex-start;
  }

  .live-empty-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .st-root {
    padding: 22px 16px;
    gap: 18px;
  }

  .overview-title,
  .st-title {
    font-size: 22px;
  }

  .stat-val {
    font-size: 18px;
  }
}
</style>
