# HTML5 Canvas Game Development Guide

## Quick Start

This is the minimal boilerplate for a new game. Copy this into `scripts/game.js`:

```js
const canvas = document.getElementById('gameCanvas');
canvas.width = 800;
canvas.height = 600;
const ctx = canvas.getContext('2d');

// Use utils.js classes — already loaded, do NOT redeclare:
const loop = new GameLoop((dt) => { update(dt); render(); });
const input = new InputManager(canvas);
loop.start();

// Game state
let player = { x: 400, y: 300, size: 20 };

function update(dt) {
  if (input.isDown('ArrowLeft')) player.x -= 200 * dt;
  if (input.isDown('ArrowRight')) player.x += 200 * dt;
  if (input.isDown('ArrowUp')) player.y -= 200 * dt;
  if (input.isDown('ArrowDown')) player.y += 200 * dt;
  input.endFrame(); // Clear one-shot flags
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f0';
  ctx.fillRect(player.x, player.y, player.size, player.size);
}
```

**Key points:**
- `utils.js` is pre-loaded in the same module scope — use its classes directly, never redeclare them
- Always call `input.endFrame()` at the end of `update()` to clear `justPressed`/`justReleased` flags
- `GameLoop` handles requestAnimationFrame, delta time capping, and pause/resume internally
- Call the `build_game` tool to package and preview

---

## Available Utilities

All exports from `scripts/utils.js` are pre-loaded and available in `game.js` via module scope. Do NOT redeclare them.

### Classes

**`GameLoop(callback)`** — requestAnimationFrame wrapper with delta time, pause/resume/stop.
```js
const loop = new GameLoop((dt) => { update(dt); render(); });
loop.start();
// loop.pause(); loop.resume(); loop.stop();
```

**`InputManager(canvas)`** — unified keyboard/mouse/touch input with justPressed/justReleased tracking and swipe detection. Constructor registers all event listeners.
```js
const input = new InputManager(canvas);
// In update():
if (input.isDown('ArrowLeft')) moveLeft();
if (input.justPressed('Space')) jump();
const mx = input.mouse.x, my = input.mouse.y;
const swipeDir = input.getSwipe(); // 'left'|'right'|'up'|'down'|null
input.endFrame(); // Must call each frame
```

**`CollisionDetector`** — static methods for common collision tests.
```js
// AABB: needs { x, y, width, height }
CollisionDetector.aabb(rectA, rectB);
// Circle: needs { x, y, radius }
CollisionDetector.circle(circleA, circleB);
// Point in rectangle
CollisionDetector.pointInRect(px, py, rect);
// Circle vs AABB
CollisionDetector.circleAABB(circle, rect);
// Line segment vs circle (returns closest point or null)
CollisionDetector.lineCircle(x1, y1, x2, y2, circle);
```

**`SpriteManager()`** — image loading, caching, and drawing.
```js
const sprites = new SpriteManager();
await sprites.loadAll({ player: 'player.png', enemy: 'enemy.png' });
sprites.draw(ctx, 'player', x, y, w, h);
// Sprite sheet frame:
sprites.drawFrame(ctx, 'player', frameIndex, frameWidth, frameHeight, x, y, w, h);
```

**`Animation(frameCount, fps, loop = true)`** — sprite frame animation timer.
```js
const anim = new Animation(4, 8); // 4 frames at 8 fps, looping
anim.update(dt);
sprites.drawFrame(ctx, 'player', anim.frame, 32, 32, x, y);
if (anim.isDone()) { /* non-looping animation finished */ }
```

**`SoundManager()`** — Web Audio API wrapper.
```js
const sounds = new SoundManager();
sounds.init(); // Must be called from user gesture (click/touch)
sounds.play('shoot.wav');
sounds.beep(440, 0.1, 'square'); // Generate tone procedurally
sounds.toggleMute();
```

**`ObjectPool(createFn, resetFn, initialSize = 20)`** — generic object pooling to reduce GC.
```js
const bulletPool = new ObjectPool(
  () => ({ x: 0, y: 0, vx: 0, vy: 0, alive: false }),
  (b) => { b.alive = false; }
);
const b = bulletPool.acquire();
b.x = 100; b.y = 200; b.alive = true;
// Later: bulletPool.release(b);
```

### Utility Functions

```js
randomInt(min, max);           // Integer in [min, max]
clamp(value, min, max);        // Clamp to range
lerp(a, b, t);                 // Linear interpolation: a + (b-a)*t
distance(x1, y1, x2, y2);      // Euclidean distance
angleBetween(x1, y1, x2, y2);  // Angle in radians between two points
setupCanvas(canvasId, w, h);   // Responsive canvas with pixel-art rendering
```

**`setupCanvas`** is the recommended way to set up the canvas:
```js
const canvas = setupCanvas('gameCanvas', 800, 600);
const ctx = canvas.getContext('2d');
// Canvas is sized, scaled responsively, and image-rendering: pixelated is set
// Window resize handler is auto-registered
```

---

## Build & Preview

After writing game code, call the `build_game` tool to package everything:

1. The build pipeline concatenates `scripts/utils.js` + `scripts/game.js` into a single `<script type="module">` block
2. Assets from `assets/` are embedded as base64 data URIs in `window.__ASSETS__`
3. The output is written to `workspace/output/index.html`
4. The game appears in the preview panel automatically

**Build ordering:** `utils.js` first, then `game.js`. All scripts share the same module scope.

The preview panel sends runtime errors back to the chat via `postMessage` with `{ type: 'game-error', message, source, lineno, colno }`.

---

## Game Loop Pattern

The game loop is the heartbeat of any game. Use `requestAnimationFrame` for smooth, efficient animation with automatic frame-rate adaptation.

```js
let lastTime = 0;
function gameLoop(timestamp) {
    const deltaTime = (timestamp - lastTime) / 1000; // seconds
    lastTime = timestamp;

    // Cap delta to prevent spiral of death
    const dt = Math.min(deltaTime, 0.05);

    update(dt);
    render();

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
```

**Key points:**
- Always use `deltaTime` to make game speed consistent across frame rates (60fps vs 144fps)
- Cap delta time (e.g., 50ms max) to prevent large jumps when the tab loses focus
- `requestAnimationFrame` auto-pauses when the tab is hidden (no battery drain)

### Fixed Time Step (for physics)

For deterministic physics, use a fixed time step with accumulator:

```js
const FIXED_DT = 1 / 60;
let accumulator = 0;

function gameLoop(timestamp) {
    const frameTime = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    accumulator += frameTime;

    while (accumulator >= FIXED_DT) {
        update(FIXED_DT);
        accumulator -= FIXED_DT;
    }

    render();
    requestAnimationFrame(gameLoop);
}
```

---

## Keyboard Input

Use `event.code` for physical key location (consistent across keyboard layouts):

```js
const keys = {};
document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    e.preventDefault(); // Prevent scrolling with arrow keys
});
document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
});

// In update():
if (keys['ArrowLeft'] || keys['KeyA']) { moveLeft(); }
if (keys['ArrowRight'] || keys['KeyD']) { moveRight(); }
if (keys['Space']) { jump(); }
```

**Why `event.code` over `event.key`:**
- `event.key` changes with keyboard layout (Q on AZERTY = 'a')
- `event.code` is physical position (always 'KeyQ')

---

## Mouse Input

```js
const mouse = { x: 0, y: 0, buttons: {} };

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
});

canvas.addEventListener('mousedown', (e) => {
    mouse.buttons[e.button] = true;
});

canvas.addEventListener('mouseup', (e) => {
    mouse.buttons[e.button] = false;
});
```

**Scale mouse coordinates** when canvas CSS size differs from canvas element size (responsive canvas).

---

## Touch Input

```js
let touches = [];

canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    touches = Array.from(e.touches).map(t => ({
        x: (t.clientX - rect.left) * (canvas.width / rect.width),
        y: (t.clientY - rect.top) * (canvas.height / rect.height)
    }));
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    // Update touches...
});

canvas.addEventListener('touchend', (e) => {
    touches = [];
});

// Swipe detection:
let touchStartX = 0, touchStartY = 0;
const SWIPE_THRESHOLD = 30;

canvas.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
});

canvas.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy)) {
        if (Math.abs(dx) > SWIPE_THRESHOLD) {
            swipe(dx > 0 ? 'right' : 'left');
        }
    } else {
        if (Math.abs(dy) > SWIPE_THRESHOLD) {
            swipe(dy > 0 ? 'down' : 'up');
        }
    }
});
```

---

## Collision Detection

### Axis-Aligned Bounding Box (AABB)

Best for rectangles that don't rotate:

```js
function aabbCollision(a, b) {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}
```

### Circle Collision

```js
function circleCollision(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < a.radius + b.radius;
}

// Optimized (no sqrt):
function circleCollisionFast(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const radii = a.radius + b.radius;
    return dx * dx + dy * dy < radii * radii;
}
```

### Point in Rectangle

```js
function pointInRect(px, py, rect) {
    return px >= rect.x && px <= rect.x + rect.width &&
           py >= rect.y && py <= rect.y + rect.height;
}
```

---

## Sprite Management

### Drawing without images (programmatic sprites)

```js
function drawRect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
}

function drawCircle(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}
```

### Loading and drawing images

```js
const sprites = {};
function loadImage(name, src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { sprites[name] = img; resolve(img); };
        img.src = src;
    });
}

function drawSprite(ctx, name, x, y, w, h) {
    const sprite = sprites[name];
    if (sprite) ctx.drawImage(sprite, x, y, w, h);
}
```

### Sprite Sheet Animation

```js
class SpriteAnimation {
    constructor(spritesheet, frameWidth, frameHeight, frameCount, fps = 12) {
        this.spritesheet = spritesheet;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.frameCount = frameCount;
        this.frameDuration = 1 / fps;
        this.elapsed = 0;
        this.currentFrame = 0;
    }

    update(dt) {
        this.elapsed += dt;
        if (this.elapsed >= this.frameDuration) {
            this.elapsed -= this.frameDuration;
            this.currentFrame = (this.currentFrame + 1) % this.frameCount;
        }
    }

    draw(ctx, x, y) {
        ctx.drawImage(
            this.spritesheet,
            this.currentFrame * this.frameWidth, 0,
            this.frameWidth, this.frameHeight,
            x, y,
            this.frameWidth, this.frameHeight
        );
    }
}
```

---

## Game States

Manage transitions between distinct game phases:

```js
const GameState = {
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAME_OVER: 'gameover',
    WIN: 'win'
};

let state = GameState.MENU;

function updateState(newState) {
    // State transitions happen at START of frame
    state = newState;
    onStateEnter(state);
}

function onStateEnter(newState) {
    switch (newState) {
        case GameState.PLAYING: resetGame(); break;
        case GameState.PAUSED: /* nothing special */ break;
        case GameState.GAME_OVER: saveHighScore(); break;
    }
}

function update(dt) {
    switch (state) {
        case GameState.PLAYING:
            updateGame(dt);
            break;
        case GameState.PAUSED:
            // Don't update game logic
            break;
        // Menu/gameover states often handled in rendering
    }
}

function render() {
    switch (state) {
        case GameState.MENU: drawMenu(); break;
        case GameState.PLAYING: drawGame(); break;
        case GameState.PAUSED: drawGame(); drawPauseOverlay(); break;
        case GameState.GAME_OVER: drawGame(); drawGameOver(); break;
    }
}
```

**Critical:** Always transition state at the start of a frame, not mid-update. Mid-frame transitions cause inconsistent state where some objects update with old rules and others with new.

---

## Scoring

```js
let score = 0;
let highScore = parseInt(localStorage.getItem('highScore') || '0');

function addScore(points) {
    score += points;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('highScore', String(highScore));
    }
}

function drawScore(ctx) {
    ctx.fillStyle = '#fff';
    ctx.font = '20px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${score}`, 10, 30);
    ctx.fillText(`High: ${highScore}`, 10, 55);
}
```

---

## Levels

```js
const levels = [
    { speed: 1, brickRows: 3, brickCols: 8 },
    { speed: 1.5, brickRows: 4, brickCols: 8 },
    { speed: 2, brickRows: 5, brickCols: 9 },
];

let currentLevel = 0;

function loadLevel(levelIndex) {
    const config = levels[levelIndex];
    // Set up game entities based on config...
}
```

---

## Difficulty Scaling

```js
function getDifficulty(score) {
    return {
        speed: 1 + Math.floor(score / 100) * 0.2,
        spawnRate: Math.max(0.5, 2 - Math.floor(score / 50) * 0.1),
        enemyCount: 1 + Math.floor(score / 200)
    };
}
```

---

## Responsive Canvas Sizing

```js
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Design resolution (internal)
const DESIGN_W = 800;
const DESIGN_H = 600;

function resizeCanvas() {
    const parent = canvas.parentElement;
    const maxW = parent.clientWidth;
    const maxH = parent.clientHeight;
    const scale = Math.min(maxW / DESIGN_W, maxH / DESIGN_H, 1);

    // Internal resolution stays fixed
    canvas.width = DESIGN_W;
    canvas.height = DESIGN_H;

    // CSS size scales to fit
    canvas.style.width = `${DESIGN_W * scale}px`;
    canvas.style.height = `${DESIGN_H * scale}px`;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
```

For pixel-art games, add this CSS to prevent blur:

```css
canvas {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
}
```

---

## Common Patterns

### Score Display (HUD)

Draw score, lives, and other HUD elements on top of the game world:

```js
function drawHUD(ctx) {
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = '20px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${score}`, 10, 30);
    ctx.fillText(`Lives: ${lives}`, 10, 55);
    ctx.fillText(`Level: ${level}`, 10, 80);

    // Right-aligned info
    ctx.textAlign = 'right';
    ctx.fillText(`Time: ${Math.floor(gameTime)}s`, canvas.width - 10, 30);
    ctx.restore();
}
```

### High Score with localStorage

Always wrap localStorage in try-catch to handle sandboxed iframes:

```js
let highScore = 0;

function loadHighScore() {
    try {
        const saved = localStorage.getItem('game_highScore');
        highScore = saved ? parseInt(saved, 10) : 0;
    } catch (e) {
        highScore = 0; // localStorage unavailable (sandboxed iframe)
    }
}

function saveHighScore() {
    if (score > highScore) {
        highScore = score;
        try {
            localStorage.setItem('game_highScore', String(highScore));
        } catch (e) {
            // Silently fail — localStorage may be blocked
        }
    }
}
```

### Particle Effects

Lightweight particle burst for explosions, pickups, or trail effects:

```js
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 150;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 50;
        this.life = 1.0;
        this.decay = 0.5 + Math.random() * 1.0;
        this.size = 2 + Math.random() * 3;
        this.color = `hsl(${Math.random() * 60 + 20}, 100%, 60%)`;
    }

    update(dt) {
        this.life -= dt / this.decay;
        this.vy += 200 * dt; // gravity
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        return this.life > 0;
    }

    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
        ctx.globalAlpha = 1;
    }
}

const particles = [];

function emitBurst(x, y, count = 20) {
    for (let i = 0; i < count; i++) {
        particles.push(new Particle(x, y));
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        if (!particles[i].update(dt)) particles.splice(i, 1);
    }
}

function drawParticles(ctx) {
    for (const p of particles) p.draw(ctx);
}
```

### Screen Shake

Apply a random offset to the canvas transform for impact feedback:

```js
let shakeIntensity = 0;
let shakeDuration = 0;
let shakeTimer = 0;

function triggerShake(intensity = 4, duration = 0.15) {
    shakeIntensity = intensity;
    shakeDuration = duration;
    shakeTimer = 0;
}

function updateShake(dt) {
    if (shakeIntensity <= 0) return;
    shakeTimer += dt;
    if (shakeTimer >= shakeDuration) {
        shakeIntensity = 0;
    }
}

function applyShake(ctx) {
    if (shakeIntensity <= 0) return;
    const sx = (Math.random() - 0.5) * shakeIntensity * 2;
    const sy = (Math.random() - 0.5) * shakeIntensity * 2;
    ctx.translate(sx, sy);
}

// Usage in render():
// ctx.save();
// applyShake(ctx);
// ... draw everything ...
// ctx.restore();
```

### Power-Up System

Timed power-ups with activation and expiry:

```js
const activePowerUps = {};

function activatePowerUp(type, duration) {
    activePowerUps[type] = { timer: 0, duration };
    onPowerUpActivate(type);
}

function updatePowerUps(dt) {
    for (const [type, state] of Object.entries(activePowerUps)) {
        state.timer += dt;
        if (state.timer >= state.duration) {
            delete activePowerUps[type];
            onPowerUpExpire(type);
        }
    }
}

function hasPowerUp(type) {
    return type in activePowerUps;
}

function onPowerUpActivate(type) {
    switch (type) {
        case 'speed': player.speed *= 2; break;
        case 'shield': player.invincible = true; break;
        case 'spread': player.weapon = 'spread'; break;
    }
}

function onPowerUpExpire(type) {
    switch (type) {
        case 'speed': player.speed /= 2; break;
        case 'shield': player.invincible = false; break;
        case 'spread': player.weapon = 'single'; break;
    }
}
```
