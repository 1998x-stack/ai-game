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
  skills/         — Reusable skill files for specific game domains (EXTENSIBLE — see below)
    README.md     — Skill system overview
    skill-creator.md — Template for creating new skills
    examples/     — Example skills (pixel-art, sound-effects, etc.)
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

  Vector2 — constructor(x?, y?) for 2D vector math (physics, movement, angles).
    Methods: set(), copy(), add(), sub(), scale(), magnitude(), normalize(),
             rotate(angle), angle(), dot(v), distanceTo(v)
    Static: Vector2.add(), Vector2.sub(), Vector2.scale(), Vector2.fromAngle(angle, mag?)
    Usage:
      const vel = Vector2.fromAngle(Math.PI / 4, 300);
      pos.add(Vector2.scale(vel, dt));

  Camera — constructor(worldW, worldH, viewW, viewH) for scrolling and parallax.
    Methods: follow(x, y, dt), apply(ctx), restore(ctx), shake(intensity)
    Properties: smoothFactor (default 0.08), deadzone (30% of viewport)
    Usage:
      camera.follow(player.x, player.y, dt);
      camera.apply(ctx); // before world draw
      camera.restore(ctx); // after world draw, before HUD

  Timer — constructor(duration, autoReset?) for cooldowns and timed events.
    Methods: update(dt), isDone(), progress(), remaining(), reset(newDuration?)
    Usage:
      const cd = new Timer(0.5);
      cd.update(dt);
      if (cd.isDone()) { attack(); cd.reset(); }

  ScreenShake — trauma-based screen shake with exponential decay.
    Methods: trigger(intensity?, decay?), update(dt), apply(ctx), restore(ctx)
    Usage:
      shake.trigger(10, 5); // on explosion
      shake.update(dt);     // each frame
      shake.apply(ctx);     // before drawing world
      shake.restore(ctx);   // after drawing world

  SeededRandom — deterministic RNG (Mulberry32) for procedural generation.
    Methods: next(), range(min, max), reset()
    Usage:
      const rng = new SeededRandom(42);
      const val = rng.range(1, 10); // same seed → same value

  Easing — easing function library. All take t (0-1) and return eased 0-1.
    Functions: linear, inQuad, outQuad, inOutQuad, inCubic, outCubic,
               inOutCubic, inSine, outSine, inOutSine, inElastic, outElastic, outBounce
    Usage: const t = Easing.outCubic(clamp(elapsed / duration, 0, 1));

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

  0. Call load_skills() to discover available skills — it returns name,
     description, and trigger keywords for each skill. Read the full .md file
     for any skills whose triggers match the user's request.

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

## Extending Gotchas (Learning Flywheel)

  When you encounter and solve a problem during game generation, record it
  in docs/gotchas.md so it never happens again. This creates a learning
  flywheel — every mistake is documented once and prevented forever.

  Rules for appending gotchas:
  - APPEND to the END of docs/gotchas.md only — never modify existing gotchas.
  - Use the edit_file tool with old_str matching the LAST gotcha in the file.
  - Follow the exact format (HTML comment template at top of the file):
    ## {N}. {Title}
    **Problem**: {What went wrong — be specific}
    **Wrong**: {code that caused the error}
    **Correct**: {fixed code}
  - Increment the gotcha number (current count is visible at top of file).
  - Write gotchas that are REUSABLE — not specific to one game.
  - Update lib/index.md if the gotcha relates to a utility function.

  Examples of good gotchas to append:
  - "TextBaseline 'middle' centers on the glyph's middle, not the string"
  - "for...in enumerates prototype properties — use for...of for arrays"
  - "ctx.measureText().width doesn't include padding — add manually"

## Creating Skills

  Skills are reusable instruction files in `skills/` that capture domain-specific
  knowledge for game generation. Read relevant skills before starting a game.

  Available skills (in `skills/examples/`):
  - `pixel-art-games.md` — pixel art rendering, tile-based grids, integer positions
  - `game-sound-effects.md` — SoundManager usage, beep synthesis, audio patterns

  You may CREATE new skills when you discover a reusable game development pattern:
  1. Read `skills/skill-creator.md` for the template and guidelines
  2. Write a new `.md` file to `skills/examples/{skill-name}.md`
  3. Follow the skill structure: When to Use, Core Patterns, Gotchas, Integration
  4. Include concrete code examples that agents can copy
  5. Reference relevant utils.js utilities

  Good candidates for new skills:
  - Platformer physics (gravity, jumping, ground detection)
  - Particle systems (emitters, pooling, visual effects)
  - Enemy AI patterns (patrol, chase, state machines)
  - UI/score display patterns
  - Level generation (procedural, tile-based)

  Skills compound: each new skill makes future game generation better.
  Together with utils.js and gotchas.md, this creates a growing knowledge base.

  A. Auto-start pattern:
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
