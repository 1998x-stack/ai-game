// Snake Game — Using utils.js GameLoop + InputManager
// Grid-based movement, keyboard/swipe controls, score tracking, difficulty scaling

const COLS = 20;
const ROWS = 20;
const TILE_SIZE = 20;
const DESIGN_W = COLS * TILE_SIZE;
const DESIGN_H = ROWS * TILE_SIZE;
const MOVE_INTERVAL_BASE = 0.15;

const OPPOSITE = {
    'up': 'down',
    'down': 'up',
    'left': 'right',
    'right': 'left'
};

export default class SnakeGame {
    constructor() {
        this.canvas = setupCanvas('gameCanvas', DESIGN_W, DESIGN_H);
        this.ctx = this.canvas.getContext('2d');
        this.input = new InputManager(this.canvas);

        this.state = 'menu'; // menu | playing | gameover
        this.score = 0;
        this.highScore = parseInt(localStorage.getItem('snakeHighScore') || '0');

        // Direction buffer — one pending direction per tick (Gotcha #1)
        this.pendingDirection = null;
        this.direction = 'right';
        this.snake = [];
        this.food = null;
        this.moveTimer = 0;

        this.loop = new GameLoop((dt) => {
            this.update(dt);
            this.render();
            this.input.endFrame();
        });
    }

    startGame() {
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
            this.state = 'gameover';
            this.food = null;
            return;
        }
        this.food = available[randomInt(0, available.length - 1)];
    }

    getMoveInterval() {
        // Gotcha #8: speed increases with score (difficulty scaling)
        const speedFactor = Math.min(this.score * 0.02, 0.7);
        return MOVE_INTERVAL_BASE * (1 - speedFactor);
    }

    update(dt) {
        if (this.state === 'menu') {
            if (this.input.justPressed('Space') || this.input.justPressed('Enter')) {
                this.startGame();
            }
            return;
        }
        if (this.state === 'gameover') {
            if (this.input.justPressed('Space') || this.input.justPressed('Enter')) {
                this.startGame();
            }
            return;
        }

        // Handle direction input via keyboard (with 180-degree turn prevention)
        let newDir = null;
        if (this.input.justPressed('ArrowUp') || this.input.justPressed('KeyW')) newDir = 'up';
        else if (this.input.justPressed('ArrowDown') || this.input.justPressed('KeyS')) newDir = 'down';
        else if (this.input.justPressed('ArrowLeft') || this.input.justPressed('KeyA')) newDir = 'left';
        else if (this.input.justPressed('ArrowRight') || this.input.justPressed('KeyD')) newDir = 'right';

        if (newDir) {
            const currentDir = this.pendingDirection || this.direction;
            if (newDir !== OPPOSITE[currentDir]) {
                this.pendingDirection = newDir;
            }
        }

        // Handle swipe input
        const swipe = this.input.getSwipe();
        if (swipe) {
            const currentDir = this.pendingDirection || this.direction;
            if (swipe !== OPPOSITE[currentDir]) {
                this.pendingDirection = swipe;
            }
        }

        // Apply deferred directions
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
        } else {
            this.snake.pop();
        }
    }

    saveHighScore() {
        if (this.score > parseInt(localStorage.getItem('snakeHighScore') || '0')) {
            localStorage.setItem('snakeHighScore', String(this.score));
        }
    }

    render() {
        const ctx = this.ctx;

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

    // === Public API ===

    start() {
        this.loop.start();
    }

    stop() {
        this.loop.stop();
        this.input.destroy();
    }
}

// Auto-start when loaded in the build pipeline
const game = new SnakeGame();
game.start();
