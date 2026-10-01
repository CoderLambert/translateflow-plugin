import { normalizeLexicalExactKey } from "../../../shared/lexical.js";
import {
  MDICT_IMPORT_ERROR,
  mdictFail,
  requireMdictAtMost
} from "./mdict-contract.js";
import { decodeMdictBlock } from "./mdict-block-codec.js";
import {
  decodeRichKeyBlock,
  readSourceRange
} from "./mdict-rich-index.js";
import {
  RICH_MDICT_IMPORT_LIMITS,
  validateRichMdictIndex
} from "./mdict-rich-validation.js";
import { normalizeRichMdictLookupKey } from "./mdict-rich-metadata.js";
import {
  createRichMdictLookupBudget,
  meterRichMdictRangeSource,
  RICH_MDICT_LOOKUP_BUDGETS
} from "./mdict-rich-query-budget.js";
import {
  decodeRichMdictRecordText,
  toSafeRichMdictPlainText,
  validateRichMdictAliasTarget
} from "./mdict-rich-record-text.js";

const MAX_ALIAS_HOPS = 8;
const LINK_PREFIX = "@@@LINK=";
export { RICH_MDICT_LOOKUP_BUDGETS } from "./mdict-rich-query-budget.js";

export async function lookupRichMdict({
  source,
  index,
  text,
  limits = RICH_MDICT_IMPORT_LIMITS,
  decompressionStreamFactory,
  onMetrics,
  signal
} = {}) {
  throwIfAborted(signal);
  validateRangeSource(source, limits);
  validateRichMdictIndex(index, { sourceSize: source.size, limits });
  const query = normalizeLexicalExactKey(text);
  if (!query || /[\u0000-\u001F\u007F]/u.test(query)) {
    mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "Rich MDict lookup text is invalid.");
  }
  requireMdictAtMost(
    new TextEncoder().encode(query).byteLength,
    limits.headwordBytes,
    "MDict lookup key bytes"
  );

  const budget = createRichMdictLookupBudget(onMetrics);
  const rangeSource = meterRichMdictRangeSource(source, budget);
  const visited = new Set();
  const requestedKey = query;
  let currentKey = query;
  let initialAliasTarget = null;
  try {
    for (let hop = 0; hop <= MAX_ALIAS_HOPS; hop += 1) {
      throwIfAborted(signal);
      budget.metrics.aliasHops = hop + 1;
      const cycleKey = comparisonKey(currentKey, index.header);
      if (visited.has(cycleKey)) {
        mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict alias loop detected.");
      }
      visited.add(cycleKey);
      const match = await findExactEntry({
        source: rangeSource,
        index,
        text: currentKey,
        limits,
        decompressionStreamFactory,
        budget,
        signal
      });
      throwIfAborted(signal);
      if (!match) {
        if (hop === 0) return { found: false, requestedKey };
        mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict alias target is missing.", {
          aliasTarget: currentKey
        });
      }
      const record = await readRecord({
        source: rangeSource,
        index,
        start: match.recordOffset,
        end: match.recordEnd,
        limits,
        decompressionStreamFactory,
        budget,
        signal
      });
      throwIfAborted(signal);
      const rawRecord = decodeRichMdictRecordText(
        record,
        index.header.encoding,
        match.displayForm,
        limits
      );
      if (rawRecord.startsWith(LINK_PREFIX)) {
        const target = rawRecord.slice(LINK_PREFIX.length).trim();
        validateRichMdictAliasTarget(target, limits);
        if (initialAliasTarget === null) initialAliasTarget = target;
        if (hop === MAX_ALIAS_HOPS) {
          mdictFail(MDICT_IMPORT_ERROR.LIMIT, "MDict alias chain exceeds the safety limit.");
        }
        currentKey = target;
        continue;
      }
      return {
        found: true,
        requestedKey,
        displayForm: match.displayForm,
        rawRecord,
        safeTextFallback: toSafeRichMdictPlainText(rawRecord, index.header),
        aliasTarget: initialAliasTarget
      };
    }
    mdictFail(MDICT_IMPORT_ERROR.LIMIT, "MDict alias chain exceeds the safety limit.");
  } finally {
    budget.report();
  }
}

async function findExactEntry({
  source,
  index,
  text,
  limits,
  decompressionStreamFactory,
  budget,
  signal
}) {
  throwIfAborted(signal);
  const normalizedQuery = comparisonKey(text, index.header);
  const rangeQuery = lookupSortKey(text, index.header);
  const candidates = [];
  for (let blockIndex = 0; blockIndex < index.keyBlocks.length; blockIndex += 1) {
    const block = index.keyBlocks[blockIndex];
    if (
      rangeQuery >= block.lookupMinKey &&
      rangeQuery <= block.lookupMaxKey
    ) {
      candidates.push({ blockIndex, descriptor: block });
    }
  }
  budget.checkCandidatePlan(candidates.map((candidate) => candidate.descriptor));
  budget.addCandidateCount(candidates.length);

  let firstFolded = null;
  let exactSpelling = null;
  for (const { blockIndex } of candidates) {
    throwIfAborted(signal);
    const entries = await decodeRichKeyBlock({
      source,
      index,
      blockIndex,
      limits,
      decompressionStreamFactory,
      budget,
      signal
    });
    throwIfAborted(signal);
    let firstFoldedInBlock = null;
    let exactSpellingInBlock = null;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      if ((entryIndex & 0x3ff) === 0) throwIfAborted(signal);
      const entry = entries[entryIndex];
      if (comparisonKey(entry.displayForm, index.header) !== normalizedQuery) continue;
      const match = {
        recordOffset: entry.recordOffset,
        displayForm: entry.displayForm,
        blockIndex,
        entryIndex
      };
      if (!firstFolded) firstFolded = match;
      if (!firstFoldedInBlock) firstFoldedInBlock = match;
      if (normalizeLexicalExactKey(entry.displayForm) === normalizeLexicalExactKey(text)) {
        exactSpellingInBlock = match;
        break;
      }
    }
    const blockMatch = exactSpellingInBlock || firstFoldedInBlock;
    if (blockMatch) {
      for (
        let entryIndex = blockMatch.entryIndex + 1;
        entryIndex < entries.length;
        entryIndex += 1
      ) {
        if (entries[entryIndex].recordOffset > blockMatch.recordOffset) {
          blockMatch.nextRecordOffset = entries[entryIndex].recordOffset;
          break;
        }
      }
    }
    if (exactSpellingInBlock) {
      exactSpelling = exactSpellingInBlock;
      break;
    }
  }
  const selected = exactSpelling || firstFolded;
  if (!selected) return null;
  const recordEnd = await findNextRecordOffset({
    source,
    index,
    selected,
    limits,
    decompressionStreamFactory,
    budget,
    signal
  });
  throwIfAborted(signal);
  if (recordEnd <= selected.recordOffset) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record boundary is empty or reversed.");
  }
  return { ...selected, recordEnd };
}

async function findNextRecordOffset({
  source,
  index,
  selected,
  limits,
  decompressionStreamFactory,
  budget,
  signal
}) {
  throwIfAborted(signal);
  const start = selected.recordOffset;
  if (selected.nextRecordOffset > start) return selected.nextRecordOffset;
  for (
    let blockIndex = selected.blockIndex + 1;
    blockIndex < index.keyBlocks.length;
    blockIndex += 1
  ) {
    throwIfAborted(signal);
    const descriptor = index.keyBlocks[blockIndex];
    if (descriptor.lastRecordOffset <= start) continue;
    if (descriptor.firstRecordOffset > start) return descriptor.firstRecordOffset;
    const entries = await decodeRichKeyBlock({
      source,
      index,
      blockIndex,
      limits,
      decompressionStreamFactory,
      budget,
      signal
    });
    throwIfAborted(signal);
    for (const entry of entries) {
      throwIfAborted(signal);
      if (entry.recordOffset > start) return entry.recordOffset;
    }
  }
  return index.totalRecordBytes;
}

async function readRecord({
  source,
  index,
  start,
  end,
  limits,
  decompressionStreamFactory,
  budget,
  signal
}) {
  throwIfAborted(signal);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > index.totalRecordBytes
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record range is invalid.");
  }
  const length = end - start;
  requireMdictAtMost(length, limits.entryBytes, "MDict record bytes");
  let blockIndex = findRecordBlock(index.recordBlocks, start);
  if (blockIndex < 0) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record block is missing.");
  }
  const chunks = [];
  let totalBytes = 0;
  while (blockIndex < index.recordBlocks.length) {
    throwIfAborted(signal);
    const descriptor = index.recordBlocks[blockIndex];
    const overlapStart = Math.max(start, descriptor.uncompressedOffset);
    const overlapEnd = Math.min(end, descriptor.uncompressedOffset + descriptor.decompressedBytes);
    if (overlapStart < overlapEnd) {
      budget.consumeRecordBlock(descriptor);
      throwIfAborted(signal);
      const compressed = await readSourceRange(source, descriptor.dataOffset, descriptor.compressedBytes, signal);
      throwIfAborted(signal);
      const block = await decodeMdictBlock({
        input: compressed,
        expectedBytes: descriptor.decompressedBytes,
        limits,
        label: "MDict record block",
        decompressionStreamFactory,
        signal
      });
      throwIfAborted(signal);
      const decoded = block.bytes;
      const from = overlapStart - descriptor.uncompressedOffset;
      const to = overlapEnd - descriptor.uncompressedOffset;
      const chunk = decoded.subarray(from, to);
      totalBytes += chunk.byteLength;
      requireMdictAtMost(totalBytes, limits.entryBytes, "MDict record bytes");
      chunks.push(chunk);
    }
    if (overlapEnd === end) break;
    blockIndex += 1;
  }
  if (totalBytes !== length) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict record block ranges are incomplete.");
  }
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    throwIfAborted(signal);
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException("MDict lookup cancelled.", "AbortError");
}

function findRecordBlock(blocks, offset) {
  let low = 0;
  let high = blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const block = blocks[middle];
    const end = block.uncompressedOffset + block.decompressedBytes;
    if (offset < block.uncompressedOffset) high = middle - 1;
    else if (offset >= end) low = middle + 1;
    else return middle;
  }
  return -1;
}

function comparisonKey(value, header) {
  return normalizeRichMdictLookupKey(
    normalizeLexicalExactKey(value),
    header
  );
}

function lookupSortKey(value, header) {
  return normalizeRichMdictLookupKey(normalizeLexicalExactKey(value), header);
}

function validateRangeSource(source, limits) {
  if (
    !source ||
    !Number.isSafeInteger(source.size) ||
    typeof source.read !== "function"
  ) {
    mdictFail(MDICT_IMPORT_ERROR.CORRUPT, "MDict range source is invalid.");
  }
  requireMdictAtMost(source.size, limits.fileBytes, "MDX bytes");
}
