import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { openRequestBudget } from "../scripts/automation-budget.mjs";
import { validateAutomationConfig } from "../scripts/automation-config.mjs";
import { renderAutomationReport, redact } from "../scripts/automation-report.mjs";
import { startBudgetRelay } from "../scripts/automation-relay.mjs";
import { productionInputStamp } from "../scripts/automation-inputs.mjs";
import { runtimeAssetRoots } from "../scripts/wxt-assets.mjs";

test("physical attempts reserve durably before forwarding; reopening never resets the limit", () => {
  const dir=mkdtempSync(join(tmpdir(),"tf-budget-"));
  try {
    const path=join(dir,"ledger.json"),options={campaignId:"test-campaign",maxRequests:20};
    let budget=openRequestBudget(path,options);
    for(let i=0;i<8;i++)budget.reserve();
    budget=openRequestBudget(path,options);
    for(let i=0;i<12;i++)budget.reserve();
    assert.throws(()=>budget.reserve(),{code:"TEST_BUDGET"});
    assert.equal(openRequestBudget(path,options).count(),20);
    assert.throws(()=>openRequestBudget(path,{...options,maxRequests:19}));
    assert.throws(()=>openRequestBudget(join(dir,"bad"),{campaignId:"x"}));
    writeFileSync(path,'{"campaignId":"test-campaign","maxRequests":20,"attempts":[{}]}');
    assert.throws(()=>openRequestBudget(path,options));
  } finally {rmSync(dir,{recursive:true});}
});
test("configuration rejects budget widening, arbitrary credential destinations and nonisolated profiles",()=>{
  const c={schemaVersion:1,campaignId:"test-campaign",artifact:".output/chrome-mv3",outputBase:"/tmp/report",browser:{useIsolatedTestProfile:true},realAi:{enabled:true,baseUrl:"https://api.deepseek.com",protocol:"openai-chat",model:"deepseek-flash",maxRequests:20,maxOutputTokens:1024}};
  assert.equal(validateAutomationConfig(c).realAi.maxRequests,20);
  for(const patch of [{maxRequests:21},{baseUrl:"https://evil.invalid"},{maxOutputTokens:0}])assert.throws(()=>validateAutomationConfig({...c,realAi:{...c.realAi,...patch}}));
  assert.throws(()=>validateAutomationConfig({...c,browser:{useIsolatedTestProfile:false}}));
  assert.throws(()=>validateAutomationConfig({...c,realAi:{...c.realAi,enabled:"false"}}));
});
test("artifact freshness follows runtime/build inputs and ignores local reports and tests",async()=>{
  const root=mkdtempSync(join(tmpdir(),"tf-inputs-"));
  const put=(path,text="")=>{const full=join(root,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,text);};
  try{
    for(const path of [...runtimeAssetRoots(),"manifest.json","package.json","package-lock.json","background.js","content.js","popup.js","popup.html","popup.css","options.js","options.html","options.css","content.css","wxt.config.mjs","scripts/build-extension.mjs","src/feature.js","entrypoints/content.ts","_locales/en/messages.json"])put(path);
    const first=await productionInputStamp(root);
    put("docs/task-execution/local/private.json","not a runtime input");put("tests/new.test.mjs","not a build input");
    assert.equal(await productionInputStamp(root),first);
    put("src/feature.js","export const updated = true;");assert.notEqual(await productionInputStamp(root),first);
    unlinkSync(join(root,"src/feature.js"));assert.notEqual(await productionInputStamp(root),first);
    unlinkSync(join(root,"options.js"));assert.match(await productionInputStamp(root),/^[a-f0-9]{64}$/u);
  }finally{rmSync(root,{recursive:true});}
});
test("visual report escapes external messages, refuses image traversal and redacts supplied credentials",()=>{
  const report={steps:[{title:'<img src=x onerror=alert(1)>',status:'FAIL',detail:'<script>alert(1)</script>',image:'../secret.png'}]};
  const html=renderAutomationReport(report);
  assert(!html.includes('<script>alert(1)</script>'));assert(!html.includes('src="../secret.png"'));assert(html.includes('&lt;img'));
  assert.equal(redact("token private-example-secret and sk-0123456789abcdef",["private-example-secret"]),"token [REDACTED] and [REDACTED]");
});
test("relay refuses unauthorized requests and exhausted budgets before calling any upstream",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"tf-relay-")),budget=openRequestBudget(join(dir,"ledger.json"),{campaignId:"test-campaign",maxRequests:1});
  const relay=await startBudgetRelay({realAi:{model:"deepseek-flash",maxOutputTokens:128,baseUrl:"https://not-called.invalid"}},"synthetic-test-key",budget);
  try {
    const body=JSON.stringify({model:"deepseek-flash",stream:false,messages:[]});
    assert.equal((await fetch(relay.baseUrl+'/chat/completions',{method:'POST',body})).status,401);assert.equal(budget.count(),0);
    budget.reserve();
    assert.equal((await fetch(relay.baseUrl+'/chat/completions',{method:'POST',body,headers:{Authorization:'Bearer synthetic-test-key'}})).status,429);
    assert.equal(budget.count(),1);
  } finally {await relay.close();rmSync(dir,{recursive:true});}
});
