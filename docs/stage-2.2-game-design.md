# Stage 2.2 — Game Design Document, Registry and Domain Skills

## Overview

Every game can have a versioned `game.design.json` that specifies its
genre, state transitions, player controls, mechanics and acceptance criteria.
The canonical validator is `lib/game-design/gdd.ts`; the accompanying
`game-design.schema.json` is a JSON Schema 2020-12 reference for editors.
Cross-reference constraints (mechanic existence, transition state/event validity,
unique (from,event) pairs, total 100-action budget) are validated in code.

**This stage is explicitly bounded to the existing four Canvas genres.**
No arbitrary skill ID can be executed; skills are read-only Markdown instructions.

## File locations

- `workspace/templates/<genre>/design.json` — immutable shipped starter GDD.
- `workspace/templates/<genre>/game.js` — versioned reference game implementation.
- `workspace/skills/examples/<genre>-mechanics.md` — domain Game Skill.
- `game.design.json` — editable project GDD, in the workspace root.
- `game.test.json` — compiled executable acceptance cases, Stage 2.1.
- `output/playtests/<UUID>.json` — scenario action trace and diagnostics source.

## Agent workflow

1. Call `game_design({action:'templates'})` for four registered games.
2. Call `game_design({action:'templates',genre:'snake'})` to inspect
   the versioned registry entry and its content hash.
3. Read `templates/snake/game.js` and
   `skills/examples/snake-mechanics.md`. Copy and edit
   `templates/snake/design.json` into `game.design.json`.
4. Call `game_design({action:'inspect'})`. Fix invalid references and
   review unreachable states and uncovered mechanics.
5. Call `game_design({action:'compile'})` to emit a bounded
   `game.test.json`. Existing test files are **never overwritten**.
6. Implement game code in `scripts/game.js`, expose:
   `window.__GAME_TEST__ = { getState: () => ({ phase, score, gameOver }) };`
   (only intentionally safe scalar fields).
7. Call `build_game`, then `game_runtime`.
8. When a report fails, call
   `game_design({action:'diagnose',reportId:'<UUID>'})` to view
   evidence-linked, ordered diagnostics; inspect and fix code manually.

## Limits and semantics

- GDD schemaVersion: 1. Template version: 1.0.0. Max 64 KB JSON.
- All controls map to allowlisted keyboard keys only; events use state-machine IDs.
- Max 16 mechanics, 12 controls, 16 states, 32 transitions, 16 requirements.
- Max 8 automated scenarios and 100 actions. Test contracts keep Stage 2.1
  caps: max 40 actions and 16 assertions per scenario.
- At least one acceptance item is required. A GDD may be **manual-only**;
  compile then returns `not-compiled` instead of fake success.
- Each automated case maps 1:1 to a deterministic test scenario;
  coverage links requirement ID to scenario ID. Unknown mechanics and
  mismatched action schema are rejected, not heuristically repaired.
- A manual item must have a review rationale; no executable assertion is
  emitted. The coverage report separately lists manual and uncovered items.
- Diagnose accepts UUID-identified report artifacts only, with bounded JSON
  and basic structural validation. Diagnostic suggestions are hypotheses,
  not automatic repairs.
- Source GDDs and reports remain project-local and file-native; the Stage 3
  design canvas will project these assets visually.

## Version compatibility and migration

Existing games without a GDD still build and use Stage 2.1 or legacy probing.
Enabling GDD requires explicit user/Agent creation of the project-local file.
Template registry refuses unknown genres; adding an engine or genre requires
a code-reviewed registry change, schema update and integration tests.
A change in accepted schema or template semantics requires a new version;
never silently reinterpret an old GDD.

## Remaining unimplemented

General genre inference, LLM-generated GDD from natural language,
nested-state assertions, deterministic time/physics injection, constrained
board fixtures for 2048/Tetris, agent-driven code repair, visual editor,
artifact indexing and OS-level sandboxing are **not included** in Stage 2.2.
