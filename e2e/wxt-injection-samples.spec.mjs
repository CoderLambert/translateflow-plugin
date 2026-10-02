import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";
import { startMockServer } from "./support/mock-server.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";

test("fixed old and actual WXT use the same profile and invocation for ten cold/warm injection samples", async () => {
  const oldArtifact=process.env.TF_UPGRADE_OLD_ARTIFACT,newArtifact=process.env.TF_UPGRADE_NEW_ARTIFACT;
  test.skip(!oldArtifact||!newArtifact,"Explicit fixed old and actual WXT production artifacts are required.");
  test.setTimeout(60000);
  const root=await mkdtemp(join(tmpdir(),"tf-wxt-injection-samples-"));
  const extension=join(root,"extension"),profile=join(root,"profile");
  const server=await startMockServer();let context,extensionId;
  const phases=[];
  try {
    for(const [name,artifact] of [["old",oldArtifact],["WXT",newArtifact]]) {
      if(name!=="old")await rm(extension,{recursive:true,force:true});
      const source=await prepareExtensionTestCopy({artifact,extensionDir:extension,baseUrl:server.baseUrl});
      context=await chromium.launchPersistentContext(profile,{headless:true,channel:"chromium",viewport:{width:1280,height:720},
        args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
      const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");
      const id=new URL(worker.url()).host;if(extensionId)expect(id).toBe(extensionId);else extensionId=id;
      const driver=await context.newPage();await driver.goto(`chrome-extension://${id}/popup.html`);
      const pagesBefore=context.pages().length;const samples=[];
      for(let sample=0;sample<10;sample++) {
        const page=await context.newPage();await page.goto(`${server.baseUrl}/article`);
        const tabId=await driver.evaluate(async(url)=>(await chrome.tabs.query({})).find(tab=>tab.url===url)?.id,page.url());
        const result=await driver.evaluate(async({tabId,js,css})=>{
          const start=performance.now();await chrome.scripting.insertCSS({target:{tabId},files:css});
          await chrome.scripting.executeScript({target:{tabId},files:js});
          const coldStatus=await chrome.tabs.sendMessage(tabId,{type:"ABT_STATUS"});const coldMs=performance.now()-start;
          const [{result:before}]=await chrome.scripting.executeScript({target:{tabId},func:()=>{
            globalThis.__tf248InitialApp=globalThis.__TRANSLATE_FLOW_CONTENT__;
            return {loaded:__tf248InitialApp.loaded,modules:Object.keys(__tf248InitialApp.modules).length};
          }});
          const warmStart=performance.now();await chrome.scripting.insertCSS({target:{tabId},files:css});
          await chrome.scripting.executeScript({target:{tabId},files:js});
          const warmStatus=await chrome.tabs.sendMessage(tabId,{type:"ABT_STATUS"});const warmMs=performance.now()-warmStart;
          const [{result:after}]=await chrome.scripting.executeScript({target:{tabId},func:()=>({
            sameApp:globalThis.__tf248InitialApp===globalThis.__TRANSLATE_FLOW_CONTENT__,
            loaded:__TRANSLATE_FLOW_CONTENT__.loaded,modules:Object.keys(__TRANSLATE_FLOW_CONTENT__.modules).length})});
          return {coldMs,warmMs,coldStatus,warmStatus,before,after};
        },{tabId,js:[...CONTENT_SCRIPT_FILES],css:[...CONTENT_STYLE_FILES]});
        expect(result.coldStatus).toMatchObject({ok:true,running:false,count:0});
        expect(result.warmStatus).toMatchObject({ok:true,running:false,count:0});
        expect(result.before.loaded).toBe(true);expect(result.after).toEqual({...result.before,sameApp:true});
        expect(await page.locator(".abt-translation").count()).toBe(0);expect(server.calls).toHaveLength(0);
        samples.push({sample:sample+1,coldMs:result.coldMs,warmMs:result.warmMs,moduleCount:result.before.modules,
          sameApp:true,translatedNodes:0,providerCalls:0});await page.close();
        expect(context.pages()).toHaveLength(pagesBefore);
      }
      phases.push({phase:name,artifact:source.treeSha256,browser:context.browser().version(),samples,
        coldMs:distribution(samples.map(s=>s.coldMs)),warmMs:distribution(samples.map(s=>s.warmMs)),
        documentCleanup:true});await context.close();context=null;
    }
    const report={schemaVersion:1,status:"PASS",sameUserDataDir:true,sameExtensionId:true,viewport:{width:1280,height:720},
      method:"Per fresh /article document: insertCSS → ordered raw scripts → native status; repeat same file injection on same document for warm/idempotence. Measures scripting + bootstrap + message round trip with performance.now in the extension page. No speed threshold or performance claim.",
      contentFiles:[...CONTENT_SCRIPT_FILES],styleFiles:[...CONTENT_STYLE_FILES],providerCalls:0,phases};
    const dir=resolve(process.env.TF_UPGRADE_EVIDENCE_DIR||"test-results/wxt-upgrade-evidence");await mkdir(dir,{recursive:true});
    await writeFile(join(dir,"injection-samples.json"),JSON.stringify(report,null,2)+"\n");
    console.log("[WXT_INJECTION_SAMPLES]",JSON.stringify(report));
  } finally {await context?.close().catch(()=>{});await server.close();await rm(root,{recursive:true,force:true});}
});
function distribution(samples) {const sorted=[...samples].sort((a,b)=>a-b);return {median:(sorted[4]+sorted[5])/2,min:sorted[0],max:sorted[9]};}
