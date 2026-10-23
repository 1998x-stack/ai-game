import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runIsolatedQuality } from '@/lib/sandbox/runner';
import { parseGameTestContract } from '@/lib/runtime/game-contract';

describe.skipIf(process.env.RUN_REAL_DOCKER !== '1')('actual Docker isolated Chromium', () => {
  it('executes test contract inside network-disabled resource-constrained container', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage4-docker-'));
    try {
      const html = '<!doctype html><html><head></head><body><canvas id="gameCanvas" width="640" height="480"></canvas>' +
        '<script>let score=0;window.__GAME_TEST__={getState:()=>({score,gameOver:false})};' +
        'document.addEventListener("keydown",e=>{if(e.key==="ArrowRight")score++;});</script></body></html>';
      const contract = parseGameTestContract({ schemaVersion: 1, name: 'Docker check', seed: 27,
        viewport: { width: 800, height: 600 },
        scenarios: [{ id: 'score', name: 'Keyboard score',
          actions: [{ type: 'key', key: 'ArrowRight' }, { type: 'wait', ms: 30 }],
          assertions: [{ type: 'canvas-size', minWidth: 640, minHeight: 480 },
            { type: 'state-equals', key: 'score', value: 1 }, { type: 'no-errors' }],
        }] });
      const result = await runIsolatedQuality({ workspaceRoot: root, html, contract, forceIsolation: true });
      expect(result.isolated).toBe(true);
      expect(result.report.status, JSON.stringify(result.report.scenarios)).toBe('passed');
      expect(fs.existsSync(path.join(root, result.reportPath))).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});
