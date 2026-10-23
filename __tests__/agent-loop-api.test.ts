import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session/capability', () => ({
  hasSessionCapability: vi.fn(),
}));
vi.mock('@/lib/workspace/manager', () => ({
  getWorkspace: vi.fn(),
  restoreWorkspace: vi.fn(),
}));
vi.mock('@/lib/agent-loop/service', () => ({
  executeHumanLoopDecision: vi.fn(),
}));
vi.mock('@/lib/agent-loop/state', () => ({
  loadLoopState: vi.fn(),
}));
import { hasSessionCapability } from '@/lib/session/capability';
import { getWorkspace } from '@/lib/workspace/manager';
import { executeHumanLoopDecision } from '@/lib/agent-loop/service';
import { loadLoopState } from '@/lib/agent-loop/state';
import { GET, POST } from '@/app/api/game-loop/[sessionId]/route';

const id = '37940ef5-19c2-4bac-a548-d29220508167';
const ctx = { params: { sessionId: id } };
function req(method: string, headers: Record<string, string> = {}, body?: unknown) {
  return new Request('http://localhost:3000/api/game-loop/' + id, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const sameOrigin = { origin: 'http://localhost:3000' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hasSessionCapability).mockReturnValue(true);
  vi.mocked(getWorkspace).mockReturnValue({ workspacePath: '/tmp/game-user-space', sessionId: id,
    createdAt: new Date(), lastActiveAt: new Date() });
  vi.mocked(loadLoopState).mockReturnValue(null);
  vi.mocked(executeHumanLoopDecision).mockReturnValue(JSON.stringify({ phase: 'accepted' }));
});
describe('project-owner-only agent loop decisions', () => {
  it('denies missing session capability', async () => {
    vi.mocked(hasSessionCapability).mockReturnValue(false);
    expect((await GET(req('GET'), ctx)).status).toBe(403);
    expect((await POST(req('POST', sameOrigin, { action: 'approve' }), ctx)).status).toBe(403);
    expect(executeHumanLoopDecision).not.toHaveBeenCalled();
  });
  it('rejects invalid UUIDs before reading a workspace', async () => {
    expect((await GET(req('GET'), { params: { sessionId: '../etc/passwd' } })).status).toBe(400);
    expect(getWorkspace).not.toHaveBeenCalled();
  });
  it('rejects missing, forged and cross-site Origin', async () => {
    expect((await POST(req('POST', {}, { action: 'approve' }), ctx)).status).toBe(403);
    expect((await POST(req('POST', { origin: 'https://evil.example' }, { action: 'cancel' }), ctx)).status).toBe(403);
    expect((await POST(req('POST', { ...sameOrigin, 'sec-fetch-site': 'cross-site' }, { action: 'cancel' }), ctx)).status).toBe(403);
    expect(executeHumanLoopDecision).not.toHaveBeenCalled();
  });
  it('does not expose model-accessible approval operations', async () => {
    const invalid = await POST(req('POST', sameOrigin, { action: 'publish' }), ctx);
    expect(invalid.status).toBe(400);
    expect(executeHumanLoopDecision).not.toHaveBeenCalled();
  });
  it('provides authorized state and user-triggered decision', async () => {
    const get = await GET(req('GET'), ctx);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ state: null });
    const post = await POST(req('POST', sameOrigin, { action: 'approve' }), ctx);
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ phase: 'accepted' });
    expect(executeHumanLoopDecision).toHaveBeenCalledWith('/tmp/game-user-space', 'approve');
  });
});
