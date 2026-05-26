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
    expect(existingAgent.sendMessage).toHaveBeenCalledWith('second message');
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
