// @vitest-environment jsdom
import { useState } from "react";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StyledSelect } from "../../src/options/StyledSelect";

const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
afterAll(() => {
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("settings menu changes the controlled draft, saves its value and respects disabled options", async () => {
  const save = vi.fn();
  function Settings() {
    const [value, setValue] = useState("bilingual");
    return <><label htmlFor="mode">Subtitle mode</label><p id="mode-help">Saved after Apply</p>
      <StyledSelect id="mode" value={value} aria-describedby="mode-help" onChange={event => setValue(event.target.value)}>
        <option value="bilingual">Bilingual</option><option value="translated">Translation only</option><option value="off" disabled>Off</option>
      </StyledSelect><button onClick={() => save(value)}>Apply</button></>;
  }
  render(<Settings />);
  const trigger = screen.getByRole("combobox", { name: "Subtitle mode" });
  expect(trigger.getAttribute("aria-describedby")).toBe("mode-help");
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(trigger);
  expect(screen.getByRole("option", { name: "Off" }).getAttribute("aria-disabled")).toBe("true");
  await userEvent.click(screen.getByRole("option", { name: "Translation only" }));
  expect(trigger.textContent).toBe("Translation only");
  expect(screen.queryByRole("listbox")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(save).toHaveBeenCalledWith("translated");
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}{Home}{Enter}");
  expect(trigger.textContent).toBe("Bilingual");
});

test("settings menu reflects new options and cannot change a locked setting", async () => {
  const change = vi.fn();
  const view = (disabled: boolean) => <StyledSelect id="service" aria-label="AI service" disabled={disabled} value="new" onChange={change}>
    <option value="new">New service</option><option value="other">Other service</option>
  </StyledSelect>;
  const { rerender } = render(<StyledSelect id="service" aria-label="AI service" disabled value="" onChange={change}><option value="">Loading</option></StyledSelect>);
  rerender(view(false));
  const trigger = screen.getByRole("combobox", { name: "AI service" });
  expect(trigger.textContent).toBe("New service");
  await userEvent.click(trigger);
  await userEvent.keyboard("{End}{Escape}");
  expect(change).not.toHaveBeenCalled();
  rerender(view(true));
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(change).not.toHaveBeenCalled();
});
