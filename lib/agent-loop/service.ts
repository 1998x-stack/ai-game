import type { AgentConfig } from '@/lib/agent/types';
import { advanceLoop, beginLoop, finishLoop, type LoopStartOptions } from './engine';
import { createProductionLoopDriver } from './adapter';
import { loadLoopState, type LoopState } from './state';

const active = new Set<string>();

function response(state: LoopState | null): string {
  if (!state) return JSON.stringify({ status: 'not-started' });
  // Goal and full source are intentionally not echoed back into the LLM.
  const { id, phase, attempt, maxAttempts, modelCalls, maxModelCalls, tokensUsed,
    tokenBudget, deadlineAt, reportPath, lastFailure, events } = state;
  return JSON.stringify({
    id, phase, attempt, maxAttempts, modelCalls, maxModelCalls,
    tokensUsed, tokenBudget, deadlineAt, reportPath, lastFailure,
    events: events.slice(-8),
    next: phase === 'awaiting-approval'
      ? 'Tests passed: human must approve via authenticated project API'
      : ['accepted','needs-human','cancelled'].includes(phase) ? 'stop' : 'advance',
  });
}
export type AgentLoopAction =
  | { action: 'start'; goal: string; maxAttempts?: number; tokenBudget?: number;
      durationMinutes?: number }
  | { action: 'advance' }
  | { action: 'status' };

/** Per-process mutex; multi-worker durable locks are a later platform stage. */
export async function executeAgentLoop(
  root: string, command: AgentLoopAction, config?: AgentConfig,
): Promise<string> {
  if (active.has(root)) return JSON.stringify({ error: 'Agent loop is busy for this workspace' });
  active.add(root);
  try {
    if (command.action === 'status') return response(loadLoopState(root));
    if (command.action === 'start') {
      return response(beginLoop(root, command as LoopStartOptions));
    }
    if (!config) throw new Error('Agent configuration required to advance');
    return response(await advanceLoop(root, createProductionLoopDriver(root, config), config.signal));
  } catch (error) {
    return JSON.stringify({
      error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
    });
  } finally {
    active.delete(root);
  }
}
/**
 * Never expose these actions to the model's tool registry. Only the
 * session-capability-protected user endpoint calls them.
 */
export function executeHumanLoopDecision(root: string, action: 'approve'|'cancel'): string {
  if (active.has(root)) throw new Error('Agent loop is busy; decision deferred');
  active.add(root);
  try {
    return response(finishLoop(root, action));
  } finally {
    active.delete(root);
  }
}
