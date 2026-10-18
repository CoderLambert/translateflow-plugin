import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// These tests exercise native IndexedDB with the production source modules.
// The separate cache-system-mv3 suite exercises the actual compiled extension.
const allowed = new Set([
  '/tests/cache-system-browser-cases.js',
  '/src/shared/url.js', '/src/shared/translation-cache-identity.js',
  '/src/shared/cache/persistence-errors.js', '/src/shared/cache/identity.js', '/src/shared/cache/record.js', '/src/shared/cache/single-flight.js',
  '/src/background/cache/service.js', '/src/background/cache/storage-indexeddb.js',
  '/src/background/cache/application.js'
]);

test('native cache upgrade, transaction and independent-client contracts', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<!doctype html><title>Native cache contracts</title>'); return; }
    if (!allowed.has(path)) { response.writeHead(404); response.end(); return; }
    try {
      const source = await readFile(new URL('..' + path, import.meta.url));
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(source);
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const report = await page.evaluate(async () => {
      const module = await import('/tests/cache-system-browser-cases.js');
      return module.runBrowserCacheTests();
    });
    report.browserVersion = page.context().browser().version();
    console.log('[NATIVE_CACHE_CONTRACTS]', JSON.stringify(report));
    expect(report.status).toBe('PASS'); expect(report.databaseVersion).toBe(4);
    expect(report.checks.every(check => check.status === 'PASS')).toBe(true);
    await testInfo.attach('native-indexeddb-contracts.json', { body: Buffer.from(JSON.stringify(report, null, 2)), contentType: 'application/json' });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
