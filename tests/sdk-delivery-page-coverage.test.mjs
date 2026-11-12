import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const names=['runtime','structured','page-policy','page-units','page-discovery','dom','batch'];
const sources=await Promise.all(names.filter(name=>existsSync(new URL(`../src/content/${name}.js`,import.meta.url))).map(name=>readFile(new URL(`../src/content/${name}.js`,import.meta.url),'utf8')));
test('SDK delivery retains semantic paragraphs and visually visible hydrated cards',t=>{
 const env=new JSDOM(`<!doctype html><style>*{opacity:1} [data-as=p]{display:block}</style><main>
 <h2 id="heading">Choose your starting point</h2>
 <span id="intro" data-as="p">This synthetic paragraph describes how the open source framework works.</span>
 <span id="detail" data-as="p">Another complete explanation describes the model, tools and context.</span>
 <a aria-hidden="true" style="display:contents"><span><p id="card">This visually readable card explains how to build and deploy agents.</p></span></a>
 <span id="hidden" style="display:none">This hidden paragraph must not be translated.</span>
 </main>`,{runScripts:'outside-only',url:'https://fixture.invalid/build-overview'});
 t.after(()=>env.window.close());env.window.Element.prototype.getBoundingClientRect=()=>({width:640,height:24});
 for(const source of sources) env.window.eval(source);
 const dom=env.window.__TRANSLATE_FLOW_CONTENT__.modules.dom;
 assert.deepEqual(Array.from(dom.collectElements(),element=>element.id),['heading','intro','detail','card']);
});
