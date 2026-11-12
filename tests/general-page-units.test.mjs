import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

async function environment(t, html) {
  const env = new JSDOM(`<!doctype html><style>*{opacity:1}</style>${html}`, { runScripts:'outside-only', url:'https://fixture.invalid/article' });
  t.after(() => env.window.close());
  env.window.Element.prototype.getBoundingClientRect = () => ({width:640,height:24,top:0,bottom:24});
  for (const name of ['runtime','structured','page-policy','page-units','page-discovery','dom','batch']) {
    const source = await readFile(new URL(`../src/content/${name}.js`, import.meta.url),'utf8').catch(error => { if(error.code==='ENOENT')return ''; throw error; });
    if (source) env.window.eval(source);
  }
  const dom = env.window.__TRANSLATE_FLOW_CONTENT__.modules.dom;
  assert.equal(typeof dom.collectUnits, 'function', 'the production DOM service must expose fragment discovery');
  return { dom, document:env.window.document, window:env.window };
}
const texts = (dom, units) => Array.from(units, unit => dom.extractSourceSegment(unit).text.replace(/⟦TF:[^⟧]*⟧/g, ""));

test('mixed block/inline content covers direct text once without reparenting source nodes', async t => {
  const {dom,document} = await environment(t, '<main><div id="mixed">Opening <strong>important context</strong> before the block.<p>Independent paragraph text.</p>Closing explanation after the block.</div></main>');
  const originalNodes = [...document.querySelector('#mixed').childNodes];
  const units = dom.collectUnits();
  assert.equal(units.length,3);
  assert.match(texts(dom,units)[0],/Opening.*important context.*before the block/);
  assert.equal(texts(dom,units)[1],'Independent paragraph text.');
  assert.equal(texts(dom,units)[2],'Closing explanation after the block.');
  for (const unit of [...units].reverse()) assert.equal(dom.insertTranslation(unit,dom.extractSourceSegment(unit).text),true);
  assert.ok(originalNodes.every(node => node.parentNode === document.querySelector('#mixed')));
  assert.equal(document.querySelectorAll('.abt-translation').length,3);
  dom.clearTranslations();
  assert.deepEqual([...document.querySelector('#mixed').childNodes],originalNodes);
});

test('nested inline wrappers, br, list and table boundaries neither swallow nor duplicate text', async t => {
  const {dom} = await environment(t, '<main><div>Outer preface <span>nested lead<p>Inner block.</p>nested tail</span> outer ending.</div><div>First line.<br>Second line.</div><ul><li>Item one.</li><li>Item two.</li></ul><table><tr><td>Cell one.</td><td>Cell two.</td></tr></table></main>');
  assert.deepEqual(texts(dom,dom.collectUnits()),['Outer preface nested lead','Inner block.','nested tail outer ending.','First line.','Second line.','Item one.','Item two.','Cell one.','Cell two.']);
});

test('long text is completely partitioned and reverse completion keeps output order', async t => {
  const text = Array.from({length:1800},(_,i)=>`word${i}`).join(' ');
  const {dom,document} = await environment(t, `<main><p id="long">${text}</p></main>`);
  const units=dom.collectUnits();
  assert.ok(units.length>2); assert.ok(texts(dom,units).every(text=>text.length<=4000));
  assert.equal(texts(dom,units).join(' ').replace(/\s+/g,' ').trim(),text);
  for(let i=units.length-1;i>=0;i--)dom.insertTranslation(units[i],`translated part ${i}`);
  assert.deepEqual([...document.querySelectorAll('.abt-translation')].map(el=>el.textContent),Array.from(units, (_,i)=>`translated part ${i}`));
  assert.equal(document.querySelector('#long').firstChild.nodeValue,text);
});

test('snapshots reject modified, moved, removed and cleared sources', async t => {
  const {dom,document}=await environment(t,'<main><div id="source">Initial source text.<p>Other block.</p>Trailing text.</div><div id="other"></div></main>');
  let unit=dom.collectUnits()[0];document.querySelector('#source').firstChild.nodeValue='New source text.';
  assert.equal(dom.insertTranslation(unit,'STALE'),false);
  unit=dom.collectUnits()[0];document.querySelector('#other').appendChild(document.querySelector('#source').firstChild);
  assert.equal(dom.insertTranslation(unit,'MOVED'),false);
  unit=dom.collectUnits()[0];dom.clearTranslations();assert.equal(dom.insertTranslation(unit,'CLEARED'),false);
  unit=dom.collectUnits()[0];unit.owner.remove();assert.equal(dom.insertTranslation(unit,'REMOVED'),false);
});

test('all readable roots, content/all scopes and local exclusions use the same policy', async t => {
  const {dom}=await environment(t,'<header><a href="/">Site menu</a></header><main><p>Main one.</p></main><main><p>Main two.</p><div hidden>HIDDEN</div><div contenteditable>INPUT</div><pre>CODE</pre><div translate="no">PRIVATE</div><p>Safe <code>run()</code> documentation.</p></main><footer>Footer links.</footer>');
  const content=texts(dom,dom.collectUnits({scope:'content'}));
  assert.ok(content.includes('Main one.')&&content.includes('Main two.'));
  assert.equal(content.some(text=>/Site menu|Footer/.test(text)),false);
  const all=texts(dom,dom.collectUnits({scope:'all'}));
  assert.ok(all.includes('Site menu')&&all.includes('Footer links.'));
  assert.equal(all.some(text=>/HIDDEN|INPUT|CODE|PRIVATE/.test(text)),false);
});

test('open Shadow DOM and assigned slots have one owner, with clear and hide across roots', async t => {
  const {dom,document}=await environment(t,'<main><reading-panel><p slot="copy">Assigned paragraph.</p></reading-panel></main>');
  const host=document.querySelector('reading-panel'),shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML='<div>Shadow introduction.<slot name="copy"></slot>Shadow ending.</div>';
  const units=dom.collectUnits();
  assert.deepEqual(texts(dom,units),['Shadow introduction.','Assigned paragraph.','Shadow ending.']);
  for(const unit of units)assert.equal(dom.insertTranslation(unit,dom.extractSourceSegment(unit).text),true);
  assert.equal(document.querySelectorAll('.abt-translation').length,1);
  assert.equal(shadow.querySelectorAll('.abt-translation').length,2);
  dom.setTranslationsHidden(true);assert.ok(units.every(unit=>dom.getTranslationNode(unit).hidden));
  dom.clearTranslations();assert.equal(shadow.querySelectorAll('.abt-translation').length,0);
  assert.equal(host.querySelector('p').getAttribute('slot'),'copy');
});

test('async scanning yields, checks cancellation and reports safety limits instead of partial success', async t => {
  const {dom,window}=await environment(t,`<main>${Array.from({length:600},(_,i)=>`<p>Paragraph ${i}.</p>`).join('')}</main>`);
  let yields=0;
  assert.equal((await dom.collectUnitsAsync({yieldEvery:30,onYield:()=>{yields++;}})).length,600);
  assert.ok(yields>1);
  const controller=new window.AbortController();
  await assert.rejects(dom.collectUnitsAsync({signal:controller.signal,yieldEvery:30,onYield:()=>controller.abort()}),error=>error.name==='AbortError');
  await assert.rejects(dom.collectUnitsAsync({maxNodes:20}),error=>error.code==='PAGE_SCAN_LIMIT');
});

test('inserted source children invalidate in-flight snapshots while extension children do not', async t => {
  const {dom,document}=await environment(t,'<main><p id="source">Original source with <strong>formatted words</strong>.</p></main>');
  const unit=dom.collectUnits()[0];
  document.querySelector('strong').appendChild(document.createTextNode(' additional source'));
  assert.equal(dom.insertTranslation(unit,'STALE'),false);
  const fresh=dom.collectUnits()[0];assert.equal(dom.insertTranslation(fresh,fresh.source.text),true);
  assert.equal(dom.isUnitCurrent(fresh),true);
  assert.equal(dom.collectUnits()[0],fresh,'rendering must preserve the source identity');
});

test('rich segments respect the encoded request budget and keep protected code unchanged', async t => {
  const markup=Array.from({length:500},(_,i)=>`<a href="/guide/${i}">topic${i}</a> `).join('');
  const {dom,document}=await environment(t,`<main><p>${markup}Call <code>stable_code()</code> safely.</p></main>`);
  const units=dom.collectUnits();assert.ok(units.length>1);
  assert.ok(units.every(unit=>unit.source.text.length<=4000));
  for(const unit of units)assert.equal(dom.insertTranslation(unit,unit.source.text),true);
  assert.equal(document.querySelector('.abt-translation code').textContent,'stable_code()');
  assert.equal(document.querySelectorAll('.abt-translation a').length,500);
});

test('closed disclosures and hidden main roots do not swallow the visible fallback content', async t => {
  const {dom,document}=await environment(t,'<main hidden><p>HIDDEN_MAIN</p></main><article><p>Visible article text.</p><details><summary>Open this section</summary><p>Closed disclosure content.</p></details></article>');
  assert.deepEqual(texts(dom,dom.collectUnits()),['Visible article text.','Open this section']);
  document.querySelector('details').open=true;
  assert.ok(texts(dom,dom.collectUnits()).includes('Closed disclosure content.'));
});

test('removed translations and reopened disclosure sources acquire a recoverable identity',async t=>{
  const {dom,document}=await environment(t,'<main><details open><summary>Open section</summary><p id="copy">This content can be closed and reopened.</p></details></main>');
  let unit=dom.collectUnits().find(unit=>unit.owner.id==='copy');
  dom.insertTranslation(unit,'first translation');dom.getTranslationNode(unit).remove();
  let fresh=dom.collectUnits().find(unit=>unit.owner.id==='copy');assert.notEqual(fresh,unit);assert.equal(dom.isUnitCurrent(unit),false);
  dom.insertTranslation(fresh,'restored translation');document.querySelector('details').open=false;dom.collectUnits();
  document.querySelector('details').open=true;unit=dom.collectUnits().find(unit=>unit.owner.id==='copy');assert.notEqual(unit,fresh);
  assert.equal(dom.insertTranslation(unit,'reopened translation'),true);
});

test('accessibility-hidden visible prose is readable while visually hidden and protected content stays excluded',async t=>{
 const {dom}=await environment(t,`<main><div role="link"><a href="/course" tabindex="-1" aria-hidden="true" style="display:contents"><div><h2>Visible course title</h2><p>Visible course description.</p><button>Open course</button></div></a></div>
 <span aria-hidden="true">Visible alternate label</span><div aria-hidden="true" hidden>HIDDEN_ATTRIBUTE</div><div aria-hidden="true" style="display:none">HIDDEN_DISPLAY</div><div aria-hidden="true" style="visibility:hidden">HIDDEN_VISIBILITY</div><div aria-hidden="true" style="opacity:0">HIDDEN_OPACITY</div><div translate="no">PROTECTED_TEXT</div><div contenteditable>PRIVATE_EDITOR</div></main>`);
 assert.deepEqual(texts(dom,dom.collectUnits()),['Visible course title','Visible course description.','Open course','Visible alternate label']);
});

test('external link wrappers do not enter unit format identity or create nested links',async t=>{
 const {dom,document}=await environment(t,'<main><div id="card"><h2>Card title</h2><p id="description">Read <strong>the guide</strong> carefully.</p><button>Open course</button></div><p id="inline">Use <a href="/inline">this inline link</a> for help.</p></main>');
 const before=dom.collectUnits();const sources=Array.from(before,u=>JSON.stringify(u.source));
 const card=document.querySelector('#card'),wrapper=document.createElement('a');wrapper.href='/course';wrapper.style.display='contents';card.before(wrapper);wrapper.appendChild(card);
 assert.ok(before.slice(0,3).every(unit=>!dom.isUnitCurrent(unit)),'moving sources must still invalidate old snapshots');
 const after=dom.collectUnits();assert.deepEqual(Array.from(after,u=>JSON.stringify(u.source)),sources);
 for(const unit of after)assert.equal(dom.insertTranslation(unit,unit.source.text),true);
 assert.equal(document.querySelectorAll('#card .abt-translation a').length,0);
 assert.equal(document.querySelector('#inline .abt-translation a').getAttribute('href'),'/inline');
});

test('fully clipped accessibility text is excluded without discarding partially clipped readable text', async t => {
  const {dom,window}=await environment(t, `<main>
    <div style="position:absolute;clip-path:inset(50%)" aria-hidden="true"><h2>HIDDEN_ACCESSIBILITY</h2></div>
    <div style="clip-path:inset(0 100% 0 0)">HIDDEN_HORIZONTAL_CLIP</div>
    <div style="position:absolute;clip:rect(0px, 0px, 0px, 0px)">HIDDEN_LEGACY_CLIP</div>
    <p style="clip-path:inset(2px 3px)">Partially clipped prose remains readable.</p>
    <p style="position:absolute;clip:rect(0px, 100px, 20px, 0px)">A nonempty legacy clip remains readable.</p>
    <p style="clip-path:inset(10px 250px);transform:scale(.5)">Scaled clipped prose remains readable.</p>
  </main>`);
  // JSDOM has no layout. Supply a 640x24 untransformed box; viewport geometry
  // is deliberately smaller so a transform cannot falsely make the clip empty.
  Object.defineProperties(window.HTMLElement.prototype, {offsetWidth:{get:()=>640},offsetHeight:{get:()=>24}});
  window.Element.prototype.getBoundingClientRect=()=>({width:320,height:12});
  assert.deepEqual(texts(dom,dom.collectUnits()),['Partially clipped prose remains readable.','A nonempty legacy clip remains readable.','Scaled clipped prose remains readable.']);
});
