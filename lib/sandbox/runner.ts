import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { parseGameTestContract, type GameTestContract } from '@/lib/runtime/game-contract';
import { aggregateQualityStatus, formatQualityReport, type QualityReport } from '@/lib/runtime/quality-evaluator';
import { validateWorkspacePath } from '@/lib/security/validation';
import { runGameQuality } from '@/lib/runtime/quality-runner';

export type SandboxMode = 'required' | 'development-only';
export function sandboxMode(): SandboxMode {
  const configured = process.env.AI_GAME_SANDBOX_MODE;
  if (configured && configured !== 'required' && configured !== 'development-only') {
    throw new Error('Invalid AI_GAME_SANDBOX_MODE; fail closed');
  }
  if (configured === 'development-only' && process.env.NODE_ENV === 'production') {
    throw new Error('Unisolated browser testing is forbidden in production');
  }
  return configured === 'required' ? 'required' :
    configured === 'development-only' ? 'development-only' :
      (process.env.NODE_ENV === 'production' ? 'required' : 'development-only');
}

const IMAGE = /^(?:sha256:[0-9a-f]{64}|[a-z0-9][a-z0-9./_:-]*@sha256:[0-9a-f]{64})$/;
export function imageReference(value: string | undefined): string {
  if (!value || !IMAGE.test(value)) {
    throw new Error('Isolated runner requires a locally cached immutable image SHA-256. Refusing a mutable tag.');
  }
  return value;
}
/** No shell, host networking, Docker socket, project mount or privileged mode. */
export function sandboxDockerArgs(image: string, name: string, staging: string): string[] {
  imageReference(image);
  if (!/^ai-game-[a-f0-9]{32}$/.test(name)) throw new Error('Invalid container name');
  if (!path.isAbsolute(staging) || !fs.statSync(staging).isDirectory()) {
    throw new Error('Invalid staging directory');
  }
  return [
    'run', '--rm', '--init', '--pull=never', '--name', name,
    '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--pids-limit=96',
    '--memory=768m', '--memory-swap=768m', '--cpus=1.0',
    '--shm-size=128m', '--user=10001:10001',
    '--tmpfs=/tmp:rw,noexec,nosuid,size=96m,mode=1777',
    '--env=HOME=/tmp',
    '--mount', 'type=bind,source=' + staging + ',target=/input,readonly',
    image,
  ];
}
export interface IsolatedQualityRequest {
  workspaceRoot: string;
  html: string;
  contract: GameTestContract;
  signal?: AbortSignal;
  forceIsolation?: boolean;
}
export interface SandboxExecutionResult {
  report: QualityReport;
  reportPath: string;
  text: string;
  isolated: boolean;
}
export interface SandboxAdapter {
  run(args: string[], name: string, signal?: AbortSignal): Promise<string>;
}

function runDocker(args: string[], name: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', settled = false, timedOut = false;
    const child = spawn('docker', args, { shell: false, stdio: ['ignore','pipe','pipe'],
      env: process.env });
    const cleanup = () => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timeout);
    };
    const abort = () => {
      if (!settled) {
        child.kill('SIGTERM');
        // Force-remove any container left behind if the docker CLI exits early.
        const rm = spawn('docker', ['rm', '-f', name], {
          shell: false, stdio: 'ignore',
        });
        rm.on('error', () => {});
      }
    };
    const timeout = setTimeout(() => { timedOut = true; abort(); }, 40_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 500_000) abort();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2_000);
    });
    child.on('error', err => {
      settled = true; cleanup(); reject(new Error('Docker runner unavailable: ' + err.message));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true; cleanup();
      if (signal?.aborted) return reject(new Error('Isolated run cancelled'));
      if (timedOut) return reject(new Error('Isolated run exceeded 40 seconds'));
      if (stdout.length > 500_000) return reject(new Error('Worker output too large'));
      if (code !== 0) return reject(new Error('Isolated worker failed (' + code + '): ' + stderr.slice(-300)));
      resolve(stdout);
    });
  });
}
export const defaultSandboxAdapter: SandboxAdapter = { run: runDocker };
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function digest(value: string) { return crypto.createHash('sha256').update(value).digest('hex'); }

export function verifyWorkerReport(raw: unknown, contract: GameTestContract, html: string, runId: string): QualityReport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Malformed worker response');
  const envelope = raw as { protocol?: unknown; report?: unknown };
  const report = envelope.report as QualityReport | null;
  if (envelope.protocol !== 1 || !report || report.schemaVersion !== 1 ||
      report.runId !== runId || report.contractName !== contract.name ||
      report.contractSha256 !== digest(JSON.stringify(contract)) ||
      report.gameSha256 !== digest(html) ||
      report.seed !== contract.seed || !UUID.test(report.runId) ||
      !Number.isFinite(report.durationMs) || report.durationMs < 0 || report.durationMs > 60_000 ||
      typeof report.startedAt !== 'string' ||
      !Array.isArray(report.scenarios) || report.scenarios.length !== contract.scenarios.length) {
    throw new Error('Untrusted worker report metadata does not match submitted job');
  }
  for (let i = 0; i < report.scenarios.length; i++) {
    const s = report.scenarios[i], expected = contract.scenarios[i];
    if (!s || s.id !== expected.id ||
        !['passed','failed','incomplete'].includes(s.status) ||
        !Array.isArray(s.pageErrors) || s.pageErrors.length > 20 ||
        s.pageErrors.some(e => typeof e !== 'string' || e.length > 400) ||
        !Array.isArray(s.trace) || s.trace.length > expected.actions.length ||
        !Array.isArray(s.checks) || s.checks.length > expected.assertions.length ||
        s.checks.some((c, index) => !c || typeof c.passed !== 'boolean' ||
          typeof c.detail !== 'string' || c.detail.length > 400 ||
          JSON.stringify(c.assertion) !== JSON.stringify(expected.assertions[index])) ||
        (s.status === 'passed' && (s.checks.length !== expected.assertions.length ||
          s.checks.some(c => !c.passed) || s.pageErrors.length))) {
      throw new Error('Untrusted worker scenario failed integrity validation');
    }
  }
  if (report.status !== aggregateQualityStatus(report.scenarios)) {
    throw new Error('Worker reported inconsistent overall status');
  }
  return report;
}
function saveReport(root: string, report: QualityReport): string {
  const relative = 'output/playtests/' + report.runId + '.json';
  const target = validateWorkspacePath(relative, root, true);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, target);
  } finally { fs.rmSync(tmp, { force: true }); }
  return relative;
}
export async function runIsolatedQuality(
  request: IsolatedQualityRequest,
  adapter: SandboxAdapter = defaultSandboxAdapter,
): Promise<SandboxExecutionResult> {
  const contract = parseGameTestContract(request.contract);
  if (Buffer.byteLength(request.html, 'utf8') > 1_000_000) {
    throw new Error('Game HTML exceeds isolated worker 1 MB budget');
  }
  if (sandboxMode() === 'development-only' && !request.forceIsolation) {
    const result = await runGameQuality({ ...request, contract });
    return { ...result, isolated: false };
  }
  const image = imageReference(process.env.AI_GAME_SANDBOX_IMAGE);
  const runId = crypto.randomUUID();
  const name = 'ai-game-' + runId.replace(/-/g, '');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-sandbox-'));
  try {
    fs.chmodSync(staging, 0o755); // needs to be traversable by non-root container user
    fs.writeFileSync(path.join(staging, 'job.json'), JSON.stringify({
      schemaVersion: 1, runId, html: request.html, contract,
    }), { flag: 'wx', mode: 0o644 });
    const stdout = await adapter.run(sandboxDockerArgs(image, name, staging), name, request.signal);
    if (stdout.length > 500_000) throw new Error('Sandbox protocol exceeded output budget');
    if (request.signal?.aborted) throw new Error('Isolated run cancelled');
    const report = verifyWorkerReport(JSON.parse(stdout), contract, request.html, runId);
    const reportPath = saveReport(request.workspaceRoot, report);
    return { report, reportPath, isolated: true, text: formatQualityReport(report, reportPath) };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
