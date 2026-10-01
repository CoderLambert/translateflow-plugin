import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";
import { adler32 } from "../src/background/packs/importers/mdict-contract.js";
import { decodeMdictBlock } from "../src/background/packs/importers/mdict-block-codec.js";
import { buildRichMdictIndex } from "../src/background/packs/importers/mdict-rich-index.js";
import { lookupRichMdict } from "../src/background/packs/importers/mdict-rich-lookup.js";
import { RICH_MDICT_IMPORT_LIMITS } from "../src/background/packs/importers/mdict-rich-validation.js";
import { createRichMdictManager } from "../src/background/packs/rich-mdict.js";
import {
  RICH_MDICT_INDEX_PATH,
  RICH_MDICT_SOURCE_ID,
  RICH_MDICT_SOURCE_PATH
} from "../src/background/packs/rich-mdict-contract.js";
import { createOpfsPackStore } from "../src/background/packs/opfs-store.js";

test("Selection cancellation aborts an active bounded key range before any later range or decode", async () => {
  const bytes = makeRichMdx([["cancel-fixture", "<p>bounded record</p>"]]);
  const source = byteSource(bytes);
  const index = await buildRichMdictIndex({ source });
  const keyBlockOffset = index.keyBlocks[0].dataOffset;
  const controller = new AbortController();
  const started = deferred();
  let activeRangeCancelled = 0;
  let rangeStartsAfterCancel = 0;
  let decodeStartsAfterCancel = 0;
  let decodeStarts = 0;

  const cancellableSource = {
    size: source.size,
    async read(offset, length, signal) {
      if (signal?.aborted) {
        rangeStartsAfterCancel += 1;
        throw abortError();
      }
      if (offset === keyBlockOffset) {
        started.resolve();
        return new Promise((resolve, reject) => {
          const cancel = () => {
            activeRangeCancelled += 1;
            reject(abortError());
          };
          signal?.addEventListener("abort", cancel, { once: true });
        });
      }
      return source.read(offset, length, signal);
    }
  };

  const lookup = lookupRichMdict({
    source: cancellableSource,
    index,
    text: "cancel-fixture",
    signal: controller.signal,
    decompressionStreamFactory: () => {
      if (controller.signal.aborted) decodeStartsAfterCancel += 1;
      decodeStarts += 1;
      return new DecompressionStream("deflate");
    }
  });
  await started.promise;
  controller.abort();

  await assert.rejects(lookup, (error) => error?.name === "AbortError");
  assert.equal(activeRangeCancelled, 1, "the current bounded source range is cancelled");
  assert.equal(rangeStartsAfterCancel, 0, "no next bounded range begins after cancellation");
  assert.equal(decodeStarts, 0, "the cancelled compressed key block is never decompressed");
  assert.equal(decodeStartsAfterCancel, 0);
});

test("cancellation cancels a bounded decompression reader and remains AbortError", async () => {
  const controller = new AbortController();
  let readableController;
  let readerCancelled = 0;
  const output = new ReadableStream({
    start(value) { readableController = value; },
    cancel() { readerCancelled += 1; }
  });
  const stream = {
    writable: new WritableStream({ write() {} }),
    readable: output
  };
  const payload = Uint8Array.of(2, 0, 0, 0, 0, 0, 0, 0, 1);
  new DataView(payload.buffer).setUint32(4, adler32(Uint8Array.of(65)));
  const decoding = decodeMdictBlock({
    input: payload,
    expectedBytes: 1,
    limits: RICH_MDICT_IMPORT_LIMITS,
    label: "fixture block",
    signal: controller.signal,
    decompressionStreamFactory: () => stream
  });

  await waitFor(() => readableController);
  controller.abort();
  await assert.rejects(decoding, (error) => error?.name === "AbortError");
  assert.equal(readerCancelled, 1);
});

test("Selection lookup cancellation is request-ID and content-owner scoped", async () => {
  const bytes = makeRichMdx([["manager-cancel", "<p>bounded record</p>"]]);
  const source = byteSource(bytes);
  const index = await buildRichMdictIndex({ source });
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  const indexSha256 = await digest(indexBytes);
  const packId = "rich-mdict-123e4567-e89b-42d3-a456-426614174000";
  const packVersion = "import-m1234-123e4567";
  const active = {
    packId,
    packVersion,
    sourceSize: bytes.byteLength,
    indexSize: indexBytes.byteLength,
    indexSha256,
    entryCount: index.entryCount,
    title: index.header.title,
    fileName: "manager-cancel.mdx",
    format: index.header.format,
    header: index.header
  };
  const state = { packs: { [packId]: { sourceId: RICH_MDICT_SOURCE_ID, status: "healthy", active } } };
  const started = deferred();
  let rangeStarts = 0;
  let canceledRanges = 0;
  const store = {
    async writeFile() {},
    async readFile(_id, _version, path) {
      assert.equal(path, RICH_MDICT_INDEX_PATH);
      return indexBytes;
    },
    async getFileSize(_id, _version, path) {
      return path === RICH_MDICT_INDEX_PATH ? indexBytes.byteLength : bytes.byteLength;
    },
    async readFileRange(_id, _version, path, offset, length, signal) {
      assert.equal(path, RICH_MDICT_SOURCE_PATH);
      rangeStarts += 1;
      started.resolve();
      return new Promise((resolve, reject) => {
        const cancel = () => {
          canceledRanges += 1;
          reject(abortError());
        };
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort", cancel, { once: true });
      });
    },
    async listVersions() { return [packVersion]; },
    async removeVersion() {},
    async removePack() {}
  };
  const stateStore = {
    async read() { return state; },
    async update(action) { return action(state); }
  };
  const manager = createRichMdictManager({ store, stateStore, cryptoProvider: webcrypto });
  const requestId = "selection-rich-lookup-0123456789abcdef0123456789abcdef";
  const lookup = manager.lookupDictionary("manager-cancel", packId, { requestId, ownerKey: "selection:7:0:doc-a" });
  await started.promise;

  assert.deepEqual(manager.cancelLookup(requestId, "selection:7:1:doc-a"), {
    cancelled: false,
    phase: "owner-mismatch"
  });
  assert.deepEqual(manager.cancelLookup(requestId, "selection:7:0:doc-a"), {
    cancelled: true,
    phase: "active"
  });
  await assert.rejects(lookup, (error) => error?.name === "AbortError");
  assert.equal(rangeStarts, 1);
  assert.equal(canceledRanges, 1);
});

test("cancel-before-dispatch tombstones only the exact Selection request until its delayed lookup arrives", async () => {
  const bytes = makeRichMdx([["pending-cancel", "<p>bounded record</p>"]]);
  const source = byteSource(bytes);
  const index = await buildRichMdictIndex({ source });
  const indexBytes = new TextEncoder().encode(JSON.stringify(index));
  const packId = "rich-mdict-123e4567-e89b-42d3-a456-426614174001";
  const packVersion = "import-m1234-123e4568";
  const active = {
    packId, packVersion, sourceSize: bytes.byteLength, indexSize: indexBytes.byteLength,
    indexSha256: await digest(indexBytes), entryCount: index.entryCount,
    title: index.header.title, fileName: "pending.mdx", format: index.header.format,
    header: index.header
  };
  const state = { packs: { [packId]: { sourceId: RICH_MDICT_SOURCE_ID, status: "healthy", active } } };
  let rangeStarts = 0;
  const store = {
    async writeFile() {},
    async readFile() { return indexBytes; },
    async getFileSize(_id, _version, path) { return path === RICH_MDICT_INDEX_PATH ? indexBytes.byteLength : bytes.byteLength; },
    async readFileRange() { rangeStarts += 1; return new Uint8Array(); },
    async listVersions() { return [packVersion]; }, async removeVersion() {}, async removePack() {}
  };
  const stateStore = { async read() { return state; }, async update(action) { return action(state); } };
  const manager = createRichMdictManager({ store, stateStore, cryptoProvider: webcrypto });
  const requestId = "selection-rich-lookup-fedcba9876543210fedcba9876543210";
  assert.deepEqual(manager.cancelLookup(requestId, "selection:9:0:doc-b"), {
    cancelled: true,
    phase: "pending"
  });

  await assert.rejects(
    manager.lookupDictionary("pending-cancel", packId, { requestId, ownerKey: "selection:9:0:doc-b" }),
    (error) => error?.name === "AbortError"
  );
  assert.equal(rangeStarts, 0);
});

test("OPFS range reads cancel their underlying Blob stream on Selection abort", async () => {
  let streamCancelled = 0;
  const root = new FakeDirectory();
  const dictionaries = new FakeDirectory();
  const pack = new FakeDirectory();
  const version = new FakeDirectory();
  const handle = {
    kind: "file",
    async getFile() {
      return {
        size: 8,
        slice() {
          return {
            stream() {
              return new ReadableStream({
                start() { storeReadPending = true; },
                pull() {},
                cancel() { streamCancelled += 1; }
              });
            }
          };
        }
      };
    }
  };
  root.directories.set("dictionaries", dictionaries);
  dictionaries.directories.set("rich-mdict-123e4567-e89b-42d3-a456-426614174000", pack);
  pack.directories.set("import-m1234-123e4567", version);
  version.files.set("source.mdx", handle);
  const store = createOpfsPackStore({ rootProvider: async () => root });
  const controller = new AbortController();
  const read = store.readFileRange(
    "rich-mdict-123e4567-e89b-42d3-a456-426614174000",
    "import-m1234-123e4567",
    "source.mdx",
    0,
    8,
    controller.signal
  );

  await waitFor(() => storeReadPending);
  controller.abort();
  await assert.rejects(read, (error) => error?.name === "AbortError");
  assert.equal(streamCancelled, 1);
});

let storeReadPending = false;

function byteSource(bytes) {
  return {
    size: bytes.byteLength,
    async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function abortError() {
  return new DOMException("fixture cancelled", "AbortError");
}

async function digest(bytes) {
  const hash = new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes));
  return Array.from(hash, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for cancellable range fixture.");
}

class FakeDirectory {
  directories = new Map();
  files = new Map();
  async getDirectoryHandle(name) {
    const directory = this.directories.get(name);
    if (!directory) throw notFound();
    return directory;
  }
  async getFileHandle(name) {
    const file = this.files.get(name);
    if (!file) throw notFound();
    return file;
  }
}

function notFound() {
  const error = new Error("fixture entry missing");
  error.name = "NotFoundError";
  return error;
}
