import { READING_BACKUP_FILE_BYTES } from "../../shared/reading/constants.js";
import { READING_LIMITS as L, READING_METHOD as M } from "../../shared/reading/constants.js";
import { ReadingClient, ReadingError } from "./reading";
export async function importRecords(client: ReadingClient, file: File, signal: AbortSignal, progress: (bytes: number) => void, committing: () => void) {
  if (!file.size || file.size > READING_BACKUP_FILE_BYTES) throw new ReadingError("READING_LIMIT");
  const check = () => { if (signal.aborted) throw new ReadingError("READING_IMPORT_CANCELLED"); };
  let importId = "", finished = false;
  const reader = file.stream().getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    check(); ({ importId } = await client.request<{ importId: string }>(M.IMPORT_START, { bytes: file.size }));
    let sequence = 0, bytes = 0, pending = "";
    async function send(text: string) {
      check(); const ack = await client.request<{ sequence: number }>(M.IMPORT_CHUNK, { importId, sequence, jsonChunk: text });
      if (ack.sequence !== sequence++) throw new ReadingError("READING_INTERRUPTED");
    }
    for (;;) {
      check(); const chunk = await reader.read(); check();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      // Bound raw and escaped message size; retain a possible high surrogate until the next slice.
      while (pending.length >= 16384) { let end = 16384; if (/[\uD800-\uDBFF]/u.test(pending[end - 1] ?? "")) end--; await send(pending.slice(0, end)); pending = pending.slice(end); }
      bytes += chunk.value?.byteLength ?? 0; progress(bytes);
      if (chunk.done) break;
    }
    if (pending) await send(pending);
    check(); committing();
    const result = await client.request<{ imported: number; skipped: number }>(M.IMPORT_FINISH, { importId });
    finished = true; return result;
  } finally {
    signal.removeEventListener("abort", abort); reader.releaseLock();
    if (importId && !finished) await client.request(M.IMPORT_CANCEL, { importId }).catch(() => {});
  }
}
