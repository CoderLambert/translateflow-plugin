# Chrome Commands

Issue #23 adds exactly three browser-scoped Chrome Commands for high-frequency TranslateFlow actions.

## Commands and default bindings

| Command | Action | Windows / Linux / ChromeOS default | macOS default |
| --- | --- | --- | --- |
| `translate-page` | Translate or update the active normal web page | `Ctrl+Shift+Y` | `Control+Shift+Y` |
| `toggle-translations` | Show or hide rendered translations | `Ctrl+Shift+K` | `Control+Shift+K` |
| `toggle-quick-control` | Show or hide Quick Control | `Ctrl+Shift+.` | `Control+Shift+.` |

Users can inspect or remap the effective bindings at `chrome://extensions/shortcuts`. Suggested keys are defaults, not a second source of truth for user customizations.

## Compatibility review

The defaults were re-reviewed on 2026-09-24 against Chrome's current command-key rules and Chrome's published desktop shortcut table.

- The originally shipped `Alt+Shift+T` was removed because Chrome itself uses that combination on Windows/Linux to focus the first toolbar item.
- `Ctrl+Alt` combinations are intentionally avoided because Chrome disallows them for extension commands to avoid AltGr conflicts.
- macOS uses `MacCtrl` in the manifest, which means the physical Control key; plain `Ctrl` would otherwise be converted to Command by Chrome.
- The replacement `Ctrl+Shift+Y`, `Ctrl+Shift+K`, and `Ctrl+Shift+Period` combinations are not listed in Chrome's current desktop shortcut table as reserved browser commands. OS-level or third-party application bindings can still vary, so Chrome's extension shortcut page remains the user override path.

References:
- Chrome Commands API: https://developer.chrome.com/docs/extensions/reference/api/commands
- Chrome desktop keyboard shortcuts: https://support.google.com/chrome/answer/157179

## Runtime flow

`src/background/commands.js` maps each command to an existing Content message. It queries the active tab and accepts only `http:` / `https:` pages.

If TranslateFlow is already present, the command sends the existing message directly. On first use after an `activeTab` gesture, a failed message delivery triggers injection of the existing content CSS/script bundle through `chrome.scripting`, then retries the same message.

This path does not add a required host permission. Protected/internal pages are rejected before injection.

Quick Control has separate semantics:
- `QUICK_CONTROL_SHOW` remains idempotent show behavior for Popup/other callers;
- `QUICK_CONTROL_TOGGLE` uses the tab-level toggle path and can remove an already-visible temporary Quick Control.
