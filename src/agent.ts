import { StalePage } from "./browser.js";
import { actionSpace, choose } from "./model.js";
import { MAX_STEPS } from "./questions.js";
import { fieldContext, fieldText } from "./text.js";
import type {
  Action,
  AgentSnapshot,
  AgentState,
  AgentStatus,
  BrowserLike,
  CommandName,
  Decision,
  FieldContext,
  HistoryEntry,
  HistorySource,
  PageState,
  TextHelper,
} from "./types.js";
import { assertNever } from "./assert.js";

function sameContext(left: FieldContext, right: FieldContext): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeGoal(goals: string | string[]): string {
  const task = (typeof goals === "string" ? goals : goals.join("\n")).trim();
  if (!task) {
    throw new Error("Supply a task");
  }
  return task;
}

export class Agent {
  pendingText: [FieldContext, string, TextHelper] | null = null;
  readonly state: AgentState;

  constructor(options: { browser: BrowserLike; page: PageState; goal: string | string[] }) {
    const goal = normalizeGoal(options.goal);
    this.state = {
      browser: options.browser,
      goal,
      page: options.page,
      decision: null,
      history: [],
      status: "ready",
      plan: [goal],
      plan_index: 0,
      decisions: [],
      text_calls: [],
      elapsed_ms: 0,
      started_at: null,
      record: false,
    };
  }

  snapshot(): AgentSnapshot {
    const { browser, ...rest } = this.state;
    return {
      ...rest,
      elements: actionSpace(this.state.page.actions)[0],
      protocol_calls: browser.protocolCalls ?? 0,
      space_id: browser.spaceId,
    };
  }

  private elapsed(): number {
    const started = this.state.started_at;
    return started === null ? 0 : Math.round(performance.now() - started);
  }

  async command(name: CommandName, body: { fingerprint?: string } = {}): Promise<AgentSnapshot> {
    const state = this.state;
    switch (name) {
      case "tick":
        try {
          await this.command("predict", {});
          return await this.command("act", { fingerprint: state.page.fingerprint });
        } catch (error) {
          if (error instanceof StalePage) {
            state.decision = null;
            state.status = "ready";
            state.page = await state.browser.observe();
            state.elapsed_ms = this.elapsed();
            return this.snapshot();
          }
          throw error;
        }
      case "predict":
        return await this.predict();
      case "act":
        return await this.act(body);
      default:
        return assertNever(name, "command");
    }
  }

  private async predict(): Promise<AgentSnapshot> {
    const state = this.state;
    if (!state.browser) {
      throw new Error("Start a demo first");
    }
    if (state.started_at === null) {
      state.started_at = performance.now();
    }
    try {
      if (!(await state.browser.fresh(state.page))) {
        state.page = await state.browser.observe();
      }
    } catch (error) {
      if (error instanceof StalePage) {
        throw error;
      }
      throw error;
    }
    state.decision = null;
    if (state.status === "done" || state.status === "blocked") {
      throw new Error("This run has stopped. Start a fresh demo.");
    }
    if (state.decisions.length >= MAX_STEPS * 2) {
      throw new Error("Reached the demo's model-call budget");
    }
    state.decision = await choose(state.page, state.goal, state.history);
    state.decisions.push({
      ...state.decision,
      fingerprint: state.page.fingerprint,
      elapsed_ms: this.elapsed(),
    });
    state.status = "predicted";
    state.elapsed_ms = this.elapsed();
    return this.snapshot();
  }

  private async act(body: { fingerprint?: string }): Promise<AgentSnapshot> {
    const state = this.state;
    const decision = state.decision;
    const page = state.page;
    if (!decision || body.fingerprint !== page.fingerprint) {
      throw new Error("Observe and choose before acting");
    }
    state.decision = null;
    const selected = decision.choice;
    if (selected === "DONE" || selected === "BLOCKED") {
      if (!(await state.browser.fresh(page))) {
        state.status = "ready";
        throw new StalePage("Page changed since the decision. Choose again.");
      }
      state.status = selected === "DONE" ? "done" : "blocked";
      state.plan_index = selected === "DONE" ? 1 : 0;
      state.elapsed_ms = this.elapsed();
      return this.snapshot();
    }
    const action = page.actions.find((item) => item.id === selected);
    if (!action) {
      throw new Error("Chosen action is no longer on the page");
    }
    if (state.history.length >= MAX_STEPS) {
      state.status = "blocked";
      throw new Error(`Stopped at the ${MAX_STEPS}-action demo budget`);
    }
    let text: string | null = null;
    let helper: TextHelper | null = null;
    if (action.kind === "fill") {
      if (!(await state.browser.fresh(page))) {
        throw new StalePage("Page changed before text generation. Choose again.");
      }
      const context = fieldContext(state.goal, action, page, state.history);
      if (this.pendingText && sameContext(this.pendingText[0], context)) {
        [, text, helper] = this.pendingText;
      } else {
        [text, helper] = await fieldText(context);
        this.pendingText = [context, text, helper];
        state.text_calls.push({ ...helper, field: action.label, value: text });
      }
    }
    return await this.execute(action, {
      source: "jev",
      text,
      helper,
      decision,
    });
  }

  ensureClock(): void {
    if (this.state.started_at === null) {
      this.state.started_at = performance.now();
    }
  }

  setGoal(goal: string): void {
    this.state.goal = normalizeGoal(goal);
    this.state.plan = [this.state.goal];
  }

  async execute(
    action: Action,
    options: {
      source: HistorySource;
      text?: string | null;
      helper?: TextHelper | null;
      decision: Decision;
    },
  ): Promise<AgentSnapshot> {
    const state = this.state;
    const page = state.page;
    this.ensureClock();
    if (state.history.length >= MAX_STEPS) {
      state.status = "blocked";
      throw new Error(`Stopped at the ${MAX_STEPS}-action demo budget`);
    }
    const text = options.text ?? null;
    const helper = options.helper ?? null;
    const decision = options.decision;
    await state.browser.act(action, page, text);
    this.pendingText = null;
    state.elapsed_ms = this.elapsed();
    const entry: HistoryEntry = {
      step: state.history.length + 1,
      action: action.label,
      kind: action.kind,
      choice: decision.choice,
      probability: decision.probabilities[decision.choice],
      confidence: decision.confidence,
      latency_ms: decision.latency_ms,
      text,
      text_helper: helper?.model ?? null,
      text_latency_ms: helper?.latency_ms ?? 0,
      operation: decision.operation,
      target: decision.target,
      page_changed: null,
      url: page.url,
      usage: decision.usage,
      executed_ms: this.elapsed(),
      elapsed_ms: state.elapsed_ms,
      source: options.source,
    };
    state.history.push(entry);
    state.page = await state.browser.observe();
    state.elapsed_ms = this.elapsed();
    entry.page_changed = state.page.fingerprint !== page.fingerprint;
    entry.url = state.page.url;
    entry.elapsed_ms = state.elapsed_ms;
    const repeated = state.history.slice(-3);
    state.status = noProgress(repeated) ? "blocked" : "ready";
    return this.snapshot();
  }

  async *run(): AsyncGenerator<AgentSnapshot> {
    while (this.state.status !== "done" && this.state.status !== "blocked") {
      yield await this.command("tick");
    }
  }

  async close(keepOpen = false): Promise<void> {
    await this.state.browser.close(keepOpen);
  }
}

function noProgress(repeated: HistoryEntry[]): boolean {
  return (
    repeated.length === 3 &&
    repeated.every((entry) => entry.page_changed === false && entry.kind !== "wait")
  );
}

export function isTerminal(status: AgentStatus): boolean {
  return status === "done" || status === "blocked";
}
