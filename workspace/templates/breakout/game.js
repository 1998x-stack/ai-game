// Breakout Game — Pure HTML5 Canvas
// Paddle, ball physics, brick grid, score, lives, power-ups

const DESIGN_W = 600;
const DESIGN_H = 750;

// Colors
const COLORS = {
    bg: '#0f0f23',
    paddle: '#4ecca3',
    ball: '#fff',
    brick: ['#e84545', '#e8a045', '#e8d445', '#45e8a0', '#4580e8'],
    text: '#fff',
    subtitle: '#aaa'
};

const PADDLE_W = 80;
const PADDLE_H = 12;
const BALL_R = 6;
const BRICK_W = 50;
const BRICK_H = 18;
const BRICK_PAD = 4;
const BRICK_ROWS = 8;
const BRICK_COLS = 10;
const BRICK_TOP = 60;
const BALL_SPEED_BASE = 350;

// Power-up types
const POWERUP_TYPES = [
    { type: 'wide', color: '#e8d445', duration: 8, label: 'WIDE' },
    { type: 'slow', color: '#4580e8', duration: 6, label: 'SLOW' },
    { type: 'life', color: '#e84545', duration: 0, label: '+1 UP' }
];

export default class BreakoutGame {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        canvas.width = DESIGN_W;
        canvas.height = DESIGN_H;

        // Game state
        this.state = 'menu'; // menu | playing | paused | gameover | win
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.highScore = parseInt(localStorage.getItem('breakoutHighScore') || '0');

        // Paddle
        this.paddle = { x: 0, y: 0, w: PADDLE_W, h: PADDLE_H };

        // Ball
        this.ball = { x: 0, y: 0, r: BALL_R, vx: 0, vy: 0, stuck: true };

        // Bricks
        this.bricks = [];

        // Power-ups
        this.powerups = [];
        this.activePowerups = {};

        // Input
        this.keys = {};
        this.mouseX = DESIGN_W / 2;
        this.mouseDown = false;

        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            if (e.code === 'Space' || e.code === 'Enter') {
                if (this.state === 'menu') this.startGame();
                else if (this.state === 'gameover') this.startGame();
                else if (this.state === 'win') this.nextLevel();
                else if (this.state === 'playing' && this.ball.stuck) this.launchBall();
            }
            if (e.code === 'KeyP' && this.state === 'playing') this.state = 'paused';
            else if (e.code === 'KeyP' && this.state === 'paused') this.state = 'playing';
            if (['ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
        };
        this._onKeyUp = (e) => { this.keys[e.code] = false; };
        this._onMouseMove = (e) => {
            const rect = canvas.getBoundingClientRect();
            this.mouseX = (e.clientX - rect.left) * (DESIGN_W / rect.width);
            this.mouseDown = e.buttons > 0;
        };
        this._onMouseDown = (e) => {
            this.mouseDown = true;
            if (this.state === 'menu') this.startGame();
            else if (this.state === 'gameover') this.startGame();
            else if (this.state === 'win') this.nextLevel();
            else if (this.state === 'playing' && this.ball.stuck) this.launchBall();
        };
        this._onMouseUp = () => { this.mouseDown = false; };

        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);
        canvas.addEventListener('mousemove', this._onMouseMove);
        canvas.addEventListener('mousedown', this._onMouseDown);
        canvas.addEventListener('mouseup', this._onMouseUp);

        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const maxW = parent.clientWidth || window.innerWidth;
        const maxH = parent.clientHeight || window.innerHeight;
        const scale = Math.min(maxW / DESIGN_W, maxH / DESIGN_H, 1);
        this.canvas.style.width = `${DESIGN_W * scale}px`;
        this.canvas.style.height = `${DESIGN_H * scale}px`;
    }

    startGame() {
        this.score = 0;
        this.lives = 3;
        this.level = 1;
        this.activePowerups = {};
        this.state = 'playing';
        this.setupLevel();
    }

    nextLevel() {
        this.level++;
        this.activePowerups = {};
        this.state = 'playing';
        this.setupLevel();
    }

    setupLevel() {
        this.buildBricks();
        this.resetBall();
        this.paddle.x = (DESIGN_W - this.paddle.w) / 2;
        this.paddle.y = DESIGN_H - 40;
    }

    buildBricks() {
        this.bricks = [];
        const rows = Math.min(BRICK_ROWS, 3 + this.level * 2);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < BRICK_COLS; col++) {
                const strength = Math.max(1, rows - row - Math.floor(this.level / 2));
                this.bricks.push({
                    x: col * (BRICK_W + BRICK_PAD) + BRICK_PAD / 2,
                    y: BRICK_TOP + row * (BRICK_H + BRICK_PAD),
                    w: BRICK_W,
                    h: BRICK_H,
                    row: row,
                    col: col,
                    color: COLORS.brick[row % COLORS.brick.length],
                    strength: strength,
                    alive: true
                });
            }
        }
    }

    resetBall() {
        this.ball.stuck = true;
        this.ball.x = this.paddle.x + this.paddle.w / 2;
        this.ball.y = this.paddle.y - this.ball.r;
    }

    launchBall() {
        this.ball.stuck = false;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
        const speed = BALL_SPEED_BASE;
        this.ball.vx = Math.cos(angle) * speed;
        this.ball.vy = Math.sin(angle) * speed;
    }

    spawnPowerup(x, y) {
        if (Math.random() > 0.2) return; // 20% chance
        const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
        this.powerups.push({
            x: x, y: y, w: 24, h: 14,
            type: type.type,
            color: type.color,
            label: type.label,
            duration: type.duration,
            vy: 120
        });
    }

    update(dt) {
        if (this.state === 'paused') return;
        if (this.state === 'menu' || this.state === 'gameover' || this.state === 'win') return;

        // Update paddle position (mouse + keyboard)
        let targetX = this.mouseX - this.paddle.w / 2;
        if (this.keys['ArrowLeft']) targetX = this.paddle.x - 400 * dt;
        if (this.keys['ArrowRight']) targetX = this.paddle.x + 400 * dt;
        this.paddle.x = Math.max(0, Math.min(DESIGN_W - this.paddle.w, targetX));

        // Update active powerup timers
        for (const key of Object.keys(this.activePowerups)) {
            if (this.activePowerups[key].duration > 0) {
                this.activePowerups[key].remaining -= dt;
                if (this.activePowerups[key].remaining <= 0) {
                    this.removePowerup(key);
                }
            }
        }

        // Current paddle width (accounting for wide powerup)
        const paddleW = this.activePowerups['wide'] ? PADDLE_W * 1.5 : PADDLE_W;

        // Ball update
        if (this.ball.stuck) {
            this.ball.x = this.paddle.x + paddleW / 2;
            this.ball.y = this.paddle.y - this.ball.r;
            return;
        }

        // Slow powerup affects ball speed
        const speedMultiplier = this.activePowerups['slow'] ? 0.6 : 1;

        this.ball.x += this.ball.vx * speedMultiplier * dt;
        this.ball.y += this.ball.vy * speedMultiplier * dt;

        // Wall collisions
        if (this.ball.x - this.ball.r <= 0) { this.ball.x = this.ball.r; this.ball.vx *= -1; }
        if (this.ball.x + this.ball.r >= DESIGN_W) { this.ball.x = DESIGN_W - this.ball.r; this.ball.vx *= -1; }
        if (this.ball.y - this.ball.r <= 0) { this.ball.y = this.ball.r; this.ball.vy *= -1; }

        // Ball falls below paddle
        if (this.ball.y + this.ball.r > DESIGN_H) {
            this.lives--;
            if (this.lives <= 0) {
                this.state = 'gameover';
                this.saveHighScore();
            } else {
                this.resetBall();
            }
            return;
        }

        // Paddle collision
        if (this.ball.vy > 0 &&
            this.ball.y + this.ball.r >= this.paddle.y &&
            this.ball.y + this.ball.r <= this.paddle.y + this.paddle.h + 8 &&
            this.ball.x >= this.paddle.x - this.ball.r &&
            this.ball.x <= this.paddle.x + paddleW + this.ball.r) {

            // Angle based on where ball hits paddle
            const hitPos = (this.ball.x - this.paddle.x) / paddleW; // 0..1
            const angle = (hitPos - 0.5) * Math.PI * 0.75; // -67.5 to +67.5 degrees
            const speed = Math.sqrt(this.ball.vx * this.ball.vx + this.ball.vy * this.ball.vy);
            this.ball.vx = Math.cos(angle) * speed;
            this.ball.vy = -Math.abs(Math.sin(angle) * speed);
            this.ball.y = this.paddle.y - this.ball.r;
        }

        // Brick collisions
        for (const brick of this.bricks) {
            if (!brick.alive) continue;

            // AABB collision (ball vs brick)
            const nearX = Math.max(brick.x, Math.min(this.ball.x, brick.x + brick.w));
            const nearY = Math.max(brick.y, Math.min(this.ball.y, brick.y + brick.h));
            const dx = this.ball.x - nearX;
            const dy = this.ball.y - nearY;
            const distSq = dx * dx + dy * dy;

            if (distSq < this.ball.r * this.ball.r) {
                // Determine bounce direction
                const overlapX = (this.ball.x < brick.x || this.ball.x > brick.x + brick.w);
                if (overlapX) {
                    this.ball.vx *= -1;
                } else {
                    this.ball.vy *= -1;
                }

                brick.strength--;
                if (brick.strength <= 0) {
                    brick.alive = false;
                    this.score += 10 * this.level;
                    if (this.score > this.highScore) this.highScore = this.score;
                    this.spawnPowerup(brick.x + brick.w / 2, brick.y + brick.h / 2);
                } else {
                    this.score += 5;
                }
                break; // Only one brick collision per frame
            }
        }

        // Check win
        if (this.bricks.length > 0 && this.bricks.every(b => !b.alive)) {
            this.state = 'win';
        }

        // Power-up updates
        for (let i = this.powerups.length - 1; i >= 0; i--) {
            const pu = this.powerups[i];
            pu.y += pu.vy * dt;

            // Check catch by paddle
            if (pu.y + pu.h >= this.paddle.y &&
                pu.y <= this.paddle.y + this.paddle.h &&
                pu.x + pu.w >= this.paddle.x &&
                pu.x <= this.paddle.x + paddleW) {

                this.activatePowerup(pu);
                this.powerups.splice(i, 1);
                continue;
            }

            // Remove if off screen
            if (pu.y > DESIGN_H) {
                this.powerups.splice(i, 1);
            }
        }
    }

    activatePowerup(pu) {
        switch (pu.type) {
            case 'life':
                this.lives++;
                break;
            case 'wide':
                this.activePowerups['wide'] = {
                    duration: POWERUP_TYPES[0].duration,
                    remaining: POWERUP_TYPES[0].duration
                };
                // Resize paddle visual
                this.paddle.w = PADDLE_W * 1.5;
                break;
            case 'slow':
                this.activePowerups['slow'] = {
                    duration: POWERUP_TYPES[1].duration,
                    remaining: POWERUP_TYPES[1].duration
                };
                break;
        }
    }

    removePowerup(key) {
        delete this.activePowerups[key];
        if (key === 'wide') {
            this.paddle.w = PADDLE_W;
        }
    }

    saveHighScore() {
        if (this.score > parseInt(localStorage.getItem('breakoutHighScore') || '0')) {
            localStorage.setItem('breakoutHighScore', String(this.score));
        }
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

        // Background
        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

        // Bricks
        for (const brick of this.bricks) {
            if (!brick.alive) continue;
            ctx.fillStyle = brick.color;
            ctx.fillRect(brick.x, brick.y, brick.w, brick.h);

            // Lighter top edge for 3D effect
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(brick.x, brick.y, brick.w, 3);

            // Strength indicator
            if (brick.strength > 1) {
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.font = '10px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(String(brick.strength), brick.x + brick.w / 2, brick.y + brick.h - 5);
            }
        }

        // Power-ups
        for (const pu of this.powerups) {
            ctx.fillStyle = pu.color;
            ctx.fillRect(pu.x, pu.y, pu.w, pu.h);
            ctx.fillStyle = '#fff';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(pu.label, pu.x + pu.w / 2, pu.y + 10);
        }

        // Paddle
        ctx.fillStyle = COLORS.paddle;
        ctx.fillRect(this.paddle.x, this.paddle.y, this.paddle.w, this.paddle.h);

        // Ball
        ctx.fillStyle = COLORS.ball;
        ctx.beginPath();
        ctx.arc(this.ball.x, this.ball.y, this.ball.r, 0, Math.PI * 2);
        ctx.fill();

        // HUD
        ctx.fillStyle = COLORS.text;
        ctx.font = '14px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Score: ${this.score}`, 10, 20);
        ctx.textAlign = 'right';
        ctx.fillText(`Hi: ${this.highScore}`, DESIGN_W - 10, 20);
        ctx.textAlign = 'center';
        ctx.fillText(`Level ${this.level}`, DESIGN_W / 2, 20);
        ctx.textAlign = 'left';
        // Draw lives (small balls)
        for (let i = 0; i < this.lives; i++) {
            ctx.beginPath();
            ctx.arc(20 + i * 20, 38, 4, 0, Math.PI * 2);
            ctx.fill();
        }

        // Active powerup indicators
        let puY = 50;
        for (const [key, data] of Object.entries(this.activePowerups)) {
            if (data.duration > 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.font = '10px monospace';
                ctx.textAlign = 'left';
                ctx.fillText(`${key.toUpperCase()}: ${Math.ceil(data.remaining)}s`, 10, puY);
                puY += 14;
            }
        }

        // State overlays
        if (this.state === 'menu') {
            this.drawOverlay('BREAKOUT', 'Click or press SPACE to start');
        } else if (this.state === 'paused') {
            this.drawOverlay('PAUSED', 'Press P to resume');
        } else if (this.state === 'gameover') {
            this.drawOverlay('GAME OVER', `Score: ${this.score}  Press SPACE to restart`);
        } else if (this.state === 'win') {
            this.drawOverlay('LEVEL COMPLETE!', `Score: ${this.score}  Press SPACE for next level`);
        }
    }

    drawOverlay(title, subtitle) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.paddle;
        ctx.font = 'bold 36px monospace';
        ctx.fillText(title, DESIGN_W / 2, DESIGN_H / 2 - 30);
        ctx.fillStyle = COLORS.subtitle;
        ctx.font = '14px monospace';
        ctx.fillText(subtitle, DESIGN_W / 2, DESIGN_H / 2 + 15);
    }

    start() {
        this.lastTime = performance.now();
        const loop = (timestamp) => {
            const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
            this.lastTime = timestamp;
            this.update(dt);
            this.render();
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    stop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        this.canvas.removeEventListener('mouseup', this._onMouseUp);
    }
}
