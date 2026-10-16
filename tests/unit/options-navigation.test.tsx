// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../src/options/App";
import type { OptionsClient, OptionsConfig } from "../../src/options/client";

// Dictionary import has separate component/browser coverage; keep its storage workers out of this navigation test.
vi.mock("../../src/options/DictionarySection", () => ({
  createDictionaryClient: () => ({}),
  DictionarySection: () => <section id="dictionary-packs"><h2>词典库</h2></section>
}));

const config: OptionsConfig = { browserTranslationEnabled: false, provider: "deepseek", apiKey: "", model: "deepseek-flash",
  chatgptPlanModel: "", prompt: "Translate", targetLanguage: "Simplified Chinese", appearance: "standard", cacheMaxMB: 200,
  openAICompatible: { baseUrl: "", apiKey: "", model: "", streaming: false }, youtubeSubtitleMode: "bilingual",
  youtubeSubtitleSize: "standard", selectionExplanationDepth: "auto" };
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  history.replaceState(null, "", "/options.html");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("chrome", {
    i18n: { getUILanguage: () => "zh-CN" },
    storage: { local: { get: vi.fn(async () => ({ uiLocale: "zh_CN" })), set: vi.fn(async () => {}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    runtime: { connect: () => ({ onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(), disconnect: vi.fn() }) }
  });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function client() {
  return { version: "fixture", loadConfig: vi.fn(async () => ({ ...config })), profiles: vi.fn(async () => []),
    cacheStats: vi.fn(async () => ({ pageCount: 0, segmentCount: 0, bytes: 0 })), behaviorSites: vi.fn(async () => []),
    providerConnections: vi.fn(async () => ({ version: 1, defaultService: null, connections: [] })),
    hasChatGPTPlanPermission: vi.fn(async () => false) } as unknown as OptionsClient;
}

test("only the selected category is accessible and Escape returns to its navigation link", async () => {
  render(<App client={client()} />);
  await screen.findByLabelText("默认目标语言");
  expect(location.hash).toBe("#general");
  const nav = screen.getByRole("navigation", { name: "设置分类" });
  for (const link of nav.querySelectorAll<HTMLAnchorElement>("a[data-settings-nav]")) {
    await userEvent.click(link);
    const visible = document.querySelectorAll(".settings-panel:not([hidden])");
    expect(visible).toHaveLength(1);
    expect(visible[0]?.getAttribute("id")).toBe(link.getAttribute("aria-controls"));
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(document.activeElement).toBe(visible[0]);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(link);
    expect(screen.queryByRole("button", { name: "测试当前默认 Provider" }) !== null).toBe(link.hash === "#provider");
  }
});

test("category switches retain both global input values and the Provider editor draft", async () => {
  const service = client(); render(<App client={service} />);
  const target = await screen.findByLabelText("默认目标语言");
  await userEvent.clear(target); await userEvent.type(target, "Japanese");
  await userEvent.click(screen.getByRole("link", { name: "Provider" }));
  const name = document.querySelector<HTMLInputElement>("#connectionName")!;
  await userEvent.clear(name); await userEvent.type(name, "Unsaved local connection");
  await userEvent.click(screen.getByRole("link", { name: "通用" }));
  expect((screen.getByLabelText("默认目标语言") as HTMLInputElement).value).toBe("Japanese");
  await userEvent.click(screen.getByRole("link", { name: "Provider" }));
  expect(name.value).toBe("Unsaved local connection");
  expect(document.querySelector("#connectionName")).toBe(name);
  expect(service.loadConfig).toHaveBeenCalledTimes(1);
});

test("deep links, external hash changes and invalid hashes select the correct single category", async () => {
  history.replaceState(null, "", "#auto-sites");
  render(<App client={client()} />);
  await waitFor(() => expect(document.activeElement?.id).toBe("settings-panel-auto-sites"));
  expect(document.querySelector("#settings-panel-general")?.hasAttribute("hidden")).toBe(true);
  act(() => { history.replaceState(null, "", "#cache"); window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await waitFor(() => expect(document.activeElement?.id).toBe("settings-panel-cache"));
  act(() => { history.replaceState(null, "", "#unknown"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await waitFor(() => expect(document.activeElement?.id).toBe("settings-panel-general"));
  expect(location.hash).toBe("#general");
});
