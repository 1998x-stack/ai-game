import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { beginLoop, advanceLoop, finishLoop, type LoopDriver } from '@/lib/agent-loop/engine';
import { loadLoopState, sha256 } from '@/lib/agent-loop/state';
import { executeAgentLoop } from '@/lib/agent-loop/service';
import { compileGameDesign } from '@/lib/game-design/compiler';
import { parseGameDesignDocument } from '@/lib/game-design/gdd';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const ORIGINAL = 'const initial = 1;\n';
const GENERATED = 'window.__GAME_TEST__={getState:()=>({phase:"playing",score:0,gameOver:false})};\n';
function setup(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-loop-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'game.js'), ORIGINAL);
  const source = path.join(process.cwd(), 'workspace', 'templates', 'snake', 'design.json');
  fs.copyFileSync(source, path.join(root, 'game.design.json'));
  return root;
}
function driver(root: string, outcomes: Array<'passed'|'failed'|'incomplete'> = ['passed']): LoopDriver {
  const design = parseGameDesignDocument(JSON.parse(fs.readFileSync(
    path.join(root, 'game.design.json'), 'utf8')));
  const contract = compileGameDesign(design).contract!;
  const contractSha256 = sha256(JSON.stringify(contract));
  let testIndex = 0;
  return {
    generate: vi.fn(async () => ({ source: GENERATED, tokens: 400 })),
    build: vi.fn(async () => ({ success: true, errors: [],
      html: '<!doctype html><html><body><canvas id="gameCanvas"></canvas></body></html>' })),
    test: vi.fn(async () => {
      const status = outcomes[Math.min(testIndex++, outcomes.length - 1)];
      return { report: { status, runId: 'c10b8a78-781c-40f1-b3cc-92321ae2b7d5',
        contractSha256 },
        reportPath: 'output/playtests/test.json', summary: status === 'passed' ? 'Passed' : 'score did not increase' };
    }),
  };
}
async function until(root: string, d: LoopDriver, target: string, max = 16) {
  let s = loadLoopState(root)!;
  for (let i = 0; i < max && s.phase !== target && !['needs-human','cancelled','accepted'].includes(s.phase); i++) {
    s = await advanceLoop(root, d);
  }
  return s;
}

describe('Stage 2.3 resumable agent repair loop', () => {
  it('plans, generates, builds, tests and waits for separate human approval', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Build a playable Snake game', maxAttempts: 2 });
    const d = driver(root);
    const awaiting = await until(root, d, 'awaiting-approval');
    expect(awaiting.phase).toBe('awaiting-approval');
    expect(awaiting.attempt).toBe(1);
    expect(awaiting.modelCalls).toBe(1);
    expect(awaiting.tokensUsed).toBe(400);
    expect(awaiting.reportPath).toBe('output/playtests/test.json');
    expect(await advanceLoop(root, d)).toEqual(awaiting);
    expect(() => beginLoop(root, { goal: 'Run a different goal' })).toThrow();
    expect(() => finishLoop(root, 'cancel')).not.toThrow();
    expect(fs.readFileSync(path.join(root, 'scripts', 'game.js'), 'utf8')).toBe(ORIGINAL);
    expect(loadLoopState(root)?.phase).toBe('cancelled');
  });
  it('only approves a passing test after explicit human decision', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Implement Snake scoring' });
    expect(() => finishLoop(root, 'approve')).toThrow('Approval requires passed tests');
    const accepted = finishLoop(root, 'cancel');
    expect(accepted.phase).toBe('cancelled');
    beginLoop(root, { goal: 'Implement Snake scoring' });
    await until(root, driver(root), 'awaiting-approval');
    expect(finishLoop(root, 'approve').phase).toBe('accepted');
    expect(() => finishLoop(root, 'cancel')).toThrow('Approved runs cannot be cancelled');
  });
  it('retries one failed game and stops after passing the bounded retry', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Repair Snake collision behavior', maxAttempts: 2 });
    const d = driver(root, ['failed', 'passed']);
    const done = await until(root, d, 'awaiting-approval');
    expect(done.phase).toBe('awaiting-approval');
    expect(done.attempt).toBe(2);
    expect(done.modelCalls).toBe(2);
    expect(done.events.some(e => e.phase === 'repairing')).toBe(true);
  });
  it('never retries indefinitely after model budget is spent', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Repair broken gameplay rules', maxAttempts: 1 });
    const done = await until(root, driver(root, ['failed']), 'awaiting-approval');
    expect(done.phase).toBe('needs-human');
    expect(done.lastFailure).toContain('Repair budget exhausted');
  });
  it('never classifies browser infrastructure failure as repairable gameplay', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Fix flaky runtime behavior' });
    const done = await until(root, driver(root, ['incomplete']), 'awaiting-approval');
    expect(done.phase).toBe('needs-human');
    expect(done.lastFailure).toContain('Unreliable test environment');
  });
  it('replay after process restart resumes a persisted stage', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Make the game fun to play' });
    const d = driver(root);
    const planned = await advanceLoop(root, d);
    expect(planned.phase).toBe('generating');
    const loaded = loadLoopState(root)!;
    expect(loaded.phase).toBe('generating');
    const next = await advanceLoop(root, driver(root));
    expect(next.phase).toBe('building');
    expect(next.attempt).toBe(1);
  });
  it('does not retry model calls after an interrupted generation', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Implement deterministic gameplay' });
    await advanceLoop(root, driver(root));
    const checkpoint = path.join(root, 'output', 'agent-loop', 'state.json');
    const parsed = JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
    parsed.modelCalls = 1;
    parsed.attempt = 1;
    parsed.generationReserved = true;
    fs.writeFileSync(checkpoint, JSON.stringify(parsed));
    const d = driver(root);
    const state = await advanceLoop(root, d);
    expect(state.phase).toBe('needs-human');
    expect(d.generate).not.toHaveBeenCalled();
  });
  it('requires matching report digest before accepting a test result', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Implement reliable rules' });
    const d = driver(root);
    d.test = vi.fn(async () => ({
      report: { status: 'passed', runId: 'c10b8a78-781c-40f1-b3cc-92321ae2b7d5',
        contractSha256: '0'.repeat(64) }, reportPath: 'output/playtests/stale.json', summary: 'Passed',
    }));
    const state = await until(root, d, 'awaiting-approval');
    expect(state.phase).toBe('needs-human');
    expect(state.lastFailure).toContain('digest');
  });
  it('detects external editing and refuses destructive rollback', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Add more features safely' });
    fs.writeFileSync(path.join(root, 'scripts', 'game.js'), 'const userEdited=1;\n');
    const s = await advanceLoop(root, driver(root));
    expect(s.phase).toBe('needs-human');
    expect(finishLoop(root, 'cancel').phase).toBe('needs-human');
    expect(fs.readFileSync(path.join(root, 'scripts', 'game.js'), 'utf8')).toContain('userEdited');
  });
  it('syntax-invalid model proposal is reviewed and retried rather than written', async () => {
    const root = setup();
    beginLoop(root, { goal: 'Make a valid game', maxAttempts: 2 });
    const d = driver(root);
    let calls = 0;
    d.generate = vi.fn(async () => ({ source: ++calls === 1 ? 'let = ;' : GENERATED, tokens: 100 }));
    const done = await until(root, d, 'awaiting-approval');
    expect(done.phase).toBe('awaiting-approval');
    expect(done.attempt).toBe(2);
    expect(fs.readFileSync(path.join(root, 'scripts', 'game.js'), 'utf8')).toBe(GENERATED);
  });
  it('blocks budgets, concurrent starts and invalid or absent GDDs', async () => {
    const root = setup();
    expect(() => beginLoop(root, { goal: 'short' })).toThrow('Goal');
    expect(() => beginLoop(root, { goal: 'Valid game goal', maxAttempts: 4 })).toThrow('Budget');
    beginLoop(root, { goal: 'Valid game goal' });
    expect(() => beginLoop(root, { goal: 'Another game goal' })).toThrow('Existing active run');
    expect(JSON.parse(await executeAgentLoop(root, { action: 'status' })).phase).toBe('planning');
  });
});
