import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";
import { assertUnchangedUpgradeSnapshot, expectedStorageAfterInstalledUpdate } from "./support/upgrade-expectations.mjs";
import { startMockServer } from "./support/mock-server.mjs";
import { startClosedNetwork, startupNetworkControl, assertStartupNetworkControl } from "./support/closed-network.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "../tests/helpers/mdd-fixture.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";
import { READING_METHOD, READING_ERROR } from "../src/shared/reading/constants.js";
import { request } from "../tests/fixtures/reading/contract.mjs";

const oldArtifact = process.env.TF_UPGRADE_OLD_ARTIFACT;
const newArtifact = process.env.TF_UPGRADE_NEW_ARTIFACT;
const reportDir = resolve(process.env.TF_UPGRADE_EVIDENCE_DIR || "test-results/wxt-upgrade-evidence");

for(const existingUiLocale of [undefined,"zh_CN"]) {
const scenario=existingUiLocale===undefined ? "missing-ui-locale" : "existing-ui-locale";
test(`same profile and unpacked path preserve real settings, cache, OPFS, preferences and registrations through old → WXT → restart (${scenario})`, async ({}, testInfo) => {
  test.skip(!oldArtifact || !newArtifact, "Set both fixed old and actual WXT artifacts; no builder fallback.");
  test.setTimeout(180_000);
  const root = await mkdtemp(join(tmpdir(), "translateflow-wxt-upgrade-"));
  const extensionDir = join(root, "extension");
  const profile = join(root, "profile");
  const server = await startMockServer();
  const network = await startClosedNetwork(server.baseUrl).catch(async error => {
    await server.close(); await rm(root,{recursive:true,force:true}); throw error;
  });
  const oldControl = startupNetworkControl(`old-${scenario}`, server.baseUrl);
  const newControl = startupNetworkControl(`wxt-${scenario}`, server.baseUrl);
  const errors = [];
  let context;
  let driver;
  let extensionId;
  const phases = [];
  let failure;
  const oldManifest=JSON.parse(await readFile(join(oldArtifact,"manifest.json"),"utf8"));
  const newManifest=JSON.parse(await readFile(join(newArtifact,"manifest.json"),"utf8"));
  expect(newManifest.version).toBe(oldManifest.version);
  async function startupProof(worker, control, fromAttempt) {
    await expect.poll(()=>worker.evaluate(()=>globalThis.__tfNetworkStartupProbe?.results.length)).toBe(3);
    const observed=await worker.evaluate(()=>globalThis.__tfNetworkStartupProbe);
    const snapshot=network.snapshot();
    assertStartupNetworkControl(observed,control,{...snapshot,attempts:snapshot.attempts.slice(fromAttempt)});
    return observed;
  }
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: "chromium",
      proxy: network.launchProxy,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--disable-quic"] });
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    const sw = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(sw.url()).host;
    if (extensionId) expect(id).toBe(extensionId); else extensionId = id;
    driver = await context.newPage();
    await driver.goto(`chrome-extension://${id}/options.html#dictionary-packs`);
    await expect(driver.locator("#save")).toBeVisible();
    await driver.evaluate(() => chrome.runtime.sendMessage({ type: "CACHE_STATS" }));
    return sw;
  }
  async function runtime(message) { return driver.evaluate((m) => chrome.runtime.sendMessage(m), message); }
  async function tabId(page) {
    return driver.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id, page.url());
  }
  async function inject(page) {
    const id = await tabId(page);
    await driver.evaluate(async ({id, js, css}) => {
      try { if ((await chrome.tabs.sendMessage(id, {type: "ABT_STATUS"}))?.ok) return; } catch {}
      await chrome.scripting.insertCSS({target:{tabId:id},files:css});
      await chrome.scripting.executeScript({target:{tabId:id},files:js});
    }, {id,js:[...CONTENT_SCRIPT_FILES],css:[...CONTENT_STYLE_FILES]});
    return id;
  }
  async function content(page, message) {
    return driver.evaluate(({id,message}) => chrome.tabs.sendMessage(id,message), {id:await tabId(page),message});
  }
  async function snapshot() {
    return driver.evaluate(async () => {
      const storage = await chrome.storage.local.get(null);
      const databases = [];
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve,reject) => {
          const req=indexedDB.open(info.name,info.version); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
        });
        const stores = {};
        for (const name of [...db.objectStoreNames].sort()) {
          stores[name] = await new Promise((resolve,reject) => {
            const req=db.transaction(name,"readonly").objectStore(name).getAll(); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
          });
        }
        databases.push({name:db.name,version:db.version,stores}); db.close();
      }
      databases.sort((a,b)=>a.name.localeCompare(b.name));
      const opfs = [];
      async function walk(directory,path="") {
        for await (const [name,handle] of directory.entries()) {
          const next=path ? `${path}/${name}` : name;
          if(handle.kind==="directory") await walk(handle,next);
          else { const file=await handle.getFile(); const bytes=await file.arrayBuffer();
            const hash=await crypto.subtle.digest("SHA-256",bytes);
            opfs.push({path:next,size:file.size,sha256:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("")}); }
        }
      }
      await walk(await navigator.storage.getDirectory()); opfs.sort((a,b)=>a.path.localeCompare(b.path));
      const registrations = await chrome.scripting.getRegisteredContentScripts(); registrations.sort((a,b)=>a.id.localeCompare(b.id));
      return {storage,databases,opfs,registrations};
    });
  }
  async function dictionary(title,stem,enabled) {
    const mdx=makeRichMdx([["persistent",`<p>${title} synthetic meaning</p>`]],{title,styleSheet:""});
    const mdd=makeMdd([["\\media\\continuity.css",new TextEncoder().encode(`.continuity{color:#123456} /* ${title} */`)]]);
    await driver.locator("#localDictionaryFiles").setInputFiles([
      {name:`${stem}.mdx`,mimeType:"application/octet-stream",buffer:mdx},
      {name:`${stem}.mdd`,mimeType:"application/octet-stream",buffer:mdd}
    ]);
    await expect(driver.locator("#localDictionaryImportButton")).toBeEnabled();
    await driver.locator("#localDictionaryImportButton").click();
    await expect(driver.locator("#localDictionaryImportProgress")).toContainText("完成",{timeout:90000});
    const row=driver.locator("#richMdictInstalledList [data-dictionary-id]").filter({hasText:title});
    await expect(row).toBeVisible();
    const id=await row.getAttribute("data-dictionary-id");
    const checkbox=row.locator('[data-action="enabled"]');
    if(enabled) await checkbox.check(); else await checkbox.uncheck();
    await expect(checkbox).toBeChecked({checked:enabled});
    return {id,row,sourceSha256:createHash("sha256").update(mdx).digest("hex")};
  }
  try {
    const old = await prepareExtensionTestCopy({artifact:oldArtifact,extensionDir,baseUrl:server.baseUrl,startupNetwork:oldControl});
    const oldWorker=await launch();
    const oldStartup=await startupProof(oldWorker,oldControl,0);
    await driver.locator("#defaultProvider").selectOption("openai-compatible");
    await driver.locator("#targetLanguage").fill("Simplified Chinese");
    await driver.locator("#openaiBaseUrl").fill(`${server.baseUrl}/v1`);
    await driver.locator("#openaiModel").fill("migration-mock");
    await driver.locator("#save").click();
    await expect(driver.locator("#status")).toContainText("已保存");
    if(existingUiLocale!==undefined)await driver.evaluate(uiLocale=>chrome.storage.local.set({uiLocale}),existingUiLocale);
    const alpha=await dictionary("Upgrade Alpha","upgrade-alpha",true);
    const beta=await dictionary("Upgrade Beta","upgrade-beta",true);
    await beta.row.locator('[data-action="promote-preferred"]').click();
    await expect(beta.row.locator('[data-role="personal-preference"]')).toHaveText("你的个人首选");
    await beta.row.locator('[data-action="expanded-by-default"]').check();
    await alpha.row.locator('[data-action="enabled"]').uncheck();
    await expect(alpha.row.locator('[data-action="enabled"]')).not.toBeChecked();
    const page=await context.newPage(); await page.goto(`${server.baseUrl}/article`); await inject(page);
    expect(await content(page,{type:"ABT_TRANSLATE_PAGE",taskId:"upgrade-seed"})).toMatchObject({ok:true,apiTranslated:3});
    await expect(page.locator(".abt-translation")).toHaveCount(3); expect(server.calls).toHaveLength(1);
    // Same origin in all modes must keep one native registration; disabling auto
    // leaves restore + Quick Control in the union and cannot create paid misses.
    const origin=new URL(server.baseUrl).origin;
    for(const type of ["CACHE_RESTORE_SITE_REGISTER","QUICK_CONTROL_SITE_REGISTER","AUTO_SITE_REGISTER","AUTO_SITE_UNREGISTER"])
      expect(await runtime({type,origin})).toMatchObject({ok:true});
    await expect.poll(()=>driver.evaluate(async()=> (await chrome.scripting.getRegisteredContentScripts()).length)).toBe(1);
    const before=await snapshot();
    const legacyRuntime=await runtime(request(READING_METHOD.OPEN_LEARNING_CENTER));
    expect(legacyRuntime).toEqual({ok:false,error:"未知扩展消息。",errorCode:""});
    expect(before.storage.uiLocale).toBe(existingUiLocale);
    expect(Object.hasOwn(before.storage,"uiLocale")).toBe(existingUiLocale!==undefined);
    expect(before.databases).toEqual([expect.objectContaining({name:"ai_bilingual_translator",version:2})]);
    expect(Object.keys(before.databases[0].stores).sort()).toEqual(["pages","selection_explanations","translations"]);
    expect(before.databases[0].stores.translations).toHaveLength(3);
    expect(before.opfs.find(f=>f.path.includes(alpha.id)&&f.path.endsWith("source.mdx"))?.sha256).toBe(alpha.sourceSha256);
    expect(before.opfs.find(f=>f.path.includes(beta.id)&&f.path.endsWith("source.mdx"))?.sha256).toBe(beta.sourceSha256);
    const browserVersion=context.browser().version();
    phases.push({phase:"old",id:extensionId,artifact:old.treeSha256,testChanges:old.testCopy.changes,startupObserver:old.startupObserver,networkStartup:oldStartup,nativeRuntime:legacyRuntime,snapshot:summary(before)});
    await context.close(); context=null;
    await rm(extensionDir,{recursive:true,force:true});
    const next=await prepareExtensionTestCopy({artifact:newArtifact,extensionDir,baseUrl:server.baseUrl,observeInstalled:true,startupNetwork:newControl});
    const replacementNetworkStart=network.snapshot().attempts.length;
    const initialWorker=await launch();
    const initialLifecycle=await initialWorker.evaluate(()=>globalThis.__tfInstalledObserver);
    const initialRuntime=await runtime(request(READING_METHOD.OPEN_LEARNING_CENTER));
    const cachedOldRuntime=initialLifecycle===undefined;
    if(cachedOldRuntime) expect(initialRuntime).toEqual(legacyRuntime);
    else {
      expect(initialLifecycle).toEqual({events:[],capacity:4,overflow:false});
      expect(initialRuntime).toMatchObject({protocolVersion:2,ok:false,error:{code:READING_ERROR.NOT_READY}});
    }
    const replacementStartup=await startupProof(initialWorker,cachedOldRuntime ? oldControl : newControl,replacementNetworkStart);
    const after=await snapshot(); assertUnchangedUpgradeSnapshot(before,after);
    await expect(driver.locator("#uiLocale")).toBeVisible();
    await expect(driver.locator("#uiLocale")).toHaveValue(existingUiLocale??"auto");
    const afterLocaleDisplay=await snapshot(); assertUnchangedUpgradeSnapshot(before,afterLocaleDisplay);
    expect(Object.hasOwn(afterLocaleDisplay.storage,"uiLocale")).toBe(existingUiLocale!==undefined);
    phases.push({phase:cachedOldRuntime ? "PRE_UPGRADE_CACHED_OLD_RUNTIME" : "WXT-replacement-runtime",id:extensionId,artifact:next.treeSha256,testChanges:next.testCopy.changes,lifecycleObserver:next.lifecycleObserver,
      startupObserver:next.startupObserver,networkStartup:replacementStartup,observerExecuted:!cachedOldRuntime,nativeLifecycle:initialLifecycle??null,nativeRuntime:initialRuntime,snapshot:summary(after)});
    await expect(driver.locator(`#richMdictInstalledList [data-dictionary-id="${alpha.id}"] [data-action="enabled"]`)).not.toBeChecked();
    await expect(driver.locator(`#richMdictInstalledList [data-dictionary-id="${beta.id}"] [data-action="enabled"]`)).toBeChecked();
    await expect(driver.locator(`#richMdictInstalledList [data-dictionary-id="${beta.id}"] [data-role="personal-preference"]`)).toHaveText("你的个人首选");
    const stale=await context.newPage(); await stale.goto(`${server.baseUrl}/selection`); await inject(stale);
    const staleId=await tabId(stale);
    const beforeActivation=await snapshot(); assertUnchangedUpgradeSnapshot(before,beforeActivation);
    // Actual extension reload restarts the background and invalidates this existing
    // isolated world. Verify invalidation, then the supported refresh recovery.
    const manager = await context.newPage(); await manager.goto("chrome://extensions/");
    await manager.evaluate(()=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true}));
    // Use Chromium's own unpacked-extension management reload in this isolated
    // profile. runtime.reload from a CLI-sideloaded package disables its pages.
    const reloadNetworkStart=network.snapshot().attempts.length;
    const [reloadedWorker]=await Promise.all([
      context.waitForEvent("serviceworker"),
      manager.evaluate((id)=>chrome.developerPrivate.reload(id,{failQuietly:false}),extensionId)
    ]);
    expect(reloadedWorker).not.toBe(initialWorker);
    const activatedStartup=await startupProof(reloadedWorker,newControl,reloadNetworkStart);
    driver=await context.newPage(); await driver.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(driver.locator("#save")).toBeVisible();
    await expect.poll(()=>reloadedWorker.evaluate(()=>globalThis.__tfInstalledObserver?.events.length)).toBe(1);
    const reloadedLifecycle=await reloadedWorker.evaluate(()=>globalThis.__tfInstalledObserver);
    expect(reloadedLifecycle.overflow).toBe(false);
    const expectedReloadStorage=expectedStorageAfterInstalledUpdate(before.storage,reloadedLifecycle.events[0],oldManifest.version);
    const activatedRuntime=await runtime(request(READING_METHOD.OPEN_LEARNING_CENTER));
    expect(activatedRuntime).toMatchObject({protocolVersion:2,ok:false,error:{code:READING_ERROR.NOT_READY}});
    await expect.poll(()=>driver.evaluate(()=>chrome.storage.local.get(["uiLocale"]).then(x=>x.uiLocale))).toBe(expectedReloadStorage.uiLocale);
    const activated=await snapshot();expect(activated).toEqual({...beforeActivation,storage:expectedReloadStorage});
    phases.push({phase:"WXT-management-reload",id:extensionId,newWorkerObserved:true,networkStartup:activatedStartup,nativeLifecycle:reloadedLifecycle,nativeRuntime:activatedRuntime,snapshot:summary(activated)});
    const invalidated=await driver.evaluate(async(id)=>{
      try {return await chrome.tabs.sendMessage(id,{type:"ABT_STATUS"});}
      catch(error){return {ok:false,invalidated:true,error:String(error)}}
    },staleId);
    // A new scripting.executeScript creates a fresh extension context and is
    // unsuitable for checking an old binding. Probe the old registered channel.
    expect(invalidated).toMatchObject({ok:false,invalidated:true});
    const reopened=await context.newPage(); await reopened.goto(`${server.baseUrl}/article`);
    // These restore checks now run after actual new-WXT activation, not against
    // the old background Chromium can retain at the same unpacked version.
    await expect(reopened.locator(".abt-translation")).toHaveCount(3); expect(server.calls).toHaveLength(1);
    await reopened.reload(); await expect(reopened.locator(".abt-translation")).toHaveCount(3);
    expect(server.calls).toHaveLength(1);
    await stale.reload(); await expect(stale.locator(".tf-selection-chip")).toHaveCount(0);
    await inject(stale); expect(await content(stale,{type:"ABT_STATUS"})).toMatchObject({ok:true});
    expect(server.calls).toHaveLength(1);
    const afterRecovery=await snapshot();
    expect(afterRecovery.storage).toEqual(expectedReloadStorage); expect(afterRecovery.opfs).toEqual(before.opfs);
    expect(afterRecovery.registrations).toEqual(before.registrations);
    // Cache read metadata is expected to change only after actual cache use.
    expect(afterRecovery.databases[0].stores.translations).toHaveLength(3);
    phases.push({phase:"WXT-after-recovery",id:extensionId,snapshot:summary(afterRecovery)});
    await context.close(); context=null;
    const restartNetworkStart=network.snapshot().attempts.length;
    const restartedWorker=await launch();
    const restartedStartup=await startupProof(restartedWorker,newControl,restartNetworkStart);
    const restartedLifecycle=await restartedWorker.evaluate(()=>globalThis.__tfInstalledObserver);
    expect(restartedLifecycle).toMatchObject({events:expect.any(Array),capacity:4,overflow:false});
    expect(restartedLifecycle.events.length).toBeLessThanOrEqual(restartedLifecycle.capacity);
    const restartedRuntime=await runtime(request(READING_METHOD.OPEN_LEARNING_CENTER));
    expect(restartedRuntime).toMatchObject({protocolVersion:2,ok:false,error:{code:READING_ERROR.NOT_READY}});
    const restarted=await snapshot(); expect(restarted).toEqual(afterRecovery);
    phases.push({phase:"WXT-browser-restart",id:extensionId,networkStartup:restartedStartup,nativeLifecycle:restartedLifecycle,nativeRuntime:restartedRuntime,snapshot:summary(restarted)});
    expect(server.calls).toHaveLength(1); expect(network.snapshot().forwardedOutsideMock).toBe(0);
    expect(network.snapshot().overflow).toBe(false); expect(errors).toEqual([]);
    await mkdir(reportDir,{recursive:true});
    const report={schemaVersion:1,status:"PASS",testInputHead:process.env.TF_E2E_ARTIFACT_SOURCE_HEAD??null,browserVersion,extensionId,stableUnpackedPath:true,sameUserDataDir:true,
      productionKeyChanged:false,phases,cachedOldRuntimeBeforeManagementReload:cachedOldRuntime,newWxtRuntimeAfterManagementReload:true,uiLocale:{before:existingUiLocale??"ABSENT",afterReplacement:after.storage.uiLocale??"ABSENT",afterInstalledUpdate:afterRecovery.storage.uiLocale,uiValue:existingUiLocale??"auto",implicitUiStorageWrite:false},dictionaryIds:[alpha.id,beta.id],cacheRows:3,providerSeedCalls:1,
      unauthorizedProviderCalls:0,network:network.snapshot(),backgroundReload:true,staleWorldInvalidated:true,refreshRecovery:true,
      realChrome102:"NOT RUN",realYouTube:"NOT RUN",paidProvider:"NOT RUN"};
    await writeFile(join(reportDir,`same-id-upgrade-${scenario}.json`),JSON.stringify(report,null,2)+"\n");
    await testInfo.attach("same-id-upgrade.json",{body:Buffer.from(JSON.stringify(report,null,2)),contentType:"application/json"});
    console.log("[WXT_SAME_ID_UPGRADE]",JSON.stringify(report));
  } catch(error) {
    failure={name:error.name,message:error.message};throw error;
  } finally {
    if(failure) {
      await mkdir(reportDir,{recursive:true});
      const partial={schemaVersion:1,status:"FAIL",completeAcceptance:false,testInputHead:process.env.TF_E2E_ARTIFACT_SOURCE_HEAD??null,scenario,extensionId,
        phases,failure,observedProviderCalls:server.calls.length,network:network.snapshot()};
      await writeFile(join(reportDir,`same-id-upgrade-${scenario}-failed.json`),JSON.stringify(partial,null,2)+"\n");
      await testInfo.attach("same-id-upgrade-failed.json",{body:Buffer.from(JSON.stringify(partial,null,2)),contentType:"application/json"});
    }
    await context?.close().catch(()=>{}); await network.close(); await server.close(); await rm(root,{recursive:true,force:true});
  }
});
}

function summary(snapshot) {
  return {storageSha256:createHash("sha256").update(JSON.stringify(stable(snapshot.storage))).digest("hex"),
    databases:snapshot.databases.map(db=>({name:db.name,version:db.version,stores:Object.fromEntries(Object.entries(db.stores).map(([k,v])=>[k,{rows:v.length,sha256:createHash("sha256").update(JSON.stringify(stable(v))).digest("hex")}]))})),
    opfs:snapshot.opfs,registrations:snapshot.registrations};
}
function stable(value) { return Array.isArray(value) ? value.map(stable) : value&&typeof value==="object"
  ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])) : value; }
