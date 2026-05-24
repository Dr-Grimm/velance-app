import { supabase } from '../lib/supabase.js'
import { isDefaultWorkspaceId, normalizeWorkspaceId } from './workspaceIdentity.js'

export const CLOUD_SYNC_TABLE = 'velance_workspace_snapshots'
export const CLOUD_SYNC_SCHEMA_VERSION = 'workspace-snapshot-v1'
export const CLOUD_SYNC_META_VERSION = 'workspace-sync-meta-v1'

function nowMs() {
  return Date.now()
}

function safeNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function normalizeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function getCollectionUpdatedAt(items = [], fields = []) {
  return normalizeArray(items).reduce((latest, item) => {
    const itemLatest = fields.reduce((current, field) => Math.max(current, safeNumber(item?.[field])), 0)
    return Math.max(latest, itemLatest)
  }, 0)
}

function computeSnapshotUpdatedAt(snapshot = {}) {
  const profileUpdated = safeNumber(snapshot.profile?.updatedAt || 0)
  const settingsUpdated = Math.max(
    safeNumber(snapshot.settings?.updatedAt || 0),
    safeNumber(snapshot.settings?.trackingConsentAt || 0),
  )
  const tasksUpdated = getCollectionUpdatedAt(snapshot.tasks, ['updatedAt', 'completedAt', 'createdAt'])
  const habitsUpdated = getCollectionUpdatedAt(snapshot.habits, ['updatedAt', 'createdAt'])
  const sessionsUpdated = getCollectionUpdatedAt(snapshot.sessions, ['timestamp', 'createdAt'])
  const insightsUpdated = safeNumber(snapshot.insightCache?.generatedAt || 0)

  return Math.max(profileUpdated, settingsUpdated, tasksUpdated, habitsUpdated, sessionsUpdated, insightsUpdated, 0)
}

export function createInitialSyncStatus(overrides = {}) {
  return {
    enabled: false,
    mode: 'local-only',
    label: 'Local only',
    message: 'Sign in to keep saved data in sync across devices.',
    lastSyncedAt: 0,
    lastRemoteUpdatedAt: 0,
    pending: false,
    schemaReady: false,
    errorCode: '',
    ...overrides,
  }
}

export function createInitialSyncMeta(overrides = {}) {
  return {
    version: CLOUD_SYNC_META_VERSION,
    dirty: false,
    dirtySince: 0,
    lastSyncedAt: 0,
    lastRemoteUpdatedAt: 0,
    lastLocalUpdatedAt: 0,
    lastError: '',
    conflictDetectedAt: 0,
    pendingReason: '',
    ...overrides,
  }
}

export function normalizeSyncMeta(syncMeta = {}) {
  return createInitialSyncMeta({
    dirty: Boolean(syncMeta?.dirty),
    dirtySince: safeNumber(syncMeta?.dirtySince || 0),
    lastSyncedAt: safeNumber(syncMeta?.lastSyncedAt || 0),
    lastRemoteUpdatedAt: safeNumber(syncMeta?.lastRemoteUpdatedAt || 0),
    lastLocalUpdatedAt: safeNumber(syncMeta?.lastLocalUpdatedAt || 0),
    lastError: String(syncMeta?.lastError || ''),
    conflictDetectedAt: safeNumber(syncMeta?.conflictDetectedAt || 0),
    pendingReason: String(syncMeta?.pendingReason || ''),
  })
}

export function canCloudSyncWorkspace(workspaceId, userId = '') {
  const normalizedWorkspace = normalizeWorkspaceId(workspaceId)
  if (!userId) return false
  if (isDefaultWorkspaceId(normalizedWorkspace)) return false
  return normalizedWorkspace === normalizeWorkspaceId(userId)
}

export function normalizeSyncSnapshot(snapshot = {}) {
  const normalized = {
    schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
    workspaceId: normalizeWorkspaceId(snapshot.workspaceId),
    snapshotUpdatedAt: safeNumber(snapshot.snapshotUpdatedAt || 0),
    profile: normalizeObject(snapshot.profile, {}),
    settings: normalizeObject(snapshot.settings, {}),
    tasks: normalizeArray(snapshot.tasks),
    habits: normalizeArray(snapshot.habits),
    sessions: normalizeArray(snapshot.sessions),
    insightCache: {
      insights: normalizeArray(snapshot.insightCache?.insights),
      generatedAt: safeNumber(snapshot.insightCache?.generatedAt || 0),
    },
    customRules: normalizeObject(snapshot.customRules, {}),
  }

  if (!normalized.snapshotUpdatedAt) {
    normalized.snapshotUpdatedAt = computeSnapshotUpdatedAt(normalized)
  }

  return normalized
}

export function hasMeaningfulSyncPayload(snapshot = {}) {
  const normalized = normalizeSyncSnapshot(snapshot)
  return Boolean(
    Object.keys(normalized.profile || {}).some((key) => key !== 'avatar' && normalized.profile?.[key]) ||
    normalized.tasks.length ||
    normalized.habits.length ||
    normalized.sessions.length ||
    normalized.insightCache.insights.length ||
    Object.keys(normalized.customRules || {}).length,
  )
}

function isMissingSchemaError(error = null) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return code === 'PGRST205'
    || code === '42P01'
    || /Could not find the table|relation .* does not exist|schema cache/i.test(message)
}

function isNetworkSyncError(error = null) {
  const message = String(error?.message || '')
  const causeMessage = String(error?.cause?.message || '')
  const code = String(error?.code || '')
  return /Failed to fetch|NetworkError|network request failed|offline|ECONN|ENOTFOUND|ETIMEDOUT|fetch/i.test(
    `${message} ${causeMessage} ${code}`,
  )
}

function buildErrorStatus(error) {
  if (isMissingSchemaError(error)) {
    return createInitialSyncStatus({
      enabled: true,
      mode: 'needs-schema',
      label: 'Sync setup needed',
      message: 'Run the included Supabase migration to enable cross-device saved-data sync.',
      schemaReady: false,
      errorCode: String(error?.code || ''),
    })
  }

  if (isNetworkSyncError(error)) {
    return createInitialSyncStatus({
      enabled: true,
      mode: 'offline',
      label: 'Offline',
      message: 'Local changes are safe on this device and will sync when the connection comes back.',
      schemaReady: true,
      errorCode: String(error?.code || ''),
      pending: true,
    })
  }

  return createInitialSyncStatus({
    enabled: true,
    mode: 'error',
    label: 'Sync paused',
    message: error?.message || 'Velance could not reach cloud sync right now.',
    schemaReady: true,
    errorCode: String(error?.code || ''),
  })
}

async function getAuthenticatedUser() {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  return data?.user || null
}

async function fetchRemoteWorkspaceRow(workspaceId) {
  const { data, error } = await supabase
    .from(CLOUD_SYNC_TABLE)
    .select('workspace_id, owner_user_id, snapshot, snapshot_updated_at, updated_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (error) throw error
  return data || null
}

async function pushRemoteWorkspaceSnapshot(userId, snapshot) {
  const payload = {
    workspace_id: snapshot.workspaceId,
    owner_user_id: userId,
    snapshot,
    snapshot_updated_at: snapshot.snapshotUpdatedAt,
  }

  const { data, error } = await supabase
    .from(CLOUD_SYNC_TABLE)
    .upsert(payload, { onConflict: 'workspace_id' })
    .select('workspace_id, owner_user_id, snapshot_updated_at, updated_at')
    .single()

  if (error) throw error
  return data
}

export async function syncWorkspaceSnapshot(localSnapshot, { reason = 'sync', syncMeta = {} } = {}) {
  const user = await getAuthenticatedUser()
  const normalizedLocal = normalizeSyncSnapshot(localSnapshot)
  const normalizedMeta = normalizeSyncMeta(syncMeta)

  if (!canCloudSyncWorkspace(normalizedLocal.workspaceId, user?.id)) {
    return {
      ok: true,
      skipped: true,
      direction: 'local-only',
      syncStatus: createInitialSyncStatus({
        enabled: false,
        mode: 'local-only',
        label: 'Local only',
        message: user?.id
          ? 'This workspace is staying local on this device.'
          : 'Sign in to sync saved data across devices.',
      }),
    }
  }

  try {
    const remoteRow = await fetchRemoteWorkspaceRow(normalizedLocal.workspaceId)

    if (!remoteRow) {
      if (!hasMeaningfulSyncPayload(normalizedLocal)) {
        return {
          ok: true,
          direction: 'noop',
          syncStatus: createInitialSyncStatus({
            enabled: true,
            mode: 'idle',
            label: 'Sync ready',
            message: 'Cloud sync is ready for this account when meaningful data appears.',
            schemaReady: true,
          }),
        }
      }

      const pushed = await pushRemoteWorkspaceSnapshot(user.id, normalizedLocal)
      return {
        ok: true,
        direction: 'push',
        remoteUpdatedAt: safeNumber(pushed?.snapshot_updated_at || normalizedLocal.snapshotUpdatedAt),
        syncStatus: createInitialSyncStatus({
          enabled: true,
          mode: 'synced',
          label: 'Synced',
          message: reason === 'hydrate'
            ? 'This workspace is now backed up to Supabase for this account.'
            : 'Saved data synced to your account.',
          schemaReady: true,
          lastSyncedAt: nowMs(),
          lastRemoteUpdatedAt: safeNumber(pushed?.snapshot_updated_at || normalizedLocal.snapshotUpdatedAt),
        }),
      }
    }

    const remoteSnapshot = normalizeSyncSnapshot(remoteRow.snapshot || {})
    const remoteUpdatedAt = Math.max(
      safeNumber(remoteRow.snapshot_updated_at || 0),
      safeNumber(remoteSnapshot.snapshotUpdatedAt || 0),
    )
    const localUpdatedAt = safeNumber(normalizedLocal.snapshotUpdatedAt || 0)
    const thresholdMs = 1000
    const remoteAdvancedSinceLastSync = normalizedMeta.lastRemoteUpdatedAt > 0
      && remoteUpdatedAt > normalizedMeta.lastRemoteUpdatedAt + thresholdMs
    const hasUnsyncedLocalChanges = normalizedMeta.dirty
      && localUpdatedAt >= Math.max(normalizedMeta.lastLocalUpdatedAt, normalizedMeta.dirtySince, 0)

    if (reason !== 'force-push' && reason !== 'force-pull' && remoteAdvancedSinceLastSync && hasUnsyncedLocalChanges) {
      return {
        ok: true,
        direction: 'conflict',
        remoteSnapshot,
        remoteUpdatedAt,
        syncStatus: createInitialSyncStatus({
          enabled: true,
          mode: 'conflict',
          label: 'Sync conflict',
          message: 'Another device updated this workspace while this device still has unsynced changes.',
          schemaReady: true,
          lastRemoteUpdatedAt: remoteUpdatedAt,
          pending: true,
        }),
      }
    }

    const shouldPull = reason === 'force-pull' || 
      (remoteUpdatedAt > localUpdatedAt + thresholdMs && (!hasUnsyncedLocalChanges || remoteAdvancedSinceLastSync))

    if (shouldPull) {
      return {
        ok: true,
        direction: 'pull',
        remoteSnapshot,
        remoteUpdatedAt,
        syncStatus: createInitialSyncStatus({
          enabled: true,
          mode: 'synced',
          label: 'Updated',
          message: 'Velance updated this device with the latest cloud changes.',
          schemaReady: true,
          lastSyncedAt: nowMs(),
          lastRemoteUpdatedAt: remoteUpdatedAt,
        }),
      }
    }

    const shouldPush = reason === 'force-push' || 
      localUpdatedAt > remoteUpdatedAt + thresholdMs || 
      (hasUnsyncedLocalChanges && !remoteAdvancedSinceLastSync)

    if (shouldPush) {
      const pushed = await pushRemoteWorkspaceSnapshot(user.id, normalizedLocal)
      return {
        ok: true,
        direction: 'push',
        remoteUpdatedAt: safeNumber(pushed?.snapshot_updated_at || normalizedLocal.snapshotUpdatedAt),
        syncStatus: createInitialSyncStatus({
          enabled: true,
          mode: 'synced',
          label: 'Synced',
          message: 'Latest local changes are backed up to your account.',
          schemaReady: true,
          lastSyncedAt: nowMs(),
          lastRemoteUpdatedAt: safeNumber(pushed?.snapshot_updated_at || normalizedLocal.snapshotUpdatedAt),
        }),
      }
    }

    return {
      ok: true,
      direction: 'noop',
      remoteUpdatedAt,
      syncStatus: createInitialSyncStatus({
        enabled: true,
        mode: 'synced',
        label: 'In sync',
        message: 'This device already matches the saved account snapshot.',
        schemaReady: true,
        lastSyncedAt: nowMs(),
        lastRemoteUpdatedAt: remoteUpdatedAt,
      }),
    }
  } catch (error) {
    return {
      ok: false,
      direction: 'error',
      error,
      syncStatus: buildErrorStatus(error),
    }
  }
}
