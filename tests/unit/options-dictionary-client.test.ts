import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../src/background/packs/importers/curated-local-adapter.js", () => ({
  buildCuratedDictionaryLocalTflex: vi.fn()
}));

import { buildCuratedDictionaryLocalTflex } from "../../src/background/packs/importers/curated-local-adapter.js";
import { dictionaryClient } from "../../src/options/dictionary-client";
import { createCuratedDictionaryWorkerHandler } from "../../src/options/workers/curated-dictionary-worker-core.js";
import { CURATED_WORKER_MESSAGES } from "../../src/options/workers/curated-dictionary-worker-protocol.js";
import { getCuratedDictionary } from "../../src/shared/curated-dictionaries.js";
import { BACKGROUND_MESSAGES } from "../../src/shared/constants.js";

const source = getCuratedDictionary("ecdict-en-zh-curated")!;
const token = "00000000000000000000000000000001";
const files = {
  "entries.dat": new Uint8Array([1, 2, 3]),
  "index.dat": new Uint8Array([4, 5]),
  "manifest.json": new Uint8Array([6])
};

beforeEach(() => {
  vi.mocked(buildCuratedDictionaryLocalTflex).mockClear();
  vi.mocked(buildCuratedDictionaryLocalTflex).mockResolvedValue({
    files,
    manifest: { packId: source.output.packId, packVersion: source.output.packVersion, fingerprint: "fixture" },
    projection: { stats: { retainedRecords: 2 } }
  } as never);
});
afterEach(() => { vi.restoreAllMocks(); });

test("dictionary loading reads installed state only and needs no bundled status service", async () => {
  const fixture = makeFixture();
  fixture.sendMessage.mockImplementation(async message => {
    if (message.type === BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS) return { ok: true, state: { packs: {} } };
    if (message.type === BACKGROUND_MESSAGES.RICH_MDICT_LIST) return { ok: true, dictionaries: [] };
    throw new Error("unexpected dictionary load message");
  });

  await expect(fixture.client.load()).resolves.toEqual({ packState: { packs: {} }, rich: [] });
  expect(fixture.sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
    BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS, BACKGROUND_MESSAGES.RICH_MDICT_LIST
  ]);
  expect(fixture.workerCreated).not.toHaveBeenCalled();
});

test("the real curated worker READY reaches the Options client and commits the staged dictionary once", async () => {
  const fixture = makeFixture();
  const progress = vi.fn();
  const result = await fixture.client.installCurated(source, null, progress);

  expect(fixture.workerMessages.find(message => message.type === CURATED_WORKER_MESSAGES.READY)).toMatchObject({
    sourceId: source.id,
    token,
    stats: { retainedRecords: 2, outputBytes: 6 }
  });
  expect(fixture.staged.size).toBe(3);
  expect(fixture.sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: BACKGROUND_MESSAGES.DICTIONARY_LOCAL_IMPORT_COMMIT,
    token,
    displayMetadata: expect.objectContaining({ kind: "curated-upstream", name: source.label })
  }));
  expect(result).toMatchObject({ ok: true, stats: { retainedRecords: 2, outputBytes: 6 } });
  expect(progress).toHaveBeenCalledWith("正在保存并进行后台完整性验证…");
});

test("a ready reply for a different source cannot commit the curated dictionary", async () => {
  const fixture = makeFixture({ changeReadySource: "different-recipe" });
  await expect(fixture.client.installCurated(source, null, vi.fn())).rejects.toThrow("精选词典 Worker 执行失败");
  expect(fixture.sendMessage).not.toHaveBeenCalled();
});

test("a failed background commit does not return installation success or completed statistics", async () => {
  const fixture = makeFixture({ commitResponse: { ok: false, error: "fixture integrity check failed" } });
  await expect(fixture.client.installCurated(source, null, vi.fn())).rejects.toThrow("fixture integrity check failed");
  expect(fixture.sendMessage).toHaveBeenCalledTimes(1);
});

test("denied MDX download permission shows the existing recovery message before any worker or commit", async () => {
  const fixture = makeFixture({ permissionGranted: false });
  const mdxSource = getCuratedDictionary("ecdict-en-zh-mdx-curated")!;
  await expect(fixture.client.installCurated(mdxSource, null, vi.fn())).rejects.toThrow(
    "下载权限未获准，尚未开始下载。你可以在允许访问上游后重试。"
  );
  expect(fixture.workerCreated).not.toHaveBeenCalled();
  expect(fixture.sendMessage).not.toHaveBeenCalled();
  expect(buildCuratedDictionaryLocalTflex).not.toHaveBeenCalled();
});

function makeFixture({ changeReadySource = "", commitResponse = { ok: true }, permissionGranted = true }: {
  changeReadySource?: string;
  commitResponse?: Record<string, unknown>;
  permissionGranted?: boolean;
} = {}) {
  const staged = new Map<string, Uint8Array>();
  const workerMessages: Record<string, any>[] = [];
  const sendMessage = vi.fn(async (_message: Record<string, any>): Promise<Record<string, any>> => commitResponse);
  const workerCreated = vi.fn();
  class CuratedWorker extends EventTarget {
    constructor() { super(); workerCreated(); }
    readonly handler = createCuratedDictionaryWorkerHandler({
      postMessage: (message: Record<string, any>) => {
        const reply = message.type === CURATED_WORKER_MESSAGES.READY && changeReadySource
          ? { ...message, sourceId: changeReadySource } : message;
        workerMessages.push(reply);
        this.dispatchEvent(new MessageEvent("message", { data: reply }));
      },
      tokenFactory: () => token,
      network: { fetchSource: async () => ({ ok: true, status: 200, url: source.downloadUrl }) },
      quarantine: {
        listTokens: async () => [],
        writeFile: async (_token: string, path: string, bytes: Uint8Array) => { staged.set(path, bytes); },
        listFiles: async () => [...staged].map(([path, bytes]) => ({ path, size: bytes.byteLength })),
        remove: async () => { staged.clear(); }
      }
    } as never);
    postMessage(message: unknown) { void this.handler.handleMessage(message); }
    terminate() {}
  }
  const client = dictionaryClient({
    runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}`, sendMessage } as never,
    permissions: { request: vi.fn(async () => permissionGranted) } as never,
    WorkerCtor: CuratedWorker as unknown as typeof Worker,
    cryptoProvider: { randomUUID: () => "00000000-0000-0000-0000-000000000001" } as never
  });
  return { client, sendMessage, staged, workerMessages, workerCreated };
}
