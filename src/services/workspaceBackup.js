export const WORKSPACE_BACKUP_VERSION = 'workspace-backup-v1'

function normalizeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : []
}

function normalizeNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function normalizeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeSyncState(syncState = {}) {
  const source = normalizeObject(syncState, {})
  return {
    dirty: Boolean(source.dirty),
    dirtySince: normalizeNumber(source.dirtySince || 0),
    lastSyncedAt: normalizeNumber(source.lastSyncedAt || 0),
    lastRemoteUpdatedAt: normalizeNumber(source.lastRemoteUpdatedAt || 0),
    lastLocalUpdatedAt: normalizeNumber(source.lastLocalUpdatedAt || 0),
    lastError: normalizeString(source.lastError || ''),
    conflictDetectedAt: normalizeNumber(source.conflictDetectedAt || 0),
    pendingReason: normalizeString(source.pendingReason || ''),
  }
}

export function normalizeWorkspaceBackup(rawBackup = {}, fallbackWorkspaceId = 'local-user') {
  const source = normalizeObject(rawBackup, {})
  const legacyInsightCache = {
    insights: normalizeArray(source.cachedInsights),
    generatedAt: normalizeNumber(source.insightsCachedAt || source.generatedAt || 0),
  }
  const insightSource = source.insightCache ? normalizeObject(source.insightCache, {}) : legacyInsightCache
  const workspaceSource = normalizeObject(source.workspace, {})
  const sourceWorkspaceId = normalizeString(
    source.sourceWorkspaceId || workspaceSource.id || fallbackWorkspaceId || 'local-user',
    fallbackWorkspaceId || 'local-user',
  )

  return {
    backupVersion: normalizeString(source.backupVersion || WORKSPACE_BACKUP_VERSION, WORKSPACE_BACKUP_VERSION),
    exportedAt: normalizeString(source.exportedAt || new Date().toISOString(), new Date().toISOString()),
    sourceWorkspaceId,
    backendKind: normalizeString(source.backendKind || source.backend?.kind || 'unknown', 'unknown'),
    workspace: {
      id: sourceWorkspaceId,
      migrationCompleted: Boolean(workspaceSource.migrationCompleted),
      migratedAt: normalizeNumber(workspaceSource.migratedAt || 0),
      syncState: normalizeSyncState(workspaceSource.syncState || source.syncState || {}),
    },
    profile: normalizeObject(source.profile, {}),
    settings: normalizeObject(source.settings, {}),
    tasks: normalizeArray(source.tasks),
    habits: normalizeArray(source.habits),
    sessions: normalizeArray(source.sessions),
    ambient: normalizeArray(source.ambient || source.tracking?.ambient),
    media: normalizeArray(source.media || source.tracking?.media),
    browserEvents: normalizeArray(source.browserEvents || source.tracking?.browserEvents),
    customRules: normalizeObject(source.customRules, {}),
    insightCache: {
      insights: normalizeArray(insightSource.insights),
      generatedAt: normalizeNumber(insightSource.generatedAt || 0),
    },
  }
}

export function summarizeWorkspaceBackup(rawBackup = {}, fallbackWorkspaceId = 'local-user') {
  const backup = normalizeWorkspaceBackup(rawBackup, fallbackWorkspaceId)
  return {
    backupVersion: backup.backupVersion,
    exportedAt: backup.exportedAt,
    sourceWorkspaceId: backup.sourceWorkspaceId,
    tasks: backup.tasks.length,
    habits: backup.habits.length,
    sessions: backup.sessions.length,
    ambient: backup.ambient.length,
    media: backup.media.length,
    browserEvents: backup.browserEvents.length,
    customRules: Object.keys(backup.customRules || {}).length,
    insights: backup.insightCache.insights.length,
    hasTrackingHistory: backup.ambient.length > 0 || backup.media.length > 0 || backup.browserEvents.length > 0,
    hasCloudSyncState: Boolean(backup.workspace.syncState.lastSyncedAt || backup.workspace.syncState.lastRemoteUpdatedAt),
  }
}

export function buildWorkspaceBackupFilename(dateKey = 'today', workspaceId = 'workspace') {
  const safeWorkspaceId = normalizeString(workspaceId, 'workspace')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'workspace'
  return `velance-backup-${safeWorkspaceId}-${dateKey}.json`
}
