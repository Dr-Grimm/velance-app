import { getWorkspaceScopedKey, resolveWorkspaceId } from './workspaceIdentity.js'

const LEGACY_PROFILE_KEY = 'velance_profile'
const LEGACY_SETTINGS_KEY = 'velance_settings'
const LEGACY_TASKS_KEY = 'velance_tasks'
const LEGACY_HABITS_KEY = 'velance_habits'
const LEGACY_SESSIONS_KEY = 'velance_sessions'
const LEGACY_INSIGHTS_KEY = 'velance_insights_cache'
const LEGACY_INSIGHTS_AT_KEY = 'velance_insights_cached_at'
const LEGACY_GOALS_KEY = 'velance_goals'
const AMBIENT_CACHE_KEY_PREFIX = 'velance_ambient_cache'
const CUSTOM_RULES_KEY_PREFIX = 'velance_custom_rules'

function safeParse(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function sortByCreatedAtDesc(items = []) {
  return [...items].sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0))
}

function sortByTimestampDesc(items = []) {
  return [...items].sort((a, b) => (b?.timestamp ?? 0) - (a?.timestamp ?? 0))
}

function upsertById(items = [], item, sortFn = (value) => value) {
  const next = [...items]
  const index = next.findIndex((entry) => entry?.id === item?.id)
  if (index >= 0) next[index] = item
  else next.push(item)
  return sortFn(next)
}

function removeById(items = [], id, sortFn = (value) => value) {
  return sortFn(items.filter((entry) => entry?.id !== id))
}

function removeKeysByPrefix(prefix) {
  const keys = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  keys.forEach((key) => localStorage.removeItem(key))
}

function getSettingsKey(workspaceId = resolveWorkspaceId()) {
  return getWorkspaceScopedKey('settings', workspaceId)
}

function getProfileKey(workspaceId = resolveWorkspaceId()) {
  return getWorkspaceScopedKey('profile', workspaceId)
}

function getTasksKey(workspaceId = resolveWorkspaceId()) {
  return getWorkspaceScopedKey('tasks', workspaceId)
}

function getHabitsKey(workspaceId = resolveWorkspaceId()) {
  return getWorkspaceScopedKey('habits', workspaceId)
}

function getSessionsKey(workspaceId = resolveWorkspaceId()) {
  return getWorkspaceScopedKey('sessions', workspaceId)
}

function getInsightsKey(workspaceId = resolveWorkspaceId()) {
  return getWorkspaceScopedKey('insights', workspaceId)
}

function getInsightsAtKey(workspaceId = resolveWorkspaceId()) {
  return getWorkspaceScopedKey('insights_cached_at', workspaceId)
}

function getRetentionCutoff(retentionDays = 90) {
  const safeDays = Math.max(1, Number(retentionDays) || 90)
  return Date.now() - (safeDays * 86400000)
}

function pruneAmbientCacheEntries(rawCache, cutoff) {
  const next = {}
  for (const [dateKey, entries] of Object.entries(rawCache || {})) {
    const keptEntries = (Array.isArray(entries) ? entries : []).filter((entry) => {
      const entryEnd = Number(entry?.endTs || entry?.ts || 0)
      return entryEnd >= cutoff
    })
    if (keptEntries.length) next[dateKey] = keptEntries
  }
  return next
}

export function readProfileMirror(workspaceId = resolveWorkspaceId()) {
  return safeParse(getProfileKey(workspaceId), null)
}

export function writeProfileMirror(profile, workspaceId = resolveWorkspaceId()) {
  localStorage.setItem(getProfileKey(workspaceId), JSON.stringify(profile ?? {}))
  return readProfileMirror(workspaceId)
}

export function readSettingsMirror(workspaceId = resolveWorkspaceId()) {
  return safeParse(getSettingsKey(workspaceId), null)
}

export function writeSettingsMirror(settings, workspaceId = resolveWorkspaceId()) {
  const safeSettings = {
    ...(settings ?? {}),
    geminiApiKey: '',
    aiApiKey: '',
    apiKey: '',
  }
  localStorage.setItem(getSettingsKey(workspaceId), JSON.stringify(safeSettings))
  return readSettingsMirror(workspaceId)
}

export function readTasksMirror(workspaceId = resolveWorkspaceId()) {
  return sortByCreatedAtDesc(safeParse(getTasksKey(workspaceId), []))
}

export function writeTasksMirror(tasks = [], workspaceId = resolveWorkspaceId()) {
  const next = sortByCreatedAtDesc(tasks)
  localStorage.setItem(getTasksKey(workspaceId), JSON.stringify(next))
  return next
}

export function upsertTaskMirror(task, workspaceId = resolveWorkspaceId()) {
  return writeTasksMirror(upsertById(readTasksMirror(workspaceId), task, sortByCreatedAtDesc), workspaceId)
}

export function deleteTaskMirror(taskId, workspaceId = resolveWorkspaceId()) {
  return writeTasksMirror(removeById(readTasksMirror(workspaceId), taskId, sortByCreatedAtDesc), workspaceId)
}

export function readHabitsMirror(workspaceId = resolveWorkspaceId()) {
  return sortByCreatedAtDesc(safeParse(getHabitsKey(workspaceId), []))
}

export function writeHabitsMirror(habits = [], workspaceId = resolveWorkspaceId()) {
  const next = sortByCreatedAtDesc(habits)
  localStorage.setItem(getHabitsKey(workspaceId), JSON.stringify(next))
  return next
}

export function upsertHabitMirror(habit, workspaceId = resolveWorkspaceId()) {
  return writeHabitsMirror(upsertById(readHabitsMirror(workspaceId), habit, sortByCreatedAtDesc), workspaceId)
}

export function deleteHabitMirror(habitId, workspaceId = resolveWorkspaceId()) {
  return writeHabitsMirror(removeById(readHabitsMirror(workspaceId), habitId, sortByCreatedAtDesc), workspaceId)
}

export function readSessionsMirror(workspaceId = resolveWorkspaceId()) {
  return sortByTimestampDesc(safeParse(getSessionsKey(workspaceId), []))
}

export function writeSessionsMirror(sessions = [], workspaceId = resolveWorkspaceId()) {
  const next = sortByTimestampDesc(sessions)
  localStorage.setItem(getSessionsKey(workspaceId), JSON.stringify(next))
  return next
}

export function upsertSessionMirror(session, workspaceId = resolveWorkspaceId()) {
  return writeSessionsMirror(upsertById(readSessionsMirror(workspaceId), session, sortByTimestampDesc), workspaceId)
}

export function deleteSessionMirror(sessionId, workspaceId = resolveWorkspaceId()) {
  return writeSessionsMirror(removeById(readSessionsMirror(workspaceId), sessionId, sortByTimestampDesc), workspaceId)
}

export function deleteSessionsByHabitMirror(habitName, workspaceId = resolveWorkspaceId()) {
  return writeSessionsMirror(readSessionsMirror(workspaceId).filter((session) => session?.habit !== habitName), workspaceId)
}

export function readInsightCacheMirror(workspaceId = resolveWorkspaceId()) {
  const insights = safeParse(getInsightsKey(workspaceId), [])
  const generatedAt = parseInt(localStorage.getItem(getInsightsAtKey(workspaceId)) || '0', 10)
  return {
    insights,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : 0,
  }
}

export function writeInsightCacheMirror(insights = [], generatedAt = Date.now(), workspaceId = resolveWorkspaceId()) {
  localStorage.setItem(getInsightsKey(workspaceId), JSON.stringify(insights))
  localStorage.setItem(getInsightsAtKey(workspaceId), String(generatedAt))
  return {
    insights: safeParse(getInsightsKey(workspaceId), []),
    generatedAt,
  }
}

export function clearInsightCacheMirror(workspaceId = resolveWorkspaceId()) {
  localStorage.removeItem(getInsightsKey(workspaceId))
  localStorage.removeItem(getInsightsAtKey(workspaceId))
  return { insights: [], generatedAt: 0 }
}

export function pruneLocalMirror(retentionDays = 90, workspaceId = resolveWorkspaceId()) {
  const cutoff = getRetentionCutoff(retentionDays)
  const keptSessions = readSessionsMirror(workspaceId).filter((session) => {
    const timestamp = Number(session?.timestamp || session?.createdAt || 0)
    return timestamp >= cutoff
  })
  writeSessionsMirror(keptSessions, workspaceId)

  const insightCache = readInsightCacheMirror(workspaceId)
  if (Number(insightCache.generatedAt || 0) < cutoff) {
    clearInsightCacheMirror(workspaceId)
  }

  const ambientKeys = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(AMBIENT_CACHE_KEY_PREFIX)) ambientKeys.push(key)
  }

  ambientKeys.forEach((key) => {
    const pruned = pruneAmbientCacheEntries(safeParse(key, {}), cutoff)
    if (Object.keys(pruned).length) localStorage.setItem(key, JSON.stringify(pruned))
    else localStorage.removeItem(key)
  })

  return readLocalMirrorSnapshot(workspaceId)
}

export function readLocalMirrorSnapshot(workspaceId = resolveWorkspaceId()) {
  return {
    profile: readProfileMirror(workspaceId) ?? {},
    settings: readSettingsMirror(workspaceId) ?? {},
    tasks: readTasksMirror(workspaceId),
    habits: readHabitsMirror(workspaceId),
    sessions: readSessionsMirror(workspaceId),
    insightCache: readInsightCacheMirror(workspaceId),
  }
}

export function writeLocalMirrorSnapshot(snapshot = {}, workspaceId = resolveWorkspaceId()) {
  const next = {
    profile: snapshot.profile ?? readProfileMirror(workspaceId) ?? {},
    settings: snapshot.settings ?? readSettingsMirror(workspaceId) ?? {},
    tasks: snapshot.tasks ?? readTasksMirror(workspaceId),
    habits: snapshot.habits ?? readHabitsMirror(workspaceId),
    sessions: snapshot.sessions ?? readSessionsMirror(workspaceId),
    insightCache: snapshot.insightCache ?? readInsightCacheMirror(workspaceId),
  }

  writeProfileMirror(next.profile, workspaceId)
  writeSettingsMirror(next.settings, workspaceId)
  writeTasksMirror(next.tasks, workspaceId)
  writeHabitsMirror(next.habits, workspaceId)
  writeSessionsMirror(next.sessions, workspaceId)
  writeInsightCacheMirror(next.insightCache.insights ?? [], next.insightCache.generatedAt ?? 0, workspaceId)

  return readLocalMirrorSnapshot(workspaceId)
}

export function clearLocalMirror(workspaceId = resolveWorkspaceId()) {
  localStorage.removeItem(getProfileKey(workspaceId))
  localStorage.removeItem(getSettingsKey(workspaceId))
  localStorage.removeItem(getTasksKey(workspaceId))
  localStorage.removeItem(getHabitsKey(workspaceId))
  localStorage.removeItem(getSessionsKey(workspaceId))
  localStorage.removeItem(getInsightsKey(workspaceId))
  localStorage.removeItem(getInsightsAtKey(workspaceId))
}

export function readLegacyProfileMirror() {
  return safeParse(LEGACY_PROFILE_KEY, null)
}

export function readLegacyLocalMirrorSnapshot() {
  const insights = safeParse(LEGACY_INSIGHTS_KEY, [])
  const generatedAt = parseInt(localStorage.getItem(LEGACY_INSIGHTS_AT_KEY) || '0', 10)
  return {
    profile: readLegacyProfileMirror() ?? {},
    settings: safeParse(LEGACY_SETTINGS_KEY, {}) ?? {},
    tasks: sortByCreatedAtDesc(safeParse(LEGACY_TASKS_KEY, [])),
    habits: sortByCreatedAtDesc(safeParse(LEGACY_HABITS_KEY, [])),
    sessions: sortByTimestampDesc(safeParse(LEGACY_SESSIONS_KEY, [])),
    insightCache: {
      insights,
      generatedAt: Number.isFinite(generatedAt) ? generatedAt : 0,
    },
  }
}

export function hasLegacyGlobalMirrorData() {
  const snapshot = readLegacyLocalMirrorSnapshot()
  return Boolean(
    Object.keys(snapshot.profile || {}).length ||
    Object.keys(snapshot.settings || {}).length ||
    snapshot.tasks.length ||
    snapshot.habits.length ||
    snapshot.sessions.length ||
    snapshot.insightCache.insights.length,
  )
}

export function clearLegacyGlobalMirror() {
  localStorage.removeItem(LEGACY_PROFILE_KEY)
  localStorage.removeItem(LEGACY_SETTINGS_KEY)
  localStorage.removeItem(LEGACY_TASKS_KEY)
  localStorage.removeItem(LEGACY_HABITS_KEY)
  localStorage.removeItem(LEGACY_SESSIONS_KEY)
  localStorage.removeItem(LEGACY_INSIGHTS_KEY)
  localStorage.removeItem(LEGACY_INSIGHTS_AT_KEY)
  localStorage.removeItem(LEGACY_GOALS_KEY)
  removeKeysByPrefix(AMBIENT_CACHE_KEY_PREFIX)
  removeKeysByPrefix(CUSTOM_RULES_KEY_PREFIX)
}
