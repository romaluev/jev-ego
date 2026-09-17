import { createHash } from "node:crypto";

import { SNAPSHOT } from "./browser-side/snapshot.js";
import { GUARD_FN } from "./browser-side/guard.js";
import { SETTLE_FN } from "./browser-side/settle.js";
import { assertNever } from "./assert.js";
import { listProfiles, openTaskSpace, type EgoPage, type EgoTaskSpace } from "./ego-runtime.js";
import type { Action, BrowserLike, CdpResult, PageState } from "./types.js";

const VIEWPORT = { width: 1120, height: 780, deviceScaleFactor: 1, mobile: false } as const;
const MARKER = `(() => { const state=${SNAPSHOT}; return state && state.marker ? state.marker : null; })()`;

export class StalePage extends Error {
  override name = "StalePage";
}

export class DropdownInterrupted extends Error {
  override name = "DropdownInterrupted";
}

export function fingerprint(state: Pick<PageState, "url" | "text" | "actions" | "scroll">): string {
  const content = { actions: state.actions, scroll: state.scroll, text: state.text, url: state.url };
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(", ")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${stableStringify(record[key])}`).join(", ")}}`;
}

function withSnapshot(template: string): string {
  return template.replaceAll("__JEV_READ_STATE__", SNAPSHOT);
}

export function observeExpression(afterInput: Action | null = null): { expression: string; awaitPromise: boolean } {
  if (!afterInput) {
    return { expression: SNAPSHOT, awaitPromise: false };
  }
  return {
    expression: `(${withSnapshot(SETTLE_FN)})(${JSON.stringify(afterInput)})`,
    awaitPromise: true,
  };
}

export function guardExpression(action: Action, page: PageState): string {
  return `(${withSnapshot(GUARD_FN)})(${JSON.stringify({
    action,
    expected: {
      pageKey: page.page_key,
      guards: page.guards ?? {},
      marker: page.marker,
    },
  })})`;
}

function asCdpResult(value: unknown): CdpResult {
  return (value ?? {}) as CdpResult;
}

export async function observeWithCdp(
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  options: { screenshot?: boolean; afterInput?: Action | null } = {},
): Promise<PageState> {
  const { expression, awaitPromise } = observeExpression(options.afterInput ?? null);
  const response = asCdpResult(
    await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    }),
  );
  if (response.exceptionDetails) {
    throw new StalePage("Document changed during evaluation");
  }
  const info = response.result?.value as PageState | null;
  if (info === null || info === undefined) {
    throw new StalePage("Document is navigating");
  }
  info.fingerprint = fingerprint(info);
  if (options.screenshot) {
    const shot = (await cdp("Page.captureScreenshot", { format: "jpeg", quality: 72 })) as { data?: string };
    info.screenshot = shot.data;
  }
  return info;
}

export async function actWithCdp(
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  action: Action,
  text?: string | null,
): Promise<{ executed: string }> {
  switch (action.kind) {
    case "wait":
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { executed: action.id };
    case "scroll":
    case "click":
    case "fill":
    case "select":
      break;
    default:
      return assertNever(action.kind, "action kind");
  }

  const response = asCdpResult(
    await cdp("Runtime.evaluate", {
      expression: guardExpression(action, {
        url: "",
        title: "",
        text: "",
        scroll: { y: 0 },
        actions: [],
        fingerprint: "",
      }),
      returnByValue: true,
    }),
  );

  if (action.kind === "select" && (response.exceptionDetails || response.result?.value === undefined)) {
    throw new DropdownInterrupted(
      response.exceptionDetails
        ? "Dropdown execution was interrupted; inspect before retrying."
        : "Dropdown execution was not confirmed; inspect before retrying.",
    );
  }
  if (response.exceptionDetails) {
    throw new StalePage("Document changed during evaluation");
  }

  const resolved = response.result?.value as { status?: string; x?: number; y?: number } | undefined;
  if (!resolved || resolved.status === "stale") {
    throw new StalePage("Page changed since this decision. Observe again.");
  }
  if (resolved.status === "blocked") {
    if (action.kind === "select") {
      throw new DropdownInterrupted("Dropdown execution was not confirmed; inspect before retrying.");
    }
    throw new StalePage("Target changed or is covered. Observe again.");
  }
  if (action.kind === "fill") {
    await typeWithCdp(cdp, text);
  }
  return { executed: action.id };
}

async function typeWithCdp(
  cdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  text?: string | null,
): Promise<void> {
  if (typeof text !== "string") {
    throw new Error("TYPE_TEXT needs a generated value; nothing typed.");
  }
  const modifiers = process.platform === "darwin" ? 4 : 2;
  await cdp("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    modifiers,
    commands: ["selectAll"],
  });
  await cdp("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    modifiers,
  });
  await cdp("Input.insertText", { text });
}

export class EgoBrowser implements BrowserLike {
  protocolCalls = 0;
  spaceId: number;
  afterInput: Action | null = null;
  private readonly task: EgoTaskSpace;
  private readonly page: EgoPage;
  private closed = false;

  private constructor(task: EgoTaskSpace, page: EgoPage) {
    this.task = task;
    this.page = page;
    this.spaceId = task.spaceId;
  }

  static async open(url: string, profileId: string): Promise<EgoBrowser> {
    const resolved = await resolveProfileId(profileId);
    const name = `jev-ego ${new Date().toISOString()}`;
    const task = await openTaskSpace(name, resolved);
    const page = task.page("p1");
    const browser = new EgoBrowser(task, page);
    console.log(`spaceId=${task.spaceId} profile=${resolved}`);
    await browser.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT });
    await browser.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.goto(url);
    return browser;
  }

  async goto(url: string): Promise<void> {
    this.afterInput = null;
    await this.page.goto(url);
  }

  async cdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.protocolCalls += 1;
    const timeout = method.startsWith("Input.") ? 15_000 : undefined;
    return await this.page.cdp(method, params, timeout ? { timeout } : undefined);
  }

  async evaluate(expression: string, options: { awaitPromise?: boolean } = {}): Promise<unknown> {
    const response = asCdpResult(
      await this.cdp("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: options.awaitPromise ?? false,
      }),
    );
    if (response.exceptionDetails) {
      throw new StalePage("Document changed during evaluation");
    }
    return response.result?.value;
  }

  async observe(options: { screenshot?: boolean } = {}): Promise<PageState> {
    const afterInput = this.afterInput;
    this.afterInput = null;
    return await observeWithCdp((method, params) => this.cdp(method, params), {
      screenshot: options.screenshot,
      afterInput,
    });
  }

  async fresh(page: PageState, action: Action | null = null): Promise<boolean> {
    if (action && (action.kind === "click" || action.kind === "select")) {
      const node = action.node;
      if (typeof node !== "number") {
        return false;
      }
      const current = await this.evaluate(
        `(() => { const c=window.__jevFast; return c ? [c.pageKey(),c.guard(c.nodes.get(${node}))] : null; })()`,
      );
      return JSON.stringify(current) === JSON.stringify([page.page_key, page.guards?.[String(node)]]);
    }
    const marker = await this.evaluate(MARKER);
    return JSON.stringify(marker) === JSON.stringify(page.marker);
  }

  async act(action: Action, page: PageState, text?: string | null): Promise<{ executed: string }> {
    if (action.kind === "wait") {
      if (!(await this.fresh(page, action))) {
        throw new StalePage("Page changed since this decision. Observe again.");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      this.afterInput = null;
      return { executed: action.id };
    }

    const response = asCdpResult(
      await this.cdp("Runtime.evaluate", {
        expression: guardExpression(action, page),
        returnByValue: true,
      }),
    );
    if (action.kind === "select" && (response.exceptionDetails || response.result?.value === undefined)) {
      throw new DropdownInterrupted(
        response.exceptionDetails
          ? "Dropdown execution was interrupted; inspect before retrying."
          : "Dropdown execution was not confirmed; inspect before retrying.",
      );
    }
    if (response.exceptionDetails) {
      throw new StalePage("Document changed during evaluation");
    }
    const resolved = response.result?.value as { status?: string; x?: number; y?: number } | undefined;
    if (!resolved || resolved.status === "stale") {
      throw new StalePage("Page changed since this decision. Observe again.");
    }
    if (resolved.status === "blocked") {
      if (action.kind === "select") {
        throw new DropdownInterrupted("Dropdown execution was not confirmed; inspect before retrying.");
      }
      throw new StalePage("Target changed or is covered. Observe again.");
    }

    switch (action.kind) {
      case "scroll":
      case "select":
      case "click":
        break;
      case "fill":
        await typeWithCdp((method, params) => this.cdp(method, params), text);
        break;
      default:
        return assertNever(action.kind, "action kind");
    }
    this.afterInput = action;
    return { executed: action.id };
  }

  async close(keepOpen = false): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.task.finish({ keep: keepOpen ? ["p1"] : [] });
  }
}

export async function resolveProfileId(requested: string): Promise<string> {
  const list = await listProfiles();
  const ids: string[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      ids.push(item);
      continue;
    }
    if (item.id) {
      ids.push(item.id);
    }
    if (item.name && item.name !== item.id) {
      ids.push(item.name);
    }
  }
  if (ids.includes(requested) || ids.length === 0) {
    return requested;
  }
  throw new Error(`Unknown profile ${requested}. Available: ${[...new Set(ids)].join(", ")}`);
}
