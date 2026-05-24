import { formatLocalDateKey, getRecentLocalDateKeys, getTodayLocalDateKey, shiftLocalDateKey } from './dateKey.js'

function padTimeSafeDate(value) {
  return Number.isFinite(value) ? value : 0
}

export function parseLocalDateKey(dateKey = getTodayLocalDateKey()) {
  const [year, month, day] = String(dateKey || '')
    .split('-')
    .map((token) => Number.parseInt(token, 10))

  if (!year || !month || !day) {
    return new Date()
  }

  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

export { getTodayLocalDateKey }

export function shiftDateKey(dateKey = getTodayLocalDateKey(), offset = 0) {
  return shiftLocalDateKey(offset, parseLocalDateKey(dateKey))
}

export function buildDateWindow(anchorDateKey = getTodayLocalDateKey(), days = 7) {
  return getRecentLocalDateKeys(Math.max(1, Number(days) || 1), parseLocalDateKey(anchorDateKey))
}

export function formatDateKeyLabel(dateKey = getTodayLocalDateKey(), options = {}) {
  return parseLocalDateKey(dateKey).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...options,
  })
}

export function formatDateRangeLabel(dateKeys = []) {
  if (!Array.isArray(dateKeys) || !dateKeys.length) return 'No range selected'
  const first = parseLocalDateKey(dateKeys[0])
  const last = parseLocalDateKey(dateKeys[dateKeys.length - 1])

  const sameYear = first.getFullYear() === last.getFullYear()
  const sameMonth = sameYear && first.getMonth() === last.getMonth()

  if (sameMonth) {
    return `${first.toLocaleDateString('en-US', { month: 'short' })} ${first.getDate()}-${last.getDate()}`
  }

  if (sameYear) {
    return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  }

  return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export function formatAnchorLabel(dateKey = getTodayLocalDateKey()) {
  return formatDateKeyLabel(dateKey, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function isFutureDateKey(dateKey = getTodayLocalDateKey(), todayKey = getTodayLocalDateKey()) {
  return String(dateKey || '') > String(todayKey || '')
}

export function clampRangeAnchor(dateKey = getTodayLocalDateKey(), todayKey = getTodayLocalDateKey()) {
  if (isFutureDateKey(dateKey, todayKey)) return todayKey
  return formatLocalDateKey(parseLocalDateKey(dateKey))
}

export function getLocalDayRange(dateKey = getTodayLocalDateKey()) {
  const start = parseLocalDateKey(dateKey)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 1)

  return {
    start,
    end,
    startMs: padTimeSafeDate(start.getTime()),
    endMs: padTimeSafeDate(end.getTime()),
  }
}
