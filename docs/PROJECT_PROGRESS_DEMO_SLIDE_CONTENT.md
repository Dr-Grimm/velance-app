# Project Progress Demo Presentation Slide Content

This document is written to match the PowerPoint templates shown by the user.

## Slide 1 - Project Description

**Slide Title**  
Project Description

**Slide Subtitle**  
Velance

**Blue Highlight Box - About**  
Velance is a local-first desktop productivity analytics application that monitors real work behavior across the operating system. It combines task planning, focus sessions, ambient activity tracking, analytics, and AI-assisted insights to help users understand how they work and improve it with evidence.

**Info Box 1 Title**  
Significance

**Info Box 1 Body**  
Unlike conventional productivity tools that depend on manual timers or self-reporting, Velance captures real behavioral signals such as app usage, activity rhythm, idle patterns, and context switching. This allows the system to produce a more accurate and meaningful view of focus, distraction, and fatigue throughout the day.

**Info Box 2 Title**  
Key Features

**Info Box 2 Body**  
Velance supports OS-level ambient tracking, structured focus sessions, and local-first data storage for privacy and offline reliability. The same telemetry pipeline powers productivity analytics, session review, habit and task insights, and AI-generated focus reflections.


## Slide 4 - Module 1: User & Profile Management

**Slide Title**  
Module 1 - User & Profile Management

**Slide Subtitle**  
Secure authentication and personalized workspace setup

**Card 1 Title**  
Secure Authentication

**Card 1 Body**  
Supports email OTP and Google OAuth sign-in, giving users a secure and familiar way to access the application.

**Card 2 Title**  
Protected User Access

**Card 2 Body**  
Protected routing and session restoration ensure that only authenticated users can enter and continue their workspace safely.

**Card 3 Title**  
Profile Personalization

**Card 3 Body**  
Users can manage profile details such as name, role, goals, and working hours to personalize their experience inside the system.

**Card 4 Title**  
Local-First User Workspace

**Card 4 Body**  
User identity is handled securely through Supabase, while productivity data remains stored locally for privacy, speed, and offline access.

**Suggested Image For Right Side**  
Use a screenshot collage of the login page, profile page, and settings/profile form to visually show authentication and personalization features.


## Slide 5 - Module 2: Focus Session & Task Management

**Slide Title**  
Module 2 - Focus Session & Task Management

**Slide Subtitle**  
Structured planning and tracked execution in one workflow

**Card 1 Title**  
Flexible Task Management

**Card 1 Body**  
Supports task creation, editing, prioritization, due dates, and status flow through `to-do`, `in-progress`, and `completed`.

**Card 2 Title**  
Multiple Planning Views

**Card 2 Body**  
Tasks can be managed through list, kanban, and timeline views, making it easier to organize both daily work and longer-term schedules.

**Card 3 Title**  
Direct Focus Launch

**Card 3 Body**  
Any task can be launched directly into a focus session, connecting planned work with actual tracked execution inside the system.

**Card 4 Title**  
Guided Focus Sessions

**Card 4 Body**  
Users can set a goal, choose a preset or custom duration, and link the session to a task or habit before starting.

**Card 5 Title**  
Live Session Monitoring

**Card 5 Body**  
During the session, Velance shows real-time focus score, observed apps, recent activity feed, and pause, resume, or stop controls.

**Card 6 Title**  
Post-Session Review

**Card 6 Body**  
After completion, the session is summarized through score breakdowns, tracked apps, focus pillars, and flow, drift, or recovery events.

**Suggested Image For Right Side**  
Use a combined screenshot of the task board and the focus session page with live score or session review visible.


## Slide 6 - Module 3: Activity Tracking Engine

**Slide Title**  
Module 3 - Activity Tracking Engine

**Slide Subtitle**  
Real-time telemetry, classification, and explainable productivity scoring

**Card 1 Title**  
OS-Level Signal Capture

**Card 1 Body**  
The engine continuously captures active-window changes and user input signals to observe how work is actually performed on the desktop.

**Card 2 Title**  
Ambient Tracking Pipeline

**Card 2 Body**  
Background activity is stored as ambient usage chunks, allowing the system to build a continuous picture of work patterns outside focus sessions.

**Card 3 Title**  
Context Classification

**Card 3 Body**  
Apps and browser contexts are automatically classified into meaningful productivity lanes such as productive, supporting, unclear, or distracting.

**Card 4 Title**  
Focus Score Calculation

**Card 4 Body**  
Live telemetry is converted into an explainable focus score using the four focus pillars: Presence, Activity, Continuity, and Stability.

**Card 5 Title**  
Fatigue Detection

**Card 5 Body**  
The system also estimates fatigue pressure by analyzing session duration, idle behavior, switching load, and focus decay over time.

**Card 6 Title**  
Future Enhancement

**Card 6 Body**  
Next improvements include stronger classification accuracy, better score calibration, and stricter runtime enforcement of privacy and tracking settings.

**Presentation Note**  
This slide should stay as the engine overview. Use the next slides for the four focus pillars and fatigue driver formulas.

**Suggested Image For Right Side**  
Use a screenshot of the focus session live tracker, screen-time page, or a telemetry-based analytics view that shows the scoring engine in action.


## Slide 7 - Technical Slide: Four Focus Pillars

**Slide Title**  
Four Focus Pillars

**Slide Subtitle**  
Final Focus Score = 0.30(Presence) + 0.25(Activity) + 0.30(Continuity) + 0.15(Stability)

**Card 1 Title**  
Presence

**Card 1 Body**  
Formula: `100 x clamp[0.7(Active Ratio) + 0.3(1 - Idle Burst Penalty)]`  
Presence evaluates whether the user is genuinely engaged with the session instead of drifting away from it. It rewards sustained active time and penalizes repeated idle bursts, making it a strong indicator of attention consistency.

**Card 2 Title**  
Activity

**Card 2 Body**  
Formula: `100 x max[(0.6 x Typing Norm + 0.4 x Pointer Norm), Quiet Work Floor]`  
Activity measures the rhythm of user input through keyboard and pointer behavior. It values active interaction, but it also preserves fair scoring for quieter work styles such as reading, reviewing, or concentrated coding when the session remains stable.

**Card 3 Title**  
Continuity

**Card 3 Body**  
Formula basis: window switches per minute over the last 5 minutes.  
Continuity reflects how steadily the user remains in the same working context. Low switching keeps the score high, while frequent app or window changes are interpreted as fragmentation, reduced momentum, and weaker sustained focus.

**Card 4 Title**  
Stability

**Card 4 Body**  
Formula: `Dominant Lane Share x 100`  
Stability measures how much of the recent session stays within one dominant work lane. A high score suggests focused effort in a consistent context, while a low score indicates scattered activity across multiple apps, tabs, or task types.


## Slide 8 - Technical Slide: Fatigue Drivers

**Slide Title**  
Fatigue Drivers

**Slide Subtitle**  
Final Fatigue Score = 0.40(Duration Load) + 0.20(Idle Load) + 0.20(Switch Load) + 0.20(Focus Decay Load)

**Card 1 Title**  
Duration Load

**Card 1 Body**  
Formula basis: `0-25 min = 0-20`, `25-50 min = 20-45`, `50-90 min = 45-100`, `90+ min = 100`  
Duration Load estimates how session length contributes to mental pressure. Short sessions add only light fatigue, but once the session becomes longer, especially beyond 50 minutes, the fatigue score rises much faster to reflect growing workload strain.

**Card 2 Title**  
Idle Load

**Card 2 Body**  
Formula: `100 x clamp[0.6(Idle Ratio) + 0.4(Idle Burst Penalty)]`  
Idle Load measures fatigue caused by drift, pauses, and repeated interruptions inside the session. Even if total idle time is not extreme, many short idle bursts can still indicate cognitive strain or difficulty maintaining attention.

**Card 3 Title**  
Switch Load

**Card 3 Body**  
Formula: `100 x min(Switches Per Minute / 4, 1)`  
Switch Load represents the mental overhead created by context switching. Frequent changes between windows, apps, or tasks increase cognitive load, making the session feel more fragmented and mentally demanding.

**Card 4 Title**  
Focus Decay Load

**Card 4 Body**  
Formula: `100 x clamp[(First Third Focus - Last Third Focus) / 40, 0, 1]`  
Focus Decay Load checks whether focus weakens as the session progresses from start to finish. A clear drop in late-session focus suggests that the user is becoming mentally tired, making this driver important for identifying sustained fatigue pressure.

**Presentation Note**  
You can mention that fatigue risk is later interpreted as Low, Moderate, or High based on the final combined score.


## Slide 9 - Module 4: Analytics & Visualisation

**Slide Title**  
Module 4 - Analytics & Visualisation

**Slide Subtitle**  
Turning tracked activity into readable performance insights

**Card 1 Title**  
Multi-Range Analysis

**Card 1 Body**  
The analytics module supports daily, 7-day, and 30-day views for both short-term review and broader productivity trend analysis.

**Card 2 Title**  
Focus and Session Trends

**Card 2 Body**  
Users can review focus trends, session frequency, and productivity patterns to understand how consistently they are working over time.

**Card 3 Title**  
Usage and Peak Hours

**Card 3 Body**  
Charts highlight app usage breakdowns and peak working hours, helping users identify when and where their strongest work happens.

**Card 4 Title**  
Fatigue and Productivity Views

**Card 4 Body**  
The system visualizes fatigue patterns, background productivity pulse, and distraction signals to reveal pressure points across the day.

**Card 5 Title**  
Task and Habit Insights

**Card 5 Body**  
Analytics also compare task completion status and habit-related focus time, connecting tracked behavior with progress on planned work.

**Card 6 Title**  
Future Enhancement

**Card 6 Body**  
Future upgrades will include raw fatigue trend charts, deeper comparison by session type or duration, and easier correction of misclassified activities.

**Suggested Image For Right Side**  
Use a dashboard-style screenshot showing line charts, breakdown charts, and analytics summary cards together.


## Slide 10 - Module 5: AI Focus Insight Module

**Slide Title**  
Module 5 - AI Focus Insight Module

**Slide Subtitle**  
Context-aware reflections generated from tracked productivity data

**Card 1 Title**  
Dual Insight Modes

**Card 1 Body**  
The module supports both built-in local insights and optional Gemini-powered analysis, giving the system flexibility and reliability.

**Card 2 Title**  
Structured Data Interpretation

**Card 2 Body**  
Insights are generated from tracked sessions, fatigue signals, app usage patterns, and behavioral summaries rather than generic prompts alone.

**Card 3 Title**  
Efficient Caching

**Card 3 Body**  
Generated insights are cached and refreshed only when new session data becomes available, improving responsiveness and reducing repeated processing.

**Card 4 Title**  
Reliable Fallback Design

**Card 4 Body**  
If the AI service is unavailable, Velance automatically falls back to deterministic local insight generation so feedback is never completely lost.

**Card 5 Title**  
Future Enhancement

**Card 5 Body**  
The next step is to evolve the module into a stronger coaching system with more personalized recommendations based on habits, working hours, and long-term trends.

**Suggested Image For Right Side**  
Use a screenshot of the insights page showing generated feedback, daily summary, or AI insight cards.


## Slide 11 - Conclusion

**Slide Title**  
Conclusion

**Slide Subtitle**  
Summary of Velance

**Blue Highlight Box - Summary**  
Velance has evolved into an advanced functional prototype that unifies task planning, focus sessions, ambient tracking, analytics, and AI-assisted insights in one local-first desktop system. The project’s main contribution is its end-to-end pipeline: capturing real desktop activity, converting it into explainable focus and fatigue metrics, and turning that data into meaningful feedback for users.

**Info Box 1 Title**  
Future Work

**Info Box 1 Body**  
The next stage of development will focus on stronger runtime privacy enforcement, improved scoring calibration, better activity classification, deeper fatigue analytics, and more personalized coaching recommendations. Additional refinement in testing, export portability, and model validation will further strengthen the system.

**Info Box 2 Title**  
Overall Impact and Significance

**Info Box 2 Body**  
Velance demonstrates that productivity software can go beyond manual timers and checklists by combining planning features with real behavioral evidence from desktop usage. It shows the feasibility of a local-first, explainable, and extensible productivity intelligence platform for work and study environments.


## Slide 12 - Demo / Closing Slide

**Slide Title**  
NEXT UP

**Main Text**  
LIVE DEMO

**Recommended One-Liner**  
Next up: Velance in action.

**Alternative One-Liners**  
See Velance in action.

From tracking to insight.

Live tracking. Real insight.
