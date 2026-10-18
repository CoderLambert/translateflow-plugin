// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../src/options/local-dictionary-client", () => ({ createLocalDictionaryClient: vi.fn() }));

import { RichList } from "../../src/options/DictionaryViews";
import { DictionarySection } from "../../src/options/DictionarySection";
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

test("installed-state refresh disables import until confirmed and ignores an older failed response", async () => {
  const service = makeService();
  vi.mocked(createLocalDictionaryClient).mockReturnValue(service as never);
  render(subject());
  await userEvent.upload(document.querySelector<HTMLInputElement>("#localDictionaryFiles")!, new File(["fixture"], "fixture.mdx"));
  const button = screen.getByRole("button", { name: "安装词典" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));

  type Installed = Awaited<ReturnType<typeof service.installed>>;
  const older = deferred<Installed>();
  const newer = deferred<Installed>();
  service.installed.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
  await act(async () => { document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed")); });
  expect(button.disabled).toBe(true);
  await act(async () => { document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed")); });
  await act(async () => { newer.resolve({ candidates: [], known: { rich: true, packs: true } }); });
  expect(button.disabled).toBe(false);
  await act(async () => { older.resolve({ candidates: [], known: { rich: false, packs: true } }); });
  expect(button.disabled).toBe(false);

  service.installed.mockResolvedValueOnce({ candidates: [], known: { rich: false, packs: true } });
  await act(async () => { document.dispatchEvent(new CustomEvent("translateflow:dictionary-state-changed")); });
  expect(button.disabled).toBe(true);
  expect(document.querySelector("#localDictionaryPreflightSummary")?.textContent).toContain("安装已暂停");
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

test("a dictionary preference keeps the pending user choice and rolls back a rejected save", async () => {
  const save = deferred<void>();
  const updateRichPreferences = vi.fn(() => save.promise);
  const setStatus = vi.fn();
  const dictionary = { id: "rich-test", title: "Preference fixture", status: "ready", enabled: true, expandedByDefault: false };
  render(<LocaleProvider value={zh}><RichList client={{ updateRichPreferences } as never} dictionaries={[dictionary]} refresh={vi.fn()} setStatus={setStatus} /></LocaleProvider>);
  const expanded = screen.getByRole("checkbox", { name: "默认展开释义（首选自动展开）" }) as HTMLInputElement;
  await userEvent.click(expanded);
  expect(expanded.checked).toBe(true);
  expect(expanded.disabled).toBe(true);
  expect(updateRichPreferences).toHaveBeenCalledExactlyOnceWith("rich-test", { expandedByDefault: true });
  await act(async () => { save.reject(new Error("Synthetic preference write failure")); });
  expect(expanded.checked).toBe(false);
  expect(expanded.disabled).toBe(false);
  expect(setStatus).toHaveBeenCalledWith("Synthetic preference write failure", true);
});

test("six-file selection displays ignored scripts and keeps the rich import route enabled", async () => {
  const next = { ...report, resources: { ...report.resources, associatedMdd: [{ fileName: "fixture.mdd" }, { fileName: "fixture.1.mdd" }], associatedSidecars: [], ignoredFiles: [{ fileName: "fixture.js", size: 10, reason: "script_not_executed" }] } };
  const preflight = vi.fn(async (_files: File[]) => next);
  const service = makeService({ preflight });
  vi.mocked(createLocalDictionaryClient).mockReturnValue(service as never); render(subject());
  await userEvent.upload(document.querySelector<HTMLInputElement>("#localDictionaryFiles")!, ["mdx", "mdd", "1.mdd", "css", "png", "js"].map(ext => new File(["fixture"], `fixture.${ext}`)));
  await screen.findByText("脚本已忽略，不执行。");
  expect(preflight.mock.calls[0]?.[0]).toHaveLength(6);
  expect((screen.getByRole("button", { name: "安装词典" }) as HTMLButtonElement).disabled).toBe(false);
});


test("installed resource recovery remains visible with full-set selection instructions", () => {
  const dictionary = { id: "rich-test", title: "Recovery fixture", fileName: "Recovery.mdx", status: "ready", sourceSize: 100,
    resourceRecovery: { previousResourcesAvailable: true } };
  render(<LocaleProvider value={zh}><RichList client={{} as never} dictionaries={[dictionary]} refresh={async () => {}} setStatus={vi.fn()} /></LocaleProvider>);
  expect(screen.getByText("本次更新未完成，原附件仍可用。")).toBeTruthy();
  expect(screen.getByText("请重选全部要保留的附件；此操作会替换完整资源集合。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "为 Recovery fixture 添加或重新选择资源" }) as HTMLButtonElement).disabled).toBe(false);
  expect(document.querySelector('input[data-action="attach-mdd-resources"]')?.getAttribute("accept")).toContain(".css");
  expect(document.querySelector('input[data-action="attach-mdd-resources"]')?.getAttribute("accept")).toContain(".js");
});

test("dictionary library renders downloads, installed dictionaries and imports without a bundled group", async () => {
  const service = makeService();
  vi.mocked(createLocalDictionaryClient).mockReturnValue(service as never);
  const client = {
    load: vi.fn(async () => ({ packState: { packs: {} }, rich: [] })),
    sources: [], dispose: vi.fn()
  };
  const view = render(<LocaleProvider value={zh}><DictionarySection client={client as never} setStatus={vi.fn()} /></LocaleProvider>);
  await screen.findByRole("heading", { name: "精选上游与官方词典" });
  expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual([
    "精选上游与官方词典", "已安装", "本地导入"
  ]);
  expect(screen.queryByText("内置词典")).toBeNull();
  expect(screen.getByRole("link", { name: "精选上游与官方词典" }).getAttribute("href")).toBe("#dictionaryDownloadHeading");
  expect(screen.getByRole("link", { name: "本地导入" }).getAttribute("href")).toBe("#dictionaryImportHeading");
  const initialHash = location.hash;
  await userEvent.click(screen.getByRole("link", { name: "精选上游与官方词典" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "精选上游与官方词典" }));
  await userEvent.click(screen.getByRole("link", { name: "本地导入" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "本地导入" }));
  expect(location.hash).toBe(initialHash);
  expect(service.importFiles).not.toHaveBeenCalled();
  view.unmount();
  expect(client.dispose).toHaveBeenCalledTimes(1);
});
