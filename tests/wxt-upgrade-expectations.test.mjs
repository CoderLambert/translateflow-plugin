import { test } from "node:test";
import assert from "node:assert/strict";
import { assertUnchangedUpgradeSnapshot, expectedStorageAfterInstalledUpdate, assertRecoveredDatabases } from "../e2e/support/upgrade-expectations.mjs";

test("same-version upgrade rejects implicit locale writes and loss of any persisted data",()=>{
  const before={storage:{targetLanguage:"Chinese",extra:{keep:true}},databases:[{version:2}],opfs:[{sha256:"old"}],registrations:[{id:"old"}]};
  const copy=structuredClone(before);
  assert.doesNotThrow(()=>assertUnchangedUpgradeSnapshot(before,copy));
  for(const mutate of [
    after=>{after.storage.uiLocale="auto";},
    after=>{delete after.storage.targetLanguage;},
    after=>{after.storage.extra.keep=false;},
    after=>{after.databases[0].version=3;},
    after=>{after.opfs[0].sha256="changed";},
    after=>{after.registrations=[];}
  ]) {
    const after=structuredClone(before);mutate(after);
    assert.throws(()=>assertUnchangedUpgradeSnapshot(before,after),assert.AssertionError);
  }
  assert.deepEqual(before,copy);
});

test("only an observed native update for the exact old version authorizes the new missing locale default",()=>{
  const before={targetLanguage:"Chinese",extra:{keep:true}};
  const event={reason:"update",previousVersion:"0.8.0"};
  assert.deepEqual(expectedStorageAfterInstalledUpdate(before,event,"0.8.0"),{...before,uiLocale:"auto"});
  assert.deepEqual(before,{targetLanguage:"Chinese",extra:{keep:true}});
  for(const nativeEvent of [undefined,{reason:"install"},{reason:"chrome_update"},
    {reason:"update"},{reason:"update",previousVersion:"0.7.0"}]) {
    assert.throws(()=>expectedStorageAfterInstalledUpdate(before,nativeEvent,"0.8.0"),assert.AssertionError);
  }
  for(const uiLocale of ["auto","en","zh_CN","unknown-value",null]) {
    const existing={...before,uiLocale};
    assert.deepEqual(expectedStorageAfterInstalledUpdate(existing,event,"0.8.0"),existing);
  }
});

test("upgrade retains every existing UI-locale value including unknown and null values",()=>{
  for(const uiLocale of ["auto","en","zh_CN","unknown-value",null]) {
    const before={storage:{uiLocale,extra:1},databases:[],opfs:[],registrations:[]};
    assert.doesNotThrow(()=>assertUnchangedUpgradeSnapshot(before,structuredClone(before)));
    const removed=structuredClone(before);delete removed.storage.uiLocale;
    assert.throws(()=>assertUnchangedUpgradeSnapshot(before,removed),assert.AssertionError);
    const changed=structuredClone(before);changed.storage.uiLocale="replacement";
    assert.throws(()=>assertUnchangedUpgradeSnapshot(before,changed),assert.AssertionError);
  }
});

function seededDatabases() {
  return [{ name:"ai_bilingual_translator",version:2,stores:{
    translations:[0,1,2].map(id=>({cacheKey:"key-"+id,pageKey:"page",sourceHash:"source-"+id,configHash:"config",
      sourceText:"text-"+id,translation:"translation-"+id,createdAt:100,lastAccessedAt:200,bytes:123})),
    pages:[{pageKey:"page",url:"https://fixture.invalid/article",title:"Fixture",createdAt:100,lastAccessedAt:200}],
    selection_explanations:[{cacheKey:"selection",explanation:"preserved",lastAccessedAt:200}]
  }}];
}

test("cache recovery compares all content/stores canonically and permits only valid read metadata",()=>{
  const before=seededDatabases(),valid=structuredClone(before);
  valid[0].stores.translations.reverse();
  for(const row of [...valid[0].stores.translations,...valid[0].stores.pages])row.lastAccessedAt=300;
  assert.doesNotThrow(()=>assertRecoveredDatabases(before,valid,400));
  assert.deepEqual(before,seededDatabases());
  const mutations=[
    db=>{db[0].stores.translations[0].translation="corrupted";},
    db=>{db[0].stores.translations[0].sourceText="corrupted";},
    db=>{db[0].stores.translations[0].cacheKey="changed";},
    db=>{db[0].stores.translations[0].configHash="changed";},
    db=>{db[0].stores.translations[0].bytes=0;},
    db=>{db[0].stores.translations[0].createdAt=999;},
    db=>{db[0].stores.translations[0].lastAccessedAt=199;},
    db=>{db[0].stores.translations[0].lastAccessedAt=401;},
    db=>{delete db[0].stores.translations[0].lastAccessedAt;},
    db=>{db[0].stores.pages=[];},
    db=>{db[0].stores.pages[0].title="corrupted";},
    db=>{db[0].stores.selection_explanations=[];},
    db=>{db[0].stores.selection_explanations[0].lastAccessedAt=300;},
    db=>{db[0].version=3;},
    db=>{db[0].name="different";},
    db=>{delete db[0].stores.selection_explanations;},
    db=>{db[0].stores.extra=[];},
    db=>{db.push({name:"unexpected",version:1,stores:{}});}
  ];
  for(const mutate of mutations){
    const bad=structuredClone(before);mutate(bad);
    // Every adversarial snapshot passes the superseded three-row guard.
    assert.equal(bad[0].stores.translations.length,3);
    assert.throws(()=>assertRecoveredDatabases(before,bad,400),assert.AssertionError);
  }
});
