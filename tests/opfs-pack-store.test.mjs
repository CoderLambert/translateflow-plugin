import test from "node:test";
import assert from "node:assert/strict";
import { createOpfsPackStore } from "../src/background/packs/opfs-store.js";
import { PACK_ERROR_CODES } from "../src/shared/pack-manager.js";

test("OPFS pack store reads bounded file ranges without materializing the whole file", async () => {
  const root = new MemoryDirectory();
  const store = createOpfsPackStore({ rootProvider: async () => root });
  const bytes = new TextEncoder().encode("0123456789abcdef");

  await store.writeFile("local-fixture", "v1", "entries.dat", bytes);
  assert.equal(await store.getFileSize("local-fixture", "v1", "entries.dat"), bytes.byteLength);
  assert.equal(
    new TextDecoder().decode(await store.readFileRange(
      "local-fixture",
      "v1",
      "entries.dat",
      4,
      6
    )),
    "456789"
  );

  await assert.rejects(
    store.readFileRange("local-fixture", "v1", "entries.dat", 14, 4),
    (error) => error?.code === PACK_ERROR_CODES.STORAGE &&
      /range exceeds/i.test(error.message)
  );
  await assert.rejects(
    store.readFileRange("local-fixture", "v1", "entries.dat", -1, 1),
    (error) => error?.code === PACK_ERROR_CODES.STORAGE
  );
  await assert.rejects(
    store.readFileRange("local-fixture", "v1", "entries.dat", 0, 0),
    (error) => error?.code === PACK_ERROR_CODES.STORAGE
  );
  await assert.rejects(
    store.getFileSize("local-fixture", "v1", "missing.dat"),
    (error) => error?.code === PACK_ERROR_CODES.STORAGE && error?.missing === true
  );
});

test("OPFS pack store range reads preserve path and identifier safety", async () => {
  const root = new MemoryDirectory();
  const store = createOpfsPackStore({ rootProvider: async () => root });

  await assert.rejects(
    store.readFileRange("../escape", "v1", "entries.dat", 0, 1),
    (error) => error?.code === PACK_ERROR_CODES.STORAGE
  );
  await assert.rejects(
    store.readFileRange("local-fixture", "v1", "../entries.dat", 0, 1),
    (error) => error?.code === PACK_ERROR_CODES.STORAGE
  );
});

test("OPFS File writes copy bounded slices, report completed bytes, and keep the previous file on cancellation", async () => {
  const root = new MemoryDirectory();
  const store = createOpfsPackStore({ rootProvider: async () => root });
  const original = new TextEncoder().encode("previous-version");
  await store.writeFile("local-fixture", "v1", "source.dat", original);

  const bytes = Uint8Array.from({ length: 257 }, (_, index) => index & 0xff);
  const reads = [];
  const file = {
    size: bytes.byteLength,
    slice(start, end) {
      reads.push([start, end]);
      return new Blob([bytes.subarray(start, end)]);
    }
  };
  const progress = [];
  const completed = await store.writeFile("local-fixture", "v1", "source.dat", file, {
    chunkBytes: 32,
    onProgress: (detail) => progress.push(detail)
  });
  assert.deepEqual(completed, { bytesWritten: bytes.byteLength, totalBytes: bytes.byteLength });
  assert.equal(reads.length, Math.ceil(bytes.byteLength / 32));
  assert.deepEqual(progress.map(({ bytesWritten }) => bytesWritten), [32, 64, 96, 128, 160, 192, 224, 256, 257]);
  assert.deepEqual(await store.readFile("local-fixture", "v1", "source.dat"), bytes);

  const controller = new AbortController();
  const cancelledProgress = [];
  await assert.rejects(store.writeFile("local-fixture", "v1", "source.dat", file, {
    chunkBytes: 32,
    signal: controller.signal,
    onProgress: (detail) => {
      cancelledProgress.push(detail);
      controller.abort();
    }
  }), (error) => error?.name === "AbortError");
  assert.deepEqual(cancelledProgress, [{ bytesWritten: 32, totalBytes: bytes.byteLength, chunkBytes: 32 }]);
  assert.deepEqual(await store.readFile("local-fixture", "v1", "source.dat"), bytes,
    "an aborted replacement never publishes a partial file");
});

class MemoryDirectory {
  constructor() {
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    let value = this.directories.get(name);
    if (!value && create) {
      value = new MemoryDirectory();
      this.directories.set(name, value);
    }
    if (!value) throw notFound();
    return value;
  }

  async getFileHandle(name, { create = false } = {}) {
    let value = this.files.get(name);
    if (!value && create) {
      value = new MemoryFile();
      this.files.set(name, value);
    }
    if (!value) throw notFound();
    return value;
  }

  async removeEntry(name, { recursive = false } = {}) {
    if (this.files.delete(name)) return;
    const directory = this.directories.get(name);
    if (!directory) throw notFound();
    if (!recursive && (directory.files.size || directory.directories.size)) {
      const error = new Error("directory not empty");
      error.name = "InvalidModificationError";
      throw error;
    }
    this.directories.delete(name);
  }

  async *entries() {
    for (const [name, value] of this.directories) yield [name, { ...value, kind: "directory" }];
    for (const [name, value] of this.files) yield [name, { ...value, kind: "file" }];
  }
}

class MemoryFile {
  constructor() {
    this.bytes = new Uint8Array();
    this.kind = "file";
  }

  async createWritable() {
    let pending = new Uint8Array();
    return {
      write: async (value) => {
        const bytes = value instanceof Uint8Array
          ? value
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(await new Blob([value]).arrayBuffer());
        const next = new Uint8Array(pending.byteLength + bytes.byteLength);
        next.set(pending);
        next.set(bytes, pending.byteLength);
        pending = next;
      },
      close: async () => {
        this.bytes = new Uint8Array(pending);
      },
      abort: async () => {}
    };
  }

  async getFile() {
    return new Blob([this.bytes]);
  }
}

function notFound() {
  const error = new Error("not found");
  error.name = "NotFoundError";
  return error;
}
