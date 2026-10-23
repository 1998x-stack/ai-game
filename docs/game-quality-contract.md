# Game Quality Contract — Developer Guide

## Purpose
A contract stored at workspace root as `game.test.json` specifies a
bounded playtest: seeded initialization, simulated input, and assertions.
The current `game_runtime` tool automatically uses this contract when present.
Without it, the existing heuristic/AI-driven runner remains available.

This is influenced by OpenGame's engine-independent Game Skill and playability
evaluation, GameSmith's execution feedback, and OhMyGame's file-native
workspace design. No external code is copied.

## Input JSON
See `workspace/examples/game.test.json` for a schemaVersion 1 example.

Allowed actions:
- `{"type":"key","key":"ArrowUp"}` (optional `holdMs` of 1–3000)
- `{"type":"click","x":120,"y":200}`
- `{"type":"wait","ms":200}`

Assertions evaluate the final observation of each scenario:
- `canvas-size`: minimum intrinsic canvas width/height and visible CSS bounds
- `state-equals`: read-only scalar equality by key
- `state-changed`: compares baseline and final observable scalar values
- `game-over`: explicitly requires a boolean end-state
- `no-errors`: zero browser page exceptions or console errors

**Observability:** Expose an intentional, read-only game state adapter from
game.js, otherwise most ES module lexical variables are invisible to browser
automation:

```js
window.__GAME_TEST__ = {
  getState: () => ({ score, gameOver, lives, phase })
};
```

Do not expose API keys or user data here. Keys are top-level scalar names;
nested object graph traversal is intentionally unsupported in v1.

## Execution and evidence
1. Build a game with `build_game`.
2. Write the contract at `game.test.json`.
3. Run `game_runtime`. It uses fresh browser pages per scenario,
   seeded Math.random, blocked HTTP requests and bounded action plans.
4. Inspect the returned report path at
   `output/playtests/<run-id>.json`.
5. The report includes contract/game SHA-256, trace, checks, errors and status.

Only explicit contract assertions can establish a passing criterion.
A failed scenario fails the run; environmental failures produce **incomplete**
rather than a misleading pass. Missing state fields fail closed.

## Limits and next stages
- Seed covers Math.random only; not clock or asynchronous scheduling.
- Screenshot option stores one small JPEG on failing scenarios; it is not
  currently a visual-comparison or pixel-diff benchmark.
- A test plan is no substitute for exhaustive gameplay verification.
- Browser resource pools and network request interception are **not**
  operating-system security isolation. Never expose generated untrusted games
  to public multi-tenant hosting until dedicated container/VM workers exist.
- Snapshot artifacts are local. Durable indexed artifacts, replay UI,
  visual regression and automatic repair arrive in subsequent stages.
