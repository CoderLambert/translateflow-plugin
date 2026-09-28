#!/usr/bin/env node
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDictionaryPackManager } from "../src/background/packs/manager.js";
import { createOpfsTflexReader } from "../src/background/lexical/opfs-tflex-reader.js";
import {
  PACK_CATALOG_SCHEMA,
  PACK_CATALOG_SCHEMA_VERSION
} from "../src/shared/pack-manager.js";

export async function certifyFreeDictLifecycle({ packDir }) {
  const root = resolveRequired(packDir, "packDir");
  const encoder = new TextEncoder();
  const manifestBytes = new Uint8Array(await readFile(resolve(root, "manifest.json")));
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const allFiles = [
    {
      role: "manifest",
      path: "manifest.json",
      bytes: manifestBytes
    },
    ...await Promise.all(manifest.files.map(async (file) => ({
      role: file.role,
      path: file.path,
      bytes: new Uint8Array(await readFile(resolve(root, file.path)))
    })))
  ];

  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicKeyJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  const source = {
    id: "freedict-certification-source",
    label: "FreeDict Certification Source",
    keyId: "freedict-certification-key-v1",
    publicKeyJwk,
    minimumSequence: 1,
    catalogUrl: "https://packs.example.test/catalog.json",
    signatureUrl: "https://packs.example.test/catalog.sig",
    downloadBaseUrl: "https://packs.example.test/releases/",
    originPattern: "https://packs.example.test/*",
    packs: [{ packId: manifest.packId, label: "FreeDict eng-zho" }]
  };

  const descriptors = allFiles.map((file) => ({
    role: file.role,
    path: file.path,
    downloadPath: manifest.packVersion + "/" + file.path,
    size: file.bytes.byteLength,
    sha256: awaitSha256(file.bytes)
  }));
  const catalog = {
    schema: PACK_CATALOG_SCHEMA,
    schemaVersion: PACK_CATALOG_SCHEMA_VERSION,
    sourceId: source.id,
    sequence: 1,
    packs: [{
      packId: manifest.packId,
      packVersion: manifest.packVersion,
      releaseSequence: 1,
      format: "tflex",
      formatVersion: manifest.formatVersion,
      readerMinVersion: manifest.readerMinVersion,
      normalizationVersion: manifest.normalizationVersion,
      profile: manifest.profile,
      sourceLanguage: manifest.sourceLanguage,
      targetLanguage: manifest.targetLanguage,
      fingerprint: manifest.fingerprint,
      totalBytes: descriptors.reduce((sum, item) => sum + item.size, 0),
      files: descriptors
    }]
  };
  const catalogBytes = encoder.encode(JSON.stringify(catalog));
  const rawSignature = new Uint8Array(await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    catalogBytes
  ));
  const signatureBytes = encoder.encode(Buffer.from(rawSignature).toString("base64"));
  const fileMap = new Map(allFiles.map((file) => [
    manifest.packVersion + "/" + file.path,
    file.bytes
  ]));

  const store = createMemoryStore();
  const stateStore = createMemoryStateStore();
  const manager = createDictionaryPackManager({
    sources: [source],
    store,
    stateStore,
    permissions: {
      contains: async ({ origins }) =>
        Array.isArray(origins) &&
        origins.length === 1 &&
        origins[0] === source.originPattern
    },
    storageManager: {
      estimate: async () => ({ quota: 1024 ** 3, usage: 1024 ** 2 })
    },
    cryptoProvider: webcrypto,
    network: {
      async fetchCatalog() {
        return { catalogBytes, signatureBytes };
      },
      async fetchFile(_source, descriptor) {
        const bytes = fileMap.get(descriptor.downloadPath);
        if (!bytes) throw new Error("missing lifecycle fixture file: " + descriptor.downloadPath);
        return new Uint8Array(bytes);
      }
    }
  });

  const installed = await manager.install({
    sourceId: source.id,
    packId: manifest.packId,
    requestId: "freedict-real-pack-install"
  });
  if (installed.status !== "installed") {
    throw new Error("FreeDict real-pack install did not produce installed state");
  }

  const rawState = await stateStore.read();
  const active = rawState.packs?.[manifest.packId]?.active;
  if (!active || rawState.packs[manifest.packId].status !== "healthy") {
    throw new Error("FreeDict real-pack active pointer is not healthy");
  }
  const reader = createOpfsTflexReader({
    store,
    snapshot: active,
    cryptoProvider: webcrypto
  });
  const cacheHits = await reader.lookupAll("cache");
  if (!cacheHits.length || !cacheHits.some((hit) =>
    (hit.record.senses || []).some((sense) =>
      Array.isArray(sense.translations) && sense.translations.some((value) => value.includes("缓存"))
    )
  )) {
    throw new Error("FreeDict real-pack lifecycle lookup did not preserve the expected cache translation");
  }

  const beforeUninstallVersions = await store.listVersions(manifest.packId);
  const removed = await manager.uninstall(manifest.packId);
  if (!removed.uninstalled) throw new Error("FreeDict real-pack uninstall did not complete");
  const afterState = await stateStore.read();
  const afterUninstallVersions = await store.listVersions(manifest.packId);
  if (afterState.packs?.[manifest.packId] || afterUninstallVersions.length) {
    throw new Error("FreeDict real-pack uninstall left active metadata or files behind");
  }

  return {
    installStatus: installed.status,
    activePackVersion: active.packVersion,
    signedFileCount: descriptors.length,
    activeVersionsBeforeUninstall: beforeUninstallVersions,
    lookup: {
      query: "cache",
      candidates: cacheHits.map((hit) => ({
        headword: hit.record.displayForm,
        translations: (hit.record.senses || []).flatMap((sense) => sense.translations || [])
      }))
    },
    uninstall: {
      uninstalled: removed.uninstalled,
      remainingVersions: afterUninstallVersions
    }
  };
}

function createMemoryStore() {
  const files = new Map();
  const key = (packId, version, path) => packId + "/" + version + "/" + path;
  return {
    async writeFile(packId, version, path, bytes) {
      files.set(key(packId, version, path), new Uint8Array(bytes));
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
    async readFileSlice(packId, version, path, offset, length) {
      const value = files.get(key(packId, version, path));
      if (!value) {
        const error = new Error("missing");
        error.name = "NotFoundError";
        error.missing = true;
        throw error;
      }
      return new Uint8Array(value.slice(offset, offset + length));
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
        if (item.startsWith(packId + "/" + version + "/")) {
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
      const versions = await this.listVersions(packId);
      const removed = [];
      for (const version of versions) {
        if (!keep.has(version) && await this.removeVersion(packId, version)) removed.push(version);
      }
      return removed;
    }
  };
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

async function awaitSha256(bytes) {
  const digest = await webcrypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function resolveRequired(value, label) {
  if (!value) throw new Error(label + " is required");
  return resolve(value);
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--pack");
  if (index < 0 || !args[index + 1]) throw new Error("--pack is required");
  const result = await certifyFreeDictLifecycle({ packDir: args[index + 1] });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
