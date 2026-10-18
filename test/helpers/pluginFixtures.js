// test/helpers/pluginFixtures.js — art for the plugin tests, made on the spot (no file of the official game is ever put
// in a fixture, docs/PLUGINS.md): a valid PNG of one colour (png), a minimal Spine 3.8 binary skeleton that the client's
// own parser reads (skel: a root bone, events, animations whose length is the time of their last event — e.g. an
// `OnAttack` hit), its atlas (atlas), and a plugin folder writer (writePlugin).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/**
 * A PNG of `w` × `h` pixels of one colour.
 * @param {number} w @param {number} h @param {[number, number, number, number]} [rgba]
 * @returns {Buffer}
 */
export function png(w = 4, h = 4, rgba = [255, 0, 255, 255]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgba).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A well-formed, non-interlaced PNG of `w` × `h` zero pixels in any bit depth / colour type (a palette gets one entry).
 * @param {number} w @param {number} h @param {{ depth?: number, color?: number }} [opts]
 * @returns {Buffer}
 */
export function pngOf(w, h, { depth = 8, color = 6 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth; ihdr[9] = color;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const row = Buffer.alloc(1 + Math.ceil((w * channels * depth) / 8));
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...(color === 3 ? [chunk('PLTE', Buffer.from([0, 0, 0]))] : []), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Spine's binary writer pieces (@pixi-spine/base BinaryInput read in reverse). */
class SpineOut {
  constructor() { this.parts = []; }
  byte(b) { this.parts.push(Buffer.from([b & 0xff])); }
  bool(v) { this.byte(v ? 1 : 0); }
  varint(v, optimizePositive = true) {
    let n = optimizePositive ? v >>> 0 : ((v << 1) ^ (v >> 31)) >>> 0;
    const out = [];
    do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n && out.length < 5);
    this.parts.push(Buffer.from(out));
  }
  float(f) { const b = Buffer.alloc(4); b.writeFloatBE(f); this.parts.push(b); }
  str(s) {
    if (s == null) { this.varint(0); return; }
    const b = Buffer.from(s, 'utf8');
    this.varint(b.length + 1);
    this.parts.push(b);
  }
  /** The bytes in a buffer of their own (the Spine runtime reads `.buffer` from its start). */
  buf() { const all = Buffer.concat(this.parts); const own = new Uint8Array(all.length); own.set(all); return Buffer.from(own.buffer); }
}

/**
 * A Spine 3.8 binary skeleton: one root bone, no slot or attachment, the named events and animations — each animation
 * an event timeline (its events at their times: the animation lasts until the last one). The client's parser
 * (tools/assets/skel.mjs parseSkel, pixi-spine) reads it.
 * @param {{ animations?: Record<string, [string, number][]>, bounds?: [number, number, number, number] }} [opts]
 *   animations: name → [[event name, time s] …]; default Idle (1 s), Attack (OnAttack at 0.5 s), Die (0.8 s), Start (0.4 s)
 * @returns {Buffer}
 */
export function skel({ animations = { Idle: [['OnStart', 1]], Attack: [['OnAttack', 0.5]], Die: [['OnStart', 0.8]], Start: [['OnStart', 0.4]] },
  bounds = [-50, 0, 100, 120] } = {}) {
  const events = [...new Set(Object.values(animations).flat().map(([e]) => e))];
  const o = new SpineOut();
  o.str('testhash'); o.str('3.8.99');
  for (const f of bounds) o.float(f);
  o.bool(false);                                   // nonessential
  o.varint(events.length); for (const e of events) o.str(e);   // the string table (event names are refs into it)
  o.varint(1); o.str('root');                      // bones: root
  for (const f of [0, 0, 0, 1, 1, 0, 0, 0]) o.float(f);
  o.varint(0); o.bool(false);                      // transform mode normal, not skin-required
  o.varint(0); o.varint(0); o.varint(0); o.varint(0); // slots, ik, transform, path constraints
  o.varint(0);                                     // default skin: no slot
  o.varint(0);                                     // skins
  o.varint(events.length);
  events.forEach((_, i) => { o.varint(i + 1); o.varint(0, false); o.float(0); o.str(null); o.str(null); });
  const names = Object.keys(animations);
  o.varint(names.length);
  for (const name of names) {
    o.str(name);
    for (let i = 0; i < 7; i++) o.varint(0);       // slot, bone, ik, transform, path, deform timelines; draw order
    const evs = [...animations[name]].sort((a, b) => a[1] - b[1]);
    o.varint(evs.length);
    for (const [e, time] of evs) { o.float(time); o.varint(events.indexOf(e)); o.varint(0, false); o.float(0); o.bool(false); }
  }
  return o.buf();
}

/** The atlas of a skeleton without regions: one page per image name, each `size` × `size`. @param {string[]} pages @param {number} [size] */
export const atlas = (pages, size = 4) => pages.map((p) => `\n${p}\nsize: ${size},${size}\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n`).join('');

/**
 * Write a plugin folder: `files` maps a path to a Buffer, a string or a JSON value; `manifest` is plugin.json.
 * @param {string} dir the plugin folder (created)
 * @param {Record<string, any>} manifest
 * @param {Record<string, Buffer | string | object>} [files]
 * @returns {string} dir
 */
export function writePlugin(dir, manifest, files = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  }
  return dir;
}

/** A cosmetic manifest 2 with these fields (version 1.0.0, any app, api 1, both scopes, assets.override). */
export const cosmetic = (extra = {}) => ({
  manifest: 2, name: { zh: '测试外观', en: 'Test skin' }, version: '1.0.0', app: '*', api: 1, class: 'cosmetic', scope: ['room', 'personal'],
  permissions: ['assets.override'], ...extra,
});
