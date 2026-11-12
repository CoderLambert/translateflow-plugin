// Real HTTP fixtures: include the terminal metadata required by SDK providers.
export function completedFixture(payload) {
  if (payload.choices) payload = {...payload, choices:payload.choices.map((choice,index)=>({index,finish_reason:'stop',...choice}))};
  if (payload.output || payload.output_text) payload = {id:'resp_fixture',created_at:1,status:'completed',...payload,output:payload.output || [{type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:payload.output_text,annotations:[]}]}]};
  if (payload.output) payload.output=payload.output.map(item=>({content:[],type:'message',id:'msg_fixture',role:'assistant',status:'completed',...item,content:(item.content || []).map(c=>c.type === 'output_text' ? {annotations:[],...c}:c)}));
  if(payload.content) payload={id:'msg_fixture',type:'message',role:'assistant',model:'test-model',stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1},...payload};
  if(payload.candidates) payload={...payload,candidates:payload.candidates.map(c=>({finishReason:'STOP',...c}))};
  return payload;
}
export function providerResponse(status,payload,headers={}) {
  return new Response(JSON.stringify(status>=200&&status<300 ? completedFixture(payload):payload), {status,headers:{'Content-Type':'application/json',...headers}});
}
