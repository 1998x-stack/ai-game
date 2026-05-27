import type { GameAnalysis } from './analyzer';

export type TestAction =
  | { type: 'keyboard'; key: string; duration: number }
  | { type: 'keyboard_hold'; key: string; duration: number }
  | { type: 'mouse_click'; x: number; y: number }
  | { type: 'mouse_move'; x: number; y: number }
  | { type: 'touch_tap'; x: number; y: number }
  | { type: 'wait'; duration: number };

export interface TestScenario {
  name: string;
  tier: 'template' | 'detection';
  actions: TestAction[];
}

const TEMPLATE_SCENARIOS: Record<string, (mode: string) => TestScenario> = {
  snake: (mode) => ({
    name: 'Snake: direction switching', tier: 'template',
    actions: [
      { type: 'keyboard', key: 'ArrowRight', duration: 300 },
      { type: 'keyboard', key: 'ArrowUp', duration: 300 },
      { type: 'keyboard', key: 'ArrowLeft', duration: 300 },
      { type: 'keyboard', key: 'ArrowDown', duration: 300 },
    ],
  }),
  breakout: (mode) => ({
    name: 'Breakout: paddle + ball', tier: 'template',
    actions: [
      { type: 'wait', duration: 2000 },
      { type: 'keyboard_hold', key: 'ArrowLeft', duration: 500 },
      { type: 'keyboard_hold', key: 'ArrowRight', duration: 1000 },
      { type: 'mouse_click', x: 400, y: 500 },
    ],
  }),
  tetris: () => ({
    name: 'Tetris: rotate + move', tier: 'template',
    actions: [
      { type: 'keyboard', key: 'ArrowUp', duration: 200 },
      { type: 'keyboard', key: 'ArrowLeft', duration: 200 },
      { type: 'keyboard', key: 'ArrowDown', duration: 100 },
      { type: 'keyboard', key: 'ArrowRight', duration: 200 },
    ],
  }),
  '2048': () => ({
    name: '2048: four swipes', tier: 'template',
    actions: [
      { type: 'keyboard', key: 'ArrowUp', duration: 300 },
      { type: 'keyboard', key: 'ArrowRight', duration: 300 },
      { type: 'keyboard', key: 'ArrowDown', duration: 300 },
      { type: 'keyboard', key: 'ArrowLeft', duration: 300 },
    ],
  }),
};

function generateHeuristicScenario(analysis: GameAnalysis, mode: string): TestScenario {
  const actions: TestAction[] = [];
  if (analysis.inputMethods.includes('keyboard')) {
    actions.push(
      { type: 'keyboard', key: 'ArrowUp', duration: 200 },
      { type: 'keyboard', key: 'Space', duration: 200 },
      { type: 'keyboard', key: 'ArrowLeft', duration: 200 },
      { type: 'keyboard', key: 'ArrowRight', duration: 200 },
    );
  }
  if (analysis.inputMethods.includes('mouse')) {
    actions.push(
      { type: 'mouse_click', x: 400, y: 300 },
      { type: 'mouse_move', x: 600, y: 400 },
    );
  }
  if (analysis.inputMethods.includes('touch')) {
    actions.push({ type: 'touch_tap', x: 300, y: 400 });
  }
  if (actions.length > 0) actions.unshift({ type: 'wait', duration: 1000 });
  return { name: `${analysis.type}: heuristic test`, tier: 'detection', actions: actions.slice(0, 8) };
}

export function generateTestScenario(analysis: GameAnalysis, mode: string = 'quick'): TestScenario | null {
  if (analysis.tier === 'template' && TEMPLATE_SCENARIOS[analysis.type]) {
    return TEMPLATE_SCENARIOS[analysis.type](mode);
  }
  if (analysis.tier === 'detection') {
    return generateHeuristicScenario(analysis, mode);
  }
  return null; // fallback tier → AI decision needed
}
