import {test,expect} from './support/extension-fixture.mjs';

test.afterEach(async({harness:h})=>{await h.serviceWorker.evaluate(()=>{globalThis.__coverageRelease?.();if(globalThis.__coverageFetch)fetch=__coverageFetch;});});

for(const change of ['append','replace','remove','cancel'])test(`manual page translation reconciles ${change} while requests are pending`,async({harness:h})=>{
  await h.reset();h.server.setPage('/coverage','<main><section><p id="original">The original source paragraph.</p></section></main>');
  const page=await h.open('/coverage');await h.inject(page);
  await h.serviceWorker.evaluate(()=>{
    globalThis.__coverageFetch=fetch;globalThis.__coveragePending=false;
    const held=new Promise(resolve=>{globalThis.__coverageRelease=resolve;});let first=true;
    globalThis.fetch=async(...args)=>{if(first&&String(args[0]).endsWith('/chat/completions')){first=false;__coveragePending=true;await held;}return __coverageFetch(...args);};
  });
  const pending=h.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'coverage'});
  await expect.poll(()=>h.serviceWorker.evaluate(()=>__coveragePending)).toBe(true);
  await page.evaluate(change=>{
    if(change==='replace')document.querySelector('#original').firstChild.nodeValue='A replacement source must receive its own translation.';
    else if(change==='remove')document.querySelector('#original').remove();
    const section=document.createElement('section');section.innerHTML='<p id="added">A newly loaded independent paragraph.</p>';document.querySelector('main').append(section);
  },change);
  if(change==='cancel')await h.sendContent(page,'TF_CANCEL_TASK',{taskId:'coverage'});
  await h.serviceWorker.evaluate(()=>__coverageRelease());
  const result=await pending;
  if(change==='cancel'){expect(result).toMatchObject({cancelled:true});await expect(page.locator('.abt-translation')).toHaveCount(0);}
  else {
    expect(result).toMatchObject({ok:true,count:change==='remove'?1:2,missing:0,task:{state:'completed'}});
    await expect(page.locator('#added > .abt-translation')).toHaveCount(1);
    if(change==='replace')await expect(page.locator('#original > .abt-translation')).toContainText('replacement source');
    const sent=h.server.calls.flatMap(c=>c.segments).map(s=>s.text);
    expect(sent.filter(text=>text==='A newly loaded independent paragraph.')).toHaveLength(1);
    const calls=h.server.calls.length;await h.sendContent(page,'ABT_CLEAR_TRANSLATIONS');
    expect(await h.sendContent(page,'ABT_RESTORE_CACHE')).toMatchObject({missing:0});expect(h.server.calls).toHaveLength(calls);
  }
  await page.close();
});

test('real CSS visibility restores descendants without uploading hidden text',async({harness:h})=>{
  await h.reset();h.server.setPage('/visibility','<main><div style="visibility:hidden"><p>NEVER_SEND_HIDDEN</p><span style="visibility:visible" id="visible">A visible child inside a hidden ancestor.</span></div><p style="margin-top:3000px" id="offscreen">An offscreen paragraph still belongs to the page.</p><iframe srcdoc="Embedded content"></iframe></main>');
  const page=await h.open('/visibility');await h.inject(page);
  const result=await h.sendContent(page,'ABT_TRANSLATE_PAGE');
  expect(result).toMatchObject({count:2,missing:0,coverage:{unaccountedCharacters:0,duplicateCharacters:0,reasons:{'non-text-surface':1}}});
  await expect(page.locator('#visible .abt-translation')).toBeVisible();
  await expect(page.locator('#offscreen .abt-translation')).toHaveCount(1);
  expect(h.server.calls.flatMap(c=>c.segments).some(s=>s.text.includes('NEVER_SEND'))).toBe(false);
  await page.close();
});

test('continuously changing sources stop at a bounded failure rather than cancelling or claiming completion',async({harness:h})=>{
  await h.reset();h.server.setPage('/unstable','<main><p id="copy">Changing source revision zero.</p></main>');
  const page=await h.open('/unstable'),tabId=await h.inject(page);
  await h.serviceWorker.evaluate(tabId=>{
    globalThis.__coverageFetch=fetch;let revision=0;
    globalThis.fetch=async(...args)=>{
      if(String(args[0]).endsWith('/chat/completions'))await chrome.scripting.executeScript({target:{tabId},args:[++revision],func:revision=>{document.querySelector('#copy').firstChild.nodeValue=`Changing source revision ${revision}.`;}});
      return __coverageFetch(...args);
    };
  },tabId);
  const result=await h.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'unstable'});
  expect(result.ok).toBe(false);
  expect(await h.sendContent(page,'TF_TASK_STATUS',{taskId:'unstable'})).toMatchObject({task:{state:'failed',errorCode:'PAGE_CHANGED'}});
  expect(h.server.calls).toHaveLength(12);
  await expect(page.locator('.abt-translation')).toHaveCount(0);
  await page.close();
});
