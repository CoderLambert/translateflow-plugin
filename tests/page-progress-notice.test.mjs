import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

function setup() {
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://example.test/article'});
 const layer=dom.window.document.createElement('div');dom.window.document.body.appendChild(layer);
 const timers=new Map();let timerId=0;
 const app={modules:{contentI18n:{t:(key,args)=>key+(args?.progress||''),subscribe:()=>()=>{}},uiHost:{getLayer:()=>layer},runtime:{
  getPageIdentity:url=>new URL(url).href.split('#')[0],messages:{background:{CANCEL_TRANSLATION:'cancel'}},sendRuntimeMessage:async()=>({ok:true})
 }}};
 const context=vm.createContext({__TRANSLATE_FLOW_CONTENT__:app,window:dom.window,document:dom.window.document,location:dom.window.location,
  crypto:{randomUUID:()=>String(Math.random())},setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id)});
 for(const file of ['src/content/ui/primitives.js','src/content/tasks.js','src/content/ui/page-progress.js']) vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 app.modules.pageProgress.start();
 return {dom,layer,timers,tasks:app.modules.tasks,view:app.modules.pageProgress};
}

test('page progress is visible from queued through scan and translation without an auto-hide timer',()=>{
 const h=setup();try {
  const task=h.tasks.createTask({id:'manual',total:0});
  const node=h.layer.querySelector('.tf-page-progress'),meter=node.querySelector('[role=progressbar]');
  assert.equal(node.hidden,false);assert.equal(node.dataset.state,'queued');assert.equal(meter.hasAttribute('aria-valuenow'),false);
  assert.equal(h.timers.size,0);
  h.tasks.transition(task,'translating',{total:8,done:3});
  assert.equal(meter.getAttribute('aria-valuenow'),'3');assert.equal(meter.getAttribute('aria-valuemax'),'8');
  assert.equal(node.querySelector('.tf-page-progress-count').textContent,'3/8');assert.equal(h.timers.size,0);
  assert.equal(h.view.announce('manual','legacy progress','info'),true);
  assert.equal(node.dataset.state,'translating');
  h.tasks.completeTask(task,{done:8});
  assert.equal(node.dataset.state,'completed');assert.equal(meter.getAttribute('aria-valuenow'),'8');assert.equal(h.timers.size,1);
  for(const callback of [...h.timers.values()]) callback();
  assert.equal(node.hidden,true);
 }finally{h.dom.window.close();}
});
test('a late terminal hide timer cannot remove a newer task; auto and selection tasks stay silent',()=>{
 const h=setup();try {
  h.tasks.createTask({id:'auto',surface:'auto'});h.tasks.createTask({id:'word',surface:'selection'});
  assert.equal(h.layer.querySelector('.tf-page-progress'),null);
  const old=h.tasks.createTask({id:'old',total:1});h.tasks.completeTask(old,{done:1});
  const late=[...h.timers.values()][0];
  h.tasks.createTask({id:'new',total:3});late();
  assert.equal(h.layer.querySelector('.tf-page-progress').hidden,false);assert.equal(h.timers.size,0);
  assert.equal(h.view.announce('old','old result','success'),false);
 }finally{h.dom.window.close();}
});
test('failure and confirmed cancellation replace progress; a changed page hides the old notice',async()=>{
 const h=setup();try {
  const failed=h.tasks.createTask({id:'failure',total:5});h.tasks.failTask(failed,new Error('Recoverable failure'));
  const node=h.layer.querySelector('.tf-page-progress');
  assert.equal(node.dataset.state,'failed');assert.equal(node.dataset.kind,'error');
  assert.equal(node.querySelector('[role=progressbar]').hidden,true);
  const cancelled=h.tasks.createTask({id:'cancelled',total:5});await h.tasks.cancelTask(cancelled);
  assert.equal(node.dataset.state,'cancelled');
  const stale=h.tasks.createTask({id:'stale',total:5});h.dom.window.history.pushState(null,'','/next');h.tasks.updateProgress(stale,{done:1});
  assert.equal(node.hidden,true);
 }finally{h.dom.window.close();}
});


test('a page redraw cannot permanently remove the active task notice or duplicate its stylesheet',()=>{
 const h=setup();try {
  const task=h.tasks.createTask({id:'redraw',total:5});h.tasks.transition(task,'translating',{done:1});
  h.layer.querySelector('.tf-page-progress').remove();
  assert.equal(h.view.announce('redraw','legacy tick','info'),true);
  assert.equal(h.layer.querySelector('.tf-page-progress').hidden,false);
  assert.equal(h.layer.querySelector('.tf-page-progress-count').textContent,'1/5');
  assert.equal(h.layer.querySelectorAll('style').length,1);
 }finally{h.dom.window.close();}
});
