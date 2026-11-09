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
  it('never reads linked game scripts or packages their outside contents', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-linked-script-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-external-script-'));
    const secret = 'PRIVATE_SERVER_KEY_MUST_NOT_APPEAR';
    try {
      fs.mkdirSync(path.join(root, 'scripts'));
      fs.mkdirSync(path.join(root, 'assets'));
      const target = path.join(outside, 'game.js');
      fs.writeFileSync(target, `const key = "${secret}";`);
      fs.symlinkSync(target, path.join(root, 'scripts', 'game.js'));
      const result = buildGame(root);
      expect(result.success).toBe(false);
      expect(result.html).not.toContain(secret);
      expect(result.errors.join(' ')).toMatch(/regular file|symlink/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked asset rather than embedding its target data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-linked-asset-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-external-asset-'));
    const marker = 'LEAKED_ASSET_PRIVATE_DATA';
    try {
      fs.mkdirSync(path.join(root, 'scripts'));
      fs.mkdirSync(path.join(root, 'assets'));
      fs.writeFileSync(path.join(root, 'scripts', 'game.js'), 'const game = true;');
      const secretPath = path.join(outside, 'private.svg');
      fs.writeFileSync(secretPath, marker);
      fs.symlinkSync(secretPath, path.join(root, 'assets', 'private.svg'));
      const result = buildGame(root);
      expect(result.success).toBe(false);
      expect(result.html).not.toContain(Buffer.from(marker).toString('base64'));
      expect(result.errors.join(' ')).toMatch(/symbolic link/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects symlinked scripts and assets directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-linked-dir-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-external-dir-'));
    try {
      fs.writeFileSync(path.join(outside, 'game.js'), 'const secret = "PRIVATE";');
      fs.symlinkSync(outside, path.join(root, 'scripts'));
      let result = buildGame(root);
      expect(result.success).toBe(false);
      expect(result.html).not.toContain('PRIVATE');
      fs.unlinkSync(path.join(root, 'scripts'));
      fs.mkdirSync(path.join(root, 'scripts'));
      fs.writeFileSync(path.join(root, 'scripts', 'game.js'), 'const start = 1;');
      fs.symlinkSync(outside, path.join(root, 'assets'));
      result = buildGame(root);
      expect(result.success).toBe(false);
      expect(result.errors.join(' ')).toMatch(/assets.*symbolic link/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
