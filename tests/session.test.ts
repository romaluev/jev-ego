import { expect, test, vi } from "vitest";

import { Session } from "../src/session.js";
import * as model from "../src/model.js";
import { createTestAgent, decision } from "./helpers.js";

test("actManual rejects an unknown index and never touches the browser", async () => {
  const agent = createTestAgent();
  const session = new Session(agent.state.browser, agent);
  await expect(session.actManual("CLICK", "999")).rejects.toThrow(/Unknown target/);
  expect(agent.state.browser.act).not.toHaveBeenCalled();
});

test("actManual rejects the wrong operation for a target", async () => {
  const agent = createTestAgent();
  const session = new Session(agent.state.browser, agent);
  await expect(session.actManual("SELECT", "1")).rejects.toThrow(/not available/);
  expect(agent.state.browser.act).not.toHaveBeenCalled();
});

test("actManual records source=agent on history", async () => {
  const agent = createTestAgent();
  const session = new Session(agent.state.browser, agent);
  await session.actManual("CLICK", "2");
  expect(agent.state.history.at(-1)?.source).toBe("agent");
  expect(agent.state.history.at(-1)?.operation).toBe("CLICK");
  expect(agent.state.browser.act).toHaveBeenCalledTimes(1);
});

test("step without a text key returns a pending TYPE_TEXT decision", async () => {
  const agent = createTestAgent();
  agent.state.status = "ready";
  agent.state.decision = null;
  const session = new Session(agent.state.browser, agent);
  vi.stubEnv("TYPESAFE_API_KEY", "test");
  delete process.env.TEXT_MODEL_API_KEY;
  vi.spyOn(model, "choose").mockResolvedValue(decision("e1"));
  const result = await session.step();
  expect(result.pending).toBe(true);
  expect(result.decision?.operation).toBe("TYPE_TEXT");
  expect(agent.state.browser.act).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
