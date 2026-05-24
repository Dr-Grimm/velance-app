import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import {
  TRACKING_CLASSIFICATION_VERSION,
  isBrowserShellRuleMatch,
  normalizeAmbientEntryPayload,
  normalizeBackgroundMediaPayload,
} from '../src/services/activityClassification.js'
import { normalizeBrowserEventEntry } from '../src/services/browserEventTracking.js'
import { normalizeWorkspaceBackup, WORKSPACE_BACKUP_VERSION } from '../src/services/workspaceBackup.js'
import { normalizeAiModel, normalizeAiProvider } from '../src/services/aiProvider.js'
import {
  publicSecretMeta,
  resolveStoredSecretForSave,
  revealSecret,
} from './secretStore.js'

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
  browserExtensionEnabled: false,
  browserCaptureHosts: true,
  browserCaptureTitles: false,
  browserCaptureAudioTitles: false,
  trackingConsentGranted: false,
  trackingConsentVersion: 0,
  trackingConsentAt: 0,
}

const DEFAULT_PROFILE = {
  name: 'User',
  role: 'Professional',
  goal: 'productivity',
  avatar: null,
  setupComplete: false,
  workingHours: '',
}

const DEFAULT_INSIGHT_CACHE = {
  insights: [],
  generatedAt: 0,
}

const DEFAULT_INSIGHT_FEEDBACK = []

const DEFAULT_SYNC_STATE = {
  dirty: false,
  dirtySince: 0,
  lastSyncedAt: 0,
  lastRemoteUpdatedAt: 0,
  lastLocalUpdatedAt: 0,
  lastError: '',
  conflictDetectedAt: 0,
  pendingReason: '',
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createEmptyUserState() {
  return {
    profile: { ...DEFAULT_PROFILE },
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    habits: [],
    sessions: [],
    ambient: [],
    media: [],
    browserEvents: [],
    customRules: {},
    insightCache: { ...DEFAULT_INSIGHT_CACHE },
    insightFeedback: [...DEFAULT_INSIGHT_FEEDBACK],
    syncState: { ...DEFAULT_SYNC_STATE },
    legacyMigrationCompleted: false,
    legacyMigratedAt: 0,
  }
}

function publicSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) }
  merged.aiProvider = normalizeAiProvider(merged.aiProvider)
  merged.aiModel = normalizeAiModel(merged.aiProvider, merged.aiModel)
  return {
    ...merged,
    ...publicSecretMeta(merged.geminiApiKey),
    aiKeyProvider: merged.aiKeyProvider || '',
  }
}

function privateSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) }
  merged.aiProvider = normalizeAiProvider(merged.aiProvider)
  merged.aiModel = normalizeAiModel(merged.aiProvider, merged.aiModel)
  const secret = revealSecret(merged.geminiApiKey)
  return {
    ...merged,
    geminiApiKey: secret,
    aiKeyProvider: merged.aiKeyProvider || '',
    hasAiApiKey: Boolean(secret),
    aiKeyPreview: '',
    aiKeyStorage: merged.geminiApiKey ? 'available' : 'none',
  }
}

function sortByCreatedDesc(items) {
  return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

function sortSessions(items) {
  return [...items].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
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

function normalizeTask(task) {
  return {
    id: task.id,
    parentId: task.parentId ?? task.parent_id ?? null,
    order: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
    title: task.title ?? '',
    desc: task.desc ?? '',
    status: task.status ?? 'to-do',
    priority: task.priority ?? 'Normal',
    habit: task.habit ?? '',
    due: task.due ?? null,
    reminderDate: task.reminderDate ?? task.due ?? null,
    reminderTime: task.reminderTime ?? task.reminder ?? '',
    subtasks: normalizeSubtasks(task.subtasks),
    completedAt: task.completedAt ?? null,
    createdAt: task.createdAt ?? Date.now(),
    updatedAt: task.updatedAt ?? Date.now(),
  }
}

function normalizeHabit(habit) {
  return {
    id: habit.id,
    name: habit.name ?? '',
    icon: habit.icon ?? 'other',
    color: habit.color ?? '#00B4D8',
    targetMinutes: habit.targetMinutes ?? 60,
    manualMinutesByDate: habit.manualMinutesByDate && typeof habit.manualMinutesByDate === 'object' && !Array.isArray(habit.manualMinutesByDate)
      ? habit.manualMinutesByDate
      : {},
    skipDates: Array.isArray(habit.skipDates) ? habit.skipDates : [],
    reminderEnabled: Boolean(habit.reminderEnabled),
    reminderFrequency: habit.reminderFrequency || 'daily',
    reminderTime: habit.reminderTime || '',
    reminderDays: Array.isArray(habit.reminderDays) ? habit.reminderDays : [],
    reminderLastFiredAt: habit.reminderLastFiredAt ?? 0,
    createdAt: habit.createdAt ?? Date.now(),
    updatedAt: habit.updatedAt ?? Date.now(),
  }
}

function normalizeProfile(profile = {}) {
  const role = String(profile?.role || DEFAULT_PROFILE.role)
  const goal = String(profile?.goal || DEFAULT_PROFILE.goal)
  const workingHours = String(profile?.workingHours || '')
  const hasMeaningfulProfile = Boolean(
    (role && role !== DEFAULT_PROFILE.role) ||
    (goal && goal !== DEFAULT_PROFILE.goal) ||
    workingHours,
  )

  return {
    ...DEFAULT_PROFILE,
    ...profile,
    name: String(profile?.name || DEFAULT_PROFILE.name),
    role,
    goal,
    avatar: profile?.avatar || null,
    setupComplete: Boolean(profile?.setupComplete || hasMeaningfulProfile),
    workingHours,
  }
}

function normalizeSyncState(syncState = {}) {
  return {
    ...DEFAULT_SYNC_STATE,
    ...syncState,
    dirty: Boolean(syncState?.dirty),
    dirtySince: Number(syncState?.dirtySince || 0),
    lastSyncedAt: Number(syncState?.lastSyncedAt || 0),
    lastRemoteUpdatedAt: Number(syncState?.lastRemoteUpdatedAt || 0),
    lastLocalUpdatedAt: Number(syncState?.lastLocalUpdatedAt || 0),
    lastError: String(syncState?.lastError || ''),
    conflictDetectedAt: Number(syncState?.conflictDetectedAt || 0),
    pendingReason: String(syncState?.pendingReason || ''),
  }
}

function normalizeSession(session) {
  const timestamp = session.timestamp ?? Date.now()
  return {
    id: session.id,
    date: session.date,
    timestamp,
    createdAt: session.createdAt ?? timestamp,
    taskTitle: session.taskTitle ?? null,
    habit: session.habit ?? null,
    linkedTaskId: session.linkedTaskId ?? null,
    linkedHabitId: session.linkedHabitId ?? null,
    sessionType: session.sessionType ?? null,
    goal: session.goal ?? null,
    durationSeconds: session.durationSeconds ?? 0,
    focusScore: session.focusScore ?? 0,
    keystrokesPerMin: session.keystrokesPerMin ?? 0,
    totalKeystrokes: session.totalKeystrokes ?? 0,
    totalMouseClicks: session.totalMouseClicks ?? 0,
    totalScrollDelta: session.totalScrollDelta ?? 0,
    mouseIntensity: session.mouseIntensity ?? 0,
    idleSeconds: session.idleSeconds ?? 0,
    idleRatio: session.idleRatio ?? 0,
    distractions: session.distractions ?? 0,
    fatigueRisk: session.fatigueRisk ?? 'Low',
    fatigueScore: session.fatigueScore ?? 0,
    primaryApp: session.primaryApp ?? null,
    switchRate: session.switchRate ?? 0,
    windowSwitchCount: session.windowSwitchCount ?? 0,
    deepWorkSeconds: session.deepWorkSeconds ?? 0,
    sessionMode: session.sessionMode ?? 'Guided',
    focusQuality: session.focusQuality ?? '',
    focusQualityDetail: session.focusQualityDetail ?? '',
    pillarScores: session.pillarScores ?? {},
    coach: session.coach ?? {},
    bestFlowSeconds: session.bestFlowSeconds ?? session.deepWorkSeconds ?? 0,
    recoveryCount: session.recoveryCount ?? 0,
    driftCount: session.driftCount ?? 0,
    productiveSeconds: session.productiveSeconds ?? 0,
    supportingSeconds: session.supportingSeconds ?? 0,
    unclearSeconds: session.unclearSeconds ?? 0,
    distractingSeconds: session.distractingSeconds ?? 0,
    primaryContext: session.primaryContext ?? '',
    primaryBrowserUrl: session.primaryBrowserUrl ?? '',
    primaryContextState: session.primaryContextState ?? '',
    primaryContextConfidence: session.primaryContextConfidence ?? 0,
    durationGoal: session.durationGoalMinutes ?? session.durationGoal ?? 0,
    durationGoalMinutes: session.durationGoalMinutes ?? session.durationGoal ?? 0,
    focusFormulaVersion: session.focusFormulaVersion ?? 'focus-v3.0',
    appBreakdown: session.appBreakdown ?? session.appUsage ?? [],
    appUsage: session.appUsage ?? session.appBreakdown ?? [],
    windowBreakdown: session.windowBreakdown ?? [],
    activityTimeline: session.activityTimeline ?? [],
    timeline: session.timeline ?? session.timelineSegments ?? [],
    timelineSegments: session.timelineSegments ?? session.timeline ?? [],
    distractionLog: session.distractionLog ?? [],
    switchLog: session.switchLog ?? [],
    statusEvents: session.statusEvents ?? [],
    sessionSummary: session.sessionSummary ?? {},
    telemetrySummary: session.telemetrySummary ?? {},
    fatigueDrivers: session.fatigueDrivers ?? {},
  }
}

function normalizeAmbientEntry(entry) {
  return normalizeAmbientEntryPayload(entry, { preferProvidedClassification: true })
}

function normalizeMediaEntry(entry) {
  return normalizeBackgroundMediaPayload(entry)
}

function normalizeRule(rule) {
  return {
    category: rule.category ?? 'Other',
    subcategory: rule.subcategory ?? '',
    color: rule.color ?? '#8E95A3',
    productive: rule.productive === null || rule.productive === undefined ? null : Boolean(rule.productive),
    lane: String(rule.lane || ''),
  }
}

function sanitizeCustomRules(customRules = {}) {
  return Object.fromEntries(
    Object.entries(customRules && typeof customRules === 'object' ? customRules : {})
      .map(([key, rule]) => {
        const normalizedKey = String(key || '').trim().toLowerCase()
        if (!normalizedKey || isBrowserShellRuleMatch(normalizedKey)) return null
        return [normalizedKey, normalizeRule(rule)]
      })
      .filter(Boolean),
  )
}

function getRetentionCutoff(retentionDays = DEFAULT_SETTINGS.dataRetentionDays) {
  const safeDays = Math.max(1, Number(retentionDays) || DEFAULT_SETTINGS.dataRetentionDays)
  return Date.now() - (safeDays * 86400000)
}

function isUsableStore(store) {
  return !!store && typeof store === 'object' && store.users && typeof store.users === 'object'
}

function readStore(filePath) {
  if (!existsSync(filePath)) {
    return { version: 1, users: {} }
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return isUsableStore(parsed) ? parsed : { version: 1, users: {} }
  } catch {
    return { version: 1, users: {} }
  }
}

function writeStore(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tempPath, filePath)
}

export function createJsonRepository() {
  const filePath = join(app.getPath('userData'), 'velance-fallback.json')
  let store = readStore(filePath)

  const persist = () => {
    writeStore(filePath, store)
  }

  const ensureUser = (userId) => {
    if (!store.users[userId]) {
      store.users[userId] = createEmptyUserState()
      persist()
    }
    const user = store.users[userId]
    const sanitizedRules = sanitizeCustomRules(user.customRules)
    if (JSON.stringify(sanitizedRules) !== JSON.stringify(user.customRules || {})) {
      user.customRules = sanitizedRules
      persist()
    }
    return user
  }

  const getBackendStatus = () => ({
    kind: 'json-fallback',
    available: true,
    message: 'Running on the JSON fallback repository.',
  })

  return {
    backend: 'json-fallback',
    getBackendStatus,

    getBootstrap(userId) {
      const user = ensureUser(userId)
      return {
        backend: getBackendStatus(),
        workspace: {
          id: userId,
          migrationCompleted: Boolean(user.legacyMigrationCompleted),
          migratedAt: Number(user.legacyMigratedAt || 0),
          syncState: normalizeSyncState(user.syncState),
        },
        profile: normalizeProfile(user.profile),
        settings: publicSettings(user.settings),
        tasks: sortByCreatedDesc(user.tasks).map((task) => clone(task)),
        habits: sortByCreatedDesc(user.habits).map((habit) => clone(habit)),
        sessions: sortSessions(user.sessions).map((session) => clone(session)),
        insightCache: clone(user.insightCache ?? DEFAULT_INSIGHT_CACHE),
      }
    },

    exportWorkspaceBackup(userId) {
      const user = ensureUser(userId)
      return normalizeWorkspaceBackup({
        backupVersion: WORKSPACE_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        sourceWorkspaceId: userId,
        backendKind: getBackendStatus().kind,
        workspace: {
          id: userId,
          migrationCompleted: Boolean(user.legacyMigrationCompleted),
          migratedAt: Number(user.legacyMigratedAt || 0),
          syncState: normalizeSyncState(user.syncState),
        },
        profile: normalizeProfile(user.profile),
        settings: publicSettings(user.settings),
        tasks: sortByCreatedDesc(user.tasks).map((task) => clone(task)),
        habits: sortByCreatedDesc(user.habits).map((habit) => clone(habit)),
        sessions: sortSessions(user.sessions).map((session) => clone(session)),
        ambient: (user.ambient || []).map((entry) => clone(entry)),
        media: (user.media || []).map((entry) => clone(entry)),
        browserEvents: (user.browserEvents || []).map((entry) => clone(entry)),
        customRules: clone(user.customRules),
        insightCache: clone(user.insightCache ?? DEFAULT_INSIGHT_CACHE),
      }, userId)
    },

    getAiSettingsForInference(userId) {
      const user = ensureUser(userId)
      return privateSettings(user.settings)
    },

    restoreWorkspaceBackup(userId, backup = {}) {
      const normalized = normalizeWorkspaceBackup(backup, userId)
      const sanitizedCustomRules = sanitizeCustomRules(normalized.customRules || {})
      const user = createEmptyUserState()
      const restoredAt = Date.now()
      const importedSyncState = normalized.workspace?.syncState || {}

      user.profile = normalizeProfile(normalized.profile)
      user.settings = {
        ...DEFAULT_SETTINGS,
        ...(normalized.settings || {}),
        geminiApiKey: resolveStoredSecretForSave(normalized.settings || {}),
      }
      user.tasks = sortByCreatedDesc(normalized.tasks.map(normalizeTask))
      user.habits = sortByCreatedDesc(normalized.habits.map(normalizeHabit))
      user.sessions = sortSessions(normalized.sessions.map(normalizeSession))
      user.ambient = normalized.ambient.map((entry) => normalizeAmbientEntryPayload(entry, {
        customRules: sanitizedCustomRules,
        preferProvidedClassification: true,
      }))
      user.media = normalized.media.map((entry) => normalizeBackgroundMediaPayload(entry, {
        customRules: sanitizedCustomRules,
      }))
      user.browserEvents = normalized.browserEvents.map((entry) => normalizeBrowserEventEntry(entry, {
        customRules: sanitizedCustomRules,
      }))
      user.customRules = sanitizedCustomRules
      user.insightCache = {
        insights: clone(normalized.insightCache.insights),
        generatedAt: Number(normalized.insightCache.generatedAt || 0),
      }
      user.syncState = normalizeSyncState({
        dirty: true,
        dirtySince: restoredAt,
        lastSyncedAt: importedSyncState.lastSyncedAt || 0,
        lastRemoteUpdatedAt: importedSyncState.lastRemoteUpdatedAt || 0,
        lastLocalUpdatedAt: restoredAt,
        lastError: '',
        conflictDetectedAt: 0,
        pendingReason: 'restore-import',
      })
      user.legacyMigrationCompleted = Boolean(normalized.workspace?.migrationCompleted)
      user.legacyMigratedAt = Number(normalized.workspace?.migratedAt || 0)
      store.users[userId] = user
      persist()
      return this.getBootstrap(userId)
    },

    replaceSyncSnapshot(userId, snapshot = {}) {
      const user = ensureUser(userId)
      const existingProfile = normalizeProfile(user.profile)
      const existingSettings = { ...DEFAULT_SETTINGS, ...user.settings }

      user.profile = normalizeProfile({ ...existingProfile, ...(snapshot.profile || {}) })
      user.settings = {
        ...existingSettings,
        ...(snapshot.settings || {}),
        geminiApiKey: resolveStoredSecretForSave(snapshot.settings || {}, existingSettings.geminiApiKey),
      }
      user.tasks = sortByCreatedDesc((Array.isArray(snapshot.tasks) ? snapshot.tasks : []).map(normalizeTask))
      user.habits = sortByCreatedDesc((Array.isArray(snapshot.habits) ? snapshot.habits : []).map(normalizeHabit))
      user.sessions = sortSessions((Array.isArray(snapshot.sessions) ? snapshot.sessions : []).map(normalizeSession))
      user.customRules = sanitizeCustomRules(snapshot.customRules)
      user.insightCache = {
        insights: clone(snapshot.insightCache?.insights ?? []),
        generatedAt: Number(snapshot.insightCache?.generatedAt || 0),
      }
      persist()
      return this.getBootstrap(userId)
    },

    saveProfile(userId, profile) {
      const user = ensureUser(userId)
      user.profile = normalizeProfile(profile)
      persist()
      return normalizeProfile(user.profile)
    },

    saveSyncState(userId, syncState) {
      const user = ensureUser(userId)
      user.syncState = normalizeSyncState(syncState)
      persist()
      return clone(user.syncState)
    },

    getAmbientRange(userId, dateKeys) {
      if (!Array.isArray(dateKeys) || !dateKeys.length) return []
      const user = ensureUser(userId)
      return user.ambient
        .filter((entry) => dateKeys.includes(entry.date))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0))
        .map((entry) => clone(entry))
    },

    getMediaRange(userId, dateKeys) {
      if (!Array.isArray(dateKeys) || !dateKeys.length) return []
      const user = ensureUser(userId)
      return (user.media || [])
        .filter((entry) => dateKeys.includes(entry.date))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0))
        .map((entry) => clone(entry))
    },

    getBrowserEventRange(userId, dateKeys) {
      if (!Array.isArray(dateKeys) || !dateKeys.length) return []
      const user = ensureUser(userId)
      return (user.browserEvents || [])
        .filter((entry) => dateKeys.includes(entry.date))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0))
        .map((entry) => normalizeBrowserEventEntry(entry, {
          customRules: user.customRules,
        }))
        .map((entry) => clone(entry))
    },

    getCombinedTrackingRange(userId, dateKeys) {
      return {
        ambient: this.getAmbientRange(userId, dateKeys),
        media: this.getMediaRange(userId, dateKeys),
        browserEvents: this.getBrowserEventRange(userId, dateKeys),
      }
    },

    saveSettings(userId, settings) {
      const user = ensureUser(userId)
      user.settings = {
        ...DEFAULT_SETTINGS,
        ...user.settings,
        ...settings,
        geminiApiKey: resolveStoredSecretForSave(settings, user.settings?.geminiApiKey || ''),
        aiKeyProvider: settings.clearAiApiKey
          ? ''
          : (settings.geminiApiKey || settings.aiApiKey || settings.apiKey)
            ? (settings.aiProvider || user.settings?.aiProvider || DEFAULT_SETTINGS.aiProvider)
            : (settings.aiKeyProvider || user.settings?.aiKeyProvider || ''),
      }
      persist()
      return this.getBootstrap(userId).settings
    },

    upsertTask(userId, task) {
      const user = ensureUser(userId)
      const normalized = normalizeTask(task)
      const index = user.tasks.findIndex((entry) => entry.id === normalized.id)
      if (index >= 0) user.tasks[index] = normalized
      else user.tasks.push(normalized)
      persist()
      return this.getBootstrap(userId).tasks
    },

    deleteTask(userId, taskId) {
      const user = ensureUser(userId)
      user.tasks = user.tasks.filter((task) => task.id !== taskId)
      persist()
      return this.getBootstrap(userId).tasks
    },

    upsertHabit(userId, habit) {
      const user = ensureUser(userId)
      const normalized = normalizeHabit(habit)
      const index = user.habits.findIndex((entry) => entry.id === normalized.id)
      if (index >= 0) user.habits[index] = normalized
      else user.habits.push(normalized)
      persist()
      return this.getBootstrap(userId).habits
    },

    deleteHabit(userId, habitId) {
      const user = ensureUser(userId)
      user.habits = user.habits.filter((habit) => habit.id !== habitId)
      persist()
      return this.getBootstrap(userId).habits
    },

    upsertSession(userId, session) {
      const user = ensureUser(userId)
      const normalized = normalizeSession(session)
      const index = user.sessions.findIndex((entry) => entry.id === normalized.id)
      if (index >= 0) user.sessions[index] = normalized
      else user.sessions.push(normalized)
      persist()
      return this.getBootstrap(userId).sessions
    },

    deleteSessionsByHabit(userId, habitName) {
      const user = ensureUser(userId)
      user.sessions = user.sessions.filter((session) => session.habit !== habitName)
      persist()
      return this.getBootstrap(userId).sessions
    },

    deleteSession(userId, sessionId) {
      const user = ensureUser(userId)
      user.sessions = user.sessions.filter((session) => session.id !== sessionId)
      persist()
      return this.getBootstrap(userId).sessions
    },

    upsertAmbientEntry(userId, entry) {
      const user = ensureUser(userId)
      const normalized = normalizeAmbientEntryPayload(entry, {
        customRules: user.customRules,
      })
      const index = user.ambient.findIndex((ambient) => ambient.id === normalized.id)
      if (index >= 0) user.ambient[index] = normalized
      else user.ambient.push(normalized)
      user.insightCache = { ...DEFAULT_INSIGHT_CACHE }
      persist()
      return this.getAmbientRange(userId, [normalized.date])
    },

    upsertMediaEntry(userId, entry) {
      const user = ensureUser(userId)
      const normalized = normalizeBackgroundMediaPayload(entry, {
        customRules: user.customRules,
      })
      const index = (user.media || []).findIndex((mediaEntry) => mediaEntry.id === normalized.id)
      if (index >= 0) user.media[index] = normalized
      else user.media.push(normalized)
      user.insightCache = { ...DEFAULT_INSIGHT_CACHE }
      persist()
      return this.getMediaRange(userId, [normalized.date])
    },

    upsertBrowserEvent(userId, entry) {
      const user = ensureUser(userId)
      const normalized = normalizeBrowserEventEntry(entry, {
        customRules: user.customRules,
      })
      const index = (user.browserEvents || []).findIndex((browserEvent) => browserEvent.id === normalized.id)
      if (index >= 0) user.browserEvents[index] = normalized
      else user.browserEvents.push(normalized)
      persist()
      return this.getBrowserEventRange(userId, [normalized.date])
    },

    getCustomRules(userId) {
      const user = ensureUser(userId)
      return clone(user.customRules)
    },

    upsertCustomRule(userId, matchText, rule) {
      const user = ensureUser(userId)
      user.customRules = sanitizeCustomRules({
        ...user.customRules,
        [String(matchText || '').trim().toLowerCase()]: rule,
      })
      user.ambient = user.ambient.map((entry) => normalizeAmbientEntryPayload(entry, {
        customRules: user.customRules,
      }))
      user.media = (user.media || []).map((entry) => normalizeBackgroundMediaPayload(entry, {
        customRules: user.customRules,
      }))
      user.insightCache = { ...DEFAULT_INSIGHT_CACHE }
      persist()
      return this.getCustomRules(userId)
    },

    deleteCustomRule(userId, matchText) {
      const user = ensureUser(userId)
      delete user.customRules[matchText.toLowerCase()]
      user.ambient = user.ambient.map((entry) => normalizeAmbientEntryPayload(entry, {
        customRules: user.customRules,
      }))
      user.media = (user.media || []).map((entry) => normalizeBackgroundMediaPayload(entry, {
        customRules: user.customRules,
      }))
      user.insightCache = { ...DEFAULT_INSIGHT_CACHE }
      persist()
      return this.getCustomRules(userId)
    },

    saveInsightCache(userId, insights) {
      const user = ensureUser(userId)
      user.insightCache = {
        insights: clone(insights ?? []),
        generatedAt: Date.now(),
      }
      persist()
      return clone(user.insightCache)
    },

    getInsightFeedback(userId) {
      const user = ensureUser(userId)
      return clone(user.insightFeedback || [])
    },

    saveInsightFeedback(userId, feedback = {}) {
      const user = ensureUser(userId)
      const insightId = String(feedback?.insightId || '').trim()
      const value = String(feedback?.feedback || '').trim().toLowerCase()
      if (!insightId || !['useful', 'not-useful'].includes(value)) {
        return this.getInsightFeedback(userId)
      }
      const now = Date.now()
      const existing = (user.insightFeedback || []).find((entry) => entry.insightId === insightId)
      const next = {
        insightId,
        feedback: value,
        note: String(feedback?.note || '').slice(0, 240),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }
      user.insightFeedback = [
        next,
        ...(user.insightFeedback || []).filter((entry) => entry.insightId !== insightId),
      ]
      persist()
      return this.getInsightFeedback(userId)
    },

    clearInsightCache(userId) {
      const user = ensureUser(userId)
      user.insightCache = { ...DEFAULT_INSIGHT_CACHE }
      persist()
      return clone(user.insightCache)
    },

    markLegacyMigrationComplete(userId) {
      const user = ensureUser(userId)
      user.legacyMigrationCompleted = true
      user.legacyMigratedAt = Date.now()
      persist()
      return {
        id: userId,
        migrationCompleted: true,
        migratedAt: user.legacyMigratedAt,
      }
    },

    pruneExpiredData(userId, retentionDays) {
      const user = ensureUser(userId)
      const cutoff = getRetentionCutoff(retentionDays)
      user.sessions = user.sessions.filter((session) => Number(session.timestamp || session.createdAt || 0) >= cutoff)
      user.ambient = user.ambient.filter((entry) => Number(entry.endTs || entry.ts || 0) >= cutoff)
      user.media = (user.media || []).filter((entry) => Number(entry.endTs || entry.ts || 0) >= cutoff)
      user.browserEvents = (user.browserEvents || []).filter((entry) => Number(entry.ts || 0) >= cutoff)
      if (Number(user.insightCache?.generatedAt || 0) < cutoff) {
        user.insightCache = { ...DEFAULT_INSIGHT_CACHE }
      }
      persist()
      return this.getBootstrap(userId)
    },

    pruneExpiredDataForAllUsers() {
      const userIds = Object.keys(store.users)
      userIds.forEach((userId) => {
        const retentionDays = store.users[userId]?.settings?.dataRetentionDays ?? DEFAULT_SETTINGS.dataRetentionDays
        this.pruneExpiredData(userId, retentionDays)
      })
      return userIds.length
    },

    clearAllUserData(userId) {
      store.users[userId] = createEmptyUserState()
      persist()
      return this.getBootstrap(userId)
    },

    async reclassifyTrackingHistory(userId, options = {}) {
      const user = ensureUser(userId)
      user.ambient = user.ambient.map((entry) => normalizeAmbientEntryPayload(entry, {
        customRules: user.customRules,
      }))
      user.media = (user.media || []).map((entry) => normalizeBackgroundMediaPayload(entry, {
        customRules: user.customRules,
      }))
      user.browserEvents = (user.browserEvents || []).map((entry) => normalizeBrowserEventEntry(entry, {
        customRules: user.customRules,
      }))

      let aiRulesApplied = 0
      if (typeof options?.resolveClassificationEdgeCases === 'function') {
        const resolution = await options.resolveClassificationEdgeCases({
          userId,
          settings: privateSettings(user.settings),
          customRules: user.customRules,
          ambientEntries: user.ambient,
          browserEvents: user.browserEvents,
        })

        for (const rule of Array.isArray(resolution?.rules) ? resolution.rules : []) {
          const matchText = String(rule?.matchText || '').trim().toLowerCase()
          if (!matchText || user.customRules[matchText]) continue
          user.customRules = sanitizeCustomRules({
            ...user.customRules,
            [matchText]: rule,
          })
          if (!user.customRules[matchText]) continue
          aiRulesApplied += 1
        }

        if (aiRulesApplied > 0) {
          user.ambient = user.ambient.map((entry) => normalizeAmbientEntryPayload(entry, {
            customRules: user.customRules,
          }))
          user.media = (user.media || []).map((entry) => normalizeBackgroundMediaPayload(entry, {
            customRules: user.customRules,
          }))
          user.browserEvents = (user.browserEvents || []).map((entry) => normalizeBrowserEventEntry(entry, {
            customRules: user.customRules,
          }))
        }
      }

      user.insightCache = { ...DEFAULT_INSIGHT_CACHE }
      persist()
      return {
        ok: true,
        classificationVersion: TRACKING_CLASSIFICATION_VERSION,
        aiRulesApplied,
      }
    },
  }
}
