<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ActivityIcon,
  CalendarIcon,
  CheckCircle2Icon,
  EditIcon,
  FlameIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-vue-next'
import { useVelanceStore } from '../../store/velance.js'
import { getHabitIconComponent } from '../../composables/useHabitIcons.js'

const props = defineProps({
  habit: { type: Object, required: true }
})

const emit = defineEmits(['edit', 'delete', 'focus'])

const store = useVelanceStore()

const todayMinutes = computed(() => {
  return store.getHabitTodayMinutes(props.habit.name)
})

const progressPercent = computed(() => {
  return Math.min(Math.round((todayMinutes.value / Math.max(props.habit.targetMinutes, 1)) * 100), 100)
})

const isOnTrack = computed(() => todayMinutes.value >= props.habit.targetMinutes)

const streak = computed(() => store.getHabitStreak(props.habit.name))
const streakLabel = computed(() => {
  const count = Math.max(0, Number(streak.value) || 0)
  if (!count) return 'No streak yet'
  return `${count} day streak`
})
const streakBurst = ref(false)
let streakBurstTimer = null

watch(streak, (next, previous) => {
  if (typeof previous !== 'number' || next <= previous) return
  streakBurst.value = true
  window.clearTimeout(streakBurstTimer)
  streakBurstTimer = window.setTimeout(() => {
    streakBurst.value = false
  }, 1500)
})

onBeforeUnmount(() => {
  window.clearTimeout(streakBurstTimer)
})

const avgFocus = computed(() => store.getHabitAvgFocus(props.habit.name))
const habitSessions = computed(() => [...store.getHabitSessions(props.habit.name)]
  .sort((left, right) => Number(right.timestamp || 0) - Number(left.timestamp || 0)))
const sessionCount = computed(() => habitSessions.value.length)
function formatMinutes(totalMinutes = 0) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes))
  if (safeMinutes < 60) return `${safeMinutes}m`
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}
</script>

<template>
  <article class="habit-card">
    <div class="habit-top">
      <div class="habit-mark" :style="{ color: habit.color }">
        <component :is="getHabitIconComponent(habit.icon, habit.name)" size="20" :stroke-width="2" />
      </div>
      <div class="habit-copy">
        <strong>{{ habit.name }}</strong>
        <span>{{ formatMinutes(habit.targetMinutes) }} daily</span>
      </div>
      <div class="habit-actions">
        <button class="action-btn" @click="$emit('edit', habit)" title="Edit habit"><EditIcon size="14" /></button>
        <button class="action-btn danger" @click="$emit('delete', habit.id)" title="Delete habit"><Trash2Icon size="14" /></button>
      </div>
    </div>

    <div class="habit-progress-area">
      <div class="progress-labels">
        <span class="progress-text">{{ todayMinutes }} / {{ habit.targetMinutes }}m today</span>
        <span v-if="isOnTrack" class="status-text ontrack">Proof complete</span>
        <span v-else class="status-text">Needs proof</span>
      </div>
      <div class="progress-bar">
        <div 
          class="progress-fill" 
          :style="{ width: `${progressPercent}%`, background: habit.color }"
        ></div>
      </div>
    </div>

    <div class="habit-metrics-clean">
      <div
        class="h-metric streak-badge"
        :class="{ lit: streak > 0, 'streak-burst': streakBurst }"
        :title="streakLabel"
      >
        <span class="flame-shell" aria-hidden="true">
          <FlameIcon size="15" class="streak-icon" />
        </span>
        <span>{{ streakLabel }}</span>
      </div>
      <div class="h-metric today-badge" :class="{ complete: isOnTrack }">
        <CheckCircle2Icon size="14" />
        <span>{{ isOnTrack ? 'Today complete' : 'Today pending' }}</span>
      </div>
      <div class="h-metric" :title="`Average focus: ${avgFocus}`">
        <ActivityIcon size="14" /><span>{{ avgFocus }}</span>
      </div>
      <div class="h-metric" :title="`${sessionCount} total blocks`">
        <CalendarIcon size="14" /><span>{{ sessionCount }} blk</span>
      </div>
    </div>

    <div class="habit-footer">
      <button 
        class="focus-btn" 
        :style="{ '--habit-color': habit.color || '#00B4D8' }" 
        @click="$emit('focus', habit)"
      >
        <ZapIcon size="15" /> Start {{ formatMinutes(habit.targetMinutes) }} Focus
      </button>
    </div>
  </article>
</template>

<style scoped>
.habit-card {
  border-radius: 22px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: radial-gradient(circle at top right, var(--accent-glow), transparent 36%), var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(16px);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
  animation: fade-up 0.3s ease backwards;
}

@keyframes fade-up {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.habit-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-elevation-hover);
}

.habit-top {
  display: flex;
  align-items: center;
  gap: 12px;
}

.habit-mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, currentColor 8%, transparent);
  flex-shrink: 0;
}

.habit-copy {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.habit-copy strong {
  font-size: 16px;
  line-height: 1.1;
  color: var(--text-main);
}

.habit-copy span {
  font-size: 12px;
  color: var(--text-muted);
}

.habit-actions {
  display: flex;
  gap: 6px;
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--surface-muted);
  color: var(--text-main);
}

.action-btn.danger:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.habit-progress-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
}

.progress-text {
  color: var(--text-muted);
}

.status-text.ontrack {
  color: #52B788;
}

.status-text {
  color: var(--text-muted);
}

.progress-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-muted);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.habit-metrics-clean {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.h-metric {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}

.streak-badge {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  min-height: 30px;
  color: #b45309;
  font-size: 12px;
  font-weight: 850;
  background:
    linear-gradient(135deg, rgba(255, 247, 237, 0.96), rgba(254, 243, 199, 0.9)),
    color-mix(in srgb, #f59e0b 12%, var(--surface-muted));
  border: 1px solid rgba(251, 191, 36, 0.5);
  box-shadow: 0 8px 20px rgba(245, 158, 11, 0.1);
  padding: 5px 10px 5px 7px;
  border-radius: 999px;
}

.streak-badge::after {
  content: '';
  position: absolute;
  inset: -70% auto auto -30%;
  width: 54px;
  height: 54px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(251, 146, 60, 0.32), transparent 68%);
  opacity: 0.7;
  z-index: -1;
  animation: ember-drift 4.8s ease-in-out infinite;
}

.streak-badge:not(.lit) {
  color: var(--text-muted);
  background: var(--surface-muted);
  border-color: var(--surface-outline);
  box-shadow: none;
}

.streak-badge:not(.lit)::after {
  opacity: 0;
}

.flame-shell {
  position: relative;
  overflow: hidden;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 78%, rgba(254, 215, 170, 0.96), transparent 24%),
    linear-gradient(145deg, rgba(251, 191, 36, 0.34), rgba(248, 113, 113, 0.18));
  color: #f97316;
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.35);
}

.flame-shell::before,
.flame-shell::after {
  content: '';
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
}

.flame-shell::before {
  inset: 4px 6px 3px;
  background:
    radial-gradient(circle at 50% 72%, rgba(255, 255, 255, 0.7), transparent 22%),
    radial-gradient(circle at 50% 55%, rgba(251, 191, 36, 0.64), transparent 42%),
    radial-gradient(circle at 50% 30%, rgba(248, 113, 113, 0.28), transparent 62%);
  filter: blur(0.1px);
  animation: flame-core 1.35s ease-in-out infinite;
}

.flame-shell::after {
  inset: 0;
  background:
    radial-gradient(circle at 42% 72%, rgba(254, 240, 138, 0.2), transparent 18%),
    radial-gradient(circle at 60% 34%, rgba(251, 146, 60, 0.16), transparent 24%);
  opacity: 0.72;
  animation: ember-breathe 1.8s ease-in-out infinite;
}

.streak-icon {
  position: relative;
  z-index: 1;
  transform-origin: 50% 80%;
  animation: flame-flicker 1.28s ease-in-out infinite;
}

.streak-badge.streak-burst {
  animation: streak-pop 0.75s cubic-bezier(0.16, 1, 0.3, 1);
}

.streak-badge.streak-burst .flame-shell {
  animation: flame-glow 0.9s ease-out;
}

@keyframes flame-flicker {
  0%, 100% { transform: translateY(0) rotate(-2deg) scale(1); filter: drop-shadow(0 0 3px rgba(249, 115, 22, 0.3)); }
  22% { transform: translateY(-1px) rotate(4deg) scale(1.12, 1.05); filter: drop-shadow(0 0 8px rgba(249, 115, 22, 0.52)); }
  48% { transform: translateY(0) rotate(-5deg) scale(0.97, 1.1); filter: drop-shadow(0 0 5px rgba(251, 191, 36, 0.44)); }
  72% { transform: translateY(-0.5px) rotate(2deg) scale(1.08, 0.98); }
}

@keyframes flame-core {
  0%, 100% { transform: translateY(1px) scale(0.84, 0.9); opacity: 0.72; }
  38% { transform: translateY(-2px) scale(1.05, 1.24); opacity: 0.98; }
  68% { transform: translateY(0) scale(0.94, 1.08); opacity: 0.82; }
}

@keyframes ember-breathe {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.46; }
  45% { transform: scale(1.12) rotate(8deg); opacity: 0.86; }
}

@keyframes flame-glow {
  0% { box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.35), 0 0 0 rgba(251, 146, 60, 0); }
  45% { box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.55), 0 0 28px rgba(251, 146, 60, 0.46); }
  100% { box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.35), 0 0 0 rgba(251, 146, 60, 0); }
}

@keyframes streak-pop {
  0% { transform: scale(1); }
  38% { transform: scale(1.045) translateY(-1px); }
  100% { transform: scale(1); }
}

@keyframes ember-drift {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.52; }
  50% { transform: translate(16px, 8px) scale(1.18); opacity: 0.86; }
}

.today-badge {
  min-height: 30px;
  padding: 5px 9px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
}

.today-badge.complete {
  color: #047857;
  border-color: rgba(16, 185, 129, 0.34);
  background: linear-gradient(135deg, rgba(209, 250, 229, 0.72), rgba(236, 253, 245, 0.82));
  box-shadow: 0 8px 18px rgba(16, 185, 129, 0.1);
}

:global(.dark-theme) .streak-badge {
  color: #fbbf24;
  background:
    linear-gradient(135deg, rgba(120, 53, 15, 0.72), rgba(69, 26, 3, 0.78)),
    color-mix(in srgb, #f59e0b 16%, var(--surface-muted));
  border-color: rgba(251, 191, 36, 0.26);
  box-shadow: 0 10px 24px rgba(245, 158, 11, 0.08);
}

:global(.dark-theme) .streak-badge:not(.lit) {
  color: var(--text-muted);
  background: var(--surface-muted);
  border-color: var(--surface-outline);
  box-shadow: none;
}

:global(.dark-theme) .flame-shell {
  color: #fbbf24;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(239, 68, 68, 0.12));
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.24);
}

:global(.dark-theme) .today-badge.complete {
  color: #86efac;
  border-color: rgba(52, 211, 153, 0.26);
  background: linear-gradient(135deg, rgba(6, 78, 59, 0.62), rgba(20, 83, 45, 0.36));
  box-shadow: 0 10px 22px rgba(16, 185, 129, 0.06);
}

@media (prefers-reduced-motion: reduce) {
  .streak-icon,
  .streak-badge::after,
  .streak-badge.streak-burst,
  .streak-badge.streak-burst .flame-shell {
    animation: none;
  }
}

.habit-footer {
  margin-top: 2px;
  display: grid;
  grid-template-columns: 1fr;
}

.focus-btn {
  min-height: 44px;
  padding: 11px 14px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--habit-color) 28%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--habit-color) 92%, #12add2), color-mix(in srgb, var(--habit-color) 72%, #57c3ab));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 14px 30px color-mix(in srgb, var(--habit-color) 22%, transparent);
  transition: filter 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}

.focus-btn:hover {
  filter: brightness(1.06) saturate(1.05);
  transform: translateY(-2px);
  box-shadow: 0 18px 38px color-mix(in srgb, var(--habit-color) 30%, transparent);
}
</style>
