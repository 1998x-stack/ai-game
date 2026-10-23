import { describe, expect, it, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { executeGameDesignCommand } from '@/lib/game-design/commands';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function setup(genre: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-design-stage-'));
  roots.push(root);
  fs.copyFileSync(
    path.join(process.cwd(), 'workspace', 'templates', genre, 'design.json'),
    path.join(root, 'game.design.json'),
  );
  return root;
}

describe('Agent-facing game_design command', () => {
  it('lists stable registry entries without scanning arbitrary input paths', () => {
    const data = JSON.parse(executeGameDesignCommand(process.cwd(), { action: 'templates' }));
    expect(data.templates.map((t: { genre: string }) => t.genre)).toEqual(['snake','tetris','breakout','2048']);
  });
  it('inspects design, compiles only executable requirements and refuses overwrite', () => {
    const root = setup('snake');
    const inspection = JSON.parse(executeGameDesignCommand(root, { action: 'inspect' }));
    expect(inspection.coverage.automated).toBe(2);
    expect(inspection.coverage.manual).toBe(2);
    const result = JSON.parse(executeGameDesignCommand(root, { action: 'compile' }));
    expect(result.status).toBe('compiled');
    const file = path.join(root, 'game.test.json');
    const original = fs.readFileSync(file, 'utf8');
    expect(JSON.parse(original).scenarios).toHaveLength(2);
    expect(() => executeGameDesignCommand(root, { action: 'compile' })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
  });
  it('does not write an empty test contract for manual-only GDDs', () => {
    const root = setup('2048');
    const gdd = JSON.parse(fs.readFileSync(path.join(root, 'game.design.json'), 'utf8'));
    gdd.acceptance = gdd.acceptance.filter((item: { mode: string }) => item.mode === 'manual');
    fs.writeFileSync(path.join(root, 'game.design.json'), JSON.stringify(gdd));
    const result = JSON.parse(executeGameDesignCommand(root, { action: 'compile' }));
    expect(result.status).toBe('not-compiled');
    expect(fs.existsSync(path.join(root, 'game.test.json'))).toBe(false);
  });
  it('diagnoses a UUID-named report without allowing arbitrary path input', () => {
    const root = setup('snake');
    const id = 'f04f12ac-c727-4b83-8266-d17b7a2abedb';
    const dir = path.join(root, 'output', 'playtests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({
      schemaVersion: 1, runId: id, contractName: 'Snake Classic',
      status: 'failed', scenarios: [{
        id: 'boot', status: 'failed', pageErrors: [], trace: [],
        checks: [{ assertion: { type: 'no-errors' }, passed: false, detail: 'page errors: 1' }],
      }],
    }));
    const result = JSON.parse(executeGameDesignCommand(root, { action: 'diagnose', reportId: id }));
    expect(result.status).toBe('failed');
    expect(result.diagnostics[0].requirementId).toBe('boot');
    expect(() => executeGameDesignCommand(root, { action: 'diagnose',
      reportId: '../../package.json' })).toThrow('Invalid report ID');
  });
});
