// Spine model pipeline: download skel/atlas/page PNGs, fetch extra atlas pages,
// normalize atlases (size:/pma:), parse skeletons and resolve animation roles.
// Produces the per-model `spine` entries of data/assets.json.
//
// Enemy and token models that no dump carries but the local client has (tools/local-extract/
// extract.py ENEMY_SPINES → public/assets/local/spine/enemy/<id>/, TOKEN_SPINES →
// public/assets/local/spine/token/<id>/; optional and git-ignored) are an overlay, never
// the manifest's `spine`: their metadata lives in the committed
// tools/assets/local-enemy-spines.json / local-token-spines.json (loadLocalSpines),
// refreshed from the extracted files by `fetch-assets --local-spines`
// (findLocalEnemyModels / findLocalTokenModels + localSpineMeta, read only), so
// data/assets.json is the same with or without the extraction (ASSETS.md "Enemy aliases",
// "Token models from the local client").

import { readFile, readdir, writeFile, stat, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assetUrl, safeName, urlDir } from './sources.mjs';
import { kindOf, pngSize } from './formats.mjs';
import { atlasInfo, normalizeAtlas } from './atlas.mjs';
import { parseSkel } from './skel.mjs';
import { resolveRoles } from './anim-roles.mjs';

async function fileStat(p) { try { const s = await stat(p); return s.isFile() ? s : null; } catch { return null; } }

/** Where tools/local-extract/extract.py writes enemy Spine models, under public/assets. */
export const LOCAL_ENEMY_SPINE_DIR = 'local/spine/enemy/';
/** Its data/local-assets.json group of an enemy (`spine/enemy/<id>`; the client resolves the file names through it). */
export const localEnemySpineGroup = (id) => `spine/enemy/${id}`;
/** Where tools/local-extract/extract.py writes token (summon) Spine models, under public/assets. */
export const LOCAL_TOKEN_SPINE_DIR = 'local/spine/token/';
/** Its data/local-assets.json group of a token (`spine/token/<id>`). */
export const localTokenSpineGroup = (id) => `spine/token/${id}`;

/**
 * Spine models extracted from the local client under `base` (a LOCAL_*_SPINE_DIR): every `<base><id>/` whose id matches
 * `idRe` holding a skeleton, the atlas of the same stem and at least one page PNG.
 * @param {string} root absolute public/assets directory
 * @param {string} base model folder under root, with a trailing slash
 * @param {RegExp} idRe the ids to take
 * @returns {Promise<Record<string, { dir: string, skel: string, atlas: string, pngs: string[] }>>} paths relative to root
 */
async function findLocalModels(root, base, idRe) {
  const out = {};
  let ids = [];
  try { ids = (await readdir(join(root, base), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const id of ids.sort()) {
    if (!idRe.test(id)) continue;
    const dir = `${base}${id}/`;
    let files = [];
    try { files = (await readdir(join(root, dir))).sort(); } catch { continue; }
    const skel = files.find((f) => f.endsWith('.skel'));
    const stem = skel ? skel.slice(0, -'.skel'.length) : null;
    const pngs = files.filter((f) => f.endsWith('.png'));
    if (!stem || !files.includes(`${stem}.atlas`) || !pngs.length) continue;
    out[id] = { dir, skel: dir + skel, atlas: `${dir}${stem}.atlas`, pngs: pngs.map((f) => dir + f) };
  }
  return out;
}

/**
 * Enemy Spine models extracted from the local client (tools/local-extract/extract.py ENEMY_SPINES): every
 * `local/spine/enemy/<enemyId>/` holding a skeleton, the atlas of the same stem and at least one page PNG.
 * @param {string} root absolute public/assets directory
 */
export const findLocalEnemyModels = (root) => findLocalModels(root, LOCAL_ENEMY_SPINE_DIR, /^enemy_\d+_[a-z0-9_]+$/i);
/**
 * Token Spine models extracted from the local client (tools/local-extract/extract.py TOKEN_SPINES): every
 * `local/spine/token/<tokenId>/` holding a skeleton, the atlas of the same stem and at least one page PNG.
 * @param {string} root absolute public/assets directory
 */
export const findLocalTokenModels = (root) => findLocalModels(root, LOCAL_TOKEN_SPINE_DIR, /^token_\d+_[a-z0-9_]+$/i);

/**
 * @typedef {{ skel: string, atlas: string, textures: string[], pma: boolean, anims: any, animations: Record<string, number>,
 *   events: string[], hits: Record<string, number[]>, bounds: any }} LocalSpineMeta file names relative to the model's
 *   data/local-assets.json group (localEnemySpineGroup / localTokenSpineGroup), the rest as a manifest SpineEntry
 */

const clipOf = (loop, via) => (via ? { begin: null, loop, end: null, via } : { begin: null, loop, end: null });
/**
 * Role fixes of local models whose clip names the resolver (tools/assets/anim-roles.mjs, by name) cannot read: model id →
 * roles replacing the resolved ones (the others are kept); localSpineMeta applies them, so the committed metadata carries
 * them. A fix naming a clip the skeleton lacks is dropped and reported.
 * - 电弧's 戴乌 (token_10051_radian_tower1): its clips are C_Skill1_Start / _Idle / _Attack / _Die beside a 0 s C_Default
 *   pose, which the resolver took for its idle, deploy and attack;
 * - 酒神's 本能的召唤 (token_10054_phatm2_encdool): Start, Loop (5 s), End and a 0 s Default — idle on the Loop and the
 *   End as it goes [ASSUMED: by the clip names];
 * - 白铁's 白铁™多功能平台 (token_10027_ironmn_pile1 / pile2): Start, Idle, End — the End as it goes [ASSUMED: by the
 *   clip name; the resolver finds no Die clip];
 * - 凯尔希·思衡托's 战术锚点 (token_10068_kalts2_mtship): its Start / Idle / Die clips hide its one attachment (the official
 *   battle shows the anchor through other means), so it would be an empty tile; it stays on the 0 s Default pose, the
 *   skeleton's own white anchor mark, and fades out as it goes [ASSUMED].
 */
export const LOCAL_SPINE_ROLES = Object.freeze({
  token_10051_radian_tower1: {
    idle: 'C_Skill1_Idle', deploy: 'C_Skill1_Start', attack: clipOf('C_Skill1_Attack'),
    skill: { ...clipOf('C_Skill1_Attack', 'attack'), index: 0, idle: null }, die: 'C_Skill1_Die',
  },
  token_10054_phatm2_encdool: {
    idle: 'Loop', attack: clipOf('Loop', 'idle'), skill: { ...clipOf('Loop', 'attack'), index: 0, idle: null }, die: 'End',
  },
  token_10027_ironmn_pile1: { die: 'End' },
  token_10027_ironmn_pile2: { die: 'End' },
  token_10068_kalts2_mtship: {
    idle: 'Default', deploy: 'Default', attack: clipOf('Default', 'idle'), skill: { ...clipOf('Default', 'attack'), index: 0, idle: null },
    die: null,
  },
});

/** The confined clips of 普通囚犯 / 老练囚犯: their grey *3 set (PREFAB_SPINE_ROLES). */
const PRISONER_GREY_3 = Object.freeze({
  idle: 'Idle3', deploy: 'Idle3', attack: clipOf('Attack3'), skill: { ...clipOf('Attack3', 'attack'), index: 0, idle: null },
  die: 'Die3', move: clipOf('Move3'),
});
/**
 * Role fixes of web models (enemies from their official battle prefabs; operators by character id) for skeletons whose clip
 * names mislead the resolver (by name): model id → roles replacing the resolved ones (the others are kept); processModels applies them, so
 * data/assets.json carries them. A fix naming a clip the skeleton lacks is dropped and reported. Source: the prefab's
 * animation table (its Graphic component: anim key → clip) and the clip its Spine starts on, read from the local client's
 * battle/enm_pfb_*.ab (tools/local-extract, UnityPy).
 * - 普通囚犯 / 老练囚犯 (enemy_1116_liprr / _2, 孤岛风云 prisoners): three clip sets whose collar light is red (Idle, Move …),
 *   blinking orange (Idle2 …) and grey (Idle3 …). The prefab maps its keys Idle / Move / Attack / Die to the grey *3 set
 *   and starts on Default3 — mode Default, 【禁锢】 —, the orange *2 set is its mode R (the warning before the last
 *   confined attack) and the red unnumbered set its mode L, 【解放】. The resolver took the unnumbered set, so they came out
 *   of the gate already freed (community report of 2026-10-06). The other prisoners' names already resolve to their grey
 *   set (强壮囚犯's Idle is its grey one; 拳师囚犯 / 重犯 / 传奇重犯 *_grey); every prisoner's later sets are the render/units.js
 *   FORMS 'warning' / 'liberty' the sim switches to (content/enemies/archetypes.js prisoner).
 */
/**
 * 宴 (char_337_utage): her skeleton has one unnumbered skill set, Skill_Start / Skill_Loop / Skill_End — she sits down and
 * rests: S1 分神's pose (停止攻击，防御力提升，每秒恢复生命). Her other skill, index 1 (S2, the 卫戍 default 落地斩·破门, an ATK
 * buff for its first seconds after every deployment), attacks with her ordinary clips. The resolver (by name) gave both
 * indices the unnumbered set, so she knelt through the opening seconds of every battle (the owner's playtest of
 * 2026-10-07). [ASSUMED: by the clips' pose and S1's text; the prefab's skill table was not read]
 */
const UTAGE_S1 = Object.freeze({ begin: 'Skill_Start', loop: 'Skill_Loop', end: 'Skill_End', index: 0, idle: null });
const UTAGE_S2 = Object.freeze({ ...clipOf('Attack', 'attack'), index: 1, idle: null });
export const PREFAB_SPINE_ROLES = Object.freeze({
  enemy_1116_liprr: PRISONER_GREY_3,
  enemy_1116_liprr_2: PRISONER_GREY_3,
  // operators by character id: both the front and the back model
  char_337_utage: { skill: UTAGE_S2, skills: { 0: UTAGE_S1, 1: UTAGE_S2 } },
});

/**
 * `roles` with the fix of LOCAL_SPINE_ROLES / PREFAB_SPINE_ROLES applied: each fixed role whose clips all exist in `durations` replaces the
 * resolved one; `missing` lists the roles left as resolved because a clip is missing.
 * @param {any} roles resolveRoles output
 * @param {Record<string, any>|undefined} fix
 * @param {Record<string, number>} durations the skeleton's clips
 * @returns {{ roles: any, missing: string[] }}
 */
export function applyRoleFix(roles, fix, durations) {
  if (!fix) return { roles, missing: [] };
  const out = { ...roles };
  const missing = [];
  const has = (n) => n == null || Object.hasOwn(durations || {}, n);
  for (const [role, v] of Object.entries(fix)) {
    const names = typeof v === 'string' ? [v] : v && typeof v === 'object' ? [v.begin, v.loop, v.end, v.idle] : [null];
    if (names.every(has)) out[role] = v;
    else missing.push(role);
  }
  return { roles: out, missing };
}

/**
 * Spine metadata of extracted models (findLocalEnemyModels / findLocalTokenModels), parsed like processModels does — but
 * read only: the atlas is sized / pma-normalized in memory (extract.py already writes it so), nothing on disk changes.
 * Roles are resolved for skill index 0 (an enemy also for its numbered skill clips), like the web enemy and token models,
 * then LOCAL_SPINE_ROLES applied.
 * @param {string} root absolute public/assets directory
 * @param {Record<string, { dir: string, skel: string, atlas: string, pngs: string[] }>} found
 * @returns {Promise<{ meta: Record<string, LocalSpineMeta>, problems: string[] }>}
 */
export async function localSpineMeta(root, found) {
  const meta = {};
  const problems = [];
  const base = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
  for (const id of Object.keys(found || {}).sort()) {
    const m = found[id];
    try {
      const text = await readFile(join(root, m.atlas), 'utf8');
      const sizes = new Map();
      for (const page of atlasInfo(text).pages) {
        const sz = pngSize(await readFile(join(root, m.dir + page)));
        if (!sz) throw new Error(`invalid page ${page}`);
        sizes.set(page, sz);
      }
      const norm = normalizeAtlas(text, { pageSize: (p) => sizes.get(p) || null, pma: true });
      if (norm.missingSize.length) throw new Error(`cannot size pages ${norm.missingSize.join(',')}`);
      const info = atlasInfo(norm.text);
      if (!info.pages.length) throw new Error('atlas without pages');
      const sk = parseSkel(await readFile(join(root, m.skel)), info.regions);
      if (!sk.animations.length) throw new Error('skeleton has no animations');
      if (sk.missingRegions?.length) problems.push(`${id}: ${sk.missingRegions.length} attachment(s) not in atlas (e.g. ${sk.missingRegions[0]})`);
      const fixed = applyRoleFix(resolveRoles(sk.animations, { skillIndices: [0], numberedSkills: id.startsWith('enemy_'), durations: sk.durations }), LOCAL_SPINE_ROLES[id], sk.durations);
      if (fixed.missing.length) problems.push(`${id}: role fix not applied (clip missing) for ${fixed.missing.join(', ')}`);
      meta[id] = {
        skel: base(m.skel), atlas: base(m.atlas), textures: info.pages, pma: true,
        anims: fixed.roles,
        animations: sk.durations, events: sk.events, hits: sk.hits, bounds: sk.bounds,
      };
    } catch (e) {
      problems.push(`${id}: ${e.message}`);
    }
  }
  return { meta, problems };
}
/** The enemy models' name for localSpineMeta (one parse for every local model). */
export const localEnemySpineMeta = localSpineMeta;

/** Committed metadata of the local-client enemy models: tools/assets/local-enemy-spines.json. */
export const LOCAL_ENEMY_SPINES_FILE = 'tools/assets/local-enemy-spines.json';
/** Committed metadata of the local-client token models: tools/assets/local-token-spines.json. */
export const LOCAL_TOKEN_SPINES_FILE = 'tools/assets/local-token-spines.json';

/**
 * The `models` of a committed local-model metadata file (LOCAL_ENEMY_SPINES_FILE / LOCAL_TOKEN_SPINES_FILE: id →
 * LocalSpineMeta); {} when the file is missing or bad.
 * @param {string} path absolute path of the file
 * @returns {Promise<Record<string, LocalSpineMeta>>}
 */
export async function loadLocalSpines(path) {
  try {
    const j = JSON.parse(await readFile(path, 'utf8'));
    return j && typeof j.models === 'object' && j.models && !Array.isArray(j.models) ? j.models : {};
  } catch { return {}; }
}
/** loadLocalSpines of tools/assets/local-enemy-spines.json (the enemies' name for it). */
export const loadLocalEnemySpines = loadLocalSpines;

/**
 * @typedef {{ skel: string, atlas: string, textures: string[], pma: boolean, anims: any,
 *   animations: Record<string, number>, events: string[], hits: Record<string, number[]>, bounds: any }} SpineEntry
 */

/**
 * Run the whole Spine pipeline for every planned model.
 * @param {Map<string, any>} models plan.models
 * @param {object} o
 * @param {string} o.root absolute public/assets directory
 * @param {import('./downloader.mjs').Downloader} o.dl
 * @param {string} o.cachePath parse cache JSON path
 * @param {boolean} [o.download] false = only post-process what is on disk
 * @param {(rel: string) => boolean} [o.writable] whether a file on disk may be rewritten (normalized atlas) or deleted
 *   (corrupt skeleton); fetch-assets --add-only allows only the files this run downloaded
 * @param {(m:string)=>void} [o.log]
 * @returns {Promise<{ entries: Map<string, SpineEntry>, problems: string[] }>}
 */
export async function processModels(models, { root, dl, cachePath, download = true, writable = () => true, log = console.log }) {
  const problems = [];
  const list = [...models.values()];
  if (download) {
    const jobs = [];
    for (const m of list) jobs.push(m.skel, m.atlas, ...m.pngs);
    await dl.run(jobs, 'spine');
    // Atlases may reference more pages than the index lists.
    const extra = [];
    for (const m of list) {
      const text = await readFile(join(root, m.atlas.rel), 'utf8').catch(() => null);
      if (!text) continue;
      for (const page of atlasInfo(text).pages) {
        const rel = m.dir + safeName(page);
        if (!m.pngs.some((p) => p.rel === rel)) {
          // Same folder as the atlas actually came from (ledger), then the planned folders.
          const got = dl.ledger.files[m.atlas.rel]?.url;
          const dirs = [...new Set([got ? urlDir(got) : null, m.baseUrl, ...m.atlas.urls.map(urlDir)].filter(Boolean))];
          const a = { rel, urls: dirs.map((d) => d + encodeURIComponent(page)), kind: kindOf(page) };
          m.pngs.push(a);
          extra.push(a);
        }
      }
    }
    if (extra.length) await dl.run(extra, 'spine pages');
  }

  let cache = {};
  try { cache = JSON.parse(await readFile(cachePath, 'utf8')) || {}; } catch { cache = {}; }
  const nextCache = {};
  const entries = new Map();
  let parsed = 0; let cached = 0;
  let ledgerDirty = false;
  const t0 = Date.now();
  for (const m of list) {
    const skelAbs = join(root, m.skel.rel);
    const atlasAbs = join(root, m.atlas.rel);
    const skelSt = await fileStat(skelAbs);
    const atlasText = await readFile(atlasAbs, 'utf8').catch(() => null);
    if (!skelSt || !atlasText) { problems.push(`${m.key}: missing ${!skelSt ? 'skel' : 'atlas'}`); continue; }
    // Normalize the atlas against the real page sizes.
    const info0 = atlasInfo(atlasText);
    const sizes = new Map();
    let pagesOk = info0.pages.length > 0;
    for (const page of info0.pages) {
      const buf = await readFile(join(root, m.dir + safeName(page))).catch(() => null);
      const sz = buf ? pngSize(buf) : null;
      if (!sz) { pagesOk = false; problems.push(`${m.key}: missing/invalid page ${page}`); continue; }
      sizes.set(page, sz);
    }
    if (!pagesOk) continue;
    const norm = normalizeAtlas(atlasText, { pageSize: (p) => sizes.get(p) || null, pma: !!m.pma, renamePage: (p) => safeName(p) });
    if (norm.missingSize.length) { problems.push(`${m.key}: cannot size pages ${norm.missingSize.join(',')}`); continue; }
    if (norm.changed) {
      if (!writable(m.atlas.rel)) { problems.push(`${m.key}: atlas needs normalizing, left as it is (an existing file)`); continue; }
      await writeFile(atlasAbs + '.tmp', norm.text);
      await rename(atlasAbs + '.tmp', atlasAbs);
    }
    const atlasSt = await fileStat(atlasAbs);
    const info = atlasInfo(norm.text);
    // Parse the skeleton (cached by file size + mtime).
    const ck = `${m.skel.rel}|${skelSt.size}|${Math.floor(skelSt.mtimeMs)}|${atlasSt?.size}|${Math.floor(atlasSt?.mtimeMs ?? 0)}`;
    let sk = cache[m.skel.rel]?.key === ck ? cache[m.skel.rel].info : null;
    if (sk) cached++;
    else {
      try {
        sk = parseSkel(await readFile(skelAbs), info.regions);
        parsed++;
      } catch (e) {
        // A corrupt skeleton would otherwise be kept forever (its size matches the ledger):
        // delete it and forget it so the next online run downloads it again.
        if (!writable(m.skel.rel)) { problems.push(`${m.key}: skel parse failed (${e.message}); an existing file, left as it is`); continue; }
        problems.push(`${m.key}: skel parse failed (${e.message}); deleted, re-run to re-download`);
        try { await unlink(skelAbs); } catch { /* ignore */ }
        if (dl?.ledger?.files) delete dl.ledger.files[m.skel.rel];
        ledgerDirty = true;
        continue;
      }
    }
    nextCache[m.skel.rel] = { key: ck, info: sk };
    if (sk.missingRegions?.length) problems.push(`${m.key}: ${sk.missingRegions.length} attachment(s) not in atlas (e.g. ${sk.missingRegions[0]})`);
    if (!sk.animations.length) { problems.push(`${m.key}: skeleton has no animations`); continue; }
    const key = String(m.key);
    const id = key.startsWith('enemy:') ? key.slice('enemy:'.length) : key.startsWith('op:') ? key.split(':')[1] : null; // op:<char>:front|back
    // Downloaded token skins can share the default model's nonstandard clip names.
    const roleFix = key.startsWith('token:') ? LOCAL_SPINE_ROLES[key.slice('token:'.length)] : id ? PREFAB_SPINE_ROLES[id] : undefined;
    // an enemy's numbered skill clips are resolved too (anims.skills: the clip of each skill slot it casts, PR #275);
    // operators keep the pool's indices (their equipped skill picks among them)
    const fixed = applyRoleFix(resolveRoles(sk.animations, { skillIndices: m.skillIndices, numberedSkills: key.startsWith('enemy:'), durations: sk.durations }), roleFix, sk.durations);
    if (fixed.missing.length) problems.push(`${m.key}: role fix not applied (clip missing) for ${fixed.missing.join(', ')}`);
    const anims = fixed.roles;
    entries.set(m.key, {
      skel: assetUrl(m.skel.rel),
      atlas: assetUrl(m.atlas.rel),
      textures: info.pages.map((p) => assetUrl(m.dir + p)),
      pma: !!m.pma,
      anims,
      animations: sk.durations,
      events: sk.events,
      hits: sk.hits,
      bounds: sk.bounds,
    });
    if (Date.now() - t0 > 0 && (parsed + cached) % 100 === 0) log(`[spine] processed ${parsed + cached}/${list.length}`);
  }
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(nextCache));
  if (ledgerDirty && dl?.saveLedger) { try { await dl.saveLedger(); } catch { /* next run re-validates */ } }
  log(`[spine] models ok=${entries.size}/${list.length} (parsed ${parsed}, cached ${cached})`);
  return { entries, problems };
}
