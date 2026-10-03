import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareExtensionTestCopy, defaultArtifact } from "./support/production-artifact.mjs";
import { startMockServer } from "./support/mock-server.mjs";

const hostError="Cannot access contents of the page. Extension manifest must request permission to access the respective host.";
const noReceiverError="Could not establish connection. Receiving end does not exist.";
const observationWindowMs=1000;
const registrationTypes=["AUTO_SITE_REGISTER","CACHE_RESTORE_SITE_REGISTER","QUICK_CONTROL_SITE_REGISTER"];

test("native withheld, site grant and revoke controls gate static Content injection and prune old registrations", async () => {
  test.setTimeout(60000);
  const root=await mkdtemp(join(tmpdir(),"tf-platform-permission-"));
  const extension=join(root,"extension"),profile=join(root,"profile");
  const server=await startMockServer(); let context,driver,manager,extensionId,worker;
  async function launch(){
    context=await chromium.launchPersistentContext(profile,{headless:true,channel:"chromium",
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");
    const id=new URL(worker.url()).host;if(extensionId)expect(id).toBe(extensionId);else extensionId=id;
    driver=await context.newPage();await driver.goto(`chrome-extension://${id}/popup.html`);
    manager=await context.newPage();await manager.goto("chrome://extensions/");
  }
  const contains=(origin="http://127.0.0.1/*")=>driver.evaluate(origin=>chrome.permissions.contains({origins:[origin]}),origin);
  const message=(type)=>driver.evaluate(({type,origin})=>chrome.runtime.sendMessage({type,origin}),{type,origin:new URL(server.baseUrl).origin});
  const readProbe=(key)=>worker.evaluate(key=>({...globalThis.__tfPermissionProbes[key]}),key);
  async function startProbe(key,tabId){
    expect(Number.isInteger(tabId) && tabId>=0).toBe(true);
    expect(await driver.evaluate(id=>chrome.tabs.get(id).then(tab=>tab.id),tabId)).toBe(tabId);
    await worker.evaluate(({key,tabId})=>{
      globalThis.__tfPermissionProbes ||= {};
      if(Object.hasOwn(globalThis.__tfPermissionProbes,key))throw new Error("Duplicate native probe");
      globalThis.__tfPermissionProbes[key]={nativeCalls:0,state:"NOT_STARTED",tabId,marker:`tf-native-permission-${key}`};
    },{key,tabId});
    const before=await readProbe(key);expect(before).toMatchObject({nativeCalls:0,state:"NOT_STARTED",tabId});
    // Do not await the native promise inside evaluate: its state and call count
    // must remain independently readable even when Chromium withholds execution.
    await worker.evaluate(key=>{
      const probe=globalThis.__tfPermissionProbes[key];
      if(probe.nativeCalls!==0)throw new Error("Native probe already invoked");
      const args={target:{tabId:probe.tabId},args:[probe.marker],func:(marker)=>{
        const node=document.createElement("span");node.id=marker;node.textContent="native permission control";
        document.body.append(node);return marker;
      }};
      probe.nativeCalls++;probe.state="PENDING";
      try {
        chrome.scripting.executeScript(args).then(results=>{
          probe.state="FULFILLED";probe.results=results;
        },error=>{
          probe.state="REJECTED";probe.errorName=error.name;probe.error=error.message;
        });
      } catch(error) {
        probe.state="CALL_ERROR";probe.errorName=error.name;probe.error=error.message;
      }
    },key);
    expect((await readProbe(key)).nativeCalls).toBe(1);
    return before;
  }
  function assertHostRejected(probe){
    expect(probe).toMatchObject({nativeCalls:1,state:"REJECTED",errorName:"Error",error:hostError});
  }
  async function assertNoProductionInjection(page,tabId){
    expect(await page.locator(".abt-translation, [data-tf-extension-ui], [id^='tf-native-permission-']").count()).toBe(0);
    const receiver=await worker.evaluate(async id=>{
      try {return {response:await chrome.tabs.sendMessage(id,{type:"ABT_STATUS"})};}
      catch(error){return {errorName:error.name,error:error.message};}
    },tabId);
    expect(receiver).toEqual({errorName:"Error",error:noReceiverError});
  }
  async function observeUnexecuted(key,page,tabId){
    const started=performance.now();let samples=0,probe;
    // An explicit measurement window, not a sleep followed by a guessed outcome.
    // Every sample checks the real promise state and the live document marker.
    do {
      probe=await readProbe(key);expect(probe.nativeCalls).toBe(1);
      expect(["PENDING","REJECTED"]).toContain(probe.state);
      if(probe.state==="REJECTED")assertHostRejected(probe);
      expect(await page.locator(".abt-translation, [data-tf-extension-ui], [id^='tf-native-permission-']").count()).toBe(0);
      samples++;
    } while(performance.now()-started<observationWindowMs);
    await assertNoProductionInjection(page,tabId);
    probe=await readProbe(key);expect(["PENDING","REJECTED"]).toContain(probe.state);
    if(probe.state==="REJECTED")assertHostRejected(probe);
    return {...probe,observedWindowMs:Math.round(performance.now()-started),samples,markerCount:0,productionReceiver:"ABSENT"};
  }
  try {
    const artifact=await prepareExtensionTestCopy({artifact:defaultArtifact,extensionDir:extension,baseUrl:server.baseUrl});
    await launch();
    await expect.poll(()=>contains()).toBe(true);
    const page=await context.newPage();await page.goto(`${server.baseUrl}/article`);
    await expect(page).toHaveTitle("TranslateFlow E2E Fixture");
    // Capture a stable native ID while permission exposes this unique URL.
    const authorizedTabs=await driver.evaluate(async(url)=>(await chrome.tabs.query({})).filter(t=>t.url===url),page.url());
    expect(authorizedTabs).toHaveLength(1);const tabId=authorizedTabs[0].id;
    expect(Number.isInteger(tabId) && tabId>=0).toBe(true);

    // Restrict required all-site access through Chromium's native management UI.
    // The extension cannot override this user choice.
    await manager.evaluate((id)=>chrome.developerPrivate.updateExtensionConfiguration({
      extensionId:id,hostAccess:chrome.developerPrivate.HostAccess.ON_SPECIFIC_SITES}),extensionId);
    await expect.poll(()=>contains()).toBe(false);await page.reload();

    // A separate ordinary origin remains denied while all-site access is withheld.
    const hardUrl=new URL(`${server.baseUrl}/article`);hardUrl.hostname="localhost";
    expect(await contains("http://localhost/*")).toBe(false);
    const [hardPage,hardTab]=await Promise.all([
      context.waitForEvent("page"),
      driver.evaluate(url=>chrome.tabs.create({url,active:false}),hardUrl.href)
    ]);
    expect(Number.isInteger(hardTab.id) && hardTab.id>=0).toBe(true);
    await hardPage.waitForURL(hardUrl.href);await expect(hardPage).toHaveTitle("TranslateFlow E2E Fixture");
    const hardBefore=await startProbe("hard-denied",hardTab.id);
    const hardDenied=await observeUnexecuted("hard-denied",hardPage,hardTab.id);
    expect(await contains("http://localhost/*")).toBe(false);

    // Required-but-withheld access can leave a programmatic request pending.
    for(const type of registrationTypes)expect(await message(type)).toMatchObject({ok:false});
    expect(await driver.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).toEqual([]);
    const withheldBefore=await startProbe("withheld",tabId);
    const withheld=await observeUnexecuted("withheld",page,tabId);
    expect(await contains()).toBe(false);

    await manager.evaluate(id=>chrome.developerPrivate.addHostPermission(id,"http://127.0.0.1/*"),extensionId);
    await expect.poll(()=>contains()).toBe(true);
    // A fresh document prevents the earlier pending document from serving as
    // the positive control. This does not claim click-to-run consent settlement.
    await page.reload();
    const grantBefore=await startProbe("granted",tabId);
    await expect.poll(async()=>(await readProbe("granted")).state).toBe("FULFILLED");
    const granted=await readProbe("granted");expect(granted.nativeCalls).toBe(1);
    expect(granted.results).toHaveLength(1);
    expect(granted.results[0]).toMatchObject({frameId:0,result:granted.marker});
    await expect(page.locator(`#${granted.marker}`)).toHaveText("native permission control");
    for(const type of ["CACHE_RESTORE_SITE_REGISTER","QUICK_CONTROL_SITE_REGISTER","AUTO_SITE_REGISTER","AUTO_SITE_UNREGISTER"])
      expect(await message(type)).toMatchObject({ok:true});
    const registrations=await driver.evaluate(()=>chrome.scripting.getRegisteredContentScripts());
    expect(registrations).toEqual([]);
    const staticScripts=await driver.evaluate(()=>chrome.runtime.getManifest().content_scripts);
    expect(staticScripts).toEqual([expect.objectContaining({matches:["http://*/*","https://*/*"],run_at:"document_idle"})]);

    await manager.evaluate(id=>chrome.developerPrivate.removeHostPermission(id,"http://127.0.0.1/*"),extensionId);
    await expect.poll(()=>contains()).toBe(false);const revokedContains=await contains();expect(revokedContains).toBe(false);
    await page.reload();await expect(page.locator(`#${granted.marker}`)).toHaveCount(0);
    const revokedBefore=await startProbe("revoked",tabId);
    const revoked=await observeUnexecuted("revoked",page,tabId);
    for(const type of registrationTypes)expect(await message(type)).toMatchObject({ok:false});
    expect(server.calls).toHaveLength(0);
    await context.close();context=null;await launch();
    await expect.poll(()=>contains()).toBe(false);const restartedContains=await contains();expect(restartedContains).toBe(false);
    await expect.poll(()=>driver.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).toEqual([]);
    const state=await driver.evaluate(()=>chrome.storage.local.get(["autoSites","cacheRestoreSites","quickControlSites"]));
    expect(state).toEqual({autoSites:[],cacheRestoreSites:[],quickControlSites:[]});
    expect(server.calls).toHaveLength(0);
    console.log("[PLATFORM_NATIVE_SITE_ACCESS]",JSON.stringify({status:"PASS",scope:"native controls and bounded no-execution observations",
      browser:context.browser().version(),artifact:artifact.treeSha256,
      beforeNative:{hardDenied:hardBefore,withheld:withheldBefore,granted:grantBefore,revoked:revokedBefore},
      hardDenied:{...hardDenied,markerCount:0,productionReceiver:"ABSENT"},withheld,granted:{...granted,markerCount:1},revoked,
      stableTabId:tabId,hardDeniedTabId:hardTab.id,revokedContains,restartedContains,
      sameProfileRestart:true,startupPruned:true,dynamicRegistrations:0,staticContentScripts:1,providerCalls:0,
      pendingConsentCompletion:"NOT RUN",browserPermissionPrompt:"NOT RUN",productionManifestChanged:false}));
  } finally {await context?.close().catch(()=>{});await server.close();await rm(root,{recursive:true,force:true});}
});
