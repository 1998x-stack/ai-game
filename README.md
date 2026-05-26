# AI Game Studio

> Create, iterate, and play HTML5 games — just by chatting with an AI.

AI Game Studio is a web application where you describe a game idea in natural language, and an LLM-powered agent generates a complete, playable HTML5 game in real-time. No downloads, no coding — just type what you want and play immediately in the sandboxed preview panel.

![License](https://img.shields.io/badge/license-MIT-blue)
![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?logo=typescript)

## Quick Start

```bash
git clone https://github.com/1998x-stack/ai-game.git
cd ai-game
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Configure your DeepSeek API key in settings, then start chatting to generate games.

### Prerequisites

- Node.js 18+
- A [DeepSeek API key](https://platform.deepseek.com/) (or any OpenAI-compatible endpoint)

## Features

- **Natural Language Game Creation** — Describe any game idea ("make a snake game with neon graphics") and the agent generates working code
- **Live Preview** — Games run immediately in a sandboxed iframe with full keyboard, mouse, and touch support
- **Iterative Refinement** — "Make it faster," "Add a score counter," "Change the colors" — the agent updates and rebuilds in real-time
- **Multi-Template Scaffold** — Built-in reference implementations for Snake, Breakout, Tetris, and 2048
- **Gotchas Knowledge Base** — Structured anti-patterns prevent common game development bugs
- **BYO-Key Architecture** — You control your API key and model; nothing is stored server-side
- **Fullscreen & Export** — Play fullscreen, export game code at any time
- **Dark Gaming Aesthetic** — Professional IDE-like interface designed for game development

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│                    AI Game Studio                         │
├────────────────────┬─────────────────────────────────────┤
│    Chat Panel      │        Game Preview                 │
│                    │                                     │
│  ┌──────────────┐  │  ┌───────────────────────────────┐ │
│  │ User: "Make  │  │  │                               │ │
│  │  a snake     │──┼─▶│     ┌─────────────┐           │ │
│  │  game"       │  │  │     │  Snake Game  │           │ │
│  └──────────────┘  │  │     │  (iframe)    │           │ │
│                    │  │     └─────────────┘           │ │
│  ┌──────────────┐  │  │                               │ │
│  │ Agent: "I've │  │  │  [████████████████████████]   │ │
│  │  created the │◀─┼──│                               │ │
│  │  game! Play  │  │  │  Score: 42  Level: 3          │ │
│  │  on the right"│  │  └───────────────────────────────┘ │
│  └──────────────┘  │                                     │
│  ┌──────────────┐  │  ┌───────────────────────────────┐ │
│  │ User: "Make  │  │  │  Error Console (collapsible)   │ │
│  │  it faster"  │──┼─▶│  Runtime errors appear here    │ │
│  └──────────────┘  │  └───────────────────────────────┘ │
├────────────────────┴─────────────────────────────────────┤
│  Agent Pipeline:                                         │
│  User Message → API Route → Agent Loop → Build → Preview │
│                 ↗ Scaffold Docs + Gotchas + Templates    │
└──────────────────────────────────────────────────────────┘
```

### Agent Pipeline

1. **User sends message** → `POST /api/chat`
2. **Workspace created** — isolated per-session directory with `agent.md` constraints
3. **Agent reads scaffold** — authoritative docs, gotchas, and game templates
4. **Agent generates code** — writes `scripts/game.js` using tool calls (read/write/edit)
5. **Build pipeline** — concatenates scripts + embeds assets → single self-contained HTML
6. **Preview served** — HTML injected into sandbox iframe via `/api/preview/{sessionId}`
7. **Error feedback** — runtime errors posted back via `postMessage`, displayed in console

## Project Structure

```
ai-game/
├── app/
│   ├── page.tsx                          # Split-pane layout orchestrator
│   ├── layout.tsx                        # Root layout + metadata
│   ├── globals.css                       # Dark gaming theme
│   └── api/
│       ├── chat/route.ts                 # Agent chat endpoint (POST)
│       ├── build/route.ts                # Manual build trigger (POST)
│       └── preview/[sessionId]/route.ts  # Serve built HTML (GET)
├── components/
│   ├── ChatPanel.tsx                     # Chat messages + input
│   ├── GamePreview.tsx                   # Sandbox iframe + fullscreen
│   ├── SettingsModal.tsx                 # API key/model config
│   └── ErrorConsole.tsx                  # Runtime error display
├── lib/
│   ├── agent/                            # LLM Agent SDK
│   │   ├── types.ts                      # Agent interfaces
│   │   ├── tools.ts                      # 6 tool definitions
│   │   ├── factory.ts                    # Provider factory
│   │   ├── deepseek.ts                   # DeepSeek adapter
│   │   └── index.ts                      # Barrel exports
│   ├── build/
│   │   └── packager.ts                   # Scripts → self-contained HTML
│   ├── workspace/
│   │   └── manager.ts                    # Session isolation + agent.md
│   └── scaffold/
│       └── reader.ts                     # Workspace doc loader
├── workspace/                            # Scaffold knowledge base
│   ├── docs/
│   │   ├── game-dev-guide.md             # Canvas game development guide
│   │   ├── game-patterns.md              # Architecture patterns
│   │   └── gotchas.md                    # 10 anti-patterns with fixes
│   └── templates/
│       ├── lib/utils.js                  # Game engine utilities
│       ├── snake/game.js                 # Snake template
│       ├── breakout/game.js              # Breakout template
│       ├── tetris/game.js                # Tetris template (SRS)
│       └── 2048/game.js                  # 2048 template
├── docs/
│   └── adr/
│       └── 0001-logical-workspace-isolation.md
├── CONTEXT.md                            # Domain glossary
└── README.md
```

## Configuration

Settings are stored locally in your browser (localStorage). Configure in the Settings modal (Cmd+K):

| Setting | Default | Description |
|---|---|---|
| Provider | DeepSeek | LLM provider (DeepSeek, OpenAI, Claude) |
| API Key | *(required)* | Your API key |
| Model | `deepseek-v4-pro` | Model name (fallback: `deepseek-v4-flash`) |
| Base URL | `https://api.deepseek.com` | API endpoint |

Your API key never touches our servers beyond being passed directly to the LLM provider's API.

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.4 |
| Styling | Tailwind CSS 3.4 |
| Icons | Lucide React |
| Agent SDK | OpenAI-compatible (DeepSeek, extensible) |
| Game Engine | Pure HTML5 Canvas + vanilla JavaScript |
| Sandbox | iframe with `allow-scripts` |

## Design Decisions

- **Pure HTML5 Canvas** — no WebAssembly, no Phaser dependency. Generated games are self-contained single files.
- **Logical workspace isolation** — path validation + `agent.md` constraints. OS-level containerization deferred to v2.
- **BYO-Key architecture** — users bring their own API keys; nothing stored server-side.
- **Scaffold-first generation** — agents must read authoritative docs and templates before generating code.
- **Gotchas-driven quality** — structured anti-pattern knowledge base prevents common game bugs.

See [CONTEXT.md](./CONTEXT.md) for the full domain glossary and [docs/adr/](./docs/adr/) for architecture decision records.

## Contributing

1. Read [CONTEXT.md](./CONTEXT.md) — understand the domain model
2. Read [DEVELOPMENT.md](./DEVELOPMENT.md) — development gotchas and conventions
3. Extend the scaffold — add new templates, gotchas, or docs under `workspace/`
4. New LLM providers — implement the `AgentSession` interface in `lib/agent/`

## License

MIT
