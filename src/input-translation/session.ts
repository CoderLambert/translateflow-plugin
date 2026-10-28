import { INPUT_TRANSLATION_SESSION as KEY, INPUT_TRANSLATION_LIMITS as LIMIT, INPUT_SCENES, validInputTranslation } from "../shared/input-translation.js";
export type Request = { scene?: string; text: string; previous: string; instruction: string; targetLanguage: string; service: string };
export type Turn = Request & { id: string; parentId: string; status: "working" | "complete" | "error"; result: string; error: string; label: string };
export type Session = { version: 1; scene: string; draft: string; requirement: string; adjustment: string; adjusting: string; targetLanguage: string; service: string; turns: Turn[] };
export const freshSession = (): Session => ({ version: 1, scene: "general", draft: "", requirement: "", adjustment: "", adjusting: "", targetLanguage: "", service: "", turns: [] });
export function restoreSession(raw: unknown): Session {
  if (!raw || typeof raw !== "object" || !("version" in raw) || raw.version !== 1) return freshSession();
  const data = raw as Partial<Session>, state = freshSession();
  state.scene = INPUT_SCENES.some(scene => scene.id === data.scene) ? data.scene! : "general";
  for (const key of ["draft", "requirement", "adjustment", "adjusting", "targetLanguage", "service"] as const) {
    const max = ["draft", "requirement", "adjustment"].includes(key) ? 100000 : 100;
    if (typeof data[key] === "string" && data[key].length <= max) state[key] = data[key];
  }
  state.turns = (Array.isArray(data.turns) ? data.turns : []).filter(turn => turn &&
    validInputTranslation({ ...turn, type: "start", version: 1 }) && typeof turn.id === "string" && turn.id.length <= 100 &&
    typeof turn.parentId === "string" && turn.parentId.length <= 100 && typeof turn.result === "string" && turn.result.length <= LIMIT.output &&
    typeof turn.label === "string" && turn.label.length <= 500 && typeof turn.error === "string" && turn.error.length <= 100 &&
    ["complete", "working", "error"].includes(turn.status)).slice(-LIMIT.turns).map(turn => ({ ...turn,
      ...(turn.status === "working" ? { status: "error" as const, error: "INTERRUPTED", result: "" } : {}) }));
  if (!state.turns.some(turn => turn.id === state.adjusting && turn.status === "complete")) state.adjusting = "";
  return state;
}
export async function loadSession() { return restoreSession((await chrome.storage.session.get(KEY))[KEY]); }
export function sessionWriter(onError: () => void) {
  let writes = Promise.resolve();
  return (state: Session) => {
    const snapshot = structuredClone(state);
    writes = writes.then(() => chrome.storage.session.set({ [KEY]: snapshot })).catch(onError);
    return writes;
  };
}
