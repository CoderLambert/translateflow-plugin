import { test, expect } from './support/extension-fixture.mjs';

test('SDK package translates the public build overview body through hydration',async({harness:h},info)=>{
 test.skip(process.env.TF_LIVE_DOCS !== '1','Opt-in public page; mock Provider only');
 test.setTimeout(90000);
 await h.reset();h.server.setDelay(600);
 const page=await h.context.newPage();
 await page.goto('https://docs.langchain.com/build-overview',{waitUntil:'domcontentloaded',timeout:60000});
 await page.getByRole('heading',{name:'Choose your starting point',exact:true}).waitFor({state:'visible'});
 const tabId=await h.inject(page);
 const result=await h.sendContent(page,'ABT_TRANSLATE_PAGE',{taskId:'sdk-live-build-overview'});
 const stats=await h.driver.evaluate(async tabId=>{
  const [r]=await chrome.scripting.executeScript({target:{tabId},func:async()=>{
   const m=globalThis.__TRANSLATE_FLOW_CONTENT__.modules;
   const units=await m.dom.collectUnitsAsync();
   const bodies=units.filter(unit=>unit.source.text.length>60);
   return{units:units.length,bodyUnits:bodies.length,translatedBodies:bodies.filter(unit=>m.dom.hasTranslation(unit)).length,rendered:document.querySelectorAll('.abt-translation').length};
  }});return r.result;
 },tabId);
 await page.screenshot({path:info.outputPath('build-overview-translated.png'),fullPage:true});
 console.log(JSON.stringify({liveUrl:'https://docs.langchain.com/build-overview',result,stats,mockRequests:h.server.calls.length}));
 expect(result).toMatchObject({ok:true,missing:0,task:{state:'completed'}});
 expect(result.coverage).toMatchObject({unaccountedCharacters:0,duplicateCharacters:0,unexpectedCharacters:0});
 expect(stats.bodyUnits).toBeGreaterThan(10);
 expect(stats.translatedBodies).toBe(stats.bodyUnits);
 expect(h.server.calls.length).toBeGreaterThan(0);
 await page.close();
});
