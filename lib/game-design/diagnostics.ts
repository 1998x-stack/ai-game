import type { QualityReport } from '@/lib/runtime/quality-evaluator';
import type { GameCoverage } from './compiler';

export interface GameDiagnostic {
  id: string;
  severity: 'error' | 'warning' | 'info';
  scenarioId: string | null;
  requirementId: string | null;
  category: 'game-state' | 'rendering' | 'runtime' | 'test-environment' | 'coverage';
  finding: string;
  suggestion: string;
}

/**
 * Evidence-first, rule-based diagnostics. Suggestions are hypotheses:
 * no change is applied and no defect is declared proven without review.
 */
export function diagnoseGameQuality(
  report: QualityReport,
  coverage?: GameCoverage,
): GameDiagnostic[] {
  const diagnoses: GameDiagnostic[] = [];
  const requirement = (id: string) =>
    coverage?.links.find(item => item.scenarioId === id)?.requirementId ?? null;
  for (const scenario of report.scenarios) {
    const requirementId = requirement(scenario.id);
    if (scenario.status === 'incomplete') {
      diagnoses.push({
        id: 'run-incomplete-' + scenario.id,
        severity: 'warning', scenarioId: scenario.id, requirementId,
        category: 'test-environment',
        finding: scenario.failure || 'Scenario ended without sufficient evidence',
        suggestion: 'Check browser availability, test budget and test instrumentation; rerun before judging gameplay.',
      });
    }
    if (scenario.pageErrors.length > 0) {
      diagnoses.push({
        id: 'runtime-error-' + scenario.id,
        severity: 'error', scenarioId: scenario.id, requirementId,
        category: 'runtime',
        finding: scenario.pageErrors[0].slice(0, 300),
        suggestion: 'Inspect the first browser exception and its location in scripts/game.js.',
      });
    }
    for (const [i, check] of scenario.checks.entries()) {
      if (check.passed) continue;
      const type = check.assertion.type;
      const isCanvas = type === 'canvas-size';
      const missingState = /observed null/.test(check.detail);
      diagnoses.push({
        id: 'assertion-' + scenario.id + '-' + i,
        severity: 'error', scenarioId: scenario.id, requirementId,
        category: isCanvas ? 'rendering' : type === 'no-errors' ? 'runtime' : 'game-state',
        finding: (type + ': ' + check.detail).slice(0, 300),
        suggestion: isCanvas
          ? 'Verify canvas dimensions, CSS visibility and the setupCanvas call.'
          : missingState
            ? 'Expose the expected scalar field via window.__GAME_TEST__.getState(); confirm its name and type.'
            : type === 'state-changed'
              ? 'Check the game input mapping and whether enough simulation time elapsed before the assertion.'
              : type === 'game-over'
                ? 'Expose a boolean gameOver field and verify the terminal state transition.'
                : type === 'no-errors'
                  ? 'Inspect errors in the browser report before modifying gameplay.'
                  : 'Inspect the state transition and compare the expected scalar with the recorded action trace.',
      });
    }
  }
  if (coverage) {
    for (const name of coverage.uncoveredMechanics) {
      diagnoses.push({
        id: 'uncovered-' + name,
        severity: 'info', scenarioId: null, requirementId: null,
        category: 'coverage',
        finding: 'Mechanic ' + name + ' has no acceptance requirement',
        suggestion: 'Add an automated or manual acceptance criterion to the GDD.',
      });
    }
    for (const item of coverage.links.filter(item => item.status === 'manual')) {
      diagnoses.push({
        id: 'manual-' + item.requirementId,
        severity: 'info', scenarioId: null, requirementId: item.requirementId,
        category: 'coverage',
        finding: 'Manual acceptance is not verified: ' + (item.note || item.requirementId),
        suggestion: 'Review it manually; add an executable assertion only when game state makes it provable.',
      });
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  return diagnoses.sort((a, b) => order[a.severity] - order[b.severity]);
}
