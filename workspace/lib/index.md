# Utility Library API Reference

Complete reference for all exports from `scripts/utils.js`. These are pre-loaded in module scope — use directly, never redeclare.

---

## Classes

### GameLoop

Canvas-optimized game loop using `requestAnimationFrame` with delta-time calculation.

```
new GameLoop(callback)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `callback` | `(dt: number) => void` | Called each frame. `dt` is delta time in seconds, capped at 0.05s |

**Methods:**
| Method | Description |
|--------|-------------|
| `start()` | Begin the loop. Safe to call multiple times. |
| `stop()` | Stop the loop. Calls `cancelAnimationFrame`. |
| `pause()` | Pause without stopping. |
| `resume()` | Resume after pause. |
| `isRunning()` | Returns `boolean`. |
| `isPaused()` | Returns `boolean`. |

**Example:**
```js
const loop = new GameLoop((dt) => {
  update(dt);
  render();
  input.endFrame();
});
loop.start();
```

---

### InputManager

Unified keyboard, mouse, touch, and swipe input for canvas games.

```
new InputManager(canvas)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `canvas` | `HTMLCanvasElement` | The game canvas element |

**Methods:**
| Method | Returns | Description |
|--------|---------|-------------|
| `isDown(code)` | `boolean` | Key is currently held (every frame) |
| `justPressed(code)` | `boolean` | Key was pressed this frame (one-shot) |
| `justReleased(code)` | `boolean` | Key was released this frame |
| `getSwipe()` | `string \| null` | `'up'`, `'down'`, `'left'`, `'right'`, or `null` |
| `endFrame()` | `void` | MUST call at end of each frame. Clears one-shot flags. |
| `destroy()` | `void` | Remove all event listeners |

**Properties:**
| Property | Type | Description |
|----------|------|-------------|
| `mouse.x` | `number` | Mouse X in canvas coordinates |
| `mouse.y` | `number` | Mouse Y in canvas coordinates |
| `mouse.buttons` | `Record<number, boolean>` | Mouse button states (0=left, 1=middle, 2=right) |
| `keys` | `Record<string, boolean>` | Raw key states |

**Key codes** (use with `isDown` / `justPressed`):
`'ArrowUp'`, `'ArrowDown'`, `'ArrowLeft'`, `'ArrowRight'`, `'Space'`, `'Enter'`, `'KeyW'`, `'KeyA'`, `'KeyS'`, `'KeyD'`, `'KeyP'`, `'KeyR'`, `'KeyZ'`, `'ControlLeft'`, `'ControlRight'`, `'MetaLeft'`, `'MetaRight'`, `'ShiftLeft'`, `'ShiftRight'`

**Example:**
```js
const input = new InputManager(canvas);

// In game loop:
if (input.isDown('ArrowLeft')) player.x -= 200 * dt;
if (input.isDown('ArrowRight')) player.x += 200 * dt;
if (input.justPressed('Space')) player.jump();
if (input.justPressed('KeyR')) resetGame();

const swipe = input.getSwipe();
if (swipe === 'up') moveUp();

input.endFrame(); // REQUIRED at end of each frame
```

---

### CollisionDetector

Static collision detection methods. No constructor needed.

**Methods (all static):**
| Method | Description |
|--------|-------------|
| `aabb(r1, r2)` | AABB collision between two `{x, y, w, h}` rectangles |
| `circle(c1, c2)` | Circle collision between two `{x, y, r}` circles |
| `pointInRect(px, py, rect)` | Point `(px,py)` inside `{x, y, w, h}` rectangle |
| `circleAABB(circle, rect)` | Circle-AABB collision |
| `lineCircle(x1,y1,x2,y2, circle)` | Line segment vs circle collision |

**Example:**
```js
if (CollisionDetector.aabb(player, enemy)) {
  player.takeDamage();
}
if (CollisionDetector.pointInRect(mouseX, mouseY, button)) {
  button.hovered = true;
}
```

---

### SpriteManager

Image loading and caching with optional frame-based sprite rendering.

```
new SpriteManager()
```

**Methods:**
| Method | Description |
|--------|-------------|
| `load(name, src)` | Load image from URL (returns Promise) |
| `loadAll(images)` | Load multiple `{name, src}` (returns Promise.all) |
| `get(name)` | Get cached `HTMLImageElement` or `null` |
| `isLoaded(name)` | Check if image is loaded |
| `draw(ctx, name, x, y, w?, h?)` | Draw image at position |
| `drawFrame(ctx, name, frameIndex, fw, fh, x, y, dw?, dh?)` | Draw sprite sheet frame |

**Example:**
```js
const sprites = new SpriteManager();
await sprites.loadAll([
  { name: 'player', src: window.__ASSETS__['player.png'] },
  { name: 'enemy', src: window.__ASSETS__['enemy.png'] },
]);
sprites.draw(ctx, 'player', x, y, 32, 32);
```

---

### Animation

Sprite sheet animation timer with frame cycling.

```
new Animation(frameCount, fps, loop?)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `frameCount` | `number` | required | Total frames in animation |
| `fps` | `number` | required | Frames per second |
| `loop` | `boolean` | `false` | Whether to loop |

**Methods:**
| Method | Returns | Description |
|--------|---------|-------------|
| `update(dt)` | `void` | Advance animation by dt seconds |
| `reset()` | `void` | Reset to frame 0 |
| `isDone()` | `boolean` | Animation completed (non-looping only) |
| `getCurrentFrame()` | `number` | Current frame index (0-based) |

**Example:**
```js
const anim = new Animation(4, 8, true); // 4 frames, 8 FPS, looping
anim.update(dt);
const frame = anim.getCurrentFrame();
sprites.drawFrame(ctx, 'sprite', frame, 32, 32, x, y, 32, 32);
```

---

### SoundManager

Web Audio API wrapper for sound effects.

```
new SoundManager()
```

**Methods:**
| Method | Description |
|--------|-------------|
| `init()` | Initialize AudioContext (call on first user interaction) |
| `load(name, url)` | Load and decode audio from URL |
| `play(name, volume?)` | Play loaded sound (volume 0-1, default 1) |
| `beep(freq?, duration?, volume?)` | Play a synthesized beep tone |
| `toggleMute()` | Toggle mute on/off |
| `setVolume(v)` | Set master volume (0-1) |
| `isReady()` | Returns `boolean` — AudioContext initialized |

**Example:**
```js
const sound = new SoundManager();
sound.init(); // Call on first click/keypress
sound.load('jump', window.__ASSETS__['jump.wav']);
sound.play('jump', 0.5);
```

---

### ObjectPool

Generic object pool for reducing garbage collection in games with frequent object creation/destruction.

```
new ObjectPool(createFn, resetFn, initialSize?)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `createFn` | `() => T` | Factory — creates a new object |
| `resetFn` | `(obj: T) => void` | Reset object before reuse |
| `initialSize` | `number` | Pre-allocate N objects (default 0) |

**Methods:**
| Method | Description |
|--------|-------------|
| `acquire()` | Get an object from pool (creates if empty) |
| `release(obj)` | Return object to pool |
| `releaseAll()` | Return all active objects |
| `forEach(fn)` | Iterate all objects (active + pooled) |

**Example:**
```js
const particles = new ObjectPool(
  () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0 }),
  (p) => { p.x = 0; p.y = 0; p.vx = 0; p.vy = 0; p.life = 0; },
  50
);
const p = particles.acquire();
p.x = 100; p.y = 200; p.vx = 1; p.life = 2;
// ... when done:
particles.release(p);
```

---

### Vector2

2D vector for physics, movement, and angle calculations.

```
new Vector2(x?, y?)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `x` | `number` | `0` | X component |
| `y` | `number` | `0` | Y component |

**Instance methods:**
| Method | Returns | Description |
|--------|---------|-------------|
| `set(x, y)` | `this` | Set components |
| `copy()` | `Vector2` | New copy |
| `add(v)` | `this` | Add vector |
| `sub(v)` | `this` | Subtract vector |
| `scale(s)` | `this` | Multiply by scalar |
| `magnitude()` | `number` | Length |
| `normalize()` | `this` | Unit vector |
| `rotate(angle)` | `this` | Rotate by radians |
| `angle()` | `number` | Direction in radians |
| `dot(v)` | `number` | Dot product |
| `distanceTo(v)` | `number` | Distance to another vector |

**Static methods:** `Vector2.add(a,b)`, `Vector2.sub(a,b)`, `Vector2.scale(v,s)`, `Vector2.fromAngle(angle, mag?)`

**Example:**
```js
const pos = new Vector2(100, 200);
const vel = Vector2.fromAngle(Math.PI / 4, 300); // 45° at speed 300
pos.add(Vector2.scale(vel, dt));
if (pos.distanceTo(target) < 10) hit();
```

---

### Camera

2D camera with smooth follow, deadzones, and world clamping. Ideal for platformers, top-down games, and scrolling shooters.

```
new Camera(worldW, worldH, viewW, viewH)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `worldW` | `number` | World width in pixels |
| `worldH` | `number` | World height in pixels |
| `viewW` | `number` | Viewport width |
| `viewH` | `number` | Viewport height |

**Methods:**
| Method | Description |
|--------|-------------|
| `follow(targetX, targetY, dt)` | Smooth-follow a target with deadzone |
| `apply(ctx)` | Push camera transform (save + translate) |
| `restore(ctx)` | Pop camera transform |
| `shake(intensity)` | Apply screen shake offset |

**Properties:** `smoothFactor` (default `0.08`), `deadzone` (default 30% of viewport)

**Example:**
```js
const camera = new Camera(2000, 1000, 800, 600);
camera.smoothFactor = 0.1;

// In update:
camera.follow(player.x, player.y, dt);

// In render:
camera.apply(ctx);
// ... draw world ...
camera.restore(ctx);
// ... draw HUD (unaffected by camera) ...
```

---

### Timer

Simple cooldown / duration timer for abilities, power-ups, and spawn intervals.

```
new Timer(duration, autoReset?)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `duration` | `number` | required | Timer duration in seconds |
| `autoReset` | `boolean` | `false` | Auto-reset when done |

**Methods:**
| Method | Returns | Description |
|--------|---------|-------------|
| `update(dt)` | `void` | Advance timer by dt seconds |
| `isDone()` | `boolean` | Timer reached duration |
| `progress()` | `number` | 0-1 progress |
| `remaining()` | `number` | Seconds remaining |
| `reset(duration?)` | `void` | Reset (optionally with new duration) |

**Example:**
```js
const shootCooldown = new Timer(0.3);
const powerUpDuration = new Timer(5, true);

// In update:
shootCooldown.update(dt);
powerUpDuration.update(dt);
if (input.justPressed('Space') && shootCooldown.isDone()) {
  spawnBullet();
  shootCooldown.reset();
}
if (!powerUpDuration.isDone()) {
  applyPowerUp(powerUpDuration.progress());
}
```

---

### Easing

Standard easing functions for smooth animations and tweening.

```
Easing.functionName(t)
```

All functions take `t` (0-1) and return eased value (0-1).

| Function | Use Case |
|----------|----------|
| `linear(t)` | Constant speed |
| `inQuad(t)`, `outQuad(t)`, `inOutQuad(t)` | Smooth acceleration/deceleration |
| `inCubic(t)`, `outCubic(t)`, `inOutCubic(t)` | Stronger curve than quad |
| `inSine(t)`, `outSine(t)`, `inOutSine(t)` | Gentle oscillation |
| `inElastic(t)`, `outElastic(t)` | Overshoot/spring effect |
| `outBounce(t)` | Bouncing ball effect |

**Example:**
```js
const t = Easing.outCubic(clamp(elapsed / duration, 0, 1));
player.x = lerp(startX, endX, t);
```

---

### ScreenShake

Trauma-based screen shake with exponential decay. Apply in render, update in game loop.

```
new ScreenShake()
```

**Methods:**
| Method | Description |
|--------|-------------|
| `trigger(intensity?, decay?)` | Add shake (default intensity 8, decay 4) |
| `update(dt)` | Decay shake each frame |
| `apply(ctx)` | Push shake transform (save + translate) |
| `restore(ctx)` | Pop shake transform |

**Example:**
```js
const shake = new ScreenShake();

// On explosion:
shake.trigger(12, 6);

// In game loop:
shake.update(dt);

// In render (before drawing world):
shake.apply(ctx);
// ... draw world ...
shake.restore(ctx);
```

---

### SeededRandom

Deterministic random number generator (Mulberry32 algorithm) for reproducible procedural generation.

```
new SeededRandom(seed?)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `seed` | `number` | Integer seed (default: `Date.now()`) |

**Methods:**
| Method | Returns | Description |
|--------|---------|-------------|
| `next()` | `number` | Float in [0, 1) |
| `range(min, max)` | `number` | Integer in [min, max] inclusive |
| `reset()` | `void` | Reset to original seed |

**Example:**
```js
const rng = new SeededRandom(42);
const level = Array.from({ length: 10 }, () => rng.range(0, 3));
// Same seed → same level every time
```

---

## Functions

### `randomInt(min, max)`
Random integer in range [min, max] inclusive.
```js
const dice = randomInt(1, 6); // 1-6
```

### `clamp(value, min, max)`
Clamp value to [min, max] range.
```js
player.x = clamp(player.x, 0, canvas.width - player.width);
```

### `lerp(a, b, t)`
Linear interpolation from a to b by factor t (0-1).
```js
camera.x = lerp(camera.x, target.x, 0.1 * dt * 60);
```

### `distance(x1, y1, x2, y2)`
Euclidean distance between two points.
```js
if (distance(player.x, player.y, enemy.x, enemy.y) < 50) { ... }
```

### `angleBetween(x1, y1, x2, y2)`
Angle in radians from point 1 to point 2.
```js
const angle = angleBetween(bullet.x, bullet.y, target.x, target.y);
bullet.vx = Math.cos(angle) * speed;
bullet.vy = Math.sin(angle) * speed;
```

### `setupCanvas(canvasId, designW, designH)`
Sets up responsive canvas with fixed design resolution, auto-scaling CSS, and pixelated rendering.

| Parameter | Type | Description |
|-----------|------|-------------|
| `canvasId` | `string` | Element ID (`'gameCanvas'`) |
| `designW` | `number` | Design width in pixels |
| `designH` | `number` | Design height in pixels |

Returns the `HTMLCanvasElement`.

```js
const canvas = setupCanvas('gameCanvas', 800, 600);
const ctx = canvas.getContext('2d');
// Canvas is now 800x600 with responsive CSS scaling
```

---

## Adding New Utility Functions

To extend this library, add functions or classes to `scripts/utils.js`:

1. **Append only** — add new exports at the END of the file. Never modify or delete existing exports.

2. **Simple functions**: Export directly:
   ```js
   export function myFunction(arg1, arg2) { ... }
   ```

3. **Classes**: Export class at top level:
   ```js
   export class MyClass { ... }
   ```

4. **Update this file** (`lib/index.md`) to document the new addition:
   - Add an entry in the appropriate section (Classes or Functions)
   - Include: signature, parameter table, description, and usage example
   - Follow the existing format (### header, table, example code block)

5. New exports are automatically available in `game.js` scope — no import needed.

The build pipeline concatenates `utils.js` before `game.js`, so all exports (original + appended) are in scope when game code runs.
