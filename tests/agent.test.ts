import { expect, test, vi } from "vitest";

import { StalePage } from "../src/browser.js";
import * as text from "../src/text.js";
import { createTestAgent, decision } from "./helpers.js";

test("stale decision is consumed before any mutation", async () => {
  const agent = createTestAgent();
  vi.mocked(agent.state.browser.fresh).mockResolvedValue(false);
  await expect(agent.command("act", { fingerprint: agent.state.page.fingerprint })).rejects.toBeInstanceOf(StalePage);
  expect(agent.state.browser.act).not.toHaveBeenCalled();
  expect(agent.state.decision).toBeNull();
});

test("generated text is reused only for an identical retry context", async () => {
  const agent = createTestAgent();
  const helper = vi.spyOn(text, "fieldText").mockResolvedValue(["book", { model: "test", latency_ms: 10, usage: {} }]);
  vi.mocked(agent.state.browser.act)
    .mockRejectedValueOnce(new StalePage("Changed before input"))
    .mockResolvedValueOnce({ executed: "e1" });
  await expect(agent.command("act", { fingerprint: agent.state.page.fingerprint })).rejects.toBeInstanceOf(StalePage);
  agent.state.decision = decision();
  await agent.command("act", { fingerprint: agent.state.page.fingerprint });
  expect(helper).toHaveBeenCalledTimes(1);
  expect(agent.state.browser.act).toHaveBeenCalledTimes(2);
  expect(agent.pendingText).toBeNull();
});

test("changed field context does not reuse generated text", async () => {
  const agent = createTestAgent();
  const helper = vi.spyOn(text, "fieldText").mockResolvedValue(["book", { model: "test", latency_ms: 10, usage: {} }]);
  vi.mocked(agent.state.browser.act)
    .mockRejectedValueOnce(new StalePage("Changed before input"))
    .mockResolvedValueOnce({ executed: "e1" });
  await expect(agent.command("act", { fingerprint: agent.state.page.fingerprint })).rejects.toBeInstanceOf(StalePage);
  agent.state.page.text = "Different page context";
  agent.state.decision = decision();
  await agent.command("act", { fingerprint: agent.state.page.fingerprint });
  expect(helper).toHaveBeenCalledTimes(2);
});

test("loading waits do not trigger the no-progress stop", async () => {
  const agent = createTestAgent();
  for (let i = 0; i < 5; i += 1) {
    agent.state.decision = decision("wait");
    await agent.command("act", { fingerprint: agent.state.page.fingerprint });
  }
  expect(agent.state.history).toHaveLength(5);
  expect(agent.state.status).toBe("ready");
});

test("stale observation preserves the executed action", async () => {
  const agent = createTestAgent();
  agent.state.decision = decision("e3");
  vi.mocked(agent.state.browser.observe).mockRejectedValue(new StalePage("changed"));
  await expect(agent.command("act", { fingerprint: agent.state.page.fingerprint })).rejects.toBeInstanceOf(StalePage);
  expect(agent.state.history.at(-1)?.action).toBe("Go");
  expect(agent.state.browser.act).toHaveBeenCalledTimes(1);
});

test("navigation during prediction reobserves without action", async () => {
  const agent = createTestAgent();
  vi.mocked(agent.state.browser.fresh).mockRejectedValue(new StalePage("Document navigating"));
  await agent.command("tick");
  expect(agent.state.status).toBe("ready");
  expect(agent.state.decision).toBeNull();
  expect(agent.state.browser.act).not.toHaveBeenCalled();
});
