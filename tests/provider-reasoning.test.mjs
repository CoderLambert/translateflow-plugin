import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReasoning, reasoningCapabilities, reasoningProviderOptions } from '../src/shared/provider-reasoning.js';
import { normalizeProviderConnection } from '../src/shared/provider-connections.js';
import { translationConfigIdentity } from '../src/shared/translation-cache-identity.js';

test('legacy effort migrates idempotently and default sends no provider options', () => {
  assert.deepEqual(normalizeReasoning('high'), { mode: 'effort', effort: 'high' });
  assert.deepEqual(normalizeReasoning(normalizeReasoning('high')), normalizeReasoning('high'));
  assert.deepEqual(reasoningProviderOptions({ platform: 'openai', model: 'unknown', reasoning: '' }), {});
});
test('unknown models need explicit advanced confirmation; never guess from a prefix', () => {
  assert.equal(reasoningCapabilities('openai', 'gpt-future').verified, false);
  assert.throws(() => reasoningProviderOptions({platform:'openai', model:'gpt-future', reasoning:{mode:'effort',effort:'high'}}), /未验证/u);
  assert.deepEqual(reasoningProviderOptions({platform:'openai', model:'gpt-future', reasoning:{mode:'effort',effort:'high',advanced:true}}), { openai:{reasoningEffort:'high'} });
});
test('vendor thinking switches remain distinct and budgets are validated', () => {
  const config = {model:'unknown',reasoning:{mode:'disabled',advanced:true}};
  assert.deepEqual(reasoningProviderOptions({...config,platform:'siliconflow'}), {siliconflow:{enable_thinking:false}});
  assert.deepEqual(reasoningProviderOptions({...config,platform:'zhipu'}), {zhipu:{thinking:{type:'disabled'}}});
  assert.deepEqual(reasoningProviderOptions({...config,platform:'volcengine'}), {volcengine:{thinking:{type:'disabled'}}});
  assert.throws(() => normalizeReasoning({mode:'budget',budget:-1}), /预算/u);
});
test('saved reasoning survives reload and affects cache identity', () => {
 const raw={id:'test',protocol:'openai-chat',platform:'openai',baseUrl:'https://example.org/v1',settings:{reasoning:'high'}};
 const saved=normalizeProviderConnection(raw);
 assert.deepEqual(normalizeProviderConnection(saved).settings.reasoning,{mode:'effort',effort:'high'});
 assert.notDeepEqual(translationConfigIdentity({reasoning:saved.settings.reasoning}),translationConfigIdentity({reasoning:{mode:'default'}}));
});
test('unknown legacy effort preserves the connection and reports unsupported instead of dropping it',()=>{
 const raw={id:'test',platform:'openai',protocol:'openai-chat',baseUrl:'https://example.org/v1',settings:{reasoning:'old-custom-effort'}};
 const normalized=normalizeProviderConnection(raw);
 assert.equal(normalized.settings.reasoning.effort,'old-custom-effort');
 assert.equal(normalizeProviderConnection(normalized).id,'test');
 assert.throws(()=>reasoningProviderOptions({platform:'openai',model:'gpt-5-mini',reasoning:normalized.settings.reasoning}), /不支持/u);
});
