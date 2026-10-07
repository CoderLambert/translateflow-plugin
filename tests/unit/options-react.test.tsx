// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GeneralSection } from "../../src/options/CommonSections";
import { ChatGPTPlanSection } from "../../src/options/ChatGPTPlanSection";
import { GlossarySection } from "../../src/options/GlossarySection";
import { UiLocaleSection } from "../../src/options/UiLocaleSection";
import { LocaleProvider } from "../../src/options/LocaleContext";
import { useLocale } from "../../src/options/useLocale";
import { createI18n } from "../../src/i18n/index.js";
import type { OptionsConfig } from "../../src/options/client";
import { optionsClient } from "../../src/options/client";
import type { GlossaryClient, GlossaryRow } from "../../src/options/glossary-client";

const config: OptionsConfig = { provider: "deepseek", apiKey: "", model: "deepseek-flash", chatgptPlanModel: "", prompt: "Translate", targetLanguage: "Chinese", appearance: "standard", cacheMaxMB: 200, openAICompatible: { baseUrl: "", apiKey: "", model: "", streaming: false }, youtubeSubtitleMode: "bilingual", youtubeSubtitleSize: "standard", selectionExplanationDepth: "auto" };
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

test("ChatGPT settings load host models on demand and keep sign-in gated by a trusted click", async () => {
  const chatGPTPlanAction = vi.fn(async (action: "status" | "models" | "connect" | "logout") => {
    if (action === "status") return { status: { connected: true, canInfer: true, storage: "fixture-store" } };
    if (action === "models") return { models: [{ slug: "fixture-model", displayName: "Fixture model" }] };
    return {};
  });
  const update = vi.fn();
  const client = { chatGPTPlanAction } as any;
  render(zhNode(<ChatGPTPlanSection config={config} disabled={false} update={update} client={client} />));

  expect(chatGPTPlanAction).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "检查状态并加载模型" }));
  await screen.findByText("已连接 · 安全存储：fixture-store");
  expect(screen.getByRole("option", { name: /Fixture model · fixture-model/ })).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("模型"), "fixture-model");
  expect(update).toHaveBeenCalledWith({ chatgptPlanModel: "fixture-model" });

  await userEvent.click(screen.getByRole("button", { name: "连接 ChatGPT 账号" }));
  expect(chatGPTPlanAction).not.toHaveBeenCalledWith("connect");
});

test("ChatGPT settings explain when Native Messaging permission is unavailable", async () => {
  const chatGPTPlanAction = vi.fn(async () => { throw Object.assign(new Error("permission"), { code: "NATIVE_MESSAGING_PERMISSION" }); });
  render(zhNode(<ChatGPTPlanSection config={config} disabled={false} update={vi.fn()} client={{ chatGPTPlanAction } as any} />));
  await userEvent.click(screen.getByRole("button", { name: "检查状态并加载模型" }));
  expect(await screen.findByText(/Native Messaging 权限不可用/u)).toBeTruthy();
});

test("ChatGPT settings do not guess whether unavailable access means expired session or missing scope", async () => {
  const chatGPTPlanAction = vi.fn(async (action: "status" | "models" | "connect" | "logout") => {
    if (action === "status") return { status: { connected: true, canInfer: false, storage: "fixture-store" } };
    throw new Error("The model list should not be queried without usable access.");
  });
  render(zhNode(<ChatGPTPlanSection config={config} disabled={false} update={vi.fn()} client={{ chatGPTPlanAction } as any} />));
  await userEvent.click(screen.getByRole("button", { name: "检查状态并加载模型" }));
  expect(await screen.findByText(/订阅推理不可用。会话可能需要重新连接，或账号不具备所需/u)).toBeTruthy();
  expect(chatGPTPlanAction.mock.calls.map(([action]) => action)).toEqual(["status"]);
});

test("settings persist a separate ChatGPT model without requesting an API-origin permission", async () => {
  get.mockResolvedValue({ provider: "chatgpt-plan", apiKey: "", model: "deepseek-flash", chatgptPlanModel: "fixture-old",
    prompt: "Translate", targetLanguage: "Chinese", openAICompatible: {}, cacheMaxMB: 200 });
  const requestPermission = vi.fn();
  const api = { i18n: { getUILanguage: () => "en" }, storage: { local: { get, set } },
    runtime: { getManifest: () => ({ version: "fixture" }), sendMessage: vi.fn() }, permissions: { request: requestPermission } };
  const client = optionsClient(api as any, zh);
  const loaded = await client.loadConfig();
  expect(loaded.model).toBe("deepseek-flash");
  expect(loaded.chatgptPlanModel).toBe("fixture-old");
  await client.saveConfig({ ...loaded, provider: "chatgpt-plan", chatgptPlanModel: "fixture-new" }, true);

  expect(set).toHaveBeenCalledWith(expect.objectContaining({ provider: "chatgpt-plan", model: "deepseek-flash", chatgptPlanModel: "fixture-new" }));
  expect(requestPermission).not.toHaveBeenCalled();
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
