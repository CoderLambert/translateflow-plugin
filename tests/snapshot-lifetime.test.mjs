import test from 'node:test';
import assert from 'node:assert/strict';
import * as snapshots from '../src/background/effective-config-snapshots.js';
function storage(t){const old=globalThis.chrome;const memory={provider:'openai-compatible',model:'synthetic',targetLanguage:'Chinese',prompt:'Translate',openAICompatible:{baseUrl:'http://localhost:1234/v1',model:'synthetic',apiKey:''}};globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries((keys===null?Object.keys(memory):Array.isArray(keys)?keys:[keys]).filter(k=>Object.hasOwn(memory,k)).map(k=>[k,memory[k]])),set:async patch=>Object.assign(memory,patch)}}};t.after(()=>{snapshots.invalidateTranslationSnapshots();globalThis.chrome=old});return memory;}
test('long active requests retain frozen config across pruning and leave time for cache commit',async t=>{
 storage(t);let now=1000000;t.mock.method(Date,'now',()=>now);
 const page='https://synthetic.test/a',snapshot=await snapshots.createEffectiveConfigSnapshot(page);
 await snapshots.withEffectiveConfigSnapshot(snapshot.id,page,null,async config=>{
  now+=6*60*1000;await snapshots.createEffectiveConfigSnapshot('https://synthetic.test/b');
  assert.equal(await snapshots.resolveEffectiveConfigSnapshot(snapshot.id,page),config);
 });
 assert.equal((await snapshots.resolveEffectiveConfigSnapshot(snapshot.id,page)).model,'synthetic');
 now+=4*60*1000;await snapshots.resolveEffectiveConfigSnapshot(snapshot.id,page);
 now+=4*60*1000;await snapshots.resolveEffectiveConfigSnapshot(snapshot.id,page);
 now+=6*60*1000;await assert.rejects(snapshots.resolveEffectiveConfigSnapshot(snapshot.id,page),{code:'CONFIG_SNAPSHOT_EXPIRED'});
});
test('an active pin does not resurrect a snapshot invalidated by settings changes',async t=>{
 storage(t);const page='https://synthetic.test/a',snapshot=await snapshots.createEffectiveConfigSnapshot(page);
 await snapshots.withEffectiveConfigSnapshot(snapshot.id,page,null,async()=>{snapshots.invalidateTranslationSnapshots();});
 await assert.rejects(snapshots.resolveEffectiveConfigSnapshot(snapshot.id,page),{code:'CONFIG_SNAPSHOT_EXPIRED'});
});
