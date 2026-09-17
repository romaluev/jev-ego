import { postJson } from "./http.js";
import { TEXT_VALUE } from "./questions.js";
import type { Action, FieldContext, HistoryEntry, PageState, TextHelper } from "./types.js";

export function fieldContext(
  goal: string,
  action: Action,
  page: PageState,
  history: HistoryEntry[],
): FieldContext {
  return {
    goal,
    field: { label: action.label, role: action.role, value: action.value },
    page: { title: page.title, text: page.text.slice(0, 6000) },
    recent_actions: history.slice(-6).map((entry) => ({ action: entry.action, text: entry.text })),
  };
}

export async function fieldText(context: FieldContext | Record<string, unknown>): Promise<[string, TextHelper]> {
  const key = process.env.TEXT_MODEL_API_KEY;
  if (!key) {
    throw new Error("TYPE_TEXT needs TEXT_MODEL_API_KEY; no text is hardcoded or guessed by the executor.");
  }
  const base = (process.env.TEXT_MODEL_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = process.env.TEXT_MODEL ?? "deepseek-chat";
  let reasoning: Record<string, unknown> = base.includes("api.deepseek.com/")
    ? { thinking: { type: "disabled" } }
    : { reasoning: { effort: "low" } };
  if (process.env.TEXT_MODEL_REASONING === "none") {
    reasoning = { reasoning: { enabled: false } };
  }
  const started = performance.now();
  const request = {
    model,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    ...reasoning,
    messages: [
      { role: "system", content: TEXT_VALUE },
      { role: "user", content: JSON.stringify(context) },
    ],
  };
  let lastUsage: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = (await postJson(`${base}/chat/completions`, key, request)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: Record<string, unknown>;
    };
    lastUsage = result.usage ?? {};
    try {
      return [
        parseFieldOutput(messageContent(result)),
        {
          model,
          latency_ms: Math.round(performance.now() - started),
          usage: lastUsage,
        },
      ];
    } catch {
      if (attempt === 1) {
        break;
      }
    }
  }
  throw new Error("Text helper returned no valid field value; nothing typed.");
}

export function messageContent(result: { choices?: Array<{ message?: { content?: unknown } }> }): string {
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

export function parseFieldOutput(content: string): string {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const output = JSON.parse(trimmed) as Record<string, unknown>;
  const value = output.text;
  if (
    Object.keys(output).length !== 1 ||
    !("text" in output) ||
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2000
  ) {
    throw new Error("invalid");
  }
  return value;
}
