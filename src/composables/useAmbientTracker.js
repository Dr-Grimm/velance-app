import { ref } from 'vue'
import {
    clearInsightCache,
    deleteCustomRuleData,
    getAmbientRange,
    getBrowserEventRange,
    getCombinedTrackingRange,
    getCurrentUserId,
    getCustomRulesData,
    getMediaRange,
    reclassifyTrackingHistory,
    saveCustomRule,
} from '../services/dataService.js'
import {
    buildAILookupKey,
    clearAILearnedRules,
    getAICacheStats,
    getAILearnedRules,
    improveUnclearClassifications,
} from '../services/classificationAI.js'
import { formatLocalDateKey } from '../services/dateKey.js'
import { getWorkspaceScopedKey } from '../services/workspaceIdentity.js'
import { normalizeBrowserEventEntry } from '../services/browserEventTracking.js'
import { buildBrowserEvidenceSummary } from '../services/browserEvidenceService.js'
import {
    CATEGORY_COLORS,
    TRACKING_CLASSIFICATION_VERSION,
    classifyActivity as sharedClassifyActivity,
    getCategoryDefaultLane,
    isBrowserShellRuleMatch,
    isInternalTrackingActivity as isInternalAmbientEntry,
    normalizeAmbientEntryPayload,
    normalizeBackgroundMediaPayload,
    normalizeLaneKey,
    normalizeObservedAppName as sharedNormalizeObservedAppName,
    resolveAmbientEntryLane,
} from '../services/activityClassification.js'

export { CATEGORY_COLORS }

const GOALS_KEY = 'velance_goals'
const CACHE_DAYS = 30
const AMBIENT_CACHE_KEY_PREFIX = 'velance_ambient_cache'
const MEDIA_CACHE_KEY_PREFIX = 'velance_media_cache'
const BROWSER_EVENT_CACHE_KEY_PREFIX = 'velance_browser_event_cache'
const CUSTOM_RULES_KEY_PREFIX = 'velance_custom_rules'
const TRACKING_CLASSIFICATION_MARKER_KEY = 'velance_tracking_classification_marker'

const todayEntriesRef = ref([])
const todayMediaEntriesRef = ref([])
const todayBrowserEventsRef = ref([])
const ambientCacheRef = ref({})
const mediaCacheRef = ref({})
const browserEventCacheRef = ref({})
const customRulesRef = ref({})
const aiLearnedRulesRef = ref({})
const liveSnapshotRef = ref(null)

let listenerAttached = false
let hydrated = false
let hydratedUserId = null
let beforeUnloadHandler = null
let refreshTimer = null

function getDateKey(date = new Date()) {
    return formatLocalDateKey(date)
}

function toDisplayMinutes(seconds = 0) {
    const safe = Math.max(0, Number(seconds) || 0)
    if (safe === 0) return 0
    if (safe < 60) return Math.max(0.1, Math.round(safe / 6) / 10)
    return Math.round(safe / 60)
}

export function normalizeObservedAppName(appName = '') {
    return sharedNormalizeObservedAppName(appName)
}

function normalizeTrackedBrowserEvent(entry = {}) {
    return normalizeBrowserEventEntry(entry, {
        customRules: customRulesRef.value,
    })
}

function isInternalTrackingActivity(entry = {}) {
    return isInternalAmbientEntry(entry)
}

function filterMeaningfulEntries(entries = [], { includeInternal = false } = {}) {
    const normalizedEntries = Array.isArray(entries) ? entries : []
    if (includeInternal) return normalizedEntries
    return normalizedEntries.filter((entry) => !isInternalTrackingActivity(entry))
}

function getAmbientLane(entry = {}) {
    return resolveAmbientEntryLane(entry)
}

function getDominantProductivityState(stats = {}) {
    const productive = Number(stats?.productive || 0)
    const distracting = Number(stats?.distracting || 0)
    const neutral = Number(stats?.neutral || 0)

    if (productive >= distracting && productive >= neutral) return true
    if (distracting >= productive && distracting >= neutral) return false
    return null
}

function getDominantLaneFromTotals(totals = {}) {
    return ['productive', 'supporting', 'unclear', 'distracting']
        .map((lane) => [lane, Number(totals?.[lane] || 0)])
        .sort((left, right) => right[1] - left[1])[0]?.[0] || 'unclear'
}

function getDisplayLaneForSummary({
    category = '',
    productive = null,
    subcategory = '',
    contextLabel = '',
    appName = '',
    laneTotals = {},
} = {}) {
    const categoryLane = getCategoryDefaultLane(category, {
        productive,
        subcategory,
        contextLabel,
        appName,
    })

    if (categoryLane === 'distracting') return 'distracting'
    if (categoryLane === 'supporting') return 'supporting'
    if (categoryLane === 'productive') return 'productive'

    return getDominantLaneFromTotals(laneTotals)
}

function laneToProductive(lane = 'unclear') {
    if (lane === 'productive') return true
    if (lane === 'distracting') return false
    return null
}

function sortBreakdownRows(rows = [], sortBy = 'seconds', getLabel = (row) => row?.app || row?.label || row?.sourceApp || '') {
    const nextRows = [...rows]
    const compareNumbers = (left, right) => right - left

    nextRows.sort((left, right) => {
        switch (sortBy) {
            case 'recent': {
                const recentDiff = compareNumbers(Number(left?.lastTs || 0), Number(right?.lastTs || 0))
                if (recentDiff) return recentDiff
                break
            }
            case 'switches': {
                const switchDiff = compareNumbers(Number(left?.switches || 0), Number(right?.switches || 0))
                if (switchDiff) return switchDiff
                break
            }
            case 'productive': {
                const shareDiff = compareNumbers(Number(left?.productiveShare || 0), Number(right?.productiveShare || 0))
                if (shareDiff) return shareDiff
                break
            }
            case 'distracting': {
                const shareDiff = compareNumbers(Number(left?.distractingShare || 0), Number(right?.distractingShare || 0))
                if (shareDiff) return shareDiff
                break
            }
            case 'confidence': {
                const confidenceDiff = compareNumbers(Number(left?.confidence || 0), Number(right?.confidence || 0))
                if (confidenceDiff) return confidenceDiff
                break
            }
            case 'alphabetical': {
                const labelDiff = String(getLabel(left)).localeCompare(String(getLabel(right)))
                if (labelDiff) return labelDiff
                break
            }
            case 'seconds':
            default: {
                const secondsDiff = compareNumbers(Number(left?.seconds || 0), Number(right?.seconds || 0))
                if (secondsDiff) return secondsDiff
                break
            }
        }

        const fallbackSeconds = compareNumbers(Number(left?.seconds || 0), Number(right?.seconds || 0))
        if (fallbackSeconds) return fallbackSeconds
        return String(getLabel(left)).localeCompare(String(getLabel(right)))
    })

    return nextRows
}

function buildRecentDateKeys(days = CACHE_DAYS) {
    const keys = []
    for (let i = 0; i < days; i++) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        keys.push(getDateKey(date))
    }
    return keys
}

function getAmbientCacheKey(userId = getCurrentUserId()) {
    return `${AMBIENT_CACHE_KEY_PREFIX}:${userId}`
}

function getMediaCacheKey(userId = getCurrentUserId()) {
    return `${MEDIA_CACHE_KEY_PREFIX}:${userId}`
}

function getBrowserEventCacheKey(userId = getCurrentUserId()) {
    return `${BROWSER_EVENT_CACHE_KEY_PREFIX}:${userId}`
}

function getCustomRulesKey(userId = getCurrentUserId()) {
    return `${CUSTOM_RULES_KEY_PREFIX}:${userId}`
}

function getTrackingClassificationMarkerKey(userId = getCurrentUserId()) {
    return getWorkspaceScopedKey(TRACKING_CLASSIFICATION_MARKER_KEY, userId)
}

async function ensureTrackingClassificationVersion(userId = getCurrentUserId()) {
    if (!hasAmbientDataBridge()) return

    const markerKey = getTrackingClassificationMarkerKey(userId)
    try {
        if (localStorage.getItem(markerKey) === TRACKING_CLASSIFICATION_VERSION) return
    } catch {
    }

    try {
        await reclassifyTrackingHistory(userId)
        try {
            localStorage.setItem(markerKey, TRACKING_CLASSIFICATION_VERSION)
        } catch {
        }
    } catch (error) {
        console.warn('[Velance] Failed to reclassify tracking history:', error)
    }
}

function pruneDateCache(cache = {}, days = CACHE_DAYS) {
    const allowed = new Set(buildRecentDateKeys(days))
    return Object.fromEntries(
        Object.entries(cache)
            .filter(([dateKey, entries]) => allowed.has(dateKey) && Array.isArray(entries))
            .map(([dateKey, entries]) => [dateKey, [...entries].sort((a, b) => a.ts - b.ts)]),
    )
}

function loadDateCacheFallback(storageKey) {
    try {
        return pruneDateCache(JSON.parse(localStorage.getItem(storageKey) || '{}'))
    } catch {
        return {}
    }
}

function persistDateCacheFallback(storageKey, cache) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(pruneDateCache(cache)))
    } catch {
    }
}

function flattenDateCache(cache = {}) {
    return Object.values(cache).flatMap((entries) => Array.isArray(entries) ? entries : [])
}

function mergeDateEntries(primaryEntries = [], fallbackEntries = []) {
    const merged = new Map()

    const addEntry = (entry) => {
        if (!entry) return
        const key = entry.id || `${entry.date || getDateKey(new Date(entry.ts))}-${entry.ts}-${entry.contextLabel || entry.app || entry.sourceApp || ''}`
        const existing = merged.get(key)
        if (!existing || (entry.duration || 0) >= (existing.duration || 0)) {
            merged.set(key, entry)
        }
    }

    fallbackEntries.forEach(addEntry)
    primaryEntries.forEach(addEntry)

    return [...merged.values()].sort((a, b) => a.ts - b.ts)
}

function updateTodayRefs() {
    todayEntriesRef.value = [...(ambientCacheRef.value[getDateKey()] || [])]
    todayMediaEntriesRef.value = [...(mediaCacheRef.value[getDateKey()] || [])]
    todayBrowserEventsRef.value = [...(browserEventCacheRef.value[getDateKey()] || [])]
}

function updateCacheForDate(targetRef, storageKey, dateKey, entries) {
    targetRef.value = {
        ...targetRef.value,
        [dateKey]: [...entries].sort((a, b) => a.ts - b.ts),
    }
    updateTodayRefs()
    persistDateCacheFallback(storageKey, targetRef.value)
}

function setCacheEntries(targetRef, storageKey, entries) {
    const grouped = {}
    for (const entry of entries) {
        const key = entry?.date || getDateKey(new Date(entry?.ts))
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(entry)
    }

    Object.values(grouped).forEach((items) => items.sort((a, b) => a.ts - b.ts))
    targetRef.value = grouped
    updateTodayRefs()
    persistDateCacheFallback(storageKey, grouped)
}

function hasAmbientDataBridge() {
    return Boolean(window.velance?.data?.getAmbientRange)
}

function hasMediaDataBridge() {
    return Boolean(window.velance?.data?.getMediaRange)
}

function hasCombinedRangeBridge() {
    return Boolean(window.velance?.data?.getCombinedTrackingRange)
}

function hasBrowserEventDataBridge() {
    return Boolean(window.velance?.data?.getBrowserEventRange)
}

function hasCustomRulesBridge() {
    return Boolean(
        window.velance?.data?.getCustomRules &&
        window.velance?.data?.upsertCustomRule &&
        window.velance?.data?.deleteCustomRule,
    )
}

async function hydrateTrackingCaches(days = CACHE_DAYS) {
    const userId = getCurrentUserId()
    const fallbackAmbient = loadDateCacheFallback(getAmbientCacheKey(userId))
    const fallbackMedia = loadDateCacheFallback(getMediaCacheKey(userId))
    const fallbackBrowserEvents = loadDateCacheFallback(getBrowserEventCacheKey(userId))
    const fallbackRules = (() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(getCustomRulesKey(userId)) || '{}')
            return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
            return {}
        }
    })()

    if (!hasAmbientDataBridge()) {
        ambientCacheRef.value = fallbackAmbient
        mediaCacheRef.value = fallbackMedia
        browserEventCacheRef.value = fallbackBrowserEvents
        const aiLearnedFallback = getAILearnedRules(userId)
        aiLearnedRulesRef.value = aiLearnedFallback
        customRulesRef.value = { ...aiLearnedFallback, ...fallbackRules }
        updateTodayRefs()
        hydrated = true
        hydratedUserId = userId
        return
    }

    try {
        await ensureTrackingClassificationVersion(userId)

        const requestedKeys = buildRecentDateKeys(days)
        let ambientEntries = []
        let mediaEntries = []
        let browserEvents = []
        let nextCustomRules = fallbackRules

        if (hasCombinedRangeBridge()) {
            const combined = await getCombinedTrackingRange(requestedKeys)
            ambientEntries = Array.isArray(combined?.ambient) ? combined.ambient : []
            mediaEntries = Array.isArray(combined?.media) ? combined.media : []
            browserEvents = Array.isArray(combined?.browserEvents) ? combined.browserEvents : []
        } else {
            ambientEntries = await getAmbientRange(requestedKeys)
            mediaEntries = hasMediaDataBridge() ? await getMediaRange(requestedKeys) : []
            browserEvents = hasBrowserEventDataBridge() ? await getBrowserEventRange(requestedKeys) : []
        }

        if (hasCustomRulesBridge()) {
            nextCustomRules = {
                ...fallbackRules,
                ...(await getCustomRulesData() || {}),
            }
        }
        // AI-learned rules sit behind user rules — user always wins on same key
        const aiLearned = getAILearnedRules(userId)
        aiLearnedRulesRef.value = aiLearned
        customRulesRef.value = { ...aiLearned, ...nextCustomRules }

        setCacheEntries(ambientCacheRef, getAmbientCacheKey(userId), mergeDateEntries(ambientEntries, flattenDateCache(fallbackAmbient)))
        setCacheEntries(mediaCacheRef, getMediaCacheKey(userId), mergeDateEntries(mediaEntries, flattenDateCache(fallbackMedia)))
        setCacheEntries(
            browserEventCacheRef,
            getBrowserEventCacheKey(userId),
            mergeDateEntries(
                browserEvents.map((entry) => normalizeTrackedBrowserEvent(entry)),
                flattenDateCache(fallbackBrowserEvents).map((entry) => normalizeTrackedBrowserEvent(entry)),
            ),
        )

        try {
            localStorage.setItem(getCustomRulesKey(userId), JSON.stringify(customRulesRef.value || {}))
        } catch {
        }
    } catch (error) {
        console.warn('[Velance] Tracking cache hydrate fell back to local cache:', error)
        ambientCacheRef.value = fallbackAmbient
        mediaCacheRef.value = fallbackMedia
        browserEventCacheRef.value = fallbackBrowserEvents
        customRulesRef.value = fallbackRules
        updateTodayRefs()
    } finally {
        hydrated = true
        hydratedUserId = userId
    }
}

export function getGoals() {
    const key = getWorkspaceScopedKey(GOALS_KEY, getCurrentUserId())
    try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
}

export function setGoal(type, minutes) {
    const goals = getGoals()
    goals[type] = { minutes, setAt: Date.now() }
    const key = getWorkspaceScopedKey(GOALS_KEY, getCurrentUserId())
    try { localStorage.setItem(key, JSON.stringify(goals)) } catch {}
}

function requestCloudSync(reason = 'tracking') {
    try {
        window.dispatchEvent(new CustomEvent('velance:cloud-sync-request', {
            detail: { reason },
        }))
    } catch {
    }
}

export async function setCustomRule(appOrSite, { category, subcategory, color, productive, lane = '' }) {
    const key = appOrSite.trim().toLowerCase()
    if (!key) return
    if (isBrowserShellRuleMatch(key)) {
        await removeCustomRule(key)
        return
    }

    const nextRule = {
        category,
        subcategory,
        color: color || '#8E95A3',
        productive,
        lane: String(lane || ''),
    }

    if (hasCustomRulesBridge()) {
        customRulesRef.value = await saveCustomRule(key, nextRule)
        await reclassifyTrackingHistory()
    } else {
        customRulesRef.value = {
            ...customRulesRef.value,
            [key]: nextRule,
        }
    }

    try {
        localStorage.setItem(getCustomRulesKey(), JSON.stringify(customRulesRef.value || {}))
    } catch {
    }

    await hydrateTrackingCaches()
    await clearInsightCache()
    requestCloudSync('custom-rules')
}

export async function removeCustomRule(appOrSite) {
    const key = appOrSite.trim().toLowerCase()
    if (!key) return

    if (hasCustomRulesBridge()) {
        customRulesRef.value = await deleteCustomRuleData(key)
        await reclassifyTrackingHistory()
    } else {
        const nextRules = { ...customRulesRef.value }
        delete nextRules[key]
        customRulesRef.value = nextRules
    }

    try {
        localStorage.setItem(getCustomRulesKey(), JSON.stringify(customRulesRef.value || {}))
    } catch {
    }

    await hydrateTrackingCaches()
    await clearInsightCache()
    requestCloudSync('custom-rules')
}

export function getCustomRules() {
    return customRulesRef.value
}

export function classifyActivity(appName, windowTitle = '', browserUrl = '') {
    return sharedClassifyActivity(appName, windowTitle, browserUrl, customRulesRef.value)
}

// ─── AI classification helpers ────────────────────────────────────────────────

export function getAILearnedClassifications() {
    return aiLearnedRulesRef.value
}

export function getAIClassificationCacheStats() {
    return getAICacheStats(getCurrentUserId())
}

export function resetAILearnedClassifications() {
    const userId = getCurrentUserId()
    clearAILearnedRules(userId)
    aiLearnedRulesRef.value = {}
    // Rebuild customRules keeping only user-defined rules
    const userRules = Object.fromEntries(
        Object.entries(customRulesRef.value).filter(([, v]) => !v.isAILearned),
    )
    customRulesRef.value = userRules
}

/**
 * Scan recent unclear/low-confidence entries and improve them via AI.
 * Reloads learned rules immediately so new classifications apply in this session.
 *
 * @param {object} aiSettings  — result of normalizeAiSettings() from aiProvider.js
 * @param {object} opts
 * @param {number} opts.maxNew      — max new classifications to request (default 20)
 * @param {number} opts.daysBack    — how many days of history to scan (default 7)
 * @returns {Promise<{ learned, skipped, failed }>}
 */
export async function runAIClassificationImprovement(aiSettings = {}, { maxNew = 20, daysBack = 7 } = {}) {
    const userId = getCurrentUserId()
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000
    const candidates = Object.values(ambientCacheRef.value)
        .flat()
        .filter((e) => e && (!e.ts || e.ts >= cutoff))

    const stats = await improveUnclearClassifications(candidates, aiSettings, userId, { maxNew })

    if (stats.learned > 0) {
        const freshLearned = getAILearnedRules(userId)
        aiLearnedRulesRef.value = freshLearned
        const userRules = Object.fromEntries(
            Object.entries(customRulesRef.value).filter(([, v]) => !v.isAILearned),
        )
        customRulesRef.value = { ...freshLearned, ...userRules }
    }

    return stats
}

export { buildAILookupKey }


export function useAmbientTracker() {
    async function attachListener() {
        const activeUserId = getCurrentUserId()
        if (!hydrated || hydratedUserId !== activeUserId) {
            await hydrateTrackingCaches()
        }

        if (listenerAttached) return
        listenerAttached = true

        window.velance?.onAmbientData?.(handleAmbientChunk)
        window.velance?.onMediaData?.(handleMediaChunk)
        window.velance?.onProductivityPulse?.((data) => {
            liveSnapshotRef.value = {
                ts: data?.ts || Date.now(),
                app: normalizeObservedAppName(data?.app || '') || 'Unknown',
                title: data?.title || '',
                browserUrl: data?.url || '',
            }
        })

        if (!beforeUnloadHandler) {
            beforeUnloadHandler = () => {
                window.velance?.flushAmbient?.()
            }
            window.addEventListener('beforeunload', beforeUnloadHandler)
        }

        if (!refreshTimer && hasAmbientDataBridge()) {
            refreshTimer = setInterval(() => {
                void refreshToday()
            }, 15000)
        }
    }

    function detachListener({ clearCache = false } = {}) {
        window.velance?.removeAmbientListener?.()
        window.velance?.removeMediaListener?.()
        window.velance?.removeProductivityPulseListener?.()
        listenerAttached = false

        if (refreshTimer) {
            clearInterval(refreshTimer)
            refreshTimer = null
        }

        if (beforeUnloadHandler) {
            window.removeEventListener('beforeunload', beforeUnloadHandler)
            beforeUnloadHandler = null
        }

        if (clearCache) {
            todayEntriesRef.value = []
            todayMediaEntriesRef.value = []
            todayBrowserEventsRef.value = []
            ambientCacheRef.value = {}
            mediaCacheRef.value = {}
            browserEventCacheRef.value = {}
            customRulesRef.value = {}
            liveSnapshotRef.value = null
            hydrated = false
            hydratedUserId = null
        }
    }

    function handleAmbientChunk(data) {
        if (!data?.app || !data.duration) return

        const entry = normalizeAmbientEntryPayload({
            ...data,
            browserUrl: data.browserUrl ?? data.url ?? '',
        }, {
            customRules: customRulesRef.value,
            preferProvidedClassification: true,
        })

        if (isInternalTrackingActivity(entry)) return

        const dayEntries = [...(ambientCacheRef.value[entry.date] || [])]
        const existingIndex = dayEntries.findIndex((item) => item.id === entry.id)
        if (existingIndex >= 0) dayEntries[existingIndex] = entry
        else dayEntries.push(entry)
        updateCacheForDate(ambientCacheRef, getAmbientCacheKey(), entry.date, dayEntries)
    }

    function handleMediaChunk(data) {
        if (!data?.sourceApp || !data.duration) return

        const entry = normalizeBackgroundMediaPayload(data, { customRules: customRulesRef.value })
        const dayEntries = [...(mediaCacheRef.value[entry.date] || [])]
        const existingIndex = dayEntries.findIndex((item) => item.id === entry.id)
        if (existingIndex >= 0) dayEntries[existingIndex] = entry
        else dayEntries.push(entry)
        updateCacheForDate(mediaCacheRef, getMediaCacheKey(), entry.date, dayEntries)
    }

    function getToday() {
        return [...todayEntriesRef.value]
    }

    function getTodayMedia() {
        return [...todayMediaEntriesRef.value]
    }

    function getTodayBrowserEvents() {
        return [...todayBrowserEventsRef.value]
            .map((entry) => normalizeTrackedBrowserEvent(entry))
            .sort((a, b) => a.ts - b.ts)
    }

    function getEntriesForDate(dateKey, options = {}) {
        const key = String(dateKey || '').trim()
        if (!key) return []
        return filterMeaningfulEntries([...(ambientCacheRef.value[key] || [])], options)
            .sort((a, b) => a.ts - b.ts)
    }

    function getMediaForDate(dateKey) {
        const key = String(dateKey || '').trim()
        if (!key) return []
        return [...(mediaCacheRef.value[key] || [])].sort((a, b) => a.ts - b.ts)
    }

    function getBrowserEventsForDate(dateKey) {
        const key = String(dateKey || '').trim()
        if (!key) return []
        return [...(browserEventCacheRef.value[key] || [])]
            .map((entry) => normalizeTrackedBrowserEvent(entry))
            .sort((a, b) => a.ts - b.ts)
    }

    function getEntriesForDateKeys(dateKeys = [], options = {}) {
        const keys = Array.isArray(dateKeys) ? dateKeys : []
        if (!keys.length) return []

        const keySet = new Set(keys)
        return filterMeaningfulEntries(
            Object.entries(ambientCacheRef.value)
                .filter(([dateKey]) => keySet.has(dateKey))
                .flatMap(([, entries]) => Array.isArray(entries) ? entries : []),
            options,
        ).sort((a, b) => a.ts - b.ts)
    }

    function getMediaForDateKeys(dateKeys = []) {
        const keys = Array.isArray(dateKeys) ? dateKeys : []
        if (!keys.length) return []
        const keySet = new Set(keys)
        return Object.entries(mediaCacheRef.value)
            .filter(([dateKey]) => keySet.has(dateKey))
            .flatMap(([, entries]) => Array.isArray(entries) ? entries : [])
            .sort((a, b) => a.ts - b.ts)
    }

    function getBrowserEventsForDateKeys(dateKeys = []) {
        const keys = Array.isArray(dateKeys) ? dateKeys : []
        if (!keys.length) return []
        const keySet = new Set(keys)
        return Object.entries(browserEventCacheRef.value)
            .filter(([dateKey]) => keySet.has(dateKey))
            .flatMap(([, entries]) => Array.isArray(entries) ? entries : [])
            .map((entry) => normalizeTrackedBrowserEvent(entry))
            .sort((a, b) => a.ts - b.ts)
    }

    function getRange(days = 7) {
        const result = []
        for (let i = 0; i < days; i++) {
            const date = new Date()
            date.setDate(date.getDate() - i)
            const key = getDateKey(date)
            result.push(...(ambientCacheRef.value[key] || []))
        }
        return result
    }

    function getCategoryBreakdown(entries, options = {}) {
        const visibleEntries = filterMeaningfulEntries(entries, options)
        const map = {}
        for (const entry of visibleEntries) {
            const category = entry.category || 'Other'
            if (!map[category]) {
                map[category] = {
                    category,
                    color: entry.color || CATEGORY_COLORS[category] || '#8E95A3',
                    seconds: 0,
                    productive: entry.productive,
                    laneTotals: { productive: 0, supporting: 0, unclear: 0, distracting: 0 },
                }
            }
            const lane = getAmbientLane(entry)
            map[category].seconds += Number(entry.duration || 0)
            map[category].laneTotals[lane] = (map[category].laneTotals[lane] || 0) + Number(entry.duration || 0)
        }

        return Object.values(map)
            .map((value) => {
                const lane = getDisplayLaneForSummary({
                    category: value.category,
                    productive: value.productive,
                    laneTotals: value.laneTotals,
                })
                return {
                    ...value,
                    lane,
                    productive: laneToProductive(lane),
                    minutes: toDisplayMinutes(value.seconds),
                }
            })
            .sort((a, b) => b.seconds - a.seconds)
    }

    function getAppBreakdown(entries, options = {}) {
        const limit = Number.isFinite(options?.limit) ? Number(options.limit) : null
        const sortBy = options?.sortBy || 'seconds'
        const visibleEntries = filterMeaningfulEntries(entries, options)
        const map = {}

        for (const entry of visibleEntries) {
            const normalizedApp = entry.appGroup || normalizeObservedAppName(entry.app) || 'Unknown'
            if (!map[normalizedApp]) {
                map[normalizedApp] = {
                    app: normalizedApp,
                    seconds: 0,
                    switches: 0,
                    chunkCount: 0,
                    firstTs: Number.MAX_SAFE_INTEGER,
                    lastTs: 0,
                    weightedConfidence: 0,
                    browserContexts: new Set(),
                    browserSeconds: 0,
                    categoryTotals: {},
                    contextTotals: {},
                    laneTotals: { productive: 0, supporting: 0, unclear: 0, distracting: 0 },
                }
            }

            const seconds = Number(entry.duration || 0)
            const category = entry.category || 'Other'
            const contextLabel = entry.browserHost || entry.contextLabel || normalizedApp
            const lane = getAmbientLane(entry)
            const group = map[normalizedApp]

            group.seconds += seconds
            group.switches += Number(entry.switches || 0)
            group.chunkCount += 1
            group.firstTs = Math.min(group.firstTs, Number(entry.ts || Date.now()))
            group.lastTs = Math.max(group.lastTs, Number(entry.endTs || entry.ts || 0))
            group.weightedConfidence += Number(entry.confidence || 0) * seconds
            group.contextTotals[contextLabel] = (group.contextTotals[contextLabel] || 0) + seconds
            if (entry.browserHost) group.browserContexts.add(entry.browserHost)
            if (entry.browserHost || entry.browserPage || entry.browserUrl) {
                group.browserSeconds += seconds
            }

            if (!group.categoryTotals[category]) {
                group.categoryTotals[category] = {
                    seconds: 0,
                    color: entry.color || CATEGORY_COLORS[category] || '#8E95A3',
                    productive: entry.productive ?? null,
                }
            }
            group.categoryTotals[category].seconds += seconds

            group.laneTotals[lane] = (group.laneTotals[lane] || 0) + seconds
        }

        const ranked = sortBreakdownRows(
            Object.values(map)
            .map((value) => {
                const dominantCategoryEntry = Object.entries(value.categoryTotals)
                    .sort((left, right) => right[1].seconds - left[1].seconds)[0]
                const dominantContextEntry = Object.entries(value.contextTotals)
                    .sort((left, right) => right[1] - left[1])[0]
                const dominantCategory = dominantCategoryEntry?.[0] || 'Other'
                const dominantMeta = dominantCategoryEntry?.[1] || { color: CATEGORY_COLORS.Other, productive: null }
                const seconds = Number(value.seconds || 0)
                const productiveSeconds = Number(value.laneTotals.productive || 0)
                const distractingSeconds = Number(value.laneTotals.distracting || 0)
                const neutralSeconds = Number(value.laneTotals.supporting || 0) + Number(value.laneTotals.unclear || 0)
                const dominantLane = getDisplayLaneForSummary({
                    category: dominantCategory,
                    productive: dominantMeta.productive,
                    subcategory: dominantContextEntry?.[0] || dominantCategory,
                    contextLabel: dominantContextEntry?.[0] || value.app,
                    appName: value.app,
                    laneTotals: value.laneTotals,
                })

                return {
                    app: value.app,
                    category: dominantCategory,
                    subcategory: dominantContextEntry?.[0] || dominantCategory,
                    contextLabel: dominantContextEntry?.[0] || value.app,
                    color: dominantMeta.color,
                    productive: laneToProductive(dominantLane) ?? getDominantProductivityState({
                        productive: productiveSeconds,
                        distracting: distractingSeconds,
                        neutral: neutralSeconds,
                    }),
                    dominantLane,
                    seconds,
                    switches: value.switches,
                    minutes: toDisplayMinutes(seconds),
                    chunkCount: value.chunkCount,
                    firstTs: value.firstTs === Number.MAX_SAFE_INTEGER ? 0 : value.firstTs,
                    lastTs: value.lastTs,
                    confidence: seconds > 0 ? Number((value.weightedConfidence / seconds).toFixed(2)) : 0,
                    productiveShare: seconds > 0 ? Number((productiveSeconds / seconds).toFixed(4)) : 0,
                    distractingShare: seconds > 0 ? Number((distractingSeconds / seconds).toFixed(4)) : 0,
                    browserContextCount: value.browserContexts.size,
                    browserShare: seconds > 0 ? Number((value.browserSeconds / seconds).toFixed(4)) : 0,
                }
            }),
            sortBy,
            (row) => row.app,
        )

        return limit === null ? ranked : ranked.slice(0, limit)
    }

    function getBrowserContextBreakdown(entries, options = {}) {
        const limit = Number.isFinite(options?.limit) ? Number(options.limit) : null
        const groupBy = options?.groupBy === 'page' ? 'page' : 'host'
        const sortBy = options?.sortBy || 'seconds'
        const visibleEntries = filterMeaningfulEntries(entries, options)
            .filter((entry) => entry?.browserHost || entry?.browserPage || entry?.browserUrl)

        const map = {}
        for (const entry of visibleEntries) {
            const host = String(entry.browserHost || '').trim()
            const page = String(entry.browserPage || entry.contextLabel || '').trim()
            const label = groupBy === 'page'
                ? (page || host || normalizeObservedAppName(entry.app) || 'Browser context')
                : (host || normalizeObservedAppName(entry.app) || 'Browser')

            if (!map[label]) {
                map[label] = {
                    label,
                    host: host || label,
                    page: page || label,
                    appTotals: {},
                    categoryTotals: {},
                    laneTotals: { productive: 0, supporting: 0, unclear: 0, distracting: 0 },
                    seconds: 0,
                    switches: 0,
                    chunkCount: 0,
                    firstTs: Number.MAX_SAFE_INTEGER,
                    lastTs: 0,
                    weightedConfidence: 0,
                }
            }

            const seconds = Number(entry.duration || 0)
            const appName = entry.appGroup || normalizeObservedAppName(entry.app) || 'Browser'
            const category = entry.category || 'Other'
            const lane = getAmbientLane(entry)
            const group = map[label]

            group.seconds += seconds
            group.switches += Number(entry.switches || 0)
            group.chunkCount += 1
            group.firstTs = Math.min(group.firstTs, Number(entry.ts || Date.now()))
            group.lastTs = Math.max(group.lastTs, Number(entry.endTs || entry.ts || 0))
            group.weightedConfidence += Number(entry.confidence || 0) * seconds
            group.appTotals[appName] = (group.appTotals[appName] || 0) + seconds
            group.laneTotals[lane] = (group.laneTotals[lane] || 0) + seconds

            if (!group.categoryTotals[category]) {
                group.categoryTotals[category] = {
                    seconds: 0,
                    color: entry.color || CATEGORY_COLORS[category] || '#8E95A3',
                }
            }
            group.categoryTotals[category].seconds += seconds
        }

        const ranked = sortBreakdownRows(
            Object.values(map)
            .map((value) => {
                const dominantCategoryEntry = Object.entries(value.categoryTotals)
                    .sort((left, right) => right[1].seconds - left[1].seconds)[0]
                const dominantAppEntry = Object.entries(value.appTotals)
                    .sort((left, right) => right[1] - left[1])[0]
                const seconds = Number(value.seconds || 0)
                const productiveSeconds = Number(value.laneTotals.productive || 0)
                const distractingSeconds = Number(value.laneTotals.distracting || 0)
                const dominantCategory = dominantCategoryEntry?.[0] || 'Other'
                const dominantLane = getDisplayLaneForSummary({
                    category: dominantCategory,
                    productive: dominantCategoryEntry?.[1]?.productive ?? null,
                    subcategory: value.page || value.label,
                    contextLabel: value.page || value.label,
                    appName: dominantAppEntry?.[0] || 'Browser',
                    laneTotals: value.laneTotals,
                })

                return {
                    label: value.label,
                    host: value.host,
                    page: value.page,
                    app: dominantAppEntry?.[0] || 'Browser',
                    category: dominantCategory,
                    color: dominantCategoryEntry?.[1]?.color || CATEGORY_COLORS.Other,
                    productive: laneToProductive(dominantLane) ?? getDominantProductivityState({
                        productive: productiveSeconds,
                        distracting: distractingSeconds,
                        neutral: value.laneTotals.supporting + value.laneTotals.unclear,
                    }),
                    dominantLane,
                    seconds,
                    switches: value.switches,
                    confidence: seconds > 0 ? Number((value.weightedConfidence / seconds).toFixed(2)) : 0,
                    minutes: toDisplayMinutes(seconds),
                    chunkCount: value.chunkCount,
                    firstTs: value.firstTs === Number.MAX_SAFE_INTEGER ? 0 : value.firstTs,
                    lastTs: value.lastTs,
                    productiveShare: seconds > 0 ? Number((productiveSeconds / seconds).toFixed(4)) : 0,
                    distractingShare: seconds > 0 ? Number((distractingSeconds / seconds).toFixed(4)) : 0,
                }
            }),
            sortBy,
            (row) => row.label,
        )

        return limit === null ? ranked : ranked.slice(0, limit)
    }

    function getMediaBreakdown(entries, options = {}) {
        const limit = Number.isFinite(options?.limit) ? Number(options.limit) : null
        const sortBy = options?.sortBy || 'seconds'
        const visibleEntries = Array.isArray(entries) ? entries : []
        const map = {}

        for (const entry of visibleEntries) {
            const label = entry.contextLabel || entry.trackTitle || entry.sourceApp || 'Background media'
            if (!map[label]) {
                map[label] = {
                    label,
                    sourceApp: entry.sourceApp || 'Media',
                    category: entry.category || 'Other',
                    lane: entry.lane || 'unclear',
                    color: entry.color || CATEGORY_COLORS.Other,
                    seconds: 0,
                    chunkCount: 0,
                    firstTs: Number.MAX_SAFE_INTEGER,
                    lastTs: 0,
                    playbackState: entry.playbackState || 'Unknown',
                    artist: entry.artist || '',
                    album: entry.album || '',
                }
            }
            map[label].seconds += Number(entry.duration || 0)
            map[label].chunkCount += 1
            map[label].firstTs = Math.min(map[label].firstTs, Number(entry.ts || Date.now()))
            map[label].lastTs = Math.max(map[label].lastTs, Number(entry.endTs || entry.ts || 0))
        }

        const ranked = sortBreakdownRows(
            Object.values(map)
                .map((value) => ({
                    ...value,
                    minutes: toDisplayMinutes(value.seconds),
                    firstTs: value.firstTs === Number.MAX_SAFE_INTEGER ? 0 : value.firstTs,
                })),
            sortBy,
            (row) => row.label,
        )

        return limit === null ? ranked : ranked.slice(0, limit)
    }

    function getTrackingDiagnostics(entries, options = {}) {
        const visibleEntries = filterMeaningfulEntries(entries, options)
        if (!visibleEntries.length) {
            return {
                chunkCount: 0,
                trackedSeconds: 0,
                avgConfidence: 0,
                browserChunks: 0,
                customRuleChunks: 0,
                productiveSeconds: 0,
                supportingSeconds: 0,
                unclearSeconds: 0,
                distractingSeconds: 0,
                uniqueApps: 0,
                uniqueBrowserHosts: 0,
                firstTs: 0,
                lastTs: 0,
            }
        }

        const apps = new Set()
        const hosts = new Set()
        let trackedSeconds = 0
        let weightedConfidence = 0
        let browserChunks = 0
        let customRuleChunks = 0
        let productiveSeconds = 0
        let supportingSeconds = 0
        let unclearSeconds = 0
        let distractingSeconds = 0
        let firstTs = Number.MAX_SAFE_INTEGER
        let lastTs = 0

        for (const entry of visibleEntries) {
            const seconds = Number(entry.duration || 0)
            const lane = getAmbientLane(entry)
            trackedSeconds += seconds
            weightedConfidence += Number(entry.confidence || 0) * seconds
            apps.add(entry.appGroup || normalizeObservedAppName(entry.app) || 'Unknown')
            if (entry.browserHost) hosts.add(entry.browserHost)
            if (entry.browserHost || entry.browserPage || entry.browserUrl) browserChunks += 1
            if (entry.isCustom) customRuleChunks += 1

            if (lane === 'productive') productiveSeconds += seconds
            else if (lane === 'supporting') supportingSeconds += seconds
            else if (lane === 'distracting') distractingSeconds += seconds
            else unclearSeconds += seconds

            firstTs = Math.min(firstTs, Number(entry.ts || Date.now()))
            lastTs = Math.max(lastTs, Number(entry.endTs || entry.ts || 0))
        }

        return {
            chunkCount: visibleEntries.length,
            trackedSeconds,
            avgConfidence: trackedSeconds > 0 ? Number((weightedConfidence / trackedSeconds).toFixed(2)) : 0,
            browserChunks,
            customRuleChunks,
            productiveSeconds,
            supportingSeconds,
            unclearSeconds,
            distractingSeconds,
            uniqueApps: apps.size,
            uniqueBrowserHosts: hosts.size,
            firstTs: Number.isFinite(firstTs) ? firstTs : 0,
            lastTs,
        }
    }

    function getBrowserEventSummary(entries = []) {
        return buildBrowserEvidenceSummary({
            browserEvents: Array.isArray(entries) ? entries.map((entry) => normalizeTrackedBrowserEvent(entry)) : [],
            ambientEntries: [],
            padMs: 0,
            limit: 5,
        })
    }

    function getRecentBrowserEvents(entries = [], options = {}) {
        const limit = Number.isFinite(options?.limit) ? Number(options.limit) : 8
        return [...(Array.isArray(entries) ? entries : [])]
            .map((entry) => normalizeTrackedBrowserEvent(entry))
            .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
            .slice(0, limit)
    }

    function getHourlyBreakdown(entries, options = {}) {
        const visibleEntries = filterMeaningfulEntries(entries, options)
        const buckets = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            productiveMin: 0,
            supportingMin: 0,
            unclearMin: 0,
            distractingMin: 0,
            neutralMin: 0,
            totalMin: 0,
        }))

        for (const entry of visibleEntries) {
            const hour = new Date(entry.ts).getHours()
            const mins = Number(entry.duration || 0) / 60
            const lane = getAmbientLane(entry)
            buckets[hour].totalMin += mins
            if (lane === 'productive') buckets[hour].productiveMin += mins
            else if (lane === 'supporting') buckets[hour].supportingMin += mins
            else if (lane === 'distracting') buckets[hour].distractingMin += mins
            else buckets[hour].unclearMin += mins
        }

        return buckets.map((bucket) => ({
            ...bucket,
            productiveMin: Math.round(bucket.productiveMin),
            supportingMin: Math.round(bucket.supportingMin),
            unclearMin: Math.round(bucket.unclearMin),
            distractingMin: Math.round(bucket.distractingMin),
            neutralMin: Math.round(bucket.supportingMin + bucket.unclearMin),
            totalMin: Math.round(bucket.totalMin),
        }))
    }

    function getProductivityPulse(entries, options = {}) {
        const visibleEntries = filterMeaningfulEntries(entries, options)
        if (!visibleEntries.length) return null
        const totalSec = visibleEntries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0)
        if (totalSec === 0) return null

        let score = 0
        visibleEntries.forEach((entry) => {
            const seconds = Number(entry.duration || 0)
            const lane = getAmbientLane(entry)
            if (lane === 'productive') score += seconds * 2
            else if (lane === 'supporting') score += seconds * 0.9
            else if (lane === 'unclear') score += seconds * 0.35
            else score -= seconds
        })

        const totalSwitches = visibleEntries.reduce((sum, entry) => sum + Number(entry.switches || 0), 0)
        if (totalSwitches > 20) score -= totalSec * 0.1
        else if (totalSwitches > 10) score -= totalSec * 0.05

        return Math.max(0, Math.min(100, Math.round((score / (totalSec * 2)) * 100)))
    }

    function getTopDistractors(entries, limit = 5, options = {}) {
        const visibleEntries = filterMeaningfulEntries(entries, options)
        const map = {}
        for (const entry of visibleEntries.filter((item) => getAmbientLane(item) === 'distracting')) {
            const key = entry.subcategory || normalizeObservedAppName(entry.app) || entry.contextLabel || 'Distractor'
            if (!map[key]) {
                map[key] = { label: key, app: normalizeObservedAppName(entry.app), category: entry.category, color: entry.color, seconds: 0 }
            }
            map[key].seconds += Number(entry.duration || 0)
        }
        return Object.values(map)
            .sort((a, b) => b.seconds - a.seconds)
            .slice(0, limit)
            .map((value) => ({ ...value, minutes: toDisplayMinutes(value.seconds) }))
    }

    function getInsights(entries, options = {}) {
        const visibleEntries = filterMeaningfulEntries(entries, options)
        if (!visibleEntries.length) return []
        const pulse = getProductivityPulse(visibleEntries, options)
        const distractors = getTopDistractors(visibleEntries, 1, options)
        return [
            pulse !== null ? { icon: 'Pulse', text: `Ambient pulse landed at ${pulse}/100.`, type: pulse >= 70 ? 'positive' : 'warning' } : null,
            distractors[0] ? { icon: 'Drift', text: `${distractors[0].label} was the biggest off-track pull.`, type: 'warning' } : null,
        ].filter(Boolean)
    }

    function getWeeklyTrend() {
        return buildRecentDateKeys(7).reverse().map((key) => {
            const entries = filterMeaningfulEntries(ambientCacheRef.value[key] || [])
            return {
                date: key,
                label: new Date(`${key}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
                pulse: getProductivityPulse(entries),
                totalMin: Math.round(entries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0) / 60),
                productiveMin: Math.round(entries
                    .filter((entry) => getAmbientLane(entry) === 'productive')
                    .reduce((sum, entry) => sum + Number(entry.duration || 0), 0) / 60),
            }
        })
    }

    function getDailyGoalProgress() {
        const goals = getGoals()
        if (!goals.daily) return null
        const productiveMins = Math.round(
            filterMeaningfulEntries(todayEntriesRef.value)
                .filter((entry) => getAmbientLane(entry) === 'productive')
                .reduce((sum, entry) => sum + Number(entry.duration || 0), 0) / 60,
        )
        return {
            goal: goals.daily.minutes,
            achieved: productiveMins,
            pct: Math.min(Math.round((productiveMins / goals.daily.minutes) * 100), 100),
            done: productiveMins >= goals.daily.minutes,
        }
    }

    function getProductivityScore(entries, options = {}) {
        const visibleEntries = filterMeaningfulEntries(entries, options)
        const productive = visibleEntries
            .filter((entry) => getAmbientLane(entry) === 'productive')
            .reduce((sum, entry) => sum + Number(entry.duration || 0), 0)
        const total = visibleEntries.reduce((sum, entry) => sum + Number(entry.duration || 0), 0)
        return total > 0 ? Math.round((productive / total) * 100) : null
    }

    function getTodayTimeline(options = {}) {
        return filterMeaningfulEntries([...todayEntriesRef.value], options)
            .sort((a, b) => a.ts - b.ts)
            .map((entry) => ({ ...entry, app: normalizeObservedAppName(entry.app) }))
    }

    function getVisibleEntries(entries, options = {}) {
        return filterMeaningfulEntries(entries, options)
    }

    function getLiveSnapshot() {
        return liveSnapshotRef.value
    }

    async function refreshDates(dateKeys = []) {
        const requestedKeys = [...new Set((Array.isArray(dateKeys) ? dateKeys : []).map((key) => String(key || '').trim()).filter(Boolean))]
        if (!requestedKeys.length) return

        const activeUserId = getCurrentUserId()
        if (!hydrated || hydratedUserId !== activeUserId) {
            hydrated = false
            await hydrateTrackingCaches(Math.max(CACHE_DAYS, requestedKeys.length))
        }

        if (!hasAmbientDataBridge()) {
            updateTodayRefs()
            return
        }

        try {
            let ambientEntries = []
            let mediaEntries = []
            let browserEvents = []
            if (hasCombinedRangeBridge()) {
                const combined = await getCombinedTrackingRange(requestedKeys)
                ambientEntries = Array.isArray(combined?.ambient) ? combined.ambient : []
                mediaEntries = Array.isArray(combined?.media) ? combined.media : []
                browserEvents = Array.isArray(combined?.browserEvents) ? combined.browserEvents : []
            } else {
                ambientEntries = await getAmbientRange(requestedKeys)
                mediaEntries = hasMediaDataBridge() ? await getMediaRange(requestedKeys) : []
                browserEvents = hasBrowserEventDataBridge() ? await getBrowserEventRange(requestedKeys) : []
            }

            const groupedAmbient = {}
            ambientEntries.forEach((entry) => {
                const key = entry?.date || getDateKey(new Date(entry?.ts))
                if (!groupedAmbient[key]) groupedAmbient[key] = []
                groupedAmbient[key].push(entry)
            })
            const groupedMedia = {}
            mediaEntries.forEach((entry) => {
                const key = entry?.date || getDateKey(new Date(entry?.ts))
                if (!groupedMedia[key]) groupedMedia[key] = []
                groupedMedia[key].push(entry)
            })
            const groupedBrowserEvents = {}
            browserEvents.forEach((entry) => {
                const normalized = normalizeTrackedBrowserEvent(entry)
                const key = normalized?.date || getDateKey(new Date(normalized?.ts))
                if (!groupedBrowserEvents[key]) groupedBrowserEvents[key] = []
                groupedBrowserEvents[key].push(normalized)
            })

            requestedKeys.forEach((key) => {
                updateCacheForDate(ambientCacheRef, getAmbientCacheKey(activeUserId), key, mergeDateEntries(groupedAmbient[key] || [], ambientCacheRef.value[key] || []))
                updateCacheForDate(mediaCacheRef, getMediaCacheKey(activeUserId), key, mergeDateEntries(groupedMedia[key] || [], mediaCacheRef.value[key] || []))
                updateCacheForDate(
                    browserEventCacheRef,
                    getBrowserEventCacheKey(activeUserId),
                    key,
                    mergeDateEntries(groupedBrowserEvents[key] || [], browserEventCacheRef.value[key] || []),
                )
            })
        } catch (error) {
            console.warn('[Velance] Tracking range refresh fell back to cache:', error)
            updateTodayRefs()
        }
    }

    async function refreshDate(dateKey) {
        await refreshDates([dateKey])
    }

    async function refreshToday() {
        await refreshDate(getDateKey())
    }

    return {
        attachListener,
        detachListener,
        getToday,
        getTodayMedia,
        getTodayBrowserEvents,
        getEntriesForDate,
        getMediaForDate,
        getBrowserEventsForDate,
        getEntriesForDateKeys,
        getMediaForDateKeys,
        getBrowserEventsForDateKeys,
        getRange,
        getVisibleEntries,
        getCategoryBreakdown,
        getAppBreakdown,
        getBrowserContextBreakdown,
        getMediaBreakdown,
        getTrackingDiagnostics,
        getBrowserEventSummary,
        getRecentBrowserEvents,
        getTodayTimeline,
        getLiveSnapshot,
        getProductivityScore,
        getProductivityPulse,
        getHourlyBreakdown,
        getTopDistractors,
        getInsights,
        getWeeklyTrend,
        getDailyGoalProgress,
        refreshToday,
        refreshDate,
        refreshDates,
        classifyActivity,
        getGoals,
        setGoal,
        setCustomRule,
        removeCustomRule,
        getCustomRules,
        getAILearnedClassifications,
        getAIClassificationCacheStats,
        runAIClassificationImprovement,
        resetAILearnedClassifications,
    }
}
