export interface RuntimeIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  fixSuggestion: string;
}

export type RuntimeStatus = 'passed' | 'failed' | 'incomplete';

export function runDetectionRules(finalState: Record<string, unknown>, stateHistory: Record<string, unknown>[]): RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];
  const canvas = finalState._canvas as { width: number; height: number } | undefined;
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    issues.push({ id: 'zero-canvas', severity: 'error', category: 'rendering', title: 'Canvas dimensions are zero', description: 'Canvas width/height is 0. Game may not render properly.', fixSuggestion: 'Use setupCanvas("gameCanvas", 800, 600) or set canvas.width/height manually.' });
  }
  const scoreVals = stateHistory.map((state) => parseFloat(String(state.score ?? '0'))).filter((value) => !Number.isNaN(value));
  if (scoreVals.length > 1 && scoreVals.every((value) => value === scoreVals[0])) {
    issues.push({ id: 'stagnant-score', severity: 'warning', category: 'game-logic', title: 'Score unchanged throughout test', description: 'Score remained constant across all test steps. Scoring logic may not be working.', fixSuggestion: 'Ensure score increments on game events.' });
  }
  const gameOver = ['gameOver', 'gameover', 'isGameOver'];
  if (gameOver.every((key) => finalState[key] !== 'true' && finalState[key] !== true) && stateHistory.length > 0) {
    issues.push({ id: 'no-game-over', severity: 'info', category: 'game-logic', title: 'Game over not triggered', description: 'Game did not trigger a game-over state during the test. This may be normal.', fixSuggestion: 'If the game should have ended, verify game-over conditions.' });
  }
  return issues;
}
