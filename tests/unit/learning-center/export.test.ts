import { expect, test } from "vitest";
import { ReadingClient } from "../../../src/learning-center/client/reading";
import { exportRecords } from "../../../src/learning-center/client/export";
import { READING_METHOD as M } from "../../../src/shared/reading/constants.js";
import { response } from "../../fixtures/reading/contract.mjs";
const ok = (data: unknown) => ({ protocolVersion: 2, ok: true, data });
test("bounded Unicode fragments form a >1 MiB file, duplicate chunks are not appended and finish precedes delivery", async () => {
  const text = JSON.stringify({ records: [{ answer: '阅读😀"\\\n'.repeat(180000) }] });
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 40000, text.length);
    if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
    chunks.push(text.slice(offset, end)); offset = end;
  }
  let index = 0, duplicated = false, finished = false, outstanding = 0;
  const calls: string[] = [];
  const client = new ReadingClient(async raw => {
    const request = raw as { method: string; sequence: number; cursor: string }; calls.push(request.method);
    if (request.method === M.EXPORT_START) return response(M.EXPORT_START);
    if (request.method === M.EXPORT_NEXT) {
      expect(++outstanding).toBe(1); await Promise.resolve(); outstanding--;
      let sequence = index++;
      if (sequence === 1 && !duplicated) { duplicated = true; index--; sequence = 0; }
      const done = sequence === chunks.length - 1;
      return ok({ sequence, jsonChunk: chunks[sequence], exportRevision: 1, nextCursor: done ? null : `cursor-${sequence + 2}`, done });
    }
    if (request.method === M.EXPORT_FINISH) { expect(request.sequence).toBe(chunks.length - 1); finished = true; return ok({ exportId: "export-1", sequence: request.sequence, exportRevision: 1, state: "finished" }); }
    throw Error("Unexpected request");
  });
  const progress: number[] = [];
  const blob = await exportRecords(client, new AbortController().signal, bytes => progress.push(bytes));
  expect(finished).toBe(true); expect(blob.size).toBeGreaterThan(1024 * 1024); expect(await blob.text()).toBe(text);
  expect(progress).toHaveLength(chunks.length); expect(calls).not.toContain(M.EXPORT_CANCEL);
});
for (const variant of ["missing", "changed", "bad-version", "finish-failed", "cancel"] as const) {
  test(`${variant} discards fragments, requests cancel and never delivers a Blob`, async () => {
    const controller = new AbortController(), calls: string[] = [];
    const client = new ReadingClient(async raw => {
      const { method } = raw as { method: string }; calls.push(method);
      if (method === M.EXPORT_START) return response(M.EXPORT_START);
      if (method === M.EXPORT_CANCEL) return response(M.EXPORT_CANCEL);
      if (method === M.EXPORT_FINISH) throw new Error("worker stopped");
      if (variant === "cancel") controller.abort();
      return { protocolVersion: variant === "bad-version" ? 99 : 2, ok: true, data: {
        sequence: variant === "missing" ? 2 : 0, jsonChunk: "{}", exportRevision: variant === "changed" ? 2 : 1, nextCursor: null, done: true
      } };
    });
    await expect(exportRecords(client, controller.signal, () => {})).rejects.toBeDefined();
    expect(calls).toContain(M.EXPORT_CANCEL);
  });
}
test("successful finish wins a cancel race; UI cannot claim rollback", async () => {
  const controller = new AbortController();
  const client = new ReadingClient(async raw => {
    const { method } = raw as { method: string };
    if (method === M.EXPORT_START) return response(M.EXPORT_START);
    if (method === M.EXPORT_NEXT) return ok({ sequence: 0, jsonChunk: "{}", exportRevision: 1, nextCursor: null, done: true });
    if (method === M.EXPORT_CANCEL) return ok({ exportId: "export-1", state: "finished" });
    controller.abort(); return response(M.EXPORT_FINISH);
  });
  expect(await (await exportRecords(client, controller.signal, () => {})).text()).toBe("{}");
});
