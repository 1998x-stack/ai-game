import { getWorkspace } from '@/lib/workspace/manager';
import { createAgent } from '@/lib/agent/factory';
import type { AgentSession } from '@/lib/agent/types';
import { readScaffoldDocs, getGotchas } from '@/lib/scaffold/reader';
import { agentSessions, readJsonl, jsonlExists } from '@/lib/session-store';
import { CONFIG } from '@/lib/config';
import { gitCommit } from '@/lib/git';
import fs from 'fs/promises';
import path from 'path';
import { redactSecrets, validateBaseUrl } from '@/lib/security/validation';
import { hasSessionCapability } from '@/lib/session/capability';
import { appendSessionDelta, restoreSessionWorkspace, withSessionLock } from '@/lib/session/session-module';

const UUID_RE = CONFIG.validation.uuidPattern;
const MAX_MESSAGE_LENGTH = CONFIG.agent.maxMessageLength;
const ALLOWED_PROVIDERS = CONFIG.providers.allowed;

function parseTodoMd(content: string): Array<{
  task: string;
  status: 'pending' | 'done';
  verify?: string;
}> {
  const tasks: Array<{ task: string; status: 'pending' | 'done'; verify?: string }> = [];
  for (const line of content.split('\n')) {
    const doneMatch = line.match(/^-\s*\[x\]\s+(.+?)(?:\s+—\s+verify:\s+(.+))?$/i);
    if (doneMatch) {
      tasks.push({
        task: doneMatch[1].trim(),
        status: 'done',
        verify: doneMatch[2]?.trim() || undefined,
      });
      continue;
    }
    const pendingMatch = line.match(/^-\s*\[\s*\]\s+(.+?)(?:\s+—\s+verify:\s+(.+))?$/);
    if (pendingMatch) {
      tasks.push({
        task: pendingMatch[1].trim(),
        status: 'pending',
        verify: pendingMatch[2]?.trim() || undefined,
      });
    }
  }
  return tasks;
}

interface ChatRequest {
  sessionId: string;
  message: string;
  stream?: boolean;
  config: {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
    githubToken?: string;
  };
}

async function handleStreamingResponse(
  agent: AgentSession,
  message: string,
  sessionId: string,
  signal?: AbortSignal,
  requestConfig?: ChatRequest['config'],
): Promise<Response> {
  const encoder = new TextEncoder();

  const trySendTodoUpdate = async () => {
    const workspace = getWorkspace(sessionId);
    if (!workspace) return;
    const todoPath = path.join(workspace.workspacePath, 'todo.md');
    try {
      await fs.access(todoPath);
      const content = await fs.readFile(todoPath, 'utf-8');
      const tasks = parseTodoMd(content);
      if (tasks.length > 0) {
        const done = tasks.filter((t) => t.status === 'done').length;
        const pending = tasks.filter((t) => t.status === 'pending').length;
        const next = tasks.find((t) => t.status === 'pending');
        return {
          type: 'todo_update' as const,
          tasks,
          done,
          pending,
          next: next?.task,
        };
      }
    } catch {
      // todo.md not found or unreadable — skip
    }
    return null;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        await withSessionLock(sessionId, () => agent.sendMessageStream(message, async (event) => {
          if (event.type === 'tool_result' && event.name === 'build_game') {
            const workspace = getWorkspace(sessionId);
            if (workspace) {
              const success = event.result.startsWith('BUILD SUCCESS');
              send({ type: 'build_result', previewUrl: `/api/preview/${sessionId}`, success });
              if (success) gitCommit(workspace.workspacePath, 'Build: game update');
            }
          }

          // Handle github_push results
          if (event.type === 'tool_result' && event.name === 'github_push') {
            send(event);
            const resultMatch = event.result.match(/GITHUB PUSH SUCCESS/);
            if (resultMatch) {
              const repoMatch = event.result.match(/Repository: (https:\/\/github\.com\/[^\s]+)/);
              const pagesMatch = event.result.match(/GitHub Pages: (https:\/\/[^\s]+)/);
              send({
                type: 'github_push_result',
                success: true,
                repoUrl: repoMatch?.[1],
                pagesUrl: pagesMatch?.[1],
              });
            } else {
              send({
                type: 'github_push_result',
                success: false,
                error: event.result,
              });
            }
            return;
          }

          // Emit todo_update after write_todo or edit_file on todo.md
          if (
            event.type === 'tool_result' &&
            (event.name === 'write_todo' ||
              (event.name === 'edit_file' &&
                typeof event.result === 'string' &&
                event.result.includes('todo.md')))
          ) {
            send(event);
            const todoEvent = await trySendTodoUpdate();
            if (todoEvent) send(todoEvent);
            return;
          }

          send(event);
        }));
        await appendSessionDelta(sessionId, agent.getHistory());
      } catch (error) {
        send({
          type: 'error',
        message: redactSecrets(error instanceof Error ? error.message : 'Internal server error', [requestConfig?.apiKey, requestConfig?.githubToken]),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

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
    if (!hasSessionCapability(sessionId)) {
      return Response.json({ error: 'Session capability required' }, { status: 403 });
    }

    // Limit message size to prevent memory / API DoS
    if (message.length > MAX_MESSAGE_LENGTH) {
      return Response.json(
        { error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` },
        { status: 400 },
      );
    }

    // Validate provider at runtime
    if (!config?.provider || !ALLOWED_PROVIDERS.has(config.provider.toLowerCase())) {
      const msg = config?.provider
        ? `Unsupported provider: "${config.provider}"`
        : 'Missing required field: config.provider';
      return Response.json({ error: msg }, { status: 400 });
    }

    config.baseUrl = validateBaseUrl(config.baseUrl || CONFIG.providers.deepseek.defaultBaseUrl, CONFIG.providers.allowedBaseHosts);

    let agent = agentSessions.get(sessionId);

    if (!agent) {
      const isRestoring = jsonlExists(sessionId);
      const workspace = await restoreSessionWorkspace(sessionId);

      const docs = await readScaffoldDocs();
      const gotchas = await getGotchas();

      const parts: string[] = [
        'You are an expert HTML5 game developer. You create games using pure Canvas and JavaScript.',
        'The canvas is already created with id="gameCanvas" — use document.getElementById("gameCanvas") to access it. Do NOT create a new canvas element.',
        'The HTML has no canvas width/height. YOU MUST set canvas.width and canvas.height in your JavaScript code — default is 300x150.',
        'Use setupCanvas("gameCanvas", 800, 600) from utils.js or set them manually.',
        'Files in assets/ are embedded as base64 at build time. Access them via window.__ASSETS__[filename].',
        'Available skills in skills/examples/ — read pixel-art-games.md for retro graphics, game-sound-effects.md for audio, or create new skills for other domains.',
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
        '\n\nWhen the user asks for a game, start by calling write_todo to create a game plan in todo.md with a checklist. Then call load_skills to discover relevant skills. For matching skills, read the full skill file. Then generate the code in scripts/game.js using the patterns from the scaffold.',
        '\n\nCRITICAL: scripts/utils.js is pre-loaded in the same module scope before game.js.',
        'All exported classes (GameLoop, InputManager, CollisionDetector, SpriteManager, Animation, SoundManager, ObjectPool, Vector2, Camera, Timer, ScreenShake, SeededRandom) and functions (randomInt, clamp, lerp, distance, angleBetween, setupCanvas) and constants (Easing) are already available — use them directly.',
        'Do NOT redeclare, re-export, or copy utility code into game.js. This causes "Identifier has already been declared" errors.',
        '\nYou MAY append new export functions/classes to the END of scripts/utils.js to extend the library. You MAY also append new gotchas to the END of docs/gotchas.md when you encounter and solve problems (follow the format at top of the file). After adding functions or gotchas, update lib/index.md to document them.',
        '\nAfter writing code, always call build_game. If build_game reports errors, read the output, fix the code, and rebuild. Use set_error only for unrecoverable issues. After building, briefly describe the game features and how to play. Keep responses concise.',
      );

      // Git: every successful build is auto-committed — use git_log/git_diff/git_status to inspect history
      parts.push(
        '\n\nEvery successful build is automatically committed to a git repository. Use git_log to see commit history, git_diff to see changes, and git_status to check the working tree. This helps you understand what changed between iterations.',
      );

      // GitHub: only mention publishing if a token is available
      if (config.githubToken) {
        parts.push(
          '\n\nGitHub publishing is available via github_push. When the user asks to share or publish their game, call github_push after a successful build. This creates a repository, pushes the game, enables GitHub Pages, and returns a live URL. Do NOT call github_push unless explicitly asked.',
        );
      }

      // Session restoration: inject workspace state summary so the agent can pick up where it left off
      if (isRestoring) {
        try {
          const { execSync } = await import('child_process');
          const gitLog = (() => {
            try {
              return execSync('git log --oneline -5', {
                cwd: workspace.workspacePath,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 5000,
              }).trim() || '(no commits)';
            } catch {
              return '(git unavailable)';
            }
          })();

          const hasTodo = await fs
            .access(path.join(workspace.workspacePath, 'todo.md'))
            .then(() => true)
            .catch(() => false);

          const hasGameJs = await fs
            .access(path.join(workspace.workspacePath, 'scripts', 'game.js'))
            .then(() => true)
            .catch(() => false);

          const hasBuild = await fs
            .access(path.join(workspace.workspacePath, 'output', 'index.html'))
            .then(() => true)
            .catch(() => false);

          const summaryLines: string[] = [
            '\n\n=== Session Restoration — Current Workspace State ===',
            'You are resuming an existing game development session. Before making changes, orient yourself:',
            hasGameJs ? '- A game exists at scripts/game.js — read it first to understand the current state.' : '- No game.js found — start fresh.',
            hasBuild ? '- A build exists at output/index.html — the game was successfully built before.' : '',
            hasTodo ? '- A todo.md exists with remaining tasks — read it to see what was planned.' : '',
            `- Recent git history:\n${gitLog}`,
            '\nIMPORTANT: Start by reading scripts/game.js to understand the current game code. Then read docs/gotchas.md. Do NOT restart from scratch or call write_todo to create a new plan unless the user explicitly asks for a new game.',
          ];

          parts.push(summaryLines.filter(Boolean).join('\n'));
        } catch {
          // If state reading fails, proceed without summary
        }
      }

      let systemPrompt = parts.join('');

      const MAX_PROMPT_LENGTH = CONFIG.agent.maxPromptLength;
      if (systemPrompt.length > MAX_PROMPT_LENGTH) {
        const baseInstructions = parts.slice(0, 5).join('\n');
        const finalInstructions = parts.slice(-5).join('\n');
        const gotchaSection = gotchas
          ? '\n\n--- Known Gotchas ---\n' + gotchas
          : '';
        systemPrompt =
          baseInstructions +
          gotchaSection +
          '\n\n--- Final Instructions ---\n' +
          finalInstructions +
          '\n\n[Game development guide truncated for length — read workspace/docs/ for full content if needed.]';
      }

      const agentMdPath = path.join(process.cwd(), 'workspace', 'agent.md');
      try {
        const agentMd = await fs.readFile(agentMdPath, 'utf-8');
        systemPrompt += '\n\n' + agentMd;
      } catch {
        // agent.md not found — continue with existing prompt
      }

      agent = createAgent(
        {
          provider: config.provider.toLowerCase() as 'deepseek' | 'openai' | 'claude',
          apiKey: config.apiKey,
          model: config.model,
          baseUrl: config.baseUrl,
          githubToken: config.githubToken,
          fallbackModel: CONFIG.providers.deepseek.fallbackModel,
        },
        systemPrompt,
        workspace.workspacePath,
      );

      agentSessions.set(sessionId, agent);

      if (jsonlExists(sessionId)) {
        const history = await readJsonl(sessionId);
        agent.loadHistory(history);
      }
    }

    if (body.stream) {
      return handleStreamingResponse(agent, message, sessionId, request.signal, config);
    }

    const response = await withSessionLock(sessionId, () => agent.sendMessage(message, request.signal));

    const hasBuildGame = response.toolCalls.some(
      (tc) => tc.name === 'build_game',
    );
    let buildResult: { previewUrl: string; success: boolean } | undefined;

    if (hasBuildGame) {
      const lastBuildResult = [...agent.getHistory()].reverse().find((m) => m.role === 'tool' && /BUILD (SUCCESS|FAILED|CRASHED)/.test(m.content));
      let buildSucceeded = lastBuildResult?.content.startsWith('BUILD SUCCESS') ?? false;
      const workspace = getWorkspace(sessionId);
      if (workspace && !lastBuildResult) {
        try {
          await fs.access(path.join(workspace.workspacePath, 'output', 'index.html'));
          buildSucceeded = true;
        } catch {
          buildSucceeded = false;
        }
      }
      if (workspace && buildSucceeded) {
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

    await appendSessionDelta(sessionId, agent.getHistory());

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
    message = redactSecrets(message, [config?.apiKey, config?.githubToken]);
    return Response.json(
      { error: message },
      { status: 500 },
    );
  }
}
