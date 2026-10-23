import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const acquire = vi.hoisted(() => vi.fn());
const release = vi.hoisted(() => vi.fn());
vi.mock('@/lib/runtime/browser-pool', () => ({
  getBrowserPool: () => ({ acquire, release }),
}));

import { parseGameTestContract } from '@/lib/runtime/game-contract';
import { runGameQuality } from '@/lib/runtime/quality-runner';

const dirs: string[] = [];
afterEach(() => {
  for (const root of dirs.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  acquire.mockReset();
  release.mockReset();
});

function contract() {
  return parseGameTestContract({
    schemaVersion: 1, name: 'Score increase', seed: 2026,
    viewport: { width: 800, height: 600 },
    scenarios: [{
      id: 'move', name: 'Movement and score',
      actions: [{ type: 'key', key: 'ArrowUp' }],
      assertions: [
        { type: 'canvas-size', minWidth: 640, minHeight: 480 },
        { type: 'state-changed', key: 'score' },
        { type: 'state-equals', key: 'score', value: 1 },
        { type: 'no-errors' },
      ],
    }],
  });
}

function mockPage(states: Record<string, unknown>[]) {
  const callbacks: Record<string, (...args: any[]) => void> = {};
  const page = {
    setDefaultTimeout: vi.fn(),
    on: vi.fn((event: string, callback: (...args: any[]) => void) => { callbacks[event] = callback; }),
    route: vi.fn(async () => undefined),
    setViewportSize: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    keyboard: { press: vi.fn(async () => undefined) },
    mouse: { click: vi.fn(async () => undefined) },
    evaluate: vi.fn(async () => states.shift()),
    screenshot: vi.fn(async () => Buffer.from('jpg')),
  };
  return { page, callbacks };
}

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-quality-'));
  dirs.push(root);
  return root;
}

describe('contract-driven browser playtests', () => {
  it('writes inspectable JSON evidence for a passing scenario', async () => {
    const root = makeRoot();
    const { page } = mockPage([
      { score: 0, _canvas: { width: 800, height: 600, visible: true } },
      { score: 1, _canvas: { width: 800, height: 600, visible: true } },
    ]);
    acquire.mockResolvedValue({ page, id: 'lease-1' });
    const result = await runGameQuality({
      workspaceRoot: root,
      html: '<html><head></head><body><canvas id="gameCanvas"></canvas></body></html>',
      contract: contract(),
    });
    expect(result.report.status).toBe('passed');
    expect(result.report.scenarios[0].trace).toHaveLength(1);
    expect(result.report.gameSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.text).toContain('GAME QUALITY REPORT');
    expect(JSON.parse(fs.readFileSync(path.join(root, result.reportPath), 'utf8')).seed).toBe(2026);
    expect(page.keyboard.press).toHaveBeenCalledWith('ArrowUp');
    expect(release).toHaveBeenCalledWith('lease-1');
  });
  it('records failed assertions without claiming a pass', async () => {
    const root = makeRoot();
    const { page } = mockPage([
      { score: 0, _canvas: { width: 800, height: 600, visible: true } },
      { score: 0, _canvas: { width: 800, height: 600, visible: true } },
    ]);
    acquire.mockResolvedValue({ page, id: 'lease-2' });
    const result = await runGameQuality({ workspaceRoot: root, html: '<html></html>', contract: contract() });
    expect(result.report.status).toBe('failed');
    expect(result.report.scenarios[0].checks.some((check) => !check.passed)).toBe(true);
    expect(release).toHaveBeenCalledWith('lease-2');
  });
  it('marks infrastructure failure incomplete and still persists evidence', async () => {
    const root = makeRoot();
    acquire.mockRejectedValue(new Error('Browser executable missing'));
    const result = await runGameQuality({ workspaceRoot: root, html: '<html></html>', contract: contract() });
    expect(result.report.status).toBe('incomplete');
    expect(result.text).toContain('Browser executable missing');
    expect(fs.existsSync(path.join(root, result.reportPath))).toBe(true);
  });
});
