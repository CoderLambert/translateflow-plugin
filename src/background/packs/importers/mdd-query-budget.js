import {
  MDICT_IMPORT_ERROR,
  mdictFail
} from "./mdict-contract.js";

export const MDD_LOOKUP_BUDGETS = Object.freeze({
  candidateKeyBlocks: 16,
  keyBlockDecodes: 16,
  keyCompressedBytes: 8 * 1024 * 1024,
  keyDecompressedBytes: 32 * 1024 * 1024,
  recordCompressedBytes: 40 * 1024 * 1024,
  recordDecompressedBytes: 32 * 1024 * 1024,
  recordBlockDecodes: 512,
  totalDecompressedBytes: 32 * 1024 * 1024,
  sourceRangeReads: 512,
  sourceBytesRead: 48 * 1024 * 1024,
  resourceBytes: 8 * 1024 * 1024
});

export function createMddLookupBudget({ limits = MDD_LOOKUP_BUDGETS, onMetrics } = {}) {
  limits = { ...MDD_LOOKUP_BUDGETS, ...limits };
  const metrics = {
    candidateKeyBlocks: 0,
    keyBlockDecodes: 0,
    keyCompressedBytes: 0,
    keyDecompressedBytes: 0,
    recordBlockDecodes: 0,
    recordCompressedBytes: 0,
    recordDecompressedBytes: 0,
    totalDecompressedBytes: 0,
    sourceRangeReads: 0,
    sourceBytesRead: 0,
    resourceBytes: 0
  };
  const budget = {
    metrics,
    checkCandidatePlan(blocks) {
      const compressed = sum(blocks, "compressedBytes");
      const decompressed = sum(blocks, "decompressedBytes");
      check(metrics.candidateKeyBlocks + blocks.length, limits.candidateKeyBlocks, "MDD candidate key blocks");
      check(metrics.keyBlockDecodes + blocks.length, limits.keyBlockDecodes, "MDD key block decodes");
      check(metrics.keyCompressedBytes + compressed, limits.keyCompressedBytes, "MDD key bytes read");
      check(metrics.keyDecompressedBytes + decompressed, limits.keyDecompressedBytes, "MDD key bytes inflated");
      check(metrics.totalDecompressedBytes + decompressed, limits.totalDecompressedBytes, "MDD query bytes inflated");
    },
    addCandidateCount(count) {
      metrics.candidateKeyBlocks += count;
    },
    consumeKeyBlock(descriptor) {
      add("keyBlockDecodes", 1, limits.keyBlockDecodes, "MDD key block decodes");
      add("keyCompressedBytes", descriptor.compressedBytes, limits.keyCompressedBytes, "MDD key bytes read");
      add("keyDecompressedBytes", descriptor.decompressedBytes, limits.keyDecompressedBytes, "MDD key bytes inflated");
      add("totalDecompressedBytes", descriptor.decompressedBytes, limits.totalDecompressedBytes, "MDD query bytes inflated");
    },
    consumeRecordBlock(descriptor) {
      add("recordBlockDecodes", 1, limits.recordBlockDecodes, "MDD record block decodes");
      add("recordCompressedBytes", descriptor.compressedBytes, limits.recordCompressedBytes, "MDD record bytes read");
      add("recordDecompressedBytes", descriptor.decompressedBytes, limits.recordDecompressedBytes, "MDD record bytes inflated");
      add("totalDecompressedBytes", descriptor.decompressedBytes, limits.totalDecompressedBytes, "MDD query bytes inflated");
    },
    consumeRange(length) {
      add("sourceRangeReads", 1, limits.sourceRangeReads, "MDD query range reads");
      add("sourceBytesRead", length, limits.sourceBytesRead, "MDD query source bytes");
    },
    addResourceBytes(length) {
      add("resourceBytes", length, limits.resourceBytes, "MDD resource bytes");
    },
    report() {
      if (typeof onMetrics !== "function") return;
      try {
        onMetrics(Object.freeze({ ...metrics }));
      } catch {
        // Metrics observers are diagnostic only.
      }
    }
  };
  function add(field, amount, maximum, label) {
    check(metrics[field] + amount, maximum, label);
    metrics[field] += amount;
  }
  return budget;
}

export function meterMddRangeSource(source, budget) {
  return {
    size: source.size,
    read(offset, length) {
      budget.consumeRange(length);
      return source.read(offset, length);
    }
  };
}

function sum(descriptors, field) {
  let total = 0;
  for (const descriptor of descriptors) {
    total += descriptor[field];
    if (!Number.isSafeInteger(total)) {
      mdictFail(MDICT_IMPORT_ERROR.LIMIT, "MDD lookup estimate exceeds safe integer range.");
    }
  }
  return total;
}

function check(actual, maximum, label) {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > maximum) {
    mdictFail(MDICT_IMPORT_ERROR.LIMIT, label + " exceeds the lookup safety budget.", {
      actual,
      maximum
    });
  }
}
