import { test, expect, chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startMockServer } from './support/mock-server.mjs';
import { READING_METHOD as M, READING_ERROR as E } from '../src/shared/reading/constants.js';
import { request, snapshot, artifact } from '../tests/fixtures/reading/contract.mjs';
import { createSourceDigest } from '../src/shared/reading/identity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.env.READING_STORAGE_SOURCE_ROOT || root;
let temporary, extension, context, worker, probeWorker, center, driver, server, origin, inventory;
const hash = (data) => createHash('sha256').update(data).digest('hex');
async function copyClosure(file, seen = new Set()) {
  const path = resolve(sourceRoot, file); if (seen.has(path)) return; seen.add(path);
  const content = await readFile(path); const target = join(extension, 'storage-probe', relative(sourceRoot, path));
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, content);
  inventory.push({ file: relative(sourceRoot, path), sha256: hash(content) });
  for (const match of content.toString().matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/gu)) await copyClosure(relative(sourceRoot, resolve(dirname(path), match[1])), seen);
}
async function launch() {
  context = await chromium.launchPersistentContext(join(temporary, 'profile'), { headless: true, channel: 'chromium',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); origin = `chrome-extension://${new URL(worker.url()).host}`;
  driver = await context.newPage(); await driver.goto(`${origin}/popup.html`);
  center = await context.newPage(); await center.goto(`${origin}/learning-center.html`);
  const waiting = center.waitForEvent('worker');
  await center.evaluate(() => { globalThis.__storageProbeWorker = new Worker(chrome.runtime.getURL('storage-probe/worker.mjs'), { type: 'module' }); });
  probeWorker = await waiting;
  await expect.poll(() => probeWorker.evaluate(() => !!globalThis.__probe)).toBe(true);
}
async function message(method, extra = {}) { return center.evaluate((input) => chrome.runtime.sendMessage(input), request(method, extra)); }
async function reset() {
  await probeWorker.evaluate(async () => { const { repo, ctx, M } = __probe;
    const current = await repo.read(ctx(M.GET_RECORDING_STATE)); await repo.mutate(ctx(M.CLEAR_RECORDS, { expectedDataGeneration: current.dataGeneration }));
    if (current.enabled) await repo.mutate(ctx(M.SET_RECORDING, { enabled: false, expectedConsentGeneration: current.consentGeneration }));
    repo.close(); __probe.repo = __probe.factory({ now: () => 1000 });
  });
}
async function openContent() {
  const page = await context.newPage(); await page.goto(`${server.baseUrl}/article`);
  const tabId = await driver.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id, page.url());
  const generation = `doc-${crypto.randomUUID()}`, snap = snapshot({ documentGeneration: generation }); snap.sourceDigest = await createSourceDigest(snap);
  await driver.evaluate(({ tabId, input }) => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', args: [JSON.stringify(input)],
    func: (text) => { const source = JSON.parse(text); globalThis.__TRANSLATE_FLOW_CONTENT__ ||= { modules: {} };
      globalThis.__TRANSLATE_FLOW_CONTENT__.modules.readingAccessCollector = { read(challenge) { return { nonce: challenge.nonce,
        documentGeneration: source.documentGeneration, selectionGeneration: 1, captureSafety: { selection: 'safe', context: 'safe', root: 'light-dom' }, sourceSnapshot: source,
        intent: ['register', 'inspect'].includes(challenge.action) ? null : { action: challenge.action, recordId: challenge.recordId, operationId: challenge.operationId } }; } }; }
  }), { tabId, input: snap });
  const send = async (input) => { const [result] = await driver.evaluate(({ tabId, input }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', args: [JSON.stringify(input)],
    func: (text) => chrome.runtime.sendMessage(JSON.parse(text)) }), { tabId, input }); return result.result; };
  const registration = await send(request(M.REGISTER_DOCUMENT, { documentGeneration: generation })); expect(registration.ok).toBe(true);
  return { page, send, snap, registration: registration.data };
}

test.describe('Reading storage: actual compiled router/repository + separately labelled direct-source native IDB probes', () => {
  test.setTimeout(120000);
  test.beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'translateflow-reading-storage-')); extension = join(temporary, 'extension'); server = await startMockServer();
    await cp(join(sourceRoot, '.output/chrome-mv3'), extension, { recursive: true });
    inventory = []; await copyClosure('src/background/reading-record/repository.js'); await copyClosure('tests/fixtures/reading/storage.mjs');
    await writeFile(join(extension, 'storage-probe/worker.mjs'), `import {createReadingRepository as factory} from './src/background/reading-record/repository.js';
import * as helpers from './tests/fixtures/reading/storage.mjs';
import * as adapter from './src/background/reading-record/idb.js';
globalThis.__probe={...helpers,...adapter,repo:factory({now:()=>1000}),factory};`);
    await writeFile(join(extension, 'learning-center.html'), '<!doctype html><title>Synthetic LC access fixture; not product UI</title>');
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push('http://127.0.0.1/*');
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    expect(hash(await readFile(join(extension, 'background.js')))).toBe(hash(await readFile(join(sourceRoot, '.output/chrome-mv3/background.js'))));
    await launch();
    await writeFile(test.info().outputPath('storage-copy-inventory.json'), JSON.stringify({ productionBackgroundUnchanged: true, browser: context.browser().version(), inventory,
      fixtureChanges: ['Synthetic LC HTML', 'ISOLATED owned collector', 'localhost permission', 'Separate direct-source native probe module closure; not compiled acceptance'] }, null, 2));
  });
  test.afterAll(async () => { await context?.close(); await server?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });
  test.beforeEach(async () => { await reset(); server.reset(); });

  test('Compiled production messages persist consent and actual lookup / late Rich / idempotent artifacts; restart keeps exact rows', async () => {
    const disabled = await message(M.GET_RECORDING_STATE); expect(disabled).toMatchObject({ ok: true, data: { enabled: false, recordCount: 0 } });
    expect((await driver.evaluate((input) => chrome.runtime.sendMessage(input), request(M.OPEN_LEARNING_CENTER))).error.code).toBe(E.NOT_READY);
    expect((await message(M.SET_RECORDING, { expectedConsentGeneration: disabled.data.consentGeneration })).ok).toBe(true);
    const content = await openContent();
    const begin = request(M.BEGIN_QUERY, { operationId: crypto.randomUUID(), pageKey: content.registration.pageKey, sourceSnapshot: content.snap });
    const prepared = await content.send(begin); expect(prepared, JSON.stringify(prepared)).toMatchObject({ ok: true, data: { state: 'ready' } });
    expect((await message(M.GET_RECORDING_STATE)).data.recordCount).toBe(0);
    const value = artifact('dictionary', { recordId: prepared.data.token.recordId, operationId: begin.operationId, sourceSnapshotId: content.snap.sourceSnapshotId });
    const saved = await content.send(request(M.SAVE_QUERY_RESULT, { token: prepared.data.token, artifact: value })); expect(saved.ok).toBe(true);
    const repeated = await content.send(request(M.SAVE_QUERY_RESULT, { token: prepared.data.token, artifact: value })); expect(repeated.data).toEqual({ ...saved.data, duplicate: true });
    expect((await content.send(request(M.SAVE_QUERY_RESULT, { token: prepared.data.token, artifact: { ...value, payload: { ...value.payload, headword: 'changed' } } }))).error.code).toBe(E.BAD_DTO);
    const rich = artifact('translation', { artifactId: 'late-rich', recordId: value.recordId, operationId: begin.operationId, sourceSnapshotId: content.snap.sourceSnapshotId });
    expect((await content.send(request(M.SAVE_QUERY_RESULT, { token: prepared.data.token, artifact: rich }))).ok).toBe(true);
    let detail = await message(M.GET_RECORD, { recordId: value.recordId }); expect(detail.ok).toBe(true); expect(detail.data.record.lookupCount).toBe(1); expect(detail.data.artifacts).toHaveLength(2);
    expect(server.calls).toHaveLength(0);
    const before = await message(M.GET_RECORDING_STATE); await context.close(); await launch();
    const after = await message(M.GET_RECORDING_STATE); expect(after.data).toEqual(before.data);
    detail = await message(M.GET_RECORD, { recordId: value.recordId }); expect(detail.data.artifacts).toHaveLength(2); expect(detail.data.record.sourceLanguage).toBe('en');
  });

  test('Native canonical pagination traverses over 128 pages without capacity leakage or duplicate IDs', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; await p.seedRecords(3900); const ids = []; let cursor = null, pages = 0;
      do { const page = await p.repo.read(p.ctx(p.M.LIST_RECORDS, { query: '', limit: 30, cursor })); ids.push(...page.items.map((item) => item.recordId)); cursor = page.nextCursor; pages++; } while (cursor);
      return { count: ids.length, unique: new Set(ids).size, pages }; });
    expect(result).toEqual({ count: 3900, unique: 3900, pages: 130 });
  });

  test('Native excluded origins stay bounded at 200 with same-origin revision protection', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; const errors = [];
      for (let n = 0; n < 201; n++) { const siteKey = `https://site-${n}.example.test`; const current = await p.repo.read(p.ctx(p.M.GET_SITE_RECORDING, { siteKey }));
        try { await p.repo.mutate(p.ctx(p.M.SET_SITE_RECORDING, { siteKey, excluded: true, expectedSitePolicyRevision: current.sitePolicyRevision })); } catch (error) { errors.push(error.code); } }
      const list = await p.repo.read(p.ctx(p.M.LIST_RECORDING_EXCLUSIONS, { limit: 100 })); return { errors, firstPage: list.items.length, next: !!list.nextCursor }; });
    expect(result).toEqual({ errors: [E.CAPACITY], firstPage: 100, next: true });
  });
});
