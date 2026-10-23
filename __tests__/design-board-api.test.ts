import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('@/lib/session/capability', () => ({ hasSessionCapability: vi.fn() }));
vi.mock('@/lib/workspace/manager', () => ({
  getWorkspace: vi.fn(), restoreWorkspace: vi.fn(),
}));
import { hasSessionCapability } from '@/lib/session/capability';
import { getWorkspace } from '@/lib/workspace/manager';
import { GET, PUT } from '@/app/api/design-board/[sessionId]/route';
import { BoardConflictError, loadDesignBoard, saveDesignBoard } from '@/lib/design-board/store';

const id = '73e2a765-b3de-41ef-baf6-ac107a6999ff';
const context = { params: { sessionId: id } };
const roots: string[] = [];
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-design-board-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'sprite.png'), 'test');
  fs.copyFileSync(path.join(process.cwd(), 'workspace', 'templates', 'snake', 'design.json'),
    path.join(root, 'game.design.json'));
  vi.mocked(getWorkspace).mockReturnValue({ sessionId: id, workspacePath: root,
    createdAt: new Date(), lastActiveAt: new Date() });
  return root;
}
function req(method: 'GET'|'PUT', payload?: unknown, origin?: string) {
  return new Request('http://localhost:3000/api/design-board/' + id, {
    method, ...(origin ? { headers: { origin, 'Content-Type': 'application/json' } } : {}),
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(hasSessionCapability).mockReturnValue(true); });
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('design-board API, file persistence and conflict prevention', () => {
  it('derives initial nodes from GDD without writing a file on GET', async () => {
    const root = workspace();
    const response = await GET(req('GET'), context);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.board.nodes.length).toBe(3);
    expect(json.board.nodes[0].reference).toBe('movement');
    expect(json.assets).toContain('assets/sprite.png');
    expect(fs.existsSync(path.join(root, 'design.board.json'))).toBe(false);
  });
  it('rejects unsupported IDs, absent capabilities and CSRF submissions', async () => {
    workspace();
    vi.mocked(hasSessionCapability).mockReturnValue(false);
    expect((await GET(req('GET'), context)).status).toBe(403);
    vi.mocked(hasSessionCapability).mockReturnValue(true);
    expect((await GET(req('GET'), { params: { sessionId: '../pass' } })).status).toBe(400);
    const data = await (await GET(req('GET'), context)).json();
    expect((await PUT(req('PUT', { board: data.board, revision: data.revision }), context)).status).toBe(403);
    expect((await PUT(req('PUT', { board: data.board, revision: data.revision },
      'https://malicious.invalid'), context)).status).toBe(403);
  });
  it('supports optimistic CAS, reload, stale revision conflict and no silent overwrite', async () => {
    const root = workspace();
    const first = await (await GET(req('GET'), context)).json();
    first.board.nodes[0].title = 'Snake Controls';
    const response = await PUT(req('PUT', { board: first.board, revision: first.revision },
      'http://localhost:3000'), context);
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.revision).not.toBe(first.revision);
    expect(loadDesignBoard(root).board.nodes[0].title).toBe('Snake Controls');
    const second = await PUT(req('PUT', { board: first.board, revision: first.revision },
      'http://localhost:3000'), context);
    expect(second.status).toBe(409);
    expect((await second.json()).conflict).toBe(true);
    expect(loadDesignBoard(root).revision).toBe(saved.revision);
  });
  it('does not overwrite while another process holds the board lock', () => {
    const root = workspace();
    const snapshot = loadDesignBoard(root);
    const lock = path.join(root, 'design.board.lock');
    fs.writeFileSync(lock, 'hold', { flag: 'wx' });
    expect(() => saveDesignBoard(root, snapshot.board, snapshot.revision)).toThrow(BoardConflictError);
  });
  it('rejects extra executable fields and dangling connections', async () => {
    workspace();
    const data = await (await GET(req('GET'), context)).json();
    const invalid = { ...data.board, html: '<script>alert(1)</script>' };
    const res = await PUT(req('PUT', { board: invalid, revision: data.revision },
      'http://localhost:3000'), context);
    expect(res.status).toBe(400);
  });
  it('prevents symlink writes outside the designated workspace', () => {
    const root = workspace();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'board-external-'));
    roots.push(external);
    fs.symlinkSync(path.join(external, 'secret'), path.join(root, 'design.board.json'));
    const initialHash = crypto.createHash('sha256').update('').digest('hex');
    expect(() => saveDesignBoard(root, { schemaVersion: 1, title: 'Test', nodes: [], edges: [] },
      initialHash)).toThrow();
    expect(fs.existsSync(path.join(external, 'secret'))).toBe(false);
  });
});
