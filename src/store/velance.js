import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  clearAllData as clearAllDataRecord,
  clearInsightCache as clearInsightCacheRecord,
  deleteHabit as deleteHabitRecord,
  deleteSession as deleteSessionRecord,
  deleteSessionsByHabit as deleteSessionsByHabitRecord,
  deleteTask as deleteTaskRecord,
  exportWorkspaceBackup as exportWorkspaceBackupRecord,
  getBootstrapData,
  getCurrentWorkspaceId,
  getCustomRulesData,
  markLegacyMigrationComplete as markLegacyMigrationCompleteRecord,
  pruneExpiredData as pruneExpiredDataRecord,
  replaceSyncSnapshot as replaceSyncSnapshotRecord,
  reclassifyTrackingHistory as reclassifyTrackingHistoryRecord,
  restoreWorkspaceBackup as restoreWorkspaceBackupRecord,
  saveHabit as saveHabitRecord,
  saveInsightCache as saveInsightCacheRecord,
  getInsightFeedback as getInsightFeedbackRecord,
  saveInsightFeedback as saveInsightFeedbackRecord,
  saveProfile as saveProfileRecord,
  saveSession as saveSessionRecord,
  saveSettings as saveSettingsRecord,
  saveSyncState as saveSyncStateRecord,
  saveTask as saveTaskRecord,
  syncRuntimePolicy as syncRuntimePolicyRecord,
} from '../services/dataService.js'
import {
  createInitialSyncMeta,
  createInitialSyncStatus,
  normalizeSyncMeta,
  normalizeSyncSnapshot,
  syncWorkspaceSnapshot,
} from '../services/cloudSyncService.js'
import {
  getAverageFocusForRange,
  getAverageFocusToday,
  getCurrentFatigueRisk,
  getDistractionTotal,
  getFocusMinutesToday,
  getFocusTrend,
  getHabitCompletionStats,
  getHabitAverageFocus,
  getHabitHeatmap,
  getHabitSessions,
  getHabitStreak,
  getHabitStreakWithCredits,
  getHabitTotalMinutesForDate,
  getHabitTotalMinutes,
  getPeakHours,
  getSessionAppBreakdown,
  getSessionCount,
  getSessionsInRange,
  getSuggestedTask,
  getTotalFocusMinutes,
} from '../services/analyticsService.js'
import { getRecentLocalDateKeys, getTodayLocalDateKey } from '../services/dateKey.js'
import { buildInsightContext as buildInsightContextRecord } from '../services/insightContext.js'
import { isDefaultWorkspaceId } from '../services/workspaceIdentity.js'
import { normalizeAiModel, normalizeAiProvider } from '../services/aiProvider.js'
import { TRACKING_CONSENT_VERSION, hasTrackingConsent } from '../services/trackingConsent.js'
import { applyTrackingConsentDecision, writeTrackingConsentFallback } from '../services/trackingConsentState.js'
import {
  clearInsightCacheMirror,
  clearLegacyGlobalMirror,
  clearLocalMirror,
  hasLegacyGlobalMirrorData,
  pruneLocalMirror,
  readLegacyLocalMirrorSnapshot,
  readLocalMirrorSnapshot,
  writeHabitsMirror,
  writeInsightCacheMirror,
  writeLocalMirrorSnapshot,
  writeSessionsMirror,
  writeSettingsMirror,
  writeTasksMirror,
} from '../services/localDataMirror.js'

const DEFAULT_PROFILE = {
  name: 'User',
  role: 'Professional',
  goal: 'productivity',
  avatar: null,
  setupComplete: false,
  workingHours: '',
}

const DEFAULT_SETTINGS = {
  isDark: false,
  trackingEnabled: true,
  keystrokeEnabled: true,
  mouseEnabled: true,
  notificationsEnabled: true,
  breakReminders: true,
  breakIntervalMinutes: 90,
  dataRetentionDays: 90,
  aiProvider: 'gemini',
  aiModel: 'gemini-3-flash-preview',
  aiBaseUrl: '',
  aiInsightsEnabled: true,
  aiLastTestedAt: 0,
  aiLastTestOk: false,
  aiLastTestMessage: '',
  geminiApiKey: '',
  aiKeyProvider: '',
  hasAiApiKey: false,
  aiKeyPreview: '',
  aiKeyStorage: 'none',
  browserExtensionEnabled: false,
  browserCaptureHosts: true,
  browserCaptureTitles: false,
  browserCaptureAudioTitles: false,
  trackingConsentGranted: false,
  trackingConsentVersion: 0,
  trackingConsentAt: 0,
}

const DEFAULT_BACKEND_STATUS = {
  kind: 'unknown',
  available: false,
  message: '',
}

function normalizeSubtasks(subtasks = []) {
  return (Array.isArray(subtasks) ? subtasks : [])
    .map((subtask, index) => {
      const title = String(subtask?.title || '').trim()
      if (!title) return null
      return {
        id: subtask?.id || `subtask-${Date.now()}-${index}`,
        title,
        completed: Boolean(subtask?.completed),
        createdAt: Number(subtask?.createdAt || Date.now()),
        updatedAt: Number(subtask?.updatedAt || subtask?.createdAt || Date.now()),
        order: Number.isFinite(Number(subtask?.order)) ? Number(subtask.order) : index,
      }
    })
    .filter(Boolean)
    .sort((left, right) => (left.order || 0) - (right.order || 0))
}

function normalizeTaskPayload(task = {}) {
  return {
    ...task,
    parentId: task.parentId ?? task.parent_id ?? null,
    order: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
    desc: task.desc ?? '',
    status: task.status ?? 'to-do',
    priority: task.priority ?? 'Normal',
    habit: task.habit ?? '',
    due: task.due ?? null,
    reminderDate: task.reminderDate ?? task.due ?? null,
    reminderTime: task.reminderTime ?? task.reminder ?? '',
    subtasks: normalizeSubtasks(task.subtasks),
  }
}

function sortByCreatedDesc(items = []) {
  return [...items].sort((left, right) => (right?.createdAt ?? 0) - (left?.createdAt ?? 0))
}

function mergeProfile(profile = {}) {
  return {
    ...DEFAULT_PROFILE,
    ...(profile || {}),
  }
}

function mergeSettings(settings = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
  }
  merged.aiProvider = normalizeAiProvider(merged.aiProvider)
  merged.aiModel = normalizeAiModel(merged.aiProvider, merged.aiModel)
  return merged
}

function mergePersistedSettingsMeta(optimistic = {}, persisted = {}) {
  const persistedMeta = {}
  ;[
    'hasAiApiKey',
    'aiKeyPreview',
    'aiKeyStorage',
    'geminiApiKey',
    'aiKeyProvider',
    'aiProvider',
    'aiModel',
    'aiBaseUrl',
    'aiLastTestedAt',
    'aiLastTestOk',
    'aiLastTestMessage',
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(persisted || {}, key)) persistedMeta[key] = persisted[key]
  })

  const merged = mergeSettings({
    ...optimistic,
    ...persistedMeta,
  })
  delete merged.clearAiApiKey
  return merged
}

function buildOptimisticSession(payload = {}) {
  const timestamp = payload.timestamp ?? Date.now()
  return {
    id: payload.id ?? `session-${timestamp}`,
    date: payload.date ?? getTodayLocalDateKey(),
    timestamp,
    createdAt: payload.createdAt ?? timestamp,
    ...payload,
  }
}

export const useVelanceStore = defineStore('velance', () => {
  const currentWorkspaceId = ref(getCurrentWorkspaceId())
  const hasHydrated = ref(false)
  const isHydrating = ref(false)
  const hydratedWorkspaceId = ref(null)
  const backendStatus = ref({ ...DEFAULT_BACKEND_STATUS })
  const syncStatus = ref(createInitialSyncStatus())
  const syncMeta = ref(createInitialSyncMeta())
  const migrationStatus = ref({
    completed: false,
    migratedAt: 0,
  })

  const initialMirror = readLocalMirrorSnapshot(currentWorkspaceId.value)

  const userProfile = ref(mergeProfile(initialMirror.profile))
  const settings = ref(mergeSettings(initialMirror.settings))
  const tasks = ref(initialMirror.tasks ?? [])
  const habits = ref(initialMirror.habits ?? [])
  const sessions = ref(initialMirror.sessions ?? [])
  const cachedInsights = ref(initialMirror.insightCache?.insights ?? [])
  const insightsCachedAt = ref(initialMirror.insightCache?.generatedAt ?? 0)
  const insightFeedback = ref([])

  function replaceSettings(next = {}) {
    const merged = mergeSettings(next)
    Object.keys(settings.value).forEach((key) => {
      if (!(key in merged)) delete settings.value[key]
    })
    Object.assign(settings.value, merged)
    return settings.value
  }

  const nextTaskId = ref(1)
  const nextHabitId = ref(1)
  let syncTimer = null
  let syncInFlight = false
  let queuedSyncRequest = null
  let syncContextVersion = 0
  const pendingConflictSnapshot = ref(null)

  function refreshWorkspaceId(user = null) {
    currentWorkspaceId.value = getCurrentWorkspaceId(user)
    return currentWorkspaceId.value
  }

  function syncTaskIds() {
    nextTaskId.value = tasks.value.length ? Math.max(...tasks.value.map((task) => task.id)) + 1 : 1
  }

  function syncHabitIds() {
    nextHabitId.value = habits.value.length ? Math.max(...habits.value.map((habit) => habit.id)) + 1 : 1
  }

  function syncLocalMirror() {
    writeLocalMirrorSnapshot({
      profile: userProfile.value,
      settings: settings.value,
      tasks: tasks.value,
      habits: habits.value,
      sessions: sessions.value,
      insightCache: {
        insights: cachedInsights.value,
        generatedAt: insightsCachedAt.value,
      },
    }, currentWorkspaceId.value)
  }

  function beginSyncContext() {
    syncContextVersion += 1
    clearSyncTimer()
    queuedSyncRequest = null
    pendingConflictSnapshot.value = null
    return syncContextVersion
  }

  function isCurrentSyncContext(workspaceId, contextVersion) {
    return workspaceId === currentWorkspaceId.value && contextVersion === syncContextVersion
  }

  function applySyncMeta(nextMeta = {}, { persist = false } = {}) {
    const normalized = normalizeSyncMeta(nextMeta)
    syncMeta.value = normalized
    if (persist) {
      void saveSyncStateRecord(normalized, currentWorkspaceId.value).catch((error) => {
        console.warn('[Velance] Failed to persist sync state:', error)
      })
    }
    return normalized
  }

  async function persistSyncMeta(nextMeta = {}, workspaceId = currentWorkspaceId.value) {
    const normalized = normalizeSyncMeta(nextMeta)
    if (workspaceId === currentWorkspaceId.value) {
      syncMeta.value = normalized
    }
    try {
      const persisted = await saveSyncStateRecord(normalized, workspaceId)
      if (workspaceId === currentWorkspaceId.value) {
        syncMeta.value = normalizeSyncMeta(persisted)
      }
    } catch (error) {
      console.warn('[Velance] Failed to persist sync state:', error)
    }
    return normalized
  }

  function markSyncDirty(reason = 'save', workspaceId = currentWorkspaceId.value) {
    if (isDefaultWorkspaceId(workspaceId)) {
      setLocalOnlySyncStatus()
      return
    }

    const now = Date.now()
    const baseMeta = workspaceId === currentWorkspaceId.value ? syncMeta.value : createInitialSyncMeta()
    void persistSyncMeta({
      ...baseMeta,
      dirty: true,
      dirtySince: baseMeta.dirty ? baseMeta.dirtySince || now : now,
      lastLocalUpdatedAt: now,
      lastError: '',
      conflictDetectedAt: 0,
      pendingReason: reason,
    }, workspaceId)
  }

  function clearSyncTimer() {
    if (!syncTimer) return
    clearTimeout(syncTimer)
    syncTimer = null
  }

  function setLocalOnlySyncStatus(message = 'Sign in to keep saved data in sync across devices.') {
    syncMeta.value = createInitialSyncMeta()
    pendingConflictSnapshot.value = null
    syncStatus.value = createInitialSyncStatus({
      enabled: false,
      mode: 'local-only',
      label: 'Local only',
      message,
      pending: false,
    })
  }

  async function buildSyncSnapshot() {
    const customRules = await getCustomRulesData(currentWorkspaceId.value).catch(() => ({}))
    return normalizeSyncSnapshot({
      workspaceId: currentWorkspaceId.value,
      profile: userProfile.value,
      settings: settings.value,
      tasks: tasks.value,
      habits: habits.value,
      sessions: sessions.value,
      insightCache: {
        insights: cachedInsights.value,
        generatedAt: insightsCachedAt.value,
      },
      customRules,
    })
  }

  async function runCloudSync(reason = 'sync') {
    const workspaceId = currentWorkspaceId.value
    const contextVersion = syncContextVersion
    const requestSyncMeta = normalizeSyncMeta(syncMeta.value)

    if (isDefaultWorkspaceId(workspaceId)) {
      setLocalOnlySyncStatus()
      return syncStatus.value
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await persistSyncMeta({
        ...requestSyncMeta,
        dirty: true,
        dirtySince: requestSyncMeta.dirtySince || Date.now(),
        lastError: 'offline',
        pendingReason: reason,
      }, workspaceId)
      if (!isCurrentSyncContext(workspaceId, contextVersion)) {
        return createInitialSyncStatus({
          enabled: true,
          mode: 'offline',
          label: 'Offline',
          message: 'Local changes are safe on this device and will sync when the connection comes back.',
          pending: true,
          schemaReady: true,
        })
      }
      pendingConflictSnapshot.value = null
      syncStatus.value = createInitialSyncStatus({
        enabled: true,
        mode: 'offline',
        label: 'Offline',
        message: 'Local changes are safe on this device and will sync when the connection comes back.',
        pending: true,
        schemaReady: true,
        lastSyncedAt: requestSyncMeta.lastSyncedAt,
        lastRemoteUpdatedAt: requestSyncMeta.lastRemoteUpdatedAt,
      })
      return syncStatus.value
    }

    if (syncInFlight) {
      queuedSyncRequest = { reason, workspaceId, contextVersion }
      if (isCurrentSyncContext(workspaceId, contextVersion)) {
        syncStatus.value = {
          ...syncStatus.value,
          enabled: true,
          pending: true,
          label: 'Sync queued',
          message: 'Velance will sync your latest changes as soon as the current sync finishes.',
        }
        return syncStatus.value
      }
      return createInitialSyncStatus({
        enabled: true,
        mode: 'checking',
        label: 'Sync queued',
        message: 'Velance queued this workspace sync while another workspace transition was finishing.',
        pending: true,
        schemaReady: true,
      })
    }

    syncInFlight = true
    clearSyncTimer()
    syncStatus.value = {
      ...syncStatus.value,
      enabled: true,
      pending: false,
      mode: 'syncing',
      label: 'Syncing',
      message: 'Syncing saved data to your signed-in workspace.',
    }

    try {
      const snapshot = await buildSyncSnapshot()
      const result = await syncWorkspaceSnapshot(snapshot, {
        reason,
        syncMeta: requestSyncMeta,
      })

      if (result?.direction === 'pull' && result.remoteSnapshot) {
        await replaceSyncSnapshotRecord(result.remoteSnapshot, workspaceId)
        if (isCurrentSyncContext(workspaceId, contextVersion)) {
          const bootstrap = await getBootstrapData(workspaceId)
          applyBootstrap(bootstrap)
        }
        await persistSyncMeta({
          ...requestSyncMeta,
          dirty: false,
          dirtySince: 0,
          lastSyncedAt: Date.now(),
          lastRemoteUpdatedAt: result.remoteUpdatedAt || result.remoteSnapshot.snapshotUpdatedAt || 0,
          lastLocalUpdatedAt: result.remoteSnapshot.snapshotUpdatedAt || snapshot.snapshotUpdatedAt || 0,
          lastError: '',
          conflictDetectedAt: 0,
          pendingReason: '',
        }, workspaceId)
        if (isCurrentSyncContext(workspaceId, contextVersion)) {
          pendingConflictSnapshot.value = null
        }
      } else if (result?.direction === 'push' || result?.direction === 'noop') {
        await persistSyncMeta({
          ...requestSyncMeta,
          dirty: false,
          dirtySince: 0,
          lastSyncedAt: Date.now(),
          lastRemoteUpdatedAt: result.remoteUpdatedAt || snapshot.snapshotUpdatedAt || 0,
          lastLocalUpdatedAt: snapshot.snapshotUpdatedAt || requestSyncMeta.lastLocalUpdatedAt || 0,
          lastError: '',
          conflictDetectedAt: 0,
          pendingReason: '',
        }, workspaceId)
        if (isCurrentSyncContext(workspaceId, contextVersion)) {
          pendingConflictSnapshot.value = null
        }
      } else if (result?.direction === 'conflict') {
        if (isCurrentSyncContext(workspaceId, contextVersion)) {
          pendingConflictSnapshot.value = result.remoteSnapshot || null
        }
        await persistSyncMeta({
          ...requestSyncMeta,
          dirty: true,
          dirtySince: requestSyncMeta.dirtySince || Date.now(),
          lastRemoteUpdatedAt: result.remoteUpdatedAt || requestSyncMeta.lastRemoteUpdatedAt,
          lastLocalUpdatedAt: snapshot.snapshotUpdatedAt || requestSyncMeta.lastLocalUpdatedAt,
          lastError: 'conflict',
          conflictDetectedAt: Date.now(),
          pendingReason: reason,
        }, workspaceId)
      } else if (result?.direction === 'error') {
        await persistSyncMeta({
          ...requestSyncMeta,
          dirty: true,
          dirtySince: requestSyncMeta.dirtySince || Date.now(),
          lastLocalUpdatedAt: snapshot.snapshotUpdatedAt || requestSyncMeta.lastLocalUpdatedAt,
          lastError: result?.syncStatus?.mode || 'error',
          pendingReason: reason,
        }, workspaceId)
      }

      if (!isCurrentSyncContext(workspaceId, contextVersion)) {
        return result?.syncStatus || createInitialSyncStatus({
          enabled: true,
          mode: 'checking',
          label: 'Sync moved',
          message: 'Velance finished sync work for another workspace in the background.',
          pending: false,
          schemaReady: true,
        })
      }

      syncStatus.value = result?.syncStatus
        ? { ...syncStatus.value, ...result.syncStatus, pending: Boolean(result.syncStatus?.pending) }
        : createInitialSyncStatus({
            enabled: true,
            mode: 'error',
            label: 'Sync paused',
            message: 'Velance could not confirm cloud sync status.',
            pending: false,
          })
      return syncStatus.value
    } catch (error) {
      console.error('[Velance] Cloud sync failed:', error)
      await persistSyncMeta({
        ...requestSyncMeta,
        dirty: true,
        dirtySince: requestSyncMeta.dirtySince || Date.now(),
        lastError: error?.message || 'sync_failed',
        pendingReason: reason,
      }, workspaceId)
      if (!isCurrentSyncContext(workspaceId, contextVersion)) {
        return createInitialSyncStatus({
          enabled: true,
          mode: 'error',
          label: 'Sync paused',
          message: error?.message || 'Cloud sync failed for this workspace.',
          pending: true,
          schemaReady: true,
        })
      }
      syncStatus.value = createInitialSyncStatus({
        enabled: true,
        mode: 'error',
        label: 'Sync paused',
        message: error?.message || 'Cloud sync failed for this workspace.',
        pending: false,
      })
      return syncStatus.value
    } finally {
      syncInFlight = false
      if (queuedSyncRequest && isCurrentSyncContext(queuedSyncRequest.workspaceId, queuedSyncRequest.contextVersion)) {
        const nextReason = queuedSyncRequest.reason
        queuedSyncRequest = null
        queueCloudSync(nextReason, 1500)
      } else {
        queuedSyncRequest = null
      }
    }
  }

  function queueCloudSync(reason = 'save', delayMs = 1500) {
    const workspaceId = currentWorkspaceId.value
    const contextVersion = syncContextVersion

    if (isDefaultWorkspaceId(workspaceId)) {
      setLocalOnlySyncStatus()
      return
    }

    markSyncDirty(reason, workspaceId)
    clearSyncTimer()
    syncStatus.value = {
      ...syncStatus.value,
      enabled: true,
      pending: true,
      label: 'Sync queued',
      message: 'Latest saved changes are waiting to sync to your account.',
    }
    syncTimer = setTimeout(() => {
      syncTimer = null
      if (!isCurrentSyncContext(workspaceId, contextVersion)) return
      void runCloudSync(reason)
    }, delayMs)
  }

  function applyBootstrap(bootstrap = {}) {
    backendStatus.value = {
      ...DEFAULT_BACKEND_STATUS,
      ...(bootstrap.backend || {}),
    }
    if (bootstrap.workspace?.id) currentWorkspaceId.value = bootstrap.workspace.id
    migrationStatus.value = {
      completed: Boolean(bootstrap.workspace?.migrationCompleted),
      migratedAt: Number(bootstrap.workspace?.migratedAt || 0),
    }
    syncMeta.value = normalizeSyncMeta(bootstrap.workspace?.syncState || {})
    userProfile.value = mergeProfile(bootstrap.profile)
    replaceSettings(bootstrap.settings)
    tasks.value = sortByCreatedDesc((bootstrap.tasks ?? []).map((task) => normalizeTaskPayload(task)))
    habits.value = sortByCreatedDesc(bootstrap.habits ?? [])
    sessions.value = [...(bootstrap.sessions ?? [])].sort((left, right) => (right?.timestamp ?? 0) - (left?.timestamp ?? 0))
    cachedInsights.value = bootstrap.insightCache?.insights ?? []
    insightsCachedAt.value = bootstrap.insightCache?.generatedAt ?? 0
    syncTaskIds()
    syncHabitIds()
    syncLocalMirror()
  }

  async function refreshInsightFeedback() {
    try {
      insightFeedback.value = await getInsightFeedbackRecord(currentWorkspaceId.value)
    } catch (error) {
      console.warn('[Velance] Failed to load insight feedback:', error)
      insightFeedback.value = []
    }
    return insightFeedback.value
  }

  async function invalidateInsightsCache() {
    try {
      const cache = await clearInsightCacheRecord(currentWorkspaceId.value)
      cachedInsights.value = cache.insights ?? []
      insightsCachedAt.value = cache.generatedAt ?? 0
      clearInsightCacheMirror(currentWorkspaceId.value)
    } catch (error) {
      console.warn('[Velance] Failed to invalidate insights cache:', error)
      cachedInsights.value = []
      insightsCachedAt.value = 0
      clearInsightCacheMirror(currentWorkspaceId.value)
    }
  }

  async function saveProfile(data) {
    if (data) userProfile.value = mergeProfile({ ...userProfile.value, ...data, updatedAt: Date.now() })

    try {
      const persisted = await saveProfileRecord(userProfile.value, currentWorkspaceId.value)
      userProfile.value = mergeProfile(persisted)
    } catch (error) {
      console.error('[Velance] Failed to persist profile:', error)
    }

    syncLocalMirror()
    await invalidateInsightsCache()
    queueCloudSync('profile')
    return userProfile.value
  }

  async function syncRuntimePolicy() {
    await syncRuntimePolicyRecord(settings.value, currentWorkspaceId.value)
  }

  async function pruneExpiredData(retentionDays = settings.value.dataRetentionDays, { preserveSettings = false } = {}) {
    try {
      const bootstrap = await pruneExpiredDataRecord(retentionDays, currentWorkspaceId.value)
      if (bootstrap?.settings || bootstrap?.tasks || bootstrap?.sessions) {
        applyBootstrap({
          ...bootstrap,
          settings: preserveSettings ? { ...settings.value } : bootstrap.settings,
        })
      }
    } catch (error) {
      console.error('[Velance] Failed to prune expired local data:', error)
    } finally {
      pruneLocalMirror(retentionDays, currentWorkspaceId.value)
      syncTaskIds()
      syncHabitIds()
    }
  }

  async function saveSettings(options = {}) {
    const {
      sync = true,
      prune = true,
      syncRuntime = true,
    } = options || {}
    const savedNewAiKey = Boolean(String(settings.value.geminiApiKey || '').trim())
    const previousAiSignature = [
      settings.value.aiProvider || 'gemini',
      settings.value.aiModel || '',
      settings.value.aiBaseUrl || '',
      settings.value.aiInsightsEnabled === false ? 'local' : 'ai',
      settings.value.hasAiApiKey ? 'key' : 'no-key',
      String(settings.value.geminiApiKey || '').trim() ? 'new-key' : '',
      settings.value.clearAiApiKey ? 'clear-key' : '',
    ].join('|')
    const optimisticSettings = mergeSettings({ ...settings.value, updatedAt: Date.now() })
    replaceSettings(optimisticSettings)
    try {
      const persisted = await saveSettingsRecord(optimisticSettings, currentWorkspaceId.value)
      replaceSettings(mergePersistedSettingsMeta(optimisticSettings, persisted))
      writeSettingsMirror(settings.value, currentWorkspaceId.value)
    } catch (error) {
      console.error('[Velance] Failed to persist settings:', error)
      writeSettingsMirror(settings.value, currentWorkspaceId.value)
    }

    if (syncRuntime) await syncRuntimePolicy()
    if (prune) await pruneExpiredData(settings.value.dataRetentionDays, { preserveSettings: true })

    const currentAiSignature = [
      settings.value.aiProvider || 'gemini',
      settings.value.aiModel || '',
      settings.value.aiBaseUrl || '',
      settings.value.aiInsightsEnabled === false ? 'local' : 'ai',
      settings.value.hasAiApiKey ? 'key' : 'no-key',
      String(settings.value.geminiApiKey || '').trim() ? 'new-key' : '',
      settings.value.clearAiApiKey ? 'clear-key' : '',
    ].join('|')
    if (currentAiSignature !== previousAiSignature) {
      await invalidateInsightsCache()
    }

    if (savedNewAiKey && currentAiSignature !== previousAiSignature) {
      try {
        await reclassifyTrackingHistoryRecord(currentWorkspaceId.value)
      } catch (error) {
        console.warn('[Velance] Failed to reclassify tracking history after AI settings update:', error)
      }
    }

    if (sync) queueCloudSync('settings')
  }

  // Centralized, verified tracking-consent grant/revoke.
  // Used by the onboarding gate, Settings, and the focus-session block screen so
  // there is a single robust path that cannot leave a user silently stuck.
  async function setTrackingConsent(granted = true) {
    const at = Date.now()
    const decision = { resolved: true, granted: Boolean(granted), version: TRACKING_CONSENT_VERSION, at }

    // Apply to in-memory settings first so the UI unblocks immediately.
    applyTrackingConsentDecision(settings.value, decision)

    // Persist a local fallback keyed to this workspace. If a later hydrate reloads a
    // stale DB row, restoreLocalConsentDecision() can recover the choice from here.
    try { writeTrackingConsentFallback({ workspaceId: currentWorkspaceId.value, granted, at }) } catch {}

    // Persist to SQLite + push the runtime policy to the main process.
    await saveSettings()

    // Read-back verification: confirm the database actually stored the choice.
    // A slow/failed save previously left consent half-applied (true in memory,
    // false on disk) which silently blocked tracking after the next hydrate.
    try {
      const bootstrap = await getBootstrapData(currentWorkspaceId.value)
      const persisted = bootstrap?.settings || {}
      if (Boolean(persisted.trackingConsentGranted) !== Boolean(granted)) {
        applyTrackingConsentDecision(settings.value, decision)
        await saveSettings()
      }
    } catch (error) {
      console.warn('[Velance] Tracking consent read-back verification failed:', error)
    }

    return hasTrackingConsent(settings.value)
  }

  async function saveInsightFeedback(feedback) {
    try {
      insightFeedback.value = await saveInsightFeedbackRecord(feedback, currentWorkspaceId.value)
    } catch (error) {
      console.warn('[Velance] Failed to persist insight feedback:', error)
    }
    return insightFeedback.value
  }

  async function persistTask(task) {
    try {
      await saveTaskRecord(task, currentWorkspaceId.value)
      syncTaskIds()
      writeTasksMirror(tasks.value, currentWorkspaceId.value)
    } catch (error) {
      console.error('[Velance] Failed to persist task:', error)
      writeTasksMirror(tasks.value, currentWorkspaceId.value)
    }
    queueCloudSync('tasks')
  }

  async function addTask(data) {
    const task = {
      id: nextTaskId.value++,
      ...normalizeTaskPayload(data),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    tasks.value = [task, ...tasks.value]
    await persistTask(task)
  }

  async function updateTask(id, changes) {
    const index = tasks.value.findIndex((task) => task.id === id)
    if (index === -1) return

    tasks.value[index] = normalizeTaskPayload({
      ...tasks.value[index],
      ...changes,
      updatedAt: Date.now(),
    })
    await persistTask(tasks.value[index])
  }

  async function deleteTask(id) {
    const idsToDelete = [
      id,
      ...tasks.value
        .filter((task) => String(task.parentId ?? '') === String(id))
        .map((task) => task.id),
    ]

    tasks.value = tasks.value.filter((task) => !idsToDelete.some((deleteId) => String(task.id) === String(deleteId)))
    syncTaskIds()

    try {
      for (const deleteId of idsToDelete) {
        const numericId = Number.isFinite(Number(deleteId)) && String(deleteId).trim() !== '' ? Number(deleteId) : deleteId
        await deleteTaskRecord(numericId, currentWorkspaceId.value)
      }
      writeTasksMirror(tasks.value, currentWorkspaceId.value)
    } catch (error) {
      console.error('[Velance] Failed to delete task:', error)
      writeTasksMirror(tasks.value, currentWorkspaceId.value)
    }
    queueCloudSync('tasks')
  }

  async function completeTask(id) {
    await updateTask(id, { status: 'completed', completedAt: Date.now() })
  }

  async function persistHabit(habit) {
    try {
      await saveHabitRecord(habit, currentWorkspaceId.value)
      syncHabitIds()
      writeHabitsMirror(habits.value, currentWorkspaceId.value)
      await invalidateInsightsCache()
    } catch (error) {
      console.error('[Velance] Failed to persist habit:', error)
      writeHabitsMirror(habits.value, currentWorkspaceId.value)
    }
    queueCloudSync('habits')
  }

  async function addHabit(data) {
    const habit = {
      id: nextHabitId.value++,
      ...data,
      icon: data.icon ?? 'other',
      color: data.color ?? '#00B4D8',
      targetMinutes: data.targetMinutes ?? 60,
      manualMinutesByDate: data.manualMinutesByDate ?? {},
      skipDates: Array.isArray(data.skipDates) ? data.skipDates : [],
      reminderEnabled: Boolean(data.reminderEnabled),
      reminderFrequency: data.reminderFrequency || 'daily',
      reminderTime: data.reminderTime || '',
      reminderDays: Array.isArray(data.reminderDays) ? data.reminderDays : [],
      reminderLastFiredAt: data.reminderLastFiredAt ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    habits.value = [habit, ...habits.value]
    await persistHabit(habit)
  }

  async function updateHabit(id, changes) {
    const index = habits.value.findIndex((habit) => habit.id === id)
    if (index === -1) return

    habits.value[index] = {
      ...habits.value[index],
      ...changes,
      updatedAt: Date.now(),
    }
    await persistHabit(habits.value[index])
  }

  async function deleteHabit(id) {
    const numericId = Number.isFinite(Number(id)) && String(id).trim() !== '' ? Number(id) : id
    const habit = habits.value.find((entry) => String(entry.id) === String(id))
    if (habit) {
      sessions.value = sessions.value.filter((session) => session.habit !== habit.name)
      try {
        await deleteSessionsByHabitRecord(habit.name, currentWorkspaceId.value)
        writeSessionsMirror(sessions.value, currentWorkspaceId.value)
      } catch (error) {
        console.error('[Velance] Failed to delete habit sessions:', error)
        writeSessionsMirror(sessions.value, currentWorkspaceId.value)
      }
    }

    habits.value = habits.value.filter((entry) => String(entry.id) !== String(id))
    syncHabitIds()

    try {
      await deleteHabitRecord(numericId, currentWorkspaceId.value)
      writeHabitsMirror(habits.value, currentWorkspaceId.value)
      await invalidateInsightsCache()
    } catch (error) {
      console.error('[Velance] Failed to delete habit:', error)
      writeHabitsMirror(habits.value, currentWorkspaceId.value)
    }
    queueCloudSync('habits')
  }

  function findHabitById(id) {
    return habits.value.find((habit) => String(habit.id) === String(id)) || null
  }

  function findHabitByName(name = '') {
    const normalized = String(name || '').trim().toLowerCase()
    return habits.value.find((habit) => String(habit.name || '').trim().toLowerCase() === normalized) || null
  }

  function getHabitTodayMinutes(habitName) {
    const habit = findHabitByName(habitName)
    if (!habit) return 0
    return getHabitTotalMinutesForDate(sessions.value, habit, getTodayLocalDateKey())
  }

  function isHabitSkippedOnDate(habitId, dateKey = getTodayLocalDateKey()) {
    const habit = findHabitById(habitId)
    return Array.isArray(habit?.skipDates) && habit.skipDates.includes(dateKey)
  }

  async function addManualHabitMinutes(habitId, minutes = 15, dateKey = getTodayLocalDateKey()) {
    const habit = findHabitById(habitId)
    if (!habit) return
    const safeMinutes = Math.max(1, Math.min(720, Math.round(Number(minutes) || 0)))
    const manualMinutesByDate = {
      ...(habit.manualMinutesByDate || {}),
      [dateKey]: Math.max(0, Math.round(Number(habit.manualMinutesByDate?.[dateKey] || 0))) + safeMinutes,
    }
    const skipDates = (habit.skipDates || []).filter((date) => date !== dateKey)
    await updateHabit(habitId, { manualMinutesByDate, skipDates })
  }

  async function toggleHabitSkipDate(habitId, dateKey = getTodayLocalDateKey()) {
    const habit = findHabitById(habitId)
    if (!habit) return
    const skipDates = new Set(Array.isArray(habit.skipDates) ? habit.skipDates : [])
    if (skipDates.has(dateKey)) skipDates.delete(dateKey)
    else skipDates.add(dateKey)
    await updateHabit(habitId, { skipDates: [...skipDates].sort() })
  }

  async function persistSession(session) {
    try {
      await saveSessionRecord(session, currentWorkspaceId.value)
      writeSessionsMirror(sessions.value, currentWorkspaceId.value)
      await invalidateInsightsCache()
    } catch (error) {
      console.error('[Velance] Failed to persist session:', error)
      writeSessionsMirror(sessions.value, currentWorkspaceId.value)
    }
    queueCloudSync('sessions')
  }

  async function addSession(payload) {
    const session = buildOptimisticSession(payload)
    const existingIndex = sessions.value.findIndex((entry) => entry.id === session.id)
    if (existingIndex >= 0) sessions.value[existingIndex] = session
    else sessions.value = [session, ...sessions.value]
    await persistSession(session)
    return session
  }

  async function deleteSession(id) {
    sessions.value = sessions.value.filter((session) => session.id !== id)
    try {
      await deleteSessionRecord(id, currentWorkspaceId.value)
      writeSessionsMirror(sessions.value, currentWorkspaceId.value)
      await invalidateInsightsCache()
    } catch (error) {
      console.error('[Velance] Failed to delete session:', error)
      writeSessionsMirror(sessions.value, currentWorkspaceId.value)
    }
    queueCloudSync('sessions')
  }

  function getDaysRange(days) {
    return getRecentLocalDateKeys(days)
  }

  const last7Days = computed(() => getDaysRange(7))
  const last30Days = computed(() => getDaysRange(30))
  const last90Days = computed(() => getDaysRange(90))

  const todayTasks = computed(() => tasks.value.filter((task) => task.due === getTodayLocalDateKey()))
  const completedToday = computed(() => todayTasks.value.filter((task) => task.status === 'completed').length)
  const activeTasks = computed(() => tasks.value.filter((task) => task.status !== 'completed'))
  const suggestedTask = computed(() => getSuggestedTask(tasks.value, getTodayLocalDateKey()))
  const taskCompletionRate = computed(() => {
    const total = tasks.value.length
    const done = tasks.value.filter((task) => task.status === 'completed').length
    return total > 0 ? Math.round((done / total) * 100) : 0
  })

  const getSessionsForRange = (days) => getSessionsInRange(sessions.value, days)
  const getFocusTrendForDays = (days) => getFocusTrend(sessions.value, days)
  const focusTrendData = computed(() => getFocusTrendForDays(last7Days.value))
  const weeklyAvgFocus = computed(() => getAverageFocusForRange(sessions.value, last7Days.value))
  const getAvgFocusForRange = (days) => getAverageFocusForRange(sessions.value, days)
  const getTotalFocusMinutesForDays = (days) => getTotalFocusMinutes(sessions.value, days)
  const getSessionCountForDays = (days) => getSessionCount(sessions.value, days)
  const getDistractionTotalForDays = (days) => getDistractionTotal(sessions.value, days)
  const getAppBreakdown = (days) => getSessionAppBreakdown(sessions.value, days)
  const getPeakHoursForDays = (days) => getPeakHours(sessions.value, days)

  const totalSessionsToday = computed(() => sessions.value.filter((session) => session.date === getTodayLocalDateKey()).length)
  const distractionCount = computed(() => sessions.value
    .filter((session) => session.date === getTodayLocalDateKey())
    .reduce((sum, session) => sum + (session.distractions || 0), 0))

  const currentFatigueRisk = computed(() => getCurrentFatigueRisk(sessions.value, getTodayLocalDateKey()))
  const avgFocusToday = computed(() => getAverageFocusToday(sessions.value, getTodayLocalDateKey(), weeklyAvgFocus.value))
  const todayFocusMinutes = computed(() => getFocusMinutesToday(sessions.value, getTodayLocalDateKey()))

  const getHabitStreakForName = (habitName) => {
    const habit = findHabitByName(habitName)
    return habit ? getHabitStreakWithCredits(sessions.value, habit) : getHabitStreak(sessions.value, habitName)
  }
  const getHabitSessionsForName = (habitName) => getHabitSessions(sessions.value, habitName)
  const getHabitAvgFocus = (habitName) => getHabitAverageFocus(sessions.value, habitName)
  const getHabitTotalMinutesForName = (habitName) => getHabitTotalMinutes(sessions.value, habitName, findHabitByName(habitName))
  const getHabitHeatmapForName = (habitName, days = 90) => {
    if (habitName) return getHabitHeatmap(sessions.value, habitName, days, findHabitByName(habitName))
    return getHabitHeatmap(sessions.value, null, days)
  }
  const habitCompletionStats = computed(() => getHabitCompletionStats(habits.value, sessions.value, getTodayLocalDateKey()))

  async function cacheInsights(insights) {
    try {
      const cache = await saveInsightCacheRecord(insights, currentWorkspaceId.value)
      cachedInsights.value = cache.insights
      insightsCachedAt.value = cache.generatedAt
      writeInsightCacheMirror(cachedInsights.value, insightsCachedAt.value, currentWorkspaceId.value)
    } catch (error) {
      console.error('[Velance] Failed to persist insight cache:', error)
      cachedInsights.value = insights
      insightsCachedAt.value = Date.now()
      writeInsightCacheMirror(cachedInsights.value, insightsCachedAt.value, currentWorkspaceId.value)
    }
    queueCloudSync('insights')
  }

  async function clearInsightsCache() {
    try {
      const cache = await clearInsightCacheRecord(currentWorkspaceId.value)
      cachedInsights.value = cache.insights
      insightsCachedAt.value = cache.generatedAt
      clearInsightCacheMirror(currentWorkspaceId.value)
    } catch (error) {
      console.error('[Velance] Failed to clear insight cache:', error)
      cachedInsights.value = []
      insightsCachedAt.value = 0
      clearInsightCacheMirror(currentWorkspaceId.value)
    }
    queueCloudSync('insights')
  }

  async function clearAllLocalData() {
    try {
      const bootstrap = await clearAllDataRecord(currentWorkspaceId.value)
      applyBootstrap(bootstrap)
    } catch (error) {
      console.error('[Velance] Failed to clear local app data:', error)
      backendStatus.value = {
        kind: 'degraded',
        available: false,
        message: 'Workspace reset locally after a backend failure.',
      }
      userProfile.value = { ...DEFAULT_PROFILE }
      replaceSettings(DEFAULT_SETTINGS)
      tasks.value = []
      habits.value = []
      sessions.value = []
      cachedInsights.value = []
      insightsCachedAt.value = 0
      clearLocalMirror(currentWorkspaceId.value)
    }

    syncTaskIds()
    syncHabitIds()
    await syncRuntimePolicy()
    queueCloudSync('clear')
  }

  async function exportWorkspaceBackup() {
    return exportWorkspaceBackupRecord(currentWorkspaceId.value)
  }

  async function restoreWorkspaceBackup(backup) {
    beginSyncContext()
    pendingConflictSnapshot.value = null
    const bootstrap = await restoreWorkspaceBackupRecord(backup, currentWorkspaceId.value)
    applyBootstrap(bootstrap)
    await syncRuntimePolicy()

    if (isDefaultWorkspaceId(currentWorkspaceId.value)) {
      setLocalOnlySyncStatus('This workspace was restored from a local backup on this device.')
    } else {
      syncStatus.value = createInitialSyncStatus({
        enabled: true,
        mode: 'pending',
        label: 'Backup restored',
        message: 'Local backup restored. Review your data, then sync when you are ready.',
        pending: true,
        schemaReady: true,
        lastSyncedAt: syncMeta.value.lastSyncedAt,
        lastRemoteUpdatedAt: syncMeta.value.lastRemoteUpdatedAt,
      })
    }

    return bootstrap
  }

  async function reloadWorkspace(user = null) {
    await hydrate({ force: true, user })
  }

  function buildInsightContext(options = {}) {
    return buildInsightContextRecord({
      sessions: sessions.value,
      tasks: tasks.value,
      habits: habits.value,
      profile: userProfile.value,
      days: 7,
      ambientEntries: Array.isArray(options?.ambientEntries) ? options.ambientEntries : [],
      browserEvents: Array.isArray(options?.browserEvents) ? options.browserEvents : [],
    })
  }

  async function resolveSyncConflict(strategy = 'keep-local') {
    if (strategy === 'use-cloud' && pendingConflictSnapshot.value) {
      const remoteSnapshot = pendingConflictSnapshot.value
      await replaceSyncSnapshotRecord(remoteSnapshot, currentWorkspaceId.value)
      const bootstrap = await getBootstrapData(currentWorkspaceId.value)
      applyBootstrap(bootstrap)
      await persistSyncMeta({
        ...syncMeta.value,
        dirty: false,
        dirtySince: 0,
        lastSyncedAt: Date.now(),
        lastRemoteUpdatedAt: remoteSnapshot.snapshotUpdatedAt || syncMeta.value.lastRemoteUpdatedAt,
        lastLocalUpdatedAt: remoteSnapshot.snapshotUpdatedAt || syncMeta.value.lastLocalUpdatedAt,
        lastError: '',
        conflictDetectedAt: 0,
        pendingReason: '',
      })
      pendingConflictSnapshot.value = null
      syncStatus.value = createInitialSyncStatus({
        enabled: true,
        mode: 'synced',
        label: 'Restored',
        message: 'This device was restored from the newer cloud snapshot.',
        schemaReady: true,
        lastSyncedAt: syncMeta.value.lastSyncedAt,
        lastRemoteUpdatedAt: syncMeta.value.lastRemoteUpdatedAt,
      })
      return syncStatus.value
    }

    pendingConflictSnapshot.value = null
    return runCloudSync('force-push')
  }

  function workspaceHasMeaningfulData() {
    return Boolean(
      Object.keys(userProfile.value || {}).some((key) => key !== 'name' && key !== 'role' && key !== 'goal' && userProfile.value[key]) ||
      tasks.value.length ||
      habits.value.length ||
      sessions.value.length ||
      cachedInsights.value.length,
    )
  }

  async function importLegacyDataIfNeeded() {
    if (migrationStatus.value.completed) return false

    if (!hasLegacyGlobalMirrorData()) {
      const meta = await markLegacyMigrationCompleteRecord(currentWorkspaceId.value)
      migrationStatus.value = {
        completed: Boolean(meta?.migrationCompleted),
        migratedAt: Number(meta?.migratedAt || 0),
      }
      return false
    }

    if (workspaceHasMeaningfulData()) {
      const meta = await markLegacyMigrationCompleteRecord(currentWorkspaceId.value)
      migrationStatus.value = {
        completed: Boolean(meta?.migrationCompleted),
        migratedAt: Number(meta?.migratedAt || 0),
      }
      return false
    }

    const legacy = readLegacyLocalMirrorSnapshot()

    if (Object.keys(legacy.profile || {}).length) {
      await saveProfileRecord(mergeProfile(legacy.profile), currentWorkspaceId.value)
    }

    if (Object.keys(legacy.settings || {}).length) {
      await saveSettingsRecord(mergeSettings(legacy.settings), currentWorkspaceId.value)
    }

    for (const task of legacy.tasks ?? []) {
      await saveTaskRecord(task, currentWorkspaceId.value)
    }

    for (const habit of legacy.habits ?? []) {
      await saveHabitRecord({
        ...habit,
        icon: habit.icon ?? 'other',
      }, currentWorkspaceId.value)
    }

    for (const session of legacy.sessions ?? []) {
      await saveSessionRecord(buildOptimisticSession(session), currentWorkspaceId.value)
    }

    if (legacy.insightCache?.insights?.length) {
      await saveInsightCacheRecord(legacy.insightCache.insights, currentWorkspaceId.value)
    }

    const meta = await markLegacyMigrationCompleteRecord(currentWorkspaceId.value)
    migrationStatus.value = {
      completed: Boolean(meta?.migrationCompleted),
      migratedAt: Number(meta?.migratedAt || 0),
    }
    clearLegacyGlobalMirror()
    return true
  }

  async function hydrate({ force = false, user = null } = {}) {
    const workspaceId = refreshWorkspaceId(user)
    if (!force && hasHydrated.value && hydratedWorkspaceId.value === workspaceId) return
    if (isHydrating.value) return
    isHydrating.value = true
    beginSyncContext()
    if (isDefaultWorkspaceId(workspaceId)) {
      setLocalOnlySyncStatus()
    } else {
      syncStatus.value = createInitialSyncStatus({
        enabled: true,
        mode: 'checking',
        label: 'Checking sync',
        message: 'Velance is checking whether this account has a newer saved workspace snapshot.',
        pending: false,
      })
    }

    try {
      let bootstrap = await getBootstrapData(workspaceId)
      applyBootstrap(bootstrap)
      await refreshInsightFeedback()

      const migrated = await importLegacyDataIfNeeded()
      if (migrated) {
        bootstrap = await getBootstrapData(workspaceId)
        applyBootstrap(bootstrap)
        await refreshInsightFeedback()
      }

      await pruneExpiredData(settings.value.dataRetentionDays)
      await runCloudSync('hydrate')
      hydratedWorkspaceId.value = workspaceId
    } catch (error) {
      console.error('[Velance] Backend hydrate failed, using workspace recovery snapshot:', error)
      const mirror = readLocalMirrorSnapshot(workspaceId)
      applyBootstrap({
        backend: {
          kind: 'degraded',
          available: false,
          message: 'Workspace recovery snapshot loaded after a backend error.',
        },
        workspace: {
          id: workspaceId,
          migrationCompleted: true,
          migratedAt: 0,
        },
        profile: mirror.profile ?? {},
        settings: mirror.settings ?? {},
        tasks: mirror.tasks ?? [],
        habits: mirror.habits ?? [],
        sessions: mirror.sessions ?? [],
        insightCache: mirror.insightCache ?? { insights: [], generatedAt: 0 },
      })
      pruneLocalMirror(settings.value.dataRetentionDays, workspaceId)
      if (isDefaultWorkspaceId(workspaceId)) setLocalOnlySyncStatus()
      else {
        syncStatus.value = createInitialSyncStatus({
          enabled: true,
          mode: 'error',
          label: 'Sync unavailable',
          message: 'Velance restored local data, but cloud sync could not be checked right now.',
        })
      }
      hydratedWorkspaceId.value = workspaceId
    } finally {
      hasHydrated.value = true
      isHydrating.value = false
    }
  }

  return {
    hasHydrated,
    isHydrating,
    currentWorkspaceId,
    hydratedWorkspaceId,
    backendStatus,
    syncStatus,
    syncMeta,
    migrationStatus,
    hydrate,
    refreshWorkspaceId,
    runCloudSync,
    resolveSyncConflict,
    requestCloudSync: queueCloudSync,
    syncRuntimePolicy,
    pruneExpiredData,
    userProfile,
    saveProfile,
    settings,
    saveSettings,
    setTrackingConsent,
    tasks,
    todayTasks,
    completedToday,
    activeTasks,
    suggestedTask,
    taskCompletionRate,
    addTask,
    updateTask,
    deleteTask,
    completeTask,
    habits,
    addHabit,
    updateHabit,
    deleteHabit,
    addManualHabitMinutes,
    toggleHabitSkipDate,
    getHabitTodayMinutes,
    isHabitSkippedOnDate,
    getHabitStreak: getHabitStreakForName,
    getHabitSessions: getHabitSessionsForName,
    getHabitAvgFocus,
    getHabitTotalMinutes: getHabitTotalMinutesForName,
    getHabitHeatmap: getHabitHeatmapForName,
    habitCompletionStats,
    sessions,
    addSession,
    deleteSession,
    last7Days,
    last30Days,
    last90Days,
    getDaysRange,
    focusTrendData,
    weeklyAvgFocus,
    getAvgFocusForRange,
    getTotalFocusMinutes: getTotalFocusMinutesForDays,
    getSessionCount: getSessionCountForDays,
    getDistractionTotal: getDistractionTotalForDays,
    getAppBreakdown,
    getPeakHours: getPeakHoursForDays,
    getSessionsInRange: getSessionsForRange,
    getFocusTrend: getFocusTrendForDays,
    totalSessionsToday,
    distractionCount,
    currentFatigueRisk,
    avgFocusToday,
    todayFocusMinutes,
    cachedInsights,
    insightsCachedAt,
    insightFeedback,
    cacheInsights,
    clearInsightsCache,
    refreshInsightFeedback,
    saveInsightFeedback,
    clearAllLocalData,
    exportWorkspaceBackup,
    restoreWorkspaceBackup,
    reloadWorkspace,
    buildInsightContext,
  }
})
