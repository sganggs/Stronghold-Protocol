// Compact records → the existing DATA.md shapes (DESIGN §32.5). No official record is replaced here.
import { RECORD_SCHEMA, OPERATOR_ART_SCHEMA, OPERATOR_ORIGIN_SCHEMA } from './recordsSchema.js';
import { composeUnitRecord, statusKey } from '../standIn.js';
import { clone, object, own, problem, jsonProblems, mergeData, recordId, namespace, RECORD_MAPS } from './dataUtils.js';
import { validateSkillSpec, matchesSchema, MODS_SCHEMA } from './skillSpec.js';

// [ASSUMED] Simple playable defaults for new operators only; explicit form values win (DESIGN §32.5).
const stats = { maxHp: 1000, atk: 100, def: 0, res: 0, cost: 10, blockCnt: 1, bat: 1, aspd: 100,
  respawnTime: 70, spRecovery: 1, hpRecoveryPerSec: 0, moveSpeed: 1, tauntLevel: 0, massLevel: 0, deployLimit: 1, deckStack: 0 };
// Compact text follows the builder's {bb:0%} convention; gameplay numbers remain untouched.
function text(x = {}) {
  const raw = x?.descRaw ?? x?.desc ?? '';
  const bb = Object.fromEntries(Object.entries(x?.bb ?? {}).map(([k,v]) => [k.toLowerCase(), v]));
  const filled = raw.replace(/\{(-?)([^{}:]+)(?::(0(?:\.0{1,6})?%?))?\}/g, (match, neg, key, format) => {
    const n = bb[key.toLowerCase()];
    if (typeof n !== 'number') return x?.bbStr?.[key] ?? match;
    const value = (neg ? -n : n) * (format?.endsWith('%') ? 100 : 1);
    const decimals = format?.replace('%','').split('.')[1]?.length ?? 0;
    return (format ? value.toFixed(decimals) : String(value)) + (format?.endsWith('%') ? '%' : '');
  });
  return { bb: {}, bbStr: {}, rangeGrid: null, ...x, desc: filled.replace(/<[@$][^>]*>|<\/>/g, ''), descRaw: filled };
}
const fail = (code, at, msg) => { throw problem(code, at, msg); };

/** Optional operator metadata, also checked by the CLI without composing or executing plugin code. */
export function operatorMetadataProblems(r, pluginId, data = null) {
  const out = [];
  if (r?.op !== 1) return out;
  const bad = (code, at, msg) => out.push(problem(code, at, msg));
  if (r.chess?.hidden !== undefined && typeof r.chess.hidden !== 'boolean') bad('PLUGIN_RECORD_HIDDEN', 'chess.hidden', 'boolean required');
  if (r.chess?.ids !== undefined) {
    const ids = r.chess.ids;
    if (!object(ids) || Object.keys(ids).length !== 2 || !recordId(ids.normal, pluginId, 'chess_x') || !recordId(ids.elite, pluginId, 'chess_x') || ids.normal === ids.elite || r.chess.id != null)
      bad('PLUGIN_RECORD_PAIR', 'chess.ids', 'distinct normal/elite ids in this plugin namespace; do not also set chess.id');
  }
  if (r.art !== undefined && !matchesSchema(r.art, OPERATOR_ART_SCHEMA)) bad('PLUGIN_RECORD_ART', 'art', 'ref or assets must contain asset ids, never paths or URLs');
  if (r.origin !== undefined) {
    if (!matchesSchema(r.origin, OPERATOR_ORIGIN_SCHEMA)) bad('PLUGIN_RECORD_ORIGIN', 'origin', 'charId or chessId required');
    else if (data) {
      const { charId, chessId } = r.origin;
      // [ASSUMED] Provenance names installed official records only; it does not inherit stats, kits or art.
      const chess = chessId && !chessId.startsWith('chess_x_') ? data.chess?.[chessId] : null;
      const char = charId && !charId.startsWith('char_x_') && (data.backups?.units?.[charId] || Object.values(data.chess ?? {}).some(c => c?.charId === charId));
      if (chessId && !chess || charId && !char || chess && charId && chess.charId !== charId)
        bad('PLUGIN_RECORD_ORIGIN', 'origin', 'official source missing or its character differs');
    }
  }
  return out;
}

function behavior(kit, talentMods, pluginId, validateDsl) {
  const out = {};
  if (kit === 'generic' || kit == null) { /* generic fallback */ }
  else if (!object(kit) || Object.keys(kit).length !== 1) fail('PLUGIN_RECORD_TYPE', 'kit', 'choose one kit source');
  else if (typeof kit.ref === 'string') out.kitRef = kit.ref;
  else if (object(kit.spec)) {
    const errors = validateSkillSpec(kit.spec);
    if (errors.length) throw errors[0];
    out.skillSpec = kit.spec;
  } else if (kit.dsl != null) {
    // [ASSUMED] Omitting spec.pluginId is allowed. A written one must be this host: it cannot spend another
    // plugin's budget. The builder stamps the host id on the record and does not rewrite the author's spec (DESIGN §32.7).
    // (the DSL validator is the sim's — server/sim/content/dsl/validate.js — handed in by the content-set builder:
    // shared code does not import the engine)
    if (typeof validateDsl !== 'function') fail('PLUGIN_RECORD_TYPE', 'kit.dsl', 'a DSL kit needs the content-set builder (no validator given)');
    const checked = validateDsl(kit.dsl, { bounds: true });
    if (!checked.ok) {
      const p = checked.problems[0];
      fail(p.code, p.path ? `kit.dsl.${p.path}` : 'kit.dsl', p.zh);
    }
    if (kit.dsl.pluginId != null && kit.dsl.pluginId !== pluginId) fail('PLUGIN_DSL_PLUGIN_ID', 'kit.dsl.pluginId', 'spec pluginId must match the host plugin');
    out.dsl = kit.dsl;
    out.pluginId = pluginId;
  } else fail('PLUGIN_RECORD_TYPE', 'kit', 'kit must be generic, ref, a JSON spec, or dsl');
  if (talentMods != null) {
    if (out.kitRef) fail('PLUGIN_SKILL_SPEC', 'talentMods', 'talentMods belong with a JSON SkillSpec, not kit.ref');
    if (!matchesSchema(talentMods, MODS_SCHEMA)) fail('PLUGIN_SKILL_SPEC', 'talentMods', 'unknown or ill-typed permanent mod');
    out.talentMods = talentMods;
  }
  return out;
}

function operator(data, r, pluginId, validateDsl) {
  if (r.op !== 1 || !recordId(r.charId, pluginId, 'char_x')) fail('PLUGIN_RECORD_ID', 'charId', 'namespaced charId required');
  if (!['chess', 'diy', 'both'].includes(r.as) || typeof r.name !== 'string' || !r.name
    || !['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL'].includes(r.profession)
    || !['MELEE', 'RANGED'].includes(r.position) || typeof r.subProfessionId !== 'string'
    || !Number.isInteger(r.rarity) || r.rarity < 1 || r.rarity > 6) fail('PLUGIN_RECORD_TYPE', r.charId, 'operator identity, profession, position, rarity and as are required');
  if (!object(r.forms?.normal) || !object(r.forms?.elite)) fail('PLUGIN_RECORD_TYPE', r.charId, 'normal and elite forms required');
  const b = behavior(r.kit, r.talentMods, pluginId, validateDsl);
  // [ASSUMED] A borrowed voice uses the bank ID, including that bank's browser voice preference.
  const art = r.art?.ref ?? r.charId;
  const unit = { charId: r.charId, name: r.name, appellation: r.appellation ?? r.name, rarity: r.rarity,
    profession: r.profession, subProfessionId: r.subProfessionId, subProfessionName: r.subProfessionName ?? '',
    position: r.position, nationId: r.nationId ?? null, isNotObtainable: false,
    assets: { avatar: art, avatarGolden: art, portrait: art, portraitGolden: art, spine: art, subProfIcon: `sub_${r.subProfessionId}_icon`,
      ...(r.art?.ref ? { voice: r.art.ref } : {}), ...r.art?.assets },
    moduleNames: {}, standsIn: [], forms: {}, ...b, ...(r.origin ? { origin: clone(r.origin) } : {}) };
  const form = (which, status) => {
    const f = r.forms[which];
    if (!object(f.stats) || !Array.isArray(f.rangeGrid)) fail('PLUGIN_RECORD_TYPE', r.charId, 'each form needs stats and rangeGrid');
    const skills = f.skills ?? r.skills;
    if (!Array.isArray(skills) || !skills.length || skills.filter(s => s.default === true).length !== 1) fail('PLUGIN_RECORD_SKILLS', r.charId, 'skills need exactly one default');
    const expanded = skills.map((s, index) => {
      if (!object(s) || !recordId(s.skillId, pluginId, 'skx') && !b.kitRef) fail('PLUGIN_RECORD_ID', r.charId, 'skillId must be namespaced (kitRef may retain the official skill ids)');
      if (s.skillSpec != null && validateSkillSpec(s.skillSpec).length) fail('PLUGIN_SKILL_SPEC', s.skillId, 'invalid per-skill spec');
      const { default: isDefault, ...fields } = s;
      return { skillId: s.skillId, iconId: s.skillId, name: '', level: status.skillLevel, index, ...text({}),
        skillType: 'MANUAL', durationType: 'NONE', duration: 0, spType: 'INCREASE_WITH_TIME', spCost: 0, initSp: 0,
        maxChargeTime: 1, increment: 1, rangeId: null, prefabId: null, overrideTokenKey: null,
        trigger: { rule: 'DEFAULT', rawRule: 'DEFAULT', customRangeGrid: null }, ...text(fields), isDefault };
    });
    const dmgType = f.dmgType ?? r.dmgType ?? (r.profession === 'MEDIC' ? 'heal' : r.profession === 'CASTER' ? 'arts' : 'phys');
    const attackKind = f.attackKind ?? r.attackKind ?? (dmgType === 'heal' ? 'heal' : r.position === 'RANGED' ? 'ranged' : 'melee');
    // [ASSUMED] A compact MELEE form may set placeOnRanged: true without 「可以放置于远程位」.
    // composeUnitRecord copies that boolean onto the shop chess and a 自选 piece (GitHub #676).
    // Any other value, and the flag on a RANGED operator, is not stored.
    const placeOnRanged = r.position === 'MELEE' && f.placeOnRanged === true;
    return { status, stats: { ...stats, ...f.stats }, immunities: {}, rangeId: null, rangeGrid: f.rangeGrid,
      dmgType, attackKind, projectile: r.projectile ?? (attackKind === 'melee' ? 'none' : dmgType === 'heal' ? 'orb' : dmgType === 'arts' ? 'bolt' : 'arrow'),
      canHitFly: r.canHitFly ?? (attackKind === 'ranged' && r.subProfessionId !== 'fortress'), targetPriority: r.targetPriority ?? null,
      trait: text(f.trait ?? r.trait), talents: (f.talents ?? r.talents ?? []).map((t, index) => ({ index, name: '', tokenKey: null, hidden: false, fromModule: false, ...text(t) })),
      skills: expanded, modules: [], tokens: [], displayTokens: [], ...b,
      ...(placeOnRanged ? { placeOnRanged: true } : {}) };
  };
  if (r.as !== 'diy') {
    const c = r.chess, tier = c?.tier, econ = data.config?.economy;
    if (!Number.isInteger(tier) || tier < 1 || tier > 6 || !Array.isArray(c.bonds) || !c.bonds.length || !econ?.chessStatus?.[tier]) fail('PLUGIN_RECORD_TYPE', r.charId, 'chess needs tier 1–6 and bonds');
    const stem = c.id ?? r.charId.replace(/^char_x_/, 'chess_x_');
    const baseId = c.ids?.normal ?? stem.replace(/_[ab]$/, '') + '_a', goldenId = c.ids?.elite ?? baseId.replace(/_a$/, '_b');
    if (baseId === goldenId) fail('PLUGIN_RECORD_ID', 'chess.ids', 'normal and elite ids must differ');
    if (!recordId(baseId, pluginId, 'chess_x') || !recordId(goldenId, pluginId, 'chess_x')) fail('PLUGIN_RECORD_ID', stem, 'invalid chess id');
    for (const golden of [false, true]) {
      const id = golden ? goldenId : baseId, which = golden ? 'elite' : 'normal';
      if (own(data.chess, id)) fail('PLUGIN_RECORD_EXISTS', id, 'use patches to change existing records');
      const quality = golden ? 'golden' : 'normal', status = clone(econ.chessStatus[tier][quality]);
      const f = form(which, status), skillIndex = f.skills.find(s => s.isDefault).index;
      const identity = { chessId: id, baseId, goldenId, isGolden: golden, tier, identifier: c.identifier ?? 10000,
        shopSortId: c.shopSortId ?? 10000, isHidden: c.hidden === true, isDiy: false, visible: c.hidden !== true, chessType: 'PRESET',
        backup: { charId: r.charId, tmplId: null, skillIndex, uniEquipId: null, potRank: 0 },
        // garrisonIds, like price, is one value for both pieces or { normal, golden } (official pairs: garrison_N_a / _b)
        bonds: c.bonds, garrisonIds: object(c.garrisonIds) ? c.garrisonIds[quality] ?? [] : c.garrisonIds ?? [],
        price: object(c.price) ? c.price[quality] : c.price ?? econ.chessPrice?.[tier]?.[quality],
        sellPrice: c.sellPrice ?? econ.chessSell?.[tier]?.[quality] ?? 1, upgradeNum: golden ? 0 : econ.mergeCount ?? 3,
        upgradeChessId: golden ? null : goldenId, status };
      data.chess[id] = composeUnitRecord(identity, unit, f, { skillIndex });
      delete data.chess[id].skill.isDefault;
    }
    for (const id of c.bonds) {
      if (!data.bonds?.[id]) fail('PLUGIN_DATA_REFERENCE', id, 'unknown bond');
      data.bonds[id].members = [...data.bonds[id].members, baseId];
      if (c.hidden !== true) data.bonds[id].visibleMembers = [...data.bonds[id].visibleMembers, baseId];
    }
  }
  if (r.as !== 'chess') {
    const backups = data.backups;
    if (!backups?.diy || own(backups.units, r.charId)) fail('PLUGIN_RECORD_EXISTS', r.charId, 'DIY data missing or unit already exists');
    for (const slot of Object.keys(backups.diy.slots)) for (const c of [data.chess[slot], data.chess[backups.diy.slots[slot].goldenId]]) {
      const f = form(c.isGolden ? 'elite' : 'normal', clone(c.status));
      unit.forms[statusKey(c.status)] = { ...f, skills: f.skills.map(({ isDefault, ...s }) => s) };
    }
    backups.units[r.charId] = unit;
    // [ASSUMED] Hidden operators with both identities are also absent from owned DIY selection.
    if (!r.chess?.hidden) backups.diy.ownedPool.push(r.charId);
    backups.diy.operators[r.charId] = { name: r.name, rarity: r.rarity, profession: r.profession, subProfessionId: r.subProfessionId,
      obtainable: !r.chess?.hidden, powers: r.powers ?? [], bonds: r.chess?.bonds ?? [data.config.economy.fallbackBondId] };
  }
}

/** General records: { file, id, base?, set? | value? }; modes inherit an official base. */
function record(data, r, pluginId) {
  if (r.file === 'choices') {
    const cards = data.choices?.cards?.[r.kind];
    const source = cards?.find(c => c.effectId === r.base);
    if (!['bounty', 'tactic'].includes(r.kind) || !source || !data.effects[r.base]) fail('PLUGIN_DATA_REFERENCE', r.id, 'choice needs a bounty/tactic base');
    if (!recordId(r.id, pluginId, 'effect_x')) fail('PLUGIN_RECORD_ID', r.id, 'namespaced effect id required');
    if (own(data.effects, r.id)) fail('PLUGIN_RECORD_EXISTS', r.id, 'choice effect already exists');
    data.effects[r.id] = mergeData(data.effects[r.base], r.effect ?? {});
    data.effects[r.id].effectId = r.id;
    cards.push({ ...mergeData(source, r.set ?? {}), effectId: r.id });
    return;
  }
  const isMode = r.file === 'modes';
  const map = isMode ? data.config?.modes : data[r.file];
  const [prefix, field] = isMode ? ['mode_x', 'modeId'] : RECORD_MAPS[r.file] ?? [];
  if (!prefix || !object(map) || !recordId(r.id, pluginId, prefix)) fail('PLUGIN_RECORD_ID', r.id, 'unknown table or invalid namespace');
  if (own(map, r.id)) fail('PLUGIN_RECORD_EXISTS', r.id, 'use patches to change existing records');
  const source = r.base ?? r.special ?? r.value?.effectRef ?? r.set?.effectRef;
  if (source && !own(map, source)) fail('PLUGIN_DATA_REFERENCE', r.id, `base ${source} does not exist`);
  if (isMode && (!source || source.startsWith('mode_x_'))) fail('PLUGIN_DATA_REFERENCE', r.id, 'mode base must be an official mode');
  if (!object(r.set ?? r.value ?? {})) fail('PLUGIN_RECORD_TYPE', r.id, 'record value must be an object');
  const rec = mergeData(source ? map[source] : {}, r.set ?? r.value ?? {});
  rec[field] = r.id;
  if (isMode) {
    rec.base = source;
    if (data.choices?.schedule?.[source]) data.choices.schedule[r.id] = clone(data.choices.schedule[source]);
  }
  if (['items', 'bands'].includes(r.file)) {
    if (!source || map[source].effectRef) fail('PLUGIN_DATA_REFERENCE', r.id, 'effectRef/base must name an existing official record');
    rec.effectRef = source;
    // [ASSUMED] Compact items are single, non-merging records; complete pairs use add patches (DESIGN §32.5).
    if (r.file === 'items') {
      rec.baseId = r.id; rec.goldenId = null; rec.isGolden = false; rec.upgradeNum = 0;
      rec.upgradeChessId = null; rec.mergeable = false;
    }
  }
  if (r.file === 'enemies') {
    if (r.special && !data.enemies[r.special]) fail('PLUGIN_DATA_REFERENCE', r.id, 'special must name an existing enemy kit record');
    if (r.special || source) rec.effectRef = r.special ?? source;
    Object.assign(rec, { name: rec.name ?? r.id, level: rec.level ?? 0, rank: rec.rank ?? 'NORMAL', applyWay: rec.applyWay ?? 'MELEE',
      abilities: rec.abilities ?? [], talents: rec.talents ?? { bb: {}, bbStr: {} }, skills: rec.skills ?? [], summons: rec.summons ?? [],
      acTypes: rec.acTypes ?? [], acType: rec.acType ?? null });
    rec.stats = { ...stats, rangeRadius: 0, lpr: 1, dmgType: 'phys', motion: 'WALK', immunities: {}, ...rec.stats };
  }
  if (r.file === 'waves') {
    Object.assign(rec, { kind: rec.kind ?? 'normal', solo: rec.solo ?? false, branches: rec.branches ?? {}, extraRoutes: rec.extraRoutes ?? [], overrides: rec.overrides ?? {}, devices: rec.devices ?? [], usedBy: rec.usedBy ?? [] });
    rec.totalCount = (rec.spawns ?? []).filter(s => !s.action && !s.unharmful).reduce((n, s) => n + s.count, 0);
  }
  if (r.file === 'stages') Object.assign(rec, { name: rec.name ?? r.id, size: [19, 21], weight: rec.weight ?? 50, active: rec.active ?? true,
    modes: rec.modes ?? [], devices: rec.devices ?? [], mapChars: rec.mapChars ?? [], special: rec.special ?? {}, runes: rec.runes ?? [], globalBuffs: rec.globalBuffs ?? [], options: rec.options ?? {}, config: rec.config ?? {} });
  map[r.id] = rec;
}

/**
 * Pure and atomic; compact operators or generic records, in declared order. `validateDsl`: the sim's DSL validator
 * (server/sim/content/dsl/validate.js), needed only by an operator whose kit is `{ dsl }`.
 * @param {any} data @param {any} records @param {{ pluginId?: string | null, validateDsl?: Function | null }} [opts]
 */
export function expandRecords(data, records, { pluginId = null, validateDsl = null } = {}) {
  const problems = jsonProblems(records, 'records');
  if (!Array.isArray(records)) problems.push(problem('PLUGIN_RECORD_TYPE', 'records', 'records must be an array'));
  if (!pluginId || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(pluginId)) problems.push(problem('PLUGIN_RECORD_ID', 'pluginId', 'plugin id required'));
  if (problems.length) return { data, problems };
  const out = clone(data);
  for (const [i, r] of records.entries()) {
    try {
      const metadata = operatorMetadataProblems(r, pluginId, out);
      if (metadata.length) { problems.push(...metadata); continue; }
      if (!matchesSchema(r, RECORD_SCHEMA)) fail('PLUGIN_RECORD_TYPE', `records[${i}]`, 'object required');
      if (r.op === 1) operator(out, r, pluginId, validateDsl); else record(out, r, pluginId);
    }
    catch (e) { problems.push(e?.code ? e : problem('PLUGIN_RECORD_TYPE', `records[${i}]`, e.message)); }
  }
  return { data: problems.length ? data : out, problems };
}
export { namespace };
