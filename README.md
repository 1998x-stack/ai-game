# 🎮 AI Game Studio

> **用自然语言创造 HTML5 游戏 — 对话即开发，所见即所得**
>
> *Create HTML5 games through natural language — chat to develop, see it play instantly.*

<p align="center">
  <img src="https://img.shields.io/github/stars/1998x-stack/ai-game?style=for-the-badge&color=e94560" alt="Stars">
  <img src="https://img.shields.io/github/license/1998x-stack/ai-game?style=for-the-badge&color=0f3460" alt="License">
  <img src="https://img.shields.io/badge/Next.js-14.2-black?style=for-the-badge&logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/TypeScript-5.4-3178c6?style=for-the-badge&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/DeepSeek-API-4d6bfe?style=for-the-badge" alt="DeepSeek">
</p>

<p align="center">
  <img src="assets/ai-game-screenshot.png" alt="AI Game Studio Screenshot" width="100%" style="border-radius: 12px; box-shadow: 0 0 60px rgba(233, 69, 96, 0.15);" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build">
  <img src="https://img.shields.io/badge/tests-24%20passing-brightgreen?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/coverage-0%25-red?style=flat-square" alt="Coverage">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs">
</p>

---

## ✨ 核心特性 / Features

<table>
<tr>
<td width="50%">

### 💬 自然语言驱动
用中文或英文描述你的游戏创意 — "做一个贪吃蛇游戏"、"创建一个太空射击游戏"、"Build a brick breaker"。Agent 自动理解并生成完整代码。

### ⚡ 实时流式生成
Agent 逐步展示工具调用、推理过程 (`reasoning_content`) 和代码生成 — 不是黑盒，全程可见。每个文件读写、每次构建都在聊天框实时显示。

### 🎮 即时预览
右侧沙箱 iframe 直接运行生成的游戏。支持键盘、鼠标、触摸操作，一键全屏。游戏错误自动捕获并展示在控制台面板中。

### 🔄 持续迭代
多轮对话不断优化游戏 — "把蛇变快一点"、"加个分数计数器"、"改成霓虹风格"。Agent 修改代码、重新构建、自动预览。支持会话恢复 (`?session=` URL 参数)。

</td>
<td width="50%">

### 🧠 知识飞轮
脚手架包含 4 个游戏模板、20+ 条 Gotchas 规则、完整的 Canvas UI 设计指南。**Utils 和 Gotchas 可由 Agent 自主扩展** — 每次解决问题都沉淀为新工具或规则，质量随使用持续提升。

### 📦 自包含构建
所有 scripts + assets → 单个 HTML 文件。无外部依赖，纯 Canvas + JavaScript。生成的游戏可以独立运行，无需服务器。

### 🔌 BYO-Key 架构
用户自带 DeepSeek API Key，系统不存储密钥。支持 OpenAI 兼容接口，可配置自定义 endpoint 和 model。

### 🌐 会话持久化
JSONL 文件持久化存储会话历史，服务器重启不丢失。`?session={id}` URL 参数恢复完整对话 + 游戏状态。

</td>
</tr>
</table>

---

## 🚀 30 秒快速开始

```bash
git clone https://github.com/1998x-stack/ai-game.git
cd ai-game
npm install
npm run dev
# 打开 http://localhost:3000
# 配置 DeepSeek API Key → 开始创造游戏
```

**前置条件**: Node.js 18+ | [DeepSeek API Key](https://platform.deepseek.com/)

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────┐
│                    AI Game Studio                        │
├──────────────────────┬──────────────────────────────────┤
│   左侧：对话面板      │       右侧：游戏预览               │
│                      │                                   │
│  ┌────────────────┐  │  ┌────────────────────────────┐  │
│  │ 用户: "做一个   │  │  │                            │  │
│  │   贪吃蛇游戏"   │──┼─▶│   ┌──────────────────┐    │  │
│  └────────────────┘  │  │   │  🐍 Snake Game    │    │  │
│                      │  │   │  (sandbox iframe)  │    │  │
│  ┌────────────────┐  │  │   └──────────────────┘    │  │
│  │ Agent: 推理中…  │  │  │                            │  │
│  │ 📁 read_file   │◀─┼──│   Score: 42  Level: 3      │  │
│  │ ✏️ write_file  │  │  │                            │  │
│  │ 🔨 build_game  │  │  │   [Error Console]          │  │
│  │ ✅ 构建成功!    │  │  └────────────────────────────┘  │
│  └────────────────┘  │                                   │
├──────────────────────┴──────────────────────────────────┤
│              Agent Pipeline (DeepSeek API)               │
│  系统提示词 → 脚手架文档 → Gotchas → 模板 → 工具调用循环   │
│         ↓                ↓                               │
│   scripts/game.js    build_game → output/index.html      │
│         ↓                                                │
│   /api/preview/{sessionId} → iframe 沙箱预览              │
└─────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Next.js 14 (App Router) |
| 语言 | TypeScript 5.4 |
| 样式 | Tailwind CSS 3.4 |
| Agent SDK | DeepSeek API (OpenAI 兼容) |
| 游戏引擎 | 纯 HTML5 Canvas + JavaScript |
| 沙箱 | iframe `allow-scripts` |
| 持久化 | JSONL 文件 + 内存 Map |

---

## 📂 项目结构

```
ai-game/
├── app/                          # Next.js 页面 + API 路由
│   ├── page.tsx                  # 动态导入入口 (SSR disabled)
│   ├── HomeContent.tsx           # 分割面板布局 + 状态管理
│   ├── layout.tsx                # 根布局
│   └── api/
│       ├── chat/route.ts         # Agent 聊天 (POST, SSE 流式)
│       ├── build/route.ts        # 手动构建 (POST)
│       ├── preview/[id]/route.ts # 游戏预览 (GET, iframe 源)
│       └── session/[id]/route.ts # 会话历史 (GET, JSONL 读取)
├── components/                   # React 组件
│   ├── ChatPanel.tsx             # 聊天面板 + Markdown 渲染
│   ├── GamePreview.tsx           # 沙箱 iframe + 全屏
│   ├── SettingsModal.tsx         # API Key 配置
│   └── ErrorConsole.tsx          # 运行时错误显示
├── lib/                          # 核心库
│   ├── agent/                    # Agent SDK (工厂模式 + DeepSeek 适配器)
│   ├── build/packager.ts         # scripts + assets → 单文件 HTML
│   ├── workspace/manager.ts      # 会话隔离 + 脚手架复制
│   ├── scaffold/reader.ts        # 脚手架文档加载器
│   └── session-store.ts          # JSONL 持久化
├── workspace/                    # 脚手架知识库 (Agent 的权威参考)
│   ├── agent.md / claude.md      # Agent 系统指令
│   ├── docs/                     # 4 份游戏开发文档
│   │   ├── game-dev-guide.md     # Canvas 开发指南
│   │   ├── game-patterns.md      # 架构模式
│   │   ├── gotchas.md            # 20+ 条反模式 (可扩展)
│   │   └── ui-design-guide.md    # Canvas UI 设计
│   ├── templates/                # 4 个游戏模板
│   │   ├── snake/game.js
│   │   ├── breakout/game.js
│   │   ├── tetris/game.js
│   │   └── 2048/game.js
│   └── lib/
│       ├── utils.js              # 19 个可复用工具类/函数 (可扩展)
│       └── index.md              # 完整 API 参考
├── assets/                       # GitHub Pages 落地页
└── __tests__/                    # API 测试
```

---

## 🎯 设计哲学

| 原则 | 实践 |
|------|------|
| **脚手架优先** | Agent 生成代码前必须阅读权威文档 + Gotchas + 模板 |
| **知识飞轮** | Utils 和 Gotchas 可由 Agent 自主扩展 — 每次解决问题都沉淀 |
| **纯 Canvas** | 零 WebAssembly，零 Phaser，生成的游戏是独立的单个 HTML 文件 |
| **BYO-Key** | 无服务器端密钥存储，无用户认证，API Key 仅存在于浏览器 localStorage |
| **逻辑隔离** | 路径校验 + agent.md 约束。OS 级容器化 (v2) |

---

## 🤝 参与贡献

1. 阅读 [CONTEXT.md](./CONTEXT.md) — 理解领域模型
2. 阅读 [DEVELOPMENT.md](./DEVELOPMENT.md) — 开发注意事项
3. 扩展脚手架 — 在 `workspace/` 下添加新模板、Gotchas 或文档
4. 新增 LLM Provider — 实现 `AgentSession` 接口（参考 `lib/agent/deepseek.ts`）

**30+ Gotchas 已记录** — 覆盖 Canvas 尺寸、模块作用域、事件处理、文本渲染、碰撞检测等领域。

---

## 📄 许可证

MIT © 2024 AI Game Studio

---

<p align="center">
  <sub>Built with ❤️ using <a href="https://nextjs.org">Next.js</a> · <a href="https://platform.deepseek.com">DeepSeek</a> · <a href="https://tailwindcss.com">Tailwind CSS</a></sub>
</p>
