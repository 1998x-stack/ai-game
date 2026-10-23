# Stage 4.0 — Isolated game verification and bounded jobs

## Architecture and security boundary

The Stage 2.1/2.2 declarative playtest contract remains the source of truth.
A production playtest is sent to an ephemeral **non-root Docker worker**.
The parent server writes only the built game HTML and validated test contract
to a private temporary input directory. The container mounts **only that
directory, readonly**, not the repository, user workspace, host Docker socket,
server secrets, Node process memory or Git credentials.

The container starts Chromium, intercepts the synthetic document route,
blocks other browser requests and executes bounded key/click/wait actions.
It writes one small JSON report to stdout. The host validates contract hash,
game hash, scenario IDs, assertion metadata and result consistency *before*
saving evidence in output/playtests/<run-uuid>.json.

### Production fail-closed configuration

Set AI_GAME_SANDBOX_MODE=required and
AI_GAME_SANDBOX_IMAGE=sha256:<64 hex digits> (local Docker image ID) or
<registry/repository>@sha256:<digest> (immutable repository digest).
Mutable tags are rejected. The selected image MUST already exist locally:
docker run uses --pull=never. Build, inspect and review the image separately
before assigning its SHA; never pull unreviewed images during a test request.

Without an immutable image, a required playtest fails rather than falling back
to the host Playwright pool. Production NODE_ENV=production always rejects
AI_GAME_SANDBOX_MODE=development-only. Development/test without explicit
isolation keeps the previous host runner for backward compatibility and is
**not safe for untrusted game code**.

Build example for Ubuntu operators:
  docker build -f sandbox/Dockerfile -t ai-game-sandbox:stage4 .
  docker image inspect --format '{{.Id}}' ai-game-sandbox:stage4

The Dockerfile includes the Playwright v1.60.0 browser/runtime match and
npm ci --omit=dev; for production, re-pin/rebuild/review base image by digest.
Image tags in Dockerfile are build-time inputs, not runtime mutable image
selection. Docker daemon access is privileged: only server administrators
should run this backend, on dedicated sandbox hosts.

### Required container restrictions

- --network=none, no external ports or DNS; intercepted test document is in
  memory, not a real outbound HTTP server.
- non-root UID:GID 10001:10001 and --cap-drop=ALL.
- --read-only filesystem plus bounded /tmp tmpfs; read-only input mount.
- no-new-privileges, pids limit 96, memory/swap 768m, 1 CPU, shm 128m.
- 40s host watchdog, 25s worker playtest budget, bounded stdout/stderr,
  one JSON protocol result, run-specific container ID and explicit cleanup.
- No --privileged, --ipc=host, host filesystem mount, Docker socket, environment
  with LLM keys, privileged container service or auto-image pull.

The Playwright base image is a development/testing image, **not** a hardened
multi-tenant container sandbox. Docker isolation alone is not sufficient
for arbitrarily hostile public uploads. Chromium's sandbox is not guaranteed
to be enabled in all Docker configurations. Deploy only to explicitly
trusted test environments until kernel, user namespaces, seccomp/AppArmor,
nonroot daemon/rootless, audit and vulnerability hardening are reviewed.

## API and job lifecycle

POST /api/sandbox-jobs/:sessionId
  Creates a bounded test job from the project's existing output/index.html
  and game.test.json (no arbitrary file paths). HTTP 202 includes job UUID.

GET /api/sandbox-jobs/:sessionId?id=<UUID>
  Retrieves status from output/sandbox-jobs/<UUID>.json (no-store).

DELETE /api/sandbox-jobs/:sessionId?id=<UUID>
  Requests cancellation. The running Docker CLI receives termination and
  a separate docker rm -f removes a named container if needed.

Each request requires a session capability; mutations require same-origin
Origin/Host matching. Jobs have queued, running, succeeded, failed,
cancelled and interrupted states. At most 2 concurrent containers and
12 queued jobs, with one active job per workspace. Receipts are atomically
written and persist across restarts. Running/queued receipts without an
in-memory owner are marked INTERRUPTED and **not replayed automatically**.

This is a single Node-process in-memory queue with durable status receipts,
not a Redis/Kafka database-backed distributed scheduler. Cross-worker
coordination, global fairness and retained cancellation across restarts are
still future work.

## Existing flow integration

- Stage 2.3 Agent Loop testing now dispatches through the isolated wrapper,
  which defaults to REQUIRED in production.
- game_runtime with machine-verifiable game.test.json also uses the wrapper.
- When isolation is required, the legacy heuristic game_runtime path is
  blocked because it executes code directly in the host browser process.
- Trusted local tests remain available for development only and emit
  isolated:false in the wrapper response.
- Preview iframe and AI code generation remain separate user-facing risks.
  They are not Docker-sandboxed just because playtesting is isolated.
- This stage does not publish games or bypass human approval.

## Acceptance tests

- Production mode cannot silently run without image digest.
- Docker command argument allowlist and mounted directories are unit-tested.
- Forged hashes, missing/changed assertions, contradictory pass states and
  cancellation are rejected before evidence commit.
- Queue success, cancellation, one-job-per-workspace and crash recovery.
- Real Docker + Chromium acceptance in CI, in addition to existing local
  Chromium regressions, TypeScript/Lint/unit/production build.

## Next stage

Stage 4.1: signed/offline image supply chain and CVE updates, reproducible
Docker builds, rootless daemon and hardened seccomp profile, object-store
evidence, distributed leased job queue and cancellation reconciliation.
