import type { AgentSession, AgentMessage } from '@/lib/agent';
import { mkdir, appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export const agentSessions = new Map<string, AgentSession>();

const USER_SPACE_DIR = path.join(process.cwd(), 'user_space');

function jsonlPath(sessionId: string): string {
  return path.join(USER_SPACE_DIR, sessionId, 'session.jsonl');
}

export async function appendToJsonl(
  sessionId: string,
  messages: AgentMessage[],
): Promise<void> {
  const lines = messages
    .filter((m) => m.role !== 'system')
    .map((m) => JSON.stringify(m));
  if (lines.length === 0) return;

  const filePath = jsonlPath(sessionId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, lines.join('\n') + '\n', 'utf-8');
}

export async function readJsonl(sessionId: string): Promise<AgentMessage[]> {
  const filePath = jsonlPath(sessionId);
  try {
    const content = await readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AgentMessage);
  } catch {
    return [];
  }
}

export function jsonlExists(sessionId: string): boolean {
  return existsSync(jsonlPath(sessionId));
}
