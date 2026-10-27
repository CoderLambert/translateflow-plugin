import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeMessagingClient} from '../src/background/providers/native-messaging.js';
function fixture(){const listeners=[],disconnects=[],starts=[];const port={onMessage:{addListener:f=>listeners.push(f)},onDisconnect:{addListener:f=>disconnects.push(f)},disconnect(){for(const f of disconnects)f()},postMessage(r){if(r.method==='hello')finish(r,{protocolVersion:1,hostVersion:'dev',capabilities:['auth.status','auth.start','auth.select','auth.logout','models.list','infer.start','cancel']});else if(r.method==='infer.start')starts.push(r);}};function finish(r,payload={text:'done'}){for(const f of listeners)f({requestId:r.requestId,sequence:0,type:'terminal',ok:true,payload})}const client=createNativeMessagingClient({getBrowser:()=>({runtime:{getManifest:()=>({permissions:['nativeMessaging']}),connectNative:()=>port}})});return{client,starts,finish,port};}
const tick=()=>new Promise(r=>setImmediate(r));
test('native inference queues FIFO across surfaces and cancels queued work without starting it',async()=>{
 const f=fixture(),control=new AbortController();const outcomes=[];
 const track=p=>p.then(v=>({value:v}),e=>({code:e.code}));
 outcomes.push(track(f.client.infer({input:'page'})));await tick();
 outcomes.push(track(f.client.infer({input:'explanation'},{signal:control.signal})));
 outcomes.push(track(f.client.infer({input:'follow-up'})));await tick();
 control.abort();await tick();f.finish(f.starts[0]);await outcomes[0];await tick();
 const order=f.starts.map(r=>r.payload.input);
 if(f.starts[1])f.finish(f.starts[1]);
 const result=await Promise.all(outcomes);
 assert.deepEqual(order,['page','follow-up']);assert.equal(result[1].code,'CANCELLED');assert.equal(result[2].value.text,'done');
});
test('native disconnect rejects waiting inference instead of silently replaying on a new connection',async()=>{
 const f=fixture(),track=p=>p.then(()=>null,e=>e.code);
 const first=track(f.client.infer({input:'page'}));await tick();const second=track(f.client.infer({input:'explanation'}));await tick();f.port.disconnect();
 assert.deepEqual(await Promise.all([first,second]),['NATIVE_HOST_DISCONNECTED','NATIVE_HOST_DISCONNECTED']);assert.equal(f.starts.length,1);
});
