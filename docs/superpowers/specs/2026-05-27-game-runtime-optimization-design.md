# game_runtime 工具优化设计规范

> **日期**: 2026-05-27 | **作者**: Sisyphus (OhMyOpenCode) | **状态**: 已确认

## 1. 背景

`game_runtime` 是 AI Game Studio 的 15 个 agent 工具之一，用于在 headless 浏览器中运行已构建的游戏并进行自动化边缘测试。当前实现存在以下核心问题：

| 问题 | 严重程度 | 影响 |
|------|----------|------|
| 工具默认禁用（config.ts 中被注释） | 🔴 严重 | 功能形同虚设 |
| 状态提取硬编码 14 个变量名 | 🔴 严重 | 非标准命名游戏无法测试 |
| 仅支持键盘单键输入 | 🟡 中等 | 无法测试点击/拖拽/触屏游戏 |
| 每次调用启动新浏览器实例 | 🟡 中等 | 资源浪费，延迟高 |
| 错误检测仅 3 条规则 | 🟡 中等 | 大量运行时问题漏检 |
| 无截图、无性能指标 | 🟢 优化 | 缺少可视化反馈 |

## 2. 设计目标

将 `game_runtime` 从"玩具级"测试工具升级为**生产级游戏质量保障系统**：

1. **默认启用**，成本可控
2. **自适应状态提取**，不依赖硬编码变量名
3. **全输入支持**（键盘/鼠标/触摸）
4. **智能测试生成**，根据游戏类型生成针对性测试
5. **可视化报告**，包含截图和性能数据
6. **资源高效**，浏览器连接池复用

## 3. 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 测试策略 | 规则引擎优先 | 降低 API 调用成本 ~80%，仅规则无法覆盖时使用 AI 决策 |
| 浏览器管理 | 连接池模式 | 跨会话复用，空闲自动回收，大幅降低延迟 |
| 实施范围 | 全量 4 个 Phase | 完整覆盖可用性→测试引擎→性能可视化→资源优化 |

## 4. 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                     game_runtime 优化架构                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ StaticAnalyzer│    │ StateProber  │    │ TestEngine    │       │
│  │ (AST解析游戏   │    │ (动态探测全局   │    │ (基于游戏类型   │       │
│  │  代码提取变量)  │    │  变量+Canvas)  │    │  生成测试动作)  │       │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│         │                   │                   │                │
│         └───────────────────┼───────────────────┘                │
│                             ▼                                    │
│                    ┌─────────────────┐                          │
│                    │  TestOrchestrator│                          │
│                    └────────┬────────┘                          │
│                             │                                    │
│         ┌───────────────────┼───────────────────┐               │
│         ▼                   ▼                   ▼               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ TestEngine    │  │ PerfMonitor   │  │ ReportGenerator│         │
│  │ (多输入模式    │  │ (FPS/内存/    │  │ (截图+指标     │          │
│  │  规则引擎)     │  │  帧时间)      │  │  结构化报告)   │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                  │
│  ┌──────────────────────────────────────────────────┐          │
│  │             BrowserPool (浏览器实例池)              │          │
│  │  预启动→复用→空闲回收→强制清理(超时/内存)            │          │
│  └──────────────────────────────────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.1 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **StaticAnalyzer** | `lib/build/static-analyzer.ts` (新增) | 解析游戏源码，识别游戏类型、状态变量名、输入方法 |
| **StateProber** | `lib/agent/tools.ts` (内联优化) | 运行时动态探测 `window` 全局变量，替代硬编码列表 |
| **TestEngine** | `lib/build/test-engine.ts` (新增) | 游戏类型感知的测试规则引擎，生成输入动作序列 |
| **PerfMonitor** | `lib/build/perf-monitor.ts` (新增) | FPS/内存/帧时间测量 |
| **ReportGenerator** | `lib/build/report-generator.ts` (新增) | 结构化测试报告 + 截图 + 修复建议 |
| **BrowserPool** | `lib/build/browser-pool.ts` (新增) | 浏览器实例连接池，预启动+复用+自动回收 |

### 4.2 数据流

```
game_runtime 工具调用
    │
    ├── 1. 读取 scripts/game.js → StaticAnalyzer 分析游戏类型
    │
    ├── 2. BrowserPool.acquire() → 获取浏览器实例
    │
    ├── 3. 加载 output/index.html → StateProber 动态提取状态
    │
    ├── 4. TestEngine 根据游戏类型生成测试场景
    │       ├── 规则引擎: 预设动作序列（snake→方向切换, breakout→球碰撞）
    │       └── AI 兜底: 规则无法覆盖时调用 fallback 模型决策
    │
    ├── 5. PerfMonitor 注入性能监控脚本，采集 FPS/内存/帧时间
    │
    ├── 6. 执行测试动作（keyboard/mouse/touch），每步截图
    │
    ├── 7. 运行检测规则（Canvas尺寸、得分变化、内存泄漏、渲染一致性）
    │
    ├── 8. BrowserPool.release() → 归还浏览器实例
    │
    └── 9. ReportGenerator 生成结构化报告 → 返回 agent
```

## 5. 关键接口设计

### 5.1 工具定义变更

```typescript
// tools.ts — gameRuntimeDef 更新
const gameRuntimeDef: ToolDefinition = {
  name: 'game_runtime',
  description: 'Run the built game in a headless browser for automated testing. Performs game-type-aware testing: keyboard/mouse/touch simulation, performance profiling (FPS/memory), and visual screenshots. Detects edge cases: boundary collisions, game-over triggers, score stagnation, memory leaks, and rendering issues. Use AFTER build_game succeeds.',
  parameters: {
    type: 'object',
    properties: {
      maxSteps: { type: 'number', description: 'Maximum test steps (default: 15)' },
      fps: { type: 'number', description: 'Step execution rate (default: 5)' },
      mode: { 
        type: 'string', 
        enum: ['quick', 'full', 'perf'], 
        description: 'Test mode: quick=smoke test (default), full=comprehensive, perf=performance only' 
      },
      includeScreenshots: { type: 'boolean', description: 'Capture screenshots during test (default: true)' },
      focusArea: { 
        type: 'string', 
        description: 'Specific area to test: collisions, input, rendering, performance, or all (default)' 
      },
    },
    required: [],
    additionalProperties: false,
  },
};
```

### 5.2 测试报告结构

```typescript
interface TestReport {
  summary: {
    passed: number;
    warnings: number;
    errors: number;
    totalChecks: number;
    duration: string;
  };
  game: {
    type: string;        // snake | breakout | platformer | shooter | puzzle | unknown
    complexity: string;  // simple | medium | complex
    canvasSize: string;  // "800x600"
    inputMethods: string[];
  };
  testLog: TestStep[];
  screenshots: ScreenshotEntry[];
  issues: Issue[];
  performance: PerfMetrics;
  recommendations: string[];
}

interface Issue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: 'collision' | 'input' | 'rendering' | 'performance' | 'game-logic' | 'memory';
  title: string;
  description: string;
  fixSuggestion: string;
}
```

### 5.3 浏览器连接池接口

```typescript
interface BrowserPool {
  acquire(): Promise<{ browser: Browser; page: Page; id: string }>;
  release(browserId: string, pageId?: string): void;
  evictIdle(): void;
  shutdown(): Promise<void>;
  stats(): { totalInstances: number; activePages: number; idleInstances: number };
}
```

## 6. 游戏类型测试场景

| 游戏类型 | 测试场景 | 检测内容 |
|----------|----------|----------|
| **snake** | 方向切换、食物收集、自碰检测 | 方向不反向、得分增加、蛇身增长、GameOver触发 |
| **breakout** | 球碰撞、挡板移动、砖块消除 | 反弹逻辑、键盘响应、砖块计数递减 |
| **platformer** | 跳跃、重力、平台碰撞 | 重力加速度、地面检测、平台穿透 |
| **shooter** | 射击、敌人生成、碰撞检测 | 子弹飞行、敌人销毁、得分更新 |
| **puzzle** | 网格操作、合并逻辑、棋盘更新 | 2048合并、俄罗斯方块消行 |
| **unknown** | 通用烟雾测试 | 无崩溃、Canvas有效、内存稳定 |

## 7. 配置汇总

```typescript
// config.ts — gameRuntime 完整配置
gameRuntime: {
  // 已有
  defaultMaxSteps: 15,
  defaultFps: 5,
  initWaitMs: 1000,

  // Phase 1: 基础可用性
  enabled: true,
  maxTotalTimeMs: 120_000,
  maxApiCallsPerTest: 10,

  // Phase 2: 测试引擎
  staticAnalyzer: { enabled: true, confidenceThreshold: 0.3 },
  testRules: {
    checkCanvasSize: true,
    checkScoreProgression: true,
    checkGameOverTrigger: true,
    checkMemoryLeak: true,
    checkEventCleanup: true,
    checkRenderConsistency: true,
    checkAnimationLoop: true,
  },

  // Phase 3: 性能可视化
  screenshots: { enabled: true, format: 'jpeg', quality: 60, maxCount: 5, captureOnError: true },
  performance: { measureFps: true, measureMemory: true, measureFrameTime: true,
    fpsSampleDurationMs: 3000, memorySampleIntervalMs: 500 },

  // Phase 4: 资源优化
  browserPool: { maxInstances: 3, idleTimeoutMs: 300_000, maxMemoryPerPageMb: 512,
    maxPagesPerInstance: 5, cleanupIntervalMs: 60_000 },
  aiDecision: { enabled: true, maxApiCalls: 10, model: 'deepseek-v4-flash',
    temperature: 0.3, maxTokens: 10, fallbackToRandom: true },
},
```

## 8. 实施计划

| Phase | 内容 | 新增文件 | 修改文件 | 预计时间 |
|-------|------|----------|----------|----------|
| **1** | 启用工具 + 动态状态提取 + 扩展错误规则 + 截图 | — | `config.ts`, `tools.ts` | ~1天 |
| **2** | 静态分析器 + 规则引擎 + AI兜底 + 鼠标/触摸输入 | `lib/build/static-analyzer.ts`, `lib/build/test-engine.ts` | `tools.ts` | ~2天 |
| **3** | 性能监控 + 结构化报告 | `lib/build/perf-monitor.ts`, `lib/build/report-generator.ts` | `tools.ts` | ~2天 |
| **4** | 浏览器连接池 + 资源管理 | `lib/build/browser-pool.ts` | `tools.ts`, `config.ts` | ~1天 |

**总计**: ~6天，新增 5 个文件，修改 2-3 个文件。 预计新增代码约 800-1000 行。

## 9. 风险与约束

| 风险 | 缓解措施 |
|------|----------|
| Playwright 浏览器内存占用 | 连接池限制 maxInstances=3，超限强制回收 |
| API 成本（AI 决策） | 规则引擎优先，maxApiCallsPerTest=10，fallbackToRandom |
| 静态分析精确度 | confidenceThreshold=0.3，低于阈值降级为 unknown 类型 |
| 工具超时 | maxTotalTimeMs=120s 硬上限，防止 agent loop 阻塞 |
| 向后兼容 | 工具接口保持不变，仅扩展参数；默认参数与旧版一致 |

## 10. 成功标准

- [ ] `game_runtime` 工具默认启用，agent 可直接调用
- [ ] 状态提取不再依赖硬编码变量名（动态遍历 window 属性）
- [ ] 支持键盘(单键+长按)、鼠标(点击+移动)、触摸(点击+滑动)输入
- [ ] 预设 5 种游戏类型(snake/breakout/platformer/shooter/puzzle)的测试场景
- [ ] 错误检测规则从 3 条扩展到 7+ 条
- [ ] 测试报告包含截图和性能指标(FPS/内存/帧时间)
- [ ] 浏览器实例池复用，测试延迟降低 50%+
- [ ] API 调用次数相比全 AI 决策减少 80%+
