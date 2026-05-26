/// <reference types="vitest/globals" />
// ---------------------------------------------------------------------------
// API Route Tests — Chat, Build, Preview, Session
// ---------------------------------------------------------------------------
// MOCKS — all vi.mock calls are hoisted above any import by vitest

vi.mock('next/server', () => {
  class MockNextResponse extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init);
    }
    static json(body: unknown, init?: ResponseInit): Response {
      const bodyStr = JSON.stringify(body);
      return new MockNextResponse(bodyStr, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...((init?.headers as Record<string, string>) ?? {}),
        },
      });
    }
  }
  return { NextResponse: MockNextResponse };
});

vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn<() => Promise<void>>(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    cp: vi.fn(),
    rm: vi.fn(),
  },
  access: vi.fn<() => Promise<void>>(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  cp: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(),
    realpathSync: vi.fn(),
  },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
  realpathSync: vi.fn(),
}));

vi.mock('@/lib/workspace/manager', () => ({
  createWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock('@/lib/agent/factory', () => ({
  createAgent: vi.fn(),
}));

vi.mock('@/lib/scaffold/reader', () => ({
  readScaffoldDocs: vi.fn(),
  getGotchas: vi.fn(),
}));

// agentSessions Map is created inside the factory (vi.mock is hoisted, so
// no outer variable can be referenced). Tests access the shared Map by
// importing agentSessions from the mocked module.
vi.mock('@/lib/session-store', () => {
  const sessions = new Map<string, unknown>();
  return {
    agentSessions: sessions,
    appendToJsonl: vi.fn(),
    readJsonl: vi.fn<() => unknown[]>(() => []),
    jsonlExists: vi.fn<() => boolean>(() => false),
  };
});

vi.mock('@/lib/build/packager', () => ({
  buildGame: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () {
    return { chat: { completions: { create: vi.fn() } } };
  }),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (static — fine because vi.mock is hoisted)
// ---------------------------------------------------------------------------
import { POST as ChatPost } from '@/app/api/chat/route';
import { POST as BuildPost } from '@/app/api/build/route';
import { GET as PreviewGet } from '@/app/api/preview/[sessionId]/route';
import { GET as SessionGet } from '@/app/api/session/[sessionId]/route';

import { createWorkspace, getWorkspace } from '@/lib/workspace/manager';
import { createAgent } from '@/lib/agent/factory';
import { readScaffoldDocs, getGotchas } from '@/lib/scaffold/reader';
import { agentSessions, jsonlExists, readJsonl } from '@/lib/session-store';
import { buildGame } from '@/lib/build/packager';
import fsp from 'fs/promises';
import fs from 'fs';
import OpenAI from 'openai';
import { toolRegistry } from '@/lib/agent/tools';
import type { AgentConfig } from '@/lib/agent/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const API_KEY = 'sk-test-key-12345';

function chatRequest(body: unknown, url = 'http://localhost/api/chat'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function previewRequest(sessionId: string): Request {
  return new Request(`http://localhost/api/preview/${sessionId}`);
}

function sessionRequest(sessionId: string): Request {
  return new Request(`http://localhost/api/session/${sessionId}`);
}

const DEFAULT_CONFIG = {
  provider: 'deepseek',
  apiKey: API_KEY,
  model: 'deepseek-v4-pro',
  baseUrl: 'https://api.deepseek.com',
};

function mockAgent() {
  return {
    sendMessage: vi.fn<() => Promise<unknown>>().mockResolvedValue({
      message: 'Test reply',
      toolCalls: [],
      finishReason: 'stop',
    }),
    sendMessageStream: vi.fn<() => Promise<unknown>>().mockResolvedValue({
      message: 'Test reply',
      toolCalls: [],
      finishReason: 'stop',
    }),
    getHistory: vi.fn<() => unknown[]>(() => []),
    loadHistory: vi.fn(),
    reset: vi.fn(),
  };
}

function mockWorkspace() {
  return {
    sessionId: VALID_UUID,
    workspacePath: '/tmp/test-workspace',
    createdAt: new Date('2025-01-01'),
    lastActiveAt: new Date('2025-01-01'),
  };
}

// ---------------------------------------------------------------------------
// beforeEach / afterEach
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  agentSessions.clear();

  // Default mock behaviours — most routes expect these to fail by default
  vi.mocked(fsp.access).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(fsp.readFile).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(fsp.readdir).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(fsp.stat).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.readFileSync).mockReturnValue('');
  vi.mocked(jsonlExists).mockReturnValue(false);
});

// ===========================================================================
// CHAT ROUTE
// ===========================================================================
describe('POST /api/chat', () => {
  beforeEach(() => {
    // Default happy-path mocks for tests that need a working agent
    vi.mocked(createWorkspace).mockResolvedValue(mockWorkspace());
    vi.mocked(readScaffoldDocs).mockResolvedValue([]);
    vi.mocked(getGotchas).mockResolvedValue('');
    vi.mocked(createAgent).mockReturnValue(mockAgent());
  });

  // -- Validation: missing fields -----------------------------------------

  it('returns 400 when sessionId is missing', async () => {
    const res = await ChatPost(
      chatRequest({ message: 'hello', config: DEFAULT_CONFIG }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required fields');
  });

  it('returns 400 when sessionId is empty string', async () => {
    const res = await ChatPost(
      chatRequest({ sessionId: '', message: 'hello', config: DEFAULT_CONFIG }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when message is missing', async () => {
    const res = await ChatPost(
      chatRequest({ sessionId: VALID_UUID, config: DEFAULT_CONFIG }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required fields');
  });

  it('returns 400 when message is empty string', async () => {
    const res = await ChatPost(
      chatRequest({ sessionId: VALID_UUID, message: '', config: DEFAULT_CONFIG }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when config.apiKey is missing', async () => {
    const { apiKey: _, ...configNoKey } = DEFAULT_CONFIG;
    const res = await ChatPost(
      chatRequest({ sessionId: VALID_UUID, message: 'hello', config: configNoKey }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required fields');
  });

  it('returns 400 when config.apiKey is empty', async () => {
    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'hello',
        config: { ...DEFAULT_CONFIG, apiKey: '' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when config is entirely missing', async () => {
    const res = await ChatPost(
      chatRequest({ sessionId: VALID_UUID, message: 'hello' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required fields');
  });

  // -- Validation: sessionId format ---------------------------------------

  it('returns 400 for invalid UUID sessionId', async () => {
    const res = await ChatPost(
      chatRequest({
        sessionId: 'not-a-uuid',
        message: 'hello',
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid session ID');
  });

  it('returns 400 for path-traversal sessionId', async () => {
    const res = await ChatPost(
      chatRequest({
        sessionId: '../../../etc/passwd',
        message: 'hello',
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid session ID');
  });

  // -- Validation: message length -----------------------------------------

  it('returns 400 for message exceeding MAX_MESSAGE_LENGTH', async () => {
    const longMsg = 'x'.repeat(50001);
    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: longMsg,
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Message too long');
  });

  // -- Validation: provider -----------------------------------------------

  it('returns 400 for unsupported provider', async () => {
    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'hello',
        config: { ...DEFAULT_CONFIG, provider: 'gemini' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unsupported provider');
  });

  it('returns 400 for missing provider', async () => {
    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'hello',
        config: { ...DEFAULT_CONFIG, provider: '' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required field');
  });

  // -- Edge cases ---------------------------------------------------------

  it('returns 400 for empty JSON body ({})', async () => {
    const res = await ChatPost(chatRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required fields');
  });

  it('returns 500 for malformed JSON request body', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json-at-all{{{',
    });
    const res = await ChatPost(req);
    expect(res.status).toBe(500);
  });

  it('redacts API key from 500 error messages', async () => {
    // Make createAgent throw with a message containing the API key
    vi.mocked(createAgent).mockImplementation(() => {
      throw new Error(`Connection failed with key ${API_KEY}`);
    });
    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'hello',
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain(API_KEY);
    expect(body.error).toContain('[REDACTED]');
  });

  // -- Successful non-streaming path --------------------------------------

  it('returns 200 with reply for valid request (non-streaming)', async () => {
    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'make me a game',
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('reply');
    expect(body.reply).toBe('Test reply');
    expect(body).toHaveProperty('toolCalls');
  });

  it('includes buildResult when agent calls build_game', async () => {
    const agent = mockAgent();
    agent.sendMessage.mockResolvedValue({
      message: 'Game built!',
      toolCalls: [{ id: 'call_1', name: 'build_game', arguments: {} }],
      finishReason: 'stop',
    });
    vi.mocked(createAgent).mockReturnValue(agent);
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    // Make access succeed → build output exists
    vi.mocked(fsp.access).mockResolvedValue(undefined);

    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'make me a game',
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.buildResult).toBeDefined();
    expect(body.buildResult.success).toBe(true);
    expect(body.buildResult.previewUrl).toContain(VALID_UUID);
  });

  it('handles streaming request (returns SSE response)', async () => {
    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'make me a game',
        stream: true,
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(200);
    const contentType = res.headers.get('Content-Type');
    expect(contentType).toBe('text/event-stream');
  });

  it('reuses existing agent session on subsequent messages', async () => {
    // Simulate an existing agent in the session store
    const existingAgent = mockAgent();
    agentSessions.set(VALID_UUID, existingAgent);

    const res = await ChatPost(
      chatRequest({
        sessionId: VALID_UUID,
        message: 'second message',
        config: DEFAULT_CONFIG,
      }),
    );
    expect(res.status).toBe(200);
    // Should NOT have called createWorkspace or createAgent
    expect(vi.mocked(createWorkspace)).not.toHaveBeenCalled();
    expect(vi.mocked(createAgent)).not.toHaveBeenCalled();
    // Should have sent message to the existing agent
    expect(existingAgent.sendMessage).toHaveBeenCalledWith(
      'second message',
      expect.any(AbortSignal),
    );
  });
});

// ===========================================================================
// BUILD ROUTE
// ===========================================================================
describe('POST /api/build', () => {
  it('returns 200 with previewUrl for valid session', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    vi.mocked(buildGame).mockReturnValue({
      html: '<html></html>',
      outputPath: '/tmp/test/output/index.html',
      errors: [],
    });

    const res = await BuildPost(
      buildRequest({ sessionId: VALID_UUID }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.previewUrl).toBe(`/api/preview/${VALID_UUID}`);
    expect(body.errors).toEqual([]);
  });

  it('returns 200 with errors when build has warnings', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    vi.mocked(buildGame).mockReturnValue({
      html: '<html></html>',
      outputPath: '/tmp/test/output/index.html',
      errors: ['Missing asset: icon.png'],
    });

    const res = await BuildPost(
      buildRequest({ sessionId: VALID_UUID }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errors).toContain('Missing asset: icon.png');
  });

  it('returns 400 for missing sessionId', async () => {
    const res = await BuildPost(buildRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing required field');
  });

  it('returns 404 for non-existent session', async () => {
    vi.mocked(getWorkspace).mockReturnValue(null);

    const res = await BuildPost(
      buildRequest({ sessionId: VALID_UUID }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Session not found');
  });

  it('returns 500 when buildGame throws', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    vi.mocked(buildGame).mockImplementation(() => {
      throw new Error('Build crashed');
    });

    const res = await BuildPost(
      buildRequest({ sessionId: VALID_UUID }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Build crashed');
  });
});

// ===========================================================================
// PREVIEW ROUTE
// ===========================================================================
describe('GET /api/preview/[sessionId]', () => {
  it('returns 200 with HTML for valid session with built output', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    vi.mocked(fsp.readFile).mockResolvedValue('<!DOCTYPE html><html></html>');

    const res = await PreviewGet(
      previewRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(res.headers.get('Content-Type')).toBe('text/html');
  });

  it('returns 400 for invalid UUID sessionId', async () => {
    const res = await PreviewGet(
      previewRequest('not-a-uuid'),
      { params: { sessionId: 'not-a-uuid' } },
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid session ID');
  });

  it('returns 400 for path-traversal sessionId', async () => {
    const res = await PreviewGet(
      previewRequest('../../../etc/passwd'),
      { params: { sessionId: '../../../etc/passwd' } },
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('Invalid session ID');
  });

  it('returns 404 when workspace exists but no build output', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    // fsp.readFile already rejects by default

    const res = await PreviewGet(
      previewRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain('Build output not found');
  });

  it('returns 404 when session does not exist (no workspace, no disk path)', async () => {
    vi.mocked(getWorkspace).mockReturnValue(null);

    const res = await PreviewGet(
      previewRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain('Session not found');
  });

  it('sets security headers on response', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    vi.mocked(fsp.readFile).mockResolvedValue('<!DOCTYPE html><html></html>');

    const res = await PreviewGet(
      previewRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
});

// ===========================================================================
// SESSION ROUTE
// ===========================================================================
describe('GET /api/session/[sessionId]', () => {
  beforeEach(() => {
    // Default: no workspace, no jsonl
    vi.mocked(getWorkspace).mockReturnValue(null);
    vi.mocked(jsonlExists).mockReturnValue(false);
  });

  it('returns 400 for invalid UUID sessionId', async () => {
    const res = await SessionGet(
      sessionRequest('not-a-uuid'),
      { params: { sessionId: 'not-a-uuid' } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid session ID');
  });

  it('returns 400 for path-traversal sessionId', async () => {
    const res = await SessionGet(
      sessionRequest('../../../etc/passwd'),
      { params: { sessionId: '../../../etc/passwd' } },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent session', async () => {
    const res = await SessionGet(
      sessionRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Session not found');
  });

  it('returns 200 with session data for in-memory session', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    // Put an agent in the store so getHistory() returns messages
    const agent = mockAgent();
    agent.getHistory.mockReturnValue([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there', tool_calls: [{ id: 'c1', name: 'read_file', arguments: { path: 'test.js' } }] },
    ]);
    agentSessions.set(VALID_UUID, agent);

    const res = await SessionGet(
      sessionRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sessionId', VALID_UUID);
    expect(body).toHaveProperty('messages');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
    expect(body).toHaveProperty('toolCalls');
    expect(body.toolCalls).toHaveLength(1);
    expect(body.toolCalls[0].name).toBe('read_file');
  });

  it('returns 200 with gameUrl when build output exists', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    vi.mocked(fsp.access).mockResolvedValue(undefined); // output/index.html exists
    vi.mocked(fsp.readdir).mockResolvedValue(['game.js', 'utils.js'] as unknown as fs.Dirent[]);

    const res = await SessionGet(
      sessionRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gameUrl).toBe(`/api/preview/${VALID_UUID}`);
    expect(body.gameFiles).toContain('game.js');
    expect(body.gameFiles).toContain('utils.js');
  });

  it('returns 200 with empty messages and toolCalls for session with no history', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());

    const res = await SessionGet(
      sessionRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toEqual([]);
    expect(body.toolCalls).toEqual([]);
    expect(body.gameUrl).toBeNull();
    expect(body.gameFiles).toEqual([]);
  });

  it('returns 200 for session that exists only on disk (jsonl) with no workspace', async () => {
    vi.mocked(getWorkspace).mockReturnValue(null);
    vi.mocked(jsonlExists).mockReturnValue(true);
    vi.mocked(readJsonl).mockReturnValue([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);

    // Make the jsonl path work for stat (to get createdAt)
    vi.mocked(fsp.stat).mockResolvedValue({
      birthtime: new Date('2025-06-01'),
    } as fs.Stats);

    const res = await SessionGet(
      sessionRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('jsonl');
    expect(body.messages).toHaveLength(2);
    expect(body.createdAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('filters out system messages from history', async () => {
    vi.mocked(getWorkspace).mockReturnValue(mockWorkspace());
    const agent = mockAgent();
    agent.getHistory.mockReturnValue([
      { role: 'system', content: 'you are a game dev' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
    agentSessions.set(VALID_UUID, agent);

    const res = await SessionGet(
      sessionRequest(VALID_UUID),
      { params: { sessionId: VALID_UUID } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).not.toBe('system');
  });
});

// ===========================================================================
// TOOL REGISTRY & DELEGATE SUBAGENT
// ===========================================================================

const TEST_AGENT_CONFIG: AgentConfig = {
  provider: 'deepseek',
  apiKey: 'sk-test-subagent-key-abc123',
  model: 'deepseek-v4-pro',
};

const FALLBACK_AGENT_CONFIG: AgentConfig = {
  ...TEST_AGENT_CONFIG,
  fallbackModel: 'deepseek-v4-flash',
};

describe('toolRegistry', () => {
  it('contains delegate_subagent tool', () => {
    const entry = toolRegistry.find(
      (t) => t.definition.name === 'delegate_subagent',
    );
    expect(entry).toBeDefined();
    expect(entry!.definition.name).toBe('delegate_subagent');
  });

  it('delegate_subagent requires instruction parameter', () => {
    const entry = toolRegistry.find(
      (t) => t.definition.name === 'delegate_subagent',
    );
    const params = entry!.definition.parameters as Record<string, unknown>;
    expect(params.required).toContain('instruction');
  });

  it('all tools have unique names', () => {
    const names = toolRegistry.map((t) => t.definition.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all tool handlers are functions', () => {
    for (const entry of toolRegistry) {
      expect(typeof entry.handler).toBe('function');
    }
  });
});

describe('delegate_subagent handler', () => {
  let handler: (
    args: Record<string, unknown>,
    root: string,
    config?: AgentConfig,
  ) => Promise<string>;
  let mockChatCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const entry = toolRegistry.find(
      (t) => t.definition.name === 'delegate_subagent',
    );
    handler = entry!.handler;

    mockChatCreate = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(OpenAI).mockImplementation(function () {
      return { chat: { completions: { create: mockChatCreate } } };
    } as any);
  });

  // -- Validation -----------------------------------------------------------

  it('returns error when config is missing', async () => {
    const result = await handler(
      { instruction: 'research X' },
      '/tmp/test-workspace',
    );
    expect(result).toContain('requires agent configuration');
  });

  it('returns error when instruction is empty string', async () => {
    const result = await handler(
      { instruction: '' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result).toContain('instruction parameter is required');
  });

  it('returns error when instruction is missing', async () => {
    const result = await handler({}, '/tmp/test-workspace', TEST_AGENT_CONFIG);
    expect(result).toContain('instruction parameter is required');
  });

  // -- Max subagent limit ---------------------------------------------------

  it('enforces max 3 concurrent subagents', async () => {
    // Block first 3 subagents on unresolved promise
    const deferreds: Array<(value: unknown) => void> = [];
    for (let i = 0; i < 3; i++) {
      const p = new Promise((resolve) => {
        deferreds.push(resolve);
      });
      mockChatCreate.mockReturnValueOnce(p);
    }

    const pending: Promise<string>[] = [];
    for (let i = 0; i < 3; i++) {
      pending.push(
        handler(
          { instruction: `task ${i + 1}` },
          '/tmp/test-workspace',
          TEST_AGENT_CONFIG,
        ),
      );
    }

    // Fourth call must fail immediately — no new OpenAI client needed
    const result4 = await handler(
      { instruction: 'task 4 (should fail)' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result4).toContain('Maximum 3 subagents already active');

    // Clean up: resolve pending subagents so counters decrement
    for (const resolve of deferreds) {
      resolve({
        choices: [{ message: { content: 'done' } }],
      });
    }
    await Promise.all(pending);
  });

  // -- Successful delegation (text-only response) ----------------------------

  it('delegates and returns subagent text response', async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: 'Found 3 files matching the pattern.' } },
      ],
    });

    const result = await handler(
      { instruction: 'search for all game.js files in the workspace' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result).toBe('Found 3 files matching the pattern.');
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: TEST_AGENT_CONFIG.apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  });

  it('passes custom baseUrl to subagent client', async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' } }],
    });

    const customConfig: AgentConfig = {
      ...TEST_AGENT_CONFIG,
      baseUrl: 'https://custom.endpoint.com/v1',
    };

    await handler(
      { instruction: 'test' },
      '/tmp/test-workspace',
      customConfig,
    );
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: customConfig.apiKey,
      baseURL: customConfig.baseUrl,
    });
  });

  // -- Delegation with tool calls -------------------------------------------

  it('executes subagent tool calls and returns final response', async () => {
    // First iteration: tool call (read_file)
    mockChatCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: JSON.stringify({
                    path: 'scripts/game.js',
                  }),
                },
              },
            ],
          },
        },
      ],
    });

    // Provide file content for the tool call
    vi.mocked(fs.readFileSync).mockReturnValueOnce(
      'const game = new MyGame();',
    );

    // Second iteration: final text response
    mockChatCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content:
              'The game uses a MyGame class with a standard constructor pattern.',
          },
        },
      ],
    });

    const result = await handler(
      { instruction: 'analyze the game.js structure' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result).toContain('MyGame class');
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it("returns error for tools not in subagent's allowlist", async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'build_game', // NOT in subagent allowlist
                  arguments: JSON.stringify({}),
                },
              },
            ],
          },
        },
      ],
    });

    // Second iteration: text response after tool error
    mockChatCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: 'I tried to build but cannot.' } },
      ],
    });

    const result = await handler(
      { instruction: 'build the game' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    // Should still get a response — tool error is non-fatal for subagent
    expect(result).toContain('I tried to build');
  });

  // -- Iteration limit ------------------------------------------------------

  it('returns gracefully when subagent exceeds max iterations', async () => {
    // Always return tool calls so subagent never produces text
    for (let i = 0; i < 10; i++) {
      mockChatCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: `call_${i}`,
                  type: 'function',
                  function: {
                    name: 'list_directory',
                    arguments: JSON.stringify({ path: '.' }),
                  },
                },
              ],
            },
          },
        ],
      });
    }

    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const result = await handler(
      { instruction: 'keep listing forever' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result).toContain('maximum iterations');
  });

  // -- API error handling ---------------------------------------------------

  it('redacts API key from subagent error messages', async () => {
    mockChatCreate.mockRejectedValueOnce(
      new Error(`Authentication failed for key ${TEST_AGENT_CONFIG.apiKey}`),
    );

    const result = await handler(
      { instruction: 'test' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result).toContain('Subagent error');
    expect(result).not.toContain(TEST_AGENT_CONFIG.apiKey);
    expect(result).toContain('[REDACTED]');
  });

  it('returns error when subagent API call fails', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await handler(
      { instruction: 'test' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result).toContain('Subagent error');
    expect(result).toContain('Network timeout');
  });

  // -- Counter lifecycle ----------------------------------------------------

  it('decrements counter after successful delegation', async () => {
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'done' } }],
    });

    await handler(
      { instruction: 'first' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );

    // Second call to same workspace should succeed (counter back to 0)
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'done again' } }],
    });

    const result2 = await handler(
      { instruction: 'second' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result2).toBe('done again');
    // Both calls should have succeeded without hitting the limit
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('decrements counter after subagent failure', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('crash'));

    await handler(
      { instruction: 'failing task' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );

    // Counter should be decremented even after failure — next call works
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'recovered' } }],
    });

    const result2 = await handler(
      { instruction: 'recovery task' },
      '/tmp/test-workspace',
      TEST_AGENT_CONFIG,
    );
    expect(result2).toBe('recovered');
  });

  // -- Concurrent subagents across different workspaces ----------------------

  it('tracks subagent limits independently per workspace', async () => {
    // Block 3 subagents in workspace A
    const deferred: Array<(value: unknown) => void> = [];
    for (let i = 0; i < 3; i++) {
      const p = new Promise((resolve) => {
        deferred.push(resolve);
      });
      mockChatCreate.mockReturnValueOnce(p);
    }

    const pendingA: Promise<string>[] = [];
    for (let i = 0; i < 3; i++) {
      pendingA.push(
        handler(
          { instruction: `task ${i}` },
          '/tmp/workspace-A',
          TEST_AGENT_CONFIG,
        ),
      );
    }

    // Workspace B should still have 0 active subagents → call succeeds
    mockChatCreate.mockReturnValueOnce(
      Promise.resolve({
        choices: [{ message: { content: 'workspace B result' } }],
      }),
    );

    const resultB = await handler(
      { instruction: 'task in workspace B' },
      '/tmp/workspace-B',
      TEST_AGENT_CONFIG,
    );
    expect(resultB).toBe('workspace B result');

    // Clean up workspace A
    for (const resolve of deferred) {
      resolve({
        choices: [{ message: { content: 'done' } }],
      });
    }
    await Promise.all(pendingA);
  });

  // -- Fallback model --------------------------------------------------------

  it('retries with fallback model when primary fails', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('Model overloaded'));
    mockChatCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Fallback succeeded' } }],
    });

    const result = await handler(
      { instruction: 'test' },
      '/tmp/test-workspace',
      FALLBACK_AGENT_CONFIG,
    );
    expect(result).toBe('Fallback succeeded');
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it('propagates error when fallback also fails', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('Primary down'));
    mockChatCreate.mockRejectedValueOnce(new Error('Fallback down'));

    const result = await handler(
      { instruction: 'test' },
      '/tmp/test-workspace',
      FALLBACK_AGENT_CONFIG,
    );
    expect(result).toContain('Subagent error');
    expect(result).toContain('Fallback down');
  });

  it('propagates error immediately when no fallback configured', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('Model overloaded'));

    const noFallbackConfig: AgentConfig = {
      ...TEST_AGENT_CONFIG,
      fallbackModel: undefined,
    };
    const result = await handler(
      { instruction: 'test' },
      '/tmp/test-workspace',
      noFallbackConfig,
    );
    expect(result).toContain('Subagent error');
    expect(result).toContain('Model overloaded');
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it('skips fallback when fallbackModel equals primary model', async () => {
    mockChatCreate.mockRejectedValueOnce(new Error('Model overloaded'));

    const sameModelConfig: AgentConfig = {
      ...TEST_AGENT_CONFIG,
      fallbackModel: 'deepseek-v4-pro',
    };
    const result = await handler(
      { instruction: 'test' },
      '/tmp/test-workspace',
      sameModelConfig,
    );
    expect(result).toContain('Subagent error');
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// TOOL HANDLER UNIT TESTS
// ===========================================================================

function getHandler(name: string) {
  const entry = toolRegistry.find((t) => t.definition.name === name);
  if (!entry) throw new Error(`Tool not found: ${name}`);
  return entry.handler;
}

const TEST_ROOT = '/tmp/user_space/550e8400-e29b-41d4-a716-446655440000';

describe('read_file handler', () => {
  let handler: ReturnType<typeof getHandler>;

  beforeEach(() => {
    handler = getHandler('read_file');
  });

  it('defaults limit to 2000 when not specified', async () => {
    const content = 'line\n'.repeat(3000).trim();
    vi.mocked(fs.readFileSync).mockReturnValue(content);
    vi.mocked(fs.realpathSync).mockReturnValue(TEST_ROOT + '/scripts/game.js');

    const result = await handler(
      { path: 'scripts/game.js' },
      TEST_ROOT,
    );
    const lines = result.split('\n');
    expect(lines.length).toBeLessThanOrEqual(2000);
  });

  it('respects explicit limit when specified', async () => {
    const content = 'line\n'.repeat(500).trim();
    vi.mocked(fs.readFileSync).mockReturnValue(content);
    vi.mocked(fs.realpathSync).mockReturnValue(TEST_ROOT + '/scripts/game.js');

    const result = await handler(
      { path: 'scripts/game.js', limit: 50 },
      TEST_ROOT,
    );
    const lines = result.split('\n');
    const contentLineCount = lines.filter(
      (l) => !l.startsWith('(lines'),
    ).length;
    expect(contentLineCount).toBeLessThanOrEqual(50);
  });
});

describe('write_file handler', () => {
  let handler: ReturnType<typeof getHandler>;

  beforeEach(() => {
    handler = getHandler('write_file');
    vi.mocked(fs.realpathSync).mockReturnValue(TEST_ROOT + '/scripts/new.js');
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('writes a new file successfully', async () => {
    const result = await handler(
      { path: 'scripts/new.js', content: 'console.log("hello");' },
      TEST_ROOT,
    );
    expect(result).toContain('Successfully wrote');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });

  it('refuses to overwrite existing file by default', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await expect(
      handler(
        { path: 'scripts/existing.js', content: 'new content' },
        TEST_ROOT,
      ),
    ).rejects.toThrow('already exists');
  });

  it('overwrites existing file when overwrite is true', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await handler(
      {
        path: 'scripts/existing.js',
        content: 'replacement content',
        overwrite: true,
      },
      TEST_ROOT,
    );
    expect(result).toContain('Successfully wrote');
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
  });
});

describe('edit_file handler', () => {
  let handler: ReturnType<typeof getHandler>;

  beforeEach(() => {
    handler = getHandler('edit_file');
    vi.mocked(fs.realpathSync).mockReturnValue(
      TEST_ROOT + '/scripts/game.js',
    );
  });

  it('replaces unique old_str with new_str', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      'const x = 1;\nconst y = 2;\n',
    );

    const result = await handler(
      { path: 'scripts/game.js', old_str: 'const x = 1;', new_str: 'let x = 1;' },
      TEST_ROOT,
    );
    expect(result).toContain('Successfully edited');
    expect(vi.mocked(fs.writeFileSync).mock.calls[0][1]).toBe(
      'let x = 1;\nconst y = 2;\n',
    );
  });

  it('throws with line numbers when old_str matches multiple times', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      'line zero\nconst x = 1;\nline two\nconst x = 1;\nline four\n',
    );

    await expect(
      handler(
        {
          path: 'scripts/game.js',
          old_str: 'const x = 1;',
          new_str: 'let x = 1;',
        },
        TEST_ROOT,
      ),
    ).rejects.toThrow(/matched 2 times.*lines: 2, 4/);
  });

  it('throws when old_str is not found', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('some content');

    await expect(
      handler(
        {
          path: 'scripts/game.js',
          old_str: 'nonexistent text',
          new_str: 'replacement',
        },
        TEST_ROOT,
      ),
    ).rejects.toThrow(/Could not find old_str/);
  });
});

describe('write_todo handler', () => {
  let handler: ReturnType<typeof getHandler>;

  beforeEach(() => {
    handler = getHandler('write_todo');
  });

  it('writes todo.md from JSON tasks array', async () => {
    const result = await handler(
      {
        tasks: [
          { task: 'Read scaffold docs', status: 'done' },
          { task: 'Write game logic', status: 'pending' },
          { task: 'Add visual polish', status: 'pending' },
        ],
      },
      TEST_ROOT,
    );
    expect(result).toContain('1 done, 2 pending');
    expect(result).toContain('next: "Write game logic"');

    const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('- [x] Read scaffold docs');
    expect(written).toContain('- [ ] Write game logic');
    expect(written).toContain('- [ ] Add visual polish');
  });

  it('reports all done when no pending tasks', async () => {
    const result = await handler(
      {
        tasks: [
          { task: 'Read scaffold docs', status: 'done' },
          { task: 'Write game logic', status: 'done' },
        ],
      },
      TEST_ROOT,
    );
    expect(result).toContain('2 done, 0 pending');
    expect(result).not.toContain('next:');
  });

  it('throws when tasks is not an array', async () => {
    await expect(
      handler({ tasks: 'not-an-array' }, TEST_ROOT),
    ).rejects.toThrow(/non-empty array/);
  });

  it('throws when tasks array is empty', async () => {
    await expect(handler({ tasks: [] }, TEST_ROOT)).rejects.toThrow(
      /non-empty array/,
    );
  });
});

describe('build_game handler', () => {
  let handler: ReturnType<typeof getHandler>;

  beforeEach(() => {
    handler = getHandler('build_game');
  });

  it('returns BUILD SUCCESS with zero errors', async () => {
    vi.mocked(buildGame).mockReturnValue({
      html: '<html></html>',
      outputPath: `${TEST_ROOT}/output/index.html`,
      errors: [],
    });

    const result = await handler({}, TEST_ROOT);
    expect(result).toContain('BUILD SUCCESS');
  });

  it('returns BUILD FAILED with numbered error list', async () => {
    vi.mocked(buildGame).mockReturnValue({
      html: '',
      outputPath: '',
      errors: ['Syntax error in game.js', 'Missing utils.js'],
    });

    const result = await handler({}, TEST_ROOT);
    expect(result).toContain('BUILD FAILED');
    expect(result).toContain('1. Syntax error in game.js');
    expect(result).toContain('2. Missing utils.js');
  });

  it('returns BUILD CRASHED when buildGame throws', async () => {
    vi.mocked(buildGame).mockImplementation(() => {
      throw new Error('System panic');
    });

    const result = await handler({}, TEST_ROOT);
    expect(result).toContain('BUILD CRASHED');
    expect(result).toContain('System panic');
  });
});

describe('load_skills handler', () => {
  let handler: ReturnType<typeof getHandler>;

  beforeEach(() => {
    handler = getHandler('load_skills');
  });

  it('includes skill-creator.md as built-in skill', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      const fpath = String(p);
      if (fpath.includes('skill-creator.md')) {
        return '---\nname: skill-creator\ndescription: Template for creating skills\ntriggers: create skill, new skill\n---\n# Skill Creator';
      }
      if (fpath.includes('examples/')) {
        return '---\nname: pixel-art\ndescription: Pixel art games\ntriggers: pixel art, retro\n---\n# Pixel Art';
      }
      return '';
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'pixel-art-games.md', isFile: () => true, isDirectory: () => false },
    ] as any);

    const result = await handler({}, TEST_ROOT);
    const skills = JSON.parse(result);
    expect(skills).toHaveLength(2);
    expect(skills[0].file).toBe('skill-creator.md');
    expect(skills[0].name).toBe('skill-creator');
    expect(skills[1].file).toBe('pixel-art-games.md');
  });

  it('still returns example skills when skill-creator is missing', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((p: any) => {
      const fpath = String(p);
      if (fpath.includes('skill-creator.md')) {
        throw new Error('ENOENT');
      }
      return '---\nname: pixel-art\ndescription: Pixel art games\ntriggers: pixel art\n---\n# Pixel Art';
    });
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'pixel-art-games.md', isFile: () => true, isDirectory: () => false },
    ] as any);

    const result = await handler({}, TEST_ROOT);
    const skills = JSON.parse(result);
    expect(skills).toHaveLength(1);
    expect(skills[0].file).toBe('pixel-art-games.md');
  });
});

describe('validatePath', () => {
  it('rejects workspace roots not under user_space/', async () => {
    const handler = getHandler('read_file');
    const badRoot = '/tmp/not-user-space/session-id';

    await expect(
      handler({ path: 'test.js' }, badRoot),
    ).rejects.toThrow(/user_space/);
  });

  it('accepts workspace roots under user_space/', async () => {
    const handler = getHandler('read_file');
    const goodRoot = '/tmp/user_space/session-id';
    vi.mocked(fs.realpathSync).mockReturnValue(goodRoot + '/test.js');
    vi.mocked(fs.readFileSync).mockReturnValue('content');

    const result = await handler({ path: 'test.js' }, goodRoot);
    expect(result).toBeDefined();
  });
});
