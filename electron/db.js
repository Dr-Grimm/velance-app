import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { createJsonRepository } from './jsonRepository.js'
import {
  protectSecret,
  publicSecretMeta,
  resolveStoredSecretForSave,
  revealSecret,
} from './secretStore.js'
import {
  TRACKING_CLASSIFICATION_VERSION,
  isBrowserShellRuleMatch,
  normalizeAmbientEntryPayload,
  normalizeBackgroundMediaPayload,
} from '../src/services/activityClassification.js'
import { normalizeBrowserEventEntry } from '../src/services/browserEventTracking.js'
import { normalizeWorkspaceBackup, WORKSPACE_BACKUP_VERSION } from '../src/services/workspaceBackup.js'
import { normalizeAiModel, normalizeAiProvider } from '../src/services/aiProvider.js'

let db

const SCHEMA_VERSION = 14

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
  browserExtensionEnabled: false,
  browserCaptureHosts: true,
  browserCaptureTitles: false,
  browserCaptureAudioTitles: false,
  trackingConsentGranted: false,
  trackingConsentVersion: 0,
  trackingConsentAt: 0,
}

function sanitizeCustomRuleRecord(matchText = '', rule = {}) {
  const normalizedMatchText = String(matchText || '').trim().toLowerCase()
  if (!normalizedMatchText || isBrowserShellRuleMatch(normalizedMatchText)) return null

  return {
    matchText: normalizedMatchText,
    rule: {
      category: rule.category ?? 'Other',
      subcategory: rule.subcategory ?? '',
      color: rule.color ?? '#8E95A3',
      productive: rule.productive === null || rule.productive === undefined ? null : Boolean(rule.productive),
      lane: String(rule.lane || ''),
    },
  }
}

function sanitizeCustomRuleEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map(([matchText, rule]) => sanitizeCustomRuleRecord(matchText, rule))
    .filter(Boolean)
}

function sanitizeCustomRuleMap(customRules = {}) {
  return Object.fromEntries(
    sanitizeCustomRuleEntries(Object.entries(customRules && typeof customRules === 'object' ? customRules : {}))
      .map((entry) => [entry.matchText, entry.rule]),
  )
}

function createNodeSqliteAdapter(filePath) {
  const database = new DatabaseSync(filePath)

  return {
    exec(sql) {
      return database.exec(sql)
    },

    prepare(sql) {
      return database.prepare(sql)
    },

    pragma(value) {
      return database.exec(`PRAGMA ${value}`)
    },

    transaction(fn) {
      return (...args) => {
        database.exec('BEGIN IMMEDIATE')
        try {
          const result = fn(...args)
          database.exec('COMMIT')
          return result
        } catch (error) {
          try {
            database.exec('ROLLBACK')
          } catch {
          }
          throw error
        }
      }
    },
  }
}

function readFallbackUsers() {
  const filePath = join(app.getPath('userData'), 'velance-fallback.json')
  if (!existsSync(filePath)) return {}

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return parsed?.users && typeof parsed.users === 'object' ? parsed.users : {}
  } catch {
    return {}
  }
}

function shouldBackfillSetupComplete(profile = {}) {
  if (profile?.setupComplete) return false
  const role = String(profile?.role || '').trim()
  const goal = String(profile?.goal || '').trim()
  const workingHours = String(profile?.workingHours || '').trim()
  return Boolean(
    (role && role !== DEFAULT_PROFILE.role) ||
    (goal && goal !== DEFAULT_PROFILE.goal) ||
    workingHours,
  )
}

function backfillCompletedProfiles(database) {
  const rows = database.prepare(`SELECT user_id, profile_json FROM workspace_meta`).all()
  const updateProfileStmt = database.prepare(`
    UPDATE workspace_meta
    SET profile_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `)

  for (const row of rows) {
    const profile = parseJsonField(row.profile_json, {})
    if (!shouldBackfillSetupComplete(profile)) continue
    updateProfileStmt.run(JSON.stringify({
      ...profile,
      setupComplete: true,
      updatedAt: profile.updatedAt || Date.now(),
    }), row.user_id)
  }
}

function ensureColumn(database, table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all()
  if (columns.some((entry) => entry.name === column)) return
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      is_dark INTEGER NOT NULL DEFAULT 0,
      tracking_enabled INTEGER NOT NULL DEFAULT 1,
      keystroke_enabled INTEGER NOT NULL DEFAULT 1,
      mouse_enabled INTEGER NOT NULL DEFAULT 1,
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      break_reminders INTEGER NOT NULL DEFAULT 1,
      break_interval_minutes INTEGER NOT NULL DEFAULT 90,
      data_retention_days INTEGER NOT NULL DEFAULT 90,
      ai_provider TEXT NOT NULL DEFAULT 'gemini',
      ai_model TEXT NOT NULL DEFAULT 'gemini-3-flash-preview',
      ai_base_url TEXT NOT NULL DEFAULT '',
      ai_insights_enabled INTEGER NOT NULL DEFAULT 1,
      ai_last_tested_at INTEGER NOT NULL DEFAULT 0,
      ai_last_test_ok INTEGER NOT NULL DEFAULT 0,
      ai_last_test_message TEXT NOT NULL DEFAULT '',
      gemini_api_key TEXT NOT NULL DEFAULT '',
      ai_key_provider TEXT NOT NULL DEFAULT '',
      browser_extension_enabled INTEGER NOT NULL DEFAULT 0,
      browser_capture_hosts INTEGER NOT NULL DEFAULT 1,
      browser_capture_titles INTEGER NOT NULL DEFAULT 0,
      browser_capture_audio_titles INTEGER NOT NULL DEFAULT 0,
      tracking_consent_granted INTEGER NOT NULL DEFAULT 0,
      tracking_consent_version INTEGER NOT NULL DEFAULT 0,
      tracking_consent_at INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workspace_meta (
      user_id TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL DEFAULT '{}',
      legacy_migration_completed INTEGER NOT NULL DEFAULT 0,
      legacy_migrated_at INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workspace_sync_state (
      user_id TEXT PRIMARY KEY,
      dirty INTEGER NOT NULL DEFAULT 0,
      dirty_since INTEGER NOT NULL DEFAULT 0,
      last_synced_at INTEGER NOT NULL DEFAULT 0,
      last_remote_updated_at INTEGER NOT NULL DEFAULT 0,
      last_local_updated_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      conflict_detected_at INTEGER NOT NULL DEFAULT 0,
      pending_reason TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      parent_task_id INTEGER,
      order_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'to-do',
      priority TEXT NOT NULL DEFAULT 'Normal',
      habit TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      reminder_date TEXT,
      reminder_time TEXT NOT NULL DEFAULT '',
      subtasks_json TEXT NOT NULL DEFAULT '[]',
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    CREATE TABLE IF NOT EXISTS habits (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'other',
      color TEXT NOT NULL DEFAULT '#00B4D8',
      target_minutes INTEGER NOT NULL DEFAULT 60,
      manual_minutes_json TEXT NOT NULL DEFAULT '{}',
      skip_dates_json TEXT NOT NULL DEFAULT '[]',
      reminder_enabled INTEGER NOT NULL DEFAULT 0,
      reminder_frequency TEXT NOT NULL DEFAULT 'daily',
      reminder_time TEXT NOT NULL DEFAULT '',
      reminder_days_json TEXT NOT NULL DEFAULT '[]',
      reminder_last_fired_at INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits(user_id);

    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_title TEXT,
      habit TEXT,
      session_type TEXT,
      goal_text TEXT,
      date_key TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      focus_score INTEGER NOT NULL DEFAULT 0,
      keystrokes_per_min INTEGER NOT NULL DEFAULT 0,
      total_keystrokes INTEGER NOT NULL DEFAULT 0,
      total_mouse_clicks INTEGER NOT NULL DEFAULT 0,
      total_scroll_delta INTEGER NOT NULL DEFAULT 0,
      mouse_intensity INTEGER NOT NULL DEFAULT 0,
      idle_seconds INTEGER NOT NULL DEFAULT 0,
      idle_ratio INTEGER NOT NULL DEFAULT 0,
      distractions INTEGER NOT NULL DEFAULT 0,
      fatigue_risk TEXT NOT NULL DEFAULT 'Low',
      primary_app TEXT,
      switch_rate REAL NOT NULL DEFAULT 0,
      window_switch_count INTEGER NOT NULL DEFAULT 0,
      deep_work_seconds INTEGER NOT NULL DEFAULT 0,
      app_breakdown_json TEXT NOT NULL DEFAULT '[]',
      activity_timeline_json TEXT NOT NULL DEFAULT '[]',
      distraction_log_json TEXT NOT NULL DEFAULT '[]',
      switch_log_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_focus_sessions_user_id ON focus_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_focus_sessions_date_key ON focus_sessions(date_key);

    CREATE TABLE IF NOT EXISTS ambient_activity_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      app_name TEXT NOT NULL,
      app_group TEXT NOT NULL DEFAULT '',
      window_title TEXT NOT NULL DEFAULT '',
      browser_url TEXT NOT NULL DEFAULT '',
      browser_host TEXT NOT NULL DEFAULT '',
      browser_page TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      switches INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'Other',
      subcategory TEXT NOT NULL DEFAULT '',
      lane TEXT NOT NULL DEFAULT 'supporting',
      context_label TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#8E95A3',
      productive INTEGER,
      confidence REAL NOT NULL DEFAULT 0,
      is_custom_rule INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_ambient_user_date ON ambient_activity_logs(user_id, date_key);

    CREATE TABLE IF NOT EXISTS background_media_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      source_app TEXT NOT NULL,
      track_title TEXT NOT NULL DEFAULT '',
      artist TEXT NOT NULL DEFAULT '',
      album TEXT NOT NULL DEFAULT '',
      playback_state TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'Other',
      lane TEXT NOT NULL DEFAULT 'supporting',
      confidence REAL NOT NULL DEFAULT 0,
      productive INTEGER,
      context_label TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#8E95A3'
    );

    CREATE INDEX IF NOT EXISTS idx_media_user_date ON background_media_logs(user_id, date_key);

    CREATE TABLE IF NOT EXISTS browser_activity_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      ts INTEGER NOT NULL,
      browser_app TEXT NOT NULL,
      browser_family TEXT NOT NULL DEFAULT 'chromium',
      event_type TEXT NOT NULL DEFAULT 'unknown',
      tab_id INTEGER,
      window_id INTEGER,
      opener_tab_id INTEGER,
      previous_tab_id INTEGER,
      url TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '',
      page_title TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 0,
      highlighted INTEGER NOT NULL DEFAULT 0,
      audible INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      discarded INTEGER NOT NULL DEFAULT 0,
      is_window_closing INTEGER NOT NULL DEFAULT 0,
      set_active_context INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_browser_events_user_date ON browser_activity_events(user_id, date_key);

    CREATE TABLE IF NOT EXISTS custom_classification_rules (
      match_text TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#8E95A3',
      productive INTEGER,
      lane TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_custom_rules_user_id ON custom_classification_rules(user_id);

    CREATE TABLE IF NOT EXISTS insight_cache (
      user_id TEXT PRIMARY KEY,
      insights_json TEXT NOT NULL DEFAULT '[]',
      generated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS insight_feedback (
      user_id TEXT NOT NULL,
      insight_id TEXT NOT NULL,
      feedback TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, insight_id)
    );
  `)

  ensureColumn(database, 'focus_sessions', 'session_mode', `TEXT NOT NULL DEFAULT 'Guided'`)
  ensureColumn(database, 'focus_sessions', 'focus_quality', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'focus_sessions', 'focus_quality_detail', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'focus_sessions', 'pillar_scores_json', `TEXT NOT NULL DEFAULT '{}'`)
  ensureColumn(database, 'focus_sessions', 'coach_json', `TEXT NOT NULL DEFAULT '{}'`)
  ensureColumn(database, 'focus_sessions', 'best_flow_seconds', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'recovery_count', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'drift_count', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'productive_seconds', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'supporting_seconds', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'unclear_seconds', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'distracting_seconds', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'fatigue_score', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'primary_context', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'focus_sessions', 'primary_browser_url', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'focus_sessions', 'primary_context_state', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'focus_sessions', 'primary_context_confidence', `REAL NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'duration_goal', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'focus_sessions', 'focus_formula_version', `TEXT NOT NULL DEFAULT 'focus-v3.0'`)
  ensureColumn(database, 'focus_sessions', 'window_breakdown_json', `TEXT NOT NULL DEFAULT '[]'`)
  ensureColumn(database, 'focus_sessions', 'timeline_segments_json', `TEXT NOT NULL DEFAULT '[]'`)
  ensureColumn(database, 'focus_sessions', 'status_events_json', `TEXT NOT NULL DEFAULT '[]'`)
  ensureColumn(database, 'focus_sessions', 'session_summary_json', `TEXT NOT NULL DEFAULT '{}'`)
  ensureColumn(database, 'focus_sessions', 'telemetry_summary_json', `TEXT NOT NULL DEFAULT '{}'`)
  ensureColumn(database, 'focus_sessions', 'fatigue_drivers_json', `TEXT NOT NULL DEFAULT '{}'`)
  ensureColumn(database, 'focus_sessions', 'linked_task_id', `INTEGER`)
  ensureColumn(database, 'focus_sessions', 'linked_habit_id', `INTEGER`)
  ensureColumn(database, 'ambient_activity_logs', 'browser_url', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'ambient_activity_logs', 'app_group', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'ambient_activity_logs', 'browser_host', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'ambient_activity_logs', 'browser_page', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'ambient_activity_logs', 'lane', `TEXT NOT NULL DEFAULT 'supporting'`)
  ensureColumn(database, 'ambient_activity_logs', 'context_label', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'custom_classification_rules', 'lane', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'settings', 'tracking_consent_granted', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'tracking_consent_version', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'tracking_consent_at', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'browser_extension_enabled', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'browser_capture_hosts', `INTEGER NOT NULL DEFAULT 1`)
  ensureColumn(database, 'settings', 'browser_capture_titles', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'browser_capture_audio_titles', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'ai_provider', `TEXT NOT NULL DEFAULT 'gemini'`)
  ensureColumn(database, 'settings', 'ai_model', `TEXT NOT NULL DEFAULT 'gemini-3-flash-preview'`)
  ensureColumn(database, 'settings', 'ai_base_url', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'settings', 'ai_insights_enabled', `INTEGER NOT NULL DEFAULT 1`)
  ensureColumn(database, 'settings', 'ai_last_tested_at', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'ai_last_test_ok', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'settings', 'ai_last_test_message', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'settings', 'ai_key_provider', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'tasks', 'reminder_date', `TEXT`)
  ensureColumn(database, 'tasks', 'reminder_time', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'tasks', 'subtasks_json', `TEXT NOT NULL DEFAULT '[]'`)
  ensureColumn(database, 'tasks', 'parent_task_id', `INTEGER`)
  ensureColumn(database, 'tasks', 'order_index', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'habits', 'manual_minutes_json', `TEXT NOT NULL DEFAULT '{}'`)
  ensureColumn(database, 'habits', 'skip_dates_json', `TEXT NOT NULL DEFAULT '[]'`)
  ensureColumn(database, 'habits', 'reminder_enabled', `INTEGER NOT NULL DEFAULT 0`)
  ensureColumn(database, 'habits', 'reminder_frequency', `TEXT NOT NULL DEFAULT 'daily'`)
  ensureColumn(database, 'habits', 'reminder_time', `TEXT NOT NULL DEFAULT ''`)
  ensureColumn(database, 'habits', 'reminder_days_json', `TEXT NOT NULL DEFAULT '[]'`)
  ensureColumn(database, 'habits', 'reminder_last_fired_at', `INTEGER NOT NULL DEFAULT 0`)

  database.exec(`
    UPDATE settings
    SET ai_model = CASE
      WHEN ai_model IN ('gemini-2.5-pro', 'models/gemini-2.5-pro', 'gemini-3-pro-preview', 'models/gemini-3-pro-preview', 'gemini-3.1-pro-preview', 'models/gemini-3.1-pro-preview') THEN 'gemini-3-pro-preview'
      WHEN ai_model IN ('gemini-2.5-flash-lite', 'models/gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview', 'models/gemini-3.1-flash-lite-preview') THEN 'gemini-2.5-flash'
      ELSE 'gemini-3-flash-preview'
    END
    WHERE ai_provider = 'gemini'
      AND (
        ai_model = ''
        OR ai_model = 'gemini-2.0-flash'
        OR ai_model = 'models/gemini-2.0-flash'
        OR ai_model = 'gemini-2.5-flash'
        OR ai_model = 'models/gemini-2.5-flash'
        OR ai_model = 'gemini-2.5-flash-lite'
        OR ai_model = 'models/gemini-2.5-flash-lite'
        OR ai_model = 'gemini-2.5-pro'
        OR ai_model = 'models/gemini-2.5-pro'
        OR ai_model = 'gemini-3-pro-preview'
        OR ai_model = 'models/gemini-3-pro-preview'
        OR ai_model = 'gemini-3.1-pro-preview'
        OR ai_model = 'models/gemini-3.1-pro-preview'
        OR ai_model = 'gemini-3.1-flash-lite-preview'
        OR ai_model = 'models/gemini-3.1-flash-lite-preview'
      )
  `)

  const keyRows = database.prepare(`
    SELECT user_id, gemini_api_key
    FROM settings
    WHERE gemini_api_key <> ''
  `).all()
  const updateKeyStmt = database.prepare(`
    UPDATE settings
    SET gemini_api_key = ?
    WHERE user_id = ?
  `)
  for (const row of keyRows) {
    const stored = String(row.gemini_api_key || '')
    const protectedSecret = protectSecret(stored)
    if (protectedSecret && protectedSecret !== stored) {
      updateKeyStmt.run(protectedSecret, row.user_id)
    }
  }

  backfillCompletedProfiles(database)

  database
    .prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(String(SCHEMA_VERSION))

  database
    .prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES ('tracking_classification_version', ?)
      ON CONFLICT(key) DO NOTHING
    `)
    .run(TRACKING_CLASSIFICATION_VERSION)
}

export function initDatabase() {
  if (db) return db

  const dbPath = join(app.getPath('userData'), 'velance.sqlite')
  db = createNodeSqliteAdapter(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)
  return db
}

function mapSettings(row, { includeSecrets = false } = {}) {
  if (!row) return { ...DEFAULT_SETTINGS }
  const storedSecret = row.gemini_api_key || ''
  const revealedSecret = includeSecrets ? revealSecret(storedSecret) : ''
  const aiProvider = normalizeAiProvider(row.ai_provider || DEFAULT_SETTINGS.aiProvider)
  const aiModel = normalizeAiModel(aiProvider, row.ai_model || DEFAULT_SETTINGS.aiModel)
  return {
    isDark: Boolean(row.is_dark),
    trackingEnabled: Boolean(row.tracking_enabled),
    keystrokeEnabled: Boolean(row.keystroke_enabled),
    mouseEnabled: Boolean(row.mouse_enabled),
    notificationsEnabled: Boolean(row.notifications_enabled),
    breakReminders: Boolean(row.break_reminders),
    breakIntervalMinutes: row.break_interval_minutes,
    dataRetentionDays: row.data_retention_days,
    aiProvider,
    aiModel,
    aiBaseUrl: row.ai_base_url || DEFAULT_SETTINGS.aiBaseUrl,
    aiInsightsEnabled: row.ai_insights_enabled !== undefined ? Boolean(row.ai_insights_enabled) : DEFAULT_SETTINGS.aiInsightsEnabled,
    aiLastTestedAt: Number(row.ai_last_tested_at || 0),
    aiLastTestOk: Boolean(row.ai_last_test_ok),
    aiLastTestMessage: row.ai_last_test_message || '',
    geminiApiKey: revealedSecret,
    aiKeyProvider: row.ai_key_provider || '',
    ...(includeSecrets
      ? {
          hasAiApiKey: Boolean(revealedSecret),
          aiKeyPreview: '',
          aiKeyStorage: storedSecret ? 'available' : 'none',
        }
      : publicSecretMeta(storedSecret)),
    browserExtensionEnabled: row.browser_extension_enabled !== undefined ? Boolean(row.browser_extension_enabled) : DEFAULT_SETTINGS.browserExtensionEnabled,
    browserCaptureHosts: row.browser_capture_hosts !== undefined ? Boolean(row.browser_capture_hosts) : DEFAULT_SETTINGS.browserCaptureHosts,
    browserCaptureTitles: row.browser_capture_titles !== undefined ? Boolean(row.browser_capture_titles) : DEFAULT_SETTINGS.browserCaptureTitles,
    browserCaptureAudioTitles: row.browser_capture_audio_titles !== undefined ? Boolean(row.browser_capture_audio_titles) : DEFAULT_SETTINGS.browserCaptureAudioTitles,
    trackingConsentGranted: Boolean(row.tracking_consent_granted),
    trackingConsentVersion: row.tracking_consent_version || 0,
    trackingConsentAt: row.tracking_consent_at || 0,
  }
}

function mapProfile(row) {
  if (!row) return { ...DEFAULT_PROFILE }
  return {
    ...DEFAULT_PROFILE,
    ...parseJsonField(row.profile_json, {}),
  }
}

function mapSyncState(row) {
  if (!row) {
    return {
      dirty: false,
      dirtySince: 0,
      lastSyncedAt: 0,
      lastRemoteUpdatedAt: 0,
      lastLocalUpdatedAt: 0,
      lastError: '',
      conflictDetectedAt: 0,
      pendingReason: '',
    }
  }

  return {
    dirty: Boolean(row.dirty),
    dirtySince: Number(row.dirty_since || 0),
    lastSyncedAt: Number(row.last_synced_at || 0),
    lastRemoteUpdatedAt: Number(row.last_remote_updated_at || 0),
    lastLocalUpdatedAt: Number(row.last_local_updated_at || 0),
    lastError: row.last_error || '',
    conflictDetectedAt: Number(row.conflict_detected_at || 0),
    pendingReason: row.pending_reason || '',
  }
}

function toWorkspaceSyncStateRow(userId, syncState = {}) {
  const normalized = mapSyncState(syncState)
  return {
    user_id: userId,
    dirty: normalized.dirty ? 1 : 0,
    dirty_since: normalized.dirtySince || 0,
    last_synced_at: normalized.lastSyncedAt || 0,
    last_remote_updated_at: normalized.lastRemoteUpdatedAt || 0,
    last_local_updated_at: normalized.lastLocalUpdatedAt || 0,
    last_error: normalized.lastError || '',
    conflict_detected_at: normalized.conflictDetectedAt || 0,
    pending_reason: normalized.pendingReason || '',
  }
}

function mapTask(row) {
  return {
    id: row.id,
    parentId: row.parent_task_id ?? null,
    order: row.order_index ?? 0,
    title: row.title,
    desc: row.description,
    status: row.status,
    priority: row.priority,
    habit: row.habit,
    due: row.due_date,
    reminderDate: row.reminder_date || row.due_date || null,
    reminderTime: row.reminder_time || '',
    subtasks: normalizeSubtasks(parseJsonField(row.subtasks_json, [])),
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapHabit(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    targetMinutes: row.target_minutes,
    manualMinutesByDate: parseJsonField(row.manual_minutes_json, {}),
    skipDates: parseJsonField(row.skip_dates_json, []),
    reminderEnabled: Boolean(row.reminder_enabled),
    reminderFrequency: row.reminder_frequency || 'daily',
    reminderTime: row.reminder_time || '',
    reminderDays: parseJsonField(row.reminder_days_json, []),
    reminderLastFiredAt: row.reminder_last_fired_at || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseJsonField(value, fallback = []) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
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

function mapSession(row) {
  return {
    id: row.id,
    date: row.date_key,
    timestamp: row.timestamp,
    taskTitle: row.task_title,
    habit: row.habit,
    linkedTaskId: row.linked_task_id,
    linkedHabitId: row.linked_habit_id,
    sessionType: row.session_type,
    goal: row.goal_text,
    durationSeconds: row.duration_seconds,
    focusScore: row.focus_score,
    keystrokesPerMin: row.keystrokes_per_min,
    totalKeystrokes: row.total_keystrokes,
    totalMouseClicks: row.total_mouse_clicks,
    totalScrollDelta: row.total_scroll_delta,
    mouseIntensity: row.mouse_intensity,
    idleSeconds: row.idle_seconds,
    idleRatio: row.idle_ratio,
    distractions: row.distractions,
    fatigueScore: row.fatigue_score,
    fatigueRisk: row.fatigue_risk,
    primaryApp: row.primary_app,
    switchRate: row.switch_rate,
    windowSwitchCount: row.window_switch_count,
    deepWorkSeconds: row.deep_work_seconds,
    sessionMode: row.session_mode,
    focusQuality: row.focus_quality,
    focusQualityDetail: row.focus_quality_detail,
    pillarScores: parseJsonField(row.pillar_scores_json, {}),
    coach: parseJsonField(row.coach_json, {}),
    bestFlowSeconds: row.best_flow_seconds,
    recoveryCount: row.recovery_count,
    driftCount: row.drift_count,
    productiveSeconds: row.productive_seconds,
    supportingSeconds: row.supporting_seconds,
    unclearSeconds: row.unclear_seconds,
    distractingSeconds: row.distracting_seconds,
    primaryContext: row.primary_context,
    primaryBrowserUrl: row.primary_browser_url,
    primaryContextState: row.primary_context_state,
    primaryContextConfidence: row.primary_context_confidence,
    durationGoal: row.duration_goal,
    focusFormulaVersion: row.focus_formula_version,
    appBreakdown: parseJsonField(row.app_breakdown_json),
    appUsage: parseJsonField(row.app_breakdown_json),
    windowBreakdown: parseJsonField(row.window_breakdown_json),
    activityTimeline: parseJsonField(row.activity_timeline_json),
    timeline: parseJsonField(row.timeline_segments_json),
    timelineSegments: parseJsonField(row.timeline_segments_json),
    distractionLog: parseJsonField(row.distraction_log_json),
    switchLog: parseJsonField(row.switch_log_json),
    statusEvents: parseJsonField(row.status_events_json),
    sessionSummary: parseJsonField(row.session_summary_json, {}),
    telemetrySummary: parseJsonField(row.telemetry_summary_json, {}),
    fatigueDrivers: parseJsonField(row.fatigue_drivers_json, {}),
    createdAt: row.created_at,
  }
}

function mapAmbientEntry(row) {
  return normalizeAmbientEntryPayload({
    id: row.id,
    date: row.date_key,
    ts: row.ts,
    endTs: row.end_ts,
    app: row.app_name,
    appGroup: row.app_group || row.app_name,
    title: row.window_title,
    browserUrl: row.browser_url,
    browserHost: row.browser_host,
    browserPage: row.browser_page,
    duration: row.duration_seconds,
    switches: row.switches,
    category: row.category,
    subcategory: row.subcategory,
    lane: row.lane,
    contextLabel: row.context_label,
    color: row.color,
    productive: row.productive === null || row.productive === undefined ? null : Boolean(row.productive),
    confidence: row.confidence,
    isCustom: Boolean(row.is_custom_rule),
  }, { preferProvidedClassification: true })
}

function mapMediaEntry(row) {
  return normalizeBackgroundMediaPayload({
    id: row.id,
    date: row.date_key,
    ts: row.ts,
    endTs: row.end_ts,
    sourceApp: row.source_app,
    trackTitle: row.track_title,
    artist: row.artist,
    album: row.album,
    playbackState: row.playback_state,
    duration: row.duration_seconds,
    category: row.category,
    lane: row.lane,
    confidence: row.confidence,
    productive: row.productive === null || row.productive === undefined ? null : Boolean(row.productive),
    contextLabel: row.context_label,
    color: row.color,
  }, { customRules: {} })
}

function mapBrowserEventEntry(row, { customRules = {} } = {}) {
  return normalizeBrowserEventEntry({
    id: row.id,
    date: row.date_key,
    ts: row.ts,
    browserApp: row.browser_app,
    browserFamily: row.browser_family,
    eventType: row.event_type,
    tabId: row.tab_id,
    windowId: row.window_id,
    openerTabId: row.opener_tab_id,
    previousTabId: row.previous_tab_id,
    url: row.url,
    host: row.host,
    pageTitle: row.page_title,
    active: Boolean(row.active),
    highlighted: Boolean(row.highlighted),
    audible: Boolean(row.audible),
    muted: Boolean(row.muted),
    pinned: Boolean(row.pinned),
    discarded: Boolean(row.discarded),
    isWindowClosing: Boolean(row.is_window_closing),
    setActiveContext: Boolean(row.set_active_context),
  }, { customRules })
}

function mapInsights(row) {
  if (!row) {
    return { insights: [], generatedAt: 0 }
  }
  return {
    insights: parseJsonField(row.insights_json),
    generatedAt: row.generated_at || 0,
  }
}

function toSqlBoolean(value, fallback = null) {
  if (value === null || value === undefined) return fallback
  return value ? 1 : 0
}

function toAmbientSqlRow(userId, entry, { customRules = {}, preferProvidedClassification = false } = {}) {
  const normalized = normalizeAmbientEntryPayload(entry, { customRules, preferProvidedClassification })
  return {
    id: normalized.id,
    user_id: userId,
    date_key: normalized.date,
    ts: normalized.ts,
    end_ts: normalized.endTs,
    app_name: normalized.app,
    app_group: normalized.appGroup ?? normalized.app,
    window_title: normalized.title ?? '',
    browser_url: normalized.browserUrl ?? '',
    browser_host: normalized.browserHost ?? '',
    browser_page: normalized.browserPage ?? '',
    duration_seconds: normalized.duration ?? 0,
    switches: normalized.switches ?? 0,
    category: normalized.category ?? 'Other',
    subcategory: normalized.subcategory ?? '',
    lane: normalized.lane ?? 'supporting',
    context_label: normalized.contextLabel ?? normalized.app ?? 'Context',
    color: normalized.color ?? '#8E95A3',
    productive: toSqlBoolean(normalized.productive),
    confidence: normalized.confidence ?? 0,
    is_custom_rule: normalized.isCustom ? 1 : 0,
  }
}

function toMediaSqlRow(userId, entry, { customRules = {} } = {}) {
  const normalized = normalizeBackgroundMediaPayload(entry, { customRules })
  return {
    id: normalized.id,
    user_id: userId,
    date_key: normalized.date,
    ts: normalized.ts,
    end_ts: normalized.endTs,
    source_app: normalized.sourceApp,
    track_title: normalized.trackTitle ?? '',
    artist: normalized.artist ?? '',
    album: normalized.album ?? '',
    playback_state: normalized.playbackState ?? '',
    duration_seconds: normalized.duration ?? 0,
    category: normalized.category ?? 'Other',
    lane: normalized.lane ?? 'supporting',
    confidence: normalized.confidence ?? 0,
    productive: toSqlBoolean(normalized.productive),
    context_label: normalized.contextLabel ?? normalized.sourceApp ?? 'Background media',
    color: normalized.color ?? '#8E95A3',
  }
}

function toBrowserEventSqlRow(userId, entry) {
  const normalized = normalizeBrowserEventEntry(entry)
  return {
    id: normalized.id,
    user_id: userId,
    date_key: normalized.date,
    ts: normalized.ts,
    browser_app: normalized.browserApp,
    browser_family: normalized.browserFamily ?? 'chromium',
    event_type: normalized.eventType ?? 'unknown',
    tab_id: normalized.tabId ?? null,
    window_id: normalized.windowId ?? null,
    opener_tab_id: normalized.openerTabId ?? null,
    previous_tab_id: normalized.previousTabId ?? null,
    url: normalized.url ?? '',
    host: normalized.host ?? '',
    page_title: normalized.pageTitle ?? '',
    active: normalized.active ? 1 : 0,
    highlighted: normalized.highlighted ? 1 : 0,
    audible: normalized.audible ? 1 : 0,
    muted: normalized.muted ? 1 : 0,
    pinned: normalized.pinned ? 1 : 0,
    discarded: normalized.discarded ? 1 : 0,
    is_window_closing: normalized.isWindowClosing ? 1 : 0,
    set_active_context: normalized.setActiveContext ? 1 : 0,
  }
}

export function createDataRepository() {
  let database
  let backendStatus

  try {
    database = initDatabase()
    backendStatus = {
      kind: 'sqlite',
      available: true,
      message: 'Running on the SQLite repository.',
    }
  } catch (error) {
    console.warn('[Velance] Native SQLite unavailable, using JSON fallback repository:', error?.message || error)
    const fallbackRepository = createJsonRepository()
    const fallbackMessage = error?.message || 'Running on the JSON fallback repository.'
    return {
      ...fallbackRepository,
      getBackendStatus: () => ({
        ...(fallbackRepository.getBackendStatus ? fallbackRepository.getBackendStatus() : { kind: 'json-fallback', available: true }),
        message: fallbackMessage,
      }),
    }
  }

  const getSettingsStmt = database.prepare(`
    SELECT *
    FROM settings
    WHERE user_id = ?
  `)

  const getSchemaMetaStmt = database.prepare(`
    SELECT value
    FROM schema_meta
    WHERE key = ?
  `)

  const upsertSchemaMetaStmt = database.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `)

  const upsertSettingsStmt = database.prepare(`
    INSERT INTO settings (
      user_id,
      is_dark,
      tracking_enabled,
      keystroke_enabled,
      mouse_enabled,
      notifications_enabled,
      break_reminders,
      break_interval_minutes,
      data_retention_days,
      ai_provider,
      ai_model,
      ai_base_url,
      ai_insights_enabled,
      ai_last_tested_at,
      ai_last_test_ok,
      ai_last_test_message,
      gemini_api_key,
      ai_key_provider,
      browser_extension_enabled,
      browser_capture_hosts,
      browser_capture_titles,
      browser_capture_audio_titles,
      tracking_consent_granted,
      tracking_consent_version,
      tracking_consent_at,
      updated_at
    ) VALUES (
      @user_id,
      @is_dark,
      @tracking_enabled,
      @keystroke_enabled,
      @mouse_enabled,
      @notifications_enabled,
      @break_reminders,
      @break_interval_minutes,
      @data_retention_days,
      @ai_provider,
      @ai_model,
      @ai_base_url,
      @ai_insights_enabled,
      @ai_last_tested_at,
      @ai_last_test_ok,
      @ai_last_test_message,
      @gemini_api_key,
      @ai_key_provider,
      @browser_extension_enabled,
      @browser_capture_hosts,
      @browser_capture_titles,
      @browser_capture_audio_titles,
      @tracking_consent_granted,
      @tracking_consent_version,
      @tracking_consent_at,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(user_id) DO UPDATE SET
      is_dark = excluded.is_dark,
      tracking_enabled = excluded.tracking_enabled,
      keystroke_enabled = excluded.keystroke_enabled,
      mouse_enabled = excluded.mouse_enabled,
      notifications_enabled = excluded.notifications_enabled,
      break_reminders = excluded.break_reminders,
      break_interval_minutes = excluded.break_interval_minutes,
      data_retention_days = excluded.data_retention_days,
      ai_provider = excluded.ai_provider,
      ai_model = excluded.ai_model,
      ai_base_url = excluded.ai_base_url,
      ai_insights_enabled = excluded.ai_insights_enabled,
      ai_last_tested_at = excluded.ai_last_tested_at,
      ai_last_test_ok = excluded.ai_last_test_ok,
      ai_last_test_message = excluded.ai_last_test_message,
      gemini_api_key = excluded.gemini_api_key,
      ai_key_provider = excluded.ai_key_provider,
      browser_extension_enabled = excluded.browser_extension_enabled,
      browser_capture_hosts = excluded.browser_capture_hosts,
      browser_capture_titles = excluded.browser_capture_titles,
      browser_capture_audio_titles = excluded.browser_capture_audio_titles,
      tracking_consent_granted = excluded.tracking_consent_granted,
      tracking_consent_version = excluded.tracking_consent_version,
      tracking_consent_at = excluded.tracking_consent_at,
      updated_at = CURRENT_TIMESTAMP
  `)

  const getWorkspaceMetaStmt = database.prepare(`
    SELECT *
    FROM workspace_meta
    WHERE user_id = ?
  `)

  const upsertWorkspaceMetaStmt = database.prepare(`
    INSERT INTO workspace_meta (
      user_id,
      profile_json,
      legacy_migration_completed,
      legacy_migrated_at,
      updated_at
    ) VALUES (
      @user_id,
      @profile_json,
      @legacy_migration_completed,
      @legacy_migrated_at,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(user_id) DO UPDATE SET
      profile_json = excluded.profile_json,
      legacy_migration_completed = excluded.legacy_migration_completed,
      legacy_migrated_at = excluded.legacy_migrated_at,
      updated_at = CURRENT_TIMESTAMP
  `)

  const getWorkspaceSyncStateStmt = database.prepare(`
    SELECT *
    FROM workspace_sync_state
    WHERE user_id = ?
  `)

  const upsertWorkspaceSyncStateStmt = database.prepare(`
    INSERT INTO workspace_sync_state (
      user_id,
      dirty,
      dirty_since,
      last_synced_at,
      last_remote_updated_at,
      last_local_updated_at,
      last_error,
      conflict_detected_at,
      pending_reason,
      updated_at
    ) VALUES (
      @user_id,
      @dirty,
      @dirty_since,
      @last_synced_at,
      @last_remote_updated_at,
      @last_local_updated_at,
      @last_error,
      @conflict_detected_at,
      @pending_reason,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(user_id) DO UPDATE SET
      dirty = excluded.dirty,
      dirty_since = excluded.dirty_since,
      last_synced_at = excluded.last_synced_at,
      last_remote_updated_at = excluded.last_remote_updated_at,
      last_local_updated_at = excluded.last_local_updated_at,
      last_error = excluded.last_error,
      conflict_detected_at = excluded.conflict_detected_at,
      pending_reason = excluded.pending_reason,
      updated_at = CURRENT_TIMESTAMP
  `)

  const listTasksStmt = database.prepare(`
    SELECT *
    FROM tasks
    WHERE user_id = ?
    ORDER BY created_at DESC
  `)

  const upsertTaskStmt = database.prepare(`
    INSERT INTO tasks (
      id,
      user_id,
      parent_task_id,
      order_index,
      title,
      description,
      status,
      priority,
      habit,
      due_date,
      reminder_date,
      reminder_time,
      subtasks_json,
      completed_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @user_id,
      @parent_task_id,
      @order_index,
      @title,
      @description,
      @status,
      @priority,
      @habit,
      @due_date,
      @reminder_date,
      @reminder_time,
      @subtasks_json,
      @completed_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      parent_task_id = excluded.parent_task_id,
      order_index = excluded.order_index,
      title = excluded.title,
      description = excluded.description,
      status = excluded.status,
      priority = excluded.priority,
      habit = excluded.habit,
      due_date = excluded.due_date,
      reminder_date = excluded.reminder_date,
      reminder_time = excluded.reminder_time,
      subtasks_json = excluded.subtasks_json,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `)

  const deleteTaskStmt = database.prepare(`
    DELETE FROM tasks
    WHERE user_id = ? AND id = ?
  `)

  const listHabitsStmt = database.prepare(`
    SELECT *
    FROM habits
    WHERE user_id = ?
    ORDER BY created_at DESC
  `)

  const upsertHabitStmt = database.prepare(`
    INSERT INTO habits (
      id,
      user_id,
      name,
      icon,
      color,
      target_minutes,
      manual_minutes_json,
      skip_dates_json,
      reminder_enabled,
      reminder_frequency,
      reminder_time,
      reminder_days_json,
      reminder_last_fired_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @user_id,
      @name,
      @icon,
      @color,
      @target_minutes,
      @manual_minutes_json,
      @skip_dates_json,
      @reminder_enabled,
      @reminder_frequency,
      @reminder_time,
      @reminder_days_json,
      @reminder_last_fired_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      name = excluded.name,
      icon = excluded.icon,
      color = excluded.color,
      target_minutes = excluded.target_minutes,
      manual_minutes_json = excluded.manual_minutes_json,
      skip_dates_json = excluded.skip_dates_json,
      reminder_enabled = excluded.reminder_enabled,
      reminder_frequency = excluded.reminder_frequency,
      reminder_time = excluded.reminder_time,
      reminder_days_json = excluded.reminder_days_json,
      reminder_last_fired_at = excluded.reminder_last_fired_at,
      updated_at = excluded.updated_at
  `)

  const deleteHabitStmt = database.prepare(`
    DELETE FROM habits
    WHERE user_id = ? AND id = ?
  `)

  const listSessionsStmt = database.prepare(`
    SELECT *
    FROM focus_sessions
    WHERE user_id = ?
    ORDER BY timestamp DESC
  `)

  const upsertSessionStmt = database.prepare(`
    INSERT INTO focus_sessions (
      id,
      user_id,
      task_title,
      habit,
      linked_task_id,
      linked_habit_id,
      session_type,
      goal_text,
      date_key,
      timestamp,
      duration_seconds,
      focus_score,
      keystrokes_per_min,
      total_keystrokes,
      total_mouse_clicks,
      total_scroll_delta,
      mouse_intensity,
      idle_seconds,
      idle_ratio,
      distractions,
      fatigue_risk,
      primary_app,
      switch_rate,
      window_switch_count,
      deep_work_seconds,
      session_mode,
      focus_quality,
      focus_quality_detail,
      pillar_scores_json,
      coach_json,
      best_flow_seconds,
      recovery_count,
      drift_count,
      productive_seconds,
      supporting_seconds,
      unclear_seconds,
      distracting_seconds,
      fatigue_score,
      primary_context,
      primary_browser_url,
      primary_context_state,
      primary_context_confidence,
      duration_goal,
      focus_formula_version,
      app_breakdown_json,
      window_breakdown_json,
      activity_timeline_json,
      timeline_segments_json,
      distraction_log_json,
      switch_log_json,
      status_events_json,
      session_summary_json,
      telemetry_summary_json,
      fatigue_drivers_json,
      created_at
    ) VALUES (
      @id,
      @user_id,
      @task_title,
      @habit,
      @linked_task_id,
      @linked_habit_id,
      @session_type,
      @goal_text,
      @date_key,
      @timestamp,
      @duration_seconds,
      @focus_score,
      @keystrokes_per_min,
      @total_keystrokes,
      @total_mouse_clicks,
      @total_scroll_delta,
      @mouse_intensity,
      @idle_seconds,
      @idle_ratio,
      @distractions,
      @fatigue_risk,
      @primary_app,
      @switch_rate,
      @window_switch_count,
      @deep_work_seconds,
      @session_mode,
      @focus_quality,
      @focus_quality_detail,
      @pillar_scores_json,
      @coach_json,
      @best_flow_seconds,
      @recovery_count,
      @drift_count,
      @productive_seconds,
      @supporting_seconds,
      @unclear_seconds,
      @distracting_seconds,
      @fatigue_score,
      @primary_context,
      @primary_browser_url,
      @primary_context_state,
      @primary_context_confidence,
      @duration_goal,
      @focus_formula_version,
      @app_breakdown_json,
      @window_breakdown_json,
      @activity_timeline_json,
      @timeline_segments_json,
      @distraction_log_json,
      @switch_log_json,
      @status_events_json,
      @session_summary_json,
      @telemetry_summary_json,
      @fatigue_drivers_json,
      @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      task_title = excluded.task_title,
      habit = excluded.habit,
      linked_task_id = excluded.linked_task_id,
      linked_habit_id = excluded.linked_habit_id,
      session_type = excluded.session_type,
      goal_text = excluded.goal_text,
      date_key = excluded.date_key,
      timestamp = excluded.timestamp,
      duration_seconds = excluded.duration_seconds,
      focus_score = excluded.focus_score,
      keystrokes_per_min = excluded.keystrokes_per_min,
      total_keystrokes = excluded.total_keystrokes,
      total_mouse_clicks = excluded.total_mouse_clicks,
      total_scroll_delta = excluded.total_scroll_delta,
      mouse_intensity = excluded.mouse_intensity,
      idle_seconds = excluded.idle_seconds,
      idle_ratio = excluded.idle_ratio,
      distractions = excluded.distractions,
      fatigue_risk = excluded.fatigue_risk,
      primary_app = excluded.primary_app,
      switch_rate = excluded.switch_rate,
      window_switch_count = excluded.window_switch_count,
      deep_work_seconds = excluded.deep_work_seconds,
      session_mode = excluded.session_mode,
      focus_quality = excluded.focus_quality,
      focus_quality_detail = excluded.focus_quality_detail,
      pillar_scores_json = excluded.pillar_scores_json,
      coach_json = excluded.coach_json,
      best_flow_seconds = excluded.best_flow_seconds,
      recovery_count = excluded.recovery_count,
      drift_count = excluded.drift_count,
      productive_seconds = excluded.productive_seconds,
      supporting_seconds = excluded.supporting_seconds,
      unclear_seconds = excluded.unclear_seconds,
      distracting_seconds = excluded.distracting_seconds,
      fatigue_score = excluded.fatigue_score,
      primary_context = excluded.primary_context,
      primary_browser_url = excluded.primary_browser_url,
      primary_context_state = excluded.primary_context_state,
      primary_context_confidence = excluded.primary_context_confidence,
      duration_goal = excluded.duration_goal,
      focus_formula_version = excluded.focus_formula_version,
      app_breakdown_json = excluded.app_breakdown_json,
      window_breakdown_json = excluded.window_breakdown_json,
      activity_timeline_json = excluded.activity_timeline_json,
      timeline_segments_json = excluded.timeline_segments_json,
      distraction_log_json = excluded.distraction_log_json,
      switch_log_json = excluded.switch_log_json,
      status_events_json = excluded.status_events_json,
      session_summary_json = excluded.session_summary_json,
      telemetry_summary_json = excluded.telemetry_summary_json,
      fatigue_drivers_json = excluded.fatigue_drivers_json
  `)

  const deleteSessionsByHabitStmt = database.prepare(`
    DELETE FROM focus_sessions
    WHERE user_id = ? AND habit = ?
  `)

  const deleteSessionStmt = database.prepare(`
    DELETE FROM focus_sessions
    WHERE user_id = ? AND id = ?
  `)

  const upsertAmbientEntryStmt = database.prepare(`
    INSERT INTO ambient_activity_logs (
      id,
      user_id,
      date_key,
      ts,
      end_ts,
      app_name,
      app_group,
      window_title,
      browser_url,
      browser_host,
      browser_page,
      duration_seconds,
      switches,
      category,
      subcategory,
      lane,
      context_label,
      color,
      productive,
      confidence,
      is_custom_rule
    ) VALUES (
      @id,
      @user_id,
      @date_key,
      @ts,
      @end_ts,
      @app_name,
      @app_group,
      @window_title,
      @browser_url,
      @browser_host,
      @browser_page,
      @duration_seconds,
      @switches,
      @category,
      @subcategory,
      @lane,
      @context_label,
      @color,
      @productive,
      @confidence,
      @is_custom_rule
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      date_key = excluded.date_key,
      ts = excluded.ts,
      end_ts = excluded.end_ts,
      app_name = excluded.app_name,
      app_group = excluded.app_group,
      window_title = excluded.window_title,
      browser_url = excluded.browser_url,
      browser_host = excluded.browser_host,
      browser_page = excluded.browser_page,
      duration_seconds = excluded.duration_seconds,
      switches = excluded.switches,
      category = excluded.category,
      subcategory = excluded.subcategory,
      lane = excluded.lane,
      context_label = excluded.context_label,
      color = excluded.color,
      productive = excluded.productive,
      confidence = excluded.confidence,
      is_custom_rule = excluded.is_custom_rule
  `)

  const listAmbientByUserStmt = database.prepare(`
    SELECT *
    FROM ambient_activity_logs
    WHERE user_id = ?
    ORDER BY ts ASC
  `)

  const upsertMediaEntryStmt = database.prepare(`
    INSERT INTO background_media_logs (
      id,
      user_id,
      date_key,
      ts,
      end_ts,
      source_app,
      track_title,
      artist,
      album,
      playback_state,
      duration_seconds,
      category,
      lane,
      confidence,
      productive,
      context_label,
      color
    ) VALUES (
      @id,
      @user_id,
      @date_key,
      @ts,
      @end_ts,
      @source_app,
      @track_title,
      @artist,
      @album,
      @playback_state,
      @duration_seconds,
      @category,
      @lane,
      @confidence,
      @productive,
      @context_label,
      @color
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      date_key = excluded.date_key,
      ts = excluded.ts,
      end_ts = excluded.end_ts,
      source_app = excluded.source_app,
      track_title = excluded.track_title,
      artist = excluded.artist,
      album = excluded.album,
      playback_state = excluded.playback_state,
      duration_seconds = excluded.duration_seconds,
      category = excluded.category,
      lane = excluded.lane,
      confidence = excluded.confidence,
      productive = excluded.productive,
      context_label = excluded.context_label,
      color = excluded.color
  `)

  const listMediaByUserStmt = database.prepare(`
    SELECT *
    FROM background_media_logs
    WHERE user_id = ?
    ORDER BY ts ASC
  `)

  const upsertBrowserEventStmt = database.prepare(`
    INSERT INTO browser_activity_events (
      id,
      user_id,
      date_key,
      ts,
      browser_app,
      browser_family,
      event_type,
      tab_id,
      window_id,
      opener_tab_id,
      previous_tab_id,
      url,
      host,
      page_title,
      active,
      highlighted,
      audible,
      muted,
      pinned,
      discarded,
      is_window_closing,
      set_active_context
    ) VALUES (
      @id,
      @user_id,
      @date_key,
      @ts,
      @browser_app,
      @browser_family,
      @event_type,
      @tab_id,
      @window_id,
      @opener_tab_id,
      @previous_tab_id,
      @url,
      @host,
      @page_title,
      @active,
      @highlighted,
      @audible,
      @muted,
      @pinned,
      @discarded,
      @is_window_closing,
      @set_active_context
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      date_key = excluded.date_key,
      ts = excluded.ts,
      browser_app = excluded.browser_app,
      browser_family = excluded.browser_family,
      event_type = excluded.event_type,
      tab_id = excluded.tab_id,
      window_id = excluded.window_id,
      opener_tab_id = excluded.opener_tab_id,
      previous_tab_id = excluded.previous_tab_id,
      url = excluded.url,
      host = excluded.host,
      page_title = excluded.page_title,
      active = excluded.active,
      highlighted = excluded.highlighted,
      audible = excluded.audible,
      muted = excluded.muted,
      pinned = excluded.pinned,
      discarded = excluded.discarded,
      is_window_closing = excluded.is_window_closing,
      set_active_context = excluded.set_active_context
  `)

  const listBrowserEventsByUserStmt = database.prepare(`
    SELECT *
    FROM browser_activity_events
    WHERE user_id = ?
    ORDER BY ts ASC
  `)

  const listCustomRulesStmt = database.prepare(`
    SELECT *
    FROM custom_classification_rules
    WHERE user_id = ?
  `)

  const upsertCustomRuleStmt = database.prepare(`
    INSERT INTO custom_classification_rules (
      match_text,
      user_id,
      category,
      subcategory,
      color,
      productive,
      lane
    ) VALUES (
      @match_text,
      @user_id,
      @category,
      @subcategory,
      @color,
      @productive,
      @lane
    )
    ON CONFLICT(match_text) DO UPDATE SET
      user_id = excluded.user_id,
      category = excluded.category,
      subcategory = excluded.subcategory,
      color = excluded.color,
      productive = excluded.productive,
      lane = excluded.lane
  `)

  const deleteCustomRuleStmt = database.prepare(`
    DELETE FROM custom_classification_rules
    WHERE user_id = ? AND match_text = ?
  `)

  const getInsightCacheStmt = database.prepare(`
    SELECT *
    FROM insight_cache
    WHERE user_id = ?
  `)

  const upsertInsightCacheStmt = database.prepare(`
    INSERT INTO insight_cache (
      user_id,
      insights_json,
      generated_at
    ) VALUES (
      @user_id,
      @insights_json,
      @generated_at
    )
    ON CONFLICT(user_id) DO UPDATE SET
      insights_json = excluded.insights_json,
      generated_at = excluded.generated_at
  `)

  const clearInsightCacheStmt = database.prepare(`
    DELETE FROM insight_cache
    WHERE user_id = ?
  `)

  const listInsightFeedbackStmt = database.prepare(`
    SELECT insight_id, feedback, note, created_at, updated_at
    FROM insight_feedback
    WHERE user_id = ?
    ORDER BY updated_at DESC
  `)

  const upsertInsightFeedbackStmt = database.prepare(`
    INSERT INTO insight_feedback (
      user_id,
      insight_id,
      feedback,
      note,
      created_at,
      updated_at
    ) VALUES (
      @user_id,
      @insight_id,
      @feedback,
      @note,
      @created_at,
      @updated_at
    )
    ON CONFLICT(user_id, insight_id) DO UPDATE SET
      feedback = excluded.feedback,
      note = excluded.note,
      updated_at = excluded.updated_at
  `)

  const pruneSessionsStmt = database.prepare(`
    DELETE FROM focus_sessions
    WHERE user_id = ? AND timestamp < ?
  `)

  const pruneAmbientStmt = database.prepare(`
    DELETE FROM ambient_activity_logs
    WHERE user_id = ? AND end_ts < ?
  `)

  const pruneMediaStmt = database.prepare(`
    DELETE FROM background_media_logs
    WHERE user_id = ? AND end_ts < ?
  `)

  const pruneBrowserEventsStmt = database.prepare(`
    DELETE FROM browser_activity_events
    WHERE user_id = ? AND ts < ?
  `)

  const pruneInsightCacheStmt = database.prepare(`
    DELETE FROM insight_cache
    WHERE user_id = ? AND generated_at < ?
  `)

  const clearSettingsStmt = database.prepare(`
    DELETE FROM settings
    WHERE user_id = ?
  `)

  const clearWorkspaceMetaStmt = database.prepare(`
    DELETE FROM workspace_meta
    WHERE user_id = ?
  `)

  const clearWorkspaceSyncStateStmt = database.prepare(`
    DELETE FROM workspace_sync_state
    WHERE user_id = ?
  `)

  const clearTasksStmt = database.prepare(`
    DELETE FROM tasks
    WHERE user_id = ?
  `)

  const clearHabitsStmt = database.prepare(`
    DELETE FROM habits
    WHERE user_id = ?
  `)

  const clearSessionsStmt = database.prepare(`
    DELETE FROM focus_sessions
    WHERE user_id = ?
  `)

  const clearAmbientStmt = database.prepare(`
    DELETE FROM ambient_activity_logs
    WHERE user_id = ?
  `)

  const clearMediaStmt = database.prepare(`
    DELETE FROM background_media_logs
    WHERE user_id = ?
  `)

  const clearBrowserEventsStmt = database.prepare(`
    DELETE FROM browser_activity_events
    WHERE user_id = ?
  `)

  const clearCustomRulesStmt = database.prepare(`
    DELETE FROM custom_classification_rules
    WHERE user_id = ?
  `)

  const clearAllUserDataTxn = database.transaction((userId) => {
    clearInsightCacheStmt.run(userId)
    clearBrowserEventsStmt.run(userId)
    clearMediaStmt.run(userId)
    clearAmbientStmt.run(userId)
    clearCustomRulesStmt.run(userId)
    clearSessionsStmt.run(userId)
    clearTasksStmt.run(userId)
    clearHabitsStmt.run(userId)
    clearSettingsStmt.run(userId)
    clearWorkspaceMetaStmt.run(userId)
    clearWorkspaceSyncStateStmt.run(userId)
  })

  const replaceSyncSnapshotTxn = database.transaction((userId, snapshot = {}) => {
    const existingWorkspace = getWorkspaceMetaStmt.get(userId)
    const mergedProfile = {
      ...mapProfile(existingWorkspace),
      ...((snapshot && typeof snapshot.profile === 'object' && snapshot.profile) || {}),
    }
    const mergedSettings = {
      ...DEFAULT_SETTINGS,
      ...mapSettings(getSettingsStmt.get(userId), { includeSecrets: true }),
      ...((snapshot && typeof snapshot.settings === 'object' && snapshot.settings) || {}),
    }
    const existingStoredSecret = getSettingsStmt.get(userId)?.gemini_api_key || ''
    const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : []
    const habits = Array.isArray(snapshot?.habits) ? snapshot.habits : []
    const sessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : []
    const customRules = sanitizeCustomRuleEntries(
      snapshot?.customRules && typeof snapshot.customRules === 'object'
        ? Object.entries(snapshot.customRules)
        : [],
    )
    const insights = Array.isArray(snapshot?.insightCache?.insights) ? snapshot.insightCache.insights : []
    const generatedAt = Number(snapshot?.insightCache?.generatedAt || 0)

    clearInsightCacheStmt.run(userId)
    clearCustomRulesStmt.run(userId)
    clearSessionsStmt.run(userId)
    clearTasksStmt.run(userId)
    clearHabitsStmt.run(userId)

    upsertSettingsStmt.run({
      user_id: userId,
      is_dark: mergedSettings.isDark ? 1 : 0,
      tracking_enabled: mergedSettings.trackingEnabled ? 1 : 0,
      keystroke_enabled: mergedSettings.keystrokeEnabled ? 1 : 0,
      mouse_enabled: mergedSettings.mouseEnabled ? 1 : 0,
      notifications_enabled: mergedSettings.notificationsEnabled ? 1 : 0,
      break_reminders: mergedSettings.breakReminders ? 1 : 0,
      break_interval_minutes: mergedSettings.breakIntervalMinutes ?? DEFAULT_SETTINGS.breakIntervalMinutes,
      data_retention_days: mergedSettings.dataRetentionDays ?? DEFAULT_SETTINGS.dataRetentionDays,
      ai_provider: mergedSettings.aiProvider ?? DEFAULT_SETTINGS.aiProvider,
      ai_model: mergedSettings.aiModel ?? DEFAULT_SETTINGS.aiModel,
      ai_base_url: mergedSettings.aiBaseUrl ?? DEFAULT_SETTINGS.aiBaseUrl,
      ai_insights_enabled: mergedSettings.aiInsightsEnabled === false ? 0 : 1,
      ai_last_tested_at: mergedSettings.aiLastTestedAt ?? DEFAULT_SETTINGS.aiLastTestedAt,
      ai_last_test_ok: mergedSettings.aiLastTestOk ? 1 : 0,
      ai_last_test_message: mergedSettings.aiLastTestMessage ?? DEFAULT_SETTINGS.aiLastTestMessage,
      gemini_api_key: resolveStoredSecretForSave(mergedSettings, existingStoredSecret),
      ai_key_provider: mergedSettings.aiKeyProvider || (resolveStoredSecretForSave(mergedSettings, existingStoredSecret) ? mergedSettings.aiProvider : ''),
      browser_extension_enabled: mergedSettings.browserExtensionEnabled ? 1 : 0,
      browser_capture_hosts: mergedSettings.browserCaptureHosts ? 1 : 0,
      browser_capture_titles: mergedSettings.browserCaptureTitles ? 1 : 0,
      browser_capture_audio_titles: mergedSettings.browserCaptureAudioTitles ? 1 : 0,
      tracking_consent_granted: mergedSettings.trackingConsentGranted ? 1 : 0,
      tracking_consent_version: mergedSettings.trackingConsentVersion ?? 0,
      tracking_consent_at: mergedSettings.trackingConsentAt ?? 0,
    })

    upsertWorkspaceMetaStmt.run({
      user_id: userId,
      profile_json: JSON.stringify(mergedProfile),
      legacy_migration_completed: existingWorkspace?.legacy_migration_completed ? 1 : 0,
      legacy_migrated_at: existingWorkspace?.legacy_migrated_at || 0,
    })

    for (const task of tasks) {
      upsertTaskStmt.run({
        id: task.id,
        user_id: userId,
        parent_task_id: task.parentId ?? task.parent_id ?? null,
        order_index: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
        title: task.title ?? '',
        description: task.desc ?? '',
        status: task.status ?? 'to-do',
        priority: task.priority ?? 'Normal',
        habit: task.habit ?? '',
        due_date: task.due ?? null,
        reminder_date: task.reminderDate ?? task.due ?? null,
        reminder_time: task.reminderTime ?? task.reminder ?? '',
        subtasks_json: JSON.stringify(normalizeSubtasks(task.subtasks)),
        completed_at: task.completedAt ?? null,
        created_at: task.createdAt ?? Date.now(),
        updated_at: task.updatedAt ?? task.createdAt ?? Date.now(),
      })
    }

    for (const habit of habits) {
      upsertHabitStmt.run({
        id: habit.id,
        user_id: userId,
        name: habit.name ?? '',
        icon: habit.icon ?? 'other',
        color: habit.color ?? '#00B4D8',
        target_minutes: habit.targetMinutes ?? 60,
        manual_minutes_json: JSON.stringify(habit.manualMinutesByDate ?? {}),
        skip_dates_json: JSON.stringify(Array.isArray(habit.skipDates) ? habit.skipDates : []),
        reminder_enabled: habit.reminderEnabled ? 1 : 0,
        reminder_frequency: habit.reminderFrequency || 'daily',
        reminder_time: habit.reminderTime || '',
        reminder_days_json: JSON.stringify(Array.isArray(habit.reminderDays) ? habit.reminderDays : []),
        reminder_last_fired_at: habit.reminderLastFiredAt ?? 0,
        created_at: habit.createdAt ?? Date.now(),
        updated_at: habit.updatedAt ?? habit.createdAt ?? Date.now(),
      })
    }

    for (const session of sessions) {
      upsertSessionStmt.run({
        id: session.id,
        user_id: userId,
        task_title: session.taskTitle ?? null,
        habit: session.habit ?? null,
        linked_task_id: session.linkedTaskId ?? null,
        linked_habit_id: session.linkedHabitId ?? null,
        session_type: session.sessionType ?? null,
        goal_text: session.goal ?? null,
        date_key: session.date,
        timestamp: session.timestamp ?? Date.now(),
        duration_seconds: session.durationSeconds ?? 0,
        focus_score: session.focusScore ?? 0,
        keystrokes_per_min: session.keystrokesPerMin ?? 0,
        total_keystrokes: session.totalKeystrokes ?? 0,
        total_mouse_clicks: session.totalMouseClicks ?? 0,
        total_scroll_delta: session.totalScrollDelta ?? 0,
        mouse_intensity: session.mouseIntensity ?? 0,
        idle_seconds: session.idleSeconds ?? 0,
        idle_ratio: session.idleRatio ?? 0,
        distractions: session.distractions ?? 0,
        fatigue_risk: session.fatigueRisk ?? 'Low',
        primary_app: session.primaryApp ?? null,
        switch_rate: session.switchRate ?? 0,
        window_switch_count: session.windowSwitchCount ?? 0,
        deep_work_seconds: session.deepWorkSeconds ?? 0,
        session_mode: session.sessionMode ?? 'Guided',
        focus_quality: session.focusQuality ?? '',
        focus_quality_detail: session.focusQualityDetail ?? '',
        pillar_scores_json: JSON.stringify(session.pillarScores ?? {}),
        coach_json: JSON.stringify(session.coach ?? {}),
        best_flow_seconds: session.bestFlowSeconds ?? session.deepWorkSeconds ?? 0,
        recovery_count: session.recoveryCount ?? 0,
        drift_count: session.driftCount ?? 0,
        productive_seconds: session.productiveSeconds ?? 0,
        supporting_seconds: session.supportingSeconds ?? 0,
        unclear_seconds: session.unclearSeconds ?? 0,
        distracting_seconds: session.distractingSeconds ?? 0,
        fatigue_score: session.fatigueScore ?? 0,
        primary_context: session.primaryContext ?? '',
        primary_browser_url: session.primaryBrowserUrl ?? '',
        primary_context_state: session.primaryContextState ?? '',
        primary_context_confidence: session.primaryContextConfidence ?? 0,
        duration_goal: session.durationGoalMinutes ?? session.durationGoal ?? 0,
        focus_formula_version: session.focusFormulaVersion ?? 'focus-v3.0',
        app_breakdown_json: JSON.stringify(session.appUsage ?? session.appBreakdown ?? []),
        window_breakdown_json: JSON.stringify(session.windowBreakdown ?? []),
        activity_timeline_json: JSON.stringify(session.activityTimeline ?? []),
        timeline_segments_json: JSON.stringify(session.timeline ?? session.timelineSegments ?? []),
        distraction_log_json: JSON.stringify(session.distractionLog ?? []),
        switch_log_json: JSON.stringify(session.switchLog ?? []),
        status_events_json: JSON.stringify(session.statusEvents ?? []),
        session_summary_json: JSON.stringify(session.sessionSummary ?? {}),
        telemetry_summary_json: JSON.stringify(session.telemetrySummary ?? {}),
        fatigue_drivers_json: JSON.stringify(session.fatigueDrivers ?? {}),
        created_at: session.createdAt ?? session.timestamp ?? Date.now(),
      })
    }

    for (const { matchText, rule } of customRules) {
      upsertCustomRuleStmt.run({
        match_text: matchText,
        user_id: userId,
        category: rule?.category ?? 'Other',
        subcategory: rule?.subcategory ?? '',
        color: rule?.color ?? '#8E95A3',
        productive: rule?.productive === null || rule?.productive === undefined ? null : (rule.productive ? 1 : 0),
        lane: String(rule?.lane || ''),
      })
    }

    if (insights.length || generatedAt > 0) {
      upsertInsightCacheStmt.run({
        user_id: userId,
        insights_json: JSON.stringify(insights),
        generated_at: generatedAt || Date.now(),
      })
    }
  })

  const restoreWorkspaceBackupTxn = database.transaction((userId, backup = {}) => {
    const normalized = normalizeWorkspaceBackup(backup, userId)
    const sanitizedCustomRules = sanitizeCustomRuleMap(normalized.customRules || {})
    const profile = {
      ...DEFAULT_PROFILE,
      ...(normalized.profile || {}),
    }
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(normalized.settings || {}),
    }
    const restoredAt = Date.now()
    const importedSyncState = normalized.workspace?.syncState || {}

    clearAllUserDataTxn(userId)

    upsertSettingsStmt.run({
      user_id: userId,
      is_dark: settings.isDark ? 1 : 0,
      tracking_enabled: settings.trackingEnabled ? 1 : 0,
      keystroke_enabled: settings.keystrokeEnabled ? 1 : 0,
      mouse_enabled: settings.mouseEnabled ? 1 : 0,
      notifications_enabled: settings.notificationsEnabled ? 1 : 0,
      break_reminders: settings.breakReminders ? 1 : 0,
      break_interval_minutes: settings.breakIntervalMinutes ?? DEFAULT_SETTINGS.breakIntervalMinutes,
      data_retention_days: settings.dataRetentionDays ?? DEFAULT_SETTINGS.dataRetentionDays,
      ai_provider: settings.aiProvider ?? DEFAULT_SETTINGS.aiProvider,
      ai_model: settings.aiModel ?? DEFAULT_SETTINGS.aiModel,
      ai_base_url: settings.aiBaseUrl ?? DEFAULT_SETTINGS.aiBaseUrl,
      ai_insights_enabled: settings.aiInsightsEnabled === false ? 0 : 1,
      ai_last_tested_at: settings.aiLastTestedAt ?? DEFAULT_SETTINGS.aiLastTestedAt,
      ai_last_test_ok: settings.aiLastTestOk ? 1 : 0,
      ai_last_test_message: settings.aiLastTestMessage ?? DEFAULT_SETTINGS.aiLastTestMessage,
      gemini_api_key: resolveStoredSecretForSave(settings),
      ai_key_provider: settings.aiKeyProvider || (resolveStoredSecretForSave(settings) ? settings.aiProvider : ''),
      browser_extension_enabled: settings.browserExtensionEnabled ? 1 : 0,
      browser_capture_hosts: settings.browserCaptureHosts ? 1 : 0,
      browser_capture_titles: settings.browserCaptureTitles ? 1 : 0,
      browser_capture_audio_titles: settings.browserCaptureAudioTitles ? 1 : 0,
      tracking_consent_granted: settings.trackingConsentGranted ? 1 : 0,
      tracking_consent_version: settings.trackingConsentVersion ?? 0,
      tracking_consent_at: settings.trackingConsentAt ?? 0,
    })

    upsertWorkspaceMetaStmt.run({
      user_id: userId,
      profile_json: JSON.stringify(profile),
      legacy_migration_completed: normalized.workspace?.migrationCompleted ? 1 : 0,
      legacy_migrated_at: normalized.workspace?.migratedAt || 0,
    })

    upsertWorkspaceSyncStateStmt.run(toWorkspaceSyncStateRow(userId, {
      dirty: true,
      dirtySince: restoredAt,
      lastSyncedAt: importedSyncState.lastSyncedAt || 0,
      lastRemoteUpdatedAt: importedSyncState.lastRemoteUpdatedAt || 0,
      lastLocalUpdatedAt: restoredAt,
      lastError: '',
      conflictDetectedAt: 0,
      pendingReason: 'restore-import',
    }))

    for (const task of normalized.tasks) {
      if (task?.id === null || task?.id === undefined) continue
      upsertTaskStmt.run({
        id: task.id,
        user_id: userId,
        parent_task_id: task.parentId ?? task.parent_id ?? null,
        order_index: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
        title: task.title ?? '',
        description: task.desc ?? '',
        status: task.status ?? 'to-do',
        priority: task.priority ?? 'Normal',
        habit: task.habit ?? '',
        due_date: task.due ?? null,
        reminder_date: task.reminderDate ?? task.due ?? null,
        reminder_time: task.reminderTime ?? task.reminder ?? '',
        subtasks_json: JSON.stringify(normalizeSubtasks(task.subtasks)),
        completed_at: task.completedAt ?? null,
        created_at: task.createdAt ?? restoredAt,
        updated_at: task.updatedAt ?? task.createdAt ?? restoredAt,
      })
    }

    for (const habit of normalized.habits) {
      if (habit?.id === null || habit?.id === undefined) continue
      upsertHabitStmt.run({
        id: habit.id,
        user_id: userId,
        name: habit.name ?? '',
        icon: habit.icon ?? 'other',
        color: habit.color ?? '#00B4D8',
        target_minutes: habit.targetMinutes ?? 60,
        manual_minutes_json: JSON.stringify(habit.manualMinutesByDate ?? {}),
        skip_dates_json: JSON.stringify(Array.isArray(habit.skipDates) ? habit.skipDates : []),
        reminder_enabled: habit.reminderEnabled ? 1 : 0,
        reminder_frequency: habit.reminderFrequency || 'daily',
        reminder_time: habit.reminderTime || '',
        reminder_days_json: JSON.stringify(Array.isArray(habit.reminderDays) ? habit.reminderDays : []),
        reminder_last_fired_at: habit.reminderLastFiredAt ?? 0,
        created_at: habit.createdAt ?? restoredAt,
        updated_at: habit.updatedAt ?? habit.createdAt ?? restoredAt,
      })
    }

    for (const session of normalized.sessions) {
      if (!session?.id || !session?.date) continue
      upsertSessionStmt.run({
        id: session.id,
        user_id: userId,
        task_title: session.taskTitle ?? null,
        habit: session.habit ?? null,
        linked_task_id: session.linkedTaskId ?? null,
        linked_habit_id: session.linkedHabitId ?? null,
        session_type: session.sessionType ?? null,
        goal_text: session.goal ?? null,
        date_key: session.date,
        timestamp: session.timestamp ?? session.createdAt ?? restoredAt,
        duration_seconds: session.durationSeconds ?? 0,
        focus_score: session.focusScore ?? 0,
        keystrokes_per_min: session.keystrokesPerMin ?? 0,
        total_keystrokes: session.totalKeystrokes ?? 0,
        total_mouse_clicks: session.totalMouseClicks ?? 0,
        total_scroll_delta: session.totalScrollDelta ?? 0,
        mouse_intensity: session.mouseIntensity ?? 0,
        idle_seconds: session.idleSeconds ?? 0,
        idle_ratio: session.idleRatio ?? 0,
        distractions: session.distractions ?? 0,
        fatigue_risk: session.fatigueRisk ?? 'Low',
        primary_app: session.primaryApp ?? null,
        switch_rate: session.switchRate ?? 0,
        window_switch_count: session.windowSwitchCount ?? 0,
        deep_work_seconds: session.deepWorkSeconds ?? 0,
        session_mode: session.sessionMode ?? 'Guided',
        focus_quality: session.focusQuality ?? '',
        focus_quality_detail: session.focusQualityDetail ?? '',
        pillar_scores_json: JSON.stringify(session.pillarScores ?? {}),
        coach_json: JSON.stringify(session.coach ?? {}),
        best_flow_seconds: session.bestFlowSeconds ?? session.deepWorkSeconds ?? 0,
        recovery_count: session.recoveryCount ?? 0,
        drift_count: session.driftCount ?? 0,
        productive_seconds: session.productiveSeconds ?? 0,
        supporting_seconds: session.supportingSeconds ?? 0,
        unclear_seconds: session.unclearSeconds ?? 0,
        distracting_seconds: session.distractingSeconds ?? 0,
        fatigue_score: session.fatigueScore ?? 0,
        primary_context: session.primaryContext ?? '',
        primary_browser_url: session.primaryBrowserUrl ?? '',
        primary_context_state: session.primaryContextState ?? '',
        primary_context_confidence: session.primaryContextConfidence ?? 0,
        duration_goal: session.durationGoalMinutes ?? session.durationGoal ?? 0,
        focus_formula_version: session.focusFormulaVersion ?? 'focus-v3.0',
        app_breakdown_json: JSON.stringify(session.appUsage ?? session.appBreakdown ?? []),
        window_breakdown_json: JSON.stringify(session.windowBreakdown ?? []),
        activity_timeline_json: JSON.stringify(session.activityTimeline ?? []),
        timeline_segments_json: JSON.stringify(session.timeline ?? session.timelineSegments ?? []),
        distraction_log_json: JSON.stringify(session.distractionLog ?? []),
        switch_log_json: JSON.stringify(session.switchLog ?? []),
        status_events_json: JSON.stringify(session.statusEvents ?? []),
        session_summary_json: JSON.stringify(session.sessionSummary ?? {}),
        telemetry_summary_json: JSON.stringify(session.telemetrySummary ?? {}),
        fatigue_drivers_json: JSON.stringify(session.fatigueDrivers ?? {}),
        created_at: session.createdAt ?? session.timestamp ?? restoredAt,
      })
    }

    for (const [matchText, rule] of Object.entries(sanitizedCustomRules)) {
      upsertCustomRuleStmt.run({
        match_text: matchText,
        user_id: userId,
        category: rule.category ?? 'Other',
        subcategory: rule.subcategory ?? '',
        color: rule.color ?? '#8E95A3',
        productive: toSqlBoolean(rule.productive),
        lane: String(rule.lane || ''),
      })
    }

    for (const entry of normalized.ambient) {
      if (!entry?.id || !entry?.date) continue
      upsertAmbientEntryStmt.run(
        toAmbientSqlRow(userId, entry, {
          customRules: sanitizedCustomRules,
          preferProvidedClassification: true,
        }),
      )
    }

    for (const entry of normalized.media) {
      if (!entry?.id || !entry?.date) continue
      upsertMediaEntryStmt.run(
        toMediaSqlRow(userId, entry, {
          customRules: sanitizedCustomRules,
        }),
      )
    }

    for (const entry of normalized.browserEvents) {
      if (!entry?.id || !entry?.date) continue
      upsertBrowserEventStmt.run(toBrowserEventSqlRow(userId, entry))
    }

    if (normalized.insightCache.generatedAt > 0 || normalized.insightCache.insights.length) {
      upsertInsightCacheStmt.run({
        user_id: userId,
        insights_json: JSON.stringify(normalized.insightCache.insights),
        generated_at: normalized.insightCache.generatedAt || restoredAt,
      })
    }
  })

  const pruneUserDataTxn = database.transaction((userId, retentionDays) => {
    const safeDays = Math.max(1, Number(retentionDays) || DEFAULT_SETTINGS.dataRetentionDays)
    const cutoff = Date.now() - (safeDays * 86400000)
    pruneSessionsStmt.run(userId, cutoff)
    pruneAmbientStmt.run(userId, cutoff)
    pruneMediaStmt.run(userId, cutoff)
    pruneBrowserEventsStmt.run(userId, cutoff)
    pruneInsightCacheStmt.run(userId, cutoff)
  })

  const reclassifyTrackingEntriesForUser = (userId) => {
    const customRules = {}
    for (const row of listCustomRulesStmt.all(userId)) {
      const sanitizedRule = sanitizeCustomRuleRecord(row.match_text, row)
      if (!sanitizedRule) {
        deleteCustomRuleStmt.run(userId, String(row.match_text || '').toLowerCase())
        continue
      }
      customRules[sanitizedRule.matchText] = sanitizedRule.rule
    }

    for (const row of listAmbientByUserStmt.all(userId)) {
      const normalizedRow = toAmbientSqlRow(userId, mapAmbientEntry(row), {
        customRules,
        preferProvidedClassification: false,
      })
      upsertAmbientEntryStmt.run(normalizedRow)
    }

    for (const row of listMediaByUserStmt.all(userId)) {
      upsertMediaEntryStmt.run(toMediaSqlRow(userId, mapMediaEntry(row), { customRules }))
    }

    clearInsightCacheStmt.run(userId)
  }

  const reclassifyAmbientEntriesForUser = database.transaction((userId) => {
    reclassifyTrackingEntriesForUser(userId)
  })

  const listKnownUserIdsStmt = database.prepare(`
    SELECT user_id FROM workspace_meta
    UNION
    SELECT user_id FROM settings
    UNION
    SELECT user_id FROM focus_sessions
    UNION
    SELECT user_id FROM ambient_activity_logs
    UNION
    SELECT user_id FROM background_media_logs
    UNION
    SELECT user_id FROM browser_activity_events
    UNION
    SELECT user_id FROM insight_cache
  `)

  const importFallbackStore = database.transaction(() => {
    const importedMarker = getSchemaMetaStmt.get('json_fallback_imported_at')?.value
    if (importedMarker) return

    const existingRows = listKnownUserIdsStmt.all()
    if (existingRows.length > 0) {
      upsertSchemaMetaStmt.run('json_fallback_imported_at', String(Date.now()))
      return
    }

    const fallbackUsers = readFallbackUsers()
    const userIds = Object.keys(fallbackUsers)

    if (!userIds.length) {
      upsertSchemaMetaStmt.run('json_fallback_imported_at', String(Date.now()))
      return
    }

    for (const userId of userIds) {
      const userState = fallbackUsers[userId] || {}
      const sanitizedCustomRules = sanitizeCustomRuleMap(userState.customRules || {})
      const settings = { ...DEFAULT_SETTINGS, ...(userState.settings || {}) }
      const profile = normalizeProfile(userState.profile || {})

      upsertSettingsStmt.run({
        user_id: userId,
        is_dark: settings.isDark ? 1 : 0,
        tracking_enabled: settings.trackingEnabled ? 1 : 0,
        keystroke_enabled: settings.keystrokeEnabled ? 1 : 0,
        mouse_enabled: settings.mouseEnabled ? 1 : 0,
        notifications_enabled: settings.notificationsEnabled ? 1 : 0,
        break_reminders: settings.breakReminders ? 1 : 0,
        break_interval_minutes: settings.breakIntervalMinutes ?? DEFAULT_SETTINGS.breakIntervalMinutes,
        data_retention_days: settings.dataRetentionDays ?? DEFAULT_SETTINGS.dataRetentionDays,
        ai_provider: settings.aiProvider ?? DEFAULT_SETTINGS.aiProvider,
        ai_model: settings.aiModel ?? DEFAULT_SETTINGS.aiModel,
        ai_base_url: settings.aiBaseUrl ?? DEFAULT_SETTINGS.aiBaseUrl,
        ai_insights_enabled: settings.aiInsightsEnabled === false ? 0 : 1,
        ai_last_tested_at: settings.aiLastTestedAt ?? DEFAULT_SETTINGS.aiLastTestedAt,
        ai_last_test_ok: settings.aiLastTestOk ? 1 : 0,
        ai_last_test_message: settings.aiLastTestMessage ?? DEFAULT_SETTINGS.aiLastTestMessage,
        gemini_api_key: resolveStoredSecretForSave(settings),
        ai_key_provider: settings.aiKeyProvider || (resolveStoredSecretForSave(settings) ? settings.aiProvider : ''),
        browser_extension_enabled: settings.browserExtensionEnabled ? 1 : 0,
        browser_capture_hosts: settings.browserCaptureHosts ? 1 : 0,
        browser_capture_titles: settings.browserCaptureTitles ? 1 : 0,
        browser_capture_audio_titles: settings.browserCaptureAudioTitles ? 1 : 0,
        tracking_consent_granted: settings.trackingConsentGranted ? 1 : 0,
        tracking_consent_version: settings.trackingConsentVersion ?? 0,
        tracking_consent_at: settings.trackingConsentAt ?? 0,
      })

      upsertWorkspaceMetaStmt.run({
        user_id: userId,
        profile_json: JSON.stringify(profile),
        legacy_migration_completed: userState.legacyMigrationCompleted ? 1 : 0,
        legacy_migrated_at: userState.legacyMigratedAt || 0,
      })

      upsertWorkspaceSyncStateStmt.run(
        toWorkspaceSyncStateRow(userId, userState.syncState || {}),
      )

      for (const task of userState.tasks || []) {
        if (task?.id === null || task?.id === undefined) continue
        upsertTaskStmt.run({
          id: task.id,
          user_id: userId,
          parent_task_id: task.parentId ?? task.parent_id ?? null,
          order_index: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
          title: task.title ?? '',
          description: task.desc ?? '',
          status: task.status ?? 'to-do',
          priority: task.priority ?? 'Normal',
          habit: task.habit ?? '',
          due_date: task.due ?? null,
          reminder_date: task.reminderDate ?? task.due ?? null,
          reminder_time: task.reminderTime ?? task.reminder ?? '',
          subtasks_json: JSON.stringify(normalizeSubtasks(task.subtasks)),
          completed_at: task.completedAt ?? null,
          created_at: task.createdAt ?? Date.now(),
          updated_at: task.updatedAt ?? task.createdAt ?? Date.now(),
        })
      }

      for (const habit of userState.habits || []) {
        if (habit?.id === null || habit?.id === undefined) continue
        upsertHabitStmt.run({
          id: habit.id,
          user_id: userId,
          name: habit.name ?? '',
          icon: habit.icon ?? 'other',
          color: habit.color ?? '#00B4D8',
          target_minutes: habit.targetMinutes ?? 60,
          manual_minutes_json: JSON.stringify(habit.manualMinutesByDate ?? {}),
          skip_dates_json: JSON.stringify(Array.isArray(habit.skipDates) ? habit.skipDates : []),
          reminder_enabled: habit.reminderEnabled ? 1 : 0,
          reminder_frequency: habit.reminderFrequency || 'daily',
          reminder_time: habit.reminderTime || '',
          reminder_days_json: JSON.stringify(Array.isArray(habit.reminderDays) ? habit.reminderDays : []),
          reminder_last_fired_at: habit.reminderLastFiredAt ?? 0,
          created_at: habit.createdAt ?? Date.now(),
          updated_at: habit.updatedAt ?? habit.createdAt ?? Date.now(),
        })
      }

      for (const session of userState.sessions || []) {
        if (!session?.id || !session?.date) continue
        upsertSessionStmt.run({
          id: session.id,
          user_id: userId,
          task_title: session.taskTitle ?? null,
          habit: session.habit ?? null,
          linked_task_id: session.linkedTaskId ?? null,
          linked_habit_id: session.linkedHabitId ?? null,
          session_type: session.sessionType ?? null,
          goal_text: session.goal ?? null,
          date_key: session.date,
          timestamp: session.timestamp ?? session.createdAt ?? Date.now(),
          duration_seconds: session.durationSeconds ?? 0,
          focus_score: session.focusScore ?? 0,
          keystrokes_per_min: session.keystrokesPerMin ?? 0,
          total_keystrokes: session.totalKeystrokes ?? 0,
          total_mouse_clicks: session.totalMouseClicks ?? 0,
          total_scroll_delta: session.totalScrollDelta ?? 0,
          mouse_intensity: session.mouseIntensity ?? 0,
          idle_seconds: session.idleSeconds ?? 0,
          idle_ratio: session.idleRatio ?? 0,
          distractions: session.distractions ?? 0,
          fatigue_risk: session.fatigueRisk ?? 'Low',
          primary_app: session.primaryApp ?? null,
          switch_rate: session.switchRate ?? 0,
          window_switch_count: session.windowSwitchCount ?? 0,
          deep_work_seconds: session.deepWorkSeconds ?? 0,
          session_mode: session.sessionMode ?? 'Guided',
          focus_quality: session.focusQuality ?? '',
          focus_quality_detail: session.focusQualityDetail ?? '',
          pillar_scores_json: JSON.stringify(session.pillarScores ?? {}),
          coach_json: JSON.stringify(session.coach ?? {}),
          best_flow_seconds: session.bestFlowSeconds ?? session.deepWorkSeconds ?? 0,
          recovery_count: session.recoveryCount ?? 0,
          drift_count: session.driftCount ?? 0,
          productive_seconds: session.productiveSeconds ?? 0,
          supporting_seconds: session.supportingSeconds ?? 0,
          unclear_seconds: session.unclearSeconds ?? 0,
          distracting_seconds: session.distractingSeconds ?? 0,
          fatigue_score: session.fatigueScore ?? 0,
          primary_context: session.primaryContext ?? '',
          primary_browser_url: session.primaryBrowserUrl ?? '',
          primary_context_state: session.primaryContextState ?? '',
          primary_context_confidence: session.primaryContextConfidence ?? 0,
          duration_goal: session.durationGoalMinutes ?? session.durationGoal ?? 0,
          focus_formula_version: session.focusFormulaVersion ?? 'focus-v3.0',
          app_breakdown_json: JSON.stringify(session.appUsage ?? session.appBreakdown ?? []),
          window_breakdown_json: JSON.stringify(session.windowBreakdown ?? []),
          activity_timeline_json: JSON.stringify(session.activityTimeline ?? []),
          timeline_segments_json: JSON.stringify(session.timeline ?? session.timelineSegments ?? []),
          distraction_log_json: JSON.stringify(session.distractionLog ?? []),
          switch_log_json: JSON.stringify(session.switchLog ?? []),
          status_events_json: JSON.stringify(session.statusEvents ?? []),
          session_summary_json: JSON.stringify(session.sessionSummary ?? {}),
          telemetry_summary_json: JSON.stringify(session.telemetrySummary ?? {}),
          fatigue_drivers_json: JSON.stringify(session.fatigueDrivers ?? {}),
          created_at: session.createdAt ?? session.timestamp ?? Date.now(),
        })
      }

      for (const entry of userState.ambient || []) {
        if (!entry?.id || !entry?.date) continue
        upsertAmbientEntryStmt.run(
          toAmbientSqlRow(userId, entry, {
            customRules: sanitizedCustomRules,
            preferProvidedClassification: true,
          }),
        )
      }

      for (const [matchText, rule] of Object.entries(sanitizedCustomRules)) {
        upsertCustomRuleStmt.run({
          match_text: matchText,
          user_id: userId,
          category: rule.category ?? 'Other',
          subcategory: rule.subcategory ?? '',
          color: rule.color ?? '#8E95A3',
          productive: toSqlBoolean(rule.productive),
          lane: String(rule.lane || ''),
        })
      }

      for (const entry of userState.browserEvents || []) {
        if (!entry?.id || !entry?.date) continue
        upsertBrowserEventStmt.run(toBrowserEventSqlRow(userId, entry))
      }

      const insightCache = userState.insightCache || {}
      if ((insightCache.generatedAt ?? 0) > 0 || (insightCache.insights || []).length) {
        upsertInsightCacheStmt.run({
          user_id: userId,
          insights_json: JSON.stringify(insightCache.insights || []),
          generated_at: insightCache.generatedAt ?? Date.now(),
        })
      }
    }

    upsertSchemaMetaStmt.run('json_fallback_imported_at', String(Date.now()))
  })

  const migrateTrackingClassification = database.transaction(() => {
    const currentVersion = getSchemaMetaStmt.get('tracking_classification_version')?.value
    if (currentVersion === TRACKING_CLASSIFICATION_VERSION) return false

    database.exec(`
      UPDATE ambient_activity_logs SET lane = 'supporting' WHERE lane = 'supportive';
      UPDATE background_media_logs SET lane = 'supporting' WHERE lane = 'supportive';
    `)

    for (const row of listKnownUserIdsStmt.all()) {
      if (!row?.user_id) continue
      reclassifyTrackingEntriesForUser(row.user_id)
    }

    upsertSchemaMetaStmt.run('tracking_classification_version', TRACKING_CLASSIFICATION_VERSION)
    return true
  })

  try {
    importFallbackStore()
  } catch (error) {
    console.warn('[Velance] Failed to import JSON fallback data into SQLite:', error?.message || error)
  }

  try {
    migrateTrackingClassification()
  } catch (error) {
    console.warn('[Velance] Failed to migrate tracking classification state:', error?.message || error)
  }

  return {
    getBackendStatus() {
      return { ...backendStatus }
    },

    getBootstrap(userId) {
      const workspace = getWorkspaceMetaStmt.get(userId)
      return {
        backend: this.getBackendStatus(),
        workspace: {
          id: userId,
          migrationCompleted: Boolean(workspace?.legacy_migration_completed),
          migratedAt: Number(workspace?.legacy_migrated_at || 0),
          syncState: mapSyncState(getWorkspaceSyncStateStmt.get(userId)),
        },
        profile: mapProfile(workspace),
        settings: mapSettings(getSettingsStmt.get(userId)),
        tasks: listTasksStmt.all(userId).map(mapTask),
        habits: listHabitsStmt.all(userId).map(mapHabit),
        sessions: listSessionsStmt.all(userId).map(mapSession),
        insightCache: mapInsights(getInsightCacheStmt.get(userId)),
      }
    },

    getAiSettingsForInference(userId) {
      return mapSettings(getSettingsStmt.get(userId), { includeSecrets: true })
    },

    exportWorkspaceBackup(userId) {
      const workspace = getWorkspaceMetaStmt.get(userId)
      const customRules = this.getCustomRules(userId)
      return normalizeWorkspaceBackup({
        backupVersion: WORKSPACE_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        sourceWorkspaceId: userId,
        backendKind: this.getBackendStatus().kind,
        workspace: {
          id: userId,
          migrationCompleted: Boolean(workspace?.legacy_migration_completed),
          migratedAt: Number(workspace?.legacy_migrated_at || 0),
          syncState: mapSyncState(getWorkspaceSyncStateStmt.get(userId)),
        },
        profile: mapProfile(workspace),
        settings: mapSettings(getSettingsStmt.get(userId)),
        tasks: listTasksStmt.all(userId).map(mapTask),
        habits: listHabitsStmt.all(userId).map(mapHabit),
        sessions: listSessionsStmt.all(userId).map(mapSession),
        ambient: listAmbientByUserStmt.all(userId).map(mapAmbientEntry),
        media: listMediaByUserStmt.all(userId).map(mapMediaEntry),
        browserEvents: listBrowserEventsByUserStmt.all(userId).map((row) => mapBrowserEventEntry(row, { customRules })),
        customRules: this.getCustomRules(userId),
        insightCache: mapInsights(getInsightCacheStmt.get(userId)),
      }, userId)
    },

    restoreWorkspaceBackup(userId, backup = {}) {
      restoreWorkspaceBackupTxn(userId, backup)
      return this.getBootstrap(userId)
    },

    replaceSyncSnapshot(userId, snapshot = {}) {
      replaceSyncSnapshotTxn(userId, snapshot)
      return this.getBootstrap(userId)
    },

    getAmbientRange(userId, dateKeys) {
      if (!Array.isArray(dateKeys) || !dateKeys.length) return []

      const placeholders = dateKeys.map(() => '?').join(', ')
      const stmt = database.prepare(`
        SELECT *
        FROM ambient_activity_logs
        WHERE user_id = ? AND date_key IN (${placeholders})
        ORDER BY ts ASC
      `)

      return stmt.all(userId, ...dateKeys).map(mapAmbientEntry)
    },

    getMediaRange(userId, dateKeys) {
      if (!Array.isArray(dateKeys) || !dateKeys.length) return []

      const placeholders = dateKeys.map(() => '?').join(', ')
      const stmt = database.prepare(`
        SELECT *
        FROM background_media_logs
        WHERE user_id = ? AND date_key IN (${placeholders})
        ORDER BY ts ASC
      `)

      return stmt.all(userId, ...dateKeys).map(mapMediaEntry)
    },

    getBrowserEventRange(userId, dateKeys) {
      if (!Array.isArray(dateKeys) || !dateKeys.length) return []
      const customRules = this.getCustomRules(userId)

      const placeholders = dateKeys.map(() => '?').join(', ')
      const stmt = database.prepare(`
        SELECT *
        FROM browser_activity_events
        WHERE user_id = ? AND date_key IN (${placeholders})
        ORDER BY ts ASC
      `)

      return stmt.all(userId, ...dateKeys).map((row) => mapBrowserEventEntry(row, { customRules }))
    },

    getCombinedTrackingRange(userId, dateKeys) {
      return {
        ambient: this.getAmbientRange(userId, dateKeys),
        media: this.getMediaRange(userId, dateKeys),
        browserEvents: this.getBrowserEventRange(userId, dateKeys),
      }
    },

    saveSettings(userId, settings) {
      const existing = getSettingsStmt.get(userId)
      const storedSecret = resolveStoredSecretForSave(settings, existing?.gemini_api_key || '')
      const aiProvider = normalizeAiProvider(settings.aiProvider ?? DEFAULT_SETTINGS.aiProvider)
      const aiModel = normalizeAiModel(aiProvider, settings.aiModel ?? DEFAULT_SETTINGS.aiModel)
      upsertSettingsStmt.run({
        user_id: userId,
        is_dark: settings.isDark ? 1 : 0,
        tracking_enabled: settings.trackingEnabled ? 1 : 0,
        keystroke_enabled: settings.keystrokeEnabled ? 1 : 0,
        mouse_enabled: settings.mouseEnabled ? 1 : 0,
        notifications_enabled: settings.notificationsEnabled ? 1 : 0,
        break_reminders: settings.breakReminders ? 1 : 0,
        break_interval_minutes: settings.breakIntervalMinutes ?? DEFAULT_SETTINGS.breakIntervalMinutes,
        data_retention_days: settings.dataRetentionDays ?? DEFAULT_SETTINGS.dataRetentionDays,
        ai_provider: aiProvider,
        ai_model: aiModel,
        ai_base_url: settings.aiBaseUrl ?? DEFAULT_SETTINGS.aiBaseUrl,
        ai_insights_enabled: settings.aiInsightsEnabled === false ? 0 : 1,
        ai_last_tested_at: settings.aiLastTestedAt ?? DEFAULT_SETTINGS.aiLastTestedAt,
        ai_last_test_ok: settings.aiLastTestOk ? 1 : 0,
        ai_last_test_message: settings.aiLastTestMessage ?? DEFAULT_SETTINGS.aiLastTestMessage,
        gemini_api_key: storedSecret,
        ai_key_provider: settings.aiKeyProvider || (storedSecret ? aiProvider : ''),
        browser_extension_enabled: settings.browserExtensionEnabled ? 1 : 0,
        browser_capture_hosts: settings.browserCaptureHosts ? 1 : 0,
        browser_capture_titles: settings.browserCaptureTitles ? 1 : 0,
        browser_capture_audio_titles: settings.browserCaptureAudioTitles ? 1 : 0,
        tracking_consent_granted: settings.trackingConsentGranted ? 1 : 0,
        tracking_consent_version: settings.trackingConsentVersion ?? 0,
        tracking_consent_at: settings.trackingConsentAt ?? 0,
      })
      return this.getBootstrap(userId).settings
    },

    saveProfile(userId, profile) {
      const existingWorkspace = getWorkspaceMetaStmt.get(userId)
      upsertWorkspaceMetaStmt.run({
        user_id: userId,
        profile_json: JSON.stringify({ ...mapProfile(existingWorkspace), ...profile }),
        legacy_migration_completed: existingWorkspace?.legacy_migration_completed ? 1 : 0,
        legacy_migrated_at: existingWorkspace?.legacy_migrated_at || 0,
      })
      return mapProfile(getWorkspaceMetaStmt.get(userId))
    },

    saveSyncState(userId, syncState) {
      upsertWorkspaceSyncStateStmt.run(
        toWorkspaceSyncStateRow(userId, syncState),
      )
      return mapSyncState(getWorkspaceSyncStateStmt.get(userId))
    },

    upsertTask(userId, task) {
      upsertTaskStmt.run({
        id: task.id,
        user_id: userId,
        parent_task_id: task.parentId ?? task.parent_id ?? null,
        order_index: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
        title: task.title,
        description: task.desc ?? '',
        status: task.status ?? 'to-do',
        priority: task.priority ?? 'Normal',
        habit: task.habit ?? '',
        due_date: task.due ?? null,
        reminder_date: task.reminderDate ?? task.due ?? null,
        reminder_time: task.reminderTime ?? task.reminder ?? '',
        subtasks_json: JSON.stringify(normalizeSubtasks(task.subtasks)),
        completed_at: task.completedAt ?? null,
        created_at: task.createdAt ?? Date.now(),
        updated_at: task.updatedAt ?? Date.now(),
      })
      return listTasksStmt.all(userId).map(mapTask)
    },

    deleteTask(userId, taskId) {
      deleteTaskStmt.run(userId, taskId)
      return listTasksStmt.all(userId).map(mapTask)
    },

    upsertHabit(userId, habit) {
      upsertHabitStmt.run({
        id: habit.id,
        user_id: userId,
        name: habit.name,
        icon: habit.icon ?? 'other',
        color: habit.color ?? '#00B4D8',
        target_minutes: habit.targetMinutes ?? 60,
        manual_minutes_json: JSON.stringify(habit.manualMinutesByDate ?? {}),
        skip_dates_json: JSON.stringify(Array.isArray(habit.skipDates) ? habit.skipDates : []),
        reminder_enabled: habit.reminderEnabled ? 1 : 0,
        reminder_frequency: habit.reminderFrequency || 'daily',
        reminder_time: habit.reminderTime || '',
        reminder_days_json: JSON.stringify(Array.isArray(habit.reminderDays) ? habit.reminderDays : []),
        reminder_last_fired_at: habit.reminderLastFiredAt ?? 0,
        created_at: habit.createdAt ?? Date.now(),
        updated_at: habit.updatedAt ?? Date.now(),
      })
      return listHabitsStmt.all(userId).map(mapHabit)
    },

    deleteHabit(userId, habitId) {
      deleteHabitStmt.run(userId, habitId)
      return listHabitsStmt.all(userId).map(mapHabit)
    },

    upsertSession(userId, session) {
      upsertSessionStmt.run({
        id: session.id,
        user_id: userId,
        task_title: session.taskTitle ?? null,
        habit: session.habit ?? null,
        linked_task_id: session.linkedTaskId ?? null,
        linked_habit_id: session.linkedHabitId ?? null,
        session_type: session.sessionType ?? null,
        goal_text: session.goal ?? null,
        date_key: session.date,
        timestamp: session.timestamp ?? Date.now(),
        duration_seconds: session.durationSeconds ?? 0,
        focus_score: session.focusScore ?? 0,
        keystrokes_per_min: session.keystrokesPerMin ?? 0,
        total_keystrokes: session.totalKeystrokes ?? 0,
        total_mouse_clicks: session.totalMouseClicks ?? 0,
        total_scroll_delta: session.totalScrollDelta ?? 0,
        mouse_intensity: session.mouseIntensity ?? 0,
        idle_seconds: session.idleSeconds ?? 0,
        idle_ratio: session.idleRatio ?? 0,
        distractions: session.distractions ?? 0,
        fatigue_risk: session.fatigueRisk ?? 'Low',
        primary_app: session.primaryApp ?? null,
        switch_rate: session.switchRate ?? 0,
        window_switch_count: session.windowSwitchCount ?? 0,
        deep_work_seconds: session.deepWorkSeconds ?? 0,
        session_mode: session.sessionMode ?? 'Guided',
        focus_quality: session.focusQuality ?? '',
        focus_quality_detail: session.focusQualityDetail ?? '',
        pillar_scores_json: JSON.stringify(session.pillarScores ?? {}),
        coach_json: JSON.stringify(session.coach ?? {}),
        best_flow_seconds: session.bestFlowSeconds ?? session.deepWorkSeconds ?? 0,
        recovery_count: session.recoveryCount ?? 0,
        drift_count: session.driftCount ?? 0,
        productive_seconds: session.productiveSeconds ?? 0,
        supporting_seconds: session.supportingSeconds ?? 0,
        unclear_seconds: session.unclearSeconds ?? 0,
        distracting_seconds: session.distractingSeconds ?? 0,
        fatigue_score: session.fatigueScore ?? 0,
        primary_context: session.primaryContext ?? '',
        primary_browser_url: session.primaryBrowserUrl ?? '',
        primary_context_state: session.primaryContextState ?? '',
        primary_context_confidence: session.primaryContextConfidence ?? 0,
        duration_goal: session.durationGoalMinutes ?? session.durationGoal ?? 0,
        focus_formula_version: session.focusFormulaVersion ?? 'focus-v3.0',
        app_breakdown_json: JSON.stringify(session.appUsage ?? session.appBreakdown ?? []),
        window_breakdown_json: JSON.stringify(session.windowBreakdown ?? []),
        activity_timeline_json: JSON.stringify(session.activityTimeline ?? []),
        timeline_segments_json: JSON.stringify(session.timeline ?? session.timelineSegments ?? []),
        distraction_log_json: JSON.stringify(session.distractionLog ?? []),
        switch_log_json: JSON.stringify(session.switchLog ?? []),
        status_events_json: JSON.stringify(session.statusEvents ?? []),
        session_summary_json: JSON.stringify(session.sessionSummary ?? {}),
        telemetry_summary_json: JSON.stringify(session.telemetrySummary ?? {}),
        fatigue_drivers_json: JSON.stringify(session.fatigueDrivers ?? {}),
        created_at: session.createdAt ?? session.timestamp ?? Date.now(),
      })
      return listSessionsStmt.all(userId).map(mapSession)
    },

    deleteSessionsByHabit(userId, habitName) {
      deleteSessionsByHabitStmt.run(userId, habitName)
      return listSessionsStmt.all(userId).map(mapSession)
    },

    deleteSession(userId, sessionId) {
      deleteSessionStmt.run(userId, sessionId)
      return listSessionsStmt.all(userId).map(mapSession)
    },

    upsertAmbientEntry(userId, entry) {
      const normalizedRow = toAmbientSqlRow(userId, entry, {
        customRules: this.getCustomRules(userId),
      })
      upsertAmbientEntryStmt.run(normalizedRow)
      clearInsightCacheStmt.run(userId)
      return this.getAmbientRange(userId, [normalizedRow.date_key])
    },

    upsertMediaEntry(userId, entry) {
      const normalizedRow = toMediaSqlRow(userId, entry, {
        customRules: this.getCustomRules(userId),
      })
      upsertMediaEntryStmt.run(normalizedRow)
      clearInsightCacheStmt.run(userId)
      return this.getMediaRange(userId, [normalizedRow.date_key])
    },

    upsertBrowserEvent(userId, entry) {
      const normalizedRow = toBrowserEventSqlRow(userId, entry)
      upsertBrowserEventStmt.run(normalizedRow)
      return this.getBrowserEventRange(userId, [normalizedRow.date_key])
    },

    getCustomRules(userId) {
      const rules = {}
      for (const row of listCustomRulesStmt.all(userId)) {
        const sanitizedRule = sanitizeCustomRuleRecord(row.match_text, row)
        if (!sanitizedRule) continue
        rules[sanitizedRule.matchText] = sanitizedRule.rule
      }
      return rules
    },

    upsertCustomRule(userId, matchText, rule) {
      const sanitizedRule = sanitizeCustomRuleRecord(matchText, rule)
      if (!sanitizedRule) {
        deleteCustomRuleStmt.run(userId, String(matchText || '').trim().toLowerCase())
        reclassifyAmbientEntriesForUser(userId)
        return this.getCustomRules(userId)
      }
      upsertCustomRuleStmt.run({
        match_text: sanitizedRule.matchText,
        user_id: userId,
        category: sanitizedRule.rule.category,
        subcategory: sanitizedRule.rule.subcategory,
        color: sanitizedRule.rule.color,
        productive: sanitizedRule.rule.productive === null || sanitizedRule.rule.productive === undefined ? null : (sanitizedRule.rule.productive ? 1 : 0),
        lane: sanitizedRule.rule.lane,
      })
      reclassifyAmbientEntriesForUser(userId)
      return this.getCustomRules(userId)
    },

    deleteCustomRule(userId, matchText) {
      deleteCustomRuleStmt.run(userId, matchText.toLowerCase())
      reclassifyAmbientEntriesForUser(userId)
      return this.getCustomRules(userId)
    },

    saveInsightCache(userId, insights) {
      upsertInsightCacheStmt.run({
        user_id: userId,
        insights_json: JSON.stringify(insights),
        generated_at: Date.now(),
      })
      return mapInsights(getInsightCacheStmt.get(userId))
    },

    getInsightFeedback(userId) {
      return listInsightFeedbackStmt.all(userId).map((row) => ({
        insightId: row.insight_id,
        feedback: row.feedback,
        note: row.note || '',
        createdAt: Number(row.created_at || 0),
        updatedAt: Number(row.updated_at || 0),
      }))
    },

    saveInsightFeedback(userId, feedback = {}) {
      const insightId = String(feedback?.insightId || '').trim()
      const value = String(feedback?.feedback || '').trim().toLowerCase()
      if (!insightId || !['useful', 'not-useful'].includes(value)) {
        return this.getInsightFeedback(userId)
      }
      const existing = listInsightFeedbackStmt.all(userId)
        .find((entry) => entry.insight_id === insightId)
      const now = Date.now()
      upsertInsightFeedbackStmt.run({
        user_id: userId,
        insight_id: insightId,
        feedback: value,
        note: String(feedback?.note || '').slice(0, 240),
        created_at: Number(existing?.created_at || 0) || now,
        updated_at: now,
      })
      return this.getInsightFeedback(userId)
    },

    clearInsightCache(userId) {
      clearInsightCacheStmt.run(userId)
      return mapInsights(getInsightCacheStmt.get(userId))
    },

    async reclassifyTrackingHistory(userId, options = {}) {
      reclassifyAmbientEntriesForUser(userId)
      let aiRulesApplied = 0

      if (typeof options?.resolveClassificationEdgeCases === 'function') {
        const currentRules = this.getCustomRules(userId)
        const resolution = await options.resolveClassificationEdgeCases({
          userId,
          settings: mapSettings(getSettingsStmt.get(userId), { includeSecrets: true }),
          customRules: currentRules,
          ambientEntries: listAmbientByUserStmt.all(userId).map(mapAmbientEntry),
          browserEvents: listBrowserEventsByUserStmt.all(userId).map((row) => mapBrowserEventEntry(row, { customRules: currentRules })),
        })

        const nextRules = Array.isArray(resolution?.rules) ? resolution.rules : []
        for (const rule of nextRules) {
          const sanitizedRule = sanitizeCustomRuleRecord(rule?.matchText, rule)
          if (!sanitizedRule || currentRules[sanitizedRule.matchText]) continue
          upsertCustomRuleStmt.run({
            match_text: sanitizedRule.matchText,
            user_id: userId,
            category: sanitizedRule.rule.category,
            subcategory: sanitizedRule.rule.subcategory,
            color: sanitizedRule.rule.color,
            productive: sanitizedRule.rule.productive === null || sanitizedRule.rule.productive === undefined ? null : (sanitizedRule.rule.productive ? 1 : 0),
            lane: sanitizedRule.rule.lane,
          })
          currentRules[sanitizedRule.matchText] = sanitizedRule.rule
          aiRulesApplied += 1
        }

        if (aiRulesApplied > 0) {
          reclassifyAmbientEntriesForUser(userId)
        }
      }

      upsertSchemaMetaStmt.run('tracking_classification_version', TRACKING_CLASSIFICATION_VERSION)
      return {
        ok: true,
        classificationVersion: TRACKING_CLASSIFICATION_VERSION,
        aiRulesApplied,
      }
    },

    markLegacyMigrationComplete(userId) {
      const existingWorkspace = getWorkspaceMetaStmt.get(userId)
      upsertWorkspaceMetaStmt.run({
        user_id: userId,
        profile_json: JSON.stringify(mapProfile(existingWorkspace)),
        legacy_migration_completed: 1,
        legacy_migrated_at: Date.now(),
      })
      const workspace = getWorkspaceMetaStmt.get(userId)
      return {
        id: userId,
        migrationCompleted: Boolean(workspace?.legacy_migration_completed),
        migratedAt: Number(workspace?.legacy_migrated_at || 0),
      }
    },

    pruneExpiredData(userId, retentionDays) {
      pruneUserDataTxn(userId, retentionDays)
      return this.getBootstrap(userId)
    },

    pruneExpiredDataForAllUsers() {
      const rows = listKnownUserIdsStmt.all()
      for (const row of rows) {
        const userId = row.user_id
        const settings = mapSettings(getSettingsStmt.get(userId))
        pruneUserDataTxn(userId, settings.dataRetentionDays)
      }
      return rows.length
    },

    clearAllUserData(userId) {
      clearAllUserDataTxn(userId)
      return this.getBootstrap(userId)
    },
  }
}
