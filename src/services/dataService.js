import {
  clearInsightCacheMirror,
  clearLocalMirror,
  deleteHabitMirror,
  deleteSessionMirror,
  deleteSessionsByHabitMirror,
  deleteTaskMirror,
  pruneLocalMirror,
  readLocalMirrorSnapshot,
  upsertHabitMirror,
  upsertSessionMirror,
  upsertTaskMirror,
  writeInsightCacheMirror,
  writeLocalMirrorSnapshot,
  writeProfileMirror,
  writeSettingsMirror,
} from './localDataMirror.js'
import { resolveWorkspaceId } from './workspaceIdentity.js'
import { normalizeWorkspaceBackup } from './workspaceBackup.js'

function resolveFallbackValue(value) {
  return typeof value === 'function' ? value() : value
}

async function invokeData(methodName, payload, fallbackValue) {
  const method = window.velance?.data?.[methodName]
  if (!method) return resolveFallbackValue(fallbackValue)

  try {
    return await method(payload)
  } catch (error) {
    console.warn(`[Velance] Data bridge call failed for ${methodName}:`, error)
    return resolveFallbackValue(fallbackValue)
  }
}

export function getCurrentWorkspaceId(user = null) {
  return resolveWorkspaceId(user)
}

export function getCurrentUserId(user = null) {
  return getCurrentWorkspaceId(user)
}

export async function getBootstrapData(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  const snapshot = readLocalMirrorSnapshot(workspaceId)
  return invokeData('getBootstrap', { userId: workspaceId }, () => ({
    backend: {
      kind: 'degraded',
      available: false,
      message: 'Electron data bridge unavailable, using local recovery snapshot.',
    },
    workspace: {
      id: workspaceId,
      migrationCompleted: true,
      migratedAt: 0,
      syncState: {
        dirty: false,
        dirtySince: 0,
        lastSyncedAt: 0,
        lastRemoteUpdatedAt: 0,
        lastLocalUpdatedAt: 0,
        lastError: '',
        conflictDetectedAt: 0,
        pendingReason: '',
      },
    },
    profile: snapshot.profile ?? {},
    settings: snapshot.settings ?? {},
    tasks: snapshot.tasks ?? [],
    habits: snapshot.habits ?? [],
    sessions: snapshot.sessions ?? [],
    insightCache: snapshot.insightCache ?? { insights: [], generatedAt: 0 },
  }))
}

function writeCustomRulesFallback(customRules, workspaceId) {
  try {
    localStorage.setItem(`velance_custom_rules:${workspaceId}`, JSON.stringify(customRules && typeof customRules === 'object' ? customRules : {}))
  } catch {
  }
}

function readCustomRulesFallback(workspaceId) {
  try {
    const raw = localStorage.getItem(`velance_custom_rules:${workspaceId}`)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export async function exportWorkspaceBackup(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  const snapshot = readLocalMirrorSnapshot(workspaceId)
  return invokeData('exportWorkspaceBackup', { userId: workspaceId }, () => normalizeWorkspaceBackup({
    exportedAt: new Date().toISOString(),
    sourceWorkspaceId: workspaceId,
    backendKind: 'degraded',
    workspace: {
      id: workspaceId,
      migrationCompleted: true,
      migratedAt: 0,
      syncState: {
        dirty: false,
        dirtySince: 0,
        lastSyncedAt: 0,
        lastRemoteUpdatedAt: 0,
        lastLocalUpdatedAt: 0,
        lastError: '',
        conflictDetectedAt: 0,
        pendingReason: '',
      },
    },
    profile: snapshot.profile ?? {},
    settings: snapshot.settings ?? {},
    tasks: snapshot.tasks ?? [],
    habits: snapshot.habits ?? [],
    sessions: snapshot.sessions ?? [],
    customRules: readCustomRulesFallback(workspaceId),
    insightCache: snapshot.insightCache ?? { insights: [], generatedAt: 0 },
  }, workspaceId))
}

export async function restoreWorkspaceBackup(backup, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  const normalizedBackup = normalizeWorkspaceBackup(backup, workspaceId)

  return invokeData('restoreWorkspaceBackup', { userId: workspaceId, backup: normalizedBackup }, () => {
    writeLocalMirrorSnapshot({
      profile: normalizedBackup.profile,
      settings: normalizedBackup.settings,
      tasks: normalizedBackup.tasks,
      habits: normalizedBackup.habits,
      sessions: normalizedBackup.sessions,
      insightCache: normalizedBackup.insightCache,
    }, workspaceId)
    writeCustomRulesFallback(normalizedBackup.customRules, workspaceId)
    return {
      backend: {
        kind: 'degraded',
        available: false,
        message: 'Workspace backup restored into local recovery storage.',
      },
      workspace: {
        id: workspaceId,
        migrationCompleted: Boolean(normalizedBackup.workspace?.migrationCompleted),
        migratedAt: Number(normalizedBackup.workspace?.migratedAt || 0),
        syncState: {
          dirty: true,
          dirtySince: Date.now(),
          lastSyncedAt: Number(normalizedBackup.workspace?.syncState?.lastSyncedAt || 0),
          lastRemoteUpdatedAt: Number(normalizedBackup.workspace?.syncState?.lastRemoteUpdatedAt || 0),
          lastLocalUpdatedAt: Date.now(),
          lastError: '',
          conflictDetectedAt: 0,
          pendingReason: 'restore-import',
        },
      },
      profile: normalizedBackup.profile,
      settings: normalizedBackup.settings,
      tasks: normalizedBackup.tasks,
      habits: normalizedBackup.habits,
      sessions: normalizedBackup.sessions,
      insightCache: normalizedBackup.insightCache,
    }
  })
}

export async function saveProfile(profile, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('saveProfile', { userId: workspaceId, profile }, () => writeProfileMirror(profile, workspaceId))
}

export async function saveSyncState(syncState, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('saveSyncState', { userId: workspaceId, syncState }, () => ({
    dirty: Boolean(syncState?.dirty),
    dirtySince: Number(syncState?.dirtySince || 0),
    lastSyncedAt: Number(syncState?.lastSyncedAt || 0),
    lastRemoteUpdatedAt: Number(syncState?.lastRemoteUpdatedAt || 0),
    lastLocalUpdatedAt: Number(syncState?.lastLocalUpdatedAt || 0),
    lastError: String(syncState?.lastError || ''),
    conflictDetectedAt: Number(syncState?.conflictDetectedAt || 0),
    pendingReason: String(syncState?.pendingReason || ''),
  }))
}

export async function replaceSyncSnapshot(snapshot, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  const normalizedSnapshot = {
    profile: snapshot?.profile ?? {},
    settings: snapshot?.settings ?? {},
    tasks: Array.isArray(snapshot?.tasks) ? snapshot.tasks : [],
    habits: Array.isArray(snapshot?.habits) ? snapshot.habits : [],
    sessions: Array.isArray(snapshot?.sessions) ? snapshot.sessions : [],
    insightCache: snapshot?.insightCache ?? { insights: [], generatedAt: 0 },
    customRules: snapshot?.customRules ?? {},
  }

  return invokeData('replaceSyncSnapshot', { userId: workspaceId, snapshot: normalizedSnapshot }, () => {
    writeLocalMirrorSnapshot({
      profile: normalizedSnapshot.profile,
      settings: normalizedSnapshot.settings,
      tasks: normalizedSnapshot.tasks,
      habits: normalizedSnapshot.habits,
      sessions: normalizedSnapshot.sessions,
      insightCache: normalizedSnapshot.insightCache,
    }, workspaceId)
    writeCustomRulesFallback(normalizedSnapshot.customRules, workspaceId)
    return {
      backend: {
        kind: 'degraded',
        available: false,
        message: 'Workspace snapshot restored into local recovery storage.',
      },
      workspace: {
        id: workspaceId,
        migrationCompleted: true,
        migratedAt: 0,
        syncState: {
          dirty: false,
          dirtySince: 0,
          lastSyncedAt: 0,
          lastRemoteUpdatedAt: 0,
          lastLocalUpdatedAt: 0,
          lastError: '',
          conflictDetectedAt: 0,
          pendingReason: '',
        },
      },
      profile: normalizedSnapshot.profile,
      settings: normalizedSnapshot.settings,
      tasks: normalizedSnapshot.tasks,
      habits: normalizedSnapshot.habits,
      sessions: normalizedSnapshot.sessions,
      insightCache: normalizedSnapshot.insightCache,
    }
  })
}

export async function saveSettings(settings, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('saveSettings', { userId: workspaceId, settings }, () => writeSettingsMirror(settings, workspaceId))
}

export async function markLegacyMigrationComplete(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('markLegacyMigrationComplete', { userId: workspaceId }, () => ({
    id: workspaceId,
    migrationCompleted: true,
    migratedAt: Date.now(),
  }))
}

export async function syncRuntimePolicy(settings, user = null) {
  const applyPolicy = window.velance?.runtime?.applyPolicy
  if (!applyPolicy) return null

  try {
    return await applyPolicy({
      userId: getCurrentWorkspaceId(user),
      settings,
    })
  } catch (error) {
    console.warn('[Velance] Failed to sync runtime policy:', error)
    return null
  }
}

export async function getBrowserBridgeStatus() {
  const getStatus = window.velance?.runtime?.getBrowserBridgeStatus
  if (!getStatus) {
    return {
      ready: false,
      connected: false,
      captureEnabled: false,
      captureHosts: true,
      captureTitles: true,
      captureAudioTitles: true,
      telemetryEnabled: false,
      lastEventType: '',
      lastBrowserApp: '',
      lastHost: '',
      lastTitle: '',
      lastAudibleHost: '',
      lastExtensionVersion: '',
      receivedEvents: 0,
      audibleEvents: 0,
      ignoredEvents: 0,
      lastError: 'Electron runtime bridge unavailable',
    }
  }

  try {
    return await getStatus()
  } catch (error) {
    console.warn('[Velance] Failed to load browser bridge status:', error)
    return {
      ready: false,
      connected: false,
      captureEnabled: false,
      captureHosts: true,
      captureTitles: true,
      captureAudioTitles: true,
      telemetryEnabled: false,
      lastEventType: '',
      lastBrowserApp: '',
      lastHost: '',
      lastTitle: '',
      lastAudibleHost: '',
      lastExtensionVersion: '',
      receivedEvents: 0,
      audibleEvents: 0,
      ignoredEvents: 0,
      lastError: error?.message || 'Unable to read browser bridge status',
    }
  }
}

export async function saveTask(task, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('upsertTask', { userId: workspaceId, task }, () => upsertTaskMirror(task, workspaceId))
}

export async function deleteTask(taskId, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('deleteTask', { userId: workspaceId, taskId }, () => deleteTaskMirror(taskId, workspaceId))
}

export async function saveHabit(habit, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('upsertHabit', { userId: workspaceId, habit }, () => upsertHabitMirror(habit, workspaceId))
}

export async function deleteHabit(habitId, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('deleteHabit', { userId: workspaceId, habitId }, () => deleteHabitMirror(habitId, workspaceId))
}

export async function saveSession(session, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('upsertSession', { userId: workspaceId, session }, () => upsertSessionMirror(session, workspaceId))
}

export async function deleteSession(sessionId, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('deleteSession', { userId: workspaceId, sessionId }, () => deleteSessionMirror(sessionId, workspaceId))
}

export async function deleteSessionsByHabit(habitName, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('deleteSessionsByHabit', { userId: workspaceId, habitName }, () => deleteSessionsByHabitMirror(habitName, workspaceId))
}

export async function getAmbientRange(dateKeys, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('getAmbientRange', { userId: workspaceId, dateKeys }, [])
}

export async function getMediaRange(dateKeys, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('getMediaRange', { userId: workspaceId, dateKeys }, [])
}

export async function getBrowserEventRange(dateKeys, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('getBrowserEventRange', { userId: workspaceId, dateKeys }, [])
}

export async function getCombinedTrackingRange(dateKeys, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('getCombinedTrackingRange', { userId: workspaceId, dateKeys }, async () => ({
    ambient: await getAmbientRange(dateKeys, user),
    media: await getMediaRange(dateKeys, user),
    browserEvents: await getBrowserEventRange(dateKeys, user),
  }))
}

export async function saveAmbientEntry(entry, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('upsertAmbientEntry', { userId: workspaceId, entry }, [])
}

export async function saveMediaEntry(entry, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('upsertMediaEntry', { userId: workspaceId, entry }, [])
}

export async function saveBrowserEvent(entry, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('upsertBrowserEvent', { userId: workspaceId, entry }, [])
}

export async function getCustomRulesData(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('getCustomRules', { userId: workspaceId }, {})
}

export async function saveCustomRule(matchText, rule, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('upsertCustomRule', { userId: workspaceId, matchText, rule }, {})
}

export async function deleteCustomRuleData(matchText, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('deleteCustomRule', { userId: workspaceId, matchText }, {})
}

export async function saveInsightCache(insights, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('saveInsightCache', { userId: workspaceId, insights }, () => writeInsightCacheMirror(insights, Date.now(), workspaceId))
}

export async function getInsightFeedback(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('getInsightFeedback', { userId: workspaceId }, [])
}

export async function saveInsightFeedback(feedback, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('saveInsightFeedback', { userId: workspaceId, feedback }, [])
}

export async function clearInsightCache(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('clearInsightCache', { userId: workspaceId }, () => clearInsightCacheMirror(workspaceId))
}

export async function pruneExpiredData(retentionDays, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('pruneExpiredData', { userId: workspaceId, retentionDays }, () => pruneLocalMirror(retentionDays, workspaceId))
}

export async function clearAllData(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('clearAll', { userId: workspaceId }, () => {
    clearLocalMirror(workspaceId)
    const snapshot = readLocalMirrorSnapshot(workspaceId)
    return {
      backend: {
        kind: 'degraded',
        available: false,
        message: 'Workspace reset in local recovery storage.',
      },
      workspace: {
        id: workspaceId,
        migrationCompleted: true,
        migratedAt: 0,
        syncState: {
          dirty: false,
          dirtySince: 0,
          lastSyncedAt: 0,
          lastRemoteUpdatedAt: 0,
          lastLocalUpdatedAt: 0,
          lastError: '',
          conflictDetectedAt: 0,
          pendingReason: '',
        },
      },
      profile: snapshot.profile ?? {},
      settings: snapshot.settings ?? {},
      tasks: snapshot.tasks ?? [],
      habits: snapshot.habits ?? [],
      sessions: snapshot.sessions ?? [],
      insightCache: snapshot.insightCache ?? { insights: [], generatedAt: 0 },
    }
  })
}

export async function reclassifyTrackingHistory(user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  return invokeData('reclassifyTrackingHistory', { userId: workspaceId }, null)
}

export async function explainDailyAnalysis(context, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  const explain = window.velance?.analysis?.explainDay
  if (!explain) {
    return { ok: false, reason: 'no_bridge' }
  }

  try {
    return await explain({ userId: workspaceId, context })
  } catch (error) {
    console.warn('[Velance] Daily analysis bridge failed:', error)
    return {
      ok: false,
      reason: 'generation_failed',
      message: error?.message || 'Failed to generate daily analysis',
    }
  }
}

export async function testAiConnection(settings = {}, user = null) {
  const workspaceId = getCurrentWorkspaceId(user)
  const test = window.velance?.ai?.test
  if (!test) {
    return {
      ok: false,
      reason: 'no_bridge',
      message: 'This build does not expose the AI test bridge.',
    }
  }

  try {
    return await test({ userId: workspaceId, settings })
  } catch (error) {
    console.warn('[Velance] AI test bridge failed:', error)
    return {
      ok: false,
      reason: 'test_failed',
      message: error?.message || 'AI connection test failed',
    }
  }
}
