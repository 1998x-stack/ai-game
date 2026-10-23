---
name: breakout-mechanics
description: Domain-specific invariants and review guidance for breakout Canvas games.
triggers: breakout, paddle, brick, ball, bounce, lives
---
# BREAKOUT Game Skill v1.0.0

**Use when:** building or reviewing a breakout game. Read `templates/breakout/game.js` and `templates/breakout/design.json` first.

## Invariants
- Collision includes ball radius and approach direction.
- Avoid repeated bounces while a ball remains penetrating a collider.
- Constrain the paddle within canvas bounds.
- Each brick hit removes one brick and updates score once.
- Missed balls decrement lives and can end the run.

## Debug Skill — evidence-oriented hypotheses
- Ball tunneling: inspect fixed time step and continuous collision detection.
- Double scoring: check single-contact event deduplication.

## Quality workflow
Expose a small `window.__GAME_TEST__.getState()` adapter with `phase`, `score` and a boolean `gameOver`. Run `game_design` action `inspect`, then `compile` for explicitly testable acceptance cases. Build the game and run `game_runtime`; report all failed/incomplete cases rather than silently declaring success. Do not claim uninstrumented gameplay mechanics are proven by canvas smoke checks.
