# Velance Browser Bridge

The Velance Browser Bridge is an optional Chrome extension that sends browser context to the local Velance desktop app.

## Privacy Defaults

- The extension no longer asks for all-site access at install time.
- Browser access is requested only when the user clicks **Allow browser access** in the popup.
- Without optional browser access, the extension does not send tab context.
- The desktop app still ignores browser data when tracking consent is declined, global tracking is off, or browser bridge is disabled.

## Capture Modes

- Host only: sends site domains such as `github.com`.
- Standard: sends domains and active page titles.
- Rich media: sends domains, page titles, and audio/media titles when available.

## Development Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `extension`.
5. Open the popup and click **Allow browser access** only when testing browser capture.

## Store Review Notes

Permission justification:

- `tabs`: observe active tab changes and tab metadata for local productivity evidence.
- `alarms`: run periodic bridge health checks.
- `storage`: keep lightweight extension state.
- `scripting`: inject the page signal collector only after optional host permission is granted.
- `http://127.0.0.1:48152/*`: send context to the local Velance desktop bridge.
- Optional `http://*/*` and `https://*/*`: requested at runtime so users can explicitly allow browser context capture.
