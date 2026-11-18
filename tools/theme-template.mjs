#!/usr/bin/env node
// tools/theme-template.mjs — a starter interface theme (docs/THEMES.md). No official art.
//
//   node tools/theme-template.mjs [dir]          write <dir>/theme.json
//   node tools/theme-template.mjs --zip out.zip  a stored-method zip of that theme.json
//
// The default directory is docs/examples/ui-theme. Empty image, banner and voice strings are
// omitted by the checker. The colours are the official default skin ac_n_initial.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BANNER_KEYS, DEFAULT_SKIN_COLORS, UNWIRED_IMAGE_SLOTS, VOICE_TRIGGERS, WIRED_IMAGE_SLOTS,
} from '../shared/uiTheme.js';

/** The starter manifest. Every slot, banner and trigger is listed and empty. */
export function themeTemplateDocument() {
  const images = {};
  for (const slot of [...WIRED_IMAGE_SLOTS, ...UNWIRED_IMAGE_SLOTS]) images[slot] = '';
  const banners = {};
  for (const key of BANNER_KEYS) banners[key] = '';
  const voice = {};
  for (const key of Object.keys(VOICE_TRIGGERS)) voice[key] = '';
  return {
    spTheme: 1,
    id: 'my-theme',
    name: '我的主题',
    author: '',
    version: '1.0.0',
    description: '',
    thumbnail: '',
    preview: '',
    colors: { ...DEFAULT_SKIN_COLORS },
    tokens: {},
    images,
    banners,
    voice,
  };
}

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function bytesOf(n, width) {
  const out = [];
  for (let i = 0; i < width; i++) out.push((n >>> (8 * i)) & 255);
  return out;
}

/**
 * A stored-method (method 0) zip. `entries` are `{ name, data }`. `data` is a Uint8Array.
 * Directory names end with `/` and carry no bytes.
 * @param {{ name: string, data: Uint8Array }[]} entries
 * @returns {Uint8Array}
 */
export function zipStored(entries) {
  /** @type {Uint8Array[]} */
  const locals = [];
  /** @type {Uint8Array[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data || []);
    const crc = crc32(data);
    const local = new Uint8Array([
      ...bytesOf(0x04034b50, 4), ...bytesOf(20, 2), ...bytesOf(0, 2), ...bytesOf(0, 2),
      ...bytesOf(0, 2), ...bytesOf(0, 2), ...bytesOf(crc, 4), ...bytesOf(data.length, 4),
      ...bytesOf(data.length, 4), ...bytesOf(name.length, 2), ...bytesOf(0, 2),
    ]);
    locals.push(local, name, data);
    const central = new Uint8Array([
      ...bytesOf(0x02014b50, 4), ...bytesOf(20, 2), ...bytesOf(20, 2), ...bytesOf(0, 2),
      ...bytesOf(0, 2), ...bytesOf(0, 2), ...bytesOf(0, 2), ...bytesOf(crc, 4),
      ...bytesOf(data.length, 4), ...bytesOf(data.length, 4), ...bytesOf(name.length, 2),
      ...bytesOf(0, 2), ...bytesOf(0, 2), ...bytesOf(0, 2), ...bytesOf(0, 2),
      ...bytesOf(0, 4), ...bytesOf(offset, 4),
    ]);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = concat(centrals);
  const eocd = new Uint8Array([
    ...bytesOf(0x06054b50, 4), ...bytesOf(0, 2), ...bytesOf(0, 2),
    ...bytesOf(entries.length, 2), ...bytesOf(entries.length, 2),
    ...bytesOf(cd.length, 4), ...bytesOf(offset, 4), ...bytesOf(0, 2),
  ]);
  return concat([...locals, cd, eocd]);
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const doc = `${JSON.stringify(themeTemplateDocument(), null, 2)}\n`;
  const zipAt = args.indexOf('--zip');
  if (zipAt >= 0) {
    const out = resolve(args[zipAt + 1] || 'theme.zip');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, zipStored([{ name: 'theme.json', data: new TextEncoder().encode(doc) }]));
    return;
  }
  const dir = resolve(args[0] || fileURLToPath(new URL('../docs/examples/ui-theme/', import.meta.url)));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/theme.json`, doc);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
