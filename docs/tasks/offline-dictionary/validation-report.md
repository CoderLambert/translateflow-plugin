# Offline dictionary validation update

Candidate: `8de40aee243af431b0301930f646cd38bf83e172` (`test(rich-mdict): cover raw technical key boundaries`).

## Passed

- `node --test tests/mdict-raw-boundary-interop.test.mjs` — PASS, 8/8 tests, exit code 0, 208 ms. The added synthetic case checks raw descriptor endpoints with case normalization and `StripKey=Yes` across punctuation, spaces, combining Unicode, and fullwidth characters. The private test log remains under the ignored local evidence directory; its contents and SHA-256 are omitted from repository evidence.
- `node --test tests/mdict-raw-boundary-interop.test.mjs tests/rich-mdict-*.test.mjs tests/mdd-format.test.mjs tests/mdd-security.test.mjs` — PASS, 135/135 tests, exit code 0, Node 24.22.0. This covers current synthetic MDX/MDD format, index, record/alias, migration, security, and cancellation paths. The shell expanded `tests/rich-mdict-*.test.mjs` to the tracked Rich MDict test files.
- `git diff --check` — PASS before the candidate commit; the commit contains only the new regression case in `tests/mdict-raw-boundary-interop.test.mjs`.

## Scope and remaining work

The current implementation in `src/background/packs/importers/mdict-rich-key-codec.js` validates both descriptor endpoints as one raw pair or one legacy normalized pair. This stage adds coverage for additional key characters; it does not change production behavior. The same synthetic regression was copied unchanged into an isolated worktree at pre-fix commit `638e9c2e906072a87ed9f6b1d6228681f74928e5` and failed through `buildRichMdictIndex → addKeyBlockLookupBounds → decodeRichKeyBlock → parseKeyBlock` with `expectedFirst: Apple / actualFirst: apple` and `expectedLast: Ｆoo / actualLast: foo`. The expected failure log remains local; its contents and SHA-256 are omitted from repository evidence. The current candidate still passes the 135-test synthetic suite.

The regression-only candidate was squash-merged by PR #357 as `be0e88229a56c013af025836b09259ca6b9222f0`; the merged main tree matches the validated candidate tree. This closes OD-1 regression coverage only. The overall offline-dictionary task remains working until OD-2/OD-3 target corpus and browser acceptance are completed.

The first attempt to run the combined tests used non-login Bash, which selected Node 26.7.0, and the isolated worktree had no `node_modules`; 105 tests passed and three files could not load `css-tree` or `vite`. The package-lock hashes matched an already-installed dependency tree in another worktree. After reusing that ignored dependency directory and using Node 24.22.0, the same suite passed 135/135. The failed environment attempt remains recorded as `BLOCKED`, not as a product test failure.

### Supplied local Oxford10 input: bounded sample only

`npm run inspect:mdict` ran with the MDX and one matching-stem MDD. The MDX index built for 133,571 entries, 90 key blocks, and 5,607 record blocks; 12 deterministic records were readable (0 unreadable). The supplied 30,900,438-byte MDD index built for 193 resource paths. The sanitized report is retained only under the ignored local evidence directory.

The folder contains six files totaling 1,533,010,812 bytes. The inspector's combined-input cap is 512 MiB, so the second 1,463,189,889-byte MDD was not inspected. JavaScript and image sidecars were not tested; JavaScript was not executed. The bounded MDD check reports indexed resource paths and aggregate types only; it does not read or compare resource payload bytes. Thus `supported` applies only to the inspected MDX plus the one supplied MDD and sampled records, not the complete target dictionary.

The 61,996-byte CSS sidecar was separately passed through `sanitizeRichMddStylesheet` without execution or network access. It produced 40,168 sanitized bytes and four accepted font faces, with zero local asset slots. The sanitizer filtered some selectors and declarations and reached its per-rule declaration limit; this is `PASS_WITH_FILTERS`, not proof that the original visual layout is preserved. A sanitized metrics-only result is retained in the ignored local evidence directory. The JavaScript sidecar was not read or executed; the image sidecar was not opened.

The user reported Chrome reload and Oxford dictionary/AI tab switching passed, but the tested package identity is unknown. That report does not cover importing this file set, persistence after restart, offline lookup, rich display, media playback, or the 60-query content comparison. These larger/manual OD-2/OD-3 checks remain grouped for final user acceptance as requested.

This test-only candidate did not rerun `npm run validate`, rebuild the extension, or run Chromium E2E. Earlier results remain bound to their original candidate; no artifact was rebuilt.
