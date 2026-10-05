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
