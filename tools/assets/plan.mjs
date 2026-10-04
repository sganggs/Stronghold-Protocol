// Builds the asset plan: which files the game needs, where they come from and
// where they go, as a *manifest template* that mirrors data/assets.json.
//
// Template leaves:
//   { alts: [{ rel, urls[], kind, bytes? }, …] }  one file; the first alternative
//        that ends up on disk wins (later alts are fallbacks: other URLs for the
//        same file, or other sounds of the same bank);
//   { model: '<key>' }  a Spine model (skel + atlas + page PNGs) from plan.models;
//   literal(value)  a value emitted as it is (no files: enemies[id].spineLocal).
// Inputs are the research JSONs (docs/research/03, 05, 07), the official
// audio_data.json and Ark-Models' models_data.json.
//
// Scope (research 07 §1, DESIGN §0): all 138 pool charIds (incl. backup
// operators), the 20 pool tokens, every enemy that can appear in an
// act2autochess match (07 enemy list ∪ act1autochess wave/boss levels used by
// act2 modes ∪ bosses ∪ their summons ∪ enemy units spawned by operator kits),
// the 23 bonds, 59 shop items, 40 bands,
// default-skill icons, profession icons, autochess UI sprites (the 36 battle
// emotes and the 19 玩法说明 pages included: UI_EXTRAS), BGM and SFX.

import { RAW, joinUrl, safeName, urlBase, urlDir } from './sources.mjs';
import { kindOf } from './formats.mjs';
import { pickUnitSfx, UI_SFX, BATTLE_SFX, resolveSpec } from './audio.mjs';
import { literal } from './manifest.mjs';
import { EMOTE_CATALOG } from '../../shared/constants.js';

/**
 * Enemies whose Spine no community dump carries: the web model is another enemy's (research 07 §5.6). Their official
 * models come from the local client only (tools/local-extract ENEMY_SPINES): `localEnemySpines` adds them as the
 * optional `spineLocal` overlay, which the client draws when data/local-assets.json lists its files (user feedback
 * after 0.1.0, D3: 灼热源石虫 / 炽焰源石虫 were drawn as the plain 源石虫 everywhere).
 */
export const ENEMY_SPINE_ALIAS = Object.freeze({
  enemy_1305_mhslim: 'enemy_1007_slime',
  enemy_1305_mhslim_2: 'enemy_1007_slime',
});

/** Loading illustrations referenced by act2autochess modeDataDict (non-training). */
const LOADING_USED = new Set(['loading_ac_core', 'loading_ac_prototype', 'loading_ac_hard', 'loading_ac_abyss']);

const PROFESSIONS = ['caster', 'medic', 'pioneer', 'sniper', 'special', 'support', 'tank', 'warrior'];

/**
 * The 19 official 玩法说明 (tutorial) pages, in the reading order of public/js/ui/guide.js GUIDE_CHAPTERS (a test keeps
 * the two identical): 基础规则 home 1–9, 调度手册 shop 1–6, 进阶图鉴 handbook 1–4.
 */
export const GUIDE_PAGES = Object.freeze([
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `autochess_home_${i}`),
  ...[1, 2, 3, 4, 5, 6].map((i) => `autochess_shop_${i}`),
  ...[1, 2, 3, 4].map((i) => `autochess_handbook_${i}`),
]);

/**
 * Extra UI sprites (not in 07-assets.json groups): [group, key, path under ArknightsAssets2 cn assets/dyn].
 * The last two blocks are art that used to come from the local client only (tools/local-extract, DESIGN §13) and that
 * the mirror carries too (GitHub issue #42: a server without the client showed default emote icons): the 36 battle
 * emotes (shared/constants.js EMOTE_CATALOG; the bundle ui/emoticon/theme/[uc]<themeId>.ab → its icon/<picId>.png) and
 * the 19 玩法说明 pages (arts/guidebookpages/[pack]autochess.ab, 1024² like the local copies: displayed at 16:9). Their
 * manifest keys are the data/local-assets.json group and name — ui['emoticon/<dir>/<picId>'], ui['guide/<key>'] — so
 * the client looks both up by the same names (public/js/data.js artUrls: the local file first, then this copy).
 */
export const UI_EXTRAS = (() => {
  const L = [];
  const mc = 'ui/autochess/[uc]autochessouter/modechoice/auto_chess_mode_choice_state/';
  for (const m of ['normal', 'hard', 'abyss', 'funny']) L.push(['modeChoice', `${m}_rhodes_island`, `${mc}${m}_rhodes_island.png`]);
  const br = 'ui/autochess/[uc]autochessouter/battleready/auto_chess_battle_ready_state/';
  for (const k of ['bg_mountain1', 'bg_mountain2', 'bg_terrain', 'bg_ring', 'rhodes', 'rhodes_white', 'rhodes_outline']) L.push(['battleReady', k, `${br}${k}.png`]);
  const bn = 'arts/ui/[uc]battlecommon/ui_battle_new/';
  for (const k of ['btn_speed_1x', 'btn_speed_2x', 'btn_pause', 'slider_hp_back', 'slider_hp_fill', 'attack_range_attack', 'attack_range_stand']) L.push(['battleUi', k, `${bn}${k}.png`]);
  L.push(['battleUi', 'boss_avatar_bg', `${bn}enemybossinfo/sprite_enemy_boss_avatar_bg.png`]);
  L.push(['battleUi', 'skill_ready', 'arts/ui/[uc]battlecommon/ui_battle/sprite_skill_ready.png']);
  L.push(['skillIcon', 'empty', 'arts/ui/[uc]charcommon/skills/empty_skill.png']);
  L.push(['skillIcon', 'empty_large', 'arts/ui/[uc]charcommon/skills/empty_skill_large.png']);
  L.push(['entry', 'season_logo_settle', 'activity/[uc]act2autochess/arts/seasonlogo/season_logo_settle_game.png']);
  const ec = 'ui/autochess/[uc]autochessbattle/effectchoose/';
  for (const k of ['bg_circle', 'bg_grad', 'bottom', 'deco_glow_top', 'plus', 'square_1', 'square_2', 'square_fill_1', 'square_fill_2', 'tip_glow', 'tip_wait', 'title']) {
    L.push(['effectChoose', k, `${ec}autochess_battle_effect_choose_panel/${k}.png`]);
  }
  for (const k of ['bg_normal', 'bg_selected', 'btn_bg', 'btn_icon', 'select_frame', 'select_glow']) L.push(['effectChoose', `card_${k}`, `${ec}card_small_item/${k}.png`]);
  for (const k of ['head_bg', 'head_outline']) L.push(['effectChoose', `avatar_${k}`, `${ec}card_avatar_item/${k}.png`]);
  const er = 'ui/autochess/[uc]autochessbattle/equipreplace/equip_replace_dialog/equip_replace_';
  for (const k of ['bg', 'arrow_head', 'arrow_line', 'avatart_bg', 'avatart_frame', 'close', 'replace_icon', 'opiton_bg']) L.push(['equipReplace', k, `${er}${k}.png`]);
  const bd = 'ui/autochess/[uc]autochessbattle/hud/dialog/autochess_hud_bond_detail_dialog/';
  for (const k of ['active_icon', 'active_stack_bg', 'arrow', 'detail_bg', 'matte_circle', 'title_char_icon']) L.push(['bondDetail', k, `${bd}${k}.png`]);
  const pr = 'ui/autochess/[uc]autochessbattle/prepready/';
  for (const k of ['cancel_bg', 'cancel_icon', 'player_bg', 'player_frame', 'player_ready', 'ready_bg', 'ready_frame', 'ready_icon']) L.push(['prepReady', k, `${pr}panel_prep_ready/${k}.png`]);
  L.push(['prepReady', 'countdown_arrow', `${pr}countdown_arrow.png`]);
  const si = 'ui/autochess/[uc]autochessouter/stageinfo/auto_chess_stage_info_state/';
  for (const k of ['img_title_mode_abyss', 'img_title_mode_funny', 'img_title_mode_hard', 'img_title_mode_normal', 'btn_confirm', 'btn_confirmed']) L.push(['stageInfo', k, `${si}${k}.png`]);
  for (const e of EMOTE_CATALOG) L.push([`emoticon/${e.dir}`, e.picId, `ui/emoticon/theme/[uc]${e.themeId}/icon/${e.picId}.png`]);
  for (const k of GUIDE_PAGES) L.push(['guide', k, `arts/guidebookpages/[pack]autochess/${k}.png`]);
  return Object.freeze(L.map((x) => Object.freeze(x)));
})();

/** Renames of research 07 `arts` groups to manifest UI groups. */
const ARTS_GROUPS = Object.freeze({
  rarityStars: 'rarity', rarityStarsYellow: 'rarityYellow', eliteIcon: 'elite', eliteIconLarge: 'eliteLarge',
  campLogo: 'campLogo', loadingIllust: 'loading', battleCommon: 'battle', act2Entry: 'entry', itemRarityBg: 'itemRarity',
});

// ---------------------------------------------------------------------------
// helpers

/**
 * One download alternative.
 * @param {string} rel path under public/assets
 * @param {string|string[]} urls
 * @param {number} [bytes] expected size
 */
function alt(rel, urls, bytes) {
  const a = { rel, urls: [].concat(urls).filter((u) => typeof u === 'string' && u), kind: kindOf(rel) };
  if (Number.isInteger(bytes) && bytes > 0) a.bytes = bytes;
  return a;
}

/** A leaf with the given alternatives (null alternatives are dropped). */
function leaf(...alts) {
  const list = alts.flat().filter((a) => a && a.urls && a.urls.length);
  return list.length ? { alts: list } : null;
}

/** Sound path under sound_beta_2 → alternative under public/assets/audio/<sub>. */
function soundAlt(path, sub = 'sfx') {
  const rel = `audio/${sub}/` + path.split('/').map(safeName).join('/');
  return alt(rel, joinUrl(RAW.aa2voice, path));
}

function soundLeaf(paths, sub = 'sfx', max = 4) {
  return leaf((paths || []).slice(0, max).map((p) => soundAlt(p, sub)));
}

/**
 * A unit's SFX roles (pickUnitSfx) → { roles: { attack?, hit?, die?, born? } sound leaves, mix: { [role]: { p?, vol? } }
 * | null } — the official play chance / volume of each role's bank (audio.mjs bankMix; community report #30: 猎狗's
 * attack bank is 80 % silence). The caller stores `mix` last in the unit's entry (sfx.units[id].mix).
 */
function unitSounds(audio, sfx) {
  const roles = {};
  let mix = null;
  for (const r of ['attack', 'hit', 'die', 'born']) {
    if (!sfx[r]) continue;
    roles[r] = soundLeaf(sfx[r]);
    const m = typeof audio.mixOf === 'function' ? audio.mixOf(sfx[r]) : null;
    if (m) (mix || (mix = {}))[r] = m;
  }
  return { roles, mix };
}

/** Expected bytes for a 07 {url, bytes} record when it matches `url`. */
function bytesOf(rec, url) {
  return rec && typeof rec === 'object' && rec.url === url && Number.isInteger(rec.bytes) ? rec.bytes : undefined;
}

/** Local file stem for a skeleton URL or file name ('…/char_102_texas.skel' → 'char_102_texas'). */
function skelStem(urlOrName) {
  return safeName(urlBase(urlOrName).replace(/\.skel$/i, ''));
}

/** Collect every enemy key referenced under a wave/branch structure. */
function walkKeys(node, add) {
  if (Array.isArray(node)) { for (const x of node) walkKeys(x, add); return; }
  if (node && typeof node === 'object') {
    if (typeof node.key === 'string') add(node.key);
    for (const v of Object.values(node)) walkKeys(v, add);
  }
}

// ---------------------------------------------------------------------------
// id sets

/**
 * Per-charId skill indices used by the pool (0-based; primary first).
 * @param {any} ops03 docs/research/03-operators.json
 * @returns {Map<string, number[]>}
 */
export function skillIndicesByChar(ops03) {
  const primary = new Map();
  const all = new Map();
  const add = (id, idx, isPrimary) => {
    if (typeof id !== 'string' || !Number.isInteger(idx) || idx < 0) return;
    if (!all.has(id)) all.set(id, new Set());
    all.get(id).add(idx);
    if (isPrimary && !primary.has(id)) primary.set(id, idx);
  };
  const chess = Array.isArray(ops03?.chess) ? ops03.chess : [];
  for (const c of chess) if (c.charId) add(c.charId, c.defaultSkillIndex, !c.isGolden);
  for (const c of chess) if (c.backup?.charId) add(c.backup.charId, c.backup.skillIndex, true);
  const out = new Map();
  for (const [id, set] of all) {
    const p = primary.has(id) ? primary.get(id) : Math.min(...set);
    out.set(id, [p, ...[...set].filter((i) => i !== p).sort((a, b) => a - b)]);
  }
  return out;
}

/**
 * Every enemy id that can appear in an act2autochess match.
 * @param {{ assets07:any, enemies05:any, maps05:any, ops03?:any }} r
 *   ops03 (optional): enemy units spawned by operator kits (e.g. 隐德来希's S3 summons
 *   `enemy_5601_entlec` 心烛 via a talent blackboard `take_extra_enemy_key`)
 * @returns {string[]} sorted ids
 */
export function collectEnemyIds({ assets07, enemies05, maps05, ops03 }) {
  const known = (id) => !!(enemies05?.enemies?.[id] || assets07?.enemies?.[id]);
  const set = new Set(Object.keys(assets07?.enemies || {}));
  const add = (k) => { if (typeof k === 'string' && /^enemy_\d+_[a-z0-9_]+$/i.test(k)) set.add(k); };
  for (const c of Array.isArray(ops03?.chess) ? ops03.chess : []) {
    const kit = JSON.stringify([c?.skill ?? null, c?.talents ?? null, c?.tokens ?? null]);
    for (const m of kit.match(/enemy_\d+_[a-z0-9_]+/gi) || []) add(m);
  }
  for (const lv of Object.values(maps05?.roundLevels || {})) {
    const usedBy = Array.isArray(lv?.usedBy) ? lv.usedBy : [];
    if (usedBy.length && usedBy.every((u) => String(u).startsWith('mode_training'))) continue; // tutorial is out of scope
    for (const ref of lv?.enemyDbRefs || []) add(Array.isArray(ref) ? ref[0] : ref);
    walkKeys(lv?.waves, add);
    walkKeys(lv?.branches, add);
  }
  for (const b of Object.values(enemies05?.bosses || {})) { add(b?.enemyId); for (const s of b?.spawns || []) add(s); }
  // Closure over summons: randomEnemyAttribute spawns + `enemy_key` blackboard references.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...set]) {
      const e = enemies05?.enemies?.[id];
      if (!e) continue;
      const refs = new Set(e.ac?.rand?.spawns || []);
      for (const m of JSON.stringify([e.skills ?? null, e.talent ?? null]).match(/enemy_\d+_[a-z0-9_]+/gi) || []) refs.add(m);
      for (const r of refs) if (!set.has(r) && known(r)) { set.add(r); changed = true; }
    }
  }
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// plan

/**
 * Build the asset plan.
 * @param {object} p
 * @param {any} p.assets07 docs/research/07-assets.json
 * @param {any} p.ops03 docs/research/03-operators.json
 * @param {any} p.enemies05 docs/research/05-enemies.json
 * @param {any} p.maps05 docs/research/05-maps.json
 * @param {ReturnType<import('./audio.mjs').indexAudio>} p.audio indexed audio_data.json
 * @param {any} p.modelsData Ark-Models models_data.json
 * @param {string[]} [p.extraEnemyIds] more enemy ids that can spawn (e.g. keys of data/enemies.json)
 * @param {string[]} [p.extraTokenIds] more token ids (e.g. token_* keys of data/tokens.json)
 * @param {Record<string,string>} [p.extraHandbook] enemyId → handbook/model id (e.g. from data/bosses.json)
 * @param {Record<string, import('./spine.mjs').LocalSpineMeta>} [p.localEnemySpines] metadata of the enemy models the
 *   local client has (the committed tools/assets/local-enemy-spines.json, never the disk): each planned enemy listed
 *   gets `spineLocal` = { group: 'spine/enemy/<id>', ...meta } beside its web `spine`
 * @returns {{ template: any, models: Map<string, any>, notes: string[] }}
 */
export function buildPlan({ assets07, ops03, enemies05, maps05, audio, modelsData, extraEnemyIds = [], extraTokenIds = [], extraHandbook = {}, localEnemySpines = {} }) {
  const notes = [];
  /** @type {Map<string, any>} */
  const models = new Map();
  const skillIdx = skillIndicesByChar(ops03);

  // --- Spine model helpers -------------------------------------------------
  const addModel = (key, def) => { if (!models.has(key)) models.set(key, { key, ...def }); return { model: key }; };
  const fexliModel = (key, kind, dir, rec, skillIndices) => {
    // rec: 07 { skel:{url,bytes}|url|url[], atlas, png } — arrays are candidate folders (same order for all three)
    const us = (x) => (Array.isArray(x) ? x : [typeof x === 'string' ? x : x?.url]).filter((v) => typeof v === 'string' && v);
    const b = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x.bytes : undefined);
    if (!us(rec?.skel).length || !us(rec?.atlas).length || !us(rec?.png).length) return null;
    const stem = skelStem(us(rec.skel)[0]);
    return addModel(key, {
      kind, dir, pma: false, skillIndices,
      baseUrl: urlDir(us(rec.atlas)[0]),
      skel: alt(`${dir}${stem}.skel`, us(rec.skel), b(rec.skel)),
      // pixi-spine finds the atlas by swapping the .skel extension: keep the same stem.
      atlas: { ...alt(`${dir}${stem}.atlas`, us(rec.atlas), b(rec.atlas)), mutable: true },
      pngs: [alt(dir + safeName(urlBase(us(rec.png)[0])), us(rec.png), b(rec.png))],
    });
  };

  // --- operators -----------------------------------------------------------
  const chars = {};
  const skills = {};
  const skillsById = {};
  const unitsSfx = {};
  const charIds = Object.keys(assets07?.operators || {}).sort();
  for (const id of charIds) {
    const o = assets07.operators[id];
    // DESIGN §16 operator loadouts: any skill of the character can be equipped — the icons, skill SFX and Spine skill
    // clips of every skill index (the pool's primary index first, as before)
    const idx0 = skillIdx.get(id) || [0];
    const idx = [...idx0, ...(o.skills || []).map((k) => k.index).filter((i) => Number.isInteger(i) && i >= 0 && !idx0.includes(i)).sort((a, b) => a - b)];
    const c = {};
    c.avatar = leaf(alt(`char/avatar/${id}.png`, o.avatar?.e0e1?.url, o.avatar?.e0e1?.bytes));
    if (o.avatar?.e2?.url) c.avatarE2 = leaf(alt(`char/avatar/${id}_2.png`, o.avatar.e2.url, o.avatar.e2.bytes));
    c.portrait = leaf(alt(`char/portrait/${id}_1.png`, o.portrait?.e0e1?.url, o.portrait?.e0e1?.bytes));
    if (o.portrait?.e2?.url) c.portraitE2 = leaf(alt(`char/portrait/${id}_2.png`, o.portrait.e2.url, o.portrait.e2.bytes));
    c.spine = {};
    const front = fexliModel(`op:${id}:front`, 'op', `spine/op/${id}/front/`, o.battleSpine?.front, idx);
    if (front) c.spine.front = front; else notes.push(`${id}: no Front battle Spine in research data`);
    const back = fexliModel(`op:${id}:back`, 'op', `spine/op/${id}/back/`, o.battleSpine?.back, idx);
    if (back) c.spine.back = back;
    chars[id] = c;
    // skill icons (+ skill SFX) of every skill index; normal-mode attack / impact sounds only (a ranged operator's own
    // projectile banks projectile_chr_<name> as fallbacks — user playtest #4 item 6, audio.mjs pickUnitSfx)
    const short = id.replace(/^char_\d+_/, '');
    const sfx = pickUnitSfx(audio.unitBanks.get(id), { operator: true, projectile: {
      born: audio.bank(`battle.ON_PROJECTILE_BORN.projectile_chr_${short}`), hit: audio.bank(`battle.ON_PROJECTILE_HIT.projectile_chr_${short}`) } });
    const { roles: u, mix } = unitSounds(audio, sfx);
    const skillSfx = {};
    for (const i of idx) {
      const s = (o.skills || []).find((k) => k.index === i);
      if (!s) { notes.push(`${id}: skill index ${i} missing in research data`); continue; }
      const iconId = s.iconId || s.skillId;
      if (s.icon?.url && !skills[iconId]) skills[iconId] = leaf(alt(`skill/${safeName(iconId)}.png`, s.icon.url, s.icon.bytes));
      if (s.skillId) skillsById[s.skillId] = iconId;
      const ss = audio.skillBanks.get(s.skillId)?.get('ON_SKILL_START');
      if (ss?.length) skillSfx[String(i)] = soundLeaf(ss);
    }
    const primarySkill = skillSfx[String(idx[0])];
    if (primarySkill) u.skill = primarySkill;
    if (Object.keys(skillSfx).length > 1) u.skills = skillSfx;
    if (mix) u.mix = mix;
    if (Object.keys(u).length) unitsSfx[id] = u;
  }

  // --- tokens --------------------------------------------------------------
  const chessById = new Map((ops03?.chess || []).map((c) => [c.chessId, c]));
  const tokens = {};
  const tokenIds = new Set(Object.keys(assets07?.tokens || {}));
  for (const id of extraTokenIds) if (typeof id === 'string' && /^token_\d+_[a-z0-9_]+$/i.test(id)) tokenIds.add(id);
  for (const id of [...tokenIds].sort()) {
    // Tokens unknown to research 07: default avatar/Spine locations (misses are tolerated).
    const t = assets07?.tokens?.[id] ?? {
      avatar: { url: `${RAW.yuanyan}avatar/${id}.png` },
      battleSpineDefault: null,
      battleSpineSkinVariantsOnly: [id],
    };
    const usedBy = ops03?.tokensUsedByPool?.[id]?.usedByChess || [];
    const ownerChess = usedBy.map((cid) => chessById.get(cid)).find(Boolean);
    const entry = { owner: ownerChess?.charId || ownerChess?.backup?.charId || null };
    entry.avatar = t.avatar?.url ? leaf(alt(`token/avatar/${id}.png`, t.avatar.url, t.avatar.bytes)) : null;
    let model = null;
    if (t.battleSpineDefault) {
      model = fexliModel(`token:${id}`, 'token', `spine/token/${id}/`, t.battleSpineDefault, [0]);
    } else if (Array.isArray(t.battleSpineSkinVariantsOnly) && t.battleSpineSkinVariantsOnly.length) {
      // Skin-variant models live in a `Spine/` folder, or `Front/` for directional ones.
      const v = t.battleSpineSkinVariantsOnly[0];
      const bases = ['Spine', 'Front'].map((f) => `${RAW.fexli}spine/${encodeURIComponent(id)}/${encodeURIComponent(v)}/${f}/${encodeURIComponent(v)}`);
      model = fexliModel(`token:${id}`, 'token', `spine/token/${id}/`, {
        skel: bases.map((b) => b + '.skel'), atlas: bases.map((b) => b + '.atlas'), png: bases.map((b) => b + '.png'),
      }, [0]);
      if (model) entry.spineVariant = v;
    }
    entry.spine = model;
    tokens[id] = entry;
    const { roles: u, mix } = unitSounds(audio, pickUnitSfx(audio.unitBanks.get(id)));
    if (mix) u.mix = mix;
    if (Object.keys(u).length) unitsSfx[id] = u;
  }

  // --- enemies -------------------------------------------------------------
  const handbookOf = new Map();
  for (const b of Object.values(enemies05?.bosses || {})) if (b?.enemyId && b.handbookId && b.handbookId !== b.enemyId) handbookOf.set(b.enemyId, b.handbookId);
  for (const [eid, hb] of Object.entries(extraHandbook || {})) if (typeof hb === 'string' && hb !== eid && !handbookOf.has(eid)) handbookOf.set(eid, hb);
  const mdData = modelsData?.data || {};
  const enemyDir = modelsData?.storageDirectory?.Enemy || 'models_enemies';
  const pick = (v) => (Array.isArray(v) ? (v.find((x) => typeof x === 'string' && !x.includes('$')) ?? v[0]) : v);
  const arkModel = (eid) => {
    const key = eid.replace(/^enemy_/, '');
    const al = mdData[key]?.assetList;
    const skel = pick(al?.['.skel']); const atlas = pick(al?.['.atlas']); const png = pick(al?.['.png']);
    if (![skel, atlas, png].every((x) => typeof x === 'string' && x)) return null;
    const base = `${RAW.arkModels}${enemyDir}/${encodeURIComponent(key)}/`;
    const rec07 = assets07?.enemies?.[eid]?.battleSpine;
    const dir = `spine/enemy/${eid}/`;
    const stem = skelStem(skel);
    const mk = (file, r, rel) => alt(rel ?? dir + safeName(file), base + encodeURIComponent(file), bytesOf(r, base + encodeURIComponent(file)));
    return addModel(`enemy:${eid}`, {
      kind: 'enemy', dir, pma: true, skillIndices: [0], baseUrl: base,
      skel: mk(skel, rec07?.skel, `${dir}${stem}.skel`),
      atlas: { ...mk(atlas, rec07?.atlas, `${dir}${stem}.atlas`), mutable: true },
      pngs: [mk(png, rec07?.png)],
    });
  };
  const baseIdOf = (eid) => { const m = /^(enemy_\d+_[a-z0-9]+?)_\d+$/i.exec(eid); return m ? m[1] : null; };
  const enemyIdSet = new Set(collectEnemyIds({ assets07, enemies05, maps05, ops03 }));
  for (const id of extraEnemyIds) if (typeof id === 'string' && /^enemy_\d+_[a-z0-9_]+$/i.test(id)) enemyIdSet.add(id);
  // Boss handbook ids (their own icon/model ids) are addressable too.
  for (const hb of handbookOf.values()) if (/^enemy_\d+_[a-z0-9_]+$/i.test(hb)) enemyIdSet.add(hb);
  const enemyIds = [...enemyIdSet].sort();
  const enemies = {};
  for (const id of enemyIds) {
    const e = {};
    const icon07 = assets07?.enemies?.[id]?.icon;
    const iconAlts = [alt(`enemy/icon/${id}.png`, `${RAW.yuanyan}enemy/${id}.png`, bytesOf(icon07, `${RAW.yuanyan}enemy/${id}.png`))];
    for (const other of [handbookOf.get(id), baseIdOf(id)]) if (other) iconAlts.push(alt(`enemy/icon/${id}.png`, `${RAW.yuanyan}enemy/${other}.png`));
    e.icon = leaf(iconAlts);
    // Spine: own model, else alias chain (research 07 §5.6).
    let spine = arkModel(id);
    if (!spine) {
      const seen = new Set([id]);
      const queue = [ENEMY_SPINE_ALIAS[id], baseIdOf(id), handbookOf.get(id)].filter(Boolean);
      while (!spine && queue.length) {
        const cand = queue.shift();
        if (seen.has(cand)) continue;
        seen.add(cand);
        spine = arkModel(cand);
        if (spine) e.spineAliasOf = cand;
        else queue.push(...[ENEMY_SPINE_ALIAS[cand], baseIdOf(cand), handbookOf.get(cand)].filter(Boolean));
      }
      if (!spine) notes.push(`${id}: no enemy Spine upstream (client draws the icon, if any, or a glyph)`);
      else notes.push(`${id}: Spine aliased to ${e.spineAliasOf}`);
    }
    e.spine = spine;
    // the official model from the local client, drawn instead of `spine` when the extraction is installed (optional)
    const loc = localEnemySpines && Object.hasOwn(localEnemySpines, id) ? localEnemySpines[id] : null;
    if (loc && typeof loc === 'object') {
      e.spineLocal = literal({ group: `spine/enemy/${id}`, ...loc });
      notes.push(`${id}: official Spine from the local client when extracted (spineLocal)`);
    }
    enemies[id] = e;
    let banks = audio.unitBanks.get(id);
    for (const other of [handbookOf.get(id), e.spineAliasOf, baseIdOf(id)]) {
      if (banks?.size) break;
      if (other) banks = audio.unitBanks.get(other);
    }
    const { roles: u, mix } = unitSounds(audio, pickUnitSfx(banks));
    if (mix) u.mix = mix;
    if (Object.keys(u).length) unitsSfx[id] = u;
  }

  // --- bonds / items / bands -------------------------------------------------
  const bonds = {};
  for (const [bondId, b] of Object.entries(assets07?.bonds || {})) {
    bonds[bondId] = leaf(alt(`bond/${bondId}.png`, b.icon?.url, b.icon?.bytes), b.fallbackCampLogo ? alt(`bond/${bondId}.png`, b.fallbackCampLogo) : null);
  }
  const items = {};
  for (const [trapId, it] of Object.entries(assets07?.items || {})) items[trapId] = leaf(alt(`item/${trapId}.png`, it.icon?.url, it.icon?.bytes));
  const bands = {};
  for (const [bandId, b] of Object.entries(assets07?.bands || {})) bands[bandId] = leaf(alt(`band/${bandId}.png`, b.icon?.url, b.icon?.bytes));

  // --- professions ----------------------------------------------------------
  const prof = { icon: {}, large: {}, battlecard: {}, sub: {} };
  for (const p of PROFESSIONS) {
    const i = assets07?.arts?.professionIcon?.[p];
    if (i) prof.icon[p] = leaf(alt(`prof/icon_${p}.png`, i));
    const l = assets07?.arts?.professionIconLargeWhite?.[p];
    if (l) prof.large[p] = leaf(alt(`prof/large_${p}.png`, l));
  }
  for (const p of [...PROFESSIONS, 'token']) {
    prof.battlecard[p] = leaf(alt(`prof/battlecard_${p}.png`, joinUrl(RAW.aa2, `arts/ui/[uc]battlecommon/ui_battle_new/battlecard/icon_profession_${p}.png`)));
  }
  for (const o of Object.values(assets07?.operators || {})) {
    const sub = o.subProfessionId;
    if (typeof sub === 'string' && sub && !prof.sub[sub] && o.subProfessionIcon) prof.sub[sub] = leaf(alt(`prof/sub/${safeName(sub)}.png`, o.subProfessionIcon));
  }

  // --- UI ------------------------------------------------------------------
  const ui = {};
  const addUi = (group, key, url) => {
    const k = safeName(key);
    const name = `${group}/${k}`;
    if (!ui[name] && url) ui[name] = leaf(alt(`ui/${group}/${k}.png`, url));
  };
  for (const [group, entries] of Object.entries(assets07?.autochessUi || {})) {
    for (const [key, url] of Object.entries(entries || {})) addUi(group, key, url);
  }
  const nations = new Set(Object.values(assets07?.operators || {}).map((o) => o.nationId).filter(Boolean));
  const logos = new Set(['logo_rhodes', ...[...nations].map((n) => `logo_${n}`)]);
  for (const b of Object.values(assets07?.bonds || {})) if (b.fallbackCampLogo) logos.add(urlBase(b.fallbackCampLogo).replace(/\.png$/i, ''));
  for (const [src, group] of Object.entries(ARTS_GROUPS)) {
    for (const [key, url] of Object.entries(assets07?.arts?.[src] || {})) {
      if (src === 'campLogo' && !logos.has(key)) continue;
      if (src === 'loadingIllust' && !LOADING_USED.has(key)) continue;
      addUi(group, key, url);
    }
  }
  for (const [group, key, path] of UI_EXTRAS) addUi(group, key, joinUrl(RAW.aa2, path));

  // --- audio ----------------------------------------------------------------
  const bgmLeaf = (bankName) => {
    const b = audio.bgm(bankName);
    if (!b?.loop) { notes.push(`BGM bank ${bankName} not found`); return null; }
    const out = { loop: soundLeaf([b.loop], 'bgm', 1) };
    if (b.intro) out.intro = soundLeaf([b.intro], 'bgm', 1);
    return out;
  };
  // BGM files are flattened to audio/bgm/<basename>.
  const flatBgm = (node) => {
    if (!node) return node;
    for (const k of Object.keys(node)) {
      const l = node[k];
      if (l?.alts) for (const a of l.alts) a.rel = 'audio/bgm/' + safeName(a.rel.split('/').pop());
    }
    return node;
  };
  const bgm = {
    lobby: flatBgm(bgmLeaf('sys.ON_ACTIVITY_LOADED.act2autochess')),
    prep: flatBgm(bgmLeaf('battle.ON_GAME_READY.act1autochess_shop')),
    combat: flatBgm(bgmLeaf('battle.ON_GAME_READY.act1autochess_shop')),
    boss: flatBgm(bgmLeaf('battle.ON_GAME_READY.rglk1phantomcastle')),
  };
  const bossBgm = {};
  for (const lv of Object.values(maps05?.roundLevels || {})) {
    if (typeof lv?.bgm !== 'string') continue;
    for (const u of lv.usedBy || []) {
      const m = /\(boss:(boss_\d+)\)/.exec(String(u));
      if (m && !bossBgm[m[1]] && !String(u).startsWith('mode_training')) bossBgm[m[1]] = flatBgm(bgmLeaf(`battle.ON_GAME_READY.${lv.bgm}`));
    }
  }
  const sfxUi = {};
  for (const [name, spec] of Object.entries(UI_SFX)) { const l = soundLeaf(resolveSpec(spec, audio.bank)); if (l) sfxUi[name] = l; else notes.push(`UI SFX ${name}: no sound`); }
  const sfxBattle = {};
  for (const [name, spec] of Object.entries(BATTLE_SFX)) { const l = soundLeaf(resolveSpec(spec, audio.bank)); if (l) sfxBattle[name] = l; else notes.push(`battle SFX ${name}: no sound`); }

  const template = {
    chars, enemies, tokens, bonds, items, bands, skills, skillsById, ui, prof,
    audio: { bgm, bossBgm: Object.fromEntries(Object.entries(bossBgm).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))), sfx: { ui: sfxUi, battle: sfxBattle, units: unitsSfx } },
  };
  return { template, models, notes };
}
