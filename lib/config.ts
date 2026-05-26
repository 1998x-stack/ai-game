// ═════════════════════════════════════════════════════════════
// AI Game Studio — Centralized Configuration
// ═════════════════════════════════════════════════════════════
// All magic numbers, defaults, and config constants live here.
// Import from this file instead of hardcoding values.

export const CONFIG = {
  // ── Agent loop ──
  agent: {
    maxIterations: 10,
    toolTimeoutMs: 30_000,
    maxPromptLength: 30_000,
    maxMessageLength: 50_000,
  },

  // ── Subagent delegation ──
  subagent: {
    maxConcurrent: 3,
    maxIterations: 5,
  },

  // ── Tool defaults ──
  tools: {
    readFileDefaultLimit: 2000,
    // Allowlists: which tools each agent role can use
    allowed: {
      master: [
        'read_file',
        'write_file',
        'edit_file',
        'list_directory',
        'grep_file',
        'build_game',
        'load_skills',
        'write_todo',
        'set_error',
        'delegate_subagent',
        // 'game_runtime' — disabled by default (resource-intensive)
      ],
      subagent: ['read_file', 'write_file', 'grep_file', 'list_directory'],
    } as Record<string, readonly string[]>,
  },

  // ── Game runtime ──
  gameRuntime: {
    defaultMaxSteps: 15,
    defaultFps: 5,
    initWaitMs: 1000,
  },

  // ── Providers ──
  providers: {
    allowed: new Set(['deepseek', 'openai', 'claude']),
    deepseek: {
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-pro',
      fallbackModel: 'deepseek-v4-flash',
    },
  },

  // ── Validation ──
  validation: {
    // UUID v4 format
    uuidPattern:
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  },
} as const;
