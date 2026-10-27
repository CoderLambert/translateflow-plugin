import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {startMockServer} from './mock-server.mjs';
import {prepareExtensionTestCopy} from './production-artifact.mjs';
export async function runUnattachedWorkerScenario() {
const dir=await mkdtemp(join(tmpdir(),'tf-unattached-worker-')),server=await startMockServer();let browser,ws,cdp;
try{
 const extension=join(dir,'extension');await prepareExtensionTestCopy({extensionDir:extension,baseUrl:server.baseUrl});
 browser=spawn(chromium.executablePath(),['--headless=new','--no-sandbox','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${join(dir,'profile')}`,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],{stdio:['ignore','ignore','pipe']});
 const address=await new Promise((resolve,reject)=>{let text='';const timeout=setTimeout(()=>reject(Error('browser startup timed out')),10000);browser.stderr.on('data',data=>{text=(text+data.toString()).slice(-8192);const match=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});browser.once('error',error=>{clearTimeout(timeout);reject(error);});browser.once('exit',()=>{clearTimeout(timeout);reject(Error('browser exited'));});});
 ws=new WebSocket(address);await once(ws,'open');let sequence=0;const pending=new Map();
 ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const p=pending.get(data.id);if(!p)return;pending.delete(data.id);if(data.error)p.reject(Error(data.error.message));else p.resolve(data.result);}});
 ws.addEventListener('close',()=>{for(const p of pending.values())p.reject(Error('browser connection closed'));pending.clear();});
 cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(Error(`CDP ${method} timed out`));},10000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
 const expectedId=createHash('sha256').update(manifest.key?Buffer.from(manifest.key,'base64'):extension).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c=>String.fromCharCode(97+parseInt(c,16)));
 let target;
 for(let i=0;i<50&&!target;i++){target=(await cdp('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(`chrome-extension://${expectedId}/`));if(!target)await new Promise(r=>setTimeout(r,100));}
 assert.ok(target,'extension worker started');const id=new URL(target.url).host;
 const page=await cdp('Target.createTarget',{url:`chrome-extension://${id}/popup.html`});
 const {sessionId}=await cdp('Target.attachToTarget',{targetId:page.targetId,flatten:true});
 // Attach only to the extension page. Attaching a debugger to the worker itself
 // changes its lifetime and hides idle-disconnect failures.
 const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);return r.result.value;};
 for(let i=0;i<50;i++){try{if(await evaluate("typeof chrome !== 'undefined' && !!chrome.runtime?.id"))break;}catch(error){if(!/execution context/u.test(error.message))throw error;}await new Promise(r=>setTimeout(r,100));}
 await evaluate(`new Promise(resolve=>{if(document.readyState==='complete')resolve();else addEventListener('load',resolve,{once:true})})`);
 await evaluate(`chrome.storage.local.set(${JSON.stringify({providerConnectionsVersion:1,providerConnections:{local:{id:'local',revision:1,name:'Synthetic',platform:'lmstudio',protocol:'openai-chat',baseUrl:server.baseUrl+'/v1',credentialId:'local',defaultModel:'hy-mt2-7b',settings:{streaming:true,outputTokens:4096,temperature:null,allowEmptyApiKey:true,allowInsecureHttp:true}}},providerCredentials:{local:''},defaultService:{kind:'api-key',connectionId:'local'},translationPreferences:{version:1,wordMethod:'ai',textMethod:'ai'},targetLanguage:'Simplified Chinese',autoSites:[],cacheRestoreSites:[]})})`);
 await cdp('Target.createTarget',{url:server.baseUrl+'/selection'});
 let tabId;
 for(let i=0;i<50&&!tabId;i++){tabId=await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.find(t=>t.url===${JSON.stringify(server.baseUrl+'/selection')}&&t.status==='complete')?.id)`);if(!tabId)await new Promise(r=>setTimeout(r,100));}
 assert.ok(tabId);server.setDelay(35000);
 const start=Date.now();
 await evaluate(`chrome.scripting.executeScript({target:{tabId:${tabId}},func:()=>{const p=chrome.runtime.connect({name:'selection.assistant-stream'});globalThis.__probe={events:[],disconnected:false,port:p};p.onMessage.addListener(m=>__probe.events.push({type:m.type,code:m.code}));p.onDisconnect.addListener(()=>{void chrome.runtime.lastError;__probe.disconnected=true});p.postMessage({protocolVersion:1,type:'start',requestId:'slow',text:'Ship with hybrid rendering and TypeScript.',pageUrl:location.href,context:null,depth:'standard',ownerToken:'0123456789abcdef0123456789abcdef',action:'analyze',threadId:'thread-1',turnId:'turn-1',parentTurnId:null,branchId:'branch-1',regenerationOf:null})}})`);
 let result;
 for(let i=0;i<45;i++){
  result=await evaluate(`chrome.scripting.executeScript({target:{tabId:${tabId}},func:()=>({events:__probe.events,disconnected:__probe.disconnected})}).then(r=>r[0].result)`);
  if(result.disconnected||result.events.some(e=>['complete','interrupted'].includes(e.type)))break;
  await new Promise(r=>setTimeout(r,1000));
 }
 console.log(JSON.stringify({workerDebuggerAttached:false,elapsedMs:Date.now()-start,...result,requests:server.calls.length}));
 assert.equal(result.disconnected,false,'assistant must not lose its Port before its allowed request timeout');assert.equal(result.events.at(-1)?.type,'complete');
}finally{if(browser&&browser.exitCode===null){const exit=once(browser,'exit');try{await Promise.race([cdp('Browser.close'),exit]);}catch{browser.kill('SIGTERM');}await exit;}ws?.close();await server.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
