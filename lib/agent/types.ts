export interface AgentConfig {
  provider: 'deepseek' | 'openai' | 'claude';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  result: string;
  error?: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentResponse {
  message: string;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length';
}

export interface AgentSession {
  sendMessage(content: string): Promise<AgentResponse>;
  getHistory(): AgentMessage[];
  reset(): void;
}
