import { hasResolvedTrackingConsent } from './trackingConsent.js'

export const LEGACY_ONBOARDING_DONE_KEY = 'velance_onboarding_done'

export function getScopedOnboardingDoneKey(workspaceId = '') {
  return `velance:${String(workspaceId || 'local-user').trim() || 'local-user'}:onboarding_done`
}

function readFlag(key) {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(key) === '1'
}

function writeFlag(key) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, '1')
}

export function markOnboardingDone(workspaceId = '') {
  writeFlag(getScopedOnboardingDoneKey(workspaceId))
  writeFlag(LEGACY_ONBOARDING_DONE_KEY)
}

export function hasScopedOnboardingDone(workspaceId = '') {
  return readFlag(getScopedOnboardingDoneKey(workspaceId))
}

export function hasMeaningfulWorkspaceState({
  profile = {},
  settings = {},
  tasks = [],
  habits = [],
  sessions = [],
} = {}) {
  const role = String(profile?.role || '').trim()
  const goal = String(profile?.goal || '').trim()
  const workingHours = String(profile?.workingHours || '').trim()

  return Boolean(
    (role && role !== 'Professional') ||
    (goal && goal !== 'productivity') ||
    workingHours ||
    hasResolvedTrackingConsent(settings) ||
    (Array.isArray(tasks) && tasks.length > 0) ||
    (Array.isArray(habits) && habits.length > 0) ||
    (Array.isArray(sessions) && sessions.length > 0),
  )
}

export function hasCompletedOnboardingState(state = {}) {
  const workspaceId = state.workspaceId || ''
  const meaningfulState = hasMeaningfulWorkspaceState(state)

  return Boolean(
    state.profile?.setupComplete ||
    hasScopedOnboardingDone(workspaceId) ||
    (readFlag(LEGACY_ONBOARDING_DONE_KEY) && meaningfulState) ||
    meaningfulState,
  )
}
