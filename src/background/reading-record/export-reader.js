import { byteLength } from "../../shared/hash.js";
import { fail } from "../../shared/reading/validation.js";
import { state, policy, E, L } from "./storage-state.js";
import { bound, lower } from "./idb.js";

export function safePrefix(text, rawBudget, escapedBudget) {
  let low = 0, high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2), value = text.slice(0, middle);
    if (byteLength(value) <= rawBudget && byteLength(JSON.stringify(value)) - 2 <= escapedBudget) low = middle; else high = middle - 1;
  }
  if (low && /[\uD800-\uDBFF]/u.test(text[low - 1]) && /[\uDC00-\uDFFF]/u.test(text[low] || "")) low--;
  return text.slice(0, low);
}
export function* exportState(store, context) {
  const meta = yield* state(store); policy(meta, context);
  if (context.exportRevision !== undefined && context.exportRevision !== meta.exportRevision) fail(E.INTERRUPTED, "export.revision");
  return meta;
}
export function* open(store, context, now) {
  const meta = yield* exportState(store, context);
  return { exportRevision: meta.exportRevision, exportedAt: now, position: { ownerKey: context.access.ownerKey,
    phase: "header", recordId: null, afterId: null, rowId: null, first: true, offset: 0, sequence: 0, eof: false } };
}
function* firstRecord(store, after = null) {
  const cursor = yield store("records").openCursor(after ? lower(after, true) : null);
  return cursor?.value || null;
}
function* nextRow(store, name, p) {
  if (p.rowId) return yield store(name).get([p.recordId, p.rowId]);
  const cursor = yield store(name).openCursor(bound([p.recordId, p.afterId || ""], [p.recordId, "\uffff"], !!p.afterId));
  return cursor?.value || null;
}
function* segment(store, context, p) {
  const reset = (fields) => ({ ...p, offset: 0, ...fields });
  if (p.phase === "header") return { text: `{"format":"translateflow-reading","schemaVersion":1,"exportedAt":${context.exportedAt},"records":[`, current: p, next: reset({ phase: "record" }) };
  if (p.phase === "record") {
    const row = p.recordId ? yield store("records").get(p.recordId) : yield* firstRecord(store);
    if (!row) return { text: "]}", current: p, next: reset({ phase: "end", eof: true }) };
    return { text: `{"record":${JSON.stringify(row.record)},"snapshots":[`, current: { ...p, recordId: row.record.recordId },
      next: reset({ phase: "snapshots", recordId: row.record.recordId, afterId: null, rowId: null, first: true }) };
  }
  if (p.phase === "snapshots" || p.phase === "artifacts") {
    const row = yield* nextRow(store, p.phase, p);
    if (!row) return p.phase === "snapshots" ? { text: '],"artifacts":[', current: p, next: reset({ phase: "artifacts", afterId: null, rowId: null, first: true }) }
      : { text: "]}", current: p, next: reset({ phase: "between", afterId: null, rowId: null }) };
    const id = p.phase === "snapshots" ? row.value.sourceSnapshotId : row.value.artifactId;
    return { text: `${p.first ? "" : ","}${JSON.stringify(row.value)}`, current: { ...p, rowId: id },
      next: reset({ afterId: id, rowId: null, first: false }) };
  }
  if (p.phase === "between") {
    const next = yield* firstRecord(store, p.recordId);
    return next ? { text: ",", current: p, next: reset({ phase: "record", recordId: next.record.recordId }) }
      : { text: "]}", current: p, next: reset({ phase: "end", eof: true }) };
  }
  fail(E.INTERRUPTED, "export.position");
}
export function* chunk(store, context) {
  yield* exportState(store, context);
  let p = { ...context.position };
  if (p.ownerKey !== context.access.ownerKey || p.eof || p.sequence !== context.sequence) fail(E.INTERRUPTED, "export.position");
  let output = "", raw = 0, escaped = 0;
  const rawLimit = Math.min(context.maxChunkBytes, L.exportChunkBytes), escapedLimit = L.listResponseBytes - 2048;
  while (!p.eof) {
    const value = yield* segment(store, context, p), remaining = value.text.slice(p.offset);
    const part = safePrefix(remaining, rawLimit - raw, escapedLimit - escaped);
    if (!part) break;
    output += part; raw += byteLength(part); escaped += byteLength(JSON.stringify(part)) - 2;
    if (part.length === remaining.length) p = value.next;
    else { p = { ...value.current, offset: p.offset + part.length }; break; }
  }
  if (!output) fail(E.LIMIT, "export.chunk");
  p.sequence++;
  return { exportRevision: context.exportRevision, position: p, jsonChunk: output, done: p.eof };
}
export function* finish(store, context) {
  yield* exportState(store, context);
  if (!context.position?.eof || context.position.ownerKey !== context.access.ownerKey || context.position.sequence !== context.sequence + 1) fail(E.INTERRUPTED, "export.eof");
}
