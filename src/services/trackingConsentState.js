import { TRACKING_CONSENT_VERSION } from './trackingConsent.js'
import { normalizeWorkspaceId } from './workspaceIdentity.js'

export function getTrackingConsentFallbackKey(workspaceId = '') {
  return `velance:${normalizeWorkspaceId(workspaceId)}:tracking_consent`
}

export function normalizeTrackingConsentDecision(decision = null) {
  if (
    decision &&
    Number(decision.version || 0) >= TRACKING_CONSENT_VERSION &&
    Number(decision.at || 0) > 0
  ) {
    return {
      resolved: true,
      granted: Boolean(decision.granted),
      version: Number(decision.version),
      at: Number(decision.at),
    }
  }
  return null
}

export function readTrackingConsentFallback(workspaceId = '') {
  if (typeof localStorage === 'undefined') return null
  try {
    return normalizeTrackingConsentDecision(
      JSON.parse(localStorage.getItem(getTrackingConsentFallbackKey(workspaceId)) || 'null'),
    )
  } catch {
    return null
  }
}

export function writeTrackingConsentFallback({ workspaceId = '', granted = false, at = Date.now() } = {}) {
  const decision = {
    resolved: true,
    granted: Boolean(granted),
    version: TRACKING_CONSENT_VERSION,
    at,
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(getTrackingConsentFallbackKey(workspaceId), JSON.stringify(decision))
  }
  return decision
}

export function applyTrackingConsentDecision(settings = {}, decision = null) {
  const normalized = normalizeTrackingConsentDecision(decision)
  if (!normalized) return false
  settings.trackingConsentGranted = normalized.granted
  settings.trackingConsentVersion = normalized.version
  settings.trackingConsentAt = normalized.at
  if (!normalized.granted) settings.trackingEnabled = false
  if (normalized.granted && settings.trackingEnabled === false) settings.trackingEnabled = true
  return true
}
