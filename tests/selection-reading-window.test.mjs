import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile(new URL('../src/content/selection/selection.js',import.meta.url),'utf8');
function fixture(){
 const dom=new JSDOM('<section><header><strong>Title</strong><button>Close</button></header><main><details class="tf-selection-rich-record" open><div class="tf-selection-rich-text"></div></details></main></section>',{runScripts:'outside-only'});
 const w=dom.window,frames=new Map();let id=0,observer,changes=0;
 w.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};w.cancelAnimationFrame=n=>frames.delete(n);
 w.ResizeObserver=class {constructor(fn){this.fn=fn;observer=this;}observe(){}unobserve(){}disconnect(){this.disconnected=true;}};
 w.__TRANSLATE_FLOW_CONTENT__={modules:{runtime:{constants:{}},contentI18n:{bindText:(el,key)=>el.textContent=key,unbindTree(){}},uiPrimitives:{button:()=>w.document.createElement('button')}}};
 w.eval(source);const panel=w.document.querySelector('section'),result=w.document.querySelector('main');
 let height=80;Object.defineProperties(result,{clientHeight:{value:100},scrollHeight:{get:()=>height},clientWidth:{value:400},scrollWidth:{value:400}});
 const layout=w.__TRANSLATE_FLOW_CONTENT__.modules.selection.createReadingLayout({panel,result,header:w.document.querySelector('header'),onResize:()=>changes++});
 const flush=()=>{for(const [key,fn] of [...frames]){frames.delete(key);fn();}};
 return {dom,panel,result,layout,toggle:panel.querySelector('header').children[1],flush,setHeight:n=>{height=n;observer.fn();},changes:()=>changes,observer:()=>observer,frames};
}
test('late rich content expands once; restoring compact mode remains stable until a new selection',()=>{
 const h=fixture(),snap={};h.layout.update(snap);h.flush();assert.equal(h.panel.dataset.viewMode,'compact');assert.equal(h.toggle.hidden,false);
 h.setHeight(500);h.flush();assert.equal(h.panel.dataset.viewMode,'reading');assert.equal(h.changes(),1);
 h.layout.setActiveView('understand');h.flush();assert.equal(h.panel.dataset.viewMode,'compact');assert.equal(h.toggle.hidden,true);
 h.layout.setActiveView('dictionary');h.flush();assert.equal(h.panel.dataset.viewMode,'reading');assert.equal(h.toggle.hidden,false);
 h.setHeight(20);h.flush();assert.equal(h.panel.dataset.viewMode,'reading');
 h.toggle.click();assert.equal(h.panel.dataset.viewMode,'compact');h.setHeight(600);h.flush();assert.equal(h.panel.dataset.viewMode,'compact');
 h.layout.update({});h.flush();assert.equal(h.panel.dataset.viewMode,'reading');
 h.layout.dispose();h.dom.window.close();
});
test('hidden and collapsed dictionaries do not expand; closing cancels pending measurements',()=>{
 const h=fixture();h.panel.hidden=true;h.layout.update({});h.setHeight(600);h.flush();assert.equal(h.panel.dataset.viewMode,'compact');
 h.panel.hidden=false;h.result.querySelector('details').open=false;h.setHeight(600);h.flush();assert.equal(h.toggle.hidden,true);assert.equal(h.panel.dataset.viewMode,'compact');
 h.setHeight(900);h.layout.dispose();h.flush();assert.equal(h.observer().disconnected,true);assert.equal(h.frames.size,0);assert.equal(h.changes(),0);h.dom.window.close();
});
