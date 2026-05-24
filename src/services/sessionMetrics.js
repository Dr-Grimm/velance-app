function average(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function round(value, digits = 0) {
  const safe = Number.isFinite(value) ? value : 0
  const factor = 10 ** digits
  return Math.round(safe * factor) / factor
}

function sumSampleSeconds(samples = []) {
  return samples.reduce((sum, sample) => sum + (Number(sample?.seconds) || 0), 0)
}

export function getDominantProductiveLane(samples = []) {
  const productiveTotals = new Map()

  samples.forEach((sample) => {
    if (!sample?.observed || sample?.productive !== true) return
    const laneKey = String(sample?.laneKey || '').trim()
    if (!laneKey) return
    productiveTotals.set(laneKey, (productiveTotals.get(laneKey) || 0) + (Number(sample?.seconds) || 0))
  })

  let bestLaneKey = ''
  let bestSeconds = 0
  for (const [laneKey, seconds] of productiveTotals.entries()) {
    if (seconds > bestSeconds) {
      bestLaneKey = laneKey
      bestSeconds = seconds
    }
  }

  return {
    laneKey: bestLaneKey || null,
    seconds: bestSeconds,
  }
}

function normalizeSampleLane(sample = {}) {
  const lane = String(sample?.lane || '').trim().toLowerCase()
  if (lane === 'productive' || lane === 'supporting' || lane === 'unclear' || lane === 'distracting') {
    return lane
  }
  if (sample?.productive === true) return 'productive'
  if (sample?.productive === false) return 'distracting'
  return 'unclear'
}

export function deriveSessionMix(samples = []) {
  const observedSamples = samples.filter((sample) => sample?.observed)
  const dominantLane = getDominantProductiveLane(observedSamples)

  let productiveSeconds = 0
  let supportingSeconds = 0
  let distractingSeconds = 0
  let unclearSeconds = 0
  let activeObservedSeconds = 0

  observedSamples.forEach((sample) => {
    const seconds = Number(sample?.seconds) || 0
    if (!sample?.isIdle) activeObservedSeconds += seconds

    const lane = normalizeSampleLane(sample)
    if (lane === 'productive') productiveSeconds += seconds
    else if (lane === 'supporting') supportingSeconds += seconds
    else if (lane === 'distracting') distractingSeconds += seconds
    else unclearSeconds += seconds
  })

  return {
    observedSeconds: sumSampleSeconds(observedSamples),
    observedSampleCount: observedSamples.length,
    activeObservedSeconds,
    productiveSeconds,
    supportingSeconds,
    distractingSeconds,
    unclearSeconds,
    dominantProductiveLaneKey: dominantLane.laneKey,
    dominantProductiveLaneSeconds: dominantLane.seconds,
  }
}

export function computeSessionAggregateRates({
  totalKeystrokes = 0,
  totalMouseDistance = 0,
  totalMouseClicks = 0,
  totalScrollDelta = 0,
  observedSeconds = 0,
  observedSampleCount = 0,
} = {}) {
  const observedMinutes = Math.max((Number(observedSeconds) || 0) / 60, 1 / 60)
  const samples = Math.max(Number(observedSampleCount) || 0, 1)
  const averageMouseDistancePerSample = (Number(totalMouseDistance) || 0) / samples

  return {
    averageKpm: Math.round((Number(totalKeystrokes) || 0) / observedMinutes),
    averageWpm: Math.round(((Number(totalKeystrokes) || 0) / 5) / observedMinutes),
    mouseIntensity: Math.round(Math.min(averageMouseDistancePerSample / 300, 1) * 100),
    totalMouseDistance: Math.round(Number(totalMouseDistance) || 0),
    totalMouseClicks: Number(totalMouseClicks) || 0,
    totalScrollDelta: Number(totalScrollDelta) || 0,
  }
}

export function getDominantContextFromEntries(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return null
  return [...entries]
    .sort((left, right) => (Number(right?.seconds) || 0) - (Number(left?.seconds) || 0))[0] || null
}

export function getAverageFatigueTrend(sessions = [], days = []) {
  return days.map((day) => {
    const daySessions = sessions.filter((session) => session?.date === day)
    const averageFatigue = daySessions.length
      ? Math.round(average(daySessions.map((session) => Number(session?.fatigueScore) || 0)))
      : 0

    return {
      date: day,
      averageFatigue,
      count: daySessions.length,
    }
  })
}
