// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../src/options/local-dictionary-client", () => ({ createLocalDictionaryClient: vi.fn() }));

import { LocalDictionaryImport } from "../../src/options/LocalDictionaryImport";
import { createLocalDictionaryClient } from "../../src/options/local-dictionary-client";
import { LocaleProvider } from "../../src/options/LocaleContext";
import { createI18n } from "../../src/i18n/index.js";

const report = {
  identity: { family: "mdict-rich", displayTitle: "React Fixture Dictionary", hints: [] },
  route: { importer: "rich-mdict", requiresSemanticConfirmation: false },
  compatibility: { status: "supported", capabilitiesPresent: ["mdx.engine.v2"], reasons: [], warnings: [], unsupportedCapabilities: [] },
  resources: { associatedMdd: [], missingCompanionHints: [], unassociatedFiles: [] },
  estimates: { sourceBytes: 8, entryCount: 1 }
};

beforeEach(() => { vi.mocked(createLocalDictionaryClient).mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const zh = createI18n({ uiLocale: "zh_CN" });
function subject() { return <LocaleProvider value={zh}><LocalDictionaryImport setStatus={vi.fn()} onChanged={vi.fn(async () => {})} /></LocaleProvider>; }

test("local dictionary React preflight renders safe text and enables the confirmed route", async () => {
  const service = makeService({ preflight: vi.fn(async () => report) });
  vi.mocked(createLocalDictionaryClient).mockReturnValue(service as never);
  render(subject());
  await userEvent.upload(document.querySelector<HTMLInputElement>("#localDictionaryFiles")!, new File(["fixture"], "fixture.mdx"));
  await screen.findByText("React Fixture Dictionary");
  expect((screen.getByRole("button", { name: "安装词典" }) as HTMLButtonElement).disabled).toBe(false);
  expect(document.querySelector("#localDictionaryPreflightSummary")?.innerHTML).not.toMatch(/script|img|innerhtml/iu);
  expect(service.preflight).toHaveBeenCalledTimes(1);
});

test("local dictionary React cancel aborts a pending preflight without importing", async () => {
  const preflight = vi.fn((_files: File[], _semantic: boolean, signal: AbortSignal) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  }));
  const service = makeService({ preflight });
  vi.mocked(createLocalDictionaryClient).mockReturnValue(service as never);
  render(subject());
  await userEvent.upload(document.querySelector<HTMLInputElement>("#localDictionaryFiles")!, new File(["fixture"], "fixture.mdx"));
  await waitFor(() => expect(preflight).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(document.querySelector("#localDictionaryImportProgress")?.textContent).toContain("检查已取消"));
  expect(service.importFiles).not.toHaveBeenCalled();
});

test("local dictionary StrictMode disposes every controller owner", async () => {
  const services = [makeService(), makeService()];
  vi.mocked(createLocalDictionaryClient).mockImplementation(() => services.shift() as never);
  const view = render(<StrictMode>{subject()}</StrictMode>);
  await waitFor(() => expect(createLocalDictionaryClient).toHaveBeenCalledTimes(2));
  expect((vi.mocked(createLocalDictionaryClient).mock.results[0]?.value as ReturnType<typeof makeService>).dispose).toHaveBeenCalledTimes(1);
  const active = vi.mocked(createLocalDictionaryClient).mock.results[1]?.value as ReturnType<typeof makeService>;
  view.unmount(); expect(active.dispose).toHaveBeenCalledTimes(1);
});

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    preflight: vi.fn(async () => report),
    installed: vi.fn(async () => ({ candidates: [], known: { rich: true, packs: true } })),
    importFiles: vi.fn(), retryMdd: vi.fn(), cancel: vi.fn(async () => ({ cancelled: true, phase: "preflight" })), dispose: vi.fn(),
    ...overrides
  };
}
