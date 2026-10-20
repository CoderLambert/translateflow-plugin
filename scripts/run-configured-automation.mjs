import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readAutomationConfig, readAutomationSecret } from "./automation-config.mjs";
import { openRequestBudget } from "./automation-budget.mjs";
import { startBudgetRelay } from "./automation-relay.mjs";
import { saveAutomationReport, redact } from "./automation-report.mjs";
import { runBrowserAcceptance } from "./automation-browser.mjs";
import { fingerprint } from "./local-task.mjs";
import { productionInputStamp } from "./automation-inputs.mjs";

const config = readAutomationConfig(process.argv[2] || "docs/task-execution/local/automation-config.json");
const campaign = resolve(config.outputBase, config.campaignId);
mkdirSync(campaign,{ recursive:true,mode:0o700 });
// Kernel lock is released even after interruption; no stale marker to clear.
if(!process.argv.includes("--lock-held")) {
  const child=spawnSync("flock",["-n",join(campaign,"campaign.lock"),process.execPath,...process.argv.slice(1),"--lock-held"],{stdio:"inherit"});
  process.exit(child.status ?? 1);
}
const dir = join(campaign,`run-${Date.now()}`); mkdirSync(join(dir,"screenshots"),{recursive:true,mode:0o700});
const budget = openRequestBudget(join(campaign,"requests.json"),{campaignId:config.campaignId,maxRequests:config.realAi.maxRequests});
const record = { at:new Date().toISOString(),head:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
  branch:execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),artifactHash:"",requests:budget.count(),requestLimit:config.realAi.maxRequests,steps:[] };
let key = "", relay;
const traceRoots=[];
const secrets=()=>[key,config.dictionary?.directory,config.realAi?.secretFile].filter(Boolean);
const flush = () => { record.requests=budget.count(); saveAutomationReport(dir,record,secrets()); };
async function command(title,args,log) {
  const start=Date.now(); console.log(`[AUTOMATION] START ${title}`);
  // No user credential/environment is passed to the mock regression process.
  const env = Object.fromEntries(["PATH","HOME","DISPLAY","XDG_RUNTIME_DIR","LANG","HTTPS_PROXY","HTTP_PROXY","NO_PROXY"].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{TF_TEST_WORKERS:String(config.automatedRegression.workers || 2),TF_E2E_ARTIFACT:resolve(config.artifact)});
  if(config.publicSources?.ecdictCsv)env.TF_E2E_ECDICT_CSV=resolve(config.publicSources.ecdictCsv);
  if(["e2e.log","special.log"].includes(log)){env.TF_TEST_RUN_DIR=join(dir,`regression-${log.slice(0,-4)}`);traceRoots.push(env.TF_TEST_RUN_DIR);}
  const stream = openSync(join(dir,log),"wx",0o600);
  const child=spawn("npm",args,{env,stdio:["ignore",stream,stream]});
  const code=await new Promise(resolve=>{child.once("error",()=>resolve(-1));child.once("exit",resolve);}); closeSync(stream);
  writeFileSync(join(dir,log),redact(readFileSync(join(dir,log),"utf8"),[key]),{mode:0o600});
  const item={title,status:code===0?"PASS":"FAIL",kind:"自动模拟回归／无界面检查",durationMs:Date.now()-start,detail:`命令 npm ${args.join(" ")}；退出码 ${code}。不使用本次真实凭据；环境缺失产生的跳过保留在日志中。本项无界面步骤不伪造截图。`,log};
  record.steps.push(item); flush();
  return code;
}
let sourceStamp;
async function prepareArtifact(){
  sourceStamp=await productionInputStamp();const path=join(campaign,"artifact-inputs.json");
  const previous=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):null;
  let current;try{current=fingerprint(process.cwd(),config.artifact);}catch{}
  if(previous?.sourceStamp===sourceStamp && previous.artifactHash===current){record.artifactHash=current;record.steps.push({title:"复用生产输入和包指纹均未变化的安装包",status:"PASS",kind:"构建输入核对",detail:`sourceStamp=${sourceStamp}`});flush();return;}
  const commandName=config.artifact==="dist/extension"?"build:extension":"build:extension:wxt";
  if(await command("构建当前源码的待验收安装包",["run",commandName],"build.log")!==0)throw new Error("Build failed; existing package is not accepted as current");
  if(await productionInputStamp()!==sourceStamp)throw new Error("Production inputs changed during build");
  record.artifactHash=fingerprint(process.cwd(),config.artifact);writeFileSync(path,JSON.stringify({sourceStamp,artifactHash:record.artifactHash}),{mode:0o600});flush();
}
try {
  await prepareArtifact();
  if(process.argv.includes("--regression-only"))throw Object.assign(new Error("本次仅运行模拟回归，未使用真实凭据。"),{skip:true});
  key=readAutomationSecret(config); flush();
  relay=await startBudgetRelay(config,key,budget);
  await runBrowserAcceptance({config,key,relay,budget,dir,campaign,profile:join(campaign,"profile"),record,flush});
} catch(error) { record.steps.push({title:"真实验收执行器",status:error.skip?"SKIP":"BLOCKED",kind:"执行环境",detail:redact(error.message,[key])});flush(); }
finally { if(relay)await relay.close(); }
try {
  if(config.automatedRegression.enabled && !process.argv.includes("--live-only")) {
    await command("完整 Node 与 Vitest 回归",["run","validate"],"validate.log");
    if(!record.artifactHash)record.steps.push({title:"浏览器回归未执行",status:"BLOCKED",detail:"当前源码的包未能构建，不使用旧包制造通过结果。"});
    else {
    const result=await command("完整 Chromium/MV3 回归",["run","test:e2e","--","--retries=0","--trace=on"],"e2e.log");
    if(result!==0 && !readFileSync(join(dir,"e2e.log"),"utf8").includes("] [special] ›"))
      await command("补跑被依赖失败阻止的串行专项",["run","test:e2e","--","--special","--retries=0","--trace=on"],"special.log");
    const gallery=spawnSync("python3",["scripts/automation-traces.py",JSON.stringify(traceRoots),dir],{encoding:"utf8"});
    if(gallery.status===0){record.steps.at(-1).gallery="regression/index.html";record.steps.at(-1).detail+=`\n截图轨迹：${gallery.stdout.trim()}`;}
    else record.steps.at(-1).detail+="\n截图轨迹整理失败，原始 trace 保留。";
    }
  }
} finally {
  if(sourceStamp && await productionInputStamp()!==sourceStamp)record.steps.push({title:"生产输入在验收中发生变化",status:"BLOCKED",detail:"上述结果只绑定开始时的生产输入，不能作为变更后源码的通过证明。"});
  flush();console.log(`[AUTOMATION_REPORT] ${join(dir,"index.html")}`);
}
process.exitCode=record.steps.some(s=>s.status==="FAIL")?1:record.steps.some(s=>s.status==="BLOCKED")?2:0;
