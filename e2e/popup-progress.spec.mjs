import { test, expect } from './support/extension-fixture.mjs';

async function setup(h) {
  await h.reset();
  await h.setStorage({uiLocale:'zh_CN',quickControlSites:['http://127.0.0.1'],translationPreferences:{version:1,textMethod:'ai',wordMethod:'ai'}});
  const page=await h.open('/article'); await h.inject(page);
  await h.sendContent(page,'TF_QUICK_CONTROL_SHOW');
  await page.locator('.tf-quick-trigger').click();
  return page;
}
async function popupState(h,action='') {
  return h.driver.evaluate(action=>{
    const view=chrome.extension.getViews({type:'popup'})[0];
    if (!view || !view.document.querySelector("#translate")) return null;
    if(action==='translate') view.document.querySelector('#translate')?.click();
    if(action==='cancel') view.document.querySelector('#cancelTask')?.click();
    if(action==='close') {view.close();return null;}
    const progress=view.document.querySelector('#taskProgress');
    return {status:view.document.querySelector('#status')?.textContent,
      state:progress?.getAttribute('data-state'),done:progress?.getAttribute('aria-valuenow'),total:progress?.getAttribute('aria-valuemax'),
      disabled:view.document.querySelector('#translate')?.disabled,cancelVisible:!view.document.querySelector('#cancelTask')?.hidden};
  },action);
}
async function openPopup(h) {
  await h.serviceWorker.evaluate(()=>chrome.action.openPopup());
  await expect.poll(()=>popupState(h)).not.toBeNull();
}

test('native toolbar translation progress matches quick control and survives closing the Popup',async({harness:h},testInfo)=>{
  const page=await setup(h),held=h.server.holdNextTranslation();
  try {
    await page.bringToFront(); await openPopup(h);
    await expect.poll(async()=>!(await popupState(h)).disabled).toBe(true);
    await popupState(h,'translate'); await held.started;
    await expect.poll(async()=>(await popupState(h))?.state).toBe('translating');
    const task=(await h.sendContent(page,'TF_TASK_STATUS')).task;
    await expect.poll(async()=>(await popupState(h))?.total).toBe(String(task.total));
    await expect(page.locator('.tf-quick-status')).toContainText(`/${task.total}`);
    const notice=await page.locator('.tf-page-progress').boundingBox(),ball=await page.locator('.tf-quick-trigger').boundingBox();
    expect(notice.x+notice.width <= ball.x || ball.x+ball.width <= notice.x || notice.y+notice.height <= ball.y || ball.y+ball.height <= notice.y).toBe(true);
    const calls=h.server.calls.length;
    await popupState(h,'close'); await openPopup(h);
    await expect.poll(async()=>(await popupState(h))?.state).toBe('translating');
    expect((await popupState(h)).disabled).toBe(true);
    expect((await h.sendContent(page,'TF_TASK_STATUS')).task.id).toBe(task.id);
    expect(h.server.calls.length).toBe(calls);
    await popupState(h,'close');
    await h.driver.setViewportSize({width:360,height:580}); await h.driver.emulateMedia({reducedMotion:"reduce"}); await h.driver.reload();
    await expect(h.driver.locator('#taskProgress')).toHaveAttribute('aria-valuemax',String(task.total));
    await h.driver.screenshot({path:testInfo.outputPath('popup-working.png')});
    held.release();
    await expect(h.driver.locator('#taskProgress')).toHaveAttribute('data-state','completed');
    await expect(h.driver.locator('#taskProgress')).toHaveAttribute('aria-valuenow',String(task.total));
    await expect(page.locator('.tf-quick-status')).toContainText(`${task.total}/${task.total}`);
    await expect(page.locator('.tf-page-progress')).toHaveAttribute('data-state','completed');
    await expect(h.driver.locator('#translate')).toBeEnabled();
    await h.driver.screenshot({path:testInfo.outputPath('popup-completed.png')});
  } finally {held.release();await popupState(h,'close');await page.close();}
});

test('toolbar Popup attaches to a quick-control task and confirms cancellation without a duplicate request',async({harness:h})=>{
  const page=await setup(h),held=h.server.holdNextTranslation();
  try {
    await page.locator('.tf-quick-translate').click(); await held.started;
    const task=(await h.sendContent(page,'TF_TASK_STATUS')).task;
    const calls=h.server.calls.length;
    await page.bringToFront();await openPopup(h);
    await expect.poll(async()=>(await popupState(h))?.state).toBe('translating');
    await popupState(h,'cancel');
    await expect.poll(async()=>(await h.sendContent(page,'TF_TASK_STATUS',{taskId:task.id})).task.state).toBe('cancelled');
    await expect.poll(async()=>(await popupState(h))?.status).toContain('已取消');
    await expect(page.locator('.tf-quick-status')).toContainText('已取消');
    await expect(page.locator('.tf-page-progress')).toHaveAttribute('data-state','cancelled');
    expect(h.server.calls.length).toBe(calls);
    await expect.poll(()=>h.server.calls.some(call=>call.responseState==='closed')).toBe(true);
  } finally {held.release();await popupState(h,'close');await page.close();}
});
