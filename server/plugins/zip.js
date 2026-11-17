// server/plugins/zip.js — a small ZIP writer for packed plugins (DESIGN §32.9, docs/PLUGINS.md §15: the studio's 打包 and
// node tools/plugin.mjs pack --zip). Deterministic: the same files give the same bytes — entries sorted by name, one fixed
// timestamp (1980-01-01 00:00, the first DOS date), no extra fields — so a zip can be pinned by its SHA-256 (the catalogue
// and install-by-address of the 0.3.0 plan). Already-compressed media (images, audio, fonts) are stored, everything else
// deflated. Names are UTF-8 (general purpose flag bit 11). No ZIP64: a plugin is at most 512 MB (a cosmetic pack; 200 MB
// for every other class) in 5000 files (shared/plugins/manifest.js PLUGIN_LIMITS, PLUGIN_MAX_BYTES), well inside the
// 4 GB / 65 535-entry format.

import zlib from 'node:zlib';
import { PLUGIN_LIMITS, PLUGIN_MAX_BYTES, isPackPath } from '../../shared/plugins/manifest.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (the ZIP / PNG one) of a buffer. @param {Uint8Array} buf */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Extensions whose bytes are already compressed: stored as they are. */
const STORED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.ogg', '.woff2', '.zip']);
/** 1980-01-01 00:00 in DOS form (date: (year − 1980) << 9 | month << 5 | day; time 0). */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * A ZIP archive of `entries` (sorted by name; a name is a '/'-separated relative path).
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @returns {Buffer}
 */
export function zipFiles(entries) {
  const list = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of list) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength);
    const ext = (/\.[^./]+$/.exec(e.name)?.[0] || '').toLowerCase();
    const deflate = !STORED.has(ext) && data.length > 0;
    const body = deflate ? zlib.deflateRawSync(data, { level: 9 }) : data;
    // a deflated body that came out larger than the bytes is stored instead
    const method = deflate && body.length < data.length ? 8 : 0;
    const stored = method === 8 ? body : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed: 2.0
    local.writeUInt16LE(0x0800, 6);          // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, stored);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);        // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);            // extra
    central.writeUInt16LE(0, 32);            // comment
    central.writeUInt16LE(0, 34);            // disk
    central.writeUInt16LE(0, 36);            // internal attributes
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external: a plain file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + stored.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(list.length, 8);
  end.writeUInt16LE(list.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/**
 * The entries of a ZIP archive written by zipFiles (or any plain one without ZIP64): `[{ name, data }]` — for the tests
 * and the studio's own check of what it packed.
 * @param {Buffer} zip
 * @returns {{ name: string, data: Buffer }[]}
 */
export function unzipFiles(zip) {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(endAt + 10);
  let p = zip.readUInt32LE(endAt + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('broken central directory');
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const lName = zip.readUInt16LE(local + 26);
    const lExtra = zip.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    const raw = zip.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : null;
    if (!data) throw new Error(`${name}: compression method ${method} is not supported`);
    if (crc32(data) !== crc) throw new Error(`${name}: CRC mismatch`);
    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ZIP64_LOCATOR = 0x07064b50;
const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** @param {string} message */
function zipReject(message) {
  return Object.assign(new Error(message), { code: 'PLUGIN_INSTALL_ZIP' });
}

/** A ZIP extra field that carries a Zip64 extended-information header (id 0x0001). @param {Buffer} extra */
function hasZip64Extra(extra) {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const n = extra.readUInt16LE(i + 2);
    if (id === 1) return true;
    i += 4 + n;
    if (n > extra.length) return true;
  }
  return false;
}

/**
 * A name unzip may extract: a plain relative path (isPackPath), no drive prefix, no backslash. A directory entry ends
 * in `/`. Hidden segments and `..` are refused.
 * @param {string} name
 */
function zipEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 200) return false;
  if (name.includes('\\') || name.includes('\0') || name.includes(':')) return false;
  if (name.startsWith('/')) return false;
  const rel = name.endsWith('/') ? name.slice(0, -1) : name;
  return isPackPath(rel);
}

/**
 * The files of a plugin zip, or an error (`code: 'PLUGIN_INSTALL_ZIP'`) before a hostile entry is inflated.
 * Refuses ZIP64 (a central or local extra id 0x0001, a version-needed of 45 or more, a ZIP64 locator, or a 0xffffffff
 * size), encryption, data descriptors, symbolic links and other non-files, path traversal, duplicate names, two names
 * that differ only by case, a path that is both a file and a folder, more than `maxFiles` files, and an uncompressed
 * size (one file or the total) over `maxBytes`. The declared uncompressed size is checked before inflate; inflate
 * itself is capped at that size, and the bytes must match it and the CRC. Directory entries are skipped. `unzipFiles`
 * is unchanged (it only reads archives this project wrote).
 * [ASSUMED] per-file and total uncompressed caps both default to PLUGIN_MAX_BYTES (the largest class ceiling: a zip is
 * bounded before its class is known, and checkPluginFolder enforces the class's own afterwards); the file cap is
 * PLUGIN_LIMITS.files. A Unix mode of 0 (a DOS zip) is a plain file. Case is Unicode `toLowerCase` of each segment.
 * @param {Buffer | Uint8Array} input
 * @param {{ maxFiles?: number, maxBytes?: number }} [opts]
 * @returns {{ name: string, data: Buffer }[]}
 */
export function readPluginZip(input, { maxFiles = PLUGIN_LIMITS.files, maxBytes = PLUGIN_MAX_BYTES } = {}) {
  const zip = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || endAt + 22 > zip.length || zip.readUInt32LE(endAt) !== EOCD_SIG) throw zipReject('not a zip archive');
  if (endAt >= 20 && zip.readUInt32LE(endAt - 20) === ZIP64_LOCATOR) throw zipReject('ZIP64 is not accepted');
  const disks = zip.readUInt16LE(endAt + 4);
  const diskEntries = zip.readUInt16LE(endAt + 8);
  const count = zip.readUInt16LE(endAt + 10);
  const centralSize = zip.readUInt32LE(endAt + 12);
  const centralOff = zip.readUInt32LE(endAt + 16);
  if (disks !== 0 || diskEntries === 0xffff || count === 0xffff || centralSize === 0xffffffff || centralOff === 0xffffffff) throw zipReject('ZIP64 is not accepted');
  if (count > maxFiles) throw zipReject(`${count} entries, more than ${maxFiles}`);
  if (centralOff > zip.length || centralSize > zip.length || centralOff + centralSize > zip.length) throw zipReject('broken central directory');
  let p = centralOff;
  /** @type {{ name: string, method: number, crc: number, compSize: number, uncomp: number, local: number }[]} */
  const planned = [];
  const names = new Set();
  /** Folded path → the spelling and whether that path is a directory. Catches A.txt/a.txt and A/ vs a/. */
  const folded = new Map();
  let total = 0;
  const claimFolded = (name) => {
    const isDir = name.endsWith('/');
    const segments = (isDir ? name.slice(0, -1) : name).split('/');
    let acc = '';
    for (let s = 0; s < segments.length; s++) {
      const original = segments[s];
      const key = acc ? `${acc}/${original.toLowerCase()}` : original.toLowerCase();
      const asDir = s < segments.length - 1 || isDir;
      const prev = folded.get(key);
      if (!prev) folded.set(key, { spelling: original, dir: asDir });
      else if (prev.spelling !== original) throw zipReject(`${name}: path differs only by case`);
      else if (prev.dir !== asDir) throw zipReject(`${name}: path is both a file and a folder`);
      acc = key;
    }
  };
  for (let i = 0; i < count; i++) {
    if (p + 46 > centralOff + centralSize || zip.readUInt32LE(p) !== CENTRAL_SIG) throw zipReject('broken central directory');
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compSize = zip.readUInt32LE(p + 20);
    const uncomp = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const attr = zip.readUInt32LE(p + 38);
    const local = zip.readUInt32LE(p + 42);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > centralOff + centralSize) throw zipReject('broken central directory');
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const extra = zip.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const verNeed = zip.readUInt16LE(p + 6);
    if (!zipEntryName(name)) throw zipReject(`${name.slice(0, 80)}: not a plain path inside the archive`);
    if (flags & 0x1) throw zipReject(`${name}: encrypted entries are not accepted`);
    if (flags & 0x8) throw zipReject(`${name}: data descriptors are not accepted`);
    if (verNeed >= 45 || compSize === 0xffffffff || uncomp === 0xffffffff || hasZip64Extra(extra)) throw zipReject(`${name}: ZIP64 is not accepted`);
    const mode = attr >>> 16;
    const type = mode & 0o170000;
    if (type === 0o120000) throw zipReject(`${name}: a symbolic link is not accepted`);
    if (type !== 0 && type !== 0o100000 && type !== 0o040000) throw zipReject(`${name}: not a plain file`);
    claimFolded(name);
    if (names.has(name)) throw zipReject(`${name}: duplicate name`);
    names.add(name);
    const directory = name.endsWith('/') || type === 0o040000;
    if (directory) {
      if (!name.endsWith('/') || uncomp !== 0 || compSize !== 0) throw zipReject(`${name}: not a plain directory entry`);
    } else {
      if (method !== 0 && method !== 8) throw zipReject(`${name}: compression method ${method} is not supported`);
      if (compSize > maxBytes || uncomp > maxBytes) throw zipReject(`${name}: uncompressed size is over the limit`);
      total += uncomp;
      if (total > maxBytes) throw zipReject('uncompressed size is over the limit');
      planned.push({ name, method, crc, compSize, uncomp, local });
    }
    p = next;
  }
  if (planned.length > maxFiles) throw zipReject(`${planned.length} files, more than ${maxFiles}`);
  const out = [];
  for (const e of planned) {
    if (e.local + 30 > zip.length || zip.readUInt32LE(e.local) !== LOCAL_SIG) throw zipReject(`${e.name}: broken local header`);
    const lVer = zip.readUInt16LE(e.local + 4);
    const lFlags = zip.readUInt16LE(e.local + 6);
    const lMethod = zip.readUInt16LE(e.local + 8);
    const lComp = zip.readUInt32LE(e.local + 18);
    const lUncomp = zip.readUInt32LE(e.local + 22);
    const lName = zip.readUInt16LE(e.local + 26);
    const lExtra = zip.readUInt16LE(e.local + 28);
    if ((lFlags & 0x1) || (lFlags & 0x8)) throw zipReject(`${e.name}: encrypted or data-descriptor entry`);
    if (lMethod !== e.method || lComp !== e.compSize || lUncomp !== e.uncomp) throw zipReject(`${e.name}: local header does not match the central directory`);
    const start = e.local + 30 + lName + lExtra;
    if (start < 0 || start + e.compSize > zip.length) throw zipReject(`${e.name}: truncated`);
    const localExtra = zip.subarray(e.local + 30 + lName, start);
    if (lVer >= 45 || hasZip64Extra(localExtra)) throw zipReject(`${e.name}: ZIP64 is not accepted`);
    const localName = zip.toString('utf8', e.local + 30, e.local + 30 + lName);
    if (localName !== e.name) throw zipReject(`${e.name}: local header name does not match`);
    const raw = zip.subarray(start, start + e.compSize);
    let data;
    try {
      data = e.method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: e.uncomp }) : Buffer.from(raw);
    } catch {
      throw zipReject(`${e.name}: could not be inflated`);
    }
    if (data.length !== e.uncomp) throw zipReject(`${e.name}: uncompressed size does not match`);
    if (crc32(data) !== e.crc) throw zipReject(`${e.name}: CRC mismatch`);
    out.push({ name: e.name, data });
  }
  return out;
}
