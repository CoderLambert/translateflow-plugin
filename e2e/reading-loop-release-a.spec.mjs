import { test, expect, chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { startMockServer } from './support/mock-server.mjs';
import { prepareExtensionTestCopy } from './support/production-artifact.mjs';
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from '../src/shared/constants.js';
import { READING_METHOD as M, READING_LIMITS as L } from '../src/shared/reading/constants.js';
import { sourceClosure } from '../scripts/wxt-assets.mjs';
import { fingerprint } from '../scripts/local-task.mjs';
const root = resolve(import.meta.dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function environment(info) {
  const temp = await mkdtemp(join(tmpdir(), 'tf-reading-loop-a-')), extension = join(temp, 'extension'), profile = join(temp, 'profile');
  const server = await startMockServer();
  const build = await prepareExtensionTestCopy({ extensionDir: extension, lexiconPacks: 'fixture', baseUrl: server.baseUrl });
  let context, driver, id;
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium', args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    id = new URL(worker.url()).host;
    driver = await context.newPage(); await driver.goto(`chrome-extension://${id}/popup.html`);
  }
  await launch();
  return { temp, extension, server, build,
    get context() { return context; }, get driver() { return driver; }, get id() { return id; },
    async restart() { await context.close(); await launch(); },
    async center(hash = '') { const page = await context.newPage(); await page.goto(`chrome-extension://${id}/learning-center.html${hash}`); return page; },
    async openContent() {
      const page = await context.newPage(); await page.goto(`${server.baseUrl}/article`);
      const title = `Synthetic Release A ${crypto.randomUUID()}`;
      await page.evaluate(title => { document.title = title; document.body.innerHTML = '<main><p id="first">PUBLIC session alpha session tail</p><p id="sentence">This is a synthetic ordinary sentence.</p><p id="miss">zzsyntheticmissing</p></main>'; }, title);
      const tabId = await driver.evaluate(async title => (await chrome.tabs.query({})).find(tab => tab.title === title).id, title);
      await driver.evaluate(async ({ tabId, files, css }) => { await chrome.scripting.insertCSS({ target: { tabId }, files: css }); await chrome.scripting.executeScript({ target: { tabId }, files }); }, { tabId, files: [...CONTENT_SCRIPT_FILES], css: [...CONTENT_STYLE_FILES] });
      return { page, tabId };
    },
    async fixture() {
      const files = await sourceClosure(['tests/fixtures/reading/storage.mjs']);
      for (const file of files) {
        const target = join(extension, file), original = join(root, file);
        try { expect(await readFile(target)).toEqual(await readFile(original)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(dirname(target), { recursive: true }); await cp(original, target); }
      }
      return files;
    },
    async report(name, data) {
      await writeFile(info.outputPath(name), JSON.stringify({ browser: context.browser().version(), artifactFingerprint: fingerprint(root, '.output/chrome-mv3'),
        backgroundUnchanged: sha(await readFile(join(extension, 'background.js'))) === sha(await readFile(join(root, '.output/chrome-mv3/background.js'))),
        productionInventorySha256: build.treeSha256, ...data }, null, 2));
    },
    async close() { await context?.close(); await server.close(); await rm(temp, { recursive: true, force: true }); }
  };
}
const send = (page, method, body = {}) => page.evaluate(input => chrome.runtime.sendMessage(input), { protocolVersion: 2, method, ...body });
async function query(page, selector, text, occurrence = 0) {
  await page.evaluate(({ selector, text, occurrence }) => {
    const node = document.querySelector(selector).firstChild; let start = -1;
    for (let i = 0; i <= occurrence; i++) start = node.nodeValue.indexOf(text, start + 1);
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
    getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event('selectionchange'));
  }, { selector, text, occurrence });
  await expect(page.locator('.tf-selection-chip')).toBeVisible(); await page.locator('.tf-selection-chip').click();
}
async function details(center) {
  const list = await send(center, M.LIST_RECORDS, { pageKey: null, query: '', cursor: null, limit: 30 }); expect(list.ok).toBe(true);
  return Promise.all(list.data.items.map(async item => { const value = await send(center, M.GET_RECORD, { recordId: item.recordId }); expect(value.ok).toBe(true); return value.data; }));
}
async function downloadJson(page) {
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const file = await waiting, stream = await file.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks); return { bytes, data: JSON.parse(bytes.toString('utf8')) };
}

test('Release A actual product: trusted creation matrix survives browser restart and missing dictionaries without Provider work', async ({}, info) => {
  test.setTimeout(120000); const env = await environment(info);
  try {
    await env.driver.evaluate(async baseUrl => chrome.storage.local.set({ uiLocale: 'en', provider: 'openai-compatible', targetLanguage: 'Simplified Chinese',
      prompt: 'Translate the segments and return JSON only.', appearance: 'standard', selectionExplanationDepth: 'standard',
      glossary: { version: 1, entries: [] }, siteGlossaries: { version: 1, sites: {} },
      openAICompatible: { baseUrl: `${baseUrl}/v1`, apiKey: '', model: 'mock-model' }, autoSites: [], cacheRestoreSites: [], siteProfiles: {} }), env.server.baseUrl);
    let center = await env.center(); const content = await env.openContent();
    await query(content.page, '#first', 'session'); await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'invite');
    expect(env.server.calls).toHaveLength(0); expect((await send(center, M.GET_RECORDING_STATE)).data.recordCount).toBe(0);
    const opened = env.context.waitForEvent('page'); await content.page.getByRole('button', { name: '在学习中心开启阅读记录' }).click(); const consent = await opened;
    await consent.getByRole('button', { name: 'Enable recording', exact: true }).click(); await expect(consent.getByRole('button', { name: 'Pause recording' })).toBeVisible();
    await content.page.bringToFront(); await content.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await content.page.getByRole('button', { name: '保存本次结果', exact: true }).click(); await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'saved');
    await query(content.page, '#miss', 'zzsyntheticmissing'); await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'saved'); expect(env.server.calls).toHaveLength(0);
    await query(content.page, '#sentence', 'This is a synthetic ordinary sentence.'); await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'saved'); expect(env.server.calls).toHaveLength(1);
    await content.page.getByRole('button', { name: '关闭', exact: true }).click();
    await query(content.page, '#sentence', 'This is a synthetic ordinary sentence.'); await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'saved'); expect(env.server.calls).toHaveLength(1);
    await query(content.page, '#first', 'session'); await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'saved');
    await content.page.getByRole('button', { name: '使用 AI 结合上下文详解' }).click(); await expect(content.page.locator('.tf-selection-ai-detail')).toHaveAttribute('data-state', 'success');
    await expect.poll(async () => (await details(center)).flatMap(value => value.artifacts).filter(artifact => artifact.kind === 'assistant').length).toBe(1);
    expect(env.server.calls).toHaveLength(2); const before = await details(center);
    expect(before.find(value => value.record.itemText === 'zzsyntheticmissing').artifacts[0].payload.outcome).toBe('no-hit');
    expect(before.find(value => value.record.itemText.startsWith('This is')).record.lookupCount).toBe(2);
    const immutable = before.map(({ record, snapshots, artifacts }) => ({ recordId: record.recordId, itemText: record.itemText, lookupCount: record.lookupCount, snapshots, artifacts }));
    await env.driver.evaluate(() => chrome.storage.local.remove(['provider', 'openAICompatible']));
    await rm(join(env.extension, 'assets/lexicon'), { recursive: true, force: true });
    await env.restart(); await env.context.setOffline(true); center = await env.center();
    const callsBeforeHistory = env.server.calls.length, resources = [];
    center.on('request', request => { if (/^https?:|lexicon|\.mdd|\.mdx/.test(request.url())) resources.push(request.url()); });
    await expect(center.locator('.record-list .record')).toHaveCount(before.length);
    const after = await details(center);
    expect(after.map(({ record, snapshots, artifacts }) => ({ recordId: record.recordId, itemText: record.itemText, lookupCount: record.lookupCount, snapshots, artifacts }))).toEqual(immutable);
    for (const value of after) {
      await center.locator(`[data-record-id="${value.record.recordId}"]`).click(); await expect(center.getByRole('heading', { name: value.record.itemText, exact: true })).toBeVisible();
      for (const artifact of value.artifacts) {
        if (artifact.kind === 'assistant') { await expect(center.getByText(artifact.payload.userQuestion, { exact: true })).toBeVisible(); await expect(center.getByText(artifact.payload.assistantAnswer, { exact: true })).toBeVisible(); }
        else if (artifact.kind === 'translation') await expect(center.getByText(artifact.payload.text, { exact: true }).first()).toBeVisible();
      }
      await center.getByRole('button', { name: 'Back to records', exact: true }).click(); await expect(center.locator('.record-list .record')).toHaveCount(before.length);
    }
    expect(env.server.calls).toHaveLength(callsBeforeHistory); expect(resources).toEqual([]);
    await center.screenshot({ path: info.outputPath('release-a-restarted-real-history.png'), fullPage: true });
    await env.report('release-a-real-restart.json', { creation: 'shipped trusted Selection; no seed', records: immutable.length, kinds: [...new Set(before.flatMap(value => value.artifacts.map(artifact => artifact.kind)))],
      explicitProviderCalls: 2, historyProviderCalls: env.server.calls.length - callsBeforeHistory, historyResourceRequests: resources.length, browserRestart: true, dictionaryAssetsRemoved: true, providerUnconfigured: true, offline: true,
      immutableHistorySha256: sha(JSON.stringify(immutable)), fullQuestionAnswerRead: true });
  } finally { await env.close(); }
});

test('Release A actual UI streams a near-64 MiB canonical corpus and validates every bounded response and downloaded row', async ({}, info) => {
  test.setTimeout(180000); const env = await environment(info);
  try {
    const testOnlyFiles = await env.fixture(); const center = await env.center();
    const seeded = await center.evaluate(async limits => {
      const helpers = await import(chrome.runtime.getURL('tests/fixtures/reading/storage.mjs'));
      const answerText = '😀中文"\\\n'.repeat(2800);
      const unit = await helpers.seedRecords(1, { answerChars: 1, answerText });
      const count = Math.floor((limits.totalBytes - 65536) / unit.totalBytes);
      const full = await helpers.seedRecords(count, { answerChars: 1, answerText });
      return { ...full, answerText };
    }, L);
    expect(seeded.totalBytes).toBeGreaterThan(62 * 1024 * 1024); expect(seeded.totalBytes).toBeLessThan(L.totalBytes);
    await center.reload(); await expect(center.locator('.record-list .record')).toHaveCount(30);
    await center.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime); window.exportStats = { chunks: 0, maxMessageBytes: 0, totalChunkBytes: 0, sequences: [], methods: [] };
      chrome.runtime.sendMessage = async request => {
        const response = await send(request);
        if (request.method?.startsWith('reading.export-')) {
          const stats = window.exportStats; stats.methods.push(request.method);
          stats.maxMessageBytes = Math.max(stats.maxMessageBytes, new TextEncoder().encode(JSON.stringify(response)).byteLength);
          if (request.method === 'reading.export-next' && response.ok) { stats.chunks++; stats.totalChunkBytes += new TextEncoder().encode(response.data.jsonChunk).byteLength; stats.sequences.push(response.data.sequence); }
        }
        return response;
      };
    });
    const exported = await downloadJson(center); const stats = await center.evaluate(() => window.exportStats);
    expect(stats.maxMessageBytes).toBeLessThanOrEqual(1024 * 1024); expect(stats.chunks).toBeGreaterThan(250);
    expect(stats.sequences).toEqual(Array.from({ length: stats.chunks }, (_, index) => index));
    expect(stats.totalChunkBytes).toBe(exported.bytes.length); expect(exported.data.records).toHaveLength(seeded.count);
    for (const [index, detail] of exported.data.records.entries()) {
      expect(detail.record.recordId).toBe(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
      expect(detail.snapshots).toHaveLength(1); expect(detail.artifacts).toHaveLength(1);
      expect(detail.artifacts[0].recordId).toBe(detail.record.recordId); expect(detail.artifacts[0].sourceSnapshotId).toBe(detail.snapshots[0].sourceSnapshotId);
      expect(detail.artifacts[0].payload.assistantAnswer).toBe(seeded.answerText);
    }
    await expect(center.getByText('File generated; download initiated. Browser file saving is not confirmed.')).toBeVisible();
    await env.report('release-a-near-budget-export.json', { syntheticSeed: true, testOnlyFiles, storedBytes: seeded.totalBytes, downloadedBytes: exported.bytes.length, fileSha256: sha(exported.bytes), records: seeded.count, ...stats, everyRowAndSourceChecked: true });
  } finally { await env.close(); }
});

test('Release A worker termination and page exit discard partial exports; native capacity UI remains recoverable', async ({}, info) => {
  test.setTimeout(120000); const env = await environment(info);
  try {
    await env.fixture(); let center = await env.center();
    await center.evaluate(async () => (await import(chrome.runtime.getURL('tests/fixtures/reading/storage.mjs'))).seedRecords(1, { artifacts: 64, answerChars: 23997 }));
    await center.reload(); await expect(center.locator('.record-list .record')).toHaveCount(1);
    const cdp = await env.context.newCDPSession(center); let version;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { for (const candidate of versions) if (candidate.scriptURL === `chrome-extension://${env.id}/background.js` && candidate.runningStatus === 'running') version = candidate.versionId; });
    await cdp.send('ServiceWorker.enable'); await expect.poll(() => version).toBeTruthy();
    let downloads = 0; center.on('download', () => downloads++);
    await center.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime); let held = false;
      chrome.runtime.sendMessage = async request => { const response = await send(request);
        if (request.method === 'reading.export-next' && !held) { held = true; await new Promise(resolve => { window.releaseHeldChunk = resolve; }); }
        return response;
      };
    });
    await center.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect.poll(() => center.evaluate(() => Boolean(window.releaseHeldChunk))).toBe(true);
    await cdp.send('ServiceWorker.stopWorker', { versionId: version });
    await expect(center.getByText('Connection interrupted. Saved content cannot be confirmed. Retry to reconnect.')).toBeVisible();
    await center.evaluate(() => window.releaseHeldChunk());
    await expect(center.getByText('Export cancelled. No file was generated.')).toBeVisible();
    await expect(center.getByRole('button', { name: 'Pause recording', exact: true })).toBeVisible(); expect(downloads).toBe(0);
    await cdp.detach(); await center.close();
    center = await env.center();
    const exportId = await center.evaluate(async () => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.pendingExportId = null;
      chrome.runtime.sendMessage = async request => {
        const response = await send(request);
        if (request.method === 'reading.export-start' && response.ok) window.pendingExportId = response.data.exportId;
        if (request.method === 'reading.export-next') await new Promise(resolve => { window.releaseHeldChunk = resolve; });
        return response;
      };
      return true;
    }); expect(exportId).toBe(true);
    await center.getByRole('button', { name: 'Export JSON', exact: true }).click();
    await expect.poll(() => center.evaluate(() => Boolean(window.releaseHeldChunk))).toBe(true);
    const interruptedId = await center.evaluate(() => window.pendingExportId); await center.close();
    center = await env.center();
    const old = await send(center, M.EXPORT_NEXT, { exportId: interruptedId, cursor: 'not-owned' }); expect(old.ok).toBe(false); expect(downloads).toBe(0);
    await center.evaluate(async () => (await import(chrome.runtime.getURL('tests/fixtures/reading/storage.mjs'))).seedRecords(10000));
    await center.reload();
    await expect(center.getByText('Recording has stopped because storage is full. Delete or export records to continue.')).toBeVisible();
    await center.locator('.record-list .record').first().click(); await center.getByRole('button', { name: 'Delete record', exact: true }).click();
    await center.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(center.getByText('Recording has stopped because storage is full. Delete or export records to continue.')).toHaveCount(0);
    const recovered = await send(center, M.GET_RECORDING_STATE); expect(recovered.data.recordCount).toBe(9999); expect(recovered.data.enabled).toBe(true);
    await env.report('release-a-worker-exit-capacity.json', { syntheticCanonicalRows: true, workerStoppedViaCDP: true, interruptedDownloads: downloads, pageExitRevokesOwnedExport: true, maxRecordCount: 10000, recoveredRecordCount: 9999, enabledAfterDelete: true });
  } finally { await env.close(); }
});

test('Release A real DOM capture reports ten-sample sync/total timing and bounded giant/dynamic fallbacks', async ({}, info) => {
  test.setTimeout(60000); const env = await environment(info);
  try {
    const content = await env.openContent();
    const metrics = await env.driver.evaluate(async tabId => (await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
      const modules = globalThis.__TRANSLATE_FLOW_CONTENT__.modules;
      const capture = async () => {
        const node = document.querySelector('#first').firstChild, range = document.createRange();
        const offset = node.nodeValue.indexOf('session'); range.setStart(node, offset); range.setEnd(node, offset + 7);
        const start = performance.now(), result = modules.selectionSourceSnapshot.capture({ range, text: 'session', selectionGeneration: 1 });
        const syncMs = performance.now() - start, snapshot = await result.ready;
        return { syncMs, totalMs: performance.now() - start, status: snapshot.anchor.status, contextChars: snapshot.contextText.length, position: snapshot.anchor.position };
      };
      const input = { chars: document.body.textContent.length, nodes: document.body.querySelectorAll('*').length };
      const ordinary = []; for (let i = 0; i < 10; i++) ordinary.push(await capture());
      document.querySelector('#first').textContent = 'x'.repeat(1100000) + ' session tail';
      const giant = await capture(); document.querySelector('#first').textContent = 'PUBLIC session changed tail';
      const dynamic = await capture();
      return { input, ordinary, giant, dynamic, giantChars: 1100013, domSlicesBudgetMs: modules.textProjectionPolicy.limits.sliceMs };
    } }))[0].result, content.tabId);
    expect(metrics.ordinary.every(sample => sample.status === 'resolved' && sample.position !== null)).toBe(true);
    expect(metrics.ordinary.every(sample => sample.contextChars <= 900)).toBe(true);
    expect(metrics.giant.contextChars).toBeLessThanOrEqual(900); expect(metrics.giant.syncMs).toBeLessThan(100); expect(metrics.giant.status).not.toBe('resolved');
    expect(metrics.dynamic.status).toBe('resolved');
    await env.report('release-a-real-dom-timing.json', { ...metrics, method: 'native performance.now around shipped capture; hash completion included in total; no synthetic clock', machine: { platform: process.platform, arch: process.arch } });
  } finally { await env.close(); }
});

test('Release A extension-origin physical quota refusal preserves actual product read/export/delete recovery', async ({}, info) => {
  test.setTimeout(60000); const env = await environment(info);
  try {
    await env.fixture(); let center = await env.center();
    await center.evaluate(async () => (await import(chrome.runtime.getURL('tests/fixtures/reading/storage.mjs'))).seedRecords(1));
    await center.close();
    const cdp = await env.context.newCDPSession(env.driver); let version;
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { for (const candidate of versions) if (candidate.scriptURL === `chrome-extension://${env.id}/background.js` && candidate.runningStatus === 'running') version = candidate.versionId; });
    await cdp.send('ServiceWorker.enable'); await expect.poll(() => version).toBeTruthy();
    await cdp.send('ServiceWorker.stopWorker', { versionId: version });
    const origin = `chrome-extension://${env.id}`, beforeQuota = await cdp.send('Storage.getUsageAndQuota', { origin });
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: Math.ceil(beforeQuota.usage) + 32768 });
    const native = await env.driver.evaluate(async () => {
      let db, refusal = null, completed = false;
      try {
        db = await new Promise((resolve, reject) => { const request = indexedDB.open('synthetic-release-a-quota-probe', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('payload'); request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result); });
        await new Promise((resolve, reject) => { const tx = db.transaction('payload', 'readwrite');
          for (let n = 0; n < 16; n++) { const bytes = new Uint8Array(32768); crypto.getRandomValues(bytes); tx.objectStore('payload').put(bytes, n); }
          tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        }); completed = true;
      } catch (error) { refusal = error?.name || 'UNKNOWN'; }
      finally { db?.close(); }
      return { refusal, completed, incompressibleAttemptBytes: 16 * 32768 };
    });
    const quota = await cdp.send('Storage.getUsageAndQuota', { origin });
    center = await env.center(); await expect(center.locator('.record-list .record')).toHaveCount(1);
    const exported = await downloadJson(center); expect(exported.data.records).toHaveLength(1);
    await center.locator('.record-list .record').click(); await center.getByRole('button', { name: 'Delete record', exact: true }).click();
    await center.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(center.locator('.record-list .record')).toHaveCount(0);
    await env.report('release-a-extension-quota.json', { nativePhysicalQuota: native.refusal === 'QuotaExceededError' && !native.completed ? 'PASS' : 'NOT VERIFIED', beforeQuota, quota, ...native,
      actualProductReadExportDelete: true, syntheticProbeDatabaseOnly: true });
    await cdp.send('Storage.overrideQuotaForOrigin', { origin }); await cdp.detach();
    expect(native, 'Physical extension-origin quota must actually refuse an incompressible native IDB transaction; an accepted override alone is not quota evidence').toEqual({ refusal: 'QuotaExceededError', completed: false, incompressibleAttemptBytes: 16 * 32768 });
  } finally { await env.close(); }
});

test('Release A injected quota boundary is truthful/retryable; stored hostile answers and bilingual composition remain text-only', async ({}, info) => {
  test.setTimeout(60000); const env = await environment(info);
  try {
    let center = await env.center(); await center.getByRole('button', { name: 'Enable recording', exact: true }).click();
    await expect(center.getByRole('button', { name: 'Pause recording' })).toBeVisible();
    const worker = env.context.serviceWorkers()[0];
    await worker.evaluate(() => { globalThis.originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'records') throw new DOMException('synthetic quota boundary', 'QuotaExceededError'); return originalPut.apply(this, args); }; });
    const content = await env.openContent(); await query(content.page, '#first', 'session');
    await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'not-saved');
    await expect(content.page.getByText('本地空间不足，未确认保存；可整理空间后重试保存。')).toBeVisible();
    expect((await send(center, M.GET_RECORDING_STATE)).data.recordCount).toBe(0); expect(env.server.calls).toHaveLength(0);
    await worker.evaluate(() => { IDBObjectStore.prototype.put = originalPut; });
    await content.page.getByRole('button', { name: '重试保存', exact: true }).click();
    await expect(content.page.locator('.tf-selection-record-status')).toHaveAttribute('data-state', 'saved'); expect(env.server.calls).toHaveLength(0);
    await env.fixture();
    const hostile = '<script>window.releaseAEvil=true</script><img src="https://evil.invalid/remote.png" onerror="window.releaseAEvil=true"> 😀 " \\';
    await center.evaluate(async answerText => (await import(chrome.runtime.getURL('tests/fixtures/reading/storage.mjs'))).seedRecords(1, { answerChars: 1, answerText }), hostile);
    await center.reload(); const remote = []; center.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
    await center.locator('.record-list .record').click(); await expect(center.getByText(hostile, { exact: true })).toBeVisible();
    expect(await center.evaluate(() => Boolean(window.releaseAEvil))).toBe(false); expect(await center.locator('.artifact img,.artifact script').count()).toBe(0); expect(remote).toEqual([]);
    await center.keyboard.press('Escape'); await expect(center.locator('.record-list .record')).toHaveCount(1);
    await expect(center.locator('.record-list .record')).toBeFocused();
    await center.getByLabel('Search records', { exact: true }).fill('React');
    const composition = await center.getByLabel('Search records', { exact: true }).evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '阅' }));
      const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }); input.dispatchEvent(event);
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '阅读' })); return event.defaultPrevented;
    }); expect(composition).toBe(true);
    await center.getByRole('button', { name: 'Search records', exact: true }).click(); await expect(center.locator('.record-list .record')).toHaveCount(1);
    const before = await details(center);
    await center.evaluate(() => chrome.storage.local.set({ uiLocale: 'zh_CN' })); await expect(center.getByRole('heading', { name: '学习中心', exact: true })).toBeVisible();
    const after = await details(center); expect(after.map(value => [value.record.itemText, value.snapshots, value.artifacts])).toEqual(before.map(value => [value.record.itemText, value.snapshots, value.artifacts]));
    await center.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' }); await center.setViewportSize({ width: 760, height: 900 });
    await center.evaluate(() => { document.body.style.zoom = '2'; }); expect(await center.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await center.screenshot({ path: info.outputPath('release-a-zh-dark-200-percent.png'), fullPage: true });
    await env.report('release-a-quota-boundary-safety.json', { quotaErrorSource: 'explicit synthetic QuotaExceededError at native put boundary; NOT physical quota proof', noFalseSavedAck: true, retryProviderCalls: 0,
      hostileTextExecuted: false, remoteRequests: remote.length, escapeFocusReturn: true, compositionEnterPrevented: true, actualDesktopIME: 'NOT RUN', uiLocalePreservesHistory: true, zoom: 'CSS 200%', locale: 'zh_CN' });
  } finally { await env.close(); }
});
