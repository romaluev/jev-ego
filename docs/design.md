# Dynamic operation + target on ego lite

The input is a natural-language goal. Every page observation builds an indexed table of accessible elements and their current values. One node receives one index, even when it supports both clicking and typing.

One TypeSafe request asks which operation to perform and which target would be appropriate for each available operation. The executor consumes only the target head corresponding to the selected operation. This avoids serial operation-then-target calls and rejects targets incompatible with the operation. Dropdown targets include a code-owned option index.

TYPE_TEXT sends the goal, selected field, visible page context, and recent actions to a small LLM. Its JSON must contain exactly one valid `text` value. A value can be reused after a stale decision only while the entire helper input is identical, and is discarded after a successful mutation.

## Runtime

`bin/jev-ego.mjs` runs on system Node: it loads `.env` and parses the command. One-shot commands (`run --url`, `flights`, `smoke`, `probe`) spawn `ego-browser nodejs` and pipe a bootstrap line plus the bundled `dist/jev-ego.mjs`. Agent commands (`serve`, `observe`, `act`, `suggest`, `step`, `goto`, `stop`) talk to a long-lived daemon.

`jev-ego serve` starts that daemon detached. Inside ego-browser, `src/server.ts` binds `127.0.0.1:0`, requires `X-Jev-Token` and Host `127.0.0.1`, and writes `~/.jev-ego/spaces/<spaceId>.json` `{ port, token, pid, url, goal, startedAt }`. A heartbeat timer keeps the event loop alive after the client exits. `stop` calls `task.finish`, deletes the registry file, and exits.

`Session` serializes commands (HTTP 409 if a step is already running). Jev-chosen and agent-chosen moves share `Agent.execute()` so freshness guards, history-before-observe, pending text, and the no-progress stop stay one path. `rankDirections` multiplies `P(operation) * P(target|operation)` from the raw TypeSafe answers.

`act TYPE_TEXT` never calls the text helper; the agent supplies the string. `step` / `run` call the helper only when `TEXT_MODEL_API_KEY` is set.

ego-browser's embedded Node starts with `cwd` `/`. Arguments therefore travel as `globalThis.__jevArgs`, and the bundle must not rely on relative filesystem imports. esbuild emits a single ESM file; Node builtins stay external.

The agent opens one TaskSpace on the requested profile (default `Profile 4`), prints `spaceId`, sets a 1120×780 viewport, and enables focus emulation so background animation frames keep running. Navigation uses `page.goto`. Success calls `task.finish({ keep: [] })`, or `keep: ["p1"]` with `--keep-open`. Errors leave the space open for inspection.

Browser-side identity uses a WeakMap of actual DOM nodes, as in the upstream snapshot. These IDs are not CDP backend node IDs. Geometry is always read again immediately before input.

## Merged protocol calls

Upstream Python talks to a Browser Harness daemon. Each `Runtime.evaluate` is a separate process hop. jev-ego keeps a live `page.cdp` session and merges the hottest pairs:

1. **Guard + geometry + click/scroll/select.** `src/browser-side/guard.ts` checks semantic freshness and, in the same evaluation, hit-tests the target, then clicks, scrolls, or mutates a native `<select>`. A stale or covered target returns a status; no `Input.*` event is sent. `TYPE_TEXT` still focuses in that evaluate and then uses `Input.insertText`.
2. **Settle + observe.** After a mutation, `src/browser-side/settle.ts` waits two animation frames / 50 ms, or up to 200 ms for a combobox option list, then runs the snapshot. Retries while `document.body` is missing stay inside that one awaited evaluation.

Hot-path evaluation uses `page.cdp("Runtime.evaluate", { returnByValue, awaitPromise })` so `exceptionDetails` can become `StalePage` or, for a native select whose change event may already have fired, `DropdownInterrupted`. Mutations are never retried.

Fingerprints hash URL, visible text, actions, and scroll. Screenshots and current rectangles are excluded.

## Boundaries

Sixty browser actions and 120 decision requests bound a run. Up to 250 action candidates are retained; truncated candidates cannot be selected. Credentials remain in the environment of the launcher process. Tabs use the selected ego lite profile.

The policy is generic. Name resolution covers common labels, ARIA references, and text; it is not the browser's full accessibility algorithm. Shadow roots, frames, canvas, uploads, nested scrolling, pop-ups, and complex keyboard interactions can block progress. Independent checks, rather than the model's DONE choice, determine whether a demonstrated task succeeded.
