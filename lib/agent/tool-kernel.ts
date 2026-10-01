import type { AgentConfig, ToolHandler } from './types';
import { CONFIG } from '@/lib/config';

export type ToolRole = 'master' | 'subagent';

export async function executeTool(
  registry: readonly ToolHandler[],
  name: string,
  args: Record<string, unknown>,
  root: string,
  config: AgentConfig | undefined,
  role: ToolRole,
  timeoutMs: number,
): Promise<string> {
  if (!CONFIG.tools.allowed[role].includes(name)) {
    throw new Error(`Tool "${name}" is not permitted for role ${role}`);
  }
  const entry = registry.find((candidate) => candidate.definition.name === name);
  if (!entry) throw new Error(`Unknown tool: ${name}`);
  if (config?.signal?.aborted) throw new Error(`Tool "${name}" was cancelled`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([entry.handler(args, root, config), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
