import { BACKGROUND_MESSAGES } from "../shared/constants.js";
import { createOpfsImportQuarantine } from "../shared/opfs-import-quarantine.js";
import { makeImportQuarantineToken } from "../shared/import-quarantine-contract.js";

const REQUIRED_FILES = Object.freeze(["entries.dat", "index.dat", "manifest.json"]);
const FILE_BYTES = 64 * 1024 * 1024;
const TOTAL_BYTES = 128 * 1024 * 1024;

export function createTflexLocalImportController({
  runtime = globalThis.chrome?.runtime,
  cryptoProvider = globalThis.crypto,
  quarantine = createOpfsImportQuarantine(),
  onProgress = () => {}
} = {}) {
  if (!runtime?.sendMessage) throw new Error("TFLex import requires the extension runtime.");
  if (!quarantine?.writeBlob || !quarantine?.listFiles || !quarantine?.remove) {
    throw new Error("TFLex import requires bounded OPFS quarantine staging.");
  }

  let active = null;

  async function importDictionary({ files, displayMetadata } = {}) {
    if (active) throw controllerError("TFLEX_IMPORT_BUSY", "Another local dictionary import is running.");
    const normalized = validateFiles(files);
    const uuid = String(cryptoProvider?.randomUUID?.() || "").toLowerCase();
    if (!/^[a-f0-9-]{36}$/u.test(uuid)) throw controllerError("TFLEX_IMPORT_ID", "Browser could not create a secure local import ID.");
    const token = makeImportQuarantineToken(() => uuid);
    const requestId = "local-tflex-" + uuid;
    const current = { token, requestId, phase: "stage", controller: new AbortController() };
    active = current;
    try {
      for (const path of REQUIRED_FILES) {
        assertCurrent(current);
        emitProgress(onProgress, requestId, "stage", { path });
        await quarantine.writeBlob(token, path, normalized.byName.get(path), {
          signal: current.controller.signal,
          onProgress(details) { emitProgress(onProgress, requestId, "stage-file", details); }
        });
      }
      assertCurrent(current);
      const staged = await quarantine.listFiles(token);
      if (staged.length !== REQUIRED_FILES.length || REQUIRED_FILES.some((path) => !staged.some((item) => item.path === path))) {
        throw controllerError("TFLEX_IMPORT_STAGE", "TFLex staging is incomplete.");
      }
      current.phase = "commit";
      emitProgress(onProgress, requestId, "commit");
      const commit = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT,
        token,
        requestId,
        displayMetadata
      });
      if (!commit?.ok) throw controllerError(commit?.errorCode || "TFLEX_IMPORT_INVALID", commit?.error || "TFLex full integrity validation or activation failed.");
      emitProgress(onProgress, requestId, "done");
      return { requestId, commit };
    } catch (error) {
      if (current.controller.signal.aborted && error?.name !== "AbortError") throw abortError();
      throw error;
    } finally {
      await quarantine.remove(token).catch(() => {});
      if (active === current) active = null;
    }
  }

  async function cancel() {
    const current = active;
    if (!current) return { cancelled: false, phase: "" };
    current.controller.abort();
    if (current.phase === "commit") {
      const response = await runtime.sendMessage({
        type: BACKGROUND_MESSAGES.DICTIONARY_PACK_CANCEL,
        requestId: current.requestId
      });
      return { cancelled: Boolean(response?.cancelled), phase: "commit" };
    }
    return { cancelled: true, phase: current.phase };
  }

  function dispose() {
    const current = active;
    if (!current) return;
    current.controller.abort();
    void quarantine.remove(current.token).catch(() => {});
    active = null;
  }

  function assertCurrent(current) {
    if (active !== current || current.controller.signal.aborted) throw abortError();
  }

  return Object.freeze({
    importDictionary,
    cancel,
    dispose,
    get phase() { return active?.phase || ""; },
    get activeRequestId() { return active?.requestId || ""; }
  });
}

function validateFiles(files) {
  const selected = Array.from(files || []);
  const byName = new Map();
  let totalBytes = 0;
  for (const file of selected) {
    const name = String(file?.name || "").toLocaleLowerCase("en-US");
    if (!REQUIRED_FILES.includes(name) || byName.has(name) || typeof file.slice !== "function" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > FILE_BYTES) {
      throw controllerError("TFLEX_IMPORT_INPUT", "TFLex import requires exactly one bounded manifest.json, index.dat, and entries.dat file.");
    }
    totalBytes += file.size;
    byName.set(name, file);
  }
  if (selected.length !== REQUIRED_FILES.length || REQUIRED_FILES.some((path) => !byName.has(path)) || totalBytes > TOTAL_BYTES) {
    throw controllerError("TFLEX_IMPORT_INPUT", "TFLex import requires exactly one bounded manifest.json, index.dat, and entries.dat file.");
  }
  return { byName };
}

function emitProgress(onProgress, requestId, phase, details = {}) {
  try { onProgress({ requestId, phase, ...details }); } catch {}
}

function controllerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function abortError() {
  return new DOMException("TFLex import was cancelled.", "AbortError");
}
