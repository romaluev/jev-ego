import { vi } from "vitest";

import { Agent } from "../src/agent.js";
import { fingerprint } from "../src/browser.js";
import type { BrowserLike, Decision, PageState } from "../src/types.js";

export function page(): PageState {
  const state: PageState = {
    url: "https://example.test/",
    title: "Search",
    text: "Search",
    scroll: { y: 0 },
    actions: [
      { id: "e1", kind: "fill", label: "Search", role: "textbox", value: "", node: 10 },
      { id: "e2", kind: "click", label: "Open Search", role: "textbox", value: "", node: 10 },
      { id: "e3", kind: "click", label: "Go", role: "button", value: "", node: 20 },
      { id: "wait", kind: "wait", label: "Wait" },
    ],
    fingerprint: "",
  };
  state.fingerprint = fingerprint(state);
  return state;
}

export function choice(ids: string[], selected: string) {
  return {
    choice: selected,
    confidence: 1.0,
    probabilities: Object.fromEntries(ids.map((id) => [id, Number(id === selected)])),
  };
}

export function decision(action = "e1"): Decision {
  return {
    choice: action,
    operation: "TYPE_TEXT",
    target: "1",
    confidence: 1.0,
    probabilities: { [action]: 1.0 },
    latency_ms: 10,
    usage: {},
  };
}

export function createTestAgent(): Agent {
  const current = page();
  const browser: BrowserLike = {
    fresh: vi.fn().mockResolvedValue(true),
    observe: vi.fn().mockResolvedValue(current),
    act: vi.fn().mockResolvedValue({ executed: "e1" }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const agent = new Agent({ browser, page: current, goal: "Find a book" });
  agent.state.decision = decision();
  agent.state.status = "predicted";
  agent.state.started_at = performance.now();
  return agent;
}
