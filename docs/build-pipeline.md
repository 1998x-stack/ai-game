# 构建流程

## 概述

构建管道 (`lib/build/packager.ts`) 将工作区的 `scripts/` 和 `assets/` 打包为单个自包含的 HTML 文件，注入沙箱 iframe 预览。

## 构建流程

```
┌─────────────────┐
│ scripts/         │
│  ├── utils.js    │  (工具库, 优先加载)
│  └── game.js     │  (游戏代码)
├─────────────────┤
│ assets/          │
│  ├── sprite.png  │  (可选)
│  └── sound.wav   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│              buildGame(workspacePath)        │
│                                              │
│  1. 读取 scripts/*.js                        │
│     ├── 排序: utils.js → game.js → 字母序    │
│     └── 读取内容                             │
│                                              │
│  2. 读取 assets/* (可选)                      │
│     ├── 检测 MIME 类型                        │
│     └── 转换为 base64 data URI               │
│                                              │
│  3. 构建 HTML                                 │
│     ├── <canvas id="gameCanvas">              │
│     ├── 错误处理器 (plain <script>)           │
│     ├── 资源映射 (window.__ASSETS__)           │
│     ├── 游戏代码 (<script type="module">)      │
│     └── game-ready 信号 (<script type="module">)│
│                                              │
│  4. 写入 output/index.html                    │
│                                              │
│  返回 { html, outputPath, errors }             │
└─────────────────────────────────────────────┘
```

## 生成 HTML 结构

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>AI Game</title>
  <style>
    body { margin:0; overflow:hidden; background:#000; }
    canvas { display:block; }
  </style>
</head>
<body>
  <canvas id="gameCanvas"></canvas>

  <!-- 1. 错误处理器 (plain script, 最先执行) -->
  <script>
    window.addEventListener('error', function(e) {
      window.parent.postMessage({
        type: 'game-error',
        message: e.message,
        source: e.filename,
        lineno: e.lineno,
        colno: e.colno
      }, '*');
    });
  </script>

  <!-- 2. 资源映射 (plain script, 模块前执行) -->
  <script>
    window.__ASSETS__ = {
      "sprite.png": "data:image/png;base64,...",
      "sound.wav": "data:audio/wav;base64,..."
    };
  </script>

  <!-- 3. 游戏代码 (module script, 延迟执行) -->
  <script type="module">
    // utils.js 内容 (export class GameLoop, ...)
    // game.js 内容 (使用 GameLoop, InputManager 等)
    // if (typeof startGame === 'function') startGame();
  </script>

  <!-- 4. game-ready 信号 (module script, 在游戏代码后执行) -->
  <script type="module">
    window.parent.postMessage({ type:'game-ready' }, '*');
  </script>
</body>
</html>
```

## 脚本执行顺序

模块脚本 (`type="module"`) 默认延迟执行，在所有同步脚本之后。因此执行顺序是：

1. **错误处理器** (plain) — 注册 error 监听
2. **资源映射** (plain) — 设置 `window.__ASSETS__`
3. **游戏代码** (module) — utils.js + game.js
4. **game-ready** (module) — 发送就绪信号

游戏代码和 game-ready 都是 module 脚本，按书写顺序执行 — 确保 game-ready 在游戏代码加载完成后才发送。

## 资源嵌入

| 文件类型 | MIME Type | 示例 |
|---------|-----------|------|
| `.png` | `image/png` | `data:image/png;base64,iVBOR...` |
| `.jpg` | `image/jpeg` | `data:image/jpeg;base64,/9j/...` |
| `.wav` | `audio/wav` | `data:audio/wav;base64,UklG...` |
| `.mp3` | `audio/mpeg` | `data:audio/mpeg;base64,SUQz...` |
| `.svg` | `image/svg+xml` | `data:image/svg+xml;base64,PHN2...` |

资源通过 `window.__ASSETS__[filename]` 访问：
```js
const img = new Image();
img.src = window.__ASSETS__['player.png'];
```

## 为什么用 `<script type="module">`

1. **`export`/`import` 支持** — `utils.js` 使用 `export class GameLoop` 等语法
2. **独立作用域** — 模块自动隔离，无需 IIFE 包装
3. **严格模式** — 模块默认 strict mode，防止隐式全局变量
4. **延迟执行** — DOM 就绪后才运行

## 窗口对象检测

打包器检测游戏代码是否显式赋值到 `window.*`。如果是，追加 `startGame()` 调用：

```js
// 检测: window.startGame = function() { ... }
// 追加: if (typeof startGame === 'function') startGame();
```
