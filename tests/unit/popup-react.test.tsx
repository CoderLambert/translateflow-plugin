// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../src/popup/App";
import { initialMachineSettings, type MachineState } from "../../src/options/machine-translation-client";
import type { PopupClient } from "../../src/popup/client";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

function clientDouble(overrides: Partial<PopupClient> = {}): PopupClient {
  const base = {
    appearances: [{ id: "standard", label: "Standard", description: "" }],
    context: vi.fn(async () => ({ hostname: "example.test", provider: "deepseek", model: "model", presetLabel: "Default" })),
    cacheStatus: vi.fn(async () => ({ count: 0, totalCount: 0 })),
    toggleStatus: vi.fn(async (kind: string) => ({ enabled: false, ...(kind === "quick" ? { hidden: false } : {}), origin: "https://example.test" })),
    appearance: vi.fn(async () => ({ available: true, selected: "", defaultId: "standard", title: "Standard" })),
    saveAppearance: vi.fn(async () => ({ available: true, selected: "", defaultId: "standard", title: "Standard" })),
    toggleSite: vi.fn(async () => "updated"), openOptions: vi.fn(async () => {}), openLearning: vi.fn(async () => {}),
    prepareTranslation: vi.fn(async () => ({ site: { tab: { id: 1, url: "https://example.test" }, origin: "https://example.test", match: "https://example.test/*" }, run: async () => ({ ok: true, count: 1 }) })),
    cancel: vi.fn(async () => ({})), taskStatus: vi.fn(async () => ({ task: { state: "translating", done: 0, total: 1 } })),
    action: vi.fn(async () => ({ ok: true })), applyPreset: vi.fn(async () => ({ before: {}, context: {} }))
  };
  return { ...base, ...overrides } as unknown as PopupClient;
}

let machineState: MachineState, grant: ReturnType<typeof vi.fn>, send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const config = initialMachineSettings();
  machineState = { preferences: { version: 1, textMethod: "free-online", wordMethod: "free-online" }, consent: true, globalConsent: true, availability: { ai: true, browser: false }, config, selected: config, siteOverride: false, errorCode: "", targetLanguage: "Simplified Chinese" };
  grant = vi.fn(async () => true);
  send = vi.fn(async (message: { type: string; config?: typeof config; inherit?: boolean; textMethod?: typeof config.method }) => {
    if (message.type === "TRANSLATION_PREFERENCES_SAVE") {
      machineState = { ...machineState, selected: message.inherit ? machineState.config : { ...message.config!, method: message.textMethod! }, siteOverride: !message.inherit };
    }
    return { ok: true, ...machineState };
  });
  vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "en" },
    tabs: { query: vi.fn(async () => [{ id: 1, url: "https://example.test/article" }]) }, permissions: { request: grant }, runtime: { sendMessage: send },
    storage: { local: { get: vi.fn(async () => ({ uiLocale: "en" })) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("StrictMode performs read-only startup and synthetic permission clicks cannot mutate site grants", async () => {
  const client = clientDouble();
  render(<StrictMode><App client={client} /></StrictMode>);
  await screen.findByText("example.test");
  expect(client.context).toHaveBeenCalled(); expect(client.toggleSite).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("switch", { name: "Enable automatic translation for this site" }));
  expect(client.toggleSite).not.toHaveBeenCalled();
});

test("translation exposes cancellation and reports the confirmed cancelled result", async () => {
  const result = deferred<Record<string, unknown>>();
  const cancel = vi.fn(async () => ({}));
  const client = clientDouble({ prepareTranslation: vi.fn(async () => ({ site: { tab: { id: 7, url: "https://example.test" }, origin: "https://example.test", match: "https://example.test/*" }, run: () => result.promise })), cancel } as Partial<PopupClient>);
  render(<App client={client} />); await screen.findByText("example.test");
  await userEvent.click(screen.getByRole("button", { name: "Translate current page" }));
  const cancelButton = await screen.findByRole("button", { name: "Cancel current translation" });
  await userEvent.click(cancelButton); expect(cancel).toHaveBeenCalledWith(7, expect.any(String));
  expect(screen.getByRole("status", { name: "Page translation" }).textContent).toContain("Cancelling translation");
  await act(async () => result.resolve({ ok: true, cancelled: true }));
  await waitFor(() => expect(screen.getByRole("status", { name: "Page translation" }).textContent).toContain("Translation cancelled"));
});

test.each([
  [{ ok: true, message: "Completed current translation" }, "Completed current translation"],
  [{ ok: false, error: "Recoverable current failure" }, "Recoverable current failure"],
  [{ ok: true, cancelled: true }, "Translation cancelled"],
  [{ ok: true, missing: 1, message: "One changed paragraph needs another attempt" }, "One changed paragraph needs another attempt"],
] as const)("late task polling cannot overwrite the settled result %j", async (response, expected) => {
  const result = deferred<Record<string, unknown>>();
  const stale = deferred<Awaited<ReturnType<PopupClient["taskStatus"]>>>();
  const cache = deferred<Awaited<ReturnType<PopupClient["cacheStatus"]>>>();
  const client = clientDouble({
    prepareTranslation: vi.fn(async () => ({ site: { tab: { id: 1, url: "https://example.test" }, origin: "https://example.test", match: "https://example.test/*" }, run: () => result.promise })),
    taskStatus: vi.fn(() => stale.promise),
    cacheStatus: vi.fn().mockResolvedValueOnce({ count: 0, totalCount: 0 }).mockImplementation(() => cache.promise),
  });
  render(<App client={client} />); await screen.findByText("example.test");
  await userEvent.click(screen.getByRole("button", { name: "Translate current page" }));
  await waitFor(() => expect(client.taskStatus).toHaveBeenCalledTimes(1));
  await act(async () => result.resolve(response));
  await screen.findByText(expected);
  await act(async () => stale.resolve({ task: { state: "translating", done: 0, total: 1 } }));
  expect(screen.getByRole("status", { name: "Page translation" }).textContent).toContain(expected);
  if ("missing" in response) expect(screen.getByRole("status", { name: "Page translation" }).classList.contains("error")).toBe(true);
  await act(async () => cache.resolve({ count: 1, totalCount: 1 }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Translate current page" }).hasAttribute("disabled")).toBe(false));
});

test("context retry retains its explanation while pending and recovers after repeated failure", async () => {
  const pending = deferred<Awaited<ReturnType<PopupClient["context"]>>>();
  const context = vi.fn().mockRejectedValueOnce(new Error("Protected page: open an HTTP or HTTPS page."))
    .mockRejectedValueOnce(new Error("Page is still unavailable."))
    .mockImplementation(() => pending.promise);
  render(<App client={clientDouble({ context })} />);
  const card = await screen.findByRole("alert", { name: "Page information unavailable" });
  expect(card.textContent).toContain("Protected page");
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Translation method" }), "ai");
  expect(screen.getByText("Pending application")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(card.textContent).toContain("Page is still unavailable."));
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(card.getAttribute("aria-busy")).toBe("true");
  expect(card.textContent).toContain("Page is still unavailable.");
  expect(screen.getByRole("button", { name: "Reading again…" }).hasAttribute("disabled")).toBe(true);
  expect(context).toHaveBeenCalledTimes(3);
  await act(async () => pending.resolve({ hostname: "recovered.test", provider: "deepseek", model: "model" }));
  await screen.findByText("recovered.test");
  expect(screen.getByText("Pending application")).toBeTruthy();
  expect(screen.queryByRole("alert", { name: "Page information unavailable" })).toBeNull();
});

test("page action failure stays recoverable and a retry can succeed", async () => {
  const action = vi.fn().mockResolvedValueOnce({ ok: false, error: "synthetic failure" }).mockResolvedValueOnce({ ok: true, hidden: true });
  const client = clientDouble({ action } as Partial<PopupClient>);
  render(<App client={client} />); await screen.findByText("example.test");
  const button = screen.getByRole("button", { name: "Show / hide translations" });
  await userEvent.click(button); await screen.findByText("synthetic failure");
  await userEvent.click(button); await screen.findByText("Translations are hidden.");
  expect(action).toHaveBeenCalledTimes(2);
});

async function chooseFree(provider?: string) {
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Translation method" }), "free-online");
  if (provider) {
    await userEvent.click(screen.getByText("Choose a service manually"));
    await userEvent.selectOptions(screen.getByLabelText("Translation service"), provider);
  }
  await userEvent.click(screen.getByRole("checkbox", { name: /Allow the text/ }));
}

test("the sole primary action saves a fixed draft before preparing translation", async () => {
  const client = clientDouble();
  const persisted: unknown[] = [];
  vi.mocked(client.prepareTranslation).mockImplementation(async () => {
    persisted.push(machineState.selected);
    return { site: { tab: { id: 1, url: "https://example.test" }, origin: "https://example.test", match: "https://example.test/*" }, run: async () => ({ ok: true }) };
  });
  render(<App client={client} />); await chooseFree("mt-tencent-transmart");
  expect(send.mock.calls.filter(([m]) => m.type === "TRANSLATION_PREFERENCES_SAVE")).toHaveLength(0);
  expect(client.prepareTranslation).not.toHaveBeenCalled();
  expect(screen.getByText("Pending application")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Apply and translate" }));
  await waitFor(() => expect(client.prepareTranslation).toHaveBeenCalledTimes(1));
  expect(persisted).toEqual([expect.objectContaining({ method: "free-online", routing: "fixed", providerId: "mt-tencent-transmart" })]);
  expect(screen.getByRole("button", { name: "Translate current page" })).toBeTruthy();
});

test.each(["denied", "save failure"])("%s leaves the draft pending and starts no translation", async failure => {
  const client = clientDouble(); render(<App client={client} />); await chooseFree();
  if (failure === "denied") grant.mockResolvedValue(false);
  else send.mockImplementation(async (message: { type: string }) => message.type === "TRANSLATION_PREFERENCES_SAVE" ? { ok: false, errorCode: "MT_CONFIG" } : { ok: true, ...machineState });
  await userEvent.click(screen.getByRole("button", { name: "Apply and translate" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Apply and translate" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByText("Pending application")).toBeTruthy(); expect(client.prepareTranslation).not.toHaveBeenCalled();
  expect(machineState.siteOverride).toBe(false);
  if (failure === "denied") expect(send.mock.calls.filter(([m]) => m.type === "TRANSLATION_PREFERENCES_SAVE")).toHaveLength(0);
});

test("closing discards an unsaved draft and disclosures do not change a saved fixed service", async () => {
  const fixed = { ...initialMachineSettings(), mode: "free-online" as const, routing: "fixed" as const, providerId: "mt-tencent-transmart" };
  machineState = { ...machineState, selected: fixed, siteOverride: true };
  const client = clientDouble(), view = render(<App client={client} />);
  const summary = await screen.findByText("Choose a service manually · Tencent Transmart");
  await userEvent.click(summary); await userEvent.click(summary);
  expect(screen.queryByText("Pending application")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Restore automatic selection" }));
  expect(screen.getByText("Pending application")).toBeTruthy();
  view.unmount(); render(<App client={client} />);
  await screen.findByText("Choose a service manually · Tencent Transmart");
  expect(screen.queryByText("Pending application")).toBeNull(); expect(grant).not.toHaveBeenCalled();
  expect(send.mock.calls.filter(([m]) => m.type === "TRANSLATION_PREFERENCES_SAVE")).toHaveLength(0);
});

test("following defaults is a draft until the primary action removes only the site override", async () => {
  machineState = { ...machineState, selected: { ...initialMachineSettings(), mode: "free-online", routing: "fixed" }, siteOverride: true };
  const client = clientDouble(); render(<App client={client} />);
  await userEvent.click(await screen.findByRole("button", { name: "Follow default settings" }));
  expect(machineState.siteOverride).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Apply and translate" }));
  await waitFor(() => expect(client.prepareTranslation).toHaveBeenCalledTimes(1));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "TRANSLATION_PREFERENCES_SAVE", inherit: true, scope: "site" }));
  expect(machineState.siteOverride).toBe(false); expect(grant).toHaveBeenCalledWith({ origins: expect.arrayContaining(["https://edge.microsoft.com/*"]) });
});

test("closing during a save prevents translation after the late response", async () => {
  const pending = deferred<object>(), client = clientDouble(), view = render(<App client={client} />);
  await chooseFree();
  send.mockImplementation((message: { type: string }) => message.type === "TRANSLATION_PREFERENCES_SAVE" ? pending.promise : Promise.resolve({ ok: true, ...machineState }));
  await userEvent.click(screen.getByRole("button", { name: "Apply and translate" }));
  expect(screen.getByRole("button", { name: "Applying…" }).hasAttribute("disabled")).toBe(true);
  expect(client.prepareTranslation).not.toHaveBeenCalled();
  view.unmount(); await act(async () => pending.resolve({ ok: true, ...machineState }));
  expect(client.prepareTranslation).not.toHaveBeenCalled();
});
