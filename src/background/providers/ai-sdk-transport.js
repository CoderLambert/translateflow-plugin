import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAzure } from '@ai-sdk/azure';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createAlibaba } from '@ai-sdk/alibaba';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { reasoningProviderOptions } from '../../shared/provider-reasoning.js';
import { DEFAULT_RETRY_POLICY, classifyProviderFailure, computeRetryDelayMs, getMaxAttemptsForFailure, parseRetryAfterMs } from '../../shared/retry-policy.js';
import { ProviderRequestError, sleep } from './shared.js';

// Direct providers only: never use SDK gateway or model-string resolution.
export function sdkModel(config, fetch = (...args) => globalThis.fetch(...args)) {
  const protocol = config.protocol || 'openai-chat';
  const platform = config.platform || 'custom';
  const suffix = protocol === 'openai-chat' ? /\/chat\/completions$/iu : protocol === 'openai-responses' ? /\/responses$/iu : protocol === 'anthropic-messages' ? /\/messages$/iu : /\/models\/[^/]+:generateContent$/iu;
  const completeEndpoint = suffix.test(String(config.apiBaseUrl || "")) ? String(config.apiBaseUrl) : "";
  const baseURL = String(config.apiBaseUrl || '').replace(suffix, '').replace(/\/+$/u, '');
  // Passing fetch explicitly prevents environment credentials or a gateway being used.
  const options = { baseURL, apiKey: String(config.apiKey || ''), fetch: (url, init) => fetch(completeEndpoint || url, init) };
  const model = String(config.model || '').trim();
  if (!model || !baseURL) throw new ProviderRequestError('请配置模型与服务地址。', {code:'CONFIG'});
  if (protocol === 'anthropic-messages') return createAnthropic(options)(model);
  if (protocol === 'gemini-generate') return createGoogleGenerativeAI(options)(model.replace(/^models\//u,''));
  if (protocol === 'openai-responses') {
    if (platform === 'azure-v1') return createAzure({...options,useDeploymentBasedUrls:false}).responses(model);
    if (platform === 'xai') return createXai(options).responses(model);
    return createOpenAI(options).responses(model);
  }
  if (platform === 'azure-v1') return createAzure({...options,useDeploymentBasedUrls:false}).chat(model);
  if (platform === 'openai') return createOpenAI(options).chat(model);
  const factories = {deepseek:createDeepSeek,groq:createGroq,mistral:createMistral,dashscope:createAlibaba,moonshot:createMoonshotAI,openrouter:createOpenRouter};
  if (factories[platform]) { const provider=factories[platform](options); return provider.chat ? provider.chat(model) : provider(model); }
  return createOpenAICompatible({...options,name:platform,supportsStructuredOutputs:true,headers:config.apiKey ? undefined : {Authorization:undefined}}).chatModel(model);
}

export async function requestSdkCompletion({config = {}, url, apiKey, body = {}, providerLabel = 'Provider', requireApiKey = false, signal, retryPolicy = DEFAULT_RETRY_POLICY, timeoutMs, stream = false, onProgress, onTextDelta}) {
  config = { ...config, apiBaseUrl: config.apiBaseUrl || String(url || '').replace(/\/chat\/completions$/u,''), apiKey: config.apiKey ?? apiKey ?? '', model:config.model || body.model };
  if(signal?.aborted) throw new ProviderRequestError('翻译请求已取消。',{code:'CANCELLED'});
  if((requireApiKey || (config.connectionId && !config.allowEmptyApiKey)) && !config.apiKey) throw new ProviderRequestError('请先配置 API Key。',{code:'CONFIG'});
  let providerOptions;
  try { providerOptions = reasoningProviderOptions(config); } catch(cause) { throw new ProviderRequestError(cause.message,{code:'CONFIG'}); }
  let unaryResponse = null, useUnary = false, touch = () => {};
  const rawModel = sdkModel(config, async (...args) => {
    if (unaryResponse) { const response=unaryResponse;unaryResponse=null;return response; }
    const response=await globalThis.fetch(...args);
    if(stream && response.ok && response.headers.get('content-type')?.includes('application/json')) {
      unaryResponse=response;useUnary=true;
      throw new ProviderRequestError('Endpoint returned unary JSON.',{code:'SDK_UNARY_RESPONSE'});
    }
    if(stream && response.ok && response.body) return new Response(response.body.pipeThrough(new TransformStream({transform(chunk,controller){touch();controller.enqueue(chunk);}})),{status:response.status,headers:response.headers});
    return response;
  });
  // Preserve the existing business JSON retry/recovery rather than SDK output parsing.
  const model = body.response_format ? {
    specificationVersion: rawModel.specificationVersion, provider:rawModel.provider, modelId:rawModel.modelId, supportedUrls:rawModel.supportedUrls,
    doGenerate: opts => rawModel.doGenerate({...opts,responseFormat:{type:"json",...(body.response_format.json_schema ? {schema:body.response_format.json_schema.schema,name:body.response_format.json_schema.name}: {})}}),
    doStream: opts => rawModel.doStream({...opts,responseFormat:{type:"json",...(body.response_format.json_schema ? {schema:body.response_format.json_schema.schema,name:body.response_format.json_schema.name}: {})}})
  } : rawModel;
  let emitted = false;
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController(); let timedOut=false, timer;
    const resetTimer = () => {clearTimeout(timer);timer=setTimeout(()=>{timedOut=true;controller.abort();},Math.max(1000,timeoutMs ?? retryPolicy.requestTimeoutMs));};
    const abort = () => controller.abort();
    if(signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    touch=resetTimer;
    resetTimer();
    try {
      const settings = {model, ...((body.messages || []).some(m=>m.role === "system") ? {instructions:(body.messages || []).filter(m=>m.role === "system").map(m=>m.content).join("\n")} : {}), messages:(body.messages || []).filter(m=>m.role !== "system"), maxRetries:0, abortSignal:controller.signal, providerOptions,
        ...(Number.isSafeInteger(config.outputTokens) ? {maxOutputTokens:config.outputTokens}:{}),
        ...(Number.isFinite(config.temperature ?? body.temperature) ? {temperature:config.temperature ?? body.temperature}:{})};
      let result;
      if (stream) {
        const response = streamText({...settings,onError:()=>{}}); let text='', count=0;
        try { for await (const part of response.fullStream) {
          resetTimer();
          if(part.type === 'error') throw part.error;
          if(part.type === 'abort') throw new DOMException('Aborted','AbortError');
          if(part.type === 'text-delta') {
            emitted=true; text+=part.text; count++;
            try {onTextDelta?.(part.text);onProgress?.({type:'streaming',receivedChars:text.length,eventCount:count});} catch {}
          }
        }
        } catch(error) { if(!useUnary) throw error; }
        if(useUnary) result=await generateText(settings);
        else result={text,finishReason:await response.finishReason,rawFinishReason:await response.rawFinishReason,toolCalls:await response.toolCalls,warnings:await response.warnings,response:await response.response};
      } else result=await generateText(settings);
      if(signal?.aborted) throw new DOMException('Aborted','AbortError');
      if(timedOut) throw new DOMException('Timeout','AbortError');
      const warnings=result.warnings || [];
      if(warnings.some(w=>w.type !== 'deprecated')) throw new ProviderRequestError('模型或 SDK 不支持所选参数，请调整连接设置。',{code:'CONFIG'});
      const raw=result.response?.body;
      const refused = raw?.choices?.some(c=>c.message?.refusal || c.message?.tool_calls?.length) || raw?.output?.some(o=>o.type !== 'message' && o.type !== 'reasoning' || o.content?.some(c=>c.type==='refusal'));
      if(result.finishReason !== 'stop' || result.toolCalls?.length || !result.text?.trim() || refused || (raw?.status && raw.status !== 'completed')) {
        throw new ProviderRequestError(`${providerLabel} 未返回完整结果，请重试或调整模型输出上限。`,{code:'MALFORMED_RESPONSE'});
      }
      return {choices:[{message:{content:result.text},finish_reason:'stop'}]};
    } catch(cause) {
      let error;
      const status=Number(cause?.statusCode || cause?.status || 0);
      if(signal?.aborted) error=new ProviderRequestError('翻译请求已取消。',{code:'CANCELLED'});
      else if(timedOut) error=new ProviderRequestError(`${providerLabel} 请求超时。`,{code:'TIMEOUT'});
      else if(cause instanceof ProviderRequestError) error=cause;
      else if(/InvalidPrompt|UnsupportedFunctionality|InvalidArgument/u.test(cause?.name || '')) error=new ProviderRequestError('模型或 SDK 不支持所选参数。',{code:'CONFIG'});
      else if(status>=200 && status<300) error=new ProviderRequestError(`${providerLabel} 返回格式无效。`,{code:'MALFORMED_RESPONSE'});
      else if(status) error=new ProviderRequestError(`${providerLabel} API 请求失败（HTTP ${status}）：${safeDetail(cause.message)}`,{code:status===401||status===403?'AUTH':status===429?'RATE_LIMIT':'HTTP_ERROR',status,retryAfterMs:parseRetryAfterMs(cause.responseHeaders?.['retry-after'])});
      else error=new ProviderRequestError(`${providerLabel} 请求失败。`,{code:/Parse|InvalidResponse|NoOutput|TypeValidation|JSONParse/u.test(cause?.name || '')?'MALFORMED_RESPONSE':'NETWORK',cause});
      if(emitted || error.code==='MALFORMED_RESPONSE' || !classifyProviderFailure(error).retryable || attempt>=getMaxAttemptsForFailure(error,retryPolicy)) throw error;
      await sleep(computeRetryDelayMs({attempt,retryAfterMs:error.retryAfterMs,baseDelayMs:retryPolicy.baseDelayMs,maxDelayMs:retryPolicy.maxDelayMs}),signal);
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
}
function safeDetail(value) {
  // Only retain the explicit unsupported-feature signal needed for local fallback.
  return /(?:stream|streaming).*(?:unsupported|not supported)|(?:unsupported|not supported).*(?:stream|streaming)/iu.test(value || '') ? 'streaming is not supported' : /response_format/iu.test(value || '') ? 'response_format is not supported' : '请检查服务与模型配置。';
}
