import { describe, it, expect } from "vitest";
import { freshSession, restoreSession } from "../../src/input-translation/session";
const turn = { id: "one", parentId: "", text: "Original", previous: "", instruction: "", targetLanguage: "English", service: "", label: "Local", status: "working", error: "", result: "" };
describe("input translation session recovery", () => {
  it("restores a draft, marks in-flight work interrupted and never resumes a request", () => {
    const result = restoreSession({ ...freshSession(), draft: "next input", turns: [turn] });
    expect(result.draft).toBe("next input"); expect(result.turns[0]).toMatchObject({ status: "error", error: "INTERRUPTED", result: "" });
  });
  it("keeps an over-limit pasted draft so it can be edited after reopening", () => {
    expect(restoreSession({ ...freshSession(), draft: "x".repeat(7000) }).draft).toHaveLength(7000);
  });
  it("bounds history and drops corrupt records and stale adjustment references", () => {
    const result = restoreSession({ ...freshSession(), adjusting: "gone", turns: [...Array.from({ length: 25 }, (_, i) => ({ ...turn, id: String(i), status: "complete", result: "Done" })), { ...turn, text: 123 }] });
    expect(result.turns).toHaveLength(20); expect(result.turns[0]?.id).toBe("5"); expect(result.adjusting).toBe("");
  });
});
