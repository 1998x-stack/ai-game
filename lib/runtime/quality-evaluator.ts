import type { GameAssertion, GameTestContract, GameAction } from './game-contract';

export interface GameState {
  _canvas?: { width: number; height: number; visible: boolean };
  [key: string]: unknown;
}
export interface QualityCheck {
  assertion: GameAssertion;
  passed: boolean;
  detail: string;
}
export interface ActionTrace {
  index: number;
  action: GameAction;
  state: GameState;
}
export interface ScenarioResult {
  id: string;
  status: 'passed' | 'failed' | 'incomplete';
  checks: QualityCheck[];
  trace: ActionTrace[];
  pageErrors: string[];
  failure?: string;
  screenshot?: string;
}
export interface QualityReport {
  schemaVersion: 1;
  runId: string;
  contractName: string;
  contractSha256: string;
  gameSha256: string;
  seed: number;
  startedAt: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'incomplete';
  scenarios: ScenarioResult[];
}

function scalar(state: GameState, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : undefined;
}

export function evaluateGameAssertions(
  assertions: readonly GameAssertion[],
  before: GameState,
  after: GameState,
  errors: readonly string[],
): QualityCheck[] {
  return assertions.map((assertion) => {
    let passed = false;
    let detail = '';
    switch (assertion.type) {
      case 'canvas-size': {
        const canvas = after._canvas;
        passed = Boolean(canvas?.visible && canvas.width >= assertion.minWidth &&
          canvas.height >= assertion.minHeight);
        detail = 'visible canvas expected at least ' + assertion.minWidth + 'x' +
          assertion.minHeight + ', observed ' + (canvas ? canvas.width + 'x' + canvas.height +
          ' visible=' + canvas.visible : 'missing');
        break;
      }
      case 'state-equals': {
        const observed = scalar(after, assertion.key);
        passed = observed !== undefined && observed === assertion.value;
        detail = assertion.key + ' expected ' + JSON.stringify(assertion.value) +
          ', observed ' + JSON.stringify(observed === undefined ? null : observed);
        break;
      }
      case 'state-changed': {
        const prior = scalar(before, assertion.key);
        const observed = scalar(after, assertion.key);
        passed = prior !== undefined && observed !== undefined &&
          JSON.stringify(prior) !== JSON.stringify(observed);
        detail = assertion.key + ' must change, before=' + JSON.stringify(prior ?? null) +
          ' after=' + JSON.stringify(observed ?? null);
        break;
      }
      case 'game-over': {
        const state = scalar(after, 'gameOver') ?? scalar(after, 'gameover') ??
          scalar(after, 'isGameOver');
        passed = typeof state === 'boolean' && state === assertion.expected;
        detail = 'game-over expected ' + assertion.expected + ', observed ' +
          JSON.stringify(state ?? null);
        break;
      }
      case 'no-errors':
        passed = errors.length === 0;
        detail = 'page errors: ' + errors.length;
        break;
    }
    return { assertion, passed, detail };
  });
}

export function aggregateQualityStatus(
  scenarios: readonly ScenarioResult[],
): QualityReport['status'] {
  // A failed assertion takes priority, but an incomplete run is never a pass.
  if (scenarios.some((scenario) => scenario.status === 'failed')) return 'failed';
  if (scenarios.length === 0 || scenarios.some((scenario) => scenario.status === 'incomplete')) {
    return 'incomplete';
  }
  return 'passed';
}

export function formatQualityReport(
  report: QualityReport,
  artifactPath: string,
): string {
  const lines = [
    'GAME QUALITY REPORT',
    'Status: ' + report.status,
    'Game: ' + report.contractName,
    'Seed: ' + report.seed,
    'Scenarios: ' + report.scenarios.length,
    'Evidence: ' + artifactPath,
  ];
  for (const scenario of report.scenarios) {
    lines.push(' - [' + scenario.status.toUpperCase() + '] ' + scenario.id +
      ' (' + scenario.checks.filter((check) => check.passed).length + '/' +
      scenario.checks.length + ' checks)');
    for (const check of scenario.checks.filter((item) => !item.passed)) {
      lines.push('   FAIL ' + check.detail);
    }
    if (scenario.failure) lines.push('   ERROR ' + scenario.failure);
  }
  return lines.join('\n');
}

/** Documentation shape used by workspace Game Skill writers. */
export type { GameTestContract };
