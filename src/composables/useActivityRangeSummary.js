import { computed, unref } from 'vue'
import { useAmbientTracker } from './useAmbientTracker.js'

export function useActivityRangeSummary(dateKeysRef) {
  const ambient = useAmbientTracker()

  const entries = computed(() => {
    const keys = Array.isArray(unref(dateKeysRef)) ? unref(dateKeysRef) : []
    if (!keys.length) return []
    return ambient.getEntriesForDateKeys(keys)
  })

  const categoryBreakdown = computed(() => ambient.getCategoryBreakdown(entries.value))
  const appBreakdown = computed(() => ambient.getAppBreakdown(entries.value))
  const productivityScore = computed(() => ambient.getProductivityScore(entries.value))
  const totalTrackedSeconds = computed(() => entries.value.reduce((sum, entry) => sum + (entry.duration || 0), 0))
  const totalTrackedMins = computed(() => Math.round(totalTrackedSeconds.value / 60))
  const topCategory = computed(() => categoryBreakdown.value[0] || null)

  return {
    entries,
    categoryBreakdown,
    appBreakdown,
    productivityScore,
    totalTrackedSeconds,
    totalTrackedMins,
    topCategory,
  }
}
