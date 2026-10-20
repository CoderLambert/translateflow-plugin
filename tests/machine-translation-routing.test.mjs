import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MACHINE_TRANSLATION, MACHINE_PROVIDERS, createMachineConfig, normalizeMachineTranslation, machineSupports } from '../src/shared/machine-translation.js';
import { buildMachineRequest, parseMachineResponse, machineAdapter } from '../src/background/providers/machine-translation-adapters/index.js';
import { requestMachineTexts } from '../src/background/providers/machine-translation-transport.js';
import { machineSucceeded, machineHealth } from '../src/background/providers/machine-translation-health.js';
import { translateMachineRoute } from '../src/background/providers/machine-translation-routing.js';
import { lookupMachinePlan, bindMachinePlanResults, storeMachinePlan, assertMachinePlanInputs } from '../src/background/cache/machine-translation-plan.js';
import { createApplicationCache } from '../src/background/cache/application.js';
import { createMemoryCacheStore } from '../src/background/cache/storage-memory.js';
import { createTranslationCoordinator } from '../src/background/cache/translation-coordinator.js';

const originalFetch = fetch, originalChrome = globalThis.chrome;
const cfg = id => createMachineConfig({ ...DEFAULT_MACHINE_TRANSLATION, mode: 'free-online', routing: 'fixed', providerId: id, sourceLanguage: 'en' }, 'zh');
const configs = MACHINE_PROVIDERS.map(p => cfg(p.id));
const microsoft = configs[0], google = cfg('mt-google-web'), volc = cfg('mt-volcengine-web');
const route = (candidates = [microsoft, google]) => ({ ...candidates[0], routing: 'auto', routeCandidates: candidates });
const ok = text => Response.json([{ translations: [{ text }] }]);
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
test.beforeEach(async () => {
 const memory = {};
 globalThis.chrome = { permissions: { contains: async () => true }, storage: { local: { get: async keys => Object.fromEntries(keys.map(k => [k,memory[k]])), set: async v => Object.assign(memory,v) } } };
 for (const config of configs) await machineSucceeded(config);
 // Most recently successful test route must not change the initial order.
 await machineSucceeded(microsoft);
});
test.afterEach(() => { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; });

test('v1 settings normalize to v2 defaults without mutating source or AI data', () => {
 const legacy = { version: 1, mode: 'free-online', providerId: 'mt-tencent-transmart', sourceLanguage: 'ja' };
 assert.deepEqual(normalizeMachineTranslation(legacy), DEFAULT_MACHINE_TRANSLATION);
 assert.equal(legacy.providerId, 'mt-tencent-transmart');
 assert.throws(() => machineAdapter('unregistered'), { code: 'MT_CONFIG' });
 assert.equal(machineSupports('mt-youdao-web','fr','zh'), false);
 assert.equal(machineSupports('mt-youdao-web','zh','en'), true);
});

test('registered protocols reject truncated, empty and malformed results', () => {
 const request = buildMachineRequest('mt-bilibili',['public fixture'],'en','zh');
 assert.equal(request.body.stream,false); assert.equal(request.body.model,'Index-Translate-35B-A3B');
 assert.equal(request.body.messages.length,1); assert.equal(request.body.chat_template_kwargs.enable_thinking,false);
 for(const finish_reason of ['length',null,'content_filter']) assert.throws(() => parseMachineResponse('mt-bilibili',{choices:[{finish_reason,message:{role:'assistant',content:'译文'}}]},['public fixture']),{code:'MT_RESPONSE'});
 assert.deepEqual(parseMachineResponse('mt-bilibili',{choices:[{finish_reason:'stop',message:{role:'assistant',content:'译文'}}]},['fixture']),['译文']);
 assert.deepEqual(parseMachineResponse('mt-google-web',[[['你好','hello'],['世界','world']]],['hello world']),['你好世界']);
 assert.deepEqual(parseMachineResponse('mt-volcengine-web',{translation:'译文'},['fixture']),['译文']);
 assert.deepEqual(parseMachineResponse('mt-youdao-web',{errorCode:0,translation:['译文']},['fixture']),['译文']);
 for(const p of ['mt-bilibili','mt-google-web','mt-volcengine-web','mt-youdao-web']) assert.throws(() => parseMachineResponse(p,{},['fixture']),{code:'MT_RESPONSE'});
 assert.throws(() => buildMachineRequest('mt-google-web',['x'.repeat(1001)],'en','zh'),{code:'MT_INPUT'});
});

for(const mode of ['network','429','403','503','empty','malformed']) test(`auto switches exactly once after ${mode}, and remembers successful direction`, async () => {
 const calls=[];
 globalThis.fetch = async url => {
  const host=new URL(url).hostname;calls.push(host);
  if(host==='edge.microsoft.com') {
   if(mode==='network') throw new TypeError('synthetic offline');
   if(['429','403','503'].includes(mode)) return new Response('',{status:Number(mode)});
   return mode==='empty' ? ok('') : Response.json({changed:true});
  }
  return Response.json([[['备用译文']]]);
 };
 const out=await translateMachineRoute([{id:'a',text:'public fixture'}],route());
 assert.equal(out[0].providerId,google.provider); assert.equal(out[0].text,'备用译文');
 assert.deepEqual(calls,['edge.microsoft.com','translate.googleapis.com']);
 assert.ok((await machineHealth(microsoft.provider)).until > Date.now());
 await translateMachineRoute([{id:'b',text:'another fixture'}],route());
 assert.equal(calls.at(-1),'translate.googleapis.com'); assert.equal(calls.length,3);
});

test('fixed mode never switches to another service', async () => {
 let count=0; globalThis.fetch=async () => {count++;return new Response('',{status:503});};
 await assert.rejects(translateMachineRoute([{id:'a',text:'fixture'}],microsoft),{code:'MT_HTTP'});assert.equal(count,1);
});

test('a segment never mixes slots from two services; completed segments survive later failures', async () => {
 let microsoftCalls=0;
 globalThis.fetch=async (url,init) => {
  if(new URL(url).hostname==='edge.microsoft.com') { microsoftCalls++; if(microsoftCalls===1) return ok('首段'); return Response.json([]); }
  return new Response('',{status:503});
 };
 const out=await translateMachineRoute([{id:'a',text:'first'},{id:'b',text:'second'},{id:'c',text:'third'}],route());
 assert.equal(out.length,1);assert.equal(out[0].id,'a');assert.equal(out[0].text,'首段');
});

test('global HTTP limit is two; per-provider is one, including response body lifetime', async () => {
 const starts=[], releases=new Map(); let active=0,peak=0;
 globalThis.fetch=async url => {
  const host=new URL(url).hostname;starts.push(host);active++;peak=Math.max(peak,active);
  const d=defer();releases.set(host,d);
  await d.promise;active--;
  return host==='edge.microsoft.com'?ok('译文'):host==='translate.googleapis.com'?Response.json([[['译文']]]):Response.json({translation:'译文'});
 };
 const a=requestMachineTexts(microsoft,['one']),b=requestMachineTexts(google,['two']),c=requestMachineTexts(volc,['three']);
 while(starts.length<2) await new Promise(setImmediate);
 assert.equal(starts.length,2);assert.equal(peak,2);
 releases.get(starts[0]).resolve();
 while(starts.length<3) await new Promise(setImmediate);
 for(const d of releases.values())d.resolve();
 await Promise.all([a,b,c]); assert.equal(peak,2);
});

test('expired and cancelled queued jobs do not issue HTTP, and retry gets a fresh flight', async () => {
 const began=defer(), finish=defer();let calls=0;
 globalThis.fetch=async (_url, init) => { calls++; if(calls===1) { began.resolve();await finish.promise; } return ok('完成'); };
 const coordinator=createTranslationCoordinator(({segments,config,signal}) => translateMachineRoute(segments,config,{signal}));
 const first=coordinator.run({requestId:'old',segments:[{id:'a',text:'fixture'}],config:microsoft}).catch(e=>e.code);
 await began.promise;assert.equal(coordinator.cancel('old').cancelled,true);assert.equal(await first,'CANCELLED');
 const retry=coordinator.run({requestId:'new',segments:[{id:'a',text:'fixture'}],config:microsoft});
 const cancelled=new AbortController();const queued=requestMachineTexts(microsoft,['never'],{signal:cancelled.signal}).catch(e=>e.code);cancelled.abort();assert.equal(await queued,'CANCELLED');
 await assert.rejects(requestMachineTexts(google,['expired'],{deadline:performance.now()-1}),{code:'MT_TIMEOUT'});
 assert.equal(calls,1);finish.resolve();assert.equal((await retry)[0].text,'完成');assert.equal(calls,2);coordinator.close();
});

test('cache plan freezes concrete tokens, verifies refs, and cannot write through an invalidation', async () => {
 const cache=createApplicationCache({store:createMemoryCacheStore()});
 const plan={config:route(),pageUrl:'https://fixture.invalid/',sources:new Map(),routes:new Map(),writable:true};
 const segment={id:'a',text:'source',format:'plain'};
 const lookup=await lookupMachinePlan(plan,[segment],cache);assert.deepEqual(lookup.hits,[]);assert.equal(lookup.writeTokens[0].token,null);
 assert.throws(()=>assertMachinePlanInputs(plan,[{id:'a',text:'altered'}]),{code:'MT_INPUT'});
 const [out]=await bindMachinePlanResults(plan,[segment],[{id:'a',text:'译文',providerId:google.provider}],'request-a');
 const msg={items:[{sourceText:'source',translation:out.text,routeRef:out.routeRef,format:'plain'}]};
 await assert.rejects(storeMachinePlan(plan,{items:[{...msg.items[0],translation:'forged'}]},cache),{code:'MT_INPUT'});
 assert.equal((await storeMachinePlan(plan,msg,cache)).stored,1);
 assert.equal((await cache.lookupTranslations({pageUrl:plan.pageUrl,segments:[segment],config:google})).hits[0].text,'译文');
 assert.equal((await cache.lookupTranslations({pageUrl:plan.pageUrl,segments:[segment],config:microsoft})).hits.length,0);
 await cache.clearAllCache();
 assert.equal((await storeMachinePlan(plan,msg,cache)).stored,0);
 const before=plan.sources.get([...plan.sources.keys()][0]).candidates[1].token;
 await lookupMachinePlan(plan,[segment],cache);
 assert.equal(plan.sources.get([...plan.sources.keys()][0]).candidates[1].token,before);
 plan.writable=false;assert.equal((await storeMachinePlan(plan,msg,cache)).cacheWarning,'CACHE_INVALIDATED');cache.close();
});

test('aborted response body keeps global capacity until the cancellation promise settles', async () => {
 const opened=defer(), cleanup=defer();let active=0,peak=0;
 globalThis.fetch=async url => {
  active++;peak=Math.max(active,peak);
  if(new URL(url).hostname === 'edge.microsoft.com') return new Response(new ReadableStream({start(){opened.resolve();},cancel(){return cleanup.promise.then(()=>{active--;});}}));
  active--;return Response.json([[['完成']]]);
 };
 const controller=new AbortController();
 const first=requestMachineTexts(microsoft,['fixture'],{signal:controller.signal}).catch(e=>e.code);
 await opened.promise;controller.abort();
 const next=requestMachineTexts(google,['fixture']);await next;
 assert.equal(active,1);cleanup.resolve();assert.equal(await first,'CANCELLED');assert.ok(peak<=2);
});

test('mixed plain/rich groups retain completed paragraphs after later provider failure', async () => {
 const coordinator=createTranslationCoordinator(async ({segments}) => {
  if(segments[0].format==='tf-markers') throw Object.assign(new Error('offline'),{code:'MT_NETWORK'});
  return [{id:segments[0].id,text:'完成',providerId:microsoft.provider,providerLabel:'Microsoft'}];
 });
 const out=await coordinator.run({requestId:'mixed',config:route(),segments:[{id:'a',text:'first',format:'plain'},{id:'b',text:'Read ⟦TF:0:S⟧care⟦TF:0:E⟧',format:'tf-markers'}]});
 assert.deepEqual(out.map(i=>i.id),['a']);coordinator.close();
});

test('language aliases normalize and Youdao rejects a response in the wrong direction', () => {
 assert.equal(machineSupports('mt-youdao-web','en','zh-CN'),true);
 assert.equal(machineSupports('mt-bilibili','auto','zh-CN'),true);
 assert.throws(()=>parseMachineResponse('mt-youdao-web',{errorCode:0,translation:['wrong'],l:'zh-CHS2en'},['source'],{targetLanguage:'zh'}),{code:'MT_RESPONSE'});
 assert.throws(()=>parseMachineResponse('mt-youdao-web',{errorCode:0,translation:[42],l:'en2zh-CHS'},['source'],{targetLanguage:'zh'}),{code:'MT_RESPONSE'});
});

test('progress reports the selected backup and cooldown recovers on a later user probe', async () => {
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
 try {
  let calls=0;const events=[];
  globalThis.fetch=async url=>{calls++;return new URL(url).hostname==='edge.microsoft.com'?new Response('',{status:503}):Response.json([[['译文']]]);};
  await translateMachineRoute([{id:'a',text:'fixture'}],route(),{onProgress:event=>events.push(event)});
  assert.deepEqual(events.map(e=>e.switching),[false,true]);
  const state=await machineHealth(microsoft.provider);assert.equal(state.until-now,30000);
  now=state.until+1;globalThis.fetch=async()=>{calls++;return ok('恢复');};
  assert.deepEqual(await requestMachineTexts(microsoft,['probe']),['恢复']);
  assert.equal((await machineHealth(microsoft.provider)).failures,0);assert.equal(calls,3);
 } finally {Date.now=originalNow;}
});

test('timeout returns before an abort-ignoring HTTP exchange releases its actual slot', async () => {
 const opened=defer(),release=defer();let calls=0;
 globalThis.fetch=async()=>{calls++;if(calls===1){opened.resolve();await release.promise;}return ok('完成');};
 const first=requestMachineTexts(microsoft,['fixture'],{timeoutMs:10}).catch(e=>e.code);
 await opened.promise;assert.equal(await first,'MT_TIMEOUT');
 const controller=new AbortController();
 const queued=requestMachineTexts(microsoft,['queued'],{signal:controller.signal}).catch(e=>e.code);
 await new Promise(setImmediate);assert.equal(calls,1);
 controller.abort();assert.equal(await queued,'CANCELLED');release.resolve();
 await new Promise(setImmediate);assert.equal(calls,1);
});
