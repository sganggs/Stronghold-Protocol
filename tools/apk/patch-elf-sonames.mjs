#!/usr/bin/env node
// tools/apk/patch-elf-sonames.mjs — make an Android-legal library layout out of the Termux runtime.
// Ported from Fuhua-code/Stronghold-Protocol (mobile/tools/patch-elf-sonames.mjs, GPL-3.0-or-later,
// same project family) with layout adapted to this shell.
//
//   node tools/apk/patch-elf-sonames.mjs <dir> [--dry-run]
//
// Android's package manager only extracts `lib/<abi>/` entries whose name has the shape `lib*.so`; a bare
// executable (`node`) or a versioned soname (`libcrypto.so.3`) is skipped. This tool renames the runtime
// files and byte-patches the DT_NEEDED / DT_SONAME string slots so the dynamic linker still matches.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The short, Android-legal name for a Termux runtime file (or null when the name is already fine). */
export function androidLibName(name) {
  if (name === 'node') return 'libnode.so';
  const m = /^(lib[^/]+?\.so)(?:\.[0-9][^/]*)?$/.exec(name);
  if (!m) return null;
  return m[1] === name ? null : m[1];
}

const DT_NULL = 0;
const DT_NEEDED = 1;
const DT_STRTAB = 5;
const DT_STRSZ = 10;
const DT_SONAME = 14;
const DT_RUNPATH = 29;

/**
 * Repoint an existing DT_RUNPATH at "$ORIGIN" (the executable's own directory) so the linker finds the
 * Termux libraries next to libnode.so without any LD_LIBRARY_PATH / --library-path: the shipped value is
 * Termux's own path (/data/data/com.termux/...), which never exists inside an APK. In-place only — the
 * replacement is shorter than the original string, and the tail is zeroed. No slot surgery needed.
 * @param {Buffer} buf
 * @returns {boolean} true when a RUNPATH was rewritten
 */
export function pointRunpathAtOrigin(buf) {
  if (buf.length < 64 || buf.readUInt32LE(0) !== 0x464c457f) return false;
  if (buf[4] !== 2 || buf[5] !== 1) return false;
  const eShoff = Number(buf.readBigUInt64LE(0x28));
  const eShentsize = buf.readUInt16LE(0x3a);
  const eShnum = buf.readUInt16LE(0x3c);

  let dyn = null;
  let dynIdx = -1;
  for (let i = 0; i < eShnum; i++) {
    const off = eShoff + i * eShentsize;
    if (buf.readUInt32LE(off + 4) === 6 /* SHT_DYNAMIC */) {
      dyn = { offset: Number(buf.readBigUInt64LE(off + 0x18)), size: Number(buf.readBigUInt64LE(off + 0x20)) };
      dynIdx = i;
      break;
    }
  }
  if (!dyn) return false;
  const strtabIdx = buf.readUInt32LE(eShoff + dynIdx * eShentsize + 0x28);
  const sOff = eShoff + strtabIdx * eShentsize;
  const strFileOff = Number(buf.readBigUInt64LE(sOff + 0x18));

  let changed = false;
  for (let p = dyn.offset; p + 16 <= dyn.offset + dyn.size; p += 16) {
    const tag = Number(buf.readBigInt64LE(p));
    if (tag === DT_NULL) break;
    if (tag !== DT_RUNPATH) continue;
    const val = buf.readBigUInt64LE(p + 8);
    const o = strFileOff + Number(val);
    const end = buf.indexOf(0, o);
    if (end < 0) continue;
    const room = end - o;
    if (room < '$ORIGIN'.length) continue; // cannot shrink into it; leave untouched
    const cur = buf.toString('utf8', o, end);
    if (cur === '$ORIGIN') continue;
    buf.write('$ORIGIN', o, 'utf8');
    buf.fill(0, o + '$ORIGIN'.length, end);
    changed = true;
  }
  return changed;
}

/** Rewrite the DT_NEEDED/DT_SONAME strings of an ELF64 little-endian shared object. */
export function patchElfSonames(buf, rename) {
  if (buf.length < 64 || buf.readUInt32LE(0) !== 0x464c457f) throw new Error('not an ELF file');
  if (buf[4] !== 2 || buf[5] !== 1) throw new Error('only 64-bit little-endian ELF is supported');
  const eShoff = Number(buf.readBigUInt64LE(0x28));
  const eShentsize = buf.readUInt16LE(0x3a);
  const eShnum = buf.readUInt16LE(0x3c);

  let dyn = null;
  for (let i = 0; i < eShnum; i++) {
    const off = eShoff + i * eShentsize;
    const type = buf.readUInt32LE(off + 4);
    if (type === 6 /* SHT_DYNAMIC */) {
      dyn = { offset: Number(buf.readBigUInt64LE(off + 0x18)), size: Number(buf.readBigUInt64LE(off + 0x20)) };
      break;
    }
  }
  if (!dyn) throw new Error('no .dynamic section');

  const entries = [];
  for (let p = dyn.offset; p + 16 <= dyn.offset + dyn.size; p += 16) {
    const tag = Number(buf.readBigInt64LE(p));
    const val = buf.readBigUInt64LE(p + 8);
    if (tag === DT_NULL) break;
    entries.push({ p, tag, val });
  }
  const strtabVaddr = entries.find((e) => e.tag === DT_STRTAB)?.val;
  const strsz = entries.find((e) => e.tag === DT_STRSZ)?.val;
  if (strtabVaddr == null || strsz == null) throw new Error('no DT_STRTAB / DT_STRSZ');

  let strtabOff = null;
  for (let i = 0; i < eShnum; i++) {
    const off = eShoff + i * eShentsize;
    if (buf.readUInt32LE(off + 4) !== 3 /* SHT_STRTAB */) continue;
    const addr = Number(buf.readBigUInt64LE(off + 0x10));
    if (addr === Number(strtabVaddr)) { strtabOff = Number(buf.readBigUInt64LE(off + 0x18)); break; }
  }
  if (strtabOff == null) strtabOff = dyn.offset + dyn.size;
  const strEnd = strtabOff + Number(strsz);

  const readStr = (offset) => {
    const end = buf.indexOf(0, offset);
    if (end < 0 || end >= strEnd) return '';
    return buf.toString('utf8', offset, end);
  };
  const writeStr = (offset, value) => {
    const end = buf.indexOf(0, offset);
    const room = end - offset;
    if (value.length > room) throw new Error(`"${value}" does not fit in the ${room} bytes reserved at ${offset}`);
    buf.write(value, offset, 'utf8');
    buf.fill(0, offset + value.length, end);
  };

  const changed = [];
  for (const e of entries) {
    if (e.tag !== DT_NEEDED && e.tag !== DT_SONAME) continue;
    const offset = strtabOff + Number(e.val);
    const current = readStr(offset);
    if (!current) continue;
    const next = rename(current);
    if (!next || next === current) continue;
    writeStr(offset, next);
    changed.push(`${e.tag === DT_SONAME ? 'SONAME' : 'NEEDED'} ${current} -> ${next}`);
  }
  return { buf, changed };
}

/** Apply the Android-legal layout to a directory of runtime files. */
export async function patchRuntimeDir(dir, { dryRun = false } = {}) {
  const root = path.resolve(dir);
  const files = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort();
  const renames = new Map();
  for (const f of files) {
    const to = androidLibName(f);
    if (to) renames.set(f, to);
  }
  const rename = (name) => renames.get(path.posix.basename(name)) ?? null;

  const log = [];
  let patched = 0;
  let runpaths = 0;
  for (const f of files) {
    const p = path.join(root, f);
    const buf = await fsp.readFile(p);
    if (buf.length < 4 || buf.readUInt32LE(0) !== 0x464c457f) continue; // not ELF (e.g. the ICU data blob): skip
    let out;
    let runpath = false;
    try {
      // RUNPATH=$ORIGIN lets the linker find the Termux libraries beside the executable
      runpath = pointRunpathAtOrigin(buf);
      out = patchElfSonames(Buffer.from(buf), rename);
    } catch (e) {
      log.push(`! ${f}: ${e.message}`);
      continue;
    }
    if (runpath) runpaths++;
    if (out.changed.length) {
      patched++;
      log.push(`${f}: ${out.changed.join(', ')}`);
    }
    if (runpath && !out.changed.length) log.push(`${f}: RUNPATH -> $ORIGIN`);
    if (out.changed.length || runpath) {
      if (!dryRun) await fsp.writeFile(p, out.buf);
    }
  }
  if (!dryRun) {
    for (const [from, to] of renames) {
      const src = path.join(root, from);
      const dst = path.join(root, to);
      if (fs.existsSync(dst)) await fsp.rm(dst, { force: true });
      await fsp.rename(src, dst);
    }
  }
  return { patched, renamed: [...renames], runpaths, log };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('usage: node tools/apk/patch-elf-sonames.mjs <runtime dir> [--dry-run]');
    process.exitCode = 2;
  } else {
    patchRuntimeDir(dir, { dryRun }).then((r) => {
      console.log(`▶ ${path.resolve(dir)}`);
      console.log(`  ${r.renamed.length ? `renaming ${r.renamed.map(([a, b]) => `${a}->${b}`).join(', ')}` : 'nothing to rename'}`);
      for (const line of r.log) console.log(`  ${line}`);
      console.log(`  ${dryRun ? '(dry run) ' : ''}${r.patched} ELF files patched, ${r.renamed.length} renamed`);
    }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
  }
}
