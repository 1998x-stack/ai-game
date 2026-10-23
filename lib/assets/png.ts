import { deflateSync, inflateSync } from 'zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c >>> 0;
}
function crc32(data: Buffer) {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const tag = Buffer.from(type, 'ascii');
  const output = Buffer.allocUnsafe(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  tag.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length);
  return output;
}
export interface Raster { width: number; height: number; pixels: Buffer }

export function decodePng(input: Buffer): Raster {
  if (input.length < 45 || !input.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('Invalid PNG signature');
  }
  let offset = 8;
  let width = 0, height = 0, channels = 0, seenHeader = false, seenEnd = false;
  let compressedBytes = 0;
  const data: Buffer[] = [];
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    if (length > 4_000_000 || offset + 12 + length > input.length) {
      throw new Error('Invalid PNG chunk size');
    }
    const type = input.toString('ascii', offset + 4, offset + 8);
    const piece = input.subarray(offset + 8, offset + 8 + length);
    const checksum = input.readUInt32BE(offset + 8 + length);
    if (crc32(input.subarray(offset + 4, offset + 8 + length)) !== checksum) {
      throw new Error('PNG checksum mismatch');
    }
    if (!seenHeader && type !== 'IHDR') throw new Error('PNG must begin with IHDR');
    if (type === 'IHDR') {
      if (seenHeader || length !== 13) throw new Error('Invalid PNG IHDR');
      width = piece.readUInt32BE(0);
      height = piece.readUInt32BE(4);
      if (width < 1 || height < 1 || width > 2048 || height > 2048 ||
          width * height > 4_194_304) throw new Error('PNG dimensions are out of bounds');
      const depth = piece[8], color = piece[9];
      if (depth !== 8 || ![2, 6].includes(color) ||
          piece[10] !== 0 || piece[11] !== 0 || piece[12] !== 0) {
        throw new Error('Sprite decoder accepts only non-interlaced 8-bit RGB/RGBA PNG');
      }
      channels = color === 6 ? 4 : 3;
      seenHeader = true;
    } else if (type === 'IDAT') {
      compressedBytes += length;
      if (compressedBytes > 4_000_000) throw new Error('PNG compressed input too large');
      data.push(piece);
    } else if (type === 'IEND') {
      seenEnd = true;
      if (length !== 0 || offset + 12 !== input.length) throw new Error('Invalid PNG footer');
      break;
    } else if (/^[A-Z]/.test(type[0])) {
      throw new Error('Unsupported critical PNG chunk ' + type);
    }
    offset += length + 12;
  }
  if (!seenHeader || !seenEnd || data.length === 0) throw new Error('Incomplete PNG');
  const rowBytes = width * channels;
  const expected = (rowBytes + 1) * height;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  if (raw.length !== expected) throw new Error('Unexpected PNG inflated size');
  const pixels = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(rowBytes);
  let start = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[start++];
    if (filter > 4) throw new Error('Unsupported PNG scanline filter');
    const row = Buffer.allocUnsafe(rowBytes);
    for (let x = 0; x < rowBytes; x++) {
      const encoded = raw[start++];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upLeft;
        const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upLeft;
      }
      row[x] = (encoded + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, j = x * channels;
      pixels[i] = row[j]; pixels[i + 1] = row[j + 1]; pixels[i + 2] = row[j + 2];
      pixels[i + 3] = channels === 4 ? row[j + 3] : 255;
    }
    prev = row;
  }
  return { width, height, pixels };
}
export function encodePng(image: Raster): Buffer {
  const { width, height, pixels } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > 2048 || height > 2048 ||
      width * height > 4_194_304 || pixels.length !== width * height * 4) {
    throw new Error('Invalid RGBA image dimensions');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export interface AtlasFrame { id: string; x: number; y: number; width: number; height: number }
export function packSpriteAtlas(sprites: Array<{ id: string; image: Raster }>): {
  image: Raster; frames: AtlasFrame[];
} {
  if (sprites.length < 1 || sprites.length > 16 || new Set(sprites.map(s => s.id)).size !== sprites.length) {
    throw new Error('Sprite atlas requires 1–16 distinct sprites');
  }
  const sorted = [...sprites].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const atlasWidth = 1024, maxHeight = 2048, gap = 1;
  let cursorX = gap, cursorY = gap, rowHeight = 0;
  const frames: AtlasFrame[] = [];
  for (const { id, image } of sorted) {
    if (image.width > 1022 || image.height > 1022) throw new Error('Sprite exceeds 1022 pixels');
    if (cursorX + image.width + gap > atlasWidth) {
      cursorX = gap; cursorY += rowHeight + gap; rowHeight = 0;
    }
    if (cursorY + image.height + gap > maxHeight) throw new Error('Atlas exceeds 2048px height');
    frames.push({ id, x: cursorX, y: cursorY, width: image.width, height: image.height });
    cursorX += image.width + gap;
    rowHeight = Math.max(rowHeight, image.height);
  }
  const height = Math.max(1, cursorY + rowHeight + gap);
  const pixels = Buffer.alloc(atlasWidth * height * 4);
  for (const frame of frames) {
    const source = sorted.find(s => s.id === frame.id)!.image;
    for (let row = 0; row < frame.height; row++) {
      source.pixels.copy(pixels,
        ((frame.y + row) * atlasWidth + frame.x) * 4,
        row * frame.width * 4, (row + 1) * frame.width * 4);
    }
  }
  return { image: { width: atlasWidth, height, pixels }, frames };
}
