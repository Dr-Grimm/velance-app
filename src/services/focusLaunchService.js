const STORAGE_KEY = 'velance_focus_task'

export function primeFocusLaunch({
  source = 'task',
  title = '',
  habit = '',
  habitId = null,
  goal = '',
  taskId = null,
  durationGoalMinutes = null,
  habitColor = null,
} = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    source,
    title,
    habit,
    habitId,
    goal,
    taskId,
    durationGoalMinutes,
    habitColor,
    primedAt: Date.now(),
  }))
}

export function consumeFocusLaunch() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return null

  localStorage.removeItem(STORAGE_KEY)

  try {
    return JSON.parse(stored)
  } catch {
    return null
  }
}
