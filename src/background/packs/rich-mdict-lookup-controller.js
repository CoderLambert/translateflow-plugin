import {
  RICH_MDICT_MAX_DISPLAY_BYTES,
  RICH_MDICT_MAX_RECORDS,
  RICH_MDICT_MAX_SOURCE_RECORD_BYTES,
  RICH_MDICT_MAX_RECORD_TEXT_BYTES,
  RICH_MDICT_SOURCE_ID,
  clampText,
  isValidSnapshot,
  normalizePackId,
  normalizeQuery,
  normalizeRichMdictLookupRequestId,
  richMdictAbortError,
  richError,
  sanitizeDebugMetrics
} from "./rich-mdict-contract.js";

const CANCEL_TTL_MS = 15_000;
const CANCEL_CACHE_LIMIT = 128;

export function createRichMdictLookupController({
  stateStore,
  lookup,
  assertSourceSize,
  loadIndex,
  sourceReader,
  clampUtf8Text
} = {}) {
  const operationsByRequest = new Map();
  const cancelledRequests = new Map();

  async function lookupText(text, dictionaryId, lookupIdentity = null) {
    const query = normalizeQuery(text);
    const targetId = dictionaryId === undefined ? "" : normalizePackId(dictionaryId);
    const operation = lookupIdentity ? beginOperation(lookupIdentity) : null;
    const signal = operation?.controller.signal;
    try {
      assertNotAborted(signal);
      const state = await stateStore.read();
      assertNotAborted(signal);
      const dictionaries = [];
      const errors = [];
      const targetEntry = targetId ? state.packs?.[targetId] : null;
      if (targetId && targetEntry?.sourceId !== RICH_MDICT_SOURCE_ID) {
        return { found: false, dictionaries: [], errors: [{ id: targetId, title: "", code: "RICH_MDICT_NOT_INSTALLED", message: "Rich dictionary is not installed." }] };
      }
      if (targetId && targetEntry.status !== "healthy") {
        return { found: false, dictionaries: [], errors: [{ id: targetId, title: clampText(targetEntry.active?.title || targetId, 200), code: "RICH_MDICT_UNAVAILABLE", message: "Rich dictionary is not available for lookup." }] };
      }
      const entries = targetId ? [[targetId, targetEntry]] : Object.entries(state.packs || {});
      for (const [packId, entry] of entries) {
        assertNotAborted(signal);
        if (entry?.sourceId !== RICH_MDICT_SOURCE_ID || entry?.status !== "healthy") continue;
        const active = entry.active;
        try {
          if (!isValidSnapshot(packId, active)) throw richError("RICH_MDICT_CORRUPT", "Rich dictionary metadata is malformed.");
          await assertSourceSize(active);
          assertNotAborted(signal);
          const index = await loadIndex(active, signal);
          assertNotAborted(signal);
          const result = await lookup({ source: sourceReader(packId, active, signal), index, text: query, signal });
          assertNotAborted(signal);
          if (result?.found) {
            dictionaries.push(dictionaryResponse(result, index, active, packId, clampUtf8Text));
          }
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") throw richMdictAbortError();
          errors.push({
            id: packId,
            title: clampText(active?.title || packId, 200),
            code: error?.code || "RICH_MDICT_STORAGE",
            message: clampText(error?.message || String(error), 300)
          });
        }
        if (targetId) break;
      }
      return { found: dictionaries.length > 0, dictionaries, errors };
    } finally {
      if (operation && operationsByRequest.get(operation.requestId) === operation) {
        operationsByRequest.delete(operation.requestId);
      }
    }
  }

  function cancelLookup(requestIdValue, ownerKeyValue) {
    const requestId = normalizeRichMdictLookupRequestId(requestIdValue);
    const ownerKey = normalizeOwnerKey(ownerKeyValue);
    pruneCancelled();
    const operation = operationsByRequest.get(requestId);
    if (operation) {
      if (operation.ownerKey !== ownerKey) return { cancelled: false, phase: "owner-mismatch" };
      operation.controller.abort();
      return { cancelled: true, phase: "active" };
    }
    const cancelled = cancelledRequests.get(requestId);
    if (cancelled && cancelled.ownerKey !== ownerKey) return { cancelled: false, phase: "owner-mismatch" };
    rememberCancelled(requestId, ownerKey);
    return { cancelled: true, phase: "pending" };
  }

  function beginOperation({ requestId: requestIdValue, ownerKey: ownerKeyValue } = {}) {
    const requestId = normalizeRichMdictLookupRequestId(requestIdValue);
    const ownerKey = normalizeOwnerKey(ownerKeyValue);
    pruneCancelled();
    const cancelled = cancelledRequests.get(requestId);
    if (cancelled) {
      if (cancelled.ownerKey !== ownerKey) throw richError("RICH_MDICT_INPUT", "Rich MDict lookup request ID belongs to another content sender.");
      cancelledRequests.delete(requestId);
      throw richMdictAbortError();
    }
    if (operationsByRequest.has(requestId)) throw richError("RICH_MDICT_BUSY", "Rich MDict lookup request ID is already active.");
    const operation = { requestId, ownerKey, controller: new AbortController() };
    operationsByRequest.set(requestId, operation);
    return operation;
  }

  function rememberCancelled(requestId, ownerKey) {
    cancelledRequests.delete(requestId);
    cancelledRequests.set(requestId, { ownerKey, expiresAt: Date.now() + CANCEL_TTL_MS });
    while (cancelledRequests.size > CANCEL_CACHE_LIMIT) cancelledRequests.delete(cancelledRequests.keys().next().value);
  }

  function pruneCancelled() {
    const now = Date.now();
    for (const [requestId, operation] of cancelledRequests) {
      if (operation.expiresAt <= now) cancelledRequests.delete(requestId);
    }
  }

  return Object.freeze({ lookupText, cancelLookup });
}

function dictionaryResponse(result, index, active, packId, clampUtf8Text) {
  const multiple = result.records !== undefined;
  const inputs = multiple ? result.records : [result];
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > RICH_MDICT_MAX_RECORDS) {
    throw richError("RICH_MDICT_LIMIT", "Rich MDict result record count is invalid.");
  }
  const styleSheetRules = responseStyleRules(index.header.styleSheetRules);
  const offsets = new Set();
  let sourceBytes = 0, textBytes = 0, fallbackBytes = 0;
  const records = inputs.map((record) => {
    const rawBytes = typeof record?.rawRecord === "string" ? new TextEncoder().encode(record.rawRecord).byteLength : NaN;
    if (!Number.isSafeInteger(record?.sourceRecordBytes) || record.sourceRecordBytes <= 0 ||
        record.sourceRecordBytes > RICH_MDICT_MAX_SOURCE_RECORD_BYTES || !Number.isSafeInteger(rawBytes) ||
        rawBytes > RICH_MDICT_MAX_RECORD_TEXT_BYTES ||
        (multiple && record.decodedTextBytes !== rawBytes) ||
        (record.decodedTextBytes !== undefined && record.decodedTextBytes !== rawBytes)) {
      throw richError("RICH_MDICT_LIMIT", "Rich MDict record exceeds the source or decoded text safety limit.");
    }
    if (multiple) {
      if (!Number.isSafeInteger(record.recordOffset) || record.recordOffset < 0 || offsets.has(record.recordOffset) ||
          !Number.isSafeInteger(record.recordEnd) || record.recordEnd - record.recordOffset !== record.sourceRecordBytes ||
          record.recordEnd > index.totalRecordBytes) throw richError("RICH_MDICT_CORRUPT", "Rich MDict result record offsets are invalid.");
      offsets.add(record.recordOffset);
    }
    sourceBytes += record.sourceRecordBytes; textBytes += rawBytes;
    const text = String(record.safeTextFallback ?? "");
    fallbackBytes += new TextEncoder().encode(text).byteLength;
    if (sourceBytes > RICH_MDICT_MAX_SOURCE_RECORD_BYTES || textBytes > RICH_MDICT_MAX_RECORD_TEXT_BYTES ||
        fallbackBytes > RICH_MDICT_MAX_DISPLAY_BYTES) throw richError("RICH_MDICT_LIMIT", "Rich MDict aggregate result exceeds its safety limit.");
    return { headword: clampText(record.displayForm, 300), text: clampUtf8Text(text, RICH_MDICT_MAX_DISPLAY_BYTES),
      ...(multiple ? { recordOffset: record.recordOffset, recordEnd: record.recordEnd } : {}),
      richRecord: { rawRecord: record.rawRecord, sourceBytes: record.sourceRecordBytes, textBytes: rawBytes, format: clampText(index.header.format, 40) },
      ...(record.aliasTarget ? { aliasTarget: clampText(record.aliasTarget, 300) } : {}) };
  });
  if ((result.aggregateSourceRecordBytes !== undefined && result.aggregateSourceRecordBytes !== sourceBytes) ||
      (result.aggregateDecodedTextBytes !== undefined && result.aggregateDecodedTextBytes !== textBytes)) {
    throw richError("RICH_MDICT_CORRUPT", "Rich MDict aggregate result byte counts are inconsistent.");
  }
  const first = records[0];
  const cycles = result.diagnostics?.aliasCycleBranches;
  if (cycles !== undefined && (!Number.isSafeInteger(cycles) || cycles < 0 || cycles > RICH_MDICT_MAX_RECORDS)) {
    throw richError("RICH_MDICT_CORRUPT", "Rich MDict result diagnostics are invalid.");
  }
  return { id: packId, packVersion: active.packVersion, title: active.title, records, styleSheetRules,
    headword: first.headword, text: first.text, richRecord: { ...first.richRecord, styleSheetRules },
    aggregateSourceRecordBytes: sourceBytes, aggregateDecodedTextBytes: textBytes,
    ...(first.aliasTarget ? { aliasTarget: first.aliasTarget } : {}),
    ...(cycles ? { diagnostics: { aliasCycleBranches: cycles } } : {}),
    ...(result.debugMetrics ? { debugMetrics: sanitizeDebugMetrics(result.debugMetrics) } : {}) };
}

function responseStyleRules(rules) {
  if (!Array.isArray(rules) || rules.length > 255) throw richError("RICH_MDICT_LIMIT", "Rich MDict stylesheet rule count is invalid.");
  let bytes = 0;
  const ids = new Set();
  return rules.map(({ id, begin, end }) => {
    if (!Number.isInteger(id) || id < 1 || id > 255 || ids.has(id) || typeof begin !== "string" || typeof end !== "string") {
      throw richError("RICH_MDICT_CORRUPT", "Rich MDict stylesheet rule metadata is invalid.");
    }
    ids.add(id);
    const beginBytes = new TextEncoder().encode(begin).byteLength, endBytes = new TextEncoder().encode(end).byteLength;
    bytes += beginBytes + endBytes;
    if (beginBytes > 4096 || endBytes > 4096 || bytes > 64 * 1024) throw richError("RICH_MDICT_LIMIT", "Rich MDict stylesheet metadata exceeds its safety limit.");
    return { id, begin, end };
  });
}

function normalizeOwnerKey(value) {
  const ownerKey = String(value || "");
  if (!ownerKey || ownerKey.length > 512 || /[\u0000-\u001f\u007f]/u.test(ownerKey)) {
    throw richError("RICH_MDICT_INPUT", "Rich MDict lookup owner is invalid.");
  }
  return ownerKey;
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw richMdictAbortError();
}
