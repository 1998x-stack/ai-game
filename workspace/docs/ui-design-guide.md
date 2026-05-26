# HTML5 Canvas UI Design Guide

Layout and rendering rules for game UIs on `<canvas>`. Read this **before** drawing any text, buttons, or HUD elements.

The build output already has `<canvas id="gameCanvas"></canvas>` — do NOT create another. See [Gotcha #12](gotchas.md#12-canvas-must-set-width-and-height) and [#13](gotchas.md#13-do-not-create-a-new-canvas-element).

---

## 1. Canvas Coordinate System

### Origin and Axes

- **Origin (0,0)** is the top-left corner of the canvas
- **X increases** moving right
- **Y increases** moving down
- The bottom-right corner is at `(canvas.width, canvas.height)`

```
(0,0) ──────────→ x
  │
  │
  ↓
  y
```

### Internal Resolution vs CSS Display Size

The canvas has **two sizes** that are often different:

| Property | What it controls | Set via |
|---|---|---|
| `canvas.width` / `canvas.height` | Drawing resolution (pixel grid) | JavaScript |
| `canvas.style.width` / `canvas.style.height` | Display size on screen | CSS / JavaScript |

```js
const canvas = document.getElementById('gameCanvas');
canvas.width = 800;   // Internal resolution: 800x600
canvas.height = 600;  // All drawing uses this coordinate space

canvas.style.width = '400px';  // CSS shrinks display to 400px
canvas.style.height = '300px'; // Browser scales canvas content automatically
```

**Critical rules:**
- All `ctx.drawImage`, `ctx.fillRect`, `ctx.arc`, `ctx.fillText` use **internal** coordinates (`canvas.width/height`)
- `ctx.measureText()` returns widths in the internal coordinate space
- Mouse/touch coordinates from DOM events are in **CSS pixels** — scale them: `(e.clientX - rect.left) * (canvas.width / rect.width)`
- The `InputManager` from utils.js handles this scaling automatically (see [game-dev-guide.md](game-dev-guide.md#mouse-input))

**Prefer `setupCanvas()`** from utils.js — it sets internal resolution, handles responsive CSS scaling, and registers resize handlers:
```js
const canvas = setupCanvas('gameCanvas', 800, 600);
const ctx = canvas.getContext('2d');
// canvas.width = 800, canvas.height = 600
// CSS display scales to fit container while preserving aspect ratio
```

See [game-dev-guide.md § Responsive Canvas Sizing](game-dev-guide.md#responsive-canvas-sizing) and [game-patterns.md § Responsive Design](game-patterns.md#responsive-design) for sizing strategies.

---

## 2. Text Rendering

Text on canvas is surprisingly tricky. The most common UI bugs come from misunderstanding how fonts, baselines, and alignment work.

### Font Format — Order Matters

```js
ctx.font = 'bold 16px monospace';
//         ^     ^   ^
//         style size family
```

The format is: `[style] [weight] [size] [family]`. The **size must come before the family**, separated by a space. Omitting or reordering these silently produces no visible text.

**Wrong:**
```js
ctx.font = '16px';           // No font family — renders as ''
ctx.font = 'monospace 16px'; // Wrong order — renders as ''
ctx.font = '16';             // Missing 'px' unit — renders as ''
```

**Correct:**
```js
ctx.font = '16px monospace';
ctx.font = 'bold 20px monospace';
ctx.font = '24px monospace, courier'; // Fallback chain
```

### Text Baseline — Text Does NOT Draw at the Given y

The `y` parameter of `fillText(text, x, y)` is the **baseline** position, not the top of the text. Text is drawn *above* the baseline.

```js
ctx.fillText('Hello', 10, 0);   // Text is invisible — baseline at y=0, text draws above canvas
ctx.fillText('Hello', 10, 100); // Baseline at y=100, text drawn above it
```

`textBaseline` controls where the `y` coordinate is anchored:

| Value | Behavior |
|---|---|
| `'top'` | `y` is the **top** of the text |
| `'middle'` | `y` is the **vertical center** of the text |
| `'bottom'` | `y` is the **bottom** of the text |
| `'alphabetic'` (default) | `y` is the alphabetic baseline |

**Visual example of each textBaseline value** (all drawn with `fillText(text, 100, 50)`):

```
                     y=50 reference line
                         │
top:    ┌─────────────────┤
        │ Hello World     │  (text below y=0, top at y=50)
        └─────────────────┤
                          │
middle: ┌─────────────────┤
        │   Hello World   │  (text centered on y=50)
        └─────────────────┤
                          │
bottom: ┌─────────────────┤
        │ Hello World     │  (text above y=50, bottom at y=50)
                         │
  (default) alphabetic:  ─┤─  (text sits on y=50 like letters on a line)
```

**Common mistake:** Using `'middle'` expecting it to center text at the y-coordinate — it does, but relative to the text's own height, not the canvas. For absolute canvas centering, combine with `canvas.height/2`.

### Text Alignment

```js
ctx.textAlign = 'left';   // (default) Text starts at x
ctx.textAlign = 'center'; // Text center aligns to x
ctx.textAlign = 'right';  // Text ends at x
```

**Critical:** When you set `textAlign = 'center'` for one piece of text, **reset it** to `'left'` before drawing left-aligned text. Failing to do this is one of the most common HUD layout bugs.

### Measuring Text Before Drawing

Always measure text when you need to center it, detect overflow, or dynamically size UI elements:

```js
ctx.font = '20px monospace';
const metrics = ctx.measureText('Score: 9999');
const textWidth = metrics.width; // Width in pixels within the current font

// Center text at a specific x:
ctx.textAlign = 'center';
ctx.fillText('Game Over', canvas.width / 2, canvas.height / 2);

// Right-align text with padding:
ctx.textAlign = 'right';
ctx.fillText('Score: 9999', canvas.width - 20, 30);
```

**`measureText()` returns correct values ONLY after `ctx.font` has been set.** Call `ctx.font = '...'` before measuring.

### Right-Align and Left-Align on the Same Line

```js
ctx.font = '16px monospace';

// Left side
ctx.textAlign = 'left';
ctx.fillText('Score: 100', 20, 30);

// Right side (same y, different x)
ctx.textAlign = 'right';
ctx.fillText('Time: 45s', canvas.width - 20, 30);

// Reset to default
ctx.textAlign = 'left';
```

---

## 3. HUD (Heads-Up Display) Patterns

HUD elements display player-facing information (score, lives, time, level). They must remain readable at all times and should not be affected by camera effects.

### Layering Order

HUD must be drawn **last**, after all game-world content, so it appears on top:

```js
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw game world (map, entities, effects)
    drawBackground();
    drawEntities();

    // 2. Draw screen effects (shake, flash)
    ctx.save();
    applyShake(ctx);  // Camera shake
    drawParticles();
    ctx.restore();

    // 3. Draw HUD last — on top of everything, no camera transform
    drawHUD();
}
```

### HUD Must Not Be Affected by Camera

If your game uses `ctx.save()`/`ctx.restore()` with camera transforms for the game world, the HUD must be drawn **outside** those transforms:

```js
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Game world — camera transforms applied
    ctx.save();
    ctx.translate(-camera.x, -camera.y);
    drawGameWorld();
    ctx.restore();

    // HUD — no camera transform, uses canvas coordinates directly
    drawHUD();
}
```

### HUD Layout Pattern

```js
function drawHUD() {
    ctx.save();
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#fff';

    // Top-left: score and level
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Score: ${score}`, 10, 10);
    ctx.font = '14px monospace';
    ctx.fillText(`Level ${level}`, 10, 34);

    // Top-right: time and lives
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`Time: ${Math.floor(gameTime)}s`, canvas.width - 10, 10);

    // Icon-style lives (hearts or dots)
    ctx.textAlign = 'right';
    ctx.fillText(`❤ ${lives}`, canvas.width - 10, 34);

    ctx.restore();
}
```

### Semi-Transparent HUD Backgrounds

Text directly over game content can be unreadable. Add background bars or boxes:

```js
function drawScorePanel() {
    const x = 8, y = 8, w = 200, h = 48;

    // Semi-transparent background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();

    // Text on top
    ctx.fillStyle = '#fff';
    ctx.font = '16px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Score: ${score}`, x + 12, y + h / 2);
}
```

**Note:** `ctx.roundRect()` is available in modern browsers but may need a polyfill. For broader compatibility, draw rounded rects manually or use `ctx.fillRect()`.

### High Score Display

```js
function drawHighScore() {
    ctx.save();
    ctx.font = '14px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Best: ${highScore}`, canvas.width / 2, canvas.height - 10);
    ctx.restore();
}
```

Always wrap localStorage in try-catch — see [Gotcha #19](gotchas.md#19-localstorage-may-fail-in-sandboxed-iframes).

---

## 4. Canvas Sizing and Responsive Design

### Always Set Width and Height in JavaScript

The `<canvas>` default is 300×150. All games must set dimensions. See [Gotcha #12](gotchas.md#12-canvas-must-set-width-and-height).

### Design Resolution Pattern

Work in a fixed design space and let CSS handle display scaling:

```js
const DESIGN_W = 800;
const DESIGN_H = 600;

const canvas = document.getElementById('gameCanvas');
canvas.width = DESIGN_W;
canvas.height = DESIGN_H;

function resizeCanvas() {
    const parent = canvas.parentElement;
    const maxW = parent.clientWidth || window.innerWidth;
    const maxH = parent.clientHeight || window.innerHeight;
    const scale = Math.min(maxW / DESIGN_W, maxH / DESIGN_H, 1);

    canvas.style.width = `${DESIGN_W * scale}px`;
    canvas.style.height = `${DESIGN_H * scale}px`;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
```

All UI calculations reference `canvas.width` and `canvas.height` (the design space), never `canvas.style.width` or browser window dimensions:

```js
// Correct — positions relative to design space
const centerX = canvas.width / 2;
const centerY = canvas.height / 2;

// Wrong — these are CSS pixels, not design space
const wrongX = canvas.style.width;  // e.g. '400px' as a string
const wrongY = window.innerWidth;    // Browser viewport width
```

### Minimum Playable Area

Never let the canvas shrink below a minimum size. Clamp the scale:

```js
const scale = Math.min(maxW / DESIGN_W, maxH / DESIGN_H, 1);
const MIN_SCALE = 0.4;
const effectiveScale = Math.max(scale, MIN_SCALE);
```

Or warn the user if the container is too small to play.

---

## 5. Menu Screens and Overlays

### Full-Screen Overlay Pattern

Menus, pause screens, and game-over screens use a semi-transparent overlay covering the entire canvas:

```js
function drawOverlay(alpha = 0.7) {
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}
```

### Centered Text on Overlays

```js
function drawCenteredText(text, yOffset = 0, fontSize = 48, color = '#fff') {
    ctx.save();
    ctx.font = `bold ${fontSize}px monospace, courier`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + yOffset);
    ctx.restore();
}

// Usage on a game-over overlay:
drawOverlay(0.8);
drawCenteredText('GAME OVER', -40, 48, '#f44');
drawCenteredText(`Score: ${score}`, 20, 24, '#fff');
drawCenteredText('Press SPACE to restart', 60, 16, '#aaa');
```

### Button Rectangles

Buttons are drawn shapes with centered text. Hit detection checks mouse/touch coordinates against the button rect.

```js
function drawButton(text, x, y, w, h, color = '#4488ff', hoverColor = '#66aaff') {
    const isHovered = CollisionDetector.pointInRect(input.mouse.x, input.mouse.y, { x, y, width: w, height: h });

    ctx.save();
    ctx.fillStyle = isHovered ? hoverColor : color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Centered text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    ctx.restore();

    return { x, y, width: w, height: h }; // Return rect for hit detection
}
```

### State-Based Rendering

Render ONE state at a time. The render function switches based on the current game state:

```js
function render() {
    switch (state) {
        case 'menu':
            drawMenu();
            break;
        case 'playing':
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawGameWorld();
            drawHUD();
            break;
        case 'paused':
            drawGameWorld();        // Game still visible in background
            drawHUD();
            drawPauseOverlay();     // But dimmed by overlay
            break;
        case 'gameover':
            drawGameWorld();
            drawHUD();
            drawGameOverOverlay();
            break;
    }
}
```

Never render multiple screens composited together (e.g., drawing the menu on top of a running game).

---

## 6. Font and Color Guidelines

### Font Choices

| Use Case | Font | Reasoning |
|---|---|---|
| HUD text (scores, timers) | `monospace` | Fixed-width — numbers don't jitter as they change |
| Menu titles | `bold 36-48px monospace` | Bold, large, readable |
| Menu body text | `16-20px monospace` | Consistent with game aesthetic |
| Instructions | `14-16px monospace` | Smaller, less prominent |

### Always Set Font Before Measuring or Drawing

The canvas font persists between frames, but relying on this is fragile. Always set the font explicitly:

```js
// Always:
ctx.font = '16px monospace';
ctx.fillText('Hello', 10, 10);

// Never assume the previous font is still set — another function may have changed it
```

### Font Fallback Chain

```js
ctx.font = '16px monospace, courier, sans-serif';
// Tries monospace, then courier, then any sans-serif on the system
```

### Color Contrast Rules

- **Light text** on dark/transparent backgrounds: `#fff` or `#ddd` on `rgba(0,0,0,0.6)`
- **Dark text** needs a solid light background: `#000` on `#fff` or `#ddd`
- **Colored text** (e.g., red for warnings): ensure contrast ratio ≥ 4.5:1
- **Avoid pure white on pure black** for small text — the contrast causes eye strain. Use `#ddd` on `#111` or `#fff` on `rgba(0,0,0,0.7)`

### Prefer rgba Over globalAlpha

```js
// Correct — only affects this one draw call
ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Avoid — affects ALL subsequent drawing until reset
ctx.globalAlpha = 0.5;
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.globalAlpha = 1; // Easy to forget, causing faded subsequent draws
```

### Color Palette for HUD

```js
const UI = {
    primary:   '#ffffff',  // Main text
    secondary: '#aaaaaa',  // Labels, less important info
    accent:    '#ffcc00',  // Important values (score, level)
    danger:    '#ff4444',  // Low health, warnings
    bg:        'rgba(0,0,0,0.6)', // Panel backgrounds
    border:    'rgba(255,255,255,0.3)' // Panel borders
};
```

---

## 7. Common UI Mistakes

### Mistake 1: Drawing Text at y=0

**Wrong:**
```js
ctx.fillText('Score: 0', 10, 0);
// Text baseline is at y=0 — text draws above it, off the canvas
```

**Correct:**
```js
ctx.textBaseline = 'top';
ctx.fillText('Score: 0', 10, 10);
// Or with default baseline:
ctx.fillText('Score: 0', 10, 30); // 30px down from top
```

### Mistake 2: Not Resetting textAlign After Centered Text

**Wrong:**
```js
function drawTitle() {
    ctx.textAlign = 'center';
    ctx.fillText('GAME TITLE', canvas.width / 2, 100);
}

function drawHUD() {
    ctx.fillText('Score: 0', 10, 30); // Still centered! Position is wrong.
}
```

**Correct:**
```js
function drawTitle() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillText('GAME TITLE', canvas.width / 2, 100);
    ctx.restore(); // Restores all canvas state including textAlign
}

// Or reset explicitly:
function drawHUD() {
    ctx.textAlign = 'left';
    ctx.fillText('Score: 0', 10, 30);
}
```

### Mistake 3: Using CSS Dimensions for Layout Calculations

**Wrong:**
```js
const centerX = canvas.style.width / 2; // Result: NaN or wrong value
const centerY = window.innerHeight / 2; // Uses viewport, not canvas
```

**Correct:**
```js
const centerX = canvas.width / 2;   // Internal resolution (design space)
const centerY = canvas.height / 2;
```

### Mistake 4: Drawing HUD Before Game Content

**Wrong:**
```js
function render() {
    drawHUD();       // HUD drawn first
    drawEntities();  // Entities drawn on TOP of HUD — HUD is hidden
}
```

**Correct:**
```js
function render() {
    drawEntities();  // Game world first
    drawHUD();       // HUD on top
}
```

### Mistake 5: Not Using ctx.save()/ctx.restore()

**Wrong:**
```js
function drawMenuButton() {
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(100, 200, 200, 50);
    ctx.fillStyle = '#fff'; // Must reset manually after
}

function drawScore() {
    ctx.fillStyle = '#0f0'; // Oops — inherited '#4488ff' from previous bug
}
```

**Correct:**
```js
function drawMenuButton() {
    ctx.save();
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(100, 200, 200, 50);
    ctx.fillStyle = '#fff';
    ctx.fillText('PLAY', 200, 225);
    ctx.restore(); // All style changes reverted
}
```

### Mistake 6: Forgetting to Set fillStyle Before fillText

Canvas remembers the last fillStyle. If the previous draw call set it to a dark color and the next fillText doesn't set it explicitly, text becomes invisible:

```js
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, 100, 100);
// ...
ctx.fillText('Score: 0', 10, 10); // #000 text on #000 background — invisible!
```

Always set `ctx.fillStyle` before `ctx.fillText()`.

### Mistake 7: Untested Emoji in fillText

Emoji rendering in `ctx.fillText()` varies wildly across browsers and OS versions. Some emoji render as colored rectangles, others at the wrong size, others as two characters.

```js
// Risk of broken rendering:
ctx.fillText('❤ Lives: 3', 10, 30); // Heart may show as ☐ on some systems

// Safer: use text or programmatic icons
function drawHeart(ctx, x, y, size) {
    ctx.font = `${size}px monospace`;
    ctx.fillText('♥', x, y); // Alt+3 (♥) is more reliable than emoji (❤)
}

// Even safer: draw hearts with shapes
function drawHeartShape(ctx, cx, cy, size) {
    ctx.beginPath();
    ctx.arc(cx - size / 2, cy, size / 2, Math.PI, 0);
    ctx.arc(cx + size / 2, cy, size / 2, Math.PI, 0);
    ctx.fill();
}
```

### Mistake 8: Using the Same Font Size for All HUD Elements

Hierarchy matters. A level indicator should be smaller than a score. A game-over title should be larger than instructions:

```js
// Wrong — all same size
ctx.font = '20px monospace';
ctx.fillText('Score: 100', 10, 25);
ctx.fillText('Level: 3', 10, 50);
ctx.fillText('Press P to pause', 10, 75);

// Correct — visual hierarchy
ctx.font = 'bold 22px monospace'; // Score — most important
ctx.fillText(`Score: ${score}`, 10, 25);
ctx.font = '14px monospace';       // Level — secondary
ctx.fillText(`Level ${level}`, 10, 52);
ctx.font = '12px monospace';       // Hint — least important
ctx.fillText('Press P to pause', 10, 75);
```

---

## 8. Performance Tips for UI

### Cache Static UI to an Offscreen Canvas

If your menu background or HUD panel doesn't change, draw it once to an offscreen canvas and composite it:

```js
// Create cache once
let hudCache = null;

function buildHUDCache() {
    hudCache = document.createElement('canvas');
    hudCache.width = canvas.width;
    hudCache.height = canvas.height;
    const cacheCtx = hudCache.getContext('2d');

    // Draw static UI elements
    cacheCtx.fillStyle = 'rgba(0,0,0,0.5)';
    cacheCtx.fillRect(0, 0, canvas.width, 50); // Top bar
    cacheCtx.font = '14px monospace';
    cacheCtx.fillStyle = '#888';
    cacheCtx.textAlign = 'right';
    cacheCtx.fillText('v1.0', canvas.width - 10, 40);
}

// In render:
if (!hudCache) buildHUDCache();
ctx.drawImage(hudCache, 0, 0);
// Then draw dynamic text on top (score, time, etc.)
```

### Redraw HUD Only When Values Change

Track dirty flags to skip redundant draw calls:

```js
let dirtyFlags = { score: true, lives: true, time: true };
let lastScore = -1, lastLives = -1;

function setScore(v) {
    score = v;
    dirtyFlags.score = true;
}

function drawScore() {
    if (!dirtyFlags.score && score === lastScore) return;
    lastScore = score;

    // Clear old score area
    ctx.clearRect(10, 8, 150, 24);

    // Draw new score
    ctx.font = '16px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Score: ${score}`, 10, 10);

    dirtyFlags.score = false;
}
```

### Use requestAnimationFrame, Not setInterval

The GameLoop class from utils.js uses requestAnimationFrame internally. See [Gotcha #15](gotchas.md#15-do-not-use-setintervalsettimeout-for-game-loops).

### Avoid setTransform for Simple UI

Camera transforms should be isolated to game-world drawing. For UI elements, draw at absolute coordinates:

```js
// Correct: camera transform only for game world
ctx.save();
ctx.translate(-camera.x, -camera.y);
drawGameWorld();
ctx.restore();
drawHUD(); // Uses plain fillText/fillRect at absolute coordinates

// Avoid: using setTransform to "undo" camera for HUD
ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform — fragile, easy to miss
drawHUD();
```

### Batch Color and Font Changes

Minimize state changes by drawing all text that shares the same font and color together:

```js
// Slow — changing font per call
ctx.font = '16px monospace'; ctx.fillText('A', 10, 10);
ctx.font = '16px monospace'; ctx.fillText('B', 30, 10);
ctx.font = '16px monospace'; ctx.fillText('C', 50, 10);

// Fast — set once, draw many
ctx.font = '16px monospace';
ctx.fillText('A', 10, 10);
ctx.fillText('B', 30, 10);
ctx.fillText('C', 50, 10);
```

---

## Reference Summary

| Topic | Where to look |
|---|---|
| Canvas sizing and setup | [game-dev-guide.md § Responsive Canvas Sizing](game-dev-guide.md#responsive-canvas-sizing), `setupCanvas()` in utils.js |
| Mouse/touch coordinate mapping | [game-dev-guide.md § Mouse Input](game-dev-guide.md#mouse-input), `InputManager` in utils.js |
| Game state management | [game-dev-guide.md § Game States](game-dev-guide.md#game-states), [game-patterns.md § State Machine](game-patterns.md#state-machine) |
| Easing for UI animations | [game-patterns.md § Easing Functions](game-patterns.md#easing-functions) |
| Canvas must set width/height | [Gotcha #12](gotchas.md#12-canvas-must-set-width-and-height) |
| localStorage in sandbox | [Gotcha #19](gotchas.md#19-localstorage-may-fail-in-sandboxed-iframes) |
| Canvas context may be null | [Gotcha #20](gotchas.md#20-canvas-context-may-be-null) |
