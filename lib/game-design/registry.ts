import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parseGameDesignDocument, type GameGenre, type GameDesignDocument } from './gdd';

/** Fixed allowlist; never interpolate a model-supplied path or version. */
const REGISTRY: ReadonlyArray<{
  genre: GameGenre; version: '1.0.0'; relative: string; skill: string;
}> = [
  { genre: 'snake', version: '1.0.0', relative: 'templates/snake/design.json', skill: 'snake-mechanics' },
  { genre: 'tetris', version: '1.0.0', relative: 'templates/tetris/design.json', skill: 'tetris-mechanics' },
  { genre: 'breakout', version: '1.0.0', relative: 'templates/breakout/design.json', skill: 'breakout-mechanics' },
  { genre: '2048', version: '1.0.0', relative: 'templates/2048/design.json', skill: '2048-mechanics' },
];

export interface TemplateDescriptor {
  genre: GameGenre;
  version: string;
  designPath: string;
  skillPath: string;
}

export function listGameTemplates(): TemplateDescriptor[] {
  return REGISTRY.map(e => ({
    genre: e.genre, version: e.version, designPath: e.relative,
    skillPath: 'skills/examples/' + e.skill + '.md',
  }));
}

export function loadGameTemplate(scaffoldRoot: string, genre: string): {
  design: GameDesignDocument; descriptor: TemplateDescriptor; digest: string;
} {
  const index = REGISTRY.findIndex(e => e.genre === genre);
  if (index === -1) throw new Error('Unknown game genre (must be registered): ' + genre.slice(0, 60));
  const item = REGISTRY[index], descriptor = listGameTemplates()[index];
  const file = path.join(scaffoldRoot, item.relative);
  const raw = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > 64_000) throw new Error('Template exceeds 64 KB');
  const design = parseGameDesignDocument(JSON.parse(raw));
  if (design.genre !== item.genre || design.templateVersion !== item.version) {
    throw new Error('Template metadata differs from registry: ' + item.genre);
  }
  // A missing skill or game implementation is a broken template, not success.
  for (const rel of [descriptor.skillPath, 'templates/' + item.genre + '/game.js']) {
    if (!fs.statSync(path.join(scaffoldRoot, rel)).isFile()) {
      throw new Error('Incomplete game template: ' + rel);
    }
  }
  return { design, descriptor, digest: crypto.createHash('sha256').update(raw).digest('hex') };
}
