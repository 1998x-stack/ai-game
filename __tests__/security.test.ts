import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isSensitiveWorkspacePath, redactSecrets, validateBaseUrl, validateRepoName, validateWorkspacePath } from '@/lib/security/validation';

describe('security validation', () => {
  it('rejects shell-sensitive repository names', () => {
    expect(() => validateRepoName('game;touch-pwned')).toThrow();
    expect(validateRepoName('my-game_01')).toBe('my-game_01');
  });

  it('allows only configured HTTPS provider hosts', () => {
    expect(validateBaseUrl('https://api.deepseek.com/', ['api.deepseek.com'])).toBe('https://api.deepseek.com');
    expect(() => validateBaseUrl('http://api.deepseek.com', ['api.deepseek.com'])).toThrow();
    expect(() => validateBaseUrl('https://127.0.0.1', ['api.deepseek.com'])).toThrow();
  });

  it('redacts all occurrences of secrets', () => {
    expect(redactSecrets('key=secret secret', ['secret'])).toBe('key=[REDACTED] [REDACTED]');
  });

  it('rejects sensitive paths and symlinked write targets', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-security-'));
    fs.mkdirSync(path.join(root, 'scripts'));
    expect(isSensitiveWorkspacePath('.git/config')).toBe(true);
    expect(() => validateWorkspacePath('.git/config', root)).toThrow();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-outside-'));
    fs.symlinkSync(outside, path.join(root, 'linked'));
    expect(() => validateWorkspacePath('linked/new.txt', root, true)).toThrow();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  it('supports deeply nested new files but rejects symlinked ancestors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-deep-path-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-deep-outside-'));
    try {
      expect(validateWorkspacePath('levels/first/scene.js', root, true))
        .toBe(path.join(root, 'levels', 'first', 'scene.js'));
      fs.symlinkSync(outside, path.join(root, 'linked'));
      expect(() => validateWorkspacePath('linked/first/scene.js', root)).toThrow();
      expect(() => validateWorkspacePath('linked/first/scene.js', root, true)).toThrow();
      expect(() => validateWorkspacePath('../escaped.js', root, true)).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
