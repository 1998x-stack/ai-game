import { CONFIG } from '@/lib/config';
import { getWorkspace, restoreWorkspace } from '@/lib/workspace/manager';
import { hasSessionCapability } from '@/lib/session/capability';
import { BoardConflictError, loadBoardWorkspace, saveDesignBoard } from '@/lib/design-board/store';
import fs from 'fs';
import path from 'path';

async function workspaceRoot(sessionId: string): Promise<string | null> {
  const existing = getWorkspace(sessionId);
  if (existing) return existing.workspacePath;
  // Do not create projects during GET/PUT. Restore only an existing scaffold.
  const root = path.join(process.cwd(), 'user_space', sessionId);
  if (!fs.existsSync(path.join(root, 'agent.md'))) return null;
  return (await restoreWorkspace(sessionId)).workspacePath;
}
function guard(request: Request, sessionId: string, mutation: boolean): Response | null {
  if (!CONFIG.validation.uuidPattern.test(sessionId)) {
    return Response.json({ error: 'Invalid session ID' }, { status: 400 });
  }
  if (!hasSessionCapability(sessionId)) {
    return Response.json({ error: 'Session capability required' }, { status: 403 });
  }
  if (mutation) {
    const origin = request.headers.get('origin');
    const targetHost = request.headers.get('host') || new URL(request.url).host;
    const proto = (request.headers.get('x-forwarded-proto') ||
      new URL(request.url).protocol.replace(':', '')).split(',')[0].trim();
    let sameOrigin = false;
    try {
      const incoming = origin ? new URL(origin) : null;
      sameOrigin = Boolean(incoming && incoming.host === targetHost &&
        incoming.protocol === proto + ':' && incoming.pathname === '/' &&
        !incoming.search && !incoming.hash && !incoming.username && !incoming.password);
    } catch { /* reject malformed Origin */ }
    if (!sameOrigin || request.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: 'Same-origin request required' }, { status: 403 });
    }
  }
  return null;
}
export async function GET(request: Request, { params }: { params: { sessionId: string } }) {
  const denied = guard(request, params.sessionId, false);
  if (denied) return denied;
  try {
    const root = await workspaceRoot(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json(loadBoardWorkspace(root), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Unable to load design board' }, { status: 500 });
  }
}
export async function PUT(request: Request, { params }: { params: { sessionId: string } }) {
  const denied = guard(request, params.sessionId, true);
  if (denied) return denied;
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && Number(contentLength) > 160_000) {
      return Response.json({ error: 'Board payload too large' }, { status: 413 });
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Expected design board object' }, { status: 400 });
    }
    const { board, revision } = body as Record<string, unknown>;
    if (JSON.stringify(body).length > 160_000) {
      return Response.json({ error: 'Board payload too large' }, { status: 413 });
    }
    const root = await workspaceRoot(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    const result = saveDesignBoard(root, board, revision as string);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof BoardConflictError) {
      return Response.json({ error: err.message, conflict: true }, { status: 409 });
    }
    return Response.json({
      error: (err instanceof Error ? err.message : 'Unable to save board').slice(0, 240),
    }, { status: 400 });
  }
}
