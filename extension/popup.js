const bridgeStatusEl = document.getElementById('bridge-status')
const bridgeCopyEl = document.getElementById('bridge-copy')
const browserAppEl = document.getElementById('browser-app')
const browserHostEl = document.getElementById('browser-host')
const browserTitleEl = document.getElementById('browser-title')
const lastSendEl = document.getElementById('last-send')
const lastEventEl = document.getElementById('last-event')
const openTabsEl = document.getElementById('open-tabs')
const audibleTabsEl = document.getElementById('audible-tabs')
const audibleListEl = document.getElementById('audible-list')
const refreshBtn = document.getElementById('refresh-btn')
const grantPermissionBtn = document.getElementById('grant-permission-btn')
const captureModeEl = document.getElementById('capture-mode')

function formatTime(timestamp = 0) {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function truncate(value = '', max = 42) {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function titleCase(value = '') {
  const text = String(value || '').replace(/[-_]/g, ' ').trim()
  if (!text) return '--'
  return text.replace(/\b\w/g, (char) => char.toUpperCase())
}

function getCaptureModeLabel(bridgeState = {}) {
  if (!bridgeState.hostPermissionGranted) return 'Permission needed'
  if (bridgeState.captureEnabled === false) return 'Paused'
  if (bridgeState.captureHosts && !bridgeState.captureTitles && !bridgeState.captureAudioTitles) return 'Host only'
  if (bridgeState.captureHosts && bridgeState.captureTitles && !bridgeState.captureAudioTitles) return 'Standard'
  if (bridgeState.captureHosts && bridgeState.captureTitles && bridgeState.captureAudioTitles) return 'Rich media'
  return 'Custom'
}

function buildFallbackBridgeState(error = '') {
  return {
    connected: false,
    captureEnabled: true,
    captureHosts: true,
    captureTitles: true,
    captureAudioTitles: true,
    hostPermissionGranted: false,
    contentScriptEnabled: false,
    captureMode: 'permission-required',
    permissionError: '',
    lastError: error || 'Extension bridge status is still loading.',
  }
}

function sendRuntimeMessage(message, { timeoutMs = 1500, fallback = null } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, timeoutMs)

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutHandle)

        if (chrome.runtime.lastError) {
          resolve({
            ...(fallback || {}),
            error: chrome.runtime.lastError.message || 'Extension background worker unavailable',
          })
          return
        }

        resolve(response ?? fallback)
      })
    } catch (error) {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      resolve({
        ...(fallback || {}),
        error: error?.message || 'Extension message failed',
      })
    }
  })
}

function paintStatus(bridgeState = {}) {
  if (!bridgeState.hostPermissionGranted) {
    bridgeStatusEl.textContent = 'Permission needed'
    bridgeStatusEl.className = 'badge status warn'
    bridgeCopyEl.textContent = bridgeState.permissionError
      ? `Browser access is not enabled: ${bridgeState.permissionError}`
      : 'Allow browser access only if you want Velance to send tab context to the local desktop app.'
    grantPermissionBtn.hidden = false
    refreshBtn.disabled = true
    return
  }

  grantPermissionBtn.hidden = true
  refreshBtn.disabled = false

  if (bridgeState.connected && bridgeState.captureEnabled === false) {
    bridgeStatusEl.textContent = 'Paused'
    bridgeStatusEl.className = 'badge status warn'
    bridgeCopyEl.textContent = 'Velance is open, but browser capture is paused in desktop Settings.'
    return
  }

  if (bridgeState.connected) {
    bridgeStatusEl.textContent = 'Connected'
    bridgeStatusEl.className = 'badge status good'
    bridgeCopyEl.textContent = 'Velance is receiving live browser events, active context, and audible-tab updates.'
    return
  }

  bridgeStatusEl.textContent = bridgeState.lastError ? 'Unavailable' : 'Waiting'
  bridgeStatusEl.className = 'badge status warn'
  bridgeCopyEl.textContent = bridgeState.lastError
    ? `Bridge unavailable: ${bridgeState.lastError}`
    : 'Open the Velance desktop app to start sending browser context.'
}

function paintAudibleTabs(tabs = []) {
  audibleListEl.innerHTML = ''
  if (!Array.isArray(tabs) || !tabs.length) {
    const row = document.createElement('div')
    row.className = 'audible-empty'
    row.textContent = 'No audible tabs right now.'
    audibleListEl.appendChild(row)
    return
  }

  tabs.slice(0, 4).forEach((tab) => {
    const row = document.createElement('div')
    row.className = 'audible-row'

    const title = document.createElement('strong')
    title.textContent = truncate(tab.trackTitle || tab.mediaTitle || tab.pageTitle || tab.host || 'Untitled tab', 34)

    const meta = document.createElement('span')
    meta.textContent = tab.artist || tab.mediaArtist || tab.host || tab.browserApp || '--'

    row.appendChild(title)
    row.appendChild(meta)
    audibleListEl.appendChild(row)
  })
}

function paintSnapshot(snapshot = null, latestEvent = null, audibleTabs = [], openTabCount = 0, bridgeState = {}) {
  browserAppEl.textContent = snapshot?.browserApp || '--'
  browserHostEl.textContent = snapshot?.host || '--'
  browserTitleEl.textContent = truncate(snapshot?.pageTitle || '--')
  lastSendEl.textContent = formatTime(bridgeState.lastSuccessAt || bridgeState.lastAttemptAt || snapshot?.capturedAt || 0)
  lastEventEl.textContent = titleCase(latestEvent?.eventType || bridgeState.lastEventType || '--')
  openTabsEl.textContent = openTabCount ? String(openTabCount) : '--'
  audibleTabsEl.textContent = Array.isArray(audibleTabs) ? String(audibleTabs.length) : '--'
  if (captureModeEl) captureModeEl.textContent = getCaptureModeLabel(bridgeState)
  paintAudibleTabs(audibleTabs)
}

async function refreshStatus() {
  const response = await sendRuntimeMessage(
    { type: 'velance:get-status' },
    {
      timeoutMs: 1800,
      fallback: {
        snapshot: null,
        latestEvent: null,
        audibleTabs: [],
        openTabCount: 0,
        bridgeState: buildFallbackBridgeState('Bridge status request timed out'),
      },
    },
  )
  const snapshot = response?.snapshot || null
  const latestEvent = response?.latestEvent || null
  const audibleTabs = response?.audibleTabs || []
  const openTabCount = response?.openTabCount || 0
  const bridgeState = response?.bridgeState || buildFallbackBridgeState(response?.error || '')

  if (response?.error && !bridgeState.lastError) {
    bridgeState.lastError = response.error
  }

  paintStatus(bridgeState)
  paintSnapshot(snapshot, latestEvent, audibleTabs, openTabCount, bridgeState)
}

refreshBtn.addEventListener('click', async () => {
  bridgeStatusEl.textContent = 'Syncing'
  bridgeStatusEl.className = 'badge status warn'
  bridgeCopyEl.textContent = 'Refreshing bridge health and browser context.'
  await sendRuntimeMessage(
    { type: 'velance:check-bridge' },
    { timeoutMs: 1800, fallback: { bridgeState: buildFallbackBridgeState('Bridge health check timed out') } },
  )
  await sendRuntimeMessage(
    { type: 'velance:refresh-now' },
    { timeoutMs: 2200, fallback: { ok: false, error: 'Manual browser sync timed out' } },
  )
  setTimeout(() => {
    void refreshStatus()
  }, 180)
})

grantPermissionBtn.addEventListener('click', async () => {
  bridgeStatusEl.textContent = 'Requesting'
  bridgeStatusEl.className = 'badge status warn'
  bridgeCopyEl.textContent = 'Chrome will ask whether Velance can read browser context for tracking.'

  const permissionResponse = await sendRuntimeMessage(
    { type: 'velance:request-browser-access' },
    {
      timeoutMs: 5000,
      fallback: {
        ok: false,
        error: 'Browser permission request timed out',
        bridgeState: buildFallbackBridgeState('Browser permission request timed out'),
      },
    },
  )
  const granted = Boolean(permissionResponse?.ok)

  if (!granted) {
    bridgeCopyEl.textContent = permissionResponse?.error
      ? `Browser access was not granted: ${permissionResponse.error}`
      : 'Browser access was not granted. Velance will keep desktop-only tracking available.'
  }

  await refreshStatus()
})

void sendRuntimeMessage(
  { type: 'velance:check-bridge' },
  { timeoutMs: 1800, fallback: { bridgeState: buildFallbackBridgeState('Initial bridge check timed out') } },
).finally(() => {
  void refreshStatus()
})

const liveRefresh = setInterval(refreshStatus, 1500)
window.addEventListener('beforeunload', () => clearInterval(liveRefresh))
