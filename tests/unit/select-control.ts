import userEvent from "@testing-library/user-event";
import { screen } from "@testing-library/react";

export function selectModel(control: Element): HTMLSelectElement {
  if (control instanceof HTMLSelectElement) return control;
  const select = control.closest(".styled-select, .popup-select")?.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) throw new Error("No select model for control");
  return select;
}
export async function chooseOption(control: HTMLElement, value: string) {
  const model = selectModel(control);
  if (control instanceof HTMLSelectElement && !control.hidden) return userEvent.selectOptions(control, value);
  const option = [...model.options].find(item => item.value === value);
  if (!option) throw new Error(`Missing option: ${value}`);
  const trigger = control.matches('[role="combobox"]') ? control : control.closest(".styled-select, .popup-select")?.querySelector<HTMLElement>('[role="combobox"]');
  if (!trigger) throw new Error("Missing select trigger");
  if (!Element.prototype.scrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value() {} });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("option", { name: option.label }));
}
