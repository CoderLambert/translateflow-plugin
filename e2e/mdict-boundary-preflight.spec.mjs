import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";
import { readBoundaryFixture, withFirstBoundary, withMdxHeaderAttributes } from "../tests/helpers/mdx-boundary-fixture.mjs";
import { makeMdx } from "../tests/helpers/mdict-fixture.mjs";

test.beforeEach(async ({ harness }) => { await harness.reset(); });

test("independent uppercase MDX installs, reloads and queries through the rich product route", async ({ harness }) => {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: "synthetic-boundary.mdx", mimeType: "application/octet-stream",
    buffer: await readBoundaryFixture("single-c.mdx")
  });
  const summary = options.locator("#localDictionaryPreflightSummary");
  await expect(summary).toContainText("检查结果可用");
  await expect(summary).toContainText("安装方式MDX 富文本词典");
  await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });
  await options.reload();
  await expect(options.locator("#richMdictInstalledList")).toContainText("Synthetic MDX boundary fixture");
  const result = await options.evaluate(() => chrome.runtime.sendMessage({ type: "RICH_MDICT_LOOKUP", text: "C" }));
  expect(result.ok).toBe(true);
  expect(result.found).toBe(true);
  expect(JSON.stringify(result)).toContain("Uppercase sentinel");
  expect(harness.server.calls).toHaveLength(0);
});

test("preflight explains boundary and capability failures without exporting private key details", async ({ harness }) => {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  const bytes = await readBoundaryFixture("single-c.mdx");
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: "boundary.mdx", mimeType: "application/octet-stream",
    buffer: withFirstBoundary(bytes, "PRIVATE_KEY_SENTINEL", "PRIVATE_KEY_SENTINEL")
  });
  const summary = options.locator("#localDictionaryPreflightSummary");
  await expect(summary).toContainText("检查结果文件无效");
  await expect(summary).toContainText("失败阶段核对 MDX 词条块");
  await expect(summary).toContainText("词头索引与词条块的首尾不一致");
  await expect(summary).toContainText("无可用安装方式");
  await expect(summary).not.toContainText("PRIVATE_KEY_SENTINEL");
  await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
  await expect(options.locator("#richMdictInstalledList")).toContainText("尚未安装");
  await mkdir("test-results/mdx-boundary", { recursive: true });
  await options.locator("#localDictionaryImport").screenshot({ path: resolve("test-results/mdx-boundary/preflight-boundary.png") });

  await options.locator("#localDictionaryFiles").setInputFiles({
    name: "newer-engine.mdx", mimeType: "application/octet-stream",
    buffer: withMdxHeaderAttributes(bytes, { RequiredEngineVersion: "2.1" })
  });
  await expect(summary).toContainText("检查结果暂不支持");
  await expect(summary).toContainText("失败阶段读取 MDX 文件头");
  await expect(summary).toContainText("词典要求的 MDX 引擎版本与当前支持范围不匹配");
  await expect(summary).toContainText("未支持功能MDX 所需引擎版本");
  await expect(options.locator("#localDictionaryImportButton")).toBeDisabled();
  expect(harness.server.calls).toHaveLength(0);
});

test("uppercase plain MDX reaches structured installation only after semantic confirmation", async ({ harness }) => {
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator("#localDictionaryFiles").setInputFiles({
    name: "uppercase-plain.mdx", mimeType: "application/octet-stream",
    buffer: makeMdx([["C", "uppercase definition"]])
  });
  const summary = options.locator("#localDictionaryPreflightSummary");
  await expect(summary).toContainText("安装方式MDX 富文本词典");
  await options.locator("#localDictionarySemanticConfirmation").check();
  await expect(summary).toContainText("安装方式MDX 结构化纯文本词典");
  await expect(options.locator("#localDictionaryImportButton")).toBeEnabled();
  expect(harness.server.calls).toHaveLength(0);
});
