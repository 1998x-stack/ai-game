import { agentSessions, readJsonl, jsonlExists } from '@/lib/session-store';
import { getWorkspace } from '@/lib/workspace/manager';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

function formatMessages(history: Array<{ role: string; content: string; tool_calls?: unknown; reasoning_content?: string }>) {
  return history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      reasoning_content: m.reasoning_content,
    }));
}

export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } },
) {
  const { sessionId } = params;

  const workspace = getWorkspace(sessionId);
  const hasWorkspaceDir = workspace !== null;

  if (!hasWorkspaceDir && !jsonlExists(sessionId)) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const history = jsonlExists(sessionId)
    ? readJsonl(sessionId)
    : (agentSessions.get(sessionId)?.getHistory() ?? []);

  const messages = formatMessages(history);
  const toolCalls = history
    .filter((m) => m.role === 'assistant' && m.tool_calls)
    .flatMap((m) => (m.tool_calls as Array<{ name: string; arguments: Record<string, unknown> }>) ?? [])
    .map((tc) => ({ name: tc.name, arguments: tc.arguments }));

  let gameUrl: string | null = null;
  let gameFiles: string[] = [];

  const wsPath = workspace?.workspacePath ??
    path.join(process.cwd(), 'user_space', sessionId);
  const outputPath = path.join(wsPath, 'output', 'index.html');
  try {
    await fs.access(outputPath);
    gameUrl = `/api/preview/${sessionId}`;
  } catch {
    // not built yet
  }

  try {
    const scriptsDir = path.join(wsPath, 'scripts');
    const files = await fs.readdir(scriptsDir);
    gameFiles = files.filter((f) => f.endsWith('.js'));
  } catch {
    // no scripts yet
  }

  let createdAt: string | null = workspace?.createdAt?.toISOString() ?? null;
  if (!createdAt && jsonlExists(sessionId)) {
    try {
      const stat = await fs.stat(
        path.join(process.cwd(), 'user_space', sessionId, 'session.jsonl'),
      );
      createdAt = stat.birthtime.toISOString();
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    sessionId,
    source: jsonlExists(sessionId) ? 'jsonl' : 'memory',
    createdAt,
    gameUrl,
    gameFiles,
    messages,
    toolCalls,
  });
}
