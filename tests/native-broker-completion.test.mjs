import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserNativeBroker } from "../src/background/browser-native-broker.js";
import { createNativePortClient, attachNativeModelHost, withSharedNativeHost } from "../src/browser-native/transport.js";
import { createBrowserNativeRuntime } from "../src/browser-native/runtime.js";
import { NATIVE_PORT, NATIVE_PENDING_KEY, nativeRequest } from "../src/shared/browser-native-protocol.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const extensionId="a".repeat(32), pair={sourceLanguage:"en",targetLanguage:"zh"};
function event(){const handlers=new Set();return{addListener:fn=>handlers.add(fn),removeListener:fn=>handlers.delete(fn),emit:value=>[...handlers].forEach(fn=>fn(value))};}
function portPair(sender){let closed=false;const a={name:NATIVE_PORT,onMessage:event(),onDisconnect:event()},b={name:NATIVE_PORT,sender,onMessage:event(),onDisconnect:event()};a.postMessage=value=>{if(closed)throw Error("closed");queueMicrotask(()=>{if(!closed)b.onMessage.emit(structuredClone(value));});};b.postMessage=value=>{if(closed)throw Error("closed");queueMicrotask(()=>{if(!closed)a.onMessage.emit(structuredClone(value));});};a.disconnect=b.disconnect=()=>{if(closed)return;closed=true;queueMicrotask(()=>{a.onDisconnect.emit();b.onDisconnect.emit();});};return[a,b];}
function fixture(options={}){
  const memory={},local={browserTranslationEnabled:true},connections=[];
  const api={runtime:{id:extensionId,getURL:file=>`chrome-extension://${extensionId}/${file}`},storage:{local:{get:async()=>({...local})},session:{get:async key=>({[key]:structuredClone(memory[key])}),set:async value=>Object.assign(memory,structuredClone(value))}}};
  const broker=createBrowserNativeBroker(api,options);
  const runtime=sender=>({connect(){const [client,server]=portPair(sender);connections.push(server);broker.connect(server);return client;}});
  const contentSender={id:extensionId,url:"https://example.test/article",tab:{id:1,incognito:false},documentId:"doc1"};
  const hostSender={id:extensionId,url:`chrome-extension://${extensionId}/options.html#general`,tab:{id:2,incognito:false}};
  return{broker,api,memory,local,connections,runtime,contentSender,hostSender,dispose:()=>broker.dispose()};
}
function engineFixture(){let creates=0,translations=0;const engine=createBrowserNativeRuntime({isSecureContext:true,Translator:{availability:async()=>"available",create:async()=>{creates++;return{translate:async word=>{translations++;return"translated:"+word;},destroy(){}};}},LanguageDetector:{availability:async()=>"available",create:async()=>({detect:async()=>[{detectedLanguage:"en",confidence:.99}],destroy(){}})}});return{engine,counts:()=>({creates,translations})};}
test("a page cannot register itself as the shared extension host",async()=>{const f=fixture(),c=createNativePortClient(f.runtime(f.contentSender));await assert.rejects(c.request({kind:"host-register"}),{code:"BROWSER_SCOPE"});assert.equal(f.broker.status().hosts,0);c.dispose();f.dispose();});
test("Options lookalike URL is rejected even with the same extension id",async()=>{const f=fixture();const [client,server]=portPair({id:extensionId,url:"file:///options.html"});let closed=false;client.onDisconnect.addListener(()=>closed=true);f.broker.connect(server);await tick();assert.equal(closed,true);f.dispose();});
test("unknown port names are left to existing Reading and assistant handlers",()=>{const f=fixture();assert.equal(f.broker.connect({name:"other"}),false);f.dispose();});
test("no host reports absence instead of opening a hidden page",async()=>{const f=fixture(),c=createNativePortClient(f.runtime(f.contentSender));await assert.rejects(c.call("capability",{pair}),{code:"BROWSER_NO_HOST"});assert.equal(f.broker.status().hosts,0);c.dispose();f.dispose();});
test("only language codes and timestamps enter temporary preparation storage",async()=>{const f=fixture(),c=createNativePortClient(f.runtime(f.contentSender));await c.request({kind:"pending-add",pair:{...pair,text:"PRIVATE WORD",apiKey:"NEVER"}});const stored=JSON.stringify(f.memory);assert.equal(stored.includes("PRIVATE"),false);assert.equal(stored.includes("NEVER"),false);assert.equal(f.memory[NATIVE_PENDING_KEY][0].sourceLanguage,"en");c.dispose();f.dispose();});
test("content cannot list or mark model status verified",async()=>{const f=fixture(),c=createNativePortClient(f.runtime(f.contentSender));await assert.rejects(c.request({kind:"pending-list"}),{code:"BROWSER_SCOPE"});await assert.rejects(c.request({kind:"pending-verified",pair}),{code:"BROWSER_SCOPE"});c.dispose();f.dispose();});
test("Options can recover pending language pairs across broker restart",async()=>{const f=fixture(),c=createNativePortClient(f.runtime(f.contentSender));await c.request({kind:"pending-add",pair});c.dispose();f.dispose();const next=createBrowserNativeBroker(f.api);const [ui,server]=portPair(f.hostSender);next.connect(server);const responses=[];ui.onMessage.addListener(value=>responses.push(value));ui.postMessage({id:"read",kind:"pending-list"});await tick();assert.equal(responses[0].result[0].sourceLanguage,"en");next.dispose();});
test("two reading clients share one ready translator in the user-opened Options page",async()=>{const f=fixture(),model=engineFixture();const detach=attachNativeModelHost(f.runtime(f.hostSender),model.engine);await tick();const a=createNativePortClient(f.runtime(f.contentSender)),b=createNativePortClient(f.runtime({...f.contentSender,tab:{id:3}}));await a.call("prepare",{pair,verifyText:"word"});await b.call("prepare",{pair,verifyText:"word"});const result=await b.call("execute",{pair,segments:[{id:"selection",text:"word"}]});assert.equal(result.translations[0].text,"translated:word");assert.equal(model.counts().creates,1);a.dispose();b.dispose();detach();model.engine.dispose();f.dispose();});
test("remote page requests cannot start downloads in the Options origin",async()=>{const f=fixture();let creates=0;const engine=createBrowserNativeRuntime({isSecureContext:true,Translator:{availability:async()=>"downloadable",create:()=>{creates++;throw Error("unexpected");}}});const detach=attachNativeModelHost(f.runtime(f.hostSender),engine);await tick();const client=createNativePortClient(f.runtime(f.contentSender));await assert.rejects(client.call("prepare",{pair}),{code:"BROWSER_PREPARE"});assert.equal(creates,0);client.dispose();detach();engine.dispose();f.dispose();});
test("page and subtitle surfaces cannot call the shared word executor",async()=>{const f=fixture(),model=engineFixture(),detach=attachNativeModelHost(f.runtime(f.hostSender),model.engine);await tick();const c=createNativePortClient(f.runtime(f.contentSender));for(const surface of ["page","subtitle"]){await assert.rejects(c.request({kind:"call",surface,action:"capability",data:{pair}}),{code:"BROWSER_SCOPE"});}assert.equal(model.counts().creates,0);c.dispose();detach();model.engine.dispose();f.dispose();});
test("long text and multiple segments cannot use the selected-word port",()=>{for(const text of ["two words","x".repeat(161),"12345"]){assert.throws(()=>nativeRequest("execute",{pair,segments:[{id:"s",text}]}),/BROWSER_SCOPE/);}assert.doesNotThrow(()=>nativeRequest("execute",{pair,segments:[{id:"s",text:"C++"}]}));});
test("disabling native definitions blocks the shared executor",async()=>{const f=fixture(),c=createNativePortClient(f.runtime(f.contentSender));f.local.browserTranslationEnabled=false;await assert.rejects(c.call("capability",{pair}),{code:"BROWSER_DISABLED"});c.dispose();f.dispose();});
test("normal and incognito contexts never share a model host",async()=>{const f=fixture(),model=engineFixture(),detach=attachNativeModelHost(f.runtime(f.hostSender),model.engine);await tick();const c=createNativePortClient(f.runtime({...f.contentSender,tab:{id:3,incognito:true}}));await assert.rejects(c.call("capability",{pair}),{code:"BROWSER_NO_HOST"});c.dispose();detach();model.engine.dispose();f.dispose();});
test("closing a shared host rejects in-flight work and frees broker ownership",async()=>{const f=fixture(),gate=defer();const engine={capability:async()=>{await gate.promise;return"available";}};const detach=attachNativeModelHost(f.runtime(f.hostSender),engine);await tick();const c=createNativePortClient(f.runtime(f.contentSender));const p=c.call("capability",{pair});await tick();detach();await assert.rejects(p,{code:"BROWSER_HOST_LOST"});assert.equal(f.broker.status().inflight,0);gate.resolve();c.dispose();f.dispose();});
test("port timeout sends cancellation and clears all owned requests",async()=>{const f=fixture({timeoutMs:10}),gate=defer(),detach=attachNativeModelHost(f.runtime(f.hostSender),{capability:()=>gate.promise});await tick();const c=createNativePortClient(f.runtime(f.contentSender));await assert.rejects(c.call("capability",{pair}),{code:"BROWSER_TIMEOUT"});assert.equal(f.broker.status().inflight,0);gate.resolve("available");c.dispose();detach();f.dispose();});
test("shared adapter falls back locally when Settings is closed",async()=>{const f=fixture(),model=engineFixture(),wrapped=withSharedNativeHost(model.engine,f.runtime(f.contentSender));assert.equal(await wrapped.capability(pair),"available");await wrapped.prepare(pair,{verifyText:"word"});const result=await wrapped.execute({pair,segments:[{id:"s",text:"word"}]});assert.equal(result.translations[0].text,"translated:word");wrapped.dispose();f.dispose();});
test("a user click starts local preparation synchronously instead of losing activation in IPC",async()=>{const f=fixture(),model=engineFixture(),wrapped=withSharedNativeHost(model.engine,f.runtime(f.contentSender));const p=wrapped.prepare(pair,{userGesture:true,verifyText:"word"});assert.equal(model.counts().creates,1);await p;wrapped.dispose();f.dispose();});
test("cancel received while reading preferences prevents a later model dispatch",async()=>{
  const f=fixture(),gate=defer();let modelCalls=0;
  f.api.storage.local.get=()=>gate.promise;
  const detach=attachNativeModelHost(f.runtime(f.hostSender),{capability:async()=>{modelCalls++;return "available";}});
  await tick();const c=createNativePortClient(f.runtime(f.contentSender)),ctrl=new AbortController();
  const p=c.call("capability",{pair},{signal:ctrl.signal});await tick();ctrl.abort();
  await assert.rejects(p,{code:"CANCELLED"});await tick();gate.resolve({browserTranslationEnabled:true});await tick();
  assert.equal(modelCalls,0);assert.equal(f.broker.status().inflight,0);c.dispose();detach();f.dispose();
});
test("corrupt session metadata is sanitized instead of becoming a model pair",async()=>{
  const f=fixture({now:()=>100});f.memory[NATIVE_PENDING_KEY]=[{...pair,updatedAt:99,secret:"private"},{sourceLanguage:"unknown-code",targetLanguage:"zh",updatedAt:99},{...pair,updatedAt:101}];
  const c=createNativePortClient(f.runtime(f.hostSender));const rows=await c.request({kind:"pending-list"});
  assert.deepEqual(rows,[{...pair,updatedAt:99}]);c.dispose();f.dispose();
});
test("an unsupported shared host does not mask an available page model",async()=>{
  const f=fixture(),model=engineFixture();const host=createBrowserNativeRuntime({isSecureContext:true});
  const detach=attachNativeModelHost(f.runtime(f.hostSender),host);await tick();
  const client=withSharedNativeHost(model.engine,f.runtime(f.contentSender));
  assert.equal(await client.capability(pair),"available");await client.prepare(pair,{verifyText:"word"});
  assert.equal(model.counts().creates,1);client.dispose();detach();host.dispose();f.dispose();
});
test("closed shared host cannot authorize a silent page model download",async()=>{
  const f=fixture();let creates=0;
  const model=createBrowserNativeRuntime({isSecureContext:true,Translator:{availability:async()=>"downloadable",create:()=>{creates++;throw Error("unexpected");}}});
  const client=withSharedNativeHost(model,f.runtime(f.contentSender));
  await assert.rejects(client.prepare(pair),{code:"BROWSER_PREPARE"});assert.equal(creates,0);client.dispose();f.dispose();
});
