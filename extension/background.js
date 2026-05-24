const BRIDGE_BASE_URL = 'http://127.0.0.1:48152'
const BRIDGE_CONTEXT_URL = `${BRIDGE_BASE_URL}/bridge/browser-context`
const BRIDGE_EVENT_URL = `${BRIDGE_BASE_URL}/bridge/browser-event`
const BRIDGE_AUDIO_URL = `${BRIDGE_BASE_URL}/bridge/browser-audio`
const BRIDGE_HEALTH_URL = `${BRIDGE_BASE_URL}/bridge/health`
const BRIDGE_REQUEST_TIMEOUT_MS = 2200
const HEARTBEAT_ALARM = 'velance-bridge-heartbeat'
const AUDIO_ALARM = 'velance-audio-heartbeat'
const EXTENSION_VERSION = chrome.runtime.getManifest().version || 'dev'
const OPTIONAL_BROWSER_ORIGINS = ['https://*/*', 'http://*/*']

let latestSnapshot = null
let latestEvent = null
let latestAudibleTabs = []
let latestKnownTabCount = 0
let captureTimer = null
let audioTimer = null

const tabCache = new Map()
const pageSignalCache = new Map()
const injectedTabs = new Set()

let bridgeState = {
  connected: false,
  lastSuccessAt: 0,
  lastAttemptAt: 0,
  lastError: '',
  lastEventType: '',
  lastEventAt: 0,
  lastAudioAt: 0,
  captureEnabled: true,
  captureHosts: true,
  captureTitles: true,
  captureAudioTitles: true,
  hostPermissionGranted: false,
  contentScriptEnabled: false,
  captureMode: 'permission-required',
  permissionError: '',
  lastPermissionCheckedAt: 0,
  authMode: 'extension-token',
  tokenIssuedAt: 0,
  tokenValidatedAt: 0,
}
let bridgeToken = ''

function getCaptureMode(bridge = bridgeState) {
  if (!bridge.hostPermissionGranted) return 'permission-required'
  if (bridge.captureEnabled === false) return 'paused'
  if (bridge.captureHosts && !bridge.captureTitles && !bridge.captureAudioTitles) return 'host-only'
  if (bridge.captureHosts && bridge.captureTitles && !bridge.captureAudioTitles) return 'standard'
  if (bridge.captureHosts && bridge.captureTitles && bridge.captureAudioTitles) return 'rich'
  return 'custom'
}

async function refreshPermissionState() {
  try {
    const granted = await chrome.permissions.contains({ origins: OPTIONAL_BROWSER_ORIGINS })
    bridgeState = {
      ...bridgeState,
      hostPermissionGranted: Boolean(granted),
      captureMode: getCaptureMode({ ...bridgeState, hostPermissionGranted: Boolean(granted) }),
      permissionError: '',
      lastPermissionCheckedAt: Date.now(),
    }
    return bridgeState
  } catch (error) {
    bridgeState = {
      ...bridgeState,
      hostPermissionGranted: false,
      captureMode: 'permission-required',
      permissionError: error?.message || 'Could not check browser permissions',
      lastPermissionCheckedAt: Date.now(),
    }
    return bridgeState
  }
}

async function requestBrowserAccess() {
  try {
    const granted = await chrome.permissions.request({ origins: OPTIONAL_BROWSER_ORIGINS })
    await refreshPermissionState()
    if (granted) {
      await refreshTabInventory()
      scheduleCapture('permission-granted', { emitEvent: true })
      scheduleAudioScan('permission-granted')
    }
    return { ok: Boolean(granted), bridgeState }
  } catch (error) {
    bridgeState = {
      ...bridgeState,
      hostPermissionGranted: false,
      captureMode: 'permission-required',
      permissionError: error?.message || 'Browser permission request failed',
      lastPermissionCheckedAt: Date.now(),
    }
    return { ok: false, error: bridgeState.permissionError, bridgeState }
  }
}

async function ensureContentScript(tabId) {
  if (!tabId) return false
  if (injectedTabs.has(tabId)) return true
  const state = await refreshPermissionState()
  if (!state.hostPermissionGranted) return false

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
    injectedTabs.add(tabId)
    bridgeState = {
      ...bridgeState,
      contentScriptEnabled: true,
      captureMode: getCaptureMode(),
      permissionError: '',
    }
    return true
  } catch (error) {
    bridgeState = {
      ...bridgeState,
      contentScriptEnabled: false,
      permissionError: error?.message || 'Could not inject page signal collector',
      captureMode: getCaptureMode(),
    }
    return false
  }
}

function detectBrowserApp() {
  const userAgent = String(self.navigator?.userAgent || '')
  if (userAgent.includes('Edg/')) return 'Microsoft Edge'
  return 'Google Chrome'
}

function normalizeUrl(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl)
    if (!/^https?:$/i.test(parsed.protocol)) {
      return {
        url: '',
        host: '',
      }
    }
    return {
      url: parsed.toString(),
      host: parsed.hostname || '',
    }
  } catch {
    return {
      url: '',
      host: '',
    }
  }
}

function createTabSnapshot(tab, eventType = 'unknown', extras = {}) {
  if (!tab) return null

  const pageSignal = getFreshPageSignal(Number(tab.id ?? 0) || null)
  const { url, host } = normalizeUrl(pageSignal?.url || tab.pendingUrl || tab.url || '')
  return {
    browserApp: detectBrowserApp(),
    browserFamily: 'chromium',
    tabId: Number(tab.id ?? 0) || null,
    windowId: Number(tab.windowId ?? 0) || null,
    url,
    host,
    pageTitle: String(pageSignal?.pageTitle || tab.title || '').trim(),
    active: Boolean(tab.active),
    highlighted: Boolean(tab.highlighted),
    audible: Boolean(tab.audible || pageSignal?.hasPlayingMedia),
    muted: Boolean(tab.mutedInfo?.muted),
    pinned: Boolean(tab.pinned),
    discarded: Boolean(tab.discarded),
    openerTabId: Number(tab.openerTabId ?? 0) || null,
    mediaTitle: String(pageSignal?.mediaTitle || '').trim(),
    mediaArtist: String(pageSignal?.mediaArtist || '').trim(),
    mediaAlbum: String(pageSignal?.mediaAlbum || '').trim(),
    mediaSessionActive: Boolean(pageSignal?.mediaSessionActive),
    capturedAt: Date.now(),
    eventType,
    extensionVersion: EXTENSION_VERSION,
    ...extras,
  }
}

function rememberSnapshot(snapshot) {
  if (!snapshot?.tabId) return snapshot
  tabCache.set(snapshot.tabId, { ...snapshot })
  return snapshot
}

function forgetSnapshot(tabId) {
  const cached = tabCache.get(tabId) || null
  tabCache.delete(tabId)
  pageSignalCache.delete(tabId)
  injectedTabs.delete(tabId)
  return cached
}

function getFreshPageSignal(tabId) {
  if (!tabId) return null
  const cached = pageSignalCache.get(tabId)
  if (!cached) return null
  if ((Date.now() - Number(cached.lastSeenAt || 0)) > 30000) {
    pageSignalCache.delete(tabId)
    return null
  }
  return cached
}

function rememberPageSignal(tabId, signal = {}) {
  if (!tabId) return null
  const normalized = {
    ...signal,
    signature: JSON.stringify([
      signal.url || '',
      signal.host || '',
      signal.pageTitle || '',
      Boolean(signal.hasPlayingMedia),
      signal.mediaTitle || '',
      signal.mediaArtist || '',
      signal.visibilityState || '',
    ]),
    lastSeenAt: Date.now(),
  }
  pageSignalCache.set(tabId, normalized)
  return normalized
}

async function refreshTabInventory() {
  try {
    await refreshPermissionState()
    const tabs = await chrome.tabs.query({})
    latestKnownTabCount = Array.isArray(tabs) ? tabs.length : 0
    for (const tab of tabs) {
      rememberSnapshot(createTabSnapshot(tab, 'inventory'))
    }
  } catch {
    latestKnownTabCount = tabCache.size
  }
}

async function getActiveTabSnapshot(reason = 'unknown') {
  const state = await refreshPermissionState()
  if (!state.hostPermissionGranted) return null
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) return null
  await ensureContentScript(Number(tab.id ?? 0) || null)
  return rememberSnapshot(createTabSnapshot(tab, reason, { setActiveContext: true }))
}

async function fetchWithBridgeTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(), BRIDGE_REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(
        options?.method === 'GET'
          ? 'Bridge health check timed out'
          : 'Bridge request timed out',
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function buildStatusPayload() {
  return {
    snapshot: latestSnapshot,
    latestEvent,
    audibleTabs: latestAudibleTabs,
    openTabCount: latestKnownTabCount,
    bridgeState,
  }
}

async function postJson(url, payload) {
  const response = await fetchWithBridgeTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bridgeToken ? { 'X-Velance-Bridge-Token': bridgeToken } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await response.text().catch(() => '')
    const error = new Error(message || `Bridge request failed with ${response.status}`)
    error.status = response.status
    throw error
  }

  return response.json().catch(() => ({}))
}

function isInvalidTokenError(error) {
  const message = String(error?.message || '')
  return Number(error?.status || 0) === 403 && message.includes('invalid-token')
}

async function bootstrapBridgeToken() {
  bridgeToken = ''
  await checkBridgeHealth()
}

async function postJsonWithBridgeRetry(url, payload) {
  try {
    return await postJson(url, payload)
  } catch (error) {
    if (!isInvalidTokenError(error)) {
      throw error
    }

    await bootstrapBridgeToken()
    return postJson(url, payload)
  }
}

function markBridgeFailure(error) {
  bridgeState = {
    ...bridgeState,
    connected: false,
    lastError: error?.message || 'Bridge unavailable',
  }
}

function markBridgeSuccess(kind = 'context', detail = {}) {
  const now = Date.now()
  bridgeState = {
    ...bridgeState,
    connected: true,
    lastSuccessAt: now,
    lastError: '',
  }

  if (kind === 'event') {
    bridgeState.lastEventAt = now
    bridgeState.lastEventType = detail.eventType || bridgeState.lastEventType
  }

  if (kind === 'audio') {
    bridgeState.lastAudioAt = now
  }
}

async function sendContextSnapshot(snapshot) {
  if (!snapshot) return
  if (!(await refreshPermissionState()).hostPermissionGranted) return
  latestSnapshot = snapshot
  bridgeState.lastAttemptAt = Date.now()

  try {
    const response = await postJsonWithBridgeRetry(BRIDGE_CONTEXT_URL, snapshot)
    markBridgeSuccess('context')
    if (response?.ignored) {
      bridgeState.captureEnabled = false
    }
  } catch (error) {
    markBridgeFailure(error)
  }
}

async function sendBrowserEvent(snapshot) {
  if (!snapshot) return
  if (!(await refreshPermissionState()).hostPermissionGranted) return
  latestEvent = snapshot
  bridgeState.lastAttemptAt = Date.now()

  try {
    const response = await postJsonWithBridgeRetry(BRIDGE_EVENT_URL, snapshot)
    markBridgeSuccess('event', { eventType: snapshot.eventType })
    if (response?.ignored) {
      bridgeState.captureEnabled = false
    }
  } catch (error) {
    markBridgeFailure(error)
  }
}

async function sendAudibleTabs(reason = 'audio-heartbeat') {
  bridgeState.lastAttemptAt = Date.now()
  try {
    if (!(await refreshPermissionState()).hostPermissionGranted) {
      latestAudibleTabs = []
      return
    }
    const tabs = await chrome.tabs.query({})
    latestKnownTabCount = Array.isArray(tabs) ? tabs.length : latestKnownTabCount
    latestAudibleTabs = (Array.isArray(tabs) ? tabs : [])
      .filter((tab) => Boolean(tab.audible || getFreshPageSignal(Number(tab.id ?? 0) || null)?.hasPlayingMedia))
      .map((tab) => {
        const snapshot = rememberSnapshot(createTabSnapshot(tab, reason, { isAudioContext: true }))
        return {
          ...snapshot,
          trackTitle: snapshot?.mediaTitle || snapshot?.pageTitle || '',
          artist: snapshot?.mediaArtist || snapshot?.host || '',
          album: snapshot?.mediaAlbum || '',
        }
      })

    const response = await postJsonWithBridgeRetry(BRIDGE_AUDIO_URL, {
      browserApp: detectBrowserApp(),
      extensionVersion: EXTENSION_VERSION,
      capturedAt: Date.now(),
      reason,
      tabs: latestAudibleTabs,
    })
    markBridgeSuccess('audio')
    if (response?.ignored) {
      bridgeState.captureEnabled = false
    }
  } catch (error) {
    latestAudibleTabs = []
    markBridgeFailure(error)
  }
}

async function emitTabEvent(tab, eventType, extras = {}) {
  const snapshot = rememberSnapshot(createTabSnapshot(tab, eventType, extras))
  await sendBrowserEvent(snapshot)
  if (snapshot?.active) {
    await sendContextSnapshot({
      ...snapshot,
      setActiveContext: true,
    })
  }
}

async function emitRemovedTabEvent(tabId, removeInfo = {}) {
  const cached = forgetSnapshot(tabId)
  if (!cached) return
  await sendBrowserEvent({
    ...cached,
    active: false,
    capturedAt: Date.now(),
    eventType: 'tab-removed',
    isWindowClosing: Boolean(removeInfo.isWindowClosing),
    windowId: Number(removeInfo.windowId ?? cached.windowId ?? 0) || null,
  })
}

function scheduleCapture(reason = 'event', { emitEvent = false } = {}) {
  if (captureTimer) clearTimeout(captureTimer)
  captureTimer = setTimeout(async () => {
    captureTimer = null
    const snapshot = await getActiveTabSnapshot(reason)
    if (!snapshot) return
    if (emitEvent) {
      await sendBrowserEvent(snapshot)
    }
    await sendContextSnapshot(snapshot)
  }, 120)
}

function scheduleAudioScan(reason = 'audio-event') {
  if (audioTimer) clearTimeout(audioTimer)
  audioTimer = setTimeout(async () => {
    audioTimer = null
    await sendAudibleTabs(reason)
  }, 120)
}

async function checkBridgeHealth() {
  bridgeState.lastAttemptAt = Date.now()
  try {
    let response = await fetchWithBridgeTimeout(BRIDGE_HEALTH_URL, {
      method: 'GET',
      headers: bridgeToken ? { 'X-Velance-Bridge-Token': bridgeToken } : {},
    })
    if (!response.ok && bridgeToken) {
      bridgeToken = ''
      response = await fetchWithBridgeTimeout(BRIDGE_HEALTH_URL, { method: 'GET' })
    }
    if (!response.ok) throw new Error(`Health check failed with ${response.status}`)
    const payload = await response.json().catch(() => ({}))
    markBridgeSuccess('context')
    bridgeState.captureEnabled = payload?.captureEnabled !== false
    bridgeState.captureHosts = payload?.captureHosts !== false
    bridgeState.captureTitles = payload?.captureTitles !== false
    bridgeState.captureAudioTitles = payload?.captureAudioTitles !== false
    bridgeState.captureMode = getCaptureMode()
    bridgeState.authMode = payload?.authMode || 'extension-token'
    bridgeState.tokenIssuedAt = Number(payload?.tokenIssuedAt || Date.now())
    if (payload?.bridgeToken) {
      bridgeToken = String(payload.bridgeToken)
    }
  } catch (error) {
    markBridgeFailure(error)
  }
}

async function collectLiveStatus(reason = 'status-refresh') {
  await refreshTabInventory()

  if (!latestSnapshot) {
    const snapshot = await getActiveTabSnapshot(reason)
    if (snapshot) {
      latestSnapshot = snapshot
    }
  }

  void sendAudibleTabs(reason)

  return buildStatusPayload()
}

function ensureAlarms() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 })
  chrome.alarms.create(AUDIO_ALARM, { periodInMinutes: 1 })
}

function initializeBridgeWorker() {
  ensureAlarms()
  void refreshTabInventory()
}

initializeBridgeWorker()

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms()
  refreshTabInventory()
  scheduleCapture('installed', { emitEvent: true })
  scheduleAudioScan('installed')
})

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms()
  refreshTabInventory()
  scheduleCapture('startup', { emitEvent: true })
  scheduleAudioScan('startup')
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    refreshTabInventory()
    scheduleCapture('heartbeat')
    return
  }

  if (alarm.name === AUDIO_ALARM) {
    scheduleAudioScan('audio-heartbeat')
  }
})

chrome.tabs.onCreated.addListener((tab) => {
  latestKnownTabCount += 1
  emitTabEvent(tab, 'tab-created')
  scheduleAudioScan('tab-created')
})

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  latestKnownTabCount = Math.max(0, latestKnownTabCount - 1)
  emitRemovedTabEvent(tabId, removeInfo)
  scheduleAudioScan('tab-removed')
})

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      scheduleCapture('tab-activated', { emitEvent: true })
      return
    }
    emitTabEvent(tab, 'tab-activated', {
      previousTabId: Number(activeInfo.previousTabId ?? 0) || null,
      setActiveContext: true,
    })
  })
})

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return
    emitTabEvent(tab, 'tab-attached', {
      newWindowId: Number(attachInfo.newWindowId ?? 0) || null,
      newPosition: Number(attachInfo.newPosition ?? -1),
    })
  })
})

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  const cached = tabCache.get(tabId)
  if (!cached) return
  sendBrowserEvent({
    ...cached,
    capturedAt: Date.now(),
    eventType: 'tab-detached',
    oldWindowId: Number(detachInfo.oldWindowId ?? 0) || null,
    oldPosition: Number(detachInfo.oldPosition ?? -1),
  })
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  rememberSnapshot(createTabSnapshot(tab, 'tab-updated'))

  const relevantChange = (
    changeInfo.status === 'complete'
    || Boolean(changeInfo.url)
    || Boolean(changeInfo.title)
    || Object.prototype.hasOwnProperty.call(changeInfo, 'audible')
    || Object.prototype.hasOwnProperty.call(changeInfo, 'mutedInfo')
    || Object.prototype.hasOwnProperty.call(changeInfo, 'discarded')
  )

  if (relevantChange) {
    emitTabEvent(tab, 'tab-updated', {
      changeStatus: String(changeInfo.status || ''),
      setActiveContext: Boolean(tab.active),
    })
  }

  if (
    Object.prototype.hasOwnProperty.call(changeInfo, 'audible')
    || Object.prototype.hasOwnProperty.call(changeInfo, 'mutedInfo')
    || Boolean(changeInfo.url)
    || Boolean(changeInfo.title)
  ) {
    scheduleAudioScan('tab-audio-updated')
  }
})

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  scheduleCapture('window-focus', { emitEvent: true })
  scheduleAudioScan('window-focus')
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'velance:page-signal') {
    const senderTab = _sender?.tab
    if (!senderTab?.id) {
      sendResponse?.({ ok: false, ignored: true })
      return false
    }

    const previousSignal = getFreshPageSignal(Number(senderTab.id))
    const nextSignal = rememberPageSignal(Number(senderTab.id), {
      url: message.url || senderTab.url || '',
      host: message.host || '',
      pageTitle: message.pageTitle || senderTab.title || '',
      hasPlayingMedia: Boolean(message.hasPlayingMedia),
      mediaTitle: message.mediaTitle || '',
      mediaArtist: message.mediaArtist || '',
      mediaAlbum: message.mediaAlbum || '',
      mediaSessionActive: Boolean(message.mediaSessionActive),
      visibilityState: String(message.visibilityState || ''),
      capturedAt: Number(message.capturedAt || Date.now()),
      reason: String(message.reason || 'page-signal'),
    })

    const changed = !previousSignal || previousSignal.signature !== nextSignal.signature
    if (changed) {
      const snapshot = rememberSnapshot(createTabSnapshot({
        ...senderTab,
        title: nextSignal.pageTitle || senderTab.title || '',
      }, 'page-signal', {
        setActiveContext: Boolean(senderTab.active),
        pageSignalReason: nextSignal.reason || 'page-signal',
      }))

      void sendBrowserEvent(snapshot)
      if (snapshot?.active) {
        void sendContextSnapshot({
          ...snapshot,
          setActiveContext: true,
        })
      }
      if (nextSignal.hasPlayingMedia) {
        scheduleAudioScan('page-signal')
      }
    }

    sendResponse?.({ ok: true, changed })
    return false
  }

  if (message?.type === 'velance:get-status') {
    collectLiveStatus('popup-status')
      .then((status) => sendResponse(status))
      .catch(() => sendResponse(buildStatusPayload()))
    return true
  }

  if (message?.type === 'velance:request-browser-access') {
    requestBrowserAccess()
      .then((status) => sendResponse(status))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || 'Browser permission request failed',
        bridgeState,
      }))
    return true
  }

  if (message?.type === 'velance:refresh-now') {
    Promise.all([
      (async () => {
        await refreshTabInventory()
        const snapshot = await getActiveTabSnapshot('manual-refresh')
        if (snapshot) {
          await sendBrowserEvent({
            ...snapshot,
            eventType: 'manual-refresh',
            setActiveContext: true,
          })
          await sendContextSnapshot(snapshot)
        }
      })(),
      sendAudibleTabs('manual-refresh'),
    ])
      .then(() => sendResponse({
        ok: true,
        ...buildStatusPayload(),
      }))
      .catch((error) => sendResponse({
        ok: false,
        error: error?.message || 'Refresh failed',
      }))
    return true
  }

  if (message?.type === 'velance:check-bridge') {
    checkBridgeHealth().finally(() => {
      sendResponse({
        ok: true,
        bridgeState,
      })
    })
    return true
  }

  return false
})
