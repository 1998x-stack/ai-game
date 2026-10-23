'use strict';
// Runs only inside isolated container. Input: /input/job.json (readonly).
// Output: a single bounded JSON object on stdout. No source/workspace mounts.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function seedHtml(html, seed) {
  const script = '<script data-game-test-seed>(function(){var seed=' + (seed >>> 0) +
    ';Math.random=function(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};})();</script>';
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(?:\s[^>]*)?>/i, tag => tag + script)
    : '<head>' + script + '</head>' + html;
}
function state(page) {
  return page.evaluate(() => {
    const el = document.getElementById('gameCanvas');
    const r = el && el.getBoundingClientRect();
    const css = el && getComputedStyle(el);
    const answer = {
      _canvas: el ? { width: el.width, height: el.height,
        visible: !!(r && r.width > 0 && r.height > 0 &&
          css && css.display !== 'none' && css.visibility !== 'hidden') }
        : { width: 0, height: 0, visible: false },
    };
    let values;
    try { values = window.__GAME_TEST__?.getState?.(); } catch { /* uninstrumented */ }
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      values = { score: window.score, gameOver: window.gameOver,
        gameover: window.gameover, isGameOver: window.isGameOver };
    }
    for (const [key, value] of Object.entries(values).slice(0, 40)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || key === '_canvas') continue;
      if (typeof value === 'string') answer[key] = value.slice(0, 200);
      else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) answer[key] = value;
    }
    return answer;
  });
}
async function action(page, value) {
  if (value.type === 'key') {
    if (value.holdMs === undefined) await page.keyboard.press(value.key);
    else {
      await page.keyboard.down(value.key);
      try { await page.waitForTimeout(value.holdMs); }
      finally { await page.keyboard.up(value.key); }
    }
  } else if (value.type === 'click') await page.mouse.click(value.x, value.y);
  else if (value.type === 'wait') await page.waitForTimeout(value.ms);
  else throw Error('Unknown action');
}
function check(assertion, before, after, errors) {
  let passed = false, detail = '';
  const b = Object.prototype.hasOwnProperty.call(before, assertion.key) ? before[assertion.key] : undefined;
  const a = Object.prototype.hasOwnProperty.call(after, assertion.key) ? after[assertion.key] : undefined;
  switch (assertion.type) {
    case 'canvas-size': {
      const canvas = after._canvas;
      passed = !!(canvas && canvas.visible && canvas.width >= assertion.minWidth && canvas.height >= assertion.minHeight);
      detail = 'visible canvas expected at least ' + assertion.minWidth + 'x' + assertion.minHeight +
        ', observed ' + (canvas ? canvas.width + 'x' + canvas.height + ' visible=' + canvas.visible : 'missing');
      break;
    }
    case 'state-equals':
      passed = a !== undefined && a === assertion.value;
      detail = assertion.key + ' expected ' + JSON.stringify(assertion.value) +
        ', observed ' + JSON.stringify(a === undefined ? null : a);
      break;
    case 'state-changed':
      passed = b !== undefined && a !== undefined && JSON.stringify(b) !== JSON.stringify(a);
      detail = assertion.key + ' must change, before=' + JSON.stringify(b ?? null) +
        ' after=' + JSON.stringify(a ?? null); break;
    case 'game-over': {
      const value = after.gameOver ?? after.gameover ?? after.isGameOver;
      passed = typeof value === 'boolean' && value === assertion.expected;
      detail = 'game-over expected ' + assertion.expected + ', observed ' + JSON.stringify(value ?? null); break;
    }
    case 'no-errors':
      passed = errors.length === 0; detail = 'page errors: ' + errors.length; break;
    default: throw Error('Invalid assertion');
  }
  return { assertion, passed, detail };
}
function aggregate(scenarios) {
  return scenarios.some(s => s.status === 'failed') ? 'failed'
    : scenarios.length === 0 || scenarios.some(s => s.status === 'incomplete') ? 'incomplete' : 'passed';
}
function validateContract(c) {
  if (!c || c.schemaVersion !== 1 || !Array.isArray(c.scenarios) || c.scenarios.length < 1 ||
    c.scenarios.length > 8 || !Number.isSafeInteger(c.seed) ||
    !c.viewport || !Number.isInteger(c.viewport.width) || !Number.isInteger(c.viewport.height) ||
    c.viewport.width < 320 || c.viewport.width > 1920 ||
    c.viewport.height < 240 || c.viewport.height > 1080) throw Error('Invalid contract');
  const names = new Set(), validKeys = /^(Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|[a-zA-Z0-9])$/;
  let total = 0;
  for (const s of c.scenarios) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s.id) || names.has(s.id) ||
      !Array.isArray(s.actions) || s.actions.length < 1 || s.actions.length > 40 ||
      !Array.isArray(s.assertions) || s.assertions.length < 1 || s.assertions.length > 16) throw Error('Invalid scenario');
    names.add(s.id); total += s.actions.length;
    for (const a of s.actions) {
      if (a.type === 'key' && validKeys.test(a.key) && (a.holdMs === undefined ||
          (Number.isInteger(a.holdMs) && a.holdMs >= 1 && a.holdMs <= 3000))) continue;
      if (a.type === 'wait' && Number.isInteger(a.ms) && a.ms >= 0 && a.ms <= 3000) continue;
      if (a.type === 'click' && Number.isInteger(a.x) && Number.isInteger(a.y) &&
          a.x >= 0 && a.y >= 0 && a.x <= 4096 && a.y <= 4096) continue;
      throw Error('Invalid action');
    }
    for (const a of s.assertions) {
      if (!['canvas-size','state-equals','state-changed','game-over','no-errors'].includes(a.type)) {
        throw Error('Invalid assertion');
      }
    }
  }
  if (total > 100) throw Error('Too many actions');
}
async function main() {
  const raw = fs.readFileSync('/input/job.json');
  if (raw.length > 1_150_000) throw Error('Input exceeds 1.15 MB');
  const job = JSON.parse(raw.toString('utf8'));
  if (job.schemaVersion !== 1 || typeof job.html !== 'string' ||
      Buffer.byteLength(job.html) > 1_000_000) throw Error('Invalid game input');
  const contract = job.contract;
  validateContract(contract);
  const startedAt = new Date().toISOString(), start = Date.now();
  const deadline = start + 25_000;
  const browser = await chromium.launch({ headless: true, timeout: 8_000 });
  const scenarios = [];
  try {
    for (const s of contract.scenarios) {
      const result = { id: s.id, status: 'incomplete', checks: [], trace: [], pageErrors: [] };
      let page;
      try {
        if (Date.now() > deadline) throw Error('Isolated run deadline exceeded');
        page = await browser.newPage({ viewport: contract.viewport });
        page.setDefaultTimeout(3_000);
        page.on('pageerror', error => {
          if (result.pageErrors.length < 20) result.pageErrors.push(String(error.message).slice(0, 400));
        });
        page.on('console', message => {
          if (message.type() === 'error' && result.pageErrors.length < 20) {
            result.pageErrors.push(message.text().slice(0, 400));
          }
        });
        const entry = 'http://ai-game.localhost/';
        let delivered = false;
        await page.route('**/*', route => {
          if (!delivered && route.request().url() === entry && route.request().isNavigationRequest() &&
              route.request().resourceType() === 'document') {
            delivered = true;
            return route.fulfill({ status: 200, contentType: 'text/html',
              body: seedHtml(job.html, contract.seed) });
          }
          return route.abort('blockedbyclient');
        });
        await page.goto(entry, { waitUntil: 'load', timeout: 6_000 });
        await page.waitForTimeout(100);
        const before = await state(page);
        for (const [index, item] of s.actions.entries()) {
          if (Date.now() > deadline) throw Error('Isolated run deadline exceeded');
          await action(page, item);
          const current = await state(page);
          result.trace.push({ index, action: item, state: current });
        }
        const after = result.trace[result.trace.length - 1]?.state ?? await state(page);
        result.checks = s.assertions.map(a => check(a, before, after, result.pageErrors));
        result.status = result.checks.some(c => !c.passed) || result.pageErrors.length ? 'failed' : 'passed';
      } catch (error) {
        result.failure = String(error.message || error).slice(0, 400);
        result.status = 'incomplete';
      } finally {
        await page?.close().catch(() => {});
      }
      scenarios.push(result);
    }
  } finally { await browser.close().catch(() => {}); }
  const report = {
    schemaVersion: 1, runId: job.runId, contractName: contract.name,
    contractSha256: sha(JSON.stringify(contract)), gameSha256: sha(job.html),
    seed: contract.seed, startedAt, durationMs: Date.now() - start,
    status: aggregate(scenarios), scenarios,
  };
  process.stdout.write(JSON.stringify({ protocol: 1, report }) + '\n');
}
main().catch(err => {
  process.stderr.write(String(err.stack || err).slice(0, 1000) + '\n');
  process.exitCode = 2;
});
