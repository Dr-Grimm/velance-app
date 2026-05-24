import {
  AppleIcon,
  BadgeDollarSignIcon,
  BookOpenIcon,
  BookMarkedIcon,
  BriefcaseBusinessIcon,
  ClipboardListIcon,
  Code2Icon,
  DropletIcon,
  DumbbellIcon,
  FootprintsIcon,
  FlowerIcon,
  HeartPulseIcon,
  HomeIcon,
  LanguagesIcon,
  LeafIcon,
  LightbulbIcon,
  MonitorOffIcon,
  MoonIcon,
  MusicIcon,
  PaletteIcon,
  PenLineIcon,
  ShapesIcon,
  TargetIcon,
  UsersIcon,
} from 'lucide-vue-next'

export const HABIT_ICON_OPTIONS = [
  { key: 'focus', label: 'Deep work', component: TargetIcon },
  { key: 'code', label: 'Code', component: Code2Icon },
  { key: 'read', label: 'Read', component: BookOpenIcon },
  { key: 'write', label: 'Write', component: PenLineIcon },
  { key: 'study', label: 'Study', component: BookMarkedIcon },
  { key: 'plan', label: 'Plan', component: ClipboardListIcon },
  { key: 'work', label: 'Work', component: BriefcaseBusinessIcon },
  { key: 'exercise', label: 'Exercise', component: DumbbellIcon },
  { key: 'walk', label: 'Walk or run', component: FootprintsIcon },
  { key: 'yoga', label: 'Yoga', component: LeafIcon },
  { key: 'meditate', label: 'Meditate', component: FlowerIcon },
  { key: 'sleep', label: 'Sleep', component: MoonIcon },
  { key: 'hydrate', label: 'Hydrate', component: DropletIcon },
  { key: 'nutrition', label: 'Nutrition', component: AppleIcon },
  { key: 'health', label: 'Health', component: HeartPulseIcon },
  { key: 'clean', label: 'Clean', component: HomeIcon },
  { key: 'money', label: 'Money', component: BadgeDollarSignIcon },
  { key: 'language', label: 'Language', component: LanguagesIcon },
  { key: 'music', label: 'Music', component: MusicIcon },
  { key: 'creative', label: 'Creative', component: PaletteIcon },
  { key: 'family', label: 'Family', component: UsersIcon },
  { key: 'screen', label: 'No screen', component: MonitorOffIcon },
  { key: 'learn', label: 'Learning', component: LightbulbIcon },
  { key: 'other', label: 'Other', component: ShapesIcon },
]

const ICON_ALIASES = {
  spark: 'other',
  fitness: 'exercise',
  energy: 'health',
  coffee: 'other',
  night: 'sleep',
  '\u26a1': 'other',
  '\u2728': 'other',
  '\ud83c\udfaf': 'focus',
  '\ud83d\udcbb': 'code',
  '\ud83d\udcda': 'read',
  '\ud83d\udcbc': 'work',
  '\u270d': 'write',
  '\u270d\ufe0f': 'write',
  '\u2764\ufe0f': 'health',
  '\u2764': 'health',
  '\ud83c\udfc3': 'walk',
  '\ud83d\udd25': 'health',
  '\u2615': 'other',
  '\ud83c\udf19': 'sleep',
}

const KEYWORD_MAP = [
  { pattern: /code|build|dev|ship|debug|program|software/i, key: 'code' },
  { pattern: /read|book/i, key: 'read' },
  { pattern: /study|learn|course|research|class/i, key: 'study' },
  { pattern: /write|journal|draft|note|essay/i, key: 'write' },
  { pattern: /plan|review|organize|todo|task/i, key: 'plan' },
  { pattern: /hydrate|water|drink/i, key: 'hydrate' },
  { pattern: /food|meal|diet|eat|nutrition/i, key: 'nutrition' },
  { pattern: /health|wellness|doctor|therapy/i, key: 'health' },
  { pattern: /sleep|rest|night/i, key: 'sleep' },
  { pattern: /work|client|ops|admin|career/i, key: 'work' },
  { pattern: /gym|workout|train|lift|fitness|exercise/i, key: 'exercise' },
  { pattern: /run|walk|steps|cardio/i, key: 'walk' },
  { pattern: /yoga|stretch|mobility/i, key: 'yoga' },
  { pattern: /meditat|breath|mindful|calm/i, key: 'meditate' },
  { pattern: /clean|room|house|home|chore/i, key: 'clean' },
  { pattern: /money|budget|finance|save|invest/i, key: 'money' },
  { pattern: /language|spanish|english|japanese|french/i, key: 'language' },
  { pattern: /music|piano|guitar|sing/i, key: 'music' },
  { pattern: /draw|design|paint|art|creative/i, key: 'creative' },
  { pattern: /family|friend|call|social/i, key: 'family' },
  { pattern: /screen|phone|scroll|digital/i, key: 'screen' },
  { pattern: /focus|deep/i, key: 'focus' },
]

const iconMap = Object.fromEntries(HABIT_ICON_OPTIONS.map((option) => [option.key, option.component]))

export function resolveHabitIconKey(icon, name = '') {
  if (icon && iconMap[icon]) return icon
  if (icon && ICON_ALIASES[icon]) return ICON_ALIASES[icon]

  const fallbackName = String(name || '')
  const keywordMatch = KEYWORD_MAP.find((entry) => entry.pattern.test(fallbackName))
  if (keywordMatch) return keywordMatch.key

  return 'other'
}

export function getHabitIconOption(icon, name = '') {
  const key = resolveHabitIconKey(icon, name)
  return HABIT_ICON_OPTIONS.find((option) => option.key === key) || HABIT_ICON_OPTIONS[HABIT_ICON_OPTIONS.length - 1]
}

export function getHabitIconComponent(icon, name = '') {
  return iconMap[resolveHabitIconKey(icon, name)] || ShapesIcon
}
