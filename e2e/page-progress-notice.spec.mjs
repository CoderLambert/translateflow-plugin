import {test,expect} from './support/extension-fixture.mjs';

test('toolbar translation keeps a bottom-right notice visible after the native Popup closes',async({harness:h},testInfo)=>{
 await h.reset();
 await h.setStorage({uiLocale:'zh_CN',quickControlHiddenSites:['http://127.0.0.1'],translationPreferences:{version:1,textMethod:'ai',wordMethod:'ai'}});
 const page=await h.open('/article'); await h.inject(page);
 const held=h.server.holdNextTranslation();
 try {
  await page.bringToFront();await h.serviceWorker.evaluate(()=>chrome.action.openPopup());
  await expect.poll(()=>h.driver.evaluate(()=>{const v=chrome.extension.getViews({type:'popup'})[0];return Boolean(v?.document.querySelector('#translate')&&!v.document.querySelector('#translate').disabled);})).toBe(true);
  await h.driver.evaluate(()=>chrome.extension.getViews({type:'popup'})[0].document.querySelector('#translate').click());
  await held.started;
  await h.driver.evaluate(()=>chrome.extension.getViews({type:'popup'})[0].close());
  const toast=page.locator('.tf-page-progress');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/翻译/);
  await expect(toast.getByRole('progressbar')).toHaveAttribute('aria-valuemax','4');
  await expect(toast).toContainText('0/4');
  const box=await toast.boundingBox(),viewport=page.viewportSize();
  expect(box.x+box.width).toBeGreaterThan(viewport.width-100);
  expect(box.y+box.height).toBeGreaterThan(viewport.height-40);
  await expect(page.locator('.tf-quick-trigger')).toHaveCount(0);
  await expect(page.locator('.tf-toast[data-visible="true"]')).toHaveCount(0);
  await toast.evaluate(node=>node.remove());
  await expect(page.locator('.tf-page-progress')).toBeVisible();
  await expect(page.locator('.tf-page-progress').getByRole('progressbar')).toHaveAttribute('aria-valuemax','4');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:testInfo.outputPath('page-progress-working.png')});
  held.release();
  await expect(toast).toHaveAttribute('data-state','completed');
  await expect(toast).toContainText('4/4');
  await expect(toast.getByRole('progressbar')).toHaveAttribute('aria-valuenow','4');
  await page.screenshot({path:testInfo.outputPath('page-progress-completed.png')});
 } finally {held.release();await page.close();}
});


test('a failed manual translation leaves an actionable bottom-right error notice',async({harness:h})=>{
 await h.reset();await h.setStorage({uiLocale:'zh_CN',translationPreferences:{version:1,textMethod:'ai',wordMethod:'ai'}});
 const page=await h.open('/article');await h.inject(page);
 h.server.setFailures([401]);
 const result=await h.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'notice-failure'});
 expect(result.ok).toBe(false);
 const notice=page.locator('.tf-page-progress');
 await expect(notice).toBeVisible();await expect(notice).toHaveAttribute('data-state','failed');
 await expect(notice).toHaveAttribute('data-kind','error');await expect(notice.getByRole('progressbar')).toBeHidden();
 expect(h.server.calls.length).toBe(1);await page.close();
});
