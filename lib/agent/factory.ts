import { AgentConfig, AgentSession } from './types';
import { DeepSeekAgent } from './deepseek';

export function createAgent(
  config: AgentConfig,
  systemPrompt: string,
  workspaceRoot: string,
): AgentSession {
  const provider = config.provider.toLowerCase();
  switch (provider) {
    case 'deepseek':
      return new DeepSeekAgent(config, systemPrompt, workspaceRoot);
    default:
      throw new Error(
        `Unsupported provider: "${config.provider}". Supported providers: deepseek`,
      );
  }
}
