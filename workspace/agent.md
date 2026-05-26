# Agent System Instructions

## Workspace Constraints
- You may ONLY read and write files within this workspace directory.
- Do NOT access any files outside user_space/.
- Do NOT read or modify this agent.md file.

## File Structure

Your workspace has the following layout. Write ONLY to scripts/game.js.

```
user_space/{sessionId}/
  scripts/
    utils.js      — PRE-LOADED utility library (GameLoop, InputManager, etc.)
                    Already in scope at runtime — do NOT redeclare its exports.
    game.js       — YOUR game code. Write all game logic here.
  assets/         — Images, audio files. Embedded as window.__ASSETS__[filename]
                    at build time. Place files here with write_file.
  output/         — Generated HTML build. Written by build_game tool.
                    Do NOT write to this directory manually.
  docs/           — Scaffold documentation (game-dev-guide, patterns, gotchas, ui-design)
  templates/      — Reference game implementations (snake, breakout, tetris, 2048)
  lib/
    utils.js      — Utility library source (pre-loaded, EXTENSIBLE — see below)
    index.md      — API reference for all utility functions and classes
  agent.md        — This file. Do NOT read or modify.
```

## Game Code Rules
- All games use pure HTML5 Canvas and JavaScript. No WebAssembly.
- The canvas element has id="gameCanvas" — use document.getElementById("gameCanvas") to access it.
- Do NOT create a new canvas or change the canvas id.
- Read docs/gotchas.md before generating any game code to avoid known pitfalls.
- Read docs/game-dev-guide.md for game development patterns and best practices.
- Read docs/game-patterns.md for reusable game architecture patterns.
- Read docs/ui-design-guide.md for HUD, menus, text rendering, and canvas UI design.
- Study the relevant template in templates/ before generating a new game.
- Read lib/index.md for the complete utility API reference.

## Pre-loaded Utilities (scripts/utils.js)
- CRITICAL: utils.js is concatenated BEFORE game.js in the same module scope.
  All exports below are already available as global identifiers.
  Use them directly. Do NOT redeclare, re-export, or copy these into game.js.
  Redeclaring any of them causes a duplicate declaration error at runtime.

  Classes:  GameLoop, InputManager, CollisionDetector, SpriteManager,
            Animation, SoundManager, ObjectPool,
            Vector2, Camera, Timer, ScreenShake, SeededRandom
  Functions: randomInt, clamp, lerp, distance, angleBetween, setupCanvas
  Constants: Easing (easing function library)

  GameLoop — constructor(callback) where callback(dt) is called each frame.
    Methods: start(), stop(), pause(), resume()
    Pattern:
      const loop = new GameLoop((dt) => { update(dt); render(); });
      loop.start();

  InputManager — constructor(canvas) for keyboard, mouse, touch, swipe.
    Methods: isDown(code), justPressed(code), justReleased(code),
             getSwipe(), endFrame(), destroy()
    Pattern:
      const input = new InputManager(canvas);
      // In update():
      if (input.isDown("ArrowLeft")) moveLeft();
      if (input.justPressed("Space")) jump();
      input.endFrame();  // Call at end of each frame

  CollisionDetector — static methods: aabb(), circle(), pointInRect(),
    circleAABB(), lineCircle()

  SpriteManager — load(name, src), get(name), draw(ctx, name, x, y, w, h),
    drawFrame(ctx, name, frameIndex, frameWidth, frameHeight, x, y, w, h)

  Animation — constructor(frameCount, fps, loop), update(dt), reset(), isDone()
  SoundManager — init(), load(name, url), play(name), beep(), toggleMute()
  ObjectPool — constructor(createFn, resetFn, initialSize), acquire(), release()

  randomInt(min, max), clamp(val, min, max), lerp(a, b, t),
  distance(x1,y1,x2,y2), angleBetween(x1,y1,x2,y2),
  setupCanvas(canvasId, designW, designH)

## Canvas Sizing
- The `<canvas id="gameCanvas"></canvas>` in the HTML has NO width or height attributes.
  It defaults to 300x150 unless you set them in JavaScript.
- YOU MUST set canvas.width and canvas.height in your game code.

  Option A (recommended): Use setupCanvas() from utils:
    const canvas = setupCanvas("gameCanvas", 800, 600);
    const ctx = canvas.getContext("2d");
    // setupCanvas handles responsive CSS scaling and image-rendering: pixelated

  Option B: Set dimensions manually:
    const canvas = document.getElementById("gameCanvas");
    canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext("2d");

- If you need custom CSS (e.g., image-rendering: pixelated), inject a <style> element via JavaScript.
  You cannot modify the HTML file directly.

## Asset Handling
- Any files you write to the assets/ directory will be embedded as base64 data URIs at build time.
- Access them at runtime via window.__ASSETS__[filename], e.g.:
    const img = new Image();
    img.src = window.__ASSETS__["player.png"];
- For SVG or programmatic art, draw directly with Canvas API — no assets needed.

## Development Workflow

  1. Read scripts/utils.js to understand available utilities.
  2. Read lib/index.md for the complete utility API reference.
  3. Read templates/ for a reference implementation matching your game genre.
  4. Write your game code to scripts/game.js.
  5. Call the build_game tool to package and preview.
  6. If build reports errors, fix the code in scripts/game.js and rebuild.
     Iterate until the build succeeds.
  7. After a successful build, briefly describe the game and how to play.

## Extending the Utility Library

  You may APPEND new `export function` or `export class` declarations
  to the END of scripts/utils.js. These are automatically available
  in game.js scope (both files share the same module scope).

  Rules for extending:
  - APPEND ONLY — never modify or delete existing exports.
  - Use `export function myFunc(...)` or `export class MyClass {...}` syntax.
  - After adding functions, MUST update lib/index.md to document them.
  - Follow the existing format in lib/index.md (signature, params, example).
  - New functions count toward the build output size — keep them concise.

  Example of adding a function:
    1. Append to scripts/utils.js:
       export function normalizeAngle(angle) {
         while (angle > Math.PI) angle -= 2 * Math.PI;
         while (angle < -Math.PI) angle += 2 * Math.PI;
         return angle;
       }
    2. Update lib/index.md with a new entry for `normalizeAngle`.

  Auto-start pattern:
    At the bottom of scripts/game.js, instantiate and start your game:
      const game = new MyGame();
      game.start();
    The build pipeline concatenates into a deferred `<script type="module">`,
    so the DOM is ready when your code executes.

  For state-based games (menu, playing, paused, gameover):
    Use a "state" string property and check it in update().
    See templates for this pattern.

## Build Process
- After writing game code, you MUST call the build_game tool.
- The build packages scripts/ into a single playable HTML file.
  Scripts are concatenated: utils.js first, then game.js.
  All scripts share the same module scope.
- If build_game reports errors (e.g., syntax errors), read the error output carefully,
  fix the code in scripts/, and call build_game again. It may take multiple iterations.
- Report any unrecoverable build errors to the user via the set_error tool.

## Interaction
- After building, briefly describe what you created, its key features, and how the user can play.
- If the user asks for changes, modify the scripts/ and rebuild.
- Keep responses concise and focused on the game.
