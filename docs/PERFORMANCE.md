# Translation Performance Benchmark

Issue #65 establishes a reproducible baseline for translation batching and concurrency without depending on real API keys, a public network, or a running LM Studio instance.

## Run

```bash
npm run benchmark:translation
npm run benchmark:translation -- --json
```

The benchmark uses the production OpenAI-compatible Provider, Translation Gateway and request-coalescing path with a deterministic mock transport. Timing is measured with `performance.now()`, but elapsed milliseconds are observational only and must not be used as CI pass/fail thresholds.

## Fixtures

| Fixture | Segments | Source chars per segment |
| --- | ---: | ---: |
| short | 6 | 80 |
| medium | 24 | 120 |
| long | 48 | 180 |

The fixtures are intentionally below the local-model 3200-character sub-batch cap when grouped by eight segments, so segment-count batching remains directly observable.

## Metrics

The JSON report records:

- provider request count;
- observed Provider batch sizes;
- cache hit ratio for cold and warm runs;
- identical-request coalescing and saved Provider calls;
- cancellation propagation and aborted fetch count;
- end-to-end task latency;
- peak concurrent Provider fetches.

The local profile uses model name `hy-mt2-7b`, exercising the production translation-specialized local-model path and its <=8 segment batching without requiring LM Studio.

## Deterministic baseline

The deterministic invariants are:

| Scenario | Expected Provider behavior |
| --- | --- |
| Generic short / medium / long | 1 request per page fixture |
| Local short | 1 request, batch size 6 |
| Local medium | 3 requests, batch sizes 8 / 8 / 8 |
| Local long | 6 requests, six batches of 8 |
| Cold cache | 0% cache hit, 1 Provider request |
| Warm cache | 100% cache hit, 0 Provider requests |
| Two identical in-flight consumers | 1 Provider request |
| Cancellation | underlying fetch aborted and caller receives `CANCELLED` |
| Four independent tasks | 4 Provider requests with peak concurrency 4 in the benchmark harness |

These are correctness/architecture observations, not throughput claims.

## Recommendation

No production batching or concurrency defaults are changed by #65.

The existing local-model limits remain:

- maximum 8 segments per local sub-request;
- roughly 3200 source characters per local sub-request.

The benchmark confirms those limits are visible, deterministic and compatible with request coalescing/cancellation. Machine-speed latency varies by environment, and the mock transport is not evidence for increasing production concurrency or changing local batch limits.

Future tuning should only change defaults when a representative real-provider measurement shows a repeatable improvement and the change is protected by regression tests.
