const EMIT_INTERVAL_MS = 4000
let emitTimer = null
let titleObserver = null
let mediaBound = false
let lastSignature = ''

function normalizeUrl(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl)
    if (!/^https?:$/i.test(parsed.protocol)) {
      return { url: '', host: '' }
    }
    return {
      url: parsed.toString(),
      host: parsed.hostname || '',
    }
  } catch {
    return { url: '', host: '' }
  }
}

function truncate(value = '', max = 220) {
  return String(value || '').trim().slice(0, max)
}

function getPlayingMediaElements() {
  return Array.from(document.querySelectorAll('audio,video')).filter((element) => {
    try {
      return !element.paused && !element.ended && element.readyState >= 2
    } catch {
      return false
    }
  })
}

function getMediaSessionMetadata() {
  const metadata = globalThis.navigator?.mediaSession?.metadata
  if (!metadata) {
    return {
      title: '',
      artist: '',
      album: '',
      hasMetadata: false,
    }
  }

  return {
    title: truncate(metadata.title || ''),
    artist: truncate(metadata.artist || ''),
    album: truncate(metadata.album || ''),
    hasMetadata: true,
  }
}

function buildPageSignal(reason = 'heartbeat') {
  const { url, host } = normalizeUrl(globalThis.location?.href || '')
  const mediaElements = getPlayingMediaElements()
  const sessionMeta = getMediaSessionMetadata()
  const leadMedia = mediaElements[0] || null
  const pageTitle = truncate(document.title || '')
  const mediaTitle = sessionMeta.title || truncate(leadMedia?.getAttribute?.('title') || '') || pageTitle
  const mediaArtist = sessionMeta.artist || host
  const mediaAlbum = sessionMeta.album || ''
  const hasPlayingMedia = mediaElements.length > 0 || Boolean(sessionMeta.hasMetadata && sessionMeta.title)

  return {
    type: 'velance:page-signal',
    reason,
    capturedAt: Date.now(),
    url,
    host,
    pageTitle,
    visibilityState: String(document.visibilityState || 'visible'),
    hasPlayingMedia,
    mediaElementCount: mediaElements.length,
    mediaTitle: truncate(mediaTitle || ''),
    mediaArtist: truncate(mediaArtist || ''),
    mediaAlbum: truncate(mediaAlbum || ''),
    mediaSessionActive: Boolean(sessionMeta.hasMetadata),
  }
}

function emitPageSignal(reason = 'heartbeat', { force = false } = {}) {
  const payload = buildPageSignal(reason)
  const signature = JSON.stringify([
    payload.url,
    payload.pageTitle,
    payload.hasPlayingMedia,
    payload.mediaTitle,
    payload.mediaArtist,
    payload.visibilityState,
  ])

  if (!force && signature === lastSignature) return
  lastSignature = signature
  chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError)
}

function scheduleEmit(reason = 'heartbeat', force = false) {
  if (emitTimer) clearTimeout(emitTimer)
  emitTimer = setTimeout(() => {
    emitTimer = null
    emitPageSignal(reason, { force })
  }, 120)
}

function bindMediaListeners() {
  if (mediaBound) return
  mediaBound = true

  const mediaEvents = ['play', 'pause', 'ended', 'volumechange', 'loadedmetadata', 'emptied']
  mediaEvents.forEach((eventName) => {
    document.addEventListener(eventName, () => scheduleEmit(`media-${eventName}`, true), true)
  })
}

function bindTitleObserver() {
  if (titleObserver) return

  titleObserver = new MutationObserver(() => {
    scheduleEmit('title-change', true)
  })

  titleObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
  })
}

document.addEventListener('visibilitychange', () => {
  scheduleEmit('visibility-change', true)
})

window.addEventListener('focus', () => {
  scheduleEmit('window-focus', true)
})

window.addEventListener('pageshow', () => {
  scheduleEmit('page-show', true)
})

window.addEventListener('beforeunload', () => {
  emitPageSignal('before-unload', { force: true })
})

bindMediaListeners()
bindTitleObserver()
scheduleEmit('content-ready', true)
setInterval(() => emitPageSignal('heartbeat'), EMIT_INTERVAL_MS)
