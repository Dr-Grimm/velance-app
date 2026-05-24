<script setup>
import { computed, ref, watch } from 'vue'
import { BellIcon, CheckIcon, XIcon } from 'lucide-vue-next'
import AppTimeField from '../ui/AppTimeField.vue'
import {
  HABIT_ICON_OPTIONS,
  getHabitIconOption,
  resolveHabitIconKey,
} from '../../composables/useHabitIcons.js'

const props = defineProps({
  show: Boolean,
  habit: { type: Object, default: null }
})

const emit = defineEmits(['update:show', 'save'])

const form = ref(defaultForm())
const targetHours = ref(1)
const targetMinutesInput = ref(0)
const iconTouched = ref(false)

const COLORS = [
  '#00B4D8',
  '#14B8A6',
  '#52B788',
  '#3B82F6',
  '#6366F1',
  '#9B51E0',
  '#EC4899',
  '#F59E0B',
  '#84CC16',
  '#EF4444',
]
const TARGET_PRESETS = [5, 10, 15, 30, 45, 60]
const FREQUENCY_OPTIONS = [
  { key: 'daily', label: 'Daily', helper: 'Every day' },
  { key: 'weekdays', label: 'Weekdays', helper: 'Mon to Fri' },
  { key: 'weekly', label: 'Weekly', helper: 'One selected day' },
  { key: 'custom', label: 'Custom', helper: 'Pick days' },
]
const DAY_OPTIONS = [
  { key: 1, label: 'Mon' },
  { key: 2, label: 'Tue' },
  { key: 3, label: 'Wed' },
  { key: 4, label: 'Thu' },
  { key: 5, label: 'Fri' },
  { key: 6, label: 'Sat' },
  { key: 0, label: 'Sun' },
]

const nextTargetLabel = computed(() => formatMinutes(getTargetMinutes()))
const selectedIcon = computed(() => getHabitIconOption(form.value.icon, form.value.name))
const activeFrequency = computed(() => FREQUENCY_OPTIONS.find((option) => option.key === form.value.reminderFrequency) || FREQUENCY_OPTIONS[0])
const needsReminderDays = computed(() => ['weekly', 'custom'].includes(form.value.reminderFrequency))

watch(() => props.show, (newVal) => {
  if (!newVal) return

  if (props.habit) {
    form.value = {
      ...defaultForm(),
      name: props.habit.name || '',
      icon: resolveHabitIconKey(props.habit.icon, props.habit.name),
      color: props.habit.color || '#00B4D8',
      targetMinutes: props.habit.targetMinutes || 60,
      reminderEnabled: Boolean(props.habit.reminderEnabled),
      reminderFrequency: props.habit.reminderFrequency || 'daily',
      reminderTime: props.habit.reminderTime || '',
      reminderDays: Array.isArray(props.habit.reminderDays) ? props.habit.reminderDays.map(Number) : [],
    }
    iconTouched.value = true
    syncTargetInputs(props.habit.targetMinutes)
    normalizeReminderDays()
    return
  }

  form.value = defaultForm()
  iconTouched.value = false
  syncTargetInputs(60)
})

watch(() => form.value.name, (nextName) => {
  if (iconTouched.value) return
  form.value.icon = resolveHabitIconKey('', nextName)
})

function defaultForm() {
  return {
    name: '',
    icon: 'focus',
    color: '#00B4D8',
    targetMinutes: 60,
    reminderEnabled: false,
    reminderFrequency: 'daily',
    reminderTime: '',
    reminderDays: [],
    reminderLastFiredAt: 0,
  }
}

function formatMinutes(totalMinutes = 0) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes))
  if (safeMinutes < 60) return `${safeMinutes}m`
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function syncTargetInputs(totalMinutes = 60) {
  const safeMinutes = Math.max(5, Number(totalMinutes || 60))
  targetHours.value = Math.floor(safeMinutes / 60)
  targetMinutesInput.value = safeMinutes % 60
}

function clampTargetInputs() {
  targetHours.value = Math.max(0, Math.min(12, Number.parseInt(targetHours.value, 10) || 0))
  targetMinutesInput.value = Math.max(0, Math.min(59, Number.parseInt(targetMinutesInput.value, 10) || 0))
}

function getTargetMinutes() {
  clampTargetInputs()
  return Math.max(5, (targetHours.value * 60) + targetMinutesInput.value)
}

function setTargetPreset(minutes) {
  syncTargetInputs(minutes)
}

function setIcon(key) {
  iconTouched.value = true
  form.value.icon = key
}

function close() {
  emit('update:show', false)
}

function defaultDaysForFrequency(frequency = form.value.reminderFrequency) {
  if (frequency === 'weekdays') return [1, 2, 3, 4, 5]
  if (frequency === 'weekly' || frequency === 'custom') return [new Date().getDay()]
  return []
}

function normalizeReminderDays() {
  const frequency = form.value.reminderFrequency || 'daily'
  if (frequency === 'daily') {
    form.value.reminderDays = []
    return
  }
  if (frequency === 'weekdays') {
    form.value.reminderDays = [1, 2, 3, 4, 5]
    return
  }

  const selected = Array.isArray(form.value.reminderDays)
    ? form.value.reminderDays.map(Number).filter((day) => day >= 0 && day <= 6)
    : []
  if (frequency === 'weekly') {
    form.value.reminderDays = [selected[0] ?? new Date().getDay()]
    return
  }
  form.value.reminderDays = selected.length ? [...new Set(selected)] : defaultDaysForFrequency(frequency)
}

function toggleReminder() {
  form.value.reminderEnabled = !form.value.reminderEnabled
  if (form.value.reminderEnabled && !form.value.reminderTime) {
    form.value.reminderTime = '09:00'
  }
  normalizeReminderDays()
}

function setReminderFrequency(frequency) {
  form.value.reminderFrequency = frequency
  form.value.reminderDays = defaultDaysForFrequency(frequency)
  if (form.value.reminderEnabled && !form.value.reminderTime) {
    form.value.reminderTime = '09:00'
  }
}

function toggleReminderDay(day) {
  if (form.value.reminderFrequency === 'weekly') {
    form.value.reminderDays = [day]
    return
  }

  const days = new Set(form.value.reminderDays || [])
  if (days.has(day)) days.delete(day)
  else days.add(day)
  form.value.reminderDays = [...days].sort((a, b) => a - b)
}

function submit() {
  if (!form.value.name.trim()) return
  normalizeReminderDays()
  const payload = {
    ...form.value,
    icon: resolveHabitIconKey(form.value.icon, form.value.name),
    name: form.value.name.trim(),
    targetMinutes: getTargetMinutes(),
    reminderEnabled: Boolean(form.value.reminderEnabled && form.value.reminderTime),
    reminderFrequency: form.value.reminderFrequency || 'daily',
    reminderTime: form.value.reminderEnabled ? form.value.reminderTime : '',
    reminderDays: form.value.reminderEnabled ? form.value.reminderDays : [],
  }
  emit('save', payload)
  close()
}
</script>

<template>
  <div v-if="show" class="modal-backdrop" @click.self="close">
    <div class="modal" :style="{ '--habit-accent': form.color }">
      <div class="modal-header">
        <div>
          <span class="modal-kicker">{{ habit ? 'Edit loop' : 'Habit loop' }}</span>
          <h3>{{ habit ? 'Edit habit' : 'New habit' }}</h3>
        </div>
        <button type="button" class="modal-close" aria-label="Close habit modal" @click="close">
          <XIcon size="18" />
        </button>
      </div>

      <div class="modal-body">
        <section class="form-section identity-section">
          <div class="form-field name-field">
            <label>Habit name</label>
            <input v-model="form.name" class="mod-input title-input" placeholder="Coding, reading, mobility..." />
          </div>

          <div class="form-field">
            <div class="field-title-row">
              <label>Icon</label>
              <span class="selected-icon-label">{{ selectedIcon.label }}</span>
            </div>
            <div class="icon-library" role="listbox" aria-label="Choose habit icon">
              <button
                v-for="option in HABIT_ICON_OPTIONS"
                :key="option.key"
                type="button"
                class="icon-library-btn"
                :class="{ selected: form.icon === option.key }"
                :title="option.label"
                :aria-label="option.label"
                :aria-selected="form.icon === option.key"
                @click="setIcon(option.key)"
              >
                <component :is="option.component" size="18" :stroke-width="2" />
              </button>
            </div>
          </div>

          <div class="form-field">
            <label>Accent</label>
            <div class="color-row">
              <button
                v-for="color in COLORS"
                :key="color"
                type="button"
                class="color-swatch"
                :class="{ selected: form.color === color }"
                :style="{ background: color }"
                :aria-label="`Use ${color} accent`"
                @click="form.color = color"
              >
                <CheckIcon size="12" v-if="form.color === color" />
              </button>
            </div>
          </div>
        </section>

        <section class="form-section schedule-section">
          <div class="form-field">
            <div class="field-title-row">
              <label>Daily target</label>
              <span class="target-value">{{ nextTargetLabel }}</span>
            </div>
            <div class="preset-row" aria-label="Daily target presets">
              <button
                v-for="minutes in TARGET_PRESETS"
                :key="minutes"
                type="button"
                class="preset-chip"
                :class="{ selected: getTargetMinutes() === minutes }"
                @click="setTargetPreset(minutes)"
              >
                {{ formatMinutes(minutes) }}
              </button>
            </div>
            <div class="target-grid">
              <label class="target-field">
                <span>Hours</span>
                <input v-model.number="targetHours" type="number" min="0" max="12" class="mod-input compact" @blur="clampTargetInputs" />
              </label>
              <label class="target-field">
                <span>Minutes</span>
                <input v-model.number="targetMinutesInput" type="number" min="0" max="59" class="mod-input compact" @blur="clampTargetInputs" />
              </label>
            </div>
          </div>

          <div class="form-field reminder-block" :class="{ enabled: form.reminderEnabled }">
            <div class="reminder-head">
              <div>
                <label>Reminder</label>
                <p>{{ form.reminderEnabled ? `${activeFrequency.helper} at ${form.reminderTime || '09:00'}` : 'Optional local nudge for this habit.' }}</p>
              </div>
              <button
                type="button"
                class="reminder-toggle"
                :class="{ active: form.reminderEnabled }"
                :aria-pressed="form.reminderEnabled"
                @click="toggleReminder"
              >
                <span class="switch-dot"><BellIcon size="13" /></span>
                {{ form.reminderEnabled ? 'On' : 'Off' }}
              </button>
            </div>

            <div v-if="form.reminderEnabled" class="reminder-controls">
              <div class="frequency-row">
                <button
                  v-for="option in FREQUENCY_OPTIONS"
                  :key="option.key"
                  type="button"
                  class="frequency-chip"
                  :class="{ selected: form.reminderFrequency === option.key }"
                  @click="setReminderFrequency(option.key)"
                >
                  <strong>{{ option.label }}</strong>
                  <span>{{ option.helper }}</span>
                </button>
              </div>

              <AppTimeField v-model="form.reminderTime" aria-label="Choose habit reminder time" />

              <div v-if="needsReminderDays" class="day-picker">
                <div class="day-picker-head">
                  <span>{{ form.reminderFrequency === 'weekly' ? 'Reminder day' : 'Reminder days' }}</span>
                  <small>{{ form.reminderFrequency === 'weekly' ? 'Choose one day' : 'Choose any days' }}</small>
                </div>
                <div class="day-row" aria-label="Choose reminder days">
                  <button
                    v-for="day in DAY_OPTIONS"
                    :key="day.key"
                    type="button"
                    class="day-chip"
                    :class="{ selected: form.reminderDays.includes(day.key) }"
                    @click="toggleReminderDay(day.key)"
                  >
                    {{ day.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="modal-footer">
        <button type="button" class="modal-cancel" @click="close">Cancel</button>
        <button type="button" class="modal-save" @click="submit">
          <CheckIcon size="14" /> {{ habit ? 'Save habit' : 'Create habit' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 14, 21, 0.4);
  backdrop-filter: blur(18px);
  display: grid;
  place-items: center;
  z-index: 1000;
  padding: 18px;
  animation: fade-in 0.18s ease;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  width: min(980px, calc(100vw - 32px));
  max-height: min(88vh, 860px);
  border-radius: 26px;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--habit-accent) 16%, transparent), transparent 34%),
    var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: 0 28px 90px rgba(10, 14, 21, 0.34);
  animation: slide-up 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  flex-direction: column;
}

.modal button {
  appearance: none;
  -webkit-appearance: none;
  font: inherit;
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(16px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.modal-header,
.modal-footer {
  padding: 18px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-shrink: 0;
}

.modal-header {
  border-bottom: 1px solid var(--surface-outline);
}

.modal-kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--accent-base);
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.modal-header h3 {
  margin: 0;
  color: var(--text-main);
  font-size: 1.32rem;
  line-height: 1.1;
}

.modal-body {
  min-height: 0;
  padding: 20px 22px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(348px, 0.84fr);
  gap: 16px;
  align-items: start;
  overflow: auto;
}

.form-section {
  min-width: 0;
  padding: 16px;
  border-radius: 22px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-muted) 76%, transparent);
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: fit-content;
}

.modal-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-strong) 92%, transparent);
}

.modal-close,
.modal-cancel,
.modal-save,
.preset-chip,
.frequency-chip,
.day-chip,
.reminder-toggle,
.icon-library-btn,
.color-swatch {
  border: 0;
  cursor: pointer;
}

.modal-close {
  width: 38px;
  height: 38px;
  border-radius: 13px;
  background: var(--surface-muted);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  border: 1px solid var(--surface-outline);
  transition: transform 0.18s ease, color 0.18s ease, background 0.18s ease, border-color 0.18s ease;
}

.modal-close:hover {
  transform: translateY(-1px);
  color: var(--text-main);
  border-color: var(--surface-outline-strong);
}

.modal-cancel,
.modal-save {
  min-height: 42px;
  padding: 11px 18px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 850;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: transform 0.18s ease, filter 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.modal-cancel {
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-muted);
}

.modal-save {
  color: white;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--habit-accent) 94%, #12add2), color-mix(in srgb, var(--habit-accent) 70%, #57c3ab));
  box-shadow: 0 16px 34px color-mix(in srgb, var(--habit-accent) 22%, transparent);
}

.modal-cancel:hover,
.modal-save:hover {
  transform: translateY(-1px);
}

.modal-save:hover {
  filter: brightness(1.07) saturate(1.05);
  box-shadow: 0 20px 42px color-mix(in srgb, var(--habit-accent) 30%, transparent);
}

.form-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.form-field label,
.target-field span,
.day-picker-head span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0.13em;
}

.field-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.selected-icon-label,
.target-value {
  min-height: 24px;
  padding: 5px 10px;
  border-radius: 999px;
  color: var(--habit-accent);
  background: color-mix(in srgb, var(--habit-accent) 12%, transparent);
  font-size: 12px;
  font-weight: 850;
}

.mod-input {
  width: 100%;
  min-height: 46px;
  padding: 12px 14px;
  border-radius: 15px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-strong);
  color: var(--text-main);
  font: inherit;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.mod-input[type='number'] {
  appearance: textfield;
  -moz-appearance: textfield;
}

.mod-input[type='number']::-webkit-outer-spin-button,
.mod-input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.title-input {
  min-height: 52px;
  font-size: 15px;
}

.mod-input.compact {
  text-align: center;
  font-weight: 800;
}

.mod-input:focus {
  border-color: color-mix(in srgb, var(--habit-accent) 55%, var(--surface-outline-strong));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--habit-accent) 11%, transparent);
}

.icon-library {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.icon-library-btn {
  min-width: 0;
  aspect-ratio: 1;
  min-height: 54px;
  border-radius: 15px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-strong);
  color: var(--text-soft);
  display: grid;
  place-items: center;
  transition: transform 0.16s ease, border-color 0.16s ease, color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.icon-library-btn:hover {
  transform: translateY(-1px);
  color: var(--text-main);
  border-color: color-mix(in srgb, var(--habit-accent) 34%, var(--surface-outline-strong));
}

.icon-library-btn.selected {
  color: var(--habit-accent);
  border-color: color-mix(in srgb, var(--habit-accent) 52%, var(--surface-outline));
  background: color-mix(in srgb, var(--habit-accent) 12%, var(--surface-strong));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--habit-accent) 18%, transparent), 0 10px 24px color-mix(in srgb, var(--habit-accent) 10%, transparent);
}

.color-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.color-swatch {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: white;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.color-swatch:hover {
  transform: translateY(-1px) scale(1.04);
}

.color-swatch.selected {
  box-shadow:
    0 0 0 4px var(--surface-strong),
    0 0 0 6px color-mix(in srgb, var(--habit-accent) 42%, transparent),
    0 12px 26px color-mix(in srgb, var(--habit-accent) 18%, transparent);
}

.preset-row,
.frequency-row,
.day-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.preset-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.preset-chip,
.day-chip {
  min-height: 40px;
  padding: 9px 12px;
  border-radius: 999px;
  background: var(--surface-strong);
  border: 1px solid var(--surface-outline);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 850;
  text-align: center;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.preset-chip:hover,
.day-chip:hover {
  transform: translateY(-1px);
  color: var(--text-main);
  border-color: color-mix(in srgb, var(--habit-accent) 32%, var(--surface-outline-strong));
}

.preset-chip.selected,
.day-chip.selected {
  color: var(--habit-accent);
  border-color: color-mix(in srgb, var(--habit-accent) 48%, var(--surface-outline));
  background: color-mix(in srgb, var(--habit-accent) 13%, var(--surface-strong));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--habit-accent) 16%, transparent);
}

.target-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.target-field {
  display: grid;
  gap: 8px;
}

.reminder-block {
  padding: 14px;
  border-radius: 20px;
  border: 1px solid var(--surface-outline);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--habit-accent) 8%, transparent), transparent 42%),
    var(--surface-strong);
}

.reminder-block.enabled {
  border-color: color-mix(in srgb, var(--habit-accent) 28%, var(--surface-outline));
}

.reminder-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.reminder-head p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.reminder-toggle {
  min-width: 86px;
  min-height: 40px;
  padding: 7px 10px 7px 7px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 850;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.switch-dot {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--surface-strong);
  color: currentColor;
}

.reminder-toggle:hover {
  transform: translateY(-1px);
  border-color: var(--surface-outline-strong);
}

.reminder-toggle.active {
  color: white;
  border-color: transparent;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--habit-accent) 92%, #12add2), color-mix(in srgb, var(--habit-accent) 72%, #57c3ab));
  box-shadow: 0 14px 30px color-mix(in srgb, var(--habit-accent) 20%, transparent);
}

.reminder-toggle.active .switch-dot {
  background: rgba(255, 255, 255, 0.18);
}

.reminder-controls {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.frequency-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.frequency-chip {
  min-height: 58px;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  text-align: left;
  display: grid;
  gap: 3px;
  transition: transform 0.16s ease, border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
}

.frequency-chip strong {
  font-size: 12px;
  line-height: 1.1;
}

.frequency-chip span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.frequency-chip:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--habit-accent) 32%, var(--surface-outline-strong));
}

.frequency-chip.selected {
  border-color: color-mix(in srgb, var(--habit-accent) 48%, var(--surface-outline));
  background: color-mix(in srgb, var(--habit-accent) 12%, var(--surface-muted));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--habit-accent) 16%, transparent);
}

.day-picker {
  padding: 12px;
  border-radius: 17px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-muted) 76%, transparent);
}

.day-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.day-picker-head small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.day-row {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.day-chip {
  min-height: 38px;
  padding: 8px 4px;
  font-size: 12px;
}

:global(.dark-theme) .modal {
  box-shadow: 0 30px 96px rgba(0, 0, 0, 0.5);
}

:global(.dark-theme) .modal-footer {
  background: color-mix(in srgb, var(--surface-strong) 88%, #020617);
}

:global(.dark-theme) .mod-input,
:global(.dark-theme) .icon-library-btn,
:global(.dark-theme) .preset-chip,
:global(.dark-theme) .frequency-chip,
:global(.dark-theme) .day-chip,
:global(.dark-theme) .reminder-block {
  background-color: color-mix(in srgb, var(--surface-muted) 82%, #020617);
}

:global(.dark-theme) .form-section,
:global(.dark-theme) .day-picker {
  background: color-mix(in srgb, var(--surface-muted) 72%, #020617);
}

:global(.dark-theme) .mod-input {
  color-scheme: dark;
}

@media (max-width: 940px) {
  .modal {
    width: min(640px, calc(100vw - 24px));
    max-height: calc(100vh - 24px);
  }

  .modal-body {
    grid-template-columns: 1fr;
    padding: 16px;
  }

  .icon-library {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .modal-backdrop {
    padding: 8px;
    align-items: stretch;
  }

  .modal {
    width: 100%;
    max-height: calc(100vh - 16px);
    border-radius: 22px;
  }

  .modal-header,
  .modal-footer {
    padding: 14px;
  }

  .modal-body {
    padding: 14px;
  }

  .form-section {
    padding: 13px;
  }

  .icon-library {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .preset-row,
  .frequency-row,
  .target-grid {
    grid-template-columns: 1fr 1fr;
  }

  .day-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
</style>
