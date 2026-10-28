import { test, expect } from './support/extension-fixture.mjs';

test('native toolbar Popup negotiates its size and keeps its primary action visible', async ({ harness: h }) => {
  await h.reset();
  await h.setStorage({ translationPreferences: { version: 1, textMethod: 'ai', wordMethod: 'ai' } });
  const article = await h.open('/article'); await article.bringToFront();
  await h.serviceWorker.evaluate(() => chrome.action.openPopup());
  // Toolbar popups are extension views, not ordinary Playwright page events.
  let geometry;
  await expect.poll(async () => {
    geometry = await h.driver.evaluate(() => {
      const view = chrome.extension.getViews({ type: 'popup' })[0];
      const button = view?.document.querySelector('#translate');
      if (!button || button.disabled) return null;
      const rect = button.getBoundingClientRect();
      return { width: view.innerWidth, height: view.innerHeight,
        bodyWidth: view.document.body.getBoundingClientRect().width,
        horizontalOverflow: view.document.body.scrollWidth > view.document.body.clientWidth,
        footer: view.document.querySelector('.primary-section').getBoundingClientRect().bottom,
        reachable: button.contains(view.document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
    });
    return Boolean(geometry);
  }).toBe(true);
  console.log('[native-popup]', JSON.stringify(geometry));
  expect(geometry.bodyWidth).toBe(360);
  // Chrome may reserve a native scrollbar gutter when screen height caps the popup.
  expect(geometry.width).toBeGreaterThanOrEqual(geometry.bodyWidth);
  expect(geometry.width - geometry.bodyWidth).toBeLessThanOrEqual(20);
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.height).toBeGreaterThanOrEqual(420);
  expect(geometry.height).toBeLessThanOrEqual(600);
  expect(geometry.footer).toBeLessThanOrEqual(geometry.height);
  expect(geometry.reachable).toBe(true);
  await h.driver.evaluate(() => chrome.extension.getViews({ type: 'popup' })[0]?.close());
  await article.close();
});
