# Game Development Gotchas

Common mistakes and anti-patterns in HTML5 canvas game development, with concrete examples.

---

## 1. Snake Cannot Turn 180 Degrees

**Description:** In Snake, pressing the opposite direction in the same frame should be ignored. If the snake is moving right, pressing left should do nothing — otherwise the snake instantly collides with itself.

**Wrong:**
```js
function handleInput(key) {
    switch (key) {
        case 'ArrowUp':    snake.direction = 'up'; break;
        case 'ArrowDown':  snake.direction = 'down'; break;
        case 'ArrowLeft':  snake.direction = 'left'; break;
        case 'ArrowRight': snake.direction = 'right'; break;
    }
}
```

**Correct:**
```js
const OPPOSITE = {
    'up': 'down',
    'down': 'up',
    'left': 'right',
    'right': 'left'
};

let pendingDirection = null;

function handleInput(key) {
    const dirMap = {
        'ArrowUp': 'up', 'KeyW': 'up',
        'ArrowDown': 'down', 'KeyS': 'down',
        'ArrowLeft': 'left', 'KeyA': 'left',
        'ArrowRight': 'right', 'KeyD': 'right'
    };

    const newDir = dirMap[key];
    if (!newDir) return;

    // Check opposite against BOTH current AND pending direction
    if (newDir !== OPPOSITE[snake.direction]) {
        pendingDirection = newDir;
    }
}

// Apply pending direction at start of next movement tick
function moveSnake() {
    if (pendingDirection) {
        snake.direction = pendingDirection;
        pendingDirection = null;
    }
    // ... move snake
}
```

---

## 2. Random Number Generation Must Ensure Non-Zero Intervals

**Description:** When spawning objects at random positions, the random range must account for the object's size. Otherwise objects can overlap or spawn partially outside the canvas.

**Wrong:**
```js
function spawnFood() {
    food.x = Math.floor(Math.random() * canvas.width);
    food.y = Math.floor(Math.random() * canvas.height);
    // Food could spawn overlapping the snake!
}
```

**Correct:**
```js
function spawnFood() {
    // Only spawn on grid-aligned positions not occupied by the snake
    const available = [];
    for (let x = 0; x < gridCols; x++) {
        for (let y = 0; y < gridRows; y++) {
            if (!snake.body.some(s => s.x === x && s.y === y)) {
                available.push({ x, y });
            }
        }
    }
    if (available.length === 0) return; // No space!
    const pos = available[Math.floor(Math.random() * available.length)];
    food.gridX = pos.x;
    food.gridY = pos.y;
}
```

---

## 3. Game Loop Must Use Delta Time

**Description:** Without delta time, game speed varies with frame rate. A game running at 144fps will be 2.4x faster than at 60fps.

**Wrong:**
```js
let lastTime = 0;
function gameLoop() {
    player.x += 5; // Moves 5px per frame
    // At 60fps: 300px/s, at 144fps: 720px/s
    requestAnimationFrame(gameLoop);
}
```

**Correct:**
```js
let lastTime = 0;
function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // Capped at 50ms
    lastTime = timestamp;

    // Speed is now frame-rate independent
    player.x += 300 * dt; // Always 300px/s

    requestAnimationFrame(gameLoop);
}
```

---

## 4. Canvas Must Be Cleared Before Each Frame

**Description:** Failing to clear the canvas causes ghost trails as old frames persist. This is especially visible in games with moving objects.

**Wrong:**
```js
function render() {
    drawPlayer(); // Player from previous frame is still visible!
    drawEnemies();
    // Canvas accumulates old drawings
}
```

**Correct:**
```js
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPlayer();
    drawEnemies();
}
```

For performance, only clear the region that changed:
```js
ctx.clearRect(prevX - 1, prevY - 1, width + 2, height + 2);
```

---

## 5. Keyboard Events Must Use `event.code` Not `event.key`

**Description:** `event.key` returns the character typed, which changes with keyboard layout. WASD on AZERTY keyboards maps to ZQSD with `event.key` but stays correct with `event.code`.

**Wrong:**
```js
document.addEventListener('keydown', (e) => {
    if (e.key === 'w') player.moveUp();   // Fails on AZERTY keyboards
    if (e.key === 'a') player.moveLeft();  // Fails on AZERTY keyboards
});
```

**Correct:**
```js
document.addEventListener('keydown', (e) => {
    // event.code is physical key position, consistent across layouts
    if (e.code === 'KeyW') player.moveUp();
    if (e.code === 'KeyA') player.moveLeft();
    if (e.code === 'ArrowUp') player.moveUp();
    if (e.code === 'ArrowLeft') player.moveLeft();

    e.preventDefault(); // Prevent page scrolling
});
```

---

## 6. requestAnimationFrame Must Be Cancelled on Unmount/Cleanup

**Description:** When leaving the game page or unmounting the canvas, the game loop keeps running. This wastes CPU, drains battery, and can cause errors if the DOM is removed.

**Wrong:**
```js
let rafId = null;

function start() {
    function loop() {
        update();
        render();
        rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
}

// Page hidden or component unmounted — loop keeps running!
```

**Correct:**
```js
let rafId = null;
let running = false;

function start() {
    if (running) return;
    running = true;
    loop(performance.now());
}

function loop(timestamp) {
    if (!running) return;
    update(timestamp);
    render();
    rafId = requestAnimationFrame(loop);
}

function stop() {
    running = false;
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

// Visibility change handler
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stop();
    } else if (/* game was active */) {
        start();
    }
});
```

---

## 7. Collision Detection Must Happen Before Rendering, Not After

**Description:** If collision detection runs after the render pass, players see objects visually overlapping for one frame. The render shows the state from the *previous* frame's collision resolution.

**Wrong:**
```js
function gameLoop(timestamp) {
    const dt = /* ... */;
    render();          // Render FIRST
    update(dt);        // Then update — shows old state!
    requestAnimationFrame(gameLoop);
}
```

**Correct:**
```js
function gameLoop(timestamp) {
    const dt = /* ... */;
    update(dt);        // Update first (including collision detection)
    render();          // Then render the resolved state
    requestAnimationFrame(gameLoop);
}
```

---

## 8. Game State Transitions Must Happen at Start of Frame, Not Mid-Frame

**Description:** Changing game state mid-update leaves some objects updating with old rules and others with new rules. This causes visual glitches, missed collisions, and inconsistent behavior.

**Wrong:**
```js
function update(dt) {
    updatePlayer(dt);
    if (player.health <= 0) {
        state = 'gameover'; // BAD: mid-frame transition
    }
    updateEnemies(dt); // These may or may not run depending on state
}
```

**Correct:**
```js
let nextState = null;

function update(dt) {
    updatePlayer(dt);
    if (player.health <= 0) {
        nextState = 'gameover'; // Defer transition
    }
    updateEnemies(dt); // Always runs this frame

    // Apply transition at START of next frame
}

function gameLoop(timestamp) {
    const dt = /* ... */;

    // Handle state transition at start of frame
    if (nextState) {
        state = nextState;
        nextState = null;
        onEnterState(state);
    }

    if (state === 'playing') {
        update(dt);
    }
    render();
    requestAnimationFrame(gameLoop);
}
```

---

## 9. Always Clamp Player Position to Canvas Bounds

**Description:** Without bounds clamping, players can move entities off the visible canvas area and lose them. At minimum, the player character should always remain fully or partially visible.

**Wrong:**
```js
function updatePlayer(dt) {
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    // Player can move off the canvas forever
}
```

**Correct:**
```js
function updatePlayer(dt) {
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    // Clamp to canvas bounds (accounting for entity size)
    player.x = clamp(player.x, 0, canvas.width - player.width);
    player.y = clamp(player.y, 0, canvas.height - player.height);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
```

For partial visibility (enemies that should partially exit the screen):
```js
const MARGIN = -20; // Allow 20px off-screen
enemy.x = clamp(enemy.x, MARGIN, canvas.width - enemy.width - MARGIN);
enemy.y = clamp(enemy.y, MARGIN, canvas.height - enemy.height - MARGIN);
```

---

## 10. Use CSS `image-rendering: pixelated` for Pixel-Art Games

**Description:** When canvas content is scaled up (e.g., 200x200 pixel art stretched to 800x800), browsers default to bilinear interpolation which blurs pixel art. The CSS `image-rendering` property must be set to `pixelated`.

**Wrong:**
```html
<canvas id="gameCanvas" width="200" height="200" style="width: 800px; height: 800px;"></canvas>
<!-- Pixel art will appear blurry when scaled up -->
```

**Correct:**
```html
<style>
    #gameCanvas {
        width: 800px;
        height: 800px;
        image-rendering: pixelated;
        image-rendering: crisp-edges; /* Fallback for older browsers */
    }
</style>
<canvas id="gameCanvas" width="200" height="200"></canvas>
```

Also apply to any `<img>` elements used for pixel-art sprites:
```css
canvas, img[src*="sprite"], .pixel-art {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
}
```

For canvas 2D context, disable anti-aliasing for geometric shapes:
```js
ctx.imageSmoothingEnabled = false; // Disable smoothing for drawImage
```

## 11. Do NOT Redeclare Scaffold Utilities

**Problem**: `scripts/utils.js` is pre-loaded in the same module scope before `game.js`. It exports `GameLoop`, `InputManager`, `CollisionDetector`, `SpriteManager`, `Animation`, `SoundManager`, `ObjectPool`, and utility functions (`randomInt`, `clamp`, `lerp`, `distance`, `angleBetween`, `setupCanvas`). These are already available — redeclaring any of them in `game.js` causes `"Identifier has already been declared"` at runtime.

**Wrong**:
```js
class GameLoop { // ❌ Already exported from utils.js — duplicate declaration error
  constructor() { ... }
}
```

**Correct**:
```js
const loop = new GameLoop((dt) => { // ✅ Use pre-loaded GameLoop directly
  update(dt);
  render();
});
loop.start();
```

---

## 12. Canvas Must Set Width and Height

**Description:** The HTML `<canvas>` element defaults to 300x150 pixels if width/height attributes are not set. Drawing outside this area or expecting a larger canvas will produce invisible results. The build output's canvas has NO width/height attributes — you MUST set them in JavaScript.

**Wrong:**
```js
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
// Canvas is still 300x150 — anything drawn at larger coordinates is invisible
ctx.fillRect(400, 300, 50, 50); // Not visible!
```

**Correct:**
```js
const canvas = document.getElementById('gameCanvas');
canvas.width = 800;
canvas.height = 600;
const ctx = canvas.getContext('2d');
ctx.fillRect(400, 300, 50, 50); // Visible at (400, 300)
```

Or use the `setupCanvas` utility (already available from utils.js):
```js
const canvas = setupCanvas('gameCanvas', 800, 600);
const ctx = canvas.getContext('2d');
```

---

## 13. Do NOT Create a New Canvas Element

**Description:** The build pipeline already includes `<canvas id="gameCanvas"></canvas>` in the HTML. Creating another canvas via `document.createElement` and appending it leaves TWO canvases — one blank and one with content. Always grab the existing canvas.

**Wrong:**
```js
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const ctx = canvas.getContext('2d');
// Now there are two canvases — game appears on the new one, old one is blank
```

**Correct:**
```js
const canvas = document.getElementById('gameCanvas');
canvas.width = 800;
canvas.height = 600;
const ctx = canvas.getContext('2d');
```

Or use the utility:
```js
const canvas = setupCanvas('gameCanvas', 800, 600);
```

---

## 14. Module Scope — No IIFE Needed

**Description:** All scripts run inside a single `<script type="module">`. Each script's top-level variables are module-scoped by default. Wrapping code in an IIFE `(function(){...})()` or using `'use strict'` is unnecessary and doesn't cause errors but clutters the code.

**Wrong:**
```js
(function() {
    'use strict';
    const canvas = document.getElementById('gameCanvas');
    // ... wrapped in unnecessary IIFE
})();
```

**Correct:**
```js
// Top-level variables are module-scoped — no wrapper needed
const canvas = document.getElementById('gameCanvas');
canvas.width = 800;
canvas.height = 600;
const ctx = canvas.getContext('2d');
```

Note: `var` declarations do NOT create global properties inside modules either. Prefer `const` and `let`.

---

## 15. Do Not Use setInterval/setTimeout for Game Loops

**Description:** `setInterval` and `setTimeout` do not synchronize with the display refresh rate, drift over time, and continue running when the tab is hidden. Always use `requestAnimationFrame` for game loops.

**Wrong:**
```js
setInterval(() => {
    update();
    render();
}, 1000 / 60);
// Drifts, doesn't pause on tab hide, runs even when not visible
```

**Correct:**
```js
function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    update(dt);
    render();
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
```

Or use the pre-loaded `GameLoop` class:
```js
const loop = new GameLoop((dt) => { update(dt); render(); });
loop.start();
```

---

## 16. Touch Events Need preventDefault

**Description:** Without `e.preventDefault()` in touch event handlers, the browser interprets touch gestures as page scrolling or zooming. This causes the game canvas to scroll out of view and breaks game controls on mobile.

**Wrong:**
```js
canvas.addEventListener('touchstart', (e) => {
    // Page scrolls when user touches the canvas!
    const touch = e.touches[0];
    player.x = touch.clientX;
});
```

**Correct:**
```js
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevent scroll/zoom
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    player.x = (touch.clientX - rect.left) * (canvas.width / rect.width);
    player.y = (touch.clientY - rect.top) * (canvas.height / rect.height);
}, { passive: false }); // passive: false required for preventDefault

// Also apply to touchmove:
canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    // Update touch position...
}, { passive: false });
```

---

## 17. Game Loop Cleanup on Unload

**Description:** When the game page is unloaded or the component unmounts, the requestAnimationFrame loop keeps running. This wastes CPU and can cause errors if the canvas is removed from the DOM. Always provide a cleanup function that removes event listeners and cancels the loop.

**Wrong:**
```js
function start() {
    requestAnimationFrame(function loop() {
        update();
        render();
        requestAnimationFrame(loop);
    });
}
// No way to stop — loop runs forever even after page unload
```

**Correct:**
```js
let rafId = null;
let running = false;

function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
}

function tick(timestamp) {
    if (!running) return;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    update(dt);
    render();
    rafId = requestAnimationFrame(tick);
}

function stop() {
    running = false;
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

// Clean up ALL event listeners
function cleanup() {
    stop();
    document.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('touchstart', onTouchStart);
}

// Using GameLoop class (pre-loaded):
// const loop = new GameLoop((dt) => { update(dt); render(); });
// loop.start();
// loop.stop(); // Handles rAF cancellation internally
```

---

## 18. Use requestAnimationFrame Timestamp, Not performance.now()

**Description:** The `requestAnimationFrame` callback receives a `DOMHighResTimeStamp` as its first argument. Use this timestamp for delta time calculations rather than calling `performance.now()` inside the loop, which adds an extra system call and can desync from the frame timing.

**Wrong:**
```js
let lastTime = performance.now();
function gameLoop() {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    // Delta time may not align with actual frame boundaries
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
```

**Correct:**
```js
let lastTime = 0;
function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    update(dt);
    render();
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
// Note: first frame has lastTime=0, so delta may spike —
// either ignore first frame or initialize lastTime from the first timestamp
```

---

## 19. localStorage May Fail in Sandboxed Iframes

**Description:** The game preview runs in a sandboxed iframe. If `allow-same-origin` is not set (it isn't — it's intentionally excluded for security), calling `localStorage.getItem()` or `localStorage.setItem()` throws a `SecurityError`. Always wrap localStorage access in try-catch.

**Wrong:**
```js
let highScore = parseInt(localStorage.getItem('highScore') || '0');
// Throws in sandboxed iframe: SecurityError: localStorage is not available
```

**Correct:**
```js
let highScore = 0;
try {
    const saved = localStorage.getItem('game_highScore');
    highScore = saved ? parseInt(saved, 10) : 0;
} catch (e) {
    highScore = 0; // localStorage unavailable — game continues silently
}

function saveHighScore() {
    if (score <= highScore) return;
    highScore = score;
    try {
        localStorage.setItem('game_highScore', String(highScore));
    } catch (e) {
        // Silently fail — don't let localStorage errors break gameplay
    }
}
```

Prefix keys with your game name (e.g., `snake_highScore`) to avoid collisions if multiple games run in the same origin.

---

## 20. Canvas Context May Be Null

**Description:** `canvas.getContext('2d')` returns `null` if the canvas element is not valid or if the context is lost (e.g., GPU driver reset, canvas transferred to a worker). Dereferencing `null` causes a `TypeError` that halts the entire game script.

**Wrong:**
```js
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#0f0'; // TypeError if ctx is null — game crashes
```

**Correct:**
```js
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
if (!ctx) {
    // Canvas context unavailable — show a fallback message
    document.body.innerHTML = '<p>Game requires canvas support</p>';
    throw new Error('Canvas 2D context unavailable');
}
ctx.fillStyle = '#0f0';

// Or use setupCanvas which returns the canvas:
const c = setupCanvas('gameCanvas', 800, 600);
const ctx2 = c.getContext('2d');
if (!ctx2) throw new Error('Canvas 2D context not supported');
```
