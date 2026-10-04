// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../src/popup/App";
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

beforeEach(() => vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "en" }, storage: { local: { get: vi.fn(async () => ({ uiLocale: "en" })) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } }));
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
  expect(screen.getByRole("status").textContent).toContain("Cancelling translation");
  await act(async () => result.resolve({ ok: true, cancelled: true }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Translation cancelled"));
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
