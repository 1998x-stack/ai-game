import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
vi.mock('@/lib/session/capability', () => ({ hasSessionCapability: vi.fn() }));
vi.mock('@/lib/workspace/manager', () => ({ getWorkspace: vi.fn(), restoreWorkspace: vi.fn() }));
vi.mock('@/lib/sandbox/jobs', () => ({
  enqueueSandboxJob: vi.fn(), readSandboxJob: vi.fn(), cancelSandboxJob: vi.fn(),
}));
import { hasSessionCapability } from '@/lib/session/capability';
import { getWorkspace } from '@/lib/workspace/manager';
import { enqueueSandboxJob, readSandboxJob, cancelSandboxJob } from '@/lib/sandbox/jobs';
import { GET, POST, DELETE } from '@/app/api/sandbox-jobs/[sessionId]/route';
const id = 'dc90eaf9-f093-4ac8-aad5-7464cbda929a';
const jobId = 'a89d434b-b814-4ac9-8b32-c6f0999f9883';
const base = 'http://localhost:3000/api/sandbox-jobs/' + id;
const ctx = { params: { sessionId: id } };
const homes: string[] = [];
let prev: string | undefined;
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage4-api-'));
  homes.push(root);
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'output/index.html'), '<html><canvas id="gameCanvas"></canvas></html>');
  fs.writeFileSync(path.join(root, 'game.test.json'), JSON.stringify({
    schemaVersion: 1, name: 'Boot', seed: 2, viewport: { width: 640, height: 480 },
    scenarios: [{ id: 'boot', name: 'Boot', actions: [{ type: 'wait', ms: 1 }],
      assertions: [{ type: 'no-errors' }] }],
  }));
  vi.mocked(getWorkspace).mockReturnValue({
    sessionId: id, workspacePath: root, createdAt: new Date(), lastActiveAt: new Date(),
  });
  return root;
}
function request(method: string, suffix = '', origin?: string) {
  return new Request(base + suffix, {
    method, ...(origin ? { headers: { origin } } : {}),
  });
}
beforeEach(() => {
  prev = process.env.AI_GAME_SANDBOX_IMAGE;
  process.env.AI_GAME_SANDBOX_IMAGE = 'sha256:' + 'a'.repeat(64);
  vi.resetAllMocks();
  vi.mocked(hasSessionCapability).mockReturnValue(true);
  vi.mocked(enqueueSandboxJob).mockReturnValue({
    schemaVersion: 1, id: jobId, status: 'queued', isolated: false,
    createdAt: '', updatedAt: '', gameSha256: 'x', contractSha256: 'y',
  });
});
afterEach(() => {
  if (prev === undefined) delete process.env.AI_GAME_SANDBOX_IMAGE;
  else process.env.AI_GAME_SANDBOX_IMAGE = prev;
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});
describe('session-scoped Docker job API', () => {
  it('forbids unauthorized or cross-site job actions', async () => {
    makeRoot();
    vi.mocked(hasSessionCapability).mockReturnValue(false);
    expect((await POST(request('POST', '', 'http://localhost:3000'), ctx)).status).toBe(403);
    vi.mocked(hasSessionCapability).mockReturnValue(true);
    expect((await POST(request('POST', '', 'https://attacker.invalid'), ctx)).status).toBe(403);
    expect((await DELETE(request('DELETE', '?id=' + jobId), ctx)).status).toBe(403);
    expect((await GET(request('GET'), { params: { sessionId: '../invalid' } })).status).toBe(400);
    expect(enqueueSandboxJob).not.toHaveBeenCalled();
  });
  it('requires locally pinned image and bounded existing files before enqueue', async () => {
    const root = makeRoot();
    delete process.env.AI_GAME_SANDBOX_IMAGE;
    expect((await POST(request('POST', '', 'http://localhost:3000'), ctx)).status).toBe(400);
    process.env.AI_GAME_SANDBOX_IMAGE = 'sha256:' + 'a'.repeat(64);
    const response = await POST(request('POST', '', 'http://localhost:3000'), ctx);
    expect(response.status).toBe(202);
    expect(enqueueSandboxJob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enqueueSandboxJob).mock.calls[0][0]).toBe(root);
    fs.rmSync(path.join(root, 'game.test.json'));
    expect((await POST(request('POST', '', 'http://localhost:3000'), ctx)).status).toBe(400);
  });
  it('reads a UUID-scoped receipt and handles cancellation', async () => {
    makeRoot();
    vi.mocked(readSandboxJob).mockReturnValue({
      schemaVersion: 1, id: jobId, status: 'running', isolated: false,
      createdAt: '', updatedAt: '', gameSha256: 'x', contractSha256: 'y',
    });
    vi.mocked(cancelSandboxJob).mockReturnValue({
      schemaVersion: 1, id: jobId, status: 'cancelled', isolated: false,
      createdAt: '', updatedAt: '', gameSha256: 'x', contractSha256: 'y',
    });
    const found = await GET(request('GET', '?id=' + jobId), ctx);
    expect(found.status, await found.text()).toBe(200);
    expect((await DELETE(request('DELETE', '?id=' + jobId, 'http://localhost:3000'), ctx)).status).toBe(200);
    expect((await GET(request('GET', '?id=../../etc/passwd'), ctx)).status).toBe(400);
  });
});
