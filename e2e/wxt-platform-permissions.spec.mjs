import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareExtensionTestCopy, defaultArtifact } from "./support/production-artifact.mjs";
import { startMockServer } from "./support/mock-server.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../src/shared/constants.js";

test("native withheld → specific grant → revoke denies injection and startup prunes the site registration union", async () => {
  test.setTimeout(60000);
  const root=await mkdtemp(join(tmpdir(),"tf-platform-permission-"));
  const extension=join(root,"extension"),profile=join(root,"profile");
  const server=await startMockServer(); let context,driver,manager,extensionId;
  async function launch(){
    context=await chromium.launchPersistentContext(profile,{headless:true,channel:"chromium",
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");
    const id=new URL(worker.url()).host;if(extensionId)expect(id).toBe(extensionId);else extensionId=id;
    driver=await context.newPage();await driver.goto(`chrome-extension://${id}/popup.html`);
    manager=await context.newPage();await manager.goto("chrome://extensions/");
  }
  const contains=()=>driver.evaluate(()=>chrome.permissions.contains({origins:["http://127.0.0.1/*"]}));
  const message=(type)=>driver.evaluate(({type,origin})=>chrome.runtime.sendMessage({type,origin}),{type,origin:new URL(server.baseUrl).origin});
  try {
    const artifact=await prepareExtensionTestCopy({artifact:defaultArtifact,extensionDir:extension,baseUrl:server.baseUrl});
    await launch();
    // Chromium's own management API changes only this test extension in the
    // isolated profile. No permissions function is stubbed, no UI prompt PASS.
    await manager.evaluate((id)=>chrome.developerPrivate.updateExtensionConfiguration({
      extensionId:id,hostAccess:chrome.developerPrivate.HostAccess.ON_SPECIFIC_SITES}),extensionId);
    await expect.poll(contains).toBe(false);
    for(const type of ["AUTO_SITE_REGISTER","CACHE_RESTORE_SITE_REGISTER","QUICK_CONTROL_SITE_REGISTER"])
      expect(await message(type)).toMatchObject({ok:false});
    expect(await driver.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).toEqual([]);
    await manager.evaluate(id=>chrome.developerPrivate.addHostPermission(id,"http://127.0.0.1/*"),extensionId);
    await expect.poll(contains).toBe(true);
    for(const type of ["CACHE_RESTORE_SITE_REGISTER","QUICK_CONTROL_SITE_REGISTER","AUTO_SITE_REGISTER","AUTO_SITE_UNREGISTER"])
      expect(await message(type)).toMatchObject({ok:true});
    const registrations=await driver.evaluate(()=>chrome.scripting.getRegisteredContentScripts());
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({js:[...CONTENT_SCRIPT_FILES],css:[...CONTENT_STYLE_FILES],persistAcrossSessions:true,runAt:"document_idle",matches:["http://127.0.0.1/*"]});
    await manager.evaluate(id=>chrome.developerPrivate.removeHostPermission(id,"http://127.0.0.1/*"),extensionId);
    await expect.poll(contains).toBe(false);
    const page=await context.newPage(); await page.goto(`${server.baseUrl}/article`);
    expect(await page.locator(".abt-translation").count()).toBe(0);
    const denied=await driver.evaluate(async(url)=>{
      const tab=(await chrome.tabs.query({})).find(t=>t.url===url);
      try {await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>"forbidden"});return false;}catch{return true;}
    },page.url()); expect(denied).toBe(true);
    expect(await message("AUTO_SITE_REGISTER")).toMatchObject({ok:false});
    expect(server.calls).toHaveLength(0);
    await context.close();context=null;await launch();
    await expect.poll(contains).toBe(false);
    await expect.poll(()=>driver.evaluate(()=>chrome.scripting.getRegisteredContentScripts())).toEqual([]);
    const state=await driver.evaluate(()=>chrome.storage.local.get(["autoSites","cacheRestoreSites","quickControlSites"]));
    expect(state).toEqual({autoSites:[],cacheRestoreSites:[],quickControlSites:[]});
    expect(server.calls).toHaveLength(0);
    console.log("[PLATFORM_NATIVE_SITE_ACCESS]",JSON.stringify({status:"PASS",browser:context.browser().version(),
      artifact:artifact.treeSha256,nativeManagementGrant:true,nativePermissionsContains:true,nativeRevocation:true,
      deniedInjection:true,sameProfileRestart:true,startupPruned:true,registrationUnion:1,providerCalls:0,
      browserPermissionPrompt:"NOT RUN",productionManifestChanged:false}));
  } finally {await context?.close().catch(()=>{});await server.close();await rm(root,{recursive:true,force:true});}
});
