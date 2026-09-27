import test from "node:test";
import assert from "node:assert/strict";
import { fetchTrustedPackFile } from "../src/background/providers/pack-network.js";
import { PACK_ERROR_CODES } from "../src/shared/pack-manager.js";

const source = {
  downloadBaseUrl: "https://packs.example/releases/"
};

function descriptor(size) {
  return {
    path: "entries.dat",
    downloadPath: "entries.dat",
    size
  };
}

test("pack download accepts an exact-size streamed response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      }
    }),
    { status: 200 }
  );

  const bytes = await fetchTrustedPackFile(source, descriptor(4));
  assert.deepEqual([...bytes], [1, 2, 3, 4]);
});

test("pack download cancels an undeclared oversized streamed response before full materialization", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let pulls = 0;
  let cancelled = false;
  globalThis.fetch = async () => new Response(
    new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array([pulls, pulls, pulls]));
        if (pulls >= 20) controller.close();
      },
      cancel() {
        cancelled = true;
      }
    }),
    { status: 200 }
  );

  await assert.rejects(
    fetchTrustedPackFile(source, descriptor(4)),
    (error) => error?.code === PACK_ERROR_CODES.DOWNLOAD &&
      error?.actualSize === 6 &&
      error?.maxBytes === 4
  );
  assert.equal(cancelled, true);
  assert.ok(pulls < 20);
});

test("declared oversized response is rejected before reading the body", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let pulled = false;
  globalThis.fetch = async () => new Response(
    new ReadableStream({
      pull(controller) {
        pulled = true;
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      }
    }),
    { status: 200, headers: { "content-length": "9" } }
  );

  await assert.rejects(
    fetchTrustedPackFile(source, descriptor(4)),
    (error) => error?.code === PACK_ERROR_CODES.DOWNLOAD &&
      error?.declared === 9
  );
  assert.equal(pulled, false);
});
