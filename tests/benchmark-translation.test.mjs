import test from "node:test";
import assert from "node:assert/strict";
import {
  createBenchmarkFixtures,
  runTranslationBenchmarks
} from "../scripts/benchmark-translation.mjs";

test("benchmark fixtures cover representative short, medium and long pages", () => {
  const fixtures = createBenchmarkFixtures();
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(fixtures).map(([name, fixture]) => [name, fixture.segments.length])
    ),
    { short: 6, medium: 24, long: 48 }
  );
});

test("translation benchmark reports deterministic batching, cache, coalescing, cancellation and concurrency invariants", async () => {
  const result = await runTranslationBenchmarks();

  for (const name of ["short", "medium", "long"]) {
    const generic = result.profiles.genericOpenAICompatible[name];
    assert.equal(generic.providerRequests, 1);
    assert.deepEqual(generic.observedBatchSizes, [result.fixtures[name].segmentCount]);

    const local = result.profiles.localHyMt2[name];
    assert.equal(local.observedBatchSizes.every((size) => size <= 8), true);
    assert.equal(
      local.observedBatchSizes.reduce((sum, size) => sum + size, 0),
      result.fixtures[name].segmentCount
    );
  }

  assert.equal(result.profiles.localHyMt2.short.providerRequests, 1);
  assert.equal(result.profiles.localHyMt2.medium.providerRequests, 3);
  assert.equal(result.profiles.localHyMt2.long.providerRequests, 6);

  assert.equal(result.cache.cold.cacheHitRatio, 0);
  assert.equal(result.cache.cold.providerRequests, 1);
  assert.equal(result.cache.warm.cacheHitRatio, 1);
  assert.equal(result.cache.warm.providerRequests, 0);

  assert.equal(result.coalescing.consumers, 2);
  assert.equal(result.coalescing.providerRequests, 1);
  assert.equal(result.coalescing.requestsSavedByCoalescing, 1);

  assert.equal(result.cancellation.cancelAccepted, true);
  assert.equal(result.cancellation.cancelled, true);
  assert.equal(result.cancellation.providerRequests, 1);
  assert.equal(result.cancellation.abortedRequests, 1);

  assert.equal(result.concurrency.concurrentTasks, 4);
  assert.equal(result.concurrency.providerRequests, 4);
  assert.equal(result.concurrency.peakConcurrency, 4);

  assert.equal(result.recommendation.changedProductionDefaults, false);
});
