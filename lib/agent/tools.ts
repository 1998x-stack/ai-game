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
  const rootBoundary = workspaceRoot.endsWith(path.sep) ? workspaceRoot : workspaceRoot + path.sep;
  if (realResolved !== workspaceRoot && !realResolved.startsWith(rootBoundary)) {
    throw new Error(`Path is outside workspace root: ${userPath}`);
  }
  return resolved;
}

const readFileDef: ToolDefinition = {
  name: 'read_file',
  description: 'Read the contents of a file within the user space.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' } }, required: ['path'], additionalProperties: false },
};

const writeFileDef: ToolDefinition = {
  name: 'write_file',
  description: 'Write or overwrite a file within the user space. Creates parent directories if they do not exist.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' }, content: { type: 'string', description: 'Full content to write to the file' } }, required: ['path', 'content'], additionalProperties: false },
};

const editFileDef: ToolDefinition = {
  name: 'edit_file',
  description: 'Replace text in a file. Finds the first occurrence of old_str and replaces it with new_str.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative or absolute path to the file (must be within workspace root)' }, old_str: { type: 'string', description: 'The exact text to search for' }, new_str: { type: 'string', description: 'The replacement text' } }, required: ['path', 'old_str', 'new_str'], additionalProperties: false },
};

const listDirDef: ToolDefinition = {
  name: 'list_directory',
  description: 'List files and directories at the given path within the user space.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative or absolute path to the directory (must be within workspace root)' } }, required: ['path'], additionalProperties: false },
};

const buildGameDef: ToolDefinition = {
  name: 'build_game',
  description: 'Run the build command to package scripts and assets into a single HTML file.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const loadSkillsDef: ToolDefinition = {
  name: 'load_skills',
  description: 'Load metadata for all available skills in the skills/ directory.',
  parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
};

const writeTodoDef: ToolDefinition = {
  name: 'write_todo',
  description: 'Write a game design plan as a markdown checklist to todo.md. Use "- [ ]" for pending, "- [x]" for complete. After completing a step, use edit_file to toggle it.',
  parameters: { type: 'object', properties: { content: { type: 'string', description: 'Full markdown content for todo.md' } }, required: ['content'], additionalProperties: false },
};

const setErrorDef: ToolDefinition = {
  name: 'set_error',
  description: 'Report an error to the user when the agent encounters an unrecoverable issue.',
  parameters: { type: 'object', properties: { message: { type: 'string', description: 'The error message' } }, required: ['message'], additionalProperties: false },
};

async function readFileHandler(args: Record<string, unknown>, root: string) {
  return fs.readFileSync(validatePath(String(args.path), root), 'utf-8');
}
async function writeFileHandler(args: Record<string, unknown>, root: string) {
  const p = validatePath(String(args.path), root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(args.content), 'utf-8');
  return `Successfully wrote ${p}`;
}
async function editFileHandler(args: Record<string, unknown>, root: string) {
  const p = validatePath(String(args.path), root);
  const oldStr = String(args.old_str), newStr = String(args.new_str);
  const cur = fs.readFileSync(p, 'utf-8');
  const idx = cur.indexOf(oldStr);
  if (idx === -1) throw new Error(`Could not find old_str in ${p}`);
  fs.writeFileSync(p, cur.slice(0, idx) + newStr + cur.slice(idx + oldStr.length), 'utf-8');
  return `Successfully edited ${p}`;
}
async function listDirHandler(args: Record<string, unknown>, root: string) {
  const entries = fs.readdirSync(validatePath(String(args.path), root), { withFileTypes: true });
  return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
}
async function buildGameHandler(_: Record<string, unknown>, root: string) {
  const { buildGame } = await import('@/lib/build/packager');
  const result = buildGame(root);
  return result.errors.length > 0 ? `Build completed with warnings: ${result.errors.join('; ')}` : `Game built successfully.`;
}
async function loadSkillsHandler(_: Record<string, unknown>, root: string) {
  const dir = path.join(root, 'skills', 'examples');
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return '[]'; }
  const skills: Array<{ file: string; name: string; description: string; triggers: string }> = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const c = fs.readFileSync(path.join(dir, e.name), 'utf-8');
      const m = c.match(/^---\n([\s\S]*?)\n---/);
      if (!m) continue;
      const r: Record<string, string> = {};
      for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > -1) r[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
      if (r.name && r.description) skills.push({ file: e.name, name: r.name, description: r.description, triggers: r.triggers || '' });
    } catch { /* skip */ }
  }
  return JSON.stringify(skills, null, 2);
}
async function writeTodoHandler(args: Record<string, unknown>, root: string) {
  const c = String(args.content);
  fs.writeFileSync(path.join(root, 'todo.md'), c, 'utf-8');
  const pending = (c.match(/- \[ \]/g) || []).length;
  const done = (c.match(/- \[x\]/g) || []).length;
  return `Plan written to todo.md: ${done} done, ${pending} pending`;
}
async function setErrorHandler(args: Record<string, unknown>) {
  return String(args.message);
}

export const toolRegistry: ToolHandler[] = [
  { definition: readFileDef, handler: readFileHandler },
  { definition: writeFileDef, handler: writeFileHandler },
  { definition: editFileDef, handler: editFileHandler },
  { definition: listDirDef, handler: listDirHandler },
  { definition: buildGameDef, handler: buildGameHandler },
  { definition: loadSkillsDef, handler: loadSkillsHandler },
  { definition: writeTodoDef, handler: writeTodoHandler },
  { definition: setErrorDef, handler: setErrorHandler },
];

export const tools: ToolDefinition[] = toolRegistry.map(t => t.definition);

export function getOpenAITools(): { type: 'function'; function: ToolDefinition }[] {
  return tools.map(tool => ({ type: 'function' as const, function: tool }));
}
