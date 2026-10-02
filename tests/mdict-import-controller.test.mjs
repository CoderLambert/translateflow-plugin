import test from "node:test";
import assert from "node:assert/strict";
import {
  createMdictImportController
} from "../src/options/mdict-import-controller.js";

test("MDict controller cancels worker conversion without starting a background commit", async () => {
  const runtime = new FakeRuntime();
  const workers = [];
  const controller = createController(runtime, workers);

  const importing = controller.importDictionary(input());
  await waitFor(() => controller.phase === "worker");

  const cancellation = await controller.cancel();
  assert.deepEqual(cancellation, {
    cancelled: true,
    phase: "worker",
    hard: false
  });
  const start = workers[0].posted[0].message;
  assert.deepEqual(workers[0].posted[1], {
    message: {
      type: "mdict-import:cancel",
      requestId: start.requestId
    },
    transfer: []
  });

  workers[0].emitMessage({
    type: "mdict-import:error",
    requestId: start.requestId,
    error: "cancelled",
    errorName: "AbortError",
    errorCode: ""
  });

  await assert.rejects(
    importing,
    (error) => error?.name === "AbortError"
  );
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(runtime.messages, []);
  assert.equal(controller.activeRequestId, "");
});

test("MDict controller removes a READY quarantine token when cancellation wins before commit", async () => {
  const runtime = new FakeRuntime();
  const workers = [];
  const quarantine = {
    removed: [],
    async remove(token) {
      this.removed.push(token);
      return true;
    }
  };
  const controller = createController(runtime, workers, quarantine);
  const importing = controller.importDictionary(input());

  await waitFor(() => controller.phase === "worker");
  await controller.cancel();
  const start = workers[0].posted[0].message;
  const token = "import-423e4567-e89b-42d3-a456-426614174000";
  workers[0].emitMessage({
    type: "mdict-import:ready",
    requestId: start.requestId,
    token,
    packId: "local-mdict-cancelled-ready",
    packVersion: "v1",
    fingerprint: "sha256:" + "c".repeat(64),
    metrics: { inputBytes: 7, outputBytes: 12 }
  });

  await assert.rejects(
    importing,
    (error) => error?.name === "AbortError"
  );
  assert.deepEqual(quarantine.removed, [token]);
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(runtime.messages, []);
  assert.equal(controller.activeRequestId, "");
});


test("MDict commit cancellation is surfaced as AbortError when background cancellation wins", async () => {
  let releaseCommit;
  let commitStartedResolve;
  const commitStarted = new Promise((resolve) => { commitStartedResolve = resolve; });
  const runtime = new FakeRuntime();
  runtime.sendMessage = async function sendMessage(message) {
    this.messages.push(message);
    if (message.type === "DICTIONARY_LOCAL_IMPORT_COMMIT") {
      commitStartedResolve();
      return new Promise((resolve) => { releaseCommit = resolve; });
    }
    if (message.type === "DICTIONARY_PACK_CANCEL") {
      return { ok: true, cancelled: true };
    }
    throw new Error("unexpected message");
  };
  const workers = [];
  const controller = createController(runtime, workers);
  const importing = controller.importDictionary(input());
  await waitFor(() => controller.phase === "worker");
  const start = workers[0].posted[0].message;
  workers[0].emitMessage({
    type: "mdict-import:ready",
    requestId: start.requestId,
    token: "import-623e4567-e89b-42d3-a456-426614174000",
    packId: "local-mdict-cancel-commit",
    packVersion: "v1",
    fingerprint: "sha256:" + "e".repeat(64),
    metrics: { inputBytes: 7, outputBytes: 12 }
  });
  await commitStarted;
  assert.deepEqual(await controller.cancel(), { cancelled: true, phase: "commit" });
  releaseCommit({ ok: false, errorCode: "CANCELLED", error: "cancelled" });
  await assert.rejects(importing, (error) => error?.name === "AbortError");
});

test("MDict late cancel is rejected at commit point and does not turn a committed import into AbortError", async () => {
  let cancelPhase = "";
  let releaseCommit;
  let commitStartedResolve;
  const commitStarted = new Promise((resolve) => { commitStartedResolve = resolve; });
  const runtime = new FakeRuntime();
  runtime.sendMessage = async function sendMessage(message) {
    this.messages.push(message);
    if (message.type === "DICTIONARY_LOCAL_IMPORT_COMMIT") {
      commitStartedResolve();
      return new Promise((resolve) => { releaseCommit = resolve; });
    }
    if (message.type === "DICTIONARY_PACK_CANCEL") {
      return { ok: true, cancelled: false, phase: cancelPhase };
    }
    throw new Error("unexpected message");
  };
  const workers = [];
  const controller = createController(runtime, workers);
  const importing = controller.importDictionary(input());
  await waitFor(() => controller.phase === "worker");
  const start = workers[0].posted[0].message;
  workers[0].emitMessage({
    type: "mdict-import:ready",
    requestId: start.requestId,
    token: "import-523e4567-e89b-42d3-a456-426614174000",
    packId: "local-mdict-commitpoint",
    packVersion: "v1",
    fingerprint: "sha256:" + "d".repeat(64),
    metrics: { inputBytes: 7, outputBytes: 12 }
  });
  await commitStarted;
  assert.deepEqual(await controller.cancel(), { cancelled: false, phase: "" });
  cancelPhase = "commitpoint";
  assert.deepEqual(await controller.cancel(), { cancelled: false, phase: "commitpoint" });
  controller.dispose(); // A closed view cannot undo a successful backend commit.
  releaseCommit({ ok: true, status: "imported" });
  const result = await importing;
  assert.equal(result.commit.status, "imported");
});

function createController(runtime, workers, quarantine) {
  let uuid = 0;
  return createMdictImportController({
    runtime,
    ...(quarantine ? { quarantine } : {}),
    WorkerCtor: class extends FakeWorker {
      constructor(url, options) {
        super(url, options);
        workers.push(this);
      }
    },
    cryptoProvider: {
      randomUUID() {
        uuid += 1;
        return "00000000-0000-4000-8000-" +
          String(uuid).padStart(12, "0");
      }
    }
  });
}

function input() {
  return {
    mdxFile: new Blob(["fixture"]),
    recipe: { fixture: true }
  };
}

async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition not reached");
}

class FakeRuntime {
  constructor() {
    this.messages = [];
  }

  getURL(path) {
    return "chrome-extension://fixture/" + path;
  }

  async sendMessage(message) {
    this.messages.push(message);
    if (message.type === "DICTIONARY_LOCAL_IMPORT_COMMIT") {
      return { ok: true, status: "imported" };
    }
    if (message.type === "DICTIONARY_PACK_CANCEL") {
      return { ok: true, cancelled: true };
    }
    throw new Error("unexpected message");
  }
}

class FakeWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.posted = [];
    this.listeners = {
      message: new Set(),
      error: new Set()
    };
    this.terminated = false;
  }

  postMessage(message, transfer = []) {
    this.posted.push({ message, transfer });
  }

  addEventListener(type, listener) {
    this.listeners[type]?.add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type]?.delete(listener);
  }

  emitMessage(data) {
    for (const listener of this.listeners.message) {
      listener({ data });
    }
  }

  terminate() {
    this.terminated = true;
  }
}
