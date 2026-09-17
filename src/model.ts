import { postJson } from "./http.js";
import { NEXT_ACTION, TARGET } from "./questions.js";
import type { Action, ChoiceAnswer, Decision, ElementRow, PageState } from "./types.js";

const KIND_TO_OPERATION = {
  click: "CLICK",
  fill: "TYPE_TEXT",
  select: "SELECT",
} as const;

export function validateChoice(answer: unknown, ids: Iterable<string>): ChoiceAnswer {
  const idSet = new Set(ids);
  try {
    const record = answer as ChoiceAnswer;
    const probabilities = record.probabilities;
    const numbers = [...Object.values(probabilities), record.confidence];
    const valid =
      idSet.has(record.choice) &&
      [...idSet].every((id) => Object.hasOwn(probabilities, id)) &&
      Object.keys(probabilities).length === idSet.size &&
      numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) &&
      Math.abs(Object.values(probabilities).reduce((sum, n) => sum + n, 0) - 1) < 0.02 &&
      probabilities[record.choice]! >= Math.max(...Object.values(probabilities)) - 1e-6;
    if (!valid) {
      throw new Error("invalid");
    }
    return record;
  } catch {
    throw new Error("Invalid TypeSafe response; no action executed.");
  }
}

export function actionSpace(actions: Action[]): [
  ElementRow[],
  Record<string, Record<string, Action>>,
  Record<string, Action>,
] {
  const elements: ElementRow[] = [];
  const indices = new Map<number, string>();
  const targets: Record<string, Record<string, Action>> = {};
  const controls: Record<string, Action> = {};
  for (const action of actions) {
    const kind = action.kind;
    if (!(kind in KIND_TO_OPERATION)) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const node = action.node;
    if (typeof node !== "number") {
      continue;
    }
    if (!indices.has(node)) {
      const index = String(elements.length + 1);
      indices.set(node, index);
      const element: ElementRow = {
        index,
        label: action.label.split(" → ")[0] ?? action.label,
        operations: [],
      };
      for (const key of ["role", "value", "checked", "selected", "expanded"] as const) {
        if (key in action) {
          (element as unknown as Record<string, unknown>)[key] = action[key];
        }
      }
      if (kind === "select") {
        element.value = action.current_value ?? "";
        element.options = [];
      }
      elements.push(element);
    }
    const index = indices.get(node);
    if (!index) {
      continue;
    }
    const operation = KIND_TO_OPERATION[kind as keyof typeof KIND_TO_OPERATION];
    const group = (targets[operation] ??= {});
    const element = elements[Number(index) - 1];
    if (!element) {
      continue;
    }
    if (!element.operations.includes(operation)) {
      element.operations.push(operation);
    }
    let target = index;
    if (kind === "select") {
      const options = element.options ?? (element.options = []);
      target = `${index}:${options.length + 1}`;
      options.push({ index: target, label: action.label, value: action.value });
    }
    group[target] = action;
  }
  return [elements, targets, controls];
}

export function resolveAction(actions: Action[], operation: string, target?: string): Action {
  const [, targets, controls] = actionSpace(actions);
  if (operation === "DONE" || operation === "BLOCKED") {
    throw new Error(`${operation} is a judgment, not an executable target`);
  }
  const control = controls[operation];
  if (control) {
    return control;
  }
  const group = targets[operation];
  if (!group) {
    throw new Error(`${operation} is not available on this page`);
  }
  if (!target) {
    throw new Error(`${operation} requires a target index`);
  }
  const action = group[target];
  if (!action) {
    throw new Error(`Unknown target ${target} for ${operation}`);
  }
  return action;
}

export async function choose(state: PageState, goal: string, history: Array<{ action?: string; kind?: string; text?: string | null; page_changed?: boolean | null }>): Promise<Decision> {
  const [elements, targets, controls] = actionSpace(state.actions);
  const labels: Record<string, string> = {
    CLICK: "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
    TYPE_TEXT: "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
    SELECT: "Select an observed dropdown value.",
  };
  const operations: Record<string, string> = {};
  for (const key of Object.keys(targets)) {
    operations[key] = labels[key] ?? key;
  }
  for (const [key, value] of Object.entries(controls)) {
    operations[key] = value.label;
  }
  operations.DONE = "Every requirement is visibly satisfied.";
  operations.BLOCKED = "No supported operation can make progress.";
  const questions: Record<string, unknown> = {
    operation: { type: "choice", criteria: operations, instructions: { goal, rules: NEXT_ACTION } },
  };
  for (const [operation, candidates] of Object.entries(targets)) {
    questions[`${operation.toLowerCase()}_target`] = {
      type: "choice",
      criteria: Object.fromEntries(
        Object.entries(candidates).map(([index, action]) => [
          index,
          {
            element: `[${index}] ${action.label}`,
            current_value: action.current_value ?? action.value ?? "",
            ...Object.fromEntries(
              (["role", "checked", "selected", "expanded"] as const)
                .filter((key) => key in action)
                .map((key) => [key, action[key]]),
            ),
          },
        ]),
      ),
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] },
    };
  }
  const body = {
    model: process.env.TYPESAFE_MODEL ?? "jev-latest",
    state: {
      page: { url: state.url, title: state.title, text: state.text },
      elements,
      recent_actions: history.slice(-10).map((entry) => ({
        action: entry.action,
        kind: entry.kind,
        text: entry.text,
        page_changed: entry.page_changed,
      })),
    },
    questions,
  };
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    throw new Error("TYPESAFE_API_KEY is required; no action executed.");
  }
  const started = performance.now();
  const result = (await postJson("https://api.typesafe.ai/v1/systemone", key, body)) as {
    answers?: Record<string, unknown>;
    model?: string;
    usage?: Record<string, unknown>;
  };
  const answers = result.answers ?? {};
  const operationAnswer = validateChoice(answers.operation ?? {}, Object.keys(operations));
  const operation = operationAnswer.choice;
  let target: string | null = null;
  let targetAnswer: ChoiceAnswer | null = null;
  let choice = operation;
  let probabilities: Record<string, number> = {};
  const selectedTargets = targets[operation];
  if (selectedTargets) {
    targetAnswer = validateChoice(answers[`${operation.toLowerCase()}_target`] ?? {}, Object.keys(selectedTargets));
    target = targetAnswer.choice;
    const selected = selectedTargets[target];
    if (!selected) {
      throw new Error("Invalid TypeSafe response; no action executed.");
    }
    choice = selected.id;
    probabilities = Object.fromEntries(
      Object.entries(selectedTargets).map(([index, action]) => [action.id, targetAnswer?.probabilities[index] ?? 0]),
    );
  } else {
    const control = controls[operation];
    choice = control ? control.id : operation;
    probabilities[choice] = operationAnswer.probabilities[operation] ?? 0;
  }
  return {
    choice,
    operation,
    target,
    confidence: operationAnswer.confidence,
    probabilities,
    operation_probabilities: operationAnswer.probabilities,
    target_probabilities: targetAnswer?.probabilities ?? {},
    target_confidence: targetAnswer?.confidence ?? null,
    raw_answers: answers,
    model: result.model,
    usage: result.usage ?? {},
    latency_ms: Math.round(performance.now() - started),
    request: body,
  };
}
