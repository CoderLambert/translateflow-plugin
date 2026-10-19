# Rich MDX index cache validation

Candidate: `d74b92f7ad9284f4c543a239e41da4ac3c8f83a4` (`0.8.35`)

## Result

All checks required by `state.json` passed against the frozen candidate. The browser suites ran serially on Chromium `153.0.8010.12`, using only local synthetic dictionaries and mocks; there were no requests to Microsoft or Tencent services.

| Check | Result | Evidence |
| --- | --- | --- |
| `git diff --check origin/main...HEAD` | PASS | clean candidate diff |
| `npm run validate` | PASS | static/architecture and locale checks, Node tests, typecheck, Vitest, default extension build |
| `npm run build:extension:wxt` | PASS | `.output/chrome-mv3`, 130 files, 2,965,666 bytes |
| `npm run test:wxt:smoke` | PASS | production package audit and isolated Chromium smoke |
| Relevant Chromium E2E | PASS, 10/10 | cache, migration, multi-dictionary, lookup cancellation, records |

The production package fingerprint is `a41fcb0359a4b2a2ebdb08376012275ed3eef5fad83887039a994ec9cfb92e7f` for `.output/chrome-mv3`.

## Cache measurement

The manager-backed synthetic pressure run installed and enabled 20 dictionaries with 1,600 entries each: 32,000 entries and 14,986,390 serialized index bytes. At 8 MiB, the hot-query sequence caused 40 index rereads; at 16 MiB, all indexes remained cached and 12 preferred hot queries caused no rereads. A 32 MiB budget did not improve that sequence. This supports 16 MiB for the tested synthetic workload only.

## Limits and warnings

- The measurement does not predict user dictionary counts or real Oxford dictionary performance.
- Heap/RSS peak memory was not measured; the budget counts validated serialized index bytes.
- Builds report the existing #245 advisory: platform code exceeds the advisory budget by 599,196 bytes (`2,175,791/1,576,595`). The commands exit successfully.
- This task did not test extension-store automatic upgrade behavior or other browsers.
