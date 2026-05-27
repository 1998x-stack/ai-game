export interface GameAnalysis {
  type: 'snake' | 'breakout' | 'tetris' | '2048' | 'platformer' | 'shooter' | 'puzzle-matching' | 'unknown';
  tier: 'template' | 'detection' | 'fallback';
  stateVars: string[];
  inputMethods: ('keyboard' | 'mouse' | 'touch')[];
  hasAnimLoop: boolean;
  confidence: number;
}

const TEMPLATES: Array<{ type: GameAnalysis['type']; signals: string[]; minHits: number }> = [
  { type: 'snake', signals: ['snake', 'direction', 'food', 'grow', 'tail', 'head'], minHits: 3 },
  { type: 'breakout', signals: ['paddle', 'ball', 'bricks', 'brick', 'lives', 'bounce'], minHits: 3 },
  { type: 'tetris', signals: ['tetromino', 'grid', 'clearrows', 'rotate', 'drop'], minHits: 3 },
  { type: '2048', signals: ['merge', 'board', 'tile', '2048', 'slide'], minHits: 3 },
];

const DETECTIONS: Array<{ type: GameAnalysis['type']; signals: string[]; minHits: number }> = [
  { type: 'platformer', signals: ['gravity', 'jump', 'platform', 'velocityY', 'ground'], minHits: 2 },
  { type: 'shooter', signals: ['bullet', 'enemy', 'shoot', 'projectile', 'spawn'], minHits: 2 },
  { type: 'puzzle-matching', signals: ['grid', 'tile', 'match', 'swap', 'combo'], minHits: 2 },
];

export function detectGameType(code: string): { type: GameAnalysis['type']; tier: GameAnalysis['tier']; confidence: number } {
  const lower = code.toLowerCase();
  for (const p of TEMPLATES) {
    const hits = p.signals.filter(s => lower.includes(s)).length;
    if (hits >= p.minHits) return { type: p.type, tier: 'template', confidence: hits / p.signals.length };
  }
  for (const p of DETECTIONS) {
    const hits = p.signals.filter(s => lower.includes(s)).length;
    if (hits >= p.minHits) return { type: p.type, tier: 'detection', confidence: hits / p.signals.length };
  }
  return { type: 'unknown', tier: 'fallback', confidence: 0 };
}

export function extractStateVars(code: string): string[] {
  const vars = new Set<string>();
  const regex = /(?:var|let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=;]/g;
  let m; while ((m = regex.exec(code)) !== null) vars.add(m[1]);
  return [...vars].slice(0, 30);
}

export function detectInputMethods(code: string): ('keyboard' | 'mouse' | 'touch')[] {
  const methods: ('keyboard' | 'mouse' | 'touch')[] = [];
  if (/addEventListener\s*\(\s*['"]key(down|up)['"]/.test(code)) methods.push('keyboard');
  if (/addEventListener\s*\(\s*['"](click|mouse(move|down|up))['"]/.test(code)) methods.push('mouse');
  if (/addEventListener\s*\(\s*['"]touch(start|move|end)['"]/.test(code)) methods.push('touch');
  return methods.length > 0 ? methods : ['keyboard'];
}

export function detectAnimLoop(code: string): boolean {
  return /requestAnimationFrame\s*\(/.test(code);
}

export function analyzeGame(code: string): GameAnalysis {
  const typeResult = detectGameType(code);
  return {
    type: typeResult.type,
    tier: typeResult.tier,
    stateVars: extractStateVars(code),
    inputMethods: detectInputMethods(code),
    hasAnimLoop: detectAnimLoop(code),
    confidence: typeResult.confidence,
  };
}
