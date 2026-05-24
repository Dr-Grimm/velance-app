# Velance Public Release Checklist

Use this checklist before publishing the Windows installer or Chrome extension.

## Build And Identity

- App version matches `package.json`, `.env`, release notes, and installer filename.
- App icon and favicon show Velance branding.
- `npm test` passes.
- `npm run build` passes.
- `npm run dist:win` produces `Velance-Setup-<version>.exe`.
- Installer works on a clean Windows user profile.

## Auth And SMTP

- Supabase Auth uses custom SMTP.
- Brevo sender domain has SPF, DKIM, and DMARC.
- OTP email reaches non-team accounts.
- OTP length in email matches `VITE_AUTH_OTP_LENGTH`.
- Google OAuth still works.

## Privacy And Tracking

- New user sees onboarding tracking consent.
- Existing unresolved user sees app-level consent gate.
- Declining consent keeps planning features usable.
- Declining consent blocks focus tracking, ambient tracking, and browser capture.
- Re-enabling consent in Settings applies runtime policy.
- Diagnostics, backups, sync snapshots, and AI prompts do not include API keys.

## Browser Extension

- Chrome manifest has no required all-site host permissions.
- Popup requests optional browser access only after user click.
- Permission denied state is clear.
- Desktop app offline state is clear.
- Host-only, Standard, and Rich media modes behave as described.
- Chrome Web Store privacy and permission justifications are complete.

## Product QA

- Dashboard gives a clear next action with no data, light data, and heavy data.
- Tasks support search/filter, overdue triage, and focus launch.
- Focus page has clear blocked state when tracking is declined.
- Analytics starts with plain-language summary before charts.
- Insights explain the evidence behind each recommendation.
- Settings danger actions require strong confirmation.

## Visual QA

- Test at 1000x680 and large desktop.
- Test light and dark themes.
- Check Dashboard, Tasks, Focus, Analytics, Habits, Insights, Settings, Profile, Auth, and Onboarding.
