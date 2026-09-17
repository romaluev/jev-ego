# Measurements

Timing starts after TaskSpace creation and initial navigation unless noted. Browser setup (`Emulation.setDeviceMetricsOverride`, `Emulation.setFocusEmulationEnabled`, `page.goto`) is outside the decision clock in a full agent run; the probe below includes the two emulation calls plus one snapshot.

`ego-browser 0.5.0.32`, Chromium 152, Profile 4. Keys: TypeSafe Jev + OpenRouter `inception/mercury-2.5`. Do not quote the upstream Chrome/Browser Harness 7.073 s Flights number as a jev-ego result.

## Offline

- `pnpm test`: 44 tests, 0 paid API calls
- `pnpm build`: `dist/jev-ego.mjs` 61.1 kb

## Live ego lite probes (no model)

Command: `jev-ego probe`.

| Page | Actions | CDP calls after goto | spaceId |
| --- | ---: | ---: | ---: |
| https://example.com/ | 2 | 3 | 14 |
| Local hotel fixture (`?scenario=travel`) | 15 | 3 | 15 |

The three protocol calls are viewport override, focus emulation, and one `Runtime.evaluate` snapshot. That is the observe-path target: one browser read for the whole element table.

Raw traces: `artifacts/probe/example/probe.json`, `artifacts/probe/fixture/probe.json` (gitignored).

## Agent stepper on the hotel fixture (space 23)

`jev-ego serve` then client commands against the loopback daemon. Wall times include HTTP + formatting. The client exited after `serve`; later commands hit the same space.

| Command | Wall | Notes |
| --- | ---: | --- |
| `serve --url <fixture>` | 1.46 s | TaskSpace open, first table |
| `observe` | 0.109 s | Cached snapshot, no CDP |
| `act TYPE_TEXT 4 "Lisbon"` | 0.169 s | Destination filled |
| `act SELECT 6:1` | 0.155 s | Category → Design |
| `act CLICK 5` | 0.266 s | Find stays |
| `goto https://example.com/` | 0.254 s | 1 link on the table |
| `goto <fixture>` | 0.250 s | Form reset |
| `suggest` | 0.986 s | 1 TypeSafe request, no click |
| `step` | 0.510 s | Jev clicked Free cancellation |
| `run --max-steps 8` | 1.241 s | DONE at `#casa-flora`, 23 CDP cumulative |
| `stop` | 0.122 s | Registry file removed |

`spaces` still listed space 23 after the `serve` client exited. After `stop`, `jev-ego spaces` printed `No running spaces.` and `~/.jev-ego/spaces/*.json` was gone.

`suggest` directions (`op_conf=0.87`):

```
0.71  CLICK 7  Free cancellation · on
0.09  CLICK 8  View Casa Flora
0.05  CLICK 5  Find stays
0.05  BLOCKED
0.04  DONE
0.04  CLICK 4  Destination
0.01  WAIT
0.01  TYPE_TEXT 4  Destination
```

The bounded `run` opened Casa Flora (`status=done`, `#casa-flora`). The page note still said `Destination anywhere` because `goto` had reset the form while session history kept earlier agent acts; that is not a smoke-test substitute.

Click, scroll, and native `<select>` mutate inside the guard `Runtime.evaluate`. Earlier Flights runs hung on ego-lite `Input.dispatchMouseEvent` (12–15 s); in-page click made fixture `CLICK` 0.27 s.

## Google Flights (space 25)

Command: `jev-ego flights`. Wall 31.64 s. Decision clock 29.135 s. 11 browser actions, 15 TypeSafe decisions, 2 text-helper calls, 60 CDP. Independent verification passed: search URL, One way, Zürich, London, Sun Sep 20, year in the `tfs` param, and three Sunday 20 September flight options.

| Step | Operation | Target | Jev ms | Text ms |
| ---: | --- | --- | ---: | ---: |
| 1 | CLICK | Change ticket type | 1146 | |
| 2 | CLICK | One way | 1195 | |
| 3 | TYPE_TEXT | Where from? → Zurich | 742 | 1234 |
| 4 | CLICK | Zürich, Switzerland | 757 | |
| 5 | TYPE_TEXT | Where to? → London | 287 | 1147 |
| 6 | CLICK | London, United Kingdom | 362 | |
| 7 | CLICK | Open Departure | 317 | |
| 8 | CLICK | Sunday, September 20, 2026 | 348 | |
| 9 | CLICK | Done. Search… | 323 | |
| 10 | CLICK | Search | 318 | |
| 11 | WAIT | | 304 | |

TypeSafe then chose WAIT twice more and DONE (`conf=0.98`, 375 ms). Text helper: `inception/mercury-2.5`. Trace: `artifacts/flights/latest/state.json` (gitignored).
