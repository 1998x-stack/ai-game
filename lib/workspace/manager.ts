import { mkdir, cp, rm } from 'fs/promises';
import * as path from 'path';

const BASE_WORKSPACE_PATH = path.join(process.cwd(), 'user_space');
const SCAFFOLD_PATH = path.join(process.cwd(), 'workspace');

export interface WorkspaceSession {
  sessionId: string;
  workspacePath: string;
  createdAt: Date;
  lastActiveAt: Date;
}

const sessions = new Map<string, WorkspaceSession>();

const MAX_ACTIVE_SESSIONS = 100;

export async function createWorkspace(sessionId: string): Promise<WorkspaceSession> {
  if (sessions.size >= MAX_ACTIVE_SESSIONS) {
    const oldest = [...sessions.entries()].sort(
      (a, b) => a[1].lastActiveAt.getTime() - b[1].lastActiveAt.getTime(),
    )[0];
    if (oldest) {
      await deleteWorkspace(oldest[0]).catch(() => {});
    }
  }

  const workspacePath = path.join(BASE_WORKSPACE_PATH, sessionId);

  await mkdir(path.join(workspacePath, 'scripts'), { recursive: true });
  await mkdir(path.join(workspacePath, 'assets'), { recursive: true });
  await mkdir(path.join(workspacePath, 'output'), { recursive: true });

  await copyScaffoldToWorkspace(workspacePath);

  const now = new Date();
  const session: WorkspaceSession = {
    sessionId,
    workspacePath,
    createdAt: now,
    lastActiveAt: now,
  };

  sessions.set(sessionId, session);
  return session;
}

export function getWorkspace(sessionId: string): WorkspaceSession | null {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActiveAt = new Date();
  }
  return session ?? null;
}

export async function deleteWorkspace(sessionId: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;

  sessions.delete(sessionId);

  await rm(session.workspacePath, { recursive: true, force: true });
  return true;
}

export async function cleanupStaleWorkspaces(maxAgeMs: number = 3600000): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;

  const stale: string[] = [];
  for (const [id, s] of sessions.entries()) {
    if (s.lastActiveAt.getTime() < cutoff) stale.push(id);
  }

  await Promise.allSettled(stale.map((id) => deleteWorkspace(id)));
  return stale.length;
}

export async function copyScaffoldToWorkspace(
  workspacePath: string,
  template?: string,
): Promise<void> {
  await mkdir(path.join(workspacePath, 'scripts'), { recursive: true });
  await mkdir(path.join(workspacePath, 'assets'), { recursive: true });

  const dirs = ['docs', 'templates', 'lib', 'skills'];
  for (const dir of dirs) {
    await cp(
      path.join(SCAFFOLD_PATH, dir),
      path.join(workspacePath, dir),
      { recursive: true, force: true },
    ).catch(() => {});
  }

  for (const file of ['agent.md', 'claude.md']) {
    await cp(
      path.join(SCAFFOLD_PATH, file),
      path.join(workspacePath, file),
    ).catch(() => {});
  }

  await cp(
    path.join(SCAFFOLD_PATH, 'lib', 'utils.js'),
    path.join(workspacePath, 'scripts', 'utils.js'),
  ).catch(() => {});

  if (template) {
    await cp(
      path.join(SCAFFOLD_PATH, 'templates', template, 'game.js'),
      path.join(workspacePath, 'scripts', 'game.js'),
    ).catch(() => {});
  }
}
