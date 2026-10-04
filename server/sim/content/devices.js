// server/sim/content/devices.js — stage devices & special terrain (data/stages.json, research 05 §2.3–2.4).
//
// The engine already spawns active 阻隔工事 crates (obstacle devices, 100 HP) and marks active 射击台/mounds as
// obstacles that elevate operators. This module adds, per battle:
//   阻隔工事   an enemy blocked by a crate destroys it (after its attack interval even if it cannot attack: harmless
//              walkers no longer stall on a crate); map cards (`deviceOverrides`) remove crates / add or remove
//              platforms (obstacle + elevation) / activate hidden devices
//   气流        act2 m01 blowers (`trap_013_blower`, rangeTiles along `dir`): operators whose direction (`u.dir`, UP|
//              RIGHT|DOWN|LEFT) equals the blower's dir / is its opposite / is perpendicular get ATK +
//              blower_s_character[equal|opposite|vertical].atk (the m01 blowers blow DOWN); enemies moving with /
//              against the flow get move speed × (1 + blower_s_enemy[equal|opposite].move_speed)
//   沼泽 m      a unit on it (allies and ground enemies) triggers 【陷入沼泽】 on entering and every intervalSec (1) s
//              there: an enemy gains 1 layer — 2 at 重量 ≥ heavyWeight (the device's `value`, 3) — of ASPD aspdPerStack
//              (fractions are ×100 ASPD) and move speed × (1 + moveMulPerStack × layers), an operator 1 layer of the
//              ASPD part only; at most maxStacks layers; cleared on leaving
//   烟雾 g      operators on it cannot be targeted by enemy ranged attacks (stealth flag: blocked enemies still hit them)
//   深水 d      ground enemies on it: sea_drown[enemy].damage dmg/s (无来源 true 持续伤害, not 环境伤害: tags dot /
//              periodic / deepsea), ASPD attack_speed (×100), move × move_speed
//   活性源石 i  a unit on it (allies and ground enemies) gets a timed effect: damage true dmg/s, ATK + atk, ASPD +
//              attack_speed for `duration` s from its last contact — an enemy keeps it after walking off; one effect
//              per unit, its time starts again while the unit is on the tile; the tiles never switch off
//   “双眼皮”   turrets (`trap_1104_aclasert`, band 机械援助 / `deviceOverrides` alias on): ranged arts shooter on its data
//              range; ASPD + attack_speed_per_stack × L (≤ max_attack_speed), hits apply fragile 1 + damage_scale_per_stack
//              × L (≤ max_damage_scale) for the text's duration; L = the owner's highest bond layers (live)
//   盟约寒风   `startColdWind` / `kjeragColdWind` helpers for the 谢拉格 bond (every interval s all enemies cold)
// Device overrides: a player's battle input `deviceOverrides` ({ alias: bool }) and `alias` keys in its playerEffects
// params (auto_chess_change_map effects: band 机械援助, 机变 map cards) switch the devices on that player's half of
// the field only (unite / boss fields hold both halves); Battle opts.deviceOverrides switch every half.
// `deviceOverridesOf(battle)` is the union (informational).
// Terrain numbers come from `stage.special` (fallback: the device's skill blackboard, then research 05 values).
// Not implemented: the devices of act1 m05–m07 (canoe platforms, sandstorm + mounds, bushes) — weight 0 this season. The
// canoe (特制水上平台) makes its 深水区 deployable in the prep's deploy map only (server/match/board.js); the sim's Grid
// keeps those tiles NONE (grid.js DEPLOY_REFUSED_TILES), so automatic placements never use them [ASSUMED].

import { COLS, ROWS } from '../constants.js';
import { performAttack } from '../ai.js';
import { sortEnemyTargets } from '../targeting.js';
import { DIR_VEC, normDir, oppositeDir } from '../dir.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
/** ASPD blackboard values: a fraction (|v| < 1, e.g. −0.6 / −0.05) is ×100 ASPD, otherwise flat (+20). */
const aspdOf = (v) => (Math.abs(v) < 1 ? v * 100 : v);

export const TERRAIN = Object.freeze({ mire: 1, smog: 2, deepsea: 3, infection: 4 });
const TERRAIN_NAME = ['', 'mire', 'smog', 'deepsea', 'infection'];
const BUFF = { 1: 'terrain:mire', 2: 'terrain:smog', 3: 'terrain:deepsea', 4: 'terrain:infection' };
const AIRFLOW = 'terrain:airflow';
const CRATE_KEY = 'trap_1105_accrate';
const TURRET_KEY = 'trap_1104_aclasert';
/** Research 05 §2.3 values, used only when a stage has no `special` block / device blackboard. */
const RESEARCH = Object.freeze({
  mire: { intervalSec: 1, aspdPerStack: -0.05, moveMulPerStack: -0.05, maxStacks: 10, heavyWeight: 3 },
  deepsea: { damage: 40, attack_speed: -0.6, move_speed: 0.6 },
  infection: { damage: 70, atk: 0.2, attack_speed: 20, duration: 300 },
});

const STATE = new WeakMap();
const stateOf = (battle) => STATE.get(battle) ?? null;

// ---------------------------------------------------------------------------------------------------------------
// device overrides

const truthy = (v) => (typeof v === 'number' ? v !== 0 : typeof v === 'string' ? v !== '0' && v !== '' && v !== 'false' : !!v);

function addOverrides(m, obj) {
  if (!obj || typeof obj !== 'object') return m;
  for (const [k, v] of Object.entries(obj)) if (k.includes('#')) m.set(k, truthy(v));
  return m;
}

/** Device overrides of one player (battle input `deviceOverrides` + playerEffects params): Map alias → active. */
export function playerDeviceOverrides(ps) {
  const m = new Map();
  if (!ps) return m;
  addOverrides(m, ps.input?.deviceOverrides);
  for (const e of ps.playerEffects || []) addOverrides(m, e?.params);
  return m;
}

/** Union of device overrides for this battle: Map alias → active. */
export function deviceOverridesOf(battle) {
  const m = new Map();
  for (const ps of battle.players || []) for (const [k, v] of playerDeviceOverrides(ps)) m.set(k, v);
  addOverrides(m, battle.opts?.deviceOverrides);
  return m;
}

const aliasOf = (d) => d?.raw?.alias ?? d?.alias ?? null;
function dataActive(d) {
  return d.raw && typeof d.raw.active === 'boolean' ? d.raw.active : !d.hidden && d.active !== false;
}
/**
 * Override of a device (true / false, undefined = none). A device belongs to the player whose half of the field
 * holds it (the stage has one alias group per half: #0xx own board, #1xx partner half, #2xx/#3xx boss halves); map
 * cards (“移除场地上全部阻隔工事”) and band 机械援助 (“所有场地中出现1个”) change the owner's own half only — a
 * partner's card never removes this player's crates, a partner's band never adds a turret scaling with this player's
 * layers. Battle-level overrides (opts.deviceOverrides) apply to every half.
 */
function overrideOf(battle, st, d) {
  const a = aliasOf(d);
  if (a == null) return undefined;
  const owner = playerForCol(battle, d.col);
  const mine = owner != null ? st.byPlayer.get(owner) : null;
  if (mine && mine.has(a)) return mine.get(a);
  if (st.global.has(a)) return st.global.get(a);
  return undefined;
}
function isActive(battle, st, d) {
  const o = overrideOf(battle, st, d);
  return o === undefined ? dataActive(d) : o;
}

// ---------------------------------------------------------------------------------------------------------------
// cold wind (谢拉格 bond)

/**
 * Every `interval` s (first gust after `first` s, default = interval) all enemies on the field become cold for
 * `duration` s (a number or `() => number`, evaluated per gust — layers can change mid-battle). A cold enemy that
 * gets cold again freezes (engine rule). `playerId` only tags the fx; `ownerOnly` limits the gust to enemies
 * attributed to that player. Returns { cancel() } or null for bad numbers.
 */
export function startColdWind(battle, { playerId = null, interval, duration, first, ownerOnly = false } = {}) {
  const iv = num(interval, 0);
  if (!(iv > 0)) return null;
  const durOf = () => num(typeof duration === 'function' ? duration() : duration, 0);
  const handle = { cancelled: false, gusts: 0, timer: null, cancel() { this.cancelled = true; this.timer?.cancel(); } };
  const gust = () => {
    if (handle.cancelled || battle.finished) return;
    const dur = durOf();
    if (!(dur > 0)) return;
    let n = 0;
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden) continue;
      if (ownerOnly && playerId != null && e.ownerId !== playerId) continue;
      if (battle.applyStatus(e, 'cold', { duration: dur, source: null })) n++;
    }
    handle.gusts++;
    const R = battle.rect;
    battle.fx('coldWind', { x: (R.c0 + R.c1) / 2, y: (R.r0 + R.r1) / 2, playerId, n, duration: dur });
  };
  const firstDelay = Math.max(0, num(first, iv));
  handle.timer = battle.after(firstDelay, () => {
    if (handle.cancelled) return;
    gust();
    handle.timer = battle.every(iv, gust);
  });
  return handle;
}

/**
 * 谢拉格 6-member wind from the bond effect blackboard (effects.json bondeffect_kjerag `env_gbuff_new` bb):
 * interval `bond_eff_kjerag[storm].interval`, duration `base_time + time_per_stack × layers` (live 谢拉格 layers).
 */
export function kjeragColdWind(battle, playerId, bb = {}, { bondId = 'kjeragShip' } = {}) {
  const interval = num(bb['bond_eff_kjerag[storm].interval'], 0);
  const base = num(bb['bond_eff_kjerag[storm].base_time'], 0);
  const per = num(bb['bond_eff_kjerag[storm].time_per_stack'], 0);
  const layers = () => num(battle.getPlayer(playerId)?.bonds?.[bondId]?.layers, 0);
  return startColdWind(battle, { playerId, interval, duration: () => base + per * layers() });
}

// ---------------------------------------------------------------------------------------------------------------
// turrets (“双眼皮”)

/** Highest bond layer count of a player (live copy: in-battle gains included). */
function topLayers(battle, playerId) {
  const bonds = battle.getPlayer(playerId)?.bonds;
  let L = 0;
  if (bonds && typeof bonds === 'object') for (const b of Object.values(bonds)) L = Math.max(L, num(b?.layers, 0));
  return L;
}

function playerForCol(battle, c) {
  if (!battle.players.length) return null;
  if (battle.players.length === 1) return battle.players[0].playerId;
  const half = c >= 11 ? 'R' : 'L';
  return (battle.players.find((p) => p.half === half) ?? battle.players[0]).playerId;
}

/**
 * Tile for a turret: its own position when it is inside the field and free, else the nearest free in-rect tile
 * nobody can deploy on — off the enemy paths first (void before a lane / gate: act2 m01's turrets stand on row 8,
 * outside the normal field, and would otherwise land on the red gate).
 */
function deviceTile(battle, r0, c0) {
  const R = battle.rect;
  let best = null, bs = null;
  for (let r = R.r0; r <= R.r1; r++) {
    for (let c = R.c0; c <= R.c1; c++) {
      if (battle.isReservedTile(r, c)) continue;
      const exact = r === r0 && c === c0;
      if (!exact && battle.grid.tile(r, c).build !== 'NONE') continue;
      const walk = !exact && battle.grid.groundPassable(r, c, true) ? 1 : 0;
      const s = [exact ? 0 : 1, walk, Math.hypot(r - r0, c - c0), r * COLS + c];
      let less = !bs;
      if (!less) for (let i = 0; i < s.length; i++) { if (s[i] < bs[i] - 1e-9) { less = true; break; } if (s[i] > bs[i] + 1e-9) break; }
      if (less) { best = [r, c]; bs = s; }
    }
  }
  return best;
}

function spawnTurret(battle, st, d) {
  const alias = aliasOf(d) ?? `${d.key}@${d.row},${d.col}`;
  if (st.turrets.has(alias)) return st.turrets.get(alias);
  const tiles = (d.raw?.rangeTiles ?? []).filter((p) => Array.isArray(p) && battle.grid.inRect(p[0], p[1]));
  if (!tiles.length) return null; // shoots at nothing on this field
  const tile = deviceTile(battle, d.row, d.col);
  if (!tile) return null;
  const stats = d.raw?.stats ?? d.stats ?? {};
  const u = battle.spawnDevice(d.key, tile[0], tile[1], {
    hp: num(stats.maxHp, 100), blockCnt: 0, name: d.name ?? d.raw?.name ?? d.key,
    atk: num(stats.atk, 0), def: num(stats.def, 0), res: num(stats.res, 0), bat: num(stats.bat, 1), aspd: num(stats.aspd, 100),
  });
  if (!u) return null;
  const skill = d.raw?.skill ?? {};
  const bb = skill.bb ?? {};
  const durM = String(skill.desc ?? skill.description ?? '').match(/持续(\d+(?:\.\d+)?)秒/);
  u.ownerId = playerForCol(battle, d.col);
  u.dir = u.ownerId != null ? (battle.getPlayer(u.ownerId)?.dir ?? 'RIGHT') : 'RIGHT';
  u.mem.turret = {
    alias,
    keys: tiles.map(([r, c]) => r * COLS + c),
    baseAspd: u.base.aspd,
    aspdPer: num(bb.attack_speed_per_stack, 0),
    aspdMax: num(bb.max_attack_speed, Infinity),
    fragPer: num(bb.damage_scale_per_stack, 0),
    fragMax: num(bb.max_damage_scale, Infinity),
    fragDur: durM ? +durM[1] : 0,
    cd: 0,
  };
  st.turrets.set(alias, u);
  battle.fx('turretOnline', { x: u.x, y: u.y, id: u.id, alias });
  return u;
}

const TURRET_PROFILE = Object.freeze({ attack: 'ranged', dmgType: 'arts', projectile: 'bolt', canHitFly: true, maxTargets: 1, atkScale: 1 });

function tickTurret(battle, u, dt) {
  const T = u.mem.turret;
  if (!u.alive || !T) return;
  T.cd -= dt;
  if (T.cd > 0 || u.s.flags.stun) return;
  const L = u.ownerId != null ? topLayers(battle, u.ownerId) : 0;
  const bonus = Math.min(L * T.aspdPer, T.aspdMax);
  if (Math.abs(u.base.aspd - (T.baseAspd + bonus)) > 1e-9) { u.base.aspd = T.baseAspd + bonus; u.markDirty(); }
  const cands = battle.enemiesInKeys(T.keys, u, TURRET_PROFILE);
  if (!cands.length) { T.cd = 0; return; }
  sortEnemyTargets(battle, u, cands, null);
  const frag = Math.min(1 + L * T.fragPer, T.fragMax) - 1;
  const prof = {
    ...TURRET_PROFILE,
    afterHit: (b, src, target) => {
      if (frag > 0 && T.fragDur > 0 && target && target.alive) b.applyStatus(target, 'fragile', { duration: T.fragDur, value: frag, source: src });
    },
  };
  performAttack(battle, u, prof, [cands[0]]);
  T.cd = u.s.interval;
}

/** Activate “双眼皮” turrets on this field (all known aliases by default; idempotent). Returns the turret units. */
export function activateTurrets(battle, { aliases = null } = {}) {
  const st = stateOf(battle);
  if (!st) return [];
  const out = [];
  for (const d of battle.stage?.devices || []) {
    if (d.key !== TURRET_KEY && d.role !== 'turret') continue;
    if (aliases && !aliases.includes(aliasOf(d))) continue;
    const u = spawnTurret(battle, st, d);
    if (u) out.push(u);
  }
  ensureTick(battle, st);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// terrain

function buildTerrain(battle, st) {
  const R = battle.rect;
  let any = false;
  for (let r = R.r0; r <= R.r1; r++) {
    for (let c = R.c0; c <= R.c1; c++) {
      const code = TERRAIN[battle.grid.tile(r, c).terrain] ?? 0;
      if (code) { st.terrain[r * COLS + c] = code; any = true; }
    }
  }
  st.hasTerrain = any;
  const sp = battle.stage?.special || {};
  const devSkill = (role) => (battle.stage?.devices || []).find((d) => d.role === role)?.raw?.skill?.bb ?? null;
  // mire
  const m = sp.mire || {};
  const mdev = devSkill('mireController') || {};
  // the device skill's `value` (3) is the 重量 from which an enemy gains 2 layers, not an interval (PRTS 沼泽控制)
  const mInterval = num(m.intervalSec, RESEARCH.mire.intervalSec);
  st.mire = {
    interval: mInterval > 0 ? mInterval : RESEARCH.mire.intervalSec,
    aspdPer: aspdOf(num(m.aspdPerStack ?? mdev.attack_speed, RESEARCH.mire.aspdPerStack)),
    movePer: num(m.moveMulPerStack ?? mdev.move_speed, RESEARCH.mire.moveMulPerStack),
    max: Math.max(1, Math.floor(num(m.maxStacks ?? mdev.max_stack_cnt, RESEARCH.mire.maxStacks))),
    heavyWeight: num(m.heavyWeight ?? mdev.value, RESEARCH.mire.heavyWeight),
  };
  // deep sea
  const ds = sp.deepsea?.bb || devSkill('tideController') || {};
  st.deepsea = {
    damage: num(ds['sea_drown[enemy].damage'], RESEARCH.deepsea.damage),
    aspd: aspdOf(num(ds['sea_drown[enemy].attack_speed'], RESEARCH.deepsea.attack_speed)),
    moveMul: num(ds['sea_drown[enemy].move_speed'], RESEARCH.deepsea.move_speed),
  };
  // active originium: `duration` is how long the effect lasts on a unit (PRTS tile template "部署于其上的我军和经过的
  // 敌军在{duration}s内…"), not a lifetime of the tiles
  const inf = sp.infection?.bb || {};
  const infDur = num(inf.duration, RESEARCH.infection.duration);
  st.infection = {
    damage: num(inf.damage, RESEARCH.infection.damage),
    atk: num(inf.atk, RESEARCH.infection.atk),
    aspd: aspdOf(num(inf.attack_speed, RESEARCH.infection.attack_speed)),
    duration: infDur > 0 ? infDur : RESEARCH.infection.duration,
  };
  // blowers
  for (const d of battle.stage?.devices || []) {
    if (d.role !== 'blower' || !isActive(battle, st, d)) continue;
    const raw = String(d.dir ?? d.raw?.dir ?? 'UP').toUpperCase();
    const f = DIR_VEC[raw];
    if (!f) continue;
    const dir = normDir(raw);
    const bb = d.raw?.skill?.bb ?? sp.blower?.bb ?? {};
    const tiles = d.raw?.rangeTiles ?? [];
    for (const p of tiles) {
      if (!Array.isArray(p) || !battle.grid.inRect(p[0], p[1])) continue;
      // world vector: x = col, y = row
      st.flow.set(p[0] * COLS + p[1], { fx: f[1], fy: f[0], dir, bb });
    }
  }
}

/** 活性源石's tick: true damage no unit deals (无来源), tagged 'terrain' = 环境伤害 ("受到来自自然环境的伤害" content reads it). */
const infectionDamage = (battle, amount) => (ctx) => {
  if (amount > 0 && ctx.unit.alive) battle.dealDamage(null, ctx.unit, { amount, type: 'true', canDodge: false, tags: ['terrain'] });
};

/**
 * 深水区's 【水蚀】 tick (PRTS 涨潮控制 技能3 深水: "每秒受到40点无来源真实持续伤害（不属于环境伤害，不会触发受击回复）"; PRTS 伤害分类
 * lists 深水区/涨潮水蚀 as BUFF damage): 无来源 true 持续伤害 — tags 'dot' (锡人's 凋敝魂灵 raises it), 'periodic' and
 * 'deepsea' (the 免疫水蚀 swimmers cancel it), no 'terrain' (not 环境伤害), no 受击回复 (noSp).
 */
const deepWaterDamage = (battle, amount) => (ctx) => {
  if (amount > 0 && ctx.unit.alive) battle.dealDamage(null, ctx.unit, { amount, type: 'true', canDodge: false, sourceless: true, noSp: true, tags: ['dot', 'periodic', 'deepsea'] });
};

function enterTerrain(battle, st, u, code) {
  const m = u.mem;
  if (m.terrain === code) return;
  // leaving a tile ends its effect — except 活性源石's, which runs out on its own (touchInfection)
  if (m.terrain && m.terrain !== TERRAIN.infection) battle.removeBuff(u, BUFF[m.terrain]);
  m.terrain = code;
  m.terrainSince = battle.time;
  m.mireStacks = 0;
  m.mireTriggers = 0;
  if (!code) return;
  if (code === TERRAIN.smog) battle.addBuff(u, { key: BUFF[code], flags: { stealth: true } });
  else if (code === TERRAIN.deepsea) {
    const D = st.deepsea;
    battle.addBuff(u, { key: BUFF[code], mods: { aspd: D.aspd, moveMul: D.moveMul }, interval: 1, onTick: deepWaterDamage(battle, D.damage) });
  }
  // mire layers are applied by tickMire, 活性源石 by touchInfection (every tick on the tile)
}

/**
 * 活性源石 contact (every tick on the tile). The tile gives a timed effect — damage true dmg/s, ATK + atk, ASPD +
 * attack_speed for `duration` s (PRTS 特殊地形 tile template: "部署于其上的我军和经过的敌军在{duration}s内每秒受到{damage}
 * 真实伤害，攻击力提升…，攻击速度增加…") — that stays on an enemy after it walks off: PRTS 危机合约 tag
 * global_tile_infection_1 「目标：可控感染」 "踏过活性源石地块的敌人不再持续损失生命值" switches the lasting HP loss off,
 * so without it the loss continues. One effect per unit (PRTS 作战机制: "同名buff的默认叠加策略buff只能表现出一个"): a
 * unit that already carries it gets its full `duration` back and keeps its per-second rhythm — no second effect, no
 * extra tick [ASSUMED: the time counts from the last contact — so an operator deployed on it, always in contact, drains
 * past `duration`]. An operator moved off the tile (Battle.relocate: 夕's 小自在 …; Battle.moveRedeploy: 乌尔比安 S3)
 * keeps it for its time; leaving the field drops it with every buff; a 重生 clears it (enemies.js rebirthCleanse: PRTS
 * 特殊机制 §重生 "清空自身身上除白名单外所有Buff") and contact gives it again while the unit is on the tile [ASSUMED]. The
 * tick (infectionDamage) is true damage no unit deals (无来源), tagged 'terrain' = 环境伤害 (PRTS 自然环境 lists 活性源石),
 * not 'dot' [ASSUMED: PRTS 伤害分类's list of BUFF damage does not name it].
 */
function touchInfection(battle, st, u) {
  const I = st.infection;
  const key = BUFF[TERRAIN.infection];
  const b = u.findBuff(key);
  if (b) { if (b.timeLeft < I.duration) b.timeLeft = I.duration; return; }
  battle.addBuff(u, { key, duration: I.duration, mods: { atkPct: I.atk, aspd: I.aspd }, interval: 1, onTick: infectionDamage(battle, I.damage) });
}

/** Layers an enemy gains per 【陷入沼泽】 trigger at 重量 ≥ heavyWeight (PRTS 沼泽控制: "若其重量大于等于3，改为获得2层"). */
const MIRE_HEAVY_LAYERS = 2;

/**
 * 沼泽 (PRTS 沼泽控制 备注): a unit in the mire triggers its 【陷入沼泽】 "每秒…一次" (the device skill charges in 1 s) — an
 * enemy gains 1 layer of ASPD −5 % and move speed −5 % (2 layers at 重量 ≥ heavyWeight, the skill's `value` 3), any other
 * unit 1 layer of ASPD −5 % only; at most 10 layers; "上述减益于单位不再位于沼泽之中时解除" (enterTerrain).
 * [ASSUMED] the first trigger comes on entering, then one every second.
 */
function tickMire(battle, st, u) {
  const M = st.mire, m = u.mem;
  const due = 1 + Math.floor((battle.time - m.terrainSince + 1e-9) / M.interval);
  if (due <= m.mireTriggers) return;
  const enemy = u.side === 'enemy';
  const per = enemy && num(u.s.massLevel, 0) >= M.heavyWeight ? MIRE_HEAVY_LAYERS : 1;
  const n = Math.min(M.max, m.mireStacks + per * (due - m.mireTriggers));
  m.mireTriggers = due;
  if (n === m.mireStacks) return;
  m.mireStacks = n;
  battle.addBuff(u, { key: BUFF[TERRAIN.mire], refresh: 'replace', mods: enemy ? { aspd: M.aspdPer * n, moveMul: Math.max(0, 1 + M.movePer * n) } : { aspd: M.aspdPer * n } });
}

/**
 * Terrain code under a unit (0 = none). Air units (Unit.isFlying: flyers, hovering 近地悬浮 and levitated enemies) and
 * hidden units ignore ground terrain; smog only helps allies.
 */
function terrainFor(battle, st, u) {
  if (u.hidden || u.isFlying) return 0;
  let k;
  if (u.side === 'ally') k = u.tileR * COLS + u.tileC;
  else {
    const r = Math.round(u.y), c = Math.round(u.x);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return 0;
    k = r * COLS + c;
  }
  let code = st.terrain[k];
  if (code === TERRAIN.smog && u.side !== 'ally') code = 0;
  if (code === TERRAIN.deepsea && u.side === 'ally') code = 0;
  return code;
}

function airflowRelation(dot) { return dot > 0.7 ? 'equal' : dot < -0.7 ? 'opposite' : 'vertical'; }
/** Operator ↔ blower: the same direction ⇒ 'equal', the reverse ⇒ 'opposite', perpendicular ⇒ 'vertical'. */
export function airflowRelationOf(unitDir, flowDir) {
  const u = normDir(unitDir), f = normDir(flowDir);
  return u === f ? 'equal' : u === oppositeDir(f) ? 'opposite' : 'vertical';
}

function tickAirflowAlly(battle, st, u) {
  const f = st.flow.get(u.tileR * COLS + u.tileC);
  let atk = 0;
  if (f && u.motion !== 'FLY') atk = num(f.bb[`blower_s_character[${airflowRelationOf(u.dir, f.dir)}].atk`], 0);
  if (atk === (u.mem.airAtk ?? 0)) return;
  u.mem.airAtk = atk;
  if (atk) battle.addBuff(u, { key: AIRFLOW, refresh: 'replace', mods: { atkPct: atk } });
  else battle.removeBuff(u, AIRFLOW);
}

function tickAirflowEnemy(battle, st, e) {
  const px = e.mem.airPx, py = e.mem.airPy;
  e.mem.airPx = e.x; e.mem.airPy = e.y;
  let mul = 1;
  if (!e.hidden && px != null) {
    const r = Math.round(e.y), c = Math.round(e.x);
    const f = r >= 0 && r < ROWS && c >= 0 && c < COLS ? st.flow.get(r * COLS + c) : null;
    const vx = e.x - px, vy = e.y - py;
    const v = Math.hypot(vx, vy);
    if (f && v > 1e-6) {
      const rel = airflowRelation((vx * f.fx + vy * f.fy) / v);
      if (rel !== 'vertical') mul = 1 + num(f.bb[`blower_s_enemy[${rel}].move_speed`], 0);
    } else if (f && v <= 1e-6) mul = e.mem.airMul ?? 1; // paused this tick (attack pause / blocked): keep the last push
  }
  if (!(mul >= 0)) mul = 0;
  if (mul === (e.mem.airMul ?? 1)) return;
  e.mem.airMul = mul;
  if (mul !== 1) battle.addBuff(e, { key: AIRFLOW, refresh: 'replace', mods: { moveMul: mul } });
  else battle.removeBuff(e, AIRFLOW);
}

/** Apply terrain / airflow state to one unit now (deploy, spawn, every tick). */
function refreshUnit(battle, st, u) {
  if (!u.alive || !u.deployed || u.kind === 'device') return;
  if (st.hasTerrain) {
    enterTerrain(battle, st, u, terrainFor(battle, st, u));
    if (u.mem.terrain === TERRAIN.mire) tickMire(battle, st, u);
    else if (u.mem.terrain === TERRAIN.infection) touchInfection(battle, st, u);
  }
  if (st.flow.size) { if (u.side === 'ally') tickAirflowAlly(battle, st, u); else tickAirflowEnemy(battle, st, u); }
}

function ensureTick(battle, st) {
  if (st.ticking) return;
  if (!st.hasTerrain && !st.flow.size && !st.turrets.size) return;
  st.ticking = true;
  battle.on('tick', ({ dt }) => {
    if (st.hasTerrain || st.flow.size) {
      for (const u of battle.allyUnits) refreshUnit(battle, st, u);
      for (const e of battle.enemies) refreshUnit(battle, st, e);
    }
    for (const u of st.turrets.values()) tickTurret(battle, u, dt);
  });
  // a unit that (re)deploys / spawns starts fresh (death drops its buffs) and gets its tile's terrain at once: smog
  // must already hide an operator from the first enemy shot of the battle. A 【移动】 (ctx.move: 乌尔比安 S3,
  // Battle.moveRedeploy) keeps its buffs, so it changes tiles like a walk instead: starting from nothing would strand
  // the old tile's smog / airflow buff on it
  battle.on('deploy', (ctx) => {
    const u = ctx.unit;
    if (!u || !u.mem || u.kind === 'device') return;
    if (!ctx.move) { u.mem.terrain = 0; u.mem.airAtk = 0; u.mem.airMul = 1; u.mem.airPx = null; }
    refreshUnit(battle, st, u);
  }, { priority: 90 });
}

/** Terrain name under (r, c) for other content ('mire' | 'smog' | 'deepsea' | 'infection' | null). */
export function terrainAt(battle, r, c) {
  const st = stateOf(battle);
  const code = st && r >= 0 && r < ROWS && c >= 0 && c < COLS ? st.terrain[r * COLS + c] : 0;
  return TERRAIN_NAME[code] || null;
}

// ---------------------------------------------------------------------------------------------------------------
// install

export function install(battle) {
  const st = {
    byPlayer: new Map((battle.players || []).map((ps) => [ps.playerId, playerDeviceOverrides(ps)])),
    global: addOverrides(new Map(), battle.opts?.deviceOverrides),
    terrain: new Uint8Array(ROWS * COLS),
    hasTerrain: false,
    flow: new Map(),
    turrets: new Map(),
    platformOn: new Set(),
    platformOff: new Set(),
    crateOff: new Set(),
    ticking: false,
  };
  STATE.set(battle, st);
  const devices = battle.stage?.devices || [];
  buildTerrain(battle, st); // grid, stage `special` and overrides are known at construction
  ensureTick(battle, st);

  // overrides that differ from the data (per half owner): crates removed, platforms added/removed
  for (const d of devices) {
    if (!battle.grid.inRect(d.row, d.col)) continue;
    const on = overrideOf(battle, st, d);
    if (on === undefined || on === dataActive(d)) continue;
    const k = d.row * COLS + d.col;
    if (d.role === 'crate' && !on) st.crateOff.add(k);
    if (d.role === 'platform' || d.role === 'mound') (on ? st.platformOn : st.platformOff).add(k);
  }

  battle.on('deploy', (ctx) => {
    const u = ctx.unit;
    if (!u || u.side !== 'ally') return;
    const k = u.tileR * COLS + u.tileC;
    if (u.kind === 'device') {
      // stage crates switched off by a map card vanish before anybody deploys on their tile
      if (u.defId === CRATE_KEY && st.crateOff.has(k) && !st.started) { u.mem.removedByOverride = true; battle.retreat(u, { reason: 'removed', permanent: true }); }
      return;
    }
    if (st.platformOn.has(k)) u.ground = false;
    else if (st.platformOff.has(k)) u.ground = battle.grid.isLow(u.tileR, u.tileC);
  }, { priority: 100 });

  // an enemy stopped by a crate breaks it (the engine lets attackers chop it; this also covers harmless walkers)
  battle.on('blocked', ({ blocker, enemy }) => {
    if (!blocker || blocker.kind !== 'device' || blocker.defId !== CRATE_KEY) return;
    const delay = Math.max(0.1, Math.min(10, num(enemy.s.interval, 1)));
    battle.after(delay, () => {
      if (blocker.alive && enemy.alive && enemy.blockedBy === blocker) {
        battle.fx('crateBreak', { x: blocker.x, y: blocker.y, id: blocker.id });
        battle.kill(blocker, enemy);
      }
    });
  });

  battle.on('battleStart', () => {
    st.started = true;
    // platforms switched by map cards (the engine applied the data state)
    for (const k of st.platformOn) battle.setObstacle((k / COLS) | 0, k % COLS, true);
    for (const k of st.platformOff) battle.setObstacle((k / COLS) | 0, k % COLS, false);
    // hidden crates switched on by an override
    for (const d of devices) {
      if (d.role !== 'crate' || dataActive(d) || !isActive(battle, st, d) || !battle.grid.inRect(d.row, d.col) || battle.unitAt(d.row, d.col)) continue;
      battle.spawnDevice(d.key, d.row, d.col, { hp: num(d.stats?.maxHp ?? d.raw?.stats?.maxHp, 100), obstacle: true, name: d.name });
    }
    // “双眼皮” turrets switched on (band 机械援助 / overrides)
    for (const d of devices) if ((d.key === TURRET_KEY || d.role === 'turret') && isActive(battle, st, d)) spawnTurret(battle, st, d);
    ensureTick(battle, st);
  }, { priority: 50 });
}

export function registerMeta(registry) {} // map cards / band 机械援助 reach the battle through deviceOverrides
