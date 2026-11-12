import test from 'node:test';
import assert from 'node:assert/strict';
import { reasoningProviderOptions, reasoningCapabilities, normalizeReasoning } from '../src/shared/provider-reasoning.js';
import { normalizeProviderConnection, PROVIDER_PLATFORMS } from '../src/shared/provider-connections.js';
import { translationConfigIdentity } from '../src/shared/translation-cache-identity.js';
import { requestSdkCompletion } from '../src/background/providers/ai-sdk-transport.js';
import { responseFor } from './support/sdk-response.mjs';

const scenarios = [
 {platform:'openai',protocol:'openai-chat',model:'gpt-5-mini',fast:{reasoning_effort:'minimal'},enhanced:{reasoning_effort:'medium'}},
 {platform:'openai',protocol:'openai-responses',model:'gpt-5.1',fast:{reasoning:{effort:'none'}},enhanced:{reasoning:{effort:'medium'}}},
 {platform:'openai',protocol:'openai-chat',model:'gpt-6.1-sol',fast:{reasoning_effort:'low'},enhanced:{reasoning_effort:'medium'}},
 {platform:'azure-v1',protocol:'openai-chat',model:'o3',fast:{reasoning_effort:'low'},enhanced:{reasoning_effort:'medium'}},
 {platform:'deepseek',protocol:'openai-chat',model:'deepseek-v4-flash',fast:{thinking:{type:'disabled'}},enhanced:{thinking:{type:'enabled'},reasoning_effort:'low'}},
 {platform:'anthropic',protocol:'anthropic-messages',model:'claude-sonnet-4-5',fast:{thinking:{type:'disabled'}},enhanced:{thinking:{type:'enabled',budget_tokens:1024}}},
 {platform:'gemini',protocol:'gemini-generate',model:'gemini-2.5-flash',fast:{generationConfig:{maxOutputTokens:4096,thinkingConfig:{thinkingBudget:0}}},enhanced:{generationConfig:{maxOutputTokens:4096,thinkingConfig:{thinkingBudget:-1}}}},
 {platform:'gemini',protocol:'gemini-generate',model:'gemini-2.5-pro',fast:{generationConfig:{maxOutputTokens:4096,thinkingConfig:{thinkingBudget:128}}},enhanced:{generationConfig:{maxOutputTokens:4096,thinkingConfig:{thinkingBudget:-1}}}},
 {platform:'moonshot',protocol:'openai-chat',model:'kimi-k2.5',fast:{thinking:{type:'disabled'}},enhanced:{thinking:{type:'enabled'}}}
];
for(const scenario of scenarios) for(const mode of ['default','enhanced']) test(`${scenario.platform}/${scenario.model}/${mode}: preset becomes real SDK request parameters`, async t=>{
 let body;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{body=JSON.parse(init.body);return new Response(JSON.stringify(responseFor(scenario.protocol)),{headers:{'Content-Type':'application/json'}})});
 await requestSdkCompletion({config:{...scenario,apiBaseUrl:'https://example.org/v1',apiKey:'synthetic',outputTokens:4096,reasoning:{mode}},body:{messages:[{role:'user',content:'test'}]}});
 for(const [key,value] of Object.entries(mode==='default'?scenario.fast:scenario.enhanced)) assert.deepEqual(body[key],value);
});
test('provider default explicitly omits reasoning, while saved custom parameters retain their values',()=>{
 assert.deepEqual(normalizeReasoning({mode:'model-default'}),{mode:'model-default'});
 assert.deepEqual(reasoningProviderOptions({platform:'openai',model:'gpt-5-mini',reasoning:{mode:'model-default'}}),{});
 const raw={id:'saved',platform:'openai',protocol:'openai-chat',baseUrl:'https://example.org/v1',settings:{reasoning:'high'}};
 const saved=normalizeProviderConnection(raw);
 assert.deepEqual(saved.settings.reasoning,{mode:'effort',effort:'high'});
 assert.deepEqual(reasoningProviderOptions({...saved,model:'gpt-5-mini',reasoning:saved.settings.reasoning}),{openai:{reasoningEffort:'high'}});
});
test('unknown models and Azure deployment aliases never receive guessed preset parameters',()=>{
 for(const platform of PROVIDER_PLATFORMS) for(const mode of ['default','enhanced']) {
  assert.deepEqual(reasoningProviderOptions({platform:platform.id,protocol:platform.protocol,model:'gpt-5-mini-custom-alias',reasoning:{mode}}),{});
 }
 assert.deepEqual(reasoningProviderOptions({platform:'custom',protocol:'openai-chat',model:'gpt-5-mini',reasoning:{mode:'default'}}),{});
 assert.deepEqual(reasoningProviderOptions({platform:'siliconflow',protocol:'openai-chat',model:'deepseek-v4-flash',reasoning:{mode:'default'}}),{});
 assert.equal(reasoningCapabilities('openai','gpt-5-mini').modes.includes('enhanced'),true);
 assert.equal(reasoningCapabilities('openai','gpt-future').modes.includes('enhanced'),false);
});
test('preset cache identity includes the resolved parameters and policy version; other engines stay separate',()=>{
 const config={provider:'openai-compatible',platform:'openai',protocol:'openai-chat',model:'gpt-5-mini'};
 const fast=translationConfigIdentity({...config,reasoning:{mode:'default'}});
 assert.equal(typeof fast.reasoningPolicyVersion,'string');
 assert.deepEqual(fast.parameters.effectiveReasoning,{mode:'effort',effort:'minimal'});
 for(const mode of ['enhanced','model-default']) assert.notDeepEqual(fast,translationConfigIdentity({...config,reasoning:{mode}}));
 assert.equal(translationConfigIdentity({provider:'chatgpt-plan'}).reasoningPolicyVersion,undefined);
 assert.equal(translationConfigIdentity({engine:'machine-translation',provider:'mt-microsoft-web'}).reasoningPolicyVersion,undefined);
});
test('enhanced thinking with too small a saved output limit reports a recoverable config error',()=>{
 assert.throws(()=>reasoningProviderOptions({platform:'anthropic',model:'claude-sonnet-4-5',outputTokens:1024,reasoning:{mode:'enhanced'}}),/预算/u);
});

test('streaming uses the same fast preset and preserves one completed request',async t=>{
 let body,calls=0,progress='';
 const chunk={id:'chat_stream',object:'chat.completion.chunk',created:1,model:'gpt-5-mini'};
 t.mock.method(globalThis,'fetch',async(_url,init)=>{
  calls++;body=JSON.parse(init.body);
  const events=[{...chunk,choices:[{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null}]},{...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}]}];
  return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 });
 const result=await requestSdkCompletion({config:{platform:'openai',protocol:'openai-chat',model:'gpt-5-mini',apiBaseUrl:'https://example.org/v1',apiKey:'synthetic',outputTokens:512},body:{messages:[{role:'user',content:'test'}]},stream:true,onTextDelta:delta=>{progress+=delta;}});
 assert.equal(body.reasoning_effort,'minimal');
 assert.equal(result.choices[0].message.content,'OK');
 assert.equal(progress,'OK');assert.equal(calls,1);
});
