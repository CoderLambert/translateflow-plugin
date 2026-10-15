// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GeneralSection } from "../../src/options/CommonSections";
import { ChatGPTPlanSection, chatGPTSignInActionDisabled } from "../../src/options/ChatGPTPlanSection";
import { GlossarySection } from "../../src/options/GlossarySection";
import { ProviderConnectionsSection } from "../../src/options/ProviderConnectionsSection";
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

test("provider connection test feedback stays visible in the tested card", async () => {
  let finish: ((value: string) => void) | undefined;
  const testProviderConnection = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
  const connection = { id: "local", revision: 1, name: "LM Studio HY-MT2", platform: "local", protocol: "openai-chat",
    baseUrl: "http://localhost:1234/v1", credentialId: "local", defaultModel: "hy-mt2-7b", hasApiKey: false,
    settings: { streaming: true, outputTokens: 4096, temperature: null, reasoning: "", allowEmptyApiKey: true, allowInsecureHttp: true } };
  render(zhNode(<ProviderConnectionsSection client={{ testProviderConnection, saveProviderConnection: vi.fn(),
    deleteProviderConnection: vi.fn(), setDefaultService: vi.fn() } as any} state={{ version: 1,
    defaultService: { kind: "api-key", connectionId: "local" }, connections: [connection] } as any}
    loading={false} error="" disabled={false} reload={vi.fn()} setStatus={vi.fn()} />));

  await userEvent.click(screen.getByRole("button", { name: "测试" }));
  expect(screen.getByRole("status").textContent).toContain("正在测试 LM Studio HY-MT2");
  finish?.("OK");
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("模型返回：OK"));
});

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
  await userEvent.click(await screen.findByRole("button", { name: "检查状态并加载模型" }));
  await screen.findByText("已连接 · 安全存储：fixture-store");
  expect(screen.getByRole("option", { name: /Fixture model · fixture-model/ })).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("模型"), "fixture-model");
  expect(update).toHaveBeenCalledWith({ chatgptPlanModel: "fixture-model" });

  await userEvent.click(screen.getByRole("button", { name: "连接 ChatGPT 账号" }));
  expect(chatGPTPlanAction).not.toHaveBeenCalledWith("connect");
});

test("ChatGPT settings explain when Native Messaging permission is unavailable", async () => {
  const chatGPTPlanAction = vi.fn(async () => { throw Object.assign(new Error("permission"), { code: "NATIVE_MESSAGING_PERMISSION" }); });
  render(zhNode(<ChatGPTPlanSection config={config} disabled={false} update={vi.fn()} client={{ chatGPTPlanAction,
    hasChatGPTPlanPermission: vi.fn(async () => true), requestChatGPTPlanPermission: vi.fn(async () => true) } as any} />));
  await userEvent.click(await screen.findByRole("button", { name: "检查状态并加载模型" }));
  expect(await screen.findByText(/Native Messaging 权限不可用/u)).toBeTruthy();
  expect(screen.getByRole("button", { name: "启用本地连接" })).toBeTruthy();
});

test("ChatGPT settings request optional local-app access only from the enable button", async () => {
  const chatGPTPlanAction = vi.fn();
  const requestChatGPTPlanPermission = vi.fn(async () => false);
  render(zhNode(<ChatGPTPlanSection config={config} disabled={false} update={vi.fn()} client={{
    chatGPTPlanAction,
    hasChatGPTPlanPermission: vi.fn(async () => false),
    requestChatGPTPlanPermission
  } as any} />));
  const enable = await screen.findByRole("button", { name: "启用本地连接" });
  expect(chatGPTPlanAction).not.toHaveBeenCalled();
  await userEvent.click(enable);
  expect(requestChatGPTPlanPermission).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/未授予本地应用连接权限/u)).toBeTruthy();
  expect(chatGPTPlanAction).not.toHaveBeenCalled();
});

test("ChatGPT settings link host installation and update failures to the maintained release page", async () => {
  const chatGPTPlanAction = vi.fn(async () => { throw Object.assign(new Error("missing"), { code: "NATIVE_HOST_UNAVAILABLE" }); });
  render(zhNode(<ChatGPTPlanSection config={config} disabled={false} update={vi.fn()} client={{
    chatGPTPlanAction, hasChatGPTPlanPermission: vi.fn(async () => true)
  } as any} />));
  await userEvent.click(await screen.findByRole("button", { name: "检查状态并加载模型" }));
  const download = await screen.findByRole("link", { name: "下载 TranslateFlow 本地组件" });
  expect(download.getAttribute("href")).toBe("https://github.com/CoderLambert/translateflow-plugin/releases/latest");
  expect(screen.queryByRole("button", { name: "连接 ChatGPT 账号" })).toBeNull();
  expect(screen.getByRole("button", { name: "已经安装 · 重新检测" })).toBeTruthy();
});

test("ChatGPT settings restart the local component and reload models from the fresh connection", async () => {
  const chatGPTPlanAction = vi.fn(async (action: string) => {
    if (action === "restart") return { restarted: true, status: { connected: true, canInfer: true, storage: "fixture-store", accounts: [] } };
    if (action === "models") return { models: [{ slug: "fixture-model", displayName: "Fixture model" }] };
    throw new Error(`Unexpected action: ${action}`);
  });
  render(zhNode(<ChatGPTPlanSection config={config} disabled={false} update={vi.fn()} client={{ chatGPTPlanAction } as any} />));
  await userEvent.click(screen.getByRole("button", { name: "重启本地组件" }));
  expect(await screen.findByText("本地组件已重启 · 安全存储：fixture-store")).toBeTruthy();
  expect(screen.getByRole("option", { name: /Fixture model · fixture-model/u })).toBeTruthy();
  expect(chatGPTPlanAction.mock.calls.map(([action]) => action)).toEqual(["restart", "models"]);
});

test("ChatGPT sign-in keeps an explicit retry action while authorization is pending", () => {
  expect(chatGPTSignInActionDisabled(false, true, true)).toBe(false);
  expect(chatGPTSignInActionDisabled(false, true, false)).toBe(true);
  expect(chatGPTSignInActionDisabled(true, true, true)).toBe(true);
  expect(zh.t("options.chatgptPlan.connecting")).toContain("重新连接");
  expect(zh.t("options.chatgptPlan.retryAddAccount")).toBe("重新添加账号");
  expect(zh.t("options.chatgptPlan.authTimeout")).toContain("授权未完成");
  expect(zh.t("options.chatgptPlan.credentialLocked")).toContain("解锁");
  expect(zh.t("options.chatgptPlan.accountMismatch")).toContain("另行添加");
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

test("ChatGPT settings show the active account and switch saved registrations explicitly", async () => {
  let active = "account-first";
  const accounts = [
    { id: "account-first", label: "first@example.invalid · 11111111", connected: true },
    { id: "account-second", label: "second@example.invalid · 22222222", connected: false }
  ];
  const chatGPTPlanAction = vi.fn(async (action: string, accountId?: string) => {
    if (action === "status") return { status: { connected: active === "account-first", canInfer: active === "account-first",
      storage: "fixture-store", activeAccountId: active, accounts } };
    if (action === "models") return { models: [{ slug: "fixture-model", displayName: "Fixture model" }] };
    if (action === "select") { active = String(accountId); return { selected: true, modelSelectionCleared: true }; }
    return {};
  });
  const update = vi.fn();
  render(zhNode(<ChatGPTPlanSection config={{ ...config, chatgptPlanModel: "fixture-model" }} disabled={false}
    update={update} client={{ chatGPTPlanAction } as any} />));
  await userEvent.click(screen.getByRole("button", { name: "检查状态并加载模型" }));
  const account = await screen.findByLabelText("当前 ChatGPT 账号");
  expect((account as HTMLSelectElement).value).toBe("account-first");
  await userEvent.selectOptions(account, "account-second");
  await waitFor(() => expect((account as HTMLSelectElement).value).toBe("account-second"));
  expect(chatGPTPlanAction).toHaveBeenCalledWith("select", "account-second");
  expect(update).toHaveBeenCalledWith({ chatgptPlanModel: "" });
  expect(screen.getByRole("option", { name: /second@example.invalid.*已退出/u })).toBeTruthy();
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

test("options client grants nativeMessaging only after an explicit request", async () => {
  const contains = vi.fn(async () => false), request = vi.fn(async () => true);
  const api = { i18n: { getUILanguage: () => "en" }, storage: { local: { get, set } },
    runtime: { getManifest: () => ({ version: "fixture", permissions: [], optional_permissions: ["nativeMessaging"] }), sendMessage: vi.fn() },
    permissions: { contains, request } };
  const client = optionsClient(api as any, zh);
  expect(await client.hasChatGPTPlanPermission()).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(await client.requestChatGPTPlanPermission()).toBe(true);
  expect(request).toHaveBeenCalledWith({ permissions: ["nativeMessaging"] });
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

test("selected-word browser definitions default on and source preference changes through the existing settings owner", async () => {
  const update = vi.fn();
  render(<LocaleProvider value={zh}><GeneralSection config={config} disabled={false} update={update} /></LocaleProvider>);
  const enabled = screen.getByLabelText("启用划词浏览器释义") as HTMLInputElement;
  expect(enabled.checked).toBe(true);
  await userEvent.click(enabled); expect(update).toHaveBeenCalledWith({ browserTranslationEnabled: false });
  await userEvent.selectOptions(screen.getByLabelText("划词释义源语言"), "fr");
  expect(update).toHaveBeenCalledWith({ browserSourceLanguage: "fr" });
});
