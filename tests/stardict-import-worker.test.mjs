import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  STARDICT_WORKER_MESSAGES,
  createStarDictImportWorkerHandler
} from "../src/options/workers/stardict-import-worker-core.js";
import {
  validateLocalTflexImport
} from "../src/background/packs/local-import.js";
import {
  makeImportQuarantineLockName
} from "../src/shared/import-quarantine-lock.js";

const encoder = new TextEncoder();

test("StarDict worker stages exact local TFLex files into quarantine and returns only metadata/token", async () => {
  const quarantine = new MemoryQuarantine();
  const messages = [];
  const token =
    "import-123e4567-e89b-42d3-a456-426614174000";
  const handler = createStarDictImportWorkerHandler({
    quarantine,
    lockManager: new FakeLockManager(),
    cryptoProvider: webcrypto,
    tokenFactory: () => token,
    postMessage: (message) => messages.push(message)
  });
  const fixture = makeStarDict([
    ["hello", "你好"],
    ["run", "运行"]
  ]);

  const result = await handler.handleMessage({
    type: STARDICT_WORKER_MESSAGES.START,
    requestId: "worker-fixture",
    input: {
      format: "plain",
      ifoBytes: encoder.encode(fixture.ifoText),
      idxBytes: fixture.idxBytes,
      dictBytes: fixture.dictBytes,
      recipe: recipeFixture()
    }
  });

  assert.equal(result.type, STARDICT_WORKER_MESSAGES.READY);
  assert.equal(result.token, token);
  assert.equal(result.packId, "local-worker-fixture");
  assert.equal(result.packVersion, "fixture-v1");
  assert.equal(result.sourceEntryCount, 2);
  assert.deepEqual(
    quarantine.listPaths(token),
    ["entries.dat", "index.dat", "manifest.json"]
  );

  const validated = await validateLocalTflexImport({
    files: quarantine.snapshot(token),
    cryptoProvider: webcrypto
  });
  assert.equal(
    validated.manifest.fingerprint,
    result.fingerprint
  );
  assert.deepEqual(
    messages
      .filter((message) =>
        message.type === STARDICT_WORKER_MESSAGES.PROGRESS
      )
      .map((message) => message.phase),
    ["convert", "stage", "stage", "stage"]
  );
});

test("StarDict worker cancellation aborts active conversion and removes owned quarantine token", async () => {
  const quarantine = new MemoryQuarantine();
  const messages = [];
  const locks = new FakeLockManager();
  const token =
    "import-223e4567-e89b-42d3-a456-426614174000";
  let signalBuild;
  const buildStarted = new Promise((resolve) => {
    signalBuild = resolve;
  });

  const handler = createStarDictImportWorkerHandler({
    quarantine,
    lockManager: locks,
    tokenFactory: () => token,
    postMessage: (message) => messages.push(message),
    buildPlain: async ({ signal }) => {
      signalBuild();
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(new DOMException("cancelled", "AbortError"));
        }, { once: true });
      });
    }
  });

  const importing = handler.handleMessage({
    type: STARDICT_WORKER_MESSAGES.START,
    requestId: "cancel-me",
    input: {
      format: "plain",
      dictBytes: new Uint8Array([1]),
      recipe: {}
    }
  });
  await buildStarted;
  assert.equal(
    locks.held.has(
      makeImportQuarantineLockName(token)
    ),
    true
  );

  assert.deepEqual(
    handler.cancel("cancel-me"),
    { cancelled: true }
  );
  const result = await importing;
  assert.equal(result.type, STARDICT_WORKER_MESSAGES.ERROR);
  assert.equal(result.errorName, "AbortError");
  assert.equal(handler.activeRequestId, "");
  assert.deepEqual(
    quarantine.removed,
    [
      "import-223e4567-e89b-42d3-a456-426614174000"
    ]
  );
  assert.equal(
    messages.at(-1).type,
    STARDICT_WORKER_MESSAGES.ERROR
  );
  await waitFor(() =>
    !locks.held.has(
      makeImportQuarantineLockName(token)
    )
  );
});

test("StarDict worker refuses to overwrite an existing quarantine token", async () => {
  const quarantine = new MemoryQuarantine();
  const token =
    "import-323e4567-e89b-42d3-a456-426614174000";
  quarantine.tokens.set(token, new Map());

  const handler = createStarDictImportWorkerHandler({
    quarantine,
    tokenFactory: () => token,
    postMessage: () => {},
    buildPlain: async () => {
      throw new Error("builder must not run");
    }
  });

  const result = await handler.handleMessage({
    type: STARDICT_WORKER_MESSAGES.START,
    requestId: "collision",
    input: {
      format: "plain",
      dictBytes: new Uint8Array([1]),
      recipe: {}
    }
  });

  assert.equal(
    result.errorCode,
    "STARDICT_WORKER_TOKEN_COLLISION"
  );
  assert.equal(quarantine.removed.length, 0);
  assert.equal(quarantine.tokens.has(token), true);
});

function recipeFixture() {
  return {
    schemaVersion: 1,
    semanticProfile:
      "en-zh-plain-text-translation-v1",
    packId: "local-worker-fixture",
    packVersion: "fixture-v1",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    dictionary: {
      bookname: "Worker Fixture EN-ZH",
      sourceId: "worker-fixture",
      sourceVersion: "fixture-v1"
    },
    assertions: {
      plainTextRepresentsTargetTranslation: true,
      localUseOnly: true
    }
  };
}

function makeStarDict(entries) {
  const sorted = [...entries].sort(
    (left, right) =>
      left[0].localeCompare(right[0], "en")
  );
  const idxChunks = [];
  const dictChunks = [];
  let offset = 0;

  for (const [word, translation] of sorted) {
    const wordBytes = encoder.encode(word);
    const payload = encoder.encode(translation);
    const numbers = new Uint8Array(8);
    const view = new DataView(numbers.buffer);
    view.setUint32(0, offset, false);
    view.setUint32(4, payload.byteLength, false);
    idxChunks.push(
      wordBytes,
      new Uint8Array([0]),
      numbers
    );
    dictChunks.push(payload);
    offset += payload.byteLength;
  }

  const idxBytes = concatBytes(idxChunks);
  return {
    ifoText: [
      "StarDict's dict ifo file",
      "version=2.4.2",
      "bookname=Worker Fixture EN-ZH",
      "wordcount=" + sorted.length,
      "idxfilesize=" + idxBytes.byteLength,
      "sametypesequence=m",
      ""
    ].join("\n"),
    idxBytes,
    dictBytes: concatBytes(dictChunks)
  };
}

function concatBytes(chunks) {
  const length = chunks.reduce(
    (sum, chunk) => sum + chunk.byteLength,
    0
  );
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

class MemoryQuarantine {
  constructor() {
    this.tokens = new Map();
    this.removed = [];
  }

  async listTokens() {
    return [...this.tokens.keys()].sort();
  }

  async writeFile(token, path, bytes) {
    let files = this.tokens.get(token);
    if (!files) {
      files = new Map();
      this.tokens.set(token, files);
    }
    files.set(path, new Uint8Array(bytes));
    return { path, size: bytes.byteLength };
  }

  async listFiles(token) {
    const files = this.tokens.get(token);
    if (!files) throw new Error("missing token");
    return [...files.entries()]
      .map(([path, bytes]) => ({
        path,
        size: bytes.byteLength
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async remove(token) {
    this.removed.push(token);
    return this.tokens.delete(token);
  }

  listPaths(token) {
    return [...(this.tokens.get(token)?.keys() || [])]
      .sort();
  }

  snapshot(token) {
    return Object.fromEntries(
      [...this.tokens.get(token).entries()]
        .map(([path, bytes]) => [
          path,
          new Uint8Array(bytes)
        ])
    );
  }
}


async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) =>
      setTimeout(resolve, 0)
    );
  }
  throw new Error("condition not reached");
}

class FakeLockManager {
  constructor() {
    this.held = new Set();
  }

  async request(name, options, callback) {
    if (
      options?.ifAvailable &&
      this.held.has(name)
    ) {
      return callback(null);
    }
    this.held.add(name);
    try {
      return await callback({
        name,
        mode: options?.mode || "exclusive"
      });
    } finally {
      this.held.delete(name);
    }
  }
}
