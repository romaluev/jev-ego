---
name: jev-ego
description: Drive ego lite through a persistent jev-ego stepper — indexed element table, Jev-ranked directions, and one-command clicks or typing. Use for goal-directed multi-step web tasks (search, forms, filters, flights, Wikipedia). Do not use for uploads, new tabs, dialogs, canvas, shadow DOM, or iframes; those stay on the ego-browser skill.
---

# jev-ego stepper

Hold one TaskSpace. Observe a numbered table. Either pick an observed target yourself or ask Jev for ranked directions. Never invent selectors.

## Loop

```bash
pnpm exec jev-ego serve --url URL --goal 'the whole goal'
pnpm exec jev-ego observe
# then either:
pnpm exec jev-ego suggest --goal 'the whole goal'
pnpm exec jev-ego act CLICK 7
pnpm exec jev-ego act TYPE_TEXT 3 "Zurich"
# or one Jev move:
pnpm exec jev-ego step --goal 'the whole goal'
pnpm exec jev-ego stop
```

`serve` prints `spaceId`. Reuse that space. `--space N` if more than one daemon is up.

## Table

```
[1] combobox  Where from? · San Francisco  ops=C/T
```

`ops=C/T/S` means CLICK / TYPE_TEXT / SELECT. SELECT options are listed as `1:2`. Only those indices may be acted on.

## Choose

- `suggest` is one TypeSafe request and does not click. Read joint probabilities; consume only the selected operation's target if you auto-follow Jev.
- `act` is you choosing. `TYPE_TEXT` always takes the string you pass; it does not call the text helper.
- `step` lets Jev choose and execute. If it picks TYPE_TEXT and `TEXT_MODEL_API_KEY` is missing, it stops and you supply text with `act`.
- `run --goal TEXT --max-steps K` is bounded autopilot on the open space.

## Stop

`jev-ego stop` finishes the TaskSpace. Do not leave daemons running after the goal is done or blocked.

## Fall back to ego-browser

Uploads, pop-up tabs, JS dialogs, canvas, shadow roots, iframes, and anything outside the numbered table. Keep the same spaceId if you already opened one; otherwise use the ego-browser skill on Profile 4 (Agent) unless the user named another rail.
