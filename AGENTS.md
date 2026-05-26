# AGENTS.md — AI Game Studio

## Quick Reference

```bash
npm run dev      # next dev  (port 3000)
npm test         # vitest run (__tests__/api.test.ts)
npm run lint     # next lint
npm run build    # production build (wipes .next — delete before dev after)
```

## Architecture (3-layer)

| Layer | Location | Role |
|-------|----------|------|
| Chat UI | `app/`, `components/` | Next.js App Router + React (client-only, dynamic import SSR-off) |
| Agent pipeline | `lib/agent/` | Factory pattern → DeepSeek adapter (OpenAI-compatible SDK) |
| Game scaffold | `workspace/` | Authoritative docs, templates, utils for game-generating agents |
| Runtime sessions | `user_space/{uuid}/` | Gitignored. HMR wipes in-memory Map, but files remain on disk. |

**Domain concepts** are in `CONTEXT.md`. **Developer gotchas** are in `DEVELOPMENT.md`. This file covers what an agent needs to avoid mistakes.

## Critical Don'ts

- **`page.tsx` must use `dynamic(() => import('./HomeContent'), { ssr: false })`** — not `Promise.resolve`. Browser APIs (`crypto`, `localStorage`) can't SSR.
- **NEVER add `allow-same-origin` to the iframe sandbox** — exposes parent DOM, including API key. `postMessage` works cross-origin without it.
- **NEVER use dynamic import for the packager** (`await import('@/lib/build/packager')`) — routes through Next.js webpack and fails on stale `.next`. Always `import { buildGame } from '@/lib/build/packager'` at top level.
- **Canvas ID is always `gameCanvas`** — scaffold docs, templates, and packager all depend on this. Never `#game`, `myCanvas`, etc.
- **Agent MUST NOT redeclare scaffold utilities** — `GameLoop`, `InputManager`, `CollisionDetector`, `setupCanvas`, `randomInt`, `clamp`, `lerp`, `distance`, etc. are pre-loaded in the same module scope.
- **Module scripts, never IIFE** — packager uses `<script type="module">`. `export` inside IIFE is a syntax error.

## DeepSeek Provider Notes

- **`reasoning_content` MUST be preserved across turns** — the API requires it echoed back unchanged. Handled in 3 places: `AgentMessage` type, `sendMessage()` capture, `toOpenAIMessages()` emit. If adding a new provider, replicate this pattern.
- **Provider names: lowercase in factory, capitalized from frontend** — `chat/route.ts` normalizes casing. Register new providers in both factory switch and normalization.
- **Provider validation: lowercase FIRST, then check** — `ALLOWED_PROVIDERS.has(config.provider.toLowerCase())`, not the reverse.

## Code Patterns

### Error handling
- Read API error body BEFORE checking `!res.ok` (`res.json()` first, then status check). Server error messages live in JSON body.
- `buildResult.success` is a boolean — check it directly. `!!data.buildResult` is always truthy when the field exists, even on failure.
- API-key redaction: error responses auto-redact `config.apiKey`. New error paths must do the same.

### Path & session validation
- Session IDs validated as UUID format (`/^[0-9a-f-]{36}$/i`) before `path.join()` — prevents directory traversal.
- Workspace path validation: reject `..` → resolve → check within root → `realpathSync`. All 3 layers.
- Preview route has two-tier lookup: in-memory Map → filesystem fallback (survives HMR resets).

### Testing
- Vitest with `@/` path alias (mirrors tsconfig). Tests in `__tests__/`, globals enabled, node environment.

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

The `workspace/` directory is git-tracked and auto-copied to each session. Key files:

- `workspace/docs/gotchas.md` — 20+ anti-patterns. Always preserved in truncated prompts.
- `workspace/docs/game-dev-guide.md`, `game-patterns.md`, `ui-design-guide.md` — authoritative game dev rules
- `workspace/lib/utils.js` — reusable engine (19 classes/functions). Copied to `scripts/utils.js` at session start.
- `workspace/agent.md`, `workspace/claude.md` — injected into system prompt after scaffold docs
- System prompt truncated at 30K chars, gotchas always preserved.
