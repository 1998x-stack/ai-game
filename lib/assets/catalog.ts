import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validateWorkspacePath } from '@/lib/security/validation';
import { decodePng, encodePng, packSpriteAtlas, type AtlasFrame } from './png';

export type AssetKind = 'image' | 'audio';
export type AssetLicense = 'unknown' | 'owned' | 'CC0' | 'CC-BY-4.0';
export interface AssetRecord {
  id: string;
  path: string;
  filename: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  license: AssetLicense;
  source?: string;
  createdAt: string;
  atlasFrames?: AtlasFrame[];
}
export interface AssetCatalog { schemaVersion: 1; entries: AssetRecord[] }
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL = 30 * 1024 * 1024;
const MAX_ASSETS = 128;
const ID = /^[0-9a-f]{64}$/;
const FORMATS: Record<string, { ext: string; kind: AssetKind }> = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'audio/wav': { ext: 'wav', kind: 'audio' },
  'audio/ogg': { ext: 'ogg', kind: 'audio' },
  'audio/mpeg': { ext: 'mp3', kind: 'audio' },
};
const sha = (content: Buffer) => crypto.createHash('sha256').update(content).digest('hex');
function validateId(id: string) {
  if (!ID.test(id)) throw new Error('Invalid asset digest');
}
function filename(root: string, relative: string, writing = false): string {
  const file = validateWorkspacePath(relative, root, writing);
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Asset symlink is not allowed');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return file;
}
function catalogFile(root: string) { return filename(root, 'assets.catalog.json', true); }
function validateCatalog(raw: unknown): AssetCatalog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid asset catalog');
  const item = raw as Record<string, unknown>;
  if (item.schemaVersion !== 1 || !Array.isArray(item.entries) || item.entries.length > MAX_ASSETS) {
    throw new Error('Invalid asset catalog schema');
  }
  const unique = new Set<string>();
  const entries = item.entries.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid asset entry');
    const record = candidate as AssetRecord;
    if (typeof record.id !== 'string') throw new Error('Invalid asset id');
    validateId(record.id);
    if (unique.has(record.id)) throw new Error('Duplicate asset digest');
    unique.add(record.id);
    const format = FORMATS[record.mime];
    if (!format || record.kind !== format.kind ||
        record.path !== 'assets/' + record.id + '.' + format.ext ||
        typeof record.bytes !== 'number' || !Number.isInteger(record.bytes) ||
        record.bytes < 1 || record.bytes > MAX_BYTES ||
        typeof record.filename !== 'string' || record.filename.length > 100 ||
        typeof record.license !== 'string' || !['unknown','owned','CC0','CC-BY-4.0'].includes(record.license)) {
      throw new Error('Malformed asset catalog entry');
    }
    return record;
  });
  if (entries.reduce((sum, item) => sum + item.bytes, 0) > MAX_TOTAL) {
    throw new Error('Asset catalog exceeds project quota');
  }
  return { schemaVersion: 1, entries };
}
function readCatalog(root: string): AssetCatalog {
  const file = catalogFile(root);
  if (!fs.existsSync(file)) return { schemaVersion: 1, entries: [] };
  if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > 80_000) {
    throw new Error('Asset catalog is invalid or too large');
  }
  return validateCatalog(JSON.parse(fs.readFileSync(file, 'utf8')));
}
export function listAssets(root: string): AssetCatalog {
  return readCatalog(root);
}
function atomicSave(root: string, catalog: AssetCatalog) {
  const target = catalogFile(root);
  const content = JSON.stringify(catalog, null, 2) + '\n';
  if (Buffer.byteLength(content) > 80_000) throw new Error('Catalog exceeds 80 KB');
  const temp = filename(root, 'assets.catalog.' + crypto.randomUUID() + '.tmp', true);
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}
function withCatalogLock<T>(root: string, operation: () => T): T {
  const lock = filename(root, 'assets.catalog.lock', true);
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Asset catalog busy; retry');
    throw err;
  }
  try { return operation(); } finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
function dimensions(mime: string, bytes: Buffer): { width: number; height: number } | undefined {
  if (mime === 'image/png') {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error('Invalid PNG header');
    }
    if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG is missing IHDR');
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid JPEG signature');
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 255) { offset++; continue; }
      const marker = bytes[offset + 1];
      if ([0xd8, 0x01].includes(marker) || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 7) throw new Error('Invalid JPEG frame');
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
    throw new Error('JPEG dimensions unavailable');
  }
  if (mime === 'image/webp') {
    if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
        bytes.toString('ascii', 8, 12) !== 'WEBP') throw new Error('Invalid WebP header');
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') {
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    }
    if (format === 'VP8 ' && bytes.length >= 30 && bytes.toString('hex', 23, 26) === '9d012a') {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (format === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      return { width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
        height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)) };
    }
    throw new Error('Unsupported WebP frame header');
  }
  return undefined;
}
export function inspectAsset(mime: string, bytes: Buffer): {
  kind: AssetKind; ext: string; width?: number; height?: number;
} {
  const format = FORMATS[mime];
  if (!format) throw new Error('Unsupported asset MIME type');
  if (bytes.length < 12 || bytes.length > MAX_BYTES) throw new Error('Asset must be 12 B–2 MiB');
  const dims = dimensions(mime, bytes);
  if (dims && (dims.width < 1 || dims.height < 1 || dims.width > 2048 ||
      dims.height > 2048 || dims.width * dims.height > 4_194_304)) {
    throw new Error('Image dimensions exceed 2048x2048');
  }
  if (mime === 'audio/wav' && (!bytes.subarray(0, 4).equals(Buffer.from('RIFF')) ||
      bytes.toString('ascii', 8, 12) !== 'WAVE')) throw new Error('Invalid WAV header');
  if (mime === 'audio/ogg' && bytes.toString('ascii', 0, 4) !== 'OggS') throw new Error('Invalid Ogg header');
  if (mime === 'audio/mpeg' && bytes.toString('ascii', 0, 3) !== 'ID3' &&
      !(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) throw new Error('Invalid MP3 header');
  return { ...format, ...dims };
}
export interface ImportOptions { filename: string; license: AssetLicense; source?: string }
function normalOptions(options: ImportOptions) {
  const filename = options.filename.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 100);
  if (!filename.trim()) throw new Error('Missing source filename');
  if (!['unknown','owned','CC0','CC-BY-4.0'].includes(options.license)) throw new Error('Unknown license label');
  const source = options.source?.trim();
  if (source) {
    if (source.length > 200) throw new Error('Source URL exceeds 200 chars');
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Provenance URL must be HTTPS');
  }
  return { filename, license: options.license, ...(source ? { source } : {}) };
}
function addBuffer(root: string, mime: string, bytes: Buffer, options: ImportOptions,
  atlasFrames?: AtlasFrame[]): { asset: AssetRecord; duplicate: boolean } {
  const info = inspectAsset(mime, bytes), normalized = normalOptions(options);
  const id = sha(bytes), relative = 'assets/' + id + '.' + info.ext;
  const destination = filename(root, relative, true);
  return withCatalogLock(root, () => {
    const catalog = readCatalog(root);
    const existing = catalog.entries.find(item => item.id === id);
    if (existing) {
      if (!fs.existsSync(destination) || sha(fs.readFileSync(destination)) !== id) {
        throw new Error('Existing asset digest does not match binary; repair required');
      }
      return { asset: existing, duplicate: true };
    }
    if (catalog.entries.length >= MAX_ASSETS ||
        catalog.entries.reduce((sum, entry) => sum + entry.bytes, bytes.length) > MAX_TOTAL) {
      throw new Error('Project asset quota exceeded');
    }
    if (fs.existsSync(destination)) throw new Error('Uncatalogued asset digest collision');
    const asset: AssetRecord = { id, path: relative, filename: normalized.filename,
      kind: info.kind, mime, bytes: bytes.length,
      ...(info.width === undefined ? {} : { width: info.width, height: info.height }),
      license: normalized.license, ...(normalized.source ? { source: normalized.source } : {}),
      createdAt: new Date().toISOString(), ...(atlasFrames ? { atlasFrames } : {}),
    };
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
    try {
      atomicSave(root, { schemaVersion: 1, entries: [...catalog.entries, asset] });
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }
    return { asset, duplicate: false };
  });
}
export function importAsset(root: string, mime: string, bytes: Buffer, options: ImportOptions) {
  return addBuffer(root, mime, bytes, options);
}
export function getAsset(root: string, id: string): { asset: AssetRecord; bytes: Buffer } {
  validateId(id);
  const asset = readCatalog(root).entries.find(entry => entry.id === id);
  if (!asset) throw new Error('Asset not found');
  const file = filename(root, asset.path);
  if (!fs.lstatSync(file).isFile() || fs.statSync(file).size > MAX_BYTES) {
    throw new Error('Asset file is not a regular bounded file');
  }
  const bytes = fs.readFileSync(file);
  if (sha(bytes) !== id) throw new Error('Asset integrity check failed');
  return { asset, bytes };
}
export function generateAtlas(root: string, ids: string[]) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 16 ||
      new Set(ids).size !== ids.length) throw new Error('Select 1–16 distinct sprite digests');
  const sprites = ids.map(id => {
    const { asset, bytes } = getAsset(root, id);
    if (asset.mime !== 'image/png') throw new Error('Sprite atlas accepts PNG sprites only');
    return { id, image: decodePng(bytes) };
  });
  const packed = packSpriteAtlas(sprites);
  return addBuffer(root, 'image/png', encodePng(packed.image),
    { filename: 'sprites-atlas.png', license: 'unknown' }, packed.frames);
}
