import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { chromium } from 'playwright';

const enabled = process.env.RUN_REAL_PLAYWRIGHT === '1';
const PORT = 49633;
const origin = 'http://127.0.0.1:' + PORT;
let server: ChildProcessWithoutNullStreams | null = null;
let output = '';

async function startServer() {
  if (server && server.exitCode === null) return;
  server = spawn(process.execPath, [path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next'),
    'dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'development' },
  });
  server.stdout.on('data', chunk => { output = (output + String(chunk)).slice(-8000); });
  server.stderr.on('data', chunk => { output = (output + String(chunk)).slice(-8000); });
  const start = Date.now();
  while (Date.now() - start < 65_000) {
    if (server.exitCode !== null) throw new Error('Next.js dev exited: ' + output);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* booting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Next.js dev did not become ready: ' + output);
}
afterAll(() => {
  server?.kill('SIGTERM');
});

describe.skipIf(!enabled)('real visual workspace browser UX', () => {
  it('supports node editing, undo/redo, save/reload and stale-edit conflict', async () => {
    await startServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
      page.setDefaultTimeout(20_000);
      // Do not open first-run API settings when exercising the board.
      await page.addInitScript(() => {
        localStorage.setItem('ai-game-settings', JSON.stringify({
          provider: 'DeepSeek', model: 'deepseek-v4-pro',
          apiKey: '', baseUrl: 'https://api.deepseek.com', githubToken: '',
        }));
      });
      const created = await page.request.post(origin + '/api/session');
      expect(created.status(), output).toBe(200);
      const { sessionId } = await created.json() as { sessionId: string };
      expect(sessionId).toMatch(/^[a-f0-9-]{36}$/);
      await page.goto(origin + '/?session=' + sessionId, { waitUntil: 'domcontentloaded', timeout: 50_000 });
      await page.getByRole('tab', { name: 'Design Canvas' }).click();
      await page.getByRole('region', { name: 'Game design canvas' }).waitFor();
      const nav = page.getByRole('navigation', { name: 'Add board nodes' });
      await nav.getByRole('button', { name: /note/i }).click();
      expect(await page.locator('[data-node-id]').count()).toBe(1);
      await page.getByRole('button', { name: 'Undo' }).click();
      expect(await page.locator('[data-node-id]').count()).toBe(0);
      await page.getByRole('button', { name: 'Redo' }).click();
      expect(await page.locator('[data-node-id]').count()).toBe(1);
      const [saveResponse] = await Promise.all([
        page.waitForResponse(response => response.request().method() === 'PUT' &&
          response.url().includes('/api/design-board/')),
        page.getByRole('button', { name: 'Save board' }).click(),
      ]);
      expect(saveResponse.status(), JSON.stringify({
        body: await saveResponse.text(),
        origin: await saveResponse.request().headerValue('origin'),
        host: await saveResponse.request().headerValue('host'),
      })).toBe(200);
      await page.getByText('Saved to design.board.json').waitFor();
      const stored = await (await page.request.get(origin + '/api/design-board/' + sessionId)).json();
      expect(stored.board.nodes).toHaveLength(1);
      const stableNodeId = stored.board.nodes[0].id;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: 'Design Canvas' }).click();
      await page.locator('[data-node-id="' + stableNodeId + '"]').waitFor();

      // A separate writer wins. UI must not erase it using a stale revision.
      const fresh = await (await page.request.get(origin + '/api/design-board/' + sessionId)).json();
      const changed = { ...fresh.board, title: 'Modified in a second tab' };
      const external = await page.request.put(origin + '/api/design-board/' + sessionId, {
        headers: { Origin: origin },
        data: { board: changed, revision: fresh.revision },
      });
      expect(external.status()).toBe(200);
      await nav.getByRole('button', { name: /scene/i }).click();
      await page.getByRole('button', { name: 'Save board' }).click();
      await page.getByText(/Save conflict: this board changed/).waitFor();
      const verified = await (await page.request.get(origin + '/api/design-board/' + sessionId)).json();
      expect(verified.board.title).toBe('Modified in a second tab');
      expect(verified.board.nodes).toHaveLength(1);
    } finally {
      await browser.close();
    }
  }, 100_000);

  it('uploads a PNG, links it to canvas, and produces a deterministic sprite atlas', async () => {
    await startServer();
    const { encodePng } = await import('@/lib/assets/png');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
      page.setDefaultTimeout(20_000);
      await page.addInitScript(() => localStorage.setItem('ai-game-settings', JSON.stringify({
        provider: 'DeepSeek', apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat',
        githubToken: '',
      })));
      const session = await (await page.request.post(origin + '/api/session')).json() as { sessionId: string };
      await page.goto(origin + '/?session=' + session.sessionId, { waitUntil: 'domcontentloaded', timeout: 50_000 });
      await page.getByRole('tab', { name: 'Design Canvas' }).click();
      await page.getByRole('button', { name: 'Asset Library' }).click();
      await page.getByRole('region', { name: 'Asset library' }).waitFor();
      const fixture = encodePng({ width: 2, height: 2, pixels: Buffer.from([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 0, 255,
      ]) });
      await page.getByLabel('Select asset file').setInputFiles({
        name: 'sprite.png', mimeType: 'image/png', buffer: fixture,
      });
      await page.getByLabel('Asset rights').selectOption('owned');
      await page.getByRole('button', { name: 'Import asset' }).click();
      await page.getByText('Asset imported and verified').waitFor();
      const catalog = await (await page.request.get(origin + '/api/assets/' + session.sessionId)).json();
      expect(catalog.entries).toHaveLength(1);
      const entry = catalog.entries[0];
      expect(entry.path).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
      const preview = await page.request.get(origin + '/api/assets/' + session.sessionId + '/' + entry.id);
      expect(preview.status()).toBe(200);
      expect(Buffer.from(await preview.body()).equals(fixture)).toBe(true);
      await page.getByRole('button', { name: 'Add to canvas' }).click();
      expect(await page.locator('[data-node-id]').count()).toBe(1);
      await page.getByRole('button', { name: 'Save board' }).click();
      await page.getByText('Saved to design.board.json').waitFor();
      const board = await (await page.request.get(origin + '/api/design-board/' + session.sessionId)).json();
      expect(board.board.nodes[0].reference).toBe(entry.path);
      await page.getByRole('button', { name: 'Asset Library' }).click();
      await page.getByLabel('Include in atlas sprite.png').check();
      await page.getByRole('button', { name: /Generate PNG atlas/ }).click();
      await page.getByText('Sprite atlas generated with 1 frames').waitFor();
      const updated = await (await page.request.get(origin + '/api/assets/' + session.sessionId)).json();
      expect(updated.entries).toHaveLength(2);
      const atlas = updated.entries.find((a: { atlasFrames?: unknown }) => a.atlasFrames);
      expect(atlas.atlasFrames[0].id).toBe(entry.id);
      expect(atlas.width).toBe(1024);
    } finally {
      await browser.close();
    }
  }, 100_000);


  it('shows fail-closed Docker configuration error in Studio rather than running host browser', async () => {
    await startServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1320, height: 900 } });
      page.setDefaultTimeout(20_000);
      await page.addInitScript(() => localStorage.setItem('ai-game-settings', JSON.stringify({
        provider: 'DeepSeek', apiKey: '', baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat', githubToken: '',
      })));
      const created = await page.request.post(origin + '/api/session');
      const { sessionId } = await created.json() as { sessionId: string };
      await page.goto(origin + '/?session=' + sessionId,
        { waitUntil: 'domcontentloaded', timeout: 50_000 });
      await page.getByRole('tab', { name: 'Design Canvas' }).click();
      await page.getByRole('button', { name: 'Isolated Tests' }).click();
      await page.getByRole('region', { name: 'Isolated test console' }).waitFor();
      await page.getByRole('button', { name: 'Run isolated test' }).click();
      await page.getByText(/requires a locally cached immutable image SHA-256/).waitFor();
      expect(await page.getByText('No isolated test started in this Studio view.').isVisible()).toBe(true);
    } finally { await browser.close(); }
  }, 100_000);

});
