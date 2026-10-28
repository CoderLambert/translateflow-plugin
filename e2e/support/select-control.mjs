import { expect } from "@playwright/test";

// Exercise the visible UI while using the retained native model only to resolve option values.
export async function chooseSelect(control, selection) {
  const native = await control.evaluate(node => node.tagName === "SELECT");
  if (native && await control.isVisible()) return control.selectOption(selection);
  const model = native ? control : control.locator("..").locator("select").first();
  const label = await model.evaluate((node, wanted) => {
    const option = typeof wanted === "string" ? [...node.options].find(item => item.value === wanted) : node.options[wanted.index];
    if (!option) throw new Error("Missing requested select option");
    return option.label;
  }, selection);
  const trigger = native ? control.locator("..").getByRole("combobox") : control;
  await trigger.click();
  await control.page().getByRole("option", { name: label, exact: true }).click();
}
export async function expectSelectValue(control, value) {
  const native = await control.evaluate(node => node.tagName === "SELECT");
  await expect(native ? control : control.locator("..").locator("select").first()).toHaveValue(value);
}
