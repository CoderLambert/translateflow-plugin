import { parseSafeSvg, SAFE_SVG_LIMITS } from "../../../shared/safe-svg.js";
import { MDICT_IMPORT_ERROR, mdictFail, requireMdictAtMost } from "./mdict-contract.js";

export function classifyMddSvg(bytes) {
  requireMdictAtMost(bytes.byteLength, SAFE_SVG_LIMITS.sourceBytes, "MDD static SVG bytes");
  let safe;
  try { safe = parseSafeSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { /* Invalid UTF-8 is rejected. */ }
  if (!safe) mdictFail(MDICT_IMPORT_ERROR.UNSAFE_CONTENT, "MDD SVG is outside the safe static scene subset.");
  return { kind: "image", mime: "image/svg+xml", dimensions: { width: safe.width, height: safe.height }, safeSvg: safe.scene };
}
