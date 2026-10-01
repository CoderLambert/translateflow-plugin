import {
  MDICT_IMPORT_ERROR,
  mdictFail
} from "./mdict-contract.js";

export const RICH_MDICT_LOOKUP_BUDGETS = Object.freeze({
  candidateKeyBlocks: 256,
  keyBlockDecodes: 256,
  keyCompressedBytes: 8 * 1024 * 1024,
  keyDecompressedBytes: 32 * 1024 * 1024,
  recordCompressedBytes: 32 * 1024 * 1024,
  recordDecompressedBytes: 32 * 1024 * 1024,
  totalDecompressedBytes: 32 * 1024 * 1024,
  sourceRangeReads: 512,
  sourceBytesRead: 40 * 1024 * 1024
});

export function createRichMdictLookupBudget(onMetrics) {
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
    aliasHops: 0
  };
  return {
    metrics,
    checkCandidatePlan(blocks) {
      const compressedBytes = sumDescriptorBytes(blocks, "compressedBytes");
      const decompressedBytes = sumDescriptorBytes(blocks, "decompressedBytes");
      requireBudget(
        metrics.candidateKeyBlocks + blocks.length,
        RICH_MDICT_LOOKUP_BUDGETS.candidateKeyBlocks,
        "candidate MDict key blocks"
      );
      requireBudget(
        metrics.keyBlockDecodes + blocks.length,
        RICH_MDICT_LOOKUP_BUDGETS.keyBlockDecodes,
        "MDict key block decodes"
      );
      requireBudget(
        metrics.keyCompressedBytes + compressedBytes,
        RICH_MDICT_LOOKUP_BUDGETS.keyCompressedBytes,
        "MDict key bytes read"
      );
      requireBudget(
        metrics.keyDecompressedBytes + decompressedBytes,
        RICH_MDICT_LOOKUP_BUDGETS.keyDecompressedBytes,
        "MDict key bytes decompressed"
      );
      requireBudget(
        metrics.totalDecompressedBytes + decompressedBytes,
        RICH_MDICT_LOOKUP_BUDGETS.totalDecompressedBytes,
        "MDict total query decompressed bytes"
      );
    },
    addCandidateCount(count) {
      const value = metrics.candidateKeyBlocks + count;
      requireBudget(value, RICH_MDICT_LOOKUP_BUDGETS.candidateKeyBlocks, "candidate MDict key blocks");
      metrics.candidateKeyBlocks = value;
    },
    consumeKeyBlock(descriptor) {
      const decodes = metrics.keyBlockDecodes + 1;
      const compressedBytes = metrics.keyCompressedBytes + descriptor.compressedBytes;
      const decompressedBytes = metrics.keyDecompressedBytes + descriptor.decompressedBytes;
      const totalDecompressedBytes = metrics.totalDecompressedBytes + descriptor.decompressedBytes;
      requireBudget(decodes, RICH_MDICT_LOOKUP_BUDGETS.keyBlockDecodes, "MDict key block decodes");
      requireBudget(compressedBytes, RICH_MDICT_LOOKUP_BUDGETS.keyCompressedBytes, "MDict key bytes read");
      requireBudget(decompressedBytes, RICH_MDICT_LOOKUP_BUDGETS.keyDecompressedBytes, "MDict key bytes decompressed");
      requireBudget(totalDecompressedBytes, RICH_MDICT_LOOKUP_BUDGETS.totalDecompressedBytes, "MDict total query decompressed bytes");
      metrics.keyBlockDecodes = decodes;
      metrics.keyCompressedBytes = compressedBytes;
      metrics.keyDecompressedBytes = decompressedBytes;
      metrics.totalDecompressedBytes = totalDecompressedBytes;
    },
    consumeRecordBlock(descriptor) {
      const compressedBytes = metrics.recordCompressedBytes + descriptor.compressedBytes;
      const decompressedBytes = metrics.recordDecompressedBytes + descriptor.decompressedBytes;
      const totalDecompressedBytes = metrics.totalDecompressedBytes + descriptor.decompressedBytes;
      requireBudget(compressedBytes, RICH_MDICT_LOOKUP_BUDGETS.recordCompressedBytes, "MDict record bytes read");
      requireBudget(decompressedBytes, RICH_MDICT_LOOKUP_BUDGETS.recordDecompressedBytes, "MDict record bytes decompressed");
      requireBudget(totalDecompressedBytes, RICH_MDICT_LOOKUP_BUDGETS.totalDecompressedBytes, "MDict total query decompressed bytes");
      metrics.recordBlockDecodes += 1;
      metrics.recordCompressedBytes = compressedBytes;
      metrics.recordDecompressedBytes = decompressedBytes;
      metrics.totalDecompressedBytes = totalDecompressedBytes;
    },
    consumeRange(length) {
      const reads = metrics.sourceRangeReads + 1;
      const bytes = metrics.sourceBytesRead + length;
      requireBudget(reads, RICH_MDICT_LOOKUP_BUDGETS.sourceRangeReads, "MDict query range reads");
      requireBudget(bytes, RICH_MDICT_LOOKUP_BUDGETS.sourceBytesRead, "MDict query source bytes");
      metrics.sourceRangeReads = reads;
      metrics.sourceBytesRead = bytes;
    },
    report() {
      if (typeof onMetrics !== "function") return;
      try {
        onMetrics(Object.freeze({ ...metrics }));
      } catch {
        // Diagnostic observers do not participate in dictionary lookup.
      }
    }
  };
}

export function meterRichMdictRangeSource(source, budget) {
  return {
    size: source.size,
    read(offset, length, signal) {
      budget.consumeRange(length);
      return source.read(offset, length, signal);
    }
  };
}

function sumDescriptorBytes(descriptors, field) {
  let sum = 0;
  for (const descriptor of descriptors) {
    sum += descriptor[field];
    if (!Number.isSafeInteger(sum)) {
      mdictFail(MDICT_IMPORT_ERROR.LIMIT, "MDict lookup estimate exceeds safe integer range.");
    }
  }
  return sum;
}

function requireBudget(actual, maximum, label) {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > maximum) {
    mdictFail(MDICT_IMPORT_ERROR.LIMIT, label + " exceeds the lookup safety budget.", {
      actual,
      maximum
    });
  }
}
