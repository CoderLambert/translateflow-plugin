import test from "node:test";
import assert from "node:assert/strict";

import {
  projectEcdictCuratedCsv
} from "../src/background/packs/importers/ecdict-csv.js";
import {
  fetchCuratedDictionarySource
} from "../src/background/providers/curated-dictionary-network.js";
import {
  createCuratedDictionaryWorkerHandler,
  validateCuratedDictionaryResponse
} from "../src/options/workers/curated-dictionary-worker-core.js";
import {
  CURATED_WORKER_MESSAGES
} from "../src/options/workers/curated-dictionary-worker-protocol.js";
import {
  createOpfsImportQuarantine
} from "../src/shared/opfs-import-quarantine.js";
import {
  CURATED_IMPORTER_TYPES,
  CURATED_RECIPE_SCHEMA_VERSION
} from "../src/shared/curated-dictionaries.js";
import { getCuratedDictionary } from "../src/shared/curated-dictionaries.js";

const encoder = new TextEncoder();
const header =
  "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio\n";

function sourceFor(csv, overrides = {}) {
  return {
    schemaVersion: CURATED_RECIPE_SCHEMA_VERSION,
    trustClass: "curated-upstream",
    importerType: CURATED_IMPORTER_TYPES.ECDICT_CSV_V1,
    sourceFormat: "ECDICT CSV",
    downloadBytes: encoder.encode(csv).byteLength,
    selection: {
      maxRecords: 2,
      maxSourceBytes: 1024 * 1024,
      maxHeadwordChars: 120,
      maxTranslationChars: 16_384
    },
    output: {
      packId: "test-ecdict",
      sourceId: "ecdict",
      sourceVersion: "locked-test-revision"
    },
    ...overrides
  };
}

async function* chunksOf(csv, splitAt = 17) {
  const bytes = encoder.encode(csv);
  yield bytes.slice(0, splitAt);
  yield bytes.slice(splitAt);
}

test("ECDICT curated projection is deterministic and source-ranked rather than query-picked", async () => {
  const csv =
    header +
    "zeta,,,泽塔,,0,0,,900,900,,,\n" +
    "alpha,,,阿尔法,,4,0,,0,0,,,\n" +
    "beta,,,贝塔,,0,1,,0,0,,,\n";
  const source = sourceFor(csv);

  const first = await projectEcdictCuratedCsv({
    chunks: chunksOf(csv),
    source
  });
  const second = await projectEcdictCuratedCsv({
    chunks: chunksOf(csv, 31),
    source
  });

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.records.map((record) => record.lookupKey),
    ["beta", "zeta"]
  );
  assert.equal(first.stats.sourceRows, 3);
  assert.equal(first.stats.retainedRecords, 2);
  assert.equal(
    first.records[0].senses[0].sourceRefs[0].sourceVersion,
    "locked-test-revision"
  );
});

test("ECDICT curated projection fails closed on byte identity mismatch", async () => {
  const csv = header + "hello,,,你好,,0,0,,1,1,,,\n";
  const source = sourceFor(csv, {
    downloadBytes: encoder.encode(csv).byteLength + 1
  });

  await assert.rejects(
    projectEcdictCuratedCsv({
      chunks: chunksOf(csv),
      source
    }),
    /source size mismatch/
  );
});

test("curated network provider rejects non-approved origins before fetch", async () => {
  await assert.rejects(
    fetchCuratedDictionarySource({
      downloadUrl: "https://example.com/ecdict.csv"
    }),
    /not an extension-declared recipe/
  );
});


test("curated response accepts encoded transport length while decoded stream remains exact-checked", () => {
  const source = getCuratedDictionary("ecdict-en-zh-curated");
  const response = {
    ok: true,
    status: 200,
    url: source.downloadUrl,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-length"
          ? "22671434"
          : null;
      }
    }
  };

  assert.doesNotThrow(() =>
    validateCuratedDictionaryResponse(response, source)
  );
  assert.throws(
    () => validateCuratedDictionaryResponse(
      {
        ...response,
        url:
          "https://raw.githubusercontent.com/skywind3000/ECDICT/other/ecdict.csv"
      },
      source
    ),
    /locked artifact URL/
  );
});

test("curated ECDICT conversion failure cleans up before staging and never reports ready", async () => {
  const opfsQuarantine = createOpfsImportQuarantine({
    rootProvider: async () => missingQuarantineRoot()
  });
  const removedTokens = [];
  const quarantine = {
    ...opfsQuarantine,
    async remove(value) {
      removedTokens.push(value);
      return opfsQuarantine.remove(value);
    }
  };
  const messages = [];
  const token = makeImportToken(1);
  const handler = createCuratedDictionaryWorkerHandler({
    postMessage(message) {
      messages.push(message);
    },
    quarantine,
    tokenFactory: () => token,
    network: {
      async fetchSource(source) {
        return responseFor(source, [
          "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio\n"
        ]);
      }
    }
  });

  const result = await handler.handleMessage({
    type: CURATED_WORKER_MESSAGES.START,
    requestId: "ecdict-failed-conversion",
    sourceId: "ecdict-en-zh-curated"
  });

  assert.equal(result.type, CURATED_WORKER_MESSAGES.ERROR);
  assert.match(result.error, /source size mismatch/);
  assert.equal(
    messages.some((message) => message.type === CURATED_WORKER_MESSAGES.READY),
    false
  );
  assert.deepEqual(await quarantine.listTokens(), []);
  assert.deepEqual(removedTokens, [token]);
});

test("curated ECDICT cancellation during conversion reports AbortError without staged data or a ready token", async () => {
  const opfsQuarantine = createOpfsImportQuarantine({
    rootProvider: async () => missingQuarantineRoot()
  });
  const removedTokens = [];
  const quarantine = {
    ...opfsQuarantine,
    async remove(value) {
      removedTokens.push(value);
      return opfsQuarantine.remove(value);
    }
  };
  const messages = [];
  const token = makeImportToken(2);
  let reachedBlockedRead;
  const blockedRead = new Promise((resolve) => {
    reachedBlockedRead = resolve;
  });
  const handler = createCuratedDictionaryWorkerHandler({
    postMessage(message) {
      messages.push(message);
    },
    quarantine,
    tokenFactory: () => token,
    network: {
      async fetchSource(source, { signal }) {
        return responseFor(source, [
          "word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio\n"
        ], {
          async readNext() {
            reachedBlockedRead();
            await new Promise((resolve, reject) => {
              const onAbort = () => reject(
                new DOMException("Download cancelled.", "AbortError")
              );
              if (signal.aborted) {
                onAbort();
                return;
              }
              signal.addEventListener("abort", onAbort, { once: true });
            });
            return { done: true };
          }
        });
      }
    }
  });

  const conversion = handler.handleMessage({
    type: CURATED_WORKER_MESSAGES.START,
    requestId: "ecdict-cancelled-conversion",
    sourceId: "ecdict-en-zh-curated"
  });
  await blockedRead;
  assert.deepEqual(
    await quarantine.listTokens(),
    []
  );
  assert.deepEqual(
    handler.cancel("ecdict-cancelled-conversion"),
    { cancelled: true }
  );

  const result = await conversion;
  assert.equal(result.type, CURATED_WORKER_MESSAGES.ERROR);
  assert.equal(result.errorName, "AbortError");
  assert.equal(
    messages.some((message) => message.type === CURATED_WORKER_MESSAGES.READY),
    false
  );
  assert.deepEqual(await quarantine.listTokens(), []);
  assert.deepEqual(removedTokens, [token]);
});

function responseFor(source, chunks, { readNext } = {}) {
  let index = 0;
  return {
    ok: true,
    status: 200,
    url: source.downloadUrl,
    body: {
      getReader() {
        return {
          async read() {
            if (index < chunks.length) {
              return {
                done: false,
                value: encoder.encode(chunks[index++])
              };
            }
            if (readNext) return readNext();
            return { done: true };
          },
          releaseLock() {}
        };
      }
    }
  };
}

function makeImportToken(index) {
  return `import-123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`;
}

class MemoryDirectory {
  constructor() {
    this.kind = "directory";
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

  async removeEntry(name) {
    if (!this.directories.delete(name) && !this.files.delete(name)) {
      throw notFound();
    }
  }

  async *entries() {
    for (const [name, handle] of this.directories) {
      yield [name, handle];
    }
    for (const [name, handle] of this.files) {
      yield [name, handle];
    }
  }
}

function missingQuarantineRoot() {
  return {
    async getDirectoryHandle() {
      throw notFound();
    }
  };
}

function notFound() {
  return Object.assign(new Error("Not found"), {
    name: "NotFoundError"
  });
}
