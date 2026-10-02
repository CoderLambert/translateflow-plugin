import { expect, test } from "vitest";
import { createI18n } from "../../src/i18n/index.js";

test("the typed native API uses the owned key and placeholder contract at runtime", () => {
  const i18n = createI18n({ uiLocale: "zh_CN", browserLocale: "en-US" });
  expect(i18n.t("learning.title")).toBe("学习中心");
  expect(i18n.t("learning.pageTitle", { title: "<script>{count}</script>" })).toBe("页面：<script>{count}</script>");
});
