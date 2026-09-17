export type ActionKind = "click" | "fill" | "select" | "scroll" | "wait";

export type Operation =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "SCROLL_UP"
  | "SCROLL_DOWN"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

export type CommandName = "tick" | "predict" | "act";

export type AgentStatus = "ready" | "predicted" | "done" | "blocked";

export interface Action {
  id: string;
  kind: ActionKind;
  label: string;
  node?: number;
  role?: string;
  value?: string;
  current_value?: string;
  checked?: string | boolean;
  selected?: string | boolean;
  expanded?: string | boolean;
  delta?: number;
  rect?: { x: number; y: number; w: number; h: number };
}

export interface PageState {
  url: string;
  title: string;
  text: string;
  w?: number;
  h?: number;
  scroll: { y: number; height?: number };
  actions: Action[];
  fingerprint: string;
  marker?: unknown;
  page_key?: unknown;
  guards?: Record<string, unknown>;
  omitted_actions?: number;
  screenshot?: string;
}

export interface ElementRow {
  index: string;
  label: string;
  operations: string[];
  role?: string;
  value?: string;
  checked?: string | boolean;
  selected?: string | boolean;
  expanded?: string | boolean;
  options?: Array<{ index: string; label: string; value?: string }>;
}

export interface ChoiceAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface Decision {
  choice: string;
  operation: string;
  target: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  operation_probabilities?: Record<string, number>;
  target_probabilities?: Record<string, number>;
  target_confidence?: number | null;
  raw_answers?: unknown;
  model?: string;
  usage: Record<string, unknown>;
  latency_ms: number;
  request?: unknown;
}

export type HistorySource = "jev" | "agent";

export interface HistoryEntry {
  step: number;
  action: string;
  kind: ActionKind;
  choice: string;
  probability: number | undefined;
  confidence: number;
  latency_ms: number;
  text: string | null;
  text_helper: string | null;
  text_latency_ms: number;
  operation: string;
  target: string | null;
  page_changed: boolean | null;
  url: string;
  usage: Record<string, unknown>;
  executed_ms: number;
  elapsed_ms: number;
  source: HistorySource;
}

export interface Direction {
  operation: string;
  target: string | null;
  label: string;
  joint: number;
  operation_probability: number;
  target_probability: number | null;
  operation_confidence: number;
  target_confidence: number | null;
}

export interface RegistryEntry {
  spaceId: number;
  port: number;
  token: string;
  pid: number;
  url: string;
  goal: string;
  startedAt: string;
  serveToken?: string;
}

export interface TextHelper {
  model: string;
  latency_ms: number;
  usage: Record<string, unknown>;
}

export interface FieldContext {
  goal: string;
  field: { label?: string; role?: string; value?: string };
  page: { title: string; text: string };
  recent_actions: Array<{ action?: string; text?: string | null }>;
}

export interface CdpResult {
  result?: { value?: unknown };
  exceptionDetails?: unknown;
}

export interface BrowserPort {
  evaluate(expression: string, options?: { awaitPromise?: boolean }): Promise<unknown>;
  cdp(method: string, params?: Record<string, unknown>): Promise<CdpResult | unknown>;
  goto(url: string): Promise<void>;
  url(): Promise<string>;
}

export interface BrowserLike {
  observe(options?: { screenshot?: boolean }): Promise<PageState>;
  fresh(page: PageState, action?: Action | null): Promise<boolean>;
  act(action: Action, page: PageState, text?: string | null): Promise<{ executed: string }>;
  close(keepOpen?: boolean): Promise<void>;
  evaluate?(expression: string): Promise<unknown>;
  goto?(url: string): Promise<void>;
  protocolCalls?: number;
  spaceId?: number;
}

export interface AgentState {
  browser: BrowserLike;
  goal: string;
  page: PageState;
  decision: Decision | null;
  history: HistoryEntry[];
  status: AgentStatus;
  plan: string[];
  plan_index: number;
  decisions: Array<Decision & { fingerprint: string; elapsed_ms: number }>;
  text_calls: Array<TextHelper & { field: string; value: string }>;
  elapsed_ms: number;
  started_at: number | null;
  record: boolean;
}

export type JevCommand = "run" | "flights" | "smoke" | "probe" | "serve";

export interface JevArgs {
  command: JevCommand;
  url?: string;
  goals?: string[];
  keepOpen?: boolean;
  traceDir?: string;
  outputDir?: string;
  profileId?: string;
  fixtureUrl?: string;
  registryDir?: string;
  serveToken?: string;
  envPath?: string;
}

export interface AgentSnapshot {
  goal: string;
  page: PageState;
  decision: Decision | null;
  history: HistoryEntry[];
  status: AgentStatus;
  plan: string[];
  plan_index: number;
  decisions: AgentState["decisions"];
  text_calls: AgentState["text_calls"];
  elapsed_ms: number;
  started_at: number | null;
  record: boolean;
  elements: ElementRow[];
  protocol_calls: number;
  space_id: number | undefined;
}
