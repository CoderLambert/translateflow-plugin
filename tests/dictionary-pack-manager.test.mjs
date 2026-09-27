import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  PACK_ERROR_CODES
} from "../src/shared/pack-manager.js";
import {
  resolvePackDownloadUrl,
  verifyTrustedCatalog
} from "../src/background/packs/catalog.js";
import { createDictionaryPackManager } from "../src/background/packs/manager.js";

const encoder = new TextEncoder();

test("secure pack manager installs, updates, reopens and rolls back verified versions", async () => {
  const env = await createEnvironment();
  await env.setRelease({ packVersion: "1.0.0", catalogSequence: 1, releaseSequence: 1 });

  const installed = await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "install-v1"
  });
  assert.equal(installed.status, "installed");
  assert.equal(installed.pack.active.packVersion, "1.0.0");
  assert.equal(installed.pack.fallback, null);

  await env.setRelease({ packVersion: "2.0.0", catalogSequence: 2, releaseSequence: 2 });
  const updated = await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "install-v2"
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.pack.active.packVersion, "2.0.0");
  assert.equal(updated.pack.fallback.packVersion, "1.0.0");

  const restarted = createDictionaryPackManager(env.dependencies());
  const reopened = await restarted.status({ recover: true });
  assert.equal(reopened.state.packs[env.packId].status, "healthy");
  assert.equal(reopened.state.packs[env.packId].active.packVersion, "2.0.0");

  const rollback = await restarted.rollback(env.packId);
  assert.equal(rollback.rolledBack, true);
  assert.equal(rollback.pack.active.packVersion, "1.0.0");
  assert.equal(rollback.pack.fallback.packVersion, "2.0.0");
});

test("catalog authenticity and pack byte integrity fail closed without replacing healthy state", async () => {
  const env = await createEnvironment();
  await env.setRelease({ packVersion: "1.0.0", catalogSequence: 1, releaseSequence: 1 });
  await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "base"
  });

  const tamperedCatalog = new Uint8Array(env.release.catalogBytes);
  tamperedCatalog[tamperedCatalog.length - 2] ^= 1;
  await assert.rejects(
    verifyTrustedCatalog({
      catalogBytes: tamperedCatalog,
      signatureBytes: env.release.signatureBytes,
      source: env.source,
      cryptoProvider: webcrypto
    }),
    (error) => error?.code === PACK_ERROR_CODES.CATALOG_SIGNATURE
  );

  await env.setRelease({ packVersion: "2.0.0", catalogSequence: 2, releaseSequence: 2 });
  env.corruptDownloadPath = "2.0.0/entries.dat";
  await assert.rejects(
    env.manager.install({
      sourceId: env.source.id,
      packId: env.packId,
      requestId: "tampered-pack"
    }),
    (error) => error?.code === PACK_ERROR_CODES.HASH
  );
  env.corruptDownloadPath = "";

  const status = await env.manager.status();
  assert.equal(status.state.packs[env.packId].active.packVersion, "1.0.0");
  assert.equal(await env.store.hasVersion(env.packId, "2.0.0"), false);
});

test("post-write health check catches storage corruption before active pointer switch", async () => {
  const env = await createEnvironment();
  await env.setRelease({ packVersion: "1.0.0", catalogSequence: 1, releaseSequence: 1 });
  await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "healthy"
  });

  await env.setRelease({ packVersion: "2.0.0", catalogSequence: 2, releaseSequence: 2 });
  env.store.corruptWritesFor = "2.0.0/entries.dat";

  await assert.rejects(
    env.manager.install({
      sourceId: env.source.id,
      packId: env.packId,
      requestId: "corrupt-write"
    }),
    (error) => error?.code === PACK_ERROR_CODES.CORRUPT &&
      /post-write health check/i.test(error.message)
  );

  const status = await env.manager.status();
  assert.equal(status.state.packs[env.packId].active.packVersion, "1.0.0");
});

test("single-flight cancellation rejects concurrent install and preserves the last healthy pack", async () => {
  const env = await createEnvironment();
  await env.setRelease({ packVersion: "1.0.0", catalogSequence: 1, releaseSequence: 1 });
  await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "base"
  });

  await env.setRelease({ packVersion: "2.0.0", catalogSequence: 2, releaseSequence: 2 });
  env.blockDownloads = true;
  const first = env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "blocked-install"
  });
  await env.waitForBlockedDownload();

  await assert.rejects(
    env.manager.install({
      sourceId: env.source.id,
      packId: env.packId,
      requestId: "concurrent-install"
    }),
    (error) => error?.code === PACK_ERROR_CODES.BUSY
  );

  assert.deepEqual(env.manager.cancel("blocked-install"), { cancelled: true });
  await assert.rejects(first, (error) => error?.code === PACK_ERROR_CODES.CANCELLED);
  env.blockDownloads = false;

  const status = await env.manager.status();
  assert.equal(status.state.packs[env.packId].active.packVersion, "1.0.0");
  assert.equal(await env.store.hasVersion(env.packId, "2.0.0"), false);
});

test("recovery removes orphan staging, rolls back missing active data and reaches needs-reinstall deterministically", async () => {
  const env = await createEnvironment();
  await env.setRelease({ packVersion: "1.0.0", catalogSequence: 1, releaseSequence: 1 });
  await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "v1"
  });
  await env.setRelease({ packVersion: "2.0.0", catalogSequence: 2, releaseSequence: 2 });
  await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "v2"
  });

  await env.store.writeFile(env.packId, "orphan", "junk.dat", encoder.encode("orphan"));
  await env.store.writeFile("unknown-pack", "1", "junk.dat", encoder.encode("unknown"));
  await env.store.removeVersion(env.packId, "2.0.0");

  const recovered = await env.manager.status({ recover: true });
  assert.equal(recovered.state.packs[env.packId].active.packVersion, "1.0.0");
  assert.equal(recovered.state.packs[env.packId].fallback, null);
  assert.equal(await env.store.hasVersion(env.packId, "orphan"), false);
  assert.equal(await env.store.hasVersion("unknown-pack", "1"), false);

  await env.store.removeVersion(env.packId, "1.0.0");
  const missing = await env.manager.status({ recover: true });
  assert.equal(missing.state.packs[env.packId].status, "needs-reinstall");
  assert.equal(missing.state.packs[env.packId].active, null);

  const removed = await env.manager.uninstall(env.packId);
  assert.equal(removed.uninstalled, true);
  assert.equal(removed.state.packs[env.packId], undefined);
});

test("replay and automatic downgrade are rejected", async () => {
  const env = await createEnvironment();
  await env.setRelease({ packVersion: "2.0.0", catalogSequence: 2, releaseSequence: 2 });
  await env.manager.install({
    sourceId: env.source.id,
    packId: env.packId,
    requestId: "v2"
  });

  await env.setRelease({ packVersion: "2.0.0", catalogSequence: 1, releaseSequence: 2 });
  await assert.rejects(
    env.manager.install({
      sourceId: env.source.id,
      packId: env.packId,
      requestId: "replay"
    }),
    (error) => error?.code === PACK_ERROR_CODES.CATALOG_REPLAY
  );

  await env.setRelease({ packVersion: "1.0.0", catalogSequence: 3, releaseSequence: 1 });
  await assert.rejects(
    env.manager.install({
      sourceId: env.source.id,
      packId: env.packId,
      requestId: "downgrade"
    }),
    (error) => error?.code === PACK_ERROR_CODES.DOWNGRADE
  );
});

test("permission denial stops before network access and manifest keeps unlimitedStorage out", async () => {
  const env = await createEnvironment({ permissionGranted: false });
  await env.setRelease({ packVersion: "1.0.0", catalogSequence: 1, releaseSequence: 1 });

  await assert.rejects(
    env.manager.install({
      sourceId: env.source.id,
      packId: env.packId,
      requestId: "permission-denied"
    }),
    (error) => error?.code === PACK_ERROR_CODES.PERMISSION_REQUIRED
  );
  assert.equal(env.catalogFetches, 0);

  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.permissions.includes("unlimitedStorage"), false);
  assert.equal(manifest.host_permissions.includes("https://*/*"), false);
});

test("download resolution rejects traversal and non-normalized encoded paths", async () => {
  const env = await createEnvironment();
  const source = env.source;

  assert.equal(
    resolvePackDownloadUrl(source, { downloadPath: "1.0.0/entries.dat" }),
    "https://packs.example.test/releases/1.0.0/entries.dat"
  );
  assert.throws(
    () => resolvePackDownloadUrl(source, { downloadPath: "../escape.dat" }),
    (error) => error?.code === PACK_ERROR_CODES.CATALOG_SCHEMA
  );
  assert.throws(
    () => resolvePackDownloadUrl(source, { downloadPath: "%2e%2e/escape.dat" }),
    (error) => error?.code === PACK_ERROR_CODES.CATALOG_SCHEMA
  );
});

async function createEnvironment({ permissionGranted = true } = {}) {
  const packId = "fixture-optional";
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeyJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  const source = {
    id: "fixture-source",
    label: "Fixture Source",
    keyId: "fixture-key-v1",
    publicKeyJwk,
    minimumSequence: 1,
    catalogUrl: "https://packs.example.test/catalog.json",
    signatureUrl: "https://packs.example.test/catalog.sig",
    downloadBaseUrl: "https://packs.example.test/releases/",
    originPattern: "https://packs.example.test/*",
    packs: [{ packId, label: "Fixture Optional Pack" }]
  };

  const store = createMemoryStore();
  const stateStore = createMemoryStateStore();
  let release = null;
  let catalogFetches = 0;
  let blockedResolve = null;
  let blockedPromise = null;

  const env = {
    packId,
    source,
    store,
    stateStore,
    release,
    catalogFetches,
    corruptDownloadPath: "",
    blockDownloads: false,
    async setRelease({ packVersion, catalogSequence, releaseSequence }) {
      release = await buildSignedRelease({
        packId,
        packVersion,
        catalogSequence,
        releaseSequence,
        source,
        privateKey: keyPair.privateKey
      });
      env.release = release;
    },
    waitForBlockedDownload() {
      if (!blockedPromise) blockedPromise = new Promise((resolve) => { blockedResolve = resolve; });
      return blockedPromise;
    }
  };

  const network = {
    async fetchCatalog() {
      catalogFetches += 1;
      env.catalogFetches = catalogFetches;
      return {
        catalogBytes: release.catalogBytes,
        signatureBytes: release.signatureBytes
      };
    },
    async fetchFile(_source, descriptor, { signal } = {}) {
      if (env.blockDownloads) {
        if (!blockedPromise) blockedPromise = new Promise((resolve) => { blockedResolve = resolve; });
        blockedResolve?.();
        return new Promise((resolve, reject) => {
          signal?.addEventListener("abort", () => {
            const error = new DOMException("cancelled", "AbortError");
            reject(error);
          }, { once: true });
        });
      }
      const original = release.files.get(descriptor.downloadPath);
      assert.ok(original, `missing fixture bytes for ${descriptor.downloadPath}`);
      if (env.corruptDownloadPath === descriptor.downloadPath) {
        const corrupt = new Uint8Array(original);
        corrupt[0] ^= 1;
        return corrupt;
      }
      return new Uint8Array(original);
    }
  };

  const dependencies = () => ({
    sources: [source],
    store,
    stateStore,
    permissions: {
      contains: async ({ origins }) => permissionGranted && origins[0] === source.originPattern
    },
    storageManager: {
      estimate: async () => ({ quota: 1024 ** 3, usage: 1024 })
    },
    cryptoProvider: webcrypto,
    network
  });
  env.dependencies = dependencies;
  env.manager = createDictionaryPackManager(dependencies());
  return env;
}

async function buildSignedRelease({
  packId,
  packVersion,
  catalogSequence,
  releaseSequence,
  source,
  privateKey
}) {
  const indexBytes = encoder.encode(`index:${packVersion}`);
  const entriesBytes = encoder.encode(`entries:${packVersion}`);
  const fingerprint = `sha256:${await sha256Hex(encoder.encode(`fingerprint:${packVersion}`))}`;
  const manifest = {
    format: "tflex",
    formatVersion: 1,
    readerMinVersion: 1,
    normalizationVersion: 1,
    profile: "opfs-indexed-v1",
    packId,
    packVersion,
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    fingerprint,
    sources: [{
      id: "fixture-source-data",
      version: packVersion,
      provenance: "project-owned deterministic fixture",
      license: { id: "CC0-1.0" }
    }],
    files: [
      {
        role: "lookup-index",
        path: "index.dat",
        size: indexBytes.byteLength,
        sha256: await sha256Hex(indexBytes)
      },
      {
        role: "lexical-data",
        path: "entries.dat",
        size: entriesBytes.byteLength,
        sha256: await sha256Hex(entriesBytes)
      }
    ]
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const files = new Map([
    [`${packVersion}/manifest.json`, manifestBytes],
    [`${packVersion}/index.dat`, indexBytes],
    [`${packVersion}/entries.dat`, entriesBytes]
  ]);
  const descriptors = [
    descriptor("manifest", "manifest.json", `${packVersion}/manifest.json`, manifestBytes),
    descriptor("lookup-index", "index.dat", `${packVersion}/index.dat`, indexBytes),
    descriptor("lexical-data", "entries.dat", `${packVersion}/entries.dat`, entriesBytes)
  ];
  for (const item of descriptors) item.sha256 = await sha256Hex(files.get(item.downloadPath));

  const catalog = {
    schema: "translateflow-pack-catalog",
    schemaVersion: 1,
    sourceId: source.id,
    sequence: catalogSequence,
    packs: [{
      packId,
      packVersion,
      releaseSequence,
      format: "tflex",
      formatVersion: 1,
      readerMinVersion: 1,
      normalizationVersion: 1,
      profile: "opfs-indexed-v1",
      sourceLanguage: "en",
      targetLanguage: "zh-CN",
      fingerprint,
      totalBytes: descriptors.reduce((sum, item) => sum + item.size, 0),
      files: descriptors
    }]
  };
  const catalogBytes = encoder.encode(JSON.stringify(catalog));
  const signature = new Uint8Array(await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    catalogBytes
  ));
  return {
    catalogBytes,
    signatureBytes: encoder.encode(Buffer.from(signature).toString("base64")),
    files
  };
}

function descriptor(role, path, downloadPath, bytes) {
  return {
    role,
    path,
    downloadPath,
    size: bytes.byteLength,
    sha256: ""
  };
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
    async listPacks() {
      return [...new Set([...files.keys()].map((item) => item.split("/")[0]))].sort();
    },
    async listVersions(packId) {
      return [...new Set(
        [...files.keys()]
          .filter((item) => item.startsWith(`${packId}/`))
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
        if (item.startsWith(`${packId}/`)) {
          files.delete(item);
          removed = true;
        }
      }
      return removed;
    },
    async cleanupPack(packId, keepVersions = []) {
      const keep = new Set(keepVersions.map(String));
      const versions = await store.listVersions(packId);
      const removed = [];
      for (const version of versions) {
        if (!keep.has(version) && await store.removeVersion(packId, version)) removed.push(version);
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

async function sha256Hex(bytes) {
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}
