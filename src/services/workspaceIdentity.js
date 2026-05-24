const LEGACY_PROJECT_REFS = []

function resolveSupabaseProjectRef() {
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL || ''
    const host = new URL(url).hostname
    return host.endsWith('.supabase.co') ? host.split('.')[0] : ''
  } catch {
    return ''
  }
}

const currentProjectRef = resolveSupabaseProjectRef() || 'local-project'

export const SUPABASE_AUTH_TOKEN_KEY = `sb-${currentProjectRef}-auth-token`
export const LEGACY_SUPABASE_AUTH_TOKEN_KEYS = LEGACY_PROJECT_REFS.map((ref) => `sb-${ref}-auth-token`)
export const DEFAULT_WORKSPACE_ID = 'local-user'

function safeParse(raw, fallback = null) {
  try {
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function normalizeWorkspaceId(value) {
  const normalized = String(value || '').trim()
  return normalized || DEFAULT_WORKSPACE_ID
}

export function getStoredSupabaseSession() {
  if (typeof localStorage === 'undefined') return null
  return safeParse(localStorage.getItem(SUPABASE_AUTH_TOKEN_KEY), null)
    || LEGACY_SUPABASE_AUTH_TOKEN_KEYS.map((key) => safeParse(localStorage.getItem(key), null)).find(Boolean)
    || null
}

export function getStoredWorkspaceId() {
  return normalizeWorkspaceId(getStoredSupabaseSession()?.user?.id)
}

export function resolveWorkspaceId(user = null) {
  if (typeof user === 'string') return normalizeWorkspaceId(user)
  return normalizeWorkspaceId(user?.id || getStoredWorkspaceId())
}

export function isDefaultWorkspaceId(workspaceId) {
  return normalizeWorkspaceId(workspaceId) === DEFAULT_WORKSPACE_ID
}

export function getWorkspaceScopedKey(name, workspaceId = resolveWorkspaceId()) {
  return `velance:${normalizeWorkspaceId(workspaceId)}:${String(name || '').trim()}`
}
