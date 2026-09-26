import { test, expect } from "./support/extension-fixture.mjs";

test.describe("system dark mode token gate", () => {
  test.beforeEach(async ({ harness }) => {
    await harness.reset();
  });

  test("Popup dark mode keeps text, status and primary action contrast", async ({ harness }) => {
    const popup = harness.driver;
    await popup.emulateMedia({ colorScheme: "dark" });
    await popup.reload();

    await expect.poll(() => popup.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
    await expectContrast(await colorPair(popup.locator("body")), "Popup body");
    await expectContrast(await colorPair(popup.locator(".brand-mark")), "Popup brand mark");
    await expectContrast(await colorPair(popup.locator(".ready-badge")), "Popup ready badge");

    const primary = await primaryTokenPair(popup.locator("#translate"));
    expect(primary.colorScheme).toContain("dark");
    expectContrastValues(primary.foreground, primary.start, "Popup primary/start");
    expectContrastValues(primary.foreground, primary.end, "Popup primary/end");
  });

  test("Settings dark mode keeps navigation and primary action contrast", async ({ harness }) => {
    const page = await harness.context.newPage();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`chrome-extension://${harness.extensionId}/options.html`);

    await expect.poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
    await expectContrast(await colorPair(page.locator("body")), "Settings body");
    await expectContrast(await colorPair(page.locator(".nav-brand-mark")), "Settings brand mark");
    await expectContrast(
      await colorPair(page.locator('.settings-nav a[aria-current="page"]')),
      "Settings active navigation"
    );

    const primary = await primaryTokenPair(page.locator("#save"));
    expect(primary.colorScheme).toContain("dark");
    expectContrastValues(primary.foreground, primary.start, "Settings primary/start");
    expectContrastValues(primary.foreground, primary.end, "Settings primary/end");
    await page.close();
  });

  test("Quick Control dark mode uses the matching Shadow token contract", async ({ harness }) => {
    const page = await harness.open("/article");
    await page.emulateMedia({ colorScheme: "dark" });
    await harness.inject(page);
    await harness.sendContent(page, "TF_QUICK_CONTROL_SHOW");

    const trigger = page.getByRole("button", { name: /TranslateFlow Quick Control/ });
    await expect(trigger).toBeVisible();
    const primary = await shadowPrimaryTokenPair(trigger);
    expectContrastValues(primary.foreground, primary.start, "Quick Control trigger/start");
    expectContrastValues(primary.foreground, primary.end, "Quick Control trigger/end");

    await trigger.click();
    const brand = page.locator(".tf-quick-brand-mark");
    await expect(brand).toBeVisible();
    await expectContrast(await colorPair(brand), "Quick Control brand mark");
    await page.close();
  });
});

async function colorPair(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      foreground: style.color,
      background: style.backgroundColor
    };
  });
}

async function primaryTokenPair(locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(document.documentElement);
    return {
      colorScheme: style.colorScheme,
      foreground: style.getPropertyValue("--tf-primary-foreground").trim(),
      start: style.getPropertyValue("--tf-green-600").trim(),
      end: style.getPropertyValue("--tf-green-800").trim(),
      computedForeground: getComputedStyle(node).color
    };
  });
}

async function shadowPrimaryTokenPair(locator) {
  return locator.evaluate((node) => {
    const host = node.getRootNode().host;
    const style = getComputedStyle(host);
    return {
      foreground: style.getPropertyValue("--tf-primary-foreground").trim(),
      start: style.getPropertyValue("--tf-green-600").trim(),
      end: style.getPropertyValue("--tf-green-800").trim()
    };
  });
}

async function expectContrast(pair, label) {
  expectContrastValues(pair.foreground, pair.background, label);
}

function expectContrastValues(foreground, background, label) {
  const ratio = contrastRatio(foreground, background);
  expect(ratio, `${label}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
}

function contrastRatio(foreground, background) {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const fgLum = luminance(fg);
  const bgLum = luminance(bg);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseColor(value) {
  const input = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(input)) {
    return [1, 3, 5].map((offset) => Number.parseInt(input.slice(offset, offset + 2), 16));
  }

  const match = input.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!match) throw new Error(`Unsupported computed color: ${input}`);
  return match.slice(1, 4).map(Number);
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
