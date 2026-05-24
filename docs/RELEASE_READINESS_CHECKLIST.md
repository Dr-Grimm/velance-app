# Velance Release Readiness Checklist

Use this before cutting a Windows release candidate.

## Build And Install
- Run `npm run test:smoke`.
- Run `npm run build`.
- Run `npm run dist:win` on a Windows release machine.
- Install the generated NSIS build on a clean Windows profile.
- Confirm app version, icon, installer name, uninstall, and relaunch behavior.

## Account And Data
- Sign in with a new account and complete onboarding.
- Sign in with an existing account and confirm onboarding is skipped.
- Export a workspace backup, import it, and confirm tasks, habits, sessions, insights, and tracking rules restore.
- Export diagnostics and confirm it contains no API key, raw URLs, or private prompt payloads.
- Test offline startup and reconnect sync.

## AI BYOK
- Save a valid Gemini key, test it, restart, and test again.
- Save an invalid Gemini key and confirm the error is readable.
- Remove the key and confirm Insights returns to local mode.
- Confirm backups, diagnostics, sync snapshots, and local mirrors do not include the key.
- Confirm Insights can toggle AI on/off while key management stays in Settings.

## Insights
- Open Insights with no data, light data, and heavy data.
- Check Today, 7 days, and 30 days ranges.
- Confirm local insights auto-generate without pressing Refresh.
- Confirm AI insights fall back to local recommendations if the provider fails.
- Rate cards useful/not useful and confirm feedback persists after restart.

## Tracking And Privacy
- Grant and revoke tracking consent.
- Toggle global tracking, keystroke rhythm, mouse telemetry, and browser bridge.
- Test host-only, standard, and rich browser capture.
- Confirm excluded/private data is not sent to AI prompts.
- Confirm browser extension connected, waiting, and error states are clear.

## UX QA
- Check Dashboard, Insights, Settings, Tasks, Habits, Analytics, Focus, Profile, and Onboarding at 1000x680 and large desktop sizes.
- Confirm onboarding scroll works in small windows.
- Confirm no major text overlap, clipped buttons, or unusable empty states.
- Confirm app remains usable in light and dark mode.
