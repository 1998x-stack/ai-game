import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getBrowserPool, resetBrowserPool } from '@/lib/runtime/browser-pool';
import { parseGameTestContract } from '@/lib/runtime/game-contract';
import { runGameQuality } from '@/lib/runtime/quality-runner';

const enabled = process.env.RUN_REAL_PLAYWRIGHT === '1';
const dirs: string[] = [];
afterAll(async () => {
  await getBrowserPool().shutdown();
  resetBrowserPool();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!enabled)('real Chromium game contract smoke', () => {
  it('plays a small HTML Canvas game twice with a reproducible trace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-quality-smoke-'));
    dirs.push(root);
    const contract = parseGameTestContract({
      schemaVersion: 1, name: 'Keyboard score', seed: 1024,
      viewport: { width: 800, height: 600 },
      scenarios: [{
        id: 'score', name: 'Keyboard input updates state',
        actions: [{ type: 'key', key: 'ArrowRight' }, { type: 'wait', ms: 100 }],
        assertions: [
          { type: 'canvas-size', minWidth: 640, minHeight: 480 },
          { type: 'state-changed', key: 'score' },
          { type: 'state-equals', key: 'score', value: 1 },
          { type: 'game-over', expected: false },
          { type: 'no-errors' },
        ],
      }],
    });
    const html = '<!doctype html><html><head></head><body>' +
      '<canvas id="gameCanvas" width="640" height="480"></canvas>' +
      '<script>let score=0;window.__GAME_TEST__={getState:()=>({score,gameOver:false})};' +
      'document.addEventListener("keydown",event=>{' +
      'if(event.key==="ArrowRight")score++;' +
      '});document.getElementById("gameCanvas").getContext("2d").fillRect(1,1,20,20);' +
      '</script></body></html>';
    const a = await runGameQuality({ workspaceRoot: root, html, contract });
    const b = await runGameQuality({ workspaceRoot: root, html, contract });
    expect(a.report.status).toBe('passed');
    expect(b.report.status).toBe('passed');
    expect(a.report.scenarios[0].trace).toEqual(b.report.scenarios[0].trace);
    expect(a.report.gameSha256).toBe(b.report.gameSha256);
    expect(fs.existsSync(path.join(root, a.reportPath))).toBe(true);
    expect(fs.existsSync(path.join(root, b.reportPath))).toBe(true);
  });
  it('builds registered Snake template and verifies compiled GDD acceptance in Chromium', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gdd-snake-smoke-'));
    dirs.push(root);
    const { parseGameDesignDocument } = await import('@/lib/game-design/gdd');
    const { compileGameDesign } = await import('@/lib/game-design/compiler');
    const { buildGame } = await import('@/lib/build/packager');
    const scaffold = path.join(process.cwd(), 'workspace');
    for (const dir of ['scripts', 'assets', 'output']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.copyFileSync(path.join(scaffold, 'lib', 'utils.js'),
      path.join(root, 'scripts', 'utils.js'));
    fs.copyFileSync(path.join(scaffold, 'templates', 'snake', 'game.js'),
      path.join(root, 'scripts', 'game.js'));
    const gdd = parseGameDesignDocument(JSON.parse(fs.readFileSync(
      path.join(scaffold, 'templates', 'snake', 'design.json'), 'utf8')));
    const contract = compileGameDesign(gdd).contract;
    expect(contract).not.toBeNull();
    const built = buildGame(root);
    expect(built.success).toBe(true);
    const result = await runGameQuality({ workspaceRoot: root, html: built.html, contract: contract! });
    expect(result.report.scenarios).toHaveLength(2);
    expect(result.report.status, JSON.stringify(result.report.scenarios, null, 2)).toBe('passed');
    expect(result.report.scenarios.map(s => s.id)).toEqual(['boot', 'begin']);
  });

  it('completes the real Stage 2.3 workflow with a stub developer and Chromium quality gate', async () => {
    const { beginLoop, advanceLoop, finishLoop } = await import('@/lib/agent-loop/engine');
    const { loadLoopState } = await import('@/lib/agent-loop/state');
    const { buildGame } = await import('@/lib/build/packager');
    const { parseGameDesignDocument } = await import('@/lib/game-design/gdd');
    const { compileGameDesign } = await import('@/lib/game-design/compiler');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-loop-browser-'));
    dirs.push(root);
    const scaffold = path.join(process.cwd(), 'workspace');
    for (const dir of ['scripts', 'assets', 'output']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.copyFileSync(path.join(scaffold, 'lib', 'utils.js'),
      path.join(root, 'scripts', 'utils.js'));
    fs.copyFileSync(path.join(scaffold, 'templates', 'snake', 'design.json'),
      path.join(root, 'game.design.json'));
    const source = fs.readFileSync(path.join(scaffold, 'templates', 'snake', 'game.js'), 'utf8');
    fs.writeFileSync(path.join(root, 'scripts', 'game.js'), 'const unfinishedGame = true;\n');
    const doc = parseGameDesignDocument(JSON.parse(fs.readFileSync(
      path.join(root, 'game.design.json'), 'utf8')));
    const contract = compileGameDesign(doc).contract!;
    let modelCalls = 0;
    const driver = {
      async generate() {
        modelCalls++;
        return { source, tokens: 1200 };
      },
      async build() {
        const result = buildGame(root);
        return { success: result.success === true, html: result.html, errors: result.errors };
      },
      async test(html: string) {
        const result = await runGameQuality({ workspaceRoot: root, html, contract });
        return { report: result.report, reportPath: result.reportPath, summary: result.text };
      },
    };
    beginLoop(root, { goal: 'Implement a valid playable Snake game', maxAttempts: 2 });
    for (let step = 0; step < 9; step++) {
      const state = loadLoopState(root)!;
      if (state.phase === 'awaiting-approval' || state.phase === 'needs-human') break;
      await advanceLoop(root, driver);
    }
    const state = loadLoopState(root)!;
    expect(state.phase, JSON.stringify(state.events, null, 2)).toBe('awaiting-approval');
    expect(modelCalls).toBe(1);
    expect(state.reportPath).toMatch(/output\/playtests\/.*\.json/);
    expect(fs.existsSync(path.join(root, state.reportPath!))).toBe(true);
    expect(finishLoop(root, 'approve').phase).toBe('accepted');
  });

});
