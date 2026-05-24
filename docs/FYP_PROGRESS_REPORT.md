# Velance FYP Progress Report

Prepared on: 2026-03-17
For supervisor meeting on: 2026-03-18

## 1. Executive Summary

Velance is currently a working local-first desktop productivity analytics application built with Vue 3, Electron, and SQLite. It is no longer just a timer or task board. The current system already supports:

- authentication with Supabase email OTP and Google OAuth
- local persistence for tasks, habits, sessions, settings, ambient activity logs, and cached insights
- live focus session tracking using OS-level activity signals
- continuous ambient screen-time tracking while the app is running
- dashboard, analytics, habit tracking, task planning, and AI-assisted insights

The strongest technical contribution so far is the end-to-end telemetry pipeline:

1. native desktop hooks collect active window and input activity
2. the renderer converts those signals into a focus score and fatigue score
3. the session payload is persisted locally with full timelines and breakdowns
4. analytics and insight modules reuse the same stored telemetry

This means the application already has a real behavioral-data loop, not only manual data entry.

## 2. Problem the App Solves

Most productivity apps rely on self-reporting, timers, or checklists. Velance tries to go further by measuring how work actually happens on the desktop:

- which app or browser context is active
- how often the user switches windows
- whether the user is idle or active
- typing and pointer rhythm
- whether work patterns look stable, fragmented, or fatigue-limited

The goal is to combine planning, execution, behavioral tracking, and feedback in one local-first desktop system.

## 3. Current Implemented Modules

### 3.1 Authentication and User Identity

Implemented:

- Supabase email OTP sign-in and sign-up
- Google OAuth sign-in through the system browser
- protected routes in the renderer
- profile sync using Supabase user metadata
- quick-login memory for returning users

Technical notes:

- current auth logic is handled in `src/store/auth.js`
- the OAuth browser handoff is implemented in `electron/main.js`
- Supabase client setup lives in `src/lib/supabase.js`

Important architecture decision:

- Supabase is used mainly for identity and session handling
- workspace data is still stored locally on the device, not in Supabase tables

### 3.2 Application Shell

Implemented:

- protected desktop app layout with sidebar navigation
- route-based modules for dashboard, tasks, focus, analytics, screen time, habits, insights, settings, profile, and auth
- theme switching with persisted settings
- renderer-level fatal error overlay to avoid blank-screen failures

Technical notes:

- Vue Router uses hash history for Electron compatibility
- global app bootstrapping and session restoration happen in `src/App.vue`

### 3.3 Tasks Module

Implemented:

- task CRUD
- status workflow: `to-do`, `in-progress`, `completed`
- multiple views: list, kanban, timeline
- due-date and priority handling
- automatic next-task recommendation
- one-click launch from task into a tracked focus session

Technical details:

- tasks are persisted through the Pinia store and data service layer
- task urgency scoring is rule-based:
  - overdue: +100
  - due today: +60
  - high priority: +30
  - normal priority: +15
  - low priority: +5
  - in-progress: +20
  - linked habit: +5

This gives Velance a lightweight prioritization model without requiring a remote backend.

### 3.4 Habit Module

Implemented:

- habit CRUD
- per-habit daily target minutes
- habit-linked focus sessions
- streak calculation
- average focus per habit
- total minutes per habit
- 30-day / 90-day habit heatmap
- best-streak and next-habit indicators

Technical notes:

- habit performance is derived from stored focus session data, not separate manual habit logs
- this is efficient because the focus session becomes the canonical evidence of actual habit execution

### 3.5 Focus Session Module

Implemented:

- session setup with goal, duration, linked task, and linked habit
- duration presets and custom durations
- optional minimize-on-start behavior
- live session tracking state
- pause, resume, background, and stop controls
- live score display
- live observed app and recent activity feed
- timeline of score slices
- review state after session completion
- session mix breakdown
- tracked apps summary
- focus pillar summary
- flow, drift, and recovery status events

This module is the core of the project because it turns raw telemetry into interpretable productivity signals.

### 3.6 Screen Time / Ambient Tracking Module

Implemented:

- background active-window tracking
- ambient chunk persistence
- browser and app classification into categories
- productive / neutral / distracting labeling
- 24-hour daily timeline
- category donut and hourly breakdown
- daily productivity pulse
- weekly pulse trend
- top distractor analysis
- custom user classification rules

This module works independently from explicit focus sessions, which is useful because it gives Velance broader context about how the day is unfolding while the app is open.

### 3.7 Analytics Module

Implemented:

- day, 7-day, and 30-day views
- focus trend chart
- session count trend
- peak hours view
- app usage breakdown
- fatigue trend panel
- task status distribution
- habit total-minute comparison

Technical design:

- analytics combines data from stored focus sessions and ambient activity
- this gives both a session-level view and a broader behavioral view

### 3.8 Insights Module

Implemented:

- built-in local insights
- optional Gemini-generated insights using tracked data as context
- insight caching
- automatic cache invalidation after new sessions

Current mode:

- if a Gemini API key is provided, the renderer sends a structured prompt to the Electron main process
- if Gemini fails, Velance falls back to deterministic local insight generation

### 3.9 Settings and Profile

Implemented:

- theme control
- privacy and tracking settings UI
- notification settings UI
- Gemini API key configuration
- export local data as JSON
- clear local workspace data
- profile editing for name, role, goal, and working hours

Important caveat:

- not all settings are fully enforced in runtime yet
- some are persisted and displayed, but not yet used to control the tracking engine

## 4. Technical Architecture

## 4.1 Renderer Layer

Used technologies:

- Vue 3 Composition API
- Pinia for state management
- Vue Router for page navigation
- ApexCharts for charts
- Lucide Vue icons
- custom CSS-based UI styling

Important note:

- although `vuetify` exists in dependencies, the current UI is mainly custom-built and not materially dependent on Vuetify components

## 4.2 Desktop / Backend Layer

Velance does not use a conventional remote backend for workspace data. Instead, Electron main process acts as the privileged backend layer.

Responsibilities in the Electron layer:

- active window monitoring
- low-level input monitoring
- notifications
- secure preload bridge exposure
- local database initialization
- IPC handlers for data operations
- Gemini API proxying
- Google OAuth browser handoff

## 4.3 Persistence Layer

The data layer has three levels of resilience:

1. Primary local database:
   - `better-sqlite3`
   - local file in Electron userData

2. Secondary repository fallback:
   - JSON file repository when native SQLite is unavailable

3. Local mirror fallback:
   - `localStorage` mirror in the renderer for settings, tasks, habits, sessions, and insight cache

This is a strong architectural choice because it keeps the app usable even if the native bridge or database becomes temporarily unavailable.

## 4.4 Data Model

Main persistent entities:

- `settings`
- `tasks`
- `habits`
- `focus_sessions`
- `ambient_activity_logs`
- `custom_classification_rules`
- `insight_cache`

The `focus_sessions` table is especially important because it stores:

- score outputs
- raw totals such as keystrokes and clicks
- app and window breakdown JSON
- timeline slices
- status events
- distraction logs
- switch logs
- fatigue drivers
- linked task and habit IDs
- formula version

This makes the model suitable for later calibration, visualization, and research discussion.

## 5. Focus Score Calculation

The focus score is implemented in `src/composables/useActivityTracker.js`. It is a deterministic heuristic model, not a trained machine-learning model.

### 5.1 Sampling Model

- raw tracking samples arrive every 2 seconds
- slices are committed every 10 seconds
- idle threshold is 15 seconds without input
- Velance ignores its own window when possible, so it tries to score the actual work app instead of the tracker UI

### 5.2 Time Windows Used by the Model

The model uses rolling windows:

- last 60 seconds for activity intensity
- last 120 seconds for active-vs-idle presence
- last 300 seconds for switching continuity
- last 600 seconds for dominant-lane stability

### 5.3 Four Focus Pillars

#### Presence

Presence measures whether the user is actively engaged instead of drifting or going idle.

Formula:

```text
activeRatio120 = activeSeconds120 / observedSeconds120
idleBurstPenalty10 = min(idleBurstsInLast10Min / 4, 1)

presence =
  100 * clamp(
    0.7 * activeRatio120 +
    0.3 * (1 - idleBurstPenalty10),
    0,
    1
  )
```

Interpretation:

- higher active time improves presence
- repeated idle bursts reduce it

#### Activity

Activity measures actual input rhythm using keyboard and pointer behavior.

Formula:

```text
typingNorm = min(keysLast60 / 160, 1)
pointerNorm = min(((mouseLast60 / 3000) + (clicksLast60 / 12) + (scrollLast60 / 40)) / 3, 1)
activityRaw = 0.6 * typingNorm + 0.4 * pointerNorm
```

The model also applies a "quiet work floor" for concentrated work that has low input noise but high stability:

```text
quietWorkFloor = 0.4
only if:
  activeRatio120 >= 0.85
  switchesPerMinute5 <= 1
  dominantLaneShare10 >= 0.6

activity = 100 * max(activityRaw, quietWorkFloor)
```

Interpretation:

- typing contributes more than pointer motion
- quiet but stable reading or coding can still get a respectable activity score

#### Continuity

Continuity penalizes task switching.

It uses window switches per minute over the recent 5-minute window:

```text
if rate <= 0.6 -> 100
if 0.6 < rate <= 2 -> linearly maps 100 to 75
if 2 < rate <= 4 -> linearly maps 75 to 25
if 4 < rate <= 6 -> linearly maps 25 to 0
if rate > 6 -> 0
```

Interpretation:

- one stable app/window lane is rewarded
- frequent context hopping is treated as fragmentation

#### Stability

Stability measures how much of recent time is spent in the dominant context lane.

Formula:

```text
stability = dominantLaneShare10 * 100
```

Interpretation:

- if most recent active time stays in one lane, stability is high
- if work is scattered across many apps or windows, stability drops

### 5.4 Final Focus Score

The four pillars are weighted as follows:

```text
focus =
  0.30 * presence +
  0.25 * activity +
  0.30 * continuity +
  0.15 * stability
```

So the focus model emphasizes:

- being present
- staying continuous
- then rewarding measured activity
- then confirming stability

### 5.5 Session-Level Interpretation

The live focus score is updated continuously, but the final stored session focus score is not just the last instant value.

At session stop:

- each 10-second slice is stored
- the final session focus score is the average of all slice scores

This is good because it reduces the effect of one noisy ending sample.

### 5.6 Secondary Focus Behaviors

Velance also derives higher-level session states:

- deep work accumulates when:
  - focus score >= 75
  - continuity >= 65
  - presence >= 70
- `bestFlowSeconds` stores the longest uninterrupted strong-flow duration
- drift is detected when focus drops below 58 after the session is already underway
- recovery is detected when a drifting session returns to at least 72

This makes the scoring system more explainable than a single scalar score alone.

## 6. Fatigue Score Calculation

The fatigue score is also implemented in `src/composables/useActivityTracker.js`. It is a workload-pressure heuristic, not a medical or clinical fatigue model.

### 6.1 Fatigue Drivers

The score uses four drivers:

- duration load
- idle load
- switch load
- focus decay load

### 6.2 Duration Load

Longer sessions increase fatigue pressure using a piecewise curve:

```text
0-25 min   -> scales 0 to 20
25-50 min  -> scales 20 to 45
50-90 min  -> scales 45 to 100
90+ min    -> 100
```

Interpretation:

- short sessions add little fatigue
- fatigue rises much faster after 50 minutes
- very long sessions are treated as high load

### 6.3 Idle Load

Idle load measures drift and recovery cost.

Formula:

```text
idleRatioSession = idleSeconds / elapsedSeconds
idleLoad =
  100 * clamp(
    0.6 * idleRatioSession +
    0.4 * min(idleBurstCount / 6, 1),
    0,
    1
  )
```

Interpretation:

- total idle time matters
- repeated idle bursts matter too
- a session with many short stalls can still score as fatiguing

### 6.4 Switch Load

Switch load measures how much cognitive overhead comes from context switching.

Formula:

```text
sessionMinutes = max(elapsedSeconds / 60, 1)
switchesPerMinuteSession = windowSwitchCount / sessionMinutes
switchLoad = 100 * min(switchesPerMinuteSession / 4, 1)
```

Interpretation:

- switching four times per minute or more saturates this component

### 6.5 Focus Decay Load

This compares early-session focus to late-session focus.

Formula:

```text
focusHistory = stored slices + current provisional focus
firstThird = average(first third of focus history)
lastThird = average(last third of focus history)

focusDecayLoad = 100 * clamp((firstThird - lastThird) / 40, 0, 1)
```

Interpretation:

- if focus collapses later in the session, fatigue rises
- if the session remains stable, this term stays low

### 6.6 Final Fatigue Score

Weights:

```text
fatigue =
  0.40 * durationLoad +
  0.20 * idleLoad +
  0.20 * switchLoad +
  0.20 * focusDecayLoad
```

Risk thresholds:

```text
0-34   -> Low
35-64  -> Moderate
65-100 -> High
```

### 6.7 Stored Session Fatigue

Just like focus, the stored final session fatigue score is the average of committed slices, not only the last moment of the session.

This is a reasonable design choice because fatigue should represent session pressure over time, not a single snapshot.

## 7. Ambient Productivity Pulse Calculation

Separate from explicit focus sessions, Velance computes a daily ambient productivity pulse from background classified usage.

Formula:

```text
score =
  ((productiveSec * 2 - distractingSec + neutralSec * 0.5) / (totalSec * 2)) * 100
```

Modifiers:

- +5 if there is any productive chunk >= 15 minutes
- -5 if total switches > 10
- -10 if total switches > 20
- -3 if any activity occurs after 23:00

Then the result is clamped to 0-100.

This score is useful as a daily behavioral summary, but it is distinct from the focus-session score.

## 8. Services and Technologies Used

### Frontend

- Vue 3
- Pinia
- Vue Router
- ApexCharts / `vue3-apexcharts`
- Lucide Vue icons
- custom CSS design system

### Desktop Runtime

- Electron
- preload bridge with `contextBridge` and IPC
- Electron notifications

### Native Telemetry / OS Hooks

- `active-win` for active window metadata
- `uiohook-napi` for global keyboard and mouse signals

### Local Persistence

- `better-sqlite3` as the main local database
- JSON fallback repository when native SQLite is unavailable
- `localStorage` mirror for fallback and bootstrapping

### Authentication and External Services

- Supabase Auth
- Google OAuth via system browser callback handoff
- Gemini API for optional AI insights

### Build and Packaging

- Vite
- `vite-plugin-electron`
- Electron Builder is installed for packaging, although packaging scripts are not yet finalized

## 9. Strengths of the Current Build

The project already has several strong points:

- it is end-to-end functional, not just a UI mockup
- it uses real desktop telemetry instead of purely manual input
- it is local-first, which is strong for privacy and offline use
- it has a resilient persistence strategy with multiple fallbacks
- the focus and fatigue models are explainable because they are rule-based
- analytics, insights, habits, and tasks all reuse the same session evidence

From an FYP perspective, the strongest technical story is that Velance already demonstrates:

- desktop instrumentation
- multi-layer local persistence
- behavior scoring
- analytics visualization
- explainable productivity heuristics

## 10. Current Downsides, Flaws, and Areas Needing Refinement

This section is important to present honestly.

### 10.1 Runtime Settings Are Not Fully Enforced

Several settings are saved and shown in the UI but are not currently wired into the tracking engine:

- `trackingEnabled`
- `keystrokeEnabled`
- `mouseEnabled`
- `notificationsEnabled`
- `breakReminders`
- `dataRetentionDays`

Current impact:

- tracking still starts in the desktop process
- notifications are still sent by code paths that do not check the setting
- retention days are stored but no cleanup job is enforcing deletion

This is one of the biggest gaps between UI completeness and runtime completeness.

### 10.2 Tracking Starts Too Early for a Strict Privacy Claim

Ambient tracking is started in the Electron main process on app startup. Because of that:

- tracking can begin before an explicit user opt-in flow
- data can be written under the default `local-user` identity before login state is finalized

For a stronger privacy story, tracking should be explicitly gated.

### 10.3 The Scoring Model Is Heuristic, Not Yet Validated

The focus and fatigue calculations are well structured, but they are still heuristic.

Current limitations:

- no calibration against labeled user-study data
- no comparison against external validated fatigue or workload scales
- thresholds and weights are hand-tuned

This is acceptable for a prototype or FYP mid-stage, but it should be described as an explainable scoring model, not as a scientifically validated cognitive measure.

### 10.4 Some Metrics Are Misnamed as Averages

There is an important technical limitation in the session summary:

- `keystrokesPerMin`
- `averageKpm`
- `averageWpm`

These are derived from the most recent 60-second rolling keystroke window, not from the whole session history.

So currently:

- the name suggests a session average
- the implementation behaves more like "latest rolling pace"

This should be corrected for metric accuracy.

### 10.5 `mouseIntensity` Is Snapshot-Like, Not a True Session Aggregate

`mouseIntensity` is updated from recent sample movement, then stored into session summary. That means it behaves more like a current or recent-slice signal than a rigorously aggregated whole-session metric.

### 10.6 `supportingSeconds` Is Scaffolded but Not Actually Calculated

The data model and UI include `supportingSeconds`, and the review screen displays a "Support" segment. However, the tracker currently increments:

- `productiveSeconds`
- `distractingSeconds`
- `unclearSeconds`

but not `supportingSeconds`.

So this review segment is effectively unimplemented right now.

### 10.7 Fatigue Aggregation in Analytics Is Coarse

The app stores numeric `fatigueScore`, but dashboard and analytics often reduce fatigue into coarse risk categories:

- dashboard: if any session today is `High`, the whole day is shown as `High`
- analytics fatigue chart: converts counts of `High` and `Moderate` sessions into a percentage-style summary

This loses detail from the raw numeric fatigue signal and can either exaggerate or flatten the actual trend.

### 10.8 Classification Quality Can Bias Analytics

A large part of ambient analytics depends on rule-based classification.

Risks:

- unknown apps become neutral or low-confidence
- browser classification depends on keyword heuristics
- the same app can be productive or distracting depending on context, but the current logic is still mostly rule-based
- music apps are currently marked productive, which may overestimate productive time for some users

This means pulse and productivity analytics are only as strong as the classification layer.

### 10.9 Browser Fallback Mode Has Weaker Observability

If native hooks are not available, Velance falls back to browser-level tracking. That is useful for robustness, but it cannot provide the same quality of desktop context as the native Electron path.

### 10.10 Some Schema Fields Are Present but Not Yet Meaningfully Used

Examples:

- `sessionMode` is always effectively `Observe`
- `coach` is stored as a placeholder object with empty strengths/frictions
- profile working hours are saved but not yet used in analytics or recommendation logic
- task/habit/goal metadata are mainly contextual labels, not strong model inputs

This means the schema is ahead of the current logic in a few places.

### 10.11 Security and Hardening Gaps

Important technical concerns:

- Electron window uses `sandbox: false`
- Gemini API key is stored locally as plain settings data
- a legacy `electron/authService.js` file still contains a hard-coded Google client secret and JWT secret
- that legacy auth file does not appear to be part of the active Supabase-based auth path, but it still increases maintenance and security risk

This should be cleaned before any real deployment claim.

### 10.12 No Automated Test Coverage Yet

At the moment:

- no test files are present
- no test scripts are defined in `package.json`
- repository README is still boilerplate

This is not a functional blocker for a prototype, but it is a serious engineering maturity gap.

### 10.13 Encoding Cleanup Is Needed

Some default icon strings appear with encoding artifacts in source, such as mojibake-like values instead of clean symbols. Even if the UI still renders acceptably, the source should be normalized to avoid future corruption or cross-platform issues.

## 11. Recommended Next Upgrades

## 11.1 Highest Priority

1. Enforce settings at runtime
   - actually stop tracking when tracking is disabled
   - respect keystroke and mouse toggles
   - respect notifications and break reminder toggles

2. Implement retention cleanup
   - automatically prune sessions and ambient logs older than `dataRetentionDays`

3. Fix metric semantics
   - compute true session-average KPM/WPM
   - compute aggregated mouse intensity
   - either implement `supportingSeconds` or remove it from UI until ready

4. Harden privacy flow
   - start ambient tracking only after explicit consent or enabled setting
   - clearly separate pre-login and signed-in local workspaces if needed

## 11.2 Model Refinement

5. Calibrate focus and fatigue scoring
   - run controlled test sessions
   - compare model outputs against manual labels
   - tune weights and thresholds with evidence

6. Improve fatigue analytics
   - chart raw fatigue scores over time
   - include intra-session fatigue slope
   - compare fatigue by session length and time of day

7. Improve classification quality
   - add more contextual browser rules
   - capture user feedback on misclassifications
   - support category corrections directly from analytics views

## 11.3 Product and Research Upgrades

8. Use profile working hours and habit context in recommendations
9. Implement true coaching outputs in the stored `coach` object
10. Add comparative analytics by task type, habit type, and session duration
11. Add export/import for full local workspace portability
12. Add test coverage for analytics services and scoring logic

## 12. Suggested Way to Explain the Project in the Meeting

One concise explanation:

"Velance is a local-first desktop productivity analytics app. It combines planning modules like tasks and habits with real OS-level work telemetry. The key contribution so far is that the app can collect active-window and input behavior, convert it into an explainable focus score and fatigue score, persist the full session timeline in SQLite, and then reuse that same data in dashboard, analytics, screen-time, and AI insight modules."

If asked what is already complete:

- the full desktop telemetry pipeline
- local persistence and analytics
- task and habit integration
- focus session review
- ambient screen-time analytics
- AI or local insight generation

If asked what still needs work:

- runtime enforcement of privacy/settings
- stronger metric validation
- better fatigue aggregation
- removal of legacy secret-bearing auth code
- testing, documentation, and refinement

## 13. Final Technical Assessment

Current project maturity:

- not just UI prototype
- not yet production-grade
- best described as an advanced functional prototype with a real local desktop analytics pipeline

That is a good FYP position because the system already proves the hardest technical part:

- native desktop data collection
- local-first storage
- explainable scoring
- analytics reuse

The next phase should focus on correctness, calibration, privacy enforcement, and software engineering maturity.

## 14. Key Source Files

Core implementation files for discussion:

- `electron/main.js`
- `electron/db.js`
- `electron/ipcData.js`
- `src/store/velance.js`
- `src/store/auth.js`
- `src/composables/useActivityTracker.js`
- `src/composables/useAmbientTracker.js`
- `src/services/analyticsService.js`
- `src/services/dataService.js`
- `src/views/FocusSession.vue`
- `src/views/Analytics.vue`
- `src/views/ScreenTime.vue`
- `src/views/Tasks.vue`
- `src/views/Habits.vue`
- `src/views/Insights.vue`
- `src/views/Settings.vue`
