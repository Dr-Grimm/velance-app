# Velance

Velance is a local-first Windows desktop app for productivity analytics, focus tracking, and evidence-based coaching. It combines tasks, habits, focus sessions, optional desktop activity tracking, optional browser context, local analytics, and bring-your-own-key AI insights.

## What Velance Does

- Plans work with tasks, priorities, due dates, and habit links.
- Runs focus sessions with optional native activity telemetry.
- Tracks local app activity after explicit consent.
- Enriches browser evidence through an optional Chrome extension.
- Turns sessions and ambient activity into dashboard, analytics, and insight views.
- Stores workspace data locally first, with export/import and optional Supabase snapshot sync.
- Uses BYOK AI only when the user provides and tests an API key.

## Privacy Model

Velance must not start ambient tracking, focus telemetry, or browser capture until local tracking consent is resolved. Users can decline tracking and still use planning features.

Default browser capture is conservative:

- Browser bridge is off for new workspaces.
- Chrome all-site access is optional and requested from the extension popup.
- Host-only mode stores domains without page or audio titles.
- Standard and rich modes are explicit user choices.

AI insights use summarized context. Diagnostics and backups must not include API keys.

## Development

```powershell
cp .env.example .env
npm install
npm run dev
```

Electron:

```powershell
npm run electron
```

Smoke tests:

```powershell
npm test
```

Production build:

```powershell
npm run build
```

Windows installer:

```powershell
npm run dist:win
```

## Required Environment

Create `.env` from `.env.example`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_AUTH_OTP_LENGTH`
- `VITE_APP_VERSION`
- `VITE_PRIVACY_POLICY_URL`
- `VITE_SUPPORT_URL`

For public launch, configure Supabase Auth with custom SMTP. See [docs/SMTP_SETUP.md](docs/SMTP_SETUP.md).

## Browser Extension

The Chrome extension lives in [extension](extension). For public release, package it for Chrome Web Store review. During development, load it unpacked from `chrome://extensions`.

The extension asks for browser access only when the user clicks the popup permission button. Without that optional permission, it will not send tab context.

## Release Documents

- [Privacy Policy](docs/PRIVACY_POLICY.md)
- [Terms](docs/TERMS.md)
- [SMTP Setup](docs/SMTP_SETUP.md)
- [Release Checklist](docs/RELEASE_CHECKLIST.md)
