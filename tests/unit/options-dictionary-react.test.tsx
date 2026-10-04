// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("../../src/options/local-dictionary-client", () => ({ createLocalDictionaryClient: vi.fn() }));

import { LocalDictionaryImport } from "../../src/options/LocalDictionaryImport";
import { RichList } from "../../src/options/DictionaryViews";
import { getCatalogDictionaryRows, getCuratedMdxErrorDescriptor, getDictionaryHealthPresentation, getLocalRichDictionaryRows } from "../../src/options/dictionary-library-v2-presentation.js";
import { getCuratedMdxInstallPresentation } from "../../src/options/curated-dictionary-presentation.js";
import { createLocalDictionaryClient } from "../../src/options/local-dictionary-client";
import { LocaleProvider } from "../../src/options/LocaleContext";
import { createI18n } from "../../src/i18n/index.js";
import { renderLocalizedMessage } from "../../src/i18n/messages.js";

const report = {
  identity: { family: "mdict-rich", displayTitle: "React Fixture Dictionary", hints: [] },
  route: { importer: "rich-mdict", requiresSemanticConfirmation: false },
  compatibility: { status: "supported", capabilitiesPresent: ["mdx.engine.v2"], reasons: [], warnings: [], unsupportedCapabilities: [] },
  resources: { associatedMdd: [], missingCompanionHints: [], unassociatedFiles: [] },
  estimates: { sourceBytes: 8, entryCount: 1 }
};
const en = createI18n({ uiLocale: "en" });

beforeEach(() => { vi.mocked(createLocalDictionaryClient).mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const zh = createI18n({ uiLocale: "zh_CN" });
function subject(i18n = zh, setStatus = vi.fn()) { return <LocaleProvider value={i18n}><LocalDictionaryImport setStatus={setStatus} onChanged={vi.fn(async () => {})} /></LocaleProvider>; }

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

test("local preflight duplicate and compatibility copy updates language without changing file names or restarting import", async () => {
  const partial = {
    ...report,
    identity: { ...report.identity, family: "mdict-structured" },
    route: { importer: "structured-mdict", requiresSemanticConfirmation: true },
    compatibility: {
      status: "partial", capabilitiesPresent: ["mdx.engine.v2", "mdx.encoding.gbk"],
      reasons: [{ code: "mdx.structured_semantics_not_confirmed" }],
      warnings: [{ code: "mdx.structured_semantics_not_confirmed" }],
      unsupportedCapabilities: ["mdx.encoding.gbk"]
    }
  };
  let emitProgress: ((message: any) => void) | undefined;
  const service = makeService({
    preflight: vi.fn(async () => partial),
    installed: vi.fn(async () => ({ candidates: [{ name: "React Fixture Dictionary", version: "v1", sourceFiles: ["old.mdx"], sourceSize: 12 }], known: { rich: true, packs: true } })),
  });
  const setStatus = vi.fn();
  vi.mocked(createLocalDictionaryClient).mockImplementation(options => {
    emitProgress = options?.onProgress;
    return service as never;
  });
  const view = render(subject(zh, setStatus));
  await userEvent.upload(document.querySelector<HTMLInputElement>("#localDictionaryFiles")!, new File(["fixture"], "fixture.mdx"));
  await screen.findByText("检查结果");
  expect(document.querySelector(".local-dictionary-file-name")?.textContent).toContain("fixture.mdx");
  expect(document.querySelector<HTMLInputElement>("#localDictionaryImportButton")?.disabled).toBe(true);

  view.rerender(subject(en, setStatus));
  await screen.findByText("Check result");
  expect(document.querySelector(".local-dictionary-file-name")?.textContent).toContain("fixture.mdx");
  expect(screen.getByText(/may duplicate the installed “React Fixture Dictionary”/u)).toBeTruthy();
  expect(document.querySelector("#localDictionaryPreflightSummary")?.textContent).toContain("GBK encoding (unsupported)");
  expect(document.querySelector<HTMLInputElement>("#localDictionaryImportButton")?.disabled).toBe(true);

  await userEvent.click(document.querySelector<HTMLInputElement>("#localDictionarySemanticConfirmation")!);
  await userEvent.click(document.querySelector<HTMLInputElement>("#localDictionaryLimitationsConfirmation")!);
  await userEvent.click(document.querySelector<HTMLInputElement>("#localDictionaryDuplicateConfirmation")!);
  expect(document.querySelector<HTMLInputElement>("#localDictionaryImportButton")?.disabled).toBe(false);
  emitProgress?.({ key: "localImport.progress.worker" });
  await screen.findByText("Validating and converting dictionary");
  const preflightCalls = vi.mocked(service.preflight).mock.calls.length;
  expect(preflightCalls).toBeGreaterThan(0);

  view.rerender(subject(zh, setStatus));
  await screen.findByText("验证并转换词典");
  expect(service.preflight).toHaveBeenCalledTimes(preflightCalls);
  view.rerender(subject(en, setStatus));
  await screen.findByText("Validating and converting dictionary");
  expect(document.querySelector(".local-dictionary-file-name")?.textContent).toContain("fixture.mdx");
});

test("dictionary health and compatibility copy follows locale while source names and licensing stay literal", () => {
  const entry = {
    trustClass: "curated-upstream",
    identity: { publisher: "上游发布方原名" },
    language: { directionLabel: "English → 简体中文" },
    artifacts: [{ kind: "mdx", filename: "fixture.mdx" }],
    version: { sourceVersion: "v1" },
    compatibility: { status: "reviewed-partial", reviewedAt: "2026-10-01" },
    source: { licenseLabel: "原始许可说明 MIT / CC" },
    knownLimitations: [{ id: "no-mdd-resources", description: "原始兼容说明不改写" }]
  };
  const rowsForLocale = getCatalogDictionaryRows as unknown as (value: typeof entry, options: { i18n: typeof en }) => Array<{ label: string; value: string }>;
  const englishRows = rowsForLocale(entry, { i18n: en });
  expect(englishRows.find(row => row.label === "Source / trust")?.value).toBe("Curated upstream · not official");
  expect(englishRows.find(row => row.label === "Publisher")?.value).toBe("上游发布方原名");
  expect(englishRows.find(row => row.label === "License and terms of use")?.value).toBe("原始许可说明 MIT / CC");
  expect(rowsForLocale(entry, { i18n: zh }).find(row => row.label === "信任与来源")?.value).toBe("精选上游 · 非官方");
  expect(getDictionaryHealthPresentation("needs-reinstall", en).label).toBe("Repair needed");
  expect(getDictionaryHealthPresentation("needs-reinstall", zh).label).toBe("需要修复");
  expect(getLocalRichDictionaryRows({ id: "local-id", title: "用户词典原名", status: "ready", fileName: "private.mdx", entryCount: 2 }, 1024, en).rows.find(row => row.label === "Source / trust")?.value)
    .toBe("Local import · user supplied / unverified");
  expect(getCuratedMdxInstallPresentation({ id: "recipe", upstreamRevision: "v1" }, null, en).detail)
    .toContain("Downloads directly from the pinned upstream release");
  expect(getCuratedMdxInstallPresentation({ id: "recipe", upstreamRevision: "v1" }, null, zh).detail)
    .toContain("直接从已锁定的上游发行版本下载");
  const message = getCuratedMdxErrorDescriptor(Object.assign(new Error("internal raw detail"), { code: "RICH_MDICT_QUOTA" }));
  expect(renderLocalizedMessage(en, message)).toContain("Local storage is insufficient");
  expect(renderLocalizedMessage(zh, message)).toContain("本地空间不足");
  expect(renderLocalizedMessage(zh, message)).not.toContain("internal raw detail");
});

test("installed rich dictionary controls and accessibility labels update on an already mounted list", () => {
  const dictionary = { id: "local-dictionary", title: "原样词典名称", fileName: "fixture.mdx", status: "ready", preferred: false, enabled: true, expandedByDefault: false, entryCount: 1, installedBytes: 1024 };
  const client = { sources: [] } as never;
  const view = render(<LocaleProvider value={en}><RichList client={client} dictionaries={[dictionary]} refresh={async () => {}} setStatus={vi.fn()} /></LocaleProvider>);
  expect(screen.getByRole("button", { name: "Set as preferred: 原样词典名称" })).toBeTruthy();
  expect(screen.getByText("原样词典名称")).toBeTruthy();
  view.rerender(<LocaleProvider value={zh}><RichList client={client} dictionaries={[dictionary]} refresh={async () => {}} setStatus={vi.fn()} /></LocaleProvider>);
  expect(screen.getByRole("button", { name: "设为首选：原样词典名称" })).toBeTruthy();
  expect(screen.getByText("可用")).toBeTruthy();
  expect(screen.getByRole("button", { name: "为原样词典名称添加或替换 MDD 附件" })).toBeTruthy();
});

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    preflight: vi.fn(async () => report),
    installed: vi.fn(async () => ({ candidates: [], known: { rich: true, packs: true } })),
    importFiles: vi.fn(), retryMdd: vi.fn(), cancel: vi.fn(async () => ({ cancelled: true, phase: "preflight" })), dispose: vi.fn(),
    ...overrides
  };
}
