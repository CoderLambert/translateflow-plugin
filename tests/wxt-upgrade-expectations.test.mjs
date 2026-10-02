import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedUpgradeSnapshot } from "../e2e/support/upgrade-expectations.mjs";

test("upgrade permits only the absent UI-locale default without changing old data",()=>{
  const before={storage:{targetLanguage:"Chinese",extra:{keep:true}},databases:[{version:2}],opfs:[{sha256:"old"}],registrations:[{id:"old"}]};
  const copy=structuredClone(before);
  assert.deepEqual(expectedUpgradeSnapshot(before),{...before,storage:{...before.storage,uiLocale:"auto"}});
  assert.deepEqual(before,copy);
});

test("upgrade retains every existing UI-locale value including unknown and null values",()=>{
  for(const uiLocale of ["auto","en","zh_CN","unknown-value",null]) {
    const before={storage:{uiLocale,extra:1},databases:[],opfs:[],registrations:[]};
    assert.deepEqual(expectedUpgradeSnapshot(before),before);
  }
});
