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
<canvas id="game" width="200" height="200" style="width: 800px; height: 800px;"></canvas>
<!-- Pixel art will appear blurry when scaled up -->
```

**Correct:**
```html
<style>
    #game {
        width: 800px;
        height: 800px;
        image-rendering: pixelated;
        image-rendering: crisp-edges; /* Fallback for older browsers */
    }
</style>
<canvas id="game" width="200" height="200"></canvas>
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
