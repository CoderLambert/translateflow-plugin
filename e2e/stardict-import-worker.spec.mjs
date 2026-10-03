import { test, expect } from "./support/extension-fixture.mjs";
import { WORKER_PATHS } from "../src/shared/runtime-assets.js";

test("Settings StarDict controller transfers into a Dedicated Worker and activates only after background revalidation", async ({ harness }) => {
  const page=await harness.context.newPage();
  // Observe native Worker and runtime messages before the compiled Options entry
  // initializes. No controller/source module is added to the artifact.
  await page.addInitScript(() => {
    if(location.protocol!=="chrome-extension:")return;
    const probe=globalThis.__tfStarDictProbe={workers:[],messages:[],phases:[]};
    const NativeWorker=globalThis.Worker;
    globalThis.Worker=class extends NativeWorker {
      constructor(url,options) {
        super(url,options);this.probe={url:String(url),options,messages:[],transfers:[],terminated:false};
        probe.workers.push(this.probe);this.addEventListener("message",event=>this.probe.messages.push(event.data));
      }
      postMessage(message,transfer) {const refs=Array.isArray(transfer)?transfer:[];
        super.postMessage(message,transfer);this.probe.transfers.push(refs.map(item=>item.byteLength));}
      terminate(){this.probe.terminated=true;return super.terminate();}
    };
    const nativeSend=chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage=function(message,...args){
      const result=nativeSend(message,...args);
      if(message?.type==="DICTIONARY_LOCAL_IMPORT_COMMIT"){
        const entry={message,result:null};probe.messages.push(entry);
        Promise.resolve(result).then(value=>{entry.result=value});
      }
      return result;
    };
  });
  await page.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await page.evaluate(()=>{
    const progress=document.querySelector("#localDictionaryImportProgress");
    const observer=new MutationObserver(records=>{
      const phases=records.filter(record=>record.attributeName==="data-phase");
      for(let i=0;i<phases.length;i++)globalThis.__tfStarDictProbe.phases.push(
        i+1<phases.length?phases[i+1].oldValue:progress.dataset.phase);
    });observer.observe(progress,{attributes:true,attributeOldValue:true,attributeFilter:["data-phase"]});
  });
  const translation=Buffer.from("工作词条"),word=Buffer.from("workerlexeme"),numbers=Buffer.alloc(8);
  numbers.writeUInt32BE(translation.length,4);
  const idx=Buffer.concat([word,Buffer.from([0]),numbers]);
  const ifo=Buffer.from(["StarDict's dict ifo file","version=2.4.2","bookname=Worker E2E","wordcount=1",
    `idxfilesize=${idx.length}`,"sametypesequence=m",""].join("\n"));
  await page.locator("#localDictionaryFiles").setInputFiles([
    {name:"worker.ifo",mimeType:"text/plain",buffer:ifo},
    {name:"worker.idx",mimeType:"application/octet-stream",buffer:idx},
    {name:"worker.dict",mimeType:"application/octet-stream",buffer:translation}
  ]);
  await expect(page.locator("#localDictionaryPreflightSummary")).toContainText("Worker E2E");
  await page.locator("#localDictionarySemanticConfirmation").check();
  await expect(page.locator("#localDictionaryImportButton")).toBeEnabled();
  await page.evaluate(()=>{globalThis.__tfStarDictProbe.phases=[]});
  await page.locator("#localDictionaryImportButton").click();
  await expect(page.locator("#localDictionaryImportProgress")).toContainText("完成");
  await expect(page.locator("#localDictionaryImport")).toHaveAttribute("data-busy","false");
  await expect(page.locator("#localDictionaryCancelButton")).toBeHidden();
  const result=await page.evaluate(async workerPath=>{
    const p=globalThis.__tfStarDictProbe;
    const workers=p.workers.filter(w=>new URL(w.url).pathname===`/${workerPath}`);
    const worker=workers[0];const ready=worker.messages.find(m=>m.type==="stardict-import:ready");
    const commit=p.messages.find(m=>m.message.token===ready?.token);
    const lookup=await chrome.runtime.sendMessage({type:"LEXICAL_LOOKUP",text:"workerlexeme",pageUrl:"https://worker-e2e.invalid/",sourceLanguage:"en",targetLanguage:"zh-CN"});
    let tokenStillExists=false;
    try {const root=await navigator.storage.getDirectory();const quarantine=await root.getDirectoryHandle("dictionary-import-quarantine");await quarantine.getDirectoryHandle(ready.token);tokenStillExists=true;}
    catch(error){if(error.name!=="NotFoundError")throw error;}
    return {workers:workers.length,worker,ready,commit,lookup,tokenStillExists,phases:p.phases};
  },WORKER_PATHS.stardictImport);
  expect(result.workers).toBe(1);expect(result.worker.options).toEqual({type:"module"});
  expect(result.worker.terminated).toBe(true);expect(result.worker.transfers).toEqual([[0,0,0]]);
  expect(result.ready.packId).toMatch(/^local-stardict-/);
  expect(result.ready.packVersion).toMatch(/^import-[a-z0-9]+-[a-f0-9]{8}$/);
  expect(result.ready.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(result.phases).toEqual(["read","convert","stage","stage","stage","commit","done"]);
  expect(result.worker.messages.filter(m=>m.type==="stardict-import:progress"&&m.phase==="stage").map(m=>m.path))
    .toEqual(["entries.dat","index.dat","manifest.json"]);
  expect(result.commit.message.token).toBe(result.ready.token);
  expect(result.commit.result).toMatchObject({ok:true,status:"imported"});
  expect(result.tokenStillExists).toBe(false);
  expect(result.lookup).toMatchObject({ok:true,status:"candidates"});
  const local=result.lookup.candidates.find(candidate=>candidate.provenance?.packId===result.ready.packId);
  expect(local).toBeTruthy();expect(local.translations).toContain("工作词条");expect(harness.server.calls).toHaveLength(0);
  await page.close();
});
