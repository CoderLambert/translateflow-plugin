import { requestSdkCompletion } from "./ai-sdk-transport.js";
export function requestChatCompletionsStream(options) {
  return requestSdkCompletion({ ...options, stream: true });
}

export function isUnsupportedStreamingError(error) {
  if (!error || error.code !== "HTTP_ERROR") return false;
  if (![400, 404, 405, 415, 422, 501].includes(Number(error.status || 0))) return false;
  return /(?:stream|streaming).*(?:unsupported|not supported|invalid|unknown|unrecognized)|(?:unsupported|not supported).*(?:stream|streaming)/i
    .test(String(error.message || ""));
}
