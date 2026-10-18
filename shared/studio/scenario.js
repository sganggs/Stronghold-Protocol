// Studio sandbox format, independent of normal rooms. [ASSUMED] Work/size bounds are authoring limits.
export const SCENARIO_VERSION = 1;
export const SCENARIO_BYTES = 512 * 1024;
export const LAST_SCENARIO = 'sp.studio.console.v1';
export const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4, 8]);
export const cloneScenario = value => JSON.parse(JSON.stringify(value));
export const emptyPlayer = () => ({ units: [], bonds: {}, bandId: null, choices: [], deviceOverrides: {}, handUnits: 0 });
/** Device aliases belonging to the selected field/owner. Turrets may be just outside the battle rect. */
export function scenarioDevices(stage, scenario, side) {
  const boss = scenario.kind === 'boss' || scenario.kind === 'hidden';
  return (stage?.devices || []).filter(d => d.alias && (boss ? d.pos[0] < 6 : d.pos[0] >= 7 && d.pos[0] <= 12)
    && (boss && scenario.players.length === 1 ? true : side === 1 ? d.pos[1] >= 11 : d.pos[1] <= 10));
}
export function newScenario() {
  return { v: SCENARIO_VERSION, name: '', stageId: 'act1autochess_m01', kind: 'normal', modeId: 'mode_single_normal',
    round: 1, seed: 1, seconds: 240, waveId: null, bossId: null, enemyMode: 'official', enemies: [], bounties: [],
    players: [emptyPlayer()], flags: {} };
}
export class ScenarioError extends Error {
  constructor(path, reason = 'value') { super(`${path}: ${reason}`); this.path = path; this.reason = reason; }
}
export const fail = (path, reason) => { throw new ScenarioError(path, reason); };
export const object = (o, path) => {
  if (!o || typeof o !== 'object' || Array.isArray(o) || ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail(path, 'object');
  for (const k of Object.keys(o)) if (['__proto__', 'prototype', 'constructor'].includes(k)) fail(path, 'key');
  return o;
};
export function keys(o, allowed, path) {
  object(o, path);
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${path}.${k}`, 'unsupported');
}
export function number(v, lo, hi, path, integer = false) {
  if (!Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) fail(path, 'number');
  return v;
}
export function array(v, max, path) { if (!Array.isArray(v) || v.length > max) fail(path, 'array'); return v; }
export function oneOf(v, choices, path) { if (!choices.includes(v)) fail(path, 'value'); return v; }
export function identifier(v, path) { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v)) fail(path, 'id'); return v; }
export function bool(v, path) { if (typeof v !== 'boolean') fail(path, 'boolean'); return v; }

/** Parse bounded JSON without changing the last good scenario. Semantic validation is server-side. */
export function parseScenario(text) {
  if (typeof text !== 'string' || text.length > SCENARIO_BYTES) fail('scenario', 'size');
  let bytes = 0;
  for (const c of text) { const n = c.codePointAt(0); bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4; }
  if (bytes > SCENARIO_BYTES) fail('scenario', 'size');
  let value;
  try { value = JSON.parse(text); } catch { fail('scenario', 'json'); }
  return validateShape(value);
}
export function validateShape(s) {
  keys(s, ['v', 'name', 'stageId', 'kind', 'modeId', 'round', 'seed', 'seconds', 'waveId', 'bossId', 'enemyMode', 'enemies', 'bounties', 'players', 'flags'], 'scenario');
  if (s.v !== SCENARIO_VERSION) fail('v', 'version');
  if (typeof s.name !== 'string' || s.name.length > 120) fail('name', 'size');
  identifier(s.stageId, 'stageId'); identifier(s.modeId, 'modeId');
  oneOf(s.kind, ['normal', 'boss', 'hidden', 'unite'], 'kind');
  oneOf(s.enemyMode, ['official', 'custom'], 'enemyMode');
  number(s.round, 1, 15, 'round', true); number(s.seed, 1, 0xffffffff, 'seed', true); number(s.seconds, 1, 1200, 'seconds');
  if (s.waveId !== null) identifier(s.waveId, 'waveId');
  if (s.bossId !== null) identifier(s.bossId, 'bossId');
  array(s.players, s.kind === 'normal' ? 1 : 2, 'players');
  if (!s.players.length) fail('players', 'empty');
  const uids = new Set();
  for (const [i, p] of s.players.entries()) {
    const path = `players[${i}]`;
    keys(p, ['units', 'bonds', 'bandId', 'choices', 'deviceOverrides', 'handUnits', 'facts'], path);
    number(p.handUnits, 0, 15, `${path}.handUnits`, true);
    if (p.facts !== undefined) {
      keys(p.facts, ['shopLevel', 'funds', 'handChess', 'roundStats', 'extraBands'], `${path}.facts`);
      if (p.facts.shopLevel !== undefined) number(p.facts.shopLevel, 1, 6, 'facts.shopLevel', true);
      if (p.facts.funds !== undefined) number(p.facts.funds, 0, 9999, 'facts.funds', true);
      if (p.facts.handChess !== undefined) number(p.facts.handChess, 0, p.handUnits, 'facts.handChess', true);
      if (p.facts.extraBands !== undefined) array(p.facts.extraBands, 4, 'facts.extraBands').forEach(id => identifier(id, 'facts.extraBands'));
      if (p.facts.roundStats !== undefined) {
        keys(p.facts.roundStats, ['refreshes', 'buys', 'sells', 'spent', 'gainedChess', 'arts'], 'facts.roundStats');
        for (const [k, v] of Object.entries(p.facts.roundStats)) number(v, 0, 10000, `facts.roundStats.${k}`, true);
      }
    }
    if (p.bandId !== null) identifier(p.bandId, `${path}.bandId`);
    object(p.bonds, `${path}.bonds`); object(p.deviceOverrides, `${path}.deviceOverrides`);
    if (Object.keys(p.bonds).length > 32 || Object.keys(p.deviceOverrides).length > 256) fail(path, 'size');
    for (const [id, b] of Object.entries(p.bonds)) {
      identifier(id, `${path}.bonds`); keys(b, ['tier', 'layers'], `${path}.bonds.${id}`);
      number(b.tier, 0, 10, `${path}.bonds.${id}.tier`, true); number(b.layers, 0, 999, `${path}.bonds.${id}.layers`, true);
    }
    for (const [alias, active] of Object.entries(p.deviceOverrides)) {
      if (alias.length > 150) fail(`${path}.deviceOverrides`, 'size');
      bool(active, `${path}.deviceOverrides.${alias}`);
    }
    array(p.choices, 32, `${path}.choices`).forEach(id => identifier(id, `${path}.choices`));
    for (const u of array(p.units, 36, `${path}.units`)) {
      keys(u, ['uid', 'kind', 'chessId', 'tokenId', 'ownerUid', 'row', 'col', 'dir', 'items', 'skillIndex', 'moduleId', 'potential', 'cultivate', 'carryState', 'standIn', 'diy'], `${path}.unit`);
      number(u.uid, 1, 10000, 'uid', true);
      if (uids.has(u.uid)) fail('uid', 'duplicate'); uids.add(u.uid);
      oneOf(u.kind, ['chess', 'token'], 'unit.kind');
      number(u.row, 9, 12, 'unit.row', true); number(u.col, 2, 10, 'unit.col', true);
      oneOf(u.dir, ['UP', 'RIGHT', 'DOWN', 'LEFT'], 'unit.dir');
      if (u.kind === 'token') {
        identifier(u.tokenId, 'unit.tokenId'); number(u.ownerUid, 1, 10000, 'unit.ownerUid', true);
        for (const k of ['chessId', 'items', 'skillIndex', 'moduleId', 'potential', 'cultivate', 'standIn', 'diy']) if (k in u) fail(`unit.${k}`, 'unsupported');
      } else {
        identifier(u.chessId, 'unit.chessId');
        if ('tokenId' in u || 'ownerUid' in u) fail('unit', 'unsupported');
        array(u.items, 2, 'unit.items').forEach(id => identifier(id, 'unit.items'));
        if (u.skillIndex !== undefined) number(u.skillIndex, 0, 9, 'unit.skillIndex', true);
        if (u.moduleId !== undefined) identifier(u.moduleId, 'unit.moduleId');
        if (u.potential !== undefined) number(u.potential, 1, 6, 'unit.potential', true);
        if (u.cultivate !== undefined) number(u.cultivate, 0, 3, 'unit.cultivate', true);
        if (u.standIn !== undefined) oneOf(u.standIn, [true], 'unit.standIn');
        if (u.diy !== undefined) {
          keys(u.diy, ['charId', 'skillIndex', 'uniEquipId'], 'unit.diy'); identifier(u.diy.charId, 'unit.diy.charId');
          if (u.diy.skillIndex != null) number(u.diy.skillIndex, 0, 9, 'unit.diy.skillIndex', true);
          if (u.diy.uniEquipId != null) identifier(u.diy.uniEquipId, 'unit.diy.uniEquipId');
        }
      }
      if (u.carryState !== undefined) {
        keys(u.carryState, ['hpPct', 'sp', 'down'], 'unit.carryState');
        if (u.carryState.hpPct !== undefined) number(u.carryState.hpPct, 0, 1, 'unit.carryState.hpPct');
        if (u.carryState.sp !== undefined) number(u.carryState.sp, 0, 10000, 'unit.carryState.sp');
        if (u.carryState.down !== undefined) bool(u.carryState.down, 'unit.carryState.down');
      }
    }
  }
  let total = 0;
  for (const e of array(s.enemies, 100, 'enemies')) {
    keys(e, ['enemyKey', 'count', 'routeIndex', 'time', 'interval'], 'enemy'); identifier(e.enemyKey, 'enemy.enemyKey');
    number(e.count, 1, 100, 'enemy.count', true); number(e.routeIndex, 0, 255, 'enemy.routeIndex', true);
    number(e.time, 0, 1200, 'enemy.time'); number(e.interval, 0, 120, 'enemy.interval'); total += e.count;
  }
  if (total > 500) fail('enemies', 'size');
  array(s.bounties, 16, 'bounties').forEach(id => identifier(id, 'bounties'));
  keys(s.flags, ['dpInit', 'dpPerSec', 'dpMax', 'layerGainsEnabled', 'startOpCooldown'], 'flags');
  for (const [k, v] of Object.entries(s.flags)) {
    if (k === 'layerGainsEnabled') bool(v, `flags.${k}`);
    else number(v, 0, k === 'startOpCooldown' ? 120 : 99, `flags.${k}`);
  }
  return cloneScenario(s);
}
