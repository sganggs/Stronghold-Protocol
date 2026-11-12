// 规程·序列Ⅰ bonds (act3autochess V3_1). One battle or prep check per clause.
// Numbers come from data/versions/act3autochess-v3_1. Band swaps are a changed effectId
// (auto_chess_effect_replace is not implemented). setGameData is process-global, so this file is serial.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { acquireTargets } from '../../server/sim/ai.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { payKjeragIce, tempBondLayers, EFFECT_KEYED_BONDS } from '../../server/sim/content/bonds/regulation.js';
import { bondBb } from '../../server/sim/content/bonds/addon/battle.js';
import { registerMeta as registerAddonMeta } from '../../server/sim/content/bonds/addon/meta.js';
import { registerSupportMeta } from '../../server/sim/content/support/meta.js';
import { hasBattleEffect, itemGrants } from '../../server/sim/content/items/battle.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {}, log() {} });
const NOTE = 'enemy_9025_aclts';
const CHORUS = 'enemy_9026_acltm';
const GIANT = 'enemy_9024_acsgnt';
const YANYOU = 'enemy_9012_acloon';

let V3 = null;
function v3() {
  if (!V3) V3 = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: QUIET });
  return V3;
}

function params(rec, key) {
  for (const b of rec?.buffs || []) {
    const k = b?.bbStr?.key || b?.key;
    if (k === key) return { ...(b.bb || {}), ...(b.bbStr || {}) };
  }
  return {};
}
function effectParams(effectId, key) {
  return params(v3().effects[effectId], key);
}

function close(a, b, msg, eps = 0.05) {
  assert.ok(Number.isFinite(a) && Math.abs(a - b) <= eps, `${msg}: expected ${b}, got ${a}`);
}
function gauges(u) {
  const e = u.elem || {};
  return (e.burn || 0) + (e.neural || 0) + (e.necrosis || 0) + (e.apoptosis || 0) + (e.erosion || 0);
}
function abnormal(u) {
  const f = u.s?.flags || {};
  if (f.stun || f.cold || f.fear || f.attract || f.groundbind) return true;
  return !!(u.buffs && u.buffs.some((b) => b.status === 'palsy' || b.palsy));
}
function bond(count, layers = 0, tier = null) {
  return { count, active: true, tier: tier ?? (count >= 6 ? 2 : 1), layers };
}
function piece(id, bonds, o = {}) {
  const rec = chessRec({
    id, bonds, golden: !!o.golden,
    position: o.position,
    profession: o.profession ?? 'WARRIOR',
    skill: o.skill === undefined ? { spCost: 100, duration: 10, skillType: 'MANUAL', initSp: 0 } : o.skill,
    rangeGrid: o.rangeGrid,
    stats: { atk: 500, def: o.def ?? 0, maxHp: o.hp ?? 2000, bat: o.bat ?? 100, res: 0, ...(o.stats || {}) },
  });
  return {
    rec, bench: !!o.bench, ownerId: o.ownerId ?? 'p1',
    place: { chessId: id, row: o.row ?? 10, col: o.col ?? 4, items: o.items, uid: o.uid },
  };
}

function fight(t, spec) {
  const base = v3();
  const chess = { ...base.chess };
  const pieces = spec.pieces || [];
  for (const p of spec.pieces || []) {
    chess[p.rec.chessId] = p.rec;
  }
  let bondsTable = base.bonds;
  if (spec.effectId) {
    const id = spec.bondId;
    bondsTable = { ...base.bonds, [id]: { ...base.bonds[id], effectId: spec.effectId } };
  }
  const data = {
    ...base, bonds: bondsTable, chess,
    enemies: {
      ...base.enemies,
      reg_tank: enemyRec({ key: 'reg_tank', hp: 1e7, def: 0, res: 0, atk: 0, speed: 0 }),
    },
  };
  setGameData(data);
  t.after(() => setGameData(null));
  const players = spec.players ?? [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
    bonds: spec.bonds,
    contentInfo: spec.contentInfo,
  }];
  const unitsByOwner = new Map(players.map((p) => [p.playerId, []]));
  let nextUid = 1;
  for (const p of pieces) {
    if (p.bench) continue;
    const units = unitsByOwner.get(p.ownerId);
    assert.ok(units, `piece owner ${p.ownerId} must be a configured player`);
    units.push({ uid: p.place.uid ?? nextUid, kind: 'chess', ...p.place });
    nextUid++;
  }
  const playerInputs = players.map((p) => ({
    ...p,
    units: unitsByOwner.get(p.playerId),
    bonds: p.bonds ?? (p.playerId === 'p1' ? spec.bonds : {}),
    contentInfo: p.contentInfo ?? (p.playerId === 'p1' ? spec.contentInfo : undefined),
  }));
  return makeBattle({
    seed: spec.seed ?? 1,
    data,
    stage: spec.stage,
    timeLimit: spec.timeLimit ?? 90,
    autoFinish: false,
    enemies: spec.spawns,
    flat: spec.flat,
    routes: spec.routes,
    players: playerInputs,
  });
}

function tank(h, pos) {
  const e = h.spawn('reg_tank', { pos });
  assert.ok(e && e.alive, `tank at ${pos}`);
  return e;
}
function yanyou(h) {
  return h.b.allyUnits.filter((u) => u.defId === YANYOU && u.alive).length;
}
function living(h, id) {
  return h.b.allyUnits.filter((u) => u.alive && !u.removed && (u.defId === id || u.def?.baseId === id));
}
function lethaniaSummons(h, ownerId = null) {
  return h.b.allyUnits.filter((u) => u.alive && !u.removed && u.kind === 'token'
    && (u.defId === NOTE || u.defId === CHORUS) && (!ownerId || u.ownerId === ownerId));
}
function assertLethaniaRuntime(h) {
  assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  for (const u of h.b.units) {
    assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y), `${u.defId} has a finite position`);
    if (u.alive) assert.ok(u.hp >= 0 && u.hp <= u.s.maxHp + 1e-6, `${u.defId} hp is in range`);
    if (u.mem?.lethaniaPursuit) {
      assert.equal(h.b._occ.includes(u), false, `${u.defId} does not claim deployment occupancy`);
      assert.ok(h.b.grid.inRect(u.tileR, u.tileC), `${u.defId} stays inside the battle rect`);
    } else if (u.side === 'ally' && u.alive && u.deployed && !u.hidden) {
      assert.equal(h.b.unitAt(u.tileR, u.tileC), u, `${u.defId} keeps its ordinary deployment occupancy`);
    }
    if (u.side === 'enemy' && u.blockedBy) assert.ok(u.blockedBy.blocking.includes(u), `${u.defId} block link is consistent`);
  }
}

function addonHandlers() {
  const handlers = {};
  registerAddonMeta({
    global() {},
    bond(id, h) { handlers[id] = h; },
    get(id) { return handlers[id] ?? null; },
  });
  return handlers;
}

describe('规程·序列Ⅰ bonds', { concurrency: 1 }, () => {
  test('five reused ids dispatch by effectId; 拉特兰 is not in the season', () => {
    assert.deepEqual([...EFFECT_KEYED_BONDS].sort(), ['kazimierzShip', 'kjeragShip', 'sargonShip', 'siracusaShip', 'yanShip']);
    assert.equal(v3().bonds.lateranoShip, undefined);
    assert.equal(Object.keys(v3().bonds).length, 26);
  });

  test('spawnOperator fields a chess and refuses a taken, down, or out-of-rect tile', (t) => {
    const id = 'reg_spawn';
    const h = fight(t, {
      bonds: {},
      pieces: [piece(id, [], { row: 10, col: 4, skill: null })],
    });
    h.step();
    const open = h.b.spawnOperator('p1', id, 10, 6);
    assert.ok(open && open.alive && open.tileR === 10 && open.tileC === 6);
    assert.equal(h.b.spawnOperator('p1', id, 10, 6), null);
    assert.equal(h.b.spawnOperator('p1', id, 99, 0), null);
    h.b.dealDamage({ source: null, target: open, amount: 1e9, type: 'true' });
    assert.equal(open.alive, false);
    assert.equal(h.b.spawnOperator('p1', id, 10, 6), null);
    open.removed = true;
    const again = h.b.spawnOperator('p1', id, 10, 6);
    assert.ok(again && again.alive && again.tileC === 6);
    h.invariants();
  });

  test('contentInfo.handPieces lists chess only, with bonds and position', () => {
    const handlers = {};
    registerSupportMeta({ global(id, h) { handlers[id] = h; }, bond() {} });
    const input = {};
    const ctx = {
      hand: () => [{ kind: 'chess', id: 'a', uid: 1 }, { kind: 'item', id: 'x' }, { kind: 'chess', id: 'b', uid: 2 }],
      roundStats: () => ({}), teammates: () => [], bandId: () => null, shopLevel: () => 1, funds: () => 0, round: 1,
      chessRecord: (id) => ({ position: id === 'a' ? 'melee' : 'RANGED', bonds: [] }),
      pieceBonds: (uid) => (uid === 1 ? ['kazimierzShip'] : ['egirShip']),
    };
    handlers.contentb_info.onBattleStart(ctx, { input, kind: 'normal' });
    assert.deepEqual(input.contentInfo.handPieces, [
      { slot: 0, id: 'a', bonds: ['kazimierzShip'], position: 'MELEE' },
      { slot: 2, id: 'b', bonds: ['egirShip'], position: 'RANGED' },
    ]);
  });

  test('谢拉格不融冰 pays every 100 layers and no-ops without the reward key', (t) => {
    setGameData(v3());
    t.after(() => setGameData(null));
    const ice = (layers, data) => {
      const counters = {};
      const granted = [];
      const toasts = [];
      const n = payKjeragIce({
        bondActive: () => true,
        data: data ?? v3(),
        layers: () => layers,
        counter: (k) => counters[k] || 0,
        setCounter: (k, v) => { counters[k] = v; },
        rollItem: () => 'ice_item',
        grantItem: (id) => { granted.push(id); return true; },
        toast: (m) => toasts.push(m),
      });
      return { n, granted, counters, toasts };
    };
    const a = ice(100);
    assert.equal(a.n, 1);
    assert.deepEqual(a.granted, ['ice_item']);
    assert.equal(a.toasts[0].msgid, '【谢拉格】获得{n}件谢拉格不融冰');
    const b = ice(200);
    assert.equal(b.n, 2);
    assert.equal(ice(99).n, 0);
    const bare = { bonds: { kjeragShip: { effectId: 'bondeffect_kjerag', buffs: [] } } };
    const c = ice(500, bare);
    assert.equal(c.n, 0);
    assert.equal(c.counters['bond:kjerag:ice'] || 0, 0);
    const reg = createRegistry({ log: QUIET });
    assert.equal(typeof reg.get('bond:kjeragShip').onLayers, 'function');
  });

  test('炎_2: ATK ratio, element at 6, burst-lock rate; no 炎佑', (t) => {
    const bb = effectParams('bondeffect_yan_2', 'act3autochess_bond_eff_yan');
    const enemy = effectParams('bondeffect_yan_2', 'act3autochess_bond_eff_yan[enemy]');
    assert.equal(bb.atk_base, 0.23);
    assert.equal(bb.ex_atk_scale_base, 0.06);
    assert.equal(enemy.ep_break_recover_speed_base, 0.4);
    const low = fight(t, {
      bonds: { yanShip: bond(3, 0, 1) },
      pieces: [piece('reg_yan', ['yanShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    low.step();
    const m = low.unit('reg_yan');
    close(m.s.atk, 500 * 1.23, 'yan atk below 6');
    const e0 = tank(low, [9, 4]);
    low.b.dealDamage({ source: m, target: e0, amount: 100, type: 'phys' });
    assert.equal(gauges(e0), 0);
    assert.equal(yanyou(low), 0);

    const h = fight(t, {
      bonds: { yanShip: bond(6, 0) },
      pieces: [piece('reg_yan6', ['yanShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    h.step();
    assert.equal(yanyou(h), 0);
    const u = h.unit('reg_yan6');
    const e = tank(h, [9, 4]);
    const hp0 = e.hp;
    h.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' });
    close(hp0 - e.hp, 100, 'yan phys');
    close(gauges(e), 0.06 * u.s.atk, 'yan element');
    const lock = h.b.addBuff(e, { key: 'lock', duration: 10, flags: { burstLock: true } });
    const left0 = (lock && lock.timeLeft) || e.findBuff('lock').timeLeft;
    h.run(0.55);
    const left = e.findBuff('lock').timeLeft;
    assert.ok(left < left0 - 0.55 - 0.1, `burst lock ${left} from ${left0}`);
  });

  test('炎 swapped back to bondeffect_yan spawns 炎佑 at 6', (t) => {
    const h = fight(t, {
      bondId: 'yanShip', effectId: 'bondeffect_yan',
      bonds: { yanShip: bond(6, 0) },
      pieces: [piece('reg_yan_old', ['yanShip'])],
    });
    h.step();
    assert.equal(yanyou(h), 1);
    close(h.unit('reg_yan_old').s.atk, 500 * 1.23, '盟约 yan atk');
  });

  test('萨尔贡_2: ASPD on skill, slow in range, magic pulses', (t) => {
    const main = effectParams('bondeffect_sargon_2', 'act3autochess_bond_eff_sargon');
    assert.equal(main.base_attack_speed, 12);
    assert.equal(main.base_time, 5);
    const slow = fight(t, {
      bonds: { sargonShip: bond(6, 0) },
      pieces: [piece('reg_sar', ['sargonShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    slow.step();
    const e = tank(slow, [9, 4]);
    slow.run(1.1);
    const buff = e.findBuff('bond:sargon:slow');
    assert.ok(buff, 'slow while in range');
    close(buff.mods.moveMul, 0.8, 'slow 0.2');
    const u = slow.unit('reg_sar');
    assert.ok(u.skill.activate('test', { free: true }));
    slow.run(1.1);
    const stacks = u.buffs.filter((b) => b.key === 'bond:sargon');
    assert.ok(stacks.length >= 1 && stacks.length <= 25);
    close(stacks[0].mods.aspd, 12, 'aspd');
    const slowed = e.findBuff('bond:sargon:slow');
    close(slowed.mods.moveMul, 0.6, 'slow doubles while a skill is up');

    const mag = fight(t, {
      bonds: { sargonShip: bond(6, 0) },
      pieces: [piece('reg_sar_m', ['sargonShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    const em = tank(mag, [9, 4]);
    mag.step(); // the opening swing lands on the first tick; bat 100 holds the next one
    const hp = em.hp;
    mag.run(5.2);
    close(hp - em.hp, 5000, 'magic every 5s');

    const mag2 = fight(t, {
      bonds: { sargonShip: bond(6, 0) },
      pieces: [piece('reg_sar_2', ['sargonShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    const e2 = tank(mag2, [9, 4]);
    mag2.step();
    assert.ok(mag2.unit('reg_sar_2').skill.activate('test', { free: true }));
    const hp2 = e2.hp;
    mag2.run(1.1);
    close(hp2 - e2.hp, 800, 'magic_2 while the skill is up');
    assert.equal(!!e2.s.flags.bind, false);
  });

  test('萨尔贡 swapped to bondeffect_sargon keeps the 盟约 ASPD buff and no tile slow', (t) => {
    const old = effectParams('bondeffect_sargon', 'act1autochess_bond_eff_sargon');
    const h = fight(t, {
      bondId: 'sargonShip', effectId: 'bondeffect_sargon',
      bonds: { sargonShip: bond(6, 0) },
      pieces: [piece('reg_sar_old', ['sargonShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    h.step();
    const e = tank(h, [9, 4]);
    const u = h.unit('reg_sar_old');
    assert.ok(u.skill.activate('test', { free: true }));
    const stacks = u.buffs.filter((b) => b.key === 'bond:sargon');
    assert.equal(stacks.length, 1);
    close(stacks[0].mods.aspd, old.base_attack_speed, '盟约 aspd');
    h.run(1.1);
    assert.equal(e.findBuff('bond:sargon:slow'), null);
  });

  test('谢拉格_2: damage mul, cold bonus, giant at start, no wind; ice is the grant test', (t) => {
    const bb = effectParams('bondeffect_kjerag_2', 'act3autochess_bond_eff_kjerag');
    assert.equal(bb.base_damage_scale, 1.25);
    assert.equal(bb.base_ex_damage_scale, 1.35);
    const h = fight(t, {
      bonds: { kjeragShip: bond(6, 0) },
      timeLimit: 40,
      pieces: [piece('reg_kj', ['kjeragShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    h.step();
    const g = h.b.allyUnits.find((u) => u.defId === GIANT && u.alive);
    assert.ok(g, '雪山巨人');
    close(g.s.atk, 920 * 1.5, 'giant atk L=0');
    close(g.s.maxHp, 21000, 'giant hp L=0');
    assert.equal(g.s.blockCnt, 3);
    const u = h.unit('reg_kj');
    const e = tank(h, [9, 4]);
    const hp = e.hp;
    h.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' });
    close(hp - e.hp, 125, 'kjerag damage');
    h.b.applyStatus(e, 'cold', { duration: 5, source: u });
    const hp2 = e.hp;
    h.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' });
    close(hp2 - e.hp, 135, 'cold raises the mul to 1.35');
    const far = tank(h, [2, 18]);
    const storm = effectParams('bondeffect_kjerag', 'act1autochess_bond_eff_kjerag');
    h.run(storm['bond_eff_kjerag[storm].interval'] + 1);
    assert.equal(!!far.s.flags.cold, false);
    assert.equal(!!far.s.flags.freeze, false);
  });

  test('谢拉格 swapped to bondeffect_kjerag blows the cold wind and summons no giant', (t) => {
    const storm = effectParams('bondeffect_kjerag', 'act1autochess_bond_eff_kjerag');
    assert.equal(storm['bond_eff_kjerag[storm].interval'], 25);
    const h = fight(t, {
      bondId: 'kjeragShip', effectId: 'bondeffect_kjerag',
      bonds: { kjeragShip: bond(6, 0) },
      timeLimit: 40,
      pieces: [piece('reg_kj_old', ['kjeragShip'])],
    });
    h.step();
    assert.equal(h.b.allyUnits.filter((u) => u.defId === GIANT).length, 0);
    const e = tank(h, [2, 18]);
    h.run(1);
    assert.equal(!!e.s.flags.cold, false);
    h.run(storm['bond_eff_kjerag[storm].interval']);
    assert.equal(!!e.s.flags.cold, true);
  });

  test('谢拉格 giant scales by floor(layers / stackStep)', (t) => {
    const h = fight(t, {
      bonds: { kjeragShip: bond(6, 3) },
      pieces: [piece('reg_kj3', ['kjeragShip'])],
    });
    h.step();
    const g = h.b.allyUnits.find((u) => u.defId === GIANT && u.alive);
    assert.ok(g);
    close(g.s.atk, 920 * 1.51, 'giant atk one step');
    close(g.s.maxHp, 21000 * 1.02, 'giant hp one step');
  });

  test('叙拉古_2: ASPD on deploy, a random abnormal at 6, true pulse around two abnormals', (t) => {
    const bb = effectParams('bondeffect_siracusa_2', 'act3autochess_bond_eff_siracusa');
    assert.equal(bb.base_attack_speed, 25);
    assert.equal(bb.damage_value_base, 800);
    assert.equal(bb.prob, 0.3);
    const h = fight(t, {
      bonds: { siracusaShip: bond(6, 0) },
      pieces: [piece('reg_sir', ['siracusaShip'])],
    });
    h.step();
    const u = h.unit('reg_sir');
    close(u.s.aspd, 125, 'siracusa aspd');
    assert.equal(!!u.s.flags.stealth, false);
    const a = tank(h, [9, 8]);
    const b = tank(h, [9, 9]);
    h.b.applyStatus(a, 'stun', { duration: 5, source: null });
    h.b.applyStatus(a, 'cold', { duration: 5, source: null });
    const ha = a.hp, hb = b.hp;
    h.run(1.1);
    close(ha - a.hp, 800, 'pulse hits the afflicted enemy');
    close(hb - b.hp, 800, 'pulse hits a neighbour inside 1.1');

    let found = false;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const s = fight(t, {
        seed,
        bonds: { siracusaShip: bond(6, 0) },
        pieces: [piece('reg_sir_r', ['siracusaShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
      });
      s.step();
      const m = s.unit('reg_sir_r');
      const e = tank(s, [9, 4]);
      s.b.dealDamage({ source: m, target: e, amount: 10, type: 'phys' });
      if (abnormal(e)) found = true;
    }
    assert.equal(found, true);
  });

  test('叙拉古 swapped to bondeffect_siracusa deploys in stealth and has no abnormal pulse', (t) => {
    const h = fight(t, {
      bondId: 'siracusaShip', effectId: 'bondeffect_siracusa',
      bonds: { siracusaShip: bond(6, 0) },
      pieces: [piece('reg_sir_old', ['siracusaShip'])],
    });
    h.step();
    assert.equal(!!h.unit('reg_sir_old').s.flags.stealth, true);
    const a = tank(h, [9, 8]);
    const hp = a.hp;
    h.b.applyStatus(a, 'stun', { duration: 5, source: null });
    h.b.applyStatus(a, 'cold', { duration: 5, source: null });
    h.run(1.1);
    close(hp - a.hp, 0, '盟约 siracusa has no pulse');
  });

  test('卡西米尔_2: ATK per deploy, true damage in the window, melee bench switch', (t) => {
    const bb = effectParams('bondeffect_kazimierz_2', 'act3autochess_bond_eff_kazimierz');
    assert.equal(bb.atk_when_born, 0.2);
    assert.equal(bb.ex_atk_scale_base, 0.65);
    assert.equal(bb.ex_damage_duration, 30);
    const bench = piece('reg_kz_bench', ['kazimierzShip'], { bench: true });
    const h = fight(t, {
      bonds: { kazimierzShip: bond(6, 0) },
      pieces: [piece('reg_kz', ['kazimierzShip'], { rangeGrid: [[0, 0], [-1, 0]] }), bench],
      contentInfo: { handPieces: [{ slot: 3, id: 'reg_kz_bench', bonds: ['kazimierzShip'], position: 'MELEE' }] },
    });
    h.step();
    const u = h.unit('reg_kz');
    close(u.s.atk, 600, 'one deploy, +20% atk');
    const e = tank(h, [9, 4]);
    const hp = e.hp;
    h.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' });
    close(hp - e.hp, 100 + 0.65 * u.s.atk, 'window true damage');
    h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true' });
    assert.equal(u.alive, false);
    assert.equal(u.removed, true);
    const next = living(h, 'reg_kz_bench');
    assert.equal(next.length, 1);
    assert.equal(next[0].tileR, 10);
    assert.equal(next[0].tileC, 4);
  });

  test('卡西米尔 bench switch skips a ranged piece', (t) => {
    const bench = piece('reg_kz_far', ['kazimierzShip'], { bench: true, position: 'RANGED', profession: 'SNIPER' });
    const h = fight(t, {
      bonds: { kazimierzShip: bond(6, 0) },
      pieces: [piece('reg_kz2', ['kazimierzShip']), bench],
      contentInfo: { handPieces: [{ slot: 0, id: 'reg_kz_far', bonds: ['kazimierzShip'], position: 'RANGED' }] },
    });
    h.step();
    const u = h.unit('reg_kz2');
    h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true' });
    assert.equal(u.alive, false);
    assert.equal(u.removed, false);
    assert.equal(living(h, 'reg_kz_far').length, 0);
  });

  test('卡西米尔 swapped to bondeffect_kazimierz has no bench switch', (t) => {
    const bench = piece('reg_kz_old_b', ['kazimierzShip'], { bench: true });
    const h = fight(t, {
      bondId: 'kazimierzShip', effectId: 'bondeffect_kazimierz',
      bonds: { kazimierzShip: bond(6, 0) },
      pieces: [piece('reg_kz_old', ['kazimierzShip']), bench],
      contentInfo: { handPieces: [{ slot: 1, id: 'reg_kz_old_b', bonds: ['kazimierzShip'], position: 'MELEE' }] },
    });
    h.step();
    const u = h.unit('reg_kz_old');
    h.b.dealDamage({ source: null, target: u, amount: 1e9, type: 'true' });
    assert.equal(u.removed, false);
    assert.equal(living(h, 'reg_kz_old_b').length, 0);
  });

  test('维多利亚 盟约: an item adds ATK and dealt damage; 维多利亚_2 shares the item and skips the ATK weight', (t) => {
    const old = effectParams('bondeffect_victoria', 'act1autochess_bond_eff_victoria');
    assert.equal(old.atk_normal_equip, 0.4);
    assert.equal(old.base_damage_scale, 1.25);
    // chess_item_1_01_e_a is +15% ATK; this one is DEF only, so the bond weight is the only ATK change.
    const item = v3().items.chess_item_1_02_e_a;
    assert.equal(item?.itemType, 'EQUIP');
    assert.ok(hasBattleEffect(item), 'a battle-effect equip');
    const h = fight(t, {
      bonds: { victoriaShip: bond(6, 0) },
      pieces: [piece('reg_vic', ['victoriaShip'], { items: [item.id], rangeGrid: [[0, 0], [-1, 0]] })],
    });
    h.step();
    const u = h.unit('reg_vic');
    close(u.s.atk, 500 * 1.4, 'normal equip atk');
    const e = tank(h, [9, 4]);
    const hp = e.hp;
    h.b.dealDamage({ source: u, target: e, amount: 100, type: 'phys' });
    close(hp - e.hp, 125, 'victoria dealt');

    const h2 = fight(t, {
      bondId: 'victoriaShip', effectId: 'bondeffect_victoria_2',
      bonds: { victoriaShip: bond(6, 0) },
      pieces: [
        piece('reg_vic2', ['victoriaShip'], { items: [item.id] }),
        piece('reg_vic_n', [], { col: 5, skill: null }),
      ],
    });
    h2.step();
    const a = h2.unit('reg_vic2');
    close(a.s.atk, 500, 'victoria_2 has no atk weight');
    const e2 = tank(h2, [9, 8]);
    const hp2 = e2.hp;
    h2.b.dealDamage({ source: a, target: e2, amount: 100, type: 'phys' });
    close(hp2 - e2.hp, 125, 'victoria_2 dealt');
    assert.ok(a.skill.activate('test', { free: true }));
    assert.ok(itemGrants(h2.b, h2.unit('reg_vic_n')).some((g) => g.lent), 'shared equip');
  });

  test('阿戈尔 redeploys at 6 and stays down at 5; 阿戈尔_2 switches from the bench instead', (t) => {
    const low = fight(t, {
      bonds: { egirShip: bond(5, 0, 1) },
      pieces: [piece('reg_eg5', ['egirShip'])],
    });
    low.step();
    const a = low.unit('reg_eg5');
    close(a.s.maxHp, 2000 * 1.35, 'egir hp');
    low.b.dealDamage({ source: null, target: a, amount: 1e9, type: 'true' });
    assert.equal(a.alive, false);

    const hi = fight(t, {
      bonds: { egirShip: bond(6, 0) },
      pieces: [piece('reg_eg6', ['egirShip'])],
    });
    hi.step();
    const b = hi.unit('reg_eg6');
    hi.b.dealDamage({ source: null, target: b, amount: 1e9, type: 'true' });
    assert.equal(b.alive, true);

    const bench = piece('reg_eg_b', ['egirShip'], { bench: true, position: 'RANGED', profession: 'SNIPER' });
    const h2 = fight(t, {
      bondId: 'egirShip', effectId: 'bondeffect_egir_2',
      bonds: { egirShip: bond(6, 0) },
      pieces: [piece('reg_eg2', ['egirShip']), bench],
      contentInfo: { handPieces: [{ slot: 1, id: 'reg_eg_b', bonds: ['egirShip'], position: 'RANGED' }] },
    });
    h2.step();
    const c = h2.unit('reg_eg2');
    close(c.s.maxHp, 2700, 'egir_2 hp');
    h2.b.dealDamage({ source: null, target: c, amount: 1e9, type: 'true' });
    assert.equal(c.alive, false);
    assert.equal(c.removed, true);
    assert.equal(living(h2, 'reg_eg_b').length, 1);
  });

  test('乌萨斯: standing stats, damage cut and bleed, temp layers, block arts at 6', (t) => {
    const bb = params(v3().bonds.ursusShip, 'act3autochess_bond_eff_ursus');
    assert.equal(bb.atk_base, 0.35);
    assert.equal(bb.damage_one_minus_base, 0.15);
    assert.equal(bb.temp_bond_stack_cnt, 2);
    const h = fight(t, {
      bonds: { ursusShip: bond(1, 0, 1) },
      pieces: [piece('reg_ur', ['ursusShip'])],
    });
    h.step();
    const u = h.unit('reg_ur');
    close(u.s.atk, 500 * 1.35, 'ursus atk');
    close(u.s.maxHp, 2000 * 1.1, 'ursus hp');
    const foe = tank(h, [9, 8]);
    const hp = u.hp;
    h.b.dealDamage({ source: foe, target: u, amount: 100, type: 'phys' });
    close(hp - u.hp, 85, '15% cut');
    h.step();
    close(hp - u.hp, 86.5, 'bleed 1.5 on the next step');
    const hpT = u.hp;
    h.b.dealDamage({ source: foe, target: u, amount: 50, type: 'true' });
    close(hpT - u.hp, 50, 'true damage is not cut');
    const victim = tank(h, [9, 16]);
    h.b.dealDamage({ source: u, target: victim, amount: 1e9, type: 'true' });
    assert.equal(victim.alive, false);
    assert.equal(tempBondLayers(h.b, 'p1', 'ursusShip'), 2);

    const h6 = fight(t, {
      bonds: { ursusShip: bond(6, 0) },
      pieces: [piece('reg_ur6', ['ursusShip'])],
    });
    h6.step();
    const m = h6.unit('reg_ur6');
    const e = tank(h6, [9, 8]);
    h6.b.on('tick', () => { m.blocking = [e]; });
    const before = e.hp;
    h6.run(1.1);
    close(before - e.hp, 0.5 * m.s.atk, 'block arts');
    const food = tank(h6, [9, 16]);
    h6.b.dealDamage({ source: m, target: food, amount: 1e9, type: 'true' });
    assert.equal(tempBondLayers(h6.b, 'p1', 'ursusShip'), 4);
  });

  test('伊比利亚: slow, DoT, per-source interval, splash', (t) => {
    const bb = params(v3().bonds.iberiaShip, 'act3autochess_bond_eff_iberia[enemy]');
    assert.equal(bb.dot_atk_scale_base, 0.11);
    assert.equal(bb.atk_scale, 3);
    assert.equal(bb.range_radius, 1.7);
    const h = fight(t, {
      bonds: { iberiaShip: bond(6, 0) },
      pieces: [piece('reg_ib', ['iberiaShip'])],
    });
    h.step();
    const u = h.unit('reg_ib');
    const e = tank(h, [9, 8]);
    const n = tank(h, [9, 9]);
    h.b.dealDamage({ source: u, target: e, amount: 10, type: 'phys' });
    h.b.dealDamage({ source: u, target: e, amount: 10, type: 'phys' });
    const slow = e.findBuff('bond:iberia:slow');
    assert.ok(slow);
    close(slow.mods.moveMul, 0.96, 'one slow stack');
    assert.equal(e.mem.iberia.stacks, 1);
    const hp = e.hp;
    h.run(1.1);
    close(hp - e.hp, 0.11 * 2 * u.s.atk, 'power doubles the DoT');
    h.run(0.25);
    h.b.dealDamage({ source: u, target: e, amount: 10, type: 'phys' });
    assert.equal(e.mem.iberia.stacks, 2);

    let splashed = false;
    const hs = fight(t, {
      seed: 1,
      bonds: { iberiaShip: bond(1, 0, 1) },
      pieces: [piece('reg_ib2', ['iberiaShip'])],
    });
    hs.step();
    const src = hs.unit('reg_ib2');
    const primary = tank(hs, [9, 8]);
    const other = tank(hs, [9, 9]);
    const start = other.hp;
    for (let i = 0; i < 40 && other.hp === start; i++) {
      hs.b.dealDamage({ source: src, target: primary, amount: 10, type: 'phys' });
      hs.run(0.21);
    }
    splashed = other.hp < start;
    assert.equal(splashed, true);
    assert.ok(start - other.hp >= 3 * src.s.atk - 1, 'splash is 3× atk arts');
  });

  test('莱塔尼亚: no opening summon; a killed enemy summons an owned note at its death tile center', (t) => {
    const bb = params(v3().bonds.lethaniaShip, 'act3autochess_bond_eff_lethania');
    assert.equal(bb.atk_base, 0.3);
    assert.equal(bb.summon_prob_base, 1);
    for (const count of [3, 6]) {
      const opening = fight(t, {
        bonds: { lethaniaShip: bond(count, 0) },
        pieces: [piece(`reg_le_open${count}`, ['lethaniaShip'])],
      });
      opening.step();
      assert.equal(lethaniaSummons(opening).length, 0, `${count} members do not summon at battle start`);
    }

    const h = fight(t, {
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [
        piece('reg_le_enemyBond', ['lethaniaShip'], { row: 12, col: 2, skill: null, rangeGrid: [[0, 0]] }),
        piece('reg_le_anySource', [], { col: 5, skill: null }),
      ],
    });
    h.step();
    close(h.unit('reg_le_enemyBond').s.atk, 500 * 1.3, 'lethania atk');
    const e = tank(h, [10.27, 8.34]);
    h.b.dealDamage({ source: h.unit('reg_le_anySource'), target: e, amount: 1e9, type: 'true' });
    assert.equal(e.alive, false);
    const [note] = lethaniaSummons(h);
    assert.ok(note, 'a non-Lethania damage source still triggers the enemy-death summon');
    assert.equal(note.defId, NOTE, 'three members summon a note, never a chorus');
    assert.equal(note.ownerId, 'p1', 'the bond owner owns the summon');
    assert.deepEqual([note.x, note.y], [Math.round(e.x), Math.round(e.y)], 'the note spawns at the killed enemy\'s tile center');
    const spawn = h.eventsOf('spawn').map(([, info]) => info).find((info) => info.defId === NOTE);
    assert.deepEqual([spawn.x, spawn.y], [Math.round(e.x), Math.round(e.y)], 'the first-frame spawn event reports the death tile center');
    close(note.s.maxHp, 2350, 'note hp');
    h.run(1.1);
    close(note.hp, 2350 - 235, 'note bleed');
  });

  test('莱塔尼亚: own operator deaths summon only at six; partial damage and teammate deaths do not', (t) => {
    const low = fight(t, {
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [
        piece('reg_le3_member', ['lethaniaShip'], { row: 12, col: 2, skill: null }),
        piece('reg_le3_guest', [], { row: 10, col: 6, skill: null }),
      ],
    });
    low.step();
    low.b.dealDamage({ source: null, target: low.unit('reg_le3_guest'), amount: 1e9, type: 'true' });
    assert.equal(lethaniaSummons(low).length, 0, 'the extra operator-death summon is six-member power');

    const high = fight(t, {
      players: [
        { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: { lethaniaShip: bond(6, 0) } },
        { playerId: 'p2', seat: 1, side: 'R', colOffset: 8, bonds: {} },
      ],
      pieces: [
        piece('reg_le6_member', ['lethaniaShip'], { row: 12, col: 2, skill: null }),
        piece('reg_le6_guest', [], { row: 10, col: 6, skill: null }),
        piece('reg_le6_teammate', [], { row: 12, col: 8, skill: null, ownerId: 'p2' }),
      ],
    });
    high.step();
    const guest = high.unit('reg_le6_guest');
    const teammate = high.unit('reg_le6_teammate');
    high.b.dealDamage({ source: null, target: guest, amount: 10, type: 'true' });
    assert.equal(guest.alive, true);
    assert.equal(lethaniaSummons(high).length, 0, 'non-lethal damage does not summon');
    high.b.dealDamage({ source: null, target: teammate, amount: 1e9, type: 'true' });
    assert.equal(lethaniaSummons(high).length, 0, 'the six-member bond only observes its own player id');
    high.b.dealDamage({ source: null, target: guest, amount: 1e9, type: 'true' });
    const [note] = lethaniaSummons(high, 'p1');
    assert.ok(note, 'a non-Lethania operator owned by the six-member bond player triggers');
    assert.equal(note.ownerId, 'p1');
    assert.equal(lethaniaSummons(high, 'p2').length, 0);
  });

  test('莱塔尼亚: a death on a real non-deployable road tile spawns at that tile center', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const road = stage.rows[10][9];
    assert.equal(stage.tiles[road].groundPassable, true);
    assert.equal(stage.tiles[road].buildable, 'NONE');
    const h = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [piece('reg_le_exact_road_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } })],
    });
    h.step();
    const e = tank(h, [10.23, 9.27]);
    const deathCenter = [Math.round(e.x), Math.round(e.y)];
    h.b.kill(e, null);
    const [note] = lethaniaSummons(h);
    assert.ok(note, 'enemy death on the floor road creates a note');
    assert.deepEqual([note.x, note.y], deathCenter, 'the summoned note uses the road tile center');
    const spawn = h.eventsOf('spawn').map(([, info]) => info).find((info) => info.defId === NOTE);
    assert.ok(spawn, 'the summon emits its first spawn event');
    close(spawn.x, deathCenter[0], 'spawn event tile-center x');
    close(spawn.y, deathCenter[1], 'spawn event tile-center y');
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  });

  test('莱塔尼亚: several notes can share a real occupied tile without replacing its operator', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const h = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [
        piece('reg_le_stack_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } }),
        piece('reg_le_stack_occupant', [], { row: 12, col: 5, skill: null, stats: { atk: 0 } }),
      ],
    });
    h.step();
    const occupant = h.unit('reg_le_stack_occupant');
    assert.equal(h.b.unitAt(12, 5), occupant);
    const deathPos = [5.27, 12.23];
    for (let i = 0; i < 2; i++) h.b.kill(tank(h, [deathPos[1], deathPos[0]]), null);
    const notes = lethaniaSummons(h, 'p1');
    assert.equal(notes.length, 2, 'both deaths create a live token over the operator tile');
    assert.ok(notes.every((note) => note.defId === NOTE));
    assert.ok(notes.every((note) => note.x === 5 && note.y === 12), 'both notes use the exact death tile center');
    assert.equal(h.b.unitAt(12, 5), occupant, 'the mobile tokens do not claim or replace deployment occupancy');
    h.b.dealDamage({ source: null, target: notes[0], amount: 1e9, type: 'true' });
    assert.equal(notes[0].alive, false);
    assert.equal(h.b.unitAt(12, 5), occupant, 'a token death does not clear the operator occupancy');
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  });

  test('莱塔尼亚: a note prioritizes attackable enemies on its birth tile over global target priority', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const h = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [piece('reg_le_birth_priority_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } })],
    });
    h.step();
    const local = tank(h, [12, 8.2]);
    const global = tank(h, [12, 8.58]);
    // Keep either enemy from acquiring a block-priority advantage; this isolates the birth-tile rule.
    local.s.flags.unblockable = true;
    global.s.flags.unblockable = true;
    h.b.kill(tank(h, [12, 8]), null);
    const [note] = lethaniaSummons(h, 'p1');
    assert.ok(note);
    note.profile.priority = 'farthest';
    assert.deepEqual([note.x, note.y], [8, 12], 'a note spawns at the death tile center');
    assert.deepEqual(acquireTargets(h.b, note, note.profile), [local],
      'the initial local mode excludes the farther global candidate even under farthest priority');

    const hits = [];
    h.b.on('hit', (c) => { if (c.source === note && (c.target === local || c.target === global)) hits.push(c.target); });
    const attacked = h.runUntil(() => hits.length > 0, 3);
    assert.ok(attacked, `note attacks a candidate; position=${JSON.stringify([note.x, note.y])}, errors=${JSON.stringify(h.b.errors)}`);
    assert.equal(hits[0], local, 'the local birth-tile enemy wins over the farther global target');
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  });

  test('莱塔尼亚: a note assigns one unblocked birth-tile enemy and can attack another already blocked at full capacity', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const h = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [
        piece('reg_le_birth_block_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } }),
        piece('reg_le_birth_blocker', [], { row: 12, col: 7, skill: null, stats: { atk: 0 } }),
      ],
    });
    h.step();
    const blocker = h.unit('reg_le_birth_blocker');
    const alreadyBlocked = tank(h, [12, 7.55]);
    assert.equal(h.b._checkBlock(alreadyBlocked), true);
    assert.equal(alreadyBlocked.blockedBy, blocker, 'the ordinary operator blocks the first birth-tile target');
    const available = tank(h, [12, 8.2]);
    const global = tank(h, [12, 8.58]);
    global.s.flags.unblockable = true;
    h.b.kill(tank(h, [12, 8]), null);
    const [note] = lethaniaSummons(h, 'p1');
    assert.ok(note);
    note.profile.priority = 'farthest';
    assert.deepEqual([note.x, note.y], [8, 12]);
    assert.equal(available.blockedBy, note, 'the note takes the nearest legal unblocked target on its birth tile');
    assert.equal(alreadyBlocked.blockedBy, blocker, 'the note does not steal the target already blocked by an operator');
    assert.equal(note.blocking.length, 1, 'the note has no free block capacity after its birth allocation');

    const hits = [];
    h.b.on('hit', (c) => { if (c.source === note && [available, alreadyBlocked, global].includes(c.target)) hits.push(c.target); });
    assert.deepEqual(acquireTargets(h.b, note, note.profile), [available], 'the allocated local target is the first local attack');
    assert.ok(h.runUntil(() => hits.length >= 1, 3), 'the note hits its allocated birth-tile target');
    assert.equal(hits[0], available);

    available.s.flags.untargetable = true;
    assert.equal(note.blocking.length, 1, 'an unselectable held target still fills the note\'s block capacity');
    assert.deepEqual(acquireTargets(h.b, note, note.profile), [alreadyBlocked],
      'with no available block slot, the remaining valid birth-tile target stays selectable');
    assert.ok(h.runUntil(() => hits.length >= 2, 3), 'the note still attacks a birth-tile target blocked by an operator');
    assert.equal(hits[1], alreadyBlocked, 'the note attacks the local target without taking its block link');
    assert.equal(alreadyBlocked.blockedBy, blocker);
    assert.equal(hits.includes(global), false, 'the higher-priority global target remains unselected while local candidates exist');
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    assertLethaniaRuntime(h);
  });

  test('莱塔尼亚: a note exits birth-tile priority when local targets leave range and does not re-enter', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const h = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [piece('reg_le_birth_exit_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } })],
    });
    h.step();
    const local = tank(h, [12, 8.2]);
    const global = tank(h, [12, 8.58]);
    local.s.flags.unblockable = true;
    global.s.flags.unblockable = true;
    h.b.kill(tank(h, [12, 8]), null);
    const [note] = lethaniaSummons(h, 'p1');
    assert.ok(note);
    note.profile.priority = 'farthest';
    const hits = [];
    h.b.on('hit', (c) => { if (c.source === note && [local, global].includes(c.target)) hits.push(c.target); });
    assert.deepEqual(acquireTargets(h.b, note, note.profile), [local], 'the local set is active at the note\'s birth');
    assert.ok(h.runUntil(() => hits.length >= 1, 3), 'the note attacks its birth-tile target first');
    assert.equal(hits[0], local);

    assert.equal(h.b.displace(local, { x: 1, y: 0 }, 1.2), 1.2, 'the local target is moved outside the note\'s attack radius');
    assert.ok(Math.hypot(local.x - note.x, local.y - note.y) > note.profile.attackRangeRadius + 0.1);
    assert.deepEqual(acquireTargets(h.b, note, note.profile), [global], 'after the birth-tile set empties, normal global selection resumes');
    assert.ok(h.runUntil(() => hits.length >= 2, 3), 'the note attacks the global candidate after local range is empty');
    assert.equal(hits[1], global);

    const lateLocal = tank(h, [12, 8.2]);
    lateLocal.s.flags.unblockable = true;
    assert.deepEqual(acquireTargets(h.b, note, note.profile), [global],
      'a new local enemy after exit does not reactivate birth-tile priority');
    assert.ok(h.runUntil(() => hits.length >= 3, 3), 'the note continues attacking the global target after a late local spawn');
    assert.equal(hits[2], global);
    assert.equal(hits.includes(lateLocal), false);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    assertLethaniaRuntime(h);
  });

  test('莱塔尼亚: a same-tile corner target outside real radius is not forced; chorus keeps global targeting', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const noteBattle = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [piece('reg_le_birth_radius_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } })],
    });
    noteBattle.step();
    const corner = tank(noteBattle, [12.49, 8.49]);
    const global = tank(noteBattle, [12, 8.58]);
    corner.s.flags.unblockable = true;
    global.s.flags.unblockable = true;
    noteBattle.b.kill(tank(noteBattle, [12, 8]), null);
    const [note] = lethaniaSummons(noteBattle, 'p1');
    assert.ok(note);
    note.profile.priority = 'farthest';
    assert.deepEqual([note.x, note.y], [8, 12]);
    assert.ok(Math.hypot(corner.x - note.x, corner.y - note.y) > note.profile.attackRangeRadius + 0.1);
    assert.deepEqual(acquireTargets(noteBattle.b, note, note.profile), [global],
      'no valid birth-tile candidate means ordinary global selection applies');
    const noteHits = [];
    noteBattle.b.on('hit', (c) => { if (c.source === note && [corner, global].includes(c.target)) noteHits.push(c.target); });
    assert.ok(noteBattle.runUntil(() => noteHits.length > 0, 3));
    assert.equal(noteHits[0], global, 'the out-of-radius same-tile enemy is not forced as a target');
    assert.equal(corner.blockedBy, null);
    assert.equal(noteBattle.b.errorCount, 0, JSON.stringify(noteBattle.b.errors));

    const chorusBattle = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(6, 700) },
      pieces: [piece('reg_le_birth_chorus_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } })],
    });
    chorusBattle.step();
    const chorusLocal = tank(chorusBattle, [12, 8.2]);
    const chorusGlobal = tank(chorusBattle, [12, 8.58]);
    chorusLocal.s.flags.unblockable = true;
    chorusGlobal.s.flags.unblockable = true;
    chorusBattle.b.rng = () => 0;
    chorusBattle.b.kill(tank(chorusBattle, [12, 8]), null);
    const [chorus] = lethaniaSummons(chorusBattle, 'p1');
    assert.ok(chorus);
    assert.equal(chorus.defId, CHORUS, 'the controlled six-member roll creates a chorus');
    chorus.profile.priority = 'farthest';
    assert.deepEqual([chorus.x, chorus.y], [8, 12]);
    assert.deepEqual(acquireTargets(chorusBattle.b, chorus, chorus.profile), [chorusGlobal],
      'chorus uses global priority even when an attackable enemy occupies its birth tile');
    const chorusHits = [];
    chorusBattle.b.on('hit', (c) => { if (c.source === chorus && [chorusLocal, chorusGlobal].includes(c.target)) chorusHits.push(c.target); });
    assert.ok(chorusBattle.runUntil(() => chorusHits.length > 0, 3));
    assert.equal(chorusHits[0], chorusGlobal, 'chorus hits the higher-priority global candidate');
    assert.equal(chorusBattle.b.errorCount, 0, JSON.stringify(chorusBattle.b.errors));
    assertLethaniaRuntime(noteBattle);
    assertLethaniaRuntime(chorusBattle);
  });

  test('莱塔尼亚: note and chorus cross allied operators and attack one enemy blocked by an operator', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const h = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(6, 0) },
      pieces: [
        piece('reg_le_swarm_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } }),
        piece('reg_le_swarm_blocker', [], { row: 12, col: 6, skill: null, stats: { atk: 0 } }),
        piece('reg_le_swarm_road_op', [], { row: 12, col: 7, skill: null, stats: { atk: 0 } }),
      ],
    });
    h.step();
    const rolls = [0.5, 0.9, 0.5, 0.1];
    h.b.rng = () => rolls.shift() ?? 0.99;
    for (let i = 0; i < 2; i++) h.b.kill(tank(h, [12, 8]), null);
    const note = lethaniaSummons(h).find((u) => u.defId === NOTE);
    const chorus = lethaniaSummons(h).find((u) => u.defId === CHORUS);
    assert.ok(note && chorus, 'controlled bond rolls create one note and one chorus');
    const blocker = h.unit('reg_le_swarm_blocker');
    const target = tank(h, [12, 5.35]);
    h.b._checkBlock(target);
    assert.equal(target.blockedBy, blocker, 'the operator owns the enemy block link before either summon engages');
    const hits = new Map([[note, []], [chorus, []]]);
    h.b.on('hit', (c) => { if (hits.has(c.source) && c.target === target) hits.get(c.source).push(c.dmg.type); });
    const attacked = h.runUntil(() => [...hits.values()].every((types) => types.length > 0), 9);
    assert.ok(attacked, `both summons must hit through the occupied lane: ${JSON.stringify({
      note: { pos: [note.x, note.y], tile: [note.tileR, note.tileC], blocking: note.blocking.length,
        atkCd: note.atkCd, lastAttackAt: note.lastAttackAt, profile: note.profile?.attack, noAttack: note.profile?.noAttack },
      chorus: { pos: [chorus.x, chorus.y], tile: [chorus.tileR, chorus.tileC], blocking: chorus.blocking.length,
        atkCd: chorus.atkCd, lastAttackAt: chorus.lastAttackAt, profile: chorus.profile?.attack, noAttack: chorus.profile?.noAttack },
      target: { pos: [target.x, target.y], blockedBy: target.blockedBy?.defId },
      time: h.b.time, errors: h.b.errors,
    })}`);
    assert.ok(hits.get(note).includes('arts'), `note hit types: ${hits.get(note).join(', ')}`);
    assert.ok(hits.get(chorus).includes('arts'), `chorus hit types: ${hits.get(chorus).join(', ')}`);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
  });

  test('莱塔尼亚: both summon kinds spawn at death tile centers on every active normal regulation stage', (t) => {
    const stages = Object.values(v3().stages).filter((stage) => stage.active
      && stage.modes?.includes('mode_multi_normal') && /^act3autochess_m\d+$/.test(stage.id)).sort((a, b) => a.id.localeCompare(b.id));
    assert.ok(stages.length >= 8, `active normal regulation stages found: ${stages.map((stage) => stage.id).join(', ')}`);
    for (const stage of stages) {
      let road = null;
      for (let r = 9; r <= 12 && !road; r++) for (let c = 2; c <= 10; c++) {
        const tile = stage.tiles[stage.rows[r]?.[c]];
        if (tile?.tileKey === 'tile_floor' && tile.groundPassable && tile.buildable === 'NONE') { road = [r, c]; break; }
      }
      assert.ok(road, `${stage.id} has a non-deployable ground floor in the normal battle area`);
      const ownerPos = stage.deployTiles?.normal?.melee?.find(([r, c]) => r >= 9 && r <= 12 && c >= 2 && c <= 10
        && !(r === road[0] && c === road[1]));
      assert.ok(ownerPos, `${stage.id} has a normal deploy tile for the bond member`);
      const h = fight(t, {
        stage,
        bonds: { lethaniaShip: bond(6, 0) },
        pieces: [piece(`reg_le_stage_${stage.id}`, ['lethaniaShip'], { row: ownerPos[0], col: ownerPos[1], skill: null, stats: { atk: 0 } })],
      });
      h.step();
      const deathPos = [road[1] + 0.23, road[0] + 0.27];
      const rolls = [0.5, 0.9, 0.5, 0.1];
      h.b.rng = () => rolls.shift() ?? 0.99;
      for (let i = 0; i < 2; i++) h.b.kill(tank(h, [deathPos[1], deathPos[0]]), null);
      const summons = lethaniaSummons(h, 'p1');
      assert.deepEqual(summons.map((u) => u.defId).sort(), [NOTE, CHORUS].sort(), `${stage.id}: one note and one chorus`);
      assert.ok(summons.every((u) => u.x === road[1] && u.y === road[0]), `${stage.id}: both units spawn at the death tile center`);
      const spawns = h.eventsOf('spawn').map(([, info]) => info).filter((info) => info.defId === NOTE || info.defId === CHORUS);
      assert.equal(spawns.length, 2, `${stage.id}: both summons publish first-frame spawn events`);
      assert.ok(spawns.every((info) => info.x === road[1] && info.y === road[0]), `${stage.id}: spawn events report the death tile center`);
      assert.equal(h.b.unitAt(ownerPos[0], ownerPos[1]), h.unit(`reg_le_stage_${stage.id}`));
      assertLethaniaRuntime(h);
    }
  });

  test('莱塔尼亚: twenty same-point summons keep their operator tile and run against many enemies', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const deathPos = [5.27, 12.23];
    const h = fight(t, {
      stage,
      bonds: { lethaniaShip: bond(6, 0) },
      pieces: [
        piece('reg_le20_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } }),
        piece('reg_le20_occupant', [], { row: 12, col: 5, skill: null, stats: { atk: 0 } }),
        piece('reg_le20_road6', [], { row: 12, col: 6, skill: null, stats: { atk: 0 } }),
        piece('reg_le20_road7', [], { row: 12, col: 7, skill: null, stats: { atk: 0 } }),
      ],
    });
    h.step();
    const occupant = h.unit('reg_le20_occupant');
    h.b.rng = () => 0.9;
    for (let i = 1; i <= 21; i++) {
      h.b.kill(tank(h, [deathPos[1], deathPos[0]]), null);
      const summons = lethaniaSummons(h, 'p1');
      assert.equal(summons.length, Math.min(i, 20), `alive token cap after death ${i}`);
      assert.ok(summons.every((u) => u.defId === NOTE), 'controlled rolls create notes');
      assert.ok(summons.every((u) => u.x === 5 && u.y === 12), 'every summon stacks at the death tile center');
      assert.equal(h.b.unitAt(12, 5), occupant, 'overlapping summons never reserve the operator tile');
    }
    const targets = [];
    for (let i = 0; i < 24; i++) targets.push(tank(h, [[12, 11, 10][i % 3], [8.2, 8.35, 8.5, 8.65][i % 4]]));
    const sources = new Set();
    h.b.on('hit', (c) => { if (c.source?.defId === NOTE && targets.includes(c.target) && c.dmg.type === 'arts') sources.add(c.source.id); });
    h.run(9);
    const summons = lethaniaSummons(h, 'p1');
    assert.equal(summons.length, 20, 'all twenty remain alive during the sustained run');
    assert.ok(sources.size >= 2, `multiple overlapping notes attack the enemy group; hit sources=${sources.size}`);
    assert.equal(h.b.unitAt(12, 5), occupant, 'movement and attacks never steal or clear the operator tile');
    assert.equal(h.b.unitAt(12, 6), h.unit('reg_le20_road6'));
    assert.equal(h.b.unitAt(12, 7), h.unit('reg_le20_road7'));
    assertLethaniaRuntime(h);
  });

  test('莱塔尼亚: in an empty field each summon returns to its own current tile center, then retargets', (t) => {
    const stage = v3().stages.act3autochess_m01;
    const officialPath = stage.groundPaths['12,10->9,2'];
    assert.ok(officialPath.length > 1, 'the fixture has a real stage route for contrasting the gate location');
    const route = { motion: 'WALK', start: officialPath[0], end: officialPath[officialPath.length - 1], checkpoints: [] };
    const noteDeath = [8.27, 11.23];
    const chorusDeath = [7.23, 12.27];
    const h = fight(t, {
      stage,
      routes: [route],
      bonds: { lethaniaShip: bond(6, 0) },
      pieces: [piece('reg_le_rally_member', ['lethaniaShip'], { row: 12, col: 4, skill: null, stats: { atk: 0 } })],
    });
    h.step();
    const lastEnemy = tank(h, [9, 4.5]);
    const rolls = [0.5, 0.9, 0.5, 0.1];
    h.b.rng = () => rolls.shift() ?? 0.99;
    h.b.kill(tank(h, [noteDeath[1], noteDeath[0]]), null);
    h.b.kill(tank(h, [chorusDeath[1], chorusDeath[0]]), null);
    const summons = lethaniaSummons(h);
    const note = summons.find((u) => u.defId === NOTE);
    const chorus = summons.find((u) => u.defId === CHORUS);
    assert.ok(note && chorus);
    const noteDeathCenter = [Math.round(noteDeath[0]), Math.round(noteDeath[1])];
    const chorusDeathCenter = [Math.round(chorusDeath[0]), Math.round(chorusDeath[1])];
    assert.deepEqual([note.x, note.y], noteDeathCenter, 'note first spawns at its death tile center');
    assert.deepEqual([chorus.x, chorus.y], chorusDeathCenter, 'chorus first spawns at its own death tile center');
    const spawnInfos = h.eventsOf('spawn').map(([, info]) => info);
    const noteEvent = spawnInfos.find((info) => info.defId === NOTE);
    const chorusEvent = spawnInfos.find((info) => info.defId === CHORUS);
    assert.deepEqual([noteEvent.x, noteEvent.y], noteDeathCenter, 'note first-frame spawn event reports its death tile center');
    assert.deepEqual([chorusEvent.x, chorusEvent.y], chorusDeathCenter, 'chorus first-frame spawn event reports its death tile center');

    h.b.applyStatus(note, 'stun', { duration: 20, source: null, force: true });
    h.b.addBuff(chorus, { key: 'test:lethaniaEmptyNoMove', duration: 20, flags: { noMove: true } });
    h.b.kill(lastEnemy, null);
    assert.equal(h.enemies().length, 0, 'the last live enemy is dead before the empty-field tick');
    const noteCenter = [note.tileC, note.tileR];
    const chorusCenter = [chorus.tileC, chorus.tileR];
    assert.notDeepEqual(noteCenter, chorusCenter, 'the two tokens occupy different tiles at the empty-field transition');
    assert.ok(!h.b.grid.specialTiles('start').some(([r, c]) => r === noteCenter[1] && c === noteCenter[0]));
    assert.ok(!h.b.grid.specialTiles('start').some(([r, c]) => r === chorusCenter[1] && c === chorusCenter[0]));
    const frozen = [[note.x, note.y], [chorus.x, chorus.y]];
    h.step();
    assert.deepEqual([note.x, note.y], frozen[0], 'stun does not let note move while the empty-field destination is captured');
    assert.deepEqual([chorus.x, chorus.y], frozen[1], 'noMove does not let chorus move while the empty-field destination is captured');

    h.b.removeStatus(note, 'stun');
    h.b.removeBuff(chorus, 'test:lethaniaEmptyNoMove');
    h.run(3);
    const distanceTo = (u, rc) => Math.hypot(u.x - rc[0], u.y - rc[1]);
    assert.ok(distanceTo(note, noteCenter) < 0.05,
      `note returns to its own tile center ${JSON.stringify(noteCenter)}; actual=${JSON.stringify([note.x, note.y])}`);
    assert.ok(distanceTo(chorus, chorusCenter) < 0.05,
      `chorus returns to its own tile center ${JSON.stringify(chorusCenter)}; actual=${JSON.stringify([chorus.x, chorus.y])}`);
    assert.notDeepEqual([note.x, note.y], [chorus.x, chorus.y], 'each unit holds a different center instead of one shared point');
    const held = [[note.x, note.y], [chorus.x, chorus.y]];
    h.run(0.5);
    assert.deepEqual([note.x, note.y], held[0], 'note remains at its stored center in the empty field');
    assert.deepEqual([chorus.x, chorus.y], held[1], 'chorus remains at its stored center in the empty field');

    const hits = new Map([[note, 0], [chorus, 0]]);
    const target = tank(h, [12.2, 8.2]);
    h.b.on('hit', (c) => { if (hits.has(c.source) && c.target === target && c.dmg.type === 'arts') hits.set(c.source, hits.get(c.source) + 1); });
    const engaged = h.runUntil(() => [...hits.values()].every((n) => n > 0), 5);
    assert.ok(engaged, `both summons retarget and hit the new enemy; pos=${JSON.stringify([[note.x, note.y], [chorus.x, chorus.y]])}, time=${h.b.time}`);

    const previousNoteCenter = [...noteCenter];
    h.b.kill(target, null);
    assert.equal(h.enemies().length, 0, 'killing the new target starts another empty-field interval');
    const nextNoteCenter = [note.tileC, note.tileR];
    const nextChorusCenter = [chorus.tileC, chorus.tileR];
    assert.notDeepEqual(nextNoteCenter, previousNoteCenter, 'note captures the tile it reached during the new enemy engagement');
    h.run(2);
    assert.ok(distanceTo(note, nextNoteCenter) < 0.05,
      `after the second empty transition note returns to ${JSON.stringify(nextNoteCenter)}; actual=${JSON.stringify([note.x, note.y])}`);
    assert.ok(distanceTo(chorus, nextChorusCenter) < 0.05,
      `after the second empty transition chorus returns to ${JSON.stringify(nextChorusCenter)}; actual=${JSON.stringify([chorus.x, chorus.y])}`);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    assertLethaniaRuntime(h);
  });

  test('莱塔尼亚: alive summon caps are 10 at three and 20 at six', (t) => {
    for (const { count, layers, cap, expectedId } of [
      { count: 3, layers: 0, cap: 10, expectedId: NOTE },
      { count: 6, layers: 700, cap: 20, expectedId: CHORUS },
    ]) {
      const h = fight(t, {
        bonds: { lethaniaShip: bond(count, layers) },
        pieces: [piece(`reg_le_cap${count}`, ['lethaniaShip'], { row: 12, col: 2, skill: null, rangeGrid: [[0, 0]] })],
      });
      h.step();
      for (let i = 1; i <= cap + 1; i++) {
        const e = tank(h, [10, 8]);
        h.b.kill(e, null);
        const summons = lethaniaSummons(h, 'p1');
        assert.equal(summons.length, Math.min(i, cap), `${count}-member cap after kill ${i}`);
        assert.ok(summons.every((u) => u.ownerId === 'p1'));
        if (count === 6) assert.ok(summons.every((u) => u.defId === expectedId), '700 layers guarantee a chorus');
        else assert.ok(summons.every((u) => u.defId === expectedId), 'three members summon notes');
      }
      if (count === 6) {
        for (const pos of [[9, 8], [10, 9], [11, 8], [12, 9], [9, 10], [11, 10], [12, 7], [9, 7], [10, 11], [11, 11]]) tank(h, pos);
        h.run(4);
      }
      assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
      assertLethaniaRuntime(h);
    }
  });

  test('莱塔尼亚: a note has arts melee attacks and respects stun/noMove while pursuing', (t) => {
    const h = fight(t, {
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [piece('reg_le_note_member', ['lethaniaShip'], { row: 12, col: 2, skill: null, rangeGrid: [[0, 0]] })],
    });
    h.step();
    const corpse = tank(h, [10, 8]);
    h.b.kill(corpse, null);
    const [note] = lethaniaSummons(h);
    assert.ok(note);
    assert.equal(note.dmgType, 'arts');
    assert.equal(note.profile.attack, 'melee');
    close(note.s.moveSpeed, 0.7, 'note movement speed');

    const target = tank(h, [10.23, 6.23]);
    const hits = [];
    h.b.on('hit', (c) => { if (c.source === note && c.target === target) hits.push(c.dmg.type); });
    const start = [note.x, note.y];
    h.b.applyStatus(note, 'stun', { duration: 2, source: null, force: true });
    h.run(0.8);
    assert.deepEqual([note.x, note.y], start, 'stun pauses pursuit');
    h.b.removeStatus(note, 'stun');
    h.b.addBuff(note, { key: 'test:lethaniaNoMove', duration: 1, flags: { noMove: true } });
    h.run(0.8);
    assert.deepEqual([note.x, note.y], start, 'noMove pauses pursuit');
    h.b.removeBuff(note, 'test:lethaniaNoMove');

    const initialDistance = Math.abs(target.x - note.x) + Math.abs(target.y - note.y);
    h.run(2.5);
    const movingDistance = Math.abs(target.x - note.x) + Math.abs(target.y - note.y);
    assert.ok(movingDistance < initialDistance - 0.5, `note advanced over multiple ticks (${initialDistance} → ${movingDistance})`);
    const attacked = h.runUntil(() => hits.length > 0, 15);
    assert.ok(attacked, `note reaches and attacks the stationary target: ${JSON.stringify({
      note: { pos: [note.x, note.y], tile: [note.tileR, note.tileC], blocking: note.blocking.length,
        atkCd: note.atkCd, lastAttackAt: note.lastAttackAt, profile: note.profile?.attack, noAttack: note.profile?.noAttack },
      target: { pos: [target.x, target.y], blockedBy: target.blockedBy?.defId },
      time: h.b.time, errors: h.b.errors,
    })}`);
    assert.ok(hits.includes('arts'), `actual note hit types: ${hits.join(', ')}`);
    const stopped = [note.x, note.y];
    h.run(0.6);
    assert.deepEqual([note.x, note.y], stopped, 'note holds its position while the target stays in attack range');
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    assertLethaniaRuntime(h);
  });

  test('莱塔尼亚: a chorus advances at range, attacks with arts, and holds its ranged position', (t) => {
    const h = fight(t, {
      bonds: { lethaniaShip: bond(6, 700) },
      pieces: [piece('reg_le_chorus_member', ['lethaniaShip'], { row: 12, col: 2, skill: null, rangeGrid: [[0, 0]] })],
    });
    h.step();
    const corpse = tank(h, [10, 8]);
    h.b.kill(corpse, null);
    const [chorus] = lethaniaSummons(h);
    assert.ok(chorus);
    assert.equal(chorus.defId, CHORUS);
    assert.equal(chorus.ownerId, 'p1');
    assert.equal(chorus.dmgType, 'arts');
    assert.equal(chorus.profile.attackRangeRadius, 2.4);
    assert.equal(!!chorus.profile.requiresBlocking, false);
    close(chorus.s.moveSpeed, 0.5, 'chorus movement speed');
    close(chorus.s.aspd, 120, 'chorus aura attack speed');
    h.run(1.1);
    close(chorus.hp, 8500 - 850, 'chorus true bleed');

    const target = tank(h, [10.29, 4.6]);
    const hits = [];
    h.b.on('hit', (c) => { if (c.source === chorus && c.target === target) hits.push(c.dmg.type); });
    const initialDistance = Math.abs(target.x - chorus.x) + Math.abs(target.y - chorus.y);
    h.run(2.5);
    const movingDistance = Math.abs(target.x - chorus.x) + Math.abs(target.y - chorus.y);
    assert.ok(movingDistance < initialDistance - 0.4, `chorus advanced over multiple ticks (${initialDistance} → ${movingDistance})`);
    assert.ok(h.runUntil(() => hits.length > 0, 20), 'chorus reaches its ranged attack radius and fires');
    assert.ok(hits.includes('arts'), `actual chorus hit types: ${hits.join(', ')}`);
    assert.equal(target.blockedBy, null, 'ranged chorus does not block');
    assert.ok(Math.hypot(target.x - chorus.x, target.y - chorus.y) <= 2.5, 'chorus stops within its real 2.4-tile attack radius');
    const stopped = [chorus.x, chorus.y];
    h.run(0.6);
    assert.deepEqual([chorus.x, chorus.y], stopped, 'chorus stays in range instead of walking into the target');
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    assertLethaniaRuntime(h);
  });

  test('莱塔尼亚: melee pursuit routes around terrain crates, then reselects after target death', (t) => {
    const h = fight(t, {
      flat: { crates: [[10, 7]] },
      bonds: { lethaniaShip: bond(3, 0) },
      pieces: [
        piece('reg_le_path_member', ['lethaniaShip'], { row: 12, col: 2, skill: null, rangeGrid: [[0, 0]] }),
        piece('reg_le_path_occupant', [], { row: 10, col: 6, skill: null }),
      ],
    });
    h.step();
    assert.equal(h.b.grid.groundPassable(10, 7), false, 'fixture crate blocks the straight path');
    const corpse = tank(h, [10, 8]);
    h.b.kill(corpse, null);
    const [note] = lethaniaSummons(h);
    assert.ok(note);
    const first = tank(h, [10.22, 4.31]);
    h.run(2.5);
    assert.notEqual(note.tileR, 10, 'the note leaves the direct row to route around the terrain crate');
    assert.notDeepEqual([note.tileR, note.tileC], [10, 7], 'does not enter the crate tile');
    assert.notDeepEqual([note.tileR, note.tileC], [10, 6], 'position at this crate-route checkpoint');
    assert.ok(Math.abs(first.x - note.x) + Math.abs(first.y - note.y) < 5, 'advances toward the target via the crate detour');

    const second = tank(h, [12.27, 15.31]);
    h.b.kill(first, null);
    assert.equal(first.alive, false);
    const beforeRetarget = Math.abs(second.x - note.x) + Math.abs(second.y - note.y);
    h.run(2.5);
    const afterRetarget = Math.abs(second.x - note.x) + Math.abs(second.y - note.y);
    assert.ok(afterRetarget < beforeRetarget - 0.4, `moves toward the remaining enemy (${beforeRetarget} → ${afterRetarget})`);
    assert.notDeepEqual([note.tileR, note.tileC], [10, 6]);
    assert.notDeepEqual([note.tileR, note.tileC], [10, 7]);
    assert.equal(h.b.errorCount, 0, JSON.stringify(h.b.errors));
    assertLethaniaRuntime(h);
  });

  test('聚合: stacked heals, element recovery, shelter is the strongest not the sum', (t) => {
    const bb = params(v3().bonds.docShip, 'act3autochess_bond_eff_doc');
    assert.equal(bb.heal_base, 0.16);
    assert.equal(bb.ep_heal_base, 0.08);
    assert.equal(bb.damage_res_base, 0.15);
    const h = fight(t, {
      bonds: { docShip: bond(2, 0, 1) },
      pieces: [
        piece('reg_doc_a', ['docShip'], { col: 4, rangeGrid: [[0, 0], [0, 1]] }),
        piece('reg_doc_b', ['docShip'], { col: 5, rangeGrid: [[0, 0], [0, -1]] }),
      ],
    });
    h.step();
    const a = h.unit('reg_doc_a');
    const b = h.unit('reg_doc_b');
    a.hp = 100;
    b.hp = 100;
    h.run(1.1);
    close(a.hp, 260, 'each member heals the other and itself');
    close(b.hp, 260, 'stacked heals');

    const h3 = fight(t, {
      bonds: { docShip: bond(3, 0, 2) },
      pieces: [
        piece('reg_doc_p', ['docShip'], { col: 4, rangeGrid: [[0, 0], [0, 1]] }),
        piece('reg_doc_q', ['docShip'], { col: 5, rangeGrid: [[0, 0], [0, -1]] }),
      ],
    });
    h3.step();
    const p = h3.unit('reg_doc_p');
    h3.b.dealElementDamage({ source: null, target: p, amount: 100, element: 'burn' });
    h3.run(1.1);
    close(gauges(p), 20, 'two members each heal 40 element');
    const before = p.hp;
    h3.b.dealDamage({ source: null, target: p, amount: 1000, type: 'true' });
    close(before - p.hp, 850, 'shelter 15%, not 30%');
  });

  test('奥术 rider arts, RES floor at 3, stealth stripped in range', (t) => {
    const one = fight(t, {
      bonds: { arcaneShip: bond(1, 0, 1) },
      pieces: [piece('reg_ar1', ['arcaneShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    one.step();
    const m = one.unit('reg_ar1');
    const e = tank(one, [9, 4]);
    const hp = e.hp;
    one.b.dealDamage({ source: m, target: e, amount: 100, type: 'phys' });
    close(hp - e.hp, 200, '100 phys + 0.2×atk arts');
    one.b.applyStatus(e, 'stealth', { duration: 5, source: null });
    assert.equal(!!e.s.flags.stealth, true);

    const h = fight(t, {
      bonds: { arcaneShip: bond(3, 0, 2) },
      pieces: [piece('reg_ar3', ['arcaneShip'], { rangeGrid: [[0, 0], [-1, 0]] })],
    });
    h.step();
    const u = h.unit('reg_ar3');
    const tnk = tank(h, [9, 4]);
    const hp0 = tnk.hp;
    h.b.dealDamage({ source: u, target: tnk, amount: 100, type: 'phys' });
    close(hp0 - tnk.hp, 201, 'arts sees res −1');
    const res = tnk.findBuff('bond:arcane:res');
    assert.ok(res);
    close(res.mods.resFlat, -2, 'the phys hit and the rider each drop RES');
    h.b.applyStatus(tnk, 'stealth', { duration: 5, source: null });
    assert.equal(!!tnk.s.flags.stealth, false);
  });

  test('精准 迅捷 灵巧 坚守 助力 use the season blackboards', (t) => {
    setGameData(v3());
    t.after(() => setGameData(null));
    const preci = bondBb('preciShip');
    const swift = bondBb('swiftShip');
    const skillful = bondBb('skillfulShip');
    const stead = bondBb('steadShip');
    const deput = bondBb('deputShip');
    assert.equal(preci.base_atk, 0.1);
    assert.equal(swift.normal_sp, 12);
    assert.equal(swift.power_sp, 15);
    assert.equal(skillful.base_attack_speed, 10);
    assert.equal(stead.base_max_hp, 0.25);
    assert.equal(deput.base_def, 0.15);

    const hp = fight(t, {
      bonds: { preciShip: bond(1, 0, 1) },
      pieces: [piece('reg_pr', ['preciShip'])],
    });
    hp.step();
    close(hp.unit('reg_pr').s.atk, 550, 'preci');

    const pen = fight(t, {
      bonds: { preciShip: bond(3, 0, 2) },
      pieces: [
        piece('reg_pr_m', ['preciShip'], { col: 4 }),
        piece('reg_pr_r', [], { col: 6, profession: 'SNIPER', position: 'RANGED', skill: null }),
      ],
    });
    pen.step();
    close(pen.unit('reg_pr_r').s.defIgnorePct, 0.3, 'preci pen');

    const sw = fight(t, {
      bonds: { swiftShip: bond(1, 300, 1) },
      pieces: [
        piece('reg_sw', ['swiftShip'], { col: 4, skill: { spCost: 100, duration: 10, skillType: 'MANUAL', initSp: 0 } }),
        piece('reg_sw_x', [], { col: 6, skill: { spCost: 100, duration: 10, skillType: 'MANUAL', initSp: 0 } }),
      ],
    });
    sw.step();
    for (const id of ['reg_sw', 'reg_sw_x']) {
      const s = sw.unit(id).skill;
      s.sp = 0;
      s.charges = 0;
      assert.ok(s.activate('test', { free: true }));
      s.end('test');
    }
    close(sw.unit('reg_sw').skill.sp, 27, 'member rolls both');
    close(sw.unit('reg_sw_x').skill.sp, 15, 'others roll the power grant');

    const sk = fight(t, {
      bonds: { skillfulShip: bond(1, 0, 1) },
      pieces: [piece('reg_sk', ['skillfulShip'], { col: 4, skill: null }), piece('reg_sk_n', [], { col: 5, skill: null })],
    });
    sk.step();
    close(sk.unit('reg_sk_n').s.aspd, 110, 'skillful neighbour');

    const st = fight(t, {
      bonds: { steadShip: bond(1, 0, 1) },
      pieces: [piece('reg_st', ['steadShip'], { skill: null })],
    });
    st.step();
    close(st.unit('reg_st').s.maxHp, 2500, 'stead hp');

    const dp = fight(t, {
      bonds: { deputShip: bond(1, 0, 1) },
      pieces: [piece('reg_dp', ['deputShip'], { def: 200, skill: null })],
    });
    dp.step();
    close(dp.unit('reg_dp').s.def, 230, 'deput def');
  });

  test('助力 prep adds layers; 远见 prices; 奇迹 forces the shop tier', (t) => {
    setGameData(v3());
    t.after(() => setGameData(null));
    const handlers = addonHandlers();
    const bonds = {
      deputShip: { active: true, tier: 2, layers: 0 },
      preciShip: { active: true, tier: 1, layers: 0 },
      soloShip: { active: false, tier: 0, layers: 0 },
    };
    const added = [];
    handlers.deputShip.onPrepEnd({
      data: v3(),
      bond: (id) => bonds[id],
      bonds: () => bonds,
      addLayers: (id, n) => added.push([id, n]),
    });
    assert.deepEqual(added.sort(), [['deputShip', 4], ['preciShip', 4]]);

    const visi = (layers) => {
      const counters = {};
      const prices = [];
      const toasts = [];
      let funds = 0;
      const ctx = {
        data: v3(),
        bondActive: () => true,
        layers: () => layers,
        counter: (k) => counters[k] || 0,
        setCounter: (k, v) => { counters[k] = v; },
        addFunds: (n) => { funds += n; },
        addPendingFunds: (n) => { funds += n; },
        toast: (m) => toasts.push(m),
        phase: 'SHOP',
        round: 1,
        chessRecord: (id) => ({ bonds: id === 'visi' ? ['visiShip'] : ['yanShip'] }),
        modifyPrice: (d) => prices.push(d),
      };
      handlers.visiShip.onLayers(ctx, { bondId: 'visiShip' });
      handlers.visiShip.onPrice(ctx, { kind: 'chess', id: 'visi' });
      handlers.visiShip.onPrice(ctx, { kind: 'chess', id: 'other' });
      return { counters, prices, toasts, funds };
    };
    const at80 = visi(80);
    assert.equal(at80.funds, 16);
    assert.equal(at80.counters['bondaddon:visi:disc'], 1);
    assert.deepEqual(at80.prices, [-1]);
    assert.ok(at80.toasts.includes('【远见】远见干员购买价格永久降低'));
    const at150 = visi(150);
    assert.equal(at150.counters['bondaddon:visi:disc'], 2);
    assert.deepEqual(at150.prices, [-2]);
    assert.ok(at150.toasts.includes('【远见】远见干员购买价格再次永久降低'));

    const refresh = (layers) => {
      const slots = [{ kind: 'chess', sold: false, id: 'old' }, { kind: 'chess', sold: true, id: 'gone' }];
      const ctx = {
        data: v3(),
        bondActive: () => true,
        layers: () => layers,
        shopLevel: () => 3,
        shopSlots: () => slots,
        setShopSlot: (i, s) => { slots[i] = s; },
        rollChess: ({ tier }) => `rolled-${tier}`,
        grantFreeRefresh: () => 0,
        rng: () => 1,
        toast() {},
      };
      handlers.miraShip.onRefresh(ctx, {});
      return slots[0].id;
    };
    assert.equal(refresh(99), 'old');
    assert.equal(refresh(100), 'rolled-3');
  });

  test('突袭 jumps onto the buff; 不屈 redeploys before 卡西米尔 can switch', (t) => {
    const raid = bondBb('raidShip');
    assert.equal(raid.base_atk, 0.25);
    assert.equal(raid.no_attack_duration, 10);
    const h = fight(t, {
      bonds: { raidShip: bond(1, 0, 1) },
      spawns: [{ key: 'reg_tank', pos: [9, 8], time: 0 }],
      pieces: [piece('reg_raid', ['raidShip'], {
        row: 12, col: 3,
        skill: { spCost: 10, duration: 10, skillType: 'MANUAL', initSp: 10 },
      })],
    });
    h.run(0.6);
    const u = h.unit('reg_raid');
    assert.notDeepEqual([u.tileR, u.tileC], [12, 3]);
    close(u.s.atk, 625, 'raid atk');
    close(u.s.maxHp, 2500, 'raid hp');
    assert.ok(h.enemies().length >= 1);

    const ind = bondBb('indomShip');
    assert.equal(ind.base_prob, 0.18);
    assert.equal(ind.prob_per_stack, 0.004);
    const bench = piece('reg_ind_b', ['kazimierzShip'], { bench: true });
    const hk = fight(t, {
      bonds: { indomShip: bond(1, 205, 1), kazimierzShip: bond(6, 0) },
      pieces: [piece('reg_ind', ['indomShip', 'kazimierzShip']), bench],
      contentInfo: { handPieces: [{ slot: 0, id: 'reg_ind_b', bonds: ['kazimierzShip'], position: 'MELEE' }] },
    });
    hk.step();
    const op = hk.unit('reg_ind');
    hk.b.dealDamage({ source: null, target: op, amount: 1e9, type: 'true' });
    assert.equal(op.alive, true);
    assert.equal(living(hk, 'reg_ind_b').length, 0);
  });

  test('协防 reduces phys and arts, not true; 独行 and 绝技 buff the season numbers', (t) => {
    const empty = bondBb('emptyShip');
    const solo = bondBb('soloShip');
    const sunt = bondBb('suntShip');
    assert.equal(empty.damage_resistance, 0.2);
    assert.equal(empty.damage_scale_normal, 1.2);
    assert.equal(empty.damage_scale_extra, 1.4);
    assert.equal(solo.atk, 0.6);
    assert.equal(sunt.power_atk, 0.3);
    const h = fight(t, {
      bonds: { emptyShip: bond(1, 0, 1) },
      pieces: [
        piece('reg_em', ['emptyShip'], { col: 4, rangeGrid: [[0, 0], [-1, 0]] }),
        piece('reg_em_g', ['emptyShip'], { col: 6, golden: true, skill: null }),
      ],
    });
    h.step();
    const u = h.unit('reg_em');
    const foe = tank(h, [9, 8]);
    const hp = u.hp;
    h.b.dealDamage({ source: foe, target: u, amount: 100, type: 'phys' });
    close(hp - u.hp, 80, 'empty phys taken');
    const hpA = u.hp;
    h.b.dealDamage({ source: foe, target: u, amount: 100, type: 'arts' });
    close(hpA - u.hp, 80, 'empty arts taken');
    const hpT = u.hp;
    h.b.dealDamage({ source: foe, target: u, amount: 100, type: 'true' });
    close(hpT - u.hp, 100, 'empty true is full');
    const dealt = tank(h, [9, 4]);
    const d0 = dealt.hp;
    h.b.dealDamage({ source: u, target: dealt, amount: 100, type: 'phys' });
    close(d0 - dealt.hp, 120, 'member dealt');
    const g = h.unit('reg_em_g');
    const d1 = dealt.hp;
    h.b.dealDamage({ source: g, target: dealt, amount: 100, type: 'phys' });
    close(d1 - dealt.hp, 140, 'elite dealt');

    const so = fight(t, {
      bonds: { soloShip: bond(1, 0, 1) },
      pieces: [piece('reg_solo', ['soloShip'], { skill: { spCost: 100, duration: 10, initSp: 0, skillType: 'MANUAL' } })],
    });
    so.step();
    const s = so.unit('reg_solo');
    close(s.s.atk, 800, 'solo atk');
    close(s.s.maxHp, 3200, 'solo hp');
    assert.ok(s.skill.sp >= 15 - 0.01, `solo sp ${s.skill.sp}`);

    const su = fight(t, {
      bonds: { suntShip: bond(2, 0, 1) },
      pieces: [
        piece('reg_su', ['suntShip'], { golden: true, skill: null }),
        piece('reg_su_n', ['suntShip'], { col: 6, skill: null }),
      ],
    });
    su.step();
    close(su.unit('reg_su').s.atk, 650, 'elite sunt');
    close(su.unit('reg_su_n').s.atk, 500, 'non-elite');
  });

  test('投资人 and 调和 have no battle installer and a battle with them still runs', (t) => {
    const h = fight(t, {
      bonds: { investShip: bond(1, 0, 1), maniShip: bond(1, 0, 1) },
      pieces: [piece('reg_inv', ['investShip'], { col: 4, skill: null }), piece('reg_mani', ['maniShip'], { col: 6, skill: null })],
    });
    h.step();
    assert.equal(h.unit('reg_inv').alive, true);
    assert.equal(h.unit('reg_mani').alive, true);
    h.invariants();
  });
});
