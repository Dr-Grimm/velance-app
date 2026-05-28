import { app, BrowserWindow, ipcMain, Menu, Notification, shell } from 'electron'
import electronUpdaterPkg from 'electron-updater'
const { autoUpdater } = electronUpdaterPkg
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { appendFileSync, copyFileSync, existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { request as httpsRequest } from 'https'
import { createDataRepository } from './db.js'
import { registerDataIpc } from './ipcData.js'
import { normalizeAiSettings } from '../src/services/aiProvider.js'
import {
    CATEGORY_COLORS,
    TRACKING_LANE_KEYS,
    getLaneFromProductive,
    isInternalTrackingActivity,
    normalizeAmbientEntryPayload,
    normalizeObservedAppName,
    trimBrowserTitle,
} from '../src/services/activityClassification.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

try {
    const appDataPath = app.getPath('appData')
    const nextUserDataPath = join(appDataPath, 'Velance')
    const legacyUserDataPath = join(appDataPath, 'velance-app')
    mkdirSync(nextUserDataPath, { recursive: true })

    for (const filename of ['velance.sqlite', 'velance-fallback.json']) {
        const legacyPath = join(legacyUserDataPath, filename)
        const nextPath = join(nextUserDataPath, filename)
        if (!existsSync(nextPath) && existsSync(legacyPath)) {
            try {
                copyFileSync(legacyPath, nextPath)
            } catch {
            }
        }
    }

    app.setName('Velance')
    app.setPath('userData', nextUserDataPath)
    app.commandLine.appendSwitch('user-data-dir', nextUserDataPath)
} catch {
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

let mainWindow
let trackingInterval = null     // focus session tracking
let ambientInterval = null      // 24/7 background ambient tracking
let mediaInterval = null        // background media playback tracking
let pulseInterval = null        // 30s productivity pulse broadcast
let activeWinModule = null
let uiohookModule = null
let dataRepo = null
let trackingUserId = 'local-user'
const DEFAULT_RUNTIME_POLICY = Object.freeze({
    trackingEnabled: false,
    keystrokeEnabled: true,
    mouseEnabled: true,
    notificationsEnabled: true,
    breakReminders: true,
    breakIntervalMinutes: 90,
    dataRetentionDays: 90,
    browserExtensionEnabled: false,
    browserCaptureHosts: true,
    browserCaptureTitles: false,
    browserCaptureAudioTitles: false,
    trackingConsentGranted: false,
})
let runtimePolicy = { ...DEFAULT_RUNTIME_POLICY }
let mediaTrackingUnsupported = false
const EXTENSION_BRIDGE_PORT = 48152
const EXTENSION_BRIDGE_HOST = '127.0.0.1'
const EXTENSION_CONTEXT_TTL_MS = 20000
const EXTENSION_BRIDGE_STALE_MS = 45000
const EXTENSION_BRIDGE_RETRY_MS = 3500
let extensionBridgeServer = null
let extensionBridgeRetryTimer = null
const extensionBrowserContexts = new Map()
const extensionAudioSessions = new Map()
let extensionBridgeToken = randomUUID()
let browserBridgeStatus = {
    ready: false,
    connected: false,
    lastContactAt: 0,
    lastContextAt: 0,
    lastEventAt: 0,
    lastAudioAt: 0,
    lastEventType: '',
    lastBrowserApp: '',
    lastHost: '',
    lastTitle: '',
    lastAudibleHost: '',
    lastExtensionVersion: '',
    receivedEvents: 0,
    audibleEvents: 0,
    ignoredEvents: 0,
    lastError: '',
    hostPermissionGranted: false,
    contentScriptEnabled: false,
    captureMode: 'permission-required',
    permissionError: '',
    lastPermissionCheckedAt: 0,
    authMode: 'extension-token',
    tokenIssuedAt: 0,
    tokenValidatedAt: 0,
}

function isExtensionOrigin(origin = '') {
    const value = String(origin || '').trim().toLowerCase()
    return value.startsWith('chrome-extension://')
}

function getRequestOrigin(req) {
    return String(req?.headers?.origin || req?.headers?.Origin || '').trim()
}

function readBridgeToken(req) {
    return String(req?.headers?.['x-velance-bridge-token'] || '').trim()
}

function createBridgeCorsHeaders(origin = '') {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Velance-Bridge-Token',
    }
}

function authorizeExtensionBridgeRequest(req, { allowBootstrap = false } = {}) {
    const origin = getRequestOrigin(req)
    if (!isExtensionOrigin(origin)) {
        return { ok: false, reason: 'invalid-origin', origin }
    }

    const token = readBridgeToken(req)
    if (allowBootstrap) {
      return { ok: true, origin, bootstrap: token !== extensionBridgeToken }
    }

    if (!token || token !== extensionBridgeToken) {
        return { ok: false, reason: 'invalid-token', origin }
    }

    browserBridgeStatus = {
        ...browserBridgeStatus,
        tokenValidatedAt: Date.now(),
    }
    return { ok: true, origin, bootstrap: false }
}

function resolveBooleanSetting(value, fallback) {
    return value === undefined || value === null ? fallback : Boolean(value)
}

function getBrowserAppKey(appName = '') {
    const normalized = String(appName || '').trim().toLowerCase()
    if (!normalized) return ''
    if (/microsoft edge|^edge$/i.test(normalized)) return 'microsoft edge'
    if (/google chrome|^chrome$/i.test(normalized)) return 'google chrome'
    return ''
}

function getFreshExtensionBrowserContext(appName = '') {
    const key = getBrowserAppKey(appName)
    if (!key) return null
    const cached = extensionBrowserContexts.get(key)
    if (!cached) return null
    if ((Date.now() - Number(cached.lastSeenAt || 0)) > EXTENSION_CONTEXT_TTL_MS) {
        extensionBrowserContexts.delete(key)
        return null
    }
    return cached
}

function normalizeBridgeText(value = '', max = 240) {
    return String(value || '').trim().slice(0, max)
}

function buildBridgeContextTitle(payload = {}, fallbackTitle = '') {
    const pageTitle = normalizeBridgeText(payload.pageTitle || payload.title || fallbackTitle)
    const mediaTitle = normalizeBridgeText(payload.mediaTitle || payload.trackTitle)
    const mediaArtist = normalizeBridgeText(payload.mediaArtist || payload.artist)
    const parts = []

    if (mediaTitle) parts.push(mediaTitle)
    if (
        pageTitle
        && !parts.some((part) => part.toLowerCase() === pageTitle.toLowerCase())
        && !pageTitle.toLowerCase().includes(String(mediaTitle || '').toLowerCase())
        && !String(mediaTitle || '').toLowerCase().includes(pageTitle.toLowerCase())
    ) {
        parts.push(pageTitle)
    }
    if (mediaArtist && !parts.some((part) => part.toLowerCase() === mediaArtist.toLowerCase())) {
        parts.push(mediaArtist)
    }

    return parts.join(' / ') || pageTitle || mediaTitle || mediaArtist || normalizeBridgeText(fallbackTitle) || 'Browser'
}

function cacheExtensionBrowserContext(payload = {}) {
    const appKey = getBrowserAppKey(payload.browserApp || '')
    if (!appKey) return null

    let host = String(payload.host || '').trim()
    let url = String(payload.url || '').trim()
    try {
        if (url) {
            const parsed = new URL(url)
            host = host || parsed.hostname || ''
            url = parsed.toString()
        }
    } catch {
        url = ''
    }

    const contextTitle = buildBridgeContextTitle(payload)
    const context = {
        browserApp: payload.browserApp,
        appKey,
        url,
        host,
        pageTitle: normalizeBridgeText(payload.pageTitle || payload.title),
        mediaTitle: normalizeBridgeText(payload.mediaTitle || payload.trackTitle),
        mediaArtist: normalizeBridgeText(payload.mediaArtist || payload.artist),
        mediaAlbum: normalizeBridgeText(payload.mediaAlbum || payload.album),
        mediaSessionActive: Boolean(payload.mediaSessionActive),
        contextTitle,
        tabId: Number(payload.tabId || 0) || null,
        windowId: Number(payload.windowId || 0) || null,
        audible: Boolean(payload.audible),
        muted: Boolean(payload.muted),
        eventType: String(payload.eventType || payload.reason || '').trim(),
        capturedAt: Number(payload.capturedAt || Date.now()),
        lastSeenAt: Date.now(),
        source: 'extension',
    }

    extensionBrowserContexts.set(appKey, context)
    return context
}

function flushExtensionAudioSession(signature, session, endTs = Date.now()) {
    if (!session?.sourceApp || !session?.startTs) return
    const safeEnd = Math.max(Number(endTs || Date.now()), Number(session.startTs || 0))
    const duration = Math.max(1, Math.round((safeEnd - Number(session.startTs || safeEnd)) / 1000))
    const persistedEntry = persistMediaChunk({
        ts: session.startTs,
        endTs: safeEnd,
        sourceApp: session.sourceApp,
        trackTitle: session.trackTitle,
        artist: session.artist,
        album: session.album,
        playbackState: session.playbackState || 'Playing',
        duration,
    })
    if (persistedEntry && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('velance:media-data', persistedEntry)
    }
    extensionAudioSessions.delete(signature)
}

function flushAllExtensionAudioSessions() {
    const now = Date.now()
    for (const [signature, session] of extensionAudioSessions.entries()) {
        flushExtensionAudioSession(signature, session, session.lastSeenAt || now)
    }
}

function reconcileExtensionAudioSnapshot(tabs = [], metadata = {}) {
    const now = Date.now()
    const activeSignatures = new Set()

    for (const rawTab of Array.isArray(tabs) ? tabs : []) {
        const browserApp = String(rawTab.browserApp || metadata.browserApp || '').trim()
        const appKey = getBrowserAppKey(browserApp)
        if (!appKey) continue

        let url = String(rawTab.url || '').trim()
        let host = String(rawTab.host || '').trim()
        try {
            if (url) {
                const parsed = new URL(url)
                url = parsed.toString()
                host = host || parsed.hostname || ''
            }
        } catch {
            url = ''
        }

        const pageTitle = String(rawTab.pageTitle || rawTab.title || '').trim()
        const signature = `${appKey}::${Number(rawTab.tabId || 0) || 0}::${host}::${pageTitle}`
        activeSignatures.add(signature)

        if (!Boolean(rawTab.audible)) continue

        const existing = extensionAudioSessions.get(signature)
        if (existing) {
            existing.lastSeenAt = now
            existing.trackTitle = pageTitle || existing.trackTitle
            existing.artist = host || existing.artist
            existing.playbackState = Boolean(rawTab.muted) ? 'Muted' : 'Playing'
            continue
        }

        extensionAudioSessions.set(signature, {
            sourceApp: browserApp,
            trackTitle: pageTitle || host || 'Browser audio',
            artist: host || '',
            album: 'Browser tab',
            playbackState: Boolean(rawTab.muted) ? 'Muted' : 'Playing',
            startTs: Number(rawTab.capturedAt || now),
            lastSeenAt: now,
        })
    }

    for (const [signature, session] of extensionAudioSessions.entries()) {
        const isActive = activeSignatures.has(signature)
        if (!isActive) {
            flushExtensionAudioSession(signature, session, session.lastSeenAt || now)
            continue
        }

        if ((now - Number(session.startTs || now)) >= 30000) {
            flushExtensionAudioSession(signature, session, now)
            extensionAudioSessions.set(signature, {
                ...session,
                startTs: now,
                lastSeenAt: now,
            })
        }
    }
}

function startExtensionBridge() {
    if (extensionBridgeServer) return
    clearExtensionBridgeRetry()

    extensionBridgeServer = createServer((req, res) => {
        const requestUrl = new URL(req.url || '/', `http://${EXTENSION_BRIDGE_HOST}:${EXTENSION_BRIDGE_PORT}`)
        const requestOrigin = getRequestOrigin(req)

        if (req.method === 'GET' && requestUrl.pathname === '/bridge/health') {
            const auth = authorizeExtensionBridgeRequest(req, { allowBootstrap: true })
            if (!auth.ok) {
                noteIgnoredBrowserBridgeRequest()
                res.writeHead(403, createBridgeCorsHeaders(requestOrigin || '*'))
                res.end(JSON.stringify({
                    ok: false,
                    error: auth.reason,
                }))
                return
            }
            touchBrowserBridgeStatus()
            browserBridgeStatus = {
                ...browserBridgeStatus,
                tokenIssuedAt: Date.now(),
            }
            res.writeHead(200, createBridgeCorsHeaders(requestOrigin))
            res.end(JSON.stringify({
                ok: true,
                bridge: 'browser-context',
                port: EXTENSION_BRIDGE_PORT,
                captureEnabled: isBrowserBridgeCaptureEnabled(),
                captureHosts: Boolean(runtimePolicy.browserCaptureHosts),
                captureTitles: Boolean(runtimePolicy.browserCaptureTitles),
                captureAudioTitles: Boolean(runtimePolicy.browserCaptureAudioTitles),
                captureMode: getBrowserBridgeStatusSnapshot().captureMode,
                authMode: 'extension-token',
                bridgeToken: extensionBridgeToken,
            }))
            return
        }

        if (req.method === 'OPTIONS' && requestUrl.pathname.startsWith('/bridge/')) {
            res.writeHead(204, createBridgeCorsHeaders(requestOrigin || '*'))
            res.end()
            return
        }

        if (req.method === 'POST' && requestUrl.pathname === '/bridge/browser-context') {
            let body = ''
            req.on('data', (chunk) => { body += chunk })
            req.on('end', () => {
                try {
                    const auth = authorizeExtensionBridgeRequest(req, { allowBootstrap: true })
                    if (!auth.ok) {
                        noteIgnoredBrowserBridgeRequest()
                        res.writeHead(403, createBridgeCorsHeaders(requestOrigin || '*'))
                        res.end(JSON.stringify({
                            ok: false,
                            error: auth.reason,
                        }))
                        return
                    }
                    const payload = JSON.parse(body || '{}')
                    const sanitizedPayload = sanitizeBrowserBridgePayload(payload)
                    if (!sanitizedPayload) {
                        noteIgnoredBrowserBridgeRequest()
                        res.writeHead(200, createBridgeCorsHeaders(requestOrigin))
                        res.end(JSON.stringify({
                            ok: true,
                            ignored: true,
                            reason: 'browser-capture-disabled',
                        }))
                        return
                    }

                    const cached = cacheExtensionBrowserContext(sanitizedPayload)
                    touchBrowserBridgeStatus({
                        lastContextAt: Date.now(),
                        lastBrowserApp: cached?.browserApp || '',
                        lastHost: cached?.host || '',
                        lastTitle: cached?.contextTitle || cached?.pageTitle || '',
                        lastExtensionVersion: String(sanitizedPayload.extensionVersion || browserBridgeStatus.lastExtensionVersion || ''),
                    })
                    res.writeHead(200, createBridgeCorsHeaders(requestOrigin))
                    res.end(JSON.stringify({
                        ok: true,
                        app: cached?.browserApp || null,
                        host: cached?.host || '',
                    }))

                    if (cached) {
                        writeRuntimeLog('extension.browser_context.received', {
                            app: cached.browserApp,
                            host: cached.host,
                            title: cached.contextTitle || cached.pageTitle,
                        })
                    }
                } catch (error) {
                    res.writeHead(400, createBridgeCorsHeaders(requestOrigin || '*'))
                    res.end(JSON.stringify({
                        ok: false,
                        error: `Invalid browser context payload. ${error.message}`,
                    }))
                }
            })
            return
        }

        if (req.method === 'POST' && requestUrl.pathname === '/bridge/browser-event') {
            let body = ''
            req.on('data', (chunk) => { body += chunk })
            req.on('end', () => {
                try {
                    const auth = authorizeExtensionBridgeRequest(req, { allowBootstrap: true })
                    if (!auth.ok) {
                        noteIgnoredBrowserBridgeRequest()
                        res.writeHead(403, createBridgeCorsHeaders(requestOrigin || '*'))
                        res.end(JSON.stringify({
                            ok: false,
                            error: auth.reason,
                        }))
                        return
                    }
                    const payload = JSON.parse(body || '{}')
                    const sanitizedPayload = sanitizeBrowserBridgePayload(payload)
                    if (!sanitizedPayload) {
                        noteIgnoredBrowserBridgeRequest()
                        res.writeHead(200, createBridgeCorsHeaders(requestOrigin))
                        res.end(JSON.stringify({
                            ok: true,
                            ignored: true,
                            reason: 'browser-capture-disabled',
                        }))
                        return
                    }

                    const shouldRefreshContext = sanitizedPayload?.active === true || sanitizedPayload?.setActiveContext === true
                    const cached = shouldRefreshContext ? cacheExtensionBrowserContext(sanitizedPayload) : null
                    const persistedEvent = persistBrowserEvent({
                        ...sanitizedPayload,
                        setActiveContext: shouldRefreshContext,
                    })
                    touchBrowserBridgeStatus({
                        lastEventAt: Date.now(),
                        lastEventType: sanitizedPayload?.eventType || cached?.eventType || browserBridgeStatus.lastEventType,
                        lastBrowserApp: sanitizedPayload?.browserApp || cached?.browserApp || browserBridgeStatus.lastBrowserApp,
                        lastHost: sanitizedPayload?.host || cached?.host || '',
                        lastTitle: cached?.contextTitle || sanitizedPayload?.pageTitle || cached?.pageTitle || '',
                        lastExtensionVersion: String(sanitizedPayload.extensionVersion || browserBridgeStatus.lastExtensionVersion || ''),
                        receivedEvents: Number(browserBridgeStatus.receivedEvents || 0) + 1,
                    })
                    if (Boolean(sanitizedPayload?.audible)) {
                        browserBridgeStatus = {
                            ...browserBridgeStatus,
                            lastAudioAt: Date.now(),
                            lastAudibleHost: sanitizedPayload?.host || browserBridgeStatus.lastAudibleHost,
                        }
                    }
                    res.writeHead(200, createBridgeCorsHeaders(requestOrigin))
                    res.end(JSON.stringify({
                        ok: true,
                        activeContextCached: Boolean(cached),
                        persisted: Boolean(persistedEvent),
                    }))

                    writeRuntimeLog('extension.browser_event.received', {
                        app: sanitizedPayload?.browserApp || cached?.browserApp || null,
                        host: sanitizedPayload?.host || cached?.host || '',
                        eventType: sanitizedPayload?.eventType || cached?.eventType || 'event',
                        audible: Boolean(sanitizedPayload?.audible),
                        active: Boolean(sanitizedPayload?.active),
                        contextRefreshed: Boolean(cached),
                        persisted: Boolean(persistedEvent),
                    })
                } catch (error) {
                    res.writeHead(400, createBridgeCorsHeaders(requestOrigin || '*'))
                    res.end(JSON.stringify({
                        ok: false,
                        error: `Invalid browser event payload. ${error.message}`,
                    }))
                }
            })
            return
        }

        if (req.method === 'POST' && requestUrl.pathname === '/bridge/browser-audio') {
            let body = ''
            req.on('data', (chunk) => { body += chunk })
            req.on('end', () => {
                try {
                    const auth = authorizeExtensionBridgeRequest(req, { allowBootstrap: true })
                    if (!auth.ok) {
                        noteIgnoredBrowserBridgeRequest()
                        res.writeHead(403, createBridgeCorsHeaders(requestOrigin || '*'))
                        res.end(JSON.stringify({
                            ok: false,
                            error: auth.reason,
                        }))
                        return
                    }
                    const payload = JSON.parse(body || '{}')
                    if (!isBrowserBridgeCaptureEnabled()) {
                        noteIgnoredBrowserBridgeRequest()
                        res.writeHead(200, createBridgeCorsHeaders(requestOrigin))
                        res.end(JSON.stringify({
                            ok: true,
                            ignored: true,
                            reason: 'browser-capture-disabled',
                        }))
                        return
                    }

                    const sanitizedTabs = (Array.isArray(payload.tabs) ? payload.tabs : [])
                        .map((tab) => sanitizeBrowserBridgePayload(tab, { audio: true }))
                        .filter(Boolean)

                    reconcileExtensionAudioSnapshot(sanitizedTabs, {
                        browserApp: payload.browserApp,
                    })
                    const firstAudibleTab = sanitizedTabs.find((tab) => Boolean(tab?.audible))
                    touchBrowserBridgeStatus({
                        lastAudioAt: Date.now(),
                        lastBrowserApp: String(payload.browserApp || browserBridgeStatus.lastBrowserApp || ''),
                        lastAudibleHost: firstAudibleTab?.host || browserBridgeStatus.lastAudibleHost,
                        lastExtensionVersion: String(payload.extensionVersion || browserBridgeStatus.lastExtensionVersion || ''),
                        audibleEvents: Number(browserBridgeStatus.audibleEvents || 0) + sanitizedTabs.length,
                    })
                    res.writeHead(200, createBridgeCorsHeaders(requestOrigin))
                    res.end(JSON.stringify({
                        ok: true,
                        audibleTabs: sanitizedTabs.length,
                    }))
                } catch (error) {
                    res.writeHead(400, createBridgeCorsHeaders(requestOrigin || '*'))
                    res.end(JSON.stringify({
                        ok: false,
                        error: `Invalid browser audio payload. ${error.message}`,
                    }))
                }
            })
            return
        }

        res.writeHead(404, {
            ...createBridgeCorsHeaders(requestOrigin || '*'),
        })
        res.end(JSON.stringify({ ok: false, error: 'Not found' }))
    })

    extensionBridgeServer.on('error', (error) => {
        const message = error?.code === 'EADDRINUSE'
            ? `Browser bridge port ${EXTENSION_BRIDGE_PORT} is already in use. Close the other Velance instance and reopen the app.`
            : (error?.message || String(error))
        browserBridgeStatus = {
            ...browserBridgeStatus,
            ready: false,
            connected: false,
            lastError: message,
        }
        writeRuntimeLog('extension.bridge.failed', {
            host: EXTENSION_BRIDGE_HOST,
            port: EXTENSION_BRIDGE_PORT,
            message,
        })
        extensionBridgeServer = null
        scheduleExtensionBridgeRetry(error?.code || 'listen-error')
    })

    extensionBridgeServer.listen(EXTENSION_BRIDGE_PORT, EXTENSION_BRIDGE_HOST, () => {
        clearExtensionBridgeRetry()
        browserBridgeStatus = {
            ...browserBridgeStatus,
            ready: true,
            connected: false,
            lastError: '',
        }
        writeRuntimeLog('extension.bridge.ready', {
            host: EXTENSION_BRIDGE_HOST,
            port: EXTENSION_BRIDGE_PORT,
        })
    })
}

function writeRuntimeLog(message, details = null) {
    try {
        const logPath = join(app.getPath('userData'), 'velance-debug.log')
        const suffix = details === null ? '' : ` ${JSON.stringify(details)}`
        appendFileSync(logPath, `[${new Date().toISOString()}] ${message}${suffix}\n`)
    } catch {
    }
    try {
        const workspaceLogPath = join(process.cwd(), 'velance-runtime-debug.log')
        const suffix = details === null ? '' : ` ${JSON.stringify(details)}`
        appendFileSync(workspaceLogPath, `[${new Date().toISOString()}] ${message}${suffix}\n`)
    } catch {
    }
}

function normalizeRuntimePolicy(settings = {}, userId = trackingUserId) {
    return {
        userId: userId || trackingUserId || 'local-user',
        trackingEnabled: resolveBooleanSetting(settings?.trackingEnabled, DEFAULT_RUNTIME_POLICY.trackingEnabled),
        keystrokeEnabled: resolveBooleanSetting(settings?.keystrokeEnabled, DEFAULT_RUNTIME_POLICY.keystrokeEnabled),
        mouseEnabled: resolveBooleanSetting(settings?.mouseEnabled, DEFAULT_RUNTIME_POLICY.mouseEnabled),
        notificationsEnabled: resolveBooleanSetting(settings?.notificationsEnabled, DEFAULT_RUNTIME_POLICY.notificationsEnabled),
        breakReminders: resolveBooleanSetting(settings?.breakReminders, DEFAULT_RUNTIME_POLICY.breakReminders),
        breakIntervalMinutes: Math.max(30, Number(settings?.breakIntervalMinutes || DEFAULT_RUNTIME_POLICY.breakIntervalMinutes)),
        dataRetentionDays: Math.max(1, Number(settings?.dataRetentionDays || DEFAULT_RUNTIME_POLICY.dataRetentionDays)),
        browserExtensionEnabled: resolveBooleanSetting(settings?.browserExtensionEnabled, DEFAULT_RUNTIME_POLICY.browserExtensionEnabled),
        browserCaptureHosts: resolveBooleanSetting(settings?.browserCaptureHosts, DEFAULT_RUNTIME_POLICY.browserCaptureHosts),
        browserCaptureTitles: resolveBooleanSetting(settings?.browserCaptureTitles, DEFAULT_RUNTIME_POLICY.browserCaptureTitles),
        browserCaptureAudioTitles: resolveBooleanSetting(settings?.browserCaptureAudioTitles, DEFAULT_RUNTIME_POLICY.browserCaptureAudioTitles),
        trackingConsentGranted: resolveBooleanSetting(settings?.trackingConsentGranted, DEFAULT_RUNTIME_POLICY.trackingConsentGranted),
    }
}

function canCollectTelemetry() {
    return Boolean(runtimePolicy.trackingEnabled && runtimePolicy.trackingConsentGranted)
}

function hasInputCaptureEnabled() {
    return Boolean(runtimePolicy.keystrokeEnabled || runtimePolicy.mouseEnabled)
}

function isBrowserBridgeCaptureEnabled() {
    return Boolean(canCollectTelemetry() && runtimePolicy.browserExtensionEnabled)
}

function getBrowserBridgeStatusSnapshot() {
    if (!extensionBridgeServer && isBrowserBridgeCaptureEnabled()) {
        startExtensionBridge()
    }
    const lastContactAt = Number(browserBridgeStatus.lastContactAt || 0)
    const connected = Boolean(browserBridgeStatus.ready && lastContactAt && (Date.now() - lastContactAt) <= EXTENSION_BRIDGE_STALE_MS)
    const captureEnabled = isBrowserBridgeCaptureEnabled()
    const captureHosts = Boolean(runtimePolicy.browserCaptureHosts)
    const captureTitles = Boolean(runtimePolicy.browserCaptureTitles)
    const captureAudioTitles = Boolean(runtimePolicy.browserCaptureAudioTitles)
    const captureMode = !captureEnabled
        ? 'paused'
        : captureHosts && !captureTitles && !captureAudioTitles
            ? 'host-only'
            : captureHosts && captureTitles && !captureAudioTitles
                ? 'standard'
                : captureHosts && captureTitles && captureAudioTitles
                    ? 'rich'
                    : 'custom'
    return {
        ...browserBridgeStatus,
        connected,
        host: EXTENSION_BRIDGE_HOST,
        port: EXTENSION_BRIDGE_PORT,
        captureEnabled,
        captureHosts,
        captureTitles,
        captureAudioTitles,
        captureMode: browserBridgeStatus.captureMode || captureMode,
        telemetryEnabled: Boolean(canCollectTelemetry()),
        authMode: browserBridgeStatus.authMode || 'extension-token',
        tokenIssuedAt: Number(browserBridgeStatus.tokenIssuedAt || 0),
        tokenValidatedAt: Number(browserBridgeStatus.tokenValidatedAt || 0),
    }
}

function touchBrowserBridgeStatus(details = {}) {
    browserBridgeStatus = {
        ...browserBridgeStatus,
        ready: true,
        lastContactAt: Date.now(),
        lastError: '',
        ...details,
    }
}

function noteIgnoredBrowserBridgeRequest() {
    browserBridgeStatus = {
        ...browserBridgeStatus,
        ignoredEvents: Number(browserBridgeStatus.ignoredEvents || 0) + 1,
        lastContactAt: Date.now(),
    }
}

function clearExtensionBridgeRetry() {
    if (!extensionBridgeRetryTimer) return
    clearTimeout(extensionBridgeRetryTimer)
    extensionBridgeRetryTimer = null
}

function scheduleExtensionBridgeRetry(reason = 'retry') {
    if (extensionBridgeRetryTimer || extensionBridgeServer || !isBrowserBridgeCaptureEnabled()) return

    extensionBridgeRetryTimer = setTimeout(() => {
        extensionBridgeRetryTimer = null
        if (!extensionBridgeServer && isBrowserBridgeCaptureEnabled()) {
            writeRuntimeLog('extension.bridge.retry', {
                reason,
                host: EXTENSION_BRIDGE_HOST,
                port: EXTENSION_BRIDGE_PORT,
            })
            startExtensionBridge()
        }
    }, EXTENSION_BRIDGE_RETRY_MS)
}

function sanitizeBrowserBridgePayload(payload = {}, { audio = false } = {}) {
    if (!isBrowserBridgeCaptureEnabled()) return null

    const sanitized = { ...payload }
    const allowHosts = Boolean(runtimePolicy.browserCaptureHosts)
    const allowTitles = Boolean(audio ? runtimePolicy.browserCaptureAudioTitles : runtimePolicy.browserCaptureTitles)

    if (!allowHosts) {
        sanitized.host = ''
        sanitized.url = ''
        if (audio) sanitized.artist = ''
        sanitized.mediaArtist = ''
    }

    if (!allowTitles) {
        sanitized.pageTitle = ''
        sanitized.title = ''
        if (audio) sanitized.trackTitle = ''
        sanitized.mediaTitle = ''
        sanitized.mediaAlbum = ''
    }

    return sanitized
}

function enforceBrowserBridgePrivacy() {
    if (!isBrowserBridgeCaptureEnabled()) {
        extensionBrowserContexts.clear()
        extensionAudioSessions.clear()
        browserBridgeStatus = {
            ...browserBridgeStatus,
            lastHost: '',
            lastTitle: '',
            lastAudibleHost: '',
        }
        return
    }

    for (const [key, context] of extensionBrowserContexts.entries()) {
        const sanitized = sanitizeBrowserBridgePayload(context)
        if (!sanitized) {
            extensionBrowserContexts.delete(key)
            continue
        }
        extensionBrowserContexts.set(key, {
            ...context,
            ...sanitized,
            contextTitle: buildBridgeContextTitle({
                ...context,
                ...sanitized,
            }),
        })
    }

    for (const session of extensionAudioSessions.values()) {
        if (!runtimePolicy.browserCaptureHosts) session.artist = ''
        if (!runtimePolicy.browserCaptureAudioTitles) session.trackTitle = ''
    }

    if (!runtimePolicy.browserCaptureHosts) {
        browserBridgeStatus.lastHost = ''
        browserBridgeStatus.lastAudibleHost = ''
    }
    if (!runtimePolicy.browserCaptureTitles) {
        browserBridgeStatus.lastTitle = ''
    }
}

// Ambient state — aggregate consecutive same-app entries
let _ambientLastSignature = null
let _ambientLastApp = null
let _ambientDuration = 0
let _ambientTitle = ''
let _ambientUrl = ''
let _ambientSwitchCount = 0     // tracks window switches since last flush
let _ambientStartTs = 0

// Pulse state — running productive/unproductive tallies
let _pulseProductive = 0        // seconds
let _pulseUnproductive = 0
let _pulseNeutral = 0
let _pulseLastApp = null        // last app for classification result

// Media state - aggregate same-track playback without polluting foreground totals
let _mediaLastSignature = null
let _mediaDuration = 0
let _mediaPayload = null
let _mediaStartTs = 0

const WINDOWS_MEDIA_SESSION_SCRIPT = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$request = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]::RequestAsync()
$generic = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
$managerTask = $generic.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null, @($request))
$manager = $managerTask.GetAwaiter().GetResult()
if ($null -eq $manager) { '{}' | Write-Output; exit 0 }
$session = $manager.GetCurrentSession()
if ($null -eq $session) { '{}' | Write-Output; exit 0 }
$playback = $session.GetPlaybackInfo()
$status = [string]$playback.PlaybackStatus
if ($status -ne 'Playing') { '{}' | Write-Output; exit 0 }
$propsRequest = $session.TryGetMediaPropertiesAsync()
$propsTask = $generic.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]).Invoke($null, @($propsRequest))
$props = $propsTask.GetAwaiter().GetResult()
[ordered]@{
  sourceApp = [string]$session.SourceAppUserModelId
  trackTitle = [string]$props.Title
  artist = [string]$props.Artist
  album = [string]$props.AlbumTitle
  playbackState = $status
} | ConvertTo-Json -Compress
`

// Lazy-load native modules
async function loadNativeModules() {
    writeRuntimeLog('native.load.begin', {
        cwd: process.cwd(),
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
    })
    try {
        const { default: activeWin } = await import('active-win')
        activeWinModule = activeWin
        writeRuntimeLog('native.active-win.loaded')
    } catch (e) {
        console.warn('[Velance] active-win not available:', e.message)
        writeRuntimeLog('native.active-win.failed', { message: e.message })
    }
    try {
        const { uIOhook, UiohookKey } = await import('uiohook-napi')
        uiohookModule = { uIOhook, UiohookKey }
        writeRuntimeLog('native.uiohook.loaded')
    } catch (e) {
        console.warn('[Velance] uiohook-napi not available:', e.message)
        writeRuntimeLog('native.uiohook.failed', { message: e.message })
    }
}

process.env.DIST = join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : join(process.env.DIST, '../public')

function persistAmbientChunk({ ts, endTs, app, title, url, duration, switches }) {
    if (!dataRepo || !trackingUserId || !app || duration <= 0) return

    const customRules = dataRepo?.getCustomRules?.(trackingUserId) || {}
    const normalizedEntry = normalizeAmbientEntryPayload({
        ts,
        endTs,
        app,
        title,
        browserUrl: url || '',
        duration,
        switches,
    }, { customRules })

    if (isInternalTrackingActivity(normalizedEntry)) {
        return null
    }

    try {
        dataRepo.upsertAmbientEntry(trackingUserId, normalizedEntry)
        const lane = normalizedEntry.lane || getLaneFromProductive(normalizedEntry.productive)
        if (lane === 'productive') _pulseProductive += normalizedEntry.duration
        else if (lane === 'distracting') _pulseUnproductive += normalizedEntry.duration
        else _pulseNeutral += normalizedEntry.duration
        writeRuntimeLog('ambient.chunk.persisted', {
            userId: trackingUserId,
            app: normalizedEntry.appGroup || normalizedEntry.app,
            duration: normalizedEntry.duration,
            dateKey: normalizedEntry.date,
            lane,
        })
        return normalizedEntry
    } catch (error) {
        console.warn('[Velance] Failed to persist raw ambient chunk:', error.message)
        writeRuntimeLog('ambient.chunk.persist.failed', {
            userId: trackingUserId,
            app: normalizedEntry.appGroup || normalizedEntry.app,
            message: error?.message || String(error),
        })
        return null
    }
}

function queryWindowsMediaSession() {
    if (process.platform !== 'win32' || mediaTrackingUnsupported) {
        return Promise.resolve(null)
    }

    return new Promise((resolve) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_MEDIA_SESSION_SCRIPT],
            { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 32 },
            (error, stdout = '') => {
                if (error) {
                    const message = error?.message || String(error)
                    if (/service does not exist|WindowsRuntimeSystemExtensions|GetResult/i.test(message)) {
                        mediaTrackingUnsupported = true
                        writeRuntimeLog('media.collector.unavailable', { message })
                    } else {
                        writeRuntimeLog('media.collector.failed', { message })
                    }
                    resolve(null)
                    return
                }

                try {
                    const parsed = JSON.parse(String(stdout || '').trim() || '{}')
                    if (!parsed || typeof parsed !== 'object' || !parsed.sourceApp) {
                        resolve(null)
                        return
                    }
                    resolve(parsed)
                } catch (parseError) {
                    writeRuntimeLog('media.collector.parse.failed', { message: parseError?.message || String(parseError) })
                    resolve(null)
                }
            },
        )
    })
}

function persistMediaChunk({ ts, endTs, sourceApp, trackTitle, artist, album, playbackState, duration }) {
    if (!dataRepo || !trackingUserId || !sourceApp || duration <= 0) return null

    try {
        const entry = {
            ts,
            endTs,
            sourceApp,
            trackTitle,
            artist,
            album,
            playbackState,
            duration,
        }
        const persisted = dataRepo.upsertMediaEntry(trackingUserId, entry)
        const normalizedEntry = Array.isArray(persisted) ? persisted[persisted.length - 1] : entry
        writeRuntimeLog('media.chunk.persisted', {
            userId: trackingUserId,
            sourceApp,
            duration,
            state: playbackState,
        })
        return normalizedEntry
    } catch (error) {
        writeRuntimeLog('media.chunk.persist.failed', {
            userId: trackingUserId,
            sourceApp,
            message: error?.message || String(error),
        })
        return null
    }
}

function persistBrowserEvent(entry = {}) {
    if (!dataRepo || !trackingUserId) return null

    try {
        const persisted = dataRepo.upsertBrowserEvent(trackingUserId, entry)
        const normalizedEntry = Array.isArray(persisted) ? persisted[persisted.length - 1] : entry
        writeRuntimeLog('extension.browser_event.persisted', {
            userId: trackingUserId,
            app: normalizedEntry?.browserApp || entry?.browserApp || null,
            eventType: normalizedEntry?.eventType || entry?.eventType || 'event',
            host: normalizedEntry?.host || entry?.host || '',
            active: Boolean(normalizedEntry?.active ?? entry?.active),
            audible: Boolean(normalizedEntry?.audible ?? entry?.audible),
        })
        return normalizedEntry
    } catch (error) {
        writeRuntimeLog('extension.browser_event.persist.failed', {
            userId: trackingUserId,
            app: entry?.browserApp || null,
            eventType: entry?.eventType || 'event',
            message: error?.message || String(error),
        })
        return null
    }
}

function stopNativeTracking() {
    if (trackingInterval) {
        clearInterval(trackingInterval)
        trackingInterval = null
    }
    try {
        if (uiohookModule?.uIOhook) {
            uiohookModule.uIOhook.stop()
            uiohookModule.uIOhook.removeAllListeners()
        }
    } catch (error) {
        writeRuntimeLog('tracking.stop.native.failed', { message: error?.message || String(error) })
    }
}

function flushAmbientBuffer() {
    if (!_ambientLastApp || _ambientDuration <= 0) return
    const persistedEntry = persistAmbientChunk({
        ts: _ambientStartTs || (Date.now() - _ambientDuration * 1000),
        endTs: Date.now(),
        app: _ambientLastApp,
        title: _ambientTitle,
        url: _ambientUrl,
        duration: _ambientDuration,
        switches: _ambientSwitchCount,
    })
    if (persistedEntry && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('velance:ambient-data', persistedEntry)
    }
    _ambientDuration = 0
    _ambientSwitchCount = 0
    _ambientStartTs = Date.now()
}

function flushMediaBuffer() {
    if (!_mediaPayload?.sourceApp || _mediaDuration <= 0) return
    const persistedEntry = persistMediaChunk({
        ts: _mediaStartTs || (Date.now() - (_mediaDuration * 1000)),
        endTs: Date.now(),
        sourceApp: _mediaPayload.sourceApp,
        trackTitle: _mediaPayload.trackTitle,
        artist: _mediaPayload.artist,
        album: _mediaPayload.album,
        playbackState: _mediaPayload.playbackState,
        duration: _mediaDuration,
    })
    if (persistedEntry && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('velance:media-data', persistedEntry)
    }
    _mediaDuration = 0
    _mediaStartTs = Date.now()
}

function resetAmbientState() {
    _ambientLastSignature = null
    _ambientLastApp = null
    _ambientDuration = 0
    _ambientTitle = ''
    _ambientUrl = ''
    _ambientSwitchCount = 0
    _ambientStartTs = 0
    _pulseProductive = 0
    _pulseUnproductive = 0
    _pulseNeutral = 0
    _pulseLastApp = null
    _mediaLastSignature = null
    _mediaDuration = 0
    _mediaPayload = null
    _mediaStartTs = 0
}

function stopAmbientTracking({ flush = false } = {}) {
    if (flush) {
        flushAmbientBuffer()
        flushMediaBuffer()
    }
    if (ambientInterval) { clearInterval(ambientInterval); ambientInterval = null }
    if (mediaInterval) { clearInterval(mediaInterval); mediaInterval = null }
    if (pulseInterval) { clearInterval(pulseInterval); pulseInterval = null }
    resetAmbientState()
}

function applyPersistedRuntimePolicyForUser(userId = trackingUserId) {
    const safeUserId = userId || 'local-user'

    try {
        const settings = dataRepo?.getBootstrap?.(safeUserId)?.settings
        if (!settings) return runtimePolicy
        return applyRuntimePolicy({ userId: safeUserId, settings })
    } catch (error) {
        writeRuntimeLog('runtime.policy.restore.failed', {
            userId: safeUserId,
            message: error?.message || String(error),
        })
        return runtimePolicy
    }
}

function applyRuntimePolicy(policy) {
    runtimePolicy = normalizeRuntimePolicy(policy?.settings || policy, policy?.userId || trackingUserId)
    trackingUserId = runtimePolicy.userId
    enforceBrowserBridgePrivacy()
    writeRuntimeLog('runtime.policy.applied', runtimePolicy)

    if (isBrowserBridgeCaptureEnabled()) {
        if (!extensionBridgeServer) startExtensionBridge()
        else clearExtensionBridgeRetry()
    } else {
        clearExtensionBridgeRetry()
    }

    if (!canCollectTelemetry()) {
        stopAmbientTracking({ flush: true })
        stopNativeTracking()
        return runtimePolicy
    }

    if (!ambientInterval) {
        startAmbientTracking()
    }

    return runtimePolicy
}

function isTrustedAppUrl(targetUrl) {
    if (!targetUrl) return false
    if (targetUrl.startsWith('file://')) return true

    if (process.env.VITE_DEV_SERVER_URL) {
        try {
            const trustedOrigin = new URL(process.env.VITE_DEV_SERVER_URL).origin
            return new URL(targetUrl).origin === trustedOrigin
        } catch {
            return false
        }
    }

    return false
}

function createWindow() {
    const browserWindowOptions = {
        width: 1280,
        height: 840,
        minWidth: 1000,
        minHeight: 680,
        frame: process.platform === 'darwin',  // macOS keeps native traffic lights; Windows uses custom title bar
        icon: join(process.env.DIST, 'logo.png'),
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: true,
        }
    }

    if (process.platform === 'darwin') {
        browserWindowOptions.titleBarStyle = 'hiddenInset'
    }

    mainWindow = new BrowserWindow(browserWindowOptions)

    // Notify renderer when the window is maximized/restored so the custom title bar icon updates
    mainWindow.on('maximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('velance:window:maximize-change', true)
        }
    })
    mainWindow.on('unmaximize', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('velance:window:maximize-change', false)
        }
    })

    mainWindow.webContents.on('did-finish-load', async () => {
        try {
            const bridgeState = await mainWindow.webContents.executeJavaScript(`({
                hasVelance: Boolean(window.velance),
                hasStartTracking: Boolean(window.velance?.startTracking),
                hasDataBridge: Boolean(window.velance?.data)
            })`)
            writeRuntimeLog('renderer.bridge.state', bridgeState)
        } catch (error) {
            writeRuntimeLog('renderer.bridge.state.failed', { message: error.message })
        }
    })

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) {
            void shell.openExternal(url)
        }
        return { action: 'deny' }
    })

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (isTrustedAppUrl(url)) return
        event.preventDefault()
        if (/^https?:/i.test(url)) {
            void shell.openExternal(url)
        }
    })

    mainWindow.webContents.on('will-attach-webview', (event) => {
        event.preventDefault()
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
        mainWindow.loadFile(join(process.env.DIST, 'index.html'))
    }
}

// ── IPC: Focus Session Tracking Engine ────────────────────────
ipcMain.on('velance:start-tracking', async () => {
    if (!mainWindow) return
    if (!canCollectTelemetry()) {
        writeRuntimeLog('tracking.start.blocked', runtimePolicy)
        return
    }
    const hasInputHook = Boolean(uiohookModule?.uIOhook) && hasInputCaptureEnabled()
    const uIOhook = uiohookModule?.uIOhook
    writeRuntimeLog('tracking.start.requested', {
        hasInputHook,
        hasWindowHook: Boolean(activeWinModule),
        runtimePolicy,
    })

    // ── Clean up any existing tracking before starting fresh ──
    if (trackingInterval) { clearInterval(trackingInterval); trackingInterval = null }
    if (hasInputHook) {
        try { uIOhook.stop(); uIOhook.removeAllListeners() } catch (e) { }
    }

    let lastMouseX = 0, lastMouseY = 0
    let keystrokeCount = 0
    let mouseDistance = 0
    let mouseClicks = 0
    let scrollDelta = 0
    let lastActivity = Date.now()

    // Window switch tracking
    let lastActiveSignature = null
    let lastActiveWindow = null
    let windowSwitchCount = 0
    let windowSwitchLog = []  // { ts, from, to, durationMs }
    let lastSwitchTs = Date.now()

    if (hasInputHook) {
        // Forward keystrokes to renderer
        uIOhook.on('keydown', () => {
            if (!runtimePolicy.keystrokeEnabled) return
            keystrokeCount++
            lastActivity = Date.now()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('velance:keystroke', { ts: Date.now() })
            }
        })

        // Mouse movement
        uIOhook.on('mousemove', (e) => {
            if (!runtimePolicy.mouseEnabled) return
            if (lastMouseX === 0 && lastMouseY === 0) {
                lastMouseX = e.x
                lastMouseY = e.y
                lastActivity = Date.now()
                return
            }
            const dx = e.x - lastMouseX
            const dy = e.y - lastMouseY
            mouseDistance += Math.sqrt(dx * dx + dy * dy)
            lastMouseX = e.x
            lastMouseY = e.y
            lastActivity = Date.now()
        })

        // Mouse clicks
        uIOhook.on('mousedown', () => {
            if (!runtimePolicy.mouseEnabled) return
            mouseClicks++
            lastActivity = Date.now()
        })

        // Scroll
        uIOhook.on('wheel', (e) => {
            if (!runtimePolicy.mouseEnabled) return
            scrollDelta += Math.abs(e.rotation || 0)
            lastActivity = Date.now()
        })

        try {
            uIOhook.start()
        } catch (error) {
            console.warn('[Velance] Failed to start input hook:', error.message)
        }
    }

    const emitTrackingSample = async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return

        // Active window
        let activeWindowInfo = { app: 'Unknown', title: '', url: '' }
        if (activeWinModule) {
            try {
                const win = await activeWinModule()
                if (win) {
                    activeWindowInfo = {
                        app: win.owner?.name || 'Unknown',
                        title: win.title || '',
                        url: win.url || ''
                    }
                }
            } catch (e) { }
        }

        // Detect app or window-context switch
        const switchedApps = []
        const currentSignature = `${activeWindowInfo.app}::${activeWindowInfo.title}::${activeWindowInfo.url || ''}`
        if (lastActiveSignature !== null && lastActiveSignature !== currentSignature) {
            const switchEvent = {
                ts: Date.now(),
                from: lastActiveWindow?.app || 'Unknown',
                fromTitle: lastActiveWindow?.title || '',
                fromUrl: lastActiveWindow?.url || '',
                to: activeWindowInfo.app,
                toTitle: activeWindowInfo.title,
                toUrl: activeWindowInfo.url || '',
                durationMs: Date.now() - lastSwitchTs
            }
            windowSwitchLog.push(switchEvent)
            switchedApps.push(switchEvent)
            windowSwitchCount++
            lastSwitchTs = Date.now()
        }
        lastActiveSignature = currentSignature
        lastActiveWindow = activeWindowInfo

        const idleMs = Date.now() - lastActivity
        const idle = hasInputHook && hasInputCaptureEnabled() ? idleMs > 15000 : false

        const currentMouseClicks = mouseClicks
        const currentScrollDelta = scrollDelta
        const currentWindowSwitches = windowSwitchCount

        mainWindow.webContents.send('velance:tracking-data', {
            ts: Date.now(),
            keystrokesInWindow: keystrokeCount,
            mouseDistanceInWindow: Math.round(mouseDistance),
            mouseClicks: currentMouseClicks,
            scrollDelta: Math.round(currentScrollDelta),
            windowSwitches: currentWindowSwitches,
            windowSwitchLog: [...windowSwitchLog],
            activeApp: activeWindowInfo.app,
            activeTitle: activeWindowInfo.title,
            activeUrl: activeWindowInfo.url || '',
            idleMs,
            isIdle: idle,
            inputHookAvailable: hasInputHook && hasInputCaptureEnabled(),
            windowHookAvailable: Boolean(activeWinModule),
        })
        writeRuntimeLog('tracking.sample.emitted', {
            activeApp: activeWindowInfo.app,
            activeTitle: activeWindowInfo.title,
            keystrokesInWindow: keystrokeCount,
            mouseDistanceInWindow: Math.round(mouseDistance),
            mouseClicks: currentMouseClicks,
            scrollDelta: Math.round(currentScrollDelta),
            windowSwitches: currentWindowSwitches,
            inputHookAvailable: hasInputHook && hasInputCaptureEnabled(),
            windowHookAvailable: Boolean(activeWinModule),
        })

        // Reset window counters
        keystrokeCount = 0
        mouseDistance = 0
        mouseClicks = 0
        scrollDelta = 0
        // Don't reset windowSwitchCount or windowSwitchLog — they accumulate for the session
    }

    void emitTrackingSample()

    // Batch-send metrics every 2 seconds
    trackingInterval = setInterval(() => {
        void emitTrackingSample()
    }, 2000)
})

ipcMain.on('velance:stop-tracking', () => {
    writeRuntimeLog('tracking.stop.requested')
    stopNativeTracking()
})

// ── Ambient 24/7 Background Tracking ─────────────────────────
function startAmbientTracking() {
    if (!canCollectTelemetry()) { stopAmbientTracking(); return }
    if (!activeWinModule) { console.warn('[Velance] active-win not loaded, ambient tracking disabled'); return }
    if (ambientInterval) clearInterval(ambientInterval)
    if (mediaInterval) clearInterval(mediaInterval)

    const flush = (appName, title, url, duration, switches, startTs, endTs = Date.now()) => {
        if (!mainWindow || mainWindow.isDestroyed() || !appName || duration <= 0) return
        const persistedEntry = persistAmbientChunk({
            ts: startTs || (endTs - duration * 1000),
            endTs,
            app: appName,
            title,
            url: url || '',
            duration,
            switches,
        })
        if (persistedEntry) {
            mainWindow.webContents.send('velance:ambient-data', persistedEntry)
        }
    }

    // Track last window signature for switch detection
    let _prevSignature = null

    ambientInterval = setInterval(async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        try {
            const win = await activeWinModule()
            const appName = win?.owner?.name || 'Unknown'
            const browserContext = getFreshExtensionBrowserContext(appName)
            const title = browserContext?.contextTitle || browserContext?.pageTitle || win?.title || ''
            const url = browserContext?.url || win?.url || ''

            // Count switches
            const signature = `${appName}::${title}::${url}`
            if (_prevSignature !== null && _prevSignature !== signature) {
                _ambientSwitchCount++
            }
            _prevSignature = signature

            if (_ambientLastSignature === signature) {
                _ambientDuration += 5
            } else {
                // App switched — flush previous chunk
                if (_ambientLastApp && _ambientDuration > 0) flush(_ambientLastApp, _ambientTitle, _ambientUrl, _ambientDuration, _ambientSwitchCount, _ambientStartTs, Date.now())
                _ambientLastSignature = signature
                _ambientLastApp = appName
                _ambientTitle = title
                _ambientUrl = url
                _ambientDuration = 5
                _ambientStartTs = Date.now() - 5000
                _ambientSwitchCount = 0
            }

            // Flush every 10s so Screen Time feels live and less data is lost on abrupt exits.
            if (_ambientDuration > 0 && _ambientDuration % 10 === 0) {
                flush(_ambientLastApp, _ambientTitle, _ambientUrl, _ambientDuration, _ambientSwitchCount, _ambientStartTs, Date.now())
                _ambientDuration = 0
                _ambientSwitchCount = 0
                _ambientStartTs = Date.now()
            }
        } catch (e) { }
    }, 5000)

    // Productivity Pulse — broadcast every 30s
    if (pulseInterval) clearInterval(pulseInterval)
    pulseInterval = setInterval(async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        try {
            const win = await activeWinModule()
            const appName = win?.owner?.name || 'Unknown'
            const title = win?.title || ''
            const url = win?.url || ''

            // Simple productive/unproductive/neutral tick (5s since last pulse sub-interval)
            // Renderer-side classification is more detailed; here we just accumulate raw time
            mainWindow.webContents.send('velance:productivity-pulse', {
                ts: Date.now(),
                app: appName,
                title,
                url,
                productive: _pulseProductive,
                unproductive: _pulseUnproductive,
                neutral: _pulseNeutral
            })

            // Reset pulse counters after broadcast
            _pulseProductive = 0
            _pulseUnproductive = 0
            _pulseNeutral = 0
        } catch (e) { }
    }, 30000)

    if (process.platform === 'win32' && !mediaTrackingUnsupported) {
        mediaInterval = setInterval(async () => {
            if (!mainWindow || mainWindow.isDestroyed()) return
            const media = await queryWindowsMediaSession()

            if (!media?.sourceApp) {
                if (_mediaDuration > 0) {
                    flushMediaBuffer()
                }
                _mediaLastSignature = null
                _mediaPayload = null
                _mediaDuration = 0
                _mediaStartTs = 0
                return
            }

            const signature = `${media.sourceApp}::${media.trackTitle || ''}::${media.artist || ''}::${media.album || ''}::${media.playbackState || ''}`
            if (_mediaLastSignature === signature) {
                _mediaDuration += 15
            } else {
                if (_mediaDuration > 0) {
                    flushMediaBuffer()
                }
                _mediaLastSignature = signature
                _mediaPayload = media
                _mediaDuration = 15
                _mediaStartTs = Date.now() - 15000
            }

            if (_mediaDuration > 0 && _mediaDuration % 30 === 0) {
                flushMediaBuffer()
                _mediaDuration = 0
                _mediaStartTs = Date.now()
            }
        }, 15000)
    }
}

// Flush buffered chunk before renderer unloads
ipcMain.on('velance:flush-ambient', () => {
    flushAmbientBuffer()
})

ipcMain.on('velance:notify', (_, { title, body }) => {
    if (runtimePolicy.notificationsEnabled && Notification.isSupported()) {
        new Notification({ title, body }).show()
    }
})

ipcMain.on('velance:window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize()
    }
})

ipcMain.on('velance:window:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize()
        } else {
            mainWindow.maximize()
        }
    }
})

ipcMain.on('velance:window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close()
    }
})

ipcMain.on('velance:tracking:set-user', (_, userId) => {
    const nextUserId = userId || 'local-user'
    const previousUserId = trackingUserId

    if (previousUserId !== nextUserId) {
        flushAmbientBuffer()
        stopNativeTracking()
    }

    trackingUserId = nextUserId
    writeRuntimeLog('tracking.user.changed', { from: previousUserId, to: nextUserId })
    applyPersistedRuntimePolicyForUser(nextUserId)
})

ipcMain.handle('velance:runtime:apply-policy', (_, policy) => {
    return applyRuntimePolicy(policy)
})

ipcMain.handle('velance:runtime:browser-bridge-status', () => {
    return getBrowserBridgeStatusSnapshot()
})

// ── BYOK AI API (routed through main to avoid CORS) ──

const CLASSIFICATION_BROWSER_APPS = new Set([
    'browser',
    'google chrome',
    'microsoft edge',
    'mozilla firefox',
    'firefox',
    'chrome',
    'edge',
    'brave',
    'opera',
    'arc',
    'safari',
    'vivaldi',
    'chromium',
    'unknown',
])

function normalizeClassificationText(value = '', maxLength = 120) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
}

function normalizeRuleMatchText(value = '') {
    return normalizeClassificationText(value, 160).toLowerCase()
}

function deriveCandidateRuleKey({ appName = '', host = '', title = '' } = {}) {
    const normalizedHost = normalizeRuleMatchText(host).replace(/^www\./, '')
    if (normalizedHost && !['google.com', 'bing.com', 'duckduckgo.com'].includes(normalizedHost)) {
        return normalizedHost
    }

    const normalizedApp = normalizeRuleMatchText(normalizeObservedAppName(appName))
    if (normalizedApp && !CLASSIFICATION_BROWSER_APPS.has(normalizedApp)) {
        return normalizedApp
    }

    const trimmedTitle = normalizeRuleMatchText(trimBrowserTitle(title))
    if (trimmedTitle.length >= 4) return trimmedTitle
    return ''
}

function shouldResolveAmbiguousCandidate({ lane = 'unclear', confidence = 0, label = '' } = {}) {
    const normalizedLane = String(lane || '').trim().toLowerCase()
    const normalizedLabel = normalizeRuleMatchText(label)
    if (!normalizedLabel || normalizedLabel.length < 3) return false
    if (['home', 'homepage', 'search', 'results', 'new tab'].includes(normalizedLabel)) return false
    return normalizedLane === 'unclear' || Number(confidence || 0) < 0.62
}

function buildClassificationEdgeCaseCandidates({
    ambientEntries = [],
    browserEvents = [],
    customRules = {},
} = {}) {
    const candidates = new Map()
    const hasRule = (matchText = '') => {
        const normalized = normalizeRuleMatchText(matchText)
        if (!normalized) return false
        return Boolean(customRules?.[normalized])
    }

    const upsertCandidate = ({
        source = 'ambient',
        appName = '',
        host = '',
        title = '',
        url = '',
        lane = 'unclear',
        category = 'Other',
        confidence = 0,
        weight = 0,
    } = {}) => {
        const matchText = deriveCandidateRuleKey({ appName, host, title })
        if (!matchText || hasRule(matchText)) return
        const label = normalizeClassificationText(title || host || appName, 140)
        if (!shouldResolveAmbiguousCandidate({ lane, confidence, label })) return

        const existing = candidates.get(matchText)
        const nextWeight = Math.max(1, Number(weight || 0))
        if (!existing) {
            candidates.set(matchText, {
                id: `classification-edge-${candidates.size + 1}`,
                matchText,
                source,
                appName: normalizeClassificationText(appName, 80),
                host: normalizeClassificationText(host, 120),
                title: normalizeClassificationText(title, 160),
                url: normalizeClassificationText(url, 220),
                currentLane: String(lane || 'unclear'),
                currentCategory: normalizeClassificationText(category, 60) || 'Other',
                maxConfidence: Number(confidence || 0),
                weight: nextWeight,
                samples: 1,
            })
            return
        }

        existing.weight += nextWeight
        existing.samples += 1
        existing.maxConfidence = Math.max(existing.maxConfidence, Number(confidence || 0))
        if (!existing.host && host) existing.host = normalizeClassificationText(host, 120)
        if (!existing.title && title) existing.title = normalizeClassificationText(title, 160)
        if (!existing.appName && appName) existing.appName = normalizeClassificationText(appName, 80)
        if (!existing.url && url) existing.url = normalizeClassificationText(url, 220)
    }

    ambientEntries.forEach((entry) => {
        if (isInternalTrackingActivity(entry)) return
        upsertCandidate({
            source: 'ambient',
            appName: entry?.appGroup || entry?.app || '',
            host: entry?.browserHost || '',
            title: entry?.browserPage || entry?.contextLabel || entry?.title || '',
            url: entry?.browserUrl || '',
            lane: entry?.lane || 'unclear',
            category: entry?.category || 'Other',
            confidence: entry?.confidence || 0,
            weight: Math.max(1, Number(entry?.duration || 0)),
        })
    })

    browserEvents.forEach((entry) => {
        upsertCandidate({
            source: 'browser',
            appName: entry?.browserApp || '',
            host: entry?.host || '',
            title: entry?.contextLabel || entry?.pageTitle || '',
            url: entry?.url || '',
            lane: entry?.lane || 'unclear',
            category: entry?.category || 'Browser',
            confidence: entry?.confidence || 0,
            weight: 30,
        })
    })

    return [...candidates.values()]
        .sort((left, right) => right.weight - left.weight || left.matchText.localeCompare(right.matchText))
        .slice(0, 16)
}

function buildClassificationCleanupPrompt(candidates = []) {
    const candidateLines = candidates.map((candidate) => (
        `- id: ${candidate.id}
  matchText: ${candidate.matchText}
  source: ${candidate.source}
  app: ${candidate.appName || 'Unknown'}
  host: ${candidate.host || 'None'}
  title: ${candidate.title || 'None'}
  url: ${candidate.url || 'None'}
  currentLane: ${candidate.currentLane}
  currentCategory: ${candidate.currentCategory}
  currentConfidence: ${candidate.maxConfidence}
  evidenceWeight: ${candidate.weight}
  samples: ${candidate.samples}`
    )).join('\n')

    return `You are the classification cleanup engine for Velance, a productivity tracking app.

Classify each ambiguous context into one of exactly four lanes:
- productive: primary work creation/execution
- supporting: research, planning, communication, AI assistance, reference material
- unclear: only when there truly is not enough evidence
- distracting: entertainment, social, shopping, obvious off-task browsing

Important rules:
1. Prefer productive or supporting when the context clearly looks like real work.
2. Do not classify generic browser shells. Classify the actual app/page context.
3. "Codex", "ChatGPT", "Claude", docs, slide decks, presentations, design work, planning, and research should usually not be "unclear".
4. Return ONLY a valid JSON array.
5. Use only these keys per item: id, category, subcategory, lane, productive, confidence.

Candidates:
${candidateLines}

Return JSON like:
[
  {
    "id": "classification-edge-1",
    "category": "AI Tools",
    "subcategory": "AI Assistant",
    "lane": "supporting",
    "productive": true,
    "confidence": 0.93
  }
]`
}

function parseClassificationCleanupResponse(text = '') {
    const match = String(text || '').match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON found in classification cleanup response')
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error('Classification cleanup response was not an array')
    return parsed
}

async function resolveClassificationEdgeCases({
    settings = {},
    customRules = {},
    ambientEntries = [],
    browserEvents = [],
} = {}) {
    try {
        const aiSettings = normalizeAiSettings(settings)
        if (!aiSettings.hasKey) return { rules: [] }

        const candidates = buildClassificationEdgeCaseCandidates({
            ambientEntries,
            browserEvents,
            customRules,
        })
        if (!candidates.length) return { rules: [] }

        const candidateMap = new Map(candidates.map((candidate) => [candidate.id, candidate]))
        const text = await requestAiText(buildClassificationCleanupPrompt(candidates), aiSettings, {
            temperature: 0.15,
            maxOutputTokens: 900,
            responseMimeType: 'application/json',
        })
        const parsed = parseClassificationCleanupResponse(text)

        const rules = []
        for (const item of parsed) {
            const candidate = candidateMap.get(String(item?.id || ''))
            if (!candidate) continue
            const lane = String(item?.lane || '').trim().toLowerCase()
            if (!TRACKING_LANE_KEYS.includes(lane) || lane === 'unclear') continue
            const confidence = Math.max(0, Number(item?.confidence || 0))
            if (confidence < 0.72) continue

            const category = normalizeClassificationText(item?.category, 60) || 'Other'
            const subcategory = normalizeClassificationText(item?.subcategory, 80)
            const productive = lane === 'distracting'
                ? false
                : (item?.productive === null || item?.productive === undefined ? true : Boolean(item.productive))

            rules.push({
                matchText: candidate.matchText,
                category,
                subcategory,
                color: CATEGORY_COLORS[category] || CATEGORY_COLORS.Other,
                productive,
                lane,
            })
        }

        return {
            rules: [...new Map(rules.map((rule) => [rule.matchText, rule])).values()],
        }
    } catch (error) {
        writeRuntimeLog('classification.cleanup.failed', {
            message: error?.message || String(error),
        })
        return { rules: [] }
    }
}

const ALLOWED_INSIGHT_CATEGORIES = new Set(['performance', 'health', 'timing', 'warning', 'milestone', 'habit'])

function sanitizeInsightCategory(value = 'performance') {
    const category = String(value || '').trim().toLowerCase()
    return ALLOWED_INSIGHT_CATEGORIES.has(category) ? category : 'performance'
}

function sanitizeShortText(value = '', maxLength = 240) {
    return String(value || '')
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
        .replace(/\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}|[A-Za-z0-9_-]{32,})\b/g, '[redacted-token]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
}

function sanitizeInsightContext(context = {}) {
    const trend = context?.trend || {}
    const taskSummary = context?.taskSummary || {}
    const dataQuality = context?.dataQuality || {}
    const sessionMix = context?.sessionMix || {}
    const ambientSummary = context?.ambientSummary || {}
    return {
        period: String(context?.period || '7 days'),
        sessions: Math.max(0, Number(context?.sessions || 0)),
        avgFocusScore: Math.max(0, Number(context?.avgFocusScore || 0)),
        totalFocusMinutes: Math.max(0, Number(context?.totalFocusMinutes || 0)),
        distractionEvents: Math.max(0, Number(context?.distractionEvents || 0)),
        peakFocusHour: context?.peakFocusHour === null || context?.peakFocusHour === undefined ? null : Number(context.peakFocusHour),
        peakFocusScore: context?.peakFocusScore === null || context?.peakFocusScore === undefined ? null : Number(context.peakFocusScore),
        topApps: Array.isArray(context?.topApps) ? context.topApps.slice(0, 5).map((entry) => String(entry).slice(0, 120)) : [],
        appBreakdown: Array.isArray(context?.appBreakdown)
            ? context.appBreakdown.slice(0, 6).map((app) => ({
                app: sanitizeShortText(app?.app || 'Tracked app', 80),
                minutes: Math.max(0, Number(app?.minutes || 0)),
            }))
            : [],
        habits: Array.isArray(context?.habits)
            ? context.habits.slice(0, 8).map((habit) => ({
                name: sanitizeShortText(habit?.name || 'Habit', 80),
                sessions: Math.max(0, Number(habit?.sessions || 0)),
                avgFocus: Math.max(0, Number(habit?.avgFocus || 0)),
                streak: Math.max(0, Number(habit?.streak || 0)),
                totalMinutes: Math.max(0, Number(habit?.totalMinutes || 0)),
            }))
            : [],
        tasks: Array.isArray(context?.tasks)
            ? context.tasks.slice(0, 6).map((task) => ({
                title: sanitizeShortText(task?.title || 'Task', 100),
                sessions: Math.max(0, Number(task?.sessions || 0)),
                avgFocus: Math.max(0, Number(task?.avgFocus || 0)),
                totalMinutes: Math.max(0, Number(task?.totalMinutes || 0)),
            }))
            : [],
        taskSummary: {
            total: Math.max(0, Number(taskSummary.total || 0)),
            open: Math.max(0, Number(taskSummary.open || 0)),
            completed: Math.max(0, Number(taskSummary.completed || 0)),
            dueToday: Math.max(0, Number(taskSummary.dueToday || 0)),
            overdue: Math.max(0, Number(taskSummary.overdue || 0)),
            highPriorityOpen: Math.max(0, Number(taskSummary.highPriorityOpen || 0)),
        },
        fatigueHighDays: Math.max(0, Number(context?.fatigueHighDays || 0)),
        currentFatigue: String(context?.currentFatigue || 'Low'),
        fatigueTrend: Array.isArray(context?.fatigueTrend) ? context.fatigueTrend.slice(-7).map((value) => Number(value) || 0) : [],
        fatigueAverage: Math.max(0, Number(context?.fatigueAverage || 0)),
        avgKpm: Math.max(0, Number(context?.avgKpm || 0)),
        avgWpm: Math.max(0, Number(context?.avgWpm || 0)),
        avgSessionMinutes: Math.max(0, Number(context?.avgSessionMinutes || 0)),
        sessionMix: {
            productiveMinutes: Math.max(0, Number(sessionMix.productiveMinutes || 0)),
            supportingMinutes: Math.max(0, Number(sessionMix.supportingMinutes || 0)),
            distractingMinutes: Math.max(0, Number(sessionMix.distractingMinutes || 0)),
            unclearMinutes: Math.max(0, Number(sessionMix.unclearMinutes || 0)),
        },
        ambientSummary: {
            totalMinutes: Math.max(0, Number(ambientSummary.totalMinutes || 0)),
            productiveMinutes: Math.max(0, Number(ambientSummary.productiveMinutes || 0)),
            supportingMinutes: Math.max(0, Number(ambientSummary.supportingMinutes || 0)),
            distractingMinutes: Math.max(0, Number(ambientSummary.distractingMinutes || 0)),
            unclearMinutes: Math.max(0, Number(ambientSummary.unclearMinutes || 0)),
            productiveShare: Math.max(0, Number(ambientSummary.productiveShare || 0)),
            distractingShare: Math.max(0, Number(ambientSummary.distractingShare || 0)),
            supportingShare: Math.max(0, Number(ambientSummary.supportingShare || 0)),
            unclearShare: Math.max(0, Number(ambientSummary.unclearShare || 0)),
            topApps: Array.isArray(ambientSummary.topApps)
                ? ambientSummary.topApps.slice(0, 6).map((app) => ({
                    app: sanitizeShortText(app?.app || 'Tracked app', 80),
                    minutes: Math.max(0, Number(app?.minutes || 0)),
                    lane: String(app?.lane || 'unclear').slice(0, 20),
                    productiveMinutes: Math.max(0, Number(app?.productiveMinutes || 0)),
                    distractingMinutes: Math.max(0, Number(app?.distractingMinutes || 0)),
                }))
                : [],
        },
        linkedTaskSessions: Math.max(0, Number(context?.linkedTaskSessions || 0)),
        linkedHabitSessions: Math.max(0, Number(context?.linkedHabitSessions || 0)),
        workHours: context?.workHours ? sanitizeShortText(context.workHours, 80) : null,
        focusGoal: context?.focusGoal ? sanitizeShortText(context.focusGoal, 80) : null,
        trend: {
            previousSessions: Math.max(0, Number(trend.previousSessions || 0)),
            sessionDelta: Number(trend.sessionDelta || 0),
            previousAvgFocusScore: Math.max(0, Number(trend.previousAvgFocusScore || 0)),
            focusDelta: Number(trend.focusDelta || 0),
            previousFocusMinutes: Math.max(0, Number(trend.previousFocusMinutes || 0)),
            focusMinutesDelta: Number(trend.focusMinutesDelta || 0),
            previousDistractionEvents: Math.max(0, Number(trend.previousDistractionEvents || 0)),
            distractionDelta: Number(trend.distractionDelta || 0),
        },
        dataQuality: {
            readinessScore: Math.max(0, Number(dataQuality.readinessScore || 0)),
            baselineMet: Boolean(dataQuality.baselineMet),
            linkedContextCoverage: Math.max(0, Number(dataQuality.linkedContextCoverage || 0)),
            browserEvidenceEvents: Math.max(0, Number(dataQuality.browserEvidenceEvents || 0)),
            ambientUsageMinutes: Math.max(0, Number(dataQuality.ambientUsageMinutes || 0)),
            recommendationConfidence: sanitizeShortText(dataQuality.recommendationConfidence || 'low', 40),
        },
        browserEvidence: {
            totalEvents: Math.max(0, Number(context?.browserEvidence?.totalEvents || 0)),
            pressureScore: Math.max(0, Number(context?.browserEvidence?.pressureScore || 0)),
            dominantLane: String(context?.browserEvidence?.dominantLane || 'unclear'),
            distractingShare: Math.max(0, Number(context?.browserEvidence?.distractingShare || 0)),
            supportingShare: Math.max(0, Number(context?.browserEvidence?.supportingShare || 0)),
            totalBrowserMinutes: Math.max(0, Number(context?.browserEvidence?.totalBrowserMinutes || 0)),
            dominantPressureLabel: sanitizeShortText(context?.browserEvidence?.dominantPressureLabel || 'Quiet browser context', 120),
            leadSiteLabel: sanitizeShortText(context?.browserEvidence?.leadSiteLabel || 'No clear site yet', 100),
            leadPageLabel: sanitizeShortText(context?.browserEvidence?.leadPageLabel || 'No clear page yet', 120),
            topSites: Array.isArray(context?.browserEvidence?.topSites)
                ? context.browserEvidence.topSites.slice(0, 4).map((site) => ({
                    label: sanitizeShortText(site?.label || 'Browser', 80),
                    lane: String(site?.lane || 'unclear').slice(0, 20),
                    share: Math.max(0, Number(site?.share || 0)),
                }))
                : [],
        },
    }
}

function buildInsightPrompt(context, aiSettings = {}) {
    const peakHourLabel = context.peakFocusHour === null ? 'Unknown yet' : `${context.peakFocusHour}:00`
    const topAppsLabel = context.topApps.length ? context.topApps.join(', ') : 'No strong app pattern yet'
    const habitsLabel = context.habits.length
        ? context.habits.map((habit) => `- ${habit.name}: ${habit.sessions} sessions, avg focus ${habit.avgFocus}, streak ${habit.streak} days, ${habit.totalMinutes}m`).join('\n')
        : '- No habit-linked proof sessions yet'
    const tasksLabel = context.tasks.length
        ? context.tasks.map((task) => `- ${task.title}: ${task.sessions} sessions, avg focus ${task.avgFocus}, ${task.totalMinutes}m`).join('\n')
        : '- No task-linked sessions yet'
    const browserTopSitesLabel = context.browserEvidence.topSites.length
        ? context.browserEvidence.topSites.map((site) => `- ${site.label}: ${Math.round(site.share)}% share, lane ${site.lane}`).join('\n')
        : '- No strong browser site pattern yet'
    const ambientTopAppsLabel = context.ambientSummary.topApps.length
        ? context.ambientSummary.topApps.map((app) => `- ${app.app}: ${app.minutes}m total, lane ${app.lane}, ${app.productiveMinutes}m productive, ${app.distractingMinutes}m distracting`).join('\n')
        : '- No ambient app usage yet'

    return `You are Velance Coach: calm, direct, observant, and practical. You work inside Velance, a local-first desktop productivity analytics app. The user supplied their own ${aiSettings.providerLabel || 'AI'} key. Analyze only the summarized evidence below. Do not invent activity, diagnoses, medical claims, or hidden personal facts.

USER DATA (last ${context.period}):
- Sessions completed: ${context.sessions}
- Avg Focus Score: ${context.avgFocusScore}/100
- Total focus time: ${context.totalFocusMinutes} minutes
- Distraction events logged: ${context.distractionEvents}
- Peak focus hour: ${peakHourLabel}${context.peakFocusScore === null ? '' : ` at ${context.peakFocusScore}/100`}
- Current fatigue level: ${context.currentFatigue}
- Fatigue high-risk days: ${context.fatigueHighDays}/${context.period}
- Avg fatigue score: ${context.fatigueAverage}%
- Avg session length: ${context.avgSessionMinutes} minutes
- Session mix: ${context.sessionMix.productiveMinutes}m productive, ${context.sessionMix.supportingMinutes}m supporting, ${context.sessionMix.distractingMinutes}m distracting, ${context.sessionMix.unclearMinutes}m unclear
- Ambient usage: ${context.ambientSummary.totalMinutes}m total, ${context.ambientSummary.productiveMinutes}m productive, ${context.ambientSummary.supportingMinutes}m supporting, ${context.ambientSummary.distractingMinutes}m distracting, ${context.ambientSummary.unclearMinutes}m unclear
- Ambient shares: ${context.ambientSummary.productiveShare}% productive, ${context.ambientSummary.distractingShare}% distracting, ${context.ambientSummary.supportingShare}% supporting
- Linked context: ${context.linkedTaskSessions} task-linked sessions, ${context.linkedHabitSessions} habit-linked sessions
- Task board: ${context.taskSummary.open} open, ${context.taskSummary.completed} completed, ${context.taskSummary.dueToday} due today, ${context.taskSummary.overdue} overdue, ${context.taskSummary.highPriorityOpen} high priority open
- Trend vs previous ${context.period}: focus ${context.trend.focusDelta >= 0 ? '+' : ''}${context.trend.focusDelta}, minutes ${context.trend.focusMinutesDelta >= 0 ? '+' : ''}${context.trend.focusMinutesDelta}, distractions ${context.trend.distractionDelta >= 0 ? '+' : ''}${context.trend.distractionDelta}, sessions ${context.trend.sessionDelta >= 0 ? '+' : ''}${context.trend.sessionDelta}
- Data quality: readiness ${context.dataQuality.readinessScore}/100, linked coverage ${context.dataQuality.linkedContextCoverage}%, ambient usage ${context.dataQuality.ambientUsageMinutes}m, confidence ${context.dataQuality.recommendationConfidence}
- User goal: ${context.focusGoal || 'Not specified'}
- Working hours: ${context.workHours || 'Not specified'}
- Top apps used: ${topAppsLabel}
- Avg keystroke rate: ${context.avgKpm} key/min
- Avg word pace estimate: ${context.avgWpm} wpm
- Browser evidence: ${context.browserEvidence.totalEvents} events, pressure ${context.browserEvidence.pressureScore}/100, dominant lane ${context.browserEvidence.dominantLane}
- Browser lead site: ${context.browserEvidence.leadSiteLabel}
- Browser lead page: ${context.browserEvidence.leadPageLabel}
- Browser pattern: ${context.browserEvidence.dominantPressureLabel}
- Ambient top apps:
${ambientTopAppsLabel}
- Habits:
${habitsLabel}
- Task-linked work:
${tasksLabel}
- Top browser sites:
${browserTopSitesLabel}

STRICT RULES:
1. Be specific with real numbers from the data
2. If evidence is weak, say the recommendation is early-signal or baseline-building
3. Separate productivity coaching from medical advice; discuss recovery pressure, not diagnosis
4. Prefer concrete next actions that the Velance UI supports: focus block, task linking, habit consistency, app/browser audit, break/recovery
5. Write like a personal coach, not a generic analytics report. Use warm second-person guidance, but keep it concise.
6. Prioritize decision quality over stats. Give the three strongest recommendations only.
7. Return ONLY valid JSON array with exactly 3 items

[
  {
    "category": "performance|health|timing|warning|milestone|habit",
    "title": "Short impactful title",
    "insight": "2-3 sentence specific insight with real numbers from their data",
    "action": "One clear, actionable next step",
    "evidence": "Short evidence label using the strongest metric",
    "metricLabel": "Short stat label, e.g. Productive time",
    "metricValue": "Short stat value, e.g. 3h 20m",
    "confidence": "low|medium|high"
  }
]`
}

function parseInsightResponse(text) {
    const match = String(text || '').match(/\[[\s\S]*\]/)
    if (!match) throw new Error('No JSON found in AI response')
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error('AI response was not an array')
    const now = Date.now()
    const cleaned = parsed.slice(0, 3).map((item, index) => ({
        id: `ai-${now}-${index}`,
        category: sanitizeInsightCategory(item?.category),
        title: sanitizeShortText(item?.title || 'Insight', 90),
        insight: sanitizeShortText(item?.insight || '', 520),
        action: sanitizeShortText(item?.action || '', 240),
        evidence: sanitizeShortText(item?.evidence || '', 160),
        metricLabel: sanitizeShortText(item?.metricLabel || item?.metric_label || '', 60),
        metricValue: sanitizeShortText(item?.metricValue || item?.metric_value || '', 40),
        confidence: ['low', 'medium', 'high'].includes(String(item?.confidence || '').toLowerCase())
            ? String(item.confidence).toLowerCase()
            : 'medium',
    })).filter((item) => item.title && item.insight)
    if (!cleaned.length) throw new Error('AI response did not include usable insights')
    return cleaned
}

function normalizeProviderBaseUrl(baseUrl = '', fallback = '') {
    const source = String(baseUrl || fallback || '').trim()
    if (!source) return fallback
    try {
        const parsed = new URL(source)
        parsed.pathname = parsed.pathname.replace(/\/+$/, '')
        parsed.search = ''
        parsed.hash = ''
        return parsed.toString().replace(/\/+$/, '')
    } catch {
        return fallback
    }
}

function buildAiProviderError(error, aiSettings = {}) {
    const raw = error?.message || String(error || 'AI request failed')
    const lower = raw.toLowerCase()
    const providerLabel = aiSettings.providerLabel || 'AI provider'

    if (aiSettings.provider === 'gemini') {
        if (/api key not valid|api_key_invalid|invalid api key|permission_denied|unauthorized|forbidden|403|401/i.test(raw)) {
            return 'Gemini rejected this API key. Check that it is a Google AI Studio key, not a Google Cloud OAuth key, then paste it again.'
        }
        if (/not found|404|model/i.test(raw)) {
            return `Gemini could not use model "${aiSettings.model || 'gemini-3-flash-preview'}". Try Gemini 3 Flash, Gemini 3 Pro, or the stable Gemini 2.5 Flash fallback in Settings.`
        }
        if (/quota|rate|429|resource_exhausted/i.test(raw)) {
            return 'Gemini rate limit or quota was reached for this key. Wait a bit, check your Google AI Studio quota, or use another key.'
        }
        if (/blocked|safety/i.test(raw)) {
            return 'Gemini blocked the response for safety. Velance will keep local insights active and try a narrower summary next time.'
        }
    }

    if (aiSettings.provider === 'openai-compatible') {
        if (/incorrect api key|invalid api key|invalid_api_key|unauthorized|401/i.test(raw)) {
            return 'OpenAI rejected this API key. Check that the key is active, belongs to the selected provider, and has API access.'
        }
        if (/model_not_found|model.*not found|does not exist|404/i.test(raw)) {
            return `OpenAI could not use model "${aiSettings.model}". Choose a current model like gpt-5.1, gpt-5-mini, or enter the exact model from your compatible provider.`
        }
        if (/quota|rate|429|insufficient_quota|billing/i.test(raw)) {
            return 'OpenAI quota, billing, or rate limits blocked this request. Check usage limits/billing for this key or wait before retrying.'
        }
        if (/unsupported.*parameter|max_tokens|max_completion_tokens|temperature/i.test(raw)) {
            return 'OpenAI rejected one of the request parameters for this model. Velance adjusted provider handling, but you may need to switch models or retry.'
        }
    }

    if (aiSettings.provider === 'anthropic') {
        if (/invalid x-api-key|authentication_error|invalid api key|unauthorized|401/i.test(raw)) {
            return 'Anthropic rejected this API key. Check that it is a Claude API key from the Anthropic Console and paste it again.'
        }
        if (/not_found_error|model.*not found|model.*not available|404/i.test(raw)) {
            return `Anthropic could not use model "${aiSettings.model}". Try claude-sonnet-4-20250514, claude-opus-4-1-20250805, or claude-3-5-haiku-20241022.`
        }
        if (/rate_limit_error|overloaded_error|quota|rate|429|billing/i.test(raw)) {
            return 'Anthropic rate limits, billing, or temporary overload blocked this request. Wait a bit or check your Anthropic Console usage limits.'
        }
    }

    if (/timed out|timeout/i.test(raw)) {
        return `${providerLabel} did not respond before the timeout. Check your network connection and try again.`
    }
    if (/getaddrinfo|enotfound|econnrefused|network|socket/i.test(lower)) {
        return `${providerLabel} could not be reached. Check internet access, firewall/VPN, and the provider base URL.`
    }
    if (/invalid json/i.test(lower)) {
        return `${providerLabel} returned a malformed response. Try again or switch to a stable model.`
    }
    return raw
}

function createAiHttpError(statusCode, parsed = {}, fallback = '') {
    const providerError = parsed?.error || parsed
    const message = providerError?.message || parsed?.message || fallback || `AI API error ${statusCode}`
    const error = new Error(message)
    error.statusCode = statusCode
    error.providerType = providerError?.type || providerError?.code || parsed?.type || ''
    return error
}

function requestJson(url, body, headers = {}, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body)
        const target = new URL(url)
        const req = httpsRequest(target, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                ...headers,
            },
        }, (res) => {
            let data = ''
            res.on('data', chunk => { data += chunk })
            res.on('end', () => {
                let parsed = {}
                try {
                    parsed = data ? JSON.parse(data) : {}
                } catch (error) {
                    reject(new Error(`AI provider returned invalid JSON: ${error?.message || error}`))
                    return
                }
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(createAiHttpError(res.statusCode, parsed, `AI API error ${res.statusCode}`))
                    return
                }
                resolve(parsed)
            })
        })
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('AI request timed out'))
        })
        req.on('error', reject)
        req.write(payload)
        req.end()
    })
}

async function requestAiText(prompt, settings = {}, {
    temperature = 0.45,
    maxOutputTokens = 1600,
    timeoutMs = 25000,
    responseMimeType = null,
} = {}) {
    const aiSettings = normalizeAiSettings(settings)
    if (!aiSettings.hasKey || !aiSettings.apiKey) throw new Error('No AI API key configured')
    if (!aiSettings.hasModel) throw new Error(`Set a model name for ${aiSettings.providerLabel}`)

    if (aiSettings.provider === 'gemini') {
        const baseUrl = normalizeProviderBaseUrl(aiSettings.baseUrl, 'https://generativelanguage.googleapis.com')
        const requestedModel = String(aiSettings.model || 'gemini-3-flash-preview').replace(/^models\//, '')
        const modelsToTry = [...new Set([
            requestedModel,
            'gemini-3-flash-preview',
            'gemini-3-pro-preview',
            'gemini-2.5-flash',
        ].filter(Boolean))]
        let lastError = null

        for (const model of modelsToTry) {
            try {
                const response = await requestJson(
                    `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
                    {
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature, maxOutputTokens, ...(responseMimeType ? { responseMimeType } : {}) },
                    },
                    { 'x-goog-api-key': aiSettings.apiKey },
                    timeoutMs,
                )
                const text = response?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('') || ''
                if (!text) {
                    throw new Error(response?.promptFeedback?.blockReason ? `Gemini blocked the response: ${response.promptFeedback.blockReason}` : 'Gemini returned no text')
                }
                return text
            } catch (error) {
                lastError = error
            }
        }

        throw lastError || new Error('Gemini request failed')
    }

    if (aiSettings.provider === 'openai-compatible') {
        const baseUrl = normalizeProviderBaseUrl(aiSettings.baseUrl, 'https://api.openai.com/v1')
        const isOfficialOpenAi = /(^|\.)api\.openai\.com$/i.test(new URL(baseUrl).hostname)
        const isModernOpenAiModel = isOfficialOpenAi && /^(gpt-5|o[134])/.test(aiSettings.model)
        const tokenLimitKey = isModernOpenAiModel ? 'max_completion_tokens' : 'max_tokens'
        const body = {
            model: aiSettings.model,
            messages: [
                { role: 'system', content: 'You are Velance AI. Return only the JSON requested by the user prompt.' },
                { role: 'user', content: prompt },
            ],
            [tokenLimitKey]: maxOutputTokens,
        }
        if (!isModernOpenAiModel) body.temperature = temperature
        const response = await requestJson(
            `${baseUrl}/chat/completions`,
            body,
            { Authorization: `Bearer ${aiSettings.apiKey}` },
            timeoutMs,
        )
        const rawContent = response?.choices?.[0]?.message?.content || response?.choices?.[0]?.text || ''
        const text = Array.isArray(rawContent)
            ? rawContent.map((part) => part?.text || part?.content || '').join('')
            : rawContent
        if (!text) throw new Error('OpenAI-compatible provider returned no text')
        return text
    }

    if (aiSettings.provider === 'anthropic') {
        const baseUrl = normalizeProviderBaseUrl(aiSettings.baseUrl, 'https://api.anthropic.com')
        const response = await requestJson(
            `${baseUrl}/v1/messages`,
            {
                model: aiSettings.model,
                max_tokens: maxOutputTokens,
                temperature,
                messages: [{ role: 'user', content: prompt }],
            },
            {
                'x-api-key': aiSettings.apiKey,
                'anthropic-version': '2023-06-01',
            },
            timeoutMs,
        )
        const text = Array.isArray(response?.content)
            ? response.content.map((part) => part?.text || '').join('')
            : ''
        if (!text) throw new Error('Anthropic returned no text')
        return text
    }

    throw new Error(`Unsupported AI provider: ${aiSettings.provider}`)
}

function sanitizeDailyAnalysisContext(context = {}) {
    const sanitizeSession = (session = null) => (
        session
            ? {
                title: String(session?.title || 'Focus session').slice(0, 120),
                focusScore: Math.max(0, Number(session?.focusScore || 0)),
                fatigueScore: Math.max(0, Number(session?.fatigueScore || 0)),
                distractions: Math.max(0, Number(session?.distractions || 0)),
                driftCount: Math.max(0, Number(session?.driftCount || 0)),
            }
            : null
    )
    const browserEventSummary = context?.browserEventSummary || {}

    return {
        dateKey: String(context?.dateKey || ''),
        focusAverage: Math.max(0, Number(context?.focusAverage || 0)),
        sessionFatigueAverage: Math.max(0, Number(context?.sessionFatigueAverage || 0)),
        backgroundFatigue: Math.max(0, Number(context?.backgroundFatigue || 0)),
        combinedFatigue: Math.max(0, Number(context?.combinedFatigue || 0)),
        topApp: String(context?.topApp || 'No dominant app').slice(0, 80),
        topCategory: String(context?.topCategory || 'No dominant category').slice(0, 80),
        tasksCompleted: Math.max(0, Number(context?.tasksCompleted || 0)),
        browserEventSummary: {
            totalEvents: Math.max(0, Number(browserEventSummary.totalEvents || 0)),
            tabSwitches: Math.max(0, Number(browserEventSummary.tabSwitches || 0)),
            tabsOpened: Math.max(0, Number(browserEventSummary.tabsOpened || 0)),
            audibleMoments: Math.max(0, Number(browserEventSummary.audibleMoments || 0)),
            uniqueHosts: Math.max(0, Number(browserEventSummary.uniqueHosts || 0)),
        },
        strongestSession: sanitizeSession(context?.strongestSession),
        weakestSession: sanitizeSession(context?.weakestSession),
        habits: Array.isArray(context?.habits)
            ? context.habits.slice(0, 8).map((habit) => ({
                name: String(habit?.name || 'Habit').slice(0, 80),
                minutes: Math.max(0, Number(habit?.minutes || 0)),
                targetMinutes: Math.max(0, Number(habit?.targetMinutes || 0)),
                sessions: Math.max(0, Number(habit?.sessions || 0)),
                avgFocus: Math.max(0, Number(habit?.avgFocus || 0)),
                achieved: Boolean(habit?.achieved),
            }))
            : [],
        topEvents: Array.isArray(context?.topEvents)
            ? context.topEvents.slice(0, 5).map((event) => ({
                type: String(event?.type || 'event').slice(0, 40),
                title: String(event?.title || 'Meaningful event').slice(0, 120),
                detail: String(event?.detail || '').slice(0, 220),
                timeLabel: String(event?.timeLabel || '--').slice(0, 40),
                tab: String(event?.tab || 'overview').slice(0, 24),
            }))
            : [],
    }
}

function buildDailyAnalysisPrompt(context) {
    const strongestSessionLabel = context.strongestSession
        ? `${context.strongestSession.title} (${context.strongestSession.focusScore}/100 focus, ${context.strongestSession.fatigueScore}% fatigue, ${context.strongestSession.distractions} distractions)`
        : 'No strong focus session yet'
    const weakestSessionLabel = context.weakestSession
        ? `${context.weakestSession.title} (${context.weakestSession.focusScore}/100 focus, ${context.weakestSession.fatigueScore}% fatigue, ${context.weakestSession.distractions} distractions, ${context.weakestSession.driftCount} drift moments)`
        : 'No weak focus session yet'
    const habitLabel = context.habits.length
        ? context.habits
            .map((habit) => `- ${habit.name}: ${habit.minutes}/${habit.targetMinutes} minutes, ${habit.sessions} sessions, avg focus ${habit.avgFocus}, achieved ${habit.achieved}`)
            .join('\n')
        : '- No habit evidence for this day'
    const eventLabel = context.topEvents.length
        ? context.topEvents
            .map((event) => `- ${event.timeLabel}: ${event.title} (${event.type}) -> ${event.detail}`)
            .join('\n')
        : '- No meaningful event evidence yet'

    return `You are the daily analysis narrator for Velance, a local-first desktop productivity app. Explain the selected day using only the provided evidence. Do not invent facts, and do not give vague generic advice.

SELECTED DAY:
- Date: ${context.dateKey}
- Focus average: ${context.focusAverage}/100
- Session fatigue average: ${context.sessionFatigueAverage}%
- Background fatigue: ${context.backgroundFatigue}%
- Combined fatigue: ${context.combinedFatigue}%
- Top app: ${context.topApp}
- Top category: ${context.topCategory}
- Tasks completed: ${context.tasksCompleted}
- Browser events: ${context.browserEventSummary.totalEvents} events, ${context.browserEventSummary.tabSwitches} tab switches, ${context.browserEventSummary.tabsOpened} tabs opened, ${context.browserEventSummary.audibleMoments} audible moments, ${context.browserEventSummary.uniqueHosts} hosts
- Strongest session: ${strongestSessionLabel}
- Weakest session: ${weakestSessionLabel}
- Habit evidence:
${habitLabel}
- Top events:
${eventLabel}

STRICT RULES:
1. Ground every answer in the data above.
2. Be concise, human, and specific.
3. If there is weak evidence, say that clearly instead of overclaiming.
4. Return ONLY valid JSON with exactly these keys:
{
  "daySummary": "2-3 sentences summarizing the day",
  "focusWhy": "2-3 sentences explaining why focus depth was strong or weak",
  "fatigueWhy": "2-3 sentences explaining why fatigue rose or stayed stable",
  "habitWhy": "2-3 sentences explaining why a habit performed well or why there is not enough evidence"
}`
}

function parseDailyAnalysisResponse(text) {
    const source = String(text || '')
    const codeBlock = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = codeBlock ? codeBlock[1] : source
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('No JSON object found in AI daily analysis response')
    }
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    return {
        daySummary: String(parsed?.daySummary || '').trim(),
        focusWhy: String(parsed?.focusWhy || '').trim(),
        fatigueWhy: String(parsed?.fatigueWhy || '').trim(),
        habitWhy: String(parsed?.habitWhy || '').trim(),
    }
}

ipcMain.handle('velance:insights:generate', async (_, { userId, context }) => {
    const safeUserId = userId || trackingUserId || 'local-user'
    const settings = dataRepo?.getAiSettingsForInference?.(safeUserId) || dataRepo?.getBootstrap?.(safeUserId)?.settings || {}
    const aiSettings = normalizeAiSettings(settings)
    if (!aiSettings.hasKey) {
        return { ok: false, reason: 'no_api_key' }
    }

    try {
        const safeContext = sanitizeInsightContext(context)
        const prompt = buildInsightPrompt(safeContext, aiSettings)
        const text = await requestAiText(prompt, aiSettings, { responseMimeType: 'application/json' })
        writeRuntimeLog('insights.generate.succeeded', {
            userId: safeUserId,
            provider: aiSettings.provider,
            model: aiSettings.model,
        })
        return {
            ok: true,
            provider: aiSettings.provider,
            model: aiSettings.model,
            insights: parseInsightResponse(text),
        }
    } catch (error) {
        const friendlyMessage = buildAiProviderError(error, aiSettings)
        writeRuntimeLog('insights.generate.failed', { message: friendlyMessage })
        return {
            ok: false,
            reason: 'generation_failed',
            message: friendlyMessage,
        }
    }
})

// ── Supabase Google OAuth Popup ───────────────────────────────
ipcMain.handle('velance:analysis:explain-day', async (_, { userId, context }) => {
    const safeUserId = userId || trackingUserId || 'local-user'
    const settings = dataRepo?.getAiSettingsForInference?.(safeUserId) || dataRepo?.getBootstrap?.(safeUserId)?.settings || {}
    const aiSettings = normalizeAiSettings(settings)
    if (!aiSettings.hasKey) {
        return { ok: false, reason: 'no_api_key' }
    }

    try {
        const safeContext = sanitizeDailyAnalysisContext(context)
        const prompt = buildDailyAnalysisPrompt(safeContext)
        const text = await requestAiText(prompt, aiSettings, {
            temperature: 0.35,
            maxOutputTokens: 1200,
            responseMimeType: 'application/json',
        })
        return {
            ok: true,
            provider: aiSettings.provider,
            model: aiSettings.model,
            explanations: parseDailyAnalysisResponse(text),
        }
    } catch (error) {
        const friendlyMessage = buildAiProviderError(error, aiSettings)
        writeRuntimeLog('analysis.explain_day.failed', { message: friendlyMessage })
        return {
            ok: false,
            reason: 'generation_failed',
            message: friendlyMessage,
        }
    }
})

ipcMain.handle('velance:ai:test', async (_, { userId, settings } = {}) => {
    const safeUserId = userId || trackingUserId || 'local-user'
    const storedSettings = dataRepo?.getAiSettingsForInference?.(safeUserId) || dataRepo?.getBootstrap?.(safeUserId)?.settings || {}
    const incomingSettings = { ...(settings || {}) }
    const incomingApiKey = String(incomingSettings.geminiApiKey || incomingSettings.aiApiKey || incomingSettings.apiKey || '').trim()
    if (!incomingApiKey) {
        delete incomingSettings.geminiApiKey
        delete incomingSettings.aiApiKey
        delete incomingSettings.apiKey
    }
    const aiSettings = normalizeAiSettings({ ...storedSettings, ...incomingSettings })
    if (!aiSettings.hasKey) {
        return {
            ok: false,
            reason: 'no_api_key',
            provider: aiSettings.provider,
            providerLabel: aiSettings.providerLabel,
            model: aiSettings.model,
            message: aiSettings.keyProvider && aiSettings.keyProvider !== aiSettings.provider
                ? `Add a ${aiSettings.providerLabel} key first. The saved key belongs to another provider.`
                : 'Add an AI API key first.',
        }
    }
    if (!aiSettings.hasModel) {
        return { ok: false, reason: 'missing_model', message: `Set a model name for ${aiSettings.providerLabel}.` }
    }

    try {
        const text = aiSettings.provider === 'gemini'
            ? await requestAiText(
                'Reply with exactly: Velance AI test passed',
                aiSettings,
                { temperature: 0, maxOutputTokens: 60, timeoutMs: 18000 },
            )
            : await requestAiText(
                'Reply with exactly: Velance AI test passed',
                aiSettings,
                { temperature: 0, maxOutputTokens: 60, timeoutMs: 18000 },
            )
        const testedAt = Date.now()
        const successMessage = `${aiSettings.providerLabel} connected successfully with ${aiSettings.model}.`
        let persistedSettings = null
        if (dataRepo?.saveSettings) {
            try {
                persistedSettings = dataRepo.saveSettings(safeUserId, {
                    ...storedSettings,
                    ...incomingSettings,
                    aiProvider: aiSettings.provider,
                    aiModel: aiSettings.model,
                    aiBaseUrl: aiSettings.provider === 'gemini' ? '' : aiSettings.baseUrl,
                    geminiApiKey: incomingApiKey || storedSettings.geminiApiKey || '',
                    aiKeyProvider: aiSettings.provider,
                    aiLastTestedAt: testedAt,
                    aiLastTestOk: true,
                    aiLastTestMessage: successMessage,
                    clearAiApiKey: false,
                })
            } catch (saveError) {
                const message = `${successMessage} But Velance could not save the key on this device: ${saveError?.message || saveError}`
                writeRuntimeLog('ai.test.save_failed', {
                    provider: aiSettings.provider,
                    model: aiSettings.model,
                    message,
                })
                return {
                    ok: false,
                    reason: 'save_failed',
                    provider: aiSettings.provider,
                    providerLabel: aiSettings.providerLabel,
                    model: aiSettings.model,
                    message,
                }
            }
        }
        writeRuntimeLog('ai.test.succeeded', {
            userId: safeUserId,
            provider: aiSettings.provider,
            model: aiSettings.model,
            saved: Boolean(persistedSettings?.hasAiApiKey),
            testedAt,
        })
        return {
            ok: true,
            provider: aiSettings.provider,
            providerLabel: aiSettings.providerLabel,
            model: aiSettings.model,
            message: successMessage,
            preview: sanitizeShortText(text, 180),
            settings: persistedSettings,
            diagnostics: {
                provider: aiSettings.provider,
                model: aiSettings.model,
                baseUrl: aiSettings.provider === 'gemini' ? 'https://generativelanguage.googleapis.com' : aiSettings.baseUrl,
                checkedAt: testedAt,
            },
        }
    } catch (error) {
        const friendlyMessage = buildAiProviderError(error, aiSettings)
        writeRuntimeLog('ai.test.failed', {
            provider: aiSettings.provider,
            model: aiSettings.model,
            message: friendlyMessage,
        })
        return {
            ok: false,
            reason: 'test_failed',
            provider: aiSettings.provider,
            providerLabel: aiSettings.providerLabel,
            model: aiSettings.model,
            message: friendlyMessage,
            diagnostics: {
                provider: aiSettings.provider,
                model: aiSettings.model,
                baseUrl: aiSettings.provider === 'gemini' ? 'https://generativelanguage.googleapis.com' : aiSettings.baseUrl,
                checkedAt: Date.now(),
            },
        }
    }
})


function runExternalOAuthFlow(rawUrl) {
    return new Promise((resolve) => {
        let settled = false
        let server = null
        let timeout = null
        let authWin = null

        const settle = (result) => {
            if (settled) return
            settled = true
            if (timeout) { clearTimeout(timeout); timeout = null }
            if (server) { try { server.close() } catch {} ; server = null }
            if (authWin && !authWin.isDestroyed()) {
                try { authWin.close() } catch {}
                authWin = null
            }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.show()
                mainWindow.focus()
            }
            resolve(result)
        }

        // Helper: check if a URL is our OAuth callback
        function isCallbackUrl(url = '') {
            try {
                return url.includes('127.0.0.1') && (url.includes('access_token') || url.includes('code=') || url.includes('error='))
            } catch { return false }
        }

        try {
            const authUrl = new URL(rawUrl)
            const redirectTo = authUrl.searchParams.get('redirect_to') || 'http://127.0.0.1/auth/callback'
            const redirectUrl = new URL(redirectTo)
            const listenHost = redirectUrl.hostname || '127.0.0.1'
            const listenPort = Number(redirectUrl.port || (redirectUrl.protocol === 'https:' ? 443 : 80))
            const callbackPath = redirectUrl.pathname || '/'

            server = createServer((req, res) => {
                const requestUrl = new URL(req.url || '/', `${redirectUrl.protocol}//${redirectUrl.host}`)

                if (req.method === 'POST' && requestUrl.pathname === `${callbackPath}/complete`) {
                    let body = ''
                    req.on('data', (chunk) => { body += chunk })
                    req.on('end', () => {
                        try {
                            const payload = JSON.parse(body || '{}')
                            res.writeHead(200, { 'Content-Type': 'application/json' })
                            res.end(JSON.stringify({ ok: true }))
                            settle({ ok: true, url: payload.url || redirectTo })
                        } catch (error) {
                            res.writeHead(400, { 'Content-Type': 'application/json' })
                            res.end(JSON.stringify({ ok: false }))
                            settle({ ok: false, error: `Failed to parse OAuth callback. ${error.message}` })
                        }
                    })
                    return
                }

                if (req.method === 'GET' && requestUrl.pathname === callbackPath) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Velance sign-in</title>
    <style>
      body { font-family: Inter, system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f7fb; color: #11233b; }
      .card { width: min(420px, calc(100vw - 32px)); padding: 28px; border-radius: 24px; background: rgba(255,255,255,0.94); border: 1px solid rgba(17,35,59,0.08); box-shadow: 0 24px 54px rgba(17,35,59,0.08); }
      .badge { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 16px; font-weight: 800; color: white; background: linear-gradient(135deg, #0ea5e9, #14b8a6); font-size: 22px; }
      h1 { margin: 18px 0 8px; font-size: 28px; line-height: 1.02; letter-spacing: -0.04em; }
      p { margin: 0; color: #5b6880; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="badge">V</div>
      <h1>Finishing sign-in</h1>
      <p>You can return to Velance in a moment. This tab is handing the session back to the desktop app.</p>
    </div>
    <script>
      const finalUrl = window.location.href;
      fetch('${callbackPath}/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: finalUrl })
      }).catch(() => {
        document.body.insertAdjacentHTML('beforeend', '<p style="margin-top:12px;text-align:center;">You can close this tab and return to Velance.</p>');
      }).finally(() => {
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, document.title, '${callbackPath}');
        }
      });
    <\/script>
  </body>
</html>`)
                    return
                }

                res.writeHead(404, { 'Content-Type': 'text/plain' })
                res.end('Not found')
            })

            server.on('error', (error) => {
                settle({
                    ok: false,
                    error: `Could not start the local sign-in callback on ${listenHost}:${listenPort}. ${error.message}`,
                })
            })

            server.listen(listenPort, listenHost, async () => {
                try {
                    // Open a hidden BrowserWindow to handle the OAuth flow, instead of shell.openExternal.
                    // This lets us intercept the redirect via navigation events as a fallback.
                    authWin = new BrowserWindow({
                        width: 520,
                        height: 680,
                        show: true,
                        title: 'Sign in with Google',
                        icon: join(process.env.DIST, 'logo.png'),
                        webPreferences: {
                            nodeIntegration: false,
                            contextIsolation: true,
                            sandbox: true,
                        },
                    })

                    // Fallback: capture the callback URL directly from BrowserWindow navigation
                    const onNavigation = (event, url) => {
                        if (!isCallbackUrl(url)) return
                        // Let the local HTTP server handle it naturally if it can — delay slightly
                        setTimeout(() => {
                            if (!settled) {
                                writeRuntimeLog('oauth.fallback.navigation-capture', { url: url.split('?')[0] })
                                settle({ ok: true, url })
                            }
                        }, 600)
                    }

                    authWin.webContents.on('will-redirect', onNavigation)
                    authWin.webContents.on('did-navigate', onNavigation)

                    authWin.on('closed', () => {
                        if (!settled) {
                            writeRuntimeLog('oauth.window.closed-by-user')
                            settle({ ok: false, error: 'Google sign-in window was closed.' })
                        }
                    })

                    await authWin.loadURL(rawUrl)

                    timeout = setTimeout(() => {
                        settle({ ok: false, error: 'Google sign-in timed out. Please try again.' })
                    }, 300000)  // 5 minute timeout
                } catch (error) {
                    settle({ ok: false, error: `Could not open the sign-in window. ${error.message}` })
                }
            })
        } catch (error) {
            settle({ ok: false, error: `Invalid Google sign-in request. ${error.message}` })
        }
    })
}

ipcMain.handle('velance:auth-google-supabase', async (_, { url }) => {
    return runExternalOAuthFlow(url)
})

// ── Auto Updater ────────────────────────────────
function setupAutoUpdater() {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('error', err => {
        writeRuntimeLog('updater.error', { message: err?.message || String(err) })
    })
    autoUpdater.on('update-downloaded', () => {
        writeRuntimeLog('updater.downloaded')
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('velance:update-downloaded')
        }
    })
    // Delay first check so the window has time to render
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4000)
}

// ── App Lifecycle ───────────────────────────────
process.on('unhandledRejection', (reason) => {
    console.error('[Velance] Unhandled rejection:', reason)
})

if (!hasSingleInstanceLock) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
    })
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
    app.setAppUserModelId('com.velance.app')
    Menu.setApplicationMenu(null)
    writeRuntimeLog('startup.ready.begin')
    try {
        dataRepo = createDataRepository()
        writeRuntimeLog('startup.repository.created')
        writeRuntimeLog('startup.repository.status', dataRepo?.getBackendStatus?.() || { kind: dataRepo?.backend || 'unknown' })
        dataRepo?.pruneExpiredDataForAllUsers?.()
        writeRuntimeLog('startup.retention.pruned')
        registerDataIpc(dataRepo, { resolveClassificationEdgeCases })
        writeRuntimeLog('startup.ipc.registered')
    } catch (error) {
        console.error('[Velance] Data layer startup error:', error)
        writeRuntimeLog('startup.data.error', {
            message: error?.message || String(error),
            stack: error?.stack || '',
        })
    }
    await loadNativeModules()
    writeRuntimeLog('startup.native.loaded')
    startExtensionBridge()
    createWindow()
    writeRuntimeLog('startup.window.created')
    setupAutoUpdater()
}).catch(e => {
    console.error('[Velance] Fatal startup error:', e)
    writeRuntimeLog('startup.fatal.error', {
        message: e?.message || String(e),
        stack: e?.stack || '',
    })
    try { createWindow() } catch (_) { }
})

app.on('before-quit', () => {
    flushAllExtensionAudioSessions()
    clearExtensionBridgeRetry()
    if (extensionBridgeServer) {
        try { extensionBridgeServer.close() } catch {}
        extensionBridgeServer = null
    }
})

app.on('window-all-closed', () => {
    stopNativeTracking()
    stopAmbientTracking({ flush: true })
    if (process.platform !== 'darwin') { app.quit(); mainWindow = null }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
