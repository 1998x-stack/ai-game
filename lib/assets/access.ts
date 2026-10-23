import fs from 'fs';
import path from 'path';
import { CONFIG } from '@/lib/config';
import { getWorkspace, restoreWorkspace } from '@/lib/workspace/manager';
import { hasSessionCapability } from '@/lib/session/capability';

export async function assetWorkspace(sessionId: string): Promise<string | null> {
  const current = getWorkspace(sessionId);
  if (current) return current.workspacePath;
  const root = path.join(process.cwd(), 'user_space', sessionId);
  if (!fs.existsSync(path.join(root, 'agent.md'))) return null;
  return (await restoreWorkspace(sessionId)).workspacePath;
}
export function assetRequestGuard(request: Request, sessionId: string, mutation: boolean): Response | null {
  if (!CONFIG.validation.uuidPattern.test(sessionId)) {
    return Response.json({ error: 'Invalid session ID' }, { status: 400 });
  }
  if (!hasSessionCapability(sessionId)) {
    return Response.json({ error: 'Session capability required' }, { status: 403 });
  }
  if (mutation) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host') || new URL(request.url).host;
    const protocol = (request.headers.get('x-forwarded-proto') ||
      new URL(request.url).protocol.replace(':', '')).split(',')[0].trim();
    let valid = false;
    try {
      const source = origin ? new URL(origin) : null;
      valid = Boolean(source && source.host === host && source.protocol === protocol + ':' &&
        source.pathname === '/' && !source.search && !source.hash &&
        !source.username && !source.password);
    } catch { /* reject malformed Origin */ }
    if (!valid || request.headers.get('sec-fetch-site') === 'cross-site') {
      return Response.json({ error: 'Same-origin request required' }, { status: 403 });
    }
  }
  return null;
}
