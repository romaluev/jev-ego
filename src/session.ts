import { Agent, isTerminal } from "./agent.js";
import { EgoBrowser } from "./browser.js";
import { rankDirections } from "./directions.js";
import { actionSpace, resolveAction } from "./model.js";
import type { AgentSnapshot, BrowserLike, Decision, Direction } from "./types.js";

export class BusyError extends Error {
  readonly status = 409;
  constructor() {
    super("A browser step is already running");
    this.name = "BusyError";
  }
}

export interface SuggestResult {
  snapshot: AgentSnapshot;
  directions: Direction[];
  decision: Decision;
}

export interface StepResult {
  pending: boolean;
  snapshot: AgentSnapshot;
  decision: Decision | null;
  reason?: string;
}

export class Session {
  busy = false;

  constructor(
    readonly browser: BrowserLike,
    readonly agent: Agent,
  ) {}

  static async open(options: { url: string; goal: string; profileId: string }): Promise<Session> {
    const browser = await EgoBrowser.open(options.url, options.profileId);
    const page = await browser.observe();
    const agent = new Agent({ browser, page, goal: options.goal });
    return new Session(browser, agent);
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) {
      throw new BusyError();
    }
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  observe(): AgentSnapshot {
    return this.agent.snapshot();
  }

  async actManual(operation: string, target?: string, text?: string): Promise<AgentSnapshot> {
    return await this.withLock(async () => {
      const action = resolveAction(this.agent.state.page.actions, operation, target);
      if (action.kind === "fill") {
        if (!text || !text.trim()) {
          throw new Error("TYPE_TEXT requires text");
        }
      }
      this.agent.ensureClock();
      const decision: Decision = {
        choice: action.id,
        operation,
        target: target ?? null,
        confidence: 1,
        probabilities: { [action.id]: 1 },
        latency_ms: 0,
        usage: {},
      };
      return await this.agent.execute(action, {
        source: "agent",
        text: text ?? null,
        decision,
      });
    });
  }

  async suggest(goal?: string, topK = 8): Promise<SuggestResult> {
    return await this.withLock(async () => {
      if (goal) {
        this.agent.setGoal(goal);
      }
      const snapshot = await this.agent.command("predict");
      const decision = this.agent.state.decision;
      if (!decision) {
        throw new Error("TypeSafe returned no decision");
      }
      const [elements, targets, controls] = actionSpace(this.agent.state.page.actions);
      return {
        snapshot,
        decision,
        directions: rankDirections(decision, targets, controls, elements, topK),
      };
    });
  }

  async step(goal?: string): Promise<StepResult> {
    return await this.withLock(async () => {
      if (goal) {
        this.agent.setGoal(goal);
      }
      const snapshot = await this.agent.command("predict");
      const decision = this.agent.state.decision;
      if (!decision) {
        throw new Error("TypeSafe returned no decision");
      }
      if (decision.operation === "TYPE_TEXT" && !process.env.TEXT_MODEL_API_KEY) {
        return {
          pending: true,
          snapshot,
          decision,
          reason: `TYPE_TEXT ${decision.target ?? ""} needs text. Run: jev-ego act TYPE_TEXT ${decision.target ?? "i"} "..."`,
        };
      }
      const next = await this.agent.command("act", { fingerprint: this.agent.state.page.fingerprint });
      return { pending: false, snapshot: next, decision };
    });
  }

  async run(maxSteps: number, goal?: string): Promise<AgentSnapshot> {
    return await this.withLock(async () => {
      if (goal) {
        this.agent.setGoal(goal);
      }
      let last = this.agent.snapshot();
      let ticks = 0;
      while (!isTerminal(this.agent.state.status) && ticks < maxSteps) {
        if (this.agent.state.status === "predicted") {
          const pending = this.agent.state.decision;
          if (pending?.operation === "TYPE_TEXT" && !process.env.TEXT_MODEL_API_KEY) {
            throw new Error(
              `TYPE_TEXT ${pending.target ?? ""} needs TEXT_MODEL_API_KEY or: jev-ego act TYPE_TEXT ${pending.target ?? "i"} "..."`,
            );
          }
        }
        last = await this.agent.command("tick");
        ticks += 1;
      }
      return last;
    });
  }

  async goto(url: string): Promise<AgentSnapshot> {
    return await this.withLock(async () => {
      if (!this.browser.goto) {
        throw new Error("This browser cannot navigate");
      }
      await this.browser.goto(url);
      this.agent.state.page = await this.browser.observe();
      return this.agent.snapshot();
    });
  }

  async stop(keepOpen = false): Promise<void> {
    await this.agent.close(keepOpen);
  }
}

export async function suggestFromState(
  snapshot: AgentSnapshot,
  decision: Decision,
  topK = 8,
): Promise<Direction[]> {
  const [elements, targets, controls] = actionSpace(snapshot.page.actions);
  return rankDirections(decision, targets, controls, elements, topK);
}
