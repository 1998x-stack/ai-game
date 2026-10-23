# AI Game Studio: Architecture Audit & Refactor Roadmap (2026-10-23)

Baseline: main `7292e7727ad45899ccd997e52a4a5882908d01e7`. Work happens on `refactor/v2.0`; main remains untouched pending review.

## Product positioning

AI Game Studio turns natural language into standalone HTML5 Canvas games. It is **not** an RL training environment. Today's stack is Next.js 14, React 18, DeepSeek adapter, JSONL session persistence, file-based workspaces, HTML packager, Playwright runtime checks, and GitHub publishing.

## Comparable open-source systems and takeaways

| Project | What to study | What not to copy blindly |
| --- | --- | --- |
| [OpenGame](https://github.com/leigest519/OpenGame) | Game Skill, verified debugging, playability benchmark (build + visuals + intent) | Specialized model and large benchmark requirements |
| [GameSmith](https://github.com/AbdulHannan031/gamesmith-ai-game-generator) | Agent screenshot/playtest feedback, Canvas game workflow | Hosted arcade assumptions |
| [OhMyGame](https://github.com/WhiteTowerAI/ohmygame) | Unified visual workspace, assets, extensible model runtime | Desktop-first complexity |
| [AI Game Builder](https://github.com/Nishant-neural/AI-game-builder) | Game design document intermediate representation, repair loop, failure memory | Hard commitment to Phaser |
| [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | Diff review, undo/checkpoint, sandboxed preview, multiple model adapters | Commercial WebContainer licensing |
| [OpenHands](https://github.com/OpenHands/openhands) | Separate agent orchestration from tool execution and trust boundary | Heavy multi-container infrastructure |

## Verified issues in baseline

1. In-memory workspace registration eviction calls `deleteWorkspace`, which permanently removes files. An idle cleanup does the same after one hour; this conflicts with documented session restoration.
2. Session JSONL treats matching message content as a duplicate; a repeated user turn is lost when restored.
3. Each append scans the whole JSONL file, making large sessions increasingly expensive.
4. The path validator checks only an existing file or immediate parent. Deeply nested new paths fail even when safe.
5. Capability cookie comparison throws for mismatched byte lengths.
6. Browser pool and playtesting need concurrency, timeout, cancellation, cleanup and evaluation isolation tests. These are follow-up risks, not claimed fixed here.
7. The README's hardcoded tool/test counts may drift from source. Generate verified status from CI rather than self-declared badges.

## v2.0 implemented in this branch

- **Non-destructive workspace registration:** capacity and stale cleanup evict metadata only, never project files. Explicit `deleteWorkspace` remains destructive.
- **Safe partial-project restoration:** the project scaffold can exist before game.js; restarts do not overwrite work in progress.
- **Append-only event snapshot semantics:** duplicate messages in different turns persist, divergences are rejected, sequence IDs are monotonic, and `stat` avoids rereading whole JSONL on every append. Single-process file persistence is **not** a multi-node transaction store.
- **Filesystem validation:** find the nearest existing ancestor, resolve symlinks, prohibit write-through symbolic links and traversal.
- **Capability hardening:** reject malformed signed cookies without a timing-safe length exception.
- **CI and regression tests:** Node 22, npm ci, typecheck, lint, tests, production build; lifecycle, repeated-message and deep-path tests.

## Proposed phased evolution (not yet implemented)

### v2.1: Reliability
- Add browser-pool acquisition deadlines, fair queueing, abort propagation, resource quotas and isolated browser contexts.
- Add game runtime assertions on keyboard/touch events, score trajectory, restart, win/lose and screenshot diffs; replace false-positive heuristics with per-game test plans.
- Introduce immutable build artifacts, manifest SHA-256, build history, rollback and reproducible game seeds.
- Add execution budgets: model tokens, tool calls, tool output length, build/runtime time, concurrency.

### v2.2: Agent architecture
- Separate `ModelProvider`, `AgentRunner`, `ToolExecutor`, `WorkspaceRepository`, `BuildService`, `PlaytestService` interfaces.
- Formal Game Design Document (GDD) schema: genre, mechanics, state machine, controls, win/loss, art direction, performance target, acceptance tests.
- Build -> static verify -> playtest -> evaluate -> repair, with retry limits and evidence-based promotion; event-sourced traces and checkpoints.
- Allow configurable providers via explicit allowlist and credential handling; do **not** accept arbitrary outbound base URLs.

### v3.0: Sandbox and collaboration
- Isolate untrusted generated code in containers/VMs with CPU/memory/time/network limits, read-only host mount and per-project storage; iframe sandbox alone is **not** an OS sandbox.
- Durable database metadata plus object storage; per-user auth, project ownership, resource quotas, migration scripts, backup and recovery.
- Editor panels for code diffs, build history, game design, assets and playtest replay; accessibility and responsive UI.
- Multi-tenant actions require authorization beyond a secret session URL and cookie.

### v4.0: Game quality benchmark
- A gold set spanning Snake, Tetris, platformers, shooters and puzzle games.
- Metrics: compile/build success, first-input response, frame rate distribution, restart correctness, end-state coverage, visual comparison, instruction coverage, regression rate, time/cost per playable game.
- Compare AI-generated games with deterministic templates; report confidence intervals and failure taxonomy.

## Deployment notes

Run `npm ci && npm run typecheck && npm test && npm run build` on Node 22. For local development, `npm run dev`; configure a strong `AI_GAME_SESSION_SECRET` in production. Install Playwright Chromium separately for browser-driven playtesting. Deploy the full Next.js server on a persistent filesystem; **the repo's GitHub Pages action publishes only the static landing page from `assets/`**. Do not assume it deploys the interactive studio.

Security boundary: the current filesystem validation is defense in depth, **not a guarantee** against time-of-check/time-of-use races or untrusted code execution. The production multi-user system requires OS-level sandboxing and durable authorization.
