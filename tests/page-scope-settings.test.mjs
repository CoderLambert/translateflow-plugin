import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {readPublicSettings,writePublicSettings} from '../src/background/public-settings.js';
const source=await readFile(new URL('../src/content/page-scope.js',import.meta.url),'utf8');

test('public scope settings validate values and do not expose credentials',async t=>{
  const original=globalThis.chrome, patches=[];let keys;
  globalThis.chrome={storage:{local:{get:async requested=>{keys=requested;return{};},set:async patch=>patches.push(patch)}}};
  t.after(()=>{globalThis.chrome=original;});
  await readPublicSettings();assert.ok(keys.includes('pageTranslationScope'));assert.equal(keys.includes('apiKey'),false);
  await writePublicSettings({pageTranslationScope:'all'});assert.deepEqual(patches,[{pageTranslationScope:'all'}]);
  await assert.rejects(writePublicSettings({pageTranslationScope:'unexpected'}),{code:'CONFIG'});
  assert.equal(patches.length,1);
});

test('a settings change wins over an older initial read and only page tasks are cancelled',async()=>{
  let resolve,cleared=0,cancelled=0;const task={id:'task',surface:'selection'};
  const modules={runtime:{state:{pageScope:'content'},messages:{background:{}},sendRuntimeMessage:()=>new Promise(done=>{resolve=done;})},
    dom:{clearTranslations(){cleared++;}},tasks:{getLatestTask:()=>task,isTerminal:()=>false,cancelTask:async()=>{cancelled++;}}};
  vm.runInNewContext(source,{__TRANSLATE_FLOW_CONTENT__:{modules}});
  const loading=modules.pageScope.load();modules.pageScope.apply('all');resolve({settings:{pageTranslationScope:'content'}});await loading;
  assert.equal(modules.runtime.state.pageScope,'all');assert.equal(cancelled,0);assert.equal(cleared,1);
  task.surface='page';modules.pageScope.apply('content');assert.equal(cancelled,1);assert.equal(cleared,2);
});
