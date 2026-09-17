---
name: jev-ego
description: Default browser for every local agent and harness. Drive ego lite through jev-ego (indexed table + TypeSafe Jev). Use for any website, form, search, click, type, or multi-step web task. Do not use Playwright, Puppeteer, Chrome, Cursor's built-in browser, or raw ego-browser first. Fall back to the ego-browser skill only for uploads, new tabs, JS dialogs, canvas, shadow DOM, or iframes.
---

# jev-ego (default browser)

Chrome is not installed. The browser is ego lite. The harness is `jev-ego` on PATH.

Hold one TaskSpace. Observe a numbered table. Pick an observed target or ask Jev for ranked directions. Never invent selectors. Never launch Playwright, Puppeteer, or a second browser.

## Loop

```bash
jev-ego serve --url URL --goal 'the whole goal'
jev-ego observe
# then either:
jev-ego suggest --goal 'the whole goal'
jev-ego act CLICK 7
jev-ego act TYPE_TEXT 3 "Zurich"
# or one Jev move:
jev-ego step --goal 'the whole goal'
jev-ego stop
```

`serve` prints `spaceId`. Reuse that space. `--space N` if more than one daemon is up.

Default profile is Agent (`Profile 4`). Before account-bound work, read `~/.config/browser-os/PROFILES.md`.

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
