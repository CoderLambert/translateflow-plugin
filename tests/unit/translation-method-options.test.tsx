// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { createI18n } from "../../src/i18n/index.js";
import { LocaleProvider } from "../../src/options/LocaleContext";
import { MachineTranslationSection } from "../../src/options/MachineTranslationSection";
import { initialMachineSettings } from "../../src/options/machine-translation-client";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test("Options edits and disclosures remain local until the scoped save, and reload restores automatic selection", async () => {
  let config = initialMachineSettings();
  const preferences = { version: 1, textMethod: "free-online", wordMethod: "free-online" };
  const send = vi.fn(async (m: { type: string; config?: typeof config }) => {
    if (m.type === "TRANSLATION_PREFERENCES_SAVE") config = { ...m.config!, method: "free-online" };
    return { ok: true, preferences, globalConsent: false, consent: false, availability: { ai: false, browser: false }, config, selected: config, targetLanguage: "Simplified Chinese", errorCode: "", siteOverride: false,
      health: [{ providerId: "mt-microsoft-web", until: Date.now() + 20000 }] };
  });
  const grant = vi.fn(async () => true);
  vi.stubGlobal("chrome", { runtime: { sendMessage: send }, permissions: { request: grant } });
  const node = <LocaleProvider value={createI18n({ uiLocale: "zh_CN" })}><MachineTranslationSection /></LocaleProvider>;
  const view = render(node);
  await userEvent.click((await screen.findByRole("group", { name: "句段与全文翻译方式" })).querySelector<HTMLInputElement>('input[value="free-online"]')!);
  expect(screen.getByRole("radio", { name: "自动选择（推荐）" }).getAttribute("checked")).not.toBeNull();
  expect(screen.queryByText("服务状态与恢复")).toBeNull();
  await userEvent.click(screen.getByText("手动选择服务"));
  await userEvent.selectOptions(screen.getByLabelText("翻译服务"), "mt-tencent-transmart");
  await userEvent.click(screen.getByText("手动选择服务 · 腾讯翻译"));
  expect(screen.getByText("手动选择服务 · 腾讯翻译")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "恢复自动选择" }));
  await userEvent.click(screen.getByText("更多选项"));
  expect(send.mock.calls.every(([m]) => m.type === "TRANSLATION_PREFERENCES_GET")).toBe(true); expect(grant).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "保存翻译偏好" }));
  await screen.findByText("翻译偏好已保存。");
  expect(config).toMatchObject({ version: 2, routing: "auto", method: "free-online" });
  expect(send.mock.calls.some(([m]) => m.type === "MACHINE_TRANSLATION_TEST")).toBe(false);
  view.unmount(); render(node);
  await waitFor(() => expect(screen.getByRole("group", { name: "句段与全文翻译方式" }).querySelector<HTMLInputElement>('input[value="free-online"]')!.checked).toBe(true));
  expect(screen.queryByText("待应用")).toBeNull();
});
