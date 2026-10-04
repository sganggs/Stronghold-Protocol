// Add-on bonds (server/sim/content/bonds/addon.js): battle effects of 精准 迅捷 灵巧 奥术 坚守 助力 突袭 不屈 协防干员 独行
// 绝技 and the prep side of 助力 远见 奇迹 投资人 调和 (numbers from data/bonds.json, research 02 §3.9–§3.23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants, flatStage } from '../helpers/battleHarness.js';
import { gainLayers, inRange } from '../../server/sim/content/support/index.js';
import { bondBb, procChance } from '../../server/sim/content/bonds/addon/battle.js';
import { registerMeta } from '../../server/sim/content/bonds/addon.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { makeMatch, give, legalTileFor } from '../match/harness.js';

const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);
const op = (id, bonds, extra = {}) => chessRec({ id, bonds, profession: 'WARRIOR', skill: null, ...extra });
const ranged = (id, bonds, extra = {}) => chessRec({ id, bonds, profession: 'SNIPER', skill: null, rangeGrid: [[0, 0]], ...extra });
const bond = (tier, layers = 0, count = 2) => ({ count, active: tier > 0, tier, layers });
const DUMMY = { enemy_addon_dummy: enemyRec({ key: 'enemy_addon_dummy', hp: 1e6, speed: 0 }) };
const hasBondBuff = (u) => u.buffs.some((b) => String(b.key).startsWith('bond:'));

// ---------------------------------------------------------------------------------------------------------------------
// battle side

test('精准: members ATK ×(1+0.10+0.012·L), live layers; tier 2 widens to ranged operators with 30% DEF/RES ignore', () => {
  const bb = bondBb('preciShip');
  const defs = { chess: { p_m: op('p_m', ['preciShip']), p_r: ranged('p_r', []), p_x: op('p_x', []) } };
  const units = [{ chessId: 'p_m', row: 10, col: 3 }, { chessId: 'p_r', row: 11, col: 3 }, { chessId: 'p_x', row: 12, col: 3 }];
  const h = makeBattle({ defs, units, bonds: { preciShip: bond(1, 10) } });
  h.step();
  close(h.unit('p_m').s.atk, 500 * (1 + bb.base_atk + bb.atk_per_stack * 10), 'member');
  close(h.unit('p_r').s.atk, 500, 'ranged non-member (tier 1)');
  close(h.unit('p_m').s.defIgnorePct, 0);
  gainLayers(h.b, { playerId: 'p1', bonds: 'preciShip', n: 15 });
  h.step(2);
  close(h.unit('p_m').s.atk, 500 * (1 + bb.base_atk + bb.atk_per_stack * 25), 'live layers');
  checkInvariants(h.b);

  const h2 = makeBattle({ defs, units, bonds: { preciShip: bond(2, 0, 3) } });
  h2.step();
  const r = h2.unit('p_r');
  close(r.s.atk, 500 * (1 + bb.base_atk), 'ranged op in scope');
  close(r.s.defIgnorePct, bb.power_def_penetrate);
  close(r.s.resIgnorePct, bb.power_magic_resist_penetrate);
  close(h2.unit('p_x').s.atk, 500, 'melee non-member');
  checkInvariants(h2.b);
});

test('迅捷: member skill end +12 SP (p=1 at high L), ≥40 layers every operator +15 extra; inactive → nothing', () => {
  const bb = bondBb('swiftShip');
  const sk = { spCost: 30, initSp: 30, trigger: { rule: 'SP_FULL' } };
  const defs = { chess: {
    s_m: chessRec({ id: 's_m', bonds: ['swiftShip'], skill: sk }),
    s_x: chessRec({ id: 's_x', bonds: [], skill: sk }),
  } };
  const kits = { s_m: () => ({ skill: { kind: 'instant', trigger: 'SP_FULL' } }), s_x: () => ({ skill: { kind: 'instant', trigger: 'SP_FULL' } }) };
  const run = (b) => {
    const seen = {};
    const h = makeBattle({
      defs, kits, bonds: { swiftShip: b }, units: [{ chessId: 's_m', row: 10, col: 3 }, { chessId: 's_x', row: 12, col: 3 }],
      setup: (bt) => bt.on('skillEnd', (c) => { seen[c.unit.defId] ??= c.unit.skill.sp; }, { priority: -1000 }),
    });
    h.run(0.2);
    checkInvariants(h.b);
    return seen;
  };
  const hi = run(bond(1, 1000));
  close(hi.s_m, bb.normal_sp + bb.power_sp, 'member rolls both');
  close(hi.s_x, bb.power_sp, 'non-member: 40-layer extra only');
  const low = run(bond(1, 39));
  assert.ok(low.s_x === 0, 'no 40-layer effect below the milestone');
  const off = run(bond(0, 1000));
  assert.equal(off.s_m, 0);
  assert.equal(off.s_x, 0);
});

test('迅捷 / 不屈 proc chances: p = min(1, base + per·L) at each layer count', () => {
  const sw = bondBb('swiftShip'), ind = bondBb('indomShip');
  close(procChance(sw, 0), 0.20);
  close(procChance(sw, 40), 0.20 + 0.0035 * 40);
  close(procChance(sw, 228), 0.20 + 0.0035 * 228);
  close(procChance(sw, 229), 1, 'swift reaches 100 % at 229');
  close(procChance(ind, 0), 0.18);
  close(procChance(ind, 50), 0.18 + 0.004 * 50);
  close(procChance(ind, 205), 1, 'indom reaches 100 % at 205');
  close(procChance(ind, 1000), 1, 'capped');
});

test('灵巧: aura on members + 4 neighbours (once), 8 tiles at ≥40 layers, follows death and relocation', () => {
  const defs = { chess: { k_1: op('k_1', ['skillfulShip']), k_2: op('k_2', ['skillfulShip']), k_n: op('k_n', []), k_d: op('k_d', []), k_f: op('k_f', []) } };
  const h = makeBattle({
    defs, bonds: { skillfulShip: bond(1, 5) },
    units: [
      { chessId: 'k_1', row: 10, col: 4 }, { chessId: 'k_2', row: 10, col: 3 }, { chessId: 'k_n', row: 10, col: 5 },
      { chessId: 'k_d', row: 11, col: 5 }, { chessId: 'k_f', row: 12, col: 9 },
    ],
  });
  h.step(2);
  const a = (id) => h.unit(id).s.aspd;
  assert.equal(a('k_1'), 115, 'member, two auras → once');
  assert.equal(a('k_n'), 115, '4-neighbour');
  assert.equal(a('k_d'), 100, 'diagonal outside the 4 tiles');
  assert.equal(a('k_f'), 100);
  gainLayers(h.b, { playerId: 'p1', bonds: 'skillfulShip', n: 35 });
  h.step(2);
  assert.equal(a('k_d'), 150, '8 tiles at 40 layers');
  assert.equal(a('k_n'), 150);
  assert.ok(h.b.relocate(h.unit('k_n'), 12, 7));
  h.run(0.4);
  assert.equal(a('k_n'), 100, 'relocated out of the aura');
  h.b.dealDamage(null, h.unit('k_1'), { amount: 1e9, type: 'true' });
  h.step(2);
  assert.equal(a('k_d'), 100, 'aura source died');
  checkInvariants(h.b);
});

test('奥术: member arts damage → target arts taken ×(1.2+0.01·L) for 3 s; tier 2 below 50% HP ×1.4', () => {
  const bb = bondBb('arcaneShip');
  const defs = { chess: { a_m: chessRec({ id: 'a_m', bonds: ['arcaneShip'], profession: 'CASTER', skill: null, rangeGrid: [[0, 0]] }), a_x: op('a_x', []) }, enemies: DUMMY };
  const mk = (b) => makeBattle({ defs, bonds: { arcaneShip: b }, units: [{ chessId: 'a_m', row: 12, col: 3 }, { chessId: 'a_x', row: 11, col: 3 }], enemies: [{ key: 'enemy_addon_dummy', pos: [9, 9] }] });
  const h = mk(bond(1, 10));
  h.step(2);
  const e = h.enemy('enemy_addon_dummy');
  h.b.dealDamage(h.unit('a_x'), e, { amount: 100, type: 'arts' });
  close(e.s.artsTakenMul, 1, 'non-member');
  h.b.dealDamage(h.unit('a_m'), e, { amount: 100, type: 'phys' });
  close(e.s.artsTakenMul, 1, 'physical damage');
  h.b.dealDamage(h.unit('a_m'), e, { amount: 100, type: 'arts' });
  const m = bb.base_damage_scale + bb.damage_scale_per_stack * 10;
  close(e.s.artsTakenMul, m, 'vulnerable');
  e.hp = e.s.maxHp * 0.3;
  h.b.dealDamage(h.unit('a_m'), e, { amount: 100, type: 'arts' });
  close(e.s.artsTakenMul, m, 'tier 1 ignores the HP threshold');
  h.run(bb.weak_duration + 0.2);
  close(e.s.artsTakenMul, 1, 'expired');
  checkInvariants(h.b);

  const h2 = mk(bond(2, 10, 3));
  h2.step(2);
  const e2 = h2.enemy('enemy_addon_dummy');
  e2.hp = e2.s.maxHp * 0.3;
  h2.b.dealDamage(h2.unit('a_m'), e2, { amount: 100, type: 'arts' });
  close(e2.s.artsTakenMul, m * bb.power_weak_scale, 'low-HP multiplier (+68%+1.4%/L)');
  close(e2.s.artsTakenMul - 1, bb.base_damage_scale_show_ex + bb.damage_scale_per_stack_show_ex * 10, 'matches the *_show keys');
  checkInvariants(h2.b);
});

test('奥术 with two players on one field: one instance per target, the strongest wins (never multiplied); a weaker one resumes after it', () => {
  // DESIGN §20.10: PRTS 作战机制 "同名buff的默认叠加策略buff只能表现出一个"; 巴哈姆特 12316 "共享型buff會跟對面搶 如果對面層數比你高
  // 就不需要再特別激活直接吃他的奧術buff". v2.5 kept one instance per player: ×(1.3)·×(1.7) here.
  const bb = bondBb('arcaneShip');
  const caster = (id) => chessRec({ id, bonds: ['arcaneShip'], profession: 'CASTER', skill: null, rangeGrid: [[0, 0]] });
  const defs = { chess: { a_1: caster('a_1'), a_2: caster('a_2'), a_x: op('a_x', []) }, enemies: DUMMY };
  const h = makeBattle({
    kind: 'boss', defs,
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'a_1', row: 12, col: 3 }], bonds: { arcaneShip: bond(1, 10) } },
      { playerId: 'p2', seat: 1, side: 'R', colOffset: 0, units: [{ uid: 2, kind: 'chess', chessId: 'a_2', row: 12, col: 3 }, { uid: 3, kind: 'chess', chessId: 'a_x', row: 11, col: 3 }], bonds: { arcaneShip: bond(1, 50) } },
    ],
    enemies: [{ key: 'enemy_addon_dummy', pos: [9, 9] }],
  });
  h.step(2);
  const e = h.enemy('enemy_addon_dummy');
  const u1 = h.b.allyUnits.find((u) => u.defId === 'a_1'), u2 = h.b.allyUnits.find((u) => u.defId === 'a_2');
  const m1 = bb.base_damage_scale + bb.damage_scale_per_stack * 10, m2 = bb.base_damage_scale + bb.damage_scale_per_stack * 50;
  h.b.dealDamage(u1, e, { amount: 100, type: 'arts' });
  close(e.s.artsTakenMul, m1, 'p1 alone');
  h.b.dealDamage(u2, e, { amount: 100, type: 'arts' });
  close(e.s.artsTakenMul, m2, 'the stronger p2 instance takes over — not m1 × m2');
  h.b.dealDamage(u1, e, { amount: 100, type: 'arts' });
  close(e.s.artsTakenMul, m2, 'a weaker application never overrides it');
  assert.equal(e.buffs.filter((b) => String(b.key).startsWith('bond:arcaneShip')).length, 1, 'one buff on the target');
  // the partner's non-member arts damage benefits too (it is a debuff on the target)
  const x = h.b.allyUnits.find((u) => u.defId === 'a_x');
  const hp0 = e.hp;
  h.b.dealDamage(x, e, { amount: 100, type: 'arts' });
  close(hp0 - e.hp, 100 * m2, 'any arts damage on the target');
  // p2 stops: its instance expires at 3 s, p1's later application (≈ 3 s too) resumes for the rest
  h.run(1);
  h.b.dealDamage(u1, e, { amount: 100, type: 'arts' });
  close(e.s.artsTakenMul, m2, 'still the stronger one');
  h.run(bb.weak_duration - 1 + 0.1);
  close(e.s.artsTakenMul, m1, 'the stronger expired, the weaker (applied later) resumes');
  h.run(1.1);
  close(e.s.artsTakenMul, 1, 'both expired');
  checkInvariants(h.b);
});

test('坚守: all operators HP ×(1.25+0.012·L); tier 2 redirect 40% to members, thorns + fragile, cooldown, no loops', () => {
  const bb = bondBb('steadShip');
  const defs = { chess: { d_1: op('d_1', ['steadShip']), d_2: op('d_2', ['steadShip']), d_n: op('d_n', []) }, enemies: DUMMY };
  const units = [{ chessId: 'd_1', row: 10, col: 3 }, { chessId: 'd_2', row: 10, col: 5 }, { chessId: 'd_n', row: 12, col: 3 }];
  const h1 = makeBattle({ defs, units, bonds: { steadShip: bond(1, 10) }, enemies: [{ key: 'enemy_addon_dummy', pos: [9, 9] }] });
  h1.step(2);
  const hpMul = 1 + bb.base_max_hp + bb.max_hp_per_stack * 10;
  close(h1.unit('d_n').s.maxHp, 2000 * hpMul, 'non-member HP');
  const n1 = h1.unit('d_n');
  h1.b.dealDamage(h1.enemy('enemy_addon_dummy'), n1, { amount: 1000, type: 'true' });
  close(n1.s.maxHp - n1.hp, 1000, 'tier 1: no redirect');

  const h = makeBattle({ defs, units, bonds: { steadShip: bond(2, 10, 3) }, enemies: [{ key: 'enemy_addon_dummy', pos: [9, 9] }] });
  h.step(2);
  const e = h.enemy('enemy_addon_dummy');
  const [d1, d2, dn] = ['d_1', 'd_2', 'd_n'].map((id) => h.unit(id));
  const e0 = e.hp;
  h.b.dealDamage(e, dn, { amount: 1000, type: 'true' });
  close(dn.s.maxHp - dn.hp, 600, 'non-member keeps 60%');
  close(d1.s.maxHp - d1.hp, 200, 'member share');
  close(d2.s.maxHp - d2.hp, 200, 'member share');
  close(e.hp, e0, 'redirected damage never thorns');
  const thorn = bb.base_damage_value + bb.damage_value_per_stack * 10;
  h.b.dealDamage(e, d1, { amount: 100, type: 'true' });
  close(e0 - e.hp, thorn, 'thorns');
  close(e.s.dmgTakenMul, bb.damage_scale, 'fragile');
  const e1 = e.hp;
  h.b.dealDamage(e, d1, { amount: 100, type: 'true' });
  close(e.hp, e1, 'per-member cooldown');
  h.b.dealDamage(e, d2, { amount: 100, type: 'true' });
  close(e1 - e.hp, thorn * bb.damage_scale, 'other member thorns, fragile applies');
  h.run(bb.cd_duration + 0.05);
  const e2 = e.hp;
  h.b.dealDamage(null, d1, { amount: 50, type: 'true' });
  close(e.hp, e2, 'sourceless damage: no thorns');
  checkInvariants(h.b);
});

test('坚守 thorns: 无来源 (no attacker bonus, hooks see no source) but credited to the member — its stats and the shared-pool tally', async () => {
  // DESIGN §20.10: v2.5 dealt them with no source at all, so no player's boss damage counted them (19 % of a co-op pool)
  const { SharedBossPool } = await import('../../server/match/finalAssault.js');
  const bb = bondBb('steadShip');
  const defs = { chess: { d_1: op('d_1', ['steadShip']), d_2: op('d_2', ['steadShip']) }, enemies: DUMMY };
  const pool = new SharedBossPool(1e6);
  const h = makeBattle({ defs, kind: 'boss', sharedBoss: pool, units: [{ chessId: 'd_1', row: 10, col: 3 }, { chessId: 'd_2', row: 10, col: 5 }],
    bonds: { steadShip: bond(2, 10) }, enemies: [{ key: 'enemy_addon_dummy', pos: [9, 9], tag: 'boss' }], hooks: ['damaged'], captureNoisy: true });
  h.step(2);
  const e = h.enemy('enemy_addon_dummy'), d1 = h.unit('d_1');
  assert.ok(e.bossPool, 'the leader drains the pool');
  h.b.addBuff(d1, { key: 'test:rage', mods: { dmgDealtMul: 2 } });
  const p0 = pool.hp, dmg0 = d1.stats.dmg;
  h.b.dealDamage(e, d1, { amount: 100, type: 'true' });
  const thorn = bb.base_damage_value + bb.damage_value_per_stack * 10;
  close(p0 - pool.hp, thorn, 'thorns hit the pool, the member\'s ×2 does not apply');
  const ev = h.hooksOf('damaged').filter((c) => c.target === e);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].source, null, '无来源: hooks see no source');
  assert.equal(ev[0].credit, d1, 'credited to the member');
  close(d1.stats.dmg - dmg0, thorn, 'member stats');
  close(h.result().perPlayer.p1.bossDamage, thorn, 'its player\'s shared-pool tally');
});

test('坚守 tier 2: the redirected 40 % is the already-scaled damage — the attacker’s damage bonus is not applied twice', () => {
  const defs = { chess: { d_1: op('d_1', ['steadShip']), d_2: op('d_2', ['steadShip']), d_n: op('d_n', []) }, enemies: DUMMY };
  const units = [{ chessId: 'd_1', row: 10, col: 3 }, { chessId: 'd_2', row: 10, col: 5 }, { chessId: 'd_n', row: 12, col: 3 }];
  const h = makeBattle({ defs, units, bonds: { steadShip: bond(2, 0, 3) }, enemies: [{ key: 'enemy_addon_dummy', pos: [9, 9] }] });
  h.step(2);
  const e = h.enemy('enemy_addon_dummy');
  h.b.addBuff(e, { key: 'test:rage', mods: { dmgDealtMul: 2 } });
  const [d1, d2, dn] = ['d_1', 'd_2', 'd_n'].map((id) => h.unit(id));
  h.b.dealDamage(e, dn, { amount: 1000, type: 'true' });              // 2000 after the attacker's ×2
  close(dn.s.maxHp - dn.hp, 1200, 'non-member keeps 60 % of 2000');
  close(d1.s.maxHp - d1.hp, 400, 'member share: 40 % of 2000 split in two (not ×2 again)');
  close(d2.s.maxHp - d2.hp, 400);
  checkInvariants(h.b);
});

test('助力: all operators DEF ×(1.15+0.012·L) and redeploy time ×0.7', () => {
  const bb = bondBb('deputShip');
  const defs = { chess: { z_m: op('z_m', ['deputShip']), z_x: op('z_x', []) } };
  const h = makeBattle({ defs, bonds: { deputShip: bond(1, 20) }, units: [{ chessId: 'z_m', row: 10, col: 3 }, { chessId: 'z_x', row: 12, col: 3 }] });
  h.step();
  const x = h.unit('z_x');
  close(x.s.def, 200 * (1 + bb.base_def + bb.def_per_stack * 20), 'DEF');
  const t0 = h.b.time;
  h.b.dealDamage(null, x, { amount: 1e9, type: 'true' });
  close(x.respawnAt - t0, 20 * (1 + bb.respawn_time), 'redeploy time');
  checkInvariants(h.b);
});

test('突袭: idle member relocates next to a ground enemy (SP kept) with ATK/HP ×(1.25+0.01·L); ≥50 layers all ASPD +50', () => {
  const bb = bondBb('raidShip');
  const defs = { chess: { r_m: op('r_m', ['raidShip']), r_x: op('r_x', []) }, enemies: DUMMY };
  const h = makeBattle({
    defs, bonds: { raidShip: bond(1, 10) }, enemies: [{ key: 'enemy_addon_dummy', pos: [9, 8] }],
    units: [{ chessId: 'r_m', row: 12, col: 3 }, { chessId: 'r_x', row: 11, col: 3 }],
  });
  const u = h.unit('r_m');
  h.run(bb.no_attack_duration - 1);
  assert.deepEqual([u.tileR, u.tileC], [12, 3], 'still waiting');
  close(h.unit('r_x').s.aspd, 100, 'no milestone below 50 layers');
  h.run(1.5);
  const e = h.enemy('enemy_addon_dummy');
  assert.notDeepEqual([u.tileR, u.tileC], [12, 3], 'relocated');
  assert.ok(Math.max(Math.abs(u.tileR - 9), Math.abs(u.tileC - 8)) <= 2, 'next to the enemy');
  assert.ok(inRange(u, e), 'enemy in range after the jump');
  close(u.s.atk, 500 * (1 + bb.base_atk + bb.atk_per_stack * 10), 'ATK');
  close(u.s.maxHp, 2000 * (1 + bb.base_max_hp + bb.max_hp_per_stack * 10), 'HP');
  assert.deepEqual([h.unit('r_x').tileR, h.unit('r_x').tileC], [11, 3], 'non-member stays');
  checkInvariants(h.b);

  // skill ready → immediate; 50 layers → every operator ASPD +50
  const defs2 = { chess: { r_s: chessRec({ id: 'r_s', bonds: ['raidShip'], skill: { spCost: 10, initSp: 10 } }), r_x: op('r_x', []) }, enemies: DUMMY };
  const h2 = makeBattle({
    defs: defs2, bonds: { raidShip: bond(1, bb.power_bond_stack_cnt) }, enemies: [{ key: 'enemy_addon_dummy', pos: [9, 8] }],
    units: [{ chessId: 'r_s', row: 12, col: 3 }, { chessId: 'r_x', row: 11, col: 3 }],
  });
  h2.run(0.6);
  const s = h2.unit('r_s');
  assert.notDeepEqual([s.tileR, s.tileC], [12, 3], 'ready skill → relocated at once');
  close(h2.unit('r_x').s.aspd, 100 + bb.power_attack_speed, 'ASPD milestone');
  checkInvariants(h2.b);
});

test('突袭: the jump is a redeployment — deploy fires (部署时 effects), full HP, SP kept; knocked out there, it comes back there', () => {
  const bb = bondBb('raidShip');
  const defs = { chess: { r_m: chessRec({ id: 'r_m', bonds: ['raidShip'], skill: { spCost: 40, initSp: 0, duration: 10 } }) }, enemies: DUMMY };
  let spAtJump = null;
  const h = makeBattle({
    defs, bonds: { raidShip: bond(1, 0) }, enemies: [{ key: 'enemy_addon_dummy', pos: [9, 8] }], hooks: ['deploy', 'death'],
    units: [{ chessId: 'r_m', row: 12, col: 3 }],
    setup: (b) => b.on('death', (c) => { if (c.reason === 'raid') spAtJump = c.unit.skill.sp; }),
  });
  h.step(1);
  const u = h.unit('r_m');
  h.b.dealDamage(null, u, { amount: 500, type: 'true' });
  assert.ok(h.runUntil(() => u.tileR !== 12 || u.tileC !== 3, bb.no_attack_duration + 1), 'jumped');
  const sp = spAtJump;
  assert.ok(sp > 5 && sp < 40, `SP ${sp} accumulated`);
  const redeploys = h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial);
  assert.equal(redeploys.length, 1, 'a deploy event (部署时 traits, 突袭手雷, 卡西米尔 …)');
  assert.ok(h.hooksOf('death').some((c) => c.unit === u && c.reason === 'raid'), 'left the field as a retreat, not a knock-out');
  close(u.skill.sp, sp, `SP kept (${u.skill.sp} vs ${sp})`, 0.1);
  close(u.hp, u.s.maxHp, 'fresh deployment: full HP');
  close(u.s.maxHp, 2000 * (1 + bb.base_max_hp), 'raid HP bonus');
  assert.equal(h.result?.().perPlayer?.p1?.deaths ?? 0, 0, 'not counted as a death');
  // knocked out later: it lies on its landing tile and comes back there ("原地留下一个“倒地干员”…满足再部署条件时…
  // 自动部署至该位置", PRTS 卫戍协议/帮助 — player report F5 after 0.1.0), without the raid bonus; its home stays the
  // board tile
  const landed = [u.tileR, u.tileC];
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.deepEqual([u.tileR, u.tileC], landed, 'lies where it fell');
  h.b.redeploy(u);
  assert.deepEqual([u.tileR, u.tileC], landed, 'redeployed where it lay');
  assert.deepEqual([u.homeR, u.homeC], [12, 3], 'home tile unchanged');
  close(u.s.maxHp, 2000, 'bonus gone after leaving the field');
  checkInvariants(h.b);
});

// GitHub issue #51 (reported on 0.1.0, still so in 0.1.1): the 10 s idle jump landed where no enemy was in range and
// then hopped between such tiles every 10 s, and it ignored a second enemy it could have reached. Either trigger now jumps only to a landing tile
// with its target in range — the first candidate that has one — else the member stays and the next poll looks again
// [ASSUMED: the text says only "再部署至一名地面敌人周围"]. Row 9 here: cols 8–9 plain floor (not deployable); a
// RIGHT-facing melee member (its own tile + the tile in front) reaches a speed-0 enemy on (9,9) only from (9,9) or
// (9,8) — neither deployable.
const RAID51_STAGE = flatStage({ rows: { 9: '##Errrrrff' + 'S' + 'rrrrrrr' + 'S##' } });
const RAID51_ENEMY = { enemy_raid51: enemyRec({ key: 'enemy_raid51', hp: 1e7, speed: 0 }) };
const raidJumps = (h) => h.hooksOf('deploy').filter((c) => c.unit.kind === 'op' && !c.initial); // (an enemy spawn is a deploy too)

test('突袭 #51: no landing tile reaches the enemy → neither trigger jumps (no hopping); once one can, the jump comes at once', () => {
  const defs = {
    chess: { r_m: op('r_m', ['raidShip']), r_s: chessRec({ id: 'r_s', bonds: ['raidShip'], skill: { spCost: 10, initSp: 10 } }) },
    enemies: RAID51_ENEMY,
  };
  const h = makeBattle({
    stage: RAID51_STAGE, defs, bonds: { raidShip: bond(1, 10) }, enemies: [{ key: 'enemy_raid51', pos: [9, 9] }],
    units: [{ chessId: 'r_m', row: 12, col: 3 }, { chessId: 'r_s', row: 11, col: 3 }], hooks: ['deploy', 'death'],
    autoFinish: false, timeLimit: 120,
  });
  const m = h.unit('r_m'), s = h.unit('r_s');
  h.run(45);
  assert.equal(m.lastAttackAt, -Infinity, 'r_m idle the whole time (the 10 s trigger, four times over)');
  assert.ok(s.skill.ready, 'r_s: its skill stays ready the whole time (the 技能就绪 trigger)');
  assert.deepEqual(raidJumps(h), [], 'no jump: no landing tile has the enemy in range');
  assert.deepEqual(h.hooksOf('death').filter((c) => c.reason === 'raid'), [], 'no 突袭 retreat');
  assert.deepEqual([m.tileR, m.tileC, s.tileR, s.tileC], [12, 3, 11, 3], 'both stay where they are');
  // a ground enemy that can be reached: both jump at the next poll (the idle time kept counting) and land with it in range
  const t0 = h.b.time;
  const e2 = h.spawn('enemy_raid51', { pos: [12, 7] });
  h.run(0.3);
  assert.equal(raidJumps(h).length, 2, 'both members jumped');
  for (const c of raidJumps(h)) assert.ok(c.t - t0 <= 0.25 + 1e-6, `within one poll (${(c.t - t0).toFixed(2)} s)`);
  for (const u of [m, s]) {
    assert.ok(inRange(u, e2), `${u.defId}: the new enemy in range after the jump (${u.tileR},${u.tileC})`);
    assert.ok(Math.max(Math.abs(u.tileR - 12), Math.abs(u.tileC - 7)) <= 2, `${u.defId}: next to it`);
  }
  checkInvariants(h.b);
});

test('突袭 #51: the most advanced enemy out of reach → the jump goes to the next one it can reach and fights there; idle time restarts', () => {
  const defs = { chess: { r_m: op('r_m', ['raidShip']) }, enemies: RAID51_ENEMY };
  const idle = bondBb('raidShip').no_attack_duration;
  const h = makeBattle({
    stage: RAID51_STAGE, defs, bonds: { raidShip: bond(1, 10) }, hooks: ['deploy', 'death'], autoFinish: false, timeLimit: 120,
    enemies: [{ key: 'enemy_raid51', pos: [9, 9] }, { key: 'enemy_raid51', pos: [12, 9] }], units: [{ chessId: 'r_m', row: 12, col: 3 }],
  });
  h.step();
  const [e1, e2] = h.enemies();
  assert.deepEqual([e1.y, e1.x, e2.y, e2.x], [9, 9, 12, 9]);
  assert.ok(h.b.remainingDistance(e1) < h.b.remainingDistance(e2), 'the one out of reach is the more advanced (first candidate)');
  const u = h.unit('r_m');
  assert.ok(h.runUntil(() => raidJumps(h).length > 0, idle + 1), 'jumped after the idle time');
  const t1 = h.b.time;
  assert.ok(inRange(u, e2) && !inRange(u, e1), `landed on ${u.tileR},${u.tileC} with the second enemy in range`);
  h.run(5);
  assert.ok(u.lastAttackAt > t1 && e2.hp < e2.s.maxHp, 'it attacks the enemy it jumped to');
  assert.equal(raidJumps(h).length, 1, 'busy there: no further jump');
  // its enemy gone, a reachable one elsewhere: the next jump comes the idle time after its last attack, not at once
  h.b.dealDamage(null, e2, { amount: 1e9, type: 'true' });
  const last = u.lastAttackAt;
  const e3 = h.spawn('enemy_raid51', { pos: [10, 5] });
  assert.ok(!inRange(u, e3));
  assert.ok(h.runUntil(() => raidJumps(h).length === 2, idle + 1), 'jumped again');
  const dt = h.b.time - last;
  assert.ok(dt >= idle - 1e-6 && dt <= idle + 0.25 + 1e-6, `${dt.toFixed(2)} s after its last attack`);
  assert.ok(inRange(u, e3), 'the new enemy in range');
  checkInvariants(h.b);
});

test('不屈: knocked-out 地面干员 (melee position) redeploys (p=1 at high L); tier 2 every operator +5 SP; inactive / ranged → no', () => {
  const bb = bondBb('indomShip');
  const sk = { spCost: 50, initSp: 0 };
  const defs = { chess: { i_g: op('i_g', ['indomShip']), i_o: chessRec({ id: 'i_o', bonds: [], skill: sk }) } };
  const units = [{ chessId: 'i_g', row: 10, col: 4 }, { chessId: 'i_o', row: 12, col: 6 }];
  const h = makeBattle({ defs, units, bonds: { indomShip: bond(2, 300, 3) } });
  h.step(2);
  const g = h.unit('i_g'), o = h.unit('i_o');
  assert.equal(g.ground, true);
  const sp0 = o.skill.sp;
  h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
  assert.ok(g.alive && g.deployed, 'redeployed immediately');
  assert.deepEqual([g.tileR, g.tileC], [10, 4]);
  close(o.skill.sp - sp0, bb.sp, 'tier 2 SP');
  checkInvariants(h.b);

  const off = makeBattle({ defs, units, bonds: { indomShip: bond(0, 300) } });
  off.step(2);
  off.b.dealDamage(null, off.unit('i_g'), { amount: 1e9, type: 'true' });
  assert.equal(off.unit('i_g').alive, false, 'inactive');

  const t1 = makeBattle({ defs, units, bonds: { indomShip: bond(1, 300) } });
  t1.step(2);
  const o1 = t1.unit('i_o'), s1 = o1.skill.sp;
  t1.b.dealDamage(null, t1.unit('i_g'), { amount: 1e9, type: 'true' });
  assert.ok(t1.unit('i_g').alive);
  close(o1.skill.sp, s1, 'tier 1: no SP');
  checkInvariants(t1.b);

  // 地面干员 = the melee position, whatever the tile: up on a 高台 it still counts; a ranged operator on a melee tile never
  const hi = makeBattle({ defs, units: [{ chessId: 'i_g', row: 10, col: 2 }], bonds: { indomShip: bond(1, 300) } });
  hi.step(2);
  const hg = hi.unit('i_g');
  assert.equal(hg.ground, false, 'elevated tile');
  hi.b.dealDamage(null, hg, { amount: 1e9, type: 'true' });
  assert.ok(hg.alive && hg.deployed, 'a melee operator on a 高台 is a 地面干员');
  const rd = { chess: { i_r: ranged('i_r', ['indomShip']), i_o: chessRec({ id: 'i_o', bonds: [], skill: sk }) } };
  const lo = makeBattle({ defs: rd, units: [{ chessId: 'i_r', row: 10, col: 4 }, { chessId: 'i_o', row: 12, col: 6 }], bonds: { indomShip: bond(2, 300, 3) } });
  lo.step(2);
  const lr = lo.unit('i_r'), lsp = lo.unit('i_o').skill.sp;
  assert.equal(lr.ground, true, 'a melee (ground) tile');
  lo.b.dealDamage(null, lr, { amount: 1e9, type: 'true' });
  assert.equal(lr.alive, false, 'a ranged operator on a melee tile is not a 地面干员');
  close(lo.unit('i_o').skill.sp, lsp, 'no tier 2 SP either');
});

test('协防干员: all operators take ×0.8 phys/arts; members deal ×1.2 (elite ×1.4)', () => {
  const bb = bondBb('emptyShip');
  const defs = { chess: { c_n: op('c_n', ['emptyShip']), c_e_b: op('c_e_b', ['emptyShip'], { golden: true }), c_x: op('c_x', []) } };
  const h = makeBattle({ defs, bonds: { emptyShip: bond(1) }, units: [{ chessId: 'c_n', row: 10, col: 3 }, { chessId: 'c_e_b', row: 11, col: 3 }, { chessId: 'c_x', row: 12, col: 3 }] });
  h.step();
  for (const id of ['c_n', 'c_e_b', 'c_x']) {
    close(h.unit(id).s.physTakenMul, 1 - bb.damage_resistance, `${id} phys`);
    close(h.unit(id).s.artsTakenMul, 1 - bb.damage_resistance, `${id} arts`);
  }
  close(h.unit('c_n').s.dmgDealtMul, bb.damage_scale_normal);
  close(h.unit('c_e_b').s.dmgDealtMul, bb.damage_scale_extra);
  close(h.unit('c_x').s.dmgDealtMul, 1);
  checkInvariants(h.b);
});

test('独行: the lone member ATK/HP ×1.6 and +15 SP on every deploy', () => {
  const bb = bondBb('soloShip');
  const defs = { chess: { o_m: chessRec({ id: 'o_m', bonds: ['soloShip'], skill: { spCost: 40, initSp: 0 } }), o_x: op('o_x', []) } };
  const h = makeBattle({ defs, bonds: { soloShip: bond(1, 0, 1) }, units: [{ chessId: 'o_m', row: 10, col: 3 }, { chessId: 'o_x', row: 12, col: 3 }] });
  h.step();
  const u = h.unit('o_m');
  close(u.s.atk, 500 * (1 + bb.atk));
  close(u.s.maxHp, 2000 * (1 + bb.max_hp));
  close(h.unit('o_x').s.atk, 500);
  assert.ok(u.skill.sp >= bb.sp && u.skill.sp < bb.sp + 0.5, `initial SP ${u.skill.sp}`);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(h.b.redeploy(u));
  close(u.skill.sp, bb.sp, 'SP again after the redeploy');
  checkInvariants(h.b);
});

test('绝技: 2 elites → elite ATK ×1.3; 5 elites → elite SP cost ×0.7 (floored); normal chess untouched', () => {
  const bb = bondBb('suntShip');
  const defs = { chess: {
    j_e_b: chessRec({ id: 'j_e_b', golden: true, skill: { spCost: 10 } }),
    j_n: chessRec({ id: 'j_n', skill: { spCost: 10 } }),
  } };
  const units = [{ chessId: 'j_e_b', row: 10, col: 3 }, { chessId: 'j_n', row: 12, col: 3 }];
  const h1 = makeBattle({ defs, units, bonds: { suntShip: bond(1, 0, 2) } });
  h1.step();
  close(h1.unit('j_e_b').s.atk, 500 * (1 + bb.power_atk));
  close(h1.unit('j_n').s.atk, 500);
  assert.equal(h1.unit('j_e_b').skill.spCost, 10, 'tier 1: SP cost unchanged');
  const h2 = makeBattle({ defs, units, bonds: { suntShip: bond(2, 0, 5) } });
  h2.step();
  assert.equal(h2.unit('j_e_b').skill.spCost, Math.floor(10 * bb.sp_ratio));
  assert.equal(h2.unit('j_n').skill.spCost, 10);
  checkInvariants(h2.b);
});

test('inactive add-on bonds do nothing', () => {
  const ids = ['preciShip', 'swiftShip', 'skillfulShip', 'arcaneShip', 'steadShip', 'deputShip', 'raidShip', 'indomShip', 'emptyShip', 'soloShip', 'suntShip'];
  const bonds = Object.fromEntries(ids.map((id) => [id, { count: 1, active: false, tier: 0, layers: 500 }]));
  const defs = { chess: { n_1_b: op('n_1_b', ids, { golden: true }), n_2: ranged('n_2', ids) } };
  const h = makeBattle({ defs, bonds, units: [{ chessId: 'n_1_b', row: 10, col: 3 }, { chessId: 'n_2', row: 10, col: 4 }] });
  h.step(3);
  for (const u of h.allies()) assert.ok(!hasBondBuff(u), `${u.defId} has no bond buff`);
  close(h.unit('n_1_b').s.atk, 500);
  checkInvariants(h.b);
});

test('two players on one field: bonds only buff their owner', () => {
  const defs = { chess: { w_1: op('w_1', ['steadShip']), w_2: op('w_2', []) } };
  const h = makeBattle({
    kind: 'boss', defs,
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: 'w_1', row: 10, col: 4 }], bonds: { steadShip: bond(1, 10), deputShip: bond(1, 0) } },
      { playerId: 'p2', seat: 1, side: 'R', colOffset: 0, units: [{ uid: 2, kind: 'chess', chessId: 'w_2', row: 10, col: 4 }], bonds: {} },
    ],
  });
  h.step(2);
  const a = h.b.allyUnits.find((u) => u.ownerId === 'p1'), b = h.b.allyUnits.find((u) => u.ownerId === 'p2');
  assert.ok(a.s.maxHp > 2000 && a.s.def > 200, 'owner buffed');
  close(b.s.maxHp, 2000, 'partner HP untouched');
  close(b.s.def, 200, 'partner DEF untouched');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// prep side

function addonRegistry() {
  const reg = createRegistry({ content: false });
  registerMeta(reg);
  return reg;
}
function metaMatch(reg, seed = 90) {
  const h = makeMatch({ mode: 'solo', seed, registry: reg, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.funds = 50;
  ps.layers = {};
  ps.recompute();
  return { h, m: h.m, ps };
}
const onBoard = (m, ps, id) => give(m, ps, id, 'board', legalTileFor(m, ps, id));

test('registry: the add-on meta handlers are registered by the real content', () => {
  const reg = createRegistry();
  for (const id of ['deputShip', 'visiShip', 'miraShip', 'victoriaShip']) assert.ok(reg.has(`bond:${id}`), id);
  assert.ok(reg.has('global:bondaddon_prepend'), 'prep-end marker for pending payouts');
  assert.equal(reg.warnings.filter((w) => w.startsWith('bond:') || w.startsWith('global:bondaddon')).length, 0, 'no misspelt hooks');
});

test('助力 meta: prep end → every active bond +2, +4 with 3 助力 (distinct name or elite state)', () => {
  const { h, m, ps } = metaMatch(addonRegistry());
  onBoard(m, ps, 'chess_char_1_13_a'); // 波登可 助力
  onBoard(m, ps, 'chess_char_6_14_a'); // 流明 助力
  onBoard(m, ps, 'chess_char_1_09_a'); // 跃跃 精准
  onBoard(m, ps, 'chess_char_4_06_a'); // 寒芒克洛丝 精准
  give(m, ps, 'chess_char_4_21_a', 'hand'); // 白面鸮 in the hand: 灵巧 inactive
  assert.equal(ps.bonds.deputShip.tier, 1);
  m.dispatch(ps, 'onPrepEnd', { round: m.round });
  assert.equal(ps.layers.deputShip, 2);
  assert.equal(ps.layers.preciShip, 2);
  assert.ok(!ps.layers.skillfulShip, 'inactive bond unchanged');
  onBoard(m, ps, 'chess_char_1_13_b'); // elite 波登可: 3rd 助力 by elite state
  assert.equal(ps.bonds.deputShip.tier, 2);
  m.dispatch(ps, 'onPrepEnd', { round: m.round });
  assert.equal(ps.layers.deputShip, 6);
  assert.equal(ps.layers.preciShip, 6);
  h.invariants();
  m.dispose();
});

test('远见 meta: +2 funds per 10 layers, 80 → 远见 chess −1, 150 → every chess −1; catch-up once active', () => {
  const { h, m, ps } = metaMatch(addonRegistry());
  give(m, ps, 'chess_char_2_02_a', 'hand'); // 赫默
  give(m, ps, 'chess_char_5_21_a', 'hand'); // 寒檀 (BOARD_AND_DECK)
  assert.ok(ps.bonds.visiShip.active);
  const f0 = ps.funds;
  ps.addLayers('visiShip', 25);
  assert.equal(ps.funds, f0 + 4);
  const visi = { kind: 'chess', id: 'chess_char_4_04_a', basePrice: 3 };
  const other = { kind: 'chess', id: 'chess_char_1_09_a', basePrice: 3 };
  assert.equal(ps.priceOf(visi), 3);
  ps.addLayers('visiShip', 55);
  assert.equal(ps.funds, f0 + 16);
  assert.equal(ps.priceOf(visi), 2, '远见 discount at 80');
  assert.equal(ps.priceOf(other), 3);
  ps.addLayers('visiShip', 70);
  assert.equal(ps.priceOf(other), 2, 'every chess at 150');
  assert.equal(ps.priceOf(visi), 2, 'replaces, does not stack');
  assert.equal(ps.priceOf({ kind: 'chess', id: 'chess_char_1_09_a', basePrice: 0 }), 0, 'never below 0');
  h.invariants();
  m.dispose();

  const b = metaMatch(addonRegistry(), 91);
  give(b.m, b.ps, 'chess_char_2_02_a', 'hand');
  const g0 = b.ps.funds;
  b.ps.addLayers('visiShip', 30);
  assert.equal(b.ps.funds, g0, 'inactive: no payout');
  give(b.m, b.ps, 'chess_char_5_21_a', 'hand');
  b.m.dispatch(b.ps, 'onRoundStart', { round: b.m.round });
  assert.equal(b.ps.funds, g0 + 6, 'caught up once active');
  b.m.dispatch(b.ps, 'onPrepEnd', { round: b.m.round });
  assert.equal(b.ps.funds, g0 + 6, 'paid once');
  b.m.dispose();
});

test('远见 meta: a milestone crossed after the prep phase ended (助力 +2 at prep end) is paid as pending funds, not wiped', () => {
  const { h, m, ps } = metaMatch(addonRegistry(), 93);
  onBoard(m, ps, 'chess_char_1_13_a'); // 波登可 助力
  onBoard(m, ps, 'chess_char_6_14_a'); // 流明 助力
  give(m, ps, 'chess_char_2_02_a', 'hand'); // 赫默 远见
  give(m, ps, 'chess_char_5_21_a', 'hand'); // 寒檀 远见 (BOARD_AND_DECK)
  assert.ok(ps.bonds.deputShip.active && ps.bonds.visiShip.active);
  ps.layers.visiShip = 8;
  ps.recompute();
  const f0 = ps.funds, p0 = ps.pendingFunds;
  m.dispatch(ps, 'onPrepEnd', { round: m.round });
  assert.equal(ps.layers.visiShip, 10, '助力 +2');
  assert.equal(ps.funds, f0, 'not paid into funds that are wiped right after');
  assert.equal(ps.pendingFunds, p0 + 2, 'credited at the next round start');
  h.invariants();
  m.dispose();
});

test('远见 meta: 「购买价格永久-1资金」 has no floor but 0 — a price of 1 becomes 0 (owner\'s decision 2026-10-04)', () => {
  const { m, ps } = metaMatch(addonRegistry(), 94);
  ps.counters['bondaddon:visi:disc'] = 2;                 // 150 layers reached: every chess −1
  const at = (basePrice) => ps.priceOf({ kind: 'chess', id: 'chess_char_1_09_a', basePrice });
  assert.equal(at(3), 2);
  assert.equal(at(2), 1);
  assert.equal(at(1), 0, 'a price of 1 (至简 / 休露丝) becomes 0');
  assert.equal(at(0), 0, 'never negative');
  ps.counters['bondaddon:visi:disc'] = 1;                 // 80: 远见 chess only
  assert.equal(ps.priceOf({ kind: 'chess', id: 'chess_char_2_02_a', basePrice: 2 }), 1);
  assert.equal(ps.priceOf({ kind: 'chess', id: 'chess_char_2_02_a', basePrice: 1 }), 0, '80: a 远见 operator at 1 → 0 too');
  assert.equal(at(2), 2, 'non-远见 chess unchanged at 80');
  assert.equal(at(1), 1);
  m.dispose();
});

test('独行 / 绝技 (match side): 独行 active with exactly 1 distinct member (copies ok); 绝技 counts every elite on board', () => {
  const { m, ps } = metaMatch(addonRegistry(), 95);
  onBoard(m, ps, 'chess_char_1_08_a'); // 德克萨斯 独行
  assert.equal(ps.bonds.soloShip.active, true);
  onBoard(m, ps, 'chess_char_1_08_b'); // its elite copy: still one distinct 独行
  assert.equal(ps.bonds.soloShip.count, 1);
  assert.equal(ps.bonds.soloShip.active, true);
  onBoard(m, ps, 'chess_char_2_17_a'); // 折桠: a second distinct 独行 breaks it
  assert.equal(ps.bonds.soloShip.active, false);
  // 绝技: elites on board, duplicates included → 1 (德克萨斯_b) + …
  assert.equal(ps.bonds.suntShip.count, 1);
  assert.equal(ps.bonds.suntShip.active, false);
  onBoard(m, ps, 'chess_char_1_08_b');
  assert.equal(ps.bonds.suntShip.count, 2, 'duplicate elites each count');
  assert.equal(ps.bonds.suntShip.tier, 1);
  onBoard(m, ps, 'chess_char_1_09_b');
  onBoard(m, ps, 'chess_char_1_13_b');
  assert.equal(ps.bonds.suntShip.tier, 1);
  onBoard(m, ps, 'chess_char_2_02_b');
  assert.equal(ps.bonds.suntShip.count, 5);
  assert.equal(ps.bonds.suntShip.tier, 2);
  m.dispose();
});

test('奇迹 meta: refresh → next refresh free (p=1 at 300 layers), +20 funds per 100 layers; inactive → never', () => {
  const { h, m, ps } = metaMatch(addonRegistry());
  give(m, ps, 'chess_char_2_11_a', 'hand'); // 风丸
  give(m, ps, 'chess_char_3_01_a', 'hand'); // 能天使
  const f0 = ps.funds;
  ps.addLayers('miraShip', 300);
  assert.equal(ps.funds, f0 + 60, '3 × 20 funds');
  const f1 = ps.funds;
  assert.equal(ps.shop.freeRefreshes, 0);
  assert.equal(m.handle('p_0', { t: 'g.refresh' }).ok, true);
  assert.equal(ps.funds, f1 - m.gd.refreshPrice);
  assert.equal(ps.shop.freeRefreshes, 1);
  m.handle('p_0', { t: 'g.refresh' });
  assert.equal(ps.funds, f1 - m.gd.refreshPrice, 'free refresh');
  assert.equal(ps.shop.freeRefreshes, 1, 'rolled again after the free one');
  h.invariants();
  m.dispose();

  const b = metaMatch(addonRegistry(), 92);
  give(b.m, b.ps, 'chess_char_2_11_a', 'hand');
  b.ps.layers.miraShip = 1000;
  b.ps.recompute();
  for (let i = 0; i < 3; i++) b.m.handle('p_0', { t: 'g.refresh' });
  assert.equal(b.ps.shop.freeRefreshes, 0, 'inactive');
  b.m.dispose();
});

test('投资人 meta: 获得时 garrisons run ×2 while active, ×3 at ≥100 layers (dispatcher)', () => {
  const reg = createRegistry({ content: false });
  let calls = 0;
  reg.garrison('SERVER_ADD_BOND_CHESS_ALL', { run: () => { calls++; } }); // 深靛 <获得时>
  const { m, ps } = metaMatch(reg);
  give(m, ps, 'chess_char_2_19_a', 'hand'); // 锡人
  give(m, ps, 'chess_char_3_04_a', 'hand'); // 琳琅诗怀雅
  ps.acquireChess('chess_char_1_17_a', { source: 'test' });
  assert.equal(calls, 1, 'inactive: once');
  give(m, ps, 'chess_char_5_17_a', 'hand'); // 山 → 3 投资人
  assert.ok(ps.bonds.investShip.active);
  calls = 0;
  ps.acquireChess('chess_char_1_17_a', { source: 'test' });
  assert.equal(calls, 2);
  ps.layers.investShip = 100;
  ps.recompute();
  calls = 0;
  ps.acquireChess('chess_char_1_03_a', { source: 'test' }); // 惊蛰: no 获得时 trait
  assert.equal(calls, 0);
  const g = give(m, ps, 'chess_char_1_17_a', 'temp');
  m.dispatch(ps, 'onGain', { piece: g, kind: 'chess', source: 'test' });
  assert.equal(calls, 3, '×3 at 100 layers');
  m.dispose();
});

test('调和 (match side): +1 to core bonds that already have a real member', () => {
  const { m, ps } = metaMatch(addonRegistry());
  onBoard(m, ps, 'chess_char_6_11_a'); // 缪尔赛思 调和
  assert.ok(ps.bonds.maniShip.active);
  assert.ok(!ps.bonds.yanShip || ps.bonds.yanShip.count === 0, 'no real 炎 → no +1');
  onBoard(m, ps, 'chess_char_1_03_a'); // 惊蛰 炎
  assert.equal(ps.bonds.yanShip.count, 2);
  assert.equal(ps.bonds.yanShip.active, false);
  onBoard(m, ps, 'chess_char_4_17_a'); // 星熊 炎
  assert.equal(ps.bonds.yanShip.count, 3);
  assert.equal(ps.bonds.yanShip.active, true, '1 调和 + 2 炎 activates 炎');
  m.dispose();
});
