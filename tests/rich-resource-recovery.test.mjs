import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createPackStateStore } from "../src/background/packs/state.js";
import { createRichMdictManager } from "../src/background/packs/rich-mdict.js";
import { createRichMddResourceManager } from "../src/background/packs/rich-mdd-resources.js";
import { getRichResourceBrowserSession, RICH_RESOURCE_SESSION_KEY } from "../src/background/packs/rich-resource-session.js";
import { normalizeResourceRecovery, makeResourceRecovery } from "../src/background/packs/rich-resource-recovery.js";
import { publicRichDictionary } from "../src/background/packs/rich-mdict-contract.js";
import { createRichMdictImportWorkerHandler } from "../src/options/workers/rich-mdict-import-worker-core.js";
import { createMddResourceImportWorkerHandler } from "../src/options/workers/mdd-resource-import-worker-core.js";
import { RICH_MDICT_WORKER_MESSAGES as MDX } from "../src/options/workers/rich-mdict-import-worker-protocol.js";
import { MDD_RESOURCE_WORKER_MESSAGES as MDD } from "../src/options/workers/mdd-resource-import-worker-protocol.js";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "./helpers/mdd-fixture.mjs";
import { preflightLocalDictionaryFiles } from "../src/background/packs/local-dictionary-preflight.js";
import { preflightRichAttachments } from "../src/background/packs/local-dictionary-preflight-attachments.js";
import { resolveAssociatedRichResourceFiles } from "../src/options/local-dictionary-import-presentation.js";
import { createMddResourceImportController } from "../src/options/mdd-resource-import-controller.js";
const packId = "rich-mdict-123e4567-e89b-42d3-a456-426614174000";
const mdxVersion = "import-mdx-12345678";
const oldToken = "a".repeat(64), newToken = "b".repeat(64);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z4cAAAAASUVORK5CYII=", "base64");
function file(name, bytes) { const value = new Blob([bytes]); Object.defineProperty(value, "name", { value: name }); return value; }
function sixFiles() {
  let reads = 0;
  const script = { name: "dictionary.js", size: 999, slice() { reads++; throw new Error("JS must never be read"); } };
  return { files: [file("Book.mdx", makeRichMdx([["go", '<link href="book.css"><p>body</p>']])),
    file("Book.mdd", makeMdd([["one.png", png]])), file("Book.1.mdd", makeMdd([["two.png", png]])),
    file("book.css", ".entry{color:red}"), file("book.png", png), script], get reads() { return reads; } };
}
class Store {
  files = new Map(); removed = []; failWrite = false;
  key(id, version, path) { return `${id}/${version}/${path}`; }
  async writeFile(id, version, path, bytes) { if(this.failWrite) throw new Error("copy failed"); this.files.set(this.key(id, version, path), bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(await bytes.arrayBuffer())); }
  async readFile(id, version, path) { const bytes=this.files.get(this.key(id,version,path)); if(!bytes) throw new Error("missing"); return bytes.slice(); }
  async readFileRange(id,version,path,offset,length) { return (await this.readFile(id,version,path)).slice(offset,offset+length); }
  async getFileSize(id,version,path) { return (await this.readFile(id,version,path)).length; }
  async listVersions(id) { return [...new Set([...this.files.keys()].filter(key=>key.startsWith(id+"/")).map(key=>key.split("/")[1]))]; }
  async removeVersion(id,version) { this.removed.push(version); for(const key of this.files.keys()) if(key.startsWith(`${id}/${version}/`)) this.files.delete(key); return true; }
  async removePack(id) { for(const key of this.files.keys()) if(key.startsWith(id+"/")) this.files.delete(key); return true; }
}
function area() { return { values:{}, writes:0, async get() { return structuredClone(this.values); }, async set(values) { this.writes++; Object.assign(this.values,structuredClone(values)); } }; }
async function env(intent = { mddCount:2, sidecarCount:2 }) {
  const store=new Store(), storageArea=area(), stateStore=createPackStateStore({storageArea});
  let token=oldToken;
  const dependencies={store,stateStore,cryptoProvider:webcrypto,getSessionToken:async()=>token};
  const manager=createRichMdictManager(dependencies);
  const identity={ packId,packVersion:mdxVersion,requestId:"mdx-install" };
  const source=sixFiles().files[0];
  await manager.preflightQuota(source.size,identity);
  const worker=createRichMdictImportWorkerHandler({store,cryptoProvider:webcrypto,postMessage(){}});
  const ready=await worker.handleMessage({type:MDX.START,requestId:identity.requestId,input:{file:source,...identity}});
  assert.equal(ready.type,MDX.READY);
  await manager.commit({...identity,metadata:ready.metadata,...(intent ? {attachmentIntent:intent}:{})});
  function resources(extra={}) {return createRichMddResourceManager({...dependencies,...extra});}
  return {store,stateStore,manager,dependencies,resources,setToken(value){token=value;}};
}
function request(version="import-res-12345678",id="resource-import") {return {dictionaryId:packId,requestId:id,resourceVersion:version,mdxFileName:"Book.mdx",expectedMdxVersion:mdxVersion};}
async function stage(env, input=request(), selected=sixFiles().files.slice(1,5)) {
  const report=await preflightRichAttachments({files:selected,mdxFileName:"Book.mdx"});
  const grouped=resolveAssociatedRichResourceFiles(report.resources.associatedMdd,report.resources.associatedSidecars,selected);
  const active=(await env.stateStore.read()).packs[packId].active;
  const resources=env.resources();
  await resources.preflight({...input,mdxSourceBytes:active.sourceSize,files:grouped.mddFiles.map(file=>({fileName:file.name,size:file.size})),sidecars:report.resources.associatedSidecars.map(item=>({path:item.path,size:item.sourceBytes,kind:item.kind,mime:item.mime}))});
  const worker=createMddResourceImportWorkerHandler({store:env.store,cryptoProvider:webcrypto,postMessage(){}});
  const ready=await worker.handleMessage({type:MDD.START,requestId:input.requestId,input:{...input,files:grouped.mddFiles,sidecars:grouped.sidecars}});
  assert.equal(ready.type,MDD.READY);
  return {resources,ready,input};
}
async function attach(env,input=request(),selected) {const staged=await stage(env,input,selected);await staged.resources.commit({...input,metadata:staged.ready.metadata});return staged;}

test("six selected files ignore JS without one read; attachment preflight uses identical association and unknown files block",async()=>{
  const fixture=sixFiles(); const report=await preflightLocalDictionaryFiles({files:fixture.files});
  assert.equal(report.compatibility.status,"supported");assert.equal(fixture.reads,0);
  assert.deepEqual(report.resources.ignoredFiles,[{fileName:"dictionary.js",size:999,reason:"script_not_executed"}]);
  assert.deepEqual(report.resources.unassociatedFiles,[]);assert.equal(report.resources.associatedMdd.length,2);assert.equal(report.resources.associatedSidecars.length,2);
  assert.equal(report.estimates.sourceBytes,fixture.files.reduce((sum,file)=>sum+file.size,0));
  const only=await preflightRichAttachments({files:fixture.files.slice(1),mdxFileName:"Book.mdx"});
  assert.deepEqual(only.resources.associatedSidecars,report.resources.associatedSidecars);assert.equal(fixture.reads,0);
  for(const files of [[...fixture.files.slice(1),file("unknown.bin","x")],[fixture.files[3]],[file("Other.mdd",makeMdd([["x",png]]))],[fixture.files[1],file("BOOK.CSS","x"),file("book.css","y")]]) {
    assert.equal((await preflightRichAttachments({files,mdxFileName:"Book.mdx"})).compatibility.status,"invalid");
  }
});
test("controller sends only supported attachments to worker/store; expected MDX is passed at reserve and commit",async()=>{
  const fixture=sixFiles(), report=await preflightRichAttachments({files:fixture.files.slice(1),mdxFileName:"Book.mdx"});
  const selected=resolveAssociatedRichResourceFiles(report.resources.associatedMdd,report.resources.associatedSidecars,fixture.files);
  const messages=[],workers=[];
  class Worker { constructor(){workers.push(this);this.listeners=new Set();} addEventListener(type,fn){if(type==="message")this.listeners.add(fn);} removeEventListener(type,fn){this.listeners.delete(fn);} terminate(){} postMessage(value){this.input=value.input;queueMicrotask(()=>{for(const fn of this.listeners)fn({data:{type:MDD.READY,requestId:value.requestId,metadata:{resources:[],sidecars:[]}}});});} }
  const controller=createMddResourceImportController({WorkerCtor:Worker,cryptoProvider:webcrypto,runtime:{getURL:path=>path,async sendMessage(value){messages.push(value);return {ok:true};}}});
  await controller.attachResources({...request(),mdxSourceBytes:fixture.files[0].size,files:selected.mddFiles,sidecars:selected.sidecars});
  assert.equal(workers[0].input.files.length,2);assert.equal(workers[0].input.sidecars.length,2);assert.equal(JSON.stringify(messages).includes("dictionary.js"),false);assert.equal(fixture.reads,0);
  assert.equal(messages[0].expectedMdxVersion,mdxVersion);assert.equal(messages[1].expectedMdxVersion,mdxVersion);
});
test("storage.session singleflight is stable through worker recreation, secure and not content-exposed",async()=>{
  const storageArea=area();let rng=0;const cryptoProvider={getRandomValues(bytes){rng++;bytes.fill(3);}};
  const options={storageArea,cryptoProvider};const values=await Promise.all(Array.from({length:10},()=>getRichResourceBrowserSession(options)));
  assert.equal(new Set(values).size,1);assert.equal(rng,1);assert.equal(storageArea.writes,1);assert.equal(values[0],"03".repeat(32));
  const recreated={...storageArea,values:storageArea.values};assert.equal(await getRichResourceBrowserSession({storageArea:recreated,cryptoProvider}),values[0]);assert.equal(rng,1);
  assert.notEqual(await getRichResourceBrowserSession({storageArea:area(),cryptoProvider:webcrypto}),values[0]);
  assert.ok(storageArea.values[RICH_RESOURCE_SESSION_KEY]);assert.equal(Object.hasOwn(storageArea,"setAccessLevel"),false);
});
test("initial attachment intent survives browser restart and stale reservations clean only staged data",async()=>{
  const e=await env();await stage(e);e.setToken(newToken);
  const list=await createRichMdictManager(e.dependencies).list();assert.equal(list.dictionaries[0].resourceRecovery.errorCode,"interrupted");
  assert.deepEqual(await e.store.listVersions(packId),[mdxVersion]);assert.deepEqual((await e.stateStore.read()).resourceReservations,{});
  await attach(e,request("import-new-12345678","new-import"));assert.equal((await e.manager.list()).dictionaries[0].resourceRecovery,undefined);
  assert.equal((await e.resources().lookupResource({dictionaryId:packId,path:"book.css"})).found,true);
});
test("same-browser reservations remain busy in another manager/SW; a different-token preflight releases them",async()=>{
  const e=await env();await stage(e);
  await assert.rejects(e.resources().preflight({...request("import-other-12345678","other"),files:[{fileName:"Book.mdd",size:123}]}),{code:"RICH_MDD_BUSY"});
  assert.equal((await e.manager.list()).dictionaries[0].resourceRecovery.errorCode,"pending");
  e.setToken(newToken);await e.resources().preflight({...request("import-next-12345678","next"),files:[{fileName:"Book.mdd",size:123}]});
  assert.equal((await e.stateStore.read()).resourceReservations.next.browserSessionToken,newToken);
});
test("legacy no-token reservation migrates; active/fallback/referenced versions are never removed",async()=>{
  const e=await env();await attach(e);const active=(await e.stateStore.read()).packs[packId].active;
  await e.stateStore.update(state=>{state.resourceReservations={legacy:{packId,resourceVersion:active.resources.packVersion},mdx:{packId,resourceVersion:mdxVersion}};return state;});
  await e.manager.list();assert.equal(e.store.removed.includes(active.resources.packVersion),false);assert.equal(e.store.removed.includes(mdxVersion),false);
  assert.equal((await e.resources().lookupResource({dictionaryId:packId,path:"book.css"})).found,true);
});
test("full reselection atomically replaces the resource set, not incremental merge; no JS persists",async()=>{
  const e=await env();await attach(e);await attach(e,request("import-reselect-12345678","reselect"),[sixFiles().files[1]]);
  const active=(await e.stateStore.read()).packs[packId].active;assert.equal(active.resources.sources.length,1);assert.equal((active.resources.sidecars || []).length,0);
  assert.equal((await e.resources().lookupResource({dictionaryId:packId,path:"book.css"})).found,false);
  assert.equal([...e.store.files.keys()].some(key=>key.endsWith(".js")),false);assert.equal(JSON.stringify(active).includes("dictionary.js"),false);
});
for(const kind of ["quota","copy","checksum","state","cancel","mdx-drift","uninstall","late-commit"])test(`${kind} cannot replace a healthy resource pointer`,async()=>{
  const e=await env();await attach(e);const healthy=structuredClone((await e.stateStore.read()).packs[packId].active.resources);
  const input=request("import-failed-12345678","failed");
  if(kind==="quota") { await assert.rejects(e.resources({storageManager:{async estimate(){return {usage:100,quota:101};}}}).preflight({...input,files:[{fileName:"Book.mdd",size:123}]}),{code:"RICH_MDD_QUOTA"}); }
  else if(kind==="copy") {e.store.failWrite=true;await assert.rejects(stage(e,input));e.store.failWrite=false;await e.resources().abortImport(input);}
  else {
    const staged=await stage(e,input);
    if(kind==="checksum")e.store.files.set(e.store.key(packId,input.resourceVersion,"resources/000.index.json"),new Uint8Array(staged.ready.metadata.resources[0].indexSize));
    if(kind==="mdx-drift")await e.stateStore.update(state=>{state.packs[packId].active.packVersion="import-drift-12345678";return state;});
    if(kind==="uninstall")await e.manager.uninstall(packId);
    if(kind==="late-commit")e.setToken(newToken);
    let manager=staged.resources;
    if(kind==="state")manager=e.resources({stateStore:{read:e.stateStore.read,update:async()=>{throw new Error("storage failed");}}});
    if(kind==="cancel") {
      let release,entered;const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
      manager=e.resources({buildIndex:async options=>{entered();await gate;return (await import("../src/background/packs/importers/mdd.js")).buildMddIndex(options);}});
      const pending=manager.commit({...input,metadata:staged.ready.metadata});await reached;assert.equal(manager.cancel(input.requestId).cancelled,true);release();await assert.rejects(pending,{name:"AbortError"});
    } else await assert.rejects(manager.commit({...input,metadata:staged.ready.metadata}));
  }
  if(kind!=="uninstall")assert.deepEqual((await e.stateStore.read()).packs[packId].active.resources,healthy);
  if(!["mdx-drift","uninstall","late-commit","state"].includes(kind))assert.equal((await e.manager.list()).dictionaries[0].resourceRecovery.previousResourcesAvailable,true);
});
test("MDX-only installs have no incomplete state, and malformed recovery metadata cannot leak to public DTO",async()=>{
  const e=await env(null);assert.equal((await e.manager.list()).dictionaries[0].resourceRecovery,undefined);
  const active=(await e.stateStore.read()).packs[packId].active;
  for(const value of [{expectedMdxVersion:mdxVersion,mddCount:1,sidecarCount:0,errorCode:"pending",privatePath:"secret"},{expectedMdxVersion:mdxVersion,mddCount:0,sidecarCount:0,errorCode:"pending"},{expectedMdxVersion:"bad",mddCount:1,sidecarCount:0,errorCode:"pending"}]){
    assert.equal(normalizeResourceRecovery(value,mdxVersion),null);assert.equal(publicRichDictionary({active:{...active,resourceRecovery:value}}).resourceRecovery,undefined);
  }
});

test("activation commitpoint rejects late cancellation and returns actual committed resources",async()=>{
  const e=await env();const staged=await stage(e);
  let release,entered;const reached=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const stateStore={read:e.stateStore.read,update:async mutator=>{const result=await e.stateStore.update(mutator);entered();await gate;return result;}};
  const manager=e.resources({stateStore});const pending=manager.commit({...staged.input,metadata:staged.ready.metadata});
  await reached;assert.deepEqual(manager.cancel(staged.input.requestId),{cancelled:false,phase:"commitpoint"});release();
  assert.equal((await pending).attached,true);assert.equal((await e.manager.list()).dictionaries[0].resourceRecovery,undefined);
});
test("stale cleanup respects fallback, MDX install reservations and current-browser resource references",async()=>{
  const e=await env();await attach(e);
  const protectedVersions=["import-fallback-12345678","import-mdxstage-12345678","import-current-12345678"];
  for(const version of protectedVersions)await e.store.writeFile(packId,version,"keep.bin",Uint8Array.of(1));
  await e.stateStore.update(state=>{
    state.packs[packId].fallback={packVersion:protectedVersions[0]};state.reservations={mdx:{packId,packVersion:protectedVersions[1]}};
    state.resourceReservations={live:{packId,resourceVersion:protectedVersions[2],browserSessionToken:oldToken},
      ...Object.fromEntries(protectedVersions.map((resourceVersion,index)=>[`stale${index}`,{packId,resourceVersion}]))};return state;
  });
  await e.manager.list();for(const version of protectedVersions)assert.equal(e.store.removed.includes(version),false);
  assert.deepEqual(Object.keys((await e.stateStore.read()).resourceReservations),["live"]);
});
test("preflight serializes two Options owners and malformed intent is rejected without activating MDX",async()=>{
  const e=await env();const resources=e.resources();
  const outcomes=await Promise.allSettled(["one","two"].map(id=>resources.preflight({...request(`import-${id}-12345678`,id),files:[{fileName:"Book.mdd",size:123}]})));
  assert.equal(outcomes.filter(item=>item.status==="fulfilled").length,1);assert.equal(outcomes.find(item=>item.status==="rejected").reason.code,"RICH_MDD_BUSY");
  assert.throws(()=>makeResourceRecovery({ mddCount: 1, sidecarCount: 0, privatePath: "forbidden" }, mdxVersion), { code: "RICH_MDD_INPUT" });
  assert.throws(()=>makeResourceRecovery({ mddCount: 0, sidecarCount: 0 }, mdxVersion), { code: "RICH_MDD_INPUT" });
});
