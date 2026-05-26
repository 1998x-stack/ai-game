import path from 'path';
import OpenAI from 'openai';
import {
  AgentConfig,
  AgentMessage,
  AgentResponse,
  AgentSession,
  StreamEvent,
  TokenUsage,
  ToolCall,
  ToolResult,
} from './types';
import { getOpenAITools, toolRegistry } from './tools';
import { CONFIG } from '@/lib/config';

function toOpenAIMessages(
  messages: AgentMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case 'system':
        return { role: 'system' as const, content: msg.content };
      case 'user':
        return { role: 'user' as const, content: msg.content };
      case 'assistant': {
        const result = {
          role: 'assistant' as const,
          content: msg.content || null,
          ...(msg.reasoning_content
            ? { reasoning_content: msg.reasoning_content }
            : {}),
        } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          result.tool_calls = msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        return result;
      }
      case 'tool':
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.tool_call_id ?? '',
        };
      default:
        return { role: 'user' as const, content: msg.content };
    }
  });
}

function fromOpenAIToolCalls(
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
): ToolCall[] {
  return toolCalls.map((tc) => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(tc.function.arguments);
    } catch {
      // Malformed JSON from LLM — use empty args; the tool execution will catch errors
    }
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: parsed,
    };
  });
}

export class DeepSeekAgent implements AgentSession {
  private config: AgentConfig;
  private systemPrompt: string;
  private workspaceRoot: string;
  private client: OpenAI;
  private messages: AgentMessage[];
  private maxIterations: number;
  private toolTimeout: number;

  constructor(
    config: AgentConfig,
    systemPrompt: string,
    workspaceRoot: string,
  ) {
    this.config = config;
    this.systemPrompt = systemPrompt;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.messages = [];
    this.maxIterations = config.maxIterations ?? CONFIG.agent.maxIterations;
    this.toolTimeout = config.toolTimeout ?? CONFIG.agent.toolTimeoutMs;

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || CONFIG.providers.deepseek.defaultBaseUrl,
    });
  }

  async sendMessage(content: string, signal?: AbortSignal): Promise<AgentResponse> {
    this.messages.push({ role: 'user', content });
    return this.agentLoop(undefined, signal);
  }

  async sendMessageStream(
    content: string,
    onEvent: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<AgentResponse> {
    this.messages.push({ role: 'user', content });
    return this.agentLoop(onEvent, signal);
  }

  private async agentLoop(
    onEvent?: (event: StreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<AgentResponse> {
    const allToolCalls: ToolCall[] = [];
    let finalMessage = '';
    let finishReason: AgentResponse['finishReason'] = 'stop';
    let reachedLimit = true;
    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      if (signal?.aborted) {
        finalMessage = 'Generation cancelled.';
        reachedLimit = false;
        break;
      }
      const openAIMessages = [
        { role: 'system' as const, content: this.systemPrompt },
        ...toOpenAIMessages(this.messages),
      ];

      const response = await this.createCompletion(openAIMessages, onEvent);

      if (response.usage) {
        totalUsage.promptTokens += response.usage.prompt_tokens;
        totalUsage.completionTokens += response.usage.completion_tokens;
        totalUsage.totalTokens += response.usage.total_tokens;
      }

      const choice = response.choices[0];
      const responseMessage = choice.message;

      const assistantContent = responseMessage.content ?? '';
      const reasoningContent =
        (responseMessage as unknown as Record<string, unknown>)
          .reasoning_content as string | undefined;

      if (reasoningContent) {
        onEvent?.({ type: 'reasoning', content: reasoningContent });
      }
      if (assistantContent) {
        onEvent?.({ type: 'message', content: assistantContent });
      }

      const agentMsg: AgentMessage = {
        role: 'assistant',
        content: assistantContent,
        reasoning_content: reasoningContent,
      };

      const hasToolCalls =
        responseMessage.tool_calls && responseMessage.tool_calls.length > 0;

      if (hasToolCalls) {
        const parsedCalls = fromOpenAIToolCalls(responseMessage.tool_calls!);
        agentMsg.tool_calls = parsedCalls;
        allToolCalls.push(...parsedCalls);

        for (const tc of parsedCalls) {
          onEvent?.({
            type: 'tool_call',
            name: tc.name,
            arguments: tc.arguments,
          });
        }
      }

      this.messages.push(agentMsg);

      if (!hasToolCalls) {
        finalMessage = assistantContent;
        finishReason =
          choice.finish_reason === 'length' ? 'length' : 'stop';
        reachedLimit = false;
        break;
      }

      const toolResults = await this.executeToolCalls(
        responseMessage.tool_calls!,
      );

      for (const result of toolResults) {
        this.messages.push({
          role: 'tool',
          content: result.error ? `Error: ${result.error}` : result.result,
          tool_call_id: result.id,
        });

        onEvent?.({
          type: 'tool_result',
          name: result.name,
          result: result.result,
          error: result.error,
        });
      }
    }

    if (reachedLimit) {
      finishReason = allToolCalls.length > 0 ? 'tool_calls' : 'length';
    }

    onEvent?.({ type: 'done' });

    return {
      message: finalMessage,
      toolCalls: allToolCalls,
      finishReason,
      usage: totalUsage.totalTokens > 0 ? totalUsage : undefined,
    };
  }

  private async executeToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const tc of toolCalls) {
      const id = tc.id;
      const name = tc.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        results.push({
          id,
          name,
          result: '',
          error: `Failed to parse arguments for tool "${name}": ${tc.function.arguments}`,
        });
        continue;
      }

      try {
        const result = await this.invokeTool(name, args);
        results.push({ id, name, result });
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error ? err.message : String(err);
        results.push({ id, name, result: '', error: errorMsg });
      }
    }

    return results;
  }

  private async invokeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const tool = toolRegistry.find((t) => t.definition.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return Promise.race([
      tool.handler(args, this.workspaceRoot, this.config),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${this.toolTimeout}ms`)), this.toolTimeout),
      ),
    ]);
  }

  private async createCompletion(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    onEvent?: (event: StreamEvent) => void,
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    try {
      return await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        tools: getOpenAITools(),
      });
    } catch (err) {
      const fallback = this.config.fallbackModel;
      if (!fallback || fallback === this.config.model) throw err;
      onEvent?.({
        type: 'message',
        content: `[Primary model unavailable, retrying with ${fallback}...]`,
      });
      return await this.client.chat.completions.create({
        model: fallback,
        messages,
        tools: getOpenAITools(),
      });
    }
  }

  getHistory(): AgentMessage[] {
    return [...this.messages];
  }

  loadHistory(messages: AgentMessage[]): void {
    this.messages = [...messages];
  }

  reset(): void {
    this.messages = [];
  }
}
