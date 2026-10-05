// Profession / subprofession default behaviours (server/sim/professions.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { SUB, resolveProfile } from '../../server/sim/professions.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { PROJECTILE_SPEEDS, BOOMERANG_RETURN_SPEED } from '../../server/sim/constants.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });
const R3 = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]];
const mk = (sub, profession, o = {}) => chessRec({ id: 't_' + sub, profession, subProfessionId: sub, skill: null, rangeGrid: R3, stats: { atk: 100, bat: 1, ...(o.stats || {}) }, ...o });

test('every subProfessionId in the visible pool has a dedicated profile entry', () => {
  const ds = getDefaultSource();
  const missing = new Set();
  const seen = new Set();
  for (const id of ds.chessIds()) {
    const raw = ds.rawChess(id);
    if (!raw || raw.isDiy || raw.chessType === 'DIY') continue;
    const c = ds.getChess(id);
    if (!c.subProf) continue;
    seen.add(c.subProf);
    if (!SUB[c.subProf]) missing.add(c.subProf);
  }
  assert.deepEqual([...missing], []);
  assert.ok(seen.size >= 50, `${seen.size} subprofessions`);
});

test('every visible chess (normal & elite) fights in a real battle without errors', () => {
  const ds = getDefaultSource();
  const ids = ds.chessIds().filter((id) => { const r = ds.rawChess(id); return r && !r.isDiy && r.chessType !== 'DIY' && r.stats; });
  let silent = [];
  for (const id of ids) {
    const h = makeBattle({
      stageId: 'act2autochess_m04', seed: 3,
      defs: { enemies: { enemy_dummy: dummy({ atk: 300, bat: 2, speed: 0.6, hp: 30000 }) } },
      units: [{ chessId: id, row: 9, col: 7 }, { chessId: 'chess_char_1_02_a', row: 9, col: 4 }],
      enemies: [{ key: 'enemy_dummy', count: 4, interval: 2 }, { key: 'enemy_dummy', route: 1, count: 2, interval: 3 }],
      timeLimit: 40, content: 'full',
    });
    h.run(20);
    checkInvariants(h.b);
    const u = h.unit(id);
    assert.equal(h.b.internalErrorCount ?? 0, 0, `${id}: ${JSON.stringify(h.b.errors.slice(0, 2))}`);
    assert.equal(h.b.errors.length, 0, `${id}: ${JSON.stringify(h.b.errors.slice(0, 2))}`);
    if (u.stats.attacks === 0 && u.stats.heal === 0 && !(u.skill && u.skill.activations > 0)) silent.push(id + ':' + u.def.subProf);
  }
  // units that legitimately never act on their own in this setup (no injured ally / no attack without skill)
  silent = silent.filter((s) => !/:(physician|ringhealer|chainhealer|healer|wandermedic|bard|phalanx|librator)$/.test(s));
  assert.deepEqual(silent, []);
});

test('centurion hits every blocked enemy; reaper heals itself per enemy hit (capped by block)', () => {
  const h = makeBattle({
    defs: { chess: { t_centurion: mk('centurion', 'WARRIOR', { rangeGrid: [[0, 0], [0, 1]], stats: { blockCnt: 3, maxHp: 1e6 } }) }, enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 1e6, speed: 2 }) } },
    units: [{ chessId: 't_centurion', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_w', count: 3, interval: 0.2 }], content: 'none', autoFinish: false,
  });
  h.run(8);
  const ens = h.enemies();
  assert.equal(ens.filter((e) => e.blockedBy).length, 3);
  for (const e of ens) assert.ok(e.stats.taken > 0);
  const h2 = makeBattle({
    defs: { chess: { t_reaper: mk('reaper', 'WARRIOR', { rangeGrid: [[0, 0], [0, 1]], stats: { blockCnt: 2, maxHp: 10000 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_reaper', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6], count: 3 }], content: 'none',
  });
  h2.step();
  const r = h2.unit('t_reaper');
  r.hp = 5000;
  h2.run(1.02);
  approx(r.hp, 5000 + 50 * 2 * (r.stats.attacks - 1), 1e-6); // 3 enemies hit, heal capped at blockCnt 2 (first attack was at full HP)
});

test('splash casters hit enemies around the target; chain casters bounce with falloff', () => {
  const h = makeBattle({
    defs: { chess: { t_splashcaster: mk('splashcaster', 'CASTER', { stats: { atk: 1000 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_splashcaster', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [10, 6.8] }, { key: 'enemy_dummy', pos: [12, 9] }], content: 'none',
  });
  h.run(1);
  const [a, b, far] = h.b.units.filter((u) => u.defId === 'enemy_dummy');
  assert.ok(a.stats.taken > 0 && b.stats.taken > 0);
  assert.equal(far.stats.taken, 0);
  const h2 = makeBattle({
    defs: { chess: { t_chain: chessRec({ id: 't_chain', profession: 'CASTER', subProfessionId: 'chain', skill: null, rangeGrid: R3, stats: { atk: 1000 }, trait: '攻击造成法术伤害，且会在4个敌人间跳跃，每次跳跃伤害降低15%' }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_chain', row: 10, col: 4 }],
    enemies: [0, 1, 2, 3, 4].map((i) => ({ key: 'enemy_dummy', pos: [10, 6 + i * 0.9] })), content: 'none',
  });
  const prof = h2.unit('t_chain').profile;
  assert.equal(prof.chain.count, 4, 'count parsed from trait text');
  h2.run(1);
  const hit = h2.b.units.filter((u) => u.defId === 'enemy_dummy' && u.stats.taken > 0).map((u) => Math.round(u.stats.taken));
  assert.equal(hit.length, 4);
  assert.deepEqual(hit.slice().sort((x, y) => y - x), [1000, 850, 723, 614]);
});

test('ring healers heal three allies; bards heal everyone in range every second', () => {
  const ally = (id) => chessRec({ id, profession: 'TANK', skill: null, stats: { maxHp: 10000, atk: 0 } });
  const h = makeBattle({
    defs: {
      chess: {
        t_ring: chessRec({ id: 't_ring', profession: 'MEDIC', subProfessionId: 'ringhealer', attackKind: 'heal', dmgType: 'heal', skill: null, rangeGrid: [[0, 0], [0, 1], [1, 0], [1, 1], [-1, 0], [-1, 1], [0, 2]], stats: { atk: 300, bat: 2 } }),
        a1: ally('a1'), a2: ally('a2'), a3: ally('a3'), a4: ally('a4'),
      },
    },
    units: [{ chessId: 't_ring', row: 10, col: 4 }, { chessId: 'a1', row: 10, col: 5 }, { chessId: 'a2', row: 11, col: 5 }, { chessId: 'a3', row: 9, col: 5 }, { chessId: 'a4', row: 10, col: 6 }],
    content: 'none',
  });
  h.step();
  for (const id of ['a1', 'a2', 'a3', 'a4']) h.unit(id).hp = 1000 + (id === 'a4' ? 5000 : 0);
  h.run(0.1);
  const healed = ['a1', 'a2', 'a3', 'a4'].filter((id) => h.unit(id).hp > (id === 'a4' ? 6000 : 1000));
  assert.deepEqual(healed, ['a1', 'a2', 'a3']);
  const h2 = makeBattle({
    defs: { chess: { t_bard: chessRec({ id: 't_bard', profession: 'SUPPORT', subProfessionId: 'bard', attackKind: 'none', dmgType: 'heal', skill: null, rangeGrid: [[0, 0], [0, 1], [1, 0], [-1, 0]], stats: { atk: 1000 } }), a1: ally('a1'), a2: ally('a2') } },
    units: [{ chessId: 't_bard', row: 10, col: 4 }, { chessId: 'a1', row: 10, col: 5 }, { chessId: 'a2', row: 11, col: 4 }],
    content: 'none',
  });
  h2.step();
  h2.unit('a1').hp = 1000; h2.unit('a2').hp = 1000;
  h2.run(3.05);
  approx(h2.unit('a1').hp, 1000 + 3 * 100);
  approx(h2.unit('a2').hp, 1000 + 3 * 100);
  assert.equal(h2.unit('t_bard').stats.attacks, 0);
});

test('lord deals 80 % at range, 100 % in melee reach; instructor 120 % vs unblocked', () => {
  const h = makeBattle({
    defs: { chess: { t_lord: mk('lord', 'WARRIOR', { attackKind: 'ranged', projectile: 'arrow', canHitFly: true, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]], stats: { atk: 1000 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_lord', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], content: 'none', captureNoisy: true, hooks: ['damaged'],
  });
  h.run(1);
  assert.equal(Math.round(h.hooksOf('damaged')[0].amount), 800);
  const h2 = makeBattle({
    defs: { chess: { t_ins: mk('instructor', 'WARRIOR', { rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 1000, blockCnt: 0 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_ins', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], content: 'none', captureNoisy: true, hooks: ['damaged'],
  });
  h2.run(0.5);
  assert.equal(Math.round(h2.hooksOf('damaged')[0].amount), 1200);
});

test('geek loses HP over time; merchant drains DP and retreats when broke; charger gains DP on kills', () => {
  const h = makeBattle({ defs: { chess: { t_geek: mk('geek', 'SPECIAL', { stats: { maxHp: 1000 } }) } }, units: [{ chessId: 't_geek', row: 9, col: 5 }], content: 'none' });
  h.run(10.05);
  approx(h.unit('t_geek').hp, 1000 - 10 * 30, 1e-6);
  const h2 = makeBattle({ defs: { chess: { t_merchant: mk('merchant', 'SPECIAL', { stats: { respawnTime: 1000 } }) } }, units: [{ chessId: 't_merchant', row: 9, col: 5 }], content: 'none', flags: { dpInit: 10, dpPerSec: 0 } });
  h2.run(9.05);
  assert.ok(h2.b.getPlayer('p1').dp < 2);
  assert.equal(h2.unit('t_merchant').alive, true);
  h2.run(3.1);
  assert.equal(h2.unit('t_merchant').alive, false, 'retreated when DP ran out');
  const h3 = makeBattle({
    defs: { chess: { t_charger: mk('charger', 'PIONEER', { stats: { atk: 1e5 } }) }, enemies: { enemy_dummy: dummy({ hp: 10 }) } },
    units: [{ chessId: 't_charger', row: 9, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [9, 6], count: 3 }], content: 'none', flags: { dpPerSec: 0 },
  });
  h3.run(4);
  approx(h3.b.getPlayer('p1').dp, 13);
});

test('dollkeeper: fatal damage ⇒ a 1 s switch, 20 s as the substitute (block 0, 阻回), the switch back; the substitute dies ⇒ the unit dies', () => {
  const h = makeBattle({ defs: { chess: { t_dollkeeper: mk('dollkeeper', 'SPECIAL', { stats: { maxHp: 2000, blockCnt: 2 } }) } }, units: [{ chessId: 't_dollkeeper', row: 9, col: 5 }], content: 'none' });
  h.step();
  const u = h.unit('t_dollkeeper');
  h.b.dealDamage(null, u, { amount: 1e5, type: 'true' });
  assert.equal(u.alive, true, 'substitute instead of death');
  assert.equal(u.s.blockCnt, 0);
  assert.ok(u.trait.doll && u.trait.dollSwitching, 'the switch animation');
  assert.equal(u.form, 'doll');
  approx(u.hp, 2000); // no 替身 token: its own max HP
  // the switch animation (PRTS 分支特性信息 傀儡师): 无敌, 不死 (a 流失 stops at 1 HP), 阻回, 眩晕 immunity
  h.b.dealDamage(null, u, { amount: 1e5, type: 'true' });
  approx(u.hp, 2000); // 无敌
  assert.equal(h.b.applyStatus(u, 'stun', { duration: 5 }), false, '眩晕 immune');
  h.b.loseHp(u, 1e5);
  assert.ok(u.alive && u.trait.doll && u.hp >= 1, '不死');
  const low = u.hp;
  assert.ok(u.s.flags.noHeal && u.s.flags.healFree, '禁疗 during the switch');
  assert.equal(h.b.heal(u, u, 500), 0, 'a self-heal does not land');
  approx(u.hp, low);
  u.hp = 2000;
  h.run(1.05);
  assert.ok(u.trait.doll && !u.trait.dollSwitching, 'fighting as the substitute');
  h.run(19.9);
  assert.ok(u.trait.doll && u.s.flags.noSp, 'the 20 s form, 阻回');
  h.run(0.1);
  assert.ok(!u.trait.doll && u.trait.dollSwitching && u.form === null, 'switching back');
  assert.equal(u.s.blockCnt, 2, 'blocks again from the start of the switch back');
  approx(u.hp, 2000);
  h.run(1.05);
  assert.ok(!u.trait.dollSwitching && !u.s.flags.noSp, 'the body again, no 阻回');
  h.b.dealDamage(null, u, { amount: 1e5, type: 'true' });
  h.run(1.05);
  h.b.dealDamage(null, u, { amount: 1e5, type: 'true' });
  assert.equal(u.alive, false, 'substitute dies ⇒ unit dies');
  assert.ok(!u.trait.doll && u.form === null, 'the redeploy is the body again');
  checkInvariants(h.b);
});

test('phalanx never attacks until its skill; librator ramps ATK while idle and resets on skill end', () => {
  const ph = chessRec({ id: 't_ph', profession: 'CASTER', subProfessionId: 'phalanx', attackKind: 'none', dmgType: 'arts', rangeGrid: R3, stats: { atk: 100, def: 100 }, skill: { spCost: 5, initSp: 0, duration: 5, trigger: { rule: 'SEARCH' } } });
  const h = makeBattle({ defs: { chess: { t_ph: ph }, enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 't_ph', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], content: 'generic' });
  h.run(4.5);
  const u = h.unit('t_ph');
  assert.equal(u.stats.attacks, 0);
  approx(u.s.def, 300);
  h.run(1);
  assert.equal(u.skill.active, true);
  h.run(1);
  assert.ok(u.stats.attacks > 0);
  approx(u.s.def, 100);
  const lib = chessRec({ id: 't_lib', profession: 'WARRIOR', subProfessionId: 'librator', attackKind: 'none', rangeGrid: [[0, 0], [0, 1]], stats: { atk: 100, blockCnt: 1 }, skill: { spCost: 100, initSp: 0, duration: 5 } });
  const h2 = makeBattle({ defs: { chess: { t_lib: lib } }, units: [{ chessId: 't_lib', row: 9, col: 5 }], content: 'generic' });
  h2.run(10.05);
  const l = h2.unit('t_lib');
  approx(l.s.atk, 100 * 1.5);
  assert.equal(l.s.blockCnt, 0);
  h2.run(60);
  approx(l.s.atk, 300);
});

test('stalker dodges and hits everything in range; hunter consumes and reloads ammo', () => {
  const h = makeBattle({
    defs: { chess: { t_stalker: mk('stalker', 'SPECIAL', { rangeGrid: [[0, 0], [0, 1], [0, 2]] }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_stalker', row: 9, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [9, 6] }, { key: 'enemy_dummy', pos: [9, 7] }], content: 'none',
  });
  h.run(1.1);
  const u = h.unit('t_stalker');
  assert.equal(u.s.dodgePhys, 0.5);
  assert.equal(u.s.taunt, -1);
  for (const e of h.enemies()) assert.ok(e.stats.taken > 0);
  const h2 = makeBattle({
    defs: { chess: { t_hunter: mk('hunter', 'SNIPER', { stats: { atk: 100, bat: 0.5 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_hunter', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], content: 'none', captureNoisy: true, hooks: ['damaged'],
  });
  h2.run(5);
  const hu = h2.unit('t_hunter');
  assert.equal(hu.stats.attacks, 8, '8 bullets then empty');
  assert.equal(Math.round(h2.hooksOf('damaged')[0].amount), 120);
  h2.b.enemies[0].x = 20; // out of range → reload
  h2.b.enemies[0].hidden = true;
  h2.run(4);
  assert.ok(hu.trait.ammo >= 2);
});

// 回环射手 (loopshooter, 跃跃): "持有回旋投射物时才能够攻击（投射物需要时间回收）" — out at 15 tiles/s, back at 3.75
// (PRTS 跃跃 特性 note); a 0.2 s attack interval so the boomerang, not the cooldown, sets the pace
const LOOP = () => mk('loopshooter', 'SNIPER', { id: 't_loop', attackKind: 'ranged', projectile: 'arrow', canHitFly: true, stats: { atk: 100, bat: 0.2, respawnTime: 5 } });

test('loopshooter: the boomerang flies out (15 tiles/s), hits on arrival, flies back (3.75 tiles/s); the next attack waits for the catch', () => {
  const p = resolveProfile({ profession: 'SNIPER', subProf: 'loopshooter', attackKind: 'ranged', dmgType: 'phys', projectile: 'arrow', traitBb: {} });
  assert.equal(p.projectile, 'boomerang', "the data's generic 'arrow' never replaces the boomerang");
  assert.equal(PROJECTILE_SPEEDS.boomerang, 15);
  assert.equal(BOOMERANG_RETURN_SPEED, 3.75);
  for (const col of [7, 5]) { // 3 tiles / 1 tile away
    const h = makeBattle({
      defs: { chess: { t_loop: LOOP() }, enemies: { enemy_dummy: dummy() } },
      units: [{ chessId: 't_loop', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, col] }],
      content: 'none', captureNoisy: true, hooks: ['attack', 'damaged'], autoFinish: false,
    });
    h.run(8);
    const u = h.unit('t_loop');
    const d = col - 4;
    const flight = d / PROJECTILE_SPEEDS.boomerang + d / BOOMERANG_RETURN_SPEED;
    const at = h.hooksOf('attack').filter((c) => c.attacker === u).map((c) => c.t);
    const hits = h.hooksOf('damaged').filter((c) => c.source === u);
    assert.ok(at.length >= 5, `${d} tiles: ${at.length} attacks`);
    for (let i = 1; i < at.length; i++) {
      const gap = at[i] - at[i - 1];
      assert.ok(gap >= flight - 1e-9 && gap <= flight + 3 * h.TICK, `${d} tiles: gap ${gap.toFixed(3)} ≈ out + back ${flight.toFixed(3)}`);
    }
    // one hit per throw (the way back deals nothing), landing out-flight time after the throw
    const landed = at.filter((t) => t + d / PROJECTILE_SPEEDS.boomerang + 2 * h.TICK < h.b.time).length;
    assert.ok(hits.length >= landed && hits.length <= at.length, `one hit per boomerang (${hits.length} hits, ${at.length} throws)`);
    const lag = hits[0].t - at[0];
    assert.ok(lag >= d / PROJECTILE_SPEEDS.boomerang - 2 * h.TICK && lag <= d / PROJECTILE_SPEEDS.boomerang + h.TICK, `hit ${lag.toFixed(3)} s after the throw`);
    const atk = h.eventsOf('atk').filter((e) => e[1] === u.id);
    assert.ok(atk.length && atk.every((e) => e[3] === 'boomerang'), "b.ev ['atk', thrower, target, 'boomerang']");
    checkInvariants(h.b);
  }
});

test('loopshooter: a target killed mid-flight is not hit, the boomerang still comes back; a knocked-out thrower gets a fresh one on redeploy', () => {
  const h = makeBattle({
    defs: { chess: { t_loop: LOOP() }, enemies: { enemy_dummy: dummy(), enemy_dummy2: dummy({ key: 'enemy_dummy2', hp: 1e7 }) } },
    units: [{ chessId: 't_loop', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_dummy2', pos: [10, 7] }],
    content: 'none', captureNoisy: true, hooks: ['attack', 'damaged'], autoFinish: false,
  });
  const u = h.unit('t_loop');
  assert.ok(h.runUntil(() => u.stats.attacks === 1, 2));
  const first = h.hooksOf('attack')[0].targets[0];
  assert.equal(u.trait.boomerangsOut, 1);
  h.b.kill(first);
  h.run(0.5);
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === first && c.source === u).length, 0, 'the dead target took nothing');
  assert.equal(u.stats.attacks, 1, 'still waiting for the boomerang');
  assert.ok(h.runUntil(() => u.stats.attacks === 2, 1.5), 'caught at the thrower → the next throw');
  const second = h.hooksOf('attack')[1].targets[0];
  assert.notEqual(second, first);
  // knocked out with the boomerang in flight: it is lost; the redeployed thrower holds a fresh one
  assert.equal(u.trait.boomerangsOut, 1);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false);
  h.run(2);
  assert.equal(u.stats.attacks, 2);
  assert.ok(h.runUntil(() => u.alive, 10), 'redeployed');
  assert.equal(u.trait.boomerangsOut, 0, 'a fresh boomerang');
  assert.ok(h.runUntil(() => u.stats.attacks === 3, 1), 'attacks at once');
  checkInvariants(h.b);
});

test('fortress: melee on blocked enemies, ranged splash otherwise; tactician calls a reinforcement', () => {
  const fort = mk('fortress', 'TANK', { attackKind: 'ranged', projectile: 'arrow', canHitFly: true, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], stats: { atk: 500, blockCnt: 3, maxHp: 1e6 } });
  const h = makeBattle({
    defs: { chess: { t_fort: fort }, enemies: { enemy_dummy: dummy(), enemy_w: enemyRec({ key: 'enemy_w', hp: 1e6, speed: 2 }) } },
    units: [{ chessId: 't_fort', row: 9, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [9, 8] }, { key: 'enemy_dummy', pos: [9, 8.6] }], content: 'none',
  });
  h.run(1.5);
  const [a, b] = h.enemies();
  assert.ok(a.stats.taken > 0 && b.stats.taken > 0, 'splash');
  const tac = mk('tactician', 'PIONEER', { rangeGrid: [[0, 0], [0, 1], [0, 2], [1, 1], [-1, 1]], stats: { atk: 200 } });
  const h2 = makeBattle({ defs: { chess: { t_tactician: tac } }, units: [{ chessId: 't_tactician', row: 10, col: 4 }], content: 'none' });
  h2.step();
  const tok = h2.b.allyUnits.find((u) => u.kind === 'token');
  assert.ok(tok, 'reinforcement spawned');
  assert.equal(tok.s.blockCnt, 1);
  assert.equal(tok.ownerUnit.id, h2.unit('t_tactician').id);
});

test('skywalker blocks FLY enemies', () => {
  const h = makeBattle({
    defs: { chess: { t_skywalker: mk('skywalker', 'SPECIAL', { canHitFly: true, attackKind: 'melee', rangeGrid: [[0, 0], [0, 1]], stats: { blockCnt: 2, maxHp: 1e6 } }) }, enemies: { enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e6, speed: 2, motion: 'FLY' }) } },
    units: [{ chessId: 't_skywalker', row: 9, col: 5 }], enemies: [{ key: 'enemy_fly', route: 2 }], content: 'none', autoFinish: false,
  });
  h.run(8);
  assert.equal(h.enemy('enemy_fly').blockedBy?.id, h.unit('t_skywalker').id);
});

test('incantation medics heal an ally for 50 % of damage dealt; wandermedics clear element gauges', () => {
  const inc = chessRec({ id: 't_inc', profession: 'MEDIC', subProfessionId: 'incantationmedic', attackKind: 'ranged', dmgType: 'arts', projectile: 'bolt', rangeGrid: R3, skill: null, stats: { atk: 1000 } });
  const tank = chessRec({ id: 't_tank', profession: 'TANK', skill: null, stats: { maxHp: 1e5, atk: 0 } });
  const h = makeBattle({
    defs: { chess: { t_inc: inc, t_tank: tank }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_inc', row: 10, col: 4 }, { chessId: 't_tank', row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], content: 'none',
  });
  h.step();
  h.unit('t_tank').hp = 1000;
  h.run(0.5);
  approx(h.unit('t_tank').hp, 1000 + 500, 1e-6);
  // …and not only for attacks: the official trait buff is ON_AFTER_OUTPUT_DAMAGE (`vendla_tr` / `reed2_tr` / `titi_tr`),
  // so ANY damage the 咒愈师 deals heals. The sim used to run the trait from the attack path (`profile.afterHit`) only,
  // which is why 缇缇's 凝固的时光 ticks — and every 咒愈师 skill that damages without an attack — healed nothing.
  h.unit('t_tank').hp = 1000;
  h.b.dealDamage(h.unit('t_inc'), h.enemy('enemy_dummy'), { amount: 400, type: 'arts', isSkill: true });
  approx(h.unit('t_tank').hp, 1000 + 200, 1e-6, 'skill damage heals 50 %');
  // a gauge fill removes no HP: it is not "伤害" for the trait
  h.unit('t_tank').hp = 1000;
  h.b.emit?.('damaged', { source: h.unit('t_inc'), target: h.enemy('enemy_dummy'), amount: 400, type: 'element', dmg: null });
  approx(h.unit('t_tank').hp, 1000, 1e-6, 'element 损伤 does not heal');
  const wm = chessRec({ id: 't_wm', profession: 'MEDIC', subProfessionId: 'wandermedic', attackKind: 'heal', dmgType: 'heal', rangeGrid: R3, skill: null, stats: { atk: 400 } });
  const h2 = makeBattle({ defs: { chess: { t_wm: wm, t_tank: tank } }, units: [{ chessId: 't_wm', row: 10, col: 4 }, { chessId: 't_tank', row: 10, col: 5 }], content: 'none' });
  h2.step();
  h2.unit('t_tank').elem.neural = 500;
  h2.run(0.1);
  approx(h2.unit('t_tank').elem.neural, 300);
});

test('resolveProfile: data fields win over table defaults; kit trait overrides win over data', () => {
  const ds = getDefaultSource();
  const c = ds.getChess('chess_char_1_01_a');
  const p = resolveProfile(c);
  assert.equal(p.priority, 'fly');
  assert.equal(p.attack, 'ranged');
  assert.equal(p.canHitFly, true);
  const p2 = resolveProfile(c, { priority: 'lowDef', maxTargets: 2 });
  assert.equal(p2.priority, 'lowDef');
  assert.equal(p2.maxTargets, 2);
  const medic = resolveProfile(ds.getChess('chess_char_2_02_a'));
  assert.equal(medic.dmgType, 'heal');
  assert.equal(medic.attack, 'ranged');
  assert.ok(medic.heal);
  const bard = resolveProfile(ds.getChess('chess_char_4_25_a'));
  assert.equal(bard.noAttack, true);
});

test('fortress (号角 / 灰毫) is ground-only and never fires at FLY enemies', () => {
  const ds = getDefaultSource();
  for (const id of ['chess_char_2_18_a', 'chess_char_2_18_b', 'chess_char_5_08_a', 'chess_char_5_08_b']) {
    const p = resolveProfile(ds.getChess(id));
    assert.equal(p.canHitFly, false, `${id}: cannot hit fly`);
    assert.equal(p.groundOnly, true, `${id}: ground only`);
  }
  // the data's generic ranged default would set canHitFly (resolveProfile derives it from attackKind),
  // so this checks the branch guard rather than the generated field
  const fort = () => mk('fortress', 'TANK', {
    attackKind: 'ranged', projectile: 'bomb',
    rangeGrid: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [-1, 0], [-1, 1], [-1, 2]],
    stats: { blockCnt: 3, maxHp: 1e6 },
  });
  const fly = makeBattle({
    defs: { chess: { t_fortress: fort() }, enemies: { enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e6, speed: 0, motion: 'FLY' }) } },
    units: [{ chessId: 't_fortress', row: 10, col: 5 }], enemies: [{ key: 'enemy_fly', pos: [10, 7] }], content: 'none', autoFinish: false,
  });
  fly.run(8);
  assert.equal(fly.unit('t_fortress').stats.attacks, 0, 'no normal attack against air only');
  assert.equal(fly.enemy('enemy_fly').hp, 1e6, 'the FLY enemy is untouched');
  const ground = makeBattle({
    defs: { chess: { t_fortress: fort() }, enemies: { enemy_g: enemyRec({ key: 'enemy_g', hp: 1e6, speed: 0 }) } },
    units: [{ chessId: 't_fortress', row: 10, col: 5 }], enemies: [{ key: 'enemy_g', pos: [10, 7] }], content: 'none', autoFinish: false,
  });
  ground.run(8);
  assert.ok(ground.unit('t_fortress').stats.attacks > 0, 'ground enemies are still attacked');
  assert.ok(ground.enemy('enemy_g').hp < 1e6, 'and take splash damage');
});
