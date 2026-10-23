import { describe, expect, it } from 'vitest';
import { parseGameTestContract } from '@/lib/runtime/game-contract';
import { evaluateGameAssertions, aggregateQualityStatus } from '@/lib/runtime/quality-evaluator';
import { injectSeed } from '@/lib/runtime/quality-runner';

function basic() {
  return {
    schemaVersion: 1, name: 'Snake acceptance test', seed: 42,
    viewport: { width: 800, height: 600 },
    scenarios: [{
      id: 'start', name: 'Start and score',
      actions: [{ type: 'key', key: 'Space' }, { type: 'wait', ms: 100 }],
      assertions: [
        { type: 'canvas-size', minWidth: 800, minHeight: 600 },
        { type: 'state-changed', key: 'score' },
        { type: 'no-errors' },
      ],
    }],
  };
}

describe('game quality contract', () => {
  it('accepts bounded deterministic scenarios', () => {
    const c = parseGameTestContract(basic());
    expect(c.scenarios[0].actions).toHaveLength(2);
    expect(c.seed).toBe(42);
  });
  it('rejects executable fields, unsafe keys and unsupported schema versions', () => {
    expect(() => parseGameTestContract({ ...basic(), script: 'eval(1)' })).toThrow('unsupported field');
    expect(() => parseGameTestContract({ ...basic(), schemaVersion: 2 })).toThrow('schemaVersion');
    const invalid = basic();
    invalid.scenarios[0].actions = [{ type: 'key', key: 'Control+O' }];
    expect(() => parseGameTestContract(invalid)).toThrow('keyboard key');
  });
  it('rejects unbounded actions, identifiers and duplicate ids', () => {
    const invalid = basic();
    invalid.scenarios[0].actions = Array.from({ length: 41 }, () => ({ type: 'wait', ms: 1 }));
    expect(() => parseGameTestContract(invalid)).toThrow('1-40');
    const duplicate = basic();
    duplicate.scenarios.push({ ...duplicate.scenarios[0] });
    expect(() => parseGameTestContract(duplicate)).toThrow('Duplicate scenario');
  });
  it('fails closed when observable state is absent', () => {
    const checks = evaluateGameAssertions([
      { type: 'state-changed', key: 'score' },
      { type: 'game-over', expected: false },
      { type: 'canvas-size', minWidth: 640, minHeight: 480 },
    ], {}, { _canvas: { width: 800, height: 600, visible: true } }, []);
    expect(checks.map((check) => check.passed)).toEqual([false, false, true]);
  });
  it('compares observable values rather than blindly checking success', () => {
    const checks = evaluateGameAssertions([
      { type: 'state-changed', key: 'score' },
      { type: 'state-equals', key: 'score', value: 10 },
      { type: 'no-errors' },
    ], { score: 0 }, { score: 10 }, ['Uncaught error']);
    expect(checks.map((check) => check.passed)).toEqual([true, true, false]);
  });
  it('handles incomplete and failed scenarios conservatively', () => {
    expect(aggregateQualityStatus([])).toBe('incomplete');
    expect(aggregateQualityStatus([{ id: 'a', status: 'incomplete', checks: [], trace: [], pageErrors: [] }])).toBe('incomplete');
    expect(aggregateQualityStatus([{ id: 'a', status: 'failed', checks: [], trace: [], pageErrors: [] }])).toBe('failed');
  });
  it('injects repeatable seed before game scripts', () => {
    const html = '<!doctype html><html><head></head><body><script>Math.random()</script></body></html>';
    expect(injectSeed(html, 42)).toBe(injectSeed(html, 42));
    expect(injectSeed(html, 42)).not.toBe(injectSeed(html, 43));
    expect(injectSeed(html, 42).indexOf('data-game-test-seed')).toBeLessThan(
      injectSeed(html, 42).indexOf('Math.random()'),
    );
  });
});
