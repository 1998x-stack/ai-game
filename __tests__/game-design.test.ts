import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseGameDesignDocument, inspectGameStateMachine } from '@/lib/game-design/gdd';
import { compileGameDesign } from '@/lib/game-design/compiler';
import { listGameTemplates, loadGameTemplate } from '@/lib/game-design/registry';
import { diagnoseGameQuality } from '@/lib/game-design/diagnostics';
import type { QualityReport } from '@/lib/runtime/quality-evaluator';

const source = path.join(process.cwd(), 'workspace');

function fixture(genre: string) {
  return JSON.parse(fs.readFileSync(path.join(source, 'templates', genre, 'design.json'), 'utf8'));
}

describe('game design document and versioned registry', () => {
  it('registers four pinned templates with game sources and skills', () => {
    expect(listGameTemplates().map(entry => entry.genre)).toEqual(['snake','tetris','breakout','2048']);
    for (const entry of listGameTemplates()) {
      const loaded = loadGameTemplate(source, entry.genre);
      expect(loaded.descriptor.version).toBe('1.0.0');
      expect(loaded.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(loaded.design.genre).toBe(entry.genre);
      expect(inspectGameStateMachine(loaded.design)).toEqual([]);
    }
  });

  it('compiles explicit Snake requirements and reports manual coverage', () => {
    const design = parseGameDesignDocument(fixture('snake'));
    const { contract, coverage } = compileGameDesign(design);
    expect(contract?.scenarios.map(s => s.id)).toEqual(['boot', 'begin']);
    expect(contract?.seed).toBe(20261023);
    expect(coverage.total).toBe(4);
    expect(coverage.automated).toBe(2);
    expect(coverage.manual).toBe(2);
    expect(coverage.links.find(e => e.requirementId === 'scoringReview')?.scenarioId).toBeNull();
    expect(coverage.uncoveredMechanics).toEqual([]);
  });

  it('fails closed for malformed mechanics, state transition and scenario input', () => {
    const noMechanic = fixture('snake');
    noMechanic.acceptance[0].mechanic = 'does-not-exist';
    expect(() => parseGameDesignDocument(noMechanic)).toThrow('unknown mechanic');
    const wrongState = fixture('snake');
    wrongState.stateMachine.transitions[0].to = 'ghost';
    expect(() => parseGameDesignDocument(wrongState)).toThrow('declared states');
    const wrongKey = fixture('snake');
    wrongKey.acceptance[0].actions = [{ type: 'key', key: 'Meta+R' }];
    expect(() => parseGameDesignDocument(wrongKey)).toThrow('unsupported keyboard key');
    const injected = { ...fixture('snake'), exec: 'process.exit()' };
    expect(() => parseGameDesignDocument(injected)).toThrow('unsupported field');
    const inconsistent = fixture('snake');
    inconsistent.acceptance[2].actions = [{ type: 'wait', ms: 10 }];
    expect(() => parseGameDesignDocument(inconsistent)).toThrow('manual requirements');
    const unsupported = fixture('snake');
    unsupported.templateVersion = '0.0.0';
    expect(() => parseGameDesignDocument(unsupported)).toThrow('templateVersion');
  });

  it('never promotes manual rules to fabricated executable passes', () => {
    const raw = fixture('2048');
    raw.acceptance = raw.acceptance.filter((r: { mode: string }) => r.mode === 'manual');
    const result = compileGameDesign(parseGameDesignDocument(raw));
    expect(result.contract).toBeNull();
    expect(result.coverage.manual).toBe(2);
    expect(result.coverage.uncoveredMechanics).toContain('movement');
  });

  it('detects unreachable states as warnings', () => {
    const raw = fixture('snake');
    raw.stateMachine.transitions = [];
    const warnings = inspectGameStateMachine(parseGameDesignDocument(raw));
    expect(warnings).toHaveLength(2);
    expect(warnings.join('|')).toContain('gameover');
  });

  it('rejects unregistered path traversal, regardless of file structure', () => {
    expect(() => loadGameTemplate(source, '../../etc/passwd')).toThrow('Unknown game genre');
  });

  it('diagnoses specific failing evidence and preserves traceability', () => {
    const coverage = compileGameDesign(parseGameDesignDocument(fixture('snake'))).coverage;
    const result: QualityReport = {
      schemaVersion: 1, runId: 'd72c0a0f-44e9-48e1-88e0-41fd868dcd04',
      contractName: 'Snake Classic', contractSha256: '', gameSha256: '',
      seed: 1, startedAt: '2026-10-23T10:00:00Z', durationMs: 1,
      status: 'failed', scenarios: [
        { id: 'begin', status: 'failed', trace: [], pageErrors: [], checks: [
          { assertion: { type: 'state-equals', key: 'phase', value: 'playing' },
            passed: false, detail: 'phase expected "playing", observed null' },
        ] },
      ],
    };
    const d = diagnoseGameQuality(result, coverage);
    expect(d[0].requirementId).toBe('begin');
    expect(d[0].suggestion).toContain('__GAME_TEST__');
    expect(d.some(e => e.id === 'manual-scoringReview')).toBe(true);
    expect(d.some(e => e.category === 'coverage')).toBe(true);
  });
});
