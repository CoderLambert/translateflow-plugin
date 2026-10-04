export type AssistantEvent =
  | { type: "started"; mode: "stream" | "unary" }
  | { type: "delta"; sequence: number; text: string }
  | { type: "interrupted"; code: string; partialChars: number }
  | { type: "complete"; text: string; turn: { completionStatus: "completed" }; saved: { state: "saved"; recordId: string; revision: number; artifactId: string; duplicate: boolean } };
export interface AssistantTarget {
  recordId: string; recordRevision: number; sourceSnapshotId: string; targetTurnId: string;
  historyAction: "follow-up" | "regenerate"; question?: string;
}
export function openAssistant(target: AssistantTarget, onEvent: (event: AssistantEvent) => void, onDisconnect: () => void) {
  const requestId = `history-${crypto.randomUUID()}`, port = chrome.runtime.connect({ name: "selection.assistant-stream" });
  let closed = false;
  const message = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const event = value as AssistantEvent & { protocolVersion?: number; requestId?: string };
    if (!closed && event.protocolVersion === 1 && event.requestId === requestId) onEvent(event);
  };
  const disconnected = () => { if (!closed) onDisconnect(); };
  port.onMessage.addListener(message); port.onDisconnect.addListener(disconnected);
  port.postMessage({ protocolVersion: 1, type: "start", requestId, ...target });
  return {
    stop() { if (!closed) port.postMessage({ type: "cancel", requestId }); },
    close() { if (closed) return; closed = true; port.onMessage.removeListener(message); port.onDisconnect.removeListener(disconnected); port.disconnect(); }
  };
}
