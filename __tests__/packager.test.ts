import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildGame } from '@/lib/build/packager';

describe('build pipeline', () => {
  it('publishes a successful build atomically and keeps script contents safe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-packager-'));
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'scripts', 'utils.js'), 'export const helper = 1;');
    fs.writeFileSync(path.join(root, 'scripts', 'game.js'), 'const text = "</script>";');

    const result = buildGame(root);
    expect(result.success).toBe(true);
    expect(result.buildId).toBeTruthy();
    const html = fs.readFileSync(path.join(root, 'output', 'index.html'), 'utf8');
    expect(html).toContain('<\\/script>');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'output', 'build-manifest.json'), 'utf8')).buildId).toBe(result.buildId);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
