# jev-ego

Read README.md before editing. Keep the loop small: page -> indexed elements -> operation + target -> execution.

- The input is one natural-language goal. Do not add site-specific plans or hardcoded field values.
- TypeSafe chooses an operation and operation-specific target heads in one request. Consume only the selected operation's target.
- Targets must map to observed elements and supported operations. Never let the model emit selectors or executable code.
- TYPE_TEXT invokes the text LLM. Cache a stale retry's value only while its entire helper input is identical.
- Never retry a browser mutation. Log execution before observing its result.
- Screenshots are optional; the model does not consume them.
- Drive the browser through ego lite (`ego-browser nodejs`). Use `page.cdp` / `Runtime.evaluate` on the hot path. Do not add Playwright or a second browser.
- One TaskSpace per run, one daemon per space (`jev-ego serve` / `stop`). Default profile is Agent (`Profile 4`). Print `spaceId`. Call `task.finish` only after a successful run.
- Agent-driven `act` targets must resolve through `actionSpace()` — observed indices only. Record `source=agent` on history so Jev sees those moves.
- Keep credentials server-side and .env ignored. Tests must not call paid APIs.
- Verify actual final outcomes independently. A DONE choice is not proof of success.
- Keep examples, README claims, raw evidence, and model-call counts consistent.
- Do not commit or push unless the user requests it.

Checks: `pnpm lint`, `pnpm test`, `pnpm build`.
