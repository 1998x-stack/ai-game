import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { imageReference, sandboxDockerArgs, runIsolatedQuality, verifyWorkerReport } from '@/lib/sandbox/runner';
import { parseGameTestContract } from '@/lib/runtime/game-contract';
import { enqueueSandboxJob, readSandboxJob, cancelSandboxJob, setSandboxJobExecutorForTests } from '@/lib/sandbox/jobs';
import type { QualityReport } from '@/lib/runtime/quality-evaluator';

const roots: string[] = [];
const mode = process.env.AI_GAME_SANDBOX_MODE, image = process.env.AI_GAME_SANDBOX_IMAGE;
const DIGEST = 'sha256:' + 'c'.repeat(64);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const html = '<html><head></head><body><canvas id="gameCanvas"></canvas></body></html>';
const contract = parseGameTestContract({ schemaVersion: 1, name: 'Safety', seed: 42,
  viewport: { width: 800, height: 600 },
  scenarios: [{ id: 'boot', name: 'Boot', actions: [{ type: 'wait', ms: 1 }],
    assertions: [{ type: 'no-errors' }] }] });
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-')); roots.push(dir); return dir; }
function report(id: string): QualityReport {
  return { schemaVersion: 1, runId: id, contractName: contract.name, seed: contract.seed,
    contractSha256: sha(JSON.stringify(contract)), gameSha256: sha(html),
    startedAt: new Date().toISOString(), durationMs: 5, status: 'passed',
    scenarios: [{ id: 'boot', status: 'passed', checks: [
      { assertion: contract.scenarios[0].assertions[0], passed: true, detail: 'page errors: 0' },
    ], trace: [], pageErrors: [] }] };
}
afterEach(() => {
  if (mode === undefined) delete process.env.AI_GAME_SANDBOX_MODE;
  else process.env.AI_GAME_SANDBOX_MODE = mode;
  if (image === undefined) delete process.env.AI_GAME_SANDBOX_IMAGE;
  else process.env.AI_GAME_SANDBOX_IMAGE = image;
  setSandboxJobExecutorForTests();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe('Stage 4 Docker execution policy', () => {
  it('requires immutable image digest and restrictive flags', () => {
    const dir = root();
    expect(() => imageReference('playwright:latest')).toThrow('immutable');
    const args = sandboxDockerArgs(DIGEST, 'ai-game-' + 'a'.repeat(32), dir).join(' ');
    for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--pids-limit=96',
      '--pull=never', '--memory=768m', '--cpus=1.0', 'target=/input,readonly'])
      expect(args).toContain(flag);
    expect(args).not.toContain('--privileged');
    expect(args).not.toContain('docker.sock');
  });
  it('fails closed when production sandbox image is unconfigured', async () => {
    process.env.AI_GAME_SANDBOX_MODE = 'required';
    delete process.env.AI_GAME_SANDBOX_IMAGE;
    await expect(runIsolatedQuality({ workspaceRoot: root(), html, contract }))
      .rejects.toThrow('immutable image');
  });
  it('passes validated reports from mocked Docker and stores evidence', async () => {
    process.env.AI_GAME_SANDBOX_MODE = 'required';
    process.env.AI_GAME_SANDBOX_IMAGE = DIGEST;
    const dir = root();
    const result = await runIsolatedQuality({ workspaceRoot: dir, html, contract }, {
      run: async (args, container) => {
        expect(args).toContain('--network=none');
        const hex = container.replace('ai-game-', '');
        const id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
        return JSON.stringify({ protocol: 1, report: report(id) });
      },
    });
    expect(result.isolated).toBe(true);
    expect(result.report.status).toBe('passed');
    expect(fs.existsSync(path.join(dir, result.reportPath))).toBe(true);
  });
  it('rejects forged evidence, mismatched assertions and cancelled result', async () => {
    const id = crypto.randomUUID(), good = report(id);
    expect(verifyWorkerReport({ protocol: 1, report: good }, contract, html, id)).toEqual(good);
    expect(() => verifyWorkerReport({ protocol: 1, report: {
      ...good, contractSha256: '0'.repeat(64) } }, contract, html, id)).toThrow();
    expect(() => verifyWorkerReport({ protocol: 1, report: {
      ...good, scenarios: [{ ...good.scenarios[0], checks: [] }] } }, contract, html, id)).toThrow();
    process.env.AI_GAME_SANDBOX_MODE = 'required';
    process.env.AI_GAME_SANDBOX_IMAGE = DIGEST;
    const controller = new AbortController();
    await expect(runIsolatedQuality({ workspaceRoot: root(), html, contract, signal: controller.signal }, {
      run: async (_args, name) => {
        controller.abort();
        const hex = name.slice(8);
        return JSON.stringify({ protocol: 1, report: report(
          [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')) });
      },
    })).rejects.toThrow('cancelled');
  });
});
describe('bounded persisted job queue', () => {
  it('records a successful outcome without exposing the project as a container mount', async () => {
    const dir = root();
    let complete!: (value: any) => void;
    setSandboxJobExecutorForTests(() => new Promise(resolve => { complete = resolve; }));
    const job = enqueueSandboxJob(dir, html, contract);
    await vi.waitFor(() => expect(readSandboxJob(dir, job.id)?.status).toBe('running'));
    expect(() => enqueueSandboxJob(dir, html, contract)).toThrow('active');
    complete({ report: report(job.id), reportPath: 'output/playtests/a.json', isolated: true });
    await vi.waitFor(() => expect(readSandboxJob(dir, job.id)?.status).toBe('succeeded'));
    expect(readSandboxJob(dir, job.id)?.isolated).toBe(true);
  });
  it('cancels an active run and never publishes its result', async () => {
    const dir = root();
    setSandboxJobExecutorForTests(({ signal }) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const job = enqueueSandboxJob(dir, html, contract);
    await vi.waitFor(() => expect(readSandboxJob(dir, job.id)?.status).toBe('running'));
    cancelSandboxJob(dir, job.id);
    await vi.waitFor(() => expect(readSandboxJob(dir, job.id)?.status).toBe('cancelled'));
    expect(readSandboxJob(dir, job.id)?.reportPath).toBeUndefined();
  });
  it('does not replay job state after process ownership is lost', () => {
    const dir = root(), id = crypto.randomUUID();
    const target = path.join(dir, 'output/sandbox-jobs', id + '.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({
      schemaVersion: 1, id, status: 'running', createdAt: '', updatedAt: '',
      isolated: false, gameSha256: sha(html), contractSha256: sha(JSON.stringify(contract)),
    }));
    expect(readSandboxJob(dir, id)?.status).toBe('interrupted');
  });
});
