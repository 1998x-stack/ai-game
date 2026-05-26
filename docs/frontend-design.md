# 前端设计

## 概述

前端采用 Next.js 14 App Router + React 18，使用 Tailwind CSS 构建深色游戏美学界面。

## 组件架构

```
app/
├── page.tsx          → dynamic(() => import('./HomeContent'), { ssr: false })
├── HomeContent.tsx   → 主状态管理 + 分割面板布局
├── layout.tsx        → 根布局 (suppressHydrationWarning)
└── globals.css       → 全局样式 + CSS 动画

components/
├── ChatPanel.tsx       → 聊天面板
│   ├── SessionBar      → 会话 ID 展示 + 复制链接
│   ├── ReasoningBlock  → 推理内容 (可折叠)
│   ├── CodeBlock       → 代码块 (带语言标签 + 复制按钮)
│   ├── ToolCallCard    → 工具调用卡片 (可折叠)
│   └── renderContent   → Markdown 渲染器
├── GamePreview.tsx      → 游戏预览
│   └── iframe sandbox  → 沙箱 iframe + 全屏 + 刷新
├── SettingsModal.tsx    → API Key 配置
│   └── role="dialog"   → 无障碍对话框
└── ErrorConsole.tsx     → 运行时错误展示
    └── auto-expand     → 新错误自动展开
```

## SSR 策略

主页使用 `dynamic(() => import('./HomeContent'), { ssr: false })` 禁用 SSR。

**原因**：HomeContent 依赖浏览器 API：
- `crypto.randomUUID()` — 生成会话 ID
- `localStorage` — 存储 API Key 配置
- `window.innerWidth` — 响应式检测
- `navigator.clipboard` — 复制链接

这些 API 在服务端不可用。使用 `dynamic(ssr: false)` 确保页面仅在客户端渲染，避免水合不匹配。

**注意**：不要使用 `mounted`/`return null` 模式或 `Promise.resolve()` 模式 — React 18 strict mode 下仍可能产生水合错误。

## 设计系统

### 颜色 Token

```css
/* tailwind.config.ts */
panel: {
  'bg-deep':   '#0a0a1a',  /* 最深背景 */
  'bg':        '#1a1a2e',  /* 面板背景 */
  'surface':   '#16213e',  /* 卡片/气泡背景 */
  'border':    '#0f3460',  /* 边框 */
  'accent':    '#e94560',  /* 强调色 (红) */
  'accent-hover': '#d63850', /* 强调色悬停 */
  'text':      '#eaeaea',  /* 正文 */
  'muted':     '#8888aa',  /* 次要文本 */
  'muted-hover': '#aaaacc' /* 次要悬停 */
}
```

### CSS 动画

```css
@keyframes message-slide-in  { /* 消息入场 */ }
@keyframes fade-in-up        { /* 错误面板展开 */ }
@keyframes glow-pulse        { /* 强调色呼吸 */ }
@keyframes divider-glow      { /* 分割线发光 */ }
```

### Tailwind 扩展

```css
.animate-message-in  { animation: message-slide-in 0.3s ease-out forwards; }
.animate-fade-in-up  { animation: fade-in-up 0.25s ease-out forwards; }
```

## Markdown 渲染

ChatPanel 内置纯 React 实现的 Markdown 渲染器（零外部依赖），支持：

| 语法 | 渲染 |
|------|------|
| `**bold**` / `__bold__` | `<strong>` |
| `*italic*` / `_italic_` | `<em>` |
| `` `code` `` | `<code>` (等宽 + 暗背景) |
| ` ```lang ``` ` | 代码块 (语言标签 + 复制按钮) |
| `- item` / `* item` | `<ul>` (无序列表) |
| `1. item` | `<ol>` (有序列表) |
| `## heading` | 缩放标题 (H1-H6) |
| `[text](url)` | `<a>` (强调色链接) |
| `---` | 分割线 |

解析器按行处理：先识别块级元素（代码块、列表、标题、分割线、段落），再在段落内处理行内元素（代码、链接、粗体、斜体）。

## 无障碍

| 特性 | 实现 |
|------|------|
| `aria-label` | 8 个图标按钮 |
| `aria-expanded` | 可折叠元素 (推理块、工具调用卡) |
| `aria-live="polite"` | 消息列表 (屏幕阅读器播报) |
| `role="log"` | 消息容器 |
| `role="dialog"` | 设置模态框 |
| `aria-modal="true"` | 模态框焦点锁定 |
| Escape 键 | 关闭模态框 |
| 焦点管理 | 模态框打开时聚焦，关闭时恢复 |

## 响应式设计

- **桌面端** (>768px): 可拖拽分割面板 (聊天 30-55%, 游戏 剩余)
- **移动端** (<768px): 标签切换 (聊天/游戏)
- 设置模态框全尺寸适配
- 分割线 4px 宽，悬停发光，拖拽时 `cursor-col-resize`

## 会话管理

| 操作 | 实现 |
|------|------|
| 新会话 | `crypto.randomUUID()` → 新 sessionId |
| 恢复会话 | `?session={id}` URL 参数 → `fetch /api/session/{id}` → 恢复消息 + 游戏 |
| 复制链接 | `SessionBar` 显示 sessionId + 复制按钮 → `navigator.clipboard.writeText()` |
| 确认对话框 | 点击 "New Game" 时如存在消息/游戏，弹出 `role="alertdialog"` 确认 |
