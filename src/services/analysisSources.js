const SOURCE_BADGE_META = {
  combined: {
    id: 'combined',
    label: 'Combined',
    description: 'Blends background tracking with focus-session signals.',
    tone: 'combined',
  },
  session: {
    id: 'session',
    label: 'Session-based',
    description: 'Powered by recorded focus sessions.',
    tone: 'session',
  },
  background: {
    id: 'background',
    label: 'Background-based',
    description: 'Powered by passive background activity tracking.',
    tone: 'background',
  },
  manual: {
    id: 'manual',
    label: 'Manual',
    description: 'Powered by user-created tasks, habits, or settings.',
    tone: 'manual',
  },
}

export const ANALYTICS_TAB_SOURCES = {
  overview: {
    ids: ['combined'],
    note: 'Blends focus sessions with background activity.',
  },
  focus: {
    ids: ['session', 'background'],
    note: 'Switch between recorded focus sessions and background-derived depth windows.',
  },
  apps: {
    ids: ['background'],
    note: 'Driven by normalized background tracking.',
  },
  fatigue: {
    ids: ['session', 'background'],
    note: 'Switch between session strain and background load.',
  },
  habits: {
    ids: ['manual', 'session'],
    note: 'Switch between habit targets and session performance.',
  },
}

export const ACTIVITY_VIEW_SOURCES = {
  ids: ['combined'],
  note: 'Activity aligns passive background tracking with any focus sessions recorded on the same date.',
}

export function buildSourceBadges(ids = []) {
  return ids
    .map((id) => SOURCE_BADGE_META[id])
    .filter(Boolean)
}
