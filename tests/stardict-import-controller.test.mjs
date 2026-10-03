import test from "node:test";
import assert from "node:assert/strict";
import {
  createStarDictImportController
} from "../src/options/stardict-import-controller.js";

const encoder = new TextEncoder();

test("Settings controller transfers plain StarDict ArrayBuffers and commits only the quarantine token", async () => {
  const runtime = new FakeRuntime();
  const workers = [];
  let uuid = 0;
  const progress = [];
  const controller = createStarDictImportController({
    runtime,
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
    },
    onProgress: (event) => progress.push(event)
  });

  const ifoFile = blob("ifo");
  const idxFile = blob("idx");
  const dictFile = blob("dict");
  const resultPromise = controller.importDictionary({
    format: "plain",
    ifoFile,
    idxFile,
    dictFile,
    recipe: { fixture: true }
  });

  await waitFor(() => workers[0]?.posted.length === 1);
  const posted = workers[0].posted[0];
  assert.equal(posted.message.type, "stardict-import:start");
  assert.equal(posted.message.input.format, "plain");
  assert.equal(posted.transfer.length, 3);
  assert.equal(
    posted.message.input.ifoBytes,
    posted.transfer[0]
  );
  assert.equal(
    posted.message.input.idxBytes,
    posted.transfer[1]
  );
  assert.equal(
    posted.message.input.dictBytes,
    posted.transfer[2]
  );

  workers[0].emitMessage({
    type: "stardict-import:progress",
    requestId: posted.message.requestId,
    phase: "stage",
    path: "entries.dat"
  });
  workers[0].emitMessage({
    type: "stardict-import:ready",
    requestId: posted.message.requestId,
    token:
      "import-123e4567-e89b-42d3-a456-426614174000",
    packId: "local-controller",
    packVersion: "v1",
    fingerprint: "sha256:" + "a".repeat(64)
  });

  const result = await resultPromise;
  assert.equal(result.commit.status, "imported");
  assert.equal(controller.phase, "");
  assert.equal(controller.activeRequestId, "");
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(
    runtime.messages.map((message) => message.type),
    ["DICTIONARY_LOCAL_IMPORT_COMMIT"]
  );
  assert.deepEqual(
    Object.keys(runtime.messages[0]).sort(),
    ["requestId", "token", "type"]
  );
  assert.equal(
    runtime.messages[0].token,
    result.ready.token
  );
  assert.deepEqual(
    progress.map((item) => item.phase),
    ["read", "stage", "commit", "done"]
  );
});

test("Settings controller keeps dictzip as Blob and transfers only sidecar ArrayBuffers", async () => {
  const runtime = new FakeRuntime();
  const workers = [];
  const controller = createStarDictImportController({
    runtime,
    WorkerCtor: class extends FakeWorker {
      constructor(url, options) {
        super(url, options);
        workers.push(this);
      }
    },
    cryptoProvider: {
      randomUUID: () =>
        "00000000-0000-4000-8000-000000000001"
    }
  });

  const dictzip = blob("compressed");
  const importing = controller.importDictionary({
    format: "dictzip",
    ifoFile: blob("ifo"),
    idxFile: blob("idx"),
    dictFile: dictzip,
    synFile: blob("syn"),
    recipe: { fixture: true }
  });

  await waitFor(() => workers[0]?.posted.length === 1);
  const posted = workers[0].posted[0];
  assert.equal(
    posted.message.input.dictzipBlob,
    dictzip
  );
  assert.equal(
    posted.message.input.dictBytes,
    undefined
  );
  assert.equal(posted.transfer.length, 3);

  workers[0].emitMessage({
    type: "stardict-import:ready",
    requestId: posted.message.requestId,
    token:
      "import-223e4567-e89b-42d3-a456-426614174000",
    packId: "local-controller-dz",
    packVersion: "v1",
    fingerprint: "sha256:" + "b".repeat(64)
  });
  await importing;
});

test("Settings controller routes worker cancellation without starting background commit", async () => {
  const runtime = new FakeRuntime();
  const workers = [];
  const controller = createStarDictImportController({
    runtime,
    WorkerCtor: class extends FakeWorker {
      constructor(url, options) {
        super(url, options);
        workers.push(this);
      }
    },
    cryptoProvider: {
      randomUUID: () =>
        "00000000-0000-4000-8000-000000000003"
    }
  });

  const importing = controller.importDictionary({
    format: "plain",
    ifoFile: blob("ifo"),
    idxFile: blob("idx"),
    dictFile: blob("dict"),
    recipe: { fixture: true }
  });

  await waitFor(() => controller.phase === "worker");
  const cancel = await controller.cancel();
  assert.deepEqual(cancel, {
    cancelled: true,
    phase: "worker",
    hard: false
  });
  assert.equal(
    workers[0].posted.at(-1).message.type,
    "stardict-import:cancel"
  );

  workers[0].emitMessage({
    type: "stardict-import:error",
    requestId: controller.activeRequestId,
    error: "cancelled",
    errorName: "AbortError",
    errorCode: ""
  });

  await assert.rejects(
    importing,
    (error) => error?.name === "AbortError"
  );
  assert.deepEqual(runtime.messages, []);
});


test("Settings controller removes a completed worker token when cancellation wins before commit", async () => {
  const runtime = new FakeRuntime();
  const workers = [];
  const quarantine = {
    removed: [],
    async remove(token) {
      this.removed.push(token);
      return true;
    }
  };
  const controller = createStarDictImportController({
    runtime,
    quarantine,
    WorkerCtor: class extends FakeWorker {
      constructor(url, options) {
        super(url, options);
        workers.push(this);
      }
    },
    cryptoProvider: {
      randomUUID: () =>
        "00000000-0000-4000-8000-000000000004"
    }
  });

  const importing = controller.importDictionary({
    format: "plain",
    ifoFile: blob("ifo"),
    idxFile: blob("idx"),
    dictFile: blob("dict"),
    recipe: { fixture: true }
  });

  await waitFor(() => controller.phase === "worker");
  await controller.cancel();
  const start = workers[0].posted[0].message;
  const token =
    "import-423e4567-e89b-42d3-a456-426614174000";
  workers[0].emitMessage({
    type: "stardict-import:ready",
    requestId: start.requestId,
    token,
    packId: "local-cancelled-ready",
    packVersion: "v1",
    fingerprint: "sha256:" + "c".repeat(64)
  });

  await assert.rejects(
    importing,
    (error) => error?.name === "AbortError"
  );
  assert.deepEqual(quarantine.removed, [token]);
  assert.deepEqual(runtime.messages, []);
});


test("StarDict commit cancellation is surfaced as AbortError when background cancellation wins", async () => {
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
  const controller = createStarDictImportController({
    runtime,
    WorkerCtor: class extends FakeWorker {
      constructor(url, options) {
        super(url, options);
        workers.push(this);
      }
    },
    cryptoProvider: {
      randomUUID: () => "00000000-0000-4000-8000-000000000006"
    }
  });
  const importing = controller.importDictionary({
    format: "plain",
    ifoFile: blob("ifo"),
    idxFile: blob("idx"),
    dictFile: blob("dict"),
    recipe: { fixture: true }
  });
  await waitFor(() => controller.phase === "worker");
  const start = workers[0].posted[0].message;
  workers[0].emitMessage({
    type: "stardict-import:ready",
    requestId: start.requestId,
    token: "import-623e4567-e89b-42d3-a456-426614174000",
    packId: "local-stardict-cancel-commit",
    packVersion: "v1",
    fingerprint: "sha256:" + "e".repeat(64)
  });
  await commitStarted;
  assert.deepEqual(await controller.cancel(), { cancelled: true, phase: "commit" });
  releaseCommit({ ok: false, errorCode: "CANCELLED", error: "cancelled" });
  await assert.rejects(importing, (error) => error?.name === "AbortError");
});

test("StarDict late cancel is rejected at commit point and import completes normally", async () => {
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
  const controller = createStarDictImportController({
    runtime,
    WorkerCtor: class extends FakeWorker {
      constructor(url, options) {
        super(url, options);
        workers.push(this);
      }
    },
    cryptoProvider: {
      randomUUID: () => "00000000-0000-4000-8000-000000000005"
    }
  });
  const importing = controller.importDictionary({
    format: "plain",
    ifoFile: blob("ifo"),
    idxFile: blob("idx"),
    dictFile: blob("dict"),
    recipe: { fixture: true }
  });
  await waitFor(() => controller.phase === "worker");
  const start = workers[0].posted[0].message;
  workers[0].emitMessage({
    type: "stardict-import:ready",
    requestId: start.requestId,
    token: "import-523e4567-e89b-42d3-a456-426614174000",
    packId: "local-stardict-commitpoint",
    packVersion: "v1",
    fingerprint: "sha256:" + "d".repeat(64)
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

function blob(value) {
  return new Blob([encoder.encode(value)]);
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

class FakeRuntime {
  constructor() {
    this.messages = [];
  }

  getURL(path) {
    return "chrome-extension://fixture/" + path;
  }

  async sendMessage(message) {
    this.messages.push(message);
    if (
      message.type ===
      "DICTIONARY_LOCAL_IMPORT_COMMIT"
    ) {
      return {
        ok: true,
        status: "imported"
      };
    }
    if (message.type === "DICTIONARY_PACK_CANCEL") {
      return {
        ok: true,
        cancelled: true
      };
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
    this.posted.push({
      message,
      transfer
    });
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
