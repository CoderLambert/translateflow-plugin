import { createHash, webcrypto } from "node:crypto";
import { buildLocalIndexedTflex } from "../../src/background/packs/importers/tflex-local-builder.js";
import { buildIndexedData } from "../../scripts/build-tflex-freedict.mjs";
import { PACK_MANAGER_STATE_KEY } from "../../src/shared/pack-manager.js";

export const USER_LEXICAL_PACK_ID = "local-e2e-user-lexical";
export const USER_TECHNICAL_PACK_ID = "local-e2e-user-concepts";
const sourceRefs = (id) => [{ sourceId: "e2e-synthetic-user-source", recordId: id }];
const lexical = (word, translations, extra = {}) => ({
  lookupKey: word, exactLookupKeys: [word], displayForm: word, kind: "lexical", aliases: [],
  senses: translations.map((values, i) => ({ id: `synthetic:${word}:${i}`, partOfSpeech: "adjective",
    translations: values, sourceRefs: sourceRefs(`${word}:${i}`), domains: [] })), ...extra
});
const concept = (word, kind, aliases, typeLabels) => ({
  lookupKey: word, exactLookupKeys: [word], displayForm: word, kind, aliases,
  translations: [], typeLabels, domains: ["computing"], sourceRefs: sourceRefs(word)
});

// Project-owned synthetic records live only in test code. They exercise retrieval,
// ranking and UI states; they do not claim corpus coverage or ship in the artifact.
export async function makeUserDictionaryPacks({ packVersion = "fixture-v1" } = {}) {
  const specs = [
    [USER_LEXICAL_PACK_ID, [
      lexical("child", [["儿童"]], { senses: [{ id: "synthetic:child", partOfSpeech: "noun", translations: ["儿童"], sourceRefs: sourceRefs("child") }] }),
      lexical("go", [["去"]]),
      lexical("persistent", [["持久的", "持续存在的"], ["顽强的"]], { aliases: ["stateful", "Persistent"], exactLookupKeys: ["Persistent", "persistent"] }),
      lexical("run", [["运行"]]), lexical("session", [["会话"]]),
      lexical("terminal multiplexer", [["终端复用器"]])
    ]],
    [USER_TECHNICAL_PACK_ID, [
      concept("runtime system", "technical-concept", [], ["runtime system"]),
      concept("session", "technical-concept", ["stateful"], ["session"]),
      concept("tmux", "technical-entity", [], ["terminal multiplexer"])
    ]]
  ];
  return Promise.all(specs.map(async ([packId, records]) => {
    const sources = [{ id: "e2e-synthetic-user-source", version: "fixture-v1", provenance: "Project-owned synthetic user dictionary test fixture",
      license: { id: "MIT", name: "Synthetic project test fixture", source: "e2e/support/user-dictionaries.mjs" } }];
    if (packId === USER_LEXICAL_PACK_ID) return buildLocalIndexedTflex({
      packId, packVersion, records, sourceEntryCount: records.length, sources: sources.map(({ license: _license, ...source }) => source), cryptoProvider: webcrypto
    });
    // Generic installed packs can contain structured concepts. Local bilingual
    // import intentionally accepts lexical records only, so seed this reader
    // fixture through isolated OPFS rather than weakening that import boundary.
    const indexed = buildIndexedData(records);
    const files = { "entries.dat": Buffer.from(indexed.entriesText), "index.dat": Buffer.from(indexed.indexText) };
    const descriptors = Object.entries(files).map(([path, bytes]) => ({ path, role: path === "index.dat" ? "lookup-index" : "lexical-data",
      size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }));
    const manifest = { format: "tflex", formatVersion: 1, readerMinVersion: 1, compilerVersion: 1, normalizationVersion: 1,
      packId, packVersion, profile: "opfs-indexed-v1", sourceLanguage: "en", targetLanguage: "zh-CN",
      recordCount: records.length, sources, files: descriptors,
      fingerprint: "sha256:" + createHash("sha256").update(JSON.stringify({ packId, packVersion, descriptors, sources })).digest("hex") };
    files["manifest.json"] = Buffer.from(JSON.stringify(manifest) + "\n");
    return { manifest, files, records };
  }));
}

// Write only the isolated browser profile's OPFS and native pack state. Production
// queries, byte-range reads, hashes and error handling are never mocked. Importer
// UI/transaction tests independently cover the real installation path.
export async function installUserDictionaries(driver, { fault = "", concepts = true } = {}) {
  let packs = await makeUserDictionaryPacks({ packVersion: `fixture-${crypto.randomUUID()}` });
  if (!concepts || fault) packs = packs.slice(0, 1);
  const installed = packs.map(({ manifest, files }) => {
    const actualFiles = { ...files };
    if (fault === "incompatible") {
      actualFiles["manifest.json"] = new TextEncoder().encode(JSON.stringify({ ...manifest, readerMinVersion: 999 }) + "\n");
    }
    const descriptors = [...manifest.files, { role: "manifest", path: "manifest.json",
      size: actualFiles["manifest.json"].byteLength,
      sha256: createHash("sha256").update(actualFiles["manifest.json"]).digest("hex") }];
    if (fault === "corrupt") {
      const bytes = new Uint8Array(actualFiles["entries.dat"]);
      const index = JSON.parse(new TextDecoder().decode(actualFiles["index.dat"]));
      const target = index.entries.find(entry => entry.key === "persistent").targets[0];
      bytes[target.offset] ^= 1;
      actualFiles["entries.dat"] = bytes;
    }
    if (fault === "missing") delete actualFiles["index.dat"];
    return { manifest, files: Object.fromEntries(Object.entries(actualFiles).map(([path, bytes]) => [path, [...bytes]])),
      snapshot: { packId: manifest.packId, packVersion: manifest.packVersion, fingerprint: manifest.fingerprint,
        sourceId: "local-import", releaseSequence: 1, catalogSequence: 0, verifiedAt: Date.now(),
        totalBytes: descriptors.reduce((sum, file) => sum + file.size, 0), files: descriptors } };
  });
  await driver.evaluate(async ({ installed, stateKey }) => {
    const root = await navigator.storage.getDirectory();
    const dictionaries = await root.getDirectoryHandle("dictionaries", { create: true });
    const state = { version: 1, catalogSequences: {}, packs: {} };
    for (const { manifest, files, snapshot } of installed) {
      const pack = await dictionaries.getDirectoryHandle(manifest.packId, { create: true });
      const version = await pack.getDirectoryHandle(manifest.packVersion, { create: true });
      for (const [path, bytes] of Object.entries(files)) {
        const handle = await version.getFileHandle(path, { create: true });
        const writable = await handle.createWritable();
        await writable.write(new Uint8Array(bytes)); await writable.close();
      }
      state.packs[manifest.packId] = { sourceId: "local-import", status: "healthy", active: snapshot, fallback: null, lastError: null };
    }
    await chrome.storage.local.set({ [stateKey]: state, dictionaryEnabled: true });
  }, { installed, stateKey: PACK_MANAGER_STATE_KEY });
  return packs.map(pack => pack.manifest);
}

export async function removeUserDictionaryBytes(driver) {
  await driver.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry("dictionaries", { recursive: true });
  });
}
