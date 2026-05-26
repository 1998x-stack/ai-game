---
name: pixel-art-games
description: Pixel art rendering with crisp scaling, tile-based grids, integer positions, and retro aesthetics
triggers: pixel art, retro, 8-bit, 16-bit, low-res, pixelated, tileset, sprite sheet
---

# Pixel Art Games

## When to Use
When the user requests pixel art style, retro graphics, or mentions specific pixel dimensions (e.g., "make an 8-bit platformer", "16x16 pixel art", "retro style game").

## Core Patterns

### Pixel Art Canvas Setup
```js
const canvas = setupCanvas('gameCanvas', 320, 240);
canvas.style.imageRendering = 'pixelated';
canvas.style.width = '640px';  // 2x scale for crisp pixels
canvas.style.height = '480px';
```

### Pixel-Perfect Rendering
```js
ctx.imageSmoothingEnabled = false;
```

### Tile-Based Grid
```js
const TILE_SIZE = 16;
const COLS = Math.floor(canvas.width / TILE_SIZE);
const ROWS = Math.floor(canvas.height / TILE_SIZE);

function drawTile(tileIndex, col, row) {
  const sx = (tileIndex % TILES_PER_ROW) * TILE_SIZE;
  const sy = Math.floor(tileIndex / TILES_PER_ROW) * TILE_SIZE;
  ctx.drawImage(tileset, sx, sy, TILE_SIZE, TILE_SIZE,
    col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}
```

### Pixel Font
```js
ctx.font = '16px monospace';
ctx.textAlign = 'left';
ctx.fillStyle = '#fff';
ctx.fillText('SCORE: 100', 8, 16);
```

## Gotchas

### 1. Canvas CSS Scaling Breaks Pixel Art
**Wrong:**
```css
canvas { width: 100%; height: 100%; }  /* Blurry! */
```
**Correct:**
```js
canvas.style.width = `${canvas.width * SCALE}px`;
canvas.style.height = `${canvas.height * SCALE}px`;
canvas.style.imageRendering = 'pixelated';
```

### 2. Using Non-Integer Positions
**Wrong:**
```js
player.x += 1.5 * speed * dt;  // Sub-pixel position — blurry!
```
**Correct:**
```js
player.x += 1.5 * speed * dt;
ctx.drawImage(sprite, Math.round(player.x), Math.round(player.y));
```

## Integration with Utils
- Use `setupCanvas()` with small design dimensions (320×240, 256×224, etc.)
- Use `InputManager` for keyboard — call `justPressed()` for discrete actions
- Use `GameLoop` with delta time — pixel art games often run at lower FPS
- Use `clamp()` to keep sprites within tile boundaries
