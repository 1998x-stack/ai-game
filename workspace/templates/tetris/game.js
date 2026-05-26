// Tetris Game — Pure HTML5 Canvas
// All 7 tetrominoes, SRS rotation, wall kicks, line clearing, scoring, levels

const COLS = 10;
const ROWS = 20;
const TILE = 30;
const DESIGN_W = COLS * TILE + 160; // Extra 160 for side panel
const DESIGN_H = ROWS * TILE;
const PREVIEW_SIZE = 20;

// Tetromino definitions with SRS rotation states
const TETROMINOES = {
    I: {
        shapes: [
            [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
            [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
            [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
            [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]]
        ],
        color: '#45e8d4'
    },
    O: {
        shapes: [
            [[1,1],[1,1]],
            [[1,1],[1,1]],
            [[1,1],[1,1]],
            [[1,1],[1,1]]
        ],
        color: '#e8d445'
    },
    T: {
        shapes: [
            [[0,1,0],[1,1,1],[0,0,0]],
            [[0,1,0],[0,1,1],[0,1,0]],
            [[0,0,0],[1,1,1],[0,1,0]],
            [[0,1,0],[1,1,0],[0,1,0]]
        ],
        color: '#a045e8'
    },
    S: {
        shapes: [
            [[0,1,1],[1,1,0],[0,0,0]],
            [[0,1,0],[0,1,1],[0,0,1]],
            [[0,0,0],[0,1,1],[1,1,0]],
            [[1,0,0],[1,1,0],[0,1,0]]
        ],
        color: '#45e86d'
    },
    Z: {
        shapes: [
            [[1,1,0],[0,1,1],[0,0,0]],
            [[0,0,1],[0,1,1],[0,1,0]],
            [[0,0,0],[1,1,0],[0,1,1]],
            [[0,1,0],[1,1,0],[1,0,0]]
        ],
        color: '#e84545'
    },
    J: {
        shapes: [
            [[1,0,0],[1,1,1],[0,0,0]],
            [[0,1,1],[0,1,0],[0,1,0]],
            [[0,0,0],[1,1,1],[0,0,1]],
            [[0,1,0],[0,1,0],[1,1,0]]
        ],
        color: '#4580e8'
    },
    L: {
        shapes: [
            [[0,0,1],[1,1,1],[0,0,0]],
            [[0,1,0],[0,1,0],[0,1,1]],
            [[0,0,0],[1,1,1],[1,0,0]],
            [[1,1,0],[0,1,0],[0,1,0]]
        ],
        color: '#e8a045'
    }
};

// SRS wall kick data (J, L, S, T, Z)
const WALL_KICKS_JLSTZ = [
    [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],  // 0->R
    [[0,0],[1,0],[1,-1],[0,2],[1,2]],      // R->2
    [[0,0],[1,0],[1,1],[0,-2],[1,-2]],     // 2->L
    [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]]    // L->0
];

// I-piece has different wall kicks
const WALL_KICKS_I = [
    [[0,0],[-2,0],[1,0],[-2,-1],[1,2]],    // 0->R
    [[0,0],[-1,0],[2,0],[-1,2],[2,-1]],    // R->2
    [[0,0],[2,0],[-1,0],[2,1],[-1,-2]],    // 2->L
    [[0,0],[1,0],[-2,0],[1,-2],[-2,1]]     // L->0
];

// Points per lines cleared
const LINE_POINTS = [0, 100, 300, 500, 800];

// Time in seconds before each drop at level 1
const LEVEL_SPEEDS = [0.8, 0.72, 0.63, 0.55, 0.47, 0.38, 0.30, 0.22, 0.15, 0.10];

// Piece names for random bag generation
const PIECE_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

export default class TetrisGame {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        canvas.width = DESIGN_W;
        canvas.height = DESIGN_H;

        this.state = 'menu'; // menu | playing | paused | gameover
        this.score = 0;
        this.level = 1;
        this.lines = 0;
        this.highScore = parseInt(localStorage.getItem('tetrisHighScore') || '0');

        this.board = [];
        this.bag = [];
        this.currentPiece = null;
        this.nextPiece = null;
        this.dropTimer = 0;
        this.lockTimer = 0;
        this.lockMoves = 0;
        this.lockMaxMoves = 15;
        this.isLocking = false;
        this.combo = -1;

        this.keys = {};
        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            if ((e.code === 'Space' || e.code === 'Enter') && this.state === 'menu') {
                this.startGame();
            } else if (e.code === 'KeyP') {
                if (this.state === 'playing') this.state = 'paused';
                else if (this.state === 'paused') this.state = 'playing';
            }
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
                e.preventDefault();
            }
        };
        this._onKeyUp = (e) => { this.keys[e.code] = false; };

        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);

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
        this.level = 1;
        this.lines = 0;
        this.combo = -1;
        this.board = [];
        for (let r = 0; r < ROWS; r++) {
            this.board[r] = new Array(COLS).fill(0);
        }
        this.bag = [];
        this.dropTimer = 0;
        this.state = 'playing';
        this.nextPiece = this._spawnPiece();
        this._advancePiece();
    }

    // 7-bag randomizer
    _fillBag() {
        const bag = [...PIECE_NAMES];
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        this.bag = bag;
    }

    _spawnPiece() {
        if (this.bag.length === 0) this._fillBag();
        const name = this.bag.pop();
        const data = TETROMINOES[name];
        return {
            name: name,
            shape: data.shapes[0],
            shapes: data.shapes,
            color: data.color,
            rotation: 0,
            x: Math.floor((COLS - data.shapes[0][0].length) / 2),
            y: 0
        };
    }

    _advancePiece() {
        this.currentPiece = this.nextPiece;
        this.nextPiece = this._spawnPiece();
        this.dropTimer = 0;
        this.isLocking = false;
        this.lockTimer = 0;
        this.lockMoves = 0;

        // Check if new piece immediately collides
        if (this._collides(this.currentPiece.shape, this.currentPiece.x, this.currentPiece.y)) {
            this.state = 'gameover';
            this.saveHighScore();
        }
    }

    _getShape(piece, rotation) {
        return piece.shapes[rotation % piece.shapes.length];
    }

    _collides(shape, offX, offY) {
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    const bx = offX + c;
                    const by = offY + r;
                    if (bx < 0 || bx >= COLS || by >= ROWS) return true;
                    if (by >= 0 && this.board[by][bx] !== 0) return true;
                }
            }
        }
        return false;
    }

    _rotate(direction) {
        if (!this.currentPiece) return;
        const piece = this.currentPiece;
        const oldRot = piece.rotation;
        const newRot = (oldRot + direction + 4) % 4;
        const newShape = this._getShape(piece, newRot);

        // SRS wall kicks
        const kicks = piece.name === 'I' ? WALL_KICKS_I : WALL_KICKS_JLSTZ;
        const kickIndex = oldRot; // 0->1, 1->2, 2->3, 3->0

        for (const [kx, ky] of kicks[kickIndex]) {
            const testX = piece.x + kx;
            const testY = piece.y - ky; // SRS y is inverted
            if (!this._collides(newShape, testX, testY)) {
                piece.rotation = newRot;
                piece.shape = newShape;
                piece.x = testX;
                piece.y = testY;
                this._onMove();
                return true;
            }
        }
        return false;
    }

    _moveDx(dx) {
        if (!this.currentPiece) return false;
        if (!this._collides(this.currentPiece.shape, this.currentPiece.x + dx, this.currentPiece.y)) {
            this.currentPiece.x += dx;
            this._onMove();
            return true;
        }
        return false;
    }

    _hardDrop() {
        if (!this.currentPiece) return;
        let dropDist = 0;
        while (!this._collides(this.currentPiece.shape, this.currentPiece.x, this.currentPiece.y + 1)) {
            this.currentPiece.y++;
            dropDist++;
        }
        this.score += dropDist * 2;
        this._lockPiece();
    }

    _softDrop() {
        if (!this.currentPiece) return;
        if (!this._collides(this.currentPiece.shape, this.currentPiece.x, this.currentPiece.y + 1)) {
            this.currentPiece.y++;
            this.score += 1;
            this.dropTimer = 0;
            return true;
        }
        return false;
    }

    _onMove() {
        // Reset lock timer on successful move (up to max moves)
        if (this.isLocking && this.lockMoves < this.lockMaxMoves) {
            this.lockTimer = 0;
            this.lockMoves++;
        }
    }

    _lockPiece() {
        const piece = this.currentPiece;
        const shape = piece.shape;
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    const bx = piece.x + c;
                    const by = piece.y + r;
                    if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) {
                        this.board[by][bx] = piece.color;
                    }
                }
            }
        }

        this._clearLines();
        this._advancePiece();
        this.isLocking = false;
    }

    _clearLines() {
        let cleared = 0;
        for (let r = ROWS - 1; r >= 0; r--) {
            if (this.board[r].every(cell => cell !== 0)) {
                this.board.splice(r, 1);
                this.board.unshift(new Array(COLS).fill(0));
                cleared++;
                r++; // Re-check this row
            }
        }

        if (cleared > 0) {
            this.combo++;
            const comboBonus = Math.max(0, this.combo) * 50;
            this.score += LINE_POINTS[cleared] * this.level + comboBonus;
            this.lines += cleared;
            this.level = Math.min(Math.floor(this.lines / 10) + 1, 10);
        } else {
            this.combo = -1;
        }
    }

    getDropSpeed() {
        const idx = Math.min(this.level - 1, LEVEL_SPEEDS.length - 1);
        return LEVEL_SPEEDS[idx];
    }

    update(dt) {
        if (this.state !== 'playing') return;

        // Handle DAS (delayed auto shift) for left/right
        if (this.keys['ArrowLeft']) this._moveDx(-1);
        if (this.keys['ArrowRight']) this._moveDx(1);
        if (this.keys['ArrowUp']) { this.keys['ArrowUp'] = false; this._rotate(1); }
        if (this.keys['ArrowDown']) { this._softDrop(); }
        if (this.keys['Space']) { this.keys['Space'] = false; this._hardDrop(); }

        if (!this.currentPiece) return;

        // Gravity
        this.dropTimer += dt;
        if (this.dropTimer >= this.getDropSpeed()) {
            this.dropTimer = 0;
            if (!this._softDrop()) {
                // Piece can't move down — start/extend lock delay
                if (!this.isLocking) {
                    this.isLocking = true;
                    this.lockTimer = 0;
                }
            }
        }

        // Lock delay
        if (this.isLocking) {
            this.lockTimer += dt;
            if (this.lockTimer >= 0.5) {
                this._lockPiece();
            }
            // If piece can move down again (e.g., line cleared below), cancel lock
            if (!this._collides(this.currentPiece.shape, this.currentPiece.x, this.currentPiece.y + 1)) {
                this.isLocking = false;
            }
        }
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

        // Background
        ctx.fillStyle = '#0f0f23';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

        // Board background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, COLS * TILE, ROWS * TILE);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= COLS; x++) {
            ctx.beginPath();
            ctx.moveTo(x * TILE, 0);
            ctx.lineTo(x * TILE, ROWS * TILE);
            ctx.stroke();
        }
        for (let y = 0; y <= ROWS; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * TILE);
            ctx.lineTo(COLS * TILE, y * TILE);
            ctx.stroke();
        }

        // Locked tiles
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (this.board[r][c] !== 0) {
                    ctx.fillStyle = this.board[r][c];
                    ctx.fillRect(c * TILE + 1, r * TILE + 1, TILE - 2, TILE - 2);
                    // Highlight
                    ctx.fillStyle = 'rgba(255,255,255,0.1)';
                    ctx.fillRect(c * TILE + 1, r * TILE + 1, TILE - 2, 4);
                }
            }
        }

        // Ghost piece (shadow showing where piece will land)
        if (this.currentPiece) {
            this._drawGhost(ctx);
        }

        // Current piece
        if (this.currentPiece) {
            this._drawPiece(ctx, this.currentPiece, 0, 0);
        }

        // Side panel
        const panelX = COLS * TILE + 20;
        ctx.fillStyle = '#fff';
        ctx.font = '14px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('NEXT', panelX, 30);
        ctx.fillText(`LEVEL ${this.level}`, panelX, ROWS * TILE - 160);
        ctx.fillText(`LINES ${this.lines}`, panelX, ROWS * TILE - 130);
        ctx.fillText(`SCORE`, panelX, ROWS * TILE - 90);
        ctx.fillText(`${this.score}`, panelX, ROWS * TILE - 70);
        ctx.fillText(`HI ${this.highScore}`, panelX, ROWS * TILE - 40);

        // Next piece preview
        if (this.nextPiece) {
            const previewShape = this._getShape(this.nextPiece, 0);
            const pSize = PREVIEW_SIZE;
            const offsetX = panelX + 10;
            const offsetY = 50;
            for (let r = 0; r < previewShape.length; r++) {
                for (let c = 0; c < previewShape[r].length; c++) {
                    if (previewShape[r][c]) {
                        ctx.fillStyle = this.nextPiece.color;
                        ctx.fillRect(offsetX + c * pSize, offsetY + r * pSize, pSize - 2, pSize - 2);
                    }
                }
            }
        }

        // Overlays
        if (this.state === 'menu') {
            this._drawOverlay('TETRIS', 'Press SPACE to start');
        } else if (this.state === 'paused') {
            this._drawOverlay('PAUSED', 'Press P to resume');
        } else if (this.state === 'gameover') {
            this._drawOverlay('GAME OVER', `Score: ${this.score}  Press SPACE to restart`);
        }
    }

    _drawPiece(ctx, piece, offsetX, offsetY) {
        const shape = piece.shape;
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    const x = (piece.x + c) * TILE + offsetX;
                    const y = (piece.y + r) * TILE + offsetY;
                    ctx.fillStyle = piece.color;
                    ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.15)';
                    ctx.fillRect(x + 1, y + 1, TILE - 2, 4);
                }
            }
        }
    }

    _drawGhost(ctx) {
        const piece = this.currentPiece;
        let ghostY = piece.y;
        while (!this._collides(piece.shape, piece.x, ghostY + 1)) {
            ghostY++;
        }

        const shape = piece.shape;
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    const x = (piece.x + c) * TILE;
                    const y = (ghostY + r) * TILE;
                    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
                }
            }
        }
    }

    _drawOverlay(title, subtitle) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#45e8d4';
        ctx.font = 'bold 36px monospace';
        ctx.fillText(title, COLS * TILE / 2, DESIGN_H / 2 - 30);
        ctx.fillStyle = '#aaa';
        ctx.font = '14px monospace';
        ctx.fillText(subtitle, COLS * TILE / 2, DESIGN_H / 2 + 15);
    }

    saveHighScore() {
        if (this.score > parseInt(localStorage.getItem('tetrisHighScore') || '0')) {
            localStorage.setItem('tetrisHighScore', String(this.score));
        }
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
    }
}
