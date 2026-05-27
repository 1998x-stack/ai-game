import { describe, it, expect } from 'vitest';
import { generateTestScenario } from '@/lib/runtime/test-engine';
import type { GameAnalysis } from '@/lib/runtime/analyzer';

const snakeAnalysis: GameAnalysis = {
  type: 'snake', tier: 'template', stateVars: ['snake'],
  inputMethods: ['keyboard'], hasAnimLoop: true, confidence: 0.8,
};

describe('generateTestScenario', () => {
  it('returns preset scenario for template tier', () => {
    const s = generateTestScenario(snakeAnalysis, 'quick');
    expect(s).not.toBeNull();
    expect(s!.tier).toBe('template');
    expect(s!.actions.length).toBeGreaterThan(0);
  });

  it('returns heuristic for detection tier', () => {
    const analysis: GameAnalysis = { ...snakeAnalysis, type: 'platformer', tier: 'detection', confidence: 0.5 };
    const s = generateTestScenario(analysis, 'quick');
    expect(s).not.toBeNull();
    expect(s!.tier).toBe('detection');
  });

  it('returns null for fallback tier (AI decision needed)', () => {
    const analysis: GameAnalysis = { ...snakeAnalysis, type: 'unknown', tier: 'fallback', confidence: 0 };
    expect(generateTestScenario(analysis, 'quick')).toBeNull();
  });

  it('includes mouse actions when game supports mouse input', () => {
    const analysis: GameAnalysis = { ...snakeAnalysis, type: 'breakout', tier: 'template', inputMethods: ['keyboard', 'mouse'] };
    const s = generateTestScenario(analysis, 'quick');
    const mouseActions = s!.actions.filter(a => a.type === 'mouse_click' || a.type === 'mouse_move');
    expect(mouseActions.length).toBeGreaterThan(0);
  });
});
