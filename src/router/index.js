import { createRouter, createWebHashHistory } from 'vue-router'
import { supabase } from '../lib/supabase.js'

const Dashboard = () => import('../views/Dashboard.vue')
const Tasks = () => import('../views/Tasks.vue')
const FocusSession = () => import('../views/FocusSession.vue')
const Analytics = () => import('../views/Analytics.vue')
const Habits = () => import('../views/Habits.vue')
const Insights = () => import('../views/Insights.vue')
const Settings = () => import('../views/Settings.vue')
const Auth = () => import('../views/Auth.vue')
const Profile = () => import('../views/Profile.vue')
const Onboarding = () => import('../views/Onboarding.vue')

const routes = [
    // Public
    { path: '/auth', component: Auth, meta: { public: true } },
    { path: '/onboarding', component: Onboarding, meta: { public: true, requiresAuth: true } },

    // Protected
    { path: '/', component: Dashboard, meta: { requiresAuth: true } },
    { path: '/tasks', component: Tasks, meta: { requiresAuth: true } },
    { path: '/focus', component: FocusSession, meta: { requiresAuth: true } },
    { path: '/analytics', component: Analytics, meta: { requiresAuth: true } },
    { path: '/habits', component: Habits, meta: { requiresAuth: true } },
    { path: '/insights', component: Insights, meta: { requiresAuth: true } },
    { path: '/settings', component: Settings, meta: { requiresAuth: true } },
    { path: '/profile', component: Profile, meta: { requiresAuth: true } },
    { path: '/activity', redirect: '/analytics?mode=activity', meta: { requiresAuth: true } },
    { path: '/screentime', redirect: '/analytics?mode=activity', meta: { requiresAuth: true } },
]

const router = createRouter({
    history: createWebHashHistory(),
    routes,
    scrollBehavior() {
        return { top: 0 }
    },
})

// Navigation guard
router.beforeEach(async (to) => {
    const { data: { session } } = await supabase.auth.getSession()
    const isLoggedIn = !!session

    if (to.meta.requiresAuth && !isLoggedIn) {
        return { path: '/auth' }
    }

    if (to.path === '/auth' && isLoggedIn) {
        return { path: '/' }
    }

    return true
})

router.onError((error) => {
  console.error('[Velance Router]', error)
  const message = error?.message || ''
  if (/Failed to fetch dynamically imported module|Importing a module script failed|fetch dynamically imported module/i.test(message)) {
    window.location.reload()
  }
})

export default router
