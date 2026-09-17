import type { Action, ChoiceAnswer, Decision, Direction, ElementRow } from "./types.js";

function asChoice(value: unknown): ChoiceAnswer | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as ChoiceAnswer;
  if (!record.probabilities || typeof record.probabilities !== "object") {
    return null;
  }
  return record;
}

function elementLabel(elements: ElementRow[], target: string, action?: Action): string {
  const index = target.split(":")[0] ?? target;
  const element = elements.find((row) => row.index === index);
  const option = element?.options?.find((item) => item.index === target);
  if (option) {
    return option.label;
  }
  if (element) {
    const value = element.value ? ` · ${element.value}` : "";
    return `${element.label}${value}`;
  }
  return action?.label ?? target;
}

export function rankDirections(
  decision: Decision,
  targets: Record<string, Record<string, Action>>,
  controls: Record<string, Action>,
  elements: ElementRow[],
  topK = 8,
): Direction[] {
  const answers = (decision.raw_answers ?? {}) as Record<string, unknown>;
  const operationAnswer =
    asChoice(answers.operation) ??
    ({
      choice: decision.operation,
      confidence: decision.confidence,
      probabilities: decision.operation_probabilities ?? { [decision.operation]: 1 },
    } satisfies ChoiceAnswer);
  const rows: Direction[] = [];
  for (const [operation, operationProbability] of Object.entries(operationAnswer.probabilities)) {
    const group = targets[operation];
    if (group) {
      const targetAnswer =
        asChoice(answers[`${operation.toLowerCase()}_target`]) ??
        (operation === decision.operation
          ? {
              choice: decision.target ?? "",
              confidence: decision.target_confidence ?? 0,
              probabilities: Object.fromEntries(
                Object.entries(group).map(([index, action]) => [
                  index,
                  decision.target_probabilities?.[index] ??
                    decision.probabilities[action.id] ??
                    0,
                ]),
              ),
            }
          : null);
      const targetConfidence = targetAnswer?.confidence ?? null;
      const targetProbs = targetAnswer?.probabilities ?? {};
      for (const [target, action] of Object.entries(group)) {
        const targetProbability = targetProbs[target] ?? 0;
        rows.push({
          operation,
          target,
          label: elementLabel(elements, target, action),
          joint: operationProbability * targetProbability,
          operation_probability: operationProbability,
          target_probability: targetProbability,
          operation_confidence: operationAnswer.confidence,
          target_confidence: targetConfidence,
        });
      }
      continue;
    }
    const control = controls[operation];
    rows.push({
      operation,
      target: null,
      label: control?.label ?? operation,
      joint: operationProbability,
      operation_probability: operationProbability,
      target_probability: null,
      operation_confidence: operationAnswer.confidence,
      target_confidence: null,
    });
  }
  return rows.sort((left, right) => right.joint - left.joint).slice(0, topK);
}
