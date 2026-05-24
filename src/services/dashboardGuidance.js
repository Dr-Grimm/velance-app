export function buildDashboardStatusNote({
  consentResolved = false,
  trackingReady = false,
  backendKind = 'unknown',
} = {}) {
  if (!consentResolved) {
    return {
      label: 'Tracking waiting',
      text: 'Allow local tracking in Settings to start building your focus history on this device.',
      tone: 'warn',
    }
  }

  if (!trackingReady) {
    return {
      label: 'Tracking paused',
      text: 'Tracking is off in Settings, so new focus and ambient data will stay unchanged until you turn it back on.',
      tone: 'neutral',
    }
  }

  if (backendKind === 'sqlite') {
    return {
      label: 'Workspace ready',
      text: 'Local SQLite storage and tracking are ready for today.',
      tone: 'good',
    }
  }

  if (backendKind === 'json-fallback') {
    return {
      label: 'Local safe mode',
      text: 'Velance is still saving locally, but it is using fallback storage until SQLite is restored.',
      tone: 'warn',
    }
  }

  return {
    label: 'Recovery mode',
    text: 'Velance loaded a recovery snapshot after a storage issue. Review Settings if something looks missing.',
    tone: 'warn',
  }
}

export function buildDashboardRecommendation({
  isTracking = false,
  hasCompletedReview = false,
  consentResolved = false,
  trackingReady = false,
  backendKind = 'unknown',
  hasTasks = false,
  hasHabits = false,
  hasSessions = false,
  overdueCount = 0,
  currentFatigueRisk = 'Low',
  todaySessionsCount = 0,
  focusReadyTask = null,
  nextHabit = null,
  todayOutstandingTasks = 0,
  peakHour = null,
  peakHourLabel = 'next best block',
  currentHour = new Date().getHours(),
} = {}) {
  if (hasCompletedReview) {
    return {
      label: 'Session ready',
      title: 'Review the latest focus block',
      text: 'Your session summary is ready for a quick check before you move on.',
      cta: 'Review Session',
    }
  }

  if (isTracking) {
    return {
      label: 'Session running',
      title: 'Stay inside the current block',
      text: 'One clean block compounds better than switching context too early.',
      cta: 'Open Focus',
    }
  }

  if (!consentResolved) {
    return {
      label: 'Tracking off',
      title: 'Turn on local tracking when you want analytics',
      text: 'Tasks and habits already work. Enable local tracking later for focus scores and screen-time history.',
      cta: 'Open Privacy',
    }
  }

  if (!trackingReady) {
    return {
      label: 'Tracking paused',
      title: 'Resume tracking when you want fresh signals',
      text: 'Your existing history is still here, but new analytics will stay unchanged until tracking is turned back on.',
      cta: 'Open Privacy',
    }
  }

  if (backendKind === 'degraded') {
    return {
      label: 'Storage',
      title: 'Check workspace status',
      text: 'Your local data is available, but storage is running in recovery mode right now.',
      cta: 'Open Settings',
    }
  }

  if (!hasTasks && !hasHabits && !hasSessions) {
    return {
      label: 'First loop',
      title: 'Set up one task and one habit',
      text: 'That is enough to make the dashboard feel personal without adding noise.',
      cta: 'Create First Task',
    }
  }

  if (overdueCount > 0) {
    return {
      label: 'Today',
      title: 'Clear overdue work first',
      text: `${overdueCount} overdue item${overdueCount === 1 ? '' : 's'} need a quick decision before you add more.`,
      cta: 'Review Tasks',
    }
  }

  if (currentFatigueRisk === 'High' && todaySessionsCount > 0) {
    return {
      label: 'Recovery',
      title: 'Take a short reset before the next block',
      text: 'Today already shows real fatigue pressure, so recovery will help more than forcing another sprint.',
      cta: 'Set Break Timer',
    }
  }

  if (!todaySessionsCount && focusReadyTask) {
    return {
      label: 'Focus',
      title: 'Start with the clearest next task',
      text: `"${focusReadyTask.title}" is the cleanest launch point right now.`,
      cta: 'Start Focus Session',
    }
  }

  if (!todaySessionsCount && nextHabit) {
    return {
      label: 'Habit',
      title: `Keep ${nextHabit.name} alive today`,
      text: 'A short habit-linked block will keep your rhythm visible without overloading the day.',
      cta: 'Start Habit Focus',
    }
  }

  if (peakHour !== null && Math.abs(currentHour - peakHour) <= 1) {
    return {
      label: 'Peak window',
      title: `Use ${peakHourLabel} for demanding work`,
      text: 'Your recent sessions cluster here, so this is a strong time for deeper work.',
      cta: 'Start Focus Session',
    }
  }

  if (todayOutstandingTasks > 0) {
    return {
      label: 'Today',
      title: 'Close one due item next',
      text: `${todayOutstandingTasks} due today. Finishing one will tighten the rest of the day quickly.`,
      cta: 'Review Tasks',
    }
  }

  if (nextHabit) {
    return {
      label: 'Habit',
      title: `Protect ${nextHabit.name} before the day ends`,
      text: 'Your task load is calmer now, which is a good time to keep your routine steady.',
      cta: 'Open Habits',
    }
  }

  return {
    label: 'Momentum',
    title: 'Protect your best work window',
    text: `Your recent data keeps pointing to ${peakHourLabel} as a strong focus period.`,
    cta: 'Open Analytics',
  }
}
