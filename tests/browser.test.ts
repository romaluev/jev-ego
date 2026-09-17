import { expect, test, vi } from "vitest";

import { actWithCdp, fingerprint, observeWithCdp, StalePage } from "../src/browser.js";
import { page } from "./helpers.js";

test("observation is one atomic browser read", async () => {
  const current = page();
  const cdp = vi.fn().mockResolvedValue({ result: { value: current } });
  const actual = await observeWithCdp(cdp, { screenshot: false });
  expect(actual.actions).toEqual(current.actions);
  expect(cdp).toHaveBeenCalledTimes(1);
  expect(cdp.mock.calls[0]?.[0]).toBe("Runtime.evaluate");
});

test("executor rejects a stale page before browser input", async () => {
  const cdp = vi.fn().mockResolvedValue({ result: { value: { status: "stale" } } });
  await expect(actWithCdp(cdp, page().actions[0]!, "book")).rejects.toBeInstanceOf(StalePage);
  expect(cdp).toHaveBeenCalledTimes(1);
  expect(cdp.mock.calls[0]?.[0]).toBe("Runtime.evaluate");
});

test.each([{ exceptionDetails: {} }, { result: {} }])(
  "interrupted dropdown mutation cannot be retried as stale (%s)",
  async (response) => {
    const payload = "exceptionDetails" in response ? { exceptionDetails: { text: "Execution context destroyed" } } : response;
    const cdp = vi.fn().mockResolvedValue(payload);
    await expect(
      actWithCdp(cdp, { id: "e1", kind: "select", node: 1, value: "Design", label: "Category → Design" }),
    ).rejects.toThrow(/Dropdown execution/);
    expect(cdp).toHaveBeenCalledTimes(1);
  },
);

test("click and scroll mutate inside the guard evaluate", async () => {
  const cdp = vi.fn().mockResolvedValue({ result: { value: { status: "ok", x: 10, y: 20 } } });
  await expect(actWithCdp(cdp, { id: "e3", kind: "click", node: 20, label: "Go" })).resolves.toEqual({
    executed: "e3",
  });
  await expect(actWithCdp(cdp, { id: "scroll_down", kind: "scroll", label: "Scroll down", delta: 560 })).resolves.toEqual({
    executed: "scroll_down",
  });
  expect(cdp).toHaveBeenCalledTimes(2);
  expect(cdp.mock.calls.every((call) => call[0] === "Runtime.evaluate")).toBe(true);
});

test("TYPE_TEXT focuses in evaluate then inserts text", async () => {
  const cdp = vi.fn().mockResolvedValue({ result: { value: { status: "ok", x: 10, y: 20 } } });
  await expect(actWithCdp(cdp, { id: "e1", kind: "fill", node: 10, label: "Search" }, "Lisbon")).resolves.toEqual({
    executed: "e1",
  });
  expect(cdp.mock.calls.map((call) => call[0])).toEqual([
    "Runtime.evaluate",
    "Input.dispatchKeyEvent",
    "Input.dispatchKeyEvent",
    "Input.insertText",
  ]);
});

test("fingerprint tracks values and identity, not screenshots", () => {
  const current = page();
  const other = structuredClone(current);
  other.screenshot = "changed";
  expect(fingerprint(current)).toBe(fingerprint(other));
  const moved = other.actions[0];
  if (moved) {
    moved.node = 99;
  }
  expect(fingerprint(current)).not.toBe(fingerprint(other));
});
