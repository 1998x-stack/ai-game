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

### Security Gotchas

#### Iframe Sandbox
**Never** add `allow-same-origin` back to the GamePreview iframe. Combined with `allow-scripts`, this lets generated game code access the parent origin's DOM, cookies, and localStorage (including the API key). `postMessage` works cross-origin — `allow-same-origin` is not needed.

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

#### IIFE Detection
Code is wrapped in an IIFE unless it explicitly assigns to `window.*`. Detection uses regex checking for `window.X =` (not `==` or `===`) and `window['X'] =` patterns. False positives (e.g., code containing `window.X` in comments) will prevent IIFE wrapping but cause no functional harm.

#### Assets
Assets are embedded as base64 data URIs in `window.__ASSETS__`. Large assets (>10MB) will bloat the output HTML and may cause memory issues. Keep game assets small.

### Frontend Gotchas

#### Settings Initialization
On first visit (no localStorage), the SettingsModal auto-opens. The "New Game" button does NOT reset settings — only session state (messages, game URL, errors).

#### GameError Type
`GameError` is exported from `ErrorConsole.tsx` as the canonical type (`{ message, source, lineno, colno }`). Import from there — do not redefine locally.

#### isGenerating Guard
`handleSendMessage` uses `isGenerating` as a dependency in `useCallback`. Between React's batch state updates and re-render, concurrent sends are possible in edge cases. The guard is best-effort, not a hard mutex.

#### Errors Array Limit
Game runtime errors are capped at 50 entries to prevent unbounded growth from buggy game loops.

### Workspace Manager Gotchas

#### In-Memory Sessions
Sessions are stored in an in-memory `Map` — lost on server restart. No persistence layer exists yet. Session cleanup runs automatically (max 100 active, LRU eviction on overflow, 1-hour stale eviction).

#### Scaffold Copying
`copyScaffoldToWorkspace` silently skips missing source files (`.catch(() => {})`). If a template isn't showing up in new workspaces, verify the source file exists at the expected path.

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
