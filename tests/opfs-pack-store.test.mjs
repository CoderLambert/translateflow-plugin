import test from "node:test";
import assert from "node:assert/strict";
import { createOpfsPackStore } from "../src/background/packs/opfs-store.js";
import { PACK_ERROR_CODES } from "../src/shared/pack-manager.js";

test("OPFS pack store reads bounded file ranges without materializing the whole file", async () => {
  const root = new MemoryDirectory();
  const store = createOpfsPackStore({ rootProvider: async () => root });
  const bytes = new TextEncoder().encode("0123456789abcdef");

  await store.writeFile("local-fixture", "v1", "entries.dat", bytes);
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
    let pending = this.bytes;
    return {
      write: async (value) => {
        if (value instanceof Uint8Array) pending = new Uint8Array(value);
        else if (value instanceof ArrayBuffer) pending = new Uint8Array(value.slice(0));
        else pending = new Uint8Array(await new Blob([value]).arrayBuffer());
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
