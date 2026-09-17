# jev-ego

A browser agent with a dynamic, indexed action space, running inside [ego lite](https://lite.ego.app/).

Give it one goal. An agent (or [TypeSafe's Jev](https://docs.typesafe.ai/introduction)) picks an operation and an element. A small LLM writes text only when Jev chooses `TYPE_TEXT`; an agent-chosen `TYPE_TEXT` takes the string you pass.

This is a TypeScript port of [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast). The policy is the same. The browser layer is ego lite instead of Chrome via Browser Harness, and the whole loop runs in one `ego-browser nodejs` process.

## The action space

Every observation produces a new element table:

```text
[1] button    Change ticket type · Round trip
[2] combobox  Where from?        · San Francisco
[3] combobox  Where to?          · empty
[4] textbox   Departure          · empty
```

The operations are `CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`, `WAIT`, `DONE`, and `BLOCKED`. Only supported operations and targets are offered.

```text
                      one TypeSafe request
                     ┌───────────────────────────┐
page → element table → operation                 │
                     │ click_target              │
                     │ type_text_target          │
                     │ select_target, if present │
                     └─────────────┬─────────────┘
                         use the matching target
                                   │
                    CLICK [7] ─────┤──→ ego lite
                TYPE_TEXT [3] ─────┘
                          ↓
                   small LLM → text → ego lite
```

Target questions are speculative. If the operation is `CLICK`, only `click_target` can execute. Two decisions, **one network round trip**. Model output never becomes selectors, coordinates, or executable JavaScript.

## Why it moves

- **One process, one connection.** TypeSafe, the text helper, and CDP all run inside ego's Node runtime. There is no Python process and no Browser Harness hop.
- **One browser call per snapshot.** Visible controls, names, values, and text are read atomically. Post-input settling and the next snapshot share one `Runtime.evaluate`.
- **Guard, geometry, and click in one evaluate.** Freshness, visibility, and hit-testing resolve together; click, scroll, and native `<select>` mutate in that same call. `TYPE_TEXT` then uses `Input.insertText`.
- **No screenshots in the agent loop.** Jev consumes structured state.
- **Short waits, not guesses.** After typing into a combobox, wait for visible suggestions, capped at 200 ms. Other interactions wait at most two animation frames or 50 ms.

Agents should prefer the **stepper**: `serve` keeps one TaskSpace and page session in a loopback daemon so `observe` / `act` / `suggest` / `step` skip ego process startup. See [`skills/jev-ego/SKILL.md`](skills/jev-ego/SKILL.md).

Read the loop in [`src/agent.ts`](src/agent.ts) and the daemon in [`docs/design.md`](docs/design.md).

## Requirements

- macOS with [ego lite](https://lite.ego.app/) installed and `ego-browser` on `PATH` (this repo was developed against `ego-browser 0.5.0.32`)
- Node 20+ and [pnpm](https://pnpm.io/)
- `TYPESAFE_API_KEY` for decisions
- `TEXT_MODEL_API_KEY` for `TYPE_TEXT` (OpenAI-compatible; OpenRouter + `inception/mercury-2.5` in the example config)

The default task-space profile is **Profile 4** (Agent). Do not sign into personal accounts from that profile. Override with `--profile` or `JEV_PROFILE_ID`.

## Try it

```bash
pnpm install
pnpm build
cp .env.example .env
# Add TYPESAFE_API_KEY and TEXT_MODEL_API_KEY.
```

Agent stepper (one space, many steps):

```bash
pnpm exec jev-ego serve --url https://en.wikipedia.org/wiki/Main_Page \
  --goal 'Find and open the Wikipedia article about Gödel’s incompleteness theorems.'
pnpm exec jev-ego observe
pnpm exec jev-ego suggest
pnpm exec jev-ego act CLICK 4
pnpm exec jev-ego step
pnpm exec jev-ego stop
```

One-shot autopilot:

```bash
pnpm exec jev-ego run \
  --url https://en.wikipedia.org/wiki/Main_Page \
  --goal 'Find and open the Wikipedia article about Gödel’s incompleteness theorems.'
```

Google Flights example (search only; it never selects or books). Independent checks confirm route, date, and visible options:

```bash
pnpm exec jev-ego flights
```

Local hotel fixture (starts a loopback server, then drives ego lite):

```bash
pnpm exec jev-ego smoke
```

Useful flags: `--keep-open`, `--trace DIR`, `--output DIR`, `--profile ID`.

`jev-ego probe [--url URL]` opens a page, takes one snapshot, and prints protocol-call counts. It does not call TypeSafe.

The same policy as a library, from an `ego-browser nodejs` script:

```ts
import { Agent } from "./src/agent.ts";
import { EgoBrowser } from "./src/browser.ts";

const browser = await EgoBrowser.open(url, "Profile 4");
const page = await browser.observe();
const agent = new Agent({ browser, page, goal });
for await (const state of agent.run()) {
  console.log(state.elapsed_ms, state.status);
}
await agent.close();
```

## Development

```bash
pnpm lint
pnpm test
pnpm build
```

Tests are offline. Live `flights` and `smoke` commands make paid API calls and drive ego lite. Credentials stay in `.env`.

## Evidence and limits

On ego lite 0.5.0.32, a first snapshot after navigation is **3 CDP calls** (viewport, focus emulation, one `Runtime.evaluate`): 2 actions on example.com, 15 on the local hotel fixture.

The stepper daemon keeps that page: `observe` was 0.11 s after the `serve` client exited; `act TYPE_TEXT` / `SELECT` / `CLICK` on the hotel fixture were 0.17–0.27 s. `jev-ego flights` (space 25) finished in 31.6 s wall / 29.1 s decision clock — 11 actions, 15 TypeSafe decisions, 2 text-helper calls, 60 CDP — and passed the independent route/date/results checks. Numbers and the fixture directions table live in [`docs/performance.md`](docs/performance.md). Do not treat the upstream 7.1 s Chrome number as a jev-ego result.

A `DONE` choice still requires independent outcome verification. The DOM reader handles common HTML and ARIA controls, not the full accessible-name specification. Shadow roots, frames, canvas, uploads, pop-up tabs, nested scrolling, and arbitrary keyboard widgets remain outside this MVP.

## License

MIT. Policy, snapshot, and question text are derived from [jev-ultrafast](https://github.com/browser-use/jev-ultrafast) (MIT, Browser Use).
