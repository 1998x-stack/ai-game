# Repository Guidelines

## Project Structure

- `app/` and `components/` contain the Next.js App Router UI and chat/game-preview components.
- `lib/agent/` implements the provider factory, DeepSeek adapter, tools, and message types.
- `lib/build/`, `lib/runtime/`, and `lib/workspace/` handle packaging, game analysis/testing, and session workspaces.
- `workspace/` is the tracked game scaffold: documentation, templates, and shared `utils.js`.
- `__tests__/` contains Vitest tests; `public/` and `assets/` contain static resources.
- Runtime workspaces live under gitignored `user_space/{uuid}/` and persist on disk across HMR.

Read `CONTEXT.md` for domain terminology and `DEVELOPMENT.md` for known pitfalls.

## Development Commands

```bash
npm run dev       # Start Next.js on port 3000
npm test          # Run the Vitest suite
npm run lint      # Run Next.js linting
npm run typecheck # Run TypeScript checks
npm run build     # Create a production build
./start.sh        # Clear .next, then start development
```

Clear `.next` when switching between `dev` and `build`; their caches are incompatible.

## Code Style and Conventions

Use the existing TypeScript/React style, `@/` imports, and two-space indentation. Components and types use PascalCase; functions, variables, and files use camelCase or kebab-case consistent with nearby code. Put shared constants, timeouts, and allowlists in `lib/config.ts` rather than hardcoding them.

Preserve the architecture’s browser-safety rules: `app/page.tsx` must dynamically import `HomeContent` with `ssr: false`; never add `allow-same-origin` to the preview iframe; and import `buildGame` statically. Game scripts use the `gameCanvas` ID, shared scaffold utilities, and module scripts. DeepSeek is currently the only implemented provider.

## Testing

Tests run in Vitest’s Node environment with globals and the `@/` path alias. Add or update tests in `__tests__/` using descriptive `*.test.ts` names. Run `npm test` and `npm run lint` before submitting changes; run `npm run build` for route, packaging, or configuration changes.

## Commits and Pull Requests

Use concise imperative subjects, commonly scoped like `feat(game_runtime): add ...` or `fix(api): ...`. Keep commits focused. Pull requests should explain the behavior change, identify tests run, link the relevant issue when available, and include screenshots or recordings for UI changes.

## Security and Validation

Validate UUID session IDs before path operations and preserve workspace boundary checks (`..` rejection, resolved-path boundary, and `realpathSync`). Redact API keys in every error path. Preserve DeepSeek `reasoning_content` across turns and keep GitHub tools gated by `config.githubToken`.
