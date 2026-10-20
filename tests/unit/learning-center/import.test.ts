import { expect, test } from "vitest";
import { ReadingClient } from "../../../src/learning-center/client/reading";
import { importRecords } from "../../../src/learning-center/client/import";
import { READING_METHOD as M } from "../../../src/shared/reading/constants.js";
const ok = (data: unknown) => ({ protocolVersion: 2, ok: true, data });
test("large Unicode imports use bounded messages and commit only after all bytes arrive", async () => {
 const text = JSON.stringify({ text: '阅读😀"\\\n'.repeat(180000) });
 const fragments: string[] = []; let committed = false, phase = false;
 const client = new ReadingClient(async raw => {
  const request = raw as { method: string; jsonChunk: string; sequence: number };
  if (request.method === M.IMPORT_START) return ok({ importId: "import-1" });
  if (request.method === M.IMPORT_CHUNK) { expect(request.jsonChunk.length).toBeLessThanOrEqual(16384); expect(JSON.stringify(raw).length).toBeLessThan(128 * 1024); fragments.push(request.jsonChunk); return ok({ sequence: request.sequence }); }
  if (request.method === M.IMPORT_FINISH) { expect(phase).toBe(true); expect(fragments.join("")).toBe(text); committed = true; return ok({ imported: 1, skipped: 0 }); }
  throw new Error("unexpected cancellation");
 });
 const file = new File([text], "synthetic.json");
 expect(await importRecords(client, file, new AbortController().signal, () => {}, () => { phase = true; })).toEqual({ imported: 1, skipped: 0 });
 expect(committed).toBe(true); expect(fragments.length).toBeGreaterThan(100);
});
test("cancel before commit cleans staged data; abort after commit starts cannot claim rollback", async () => {
 for (const late of [false, true]) {
  const controller = new AbortController(), calls: string[] = [];
  const client = new ReadingClient(async raw => {
   const { method, sequence } = raw as { method: string; sequence: number }; calls.push(method);
   if (method === M.IMPORT_START) return ok({ importId: "import-1" });
   if (method === M.IMPORT_CHUNK) { if (!late) controller.abort(); return ok({ sequence }); }
   if (method === M.IMPORT_FINISH) { controller.abort(); return ok({ imported: 1, skipped: 0 }); }
   return ok({ cancelled: true });
  });
  const result = importRecords(client, new File(['{"records":[]}'], "test.json"), controller.signal, () => {}, () => {});
  if (late) { await expect(result).resolves.toEqual({ imported: 1, skipped: 0 }); expect(calls).not.toContain(M.IMPORT_CANCEL); }
  else { await expect(result).rejects.toMatchObject({ code: "READING_IMPORT_CANCELLED" }); expect(calls).not.toContain(M.IMPORT_FINISH); expect(calls).toContain(M.IMPORT_CANCEL); }
 }
});
