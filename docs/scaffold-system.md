# 脚手架系统

## 概述

脚手架 (`workspace/`) 是 Agent 生成游戏时的权威知识库。Agent 在生成代码前必须先读取相关文档，确保生成代码符合规范且避免已知陷阱。

## 目录结构

```
workspace/
├── agent.md           # Agent 系统指令 (注入到系统提示词)
├── claude.md          # Claude SDK 变体 (与 agent.md 内容相同)
├── docs/              # 游戏开发文档
│   ├── game-dev-guide.md      # Canvas 开发指南 (760 行)
│   ├── game-patterns.md       # 架构模式 (785 行)
│   ├── gotchas.md             # 反模式规则 (715 行, 20+ 条)
│   └── ui-design-guide.md     # Canvas UI 设计 (793 行)
├── templates/         # 游戏模板
│   ├── snake/game.js          # 贪吃蛇 (GameLoop + InputManager)
│   ├── breakout/game.js       # 打砖块 (clamp + 鼠标跟踪)
│   ├── tetris/game.js         # 俄罗斯方块 (SRS 旋转 + DAS)
│   └── 2048/game.js           # 2048 (swipe + Ctrl+Z 撤销)
├── lib/               # 工具库
│   ├── utils.js               # 19 个工具类/函数 (890 行)
│   └── index.md               # 完整 API 参考
└── skills/            # 技能系统
    ├── README.md
    ├── skill-creator.md
    └── examples/
        ├── pixel-art-games.md
        └── game-sound-effects.md
```

## 核心设计

### 脚手架复制

每次创建会话工作区时，`copyScaffoldToWorkspace()` 将整个 `workspace/` 复制到 `user_space/{sessionId}/`：

```
user_space/{sessionId}/
├── docs/           ← workspace/docs/
├── templates/      ← workspace/templates/
├── lib/
│   ├── utils.js    ← workspace/lib/utils.js (参考)
│   └── index.md    ← workspace/lib/index.md
├── skills/         ← workspace/skills/
├── agent.md        ← workspace/agent.md
├── claude.md       ← workspace/claude.md
├── scripts/
│   ├── utils.js    ← workspace/lib/utils.js (构建管道使用)
│   └── game.js     ← Agent 写入
├── assets/         ← Agent 写入
└── output/         ← build_game 生成
```

### agent.md 注入

Chat Route 在构建系统提示词时读取 `workspace/agent.md` 并追加到系统提示词末尾。这确保 Agent 始终获得完整的指令集。

### 知识飞轮

脚手架的三个组件可以自主扩展，形成正向循环：

| 组件 | Agent 可扩展 | 扩展方式 | 效果 |
|------|-------------|---------|------|
| `scripts/utils.js` | ✅ | APPEND 新函数/类 | 工具库增长 |
| `docs/gotchas.md` | ✅ | APPEND 新 Gotcha | 错误不再犯 |
| `skills/examples/` | ✅ | CREATE 新技能 | 领域知识沉淀 |

## 文档体系

### game-dev-guide.md (760 行)

Canvas 游戏开发的完整指南：
- Quick Start 样板代码
- 可用工具列表（19 个工具说明）
- 游戏循环、输入处理、碰撞检测
- HUD、粒子效果、屏幕震动等通用模式

### game-patterns.md (785 行)

架构模式参考：
- 项目结构布局
- 状态机模式（含转换图）
- 响应式设计策略
- 输入缓冲模式

### gotchas.md (715 行, 20+ 条)

结构化反模式规则，每条包含：
- **Problem**: 问题描述
- **Wrong**: 错误代码
- **Correct**: 正确代码

覆盖：Canvas 尺寸、事件处理、模块作用域、文本渲染、性能优化等。

### ui-design-guide.md (793 行)

Canvas UI 设计指南：
- 坐标系统、文本渲染
- HUD 布局模式
- 菜单和覆盖层设计
- 常见 UI 错误（8 组错误/正确对比）

## 模板设计原则

所有 4 个模板遵循统一模式：

```js
export default class SnakeGame {
  constructor() {
    this.canvas = setupCanvas('gameCanvas', DESIGN_W, DESIGN_H);
    this.ctx = this.canvas.getContext('2d');
    this.input = new InputManager(this.canvas);

    this.loop = new GameLoop((dt) => {
      this.update(dt);
      this.render();
      this.input.endFrame();
    });
  }

  update(dt) { /* 游戏逻辑, 使用 input.justPressed/isDown/getSwipe */ }
  render() { /* 绘制 */ }
  start() { this.loop.start(); }
  stop() { this.loop.stop(); this.input.destroy(); }
}

// 自动启动
const game = new SnakeGame();
game.start();
```
