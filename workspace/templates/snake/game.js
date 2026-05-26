// Snake Game — Pure HTML5 Canvas
// Grid-based movement, keyboard controls, score tracking, difficulty scaling

const COLS = 20;
const ROWS = 20;
const TILE_SIZE = 20; // Base tile size in design resolution
const DESIGN_W = COLS * TILE_SIZE;
const DESIGN_H = ROWS * TILE_SIZE;
const MOVE_INTERVAL_BASE = 0.15; // Seconds between moves at starting speed

const OPPOSITE = {
    'up': 'down',
    'down': 'up',
    'left': 'right',
    'right': 'left'
};

export default class SnakeGame {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // Responsive sizing: internal resolution fixed, CSS scales
        canvas.width = DESIGN_W;
        canvas.height = DESIGN_H;

        this.state = 'menu'; // menu | playing | gameover
        this.score = 0;
        this.highScore = parseInt(localStorage.getItem('snakeHighScore') || '0');

        // Input tracking — buffer one pending direction per frame
        this.keys = {};
        this.pendingDirection = null;

        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            const dirMap = {
                'ArrowUp': 'up', 'KeyW': 'up',
                'ArrowDown': 'down', 'KeyS': 'down',
                'ArrowLeft': 'left', 'KeyA': 'left',
                'ArrowRight': 'right', 'KeyD': 'right'
            };
            const newDir = dirMap[e.code];
            if (newDir && this.state === 'playing') {
                // Gotcha #1: prevent 180-degree turn (check current + pending)
                const currentDir = this.pendingDirection || this.direction;
                if (newDir !== OPPOSITE[currentDir]) {
                    this.pendingDirection = newDir;
                }
            }
            if ((e.code === 'Space' || e.code === 'Enter') && this.state === 'menu') {
                this.startGame();
            }
            if ((e.code === 'Space' || e.code === 'Enter') && this.state === 'gameover') {
                this.startGame();
            }
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
                e.preventDefault();
            }
        };

        this._onKeyUp = (e) => {
            this.keys[e.code] = false;
        };

        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);

        // Responsive resize
        this._resize();
        window.addEventListener('resize', () => this._resize());

        // Game loop state
        this.lastTime = 0;
        this.moveTimer = 0;
        this.rafId = null;
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
        // Snake starts at center, moving right
        const startX = Math.floor(COLS / 4);
        const startY = Math.floor(ROWS / 2);
        this.snake = [
            { x: startX, y: startY },
            { x: startX - 1, y: startY },
            { x: startX - 2, y: startY }
        ];
        this.direction = 'right';
        this.pendingDirection = null;
        this.score = 0;
        this.moveTimer = 0;
        this.state = 'playing';
        this.spawnFood();
    }

    spawnFood() {
        // Gotcha #2: ensure food doesn't spawn on snake body
        const occupied = new Set(this.snake.map(s => `${s.x},${s.y}`));
        const available = [];
        for (let x = 0; x < COLS; x++) {
            for (let y = 0; y < ROWS; y++) {
                if (!occupied.has(`${x},${y}`)) {
                    available.push({ x, y });
                }
            }
        }
        if (available.length === 0) {
            // Snake fills the entire board — win condition
            this.state = 'gameover';
            this.food = null;
            return;
        }
        this.food = available[Math.floor(Math.random() * available.length)];
    }

    getMoveInterval() {
        // Gotcha #8: speed increases with score (difficulty scaling)
        const speedFactor = Math.min(this.score * 0.02, 0.7); // Cap speed increase
        return MOVE_INTERVAL_BASE * (1 - speedFactor);
    }

    update(dt) {
        if (this.state !== 'playing') return;

        // Apply deferred directions (Gotcha #1)
        if (this.pendingDirection) {
            this.direction = this.pendingDirection;
            this.pendingDirection = null;
        }

        this.moveTimer += dt;
        const interval = this.getMoveInterval();
        if (this.moveTimer < interval) return;
        this.moveTimer -= interval;

        // Move snake: compute new head position
        const head = this.snake[0];
        let newHead;
        switch (this.direction) {
            case 'up':    newHead = { x: head.x, y: head.y - 1 }; break;
            case 'down':  newHead = { x: head.x, y: head.y + 1 }; break;
            case 'left':  newHead = { x: head.x - 1, y: head.y }; break;
            case 'right': newHead = { x: head.x + 1, y: head.y }; break;
        }

        // Gotcha #9: clamp — check wall collision
        if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
            this.state = 'gameover';
            this.saveHighScore();
            return;
        }

        // Check self-collision (skip tail because it moves away — unless eating)
        const willEat = this.food && newHead.x === this.food.x && newHead.y === this.food.y;
        const bodyToCheck = willEat ? this.snake : this.snake.slice(0, -1);
        for (const seg of bodyToCheck) {
            if (newHead.x === seg.x && newHead.y === seg.y) {
                this.state = 'gameover';
                this.saveHighScore();
                return;
            }
        }

        // Move head
        this.snake.unshift(newHead);

        if (willEat) {
            this.score += 10;
            if (this.score > this.highScore) {
                this.highScore = this.score;
            }
            this.spawnFood();
            // Do NOT remove tail — snake grows
        } else {
            this.snake.pop(); // Remove tail
        }
    }

    saveHighScore() {
        if (this.score > parseInt(localStorage.getItem('snakeHighScore') || '0')) {
            localStorage.setItem('snakeHighScore', String(this.score));
        }
    }

    render() {
        const ctx = this.ctx;

        // Gotcha #4: clear canvas before each frame
        ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

        // Background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

        // Draw grid lines (subtle)
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= COLS; x++) {
            ctx.beginPath();
            ctx.moveTo(x * TILE_SIZE, 0);
            ctx.lineTo(x * TILE_SIZE, DESIGN_H);
            ctx.stroke();
        }
        for (let y = 0; y <= ROWS; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * TILE_SIZE);
            ctx.lineTo(DESIGN_W, y * TILE_SIZE);
            ctx.stroke();
        }

        // Draw snake
        this.snake.forEach((seg, i) => {
            const isHead = i === 0;
            ctx.fillStyle = isHead ? '#4ecca3' : '#2d9b7a';
            const padding = 1;
            ctx.fillRect(
                seg.x * TILE_SIZE + padding,
                seg.y * TILE_SIZE + padding,
                TILE_SIZE - padding * 2,
                TILE_SIZE - padding * 2
            );
            // Eyes on head
            if (isHead) {
                ctx.fillStyle = '#fff';
                const eyeSize = 3;
                let ex1, ey1, ex2, ey2;
                switch (this.direction) {
                    case 'up':
                        ex1 = seg.x * TILE_SIZE + 5; ey1 = seg.y * TILE_SIZE + 5;
                        ex2 = seg.x * TILE_SIZE + 12; ey2 = seg.y * TILE_SIZE + 5;
                        break;
                    case 'down':
                        ex1 = seg.x * TILE_SIZE + 5; ey1 = seg.y * TILE_SIZE + 12;
                        ex2 = seg.x * TILE_SIZE + 12; ey2 = seg.y * TILE_SIZE + 12;
                        break;
                    case 'left':
                        ex1 = seg.x * TILE_SIZE + 5; ey1 = seg.y * TILE_SIZE + 5;
                        ex2 = seg.x * TILE_SIZE + 5; ey2 = seg.y * TILE_SIZE + 12;
                        break;
                    case 'right':
                        ex1 = seg.x * TILE_SIZE + 12; ey1 = seg.y * TILE_SIZE + 5;
                        ex2 = seg.x * TILE_SIZE + 12; ey2 = seg.y * TILE_SIZE + 12;
                        break;
                }
                ctx.beginPath();
                ctx.arc(ex1, ey1, eyeSize, 0, Math.PI * 2);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(ex2, ey2, eyeSize, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Draw food
        if (this.food) {
            ctx.fillStyle = '#e84545';
            const fx = this.food.x * TILE_SIZE + TILE_SIZE / 2;
            const fy = this.food.y * TILE_SIZE + TILE_SIZE / 2;
            ctx.beginPath();
            ctx.arc(fx, fy, TILE_SIZE / 2 - 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Draw score
        ctx.fillStyle = '#fff';
        ctx.font = '14px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Score: ${this.score}`, 10, 18);
        ctx.textAlign = 'right';
        ctx.fillText(`Best: ${this.highScore}`, DESIGN_W - 10, 18);

        // Draw overlay for menu/gameover states
        if (this.state === 'menu') {
            this.drawOverlay('SNAKE', 'Press SPACE or ENTER to start');
        } else if (this.state === 'gameover') {
            this.drawOverlay('GAME OVER', `Score: ${this.score}  Press SPACE to restart`);
        }
    }

    drawOverlay(title, subtitle) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#4ecca3';
        ctx.font = 'bold 36px monospace';
        ctx.fillText(title, DESIGN_W / 2, DESIGN_H / 2 - 30);

        ctx.fillStyle = '#ccc';
        ctx.font = '14px monospace';
        ctx.fillText(subtitle, DESIGN_W / 2, DESIGN_H / 2 + 15);
    }

    // === Public API for the game loop ===

    start() {
        this.lastTime = performance.now();
        const loop = (timestamp) => {
            // Gotcha #3: use delta time
            const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
            this.lastTime = timestamp;

            this.update(dt);
            this.render();

            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    stop() {
        // Gotcha #6: cancel rAF on cleanup
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        document.removeEventListener('keydown', this._onKeyDown);
        document.removeEventListener('keyup', this._onKeyUp);
    }
}
