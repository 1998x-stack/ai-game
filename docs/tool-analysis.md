# 工具系统分析

## 概述

AI Game Studio 的工具系统是 Agent 与工作区交互的唯一通道。Agent 通过函数调用 (function calling) 机制使用工具来读取文档、编写代码、搜索文件、构建游戏以及委托子任务。所有工具定义在 `lib/agent/tools.ts` 中，通过 `toolRegistry` 统一注册。

**当前工具数量**: 10 个（9 个主工具 + 1 个子代理工具）

## 架构

```
lib/agent/
├── types.ts          # ToolDefinition, ToolHandler, ToolCall, ToolResult
├── tools.ts          # 10 个工具的定义 + 处理函数 + toolRegistry
├── deepseek.ts       # Agent 循环: sendMessage → agentLoop → invokeTool
├── factory.ts        # createAgent(provider, config, prompt, root)
└── index.ts          # 统一导出
```

### 三层注册模式

```
types.ts
  ToolDefinition { name, description, parameters }
  ToolHandler    { definition, handler( args, root, config? ) }

tools.ts
  定义每个工具的 ToolDefinition + async handler
  注册到 toolRegistry: ToolHandler[]
  自动派生 tools: ToolDefinition[] 和 getOpenAITools()

deepseek.ts
  agentLoop() → 发送 tools 给 LLM → 接收 tool_calls
  executeToolCalls() → 逐个解析参数
  invokeTool() → toolRegistry.find(name) → handler(args, root, config)
```

### 调用链路

```
用户消息
  ↓
chat/route.ts → agent.sendMessageStream(message, onEvent)
  ↓
DeepSeekAgent.agentLoop(onEvent)
  ├─ 构建 OpenAI 消息 (system + history)
  ├─ 调用 API (model + messages + getOpenAITools())
  ├─ 解析响应:
  │   ├─ reasoning_content → onEvent('reasoning')
  │   ├─ text content      → onEvent('message')
  │   └─ tool_calls        → onEvent('tool_call')
  │       └─ executeToolCalls()
  │           └─ invokeTool(name, args)
  │               └─ toolRegistry.find(name).handler(args, root, config)
  │                   └─ Promise.race([handler, timeout])
  ├─ 工具结果 → onEvent('tool_result') → push 到消息历史
  └─ 循环 (最多 10 次迭代)
```

## 工具清单

### 1. read_file

读取工作区内的文件内容，支持行号偏移和行数限制。默认限制 2000 行。

| 属性 | 值 |
|------|-----|
| 参数 | `path` (必填), `offset` (选填, 1-based), `limit` (选填, 默认 2000) |
| 安全性 | 通过 `validatePath()` 四层校验 |
| 返回 | 文件内容 (含行号范围提示) |

### 2. write_file

写入新文件，自动创建父目录。默认禁止覆盖已有文件，需设置 `overwrite: true` 强制覆盖。

| 属性 | 值 |
|------|-----|
| 参数 | `path` (必填), `content` (必填), `overwrite` (选填, 默认 false) |
| 安全性 | 通过 `validatePath()` 四层校验 |

### 3. edit_file

在文件中查找并替换文本。`old_str` 必须在文件中匹配**恰好一次**——多重匹配时拒绝修改并返回所有匹配行号，引导 Agent 扩展 `old_str` 以唯一标识目标位置。

| 属性 | 值 |
|------|-----|
| 参数 | `path` (必填), `old_str` (必填), `new_str` (必填) |
| 安全性 | 通过 `validatePath()` 四层校验 |
| 注意 | 多重匹配时抛出异常 (含行号)；零匹配时提示检查空白字符 |

### 4. list_directory

列出目录内容，通过 `formatDirectoryListing()` 函数代码级保证输出格式：每行一个条目，目录名以 `/` 结尾，文件名无后缀。

| 属性 | 值 |
|------|-----|
| 参数 | `path` (必填) |
| 返回 | 每行一个条目，目录以 `/` 结尾 (代码级确定性) |

### 5. grep_file

使用 ripgrep (`rg`) 进行快速搜索，自动跳过 `output/` 和 `node_modules`。rg 不可用时自动回退到 JS 实现。

| 属性 | 值 |
|------|-----|
| 参数 | `path` (必填), `pattern` (必填, ripgrep 语法), `context` (选填, 上下文行数) |
| 返回 | 匹配行, 格式: `文件路径:行号: 内容` |
| 性能 | ripgrep (原生速度) + JS fallback |

### 6. build_game

触发构建流水线。输出结构化结果：`BUILD SUCCESS` / `BUILD FAILED with N error(s): 1. ...` / `BUILD CRASHED: ...`。包裹在 try/catch 中防止未捕获异常。

| 属性 | 值 |
|------|-----|
| 参数 | 无 |
| 处理函数 | 调用 `buildGame(root)` → 返回结构化构建结果 |
| 副作用 | Chat Route 检测到 `build_game` 调用后发送 `build_result` SSE 事件 |
| 输出 | `output/index.html` |

### 7. load_skills

扫描 `skills/examples/` 目录并自动包含内置 `skill-creator.md` 技能，返回可用技能列表（含名称、描述、触发关键词）。

| 属性 | 值 |
|------|-----|
| 参数 | 无 |
| 返回 | JSON 数组: `[{file, name, description, triggers}]` |
| 内置技能 | `skill-creator.md` 始终在列表首位 |

### 8. write_todo

接收 JSON 任务数组 `[{task, status}]`，自动格式化为 Markdown 复选框清单写入 `todo.md`。返回进度摘要："N done, M pending, next: task name"。

| 属性 | 值 |
|------|-----|
| 参数 | `tasks` (必填, `[{task: string, status: "pending"|"done"}]`) |
| 返回 | `"Plan written to todo.md: N done, M pending, next: 'task name'"` |

### 9. set_error

向用户报告不可恢复的错误。

| 属性 | 值 |
|------|-----|
| 参数 | `message` (必填) |
| 用途 | Agent 遇到无法自行解决的问题时调用 |

### 10. delegate_subagent

委托研究或探索任务给子代理（最多 3 个并发）。子代理拥有受限工具集，独立运行并返回结果摘要。详见下方子代理系统章节。

| 属性 | 值 |
|------|-----|
| 参数 | `instruction` (必填, 研究指令) |
| 限制 | 每会话最多 3 个并发子代理 |
| 子代理工具 | `read_file`, `write_file`, `grep_file`, `list_directory` |
| 最大迭代 | 5 轮 API 调用 |

## 安全性：路径校验

所有文件操作工具（`read_file`, `write_file`, `edit_file`, `list_directory`, `grep_file`）都通过 `validatePath()` 进行四层防御：

```
validatePath(userPath, workspaceRoot)
  │
  ├─ 第 1 层: 拒绝包含 ".." 的路径
  │     if (userPath.includes('..')) → throw
  │
  ├─ 第 2 层: 验证工作区根路径在 user_space/ 下
  │     if (!rootSegments.includes('user_space')) → throw
  │
  ├─ 第 3 层: 解析后路径边界检查
  │     path.resolve(workspaceRoot, userPath)
  │     realpathSync(resolved) 或 fallback resolve
  │     检查是否在 workspaceRoot 内 (使用 path.sep 边界)
  │
  └─ 第 4 层: 符号链接解析
        fs.realpathSync(resolved)
        防止通过符号链接逃逸工作区
```

## 子代理系统

### 设计动机

某些任务（如读取文档、搜索代码模式、收集上下文信息）信噪比低——Agent 需要大量工具调用但无需高层决策。`delegate_subagent` 将这些任务卸载到独立的子代理，释放主 Agent 进行游戏设计和代码生成。

### 子代理能力边界

```
主 Agent 工具集 (10 个)：
  ✅ read_file      ✅ write_file     ✅ edit_file
  ✅ list_directory ✅ grep_file      ✅ build_game
  ✅ load_skills    ✅ write_todo     ✅ set_error
  ✅ delegate_subagent

子代理工具集 (4 个)：
  ✅ read_file      ✅ write_file
  ✅ grep_file      ✅ list_directory
  ❌ build_game     ❌ write_todo     ❌ set_error
  ❌ edit_file      ❌ load_skills    ❌ delegate_subagent (防止递归)
```

### 执行流程

```
主 Agent 调用 delegate_subagent(instruction: "搜索所有碰撞检测模式")
  │
  ▼
delegateSubagentHandler(args, root, config)
  │
  ├─ 检查 subagentCounters[root] < 3 ?
  │   ├─ 否 → 返回错误: "Maximum 3 subagents already active"
  │   └─ 是 → 计数器 +1, 继续
  │
  ├─ 创建临时 OpenAI 客户端 (使用主 Agent 的 API key/model)
  │
  ├─ 子代理循环 (最多 5 次迭代):
  │   ├─ API 调用 (system: 研究提示词, user: instruction, tools: 4 个)
  │   ├─ 文本响应 (无工具调用) → 返回结果
  │   └─ 工具调用 → 执行对应 handler → 结果加入消息 → 继续循环
  │
  └─ finally: 计数器 -1
```

### 并发控制

子代理计数器按工作区根路径 (`workspaceRoot`) 隔离，不同会话的子代理互不影响：

```
会话 A (workspace-A): 3 个子代理运行中 → 新请求被拒绝
会话 B (workspace-B): 0 个子代理运行中 → 新请求正常执行
```

### 错误处理

- **API 调用失败**: 错误消息自动脱敏 (API key 替换为 `[REDACTED]`)，返回 `"Subagent error: ..."`
- **迭代超限**: 5 轮后仍未产生文本响应，返回 `"(subagent reached maximum iterations...)"`
- **计数器泄露保护**: `finally` 块确保即使子代理崩溃，计数器也会正确递减

## 添加新工具

添加工具的步骤（仅需修改 `tools.ts`）：

```typescript
// 1. 定义工具 (JSON Schema)
const myToolDef: ToolDefinition = {
  name: 'my_tool',
  description: '工具描述 — LLM 根据此描述决定何时调用',
  parameters: {
    type: 'object',
    properties: {
      arg1: { type: 'string', description: '参数说明' },
    },
    required: ['arg1'],
    additionalProperties: false,
  },
};

// 2. 实现处理函数
async function myToolHandler(
  args: Record<string, unknown>,
  root: string,
  config?: AgentConfig,
): Promise<string> {
  const val = String(args.arg1);
  // ... 业务逻辑 ...
  return '结果字符串 (返回给 LLM)';
}

// 3. 注册到 toolRegistry
export const toolRegistry: ToolHandler[] = [
  // ... 现有工具 ...
  { definition: myToolDef, handler: myToolHandler },
];
```

无需修改其他文件 — `tools` 数组和 `getOpenAITools()` 自动从 `toolRegistry` 派生。

### 处理函数签名

```typescript
type ToolHandlerFn = (
  args: Record<string, unknown>,  // LLM 传入的已解析参数
  workspaceRoot: string,           // 当前工作区根路径
  config?: AgentConfig,            // Agent 配置 (API key, model 等)
) => Promise<string>;              // 返回结果字符串 (显示给 LLM)
```

- `config` 参数为可选，仅在需要访问 API 凭证的工具中使用（如 `delegate_subagent`）
- 所有路径参数必须通过 `validatePath()` 校验
- 处理函数在 `Promise.race` 中运行，默认超时 30 秒

## 测试覆盖

工具系统测试位于 `__tests__/api.test.ts`（75 个测试用例），覆盖四个维度：

### toolRegistry 测试 (4 个用例)
- 工具注册完整性（所有工具都在注册表中）
- 参数 schema 正确性（必填参数校验）
- 名称唯一性（无重复名称）
- 处理函数可用性（所有 handler 都是函数）

### 工具处理函数单元测试 (14 个用例)
- `read_file`: 默认 2000 行限制、显式 limit
- `write_file`: 覆写保护、force overwrite
- `edit_file`: 多重匹配检测 (含行号)、零匹配
- `write_todo`: JSON 任务数组、全部完成、校验
- `build_game`: BUILD SUCCESS / FAILED / CRASHED
- `load_skills`: skill-creator 内置加载、优雅降级
- `validatePath`: user_space/ 校验

### delegate_subagent 处理函数测试 (11 个用例)
- 输入校验（缺少 config、空指令）
- 并发限制（3 个上限，跨工作区隔离）
- 正常委托（纯文本响应、带工具调用的多轮交互）
- 错误处理（API 失败、密钥脱敏、迭代超限）
- 计数器生命周期（成功/失败后递减）

### API 集成测试 (Chat Route)
- 请求校验（缺少字段、无效 UUID、超长消息）
- 正常响应（非流式、流式 SSE）
- 构建结果（`build_game` 后的 `buildResult` 事件）
- 会话复用（已有 Agent 时跳过创建）
