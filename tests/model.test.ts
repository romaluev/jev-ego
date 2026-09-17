import { afterEach, expect, test, vi } from "vitest";

import * as http from "../src/http.js";
import { actionSpace, choose, validateChoice } from "../src/model.js";
import { fieldContext, fieldText } from "../src/text.js";
import { choice, page } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test.each(["unknown", "nan", "missing", "negative", "non_max", "confidence"] as const)(
  "invalid choice is rejected (%s)",
  (mutation) => {
    const answer = choice(["a", "b"], "a") as {
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    };
    if (mutation === "unknown") {
      answer.choice = "invented";
    } else if (mutation === "nan") {
      answer.probabilities.a = Number.NaN;
    } else if (mutation === "missing") {
      delete answer.probabilities.b;
    } else if (mutation === "negative") {
      answer.probabilities.b = -1;
    } else if (mutation === "non_max") {
      answer.choice = "b";
    } else {
      answer.confidence = 5;
    }
    expect(() => validateChoice(answer, ["a", "b"])).toThrow(/Invalid TypeSafe/);
  },
);

test("one index per node with operation-specific targets", () => {
  const [elements, targets, controls] = actionSpace(page().actions);
  expect(elements).toHaveLength(2);
  expect(elements[0]?.operations).toEqual(["TYPE_TEXT", "CLICK"]);
  expect(targets.TYPE_TEXT?.["1"]?.id).toBe("e1");
  expect(targets.CLICK?.["1"]?.id).toBe("e2");
  expect(targets.CLICK?.["2"]?.id).toBe("e3");
  expect(controls).toHaveProperty("WAIT");
});

test("all heads are one request and only the matching head executes", async () => {
  const calls: unknown[] = [];
  vi.stubEnv("TYPESAFE_API_KEY", "test");
  vi.spyOn(http, "postJson").mockImplementation(async (_url, _key, body) => {
    calls.push(body);
    const record = body as { questions: { operation: { criteria: Record<string, string> } } };
    return {
      model: "test",
      answers: {
        operation: choice(Object.keys(record.questions.operation.criteria), "TYPE_TEXT"),
        type_text_target: choice(["1"], "1"),
        click_target: { choice: "invented" },
      },
    };
  });
  const decided = await choose(page(), "Find a book", []);
  expect(calls).toHaveLength(1);
  expect(decided.operation).toBe("TYPE_TEXT");
  expect(decided.target).toBe("1");
  expect(decided.choice).toBe("e1");
  expect(new Set(Object.keys((calls[0] as { questions: object }).questions))).toEqual(
    new Set(["operation", "click_target", "type_text_target"]),
  );
});

test("click cannot consume a text target", async () => {
  vi.stubEnv("TYPESAFE_API_KEY", "test");
  vi.spyOn(http, "postJson").mockImplementation(async (_url, _key, body) => {
    const record = body as { questions: { operation: { criteria: Record<string, string> } } };
    return {
      model: "test",
      answers: {
        operation: choice(Object.keys(record.questions.operation.criteria), "CLICK"),
        type_text_target: choice(["1"], "1"),
        click_target: choice(["1", "2", "999"], "999"),
      },
    };
  });
  await expect(choose(page(), "Find a book", [])).rejects.toThrow(/Invalid TypeSafe/);
});

test("target head receives control state and full next-step rules", async () => {
  const current = page();
  current.actions.unshift({
    id: "toggle",
    kind: "click",
    label: "Free cancellation",
    node: 30,
    role: "checkbox",
    checked: "true",
    selected: false,
  });
  vi.stubEnv("TYPESAFE_API_KEY", "test");
  vi.spyOn(http, "postJson").mockImplementation(async (_url, _key, body) => {
    const questions = (body as { questions: Record<string, { criteria: Record<string, { checked?: string; selected?: boolean }>; instructions: { rules: unknown } }> }).questions;
    const target = questions.click_target;
    expect(target?.criteria["1"]?.checked).toBe("true");
    expect(target?.criteria["1"]?.selected).toBe(false);
    expect(target?.instructions.rules).toContain(questions.operation?.instructions.rules);
    return {
      model: "test",
      answers: {
        operation: choice(Object.keys(questions.operation?.criteria ?? {}), "CLICK"),
        click_target: choice(Object.keys(target?.criteria ?? {}), "3"),
      },
    };
  });
  const decided = await choose(current, "Search with free cancellation", []);
  expect(decided.choice).toBe("e3");
});

test("quoted task text still uses the LLM", async () => {
  vi.stubEnv("TEXT_MODEL_API_KEY", "test");
  const post = vi.spyOn(http, "postJson").mockResolvedValue({
    choices: [{ message: { content: '{"text":"Zurich"}' } }],
  });
  const context = fieldContext('Fly from "Zurich" to London', page().actions[0]!, page(), []);
  expect((await fieldText(context))[0]).toBe("Zurich");
  expect(post).toHaveBeenCalledTimes(1);
  const sent = JSON.parse(
    (post.mock.calls[0]?.[2] as { messages: Array<{ content: string }> }).messages[1]!.content,
  );
  expect(sent.goal).toBe('Fly from "Zurich" to London');
});

test("missing text credential stops before guessing", async () => {
  vi.stubEnv("TEXT_MODEL_API_KEY", "");
  delete process.env.TEXT_MODEL_API_KEY;
  await expect(fieldText({ goal: 'Enter "Zurich"' })).rejects.toThrow(/TEXT_MODEL_API_KEY/);
});

test.each(["Thinking: Zurich", '{"text":null}', '{"text":"Zurich","extra":true}', '{"text":123}'])(
  "text helper rejects invalid values (%s)",
  async (content) => {
    vi.stubEnv("TEXT_MODEL_API_KEY", "test");
    vi.spyOn(http, "postJson").mockResolvedValue({ choices: [{ message: { content } }] });
    await expect(fieldText({ goal: "Find a flight" })).rejects.toThrow(/nothing typed/);
  },
);

test("text helper accepts fenced JSON and retries a stale first answer", async () => {
  vi.stubEnv("TEXT_MODEL_API_KEY", "test");
  const post = vi.spyOn(http, "postJson").mockResolvedValueOnce({ choices: [{ message: { content: "" } }] }).mockResolvedValueOnce({
    choices: [{ message: { content: "```json\n{\"text\":\"Zurich\"}\n```" } }],
  });
  expect((await fieldText({ goal: "Find a flight" }))[0]).toBe("Zurich");
  expect(post).toHaveBeenCalledTimes(2);
});
