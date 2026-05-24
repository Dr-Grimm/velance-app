import { onBeforeUnmount } from 'vue'
import { useVelanceStore } from '../store/velance.js'
import { getTodayLocalDateKey } from '../services/dateKey.js'

const REMINDER_STORAGE_PREFIX = 'velance_habit_reminders_fired'
const REMINDER_POLL_MS = 30000
const REMINDER_GRACE_MS = 60 * 60 * 1000

let habitReminderTimer = null

function getStorageKey(workspaceId = 'local') {
  return `${REMINDER_STORAGE_PREFIX}:${workspaceId || 'local'}`
}

function readFired(workspaceId) {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(getStorageKey(workspaceId)) || '{}') || {}
  } catch {
    return {}
  }
}

function writeFired(workspaceId, fired) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(getStorageKey(workspaceId), JSON.stringify(fired || {}))
}

function formatMinutes(totalMinutes = 0) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes))
  if (safeMinutes < 60) return `${safeMinutes}m`
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function parseReminderTimestamp(time = '') {
  if (!/^\d{2}:\d{2}$/.test(time || '')) return 0
  const dateKey = getTodayLocalDateKey()
  const timestamp = new Date(`${dateKey}T${time}:00`).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function reminderMatchesToday(habit = {}, today = new Date()) {
  const frequency = habit.reminderFrequency || 'daily'
  const day = today.getDay()
  const selectedDays = Array.isArray(habit.reminderDays) ? habit.reminderDays.map(Number) : []

  if (frequency === 'daily') return true
  if (frequency === 'weekdays') return day >= 1 && day <= 5
  if (frequency === 'weekly' || frequency === 'custom') return selectedDays.includes(day)
  return true
}

function reminderKey(habit = {}) {
  return `${habit.id || habit.name}:${getTodayLocalDateKey()}:${habit.reminderFrequency || 'daily'}:${habit.reminderTime || ''}`
}

function playHabitReminderSound() {
  if (typeof window === 'undefined') return
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextConstructor) return

  try {
    const audioContext = new AudioContextConstructor()
    const now = audioContext.currentTime
    const masterGain = audioContext.createGain()
    masterGain.gain.setValueAtTime(0.0001, now)
    masterGain.gain.exponentialRampToValueAtTime(0.042, now + 0.02)
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
    masterGain.connect(audioContext.destination)

    ;[523.25, 659.25, 783.99].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      const start = now + index * 0.16
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.56, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.26)
      oscillator.connect(gain)
      gain.connect(masterGain)
      oscillator.start(start)
      oscillator.stop(start + 0.3)
    })

    window.setTimeout(() => audioContext.close?.(), 1100)
  } catch {
    // Notification still works if Web Audio is unavailable.
  }
}

function sendHabitReminder(habit = {}) {
  const target = formatMinutes(habit.targetMinutes || 60)
  const body = `${habit.name || 'Habit'} is ready. Start a ${target} Focus block when you want to keep the streak alive.`
  playHabitReminderSound()

  if (window.velance?.notify) {
    window.velance.notify('Velance habit reminder', body)
    return
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Velance habit reminder', { body })
  }
}

function checkHabitReminders(store) {
  if (!store?.settings?.notificationsEnabled) return

  const workspaceId = store.currentWorkspaceId || 'local'
  const fired = readFired(workspaceId)
  const now = Date.now()
  const today = new Date()
  const habits = Array.isArray(store.habits) ? store.habits : []

  habits
    .filter((habit) => habit?.reminderEnabled && habit?.reminderTime)
    .forEach((habit) => {
      if (!reminderMatchesToday(habit, today)) return
      const timestamp = parseReminderTimestamp(habit.reminderTime)
      if (!timestamp) return
      const key = reminderKey(habit)
      if (fired[key]) return
      if (now < timestamp || now - timestamp > REMINDER_GRACE_MS) return
      sendHabitReminder(habit)
      fired[key] = now
    })

  writeFired(workspaceId, fired)
}

export function useHabitReminders() {
  const store = useVelanceStore()

  function startHabitReminderWatcher() {
    if (habitReminderTimer) return
    checkHabitReminders(store)
    habitReminderTimer = window.setInterval(() => checkHabitReminders(store), REMINDER_POLL_MS)
  }

  function stopHabitReminderWatcher() {
    if (!habitReminderTimer) return
    window.clearInterval(habitReminderTimer)
    habitReminderTimer = null
  }

  onBeforeUnmount(stopHabitReminderWatcher)

  return {
    startHabitReminderWatcher,
    stopHabitReminderWatcher,
    checkHabitReminders: () => checkHabitReminders(store),
  }
}
