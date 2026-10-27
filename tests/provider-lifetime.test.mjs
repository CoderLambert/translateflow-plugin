import test from 'node:test';
import assert from 'node:assert/strict';
import {withProviderLifetime} from '../src/background/provider-lifetime.js';

function runtime(t, api) {
  const previous=globalThis.chrome;globalThis.chrome={runtime:{getPlatformInfo:api}};
  t.after(()=>{globalThis.chrome=previous;});
  t.mock.timers.enable({apis:['setInterval']});
}

test('overlapping operations share keepalive and the last settlement releases it', async t=>{
  let calls=0,finishFirst,finishSecond;runtime(t,async()=>{calls++;});
  const first=withProviderLifetime(()=>new Promise(resolve=>{finishFirst=resolve;}));
  const second=withProviderLifetime(()=>new Promise(resolve=>{finishSecond=resolve;}));
  assert.equal(calls,1);t.mock.timers.tick(20000);assert.equal(calls,2);
  finishFirst('first');assert.equal(await first,'first');
  t.mock.timers.tick(20000);assert.equal(calls,3);
  finishSecond('second');assert.equal(await second,'second');
  t.mock.timers.tick(60000);assert.equal(calls,3,'no idle keepalive after both requests finish');
});

test('cancellation keeps its original error and releases keepalive', async t=>{
  let calls=0;runtime(t,async()=>{calls++;});
  const controller=new AbortController();
  const request=withProviderLifetime(()=>new Promise((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{code:'CANCELLED'})),{once:true})));
  controller.abort();await assert.rejects(request,{code:'CANCELLED'});
  t.mock.timers.tick(60000);assert.equal(calls,1);
});

test('synchronous provider failure releases the lifetime lease', async t=>{
  let calls=0;runtime(t,async()=>{calls++;});
  await assert.rejects(withProviderLifetime(()=>{throw Object.assign(new Error('failed'),{code:'CONFIG'});}),{code:'CONFIG'});
  t.mock.timers.tick(60000);assert.equal(calls,1);
});

test('keepalive API failure does not replace the provider result', async t=>{
  runtime(t,()=>Promise.reject(new Error('runtime unavailable')));
  assert.equal(await withProviderLifetime(async()=>42),42);
});

test('non-extension callers do not require Chrome APIs', async t=>{
  runtime(t,undefined);
  assert.equal(await withProviderLifetime(async()=>42),42);
});
