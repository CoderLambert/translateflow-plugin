import test from 'node:test';
import assert from 'node:assert/strict';
import {openAICompatibleProvider} from '../src/background/providers/openai-compatible.js';
import {createTranslationCoordinator} from '../src/background/cache/translation-coordinator.js';
import {parseLocalTranslationResult} from '../src/background/providers/local-translation.js';
import {structuredRecoveryPlan} from '../src/background/providers/structured-recovery.js';
import {requestChatCompletions,parseTranslationResult} from '../src/background/providers/shared.js';
import {parseTranslationText} from '../src/background/providers/native-protocol-shared.js';
for (const translations of [[{id:'a',text:' '}],[{id:'a',text:'译文'},{id:'extra',text:'额外'}],[{id:'a',text:'译文'},{id:'a',text:'重复'}]]) test(`chat and native protocol parsers reject invalid complete output ${JSON.stringify(translations)}`,()=>{
 const raw=JSON.stringify({translations}),segments=[{id:'a',text:'Source'}];
 assert.throws(()=>parseTranslationText(raw,segments,'Synthetic'),{code:'MALFORMED_RESPONSE'});
 assert.throws(()=>parseTranslationResult({choices:[{message:{content:raw}}]},segments,'Synthetic'),{code:'MALFORMED_RESPONSE'});
});
const config={engine:'ai',provider:'openai-chat',apiBaseUrl:'http://localhost:1234/v1',model:'hy-mt2-7b',apiKey:'',prompt:'Translate.',targetLanguage:'Chinese'};
const segment={id:'p',format:'tf-markers',protectedIds:[0],text:'Use ⟦TF:0:S⟧sample()⟦TF:0:E⟧ with ⟦TF:1:S⟧care⟦TF:1:E⟧.'};
const json=translations=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations})}}]}),{headers:{'Content-Type':'application/json'}});
test('local values retain literal protocol examples that already occur in the source',()=>{
 const text='Literal ```json and "translations": examples remain text.';
 assert.deepEqual(parseLocalTranslationResult({choices:[{message:{content:JSON.stringify({translations:{a:text}})}}]},[{id:'a',text}]),[{id:'a',text}]);
});
test('persistent single-segment envelope pollution stops after two format attempts',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return json({a:'污染```json{'});});
 const old=globalThis.chrome;globalThis.chrome={permissions:{contains:async()=>true}};t.after(()=>{globalThis.chrome=old});
 await assert.rejects(openAICompatibleProvider.translateBatch([{id:'a',text:'A title'}],config,{}),{code:'MALFORMED_RESPONSE'});
 assert.equal(calls,2);
});
for (const damage of ['json-fence', 'cross-segment-json']) test(`local plain batches recover ${damage} instead of rendering transport syntax`,async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  calls++;const body=JSON.parse(init.body);
  if(body.messages[0].content.includes('Source text:\n')) {
   assert.equal(body.response_format,undefined);
   const source=body.messages[0].content.split('Source text:\n').at(-1);
   return new Response(JSON.stringify({choices:[{message:{content:source==='A title'?'标题':'另一段'}}]}));
  }
  const items=JSON.parse(body.messages[0].content.split('Input JSON:\n').at(-1)).segments;
  if(items.length>1)return json({a:damage==='json-fence'?'标题```json{':'标题“b”、 “混入其它段落”}}',b:'另一段'});
  return json(Object.fromEntries(items.map(s=>[s.id,s.id==='a'?'标题':'另一段'])));
 });
 const old=globalThis.chrome;globalThis.chrome={permissions:{contains:async()=>true}};t.after(()=>{globalThis.chrome=old});
 const output=await openAICompatibleProvider.translateBatch([{id:'a',text:'A title'},{id:'b',text:'Another paragraph'}],config,{});
 assert.deepEqual(output,[{id:'a',text:'标题'},{id:'b',text:'另一段'}]);assert.equal(calls,4);
});
for(const damage of ['missing-marker','translated-code'])test(`actual coordinator recovers local ${damage} without losing code or format`,async t=>{
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  const body=JSON.parse(init.body),items=JSON.parse(body.messages[0].content.split('Input JSON:\n').at(-1)).segments;
  calls++;
  if(items.some(s=>s.text.includes('[[TF_'))){return json({p:damage==='missing-marker'?'使用 [[TF_0_S]]sample()[[TF_0_E]] 并[[TF_1_S]]小心。':'使用 [[TF_0_S]]示例()[[TF_0_E]] 并[[TF_1_S]]小心[[TF_1_E]]。'});}
  assert.ok(items.every(s=>!s.text.includes('sample()')),'protected source is never submitted for fragment translation');
  return json(Object.fromEntries(items.map(s=>[s.id,({'Use':'使用','with':'并','care':'小心','.':'。'})[s.text]||s.text])));
 });
 const old=globalThis.chrome;globalThis.chrome={permissions:{contains:async()=>true}};t.after(()=>{globalThis.chrome=old});let calls=0;
 const coordinator=createTranslationCoordinator(({segments,config,signal})=>openAICompatibleProvider.translateBatch(segments,config,{signal}));
 t.after(()=>coordinator.close());
 const output=await coordinator.run({requestId:damage,segments:[segment],config});
 assert.equal(output.length,1);assert.match(output[0].text,/⟦TF:0:S⟧sample\(\)⟦TF:0:E⟧/);assert.match(output[0].text,/⟦TF:1:S⟧小心⟦TF:1:E⟧/);
 assert.ok(calls<=3,'recovery is bounded');
});
test('structured recovery preserves nested protected text and rejects incomplete fragment output',()=>{
 const source={id:'nested',format:'tf-markers',protectedIds:[1],text:'Read ⟦TF:0:S⟧this ⟦TF:1:S⟧code()⟦TF:1:E⟧ page⟦TF:0:E⟧.'};
 const plan=structuredRecoveryPlan(source);
 assert.ok(plan.fragments.every(item=>!item.text.includes('code()')&&!item.text.includes('⟦')));
 assert.throws(()=>plan.restore([]),{code:'MALFORMED_RESPONSE'});
 const result=plan.restore(plan.fragments.map(item=>({id:item.id,text:'译文'})));
 assert.match(result.text,/⟦TF:0:S⟧译文 ⟦TF:1:S⟧code\(\)⟦TF:1:E⟧ 译文⟦TF:0:E⟧/);
 assert.throws(()=>structuredRecoveryPlan({...source,text:'⟦TF:0:S⟧unclosed'}),{code:'CACHE_INVALID_VALUE'});
});
test('response body remains covered by the request timeout',async t=>{
 t.mock.method(globalThis,'fetch',async(_url,{signal})=>({ok:true,status:200,headers:new Headers(),text:()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>resolve('{}'),1400);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('timeout','AbortError'))},{once:true});})}));
 await assert.rejects(requestChatCompletions({url:'http://synthetic.invalid',apiKey:'',requireApiKey:false,body:{},providerLabel:'Synthetic',retryPolicy:{maxAttempts:1,requestTimeoutMs:1000}}),{code:'TIMEOUT'});
});
test('external abort still owns the response body after headers',async t=>{
 const control=new AbortController();let start;const started=new Promise(r=>{start=r});
 t.mock.method(globalThis,'fetch',async(_url,{signal})=>({ok:true,status:200,headers:new Headers(),text:()=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});start();setTimeout(()=>resolve('{"ok":true}'),30);})}));
 const pending=requestChatCompletions({url:'http://synthetic.invalid',apiKey:'',requireApiKey:false,body:{},providerLabel:'Synthetic',signal:control.signal,retryPolicy:{maxAttempts:1,requestTimeoutMs:1000}});
 await started;control.abort();await assert.rejects(pending,{code:'CANCELLED'});
});
