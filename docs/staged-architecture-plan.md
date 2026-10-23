# AI Game Studio: Staged Architecture, Integration Plan and Acceptance Gates
Baseline: Stage 1 reliability changes on main (#1), browser-pool refactor on refactor/v2.0 (#2).
Stage 2.1 work branch: stage/2.1-game-quality (stacked on refactor/v2.0).
This plan is design; rows labeled "planned" are NOT implemented features.

## Vision and positioning

Natural language -> structured design -> safe game workspace -> playable build ->
instrumented playtest -> evidence-backed repair -> preview/rollback/publish.

This is a web-game engineering studio, not an RL platform. Preserve the original
lightweight Next.js + Canvas stack as the default while supporting engine
adapters and an interactive asset canvas in later, opt-in stages.

Sources and decisions:
- OpenGame: reuse design of evolving Template/Debug Skills, and distinguish
  build health, visual usability and intent alignment instead of reducing quality
  to whether JavaScript loads. https://github.com/leigest519/OpenGame
- GameSmith: integrate execution feedback into development iterations.
  https://github.com/AbdulHannan031/gamesmith-ai-game-generator
- OhMyGame: represent design documents, graph nodes, code and assets with
  shared file-native identities, so both human and Agent can edit them.
  https://github.com/WhiteTowerAI/ohmygame
- Reference techniques; no copied source or unreviewed runtime dependencies.

## Stage roadmap and acceptance

| Stage | Status | Scope | Acceptance gate | Dependencies |
| --- | --- | --- | --- | --- |
| 1.0 Reliability | Landed on main (#1) | Workspace lifecycle, session persistence, capability/path checks, CI | Restarts preserve source; tests and build green | None |
| 1.1 Browser pool | Draft PR #2 | Capacity reservation, timeouts, shutdown behavior | Parallel acquisition never overbooks; 114+ tests and build green | 1.0 |
| 2.1 Game Quality Foundation | THIS BRANCH | Strict JSON contract, testable game-state hook, deterministic seeded keyboard/click/wait playtest, fail-closed assertions, local SHA-256 evidence, real browser smoke | Types + unit tests + Chromium smoke; wrong/missing state fails; test repeat yields same trace | 1.1 |
| 2.2 Domain Game Skill | Implemented on stage/2.2-game-design-skills; pending review | GDD JSON Schema, genres, mechanics FSM, template registry, Debug Skill troubleshooting rules | Snake/Tetris/Breakout template GDDs, contract coverage matrix, no copy/paste utilities | 2.1 |
| 2.3 Agent Loop | Planned | Planner/Coder/Tester/Reviewer tool roles, code-diff review, replay-based repair, model-agnostic budget/cancel/checkpoint | Bounded retries, predictable rollback, trace links from failed assertion to fix | 2.1 + 2.2 |
| 3.0 Design Canvas MVP | Planned | File-native board, stable IDs, document+asset nodes, preview/coding split panels, undo & redo, autosave conflict detection | Round-trip file -> UI -> Agent -> file with stable IDs and undo | 2.2 |
| 3.1 Media Pipeline | Planned | 2D asset catalog, sprite/audio normalization, metadata and provenance, no forced proprietary model | Import/reuse/export works without LLM; hash dedup and rights metadata | 3.0 |
| 4.0 Secure Execution | Planned | Dedicated sandbox worker/VM, no host mounts, network policy, CPU/RAM/time limits, artifact transport | Untrusted game cannot reach host files/metadata; resource exhaustion isolated | 2.3 |
| 4.1 Persistent Platform | Planned | User/project ownership, PostgreSQL/SQLite migration path, object storage, durable job queue and audit | Restart, migration, quota and concurrent-user tests; backups verified | 4.0 |
| 5.0 Quality Benchmark | Planned | Golden prompts, build/visual/intent/playability evaluations, screenshot diff baselines, frame-time tests | Reproducible baseline and regression dashboard, false-positive analysis | 2.1 + 4.0 |
| 5.1 Publishing | Planned | Immutable build artifacts, provenance, staging/prod promotion, rollback, GitHub Pages and standalone export | Binary reproducibility where achievable, rollbacks and publish smoke | 4.1 |
| 6.0 Extensibility | Planned | SDK for game engines/model providers/tool skills, plugin permissions, opt-in collaboration | Plugins tested in isolated fixtures, no unsafe network/tools by default | 4.1 + 5.1 |

## Stage 2.1 module boundaries

1. lib/runtime/game-contract.ts: input schema / allowlists / bounded actions.
2. lib/runtime/quality-evaluator.ts: pure assertions and tri-state status.
3. lib/runtime/quality-runner.ts: isolated scenario browser pages, seeded RNG,
   observable state extraction, action trace and on-disk JSON evidence.
4. lib/agent/tools.ts: game_runtime checks game.test.json then calls contract
   runner; legacy scenario system kept for compatibility.
5. workspace/agent.md + docs/game-quality-contract.md: prompt contract
   instructing Agent to expose window.__GAME_TEST__.getState().
6. __tests__: parser, evaluator, mocked error modes, real Chromium smoke,
   CI typecheck/lint/unit/build.

Strict boundaries: no JSON-provided JavaScript, no arbitrary selectors, no HTTP
requests during contract playtest, maximum 8 scenarios and 100 actions, maximum
64KB contract, fixed viewport bounds and one JSON report per run. Game-owned
probe returns only small scalar fields; never expose credentials.

## Evaluation semantics

**passed**: all scenarios completed, all declared assertions pass, no page
exceptions or browser console errors.

**failed**: at least one completed scenario has an assertion failure or page
exception; report exact evidence.

**incomplete**: browser unavailable, timeout, input failure, or any scenario
unable to finish; never count as passed. Where some scenarios failed and
others incomplete, overall status is failed but scenario status remains visible.

No blanket assumption that score must increase or the game must end; those are
genre-dependent assertions requested by the GDD.

## Future engine adapter interfaces

- GameDesignDocument: genre, player action vocabulary, scenes, entities,
  state machine, win/lose, dimensions, accessibility and acceptance rules.
- GameEngineAdapter: scaffold, build, preview, captureState, performAction.
- ModelProvider: generate, stream, tool calling, pricing/token telemetry,
  context limits, cancellation, allowlisted endpoints.
- PlaytestService: contract -> action trace -> assertions -> screenshots.
- ArtifactRepository: immutable build ID, input tree hash, Git commit, schema,
  report, screenshots, retention and rollback.
- WorkspaceRepository: project namespace and ACL enforced at the worker edge.

## Recommended UI information architecture

Left: conversation, live plan, evidence stream and patch approvals.
Center: Game Preview, Design Canvas, Code Diff, scene/state timeline.
Right: Assets, Playtest Report, Issue List, Versions and publish controls.
Small screens: tabs rather than fixed multi-column layout. A canvas file model
comes first; UI components are projections, not another source of truth.

## Nonfunctional and security gates

- Test determinism: same seed and game code should produce same assertions and
  action trace for deterministic examples; annotate unreproducible timers.
- Quality budget: track generation latency, token cost, CPU/frame time; set
  actual SLO after collecting representative baseline samples.
- Security: iframe and BrowserPool do not isolate processes. Dedicated sandbox
  workers are required before arbitrary uploaded/generated code can be used by
  multiple untrusted users.
- Failure isolation: all code-generation and playtest tasks must have deadlines,
  cancellation and bounded retries. Use explicit failure taxonomy.
- Credentials: user keys do not appear in generated game sources, browser state
  probes, report artifacts, logs or prompt examples.
- Release: never merge a draft stage to main before its base stage is merged
  and full CI passes on the eventual target branch.

## Definition of done

A Stage is only complete when it has (1) reviewed design and file/API contract,
(2) implemented code, (3) deterministic unit tests, (4) targeted integration
tests, (5) CI evidence, (6) migration/fallback documentation, and
(7) an explicit list of deferred features and risks.
