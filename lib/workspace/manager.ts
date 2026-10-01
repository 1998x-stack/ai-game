import { mkdir, cp, rm } from 'fs/promises';
import * as path from 'path';
import { access } from 'fs/promises';
import { CONFIG } from '@/lib/config';
import { initGitRepo } from '@/lib/git';

const BASE_WORKSPACE_PATH = path.join(process.cwd(), 'user_space');
const SCAFFOLD_PATH = path.join(process.cwd(), 'workspace');

export interface WorkspaceSession {
  sessionId: string;
  workspacePath: string;
  createdAt: Date;
  lastActiveAt: Date;
}

const sessions = new Map<string, WorkspaceSession>();

function assertSessionId(sessionId: string): void {
  if (!CONFIG.validation.uuidPattern.test(sessionId)) {
    throw new Error('Invalid session ID format');
  }
}

function registerSession(sessionId: string, workspacePath: string): WorkspaceSession {
  const now = new Date();
  const session: WorkspaceSession = { sessionId, workspacePath, createdAt: now, lastActiveAt: now };
  sessions.set(sessionId, session);
  return session;
}

export async function createWorkspace(sessionId: string): Promise<WorkspaceSession> {
  assertSessionId(sessionId);
  if (sessions.size >= CONFIG.workspace.maxActiveSessions) {
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
  initGitRepo(workspacePath);

  return registerSession(sessionId, workspacePath);
}

export async function restoreWorkspace(sessionId: string): Promise<WorkspaceSession> {
  assertSessionId(sessionId);
  if (sessions.size >= CONFIG.workspace.maxActiveSessions) {
    const oldest = [...sessions.entries()].sort(
      (a, b) => a[1].lastActiveAt.getTime() - b[1].lastActiveAt.getTime(),
    )[0];
    if (oldest) {
      await deleteWorkspace(oldest[0]).catch(() => {});
    }
  }

  const workspacePath = path.join(BASE_WORKSPACE_PATH, sessionId);

  const gameJsExists = await access(path.join(workspacePath, 'scripts', 'game.js'))
    .then(() => true)
    .catch(() => false);

  if (!gameJsExists) {
    return createWorkspace(sessionId);
  }

  // Workspace already exists — ensure dirs + register, skip scaffold copy
  await mkdir(path.join(workspacePath, 'scripts'), { recursive: true });
  await mkdir(path.join(workspacePath, 'assets'), { recursive: true });
  await mkdir(path.join(workspacePath, 'output'), { recursive: true });

  // Do NOT copy scaffold — preserves agent additions to utils.js, gotchas.md, etc.

  const gitExists = await access(path.join(workspacePath, '.git'))
    .then(() => true)
    .catch(() => false);

  if (!gitExists) {
    initGitRepo(workspacePath);
  }

  return registerSession(sessionId, workspacePath);
}

export async function workspaceExistsOnDisk(sessionId: string): Promise<boolean> {
  assertSessionId(sessionId);
  const workspacePath = path.join(BASE_WORKSPACE_PATH, sessionId);
  return access(path.join(workspacePath, 'scripts', 'game.js'))
    .then(() => true)
    .catch(() => false);
}

export function getWorkspace(sessionId: string): WorkspaceSession | null {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastActiveAt = new Date();
  }
  return session ?? null;
}

export async function deleteWorkspace(sessionId: string): Promise<boolean> {
  assertSessionId(sessionId);
  const session = sessions.get(sessionId);
  if (!session) return false;

  sessions.delete(sessionId);

  await rm(session.workspacePath, { recursive: true, force: true });
  return true;
}

export async function cleanupStaleWorkspaces(maxAgeMs: number = CONFIG.workspace.staleCleanupMs): Promise<number> {
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
