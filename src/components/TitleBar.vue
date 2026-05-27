<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const isMaximized = ref(false)

// Only render the custom bar when running inside Electron on Windows/Linux.
// On macOS, Electron handles the title bar natively via titleBarStyle: hiddenInset.
const api = window.velance
const showBar = Boolean(api?.minimizeWindow) && api?.platform !== 'darwin'

function minimize() {
  api?.minimizeWindow?.()
}

function toggleMaximize() {
  api?.maximizeWindow?.()
}

function close() {
  api?.closeWindow?.()
}

onMounted(() => {
  if (!showBar) return
  api?.onMaximizeChange?.((val) => {
    isMaximized.value = Boolean(val)
  })
})

onUnmounted(() => {
  if (!showBar) return
  api?.removeMaximizeChangeListener?.()
})
</script>

<template>
  <div v-if="showBar" class="titlebar">
    <!-- Drag region fills all remaining space -->
    <div class="titlebar-drag" />

    <!-- Window controls — must NOT be draggable -->
    <div class="titlebar-controls">
      <button class="tb-btn tb-min" title="Minimize" @click="minimize">
        <!-- Minimize: horizontal line -->
        <svg width="10" height="1" viewBox="0 0 10 1" fill="none" aria-hidden="true">
          <rect width="10" height="1" rx="0.5" fill="currentColor" />
        </svg>
      </button>

      <button class="tb-btn tb-max" :title="isMaximized ? 'Restore' : 'Maximize'" @click="toggleMaximize">
        <!-- Maximize: single square -->
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" />
        </svg>
        <!-- Restore: two overlapping squares -->
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="2.5" y="0.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1" />
          <rect x="0.5" y="2.5" width="7" height="7" rx="1" fill="var(--bg-app)" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>

      <button class="tb-btn tb-close" title="Close" @click="close">
        <!-- Close: × -->
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  height: 32px;
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
  /* Transparent — whatever the app background is shows through */
  background: transparent;
  position: relative;
  z-index: 9999;
}

.titlebar-drag {
  flex: 1;
}

.titlebar-controls {
  display: flex;
  align-items: stretch;
  -webkit-app-region: no-drag;
}

.tb-btn {
  width: 46px;
  height: 32px;
  background: transparent;
  border: none;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: background 0.12s ease, color 0.12s ease;
  padding: 0;
  outline: none;
}

.tb-btn:hover {
  background: var(--surface-muted);
  color: var(--text-main);
}

.tb-btn:active {
  opacity: 0.7;
}

/* Close button turns red on hover (Windows convention) */
.tb-close:hover {
  background: #e81123;
  color: #ffffff;
}

.tb-close:active {
  background: #c40c1b;
}
</style>
