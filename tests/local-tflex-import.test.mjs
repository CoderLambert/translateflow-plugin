import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { buildIndexedData } from "../scripts/build-tflex-freedict.mjs";
import { createActiveOpfsPackReader } from "../src/background/lexical/active-opfs-reader.js";
import { createDictionaryPackManager } from "../src/background/packs/manager.js";
import {
  LOCAL_IMPORT_LICENSE_ID,
  LOCAL_IMPORT_SEMANTIC_PROFILE,
  makeLocalImportFingerprintPayload,
  validateLocalTflexImport,
  validateOwnedLocalTflexBuild
} from "../src/background/packs/local-import.js";
import { PACK_ERROR_CODES } from "../src/shared/pack-manager.js";
import { makeImportQuarantineToken } from "../src/shared/import-quarantine-contract.js";

const encoder = new TextEncoder();

test("public local TFLex validation snapshots caller-owned bytes before async verification", async () => {
  const files = await makePack({
    packId: "local-defensive-copy",
    packVersion: "v1",
    translation: "运行"
  });
  const original = new Uint8Array(files["entries.dat"]);
  let releaseDigest;
  let signalDigest;
  const digestStarted = new Promise((resolve) => {
    signalDigest = resolve;
  });
  const digestGate = new Promise((resolve) => {
    releaseDigest = resolve;
  });
  let blockedOnce = false;
  const cryptoProvider = {
    subtle: {
      async digest(algorithm, bytes) {
        if (!blockedOnce) {
          blockedOnce = true;
          signalDigest();
          await digestGate;
        }
        return webcrypto.subtle.digest(algorithm, bytes);
      }
    }
  };

  const validating = validateLocalTflexImport({
    files,
    cryptoProvider
  });
  await digestStarted;
  files["entries.dat"][0] ^= 1;
  releaseDigest();

  const validated = await validating;
  assert.deepEqual(
    validated.files.find((file) =>
      file.path === "entries.dat"
    ).bytes,
    original
  );
  assert.notDeepEqual(files["entries.dat"], original);
});

test("owned local TFLex build validation reuses trusted builder buffers", async () => {
  const files = await makePack({
    packId: "local-owned-build",
    packVersion: "v1",
    translation: "运行"
  });
  const validated = await validateOwnedLocalTflexBuild({
    files,
    cryptoProvider: webcrypto
  });

  for (const file of validated.files) {
    assert.equal(
      file.bytes,
      files[file.path],
      file.path + " should not be cloned"
    );
  }
});

test("local TFLex import stages, health-checks and activates a queryable OPFS pack", async () => {
  const env = createEnvironment();
  const files = await makePack({
    packId: "local-fixture",
    packVersion: "v1",
    translation: "运行"
  });

  const result = await env.manager.importLocalTflex({
    files,
    requestId: "import-v1"
  });
  assert.equal(result.status, "imported");
  assert.equal(result.pack.active.packVersion, "v1");
  assert.equal(result.pack.fallback, null);

  const state = await env.stateStore.read();
  assert.equal(state.packs["local-fixture"].sourceId, "local-user-import");
  assert.equal(state.packs["local-fixture"].status, "healthy");
  assert.equal(await env.store.hasVersion("local-fixture", "v1"), true);

  const reader = createActiveOpfsPackReader({
    stateStore: env.stateStore,
    store: env.store,
    cryptoProvider: webcrypto
  });
  const hits = await reader.lookupAll("running");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].matchedAlias, true);
  assert.equal(hits[0].record.lookupKey, "run");
  assert.deepEqual(hits[0].record.senses[0].translations, ["运行"]);
});

test("local TFLex update atomically retains previous healthy active as fallback", async () => {
  const env = createEnvironment();
  await env.manager.importLocalTflex({
    files: await makePack({
      packId: "local-fixture",
      packVersion: "v1",
      translation: "运行"
    }),
    requestId: "v1"
  });

  const updated = await env.manager.importLocalTflex({
    files: await makePack({
      packId: "local-fixture",
      packVersion: "v2",
      translation: "执行"
    }),
    requestId: "v2"
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.pack.active.packVersion, "v2");
  assert.equal(updated.pack.fallback.packVersion, "v1");

  const reader = createActiveOpfsPackReader({
    stateStore: env.stateStore,
    store: env.store,
    cryptoProvider: webcrypto
  });
  const hit = await reader.lookup("run");
  assert.deepEqual(hit.record.senses[0].translations, ["执行"]);
});

test("same local version with conflicting fingerprint is rejected without replacing active bytes", async () => {
  const env = createEnvironment();
  await env.manager.importLocalTflex({
    files: await makePack({
      packId: "local-fixture",
      packVersion: "v1",
      translation: "运行"
    }),
    requestId: "base"
  });

  await assert.rejects(
    env.manager.importLocalTflex({
      files: await makePack({
        packId: "local-fixture",
        packVersion: "v1",
        translation: "冲突"
      }),
      requestId: "conflict"
    }),
    (error) => error?.code === PACK_ERROR_CODES.INCOMPATIBLE &&
      /fingerprint/i.test(error.message)
  );

  const state = await env.stateStore.read();
  assert.equal(state.packs["local-fixture"].active.packVersion, "v1");
  const reader = createActiveOpfsPackReader({
    stateStore: env.stateStore,
    store: env.store,
    cryptoProvider: webcrypto
  });
  const hit = await reader.lookup("run");
  assert.deepEqual(hit.record.senses[0].translations, ["运行"]);
});

test("tampered local files and manifest fingerprint fail before OPFS activation", async () => {
  const env = createEnvironment();
  const tampered = await makePack({
    packId: "local-tampered",
    packVersion: "v1",
    translation: "运行"
  });
  tampered["entries.dat"] = new Uint8Array(tampered["entries.dat"]);
  tampered["entries.dat"][0] ^= 1;

  await assert.rejects(
    env.manager.importLocalTflex({
      files: tampered,
      requestId: "tampered-file"
    }),
    (error) => error?.code === PACK_ERROR_CODES.HASH
  );
  assert.deepEqual((await env.stateStore.read()).packs, {});
  assert.deepEqual(await env.store.listPacks(), []);

  const fingerprintDrift = await makePack({
    packId: "local-fingerprint",
    packVersion: "v1",
    translation: "运行"
  });
  const manifest = JSON.parse(new TextDecoder().decode(fingerprintDrift["manifest.json"]));
  manifest.fingerprint = "sha256:" + "f".repeat(64);
  fingerprintDrift["manifest.json"] = encoder.encode(stableStringify(manifest) + "\n");

  await assert.rejects(
    env.manager.importLocalTflex({
      files: fingerprintDrift,
      requestId: "bad-fingerprint"
    }),
    (error) => error?.code === PACK_ERROR_CODES.HASH &&
      /fingerprint/i.test(error.message)
  );
  assert.equal((await env.stateStore.read()).packs["local-fingerprint"], undefined);
});

test("unsafe local TFLex identity and renderable content fail closed", async () => {
  const env = createEnvironment();
  const officialLooking = await makePack({
    packId: "official-looking",
    packVersion: "v1",
    translation: "运行"
  });
  await assert.rejects(
    env.manager.importLocalTflex({
      files: officialLooking,
      requestId: "official-looking"
    }),
    (error) => error?.code === PACK_ERROR_CODES.INCOMPATIBLE
  );

  const unsafe = await makePack({
    packId: "local-unsafe",
    packVersion: "v1",
    translation: "<script>alert(1)</script>"
  });
  await assert.rejects(
    env.manager.importLocalTflex({
      files: unsafe,
      requestId: "unsafe"
    }),
    (error) => error?.code === PACK_ERROR_CODES.CORRUPT &&
      /unsafe renderable/i.test(error.message)
  );
});

test("post-write corruption removes staging and preserves the previous healthy local pack", async () => {
  const env = createEnvironment();
  await env.manager.importLocalTflex({
    files: await makePack({
      packId: "local-fixture",
      packVersion: "v1",
      translation: "运行"
    }),
    requestId: "base"
  });

  env.store.corruptWritesFor = "v2/entries.dat";
  await assert.rejects(
    env.manager.importLocalTflex({
      files: await makePack({
        packId: "local-fixture",
        packVersion: "v2",
        translation: "执行"
      }),
      requestId: "corrupt-v2"
    }),
    (error) => error?.code === PACK_ERROR_CODES.CORRUPT &&
      /post-write health check/i.test(error.message)
  );

  const state = await env.stateStore.read();
  assert.equal(state.packs["local-fixture"].active.packVersion, "v1");
  assert.equal(await env.store.hasVersion("local-fixture", "v2"), false);
});

test("cancellation during staged health check cannot activate the cancelled local version", async () => {
  const env = createEnvironment();
  await env.manager.importLocalTflex({
    files: await makePack({
      packId: "local-fixture",
      packVersion: "v1",
      translation: "运行"
    }),
    requestId: "base"
  });

  let releaseRead;
  let signalRead;
  const blocked = new Promise((resolve) => { signalRead = resolve; });
  const originalReadFile = env.store.readFile;
  let blockedOnce = false;
  env.store.readFile = async (...args) => {
    if (!blockedOnce && args[1] === "v2") {
      blockedOnce = true;
      signalRead();
      await new Promise((resolve) => { releaseRead = resolve; });
    }
    return originalReadFile(...args);
  };

  const importing = env.manager.importLocalTflex({
    files: await makePack({
      packId: "local-fixture",
      packVersion: "v2",
      translation: "执行"
    }),
    requestId: "cancel-v2"
  });
  await blocked;

  assert.deepEqual(env.manager.cancel("cancel-v2"), { cancelled: true });
  releaseRead();
  await assert.rejects(
    importing,
    (error) => error?.code === PACK_ERROR_CODES.CANCELLED
  );

  const state = await env.stateStore.read();
  assert.equal(state.packs["local-fixture"].active.packVersion, "v1");
  assert.equal(await env.store.hasVersion("local-fixture", "v2"), false);
});

test("quota failure stops local import before staging writes", async () => {
  const env = createEnvironment({
    estimate: { quota: 64 * 1024 * 1024, usage: 63 * 1024 * 1024 }
  });
  await assert.rejects(
    env.manager.importLocalTflex({
      files: await makePack({
        packId: "local-quota",
        packVersion: "v1",
        translation: "运行"
      }),
      requestId: "quota"
    }),
    (error) => error?.code === PACK_ERROR_CODES.QUOTA
  );
  assert.deepEqual(await env.store.listPacks(), []);
  assert.deepEqual((await env.stateStore.read()).packs, {});
});

test("re-importing identical healthy local version is idempotent", async () => {
  const env = createEnvironment();
  const files = await makePack({
    packId: "local-idempotent",
    packVersion: "v1",
    translation: "运行"
  });
  await env.manager.importLocalTflex({ files, requestId: "first" });
  const again = await env.manager.importLocalTflex({
    files,
    requestId: "second"
  });
  assert.equal(again.status, "already-imported");
  assert.equal(again.pack.active.packVersion, "v1");
});

test("quarantined TFLex is re-opened, revalidated and atomically activated", async () => {
  const env = createEnvironment();
  const token = quarantineToken(101);
  const files = await makePack({
    packId: "local-quarantine",
    packVersion: "v1",
    translation: "运行"
  });
  env.quarantine.stage(token, files);

  const result =
    await env.manager.importLocalTflexFromQuarantine({
      token,
      requestId: "quarantine-success"
    });

  assert.equal(result.status, "imported");
  assert.equal(
    result.pack.active.packVersion,
    "v1"
  );
  assert.equal(env.quarantine.has(token), false);

  const state = await env.stateStore.read();
  assert.equal(
    state.packs["local-quarantine"].sourceId,
    "local-user-import"
  );

  const reader = createActiveOpfsPackReader({
    stateStore: env.stateStore,
    store: env.store,
    cryptoProvider: webcrypto
  });
  const hit = await reader.lookup("run");
  assert.deepEqual(
    hit.record.senses[0].translations,
    ["运行"]
  );
});

test("tampered quarantine bytes fail before activation and are cleaned up", async () => {
  const env = createEnvironment();
  const token = quarantineToken(102);
  const files = await makePack({
    packId: "local-quarantine-tampered",
    packVersion: "v1",
    translation: "运行"
  });
  files["entries.dat"] =
    new Uint8Array(files["entries.dat"]);
  files["entries.dat"][0] ^= 1;
  env.quarantine.stage(token, files);

  await assert.rejects(
    env.manager.importLocalTflexFromQuarantine({
      token,
      requestId: "quarantine-tampered"
    }),
    (error) =>
      error?.code === PACK_ERROR_CODES.HASH
  );

  assert.equal(env.quarantine.has(token), false);
  assert.deepEqual(
    (await env.stateStore.read()).packs,
    {}
  );
  assert.deepEqual(
    await env.store.listPacks(),
    []
  );
});

test("cancelling a bounded quarantine read reserves requestId until unwind", async () => {
  const env = createEnvironment();
  const token = quarantineToken(103);
  env.quarantine.stage(
    token,
    await makePack({
      packId: "local-quarantine-cancel",
      packVersion: "v1",
      translation: "运行"
    })
  );
  const blocked =
    env.quarantine.blockNextRead("entries.dat");

  const importing =
    env.manager.importLocalTflexFromQuarantine({
      token,
      requestId: "quarantine-cancel"
    });
  await blocked.started;

  assert.deepEqual(
    env.manager.cancel("quarantine-cancel"),
    { cancelled: true }
  );

  await assert.rejects(
    env.manager.importLocalTflex({
      files: await makePack({
        packId: "local-requestid-race",
        packVersion: "v1",
        translation: "竞态"
      }),
      requestId: "quarantine-cancel"
    }),
    (error) =>
      error?.code === PACK_ERROR_CODES.BUSY
  );

  blocked.release();
  await assert.rejects(
    importing,
    (error) =>
      error?.code === PACK_ERROR_CODES.CANCELLED
  );

  assert.equal(env.quarantine.has(token), false);
  assert.deepEqual(
    (await env.stateStore.read()).packs,
    {}
  );
  assert.deepEqual(
    await env.store.listPacks(),
    []
  );

  const after = await env.manager.importLocalTflex({
    files: await makePack({
      packId: "local-requestid-reused",
      packVersion: "v1",
      translation: "可复用"
    }),
    requestId: "quarantine-cancel"
  });
  assert.equal(after.status, "imported");
});

test("one quarantine token cannot be committed by concurrent requests", async () => {
  const env = createEnvironment();
  const token = quarantineToken(104);
  env.quarantine.stage(
    token,
    await makePack({
      packId: "local-quarantine-busy",
      packVersion: "v1",
      translation: "运行"
    })
  );
  const blocked =
    env.quarantine.blockNextRead("entries.dat");

  const first =
    env.manager.importLocalTflexFromQuarantine({
      token,
      requestId: "quarantine-owner"
    });
  await blocked.started;

  await assert.rejects(
    env.manager.importLocalTflexFromQuarantine({
      token,
      requestId: "quarantine-contender"
    }),
    (error) =>
      error?.code === PACK_ERROR_CODES.BUSY &&
      /token/i.test(error.message)
  );

  assert.deepEqual(
    env.manager.cancel("quarantine-owner"),
    { cancelled: true }
  );
  blocked.release();
  await assert.rejects(
    first,
    (error) =>
      error?.code === PACK_ERROR_CODES.CANCELLED
  );
  assert.equal(env.quarantine.has(token), false);
});

function createEnvironment({
  estimate = { quota: 1024 ** 3, usage: 1024 },
  quarantine = createMemoryQuarantine()
} = {}) {
  const store = createMemoryStore();
  const stateStore = createMemoryStateStore();
  return {
    store,
    stateStore,
    quarantine,
    manager: createDictionaryPackManager({
      sources: [],
      store,
      quarantine,
      stateStore,
      permissions: null,
      storageManager: {
        estimate: async () => ({ ...estimate })
      },
      cryptoProvider: webcrypto,
      network: {
        async fetchCatalog() {
          throw new Error("local import must not use network");
        },
        async fetchFile() {
          throw new Error("local import must not use network");
        }
      }
    })
  };
}

async function makePack({
  packId,
  packVersion,
  translation
}) {
  const record = {
    lookupKey: "run",
    exactLookupKeys: ["run"],
    displayForm: "run",
    kind: "lexical",
    aliases: ["running"],
    senses: [{
      id: "local:1",
      translations: [translation],
      domains: [],
      sourceRefs: [{
        sourceId: "fixture-source",
        recordId: "1"
      }]
    }]
  };
  const indexed = buildIndexedData([record]);
  const indexBytes = encoder.encode(indexed.indexText);
  const entriesBytes = encoder.encode(indexed.entriesText);
  const files = [
    {
      role: "lookup-index",
      path: "index.dat",
      size: indexBytes.byteLength,
      sha256: sha256(indexBytes)
    },
    {
      role: "lexical-data",
      path: "entries.dat",
      size: entriesBytes.byteLength,
      sha256: sha256(entriesBytes)
    }
  ].sort(compareDescriptor);
  const sources = [{
    id: "fixture-source",
    version: "fixture-v1",
    provenance: "User-selected fixture dictionary",
    semanticProfile: LOCAL_IMPORT_SEMANTIC_PROFILE,
    license: {
      id: LOCAL_IMPORT_LICENSE_ID,
      name: "User-provided dictionary; redistribution rights are not verified",
      source: "local-user-import"
    }
  }];
  const manifest = {
    format: "tflex",
    formatVersion: 1,
    readerMinVersion: 1,
    compilerVersion: 1,
    normalizationVersion: 1,
    packId,
    packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    profile: "opfs-indexed-v1",
    distributionStatus: "user-import-only",
    semanticProfile: LOCAL_IMPORT_SEMANTIC_PROFILE,
    fingerprint: "",
    recordCount: 1,
    sourceEntryCount: 1,
    license: {
      id: LOCAL_IMPORT_LICENSE_ID,
      name: "User-provided dictionary; redistribution rights are not verified",
      source: "local-user-import"
    },
    sources,
    files
  };
  const payload = makeLocalImportFingerprintPayload(manifest);
  manifest.fingerprint = "sha256:" + sha256(
    encoder.encode(stableStringify(payload))
  );
  const manifestBytes = encoder.encode(stableStringify(manifest) + "\n");
  return {
    "manifest.json": manifestBytes,
    "index.dat": indexBytes,
    "entries.dat": entriesBytes
  };
}

function quarantineToken(index) {
  return makeImportQuarantineToken(
    () =>
      "123e4567-e89b-42d3-a456-" +
      String(index).padStart(12, "0")
  );
}

function createMemoryQuarantine() {
  const tokens = new Map();
  let blocker = null;

  return {
    stage(token, files) {
      tokens.set(
        token,
        new Map(
          Object.entries(files).map(
            ([path, bytes]) => [
              path,
              new Uint8Array(bytes)
            ]
          )
        )
      );
    },
    has(token) {
      return tokens.has(token);
    },
    blockNextRead(path) {
      let signalStarted;
      let releaseRead;
      const started = new Promise((resolve) => {
        signalStarted = resolve;
      });
      const gate = new Promise((resolve) => {
        releaseRead = resolve;
      });
      blocker = {
        path,
        started: signalStarted,
        gate,
        used: false
      };
      return {
        started,
        release: releaseRead
      };
    },
    async listFiles(token) {
      const files = requireQuarantineToken(
        tokens,
        token
      );
      return [...files.entries()]
        .map(([path, bytes]) => ({
          path,
          size: bytes.byteLength
        }))
        .sort((left, right) =>
          compareText(left.path, right.path)
        );
    },
    async readFileRange(
      token,
      path,
      offset,
      length
    ) {
      const files = requireQuarantineToken(
        tokens,
        token
      );
      const bytes = files.get(path);
      if (!bytes) throw notFoundError();
      if (
        blocker &&
        !blocker.used &&
        blocker.path === path
      ) {
        blocker.used = true;
        blocker.started();
        await blocker.gate;
      }
      if (
        offset < 0 ||
        length <= 0 ||
        offset + length > bytes.byteLength
      ) {
        const error = new Error("range");
        error.code = PACK_ERROR_CODES.STORAGE;
        throw error;
      }
      return bytes.slice(
        offset,
        offset + length
      );
    },
    async remove(token) {
      return tokens.delete(token);
    }
  };
}

function requireQuarantineToken(tokens, token) {
  const files = tokens.get(token);
  if (!files) throw notFoundError();
  return files;
}

function notFoundError() {
  const error = new Error("missing");
  error.name = "NotFoundError";
  return error;
}

function createMemoryStore() {
  const files = new Map();
  const key = (packId, version, path) => `${packId}/${version}/${path}`;
  const store = {
    corruptWritesFor: "",
    async writeFile(packId, version, path, bytes) {
      let value = new Uint8Array(bytes);
      if (store.corruptWritesFor === `${version}/${path}`) {
        value = new Uint8Array(value);
        value[0] ^= 1;
      }
      files.set(key(packId, version, path), value);
    },
    async readFile(packId, version, path) {
      const value = files.get(key(packId, version, path));
      if (!value) {
        const error = new Error("missing");
        error.name = "NotFoundError";
        error.missing = true;
        throw error;
      }
      return new Uint8Array(value);
    },
    async readFileRange(packId, version, path, offset, length) {
      const value = await store.readFile(packId, version, path);
      if (offset < 0 || length <= 0 || offset + length > value.byteLength) {
        const error = new Error("range");
        error.code = PACK_ERROR_CODES.STORAGE;
        throw error;
      }
      return value.slice(offset, offset + length);
    },
    async listPacks() {
      return [...new Set([...files.keys()].map((item) => item.split("/")[0]))].sort();
    },
    async listVersions(packId) {
      return [...new Set(
        [...files.keys()]
          .filter((item) => item.startsWith(packId + "/"))
          .map((item) => item.split("/")[1])
      )].sort();
    },
    async removeVersion(packId, version) {
      let removed = false;
      for (const item of [...files.keys()]) {
        if (item.startsWith(`${packId}/${version}/`)) {
          files.delete(item);
          removed = true;
        }
      }
      return removed;
    },
    async removePack(packId) {
      let removed = false;
      for (const item of [...files.keys()]) {
        if (item.startsWith(packId + "/")) {
          files.delete(item);
          removed = true;
        }
      }
      return removed;
    },
    async cleanupPack(packId, keepVersions = []) {
      const keep = new Set(keepVersions.map(String));
      const removed = [];
      for (const version of await store.listVersions(packId)) {
        if (!keep.has(version) && await store.removeVersion(packId, version)) {
          removed.push(version);
        }
      }
      return removed;
    },
    async hasVersion(packId, version) {
      return (await store.listVersions(packId)).includes(version);
    }
  };
  return store;
}

function createMemoryStateStore() {
  let state = { version: 1, catalogSequences: {}, packs: {} };
  const clone = (value) => structuredClone(value);
  return {
    async read() {
      return clone(state);
    },
    async write(next) {
      state = clone(next);
      return clone(state);
    },
    async update(mutator) {
      state = clone(await mutator(clone(state)));
      return clone(state);
    }
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareText)
      .map((key) => [key, sortJson(value[key])])
  );
}

function compareDescriptor(a, b) {
  return compareText(a.path, b.path) || compareText(a.role, b.role);
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

test("actual local import retains an explicit commitpoint during pointer update and cleanup", async () => {
  const env = createEnvironment();
  const files = await makePack({ packId: "local-commitpoint", packVersion: "v1", translation: "合成" });
  const pointer = deferred(), pointerEntered = deferred(), cleanup = deferred(), cleanupEntered = deferred();
  const originalUpdate = env.stateStore.update;
  env.stateStore.update = (mutator) => originalUpdate(async (state) => {
    const next = await mutator(state);
    if (next.packs["local-commitpoint"]?.active) { pointerEntered.resolve(); await pointer.promise; }
    return next;
  });
  const originalCleanup = env.store.cleanupPack;
  env.store.cleanupPack = async (...args) => { cleanupEntered.resolve(); await cleanup.promise; return originalCleanup(...args); };
  const importing = env.manager.importLocalTflex({ files, requestId: "real-commitpoint" });
  await pointerEntered.promise;
  assert.deepEqual(env.manager.cancel("real-commitpoint"), { cancelled: false, phase: "commitpoint" });
  assert.deepEqual((await env.stateStore.read()).packs, {});
  pointer.resolve();
  await cleanupEntered.promise;
  assert.equal((await env.stateStore.read()).packs["local-commitpoint"].active.packVersion, "v1");
  assert.deepEqual(env.manager.cancel("real-commitpoint"), { cancelled: false, phase: "commitpoint" });
  await assert.rejects(env.manager.importLocalTflex({ files, requestId: "real-commitpoint" }), (error) => error.code === PACK_ERROR_CODES.BUSY);
  cleanup.resolve();
  assert.equal((await importing).status, "imported");
  assert.deepEqual(env.manager.cancel("real-commitpoint"), { cancelled: false, phase: "" });
  assert.deepEqual(env.manager.cancel("unknown-request"), { cancelled: false, phase: "" });
});

test("pointer failure keeps staged cleanup protected and preserves the previous active version", async () => {
  const env = createEnvironment();
  await env.manager.importLocalTflex({ files: await makePack({ packId: "local-pointer-fail", packVersion: "v1", translation: "旧" }), requestId: "base" });
  const originalUpdate = env.stateStore.update;
  env.stateStore.update = (mutator) => originalUpdate(async (state) => {
    const next = await mutator(state);
    if (next.packs["local-pointer-fail"]?.active?.packVersion === "v2") throw new Error("synthetic pointer write failure");
    return next;
  });
  const cleanup = deferred(), cleanupEntered = deferred();
  const originalRemove = env.store.removeVersion;
  let stagedExists = false;
  const originalWrite = env.store.writeFile;
  env.store.writeFile = async (...args) => { const result = await originalWrite(...args); if (args[1] === "v2") stagedExists = true; return result; };
  env.store.removeVersion = async (...args) => {
    if (args[1] === "v2" && stagedExists) { cleanupEntered.resolve(); await cleanup.promise; }
    return originalRemove(...args);
  };
  const importing = env.manager.importLocalTflex({ files: await makePack({ packId: "local-pointer-fail", packVersion: "v2", translation: "新" }), requestId: "pointer-failure" });
  const rejected = assert.rejects(importing, /synthetic pointer write failure/u);
  await cleanupEntered.promise;
  assert.deepEqual(env.manager.cancel("pointer-failure"), { cancelled: false, phase: "commitpoint" });
  assert.equal((await env.stateStore.read()).packs["local-pointer-fail"].active.packVersion, "v1");
  assert.equal(await env.store.hasVersion("local-pointer-fail", "v2"), true);
  cleanup.resolve();
  await rejected;
  assert.equal(await env.store.hasVersion("local-pointer-fail", "v2"), false);
  assert.equal((await env.stateStore.read()).packs["local-pointer-fail"].active.packVersion, "v1");
  assert.deepEqual(env.manager.cancel("pointer-failure"), { cancelled: false, phase: "" });
});

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; }

test("commitpoint and request/token ownership survive final quarantine cleanup", async () => {
  const env = createEnvironment();
  const token = quarantineToken(204);
  env.quarantine.stage(token, await makePack({ packId: "local-final-cleanup", packVersion: "v1", translation: "合成" }));
  const cleanup = deferred(), entered = deferred(), originalRemove = env.quarantine.remove;
  env.quarantine.remove = async (value) => { entered.resolve(); await cleanup.promise; return originalRemove(value); };
  const importing = env.manager.importLocalTflexFromQuarantine({ token, requestId: "final-cleanup" });
  await entered.promise;
  assert.equal((await env.stateStore.read()).packs["local-final-cleanup"].active.packVersion, "v1");
  assert.deepEqual(env.manager.cancel("final-cleanup"), { cancelled: false, phase: "commitpoint" });
  await assert.rejects(env.manager.importLocalTflexFromQuarantine({ token, requestId: "contender" }), (error) => error.code === PACK_ERROR_CODES.BUSY);
  cleanup.resolve();
  assert.equal((await importing).status, "imported");
  assert.deepEqual(env.manager.cancel("final-cleanup"), { cancelled: false, phase: "" });
  assert.equal(env.quarantine.has(token), false);
});

test("idempotent success is non-cancellable while final quarantine cleanup is pending", async () => {
  const env = createEnvironment();
  const files = await makePack({ packId: "local-idempotent-cleanup", packVersion: "v1", translation: "合成" });
  await env.manager.importLocalTflex({ files, requestId: "idempotent-base" });
  const before = await env.stateStore.read();
  const token = quarantineToken(205);
  env.quarantine.stage(token, files);
  const cleanup = deferred(), entered = deferred(), originalRemove = env.quarantine.remove;
  env.quarantine.remove = async (value) => { entered.resolve(); await cleanup.promise; return originalRemove(value); };
  const importing = env.manager.importLocalTflexFromQuarantine({ token, requestId: "idempotent-cleanup" });
  await entered.promise;
  try {
    assert.deepEqual(env.manager.cancel("idempotent-cleanup"), { cancelled: false, phase: "commitpoint" });
    await assert.rejects(env.manager.importLocalTflexFromQuarantine({ token, requestId: "idempotent-contender" }), (error) => error.code === PACK_ERROR_CODES.BUSY);
    assert.deepEqual(await env.stateStore.read(), before);
  } finally {
    cleanup.resolve();
    await importing;
  }
  assert.equal((await importing).status, "already-imported");
  assert.deepEqual(env.manager.cancel("idempotent-cleanup"), { cancelled: false, phase: "" });
  assert.equal(env.quarantine.has(token), false);
});

test("cancellation before idempotent success is resolved cannot return already-imported", async () => {
  const env = createEnvironment();
  const files = await makePack({ packId: "local-idempotent-cancel", packVersion: "v1", translation: "合成" });
  await env.manager.importLocalTflex({ files, requestId: "idempotent-base" });
  const before = await env.stateStore.read();
  const token = quarantineToken(206);
  env.quarantine.stage(token, files);
  const health = deferred(), entered = deferred(), originalRead = env.store.readFile;
  let entryReads = 0;
  env.store.readFile = async (...args) => {
    // Recovery checks the active version first; block its second health inspection.
    if (args[2] === "entries.dat" && ++entryReads === 2) { entered.resolve(); await health.promise; }
    return originalRead(...args);
  };
  const importing = env.manager.importLocalTflexFromQuarantine({ token, requestId: "idempotent-cancel" });
  await entered.promise;
  assert.deepEqual(env.manager.cancel("idempotent-cancel"), { cancelled: true });
  health.resolve();
  await assert.rejects(importing, (error) => error.code === PACK_ERROR_CODES.CANCELLED);
  assert.deepEqual(await env.stateStore.read(), before);
  assert.equal(await env.store.hasVersion("local-idempotent-cancel", "v1"), true);
  assert.equal(env.quarantine.has(token), false);
  assert.deepEqual(env.manager.cancel("idempotent-cancel"), { cancelled: false, phase: "" });
});
