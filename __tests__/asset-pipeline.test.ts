import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { decodePng, encodePng, packSpriteAtlas } from '@/lib/assets/png';
import { generateAtlas, getAsset, importAsset, listAssets } from '@/lib/assets/catalog';

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-game-asset-test-'));
  roots.push(dir);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  return dir;
}
function image(color: number) {
  return encodePng({ width: 3, height: 2, pixels: Buffer.from([
    color, 20, 30, 255, color, 20, 30, 200, color, 20, 30, 150,
    color, 20, 30, 255, color, 20, 30, 200, color, 20, 30, 150,
  ]) });
}
function record(dir: string, bytes: Buffer, name: string) {
  return importAsset(dir, 'image/png', bytes, { filename: name, license: 'CC0',
    source: 'https://example.org/assets' });
}
describe('Stage 3.1 deterministic asset pipeline', () => {
  it('decodes and re-encodes 8-bit RGBA PNG byte-for-byte pixels', () => {
    const bytes = image(120);
    const decoded = decodePng(bytes);
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect(decoded.pixels[3]).toBe(255);
    expect(decoded.pixels[7]).toBe(200);
    expect(decodePng(encodePng(decoded)).pixels).toEqual(decoded.pixels);
  });
  it('rejects invalid PNG CRC and decompression input', () => {
    const file = image(20);
    const tampered = Buffer.from(file);
    tampered[16] ^= 8;
    expect(() => decodePng(tampered)).toThrow();
    expect(() => decodePng(Buffer.alloc(64))).toThrow('Invalid PNG');
  });
  it('packs sprite atlas reproducibly with no overlapping pixels', () => {
    const one = decodePng(image(50));
    const two = decodePng(image(100));
    const a = packSpriteAtlas([{ id: 'z', image: one }, { id: 'a', image: two }]);
    const b = packSpriteAtlas([{ id: 'a', image: two }, { id: 'z', image: one }]);
    expect(a.frames).toEqual(b.frames);
    expect(encodePng(a.image).equals(encodePng(b.image))).toBe(true);
    const atlas = decodePng(encodePng(a.image));
    for (const frame of a.frames) {
      const offset = (frame.y * atlas.width + frame.x) * 4;
      expect(atlas.pixels[offset]).toBe(frame.id === 'a' ? 100 : 50);
    }
    expect(a.frames[0].x + a.frames[0].width).toBeLessThan(a.frames[1].x);
  });
  it('imports, deduplicates by entire SHA-256 and retains provenance metadata', () => {
    const dir = root();
    const data = image(80);
    const first = record(dir, data, 'original.png');
    const duplicate = record(dir, data, 'renamed.png');
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(first.asset.id).toBe(crypto.createHash('sha256').update(data).digest('hex'));
    expect(first.asset.license).toBe('CC0');
    expect(first.asset.width).toBe(3);
    expect(listAssets(dir).entries).toHaveLength(1);
    expect(getAsset(dir, first.asset.id).bytes.equals(data)).toBe(true);
  });
  it('generates a stored PNG atlas containing source digest frame records', () => {
    const dir = root();
    const first = record(dir, image(60), 'red.png').asset;
    const second = record(dir, image(90), 'blue.png').asset;
    const atlas = generateAtlas(dir, [second.id, first.id]);
    expect(atlas.asset.atlasFrames).toHaveLength(2);
    expect(atlas.asset.path).toMatch(/^assets\/[a-f0-9]{64}\.png$/);
    expect(decodePng(getAsset(dir, atlas.asset.id).bytes).width).toBe(1024);
    expect(generateAtlas(dir, [first.id, second.id]).duplicate).toBe(true);
    expect(listAssets(dir).entries).toHaveLength(3);
  });
  it('fails closed for non-PNG sprites, duplicate frames and unsafe imports', () => {
    const dir = root();
    const one = record(dir, image(60), 'safe.png').asset;
    expect(() => generateAtlas(dir, [one.id, one.id])).toThrow('distinct');
    expect(() => importAsset(dir, 'image/svg+xml', Buffer.alloc(32), {
      filename: 'active.svg', license: 'owned',
    })).toThrow('Unsupported');
    expect(() => record(dir, image(120), 'file.png')).not.toThrow();
    expect(() => importAsset(dir, 'image/png', image(90), {
      filename: '../escape.png', license: 'owned', source: 'file:///tmp/out',
    })).toThrow('HTTPS');
  });
  it('rejects oversized assets and tampered files', () => {
    const dir = root();
    expect(() => importAsset(dir, 'image/png', Buffer.alloc(2 * 1024 * 1024 + 1), {
      filename: 'large.png', license: 'unknown',
    })).toThrow();
    const item = record(dir, image(42), 'normal.png').asset;
    fs.writeFileSync(path.join(dir, item.path), image(43));
    expect(() => getAsset(dir, item.id)).toThrow('integrity');
  });
  it('rejects symbolically-linked assets and malformed catalog', () => {
    const dir = root();
    const item = record(dir, image(40), 'normal.png').asset;
    const target = path.join(dir, item.path);
    fs.unlinkSync(target);
    fs.symlinkSync('/etc/hosts', target);
    expect(() => getAsset(dir, item.id)).toThrow();
    fs.unlinkSync(target);
    fs.writeFileSync(path.join(dir, 'assets.catalog.json'), JSON.stringify({
      schemaVersion: 1, entries: [{ id: item.id, path: '../escape' }],
    }));
    expect(() => listAssets(dir)).toThrow('Malformed');
  });
  it('imports bounded WAV/audio data without execution or transcoding', () => {
    const dir = root();
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0); wav.write('WAVE', 8);
    const item = importAsset(dir, 'audio/wav', wav, {
      filename: 'tone.wav', license: 'owned',
    });
    expect(item.asset.kind).toBe('audio');
    expect(item.asset.mime).toBe('audio/wav');
    expect(item.asset.path).toMatch(/\.wav$/);
  });
});
