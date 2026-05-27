# game_runtime 优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 game_runtime 从基础测试工具升级为生产级游戏质量保障系统——默认启用、三层降级、浏览器连接池。

**Architecture:** 新增 `lib/runtime/` 目录（5个模块）。测试采用三层降级链（预设场景→启发式规则→AI兜底）。BrowserPool 为进程级单例，HMR 安全。

**关联:** `docs/superpowers/specs/2026-05-27-game-runtime-optimization-design.md` | `docs/adr/0002-rule-engine-first-game-testing.md`

---

## File Structure

```
lib/runtime/                    ← 新增目录
├── analyzer.ts                 游戏类型识别（正则+启发式）
├── test-engine.ts              三层降级测试引擎
├── perf-monitor.ts             性能监控注入与采集
├── report-generator.ts         结构化报告生成
└── browser-pool.ts             浏览器连接池（HMR安全）

lib/agent/tools.ts              修改: game_runtime handler 重写
lib/config.ts                   修改: gameRuntime 配置扩展
__tests__/runtime-analyzer.test.ts    新增 9 tests
__tests__/runtime-test-engine.test.ts 新增 4 tests
```

---

### Task 1: 扩展配置 + 启用工具 + 动态状态提取

**Files:** Modify `lib/config.ts` (L48-53), `lib/agent/tools.ts` (L746-789)

- [ ] **Step 1: 扩展 gameRuntime 配置** — 替换 `lib/config.ts` L48-53 为完整配置块
- [ ] **Step 2: 将 game_runtime 加入 master 允许列表** — `lib/config.ts` L42 取消注释
- [ ] **Step 3: 动态状态提取** — 替换硬编码变量列表为动态遍历 window 属性（排除原生/框架属性）
- [ ] **Step 4: 验证** — `npm test -- --run` 全量通过
- [ ] **Step 5: Commit** — `feat(game_runtime): enable tool, dynamic state extraction, extend config`

---

### Task 2: 扩展错误检测规则

**Files:** Modify `lib/agent/tools.ts` (L881-893)

- [ ] **Step 1: 定义 RuntimeIssue 接口 + runDetectionRules 函数** — 结构化规则替代硬编码 if
- [ ] **Step 2: 替换 handler 中的内联检测** — 收集 stateHistory，传入 runDetectionRules
- [ ] **Step 3: 验证 + Commit** — `feat(game_runtime): structured detection rules`

---

### Task 3: 创建游戏类型分析器 (TDD)

**Files:** Create `__tests__/runtime-analyzer.test.ts`, `lib/runtime/analyzer.ts`

- [ ] **Step 1: 写 9 个测试** — snake/breakout/tetris/2048 识别、unknown 兜底、状态变量提取、输入方法检测
- [ ] **Step 2: 运行确认失败** — `npx vitest run __tests__/runtime-analyzer.test.ts`
- [ ] **Step 3: 实现 analyzer.ts** — `detectGameType()` 正则匹配 + `extractStateVars()` + `detectInputMethods()` + `analyzeGame()`
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat(game_runtime): add regex-based game type analyzer`

---

### Task 4: 创建三层降级测试引擎 (TDD)

**Files:** Create `__tests__/runtime-test-engine.test.ts`, `lib/runtime/test-engine.ts`

- [ ] **Step 1: 写 4 个测试** — 模板类型→预设场景、检测类型→启发式、unknown→null(AI兜底)、鼠标输入含鼠标动作
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现 test-engine.ts** — TEMPLATE_SCENARIOS + generateHeuristicScenario + generateTestScenario 三层返回
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: Commit** — `feat(game_runtime): add three-tier test engine`

---

### Task 5: 创建性能监控器 + 报告生成器

**Files:** Create `lib/runtime/perf-monitor.ts`, `lib/runtime/report-generator.ts`

- [ ] **Step 1: 实现 perf-monitor.ts** — `injectPerfMonitor()` RAF hijack + `extractPerfMetrics()` FPS/stability计算
- [ ] **Step 2: 实现 report-generator.ts** — `generateTextReport()` 纯文本聚合（无base64截图）
- [ ] **Step 3: Commit** — `feat(game_runtime): add perf monitor + report generator`

---

### Task 6: 集成分析器+引擎+监控到 handler

**Files:** Modify `lib/agent/tools.ts` (gameRuntimeHandler L709-917)

- [ ] **Step 1: 导入新模块** — analyzer, test-engine, perf-monitor, report-generator
- [ ] **Step 2: 重写 handler 流水线** — analyzeGame → generateTestScenario → executeAction(keyboard/mouse/touch) → runDetectionRules → generateTextReport
- [ ] **Step 3: 保留 AI 兜底** — scenario 为 null 时回退到现有 AI 决策循环
- [ ] **Step 4: 验证 + Commit** — `feat(game_runtime): integrate analyzer+engine+monitor into handler`

---

### Task 7: 创建浏览器连接池 + 集成

**Files:** Create `lib/runtime/browser-pool.ts`, Modify `lib/agent/tools.ts`

- [ ] **Step 1: 实现 browser-pool.ts** — acquire/release/evictIdle/shutdown，进程级单例 + HMR safe
- [ ] **Step 2: 替换 handler 中的 chromium.launch** — `getBrowserPool().acquire()` 获取，finally 中 `release()` 归还
- [ ] **Step 3: Commit** — `feat(game_runtime): add HMR-safe browser pool`

---

### Task 8: 最终验证

- [ ] **Step 1: 全量测试** — `npm test -- --run`，全部通过
- [ ] **Step 2: TypeScript 检查** — `npx tsc --noEmit`，无类型错误
- [ ] **Step 3: LSP 诊断** — 检查所有修改/新增文件
- [ ] **Step 4: 最终 Commit**
