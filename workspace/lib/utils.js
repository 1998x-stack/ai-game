// ============================================================
// Reusable Game Utilities — Pure HTML5 Canvas, no dependencies
// ============================================================
//
// EXTENSIBLE: You may APPEND new `export function` or `export class`
// at the bottom of this file. New exports are automatically available
// in game.js scope (same module). After adding functions, update
// lib/index.md to document them.
//
// WARNING: Do NOT modify or redeclare existing exports above.
// Modifying existing exports may break games that depend on them.
// ============================================================

// --------------------- Math Utilities ------------------------

export function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

export function angleBetween(x1, y1, x2, y2) {
    return Math.atan2(y2 - y1, x2 - x1);
}

// --------------------- Game Loop -----------------------------

/**
 * Wraps requestAnimationFrame with delta time, pause/resume, and
 * frame-rate independent updates.
 *
 * Usage:
 *   const loop = new GameLoop((dt) => { update(dt); render(); });
 *   loop.start();
 *   // loop.pause(); loop.resume(); loop.stop();
 */
export class GameLoop {
    constructor(callback) {
        this.callback = callback;
        this.rafId = null;
        this.running = false;
        this.paused = false;
        this.lastTime = 0;
        this._boundTick = this._tick.bind(this);
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.paused = false;
        this.lastTime = performance.now();
        this.rafId = requestAnimationFrame(this._boundTick);
    }

    stop() {
        this.running = false;
        this.paused = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    pause() {
        this.paused = true;
    }

    resume() {
        if (this.paused) {
            this.paused = false;
            this.lastTime = performance.now();
            if (this.running && this.rafId === null) {
                this.rafId = requestAnimationFrame(this._boundTick);
            }
        }
    }

    isRunning() {
        return this.running;
    }

    isPaused() {
        return this.paused;
    }

    _tick(timestamp) {
        if (!this.running || this.paused) {
            this.rafId = null;
            return;
        }

        const deltaTime = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        // Cap delta to prevent spiral of death (tab was backgrounded)
        const dt = Math.min(deltaTime, 0.05);

        this.callback(dt);

        this.rafId = requestAnimationFrame(this._boundTick);
    }
}

// --------------------- Collision Detection -------------------

export class CollisionDetector {
    /**
     * Axis-Aligned Bounding Box collision.
     * a and b are objects with: x, y, width, height
     */
    static aabb(a, b) {
        return (
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y
        );
    }

    /**
     * Circle collision (no sqrt — uses squared distances).
     * a and b are objects with: x, y, radius
     */
    static circle(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const radii = a.radius + b.radius;
        return dx * dx + dy * dy < radii * radii;
    }

    /**
     * Point-in-rectangle test.
     */
    static pointInRect(px, py, rect) {
        return (
            px >= rect.x &&
            px <= rect.x + rect.width &&
            py >= rect.y &&
            py <= rect.y + rect.height
        );
    }

    /**
     * Circle vs AABB collision.
     */
    static circleAABB(circle, rect) {
        const nearestX = clamp(circle.x, rect.x, rect.x + rect.width);
        const nearestY = clamp(circle.y, rect.y, rect.y + rect.height);
        const dx = circle.x - nearestX;
        const dy = circle.y - nearestY;
        return dx * dx + dy * dy < circle.radius * circle.radius;
    }

    /**
     * Line segment vs circle collision.
     * Returns the closest point on segment, or null if no collision.
     */
    static lineCircle(x1, y1, x2, y2, circle) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) {
            return CollisionDetector.circle(
                { x: x1, y: y1, radius: circle.radius },
                { x: circle.x, y: circle.y, radius: 0 }
            ) ? { x: x1, y: y1 } : null;
        }

        let t = ((circle.x - x1) * dx + (circle.y - y1) * dy) / lenSq;
        t = clamp(t, 0, 1);

        const nearX = x1 + t * dx;
        const nearY = y1 + t * dy;
        const distSq = (circle.x - nearX) ** 2 + (circle.y - nearY) ** 2;

        if (distSq < circle.radius * circle.radius) {
            return { x: nearX, y: nearY };
        }
        return null;
    }
}

// --------------------- Input Manager -------------------------

/**
 * Tracks keyboard state, mouse position, and provides clean input
 * queries for game logic.
 *
 * Usage:
 *   const input = new InputManager(canvas);
 *   // In update():
 *   if (input.isDown('ArrowLeft')) moveLeft();
 *   if (input.justPressed('Space')) jump();
 *   const mx = input.mouse.x, my = input.mouse.y;
 */
export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        this._keys = {};
        this._justPressed = {};
        this._justReleased = {};
        this._prevKeys = {};
        this.mouse = { x: 0, y: 0, buttons: {} };
        this.touches = [];

        this._onKeyDown = (e) => {
            if (!this._keys[e.code]) {
                this._justPressed[e.code] = true;
            }
            this._keys[e.code] = true;
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
                e.preventDefault();
            }
        };

        this._onKeyUp = (e) => {
            this._keys[e.code] = false;
            this._justReleased[e.code] = true;
        };

        this._onMouseMove = (e) => {
            const rect = canvas.getBoundingClientRect();
            this.mouse.x = (e.clientX - rect.left) * (canvas.width / rect.width);
            this.mouse.y = (e.clientY - rect.top) * (canvas.height / rect.height);
        };

        this._onMouseDown = (e) => {
            this.mouse.buttons[e.button] = true;
        };

        this._onMouseUp = (e) => {
            this.mouse.buttons[e.button] = false;
        };

        this._onTouchStart = (e) => {
            e.preventDefault();
            this.touches = Array.from(e.touches).map(t => {
                const rect = canvas.getBoundingClientRect();
                return {
                    x: (t.clientX - rect.left) * (canvas.width / rect.width),
                    y: (t.clientY - rect.top) * (canvas.height / rect.height),
                    id: t.identifier
                };
            });
        };

        this._onTouchMove = (e) => {
            e.preventDefault();
            this.touches = Array.from(e.touches).map(t => {
                const rect = canvas.getBoundingClientRect();
                return {
                    x: (t.clientX - rect.left) * (canvas.width / rect.width),
                    y: (t.clientY - rect.top) * (canvas.height / rect.height),
                    id: t.identifier
                };
            });
        };

        this._onTouchEnd = (e) => {
            e.preventDefault();
            this.touches = Array.from(e.touches).map(t => {
                const rect = canvas.getBoundingClientRect();
                return {
                    x: (t.clientX - rect.left) * (canvas.width / rect.width),
                    y: (t.clientY - rect.top) * (canvas.height / rect.height),
                    id: t.identifier
                };
            });
        };

        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        canvas.addEventListener('mousemove', this._onMouseMove);
        canvas.addEventListener('mousedown', this._onMouseDown);
        canvas.addEventListener('mouseup', this._onMouseUp);
        canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
        canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });

        // Track swipe gesture
        this.swipe = { direction: null, active: false, startX: 0, startY: 0 };
        this._swipeThreshold = 30;

        canvas.addEventListener('touchstart', (e) => {
            this.swipe.startX = e.touches[0].clientX;
            this.swipe.startY = e.touches[0].clientY;
            this.swipe.active = true;
        }, { passive: true });

        canvas.addEventListener('touchend', (e) => {
            if (!this.swipe.active) return;
            this.swipe.active = false;
            const dx = e.changedTouches[0].clientX - this.swipe.startX;
            const dy = e.changedTouches[0].clientY - this.swipe.startY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            if (Math.max(absDx, absDy) < this._swipeThreshold) return;

            if (absDx > absDy) {
                this.swipe.direction = dx > 0 ? 'right' : 'left';
            } else {
                this.swipe.direction = dy > 0 ? 'down' : 'up';
            }
        }, { passive: true });
    }

    /** Returns true while a key is held down */
    isDown(code) {
        return !!this._keys[code];
    }

    /** Returns true only on the frame the key was first pressed */
    justPressed(code) {
        return !!this._justPressed[code];
    }

    /** Returns true only on the frame the key was released */
    justReleased(code) {
        return !!this._justReleased[code];
    }

    /** Returns the consumed swipe direction ('left','right','up','down') or null */
    getSwipe() {
        const dir = this.swipe.direction;
        this.swipe.direction = null; // Consume
        return dir;
    }

    /** Call at the end of each update cycle to clear one-shot flags */
    endFrame() {
        this._justPressed = {};
        this._justReleased = {};
    }

    /** Clean up event listeners */
    destroy() {
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove', this._onTouchMove);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
    }
}

// --------------------- Sprite Manager ------------------------

/**
 * Loads and caches images. Supports sprite sheet animation frames.
 *
 * Usage:
 *   const sprites = new SpriteManager();
 *   await sprites.load('player', 'player.png');
 *   // sprites.get('player') => Image
 *   // sprites.draw(ctx, 'player', x, y, w, h);
 */
export class SpriteManager {
    constructor() {
        this._images = new Map();
        this._loaded = false;
    }

    /**
     * Load an image by name.
     * Returns a promise that resolves when the image loads.
     */
    load(name, src) {
        return new Promise((resolve, reject) => {
            if (this._images.has(name)) {
                resolve(this._images.get(name));
                return;
            }
            const img = new Image();
            img.onload = () => {
                this._images.set(name, img);
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
            img.src = src;
        });
    }

    /**
     * Load multiple images at once.
     * Returns a promise that resolves when ALL images are loaded.
     */
    loadAll(images) {
        const promises = Object.entries(images).map(([name, src]) =>
            this.load(name, src)
        );
        return Promise.all(promises);
    }

    /** Get a loaded image by name */
    get(name) {
        if (!this._images.has(name)) {
            console.warn(`Sprite "${name}" not loaded`);
            return null;
        }
        return this._images.get(name);
    }

    /** Draw a sprite at the given position and size */
    draw(ctx, name, x, y, w, h) {
        const img = this.get(name);
        if (img) {
            ctx.drawImage(img, x, y, w, h);
        }
    }

    /** Draw a frame from a sprite sheet */
    drawFrame(ctx, name, frameIndex, frameWidth, frameHeight, x, y, w, h) {
        const img = this.get(name);
        if (img) {
            ctx.drawImage(
                img,
                frameIndex * frameWidth, 0,
                frameWidth, frameHeight,
                x, y,
                w || frameWidth, h || frameHeight
            );
        }
    }

    /** Check if a specific sprite is loaded */
    isLoaded(name) {
        return this._images.has(name);
    }
}

// --------------------- Simple Animation Frames ----------------

/**
 * Manages sprite sheet frame timing for animation.
 *
 * Usage:
 *   const anim = new Animation(4, 8); // 4 frames, 8 fps
 *   anim.update(dt);
 *   sprites.drawFrame(ctx, 'player', anim.frame, 32, 32, x, y);
 */
export class Animation {
    constructor(frameCount, fps = 12, loop = true) {
        this.frameCount = frameCount;
        this.frameDuration = 1 / fps;
        this.loop = loop;
        this.elapsed = 0;
        this.frame = 0;
        this.done = false;
    }

    update(dt) {
        if (this.done) return;
        this.elapsed += dt;
        while (this.elapsed >= this.frameDuration) {
            this.elapsed -= this.frameDuration;
            this.frame++;
            if (this.frame >= this.frameCount) {
                if (this.loop) {
                    this.frame = 0;
                } else {
                    this.frame = this.frameCount - 1;
                    this.done = true;
                    return;
                }
            }
        }
    }

    reset() {
        this.frame = 0;
        this.elapsed = 0;
        this.done = false;
    }

    isDone() {
        return this.done;
    }
}

// --------------------- Sound Manager --------------------------

/**
 * Minimal Web Audio API wrapper for basic sound effects.
 * All sounds must be short (under ~1 second) for instant playback.
 *
 * Usage:
 *   const sounds = new SoundManager();
 *   await sounds.init(); // Must be called after user interaction
 *   sounds.play('sound.wav');
 */
export class SoundManager {
    constructor() {
        this.ctx = null;
        this.buffers = new Map();
        this.muted = false;
        this.masterVolume = 1.0;
    }

    /** Initialize AudioContext (must be called from user gesture) */
    init() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            return true;
        } catch (e) {
            console.warn('Web Audio API not available:', e);
            return false;
        }
    }

    /** Load a sound file */
    async load(name, url) {
        if (!this.ctx) return;
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.buffers.set(name, audioBuffer);
        } catch (e) {
            console.warn(`Failed to load sound "${name}":`, e);
        }
    }

    /** Play a loaded sound */
    play(name, volume = 1.0) {
        if (!this.ctx || this.muted) return;
        const buffer = this.buffers.get(name);
        if (!buffer) return;

        // Resume context if suspended (autoplay policy)
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const source = this.ctx.createBufferSource();
        const gainNode = this.ctx.createGain();
        gainNode.gain.value = volume * this.masterVolume;

        source.buffer = buffer;
        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        source.start(0);
    }

    /**
     * Generate a simple beep tone (no external file needed).
     * Useful for retro games or when sound files aren't available.
     */
    beep(frequency = 440, duration = 0.1, type = 'square') {
        if (!this.ctx || this.muted) return;

        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(this.masterVolume * 0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + duration);
    }

    toggleMute() {
        this.muted = !this.muted;
        return this.muted;
    }

    setVolume(v) {
        this.masterVolume = clamp(v, 0, 1);
    }

    /** Check if AudioContext has been initialized */
    isReady() {
        return this.ctx !== null;
    }
}

// --------------------- Object Pool ----------------------------

/**
 * Generic object pool to reduce GC pressure from frequent
 * create/destroy cycles (bullets, particles, enemies).
 *
 * Usage:
 *   const pool = new ObjectPool(
 *     () => ({ x: 0, y: 0, alive: false }),
 *     (obj) => { obj.alive = false; }
 *   );
 *   const bullet = pool.acquire();
 *   bullet.x = 100; bullet.y = 200; bullet.alive = true;
 *   // ... later:
 *   pool.release(bullet);
 */
export class ObjectPool {
    constructor(createFn, resetFn, initialSize = 20) {
        this._createFn = createFn;
        this._resetFn = resetFn;
        this._pool = [];
        this.active = new Set();

        for (let i = 0; i < initialSize; i++) {
            this._pool.push(createFn());
        }
    }

    acquire() {
        let obj = this._pool.pop();
        if (!obj) {
            obj = this._createFn();
        }
        this.active.add(obj);
        return obj;
    }

    release(obj) {
        this._resetFn(obj);
        this.active.delete(obj);
        this._pool.push(obj);
    }

    releaseAll() {
        for (const obj of this.active) {
            this._resetFn(obj);
            this._pool.push(obj);
        }
        this.active.clear();
    }

    /** Iterate over active objects (safe for release during iteration) */
    forEach(fn) {
        for (const obj of this.active) {
            fn(obj);
        }
    }
}

// --------------------- Responsive Canvas Helper ---------------

/**
 * Sets up a canvas with a fixed design resolution that scales
 * responsively within its container while maintaining aspect ratio.
 *
 * Usage:
 *   const canvas = setupCanvas('gameCanvas', 800, 600);
 *   const ctx = canvas.getContext('2d');
 */
export function setupCanvas(canvasId, designW = 800, designH = 600) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) throw new Error(`Canvas #${canvasId} not found`);

    canvas.width = designW;
    canvas.height = designH;

    function resize() {
        const parent = canvas.parentElement;
        if (!parent) return;
        const maxW = parent.clientWidth || window.innerWidth;
        const maxH = parent.clientHeight || window.innerHeight;
        const scale = Math.min(maxW / designW, maxH / designH, 1);
        canvas.style.width = `${designW * scale}px`;
        canvas.style.height = `${designH * scale}px`;
    }

    // Apply pixel-art rendering by default
    canvas.style.imageRendering = 'pixelated';

    window.addEventListener('resize', resize);
    resize();

    return canvas;
}

// ============================================================
// 2D Vector Math
// ============================================================

export class Vector2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }

    set(x, y) { this.x = x; this.y = y; return this; }
    copy() { return new Vector2(this.x, this.y); }
    add(v) { this.x += v.x; this.y += v.y; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; return this; }
    scale(s) { this.x *= s; this.y *= s; return this; }
    magnitude() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    normalize() {
        const mag = this.magnitude();
        if (mag > 0) { this.x /= mag; this.y /= mag; }
        return this;
    }
    rotate(angle) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const x = this.x * cos - this.y * sin;
        this.y = this.x * sin + this.y * cos;
        this.x = x;
        return this;
    }
    angle() { return Math.atan2(this.y, this.x); }
    dot(v) { return this.x * v.x + this.y * v.y; }
    distanceTo(v) { return distance(this.x, this.y, v.x, v.y); }

    // Static helpers
    static add(a, b) { return new Vector2(a.x + b.x, a.y + b.y); }
    static sub(a, b) { return new Vector2(a.x - b.x, a.y - b.y); }
    static scale(v, s) { return new Vector2(v.x * s, v.y * s); }
    static fromAngle(angle, magnitude = 1) {
        return new Vector2(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude);
    }
}

// ============================================================
// 2D Camera — follow target with smooth lerp
// ============================================================

export class Camera {
    constructor(worldW, worldH, viewW, viewH) {
        this.x = 0; this.y = 0;
        this.worldW = worldW; this.worldH = worldH;
        this.viewW = viewW; this.viewH = viewH;
        this.smoothFactor = 0.08;
        this.deadzone = { x: 0, y: 0, w: viewW * 0.3, h: viewH * 0.3 };
    }

    follow(targetX, targetY, dt) {
        const desiredX = targetX - this.viewW / 2;
        const desiredY = targetY - this.viewH / 2;

        if (Math.abs(this.x - desiredX) < this.deadzone.w / 2) {
            // inside horizontal deadzone — no movement
        } else {
            this.x = lerp(this.x, desiredX, 1 - Math.pow(1 - this.smoothFactor, dt * 60));
        }
        if (Math.abs(this.y - desiredY) < this.deadzone.h / 2) {
            // inside vertical deadzone
        } else {
            this.y = lerp(this.y, desiredY, 1 - Math.pow(1 - this.smoothFactor, dt * 60));
        }

        this.x = clamp(this.x, 0, Math.max(0, this.worldW - this.viewW));
        this.y = clamp(this.y, 0, Math.max(0, this.worldH - this.viewH));
    }

    apply(ctx) {
        ctx.save();
        ctx.translate(-this.x, -this.y);
    }

    restore(ctx) { ctx.restore(); }

    shake(intensity) {
        const sx = (Math.random() - 0.5) * intensity * 2;
        const sy = (Math.random() - 0.5) * intensity * 2;
        this.x += sx;
        this.y += sy;
    }
}

// ============================================================
// Timer / Cooldown
// ============================================================

export class Timer {
    constructor(duration, autoReset = false) {
        this.duration = duration;
        this.elapsed = 0;
        this.autoReset = autoReset;
        this._done = false;
    }

    update(dt) {
        if (this._done) return;
        this.elapsed += dt;
        if (this.elapsed >= this.duration) {
            this._done = true;
            if (this.autoReset) this.reset();
        }
    }

    isDone() { return this._done; }
    progress() { return clamp(this.elapsed / this.duration, 0, 1); }
    remaining() { return Math.max(0, this.duration - this.elapsed); }

    reset(newDuration) {
        if (newDuration !== undefined) this.duration = newDuration;
        this.elapsed = 0;
        this._done = false;
    }
}

// ============================================================
// Easing Functions
// ============================================================

export const Easing = {
    linear: (t) => t,

    inQuad: (t) => t * t,
    outQuad: (t) => t * (2 - t),
    inOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

    inCubic: (t) => t * t * t,
    outCubic: (t) => (--t) * t * t + 1,
    inOutCubic: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

    inSine: (t) => 1 - Math.cos(t * Math.PI / 2),
    outSine: (t) => Math.sin(t * Math.PI / 2),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,

    inElastic: (t) => {
        if (t === 0 || t === 1) return t;
        return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.075) * (2 * Math.PI) / 0.3);
    },
    outElastic: (t) => {
        if (t === 0 || t === 1) return t;
        return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
    },
    outBounce: (t) => {
        if (t < 1 / 2.75) return 7.5625 * t * t;
        if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
        if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
        return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    },
};

// ============================================================
// Screen Shake
// ============================================================

export class ScreenShake {
    constructor() {
        this.intensity = 0;
        this.decay = 4;
    }

    trigger(intensity = 8, decay = 4) {
        this.intensity = Math.max(this.intensity, intensity);
        this.decay = decay;
    }

    update(dt) {
        if (this.intensity <= 0.01) { this.intensity = 0; return; }
        this.intensity *= Math.exp(-this.decay * dt);
    }

    apply(ctx) {
        if (this.intensity <= 0) return;
        const sx = (Math.random() - 0.5) * this.intensity * 2;
        const sy = (Math.random() - 0.5) * this.intensity * 2;
        ctx.save();
        ctx.translate(sx, sy);
    }

    restore(ctx) {
        if (this.intensity <= 0) return;
        ctx.restore();
    }
}

// ============================================================
// Seeded Random Number Generator (Mulberry32)
// For reproducible procedural generation
// ============================================================

export class SeededRandom {
    constructor(seed = Date.now()) {
        this.seed = seed;
        this.state = seed;
    }

    next() {
        let t = this.state += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    range(min, max) {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    reset() { this.state = this.seed; }
}
