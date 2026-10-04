// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GeneralSection, SelectionSection } from "../../src/options/CommonSections";
import { GlossarySection } from "../../src/options/GlossarySection";
import { UiLocaleSection } from "../../src/options/UiLocaleSection";
import { LocaleProvider } from "../../src/options/LocaleContext";
import { useLocale } from "../../src/options/useLocale";
import { createI18n } from "../../src/i18n/index.js";
import type { OptionsConfig } from "../../src/options/client";
import type { GlossaryClient, GlossaryRow } from "../../src/options/glossary-client";

const config: OptionsConfig = { provider: "deepseek", apiKey: "", model: "deepseek-flash", prompt: "Translate", targetLanguage: "Chinese", appearance: "standard", cacheMaxMB: 200, openAICompatible: { baseUrl: "", apiKey: "", model: "", streaming: false }, youtubeSubtitleMode: "bilingual", youtubeSubtitleSize: "standard", selectionExplanationDepth: "auto" };
let get: ReturnType<typeof vi.fn>, set: ReturnType<typeof vi.fn>;
beforeEach(() => {
  get = vi.fn(async () => ({ uiLocale: "auto" })); set = vi.fn(async () => {});
  vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "en" }, storage: { local: { get, set }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const zh = createI18n({ uiLocale: "zh_CN" });
function LocaleControl() { const locale = useLocale(); return <UiLocaleSection {...locale} />; }
function zhNode(node: React.ReactNode) { return <LocaleProvider value={zh}>{node}</LocaleProvider>; }

test("general React controls keep values controlled without writing from render", async () => {
  const update = vi.fn(); render(zhNode(<GeneralSection config={config} disabled={false} update={update} />));
  expect(set).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText("默认目标语言")); await userEvent.type(screen.getByLabelText("默认目标语言"), "Japanese");
  expect(update).toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});

test("selection depth help labels use the active catalog", () => {
  const update = vi.fn();
  render(zhNode(<SelectionSection config={config} disabled={false} update={update} />));
  expect(screen.getAllByText("Auto · 自动").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Concise · 精简").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Standard · 标准").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Professional · 专业").length).toBeGreaterThan(0);
});

test("UI locale StrictMode deduplicates its initial read and writes only after interaction", async () => {
  render(<StrictMode><LocaleControl /></StrictMode>);
  const select = await screen.findByLabelText("Interface language");
  expect(get).toHaveBeenCalledTimes(1); expect(set).not.toHaveBeenCalled();
  await userEvent.selectOptions(select, "zh_CN");
  await waitFor(() => expect(set).toHaveBeenCalledWith({ uiLocale: "zh_CN" }));
});

test("Glossary React controls cover save, scope, case, enable, edit and delete", async () => {
  const first: GlossaryRow = { scope: "global", origin: "", entry: { id: "term-1", source: "repository", target: "仓库", caseSensitive: false, enabled: true } };
  const rows = vi.fn(async () => [first]);
  const save = vi.fn(async () => [{ ...first, entry: { ...first.entry, target: "代码仓库", caseSensitive: true } }]);
  const setEnabled = vi.fn(async () => [{ ...first, entry: { ...first.entry, enabled: false } }]);
  const remove = vi.fn(async () => []);
  const client = { rows, save, setEnabled, remove } as GlossaryClient;
  const status = vi.fn();
  render(<StrictMode>{zhNode(<GlossarySection client={client} setStatus={status} />)}</StrictMode>);
  await screen.findByText(/repository → 仓库/u);
  await userEvent.click(screen.getByRole("button", { name: "编辑" }));
  const target = screen.getByLabelText("目标译法");
  await userEvent.clear(target); await userEvent.type(target, "代码仓库");
  await userEvent.click(screen.getByLabelText("区分大小写"));
  await userEvent.click(screen.getByRole("button", { name: "保存术语" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "term-1", target: "代码仓库", caseSensitive: true })));
  await userEvent.click(screen.getByRole("button", { name: "停用" }));
  await waitFor(() => expect(setEnabled).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ id: "term-1" }) }), false));
  await userEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => expect(remove).toHaveBeenCalled());
});
