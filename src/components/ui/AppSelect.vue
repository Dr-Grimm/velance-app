<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CheckIcon, ChevronDownIcon } from 'lucide-vue-next'

const props = defineProps({
  modelValue: { type: [String, Number, Boolean], default: '' },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'Select' },
  ariaLabel: { type: String, default: 'Select option' },
  disabled: { type: Boolean, default: false },
  size: { type: String, default: 'default' },
})

const emit = defineEmits(['update:modelValue', 'change'])

const open = ref(false)
const root = ref(null)
const menu = ref(null)
const menuStyle = ref({})

const normalizedOptions = computed(() => props.options.map((option) => {
  if (option && typeof option === 'object') {
    return {
      value: option.value ?? '',
      label: option.label ?? String(option.value ?? ''),
      detail: option.detail ?? '',
      tone: option.tone ?? '',
    }
  }
  return {
    value: option,
    label: String(option ?? ''),
    detail: '',
    tone: '',
  }
}))

const selectedOption = computed(() => normalizedOptions.value.find((option) => String(option.value) === String(props.modelValue)) || null)
const displayLabel = computed(() => selectedOption.value?.label || props.placeholder)

function toggleOpen() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  open.value = true
}

function selectOption(option) {
  emit('update:modelValue', option.value)
  emit('change', option.value)
  open.value = false
}

function handleDocumentPointer(event) {
  if (!open.value || root.value?.contains(event.target) || menu.value?.contains(event.target)) return
  open.value = false
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    open.value = false
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleOpen()
  }
}

function updateMenuPosition() {
  if (!open.value || !root.value) return
  const rect = root.value.getBoundingClientRect()
  const menuWidth = Math.min(Math.max(rect.width, 210), window.innerWidth - 24)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12))
  const spaceBelow = window.innerHeight - rect.bottom - 18
  const spaceAbove = rect.top - 18
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow
  const maxHeight = Math.max(160, Math.min(340, openUp ? spaceAbove : spaceBelow))
  menuStyle.value = {
    left: `${left}px`,
    top: openUp ? 'auto' : `${Math.min(rect.bottom + 8, window.innerHeight - 172)}px`,
    bottom: openUp ? `${Math.max(12, window.innerHeight - rect.top + 8)}px` : 'auto',
    width: `${menuWidth}px`,
    maxHeight: `${maxHeight}px`,
  }
}

watch(open, async (value) => {
  if (!value) return
  await nextTick()
  updateMenuPosition()
})

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointer, true)
  window.addEventListener('resize', updateMenuPosition)
  window.addEventListener('scroll', updateMenuPosition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointer, true)
  window.removeEventListener('resize', updateMenuPosition)
  window.removeEventListener('scroll', updateMenuPosition, true)
})
</script>

<template>
  <div ref="root" class="app-select" :class="[size, { open, disabled }]">
    <button
      type="button"
      class="app-select-trigger"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggleOpen"
      @keydown="handleKeydown"
    >
      <span class="app-select-value" :class="{ muted: !selectedOption }">{{ displayLabel }}</span>
      <ChevronDownIcon class="app-select-chevron" size="15" />
    </button>

    <Teleport to="body">
      <transition name="select-pop">
        <div v-if="open" ref="menu" class="app-select-menu" :style="menuStyle" role="listbox">
          <button
            v-for="option in normalizedOptions"
            :key="`${option.value}-${option.label}`"
            type="button"
            class="app-select-option"
            :class="[option.tone, { selected: String(option.value) === String(modelValue) }]"
            role="option"
            :aria-selected="String(option.value) === String(modelValue)"
            @click="selectOption(option)"
          >
            <span class="app-select-option-copy">
              <strong>{{ option.label }}</strong>
              <small v-if="option.detail">{{ option.detail }}</small>
            </span>
            <CheckIcon v-if="String(option.value) === String(modelValue)" size="14" />
          </button>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-select {
  position: relative;
  min-width: 0;
  color: var(--text-main);
  z-index: 5;
  isolation: isolate;
}

.app-select.open {
  z-index: 420;
}

.app-select-trigger {
  width: 100%;
  min-height: 44px;
  padding: 0 13px 0 14px;
  border-radius: 14px;
  border: 1px solid var(--surface-outline);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--bg-card) 96%, transparent), var(--surface-muted));
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 760;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
  outline: none;
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.035);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.app-select.compact .app-select-trigger {
  min-height: 36px;
  border-radius: 12px;
  font-size: 12px;
}

.app-select-trigger:hover,
.app-select.open .app-select-trigger {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent-base) 26%, var(--surface-outline));
  box-shadow: 0 12px 28px rgba(14, 165, 233, 0.08);
}

.app-select-trigger:focus-visible {
  border-color: var(--surface-outline-strong);
  box-shadow: 0 0 0 4px rgba(0, 180, 216, 0.1);
}

.app-select-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-select-value.muted {
  color: var(--text-muted);
}

.app-select-chevron {
  flex: 0 0 auto;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.app-select.open .app-select-chevron {
  transform: rotate(180deg);
}

.app-select-menu {
  position: fixed;
  z-index: 4000;
  padding: 7px;
  overflow: auto;
  border-radius: 16px;
  border: 1px solid var(--surface-outline);
  background: color-mix(in srgb, var(--surface-strong) 96%, var(--bg-card));
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(18px);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent-base) 34%, transparent) transparent;
}

.app-select-option {
  width: 100%;
  min-height: 42px;
  padding: 9px 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text-main);
  font: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
  text-align: left;
}

.app-select-option:hover,
.app-select-option.selected {
  background: color-mix(in srgb, var(--accent-base) 12%, transparent);
}

.app-select-option-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.app-select-option strong {
  font-size: 13px;
  font-weight: 760;
}

.app-select-option small {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.3;
}

.app-select-option.high strong {
  color: #ef4444;
}

.app-select-option.normal strong {
  color: var(--accent-base);
}

.app-select-option.low strong,
.app-select-option.good strong {
  color: #0f766e;
}

.app-select.disabled {
  opacity: 0.6;
}

.select-pop-enter-active,
.select-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.select-pop-enter-from,
.select-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

/* ─── DARK THEME OVERRIDES ─────────────────────────────────────────────────── */
/* Priority option labels use dark semantic colors invisible on dark dropdown surfaces */
:global(.dark-theme .app-select-option.low strong),
:global(.dark-theme .app-select-option.good strong){
  color: #34d399 !important;
}
</style>
