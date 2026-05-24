<script setup>
import { computed, ref, watch } from 'vue'
import { useVelanceStore } from '../../store/velance.js'

const store = useVelanceStore()

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const heatmapDays = ref(90)
const selectedHeatDate = ref(null)
const hoveredDate = ref(null)
const activeFilterId = ref(null)

const activeHabitName = computed(() => {
  if (!activeFilterId.value) return null
  const habit = store.habits.find(h => h.id === activeFilterId.value)
  return habit ? habit.name : null
})

const activeColor = computed(() => {
  if (!activeFilterId.value) return '#00B4D8' // Default global color
  const habit = store.habits.find(h => h.id === activeFilterId.value)
  return habit ? habit.color : '#00B4D8'
})

const heatmapData = computed(() => store.getHabitHeatmap(activeHabitName.value, heatmapDays.value))

const heatmapWeeks = computed(() => {
  const weeks = []
  for (let index = 0; index < heatmapData.value.length; index += 7) {
    weeks.push(heatmapData.value.slice(index, index + 7))
  }
  return weeks
})

const heatmapColumns = computed(() => {
  let previousMonth = null
  return heatmapWeeks.value.map((week, index) => {
    const marker = week.find((day) => new Date(day.date).getDate() <= 7)
    const monthLabel = marker ? new Date(marker.date).toLocaleDateString('en-US', { month: 'short' }) : ''
    const label = monthLabel && monthLabel !== previousMonth ? monthLabel : ''
    previousMonth = monthLabel || previousMonth
    return {
      key: `${week[0]?.date || index}`,
      label,
      days: week,
    }
  })
})

const heatmapGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${Math.max(heatmapColumns.value.length, 1)}, 24px)`,
}))

watch(
  heatmapData,
  (days) => {
    if (!days.length) return
    if (selectedHeatDate.value && days.some((entry) => entry.date === selectedHeatDate.value)) return
    const lastActive = [...days].reverse().find((entry) => entry.count > 0)
    selectedHeatDate.value = (lastActive || days[days.length - 1]).date
  },
  { immediate: true },
)

const selectedHeatEntry = computed(() => {
  if (!heatmapData.value.length) return null
  return heatmapData.value.find((entry) => entry.date === selectedHeatDate.value) || heatmapData.value.at(-1)
})

const maxHeatCount = computed(() => Math.max(...heatmapData.value.map((day) => day.count), 1))

// Stats calculations based on filtered data
const weeklyMinutes = computed(() => heatmapData.value.slice(-7).reduce((sum, day) => sum + day.minutes, 0))
const strongestWeekMinutes = computed(() => {
  return heatmapWeeks.value.reduce((best, week) => Math.max(best, week.reduce((sum, day) => sum + day.minutes, 0)), 0)
})

const selectedHeatMeta = computed(() => {
  if (!selectedHeatEntry.value) {
    return { title: 'No rhythm yet', subtitle: 'Run a few sessions and the map will begin to form.', intensity: 'Quiet' }
  }
  const day = selectedHeatEntry.value
  let intensity = 'Quiet'
  if (day.count >= Math.max(2, Math.ceil(maxHeatCount.value * 0.75))) intensity = 'Strong'
  else if (day.count > 0) intensity = 'Active'

  return {
    title: formatHeatDate(day.date),
    subtitle: day.count ? `${day.minutes} minutes across ${day.count} proof session${day.count === 1 ? '' : 's'}` : 'No proof recorded on this day.',
    intensity,
  }
})

function formatHeatDate(date) {
  return new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function heatCellStyle(day) {
  const intensity = day.count <= 0 ? 0 : Math.min(day.count / maxHeatCount.value, 1)
  const alpha = day.count <= 0 ? 0.04 : 0.16 + (intensity * 0.76)
  
  return {
    background: day.count <= 0 ? 'var(--surface-muted)' : `${activeColor.value}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`,
    transform: day.date === selectedHeatDate.value ? 'translateY(-2px) scale(1.15)' : 'none',
    boxShadow: day.date === selectedHeatDate.value ? 'var(--shadow-elevation-hover)' : 'none',
    zIndex: day.date === selectedHeatDate.value ? 10 : 1
  }
}
</script>

<template>
  <section class="heatmap-card">
    <div class="heatmap-head">
      <div class="heatmap-copy">
        <span class="page-kicker">Activity map</span>
        <div class="filter-row">
          <button 
            class="filter-chip" 
            :class="{ active: !activeFilterId }"
            @click="activeFilterId = null"
          >
            All Habits
          </button>
          <button 
            v-for="habit in store.habits" 
            :key="habit.id"
            class="filter-chip"
            :class="{ active: activeFilterId === habit.id }"
            :style="activeFilterId === habit.id ? { color: habit.color, borderColor: habit.color, background: `${habit.color}16` } : {}"
            @click="activeFilterId = habit.id"
          >
            {{ habit.name }}
          </button>
        </div>
      </div>

      <div class="hm-controls">
        <button class="hm-range" :class="{ active: heatmapDays === 30 }" @click="heatmapDays = 30">30d</button>
        <button class="hm-range" :class="{ active: heatmapDays === 90 }" @click="heatmapDays = 90">90d</button>
      </div>
    </div>

    <div class="heatmap-layout-split">
      <div class="heatmap-frame">
        <div class="heatmap-shell">
          <div class="weekday-rail">
            <span v-for="label in WEEKDAY_LABELS" :key="label">{{ label }}</span>
          </div>

          <div class="heatmap-viewport">
            <div class="heatmap-grid" :style="heatmapGridStyle">
              <div v-for="column in heatmapColumns" :key="column.key" class="heatmap-column">
                <span class="month-mark">{{ column.label }}</span>
                <div class="cell-wrapper" v-for="day in column.days" :key="day.date">
                  <button
                    class="heatmap-cell"
                    :class="{ active: day.date === hoveredDate }"
                    :style="heatCellStyle(day)"
                    @mouseenter="hoveredDate = day.date"
                    @mouseleave="hoveredDate = null"
                    @focus="hoveredDate = day.date"
                    @blur="hoveredDate = null"
                  ></button>
                  <div class="custom-tooltip" v-if="day.date === hoveredDate">
                    <strong>{{ formatHeatDate(day.date) }}</strong>
                    <span>{{ day.minutes }}m - {{ day.count }} proof sessions</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="legend-row">
          <span>Less</span>
          <i class="legend-swatch" :style="{ background: `${activeColor}2E` }"></i>
          <i class="legend-swatch" :style="{ background: `${activeColor}6B` }"></i>
          <i class="legend-swatch" :style="{ background: `${activeColor}D1` }"></i>
          <span>More</span>
        </div>
      </div>

      <div class="heatmap-stats-panel">
        <div class="panel-header">
          <h2>{{ selectedHeatMeta.title }}</h2>
          <p>{{ selectedHeatMeta.subtitle }}</p>
        </div>
        <div class="panel-stats">
          <div class="side-stat">
            <span>State</span>
            <strong>{{ selectedHeatMeta.intensity }}</strong>
          </div>
          <div class="side-stat">
            <span>7d volume</span>
            <strong>{{ weeklyMinutes }}m</strong>
          </div>
          <div class="side-stat">
            <span>Best week</span>
            <strong>{{ strongestWeekMinutes }}m</strong>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.heatmap-card {
  border-radius: 28px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  background: radial-gradient(circle at top right, var(--accent-glow), transparent 36%), var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(16px);
}

.heatmap-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
}

.heatmap-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.page-kicker {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--accent-base);
}

.filter-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-chip:hover {
  background: var(--surface-outline);
  color: var(--text-main);
}

.filter-chip.active {
  color: var(--accent-base);
  border-color: var(--surface-outline-strong);
}

.hm-controls {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
}

.hm-range {
  min-width: 64px;
  padding: 8px 12px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hm-range.active {
  background: color-mix(in srgb, var(--accent-base) 14%, transparent);
  color: var(--accent-base);
}

.heatmap-layout-split {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 32px;
  align-items: stretch;
}

@media (max-width: 900px) {
  .heatmap-layout-split {
    grid-template-columns: 1fr;
  }
}

.heatmap-frame {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 8px;
  overflow-x: auto;
}

.heatmap-frame::-webkit-scrollbar {
  height: 8px;
}
.heatmap-frame::-webkit-scrollbar-thumb {
  background: var(--surface-outline-strong);
  border-radius: 10px;
}

.heatmap-shell {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  width: max-content;
  padding-top: 48px;
}

.weekday-rail {
  display: grid;
  grid-template-rows: repeat(7, 1fr);
  gap: 10px;
  padding-top: 20px;
}

.weekday-rail span,
.month-mark {
  font-size: 10px;
  font-weight: 800;
  color: var(--text-muted);
  text-align: center;
}

.heatmap-viewport {
  overflow: visible;
}

.heatmap-grid {
  display: grid;
  gap: 8px;
  align-items: start;
  width: max-content;
}

.heatmap-column {
  display: grid;
  grid-template-rows: 16px repeat(7, 20px);
  gap: 8px;
  justify-items: center;
}

.cell-wrapper {
  position: relative;
  width: 20px;
  height: 20px;
}

.heatmap-cell {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  appearance: none;
  cursor: pointer;
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
  position: absolute;
  top: 0;
  left: 0;
}

.heatmap-cell:focus-visible {
  outline: none;
}

.custom-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  background: var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 8px 12px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 50;
  animation: tooltip-fade 0.15s ease;
}

.custom-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 4px;
  border-style: solid;
  border-color: var(--surface-strong) transparent transparent transparent;
}

@keyframes tooltip-fade {
  from { opacity: 0; transform: translateX(-50%) translateY(-2px); }
  to { opacity: 1; transform: translateX(-50%) translateY(-8px); }
}

.custom-tooltip strong {
  font-size: 12px;
  color: var(--text-main);
}

.custom-tooltip span {
  font-size: 11px;
  color: var(--text-muted);
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding-left: 36px;
}

.legend-row span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.legend-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.heatmap-stats-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px;
  background: var(--surface-muted);
  border-radius: 20px;
  border: 1px solid var(--surface-outline);
}

.panel-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.panel-header h2 {
  font-size: 1.4rem;
  letter-spacing: -0.02em;
  color: var(--text-main);
}

.panel-header p {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}

.panel-stats {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.side-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--surface-outline);
}

.side-stat:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.side-stat span {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 700;
}

.side-stat strong {
  font-size: 15px;
  color: var(--text-main);
}

:global(.dark-theme) .heatmap-card .panel-header h2,
:global(.dark-theme) .heatmap-card .side-stat strong,
:global(.dark-theme) .heatmap-card .custom-tooltip strong {
  color: #f8fafc;
}
</style>
