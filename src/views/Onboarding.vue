<script setup>
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth.js'
import { useVelanceStore } from '../store/velance.js'
import {
  TRACKING_CONSENT_VERSION,
  hasResolvedTrackingConsent,
} from '../services/trackingConsent.js'
import { writeTrackingConsentFallback } from '../services/trackingConsentState.js'
import { hasCompletedOnboardingState, markOnboardingDone } from '../services/onboardingState.js'
import {
  ArrowRightIcon,
  ArrowLeftIcon,
  CheckIcon,
  LoaderCircleIcon,
} from 'lucide-vue-next'
import {
  HABIT_ICON_OPTIONS,
  getHabitIconOption,
} from '../composables/useHabitIcons.js'

const router = useRouter()
const authStore = useAuthStore()
const velance = useVelanceStore()

const TOTAL_STEPS = 5
const step = ref(1)
const saving = ref(false)

/* Step 2 — Profile */
const profileName = ref('')
const profileRole = ref('')
const profileGoal = ref('')
const workStart = ref('09:00')
const workEnd = ref('17:00')

/* Step 3 — Tracking consent */
const trackingChoice = ref(null) // true | false | null

/* Step 4 — First habit */
const habitName = ref('')
const habitIcon = ref('focus')
const habitTarget = ref(30)
const habitSkipped = ref(false)

const FOCUS_GOALS = [
  { id: 'flow', label: 'Stay in flow longer', icon: '🌊', desc: 'Protect uninterrupted blocks of deep concentration.' },
  { id: 'ship', label: 'Ship things that matter', icon: '🚀', desc: 'Turn ideas into finished work, one session at a time.' },
  { id: 'mornings', label: 'Own my mornings', icon: '☀️', desc: 'Build a consistent routine before the world demands attention.' },
  { id: 'think', label: 'Think without interruption', icon: '🧠', desc: 'Space to research, write, and reason through complex problems.' },
  { id: 'habit', label: 'Build one habit at a time', icon: '🔁', desc: 'Consistency over intensity — small loops compounding daily.' },
  { id: 'creative', label: 'Protect creative time', icon: '🎨', desc: 'Guard the time when your best ideas actually surface.' },
  { id: 'balance', label: 'Work hard, recover smart', icon: '⚖️', desc: 'High output without burning through yourself.' },
  { id: 'signal', label: 'Cut the noise, keep the signal', icon: '🎯', desc: 'Less distraction, faster decisions, cleaner thinking.' },
]

const HABIT_ICONS = HABIT_ICON_OPTIONS.slice(0, 12)

const displayName = computed(() => {
  const meta = authStore.user?.user_metadata || {}
  return profileName.value ||
    meta.username || meta.full_name || meta.name ||
    authStore.user?.email?.split('@')[0] || 'there'
})

const isStep2Valid = computed(() => profileName.value.trim().length >= 2)
const isStep4Valid = computed(() => habitSkipped.value || habitName.value.trim().length >= 2)

/* Sync name from auth on mount */
watch(() => authStore.user, (u) => {
  if (!profileName.value && u) {
    const meta = u.user_metadata || {}
    profileName.value = meta.username || meta.full_name || meta.name || u.email?.split('@')[0] || ''
  }
}, { immediate: true })

function goNext() {
  if (step.value < TOTAL_STEPS) step.value++
}

function goBack() {
  if (step.value > 1) step.value--
}

function syncFromStoredProfile(profile = velance.userProfile || {}) {
  if (!profileName.value && profile?.name && profile.name !== 'User') profileName.value = profile.name
  if (!profileRole.value && profile?.role && profile.role !== 'Professional') profileRole.value = profile.role
  if (!profileGoal.value && profile?.goal && profile.goal !== 'productivity') profileGoal.value = profile.goal
  if (profile?.workingHours && String(profile.workingHours).includes('-')) {
    const [start, end] = String(profile.workingHours).split('-')
    if (start) workStart.value = start
    if (end) workEnd.value = end
  }
}

function isAlreadyOnboarded() {
  return getOnboardingWorkspaceIds().some((workspaceId) => hasCompletedOnboardingState({
    workspaceId,
    profile: velance.userProfile,
    settings: velance.settings,
    tasks: velance.tasks,
    habits: velance.habits,
    sessions: velance.sessions,
  }))
}

function getOnboardingWorkspaceIds() {
  return [...new Set([
    velance.currentWorkspaceId,
    authStore.user?.id,
  ].filter(Boolean))]
}

function markOnboardingComplete() {
  getOnboardingWorkspaceIds().forEach((workspaceId) => markOnboardingDone(workspaceId))
}

function writeConsentFallback(granted, at = Date.now()) {
  const workspaceIds = new Set([
    velance.currentWorkspaceId,
    authStore.user?.id,
  ].filter(Boolean))

  let decision = null
  workspaceIds.forEach((workspaceId) => {
    decision = writeTrackingConsentFallback({ workspaceId, granted, at })
  })
  return decision
}

async function saveProfile({ complete = false } = {}) {
  const combinedHours = `${workStart.value}-${workEnd.value}`
  // Always save all profile fields including role to prevent defaults overwriting user input
  await authStore.updateProfile({
    username: profileName.value,
    preferences: { goal: profileGoal.value, workingHours: combinedHours },
  })
  await velance.saveProfile({
    name: profileName.value,
    role: profileRole.value,
    goal: profileGoal.value,
    workingHours: combinedHours,
    setupComplete: Boolean(complete),
  })
}

async function applyConsent() {
  const granted = Boolean(trackingChoice.value)
  const consentAt = Date.now()
  // Use Object.assign to keep Vue 3 reactive proxy working correctly
  Object.assign(velance.settings, {
    trackingConsentGranted: granted,
    trackingConsentVersion: TRACKING_CONSENT_VERSION,
    trackingConsentAt: consentAt,
    trackingEnabled: Boolean(granted),
  })
  writeConsentFallback(granted, consentAt)
  await velance.saveSettings()
  // Signal App.vue to immediately re-evaluate ambient tracking after consent is saved
  window.dispatchEvent(new CustomEvent('velance:cloud-sync-request', { detail: { reason: 'consent-applied' } }))
}

async function saveHabit() {
  if (habitSkipped.value || !habitName.value.trim()) return
  try {
    // Do NOT pass a custom id — let the store assign the correct auto-increment numeric id
    // Passing a string id like 'habit-1234' breaks the upsert lookup in the data layer
    await velance.addHabit({
      name: habitName.value.trim(),
      icon: habitIcon.value,
      targetMinutes: habitTarget.value,
      color: '#0ea5e9',
    })
  } catch (e) {
    console.warn('[Onboarding] Could not save habit:', e)
  }
}

async function finishOnboarding() {
  saving.value = true
  try {
    await applyConsent()
    if (!habitSkipped.value && habitName.value.trim()) await saveHabit()
    await saveProfile({ complete: true })
    markOnboardingComplete()
    await router.replace('/')
  } finally {
    saving.value = false
  }
}

function handleStep2Next() {
  if (!isStep2Valid.value) return
  goNext()
}

function handleStep3Next() {
  if (trackingChoice.value === null) return
  goNext()
}

async function handleStep4Next() {
  if (habitSkipped.value || habitName.value.trim()) goNext()
}

async function handleFinish() {
  await finishOnboarding()
}

watch(() => velance.userProfile, syncFromStoredProfile, { immediate: true, deep: true })

onMounted(async () => {
  await nextTick()
  if (isAlreadyOnboarded()) {
    markOnboardingComplete()
    await router.replace('/')
  }
})
</script>

<template>
  <div class="ob-root">
    <div class="ob-mesh"></div>

    <div class="ob-shell">
      <!-- Progress bar -->
      <div class="ob-progress">
        <div
          v-for="i in TOTAL_STEPS"
          :key="i"
          class="ob-progress-dot"
          :class="{ done: i < step, active: i === step }"
        />
      </div>

      <!-- ── Step 1: Welcome ── -->
      <transition name="ob-slide" mode="out-in">
        <div v-if="step === 1" key="step1" class="ob-step ob-welcome">
          <div class="ob-logo-mark">
            <div class="ob-logo-orbit"></div>
            <div class="ob-logo">V</div>
          </div>
          <div class="ob-step-head center">
            <span class="ob-kicker">Welcome to Velance</span>
            <h1 class="ob-title">Hey {{ displayName }}, <br>let's set up<br><span class="ob-gradient">your workspace</span></h1>
            <p class="ob-subtitle">It takes about 2 minutes. We'll get your profile, tracking preferences, and one habit loop ready.</p>
          </div>
          <div class="ob-feature-pills">
            <div class="ob-feature-pill"><span>⚡</span> Focus Session tracking</div>
            <div class="ob-feature-pill"><span>🔁</span> Habit streaks</div>
            <div class="ob-feature-pill"><span>🧠</span> Ambient intelligence</div>
          </div>
          <button class="ob-primary-btn large" @click="goNext">
            Let's get started
            <ArrowRightIcon :size="18" />
          </button>
          <p class="ob-footnote">No data is collected until you choose.</p>
        </div>

        <!-- ── Step 2: Profile ── -->
        <div v-else-if="step === 2" key="step2" class="ob-step">
          <div class="ob-step-head">
            <span class="ob-kicker">Step 1 of 4</span>
            <h2 class="ob-step-title">Tell us about yourself</h2>
            <p class="ob-subtitle">This personalises your dashboard, recommendations, and session context.</p>
          </div>

          <div class="ob-card">
            <label class="ob-field">
              <span class="ob-label">Your name <span class="ob-req">*</span></span>
              <input
                v-model="profileName"
                class="ob-input"
                type="text"
                placeholder="Jane Doe"
                autocomplete="name"
              />
            </label>

            <label class="ob-field">
              <span class="ob-label">What do you do?</span>
              <input
                v-model="profileRole"
                class="ob-input"
                type="text"
                placeholder="e.g. Software engineer, Designer, Student…"
              />
            </label>

            <div class="ob-field">
              <span class="ob-label">Work hours</span>
              <div class="ob-time-row">
                <label class="ob-field ob-flex1">
                  <span class="ob-label-sm">From</span>
                  <input v-model="workStart" class="ob-input center" type="time" />
                </label>
                <span class="ob-time-sep">→</span>
                <label class="ob-field ob-flex1">
                  <span class="ob-label-sm">To</span>
                  <input v-model="workEnd" class="ob-input center" type="time" />
                </label>
              </div>
            </div>
          </div>

          <div class="ob-step-head" style="margin-top: 4px;">
            <span class="ob-label">What's your primary focus goal?</span>
          </div>

          <div class="ob-goal-grid">
            <button
              v-for="goal in FOCUS_GOALS"
              :key="goal.id"
              class="ob-goal-card"
              :class="{ active: profileGoal === goal.id }"
              @click="profileGoal = goal.id"
            >
              <span class="ob-goal-icon">{{ goal.icon }}</span>
              <div class="ob-goal-copy">
                <strong>{{ goal.label }}</strong>
                <span>{{ goal.desc }}</span>
              </div>
              <div v-if="profileGoal === goal.id" class="ob-goal-check">
                <CheckIcon :size="12" />
              </div>
            </button>
          </div>

          <div class="ob-actions">
            <button class="ob-back-btn" @click="goBack">
              <ArrowLeftIcon :size="14" /> Back
            </button>
            <button
              class="ob-primary-btn"
              :class="{ disabled: !isStep2Valid }"
              :disabled="!isStep2Valid || saving"
              @click="handleStep2Next"
            >
              <LoaderCircleIcon v-if="saving" class="spin" :size="15" />
              <span>{{ saving ? 'Saving…' : 'Continue' }}</span>
              <ArrowRightIcon :size="15" />
            </button>
          </div>
        </div>

        <!-- ── Step 3: Privacy & Tracking Consent ── -->
        <div v-else-if="step === 3" key="step3" class="ob-step">
          <div class="ob-step-head center">
            <span class="ob-kicker">Step 2 of 4</span>
            <h2 class="ob-step-title">Your privacy, your choice</h2>
            <p class="ob-subtitle">Velance's tracking engine is built local-first. Here's exactly what it can observe — with your permission.</p>
          </div>

          <div class="ob-tracking-grid">
            <div class="ob-tracking-item">
              <span class="ob-tracking-icon">🪟</span>
              <div>
                <strong>Active app & window</strong>
                <span>Which app and window title is in focus.</span>
              </div>
            </div>
            <div class="ob-tracking-item">
              <span class="ob-tracking-icon">⌨️</span>
              <div>
                <strong>Keystroke rhythm</strong>
                <span>Speed and pace only — never actual words.</span>
              </div>
            </div>
            <div class="ob-tracking-item">
              <span class="ob-tracking-icon">🖱️</span>
              <div>
                <strong>Mouse motion</strong>
                <span>Distance, clicks, scroll — a workload proxy.</span>
              </div>
            </div>
            <div class="ob-tracking-item">
              <span class="ob-tracking-icon">🌐</span>
              <div>
                <strong>Browser context</strong>
                <span>Active tab URL and title (with extension installed).</span>
              </div>
            </div>
          </div>

          <div class="ob-privacy-pills">
            <div class="ob-privacy-pill">🔒 Stays on your device</div>
            <div class="ob-privacy-pill">🚫 Never uploaded without consent</div>
            <div class="ob-privacy-pill">✏️ Change anytime in Settings</div>
          </div>

          <div class="ob-consent-cards">
            <button
              class="ob-consent-card primary-choice"
              :class="{ chosen: trackingChoice === true }"
              @click="trackingChoice = true"
            >
              <span class="ob-consent-dot green"></span>
              <div>
                <strong>Enable tracking</strong>
                <span>Get full focus scoring, fatigue analysis, and productivity insights.</span>
              </div>
              <div v-if="trackingChoice === true" class="ob-consent-check"><CheckIcon :size="14" /></div>
            </button>
            <button
              class="ob-consent-card"
              :class="{ chosen: trackingChoice === false }"
              @click="trackingChoice = false"
            >
              <span class="ob-consent-dot gray"></span>
              <div>
                <strong>Not yet</strong>
                <span>Use tasks, habits, and planning tools without ambient tracking.</span>
              </div>
              <div v-if="trackingChoice === false" class="ob-consent-check"><CheckIcon :size="14" /></div>
            </button>
          </div>

          <div class="ob-actions">
            <button class="ob-back-btn" @click="goBack">
              <ArrowLeftIcon :size="14" /> Back
            </button>
            <button
              class="ob-primary-btn"
              :class="{ disabled: trackingChoice === null }"
              :disabled="trackingChoice === null"
              @click="handleStep3Next"
            >
              Continue
              <ArrowRightIcon :size="15" />
            </button>
          </div>
        </div>

        <!-- ── Step 4: First Habit ── -->
        <div v-else-if="step === 4" key="step4" class="ob-step">
          <div class="ob-step-head center">
            <span class="ob-kicker">Step 3 of 4</span>
            <h2 class="ob-step-title">Build your first<br>habit loop</h2>
            <p class="ob-subtitle">Habits in Velance link to focus sessions and show up as streaks and heatmaps. You can add more later.</p>
          </div>

          <div v-if="!habitSkipped" class="ob-card">
            <label class="ob-field">
              <span class="ob-label">Habit name</span>
              <input
                v-model="habitName"
                class="ob-input"
                type="text"
                placeholder="e.g. Deep reading, Coding, Journaling…"
              />
            </label>

            <div class="ob-field">
              <span class="ob-label">Choose an icon</span>
              <div class="ob-icon-grid">
                <button
                  v-for="icon in HABIT_ICONS"
                  :key="icon.key"
                  class="ob-icon-btn"
                  :class="{ active: habitIcon === icon.key }"
                  :title="icon.label"
                  :aria-label="icon.label"
                  @click="habitIcon = icon.key"
                >
                  <component :is="icon.component" :size="18" :stroke-width="2" />
                </button>
              </div>
            </div>

            <div class="ob-field">
              <span class="ob-label">Daily target</span>
              <div class="ob-target-row">
                <button class="ob-step-btn" @click="habitTarget = Math.max(10, habitTarget - 15)">–</button>
                <span class="ob-target-val">{{ habitTarget }} min</span>
                <button class="ob-step-btn" @click="habitTarget = Math.min(480, habitTarget + 15)">+</button>
              </div>
            </div>
          </div>

          <div v-if="habitSkipped" class="ob-skip-notice">
            <span>👍</span>
            <p>No problem — you can create habits anytime from the Habits tab.</p>
          </div>

          <div class="ob-actions">
            <button class="ob-back-btn" @click="goBack">
              <ArrowLeftIcon :size="14" /> Back
            </button>
            <button class="ob-skip-btn" @click="habitSkipped = !habitSkipped">
              {{ habitSkipped ? 'Add a habit' : 'Skip for now' }}
            </button>
            <button
              class="ob-primary-btn"
              :class="{ disabled: !isStep4Valid }"
              :disabled="!isStep4Valid"
              @click="handleStep4Next"
            >
              Continue
              <ArrowRightIcon :size="15" />
            </button>
          </div>
        </div>

        <!-- ── Step 5: Ready ── -->
        <div v-else key="step5" class="ob-step ob-ready">
          <div class="ob-ready-mark">
            <div class="ob-ready-ring"></div>
            <div class="ob-ready-check"><CheckIcon :size="28" /></div>
          </div>

          <div class="ob-step-head center">
            <span class="ob-kicker">You're all set</span>
            <h2 class="ob-step-title">{{ displayName }}, your workspace is ready.</h2>
            <p class="ob-subtitle">Here's what we configured together:</p>
          </div>

          <div class="ob-summary-grid">
            <div class="ob-summary-item">
              <span class="ob-summary-icon">👤</span>
              <div>
                <strong>Profile</strong>
                <span>{{ profileName }}{{ profileRole ? ` · ${profileRole}` : '' }}</span>
              </div>
            </div>
            <div class="ob-summary-item">
              <span class="ob-summary-icon">{{ FOCUS_GOALS.find(g => g.id === profileGoal)?.icon || '🎯' }}</span>
              <div>
                <strong>Focus goal</strong>
                <span>{{ FOCUS_GOALS.find(g => g.id === profileGoal)?.label || 'Not set' }}</span>
              </div>
            </div>
            <div class="ob-summary-item">
              <span class="ob-summary-icon">{{ trackingChoice ? '✅' : '⏸️' }}</span>
              <div>
                <strong>Tracking</strong>
                <span>{{ trackingChoice ? 'Enabled — local and private' : 'Off — can enable in Settings' }}</span>
              </div>
            </div>
            <div class="ob-summary-item" v-if="!habitSkipped && habitName">
              <span class="ob-summary-icon">
                <component :is="getHabitIconOption(habitIcon, habitName).component" :size="20" :stroke-width="2" />
              </span>
              <div>
                <strong>First habit</strong>
                <span>{{ habitName }} · {{ habitTarget }} min / day</span>
              </div>
            </div>
          </div>

          <button class="ob-primary-btn large" :disabled="saving" @click="handleFinish">
            <LoaderCircleIcon v-if="saving" class="spin" :size="16" />
            <span>{{ saving ? 'Setting up…' : 'Open my dashboard' }}</span>
            <ArrowRightIcon v-if="!saving" :size="18" />
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
/* ── Root ── */
.ob-root {
  position: relative;
  height: 100%;
  min-height: 100vh;
  max-height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  isolation: isolate;
  padding: clamp(28px, 4vh, 44px) 24px clamp(36px, 5vh, 56px);
  background:
    radial-gradient(ellipse 42% 34% at 13% 8%, rgba(14, 165, 233, 0.16), transparent 70%),
    radial-gradient(ellipse 44% 36% at 86% 10%, rgba(99, 102, 241, 0.12), transparent 72%),
    radial-gradient(ellipse 46% 36% at 82% 88%, rgba(20, 184, 166, 0.16), transparent 72%),
    linear-gradient(135deg, #eef9ff 0%, #f8f5ff 48%, #e9fbf7 100%);
  color: var(--text-main);
}

.ob-mesh {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 52% 42% at 12% 10%, rgba(14, 165, 233, 0.10), transparent 68%),
    radial-gradient(ellipse 44% 36% at 86% 12%, rgba(99, 102, 241, 0.08), transparent 70%),
    radial-gradient(ellipse 42% 34% at 82% 86%, rgba(20, 184, 166, 0.10), transparent 70%);
  animation: meshDrift 20s ease-in-out infinite alternate;
}

@keyframes meshDrift {
  0%   { transform: scale(1); }
  100% { transform: scale(1.025); }
}

.ob-shell {
  position: relative;
  z-index: 1;
  width: min(760px, calc(100vw - 48px));
  margin: auto 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(14px, 2vh, 22px);
}

/* ── Progress ── */
.ob-progress {
  display: flex;
  gap: 8px;
  align-items: center;
}

.ob-progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--border-light);
  transition: all 0.3s ease;
}

.ob-progress-dot.active {
  width: 28px;
  background: linear-gradient(90deg, #0ea5e9, #14b8a6);
}

.ob-progress-dot.done {
  background: rgba(14, 165, 233, 0.4);
}

/* ── Steps ── */
.ob-step {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: clamp(14px, 1.8vh, 18px);
  padding-bottom: 8px;  /* ensure actions button not clipped */
}

/* Step 1 (welcome) is centered */
.ob-step.ob-welcome {
  align-items: center;
  text-align: center;
}

/* ── Typography ── */
.ob-kicker {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #0ea5e9;
  margin-bottom: 4px;
}

.ob-title {
  font-size: clamp(40px, 5vw, 58px);
  line-height: 0.97;
  letter-spacing: -0.055em;
  margin-bottom: 14px;
}

.ob-step-title {
  font-size: clamp(28px, 3.5vw, 38px);
  line-height: 0.97;
  letter-spacing: -0.04em;
  margin-bottom: 10px;
}

.ob-gradient {
  background: linear-gradient(120deg, #0ea5e9, #14b8a6, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.ob-subtitle {
  font-size: 15px;
  line-height: 1.65;
  color: var(--text-muted);
  max-width: 520px;
}

.ob-step-head {
  display: flex;
  flex-direction: column;
}

.ob-step-head.center {
  align-items: center;
  text-align: center;
  width: 100%;
}

/* ── Logo mark ── */
.ob-logo-mark {
  position: relative;
  width: 96px;
  height: 96px;
  display: grid;
  place-items: center;
  margin: 0 auto;
}

.ob-logo-orbit {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 2px solid transparent;
  border-top-color: rgba(14, 165, 233, 0.7);
  border-right-color: rgba(20, 184, 166, 0.4);
  animation: obSpin 2s linear infinite;
}

.ob-logo {
  width: 70px;
  height: 70px;
  border-radius: 22px;
  display: grid;
  place-items: center;
  font-size: 30px;
  font-weight: 800;
  color: white;
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  box-shadow: 0 18px 36px rgba(14, 165, 233, 0.26);
}

@keyframes obSpin { to { transform: rotate(360deg); } }

/* ── Feature pills (step 1) ── */
.ob-feature-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
}

.ob-feature-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 82%, transparent);
  font-size: 14px;
  font-weight: 600;
  backdrop-filter: blur(12px);
}

.ob-footnote {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  width: 100%;
}

/* ── Card ── */
.ob-card {
  width: 100%;
  border-radius: 24px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 90%, transparent);
  backdrop-filter: blur(18px);
  padding: clamp(20px, 2.6vh, 24px);
  display: flex;
  flex-direction: column;
  gap: clamp(16px, 2vh, 20px);
}

/* ── Fields ── */
.ob-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ob-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.ob-label-sm { font-size: 11px; color: var(--text-muted); font-weight: 600; }

.ob-req { color: #ef4444; }

.ob-input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card-hover) 82%, transparent);
  color: var(--text-main);
  font: inherit;
  font-size: 15px;
  outline: none;
  transition: border-color 0.18s, box-shadow 0.18s;
}

.ob-input:focus {
  border-color: rgba(14, 165, 233, 0.5);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.10);
}

.ob-input.center { text-align: center; }

.ob-time-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ob-flex1 { flex: 1; }
.ob-time-sep { color: var(--text-muted); font-size: 18px; margin-top: 20px; }

/* ── Goal grid ── */
.ob-goal-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ob-goal-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 14px;
  border-radius: 16px;
  border: 1.5px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 84%, transparent);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: all 0.2s ease;
  min-height: 64px;
}

.ob-goal-card:hover {
  border-color: rgba(14, 165, 233, 0.3);
  background: color-mix(in srgb, var(--bg-card) 92%, transparent);
}

.ob-goal-card.active {
  border-color: rgba(14, 165, 233, 0.6);
  background: rgba(14, 165, 233, 0.06);
}

.ob-goal-icon { font-size: 22px; flex-shrink: 0; margin-top: 2px; }

.ob-goal-copy strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 4px;
  line-height: 1.3;
}

.ob-goal-copy span {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.45;
}

.ob-goal-check {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: #0ea5e9;
  display: grid;
  place-items: center;
  color: white;
}

/* ── Tracking items ── */
.ob-tracking-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ob-tracking-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 82%, transparent);
}

.ob-tracking-icon { font-size: 22px; flex-shrink: 0; }

.ob-tracking-item strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 4px;
}

.ob-tracking-item span {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* ── Privacy pills ── */
.ob-privacy-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.ob-privacy-pill {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 80%, transparent);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-muted);
}

/* ── Consent cards ── */
.ob-consent-cards {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ob-consent-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px;
  border-radius: 20px;
  border: 1.5px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 84%, transparent);
  cursor: pointer;
  text-align: left;
  font: inherit;
  transition: all 0.2s ease;
}

.ob-consent-card:hover { border-color: rgba(14, 165, 233, 0.3); }

.ob-consent-card.chosen {
  border-color: rgba(14, 165, 233, 0.6);
  background: rgba(14, 165, 233, 0.06);
}

.ob-consent-card.primary-choice { overflow: hidden; }
.ob-consent-card.primary-choice::before {
  content: 'Recommended';
  position: absolute;
  top: 10px;
  right: 14px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #0ea5e9;
}

.ob-consent-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  flex-shrink: 0;
  margin-top: 5px;
}

.ob-consent-dot.green { background: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.4); }
.ob-consent-dot.gray { background: var(--text-muted); }

.ob-consent-card strong {
  display: block;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 5px;
}

.ob-consent-card span {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}

.ob-consent-check {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #0ea5e9;
  display: grid;
  place-items: center;
  color: white;
  flex-shrink: 0;
  margin-top: 3px;
}

/* ── Habit builder ── */
.ob-icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ob-icon-btn {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  border: 1.5px solid var(--border-light);
  background: transparent;
  color: var(--text-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: all 0.18s;
}

.ob-icon-btn:hover {
  color: var(--text-main);
  border-color: rgba(14, 165, 233, 0.4);
  transform: scale(1.08);
}
.ob-icon-btn.active {
  color: #0ea5e9;
  border-color: rgba(14, 165, 233, 0.7);
  background: rgba(14, 165, 233, 0.1);
}

.ob-target-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.ob-step-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card-hover) 80%, transparent);
  color: var(--text-main);
  font: inherit;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s;
}

.ob-step-btn:hover { transform: scale(1.08); }

.ob-target-val {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.03em;
  min-width: 90px;
  text-align: center;
}

.ob-skip-notice {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 80%, transparent);
  font-size: 14px;
  color: var(--text-muted);
}

/* ── Ready step ── */
.ob-ready {
  align-items: center;
  text-align: center;
}

.ob-ready-mark {
  position: relative;
  width: 88px;
  height: 88px;
  display: grid;
  place-items: center;
}

.ob-ready-ring {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 2px solid transparent;
  background:
    linear-gradient(135deg, #0ea5e9, #14b8a6) border-box;
  -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: destination-out;
  mask-composite: exclude;
  animation: obReadyPulse 2.5s ease-in-out infinite;
}

@keyframes obReadyPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(14, 165, 233, 0); }
  50% { box-shadow: 0 0 0 10px rgba(14, 165, 233, 0.12); }
}

.ob-ready-check {
  width: 62px;
  height: 62px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  color: white;
  box-shadow: 0 14px 28px rgba(14, 165, 233, 0.28);
}

.ob-summary-grid {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ob-summary-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 16px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 84%, transparent);
  text-align: left;
}

.ob-summary-icon {
  width: 28px;
  height: 28px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #0ea5e9;
  background: rgba(14, 165, 233, 0.1);
}

.ob-summary-item strong {
  display: block;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 3px;
}

.ob-summary-item span {
  font-size: 13px;
  color: var(--text-muted);
}

/* ── Actions / Buttons ── */
.ob-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.ob-primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-left: auto;
  padding: 13px 22px;
  border-radius: 16px;
  border: none;
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  color: white;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 16px 32px rgba(14, 165, 233, 0.22);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.ob-primary-btn.large {
  padding: 16px 28px;
  font-size: 16px;
  border-radius: 18px;
  margin-left: 0;
  width: 100%;
  max-width: 360px;
  align-self: center;
}

.ob-primary-btn:hover { transform: translateY(-1px); box-shadow: 0 20px 40px rgba(14, 165, 233, 0.30); }
.ob-primary-btn:disabled, .ob-primary-btn.disabled { opacity: 0.46; cursor: not-allowed; transform: none; box-shadow: none; }

.ob-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.15s;
}

.ob-back-btn:hover { color: var(--text-main); }

.ob-skip-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color 0.15s;
}

.ob-skip-btn:hover { color: var(--text-main); }

/* ── Transitions ── */
.ob-slide-enter-active, .ob-slide-leave-active { transition: all 0.32s cubic-bezier(0.22, 1, 0.36, 1); }
.ob-slide-enter-from { opacity: 0; transform: translateX(28px); }
.ob-slide-leave-to { opacity: 0; transform: translateX(-28px); }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 680px) {
  .ob-goal-grid,
  .ob-tracking-grid { grid-template-columns: 1fr; }
  .ob-root {
    justify-content: flex-start;
    padding: 24px 18px 36px;
  }
  .ob-shell { width: 100%; margin: 0; }
  .ob-title { font-size: 34px; }
  .ob-step-title { font-size: 26px; }
}
</style>
