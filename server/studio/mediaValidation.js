// Decode PNGs in skin slots, files PUT and staged FX forms; legacy slots retain their direct writes.
import fs from 'node:fs';
import { inflateSync } from 'node:zlib';
import { StudioError } from './files.js';

const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const IHDR = Buffer.from('IHDR'), PLTE = Buffer.from('PLTE'), IDAT = Buffer.from('IDAT'), IEND = Buffer.from('IEND');
// [ASSUMED] 256 MiB of decoded scanlines per upload, independent of compressed/file limits.
export const PNG_RAW_BYTES = 256 * 1024 * 1024;
const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function effectImages(files, id) {
  const images = new Set();
  try {
    const manifest = JSON.parse(fs.readFileSync(files.stat(id, 'plugin.json').abs, 'utf8'));
    const overlay = typeof manifest.assets === 'string'
      ? JSON.parse(fs.readFileSync(files.stat(id, manifest.assets).abs, 'utf8')) : manifest.assets;
    for (const b of Object.values(overlay?.fx?.flipbooks || {})) images.add(b?.image);
    if (typeof overlay?.fx?.index === 'string') {
      const index = JSON.parse(fs.readFileSync(files.stat(id, overlay.fx.index).abs, 'utf8'));
      for (const texture of Object.values(index.textures || {})) images.add(texture?.file);
    }
  } catch (e) { if (e.code === 'PLUGIN_STUDIO_PATH') throw e; /* folder checker reports broken documents */ }
  return images;
}

/** @param {Buffer} bytes @param {string} rel @param {{ fx?: boolean }} [opts] */
export function validatePng(bytes, rel, { fx = false } = {}) {
  const fail = detail => { throw new StudioError('PLUGIN_PART_SHAPE', 400, { where: rel, detail: `${rel}: ${detail}` }); };
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || !bytes.subarray(12, 16).equals(IHDR)) fail('image must be PNG');
  const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20), depth = bytes[24], color = bytes[25];
  if (!w || !h || w > 0x7fffffff || h > 0x7fffffff || !DEPTHS[color]?.includes(depth) || bytes[26] || bytes[27] || bytes[28] > 1) fail('invalid PNG header');
  if (fx && (w > 2048 || h > 2048 || depth !== 8 || ![2, 6].includes(color) || bytes[28])) fail('effect texture: 8-bit non-interlaced RGB/RGBA PNG, at most 2048 square');
  const passes = (bytes[28] ? [[0,0,8,8], [4,0,8,8], [0,4,4,8], [2,0,4,4], [0,2,2,4], [1,0,2,2], [0,1,1,2]] : [[0,0,1,1]])
    .map(([x,y,dx,dy]) => ({ width: Math.max(0, Math.ceil((w-x)/dx)), height: Math.max(0, Math.ceil((h-y)/dy)) }))
    .filter(p => p.width && p.height).map(p => ({ ...p, stride: Math.ceil(p.width * depth * CHANNELS[color] / 8) + 1 }));
  const size = passes.reduce((n, p) => n + p.stride * p.height, 0);
  if (!Number.isSafeInteger(size) || size > PNG_RAW_BYTES) fail('decoded PNG exceeds 256 MiB');
  let end = false, palette = false, dataEnded = false;
  const chunks = [];
  for (let off = 8; off < bytes.length;) { // loop-cap: advances off by at least 12 bytes
    if (off + 12 > bytes.length) fail('truncated PNG chunk');
    const n = bytes.readUInt32BE(off), type = bytes.subarray(off + 4, off + 8);
    if (n > 0x7fffffff || off + 12 + n > bytes.length) fail('truncated PNG chunk');
    // Buffer's ascii decoder masks the high bit. Check raw letters and the reserved uppercase byte first.
    if (!type.every(b => b >= 0x41 && b <= 0x5a || b >= 0x61 && b <= 0x7a) || type[2] > 0x5a) fail('invalid PNG chunk type');
    if (type.equals(IHDR) && (off !== 8 || n !== 13)) fail('invalid PNG header');
    if (type[0] <= 0x5a && ![IHDR, PLTE, IDAT, IEND].some(t => type.equals(t))) fail('unsupported PNG chunk');
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(off + 4, off + 8 + n)) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(off + 8 + n)) fail('PNG checksum mismatch');
    if (type.equals(PLTE)) {
      if (palette || chunks.length || !n || n % 3 || n > 768 || [0,4].includes(color) || (color === 3 && n / 3 > 2 ** depth)) fail('invalid PNG palette');
      palette = true;
    }
    if (type.equals(IDAT)) {
      if (dataEnded || (color === 3 && !palette)) fail('invalid PNG data order');
      chunks.push(bytes.subarray(off + 8, off + 8 + n));
    } else if (chunks.length) dataEnded = true;
    off += 12 + n;
    if (type.equals(IEND)) { end = true; if (n || off !== bytes.length) fail('invalid PNG end'); break; }
  }
  if (!end || !chunks.length) fail('incomplete PNG');
  let decoded;
  const compressed = Buffer.concat(chunks);
  try { decoded = inflateSync(compressed, { maxOutputLength: size, info: true }); } catch { fail('invalid PNG encoding'); }
  const raw = decoded.buffer;
  if (raw.length !== size || decoded.engine.bytesWritten !== compressed.length) fail('invalid PNG pixel data');
  let offset = 0;
  for (const p of passes) for (let y = 0; y < p.height; y++, offset += p.stride) if (raw[offset] > 4) fail('invalid PNG filter');
}
