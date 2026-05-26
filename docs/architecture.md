# 系统架构

## 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│                      AI Game Studio                           │
├────────────┬─────────────────────────────────────────────────┤
│  前端 (React)                 │  后端 (Next.js API Routes)    │
│                              │                                │
│  ┌─────────────────────────┐ │  ┌─────────────────────────┐  │
│  │ ChatPanel (聊天面板)     │ │  │ /api/chat (Agent 聊天)   │  │
│  │ - Markdown 渲染          │ │  │ - 流式 SSE 输出          │  │
│  │ - 工具调用卡片           │ │  │ - Agent 循环管理         │  │
│  │ - 推理内容展示           │◀┼──│ - 系统提示词构建         │  │
│  └─────────────────────────┘ │  └─────────────────────────┘  │
│                              │                                │
│  ┌─────────────────────────┐ │  ┌─────────────────────────┐  │
│  │ GamePreview (游戏预览)   │ │  │ /api/preview (游戏服务)  │  │
│  │ - 沙箱 iframe            │◀┼──│ - CSP 安全头              │  │
│  │ - 全屏支持               │ │  │ - 文件系统回退           │  │
│  │ - 运行时错误捕获         │ │  └─────────────────────────┘  │
│  └─────────────────────────┘ │                                │
│                              │  ┌─────────────────────────┐  │
│  ┌─────────────────────────┐ │  │ /api/session (会话历史)  │  │
│  │ SettingsModal (配置)     │◀┼──│ - JSONL 持久化读取       │  │
│  └─────────────────────────┘ │  └─────────────────────────┘  │
│                              │                                │
│  ┌─────────────────────────┐ │                                │
│  │ ErrorConsole (错误面板)  │ │  ┌─────────────────────────┐  │
│  │ - 运行时错误展示         │ │  │ Agent SDK               │  │
│  │ - 自动展开               │ │  │ - 工厂模式              │  │
│  └─────────────────────────┘ │  │ - DeepSeek 适配器        │  │
└──────────────────────────────┘  │ - 6 个工具 (file+build)  │  │
                                  │ - 流式事件 (7 种类型)    │  │
                                  └────────────┬────────────┘  │
                                               │                │
                                  ┌────────────▼────────────┐  │
                                  │ 工作区管理器             │  │
                                  │ - 会话隔离               │  │
                                  │ - 脚手架复制             │  │
                                  │ - agent.md 生成          │  │
                                  │ - JSONL 持久化           │  │
                                  └────────────┬────────────┘  │
                                               │                │
                                  ┌────────────▼────────────┐  │
                                  │ 构建管道                 │  │
                                  │ - scripts/ → HTML        │  │
                                  │ - assets → base64        │  │
                                  │ - <script type="module"> │  │
                                  │ - 错误处理 + game-ready  │  │
                                  └─────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 核心数据流

### 游戏生成流程

```
用户输入 "Make a snake game"
  │
  ▼
ChatPanel → POST /api/chat { sessionId, message, stream: true, config }
  │
  ▼
Chat Route:
  1. 验证请求 (UUID, 消息长度, Provider, API Key)
  2. 创建/获取工作区 → createWorkspace(sessionId)
  3. 构建系统提示词 (Scaffold Docs + Gotchas + agent.md)
  4. 创建 Agent → createAgent(config, systemPrompt, workspacePath)
  5. 调用 agent.sendMessageStream(message, onEvent)
  │
  ▼
Agent Loop (最多 10 轮):
  每次迭代:
  a. 调用 DeepSeek API (带 tools 定义)
  b. 解析响应 → 提取 reasoning_content + tool_calls
  c. 执行工具 (read_file / write_file / edit_file / build_game / set_error)
  d. 发送 SSE 事件 (message, reasoning, tool_call, tool_result, build_result)
  e. 将工具结果发回 API, 继续循环
  f. 无工具调用时退出
  │
  ▼
after sendMessageStream:
  - appendToJsonl(sessionId, agent.getHistory())
  - 流关闭 (controller.close())
  │
  ▼
前端：
  - 解析 SSE 事件流
  - 实时更新消息列表 (reasoning → tool_call → tool_result → message)
  - build_result → 设置 gameUrl → iframe 加载预览
```

### 会话恢复流程

```
用户打开 /?session={sessionId}
  │
  ▼
HomeContent.useEffect:
  1. 读取 URL 参数 ?session=
  2. fetch /api/session/{sessionId}
  3. 解析 JSON → 恢复 messages[] + gameUrl
  4. 设置 sessionId 为 URL 参数 (后续消息使用同一会话)
  5. 显示 "restoring session" 加载动画
  │
  ▼
用户发送新消息 → POST /api/chat { sessionId, ... }
  │
Chat Route:
  - agentSessions.get(sessionId) → null (服务重启后)
  - createWorkspace → 创建新工作区
  - jsonlExists(sessionId) → true
  - readJsonl(sessionId) → 加载历史消息
  - agent.loadHistory(history) → 恢复上下文
  - 继续对话
```

## 模块关系

```
app/                    ← Next.js 页面 + API 路由
  ├── page.tsx          → dynamic(() => import('./HomeContent'), {ssr:false})
  ├── HomeContent.tsx   → 主状态管理 + 分割面板布局
  └── api/
      ├── chat/         → 依赖 lib/agent/, lib/workspace/, lib/scaffold/, lib/session-store/
      ├── build/        → 依赖 lib/build/
      ├── preview/      → 依赖 lib/workspace/
      └── session/      → 依赖 lib/session-store/

components/             ← React UI 组件
  ├── ChatPanel         → 聊天面板 + Markdown 渲染
  ├── GamePreview       → 沙箱 iframe + 全屏
  ├── SettingsModal     → API Key 配置
  └── ErrorConsole      → 运行时错误展示

lib/                    ← 核心业务逻辑
  ├── agent/            → Agent SDK (types → tools → factory → deepseek → index)
  ├── build/            → 构建管道 (packager.ts)
  ├── workspace/        → 工作区管理 (manager.ts)
  ├── scaffold/         → 脚手架读取 (reader.ts)
  └── session-store.ts  → JSONL 持久化

workspace/              ← 脚手架知识库 (Agent 的权威参考)
  ├── agent.md          → Agent 系统指令 (注入到系统提示词)
  ├── docs/             → 游戏开发文档
  ├── templates/        → 游戏模板
  ├── lib/              → 工具库 (utils.js + index.md)
  └── skills/           → 可复用技能文件
```

## 设计决策

| 决策 | 理由 |
|------|------|
| **工厂模式 Agent SDK** | 支持多 Provider 扩展 (DeepSeek/OpenAI/Claude) |
| **纯 HTML5 Canvas** | 零 WebAssembly，生成的游戏为独立 HTML 文件 |
| **逻辑工作区隔离** | 路径校验 + agent.md 约束。OS 级容器化 (v2) |
| **BYO-Key 架构** | 用户自带 API Key，服务端不存储 |
| **脚手架优先生成** | Agent 必须先读权威文档再生成代码 |
| **JSONL 持久化** | 文件级持久化优于数据库，直接可读，易于调试 |
| **SSE 流式输出** | 用户实时看到 Agent 的工具调用和推理过程 |
| **知识飞轮** | Utils + Gotchas + Skills 可自主扩展，质量持续提升 |
| **SSR-disabled 前端** | 页面依赖 browser API，使用 dynamic(ssr:false) |
