<script setup>
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth.js'
import { isSupabaseConfigured, supabaseConfigMessage } from '../lib/supabase.js'
import { AUTH_OTP_LENGTH, getOtpCopyLabel } from '../services/authConfig.js'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  LoaderCircleIcon,
  LockIcon,
  MailIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()

const mode = ref('signin')
const signinStep = ref('request')
const signupStep = ref('request')
const signinMethod = ref('password')
const pendingSignupAuthMode = ref('password')
const savedUser = ref(null)

const signinEmail = ref('')
const signinPassword = ref('')
const signupName = ref('')
const signupEmail = ref('')
const signupPassword = ref('')
const acceptPolicy = ref(false)

const PASSWORD_MIN_LENGTH = 8
const OTP_LENGTH = AUTH_OTP_LENGTH
const otpCopyLabel = getOtpCopyLabel(OTP_LENGTH)
const signinDigits = ref(Array(OTP_LENGTH).fill(''))
const signupDigits = ref(Array(OTP_LENGTH).fill(''))
const signinCode = computed(() => signinDigits.value.join(''))
const signupCode = computed(() => signupDigits.value.join(''))

const resendCountdown = ref(0)
let resendTimer = null

const isDesktop = computed(() => Boolean(window.velance))
const authUnavailable = computed(() => !isSupabaseConfigured)
const currentStep = computed(() => mode.value === 'signin' ? signinStep.value : signupStep.value)

const authHeadline = computed(() => {
  if (mode.value === 'signup' && signupStep.value === 'verify') return 'Check your inbox'
  if (mode.value === 'signup') return 'Create your account'
  if (signinStep.value === 'verify') return 'Enter your code'
  return 'Welcome back'
})

const authBody = computed(() => {
  if (mode.value === 'signup' && signupStep.value === 'verify')
    return `We sent a ${otpCopyLabel} to ${signupEmail.value || 'your email'}.`
  if (mode.value === 'signup')
    return 'Create a password once, then sign in without repeated email codes.'
  if (signinStep.value === 'verify')
    return `We sent a ${otpCopyLabel} to ${signinEmail.value || 'your email'}.`
  return 'Sign in with your password, Google, or a one-time email code if needed.'
})

const isSigninEmailValid = computed(() => /\S+@\S+\.\S+/.test(signinEmail.value))
const isSigninPasswordValid = computed(() => isSigninEmailValid.value && signinPassword.value.length > 0)
const isSignupIdentityValid = computed(() =>
  signupName.value.trim().length >= 2 &&
  /\S+@\S+\.\S+/.test(signupEmail.value) &&
  acceptPolicy.value
)
const isSignupValid = computed(() =>
  isSignupIdentityValid.value &&
  signupPassword.value.length >= PASSWORD_MIN_LENGTH
)
const isSigninCodeValid = computed(() => signinCode.value.length === OTP_LENGTH && !signinDigits.value.some(d => d === ''))
const isSignupCodeValid = computed(() => signupCode.value.length === OTP_LENGTH && !signupDigits.value.some(d => d === ''))

const featureSlides = [
  {
    icon: '01',
    title: 'Live focus intelligence',
    body: 'Velance scores every minute you work: Presence, Activity, Continuity, and Stability.',
  },
  {
    icon: '02',
    title: '24/7 ambient tracking',
    body: 'Know exactly where your time went. Background tracking captures every app, window, and browser tab.',
  },
  {
    icon: '03',
    title: 'Habit loops built in',
    body: 'Link habits to your focus sessions and watch streaks + heatmaps emerge from real work days.',
  },
]
const featureIndex = ref(0)
let featureTimer = null

function resetFlows() {
  signinStep.value = 'request'
  signupStep.value = 'request'
  signinMethod.value = 'password'
  signinDigits.value = Array(OTP_LENGTH).fill('')
  signupDigits.value = Array(OTP_LENGTH).fill('')
  signinPassword.value = ''
  signupPassword.value = ''
  clearResendCountdown()
  authStore.clearError()
}

/* Resend countdown */
function startResendCountdown() {
  resendCountdown.value = 45
  clearResendCountdown()
  resendTimer = setInterval(() => {
    resendCountdown.value--
    if (resendCountdown.value <= 0) clearResendCountdown()
  }, 1000)
}

function clearResendCountdown() {
  if (resendTimer) { clearInterval(resendTimer); resendTimer = null }
}

/* OTP box logic */
function otpBoxId(flow, idx) { return `otp-${flow}-${idx}` }

function focusOtpBox(flow, idx) {
  const el = document.getElementById(otpBoxId(flow, idx))
  if (el) el.focus()
}

function handleOtpInput(flow, idx, event) {
  const digits = flow === 'signin' ? signinDigits : signupDigits
  const val = event.target.value.replace(/\D/g, '').slice(-1)
  digits.value[idx] = val
  event.target.value = val

  if (val && idx < OTP_LENGTH - 1) {
    nextTick(() => focusOtpBox(flow, idx + 1))
  }
  if (val && idx === OTP_LENGTH - 1) {
    nextTick(() => {
      if (flow === 'signin' && isSigninCodeValid.value) verifySigninCode()
      if (flow === 'signup' && isSignupCodeValid.value) verifySignupCode()
    })
  }
}

function handleOtpKeydown(flow, idx, event) {
  const digits = flow === 'signin' ? signinDigits : signupDigits
  if (event.key === 'Backspace') {
    if (digits.value[idx]) {
      digits.value[idx] = ''
      event.target.value = ''
    } else if (idx > 0) {
      nextTick(() => focusOtpBox(flow, idx - 1))
    }
  }
  if (event.key === 'ArrowLeft' && idx > 0) focusOtpBox(flow, idx - 1)
  if (event.key === 'ArrowRight' && idx < OTP_LENGTH - 1) focusOtpBox(flow, idx + 1)
}

function handleOtpPaste(flow, event) {
  const digits = flow === 'signin' ? signinDigits : signupDigits
  const text = (event.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '')
  if (!text) return
  event.preventDefault()
  for (let i = 0; i < OTP_LENGTH; i++) {
    digits.value[i] = text[i] || ''
  }
  nextTick(() => {
    const lastFilled = Math.min(text.length - 1, OTP_LENGTH - 1)
    focusOtpBox(flow, lastFilled)
    if (text.length >= OTP_LENGTH) {
      if (flow === 'signin' && isSigninCodeValid.value) verifySigninCode()
      if (flow === 'signup' && isSignupCodeValid.value) verifySignupCode()
    }
  })
}

function saveQuickLoginFromUser(emailOverride = '') {
  const meta = authStore.user?.user_metadata || {}
  const email = authStore.user?.email || emailOverride
  if (!email) return
  localStorage.setItem('velance_quick_login', JSON.stringify({
    email,
    name: meta.username || meta.full_name || meta.name || email.split('@')[0],
  }))
}

async function requestSigninCode() {
  if (!isSigninEmailValid.value) return
  authStore.clearError()
  const res = await authStore.login({ email: signinEmail.value.trim() })
  if (res?.ok) {
    signinStep.value = 'verify'
    signinDigits.value = Array(OTP_LENGTH).fill('')
    startResendCountdown()
    nextTick(() => focusOtpBox('signin', 0))
  }
}

async function signInWithPassword() {
  if (!isSigninPasswordValid.value) return
  authStore.clearError()
  const ok = await authStore.loginWithPassword({
    email: signinEmail.value.trim(),
    password: signinPassword.value,
  })
  if (ok) {
    saveQuickLoginFromUser(signinEmail.value.trim())
    clearResendCountdown()
  }
}

async function handleSigninRequest() {
  if (signinMethod.value === 'password') {
    await signInWithPassword()
    return
  }
  await requestSigninCode()
}

async function verifySigninCode() {
  if (!isSigninCodeValid.value) return
  authStore.clearError()
  const ok = await authStore.verifyOTP({ email: signinEmail.value.trim(), code: signinCode.value })
  if (ok) {
    saveQuickLoginFromUser(signinEmail.value.trim())
    clearResendCountdown()
  }
}

async function requestSignupCode() {
  if (!isSignupIdentityValid.value) return
  authStore.clearError()
  pendingSignupAuthMode.value = 'otp'
  const res = await authStore.register({ username: signupName.value.trim(), email: signupEmail.value.trim() })
  if (res?.ok) {
    signupStep.value = 'verify'
    signupDigits.value = Array(OTP_LENGTH).fill('')
    startResendCountdown()
    nextTick(() => focusOtpBox('signup', 0))
  }
}

async function registerWithPassword() {
  if (!isSignupValid.value) return
  authStore.clearError()
  pendingSignupAuthMode.value = 'password'
  const res = await authStore.registerWithPassword({
    username: signupName.value.trim(),
    email: signupEmail.value.trim(),
    password: signupPassword.value,
  })
  if (!res?.ok) return

  saveQuickLoginFromUser(signupEmail.value.trim())

  if (res.sessionCreated) {
    clearResendCountdown()
    router.replace('/onboarding')
    return
  }

  signupStep.value = 'verify'
  signupDigits.value = Array(OTP_LENGTH).fill('')
  startResendCountdown()
  nextTick(() => focusOtpBox('signup', 0))
}

async function verifySignupCode() {
  if (!isSignupCodeValid.value) return
  authStore.clearError()
  const ok = await authStore.verifyRegistrationOTP({ email: signupEmail.value.trim(), code: signupCode.value })
  if (ok) {
    saveQuickLoginFromUser(signupEmail.value.trim())
    clearResendCountdown()
    router.replace('/onboarding')
  }
}

async function continueWithGoogle() {
  authStore.clearError()
  const ok = await authStore.loginWithGoogle()
  if (ok) {
    saveQuickLoginFromUser()
  }
}

function useSavedUser() {
  if (!savedUser.value?.email) return
  mode.value = 'signin'
  signinEmail.value = savedUser.value.email
  signinMethod.value = 'password'
  signinStep.value = 'request'
  authStore.clearError()
}

async function quickSigninSavedUser() {
  if (!savedUser.value?.email || authStore.loading) return
  mode.value = 'signin'
  signinEmail.value = savedUser.value.email
  signinMethod.value = 'password'
  signinStep.value = 'request'
  signinDigits.value = Array(OTP_LENGTH).fill('')
  clearResendCountdown()
  authStore.clearError()
  await nextTick()
  document.getElementById('signin-password')?.focus()
}

function clearSavedUser() {
  localStorage.removeItem('velance_quick_login')
  savedUser.value = null
}

async function resendCode() {
  if (resendCountdown.value > 0) return
  if (mode.value === 'signin') await requestSigninCode()
  else if (pendingSignupAuthMode.value === 'password') {
    const res = await authStore.resendSignupConfirmation({ email: signupEmail.value.trim() })
    if (res?.ok) startResendCountdown()
  } else {
    await requestSignupCode()
  }
}

onMounted(() => {
  authStore.clearError()
  const stored = localStorage.getItem('velance_quick_login')
  if (stored) {
    try {
      savedUser.value = JSON.parse(stored)
      signinEmail.value = savedUser.value?.email || ''
    } catch {}
  }
  featureTimer = setInterval(() => {
    featureIndex.value = (featureIndex.value + 1) % featureSlides.length
  }, 3800)
})

onUnmounted(() => {
  clearResendCountdown()
  if (featureTimer) clearInterval(featureTimer)
})
</script>

<template>
  <div class="auth-root">
    <div class="auth-mesh"></div>

    <div v-if="!isDesktop" class="auth-shell desktop-only">
      <section class="desktop-card">
        <img src="/logo-black.png" class="auth-logo auth-logo-light" alt="Velance" />
        <img src="/logo-white.png" class="auth-logo auth-logo-dark" alt="Velance" />
        <h1>Open Velance on desktop</h1>
        <p>The sign-in flow requires the Electron app to hand off sessions cleanly to your local workspace.</p>
      </section>
    </div>

    <div v-else class="auth-shell">
      <!-- Left hero panel -->
      <section class="hero-panel">
        <div class="hero-brand">
          <div class="hero-badge">
            <img src="/logo-white.png" class="hero-logo-img" alt="Velance" />
          </div>
          <div>
            <span class="hero-eyebrow">Velance</span>
            <span class="hero-tagline">Your focus, measured.</span>
          </div>
        </div>

        <div class="hero-heading">
          <h1>Work with<br><span class="gradient-text">more clarity.</span></h1>
          <p>Track focus. Build habits. Understand your day - all local-first, all yours.</p>
        </div>

        <!-- Returning user card -->
        <div v-if="savedUser" class="returning-card">
          <div class="returning-avatar">{{ savedUser.name?.charAt(0)?.toUpperCase() || 'V' }}</div>
          <div class="returning-copy">
            <strong>{{ savedUser.name }}</strong>
            <span>{{ savedUser.email }}</span>
          </div>
          <button class="quick-login-btn" :disabled="authStore.loading" @click="quickSigninSavedUser">
            Quick sign in
          </button>
          <button class="ghost-pill" @click="useSavedUser">Edit</button>
          <button class="icon-clear" @click="clearSavedUser" aria-label="Forget saved user">x</button>
        </div>

        <!-- Feature carousel -->
        <div class="feature-carousel">
          <transition name="slide-up" mode="out-in">
            <div :key="featureIndex" class="feature-slide">
              <span class="feature-icon">{{ featureSlides[featureIndex].icon }}</span>
              <div class="feature-copy">
                <strong>{{ featureSlides[featureIndex].title }}</strong>
                <span>{{ featureSlides[featureIndex].body }}</span>
              </div>
            </div>
          </transition>
          <div class="feature-dots">
            <button
              v-for="(_, i) in featureSlides"
              :key="i"
              class="feature-dot"
              :class="{ active: i === featureIndex }"
              @click="featureIndex = i"
            />
          </div>
        </div>

        <div class="hero-trust">
          <div class="trust-pill"><ShieldCheckIcon :size="13" /> Local-first data</div>
          <div class="trust-pill"><ShieldCheckIcon :size="13" /> No cloud upload required</div>
        </div>
      </section>

      <!-- Right auth card -->
      <section class="auth-card">
        <div class="auth-header">
          <div v-if="currentStep === 'request'" class="mode-switch">
            <button class="mode-btn" :class="{ active: mode === 'signin' }" @click="mode = 'signin'; resetFlows()">Sign in</button>
            <button class="mode-btn" :class="{ active: mode === 'signup' }" @click="mode = 'signup'; resetFlows()">Create account</button>
          </div>
          <div class="headline-block">
            <p class="eyebrow">{{ mode === 'signup' ? 'New account' : 'Welcome back' }}</p>
            <h2>{{ authHeadline }}</h2>
            <p class="headline-sub">{{ authBody }}</p>
          </div>
        </div>

        <div v-if="authStore.error" class="error-banner">
          <strong>Couldn't continue</strong>
          <span>{{ authStore.error }}</span>
        </div>
        <div v-else-if="authUnavailable" class="error-banner config-banner">
          <strong>Authentication setup needed</strong>
          <span>{{ supabaseConfigMessage }}</span>
        </div>

        <!-- Sign in: Email request -->
        <form v-if="mode === 'signin' && signinStep === 'request'" class="auth-form" @submit.prevent="handleSigninRequest">
          <div v-if="savedUser?.email && signinEmail === savedUser.email" class="quick-account-panel">
            <div class="quick-account-avatar">{{ savedUser.name?.charAt(0)?.toUpperCase() || 'V' }}</div>
            <div>
              <strong>Saved account ready</strong>
              <span>Enter your password for {{ savedUser.email }}.</span>
            </div>
          </div>

          <button type="button" class="oauth-btn google-btn" :disabled="authStore.loading || authUnavailable" @click="continueWithGoogle">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>{{ authStore.loading ? 'Opening browser...' : 'Continue with Google' }}</span>
          </button>

          <div class="divider"><span>or use email</span></div>

          <label class="field">
            <span>Email address</span>
            <div class="input-shell">
              <MailIcon :size="15" />
              <input v-model="signinEmail" type="email" placeholder="you@example.com" autocomplete="email" />
            </div>
          </label>

          <label v-if="signinMethod === 'password'" class="field">
            <span>Password</span>
            <div class="input-shell">
              <LockIcon :size="15" />
              <input
                id="signin-password"
                v-model="signinPassword"
                type="password"
                placeholder="Your password"
                autocomplete="current-password"
              />
            </div>
          </label>

          <button
            class="primary-btn"
            type="submit"
            :disabled="authStore.loading || authUnavailable || (signinMethod === 'password' ? !isSigninPasswordValid : !isSigninEmailValid)"
          >
            <LoaderCircleIcon v-if="authStore.loading" class="spin" :size="16" />
            <span>
              {{
                authStore.loading
                  ? (signinMethod === 'password' ? 'Signing in...' : 'Sending code...')
                  : (signinMethod === 'password' ? 'Sign in' : 'Email me a sign-in code')
              }}
            </span>
            <ArrowRightIcon v-if="!authStore.loading" :size="15" />
          </button>
          <div class="auth-alt-row">
            <button
              v-if="signinMethod === 'password'"
              type="button"
              class="text-btn"
              @click="signinMethod = 'otp'; signinPassword = ''; authStore.clearError()"
            >
              Use email code instead
            </button>
            <button
              v-else
              type="button"
              class="text-btn"
              @click="signinMethod = 'password'; authStore.clearError(); nextTick(() => document.getElementById('signin-password')?.focus())"
            >
              Use password instead
            </button>
          </div>
          <p v-if="signinMethod === 'otp'" class="passwordless-note">Email codes are a fallback for passwordless accounts or password recovery.</p>
        </form>

        <!-- Sign in: OTP verify -->
        <form v-else-if="mode === 'signin' && signinStep === 'verify'" class="auth-form" @submit.prevent="verifySigninCode">
          <button type="button" class="back-btn" @click="signinStep = 'request'; authStore.clearError(); clearResendCountdown()">
            <ArrowLeftIcon :size="14" /> Back
          </button>

          <div class="otp-group">
            <input
              v-for="(_, idx) in signinDigits"
              :key="idx"
              :id="otpBoxId('signin', idx)"
              class="otp-box"
              type="text"
              inputmode="numeric"
              maxlength="1"
              :value="signinDigits[idx]"
              autocomplete="one-time-code"
              @input="handleOtpInput('signin', idx, $event)"
              @keydown="handleOtpKeydown('signin', idx, $event)"
              @paste="handleOtpPaste('signin', $event)"
              @focus="$event.target.select()"
            />
          </div>

          <div class="helper-row">
            <span>Didn't receive it?</span>
            <button
              type="button"
              class="text-btn"
              :disabled="resendCountdown > 0"
              @click="resendCode"
            >
              {{ resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code' }}
            </button>
          </div>

          <button class="primary-btn" type="submit" :disabled="authStore.loading || !isSigninCodeValid">
            <LoaderCircleIcon v-if="authStore.loading" class="spin" :size="16" />
            <span>{{ authStore.loading ? 'Verifying...' : 'Verify and sign in' }}</span>
            <ArrowRightIcon v-if="!authStore.loading" :size="15" />
          </button>
        </form>

        <!-- Sign up: Request -->
        <form v-else-if="mode === 'signup' && signupStep === 'request'" class="auth-form" @submit.prevent="registerWithPassword">
          <button type="button" class="oauth-btn google-btn" :disabled="authStore.loading || authUnavailable" @click="continueWithGoogle">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span>{{ authStore.loading ? 'Opening browser...' : 'Sign up with Google' }}</span>
          </button>

          <div class="divider"><span>or use email</span></div>

          <label class="field">
            <span>Your name</span>
            <div class="input-shell">
              <UserIcon :size="15" />
              <input v-model="signupName" type="text" placeholder="Jane Doe" autocomplete="name" />
            </div>
          </label>

          <label class="field">
            <span>Email address</span>
            <div class="input-shell">
              <MailIcon :size="15" />
              <input v-model="signupEmail" type="email" placeholder="you@example.com" autocomplete="email" />
            </div>
          </label>

          <label class="field">
            <span>Password</span>
            <div class="input-shell">
              <LockIcon :size="15" />
              <input
                v-model="signupPassword"
                type="password"
                placeholder="At least 8 characters"
                autocomplete="new-password"
              />
            </div>
            <small class="field-hint">Use at least {{ PASSWORD_MIN_LENGTH }} characters. You can still link Google later.</small>
          </label>

          <label class="checkbox-row">
            <input v-model="acceptPolicy" type="checkbox" />
            <span>I understand Velance stores workspace data locally on this device.</span>
          </label>

          <button class="primary-btn" type="submit" :disabled="authStore.loading || authUnavailable || !isSignupValid">
            <LoaderCircleIcon v-if="authStore.loading" class="spin" :size="16" />
            <span>{{ authStore.loading ? 'Creating account...' : 'Create account' }}</span>
            <ArrowRightIcon v-if="!authStore.loading" :size="15" />
          </button>
          <div class="auth-alt-row">
            <button
              type="button"
              class="text-btn"
              :disabled="authStore.loading || authUnavailable || !isSignupIdentityValid"
              @click="requestSignupCode"
            >
              Create with email code instead
            </button>
          </div>
        </form>

        <!-- Sign up: OTP verify -->
        <form v-else class="auth-form" @submit.prevent="verifySignupCode">
          <button type="button" class="back-btn" @click="signupStep = 'request'; authStore.clearError(); clearResendCountdown()">
            <ArrowLeftIcon :size="14" /> Back
          </button>

          <div class="otp-group">
            <input
              v-for="(_, idx) in signupDigits"
              :key="idx"
              :id="otpBoxId('signup', idx)"
              class="otp-box"
              type="text"
              inputmode="numeric"
              maxlength="1"
              :value="signupDigits[idx]"
              autocomplete="one-time-code"
              @input="handleOtpInput('signup', idx, $event)"
              @keydown="handleOtpKeydown('signup', idx, $event)"
              @paste="handleOtpPaste('signup', $event)"
              @focus="$event.target.select()"
            />
          </div>

          <div class="helper-row">
            <span>Didn't receive it?</span>
            <button
              type="button"
              class="text-btn"
              :disabled="resendCountdown > 0"
              @click="resendCode"
            >
              {{ resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code' }}
            </button>
          </div>

          <button class="primary-btn" type="submit" :disabled="authStore.loading || !isSignupCodeValid">
            <LoaderCircleIcon v-if="authStore.loading" class="spin" :size="16" />
            <span>{{ authStore.loading ? 'Verifying...' : 'Finish account setup' }}</span>
            <ArrowRightIcon v-if="!authStore.loading" :size="15" />
          </button>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Root */
.auth-root {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg-app);
  color: var(--text-main);
}

/* Animated mesh background */
.auth-mesh {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 60% 50% at 8% 14%, rgba(14, 165, 233, 0.20), transparent),
    radial-gradient(ellipse 48% 40% at 90% 10%, rgba(99, 102, 241, 0.16), transparent),
    radial-gradient(ellipse 40% 36% at 80% 88%, rgba(20, 184, 166, 0.16), transparent),
    radial-gradient(ellipse 34% 30% at 20% 80%, rgba(168, 85, 247, 0.10), transparent);
  animation: meshDrift 18s ease-in-out infinite alternate;
}

@keyframes meshDrift {
  0%   { opacity: 0.8; transform: scale(1)   translateY(0px); }
  50%  { opacity: 1;   transform: scale(1.03) translateY(-8px); }
  100% { opacity: 0.85; transform: scale(1)  translateY(4px); }
}

/* Shell */
.auth-shell {
  position: relative;
  z-index: 1;
  width: min(1040px, 100%);
  display: grid;
  grid-template-columns: minmax(430px, 1fr) minmax(390px, 440px);
  gap: 18px;
  align-items: stretch;
}

/* Hero Panel */
.hero-panel {
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  border: 1px solid var(--border-light);
  background:
    radial-gradient(circle at 90% 2%, rgba(14, 165, 233, 0.08), transparent 36%),
    linear-gradient(160deg, color-mix(in srgb, var(--bg-card) 92%, white 8%), var(--bg-card));
  backdrop-filter: blur(18px);
  min-height: 100%;
  padding: clamp(28px, 3.2vw, 34px);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: clamp(18px, 2.4vh, 26px);
}

.hero-panel::after {
  content: '';
  position: absolute;
  right: -96px;
  bottom: -112px;
  width: 260px;
  height: 260px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(20, 184, 166, 0.12), transparent 66%);
  pointer-events: none;
}

.hero-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.hero-badge {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  padding: 6px;
  box-sizing: border-box;
  overflow: hidden;
}

.hero-logo-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.hero-eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hero-tagline {
  display: block;
  font-size: 14px;
  color: var(--text-main);
  font-weight: 600;
  margin-top: 2px;
}

.hero-heading h1 {
  font-size: clamp(40px, 4vw, 50px);
  line-height: 0.97;
  letter-spacing: -0.055em;
  margin-bottom: 12px;
}

.gradient-text {
  background: linear-gradient(120deg, #0ea5e9, #14b8a6, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-heading p {
  font-size: 15px;
  line-height: 1.65;
  color: var(--text-muted);
  max-width: 410px;
}

/* Returning user card */
.returning-card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--bg-card-hover) 82%, transparent);
  border: 1px solid var(--border-light);
}

.returning-avatar {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  display: grid;
  place-items: center;
  color: white;
  font-weight: 800;
  font-size: 16px;
  background: linear-gradient(135deg, #0ea5e9, #6366f1);
  flex-shrink: 0;
}

.returning-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.returning-copy strong { font-size: 14px; font-weight: 700; }
.returning-copy span { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.quick-login-btn {
  grid-column: 1 / -1;
  width: 100%;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  color: white;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(14, 165, 233, 0.18);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.quick-login-btn:hover { transform: translateY(-1px); box-shadow: 0 16px 28px rgba(14, 165, 233, 0.24); }
.quick-login-btn:disabled { opacity: 0.6; cursor: wait; transform: none; box-shadow: none; }

.ghost-pill {
  grid-column: 1 / 2;
  padding: 7px 13px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 80%, transparent);
  color: var(--text-main);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.ghost-pill:hover { transform: translateY(-1px); }

.icon-clear {
  grid-column: 2 / 3;
  justify-self: end;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

/* Feature carousel */
.feature-carousel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: auto;
}

.feature-slide {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px 20px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--bg-card-hover) 76%, transparent);
  border: 1px solid var(--border-light);
  min-height: 108px;
}

.feature-icon {
  font-size: 28px;
  flex-shrink: 0;
  margin-top: 2px;
}

.feature-copy strong {
  display: block;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 6px;
}

.feature-copy span {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}

.feature-dots {
  display: flex;
  gap: 8px;
  align-items: center;
}

.feature-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--border-light);
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;
}

.feature-dot.active {
  width: 22px;
  background: linear-gradient(90deg, #0ea5e9, #14b8a6);
}

/* Trust pills */
.hero-trust {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 2px;
}

.trust-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-card-hover) 80%, transparent);
  border: 1px solid var(--border-light);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

/* Auth Card */
.auth-card {
  border-radius: 28px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 90%, transparent);
  backdrop-filter: blur(20px);
  box-shadow: 0 28px 64px rgba(15, 23, 42, 0.10);
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 380px;
  height: fit-content;
}

.auth-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  padding: 5px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-card-hover) 84%, transparent);
  border: 1px solid var(--border-light);
}

.mode-btn {
  border: none;
  background: transparent;
  padding: 11px 12px;
  border-radius: 12px;
  color: var(--text-muted);
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.mode-btn.active {
  color: var(--text-main);
  background: color-mix(in srgb, var(--bg-card) 96%, transparent);
  box-shadow: 0 8px 16px rgba(15, 23, 42, 0.07);
}

.eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.headline-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.headline-block h2 {
  font-size: 32px;
  line-height: 0.98;
  letter-spacing: -0.05em;
}

.headline-sub {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-muted);
}

/* Error */
.error-banner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 16px;
  color: #991b1b;
  background: rgba(254, 226, 226, 0.94);
  border: 1px solid rgba(239, 68, 68, 0.18);
  animation: rise-in 0.2s ease;
}

.error-banner span { font-size: 13px; line-height: 1.5; }

/* Form */
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: rise-in 0.22s ease;
}

.quick-account-panel {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;
  padding: 13px 14px;
  border-radius: 16px;
  border: 1px solid rgba(14, 165, 233, 0.16);
  background: rgba(14, 165, 233, 0.06);
}

.quick-account-avatar {
  width: 36px;
  height: 36px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #0ea5e9, #6366f1);
  color: white;
  font-size: 14px;
  font-weight: 800;
}

.quick-account-panel strong {
  display: block;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-main);
  margin-bottom: 2px;
}

.quick-account-panel span {
  display: block;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}

.oauth-btn {
  min-height: 52px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid var(--border-light);
  color: var(--text-main);
  background: color-mix(in srgb, var(--bg-card-hover) 84%, transparent);
  transition: transform 0.18s ease, border-color 0.18s ease;
}

.oauth-btn:hover { transform: translateY(-1px); border-color: var(--text-muted); }
.oauth-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.divider::before, .divider::after { content: ''; flex: 1; border-top: 1px solid var(--border-light); }

.field { display: flex; flex-direction: column; gap: 7px; }
.field > span:first-child {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-main);
  letter-spacing: 0.03em;
}

.field-hint {
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}

.input-shell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card-hover) 84%, transparent);
  color: var(--text-muted);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.input-shell:focus-within {
  border-color: rgba(14, 165, 233, 0.45);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.10);
}

.input-icon { font-size: 15px; }

.input-shell input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-main);
  font: inherit;
  font-size: 15px;
}

.input-shell input::placeholder { color: var(--text-muted); }

/* OTP code boxes */
.otp-group {
  display: flex;
  gap: 6px;
  justify-content: center;
  width: 100%;
}

.otp-box {
  flex: 1;
  min-width: 0;
  max-width: 52px;
  height: 54px;
  border-radius: 13px;
  border: 1.5px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card-hover) 84%, transparent);
  color: var(--text-main);
  font: inherit;
  font-size: 18px;
  font-weight: 800;
  text-align: center;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.12s ease;
  caret-color: transparent;
  padding: 0;
}

.otp-box:focus {
  border-color: rgba(14, 165, 233, 0.6);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
  transform: scale(1.04);
}

.otp-box:not(:placeholder-shown) {
  border-color: rgba(14, 165, 233, 0.3);
}

.checkbox-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
  cursor: pointer;
}

.checkbox-row input { margin-top: 2px; }

.helper-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}

.helper-row span { color: var(--text-muted); font-weight: 600; }

.text-btn {
  border: none;
  background: transparent;
  color: #0ea5e9;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s;
}

.text-btn:disabled { opacity: 0.45; cursor: default; }

.auth-alt-row {
  display: flex;
  justify-content: center;
  margin-top: -4px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.15s;
}

.back-btn:hover { color: var(--text-main); }

.primary-btn {
  min-height: 52px;
  border-radius: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  color: white;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
  background: linear-gradient(135deg, #0ea5e9, #14b8a6);
  box-shadow: 0 16px 32px rgba(14, 165, 233, 0.20);
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.primary-btn:hover { transform: translateY(-1px); box-shadow: 0 20px 40px rgba(14, 165, 233, 0.28); }
.primary-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; box-shadow: none; }

.passwordless-note {
  margin: -4px 0 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

/* Desktop-only message */
.auth-shell.desktop-only { grid-template-columns: 1fr; width: min(480px, 100%); }
.desktop-card {
  border-radius: 28px;
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 90%, transparent);
  backdrop-filter: blur(18px);
  padding: 36px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  text-align: center;
  align-items: center;
}

.auth-logo {
  width: 60px;
  height: 60px;
  object-fit: contain;
  border-radius: 18px;
  display: block;
}

.auth-logo-dark { display: none; }
.dark-theme .auth-logo-light { display: none; }
.dark-theme .auth-logo-dark { display: block; }

.desktop-card h1 { font-size: 26px; letter-spacing: -0.04em; }
.desktop-card p { color: var(--text-muted); font-size: 15px; line-height: 1.65; }

/* Animations */
.spin { animation: spin 0.8s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes rise-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

.slide-up-enter-active, .slide-up-leave-active { transition: all 0.32s cubic-bezier(0.22, 1, 0.36, 1); }
.slide-up-enter-from { opacity: 0; transform: translateY(12px); }
.slide-up-leave-to { opacity: 0; transform: translateY(-10px); }

@media (max-width: 900px) {
  .auth-shell { grid-template-columns: 1fr; }
  .hero-panel { display: none; }
}
</style>
