import test from "node:test";
import assert from "node:assert/strict";
import { createOpfsImportQuarantine } from "../src/shared/opfs-import-quarantine.js";
import {
  IMPORT_QUARANTINE_RANGE_BYTES,
  isSafeImportQuarantineToken,
  makeImportQuarantineToken
} from "../src/shared/import-quarantine-contract.js";
import { PACK_ERROR_CODES } from "../src/shared/pack-manager.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("import quarantine tokens are canonical random UUID-backed identifiers", () => {
  const token = makeImportQuarantineToken(
    () => "123E4567-E89B-42D3-A456-426614174000"
  );
  assert.equal(
    token,
    "import-123e4567-e89b-42d3-a456-426614174000"
  );
  assert.equal(isSafeImportQuarantineToken(token), true);
  assert.equal(
    isSafeImportQuarantineToken("../dictionaries/local-pack"),
    false
  );
  assert.equal(
    isSafeImportQuarantineToken(
      "import-123e4567-e89b-12d3-a456-426614174000"
    ),
    false
  );
  assert.throws(
    () => makeImportQuarantineToken(() => "not-a-uuid"),
    /invalid UUID/i
  );
});

test("OPFS import quarantine only exposes bounded exact-file staging primitives", async () => {
  const root = new MemoryDirectory();
  const quarantine = createOpfsImportQuarantine({
    rootProvider: async () => root
  });
  const token = makeToken(1);

  await quarantine.writeFile(
    token,
    "manifest.json",
    encoder.encode("{}")
  );
  await quarantine.writeFile(
    token,
    "index.dat",
    encoder.encode("{\"format\":\"fixture\"}")
  );
  await quarantine.writeFile(
    token,
    "entries.dat",
    encoder.encode("0123456789abcdef")
  );

  assert.deepEqual(
    await quarantine.listFiles(token),
    [
      { path: "entries.dat", size: 16 },
      { path: "index.dat", size: 20 },
      { path: "manifest.json", size: 2 }
    ]
  );
  assert.deepEqual(
    await quarantine.statFile(token, "entries.dat"),
    { path: "entries.dat", size: 16 }
  );
  assert.equal(
    decoder.decode(
      await quarantine.readFileRange(
        token,
        "entries.dat",
        4,
        6
      )
    ),
    "456789"
  );

  await assert.rejects(
    quarantine.readFileRange(
      token,
      "entries.dat",
      14,
      4
    ),
    (error) =>
      error?.code === PACK_ERROR_CODES.STORAGE &&
      /range exceeds/i.test(error.message)
  );
  await assert.rejects(
    quarantine.readFileRange(
      token,
      "entries.dat",
      0,
      IMPORT_QUARANTINE_RANGE_BYTES + 1
    ),
    (error) =>
      error?.code === PACK_ERROR_CODES.STORAGE
  );
  await assert.rejects(
    quarantine.writeFile(
      token,
      "../entries.dat",
      encoder.encode("escape")
    ),
    (error) =>
      error?.code === PACK_ERROR_CODES.STORAGE
  );
  await assert.rejects(
    quarantine.writeFile(
      "../" + token,
      "entries.dat",
      encoder.encode("escape")
    ),
    (error) =>
      error?.code === PACK_ERROR_CODES.STORAGE
  );

  assert.equal(root.directories.has("dictionaries"), false);
  assert.equal(
    root.directories.has("dictionary-import-quarantine"),
    true
  );
});

test("import quarantine fails closed on unexpected staged entries", async () => {
  const root = new MemoryDirectory();
  const quarantine = createOpfsImportQuarantine({
    rootProvider: async () => root
  });
  const token = makeToken(2);

  await quarantine.writeFile(
    token,
    "manifest.json",
    encoder.encode("{}")
  );

  const quarantineRoot = await root.getDirectoryHandle(
    "dictionary-import-quarantine"
  );
  const tokenDir = await quarantineRoot.getDirectoryHandle(token);
  const unexpected = await tokenDir.getFileHandle(
    "payload.html",
    { create: true }
  );
  const writable = await unexpected.createWritable();
  await writable.write(encoder.encode("<script>bad()</script>"));
  await writable.close();

  await assert.rejects(
    quarantine.listFiles(token),
    (error) =>
      error?.code === PACK_ERROR_CODES.CORRUPT &&
      /unexpected entry/i.test(error.message)
  );
});

test("quarantine cleanup removes orphans without touching active dictionary storage", async () => {
  const root = new MemoryDirectory();
  const quarantine = createOpfsImportQuarantine({
    rootProvider: async () => root
  });
  const keep = makeToken(3);
  const orphan = makeToken(4);

  await quarantine.writeFile(
    keep,
    "manifest.json",
    encoder.encode("{}")
  );
  await quarantine.writeFile(
    orphan,
    "manifest.json",
    encoder.encode("{}")
  );

  const dictionaries = await root.getDirectoryHandle(
    "dictionaries",
    { create: true }
  );
  const activePack = await dictionaries.getDirectoryHandle(
    "local-active",
    { create: true }
  );
  const activeVersion = await activePack.getDirectoryHandle(
    "v1",
    { create: true }
  );
  const activeFile = await activeVersion.getFileHandle(
    "entries.dat",
    { create: true }
  );
  const activeWritable = await activeFile.createWritable();
  await activeWritable.write(encoder.encode("active"));
  await activeWritable.close();

  const quarantineRoot = await root.getDirectoryHandle(
    "dictionary-import-quarantine"
  );
  await quarantineRoot.getDirectoryHandle(
    "junk",
    { create: true }
  );

  assert.deepEqual(
    await quarantine.cleanup([keep]),
    [orphan, "junk"].sort()
  );
  assert.deepEqual(await quarantine.listTokens(), [keep]);
  assert.equal(await quarantine.remove(orphan), false);

  const preserved = await root
    .getDirectoryHandle("dictionaries")
    .then((directory) =>
      directory.getDirectoryHandle("local-active")
    )
    .then((directory) =>
      directory.getDirectoryHandle("v1")
    )
    .then((directory) =>
      directory.getFileHandle("entries.dat")
    )
    .then((handle) => handle.getFile());
  assert.equal(await preserved.text(), "active");

  assert.equal(await quarantine.remove(keep), true);
  assert.deepEqual(await quarantine.listTokens(), []);
});

function makeToken(index) {
  return makeImportQuarantineToken(
    () =>
      "123e4567-e89b-42d3-a456-" +
      String(index).padStart(12, "0")
  );
}

class MemoryDirectory {
  constructor() {
    this.kind = "directory";
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(
    name,
    { create = false } = {}
  ) {
    let value = this.directories.get(name);
    if (!value && create) {
      value = new MemoryDirectory();
      this.directories.set(name, value);
    }
    if (!value) throw notFound();
    return value;
  }

  async getFileHandle(
    name,
    { create = false } = {}
  ) {
    let value = this.files.get(name);
    if (!value && create) {
      value = new MemoryFile();
      this.files.set(name, value);
    }
    if (!value) throw notFound();
    return value;
  }

  async removeEntry(
    name,
    { recursive = false } = {}
  ) {
    if (this.files.delete(name)) return;
    const directory = this.directories.get(name);
    if (!directory) throw notFound();
    if (
      !recursive &&
      (directory.files.size ||
        directory.directories.size)
    ) {
      const error = new Error(
        "directory not empty"
      );
      error.name = "InvalidModificationError";
      throw error;
    }
    this.directories.delete(name);
  }

  async *entries() {
    for (const [name, value] of this.directories) {
      yield [name, value];
    }
    for (const [name, value] of this.files) {
      yield [name, value];
    }
  }
}

class MemoryFile {
  constructor() {
    this.kind = "file";
    this.bytes = new Uint8Array();
  }

  async createWritable() {
    let pending = this.bytes;
    return {
      write: async (value) => {
        if (value instanceof Uint8Array) {
          pending = new Uint8Array(value);
        } else if (value instanceof ArrayBuffer) {
          pending = new Uint8Array(value.slice(0));
        } else {
          pending = new Uint8Array(
            await new Blob([value]).arrayBuffer()
          );
        }
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
