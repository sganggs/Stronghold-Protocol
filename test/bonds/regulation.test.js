// 规程·序列Ⅰ bonds (act3autochess V3_1). One battle or prep check per clause.
// Numbers come from data/versions/act3autochess-v3_1. Band swaps are a changed effectId
// (auto_chess_effect_replace is not implemented). setGameData is process-global, so this file is serial.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
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
    rec, bench: !!o.bench,
    place: { chessId: id, row: o.row ?? 10, col: o.col ?? 4, items: o.items, uid: o.uid },
  };
}

function fight(t, spec) {
  const base = v3();
  const chess = { ...base.chess };
  const units = [];
  for (const p of spec.pieces || []) {
    chess[p.rec.chessId] = p.rec;
    if (!p.bench) units.push(p.place);
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
  return makeBattle({
    seed: spec.seed ?? 1,
    data,
    timeLimit: spec.timeLimit ?? 90,
    autoFinish: false,
    enemies: spec.spawns,
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: units.map((u, i) => ({ uid: u.uid ?? i + 1, kind: 'chess', ...u })),
      bonds: spec.bonds,
      contentInfo: spec.contentInfo,
    }],
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

  test('莱塔尼亚: a note at start bleeds; six members at high layers summon a chorus', (t) => {
    const bb = params(v3().bonds.lethaniaShip, 'act3autochess_bond_eff_lethania');
    assert.equal(bb.atk_base, 0.3);
    assert.equal(bb.summon_prob_base, 1);
    const h = fight(t, {
      bonds: { lethaniaShip: bond(1, 0, 1) },
      pieces: [piece('reg_le', ['lethaniaShip'])],
    });
    h.step();
    close(h.unit('reg_le').s.atk, 500 * 1.3, 'lethania atk');
    const notes = h.b.allyUnits.filter((u) => u.defId === NOTE && u.alive);
    assert.equal(notes.length, 1);
    close(notes[0].s.maxHp, 2350, 'note hp');
    h.run(1.1);
    close(notes[0].hp, 2350 - 235, 'note bleed');

    const h6 = fight(t, {
      bonds: { lethaniaShip: bond(6, 700) },
      pieces: [piece('reg_le6', ['lethaniaShip'])],
    });
    h6.step();
    const chorus = h6.b.allyUnits.filter((u) => u.defId === CHORUS && u.alive);
    assert.equal(chorus.length, 1);
    close(chorus[0].s.aspd, 120, 'chorus aspd');
    h6.run(1.1);
    close(chorus[0].hp, 8500 - 850, 'chorus bleed');
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
