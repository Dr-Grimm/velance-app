import { onBeforeUnmount } from 'vue'
import { useVelanceStore } from '../store/velance.js'
import { getTodayLocalDateKey } from '../services/dateKey.js'

const REMINDER_STORAGE_PREFIX = 'velance_task_reminders_fired'
const REMINDER_POLL_MS = 30000
const REMINDER_GRACE_MS = 15 * 60 * 1000

let reminderTimer = null

function getReminderTime(task = {}) {
  return String(task.reminderTime || task.reminder || '').trim()
}

function getReminderDate(task = {}) {
  return String(task.reminderDate || task.due || '').trim()
}

function getReminderTimestamp(task = {}) {
  const date = getReminderDate(task)
  const time = getReminderTime(task)
  if (!date || !/^\d{2}:\d{2}$/.test(time)) return 0
  const parsed = new Date(`${date}T${time}:00`)
  const timestamp = parsed.getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

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

function reminderKey(task = {}) {
  return `${task.id || task.title}:${getReminderDate(task)}:${getReminderTime(task)}`
}

function playReminderSound() {
  if (typeof window === 'undefined') return
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextConstructor) return

  try {
    const audioContext = new AudioContextConstructor()
    const now = audioContext.currentTime
    const masterGain = audioContext.createGain()
    masterGain.gain.setValueAtTime(0.0001, now)
    masterGain.gain.exponentialRampToValueAtTime(0.048, now + 0.018)
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62)
    masterGain.connect(audioContext.destination)

    ;[880, 1320, 1174].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      const start = now + index * 0.11
      oscillator.type = index === 1 ? 'triangle' : 'sine'
      oscillator.frequency.setValueAtTime(frequency, start)
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.68, start + 0.016)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2)
      oscillator.connect(gain)
      gain.connect(masterGain)
      oscillator.start(start)
      oscillator.stop(start + 0.22)
    })

    window.setTimeout(() => audioContext.close?.(), 850)
  } catch {
    // Reminder notifications still work when the host blocks Web Audio.
  }
}

function sendReminder(task) {
  const title = task?.title || 'Task reminder'
  const date = getReminderDate(task)
  const dueLabel = date === getTodayLocalDateKey() ? 'today' : date || 'scheduled'
  const body = `${title} is scheduled for ${dueLabel} at ${getReminderTime(task)}.`
  playReminderSound()
  if (window.velance?.notify) {
    window.velance.notify('Velance task reminder', body)
    return
  }

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Velance task reminder', { body })
  }
}

function checkTaskReminders(store) {
  if (!store?.settings?.notificationsEnabled) return

  const workspaceId = store.currentWorkspaceId || 'local'
  const fired = readFired(workspaceId)
  const now = Date.now()
  const tasks = Array.isArray(store.tasks) ? store.tasks : []

  tasks
    .filter((task) => task?.status !== 'completed')
    .forEach((task) => {
      const timestamp = getReminderTimestamp(task)
      if (!timestamp) return
      const key = reminderKey(task)
      if (fired[key]) return
      if (now < timestamp || now - timestamp > REMINDER_GRACE_MS) return
      sendReminder(task)
      fired[key] = now
    })

  writeFired(workspaceId, fired)
}

export function useTaskReminders() {
  const store = useVelanceStore()

  function startTaskReminderWatcher() {
    if (reminderTimer) return
    checkTaskReminders(store)
    reminderTimer = window.setInterval(() => checkTaskReminders(store), REMINDER_POLL_MS)
  }

  function stopTaskReminderWatcher() {
    if (!reminderTimer) return
    window.clearInterval(reminderTimer)
    reminderTimer = null
  }

  onBeforeUnmount(stopTaskReminderWatcher)

  return {
    startTaskReminderWatcher,
    stopTaskReminderWatcher,
    checkTaskReminders: () => checkTaskReminders(store),
  }
}
