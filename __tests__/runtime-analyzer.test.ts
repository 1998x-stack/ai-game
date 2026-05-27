import { describe, it, expect } from 'vitest';
import { analyzeGame, detectGameType, extractStateVars, detectInputMethods, detectAnimLoop } from '@/lib/runtime/analyzer';

describe('detectGameType', () => {
  it('detects snake from keywords', () => {
    const code = `let snake = []; let direction = 'right'; let food = {}; function grow() {};`;
    expect(detectGameType(code).type).toBe('snake');
    expect(detectGameType(code).tier).toBe('template');
  });
  it('detects breakout', () => {
    const code = `let paddle = {}; let ball = {}; let bricks = []; let lives = 3;`;
    expect(detectGameType(code).type).toBe('breakout');
  });
  it('detects tetris', () => {
    const code = `const grid = []; function clearRows() {}; const tetromino = [];`;
    expect(detectGameType(code).type).toBe('tetris');
  });
  it('detects 2048', () => {
    const code = `const board = []; function mergeTiles() {};`;
    expect(detectGameType(code).type).toBe('2048');
  });
  it('detects platformer (detection tier)', () => {
    const code = `let gravity = 9.8; function jump() {}; let platform = {};`;
    const result = detectGameType(code);
    expect(result.type).toBe('platformer');
    expect(result.tier).toBe('detection');
  });
  it('returns unknown for unrecognized code', () => {
    expect(detectGameType('let x = 1; console.log(x);').type).toBe('unknown');
    expect(detectGameType('let x = 1; console.log(x);').tier).toBe('fallback');
  });
});

describe('extractStateVars', () => {
  it('extracts var/let/const declarations', () => {
    const vars = extractStateVars('var score = 0; let lives = 3; const level = 1;');
    expect(vars).toContain('score');
    expect(vars).toContain('lives');
    expect(vars).toContain('level');
  });
});

describe('detectInputMethods', () => {
  it('detects keyboard and mouse', () => {
    const methods = detectInputMethods("addEventListener('keydown', h); addEventListener('click', h);");
    expect(methods).toContain('keyboard');
    expect(methods).toContain('mouse');
  });
});

describe('detectAnimLoop', () => {
  it('detects requestAnimationFrame usage', () => {
    expect(detectAnimLoop('function gameLoop() { requestAnimationFrame(gameLoop); }')).toBe(true);
    expect(detectAnimLoop('setInterval(update, 16)')).toBe(false);
  });
});

describe('analyzeGame', () => {
  it('returns aggregated analysis', () => {
    const result = analyzeGame("let snake = []; let direction = 'right'; var food = {}; addEventListener('keydown', h); requestAnimationFrame(loop);");
    expect(result.type).toBe('snake');
    expect(result.tier).toBe('template');
    expect(result.stateVars).toContain('snake');
    expect(result.inputMethods).toContain('keyboard');
    expect(result.hasAnimLoop).toBe(true);
  });
});
