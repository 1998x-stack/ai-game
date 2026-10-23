import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { parseGameTestContract, type GameTestContract } from '@/lib/runtime/game-contract';
import { validateWorkspacePath } from '@/lib/security/validation';
import { runIsolatedQuality, type IsolatedQualityRequest, type SandboxExecutionResult } from './runner';

export type JobPhase = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface SandboxJobReceipt {
  schemaVersion: 1;
  id: string;
  status: JobPhase;
  createdAt: string;
  updatedAt: string;
  isolated: boolean;
  gameSha256: string;
  contractSha256: string;
  reportPath?: string;
  result?: 'passed'|'failed'|'incomplete';
  error?: string;
}
interface Queued {
  root: string;
  receipt: SandboxJobReceipt;
  html: string;
  contract: GameTestContract;
  controller: AbortController;
}
export type JobExecutor = (request: IsolatedQualityRequest) => Promise<SandboxExecutionResult>;
const live = new Map<string, Queued>();
const queue: Queued[] = [];
let running = 0;
const MAX_RUNNING = 2, MAX_QUEUED = 12;
let executor: JobExecutor = input => runIsolatedQuality({ ...input, forceIsolation: true });

/** Test-only dependency injection; NEVER available as an HTTP endpoint. */
export function setSandboxJobExecutorForTests(replacement?: JobExecutor) {
  executor = replacement ?? (input => runIsolatedQuality({ ...input, forceIsolation: true }));
}
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function receiptFile(root: string, id: string) {
  if (!uuid(id)) throw new Error('Invalid sandbox job ID');
  return validateWorkspacePath('output/sandbox-jobs/' + id + '.json', root, true);
}
function persist(item: Queued) {
  item.receipt.updatedAt = new Date().toISOString();
  const filename = receiptFile(item.root, item.receipt.id);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = filename + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(item.receipt, null, 2), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, filename);
  } finally { fs.rmSync(tmp, { force: true }); }
}
function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
function drain() {
  while (running < MAX_RUNNING && queue.length) {
    const item = queue.shift()!;
    if (item.controller.signal.aborted) continue;
    running++;
    item.receipt.status = 'running';
    persist(item);
    void Promise.resolve().then(() => executor({
      workspaceRoot: item.root, html: item.html, contract: item.contract,
      signal: item.controller.signal,
    })).then(result => {
      if (item.controller.signal.aborted) {
        item.receipt.status = 'cancelled';
      } else {
        item.receipt.status = 'succeeded';
        item.receipt.reportPath = result.reportPath;
        item.receipt.result = result.report.status;
        item.receipt.isolated = result.isolated;
      }
    }).catch(error => {
      item.receipt.status = item.controller.signal.aborted ? 'cancelled' : 'failed';
      item.receipt.error = errorText(error);
    }).finally(() => {
      running--;
      try { persist(item); } finally { live.delete(item.receipt.id); drain(); }
    });
  }
}
export function enqueueSandboxJob(root: string, html: string, contractInput: GameTestContract): SandboxJobReceipt {
  const contract = parseGameTestContract(contractInput);
  if (Buffer.byteLength(html, 'utf8') > 1_000_000) throw new Error('HTML exceeds sandbox limit');
  if (queue.length >= MAX_QUEUED) throw new Error('Sandbox queue capacity exceeded');
  if ([...live.values()].some(item => item.root === root)) throw new Error('Workspace already has an active sandbox job');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const receipt: SandboxJobReceipt = {
    schemaVersion: 1, id, status: 'queued', createdAt: now, updatedAt: now,
    isolated: false, gameSha256: sha(html), contractSha256: sha(JSON.stringify(contract)),
  };
  const item = { root, receipt, html, contract, controller: new AbortController() };
  live.set(id, item);
  persist(item);
  queue.push(item);
  drain();
  return { ...receipt };
}
export function readSandboxJob(root: string, id: string): SandboxJobReceipt | null {
  const current = live.get(id);
  if (current && current.root === root) return { ...current.receipt };
  const target = receiptFile(root, id);
  if (!fs.existsSync(target)) return null;
  if (!fs.lstatSync(target).isFile() || fs.statSync(target).size > 8_000) throw new Error('Invalid job receipt');
  const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid job receipt');
  const saved = parsed as SandboxJobReceipt;
  if (saved.id !== id || saved.schemaVersion !== 1 ||
      !['queued','running','succeeded','failed','cancelled','interrupted'].includes(saved.status)) {
    throw new Error('Invalid persisted job state');
  }
  if (saved.status === 'queued' || saved.status === 'running') {
    // Process restarted: do not replay a task which may still be chargeable or executing.
    saved.status = 'interrupted';
    saved.error = 'Worker ownership lost after process restart; manual retry required';
    const temporary: Queued = { root, receipt: saved, html: '',
      contract: null as unknown as GameTestContract, controller: new AbortController() };
    persist(temporary);
  }
  return saved;
}
export function cancelSandboxJob(root: string, id: string): SandboxJobReceipt | null {
  const item = live.get(id);
  if (!item || item.root !== root) return readSandboxJob(root, id);
  item.controller.abort();
  if (item.receipt.status === 'queued') {
    const index = queue.indexOf(item);
    if (index >= 0) queue.splice(index, 1);
    item.receipt.status = 'cancelled';
    persist(item);
    live.delete(item.receipt.id);
    drain();
  }
  return { ...item.receipt, ...(item.receipt.status === 'running'
    ? { error: 'Cancellation requested; container termination in progress' } : {}) };
}
