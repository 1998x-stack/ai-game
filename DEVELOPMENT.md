# DEVELOPMENT.md

## Development Gotchas & Conventions

### Agent Pipeline Gotchas

#### Provider Name Casing
The frontend sends provider names capitalized (`DeepSeek`, `OpenAI`, `Claude`) but the factory expects lowercase (`deepseek`, `openai`, `claude`). The chat route normalizes casing. If adding a new provider, register it in both the factory switch and the normalization logic.

#### build_game Must Pass workspaceRoot
The agent's `build_game` tool calls `buildGame(this.workspaceRoot)`. If you restructure the DeepSeekAgent constructor, ensure `this.workspaceRoot` is always an absolute resolved path.

#### fromOpenAIToolCalls JSON.parse
Malformed JSON from the LLM in tool call arguments will NOT crash the entire agent loop — handled with try-catch returning empty args. Error is caught downstream in `executeToolCalls`.

#### System Prompt Size
Scaffold docs are truncated at 30,000 characters with gotchas always preserved. If adding new scaffold docs, test that the truncated prompt still includes enough context for quality game generation.

#### reasoning_content Must Be Echoed Back
DeepSeek reasoning/thinking models (including `deepseek-v4-pro`) return a `reasoning_content` field in assistant messages. This field **MUST** be preserved and passed back unchanged in all subsequent multi-turn API calls. Dropping it causes HTTP 400: `The reasoning_content in the thinking mode must be passed back to the API.`

Three places handle this:
1. `AgentMessage` type has optional `reasoning_content?: string`
2. `sendMessage()` captures it from the API response via `(responseMessage as unknown as Record<string, unknown>).reasoning_content`
3. `toOpenAIMessages()` emits it back in assistant messages via spread `...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {})`

If adding a new LLM provider, ensure reasoning/thinking content is preserved across turns.

#### Provider Validation Ordering
Provider name validation (`ALLOWED_PROVIDERS.has(...)`) **must lowercase BEFORE checking**, not after. The frontend sends capitalized names (`'DeepSeek'`) but the set contains lowercase (`'deepseek'`). The correct order is:
```typescript
// ✅ Correct — lowercase before validation
ALLOWED_PROVIDERS.has(config.provider.toLowerCase())

// ❌ Wrong — validates original casing, then lowercases for factory call
ALLOWED_PROVIDERS.has(config.provider)  // 'DeepSeek' ≠ 'deepseek'
```

### Security Gotchas

#### Iframe Sandbox — No allow-same-origin
**Never** add `allow-same-origin` back to the GamePreview iframe. Combined with `allow-scripts`, this lets generated game code access the parent origin's DOM, cookies, and localStorage (including the API key). `postMessage` works cross-origin — `allow-same-origin` is not needed.

#### postMessage Origin Validation
The `GamePreview` message handler must validate `event.source` against the iframe's `contentWindow`. Without this check, any cross-origin page can send spoofed `game-error` messages. The validation is:
```typescript
if (event.source !== iframeRef.current?.contentWindow) return;
```
After removing `allow-same-origin` from the iframe sandbox, the iframe has a `null` origin — `event.origin` checks won't work. Use `event.source` instead.

#### Path Validation
The `validatePath()` function in `deepseek.ts` has three layers of defense:
1. Reject `..` in path strings
2. Check resolved path is within workspace root (using `path.sep` boundary, not simple prefix)
3. Resolve symlinks via `realpathSync`

When modifying path validation, ensure all three layers are preserved.

#### Session ID Validation
Session IDs from the client are validated as UUID format (`/^[0-9a-f-]{36}$/i`) before use in `path.join()` for workspace creation. This prevents directory traversal via crafted session IDs. Non-UUID session IDs receive HTTP 400.

#### API Key in Error Messages
Error responses automatically redact the API key. When adding new error paths in chat route, ensure `config.apiKey` is redacted before returning error text to the client.

### Build Pipeline Gotchas

#### Script Ordering
The packager sorts scripts in this priority: `utils.js` first → `main.js`/`game.js` → alphabetical. If your game template needs a specific load order, name files accordingly.

#### Module Scripts (not IIFE)
Generated game code uses `<script type="module">` instead of IIFE wrapping. ES modules have their own scope (no global pollution) and support `export`/`import` natively. The packager:
- Inlines all scripts into a single `<script type="module">` tag
- Never wraps in IIFE (would cause `SyntaxError: export` inside IIFE)
- Adds `startGame()` call if code assigns to `window.*` (module scope doesn't leak)
- Uses `<script type="module">` for `game-ready` postMessage too (ensures it runs after game code — modules are deferred, execute in order)

The error handler runs in a plain `<script>` (before modules) so it catches module runtime errors. The asset map (`window.__ASSETS__`) runs in a plain `<script>` (before modules) so it's available when the game module executes.

#### Canvas ID Convention
The packager generates `<canvas id="gameCanvas">`. ALL scaffold docs, gotchas, templates, and agent instructions must use this exact ID. Any reference to `id="game"`, `#game`, or `getElementById('game')` in scaffold material will cause the agent to generate broken code.

The agent instructions (both `agent.md` and system prompt) explicitly state: "The canvas is already created with id='gameCanvas' — use `document.getElementById('gameCanvas')`. Do NOT create a new canvas element."

#### Scaffold Utilities Are Pre-Loaded
`utils.js` is concatenated BEFORE `game.js` in the same `<script type="module">` tag. All its exports are available in scope. The agent MUST NOT redeclare any of these:
- Classes: `GameLoop`, `InputManager`, `CollisionDetector`, `SpriteManager`, `Animation`, `SoundManager`, `ObjectPool`
- Functions: `randomInt`, `clamp`, `lerp`, `distance`, `angleBetween`, `setupCanvas`

Redeclaring any of them causes `"Identifier has already been declared"` at runtime. The agent instructions list all utilities by name to prevent this.

#### Assets
Assets are embedded as base64 data URIs in `window.__ASSETS__`. Large assets (>10MB) will bloat the output HTML and may cause memory issues. Keep game assets small.

#### .next Cache Compatibility
The `.next/` directory is **not compatible** between `npm run build` (production) and `npm run dev` (development). Switching between them causes `MODULE_NOT_FOUND` errors for stale webpack chunks. Always run:
```bash
rm -rf .next && npm run dev   # after npm run build
rm -rf .next && npm run build # after npm run dev
```

#### .gitignore Pattern Scoping
The pattern `build/` in `.gitignore` matches ANY directory named `build` (including `app/api/build/` and `lib/build/`). Use `/build/` to scope to root-level only. Same applies to `output/`, `dist/`, and similar patterns.

### Frontend Gotchas

#### Settings Initialization
On first visit (no localStorage), the SettingsModal auto-opens. The "New Game" button does NOT reset settings — only session state (messages, game URL, errors).

#### GameError Type
`GameError` is exported from `ErrorConsole.tsx` as the canonical type (`{ message, source, lineno, colno }`). Import from there — do not redefine locally.

#### isGenerating Guard
`handleSendMessage` uses `isGenerating` as a dependency in `useCallback`. Between React's batch state updates and re-render, concurrent sends are possible in edge cases. The guard is best-effort, not a hard mutex.

#### Errors Array Limit
Game runtime errors are capped at 50 entries to prevent unbounded growth from buggy game loops.

#### SSR + dynamic import pattern
The main page uses browser APIs (`crypto.randomUUID()`, `localStorage`, `window.innerWidth`) that cannot SSR. The correct pattern is a thin `page.tsx` wrapper with `dynamic` import, NOT `Promise.resolve`:

```typescript
// page.tsx — thin wrapper (this file)
import dynamic from 'next/dynamic';
const HomeContent = dynamic(() => import('./HomeContent'), { ssr: false });
export default HomeContent;

// HomeContent.tsx — actual component
'use client';
export default function HomeContent() { /* browser APIs here */ }
```

**Do NOT** use `dynamic(() => Promise.resolve(Component), { ssr: false })` — this causes module resolution errors during build. **Do NOT** use the `mounted`/`return null` pattern — React 18 strict mode can still produce hydration mismatches.

#### Dark Reader Hydration
The `<html>` tag in `layout.tsx` must have `suppressHydrationWarning` to handle browser extensions (Dark Reader, Grammarly, etc.) that inject `data-*` attributes into the DOM after SSR. Without it, every page load logs a hydration warning.

#### Error Response Body Read Order
When handling API errors, **read `res.json()` BEFORE checking `!res.ok`**. The server's error message is in the JSON body; checking status first and throwing loses it:

```typescript
// ✅ Correct — capture error body before status check
const data = await res.json();
if (!res.ok) throw new Error(data.error || `Server error: ${res.status}`);

// ❌ Wrong — error body is lost
if (!res.ok) throw new Error(`Server error: ${res.status}`);
const data = await res.json(); // never reached
```

#### buildResult Success Check
The `buildResult` field on chat API responses has a `success` boolean. Check it directly — don't rely on truthiness of `data.buildResult` (which is always truthy when the object exists, even if `success: false`):

```typescript
// ✅ Correct
if (data.buildResult?.success && data.buildResult?.previewUrl) {
  setGameUrl(data.buildResult.previewUrl);
}

// ❌ Wrong — shows "Game ready!" badge even when build failed
buildResult: !!data.buildResult
```

### Workspace Manager Gotchas

#### In-Memory Sessions + HMR
Sessions are stored in an in-memory `Map` in `manager.ts`. Next.js HMR **wipes all module-level state** on any code change during dev. This means `getWorkspace()` returns `null` even though files exist on disk.

The preview route (`/api/preview/[sessionId]`) handles this with a two-tier lookup:
```typescript
// 1. Fast path: in-memory Map (works when no HMR reset)
const workspace = getWorkspace(sessionId);
// 2. Fallback: construct path directly from disk (survives HMR resets)
const outputPath = workspace
  ? path.join(workspace.workspacePath, 'output', 'index.html')
  : path.join(process.cwd(), 'user_space', sessionId, 'output', 'index.html');
```

If adding another API route that needs workspace access, include the filesystem fallback. Session cleanup runs automatically (max 100 active, LRU eviction on overflow, 1-hour stale eviction).

#### Scaffold Copying
On session creation, `copyScaffoldToWorkspace` copies the ENTIRE `workspace/` structure into `user_space/{sessionId}/`:
- `workspace/docs/` → `user_space/{id}/docs/` (game-dev-guide, patterns, gotchas, ui-design)
- `workspace/templates/` → `user_space/{id}/templates/` (snake, breakout, tetris, 2048)
- `workspace/lib/` → `user_space/{id}/lib/` (utils.js source, index.md API reference)
- `workspace/lib/utils.js` → `user_space/{id}/scripts/utils.js` (build pipeline requires it here)
- `workspace/agent.md` + `workspace/claude.md` → `user_space/{id}/` (agent instructions)

The canonical `agent.md` and `claude.md` are static files at `workspace/`. The `generateAgentMd()` function has been removed — the static files are the source of truth. Silent skip on missing files (`.catch(() => {})`).

#### Agent.md Injection
The chat route reads `workspace/agent.md` and appends it to the system prompt after scaffold docs. This ensures the agent always gets the full instruction set even if the agent.md file isn't read separately. Missing agent.md is silently skipped.

#### Stale Cleanup
`cleanupStaleWorkspaces` uses `Promise.allSettled` to ensure one failed deletion doesn't block others.

### Adding New Features

#### New LLM Provider
1. Implement `AgentSession` interface (see `lib/agent/deepseek.ts` for reference)
2. Register in `factory.ts` switch
3. Add provider option to `SettingsModal.tsx`
4. Add normalization in `chat/route.ts`

#### New Game Template
1. Add `game.js` to `workspace/templates/{name}/`
2. Game code must reference `document.getElementById('gameCanvas')` for the canvas
3. If using scaffold utilities, import pattern: the packager concatenates `utils.js` first
4. Reference `DEVELOPMENT.md` for gotcha patterns to avoid

#### New Tool
1. Define in `lib/agent/tools.ts` (JSON Schema parameters)
2. Add case to `invokeTool()` in `deepseek.ts`
3. Add path validation if tool accepts file paths

#### New Scaffold Doc
1. Add `.md` file to `workspace/docs/`
2. It will be auto-loaded into the system prompt (subject to 30K char truncation)
3. Gotchas are always preserved in truncated prompts — put critical rules in `gotchas.md`
