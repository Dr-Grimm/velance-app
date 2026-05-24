<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth.js'
import { useVelanceStore } from '../store/velance.js'
import { useActivityTracker } from '../composables/useActivityTracker.js'
import { useAmbientTracker } from '../composables/useAmbientTracker.js'
import {
  ArrowLeftIcon,
  CheckIcon,
  LoaderCircleIcon,
  LogOutIcon,
  SaveIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const velance = useVelanceStore()
const tracker = useActivityTracker()
const ambientTracker = useAmbientTracker()

const FOCUS_GOALS = [
  { id: 'flow', label: 'Stay in flow longer' },
  { id: 'ship', label: 'Ship things that matter' },
  { id: 'mornings', label: 'Own my mornings' },
  { id: 'think', label: 'Think without interruption' },
  { id: 'habit', label: 'Build one habit at a time' },
  { id: 'creative', label: 'Protect creative time' },
  { id: 'balance', label: 'Work hard, recover smart' },
  { id: 'signal', label: 'Cut the noise, keep the signal' },
]

/* State */
const editUsername = ref('')
const editRole = ref('')
const editGoal = ref('')
const goalLabel = computed(() => {
  if (!editGoal.value) return 'No goal set'
  return FOCUS_GOALS.find(g => g.id === editGoal.value)?.label || editGoal.value
})
const workStart = ref('09:00')
const workEnd = ref('17:00')

const avatarUploading = ref(false)
const avatarError = ref('')
const saveOk = ref(false)
const savingProfile = ref(false)
const linkingGoogle = ref(false)
const linkError = ref('')
const showDangerConfirm = ref('')  // '' | 'clear' | 'logout'

const fileInput = ref(null)

/* Computed */
const userMeta = computed(() => authStore.user?.user_metadata || {})
const authProviders = computed(() => authStore.user?.identities?.map(i => i.provider) || [])
const hasEmailProvider = computed(() => authProviders.value.includes('email') || !!authStore.user?.email)
const hasGoogleProvider = computed(() => authProviders.value.includes('google'))

const displayName = computed(() =>
  userMeta.value.username || userMeta.value.full_name || userMeta.value.name ||
  authStore.user?.email?.split('@')[0] || velance.userProfile.name || 'User'
)

const avatarUrl = computed(() =>
  userMeta.value.avatar_url || userMeta.value.picture || velance.userProfile.avatar || null
)

const initials = computed(() => {
  const parts = String(displayName.value || 'U').trim().split(/\s+/).filter(Boolean)
  return (parts.slice(0, 2).map(p => p[0]).join('') || 'U').toUpperCase()
})

const sessionCount = computed(() =>
  (velance.sessions || []).filter(s => {
    const d = new Date(s.startTime || s.start || s.ts || 0)
    return d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear()
  }).length
)

const tasksDone = computed(() =>
  (velance.tasks || []).filter(t => t.status === 'completed').length
)

const habitsCount = computed(() => (velance.habits || []).length)

const daysActive = computed(() => {
  const dates = new Set()
  ;(velance.sessions || []).forEach(s => {
    const d = new Date(s.startTime || s.start || s.ts || 0)
    if (!isNaN(d)) dates.add(d.toLocaleDateString())
  })
  return dates.size
})

const isValid = computed(() => editUsername.value.trim().length > 0)

/* Sync form from store/auth */
function syncForm() {
  editUsername.value = displayName.value
  // Do not show the factory default role as if the user set it.
  const storedRole = velance.userProfile.role || ''
  editRole.value = (storedRole === 'Professional' && !velance.userProfile.setupComplete) ? '' : storedRole
  editGoal.value = userMeta.value.preferences?.goal || velance.userProfile.goal || ''
  const hours = userMeta.value.preferences?.workingHours || velance.userProfile.workingHours || '09:00-17:00'
  const [start, end] = hours.split('-')
  workStart.value = start || '09:00'
  workEnd.value = end || '17:00'
}

watch([displayName, () => velance.userProfile], syncForm, { immediate: true })

/* Save profile */
async function saveProfile() {
  if (!isValid.value || savingProfile.value) return
  savingProfile.value = true
  try {
    const combinedHours = `${workStart.value}-${workEnd.value}`
    await authStore.updateProfile({
      username: editUsername.value,
      preferences: { goal: editGoal.value, workingHours: combinedHours },
    })
    await velance.saveProfile({
      name: editUsername.value,
      role: editRole.value,
      goal: editGoal.value,
      workingHours: combinedHours,
    })
    saveOk.value = true
    setTimeout(() => { saveOk.value = false }, 2600)
  } finally {
    savingProfile.value = false
  }
}

/* Avatar */
function triggerAvatarUpload() {
  fileInput.value?.click()
}

async function handleAvatarFile(event) {
  const file = event?.target?.files?.[0]
  if (!file) return
  avatarUploading.value = true
  avatarError.value = ''
  try {
    const result = await authStore.uploadAvatar(file)
    if (!result.ok) avatarError.value = result.error || 'Upload failed'
  } finally {
    avatarUploading.value = false
    if (event.target) event.target.value = ''
  }
}

/* Connect Google */
async function connectGoogle() {
  if (linkingGoogle.value) return
  linkingGoogle.value = true
  linkError.value = ''
  try {
    const ok = await authStore.linkGoogleAccount()
    if (!ok) linkError.value = authStore.error || 'Could not link Google account.'
  } finally {
    linkingGoogle.value = false
  }
}

/* Danger zone */
async function confirmLogout() {
  if (tracker.isTracking.value) {
    const payload = tracker.stop()
    if (payload?.id && !velance.sessions.some(s => s.id === payload.id)) {
      await velance.addSession(payload)
    }
  }
  tracker.clearCompletedSession()
  ambientTracker.detachListener({ clearCache: true })
  await authStore.logout()
  await velance.hydrate({ force: true, user: null })
  await velance.syncRuntimePolicy()
  router.replace('/auth')
}

async function confirmClearData() {
  await velance.clearAllLocalData()
  showDangerConfirm.value = ''
}
</script>

<template>
  <div class="profile-module">
    <!-- Topbar -->
    <header class="profile-topbar">
      <button class="back-btn" @click="router.back()">
        <ArrowLeftIcon :size="14" /> Back
      </button>
    </header>

    <!-- Hero card -->
    <section class="hero-card">
      <!-- Avatar -->
      <div class="avatar-wrap" @click="triggerAvatarUpload" :title="'Upload photo'">
        <img v-if="avatarUrl && !avatarUploading" :src="avatarUrl" class="avatar-img" alt="Profile photo" />
        <div v-else-if="avatarUploading" class="avatar-fallback uploading">
          <LoaderCircleIcon :size="22" class="spin" />
        </div>
        <div v-else class="avatar-fallback">{{ initials }}</div>
        <div class="avatar-overlay">
          <UploadIcon :size="16" />
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style="display: none"
          @change="handleAvatarFile"
        />
      </div>

      <!-- Identity -->
      <div class="hero-identity">
        <span class="page-kicker">Profile</span>
        <h1 class="page-title">{{ displayName }}</h1>
        <p class="page-email">{{ authStore.user?.email || 'Local workspace' }}</p>
        <p v-if="avatarError" class="avatar-error">{{ avatarError }}</p>

        <div class="hero-pills">
          <span v-if="hasGoogleProvider" class="hero-pill google-pill">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
            Google
          </span>
          <span v-if="hasEmailProvider" class="hero-pill">Email OTP</span>
          <span class="hero-pill">{{ velance.backendStatus === 'supabase' ? 'Cloud sync' : 'Local only' }}</span>
        </div>
      </div>

      <!-- Top-right CTA -->
      <div class="hero-side">
        <button
          class="primary-btn"
          :disabled="savingProfile || !isValid"
          @click="saveProfile"
        >
          <LoaderCircleIcon v-if="savingProfile" :size="14" class="spin" />
          <SaveIcon v-else :size="14" />
          {{ savingProfile ? 'Saving...' : 'Save' }}
        </button>
        <transition name="fade">
          <span v-if="saveOk" class="save-ok">
            <CheckIcon :size="13" /> Saved
          </span>
        </transition>
      </div>
    </section>

    <!-- Stats strip -->
    <section class="stats-strip">
      <div class="stat-item">
        <strong>{{ sessionCount }}</strong>
        <span>Sessions this month</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <strong>{{ habitsCount }}</strong>
        <span>Habits tracked</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <strong>{{ tasksDone }}</strong>
        <span>Tasks completed</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <strong>{{ daysActive }}</strong>
        <span>Days active</span>
      </div>
    </section>

    <div class="profile-grid">
      <!-- Identity section -->
      <section class="profile-card">
        <div class="card-head">
          <span class="card-kicker">Identity</span>
          <h2>Core details</h2>
        </div>
        <label class="pf-field">
          <span>Display name</span>
          <input v-model="editUsername" class="pf-input" type="text" placeholder="Your name" />
        </label>
        <label class="pf-field">
          <span>Role</span>
          <input v-model="editRole" class="pf-input" type="text" placeholder="e.g. Developer, Designer, Student" />
        </label>
      </section>

      <!-- Working rhythm section -->
      <section class="profile-card">
        <div class="card-head">
          <span class="card-kicker">Rhythm</span>
          <h2>Working hours</h2>
        </div>
        <div class="pf-time-row">
          <label class="pf-field">
            <span>Start</span>
            <input v-model="workStart" class="pf-input center" type="time" />
          </label>
          <span class="pf-time-sep">-></span>
          <label class="pf-field">
            <span>End</span>
            <input v-model="workEnd" class="pf-input center" type="time" />
          </label>
        </div>
        <div class="pf-info-strip">
          <span>{{ workStart }} - {{ workEnd }}</span>
          <span>{{ goalLabel }}</span>
        </div>
      </section>
    </div>

    <!-- Connected accounts -->
    <section class="profile-card account-card">
      <div class="card-head">
        <span class="card-kicker">Connected accounts</span>
        <h2>Sign-in methods</h2>
      </div>

      <div class="account-methods">
        <div v-if="hasGoogleProvider" class="account-method connected">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <div>
            <strong>Google</strong>
            <span>Connected - used for sign-in and avatar</span>
          </div>
          <span class="connected-badge"><CheckIcon :size="12" /> Active</span>
        </div>

        <div v-if="hasEmailProvider" class="account-method connected">
          <span class="account-method-icon">Email</span>
          <div>
            <strong>Email OTP</strong>
            <span>{{ authStore.user?.email }}</span>
          </div>
          <span class="connected-badge"><CheckIcon :size="12" /> Active</span>
        </div>

        <div v-if="!hasGoogleProvider" class="account-method">
          <svg viewBox="0 0 24 24" width="16" height="16">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <div>
            <strong>Google</strong>
            <span>Link your Google account for faster sign-in</span>
          </div>
          <button class="link-btn" :disabled="linkingGoogle" @click="connectGoogle">
            <LoaderCircleIcon v-if="linkingGoogle" :size="13" class="spin" />
            {{ linkingGoogle ? 'Connecting...' : 'Connect' }}
          </button>
        </div>
        <p v-if="linkError" class="link-error">{{ linkError }}</p>
      </div>
    </section>

    <!-- Danger zone -->
    <section class="profile-card danger-card">
      <div class="card-head">
        <span class="card-kicker danger-kicker">Danger zone</span>
        <h2>Account actions</h2>
      </div>

      <div class="danger-rail">
        <div class="danger-item">
          <div>
            <strong>Sign out</strong>
            <span>End your session. Local data stays on this device.</span>
          </div>
          <div v-if="showDangerConfirm === 'logout'" class="danger-confirm">
            <span>Are you sure?</span>
            <button class="danger-confirm-btn" @click="confirmLogout">Yes, sign out</button>
            <button class="danger-cancel-btn" @click="showDangerConfirm = ''">Cancel</button>
          </div>
          <button v-else class="danger-action-btn logout-btn" @click="showDangerConfirm = 'logout'">
            <LogOutIcon :size="13" /> Sign out
          </button>
        </div>

        <div class="danger-separator" />

        <div class="danger-item">
          <div>
            <strong>Clear all local data</strong>
            <span>Permanently erase sessions, tasks, habits, and settings on this device. Account stays active.</span>
          </div>
          <div v-if="showDangerConfirm === 'clear'" class="danger-confirm">
            <span>This cannot be undone.</span>
            <button class="danger-confirm-btn" @click="confirmClearData">Yes, clear data</button>
            <button class="danger-cancel-btn" @click="showDangerConfirm = ''">Cancel</button>
          </div>
          <button v-else class="danger-action-btn" @click="showDangerConfirm = 'clear'">
            <TrashIcon :size="13" /> Clear data
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.profile-module {
  padding: 24px 28px 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1060px;
  margin: 0 auto;
}

/* Topbar */
.profile-topbar { display: flex; justify-content: flex-start; margin-bottom: 2px; }

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s;
}

.back-btn:hover { transform: translateY(-1px); }

/* Cards */
.hero-card,
.profile-card {
  border-radius: 24px;
  border: 1px solid var(--surface-outline);
  background: radial-gradient(circle at top right, var(--accent-glow), transparent 36%), var(--surface-strong);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(16px);
}

/* Hero card */
.hero-card {
  padding: 22px 24px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 20px;
  align-items: center;
}

/* Avatar */
.avatar-wrap {
  position: relative;
  width: 84px;
  height: 84px;
  border-radius: 26px;
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
  border: 1.5px solid var(--surface-outline-strong);
}

.avatar-img, .avatar-fallback {
  width: 100%;
  height: 100%;
}

.avatar-img { object-fit: cover; }

.avatar-fallback {
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 800;
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 8%, transparent);
}

.avatar-fallback.uploading { color: var(--text-muted); }

.avatar-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  color: white;
  opacity: 0;
  transition: opacity 0.2s;
}

.avatar-wrap:hover .avatar-overlay { opacity: 1; }

.avatar-error {
  font-size: 12px;
  color: #ef4444;
  margin-top: 4px;
}

/* Hero identity */
.hero-identity { display: flex; flex-direction: column; gap: 4px; }

.page-kicker {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--accent-base);
}

.page-title {
  font-size: clamp(1.7rem, 2.5vw, 2.4rem);
  line-height: 0.97;
  letter-spacing: -0.05em;
  margin: 3px 0;
}

.page-email { font-size: 13px; color: var(--text-muted); }

.hero-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

.hero-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}

.google-pill { color: #4285F4; border-color: rgba(66, 133, 244, 0.22); background: rgba(66, 133, 244, 0.06); }

.hero-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 16px;
  border-radius: 14px;
  border: none;
  background: var(--accent-gradient);
  color: white;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.18s ease;
}

.primary-btn:hover { transform: translateY(-1px); }
.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.save-ok {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: #22c55e;
}

/* Stats strip */
.stats-strip {
  border-radius: 20px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-strong);
  backdrop-filter: blur(16px);
  padding: 18px 24px;
  display: flex;
  align-items: center;
  gap: 0;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-item strong {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: var(--accent-base);
}

.stat-item span {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-align: center;
}

.stat-divider {
  width: 1px;
  height: 36px;
  background: var(--surface-outline);
  flex-shrink: 0;
}

/* Profile grid */
.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.profile-card {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

@media (min-width: 1280px) {
  .hero-card {
    padding: 26px 28px;
  }

  .profile-grid {
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
    gap: 18px;
  }

  .profile-card {
    padding: 22px;
  }
}

.card-head { display: flex; flex-direction: column; gap: 3px; }

.card-kicker {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--accent-base);
}

.danger-kicker { color: #ef4444; }

.card-head h2 {
  font-size: 1.15rem;
  letter-spacing: -0.03em;
}

.pf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.pf-field > span {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.pf-input {
  width: 100%;
  padding: 11px 13px;
  border-radius: 13px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  font: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.18s, box-shadow 0.18s;
}

.pf-input:focus {
  border-color: var(--accent-base);
  box-shadow: 0 0 0 3px rgba(55, 184, 214, 0.1);
}

.pf-input.center { text-align: center; }

.pf-time-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.pf-time-sep { font-size: 18px; color: var(--text-muted); padding-bottom: 10px; }

.pf-info-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 600;
}

/* Account methods */
.account-card { gap: 16px; }

.account-methods {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.account-method {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border-radius: 16px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
}

.account-method.connected {
  border-color: rgba(14, 165, 233, 0.18);
  background: rgba(14, 165, 233, 0.04);
}

.account-method > div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-method strong { font-size: 14px; font-weight: 700; }
.account-method span { font-size: 12px; color: var(--text-muted); }

.account-method-icon {
  min-width: 46px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  font-size: 11px;
  font-weight: 800;
}

.connected-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(34, 197, 94, 0.22);
  background: rgba(34, 197, 94, 0.08);
  color: #22c55e;
  font-size: 11px;
  font-weight: 700;
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.15s;
}

.link-btn:hover { transform: translateY(-1px); }
.link-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

.link-error { font-size: 12px; color: #ef4444; margin-top: 4px; }

/* Danger zone */
.danger-card { border-color: rgba(239, 68, 68, 0.12); }

.danger-rail {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.danger-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
}

.danger-item > div:first-child { flex: 1; }
.danger-item strong { display: block; font-size: 14px; font-weight: 700; margin-bottom: 3px; }
.danger-item span { font-size: 12px; color: var(--text-muted); line-height: 1.4; }

.danger-separator { width: 100%; height: 1px; background: var(--surface-outline); }

.danger-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px;
  border-radius: 12px;
  border: 1px solid rgba(239, 68, 68, 0.18);
  background: rgba(239, 68, 68, 0.06);
  color: #ef4444;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.15s, background 0.15s;
}

.danger-action-btn:hover { background: rgba(239, 68, 68, 0.12); transform: translateY(-1px); }

.logout-btn { color: var(--text-main); border-color: var(--surface-outline); background: var(--surface-muted); }
.logout-btn:hover { background: var(--surface-outline); }

.danger-confirm {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  animation: rise-in 0.2s ease;
}

.danger-confirm span { font-size: 12px; color: var(--text-muted); }

.danger-confirm-btn {
  padding: 7px 12px;
  border-radius: 10px;
  border: none;
  background: #ef4444;
  color: white;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.danger-cancel-btn {
  padding: 7px 12px;
  border-radius: 10px;
  border: 1px solid var(--surface-outline);
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

/* Animations */
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes rise-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 820px) {
  .profile-module { padding: 18px 16px 36px; }
  .hero-card { grid-template-columns: 1fr; }
  .hero-side { align-items: stretch; flex-direction: row; justify-content: flex-end; }
  .profile-grid { grid-template-columns: 1fr; }
  .stats-strip { flex-wrap: wrap; gap: 16px; }
}

/* ─── DARK THEME OVERRIDES ─────────────────────────────────────────────────── */
/* Headings and titles always correct in dark mode */
:global(.dark-theme .profile-module h1),
:global(.dark-theme .profile-module h2),
:global(.dark-theme .profile-module h3),
:global(.dark-theme .profile-module .page-title){
  color: var(--text-main) !important;
}

/* Google pill color fine for both modes; connection pill uses CSS vars — no override needed */

/* Card backgrounds */
:global(.dark-theme .profile-module .hero-card),
:global(.dark-theme .profile-module .profile-card),
:global(.dark-theme .profile-module .stats-strip){
  background: var(--bg-card) !important;
  border-color: var(--surface-outline) !important;
}
</style>
