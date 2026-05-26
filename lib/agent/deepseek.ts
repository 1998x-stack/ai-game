import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import {
  AgentConfig,
  AgentMessage,
  AgentResponse,
  AgentSession,
  StreamEvent,
  ToolCall,
  ToolResult,
} from './types';
import { getOpenAITools } from './tools';

function validatePath(userPath: string, workspaceRoot: string): string {
  // Reject any path containing ".." regardless of encoding attempts
  if (userPath.includes('..')) {
    throw new Error(`Path traversal not allowed (contains ".."): ${userPath}`);
  }

  const resolved = path.resolve(workspaceRoot, userPath);

  // Use realpathSync to resolve symlinks — prevents symlink-based escape
  let realResolved: string;
  try {
    realResolved = fs.realpathSync(resolved);
  } catch {
    // Path doesn't exist yet (e.g. writing a new file) — use resolved form
    realResolved = path.resolve(resolved);
  }

  // Ensure workspaceRoot is trailed with separator to prevent prefix matching
  // e.g. "/workspace/abc" should not match "/workspace/abcdef/evil.js"
  const rootBoundary = workspaceRoot.endsWith(path.sep)
    ? workspaceRoot
    : workspaceRoot + path.sep;

  if (realResolved !== workspaceRoot && !realResolved.startsWith(rootBoundary)) {
    throw new Error(`Path is outside workspace root: ${userPath}`);
  }

  return resolved;
}

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
  private maxIterations: number = 10;

  constructor(
    config: AgentConfig,
    systemPrompt: string,
    workspaceRoot: string,
  ) {
    this.config = config;
    this.systemPrompt = systemPrompt;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.messages = [];

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.deepseek.com',
    });
  }

  async sendMessage(content: string): Promise<AgentResponse> {
    this.messages.push({ role: 'user', content });

    const allToolCalls: ToolCall[] = [];
    let finalMessage = '';
    let finishReason: AgentResponse['finishReason'] = 'stop';

    let reachedLimit = true;
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const openAIMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
        [
          { role: 'system', content: this.systemPrompt },
          ...toOpenAIMessages(this.messages),
        ];

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: openAIMessages,
        tools: getOpenAITools(),
      });

      const choice = response.choices[0];
      const responseMessage = choice.message;

      const agentMsg: AgentMessage = {
        role: 'assistant',
        content: responseMessage.content ?? '',
        reasoning_content:
          (responseMessage as unknown as Record<string, unknown>)
            .reasoning_content as string | undefined,
      };

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        const parsedCalls = fromOpenAIToolCalls(responseMessage.tool_calls);
        agentMsg.tool_calls = parsedCalls;
        allToolCalls.push(...parsedCalls);
      }

      this.messages.push(agentMsg);

      const hasToolCalls =
        responseMessage.tool_calls && responseMessage.tool_calls.length > 0;

      if (!hasToolCalls) {
        finalMessage = responseMessage.content ?? '';
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
      }
    }

    if (reachedLimit) {
      finishReason = allToolCalls.length > 0 ? 'tool_calls' : 'length';
    }

    return {
      message: finalMessage,
      toolCalls: allToolCalls,
      finishReason,
    };
  }

  async sendMessageStream(
    content: string,
    onEvent: (event: StreamEvent) => void,
  ): Promise<AgentResponse> {
    this.messages.push({ role: 'user', content });

    const allToolCalls: ToolCall[] = [];
    let finalMessage = '';
    let finishReason: AgentResponse['finishReason'] = 'stop';
    let reachedLimit = true;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const openAIMessages = [
        { role: 'system' as const, content: this.systemPrompt },
        ...toOpenAIMessages(this.messages),
      ];

      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: openAIMessages,
        tools: getOpenAITools(),
      });

      const choice = response.choices[0];
      const responseMessage = choice.message;

      const assistantContent = responseMessage.content ?? '';
      const reasoningContent =
        (responseMessage as unknown as Record<string, unknown>)
          .reasoning_content as string | undefined;

      if (reasoningContent) {
        onEvent({ type: 'reasoning', content: reasoningContent });
      }
      if (assistantContent) {
        onEvent({ type: 'message', content: assistantContent });
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
          onEvent({
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

        onEvent({
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

    onEvent({ type: 'done' });

    return {
      message: finalMessage,
      toolCalls: allToolCalls,
      finishReason,
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
    switch (name) {
      case 'read_file': {
        const safePath = validatePath(
          String(args.path),
          this.workspaceRoot,
        );
        return fs.readFileSync(safePath, 'utf-8');
      }

      case 'write_file': {
        const safePath = validatePath(
          String(args.path),
          this.workspaceRoot,
        );
        const content = String(args.content);
        fs.mkdirSync(path.dirname(safePath), { recursive: true });
        fs.writeFileSync(safePath, content, 'utf-8');
        return `Successfully wrote ${safePath}`;
      }

      case 'edit_file': {
        const safePath = validatePath(
          String(args.path),
          this.workspaceRoot,
        );
        const oldStr = String(args.old_str);
        const newStr = String(args.new_str);
        const currentContent = fs.readFileSync(safePath, 'utf-8');
        const idx = currentContent.indexOf(oldStr);
        if (idx === -1) {
          throw new Error(
            `Could not find old_str in ${safePath}. The text was not found.`,
          );
        }
        const updatedContent =
          currentContent.slice(0, idx) +
          newStr +
          currentContent.slice(idx + oldStr.length);
        fs.writeFileSync(safePath, updatedContent, 'utf-8');
        return `Successfully edited ${safePath}`;
      }

      case 'list_directory': {
        const safePath = validatePath(
          String(args.path),
          this.workspaceRoot,
        );
        const entries = fs.readdirSync(safePath, { withFileTypes: true });
        const listing = entries.map((entry) =>
          entry.isDirectory() ? `${entry.name}/` : entry.name,
        );
        return listing.join('\n');
      }

      case 'build_game': {
        const { buildGame } = await import('@/lib/build/packager');
        const result = buildGame(this.workspaceRoot);
        if (result.errors.length > 0) {
          return `Build completed with warnings: ${result.errors.join('; ')}`;
        }
        return `Game built successfully. Open index.html to play.`;
      }

      case 'set_error': {
        const message = String(args.message);
        return message;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
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
