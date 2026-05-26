# API 接口参考

## 概述

所有 API 路由位于 `app/api/` 下，使用 Next.js 14 App Router。

## POST /api/chat

Agent 聊天接口，支持流式 (SSE) 和非流式两种模式。

### 请求

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Make a snake game",
  "stream": true,
  "config": {
    "provider": "DeepSeek",
    "apiKey": "sk-...",
    "model": "deepseek-v4-pro",
    "baseUrl": "https://api.deepseek.com"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | ✅ | UUID 格式会话 ID |
| `message` | string | ✅ | 用户消息 (最大 50,000 字符) |
| `stream` | boolean | ❌ | 是否使用 SSE 流式 (默认 false) |
| `config.provider` | string | ✅ | DeepSeek / OpenAI / Claude |
| `config.apiKey` | string | ✅ | API Key |
| `config.model` | string | ✅ | 模型名称 |
| `config.baseUrl` | string | ✅ | API 端点 URL |

### 非流式响应

```json
{
  "reply": "I've created the snake game! Play on the right →",
  "toolCalls": [
    { "name": "read_file", "arguments": { "path": "scripts/utils.js" } },
    { "name": "write_file", "arguments": { "path": "scripts/game.js", "content": "..." } },
    { "name": "build_game", "arguments": {} }
  ],
  "buildResult": {
    "previewUrl": "/api/preview/550e8400-...",
    "success": true
  }
}
```

| 字段 | 说明 |
|------|------|
| `reply` | Agent 最终文本回复 |
| `toolCalls` | 所有工具调用记录 |
| `buildResult` | 构建结果 (仅当调用了 build_game 时) |

### 流式 (SSE) 响应

```
Content-Type: text/event-stream

data: {"type":"reasoning","content":"Let me check available skills..."}

data: {"type":"tool_call","name":"load_skills","arguments":{}}

data: {"type":"tool_result","name":"load_skills","result":"[...]"}

data: {"type":"reasoning","content":"I'll use pixel-art-games skill"}

data: {"type":"tool_call","name":"read_file","arguments":{"path":"skills/examples/pixel-art-games.md"}}

data: {"type":"tool_result","name":"read_file","result":"..."}

data: {"type":"tool_call","name":"write_file","arguments":{"path":"scripts/game.js","content":"..."}}

data: {"type":"tool_result","name":"write_file","result":"Successfully wrote..."}

data: {"type":"tool_call","name":"build_game","arguments":{}}

data: {"type":"tool_result","name":"build_game","result":"Game built successfully"}

data: {"type":"build_result","previewUrl":"/api/preview/550e8400-...","success":true}

data: {"type":"message","content":"I've created the pixel art shooter!"}

data: {"type":"done"}
```

### 错误响应

| 状态码 | 场景 |
|--------|------|
| 400 | 缺少必填字段、无效 UUID、消息过长、不支持的 Provider |
| 500 | 服务端错误 (Agent 循环异常、API 调用失败) |

## POST /api/build

手动触发构建 (不经过 Agent 对话)。

### 请求

```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

### 响应

```json
{
  "success": true,
  "previewUrl": "/api/preview/550e8400-...",
  "errors": []
}
```

## GET /api/preview/[sessionId]

提供构建好的游戏 HTML 文件。

### 响应

- `200` — 返回 `text/html`，带安全头
- `404` — 会话不存在或构建输出不存在

### 安全头

```
Content-Type: text/html
Cache-Control: no-cache
X-Frame-Options: SAMEORIGIN
Content-Security-Policy: default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:
```

**HMR 容错**: 优先从内存 Map 读取工作区路径，如果 Map 被 Next.js HMR 清除，则从文件系统直接构建路径回退。

## GET /api/session/[sessionId]

获取会话完整历史。

### 响应

```json
{
  "sessionId": "550e8400-...",
  "source": "jsonl",
  "createdAt": "2026-05-26T12:00:00.000Z",
  "gameUrl": "/api/preview/550e8400-...",
  "gameFiles": ["utils.js", "game.js"],
  "messages": [
    { "role": "user", "content": "Make a snake game" },
    { "role": "assistant", "content": "Let me read the scaffold...", "tool_calls": [...] }
  ],
  "toolCalls": [
    { "name": "read_file", "arguments": { "path": "scripts/utils.js" } }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `source` | `"jsonl"` (从文件读取) 或 `"memory"` (从内存读取) |
| `messages` | 用户和 Agent 消息历史 |
| `toolCalls` | 所有工具调用汇总 |
| `gameUrl` | 预览 URL (如果有构建输出) |
| `gameFiles` | scripts/ 中的 JS 文件列表 |

## 验证规则

所有路由共享的验证规则：

| 规则 | 适用路由 | 说明 |
|------|---------|------|
| UUID 格式 | chat, preview, session | `/^[0-9a-f-]{36}$/i` — 防止路径穿越 |
| 消息长度 | chat | 最大 50,000 字符 — 防止 API 滥用 |
| Provider 白名单 | chat | 仅 deepseek / openai / claude |
| API Key 必填 | chat | 不存储，每次请求携带 |
| API Key 脱敏 | chat (错误响应) | 自动从错误消息中移除 |
