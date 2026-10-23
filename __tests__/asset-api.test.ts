import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodePng } from '@/lib/assets/png';

vi.mock('@/lib/session/capability', () => ({ hasSessionCapability: vi.fn() }));
vi.mock('@/lib/workspace/manager', () => ({
  getWorkspace: vi.fn(), restoreWorkspace: vi.fn(),
}));
import { hasSessionCapability } from '@/lib/session/capability';
import { getWorkspace } from '@/lib/workspace/manager';
import { GET, POST } from '@/app/api/assets/[sessionId]/route';
import { GET as GET_BINARY } from '@/app/api/assets/[sessionId]/[id]/route';

const id = 'dffbbaef-d3f9-49ef-9066-95acb3378a5e';
const host = 'http://localhost:3000';
const ctx = { params: { sessionId: id } };
const roots: string[] = [];
function png() { return encodePng({ width: 2, height: 2, pixels: Buffer.alloc(16, 255) }); }
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-asset-api-'));
  roots.push(root); fs.mkdirSync(path.join(root, 'assets'));
  vi.mocked(getWorkspace).mockReturnValue({
    sessionId: id, workspacePath: root, createdAt: new Date(), lastActiveAt: new Date(),
  });
  return root;
}
function uploadRequest(bytes = png(), mime = 'image/png', origin = host) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'sprite.png', { type: mime }));
  form.append('license', 'owned');
  return new Request(host + '/api/assets/' + id, {
    method: 'POST', headers: { origin }, body: form,
  });
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(hasSessionCapability).mockReturnValue(true); });
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe('authenticated asset import and content-addressed serving', () => {
  it('uploads, catalogs, deduplicates and serves a safe image by hash', async () => {
    setup();
    const first = await POST(uploadRequest(), ctx);
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.asset.kind).toBe('image');
    expect((await POST(uploadRequest(), ctx)).status).toBe(200);
    const catalog = await GET(new Request(host + '/api/assets/' + id), ctx);
    expect((await catalog.json()).entries).toHaveLength(1);
    const binary = await GET_BINARY(new Request(host + '/api/assets/' + id + '/' + body.asset.id),
      { params: { ...ctx.params, id: body.asset.id } });
    expect(binary.status).toBe(200);
    expect(binary.headers.get('content-type')).toBe('image/png');
    expect(binary.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await binary.arrayBuffer()).equals(png())).toBe(true);
  });
  it('rejects bad IDs, missing capability and cross-origin writes', async () => {
    setup();
    vi.mocked(hasSessionCapability).mockReturnValue(false);
    expect((await GET(new Request(host + '/api/assets/' + id), ctx)).status).toBe(403);
    expect((await POST(uploadRequest(), ctx)).status).toBe(403);
    vi.mocked(hasSessionCapability).mockReturnValue(true);
    expect((await POST(uploadRequest(png(), 'image/png', 'https://attacker.invalid'), ctx)).status).toBe(403);
    expect((await GET(new Request(host + '/api/assets/' + id),
      { params: { sessionId: '../../../etc' } })).status).toBe(400);
  });
  it('rejects executable SVG and size overflow', async () => {
    setup();
    expect((await POST(uploadRequest(Buffer.from('<svg onload="alert(1)"></svg>'),
      'image/svg+xml'), ctx)).status).toBe(400);
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 80);
    expect((await POST(uploadRequest(oversized), ctx)).status).toBe(413);
  });
  it('creates deterministic PNG atlas and returns frame coordinates', async () => {
    setup();
    const first = await (await POST(uploadRequest(), ctx)).json();
    const response = await POST(new Request(host + '/api/assets/' + id, {
      method: 'POST', headers: { origin: host, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'atlas', ids: [first.asset.id] }),
    }), ctx);
    expect(response.status).toBe(201);
    const generated = await response.json();
    expect(generated.asset.atlasFrames).toHaveLength(1);
    expect(generated.asset.width).toBe(1024);
  });
});
