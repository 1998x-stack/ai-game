import { createWorkspace, getWorkspace } from '@/lib/workspace/manager';
import { createAgent } from '@/lib/agent/factory';
import type { AgentSession } from '@/lib/agent/types';
import { readScaffoldDocs, getGotchas } from '@/lib/scaffold/reader';
import fs from 'fs/promises';
import path from 'path';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 50000;
const ALLOWED_PROVIDERS = new Set(['deepseek', 'openai', 'claude']);

interface ChatRequest {
  sessionId: string;
  message: string;
  config: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
}

const agentSessions = new Map<string, AgentSession>();

export async function POST(request: Request) {
  let config: ChatRequest['config'] | undefined;
  try {
    const body: ChatRequest = await request.json();
    config = body.config;
    const { sessionId, message } = body;

    if (!sessionId || !message || !config?.apiKey) {
      return Response.json(
        {
          error:
            'Missing required fields: sessionId, message, and config.apiKey are required',
        },
        { status: 400 },
      );
    }

    // Validate sessionId format — prevent path traversal via sessionId injection
    if (!UUID_RE.test(sessionId)) {
      return Response.json({ error: 'Invalid session ID format' }, { status: 400 });
    }

    // Limit message size to prevent memory / API DoS
    if (message.length > MAX_MESSAGE_LENGTH) {
      return Response.json(
        { error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` },
        { status: 400 },
      );
    }

    // Validate provider at runtime
    if (config.provider && !ALLOWED_PROVIDERS.has(config.provider)) {
      return Response.json(
        { error: `Unsupported provider: "${config.provider}"` },
        { status: 400 },
      );
    }

    let agent = agentSessions.get(sessionId);

    if (!agent) {
      const workspace = await createWorkspace(sessionId);

      const docs = await readScaffoldDocs();
      const gotchas = await getGotchas();

      const parts: string[] = [
        'You are an expert HTML5 game developer. You create games using pure Canvas and JavaScript.',
      ];

      if (gotchas) {
        parts.push('\n\n--- Known Gotchas ---\n' + gotchas);
      }

      if (docs.length > 0) {
        parts.push('\n\n--- Game Development Guide ---');
        for (const doc of docs) {
          parts.push('\n\n### ' + doc.name + '\n' + doc.content);
        }
      }

      parts.push(
        '\n\nWhen the user asks for a game, generate the code in scripts/game.js using the patterns from the scaffold. After writing code, always call build_game tool. If you encounter issues, use set_error. Keep responses concise.',
      );

      let systemPrompt = parts.join('');

      const MAX_PROMPT_LENGTH = 30000;
      if (systemPrompt.length > MAX_PROMPT_LENGTH) {
        const gotchaSection = gotchas
          ? '\n\n--- Known Gotchas ---\n' + gotchas + '\n'
          : '';
        systemPrompt =
          parts[0] +
          gotchaSection +
          parts[parts.length - 1] +
          '\n\n[Game development guide truncated for length — read workspace/docs/ for full content if needed.]';
      }

      agent = createAgent(
        {
          provider: config.provider.toLowerCase() as 'deepseek' | 'openai' | 'claude',
          apiKey: config.apiKey,
          model: config.model,
          baseUrl: config.baseUrl,
        },
        systemPrompt,
        workspace.workspacePath,
      );

      agentSessions.set(sessionId, agent);
    }

    const response = await agent.sendMessage(message);

    const hasBuildGame = response.toolCalls.some(
      (tc) => tc.name === 'build_game',
    );
    let buildResult: { previewUrl: string; success: boolean } | undefined;

    if (hasBuildGame) {
      const workspace = getWorkspace(sessionId);
      if (workspace) {
        const outputPath = path.join(
          workspace.workspacePath,
          'output',
          'index.html',
        );
        try {
          await fs.access(outputPath);
          buildResult = {
            previewUrl: `/api/preview/${sessionId}`,
            success: true,
          };
        } catch {
          // Output file missing — build didn't produce output; don't set buildResult
        }
      }
    }

    return Response.json({
      reply: response.message,
      toolCalls: response.toolCalls.map((tc) => ({
        name: tc.name,
        arguments: tc.arguments,
      })),
      buildResult,
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : 'Internal server error';
    // Redact API key from error messages
    if (config?.apiKey && message.includes(config.apiKey)) {
      message = message.replace(config.apiKey, '[REDACTED]');
    }
    return Response.json(
      { error: message },
      { status: 500 },
    );
  }
}
