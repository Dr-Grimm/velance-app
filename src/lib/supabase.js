import { createClient } from '@supabase/supabase-js'

const missingSupabaseUrl = 'https://auth-not-configured.velance.invalid'
const missingSupabaseAnonKey = 'missing-public-anon-key'

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || missingSupabaseUrl
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || missingSupabaseAnonKey
export const isSupabaseConfigured = Boolean(
  import.meta.env?.VITE_SUPABASE_URL &&
  import.meta.env?.VITE_SUPABASE_ANON_KEY
)
export const supabaseConfigMessage = isSupabaseConfigured
  ? ''
  : 'Authentication is not configured for this build. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before testing sign-in.'

if (!isSupabaseConfigured) {
  console.warn(`[Velance] ${supabaseConfigMessage}`)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
