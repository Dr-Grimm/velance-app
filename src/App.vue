<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useVelanceStore } from './store/velance.js'
import { useAuthStore } from './store/auth.js'
import { useAmbientTracker } from './composables/useAmbientTracker.js'
import { useActivityTracker } from './composables/useActivityTracker.js'
import { useTaskReminders } from './composables/useTaskReminders.js'
import { useHabitReminders } from './composables/useHabitReminders.js'
import PageCoachMarks from './components/ui/PageCoachMarks.vue'
import {
  canTrackWithSettings,
  hasResolvedTrackingConsent,
  hasTrackingConsent,
} from './services/trackingConsent.js'
import {
  applyTrackingConsentDecision,
  readTrackingConsentFallback,
  writeTrackingConsentFallback,
} from './services/trackingConsentState.js'
import { hasCompletedOnboardingState, markOnboardingDone } from './services/onboardingState.js'
import {
  LayoutDashboardIcon, CheckSquareIcon, TargetIcon,
  BarChartIcon, KanbanSquareIcon, LightbulbIcon, SettingsIcon,
  LogOutIcon, MoonIcon, SunIcon, ArrowRightIcon,
  SidebarCloseIcon, SidebarOpenIcon, HelpCircleIcon
} from 'lucide-vue-next'

const router  = useRouter()
const route   = useRoute()
const store   = useVelanceStore()
const authStore = useAuthStore()
const ambientTracker = useAmbientTracker()
const tracker = useActivityTracker()
const taskReminders = useTaskReminders()
const habitReminders = useHabitReminders()
const isDark  = ref(store.settings.isDark)
const consentSaving = ref(false)
const consentGateDismissed = ref(false)
const consentError = ref('')
const localConsentDecision = ref(null)
const sidebarCollapsed = ref(false)
const coachMarks = ref(null)

// True while we are still checking the JWT on startup
const checkingSession = ref(true)
let consentKeyHandler = null
let cloudSyncRequestHandler = null
let networkOnlineHandler = null
let themePreferenceHandler = null
let workspaceTransitionVersion = 0
const CONSENT_SAVE_TIMEOUT_MS = 4500
const CONSENT_POLICY_TIMEOUT_MS = 1800
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'velance_sidebar_collapsed'

// Sidebar avatar initials
const userInitial = computed(() => {
  const meta = authStore.user?.user_metadata || {}
  const n = meta.username || meta.full_name || meta.name || store.userProfile.name || authStore.user?.email || 'U'
  return n.charAt(0).toUpperCase()
})

const toggleTheme = async () => {
  const nextIsDark = !isDark.value
  isDark.value = nextIsDark
  store.settings.isDark = nextIsDark
  applyThemePreference(nextIsDark)
  try {
    await store.saveSettings({ sync: false, prune: false, syncRuntime: false })
  } catch (error) {
    console.warn('[Velance] Failed to save theme preference:', error)
  }
}

function restartTour() {
  coachMarks.value?.resetTour()
}

function restoreSidebarPreference() {
  if (typeof localStorage === 'undefined') return
  sidebarCollapsed.value = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(sidebarCollapsed.value))
  }
}

const logout = async () => {
  await authStore.logout()
}

const isPublicRoute = computed(() => route.meta?.public)
const consentResolved = computed(() => hasResolvedTrackingConsent(store.settings))
const trackingConsentGranted = computed(() => hasTrackingConsent(store.settings))
const effectiveConsentResolved = computed(() => consentResolved.value || Boolean(localConsentDecision.value?.resolved))
const needsConsentGate = computed(() => (
  !checkingSession.value
  && !isPublicRoute.value
  && Boolean(authStore.user?.id)
  && !effectiveConsentResolved.value
  && !consentGateDismissed.value
))
const hasCompletedFocusReview = computed(() => !!tracker.completedSession.value)
const showFocusDock = computed(() => !isPublicRoute.value && route.path !== '/focus' && (tracker.isTracking.value || hasCompletedFocusReview.value))
const focusDockMeta = computed(() => tracker.sessionMeta.value || {})
const focusDockReview = computed(() => tracker.completedSession.value || null)
const focusDockTitle = computed(() => {
  if (focusDockReview.value) {
    return focusDockReview.value.goal || focusDockReview.value.taskTitle || focusDockReview.value.habit || `${focusDockReview.value.sessionType || 'Focus'} block`
  }
  return focusDockMeta.value.goal || focusDockMeta.value.taskTitle || focusDockMeta.value.habit || `${focusDockMeta.value.sessionType || 'Focus'} block`
})
const focusDockState = computed(() => {
  if (focusDockReview.value) return 'Ready to review'
  return tracker.isPaused.value ? 'Paused' : 'Running'
})
const focusDockElapsed = computed(() => {
  const total = Math.max(0, tracker.elapsedSeconds.value || 0)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
})

function syncTrackingUser(user = authStore.user) {
  const workspaceId = store.refreshWorkspaceId(user)
  window.velance?.setTrackingUser?.(workspaceId)
}

function applyThemeFromStore() {
  isDark.value = !!store.settings.isDark
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark-theme', isDark.value)
  document.documentElement.classList.toggle('light-theme', !isDark.value)
}

function applyThemePreference(isDarkPreference) {
  isDark.value = Boolean(isDarkPreference)
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark-theme', isDark.value)
  document.documentElement.classList.toggle('light-theme', !isDark.value)
}

function hasCompletedOnboarding() {
  return hasCompletedOnboardingState({
    workspaceId: store.currentWorkspaceId,
    profile: store.userProfile,
    settings: store.settings,
    tasks: store.tasks,
    habits: store.habits,
    sessions: store.sessions,
  })
}

function getConsentWorkspaceIds(primaryWorkspaceId = store.currentWorkspaceId) {
  return [...new Set([
    primaryWorkspaceId,
    authStore.user?.id,
  ].filter(Boolean))]
}

function readConsentFallback(workspaceId = store.currentWorkspaceId) {
  const workspaceIds = getConsentWorkspaceIds(workspaceId)
  for (const id of workspaceIds) {
    const decision = readTrackingConsentFallback(id)
    if (decision?.resolved) return decision
  }
  return null
}

function writeConsentFallback(granted, at = Date.now(), workspaceId = store.currentWorkspaceId) {
  let decision = null
  getConsentWorkspaceIds(workspaceId).forEach((id) => {
    decision = writeTrackingConsentFallback({ workspaceId: id, granted, at })
  })
  localConsentDecision.value = decision
  return decision
}

function applyConsentDecisionToStore(decision = localConsentDecision.value) {
  return applyTrackingConsentDecision(store.settings, decision)
}

function restoreLocalConsentDecision() {
  const fallback = readConsentFallback()
  localConsentDecision.value = fallback
  if (!consentResolved.value && fallback?.resolved) {
    applyConsentDecisionToStore(fallback)
    store.saveSettings?.().catch((error) => {
      console.warn('[Velance] Failed to repair restored tracking consent:', error)
    })
    consentGateDismissed.value = true
    return true
  }
  return Boolean(fallback?.resolved)
}

async function reconcileOnboardingCompletion() {
  if (!hasCompletedOnboarding()) return false
  markOnboardingDone(store.currentWorkspaceId)
  if (!store.userProfile?.setupComplete) {
    await store.saveProfile({ setupComplete: true })
  }
  return true
}

async function ensureTrackingConsentDefaults() {
  if (consentResolved.value || restoreLocalConsentDecision()) return true
  await store.syncRuntimePolicy()
  ambientTracker.detachListener()
  return false
}

async function syncAmbientLifecycle({ refresh = false } = {}) {
  await store.syncRuntimePolicy()

  if (!canTrackWithSettings(store.settings)) {
    ambientTracker.detachListener()
    return
  }

  await ambientTracker.attachListener()
  if (refresh) {
    await ambientTracker.refreshToday()
  }
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

async function resolveTrackingConsent(granted) {
  if (consentSaving.value) return

  consentSaving.value = true
  consentError.value = ''
  consentGateDismissed.value = true

  try {
    const decision = writeConsentFallback(granted)
    applyConsentDecisionToStore(decision)
    if (!granted) {
      if (tracker.isTracking.value) tracker.stop({ discard: true })
      ambientTracker.detachListener()
    }

    try {
      await withTimeout(store.syncRuntimePolicy(), CONSENT_POLICY_TIMEOUT_MS, 'Runtime policy sync')
    } catch (error) {
      console.warn('[Velance] Runtime policy sync was slow after consent:', error)
    }

    const savePromise = store.saveSettings()
    savePromise.catch((error) => {
      console.warn('[Velance] Consent save finished with an error after UI was released:', error)
    })

    try {
      await withTimeout(savePromise, CONSENT_SAVE_TIMEOUT_MS, 'Consent save')
    } catch (error) {
      console.warn('[Velance] Consent save did not finish before releasing the UI:', error)
      consentError.value = 'Your choice was applied locally. Settings may finish saving in the background.'
    }

    if (granted) {
      try {
        await withTimeout(ambientTracker.attachListener(), CONSENT_POLICY_TIMEOUT_MS, 'Tracking startup')
        void ambientTracker.refreshToday()
      } catch (error) {
        console.warn('[Velance] Consent follow-up degraded gracefully:', error)
        consentError.value = 'Consent was saved, but tracking follow-up needs a refresh in Settings.'
      }
    }
  } catch (error) {
    console.error('[Velance] Failed to resolve consent:', error)
    consentError.value = 'Velance could not save your consent choice yet. Please try again.'
  } finally {
    consentSaving.value = false
  }
}

function handleConsentAction(granted) {
  void resolveTrackingConsent(granted)
}

function bindConsentKeyboardFallback() {
  if (consentKeyHandler) return

  consentKeyHandler = (event) => {
    if (!needsConsentGate.value || consentSaving.value) return
    if (event.repeat) return

    if (event.key === 'Enter') {
      event.preventDefault()
      void resolveTrackingConsent(true)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      void resolveTrackingConsent(false)
    }
  }

  window.addEventListener('keydown', consentKeyHandler)
}

function unbindConsentKeyboardFallback() {
  if (!consentKeyHandler) return
  window.removeEventListener('keydown', consentKeyHandler)
  consentKeyHandler = null
}

async function persistCompletedFocusSession(payload) {
  if (!payload?.id) return
  if (store.sessions.some((session) => session.id === payload.id)) return
  await store.addSession(payload)
}

async function flushPendingFocusForTransition() {
  if (tracker.isTracking.value) {
    const payload = tracker.stop()
    await persistCompletedFocusSession(payload)
  } else if (tracker.completedSession.value) {
    await persistCompletedFocusSession(tracker.completedSession.value)
  }
  tracker.clearCompletedSession()
}

async function syncProfileDefaultsFromAuth(user = authStore.user) {
  if (!user?.id) return
  const meta = user?.user_metadata || {}
  const authName = meta.full_name || meta.name || meta.username || user?.email?.split('@')[0] || 'User'
  const authAvatar = meta.avatar_url || meta.picture || null
  const nextProfile = {}

  if (!store.userProfile?.name || store.userProfile.name === 'User') nextProfile.name = authName
  if (!store.userProfile?.avatar && authAvatar) nextProfile.avatar = authAvatar
  if (!store.userProfile?.workingHours && meta.preferences?.workingHours) {
    nextProfile.workingHours = meta.preferences.workingHours
  }
  if (!store.userProfile?.goal && meta.preferences?.goal) {
    nextProfile.goal = meta.preferences.goal
  }

  if (Object.keys(nextProfile).length) {
    await store.saveProfile(nextProfile)
  }
}

async function transitionWorkspace(user = null) {
  const transitionId = ++workspaceTransitionVersion

  await flushPendingFocusForTransition()
  ambientTracker.detachListener({ clearCache: true })

  syncTrackingUser(user)
  await store.hydrate({ force: true, user })

  if (transitionId !== workspaceTransitionVersion) return
  restoreLocalConsentDecision()

  applyThemeFromStore()

  if (user?.id) {
    await syncProfileDefaultsFromAuth(user)
    if (transitionId !== workspaceTransitionVersion) return

    const onboardingComplete = await reconcileOnboardingCompletion()
    if (transitionId !== workspaceTransitionVersion) return

    await ensureTrackingConsentDefaults()
    if (transitionId !== workspaceTransitionVersion) return

    if (effectiveConsentResolved.value) {
      await syncAmbientLifecycle({ refresh: true })
      if (transitionId !== workspaceTransitionVersion) return
    }

    if (route.meta?.public) {
      router.replace(onboardingComplete ? '/' : '/onboarding')
    }
    return
  }

  await store.syncRuntimePolicy()
  if (transitionId !== workspaceTransitionVersion) return

  if (!route.meta?.public) {
    router.replace('/auth')
  }
}

onMounted(async () => {
  restoreSidebarPreference()

  if (!cloudSyncRequestHandler) {
    cloudSyncRequestHandler = async (event) => {
      const reason = event?.detail?.reason || 'external-request'
      store.requestCloudSync?.(reason)
      // When consent is applied from onboarding, immediately re-evaluate ambient tracking
      if (reason === 'consent-applied' && authStore.user?.id && effectiveConsentResolved.value) {
        await syncAmbientLifecycle({ refresh: true })
      }
    }
    window.addEventListener('velance:cloud-sync-request', cloudSyncRequestHandler)
  }

  if (!networkOnlineHandler) {
    networkOnlineHandler = () => {
      if (authStore.user?.id) {
        store.requestCloudSync?.('online-retry')
      }
    }
    window.addEventListener('online', networkOnlineHandler)
  }

  if (!themePreferenceHandler) {
    themePreferenceHandler = (event) => {
      applyThemePreference(Boolean(event?.detail?.isDark))
    }
    window.addEventListener('velance:theme-change', themePreferenceHandler)
  }

  const valid = await authStore.checkSession()
  await transitionWorkspace(valid ? authStore.user : null)
  taskReminders.startTaskReminderWatcher()
  habitReminders.startHabitReminderWatcher()
  checkingSession.value = false
})

onBeforeUnmount(() => {
  taskReminders.stopTaskReminderWatcher()
  habitReminders.stopHabitReminderWatcher()
  unbindConsentKeyboardFallback()
  if (cloudSyncRequestHandler) {
    window.removeEventListener('velance:cloud-sync-request', cloudSyncRequestHandler)
    cloudSyncRequestHandler = null
  }
  if (networkOnlineHandler) {
    window.removeEventListener('online', networkOnlineHandler)
    networkOnlineHandler = null
  }
  if (themePreferenceHandler) {
    window.removeEventListener('velance:theme-change', themePreferenceHandler)
    themePreferenceHandler = null
  }
})

watch(
  () => authStore.user?.id || null,
  async (nextUserId, prevUserId) => {
    if (checkingSession.value || nextUserId === prevUserId) return

    if (nextUserId) {
      await transitionWorkspace(authStore.user)
      return
    }

    await transitionWorkspace(null)
  }
)

watch(
  () => store.settings.isDark,
  () => {
    applyThemeFromStore()
  },
  { immediate: true },
)

watch(
  () => [store.currentWorkspaceId, consentResolved.value, localConsentDecision.value?.resolved],
  ([, resolved]) => {
    if (!resolved && !localConsentDecision.value?.resolved) consentGateDismissed.value = false
  },
  { immediate: true },
)

watch(
  needsConsentGate,
  (active) => {
    if (active) bindConsentKeyboardFallback()
    else unbindConsentKeyboardFallback()
  },
  { immediate: true },
)

watch(
  () => tracker.completedSession.value,
  async (payload) => {
    if (!payload || isPublicRoute.value) return
    await persistCompletedFocusSession(payload)
  }
)

watch(
  () => [store.settings.trackingEnabled, store.settings.trackingConsentGranted, store.settings.trackingConsentVersion, store.settings.trackingConsentAt],
  async () => {
    if (checkingSession.value || isPublicRoute.value || !authStore.user || !effectiveConsentResolved.value) return
    await syncAmbientLifecycle()
  }
)

// When navigating away from a public route (e.g. /onboarding → /),
// re-evaluate ambient tracking only if the user actually completed onboarding.
watch(
  () => route.meta?.public,
  async (isPublic, wasPublic) => {
    if (isPublic || !wasPublic) return  // Only care about leaving a public route
    if (checkingSession.value || !authStore.user?.id || !effectiveConsentResolved.value) return
    await syncAmbientLifecycle({ refresh: true })
  }
)
</script>

<template>
  <div class="velance-app" :class="{ 'dark-theme': isDark, 'light-theme': !isDark }">
    <div v-if="checkingSession" class="startup-screen">
      <div class="startup-card">
        <div class="startup-mark">
          <img :src="isDark ? '/logo-white.png' : '/logo-black.png'" class="startup-logo-img" alt="Velance" />
        </div>
        <h2>Loading Velance</h2>
        <p>Restoring your session, workspace, and local tracking context.</p>
      </div>
    </div>

    <!-- FULL-SCREEN routes (Auth, etc.) — no sidebar -->
    <router-view v-else-if="isPublicRoute" />

    <div v-else-if="needsConsentGate" class="consent-screen">
      <div class="consent-card">
        <div class="startup-mark consent-mark">
          <img :src="isDark ? '/logo-white.png' : '/logo-black.png'" class="startup-logo-img" alt="Velance" />
        </div>
        <span class="consent-kicker">Local-first privacy</span>
        <h2>Choose how Velance tracks on this device</h2>
        <p>
          Velance keeps telemetry on this PC by default. No ambient or focus tracking starts until you make a choice here, and you can change it later in Settings.
        </p>
        <div class="consent-points">
          <div class="consent-point">Raw activity stays local on-device.</div>
          <div class="consent-point">Online AI features only use summarized context.</div>
          <div class="consent-point">Declining still lets you use tasks, habits, and planning features.</div>
        </div>
        <div class="consent-actions">
          <button
            type="button"
            class="primary-btn consent-btn"
            :disabled="consentSaving"
            @pointerdown.prevent.stop="handleConsentAction(true)"
            @click.prevent.stop="handleConsentAction(true)"
          >
            {{ consentSaving ? 'Saving...' : 'Allow Local Tracking' }}
          </button>
          <button
            type="button"
            class="consent-decline"
            :disabled="consentSaving"
            @pointerdown.prevent.stop="handleConsentAction(false)"
            @click.prevent.stop="handleConsentAction(false)"
          >
            Continue Without Tracking
          </button>
        </div>
        <p class="consent-shortcut">Press Enter to allow tracking, or Esc to continue without tracking.</p>
        <p v-if="consentError" class="consent-error">{{ consentError }}</p>
      </div>
    </div>

    <!-- MAIN APPLICATION SHELL — protected routes with sidebar -->
    <div v-else class="app-layout" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
        <!-- Sidebar Navigation -->
        <aside class="sidebar glass-panel">
          <div class="sidebar-brand">
            <div class="brand-logo-box">
              <img :src="isDark ? '/logo-white.png' : '/logo-black.png'" class="brand-logo-img" alt="Velance" />
            </div>
            <h3>Velance</h3>
            <button
              type="button"
              class="sidebar-toggle"
              :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
              :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
              @click="toggleSidebar"
            >
              <SidebarOpenIcon v-if="sidebarCollapsed" class="icon" />
              <SidebarCloseIcon v-else class="icon" />
            </button>
          </div>

          <nav class="nav-menu">
            <router-link to="/" class="nav-item" title="Dashboard">
              <LayoutDashboardIcon class="icon" />
              <span class="nav-label">Dashboard</span>
            </router-link>
            <router-link to="/tasks" class="nav-item" title="Tasks">
              <CheckSquareIcon class="icon" />
              <span class="nav-label">Tasks</span>
            </router-link>
            <router-link to="/focus" class="nav-item" title="Focus">
              <TargetIcon class="icon" />
              <span class="nav-label">Focus</span>
            </router-link>
            <router-link to="/analytics" class="nav-item" title="Analytics">
              <BarChartIcon class="icon" />
              <span class="nav-label">Analytics</span>
            </router-link>
            <router-link to="/habits" class="nav-item" title="Habits">
              <KanbanSquareIcon class="icon" />
              <span class="nav-label">Habits</span>
            </router-link>
            <router-link to="/insights" class="nav-item" title="Insights">
              <LightbulbIcon class="icon" />
              <span class="nav-label">Insights</span>
            </router-link>
            <router-link to="/settings" class="nav-item" title="Settings">
              <SettingsIcon class="icon" />
              <span class="nav-label">Settings</span>
            </router-link>
          </nav>

          <div class="sidebar-footer">
            <button class="theme-toggle" @click="restartTour" title="Replay page guide">
              <HelpCircleIcon class="icon" />
            </button>
            <button class="theme-toggle" @click="toggleTheme" title="Toggle Theme">
              <SunIcon v-if="isDark" class="icon" />
              <MoonIcon v-else class="icon" />
            </button>
            <button class="theme-toggle logout-btn" @click="logout" title="Sign Out">
              <LogOutIcon class="icon" />
            </button>
            <button class="user-profile" @click="router.push('/profile')" title="My Profile">
              <img v-if="authStore.user?.user_metadata?.avatar_url || store.userProfile?.avatar" :src="authStore.user?.user_metadata?.avatar_url || store.userProfile?.avatar" class="user-avatar-img" />
              <div v-else class="user-avatar">{{ userInitial }}</div>
            </button>
          </div>
        </aside>

        <!-- Main Content Viewport -->
        <main class="content-viewport">
          <button v-if="showFocusDock" class="focus-dock" @click="router.push('/focus')">
            <div class="focus-dock-copy">
              <span class="focus-dock-label">{{ focusDockState }}</span>
              <strong>{{ focusDockTitle }}</strong>
            </div>
            <div class="focus-dock-meta">
              <span>{{ focusDockReview ? 'Open review' : (tracker.elapsedSeconds.value ? `${focusDockElapsed} tracked` : 'Session active') }}</span>
              <ArrowRightIcon class="icon" />
            </div>
          </button>

          <router-view v-slot="{ Component }">
            <transition name="route-soft" mode="out-in">
              <div class="route-shell" :key="route.path">
                <component :is="Component" />
              </div>
            </transition>
          </router-view>
          <PageCoachMarks ref="coachMarks" :disabled="needsConsentGate" />
        </main>
      </div>
  </div>
</template>

<style>
/* CORE DESIGN SYSTEM VARIABLES - INJECTED VIA CLASS FOR THEME TOGGLE */
.dark-theme {
  --bg-app: #0b1016;
  --bg-card: #121923;
  --bg-card-hover: #18212d;
  --surface-soft: rgba(18, 25, 35, 0.78);
  --surface-strong: rgba(18, 25, 35, 0.94);
  --surface-muted: rgba(255, 255, 255, 0.035);
  --surface-outline: rgba(255, 255, 255, 0.08);
  --surface-outline-strong: rgba(59, 183, 216, 0.22);
  --text-main: #f2f6fb;
  --text-soft: #c7d0dc;
  --text-muted: #8a96a8;
  --border-light: rgba(255, 255, 255, 0.06);
  --shadow-elevation: 0 18px 44px rgba(0, 0, 0, 0.42);
  --accent-base: #37b8d6;
  --accent-strong: #0ea5e9;
  --accent-mint: #64d3bd;
  --accent-glow: rgba(55, 184, 214, 0.18);
  --accent-gradient: linear-gradient(135deg, #1aa8d4, #62d1be);
  --accent-soft: rgba(55, 184, 214, 0.12);
}

.light-theme {
  --bg-app: #f3f6fa;
  --bg-card: #ffffff;
  --bg-card-hover: #f8fafc;
  --surface-soft: rgba(255, 255, 255, 0.82);
  --surface-strong: rgba(255, 255, 255, 0.94);
  --surface-muted: rgba(15, 23, 42, 0.035);
  --surface-outline: rgba(15, 23, 42, 0.06);
  --surface-outline-strong: rgba(55, 184, 214, 0.22);
  --text-main: #121923;
  --text-soft: #2f3b4b;
  --text-muted: #64748b;
  --border-light: rgba(0, 0, 0, 0.05);
  --shadow-elevation: 0 18px 44px rgba(18, 25, 35, 0.08);
  --accent-base: #12add2;
  --accent-strong: #0ea5e9;
  --accent-mint: #52b788;
  --accent-glow: rgba(18, 173, 210, 0.14);
  --accent-gradient: linear-gradient(135deg, #18abd3, #57c3ab);
  --accent-soft: rgba(18, 173, 210, 0.09);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
}

body, html { width: 100%; height: 100%; overflow: hidden; background: var(--bg-app); color: var(--text-main); }

.velance-app {
  width: 100vw; height: 100vh;
  background: var(--bg-app);
  color: var(--text-main);
  transition: background 0.3s ease, color 0.3s ease;
}

.startup-screen {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at top, rgba(0, 180, 216, 0.12), transparent 40%), var(--bg-app);
}

.startup-card {
  width: min(420px, calc(100vw - 48px));
  padding: 32px;
  border-radius: 24px;
  background: var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: var(--shadow-elevation);
  text-align: center;
  backdrop-filter: blur(18px);
}

.startup-mark {
  position: relative;
  width: 96px;
  height: 96px;
  margin: 0 auto 20px;
  display: grid;
  place-items: center;
}

/* Outer arc — slow clockwise */
.startup-mark::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid transparent;
  border-top-color: #0ea5e9;
  border-right-color: rgba(14, 165, 233, 0.35);
  animation: startupSpin 2.2s linear infinite;
}

/* Inner arc — faster counter-clockwise */
.startup-mark::after {
  content: '';
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-bottom-color: #14b8a6;
  border-left-color: rgba(20, 184, 166, 0.35);
  animation: startupSpin 1.3s linear infinite reverse;
}


.startup-card h2 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.04em;
  margin-bottom: 8px;
}

.startup-card p {
  color: var(--text-muted);
  font-size: 14px;
}

.consent-screen {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(ellipse 44% 38% at 12% 10%, rgba(14, 165, 233, 0.16), transparent 68%),
    radial-gradient(ellipse 40% 36% at 86% 12%, rgba(99, 102, 241, 0.12), transparent 70%),
    radial-gradient(ellipse 42% 34% at 82% 88%, rgba(20, 184, 166, 0.16), transparent 70%),
    linear-gradient(135deg, #eef9ff 0%, #f8f5ff 48%, #e9fbf7 100%);
}

.consent-card {
  width: min(560px, 100%);
  position: relative;
  z-index: 1;
  padding: 32px;
  border-radius: 28px;
  background: var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(18px);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.consent-mark {
  margin: 0;
}

.consent-kicker {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent-base);
}

.consent-card h2 {
  font-size: 28px;
  line-height: 1.02;
  letter-spacing: -0.04em;
}

.consent-card p {
  color: var(--text-muted);
  line-height: 1.65;
}

.consent-points {
  display: grid;
  gap: 10px;
}

.consent-point {
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  color: var(--text-soft);
  font-size: 13px;
  font-weight: 600;
}

.consent-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.consent-btn {
  width: 100%;
}

.consent-decline {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background: transparent;
  color: var(--text-main);
  font-weight: 700;
  cursor: pointer;
}

.consent-error {
  margin-top: 10px;
  font-size: 12px;
  color: #d14343;
  text-align: center;
}

.consent-shortcut {
  margin-top: 4px;
  font-size: 12px;
  text-align: center;
  color: var(--text-muted);
}

@keyframes startupSpin {
  to { transform: rotate(360deg); }
}

@keyframes logoPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.82; transform: scale(0.93); }
}

/* ONBOARDING SCREEN */
.onboarding-screen { display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; }
.onboarding-content { max-width: 600px; display: flex; flex-direction: column; align-items: center; gap: 32px; animation: slideUpFade 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
.logo-glow.large { width: 96px; height: 96px; margin: 0 auto; }
.logo-box.hero-logo { font-size: 40px; }
.hero-title { font-size: 48px; font-weight: 800; letter-spacing: -1.5px; }
.hero-subtitle { font-size: 18px; color: var(--text-muted); line-height: 1.6; }

.features-row { display: flex; gap: 32px; justify-content: center; margin-bottom: 16px; }
.feature { display: flex; flex-direction: column; align-items: center; gap: 12px; font-weight: 600; font-size: 14px; }
.feature .text-blue { color: #00B4D8; } .feature .text-purple { color: #9B51E0; } .feature .text-green { color: #52B788; }

.hero-btn { padding: 18px 36px; font-size: 18px; border-radius: 16px; margin-top: 16px; }

.ob-step { display: flex; flex-direction: column; align-items: center; gap: 24px; animation: slideUpFade 0.5s cubic-bezier(0.16,1,0.3,1); }
.ob-privacy { font-size: 12px; color: var(--text-muted); }

/* Onboarding Step 2 */
.ob-profile { max-width: 520px; text-align: left; align-items: flex-start; }
.ob-eyebrow { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #00B4D8; margin-bottom: -16px; }
.ob-profile-title { font-size: 30px; font-weight: 800; letter-spacing: -0.5px; }
.ob-profile-sub { font-size: 14px; color: var(--text-muted); margin-top: -12px; }

.ob-card {
  width: 100%; background: var(--bg-card); border: 1px solid var(--border-light);
  border-radius: 20px; padding: 28px; display: flex; flex-direction: column; gap: 24px;
}
.ob-field { display: flex; flex-direction: column; gap: 10px; }
.ob-label { font-size: 13px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.ob-required { color: #EF4444; }
.ob-input {
  background: var(--bg-app); border: 1.5px solid var(--border-light);
  border-radius: 10px; padding: 12px 16px; font-size: 15px; font-weight: 500;
  color: var(--text-main); outline: none; transition: border-color 0.2s;
}
.ob-input:focus { border-color: #00B4D8; }
.ob-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.ob-pill {
  padding: 7px 14px; border-radius: 20px; border: 1.5px solid var(--border-light);
  background: transparent; color: var(--text-muted); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.ob-pill:hover { border-color: #00B4D8; color: #00B4D8; background: rgba(0,180,216,0.06); }
.ob-pill.active { border-color: #00B4D8; background: rgba(0,180,216,0.12); color: #00B4D8; }

.ob-actions { display: flex; align-items: center; gap: 12px; width: 100%; }
.ob-back-btn { background: none; border: none; color: var(--text-muted); font-size: 14px; font-weight: 600; cursor: pointer; padding: 0 4px; transition: color 0.2s; }
.ob-back-btn:hover { color: var(--text-main); }
.primary-btn.disabled { opacity: 0.4; cursor: not-allowed; }
.ob-error { font-size: 12px; color: #EF4444; margin-top: -12px; }


/* AUTHENTICATION SCREEN */
.auth-screen { display: flex; align-items: center; justify-content: center; height: 100%; }
.auth-card {
  width: 100%; max-width: 440px; padding: 48px 40px;
  display: flex; flex-direction: column; gap: 32px;
  background: var(--bg-card); border-radius: 24px;
  box-shadow: var(--shadow-elevation); border: 1px solid var(--border-light);
}

.brand-header { text-align: center; }
.logo-glow { position: relative; width: 64px; height: 64px; margin: 0 auto 24px; }
.logo-glow::before {
  content: ''; position: absolute; inset: -10px; border-radius: 50%;
  background: var(--accent-gradient); filter: blur(20px); opacity: 0.5;
}
.logo-box {
  position: relative; width: 100%; height: 100%; background: var(--bg-card);
  border-radius: 16px; border: 1px solid var(--border-light); display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: 800; background-clip: padding-box;
}

.brand-header h2 { font-size: 24px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.5px; }
.brand-header p { font-size: 14px; color: var(--text-muted); }

.auth-methods { display: flex; flex-direction: column; gap: 16px; }
.oauth-btn {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  width: 100%; padding: 14px; border-radius: 12px; border: 1px solid var(--border-light);
  background: var(--bg-card-hover); color: var(--text-main); font-weight: 600; cursor: pointer; transition: all 0.2s;
}
.oauth-btn:hover { border-color: var(--text-muted); transform: translateY(-1px); }

.divider { display: flex; align-items: center; text-align: center; color: var(--text-muted); font-size: 12px; margin: 8px 0; }
.divider::before, .divider::after { content: ''; flex: 1; border-bottom: 1px solid var(--border-light); }
.divider span { padding: 0 12px; }

.input-group { display: flex; flex-direction: column; gap: 12px; }
.input-group input {
  width: 100%; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--border-light);
  background: transparent; color: var(--text-main); outline: none; transition: border-color 0.2s;
}
.input-group input:focus { border-color: var(--accent-base); }

.checkbox-wrapper { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-muted); cursor: pointer; }
.primary-btn {
  background: var(--accent-gradient); color: white; border: none; padding: 14px;
  border-radius: 12px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 24px var(--accent-glow);
  transition: transform 0.2s, box-shadow 0.2s; margin-top: 8px;
}
.primary-btn:hover { transform: translateY(-2px); box-shadow: 0 12px 32px var(--accent-glow); }

.privacy-note { text-align: center; font-size: 12px; color: var(--text-muted); margin-top: 16px; }

/* MAIN APPLICATION LAYOUT */
.app-layout {
  --sidebar-width: 236px;
  --sidebar-collapsed-width: 76px;
  display: flex;
  height: 100%;
  min-width: 0;
}

.sidebar {
  width: var(--sidebar-width);
  flex: 0 0 var(--sidebar-width);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-card) 92%, transparent), color-mix(in srgb, var(--bg-card) 98%, transparent)),
    radial-gradient(circle at top, var(--accent-glow), transparent 34%);
  display: flex;
  flex-direction: column;
  padding: 24px 16px 18px;
  border-right: 1px solid var(--surface-outline);
  z-index: 10;
  backdrop-filter: blur(20px);
  overflow: hidden;
  transition: width 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    flex-basis 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    padding 0.24s ease;
}

.app-layout.sidebar-collapsed .sidebar {
  width: var(--sidebar-collapsed-width);
  flex-basis: var(--sidebar-collapsed-width);
  padding: 22px 10px 16px;
  align-items: center;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 30px;
  padding: 0 8px;
  width: 100%;
  min-height: 38px;
  transition: gap 0.2s ease, padding 0.2s ease;
}

.logo-box.mini {
  width: 34px;
  height: 34px;
  font-size: 15px;
  border-radius: 10px;
  border: 1px solid var(--surface-outline);
  background: transparent;
}

.logo-img.mini {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--surface-outline);
  object-fit: cover;
  display: block;
  flex-shrink: 0;
}

.brand-logo-box {
  width: 46px;
  height: 46px;
  border-radius: 13px;
  border: 1px solid var(--surface-outline);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 6px;
  box-sizing: border-box;
}

.brand-logo-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.startup-logo-img {
  width: 62px;
  height: 62px;
  object-fit: contain;
  border-radius: 14px;
  animation: logoPulse 2.2s ease-in-out infinite;
  z-index: 1;
}

.sidebar-brand h3 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
  white-space: nowrap;
  overflow: hidden;
  transition: opacity 0.18s ease, transform 0.18s ease, width 0.18s ease;
}

.sidebar-toggle {
  margin-left: auto;
  width: 32px;
  height: 32px;
  border-radius: 11px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-muted) 80%, transparent);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

.sidebar-toggle:hover {
  transform: translateY(-1px);
  color: var(--text-main);
  border-color: var(--surface-outline-strong);
  background: color-mix(in srgb, var(--accent-base) 8%, var(--surface-muted));
}

.sidebar-toggle .icon {
  width: 16px;
  height: 16px;
}

.app-layout.sidebar-collapsed .sidebar-brand {
  flex-direction: column;
  justify-content: center;
  gap: 9px;
  padding: 0;
  margin-bottom: 24px;
}

.app-layout.sidebar-collapsed .sidebar-brand h3 {
  width: 0;
  opacity: 0;
  transform: translateX(-8px);
}

.app-layout.sidebar-collapsed .sidebar-toggle {
  margin-left: 0;
}

.nav-menu { flex: 1; display: flex; flex-direction: column; gap: 6px; }
.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 600;
  font-size: 13px;
  min-height: 42px;
  overflow: hidden;
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  border: 1px solid transparent;
}

.nav-item .icon {
  width: 17px;
  height: 17px;
  stroke-width: 1.9px;
  flex: 0 0 17px;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), filter 0.22s ease, stroke-width 0.22s ease;
}

.nav-label {
  white-space: nowrap;
  overflow: hidden;
  transition: opacity 0.18s ease, transform 0.18s ease, width 0.18s ease;
}

.nav-item:hover {
  background: color-mix(in srgb, var(--accent-base) 6%, transparent);
  border-color: color-mix(in srgb, var(--accent-base) 12%, transparent);
  color: var(--text-main);
}

.nav-item:hover .icon {
  transform: translateY(-1px) scale(1.06);
}

.nav-item:active {
  transform: scale(0.985);
}

.nav-item.router-link-active {
  background: color-mix(in srgb, var(--accent-base) 9%, transparent);
  border-color: color-mix(in srgb, var(--accent-base) 16%, transparent);
  color: var(--accent-base);
  font-weight: 700;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-base) 4%, transparent);
}

.nav-item.router-link-active .icon {
  stroke-width: 2.25px;
  filter: drop-shadow(0 0 10px var(--accent-glow));
  animation: navIconSettle 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}

.nav-item.router-link-active::before {
  content: '';
  position: absolute;
  left: 6px;
  width: 3px;
  height: 18px;
  border-radius: 999px;
  background: var(--accent-base);
  box-shadow: 0 0 18px var(--accent-glow);
}

.app-layout.sidebar-collapsed .nav-menu {
  width: 100%;
  align-items: center;
}

.app-layout.sidebar-collapsed .nav-item {
  width: 46px;
  justify-content: center;
  gap: 0;
  padding-inline: 0;
}

.app-layout.sidebar-collapsed .nav-label {
  width: 0;
  opacity: 0;
  transform: translateX(-8px);
}

.app-layout.sidebar-collapsed .nav-item.router-link-active::before {
  left: 2px;
}

.sidebar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 18px;
  border-top: 1px solid var(--surface-outline);
  width: 100%;
}

.app-layout.sidebar-collapsed .sidebar-footer {
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.theme-toggle {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 8px;
  border-radius: 12px;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
  display: flex;
}

.theme-toggle:hover {
  background: transparent;
  border-color: transparent;
  color: var(--text-main);
}

.logout-btn:hover { color: #EF4444; background: transparent; }
.user-profile { 
  margin-left: auto; 
  background: transparent; 
  border: 1px solid transparent; 
  cursor: pointer; 
  padding: 2px; 
  border-radius: 12px; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  transition: background 0.2s; 
}

.user-profile:hover {
  background: transparent;
  border-color: transparent;
}

.app-layout.sidebar-collapsed .user-profile {
  margin-left: 0;
}

.user-profile img {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  object-fit: cover;
  border: none;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--surface-outline);
  background: transparent;
  color: var(--text-main);
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.content-viewport {
  --app-page-max: 1440px;
  --app-page-padding-x: clamp(18px, 2.4vw, 34px);
  --app-page-padding-y: clamp(22px, 2.8vw, 34px);
  flex: 1;
  position: relative;
  overflow-y: auto;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--accent-base) 10%, transparent), transparent 28%),
    radial-gradient(circle at bottom left, color-mix(in srgb, var(--accent-mint) 9%, transparent), transparent 26%),
    var(--bg-app);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.route-shell {
  flex: 1;
  min-height: 100%;
  width: 100%;
}

.route-shell > :is(
  .dashboard-module,
  .tasks-module,
  .analytics-page,
  .habits-module,
  .insights-module,
  .settings-module,
  .profile-module,
  .focus-v2
) {
  width: min(100%, var(--app-page-max));
  max-width: var(--app-page-max) !important;
  margin-inline: auto !important;
  padding: var(--app-page-padding-y) var(--app-page-padding-x) 42px !important;
}

.route-shell > .focus-v2 {
  overflow: visible !important;
  background: transparent !important;
}

.route-soft-enter-active,
.route-soft-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.route-soft-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.route-soft-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@keyframes navIconSettle {
  0% { transform: scale(0.86); }
  58% { transform: scale(1.12); }
  100% { transform: scale(1); }
}
.focus-dock {
  position: sticky;
  top: 18px;
  z-index: 30;
  width: min(520px, calc(100% - 32px));
  margin: 18px auto 0;
  padding: 12px 16px;
  border-radius: 18px;
  border: 1px solid var(--surface-outline-strong);
  background: color-mix(in srgb, var(--surface-strong) 90%, var(--accent-base) 10%);
  box-shadow: var(--shadow-elevation);
  color: var(--text-main);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  cursor: pointer;
}
.focus-dock-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
}
.focus-dock-copy strong {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.focus-dock-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-base);
}
.focus-dock-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
}

@media (max-width: 900px) {
  .app-layout {
    --sidebar-width: 210px;
  }

  .content-viewport {
    --app-page-padding-x: clamp(18px, 3vw, 26px);
    --app-page-padding-y: 28px;
  }

  .sidebar-brand h3 {
    font-size: 16px;
  }
}

@media (max-width: 720px) {
  .app-layout {
    --sidebar-width: 76px;
  }

  .sidebar {
    padding: 22px 10px 16px;
    align-items: center;
  }

  .sidebar-brand {
    flex-direction: column;
    justify-content: center;
    gap: 9px;
    padding: 0;
    margin-bottom: 24px;
  }

  .sidebar-brand h3,
  .nav-label {
    display: none;
  }

  .sidebar-toggle {
    margin-left: 0;
  }

  .nav-menu {
    width: 100%;
    align-items: center;
  }

  .nav-item {
    width: 46px;
    justify-content: center;
    gap: 0;
    padding-inline: 0;
  }

  .nav-item.router-link-active::before {
    left: 2px;
  }

  .sidebar-footer {
    flex-direction: column;
    justify-content: center;
    gap: 10px;
  }

  .user-profile {
    margin-left: 0;
  }

  .content-viewport {
    --app-page-padding-x: 16px;
    --app-page-padding-y: 22px;
  }
}

/* Standard Transitions */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ─── GLOBAL DARK-THEME HEADING & TEXT SAFETY NET ─────────────────────────────
   Explicitly set text colors for page-level headings so scoped-CSS specificity
   fights can never let an inherited or stale color bleed through in dark mode.
   !important used to guarantee this wins over any component-scoped CSS.
──────────────────────────────────────────────────────────────────────────────── */
.dark-theme .page-title,
.dark-theme .hero-title,
.dark-theme .dashboard-module h1,
.dark-theme .dashboard-module h2,
.dark-theme .dashboard-module h3,
.dark-theme .tasks-module h1,
.dark-theme .tasks-module h2,
.dark-theme .tasks-module h3,
.dark-theme .insights-module h1,
.dark-theme .insights-module h2,
.dark-theme .insights-module h3,
.dark-theme .settings-module h1,
.dark-theme .settings-module h2,
.dark-theme .settings-module h3,
.dark-theme .profile-module h1,
.dark-theme .profile-module h2,
.dark-theme .profile-module h3,
.dark-theme .habits-module h1,
.dark-theme .habits-module h2,
.dark-theme .habits-module h3,
.dark-theme .analytics-page h1,
.dark-theme .analytics-page h2,
.dark-theme .analytics-page h3,
.dark-theme .activity-page h1,
.dark-theme .activity-page h2,
.dark-theme .activity-page h3,
.dark-theme .screen-time-module h1,
.dark-theme .screen-time-module h2,
.dark-theme .screen-time-module h3 {
  color: var(--text-main) !important;
}

/* Sidebar brand & logo text */
.dark-theme .sidebar-brand h3,
.dark-theme .logo-box {
  color: var(--text-main) !important;
}

/* Nav items text */
.dark-theme .nav-label {
  color: var(--text-soft) !important;
}

/* Page-level hero text elements that inherit wrong colors */
.dark-theme .hero-copy h1,
.dark-theme .hero-copy h2,
.dark-theme .hero-copy h3,
.dark-theme .hero-main h1,
.dark-theme .hero-main h2,
.dark-theme .hero-main h3,
.dark-theme .hero-head h1,
.dark-theme .hero-head h2,
.dark-theme .hero-head h3 {
  color: var(--text-main) !important;
}

/* Dashboard ::before shimmer — keep subtle on dark */
.dark-theme .daily-challenge-banner::before {
  background: linear-gradient(115deg, transparent 16%, rgba(148, 163, 184, 0.06) 48%, transparent 78%) !important;
}

/* Light theme should also be explicit for headings */
.light-theme .page-title,
.light-theme .hero-title {
  color: var(--text-main) !important;
}

</style>
