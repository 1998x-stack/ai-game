import { parseGameTestContract, type GameTestContract } from '@/lib/runtime/game-contract';
import { type GameDesignDocument } from './gdd';

export interface GameCoverage {
  total: number;
  automated: number;
  manual: number;
  uncoveredMechanics: string[];
  links: { requirementId: string; mechanicId: string; scenarioId: string | null;
    status: 'automated' | 'manual'; note?: string }[];
}
export interface GameCompilation {
  contract: GameTestContract | null;
  coverage: GameCoverage;
}

/**
 * Compile only explicitly testable requirements. A manual acceptance criterion
 * never becomes a simulated passing assertion, and full coverage is not claimed.
 */
export function compileGameDesign(doc: GameDesignDocument): GameCompilation {
  const candidates = doc.acceptance.filter(r => r.mode === 'automated');
  const manual = doc.acceptance.filter(r => r.mode === 'manual');
  const contract = candidates.length > 0 ? parseGameTestContract({
    schemaVersion: 1, name: doc.title, seed: doc.seed, viewport: doc.viewport,
    scenarios: candidates.map(r => ({
      id: r.id, name: r.title, actions: r.actions, assertions: r.assertions,
    })),
  }) : null;
  const covered = new Set(doc.acceptance.map(r => r.mechanic));
  const coverage: GameCoverage = {
    total: doc.acceptance.length, automated: candidates.length, manual: manual.length,
    uncoveredMechanics: doc.mechanics.filter(m => !covered.has(m.id)).map(m => m.id),
    links: doc.acceptance.map(r => ({
      requirementId: r.id, mechanicId: r.mechanic,
      scenarioId: r.mode === 'automated' ? r.id : null,
      status: r.mode,
      ...(r.rationale ? { note: r.rationale } : {}),
    })),
  };
  return { contract, coverage };
}

export function formatGameCoverage(coverage: GameCoverage): string {
  return [
    'Requirements: ' + coverage.total,
    'Executable cases: ' + coverage.automated,
    'Manual review: ' + coverage.manual,
    'Uncovered mechanics: ' + (coverage.uncoveredMechanics.join(', ') || 'none'),
    ...coverage.links.map(link => link.requirementId + ' [' + link.status + '] ' +
      (link.scenarioId || link.note || 'manual review required')),
  ].join('\n');
}
