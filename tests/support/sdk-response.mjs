export function responseFor(protocol, text='OK') {
 if(protocol==='openai-responses') return {object:'response',id:'resp_test',created_at:1,model:'test-model',status:'completed',output:[{type:'message',id:'msg_test',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 if(protocol==='anthropic-messages') return {id:'msg_test',type:'message',role:'assistant',model:'test-model',content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}};
 if(protocol==='gemini-generate') return {candidates:[{content:{role:'model',parts:[{text}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1,totalTokenCount:2}};
 return {id:'chat_test',created:1,model:'test-model',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:text},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
}
