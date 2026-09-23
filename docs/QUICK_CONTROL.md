# Quick Control

Quick Control is TranslateFlow's low-intrusion in-page control surface. It reuses the shared Shadow DOM host from #19 and the Reading Appearance contract from #20.

## Visibility and permission model

Quick Control has two visibility paths:

1. **Current tab:** when the user actively invokes TranslateFlow from the Popup, the current tab's content runtime may show Quick Control. This uses the existing `activeTab`/scripting flow and does not grant a persistent site permission.
2. **Persistent site:** the Popup can explicitly request the site's optional Host Permission and add the Origin to `quickControlSites`. The Background registration coordinator then persistently injects the normal content bundle on that site.

The content-side Quick Control never calls `chrome.permissions.request()`. Persistent permission requests remain in the Popup's user gesture.

`autoSites` and `quickControlSites` share one dynamic content registration per Origin. Removing one feature keeps the registration while the other still needs it. Legacy `tf_auto_*` / `abt_auto_*` registrations are cleaned during synchronization.

## Per-site hide

The in-page toolbar has **在本站隐藏**. This adds the Origin to `quickControlHiddenSites`, removes it from `quickControlSites`, and hides the control even if content scripts are still present for auto translation.

The Popup can remove that hidden state and show Quick Control again. Hiding the control does not silently alter Provider credentials, translation cache, or auto-translation settings.

## Task-state reuse

Quick Control does not create a second task-state machine. `src/content/tasks.js` remains authoritative and now exposes a small subscription API. Page tasks started by either Popup or Quick Control publish the same states:

```text
queued -> cache_lookup -> translating -> storing -> completed
                                       \-> failed
                                       \-> cancelled
```

The collapsed trigger maps those states to idle / working / completed / action-required. Retry and cancel operate on the same task object and request id used by the translation processor.

## Toolbar actions

Expanded Quick Control exposes:

- translate / retranslate;
- retry after a failed page task;
- cancel while a page task is active;
- temporary translation preset selection using Background's shared preset definitions;
- per-site Reading Appearance selection using Background's shared appearance definitions;
- current-tab auto translation toggle;
- Settings;
- per-site hide.

Selection translation takes precedence visually: while the selection chip/panel is active, Quick Control is suppressed so the two surfaces do not overlap.

## Architecture boundary

- Control UI lives only inside the shared Shadow DOM host.
- Host-page CSS cannot directly restyle the toolbar.
- Page translations remain in real page DOM.
- No new required host permissions are added.
- Provider calls remain in Background.
- IndexedDB access remains in the cache layer.
- Quick Control persistence does not alter translation cache identity.
