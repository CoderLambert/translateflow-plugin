import { MDICT_IMPORT_ERROR, mdictFail, requireMdictAtMost } from "./mdict-contract.js";
import { decodeMdictBlock } from "./mdict-block-codec.js";
import {
  decodeMddKeyBlock,
  MDD_IMPORT_LIMITS,
  validateMddIndex
} from "./mdd-index.js";
import { compareMddResourcePaths, normalizeMddResourcePath } from "./mdd-resource-path.js";
import { classifyMddResource } from "./mdd-resource-policy.js";
import {
  createMddLookupBudget,
  meterMddRangeSource
} from "./mdd-query-budget.js";
import {
  readSourceRange,
  validateMdictSource,
  withMdictAbortSignal
} from "./mdict-rich-source.js";

export async function lookupMddResource({
  source,
  index,
  path,
  limits = MDD_IMPORT_LIMITS,
  decompressionStreamFactory,
  signal,
  budget,
  onMetrics
} = {}) {
  const rangeSource = withMdictAbortSignal(source, signal);
  const sourceSize = validateMdictSource(rangeSource, limits);
  validateMddIndex(index, { sourceSize, limits, checkSerializedSize: false });
  const normalizedPath = normalizeMddResourcePath(path);
  const lookupBudget = budget || createMddLookupBudget({
    limits: {
      resourceBytes: limits.resourceBytes
    },
    onMetrics
  });
  assertBudget(lookupBudget);
  const meteredSource = meterMddRangeSource(rangeSource, lookupBudget);

  try {
    const blockIndex = findCandidateBlock(index.keyBlocks, normalizedPath);
    if (blockIndex < 0) return { found: false, path: normalizedPath };
    const candidates = [index.keyBlocks[blockIndex]];
    lookupBudget.checkCandidatePlan(candidates);
    lookupBudget.addCandidateCount(candidates.length);
    const entries = await decodeMddKeyBlock({
      source: meteredSource,
      index,
      blockIndex,
      limits,
      decompressionStreamFactory,
      budget: lookupBudget
    });
    const matchIndex = findExactEntry(entries, normalizedPath);
    if (matchIndex < 0) return { found: false, path: normalizedPath };
    const match = entries[matchIndex];
    const end = entries[matchIndex + 1]?.recordOffset ??
      index.keyBlocks[blockIndex + 1]?.firstRecordOffset ??
      index.totalRecordBytes;
    if (
      !Number.isSafeInteger(match.recordOffset) ||
      !Number.isSafeInteger(end) ||
      match.recordOffset < 0 ||
      end < match.recordOffset ||
      end > index.totalRecordBytes
    ) {
      mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD resource byte range is invalid.");
    }
    const resourceSize = end - match.recordOffset;
    requireMdictAtMost(resourceSize, limits.resourceBytes, "MDD resource bytes");
    if (resourceSize === 0) {
      mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD resource is empty.");
    }
    lookupBudget.addResourceBytes(resourceSize);
    const bytes = await readRecordRange({
      source: meteredSource,
      index,
      start: match.recordOffset,
      end,
      limits,
      decompressionStreamFactory,
      budget: lookupBudget
    });
    const policy = classifyMddResource(normalizedPath, bytes, limits);
    return {
      found: true,
      path: normalizedPath,
      mime: policy.mime,
      kind: policy.kind,
      bytes,
      ...(policy.dimensions ? { dimensions: policy.dimensions } : {})
    };
  } finally {
    lookupBudget.report?.();
    if (typeof onMetrics === "function" && budget) {
      try {
        onMetrics(Object.freeze({ ...lookupBudget.metrics }));
      } catch {
        // Metrics observers are diagnostic only.
      }
    }
  }
}

function findExactEntry(entries, path) {
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const key = entries[middle].path;
    if (key === path) return middle;
    if (compareMddResourcePaths(key, path) < 0) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

function findCandidateBlock(blocks, path) {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (compareMddResourcePaths(blocks[middle].lookupMinKey, path) <= 0) low = middle + 1;
    else high = middle;
  }
  const candidate = low - 1;
  return candidate >= 0 && compareMddResourcePaths(path, blocks[candidate].lookupMaxKey) <= 0
    ? candidate
    : -1;
}

async function readRecordRange({
  source,
  index,
  start,
  end,
  limits,
  decompressionStreamFactory,
  budget
}) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > index.totalRecordBytes
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record range is invalid.");
  }
  const chunks = [];
  let total = 0;
  let blockIndex = findRecordBlock(index.recordBlocks, start);
  if (blockIndex < 0) mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record block is missing.");
  while (blockIndex < index.recordBlocks.length) {
    const descriptor = index.recordBlocks[blockIndex];
    const blockEnd = descriptor.uncompressedOffset + descriptor.decompressedBytes;
    const overlapStart = Math.max(start, descriptor.uncompressedOffset);
    const overlapEnd = Math.min(end, blockEnd);
    if (overlapStart < overlapEnd) {
      budget.consumeRecordBlock(descriptor);
      const decoded = await decodeMdictBlock({
        input: await readSourceRange(source, descriptor.dataOffset, descriptor.compressedBytes),
        expectedBytes: descriptor.decompressedBytes,
        limits,
        label: "MDD resource block",
        decompressionStreamFactory
      });
      const from = overlapStart - descriptor.uncompressedOffset;
      const to = overlapEnd - descriptor.uncompressedOffset;
      const chunk = decoded.bytes.subarray(from, to);
      total += chunk.byteLength;
      requireMdictAtMost(total, limits.resourceBytes, "MDD resource bytes");
      chunks.push(chunk);
    }
    if (blockEnd >= end) break;
    blockIndex += 1;
  }
  if (total !== end - start) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD record block range is incomplete.");
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function findRecordBlock(blocks, offset) {
  let low = 0;
  let high = blocks.length - 1;
  while (low <= high) {
    const middle = low + ((high - low) >> 1);
    const block = blocks[middle];
    const end = block.uncompressedOffset + block.decompressedBytes;
    if (offset < block.uncompressedOffset) high = middle - 1;
    else if (offset >= end) low = middle + 1;
    else return middle;
  }
  return -1;
}

function assertBudget(budget) {
  if (
    !budget ||
    !budget.metrics ||
    typeof budget.checkCandidatePlan !== "function" ||
    typeof budget.addCandidateCount !== "function" ||
    typeof budget.consumeKeyBlock !== "function" ||
    typeof budget.consumeRecordBlock !== "function" ||
    typeof budget.consumeRange !== "function" ||
    typeof budget.addResourceBytes !== "function"
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDD lookup budget is invalid.");
  }
}
