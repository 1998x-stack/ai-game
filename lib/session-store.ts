import type { AgentSession, AgentMessage } from '@/lib/agent';
import { mkdir, appendFile, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '@/lib/config';

export const agentSessions = new Map<string, AgentSession>();

const writeQueues = new Map<string, Promise<void>>();
const historyCache = new Map<string, AgentMessage[]>();
const USER_SPACE_DIR = path.join(process.cwd(), 'user_space');
const MAX_HISTORY_BYTES = CONFIG.agent.maxMessageLength * 1000;

function jsonlPath(sessionId: string): string {
  if (!CONFIG.validation.uuidPattern.test(sessionId)) throw new Error('Invalid session ID');
  return path.join(USER_SPACE_DIR, sessionId, 'session.jsonl');
}

function parseLine(line: string): AgentMessage {
  const value = JSON.parse(line) as { message?: AgentMessage } & AgentMessage;
  return value.message ?? value;
}

async function readFromDisk(sessionId: string): Promise<AgentMessage[]> {
  try {
    const content = await readFile(jsonlPath(sessionId), 'utf-8');
    if (Buffer.byteLength(content, 'utf8') > MAX_HISTORY_BYTES) {
      throw new Error('Session history exceeds the configured size limit');
    }
    return content.split('\n').filter((line) => line.trim()).map(parseLine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * The caller supplies the complete conversation snapshot (not just new turns).
 * Persist only the suffix, comparing by position rather than by content:
 * identical user messages on different turns are legitimate distinct events.
 */
export async function appendToJsonl(sessionId: string, messages: AgentMessage[]): Promise<void> {
  jsonlPath(sessionId);
  const candidate = messages.filter((message) => message.role !== 'system');
  for (const message of candidate) {
    if (Buffer.byteLength(JSON.stringify(message), 'utf8') > CONFIG.agent.maxMessageLength) {
      throw new Error('Session message exceeds the configured size limit');
    }
  }

  const previous = writeQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const stored = historyCache.get(sessionId) ?? await readFromDisk(sessionId);
    if (candidate.length < stored.length ||
        stored.some((message, index) => JSON.stringify(message) !== JSON.stringify(candidate[index]))) {
      throw new Error('Session history diverged from persisted events');
    }
    const delta = candidate.slice(stored.length);
    if (delta.length === 0) return;

    const lines = delta.map((message, index) => JSON.stringify({
      version: 1,
      id: crypto.randomUUID(),
      sessionId,
      seq: stored.length + index + 1,
      message,
    }));
    const payload = lines.join('\n') + '\n';
    let existingBytes = 0;
    try {
      existingBytes = (await stat(jsonlPath(sessionId))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existingBytes + Buffer.byteLength(payload, 'utf8') > MAX_HISTORY_BYTES) {
      throw new Error('Session history exceeds the configured size limit');
    }
    await mkdir(path.dirname(jsonlPath(sessionId)), { recursive: true });
    await appendFile(jsonlPath(sessionId), payload, 'utf-8');
    historyCache.set(sessionId, [...candidate]);
  });
  writeQueues.set(sessionId, next.catch(() => {}));
  await next;
}

export async function readJsonl(sessionId: string): Promise<AgentMessage[]> {
  return readFromDisk(sessionId);
}

export function jsonlExists(sessionId: string): boolean {
  return existsSync(jsonlPath(sessionId));
}
