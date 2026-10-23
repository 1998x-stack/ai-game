import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Page } from 'playwright';
import { getBrowserPool } from './browser-pool';
import type { GameTestContract, GameAction } from './game-contract';
import { evaluateGameAssertions, aggregateQualityStatus, formatQualityReport,
  type GameState, type ActionTrace, type QualityReport, type ScenarioResult } from './quality-evaluator';
import { validateWorkspacePath } from '@/lib/security/validation';

function sha(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Browser pages created from about:blank + setContent do not necessarily
 * execute addInitScript. Inject a seeded RNG before the first game script.
 * This covers Math.random; it does not fake time or networking.
 */
export function injectSeed(html: string, seed: number): string {
  const script = '<script data-game-test-seed>' +
    '(function(){var seed=' + (seed >>> 0) + ';Math.random=function(){' +
    'seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};})();' +
    '</script>';
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (tag) => tag + script);
  }
  return '<head>' + script + '</head>' + html;
}

async function readGameState(page: Page): Promise<GameState> {
  return page.evaluate(() => {
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
    const rect = canvas?.getBoundingClientRect();
    const style = canvas ? window.getComputedStyle(canvas) : null;
    const state: Record<string, unknown> = {
      _canvas: canvas
        ? { width: canvas.width, height: canvas.height,
            visible: Boolean(rect && rect.width > 0 && rect.height > 0 &&
              style && style.display !== 'none' && style.visibility !== 'hidden') }
        : { width: 0, height: 0, visible: false },
    };
    type GameTestGlobal = Window & {
      __GAME_TEST__?: { getState?: () => unknown };
      score?: unknown;
      gameOver?: unknown;
      gameover?: unknown;
      isGameOver?: unknown;
    };
    const w = window as GameTestGlobal;
    let provided: unknown;
    try { provided = w.__GAME_TEST__?.getState?.(); } catch { /* uninstrumented game */ }
    const source = (provided && typeof provided === 'object' && !Array.isArray(provided))
      ? provided as Record<string, unknown>
      : { score: w.score, gameOver: w.gameOver, gameover: w.gameover,
          isGameOver: w.isGameOver };
    for (const [key, value] of Object.entries(source).slice(0, 40)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || key === '_canvas') continue;
      if (typeof value === 'string') state[key] = value.slice(0, 200);
      if (typeof value === 'boolean') state[key] = value;
      if (typeof value === 'number' && Number.isFinite(value)) state[key] = value;
    }
    return state;
  });
}

async function applyAction(page: Page, action: GameAction): Promise<void> {
  switch (action.type) {
    case 'key':
      if (action.holdMs === undefined) {
        await page.keyboard.press(action.key);
      } else {
        await page.keyboard.down(action.key);
        try {
          await page.waitForTimeout(action.holdMs);
        } finally {
          await page.keyboard.up(action.key);
        }
      }
      break;
    case 'click':
      await page.mouse.click(action.x, action.y);
      break;
    case 'wait':
      await page.waitForTimeout(action.ms);
      break;
  }
}

function saveJson(root: string, report: QualityReport): string {
  const relative = 'output/playtests/' + report.runId + '.json';
  const filename = validateWorkspacePath(relative, root, true);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = filename + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, filename);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
  return relative;
}

export interface RunGameQualityInput {
  workspaceRoot: string;
  html: string;
  contract: GameTestContract;
}

export async function runGameQuality(input: RunGameQualityInput): Promise<{
  report: QualityReport;
  reportPath: string;
  text: string;
}> {
  const { workspaceRoot, contract, html } = input;
  const runId = crypto.randomUUID();
  const start = Date.now();
  const startedAt = new Date(start).toISOString();
  const scenarios: ScenarioResult[] = [];
  const deadline = start + 120_000;
  const pool = getBrowserPool();

  // Independent pages and fresh seeded scripts prevent state bleeding
  // between scenarios. Only deterministic JSON action plans are accepted.
  for (const scenario of contract.scenarios) {
    const trace: ActionTrace[] = [];
    const errors: string[] = [];
    const result: ScenarioResult = {
      id: scenario.id, status: 'incomplete', checks: [], trace, pageErrors: errors,
    };
    let leaseId: string | null = null;
    try {
      if (Date.now() > deadline) throw new Error('Playtest deadline exceeded');
      const lease = await pool.acquire();
      leaseId = lease.id;
      const page = lease.page;
      page.setDefaultTimeout(5_000);
      page.on('pageerror', (error) => {
        if (errors.length < 20) errors.push(String(error.message).slice(0, 400));
      });
      page.on('console', (message) => {
        if (message.type() === 'error' && errors.length < 20) {
          errors.push(message.text().slice(0, 400));
        }
      });
      // A plain about:blank setContent page has an opaque origin and cannot
      // use localStorage. Serve only the in-memory entry document through a
      // route on a fixed .localhost URL; all other network requests are denied.
      const entryUrl = 'http://ai-game.localhost/';
      let entryServed = false;
      await page.route('**/*', (route) => {
        const request = route.request();
        if (!entryServed && request.url() === entryUrl &&
            request.isNavigationRequest() && request.resourceType() === 'document') {
          entryServed = true;
          return route.fulfill({
            status: 200, contentType: 'text/html; charset=utf-8',
            body: injectSeed(html, contract.seed),
          });
        }
        return route.abort('blockedbyclient');
      });
      await page.setViewportSize(contract.viewport);
      await page.goto(entryUrl, { waitUntil: 'load', timeout: 8_000 });
      await page.waitForTimeout(100);
      const before = await readGameState(page);
      for (const [index, action] of scenario.actions.entries()) {
        if (Date.now() > deadline) throw new Error('Playtest deadline exceeded');
        await applyAction(page, action);
        const state = await readGameState(page);
        trace.push({ index, action, state });
      }
      const after = trace[trace.length - 1]?.state ?? await readGameState(page);
      result.checks = evaluateGameAssertions(scenario.assertions, before, after, errors);
      result.status = result.checks.some((check) => !check.passed) || errors.length > 0
        ? 'failed' : 'passed';

      if (contract.captureScreenshots && result.status !== 'passed') {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });
        // Restrict evidence size. Do not store unlimited screenshots.
        if (screenshot.length <= 512_000) {
          const relative = 'output/playtests/' + runId + '-' + scenario.id + '.jpg';
          const location = validateWorkspacePath(relative, workspaceRoot, true);
          fs.mkdirSync(path.dirname(location), { recursive: true });
          fs.writeFileSync(location, screenshot, { flag: 'wx' });
          result.screenshot = relative;
        }
      }
    } catch (error) {
      result.failure = (error instanceof Error ? error.message : String(error)).slice(0, 400);
      result.status = 'incomplete';
    } finally {
      if (leaseId) pool.release(leaseId);
    }
    scenarios.push(result);
  }

  const report: QualityReport = {
    schemaVersion: 1, runId, contractName: contract.name,
    contractSha256: sha(JSON.stringify(contract)), gameSha256: sha(html),
    seed: contract.seed, startedAt,
    durationMs: Date.now() - start,
    status: aggregateQualityStatus(scenarios),
    scenarios,
  };
  const reportPath = saveJson(workspaceRoot, report);
  return { report, reportPath, text: formatQualityReport(report, reportPath) };
}
