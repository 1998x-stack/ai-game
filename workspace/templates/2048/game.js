// 2048 Game — Pure HTML5 Canvas
// 4x4 grid, swipe/touch + keyboard, tile merging animation, score, undo

const GRID_SIZE = 4;
const TILE_SIZE = 80;
const GAP = 8;
const PADDING = 10;
const DESIGN_W = GRID_SIZE * (TILE_SIZE + GAP) + GAP + PADDING * 2;
const DESIGN_H = DESIGN_W + 60; // Extra space for header

// Tile color map by value
const TILE_COLORS = {
    2:    { bg: '#eee4da', text: '#776e65' },
    4:    { bg: '#ede0c8', text: '#776e65' },
    8:    { bg: '#f2b179', text: '#f9f6f2' },
    16:   { bg: '#f59563', text: '#f9f6f2' },
    32:   { bg: '#f67c5f', text: '#f9f6f2' },
    64:   { bg: '#f65e3b', text: '#f9f6f2' },
    128:  { bg: '#edcf72', text: '#f9f6f2' },
    256:  { bg: '#edcc61', text: '#f9f6f2' },
    512:  { bg: '#edc850', text: '#f9f6f2' },
    1024: { bg: '#edc53f', text: '#f9f6f2' },
    2048: { bg: '#edc22e', text: '#f9f6f2' }
};

export default class Game2048 {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        canvas.width = DESIGN_W;
        canvas.height = DESIGN_H;

        this.state = 'playing'; // playing | won | gameover
        this.score = 0;
        this.bestScore = parseInt(localStorage.getItem('2048HighScore') || '0');
        this.hasWon = false;

        this.grid = [];
        this.previousGrid = null;
        this.previousScore = 0;
        this.undoAvailable = false;

        // Track tiles for merge animation
        this.mergeAnimations = [];
        this.moveAnimations = [];
        this.newTileAnim = null;

        this.keys = {};
        this._onKeyDown = (e) => {
            this.keys[e.code] = true;
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
                e.preventDefault();
                const dirMap = {
                    'ArrowUp': 'up', 'ArrowDown': 'down',
                    'ArrowLeft': 'left', 'ArrowRight': 'right'
                };
                this.move(dirMap[e.code]);
            }
            if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.undo();
            }
            if (e.code === 'KeyR') {
                this.reset();
            }
        };
        this._onKeyUp = (e) => { this.keys[e.code] = false; };

        document.addEventListener('keydown', this._onKeyDown);
        document.addEventListener('keyup', this._onKeyUp);

        // Touch/swipe support
        this._touchStartX = 0;
        this._touchStartY = 0;

        canvas.addEventListener('touchstart', (e) => {
            this._touchStartX = e.touches[0].clientX;
            this._touchStartY = e.touches[0].clientY;
        }, { passive: true });

        canvas.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - this._touchStartX;
            const dy = e.changedTouches[0].clientY - this._touchStartY;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            if (Math.max(absDx, absDy) < 30) return;
            if (absDx > absDy) {
                this.move(dx > 0 ? 'right' : 'left');
            } else {
                this.move(dy > 0 ? 'down' : 'up');
            }
        }, { passive: true });

        this._resize();
        window.addEventListener('resize', () => this._resize());

        this.reset();
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

    reset() {
        this.score = 0;
        this.hasWon = false;
        this.state = 'playing';
        this.undoAvailable = false;
        this.grid = [];
        for (let r = 0; r < GRID_SIZE; r++) {
            this.grid[r] = [];
            for (let c = 0; c < GRID_SIZE; c++) {
                this.grid[r][c] = 0;
            }
        }
        this.addRandomTile();
        this.addRandomTile();
    }

    getEmptyCells() {
        const empty = [];
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                if (this.grid[r][c] === 0) {
                    empty.push({ r, c });
                }
            }
        }
        return empty;
    }

    addRandomTile() {
        const empty = this.getEmptyCells();
        if (empty.length === 0) return;
        const cell = empty[Math.floor(Math.random() * empty.length)];
        this.grid[cell.r][cell.c] = Math.random() < 0.9 ? 2 : 4;
    }

    // Serialize grid for undo
    saveState() {
        this.previousGrid = this.grid.map(row => [...row]);
        this.previousScore = this.score;
        this.undoAvailable = true;
    }

    undo() {
        if (!this.undoAvailable || !this.previousGrid) return;
        this.grid = this.previousGrid.map(row => [...row]);
        this.score = this.previousScore;
        this.undoAvailable = false;
        if (this.state === 'gameover') {
            // Re-check game over after undo
            if (!this.isGameOver()) {
                this.state = 'playing';
            }
        }
    }

    move(direction) {
        if (this.state === 'gameover' || this.state === 'won') return;

        this.saveState();

        let moved = false;
        const merged = {};

        const iterate = (callback) => {
            for (let i = 0; i < GRID_SIZE; i++) {
                for (let j = 0; j < GRID_SIZE; j++) {
                    let r, c;
                    switch (direction) {
                        case 'up':    r = j; c = i; break;
                        case 'down':  r = GRID_SIZE - 1 - j; c = i; break;
                        case 'left':  r = i; c = j; break;
                        case 'right': r = i; c = GRID_SIZE - 1 - j; break;
                    }
                    callback(r, c);
                }
            }
        };

        const findTarget = (r, c) => {
            const dr = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
            const dc = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;

            let tr = r, tc = c;
            let lastMergePos = null;

            while (true) {
                const nr = tr + dr;
                const nc = tc + dc;
                if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) break;

                const cell = this.grid[nr][nc];
                if (cell === 0) {
                    tr = nr;
                    tc = nc;
                } else if (cell === this.grid[r][c] && !merged[`${nr},${nc}`]) {
                    // Can merge
                    tr = nr;
                    tc = nc;
                    lastMergePos = { r: nr, c: nc };
                    break;
                } else {
                    break;
                }
            }

            return { row: tr, col: tc, merge: lastMergePos };
        };

        iterate((r, c) => {
            if (this.grid[r][c] === 0) return;

            const target = findTarget(r, c);

            if (target.row !== r || target.col !== c) {
                moved = true;
            }

            if (target.merge) {
                // Merge
                const mergedValue = this.grid[r][c] * 2;
                this.grid[target.merge.r][target.merge.c] = mergedValue;
                merged[`${target.merge.r},${target.merge.c}`] = true;
                if (r !== target.merge.r || c !== target.merge.c) {
                    this.grid[r][c] = 0;
                }
                this.score += mergedValue;

                if (mergedValue === 2048 && !this.hasWon) {
                    this.hasWon = true;
                    this.state = 'won';
                }
            } else {
                this.grid[target.row][target.col] = this.grid[r][c];
                if (target.row !== r || target.col !== c) {
                    this.grid[r][c] = 0;
                }
            }
        });

        if (moved) {
            this.addRandomTile();
            if (this.score > this.bestScore) {
                this.bestScore = this.score;
                localStorage.setItem('2048HighScore', String(this.score));
            }
            if (this.isGameOver()) {
                this.state = 'gameover';
            }
        } else {
            // No move happened — restore state (undo not available)
            this.undoAvailable = false;
            this.previousGrid = null;
        }
    }

    isGameOver() {
        // Check for empty cells
        if (this.getEmptyCells().length > 0) return false;

        // Check for possible merges
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                const val = this.grid[r][c];
                if (c < GRID_SIZE - 1 && this.grid[r][c + 1] === val) return false;
                if (r < GRID_SIZE - 1 && this.grid[r + 1][c] === val) return false;
            }
        }
        return true;
    }

    getTileColor(value) {
        const colors = TILE_COLORS[value] || { bg: '#3c3a32', text: '#f9f6f2' };
        return colors;
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

        // Background
        ctx.fillStyle = '#faf8ef';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

        // Header
        ctx.fillStyle = '#776e65';
        ctx.font = 'bold 32px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('2048', PADDING, 38);

        ctx.font = '14px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`SCORE: ${this.score}`, DESIGN_W - PADDING, 22);
        ctx.fillText(`BEST: ${this.bestScore}`, DESIGN_W - PADDING, 42);

        // Grid background
        const gridX = PADDING;
        const gridY = 60;
        const gridW = GRID_SIZE * (TILE_SIZE + GAP) + GAP;

        ctx.fillStyle = '#bbada0';
        ctx.fillRect(gridX, gridY, gridW, gridW);

        // Tiles
        for (let r = 0; r < GRID_SIZE; r++) {
            for (let c = 0; c < GRID_SIZE; c++) {
                const value = this.grid[r][c];
                const x = gridX + GAP + c * (TILE_SIZE + GAP);
                const y = gridY + GAP + r * (TILE_SIZE + GAP);

                if (value === 0) {
                    // Empty cell
                    ctx.fillStyle = 'rgba(238, 228, 218, 0.35)';
                    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
                } else {
                    const colors = this.getTileColor(value);
                    ctx.fillStyle = colors.bg;
                    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

                    ctx.fillStyle = colors.text;
                    const fontSize = value >= 1000 ? 20 : value >= 100 ? 28 : 36;
                    ctx.font = `bold ${fontSize}px monospace`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(value), x + TILE_SIZE / 2, y + TILE_SIZE / 2);
                }
            }
        }

        // Undo hint
        ctx.fillStyle = '#bbb';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('Ctrl+Z to undo  |  R to reset', PADDING, DESIGN_H - 10);

        // Overlays
        if (this.state === 'won') {
            this._drawOverlay('YOU WIN!', 'Keep playing? Keep swiping!');
        } else if (this.state === 'gameover') {
            this._drawOverlay('GAME OVER', `Score: ${this.score}  Press R to restart`);
        }
    }

    _drawOverlay(title, subtitle) {
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(250, 248, 239, 0.7)';
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.fillStyle = '#776e65';
        ctx.font = 'bold 36px monospace';
        ctx.fillText(title, DESIGN_W / 2, DESIGN_H / 2 - 40);

        ctx.fillStyle = '#776e65';
        ctx.font = '14px monospace';
        ctx.fillText(subtitle, DESIGN_W / 2, DESIGN_H / 2 + 10);
    }

    start() {
        this.lastTime = performance.now();
        const loop = (timestamp) => {
            const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
            this.lastTime = timestamp;
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
