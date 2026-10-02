// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentControl } from "./fixtures/ConsentControl";

afterEach(cleanup);

test("explicit user interactions enable and pause the test-only control", async () => {
  const changed = vi.fn<(enabled: boolean) => void>();
  const user = userEvent.setup();
  render(<ConsentControl onChange={changed} />);
  expect(screen.getByRole("status").textContent).toBe("Recording paused");
  expect(changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Enable recording" }));
  expect(screen.getByRole("button", { name: "Pause recording" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("Recording enabled");
  await user.click(screen.getByRole("button", { name: "Pause recording" }));
  expect(screen.getByRole("status").textContent).toBe("Recording paused");
  expect(changed.mock.calls).toEqual([[true], [false]]);
});
