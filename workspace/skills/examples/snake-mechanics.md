---
name: snake-mechanics
description: Domain-specific invariants and review guidance for snake Canvas games.
triggers: snake, food, collision, turn, grid, score
---
# SNAKE Game Skill v1.0.0

**Use when:** building or reviewing a snake game. Read `templates/snake/game.js` and `templates/snake/design.json` first.

## Invariants
- Grid coordinates must be integer cells and the head appears only once.
- Disallow immediate 180-degree reversal, including buffered inputs.
- Self-collision ignores the departing tail on ordinary movement.
- Food can spawn only on free grid cells; a full board terminates.
- Score changes on food pickup, not every frame.

## Debug Skill — evidence-oriented hypotheses
- Movement frozen: check dt accumulator and InputManager.endFrame().
- False collision: inspect tail-vacation special case.

## Quality workflow
Expose a small `window.__GAME_TEST__.getState()` adapter with `phase`, `score` and a boolean `gameOver`. Run `game_design` action `inspect`, then `compile` for explicitly testable acceptance cases. Build the game and run `game_runtime`; report all failed/incomplete cases rather than silently declaring success. Do not claim uninstrumented gameplay mechanics are proven by canvas smoke checks.
