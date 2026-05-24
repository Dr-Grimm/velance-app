import { isDefaultWorkspaceId, normalizeWorkspaceId } from './workspaceIdentity.js'

function getAuthProviders(user = null) {
  return Array.isArray(user?.identities)
    ? user.identities.map((identity) => identity?.provider).filter(Boolean)
    : []
}

function getDisplayName(user = null, profile = {}) {
  const meta = user?.user_metadata || {}
  return (
    meta.username ||
    meta.full_name ||
    meta.name ||
    profile?.name ||
    user?.email?.split('@')[0] ||
    'User'
  )
}

export function summarizeWorkspaceId(workspaceId) {
  const normalized = normalizeWorkspaceId(workspaceId)
  if (isDefaultWorkspaceId(normalized)) return 'local-user'
  if (normalized.length <= 18) return normalized
  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`
}

export function buildWorkspacePresentation({
  user = null,
  profile = {},
  workspaceId = null,
  backendStatus = {},
  migrationStatus = {},
} = {}) {
  const providers = getAuthProviders(user)
  const hasGoogleAuth = providers.includes('google')
  const hasSignedInAccount = Boolean(user?.id || user?.email)
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId)
  const displayName = getDisplayName(user, profile)
  const email = user?.email || ''

  let storageLabel = 'Checking storage'
  let storagePill = 'Checking'
  let storageDescription = 'Velance is confirming the local storage state for this workspace.'
  let storageTone = 'neutral'

  if (backendStatus?.kind === 'sqlite') {
    storageLabel = 'SQLite active'
    storagePill = 'Local SQLite'
    storageDescription = 'Primary local storage is healthy on this device.'
    storageTone = 'good'
  } else if (backendStatus?.kind === 'json-fallback') {
    storageLabel = 'Local safe mode'
    storagePill = 'Safe mode'
    storageDescription = 'Velance is keeping data locally with fallback storage while the main database is being repaired.'
    storageTone = 'warn'
  } else if (backendStatus?.kind === 'degraded') {
    storageLabel = 'Recovery mode'
    storagePill = 'Recovery mode'
    storageDescription = 'Velance loaded a local recovery snapshot after a storage issue.'
    storageTone = 'warn'
  }

  const accountLabel = hasGoogleAuth
    ? 'Google account'
    : hasSignedInAccount
      ? 'Email sign-in'
      : 'Local workspace'

  const accountStatus = hasSignedInAccount ? 'Signed in' : 'Local only'
  const accountDescription = hasSignedInAccount
    ? 'Your sign-in identifies this workspace. Local data stays on this device first, and saved workspace data can sync across devices when cloud sync is available.'
    : 'This workspace is only stored on this device until you sign in.'

  const workspaceLabel = hasSignedInAccount ? 'Signed-in workspace' : 'Device workspace'
  const workspaceDescription = hasSignedInAccount
    ? (email
        ? `This device workspace is connected to ${email}.`
        : 'This device workspace is connected to your signed-in account.')
    : 'This device is using the local workspace only.'

  const migrationLabel = migrationStatus?.completed ? 'Migration ready' : 'Migration checking'
  const migrationDescription = migrationStatus?.completed
    ? 'Earlier local data is already attached to this workspace on this device.'
    : 'Velance is still checking whether older local data needs to be attached here.'

  return {
    displayName,
    email,
    hasGoogleAuth,
    hasSignedInAccount,
    accountLabel,
    accountStatus,
    accountDescription,
    workspaceLabel,
    workspaceDescription,
    workspaceId: normalizedWorkspaceId,
    workspaceShortId: summarizeWorkspaceId(normalizedWorkspaceId),
    storageLabel,
    storagePill,
    storageDescription,
    storageTone,
    migrationLabel,
    migrationDescription,
    diagnosticsMessage: backendStatus?.message || storageDescription,
  }
}
