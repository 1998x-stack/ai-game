# AI Game Studio 稳定性与安全整改 Spec

**状态**：Implemented
**范围**：安全边界、会话一致性、Agent 工具执行、构建管线、Game Runtime、测试与文档

## 1. 背景与目标

当前系统链路为：

```text
React UI → API Routes → AgentSession → Tool Registry
                                  ├─ Workspace / JSONL
                                  ├─ Build Pipeline
                                  ├─ Game Runtime
                                  └─ Git / GitHub
```

审查发现三类核心风险：不可信输入可抵达 shell、会话状态在内存/JSONL/磁盘间不一致、Runtime 和 SSE 的生命周期没有明确的所有权。

本 Spec 的目标是：

1. 消除服务端命令注入、Token 持久化和跨会话访问风险。
2. 让同一 Session 的消息、Workspace 和 SSE 请求具备串行且可恢复的语义。
3. 让构建和 Runtime 结果能区分“成功、失败、未完成”。
4. 建立可测试的模块 Seam，减少路由和 `tools.ts` 中的隐式耦合。

## 2. 非目标

- 本阶段不实现完整 OAuth；GitHub 仍采用 BYO Token，但 Token 不得写入 Git remote。
- 本阶段不实现 OS 容器化。ADR-0001 的逻辑隔离取舍继续有效，但所有已知逻辑绕过必须修复。
- 不扩展新的 LLM Provider；在 Adapter 未实现前，UI 和配置只声明 DeepSeek。

## 3. 设计要求

### 3.1 安全边界

- `github_push` 使用参数化进程调用，不允许拼接 shell 字符串。
- `repoName` 只允许合法仓库名：`^[A-Za-z0-9_.-]+$`；owner 不由用户传入。
- 使用临时凭据或 `GIT_ASKPASS` 推送，完成后 remote 不得包含 Token。
- 文件工具拒绝 `.git/`、`.gitmodules`、`.gitattributes`、`.gitconfig` 等敏感路径。
- `validatePath` 必须校验 Workspace 根目录和父目录真实路径；创建新文件时也要防止父级符号链接，并尽量使用原子创建/打开。
- `baseUrl` 只能匹配 Provider allowlist；默认只允许 `https://api.deepseek.com` 及显式配置的安全 endpoint。
- Session 使用服务端签发的 capability/ownership 凭据。URL 中的 UUID 只能定位 Session，不能单独授权 `/api/session`、`/api/preview` 或 `/api/chat`。

### 3.2 Session Module

新增一个负责 Session 生命周期的深 Module，路由不得直接组合三套状态源。其 Interface 至少提供：

```text
load(sessionId)
withLock(sessionId, operation)
appendDelta(sessionId, messages)
restoreWorkspace(sessionId)
snapshot(sessionId)
```

要求：

- 同一 Session 的 Agent 请求串行执行；不同 Session 可以并行。
- 持久化只追加本轮新增消息，不能重复写入完整历史。
- JSONL 设置最大字节数、消息数和单消息大小；超过限制时执行明确的 compaction 或返回可操作错误。
- 恢复时验证 JSONL 格式，损坏记录不能导致整条请求静默变成空历史。
- Workspace 淘汰不能删除 active Session；重启后的磁盘 Workspace 必须纳入配额和清理策略。

### 3.3 Tool Execution Kernel

将 `lib/agent/tools.ts` 拆成：工具定义、输入校验、权限策略、执行 Adapter、结果协议五个 Module。Kernel 在执行层再次校验权限，不能只依赖模型可见的 Schema。

每个工具必须声明：

- 输入 Schema 和范围限制
- 所需 Role/Capability
- 是否有副作用
- 超时和取消策略
- 结构化成功/失败结果

所有 LLM、Playwright 和副作用工具必须共享 `AbortSignal`。超时必须真正取消底层操作，或将工具标记为不可重入并等待其结束。

Provider Registry 必须成为单一事实源：Factory、UI、配置和 API 校验只能暴露已实现的 Adapter。

### 3.4 SSE 与构建结果

- `build_game` 返回结构化 `{ success, outputPath, errors, buildId }`，调用方不能通过“文件存在”推断成功。
- 构建事件必须被 `await`，SSE controller 关闭前完成所有待发送事件。
- SSE 和非流式错误统一经过 `redactSecrets`。
- 前端请求保存 `AbortController` 和 Session 快照；New Game 时取消旧请求，并拒绝旧请求更新当前 UI。
- SSE 事件顺序固定为：`tool_call → tool_result → build_result → done`，并增加真实消费 SSE body 的测试。

### 3.5 Build Pipeline

- 对每个 module script 进行语法解析，语法错误必须让构建失败。
- 内联脚本必须经过 script-safe 编码，确保任意 `</script>` 字符串不会截断 HTML。
- 增加单文件资产、总资产和最终 HTML 大小上限。
- 初始化失败时不得发送 `game-ready`；只有实际完成初始化的启动入口才能发送 ready。
- Build Pipeline 仍保持 `utils.js → game.js/main.js → alphabetical` 的加载契约，并固定 `gameCanvas`。

### 3.6 Runtime Test Engine

将 Runtime 深化为独立 Interface：

```text
analyze → plan → acquire lease → execute → observe
        → evaluate rules → report → release lease
```

- BrowserPool 返回带有 `release()` 的 Page lease；release 必须关闭 Page。
- 只淘汰 idle Browser，禁止关闭 active Page；使用队列/信号量确保实例上限严格生效。
- 校验 `1 <= maxSteps <= configuredMax`、`fps > 0`，执行总 deadline 和 API call budget。
- 模板场景必须先完成菜单启动动作。
- 测试结果必须区分 `passed`、`failed`、`incomplete`；AI 调用失败不能报告为 “No issues detected”。
- 修复 module scope 状态采集，或由 Scaffold 明确提供受控的 runtime observation Adapter。
- 修复 frame-time p99 的计算来源，并在没有内存 API 时报告 `unsupported`，不能返回全零。

## 4. 验收标准

### 安全

- 恶意 `repoName` 不会执行额外命令，且测试覆盖 shell 元字符。
- `.git/config`、Git hooks 和外部 filter 无法由 Agent 文件工具修改。
- GitHub push 完成后，工作区 remote 和提交内容均不包含 PAT。
- 未持有 Session capability 的请求访问历史、预览和聊天接口均返回 401/403。
- 符号链接父目录和越界 `baseUrl` 测试均被拒绝。

### 一致性与正确性

- 连续三轮对话后 JSONL 只包含每条消息一次，恢复后消息数量和顺序不变。
- 同一 Session 的并发请求被串行化；不同 Session 不互相阻塞。
- 构建失败时不会复用旧 `output/index.html` 作为成功结果。
- SSE 流能稳定收到 `build_result`，错误信息不包含 API Key。
- New Game 后旧请求不能更新新 Session 的 UI 或 Workspace。

### Runtime 与工程质量

- 并发 Runtime 测试不会关闭其他 active Page，Page 数量不会无限增长。
- `fps <= 0`、超大 `maxSteps`、API 超时和浏览器崩溃都有确定结果。
- `npm ci && npm test && npm run lint && npm run build` 在干净环境通过。
- 新增 Packager、Session Store、BrowserPool、Factory、GitHub 安全和 SSE 集成测试。
- README、API 文档、架构图和 ADR 与实际工具数量、Provider 和 Runtime 能力一致。

## 5. 实施顺序

1. 安全热修复：GitHub 参数化调用、Token 清理、禁止 `.git`、Provider/baseUrl allowlist。
2. Session Module：锁、增量 JSONL、配额、Workspace active 保护和 capability 校验。
3. SSE/Build：结构化构建结果、事件生命周期、脱敏、请求取消和旧产物隔离。
4. Runtime Engine：Page lease、并发上限、deadline、场景启动和结果语义。
5. 测试与文档：补齐真实 Seam 测试，最后同步 README、API 文档和 ADR。

每个阶段必须先增加失败测试，再实现修复；禁止以大范围重构替代行为验收。

## 6. 架构收益

完成后，Session、Tool Execution Kernel 和 Runtime Test Engine 都将成为更深的 Module：调用方只需依赖稳定 Interface，复杂的权限、恢复、取消和资源生命周期集中在实现内部。这样可以提升 Seam 的可测试性、修改的 Locality，以及新增 Provider、工具和 Runtime 规则时的 Leverage。
