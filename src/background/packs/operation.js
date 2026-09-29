import {
  PACK_ERROR_CODES,
  packError
} from "../../shared/pack-manager.js";

export function assertPackOperationActive(signal) {
  if (!signal?.aborted) return;
  const error = new DOMException(
    "Dictionary pack operation cancelled.",
    "AbortError"
  );
  throw error;
}

export function normalizePackOperationError(error) {
  if (error?.code && String(error.code).startsWith("PACK_")) return error;
  if (error?.name === "AbortError") {
    return packError(
      PACK_ERROR_CODES.CANCELLED,
      "Dictionary pack operation was cancelled."
    );
  }
  return packError(
    PACK_ERROR_CODES.STORAGE,
    error?.message || "Dictionary pack operation failed.",
    { cause: error }
  );
}
