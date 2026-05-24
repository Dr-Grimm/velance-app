<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PlusIcon, SparklesIcon, Trash2Icon, XIcon } from 'lucide-vue-next'
import { useVelanceStore } from '../store/velance.js'
import { primeFocusLaunch } from '../services/focusLaunchService.js'

import HabitHeatmap from '../components/habits/HabitHeatmap.vue'
import HabitCard from '../components/habits/HabitCard.vue'
import HabitModal from '../components/habits/HabitModal.vue'

const store = useVelanceStore()
const router = useRouter()

const showModal = ref(false)
const editingHabit = ref(null)
const deleteConfirmId = ref(null)

const globalHeatmap = computed(() => store.getHabitHeatmap(null, 90))

const totalActiveHabits = computed(() => store.habits.length)
const habitCompletionStats = computed(() => store.habitCompletionStats)
const onTrackTodayCount = computed(() => habitCompletionStats.value.onTrack)

const consistencyPercent = computed(() => {
  if (!globalHeatmap.value.length) return 0
  const activeDayCount = globalHeatmap.value.filter((day) => day.count > 0).length
  return Math.round((activeDayCount / globalHeatmap.value.length) * 100)
})

const bestStreakHabit = computed(() => {
  if (!store.habits.length) return { name: 'No streak yet', streak: 0 }
  return store.habits.reduce((best, habit) => {
    const streak = store.getHabitStreak(habit.name)
    return streak > best.streak ? { name: habit.name, streak } : best
  }, { name: 'No streak yet', streak: 0 })
})

const proofBackedHabits = computed(() => store.habits.filter((habit) => store.getHabitSessions(habit.name).length > 0).length)
const proofRate = computed(() => {
  if (!store.habits.length) return 0
  return Math.round((proofBackedHabits.value / store.habits.length) * 100)
})

function habitTodayMinutes(habitName) {
  return store.getHabitTodayMinutes(habitName)
}

const sortedHabits = computed(() => {
  return [...store.habits].sort((a, b) => {
    const aProgress = habitTodayMinutes(a.name) / Math.max(a.targetMinutes || 1, 1)
    const bProgress = habitTodayMinutes(b.name) / Math.max(b.targetMinutes || 1, 1)
    if (aProgress !== bProgress) return bProgress - aProgress
    return store.getHabitStreak(b.name) - store.getHabitStreak(a.name)
  })
})

const nextHabit = computed(() => {
  return habitCompletionStats.value.stats
    .filter((habit) => !habit.isOnTrack)
    .sort((a, b) => a.progress - b.progress)[0] || null
})

const headerCopy = computed(() => {
  if (!store.habits.length) return 'Start with one habit. The map wakes up as linked focus blocks accumulate.'
  if (nextHabit.value) return `${nextHabit.value.name} is the next loop to protect today.`
  return 'The system is stable. Keep the daily target clear and the rhythm will stay visible.'
})

function openAdd() {
  editingHabit.value = null
  showModal.value = true
}

function openEdit(habit) {
  editingHabit.value = habit
  showModal.value = true
}

function handleSave(payload) {
  if (editingHabit.value) {
    store.updateHabit(editingHabit.value.id, payload)
  } else {
    store.addHabit(payload)
  }
}

function confirmDelete(id) {
  deleteConfirmId.value = id
}

function doDelete() {
  if (deleteConfirmId.value === null) return
  store.deleteHabit(deleteConfirmId.value)
  deleteConfirmId.value = null
}

function launchFocus(habit) {
  primeFocusLaunch({
    source: 'habit',
    title: '',
    habit: habit.name,
    habitId: habit.id,
    goal: habit.name,
    durationGoalMinutes: habit.targetMinutes || 60,
    habitColor: habit.color || '#00B4D8',
  })
  router.push('/focus')
}

</script>

<template>
  <div class="habits-module">
    <header class="hero-card">
      <div class="hero-copy">
        <span class="page-kicker">Habit system</span>
        <h1 class="page-title">Habits backed by proof.</h1>
        <p class="page-sub">{{ headerCopy }}</p>
      </div>

      <div class="hero-actions">
        <div v-if="nextHabit" class="next-chip">
          <SparklesIcon size="14" />
          {{ nextHabit.name }} next
        </div>
        <button class="add-btn" @click="openAdd"><PlusIcon size="16" /> New Habit</button>
      </div>
    </header>

    <section class="metrics-grid">
      <article class="metric-card">
        <span class="metric-label">Active</span>
        <strong class="metric-value">{{ totalActiveHabits }}</strong>
        <span class="metric-meta">tracked loops</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Today</span>
        <strong class="metric-value">{{ onTrackTodayCount }}/{{ totalActiveHabits || 0 }}</strong>
        <span class="metric-meta">proof complete</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Best streak</span>
        <strong class="metric-value">{{ bestStreakHabit.streak }}</strong>
        <span class="metric-meta">{{ bestStreakHabit.name }}</span>
      </article>
      <article class="metric-card accent">
        <span class="metric-label">Proof rate</span>
        <strong class="metric-value">{{ proofRate }}%</strong>
        <span class="metric-meta">habits with evidence</span>
      </article>
    </section>

    <!-- Refactored Heatmap Component -->
    <HabitHeatmap />

    <section v-if="store.habits.length" class="habit-grid">
      <HabitCard
        v-for="habit in sortedHabits"
        :key="habit.id"
        :habit="habit"
        @edit="openEdit"
        @delete="confirmDelete"
        @focus="launchFocus"
      />
    </section>

    <section v-else class="empty-state">
      <div class="empty-mark">HB</div>
      <h3>No habits yet</h3>
      <p>Start with one repeatable loop and let the rhythm build around it.</p>
      <button class="add-btn" @click="openAdd"><PlusIcon size="16" /> Create First Habit</button>
    </section>

    <HabitModal
      v-model:show="showModal"
      :habit="editingHabit"
      @save="handleSave"
    />

    <!-- Delete Confirmation Modal -->
    <div v-if="deleteConfirmId !== null" class="modal-backdrop-delete" @click.self="deleteConfirmId = null">
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3>Delete habit?</h3>
          <button class="modal-close" @click="deleteConfirmId = null"><XIcon size="18" /></button>
        </div>
        <p class="delete-warning">This removes the habit and its linked session history from this workspace.</p>
        <div class="modal-footer">
          <button class="modal-cancel" @click="deleteConfirmId = null">Cancel</button>
          <button class="delete-confirm-btn" @click="doDelete"><Trash2Icon size="14" /> Delete</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.habits-module {
  padding: 28px 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1280px;
  margin: 0 auto;
}

.hero-card,
.metric-card,
.empty-state,
.modal {
  background: radial-gradient(circle at top right, var(--accent-glow), transparent 36%), var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(16px);
}

.hero-card {
  border-radius: 28px;
  padding: 22px 24px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 22px;
  align-items: flex-start;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 620px;
}

.page-kicker,
.metric-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--accent-base);
}

.page-title {
  font-size: clamp(1.8rem, 2.8vw, 2.85rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
  color: var(--text-main);
}

.page-sub,
.metric-meta,
.delete-warning,
.empty-state p {
  color: var(--text-muted);
}

.page-sub,
.delete-warning,
.empty-state p {
  font-size: 14px;
  line-height: 1.55;
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.next-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline-strong);
  color: var(--accent-base);
  font-size: 11px;
  font-weight: 700;
}

.add-btn,
.delete-confirm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 13px;
  border: none;
  cursor: pointer;
  transition: transform 0.2s ease, filter 0.2s ease;
}

.add-btn {
  padding: 10px 14px;
  background: var(--accent-gradient);
  color: white;
  font-size: 12px;
  font-weight: 800;
}

.add-btn:hover,
.delete-confirm-btn:hover {
  transform: translateY(-1px);
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.metric-card {
  position: relative;
  overflow: hidden;
  border-radius: 20px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.metric-card.accent {
  background: radial-gradient(circle at top right, rgba(82, 183, 136, 0.14), transparent 36%), var(--surface-strong);
}

.metric-card::after {
  content: '';
  position: absolute;
  inset: auto -18% -52% auto;
  width: 130px;
  height: 130px;
  border-radius: 999px;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent-base) 16%, transparent), transparent 68%);
  opacity: 0;
  transition: opacity 0.22s ease;
}

.metric-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent-base) 24%, var(--surface-outline));
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.08);
}

.metric-card:hover::after {
  opacity: 1;
}

.metric-value {
  font-size: clamp(1.8rem, 3vw, 2.8rem);
  line-height: 1;
  letter-spacing: -0.05em;
  color: var(--text-main);
}

.metric-meta {
  font-size: 12px;
}

.habit-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

@media (min-width: 1280px) {
  .hero-card {
    padding: 26px 28px;
  }

  .hero-copy {
    max-width: 760px;
  }

  .metrics-grid {
    gap: 16px;
  }

  .metric-card {
    min-height: 136px;
    padding: 20px 22px;
  }

  .habit-grid {
    grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
    gap: 18px;
  }
}

.empty-state {
  border-radius: 28px;
  padding: 80px 28px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.empty-mark {
  width: 56px;
  height: 56px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
  border: 1px solid var(--surface-outline-strong);
  font-size: 18px;
  font-weight: 800;
}

.modal-backdrop-delete {
  position: fixed;
  inset: 0;
  background: rgba(10, 14, 21, 0.38);
  backdrop-filter: blur(16px);
  display: grid;
  place-items: center;
  z-index: 1000;
}

.modal {
  border-radius: 24px;
  overflow: hidden;
}

.modal-sm {
  width: min(420px, calc(100vw - 28px));
}

.modal-header,
.modal-footer {
  padding: 18px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-header {
  border-bottom: 1px solid var(--surface-outline);
}

.modal-header h3 {
  font-size: 1.25rem;
}

.modal-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--surface-outline);
  padding: 16px 22px;
}

.delete-confirm-btn {
  padding: 11px 16px;
  background: rgba(239, 68, 68, 0.92);
  color: white;
  font-size: 13px;
  font-weight: 800;
}

.modal-close,
.modal-cancel {
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-muted);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
}

.modal-cancel {
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
}

.modal-close:hover,
.modal-cancel:hover {
  color: var(--text-main);
  border-color: var(--surface-outline-strong);
}

.delete-warning {
  padding: 20px 22px;
}

:global(.dark-theme) .habits-module .page-title,
:global(.dark-theme) .habits-module .metric-value,
:global(.dark-theme) .habits-module .empty-state h3,
:global(.dark-theme) .habits-module .modal-header h3 {
  color: #f8fafc;
}

:global(.dark-theme) .habits-module .metric-card.accent .metric-value {
  color: #f8fafc;
}

@media (max-width: 1120px) {
  .metrics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .habits-module {
    padding: 24px 18px 32px;
  }

  .hero-card {
    padding: 20px;
    grid-template-columns: 1fr;
  }

  .page-title {
    font-size: 2.2rem;
  }

  .metrics-grid {
    grid-template-columns: 1fr;
  }

}
</style>
