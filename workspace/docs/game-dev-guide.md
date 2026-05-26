# HTML5 Canvas Game Development Guide

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
