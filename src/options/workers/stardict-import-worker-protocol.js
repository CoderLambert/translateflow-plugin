export const STARDICT_WORKER_MESSAGES = Object.freeze({
  START: "stardict-import:start",
  CANCEL: "stardict-import:cancel",
  PROGRESS: "stardict-import:progress",
  READY: "stardict-import:ready",
  ERROR: "stardict-import:error"
});

export function isStarDictWorkerTerminalMessage(
  message,
  requestId
) {
  if (
    !message ||
    message.requestId !== requestId
  ) {
    return false;
  }
  return (
    message.type === STARDICT_WORKER_MESSAGES.READY ||
    message.type === STARDICT_WORKER_MESSAGES.ERROR
  );
}
