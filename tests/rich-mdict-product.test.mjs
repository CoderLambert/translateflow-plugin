import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRichMdictImportController } from "../src/options/rich-mdict-import-controller.js";
import { createRichMdictImportWorkerHandler } from "../src/options/workers/rich-mdict-import-worker-core.js";
import { RICH_MDICT_WORKER_MESSAGES } from "../src/options/workers/rich-mdict-import-worker-protocol.js";
import { BACKGROUND_MESSAGES, CONTENT_SCRIPT_FILES } from "../src/shared/constants.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("Settings streams the selected file to a worker, reserves it, then commits a reloadable dictionary", async () => {
  const runtime = new FakeRuntime();
  const workers = [];
  const file = makeFile("english-release-name.mdx");
  const controller = makeController(runtime, workers);

  const imported = await controller.importDictionary({
    mdxFile: file,
    displayMetadata: { name: "filename fallback" }
  });

  assert.equal(imported.commit.dictionary.title, "ECDICT 简明英汉增强版");
  assert.deepEqual(runtime.messages.map(({ type }) => type), [
    BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_PREFLIGHT,
    BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_COMMIT
  ]);
  assert.equal(runtime.messages[0].packId, imported.ready.packId);
  assert.equal(runtime.messages[0].packVersion, imported.ready.packVersion);
  assert.equal(runtime.messages[1].requestId, runtime.messages[0].requestId);
  assert.equal(workers[0].started.input.file, file);
  assert.deepEqual(workers[0].transferables, []);
  assert.equal(file.arrayBufferCalls, 0);
  assert.equal(workers[0].terminated, true);
});

test("a too-late cancel at the background commit point does not mark a successful install cancelled", async () => {
  const runtime = new FakeRuntime({ deferCommit: true });
  const workers = [];
  const controller = makeController(runtime, workers);
  const importing = controller.importDictionary({ mdxFile: makeFile("dict.mdx") });
  await waitFor(() => runtime.pendingCommit);

  assert.deepEqual(await controller.cancel(), { cancelled: false, phase: "commitpoint" });
  runtime.pendingCommit({ ok: true, status: "installed", dictionary: { title: "ECDICT" } });
  const imported = await importing;
  assert.equal(imported.commit.status, "installed");
  assert.equal(runtime.messages.some(({ type }) => type === BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_ABORT), false);
  assert.equal(runtime.messages.some(({ type }) => type === BACKGROUND_MESSAGES.RICH_MDICT_UNINSTALL), false);
});

test("accepted commit cancellation is background-owned and cleans staged data", async () => {
  const runtime = new FakeRuntime({ deferCommit: true, cancelAccepted: true });
  const workers = [];
  const controller = makeController(runtime, workers);
  const importing = controller.importDictionary({ mdxFile: makeFile("dict.mdx") });
  await waitFor(() => runtime.pendingCommit);

  assert.deepEqual(await controller.cancel(), { cancelled: true, phase: "verify" });
  runtime.pendingCommit({ ok: false, error: "Rich dictionary operation cancelled." });
  await assert.rejects(importing, (error) => error?.name === "AbortError");
  assert.deepEqual(runtime.messages.filter(({ type }) => type === BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_CANCEL).length, 1);
  assert.deepEqual(runtime.messages.filter(({ type }) => type === BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_ABORT).length, 1);
  assert.equal(controller.activeRequestId, "");
});

test("worker validates before claiming an active request and prefers the MDX header title", async () => {
  const posted = [];
  const store = new WorkerStore();
  const handler = createRichMdictImportWorkerHandler({
    postMessage: (message) => posted.push(message),
    store,
    cryptoProvider: globalThis.crypto,
    buildIndex: async ({ source }) => {
      assert.equal(source.size, 9);
      return { entryCount: 1, header: { title: "ECDICT 简明英汉增强版", format: "Html", version: "2.0" } };
    }
  });
  const file = makeFile("english-release-name.mdx", 9);
  const result = await handler.handleMessage({
    type: RICH_MDICT_WORKER_MESSAGES.START,
    requestId: "worker-valid",
    input: {
      file,
      packId: "rich-mdict-" + UUID,
      packVersion: "import-m1234-123e4567"
    }
  });

  assert.equal(result.metadata.title, "ECDICT 简明英汉增强版");
  assert.equal(store.writes[0].bytes, file);
  assert.equal(file.arrayBufferCalls, 0);
  assert.equal(handler.activeRequestId, "");

  await assert.rejects(handler.handleMessage({
    type: RICH_MDICT_WORKER_MESSAGES.START,
    requestId: "worker-invalid",
    input: { file: { size: 3, name: "bad.txt" }, packId: "bad", packVersion: "bad" }
  }));
  assert.equal(handler.activeRequestId, "");
});

test("Settings and selection expose local rich details while preserving the strict MDX MDD limit", async () => {
  const [settings, richUi, details, renderer, constants] = await Promise.all([
    readFile(new URL("../options.html", import.meta.url), "utf8"),
    readFile(new URL("../src/options/rich-mdict-import-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../src/content/selection/rich-details.js", import.meta.url), "utf8"),
    readFile(new URL("../src/content/selection/result-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/constants.js", import.meta.url), "utf8")
  ]);

  const richCard = settings.slice(settings.indexOf("MDX 富文本词典"), settings.indexOf("<strong>MDict (.mdx)</strong>"));
  assert.match(richCard, /id="richMdictFile"/u);
  assert.match(settings, /<h4>富文本词典<\/h4>\s*<div id="richMdictInstalledList"/u);
  assert.match(settings, /不支持 \.mdd/u);
  assert.doesNotMatch(richCard, /OPFS/u);
  assert.match(richUi, /用户提供 \/ 未验证 · MDX/u);
  assert.match(richUi, /parseRichMdictHeader/u);
  assert.match(richUi, /header\.encoding\?\.name/u);
  assert.match(details, /RICH_MDICT_LOOKUP/u);
  assert.match(details, /do not delay or replace the primary result/u);
  assert.match(renderer, /sanitizeRichDictionaryRecord\(richRecord\)/u);
  assert.match(renderer, /viewer\.render\(body, safeTree, fallback/u);
  assert.match(renderer, /viewer\.renderPlainText\(body, fallback\)/u);
  assert.match(renderer, /richRecord/u);
  assert.doesNotMatch(renderer, /innerHTML/u);
  assert.ok(CONTENT_SCRIPT_FILES.indexOf("src/content/selection/rich-details.js") < CONTENT_SCRIPT_FILES.indexOf("src/content/selection/controller.js"));
  assert.match(constants, /RICH_MDICT_IMPORT_CANCEL/u);
});

function makeController(runtime, workers) {
  let uuid = 0;
  return createRichMdictImportController({
    runtime,
    WorkerCtor: class extends FakeWorker {
      constructor(url, options) {
        super(url, options);
        workers.push(this);
      }
    },
    cryptoProvider: {
      randomUUID: () => uuid++ === 0
        ? UUID
        : "123e4567-e89b-42d3-a456-426614174001"
    },
    now: () => 123456789
  });
}

class FakeRuntime {
  constructor({ deferCommit = false, cancelAccepted = false } = {}) {
    this.messages = [];
    this.deferCommit = deferCommit;
    this.cancelAccepted = cancelAccepted;
    this.pendingCommit = null;
  }
  getURL(path) { return `chrome-extension://fixture/${path}`; }
  async sendMessage(message) {
    this.messages.push(message);
    if (message.type === BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_PREFLIGHT) return { ok: true, ready: true };
    if (message.type === BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_CANCEL) {
      return { ok: true, cancelled: this.cancelAccepted, phase: this.cancelAccepted ? "verify" : "commitpoint" };
    }
    if (message.type === BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_ABORT) return { ok: true, removed: true };
    if (message.type === BACKGROUND_MESSAGES.RICH_MDICT_IMPORT_COMMIT) {
      if (!this.deferCommit) {
        return { ok: true, status: "installed", dictionary: { title: "ECDICT 简明英汉增强版" } };
      }
      return new Promise((resolve) => { this.pendingCommit = resolve; });
    }
    throw new Error(`Unexpected runtime message ${message.type}`);
  }
}

class FakeWorker {
  listeners = new Map();
  terminated = false;
  transferables = [];
  started = null;
  constructor(url, options) {
    this.url = url;
    this.options = options;
  }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  postMessage(message, transfer = []) {
    this.transferables = transfer;
    if (message.type !== RICH_MDICT_WORKER_MESSAGES.START) return;
    this.started = message;
    queueMicrotask(() => this.emit("message", {
      data: {
        type: RICH_MDICT_WORKER_MESSAGES.READY,
        requestId: message.requestId,
        packId: message.input.packId,
        packVersion: message.input.packVersion,
        metadata: {
          title: "ECDICT 简明英汉增强版",
          sourceSize: message.input.file.size,
          indexSize: 10,
          indexSha256: "a".repeat(64),
          entryCount: 3402564,
          format: "Html",
          header: { title: "ECDICT 简明英汉增强版", format: "Html" }
        }
      }
    }));
  }
  emit(type, event) { for (const callback of this.listeners.get(type) || []) callback(event); }
  terminate() { this.terminated = true; }
}

class WorkerStore {
  writes = [];
  files = new Map();
  async listVersions(packId) { return [...this.files.keys()].some((key) => key.startsWith(`${packId}/`)) ? ["existing"] : []; }
  async writeFile(packId, version, path, bytes) {
    this.writes.push({ packId, version, path, bytes });
    this.files.set(`${packId}/${version}/${path}`, bytes instanceof Uint8Array ? bytes.length : bytes.size);
  }
  async getFileSize(packId, version, path) { return this.files.get(`${packId}/${version}/${path}`) || 0; }
  async removeVersion(packId, version) {
    for (const key of this.files.keys()) if (key.startsWith(`${packId}/${version}/`)) this.files.delete(key);
  }
}

function makeFile(name, size = 16) {
  return {
    name,
    size,
    arrayBufferCalls: 0,
    slice(start, end) {
      return {
        async arrayBuffer() {
          this.parent.arrayBufferCalls += 1;
          return new Uint8Array(Math.max(0, end - start)).buffer;
        },
        parent: this
      };
    },
    async arrayBuffer() {
      this.arrayBufferCalls += 1;
      return new Uint8Array(size).buffer;
    }
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for product fixture state.");
}
