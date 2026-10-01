import type { AgentMessage, AgentSession } from '@/lib/agent';
import { agentSessions, appendToJsonl, jsonlExists, readJsonl } from '@/lib/session-store';
import { createWorkspace, restoreWorkspace, getWorkspace, type WorkspaceSession } from '@/lib/workspace/manager';

const locks = new Map<string, Promise<unknown>>();

export interface SessionSnapshot {
  sessionId: string;
  agent: AgentSession | null;
  workspace: WorkspaceSession | null;
  history: AgentMessage[];
}

export async function withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(sessionId) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const marker = current.then(() => undefined, () => undefined);
  locks.set(sessionId, marker);
  try {
    return await current;
  } finally {
    if (locks.get(sessionId) === marker) locks.delete(sessionId);
  }
}

export async function loadSession(sessionId: string): Promise<SessionSnapshot> {
  const agent = agentSessions.get(sessionId) ?? null;
  const workspace = getWorkspace(sessionId);
  const history = jsonlExists(sessionId) ? await readJsonl(sessionId) : agent?.getHistory() ?? [];
  return { sessionId, agent, workspace, history };
}

export async function appendSessionDelta(sessionId: string, messages: AgentMessage[]): Promise<void> {
  await appendToJsonl(sessionId, messages);
}

export async function restoreSessionWorkspace(sessionId: string): Promise<WorkspaceSession> {
  return jsonlExists(sessionId) ? restoreWorkspace(sessionId) : createWorkspace(sessionId);
}
