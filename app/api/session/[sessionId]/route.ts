import { agentSessions, readJsonl, jsonlExists } from '@/lib/session-store';
import { getWorkspace } from '@/lib/workspace/manager';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { hasSessionCapability } from '@/lib/session/capability';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // Validate sessionId format — prevent path traversal
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID format' }, { status: 400 });
  }
  if (!hasSessionCapability(sessionId)) {
    return NextResponse.json({ error: 'Session capability required' }, { status: 403 });
  }

  const workspace = getWorkspace(sessionId);
  const hasWorkspaceDir = workspace !== null;

  if (!hasWorkspaceDir && !jsonlExists(sessionId)) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const history = jsonlExists(sessionId)
    ? await readJsonl(sessionId)
    : (agentSessions.get(sessionId)?.getHistory() ?? []);

  const messages = formatMessages(history);
  const toolCalls = history
    .filter((m) => m.role === 'assistant' && m.tool_calls)
    .flatMap((m) => (m.tool_calls as Array<{ name: string; arguments: Record<string, unknown> }>) ?? [])
    .map((tc) => ({ name: tc.name, arguments: tc.arguments }));

  let gameUrl: string | null = null;
  let gameFiles: string[] = [];
  let hasBuild = false;
  let hasTodo = false;
  let todoContent: string | null = null;
  let gitPagesUrl: string | null = null;

  const wsPath = workspace?.workspacePath ??
    path.join(process.cwd(), 'user_space', sessionId);
  const outputPath = path.join(wsPath, 'output', 'index.html');
  try {
    await fs.access(outputPath);
    gameUrl = `/api/preview/${sessionId}`;
    hasBuild = true;
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

  try {
    const todoPath = path.join(wsPath, 'todo.md');
    await fs.access(todoPath);
    hasTodo = true;
    todoContent = await fs.readFile(todoPath, 'utf-8');
  } catch {
    // no todo.md
  }

  try {
    const remote = execSync('git remote get-url origin 2>/dev/null || true', {
      cwd: wsPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();
    if (remote) {
      const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (match) {
        gitPagesUrl = `https://${match[1].split('/')[0]}.github.io/${match[1].split('/')[1]}`;
      }
    }
  } catch {
    // no git remote
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
    hasBuild,
    hasTodo,
    todoContent,
    gitPagesUrl,
  });
}
