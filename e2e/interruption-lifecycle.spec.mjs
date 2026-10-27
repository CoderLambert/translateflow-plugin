import { test, expect } from './support/extension-fixture.mjs';
import {runUnattachedWorkerScenario} from './support/unattached-worker-scenario.mjs';

test('assistant request survives a slow local response without a worker debugger', async () => {
  test.setTimeout(55000);
  await runUnattachedWorkerScenario();
});

test('same-URL History updates do not cancel a page translation after cached paragraphs render', async ({ harness }) => {
  await harness.reset();
  const page = await harness.open('/article'); await harness.inject(page);
  expect((await harness.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'seed-before-history' })).ok).toBe(true);
  const previous = harness.server.calls.length;
  await page.evaluate(() => { const p = document.createElement('p'); p.id = 'pending-source'; p.textContent = 'This additional paragraph is waiting for the local model while the application updates its history state.'; document.querySelector('main').append(p); });
  harness.server.setDelay(1000);
  const pending = harness.sendContent(page, 'ABT_TRANSLATE_PAGE', { taskId: 'page-history-update' });
  await expect.poll(() => harness.server.calls.length).toBeGreaterThan(previous);
  await expect(page.locator('.abt-translation').first()).toBeVisible();
  await page.evaluate(() => history.replaceState({ ...history.state, appHydrated: true }, '', location.href));
  const result = await pending;
  console.log('[interruption-repro]', JSON.stringify({cancelled:result.cancelled,errorCode:result.errorCode,state:result.task?.state,message:result.message}));
  expect(result.cancelled).not.toBe(true);
  expect(result).toMatchObject({ ok: true, apiTranslated: 1 });
  await expect(page.locator('#pending-source .abt-translation')).toBeVisible();
  await page.close();
});
