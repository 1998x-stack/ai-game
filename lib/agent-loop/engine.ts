import crypto from 'crypto';
import fs from 'fs';
import { parse } from 'acorn';
import { parseGameDesignDocument } from '@/lib/game-design/gdd';
import { compileGameDesign } from '@/lib/game-design/compiler';
import type { GameTestContract } from '@/lib/runtime/game-contract';
import type { QualityReport } from '@/lib/runtime/quality-evaluator';
import {
  appendLoopEvent, isTerminal, loadLoopState, loopPaths, readLoopSource,
  saveLoopBaseline, saveLoopState, sha256, writeLoopSource,
  type LoopState,
} from './state';

export interface LoopDriver {
  generate(input: { goal: string; current: string; design: string; failure: string;
    attempt: number; signal?: AbortSignal }): Promise<{ source: string; tokens: number }>;
  build(): Promise<{ success: boolean; errors: string[]; html: string }>;
  test(html: string, contract: GameTestContract): Promise<{
    report: Pick<QualityReport,'status'|'runId'|'contractSha256'>; reportPath: string;
    summary: string;
  }>;
}
export interface LoopStartOptions {
  goal: string;
  maxAttempts?: number;
  tokenBudget?: number;
  durationMinutes?: number;
}
function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error('Budget must be an integer from ' + min + ' to ' + max);
  }
  return result;
}
function loadDesign(root: string): { serialized: string; contract: GameTestContract } {
  const filename = root + '/game.design.json';
  if (!fs.existsSync(filename) || fs.statSync(filename).size > 64_000) {
    throw new Error('An existing, bounded game.design.json is required');
  }
  const document = parseGameDesignDocument(JSON.parse(fs.readFileSync(filename, 'utf8')));
  const compiled = compileGameDesign(document);
  if (!compiled.contract) throw new Error('GDD has no automated acceptance tests');
  const contract = compiled.contract;
  // Each advance is intended to complete within the 30s agent tool timeout.
  if (contract.scenarios.length > 2 ||
      contract.scenarios.reduce((ms, s) => ms + s.actions.reduce(
        (sum, a) => sum + (a.type === 'wait' ? a.ms :
          a.type === 'key' ? (a.holdMs ?? 0) : 0), 0), 0) > 6_000 ||
      contract.scenarios.some(s => s.actions.length > 12)) {
    throw new Error('Stage 2.3 requires <=2 scenarios, <=12 actions each, <=6000ms waits/holds');
  }
  return { serialized: JSON.stringify(document), contract };
}
export function beginLoop(root: string, options: LoopStartOptions): LoopState {
  if (typeof options.goal !== 'string' || options.goal.trim().length < 8 ||
      options.goal.length > 2000) throw new Error('Goal must be 8–2000 characters');
  loadDesign(root);
  const existing = loadLoopState(root);
  if (existing && !isTerminal(existing.phase)) {
    throw new Error('Existing active run must finish or be cancelled');
  }
  if (existing?.phase === 'awaiting-approval') {
    throw new Error('Approve or cancel the current run before starting a new run');
  }
  const baseline = readLoopSource(root);
  const now = Date.now();
  const maxAttempts = bounded(options.maxAttempts, 2, 1, 3);
  const tokenBudget = bounded(options.tokenBudget, 8000, 1000, 20000);
  const durationMinutes = bounded(options.durationMinutes, 5, 1, 10);
  const state: LoopState = {
    schemaVersion: 1, id: crypto.randomUUID(), phase: 'planning',
    goal: options.goal.trim(), createdAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + durationMinutes * 60_000).toISOString(),
    attempt: 0, maxAttempts, modelCalls: 0, maxModelCalls: maxAttempts,
    tokensUsed: 0, tokenBudget, baselineSha: sha256(baseline),
    activeSha: sha256(baseline), events: [],
  };
  saveLoopBaseline(root, baseline);
  appendLoopEvent(state, 'planning', 'Run created; original game source snapshotted');
  saveLoopState(root, state);
  return state;
}
function failHuman(root: string, s: LoopState, reason: string): LoopState {
  s.lastFailure = reason.slice(0, 400);
  appendLoopEvent(s, 'needs-human', s.lastFailure);
  saveLoopState(root, s);
  return s;
}
function assertNoExternalEdits(root: string, s: LoopState): boolean {
  if (sha256(readLoopSource(root)) !== s.activeSha) {
    failHuman(root, s, 'Game file was modified outside the active loop; manual reconciliation required');
    return false;
  }
  return true;
}
export async function advanceLoop(root: string, driver: LoopDriver, signal?: AbortSignal): Promise<LoopState> {
  const s = loadLoopState(root);
  if (!s) throw new Error('No saved loop. Start one first.');
  if (isTerminal(s.phase) || s.phase === 'awaiting-approval') return s;
  if (!assertNoExternalEdits(root, s)) return s;
  if (signal?.aborted) return failHuman(root, s, 'Operation was cancelled');
  if (Date.now() > Date.parse(s.deadlineAt)) return failHuman(root, s, 'Run deadline exceeded');

  try {
    switch (s.phase) {
      case 'planning': {
        const { contract } = loadDesign(root);
        s.contractSha = sha256(JSON.stringify(contract));
        appendLoopEvent(s, 'generating', 'Validated GDD and executable acceptance');
        break;
      }
      case 'generating': {
        if (s.generationReserved) {
          return failHuman(root, s, 'Interrupted generation detected after restart; no hidden model retry');
        }
        if (s.modelCalls >= s.maxModelCalls || s.tokensUsed >= s.tokenBudget) {
          return failHuman(root, s, 'Model/token budget exhausted');
        }
        const { serialized, contract } = loadDesign(root);
        if (sha256(JSON.stringify(contract)) !== s.contractSha) {
          return failHuman(root, s, 'Game design changed during run; manual review required');
        }
        // Reserve a call before invoking the model, so a crash cannot repeat an
        // unmetered model call automatically on recovery.
        s.modelCalls++;
        s.attempt++;
        s.generationReserved = true;
        appendLoopEvent(s, 'generating', 'Reserved model call ' + s.modelCalls);
        saveLoopState(root, s);
        const output = await driver.generate({
          goal: s.goal, design: serialized, current: readLoopSource(root),
          failure: s.lastFailure || '', attempt: s.attempt, signal,
        });
        if (!Number.isSafeInteger(output.tokens) || output.tokens < 1 ||
            output.tokens > s.tokenBudget - s.tokensUsed) {
          return failHuman(root, s, 'Invalid model usage or token budget exceeded');
        }
        s.tokensUsed += output.tokens;
        s.generationReserved = false;
        saveLoopState(root, s);
        if (signal?.aborted) return failHuman(root, s, 'Operation was cancelled after generation');
        if (Date.now() > Date.parse(s.deadlineAt)) return failHuman(root, s, 'Run deadline exceeded');
        try {
          parse(output.source, { ecmaVersion: 'latest', sourceType: 'module' });
        } catch (err) {
          s.lastFailure = 'Syntax validation failed: ' + (err instanceof Error ? err.message : String(err));
          appendLoopEvent(s, 'reviewing', s.lastFailure);
          break;
        }
        // A model cannot change arbitrary files: only a checked JS replacement.
        writeLoopSource(root, output.source);
        s.activeSha = sha256(output.source);
        appendLoopEvent(s, 'building', 'Generated valid JavaScript; next build');
        break;
      }
      case 'building': {
        const build = await driver.build();
        s.lastFailure = build.success ? undefined : build.errors.join('; ').slice(0, 400);
        appendLoopEvent(s, 'testing',
          build.success ? 'Build succeeded' : 'Build failed: ' + s.lastFailure);
        if (!build.success) {
          appendLoopEvent(s, 'reviewing', 'Build evidence requires repair or review');
        }
        break;
      }
      case 'testing': {
        const { contract } = loadDesign(root);
        if (sha256(JSON.stringify(contract)) !== s.contractSha) {
          return failHuman(root, s, 'Design changed before testing');
        }
        // Rebuild here because output/index.html is not a durable, content-
        // addressed artifact across process restarts.
        const build = await driver.build();
        if (!build.success) {
          s.lastFailure = 'Build failed on replay: ' + build.errors.join('; ').slice(0, 300);
          appendLoopEvent(s, 'reviewing', s.lastFailure);
          break;
        }
        const result = await driver.test(build.html, contract);
        if (result.report.contractSha256 !== s.contractSha) {
          return failHuman(root, s, 'Test evidence contract digest does not match current GDD');
        }
        s.reportId = result.report.runId;
        s.reportPath = result.reportPath;
        s.lastFailure = result.report.status === 'passed' ? undefined :
          (result.report.status + ': ' + result.summary).slice(0, 400);
        appendLoopEvent(s, 'reviewing', 'Playtest: ' + result.report.status);
        break;
      }
      case 'reviewing': {
        if (!s.lastFailure) {
          appendLoopEvent(s, 'awaiting-approval', 'Tests passed; human must approve, no automatic publish');
        } else if (s.lastFailure.startsWith('incomplete:')) {
          return failHuman(root, s, 'Unreliable test environment: ' + s.lastFailure);
        } else if (s.modelCalls >= s.maxModelCalls || s.tokensUsed >= s.tokenBudget) {
          return failHuman(root, s, 'Repair budget exhausted: ' + s.lastFailure);
        } else {
          appendLoopEvent(s, 'repairing', 'Failure evidence available for bounded retry');
        }
        break;
      }
      case 'repairing':
        appendLoopEvent(s, 'generating', 'Retry with failure context');
        break;
    }
    saveLoopState(root, s);
    return s;
  } catch (err) {
    return failHuman(root, s, 'Stage failed: ' + (err instanceof Error ? err.message : String(err)));
  }
}
export function finishLoop(root: string, action: 'approve'|'cancel'): LoopState {
  const s = loadLoopState(root);
  if (!s) throw new Error('No saved loop');
  if (action === 'approve') {
    if (s.phase !== 'awaiting-approval') throw new Error('Approval requires passed tests');
    if (!assertNoExternalEdits(root, s)) return s;
    appendLoopEvent(s, 'accepted', 'User-approved verified game source');
  } else {
    if (s.phase === 'accepted') throw new Error('Approved runs cannot be cancelled');
    if (!assertNoExternalEdits(root, s)) return s;
    const baseline = fs.readFileSync(loopPaths(root).backup, 'utf8');
    if (sha256(baseline) !== s.baselineSha) {
      return failHuman(root, s, 'Baseline was tampered with; rollback blocked');
    }
    writeLoopSource(root, baseline);
    s.activeSha = s.baselineSha;
    appendLoopEvent(s, 'cancelled', 'Restored baseline game source');
  }
  saveLoopState(root, s);
  return s;
}
