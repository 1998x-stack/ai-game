import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { parseGameDesignDocument } from '@/lib/game-design/gdd';
import { validateWorkspacePath } from '@/lib/security/validation';
import { boardFromMechanics, emptyBoard, parseDesignBoard, type DesignBoard } from './model';

const MAX_BYTES = 128_000;
const FILENAME = 'design.board.json';
const fingerprint = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export class BoardConflictError extends Error {
  constructor() { super('Board has changed since it was loaded; reload and reconcile before saving'); }
}
function boardFile(root: string) {
  const location = validateWorkspacePath(FILENAME, root, true);
  // existsSync returns false for dangling symlinks. lstat detects the
  // link itself so atomic rename does not silently replace it.
  try {
    if (fs.lstatSync(location).isSymbolicLink()) {
      throw new Error('Board symlinks are not allowed');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return location;
}
function readRaw(root: string): string | null {
  const filename = boardFile(root);
  if (!fs.existsSync(filename)) return null;
  if (!fs.lstatSync(filename).isFile()) throw new Error('Invalid board file type');
  if (fs.statSync(filename).size > MAX_BYTES) throw new Error('Board file exceeds 128 KB');
  return fs.readFileSync(filename, 'utf8');
}
function defaultBoard(root: string): DesignBoard {
  const filename = validateWorkspacePath('game.design.json', root);
  if (fs.existsSync(filename) && fs.lstatSync(filename).isFile() &&
      fs.statSync(filename).size < 64_000) {
    try {
      const gdd = parseGameDesignDocument(JSON.parse(fs.readFileSync(filename, 'utf8')));
      return boardFromMechanics(gdd.title, gdd.mechanics);
    } catch {
      // A malformed or changed GDD must not erase the standalone design board.
    }
  }
  return emptyBoard();
}
export interface LoadedBoard { board: DesignBoard; revision: string }
export function loadDesignBoard(root: string): LoadedBoard {
  const raw = readRaw(root);
  return { board: raw === null ? defaultBoard(root) : parseDesignBoard(JSON.parse(raw)),
    revision: fingerprint(raw ?? '') };
}
function sourceDiff(root: string): string {
  try {
    const diff = execFileSync('git', ['diff', '--no-ext-diff', '--', 'scripts/game.js'], {
      cwd: root, encoding: 'utf8', timeout: 3_000,
      maxBuffer: 50_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return diff.slice(0, 12_000);
  } catch { return ''; }
}
function inspectContext(root: string) {
  const directory = validateWorkspacePath('assets', root);
  const assets: string[] = [];
  if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()) {
    for (const name of fs.readdirSync(directory).sort().slice(0, 50)) {
      if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name)) {
        const file = validateWorkspacePath('assets/' + name, root);
        if (fs.lstatSync(file).isFile()) assets.push('assets/' + name);
      }
    }
  }
  const gd = validateWorkspacePath('game.design.json', root);
  let mechanics: Array<{ id: string; title: string }> = [];
  if (fs.existsSync(gd) && fs.statSync(gd).size <= 64_000) {
    try {
      const parsed = parseGameDesignDocument(JSON.parse(fs.readFileSync(gd, 'utf8')));
      mechanics = parsed.mechanics.map(m => ({ id: m.id, title: m.description }));
    } catch { /* GDD may be unfinished */ }
  }
  return { assets, mechanics, codeDiff: sourceDiff(root) };
}
export function loadBoardWorkspace(root: string) {
  return { ...loadDesignBoard(root), ...inspectContext(root) };
}
/**
 * Compare-and-swap persistence with exclusive local lock and atomic rename.
 * Within a single filesystem, two stale writers cannot silently overwrite.
 */
export function saveDesignBoard(root: string, candidate: unknown, expectedRevision: string): LoadedBoard {
  if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
    throw new Error('If-Match revision must be a SHA-256 digest');
  }
  const board = parseDesignBoard(candidate);
  const serialized = JSON.stringify(board, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new Error('Board exceeds 128 KB');
  const filename = boardFile(root);
  const lock = validateWorkspacePath('design.board.lock', root, true);
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new BoardConflictError();
    throw err;
  }
  try {
    const current = readRaw(root);
    if (fingerprint(current ?? '') !== expectedRevision) throw new BoardConflictError();
    const temporary = validateWorkspacePath('design.board.' + crypto.randomUUID() + '.tmp', root, true);
    try {
      fs.writeFileSync(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, filename);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
    return { board, revision: fingerprint(serialized) };
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}
