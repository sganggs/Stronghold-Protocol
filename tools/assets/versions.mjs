// Presentation planning uses the union of official versions, keyed by art identity, never chess id.
// Chess/item ids are reused with different meanings between seasons (docs/DATA.md, Official versions).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSIONS } from '../../shared/versions.js';
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
    charModes: existsSync(fxPath) ? charModesFromIndex(JSON.parse(readFileSync(fxPath, 'utf8'))) : null });
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
  const enemies = Object.keys(all.enemies).filter((id) => !['enemy_9016_acstmr', 'enemy_9036_acweb'].includes(id)
    && needsModel('enemies', id));
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
