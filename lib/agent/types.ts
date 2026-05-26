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
  reasoning_content?: string;
}

export interface AgentResponse {
  message: string;
  toolCalls: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length';
}

export type StreamEvent =
  | { type: 'message'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string; error?: string }
  | { type: 'build_result'; previewUrl: string; success: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface AgentSession {
  sendMessage(content: string): Promise<AgentResponse>;
  sendMessageStream(
    content: string,
    onEvent: (event: StreamEvent) => void,
  ): Promise<AgentResponse>;
  getHistory(): AgentMessage[];
  loadHistory(messages: AgentMessage[]): void;
  reset(): void;
}
