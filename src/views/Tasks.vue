<script setup>
import { ref, computed, nextTick, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useVelanceStore } from '../store/velance.js'
import AppDateField from '../components/ui/AppDateField.vue'
import AppSelect from '../components/ui/AppSelect.vue'
import AppTimeField from '../components/ui/AppTimeField.vue'
import { primeFocusLaunch } from '../services/focusLaunchService.js'
import { formatLocalDateKey, getTodayLocalDateKey, shiftLocalDateKey } from '../services/dateKey.js'
import { isVelanceChallengeTask } from '../services/dailyChallenge.js'
import {
  AlarmClockIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckIcon,
  FlagIcon,
  HashIcon,
  ListFilterIcon,
  MoreVerticalIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from 'lucide-vue-next'

const router = useRouter()
const store = useVelanceStore()

const viewMode = ref('list')
const selectedTask = ref(null)
const isAddingTask = ref(false)
const completedExpanded = ref(false)
const subtaskDraft = ref('')
const newTaskSubtaskDraft = ref('')
const childTaskDraft = ref('')
const childDraftParentId = ref(null)
const nestingTargetId = ref(null)
const filterStatus = ref('all')
const taskQuery = ref('')
const filterPriority = ref('all')
const filterDue = ref('all')
const draggedTask = ref(null)
const dropTargetCol = ref(null)
const todayKey = computed(() => getTodayLocalDateKey())
const TIMELINE_PAST_DAYS = 4
const getTimelineStartKey = () => shiftLocalDateKey(-TIMELINE_PAST_DAYS, new Date(`${getTodayLocalDateKey()}T12:00:00`))
const timelineAnchor = ref(getTimelineStartKey())
const timelineScrollRef = ref(null)
const isTimelineDragging = ref(false)
const timelineDragStartX = ref(0)
const timelineDragScrollLeft = ref(0)
const TIMELINE_RANGE_DAYS = 84
const TIMELINE_SHIFT_DAYS = 28

const newTask = ref({
  title: '',
  desc: '',
  priority: 'Normal',
  habit: '',
  due: getTodayLocalDateKey(),
  reminderDate: getTodayLocalDateKey(),
  reminderTime: '',
  parentId: null,
  order: 0,
  subtasks: [],
})

const columns = [
  { id: 'to-do', title: 'To Do', color: '#8E95A3' },
  { id: 'in-progress', title: 'In Progress', color: '#00B4D8' },
  { id: 'completed', title: 'Completed', color: '#52B788' },
]
const kanbanColumns = columns

const priorityOptions = [
  { value: 'High', label: 'High', detail: 'Urgent or high-energy work', tone: 'high' },
  { value: 'Normal', label: 'Normal', detail: 'Planned work', tone: 'normal' },
  { value: 'Low', label: 'Low', detail: 'Nice-to-have or low pressure', tone: 'low' },
]

const filterPriorityOptions = [
  { value: 'all', label: 'Any priority' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

const filterDueOptions = [
  { value: 'all', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'unscheduled', label: 'Unscheduled' },
]

const TASK_STATUS_MAP = {
  todo: 'to-do',
  'to do': 'to-do',
  'to-do': 'to-do',
  inprogress: 'in-progress',
  'in progress': 'in-progress',
  'in-progress': 'in-progress',
  done: 'completed',
  complete: 'completed',
  completed: 'completed',
}

const normalizeTaskStatus = (status) => TASK_STATUS_MAP[String(status || 'to-do').trim().toLowerCase()] || 'to-do'
const formatTaskStatus = (status) => {
  const normalized = normalizeTaskStatus(status)
  if (normalized === 'to-do') return 'To Do'
  if (normalized === 'in-progress') return 'In Progress'
  return 'Completed'
}

const getTaskSortScore = (task) => {
  if (!task) return -1
  const status = normalizeTaskStatus(task.status)
  let score = 0
  if (status === 'completed') score -= 100
  if (task.due && task.due < todayKey.value) score += 100
  else if (task.due === todayKey.value) score += 60
  if (task.priority === 'High') score += 30
  else if (task.priority === 'Normal') score += 15
  else score += 5
  if (status === 'in-progress') score += 20
  if (task.habit) score += 5
  return score
}

const sortTasksForDisplay = (tasks) => [...tasks].sort((a, b) => {
  const scoreDiff = getTaskSortScore(b) - getTaskSortScore(a)
  if (scoreDiff !== 0) return scoreDiff
  return (a.createdAt || 0) - (b.createdAt || 0)
})

const createSubtaskId = () => `subtask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const normalizeSubtasks = (subtasks = []) => (Array.isArray(subtasks) ? subtasks : [])
  .map((subtask, index) => {
    const title = String(subtask?.title || '').trim()
    if (!title) return null
    return {
      id: subtask?.id || createSubtaskId(),
      title,
      completed: Boolean(subtask?.completed),
      createdAt: Number(subtask?.createdAt || Date.now()),
      updatedAt: Number(subtask?.updatedAt || subtask?.createdAt || Date.now()),
      order: Number.isFinite(Number(subtask?.order)) ? Number(subtask.order) : index,
    }
  })
  .filter(Boolean)
  .sort((left, right) => (left.order || 0) - (right.order || 0))

const getSubtasks = (task) => normalizeSubtasks(task?.subtasks)

const getSubtaskStats = (task) => {
  const subtasks = getSubtasks(task)
  const completed = subtasks.filter((subtask) => subtask.completed).length
  return {
    total: subtasks.length,
    completed,
    open: Math.max(0, subtasks.length - completed),
    percent: subtasks.length ? Math.round((completed / subtasks.length) * 100) : 0,
  }
}

const subtaskProgressLabel = (task) => {
  const stats = getSubtaskStats(task)
  if (!stats.total) return ''
  return `${stats.completed}/${stats.total} steps`
}

const subtaskProgressStyle = (task) => ({
  '--subtask-progress': `${getSubtaskStats(task).percent}%`,
})

const isSameTask = (left, right) => String(left?.id ?? left ?? '') === String(right?.id ?? right ?? '')
const isChildTask = (task) => Boolean(task?.parentId)
const getParentTask = (task) => store.tasks.find((candidate) => isSameTask(candidate.id, task?.parentId)) || null

const getChildTasks = (task) => {
  if (!task?.id) return []
  return [...store.tasks.filter((candidate) => isSameTask(candidate.parentId, task.id))]
    .sort((left, right) => {
      const orderDiff = (Number(left.order) || 0) - (Number(right.order) || 0)
      if (orderDiff !== 0) return orderDiff
      return (left.createdAt || 0) - (right.createdAt || 0)
    })
}

const getVisibleChildTasks = (task) => {
  const visibleIds = new Set(visibleTasks.value.map((candidate) => String(candidate.id)))
  const parentIsVisible = visibleIds.has(String(task?.id))
  return getChildTasks(task).filter((child) => {
    if (!parentIsVisible) return visibleIds.has(String(child.id))
    if (filterStatus.value === 'active') return normalizeTaskStatus(child.status) !== 'completed'
    if (filterStatus.value === 'completed') return normalizeTaskStatus(child.status) === 'completed'
    return true
  })
}

const getTaskStepStats = (task) => {
  const children = getChildTasks(task)
  if (children.length) {
    const completed = children.filter((child) => normalizeTaskStatus(child.status) === 'completed').length
    return {
      total: children.length,
      completed,
      open: Math.max(0, children.length - completed),
      percent: Math.round((completed / children.length) * 100),
      source: 'children',
    }
  }
  return { ...getSubtaskStats(task), source: 'checklist' }
}

const taskStepProgressLabel = (task) => {
  const stats = getTaskStepStats(task)
  if (!stats.total) return ''
  return `${stats.completed}/${stats.total} steps`
}

const taskStepProgressStyle = (task) => ({
  '--subtask-progress': `${getTaskStepStats(task).percent}%`,
})

const normalizeReminderTime = (value) => String(value || '').trim()
const hasReminder = (task) => Boolean(normalizeReminderTime(task?.reminderTime || task?.reminder))
const formatReminder = (task) => {
  const time = normalizeReminderTime(task?.reminderTime || task?.reminder)
  if (!time) return ''
  const reminderDate = task?.reminderDate || task?.due
  const dateLabel = reminderDate ? formatDue(reminderDate) : 'Unscheduled'
  return `${dateLabel}, ${formatTimeLabel(time)}`
}

const formatTimeLabel = (value) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return value || 'No reminder'
  const [hour, minute] = value.split(':').map(Number)
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const isFocusReady = (task) => normalizeTaskStatus(task?.status) !== 'completed'
  && Boolean(task?.title)
  && (task?.due === todayKey.value || task?.due < todayKey.value || String(task?.priority || '').toLowerCase() === 'high' || isVelanceChallengeTask(task, todayKey.value))

const visibleTasks = computed(() => {
  let allTasks = store.tasks
  if (filterStatus.value === 'active') allTasks = allTasks.filter((task) => normalizeTaskStatus(task.status) !== 'completed')
  else if (filterStatus.value === 'completed') allTasks = allTasks.filter((task) => normalizeTaskStatus(task.status) === 'completed')

  if (filterPriority.value !== 'all') {
    allTasks = allTasks.filter((task) => String(task.priority || 'Normal').toLowerCase() === filterPriority.value)
  }

  if (filterDue.value === 'overdue') allTasks = allTasks.filter((task) => isOverdue(task))
  else if (filterDue.value === 'today') allTasks = allTasks.filter((task) => task.due === todayKey.value)
  else if (filterDue.value === 'unscheduled') allTasks = allTasks.filter((task) => !task.due)

  const query = taskQuery.value.trim().toLowerCase()
  if (query) {
    allTasks = allTasks.filter((task) => [
      task.title,
      task.desc,
      task.habit,
      task.priority,
      formatTaskStatus(task.status),
      task.due,
      task.reminderDate,
      task.reminderTime,
      ...getSubtasks(task).map((subtask) => subtask.title),
    ].some((value) => String(value || '').toLowerCase().includes(query)))
  }

  return sortTasksForDisplay(allTasks)
})

const tasksByStatus = (status) => {
  return sortTasksForDisplay(visibleTasks.value.filter((task) => !isChildTask(task) && normalizeTaskStatus(task.status) === status))
}

const openDrawer = (task) => {
  selectedTask.value = {
    ...task,
    status: normalizeTaskStatus(task.status),
    reminderDate: task.reminderDate || task.due || '',
    reminderTime: task.reminderTime || task.reminder || '',
    parentId: task.parentId ?? null,
    order: Number.isFinite(Number(task.order)) ? Number(task.order) : 0,
    subtasks: getSubtasks(task),
  }
  subtaskDraft.value = ''
}

const closeDrawer = () => {
  selectedTask.value = null
  subtaskDraft.value = ''
}

const saveDrawer = () => {
  if (!selectedTask.value) return
  const nextStatus = normalizeTaskStatus(selectedTask.value.status)
  store.updateTask(selectedTask.value.id, {
    ...selectedTask.value,
    status: nextStatus,
    subtasks: getSubtasks(selectedTask.value),
    completedAt: nextStatus === 'completed'
      ? (selectedTask.value.completedAt || Date.now())
      : null,
  })
  closeDrawer()
}

const openChildComposer = (task) => {
  if (!task?.id || normalizeTaskStatus(task.status) === 'completed') return
  childDraftParentId.value = task.id
  childTaskDraft.value = ''
}

const closeChildComposer = () => {
  childDraftParentId.value = null
  childTaskDraft.value = ''
}

const createChildTask = (parent) => {
  const title = childTaskDraft.value.trim()
  if (!parent?.id || !title) return
  void store.addTask({
    title,
    desc: '',
    status: 'to-do',
    priority: parent.priority || 'Normal',
    habit: parent.habit || '',
    due: parent.due || null,
    reminderDate: parent.reminderDate || parent.due || null,
    reminderTime: '',
    parentId: parent.id,
    order: getChildTasks(parent).length,
    subtasks: [],
  })
  closeChildComposer()
}

const childTaskPreview = (task) => {
  const parent = getParentTask(task)
  return parent ? `${parent.title}: ${task.title}` : task.title
}

const canNestTaskUnder = (parent, child) => {
  if (!parent?.id || !child?.id) return false
  if (isSameTask(parent.id, child.id)) return false
  if (isChildTask(parent)) return false
  if (getChildTasks(child).length) return false
  if (normalizeTaskStatus(parent.status) === 'completed') return false
  return !isSameTask(child.parentId, parent.id)
}

const onTaskDragEnter = (parent) => {
  if (canNestTaskUnder(parent, draggedTask.value)) nestingTargetId.value = parent.id
}

const onTaskDragLeave = (parent) => {
  if (isSameTask(nestingTargetId.value, parent?.id)) nestingTargetId.value = null
}

const onTaskDrop = (parent) => {
  if (!canNestTaskUnder(parent, draggedTask.value)) return
  void store.updateTask(draggedTask.value.id, {
    parentId: parent.id,
    order: getChildTasks(parent).length,
    habit: draggedTask.value.habit || parent.habit || '',
    due: draggedTask.value.due || parent.due || null,
    reminderDate: draggedTask.value.reminderDate || draggedTask.value.due || parent.reminderDate || parent.due || null,
  })
  draggedTask.value = null
  nestingTargetId.value = null
}

const promoteTaskToRoot = (task) => {
  if (!task?.id || !isChildTask(task)) return
  void store.updateTask(task.id, { parentId: null, order: 0 })
  if (selectedTask.value?.id === task.id) selectedTask.value.parentId = null
}

const onListRootDrop = () => {
  if (!draggedTask.value || !isChildTask(draggedTask.value)) return
  promoteTaskToRoot(draggedTask.value)
  draggedTask.value = null
  nestingTargetId.value = null
}

const addSubtaskToTask = (target, title) => {
  const nextTitle = String(title || '').trim()
  if (!target || !nextTitle) return false
  const current = getSubtasks(target)
  target.subtasks = [
    ...current,
    {
      id: createSubtaskId(),
      title: nextTitle,
      completed: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: current.length,
    },
  ]
  return true
}

const addSelectedSubtask = () => {
  if (addSubtaskToTask(selectedTask.value, subtaskDraft.value)) subtaskDraft.value = ''
}

const toggleSelectedSubtask = (subtaskId) => {
  if (!selectedTask.value) return
  selectedTask.value.subtasks = getSubtasks(selectedTask.value).map((subtask) => (
    String(subtask.id) === String(subtaskId)
      ? { ...subtask, completed: !subtask.completed, updatedAt: Date.now() }
      : subtask
  ))
}

const removeSelectedSubtask = (subtaskId) => {
  if (!selectedTask.value) return
  selectedTask.value.subtasks = getSubtasks(selectedTask.value)
    .filter((subtask) => String(subtask.id) !== String(subtaskId))
    .map((subtask, index) => ({ ...subtask, order: index }))
}

const addNewTaskSubtask = () => {
  if (addSubtaskToTask(newTask.value, newTaskSubtaskDraft.value)) newTaskSubtaskDraft.value = ''
}

const toggleNewTaskSubtask = (subtaskId) => {
  newTask.value.subtasks = getSubtasks(newTask.value).map((subtask) => (
    String(subtask.id) === String(subtaskId)
      ? { ...subtask, completed: !subtask.completed, updatedAt: Date.now() }
      : subtask
  ))
}

const removeNewTaskSubtask = (subtaskId) => {
  newTask.value.subtasks = getSubtasks(newTask.value)
    .filter((subtask) => String(subtask.id) !== String(subtaskId))
    .map((subtask, index) => ({ ...subtask, order: index }))
}

const handleComplete = (task) => {
  store.updateTask(task.id, { status: 'completed', completedAt: Date.now() })
  getChildTasks(task).forEach((child) => {
    if (normalizeTaskStatus(child.status) !== 'completed') {
      store.updateTask(child.id, { status: 'completed', completedAt: Date.now() })
    }
  })
}

const handleUncomplete = (task) => {
  store.updateTask(task.id, { status: 'to-do', completedAt: null })
}

const deleteSelectedTask = () => {
  if (!selectedTask.value) return
  store.deleteTask(selectedTask.value.id)
  closeDrawer()
}

const deleteTask = (task) => {
  if (!task?.id) return
  if (selectedTask.value?.id === task.id) closeDrawer()
  store.deleteTask(task.id)
}

const clearCompletedTasks = () => {
  listCompletedTasks.value.forEach((task) => {
    store.deleteTask(task.id)
  })
  completedExpanded.value = false
}

const habitOptions = computed(() => {
  const fromHabits = store.habits.map((habit) => habit.name)
  const fromTasks = [...new Set(store.tasks.map((task) => task.habit).filter(Boolean))]
  return [...new Set([...fromHabits, ...fromTasks])]
})

const habitSelectOptions = computed(() => [
  { value: '', label: 'None', detail: 'No habit link' },
  ...habitOptions.value.map((habit) => ({ value: habit, label: habit })),
])

const selectedTaskCompleted = computed(() => normalizeTaskStatus(selectedTask.value?.status) === 'completed')

const submitNewTask = () => {
  if (!newTask.value.title.trim()) return
  store.addTask({ ...newTask.value, status: 'to-do' })
  isAddingTask.value = false
  newTask.value = {
    title: '',
    desc: '',
    priority: 'Normal',
    habit: '',
    due: getTodayLocalDateKey(),
    reminderDate: getTodayLocalDateKey(),
    reminderTime: '',
    parentId: null,
    order: 0,
    subtasks: [],
  }
  newTaskSubtaskDraft.value = ''
}

const listParentTasks = computed(() => {
  const parents = new Map()
  visibleTasks.value.forEach((task) => {
    if (!isChildTask(task)) {
      parents.set(String(task.id), task)
      return
    }
    const parent = getParentTask(task)
    if (parent) parents.set(String(parent.id), parent)
    else parents.set(String(task.id), task)
  })
  return sortTasksForDisplay([...parents.values()])
})

const listActiveTasks = computed(() => {
  if (filterStatus.value === 'completed') return []
  return listParentTasks.value.filter((task) => normalizeTaskStatus(task.status) !== 'completed')
})
const listCompletedTasks = computed(() => {
  if (filterStatus.value === 'active') return []
  return listParentTasks.value.filter((task) => normalizeTaskStatus(task.status) === 'completed')
})
const completedGroupOpen = computed(() => filterStatus.value === 'completed' || completedExpanded.value)

const formatDue = (due) => {
  if (!due) return ''
  const today = todayKey.value
  const tomorrowStr = shiftLocalDateKey(1, new Date(`${today}T12:00:00`))
  if (due === today) return 'Today'
  if (due === tomorrowStr) return 'Tomorrow'
  return new Date(due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const isDueToday = (due) => due === todayKey.value
const isOverdue = (task) => normalizeTaskStatus(task.status) !== 'completed' && task.due && task.due < todayKey.value
const isDailyChallenge = (task) => isVelanceChallengeTask(task, todayKey.value)
const challengeTask = computed(() => store.tasks.find((task) => isDailyChallenge(task)) || null)

const launchFocus = (task) => {
  if (!task || normalizeTaskStatus(task.status) === 'completed') return
  const firstOpenChild = !isChildTask(task)
    ? getChildTasks(task).find((child) => normalizeTaskStatus(child.status) !== 'completed')
    : null
  const focusTask = firstOpenChild || task
  const parentTask = getParentTask(focusTask)
  const focusHabitName = focusTask.habit || parentTask?.habit || ''
  const focusTitle = childTaskPreview(focusTask)
  const linkedHabit = focusHabitName
    ? store.habits.find((habit) => habit.name === focusHabitName)
    : null
  primeFocusLaunch({
    source: 'task',
    title: focusTitle,
    habit: focusHabitName || null,
    habitId: linkedHabit?.id || null,
    goal: focusTitle,
    taskId: focusTask.id || null,
    durationGoalMinutes: linkedHabit?.targetMinutes || null,
    habitColor: linkedHabit?.color || null,
  })
  if (focusTask.id && normalizeTaskStatus(focusTask.status) === 'to-do') void store.updateTask(focusTask.id, { status: 'in-progress' })
  router.push('/focus')
}

const suggestedTask = computed(() => {
  if (challengeTask.value && normalizeTaskStatus(challengeTask.value.status) !== 'completed') return challengeTask.value
  return store.suggestedTask
})
const startSuggestedTask = () => {
  if (!suggestedTask.value) return
  launchFocus(suggestedTask.value)
}

const taskHealth = computed(() => {
  const overdue = store.activeTasks.filter((task) => task.due && task.due < todayKey.value).length
  const dueToday = store.activeTasks.filter((task) => task.due === todayKey.value).length
  const inProgress = store.tasks.filter((task) => normalizeTaskStatus(task.status) === 'in-progress').length
  const completed = store.tasks.filter((task) => normalizeTaskStatus(task.status) === 'completed').length
  return { overdue, dueToday, inProgress, completed }
})

const taskPlanningNote = computed(() => {
  if (!store.tasks.length) return 'Build the first task list and Velance will start shaping the next move.'
  if (taskHealth.value.overdue > 0) return `${taskHealth.value.overdue} overdue task${taskHealth.value.overdue === 1 ? '' : 's'} need triage before the board feels clean again.`
  if (taskHealth.value.dueToday > 0) return `${taskHealth.value.dueToday} task${taskHealth.value.dueToday === 1 ? '' : 's'} land today. Finish one and the board calms down fast.`
  if (taskHealth.value.inProgress > 0) return `${taskHealth.value.inProgress} task${taskHealth.value.inProgress === 1 ? ' is' : 's are'} already in motion. Close loops before opening new ones.`
  return 'Your list is stable. Keep the next step obvious and small.'
})

const emptyStateCopy = computed(() => {
  if (!store.tasks.length) return { title: 'No tasks yet', body: 'Create the first task so the board can start prioritizing the real next move.' }
  if (taskQuery.value.trim() || filterPriority.value !== 'all' || filterDue.value !== 'all') return { title: 'No tasks match this view', body: 'Clear search or filters to bring hidden tasks back into view.' }
  if (filterStatus.value === 'completed') return { title: 'Nothing completed here yet', body: 'Finish a task and the review trail will start to build.' }
  if (filterStatus.value === 'active') return { title: 'No active tasks right now', body: 'That is a good sign. Add work only when it is real.' }
  return { title: 'Nothing to show here', body: 'Change the filter or add a task to keep the board honest.' }
})

const completedCount = computed(() => store.tasks.filter((task) => normalizeTaskStatus(task.status) === 'completed').length)
const reminderCount = computed(() => store.activeTasks.filter((task) => hasReminder(task)).length)
const hasActiveFilters = computed(() => Boolean(
  taskQuery.value.trim()
  || filterStatus.value !== 'all'
  || filterPriority.value !== 'all'
  || filterDue.value !== 'all'
))
const visibleTaskCount = computed(() => visibleTasks.value.length)
const clearFilters = () => {
  taskQuery.value = ''
  filterStatus.value = 'all'
  filterPriority.value = 'all'
  filterDue.value = 'all'
}

function dateFromKey(key = todayKey.value) {
  const date = new Date(`${key || todayKey.value}T12:00:00`)
  return Number.isFinite(date.getTime()) ? date : new Date()
}

function setTimelineAnchorFromDate(date) {
  timelineAnchor.value = formatLocalDateKey(date)
}

function scrollTimelineToStart(behavior = 'auto') {
  window.setTimeout(() => {
    timelineScrollRef.value?.scrollTo({ left: 0, behavior })
  }, 0)
}

const timelineRangeLabel = computed(() => {
  const start = dateFromKey(timelineAnchor.value)
  const end = new Date(start)
  end.setDate(start.getDate() + TIMELINE_RANGE_DAYS - 1)
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
})

const timelineDays = computed(() => {
  const start = dateFromKey(timelineAnchor.value)
  start.setHours(0, 0, 0, 0)

  return Array.from({ length: TIMELINE_RANGE_DAYS }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    const key = formatLocalDateKey(date)
    const tasks = sortTasksForDisplay(
      visibleTasks.value.filter((task) => task.due === key),
    )

    return {
      key,
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      longLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      monthLabel: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      isMonthStart: index === 0 || date.getDate() === 1,
      isToday: key === todayKey.value,
      tasks,
    }
  })
})

const timelineScheduledCount = computed(() => timelineDays.value.reduce((count, day) => count + day.tasks.length, 0))

function shiftTimeline(direction) {
  const start = dateFromKey(timelineAnchor.value)
  start.setDate(start.getDate() + (TIMELINE_SHIFT_DAYS * direction))
  setTimelineAnchorFromDate(start)
  scrollTimelineToStart()
}

function resetTimeline() {
  timelineAnchor.value = getTimelineStartKey()
  scrollTimelineToStart()
}

const unscheduledTasks = computed(() => {
  return sortTasksForDisplay(visibleTasks.value.filter((task) => !task.due))
})

function startTimelineDrag(event) {
  const target = timelineScrollRef.value
  if (!target) return
  isTimelineDragging.value = true
  timelineDragStartX.value = event.pageX - target.offsetLeft
  timelineDragScrollLeft.value = target.scrollLeft
  target.classList.add('dragging')
}

function moveTimelineDrag(event) {
  if (!isTimelineDragging.value || !timelineScrollRef.value) return
  event.preventDefault()
  const x = event.pageX - timelineScrollRef.value.offsetLeft
  timelineScrollRef.value.scrollLeft = timelineDragScrollLeft.value - ((x - timelineDragStartX.value) * 1.1)
}

function stopTimelineDrag() {
  isTimelineDragging.value = false
  timelineScrollRef.value?.classList.remove('dragging')
}

const onDragStart = (task) => {
  draggedTask.value = task
  nestingTargetId.value = null
}

const onDragEnd = () => {
  draggedTask.value = null
  dropTargetCol.value = null
  nestingTargetId.value = null
}

const onDragEnter = (columnId) => {
  dropTargetCol.value = columnId
}

const onDragLeave = () => {
  dropTargetCol.value = null
}

const onDrop = (status) => {
  const nextStatus = normalizeTaskStatus(status)
  if (draggedTask.value && normalizeTaskStatus(draggedTask.value.status) !== nextStatus) {
    store.updateTask(draggedTask.value.id, {
      status: nextStatus,
      completedAt: nextStatus === 'completed' ? Date.now() : null,
    })
  }
  draggedTask.value = null
  dropTargetCol.value = null
  nestingTargetId.value = null
}

onUnmounted(() => {
  draggedTask.value = null
  nestingTargetId.value = null
  cancelTimelineTaskDrag()
})

watch(
  [viewMode, filterStatus, filterPriority, filterDue, taskQuery],
  async () => {
    if (viewMode.value !== 'timeline') return
    await nextTick()
    scrollTimelineToStart()
  },
)

// ─── Timeline task drag-to-reschedule ───────────────────────────────────────
const LONG_PRESS_MS = 400
const DRAG_CANCEL_PX = 8
const EDGE_ZONE_PX = 80
const EDGE_SCROLL_SPEED = 14

const timelineDragTask = ref(null)
const timelineDragTargetKey = ref(null)
const timelineDragGhost = ref({ x: 0, y: 0 })
const isDraggingTimelineTask = ref(false)

let longPressTimer = null
let longPressStartX = 0
let longPressStartY = 0
let edgeScrollRaf = null
let lastPointerX = 0

const isDragTargetPast = computed(() =>
  Boolean(timelineDragTargetKey.value && timelineDragTargetKey.value < todayKey.value),
)

function onTimelineTaskPointerDown(event, task) {
  if (event.button !== 0) return
  event.stopPropagation()
  longPressStartX = event.clientX
  longPressStartY = event.clientY

  window.addEventListener('pointermove', onPreDragPointerMove)
  window.addEventListener('pointerup', onPreDragPointerUp)

  longPressTimer = setTimeout(() => {
    removePreDragListeners()
    activateTimelineTaskDrag(event, task)
  }, LONG_PRESS_MS)
}

function onPreDragPointerMove(event) {
  const dx = event.clientX - longPressStartX
  const dy = event.clientY - longPressStartY
  if (Math.sqrt(dx * dx + dy * dy) > DRAG_CANCEL_PX) {
    clearTimeout(longPressTimer)
    longPressTimer = null
    removePreDragListeners()
  }
}

function onPreDragPointerUp() {
  clearTimeout(longPressTimer)
  longPressTimer = null
  removePreDragListeners()
}

function removePreDragListeners() {
  window.removeEventListener('pointermove', onPreDragPointerMove)
  window.removeEventListener('pointerup', onPreDragPointerUp)
}

function activateTimelineTaskDrag(event, task) {
  isDraggingTimelineTask.value = true
  timelineDragTask.value = task
  timelineDragGhost.value = { x: event.clientX, y: event.clientY }
  lastPointerX = event.clientX

  window.addEventListener('pointermove', onDragPointerMove)
  window.addEventListener('pointerup', onDragPointerUp)
  window.addEventListener('pointercancel', cancelTimelineTaskDrag)
}

function onDragPointerMove(event) {
  timelineDragGhost.value = { x: event.clientX, y: event.clientY }
  lastPointerX = event.clientX
  updateTimelineDragTarget(event.clientX)
  tickEdgeScroll()
}

function onDragPointerUp() {
  commitTimelineTaskDrop()
  cancelTimelineTaskDrag()
}

function updateTimelineDragTarget(clientX) {
  const columns = timelineScrollRef.value?.querySelectorAll('.timeline-column')
  if (!columns) return
  let found = null
  for (const col of columns) {
    const rect = col.getBoundingClientRect()
    if (clientX >= rect.left && clientX <= rect.right) {
      found = col.dataset.dayKey
      break
    }
  }
  timelineDragTargetKey.value = found
}

function tickEdgeScroll() {
  cancelAnimationFrame(edgeScrollRaf)
  const scroll = timelineScrollRef.value
  if (!scroll) return

  const rect = scroll.getBoundingClientRect()
  const distLeft = lastPointerX - rect.left
  const distRight = rect.right - lastPointerX

  if (distLeft < EDGE_ZONE_PX) {
    const speed = Math.round((1 - distLeft / EDGE_ZONE_PX) * EDGE_SCROLL_SPEED)
    scroll.scrollLeft -= speed
    edgeScrollRaf = requestAnimationFrame(tickEdgeScroll)
  } else if (distRight < EDGE_ZONE_PX) {
    const speed = Math.round((1 - distRight / EDGE_ZONE_PX) * EDGE_SCROLL_SPEED)
    scroll.scrollLeft += speed
    edgeScrollRaf = requestAnimationFrame(tickEdgeScroll)
  }
}

function commitTimelineTaskDrop() {
  if (
    timelineDragTask.value &&
    timelineDragTargetKey.value &&
    timelineDragTargetKey.value !== timelineDragTask.value.due
  ) {
    store.updateTask(timelineDragTask.value.id, { due: timelineDragTargetKey.value })
  }
}

function cancelTimelineTaskDrag() {
  isDraggingTimelineTask.value = false
  timelineDragTask.value = null
  timelineDragTargetKey.value = null
  cancelAnimationFrame(edgeScrollRaf)
  edgeScrollRaf = null
  clearTimeout(longPressTimer)
  longPressTimer = null
  window.removeEventListener('pointermove', onDragPointerMove)
  window.removeEventListener('pointerup', onDragPointerUp)
  window.removeEventListener('pointercancel', cancelTimelineTaskDrag)
  removePreDragListeners()
}
</script>

<template>
  <div class="tasks-module">
    <section class="hero-card">
      <div class="hero-head">
        <div class="hero-copy">
          <span class="page-kicker">Planning desk</span>
          <h1 class="page-title">Tasks that stay sharp.</h1>
          <p class="page-subtitle">{{ taskPlanningNote }}</p>
          <div class="hero-pills">
            <span class="hero-pill">{{ store.activeTasks.length }} active</span>
            <span class="hero-pill">{{ completedCount }} completed</span>
            <span class="hero-pill">{{ taskHealth.inProgress }} in motion</span>
            <span class="hero-pill">{{ reminderCount }} reminders</span>
          </div>
        </div>

        <div class="header-actions">
          <div class="view-toggles">
            <button class="toggle-btn" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">List</button>
            <button class="toggle-btn" :class="{ active: viewMode === 'kanban' }" @click="viewMode = 'kanban'">Kanban</button>
            <button class="toggle-btn" :class="{ active: viewMode === 'timeline' }" @click="viewMode = 'timeline'">Timeline</button>
          </div>
          <button class="primary-btn" @click="isAddingTask = true">
            <PlusIcon size="16" /> New Task
          </button>
        </div>
      </div>

      <div v-if="suggestedTask" class="spotlight-card">
        <div class="spotlight-copy">
          <span class="spotlight-label">{{ isDailyChallenge(suggestedTask) ? 'Today\'s challenge' : 'Best next move' }}</span>
          <h3>{{ suggestedTask.title }}</h3>
          <p>
            <span v-if="suggestedTask.due && isOverdue(suggestedTask)">Overdue and worth clearing before more work piles on.</span>
            <span v-else-if="suggestedTask.due && isDueToday(suggestedTask.due)">Due today and strong enough to become the next focus block.</span>
            <span v-else>Highest-value next step from urgency, status, and priority.</span>
          </p>
        </div>

        <div class="spotlight-actions">
          <div class="spotlight-meta">
            <span class="meta-pill priority" :class="String(suggestedTask.priority || 'Normal').toLowerCase()">{{ suggestedTask.priority || 'Normal' }}</span>
            <span v-if="suggestedTask.due" class="meta-pill due" :class="{ overdue: isOverdue(suggestedTask), today: isDueToday(suggestedTask.due) }">
              <CalendarIcon size="12" /> {{ formatDue(suggestedTask.due) }}
            </span>
            <span v-if="hasReminder(suggestedTask)" class="meta-pill reminder">
              <AlarmClockIcon size="12" /> {{ formatReminder(suggestedTask) }}
            </span>
            <span v-if="isDailyChallenge(suggestedTask)" class="meta-pill challenge"><SparklesIcon size="12" /> Daily challenge</span>
            <span v-if="suggestedTask.habit" class="meta-pill subtle"><HashIcon size="12" /> {{ suggestedTask.habit }}</span>
          </div>

          <button class="primary-btn focus-primary" @click="startSuggestedTask">
            <PlayIcon size="16" /> Start Focus Block
          </button>
        </div>
      </div>
    </section>

    <section class="stat-strip">
      <article class="stat-card">
        <span class="stat-label">Overdue</span>
        <strong>{{ taskHealth.overdue }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">Due today</span>
        <strong>{{ taskHealth.dueToday }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">In progress</span>
        <strong>{{ taskHealth.inProgress }}</strong>
      </article>
    </section>

    <div class="board-toolbar">
      <div class="board-controls">
        <div class="filter-tabs">
          <button class="filter-tab" :class="{ active: filterStatus === 'all' }" @click="filterStatus = 'all'">All {{ store.tasks.length }}</button>
          <button class="filter-tab" :class="{ active: filterStatus === 'active' }" @click="filterStatus = 'active'">Active {{ store.activeTasks.length }}</button>
          <button class="filter-tab" :class="{ active: filterStatus === 'completed' }" @click="filterStatus = 'completed'">Done {{ completedCount }}</button>
        </div>

        <label class="task-search">
          <SearchIcon size="14" />
          <input v-model="taskQuery" type="search" placeholder="Search tasks, habits, reminders" />
        </label>

        <div class="filter-select-row">
          <AppSelect v-model="filterPriority" class="compact-app-select" :options="filterPriorityOptions" aria-label="Filter by priority" size="compact" />
          <AppSelect v-model="filterDue" class="compact-app-select" :options="filterDueOptions" aria-label="Filter by due date" size="compact" />
        </div>
      </div>
      <div v-if="hasActiveFilters" class="active-filter-strip">
        <ListFilterIcon size="13" />
        <span>{{ visibleTaskCount }} shown</span>
        <button class="clear-filter-btn" type="button" @click="clearFilters">Clear filters</button>
      </div>
    </div>

    <div class="tasks-layout">
      <transition name="fade-slide" mode="out-in">
        <div v-if="viewMode === 'kanban'" class="kanban-stage" key="kanban">
          <div class="kanban-board">
            <div
              v-for="column in kanbanColumns"
              :key="column.id"
              class="kanban-column"
              :class="{ 'drop-active': dropTargetCol === column.id, 'completed-column': column.id === 'completed' }"
              @dragover.prevent
              @dragenter.prevent="onDragEnter(column.id)"
              @dragleave="onDragLeave"
              @drop="onDrop(column.id)"
            >
              <div class="k-col-header">
                <div class="k-col-label">
                  <span class="k-col-dot" :style="{ background: column.color }"></span>
                  <h3>{{ column.title }}</h3>
                </div>
                <span class="k-badge">{{ tasksByStatus(column.id).length }}</span>
              </div>

              <transition-group name="list" tag="div" class="k-drag-zone">
                <div
                  v-for="task in tasksByStatus(column.id)"
                  :key="task.id"
                  class="kanban-card"
                  :class="{ overdue: isOverdue(task), challenge: isDailyChallenge(task), complete: normalizeTaskStatus(task.status) === 'completed', 'nest-target': isSameTask(nestingTargetId, task.id) }"
                  draggable="true"
                  @dragstart="onDragStart(task)"
                  @dragend="onDragEnd"
                  @dragover.prevent
                  @dragenter.prevent="onTaskDragEnter(task)"
                  @dragleave="onTaskDragLeave(task)"
                  @drop.stop="onTaskDrop(task)"
                  @click="openDrawer(task)"
                >
                  <div class="kc-top">
                    <span class="k-priority" :class="String(task.priority || 'Normal').toLowerCase()">{{ task.priority || 'Normal' }}</span>
                    <button
                      v-if="normalizeTaskStatus(task.status) === 'completed'"
                      class="icon-ghost-btn danger"
                      title="Delete completed task"
                      @click.stop="deleteTask(task)"
                    >
                      <TrashIcon size="15" />
                    </button>
                    <button v-else class="icon-ghost-btn" @click.stop="openDrawer(task)"><MoreVerticalIcon size="15" /></button>
                  </div>
                  <h4 class="kc-title">{{ task.title }}</h4>
                  <p v-if="task.desc" class="kc-desc">{{ task.desc }}</p>
                  <div v-if="getTaskStepStats(task).total" class="subtask-progress compact" :style="taskStepProgressStyle(task)">
                    <span>{{ taskStepProgressLabel(task) }}</span>
                    <i></i>
                  </div>
                  <div v-if="getChildTasks(task).length" class="kanban-child-stack">
                    <span
                      v-for="child in getChildTasks(task).slice(0, 3)"
                      :key="`kanban-child-${child.id}`"
                      class="kanban-child-pill"
                      :class="{ done: normalizeTaskStatus(child.status) === 'completed' }"
                    >
                      <CheckIcon v-if="normalizeTaskStatus(child.status) === 'completed'" size="11" />
                      {{ child.title }}
                    </span>
                    <small v-if="getChildTasks(task).length > 3">+{{ getChildTasks(task).length - 3 }} more</small>
                  </div>
                  <div class="kc-footer">
                    <span v-if="isDailyChallenge(task)" class="kc-tag challenge-tag"><SparklesIcon size="11" /> Today's challenge</span>
                    <span v-if="task.habit" class="kc-tag"><HashIcon size="11" /> {{ task.habit }}</span>
                    <span v-if="task.due" class="kc-tag due" :class="{ overdue: isOverdue(task), today: isDueToday(task.due) }">
                      <CalendarIcon size="11" /> {{ formatDue(task.due) }}
                    </span>
                    <span v-if="hasReminder(task)" class="kc-tag reminder-tag"><AlarmClockIcon size="11" /> {{ formatTimeLabel(task.reminderTime || task.reminder) }}</span>
                  </div>
                  <button v-if="normalizeTaskStatus(task.status) !== 'completed'" class="kanban-focus-btn" type="button" @click.stop="launchFocus(task)">
                    <PlayIcon size="13" /> Start focus
                  </button>
                </div>
              </transition-group>
            </div>
          </div>
        </div>

        <div v-else-if="viewMode === 'timeline'" class="timeline-board" key="timeline">
          <div class="timeline-header">
            <div>
              <span class="spotlight-label">Schedule lane</span>
              <h3>Upcoming due work</h3>
              <p>{{ timelineRangeLabel }}</p>
            </div>
            <div class="timeline-controls">
              <button type="button" class="timeline-nav-btn" @click="shiftTimeline(-1)">Prev</button>
              <button type="button" class="timeline-nav-btn" @click="resetTimeline">Today</button>
              <button type="button" class="timeline-nav-btn" @click="shiftTimeline(1)">Next</button>
              <span class="toolbar-note slim">{{ timelineScheduledCount }} scheduled across 12 weeks</span>
            </div>
          </div>

          <div
            ref="timelineScrollRef"
            class="timeline-scroll"
            @pointerdown="!isDraggingTimelineTask && startTimelineDrag($event)"
            @pointermove="!isDraggingTimelineTask && moveTimelineDrag($event)"
            @pointerup="stopTimelineDrag"
            @pointercancel="stopTimelineDrag"
            @pointerleave="stopTimelineDrag"
          >
            <div class="timeline-grid">
              <section
                v-for="day in timelineDays"
                :key="day.key"
                class="timeline-column"
                :data-day-key="day.key"
                :class="{
                  today: day.isToday,
                  'drag-over': isDraggingTimelineTask && timelineDragTargetKey === day.key,
                  'drag-over-past': isDraggingTimelineTask && timelineDragTargetKey === day.key && isDragTargetPast,
                }"
              >
                <span v-if="day.isMonthStart" class="timeline-month-marker">{{ day.monthLabel }}</span>
                <header class="timeline-day-head">
                  <span>{{ day.label }}</span>
                  <strong>{{ day.longLabel }}</strong>
                </header>
                <div v-if="isDraggingTimelineTask && timelineDragTargetKey === day.key && isDragTargetPast" class="drag-past-warning">
                  ⚠ Past date
                </div>

                <div class="timeline-stack">
                  <button
                    v-for="task in day.tasks"
                    :key="task.id"
                    class="timeline-task"
                    :class="{
                      overdue: isOverdue(task),
                      challenge: isDailyChallenge(task),
                      complete: normalizeTaskStatus(task.status) === 'completed',
                      'tl-dragging': isDraggingTimelineTask && timelineDragTask?.id === task.id,
                    }"
                    @pointerdown="onTimelineTaskPointerDown($event, task)"
                    @click="!isDraggingTimelineTask && openDrawer(task)"
                  >
                    <div class="timeline-task-head">
                      <strong>{{ task.title }}</strong>
                      <span class="timeline-priority" :class="String(task.priority || 'Normal').toLowerCase()">{{ task.priority || 'Normal' }}</span>
                    </div>
                    <p v-if="task.desc">{{ task.desc }}</p>
                    <div class="timeline-task-meta">
                      <span class="tag priority-tag" :class="String(task.priority || 'Normal').toLowerCase()">
                        <FlagIcon size="11" /> {{ formatTaskStatus(task.status) }}
                      </span>
                      <span v-if="isDailyChallenge(task)" class="tag challenge-tag"><SparklesIcon size="11" /> Today challenge</span>
                      <span v-if="getParentTask(task)" class="tag child-parent-tag">Under {{ getParentTask(task).title }}</span>
                      <span v-if="task.habit" class="tag habit-tag"><HashIcon size="11" /> {{ task.habit }}</span>
                      <span v-if="hasReminder(task)" class="tag reminder-tag"><AlarmClockIcon size="11" /> {{ formatTimeLabel(task.reminderTime || task.reminder) }}</span>
                      <span v-if="getTaskStepStats(task).total" class="tag subtask-tag"><CheckCircle2Icon size="11" /> {{ taskStepProgressLabel(task) }}</span>
                    </div>
                  </button>
                  <div v-if="!day.tasks.length" class="timeline-empty">No due work</div>
                </div>
              </section>
            </div>
          </div>

          <!-- Drag ghost card -->
          <Teleport to="body">
            <div
              v-if="isDraggingTimelineTask && timelineDragTask"
              class="tl-drag-ghost"
              :style="{ left: timelineDragGhost.x + 'px', top: timelineDragGhost.y + 'px' }"
            >
              <strong>{{ timelineDragTask.title }}</strong>
              <span class="tl-ghost-meta">{{ timelineDragTargetKey || 'Drag to a day' }}</span>
            </div>
          </Teleport>

          <div v-if="unscheduledTasks.length" class="timeline-unscheduled">
            <div class="timeline-unscheduled-head">
              <span class="spotlight-label">Unscheduled</span>
              <strong>{{ unscheduledTasks.length }} floating</strong>
            </div>
            <div class="unscheduled-row">
              <button
                v-for="task in unscheduledTasks"
                :key="task.id"
                class="unscheduled-pill"
                :class="{ 'tl-dragging': isDraggingTimelineTask && timelineDragTask?.id === task.id }"
                @pointerdown="onTimelineTaskPointerDown($event, task)"
                @click="!isDraggingTimelineTask && openDrawer(task)"
              >
                {{ task.title }}
              </button>
            </div>
          </div>
        </div>

        <div v-else class="list-board" key="list" @dragover.prevent @drop="onListRootDrop">
          <transition-group name="list" tag="div" class="list-rows">
            <div
              v-for="task in listActiveTasks"
              :key="task.id"
              class="task-family"
              :class="{ 'nest-target': isSameTask(nestingTargetId, task.id) }"
            >
              <div
                class="task-row parent-row"
                :class="{ selected: selectedTask?.id === task.id, challenge: isDailyChallenge(task), completed: normalizeTaskStatus(task.status) === 'completed', overdue: isOverdue(task), nesting: isSameTask(nestingTargetId, task.id) }"
                draggable="true"
                @dragstart="onDragStart(task)"
                @dragend="onDragEnd"
                @dragover.prevent
                @dragenter.prevent="onTaskDragEnter(task)"
                @dragleave="onTaskDragLeave(task)"
                @drop.stop="onTaskDrop(task)"
                @click="openDrawer(task)"
              >
                <button class="checkbox-btn" :class="{ checked: normalizeTaskStatus(task.status) === 'completed' }" @click.stop="normalizeTaskStatus(task.status) === 'completed' ? handleUncomplete(task) : handleComplete(task)">
                  <CheckIcon size="12" v-if="normalizeTaskStatus(task.status) === 'completed'" />
                </button>

                <div class="task-details">
                  <h4 class="task-title" :class="{ lineThrough: normalizeTaskStatus(task.status) === 'completed' }">{{ task.title }}</h4>
                  <div class="task-meta">
                    <span v-if="task.habit" class="tag habit-tag"><HashIcon size="11" /> {{ task.habit }}</span>
                    <span v-if="isDailyChallenge(task)" class="tag challenge-tag"><SparklesIcon size="11" /> Today's challenge</span>
                    <span class="tag priority-tag" :class="String(task.priority || 'Normal').toLowerCase()">{{ task.priority || 'Normal' }}</span>
                    <span v-if="task.due" class="tag due-tag" :class="{ 'due-today': isDueToday(task.due), 'due-overdue': isOverdue(task) }">
                      <CalendarIcon size="11" /> {{ formatDue(task.due) }}
                    </span>
                    <span v-if="hasReminder(task)" class="tag reminder-tag"><AlarmClockIcon size="11" /> {{ formatTimeLabel(task.reminderTime || task.reminder) }}</span>
                    <span v-if="getTaskStepStats(task).total" class="tag subtask-tag"><CheckCircle2Icon size="11" /> {{ taskStepProgressLabel(task) }}</span>
                  </div>
                  <div v-if="getTaskStepStats(task).total" class="subtask-progress row-progress" :style="taskStepProgressStyle(task)">
                    <i></i>
                  </div>
                </div>

                <div class="task-actions" @click.stop>
                  <button v-if="normalizeTaskStatus(task.status) !== 'completed'" class="quick-child-btn" type="button" @click="openChildComposer(task)">
                    <PlusIcon size="13" /> Add below
                  </button>
                  <button v-if="normalizeTaskStatus(task.status) !== 'completed'" class="action-btn focus-btn inline" @click="launchFocus(task)">
                    <PlayIcon size="13" />
                    <span>
                      Start focus
                    </span>
                  </button>
                </div>
              </div>

              <div v-if="childDraftParentId === task.id" class="child-task-composer">
                <PlusIcon size="14" />
                <input
                  v-model="childTaskDraft"
                  type="text"
                  placeholder="Add a task below this..."
                  @keydown.enter.prevent="createChildTask(task)"
                  @keydown.esc.prevent="closeChildComposer"
                />
                <button type="button" :disabled="!childTaskDraft.trim()" @click="createChildTask(task)">Add</button>
                <button type="button" class="composer-cancel" @click="closeChildComposer">Cancel</button>
              </div>

              <div v-if="getVisibleChildTasks(task).length" class="child-task-list">
                <div
                  v-for="child in getVisibleChildTasks(task)"
                  :key="`child-${child.id}`"
                  class="task-row child-task-row"
                  :class="{ selected: selectedTask?.id === child.id, challenge: isDailyChallenge(child), completed: normalizeTaskStatus(child.status) === 'completed', overdue: isOverdue(child) }"
                  draggable="true"
                  @dragstart="onDragStart(child)"
                  @dragend="onDragEnd"
                  @click="openDrawer(child)"
                >
                  <button class="checkbox-btn" :class="{ checked: normalizeTaskStatus(child.status) === 'completed' }" @click.stop="normalizeTaskStatus(child.status) === 'completed' ? handleUncomplete(child) : handleComplete(child)">
                    <CheckIcon size="12" v-if="normalizeTaskStatus(child.status) === 'completed'" />
                  </button>

                  <div class="task-details">
                    <h4 class="task-title" :class="{ lineThrough: normalizeTaskStatus(child.status) === 'completed' }">{{ child.title }}</h4>
                    <div class="task-meta">
                      <span class="tag child-parent-tag">Nested</span>
                      <span v-if="child.habit" class="tag habit-tag"><HashIcon size="11" /> {{ child.habit }}</span>
                      <span class="tag priority-tag" :class="String(child.priority || 'Normal').toLowerCase()">{{ child.priority || 'Normal' }}</span>
                      <span v-if="child.due" class="tag due-tag" :class="{ 'due-today': isDueToday(child.due), 'due-overdue': isOverdue(child) }">
                        <CalendarIcon size="11" /> {{ formatDue(child.due) }}
                      </span>
                      <span v-if="hasReminder(child)" class="tag reminder-tag"><AlarmClockIcon size="11" /> {{ formatTimeLabel(child.reminderTime || child.reminder) }}</span>
                    </div>
                  </div>

                  <div class="task-actions" @click.stop>
                    <button class="promote-child-btn" type="button" @click="promoteTaskToRoot(child)">Promote</button>
                    <button v-if="normalizeTaskStatus(child.status) !== 'completed'" class="action-btn focus-btn inline child-focus" @click="launchFocus(child)">
                      <PlayIcon size="13" />
                      <span>Focus</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </transition-group>

          <section v-if="listCompletedTasks.length" class="completed-task-section">
            <button type="button" class="completed-task-toggle" @click="completedExpanded = !completedExpanded">
              <span>
                <CheckIcon size="14" />
                Completed tasks
              </span>
              <strong>{{ listCompletedTasks.length }}</strong>
            </button>
            <button type="button" class="clear-completed-btn" @click="clearCompletedTasks">
              <TrashIcon size="14" />
              Clear completed
            </button>

            <transition name="fade-slide">
              <div v-if="completedGroupOpen" class="completed-task-list">
                <div
                  v-for="task in listCompletedTasks"
                  :key="`completed-${task.id}`"
                  role="button"
                  tabindex="0"
                  class="completed-task-row"
                  :class="{ selected: selectedTask?.id === task.id, challenge: isDailyChallenge(task) }"
                  @click="openDrawer(task)"
                  @keydown.enter.prevent="openDrawer(task)"
                >
                  <span class="checkbox-btn checked"><CheckIcon size="12" /></span>
                  <span class="completed-task-copy">
                    <strong>{{ task.title }}</strong>
                    <small>
                      {{ task.completedAt ? `Finished ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Finished' }}
                      <template v-if="getTaskStepStats(task).total"> - {{ taskStepProgressLabel(task) }}</template>
                    </small>
                  </span>
                  <span v-if="isDailyChallenge(task)" class="tag challenge-tag"><SparklesIcon size="11" /> Challenge</span>
                  <button class="completed-delete-btn" type="button" title="Delete completed task" @click.stop="deleteTask(task)">
                    <TrashIcon size="14" />
                  </button>
                </div>
              </div>
            </transition>
          </section>

          <div v-if="listActiveTasks.length === 0 && !listCompletedTasks.length" class="empty-state">
            <span class="empty-success-icon"><CheckCircle2Icon size="38" /></span>
            <h3>{{ emptyStateCopy.title }}</h3>
            <p>{{ emptyStateCopy.body }}</p>
            <button v-if="!store.tasks.length" class="primary-btn" @click="isAddingTask = true">
              <PlusIcon size="16" /> Create First Task
            </button>
          </div>
        </div>
      </transition>

      <transition name="slide-right">
        <div v-if="selectedTask" class="task-drawer" :class="{ 'floating-drawer': viewMode !== 'list' }">
          <div class="drawer-header">
            <div class="drawer-status-badge" :class="selectedTask.status">{{ formatTaskStatus(selectedTask.status) }}</div>
            <div class="drawer-header-actions">
              <button class="icon-ghost-btn danger" @click="deleteSelectedTask" title="Delete task"><TrashIcon size="15" /></button>
              <button class="icon-ghost-btn" @click="closeDrawer"><XIcon size="16" /></button>
            </div>
          </div>

          <div class="drawer-content">
            <input class="drawer-title-input" v-model="selectedTask.title" placeholder="Task name..." />
            <div v-if="isDailyChallenge(selectedTask)" class="drawer-challenge-note">
              <SparklesIcon size="14" />
              <span>This is today's Velance challenge. Start Focus from here to turn the challenge into evidence.</span>
            </div>
            <div v-if="getParentTask(selectedTask)" class="drawer-parent-note">
              <span>Nested under <strong>{{ getParentTask(selectedTask).title }}</strong></span>
              <button type="button" @click="promoteTaskToRoot(selectedTask)">Promote</button>
            </div>

            <div class="drawer-group">
              <label>Description</label>
              <textarea v-model="selectedTask.desc" class="custom-input" rows="3" placeholder="Details..."></textarea>
            </div>

            <div v-if="getChildTasks(selectedTask).length" class="drawer-group child-summary-group">
              <div class="checklist-head">
                <div>
                  <label>Nested tasks</label>
                  <p>{{ taskStepProgressLabel(selectedTask) }} complete. Focus starts from the first open child.</p>
                </div>
                <span class="checklist-count">{{ getTaskStepStats(selectedTask).percent }}%</span>
              </div>
              <div class="subtask-progress drawer-progress" :style="taskStepProgressStyle(selectedTask)">
                <i></i>
              </div>
              <div class="drawer-child-list">
                <button
                  v-for="child in getChildTasks(selectedTask)"
                  :key="`drawer-child-${child.id}`"
                  type="button"
                  class="drawer-child-row"
                  :class="{ done: normalizeTaskStatus(child.status) === 'completed' }"
                  @click="openDrawer(child)"
                >
                  <span class="checkbox-btn" :class="{ checked: normalizeTaskStatus(child.status) === 'completed' }">
                    <CheckIcon v-if="normalizeTaskStatus(child.status) === 'completed'" size="12" />
                  </span>
                  <strong>{{ child.title }}</strong>
                  <small>{{ formatTaskStatus(child.status) }}</small>
                </button>
              </div>
            </div>

            <div class="drawer-group checklist-group">
              <div class="checklist-head">
                <div>
                  <label>Checklist</label>
                  <p>{{ getSubtaskStats(selectedTask).total ? `${getSubtaskStats(selectedTask).completed} of ${getSubtaskStats(selectedTask).total} complete` : 'Break the task into smaller finishable steps.' }}</p>
                </div>
                <span v-if="getSubtaskStats(selectedTask).total" class="checklist-count">{{ getSubtaskStats(selectedTask).percent }}%</span>
              </div>

              <div v-if="getSubtaskStats(selectedTask).total" class="subtask-progress drawer-progress" :style="subtaskProgressStyle(selectedTask)">
                <i></i>
              </div>

              <div class="subtask-input-row">
                <input v-model="subtaskDraft" type="text" class="subtask-input" placeholder="Add a step..." @keydown.enter.prevent="addSelectedSubtask" />
                <button type="button" class="subtask-add-btn" :disabled="!subtaskDraft.trim()" @click="addSelectedSubtask">
                  <PlusIcon size="14" /> Add
                </button>
              </div>

              <div v-if="getSubtasks(selectedTask).length" class="subtask-list">
                <div v-for="subtask in getSubtasks(selectedTask)" :key="subtask.id" class="subtask-item" :class="{ done: subtask.completed }">
                  <button type="button" class="subtask-check" :class="{ checked: subtask.completed }" @click="toggleSelectedSubtask(subtask.id)">
                    <CheckIcon v-if="subtask.completed" size="12" />
                  </button>
                  <span>{{ subtask.title }}</span>
                  <button type="button" class="icon-ghost-btn danger" title="Remove step" @click="removeSelectedSubtask(subtask.id)">
                    <TrashIcon size="14" />
                  </button>
                </div>
              </div>
            </div>

            <div class="drawer-group row">
              <div class="half">
                <label><FlagIcon size="13" /> Priority</label>
                <AppSelect v-model="selectedTask.priority" :options="priorityOptions" aria-label="Task priority" />
              </div>

              <div class="half">
                <label><TagIcon size="13" /> Habit</label>
                <AppSelect v-model="selectedTask.habit" :options="habitSelectOptions" aria-label="Task habit" />
              </div>
            </div>

            <div class="drawer-group">
              <label><CalendarIcon size="13" /> Due date</label>
              <AppDateField v-model="selectedTask.due" aria-label="Task due date" />
            </div>

            <div class="drawer-group row">
              <div class="half">
                <label><CalendarIcon size="13" /> Reminder date</label>
                <AppDateField v-model="selectedTask.reminderDate" aria-label="Task reminder date" />
              </div>
              <div class="half">
                <label><AlarmClockIcon size="13" /> Reminder time</label>
                <AppTimeField v-model="selectedTask.reminderTime" aria-label="Task reminder time" />
              </div>
              <small class="field-helper wide">Optional. Pick a date and any time. Velance sends a local alert while the app is running.</small>
            </div>

            <div v-if="!selectedTaskCompleted" class="drawer-focus-card">
              <div>
                <span class="spotlight-label">Focus launch</span>
                <strong>Start a focused block from this task.</strong>
                <p>{{ selectedTask.habit ? `Uses the ${selectedTask.habit} habit target when available.` : 'Velance will carry this task title into Focus.' }}</p>
              </div>
              <button v-if="!selectedTaskCompleted" class="focus-launch-btn compact" @click="launchFocus(selectedTask)"><PlayIcon size="15" /> Start</button>
            </div>

            <div class="drawer-group">
              <label>Status</label>
              <div class="status-options">
                <button
                  v-for="column in columns"
                  :key="column.id"
                  class="status-opt"
                  :class="{ active: selectedTask.status === column.id }"
                  @click="selectedTask.status = column.id"
                  :style="{ '--col-color': column.color }"
                >
                  {{ column.title }}
                </button>
              </div>
            </div>
          </div>

          <div class="drawer-footer">
            <button v-if="!selectedTaskCompleted" class="focus-launch-btn" @click="launchFocus(selectedTask)"><PlayIcon size="16" /> Launch Focus</button>
            <button class="save-btn" @click="saveDrawer">Save</button>
          </div>
        </div>
      </transition>
    </div>

    <transition name="fade">
      <div v-if="isAddingTask" class="modal-overlay" @click.self="isAddingTask = false">
        <div class="modal-content">
          <div class="modal-header">
            <h2>New Task</h2>
            <button class="icon-btn" @click="isAddingTask = false"><XIcon size="18" /></button>
          </div>

          <input type="text" class="modal-title-input" v-model="newTask.title" placeholder="What needs to be done?" autofocus @keydown.enter="submitNewTask" />
          <textarea class="custom-input" v-model="newTask.desc" rows="2" placeholder="Description (optional)..."></textarea>

          <div class="modal-checklist">
            <div class="checklist-head">
              <div>
                <label>Checklist</label>
                <p>Optional steps for this task.</p>
              </div>
              <span v-if="getSubtaskStats(newTask).total" class="checklist-count">{{ subtaskProgressLabel(newTask) }}</span>
            </div>
            <div class="subtask-input-row">
              <input v-model="newTaskSubtaskDraft" type="text" class="subtask-input" placeholder="Add a first step..." @keydown.enter.prevent="addNewTaskSubtask" />
              <button type="button" class="subtask-add-btn" :disabled="!newTaskSubtaskDraft.trim()" @click="addNewTaskSubtask">
                <PlusIcon size="14" /> Add
              </button>
            </div>
            <div v-if="getSubtasks(newTask).length" class="subtask-list compact-list">
              <div v-for="subtask in getSubtasks(newTask)" :key="subtask.id" class="subtask-item" :class="{ done: subtask.completed }">
                <button type="button" class="subtask-check" :class="{ checked: subtask.completed }" @click="toggleNewTaskSubtask(subtask.id)">
                  <CheckIcon v-if="subtask.completed" size="12" />
                </button>
                <span>{{ subtask.title }}</span>
                <button type="button" class="icon-ghost-btn danger" title="Remove step" @click="removeNewTaskSubtask(subtask.id)">
                  <TrashIcon size="14" />
                </button>
              </div>
            </div>
          </div>

          <div class="modal-row">
            <div class="modal-field">
              <label>Priority</label>
              <AppSelect v-model="newTask.priority" :options="priorityOptions" aria-label="New task priority" />
            </div>
            <div class="modal-field">
              <label>Habit / Category</label>
              <AppSelect v-model="newTask.habit" :options="habitSelectOptions" aria-label="New task habit" />
            </div>
            <div class="modal-field">
              <label>Due date</label>
              <AppDateField v-model="newTask.due" aria-label="New task due date" />
            </div>
            <div class="modal-field">
              <label>Reminder date</label>
              <AppDateField v-model="newTask.reminderDate" aria-label="New task reminder date" />
            </div>
            <div class="modal-field">
              <label>Reminder time</label>
              <AppTimeField v-model="newTask.reminderTime" aria-label="New task reminder time" />
            </div>
          </div>

          <div class="modal-actions">
            <button class="ghost-btn" @click="isAddingTask = false">Cancel</button>
            <button class="primary-btn" @click="submitNewTask" :disabled="!newTask.title.trim()">
              <PlusIcon size="16" /> Create Task
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.tasks-module {
  padding: 28px 32px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 1320px;
  margin: 0 auto;
  min-height: 100%;
  min-width: 0;
}

.tasks-module,
.tasks-module * {
  box-sizing: border-box;
}

.hero-card,
.spotlight-card,
.stat-card,
.board-toolbar,
.kanban-column,
.list-board,
.timeline-board,
.task-drawer,
.drawer-focus-card,
.modal-content,
.empty-state {
  background: radial-gradient(circle at top right, var(--accent-glow), transparent 38%), var(--surface-strong);
  border: 1px solid var(--surface-outline);
  box-shadow: var(--shadow-elevation);
  backdrop-filter: blur(16px);
}

.hero-card {
  border-radius: 28px;
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 620px;
}

.page-kicker,
.spotlight-label,
.stat-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent-base);
}

.page-title {
  font-size: clamp(1.95rem, 3vw, 3.1rem);
  line-height: 0.96;
  letter-spacing: -0.05em;
}

.page-subtitle,
.spotlight-copy p,
.toolbar-note,
.empty-state p,
.task-meta,
.kc-desc,
.timeline-task p,
.timeline-empty {
  color: var(--text-muted);
}

.page-subtitle,
.spotlight-copy p {
  font-size: 14px;
  line-height: 1.5;
}

.hero-pills,
.header-actions,
.view-toggles,
.spotlight-meta,
.active-filter-strip,
.task-meta,
.task-actions,
.drawer-header-actions,
.modal-actions,
.timeline-task-meta,
.unscheduled-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.filter-tabs {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  flex-wrap: nowrap;
}

.hero-pill,
.meta-pill,
.toolbar-note,
.active-filter-strip,
.timeline-priority,
.unscheduled-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
}

.toolbar-note.slim {
  padding: 6px 10px;
}

.active-filter-strip {
  margin-left: auto;
  background: color-mix(in srgb, var(--accent-base) 8%, var(--surface-muted));
  border-color: color-mix(in srgb, var(--accent-base) 18%, var(--surface-outline));
  color: var(--text-soft);
}

.toolbar-note {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.view-toggles {
  padding: 4px;
  border-radius: 999px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
}

.toggle-btn,
.filter-tab,
.ghost-btn,
.save-btn,
.status-opt {
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-btn {
  padding: 8px 13px;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.toggle-btn.active,
.filter-tab.active {
  background: color-mix(in srgb, var(--accent-base) 14%, transparent);
  color: var(--accent-base);
}

.primary-btn,
.ghost-btn,
.focus-launch-btn,
.action-btn,
.kanban-focus-btn,
.clear-filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 13px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 800;
}

.primary-btn {
  background: var(--accent-gradient);
  color: white;
  border: none;
  box-shadow: 0 14px 28px var(--accent-glow);
}

.primary-btn.focus-primary {
  min-width: 178px;
}

.ghost-btn {
  background: var(--surface-muted);
  color: var(--text-main);
  border: 1px solid var(--surface-outline);
}

.clear-filter-btn {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.primary-btn:hover,
.ghost-btn:hover,
.action-btn:hover,
.focus-launch-btn:hover,
.save-btn:hover,
.filter-tab:hover,
.status-opt:hover,
.unscheduled-pill:hover {
  transform: translateY(-1px);
}

.spotlight-card {
  border-radius: 22px;
  padding: 18px 20px;
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: center;
}

.spotlight-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 560px;
}

.spotlight-copy h3 {
  font-size: 1.25rem;
  letter-spacing: -0.04em;
}

.spotlight-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.meta-pill.priority.high,
.k-priority.high,
.priority-tag.high,
.timeline-priority.high {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.meta-pill.priority.normal,
.k-priority.normal,
.priority-tag.normal,
.timeline-priority.normal {
  background: rgba(0, 180, 216, 0.12);
  color: var(--accent-base);
}

.meta-pill.priority.low,
.k-priority.low,
.priority-tag.low,
.timeline-priority.low {
  background: rgba(82, 183, 136, 0.12);
  color: #52b788;
}

.meta-pill.due.today,
.due-tag.due-today,
.kc-tag.today {
  background: rgba(245, 158, 11, 0.14);
  color: #f59e0b;
}

.meta-pill.due.overdue,
.due-tag.due-overdue,
.kc-tag.overdue {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.meta-pill.challenge,
.challenge-tag {
  color: #0f766e;
  background: rgba(20, 184, 166, 0.12);
  border: 1px solid rgba(20, 184, 166, 0.18);
}

.meta-pill.reminder,
.reminder-tag {
  color: #7c2d12;
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.18);
}

.subtask-tag {
  color: #0e7490;
  background: rgba(14, 165, 233, 0.1);
  border: 1px solid rgba(14, 165, 233, 0.16);
}

.child-parent-tag {
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.16);
}

.stat-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.stat-card {
  border-radius: 20px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-card strong {
  font-size: 1.8rem;
  letter-spacing: -0.04em;
}

.board-toolbar {
  border-radius: 20px;
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.board-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
  min-width: 0;
}

.filter-select-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.filter-tab {
  padding: 8px 12px;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.task-search {
  min-height: 36px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  border-radius: 12px;
}

.task-search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  min-width: min(260px, 100%);
}

.task-search input {
  width: 180px;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  font-weight: 700;
}

.task-search input::placeholder {
  color: var(--text-muted);
}

.compact-app-select {
  width: 132px;
  min-width: 132px;
}

.drawer-group :deep(.app-select),
.drawer-group :deep(.app-date-field),
.drawer-group :deep(.app-time-field),
.modal-field :deep(.app-select),
.modal-field :deep(.app-date-field),
.modal-field :deep(.app-time-field) {
  width: 100%;
}

.compact-app-select :deep(.app-select-trigger) {
  min-height: 36px;
}

.kanban-focus-btn:hover,
.clear-filter-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 24%, var(--surface-outline));
}

.tasks-layout {
  display: flex;
  gap: 20px;
  min-height: 420px;
  position: relative;
}

.kanban-stage,
.kanban-board,
.list-board,
.timeline-board {
  flex: 1;
  min-width: 0;
}

.kanban-stage {
  display: grid;
  gap: 14px;
}

.kanban-board {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(260px, 1fr) minmax(236px, 0.82fr);
  gap: 16px;
  padding-bottom: 8px;
  align-items: start;
}

.kanban-column {
  border-radius: 24px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 100%;
  overflow: hidden;
}

.kanban-column.completed-column {
  background:
    radial-gradient(circle at top right, rgba(82, 183, 136, 0.12), transparent 34%),
    color-mix(in srgb, var(--surface-strong) 92%, transparent);
}

.kanban-column.drop-active {
  box-shadow: inset 0 0 0 2px rgba(0, 180, 216, 0.16);
}

.k-col-header,
.k-col-label,
.kc-top,
.kc-footer,
.task-row,
.drawer-header,
.modal-header,
.modal-row,
.timeline-header,
.timeline-day-head,
.timeline-task-head,
.timeline-unscheduled-head {
  display: flex;
  gap: 10px;
}

.k-col-header,
.kc-top,
.kc-footer,
.task-row,
.drawer-header,
.modal-header,
.timeline-header,
.timeline-task-head,
.timeline-unscheduled-head {
  justify-content: space-between;
  align-items: center;
}

.k-col-label {
  align-items: center;
}

.k-col-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.k-col-header h3 {
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-muted);
}

.k-badge {
  min-width: 26px;
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--surface-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
}

.k-drag-zone {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 220px;
}

.completed-column .k-drag-zone {
  max-height: calc(100vh - 410px);
  overflow: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, #52b788 34%, transparent) transparent;
}

.kanban-card,
.task-row,
.drawer-title-input,
.custom-input,
.modal-title-input,
.timeline-task {
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
}

.kanban-card {
  border-radius: 18px;
  padding: 13px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  min-width: 0;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.kanban-card.nest-target {
  border-color: color-mix(in srgb, var(--accent-base) 44%, var(--surface-outline));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-base) 9%, transparent);
  transform: translateY(-1px);
}

.kanban-card.complete {
  padding: 12px;
  opacity: 0.82;
}

.kanban-card.complete .kc-title {
  text-decoration: line-through;
  color: color-mix(in srgb, var(--text-main) 64%, transparent);
}

.kanban-card.complete .kc-desc,
.kanban-card.complete .kc-footer {
  display: none;
}

.subtask-progress {
  --subtask-progress: 0%;
  position: relative;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in srgb, var(--surface-outline) 52%, transparent);
}

.subtask-progress i {
  display: block;
  width: var(--subtask-progress);
  height: 100%;
  border-radius: inherit;
  background: var(--accent-gradient);
  box-shadow: 0 0 18px var(--accent-glow);
  transition: width 0.22s ease;
}

.subtask-progress.compact {
  height: auto;
  min-height: 26px;
  padding: 7px 9px;
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  background: color-mix(in srgb, var(--surface-muted) 72%, transparent);
  border: 1px solid var(--surface-outline);
}

.subtask-progress.compact i {
  height: 4px;
}

.kanban-child-stack {
  display: grid;
  gap: 6px;
  padding: 9px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--surface-strong) 68%, transparent);
  border: 1px solid var(--surface-outline);
}

.kanban-child-pill {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-radius: 10px;
  color: var(--text-soft);
  background: color-mix(in srgb, var(--surface-muted) 78%, transparent);
  font-size: 11px;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kanban-child-pill.done {
  color: var(--text-muted);
  text-decoration: line-through;
}

.kanban-child-stack small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.subtask-progress.row-progress {
  width: min(180px, 100%);
  margin-top: 8px;
}

.kanban-card.overdue,
.task-row.overdue,
.timeline-task.overdue {
  border-color: color-mix(in srgb, #ef4444 18%, var(--surface-outline));
  background:
    linear-gradient(90deg, rgba(239, 68, 68, 0.045), transparent 22%),
    var(--surface-muted);
}

.kanban-card.challenge,
.task-row.challenge,
.timeline-task.challenge {
  position: relative;
  overflow: hidden;
  border-color: rgba(20, 184, 166, 0.3);
  background:
    linear-gradient(90deg, rgba(20, 184, 166, 0.1), transparent 28%),
    var(--surface-muted);
  box-shadow: 0 16px 32px rgba(20, 184, 166, 0.08);
}

.kanban-card.challenge::after,
.task-row.challenge::after,
.timeline-task.challenge::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 0%, rgba(20, 184, 166, 0.12) 46%, transparent 70%);
  opacity: 0.54;
  animation: challengeSheen 5.4s ease-in-out infinite;
}

.kanban-card.challenge::before,
.task-row.challenge::before,
.timeline-task.challenge::before {
  content: '';
  position: absolute;
  inset: 10px auto 10px 0;
  width: 3px;
  border-radius: 999px;
  background: var(--accent-gradient);
  box-shadow: 0 0 18px var(--accent-glow);
}

.k-priority,
.tag,
.kc-tag,
.drawer-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 800;
}

.kc-title,
.task-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.kc-footer {
  justify-content: flex-start;
  align-items: flex-start;
}

.lineThrough {
  text-decoration: line-through;
  opacity: 0.5;
}

.kc-desc {
  font-size: 12px;
  line-height: 1.5;
}

.kanban-focus-btn {
  width: 100%;
  min-height: 36px;
  border-radius: 13px;
  border: 1px solid rgba(14, 165, 233, 0.18);
  background: rgba(14, 165, 233, 0.09);
  color: var(--accent-base);
  font-size: 12px;
  cursor: pointer;
}

.list-board,
.timeline-board {
  border-radius: 24px;
  padding: 14px;
  min-height: 320px;
}

.list-board {
  display: flex;
  flex-direction: column;
}

.list-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.task-family {
  position: relative;
  display: grid;
  gap: 8px;
}

.task-family.nest-target .parent-row {
  border-color: color-mix(in srgb, var(--accent-base) 45%, var(--surface-outline));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-base) 9%, transparent);
}

.parent-row.nesting {
  transform: translateY(-1px);
}

.child-task-list {
  position: relative;
  display: grid;
  gap: 8px;
  margin-left: 34px;
  padding-left: 18px;
}

.child-task-list::before {
  content: '';
  position: absolute;
  left: 0;
  top: -8px;
  bottom: 18px;
  width: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-base) 22%, transparent);
}

.child-task-row {
  position: relative;
  padding: 12px 14px;
  border-radius: 16px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--accent-base) 5%, transparent), transparent 32%),
    color-mix(in srgb, var(--surface-muted) 82%, transparent);
  box-shadow: none;
}

.child-task-row::before {
  content: '';
  position: absolute;
  left: -18px;
  top: 50%;
  width: 14px;
  height: 2px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-base) 24%, transparent);
}

.child-task-row .task-title {
  font-size: 14px;
}

.child-task-composer {
  margin-left: 34px;
  padding: 10px;
  border-radius: 16px;
  border: 1px dashed color-mix(in srgb, var(--accent-base) 30%, var(--surface-outline));
  background: color-mix(in srgb, var(--accent-base) 5%, var(--surface-muted));
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  color: var(--accent-base);
}

.child-task-composer input {
  min-height: 38px;
  border: none;
  outline: none;
  border-radius: 12px;
  background: var(--surface-strong);
  color: var(--text-main);
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  font-weight: 720;
}

.child-task-composer button,
.quick-child-btn,
.promote-child-btn {
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.child-task-composer button {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 12px;
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
}

.child-task-composer button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.child-task-composer .composer-cancel {
  color: var(--text-muted);
  background: var(--surface-muted);
}

.quick-child-btn {
  min-height: 34px;
  padding: 0 11px;
  border-radius: 12px;
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 8%, transparent);
}

.promote-child-btn {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  color: var(--text-muted);
}

.child-task-composer button:not(:disabled):hover,
.quick-child-btn:hover,
.promote-child-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 28%, var(--surface-outline));
}

.completed-task-section {
  margin-top: 12px;
  display: grid;
  gap: 10px;
}

.kanban-archive {
  margin-top: 0;
}

.completed-task-toggle {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  border-radius: 16px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-muted) 78%, transparent);
  color: var(--text-main);
  font: inherit;
  font-size: 12px;
  font-weight: 820;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}

.completed-task-toggle span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.completed-task-toggle strong {
  min-width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(82, 183, 136, 0.14);
  color: #0f766e;
}

.completed-task-list {
  display: grid;
  gap: 8px;
}

.completed-task-list.compact {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}

.completed-task-row {
  width: 100%;
  min-height: 58px;
  padding: 10px 12px;
  border-radius: 16px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-muted) 72%, transparent);
  color: var(--text-main);
  font: inherit;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
  opacity: 0.86;
  transition: transform 0.18s ease, border-color 0.18s ease, opacity 0.18s ease;
}

.clear-completed-btn,
.completed-delete-btn {
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, #ef4444 5%, var(--surface-muted));
  color: #ef4444;
  font: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.clear-completed-btn {
  width: fit-content;
  min-height: 36px;
  padding: 0 12px;
  gap: 7px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 820;
}

.completed-delete-btn {
  width: 32px;
  height: 32px;
  border-radius: 999px;
}

.clear-completed-btn:hover,
.completed-delete-btn:hover {
  border-color: color-mix(in srgb, #ef4444 24%, var(--surface-outline));
  background: color-mix(in srgb, #ef4444 9%, var(--surface-muted));
  transform: translateY(-1px);
}

.completed-task-row:hover,
.completed-task-toggle:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 22%, var(--surface-outline));
}

.completed-task-row.selected {
  opacity: 1;
  border-color: color-mix(in srgb, var(--accent-base) 26%, var(--surface-outline));
}

.completed-task-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.completed-task-copy strong,
.completed-task-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.completed-task-copy strong {
  text-decoration: line-through;
  color: color-mix(in srgb, var(--text-main) 62%, transparent);
  font-size: 13px;
  font-weight: 760;
}

.completed-task-copy small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 680;
}

.task-row {
  border-radius: 18px;
  padding: 14px;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  min-width: 0;
}

.task-row.selected {
  box-shadow: inset 0 0 0 1px rgba(0, 180, 216, 0.16);
}

.checkbox-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.checkbox-btn.checked {
  background: rgba(82, 183, 136, 0.16);
  color: #52b788;
  border-color: rgba(82, 183, 136, 0.2);
}

.task-details {
  flex: 1;
  min-width: 0;
}

.task-actions {
  flex: 0 0 auto;
}

.task-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.focus-btn.inline {
  min-width: 112px;
  padding: 8px 11px;
  border: 1px solid rgba(0, 180, 216, 0.18);
  background: rgba(0, 180, 216, 0.1);
  color: var(--accent-base);
}

.focus-btn.inline span {
  display: grid;
  gap: 2px;
  line-height: 1;
}

.focus-btn.inline small {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
}

.timeline-board {
  display: grid;
  gap: 16px;
  align-content: start;
  overflow: visible;
  min-height: 0;
}

.timeline-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 10px;
  cursor: grab;
  scrollbar-color: color-mix(in srgb, var(--accent-base) 35%, transparent) transparent;
  scrollbar-width: thin;
}

.timeline-scroll.dragging {
  cursor: grabbing;
  user-select: none;
}

.timeline-header h3 {
  font-size: 1.1rem;
  letter-spacing: -0.03em;
}

.timeline-header p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
}

.timeline-controls {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.timeline-nav-btn {
  min-height: 36px;
  padding: 0 11px;
  border-radius: 12px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: var(--text-main);
  font: inherit;
  font-size: 12px;
  font-weight: 820;
  cursor: pointer;
}

.timeline-nav-btn:focus {
  outline: none;
}

.timeline-nav-btn:focus-visible {
  border-color: var(--surface-outline-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-base) 18%, transparent);
}

.timeline-nav-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.timeline-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(200px, calc((100% - 60px) / 6));
  gap: 12px;
  width: 100%;
  scroll-snap-type: x proximity;
}

.timeline-column {
  width: 100%;
  padding: 13px;
  border-radius: 20px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  display: grid;
  gap: 12px;
  align-content: start;
  min-height: 214px;
  scroll-snap-align: start;
}

.timeline-month-marker {
  width: fit-content;
  padding: 5px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
  color: var(--accent-base);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.timeline-column.today {
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
  border-color: var(--surface-outline-strong);
}

.timeline-day-head {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.timeline-day-head span {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent-base);
  font-weight: 800;
}

.timeline-day-head strong {
  font-size: 13px;
}

.timeline-stack {
  display: grid;
  gap: 10px;
  align-content: start;
}

.timeline-task {
  padding: 11px;
  border-radius: 16px;
  text-align: left;
  cursor: pointer;
  color: var(--text-main);
  display: grid;
  gap: 8px;
  min-height: 96px;
  max-height: none;
  align-content: start;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--bg-card) 88%, transparent);
  overflow: visible;
}

.timeline-task:focus {
  outline: none;
}

.timeline-task:focus-visible {
  border-color: var(--surface-outline-strong);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-base) 18%, transparent);
}

.timeline-task.complete {
  opacity: 0.74;
}

.timeline-task-head strong {
  font-size: 13px;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.timeline-task p {
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.timeline-empty {
  min-height: 58px;
  border: 1px dashed var(--surface-outline);
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 12px;
}

.timeline-unscheduled {
  padding: 14px;
  border-radius: 18px;
  background: var(--surface-muted);
  border: 1px solid var(--surface-outline);
  display: grid;
  gap: 12px;
}

.timeline-unscheduled-head strong {
  color: var(--text-soft);
  font-size: 13px;
}

.unscheduled-pill {
  font: inherit;
  cursor: pointer;
}

/* ── Timeline drag-to-reschedule ─────────────────────────────── */

/* Source card while being dragged */
.timeline-task.tl-dragging,
.unscheduled-pill.tl-dragging {
  opacity: 0.35;
  pointer-events: none;
}

/* Drop target column — normal */
.timeline-column.drag-over {
  border-color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 10%, var(--surface-muted));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-base) 30%, transparent);
}

/* Drop target column — past date */
.timeline-column.drag-over-past {
  border-color: #f97316;
  background: color-mix(in srgb, #f97316 8%, var(--surface-muted));
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.28);
}

/* Past date warning label */
.drag-past-warning {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f97316;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.28);
  width: fit-content;
}

/* Floating ghost card that follows cursor */
.tl-drag-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  transform: translate(-50%, -110%);
  min-width: 140px;
  max-width: 200px;
  padding: 10px 13px;
  border-radius: 14px;
  border: 1px solid var(--accent-base);
  background: var(--bg-card);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.22), 0 0 0 1px color-mix(in srgb, var(--accent-base) 24%, transparent);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tl-drag-ghost strong {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl-ghost-meta {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent-base);
  white-space: nowrap;
}

.empty-state {
  border-radius: 24px;
  flex: 1;
  min-height: 360px;
  padding: 54px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background:
    radial-gradient(circle at 52% 0%, color-mix(in srgb, var(--accent-base) 9%, transparent), transparent 32%),
    color-mix(in srgb, var(--surface-muted) 74%, transparent);
  border: 1px solid var(--surface-outline);
}

.empty-success-icon {
  width: 64px;
  height: 64px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 13%, transparent);
  box-shadow: 0 18px 40px var(--accent-glow);
}

.task-drawer {
  width: clamp(340px, 26vw, 390px);
  border-radius: 24px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-drawer.floating-drawer {
  position: fixed;
  right: 28px;
  top: 86px;
  bottom: 24px;
  width: min(390px, calc(100vw - 56px));
  z-index: 860;
  overflow: auto;
}

@media (min-width: 1280px) {
  .tasks-layout {
    gap: 22px;
  }

  .kanban-board {
    gap: 18px;
  }

  .kanban-column {
    padding: 18px;
  }
}

.icon-ghost-btn,
.icon-btn {
  border: none;
  background: transparent;
  color: var(--text-muted);
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  cursor: pointer;
  transition: color 0.2s ease, transform 0.2s ease;
}

.icon-ghost-btn:hover,
.icon-btn:hover {
  color: var(--text-main);
  transform: translateY(-1px);
}

.icon-ghost-btn.danger:hover,
.icon-btn.danger:hover {
  color: #ef4444;
}

.drawer-status-badge.to-do { background: rgba(15, 23, 42, 0.06); color: var(--text-muted); }
.drawer-status-badge.in-progress { background: rgba(0, 180, 216, 0.12); color: var(--accent-base); }
.drawer-status-badge.completed { background: rgba(82, 183, 136, 0.12); color: #52b788; }

.drawer-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.drawer-challenge-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 11px 12px;
  border-radius: 14px;
  border: 1px solid rgba(20, 184, 166, 0.2);
  background: rgba(20, 184, 166, 0.09);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.45;
}

.drawer-challenge-note svg {
  flex: 0 0 auto;
  color: var(--accent-base);
  margin-top: 1px;
}

.drawer-parent-note {
  min-height: 42px;
  padding: 9px 10px 9px 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, #6366f1 18%, var(--surface-outline));
  background: color-mix(in srgb, #6366f1 7%, var(--surface-muted));
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  font-weight: 740;
}

.drawer-parent-note strong {
  color: var(--text-main);
}

.drawer-parent-note button {
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-strong);
  color: #6366f1;
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
}

.child-summary-group {
  padding: 13px;
  border-radius: 18px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-muted) 70%, transparent);
}

.drawer-child-list {
  display: grid;
  gap: 7px;
}

.drawer-child-row {
  min-height: 42px;
  padding: 7px 8px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-strong) 82%, transparent);
  color: var(--text-main);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.drawer-child-row strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 780;
}

.drawer-child-row small {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.drawer-child-row.done strong {
  color: var(--text-muted);
  text-decoration: line-through;
}

.checklist-group,
.modal-checklist {
  padding: 13px;
  border-radius: 18px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-muted) 70%, transparent);
  display: grid;
  gap: 10px;
}

.checklist-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.checklist-head p {
  margin: 5px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.checklist-count {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-base);
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-base) 18%, transparent);
  font-size: 11px;
  font-weight: 850;
}

.subtask-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.subtask-input {
  width: 100%;
  min-height: 40px;
  border-radius: 13px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-strong);
  color: var(--text-main);
  padding: 0 12px;
  font: inherit;
  outline: none;
}

.subtask-input:focus {
  border-color: color-mix(in srgb, var(--accent-base) 28%, var(--surface-outline));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-base) 9%, transparent);
}

.subtask-add-btn {
  min-height: 40px;
  padding: 0 12px;
  border-radius: 13px;
  border: 1px solid color-mix(in srgb, var(--accent-base) 20%, var(--surface-outline));
  background: color-mix(in srgb, var(--accent-base) 10%, transparent);
  color: var(--accent-base);
  font: inherit;
  font-size: 12px;
  font-weight: 850;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.subtask-add-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.subtask-list {
  display: grid;
  gap: 8px;
}

.subtask-list.compact-list {
  max-height: 170px;
  overflow: auto;
  padding-right: 2px;
}

.subtask-item {
  min-height: 42px;
  padding: 7px 8px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-strong) 82%, transparent);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}

.subtask-item span {
  min-width: 0;
  color: var(--text-main);
  font-size: 13px;
  font-weight: 750;
  line-height: 1.35;
}

.subtask-item.done span {
  color: var(--text-muted);
  text-decoration: line-through;
}

.subtask-check {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid var(--surface-outline);
  background: var(--surface-muted);
  color: white;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
}

.subtask-check.checked {
  border-color: color-mix(in srgb, #52b788 35%, transparent);
  background: #52b788;
}

.drawer-progress {
  height: 7px;
}

.field-helper {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.field-helper.wide {
  flex-basis: 100%;
}

.drawer-focus-card {
  border-radius: 18px;
  padding: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.drawer-focus-card div {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.drawer-focus-card strong {
  font-size: 1rem;
}

.drawer-focus-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.drawer-title-input,
.custom-input,
.modal-title-input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 14px;
  color: var(--text-main);
  font: inherit;
  outline: none;
}

.drawer-title-input:focus,
.custom-input:focus,
.modal-title-input:focus {
  box-shadow: 0 0 0 4px rgba(0, 180, 216, 0.08);
  border-color: rgba(0, 180, 216, 0.22);
}

.drawer-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drawer-group.row {
  display: flex;
  gap: 10px;
}

.drawer-group label,
.modal-field label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.half {
  flex: 1;
}

.status-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.status-opt {
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--surface-muted);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 800;
}

.status-opt.active {
  background: color-mix(in srgb, var(--col-color) 12%, transparent);
  color: var(--col-color);
}

.drawer-footer {
  display: flex;
  gap: 10px;
}

.focus-launch-btn,
.save-btn {
  flex: 1;
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 800;
}

.focus-launch-btn.compact {
  flex: 0 0 auto;
  min-width: 86px;
}

.focus-launch-btn {
  background: rgba(0, 180, 216, 0.1);
  color: var(--accent-base);
  border: 1px solid rgba(0, 180, 216, 0.16);
}

.save-btn {
  background: var(--surface-muted);
  color: var(--text-main);
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 14, 21, 0.38);
  backdrop-filter: blur(16px);
  display: grid;
  place-items: center;
  z-index: 1000;
}

.modal-content {
  width: min(860px, calc(100vw - 28px));
  border-radius: 28px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-header {
  margin-bottom: 4px;
}

.modal-header h2 {
  font-size: 1.2rem;
}

.modal-row {
  align-items: flex-start;
  flex-wrap: wrap;
}

.modal-field {
  flex: 1 1 150px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@keyframes challengeSheen {
  0%, 72%, 100% { transform: translateX(-120%); opacity: 0; }
  18%, 46% { opacity: 0.5; }
  58% { transform: translateX(120%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .kanban-card.challenge::after,
  .task-row.challenge::after,
  .timeline-task.challenge::after {
    animation: none;
  }
}

.fade-enter-active,
.fade-leave-active,
.fade-slide-enter-active,
.fade-slide-leave-active,
.slide-right-enter-active,
.slide-right-leave-active,
.list-enter-active,
.list-leave-active {
  transition: all 0.22s ease;
}

.fade-enter-from,
.fade-leave-to,
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.slide-right-enter-from,
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(18px);
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 1180px) {
  .tasks-layout {
    flex-direction: column;
  }

  .task-drawer {
    width: 100%;
  }
}

@media (max-width: 900px) {
  .kanban-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 840px) {
  .tasks-module {
    padding: 24px 18px 32px;
  }

  .hero-head,
  .spotlight-card,
  .board-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .board-controls,
  .task-search,
  .task-search input,
  .filter-select-row,
  .compact-app-select {
    width: 100%;
  }

  .board-controls,
  .filter-tabs,
  .filter-select-row {
    flex-wrap: wrap;
  }

  .stat-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .modal-row {
    flex-direction: column;
  }

  .status-options {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .page-title {
    font-size: 2.2rem;
  }

  .stat-strip,
  .kanban-board {
    grid-template-columns: 1fr;
  }

  .task-row {
    align-items: flex-start;
  }

  .task-actions {
    width: 100%;
  }

  .focus-btn.inline {
    width: 100%;
  }
}

/* ─── DARK THEME OVERRIDES ─────────────────────────────────────────────────── */
/* Dark-text tag variants that are invisible on dark card backgrounds */
:global(.dark-theme .tasks-module .meta-pill.challenge),
:global(.dark-theme .tasks-module .challenge-tag){
  color: #2dd4bf !important;
  background: rgba(20, 184, 166, 0.14) !important;
  border-color: rgba(20, 184, 166, 0.22) !important;
}

:global(.dark-theme .tasks-module .meta-pill.reminder),
:global(.dark-theme .tasks-module .reminder-tag){
  color: #fb923c !important;
  background: rgba(249, 115, 22, 0.14) !important;
  border-color: rgba(249, 115, 22, 0.22) !important;
}

:global(.dark-theme .tasks-module .subtask-tag){
  color: #38bdf8 !important;
  background: rgba(14, 165, 233, 0.14) !important;
  border-color: rgba(14, 165, 233, 0.22) !important;
}

:global(.dark-theme .tasks-module .child-parent-tag){
  color: #a78bfa !important;
  background: rgba(99, 102, 241, 0.14) !important;
  border-color: rgba(99, 102, 241, 0.22) !important;
}

/* Drawer / modal panel backgrounds */
:global(.dark-theme .tasks-module .task-drawer),
:global(.dark-theme .tasks-module .modal-overlay > div),
:global(.dark-theme .tasks-module .new-task-modal){
  background: var(--bg-card) !important;
  border-color: var(--surface-outline) !important;
}

/* Hero card and board surfaces */
:global(.dark-theme .tasks-module .hero-card),
:global(.dark-theme .tasks-module .spotlight-card),
:global(.dark-theme .tasks-module .stat-card),
:global(.dark-theme .tasks-module .list-board),
:global(.dark-theme .tasks-module .timeline-board),
:global(.dark-theme .tasks-module .kanban-column){
  background: radial-gradient(circle at top right, var(--accent-glow), transparent 38%), var(--bg-card) !important;
  border-color: var(--surface-outline) !important;
}

/* Page title and headings always correct in dark mode */
:global(.dark-theme .tasks-module .page-title),
:global(.dark-theme .tasks-module h1),
:global(.dark-theme .tasks-module h2),
:global(.dark-theme .tasks-module h3){
  color: var(--text-main) !important;
}

/* Completed task checkmark badge */
:global(.dark-theme .tasks-module .completed-badge),
:global(.dark-theme .tasks-module .check-badge){
  color: #34d399 !important;
  background: rgba(52, 211, 153, 0.14) !important;
}
</style>
