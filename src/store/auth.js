import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from '../lib/supabase.js'
import { LEGACY_SUPABASE_AUTH_TOKEN_KEYS, SUPABASE_AUTH_TOKEN_KEY } from '../services/workspaceIdentity.js'

export const useAuthStore = defineStore('auth', () => {
    const user = ref(null)
    const token = ref(null)
    const isLoggedIn = computed(() => !!user.value)
    const loading = ref(false)
    const error = ref('')

    function clearError() {
        error.value = ''
    }

    function normalizeEmail(email = '') {
        return String(email).trim().toLowerCase()
    }

    function normalizeOtp(code = '') {
        return String(code).replace(/\s+/g, '').trim()
    }

    function normalizePassword(password = '') {
        return String(password)
    }

    function requireAuthConfigured() {
        if (isSupabaseConfigured) return true
        error.value = supabaseConfigMessage
        loading.value = false
        return false
    }

    async function checkSession() {
        if (!isSupabaseConfigured) {
            user.value = null
            token.value = null
            return false
        }
        try {
            const { data: { session }, error: err } = await supabase.auth.getSession()
            if (err) throw err
            if (session) {
                user.value = session.user
                token.value = session.access_token
                return true
            }
        } catch (e) {
            console.error('[Auth] checkSession error:', e)
        }
        user.value = null
        token.value = null
        return false
    }

    // Sends the configured Supabase email OTP code to the user's inbox.
    async function requestEmailCode({ email, username, mode = 'login' }) {
        loading.value = true; error.value = ''
        if (!requireAuthConfigured()) return { ok: false }
        try {
            const normalizedEmail = normalizeEmail(email)
            const options = {
                shouldCreateUser: mode === 'register',
                ...(username ? { data: { username, full_name: username } } : {}),
            }
            const { error: err } = await supabase.auth.signInWithOtp({
                email: normalizedEmail,
                options
            })
            loading.value = false
            if (err) { error.value = err.message; return { ok: false } }
            return { ok: true, requiresOTP: true, email: normalizedEmail }
        } catch (e) {
            error.value = e.message; loading.value = false; return { ok: false }
        }
    }

    async function register({ username, email }) {
        return requestEmailCode({ email, username, mode: 'register' })
    }

    async function login({ email }) {
        return requestEmailCode({ email, mode: 'login' })
    }

    async function registerWithPassword({ username, email, password }) {
        loading.value = true; error.value = ''
        if (!requireAuthConfigured()) return { ok: false }
        try {
            const normalizedEmail = normalizeEmail(email)
            const normalizedPassword = normalizePassword(password)
            const { data, error: err } = await supabase.auth.signUp({
                email: normalizedEmail,
                password: normalizedPassword,
                options: {
                    data: { username, full_name: username },
                },
            })

            loading.value = false
            if (err) { error.value = err.message; return { ok: false } }

            if (data?.session) {
                user.value = data.session.user || data.user || null
                token.value = data.session.access_token || null
                return { ok: true, sessionCreated: true, email: normalizedEmail }
            }

            return { ok: true, requiresConfirmation: true, email: normalizedEmail }
        } catch (e) {
            error.value = e.message; loading.value = false; return { ok: false }
        }
    }

    async function loginWithPassword({ email, password }) {
        loading.value = true; error.value = ''
        if (!requireAuthConfigured()) return false
        try {
            const normalizedEmail = normalizeEmail(email)
            const normalizedPassword = normalizePassword(password)
            const { data, error: err } = await supabase.auth.signInWithPassword({
                email: normalizedEmail,
                password: normalizedPassword,
            })

            loading.value = false
            if (err) { error.value = err.message; return false }

            user.value = data.user || data.session?.user || null
            token.value = data.session?.access_token || null
            return true
        } catch (e) {
            error.value = e.message; loading.value = false; return false
        }
    }

    async function resendSignupConfirmation({ email }) {
        loading.value = true; error.value = ''
        if (!requireAuthConfigured()) return { ok: false }
        try {
            const normalizedEmail = normalizeEmail(email)
            const { error: err } = await supabase.auth.resend({
                type: 'signup',
                email: normalizedEmail,
            })
            loading.value = false
            if (err) { error.value = err.message; return { ok: false } }
            return { ok: true, email: normalizedEmail }
        } catch (e) {
            error.value = e.message; loading.value = false; return { ok: false }
        }
    }

    async function verifyRegistrationOTP({ email, code }) {
        return verifyOTP({ email, code })
    }

    async function verifyOTP({ email, code }) {
        loading.value = true; error.value = ''
        if (!requireAuthConfigured()) return false
        try {
            const normalizedEmail = normalizeEmail(email)
            const normalizedCode = normalizeOtp(code)
            let res = await supabase.auth.verifyOtp({
                email: normalizedEmail,
                token: normalizedCode,
                type: 'email'
            })

            // If type 'email' fails (e.g. invalid token), and they are a brand new user, Supabase expects type 'signup'
            if (res.error && res.error.status !== 429) {
                const signupRes = await supabase.auth.verifyOtp({
                    email: normalizedEmail,
                    token: normalizedCode,
                    type: 'signup'
                })
                if (!signupRes.error) {
                    res = signupRes
                }
            }

            loading.value = false
            if (res.error) { error.value = res.error.message || 'Invalid code'; return false }

            user.value = res.data.user
            token.value = res.data.session?.access_token
            return true
        } catch (e) {
            error.value = e.message; loading.value = false; return false
        }
    }

    async function loginWithGoogle() {
        loading.value = true; error.value = ''
        if (!requireAuthConfigured()) return false
        try {
            const { data, error: err } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: 'http://127.0.0.1/auth/callback',
                    skipBrowserRedirect: true,
                    queryParams: {
                        prompt: 'select_account',
                        access_type: 'offline',
                    }
                }
            })
            if (err) throw err

            const res = await window.velance.auth.loginWithGoogleSupabase({ url: data.url })
            if (!res.ok) throw new Error(res.error || 'User closed the window.')

            const urlObj = new URL(res.url)
            const searchParams = new URLSearchParams(urlObj.search)
            const hashParams = new URLSearchParams(urlObj.hash.substring(1))
            const access_token = hashParams.get('access_token')
            const refresh_token = hashParams.get('refresh_token')
            const error_desc =
                hashParams.get('error_description') ||
                searchParams.get('error_description') ||
                searchParams.get('error')

            if (error_desc) {
                throw new Error('Google configuration mismatch: ' + decodeURIComponent(error_desc).replace(/\+/g, ' '))
            }

            if (access_token && refresh_token) {
                const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                    access_token,
                    refresh_token
                })
                if (sessionError) throw sessionError

                user.value = sessionData.user || sessionData.session?.user || null
                token.value = sessionData.session?.access_token
                loading.value = false
                return true
            } else {
                throw new Error('Supabase did not return access tokens.')
            }
        } catch (e) {
            loading.value = false;
            error.value = e.message;
            console.error('[Google Login Error]', e)
            return false
        }
    }

    async function updateProfile({ username, preferences }) {
        loading.value = true; error.value = ''
        if (!requireAuthConfigured()) return false
        try {
            const { data, error: err } = await supabase.auth.updateUser({
                data: { username, preferences }
            })
            loading.value = false
            if (err) { error.value = err.message; return false }
            user.value = data.user
            return true
        } catch (e) {
            error.value = e.message; loading.value = false; return false
        }
    }

    async function uploadAvatar(file) {
        if (!user.value?.id) return { ok: false, error: 'Not signed in' }
        loading.value = true
        error.value = ''
        if (!requireAuthConfigured()) return { ok: false, error: supabaseConfigMessage }
        try {
            const ext = file.name.split('.').pop().toLowerCase() || 'jpg'
            const path = `${user.value.id}/avatar.${ext}`

            const { error: uploadErr } = await supabase.storage
                .from('avatars')
                .upload(path, file, { upsert: true, contentType: file.type })

            if (uploadErr) throw uploadErr

            const { data } = supabase.storage.from('avatars').getPublicUrl(path)
            const publicUrl = data?.publicUrl
            if (!publicUrl) throw new Error('Could not get public URL for avatar.')

            // Cache-bust in the URL so the img tag re-fetches
            const bustedUrl = `${publicUrl}?v=${Date.now()}`
            const { data: updatedUser, error: updateErr } = await supabase.auth.updateUser({
                data: { avatar_url: bustedUrl }
            })
            if (updateErr) throw updateErr

            user.value = updatedUser.user
            loading.value = false
            return { ok: true, url: bustedUrl }
        } catch (e) {
            error.value = e.message
            loading.value = false
            return { ok: false, error: e.message }
        }
    }

    async function linkGoogleAccount() {
        loading.value = true
        error.value = ''
        if (!requireAuthConfigured()) return false
        try {
            const { data, error: err } = await supabase.auth.linkIdentity({
                provider: 'google',
                options: {
                    redirectTo: 'http://127.0.0.1/auth/callback',
                    skipBrowserRedirect: true,
                    queryParams: { prompt: 'select_account', access_type: 'offline' },
                }
            })
            if (err) throw err

            const res = await window.velance.auth.loginWithGoogleSupabase({ url: data.url })
            if (!res.ok) throw new Error(res.error || 'User closed the window.')

            const urlObj = new URL(res.url)
            const hashParams = new URLSearchParams(urlObj.hash.substring(1))
            const access_token = hashParams.get('access_token')
            const refresh_token = hashParams.get('refresh_token')

            if (access_token && refresh_token) {
                const { data: sessionData, error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token })
                if (sessionError) throw sessionError
                user.value = sessionData.user || sessionData.session?.user || null
                token.value = sessionData.session?.access_token
            }

            // Re-fetch user to get updated identities
            const { data: { user: refreshedUser } } = await supabase.auth.getUser()
            if (refreshedUser) user.value = refreshedUser

            loading.value = false
            return true
        } catch (e) {
            error.value = e.message
            loading.value = false
            return false
        }
    }

    async function logout() {
        await supabase.auth.signOut()
        user.value = null
        token.value = null
        error.value = ''
        localStorage.removeItem('velance_quick_login')
        localStorage.removeItem(SUPABASE_AUTH_TOKEN_KEY)
        LEGACY_SUPABASE_AUTH_TOKEN_KEYS.forEach((key) => localStorage.removeItem(key))
    }

    // Auto-sync state with Supabase
    supabase.auth.onAuthStateChange((event, session) => {
        if (session) {
            user.value = session.user
            token.value = session.access_token
        } else {
            user.value = null
            token.value = null
        }
    })

    return {
        user, token, isLoggedIn, loading, error,
        clearError, checkSession, register, registerWithPassword, requestEmailCode, resendSignupConfirmation,
        verifyRegistrationOTP, login, loginWithPassword, verifyOTP, loginWithGoogle, updateProfile,
        uploadAvatar, linkGoogleAccount, logout
    }
})
