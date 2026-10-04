// @vitest-environment jsdom
import { StrictMode, useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GeneralSection } from "../../src/options/CommonSections";
import { UiLocaleSection } from "../../src/options/UiLocaleSection";
import { createLegacyIslandLifecycle } from "../../src/options/legacy-islands";
import type { OptionsConfig } from "../../src/options/client";

const config: OptionsConfig = { provider: "deepseek", apiKey: "", model: "deepseek-flash", prompt: "Translate", targetLanguage: "Chinese", appearance: "standard", cacheMaxMB: 200, openAICompatible: { baseUrl: "", apiKey: "", model: "", streaming: false }, youtubeSubtitleMode: "bilingual", youtubeSubtitleSize: "standard", selectionExplanationDepth: "auto" };
let get: ReturnType<typeof vi.fn>, set: ReturnType<typeof vi.fn>;
beforeEach(() => {
  get = vi.fn(async () => ({ uiLocale: "auto" })); set = vi.fn(async () => {});
  vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "en" }, storage: { local: { get, set }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("general React controls keep values controlled without writing from render", async () => {
  const update = vi.fn(); render(<GeneralSection config={config} disabled={false} update={update} />);
  expect(set).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText("默认目标语言")); await userEvent.type(screen.getByLabelText("默认目标语言"), "Japanese");
  expect(update).toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
});

test("UI locale StrictMode deduplicates its initial read and writes only after interaction", async () => {
  render(<StrictMode><UiLocaleSection /></StrictMode>);
  const select = await screen.findByLabelText("Interface language");
  expect(get).toHaveBeenCalledTimes(1); expect(set).not.toHaveBeenCalled();
  await userEvent.selectOptions(select, "zh_CN");
  await waitFor(() => expect(set).toHaveBeenCalledWith({ uiLocale: "zh_CN" }));
});

test("legacy island lifecycle starts one owner across StrictMode cleanup and exposes explicit disposal", async () => {
  const start = vi.fn(async () => {}), dispose = vi.fn();
  const lifecycle = createLegacyIslandLifecycle(start, dispose);
  function Island() { useEffect(() => lifecycle.mount(), []); return <div data-testid="island" />; }
  const view = render(<StrictMode><Island /></StrictMode>);
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(lifecycle.state()).toEqual({ references: 1, started: true });
  view.unmount(); expect(lifecycle.state().references).toBe(0);
  lifecycle.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
});
