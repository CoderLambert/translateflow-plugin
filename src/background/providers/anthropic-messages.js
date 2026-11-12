import { openAICompatibleProvider } from "./openai-compatible.js";
// Saved protocol stays explicit; all protocols share the same business validation.
export const anthropicMessagesProvider = Object.freeze({
  id: "anthropic-messages",
  ...Object.fromEntries(["translateBatch", "completeJson", "completeText", "test"].map(method => [method, (...args) => {
    const index = method === "test" ? 0 : 1;
    args[index] = { ...args[index], protocol: "anthropic-messages", streaming: false };
    return openAICompatibleProvider[method](...args);
  }]))
});
