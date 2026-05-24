<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useVelanceStore } from '../store/velance.js'
import { useAuthStore } from '../store/auth.js'
import AppSelect from '../components/ui/AppSelect.vue'
import {
  TRACKING_CONSENT_VERSION,
  hasResolvedTrackingConsent,
  hasTrackingConsent,
} from '../services/trackingConsent.js'
import { writeTrackingConsentFallback } from '../services/trackingConsentState.js'
import { getTodayLocalDateKey } from '../services/dateKey.js'
import { buildWorkspacePresentation } from '../services/workspacePresentation.js'
import { buildWorkspaceBackupFilename, summarizeWorkspaceBackup } from '../services/workspaceBackup.js'
import { getBrowserBridgeStatus, testAiConnection } from '../services/dataService.js'
import { AI_PROVIDER_OPTIONS, getAiModeLabel, normalizeAiModel, normalizeAiSettings } from '../services/aiProvider.js'
import {
  getAIClassificationCacheStats,
  resetAILearnedClassifications,
  runAIClassificationImprovement,
} from '../composables/useAmbientTracker.js'
import {
  BellIcon,
  CheckIcon,
  CloudIcon,
  DownloadIcon,
  MoonIcon,
  RefreshCwIcon,
  SaveIcon,
  SunIcon,
  TrashIcon,
  TimerResetIcon,
  UploadIcon,
} from 'lucide-vue-next'

const store = useVelanceStore()
const authStore = useAuthStore()
const activeSection = ref('privacy')
const toastMsg = ref('')
const toastVisible = ref(false)
const syncSubmitting = ref(false)
const backupSubmitting = ref(false)
const aiTestLoading = ref(false)
const aiTestResult = ref(null)
const aiKeyDraft = ref('')
const aiSaveError = ref('')
const aiClassifyLoading = ref(false)
const aiClassifyResult = ref(null)
const aiCacheStats = ref(null)
const backupInput = ref(null)
const clearDataConfirmText = ref('')
const browserBridgeStatus = ref({
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
  hostPermissionGranted: false,
  contentScriptEnabled: false,
  captureMode: 'permission-required',
  permissionError: '',
  lastPermissionCheckedAt: 0,
  lastError: '',
  lastEventAt: 0,
  lastAudioAt: 0,
})

const s = reactive({ ...(store.settings || {}) })
let toastTimer = null
let browserBridgeTimer = null
const recentControlActions = new Map()
const CONTROL_ACTION_GUARD_MS = 420

const navItems = [
  { id: 'privacy', label: 'Privacy' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Alerts' },
  { id: 'ai', label: 'AI' },
  { id: 'data', label: 'Sync & Data' },
]

const accountSummary = computed(() => buildWorkspacePresentation({
  user: authStore.user,
  profile: store.userProfile,
  workspaceId: store.currentWorkspaceId,
  backendStatus: store.backendStatus,
  migrationStatus: store.migrationStatus,
}))
const syncSummary = computed(() => store.syncStatus || {})
const trackingState = computed(() => (s.trackingEnabled ? 'Tracking enabled' : 'Tracking disabled'))
const themeState = computed(() => (s.isDark ? 'Dark theme' : 'Light theme'))
const breakIntervalLabel = computed(() => `${Math.max(30, Number(s.breakIntervalMinutes || 90))} min`)
const retentionLabel = computed(() => `${Math.max(7, Number(s.dataRetentionDays || 90))} days`)
const consentResolved = computed(() => hasResolvedTrackingConsent(s))
const consentGranted = computed(() => hasTrackingConsent(s))
const consentStateLabel = computed(() => {
  if (!consentResolved.value) return 'Pending decision'
  return consentGranted.value ? 'Granted' : 'Declined'
})
const syncActionLabel = computed(() => {
  if (!accountSummary.value.hasSignedInAccount) return 'Sign in to sync'
  if (syncSubmitting.value) return 'Syncing...'
  return 'Sync now'
})
const hasSyncConflict = computed(() => syncSummary.value?.mode === 'conflict')
const syncLastLabel = computed(() => {
  const lastSyncedAt = Number(syncSummary.value?.lastSyncedAt || 0)
  if (!lastSyncedAt) {
    if (syncSummary.value?.mode === 'conflict') return 'Local and cloud snapshots both changed'
    if (syncSummary.value?.mode === 'needs-schema') return 'Waiting for Supabase schema'
    if (!accountSummary.value.hasSignedInAccount) return 'Local workspace only'
    return 'No successful sync yet'
  }

  return `Last synced ${new Date(lastSyncedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`
})
const syncToneClass = computed(() => ({
  good: ['synced', 'idle'].includes(syncSummary.value?.mode),
  warn: ['needs-schema', 'local-only'].includes(syncSummary.value?.mode),
  danger: syncSummary.value?.mode === 'error',
  active: ['checking', 'syncing'].includes(syncSummary.value?.mode) || syncSummary.value?.pending,
}))
const browserBridgeSummary = computed(() => {
  if (!s.trackingEnabled || !consentGranted.value) {
    return {
      label: 'Paused',
      message: 'Tracking is off, so browser capture is paused.',
      tone: 'warn',
    }
  }

  if (!s.browserExtensionEnabled) {
    return {
      label: 'Disabled',
      message: 'Browser events are ignored until you turn the bridge back on.',
      tone: 'warn',
    }
  }

  if (browserBridgeStatus.value.captureMode === 'permission-required' || browserBridgeStatus.value.hostPermissionGranted === false) {
    return {
      label: 'Permission needed',
      message: browserBridgeStatus.value.permissionError || 'Open the extension popup and allow browser access before Velance can receive tab context.',
      tone: 'warn',
    }
  }

  if (browserBridgeStatus.value.connected) {
    return {
      label: 'Connected',
      message: 'Chrome and Edge can add site, tab, and audible-browser context to your local activity record.',
      tone: 'good',
    }
  }

  return {
    label: browserBridgeStatus.value.ready ? 'Waiting' : 'Unavailable',
    message: browserBridgeStatus.value.lastError || 'Load the Velance extension in Chrome or Edge to start browser capture.',
    tone: browserBridgeStatus.value.lastError ? 'danger' : 'warn',
  }
})
const browserBridgeToneClass = computed(() => ({
  good: browserBridgeSummary.value.tone === 'good',
  warn: browserBridgeSummary.value.tone === 'warn',
  danger: browserBridgeSummary.value.tone === 'danger',
}))
const browserCaptureMode = computed(() => {
  if (!s.browserExtensionEnabled) return 'paused'
  return browserCapturePreference.value
})
const browserCapturePreference = computed(() => {
  if (!s.browserCaptureHosts) return 'host-only'
  if (s.browserCaptureHosts && !s.browserCaptureTitles && !s.browserCaptureAudioTitles) return 'host-only'
  if (s.browserCaptureHosts && s.browserCaptureTitles && !s.browserCaptureAudioTitles) return 'standard'
  if (s.browserCaptureHosts && s.browserCaptureTitles && s.browserCaptureAudioTitles) return 'rich'
  return 'custom'
})
const browserCaptureModeLabel = computed(() => {
  switch (browserCaptureMode.value) {
    case 'host-only':
      return 'Host only'
    case 'standard':
      return 'Standard'
    case 'rich':
      return 'Rich media'
    case 'paused':
      return 'Paused'
    case 'minimal':
      return 'Minimal'
    default:
      return 'Custom'
  }
})
const browserCapturePreferenceLabel = computed(() => {
  switch (browserCapturePreference.value) {
    case 'host-only':
      return 'Host only'
    case 'standard':
      return 'Standard'
    case 'rich':
      return 'Rich media'
    default:
      return 'Custom'
  }
})
const browserCaptureModes = [
  {
    id: 'host-only',
    label: 'Host only',
    description: 'Save site domains like youtube.com. Page and audio titles stay off.',
  },
  {
    id: 'standard',
    label: 'Standard',
    description: 'Save site domains and active page titles for clearer browser evidence.',
  },
  {
    id: 'rich',
    label: 'Rich media',
    description: 'Save domains, page titles, and audible media titles when available.',
  },
]
const aiProviderOptions = AI_PROVIDER_OPTIONS
const aiProviderKeyLinks = {
  gemini: {
    href: 'https://aistudio.google.com/apikey',
    label: 'Get Gemini key',
  },
  'openai-compatible': {
    href: 'https://platform.openai.com/api-keys',
    label: 'Get OpenAI key',
  },
  anthropic: {
    href: 'https://console.anthropic.com/settings/keys',
    label: 'Get Anthropic key',
  },
}
const aiSettings = computed(() => normalizeAiSettings(s))
const aiProviderKeyLink = computed(() => aiProviderKeyLinks[aiSettings.value.provider] || aiProviderKeyLinks.gemini)
const aiModeLabel = computed(() => getAiModeLabel(s))
const aiModelOptions = computed(() => aiSettings.value.modelOptions || [])
const aiModelSelectOptions = computed(() => aiModelOptions.value.map((option) => ({
  value: option.id,
  label: option.label,
  detail: option.description || '',
})))
const selectedAiModelDescription = computed(() => (
  aiModelOptions.value.find((option) => option.id === aiSettings.value.model)?.description || ''
))
const aiKeyProviderLabel = computed(() => {
  if (!s.aiKeyProvider) return aiSettings.value.providerLabel
  return AI_PROVIDER_OPTIONS.find((provider) => provider.id === s.aiKeyProvider)?.label || s.aiKeyProvider
})
const aiKeyMatchesProvider = computed(() => aiSettings.value.keyMatchesProvider)
const hasActiveProviderKey = computed(() => aiSettings.value.hasKey)
const aiEffectiveKeyReady = computed(() => Boolean(aiKeyDraft.value.trim()) || aiSettings.value.hasKey)
const aiKeyStatusLabel = computed(() => {
  if (aiKeyDraft.value.trim()) return 'New key ready. Connect to save it.'
  if (s.hasAiApiKey && !aiKeyMatchesProvider.value) {
    return `Saved for ${aiKeyProviderLabel.value}. Add a ${aiSettings.value.providerLabel} key to switch.`
  }
  if (s.hasAiApiKey) {
    const preview = s.aiKeyPreview ? ` (${s.aiKeyPreview})` : ''
    return s.aiKeyStorage === 'os-encrypted'
      ? `Saved securely on this device${preview}`
      : `Saved key ready for secure storage${preview}`
  }
  return 'No AI key saved'
})
const aiKeyHelperText = computed(() => {
  if (aiKeyDraft.value.trim()) return 'The key stays visible until it is saved. After saving, Velance hides the full value.'
  if (s.hasAiApiKey && !aiKeyMatchesProvider.value) {
    return `A key is saved for ${aiKeyProviderLabel.value}. Paste a new key here to use ${aiSettings.value.providerLabel}.`
  }
  if (s.hasAiApiKey) {
    return s.aiKeyPreview
      ? `Saved key: ${s.aiKeyPreview}. The full key stays hidden.`
      : 'A key is saved. The full key stays hidden.'
  }
  return 'Paste a key, test the connection, and Velance will save it securely.'
})
const aiProviderHelp = computed(() => {
  if (aiSettings.value.provider === 'gemini') {
    return 'Use a Google AI Studio key. Velance sends summarized activity context, never raw keystrokes.'
  }
  if (aiSettings.value.provider === 'openai-compatible') {
    return 'Use an OpenAI key or any compatible /chat/completions provider. Confirm the model before saving.'
  }
  return 'Use an Anthropic Console key. Choose a Claude model before saving.'
})
const aiTestStatus = computed(() => {
  if (aiTestLoading.value) return 'Testing connection...'
  if (aiTestResult.value?.ok) return `${aiTestResult.value.providerLabel || aiSettings.value.providerLabel} connected`
  if (aiTestResult.value?.message) return aiTestResult.value.message
  if (aiKeyDraft.value.trim()) return 'New key ready'
  if (s.aiLastTestedAt) {
    const testedAt = formatStatusTimestamp(s.aiLastTestedAt)
    return s.aiLastTestOk
      ? `Last AI test passed ${testedAt}`
      : `Last AI test failed ${testedAt}`
  }
  if (s.hasAiApiKey && !aiKeyMatchesProvider.value) return `Needs a ${aiSettings.value.providerLabel} key`
  return aiSettings.value.hasKey ? 'Ready to test' : 'Local-only'
})
const aiProviderDiagnostics = computed(() => ([
  { label: 'Provider', value: aiSettings.value.providerLabel },
  { label: 'Model', value: aiSettings.value.model || 'Missing model' },
  { label: 'Endpoint', value: aiSettings.value.provider === 'gemini' ? 'Google Gemini API' : aiSettings.value.baseUrl },
  { label: 'Key state', value: aiKeyDraft.value.trim() ? 'New key ready to connect' : (hasActiveProviderKey.value ? 'Saved for this provider' : 'No active provider key') },
  { label: 'Last test', value: s.aiLastTestedAt ? `${s.aiLastTestOk ? 'Passed' : 'Failed'} ${formatStatusTimestamp(s.aiLastTestedAt)}` : 'Not tested yet' },
]))
const aiPromptPreview = computed(() => JSON.stringify({
  provider: aiSettings.value.provider,
  model: aiSettings.value.model,
  dataSent: {
    focusStats: 'aggregated focus score, session count, focus minutes',
    activityStats: 'productive/supporting/distracting minutes by category',
    browserEvidence: 'redacted host/page labels and event counts when browser capture is enabled',
    tasksAndHabits: 'titles, status, priority, habit names, linked-session counts',
  },
  notSent: ['raw keystrokes', 'full API key', 'passwords', 'raw local database'],
  testPrompt: 'Return exactly this JSON object and nothing else: {"ok":true,"message":"Velance BYOK AI connection works"}',
}, null, 2))
const testAiButtonLabel = computed(() => {
  if (aiTestLoading.value) return 'Testing...'
  if (aiKeyDraft.value.trim()) return 'Connect and save'
  return 'Test saved key'
})
const browserLastEventLabel = computed(() => formatStatusTimestamp(browserBridgeStatus.value.lastEventAt))
const browserLastAudioLabel = computed(() => formatStatusTimestamp(browserBridgeStatus.value.lastAudioAt))

watch(() => s.isDark, (isDark) => {
  applyThemeShell(Boolean(isDark))
}, { immediate: true })

watch(() => store.settings, (nextSettings) => {
  const next = nextSettings || {}
  Object.keys(s).forEach((key) => {
    if (!(key in next)) delete s[key]
  })
  Object.assign(s, next)
}, { deep: true })

watch(activeSection, (section) => {
  if (section === 'privacy' || section === 'data') {
    void loadBrowserBridgeStatus()
  }
})

onMounted(() => {
  normalizeCurrentAiModel()
  aiCacheStats.value = getAIClassificationCacheStats()
  void loadBrowserBridgeStatus()
  browserBridgeTimer = window.setInterval(() => {
    void loadBrowserBridgeStatus()
  }, 4000)
})

onBeforeUnmount(() => {
  if (browserBridgeTimer) {
    window.clearInterval(browserBridgeTimer)
    browserBridgeTimer = null
  }
})

function formatStatusTimestamp(timestamp = 0) {
  if (!timestamp) return 'No signal yet'
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function syncSettingsDraftToStore() {
  if (!store.settings) return
  Object.keys(store.settings).forEach((key) => {
    if (!(key in s)) delete store.settings[key]
  })
  Object.assign(store.settings, { ...s })
}

function applyThemeShell(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark-theme', isDark)
  document.documentElement.classList.toggle('light-theme', !isDark)
  window.dispatchEvent(new CustomEvent('velance:theme-change', { detail: { isDark } }))
  const appRoot = document.querySelector('.velance-app')
  if (appRoot) {
    appRoot.classList.toggle('dark-theme', isDark)
    appRoot.classList.toggle('light-theme', !isDark)
  }
}

function normalizeCurrentAiModel() {
  const normalized = normalizeAiModel(s.aiProvider || 'gemini', s.aiModel)
  if (normalized !== s.aiModel) {
    s.aiModel = normalized
    void saveAiSettings('AI model updated')
  }
}

function showToast(message) {
  toastMsg.value = message
  toastVisible.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastVisible.value = false
  }, 2500)
}

function skipDuplicateControlAction(key) {
  const now = Date.now()
  const last = recentControlActions.get(key) || 0
  if (now - last < CONTROL_ACTION_GUARD_MS) return true
  recentControlActions.set(key, now)
  return false
}

async function saveAll() {
  const draftKey = aiKeyDraft.value.trim()
  if (draftKey) {
    s.geminiApiKey = draftKey
    s.aiKeyProvider = s.aiProvider
  }
  s.aiModel = normalizeAiModel(s.aiProvider || 'gemini', s.aiModel)
  syncSettingsDraftToStore()
  await store.saveSettings()
  if (draftKey && s.hasAiApiKey) aiKeyDraft.value = ''
  await loadBrowserBridgeStatus()
  showToast('Settings saved')
}

async function testAiSettings() {
  if (aiTestLoading.value) return
  aiTestLoading.value = true
  aiTestResult.value = {
    ok: null,
    message: aiKeyDraft.value.trim()
      ? `Testing ${aiSettings.value.providerLabel} and saving the key if it connects...`
      : `Testing saved ${aiSettings.value.providerLabel} key...`,
  }
  aiSaveError.value = ''
  const draftKey = aiKeyDraft.value.trim()
  try {
    s.aiModel = normalizeAiModel(s.aiProvider || 'gemini', s.aiModel)
    const result = await testAiConnection({ ...s, geminiApiKey: draftKey }, store.currentWorkspaceId)
    aiTestResult.value = result
    const testedAt = Number(result?.diagnostics?.checkedAt || Date.now())
    if (result?.ok) {
      if (result?.settings && typeof result.settings === 'object') {
        Object.assign(s, result.settings)
        s.aiLastTestedAt = Number(s.aiLastTestedAt || testedAt)
        s.aiLastTestOk = true
        s.aiLastTestMessage = result?.message || 'AI connection works'
        aiKeyDraft.value = ''
        delete s.clearAiApiKey
        syncSettingsDraftToStore()
        await store.clearInsightsCache()
      } else if (draftKey) {
        s.aiLastTestedAt = testedAt
        s.aiLastTestOk = true
        s.aiLastTestMessage = result?.message || 'AI connection works'
        await saveAiSettings('AI key tested and saved', { silent: true, clearDraft: true, preserveResult: true })
      } else {
        s.aiLastTestedAt = testedAt
        s.aiLastTestOk = true
        s.aiLastTestMessage = result?.message || 'AI connection works'
        syncSettingsDraftToStore()
        await store.saveSettings()
      }
      showToast('AI connection works')
    } else {
      s.aiLastTestedAt = testedAt
      s.aiLastTestOk = false
      s.aiLastTestMessage = result?.message || 'AI test failed'
      syncSettingsDraftToStore()
      await store.saveSettings()
      showToast(result?.message || 'AI test failed')
    }
  } catch (error) {
    const message = error?.message || 'AI test failed before Velance reached the provider.'
    aiTestResult.value = { ok: false, message }
    s.aiLastTestedAt = Date.now()
    s.aiLastTestOk = false
    s.aiLastTestMessage = message
    aiSaveError.value = message
    syncSettingsDraftToStore()
    await store.saveSettings()
    showToast(message)
  } finally {
    aiTestLoading.value = false
  }
}

async function saveAiSettings(message = 'AI settings saved', { silent = false, clearDraft = true, preserveResult = false } = {}) {
  if (!preserveResult) aiTestResult.value = null
  aiSaveError.value = ''
  const draftKey = aiKeyDraft.value.trim()
  if (draftKey) {
    s.geminiApiKey = draftKey
    s.aiKeyProvider = s.aiProvider
  }
  s.aiModel = normalizeAiModel(s.aiProvider || 'gemini', s.aiModel)
  try {
    syncSettingsDraftToStore()
    await store.saveSettings()
  } catch (error) {
    aiSaveError.value = error?.message || 'Velance could not save AI settings.'
    showToast(aiSaveError.value)
    return
  }
  if (clearDraft && (s.hasAiApiKey || !draftKey)) {
    aiKeyDraft.value = ''
  }
  delete s.clearAiApiKey
  if (!silent && message) showToast(message)
}

async function removeAiKey() {
  aiTestResult.value = null
  aiSaveError.value = ''
  s.geminiApiKey = ''
  s.aiKeyProvider = ''
  s.hasAiApiKey = false
  s.aiKeyPreview = ''
  s.aiKeyStorage = 'none'
  s.aiInsightsEnabled = false
  s.aiLastTestOk = false
  s.aiLastTestMessage = ''
  s.clearAiApiKey = true
  aiKeyDraft.value = ''
  try {
    syncSettingsDraftToStore()
    await store.saveSettings()
    await store.clearInsightsCache()
    showToast('AI key removed')
  } catch (error) {
    aiSaveError.value = error?.message || 'Velance could not remove the AI key.'
    showToast(aiSaveError.value)
  } finally {
    delete s.clearAiApiKey
  }
}

function applyAiProvider(providerId) {
  aiTestResult.value = null
  aiSaveError.value = ''
  s.aiProvider = providerId
  const meta = AI_PROVIDER_OPTIONS.find((provider) => provider.id === providerId)
  const currentModel = String(s.aiModel || '')
  const providerOwnsCurrentModel = Boolean(meta?.modelOptions?.some((option) => option.id === currentModel))
  const geminiModel = /^gemini-/i.test(currentModel)
  const claudeModel = /^claude-/i.test(currentModel)
  const openAiModel = /^(gpt-|o\d|chatgpt-)/i.test(currentModel)
  if (
    meta?.defaultModel
    && (
      !currentModel
      || providerId === 'gemini'
      || !providerOwnsCurrentModel
      || (providerId === 'openai-compatible' && (geminiModel || claudeModel))
      || (providerId === 'anthropic' && (geminiModel || openAiModel))
    )
  ) {
    s.aiModel = meta.defaultModel
  }
  if (meta?.defaultBaseUrl && providerId !== 'gemini' && !s.aiBaseUrl) {
    s.aiBaseUrl = meta.defaultBaseUrl
  }
  if (providerId === 'gemini') {
    s.aiBaseUrl = ''
    s.aiModel = normalizeAiModel(providerId, s.aiModel || meta?.defaultModel)
  }
  showToast(`${meta?.label || 'AI'} selected`)
}

async function runClassificationImprovement() {
  if (aiClassifyLoading.value) return
  aiClassifyLoading.value = true
  aiClassifyResult.value = null
  try {
    const stats = await runAIClassificationImprovement(aiSettings.value, { maxNew: 20 })
    aiCacheStats.value = getAIClassificationCacheStats()
    aiClassifyResult.value = stats
  } catch (e) {
    aiClassifyResult.value = { error: e?.message || 'Failed to run classification improvement' }
  } finally {
    aiClassifyLoading.value = false
  }
}

function clearLearnedClassifications() {
  resetAILearnedClassifications()
  aiCacheStats.value = getAIClassificationCacheStats()
  aiClassifyResult.value = null
}

async function saveAndPing(message) {
  syncSettingsDraftToStore()
  await store.saveSettings()
  await loadBrowserBridgeStatus()
  showToast(message)
}

async function saveSettingChange(message, { refreshBrowser = false, clearInsights = false } = {}) {
  syncSettingsDraftToStore()
  await store.saveSettings()
  if (clearInsights) await store.clearInsightsCache()
  if (refreshBrowser) await loadBrowserBridgeStatus()
  if (message) showToast(message)
}

async function loadBrowserBridgeStatus() {
  browserBridgeStatus.value = await getBrowserBridgeStatus()
}

async function applyBrowserCaptureMode(mode = 'standard') {
  if (skipDuplicateControlAction(`browser-mode:${mode}`)) return
  if (mode === 'host-only') {
    s.browserCaptureHosts = true
    s.browserCaptureTitles = false
    s.browserCaptureAudioTitles = false
  } else if (mode === 'standard') {
    s.browserCaptureHosts = true
    s.browserCaptureTitles = true
    s.browserCaptureAudioTitles = false
  } else if (mode === 'rich') {
    s.browserCaptureHosts = true
    s.browserCaptureTitles = true
    s.browserCaptureAudioTitles = true
  }
  await saveSettingChange(`Capture mode set to ${mode.replace('-', ' ')}`, { refreshBrowser: true })
}

async function toggleBrowserBridge() {
  if (skipDuplicateControlAction('browser-bridge')) return
  if (!consentGranted.value) {
    showToast('Allow tracking consent before enabling browser capture')
    return
  }
  s.browserExtensionEnabled = !s.browserExtensionEnabled
  await saveAndPing(s.browserExtensionEnabled ? 'Browser bridge enabled' : 'Browser bridge paused')
}

async function toggleTrackingEnabled() {
  if (skipDuplicateControlAction('tracking-enabled')) return
  if (!consentGranted.value) {
    s.trackingEnabled = false
    await saveSettingChange('Allow consent before turning tracking on', { refreshBrowser: true })
    return
  }
  s.trackingEnabled = !s.trackingEnabled
  if (!s.trackingEnabled) s.browserExtensionEnabled = false
  await saveSettingChange(s.trackingEnabled ? 'Tracking enabled' : 'Tracking disabled', { refreshBrowser: true })
}

async function toggleBooleanSetting(key, onMessage, offMessage) {
  if (skipDuplicateControlAction(`toggle:${key}`)) return
  s[key] = !s[key]
  await saveSettingChange(s[key] ? onMessage : offMessage)
}

async function toggleAiInsights() {
  if (skipDuplicateControlAction('ai-insights')) return
  s.aiInsightsEnabled = s.aiInsightsEnabled === false
  await saveSettingChange(s.aiInsightsEnabled ? 'AI coach enabled' : 'AI coach turned off', { clearInsights: true })
}

async function syncNow() {
  if (!accountSummary.value.hasSignedInAccount || syncSubmitting.value) return
  syncSubmitting.value = true
  try {
    const result = await store.runCloudSync('manual')
    showToast(result?.label || 'Sync finished')
  } finally {
    syncSubmitting.value = false
  }
}

async function restoreCloudCopy() {
  if (!accountSummary.value.hasSignedInAccount || syncSubmitting.value) return
  if (!confirm('Restore the latest saved cloud snapshot onto this device? This replaces the current local workspace with the cloud copy.')) return
  syncSubmitting.value = true
  try {
    const result = await store.runCloudSync('force-pull')
    showToast(result?.label || 'Cloud snapshot restored')
  } finally {
    syncSubmitting.value = false
  }
}

async function keepThisDeviceData() {
  if (syncSubmitting.value) return
  syncSubmitting.value = true
  try {
    const result = await store.resolveSyncConflict('keep-local')
    showToast(result?.label || 'Local snapshot kept')
  } finally {
    syncSubmitting.value = false
  }
}

async function useCloudCopy() {
  if (syncSubmitting.value) return
  syncSubmitting.value = true
  try {
    const result = await store.resolveSyncConflict('use-cloud')
    showToast(result?.label || 'Cloud snapshot restored')
  } finally {
    syncSubmitting.value = false
  }
}

async function updateTrackingConsent(granted) {
  if (skipDuplicateControlAction(`consent:${granted ? 'allow' : 'decline'}`)) return
  const consentAt = Date.now()
  s.trackingConsentGranted = granted
  s.trackingConsentVersion = TRACKING_CONSENT_VERSION
  s.trackingConsentAt = consentAt
  if (!granted) {
    s.trackingEnabled = false
    s.browserExtensionEnabled = false
  } else {
    s.trackingEnabled = true
  }
  const workspaceIds = new Set([
    store.currentWorkspaceId,
    authStore.user?.id,
  ].filter(Boolean))
  workspaceIds.forEach((workspaceId) => {
    writeTrackingConsentFallback({ workspaceId, granted, at: consentAt })
  })
  syncSettingsDraftToStore()
  await store.saveSettings()
  await loadBrowserBridgeStatus()
  showToast(granted ? 'Tracking consent granted' : 'Tracking consent revoked')
}

function scrollTo(id) {
  activeSection.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function applyBreakInterval(minutes) {
  s.breakIntervalMinutes = minutes
}

async function applyThemePreference(isDark) {
  if (skipDuplicateControlAction(`theme:${isDark ? 'dark' : 'light'}`)) return
  s.isDark = isDark
  if (store.settings) store.settings.isDark = isDark
  syncSettingsDraftToStore()
  applyThemeShell(isDark)
  await store.saveSettings({ sync: false, prune: false, syncRuntime: false })
  showToast(isDark ? 'Dark theme applied' : 'Light theme applied')
}

async function saveAppearanceSettings() {
  syncSettingsDraftToStore()
  await store.saveSettings({ sync: false, prune: false, syncRuntime: false })
  showToast('Appearance saved')
}

function adjustBreakInterval(delta) {
  s.breakIntervalMinutes = Math.max(30, Math.min(240, Number(s.breakIntervalMinutes || 90) + delta))
}

function normalizeBreakInterval() {
  s.breakIntervalMinutes = Math.max(30, Math.min(240, Number.parseInt(s.breakIntervalMinutes, 10) || 90))
}

function applyRetention(days) {
  s.dataRetentionDays = days
}

function adjustRetention(delta) {
  s.dataRetentionDays = Math.max(7, Math.min(365, Number(s.dataRetentionDays || 90) + delta))
}

function normalizeRetention() {
  s.dataRetentionDays = Math.max(7, Math.min(365, Number.parseInt(s.dataRetentionDays, 10) || 90))
}

async function clearData() {
  if (clearDataConfirmText.value !== 'CLEAR VELANCE') {
    showToast('Type CLEAR VELANCE before clearing local data')
    return
  }
  await store.clearAllLocalData()
  clearDataConfirmText.value = ''
  showToast('Local data cleared')
}

async function exportData() {
  if (backupSubmitting.value) return
  backupSubmitting.value = true
  try {
    const backup = await store.exportWorkspaceBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = buildWorkspaceBackupFilename(getTodayLocalDateKey(), store.currentWorkspaceId)
    anchor.click()
    URL.revokeObjectURL(url)
    showToast('Workspace backup exported')
  } finally {
    backupSubmitting.value = false
  }
}

async function exportDiagnostics() {
  const report = {
    exportedAt: new Date().toISOString(),
    app: {
      name: 'Velance',
      version: import.meta.env?.VITE_APP_VERSION || 'development',
    },
    workspace: {
      id: accountSummary.value.workspaceShortId,
      signedIn: accountSummary.value.hasSignedInAccount,
      backend: store.backendStatus?.kind || 'unknown',
      storage: accountSummary.value.storagePill,
      migration: accountSummary.value.migrationLabel,
      syncMode: syncSummary.value?.mode || 'unknown',
      syncLabel: syncSummary.value?.label || '',
    },
    settings: {
      trackingEnabled: Boolean(s.trackingEnabled),
      consentResolved: consentResolved.value,
      consentGranted: consentGranted.value,
      browserExtensionEnabled: Boolean(s.browserExtensionEnabled),
      browserCaptureMode: browserCaptureMode.value,
      aiProvider: s.aiProvider || 'gemini',
      aiModel: s.aiModel || '',
      aiInsightsEnabled: s.aiInsightsEnabled !== false,
      hasAiApiKey: Boolean(s.hasAiApiKey),
      aiKeyStorage: s.aiKeyStorage || 'none',
      dataRetentionDays: Number(s.dataRetentionDays || 90),
    },
    counts: {
      tasks: store.tasks.length,
      habits: store.habits.length,
      sessions: store.sessions.length,
      cachedInsights: store.cachedInsights.length,
      insightFeedback: store.insightFeedback.length,
    },
    browserBridge: browserBridgeStatus.value,
  }
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `velance-diagnostics-${getTodayLocalDateKey()}.json`
  anchor.click()
  URL.revokeObjectURL(url)
  showToast('Diagnostics exported')
}

function promptImportBackup() {
  if (backupSubmitting.value) return
  backupInput.value?.click()
}

async function importBackup(event) {
  const file = event?.target?.files?.[0]
  if (!file) return

  try {
    const raw = JSON.parse(await file.text())
    const summary = summarizeWorkspaceBackup(raw, store.currentWorkspaceId)
    const confirmed = confirm(
      `Restore backup from ${new Date(summary.exportedAt).toLocaleString()}?\n\n` +
      `Tasks: ${summary.tasks}\n` +
      `Habits: ${summary.habits}\n` +
      `Sessions: ${summary.sessions}\n` +
      `Tracking rows: ${summary.ambient + summary.media}\n\n` +
      'This replaces the current local workspace on this device.',
    )
    if (!confirmed) return

    backupSubmitting.value = true
    await store.restoreWorkspaceBackup(raw)
    showToast('Workspace backup restored')
  } catch (error) {
    console.error('[Velance] Failed to import backup:', error)
    showToast('Backup import failed')
  } finally {
    backupSubmitting.value = false
    if (event?.target) event.target.value = ''
  }
}

async function reloadWorkspaceNow() {
  if (backupSubmitting.value || syncSubmitting.value) return
  backupSubmitting.value = true
  try {
    await store.reloadWorkspace(authStore.user)
    showToast('Workspace reloaded')
  } finally {
    backupSubmitting.value = false
  }
}
</script>

<template>
  <div class="settings-module">
    <section class="hero-card">
      <div class="hero-copy">
        <span class="page-kicker">Settings</span>
        <h1 class="page-title">Tune Velance without the clutter.</h1>
        <p class="page-subtitle">Privacy, AI, alerts, appearance, sync, and recovery controls in one clean workspace.</p>
      </div>

      <div class="hero-side">
        <span class="save-hint">Each group can be saved at the bottom of its section.</span>
      </div>
    </section>

    <nav class="settings-nav">
      <button
        type="button"
        v-for="item in navItems"
        :key="item.id"
        class="nav-pill"
        :class="{ active: activeSection === item.id }"
        @pointerdown.prevent.stop="scrollTo(item.id)"
        @click.prevent.stop="scrollTo(item.id)"
      >
        {{ item.label }}
      </button>
    </nav>

    <section id="privacy" class="settings-card">
      <div class="section-title-row">
        <div>
          <span class="card-kicker">Privacy</span>
          <h2>Tracking and consent</h2>
        </div>
      </div>

      <div class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Consent</span>
            <strong>{{ consentStateLabel }}</strong>
          </div>
          <div class="quick-chips">
            <button type="button" class="chip-btn" :class="{ active: consentGranted }" @pointerdown.prevent.stop="updateTrackingConsent(true)" @click.prevent.stop="updateTrackingConsent(true)">Allow</button>
            <button type="button" class="chip-btn" :class="{ active: consentResolved && !consentGranted }" @pointerdown.prevent.stop="updateTrackingConsent(false)" @click.prevent.stop="updateTrackingConsent(false)">Decline</button>
          </div>
        </div>
        <span class="toggle-copy">
          Velance keeps raw activity data on this device. Revoking consent stops app, focus, and browser tracking immediately.
        </span>
      </div>

      <div class="toggle-list">
        <div class="toggle-row">
          <div class="toggle-copy">
            <strong>Global tracking</strong>
            <span>Track active apps, windows, and focus context locally.</span>
          </div>
          <button type="button" class="toggle-switch" :class="{ on: s.trackingEnabled && consentGranted }" @pointerdown.prevent.stop="toggleTrackingEnabled" @click.prevent.stop="toggleTrackingEnabled">
            <span class="toggle-thumb"></span>
          </button>
        </div>

        <div class="toggle-row">
          <div class="toggle-copy">
            <strong>Keystroke rhythm</strong>
            <span>Measure typing pace only. Velance never stores the words you type.</span>
          </div>
          <button type="button" class="toggle-switch" :class="{ on: s.keystrokeEnabled }" @pointerdown.prevent.stop="toggleBooleanSetting('keystrokeEnabled', 'Keystroke rhythm enabled', 'Keystroke rhythm disabled')" @click.prevent.stop="toggleBooleanSetting('keystrokeEnabled', 'Keystroke rhythm enabled', 'Keystroke rhythm disabled')">
            <span class="toggle-thumb"></span>
          </button>
        </div>

        <div class="toggle-row">
          <div class="toggle-copy">
            <strong>Mouse activity</strong>
            <span>Use pointer movement as a workload and fatigue signal.</span>
          </div>
          <button type="button" class="toggle-switch" :class="{ on: s.mouseEnabled }" @pointerdown.prevent.stop="toggleBooleanSetting('mouseEnabled', 'Mouse activity enabled', 'Mouse activity disabled')" @click.prevent.stop="toggleBooleanSetting('mouseEnabled', 'Mouse activity enabled', 'Mouse activity disabled')">
            <span class="toggle-thumb"></span>
          </button>
        </div>
      </div>

      <div class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Browser extension</span>
            <strong>{{ browserBridgeSummary.label }}</strong>
          </div>
          <div class="quick-chips">
            <button
              type="button"
              class="bridge-action-btn"
              :class="{ paused: s.browserExtensionEnabled, enabled: !s.browserExtensionEnabled }"
              :disabled="!consentGranted"
              @pointerdown.prevent.stop="toggleBrowserBridge"
              @click.prevent.stop="toggleBrowserBridge"
            >
              {{ s.browserExtensionEnabled ? 'Pause bridge' : 'Enable bridge' }}
            </button>
          </div>
        </div>
        <span class="toggle-copy">{{ browserBridgeSummary.message }}</span>

        <div class="browser-mode-strip">
          <div class="browser-mode-head">
            <div>
              <span class="field-label">Capture mode</span>
              <strong>{{ browserCapturePreferenceLabel }}</strong>
            </div>
            <span class="hero-pill" :class="browserBridgeToneClass">
              {{ browserBridgeSummary.label }}
            </span>
          </div>
          <div class="browser-mode-grid">
            <button
              type="button"
              v-for="mode in browserCaptureModes"
              :key="mode.id"
              class="browser-mode-card"
              :class="{ active: browserCapturePreference === mode.id }"
              @pointerdown.prevent.stop="applyBrowserCaptureMode(mode.id)"
              @click.prevent.stop="applyBrowserCaptureMode(mode.id)"
            >
              <strong>{{ mode.label }}</strong>
              <span>{{ mode.description }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="section-save-row">
        <button type="button" class="primary-btn" @pointerdown.prevent.stop="saveAll" @click.prevent.stop="saveAll">
          <SaveIcon size="15" /> Save privacy settings
        </button>
      </div>
    </section>

    <section id="appearance" class="settings-card">
      <div class="section-title-row">
        <div>
          <span class="card-kicker">Appearance</span>
          <h2>Theme preference</h2>
        </div>
      </div>

      <div class="theme-grid">
        <button type="button" class="theme-card" :class="{ active: !s.isDark }" @pointerdown.prevent.stop="applyThemePreference(false)" @click.prevent.stop="applyThemePreference(false)">
          <SunIcon size="16" />
          <span>Light</span>
        </button>
        <button type="button" class="theme-card" :class="{ active: s.isDark }" @pointerdown.prevent.stop="applyThemePreference(true)" @click.prevent.stop="applyThemePreference(true)">
          <MoonIcon size="16" />
          <span>Dark</span>
        </button>
      </div>

      <div class="section-save-row">
        <button type="button" class="primary-btn" @pointerdown.prevent.stop="saveAppearanceSettings" @click.prevent.stop="saveAppearanceSettings">
          <SaveIcon size="15" /> Save appearance
        </button>
      </div>
    </section>

    <section id="notifications" class="settings-card">
      <div class="section-title-row">
        <div>
          <span class="card-kicker">Alerts</span>
          <h2>Focus reminders</h2>
        </div>
      </div>

      <div class="reminder-strip">
        <div class="reminder-signal">
          <BellIcon size="15" />
          <span>Session alerts</span>
          <strong>{{ s.notificationsEnabled ? 'On' : 'Off' }}</strong>
        </div>
        <div class="reminder-signal">
          <TimerResetIcon size="15" />
          <span>Break rhythm</span>
          <strong>{{ s.breakReminders ? breakIntervalLabel : 'Off' }}</strong>
        </div>
      </div>

      <div class="toggle-list">
        <div class="toggle-row">
          <div class="toggle-copy">
            <strong>Session notifications</strong>
            <span>Show milestones and end-of-session alerts.</span>
          </div>
          <button type="button" class="toggle-switch" :class="{ on: s.notificationsEnabled }" @pointerdown.prevent.stop="toggleBooleanSetting('notificationsEnabled', 'Session notifications enabled', 'Session notifications disabled')" @click.prevent.stop="toggleBooleanSetting('notificationsEnabled', 'Session notifications enabled', 'Session notifications disabled')">
            <span class="toggle-thumb"></span>
          </button>
        </div>

        <div class="toggle-row">
          <div class="toggle-copy">
            <strong>Break reminders</strong>
            <span>Suggest a reset after long stretches of work.</span>
          </div>
          <button type="button" class="toggle-switch" :class="{ on: s.breakReminders }" @pointerdown.prevent.stop="toggleBooleanSetting('breakReminders', 'Break reminders enabled', 'Break reminders disabled')" @click.prevent.stop="toggleBooleanSetting('breakReminders', 'Break reminders enabled', 'Break reminders disabled')">
            <span class="toggle-thumb"></span>
          </button>
        </div>
      </div>

      <div v-if="s.breakReminders" class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Break interval</span>
            <strong>{{ breakIntervalLabel }}</strong>
          </div>
          <div class="quick-chips">
            <button type="button" class="chip-btn" :class="{ active: s.breakIntervalMinutes === 60 }" @click="applyBreakInterval(60)">60 min</button>
            <button type="button" class="chip-btn" :class="{ active: s.breakIntervalMinutes === 90 }" @click="applyBreakInterval(90)">90 min</button>
            <button type="button" class="chip-btn" :class="{ active: s.breakIntervalMinutes === 120 }" @click="applyBreakInterval(120)">120 min</button>
          </div>
        </div>

        <div class="number-row">
          <button type="button" class="mini-step-btn" @click="adjustBreakInterval(-15)">-15</button>
          <div class="stepper-core">
            <input v-model.number="s.breakIntervalMinutes" type="number" min="30" max="240" class="setting-input center stepper-input" @blur="normalizeBreakInterval" />
            <span class="stepper-unit">min</span>
          </div>
          <button type="button" class="mini-step-btn" @click="adjustBreakInterval(15)">+15</button>
        </div>
      </div>

      <div class="section-save-row">
        <button type="button" class="primary-btn" @pointerdown.prevent.stop="saveAll" @click.prevent.stop="saveAll">
          <SaveIcon size="15" /> Save alerts
        </button>
      </div>
    </section>

    <section id="ai" class="settings-card">
      <div class="section-title-row">
        <div>
          <span class="card-kicker">AI</span>
          <h2>AI coach</h2>
        </div>
        <span class="hero-pill">{{ aiModeLabel }}</span>
      </div>

      <div class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Provider</span>
            <strong>{{ aiSettings.providerLabel }}</strong>
          </div>
          <div class="quick-chips">
            <button
              v-for="provider in aiProviderOptions"
              :key="provider.id"
              type="button"
              class="chip-btn"
              :class="{ active: s.aiProvider === provider.id }"
              @click="applyAiProvider(provider.id)"
              @keydown.enter.prevent="applyAiProvider(provider.id)"
              @keydown.space.prevent="applyAiProvider(provider.id)"
            >
              {{ provider.label }}
            </button>
          </div>
        </div>
        <span class="toggle-copy">{{ aiProviderHelp }}</span>
      </div>

      <div class="input-surface compact-toggle-row">
        <div class="toggle-copy">
          <strong>Use AI on Insights</strong>
          <span>Turn this off to keep Insights fully local while keeping your saved key available for later.</span>
        </div>
        <button
          type="button"
          class="toggle-switch"
          :class="{ on: s.aiInsightsEnabled !== false }"
          @pointerdown.prevent.stop="toggleAiInsights"
          @click.prevent.stop="toggleAiInsights"
        >
          <span class="toggle-thumb"></span>
        </button>
      </div>

      <div class="input-surface">
        <div class="toggle-copy">
          <strong>API key</strong>
          <span>{{ aiSettings.keyHint }}. Keys are encrypted on this device and never included in sync, backups, or prompts.</span>
        </div>
        <input
          type="password"
          class="setting-input"
          v-model="aiKeyDraft"
          :placeholder="s.hasAiApiKey ? `Saved ${aiSettings.providerLabel} key is hidden` : `Paste your ${aiSettings.providerLabel} API key`"
          autocomplete="off"
        />
        <span class="setting-help">{{ aiKeyHelperText }}</span>
        <div class="key-status-row">
          <span class="hero-pill" :class="{ good: s.hasAiApiKey && !aiKeyDraft && aiKeyMatchesProvider, danger: s.hasAiApiKey && !aiKeyMatchesProvider }">{{ aiKeyStatusLabel }}</span>
          <button v-if="s.hasAiApiKey || aiKeyDraft" type="button" class="ghost-link button-link danger-link" @click="removeAiKey">
            Remove key
          </button>
        </div>
        <div class="setting-grid two">
          <label class="mini-field">
            <span class="field-label">Model</span>
            <input
              v-if="s.aiProvider === 'openai-compatible'"
              class="setting-input"
              v-model="s.aiModel"
              list="ai-openai-model-options"
              :placeholder="aiSettings.modelHint"
              autocomplete="off"
              @change="saveAiSettings('AI model saved')"
            />
            <datalist v-if="s.aiProvider === 'openai-compatible'" id="ai-openai-model-options">
              <option v-for="option in aiModelOptions" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </datalist>
            <AppSelect
              v-else-if="aiModelOptions.length"
              class="setting-app-select"
              v-model="s.aiModel"
              :options="aiModelSelectOptions"
              aria-label="AI model"
              @change="saveAiSettings('AI model saved')"
            />
            <input v-else class="setting-input" v-model="s.aiModel" :placeholder="aiSettings.modelHint" autocomplete="off" @change="saveAiSettings()" />
            <span v-if="selectedAiModelDescription" class="setting-help">{{ selectedAiModelDescription }}</span>
          </label>
          <label v-if="s.aiProvider !== 'gemini'" class="mini-field">
            <span class="field-label">Base URL</span>
            <input class="setting-input" v-model="s.aiBaseUrl" placeholder="https://api.openai.com/v1" autocomplete="off" @change="saveAiSettings()" />
          </label>
        </div>
        <div class="inline-meta">
          <span class="hero-pill" :class="{ danger: aiTestResult?.ok === false, good: aiTestResult?.ok === true }">{{ aiTestStatus }}</span>
          <button type="button" class="ghost-link button-link" @click="saveAiSettings('AI settings saved', { clearDraft: true })">
            Save AI settings
          </button>
          <button type="button" class="ai-connect-button" :disabled="aiTestLoading || !aiEffectiveKeyReady" @click="testAiSettings">
            {{ testAiButtonLabel }}
          </button>
          <a :href="aiProviderKeyLink.href" target="_blank" rel="noreferrer" class="ghost-link">{{ aiProviderKeyLink.label }}</a>
        </div>
        <p v-if="s.aiLastTestedAt && s.aiLastTestMessage && !aiTestResult?.message" class="setting-help">
          Last result: {{ s.aiLastTestMessage }}
        </p>
        <div v-if="aiTestResult?.message || aiSaveError" class="ai-result-banner" :class="{ good: aiTestResult?.ok === true, danger: aiTestResult?.ok === false || aiSaveError }">
          {{ aiSaveError || aiTestResult.message }}
        </div>
        <details class="diagnostics-panel ai-provider-details">
          <summary>Connection details</summary>
          <div class="ai-diagnostics-grid">
            <div v-for="item in aiProviderDiagnostics" :key="item.label" class="account-block ai-diagnostic-card">
              <span class="field-label">{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
          <details class="diagnostics-panel ai-prompt-preview">
            <summary>Data shared with AI</summary>
            <p class="setting-help">This shows the summarized data shape used in BYOK mode. API keys are never included in prompts.</p>
            <pre>{{ aiPromptPreview }}</pre>
          </details>
        </details>
      </div>

      <div v-if="aiSettings.hasKey" class="input-surface ai-classify-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Smart Classification</span>
            <strong>Improve activity categories with AI</strong>
          </div>
          <button
            type="button"
            class="ai-connect-button"
            :disabled="aiClassifyLoading"
            @click="runClassificationImprovement"
          >
            {{ aiClassifyLoading ? 'Improving...' : 'Improve now' }}
          </button>
        </div>
        <span class="toggle-copy">Uses your AI key to classify unclear or low-confidence activities. Results are cached locally — the same app or site is never sent twice.</span>
        <div v-if="aiCacheStats?.count" class="setting-help">
          {{ aiCacheStats.count }} classification{{ aiCacheStats.count === 1 ? '' : 's' }} cached locally
        </div>
        <div v-if="aiClassifyResult && !aiClassifyResult.error" class="ai-result-banner good">
          Learned {{ aiClassifyResult.learned }} new · {{ aiClassifyResult.skipped }} already known · {{ aiClassifyResult.failed }} failed
        </div>
        <div v-if="aiClassifyResult?.error" class="ai-result-banner danger">
          {{ aiClassifyResult.error }}
        </div>
        <div v-if="aiCacheStats?.count" class="inline-meta">
          <button type="button" class="ghost-link button-link danger-link" @click="clearLearnedClassifications">
            Clear learned classifications
          </button>
        </div>
      </div>

      <div class="section-save-row">
        <button type="button" class="primary-btn" @pointerdown.prevent.stop="saveAll" @click.prevent.stop="saveAll">
          <SaveIcon size="15" /> Save AI settings
        </button>
      </div>
    </section>

    <section id="data" class="settings-card">
      <div class="section-title-row">
        <div>
          <span class="card-kicker">Sync & Data</span>
          <h2>Storage and recovery</h2>
        </div>
      </div>

      <div class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Storage status</span>
            <strong>{{ accountSummary.storageLabel }}</strong>
          </div>
          <div class="quick-chips">
            <span class="chip-btn active">{{ accountSummary.storagePill }}</span>
            <span class="chip-btn" :class="{ active: store.migrationStatus.completed }">{{ accountSummary.migrationLabel }}</span>
          </div>
        </div>
        <span class="toggle-copy">{{ accountSummary.storageDescription }}</span>
      </div>

      <div class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Cloud sync</span>
            <strong>{{ syncSummary.label || 'Local only' }}</strong>
          </div>
          <div class="quick-chips">
            <span class="chip-btn" :class="[syncToneClass, { active: syncSummary.pending || ['synced', 'idle'].includes(syncSummary.mode) }]">
              <CloudIcon size="13" />
              {{ syncSummary.mode === 'needs-schema' ? 'Schema needed' : (syncSummary.pending ? 'Queued' : (syncSummary.label || 'Local only')) }}
            </span>
          </div>
        </div>
        <span class="toggle-copy">{{ syncSummary.message || 'Sign in to sync your workspace across devices.' }}</span>
        <div class="inline-meta sync-meta-row">
          <span class="sync-meta">{{ syncLastLabel }}</span>
          <button type="button" class="ghost-btn sync-btn" :disabled="!accountSummary.hasSignedInAccount || syncSubmitting" @click="syncNow">
            <RefreshCwIcon size="14" /> {{ syncActionLabel }}
          </button>
        </div>
        <div v-if="hasSyncConflict" class="sync-conflict-actions">
          <button type="button" class="ghost-btn" :disabled="syncSubmitting" @click="useCloudCopy">Use cloud copy</button>
          <button type="button" class="primary-btn conflict-keep-btn" :disabled="syncSubmitting" @click="keepThisDeviceData">Keep this device data</button>
        </div>
      </div>

      <details class="diagnostics-panel">
        <summary>Workspace diagnostics</summary>
        <div class="diagnostics-grid">
          <div class="account-block">
            <span class="field-label">Workspace ID</span>
            <strong>{{ accountSummary.workspaceShortId }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Backend message</span>
            <strong>{{ accountSummary.diagnosticsMessage }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Sync mode</span>
            <strong>{{ syncSummary.mode || 'local-only' }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Sync details</span>
            <strong>{{ syncLastLabel }}</strong>
          </div>
        </div>
      </details>

      <div class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Browser bridge</span>
            <strong>{{ browserBridgeSummary.label }}</strong>
          </div>
          <div class="quick-chips">
            <span class="chip-btn" :class="[browserBridgeToneClass, { active: browserBridgeSummary.tone === 'good' }]">
              {{ browserBridgeSummary.label }}
            </span>
            <button type="button" class="ghost-btn mini-ghost-btn" @click="loadBrowserBridgeStatus">
              <RefreshCwIcon size="14" /> Refresh
            </button>
          </div>
        </div>
        <span class="toggle-copy">Live extension diagnostics show whether Chrome or Edge is sending usable browser evidence.</span>
        <div class="diagnostics-grid browser-diagnostics-grid">
          <div class="account-block">
            <span class="field-label">Last browser event</span>
            <strong>{{ browserLastEventLabel }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Last event type</span>
            <strong>{{ browserBridgeStatus.lastEventType || 'Waiting' }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Last audible tab</span>
            <strong>{{ browserBridgeStatus.lastAudibleHost || 'No audible tab yet' }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Last audio signal</span>
            <strong>{{ browserLastAudioLabel }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Last browser app</span>
            <strong>{{ browserBridgeStatus.lastBrowserApp || 'Not seen yet' }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Extension version</span>
            <strong>{{ browserBridgeStatus.lastExtensionVersion || 'Waiting for extension' }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Bridge auth</span>
            <strong>{{ browserBridgeStatus.authMode || 'extension-token' }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Events received</span>
            <strong>{{ browserBridgeStatus.receivedEvents || 0 }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Audio events</span>
            <strong>{{ browserBridgeStatus.audibleEvents || 0 }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Ignored requests</span>
            <strong>{{ browserBridgeStatus.ignoredEvents || 0 }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Token validated</span>
            <strong>{{ formatStatusTimestamp(browserBridgeStatus.tokenValidatedAt) }}</strong>
          </div>
          <div class="account-block">
            <span class="field-label">Bridge error</span>
            <strong>{{ browserBridgeStatus.lastError || 'None' }}</strong>
          </div>
        </div>
      </div>

      <div class="input-surface">
        <div class="input-head">
          <div>
            <span class="field-label">Retention</span>
            <strong>{{ retentionLabel }}</strong>
          </div>
          <div class="quick-chips">
            <button type="button" class="chip-btn" :class="{ active: s.dataRetentionDays === 30 }" @click="applyRetention(30)">30 days</button>
            <button type="button" class="chip-btn" :class="{ active: s.dataRetentionDays === 90 }" @click="applyRetention(90)">90 days</button>
            <button type="button" class="chip-btn" :class="{ active: s.dataRetentionDays === 180 }" @click="applyRetention(180)">180 days</button>
          </div>
        </div>

        <div class="number-row">
          <button type="button" class="mini-step-btn" @click="adjustRetention(-7)">-7</button>
          <div class="stepper-core">
            <input v-model.number="s.dataRetentionDays" type="number" min="7" max="365" class="setting-input center stepper-input" @blur="normalizeRetention" />
            <span class="stepper-unit">days</span>
          </div>
          <button type="button" class="mini-step-btn" @click="adjustRetention(7)">+7</button>
        </div>
      </div>

      <div class="data-actions">
        <button type="button" class="ghost-btn" :disabled="backupSubmitting" @click="exportData">
          <DownloadIcon size="14" /> Export backup
        </button>
        <button type="button" class="ghost-btn" :disabled="backupSubmitting" @click="promptImportBackup">
          <UploadIcon size="14" /> Import backup
        </button>
        <button type="button" class="ghost-btn" :disabled="!accountSummary.hasSignedInAccount || syncSubmitting || backupSubmitting" @click="restoreCloudCopy">
          <CloudIcon size="14" /> Restore cloud copy
        </button>
        <button type="button" class="ghost-btn" :disabled="backupSubmitting || syncSubmitting" @click="reloadWorkspaceNow">
          <RefreshCwIcon size="14" /> Reload workspace
        </button>
        <button type="button" class="ghost-btn" @click="exportDiagnostics">
          <DownloadIcon size="14" /> Export diagnostics
        </button>
      </div>

      <div class="input-surface danger-zone">
        <div class="input-head">
          <div>
            <span class="field-label">Danger zone</span>
            <strong>Clear local data</strong>
          </div>
        </div>
        <span class="toggle-copy">This erases sessions, tasks, habits, rules, insights, and settings stored on this device. Your account remains signed in.</span>
        <input
          v-model="clearDataConfirmText"
          class="setting-input"
          type="text"
          autocomplete="off"
          placeholder="Type CLEAR VELANCE"
        />
        <button type="button" class="danger-btn" :disabled="clearDataConfirmText !== 'CLEAR VELANCE'" @click="clearData">
          <TrashIcon size="14" /> Clear local data
        </button>
      </div>
      <input ref="backupInput" class="visually-hidden-input" type="file" accept=".json,application/json" @change="importBackup" />

      <div class="section-save-row">
        <button type="button" class="primary-btn" @pointerdown.prevent.stop="saveAll" @click.prevent.stop="saveAll">
          <SaveIcon size="15" /> Save sync and data
        </button>
      </div>
    </section>

    <transition name="toast">
      <div v-if="toastVisible" class="toast">
        <CheckIcon size="14" /> {{ toastMsg }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.settings-module {
  width: 100%;
  padding: 26px 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1180px;
  margin: 0 auto;
  color: var(--text-main);
}

.settings-module,
.hero-card,
.settings-card,
.input-surface,
.toggle-row,
.browser-mode-grid,
.theme-grid,
.quick-chips,
.data-actions,
.inline-meta {
  position: relative;
}

.settings-module button,
.settings-module a,
.settings-module input,
.settings-module select,
.settings-module summary,
.settings-module label {
  pointer-events: auto;
  position: relative;
  z-index: 2;
}

.hero-card {
  background: linear-gradient(135deg, var(--surface-strong), color-mix(in srgb, var(--surface-strong) 84%, var(--accent-base) 6%));
  border: 1px solid var(--surface-outline);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.07);
  backdrop-filter: blur(16px);
}

.settings-card,
.toast {
  background: var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(16px);
}

.hero-card {
  border-radius: 24px;
  padding: 22px 24px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 22px;
  align-items: center;
}

.hero-copy,
.hero-side,
.settings-card,
.toggle-copy,
.account-block,
.input-surface {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hero-side {
  align-items: flex-end;
  justify-content: center;
}

.save-hint {
  max-width: 260px;
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 560;
  line-height: 1.45;
  text-align: right;
}

.page-kicker,
.card-kicker,
.field-label {
  font-size: 10.5px;
  font-weight: 760;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  line-height: 1.05;
  color: var(--accent-base);
}

.page-title {
  font-size: clamp(1.85rem, 2.5vw, 2.55rem);
  line-height: 1.05;
  letter-spacing: -0.035em;
  font-weight: 740;
  max-width: 760px;
}

.page-subtitle,
.toggle-copy,
.toggle-copy span,
.setting-help,
.ghost-link {
  color: var(--text-muted);
}

.setting-help {
  font-size: 12px;
  line-height: 1.55;
  font-weight: 450;
}

.page-subtitle {
  max-width: 700px;
  font-size: 14.5px;
  line-height: 1.55;
  font-weight: 450;
}

.settings-nav,
.account-grid,
.theme-grid,
.quick-chips,
.data-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.danger-zone {
  border-color: rgba(239, 68, 68, 0.22);
}

.hero-pill,
.nav-pill,
.chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 650;
  line-height: 1;
  white-space: nowrap;
}

.account-block strong,
.toggle-copy strong,
.section-title-row h2,
.input-head strong {
  color: var(--text-main);
}

.section-title-row h2 {
  margin-top: 3px;
  font-size: 20px;
  line-height: 1.15;
  letter-spacing: -0.025em;
  font-weight: 700;
}

.input-head strong {
  font-size: 14.5px;
  line-height: 1.25;
  font-weight: 680;
}

.account-block strong,
.toggle-copy strong {
  font-size: 13.5px;
  line-height: 1.3;
  letter-spacing: -0.01em;
  font-weight: 680;
}

.primary-btn,
.ghost-btn,
.bridge-action-btn,
.danger-btn,
.theme-card,
.toggle-switch,
.step-btn,
.mini-step-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 13px;
  font-size: 12.5px;
  font-weight: 680;
  cursor: pointer;
  font-family: inherit;
  line-height: 1;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}

.primary-btn {
  padding: 10px 14px;
  border: none;
  background: var(--accent-gradient);
  color: white;
  box-shadow: 0 14px 28px var(--accent-glow), inset 0 1px 0 rgba(255, 255, 255, 0.24);
}

.ghost-btn,
.theme-card,
.step-btn,
.mini-step-btn {
  padding: 10px 14px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.45) inset;
}

.mini-ghost-btn {
  padding: 8px 12px;
  font-size: 11px;
}

.bridge-action-btn {
  min-height: 34px;
  padding: 9px 14px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent-base) 34%, var(--surface-outline));
  background: color-mix(in srgb, var(--accent-base) 11%, var(--surface-muted));
  color: var(--accent-base);
  box-shadow: 0 10px 20px color-mix(in srgb, var(--accent-base) 12%, transparent);
}

.bridge-action-btn.paused {
  border-color: color-mix(in srgb, #f59e0b 28%, var(--surface-outline));
  background: color-mix(in srgb, #f59e0b 12%, var(--surface-muted));
  color: #d97706;
}

.bridge-action-btn.enabled {
  background: var(--accent-gradient);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 12px 24px var(--accent-glow);
}

.danger-btn {
  padding: 10px 14px;
  border: 1px solid rgba(239, 68, 68, 0.18);
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

.primary-btn:hover,
.ghost-btn:hover,
.bridge-action-btn:hover,
.danger-btn:hover,
.nav-pill:hover,
.theme-card:hover,
.step-btn:hover,
.mini-step-btn:hover {
  transform: translateY(-1px);
}

.primary-btn:hover {
  box-shadow: 0 18px 34px var(--accent-glow), inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.bridge-action-btn:hover {
  border-color: color-mix(in srgb, var(--accent-base) 46%, var(--surface-outline));
  box-shadow: 0 14px 28px color-mix(in srgb, var(--accent-base) 16%, transparent);
}

.ghost-btn:hover,
.theme-card:hover,
.step-btn:hover,
.mini-step-btn:hover {
  border-color: color-mix(in srgb, var(--accent-base) 28%, var(--surface-outline));
  background: color-mix(in srgb, var(--accent-base) 7%, var(--surface-muted));
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
}

.settings-nav {
  padding: 5px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  align-self: flex-start;
}

.nav-pill {
  border: none;
  cursor: pointer;
}

.chip-btn {
  cursor: default;
  box-shadow: inset 0 0 0 1px transparent;
}

button.chip-btn {
  cursor: pointer;
}

button.chip-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 30%, var(--surface-outline));
  background: color-mix(in srgb, var(--accent-base) 8%, var(--surface-muted));
  box-shadow: 0 10px 20px rgba(15, 23, 42, 0.06);
}

.nav-pill.active,
.chip-btn.active {
  background: color-mix(in srgb, var(--accent-base) 14%, transparent);
  color: var(--accent-base);
}

.chip-btn.good {
  background: color-mix(in srgb, #22c55e 12%, transparent);
  color: #15803d;
}

.chip-btn.warn {
  background: color-mix(in srgb, #f59e0b 14%, transparent);
  color: #b45309;
}

.chip-btn.danger {
  background: color-mix(in srgb, #ef4444 12%, transparent);
  color: #dc2626;
}

.hero-pill.good {
  background: color-mix(in srgb, #22c55e 12%, transparent);
  color: #15803d;
}

.hero-pill.danger {
  background: color-mix(in srgb, #ef4444 12%, transparent);
  color: #dc2626;
}

.chip-btn.active.active {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-base) 22%, transparent);
}

.settings-card {
  border-radius: 24px;
  padding: 24px;
  gap: 17px;
}

.section-title-row,
.toggle-row,
.input-head,
.inline-meta,
.number-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.section-title-row {
  align-items: flex-start;
}

.section-save-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 2px;
}

.section-save-row .primary-btn {
  min-width: 180px;
}

.section-title-row > div,
.input-head > div:first-child,
.browser-mode-head > div {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 5px;
  min-width: 0;
}

.ghost-link {
  font-size: 12.5px;
  font-weight: 760;
  text-decoration: none;
}

.button-link {
  border: none;
  background: transparent;
  font-family: inherit;
  cursor: pointer;
}

.button-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-connect-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 9px 14px;
  border: none;
  border-radius: 13px;
  background: var(--accent-gradient);
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 12px 22px var(--accent-glow);
}

.ai-connect-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.key-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.danger-link {
  color: #dc2626;
}

.setting-grid {
  display: grid;
  gap: 12px;
}

.setting-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mini-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.ai-diagnostics-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.ai-diagnostic-card {
  min-width: 0;
}

.ai-diagnostic-card strong {
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.45;
}

.account-block {
  padding: 14px 15px;
  border-radius: 16px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  min-height: 76px;
  justify-content: center;
}

.toggle-list {
  display: grid;
  gap: 10px;
}

.browser-mode-strip {
  display: grid;
  gap: 12px;
  margin-top: 2px;
}

.browser-mode-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.browser-mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.browser-mode-card {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--bg-card) 96%, transparent);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.browser-mode-card strong {
  font-size: 13.5px;
  font-weight: 680;
  color: var(--text-main);
}

.browser-mode-card span {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-muted);
}

.browser-mode-card.active {
  border-color: var(--surface-outline-strong);
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-base) 18%, transparent);
}

.browser-mode-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 26%, var(--surface-outline));
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.06);
}

.browser-mode-card:disabled {
  cursor: not-allowed;
  opacity: 0.55;
  transform: none;
}

.compact-toggle-list {
  margin-top: 4px;
}

.toggle-row,
.input-surface {
  padding: 16px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--surface-muted) 74%, var(--bg-card) 26%);
  border: 1px solid var(--surface-outline);
}

.toggle-copy,
.toggle-copy span {
  max-width: 860px;
  font-size: 12.5px;
  line-height: 1.58;
  font-weight: 450;
}

.compact-toggle-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.compact-toggle-row .toggle-copy {
  align-items: flex-start;
  text-align: left;
}

.toggle-row.disabled {
  opacity: 0.62;
}

.toggle-switch {
  width: 48px;
  height: 28px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--text-main) 10%, transparent);
  background: color-mix(in srgb, var(--text-main) 14%, transparent);
  position: relative;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.toggle-switch.on {
  background: var(--accent-base);
  border-color: color-mix(in srgb, var(--accent-base) 70%, white 20%);
  box-shadow: 0 8px 18px var(--accent-glow);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: white;
  transition: transform 0.25s ease;
}

.toggle-switch.on .toggle-thumb {
  transform: translateX(20px);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.theme-card {
  min-height: 58px;
  justify-content: flex-start;
  padding: 12px 15px;
  position: relative;
}

.theme-card.active {
  border-color: var(--surface-outline-strong);
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
  box-shadow: 0 14px 28px var(--accent-glow), inset 0 0 0 1px color-mix(in srgb, var(--accent-base) 18%, transparent);
}

.reminder-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.reminder-signal {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--bg-card) 88%, transparent);
}

.reminder-signal svg {
  color: var(--accent-base);
}

.reminder-signal span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.reminder-signal strong {
  color: var(--text-main);
  font-size: 12px;
  font-weight: 760;
}

.setting-input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--bg-card) 96%, transparent);
  color: var(--text-main);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  outline: none;
}

.setting-select {
  appearance: auto;
  cursor: pointer;
}

.setting-app-select {
  width: 100%;
}

.setting-app-select.open {
  z-index: 620;
}

.setting-input.center {
  text-align: center;
}

.setting-input:focus {
  border-color: var(--surface-outline-strong);
  box-shadow: 0 0 0 4px rgba(0, 180, 216, 0.08);
}

.number-row {
  justify-content: flex-start;
  gap: 10px;
}

.step-btn {
  width: 56px;
  padding-inline: 0;
}

.mini-step-btn {
  min-width: 52px;
  padding-inline: 0;
  border-radius: 14px;
  font-size: 11px;
  font-weight: 800;
}

.stepper-core {
  min-width: 176px;
  max-width: 220px;
  padding: 0 14px;
  border-radius: 16px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--bg-card) 96%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.stepper-input {
  min-width: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  padding-inline: 0;
}

.stepper-input:focus {
  box-shadow: none;
}

.stepper-unit {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.inline-meta {
  justify-content: space-between;
}

.sync-meta-row {
  align-items: center;
}

.sync-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.sync-btn[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}

.ghost-btn[disabled],
.bridge-action-btn[disabled],
.primary-btn[disabled],
.danger-btn[disabled],
.toggle-switch[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.sync-conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.conflict-keep-btn {
  margin-top: 0;
  padding: 10px 14px;
}

.diagnostics-panel {
  border-radius: 18px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  padding: 14px 16px;
}

.diagnostics-panel summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-main);
}

.diagnostics-grid {
  margin-top: 12px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ai-prompt-preview {
  margin-top: 2px;
}

.ai-prompt-preview pre {
  margin: 12px 0 0;
  max-height: 260px;
  overflow: auto;
  padding: 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--text-main) 6%, transparent);
  color: var(--text-main);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.ai-result-banner {
  padding: 11px 13px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.5;
}

.ai-result-banner.good {
  border-color: color-mix(in srgb, #22c55e 28%, var(--surface-outline));
  background: color-mix(in srgb, #22c55e 9%, transparent);
  color: #15803d;
}

.ai-result-banner.danger {
  border-color: color-mix(in srgb, #ef4444 28%, var(--surface-outline));
  background: color-mix(in srgb, #ef4444 9%, transparent);
  color: #dc2626;
}

.browser-diagnostics-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (min-width: 1280px) {
  .settings-module {
    gap: 20px;
  }

  .hero-card {
    padding: 26px 28px;
  }

  .settings-card {
    padding: 26px 28px;
    gap: 18px;
  }

  .input-surface,
  .toggle-row {
    padding: 18px;
  }

  .browser-mode-grid,
  .theme-grid,
  .reminder-strip {
    gap: 12px;
  }

  .browser-diagnostics-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 16px;
  padding: 12px 18px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-main);
  z-index: 1200;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.24s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.visually-hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 980px) {
  .hero-card {
    grid-template-columns: 1fr;
  }

  .account-grid {
    grid-template-columns: 1fr;
  }

  .setting-grid.two,
  .ai-diagnostics-grid,
  .browser-mode-grid,
  .diagnostics-grid,
  .browser-diagnostics-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .settings-module {
    padding: 24px 18px 32px;
  }

  .theme-grid,
  .reminder-strip,
  .number-row {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .stepper-core {
    max-width: none;
    width: 100%;
  }

  .settings-nav,
  .quick-chips,
  .data-actions {
    width: 100%;
  }
}

/* ─── DARK THEME OVERRIDES ─────────────────────────────────────────────────── */

/* Headings always correct in dark mode */
:global(.dark-theme .settings-module h1),
:global(.dark-theme .settings-module h2),
:global(.dark-theme .settings-module h3),
:global(.dark-theme .settings-module .page-title){
  color: var(--text-main) !important;
}

/* Card and hero-card surfaces */
:global(.dark-theme .settings-module .hero-card),
:global(.dark-theme .settings-module .settings-card){
  background: var(--bg-card) !important;
  border-color: var(--surface-outline) !important;
}

:global(.dark-theme .settings-module .chip-btn.good),
:global(.dark-theme .settings-module .hero-pill.good){
  background: color-mix(in srgb, #22c55e 14%, transparent) !important;
  color: #4ade80 !important;
}

:global(.dark-theme .settings-module .chip-btn.warn){
  background: color-mix(in srgb, #f59e0b 14%, transparent) !important;
  color: #fbbf24 !important;
}

:global(.dark-theme .settings-module .chip-btn.danger),
:global(.dark-theme .settings-module .hero-pill.danger){
  background: color-mix(in srgb, #ef4444 14%, transparent) !important;
  color: #f87171 !important;
}

:global(.dark-theme .settings-module .bridge-action-btn.paused){
  color: #fbbf24 !important;
}

:global(.dark-theme .settings-module .danger-link){
  color: #f87171 !important;
}

:global(.dark-theme .settings-module .status-label.good){ color: #4ade80 !important; }
:global(.dark-theme .settings-module .status-label.warn){ color: #fbbf24 !important; }
:global(.dark-theme .settings-module .status-label.danger){ color: #f87171 !important; }

/* AI result banners — dark green/red on light bg, need bright equivalents */
:global(.dark-theme .settings-module .ai-result-banner.good){
  background: color-mix(in srgb, #22c55e 11%, transparent) !important;
  border-color: color-mix(in srgb, #22c55e 28%, transparent) !important;
  color: #4ade80 !important;
}
:global(.dark-theme .settings-module .ai-result-banner.danger){
  background: color-mix(in srgb, #ef4444 11%, transparent) !important;
  border-color: color-mix(in srgb, #ef4444 28%, transparent) !important;
  color: #f87171 !important;
}

/* Bridge action btn - paused uses dark amber */
:global(.dark-theme .settings-module .bridge-action-btn.paused){
  color: #fbbf24 !important;
  border-color: color-mix(in srgb, #f59e0b 28%, transparent) !important;
}
</style>
