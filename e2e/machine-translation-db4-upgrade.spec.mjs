import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareExtensionTestCopy } from "./support/production-artifact.mjs";
import { startClosedNetwork } from "./support/closed-network.mjs";
import { startMockServer } from "./support/mock-server.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "../tests/helpers/mdd-fixture.mjs";
import { record, snapshot as readingSnapshot, artifact, recordListItem } from "../tests/fixtures/reading/contract.mjs";

// Required: two real, separately built WXT artifacts (main DB4 -> #342).
// This does not reuse the DB2->DB4 compatibility test or a simulated old runtime.
const oldArtifact = process.env.TF_DB4_OLD_ARTIFACT;
const newArtifact = process.env.TF_DB4_NEW_ARTIFACT;
const pageUrl = "https://fixture.invalid/db4-upgrade";

test("same extension ID: DB4 main -> free MT keeps cache, Reading, user dictionary and settings", async ({}, info) => {
  test.skip(!oldArtifact || !newArtifact, "Both real DB4 old and new WXT artifacts are required.");
  test.setTimeout(180000);
  const root = await mkdtemp(join(tmpdir(), "tf-mt-db4-upgrade-"));
  const extensionDir = join(root, "extension"), profile = join(root, "profile");
  let context, driver, network, server, extensionId;
  const phases = [];
  async function launch() {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, channel: "chromium", proxy: network.launchProxy,
      args: ["--disable-quic", "--disable-extensions-except=" + extensionDir, "--load-extension=" + extensionDir]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    if (extensionId) expect(id).toBe(extensionId);
    extensionId = id;
    driver = await context.newPage();
    await driver.goto("chrome-extension://" + id + "/options.html#dictionary-packs");
    await expect(driver.locator("#save")).toBeVisible();
  }
  const runtime = message => driver.evaluate(input => chrome.runtime.sendMessage(input), message);
  async function snapshot() {
    return driver.evaluate(async () => {
      const storage = await chrome.storage.local.get(null), databases = [], opfs = [];
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(info.name, info.version);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        const stores = {};
        for (const name of db.objectStoreNames) {
          stores[name] = await new Promise((resolve, reject) => {
            const request = db.transaction(name).objectStore(name).getAll();
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
        }
        databases.push({name: db.name, version: db.version, stores});
        db.close();
      }
      async function walk(dir, prefix = "") {
        for await (const [name, handle] of dir.entries()) {
          const path = prefix ? prefix + "/" + name : name;
          if (handle.kind === "directory") await walk(handle, path);
          else {
            const file = await handle.getFile();
            const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
            const sha256 = [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2,"0")).join("");
            opfs.push({path, size: file.size, sha256});
          }
        }
      }
      await walk(await navigator.storage.getDirectory());
      opfs.sort((a,b) => a.path.localeCompare(b.path));
      databases.sort((a,b) => a.name.localeCompare(b.name));
      return {storage, databases, opfs};
    });
  }
  const database = (snap, name) => snap.databases.find(db => db.name === name);
  const keys = ["apiKey","openAICompatible","defaultService","providerConnections",
    "providerCredentials","targetLanguage","machineTranslation","siteProfiles","dictionaryEnabled"];
  const ownedSettings = storage => Object.fromEntries(keys.filter(k => Object.hasOwn(storage, k)).map(k => [k, storage[k]]));
  async function seedReading() {
    await driver.evaluate(seed => new Promise((resolve, reject) => {
      const request = indexedDB.open("translateflow-reading-records", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("meta");
        const records = db.createObjectStore("records", {keyPath:"record.recordId"});
        records.createIndex("recent",["sortTime","record.recordId"],{unique:true});
        records.createIndex("page","record.pageKey");
        records.createIndex("pageRecent",["record.pageKey","sortTime","record.recordId"],{unique:true});
        for (const [name, id] of [["snapshots","sourceSnapshotId"],["artifacts","artifactId"]])
          db.createObjectStore(name,{keyPath:["recordId","value."+id]}).createIndex("record","recordId");
        const pages = db.createObjectStore("pages",{keyPath:"pageKey"});
        pages.createIndex("expires","expiresAt");
        pages.createIndex("recent",["sortTime","pageKey"],{unique:true});
        db.createObjectStore("receipts",{keyPath:"key"}).createIndex("expires","expiresAt");
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(["records","snapshots","artifacts"],"readwrite");
        tx.objectStore("records").put({record:seed.record,siteKey:"https://example.test",
          documentGeneration:"doc-1",listItem:seed.listItem,sortTime:-1000,bytes:1024});
        tx.objectStore("snapshots").put({recordId:seed.record.recordId,value:seed.snapshot});
        tx.objectStore("artifacts").put({recordId:seed.record.recordId,value:seed.artifact});
        tx.oncomplete = () => {db.close();resolve();};
        tx.onerror = () => {db.close();reject(tx.error);};
        tx.onabort = () => {db.close();reject(tx.error);};
      };
    }), {record:record(),snapshot:readingSnapshot(),artifact:artifact(),listItem:recordListItem()});
  }
  try {
    server = await startMockServer();
    network = await startClosedNetwork(server.baseUrl);
    const oldManifest = JSON.parse(await readFile(join(resolve(oldArtifact),"manifest.json"),"utf8"));
    const newManifest = JSON.parse(await readFile(join(resolve(newArtifact),"manifest.json"),"utf8"));
    // Both built packages currently declare 0.8.29; this exercises a real
    // same-ID unpacked replacement+management reload, not automatic store update.
    expect(newManifest.version.localeCompare(oldManifest.version,"en",{numeric:true})).toBeGreaterThanOrEqual(0);
    const old = await prepareExtensionTestCopy({artifact:oldArtifact,extensionDir,baseUrl:server.baseUrl});
    await launch();
    await driver.locator("#defaultProvider").selectOption("openai-compatible");
    await driver.locator("#openaiBaseUrl").fill(server.baseUrl + "/v1");
    await driver.locator("#openaiModel").fill("upgrade-synthetic");
    await driver.locator("#targetLanguage").fill("Simplified Chinese");
    await driver.locator("#save").click();
    await expect(driver.locator("#status")).toContainText("已保存");
    const mdx = makeRichMdx([["persistent","<p>Locally installed user dictionary</p>"]],
      {title:"MT DB4 Upgrade Fixture",styleSheet:""});
    const mdd = makeMdd([["\\media\\continuity.css",new TextEncoder().encode(".continuity{}")]]);
    await driver.locator("#localDictionaryFiles").setInputFiles([
      {name:"mt-db4-upgrade.mdx",mimeType:"application/octet-stream",buffer:mdx},
      {name:"mt-db4-upgrade.mdd",mimeType:"application/octet-stream",buffer:mdd}
    ]);
    await driver.locator("#localDictionaryImportButton").click();
    await expect(driver.locator("#localDictionaryImportProgress")).toContainText("完成",{timeout:90000});
    const row = driver.locator("#richMdictInstalledList [data-dictionary-id]")
      .filter({hasText:"MT DB4 Upgrade Fixture"});
    await expect(row).toBeVisible();
    const dictionaryId = await row.getAttribute("data-dictionary-id");
    await seedReading();
    const segments = [{id:"existing",text:"Original DB4 cache must survive the update.",format:"plain"}];
    const lookup = await runtime({type:"CACHE_LOOKUP",pageUrl,segments});
    expect(lookup).toMatchObject({ok:true,hits:[]});
    expect(lookup.writeTokens).toHaveLength(1);
    expect(await runtime({type:"CACHE_STORE",pageUrl,configSnapshotId:lookup.configSnapshotId,
      items:[{sourceText:segments[0].text,translation:"主线既有缓存需要保留。",
        format:"plain",cacheToken:lookup.writeTokens[0].token}]})).toMatchObject({ok:true,stored:1});
    const before = await snapshot();
    expect(database(before,"ai_bilingual_translator")).toMatchObject({
      version:4,stores:{entries:expect.any(Array),epochs:expect.any(Array)}});
    expect(database(before,"ai_bilingual_translator").stores.entries.length).toBeGreaterThan(0);
    expect(database(before,"translateflow-reading-records").stores.records).toHaveLength(1);
    expect(before.opfs.some(file => file.path.includes(dictionaryId) && file.path.endsWith("source.mdx"))).toBe(true);
    phases.push({phase:"main-db4",artifact:old.treeSha256});
    await context.close(); context=null; driver=null;
    await rm(extensionDir,{recursive:true,force:true});
    const next = await prepareExtensionTestCopy({artifact:newArtifact,extensionDir,
      baseUrl:server.baseUrl});
    await launch();
    const manager = await context.newPage();
    await manager.goto("chrome://extensions/");
    await manager.evaluate(() => chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true}));
    await Promise.all([
      context.waitForEvent("serviceworker"),
      manager.evaluate(id => chrome.developerPrivate.reload(id,{failQuietly:false}),extensionId)
    ]);
    await driver.close();
    driver = await context.newPage();
    await driver.goto("chrome-extension://" + extensionId + "/options.html#dictionary-packs");
    await expect(driver.locator("#save")).toBeVisible();
    const after = await snapshot();
    expect(ownedSettings(after.storage)).toEqual(ownedSettings(before.storage));
    expect(after.opfs).toEqual(before.opfs);
    for (const store of ["records","snapshots","artifacts"])
      expect(database(after,"translateflow-reading-records").stores[store])
        .toEqual(database(before,"translateflow-reading-records").stores[store]);
    expect(database(after,"ai_bilingual_translator")).toEqual(database(before,"ai_bilingual_translator"));
    await expect(driver.locator("#richMdictInstalledList [data-dictionary-id]")
      .filter({hasText:"MT DB4 Upgrade Fixture"})).toBeVisible();
    const cached = await runtime({type:"CACHE_LOOKUP",pageUrl,cacheOnly:true,segments});
    expect(cached).toMatchObject({ok:true,hits:[{id:"existing",text:"主线既有缓存需要保留。"}]});
    const reading = await runtime({protocolVersion:2,method:"reading.list-records",
      pageKey:null,query:"React",cursor:null,limit:20});
    expect(reading).toMatchObject({ok:true,data:{items:[{recordId:record().recordId}]}});
    expect(server.calls).toHaveLength(0);
    expect(network.snapshot().forwardedOutsideMock).toBe(0);
    expect(next.treeSha256).not.toBe(old.treeSha256);
    phases.push({phase:"free-mt-db4",artifact:next.treeSha256,cachePreserved:true,
      readingPreserved:true,userDictionaryPreserved:true,providerRequests:0});
    const report={status:"PASS",schemaVersion:1,oldVersion:oldManifest.version,
      newVersion:newManifest.version,extensionId,sameProfile:true,sameUnpackedPath:true,
      upgradeMethod:"unpacked-replacement-and-management-reload",storeVersionUpdateVerified:false,
      oldSourceHead:process.env.TF_DB4_OLD_SOURCE_HEAD||null,
      newSourceHead:process.env.TF_DB4_NEW_SOURCE_HEAD||null,
      phases,network:network.snapshot()};
    await info.attach("mt-db4-same-id-upgrade.json",{body:Buffer.from(JSON.stringify(report,null,2)),
      contentType:"application/json"});
    console.log("[MT_DB4_SAME_ID_UPGRADE]",JSON.stringify(report));
  } finally {
    try {await context?.close();}
    finally {
      try {await network?.close();}
      finally {try {await server?.close();} finally {await rm(root,{recursive:true,force:true});}}
    }
  }
});
