function pad2(value) {
  return String(value).padStart(2, '0')
}

export function formatLocalDateKey(input = Date.now()) {
  const date = input instanceof Date ? new Date(input.getTime()) : new Date(input)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function getTodayLocalDateKey() {
  return formatLocalDateKey(Date.now())
}

export function getRecentLocalDateKeys(days = 7, anchor = Date.now()) {
  const safeDays = Math.max(1, Number(days) || 1)
  const start = anchor instanceof Date ? new Date(anchor.getTime()) : new Date(anchor)
  const keys = []

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const current = new Date(start.getTime())
    current.setDate(start.getDate() - offset)
    keys.push(formatLocalDateKey(current))
  }

  return keys
}

export function shiftLocalDateKey(offset = 0, anchor = Date.now()) {
  const current = anchor instanceof Date ? new Date(anchor.getTime()) : new Date(anchor)
  current.setDate(current.getDate() + Number(offset || 0))
  return formatLocalDateKey(current)
}
