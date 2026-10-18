// Maintainer battle sandbox. No Match, rooms, writes or simulation singleton changes.
import { newScenario, validateShape, scenarioDevices, fail, ScenarioError } from '../../shared/studio/scenario.js';
import { GEO } from '../../shared/constants.js';
import { checkDiyPick, diyModuleOf, isDiyModule } from '../../shared/diy.js';
import { attackRangeGrid } from '../../shared/loadoutRecord.js';
import { buildDeployMap, positionClass, canPlace, ownerRangeKeys } from '../match/board.js';
import { GameData } from '../match/gamedata.js';
import { diyGameData } from '../match/player/diy.js';
import { setupMatchWaves, buildNormalWave, buildBossWave, buildUniteWave, withBounties, roundMods } from '../match/waves.js';
import { createRng } from '../sim/rng.js';
import { buildBattleSpec } from '../sim/spec.js';
import { DataSource } from '../sim/simdata.js';
import { bountyOf, mapAliases, hasBattlePart, gateOf, benchGate } from '../sim/content/choices.js';
import { StudioError } from './files.js';

const own = (map, id) => typeof id === 'string' && Object.hasOwn(map || {}, id) ? map[id] : null;
const requireRecord = (map, id, path) => own(map, id) || fail(path, 'unknown');
const bossLike = s => s.kind === 'boss' || s.kind === 'hidden';
const playerId = i => `console-${i + 1}`;

export function consoleOptions(raw) {
  return { scenario: newScenario(), choices: (raw.choices?.cards?.tactic || []).map(c => ({ ...c,
    supported: hasBattlePart(raw.effects[c.effectId]) })), bounties: raw.choices?.cards?.bounty || [] };
}

/** Server validation/building errors contain a field path, never an absolute path or imported script. */
export function buildConsoleScenario(input, raw) {
  try { return build(input, raw); }
  catch (e) {
    if (e instanceof ScenarioError) throw new StudioError('PLUGIN_STUDIO_CONSOLE_SCENARIO', 400, { path: e.path, reason: e.reason });
    throw e;
  }
}

function build(input, raw) {
  const s = validateShape(input);
  const stage = requireRecord(raw.stages, s.stageId, 'stageId');
  requireRecord(raw.config.modes, s.modeId, 'modeId');
  const gd = new GameData(raw, s.modeId), ds = new DataSource(raw, null);
  const rng = createRng(s.seed), setup = setupMatchWaves(gd, rng);
  let wave;
  let bossId = s.bossId;
  if (bossLike(s)) {
    bossId ||= s.kind === 'hidden' ? 'boss_8' : 'boss_1';
    const boss = requireRecord(raw.bosses, bossId, 'bossId');
    if (!!boss.hidden !== (s.kind === 'hidden')) fail('bossId', 'field');
    const candidate = s.waveId || boss.templates?.[s.modeId]?.template
      || Object.keys(raw.waves).find(id => raw.waves[id].bossId === bossId && /_s$/.test(id));
    const tpl = requireRecord(raw.waves, candidate, 'waveId');
    if (tpl.bossId !== bossId || tpl.kind !== s.kind) fail('waveId', 'field');
    // [ASSUMED] Author may test any official template at any round; only its selected round's scaling applies.
    const waveData = Object.create(gd);
    waveData.roundCfg = r => ({ ...gd.roundCfg(r), bossTemplates: { [bossId]: candidate } });
    wave = buildBossWave(waveData, rng, setup, s.round, { bossId, solo: s.players.length === 1 });
  } else if (s.kind === 'unite') {
    if (s.waveId !== null) fail('waveId', 'unsupported');
    if (bossId !== null) fail('bossId', 'field');
    // [ASSUMED] In an isolated official unite exercise, the chosen normal wave's enemies are the leaks.
    const normal = buildNormalWave(gd, rng, setup, s.round);
    const leaked = normal.spawns.flatMap(e => Array.from({ length: e.count }, () => ({ ...e, sourcePlayerId: playerId(0) })));
    wave = { ...buildUniteWave(gd, leaked, s.players.length, gd.combatTimeLimit(s.round)), overrides: {}, timeLimit: gd.combatTimeLimit(s.round) };
  } else {
    if (bossId !== null) fail('bossId', 'field');
    const waveData = Object.create(gd);
    if (s.waveId) {
      const tpl = requireRecord(raw.waves, s.waveId, 'waveId');
      if (!['normal', 'training'].includes(tpl.kind) || tpl.bossId) fail('waveId', 'field');
      waveData.roundCfg = r => ({ ...gd.roundCfg(r), template: s.waveId });
    }
    wave = buildNormalWave(waveData, rng, setup, s.round);
  }
  if (!wave.routes.length) fail('round', 'wave');
  const maps = [], tokens = [];
  const players = s.players.map((p, i) => {
    const overrides = p.bandId ? Object.fromEntries(Object.entries(mapAliases(requireRecord(raw.bands, p.bandId, 'bandId'))).map(([k, v]) => [k, !!v])) : {};
    const choices = p.choices.map((id, n) => {
      const effect = requireRecord(raw.effects, id, 'choices');
      if (!(raw.choices.cards.tactic || []).some(c => c.effectId === id) || !hasBattlePart(effect)) fail('choices', 'unsupported');
      for (const [alias, active] of Object.entries(mapAliases(effect))) {
        // Map cards name all aliases, including other fields; absent aliases are harmless, not new devices.
        if (stage.devices.some(d => d.alias === alias)) overrides[alias] = !!active;
      }
      return { id: `choice:${id}#${n}`, key: `choice:${id}`, data: { effectId: id },
        params: { prepOk: benchGate(gateOf(effect), p.handUnits) } };
    });
    const ownDevices = scenarioDevices(stage, s, i);
    for (const alias of Object.keys(p.deviceOverrides)) if (!ownDevices.some(d => d.alias === alias)) fail('deviceOverrides', 'field');
    Object.assign(overrides, p.deviceOverrides);
    const field = bossLike(s) ? (i ? 'bossR' : 'bossL') : 'normal';
    // The second unite half reads its actual terrain/devices, translated back to board coordinates.
    const deployStage = s.kind === 'unite' && i === 1 ? { ...stage,
      rows: stage.rows.map(row => row.slice(8).padEnd(21, '#')),
      devices: stage.devices.map(d => ({ ...d, pos: [d.pos[0], d.pos[1] - 8] })) } : stage;
    const map = buildDeployMap(deployStage, { deviceOverrides: overrides, field });
    maps.push([...map].map(([key, type]) => ({ row: +key.split(',')[0], col: +key.split(',')[1], type })));
    const records = new Map(), used = new Set(), available = [];
    for (const u of p.units.filter(u => u.kind === 'chess')) {
      const rec = requireRecord(raw.chess, u.chessId, 'chessId');
      if (rec.isDiy) {
        if (!u.diy || checkDiyPick(u.chessId, u.diy, raw).error) fail('unit.diy', 'loadout');
        if (u.standIn || u.skillIndex !== undefined || u.moduleId !== undefined) fail('unit.diy', 'loadout');
        const mod = u.diy.uniEquipId && diyModuleOf(u.chessId, u.diy.charId, u.diy.uniEquipId, raw);
        if (mod && !isDiyModule(mod)) fail('unit.diy.uniEquipId', 'loadout');
      } else if (u.diy) fail('unit.diy', 'loadout');
      if (u.standIn) {
        if (!ds.getStandIn(u.chessId) || ['potential', 'cultivate', 'skillIndex', 'moduleId'].some(k => k in u)) fail('unit.standIn', 'loadout');
      } else if (!u.diy) {
        if (u.skillIndex !== undefined && !rec.skills?.some(sk => sk.index === u.skillIndex)) fail('unit.skillIndex', 'loadout');
        if (u.moduleId !== undefined && u.moduleId !== 'none' && !rec.modules?.some(m => m.uniEquipId === u.moduleId)) fail('unit.moduleId', 'loadout');
      }
      for (const id of u.items) {
        const item = requireRecord(raw.items, id, 'unit.items');
        if (item.itemType !== 'EQUIP') fail('unit.items', 'unsupported');
      }
      const def = ds.getChess(u.chessId, u);
      if (!def) fail('chessId', 'loadout');
      if (def.raw.diyProto && (u.potential !== undefined || u.cultivate !== undefined)) fail('unit.diy', 'loadout');
      records.set(u.uid, def.raw);
      const ownerData = u.diy ? diyGameData(gd, new Map([[u.chessId, def.raw]])) : gd;
      if (!u.standIn) for (const { tokenId, count } of ownerData.placeableTokens(u.chessId, def.loadout)) {
        const t = ds.getToken(tokenId, u.chessId, u);
        if (t?.raw?.placeable && t.sources?.some(src => src === 'skill' || src === 'talent')) {
          available.push({ ownerUid: u.uid, tokenId, name: t.name, count });
        }
      }
    }
    tokens.push(available);
    for (const u of p.units) {
      let rec = records.get(u.uid);
      if (u.kind === 'token') {
        const owner = p.units.find(o => o.uid === u.ownerUid && o.kind === 'chess');
        const slot = available.find(t => t.ownerUid === u.ownerUid && t.tokenId === u.tokenId);
        if (!owner || !slot) fail('unit.ownerUid', 'summon');
        if (p.units.filter(t => t.kind === 'token' && t.ownerUid === u.ownerUid && t.tokenId === u.tokenId).length > slot.count) fail('unit.tokenId', 'limit');
        rec = ds.getToken(u.tokenId, owner.chessId, owner).raw;
        const keys = ownerRangeKeys(attackRangeGrid(records.get(owner.uid)), owner.row, owner.col, owner.dir);
        if ((rec.ownerRange && !keys.has(`${u.row},${u.col}`)) || (rec.ownerRangeOutside && keys.has(`${u.row},${u.col}`))) fail('unit.tokenId', 'range');
        if (u.carryState && ('hpPct' in u.carryState || 'down' in u.carryState)) fail('unit.carryState', 'unsupported');
      }
      const key = `${u.row},${u.col}`;
      if (used.has(key)) fail('unit', 'occupied');
      if (!canPlace(map, positionClass(rec), u.row, u.col)) fail('unit', 'tile');
      // Active turrets occupy a tile even though they don't alter the terrain class.
      const sr = bossLike(s) ? u.row - 7 : u.row;
      const sc = bossLike(s) && i ? 20 - u.col : u.col + (s.kind === 'unite' ? 8 * i : 0);
      if (stage.devices.some(d => d.role === 'turret' && d.pos[0] === sr && d.pos[1] === sc && (overrides[d.alias] ?? d.active ?? !d.hidden))) fail('unit', 'occupied');
      used.add(key);
    }
    const bonds = {};
    for (const [id, b] of Object.entries(p.bonds)) {
      const rec = requireRecord(raw.bonds, id, 'bonds');
      if (b.tier > rec.thresholds.length) fail('bonds', 'tier');
      bonds[id] = { active: b.tier > 0, tier: b.tier, layers: b.layers, count: b.tier ? rec.thresholds[b.tier - 1] : 0 };
    }
    if (p.bandId) requireRecord(raw.bands, p.bandId, 'bandId');
    for (const id of p.facts?.extraBands || []) requireRecord(raw.bands, id, 'facts.extraBands');
    return { playerId: playerId(i), seat: i, side: i ? 'R' : 'L', colOffset: s.kind === 'unite' ? i * 8 : 0,
      units: p.units, bonds, bandId: p.bandId, playerEffects: choices, deviceOverrides: overrides,
      contentInfo: { round: s.round, kind: s.kind, shopLevel: p.facts?.shopLevel ?? 1, funds: p.facts?.funds ?? 0,
        handUnits: p.handUnits, handChess: p.facts?.handChess ?? 0, roundStats: p.facts?.roundStats ?? {},
        matchBands: [...new Set([...s.players.map(v => v.bandId), ...(p.facts?.extraBands || [])].filter(Boolean))],
        teammates: s.players.flatMap((v, j) => i === j ? [] : [{ playerId: playerId(j), bandId: v.bandId }]) } };
  });
  const bounties = s.bounties.map((id, i) => {
    const effect = requireRecord(raw.effects, id, 'bounties');
    const card = bountyOf(effect);
    if (!card) fail('bounties', 'unsupported');
    return { id: `console-bounty-${i}`, card };
  });
  let spawns = wave.spawns;
  if (s.enemyMode === 'custom') {
    spawns = s.enemies.map(e => {
      const rec = requireRecord(raw.enemies, e.enemyKey, 'enemyKey');
      if (!wave.routes[e.routeIndex]) fail('enemy.routeIndex', 'route');
      const isBoss = Object.values(raw.bosses).some(b => b.enemyKey === e.enemyKey);
      if (isBoss && (!bossLike(s) || raw.bosses[bossId].enemyKey !== e.enemyKey)) fail('enemyKey', 'leader');
      const fly = rec.stats?.motion === 'FLY';
      if ((wave.routes[e.routeIndex].motion === 'FLY') !== fly) fail('enemy.routeIndex', 'motion');
      return { ...e, mods: isBoss ? { atkMul: gd.enemyScale(s.round).atkMul, speedMul: gd.enemyScale(s.round).speedMul } : roundMods(gd.enemyScale(s.round)),
        ...(isBoss ? { tag: 'boss', countInTotal: false } : {}), sourcePlayerId: playerId(0) };
    });
  } else if (s.enemies.length) fail('enemies', 'inactive');
  spawns = withBounties(gd, s.round, { ...wave, spawns, ...(s.enemyMode === 'custom' ? { actions: [] } : {}) }, bounties, playerId(0));
  const flags = { layerGainsEnabled: s.kind === 'normal', ...gd.dp, ...(bossLike(s) ? { enemyScale: gd.enemyScale(s.round) } : {}), ...s.flags };
  if (flags.dpInit > flags.dpMax) fail('flags.dpInit', 'limit');
  const hp = bossLike(s) ? gd.bossPoolHp(bossId, s.players.length) : null;
  const spec = buildBattleSpec({ battleId: 'studio-console', fieldId: 'studio-console', seed: s.seed, kind: s.kind, modeId: s.modeId,
    round: s.round, stageId: s.stageId, rect: bossLike(s) ? GEO.BOSS_RECT : s.kind === 'unite' ? GEO.UNITE_RECT : GEO.NORMAL_RECT,
    timeLimit: Math.min(s.seconds, wave.timeLimit || s.seconds), players, spawns, routes: wave.routes, flags,
    waveId: wave.templateId, bossId, enemyOverrides: wave.overrides, boss: hp ? { poolHp: hp, poolMax: hp } : null });
  return { scenario: s, spec, cap: s.seconds, maps, tokens, scale: gd.enemyScale(s.round) };
}
