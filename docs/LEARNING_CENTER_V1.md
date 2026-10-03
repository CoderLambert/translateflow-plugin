# Learning center v1

Task [235](tasks/235/task.md) adds the ordinary WXT unlisted page `learning-center.html`, from `entrypoints/learning-center/index.html`. Open it from Popup or the existing Selection recording invitation. React and TypeScript are limited to this page; Content/MAIN/Worker/background retain their existing implementations. No new permission, host scope, CSP exception or external resource is added.

The page reads the single protocolVersion 2 Reading repository through a typed client and the shared request/response/invalidation validators. It never imports an IndexedDB adapter, queries a dictionary or calls a Provider. Interface language follows `uiLocale` and live Options changes without changing translation targets, prompts or stored artifacts.

## User flow

- First visit offers Enable / Not now and describes local storage. A trusted click plus a committed consent acknowledgement enables future queries. Existing valid Selection cards must explicitly save their current result; closed or expired cards are not recaptured.
- Recent records, literal search and page groups use bounded 30-item backend pages. Switching Recent / By page clears the search filter. Page search matches the backend's page-title/site fields; record search matches selected text, bounded result/context previews, title and site. Lists never fetch individual details.
- Opening a record reads its immutable result/source snapshots, full completed questions/answers and provenance. Only five artifact bodies render initially; Load more reveals five at a time. Source context and model/pack diagnostics are expandable. The view works offline without Provider configuration. Original-page links use validated `safeReturnUrl` and do not claim precise relocation.
- A deep link carries only `#record=<UUID>`. Hash navigation, refresh and browser back retain native backend document/context/private checks. Chromium's stale sender URL after hash navigation is compared with the current native context only within this fixed page and its validated ID fragment. Invalid/deleted records have a return-to-list action.
- Pause keeps history and revokes prior write tokens; resume does not backfill old operations. Exclusions use atomic origin patches and expected site revision. The independent exclusion list remains manageable after clearing records. It has no duplicated `chrome.storage` preference and requests no host permission.
- Single-record, page and all-history deletion show an explicit confirmation with focus return / Escape. They affect Reading records only, leaving translation cache, dictionaries and site exclusions separate. Late responses are discarded after invalidation; a disconnected view clears unconfirmed content and retries its restricted subscription, with a visible manual Retry fallback.

## Export

The explicit export action calls start → one awaited next at a time → EOF → finish. It checks revision and contiguous sequence, deduplicates exact retry fragments and aborts on missing/changed/unsupported content. UTF-8 fragments are bounded by the shared protocol; their Blob parts stay outside React state and are bounded by the repository's file budget. No whole-library JSON parse/stringify is performed in production UI.

Cancel, navigation/unmount, disconnected background or errors cancel the owned export and discard temporary parts. Successful finish delivery is the commit point, including a raced cancel. Download starts only after that acknowledgement. The Object URL is revoked promptly. “Generated; download initiated” does not assert that a browser dialog or filesystem saved the file. The user is reminded that exports contain private content and downloaded copies cannot be deleted by the extension.

## Verification boundaries

`tests/unit/learning-center/` covers StrictMode/synthetic consent refusal, search/deletion races, safe text rendering, bounded detail rendering, Unicode/duplicate/missing/versioned export chunks and finish/cancel ordering. `e2e/learning-center.spec.mjs` loads the actual WXT product. Its first story uses the shipped Selection collector and real native repository to create same-word/different-context records, then tests authorization, offline detail, searches/page groups, pause/exclusions, deletion and real Blob download. A separately labelled canonical-row seed supplements pagination and a multi-megabyte, 64-artifact record; it does not replace that creation story.

Build auditing verifies the exact Manifest and registered files. React modules may appear only in chunks reachable from learning-center HTML and unreachable from background/Popup/Options. The learning-only closure is measured separately from the existing platform code budget; shared chunks still count toward the platform. Audit reports observe final `writeBundle` outputs and explicitly map WXT's directory HTML entry to the fixed installed path.

Release A recognition remains task 236. Chrome 102 runtime, other browsers, real paid Providers, actual desktop IME and browser file-dialog/disk outcomes require their own evidence. These are not implied by Chromium mock-provider tests.
