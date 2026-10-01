# AI Game Studio 稳定性与安全整改实施计划

**执行状态**：Implemented；最终验证已通过。

> 关联设计：[spec.md](./spec.md)、[ADR-0001](./docs/adr/0001-logical-workspace-isolation.md)、[ADR-0002](./docs/adr/0002-rule-engine-first-game-testing.md)

## 目标与执行原则

目标是将当前“能运行”的 Agent 游戏工作台，收敛为具有明确安全边界、Session 一致性和 Runtime 资源生命周期的系统。

- 每个阶段先写失败测试，再修改实现。
- 优先修复可被远程输入触发的安全问题，再处理正确性和架构重构。
- 保持现有 API 形状，除 capability 校验和结构化结果外，尽量兼容现有 UI。
- 不引入新的 Provider；Provider Registry 在本计划完成前只暴露已实现的 DeepSeek。
- 每个阶段独立可回滚，并在阶段末运行全量测试。

## 目标架构

```text
API Route
  └─ SessionModule.withLock()
       ├─ AgentSession
       │    └─ ToolExecutionKernel
       │         ├─ FileAdapter
       │         ├─ BuildAdapter
       │         ├─ RuntimeAdapter
       │         └─ GitHubAdapter
       ├─ WorkspaceRepository
       └─ EventSink (JSON response / SSE)
```

路由只负责编排和 HTTP 协议；Session、工具执行、构建和 Runtime 各自拥有清晰 Interface。实现细节集中在 Module 内，调用方不直接操作内存 Map、JSONL 或 Playwright Page。

## 设计决策补充

### Session capability

新增 `POST /api/session` 创建 Session。服务端生成 UUID 和随机 capability secret：

```text
sessionId: 公共定位符
capability: 高熵随机值，仅存 HttpOnly、SameSite=Lax Cookie
```

后续 `/api/chat`、`/api/session/[id]`、`/api/preview/[id]` 均校验 Session 与 capability 的绑定。旧的仅 UUID URL 在本地开发模式下返回明确的迁移错误，不自动放行。

### JSONL 增量格式

保留 `.jsonl` 文件，但每行增加稳定元数据：

```json
{"version":1,"id":"msg-uuid","sessionId":"...","seq":12,"message":{}}
```

`SessionModule.appendDelta()` 只接受新的 `seq`，重复 seq 幂等忽略，乱序或损坏记录返回可诊断错误。暂不做自动摘要；达到上限时先拒绝新请求并提示用户开启新 Session，避免静默丢上下文。

### 构建发布模型

`buildGame()` 写入 `output/.staging/{buildId}/index.html`，验证成功后原子 rename 到 `output/index.html`，并写入 `output/build-manifest.json`。失败只保留错误，不触碰上一份成功产物；UI 使用 manifest 的 `buildId` 判断预览版本。

### 工具执行内核

建议 Interface：

```ts
interface ToolSpec<Args = unknown> {
  name: string;
  roles: readonly ('master' | 'subagent')[];
  parse(args: unknown): Args;
  execute(ctx: ToolContext, args: Args): Promise<ToolOutcome>;
  sideEffect: 'none' | 'workspace' | 'network' | 'publish';
}
```

Kernel 统一完成 Role 校验、参数解析、超时、AbortSignal、错误脱敏、事件记录和结构化结果。模型 Schema 只用于提示，不作为安全控制。

### Browser lease

`BrowserPool.acquire()` 返回 `{ page, release }`。lease 绑定唯一 Page；`release()` 必须幂等并关闭 Page。Pool 只驱逐 `activeLeases === 0` 的 Browser；容量不足时排队，而不是关闭 active Page。

## 分阶段任务

### Phase 0 — 基线与测试工具

**目的**：建立可重复反馈回路，不改变产品行为。

- [ ] 执行 `npm ci`，确认 Node、Playwright 浏览器和构建环境。
- [ ] 增加 `npm run typecheck`：`tsc --noEmit`。
- [ ] 增加测试辅助函数：临时 Workspace、SSE 消费器、Fake Clock、Fake AbortSignal。
- [ ] 记录当前全量测试基线和已知失败。
- [ ] 建立覆盖目标：安全边界、Session Store、Packager、BrowserPool、Factory、SSE 各至少一组真实行为测试。

**Files**：`package.json`、`__tests__/helpers/*`、`vitest.config.ts`

**验收**：干净环境可执行 `npm ci && npm test && npm run lint && npm run typecheck`。

### Phase 1 — 安全热修复

**目的**：先关闭高危命令执行和凭据泄露路径。

- [ ] 新增 `lib/security/validation.ts`，集中实现 repoName、baseUrl、敏感路径和 secret redaction。
- [ ] 将 `lib/github.ts` 的 shell 拼接替换为参数化 `execFile`；remote 使用 `GIT_ASKPASS` 或临时 credential helper。
- [ ] 文件工具拒绝 `.git` 及相关配置文件；Git 命令设置受控环境变量并禁用 hooks/filters。
- [ ] 加强 `validatePath()`：校验 Workspace 根、父目录 realpath、符号链接和边界；补充非存在路径测试。
- [ ] 将 Provider Registry 收敛为 DeepSeek；未实现 Provider 从 SettingsModal 和 API allowlist 移除。
- [ ] 对 `baseUrl` 做 scheme、host、端口和 allowlist 校验。

**Files**：`lib/security/validation.ts`、`lib/github.ts`、`lib/git.ts`、`lib/agent/tools.ts`、`lib/config.ts`、`lib/agent/factory.ts`、`components/SettingsModal.tsx`

**验收**：命令注入、Token remote、`.git` 写入、符号链接和非法 baseUrl 测试全部通过。

### Phase 2 — Session Module 与授权

**目的**：统一 Session、Workspace 和持久化状态。

- [ ] 新增 `lib/session/session-module.ts`，封装 `load`、`withLock`、`appendDelta`、`restoreWorkspace`、`snapshot`。
- [ ] 新增 Session 创建接口和 HttpOnly capability Cookie；为已有 URL 恢复流程增加迁移错误。
- [ ] 将 `agentSessions`、Workspace Map 和 JSONL 访问收归 Session Module。
- [ ] 使用 per-session promise queue 实现同 Session 串行，不阻塞其他 Session。
- [ ] 将 JSONL 改为带 `version/id/seq/sessionId` 的增量记录，并增加大小上限。
- [ ] Workspace LRU 改为 active lease 保护；清理任务扫描磁盘 Workspace，并遵守总磁盘配额。
- [ ] 恢复时区分“无 Session”“损坏记录”“Workspace 缺失”，禁止静默回退为空历史。

**Files**：`lib/session/*`、`lib/session-store.ts`、`lib/workspace/manager.ts`、`app/api/session/[sessionId]/route.ts`、`app/api/chat/route.ts`、`app/api/preview/[sessionId]/route.ts`

**验收**：三轮对话无重复消息；并发同 Session 串行；不同 Session 可并行；未授权请求返回 401/403。

### Phase 3 — Tool Execution Kernel

**目的**：将权限和生命周期从“Prompt 约定”提升为强制 Interface。

- [ ] 拆分 `lib/agent/tools.ts`：`tool-specs.ts`、`tool-kernel.ts`、`file-tools.ts`、`runtime-tool.ts`、`github-tool.ts`。
- [ ] 为每个工具增加 parse、role、sideEffect、timeout、cancel 和结构化 outcome。
- [ ] 在执行层强制应用 `CONFIG.tools.allowed`，subagent 不得通过伪造 tool call 越权。
- [ ] 所有工具和 Provider API 接受统一 `AbortSignal`；不可取消操作必须在 Kernel 中标记为不可重入。
- [ ] 主 Agent 显式传入 fallback model，并保留 `reasoning_content` round-trip。

**Files**：`lib/agent/tools.ts`、`lib/agent/tool-kernel.ts`、`lib/agent/deepseek.ts`、`lib/agent/types.ts`、`lib/config.ts`

**验收**：越权 tool call 被拒绝；超时不会启动下一次同 Session 副作用操作；错误结果自动脱敏。

### Phase 4 — SSE 与 Build Pipeline

**目的**：消除旧产物误判和流关闭竞态。

- [ ] 让 `build_game` 返回 `{ success, buildId, outputPath, errors }`。
- [ ] 实现 staging + manifest + 原子发布；失败不覆盖上一份成功输出。
- [ ] 引入 module parser 做语法校验，加入 script-safe 编码和资源大小限制。
- [ ] 统一 SSE/非流式错误处理和 `redactSecrets`。
- [ ] `handleStreamingResponse` 等待 build event side effect 后再关闭 controller。
- [ ] 前端保存请求 AbortController；New Game 时取消请求并校验 session/request generation。
- [ ] 修复 GitHub push 的 `finally` 状态清理、URL 同步和恢复时 buildResult 重建。

**Files**：`lib/build/packager.ts`、`app/api/build/route.ts`、`app/api/chat/route.ts`、`app/HomeContent.tsx`、`components/GamePreview.tsx`

**验收**：消费真实 SSE body 能稳定得到 `build_result`；失败构建不复用旧产物；错误流不含 Token；旧请求不能污染新 Session。

### Phase 5 — Runtime Test Engine

**目的**：将 Runtime 变成拥有 Page 生命周期和结果语义的独立 Module。

- [ ] 新增 `lib/runtime/engine.ts`，封装 analyze、plan、execute、observe、evaluate、report。
- [ ] 重写 BrowserPool 为 lease + queue；关闭已释放 Page，禁止淘汰 active Browser。
- [ ] 校验 `maxSteps`、`fps`，实现 total deadline、API call budget 和 Playwright timeout。
- [ ] 修正 Snake/Tetris 菜单启动动作和 Breakout 初始动作。
- [ ] 为 module scope 游戏增加受控 observation Adapter；禁止依赖任意 `window` 扫描作为唯一状态来源。
- [ ] 修复 frame-time p99、memory unsupported 语义和 `passed/failed/incomplete` 报告。

**Files**：`lib/runtime/engine.ts`、`lib/runtime/browser-pool.ts`、`lib/runtime/perf-monitor.ts`、`lib/runtime/report-generator.ts`、`lib/runtime/test-engine.ts`、`lib/agent/tools.ts`、`workspace/templates/*`

**验收**：4 个并发 Runtime 测试互不关闭 Page；Page 数量稳定；AI/API/浏览器失败均报告为 `incomplete` 或 `failed`。

### Phase 6 — 回归测试与文档同步

- [ ] 增加 Packager、Session Module、BrowserPool、Tool Kernel、Factory、GitHub 安全和 SSE 集成测试。
- [ ] 增加真实 HTML/module/iframe 测试，验证 `game-ready` 和 `game-error`。
- [ ] 增加 fuzz/property 测试：repoName、path、baseUrl、JSONL、Runtime 参数。
- [ ] 同步 `README.md`、`docs/api-reference.md`、`docs/architecture.md`、`docs/tool-analysis.md`、`docs/agent-sdk.md`。
- [ ] 更新 ADR-0001，记录 capability 授权、symlink 防护和容器化仍未解决的范围。
- [ ] 更新 `AGENTS.md` 的命令、Provider、测试和安全规则。

**最终验收**：

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

## 依赖关系与回滚点

```text
Phase 0
  └─ Phase 1 ──┐
                ├─ Phase 2 ── Phase 3 ── Phase 4
                └─ Phase 5
Phase 4 + Phase 5 ── Phase 6
```

- Phase 1 可独立回滚，但回滚后不得重新开放危险 Provider 或 GitHub shell 拼接。
- Phase 2 的 JSONL 格式迁移必须提供读取旧格式的兼容 Adapter；确认新格式稳定后再删除旧读取逻辑。
- Phase 3-5 应保持工具名称和前端事件名称兼容，先增加 Adapter，再切换路由调用方。
- 任一阶段发现真实数据损坏，优先停止迁移、保留旧读路径和备份文件，不执行破坏性清理。

## Definition of Done

本计划完成的条件：

1. 高危安全测试、Session 一致性测试、SSE 集成测试和 Runtime 生命周期测试均通过。
2. 生产路径不再依赖“文件存在即成功”、模型 Prompt 约定权限或 Page 计数近似释放。
3. `spec.md` 中每条验收标准都有对应测试或可重复的检查命令。
4. 文档与实现的 Provider、工具数量、Runtime 能力和安全假设一致。
