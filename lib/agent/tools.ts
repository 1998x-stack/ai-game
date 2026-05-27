import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import OpenAI from 'openai';
import { chromium } from 'playwright';
import { AgentConfig, ToolDefinition, ToolHandler } from './types';
import { buildGame } from '@/lib/build/packager';
import { CONFIG } from '@/lib/config';
import { gitLog, gitDiff, gitDiffStaged, gitStatus } from '@/lib/git';
import { githubPush } from '@/lib/github';

function validatePath(userPath: string, workspaceRoot: string): string {
  if (userPath.includes('..')) {
    throw new Error(`Path traversal not allowed (contains ".."): ${userPath}`);
  }
  // Verify workspace root itself is under user_space/
  const rootSegments = workspaceRoot.split(path.sep);
  if (!rootSegments.includes('user_space')) {
    throw new Error(
      `Workspace root must be under user_space/: ${workspaceRoot}`,
    );
  }
  const resolved = path.resolve(workspaceRoot, userPath);
  let realResolved: string;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    realResolved = path.resolve(resolved);
  }
  const rootBoundary = workspaceRoot.endsWith(path.sep)
    ? workspaceRoot
    : workspaceRoot + path.sep;
  if (
    realResolved !== workspaceRoot &&
    !realResolved.startsWith(rootBoundary)
  ) {
    throw new Error(`Path is outside workspace root: ${userPath}`);
  }
  return resolved;
}

const readFileDef: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file within the user space. Use offset and limit to read specific line ranges in large files (line numbers are 1-based, first line is 1). Default limit is 2000 lines — specify a larger limit if you need more. Do NOT use this to re-read files you already have context on; only read files when you need new information.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' },
      offset: { type: 'number', description: 'Line number to start reading from (1-based, default: 1)' },
      limit: { type: 'number', description: 'Maximum number of lines to read (default: 2000)' },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

const writeFileDef: ToolDefinition = {
  name: 'write_file',
  description: 'Write or overwrite a file within the user space. Creates parent directories if they do not exist. By default, refuses to overwrite existing files — set overwrite: true to force. Use edit_file to modify existing files instead of overwriting them entirely. Do NOT use this to write build outputs (use build_game), todo lists (use write_todo), or generated assets that would bloat the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' },
      content: { type: 'string', description: 'Full content to write to the file' },
      overwrite: { type: 'boolean', description: 'Set to true to overwrite an existing file (default: false)' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
};

const editFileDef: ToolDefinition = {
  name: 'edit_file',
  description: 'Replace text in a file. old_str must match EXACTLY once in the file — if it matches multiple times, the edit is rejected and you will be told the line numbers of each match so you can expand old_str to make it unique. Use this for targeted modifications to any file (scripts, todo.md, gotchas.md, docs, etc.). Do NOT use this to write entire files from scratch (use write_file instead).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' },
      old_str: { type: 'string', description: 'The exact text to search for. Must be unique in the file — if ambiguous, expand it with more surrounding context.' },
      new_str: { type: 'string', description: 'The replacement text' },
    },
    required: ['path', 'old_str', 'new_str'],
    additionalProperties: false,
  },
};

const listDirDef: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and directories at the given path within the user space. Output format is guaranteed: one entry per line, directory names end with "/", file names do not. Use this to explore workspace structure before reading files. Do NOT use this on directories you already know the contents of.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the directory (must be within workspace root)' },
    },
    required: ['path'],
    additionalProperties: false,
  },
};

const buildGameDef: ToolDefinition = {
  name: 'build_game',
  description: 'Run the build command to package scripts and assets into a single HTML file at output/index.html. Call this AFTER writing or editing game code. Returns build success/failure with details. If build fails, read the errors, fix the code, and call build_game again. Do NOT call this before writing any code — it will produce an empty build.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const loadSkillsDef: ToolDefinition = {
  name: 'load_skills',
  description: 'Load metadata for all available skills in skills/examples/ plus the built-in skill-creator skill. Returns JSON with name, description, and trigger keywords for each skill. Call this at the start of every game generation session to discover relevant domain skills. Do NOT call this repeatedly — skills do not change during a session.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const grepFileDef: ToolDefinition = {
  name: 'grep_file',
  description: 'Search for a regex pattern in files using ripgrep (fast). If path is a directory, searches recursively (skips output/ and node_modules). Returns matching lines with file path and line number. Use this to find patterns, function definitions, or usages across the workspace. Do NOT use this when you already know which file to read — use read_file directly.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory to search (must be within workspace root)' },
      pattern: { type: 'string', description: 'Regular expression pattern (ripgrep syntax). Examples: "export function clamp", "class GameLoop", "canvas\\.width"' },
      context: { type: 'number', description: 'Number of context lines to show before and after each match (default: 0)' },
    },
    required: ['path', 'pattern'],
    additionalProperties: false,
  },
};

const writeTodoDef: ToolDefinition = {
  name: 'write_todo',
  description: 'Write or update a game design plan to todo.md. Provide a JSON array of atomic, independently runnable tasks. Each task must have: task (description), status ("pending" or "done"), and verify (how to confirm completion — e.g., "Game compiles and snake moves with arrow keys"). Write todo.md at game start, then use edit_file to toggle "- [ ]" to "- [x]" as you complete tasks. Keep tasks small and concrete.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description (atomic, concrete action)' },
            status: { type: 'string', enum: ['pending', 'done'], description: 'Task status' },
            verify: { type: 'string', description: 'How to verify this task is complete (e.g., "Game compiles and snake moves with arrow keys")' },
          },
          required: ['task', 'status', 'verify'],
        },
        description: 'Array of atomic, verifiable task objects',
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },
};

const setErrorDef: ToolDefinition = {
  name: 'set_error',
  description: 'Report an unrecoverable error to the user. Use ONLY when you cannot proceed after multiple fix attempts. Do NOT use for minor issues or as a shortcut — try to resolve problems yourself first.',
  parameters: { type: 'object', properties: { message: { type: 'string', description: 'The error message' } }, required: ['message'], additionalProperties: false },
};

const delegateSubagentDef: ToolDefinition = {
  name: 'delegate_subagent',
  description: 'Delegate a LOW SIGNAL-TO-NOISE task to a subagent (max 3 active). Low SNR tasks are those requiring many tool calls but little high-level judgment: reading multiple documentation files, searching for code patterns, gathering context from the workspace. The subagent handles the grunt work and returns a concise summary. Subagents CANNOT build games, write todos, or delegate further. Do NOT delegate high-judgment tasks (game design, code architecture, user-facing decisions) — handle those yourself. Do NOT delegate single read_file calls — just call read_file directly.',
  parameters: {
    type: 'object',
    properties: {
      instruction: { type: 'string', description: 'Concise research instruction. Be specific about what to find and where. Example: "Read docs/gotchas.md, docs/game-dev-guide.md, and templates/snake/game.js. Summarize: (1) key gotchas to avoid, (2) game loop pattern used in snake, (3) recommended canvas setup approach."' },
    },
    required: ['instruction'],
    additionalProperties: false,
  },
};

const gameRuntimeDef: ToolDefinition = {
  name: 'game_runtime',
  description: 'Run the built game in a headless browser and use the fallback model (deepseek-v4-flash) to play it for edge-case testing. Loads output/index.html, extracts game state, sends it to the model for action decisions at a controlled FPS, and returns a test report. Use AFTER build_game succeeds. Tests boundary collisions, self-collision, game-over triggers, and other runtime behaviors. Do NOT use on unbuilt or broken games.',
  parameters: {
    type: 'object',
    properties: {
      maxSteps: { type: 'number', description: 'Maximum interaction steps (default: 15)' },
      fps: { type: 'number', description: 'Game speed in FPS. Lower = more time for model to decide each action (default: 5)' },
    },
    required: [],
    additionalProperties: false,
  },
};

const gitLogDef: ToolDefinition = {
  name: 'git_log',
  description: 'Show recent git commit history in this session workspace. Use to understand what changes were made in previous iterations. Returns one-line summaries of the last N commits (default 10). The workspace is automatically versioned on each successful build — you never need to commit manually.',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of commits to show (default: 10, max: 50)' },
    },
    required: [],
    additionalProperties: false,
  },
};

const gitDiffDef: ToolDefinition = {
  name: 'git_diff',
  description: 'Show unstaged or staged file changes in the workspace. Use to see what the user or previous iterations modified. Pass staged=true to see staged changes, or omit to see unstaged diffs. This helps you understand what changed before you make further edits.',
  parameters: {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'Show staged changes instead of unstaged (default: false)' },
    },
    required: [],
    additionalProperties: false,
  },
};

const gitStatusDef: ToolDefinition = {
  name: 'git_status',
  description: 'Show the current working tree status — which files are modified, added, or deleted. Use before making changes to understand workspace state, or after user feedback to see what might need updating.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const githubPushDef: ToolDefinition = {
  name: 'github_push',
  description: 'Push the built game to a new GitHub repository and enable GitHub Pages for instant sharing. Requires the user to have configured a GitHub token in Settings. Creates a public repo with the built output/index.html, enables Pages, and returns the live URL. Call AFTER a successful build_game. The repo is named automatically (ai-game-{timestamp}) unless you specify a name. IMPORTANT: Only call this when the user asks you to share or publish their game.',
  parameters: {
    type: 'object',
    properties: {
      repoName: { type: 'string', description: 'Custom repository name (optional). Default: ai-game-{timestamp}. Use lowercase, hyphens, no spaces.' },
      private: { type: 'boolean', description: 'Make the repository private (default: false)' },
    },
    required: [],
    additionalProperties: false,
  },
};

async function readFileHandler(args: Record<string, unknown>, root: string) {
  const content = fs.readFileSync(validatePath(String(args.path), root), 'utf-8');
  const lines = content.split('\n');
  const totalLines = lines.length;
  const offset = typeof args.offset === 'number' ? Math.max(1, Math.floor(args.offset)) : 1;
  const limit = typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : CONFIG.tools.readFileDefaultLimit;
  const start = offset - 1;
  const end = limit ? Math.min(start + limit, totalLines) : totalLines;

  if (start >= totalLines) return `(file has ${totalLines} lines, offset ${offset} is beyond end)`;

  const result = [];
  if (offset > 1 || limit) {
    result.push(`(lines ${start + 1}-${end} of ${totalLines})`);
  }
  for (let i = start; i < end; i++) {
    result.push(lines[i]);
  }
  return result.join('\n');
}
async function writeFileHandler(args: Record<string, unknown>, root: string) {
  const p = validatePath(String(args.path), root);
  const overwrite = args.overwrite === true;
  if (!overwrite && fs.existsSync(p)) {
    throw new Error(
      `File already exists: ${p}. Use edit_file to modify it, or set overwrite: true to replace it entirely.`,
    );
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(args.content), 'utf-8');
  return `Successfully wrote ${p}`;
}
async function editFileHandler(args: Record<string, unknown>, root: string) {
  const p = validatePath(String(args.path), root);
  const oldStr = String(args.old_str);
  const newStr = String(args.new_str);
  const cur = fs.readFileSync(p, 'utf-8');

  // Find ALL occurrences — reject if >1 match
  const positions: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = cur.indexOf(oldStr, searchFrom);
    if (idx === -1) break;
    positions.push(idx);
    searchFrom = idx + 1;
  }

  if (positions.length === 0) {
    throw new Error(
      `Could not find old_str in ${p}. Check that the text matches exactly (whitespace, indentation, line endings).`,
    );
  }

  if (positions.length > 1) {
    const lineNums = positions.map((pos) => {
      const before = cur.slice(0, pos);
      return before.split('\n').length;
    });
    throw new Error(
      `old_str matched ${positions.length} times in ${p} at lines: ${lineNums.join(', ')}. ` +
        `Expand old_str with more surrounding context so it uniquely identifies the target location. ` +
        `For example, include the line above and below the target match.`,
    );
  }

  const idx = positions[0];
  fs.writeFileSync(
    p,
    cur.slice(0, idx) + newStr + cur.slice(idx + oldStr.length),
    'utf-8',
  );
  return `Successfully edited ${p}`;
}
function formatDirectoryListing(entries: fs.Dirent[]): string {
  return entries
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .join('\n');
}

async function listDirHandler(args: Record<string, unknown>, root: string) {
  const entries = fs.readdirSync(
    validatePath(String(args.path), root),
    { withFileTypes: true },
  );
  return formatDirectoryListing(entries);
}
async function buildGameHandler(_: Record<string, unknown>, root: string) {
  try {
    const result = buildGame(root);
    if (result.errors.length > 0) {
      return `BUILD FAILED with ${result.errors.length} error(s):\n${result.errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}\n\nFix the errors in scripts/ and call build_game again.`;
    }
    return `BUILD SUCCESS. Game packaged to output/index.html. The game is now running in the preview panel. You can ask the user for feedback or suggest improvements.`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `BUILD CRASHED: ${msg}. This may be a system error — check scripts/ for valid JavaScript syntax and try again.`;
  }
}
async function loadSkillsHandler(_: Record<string, unknown>, root: string) {
  const skills: Array<{
    file: string;
    name: string;
    description: string;
    triggers: string;
  }> = [];

  // Built-in: skill-creator.md (always available)
  const skillCreatorPath = path.join(root, 'skills', 'skill-creator.md');
  try {
    const c = fs.readFileSync(skillCreatorPath, 'utf-8');
    const m = c.match(/^---\n([\s\S]*?)\n---/);
    if (m) {
      const r: Record<string, string> = {};
      for (const l of m[1].split('\n')) {
        const i = l.indexOf(':');
        if (i > -1) r[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      }
      skills.push({
        file: 'skill-creator.md',
        name: r.name || 'skill-creator',
        description:
          r.description ||
          'Template and guide for creating new reusable skills',
        triggers: r.triggers || 'create skill, new skill, skill template',
      });
    }
  } catch {
    /* skill-creator.md not found — skip */
  }

  // User-created skills in examples/
  const dir = path.join(root, 'skills', 'examples');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return JSON.stringify(skills, null, 2);
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const c = fs.readFileSync(path.join(dir, e.name), 'utf-8');
      const m = c.match(/^---\n([\s\S]*?)\n---/);
      if (!m) continue;
      const r: Record<string, string> = {};
      for (const l of m[1].split('\n')) {
        const i = l.indexOf(':');
        if (i > -1) r[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      }
      if (r.name && r.description)
        skills.push({
          file: e.name,
          name: r.name,
          description: r.description,
          triggers: r.triggers || '',
        });
    } catch {
      /* skip */
    }
  }
  return JSON.stringify(skills, null, 2);
}
async function writeTodoHandler(args: Record<string, unknown>, root: string) {
  const tasks = args.tasks as Array<{ task: string; status: string; verify: string }> | undefined;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('tasks must be a non-empty array of { task: string, status: "pending" | "done", verify: string }');
  }

  const lines = tasks.map((t) => {
    const checkbox = t.status === 'done' ? '[x]' : '[ ]';
    const verifyNote = t.verify ? ` — verify: ${t.verify}` : '';
    return `- ${checkbox} ${t.task}${verifyNote}`;
  });
  const content = `# Game Plan\n\n${lines.join('\n')}\n`;

  fs.writeFileSync(path.join(root, 'todo.md'), content, 'utf-8');

  const done = tasks.filter((t) => t.status === 'done').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;
  const nextPending = tasks.find((t) => t.status === 'pending');

  let result = `Plan written to todo.md: ${done} done, ${pending} pending`;
  if (nextPending) {
    result += `, next: "${nextPending.task}"`;
  }
  return result;
}

async function grepFileHandler(args: Record<string, unknown>, root: string) {
  const filePath = validatePath(String(args.path), root);
  const pattern = String(args.pattern);
  const contextLines =
    typeof args.context === 'number' ? Math.floor(args.context) : 0;

  // Try ripgrep first, fall back to JS implementation
  try {
    const rgArgs = ['--line-number', '--no-heading', '--color=never'];
    if (contextLines > 0) {
      rgArgs.push(`-C${contextLines}`);
    }
    // Exclude output/ and node_modules/
    rgArgs.push('--glob', '!output/**');
    rgArgs.push('--glob', '!node_modules/**');
    rgArgs.push('-e', pattern, filePath);

    const stdout = execSync(`rg ${rgArgs.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
      encoding: 'utf-8',
      timeout: 10000,
      maxBuffer: 1024 * 1024 * 10,
    });
    const trimmed = stdout.trim();
    if (trimmed) return trimmed;
    return `No matches for "${pattern}"`;
  } catch (err: unknown) {
    // rg returns exit code 1 when no matches found — treat as empty result
    const execErr = err as { code?: unknown; stdout?: string; stderr?: string };
    if (
      execErr.code === 1 &&
      typeof execErr.stdout === 'string' &&
      execErr.stdout.trim()
    ) {
      return execErr.stdout.trim();
    }
    if (execErr.code === 1) {
      return `No matches for "${pattern}"`;
    }
    // rg not found or other error — fall back to JS
  }

  // JS fallback implementation
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    return `Invalid regex pattern: ${pattern}`;
  }

  const results: string[] = [];
  const searchFile = (fp: string) => {
    try {
      const content = fs.readFileSync(fp, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          if (contextLines > 0) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length, i + contextLines + 1);
            for (let j = start; j < end; j++) {
              results.push(
                `${fp}:${j + 1}${j === i ? '>' : ' '}: ${lines[j]}`,
              );
            }
            results.push('---');
          } else {
            results.push(`${fp}:${i + 1}: ${lines[i]}`);
          }
        }
      }
    } catch {
      /* skip unreadable */
    }
  };

  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      searchFile(filePath);
    } else if (stat.isDirectory()) {
      const walk = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const en of entries) {
          const p = path.join(dir, en.name);
          if (en.isDirectory()) {
            if (en.name === 'output' || en.name === 'node_modules') continue;
            walk(p);
          } else {
            searchFile(p);
          }
        }
      };
      walk(filePath);
    }
  } catch {
    /* path not found */
  }

  return results.length > 0
    ? results.join('\n')
    : `No matches for "${pattern}"`;
}

async function setErrorHandler(args: Record<string, unknown>) {
  return String(args.message);
}

// --- Subagent Infrastructure ---
const MAX_SUBAGENTS = CONFIG.subagent.maxConcurrent;
const SUBAGENT_MAX_ITERATIONS = CONFIG.subagent.maxIterations;
const subagentCounters = new Map<string, number>();

const SUBAGENT_SYSTEM_PROMPT =
  'You are a focused research subagent. Gather information using read_file, grep_file, list_directory, and write_file. ' +
  'Be thorough but efficient — prefer targeted searches over broad reads.\n' +
  '\n' +
  'TOOL GUIDANCE:\n' +
  '- list_directory: Use FIRST to understand structure before reading files.\n' +
  '- grep_file: Use for pattern searches across files. Faster than reading entire files.\n' +
  '- read_file: Use when you know the exact file to read. Include offset/limit for large files.\n' +
  '- write_file: Use ONLY to cache large intermediate findings for the main agent.\n' +
  '\n' +
  'RULES:\n' +
  '- Never re-read files you already have content from.\n' +
  '- Never create games, build games, modify todos, or delegate subagents.\n' +
  '- Never make design decisions — just report facts.\n' +
  '\n' +
  'OUTPUT FORMAT — wrap every response in:\n' +
  '## Summary\n<1-2 sentence overview>\n' +
  '## Key Findings\n- **path/to/file L42-L55**: <finding>\n' +
  '## Open Questions (if any)\n- <question>\n' +
  'Keep the response under 500 words. Skip the Details section if nothing to add.';

async function delegateSubagentHandler(
  args: Record<string, unknown>,
  root: string,
  config?: AgentConfig,
): Promise<string> {
  if (!config) {
    return 'Error: delegate_subagent requires agent configuration (API key, model).';
  }

  const instruction = String(args.instruction ?? '').trim();
  if (!instruction) {
    return 'Error: instruction parameter is required.';
  }

  // Enforce max subagent limit
  let activeCount = subagentCounters.get(root) ?? 0;
  if (activeCount >= MAX_SUBAGENTS) {
    return `Error: Maximum ${MAX_SUBAGENTS} subagents already active for this session. ` +
      'Wait for existing subagents to complete before delegating more.';
  }
  subagentCounters.set(root, activeCount + 1);

  try {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || CONFIG.providers.deepseek.defaultBaseUrl,
    });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SUBAGENT_SYSTEM_PROMPT },
      { role: 'user', content: instruction },
    ];

    const subagentModel = config.fallbackModel || CONFIG.providers.deepseek.fallbackModel;

    for (let iteration = 0; iteration < SUBAGENT_MAX_ITERATIONS; iteration++) {
      // Respect parent agent cancellation
      if (config.signal?.aborted) {
        return '(subagent cancelled)';
      }

      const subagentTimeout = config.toolTimeout || CONFIG.agent.toolTimeoutMs;
      const response = await Promise.race([
        client.chat.completions.create({
          model: subagentModel,
          messages,
          tools: getOpenAIToolsFiltered('subagent'),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Subagent API call timed out after ${subagentTimeout}ms`)),
            subagentTimeout,
          ),
        ),
      ]);

      const choice = response.choices[0];
      const msg = choice.message;

      // Text response without tool calls — subagent is done
      if (msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
        return msg.content;
      }

      // Tool calls — push assistant message then execute each tool
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });

        for (const tc of msg.tool_calls) {
          let toolArgs: Record<string, unknown>;
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: `Error: Could not parse tool arguments as JSON: ${tc.function.arguments}`,
            });
            continue;
          }

          let toolResult: string;
          try {
            const entry = toolRegistry.find(
              (t) => t.definition.name === tc.function.name,
            );
            if (!entry) {
              toolResult = `Error: Tool "${tc.function.name}" is not available to subagents.`;
            } else {
              toolResult = await entry.handler(toolArgs, root);
            }
          } catch (err: unknown) {
            toolResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: toolResult,
          });
        }
        continue;
      }

      // Empty response (shouldn't normally happen)
      return '(subagent produced empty response)';
    }

    return '(subagent reached maximum iterations without producing a response)';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Redact API key from error messages
    const redacted = config.apiKey ? msg.replace(config.apiKey, '[REDACTED]') : msg;
    return `Subagent error: ${redacted}`;
  } finally {
    // Decrement counter on completion or failure
    activeCount = subagentCounters.get(root) ?? 1;
    subagentCounters.set(root, Math.max(0, activeCount - 1));
  }
}

async function gitLogHandler(args: Record<string, unknown>, root: string) {
  const count = Math.min(Math.max(1, Number(args.count) || 10), 50);
  return `Git history (last ${count} commits):\n${gitLog(root, count)}`;
}

async function gitDiffHandler(args: Record<string, unknown>, root: string) {
  const staged = args.staged === true;
  const output = staged ? gitDiffStaged(root) : gitDiff(root);
  return output || '(no changes)';
}

async function gitStatusHandler(_args: Record<string, unknown>, root: string) {
  return `Workspace git status:\n${gitStatus(root)}`;
}

async function githubPushHandler(args: Record<string, unknown>, root: string, config?: AgentConfig) {
  const token = config?.githubToken;
  if (!token) {
    return 'GitHub token not configured. The user must add a GitHub personal access token in Settings (gear icon) with "repo" and "admin:repo_hook" scopes.';
  }
  const repoName = typeof args.repoName === 'string' && args.repoName ? args.repoName : undefined;
  const isPrivate = args.private === true;

  const result = await githubPush(root, token, repoName, isPrivate);

  if (result.success) {
    return `GITHUB PUSH SUCCESS.\nRepository: ${result.repoUrl}\nGitHub Pages: ${result.pagesUrl}\n\nThe game is now live and shareable!`;
  }
  return `GITHUB PUSH FAILED: ${result.error}\n\nCheck that:\n1. The GitHub token has "repo" scope enabled\n2. A game has been built (run build_game first)\n3. The repository name is available`;
}

async function extractGameState(page: any): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const state: Record<string, unknown> = {};
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
    if (canvas) state._canvas = { width: canvas.width, height: canvas.height };

    // Dynamic window-global sweep (catches non-module scripts)
    const skipRE = /^(on|webkit|moz|ms|constructor|__|\$|postMessage|fetch|console|document|window|navigator|location|localStorage|sessionStorage|crypto|performance|Math|JSON|Promise|Symbol|Array|Object|String|Number|Boolean|Date|RegExp|Error|Map|Set|WeakMap|WeakSet|Intl|Reflect|Proxy|Atomics|SharedArrayBuffer|DataView)/;
    const w = window as any;
    const keys = Object.getOwnPropertyNames(w).filter(k => !skipRE.test(k));
    for (const key of keys.slice(0, 50)) {
      try {
        const val = w[key];
        if (val === undefined || val === null) continue;
        if (typeof val === 'function') continue;
        if (val instanceof HTMLElement) continue;
        if (typeof val === 'object') {
          const str = JSON.stringify(val);
          state[key] = str.length > 500 ? `[object: ${Object.keys(val).slice(0, 5).join(',')}...]` : val;
        } else {
          state[key] = String(val).slice(0, 200);
        }
      } catch { /* skip inaccessible */ }
    }

    // Fallback: explicitly check likely window-assigned vars (module scripts)
    const likelyKeys = ['score', 'gameOver', 'gameover', 'isGameOver', 'snake', 'food', 'direction', 'ball', 'paddle', 'bricks', 'level', 'lives', 'player', 'enemies', 'state'];
    for (const key of likelyKeys) {
      if (key in state) continue; // already captured by dynamic sweep
      try {
        const val = (window as any)[key];
        if (val !== undefined && val !== null) {
          state[key] = typeof val === 'object' ? JSON.stringify(val).slice(0, 200) : String(val).slice(0, 200);
        }
      } catch { /* skip */ }
    }
    return state;
  });
}

async function gameRuntimeHandler(
  args: Record<string, unknown>,
  root: string,
  config?: AgentConfig,
): Promise<string> {
  if (!config) {
    return 'Error: game_runtime requires agent configuration.';
  }

  const maxSteps =
    typeof args.maxSteps === 'number'
      ? Math.floor(args.maxSteps)
      : CONFIG.gameRuntime.defaultMaxSteps;
  const fps =
    typeof args.fps === 'number'
      ? Math.floor(args.fps)
      : CONFIG.gameRuntime.defaultFps;
  const stepDelay = Math.round(1000 / fps);

  const outputPath = path.join(root, 'output', 'index.html');
  if (!fs.existsSync(outputPath)) {
    return 'Error: No built game found. Run build_game first to generate output/index.html.';
  }

  const html = fs.readFileSync(outputPath, 'utf-8');
  const fallbackModel = config.fallbackModel || CONFIG.providers.deepseek.fallbackModel;

  const testReport: string[] = [];
  const issues: string[] = [];

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html);


    // Wait for game to initialize
    await page.waitForTimeout(1000);

    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || CONFIG.providers.deepseek.defaultBaseUrl,
    });

    for (let step = 0; step < maxSteps; step++) {
      const state = await extractGameState(page);

      const stateText = Object.entries(state)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');

      // Check for game-over or edge conditions
      if (
        state.gameOver === 'true' ||
        state.gameover === 'true' ||
        state.isGameOver === 'true'
      ) {
        testReport.push(
          `Step ${step + 1}: Game over detected. State: ${JSON.stringify(state)}`,
        );
        break;
      }

      // Ask model for next action
      let action = 'none';
      try {
        const response = await client.chat.completions.create({
          model: fallbackModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a game tester. Given the current game state, output ONLY a single keyboard key name (e.g., ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space) that would be the best next action for the game. No explanation, just the key name.',
            },
            {
              role: 'user',
              content: `Game state:\n${stateText}\n\nNext action (key name only):`,
            },
          ],
          max_tokens: 10,
          temperature: 0.3,
        });

        action = (response.choices[0]?.message?.content || 'none').trim();
        // Clean up any extra text
        action = action.replace(/[^a-zA-Z]/g, '');
      } catch {
        testReport.push(
          `Step ${step + 1}: Model API call failed, stopping test.`,
        );
        break;
      }

      if (action === 'none' || !action) {
        testReport.push(
          `Step ${step + 1}: Model returned no action, stopping.`,
        );
        break;
      }

      // Execute action
      await page.keyboard.press(action);
      testReport.push(
        `Step ${step + 1}: State keys=[${Object.keys(state).join(',')}] | Action=${action}`,
      );

      await page.waitForTimeout(stepDelay);
    }

    // Final analysis
    const finalState = await extractGameState(page);

    if (
      finalState.gameOver !== 'true' &&
      finalState.gameover !== 'true' &&
      finalState.isGameOver !== 'true'
    ) {
      testReport.push(
        `Game did not trigger game-over after ${maxSteps} steps. This may be normal for some games.`,
      );
    }

    // Check for edge-case issues
    const canvasInfo = finalState._canvas as { width: number; height: number } | undefined;
    if (canvasInfo && (canvasInfo.width === 0 || canvasInfo.height === 0)) {
      issues.push('Canvas has zero dimensions — check canvas.width/height setup.');
    }

    if (finalState.score === '0' || finalState.score === 0) {
      issues.push('Score remained 0 throughout the test — verify scoring logic.');
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `RUNTIME ERROR: ${msg}. The game may have crashed during testing.`;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const report = [
    `GAME RUNTIME TEST REPORT (${testReport.length} steps, ${fps} FPS)`,
    '',
    '--- Test Log ---',
    ...testReport,
    '',
    issues.length > 0 ? '--- Issues Found ---' : '--- Issues Found ---\nNone detected.',
    ...issues,
    '',
    issues.length > 0
      ? 'Review the issues above and fix the game code. Then run build_game again to apply fixes.'
      : 'No runtime issues detected. The game appears to handle basic interactions correctly.',
  ].join('\n');

  return report;
}

export const toolRegistry: ToolHandler[] = [
  { definition: readFileDef, handler: readFileHandler },
  { definition: writeFileDef, handler: writeFileHandler },
  { definition: editFileDef, handler: editFileHandler },
  { definition: listDirDef, handler: listDirHandler },
  { definition: grepFileDef, handler: grepFileHandler },
  { definition: buildGameDef, handler: buildGameHandler },
  { definition: loadSkillsDef, handler: loadSkillsHandler },
  { definition: writeTodoDef, handler: writeTodoHandler },
  { definition: setErrorDef, handler: setErrorHandler },
  { definition: delegateSubagentDef, handler: delegateSubagentHandler },
  { definition: gameRuntimeDef, handler: gameRuntimeHandler },
  { definition: gitLogDef, handler: gitLogHandler },
  { definition: gitDiffDef, handler: gitDiffHandler },
  { definition: gitStatusDef, handler: gitStatusHandler },
  { definition: githubPushDef, handler: githubPushHandler },
];

export const tools: ToolDefinition[] = toolRegistry.map(t => t.definition);

export function getOpenAITools(config?: AgentConfig): { type: 'function'; function: ToolDefinition }[] {
  return getOpenAIToolsFiltered('master', config);
}

export function getOpenAIToolsFiltered(
  role: 'master' | 'subagent',
  config?: AgentConfig,
): { type: 'function'; function: ToolDefinition }[] {
  const allowed = CONFIG.tools.allowed[role];
  return toolRegistry
    .filter((t) => allowed.includes(t.definition.name))
    .filter((t) => {
      if (t.definition.name === 'github_push' && !config?.githubToken) return false;
      return true;
    })
    .map((t) => ({ type: 'function' as const, function: t.definition }));
}
