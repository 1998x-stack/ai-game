# 技能系统

## 概述

技能 (Skills) 是可复用的领域知识文件，Agent 在生成游戏前自动加载匹配的技能以获取特定领域的最佳实践。

## 目录结构

```
workspace/skills/
├── README.md              # 技能系统概述
├── skill-creator.md       # 技能创建模板和指南
└── examples/
    ├── pixel-art-games.md       # 像素艺术游戏
    └── game-sound-effects.md    # 游戏音效
```

## 技能文件格式

每个技能文件包含 YAML 前置元数据 + Markdown 正文：

```markdown
---
name: pixel-art-games
description: Pixel art rendering with crisp scaling...
triggers: pixel art, retro, 8-bit, 16-bit, low-res
---

# Pixel Art Games

## When to Use
...

## Core Patterns
...

## Gotchas
...
```

### 元数据字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 技能唯一标识 |
| `description` | string | 简短描述 |
| `triggers` | string | 触发关键词 (逗号分隔) |

## load_skills 工具

Agent 通过 `load_skills` 工具自动发现可用技能：

```
load_skills() → 扫描 skills/examples/*.md
              → 解析每个文件的 YAML 前置元数据
              → 返回 JSON 数组

返回示例:
[
  {
    "file": "pixel-art-games.md",
    "name": "pixel-art-games",
    "description": "Pixel art rendering with crisp scaling...",
    "triggers": "pixel art, retro, 8-bit, 16-bit, low-res"
  },
  {
    "file": "game-sound-effects.md",
    "name": "game-sound-effects",
    "description": "Sound effects and audio...",
    "triggers": "sound, audio, sfx, music, beep"
  }
]
```

## 自动匹配流程

```
用户: "Make a retro pixel art shooter with sound effects"
  │
  ▼
Agent: load_skills()
  │
  ▼
匹配分析:
  "retro"        → pixel-art-games.triggers ✓
  "pixel art"    → pixel-art-games.triggers ✓
  "sound effects"→ game-sound-effects.triggers ✓
  │
  ▼
Agent: read_file('skills/examples/pixel-art-games.md')
       read_file('skills/examples/game-sound-effects.md')
  │
  ▼
Agent 应用技能中的模式和 Gotchas 到生成的代码中
```

## 创建新技能

### 通过 skill-creator.md 模板

```
1. Agent 读取 skills/skill-creator.md → 了解技能格式
2. Agent 使用 write_file 写入 skills/examples/{name}.md
3. 文件包含 YAML 前置元数据 + 完整的 Markdown 正文
4. 下次 load_skills() 调用时自动发现
```

### 技能结构要求

每个技能应包含：
- **When to Use** — 什么场景触发此技能
- **Core Patterns** — 可复用的代码模式
- **Gotchas** — 领域特定陷阱（至少 2 条）
- **Integration with Utils** — 如何使用已有工具库
- **Examples** — 完整示例

## 经验飞轮

技能系统是整个经验飞轮的一部分：

```
┌───────────────────────────────────────────────┐
│              经验飞轮                           │
│                                                │
│  scripts/utils.js  ← APPEND 新工具函数          │
│  docs/gotchas.md   ← APPEND 新陷阱规则          │
│  skills/examples/  ← CREATE 新领域技能          │
│                                                │
│  每次生成游戏 → 发现问题 → 沉淀为工具/规则/技能   │
│      ↑                              ↓           │
│      └──── 后续游戏质量提升 ←────────┘           │
└───────────────────────────────────────────────┘
```

### 现有技能

| 技能 | 触发词 | 内容 |
|------|--------|------|
| `pixel-art-games.md` | pixel art, retro, 8-bit, 16-bit, low-res | 像素渲染、整数坐标、瓦片网格 |
| `game-sound-effects.md` | sound, audio, sfx, music, beep | SoundManager、beep 合成、音频加载 |
| `skill-creator.md` | create skill, new skill | 技能创建模板和指南 |

### 建议扩展的技能

- `platformer-physics.md` — 平台跳跃物理
- `particle-systems.md` — 粒子效果发射器
- `enemy-ai.md` — 敌人 AI 模式
- `level-generation.md` — 关卡程序化生成
- `mobile-controls.md` — 移动端虚拟摇杆
