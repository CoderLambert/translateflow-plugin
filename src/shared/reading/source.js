import { READING_ERROR, READING_LIMITS as L, READING_PROJECTION_VERSION, READING_LOCATION_STATUS } from "./constants.js";
import { array, bool, choice, digest, fail, id, integer, nullable, object, text, version } from "./validation.js";

export function validateAnchor(value, path = "anchor") {
  object(value, ["status", "quote", "position", "blockDigest"], path);
  const status = choice(value.status, READING_LOCATION_STATUS, `${path}.status`);
  const quote = validateQuote(value.quote, `${path}.quote`);
  const position = nullable(value.position, validatePosition, `${path}.position`);
  const blockDigest = nullable(value.blockDigest, digest, `${path}.blockDigest`);
  if (status === "resolved" && (!position || !blockDigest)) fail(READING_ERROR.BAD_DTO, path);
  return { status, quote, position, blockDigest };
}
function validateQuote(value, path) {
  object(value, ["exact", "prefix", "suffix"], path);
  return {
    exact: text(value.exact, L.selectionChars, `${path}.exact`),
    prefix: text(value.prefix, L.quoteContextChars, `${path}.prefix`, { empty: true }),
    suffix: text(value.suffix, L.quoteContextChars, `${path}.suffix`, { empty: true })
  };
}
export function validatePosition(value, path = "position") {
  object(value, ["start", "end"], path);
  const start = integer(value.start, 0, L.scanTotalChars, `${path}.start`);
  const end = integer(value.end, start + 1, L.scanTotalChars, `${path}.end`);
  return { start, end };
}
export function validateSourceSnapshot(value, path = "sourceSnapshot") {
  object(value, ["schemaVersion", "sourceSnapshotId", "selectedText", "contextText", "contextMode",
    "sourceDigest", "projectionVersion", "documentGeneration", "selectionGeneration", "anchor", "capturedAt"], path);
  const selectedText = text(value.selectedText, L.selectionChars, `${path}.selectedText`);
  const contextMode = choice(value.contextMode, ["selection-only", "bounded-context"], `${path}.contextMode`);
  const contextText = text(value.contextText, L.contextChars, `${path}.contextText`, { empty: true });
  if (contextMode === "selection-only" && contextText !== "") fail(READING_ERROR.BAD_DTO, `${path}.contextText`);
  if (contextMode === "bounded-context" && !contextText.trim()) fail(READING_ERROR.BAD_DTO, `${path}.contextText`);
  const anchor = validateAnchor(value.anchor, `${path}.anchor`);
  if (anchor.quote.exact !== selectedText || (anchor.position &&
      anchor.position.end - anchor.position.start !== selectedText.length)) fail(READING_ERROR.BAD_DTO, `${path}.anchor`);
  if (value.projectionVersion !== READING_PROJECTION_VERSION) fail(READING_ERROR.UNSUPPORTED_VERSION, `${path}.projectionVersion`);
  return {
    schemaVersion: version(value.schemaVersion, `${path}.schemaVersion`),
    sourceSnapshotId: id(value.sourceSnapshotId, `${path}.sourceSnapshotId`), selectedText, contextText, contextMode,
    sourceDigest: digest(value.sourceDigest, `${path}.sourceDigest`), projectionVersion: value.projectionVersion,
    documentGeneration: id(value.documentGeneration, `${path}.documentGeneration`),
    selectionGeneration: integer(value.selectionGeneration, 1, Number.MAX_SAFE_INTEGER, `${path}.selectionGeneration`),
    anchor, capturedAt: integer(value.capturedAt, 0, Number.MAX_SAFE_INTEGER, `${path}.capturedAt`)
  };
}

// Pure projection input is supplied by the DOM adapter; inline boundaries add no spaces.
export function projectSourceSegments(segments) {
  const values = array(segments, L.scanTotalNodes, (segment, path) => {
    object(segment, ["text", "blockStart", "excluded", "nodeKey"], path);
    return { text: text(segment.text, L.scanTotalChars, `${path}.text`, { empty: true }),
      blockStart: bool(segment.blockStart, `${path}.blockStart`), excluded: bool(segment.excluded, `${path}.excluded`), nodeKey: id(segment.nodeKey, `${path}.nodeKey`) };
  }, "segments");
  if (values.reduce((count, segment) => count + segment.text.length, 0) > L.scanTotalChars) fail(READING_ERROR.LIMIT, "segments.text");
  const units = [];
  const mapping = [];
  let whitespace = false;
  for (const segment of values) {
    if (segment.excluded) continue;
    if (segment.blockStart && units.length && units.at(-1) !== "\n") {
      if (units.at(-1) === " ") { units.pop(); mapping.pop(); }
      units.push("\n");
      mapping.push(null);
      whitespace = false;
    }
    for (let offset = 0; offset < segment.text.length; offset++) {
      const char = segment.text[offset];
      if (/[\t\n\r\f ]/u.test(char)) {
        if (units.length && !whitespace && units.at(-1) !== "\n") {
          units.push(" ");
          mapping.push({ start: { nodeKey: segment.nodeKey, offset }, end: { nodeKey: segment.nodeKey, offset: offset + 1 } });
        } else if (mapping.at(-1) && whitespace) {
          mapping.at(-1).end = { nodeKey: segment.nodeKey, offset: offset + 1 };
        }
        whitespace = true;
      } else {
        units.push(char);
        mapping.push({ start: { nodeKey: segment.nodeKey, offset }, end: { nodeKey: segment.nodeKey, offset: offset + 1 } });
        whitespace = false;
      }
      if (units.length > L.scanTotalChars) fail(READING_ERROR.LIMIT, "projection");
    }
  }
  if ([" ", "\n"].includes(units.at(-1))) { units.pop(); mapping.pop(); }
  return { projectionVersion: READING_PROJECTION_VERSION, offsetUnit: "utf-16", text: units.join(""), mapping };
}
