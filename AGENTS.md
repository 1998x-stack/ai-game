# AGENTS.md — AI Game Studio

## Quick Reference

```bash
npm run dev       # next dev (port 3000)
npm test          # vitest run (__tests__/api.test.ts)
npm run lint      # next lint
npm run build     # production build
./start.sh        # rm -rf .next && npm run dev (always use after build)
```

## Architecture

| Layer | Location | Role |
|-------|----------|------|
| Chat UI | `app/`, `components/` | Next.js App Router, client-only (dynamic import, SSR-off) |
| Agent pipeline | `lib/agent/` | Factory → DeepSeek adapter (OpenAI-compatible SDK) |
| Game scaffold | `workspace/` | Docs, templates, utils for game-generating agents |
| Runtime sessions | `user_space/{uuid}/` | Gitignored. HMR wipes in-memory Map; files persist on disk. |

**Central config**: `lib/config.ts` — all magic numbers, timeouts, and allowlists. Import from here, don't hardcode.
**Domain concepts**: `CONTEXT.md`. **Developer gotchas**: `DEVELOPMENT.md`.

## Critical Don'ts

- **`page.tsx` must use `dynamic(() => import('./HomeContent'), { ssr: false })`** — never `Promise.resolve`. Browser APIs (`crypto`, `localStorage`) can't SSR.
- **NEVER add `allow-same-origin` to the iframe sandbox** — exposes parent DOM including API key. `postMessage` works cross-origin. Validate messages via `event.source !== iframeRef.current?.contentWindow` — NOT `event.origin` (iframe origin is `null` without `allow-same-origin`).
- **NEVER dynamic-import the packager** (`await import('@/lib/build/packager')`) — routes through Next.js webpack, fails on stale `.next`. Always `import { buildGame } from '@/lib/build/packager'` at top level.
- **Canvas ID is always `gameCanvas`** — scaffold docs, templates, and packager all depend on this.
- **Agent MUST NOT redeclare scaffold utilities** — `GameLoop`, `InputManager`, `CollisionDetector`, `Vector2`, `Camera`, `Timer`, `setupCanvas`, `randomInt`, `clamp`, `lerp`, `distance`, etc. are pre-loaded in the same module scope.
- **Module scripts, never IIFE** — packager uses `<script type="module">`. `export` inside IIFE is a syntax error.

## Development Setup Gotchas

- **`.next` cache is incompatible between `dev` and `build`** — switching causes `MODULE_NOT_FOUND` for stale webpack chunks. Always `rm -rf .next` when switching modes. The `./start.sh` script does this automatically.
- **`<html>` tag in `layout.tsx` must have `suppressHydrationWarning`** — browser extensions (Dark Reader, etc.) inject `data-*` attributes after SSR, causing hydration mismatches. The `<body>` needs it too.
- **`.gitignore` pattern scoping**: bare `build/` matches ANY directory named `build` (including `app/api/build/`, `lib/build/`). Use `/build/` to scope root-only. Same for `output/`, `dist/`.
- **HMR wipes module-level state** — the in-memory session `Map` resets on any code change during dev. The preview route (`/api/preview/[id]`) has a two-tier fallback: in-memory Map → direct filesystem path. New routes needing workspace access must include the same fallback.

## DeepSeek Provider Notes

- **`reasoning_content` MUST be preserved across turns** — echoed back unchanged. Handled in: `AgentMessage` type, `sendMessage()` capture, `toOpenAIMessages()` emit. If adding a new provider, replicate this pattern.
- **Provider names: lowercase in factory, capitalized from frontend** — `chat/route.ts` normalizes casing.
- **Provider validation: lowercase FIRST, then check** — `ALLOWED_PROVIDERS.has(config.provider.toLowerCase())`.

## Code Patterns

### Error handling
- Read API error body BEFORE checking `!res.ok` (`res.json()` first, then status check). Server error messages live in JSON body.
- `buildResult.success` is a boolean — check it directly. `!!data.buildResult` is always truthy when the field exists, even on failure.
- API-key redaction: error responses auto-redact `config.apiKey`. New error paths must do the same.
- Build error messages must be **actionable** — tell the agent WHAT to do: `"Build failed: ${errors}. Fix the errors in scripts/ and call build_game again."` Not just `"Build completed with warnings."`

### Path & session validation
- Session IDs validated as UUID (`/^[0-9a-f-]{36}$/i`) before `path.join()` — prevents directory traversal.
- Workspace path validation: reject `..` → resolve → boundary check → `realpathSync`. All 3 layers must be preserved.
- Preview route: two-tier lookup (in-memory Map → filesystem fallback) survives HMR resets.

### Testing
- Vitest with `@/` path alias (mirrors tsconfig). Tests in `__tests__/`, globals enabled, node environment.

### Git / GitHub
- Each session workspace auto-initializes a git repo (`lib/git.ts`). Auto-commits on every successful `build_game`.
- Agent tools: `git_log`, `git_diff`, `git_status` (always available), `github_push` (gated — hidden when no `config.githubToken`).
- **Tool gating**: `getOpenAITools(config)` in `tools.ts` filters tools based on `config.githubToken`. New conditional tools follow this pattern.
- **GitHub auth**: PAT in SettingsModal (localStorage) → `config.githubToken` → agent receives it in handler. No server-side storage.
- **`gh` CLI fallback**: `lib/github.ts` tries `gh` CLI first (via `GH_TOKEN` env var), falls back to REST API. Auto-detects CLI availability.

### Session Recovery
- **`restoreWorkspace()`** vs `createWorkspace()`: use the former when `jsonlExists(sessionId)` — it detects existing workspace on disk and skips scaffold recopy, preserving agent additions to `utils.js`, `gotchas.md`, and git history.
- **Workspace state summary**: On session restore, the system prompt is extended with current `game.js` existence, build status, `todo.md` state, and recent git history — preventing the agent from restarting from scratch.
- **UI state reconstruction**: `GET /api/session/{id}` returns `hasBuild`, `hasTodo`, `todoContent`, `gitPagesUrl`. HomeContent reconstructs `buildResult` badges, `todoUpdate` cards, and `githubRepoUrl` from these.
- **New Game guard**: `HomeContent.tsx` compares `urlSessionId !== sessionId` (not just param existence) to prevent 404 when clicking New Game with `?session=` in URL.

## Adding Features

### New LLM provider
1. Implement `AgentSession` interface (reference: `lib/agent/deepseek.ts`)
2. Register in `lib/agent/factory.ts` switch
3. Add to `SettingsModal.tsx` provider list
4. Add normalization in `app/api/chat/route.ts`

### New game template
1. Add `game.js` to `workspace/templates/{name}/`
2. Must use `document.getElementById('gameCanvas')` for canvas reference
3. Scripts load order: utils.js → main.js/game.js → alphabetical

### New tool
1. Define JSON Schema in `lib/agent/tools.ts`
2. Add handler case in `deepseek.ts` `invokeTool()`
3. Add path validation if tool accepts file paths

## Scaffold Knowledge Base

`workspace/` is git-tracked and auto-copied to each session. Key files:

- `workspace/docs/gotchas.md` — 20+ anti-patterns. Always preserved in truncated prompts (30K char limit).
- `workspace/docs/game-dev-guide.md`, `game-patterns.md`, `ui-design-guide.md` — authoritative game dev rules
- `workspace/lib/utils.js` — reusable engine (19 classes/functions). Copied to `scripts/utils.js` at session start.
- `workspace/agent.md` — agent system instructions, injected into system prompt after scaffold docs
- Scripts concatenated in a single `<script type="module">` tag: utils.js first → then game.js → shared scope
