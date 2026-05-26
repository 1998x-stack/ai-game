import fs from 'fs';
import path from 'path';
import { ToolDefinition, ToolHandler } from './types';

function validatePath(userPath: string, workspaceRoot: string): string {
  if (userPath.includes('..')) {
    throw new Error(`Path traversal not allowed (contains ".."): ${userPath}`);
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
  if (realResolved !== workspaceRoot && !realResolved.startsWith(rootBoundary)) {
    throw new Error(`Path is outside workspace root: ${userPath}`);
  }
  return resolved;
}

// ---- Tool Definitions ---- //

const readFileDef: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file within the user space. Returns the full file content as a string.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' } },
    required: ['path'],
    additionalProperties: false,
  },
};

const writeFileDef: ToolDefinition = {
  name: 'write_file',
  description: 'Write or overwrite a file within the user space. Creates parent directories if they do not exist.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' },
      content: { type: 'string', description: 'Full content to write to the file' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
};

const editFileDef: ToolDefinition = {
  name: 'edit_file',
  description: 'Replace text in a file within the user space. Finds the first occurrence of old_str and replaces it with new_str.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' },
      old_str: { type: 'string', description: 'The exact text to search for (first occurrence is replaced)' },
      new_str: { type: 'string', description: 'The replacement text' },
    },
    required: ['path', 'old_str', 'new_str'],
    additionalProperties: false,
  },
};

const listDirDef: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and directories at the given path within the user space.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'Relative or absolute path to the directory (must be within workspace root)' } },
    required: ['path'],
    additionalProperties: false,
  },
};

const buildGameDef: ToolDefinition = {
  name: 'build_game',
  description: 'Run the build command to package scripts and assets into a single HTML file. No parameters needed.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const loadSkillsDef: ToolDefinition = {
  name: 'load_skills',
  description: 'Load metadata for all available skills in the skills/ directory. Returns name, description, and trigger keywords for each skill — use this to discover which skills apply to the current game request before reading the full skill file.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const setErrorDef: ToolDefinition = {
  name: 'set_error',
  description: 'Report an error to the user when the agent encounters an unrecoverable issue. Call this when you cannot recover from a problem.',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string', description: 'The error message describing what went wrong' } },
    required: ['message'],
    additionalProperties: false,
  },
};

// ---- Tool Handlers ---- //

async function readFileHandler(args: Record<string, unknown>, workspaceRoot: string): Promise<string> {
  const safePath = validatePath(String(args.path), workspaceRoot);
  return fs.readFileSync(safePath, 'utf-8');
}

async function writeFileHandler(args: Record<string, unknown>, workspaceRoot: string): Promise<string> {
  const safePath = validatePath(String(args.path), workspaceRoot);
  fs.mkdirSync(path.dirname(safePath), { recursive: true });
  fs.writeFileSync(safePath, String(args.content), 'utf-8');
  return `Successfully wrote ${safePath}`;
}

async function editFileHandler(args: Record<string, unknown>, workspaceRoot: string): Promise<string> {
  const safePath = validatePath(String(args.path), workspaceRoot);
  const oldStr = String(args.old_str);
  const newStr = String(args.new_str);
  const currentContent = fs.readFileSync(safePath, 'utf-8');
  const idx = currentContent.indexOf(oldStr);
  if (idx === -1) {
    throw new Error(`Could not find old_str in ${safePath}. The text was not found.`);
  }
  const updatedContent = currentContent.slice(0, idx) + newStr + currentContent.slice(idx + oldStr.length);
  fs.writeFileSync(safePath, updatedContent, 'utf-8');
  return `Successfully edited ${safePath}`;
}

async function listDirHandler(args: Record<string, unknown>, workspaceRoot: string): Promise<string> {
  const safePath = validatePath(String(args.path), workspaceRoot);
  const entries = fs.readdirSync(safePath, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('\n');
}

async function buildGameHandler(_args: Record<string, unknown>, workspaceRoot: string): Promise<string> {
  const { buildGame } = await import('@/lib/build/packager');
  const result = buildGame(workspaceRoot);
  if (result.errors.length > 0) {
    return `Build completed with warnings: ${result.errors.join('; ')}`;
  }
  return `Game built successfully. Open index.html to play.`;
}

async function loadSkillsHandler(_args: Record<string, unknown>, workspaceRoot: string): Promise<string> {
  const skillsDir = path.join(workspaceRoot, 'skills', 'examples');
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return JSON.stringify([]);
  }

  const skills: Array<{ file: string; name: string; description: string; triggers: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    try {
      const content = fs.readFileSync(path.join(skillsDir, entry.name), 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;
      const result: Record<string, string> = {};
      for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      if (result.name && result.description) {
        skills.push({ file: entry.name, name: result.name, description: result.description, triggers: result.triggers || '' });
      }
    } catch {
      // skip unreadable
    }
  }
  return JSON.stringify(skills, null, 2);
}

async function setErrorHandler(args: Record<string, unknown>, _root: string): Promise<string> {
  return String(args.message);
}

// ---- Tool Registry ---- //

export const toolRegistry: ToolHandler[] = [
  { definition: readFileDef, handler: readFileHandler },
  { definition: writeFileDef, handler: writeFileHandler },
  { definition: editFileDef, handler: editFileHandler },
  { definition: listDirDef, handler: listDirHandler },
  { definition: buildGameDef, handler: buildGameHandler },
  { definition: loadSkillsDef, handler: loadSkillsHandler },
  { definition: setErrorDef, handler: setErrorHandler },
];

export const tools: ToolDefinition[] = toolRegistry.map((t) => t.definition);

export function getOpenAITools(): { type: 'function'; function: ToolDefinition }[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: tool,
  }));
}
