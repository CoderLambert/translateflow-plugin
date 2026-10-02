// Registered inside the existing storage suite: same actual WXT copy/profile/setup, no second fixture runtime.
import { READING_METHOD as M, READING_ERROR as E } from '../src/shared/reading/constants.js';
import { request, artifact } from '../tests/fixtures/reading/contract.mjs';

export function registerStorageRegressions(test, expect, environment) {
  test('Compiled viewed update advances the actual Content summary/port revision without changing catalog', async () => {
    const { driver, message, openContent } = environment();
    const state = await message(M.GET_RECORDING_STATE); expect((await message(M.SET_RECORDING, {expectedConsentGeneration:state.data.consentGeneration})).ok).toBe(true);
    const content = await openContent(), operationId = crypto.randomUUID();
    const prepared = await content.send(request(M.BEGIN_QUERY, {operationId,pageKey:content.registration.pageKey,sourceSnapshot:content.snap})); expect(prepared.ok).toBe(true);
    const value = artifact('dictionary', {recordId:prepared.data.token.recordId,operationId,sourceSnapshotId:content.snap.sourceSnapshotId});
    expect((await content.send(request(M.SAVE_QUERY_RESULT, {token:prepared.data.token,artifact:value}))).ok).toBe(true);
    await driver.evaluate((tabId) => chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:() => {
      globalThis.__viewedSignals=[]; globalThis.__viewedPort=chrome.runtime.connect({name:'reading.invalidate'});
      __viewedPort.onMessage.addListener((value)=>__viewedSignals.push(value));
    }}), content.tabId);
    const signals = async () => {const [result] = await driver.evaluate((tabId)=>chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func:()=>__viewedSignals}),content.tabId);return result.result;};
    await expect.poll(async()=> (await signals()).length).toBeGreaterThan(0);
    const before = await content.send(request(M.GET_PAGE_SUMMARY)), catalog = await message(M.LIST_RECORDS);
    const detail = await message(M.GET_RECORD, {recordId:value.recordId}); expect(detail.ok).toBe(true);
    const after = await content.send(request(M.GET_PAGE_SUMMARY)); expect(after.ok).toBe(true);
    expect(after.data.items[0].revision).toBeGreaterThan(before.data.items[0].revision);
    expect(after.data.pageRevision).toBe(before.data.pageRevision+1);
    await expect.poll(async()=> (await signals()).at(-1).pageRevision).toBe(after.data.pageRevision);
    for(const signal of await signals()) expect(Object.keys(signal).sort()).toEqual(['consentGeneration','dataGeneration','pageRevision','protocolVersion','type']);
    expect((await message(M.LIST_RECORDS)).data.catalogRevision).toBe(catalog.data.catalogRevision);
    expect(detail.data.record.lookupCount).toBe(1); await content.page.close();
  });

  test('Native viewed update affects only its page and keeps an existing global catalog cursor usable', async () => {
    const result = await environment().probeWorker.evaluate(async () => {
      const p=__probe;await p.enable(p.repo);const first=await p.begin(p.repo);const a=await p.save(p.repo,first);
      const otherPage=`rp1:${'d'.repeat(64)}`, owner=p.access('content',{pageKey:otherPage,safeReturnUrl:'https://example.test/other'});
      await p.save(p.repo,await p.begin(p.repo,{pageKey:otherPage,access:owner}));
      const own=p.ctx(p.M.GET_PAGE_SUMMARY,{},'content'), other={...own,access:owner};
      const before={own:await p.repo.read(own),other:await p.repo.read(other),meta:(await p.counts()).meta,
        ownSignal:await p.repo.readInvalidationState(own),otherSignal:await p.repo.readInvalidationState(other)};
      const list=p.ctx(p.M.LIST_RECORDS,{limit:1});const firstPage=await p.repo.read(list);p.clock=2000;
      const detail=await p.repo.read(p.ctx(p.M.GET_RECORD,{recordId:a.recordId}));
      const after={own:await p.repo.read(own),other:await p.repo.read(other),meta:(await p.counts()).meta,
        ownSignal:await p.repo.readInvalidationState(own),otherSignal:await p.repo.readInvalidationState(other)};
      const continuation=await p.repo.read({...list,request:{...list.request,cursor:firstPage.nextCursor}});
      return {before,after,revision:detail.record.revision,ids:[firstPage.items[0].recordId,continuation.items[0].recordId]};
    });
    expect(result.revision).toBe(2);expect(result.after.own.pageRevision).toBe(result.before.own.pageRevision+1);
    expect(result.after.ownSignal.pageRevision).toBe(result.before.ownSignal.pageRevision+1);
    expect(result.after.other).toEqual(result.before.other);expect(result.after.otherSignal).toEqual(result.before.otherSignal);
    expect(result.after.meta.catalogRevision).toBe(result.before.meta.catalogRevision);expect(result.after.meta.exportRevision).toBe(result.before.meta.exportRevision+1);
    expect(result.after.meta.dataGeneration).toBe(result.before.meta.dataGeneration);expect(new Set(result.ids).size).toBe(2);
  });

  test('Native malformed meta values fail closed without changing canonical rows or generations; valid state recovers', async () => {
    const result=await environment().probeWorker.evaluate(async()=> {
      const p=__probe;await p.enable(p.repo);await p.save(p.repo,await p.begin(p.repo));const original=await p.counts(), db=await p.rawDatabase();
      const put=(value)=>new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(value,'state');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
      const cases=[];
      try { for(const value of [false,null,0,{}]) {
        await put(value);const before=await p.counts();let readError,writeError;
        try {await p.repo.read(p.ctx(p.M.GET_RECORDING_STATE));}catch(error){readError=error.code;}
        try {await p.repo.mutate(p.ctx(p.M.SET_RECORDING,{expectedConsentGeneration:original.meta.consentGeneration}));}catch(error){writeError=error.code;}
        cases.push({value,readError,writeError,before,after:await p.counts()});
      }} finally {await put(original.meta);db.close();}
      p.repo.close();p.repo=p.factory({now:()=>p.clock});return {original,cases,recovered:await p.repo.read(p.ctx(p.M.GET_RECORDING_STATE)),after:await p.counts()};
    });
    for(const item of result.cases){expect(item.readError).toBe(E.STORAGE);expect(item.writeError).toBe(E.STORAGE);expect(item.after).toEqual(item.before);expect(item.after.records).toBe(1);expect(item.after.meta).toEqual(item.value);}
    expect(result.after).toEqual(result.original);expect(result.recovered).toMatchObject({enabled:true,recordCount:1,dataGeneration:result.original.meta.dataGeneration,consentGeneration:result.original.meta.consentGeneration});
  });
}
