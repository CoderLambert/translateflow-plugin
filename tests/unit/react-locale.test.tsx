// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useLocale as usePopupLocale } from "../../src/popup/useLocale";
import { useLocale as useOptionsLocale } from "../../src/options/useLocale";
import { useLocale as useLearningLocale } from "../../src/learning-center/useLocale";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

for (const [surface, hook] of [
  ["Popup", usePopupLocale], ["Options", useOptionsLocale], ["Learning Center", useLearningLocale]
] as const) {
  test(`${surface} owns one reusable initial read and cleans up live locale updates`, async () => {
    const get = vi.fn(async () => ({ uiLocale: "en" }));
    const addListener = vi.fn(), removeListener = vi.fn();
    vi.stubGlobal("chrome", {
      i18n: { getUILanguage: () => "en-US" },
      storage: { local: { get, set: vi.fn(async () => {}) }, onChanged: { addListener, removeListener } }
    });
    const view = renderHook(() => hook(), { wrapper: StrictMode });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    const listener = addListener.mock.calls.at(-1)?.[0] as (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    act(() => listener({ uiLocale: { newValue: "zh_CN" } }, "local"));
    expect(view.result.current.i18n.locale).toBe("zh_CN");
    expect(view.result.current.i18n.t("common.retry")).toBe("重试");
    view.unmount();
    expect(removeListener).toHaveBeenCalledWith(listener);
  });
}

test("Options keeps the successful locale status when storage.onChanged precedes set resolution", async () => {
  const addListener = vi.fn();
  let changed: ((changes: Record<string, { newValue?: unknown }>, area: string) => void) | null = null;
  addListener.mockImplementation((listener: typeof changed) => { changed = listener; });
  const set = vi.fn(async (value: { uiLocale: string }) => {
    changed?.({ uiLocale: { newValue: value.uiLocale } }, "local");
  });
  vi.stubGlobal("chrome", {
    i18n: { getUILanguage: () => "en-US" },
    storage: { local: { get: vi.fn(async () => ({ uiLocale: "auto" })), set }, onChanged: { addListener, removeListener: vi.fn() } }
  });

  const view = renderHook(() => useOptionsLocale());
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  await act(async () => { await view.result.current.save("zh_CN"); });

  expect(view.result.current.locale).toBe("zh_CN");
  expect(view.result.current.status).toBe("settings.saved");
  expect(view.result.current.busy).toBe(false);
  expect(set).toHaveBeenCalledWith({ uiLocale: "zh_CN" });
  view.unmount();
});
