import { test, expect } from "./support/extension-fixture.mjs";
import { makeRichMdx } from "../tests/helpers/rich-mdict-fixture.mjs";
import { makeMdd } from "../tests/helpers/mdd-fixture.mjs";

// Generic synthetic structure. No real dictionary markup or private styles are embedded.
const record = (marker) => `<link rel="stylesheet" href="styles/state.css"><div class="entry"><input type="radio" id="choice-0" name="choices" class="choice choice-0" checked><input type="radio" id="choice-1" name="choices" class="choice choice-1"><div class="tabs"><label for="choice-0" class="tab">First</label><label for="choice-1" class="tab">Second</label></div><div class="panels"><p class="panel panel-0">${marker} FIRST PANEL</p><p class="panel panel-1">${marker} SECOND PANEL</p></div><a href="#fragment-target">Jump to final sentinel</a><label for="outside">Static orphan</label><input type="text" id="outside" name="outside"><script>window.__radioFixtureExecuted=true</script><img src="https://attacker.invalid/radio.png"><details><summary>Local disclosure</summary>DISCLOSURE BODY</details><p id="fragment-target">FINAL SENTINEL ${marker}</p></div>`;
const css = [
  '.choice{display:none}.tabs{display:flex;align-items:center;justify-content:flex-start;position:relative;width:max-content}',
  '.tab{padding:4px;border:1px solid #123456}.panel{display:none}',
  '#choice-0:checked ~ .panels > .panel-0{display:block}',
  '#choice-1:checked ~ .panels > .panel-1{display:block}',
  '.choice-0:checked ~ .tabs > .tab:first-child,.choice-1:checked ~ .tabs > .tab:last-child{background-color:#123456;color:white}',
  '.tab::before{content:"›"}.tab:focus{border-color:red}',
  '@media screen and (max-width:500px){.tabs{width:100%}}',
  ':host,.x:has(.y),[for="outside"]{position:fixed;background-image:url(https://attacker.invalid/style.png)}',
  '.tab::after{content:attr(data-secret)}'
].join('\n');

test("generic radio state CSS works through real MDD resources and stays isolated per record after restart", async ({ harness }) => {
  test.setTimeout(180_000);
  await harness.reset();
  const options = await harness.context.newPage();
  await options.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await options.locator("#localDictionaryFiles").setInputFiles({ name: "radio.mdx", mimeType: "application/octet-stream", buffer: makeRichMdx([
    ["radiostatefixture", record("ONE")], ["radiostatefixture", record("TWO")],
    ["radiostatefixture", record("THREE").replace('<label for="choice-1" class="tab">Second</label>', "") + '<p style="display:none">INLINE HIDDEN TAIL</p>']
  ], { title: "Synthetic Radio State" }) });
  await expect(options.locator("#localDictionaryPreflightSummary")).toContainText("Synthetic Radio State");
  await options.locator("#localDictionaryImportButton").click();
  await expect(options.locator("#localDictionaryImportProgress")).toContainText("完成", { timeout: 60_000 });
  const row = options.locator("#richMdictInstalledList [data-dictionary-id]").filter({ hasText: "Synthetic Radio State" });
  await row.getByRole("button", { name: /添加或替换 MDD 附件/u }).click();
  await row.locator('input[data-action="attach-mdd-resources"]').setInputFiles({ name: "radio.mdd", mimeType: "application/octet-stream", buffer: makeMdd([["styles/state.css", Buffer.from(css)]]) });
  await expect(options.locator("#status")).toContainText("本地资源已更新", { timeout: 60_000 });

  const external = [], errors = [];
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass) await harness.restartBrowser();
    const page = await harness.open("/selection");
    page.on("request", (request) => { if (/^https?:/iu.test(request.url()) && new URL(request.url()).origin !== harness.server.baseUrl) external.push(request.url()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 360, height: 760 });
    await page.evaluate(() => {
      window.__radioFixtureExecuted = false;
      const word = document.createElement("p"); word.id = "radio-word"; word.textContent = "radiostatefixture"; document.body.append(word);
    });
    await harness.inject(page);
    await page.locator("#radio-word").evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, view: window }));
    });
    await page.locator(".tf-selection-chip").click();
    const card = page.locator(".tf-selection-rich-record").filter({ hasText: "Synthetic Radio State" });
    await expect(card).toHaveAttribute("data-state", "success", { timeout: 30_000 });
    const viewers = card.locator(".tf-selection-rich-text .tf-rich-viewer");
    await expect(viewers).toHaveCount(3);
    const one = viewers.nth(0), two = viewers.nth(1), fallback = viewers.nth(2);
    await expect(fallback).toContainText("THREE FIRST PANEL"); await expect(fallback).toContainText("THREE SECOND PANEL");
    await expect(fallback).toContainText("INLINE HIDDEN TAIL");
    await expect(fallback.locator(".tf-rich-truncated")).toContainText(/交互暂不可用|Entry interactions/u);
    await expect(fallback.locator("input,label,[style]")).toHaveCount(0);
    await expect(one.locator(".panel-0")).toBeVisible(); await expect(one.locator(".panel-1")).toBeHidden();
    await expect(two.locator(".panel-0")).toBeVisible(); await expect(two.locator(".panel-1")).toBeHidden();
    for (const viewer of [one, two]) {
      await expect(viewer.locator("input[type=radio]")).toHaveCount(2);
      await expect(viewer.locator("label")).toHaveCount(2);
      await expect(viewer.locator('input:not([type=radio]),form,script,img[src^="https:"]')).toHaveCount(0);
    }
    const firstLabel = one.locator('label[for="choice-0"]'), secondLabel = one.locator('label[for="choice-1"]');
    await secondLabel.click();
    await expect(one.locator(".panel-0")).toBeHidden(); await expect(one.locator(".panel-1")).toBeVisible();
    await expect(secondLabel).toHaveAttribute("aria-checked", "true");
    await expect(two.locator(".panel-0")).toBeVisible(); await expect(two.locator(".panel-1")).toBeHidden();
    await secondLabel.focus(); await secondLabel.press("Home");
    await expect(firstLabel).toBeFocused(); await expect(one.locator(".panel-0")).toBeVisible();
    await firstLabel.press("End"); await expect(secondLabel).toBeFocused(); await expect(one.locator(".panel-1")).toBeVisible();
    await secondLabel.press("ArrowRight"); await expect(firstLabel).toBeFocused(); await expect(one.locator(".panel-0")).toBeVisible();
    await firstLabel.press("ArrowLeft"); await expect(secondLabel).toBeFocused();
    await firstLabel.focus(); await firstLabel.press("Space"); await expect(one.locator(".panel-0")).toBeVisible();
    await secondLabel.focus(); await secondLabel.press("Enter"); await expect(one.locator(".panel-1")).toBeVisible();
    await expect.poll(() => secondLabel.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(18, 52, 86)");
    expect(await firstLabel.evaluate((node) => getComputedStyle(node, "::before").content)).toBe('"›"');
    await one.locator("summary").click(); await expect(one).toContainText("DISCLOSURE BODY");
    await expect(one).toContainText("FINAL SENTINEL ONE"); await expect(two).toContainText("FINAL SENTINEL TWO");
    await one.locator('button[data-rich-fragment-target="fragment-target"]').click();
    expect(await one.evaluate((node) => node.querySelector('[data-rich-target-id="fragment-target"]') === node.getRootNode().activeElement)).toBe(true);
    expect(await two.locator("#choice-0").isChecked()).toBe(true);
    expect(await page.evaluate(() => window.__radioFixtureExecuted)).toBe(false);
    await page.keyboard.press("Escape"); await expect(page.locator(".tf-selection-panel")).toBeHidden();
  }
  expect(harness.server.calls).toHaveLength(0); expect(external).toEqual([]); expect(errors).toEqual([]);
});
