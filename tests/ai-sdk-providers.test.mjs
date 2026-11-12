import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSdkCompletion } from '../src/background/providers/ai-sdk-transport.js';
import { PROVIDER_PLATFORMS } from '../src/shared/provider-connections.js';
import { responseFor } from './support/sdk-response.mjs';
for(const preset of PROVIDER_PLATFORMS) test(`${preset.id}: SDK preserves endpoint, authentication and protocol`,async()=>{
 const original=globalThis.fetch; let seen;
 const base=preset.baseUrl||'https://resource.openai.azure.com/openai/v1';
 globalThis.fetch=async(url,init)=>{seen={url:String(url),headers:new Headers(init.headers),body:JSON.parse(init.body)};return new Response(JSON.stringify(responseFor(preset.protocol)),{headers:{'Content-Type':'application/json'}})};
 try {
 const data=await requestSdkCompletion({config:{platform:preset.id,protocol:preset.protocol,apiBaseUrl:base,apiKey:preset.allowEmptyApiKey?'':'secret',model:'test-model',outputTokens:512},body:{model:'test-model',messages:[{role:'user',content:'test'}]},providerLabel:preset.label});
 assert.equal(data.choices[0].message.content,'OK');
 const suffix={'openai-chat':'/chat/completions','openai-responses':'/responses','anthropic-messages':'/messages','gemini-generate':'/models/test-model:generateContent'}[preset.protocol];
 assert.equal(seen.url,base+suffix);
 const auth=preset.protocol==='anthropic-messages'?'x-api-key':preset.protocol==='gemini-generate'?'x-goog-api-key':preset.id==='azure-v1'?'api-key':'authorization';
 if(preset.allowEmptyApiKey) assert.equal(seen.headers.get('authorization'),null); else assert.equal(seen.headers.get(auth),auth==='authorization'?'Bearer secret':'secret');
 for (const key of ['reasoning','thinking','enable_thinking','reasoning_effort']) assert.equal(seen.body[key],undefined);
 assert.equal(seen.body.generationConfig?.thinkingConfig,undefined);
 assert.equal(seen.body.model ?? seen.body.contents?.[0]?.role,preset.protocol==='gemini-generate'?'user':'test-model');
 }finally{globalThis.fetch=original}
});
for(const finish of ['length','content_filter','tool_calls',null]) test(`SDK rejects unsuccessful finish ${finish}`,async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>{const data=responseFor('openai-chat');data.choices[0].finish_reason=finish;return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}})};
 try{await assert.rejects(requestSdkCompletion({config:{platform:'custom',protocol:'openai-chat',apiBaseUrl:'https://example.org/v1',apiKey:'',model:'test-model'},body:{messages:[{role:'user',content:'test'}]}}),e=>e.code==='MALFORMED_RESPONSE')}finally{globalThis.fetch=original}
});
for (const scenario of [
 {platform:'openai',protocol:'openai-chat',model:'gpt-5-mini',reasoning:{mode:'effort',effort:'high'},expected:{reasoning_effort:'high'}},
 {platform:'azure-v1',protocol:'openai-responses',reasoning:{mode:'effort',effort:'high',advanced:true},expected:{reasoning:{effort:'high'}}},
 {platform:'anthropic',protocol:'anthropic-messages',model:'claude-sonnet-4-5',reasoning:{mode:'budget',budget:1024},expected:{thinking:{type:'enabled',budget_tokens:1024}}},
 {platform:'gemini',protocol:'gemini-generate',model:'gemini-2.5-flash',reasoning:{mode:'budget',budget:1024},expected:{generationConfig:{maxOutputTokens:4096,thinkingConfig:{thinkingBudget:1024}}}},
 {platform:'deepseek',protocol:'openai-chat',model:'deepseek-v4-flash',reasoning:{mode:'disabled'},expected:{thinking:{type:'disabled'}}},
 {platform:'dashscope',protocol:'openai-chat',reasoning:{mode:'budget',budget:1024,advanced:true},expected:{enable_thinking:true,thinking_budget:1024}},
 {platform:'moonshot',protocol:'openai-chat',reasoning:{mode:'disabled',advanced:true},expected:{thinking:{type:'disabled'}}},
 {platform:'siliconflow',protocol:'openai-chat',reasoning:{mode:'disabled',advanced:true},expected:{enable_thinking:false}},
 {platform:'zhipu',protocol:'openai-chat',reasoning:{mode:'disabled',advanced:true},expected:{thinking:{type:'disabled'}}},
 {platform:'volcengine',protocol:'openai-chat',reasoning:{mode:'effort',effort:'high',advanced:true},expected:{reasoning_effort:'high'}},
 {platform:'xai',protocol:'openai-chat',reasoning:{mode:'effort',effort:'low',advanced:true},expected:{reasoning_effort:'low'}},
 {platform:'xai',protocol:'openai-responses',reasoning:{mode:'effort',effort:'low',advanced:true},expected:{reasoning:{effort:'low'}}},
 {platform:'groq',protocol:'openai-chat',reasoning:{mode:'effort',effort:'low',advanced:true},expected:{reasoning_effort:'low'}},
 {platform:'mistral',protocol:'openai-chat',reasoning:{mode:'effort',effort:'high',advanced:true},expected:{reasoning_effort:'high'}},
 {platform:'openrouter',protocol:'openai-chat',reasoning:{mode:'effort',effort:'high',advanced:true},expected:{reasoning:{effort:'high'}}}
]) test(`${scenario.platform}/${scenario.protocol}: reasoning reaches the selected vendor`,async t=>{
 let body;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify(responseFor(scenario.protocol)),{headers:{'Content-Type':'application/json'}})});
 await requestSdkCompletion({config:{...scenario,model:scenario.model || 'test-model',apiBaseUrl:'https://resource.openai.azure.com/openai/v1',apiKey:'synthetic',outputTokens:4096},body:{messages:[{role:'user',content:'test'}]}});
 for(const [key,value] of Object.entries(scenario.expected)) assert.deepEqual(body[key],value);
});
test('full custom endpoint is not suffixed twice and transport has no SDK retry multiplier',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{calls++;assert.equal(String(url),'https://custom.example/proxy/chat/completions');return new Response('{"error":{"message":"busy"}}',{status:429,headers:{'Content-Type':'application/json'}})});
 await assert.rejects(requestSdkCompletion({config:{platform:'custom',protocol:'openai-chat',apiBaseUrl:'https://custom.example/proxy/chat/completions',model:'test'},body:{messages:[{role:'user',content:'test'}]},retryPolicy:{maxAttempts:2,malformedMaxAttempts:2,baseDelayMs:0,maxDelayMs:0,requestTimeoutMs:1000}}),{code:'RATE_LIMIT'});
 assert.equal(calls,2);
});
test('stream refusal metadata cannot become successful text even with stop',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('data: {"choices":[{"index":0,"delta":{"content":"OK","refusal":"refused"}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 await assert.rejects(requestSdkCompletion({config:{platform:'custom',protocol:'openai-chat',apiBaseUrl:'https://example.org/v1',model:'test',apiKey:'synthetic'},body:{messages:[{role:'user',content:'test'}]},stream:true}),{code:'MALFORMED_RESPONSE'});
});
test('a saved complete Gemini URL preserves its model path',async t=>{
 let url;
 t.mock.method(globalThis,'fetch',async input=>{url=String(input);return new Response(JSON.stringify(responseFor('gemini-generate')),{headers:{'Content-Type':'application/json'}})});
 await requestSdkCompletion({config:{platform:'custom',protocol:'gemini-generate',apiBaseUrl:'https://example.org/v1/models/fixed-model:generateContent',model:'other-model',apiKey:'synthetic'},body:{messages:[{role:'user',content:'test'}]}});
 assert.equal(url,'https://example.org/v1/models/fixed-model:generateContent');
});
for (const protocol of ['anthropic-messages','gemini-generate']) test(`${protocol}: text plus tool content is not a complete answer`,async t=>{
 const data=responseFor(protocol);
 if(protocol==='anthropic-messages') data.content.push({type:'tool_use',id:'tool_test',name:'lookup',input:{}});
 else data.candidates[0].content.parts.push({functionCall:{name:'lookup',args:{}}});
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
 await assert.rejects(requestSdkCompletion({config:{platform:'custom',protocol,apiBaseUrl:'https://example.org/v1',model:'test-model',outputTokens:4096,apiKey:'synthetic'},body:{messages:[{role:'user',content:'test'}]}}),{code:'MALFORMED_RESPONSE'});
});
