<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-vue-next'
import { formatLocalDateKey, getTodayLocalDateKey, shiftLocalDateKey } from '../../services/dateKey.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  ariaLabel: { type: String, default: 'Choose date' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const root = ref(null)
const monthCursor = ref(resolveMonthCursor(props.modelValue))

const selectedDate = computed(() => parseDateKey(props.modelValue))
const todayKey = computed(() => getTodayLocalDateKey())
const displayLabel = computed(() => {
  if (!props.modelValue) return 'No date'
  const date = parseDateKey(props.modelValue)
  if (!date) return props.modelValue
  const key = formatLocalDateKey(date)
  if (key === todayKey.value) return 'Today'
  if (key === shiftLocalDateKey(1)) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
})

const monthLabel = computed(() => monthCursor.value.toLocaleDateString('en-US', {
  month: 'long',
  year: 'numeric',
}))

const calendarDays = computed(() => {
  const cursor = new Date(monthCursor.value)
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = formatLocalDateKey(date)
    return {
      key,
      label: String(date.getDate()),
      muted: date.getMonth() !== cursor.getMonth(),
      selected: key === props.modelValue,
      today: key === todayKey.value,
    }
  })
})

watch(
  () => props.modelValue,
  (value) => {
    monthCursor.value = resolveMonthCursor(value)
  },
)

function parseDateKey(value) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  return Number.isFinite(date.getTime()) ? date : null
}

function resolveMonthCursor(value) {
  const date = parseDateKey(value) || new Date()
  date.setDate(1)
  date.setHours(12, 0, 0, 0)
  return date
}

function shiftMonth(offset) {
  const next = new Date(monthCursor.value)
  next.setMonth(next.getMonth() + offset)
  monthCursor.value = next
}

function selectDate(value) {
  emit('update:modelValue', value)
  emit('change', value)
  open.value = false
}

function clearDate() {
  selectDate('')
}

function chooseToday() {
  selectDate(todayKey.value)
}

function handleDocumentPointer(event) {
  if (!open.value || root.value?.contains(event.target)) return
  open.value = false
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    open.value = false
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    open.value = !open.value
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer, true)
})
</script>

<template>
  <div ref="root" class="app-date-field" :class="{ open }">
    <button
      type="button"
      class="app-date-trigger"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      @click="open = !open"
      @keydown="handleKeydown"
    >
      <CalendarIcon size="15" />
      <span :class="{ muted: !modelValue }">{{ displayLabel }}</span>
    </button>

    <transition name="date-pop">
      <div v-if="open" class="app-date-popover" role="dialog" :aria-label="ariaLabel">
        <header class="app-date-head">
          <button type="button" class="date-icon-btn" aria-label="Previous month" @click="shiftMonth(-1)">
            <ChevronLeftIcon size="15" />
          </button>
          <strong>{{ monthLabel }}</strong>
          <button type="button" class="date-icon-btn" aria-label="Next month" @click="shiftMonth(1)">
            <ChevronRightIcon size="15" />
          </button>
        </header>

        <div class="weekday-row" aria-hidden="true">
          <span>Su</span>
          <span>Mo</span>
          <span>Tu</span>
          <span>We</span>
          <span>Th</span>
          <span>Fr</span>
          <span>Sa</span>
        </div>

        <div class="date-grid">
          <button
            v-for="day in calendarDays"
            :key="day.key"
            type="button"
            class="date-cell"
            :class="{ muted: day.muted, selected: day.selected, today: day.today }"
            @click="selectDate(day.key)"
          >
            {{ day.label }}
          </button>
        </div>

        <footer class="app-date-actions">
          <button type="button" @click="clearDate">Clear</button>
          <button type="button" @click="chooseToday">Today</button>
        </footer>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.app-date-field {
  position: relative;
  color: var(--text-main);
  z-index: 4;
}

.app-date-trigger {
  width: 100%;
  min-height: 44px;
  padding: 0 13px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-card) 96%, transparent), var(--surface-muted));
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 760;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
  outline: none;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.035);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.app-date-trigger:hover,
.app-date-field.open .app-date-trigger {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 26%, var(--surface-outline));
  box-shadow: 0 12px 28px rgba(14, 165, 233, 0.08);
}

.app-date-trigger:focus-visible {
  border-color: var(--surface-outline-strong);
  box-shadow: 0 0 0 4px rgba(0, 180, 216, 0.1);
}

.app-date-trigger svg {
  color: var(--text-muted);
}

.app-date-trigger span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-date-trigger .muted {
  color: var(--text-muted);
}

.app-date-popover {
  position: absolute;
  z-index: 90;
  top: calc(100% + 8px);
  left: 0;
  width: 292px;
  padding: 12px;
  border-radius: 18px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--bg-card) 98%, transparent);
  box-shadow: 0 22px 50px rgba(15, 23, 42, 0.16);
  backdrop-filter: blur(18px);
}

.app-date-head,
.app-date-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.app-date-head strong {
  font-size: 13px;
  font-weight: 820;
}

.date-icon-btn,
.app-date-actions button {
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  cursor: pointer;
}

.date-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.weekday-row,
.date-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
}

.weekday-row {
  margin-top: 12px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 850;
  text-align: center;
}

.date-grid {
  margin-top: 7px;
}

.date-cell {
  height: 31px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-main);
  font: inherit;
  font-size: 12px;
  font-weight: 760;
  cursor: pointer;
}

.date-cell:hover,
.date-cell.today {
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
  color: var(--accent-base);
}

.date-cell.selected {
  background: var(--accent-gradient);
  color: white;
  box-shadow: 0 10px 22px var(--accent-glow);
}

.date-cell.muted {
  color: color-mix(in srgb, var(--text-muted) 58%, transparent);
}

.app-date-actions {
  margin-top: 12px;
}

.app-date-actions button {
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font: inherit;
  font-size: 11px;
  font-weight: 820;
}

.date-pop-enter-active,
.date-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.date-pop-enter-from,
.date-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
