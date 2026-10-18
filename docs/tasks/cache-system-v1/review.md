# Cache module self-review — 2026-10-18

Subject: main baseline 961a3757f3cad93921031b038e52e621c8c840b7 plus this cache implementation. Self-review, not independent-model audit. No merge or deployment.

## Verified isolated regressions

Four new failure cases were added to the local source overlay and observed failing before fixes:
1. A subtitle/cache locator could be sent instead of the descriptor's actual providerText.
2. Caller mutation after coordinator.run could alter the request after its key was built.
3. Extra identity properties could override recordVersion through object spread.
4. An invalidation from a second cache service could make a new read join an obsolete local in-flight producer.

Fixes pin coordinator inputs, send descriptor source.text, explicitly project envelope identity fields and add durable read epochs to the load-sharing key. The four new tests then passed with the existing suite: **108/108 under Node22.16.0**. The guarded offline patch-transform tests also passed **15/15**. These are local overlay checks, not the complete remote candidate's Node24/WXT validation.

## Test boundaries

- Actual command: `node --test tests/cache-system*.test.mjs` against the isolated source overlay.
- Native browser attempt: navigation denied with ERR_BLOCKED_BY_ADMINISTRATOR; **0 native cases executed**. No policy bypass attempted.
- Full repository npm ci/validate/Node24 and WXT installation package: **NOT RUN**, no available Node24/download environment.
- Remote source/call-site integration is part of this branch, but exact candidate freeze and full proof remain outstanding.
- No actual paid Provider calls or user's real browser data used.

## Remaining work before final acceptance notification

Keep status working; do not mark ready_to_sync/completed from test counts alone. Resolve existing-test/mocks and historical WXT upgrade expectations under the new token/envelope contract. Validate all consumers' storage-failure display behavior. Run native-IDB and production compiled-extension checks in a permitted environment, build/fingerprint a candidate, and only then ask for the user's product acceptance. PR #342 is not a dependency that may be silently merged; its MT code must later adapt to this cache module.
