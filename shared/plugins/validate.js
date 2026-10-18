// Shared DATA.md reference checks, extracted verbatim from build-data (DESIGN §32.5).
import { statusKey, standInRecord, unitForm } from '../standIn.js';
/** Recursively find non-finite numbers (NaN/Infinity would silently become null in JSON). */
function findNonFinite(obj, path, out) {
  if (typeof obj === 'number') { if (!Number.isFinite(obj)) out.push(path); return; }
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) { obj.forEach((v, i) => findNonFinite(v, `${path}[${i}]`, out)); return; }
  for (const [k, v] of Object.entries(obj)) findNonFinite(v, `${path}.${k}`, out);
}

export function validateReferences(f, { officialOwnedSkills = true } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);
  const { config, chess, bonds, garrisons, items, bands, effects, choices, enemies, factions, waves, stages, bosses, tokens, backups } = f;
  for (const [name, obj] of Object.entries(f)) {
    const bad = [];
    findNonFinite(obj, name, bad);
    bad.slice(0, 5).forEach((p) => err(`non-finite number at ${p}`));
  }
  for (const c of Object.values(chess)) {
    if (!chess[c.baseId]) err(`chess ${c.chessId}: baseId missing`);
    if (c.goldenId && !chess[c.goldenId]) err(`chess ${c.chessId}: goldenId missing`);
    for (const b of c.bonds) if (!bonds[b]) err(`chess ${c.chessId}: bond ${b} missing`);
    for (const g of c.garrisonIds) if (!garrisons[g]) err(`chess ${c.chessId}: garrison ${g} missing`);
    for (const t of c.tokens) if (!tokens[t]) err(`chess ${c.chessId}: token ${t} missing`);
    for (const t of c.talents || []) if (t.tokenKey && !c.tokens.includes(t.tokenKey)) err(`chess ${c.chessId}: talent token ${t.tokenKey} not in tokens`);
    if (c.isDiy) continue;
    if (!c.stats) err(`chess ${c.chessId}: no stats`);
    if (!c.skill) err(`chess ${c.chessId}: no resolvable skill`);
    if (!Array.isArray(c.rangeGrid)) err(`chess ${c.chessId}: no range grid`);
    // DESIGN §16 loadout choices
    if (!Array.isArray(c.skills) || c.skills.filter((s) => s.isDefault).length !== 1 || c.skills.find((s) => s.isDefault)?.skillId !== c.skill?.skillId) err(`chess ${c.chessId}: skills[] without exactly one default = skill`);
    if (c.modules && (c.modules.filter((m) => m.isDefault).length !== (c.module?.active ? 1 : 0) || !c.statsBase || !c.traitBase || !c.talentsBase)) err(`chess ${c.chessId}: inconsistent module choices`);
    // The old `placement` string is not a field. 高台 is the boolean `placeOnRanged` (build-data, from the Chinese
    // trait), read by shared/highGround.js, which still matches the Simplified line when the flag is absent.
    if (c.placement !== undefined) err(`chess ${c.chessId}: placement is not a data field`);
    if (c.placeOnRanged !== undefined && c.placeOnRanged !== true) err(`chess ${c.chessId}: placeOnRanged must be true when present`);
    if (c.placeOnRanged === true && c.position !== 'MELEE') err(`chess ${c.chessId}: placeOnRanged on a non-MELEE record`);
  }
  // 补位 / 自选 (data/backups.json, DATA.md §18): a PRESET chess is its own backup; every NORMAL chess (both forms)
  // composes into its stand-in (shared/standIn.js standInRecord) with the chess's skill and module; every DIY slot is a
  // DIY chess and every prototype pick of its tier has a form for both slot statuses; derived bonds exist
  if (backups) {
    for (const c of Object.values(chess)) {
      const b = c.backup;
      if (c.chessType === 'PRESET' && b?.charId !== c.charId) err(`chess ${c.chessId}: a PRESET chess's backup must be itself`);
      if (c.chessType === 'DIY' && b?.charId !== null) err(`chess ${c.chessId}: a DIY slot has no backup`);
      if (c.chessType !== 'NORMAL') continue;
      const r = standInRecord(c, backups);
      if (!r) { err(`chess ${c.chessId}: no stand-in ${b?.charId}@${statusKey(c.status)} in backups.json`); continue; }
      if (!r.stats || !Array.isArray(r.rangeGrid) || !r.trait) err(`chess ${c.chessId}: stand-in ${b.charId} without stats / range / trait`);
      if (r.skill?.index !== b.skillIndex || r.skills.filter((s) => s.isDefault).length !== 1) err(`chess ${c.chessId}: stand-in skill ${b.skillIndex} is not unlocked at ${statusKey(c.status)}`);
      if (b.uniEquipId && c.status.equipLevel > 0 && !r.module?.active) err(`chess ${c.chessId}: stand-in module ${b.uniEquipId} has no level ${c.status.equipLevel}`);
      if (r.tokens.length) err(`chess ${c.chessId}: stand-in ${b.charId} summons ${r.tokens.join(', ')} (no tokens.json variant)`);
    }
    for (const [id, s] of Object.entries(backups.diy.slots)) {
      const slot = chess[id], golden = chess[s.goldenId];
      if (!slot?.isDiy || slot.isGolden || slot.tier !== s.tier || !golden?.isDiy) { err(`DIY slot ${id}: not a DIY chess pair of tier ${s.tier}`); continue; }
      if (!backups.diy.prototypes[s.tier]?.length) err(`DIY slot ${id}: no prototype picks`);
      for (const p of backups.diy.prototypes[s.tier] || []) {
        for (const rec of [slot, golden]) if (!unitForm(backups, p, rec.status)) err(`DIY slot ${rec.chessId}: prototype ${p} has no form ${statusKey(rec.status)}`);
        // the locked selection exists at both slot forms (the module at the elite's stage)
        const lk = backups.diy.locked?.[s.tier]?.[p];
        if (!lk) { err(`DIY slot ${id}: prototype ${p} has no locked selection`); continue; }
        for (const rec of [slot, golden]) {
          const f = unitForm(backups, p, rec.status);
          if (f && !f.skills.some((x) => x.index === lk.skillIndex)) err(`DIY slot ${rec.chessId}: prototype ${p} has no skill ${lk.skillIndex} at ${statusKey(rec.status)}`);
          if (f && lk.uniEquipId && rec.status.equipLevel > 0 && !f.modules.some((m) => m.uniEquipId === lk.uniEquipId)) err(`DIY slot ${rec.chessId}: prototype ${p} has no module ${lk.uniEquipId} at ${statusKey(rec.status)}`);
        }
      }
      // every owned pick: a form at both slot statuses with every skill, and at the elite every module of the character
      for (const p of backups.diy.ownedPool) {
        const u = backups.units[p];
        for (const rec of [slot, golden]) {
          const f = unitForm(backups, p, rec.status);
          if (!f) { err(`DIY slot ${rec.chessId}: owned pick ${p} has no form ${statusKey(rec.status)}`); continue; }
          if (officialOwnedSkills && f.skills.length !== 3) err(`DIY slot ${rec.chessId}: owned pick ${p} has ${f.skills.length} skills at ${statusKey(rec.status)}`);
          const ids = Object.keys(u.moduleNames).filter((m) => u.moduleNames[m].typeName !== 'ORIGINAL');
          if (rec.status.equipLevel > 0 && JSON.stringify(f.modules.map((m) => m.uniEquipId)) !== JSON.stringify(ids)) err(`DIY slot ${rec.chessId}: owned pick ${p} modules ${f.modules.map((m) => m.uniEquipId)} ≠ ${ids}`);
          for (const t of f.tokens) if (!backups.tokens?.[t]?.variants?.[`${p}@${statusKey(rec.status)}`]) err(`DIY pick ${p}@${statusKey(rec.status)}: summon ${t} has no variant in backups.json tokens`);
        }
      }
    }
    for (const [id, o] of Object.entries(backups.diy.operators)) for (const b of o.bonds) if (!bonds[b]) err(`DIY pick ${id}: bond ${b} missing`);
    for (const id of Object.keys(backups.tokens || {})) if (tokens[id]) err(`backups.json token ${id} is also a tokens.json record`);
  }
  for (const b of Object.values(bonds)) {
    for (const m of b.members) if (!chess[m]) err(`bond ${b.bondId}: member ${m} missing`);
    if (!b.thresholds.length) err(`bond ${b.bondId}: no thresholds`);
    if (!effects[b.effectId]) err(`bond ${b.bondId}: effect ${b.effectId} missing`);
  }
  for (const it of Object.values(items)) {
    if (!effects[it.effectId]) err(`item ${it.id}: effect missing`);
    if (it.goldenId && !items[it.goldenId]) err(`item ${it.id}: golden missing`);
    if (it.giveBondId && !bonds[it.giveBondId]) err(`item ${it.id}: giveBond ${it.giveBondId} missing`);
    if (it.requiresBondId && !bonds[it.requiresBondId]) err(`item ${it.id}: requiresBond ${it.requiresBondId} missing`);
  }
  for (const b of Object.values(bands)) if (!effects[b.effectId]) err(`band ${b.bandId}: effect missing`);
  for (const b of Object.values(bands)) for (const id of b.bondIds || []) if (!bonds[id]) err(`band ${b.bandId}: bond ${id} missing`);
  for (const w of Object.values(waves)) {
    for (const sp of w.spawns) {
      if (sp.action) continue;
      if (!enemies[sp.key]) err(`wave ${w.id}: enemy ${sp.key} missing`);
      if (!w.routes[sp.routeIndex]) err(`wave ${w.id}: route ${sp.routeIndex} missing`);
    }
    for (const [bn, phases] of Object.entries(w.branches)) for (const sp of phases.flat()) {
      if (sp.action) continue;
      if (!enemies[sp.key]) err(`wave ${w.id} branch ${bn}: enemy ${sp.key} missing`);
      if (!w.extraRoutes[sp.routeIndex]) err(`wave ${w.id} branch ${bn}: extraRoute ${sp.routeIndex} missing`);
    }
    for (const k of Object.keys(w.overrides)) if (!enemies[k]) err(`wave ${w.id}: override for unknown enemy ${k}`);
  }
  for (const s of Object.values(stages)) {
    if (s.rows.length !== 19 || s.rows.some((r) => r.length !== 21)) err(`stage ${s.id}: not 19x21`);
    if (s.rows.some((r) => r.includes('?'))) err(`stage ${s.id}: unknown tile glyph`);

  }
  // the escaped level of 1 / 2 helpers (config.unite.templates) has its map record (kind 'unite'; no field uses it)
  for (const [n, id] of Object.entries(config.unite.templates)) {
    if (stages[id]?.kind !== 'unite' || stages[id].helpers !== Number(n) || stages[id].active) err(`unite template ${id}: no inactive 联防 stage for ${n} helper(s)`); // i18n-ignore
  }
  for (const m of Object.values(config.modes)) {
    for (const [r, rd] of Object.entries(m.rounds)) {
      const tpls = rd.template ? [rd.template] : Object.values(rd.bossTemplates || {});
      if (!tpls.length) err(`mode ${m.modeId} round ${r}: no template`);
      for (const t of tpls) if (!waves[t]) err(`mode ${m.modeId} round ${r}: template ${t} missing`);
    }
    for (const s of m.stages) if (!stages[s]) err(`mode ${m.modeId}: stage ${s} missing`);
    for (const b of [...m.activeBondIds, ...m.inactiveBondIds]) if (!bonds[b]) err(`mode ${m.modeId}: bond ${b} missing`);
  }
  for (const b of Object.values(bosses)) if (!enemies[b.enemyKey]) err(`boss ${b.bossId}: enemy missing`);
  for (const e of Object.values(factions.entries)) {
    for (const k of [e.key, ...e.N.map((x) => x.key), ...e.E.map((x) => x.key)]) if (!enemies[k]) err(`faction ${e.key}: enemy ${k} missing`);
  }
  for (const card of choices.cards.bounty) for (const a of card.adds) if (a.enemyKey && !enemies[a.enemyKey]) err(`bounty ${card.effectId}: enemy ${a.enemyKey} missing`);
  for (const [pid, p] of Object.entries(choices.pools)) {
    for (const id of [...(p.items || []), ...(p.weighted || []).map((x) => x[0])]) if (!id || !(items[id] || chess[id])) err(`pool ${pid}: unresolved entry ${id}`);
  }
  for (const t of Object.values(tokens)) {
    if (!t.stats) err(`token ${t.tokenId}: no stats`);
    for (const [o, v] of Object.entries(t.variants || {})) if (!Array.isArray(v.sources) || !v.sources.length) err(`token ${t.tokenId}@${o}: no sources`);
  }
  for (const e of Object.values(enemies)) {
    const s = e.stats;
    // DESIGN §5.5 contract: rangeRadius > 0 ⇔ attacks units it is not blocked by (never for MELEE).
    if (!(s.rangeRadius >= 0) || (e.applyWay === 'MELEE' && s.rangeRadius !== 0)) err(`enemy ${e.key}: rangeRadius ${s.rangeRadius} (${e.applyWay})`);
    // bat 0 would mean "attack every tick"; aspd 0 is official only for a few skill-driven leaders.
    if (!(s.maxHp > 0) || !(s.bat > 0) || !(s.aspd >= 0) || !(s.moveSpeed >= 0) || !(s.lpr >= 0)) err(`enemy ${e.key}: bad core stats ${JSON.stringify({ maxHp: s.maxHp, bat: s.bat, aspd: s.aspd, moveSpeed: s.moveSpeed, lpr: s.lpr })}`);
  }
  return errors;
}


// Runtime validation adds structural diagnostics before the legacy reference pass (which expects well-shaped tables).
import { object, problem, jsonProblems, RECORD_MAPS, own } from './dataUtils.js';
import { validateSkillSpec, matchesSchema, MODS_SCHEMA, GRID_SCHEMA } from './skillSpec.js';
import { PLUGIN_SPAWN_ENTRIES, PLUGIN_SPAWN_TOTAL, PLUGIN_TIMES_MAX, PLUGIN_GAIN_COUNT_MAX, PLUGIN_GAIN_COUNT_KEYS } from './limits.js';
import { appendOfficialBounds } from './officialBounds.js';

const GAIN_COUNT_KEYS = new Set(PLUGIN_GAIN_COUNT_KEYS);

function checkSpawnBudget(list, path, bad) {
  const rows = list.filter(s => s && (!s.action || String(s.action).toUpperCase() === 'SPAWN'));
  if (rows.length > PLUGIN_SPAWN_ENTRIES) bad(path, `spawn entries exceed ${PLUGIN_SPAWN_ENTRIES}`, 'PLUGIN_DATA_LIMIT');
  let sum = 0;
  for (const s of rows) {
    if (!Number.isInteger(s.count) || s.count < 1) bad(path, 'invalid spawn count, timing or route');
    else if (s.count > PLUGIN_SPAWN_TOTAL) bad(path, `spawn count exceeds ${PLUGIN_SPAWN_TOTAL}`, 'PLUGIN_DATA_LIMIT');
    else sum += s.count;
    if (!Number.isInteger(s.routeIndex) || s.routeIndex < 0 || !(s.time >= 0) || !(s.interval >= 0)) bad(path, 'invalid spawn count, timing or route');
  }
  if (sum > PLUGIN_SPAWN_TOTAL) bad(path, `spawn count sum exceeds ${PLUGIN_SPAWN_TOTAL}`, 'PLUGIN_DATA_LIMIT');
}

function checkTimesMap(bb, path, bad) {
  if (!bb || typeof bb !== 'object' || Array.isArray(bb)) return;
  for (const [k, v] of Object.entries(bb)) {
    if (typeof v === 'number' && Number.isFinite(v) && (k === 'times' || k.endsWith('times')) && v > PLUGIN_TIMES_MAX) {
      bad(`${path}.${k}`, `times exceeds ${PLUGIN_TIMES_MAX}`, 'PLUGIN_DATA_LIMIT');
    }
  }
}

function checkBlackboards(rec, path, bad) {
  if (!rec || typeof rec !== 'object') return;
  if (Array.isArray(rec.skills)) rec.skills.forEach((s, i) => checkTimesMap(s?.bb, `${path}.skills[${i}].bb`, bad));
  checkTimesMap(rec.talents?.bb, `${path}.talents.bb`, bad);
  if (rec.talent && typeof rec.talent === 'object' && !Array.isArray(rec.talent)) checkTimesMap(rec.talent, `${path}.talent`, bad);
  if (Array.isArray(rec.abilities)) rec.abilities.forEach((a, i) => checkTimesMap(a?.bb, `${path}.abilities[${i}].bb`, bad));
}

function checkData(data, { kitExists = null, vanilla = null, owners = null, validateDsl = null } = {}) {
  const problems = jsonProblems(data, 'data', { bounded: false });
  const bad = (path, message, code = 'PLUGIN_DATA_REQUIRED') => problems.push(problem(code, path, message));
  const array = (v, path) => { if (!Array.isArray(v)) bad(path, 'array required'); };
  for (const table of ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'backups']) {
    if (!object(data?.[table])) bad(table, 'data table required');
  }
  if (problems.length) return problems;
  for (const [file, [, key]] of Object.entries(RECORD_MAPS)) for (const [id, rec] of Object.entries(data[file])) {
    if (!object(rec) || rec[key] !== id) bad(`${file}.${id}`, `record must have ${key} = its map key`);
  }
  if (problems.length) return problems;
  const checkSkills = (rec, at, defaults, ownerPath) => {
    if (!object(rec.stats) || !['maxHp', 'atk', 'def', 'res', 'aspd', 'bat', 'blockCnt', 'cost', 'respawnTime'].every(k => typeof rec.stats[k] === 'number' && Number.isFinite(rec.stats[k]))
      || !(rec.stats.maxHp > 0) || !(rec.stats.bat > 0)) bad(at + '.stats', 'numeric core stats and positive maxHp/bat required');
    if (!matchesSchema(rec.rangeGrid, GRID_SCHEMA)) bad(at + '.rangeGrid', 'range grid required');
    if (!object(rec.trait) || !Array.isArray(rec.talents)) bad(at, 'trait and talents required');
    if (!Array.isArray(rec.skills) || !rec.skills.length) { bad(at + '.skills', 'skills required'); return; }
    const seen = new Set();
    for (const s of rec.skills) {
      if (!object(s) || typeof s.skillId !== 'string' || !Number.isInteger(s.index) || seen.has(s.index) || !object(s.bb)) bad(at + '.skills', 'skill id, unique index and blackboard required');
      seen.add(s?.index);
      if (s && (!['MANUAL','AUTO','PASSIVE'].includes(s.skillType) || !['INCREASE_WITH_TIME','INCREASE_WHEN_ATTACK','INCREASE_WHEN_TAKEN_DAMAGE','ON_DEPLOY'].includes(s.spType)
        || !['duration','spCost','initSp'].every(k => typeof s[k] === 'number' && Number.isFinite(s[k])))) bad(at + '.skills', 'invalid skill kind, SP type or numeric field');
      if (s?.skillSpec) problems.push(...validateSkillSpec(s.skillSpec, at + '.skills.skillSpec'));
    }
    if (defaults && (rec.skills.filter(s => s?.isDefault === true).length !== 1 || rec.skills.find(s => s?.isDefault)?.skillId !== rec.skill?.skillId)) bad(at, 'exactly one default equal to skill required', 'PLUGIN_RECORD_SKILLS');
    if (defaults && rec.skill) {
      const { isDefault, ...s } = rec.skills.find(s => s?.isDefault) || {};
      if (JSON.stringify(s) !== JSON.stringify(rec.skill)) {
        // Property order is not a semantic field of a skill.
        if (canonicalJson(s) !== canonicalJson(rec.skill)) bad(at, 'skill differs from default skills[] entry', 'PLUGIN_RECORD_SKILLS');
      }
    }
    if (rec.skillSpec != null) problems.push(...validateSkillSpec(rec.skillSpec, at + '.skillSpec'));
    if (rec.talentMods != null && !matchesSchema(rec.talentMods, MODS_SCHEMA)) bad(at, 'invalid talentMods', 'PLUGIN_SKILL_SPEC');
    if (rec.kitRef != null && rec.talentMods != null) bad(at, 'talentMods belong with a JSON SkillSpec, not kitRef', 'PLUGIN_SKILL_SPEC');
    if (rec.dsl != null) {
      // (the sim's DSL validator, handed in by the content-set builder — shared code does not import the engine; a record
      // with DSL checked without one is refused)
      const checked = typeof validateDsl === 'function' ? validateDsl(rec.dsl, { bounds: true })
        : { ok: false, problems: [{ code: 'PLUGIN_DSL_SHAPE', path: '', zh: 'a DSL record needs the content-set builder to check it (no validator given)' }] };
      if (!checked.ok) for (const p of checked.problems) bad(p.path ? `${at}.${p.path}` : at, p.zh, p.code);
      else if (typeof rec.pluginId !== 'string' || !rec.pluginId) bad(`${at}.pluginId`, 'DSL record needs the contributing plugin id', 'PLUGIN_DSL_PLUGIN_ID');
      else if (rec.dsl.pluginId != null && rec.dsl.pluginId !== rec.pluginId) bad(`${at}.pluginId`, 'spec pluginId differs from the record pluginId', 'PLUGIN_DSL_PLUGIN_ID');
      else if (owners && owners.get(ownerPath) !== rec.pluginId) bad(`${at}.pluginId`, 'pluginId is not the plugin that contributed this record', 'PLUGIN_DSL_PLUGIN_ID');
    }
    if (rec.kitRef != null && (typeof rec.kitRef !== 'string' || kitExists && !kitExists(rec.kitRef))) bad(at, 'unknown official kitRef', 'PLUGIN_KIT_REF');
  };
  for (const [id, c] of Object.entries(data.chess)) {
    for (const k of ['bonds', 'garrisonIds', 'tokens']) array(c[k], `chess.${id}.${k}`);
    const a = data.chess[c.baseId], b = data.chess[c.goldenId];
    if (c.chessId !== id || (id !== c.baseId && id !== c.goldenId) || !a || !b || a === b || a.chessId !== c.baseId || b.chessId !== c.goldenId
      || a.baseId !== c.baseId || b.baseId !== c.baseId || a.goldenId !== c.goldenId || b.goldenId !== c.goldenId
      || a.isGolden || !b.isGolden || a.charId !== b.charId || a.tier !== b.tier || c.isGolden !== (id === c.goldenId)
      || a.upgradeChessId !== b.chessId || b.upgradeChessId != null) bad(id, 'inconsistent normal/elite pair', 'PLUGIN_DATA_PAIR');
    if (!c.isDiy) checkSkills(c, `chess.${id}`, true, `chess.${id}`);
  }
  for (const [id, u] of Object.entries(data.backups.units ?? {})) {
    if (!object(u?.forms)) { bad(id, 'unit forms required'); continue; }
    for (const [key, f] of Object.entries(u.forms)) checkSkills({ ...f, ...Object.fromEntries(['kitRef', 'skillSpec', 'talentMods', 'dsl', 'pluginId'].filter(k => own(f, k) || own(u, k)).map(k => [k, f[k] ?? u[k]])) }, `${id}@${key}`, false, `units.${id}`);
  }
  for (const b of Object.values(data.bonds)) for (const k of ['members', 'thresholds']) array(b[k], `bonds.${b.bondId}.${k}`);
  for (const w of Object.values(data.waves)) {
    for (const k of ['routes', 'spawns', 'extraRoutes']) array(w[k], `waves.${w.id}.${k}`);
    for (const k of ['branches', 'overrides']) if (!object(w[k])) bad(w.id + '.' + k, 'object required');
    if (Array.isArray(w.spawns)) checkSpawnBudget(w.spawns, `waves.${w.id}.spawns`, bad);
    for (const [bn, phases] of Object.entries(w.branches ?? {})) {
      if (!Array.isArray(phases)) { bad(`${w.id}.branches.${bn}`, 'array required'); continue; }
      phases.forEach((phase, i) => {
        if (!Array.isArray(phase)) bad(`${w.id}.branches.${bn}[${i}]`, 'array required');
        else checkSpawnBudget(phase, `waves.${w.id}.branches.${bn}[${i}]`, bad);
      });
    }
    for (const r of [...(w.routes ?? []), ...(w.extraRoutes ?? [])]) for (const k of ['start', 'end']) {
      if (!Array.isArray(r[k]) || r[k].length !== 2 || !r[k].every(Number.isInteger)) bad(w.id, 'route start/end must be tile coordinates');
    }
  }
  for (const s of Object.values(data.stages)) {
    array(s.rows, s.id + '.rows');
    if (!object(s.tiles) || !s.rows?.every(r => typeof r === 'string' && [...r].every(g => own(s.tiles, g)))) bad(s.id, 'unknown tile glyph');
  }
  if (!object(data.config.modes) || !object(data.config.economy) || !object(data.config.unite?.templates)
    || !object(data.backups.diy?.slots) || !object(data.backups.diy?.operators) || !Array.isArray(data.backups.diy?.ownedPool)
    || !object(data.factions.entries) || !object(data.choices.pools) || !Array.isArray(data.choices.cards?.bounty)) bad('data', 'missing config, backups, factions or choices fields');
  for (const m of Object.values(data.config.modes ?? {})) {
    if (!object(m.rounds)) bad(m.modeId, 'rounds required');
    for (const k of ['stages', 'activeBondIds', 'inactiveBondIds']) array(m[k], `modes.${m.modeId}.${k}`);
  }
  for (const e of Object.values(data.enemies)) {
    if (!object(e.stats)) bad(e.key, 'enemy stats required');
    if (e.skills != null && !Array.isArray(e.skills)) bad(`${e.key}.skills`, 'skills must be an array', 'PLUGIN_DATA_TYPE');
    if (e.talents != null && !object(e.talents)) bad(`${e.key}.talents`, 'talents must be an object', 'PLUGIN_DATA_TYPE');
    checkBlackboards(e, e.key, bad);
  }
  for (const w of Object.values(data.waves)) for (const [key, ov] of Object.entries(w.overrides ?? {})) checkBlackboards(ov, `waves.${w.id}.overrides.${key}`, bad);
  for (const e of Object.values(data.effects ?? {})) for (const b of e.buffs ?? []) {
    if (GAIN_COUNT_KEYS.has(b.key) && typeof b.bb?.count === 'number' && Number.isFinite(b.bb.count) && b.bb.count > PLUGIN_GAIN_COUNT_MAX) {
      bad(`${e.effectId}.${b.key}`, `gain count exceeds ${PLUGIN_GAIN_COUNT_MAX}`, 'PLUGIN_DATA_LIMIT');
    }
  }
  // Systematic cap against the official tables. Runs even when an earlier limit already fired, so a 1e9
  // enemy `times` reports PLUGIN_DATA_BOUND as well as PLUGIN_DATA_LIMIT. [ASSUMED] DESIGN §32.5.
  if (vanilla) appendOfficialBounds(data, vanilla, bad);
  if (problems.length) return problems;
  try { for (const message of validateReferences(data, { officialOwnedSkills: false })) bad('data', message, 'PLUGIN_DATA_REFERENCE'); }
  catch (e) { bad('data', `malformed nested data: ${e.message}`, 'PLUGIN_DATA_REQUIRED'); }
  for (const file of ['items', 'bands', 'enemies']) for (const [id, r] of Object.entries(data[file])) if (r.effectRef != null) {
    const base = (vanilla ?? data)[file]?.[r.effectRef];
    if (!base || base.effectRef) bad(`${file}.${id}`, 'effectRef must name an official record', 'PLUGIN_EFFECT_REF');
  }
  if (vanilla) {
    const garKeys = new Set(Object.values(vanilla.garrisons).map(g => g.effectKey));
    const buffKeys = new Set(Object.values(vanilla.effects).flatMap(e => (e.buffs ?? []).map(b => b.key)));
    for (const [id, g] of Object.entries(data.garrisons)) if (!own(vanilla.garrisons, id) && !garKeys.has(g.effectKey)) bad(id, 'unknown garrison effectKey', 'PLUGIN_EFFECT_REF');
    for (const [id, e] of Object.entries(data.effects)) if (!own(vanilla.effects, id)) {
      for (const b of e.buffs ?? []) if (!buffKeys.has(b.key)) bad(id, 'unknown effect buff key', 'PLUGIN_EFFECT_REF');
    }
  }
  for (const m of Object.values(data.config.modes)) {
    for (const id of m.inactiveEnemyKeys ?? []) if (!data.enemies[id]) bad(m.modeId, `unknown enemy ${id}`, 'PLUGIN_DATA_REFERENCE');
    for (const id of [...Object.keys(m.bossWeights ?? {}), ...Object.keys(m.hiddenBossWeights ?? {})]) if (!data.bosses[id]) bad(m.modeId, `unknown boss ${id}`, 'PLUGIN_DATA_REFERENCE');
  }
  return problems;
}
import { canonicalJson } from './identity.js';

/** A malformed plugin graph always yields diagnostics; it cannot abort a registry/room request. */
export function validateData(data, options = {}) {
  try { return checkData(data, options); }
  catch (e) { return [problem('PLUGIN_DATA_REQUIRED', 'data', `malformed nested data: ${e.message}`)]; }
}
