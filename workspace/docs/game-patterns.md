# Common Game Patterns

## Entity-Component Pattern

Decouple data from behavior. Entities are just IDs, components are pure data, systems contain the logic.

```js
// Component: pure data
class PositionComponent {
    constructor(x, y) { this.x = x; this.y = y; }
}
class VelocityComponent {
    constructor(vx, vy) { this.vx = vx; this.vy = vy; }
}
class RenderComponent {
    constructor(color, w, h) { this.color = color; this.w = w; this.h = h; }
}

// ECS Manager
class ECS {
    constructor() {
        this.entities = new Map();
        this.nextId = 0;
    }

    createEntity() {
        const id = this.nextId++;
        this.entities.set(id, new Map());
        return id;
    }

    addComponent(entityId, component) {
        this.entities.get(entityId).set(component.constructor, component);
    }

    getComponent(entityId, ComponentClass) {
        return this.entities.get(entityId)?.get(ComponentClass);
    }

    query(ComponentClasses) {
        const results = [];
        for (const [id, components] of this.entities) {
            if (ComponentClasses.every(C => components.has(C))) {
                results.push(id);
            }
        }
        return results;
    }
}

// System: operates on entities with specific components
class MovementSystem {
    update(dt, ecs) {
        for (const id of ecs.query([PositionComponent, VelocityComponent])) {
            const pos = ecs.getComponent(id, PositionComponent);
            const vel = ecs.getComponent(id, VelocityComponent);
            pos.x += vel.vx * dt;
            pos.y += vel.vy * dt;
        }
    }
}

// Usage
const ecs = new ECS();
const player = ecs.createEntity();
ecs.addComponent(player, new PositionComponent(100, 100));
ecs.addComponent(player, new VelocityComponent(200, 0));
ecs.addComponent(player, new RenderComponent('blue', 32, 32));
```

**When to use:** Games with many entity types sharing behaviors (bullets, enemies, power-ups). Avoid for simple games with fixed entities.

---

## Object Pooling

Reuse objects instead of allocating new ones, preventing GC pauses.

```js
class ObjectPool {
    constructor(createFn, resetFn, initialSize = 10) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
        this.active = new Set();

        // Pre-allocate
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(createFn());
        }
    }

    acquire() {
        let obj = this.pool.pop();
        if (!obj) {
            obj = this.createFn(); // Pool exhausted, create new
        }
        this.active.add(obj);
        return obj;
    }

    release(obj) {
        this.resetFn(obj);
        this.active.delete(obj);
        this.pool.push(obj);
    }

    releaseAll() {
        for (const obj of this.active) {
            this.resetFn(obj);
            this.pool.push(obj);
        }
        this.active.clear();
    }

    getActiveCount() {
        return this.active.size;
    }
}

// Bullet pool example
const bulletPool = new ObjectPool(
    // create
    () => ({ x: 0, y: 0, vx: 0, vy: 0, alive: false, color: '#ff0' }),
    // reset
    (b) => { b.alive = false; }
);

// Fire bullet
const b = bulletPool.acquire();
b.x = player.x; b.y = player.y;
b.vx = Math.cos(angle) * 400;
b.vy = Math.sin(angle) * 400;
b.alive = true;

// Update active bullets
for (const b of bulletPool.active) {
    if (!b.alive) { bulletPool.release(b); continue; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
}
```

**When to use:** Any game with frequent creation/destruction of objects (bullets, particles, enemies).

---

## Screen Wrapping

Objects that leave one side reappear on the opposite side (Asteroids-style).

```js
function wrapPosition(entity, canvasWidth, canvasHeight, margin = 0) {
    if (entity.x > canvasWidth + margin) entity.x = -margin;
    else if (entity.x < -margin) entity.x = canvasWidth + margin;

    if (entity.y > canvasHeight + margin) entity.y = -margin;
    else if (entity.y < -margin) entity.y = canvasHeight + margin;
}
```

---

## Tile-Based Maps

Efficient grid-based levels using a 2D array.

```js
class TileMap {
    constructor(tileSize) {
        this.tileSize = tileSize;
        this.width = 0;
        this.height = 0;
        this.tiles = [];
    }

    // 0 = empty, 1 = wall, 2 = player spawn, 3 = goal
    loadFromArray(grid) {
        this.tiles = grid;
        this.height = grid.length;
        this.width = grid[0].length;
    }

    getTile(col, row) {
        if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
            return 1; // Out of bounds = wall
        }
        return this.tiles[row][col];
    }

    // World position to tile coordinates
    worldToTile(worldX, worldY) {
        return {
            col: Math.floor(worldX / this.tileSize),
            row: Math.floor(worldY / this.tileSize)
        };
    }

    // Tile coordinates to world position (top-left)
    tileToWorld(col, row) {
        return {
            x: col * this.tileSize,
            y: row * this.tileSize
        };
    }

    isSolid(col, row) {
        return this.getTile(col, row) === 1;
    }

    draw(ctx, cameraX = 0, cameraY = 0) {
        const startCol = Math.floor(cameraX / this.tileSize);
        const startRow = Math.floor(cameraY / this.tileSize);
        const endCol = startCol + Math.ceil(ctx.canvas.width / this.tileSize) + 1;
        const endRow = startRow + Math.ceil(ctx.canvas.height / this.tileSize) + 1;

        for (let row = startRow; row < endRow; row++) {
            for (let col = startCol; col < endCol; col++) {
                const tile = this.getTile(col, row);
                if (tile === 0) continue;

                const { x, y } = this.tileToWorld(col, row);
                ctx.fillStyle = tile === 1 ? '#666' : '#4a4';
                ctx.fillRect(x - cameraX, y - cameraY, this.tileSize, this.tileSize);
            }
        }
    }
}
```

**Tile colors legend:**
- 0 = empty (transparent)
- 1 = wall (solid)
- 2 = player spawn
- 3 = goal/exit
- 4+ = interactive objects (keys, doors, enemies)

---

## Procedural Generation Basics

### Random walk cave generation

```js
function generateCave(width, height, fillProb = 0.45) {
    // Initialize with random noise
    let grid = [];
    for (let y = 0; y < height; y++) {
        grid[y] = [];
        for (let x = 0; x < width; x++) {
            grid[y][x] = Math.random() < fillProb ? 1 : 0;
        }
    }

    // Cellular automata smoothing (3-5 iterations)
    for (let iter = 0; iter < 4; iter++) {
        const newGrid = [];
        for (let y = 0; y < height; y++) {
            newGrid[y] = [];
            for (let x = 0; x < width; x++) {
                let walls = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                            walls++;
                        } else {
                            walls += grid[ny][nx];
                        }
                    }
                }
                // Wall if >= 5 neighbors are walls (including self)
                newGrid[y][x] = walls >= 5 ? 1 : 0;
            }
        }
        grid = newGrid;
    }
    return grid;
}
```

### Simple BSP dungeon rooms

```js
function generateRooms(width, height, maxRooms = 10) {
    const rooms = [];
    for (let i = 0; i < maxRooms * 10 && rooms.length < maxRooms; i++) {
        const rw = 4 + Math.floor(Math.random() * 6);
        const rh = 4 + Math.floor(Math.random() * 6);
        const rx = 1 + Math.floor(Math.random() * (width - rw - 2));
        const ry = 1 + Math.floor(Math.random() * (height - rh - 2));
        const room = { x: rx, y: ry, w: rw, h: rh };

        // Check overlap with existing rooms (with 1-tile padding)
        const overlaps = rooms.some(existing =>
            room.x < existing.x + existing.w + 1 &&
            room.x + room.w + 1 > existing.x &&
            room.y < existing.y + existing.h + 1 &&
            room.y + room.h + 1 > existing.y
        );

        if (!overlaps) rooms.push(room);
    }

    // Connect rooms with L-shaped corridors
    for (let i = 1; i < rooms.length; i++) {
        const a = rooms[i - 1];
        const b = rooms[i];
        const ax = Math.floor(a.x + a.w / 2);
        const ay = Math.floor(a.y + a.h / 2);
        const bx = Math.floor(b.x + b.w / 2);
        const by = Math.floor(b.y + b.h / 2);

        // Horizontal then vertical (L-shape)
        corridorTiles.push(...createCorridor(ax, ay, bx, ay));
        corridorTiles.push(...createCorridor(bx, ay, bx, by));
    }

    return { rooms, corridorTiles };
}
```

---

## Particle Effects

```js
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 200;
        this.vy = (Math.random() - 0.5) * 200 - 100;
        this.life = 1.0;
        this.decay = 1 + Math.random() * 2; // seconds to live
        this.size = 2 + Math.random() * 4;
        this.color = `hsl(${Math.random() * 60 + 20}, 100%, 50%)`;
    }

    update(dt) {
        this.life -= dt / this.decay;
        this.vy += 300 * dt; // gravity
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

class ParticleSystem {
    constructor() {
        this.particles = [];
    }

    emit(x, y, count = 20) {
        for (let i = 0; i < count; i++) {
            this.particles.push(new Particle(x, y));
        }
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            if (!this.particles[i].update(dt)) {
                this.particles.splice(i, 1);
            }
        }
    }

    draw(ctx) {
        for (const p of this.particles) {
            p.draw(ctx);
        }
    }
}
```

---

## Easing Functions

Easing functions map normalized time [0,1] to a eased value [0,1].

```js
// Linear
function linear(t) { return t; }

// Quadratic
function easeInQuad(t) { return t * t; }
function easeOutQuad(t) { return t * (2 - t); }
function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// Cubic
function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return (--t) * t * t + 1; }
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
}

// Exponential
function easeOutElastic(t) {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}

// Bounce
function easeOutBounce(t) {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}

// Usage: animate a value from A to B over 1 second
let t = 0;
const duration = 1; // seconds
let animating = false;

function startAnimation() {
    t = 0;
    animating = true;
}

function updateAnimation(dt) {
    if (!animating) return;
    t += dt / duration;
    if (t >= 1) { t = 1; animating = false; }

    const eased = easeOutBounce(t);
    currentValue = startValue + (endValue - startValue) * eased;
}
```

**Use cases by easing type:**
- `easeOutQuad`: UI elements sliding in, popups
- `easeOutElastic`: Bouncy UI, juicy feedback
- `easeInOutCubic`: Camera movement, smooth transitions
- `easeOutBounce`: "Dropping" effects
- `easeInQuad`: Fade-in effects (simulate light penetration)
