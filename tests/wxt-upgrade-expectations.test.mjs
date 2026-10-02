import { test } from "node:test";
import assert from "node:assert/strict";
import { assertUnchangedUpgradeSnapshot } from "../e2e/support/upgrade-expectations.mjs";

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
