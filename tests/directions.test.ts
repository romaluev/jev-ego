import { expect, test } from "vitest";

import { rankDirections } from "../src/directions.js";
import { actionSpace } from "../src/model.js";
import { decision, page } from "./helpers.js";

test("rankDirections orders by joint P(op)*P(target|op)", () => {
  const [elements, targets, controls] = actionSpace(page().actions);
  const ranked = rankDirections(
    {
      ...decision(),
      operation: "CLICK",
      target: "2",
      choice: "e3",
      confidence: 0.8,
      operation_probabilities: { CLICK: 0.6, TYPE_TEXT: 0.3, WAIT: 0.1 },
      target_probabilities: { "1": 0.2, "2": 0.8 },
      target_confidence: 0.7,
      raw_answers: {
        operation: {
          choice: "CLICK",
          confidence: 0.8,
          probabilities: { CLICK: 0.6, TYPE_TEXT: 0.3, WAIT: 0.1 },
        },
        click_target: {
          choice: "2",
          confidence: 0.7,
          probabilities: { "1": 0.2, "2": 0.8 },
        },
        type_text_target: {
          choice: "1",
          confidence: 0.9,
          probabilities: { "1": 1 },
        },
      },
    },
    targets,
    controls,
    elements,
    8,
  );
  expect(ranked[0]?.operation).toBe("CLICK");
  expect(ranked[0]?.target).toBe("2");
  expect(ranked[0]?.joint).toBeCloseTo(0.48);
  const typeText = ranked.find((row) => row.operation === "TYPE_TEXT");
  expect(typeText?.joint).toBeCloseTo(0.3);
  const wait = ranked.find((row) => row.operation === "WAIT");
  expect(wait?.target).toBeNull();
  expect(wait?.joint).toBeCloseTo(0.1);
  expect(ranked[0]?.operation_confidence).toBe(0.8);
  expect(ranked[0]?.target_confidence).toBe(0.7);
});
