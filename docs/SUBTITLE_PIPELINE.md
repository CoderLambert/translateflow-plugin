# Subtitle Translation Pipeline

Issue #25 builds the Provider-agnostic translation pipeline on top of the normalized SubtitleSource snapshots introduced in #24. Issue #26 layers the YouTube controller and player-local bilingual renderer on top of that pipeline without changing the Provider/cache boundary.

## Boundary

```text
SubtitleSource snapshot
        |
        v
src/content/subtitles/pipeline.js
  - rolling cue stabilization
  - deduplication
  - bounded queue
  - small batching
  - media-generation reset
        |
        v
SUBTITLE_TRANSLATE_BATCH
        |
        v
src/background/subtitle-requests.js
  - effective translation config
  - subtitle cache identity
  - cache lookup/store
  - existing translation request coordinator
        |
        +--> src/background/cache-db.js
        |
        +--> src/background/translation-requests.js
                     |
                     v
                 Provider
```

The source adapters do not call Providers or access IndexedDB. The content pipeline does not access IndexedDB. Provider/network code remains in the background Provider layer.

## YouTube acquisition and data boundary

On a YouTube video page, the content source asks Background to validate the sender tab and install the acquisition bridge in MAIN world. That bridge observes page `fetch` / XHR responses matching the `/api/timedtext` URL path and sends versioned `window.postMessage` envelopes to the isolated source. The envelope schema and 2 MiB limit validate shape and size; they do not authenticate messages, because page scripts can observe and forge page messages. The isolated source validates every envelope and rejects mismatched video generations.

The `TIMEDTEXT` envelope currently also carries a request URL truncated to 2,048 characters. It may contain signed query parameters or a PO token. The adapter does not copy that URL into the normalized snapshot or `SUBTITLE_TRANSLATE_BATCH`. Batch units carry normalized cue text plus media, source, track, cue-position and sequence metadata. Background uses the metadata to build cache identity; the Provider translation receives subtitle text in the existing segment protocol, without the request URL or cache metadata. No caption URL is fetched by the extension.

The MAIN bridge can ask YouTube's own player to load/select captions once if no response body was captured after injection. This is a player call and may cause a YouTube-owned request; it does not create an extension-authored caption request. Subtitle translation still goes through the normal background Provider and cache path shown above.

## Stabilization

Subtitle sources emit observations, not guaranteed sentence boundaries.

The content pipeline keeps candidates until they remain unchanged for a short quiet window (default 280 ms):

- timestamped cues are keyed by their start/end position and cue id;
- untimed YouTube DOM fallback is treated as one rolling candidate;
- prefix growth such as `Hello` → `Hello everyone` → `Hello everyone today` replaces the pending candidate instead of triggering three Provider calls;
- when untimed text changes to a non-continuation, the prior candidate is finalized before the new rolling candidate starts.

The quiet window is intentionally content-side and source-agnostic. #26 can tune presentation timing without changing Provider/cache identity.

## Batch and queue behavior

Stable units enter a bounded live queue:

- default batch size: 6 units;
- default live queue limit: 24 units;
- default batch delay: 60 ms;
- a full batch flushes immediately;
- smaller groups wait briefly so multiple future/timestamped cues can share one Provider request.

Only one Provider batch is in flight per pipeline instance. This makes existing request cancellation safe because the active subtitle task ID maps directly to one existing `runTranslationRequest()` consumer.

If a fatal batch error remains after the existing Provider retry policy, the pipeline stops automatic retrying that queue. A later explicit `flush()` or new snapshot can retry; this avoids a content-side request storm.

## Media switch and stale work

Each `mediaId` owns one generation.

When `mediaId` changes:

1. generation increments;
2. stabilization candidates and queued units are cleared;
3. the active subtitle task is cancelled through the existing task / `CANCEL_TRANSLATION` path;
4. completed-dedup state resets;
5. late results from an older generation are discarded.

This handles YouTube SPA video switches without allowing the previous video's translation to leak into the next renderer.

## Cache identity

The IndexedDB schema and database version are unchanged.

`src/background/subtitle-requests.js` reuses the existing translation cache store with a namespaced synthetic source identity:

```text
tf-subtitle:v1:<JSON identity>
```

The identity includes:

```text
mediaId
+ source kind
+ track id
+ source language
+ track kind
+ auto-caption hint when known
+ cue id
+ cue start/end timestamps when known
+ untimed sequence when needed
+ normalized cue text
```

The existing cache layer separately hashes the Effective Translation Config, which already contains:

```text
Provider
+ endpoint where applicable
+ model
+ target language
+ resolved prompt / preset
+ effective glossary identity
```

Therefore subtitle cache behavior is effectively:

```text
page identity
+ effective translation config
+ subtitle media/track/cue identity
```

Repeated identical text at materially different cue positions does not collapse. Timestamped cues use timing/id rather than queue sequence so the same timed cue can hit cache across sessions; sequence participates only when the source provides no timing.

The synthetic identity is used only for cache lookup/store. Provider requests receive only the real subtitle text.

After an API-backed subtitle batch, the content pipeline requests the existing global `CACHE_PRUNE` path at most once every five minutes. This keeps subtitle entries inside the same `cacheMaxMB` budget without adding a second eviction policy.

## Task / retry reuse

The pipeline uses `src/content/tasks.js` for each in-flight batch:

```text
queued
→ cache_lookup
→ completed

failed / cancelled
```

The background batch coordinator uses the existing `runTranslationRequest()` implementation, so Provider retry/backoff, in-flight coalescing, AbortController cancellation and Provider protocol behavior are not duplicated.

## #26 renderer/controller integration

The YouTube controller consumes translated-unit callbacks shaped like:

```js
{
  unit: {
    id,
    mediaId,
    source,
    track,
    cue,
    sequence,
    fingerprint,
    text
  },
  translation: "...",
  cacheHit: true | false
}
```

The #26 controller does not call Providers or access IndexedDB directly. YouTube DOM assumptions remain isolated in the source adapter. The player-local renderer reuses the shared UI token/select contract, exposes bilingual/original/off mode, effective translation preset, and translated-size controls, while the controller resolves preset state through the existing Effective Context / temporary preset path. Changing the player preset rebuilds the content pipeline so the current cue can be translated under the new effective config; cache identity continues to include the resolved prompt/preset and glossary identity in the background layer.

## Verification

The unit suite covers stabilization, rolling untimed cues, bounded batching, media-generation cancellation, cache identity and prune throttling. The local Playwright fixture covers Provider batching, cache restoration, repeated cue positions and media/source-language identity. These tests do not use live YouTube.

```bash
npm run validate
npm run test:e2e -- e2e/subtitle-pipeline.spec.mjs
```

GitHub Actions runs `npm run validate` on PRs and main pushes; the Chromium E2E workflow runs the fixture suite when runtime, E2E, or related configuration files change.
