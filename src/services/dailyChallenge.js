import { getTodayLocalDateKey, shiftLocalDateKey } from './dateKey.js'

export const DAILY_CHALLENGE_MARKER = 'VELANCE_DAILY_CHALLENGE'

export function buildDailyChallengeMarker(dateKey = getTodayLocalDateKey()) {
  return `[${DAILY_CHALLENGE_MARKER}:${dateKey}]`
}

export function isVelanceChallengeTask(task = {}, dateKey = getTodayLocalDateKey()) {
  const desc = String(task?.desc || '')
  return desc.includes(buildDailyChallengeMarker(dateKey))
}

export function getChallengeDateFromTask(task = {}) {
  const desc = String(task?.desc || '')
  const match = desc.match(/\[VELANCE_DAILY_CHALLENGE:(\d{4}-\d{2}-\d{2})\]/)
  return match?.[1] || ''
}

export function getTodayChallengeTask(tasks = [], dateKey = getTodayLocalDateKey()) {
  return tasks.find((task) => isVelanceChallengeTask(task, dateKey)) || null
}

export function buildChallengeTaskPayload(challenge = {}, dateKey = getTodayLocalDateKey()) {
  const title = challenge.taskTitle || challenge.title || 'Complete today\'s Velance challenge'
  const why = challenge.why ? `Why this matters: ${challenge.why}` : ''
  const focus = challenge.focusGoal ? `Focus goal: ${challenge.focusGoal}` : ''
  const body = challenge.body || 'Protect one intentional block and let Velance measure the result.'
  const lines = [
    'Velance daily challenge',
    '',
    body,
    why,
    focus,
    '',
    buildDailyChallengeMarker(dateKey),
  ].filter(Boolean)

  return {
    title,
    desc: lines.join('\n'),
    priority: challenge.priority || 'High',
    due: dateKey,
    habit: challenge.habit || '',
    status: 'to-do',
  }
}

export function getAcceptedChallengeStorageKey(workspaceId = 'local', dateKey = getTodayLocalDateKey()) {
  return `velance.challenge.${workspaceId || 'local'}.${dateKey}`
}

export function readAcceptedChallenge(workspaceId = 'local', dateKey = getTodayLocalDateKey()) {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage?.getItem(getAcceptedChallengeStorageKey(workspaceId, dateKey))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveAcceptedChallenge(workspaceId = 'local', dateKey = getTodayLocalDateKey(), payload = {}) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage?.setItem(getAcceptedChallengeStorageKey(workspaceId, dateKey), JSON.stringify({
      ...payload,
      dateKey,
      acceptedAt: payload.acceptedAt || Date.now(),
    }))
  } catch {}
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function pickLeadHabit(context = {}) {
  const habits = Array.isArray(context.habits) ? context.habits : []
  return habits.find((habit) => habit?.name) || null
}

function hashDateKey(dateKey = getTodayLocalDateKey()) {
  return String(dateKey).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

export function buildDailyChallengeCandidates({ context = {}, primaryMove = {}, dateKey = getTodayLocalDateKey() } = {}) {
  const browser = context.browserEvidence || {}
  const taskSummary = context.taskSummary || {}
  const ambient = context.ambientSummary || {}
  const leadSite = browser.leadSiteLabel || 'your lead distraction'
  const leadHabit = pickLeadHabit(context)
  const sessions = normalizeNumber(context.sessions)
  const avgFocus = normalizeNumber(context.avgFocusScore)
  const browserPressure = normalizeNumber(browser.pressureScore)
  const distractingShare = normalizeNumber(browser.distractingShare)
  const overdue = normalizeNumber(taskSummary.overdue)
  const highPriority = normalizeNumber(taskSummary.highPriorityOpen)
  const openTasks = normalizeNumber(taskSummary.open)
  const productiveMinutes = normalizeNumber(ambient.productiveMinutes)
  const distractingMinutes = normalizeNumber(ambient.distractingMinutes)
  const fatiguePressure = context.currentFatigue === 'High' || normalizeNumber(context.fatigueHighDays) >= 2
  const base = hashDateKey(dateKey)

  const candidates = [
    {
      id: 'baseline-25',
      title: 'Today\'s challenge',
      taskTitle: 'Complete one intentional 25-minute focus block',
      body: 'Claim one piece of work with a timer, a task label, and a clean finish.',
      why: 'Your baseline is still thin, so one honest focus session will make every future recommendation sharper.',
      focusGoal: 'Run a 25-minute Focus Session and link it to this task.',
      priority: 'High',
      score: sessions < 3 ? 100 : 48,
    },
    {
      id: 'baseline-label',
      title: 'Today\'s challenge',
      taskTitle: 'Label one real work block before starting',
      body: 'Choose the exact work, write the goal, then let Velance measure the block.',
      why: 'Clear labels make future insights sharper than background activity alone.',
      focusGoal: 'Write one crisp goal, then start Focus from this challenge.',
      priority: 'High',
      score: sessions < 3 ? 94 : 45,
    },
    {
      id: 'close-lead-distraction',
      title: 'Today\'s challenge',
      taskTitle: `Run one block without ${leadSite}`,
      body: 'Close the loudest attention leak before the timer starts, then compare the block quality.',
      why: `${leadSite} is the clearest browser pressure signal right now.`,
      focusGoal: 'Close the lead distraction and start Focus from this task.',
      priority: 'High',
      score: browserPressure >= 58 || distractingShare >= 0.4 ? 98 : 42,
    },
    {
      id: 'single-tab',
      title: 'Today\'s challenge',
      taskTitle: 'Protect one single-tab work sprint',
      body: 'Use only the tool you need for one block. No research drift, no tab hopping.',
      why: 'A cleaner browser field gives Velance stronger evidence about what helps you work.',
      focusGoal: 'Start a focused block with only the work tab or app open.',
      priority: 'Normal',
      score: browserPressure >= 42 ? 86 : 45,
    },
    {
      id: 'finish-pressure-task',
      title: 'Today\'s challenge',
      taskTitle: 'Finish one task that would make today lighter',
      body: 'Pick the pressure point, protect one block, and finish the smallest complete version.',
      why: `${overdue} overdue and ${highPriority} high-priority task signal${overdue + highPriority === 1 ? '' : 's'} are competing for attention.`,
      focusGoal: 'Open Tasks, keep this challenge highlighted, then start Focus.',
      priority: 'High',
      score: overdue + highPriority > 0 ? 96 : 38,
    },
    {
      id: 'two-minute-triage',
      title: 'Today\'s challenge',
      taskTitle: 'Triage the task list before one focus block',
      body: 'Archive noise, pick one next action, and turn that task into focus evidence.',
      why: `${openTasks || 'Several'} open task${openTasks === 1 ? '' : 's'} can blur the next move if they stay unranked.`,
      focusGoal: 'Pick one task, then launch Focus from it.',
      priority: 'Normal',
      score: openTasks >= 6 ? 82 : 44,
    },
    {
      id: 'recovery-safe-block',
      title: 'Today\'s challenge',
      taskTitle: 'Complete a recovery-safe focus block',
      body: 'Make progress without borrowing energy from tomorrow.',
      why: 'Fatigue is the main constraint, so the challenge is controlled effort, not maximum effort.',
      focusGoal: 'Run a shorter session and stop cleanly.',
      priority: 'Normal',
      score: fatiguePressure ? 95 : 32,
    },
    {
      id: 'clean-finish',
      title: 'Today\'s challenge',
      taskTitle: 'End one block with a clean finish note',
      body: 'Stop with one sentence: what moved, what is next, and what should not follow you.',
      why: 'Clean exits reduce mental residue and make the next session easier to start.',
      focusGoal: 'Run Focus and use the review flow to save the finish note.',
      priority: 'Normal',
      score: sessions >= 3 ? 74 : 48,
    },
    {
      id: 'repeat-best-window',
      title: 'Today\'s challenge',
      taskTitle: 'Repeat your best recent focus condition',
      body: 'Use the same app, time window, and session length as a strong recent block.',
      why: avgFocus >= 72 ? `${avgFocus}/100 average focus is worth protecting before adding novelty.` : 'Repeating a known condition helps Velance separate pattern from luck.',
      focusGoal: 'Start Focus with the same setup as your strongest recent block.',
      priority: 'Normal',
      score: avgFocus >= 72 ? 90 : 46,
    },
    {
      id: 'one-variable',
      title: 'Today\'s challenge',
      taskTitle: 'Run one controlled focus experiment',
      body: 'Change only one thing, then compare the block to your usual rhythm.',
      why: primaryMove.evidence || 'A controlled experiment creates better insight than changing five habits at once.',
      focusGoal: primaryMove.action || 'Choose one change, start Focus, and keep the setup consistent.',
      priority: 'Normal',
      score: sessions >= 3 ? 76 : 40,
    },
    {
      id: 'habit-proof',
      title: 'Today\'s challenge',
      taskTitle: leadHabit ? `Give ${leadHabit.name} one proof block` : 'Give one habit a proof block',
      body: 'Turn the habit from intention into measured evidence.',
      why: leadHabit ? `${leadHabit.name} is ready for a clean linked session.` : 'Habit progress becomes trustworthy when it comes from focus evidence.',
      focusGoal: 'Launch Focus with this habit linked.',
      habit: leadHabit?.name || '',
      priority: 'Normal',
      score: leadHabit ? 78 : 35,
    },
    {
      id: 'switching-budget',
      title: 'Today\'s challenge',
      taskTitle: 'Keep one block inside a switching budget',
      body: 'Before you start, decide the one app or site that is allowed to carry the work.',
      why: 'Reducing context switches turns noisy activity into readable evidence.',
      focusGoal: 'Use one primary app for the whole session.',
      priority: 'Normal',
      score: productiveMinutes > 0 && distractingMinutes > 0 ? 70 : 40,
    },
    {
      id: 'first-hour-claim',
      title: 'Today\'s challenge',
      taskTitle: 'Claim the first serious work block',
      body: 'Do the meaningful task before opening low-value loops.',
      why: 'Early focus often changes the tone of the whole day.',
      focusGoal: 'Start Focus before checking optional tabs.',
      priority: 'High',
      score: (base % 3 === 0) ? 82 : 45,
    },
    {
      id: 'tiny-finish',
      title: 'Today\'s challenge',
      taskTitle: 'Ship the smallest complete version',
      body: 'Shrink the work until it can be finished, then finish it without expanding scope.',
      why: 'A finished small piece beats a large vague plan.',
      focusGoal: 'Write the smallest finish line, then start Focus.',
      priority: 'High',
      score: highPriority > 0 ? 88 : 52,
    },
    {
      id: 'distraction-audit',
      title: 'Today\'s challenge',
      taskTitle: 'Audit the one distraction that keeps winning',
      body: 'Notice when it appears, what it is replacing, and what boundary would remove it.',
      why: `${leadSite} has enough signal to deserve one honest audit.`,
      focusGoal: 'Run one work block after removing that distraction.',
      priority: 'Normal',
      score: browserPressure >= 35 ? 73 : 30,
    },
    {
      id: 'no-new-work',
      title: 'Today\'s challenge',
      taskTitle: 'Finish before adding anything new',
      body: 'Do not create a new task until one existing task is moved forward.',
      why: 'New work can feel productive while unfinished work keeps the pressure alive.',
      focusGoal: 'Choose an existing task and launch Focus from it.',
      priority: 'Normal',
      score: openTasks >= 4 ? 79 : 36,
    },
  ]

  return candidates
    .map((candidate, index) => ({
      ...candidate,
      score: Math.max(0, normalizeNumber(candidate.score) + ((base + index * 7) % 11)),
    }))
    .sort((a, b) => b.score - a.score)
}

export function pickDailyChallengeCandidate(candidates = [], dateKey = getTodayLocalDateKey()) {
  if (!candidates.length) {
    return {
      title: 'Today\'s challenge',
      taskTitle: 'Run one controlled focus experiment',
      body: 'Make one controlled change, run one focus block, and compare the result.',
      why: 'Velance needs one clean signal to make tomorrow smarter.',
      focusGoal: 'Start Focus from this challenge and keep the setup consistent.',
      priority: 'Normal',
    }
  }
  const shortList = [...candidates]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(7, candidates.length))
  return shortList[hashDateKey(dateKey) % shortList.length]
}

export function getDailyChallengeStats(tasks = [], todayKey = getTodayLocalDateKey()) {
  const challengeTasks = tasks
    .map((task) => ({ task, dateKey: getChallengeDateFromTask(task) }))
    .filter((entry) => entry.dateKey)
  const completedDates = new Set(
    challengeTasks
      .filter(({ task }) => String(task?.status || '').toLowerCase() === 'completed')
      .map((entry) => entry.dateKey),
  )
  const acceptedDates = new Set(challengeTasks.map((entry) => entry.dateKey))

  let currentStreak = 0
  for (let offset = 0; offset < 366; offset += 1) {
    const dateKey = shiftLocalDateKey(-offset, new Date(`${todayKey}T12:00:00`))
    if (completedDates.has(dateKey)) {
      currentStreak += 1
      continue
    }
    if (offset === 0) continue
    break
  }

  return {
    acceptedTotal: acceptedDates.size,
    completedTotal: completedDates.size,
    currentStreak,
    todayAccepted: acceptedDates.has(todayKey),
    todayCompleted: completedDates.has(todayKey),
  }
}
