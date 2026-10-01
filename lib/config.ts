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
        'git_log',
        'git_diff',
        'git_status',
        'github_push',
        'game_runtime',
      ],
      subagent: ['read_file', 'write_file', 'grep_file', 'list_directory'],
    } as Record<string, readonly string[]>,
  },

  // ── Game runtime ──
  // Some keys below are reserved for future tasks; only defaultMaxSteps, defaultFps, initWaitMs are consumed by the current handler.
  gameRuntime: {
    defaultMaxSteps: 15,
    defaultFps: 5,
    initWaitMs: 1000,
    enabled: true,
    maxTotalTimeMs: 120_000,
    maxApiCallsPerTest: 10,
    staticAnalyzer: { enabled: true, confidenceThreshold: 0.3 },
    testRules: {
      checkCanvasSize: true,
      checkScoreProgression: true,
      checkGameOverTrigger: true,
      checkMemoryLeak: true,
      checkEventCleanup: true,
      checkRenderConsistency: true,
      checkAnimationLoop: true,
    },
    screenshots: { enabled: false, format: 'jpeg' as const, quality: 60, maxCount: 5, captureOnError: true },
    performance: { measureFps: true, measureMemory: true, measureFrameTime: true,
      fpsSampleDurationMs: 3000, memorySampleIntervalMs: 500 },
    browserPool: { maxInstances: 3, idleTimeoutMs: 300_000, maxMemoryPerPageMb: 512,
      maxPagesPerInstance: 5, cleanupIntervalMs: 60_000 },
    aiDecision: { enabled: true, maxApiCalls: 10, model: 'deepseek-v4-flash',
      temperature: 0.3, maxTokens: 10, fallbackToRandom: true },
  },

  // ── Providers ──
  providers: {
    allowed: Object.freeze(new Set(['deepseek'])),
    allowedBaseHosts: ['api.deepseek.com'] as const,
    deepseek: {
      defaultBaseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-pro',
      fallbackModel: 'deepseek-v4-flash',
    },
  },

  // ── Workspace ──
  build: {
    maxScriptBytes: 2_000_000,
    maxAssetBytes: 10_000_000,
    maxTotalAssetBytes: 25_000_000,
    maxHtmlBytes: 40_000_000,
  },
  workspace: {
    maxActiveSessions: 100,
    staleCleanupMs: 3_600_000, // 1 hour
  },

  // ── Validation ──
  validation: {
    // UUID v4 format
    uuidPattern:
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  },
} as const;
