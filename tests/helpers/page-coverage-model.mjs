import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

export async function pageEnvironment(t, mutate = (name, source) => source) {
  const env = new JSDOM('<!doctype html><style>*{opacity:1}</style><body></body>', {runScripts:'outside-only',url:'https://fixture.invalid/'});
  t.after(() => env.window.close());
  env.window.Element.prototype.getBoundingClientRect = () => ({width:640,height:24,top:0,bottom:24});
  for(const name of ['runtime','structured','page-policy','page-units','page-discovery','dom','batch']) {
    const source = await readFile(new URL(`../../src/content/${name}.js`,import.meta.url),'utf8');
    env.window.eval(mutate(name, source));
  }
  return {window:env.window,document:env.window.document,...env.window.__TRANSLATE_FLOW_CONTENT__.modules};
}

// Expected membership is authored by the model, never computed by the candidate policy.
export function populateModel(document, seed) {
  const expected = new Map();
  const leaf = (parent, text, eligible=true, tag='span') => {
    const el = document.createElement(tag), node=document.createTextNode(text);
    el.append(node);parent.append(el);if(eligible)expected.set(node,text);return el;
  };
  for(let rootIndex=0;rootIndex<2;rootIndex++) {
    const main=document.createElement('main');document.body.append(main);
    for(let i=0;i<12;i++) {
      const box=document.createElement('div');main.append(box);
      const tag=['span','p','div'][((seed+i)*7)%3];
      const lead=leaf(box,`Readable source ${rootIndex}-${i} before.`,true,tag);
      if((seed+i)%2===0){const wrapper=document.createElement('span');wrapper.style.display='contents';lead.replaceWith(wrapper);wrapper.append(lead);}
      if((seed+i)%3===0)box.setAttribute('aria-hidden','true');
      if((seed+i)%4===0)box.style.marginTop='2000px';
      if(i%2===0){leaf(box,`Independent inner block ${rootIndex}-${i}.`,true,'p');leaf(box,`Readable ending ${rootIndex}-${i}.`);}
    }
    const hidden=document.createElement('div');hidden.style.visibility='hidden';main.append(hidden);
    leaf(hidden,'NEVER_SEND_INHERITED_HIDDEN',false);
    const visible=leaf(hidden,`Restored visible text ${rootIndex}.`);visible.style.visibility='visible';
    for(const kind of ['hidden','translate','contenteditable']) {
      const box=document.createElement('div');box.setAttribute(kind,kind==='translate'?'no':'true');main.append(box);
      leaf(box,`NEVER_SEND_${kind}`,false);
    }
    const code=document.createElement('pre');main.append(code);leaf(code,'NEVER_SEND_CODE',false);
    const host=document.createElement('reading-panel');main.append(host);
    const shadow=host.attachShadow({mode:'open'}),inner=document.createElement('div');shadow.append(inner);
    leaf(inner,`Shadow text ${rootIndex}.`);
    const slot=document.createElement('slot');inner.append(slot);leaf(host,`Assigned text ${rootIndex}.`);
  }
  return expected;
}

export function assertSourceCoverage(units, expected) {
  const actual=new Map();
  for(const unit of units)for(const part of unit.parts) {
    assert(expected.has(part.node),`Unexpected source: ${part.node.nodeValue}`);
    let indices=actual.get(part.node);if(!indices){indices=new Set();actual.set(part.node,indices);}
    for(let i=part.from;i<part.to;i++)if(!/\s/u.test(part.node.nodeValue[i])) {
      assert(!indices.has(i),'Source character belongs to multiple translation units');indices.add(i);
    }
  }
  for(const [node,text] of expected) {
    const wanted=[...text].filter(c=>!(/\s/u.test(c))).length;
    assert.equal(actual.get(node)?.size||0,wanted,`Uncovered source: ${text}`);
  }
}
