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
});
