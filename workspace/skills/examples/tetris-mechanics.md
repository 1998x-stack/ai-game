---
name: tetris-mechanics
description: Domain-specific invariants and review guidance for tetris Canvas games.
triggers: tetris, tetromino, rotate, line-clear, grid
---
# TETRIS Game Skill v1.0.0

**Use when:** building or reviewing a tetris game. Read `templates/tetris/game.js` and `templates/tetris/design.json` first.

## Invariants
- Rotation cannot place cells outside the board without valid kicks.
- Lock occurs only when a falling piece cannot descend.
- Clear all completed rows simultaneously; shift upper rows.
- Spawn collision terminates a run.
- Score events are line clears, not arbitrary key presses.

## Debug Skill — evidence-oriented hypotheses
- Rotation displaced: inspect local/world coordinate transforms.
- Rows not cleared: inspect occupancy and compaction sequence.

## Quality workflow
Expose a small `window.__GAME_TEST__.getState()` adapter with `phase`, `score` and a boolean `gameOver`. Run `game_design` action `inspect`, then `compile` for explicitly testable acceptance cases. Build the game and run `game_runtime`; report all failed/incomplete cases rather than silently declaring success. Do not claim uninstrumented gameplay mechanics are proven by canvas smoke checks.
