import { mkdir, writeFile, rm, copyFile } from 'fs/promises';
import * as path from 'path';

const BASE_WORKSPACE_PATH = path.join(process.cwd(), 'user_space');
const TEMPLATES_BASE_PATH = path.join(process.cwd(), 'workspace', 'templates');

export interface WorkspaceSession {
  sessionId: string;
  workspacePath: string;
  createdAt: Date;
  lastActiveAt: Date;
}

const sessions = new Map<string, WorkspaceSession>();

const MAX_ACTIVE_SESSIONS = 100;

export async function createWorkspace(sessionId: string): Promise<WorkspaceSession> {
  // Enforce session cap to prevent disk / memory exhaustion
  if (sessions.size >= MAX_ACTIVE_SESSIONS) {
    // Evict oldest inactive session
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

  await generateAgentMd(workspacePath);
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

export async function generateAgentMd(workspacePath: string): Promise<void> {
  const content = [
    '# Agent System Instructions',
    '',
    '## Workspace Constraints',
    '- You may ONLY read and write files within this workspace directory.',
    '- Do NOT access any files outside user_space/.',
    '- Do NOT read or modify this agent.md file.',
    '',
    '## Game Code Rules',
    '- All games use pure HTML5 Canvas and JavaScript. No WebAssembly.',
    '- Read workspace/docs/gotchas.md before generating any game code to avoid known pitfalls.',
    '- Read workspace/docs/game-dev-guide.md for game development patterns and best practices.',
    '- Read workspace/docs/game-patterns.md for reusable game architecture patterns.',
    '- Study the relevant template in workspace/templates/ before generating a new game.',
    '- Use the utility library in scripts/utils.js for game loop, input, collision detection, etc.',
    '',
    '## Build Process',
    '- After writing game code, you MUST call the build_game tool.',
    '- The build packages all scripts/ into a single playable HTML file.',
    '- Report any build errors to the user via the set_error tool.',
    '',
    '## Interaction',
    '- After building, tell the user their game is ready to play.',
    '- If the user asks for changes, modify the scripts/ and rebuild.',
    '- Keep responses concise and focused on the game.',
    '',
  ].join('\n');

  await writeFile(path.join(workspacePath, 'agent.md'), content, 'utf-8');
}

export async function copyScaffoldToWorkspace(
  workspacePath: string,
  template?: string,
): Promise<void> {
  const scriptsDir = path.join(workspacePath, 'scripts');
  const assetsDir = path.join(workspacePath, 'assets');
  await mkdir(scriptsDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });

  const utilsSrc = path.join(TEMPLATES_BASE_PATH, 'lib', 'utils.js');
  const utilsDst = path.join(scriptsDir, 'utils.js');
  await copyFile(utilsSrc, utilsDst).catch(() => {});

  if (template) {
    const gameSrc = path.join(TEMPLATES_BASE_PATH, template, 'game.js');
    const gameDst = path.join(scriptsDir, 'game.js');
    await copyFile(gameSrc, gameDst).catch(() => {});
  }
}
