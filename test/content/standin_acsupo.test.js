// test/content/standin_acsupo.test.js — the 补位 stand-in Raidian (char_614_acsupo, kits/ops/standin-acsupo.js) on every
// chess it replaces (灵知 T4 S2, 夕 / 安洁莉娜 T5 S3 + DEC-X, 浊心斯卡蒂 / 仇白 T6 S3 + DEC-X), normal and elite: every skill
// (S1 双声, S2 三形, S3 信号跃动 with its range, auras and the data's ACTIVE_RANGE trigger), both talents (同调 on herself and
// the operators next to her, 诱引's hit-rate cut on the attacks of the enemies in her range — PRTS 命中率), the module
// (DEC-X SP, stats, 同调 at level 3), the 停顿 trait, anti-air; and the engine option behind S3's 虚弱 (applyStatus stackAs).
// Run: node --test test/content/standin_acsupo.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitForm } from '../../shared/standIn.js';
import { COLS } from '../../server/sim/constants.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const RAID = 'char_614_acsupo';
const [S1, S2, S3] = ['skchr_acsupo_1', 'skchr_acsupo_2', 'skchr_acsupo_3'];
const RECORDS = BACKUPS.units[RAID].standsIn.flatMap((a) => [a, a.replace(/_a$/, '_b')]);
const ENEMIES = {
  d: enemyRec({ key: 'd', hp: 1e7, speed: 0 }),
  brute: enemyRec({ key: 'brute', hp: 1e7, atk: 200, bat: 1, speed: 1 }),
  holy: enemyRec({ key: 'holy', hp: 1e7, atk: 200, bat: 1, speed: 1, dmgType: 'true' }),
  archer: enemyRec({ key: 'archer', hp: 1e7, atk: 200, bat: 1, speed: 0, range: 2.5 }),
};
/** A plain blocker without a kit (no randomness of its own). */
const TANK = chessRec({ id: 't_tank', profession: 'TANK', subProfessionId: 'protector', stats: { maxHp: 1e6, def: 0, atk: 1, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const formOf = (id) => unitForm(BACKUPS, RAID, CHESS[id].status);
const skillOf = (id, sid) => formOf(id).skills.find((s) => s.skillId === sid);
const moduleOf = (id) => {
  const c = CHESS[id];
  return c.status.equipLevel > 0 && c.backup.uniEquipId ? formOf(id).modules.find((m) => m.uniEquipId === c.backup.uniEquipId) : null;
};
const key = (r, c) => r * COLS + c;

/** Raidian at (10,4) facing right (y-2: rows 9–11, cols 3–6; S3's y-4 adds (10,7) and rows 8 / 12); extra `units`. */
function arena(chessId, { standIn = true, enemies = [], units = [], sp = 999, seed = 7, timeLimit = 200, setup = null } = {}) {
  return makeBattle({
    defs: { enemies: ENEMIES, chess: { t_tank: TANK } }, seed, timeLimit, autoFinish: false, setup,
    units: [{ chessId, row: 10, col: 4, dir: 'RIGHT', standIn, ...(sp != null ? { carryState: { sp } } : {}) }, ...units],
    enemies, hooks: ['skillStart', 'skillEnd', 'damaged', 'attack', 'statusApplied'], captureNoisy: true,
  });
}
const done = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []); checkInvariants(h.b); };
const castOf = (h, u) => h.hooksOf('skillStart').find((c) => c.unit === u);

test('Raidian on every chess it replaces: the stand-in body, its kit, the backup skill (S2 for 灵知, S3 else), DEC-X on the T5 / T6 elites; arts + 停顿 0.8 s, anti-air', () => {
  assert.equal(RECORDS.length, 10);
  for (const id of RECORDS) {
    const c = CHESS[id];
    const form = formOf(id), mod = moduleOf(id);
    const sk = form.skills.find((s) => s.index === c.backup.skillIndex);
    const h = arena(id, { sp: null });
    h.step();
    const u = h.unit(1);
    const where = `${id} ${c.name}`;
    assert.deepEqual([u.def.charId, u.def.standInFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [RAID, c.charId, sk.skillId, false, 'skills'], where);
    assert.equal(sk.skillId, c.tier === 4 ? S2 : S3, where);
    assert.equal(!!u.def.raw.module?.active, !!mod, `${where}: module only on the T5 / T6 elite`);
    if (mod) assert.equal(u.def.raw.module.level, c.tier === 6 ? 3 : 1, where);
    assert.equal(u.base.atk, form.stats.atk + (mod ? mod.attr.atk : 0), `${where}: ATK`);
    assert.equal(u.base.maxHp, form.stats.maxHp + (mod ? mod.attr.maxHp : 0), `${where}: HP`);
    assert.deepEqual([u.profile.dmgType, u.profile.canHitFly, u.profile.onHitStatus], ['arts', true, { key: 'sluggish', duration: 0.8 }], `${where}: profile`);
    assert.equal(u.rangeKeys.length, 12, `${where}: y-2`);
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb;
    assert.deepEqual([t0.attack_speed, t0['acsupo_t_1[ally].attack_speed']], mod && mod.level === 3 ? [20, 12] : [15, 10], `${where}: 同调`);
    assert.equal(u.s.aspd, 100 + t0.attack_speed, `${where}: her ASPD`);
    done(h);
  }
});

test('Raidian triggers: S1 / S2 MANUAL DEFAULT; S3 the data\'s ACTIVE_RANGE over its y-4 (the owner\'s rule), the kit sets none', () => {
  for (const id of ['chess_char_4_13_a', 'chess_char_5_12_b']) {
    for (const [i, sid] of [[0, S1], [1, S2], [2, S3]]) {
      const h = arena(id, { standIn: { skillIndex: i }, sp: null });
      h.step();
      const u = h.unit(1);
      const rule = sid === S3 ? 'ACTIVE_RANGE' : 'DEFAULT';
      assert.deepEqual([u.skill.id, u.skill.rule, u.def.skill.trigger.rule, u.kit.skill.trigger], [sid, rule, rule, undefined], `${id} ${sid}`);
      if (sid === S3) assert.deepEqual(u.def.skill.trigger.grid, skillOf(id, S3).rangeGrid, 'trigger grid = the skill range');
      done(h);
    }
  }
});

test('S3 ACTIVE_RANGE: an enemy only in its y-4 range ((10,7)) casts it at once, before any attack; none there, or one beyond it, no cast', () => {
  for (const id of ['chess_char_5_12_a', 'chess_char_6_15_b']) {
    const h = arena(id, { enemies: [{ key: 'd', pos: [10, 7] }] });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.active, 2), `${id}: cast`);
    assert.equal(castOf(h, u).reason, 'ACTIVE_RANGE');
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t < castOf(h, u).t).length, 0, 'no attack before (it is out of y-2)');
    assert.ok(u.rangeKeySet.has(key(10, 7)), 'then in her running range');
    h.run(3);
    assert.ok(h.hooksOf('attack').some((c) => c.attacker === u), 'and she attacks it');
    done(h);
    for (const enemies of [[], [{ key: 'd', pos: [10, 8] }]]) {
      const g = arena(id, { enemies });
      g.run(5);
      assert.equal(g.unit(1).skill.activations, 0, `${id}: no cast with ${JSON.stringify(enemies)}`);
      done(g);
    }
  }
});

test('S1 双声: ATK +25 / +40 %, one extra target, 24 s', () => {
  for (const id of ['chess_char_4_13_a', 'chess_char_5_20_b']) {
    const sk = skillOf(id, S1);
    const h = arena(id, { standIn: { skillIndex: 0 }, enemies: [{ key: 'd', pos: [10, 5] }, { key: 'd', pos: [10, 6] }, { key: 'd', pos: [9, 6] }] });
    const u = h.unit(1);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    const start = castOf(h, u).t;
    close(u.s.atk, u.base.atk * (1 + sk.bb.atk), `${id}: ATK`);
    h.run(6);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.t >= start);
    assert.ok(atks.length >= 3 && atks.every((c) => c.targets.length === 2), `${id}: 2 targets`);
    assert.ok(h.runUntil(() => !u.skill.active, 30));
    close(h.b.time - start, sk.duration, `${id}: ${sk.duration} s`, 0.05);
    done(h);
  }
});

test('S2 三形: base attack time 1.9 → 1.8 / 1.7 s, 3 targets, 停顿 1.1 / 1.2 s (0.8 s before), 14 / 17 s', () => {
  for (const id of ['chess_char_4_13_a', 'chess_char_4_13_b']) {
    const sk = skillOf(id, S2);
    const h = arena(id, { sp: null, enemies: [[10, 5], [10, 6], [9, 6], [11, 6]].map((pos) => ({ key: 'd', pos })) });
    const u = h.unit(1);
    h.run(2);
    const slow = (t0, t1) => h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish' && c.t >= t0 && c.t < t1).map((c) => c.duration);
    assert.ok(slow(0, 2).length > 0 && slow(0, 2).every((d) => d === 0.8), 'the trait: 0.8 s');
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    const start = castOf(h, u).t;
    close(u.s.interval * u.s.aspd / 100, 1.9 + sk.bb.base_attack_time, `${id}: base attack time`);
    h.run(5);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.t >= start);
    assert.ok(atks.length >= 3 && atks.every((c) => c.targets.length === 3), `${id}: 3 targets`);
    const during = slow(start, h.b.time);
    assert.ok(during.length >= 9 && during.every((d) => d === sk.bb['attack@sluggish']), `${id}: 停顿 ${sk.bb['attack@sluggish']} s`);
    assert.ok(h.runUntil(() => !u.skill.active, 30));
    close(h.b.time - start, sk.duration, `${id}: ${sk.duration} s`, 0.05);
    close(u.s.interval * u.s.aspd / 100, 1.9, 'back to 1.9 s');
    done(h);
  }
});

test('S3 信号跃动: y-4 while it runs, ATK +40 / +50 %, 同调 ×2 / ×2.5, enemies in range 脆弱 + 虚弱 10 / 20 % (the 虚弱 stacking as 90 / 80 %), 30 / 35 s', () => {
  for (const id of ['chess_char_5_12_a', 'chess_char_6_04_b']) {
    const sk = skillOf(id, S3), elite = id.endsWith('_b');
    const t0 = formOf(id).talents.find((t) => t.index === 0).bb;
    const self = elite ? 20 : t0.attack_speed, ally = elite ? 12 : t0['acsupo_t_1[ally].attack_speed'];
    const h = arena(id, { enemies: [{ key: 'd', pos: [10, 6] }, { key: 'd', pos: [10, 9] }], units: [{ chessId: 't_tank', row: 11, col: 4 }] });
    const [u, tank] = [h.unit(1), h.unit(2)];
    h.step();
    const [inR, outR] = [...h.b.enemies].sort((a, b) => a.x - b.x);
    h.b.applyStatus(inR, 'weaken', { value: 0.3, duration: 100 });   // a stronger 虚弱 of another source
    assert.ok(h.runUntil(() => u.skill.active, 2), `${id}: cast`);
    const start = castOf(h, u).t;
    h.run(0.5);
    assert.equal(u.rangeKeys.length, 19, `${id}: y-4`);
    close(u.s.atk, u.base.atk * (1 + sk.bb['acsupo_s_3.atk']), `${id}: ATK`);
    close(u.s.aspd, 100 + self * sk.bb.talent_scale, `${id}: her ASPD`);
    close(tank.findBuff('acsupo:t1')?.mods?.aspd ?? 0, ally * sk.bb.talent_scale, `${id}: the neighbour's ASPD`);
    const fr = inR.findBuff('fragile'), wk = inR.findBuff('weaken');
    close(fr?.data?.value ?? 0, sk.bb.damage_scale - 1, `${id}: 脆弱`);
    close(inR.s.dmgTakenMul, sk.bb.damage_scale, `${id}: damage taken`);
    assert.deepEqual([wk?.data?.value, wk?.data?.stackAs].map((v) => Math.round(v * 1e6) / 1e6), [Math.round((1 - sk.bb.atk) * 1e6) / 1e6, sk.bb.atk], `${id}: 虚弱 ${1 - sk.bb.atk}, stacking as ${sk.bb.atk}`);
    close(inR.s.atk, inR.base.atk * sk.bb.atk, `${id}: its 虚弱 outranks the 30 % one (PRTS 备注)`);
    assert.deepEqual([outR.findBuff('fragile') ?? null, outR.findBuff('weaken') ?? null], [null, null], `${id}: nothing out of her range`);
    assert.ok(h.runUntil(() => !u.skill.active, 40));
    close(h.b.time - start, sk.duration, `${id}: ${sk.duration} s`, 0.05);
    h.run(0.5);
    assert.deepEqual([u.rangeKeys.length, u.s.aspd, tank.findBuff('acsupo:t1')?.mods?.aspd], [12, 100 + self, ally], `${id}: back`);
    assert.equal(inR.findBuff('fragile') ?? null, null, `${id}: 脆弱 gone`);
    close(inR.findBuff('weaken')?.data?.value ?? 0, 0.3, `${id}: the 30 % 虚弱 resumes`);
    done(h);
  }
});

test('同调: ASPD +15 / +20 on herself, +10 / +12 on the operators of the 4 tiles next to her — not diagonal, not farther', () => {
  for (const [id, v] of [['chess_char_5_12_a', 10], ['chess_char_6_15_b', 12]]) {
    const h = arena(id, { sp: null, units: [
      { chessId: 't_tank', row: 11, col: 4 },              // adjacent
      { chessId: 'chess_char_1_03_a', row: 9, col: 5 },    // diagonal
      { chessId: 'chess_char_1_17_a', row: 10, col: 2 },   // two tiles away
    ] });
    h.run(1);
    const [adj, diag, far] = [2, 3, 4].map((uid) => h.unit(uid));
    const buff = (x) => x.findBuff('acsupo:t1')?.mods?.aspd ?? 0;
    assert.deepEqual([buff(adj), buff(diag), buff(far), buff(h.unit(1))], [v, 0, 0, 0], id);
    done(h);
  }
});

/** A blocked brute (atk 200, 1 attack/s) on t_tank at `tile`; `rng0`: every direct battle.rng() draw returns that value. */
function lureField(id, { tile = [10, 5], enemy = 'brute', rng0 = null, standIn = true } = {}) {
  const h = arena(id, { sp: null, standIn, enemies: [{ key: enemy, pos: tile }], units: [{ chessId: 't_tank', row: tile[0], col: tile[1] }] });
  if (rng0 != null) { const real = h.b.rng; h.b.rng = Object.assign(() => rng0, real); }
  const seen = [];
  h.b.on('hit', (c) => { if (c.source && c.source.side === 'enemy') seen.push(c.dmg.attackId); });   // a later hit handler
  return { h, u: h.unit(1), tank: h.unit(2), seen };
}

test('诱引: an enemy attacking inside her range misses as a whole on a failed roll (no damage, no later hit handler), the attack still spent; outside her range, or true damage, never', () => {
  for (const id of ['chess_char_4_13_a', 'chess_char_6_04_b']) {
    const miss = lureField(id, { rng0: 0 });
    miss.h.run(8);
    const e = miss.h.b.enemies[0];
    assert.ok(e.blockedBy === miss.tank && e.stats.attacks >= 6, `${id}: it attacks every second (${e.stats.attacks})`);
    assert.equal(miss.tank.stats.taken, 0, `${id}: every attack missed`);
    assert.equal(miss.seen.length, 0, 'no later hit handler saw them');
    assert.ok(miss.h.eventsOf('fx').filter((f) => f[1] === 'dodge' && f[4].id === miss.tank.id).length >= 6, 'a miss shows on the target');
    done(miss.h);
    const land = lureField(id, { rng0: 0.99 });
    land.h.run(8);
    close(land.tank.stats.taken, land.h.b.enemies[0].stats.attacks * 200, `${id}: a passed roll lands`, 1e-6);
    done(land.h);
  }
  // out of her range ((10,8)): no roll — even a draw of 0 lands
  const out = lureField('chess_char_5_12_a', { tile: [10, 8], rng0: 0 });
  out.h.run(5);
  assert.ok(out.tank.stats.taken > 0, 'outside her range: no cut');
  done(out.h);
  // true damage has no 物理 / 法术 hit rate
  const holy = lureField('chess_char_5_12_a', { enemy: 'holy', rng0: 0 });
  holy.h.run(5);
  assert.ok(holy.tank.stats.taken > 0, 'true damage: never misses');
  done(holy.h);
  // the real roll: about one attack in ten (seeded)
  const real = lureField('chess_char_4_13_a', {});
  real.h.run(150);
  const n = real.h.b.enemies[0].stats.attacks, landed = Math.round(real.tank.stats.taken / 200);
  assert.ok(n >= 140, `${n} attacks`);
  assert.ok(n - landed >= 4 && n - landed <= 30, `${n - landed} of ${n} attacks missed (10 %)`);
  done(real.h);
});

test('诱引: one roll per attack — every damage instance of a two-target attack shares it', () => {
  const h = arena('chess_char_5_12_a', {
    sp: null, enemies: [{ key: 'archer', pos: [10, 6] }],
    units: [{ chessId: 't_tank', row: 10, col: 5 }, { chessId: 't_tank', row: 11, col: 5 }],
    setup: (b) => b.on('enemySpawn', ({ enemy }) => { enemy.profile.maxTargets = 2; }),
  });
  const landed = new Map();
  h.b.on('damaged', (c) => { if (c.source && c.source.side === 'enemy') landed.set(c.dmg.attackId, (landed.get(c.dmg.attackId) ?? 0) + 1); });
  h.run(120);
  h.b.applyStatus(h.b.enemies[0], 'disarm', { duration: 100, force: true });   // no new attack; the arrows in flight land
  h.run(2);
  const atks = h.hooksOf('attack').filter((c) => c.attacker.side === 'enemy');
  assert.ok(atks.length >= 100 && atks.every((c) => c.targets.length === 2), `${atks.length} two-target attacks`);
  const counts = [...landed.values()];
  assert.ok(counts.every((k) => k === 2), 'a landed attack lands on both targets');
  const missed = atks.length - landed.size;
  assert.ok(missed >= 3 && missed <= 25, `${missed} of ${atks.length} attacks missed whole`);
  done(h);
});

test('DEC-X (T5 / T6 elite): +0.2 SP/s while an enemy is in her range; none without one, nor on the normal form', () => {
  for (const [id, enemy, rate] of [['chess_char_5_12_b', true, 1.2], ['chess_char_5_12_b', false, 1], ['chess_char_5_12_a', true, 1], ['chess_char_6_15_b', true, 1.2]]) {
    const h = arena(id, { sp: null, enemies: enemy ? [{ key: 'd', pos: [10, 6] }] : [] });
    const u = h.unit(1);
    h.step();
    const t0 = h.b.time, sp0 = u.skill.sp;
    h.run(10);
    assert.equal(u.skill.activations, 0);
    close((u.skill.sp - sp0) / (h.b.time - t0), rate, `${id} ${enemy ? 'enemy in range' : 'no enemy'}`, 0.01);
    done(h);
  }
});

test('engine: applyStatus stackAs — a 同名效果取最高 status competing with another strength than its effect; tails keep it; without it nothing changes', () => {
  const h = makeBattle({ defs: { enemies: ENEMIES }, enemies: [{ key: 'd', pos: [10, 6] }], autoFinish: false, timeLimit: 60 });
  h.step();
  const e = h.b.enemies[0], b = h.b;
  const now = () => e.findBuff('weaken');
  b.applyStatus(e, 'weaken', { value: 0.3, duration: 10 });
  assert.deepEqual(now().data, { value: 0.3, tail: null }, 'the plain data shape');
  b.applyStatus(e, 'weaken', { value: 0.1, stackAs: 0.9, duration: 2 });
  assert.deepEqual([now().data.value, now().data.stackAs, now().mods.atkMul, now().data.tail.value, now().data.tail.stackAs], [0.1, 0.9, 0.9, 0.3, undefined], 'it outranks the 30 % (its effect stays 10 %); the 30 % waits as the tail');
  b.applyStatus(e, 'weaken', { value: 0.5, duration: 1 });
  assert.equal(now().data.value, 0.1, 'a 50 % one does not outrank 90 %');
  h.run(2.1);
  assert.deepEqual([now().data.value, now().data.stackAs], [0.3, undefined], 'the 30 % resumes after it');
  h.run(8);
  assert.equal(now() ?? null, null, 'all over');
  b.applyStatus(e, 'weaken', { value: 0.05, stackAs: 0.8, duration: 20 });
  assert.deepEqual(now().data, { value: 0.05, stackAs: 0.8, tail: null });
  b.applyStatus(e, 'weaken', { value: 0.2, stackAs: 0.95, duration: 1 });
  assert.deepEqual([now().data.value, now().data.tail.value, now().data.tail.stackAs], [0.2, 0.05, 0.8], 'its tail keeps stackAs');
  h.run(1.1);
  assert.deepEqual([now().data.value, now().data.stackAs], [0.05, 0.8], 'and resumes with it');
  b.applyStatus(e, 'weaken', { value: 0.5, duration: 5 });
  assert.equal(now().data.value, 0.05, 'a plain 50 % does not outrank it either');
  checkInvariants(h.b);
});

for (const uncancellable of [false, true]) test(`Raidian accuracy preserves its miss and attack cache when cancellation is ${uncancellable ? 'rejected' : 'accepted'}`, () => {
  const h = arena(RECORDS[0], { sp: 0 });
  h.step();
  const b = h.b, u = h.unit(1), e = h.spawn('brute', { pos: [10, 5] });
  let rolls = 0;
  b.rng = Object.assign(() => { rolls++; return 0; }, b.rng);
  const seen = [];
  b.on('hit', c => { if (c.source === e) seen.push(c.dmg); }, { priority: 1000 });
  for (const attackId of [601, 601, 602]) assert.equal(b.dealDamage({ source: e, target: u, amount: 10,
    type: 'arts', calculation: 'resolved', isAttack: true, attackId, dodgeMode: 'ignore', noSp: true,
    ignoreCancelReasons: uncancellable ? ['miss'] : [] }), uncancellable ? 10 : 0);
  assert.equal(rolls, 2);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(d => d.missed && d.cancel === !uncancellable));
  done(h);
});
