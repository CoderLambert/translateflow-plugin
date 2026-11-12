import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pageEnvironment} from './helpers/page-coverage-model.mjs';

test('task observation ignores owned mutations, drains source changes and releases listeners',async t=>{
  const {window,document}=await pageEnvironment(t);
  window.eval(await readFile(new URL('../src/content/page-observer.js',import.meta.url),'utf8'));
  const watch=window.__TRANSLATE_FLOW_CONTENT__.modules.pageObserver.track();
  const p=document.createElement('p');p.textContent='Source text.';document.body.append(p);
  const changed=watch.revision();assert.ok(changed>0);
  const translated=document.createElement('span');translated.className='abt-translation';translated.textContent='译文';p.append(translated);
  assert.equal(watch.revision(),changed);
  p.firstChild.nodeValue='Changed source.';assert.ok(watch.revision()>changed);
  const last=watch.revision();watch.stop();p.firstChild.nodeValue='Stopped source.';window.dispatchEvent(new window.Event('resize'));
  assert.equal(watch.revision(),last);
});
