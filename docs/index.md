# AI Game Studio 文档

## 快速导航

| 文档 | 内容 |
|------|------|
| [系统架构](./architecture.md) | 整体架构、数据流、模块关系 |
| [Agent SDK](./agent-sdk.md) | Agent 工厂模式、DeepSeek 适配器、工具定义、流式输出 |
| [构建流程](./build-pipeline.md) | scripts + assets → 单文件 HTML、脚本排序、模块化处理 |
| [脚手架系统](./scaffold-system.md) | 知识库结构、Gotchas、模板、Utils 扩展 |
| [技能系统](./skills-system.md) | Skills 目录、YAML 元数据、load_skills 工具、经验飞轮 |
| [工具系统分析](./tool-analysis.md) | 10 个工具详解、子代理系统、路径安全、扩展指南 |
| [API 接口](./api-reference.md) | /api/chat、/api/build、/api/preview、/api/session |
| [前端设计](./frontend-design.md) | 组件架构、SSR 策略、设计系统、Markdown 渲染 |
| [部署指南](./deployment.md) | 本地开发、生产部署、GitHub Pages、环境变量 |

## 快速开始

```bash
git clone https://github.com/1998x-stack/ai-game.git
cd ai-game
npm install
npm run dev
# 打开 http://localhost:3000，配置 DeepSeek API Key
```

## 项目定位

AI Game Studio 是一个基于 LLM Agent 的 HTML5 游戏代码生成服务。用户通过自然语言描述游戏需求，Agent 自动读取脚手架知识库、生成游戏代码、构建打包、即时预览。支持多轮对话迭代优化，会话持久化恢复。

**核心技术栈**: Next.js 14 · TypeScript · DeepSeek API · HTML5 Canvas · Tailwind CSS
