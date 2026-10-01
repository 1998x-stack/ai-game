import type { AgentSession, AgentMessage } from '@/lib/agent';
import { mkdir, appendFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '@/lib/config';

export const agentSessions = new Map<string, AgentSession>();

const writeQueues = new Map<string, Promise<void>>();

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
  if (lines.some((line) => Buffer.byteLength(line, 'utf8') > CONFIG.agent.maxMessageLength)) {
    throw new Error('Session message exceeds the configured size limit');
  }

  const previous = writeQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const filePath = jsonlPath(sessionId);
    await mkdir(path.dirname(filePath), { recursive: true });
    let existing: string[] = [];
    try {
      existing = (await readFile(filePath, 'utf-8')).split('\n').filter(Boolean);
    } catch {
      // First write.
    }
    const existingMessages = existing.map((line) => {
      try {
        const value = JSON.parse(line) as { message?: AgentMessage };
        return JSON.stringify(value.message ?? value);
      } catch {
        return line;
      }
    });
    const existingSet = new Set(existingMessages);
    const delta = lines
      .filter((line) => !existingSet.has(line))
      .map((line, index) => JSON.stringify({
        version: 1,
        id: crypto.randomUUID(),
        sessionId,
        seq: existing.length + index + 1,
        message: JSON.parse(line),
      }));
    if (delta.length > 0) await appendFile(filePath, delta.join('\n') + '\n', 'utf-8');
  });
  writeQueues.set(sessionId, next.catch(() => {}));
  await next;
}

export async function readJsonl(sessionId: string): Promise<AgentMessage[]> {
  const filePath = jsonlPath(sessionId);
  try {
    const content = await readFile(filePath, 'utf-8');
    if (Buffer.byteLength(content, 'utf8') > CONFIG.agent.maxMessageLength * 1000) {
      throw new Error('Session history exceeds the configured size limit');
    }
    const seen = new Set<string>();
    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const value = JSON.parse(line) as { message?: AgentMessage };
        return value.message ?? value as AgentMessage;
      })
      .filter((message) => {
        const key = JSON.stringify(message);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function jsonlExists(sessionId: string): boolean {
  return existsSync(jsonlPath(sessionId));
}
