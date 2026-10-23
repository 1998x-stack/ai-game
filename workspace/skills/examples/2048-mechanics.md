---
name: 2048-mechanics
description: Domain-specific invariants and review guidance for 2048 Canvas games.
triggers: 2048, tiles, merge, undo, board, slide
---
# 2048 Game Skill v1.0.0

**Use when:** building or reviewing a 2048 game. Read `templates/2048/game.js` and `templates/2048/design.json` first.

## Invariants
- Each tile merges at most once per move.
- Moves that do not change the board cannot spawn a tile.
- No cell may hold two tiles.
- Lose only when no possible move remains.
- Undo restores board and score together.

## Debug Skill — evidence-oriented hypotheses
- Repeated merging: check compact/merge/compact logic.
- Premature loss: check empty cells and adjacent pairs.

## Quality workflow
Expose a small `window.__GAME_TEST__.getState()` adapter with `phase`, `score` and a boolean `gameOver`. Run `game_design` action `inspect`, then `compile` for explicitly testable acceptance cases. Build the game and run `game_runtime`; report all failed/incomplete cases rather than silently declaring success. Do not claim uninstrumented gameplay mechanics are proven by canvas smoke checks.
