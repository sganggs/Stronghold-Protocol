#!/usr/bin/env node
// Fill missing manifest assets from PRTS (prts.wiki). The wiki mirrors the official art the community
// dumps may not carry, or that failed to download on this machine: operator avatars (头像_<name>.png /
// 头像_<name>_2.png), half-body portraits (半身像_<name>_<1|2>.png), skill icons (技能_<name>.png),
// enemy icons (头像_敌人_<name>.png) and the rarity sprite (稀有度_黄_<n>.png). Spine models, battle SFX
// and BGM are NOT on the wiki — those stay with tools/fetch-assets.mjs (community dumps).
//
// Only paths data/assets.json already lists and that are missing on disk are filled, so the manifest
// never grows behind the pipeline's back. Downloads go through Special:FilePath (a stable redirect);
// files are validated (PNG magic) and written atomically; reruns are cheap.
//
// Usage: node tools/fetch-assets-prts.mjs [--dry-run] [--only avatar,portrait,skill,enemy,ui]
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const MANIFEST = join(ROOT, 'data', 'assets.json');
const WIKI = 'https://prts.wiki/w/Special:FilePath/';

const readJson = async (rel) => JSON.parse(await readFile(join(ROOT, rel), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Icon ids the data carries no skill record for (a generic COM skill the pool references by its
 * sanitized id): `skcom_powerstrike_2_` is `skcom_powerstrike[2]` = 强力击·β型.
 */
const SKILL_ICON_NAMES = Object.freeze({ skcom_powerstrike_2_: '强力击·β型' });

/** charId → 干员名, skillId → 技能名, enemyKey → 敌人名 (the wiki names its files after them). */
async function names() {
  const [chess, catalog, enemies] = await Promise.all(['data/chess.json', 'data/custom-operators.json', 'data/enemies.json'].map(readJson));
  const charName = new Map();
  const skillName = new Map();
  const addSkills = (skills) => { for (const s of skills || []) if (s?.skillId && s.name) skillName.set(s.skillId, s.name); };
  for (const rec of Object.values(chess)) {
    if (rec.charId && rec.name) charName.set(rec.charId, rec.name);
    addSkills(rec.skills);
  }
  for (const [charId, rec] of Object.entries(catalog)) {
    charName.set(charId, rec.name);
    for (const variant of Object.values(rec.variants || {})) addSkills(variant.skills);
  }
  const enemyName = new Map();
  for (const [key, rec] of Object.entries(enemies)) if (rec?.name) enemyName.set(key, rec.name);
  return { charName, skillName, enemyName, skillsById: (await readJson('data/assets.json')).skillsById || {} };
}

/** PRTS file names for one missing path, most likely first (a 404 moves on to the next). */
function wikiNames(rel, idx) {
  let m;
  if ((m = /^char\/avatar\/(char_[A-Za-z0-9_]+?)(_2)?\.png$/.exec(rel))) {
    const name = idx.charName.get(m[1]);
    if (!name) return [];
    // 头像_<名>.png is the E0/E1 avatar; the E2 one carries the _2 suffix (same as the class's other files)
    return [m[2] ? `头像_${name}_2.png` : `头像_${name}.png`];
  }
  if ((m = /^char\/portrait\/(char_[A-Za-z0-9_]+?)_([12])\.png$/.exec(rel))) {
    const name = idx.charName.get(m[1]);
    return name ? [`半身像_${name}_${m[2]}.png`] : [];
  }
  if ((m = /^skill\/(.+)\.png$/.exec(rel))) {
    const iconId = m[1];
    const skillId = Object.entries(idx.skillsById).find(([, icon]) => icon === iconId)?.[0] ?? iconId;
    const name = idx.skillName.get(skillId) ?? SKILL_ICON_NAMES[iconId];
    if (!name) return [];
    // The wiki file name keeps the skill's own quotes; try both quote styles and a quote-free variant.
    const bare = name.replace(/[“”"]/g, '');
    return [...new Set([`技能_${name}.png`, `技能_${bare}.png`, `技能_"${bare}".png`])];
  }
  if ((m = /^enemy\/icon\/(enemy_[A-Za-z0-9_]+)\.png$/.exec(rel))) {
    const name = idx.enemyName.get(m[1]);
    return name ? [`头像_敌人_${name}.png`] : [];
  }
  if ((m = /^ui\/charRaritySprite\/rarity_(\d+)\.png$/.exec(rel))) return [`稀有度_黄_${m[1]}.png`];
  return [];
}

const kindOf = (rel) => rel.split('/')[0];

/** Every path data/assets.json lists that is not on disk, with its PRTS candidates. */
async function plan({ only = null } = {}) {
  const manifest = await readJson('data/assets.json');
  const idx = await names();
  const urls = (node, out = []) => {
    if (typeof node === 'string') { if (/^\/(assets|fonts)\//.test(node)) out.push(node); }
    else if (node && typeof node === 'object') for (const v of Object.values(node)) urls(v, out);
    return out;
  };
  const missing = [...new Set(urls(manifest))].filter((u) => !existsSync(join(ROOT, 'public', u)));
  const jobs = [];
  const skipped = new Map();
  for (const u of missing) {
    const rel = u.slice('/assets/'.length);
    const kind = kindOf(rel);
    if (only && !only.includes(kind)) continue;
    const candidates = wikiNames(rel, idx);
    if (candidates.length) jobs.push({ rel, url: u, candidates });
    else skipped.set(kind, (skipped.get(kind) || 0) + 1);
  }
  return { missing: missing.length, jobs, skipped };
}

async function fetchPng(name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(WIKI + encodeURIComponent(name).replace(/%2F/g, '/'), {
        redirect: 'follow', headers: { 'user-agent': 'stronghold-protocol-fetch-assets/1.0' }, signal: AbortSignal.timeout(60000),
      });
      if (res.status === 404 || res.status === 410) return { notFound: true };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG (${buf.length} B)`);
      return { buf };
    } catch (e) {
      if (attempt === 3) return { error: e?.message || String(e) };
      await sleep(600 * attempt);
    }
  }
}

export async function fillFromPrts({ dryRun = false, only = null, log = console.log } = {}) {
  const { missing, jobs, skipped } = await plan({ only });
  log(`[prts] ${missing} manifest path(s) missing on disk; ${jobs.length} mappable to the wiki`);
  const filled = [];
  const failed = [];
  for (const job of jobs) {
    if (dryRun) { log(`  ${job.rel} ← ${job.candidates[0]}`); continue; }
    let done = false;
    for (const name of job.candidates) {
      const r = await fetchPng(name);
      if (r.notFound) continue;
      if (r.error) { failed.push(`${job.rel} (${name}): ${r.error}`); break; }
      const abs = join(ASSETS, job.rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs + '.tmp', r.buf);
      await rename(abs + '.tmp', abs);
      filled.push(`${job.rel} ← ${name} (${(r.buf.length / 1024).toFixed(0)} KB)`);
      done = true;
      break;
    }
    if (!done && !failed.some((f) => f.startsWith(job.rel))) failed.push(`${job.rel}: no wiki file (${job.candidates.join(' | ')})`);
  }
  return { missing, mappable: jobs.length, filled, failed, skipped: [...skipped] };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const onlyArg = argv.find((a) => a.startsWith('--only=') || a === '--only');
  const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : argv[argv.indexOf('--only') + 1] || '').split(',').filter(Boolean) : null;
  const r = await fillFromPrts({ dryRun, only, log: console.log });
  console.log(dryRun ? '[prts] dry run — nothing written' : `[prts] filled ${r.filled.length}`);
  for (const f of r.failed) console.log(`  failed: ${f}`);
  if (r.skipped.length) console.log(`  not on the wiki by category: ${r.skipped.map(([k, n]) => `${k}=${n}`).join(', ')}`);
}

const invoked = (() => { try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invoked) main().catch((e) => { console.error(`fetch-assets-prts: ${e?.stack || e}`); process.exitCode = 1; });
