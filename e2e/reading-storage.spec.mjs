import { test, expect, chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startMockServer } from './support/mock-server.mjs';
import { READING_METHOD as M, READING_ERROR as E } from '../src/shared/reading/constants.js';
import { request, snapshot, artifact } from '../tests/fixtures/reading/contract.mjs';
import { createSourceDigest } from '../src/shared/reading/identity.js';
import { registerStorageRegressions } from './reading-storage-regressions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(process.env.READING_STORAGE_SOURCE_ROOT || root);
const artifactVariable = ['READING_STORAGE_ARTIFACT', 'TF_E2E_ARTIFACT', 'TF_I18N_ARTIFACT']
  .find((name) => process.env[name] !== undefined);
const artifactPath = artifactVariable ? process.env[artifactVariable] : '.output/chrome-mv3';
if (!artifactPath.trim()) throw new Error(`${artifactVariable} must name a production artifact directory`);
const artifactRoot = resolve(root, artifactPath);
let temporary, extension, context, worker, probeWorker, center, driver, server, origin, inventory;
const hash = (data) => createHash('sha256').update(data).digest('hex');
async function packageInventory(directory, prefix='') {
  const output=[];for(const item of await readdir(join(directory,prefix),{withFileTypes:true})) {
    const file=prefix ? `${prefix}/${item.name}` : item.name;
    if(item.isDirectory()) output.push(...await packageInventory(directory,file));
    else {const bytes=await readFile(join(directory,file));output.push({file,size:bytes.length,sha256:hash(bytes)});}
  }return output.sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0);
}
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
    __probe.clock=1000; const current = await repo.read(ctx(M.GET_RECORDING_STATE)); await repo.mutate(ctx(M.CLEAR_RECORDS, { expectedDataGeneration: current.dataGeneration }));
    if (current.enabled) await repo.mutate(ctx(M.SET_RECORDING, { enabled: false, expectedConsentGeneration: current.consentGeneration }));
    for (;;) { const list = await repo.read(ctx(M.LIST_RECORDING_EXCLUSIONS, {limit:100})); if (!list.items.length) break;
      for (const site of list.items) await repo.mutate(ctx(M.SET_SITE_RECORDING, { siteKey:site.siteKey, excluded:false, expectedSitePolicyRevision:site.sitePolicyRevision })); }
    repo.close(); __probe.repo = __probe.factory({ now: () => __probe.clock });
  });
}
async function openContent() {
  const page = await context.newPage(); await page.goto(`${server.baseUrl}/article`);
  const marker = `Synthetic storage tab ${crypto.randomUUID()}`; await page.evaluate((title) => { document.title = title; }, marker);
  let tabId; await expect.poll(async () => { tabId = await driver.evaluate(async (title) => (await chrome.tabs.query({})).find((tab) => tab.title === title)?.id, marker); return tabId; }).toBeGreaterThanOrEqual(0);
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
  return { page, tabId, send, snap, registration: registration.data };
}

test.describe('Reading storage: selected production router/repository + separately labelled direct-source native IDB probes', () => {
  test.setTimeout(120000);
  test.beforeAll(async () => {
    const production=await packageInventory(artifactRoot);
    temporary = await mkdtemp(join(tmpdir(), 'translateflow-reading-storage-')); extension = join(temporary, 'extension'); server = await startMockServer();
    await cp(artifactRoot, extension, { recursive: true });
    expect(await packageInventory(extension)).toEqual(production);
    inventory = []; await copyClosure('src/background/reading-record/repository.js'); await copyClosure('tests/fixtures/reading/storage.mjs');
    await writeFile(join(extension, 'storage-probe/worker.mjs'), `import {createReadingRepository as factory} from './src/background/reading-record/repository.js';
import * as helpers from './tests/fixtures/reading/storage.mjs';
import * as adapter from './src/background/reading-record/idb.js';
globalThis.__probe={...helpers,...adapter,clock:1000,repo:factory({now:()=>globalThis.__probe.clock}),factory};`);
    await writeFile(join(extension, 'learning-center.html'), '<!doctype html><title>Synthetic LC access fixture; not product UI</title>');
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push('http://127.0.0.1/*');
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    const productionBackgroundSha256=hash(await readFile(join(artifactRoot, 'background.js')));
    expect(hash(await readFile(join(extension, 'background.js')))).toBe(productionBackgroundSha256);
    await launch();
    await writeFile(test.info().outputPath('storage-copy-inventory.json'), JSON.stringify({ sourceRoot, artifactRoot, artifactVariable:artifactVariable || 'default WXT', productionBackgroundSha256,
      productionBackgroundUnchanged: true, productionCopyBeforeChangesExact:true, production, browser: context.browser().version(), inventory,
      probeBootstrapSha256:hash(await readFile(join(extension,'storage-probe/worker.mjs'))),
      fixtureChanges: ['Synthetic LC HTML', 'ISOLATED owned collector', 'localhost permission', 'Separate direct-source native probe module closure; not compiled acceptance'] }, null, 2));
  });
  test.afterAll(async () => { await context?.close(); await server?.close(); if (temporary) await rm(temporary, { recursive: true, force: true }); });
  test.beforeEach(async () => { await reset(); server.reset(); });
  registerStorageRegressions(test,expect,()=>({driver,message,openContent,probeWorker}));

  test('Production messages persist consent and actual lookup / late Rich / idempotent artifacts; restart keeps exact rows', async () => {
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


  test('Production two-tab snapshots, no-hit and completed assistant remain actual rows; Content gets only its minimal page projection', async () => {
    const state = await message(M.GET_RECORDING_STATE); await message(M.SET_RECORDING, { expectedConsentGeneration: state.data.consentGeneration });
    const first = await openContent(), second = await openContent();
    await center.evaluate(() => { globalThis.__notifications=[]; globalThis.__historyPort=chrome.runtime.connect({name:'reading.invalidate'}); __historyPort.onMessage.addListener((value)=>__notifications.push(value)); });
    await expect.poll(()=>center.evaluate(()=>__notifications.length)).toBeGreaterThan(0);
    const initialRevision=await center.evaluate(()=>__notifications.at(-1).catalogRevision);
    async function lookup(content, kind = 'dictionary', recordId = null, recordRevision = null, purpose = 'lookup') {
      const operationId = crypto.randomUUID(); const prepared = await content.send(request(M.BEGIN_QUERY, { operationId, pageKey: content.registration.pageKey,
        sourceSnapshot: content.snap, recordId, recordRevision, purpose })); expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      const value = artifact(kind, { artifactId: crypto.randomUUID(), recordId: prepared.data.token.recordId, operationId, sourceSnapshotId: content.snap.sourceSnapshotId,
        ...(kind === 'dictionary' ? { payload: { outcome: 'no-hit', headword: 'React', phonetic: '', partOfSpeech: '', definitions: [] }, provenance: [] } : {}) });
      const saved = await content.send(request(kind === 'assistant' ? M.APPEND_ASSISTANT : M.SAVE_QUERY_RESULT, { token: prepared.data.token, artifact: value }));
      expect(saved.ok, JSON.stringify(saved)).toBe(true); return saved.data;
    }
    const [a, b] = await Promise.all([lookup(first), lookup(second, 'translation')]); expect(a.recordId).not.toBe(b.recordId);
    const ai = await lookup(first, 'assistant', a.recordId, a.revision, 'assistant');
    const newLookup = await lookup(first, 'translation', a.recordId, ai.revision);
    const detail = await message(M.GET_RECORD, { recordId: a.recordId }); expect(detail.data.record.lookupCount).toBe(2); expect(detail.data.artifacts).toHaveLength(3);
    const summary = await first.send(request(M.GET_PAGE_SUMMARY, { limit: 100 })); expect(summary.ok).toBe(true); expect(summary.data.pageRecordCount).toBe(2);
    expect(summary.data.items.find((item) => item.recordId === a.recordId).hasCompletedAssistant).toBe(true);
    for (const item of summary.data.items) expect(Object.keys(item).sort()).toEqual(['anchor', 'hasCompletedAssistant', 'recordId', 'revision']);
    const minimal = await first.send(request(M.GET_RECORDING_STATE)); expect(Object.keys(minimal.data).sort()).toEqual(['capacityReached', 'consentGeneration', 'enabled']);
    const list = await message(M.LIST_RECORDS, { query: '', limit: 100 }); expect(list.data.items).toHaveLength(2);
    expect(list.data.items.find((item) => item.recordId === a.recordId)).toMatchObject({ assistantTurnCount: 1, hasCompletedAssistant: true,
      resultPreview: { sourceSnapshotId: first.snap.sourceSnapshotId }, contextPreview: first.snap.contextText });
    const pages = await message(M.LIST_PAGES); expect(pages.data.items).toHaveLength(1); expect(pages.data.items[0].recordCount).toBe(2);
    expect((await message(M.LIST_RECORDS, { query: '^React.*' })).data.items).toHaveLength(0);
    expect((await message(M.LIST_RECORDS, { query: 'React' })).data.items).toHaveLength(2);
    await expect.poll(()=>center.evaluate(()=>__notifications.at(-1).catalogRevision)).toBeGreaterThan(initialRevision);
    const notifications=await center.evaluate(()=>__notifications); for(const value of notifications) expect(Object.keys(value).sort()).toEqual(['catalogRevision','consentGeneration','dataGeneration','protocolVersion','type']);
    await center.evaluate(()=>__historyPort.disconnect()); expect(server.calls).toHaveLength(0); await first.page.close(); await second.page.close();
  });

  test('Production digest barrier proves pause-before-write rejects actual late save while committed history stays readable', async () => {
    const state = await message(M.GET_RECORDING_STATE); await message(M.SET_RECORDING, { expectedConsentGeneration: state.data.consentGeneration });
    const content = await openContent(), operationId = crypto.randomUUID();
    const prepared = await content.send(request(M.BEGIN_QUERY, { operationId, pageKey: content.registration.pageKey, sourceSnapshot: content.snap })); expect(prepared.ok).toBe(true);
    await worker.evaluate(() => { globalThis.__originalDigest = SubtleCrypto.prototype.digest; globalThis.__digestGateEntered = false;
      globalThis.__digestGate = new Promise((resolve) => { globalThis.__releaseDigest = resolve; });
      SubtleCrypto.prototype.digest = async function(algorithm, bytes) { if (new TextDecoder().decode(bytes).includes('barrier-artifact')) {
        globalThis.__digestGateEntered = true; await globalThis.__digestGate; } return globalThis.__originalDigest.call(this, algorithm, bytes); }; });
    const value = artifact('dictionary', { artifactId: 'barrier-artifact', recordId: prepared.data.token.recordId, operationId, sourceSnapshotId: content.snap.sourceSnapshotId });
    const pending = content.send(request(M.SAVE_QUERY_RESULT, { token: prepared.data.token, artifact: value }));
    await expect.poll(() => worker.evaluate(() => __digestGateEntered)).toBe(true);
    const beforePause = await message(M.GET_RECORDING_STATE); const paused = await message(M.SET_RECORDING, { enabled: false, expectedConsentGeneration: beforePause.data.consentGeneration }); expect(paused.ok).toBe(true);
    await worker.evaluate(() => { __releaseDigest(); SubtleCrypto.prototype.digest = __originalDigest; });
    const denied = await pending; expect(denied.error.code).toBe(E.STALE_OPERATION);
    expect((await message(M.LIST_RECORDS, { query: '' })).data.items).toHaveLength(0); expect((await message(M.GET_RECORDING_STATE)).data.enabled).toBe(false);
    await content.page.close();
  });
  test('Native canonical pagination traverses over 128 pages without capacity leakage or duplicate IDs', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; await p.seedRecords(3900); const ids = []; let cursor = null, pages = 0;
      do { const page = await p.repo.read(p.ctx(p.M.LIST_RECORDS, { query: '', limit: 30, cursor })); ids.push(...page.items.map((item) => item.recordId)); cursor = page.nextCursor; pages++; } while (cursor);
      return { count: ids.length, unique: new Set(ids).size, pages }; });
    expect(result).toEqual({ count: 3900, unique: 3900, pages: 130 });
  });


  test('Native list cursors reject caller scope/query changes, duplicate concurrent consumption and reuse; viewed preserves a chain', async () => {
    const result=await probeWorker.evaluate(async()=>{const p=__probe;await p.seedRecords(200);const first=await p.repo.read(p.ctx(p.M.LIST_RECORDS,{query:'',limit:30}));
      const make=(cursor,extra={})=>p.ctx(p.M.LIST_RECORDS,{query:'',limit:30,cursor,...extra}); const errors=[];
      for(const input of [make(first.nextCursor,{query:'wrong'}),{...make(first.nextCursor),access:p.access('extension',{ownerKey:'other-owner'})}]) {try{await p.repo.read(input);}catch(error){errors.push(error.code);}}
      await p.repo.read(p.ctx(p.M.GET_RECORD,{recordId:first.items[0].recordId}));
      const parallel=await Promise.allSettled([p.repo.read(make(first.nextCursor)),p.repo.read(make(first.nextCursor))]);
      try{await p.repo.read(make(first.nextCursor));}catch(error){errors.push(error.code);}
      return {errors,parallel:parallel.map((item)=>item.status==='fulfilled'?'success':item.reason.code),secondCount:parallel[0].value?.items.length};
    });expect(result).toEqual({errors:Array(3).fill(E.STALE_OPERATION),parallel:['success',E.STALE_OPERATION],secondCount:30});
  });

  test('Native operation receipts and expired origin tombstones stay bounded without resurrecting old tokens', async () => {
    const result=await probeWorker.evaluate(async()=>{const p=__probe, start=Date.now()+p.L.operationTtlMs+1;p.clock=start;await p.enable(p.repo);const operations=[];
      for(let n=0;n<p.L.operationsGlobal;n++){const op=await p.begin(p.repo);await p.save(p.repo,op);operations.push(op);}
      const overflowing=await p.begin(p.repo);let capacity;try{await p.save(p.repo,overflowing);}catch(error){capacity=error.code;}
      const full=await p.counts();await p.repo.mutate(p.ctx(p.M.DELETE_RECORD,{recordId:operations[0].token.recordId,expectedRevision:1}));
      p.clock=start+p.L.operationTtlMs+1;const fresh=await p.begin(p.repo);await p.save(p.repo,fresh);let stale;try{await p.save(p.repo,operations[0]);}catch(error){stale=error.code;}
      const after=await p.counts();return{capacity,fullReceipts:full.receipts,fullRecords:full.records,stale,afterReceipts:after.receipts,sites:after.meta.sites.length,afterRecords:after.records};
    });expect(result).toEqual({capacity:E.CAPACITY,fullReceipts:128,fullRecords:128,stale:E.STALE_OPERATION,afterReceipts:1,sites:1,afterRecords:128});
  });
  test('Native excluded origins stay bounded at 200 with same-origin revision protection', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; const errors = [];
      for (let n = 0; n < 201; n++) { const siteKey = `https://site-${n}.example.test`; const current = await p.repo.read(p.ctx(p.M.GET_SITE_RECORDING, { siteKey }));
        try { await p.repo.mutate(p.ctx(p.M.SET_SITE_RECORDING, { siteKey, excluded: true, expectedSitePolicyRevision: current.sitePolicyRevision })); } catch (error) { errors.push(error.code); } }
      const list = await p.repo.read(p.ctx(p.M.LIST_RECORDING_EXCLUSIONS, { limit: 100 })); return { errors, firstPage: list.items.length, next: !!list.nextCursor }; });
    expect(result).toEqual({ errors: [E.CAPACITY], firstPage: 100, next: true });
  });
  test('Native final transaction guards abort without orphans; receipts survive lost ACK and cancellation preserves a committed result', async () => {
    const result = await probeWorker.evaluate(async () => {
      const p = __probe; await p.enable(p.repo); const op = await p.begin(p.repo); const beforeAbort=await p.counts(); let abort = false;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, key) { const request = arguments.length > 1 ? put.call(this, value, key) : put.call(this, value);
        if (this.name === 'records') abort = true; return request; };
      let error;
      try { await p.save(p.repo, op, 'dictionary', {}, { assertCurrent() { if (abort) throw new Error('native authority revoked at final guard'); } }); } catch (caught) { error = caught.code; }
      finally { IDBObjectStore.prototype.put = put; }
      const afterAbort = await p.counts();
      p.repo.setInvalidationPublisher(() => { throw new Error('synthetic delivery failure after commit'); });
      const value = p.artifact('dictionary', { recordId: op.token.recordId, operationId: op.token.operationId, artifactId: 'lost-ack' });
      const saved = await p.save(p.repo, op, 'dictionary', value); // Intentionally discard delivery; data must already be committed.
      const retry = await p.save(p.repo, op, 'dictionary', value);
      const cancelled = await p.repo.cancelOperation({ ...p.ctx(p.M.CANCEL_OPERATION), access: op.access, registeredOperation: op });
      const detail = await p.repo.read(p.ctx(p.M.GET_RECORD, { recordId: saved.recordId }));
      return { error, beforeAbort: {records:beforeAbort.records,snapshots:beforeAbort.snapshots,artifacts:beforeAbort.artifacts,receipts:beforeAbort.receipts}, afterAbort: { records: afterAbort.records, snapshots: afterAbort.snapshots, artifacts: afterAbort.artifacts, receipts: afterAbort.receipts },
        saved, retry, cancelled, lookupCount: detail.record.lookupCount, artifacts: detail.artifacts.length };
    });
    expect(result.error).toBe(E.STORAGE); expect(result.beforeAbort).toMatchObject({ records:0,snapshots:0,artifacts:0 }); expect(result.afterAbort).toEqual(result.beforeAbort);
    expect(result.retry).toEqual({ ...result.saved, duplicate: true }); expect(result.cancelled).toMatchObject({ state: 'committed', recordId: result.saved.recordId });
    expect(result.lookupCount).toBe(1); expect(result.artifacts).toBe(1);
  });

  test('Native pause/resume, site exclusion/resume, empty page deletion and empty clear never revive old first-save tokens', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe, failures = [];
      await p.enable(p.repo);
      for (const change of ['pause', 'site', 'page', 'clear', 'cancel']) {
        const op = await p.begin(p.repo);
        if (change === 'pause') { const state = await p.repo.read(p.ctx(p.M.GET_RECORDING_STATE)); const paused = await p.repo.mutate(p.ctx(p.M.SET_RECORDING, { enabled: false, expectedConsentGeneration: state.consentGeneration }));
          await p.repo.mutate(p.ctx(p.M.SET_RECORDING, { enabled: true, expectedConsentGeneration: paused.consentGeneration })); }
        if (change === 'site') { const siteKey = op.access.siteKey; const current = await p.repo.read(p.ctx(p.M.GET_SITE_RECORDING, { siteKey }));
          const excluded = await p.repo.mutate(p.ctx(p.M.SET_SITE_RECORDING, { siteKey, excluded: true, expectedSitePolicyRevision: current.sitePolicyRevision }));
          await p.repo.mutate(p.ctx(p.M.SET_SITE_RECORDING, { siteKey, excluded: false, expectedSitePolicyRevision: excluded.sitePolicyRevision })); }
        if (change === 'page') await p.repo.mutate(p.ctx(p.M.DELETE_PAGE));
        if (change === 'clear') { const state = await p.repo.read(p.ctx(p.M.GET_RECORDING_STATE)); await p.repo.mutate(p.ctx(p.M.CLEAR_RECORDS, { expectedDataGeneration: state.dataGeneration })); }
        if (change === 'cancel') await p.repo.cancelOperation({ ...p.ctx(p.M.CANCEL_OPERATION), access: op.access, registeredOperation: op });
        try { await p.save(p.repo, op); failures.push('unexpected success'); } catch (error) { failures.push(error.code); }
      }
      const counts = await p.counts(); return { failures, records: counts.records, enabled: counts.meta.enabled, dataGeneration: counts.meta.dataGeneration };
    });
    expect(result.failures).toEqual(Array(5).fill(E.STALE_OPERATION)); expect(result.records).toBe(0); expect(result.enabled).toBe(true); expect(result.dataGeneration).toBeGreaterThan(1);
  });


  test('Native late Rich preserves the latest lookup page metadata rather than replacing it with an older record', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; await p.enable(p.repo);
      const old = await p.begin(p.repo, {access:p.access('content', {pageTitle:'Old title'})}); await p.save(p.repo, old);
      p.clock=2000; const newer=await p.begin(p.repo, {access:p.access('content', {pageTitle:'New title'})}); await p.save(p.repo, newer);
      p.clock=3000; await p.save(p.repo, old, 'translation'); const page=await p.repo.read(p.ctx(p.M.LIST_PAGES));
      return {count:page.items[0].recordCount,title:page.items[0].pageTitle,last:page.items[0].lastLookupAt};
    }); expect(result).toEqual({count:2,title:'New title',last:2000});
  });
  test('Native real 10k capacity rejects new records but permits existing append; delete deducts exact canonical bytes without orphans', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; const seeded = await p.seedRecords(p.L.records); const existing = await p.begin(p.repo, { recordId: seeded.recordId, recordRevision: 1 });
      const appended = await p.save(p.repo, existing, 'translation'); const fresh = await p.begin(p.repo); let rejected;
      try { await p.save(p.repo, fresh); } catch (error) { rejected = error.code; }
      const before = await p.counts(); const detail = await p.repo.read(p.ctx(p.M.GET_RECORD, { recordId: appended.recordId }));
      await p.repo.mutate(p.ctx(p.M.DELETE_RECORD, { recordId: appended.recordId, expectedRevision: detail.record.revision }));
      const after = await p.counts(); const replacement = await p.begin(p.repo); await p.save(p.repo, replacement);
      return { rejected, appended: appended.state, beforeCount: before.records, afterCount: after.records, afterSnapshots: after.snapshots,
        afterArtifacts: after.artifacts, deducted: before.meta.totalBytes > after.meta.totalBytes, recovered: (await p.counts()).records };
    });
    expect(result).toEqual({ rejected: E.CAPACITY, appended: 'saved', beforeCount: 10000, afterCount: 9999, afterSnapshots: 9999, afterArtifacts: 9999, deducted: true, recovered: 10000 });
  });

  test('Native Unicode stream allows one record over 1MiB across bounded chunks, final revision guards and viewed catalog continuity', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; const seeded = await p.seedRecords(1, { answerChars: 23997, artifacts: 24 });
      const exported = await p.exportAll(p.repo, { chunkBytes: 16001 }); const parsed = JSON.parse(exported.text);
      const started = await p.repo.openExport(p.ctx(p.M.EXPORT_START)); const first = await p.repo.readExportChunk({ ...p.ctx(p.M.EXPORT_NEXT), ...started,
        sequence: 0, maxChunkBytes: p.L.exportChunkBytes });
      const before = await p.counts(); const detail = await p.repo.read(p.ctx(p.M.GET_RECORD, { recordId: seeded.recordId })); const after = await p.counts();
      let changed; try { await p.repo.checkExport({ ...p.ctx(p.M.EXPORT_NEXT), exportRevision: started.exportRevision }); } catch (error) { changed = error.code; }
      return { bytes: exported.bytes, chunks: exported.chunks, artifacts: parsed.records[0].artifacts.length, answer: parsed.records[0].artifacts[0].payload.assistantAnswer,
        changed, catalogSame: before.meta.catalogRevision === after.meta.catalogRevision, exportChanged: before.meta.exportRevision < after.meta.exportRevision,
        firstRaw: new TextEncoder().encode(first.jsonChunk).length, lookupCount: detail.record.lookupCount };
    });
    expect(result.bytes).toBeGreaterThan(1024 * 1024); expect(result.chunks).toBeGreaterThan(64); expect(result.artifacts).toBe(24);
    expect(result.answer).toBe('😀中'.repeat(7999)); expect(result.changed).toBe(E.INTERRUPTED); expect(result.catalogSame).toBe(true); expect(result.exportChanged).toBe(true);
    expect(result.firstRaw).toBeLessThanOrEqual(256 * 1024); expect(result.lookupCount).toBe(1);
  });

  test('Production export retries exact chunk, rejects wrong cursors and interruption; EOF finish acknowledges actual revision only', async () => {
    await probeWorker.evaluate(async () => { await __probe.seedRecords(1, { answerChars: 23997, artifacts: 24 }); });
    const started = await message(M.EXPORT_START); expect(started.ok, JSON.stringify(started)).toBe(true);
    expect((await message(M.EXPORT_NEXT, { exportId: started.data.exportId, cursor: 'unknown-cursor' })).error.code).toBe(E.INTERRUPTED);
    let cursor = started.data.nextCursor, sequence = -1, all = ''; let chunks = 0;
    do {
      const response = await message(M.EXPORT_NEXT, { exportId: started.data.exportId, cursor }); expect(response.ok, JSON.stringify(response)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(1024 * 1024); expect(Buffer.byteLength(response.data.jsonChunk)).toBeLessThanOrEqual(256 * 1024);
      expect((await message(M.EXPORT_NEXT, { exportId: started.data.exportId, cursor })).data).toEqual(response.data);
      all += response.data.jsonChunk; sequence = response.data.sequence; cursor = response.data.nextCursor; chunks++;
    } while (cursor);
    expect(chunks).toBeGreaterThan(4); expect(JSON.parse(all).records[0].artifacts).toHaveLength(24);
    expect((await message(M.EXPORT_FINISH, { exportId: started.data.exportId, sequence })).data.state).toBe('finished');
    expect((await message(M.EXPORT_CANCEL, { exportId: started.data.exportId })).data.state).toBe('finished');
    const second = await message(M.EXPORT_START); expect(second.ok).toBe(true);
    const state = await message(M.GET_RECORDING_STATE); await message(M.CLEAR_RECORDS, { expectedDataGeneration: state.data.dataGeneration });
    expect((await message(M.EXPORT_NEXT, { exportId: second.data.exportId, cursor: second.data.nextCursor })).error.code).toBe(E.INTERRUPTED);
    const cancelled = await message(M.EXPORT_START); expect(cancelled.ok).toBe(true);
    expect((await message(M.EXPORT_CANCEL, { exportId: cancelled.data.exportId })).data.state).toBe('cancelled');
    expect((await message(M.EXPORT_FINISH, { exportId: cancelled.data.exportId, sequence: 0 })).error.code).toBe(E.INTERRUPTED);
    const interrupted = await message(M.EXPORT_START); const interruptedId = interrupted.data.exportId;
    await context.close(); await launch();
    expect((await message(M.EXPORT_NEXT, { exportId: interruptedId, cursor: interrupted.data.nextCursor })).error.code).toBe(E.INTERRUPTED);
  });

  test('Native near-64MiB actual canonical rows stream without a library copy; byte overrun rejects and recovery uses delete', async () => {
    const result = await probeWorker.evaluate(async () => { const p = __probe; const unit = await p.seedRecords(1, { answerChars: 23997 }); const seeded = await p.seedRecords(Math.floor((p.L.totalBytes - 65536) / unit.totalBytes), { answerChars: 23997 });
      let checksum = 0; const exported = await p.exportAll(p.repo, { consume: (chunk) => { checksum += chunk.length; } });
      const op = await p.begin(p.repo); const saved = await p.save(p.repo, op); const before = await p.counts();
      const pending = await p.begin(p.repo, { purpose: 'assistant', recordId: saved.recordId, recordRevision: saved.revision }); let rejected;
      for (let n = 0; n < 256; n++) {
        try { await p.save(p.repo, pending, 'assistant', { artifactId: `large-${n}`, payload: { ...p.artifact('assistant').payload, turnId: `large-turn-${n}`, threadId: `large-thread-${n}`,
          assistantAnswer: '😀中'.repeat(7999) } }); } catch (error) { rejected = error.code; break; }
      }
      const full = await p.counts(); await p.repo.mutate(p.ctx(p.M.DELETE_PAGE)); const after = await p.counts();
      return { totalBytes: seeded.totalBytes, exportedBytes: exported.bytes, chunks: exported.chunks, checksum, textRetained: exported.text.length,
        rejected, enabled: full.meta.enabled, withinBudget: full.meta.totalBytes <= p.L.totalBytes, beforeCount: before.records, afterCount: after.records, afterBytes: after.meta.totalBytes };
    });
    expect(result.totalBytes).toBeGreaterThan(62 * 1024 * 1024); expect(result.totalBytes).toBeLessThan(64 * 1024 * 1024);
    expect(result.exportedBytes).toBeGreaterThan(result.totalBytes); expect(result.chunks).toBeGreaterThan(250); expect(result.checksum).toBeGreaterThan(0); expect(result.textRetained).toBe(0);
    expect(result.rejected).toBe(E.CAPACITY); expect(result.enabled).toBe(true); expect(result.withinBudget).toBe(true); expect(result.afterCount).toBe(0); expect(result.afterBytes).toBe(0);
    await writeFile(test.info().outputPath('near-capacity-native.json'), JSON.stringify(result));
  });



  test('Native localhost-IDB quota refusal uses the same direct-source repository; prior read/delete/export remain available', async () => {
    // Chrome extension origin ignores the CDP quota override (retained FAIL evidence). This separate engine probe has synthetic authority.
    const routes = new Map(inventory.map((item) => [`/${item.file}`, join(extension, 'storage-probe', item.file)]));
    routes.set('/worker.mjs', join(extension, 'storage-probe/worker.mjs'));
    const host = createServer(async (incoming, response) => {
      if (incoming.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Synthetic native quota engine probe</title>'); return; }
      const path = routes.get(incoming.url); if (!path) { response.statusCode = 404; response.end(); return; }
      try { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(path)); } catch { response.statusCode = 500; response.end(); }
    });
    await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve)); const quotaOrigin = `http://127.0.0.1:${host.address().port}`;
    let page = await context.newPage(); await page.goto(quotaOrigin); let cdp = await context.newCDPSession(page);
    const waiting = page.waitForEvent('worker'); await page.evaluate(() => { globalThis.__worker = new Worker('/worker.mjs', {type:'module'}); });
    let native = await waiting; await expect.poll(() => native.evaluate(() => !!globalThis.__probe)).toBe(true);
    const old = await native.evaluate(async () => { const p = __probe; await p.enable(p.repo); const op = await p.begin(p.repo); const saved = await p.save(p.repo, op);
      globalThis.__quotaPending = await p.begin(p.repo); return saved; });
    const pending = await native.evaluate(() => __quotaPending); await cdp.detach(); await context.close(); await launch();
    page = await context.newPage(); await page.goto(quotaOrigin); cdp = await context.newCDPSession(page);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: quotaOrigin, quotaSize: 65536 });
    try {
      const freshWorker = page.waitForEvent('worker'); await page.evaluate(() => { globalThis.__worker = new Worker('/worker.mjs', {type:'module'}); });
      native = await freshWorker; await expect.poll(() => native.evaluate(() => !!globalThis.__probe)).toBe(true);
      await native.evaluate((value) => { globalThis.__quotaPending = value; }, pending);
      const result = await native.evaluate(async () => { const p = __probe; let refused;
        try { await p.save(p.repo, __quotaPending, 'translation', {payload:{text:'😀中'.repeat(7999)}}); } catch (error) { refused = error.code; }
        const counts = await p.counts(), items = await p.repo.read(p.ctx(p.M.LIST_RECORDS, { query: '' }));
        const detail = await p.repo.read(p.ctx(p.M.GET_RECORD, { recordId: items.items[0].recordId })); const exported = await p.exportAll(p.repo);
        await p.repo.mutate(p.ctx(p.M.DELETE_RECORD, { recordId: detail.record.recordId, expectedRevision: detail.record.revision }));
        return { refused, enabled: counts.meta.enabled, oldRows: counts.records, exported: JSON.parse(exported.text).records.length, afterDelete: (await p.counts()).records };
      });
      await writeFile(test.info().outputPath('quota-native.json'), JSON.stringify({ scope:'localhost native-IDB; synthetic authority; not compiled extension quota', old, result,
        quota: await cdp.send('Storage.getUsageAndQuota', { origin: quotaOrigin }), estimate: await native.evaluate(() => navigator.storage.estimate()) }));
      expect(result).toEqual({ refused: E.QUOTA, enabled: true, oldRows: 1, exported: 1, afterDelete: 0 });
    } finally { await cdp.send('Storage.overrideQuotaForOrigin', { origin: quotaOrigin }); await cdp.detach(); await page.close(); await new Promise((resolve) => host.close(resolve)); }
  });

  test('Native blocked upgrade and versionchange close preserve existing rows; unknown future version refuses without resetting cache or OPFS', async () => {
    const before = await probeWorker.evaluate(async () => { const p = __probe; await p.enable(p.repo); const op = await p.begin(p.repo); await p.save(p.repo, op);
      const directory = await navigator.storage.getDirectory(), file = await directory.getFileHandle('reading-owned-preservation-fixture', { create: true });
      const writable = await file.createWritable(); await writable.write('synthetic OPFS sentinel'); await writable.close();
      const dbs = await indexedDB.databases(); return { counts: await p.counts(), oldCache: dbs.find((db) => db.name === 'ai_bilingual_translator') || null };
    });
    const blocked = await probeWorker.evaluate(async () => { const p = __probe; globalThis.__held = await p.rawDatabase();
      globalThis.__held.onversionchange = () => { globalThis.__versionChangeSeen = true; };
      globalThis.__upgradeComplete = new Promise((resolve, reject) => { const request = indexedDB.open(p.READING_DATABASE, 2);
        request.onupgradeneeded = () => { request.result.createObjectStore('future-fixture').put('future sentinel', 'marker'); };
        request.onsuccess = () => { request.result.close(); resolve(true); }; request.onerror = () => reject(request.error);
        globalThis.__blocked = new Promise((notify) => { request.onblocked = () => notify(true); });
      });
      return await globalThis.__blocked;
    }); expect(blocked).toBe(true);
    expect(await probeWorker.evaluate(async () => { __held.close(); return await __upgradeComplete; })).toBe(true);
    const result = await probeWorker.evaluate(async () => { const p = __probe; let refused;
      try { await p.repo.read(p.ctx(p.M.GET_RECORDING_STATE)); } catch (error) { refused = error.code; }
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(p.READING_DATABASE); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const rows = await new Promise((resolve, reject) => { const tx = db.transaction(['records','meta','future-fixture'], 'readonly'), result = {};
        const count = tx.objectStore('records').count(); count.onsuccess = () => { result.records = count.result; };
        const meta = tx.objectStore('meta').get('state'); meta.onsuccess = () => { result.meta = meta.result; };
        const marker = tx.objectStore('future-fixture').get('marker'); marker.onsuccess = () => { result.marker = marker.result; };
        tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error);
      }); db.close(); const directory = await navigator.storage.getDirectory(), file = await directory.getFileHandle('reading-owned-preservation-fixture');
      const dbs = await indexedDB.databases(); return { refused, versionChange: !!globalThis.__versionChangeSeen, rows,
        opfs: await (await file.getFile()).text(), oldCache: dbs.find((db) => db.name === 'ai_bilingual_translator') || null };
    });
    expect(result.refused).toBe(E.UNSUPPORTED_VERSION); expect(result.versionChange).toBe(true); expect(result.rows.records).toBe(1);
    expect(result.rows.meta).toEqual(before.counts.meta); expect(result.rows.marker).toBe('future sentinel'); expect(result.opfs).toBe('synthetic OPFS sentinel'); expect(result.oldCache).toEqual(before.oldCache);
  });

});
