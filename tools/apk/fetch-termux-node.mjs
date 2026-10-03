#!/usr/bin/env node
// tools/apk/fetch-termux-node.mjs — download the Termux Node runtime (.debs), extract it and stage an
// Android-legal copy into the app's jniLibs. Ported from Fuhua-code/Stronghold-Protocol (mobile/build-apk.mjs
// runtime section, GPL-3.0-or-later, same project family), adapted to this shell's layout.
//
//   node tools/apk/fetch-termux-node.mjs [--abis arm64-v8a,x86_64] [--force]
//
// Why: nodejs-mobile's libnode (Node 18) is EOL and hits GWP-ASan/16KB-page problems on new Android;
// the Termux Node 24 build is a plain PIE executable + shared libs that runs as a child process.
// Requires `xz` on Linux (decompression via `xz -dk`), or uses the system bsdtar on Windows.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { patchRuntimeDir } from './patch-elf-sonames.mjs';

const TERMUX = {
  bases: process.env.SP_TERMUX_MIRROR
    ? [process.env.SP_TERMUX_MIRROR]
    : ['https://packages.termux.dev/apt/termux-main',
       'https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main'], // CN fallback, ~8 MB/s
  packages: [
    { pkg: 'nodejs-lts', file: 'pool/main/n/nodejs-lts/nodejs-lts_24.18.0-1_<arch>.deb', bins: { 'bin/node': 'node' } },
    { pkg: 'libc++', file: 'pool/main/libc/libc++/libc++_30_<arch>.deb', libs: { 'lib/libc++_shared.so': 'libc++_shared.so' } },
    { pkg: 'openssl', file: 'pool/main/o/openssl/openssl_1%3A3.6.5_<arch>.deb', libs: { 'lib/libcrypto.so.3': 'libcrypto.so.3', 'lib/libssl.so.3': 'libssl.so.3' } },
    { pkg: 'libicu', file: 'pool/main/libi/libicu/libicu_78.3_<arch>.deb', libs: { 'lib/libicuuc.so.78.3': 'libicuuc.so.78', 'lib/libicui18n.so.78.3': 'libicui18n.so.78', 'lib/libicudata.so.78.3': 'libicudata.so.78' } },
    { pkg: 'c-ares', file: 'pool/main/c/c-ares/c-ares_1.34.8_<arch>.deb', libs: { 'lib/libcares.so': 'libcares.so' } },
    { pkg: 'libsqlite', file: 'pool/main/libs/libsqlite/libsqlite_3.53.4_<arch>.deb', libs: { 'lib/libsqlite3.so.3.53.4': 'libsqlite3.so' } },
    { pkg: 'zlib', file: 'pool/main/z/zlib/zlib_1.3.2_<arch>.deb', libs: { 'lib/libz.so.1.3.2': 'libz.so.1' } },
  ],
};

const ABI_TERMUX = { 'arm64-v8a': 'aarch64', 'x86_64': 'x86_64' };

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const jniRoot = path.join(repo, 'android', 'app', 'src', 'main', 'jniLibs');
const cache = path.resolve(repo, '..', 'dl-cache', 'termux-runtime');

function fail(msg) {
  console.error(`fetch-termux-node: ${msg}`);
  process.exit(1);
}

/** https only, and reject localhost / loopback / private / reserved literals (workspace security rule). */
function assertSafeUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') fail(`non-https url: ${url}`);
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    fail(`private host rejected: ${host}`);
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) fail(`private/reserved host rejected: ${host}`);
    if (a === 169 && b === 254) fail(`link-local host rejected: ${host}`);
    if (a === 172 && b >= 16 && b <= 31) fail(`private host rejected: ${host}`);
    if (a === 192 && b === 168) fail(`private host rejected: ${host}`);
  }
}

async function download(url, dest) {
  assertSafeUrl(url);
  console.log(`  downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4000) throw new Error(`too small (${buf.length} bytes)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

/** Extract selected members out of a .deb (ar container + data.tar.xz); symlinks are skipped (Windows-safe). */
async function extractDeb(deb, destDir) {
  const work = path.join(cache, 'work', path.basename(deb));
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const buf = fs.readFileSync(deb);
  if (buf.subarray(0, 8).toString('ascii') !== '!<arch>\n') fail(`${deb} is not an ar archive`);
  let p = 8;
  let payload = null;
  let payloadName = '';
  while (p + 60 <= buf.length) {
    const name = buf.subarray(p, p + 16).toString('ascii').trim();
    const size = Number(buf.subarray(p + 48, p + 58).toString('ascii').trim());
    const start = p + 60;
    if (name.startsWith('data.tar')) { payload = buf.subarray(start, start + size); payloadName = name; }
    p = start + size + (size % 2);
  }
  if (!payload) fail(`${deb}: no data.tar member found`);

  const dataTar = path.join(work, 'data.tar');
  if (payloadName.endsWith('.gz')) {
    fs.writeFileSync(dataTar, zlib.gunzipSync(payload));
  } else {
    const dataXz = path.join(work, 'data.tar.xz');
    fs.writeFileSync(dataXz, payload);
    try {
      // decompress ONLY (never extract members here: the .deb contains symlinks Windows cannot create)
      execFileSync('xz', ['-dkf', dataXz], { stdio: 'inherit' }); // -> data.tar next to it
    } catch (e) {
      if (process.platform === 'win32') {
        // no xz installed: Python's stdlib lzma writes the tar without touching any members
        execFileSync('python', ['-c',
          'import lzma,sys;open(sys.argv[2],"wb").write(lzma.open(sys.argv[1]).read())',
          dataXz, dataTar], { stdio: 'inherit' });
      } else {
        throw e;
      }
    }
    fs.rmSync(dataXz, { force: true });
  }
  if (!fs.existsSync(dataTar)) fail(`${deb}: decompression produced no tar`);

  const tar = fs.readFileSync(dataTar);
  const out = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const nameField = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const full = prefix ? `${prefix}/${nameField}` : nameField;
    const dataStart = off + 512;
    if ((type === '0' || type === '\0') && full && !full.endsWith('/')) {
      const dest = path.join(destDir, ...full.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, tar.subarray(dataStart, dataStart + size));
      out.push(full);
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  fs.rmSync(dataTar, { force: true });
  return out;
}

async function fetchAbi(abi, force) {
  const arch = ABI_TERMUX[abi];
  if (!arch) fail(`unsupported ABI ${abi} (Termux publishes aarch64 and x86_64 only)`);
  const stage = path.join(cache, abi);
  const stamp = path.join(stage, 'RUNTIME.json');
  const jniDir = path.join(jniRoot, abi);
  if (!force && fs.existsSync(stamp) && fs.existsSync(path.join(jniDir, 'libnode.so'))) {
    const info = JSON.parse(fs.readFileSync(stamp, 'utf8'));
    console.log(`${abi}: cached runtime — Node ${info.node} already staged in jniLibs`);
    return;
  }
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  let nodeVersion = null;
  const libs = [];
  for (const p of TERMUX.packages) {
    const file = p.file.replace('<arch>', arch);
    const deb = path.join(cache, 'debs', `${p.pkg}-${arch}.deb`);
    if (force || !fs.existsSync(deb)) {
      let lastErr = null;
      for (const base of TERMUX.bases) {
        try {
          await download(`${base}/${file}`, deb);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          console.warn(`  ${base} failed (${e.message}), trying next mirror`);
        }
      }
      if (lastErr) fail(`${p.pkg} (${arch}): all mirrors failed — ${lastErr.message}`);
    }
    const out = path.join(stage, 'unpack', p.pkg);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const members = await extractDeb(deb, out);
    if (!members.length) fail(`${p.pkg}: the package has no regular files`);
    const usr = path.join(out, 'data', 'data', 'com.termux', 'files', 'usr');
    const wanted = { ...(p.bins || {}), ...(p.libs || {}) };
    const missing = Object.keys(wanted).filter((rel) => !fs.existsSync(path.join(usr, ...rel.split('/'))));
    if (missing.length) fail(`${p.pkg} (${arch}): ${missing.join(', ')} not found in the package`);
    for (const [from, to] of Object.entries(wanted)) {
      fs.copyFileSync(path.join(usr, ...from.split('/')), path.join(stage, to));
      if (p.libs) libs.push(to);
    }
    if (p.bins) nodeVersion = /nodejs-lts_(\d+\.\d+\.\d+)/.exec(p.file)?.[1] || '24.x';
  }

  // stage into jniLibs with the Android-legal shape (rename + ELF DT_NEEDED/DT_SONAME rewrite)
  fs.rmSync(jniDir, { recursive: true, force: true });
  fs.mkdirSync(jniDir, { recursive: true });
  fs.copyFileSync(path.join(stage, 'node'), path.join(jniDir, 'node'));
  for (const lib of libs) fs.copyFileSync(path.join(stage, lib), path.join(jniDir, lib));
  const patched = await patchRuntimeDir(jniDir);
  const entries = fs.readdirSync(jniDir).sort();
  if (!entries.includes('libnode.so')) fail(`${abi}: libnode.so missing after patch`);
  console.log(`${abi}: Node ${nodeVersion} staged — ${entries.length} entries, ${patched.patched} ELF patched`);

  fs.writeFileSync(stamp, JSON.stringify({ abi, arch, node: nodeVersion, libs, packages: TERMUX.packages.map((p) => p.pkg), fetchedAt: new Date().toISOString() }, null, 1) + '\n');
}

async function main() {
  const force = process.argv.includes('--force');
  const abisArg = process.argv.find((a) => a.startsWith('--abis='));
  const abis = abisArg ? abisArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : ['arm64-v8a', 'x86_64'];
  for (const abi of abis) await fetchAbi(abi, force);
  console.log('fetch-termux-node: done');
}

main().catch((e) => fail(e.stack || String(e)));
