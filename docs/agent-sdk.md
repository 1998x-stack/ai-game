# Agent SDK

## 概述

Agent SDK 是 AI Game Studio 的核心引擎，负责将用户的自然语言请求转化为游戏代码。采用工厂模式设计，当前支持 DeepSeek API（OpenAI 兼容），可扩展至 Claude、OpenAI 等 Provider。

## 架构

```
lib/agent/
├── types.ts        # 类型定义
├── tools.ts        # 工具定义 (6 个工具)
├── factory.ts      # Provider 工厂
├── deepseek.ts     # DeepSeek 适配器
└── index.ts        # 统一导出
```

## 核心接口

### AgentSession

```typescript
interface AgentSession {
  sendMessage(content: string): Promise<AgentResponse>;
  sendMessageStream(content: string, onEvent: (event: StreamEvent) => void): Promise<AgentResponse>;
  getHistory(): AgentMessage[];
  loadHistory(messages: AgentMessage[]): void;
  reset(): void;
}
```

### StreamEvent (7 种事件类型)

```typescript
type StreamEvent =
  | { type: 'message'; content: string }           // Agent 文本输出
  | { type: 'reasoning'; content: string }          // 推理链 (DeepSeek thinking)
  | { type: 'tool_call'; name: string; arguments }  // 工具调用
  | { type: 'tool_result'; name: string; result }   // 工具结果
  | { type: 'build_result'; previewUrl; success }   // 构建完成
  | { type: 'error'; message: string }              // 错误
  | { type: 'done' }                                // 流程结束
```

## 工具系统 (6 个工具)

| 工具 | 参数 | 用途 |
|------|------|------|
| `read_file` | `path` | 读取工作区内的文件 |
| `write_file` | `path`, `content` | 写入/覆盖文件 |
| `edit_file` | `path`, `old_str`, `new_str` | 替换文件中的文本 |
| `list_directory` | `path` | 列出目录内容 |
| `build_game` | *(无)* | 触发构建打包 |
| `load_skills` | *(无)* | 扫描并加载可用技能 |

所有文件操作工具的路径都经过 `validatePath()` 校验 — 三层防御：
1. 拒绝包含 `..` 的路径
2. 检查解析后路径在工作区根目录内（使用 `path.sep` 边界检查）
3. 通过 `realpathSync` 解析符号链接

## Agent 循环

```
sendMessageStream(content, onEvent)
  │
  ▼
messages.push({role:'user', content})
  │
  ▼
for iteration in 0..9:
  │
  ├─→ DeepSeek API call (messages + tools)
  │     │
  │     ├─ reasoning_content? → onEvent({type:'reasoning', ...})
  │     ├─ assistant text?     → onEvent({type:'message', ...})
  │     └─ tool_calls?         → onEvent({type:'tool_call', ...}) for each
  │           │
  │           ├─ executeToolCall() for each
  │           │   └─ invokeTool(name, args) → returns string
  │           │       └─ onEvent({type:'tool_result', ...})
  │           │
  │           └─ push tool result messages
  │               → continue loop
  │
  └─ no tool_calls → break
       │
       └─ reachedLimit?
            ├─ yes → finishReason = 'tool_calls' | 'length'
            └─ no  → finishReason = 'stop'
  │
  ▼
onEvent({type:'done'})
return { message, toolCalls, finishReason }
```

## 关键特性

### reasoning_content 保留

DeepSeek 推理模型（包括 `deepseek-v4-pro`）返回 `reasoning_content`，必须在后续多轮调用中原样回传。Agent SDK 在三个地方处理：

1. `AgentMessage` 类型有 `reasoning_content?: string`
2. `sendMessage()` 从 API 响应中捕获
3. `toOpenAIMessages()` 在回传时包含

### Provider 名称规范化

前端发送大写的 Provider 名称（`'DeepSeek'`），工厂期望小写（`'deepseek'`）。Chat Route 在传递给工厂前统一转小写。

### 最大迭代次数

Agent 循环限制为 10 次迭代，防止死循环。达到上限时 `finishReason` 设为 `'tool_calls'`（如有未处理的工具调用）或 `'length'`。

## 扩展新 Provider

```typescript
// 1. 实现 AgentSession 接口
export class ClaudeAgent implements AgentSession {
  constructor(config: AgentConfig, systemPrompt: string, workspaceRoot: string) { ... }
  async sendMessage(content: string): Promise<AgentResponse> { ... }
  async sendMessageStream(content: string, onEvent): Promise<AgentResponse> { ... }
  getHistory(): AgentMessage[] { ... }
  loadHistory(msgs: AgentMessage[]): void { ... }
  reset(): void { ... }
}

// 2. 在 factory.ts 中注册
case 'claude':
  return new ClaudeAgent(config, systemPrompt, workspaceRoot);

// 3. 在 ALLOWED_PROVIDERS 中添加
const ALLOWED_PROVIDERS = new Set(['deepseek', 'openai', 'claude']);

// 4. 在 SettingsModal 中添加选项
<option value="Claude">Claude</option>
```
