# Velance Privacy Policy

Last updated: 2026-05-05

Velance is designed as a local-first productivity analytics app. This policy describes the data Velance handles for the Windows desktop app and Chrome extension.

## Data Velance Stores Locally

Velance may store these items on your device:

- Profile settings such as name, role, goal, and working hours.
- Tasks, habits, focus sessions, and insight feedback.
- Local tracking consent state and app settings.
- App activity summaries when tracking is enabled.
- Browser context when the optional browser extension is enabled and browser access is granted.
- Local AI settings metadata. Full API keys are hidden after saving.

## Tracking Consent

Velance does not start ambient tracking, focus telemetry, or browser capture until you make a tracking consent choice. If you decline tracking, you can still use tasks, habits, profile, settings, backup, and planning features.

You can change tracking consent in Settings.

## Browser Extension

The Chrome extension is optional. It asks for browser access only when you enable it from the extension popup. Capture modes are:

- Host only: stores domains such as `github.com`.
- Standard: stores domains and active page titles.
- Rich media: stores domains, page titles, and media or audio titles when available.

Browser data is sent to the local Velance desktop bridge on `127.0.0.1`. It is ignored when tracking is disabled, consent is declined, or the browser bridge is off.

## AI Insights

Velance can generate local deterministic insights without cloud AI. If you add your own AI API key, Velance sends summarized productivity context to the selected AI provider. Velance must not send raw keystrokes, passwords, full API keys, or raw local database files.

## Authentication And Email

Velance uses Supabase Auth for sign-in. Transactional auth emails are sent through the configured SMTP provider for OTP delivery.

## Backups And Sync

Workspace backups are JSON files created by you. Cloud sync, when enabled, stores workspace snapshots in Supabase under your signed-in account.

## Data Deletion

You can clear local Velance data from Settings. You can also export a backup before clearing data.

## Contact

For privacy questions, contact `support@velance.org`.
