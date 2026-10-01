// lib/runtime/report-generator.ts
import type { GameAnalysis } from './analyzer';
import type { PerfMetrics } from './perf-monitor';

interface RuntimeIssue {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  fixSuggestion: string;
}

export function generateTextReport(
  analysis: GameAnalysis,
  issues: RuntimeIssue[],
  perf: PerfMetrics,
  stepCount: number,
  fps: number,
  durationSec: number,
  status: 'passed' | 'failed' | 'incomplete' = issues.some((i) => i.severity === 'error') ? 'failed' : 'passed',
): string {
  const sevCount: Record<string, number> = {};
  issues.forEach(i => { sevCount[i.severity] = (sevCount[i.severity] || 0) + 1; });

  const lines: string[] = [
    `GAME RUNTIME REPORT (${stepCount} steps, ${fps} FPS, ${durationSec}s)`,
    `Status: ${status}`,
    `Game: ${analysis.type} (${analysis.tier} tier) | Input: ${analysis.inputMethods.join(',')}`,
    `Issues: ${issues.length} (E:${sevCount.error || 0} W:${sevCount.warning || 0} I:${sevCount.info || 0})`,
    '',
  ];

  if (issues.length === 0 && status === 'passed') {
    lines.push('No issues detected. Game runs without visible problems.');
  } else if (issues.length === 0) {
    lines.push('Test incomplete. No conclusion can be drawn from the partial run.');
  } else {
    for (const issue of issues) {
      lines.push(`[${issue.severity.toUpperCase()}] ${issue.title}`);
      lines.push(`  ${issue.description}`);
      lines.push(`  Fix: ${issue.fixSuggestion}`);
      lines.push('');
    }
  }

  lines.push(
    `Performance: FPS avg=${perf.fps.avg} stability=${perf.fps.stability}% | Frame avg=${perf.frameTime.avg}ms p99=${perf.frameTime.p99}ms`,
  );

  if (issues.length > 0) {
    lines.push('');
    lines.push('Review the issues above and fix the game code. Run build_game and game_runtime again to verify fixes.');
  }

  return lines.join('\n');
}
