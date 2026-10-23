# Stage 2.3: Durable Bounded Game Repair Loop

## Architecture

Opt-in workflow, separate from the conversational DeepSeekAgent:
user goal -> validated Stage 2.2 GDD -> model-generated game.js -> build ->
Stage 2.1 Playwright -> review -> bounded repair or human approval.

This is one durable stage per tool call; it is not an indefinite in-process
background job. Each transition saves a local checkpoint atomically.

| Phase | Action | Next |
| --- | --- | --- |
| planning | Compile GDD acceptance and fingerprint contract | generating |
| generating | Reserve model call before request; produce complete JS; syntax check | building or reviewing |
| building | Build Canvas game and retain error details | testing or reviewing |
| testing | Rebuild for restart safety, run actual browser test, verify digest | reviewing |
| reviewing | Evaluate independent evidence | awaiting-approval / repairing / needs-human |
| repairing | Bounded retry informed by failure details | generating |
| awaiting-approval | No automatic publishing or approval | accepted or cancelled by user |
| accepted / needs-human / cancelled | Terminal | new run only after appropriate review |

## Agent workflow

Call game_loop with action=start, goal, optional maxAttempts/tokenBudget/durationMinutes.
Then call game_loop with action=advance once per stage until next is not advance.
Use action=status for checkpoint inspection. The model's developer request
has no tools: it can only propose one full scripts/game.js. No write to
game.design.json, test contract, credentials or other workspace source.
Versioned GDD must include executable acceptance requirements; max 2 scenarios,
12 actions per scenario, and 6 seconds cumulative waits.

## Human approval

Authenticated project owner may GET /api/game-loop/<sessionId> for state.
POST /api/game-loop/<sessionId> with JSON {"action":"approve"} or
{"action":"cancel"} and same-origin Origin header.
Both operations require the session capability. The model's tool does NOT
expose approval or cancellation. Approval requires passed independent tests.
Cancel restores the original game.js only when both baseline and active
source hashes match expectations; external changes force human reconciliation.

## Durability

Local output/agent-loop/state.json records phase, attempt count, call budget,
content digests, report path, and a short event trail. The original source is
stored privately in output/agent-loop/baseline-game.js, excluded from git.
State files are atomically replaced. A model invocation is reserved before
calling an API; if generation is interrupted, the run stops for human review
rather than silently repeating a potentially chargeable request.

## Bounds and release risks

1 to 3 generation attempts, 1k to 20k tokens, 1 to 10 minute deadline.
Default: 2 attempts, 8k tokens, 5 minutes. Model request timeout 12 seconds,
zero API retries. Missing token usage is conservatively estimated.
Maximum generated JS 120 KB. Reject malformed sources and stale GDDs.
Incomplete test infrastructure leads to needs-human, not guessed game bugs.
The runner has only a per-process mutex; multi-worker distributed locks,
strict OS sandbox isolation, billing and full automatic publishing are not
implemented. Browser request interception does NOT isolate untrusted code
at the operating-system level. Run only in trusted single-user environments.
