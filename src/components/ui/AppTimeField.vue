<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlarmClockIcon, CheckIcon, ChevronDownIcon, XIcon } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: String, default: '' },
  ariaLabel: { type: String, default: 'Choose time' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const root = ref(null)
const panel = ref(null)
const panelStyle = ref({})
const selectedHour = ref('09')
const selectedMinute = ref('00')
const selectedPeriod = ref('AM')

const hours = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'))
const periods = ['AM', 'PM']

const hasValue = computed(() => /^\d{2}:\d{2}$/.test(props.modelValue || ''))
const displayLabel = computed(() => {
  if (!hasValue.value) return 'No reminder'
  const [hourValue, minuteValue] = props.modelValue.split(':').map(Number)
  const period = hourValue >= 12 ? 'PM' : 'AM'
  const hour12 = hourValue % 12 || 12
  return `${String(hour12).padStart(2, '0')}:${String(minuteValue).padStart(2, '0')} ${period}`
})

function syncFromModel(value = props.modelValue) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return
  const [hourValue, minuteValue] = value.split(':').map(Number)
  selectedPeriod.value = hourValue >= 12 ? 'PM' : 'AM'
  selectedHour.value = String(hourValue % 12 || 12).padStart(2, '0')
  selectedMinute.value = String(minuteValue).padStart(2, '0')
}

function emitTime() {
  let hour = Number(selectedHour.value)
  const minute = selectedMinute.value
  if (selectedPeriod.value === 'PM' && hour !== 12) hour += 12
  if (selectedPeriod.value === 'AM' && hour === 12) hour = 0
  const value = `${String(hour).padStart(2, '0')}:${minute}`
  emit('update:modelValue', value)
  emit('change', value)
}

function updatePanelPosition() {
  if (!open.value || !root.value) return
  const rect = root.value.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const spaceBelow = window.innerHeight - rect.bottom - 18
  const spaceAbove = rect.top - 18
  const openUp = spaceBelow < 280 && spaceAbove > spaceBelow
  panelStyle.value = {
    left: `${left}px`,
    top: openUp ? 'auto' : `${Math.min(rect.bottom + 8, window.innerHeight - 282)}px`,
    bottom: openUp ? `${Math.max(12, window.innerHeight - rect.top + 8)}px` : 'auto',
    width: `${width}px`,
  }
}

async function toggleOpen() {
  open.value = !open.value
  if (open.value) {
    syncFromModel()
    await nextTick()
    updatePanelPosition()
  }
}

function selectPart(type, value) {
  if (type === 'hour') selectedHour.value = value
  if (type === 'minute') selectedMinute.value = value
  if (type === 'period') selectedPeriod.value = value
  emitTime()
}

function clearTime() {
  emit('update:modelValue', '')
  emit('change', '')
  open.value = false
}

function handleDocumentPointer(event) {
  if (!open.value || root.value?.contains(event.target) || panel.value?.contains(event.target)) return
  open.value = false
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    open.value = false
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleOpen()
  }
}

watch(() => props.modelValue, syncFromModel, { immediate: true })

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer, true)
  window.addEventListener('resize', updatePanelPosition)
  window.addEventListener('scroll', updatePanelPosition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer, true)
  window.removeEventListener('resize', updatePanelPosition)
  window.removeEventListener('scroll', updatePanelPosition, true)
})
</script>

<template>
  <div ref="root" class="app-time-field" :class="{ filled: hasValue, open }">
    <button
      type="button"
      class="time-trigger"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      @click="toggleOpen"
      @keydown="handleKeydown"
    >
      <AlarmClockIcon size="15" />
      <span :class="{ muted: !hasValue }">{{ displayLabel }}</span>
      <ChevronDownIcon size="14" />
    </button>
    <button
      v-if="hasValue"
      type="button"
      class="time-clear"
      aria-label="Clear reminder time"
      @click="clearTime"
    >
      <XIcon size="13" />
    </button>

    <Teleport to="body">
      <transition name="time-pop">
        <div v-if="open" ref="panel" class="time-panel" :style="panelStyle" role="dialog" :aria-label="ariaLabel">
          <div class="time-column">
            <span>Hour</span>
            <button
              v-for="hour in hours"
              :key="hour"
              type="button"
              :class="{ selected: selectedHour === hour }"
              @click="selectPart('hour', hour)"
            >
              {{ hour }}
              <CheckIcon v-if="selectedHour === hour" size="13" />
            </button>
          </div>
          <div class="time-column">
            <span>Minute</span>
            <button
              v-for="minute in minutes"
              :key="minute"
              type="button"
              :class="{ selected: selectedMinute === minute }"
              @click="selectPart('minute', minute)"
            >
              {{ minute }}
              <CheckIcon v-if="selectedMinute === minute" size="13" />
            </button>
          </div>
          <div class="time-column period-column">
            <span>Period</span>
            <button
              v-for="period in periods"
              :key="period"
              type="button"
              :class="{ selected: selectedPeriod === period }"
              @click="selectPart('period', period)"
            >
              {{ period }}
              <CheckIcon v-if="selectedPeriod === period" size="13" />
            </button>
            <button type="button" class="clear-panel-btn" @click="clearTime">No reminder</button>
          </div>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-time-field {
  position: relative;
  width: 100%;
  color: var(--text-main);
}

.time-trigger {
  width: 100%;
  min-height: 44px;
  padding: 0 40px 0 12px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-card) 96%, transparent), var(--surface-muted));
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 760;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.035);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background 0.18s ease;
}

.app-time-field.filled .time-trigger {
  padding-right: 72px;
}

.time-trigger:hover,
.app-time-field.open .time-trigger {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 26%, var(--surface-outline));
  box-shadow: 0 12px 28px rgba(14, 165, 233, 0.08);
}

.time-trigger:focus-visible {
  outline: none;
  border-color: var(--surface-outline-strong);
  box-shadow: 0 0 0 4px rgba(0, 180, 216, 0.1);
}

.time-trigger svg {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.time-trigger span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time-trigger span.muted {
  color: var(--text-muted);
}

.time-clear {
  position: absolute;
  right: 34px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 2;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: 1px solid var(--surface-outline);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.time-clear:hover {
  color: var(--text-main);
  border-color: var(--surface-outline-strong);
}

.time-panel {
  position: fixed;
  z-index: 4100;
  padding: 10px;
  border-radius: 18px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-strong) 96%, var(--bg-card));
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(18px);
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
}

.time-column {
  max-height: 250px;
  overflow: auto;
  display: grid;
  gap: 5px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent-base) 34%, transparent) transparent;
}

.time-column > span {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 3px 4px 6px;
  background: color-mix(in srgb, var(--surface-strong) 96%, var(--bg-card));
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.time-column button {
  min-height: 34px;
  padding: 0 9px;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--text-main);
  font: inherit;
  font-size: 13px;
  font-weight: 760;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.time-column button:hover,
.time-column button.selected {
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
}

.time-column button.selected {
  color: var(--accent-base);
}

.period-column {
  max-height: none;
  align-content: start;
}

.time-column .clear-panel-btn {
  margin-top: 8px;
  color: #ef4444;
  background: color-mix(in srgb, #ef4444 7%, transparent);
}

.time-pop-enter-active,
.time-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.time-pop-enter-from,
.time-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
