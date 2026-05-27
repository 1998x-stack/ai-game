# game_runtime 工具优化设计规范

> **日期**: 2026-05-27 | **作者**: Sisyphus (OhMyOpenCode) | **状态**: 已确认 (经 grill-with-docs 压力测试)
>
> **关联 ADR**: [0002-rule-engine-first-game-testing](../adr/0002-rule-engine-first-game-testing.md)

## 1. 背景

`game_runtime` 是 AI Game Studio 的 agent 工具之一，用于在 headless 浏览器中运行已构建的游戏并进行自动化边缘测试。当前实现存在以下核心问题：

| 问题 | 严重程度 | 影响 |
|------|----------|------|
| 工具默认禁用（config.ts 中被注释） | 🔴 严重 | 功能形同虚设 |
| 状态提取硬编码 14 个变量名 | 🔴 严重 | 非标准命名游戏无法测试 |
| 仅支持键盘单键输入 | 🟡 中等 | 无法测试点击/拖拽/触屏游戏 |
| 每次调用启动新浏览器实例 | 🟡 中等 | 资源浪费，延迟高 |
| 错误检测仅 3 条规则 | 🟡 中等 | 大量运行时问题漏检 |
| 无性能指标 | 🟢 优化 | 缺少量化数据 |

## 2. 设计目标

将 `game_runtime` 从基础测试工具升级为**生产级游戏质量保障系统**：

1. **默认启用**，内置多层成本控制
2. **自适应状态提取**，运行时动态探测
3. **全输入支持**（键盘/鼠标/触摸）
4. **智能测试生成**，游戏类型感知 + 三层降级链
5. **结构化报告**，不含 agent context 污染
6. **资源高效**，浏览器连接池 + HMR 安全

## 3. 关键决策（经 grill-with-docs 确认）

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 测试策略 | 规则引擎优先（ADR 0002） | 预设场景覆盖模板类型（0 API调用），启发式规则覆盖检测类型，AI仅兜底 |
| 游戏类型分类 | 模板类型(4) + 检测类型(3) | snake/breakout/tetris/2048 有完整测试场景；platformer/shooter/puzzle-matching 仅关键词推断 |
| 静态分析 | 正则 + 启发式（零依赖） | 不引入 AST 解析器；关键词匹配 + 模式识别足够覆盖需求 |
| 浏览器管理 | 连接池模式 + HMR 安全 | 进程级单例 + process.on('exit') 清理 + module.hot.dispose 钩子 |
| 截图 | 默认关闭，磁盘存储 | 开启时存入 `output/screenshots/`，通过 SSE 发给前端，不进入 agent 消息历史 |
| 文件组织 | `lib/runtime/` 新目录 | 与 `lib/build/`（构建管道）职责分离 |
| 实施范围 | 全量 4 个 Phase | 完整覆盖可用性→测试引擎→性能可视化→资源优化 |

## 4. 架构设计

```
lib/runtime/                        ← 新目录
├── analyzer.ts         静态分析器（正则模式匹配，识别游戏类型+状态变量+输入方法）
├── test-engine.ts       测试规则引擎（三层降级：预设场景→启发式规则→AI兜底）
├── perf-monitor.ts      性能监控（FPS/内存/帧时间注入测量）
├── report-generator.ts  报告生成（纯文本给agent，截图给前端）
└── browser-pool.ts      浏览器连接池（进程级单例+HMR安全+空闲回收）
```

### 4.1 三层降级链

```
game_runtime 工具调用
    │
    ├── Layer 1: 模板类型匹配（snake/breakout/tetris/2048）
    │   → 预设测试场景，0 API 调用，确定性可重现
    │   失败 ↓
    │
    ├── Layer 2: 检测类型推断（platformer/shooter/puzzle-matching）
    │   → 关键词匹配 + 自动检测输入/状态/循环，0 API 调用
    │   失败 ↓
    │
    └── Layer 3: AI 决策兜底（unknown / 规则无法覆盖）
        → fallback 模型生成动作，有调用上限，降级到随机输入
```

### 4.2 数据流

```
game_runtime 工具调用
    │
    ├── 1. 读取 scripts/game.js → analyzer 模式匹配游戏类型
    │
    ├── 2. BrowserPool.acquire() → 获取浏览器实例
    │
    ├── 3. 加载 output/index.html → StateProber 动态提取状态
    │
    ├── 4. test-engine 三层降级生成测试动作
    │       ├── 模板类型: 预设动作序列
    │       ├── 检测类型: 启发式规则（自动检测输入方法）
    │       └── unknown: AI 决策（有调用上限）
    │
    ├── 5. perf-monitor 注入性能监控脚本
    │
    ├── 6. 执行测试动作（keyboard/mouse/touch）
    │       └── 截图（可选，默认关闭）→ 存 disk，SSE 推前端
    │
    ├── 7. 运行检测规则（Canvas尺寸/得分变化/内存泄漏/事件清理/渲染一致性）
    │
    ├── 8. BrowserPool.release() → 归还浏览器实例
    │
    └── 9. report-generator:
            → agent 收到: 纯文本报告（摘要+问题+性能数据）
            → 前端收到: SSE事件（截图URLs）
```

## 5. 关键接口设计

### 5.1 工具定义变更

```typescript
const gameRuntimeDef: ToolDefinition = {
  name: 'game_runtime',
  description: 'Run the built game in a headless browser for automated testing. Uses game-type-aware testing with three-tier strategy: preset scenarios for known types, heuristic detection for inferred types, AI fallback for unknown types. Tests keyboard/mouse/touch input, performance profiling (FPS/memory), and runtime edge cases. Use AFTER build_game succeeds.',
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
      includeScreenshots: { type: 'boolean', description: 'Capture screenshots during test (default: false)' },
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
  summary: { passed: number; warnings: number; errors: number; totalChecks: number; duration: string };
  game: {
    type: string;        // snake | breakout | tetris | 2048 (template types)
                         // platformer | shooter | puzzle-matching (detection types)
                         // unknown
    tier: 'template' | 'detection' | 'fallback';  // 使用的降级层级
    complexity: string;
    canvasSize: string;
    inputMethods: string[];
  };
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

### 5.3 截图分离设计

```
agent 工具结果:  "GAME RUNTIME REPORT: 6 checks passed, 1 warning. ..."
                  ↑ 纯文本，不含 base64

SSE 事件:        { type: 'game_runtime_result', report: {...}, screenshots: ['/api/screenshot/{id}/1.jpg'] }
                  ↑ 前端通过 URL 按需加载
```

### 5.4 浏览器连接池（HMR 安全）

```typescript
let globalPool: BrowserPool | null = null;
let cleanupRegistered = false;

export function getBrowserPool(): BrowserPool {
  if (!globalPool) {
    globalPool = new BrowserPool(CONFIG.gameRuntime.browserPool);
    if (!cleanupRegistered) {
      process.on('exit', () => globalPool?.shutdown());
      process.on('SIGTERM', () => { globalPool?.shutdown(); process.exit(); });
      cleanupRegistered = true;
    }
  }
  return globalPool;
}

// HMR 安全：模块热替换时清理旧实例
if (typeof module !== 'undefined' && (module as any).hot) {
  (module as any).hot.dispose(() => {
    globalPool?.shutdown();
    globalPool = null;
  });
}
```

## 6. 错误处理约定

所有新增代码遵循以下错误分级约定（**禁止裸 catch {}**）：

| 级别 | 行为 | 示例 |
|------|------|------|
| `recoverable` | 继续测试，记录为 warning | 某一步截图失败 |
| `partial` | 跳过当前场景，记录为 error | 类型识别置信度不足 |
| `fatal` | 终止测试，记录为 error + context | 浏览器崩溃 |

所有错误写入 `TestReport.issues[]`，附带 `severity` + `fixSuggestion`。

## 7. 游戏类型测试场景

### 模板类型（有 scaffold 参考实现，完整测试场景）

| 游戏类型 | 测试场景 | 检测内容 |
|----------|----------|----------|
| **snake** | 方向切换、食物收集、自碰检测 | 方向不反向、得分增加、蛇身增长、GameOver触发 |
| **breakout** | 球碰撞、挡板移动、砖块消除 | 反弹逻辑、键盘响应、砖块计数递减 |
| **tetris** | 方块下落、旋转、消行 | 旋转碰撞、行消除、速度递增、GameOver |
| **2048** | 滑动合并、新块生成 | 合并逻辑、得分累加、棋盘满检测 |

### 检测类型（关键词推断，无 scaffold 参考）

| 游戏类型 | 检测关键词 | 测试策略 |
|----------|-----------|----------|
| **platformer** | gravity, jump, platform, velocityY | 启发式规则 + AI 兜底 |
| **shooter** | bullet, enemy, shoot, projectile | 启发式规则 + AI 兜底 |
| **puzzle-matching** | grid, tile, match, swap | 启发式规则 + AI 兜底 |

## 8. 配置汇总

```typescript
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

  // Phase 3: 性能可视化（截图默认关闭）
  screenshots: { enabled: false, format: 'jpeg', quality: 60, maxCount: 5, captureOnError: true },
  performance: { measureFps: true, measureMemory: true, measureFrameTime: true,
    fpsSampleDurationMs: 3000, memorySampleIntervalMs: 500 },

  // Phase 4: 资源优化
  browserPool: { maxInstances: 3, idleTimeoutMs: 300_000, maxMemoryPerPageMb: 512,
    maxPagesPerInstance: 5, cleanupIntervalMs: 60_000 },
  aiDecision: { enabled: true, maxApiCalls: 10, model: 'deepseek-v4-flash',
    temperature: 0.3, maxTokens: 10, fallbackToRandom: true },
},
```

## 9. 实施计划

| Phase | 内容 | 新增文件 | 修改文件 | 预计时间 |
|-------|------|----------|----------|----------|
| **1** | 启用工具 + 动态状态提取 + 扩展错误规则 | — | `config.ts`, `tools.ts` | ~1天 |
| **2** | 游戏类型识别 + 三层降级规则引擎 + 鼠标/触摸输入 | `lib/runtime/analyzer.ts`, `lib/runtime/test-engine.ts` | `tools.ts` | ~2天 |
| **3** | 性能监控 + 结构化报告 + 截图分离 | `lib/runtime/perf-monitor.ts`, `lib/runtime/report-generator.ts` | `tools.ts` | ~2天 |
| **4** | 浏览器连接池(HMR安全) + 资源管理 | `lib/runtime/browser-pool.ts` | `tools.ts`, `config.ts` | ~1天 |

**总计**: ~6天，新增 5 个文件（`lib/runtime/`），修改 2-3 个文件。预计新增代码约 800-1000 行。

## 10. 成功标准

- [ ] `game_runtime` 工具默认启用，agent 可直接调用
- [ ] 状态提取不再依赖硬编码变量名（动态遍历 window 属性）
- [ ] 支持键盘(单键+长按)、鼠标(点击+移动)、触摸(点击+滑动)输入
- [ ] 4 种模板类型有完整预设测试场景（snake/breakout/tetris/2048）
- [ ] 3 种检测类型有启发式规则 + AI 兜底
- [ ] 错误检测规则从 3 条扩展到 7+ 条
- [ ] 截图默认关闭，开启时走磁盘+SSE，不进 agent context
- [ ] 浏览器实例池复用 + HMR 安全，测试延迟降低 50%+
- [ ] API 调用次数相比全 AI 决策减少 80%+
- [ ] 所有新增代码遵循错误分级约定（禁止裸 catch {}）
