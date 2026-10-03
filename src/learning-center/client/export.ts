import { READING_METHOD as M, READING_LIMITS as L } from "../../shared/reading/constants.js";
import { ReadingClient, ReadingError } from "./reading";
import type { ExportStart, ExportChunk, ExportFinish } from "./reading";

// Fragments stay outside React state. One awaited chunk at a time provides backpressure.
export async function exportRecords(client: ReadingClient, signal: AbortSignal, progress: (bytes: number) => void): Promise<Blob> {
  let session: ExportStart | undefined;
  let finished = false;
  const parts: Blob[] = [];
  let bytes = 0, sequence = -1, lastChunk = "";
  const cancel = () => { if (session && !finished) void client.request(M.EXPORT_CANCEL, { exportId: session.exportId }).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const check = () => { if (signal.aborted) throw new ReadingError("READING_EXPORT_CANCELLED"); };
  try {
    check(); session = await client.request<ExportStart>(M.EXPORT_START); check();
    let cursor: string | null = session.nextCursor;
    let duplicateRetries = 0;
    while (cursor !== null) {
      check();
      const chunk: ExportChunk = await client.request(M.EXPORT_NEXT, { exportId: session.exportId, cursor });
      check();
      if (chunk.exportRevision !== session.exportRevision) throw new ReadingError("READING_INTERRUPTED");
      if (chunk.sequence === sequence) {
        // Exact retries may repeat delivery. Do not append twice; missing/out-of-order data fails closed.
        if (chunk.jsonChunk !== lastChunk || ++duplicateRetries > 2) throw new ReadingError("READING_INTERRUPTED");
        continue;
      }
      if (chunk.sequence !== sequence + 1) throw new ReadingError("READING_INTERRUPTED");
      duplicateRetries = 0;
      const part = new Blob([chunk.jsonChunk]); bytes += part.size;
      if (bytes > L.totalBytes + 1024 * 1024) throw new ReadingError("READING_LIMIT");
      parts.push(part); lastChunk = chunk.jsonChunk; sequence = chunk.sequence; cursor = chunk.nextCursor; progress(bytes);
    }
    check();
    const ack = await client.request<ExportFinish>(M.EXPORT_FINISH, { exportId: session.exportId, sequence });
    if (ack.exportId !== session.exportId || ack.sequence !== sequence || ack.exportRevision !== session.exportRevision) throw new ReadingError("READING_INTERRUPTED");
    // Finish delivery is the commit point. A raced cancel cannot pretend to retract it.
    finished = true;
    return new Blob(parts, { type: "application/json;charset=utf-8" });
  } finally {
    parts.length = 0; signal.removeEventListener("abort", cancel);
    if (session && !finished) await client.request(M.EXPORT_CANCEL, { exportId: session.exportId }).catch(() => {});
  }
}
export function download(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `translateflow-reading-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }
}
