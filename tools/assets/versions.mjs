// Presentation planning uses the union of official versions, keyed by art identity, never chess id.
// Chess/item ids are reused with different meanings between seasons (docs/DATA.md, Official versions).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_VERSION, VERSIONS } from '../../shared/versions.js';
import { buildPlan, charModesFromIndex } from './plan.mjs';
import { indexAudio } from './audio.mjs';
import { collectLeaves } from './manifest.mjs';
import { localFxIndexPath } from './cache.mjs';
import { RAW } from './sources.mjs';

// Release packages omit maintainer profiles and pinned caches; their ordinary audio index remains sufficient.
const profilesUrl = new URL('../versions/profiles.mjs', import.meta.url);
const sourcesUrl = new URL('../versions/sources.mjs', import.meta.url);
const AUDIO_PROFILES = [];
if (existsSync(profilesUrl) && existsSync(sourcesUrl)) {
  const { loadProfile, pinnedShaOf } = await import(profilesUrl.href);
  const { sourceOfProfile } = await import(sourcesUrl.href);
  for (const v of VERSIONS.filter((v) => v.family === 'regulation')) {
    const { entry, profile } = await loadProfile(v.id);
    const sha = pinnedShaOf(profile, 'excel/audio_data.json');
    if (sha) AUDIO_PROFILES.push({ entry, tag: sourceOfProfile(profile).cacheTag(sha) });
  }
}

export const PRESENTATION_TABLES = ['chess', 'backups', 'tokens', 'enemies', 'items', 'bands', 'bonds', 'bosses', 'stages'];
// The official prefabs draw an effect/marker instead of a separate Spine (docs/ASSETS.md).
export const EFFECT_TOKENS = new Set(['token_10039_ulpia_block', 'token_10058_sbell2_icetgt',
  'token_10055_phatm2_mndclv', 'token_10065_demetr_dmtpos', 'token_10071_aglna2_agairp']);
// Enemies whose official prefab has no Spine renderer: 规程's enemy_9016_acstmr is an icon diamond (as on the default
// data) and enemy_9036_acweb 淤困之茧 draws its cocoon through effects (tools/assets/coverage.mjs reports both).
export const NO_SPINE_ENEMIES = new Set(['enemy_9016_acstmr', 'enemy_9036_acweb']);
// Their defaultskin prefabs have a Front renderer only, as do bard operators.
export const ONE_FACING_OPERATORS = new Set(['char_291_aglina', 'char_618_acrbot']);

export function versionAssetData(root) {
  return VERSIONS.filter((v) => existsSync(join(root, 'data', v.dir, 'chess.json'))).map((version) => ({
    version,
    ...Object.fromEntries(PRESENTATION_TABLES.map((name) => [name,
      JSON.parse(readFileSync(join(root, 'data', version.dir, `${name}.json`), 'utf8'))])),
  }));
}

export function presentationUnion(sets) {
  const operators = {}, enemies = {}, tokens = {}, bands = {}, items = {}, bonds = {};
  const modules = new Set();
  for (const d of sets) {
    for (const [id, rec] of Object.entries(d.enemies || {})) enemies[id] ??= rec;
    for (const [id, rec] of Object.entries({ ...d.backups?.tokens, ...d.tokens })) tokens[id] ??= rec;
    for (const [id, rec] of Object.entries(d.bands || {})) bands[id] ??= rec;
    for (const [id, rec] of Object.entries(d.bonds || {})) bonds[id] ??= rec;
    for (const rec of Object.values(d.items || {})) if (rec.iconId) items[rec.iconId] ??= rec;
    const add = (id, rec, forms) => {
      if (!id) return;
      const o = operators[id] ??= { name: rec.name, subProfessionId: rec.subProfessionId, nationId: rec.nationId, skills: [] };
      for (const form of forms) {
        for (const sk of [...(form.skills || []), ...(form.skill ? [form.skill] : [])]) {
          if (Number.isInteger(sk.index) && !o.skills.some((s) => s.skillId === sk.skillId)) {
            o.skills.push({ index: sk.index, skillId: sk.skillId, prefabId: sk.prefabId || sk.skillId, iconId: sk.iconId || sk.skillId });
          }
        }
        for (const m of form.modules || []) if (m.typeIcon) modules.add(m.typeIcon);
      }
    };
    for (const rec of Object.values(d.chess || {})) add(rec.charId, rec, [rec]);
    for (const [id, rec] of Object.entries(d.backups?.units || {})) add(id, rec, Object.values(rec.forms || {}));
  }
  for (const o of Object.values(operators)) o.skills.sort((a, b) => a.index - b.index);
  return { operators, enemies, tokens, bands, items, bonds, moduleTypes: [...modules].sort() };
}

/** Add-only preserves existing values (including arrays and null), while admitting newly planned keys. */
export function addManifestEntries(previous, next) {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return previous;
  if (!next || typeof next !== 'object' || Array.isArray(next)) return previous;
  const out = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    out[key] = Object.hasOwn(previous, key) ? addManifestEntries(previous[key], value) : value;
  }
  return out;
}

/** New season banks may precede the general audio mirror. Add their pinned, cached names without replacing old banks. */
export function versionAudioData(root, base) {
  const out = { ...base };
  for (const { entry, tag } of AUDIO_PROFILES) {
    if (!existsSync(join(root, 'data', entry.dir, 'chess.json'))) continue;
    const file = join(root, '.cache', `gamedata@${tag}`, 'excel/audio_data.json');
    if (!existsSync(file)) continue;
    const next = JSON.parse(readFileSync(file, 'utf8'));
    for (const key of ['soundFXBanks', 'bgmBanks']) {
      const banks = new Map((out[key] || []).map((b) => [b.name, b]));
      for (const bank of next[key] || []) if (!banks.has(bank.name)) banks.set(bank.name, bank);
      out[key] = [...banks.values()];
    }
    out.bankAlias = { ...next.bankAlias, ...out.bankAlias };
  }
  return out;
}

/**
 * Last round of the early 开战 track (rounds 1–7) and the last normal round (8–13). The same split as
 * public/js/audio.js COMBAT_TRACK_SWITCH_ROUND. Not imported from there: this file is a Node planner.
 */
const COMBAT_EARLY_LAST = 7;
const COMBAT_LATE_LAST = 13;

const bankList = (set) => [...set].map((b) => (typeof b === 'string' && b ? b : 'none')).sort().join(', ') || '(none)';

/** The single bank in `set`, or null when the set is empty, mixed, or a level named no bgm. */
function onlyBank(set) {
  if (set.size !== 1) return null;
  const [bank] = set;
  return typeof bank === 'string' && bank ? bank : null;
}

/**
 * One season's music, from its levels (`waves.json`: `kind`, `bgm` = the official bgmEvent, `bossId`, `usedBy`).
 * @param {string} season
 * @param {any[]} levels
 */
function analyzeSeasonMusic(season, levels) {
  const early = new Set();
  const late = new Set();
  const bosses = new Map();
  const unite = new Set();
  let escaped = 0;
  for (const lv of levels) {
    if (!lv || typeof lv !== 'object') continue;
    const bgm = typeof lv.bgm === 'string' && lv.bgm ? lv.bgm : null;
    if (lv.kind === 'normal') {
      for (const u of Array.isArray(lv.usedBy) ? lv.usedBy : []) {
        if (!u || typeof u !== 'object') continue;
        if (String(u.modeId || '').startsWith('mode_training')) continue;
        const round = Number(u.round);
        if (round >= 1 && round <= COMBAT_EARLY_LAST) early.add(bgm);
        else if (round > COMBAT_EARLY_LAST && round <= COMBAT_LATE_LAST) late.add(bgm);
      }
    } else if (lv.kind === 'boss' || lv.kind === 'hidden') {
      const ids = Array.isArray(lv.bossId) ? lv.bossId : [lv.bossId];
      for (const id of ids) {
        if (typeof id !== 'string' || !/^boss_\d+$/.test(id)) continue;
        const set = bosses.get(id) ?? new Set();
        set.add(bgm);
        bosses.set(id, set);
      }
    } else if (lv.kind === 'escaped') {
      escaped += 1;
      unite.add(bgm);
    }
  }
  const notes = [];
  /** @type {{ notes: string[], bosses: Record<string, string>, combat?: { early: string, late: string }, unite?: string|null }} */
  const spec = { notes, bosses: {} };
  const earlyBank = onlyBank(early);
  const lateBank = onlyBank(late);
  if (earlyBank && lateBank) spec.combat = { early: earlyBank, late: lateBank };
  else if (early.size || late.size) {
    notes.push(`season ${season}: 开战 BGM split does not hold (rounds 1–7: ${bankList(early)}; rounds 8–13: ${bankList(late)})`);
  }
  for (const id of [...bosses.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
    const bank = onlyBank(bosses.get(id));
    if (bank) spec.bosses[id] = bank;
    else notes.push(`season ${season}: boss ${id} BGM does not agree (${bankList(bosses.get(id))})`);
  }
  if (escaped) {
    const bank = onlyBank(unite);
    if (bank) spec.unite = bank;
    else if ([...unite].every((b) => b == null)) spec.unite = null;
    else notes.push(`season ${season}: 联防 BGM does not agree (${bankList(unite)})`);
  }
  return spec;
}

/**
 * Per-season BGM bank names for the asset plan, from each non-default version's built `waves.json`.
 * The default season (act2autochess, both sub-versions) is skipped: it stays the top-level `audio.bgm` / `audio.bossBgm`.
 * Two versions of one season are merged; a disagreement fails that season's split / boss / 联防 check and is a note.
 * @param {string} root repo root (ignored when `opts.versions` is passed)
 * @param {{ versions?: { id?: string, season: string, waves: any }[] }} [opts]
 *   `versions` replaces the registry read (tests). Each `waves` is a built waves object (level id → level).
 * @returns {{ seasons: Record<string, ReturnType<typeof analyzeSeasonMusic>> }}
 */
export function seasonMusicSpec(root, opts = {}) {
  /** @type {{ season: string, waves: any }[]} */
  let versions;
  if (Array.isArray(opts.versions)) versions = opts.versions;
  else {
    versions = [];
    for (const v of VERSIONS) {
      if (v.season === DEFAULT_VERSION) continue;
      const file = join(root, 'data', v.dir, 'waves.json');
      if (!existsSync(file)) continue;
      versions.push({ season: v.season, waves: JSON.parse(readFileSync(file, 'utf8')) });
    }
  }
  const bySeason = new Map();
  for (const v of versions) {
    if (!v || v.season === DEFAULT_VERSION || typeof v.season !== 'string' || !v.season) continue;
    const waves = v.waves;
    const levels = waves && typeof waves === 'object' && !Array.isArray(waves) ? Object.values(waves) : [];
    const bucket = bySeason.get(v.season);
    if (bucket) bucket.push(...levels);
    else bySeason.set(v.season, [...levels]);
  }
  const seasons = {};
  for (const [season, levels] of bySeason) seasons[season] = analyzeSeasonMusic(season, levels);
  return { seasons };
}

/** `literal(value)` from tools/assets/manifest.mjs, or undefined when `node` is an ordinary object. */
function literalValue(node) {
  if (!node || typeof node !== 'object') return undefined;
  const syms = Object.getOwnPropertySymbols(node);
  if (syms.length !== 1 || !Object.hasOwn(node, syms[0])) return undefined;
  return node[syms[0]];
}

const fileNameOf = (leaf) => {
  const rel = leaf?.alts?.[0]?.rel;
  return typeof rel === 'string' ? rel.split('/').pop() : null;
};

/** A plan leaf `{ intro?, loop }` → basenames. `literal(null)` (联防 with no bgmEvent) stays null. */
function trackFiles(node) {
  if (node == null) return null;
  const unwrapped = literalValue(node);
  if (unwrapped !== undefined) return unwrapped == null ? null : trackFiles(unwrapped);
  if (typeof node !== 'object') return null;
  const loop = fileNameOf(node.loop);
  if (!loop) return null;
  const intro = fileNameOf(node.intro);
  return intro ? { intro, loop } : { loop };
}

/**
 * The planned `audio.seasons` as ids → file names (template leaves, not resolved hashed URLs). For the dry-run log.
 * @param {any} seasons plan.template.audio.seasons
 * @returns {Record<string, { bgm: any, bossBgm: Record<string, any> }>|null}
 */
export function seasonMusicFiles(seasons) {
  if (!seasons || typeof seasons !== 'object') return null;
  const out = {};
  for (const [season, slot] of Object.entries(seasons)) {
    const bgm = {};
    if (slot?.bgm && Object.hasOwn(slot.bgm, 'lobby')) bgm.lobby = trackFiles(slot.bgm.lobby);
    if (Array.isArray(slot?.bgm?.combatAlts)) bgm.combatAlts = slot.bgm.combatAlts.map(trackFiles);
    if (slot?.bgm && Object.hasOwn(slot.bgm, 'unite')) bgm.unite = trackFiles(slot.bgm.unite);
    const bossBgm = {};
    for (const [id, track] of Object.entries(slot?.bossBgm || {})) bossBgm[id] = trackFiles(track);
    out[season] = { bgm, bossBgm };
  }
  return out;
}

/** Reuse the normal sound plan; local AudioClips fill only absent audio leaves, without a network request. */
export function versionAudioJobs(root, all) {
  const inputs = { assets07: 'docs/research/07-assets.json', ops03: 'docs/research/03-operators.json',
    enemies05: 'docs/research/05-enemies.json', maps05: 'docs/research/05-maps.json',
    audioData: '.cache/gamedata/excel/audio_data.json', charword: '.cache/gamedata/excel/charword_table.json',
    modelsData: '.cache/ark-models/models_data.json' };
  if (Object.values(inputs).some((file) => !existsSync(join(root, file)))) return [];
  const data = Object.fromEntries(Object.entries(inputs).map(([key, file]) => [key, JSON.parse(readFileSync(join(root, file), 'utf8'))]));
  const fxPath = localFxIndexPath(root);
  const plan = buildPlan({ ...data, audio: indexAudio(versionAudioData(root, data.audioData)), extraOperators: all.operators,
    extraEnemyIds: Object.keys(all.enemies), extraTokenIds: Object.keys(all.tokens), optionalVoice: true,
    charModes: existsSync(fxPath) ? charModesFromIndex(JSON.parse(readFileSync(fxPath, 'utf8'))) : null,
    seasonMusic: seasonMusicSpec(root) });
  const jobs = new Map();
  for (const { leaf } of collectLeaves(plan.template.audio)) {
    if (leaf.alts.some((a) => existsSync(join(root, 'public/assets', a.rel)))) continue;
    for (const alt of leaf.alts) {
      const url = alt.urls.find((u) => u.startsWith(RAW.aa2voice));
      if (!url) continue;
      const source = decodeURIComponent(url.slice(RAW.aa2voice.length)).replace(/\.mp3$/, '');
      const parts = source.split('/'), clip = parts.pop();
      const bundle = /^voice(?:_|\/)/.test(source) ? parts.join('/') : source;
      jobs.set(alt.rel, { bundle: `audio/sound_beta_2/${bundle}.ab`, clip, path: alt.rel,
        source: `dyn/audio/sound_beta_2/${source}.ogg` });
    }
  }
  return [...jobs.values()];
}

/** Exact sprite names and destinations; the local extractor never guesses or substitutes art identities. */
export function versionAssetJobs(root) {
  const sets = versionAssetData(root), all = presentationUnion(sets);
  const assets = JSON.parse(readFileSync(join(root, 'data/assets.json'), 'utf8'));
  const missing = (url) => !url || !existsSync(join(root, 'public', url));
  const incomplete = (sp) => !sp || [sp.skel, sp.atlas, ...(sp.textures || [])].some(missing) || !sp.textures?.length;
  const golden = new Set(sets.flatMap((d) => Object.values(d.chess)).filter((c) =>
    c.assets?.avatarGolden?.endsWith('_2') || c.isGolden && c.assets?.avatar?.endsWith('_2')).map((c) => c.charId));
  const operators = Object.keys(all.operators).filter((id) => {
    const c = assets.chars[id];
    return missing(c?.avatar || `/assets/char/avatar/${id}.png`)
      || missing(c?.portrait || `/assets/char/portrait/${id}_1.png`)
      || incomplete(c?.spine?.front)
      || all.operators[id].subProfessionId !== 'bard' && !ONE_FACING_OPERATORS.has(id) && incomplete(c?.spine?.back)
      || golden.has(id) && (missing(c?.avatarE2) || missing(c?.portraitE2));
  });
  const needsModel = (kind, id) => {
    const rec = assets[kind]?.[id];
    if (rec?.spineLocal) {
      const s = rec.spineLocal;
      return [s.skel, s.atlas, ...(s.textures || [])].some((file) =>
        !existsSync(join(root, 'public/assets/local', s.group, file)));
    }
    return incomplete(rec?.spine);
  };
  const enemies = Object.keys(all.enemies).filter((id) => !NO_SPINE_ENEMIES.has(id) && needsModel('enemies', id));
  const tokens = Object.keys(all.tokens).filter((id) => id.startsWith('token_') && !EFFECT_TOKENS.has(id) && needsModel('tokens', id));
  const sprites = [];
  const add = (bundles, name, path) => {
    if (!existsSync(join(root, 'public/assets', path))) sprites.push({ bundles, name, path });
  };
  for (const id of Object.keys(all.enemies)) add(['spritepack/icon_enemies_*.ab'], id, `enemy/icon/${id}.png`);
  for (const id of Object.keys(all.tokens).filter((id) => id.startsWith('token_'))) {
    add(['spritepack/ui_char_avatar_*.ab'], id, `token/avatar/${id}.png`);
  }
  for (const op of Object.values(all.operators)) for (const sk of op.skills) {
    add(['spritepack/skill_icons_*.ab'], `skill_icon_${sk.iconId}`, `skill/${sk.iconId.replace(/[^a-zA-Z0-9._-]/g, '_')}.png`);
  }
  for (const [id, band] of Object.entries(all.bands)) add(['ui/autochess/[uc]autochesscommon.ab'], band.iconId, `band/${id}.png`);
  for (const [id, bond] of Object.entries(all.bonds)) add(['ui/autochess/[uc]autochesscommon.ab'], bond.iconId, `bond/${id}.png`);
  for (const id of Object.keys(all.items)) add(['ui/autochess/[uc]autochesscommon.ab'], id, `item/${id}.png`);
  for (const type of all.moduleTypes) add(['arts/ui/uniequiptype/icon_hub.ab'], type.toLowerCase(), `module/${type.toLowerCase()}.png`);
  return { operators, enemies, tokens, sprites: [...new Map(sprites.map((s) => [s.path, s])).values()],
    audio: versionAudioJobs(root, all) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(JSON.stringify(versionAssetJobs(process.argv[2] || process.cwd())));
}
