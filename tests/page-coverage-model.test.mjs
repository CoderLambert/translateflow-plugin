import test from 'node:test';
import assert from 'node:assert/strict';
import {pageEnvironment,populateModel,assertSourceCoverage} from './helpers/page-coverage-model.mjs';

for(const seed of [0,1,2,3,11,29]) test(`independent source coverage survives wrappers, layout and composed trees, seed ${seed}`,async t=>{
  const {document,dom}=await pageEnvironment(t);
  const expected=populateModel(document,seed);
  const units=await dom.collectUnitsAsync();
  assertSourceCoverage(units,expected);
  assert.equal(units.coverage.unaccountedCharacters,0);
  assert.equal(units.coverage.duplicateCharacters,0);
  assert.ok(units.coverage.reasons['hidden-attribute']>0);
  assert.ok(units.coverage.reasons['editable']>0);
  assert.ok(units.coverage.reasons['no-translate']>0);
});

test('coverage decisions retain one-letter prose and URL-leading explanations while explaining skips',async t=>{
  const {document,dom,batch}=await pageEnvironment(t);
  document.body.innerHTML='<main><p>I</p><p>https://example.test explains this resource.</p><p>https://example.test</p><p>123</p></main><footer>Outside main scope</footer>';
  const units=await dom.collectUnitsAsync();
  assert.deepEqual(Array.from(batch.buildEntries(units),e=>e.text),['I','https://example.test explains this resource.']);
  assert.equal(units.coverage.reasons['url-only'],1);
  assert.equal(units.coverage.reasons['nonlinguistic'],1);
  assert.ok(units.coverage.reasons['outside-scope']>0);
  assert.equal(units.coverage.unaccountedCharacters,0);
});

for(const mutation of ['drop-spans','first-main-only'])test(`independent oracle detects injected ${mutation} defect`,async t=>{
  const {document,dom}=await pageEnvironment(t,(name,source)=>{
    if(mutation==='drop-spans'&&name==='page-discovery')return source.replace('if (node.nodeType === 3) {','if (node.nodeType === 3) { if (node.parentElement?.tagName === "SPAN") continue;');
    if(mutation==='first-main-only'&&name==='page-policy')return source.replace('const unique = candidates.filter','const unique = candidates.slice(0, 1).filter');
    return source;
  });
  const expected=populateModel(document,0);
  assert.throws(()=>assertSourceCoverage(dom.collectUnits(),expected),/Uncovered source/);
});

test('coverage accounting itself yields and remains cancellable',async t=>{
  const {document,dom,window}=await pageEnvironment(t);populateModel(document,0);
  const controller=new window.AbortController();
  await assert.rejects(dom.collectUnitsAsync({signal:controller.signal,yieldEvery:5,onYield:phase=>{if(phase==='coverage')controller.abort();}}),error=>error.name==='AbortError');
});

test('protected literals cannot turn punctuation-only prose into a translation request',async t=>{
  const {document,dom,batch}=await pageEnvironment(t);
  document.body.innerHTML='<main><p><code>do_not_translate()</code>.</p><p>Read <code>run()</code> safely.</p></main>';
  const units=await dom.collectUnitsAsync(),entries=batch.buildEntries(units);
  assert.equal(entries.length,1);assert.ok(entries[0].text.startsWith('Read '));
  assert.equal(units.coverage.reasons.nonlinguistic,1);
});
