import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { normalizeAiSettings } from '../../src/services/aiProvider.js'
import { AUTH_OTP_LENGTH, getOtpCopyLabel } from '../../src/services/authConfig.js'
import { buildInsightContext } from '../../src/services/insightContext.js'
import {
  buildDailyChallengeCandidates,
  getDailyChallengeStats,
  pickDailyChallengeCandidate,
} from '../../src/services/dailyChallenge.js'
import { getHabitCompletionStats, getHabitHeatmap, getHabitStreakWithCredits } from '../../src/services/analyticsService.js'
import { hasResolvedTrackingConsent, hasTrackingConsent, canTrackWithSettings } from '../../src/services/trackingConsent.js'
import {
  applyTrackingConsentDecision,
  getTrackingConsentFallbackKey,
  readTrackingConsentFallback,
  writeTrackingConsentFallback,
} from '../../src/services/trackingConsentState.js'
import { formatLocalDateKey, getTodayLocalDateKey } from '../../src/services/dateKey.js'

function run(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (error) {
    console.error(`not ok - ${name}`)
    throw error
  }
}

run('AI settings normalize Gemini defaults and pasted keys', () => {
  const settings = normalizeAiSettings({ geminiApiKey: ' AIza-test-key ', aiModel: '' })

  assert.equal(settings.provider, 'gemini')
  assert.equal(settings.model, 'gemini-3-flash-preview')
  assert.equal(settings.hasKey, true)
  assert.equal(settings.hasUsableKey, true)
})

run('Auth OTP length is release-configurable and user-facing copy follows it', () => {
  assert.equal(AUTH_OTP_LENGTH, 6)
  assert.equal(getOtpCopyLabel(), '6-digit code')
})

run('Auth defaults to password login and keeps email code fallback', () => {
  const authView = readFileSync(new URL('../../src/views/Auth.vue', import.meta.url), 'utf8')
  const authStore = readFileSync(new URL('../../src/store/auth.js', import.meta.url), 'utf8')
  const supabaseLib = readFileSync(new URL('../../src/lib/supabase.js', import.meta.url), 'utf8')

  assert.match(authView, /signinMethod\s*=\s*ref\('password'\)/)
  assert.match(authView, /Use email code instead/)
  assert.match(authView, /Create with email code instead/)
  assert.match(authView, /authUnavailable/)
  assert.doesNotMatch(authView, /[^\x00-\x7F]/)
  assert.match(supabaseLib, /isSupabaseConfigured/)
  assert.match(supabaseLib, /supabaseConfigMessage/)
  assert.match(authStore, /requireAuthConfigured/)
  assert.match(authStore, /signInWithPassword/)
  assert.match(authStore, /signUp/)
})

run('Onboarding is authenticated and scoped to signed-in user state', () => {
  const router = readFileSync(new URL('../../src/router/index.js', import.meta.url), 'utf8')
  const onboardingView = readFileSync(new URL('../../src/views/Onboarding.vue', import.meta.url), 'utf8')

  assert.match(router, /path:\s*'\/onboarding'[\s\S]*requiresAuth:\s*true/)
  assert.match(onboardingView, /function getOnboardingWorkspaceIds/)
  assert.match(onboardingView, /authStore\.user\?\.id/)
  assert.match(onboardingView, /function markOnboardingComplete/)
})

run('Tracking consent blocks telemetry until explicitly resolved and granted', () => {
  const unresolved = { trackingEnabled: true, trackingConsentGranted: false, trackingConsentVersion: 0, trackingConsentAt: 0 }
  const declined = { trackingEnabled: true, trackingConsentGranted: false, trackingConsentVersion: 1, trackingConsentAt: Date.now() }
  const granted = { trackingEnabled: true, trackingConsentGranted: true, trackingConsentVersion: 1, trackingConsentAt: Date.now() }

  assert.equal(hasResolvedTrackingConsent(unresolved), false)
  assert.equal(hasTrackingConsent(unresolved), false)
  assert.equal(canTrackWithSettings(unresolved), false)
  assert.equal(hasResolvedTrackingConsent(declined), true)
  assert.equal(hasTrackingConsent(declined), false)
  assert.equal(canTrackWithSettings(declined), false)
  assert.equal(canTrackWithSettings(granted), true)
})

run('New-user onboarding consent survives hydration fallback', () => {
  const originalLocalStorage = globalThis.localStorage
  const storage = new Map()
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  }

  try {
    const workspaceId = 'new-user-id'
    const at = Date.now()
    const decision = writeTrackingConsentFallback({ workspaceId, granted: true, at })
    const hydratedSettings = {
      trackingEnabled: true,
      trackingConsentGranted: false,
      trackingConsentVersion: 0,
      trackingConsentAt: 0,
    }

    assert.equal(storage.has(getTrackingConsentFallbackKey(workspaceId)), true)
    assert.deepEqual(readTrackingConsentFallback(workspaceId), decision)
    assert.equal(applyTrackingConsentDecision(hydratedSettings, decision), true)
    assert.equal(canTrackWithSettings(hydratedSettings), true)
  } finally {
    globalThis.localStorage = originalLocalStorage
  }
})

run('Declined onboarding consent keeps planning usable but tracking blocked', () => {
  const settings = {
    trackingEnabled: true,
    trackingConsentGranted: false,
    trackingConsentVersion: 0,
    trackingConsentAt: 0,
  }
  const decision = { resolved: true, granted: false, version: 1, at: Date.now() }

  assert.equal(applyTrackingConsentDecision(settings, decision), true)
  assert.equal(hasResolvedTrackingConsent(settings), true)
  assert.equal(hasTrackingConsent(settings), false)
  assert.equal(canTrackWithSettings(settings), false)
  assert.equal(settings.trackingEnabled, false)
})

run('Blocked focus tracking offers a verified one-click consent recovery', () => {
  const store = readFileSync(new URL('../../src/store/velance.js', import.meta.url), 'utf8')
  const focusView = readFileSync(new URL('../../src/views/FocusSession.vue', import.meta.url), 'utf8')

  // Centralized, read-back-verified consent setter in the store.
  assert.match(store, /async function setTrackingConsent/)
  assert.match(store, /applyTrackingConsentDecision\(settings\.value/)
  assert.match(store, /writeTrackingConsentFallback\(\{ workspaceId: currentWorkspaceId\.value/)
  assert.match(store, /getBootstrapData\(currentWorkspaceId\.value\)[\s\S]*trackingConsentGranted/)
  assert.match(store, /\n    setTrackingConsent,\n/)

  // Focus-session block screen exposes the inline grant tied to that setter.
  assert.match(focusView, /async function allowTrackingHere[\s\S]*store\.setTrackingConsent\(true\)/)
  assert.match(focusView, /v-if="!store\.settings\.trackingConsentGranted"[\s\S]*allowTrackingHere/)
})

run('Browser extension uses optional site access for store-ready privacy', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'))
  const popup = readFileSync(new URL('../../extension/popup.js', import.meta.url), 'utf8')
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1:48152/*'])
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*', 'http://*/*'])
  assert.equal(manifest.permissions.includes('scripting'), true)
  assert.deepEqual(manifest.content_scripts, [])
  assert.match(popup, /velance:request-browser-access/)
  assert.doesNotMatch(popup, /chrome\.permissions\.request/)
})

run('Release-facing domains use the Velance public domain', () => {
  const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
  const smtpDocs = readFileSync(new URL('../../docs/SMTP_SETUP.md', import.meta.url), 'utf8')
  const privacy = readFileSync(new URL('../../docs/PRIVACY_POLICY.md', import.meta.url), 'utf8')
  const terms = readFileSync(new URL('../../docs/TERMS.md', import.meta.url), 'utf8')

  assert.match(envExample, /velance\.org/)
  assert.match(smtpDocs, /auth\.velance\.org/)
  assert.match(privacy, /support@velance\.org/)
  assert.match(terms, /support@velance\.org/)
})

run('Release build has no stock Vite starter leftovers', () => {
  assert.equal(existsSync(new URL('../../src/components/HelloWorld.vue', import.meta.url)), false)
  assert.equal(existsSync(new URL('../../public/vite.svg', import.meta.url)), false)
})

run('Windows beta packaging skips unavailable native rebuild toolchain', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const main = readFileSync(new URL('../../electron/main.js', import.meta.url), 'utf8')

  assert.match(pkg.version, /^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/)
  assert.equal(pkg.build?.npmRebuild, false)
  assert.equal(pkg.build?.win?.icon, 'build/icon.ico')
  assert.equal(existsSync(new URL('../../build/icon.ico', import.meta.url)), true)
  assert.equal(pkg.build?.win?.signAndEditExecutable, false)
  assert.match(pkg.build?.win?.artifactName || '', /Velance-Setup-\$\{version\}/)
  assert.match(main, /join\(appDataPath, 'Velance'\)/)
  assert.match(main, /join\(appDataPath, 'velance-app'\)/)
  assert.match(main, /copyFileSync\(legacyPath, nextPath\)/)
  assert.match(main, /app\.setPath\('userData', nextUserDataPath\)/)
  assert.match(main, /app\.commandLine\.appendSwitch\('user-data-dir', nextUserDataPath\)/)
})

run('AI settings recognize hidden saved BYOK keys', () => {
  const settings = normalizeAiSettings({ aiProvider: 'gemini', aiKeyProvider: 'gemini', hasAiApiKey: true, geminiApiKey: '' })

  assert.equal(settings.hasKey, true)
  assert.equal(settings.hasUsableKey, false)
  assert.equal(settings.apiKey, '')
})

run('Settings page keeps controls functional and uncluttered', () => {
  const settingsView = readFileSync(new URL('../../src/views/Settings.vue', import.meta.url), 'utf8')
  const storeView = readFileSync(new URL('../../src/store/velance.js', import.meta.url), 'utf8')
  const appView = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8')

  assert.match(settingsView, /const s = reactive\(\{ \.\.\.\(store\.settings \|\| \{\}\) \}\)/)
  assert.match(settingsView, /function removeAiKey\(\)[\s\S]*clearAiApiKey = true/)
  assert.match(settingsView, /function syncSettingsDraftToStore\(\)[\s\S]*Object\.assign\(store\.settings, \{ \.\.\.s \}\)/)
  assert.match(settingsView, /async function saveSettingChange[\s\S]*syncSettingsDraftToStore\(\)[\s\S]*await store\.saveSettings\(\)/)
  assert.match(settingsView, /async function updateTrackingConsent[\s\S]*s\.trackingConsentGranted = granted[\s\S]*syncSettingsDraftToStore\(\)[\s\S]*await store\.saveSettings\(\)/)
  assert.match(settingsView, /velance:theme-change/)
  assert.match(appView, /velance:theme-change/)
  assert.match(settingsView, /:class="\{ active: browserCapturePreference === mode\.id \}"/)
  assert.match(settingsView, /function toggleBrowserBridge/)
  assert.match(settingsView, /Save privacy settings/)
  assert.match(settingsView, /Save appearance/)
  assert.match(storeView, /function mergePersistedSettingsMeta/)
  assert.match(storeView, /await pruneExpiredData\(settings\.value\.dataRetentionDays, \{ preserveSettings: true \}\)/)
  assert.doesNotMatch(storeView, /const persisted = await saveSettingsRecord\(settings\.value[\s\S]*replaceSettings\(persisted\)/)
  assert.doesNotMatch(settingsView, /class="settings-card account-card"/)
  assert.doesNotMatch(settingsView, /Workspace identity/)
})

run('App shell uses shared page frame and collapsible sidebar', () => {
  const appView = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf8')

  assert.match(appView, /const sidebarCollapsed = ref\(false\)/)
  assert.match(appView, /SIDEBAR_COLLAPSED_STORAGE_KEY/)
  assert.match(appView, /class="\{ 'sidebar-collapsed': sidebarCollapsed \}"/)
  assert.match(appView, /SidebarCloseIcon/)
  assert.match(appView, /transition name="route-soft" mode="out-in"/)
  assert.match(appView, /@keyframes navIconSettle/)
  assert.match(appView, /--app-page-max: 1440px/)
  assert.match(appView, /\.route-shell > :is\([\s\S]*\.dashboard-module[\s\S]*\.settings-module[\s\S]*\.focus-v2[\s\S]*\)/)
  assert.match(appView, /max-width: var\(--app-page-max\) !important/)
  assert.match(appView, /useTaskReminders/)
  assert.match(appView, /startTaskReminderWatcher/)
  assert.match(appView, /PageCoachMarks/)
})

run('Primary pages cooperate with the wide shared layout frame', () => {
  const dashboardView = readFileSync(new URL('../../src/views/Dashboard.vue', import.meta.url), 'utf8')
  const tasksView = readFileSync(new URL('../../src/views/Tasks.vue', import.meta.url), 'utf8')
  const analyticsView = readFileSync(new URL('../../src/views/Analytics.vue', import.meta.url), 'utf8')
  const focusView = readFileSync(new URL('../../src/views/FocusSession.vue', import.meta.url), 'utf8')
  const profileView = readFileSync(new URL('../../src/views/Profile.vue', import.meta.url), 'utf8')
  const habitsView = readFileSync(new URL('../../src/views/Habits.vue', import.meta.url), 'utf8')
  const insightsView = readFileSync(new URL('../../src/views/Insights.vue', import.meta.url), 'utf8')
  const settingsView = readFileSync(new URL('../../src/views/Settings.vue', import.meta.url), 'utf8')

  assert.match(dashboardView, /@media \(min-width: 1280px\)[\s\S]*\.dashboard-grid[\s\S]*minmax\(360px, 0\.9fr\)/)
  assert.match(tasksView, /width: clamp\(340px, 26vw, 390px\)/)
  assert.match(tasksView, /reminderTime/)
  assert.match(tasksView, /reminderDate/)
  assert.match(tasksView, /AppTimeField/)
  assert.match(tasksView, /const kanbanColumns = columns/)
  assert.match(tasksView, /TIMELINE_RANGE_DAYS = 84/)
  assert.match(tasksView, /timelineScrollRef/)
  assert.match(tasksView, /startTimelineDrag/)
  assert.match(tasksView, /timelineScheduledCount/)
  assert.match(tasksView, /clearCompletedTasks/)
  assert.match(tasksView, /completed-delete-btn/)
  assert.match(tasksView, /active-filter-strip/)
  assert.match(tasksView, /completed-column/)
  assert.doesNotMatch(tasksView, /class="focus-lane"/)
  assert.match(tasksView, /completed-task-section/)
  assert.match(tasksView, /AppSelect/)
  assert.match(tasksView, /AppDateField/)
  assert.match(tasksView, /selectedTaskCompleted/)
  assert.match(tasksView, /normalizeTaskStatus\(task\.status\) === 'completed'\) return/)
  assert.match(tasksView, /durationGoalMinutes: linkedHabit\?\.targetMinutes/)
  assert.match(tasksView, /habitColor: linkedHabit\?\.color/)
  assert.doesNotMatch(tasksView, /formatFocusEvidence|focusEvidence|filterFocus|Link2Icon|playTick|playComplete/)
  assert.match(tasksView, /kanban-focus-btn/)
  assert.match(tasksView, /normalizeSubtasks/)
  assert.match(tasksView, /subtaskDraft/)
  assert.match(tasksView, /subtask-progress/)
  assert.match(tasksView, /subtaskProgressLabel/)
  assert.match(tasksView, /childTaskDraft/)
  assert.match(tasksView, /parentId/)
  assert.match(tasksView, /child-task-row/)
  assert.match(tasksView, /taskStepProgressLabel/)
  assert.match(tasksView, /onTaskDrop/)
  assert.match(tasksView, /promoteTaskToRoot/)
  assert.match(tasksView, /challengeSheen/)
  assert.doesNotMatch(tasksView, /[^\x00-\x7F]/)
  assert.match(analyticsView, /background: color-mix\(in srgb, var\(--surface-strong\) 82%, transparent\)/)
  assert.match(analyticsView, /background: var\(--surface-muted\)/)
  assert.match(focusView, /width: min\(1320px, 100%\)/)
  assert.match(focusView, /width: min\(1280px, 100%\)/)
  assert.match(focusView, /const reviewDetailMode = ref\('summary'\)/)
  assert.match(focusView, /function applyHabitDuration/)
  assert.match(focusView, /durationGoalMinutes: durationGoalMinutes\.value/)
  assert.match(focusView, /habit-attach-field/)
  assert.match(focusView, /--habit-accent/)
  assert.match(focusView, /tracking-block-card/)
  assert.match(focusView, /review-decision-card/)
  assert.match(focusView, /review-mode-switch/)
  assert.match(focusView, /Save review/)
  assert.match(focusView, /Discard/)
  assert.doesNotMatch(focusView, /[^\x00-\x7F]/)
  assert.match(profileView, /grid-template-columns: minmax\(0, 0\.92fr\) minmax\(0, 1\.08fr\)/)
  assert.match(habitsView, /grid-template-columns: repeat\(auto-fit, minmax\(330px, 1fr\)\)/)
  assert.match(habitsView, /durationGoalMinutes: habit\.targetMinutes/)
  assert.match(insightsView, /grid-template-columns: minmax\(0, 1\.35fr\) minmax\(360px, 0\.65fr\)/)
  assert.match(insightsView, /const selectedRangeDays = ref\(1\)/)
  assert.match(insightsView, /buildDailyChallengeCandidates/)
  assert.match(insightsView, /challengeStats/)
  assert.match(settingsView, /browser-diagnostics-grid[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(settingsView, /AppSelect/)
  assert.doesNotMatch(profileView, /[^\x00-\x7F]/)
})

run('Task reminders are persisted and delivered locally', () => {
  const reminders = readFileSync(new URL('../../src/composables/useTaskReminders.js', import.meta.url), 'utf8')
  const db = readFileSync(new URL('../../electron/db.js', import.meta.url), 'utf8')
  const jsonRepo = readFileSync(new URL('../../electron/jsonRepository.js', import.meta.url), 'utf8')

  assert.match(reminders, /REMINDER_GRACE_MS/)
  assert.match(reminders, /window\.velance\.notify/)
  assert.match(reminders, /playReminderSound/)
  assert.match(db, /reminder_time TEXT NOT NULL DEFAULT ''/)
  assert.match(db, /reminder_date TEXT/)
  assert.match(db, /reminderDate: row\.reminder_date \|\| row\.due_date \|\| null/)
  assert.match(db, /parent_task_id INTEGER/)
  assert.match(db, /order_index INTEGER NOT NULL DEFAULT 0/)
  assert.match(db, /parentId: row\.parent_task_id \?\? null/)
  assert.match(db, /subtasks_json TEXT NOT NULL DEFAULT '\[\]'/)
  assert.match(db, /subtasks: normalizeSubtasks\(parseJsonField\(row\.subtasks_json, \[\]\)\)/)
  assert.match(db, /parent_task_id: task\.parentId \?\? task\.parent_id \?\? null/)
  assert.match(db, /order_index: Number\.isFinite\(Number\(task\.order\)\) \? Number\(task\.order\) : 0/)
  assert.match(db, /subtasks_json: JSON\.stringify\(normalizeSubtasks\(task\.subtasks\)\)/)
  assert.match(db, /reminder_date: task\.reminderDate/)
  assert.match(db, /reminderTime: row\.reminder_time \|\| ''/)
  assert.match(db, /reminder_time: task\.reminderTime/)
  assert.match(jsonRepo, /reminderDate: task\.reminderDate/)
  assert.match(jsonRepo, /reminderTime: task\.reminderTime/)
  assert.match(jsonRepo, /parentId: task\.parentId \?\? task\.parent_id \?\? null/)
  assert.match(jsonRepo, /subtasks: normalizeSubtasks\(task\.subtasks\)/)
})

run('Daily challenges rotate from a broad pool and track completion streaks', () => {
  const today = getTodayLocalDateKey()
  const candidates = buildDailyChallengeCandidates({
    dateKey: today,
    context: {
      sessions: 5,
      avgFocusScore: 78,
      currentFatigue: 'Low',
      taskSummary: { open: 7, overdue: 1, highPriorityOpen: 2 },
      browserEvidence: { pressureScore: 64, distractingShare: 0.45, leadSiteLabel: 'YouTube' },
      ambientSummary: { productiveMinutes: 80, distractingMinutes: 28 },
      habits: [{ name: 'Writing' }],
    },
    primaryMove: { title: 'Repeat the good block', action: 'Keep the setup steady', evidence: 'Strong score' },
  })
  const picked = pickDailyChallengeCandidate(candidates, today)
  const yesterday = new Date(`${today}T12:00:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = formatLocalDateKey(yesterday)
  const stats = getDailyChallengeStats([
    { desc: `[VELANCE_DAILY_CHALLENGE:${today}]`, status: 'to-do' },
    { desc: `[VELANCE_DAILY_CHALLENGE:${yesterdayKey}]`, status: 'completed' },
  ], today)

  assert.ok(candidates.length >= 14)
  assert.ok(picked.taskTitle)
  assert.equal(stats.acceptedTotal, 2)
  assert.equal(stats.completedTotal, 1)
  assert.equal(stats.currentStreak, 1)
})

run('Page coach marks are lightweight first-visit tips with skip and finish state', () => {
  const coachMarks = readFileSync(new URL('../../src/components/ui/PageCoachMarks.vue', import.meta.url), 'utf8')
  const appSelect = readFileSync(new URL('../../src/components/ui/AppSelect.vue', import.meta.url), 'utf8')

  assert.match(coachMarks, /velance_tour_skip_all_v1/)
  assert.match(coachMarks, /velance_tour_done_v1/)
  assert.match(coachMarks, /PAGE_TOURS/)
  assert.match(coachMarks, /Skip all/)
  assert.match(coachMarks, /pointer-events: none/)
  assert.match(appSelect, /Teleport to="body"/)
  assert.match(appSelect, /\.app-select\.open[\s\S]*z-index: 420/)
  assert.match(appSelect, /\.app-select-menu[\s\S]*position: fixed[\s\S]*z-index: 4000/)
})

run('AI settings do not reuse a saved key across providers', () => {
  const settings = normalizeAiSettings({
    aiProvider: 'anthropic',
    aiKeyProvider: 'gemini',
    hasAiApiKey: true,
    geminiApiKey: '',
  })

  assert.equal(settings.provider, 'anthropic')
  assert.equal(settings.keyMatchesProvider, false)
  assert.equal(settings.hasKey, false)
})

run('AI settings require models for non-Gemini providers', () => {
  const settings = normalizeAiSettings({
    aiProvider: 'openai-compatible',
    aiBaseUrl: 'https://example.test/v1',
    hasAiApiKey: true,
  })

  assert.equal(settings.provider, 'openai-compatible')
  assert.equal(settings.hasKey, true)
  assert.equal(settings.model, 'gpt-5.1')
  assert.equal(settings.hasModel, true)
})

run('Insight context builds metric-first evidence from local data', () => {
  const today = getTodayLocalDateKey()
  const context = buildInsightContext({
    days: 7,
    profile: { goal: 'deep-work', workingHours: '09:00-17:00' },
    tasks: [
      { id: 1, title: 'Ship planner', status: 'to-do', priority: 'High', due: today },
      { id: 2, title: 'Done item', status: 'completed', priority: 'Normal' },
    ],
    habits: [{ id: 1, name: 'Deep Work', targetMinutes: 60 }],
    sessions: [
      {
        id: 's1',
        date: today,
        timestamp: Date.now(),
        durationSeconds: 3600,
        focusScore: 82,
        linkedTaskId: 1,
        taskTitle: 'Ship planner',
        habit: 'Deep Work',
        productiveSeconds: 3000,
        distractingSeconds: 300,
      },
    ],
    ambientEntries: [
      {
        id: 'a1',
        date: today,
        app: 'VS Code',
        appGroup: 'VS Code',
        duration: 1800,
        lane: 'productive',
      },
      {
        id: 'a2',
        date: today,
        app: 'YouTube',
        appGroup: 'YouTube',
        duration: 600,
        lane: 'distracting',
      },
    ],
  })

  assert.equal(context.sessions, 1)
  assert.equal(context.avgFocusScore, 86)
  assert.equal(context.taskSummary.open, 1)
  assert.equal(context.linkedTaskSessions, 1)
  assert.equal(context.ambientSummary.totalMinutes, 40)
  assert.equal(context.ambientSummary.productiveMinutes, 30)
  assert.equal(context.ambientSummary.distractingMinutes, 10)
  assert.equal(context.dataQuality.recommendationConfidence, 'low')
})

run('Habit progress is proof-only and ignores manual or skip credits', () => {
  const today = getTodayLocalDateKey()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayKey = formatLocalDateKey(yesterday)
  const twoDaysAgo = new Date()
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
  const twoDaysAgoKey = formatLocalDateKey(twoDaysAgo)
  const habit = {
    id: 1,
    name: 'Study',
    targetMinutes: 30,
    manualMinutesByDate: { [today]: 30, [twoDaysAgoKey]: 20 },
    skipDates: [yesterdayKey],
  }

  const emptyStats = getHabitCompletionStats([habit], [], today)
  const emptyHeatmap = getHabitHeatmap([], 'Study', 3, habit)

  assert.equal(emptyStats.onTrack, 0)
  assert.equal(emptyStats.skipped, 0)
  assert.equal(emptyStats.stats[0].todayMinutes, 0)
  assert.equal(emptyStats.stats[0].isOnTrack, false)
  assert.equal(getHabitStreakWithCredits([], habit), 0)
  assert.equal(emptyHeatmap.at(-1).minutes, 0)
  assert.equal(emptyHeatmap.at(-2).skipped, false)

  const proofSessions = [{
    id: 'proof-1',
    habit: 'Study',
    date: today,
    durationSeconds: 35 * 60,
    focusScore: 84,
  }]
  const proofStats = getHabitCompletionStats([habit], proofSessions, today)
  const proofHeatmap = getHabitHeatmap(proofSessions, 'Study', 3, habit)

  assert.equal(proofStats.onTrack, 1)
  assert.equal(proofStats.stats[0].todayMinutes, 35)
  assert.equal(proofStats.stats[0].isOnTrack, true)
  assert.equal(getHabitStreakWithCredits(proofSessions, habit), 1)
  assert.equal(proofHeatmap.at(-1).minutes, 35)
})

console.log('Smoke tests passed')
