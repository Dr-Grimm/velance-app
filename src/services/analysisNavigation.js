import { formatLocalDateKey } from './dateKey.js'

export function getAnalyticsDateKeyFromSession(session = null) {
  return String(
    session?.date
      || formatLocalDateKey(session?.timestamp || session?.createdAt || Date.now()),
  )
}

export function getAnalyticsEventIdForSession(session = null, kind = 'focus') {
  const sessionId = String(session?.id || '')
  if (!sessionId) return ''

  if (kind === 'fatigue') return `fatigue-session-${sessionId}`
  if (kind === 'focus-start') return `focus-start-${sessionId}`
  return `focus-end-${sessionId}`
}

export function buildAnalyticsLocation({ dateKey = '', tab = 'activity', eventId = '' } = {}) {
  const query = {}
  if (dateKey) query.date = String(dateKey)
  if (tab) query.tab = String(tab)
  if (eventId) query.event = String(eventId)
  return {
    path: '/analytics',
    query,
  }
}
