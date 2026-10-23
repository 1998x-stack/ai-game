import fs from 'fs';
import path from 'path';
import { CONFIG } from '@/lib/config';
import { hasSessionCapability } from '@/lib/session/capability';
import { getWorkspace, restoreWorkspace } from '@/lib/workspace/manager';
import { executeHumanLoopDecision } from '@/lib/agent-loop/service';
import { loadLoopState } from '@/lib/agent-loop/state';

async function authorizedWorkspace(sessionId: string): Promise<string | null> {
  const registered = getWorkspace(sessionId);
  if (registered) return registered.workspacePath;
  const root = path.join(process.cwd(), 'user_space', sessionId);
  if (!fs.existsSync(path.join(root, 'agent.md'))) return null;
  return (await restoreWorkspace(sessionId)).workspacePath;
}
function reject(request: Request, sessionId: string, isMutation: boolean): Response | null {
  if (!CONFIG.validation.uuidPattern.test(sessionId)) {
    return Response.json({ error: 'Invalid session ID' }, { status: 400 });
  }
  if (!hasSessionCapability(sessionId)) {
    return Response.json({ error: 'Session capability required' }, { status: 403 });
  }
  if (isMutation) {
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin ||
        request.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: 'Same-origin request required' }, { status: 403 });
    }
  }
  return null;
}
export async function GET(request: Request, { params }: { params: { sessionId: string } }) {
  const rejected = reject(request, params.sessionId, false);
  if (rejected) return rejected;
  try {
    const root = await authorizedWorkspace(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json({ state: loadLoopState(root) });
  } catch {
    return Response.json({ error: 'Unable to load workflow' }, { status: 500 });
  }
}
export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  const rejected = reject(request, params.sessionId, true);
  if (rejected) return rejected;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Expected action object' }, { status: 400 });
    }
    const action = (body as { action?: unknown }).action;
    if (action !== 'approve' && action !== 'cancel') {
      return Response.json({ error: 'Only approve or cancel is allowed' }, { status: 400 });
    }
    const root = await authorizedWorkspace(params.sessionId);
    if (!root) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return new Response(executeHumanLoopDecision(root, action), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json({
      error: (error instanceof Error ? error.message : 'Unable to update workflow').slice(0, 200),
    }, { status: 409 });
  }
}
