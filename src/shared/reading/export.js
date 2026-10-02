import { byteLength } from "../hash.js";
import { READING_ERROR as E, READING_LIMITS as L, READING_METHOD as M } from "./constants.js";
import { bool, choice, fail, id, integer, nullable, object, text } from "./validation.js";
import { revision } from "./list.js";

// A fragment is deliberately not parsed as a stand-alone JSON value: one record may span chunks.
// No unmatched UTF-16 surrogate may cross a response/chunk boundary.
export function validateExportResponse(method, value, path = "data") {
  if (method === M.EXPORT_START) {
    object(value, ["exportId", "exportRevision", "expiresAt", "nextCursor"], path);
    return { exportId: id(value.exportId, `${path}.exportId`), exportRevision: revision(value.exportRevision, `${path}.exportRevision`),
      expiresAt: integer(value.expiresAt, 0, Number.MAX_SAFE_INTEGER, `${path}.expiresAt`), nextCursor: text(value.nextCursor, L.cursorChars, `${path}.nextCursor`) };
  }
  if (method === M.EXPORT_NEXT) {
    object(value, ["sequence", "jsonChunk", "nextCursor", "done", "exportRevision"], path);
    const jsonChunk = text(value.jsonChunk, L.exportChunkBytes, `${path}.jsonChunk`);
    if (byteLength(jsonChunk) > L.exportChunkBytes) fail(E.LIMIT, `${path}.jsonChunk`);
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(jsonChunk)) fail(E.BAD_DTO, `${path}.jsonChunk`);
    const done = bool(value.done, `${path}.done`);
    const nextCursor = nullable(value.nextCursor, (item, p) => text(item, L.cursorChars, p), `${path}.nextCursor`);
    if (done !== (nextCursor === null)) fail(E.BAD_DTO, `${path}.nextCursor`);
    return { sequence: integer(value.sequence, 0, Number.MAX_SAFE_INTEGER, `${path}.sequence`), jsonChunk, nextCursor, done,
      exportRevision: revision(value.exportRevision, `${path}.exportRevision`) };
  }
  if (method === M.EXPORT_FINISH) {
    object(value, ["exportId", "sequence", "exportRevision", "state"], path);
    return { exportId: id(value.exportId, `${path}.exportId`), sequence: integer(value.sequence, 0, Number.MAX_SAFE_INTEGER, `${path}.sequence`),
      exportRevision: revision(value.exportRevision, `${path}.exportRevision`), state: choice(value.state, ["finished"], `${path}.state`) };
  }
  object(value, ["exportId", "state"], path);
  return { exportId: id(value.exportId, `${path}.exportId`), state: choice(value.state, ["cancelled", "finished"], `${path}.state`) };
}
