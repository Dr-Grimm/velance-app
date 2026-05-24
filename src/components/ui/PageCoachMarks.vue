<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CheckIcon, ChevronRightIcon, XIcon } from 'lucide-vue-next'

const props = defineProps({
  disabled: { type: Boolean, default: false },
})

const route = useRoute()
const router = useRouter()
const activeIndex = ref(0)
const visible = ref(false)
const targetRect = ref(null)
let updateTimer = null

const SKIP_ALL_KEY = 'velance_tour_skip_all_v1'
const DONE_PREFIX = 'velance_tour_done_v1'

const PAGE_TOURS = {
  '/': [
    {
      selector: '.dashboard-module .hero-card, .dashboard-module .command-card, .dashboard-module',
      title: 'Start from the signal',
      body: 'Dashboard tells you what needs attention first: start focus, clean up overdue work, or review activity.',
    },
    {
      selector: '.dashboard-module .challenge-card, .dashboard-module .focus-card, .dashboard-module',
      title: 'Use one next move',
      body: 'When the day feels noisy, choose the highlighted move and turn it into a measured focus block.',
    },
  ],
  '/tasks': [
    {
      selector: '.tasks-module .board-toolbar, .tasks-module',
      title: 'Find the right task fast',
      body: 'Filter by priority, date, status, or reminder so the task list stays useful instead of becoming storage.',
    },
    {
      selector: '.tasks-module .task-row.challenge, .tasks-module .task-row, .tasks-module',
      title: 'Tasks become evidence',
      body: 'Launch Focus from active tasks when you want the task to guide a measured session. Completed tasks stay grouped so they do not compete for attention.',
    },
  ],
  '/focus': [
    {
      selector: '.focus-v2 .setup-card, .focus-v2',
      title: 'Start with one clean block',
      body: 'Pick a duration, link a task or habit, and Velance will measure the session without asking for extra notes.',
    },
    {
      selector: '.focus-v2 .attach-row, .focus-v2 .setup-card',
      title: 'Habit links carry the target',
      body: 'When you link a habit, the session duration follows that habit target and shows its color as a quiet cue.',
    },
  ],
  '/analytics': [
    {
      selector: '.analytics-module .tab-switcher, .analytics-module',
      title: 'Read activity in plain language',
      body: 'Use Activity first when you need the story, then jump into Focus or apps when you want deeper evidence.',
    },
  ],
  '/habits': [
    {
      selector: '.habits-module .hero-card, .habits-module',
      title: 'Habits need proof',
      body: 'Velance counts linked focus sessions, so the habit page rewards real measured work instead of quick fake completions.',
    },
    {
      selector: '.habits-module .habit-grid, .habits-module',
      title: 'Start from the habit',
      body: 'Launching Focus from a habit now uses that habit duration, so your routine stays consistent.',
    },
  ],
  '/insights': [
    {
      selector: '.insights-module .daily-challenge-panel, .insights-module',
      title: 'Take the daily challenge',
      body: 'The challenge rotates from your real signals and keeps a streak when you complete challenge tasks.',
    },
    {
      selector: '.insights-module .daily-read-panel, .insights-module',
      title: 'Today is the default',
      body: 'Insights opens on Today first, then you can widen the range when you want a weekly or monthly read.',
    },
  ],
  '/settings': [
    {
      selector: '.settings-module .settings-tabs, .settings-module',
      title: 'Settings are grouped by risk',
      body: 'Privacy, appearance, alerts, AI, and data each save from their own section so changes stay clear.',
    },
  ],
  '/profile': [
    {
      selector: '.profile-module .profile-card, .profile-module',
      title: 'Profile shapes the coach',
      body: 'Work hours, role, and goals help Velance make recommendations that fit your actual work style.',
    },
  ],
}

const PAGE_ORDER = ['/', '/tasks', '/focus', '/analytics', '/habits', '/insights', '/settings', '/profile']

const normalizedPath = computed(() => {
  if (route.path === '/') return '/'
  const first = route.path.split('/').filter(Boolean)[0]
  return first ? `/${first}` : '/'
})
const steps = computed(() => PAGE_TOURS[normalizedPath.value] || [])
const currentStep = computed(() => steps.value[activeIndex.value] || null)
const isLastStep = computed(() => activeIndex.value >= steps.value.length - 1)
const doneKey = computed(() => `${DONE_PREFIX}:${normalizedPath.value}`)

const nextTourPage = computed(() => {
  const idx = PAGE_ORDER.indexOf(normalizedPath.value)
  for (let i = idx + 1; i < PAGE_ORDER.length; i++) {
    if (PAGE_TOURS[PAGE_ORDER[i]]) return PAGE_ORDER[i]
  }
  return null
})
const isLastPageOfTour = computed(() => nextTourPage.value === null)

const ringStyle = computed(() => {
  const rect = targetRect.value
  if (!rect) return null
  const pad = 8
  return {
    left: `${Math.max(10, rect.left - pad)}px`,
    top: `${Math.max(10, rect.top - pad)}px`,
    width: `${Math.max(80, rect.width + pad * 2)}px`,
    height: `${Math.max(58, rect.height + pad * 2)}px`,
  }
})

const cardStyle = computed(() => {
  const rect = targetRect.value
  if (!rect) {
    return { right: '28px', bottom: '28px' }
  }
  const cardWidth = 340
  const gap = 14
  const fitsRight = rect.right + cardWidth + gap < window.innerWidth - 18
  const fitsBelow = rect.bottom + 190 < window.innerHeight - 18
  const left = fitsRight
    ? rect.right + gap
    : Math.min(window.innerWidth - cardWidth - 18, Math.max(18, rect.left))
  const top = fitsBelow
    ? rect.bottom + gap
    : Math.min(window.innerHeight - 190, Math.max(18, rect.top - 10))
  return {
    left: `${left}px`,
    top: `${top}px`,
  }
})

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key, value) {
  try {
    window.localStorage?.setItem(key, value)
  } catch {}
}

function hasFinishedPage() {
  return storageGet(doneKey.value) === 'true'
}

function hasSkippedAll() {
  return storageGet(SKIP_ALL_KEY) === 'true'
}

function updateTargetRect() {
  if (!visible.value || !currentStep.value) {
    targetRect.value = null
    return
  }
  const selector = currentStep.value.selector
  const node = selector ? document.querySelector(selector) : null
  targetRect.value = node?.getBoundingClientRect?.() || null
}

function scheduleTargetUpdate() {
  window.clearTimeout(updateTimer)
  updateTimer = window.setTimeout(updateTargetRect, 80)
}

async function startPageTour() {
  window.clearTimeout(updateTimer)
  targetRect.value = null
  activeIndex.value = 0
  visible.value = false
  if (props.disabled || !steps.value.length || hasSkippedAll() || hasFinishedPage()) return
  await nextTick()
  visible.value = true
  scheduleTargetUpdate()
}

function finishPage() {
  storageSet(doneKey.value, 'true')
  visible.value = false
  targetRect.value = null
}

function skipAll() {
  storageSet(SKIP_ALL_KEY, 'true')
  visible.value = false
  targetRect.value = null
}

function resetTour() {
  try {
    localStorage.removeItem(SKIP_ALL_KEY)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DONE_PREFIX)) localStorage.removeItem(key)
    }
  } catch {}
  void startPageTour()
}

defineExpose({ resetTour })

function nextStep() {
  if (isLastStep.value) {
    finishPage()
    if (nextTourPage.value) {
      router.push(nextTourPage.value)
    }
    return
  }
  activeIndex.value += 1
  scheduleTargetUpdate()
}

function handleResize() {
  scheduleTargetUpdate()
}

watch(() => [normalizedPath.value, props.disabled], () => {
  void startPageTour()
})

watch(activeIndex, () => {
  scheduleTargetUpdate()
})

onMounted(() => {
  window.addEventListener('resize', handleResize)
  window.addEventListener('scroll', handleResize, true)
  void startPageTour()
})

onBeforeUnmount(() => {
  window.clearTimeout(updateTimer)
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('scroll', handleResize, true)
})
</script>

<template>
  <div v-if="visible && currentStep" class="page-coachmarks" aria-live="polite">
    <div v-if="ringStyle" class="coach-ring" :style="ringStyle"></div>
    <aside class="coach-card" :style="cardStyle">
      <button type="button" class="coach-close" aria-label="Skip this tip" @click="finishPage">
        <XIcon size="14" />
      </button>
      <span class="coach-kicker">Quick guide {{ activeIndex + 1 }} / {{ steps.length }}</span>
      <h2>{{ currentStep.title }}</h2>
      <p>{{ currentStep.body }}</p>
      <div class="coach-actions">
        <button type="button" class="coach-skip" @click="skipAll">Skip all</button>
        <button type="button" class="coach-next" @click="nextStep">
          <CheckIcon v-if="isLastStep && isLastPageOfTour" size="14" />
          <span>{{ isLastStep ? (isLastPageOfTour ? 'Done' : 'Next page') : 'Next' }}</span>
          <ChevronRightIcon v-if="!isLastStep || !isLastPageOfTour" size="14" />
        </button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.page-coachmarks {
  position: fixed;
  inset: 0;
  z-index: 900;
  pointer-events: none;
}

.coach-ring {
  position: fixed;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--accent-base) 52%, transparent);
  box-shadow:
    0 0 0 9999px rgba(15, 23, 42, 0.05),
    0 0 0 5px color-mix(in srgb, var(--accent-base) 9%, transparent),
    0 20px 48px color-mix(in srgb, var(--accent-base) 16%, transparent);
  transition: left 0.22s ease, top 0.22s ease, width 0.22s ease, height 0.22s ease;
}

.coach-card {
  position: fixed;
  width: min(340px, calc(100vw - 36px));
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--surface-outline-strong);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent-base) 11%, transparent), transparent 54%),
    var(--surface-strong);
  box-shadow: 0 24px 54px rgba(15, 23, 42, 0.16);
  color: var(--text-main);
  pointer-events: auto;
  backdrop-filter: blur(18px);
  animation: coachEnter 0.2s ease both;
}

.coach-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  background: var(--surface-muted);
  color: var(--text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.coach-kicker {
  color: var(--accent-base);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.coach-card h2 {
  margin-top: 8px;
  color: var(--text-main);
  font-size: 19px;
  line-height: 1.15;
  letter-spacing: -0.025em;
}

.coach-card p {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.55;
}

.coach-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 16px;
}

.coach-skip,
.coach-next {
  min-height: 36px;
  border-radius: 12px;
  font: inherit;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}

.coach-skip {
  border: 1px solid var(--border-light);
  background: var(--surface-muted);
  color: var(--text-muted);
  padding: 0 12px;
}

.coach-next {
  border: 0;
  background: var(--accent-gradient);
  color: #fff;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  box-shadow: 0 12px 26px var(--accent-glow);
}

@keyframes coachEnter {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 720px) {
  .coach-ring {
    display: none;
  }

  .coach-card {
    left: 18px !important;
    right: 18px;
    bottom: 18px;
    top: auto !important;
  }
}
</style>
