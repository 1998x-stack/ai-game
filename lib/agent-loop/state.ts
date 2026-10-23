import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type LoopPhase =
  | 'planning' | 'generating' | 'building' | 'testing'
  | 'reviewing' | 'repairing' | 'awaiting-approval'
  | 'accepted' | 'needs-human' | 'cancelled';

export interface LoopEvent { at: string; phase: LoopPhase; detail: string }
export interface LoopState {
  schemaVersion: 1;
  id: string;
  phase: LoopPhase;
  goal: string;
  createdAt: string;
  deadlineAt: string;
  attempt: number;
  maxAttempts: number;
  modelCalls: number;
  generationReserved?: boolean;
  maxModelCalls: number;
  tokensUsed: number;
  tokenBudget: number;
  baselineSha: string;
  activeSha: string;
  contractSha?: string;
  reportId?: string;
  reportPath?: string;
  lastFailure?: string;
  events: LoopEvent[];
}

const phases = new Set<LoopPhase>([
  'planning','generating','building','testing','reviewing','repairing',
  'awaiting-approval','accepted','needs-human','cancelled',
]);
const DIR = 'output/agent-loop';
export const sha256 = (value: string) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
export function loopPaths(root: string) {
  return {
    state: path.join(root, DIR, 'state.json'),
    backup: path.join(root, DIR, 'baseline-game.js'),
    source: path.join(root, 'scripts', 'game.js'),
  };
}
export function appendLoopEvent(state: LoopState, phase: LoopPhase, detail: string): void {
  state.phase = phase;
  state.events = [...state.events, {
    at: new Date().toISOString(), phase,
    detail: detail.slice(0, 240),
  }].slice(-40);
}
function atomicWrite(target: string, content: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}
export function loadLoopState(root: string): LoopState | null {
  const file = loopPaths(root).state;
  if (!fs.existsSync(file)) return null;
  if (fs.statSync(file).size > 32_000) throw new Error('Loop state exceeds 32 KB');
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid loop checkpoint');
  }
  const state = value as LoopState;
  if (state.schemaVersion !== 1 || !/^[0-9a-f-]{36}$/i.test(state.id) ||
      !phases.has(state.phase) ||
      !Number.isSafeInteger(state.attempt) || state.attempt < 0 || state.attempt > 3 ||
      !Number.isSafeInteger(state.modelCalls) || state.modelCalls < 0 || state.modelCalls > 3 ||
      (state.generationReserved !== undefined && typeof state.generationReserved !== 'boolean') ||
      !Number.isFinite(state.tokensUsed) || state.tokensUsed < 0 ||
      !Number.isFinite(state.tokenBudget) || state.tokenBudget < 1000 ||
      !/^[a-f0-9]{64}$/.test(state.baselineSha) ||
      !/^[a-f0-9]{64}$/.test(state.activeSha) ||
      !Array.isArray(state.events) || state.events.length > 40) {
    throw new Error('Malformed loop checkpoint');
  }
  return state;
}
export function saveLoopState(root: string, state: LoopState) {
  atomicWrite(loopPaths(root).state, JSON.stringify(state, null, 2) + '\n');
}
export function saveLoopBaseline(root: string, content: string) {
  atomicWrite(loopPaths(root).backup, content);
}
export function writeLoopSource(root: string, content: string) {
  // Only the exact game source file is written by the loop. No arbitrary paths.
  if (Buffer.byteLength(content, 'utf8') > 120_000) throw new Error('Generated source exceeds 120 KB');
  const file = loopPaths(root).source;
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('Game source symlinks are not allowed');
  }
  atomicWrite(file, content);
}
export function readLoopSource(root: string): string {
  const file = loopPaths(root).source;
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('Game source symlinks are not allowed');
  }
  if (!fs.existsSync(file)) return '';
  if (fs.statSync(file).size > 120_000) throw new Error('Game source exceeds 120 KB');
  return fs.readFileSync(file, 'utf8');
}
export function isTerminal(phase: LoopPhase): boolean {
  return ['accepted','needs-human','cancelled'].includes(phase);
}
