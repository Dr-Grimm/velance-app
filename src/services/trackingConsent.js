export const TRACKING_CONSENT_VERSION = 1

export function hasResolvedTrackingConsent(settings = {}) {
  return (
    Number(settings?.trackingConsentVersion || 0) >= TRACKING_CONSENT_VERSION &&
    Number(settings?.trackingConsentAt || 0) > 0
  )
}

export function hasTrackingConsent(settings = {}) {
  return hasResolvedTrackingConsent(settings) && Boolean(settings?.trackingConsentGranted)
}

export function canTrackWithSettings(settings = {}) {
  return Boolean(settings?.trackingEnabled) && hasTrackingConsent(settings)
}
