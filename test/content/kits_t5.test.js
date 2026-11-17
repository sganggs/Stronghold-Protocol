// Tier-5 operator kits (server/sim/content/kits/ops/chess_char_5_*.js): every chess runs a real battle through the harness and its
// signature effect is asserted with numbers taken from its own blackboards (normal Lv4 / elite Lv7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { TIER_KITS } from '../../server/sim/content/kits/index.js';

const KITS = TIER_KITS[4];

const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≉ ${b}`);
const dummy = (key = 'enemy_dummy', o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const ally = (id, o = {}) => chessRec({ id, skill: null, stats: { maxHp: 10000, atk: 0, def: 0, blockCnt: 0, ...(o.stats || {}) }, ...o });
const bbOf = (u) => u.def.skill.bb;
const tal = (u, i) => (u.def.raw.talents || []).find((t) => t.index === i)?.bb ?? {};
const tagged = (h, tag, target = null) => h.hooksOf('damaged').filter((c) => (c.dmg?.tags || []).includes(tag) && (!target || c.target === target));
const fxOf = (h, kind) => h.eventsOf('fx').filter((e) => e[1] === kind);
const absKeysHas = (grid, u, r, c) => grid.some(([dr, dc]) => u.tileR + dr === r && u.tileC + dc * u.facing === c);
const clean = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []); checkInvariants(h.b); };

test('tier-5 registry: all 23 non-DIY tier-5 chess have a hand-authored kit', () => {
  const ids = Object.keys(KITS).sort();
  assert.equal(ids.length, 23);
  for (let i = 1; i <= 23; i++) assert.ok(KITS[`chess_char_5_${String(i).padStart(2, '0')}_a`], `kit for 5_${i}`);
  for (const id of ids) {
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], autoFinish: false, timeLimit: 3 });
    h.step();
    assert.equal(h.unit(id).kit.generic, undefined, `${id} uses its own kit`);
  }
});

// ------------------------------------------------------------------------------------------------------------------
test('圣约送葬人 S2: ATK/DEF +45 %, block +1, 12 ammo +1 per Laterano op on the field; 受选之人 extra attacks', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_lat: ally('t_lat', { bonds: ['lateranoShip'] }) } },
    units: [{ chessId: 'chess_char_5_01_a', row: 9, col: 5 }, { chessId: 't_lat', row: 12, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], hooks: ['ammoUsed', 'skillEnd'], seed: 5, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_01_a');
  const bb = bbOf(u);
  h.step();
  const atk0 = u.s.atk, def0 = u.s.def, blk0 = u.s.blockCnt;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  approx(u.s.atk, atk0 * (1 + bb.atk));
  approx(u.s.def, def0 * (1 + bb.def));
  assert.equal(u.s.blockCnt, blk0 + bb.block_cnt);
  assert.ok(h.runUntil(() => !u.skill.active, 60));
  assert.equal(h.hooksOf('ammoUsed').length, bb['attack@trigger_time'] + 2, '12 + himself + t_lat');
  h.run(30);
  assert.ok(fxOf(h, 'extraAttack').length > 0, 'extra attacks happen');
  clean(h);
});

test('圣约送葬人 S2: melee attacks are dodged with prob and refill ammo', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_hitter: dummy('enemy_hitter', { atk: 300, bat: 0.5 }) } },
    units: [{ chessId: 'chess_char_5_01_a', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_hitter', pos: [9, 5] }], hooks: ['ammoUsed', 'skillStart', 'skillEnd', 'dodge'], seed: 11, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_01_a');
  h.step();
  u.skill.gainSp(1000);
  h.runUntil(() => u.skill.active, 10);
  h.runUntil(() => !u.skill.active, 90);
  const dodges = fxOf(h, 'dodge').filter((e) => e[4].id === u.id).length;
  assert.ok(dodges > 0, 'dodged some melee hits');
  assert.equal(h.hooksOf('dodge').filter((c) => c.target === u).length, dodges, 'the engine dodge hook sees the skill dodges');
  assert.equal(h.hooksOf('ammoUsed').length, bbOf(u)['attack@trigger_time'] + 1 + dodges * bbOf(u).recover_cnt);
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('缇缇 S3: ATK +110 %, 2 targets, sleep on hit, wake-up burst (×max scale after a full sleep), ally sleep guard; T1 damage on sleepers', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_ally: ally('t_ally') } },
    units: [{ chessId: 'chess_char_5_02_a', row: 10, col: 4 }, { chessId: 't_ally', row: 10, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], hooks: ['damaged', 'statusApplied'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_02_a');
  h.step();
  const e = h.enemy('enemy_dummy');
  const bb = bbOf(u), t0 = tal(u, 0);
  const atk0 = u.s.atk;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  approx(u.s.atk, atk0 * (1 + bb.atk));
  assert.equal(h.b.effectiveProfile(u).maxTargets, bb['attack@max_target']);
  assert.ok(h.runUntil(() => e.s.flags.sleep, 5), 'the skill hit puts the target to sleep');
  const slept = h.b.time;
  // ally sleep guard: lethal damage on an ally in range → asleep instead of dead
  const a = h.unit('t_ally');
  h.b.dealDamage(null, a, { amount: 1e9, type: 'true' });
  assert.ok(a.alive && a.hasBuff('titi:allySleep') && a.s.flags.sleep);
  h.b.dealDamage(null, a, { amount: 1e9, type: 'true' });
  assert.ok(a.alive, 'still protected while asleep');
  a.hp = a.s.maxHp;
  h.run(0.3);
  assert.ok(!a.hasBuff('titi:allySleep'), 'wakes up at full HP');
  // wake-up burst after a full sleep: max_atk_scale × ATK arts
  assert.ok(h.runUntil(() => tagged(h, 'titiWake', e).length > 0, 8));
  const w = tagged(h, 'titiWake', e)[0];
  assert.ok(w.t - slept >= bb.sleep - 0.2);
  approx(w.amount, u.s.atk * bb.max_atk_scale, 1e-6, 'wake burst');
  // T1: sleeping enemies take damage_atk_scale × ATK per second; extra 15 % on non-moving targets
  const dream = tagged(h, 'titiDream', e);
  assert.ok(dream.length >= 3);
  approx(dream[0].amount, atk0 * (1 + bb.atk) * t0.damage_atk_scale, 1e-6, 'dream');
  assert.ok(tagged(h, 'titiStill', e).length > 0);
  clean(h);
});

test('缇缇 T2 勇气的报偿: Sargon/Minos ops above 50 % HP get +20 ASPD', () => {
  const h = makeBattle({
    defs: { chess: { t_sar: ally('t_sar', { bonds: ['sargonShip'] }), t_other: ally('t_other') } },
    units: [{ chessId: 'chess_char_5_02_a', row: 10, col: 4 }, { chessId: 't_sar', row: 12, col: 4 }, { chessId: 't_other', row: 12, col: 5 }],
    autoFinish: false, timeLimit: 10,
  });
  h.run(0.5);
  const u = h.unit('chess_char_5_02_a');
  const s = h.unit('t_sar'), o = h.unit('t_other');
  assert.equal(s.s.aspd, 100 + tal(u, 1).attack_speed);
  assert.equal(o.s.aspd, 100);
  s.hp = s.s.maxHp * 0.4;
  h.run(1);
  assert.equal(s.s.aspd, 100, 'below 50 %: no vigour');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('烛煌 S3: its target and the enemies within the 1.7 splash, BAT −1.3 s, burn bursts refill ammo; T1 熔点引爆 350 % + heal; T2 downed → revive', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_03_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [9, 5] }],
    hooks: ['damaged', 'ammoUsed'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_03_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  const atk0 = u.s.atk;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  approx(u.s.atk, atk0 * (1 + bb.atk));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-6, 'BAT 1.6 − 1.3 s');
  h.run(1);
  const hitIds = new Set(h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isSkill && c.dmg.isAttack).map((c) => c.target.id));
  assert.equal(hitIds.size, 3, 'group attack: the three stand within 1.7 of each other (PRTS 备注 "攻击溅射半径1.7")');
  // a burn burst anywhere: +ammo, 熔点引爆 elemental damage and heal
  const e = h.b.enemies[0];
  u.hp = 100;
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 1000 });
  const melt = tagged(h, 'blazeMelt', e);
  assert.equal(melt.length, 1);
  approx(melt[0].amount, u.s.atk * t0.ep_damage_scale, 1e-6, 'meltdown');
  approx(u.hp, 100 + u.s.maxHp * t0.hp_ratio, 1e-6, 'heal 12 %');
  h.runUntil(() => !u.skill.active, 60);
  assert.equal(h.hooksOf('ammoUsed').length, bb['attack@trigger_time'] + bb.ammo_recover);
  assert.ok(tagged(h, 'blazeBurn', e).length > 0, 'extra elemental damage vs the burning target');
  // 绝处重燃
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.hasBuff('blaze2:downed'));
  approx(u.s.shield, t1.dynamic, 1e-6, 'shield');
  assert.ok(u.s.flags.disarm && u.s.flags.noHeal);
  assert.equal(h.b.heal(h.unit('chess_char_5_03_a'), u, 0) === 0, true);
  const downHp = u.hp;
  const e2 = h.b.enemies[1];
  h.b.dealDamage(null, e2, { type: 'element', element: 'burn', amount: 1000 });
  assert.equal(tagged(h, 'blazeMelt', e2).length, 1, '熔点引爆 still hits while she is downed');
  assert.ok(u.hp - downHp < u.s.maxHp * t0.hp_ratio * 0.5, '… but its heal does not reach her (无法被治疗)');
  u.hp = u.s.maxHp;
  h.run(0.3);
  assert.ok(!u.hasBuff('blaze2:downed'), 'revived');
  assert.ok(h.b.enemies.filter((x) => Math.hypot(x.x - u.x, x.y - u.y) <= 1.5).every((x) => x.s.flags.stun), 'nearby enemies stunned');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('华法琳 S1: the next heal on a target below half HP adds hp_ratio × max HP; charges only spent below 50 %; T1 SP on kills', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_ally: ally('t_ally') } },
    units: [{ chessId: 'chess_char_5_04_a', row: 10, col: 3 }, { chessId: 't_ally', row: 10, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_04_a');
  const a = h.unit('t_ally');
  const bb = bbOf(u), t0 = tal(u, 0);
  h.step();
  u.skill.gainSp(1000);
  const ch = u.skill.charges;
  assert.equal(ch, u.skill.maxCharges);
  a.hp = 6000;
  assert.ok(h.runUntil(() => a.hp > 6000, 10));
  approx(a.hp - 6000, u.s.atk, 1e-6, 'plain heal above half HP');
  assert.equal(u.skill.charges, ch, 'no charge spent');
  a.hp = 3000;
  assert.ok(h.runUntil(() => a.hp > 3000, 10));
  approx(a.hp - 3000, u.s.atk + a.s.maxHp * bb.hp_ratio, 1e-6, 'bandage bonus');
  assert.equal(u.skill.charges, ch - 1);
  assert.equal(u.skill.sp, 0, 'the heal made by the skill recovers no attack SP');
  a.hp = 8000;
  assert.ok(h.runUntil(() => u.skill.sp > 0, 10), 'plain heals recover SP again');
  assert.equal(u.skill.sp, 1);
  // 血液样本回收
  const sp = u.skill.sp;
  h.b.dealDamage(null, h.b.enemies[0], { amount: 1e9, type: 'true' });
  approx(u.skill.sp, Math.min(u.skill.spCost, sp + t0['bldsk_t_1[self].sp']), 1e-6, 'SP +2 on a kill in range');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('乌尔比安 S3: anchor 135 % ATK + stun on the first enemy ahead, moves there (marker at home) and returns at the end', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_05_a', row: 9, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 7] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_05_a');
  h.step();
  const e = h.enemy('enemy_dummy');
  const bb = bbOf(u);
  const hp0 = u.s.maxHp, atk0 = u.s.atk;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2), 'CUSTOM_RANGE: enemy 4 tiles ahead');
  approx(u.s.maxHp, hp0 * (1 + bb.max_hp));
  approx(u.s.atk, atk0 * (1 + bb.atk));
  const hit = tagged(h, 'anchor', e);
  assert.equal(hit.length, 1);
  approx(hit[0].amount, u.s.atk * bb.atk_scale, 1e-6, 'anchor damage');
  assert.ok(e.s.flags.stun);
  assert.deepEqual([u.tileR, u.tileC], [9, 7], 'moved onto the anchor tile');
  const marker = h.b.allyUnits.find((x) => x.kind === 'token' && x.alive);
  assert.ok(marker && marker.tileR === 9 && marker.tileC === 3 && marker.s.flags.untargetable);
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  assert.deepEqual([u.tileR, u.tileC], [9, 3], 'back home');
  assert.equal(marker.alive, false);
  clean(h);
});

test('乌尔比安 S3 while he blocks (e.g. after a 突袭 landing): the anchor lands on his own tile — no 【移动】, no marker (PRTS 备注; GitHub #33)', () => {
  // PRTS 乌尔比安 S3 备注: target = his own tile (only while blocking) > the nearest tile of the skill range with an enemy >
  // its farthest tile; the 从不混淆的方向 only when the 【移动】 changes his tile
  const setup = (near) => {
    const h = makeBattle({
      defs: { enemies: { enemy_dummy: dummy(), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) } },
      units: [{ chessId: 'chess_char_5_05_a', row: 9, col: 3 }],
      enemies: [{ key: near, pos: [9, 3] }, { key: 'enemy_dummy', pos: [9, 7] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 120,
    });
    const u = h.unit('chess_char_5_05_a');
    h.step();
    const [e0, far] = h.b.enemies;
    const blocked = e0.blockedBy === u;
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.active, 2), near);
    return { h, u, e0, far, blocked, anchor: fxOf(h, 'anchor')[0] };
  };
  { // blocking the enemy on his tile: the anchor on his own tile, he stays
    const { h, u, e0, far, blocked, anchor } = setup('enemy_dummy');
    assert.ok(blocked, 'he blocks the enemy on his tile');
    assert.deepEqual([anchor[2], anchor[3]], [3, 9], 'the anchor on his own tile');
    assert.equal(tagged(h, 'anchor', e0).length, 1, 'the blocked enemy is hit');
    assert.ok(e0.s.flags.stun);
    assert.equal(tagged(h, 'anchor', far).length, 0, '4 tiles ahead, out of the 1.8 radius');
    assert.deepEqual([u.tileR, u.tileC], [9, 3], 'no 【移动】');
    assert.ok(!h.b.allyUnits.some((x) => x.kind === 'token'), 'no 从不混淆的方向');
    assert.ok(h.runUntil(() => !u.skill.active, 30));
    assert.deepEqual([u.tileR, u.tileC], [9, 3]);
    clean(h);
  }
  { // not blocking, a flyer over his tile: his own tile is no candidate (only while blocking) — the anchor flies to the
    // enemy 4 tiles ahead and he moves there, as in 0.1.1
    const { h, u, e0, far, blocked, anchor } = setup('enemy_fly');
    assert.ok(!blocked, 'a flyer is not blocked');
    assert.deepEqual([anchor[2], anchor[3]], [7, 9], 'the anchor on the enemy ahead');
    assert.equal(tagged(h, 'anchor', far).length, 1);
    assert.equal(tagged(h, 'anchor', e0).length, 0, 'the flyer over his tile is out of the 1.8 radius');
    assert.deepEqual([u.tileR, u.tileC], [9, 7], 'moved onto the anchor tile');
    const marker = h.b.allyUnits.find((x) => x.kind === 'token' && x.alive);
    assert.ok(marker && marker.tileR === 9 && marker.tileC === 3, 'the marker on his tile');
    assert.ok(h.runUntil(() => !u.skill.active, 30));
    assert.deepEqual([u.tileR, u.tileC], [9, 3], 'back home');
    clean(h);
  }
});

test('乌尔比安 T1 本性的坚守 heals per hit taken; T2 血脉的哺养 +HP/ATK per kill (abyssal allies half); elite healing ×1.2', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_abyss: ally('t_abyss', { charId: 'char_143_ghost' }) } },
    units: [{ chessId: 'chess_char_5_05_a', row: 9, col: 3 }, { chessId: 't_abyss', row: 12, col: 3 }], autoFinish: false, timeLimit: 20,
  });
  const u = h.unit('chess_char_5_05_a');
  const t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  const max = u.s.maxHp;
  h.b.dealDamage(null, u, { amount: 500, type: 'true' });
  approx(u.hp, max - 500 + t0.value1, 1e-6, 'heal 100');
  h.b.dealDamage(null, u, { amount: u.hp - max * 0.3, type: 'true' });
  approx(u.hp, max * 0.3 + t0.value2, 1e-6, 'heal 160 below 50 %');
  const e = h.spawn('enemy_dummy', { pos: [11, 8] });
  const atk0 = u.s.atk, ab = h.unit('t_abyss'), abHp = ab.s.maxHp;
  h.b.dealDamage(u, e, { amount: 1e9, type: 'true' });
  approx(u.s.maxHp, max + t1.max_hp);
  approx(u.s.atk, atk0 + t1.atk);
  approx(ab.s.maxHp, abHp + t1['ulpia_t_1[abyssal].max_hp']);
  const g = makeBattle({ units: [{ chessId: 'chess_char_5_05_b', row: 9, col: 3 }], autoFinish: false, timeLimit: 5 });
  g.step();
  approx(g.unit('chess_char_5_05_b').s.healingTakenMul, g.unit('chess_char_5_05_b').def.traitBb.heal_scale);
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('隐德来希 S3: candles for the 3 highest-HP ground enemies (60 % HP), only he hurts them (≥35 % ATK), the original loses the same HP', () => {
  const h = makeBattle({
    defs: { enemies: {
      e_a: dummy('e_a', { hp: 1e6, def: 3000 }), e_b: dummy('e_b', { hp: 2e6 }), e_c: dummy('e_c', { hp: 3e6 }), e_d: dummy('e_d', { hp: 4e5 }),
    } },
    units: [{ chessId: 'chess_char_5_06_a', row: 9, col: 4 }],
    enemies: [{ key: 'e_a', pos: [10, 5] }, { key: 'e_b', pos: [10, 6] }, { key: 'e_c', pos: [9, 6] }, { key: 'e_d', pos: [9, 5] }],
    autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_06_a');
  const bb = bbOf(u);
  h.step();
  u.skill.gainSp(1000);
  let hpBefore = null;
  assert.ok(h.runUntil(() => { if (!u.skill.active) hpBefore = new Map(h.b.enemies.map((e) => [e.defId, e.hp])); return u.skill.active; }, 5));
  const candles = h.b.enemies.filter((e) => e.alive && e.mem.candleOwner === u);
  assert.equal(candles.length, bb['attack@max_target']);
  assert.deepEqual(candles.map((c) => c.mem.candleOf.defId.replace(/^enemy_/, '')).sort(), ['e_a', 'e_b', 'e_c'], 'highest HP first');
  for (const c of candles) approx(c.s.maxHp, hpBefore.get(c.mem.candleOf.defId) * bb['attack@max_hp_scale'], 0.01);
  const ca = candles.find((c) => c.mem.candleOf.defId.endsWith('e_a'));
  const orig = ca.mem.candleOf;
  assert.equal(h.b.dealDamage(null, ca, { amount: 5000, type: 'true' }), 0, 'others cannot hurt a candle');
  const o0 = orig.hp;
  const dealt = h.b.dealDamage(u, ca, { amount: u.s.atk, type: 'phys', isAttack: true });
  approx(dealt, u.s.atk * 0.35, 1e-6, 'min 35 % ATK through 3000 DEF');
  approx(o0 - orig.hp, dealt, 1e-6, 'original loses the same HP');
  const cb = candles.find((c) => c.mem.candleOf.defId.endsWith('e_b'));
  h.b.leak(cb.mem.candleOf);
  assert.equal(cb.alive, false, 'a leaked original takes its candle along');
  const cc = candles.find((c) => c.mem.candleOf.defId.endsWith('e_c'));
  h.b.dealDamage(null, cc.mem.candleOf, { amount: 1e9, type: 'true' });
  assert.equal(cc.alive, false, 'a killed original too');
  assert.ok(h.runUntil(() => !u.skill.active, 25));
  assert.equal(h.b.enemies.filter((e) => e.alive && e.mem.candleOwner).length, 0, 'candles removed at skill end');
  clean(h);
});

test('隐德来希 T1 萃血 steals max HP + 200 arts/s DoT; T2 重盈 once below 25 % → heal 50 %, phys taken −10 %', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_06_a', row: 9, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 5] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_06_a');
  h.step();
  const e = h.enemy('enemy_dummy');
  const t0 = tal(u, 0), t1 = tal(u, 1);
  const base = u.base.maxHp, eMax = e.base.maxHp;
  h.run(4);
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isAttack && c.target === e).length;
  assert.ok(hits >= 2);
  approx(u.s.maxHp, base + Math.min(t0['attack@steal_hp_max'], hits * t0['attack@steal_hp']));
  approx(e.s.maxHp, eMax - hits * t0['attack@steal_hp']);
  const dot = tagged(h, 'dot', e);
  assert.ok(dot.length >= 2);
  approx(dot[0].amount, t0.magic_value, 1e-6, 'DoT');
  h.b.dealDamage(null, u, { amount: u.hp - u.s.maxHp * 0.2, type: 'true' });
  approx(u.hpRatio, 0.2 + t1['etlchi_t_2[heal].hp_ratio'], 1e-3);
  approx(u.s.physTakenMul, 1 - t1.damage_resistance);
  h.b.dealDamage(null, u, { amount: u.hp - u.s.maxHp * 0.2, type: 'true' });
  approx(u.hpRatio, 0.2, 1e-3, 'only once');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('史尔特尔 S3 黄昏: full heal, max HP +5000, ATK +210 %, range +2, 3 targets, ramping HP loss; T1 −20 RES; T2 余烬 8 s then withdraw', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { res: 20 }) } },
    units: [{ chessId: 'chess_char_5_07_a', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }, { key: 'enemy_dummy', pos: [9, 8] }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_07_a');
  h.step();
  const [near, far] = h.b.enemies;
  const bb = bbOf(u);
  const hp0 = u.base.maxHp, atk0 = u.s.atk;
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.target === near), 3));
  const first = h.hooksOf('damaged').find((c) => c.source === u && c.target === near);
  approx(first.amount, atk0, 1e-6, '熔火: 20 RES ignored');
  u.hp = 500;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 3));
  const t0 = h.b.time;
  approx(u.s.maxHp, hp0 + bb.max_hp);
  assert.ok(u.hp > u.s.maxHp - 50, 'healed to full');
  approx(u.s.atk, atk0 * (1 + bb.atk));
  assert.equal(h.b.effectiveProfile(u).maxTargets, bb['attack@max_target']);
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.target === far), 3), 'range +2');
  h.run(10);
  const t = h.b.time - t0;
  approx(u.hpRatio, 1 - bb.hp_ratio * t * t / (2 * bb.duration), 0.02, 'HP loss ramp');
  // 余烬
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.hp >= 1);
  h.run(tal(u, 1)['surtr_t_2[withdraw].interval'] - 0.5);
  assert.ok(u.alive, 'still fighting');
  h.run(1);
  assert.equal(u.alive, false);
  assert.equal(u.removeReason, 'retreat');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('号角 S3: cast with an enemy in range (DEFAULT, DESIGN §21.29); ATK +25 %, BAT −1.2 s, then overload ATK +50 % with HP loss; T1 Defenders ATK +20 %; T2 血战', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_tank: ally('t_tank', { profession: 'TANK', stats: { atk: 100 } }) } },
    units: [{ chessId: 'chess_char_5_08_a', row: 9, col: 3 }, { chessId: 't_tank', row: 12, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 7] }], autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_08_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.run(0.5);
  approx(h.unit('t_tank').s.atk, 100 * (1 + t0.atk), 1e-6, '军事要塞 on another Defender');
  approx(u.s.atk, u.base.atk * (1 + t0.atk), 1e-6, '… and on herself');
  u.skill.gainSp(1000);
  // cast at her next attack with the enemy in range, no hit needed: DEFAULT — the owner's deliberate deviation from the
  // 重装 TAKE_DAMAGE row (DESIGN §21.29)
  assert.equal(u.skill.rule, 'DEFAULT');
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'DEFAULT');
  assert.equal(u.stats.taken, 0, 'nothing hit her');
  const start = h.b.time;
  const total = u.def.skill.duration, ov = bb['horn_s_3[overload_start].damage_duration'];
  approx(u.s.atk, u.base.atk * (1 + t0.atk + bb.atk));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-6, 'BAT 2.8 − 1.2 s');
  // PRTS: a two-segment gauge — 过载 starts at the half of the 24 s duration and lasts the other 12 s
  h.runUntil(() => u.hasBuff('horn:overload'), 30);
  approx(h.b.time - start, total - ov, 0.05, 'overload at the half of the gauge');
  approx(u.s.atk, u.base.atk * (1 + t0.atk + bb['horn_s_3[overload_start].atk']));
  const hp = u.hp;
  h.run(6);
  assert.ok(u.hp < hp, 'overload drains HP');
  assert.ok(h.runUntil(() => !u.skill.active, 10));
  approx(h.b.time - start, total, 0.1, 'the whole skill lasts the data duration (24 s)');
  approx(u.hpRatio, 1 - bb['horn_s_3[overload_start].hp_ratio'] * ov / 2, 0.02, 'ramp to 12 %/s over the 12 s overload');
  assert.ok(!u.hasBuff('horn:overload'));
  u.hp = u.s.maxHp;
  // 血战
  const max = u.s.maxHp;
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive);
  approx(u.s.maxHp, max * (1 - t1.max_hp));
  approx(u.hp, u.s.maxHp, 1e-6, 'full HP');
  assert.equal(u.s.aspd, u.base.aspd + t1.attack_speed);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false, 'once per deployment');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('魔王 S3: inspire +65 % of her max HP to others in range, HP equalised every 2 s; T1 orbiting motes ×1.5 trait (生命回复速度); T2 −10 % from Sarkaz', () => {
  const sark = dummy('enemy_sark');
  sark.tags = ['sarkaz'];
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy(), enemy_sark: sark }, chess: { t_a: ally('t_a'), t_b: ally('t_b'), t_c: ally('t_c') } },
    units: [{ chessId: 'chess_char_5_09_a', row: 10, col: 5 }, { chessId: 't_a', row: 10, col: 4 }, { chessId: 't_b', row: 12, col: 5 }, { chessId: 't_c', row: 11, col: 6 }],
    autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_09_a');
  const a = h.unit('t_a'), b = h.unit('t_b'), c = h.unit('t_c');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  const aura = () => u.s.atk * u.def.traitBb['attack@atk_to_hp_recovery_ratio'];
  // the trait: 生命回复速度 on the allies in range (an hpRegen buff — PRTS 分支特性信息 吟游者; professions.js bardRegen)
  const trait = (x) => x.findBuff(`trait:bard:${u.id}`)?.mods.hpRegen ?? 0;
  h.step();
  a.hp = 2000; b.hp = 8000; c.hp = 2000;
  h.run(1.05);
  // the 3 motes orbit at range_radius 1.15 (dynamic_spd 30°/s, 120° apart): none sits on the left neighbour at t = 1 s
  assert.ok(!a.hasBuff('cetsyr:mote'), 'motes orbit: not on the left neighbour yet');
  approx(trait(a), aura(), 1e-6, 'plain trait before the mote arrives');
  approx(trait(b), aura(), 1e-6, 'plain trait (2 tiles away)');
  assert.ok(a.hp > 2000 && b.hp > 8000, 'regenerating');
  assert.ok(h.runUntil(() => a.hasBuff('cetsyr:mote'), 2), 'an orbiting mote reaches the adjacent operator');
  h.run(0.3);
  approx(trait(a), aura() * t0['attack@trait_mul'], 1e-6, 'mote ×1.5');
  const hpA = a.hp;
  h.run(1);
  assert.ok(Math.abs(a.hp - hpA - aura() * t0['attack@trait_mul']) <= 1.5, `mote ×1.5: +${a.hp - hpA} in 1 s`);
  assert.ok(h.runUntil(() => c.hasBuff('cetsyr:mote'), 12), 'a diagonal neighbour (1.41 tiles) is on the orbit too');
  h.run(8);
  assert.ok(!fxOf(h, 'mote').some((e) => e[4].id === b.id), 'two tiles away: off the orbit');
  // Sarkaz damage −10 %
  const s = h.spawn('enemy_sark', { pos: [9, 9] });
  approx(h.b.dealDamage(s, b, { amount: 1000, type: 'true' }), 1000 * (1 - t1.damage_resistance));
  const n = h.spawn('enemy_dummy', { pos: [10, 6] });
  approx(h.b.dealDamage(n, b, { amount: 1000, type: 'true' }), 1000);
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  h.step();
  approx(a.s.maxHp, 10000 + u.s.maxHp * bb.max_hp, 1e-6, 'inspire');
  assert.ok(h.runUntil(() => fxOf(h, 'hpShare').length > 0, 3));
  approx(a.hpRatio, b.hpRatio, 1e-9, 'HP equalised');
  approx(a.hpRatio, u.hpRatio, 1e-9);
  assert.equal(u.profile.auraRatio, bb['attack@atk_to_hp_recovery_ratio']);
  h.runUntil(() => !u.skill.active, 40);
  approx(a.s.maxHp, 10000, 1e-6, 'inspire removed');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('铃兰 T2 画地为牢 fragile 20 % on sluggish enemies (×1.4 in S3); S3 no attack, range-wide sluggish, 生命回复速度 (none in the first second); T1 Supporter SP aura', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_sup: chessRec({ id: 't_sup', profession: 'SUPPORT', stats: { atk: 0 } }), t_hurt: ally('t_hurt') } },
    units: [{ chessId: 'chess_char_5_10_a', row: 10, col: 4 }, { chessId: 't_sup', row: 12, col: 3 }, { chessId: 't_hurt', row: 11, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_10_a');
  h.step();
  const e = h.enemy('enemy_dummy');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  assert.ok(h.runUntil(() => e.findBuff('fragile'), 5));
  approx(e.s.dmgTakenMul, t1.damage_scale, 1e-9, 'fragile 20 % (the standard 脆弱 status)');
  h.run(0.3);
  approx(h.unit('t_sup').findBuff('aura:spRecovery').mods.spRecoveryFlat, t0.sp_recovery_per_sec);
  approx(u.findBuff('aura:spRecovery').mods.spRecoveryFlat, t0.sp_recovery_per_sec, 1e-9, 'she is a Supporter herself');
  const hurt = h.unit('t_hurt');
  hurt.hp = 5000;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const lastAtk = u.lastAttackAt, cast = h.b.time;
  // PRTS 技能3 备注: an hpRegen buff (no heal), 0 in the first second, its amount refreshed every second
  const fox = () => hurt.findBuff(`lisa:fox:${u.id}`);
  h.run(0.9);
  assert.equal(fox(), null, 'nothing in the first second');
  assert.equal(hurt.hp, 5000);
  h.run(1.2);
  assert.equal(u.lastAttackAt, lastAtk, 'no attacks during S3');
  assert.ok(e.s.flags && e.findBuff('sluggish'), 'enemies in range are sluggish');
  approx(e.s.dmgTakenMul, 1 + (t1.damage_scale - 1) * bb.scale_delta_to_one, 1e-9, 'T2 ×1.4');
  const v = u.s.atk * bb['attack@atk_to_hp_recovery_ratio'];
  approx(fox().mods.hpRegen, v, 1e-9, '生命回复速度 +9 % ATK');
  assert.ok(Math.abs(hurt.hp - 5000 - v * (h.b.time - cast - 1)) <= 2, `regenerated ${hurt.hp - 5000} from the first second on`);
  assert.ok(h.runUntil(() => !u.skill.active, 40));
  assert.equal(fox(), null, 'gone with the skill');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('塞雷娅 S2: heals every injured ally in the skill range for 95 % ATK (+1 SP each, T2); T1 +5 % ATK every 20 s', () => {
  const h = makeBattle({
    defs: { chess: { t_a: chessRec({ id: 't_a', stats: { maxHp: 10000, atk: 0 }, skill: { spCost: 100, initSp: 0 } }), t_b: ally('t_b'), t_far: ally('t_far') } },
    units: [{ chessId: 'chess_char_5_11_a', row: 10, col: 5 }, { chessId: 't_a', row: 10, col: 6 }, { chessId: 't_b', row: 12, col: 5 }, { chessId: 't_far', row: 9, col: 9 }],
    hooks: ['spGain'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_11_a');
  const a = h.unit('t_a'), b = h.unit('t_b'), far = h.unit('t_far');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  a.hp = b.hp = far.hp = 5000;
  assert.ok(h.runUntil(() => u.skill.activations > 0, 12));
  approx(a.hp - 5000, u.s.atk * bb.heal_scale, 1e-6);
  approx(b.hp - 5000, u.s.atk * bb.heal_scale, 1e-6);
  assert.equal(far.hp, 5000, 'outside the skill range');
  const gains = h.hooksOf('spGain').filter((c) => c.unit === a && c.reason === 'talent');
  assert.equal(gains.length, 1, '精神回复');
  assert.equal(gains[0].amount, t1.sp);
  h.run(41 - h.b.time);
  assert.equal(u.findBuff('saria:suit').stacks, 2);
  approx(u.s.atk, u.base.atk * (1 + 2 * t0.atk));
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('夕 S1: next attack 180 % ATK with an expanded splash; T2 点睛 summons 小自在 on the first target (25 s); T1 化境 ATK per kill', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_12_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [11, 7] }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_12_a');
  h.step();
  const [e1, e2] = h.b.enemies;
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  assert.ok(h.runUntil(() => h.b.allyUnits.some((x) => x.kind === 'token' && x.alive), 5));
  const tok = h.b.allyUnits.find((x) => x.kind === 'token');
  assert.deepEqual([tok.tileR, tok.tileC], [10, 6], 'on the target tile');
  assert.equal(tok.defId, 'token_10015_dusk_drgn');
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.dmg.isSkill && c.target === e2), 10), 'expanded splash reaches 1.41 tiles');
  const sk = h.hooksOf('damaged').find((c) => c.source === u && c.dmg.isSkill && c.target === e1);
  approx(sk.amount, u.s.atk * bb.atk_scale, 1e-6, '180 %');
  assert.ok(!h.hooksOf('damaged').some((c) => c.source === u && !c.dmg.isSkill && c.target === e2), 'plain splash never reaches it');
  const atk0 = u.s.atk;
  h.b.dealDamage(tok, e2, { amount: 1e9, type: 'true' });
  approx(u.s.atk, atk0 * (1 + t0.atk) / (1 + (u.findBuff('dusk:realm').stacks - 1) * t0.atk), 1e-6, '化境 via 小自在');
  h.run(t1['attack@tokenduration']);
  assert.equal(tok.alive, false, 'expires');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('归溟幽灵鲨 S2: never below 1 HP during the skill, then knocked out → substitute; T1 substitute slows + 40 % ATK/s; T2 abyssal HP +20 %', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_13_a', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_13_a');
  h.step();
  const e = h.enemy('enemy_dummy');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  approx(u.s.maxHp, u.base.maxHp * (1 + t1.max_hp), 1e-6, '阿戈尔的深邃 on herself');
  const atk0 = u.s.atk;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 3));
  approx(u.s.atk, atk0 * (1 + bb.atk));
  assert.equal(u.s.aspd, u.base.aspd + bb.attack_speed);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.hp >= 1 && !u.trait.doll, 'undying during the skill');
  assert.ok(h.runUntil(() => !u.skill.active, 20));
  h.step();
  assert.ok(u.alive && u.trait.doll && u.hasBuff('trait:substitute'), 'counts as knocked out → substitute');
  h.run(2);
  assert.ok(e.findBuff('ghost2:embrace'));
  approx(e.s.moveSpeed, e.base.moveSpeed * (1 + t0.move_speed));
  const emb = tagged(h, 'embrace', e);
  assert.ok(emb.length >= 1);
  approx(emb[0].amount, u.s.atk * t0.atk_scale, 1e-6);
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('【深海猎人】 = groupId abyssal: 归溟 T2 / 乌尔比安 T2 reach 幽灵鲨 but not 浊心斯卡蒂 (groupId null)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_13_a', row: 9, col: 5 }, { chessId: 'chess_char_5_05_a', row: 9, col: 3 },
      { chessId: 'chess_char_2_07_a', row: 12, col: 5 }, { chessId: 'chess_char_6_04_a', row: 12, col: 3 }],
    autoFinish: false, timeLimit: 10,
  });
  h.step();
  const ghost = h.unit('chess_char_2_07_a'), skadi2 = h.unit('chess_char_6_04_a'), ulpia = h.unit('chess_char_5_05_a');
  assert.ok(ghost.hasBuff('ghost2:abyss') && ulpia.hasBuff('ghost2:abyss'));
  assert.ok(!skadi2.hasBuff('ghost2:abyss'), '浊心斯卡蒂 is not an Abyssal Hunter');
  const e = h.spawn('enemy_dummy', { pos: [9, 4] });
  h.b.dealDamage(ulpia, e, { amount: 1e9, type: 'true' });
  assert.ok(ghost.hasBuff('ulpia:bloodShare') && !skadi2.hasBuff('ulpia:bloodShare'));
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('凛御银灰 S2: 6 front enemies in the skill range take 260 % ATK phys + cold/reveal; T1 SP +4 left of the eye; T2 Kjerag DEF/regen/freeze-immune', () => {
  const tiles = [[9, 4], [9, 5], [9, 6], [10, 3], [10, 4], [10, 5], [11, 3], [11, 4]];
  const h = makeBattle({
    defs: {
      enemies: { enemy_dummy: dummy() },
      chess: {
        t_kj: ally('t_kj', { bonds: ['kjeragShip'], profession: 'TANK', stats: { def: 100 } }),
        t_cheap: chessRec({ id: 't_cheap', stats: { cost: 10, atk: 0 }, skill: { spCost: 100, initSp: 0 } }),
      },
    },
    units: [{ chessId: 'chess_char_5_14_a', row: 9, col: 3 }, { chessId: 't_kj', row: 12, col: 3 }, { chessId: 't_cheap', row: 12, col: 5 }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_14_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  approx(u.skill.sp, u.def.skill.initSp + t0.sp, 0.1, '开放性开局 on himself');
  approx(h.unit('t_cheap').skill.sp, t0.sp, 0.1, '… and on a cheaper op');
  h.run(0.3);
  const kj = h.unit('t_kj');
  approx(kj.s.def, 100 + t1.def, 1e-6, 'DEF +60');
  h.b.applyStatus(kj, 'cold', { duration: 5 });
  h.b.applyStatus(kj, 'cold', { duration: 5 });
  assert.ok(!kj.s.flags.freeze, 'freeze immune');
  for (const p of tiles) h.spawn('enemy_dummy', { pos: p });
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.activations > 0, 2));
  const hits = tagged(h, 'svash2');
  assert.equal(hits.length, bb.max_target);
  for (const c of hits) {
    approx(c.amount, u.s.atk * bb.atk_scale, 1e-6);
    assert.ok(c.target.findBuff('cold') && c.target.findBuff('reveal'));
  }
  h.run(15.5 - h.b.time);
  approx(kj.s.def, 100 + 2 * t1.def, 1e-6, 'doubled after 15 s');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('凛御银灰 S2 auto-cast: SKILL_RANGE — an enemy inside the skill range casts it, no attack needed (PRTS 技能策略)', () => {
  // PRTS 卫戍协议/帮助 技能操作: "携带拥有技能范围的技能（非攻击距离增加）的干员：不通过普通攻击/治疗触发技能，仅在技能范围内存在敌人
  // （无视其不可选中）时释放技能" (it used to wait for an enemy in his melee range — user playtest #6 report 15)
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_14_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [11, 4] }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_14_a');
  assert.equal(u.skill.rule, 'SKILL_RANGE');
  h.step();
  u.skill.gainSp(1000);
  h.run(0.2);
  assert.equal(u.skill.activations, 1, 'enemies only in the skill range: cast');
  assert.equal(h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && !c.dmg.isSkill).length, 0, 'no attack needed');
  const hits = tagged(h, 'svash2');
  assert.equal(new Set(hits.map((c) => c.target.id)).size, 2, 'the burst covers the skill range');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('引星棘刺 S2: alchemy unit (+3 s with an op in range) — 120 % ATK arts/s, healing ×0.5 on ground enemies, allies recover (生命回复速度); T1 ATK +10 %; T2 ASPD ±10 on long roads', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_near: ally('t_near') } },
    units: [{ chessId: 'chess_char_5_15_a', row: 10, col: 3 }, { chessId: 't_near', row: 11, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_15_a');
  h.run(0.5);
  const e = h.enemy('enemy_dummy');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  approx(u.s.atk, u.base.atk * (1 + t0.atk));
  assert.equal(h.unit('t_near').s.aspd, 100 + t1.attack_speed_ally + t1.attack_speed_ally_extra, 'flat stage rows are ≥6-tile straight roads');
  assert.equal(e.s.aspd, 100 + t1.attack_speed_enemy + t1.attack_speed_enemy_extra);
  const near = h.unit('t_near');
  near.hp = 5000;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => (u.mem.zones || []).length > 0, 5));
  assert.equal(u.mem.zones[0].dur, bb.projectile_delay_time + t0.projectile_extend);
  h.run(1.3);
  approx(e.s.healingTakenMul, bb.heal_scale);
  const ticks = tagged(h, 'alchemy', e);
  assert.ok(ticks.length >= 1);
  approx(ticks[0].amount, u.s.atk * bb.atk_scale, 1e-6);
  assert.ok(near.hp > 5000, 'allies inside recover');
  h.run(bb.projectile_delay_time + t0.projectile_extend);
  assert.equal(u.mem.zones.length, 0, 'expired');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('白面鸮 S2: BAT −1.8 s and a larger range; T1 SP aura +0.3/s on every ally (highest wins)', () => {
  const h = makeBattle({
    defs: { chess: { t_a: chessRec({ id: 't_a', stats: { maxHp: 10000, atk: 0 }, skill: { spCost: 100 } }) } },
    units: [{ chessId: 'chess_char_5_16_a', row: 10, col: 3 }, { chessId: 't_a', row: 10, col: 5 }, { chessId: 'chess_char_5_10_a', row: 12, col: 3 }],
    autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_16_a');
  const bb = bbOf(u), t0 = tal(u, 0);
  h.run(0.5);
  approx(h.unit('t_a').findBuff('aura:spRecovery').mods.spRecoveryFlat, t0.sp_recovery_per_sec);
  approx(h.unit('chess_char_5_10_a').findBuff('aura:spRecovery').mods.spRecoveryFlat, tal(h.unit('chess_char_5_10_a'), 0).sp_recovery_per_sec, 1e-9, '铃兰\'s higher Supporter aura wins on Supporters');
  const a = h.unit('t_a');
  a.hp = 3000;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-6);
  assert.ok(u.rangeKeys.length > u.baseRangeKeys.length);
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('山 S2 stance: DEF −30 %, ATK +35 %, block +1, hits all blocked, regen; T1 20 % ×1.6 punches weaken; T2 DEF +10 %, 15 % dodge', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_17_a', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 5] }, { key: 'enemy_dummy', pos: [9, 5] }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 120, seed: 3,
  });
  const u = h.unit('chess_char_5_17_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  approx(u.s.def, u.base.def * (1 + t1.def));
  approx(u.s.dodgePhys, t1.prob);
  assert.equal(u.blocking.length, 1);
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 3));
  approx(u.s.def, u.base.def * (1 + t1.def + bb.def));
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  h.run(3);
  assert.equal(u.blocking.length, 2, 'block +1');
  const [e1, e2] = h.b.enemies;
  const t = h.b.time;
  h.run(2);
  const recent = h.hooksOf('damaged').filter((c) => c.source === u && c.t >= t);
  assert.ok(recent.some((c) => c.target === e1) && recent.some((c) => c.target === e2), 'hits every blocked enemy');
  u.hp = u.s.maxHp * 0.5;
  const hp = u.hp;
  h.run(1);
  approx(u.hp - hp, u.s.maxHp * bb.hp_recovery_per_sec_by_max_hp_ratio, 0.02, 'regen 4 %/s');
  h.run(20);
  const plain = u.s.atk;
  const crits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isAttack && Math.abs(c.amount - plain * t0.atk_scale) < 1e-6);
  assert.ok(crits.length > 0 && fxOf(h, 'crit').length > 0, '巨力重拳 procs');
  assert.ok(h.hooksOf('damaged').some((c) => c.source === u && Math.abs(c.amount - plain) < 1e-6), 'normal hits too');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('百炼嘉维尔 S2: drags unblocked enemies in front of her; T1 ATK/DEF +10 % (+4 % per extra blocked); T2 healing +20 % (+40 % low)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_18_a', row: 9, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 4] }, { key: 'enemy_dummy', pos: [9, 4] }, { key: 'enemy_dummy', pos: [9, 4] }],
    autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_18_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.run(0.5);
  assert.equal(u.blocking.length, 3);
  approx(u.s.atk, u.base.atk * (1 + t0.atk + 2 * t0.atk_add));
  approx(u.s.def, u.base.def * (1 + t0.def + 2 * t0.def_add));
  u.hp = u.s.maxHp * 0.8;
  approx(h.b.heal(null, u, 100), 100 * t1.heal_scale_1);
  u.hp = u.s.maxHp * 0.3;
  approx(h.b.heal(null, u, 100), 100 * t1.heal_scale_2);
  for (const e of h.b.enemies) h.b.dealDamage(null, e, { amount: 1e9, type: 'true' });
  h.run(0.3); // 战地巨斧 refreshes every 0.2 s: back to no extra blocked enemy before the cast
  const near = h.spawn('enemy_dummy', { pos: [9, 5] });
  const far = h.spawn('enemy_dummy', { pos: [9, 6] });
  u.skill.gainSp(1000);
  // S2's 2-5 strictly contains her 1-1: ACTIVE_RANGE (the owner's rule, 2026-10-05) casts it at once, no attack needed
  assert.ok(h.runUntil(() => u.skill.active, 3));
  assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u)?.reason, 'ACTIVE_RANGE');
  approx(u.s.atk, u.base.atk * (1 + t0.atk + bb.atk));
  h.b.dealDamage(null, near, { amount: 1e9, type: 'true' });
  h.run(1.5);
  assert.ok(far.x < 5.6, `dragged in front of her by the extended skill range (x=${far.x})`);
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('玛恩纳 S3: trait ×2, 5 targets at 125 % ATK (×1.1 游侠), Kazimierz attacks add 10 % ATK true; T2 taunt +1 and reflect 15 % ATK', () => {
  const tiles = [[9, 5], [9, 6], [10, 5], [10, 6], [11, 5], [11, 4]];
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_kaz: ally('t_kaz', { bonds: ['kazimierzShip'], stats: { atk: 100 } }) } },
    units: [{ chessId: 'chess_char_5_19_a', row: 9, col: 4 }, { chessId: 't_kaz', row: 12, col: 3 }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_19_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  assert.equal(u.s.taunt, t1.taunt_level);
  const kaz = h.unit('t_kaz');
  const foe = h.spawn('enemy_dummy', { pos: [12, 8] });
  h.b.dealDamage(foe, kaz, { amount: 100, type: 'phys', isAttack: true });
  const refl = tagged(h, 'reflect', foe);
  assert.equal(refl.length, 1);
  approx(refl[0].amount, u.s.atk * t1.atk_scale, 1e-6, 'reflect');
  h.b.dealDamage(null, foe, { amount: 1e9, type: 'true' });
  h.run(10);
  for (const p of tiles) h.spawn('enemy_dummy', { pos: p });
  const ramp = u.trait.ramp;
  assert.ok(ramp > 0.4);
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  approx(u.s.atk, u.base.atk * (1 + ramp * bb.trait_up), 1e-6, 'trait ×2');
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.dmg.isSkill && c.dmg.isAttack), 3));
  const first = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isSkill && c.dmg.isAttack);
  const t = first[0].t;
  const vol = first.filter((c) => c.t === t);
  assert.equal(vol.length, bb['attack@max_target'], '5 targets');
  for (const c of vol) approx(c.amount, u.s.atk * bb['attack@atk_scale'] * t0.atk_scale_base, 1e-6);
  const target = h.b.enemies.find((e) => e.alive);
  const before = tagged(h, 'mlynarMark', target).length;
  assert.ok(before > 0, 'his own attacks are Kazimierz attacks too');
  h.b.dealDamage(kaz, target, { amount: 10, type: 'phys', isAttack: true });
  const mark = tagged(h, 'mlynarMark', target);
  assert.equal(mark.length, before + 1);
  approx(mark[before].amount, u.s.atk * bb.atk_scale, 1e-6, 'Kazimierz mark');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('安洁莉娜: no attack off-skill; S3 (SEARCH) weightless enemies, ATK +90 %, 4 targets; T1 ASPD +7 all; T2 20 HP/s off-skill', () => {
  const tiles = [[10, 5], [10, 6], [11, 5], [11, 6], [9, 5]];
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { mass: 4 }) }, chess: { t_a: ally('t_a') } },
    units: [{ chessId: 'chess_char_5_20_a', row: 10, col: 4 }, { chessId: 't_a', row: 12, col: 4 }],
    enemies: tiles.map((p) => ({ key: 'enemy_dummy', pos: p })), hooks: ['attack'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('chess_char_5_20_a');
  const a = h.unit('t_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  a.hp = 5000;
  h.run(2);
  assert.equal(u.stats.attacks, 0, 'no normal attack while the skill is off');
  assert.equal(a.s.aspd, 100 + t0.attack_speed);
  approx(a.hp, 5000 + 2 * t1.hp_recovery_per_sec, 0.01, '兼职工作');
  const atk0 = u.s.atk;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  approx(u.s.atk, atk0 * (1 + bb.atk));
  assert.ok(h.b.enemies.every((e) => e.findBuff('aglina:weightless') && e.s.massLevel === 3 && e.weight === 3 && e.base.massLevel === 4), 'weightless: weight −1 level (PRTS; engine massFlat, base untouched)');
  h.run(1);
  const vol = h.hooksOf('attack').filter((c) => c.attacker === u);
  assert.ok(vol.length > 0);
  for (const c of vol) assert.equal(c.targets.length, bb['attack@max_target']);
  const hp = a.hp;
  h.run(1);
  approx(a.hp, hp, 1e-6, 'no regen during the skill');
  h.runUntil(() => !u.skill.active, 20);
  assert.ok(h.b.enemies.every((e) => !e.findBuff('aglina:weightless') && e.s.massLevel === 4), 'weight restored');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('寒檀 S2: ice spikes on random range tiles every 0.5 s — 65 % ATK arts + 1 s cold around; T1 after 20 s ATK +15 % and 抵抗', () => {
  const tiles = [];
  for (const dr of [-1, 0, 1]) for (let dc = 0; dc <= 3; dc++) if (dr || dc) tiles.push([10 + dr, 3 + dc]);
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_21_a', row: 10, col: 3 }],
    enemies: tiles.map((p) => ({ key: 'enemy_dummy', pos: p })), hooks: ['damaged', 'statusApplied'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_21_a');
  const bb = bbOf(u), t0 = tal(u, 0);
  h.step();
  const atk0 = u.s.atk;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-6, 'BAT 2.9 − 2.4 s');
  const t = h.b.time;
  h.run(5);
  const spikes = fxOf(h, 'iceSpike').length;
  assert.ok(spikes >= 9 && spikes <= 11, `≈ 2 spikes/s (${spikes})`);
  const ice = tagged(h, 'iceSpike');
  assert.ok(ice.length > 0);
  for (const c of ice) approx(c.amount, atk0 * bb['attack@atk_scale'], 1e-6);
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'cold' && c.t >= t && c.duration === bb['attack@cold']));
  assert.ok(!h.hooksOf('damaged').some((c) => c.source === u && c.dmg.isAttack && !(c.dmg.tags || []).includes('iceSpike') && c.t > t + 0.1), 'no normal attacks during S2');
  assert.ok(ice.every((c) => c.dmg.isAttack), 'the spikes are her attacks');
  h.run(t0.interval + 0.6 - h.b.time);
  approx(u.s.atk, u.base.atk * (1 + t0.atk));
  h.b.applyStatus(u, 'stun', { duration: 4 });
  approx(u.findBuff('stun').timeLeft, 4 * (1 + t0.one_minus_status_resistance), 1e-9, '抵抗 halves the stun');
  // 抵抗 never shortens a longer status she already has
  const left = u.findBuff('stun').timeLeft;
  h.b.applyStatus(u, 'stun', { duration: 1 });
  approx(u.findBuff('stun').timeLeft, left, 1e-9, 'the longer stun is kept');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('妮芙 S2: 270 % ATK + equal splash, fear, apoptosis = 18 % of damage; T1 失魂 DoT on burst targets (70 % from the skill); T2 ATK per burst', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_22_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [10, 6] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_22_a');
  const bb = bbOf(u), t0 = tal(u, 0), t1 = tal(u, 1);
  h.step();
  const [a, b] = h.b.enemies;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.dmg.isSkill && c.type === 'arts'), 5));
  h.step();
  const sk = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isSkill && c.type === 'arts');
  const main = sk.find((c) => !c.dmg.isSplash), splash = sk.find((c) => c.dmg.isSplash);
  approx(main.amount, u.s.atk * bb.atk_scale, 1e-6);
  approx(splash.amount, main.amount, 1e-6, 'equal splash');
  assert.ok(main.target.findBuff('fear'));
  approx(main.target.elem.apoptosis, main.amount * bb.ep_damage_ratio, 1e-6, 'apoptosis 18 % of the damage');
  approx(splash.target.elem.apoptosis, splash.amount * bb.ep_damage_ratio, 1e-6);
  // burst on the first target → normal attacks start the 40 % DoT
  const atk0 = u.s.atk;
  h.b.dealDamage(null, a, { type: 'element', element: 'apoptosis', amount: 1000 });
  assert.ok(a.findBuff('apoptosisBurst'));
  approx(u.s.atk, atk0 * (1 + t1.atk) / 1, 1e-6, '窥心钥 +2 %');
  assert.ok(h.runUntil(() => a.findBuff(`nymph:soul:${u.id}`), 5));
  h.run(2.1);
  const soul = tagged(h, 'nymphSoul', a);
  assert.ok(soul.length >= 2);
  approx(soul[0].amount, u.s.atk * t0.element_atk_scale, 1e-6, '40 % ATK/s');
  u.skill.gainSp(1000);
  h.runUntil(() => a.findBuff(`nymph:soul:${u.id}`)?.data.scale === bb.element_atk_scale, 5);
  assert.equal(a.findBuff(`nymph:soul:${u.id}`).data.scale, bb.element_atk_scale, 'skill hit raises it to 70 %');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
test('录武官 S2: ATK +45 %; healed allies heal 80 HP per hit taken for 10 s; T1 +1 SP and ASPD +16 when an op in range casts', () => {
  const h = makeBattle({
    defs: { chess: { t_a: chessRec({ id: 't_a', stats: { maxHp: 10000, atk: 0 }, skill: { spCost: 100 } }) } },
    units: [{ chessId: 'chess_char_5_23_a', row: 10, col: 3 }, { chessId: 't_a', row: 10, col: 5 }],
    autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_23_a');
  const a = h.unit('t_a');
  const bb = bbOf(u), t0 = tal(u, 0);
  h.step();
  const sp = u.skill.sp;
  a.skill.activate('test', { free: true });
  approx(u.skill.sp, sp + t0.sp, 1e-6, '学成于聚 SP');
  assert.equal(u.s.aspd, u.base.aspd + t0.attack_speed);
  h.run(t0.duration + 0.1);
  assert.equal(u.s.aspd, u.base.aspd);
  const atk0 = u.s.atk;
  a.hp = 3000;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 3));
  approx(u.s.atk, atk0 * (1 + bb.atk));
  assert.ok(h.runUntil(() => a.hasBuff('reckpr:guard'), 5));
  approx(a.findBuff('reckpr:guard').timeLeft, bb['attack@buff_duration'], 0.1);
  const hp = a.hp;
  h.b.dealDamage(null, a, { amount: 500, type: 'true' });
  approx(a.hp, hp - 500 + bb['attack@fixed_heal_value'], 1e-6);
  // "治疗干员后": a summon healed by her gets no guard (纸偶: a summon without 禁疗 — “小自在” holds it, PRTS)
  const tok = h.b.spawnToken(a, 'token_10022_kazema_shadow', 11, 3, { kit: { skill: null } });
  tok.hp = 100;
  assert.ok(h.runUntil(() => tok.hp > 100, 5));
  assert.ok(!tok.hasBuff('reckpr:guard'));
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
// regressions of the 2026-09-28 fidelity review (PRTS 备注 of the base operators; see the kits/shared/tier5.js header)

test('圣约送葬人 T1 受选之人: the extra attack consumes no ammo and never reaches ammoUsed listeners', () => {
  const log = [];
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_01_a', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], hooks: ['ammoUsed'], seed: 5, autoFinish: false, timeLimit: 120,
    setup(b) {
      b.on('attack', (c) => { if (c.attacker.defId === 'chess_char_5_01_a') log.push({ extra: !!c.attacker.mem.extraAttack, active: c.attacker.skill.active }); });
    },
  });
  const u = h.unit('chess_char_5_01_a');
  const bb = bbOf(u);
  h.step();
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  assert.ok(h.runUntil(() => !u.skill.active, 60));
  const ammo = bb['attack@trigger_time'] + 1; // + himself (Laterano)
  const normal = log.filter((x) => x.active && !x.extra).length, extra = log.filter((x) => x.active && x.extra).length;
  assert.ok(extra > 0, 'extra attacks happened during the skill');
  assert.equal(normal, ammo, 'every bullet is one normal attack');
  assert.equal(h.hooksOf('ammoUsed').length, ammo, 'extra attacks are invisible to ammoUsed listeners');
  clean(h);
});

test('元素伤害 uses the engine elemental type: × elementalTakenMul (元素脆弱), never × trueTakenMul (烛煌 熔点引爆, 妮芙 失魂)', () => {
  // one battle per burst: after a burst the enemy's gauges stay locked for its 爆发冷却 (attack/element.js)
  const arena = () => {
    const h = makeBattle({
      defs: { enemies: { enemy_dummy: dummy() } },
      units: [{ chessId: 'chess_char_5_03_a', row: 9, col: 3 }, { chessId: 'chess_char_5_22_a', row: 11, col: 3 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 30,
    });
    h.step();
    const e = h.enemy('enemy_dummy');
    h.b.addBuff(e, { key: 't:true', mods: { trueTakenMul: 2 } });
    h.b.addBuff(e, { key: 't:elem', mods: { elementalTakenMul: 1.5 } });
    return { h, e, blaze: h.unit('chess_char_5_03_a'), nymph: h.unit('chess_char_5_22_a') };
  };
  const a = arena();
  a.h.b.dealDamage(null, a.e, { type: 'element', element: 'burn', amount: 1000 });
  const melt = tagged(a.h, 'blazeMelt', a.e);
  assert.equal(melt.length, 1);
  assert.equal(melt[0].type, 'elemental');
  approx(melt[0].amount, a.blaze.s.atk * tal(a.blaze, 0).ep_damage_scale * 1.5, 1e-6, 'meltdown × elementalTakenMul only');
  clean(a.h);
  const { h, e, nymph } = arena();
  h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 1000 });
  assert.ok(h.runUntil(() => tagged(h, 'nymphSoul', e).length > 0, 6));
  const soul = tagged(h, 'nymphSoul', e)[0];
  assert.equal(soul.type, 'elemental');
  approx(soul.amount, nymph.s.atk * tal(nymph, 0).element_atk_scale * 1.5, 1e-6, '失魂 × elementalTakenMul only');
  clean(h);
});

test('烛煌 T2 绝处重燃: the revive stuns enemies within 1.7 tiles (PRTS)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_03_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 4.6] }, { key: 'enemy_dummy', pos: [10, 4.8] }], autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_03_a');
  h.step();
  const [near, far] = h.b.enemies;
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.hasBuff('blaze2:downed'));
  u.hp = u.s.maxHp;
  h.run(0.3);
  assert.ok(!u.hasBuff('blaze2:downed'));
  assert.ok(near.s.flags.stun, '1.6 tiles away: stunned');
  assert.ok(!far.s.flags.stun, '1.8 tiles away: not stunned');
  clean(h);
});

test('夕 S1 splash widens to 1.7 (PRTS); T2 点睛 summons only on a free deployable target tile', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_12_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [11, 7.3] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_12_a');
  h.step();
  const [, e2] = h.b.enemies;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === u && c.dmg.isSkill && c.target === e2), 10), '1.64 tiles from the target: inside the expanded splash');
  // target on a non-deployable floor tile (the col-10 lane): nothing is summoned, not even next to it
  const g = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_12_a', row: 10, col: 8 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 10] }], autoFinish: false, timeLimit: 30,
  });
  const d = g.unit('chess_char_5_12_a');
  assert.ok(g.runUntil(() => d.stats.attacks > 0, 5));
  g.run(1);
  assert.equal(g.b.allyUnits.filter((x) => x.kind === 'token').length, 0, 'floor tile: no 小自在');
  assert.ok(d.mem.duskSummoned, 'the talent is spent for this deployment');
  // target standing on an ally's tile (blocked there): no summon either
  const k = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_blk: ally('t_blk', { stats: { blockCnt: 1 } }) } },
    units: [{ chessId: 'chess_char_5_12_a', row: 10, col: 4 }, { chessId: 't_blk', row: 10, col: 6 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 30,
  });
  const d2 = k.unit('chess_char_5_12_a');
  assert.ok(k.runUntil(() => d2.stats.attacks > 0, 5));
  k.run(1);
  assert.equal(k.b.allyUnits.filter((x) => x.kind === 'token').length, 0, 'occupied tile: no 小自在');
  clean(h); clean(g); clean(k);
});

test('寒檀 S2: icicles cycle left row → right row → own row, splash 1.5 (PRTS), and count as attacks', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_21_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 4.5] }], hooks: ['damaged', 'attack'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_21_a');
  h.step();
  const e = h.enemy('enemy_dummy');
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.ok(h.runUntil(() => !u.skill.active, 20));
  h.run(0.5);
  const spikes = fxOf(h, 'iceSpike');
  assert.ok(spikes.length >= 20);
  assert.ok(spikes.every((f) => f[4].r === 1.5));
  const rows = spikes.map((f) => f[3]);
  rows.forEach((r, i) => assert.equal(r, [11, 9, 10][i % 3], `icicle ${i} row`));
  const expected = spikes.filter((f) => Math.hypot(f[2] - e.x, f[3] - e.y) <= 1.5 + 1e-9).length;
  assert.ok(spikes.some((f) => f[3] !== 10 && Math.hypot(f[2] - e.x, f[3] - e.y) <= 1.5), 'side-row icicles reach 1.12 tiles away');
  assert.equal(tagged(h, 'iceSpike', e).length, expected, 'every icicle within 1.5 tiles hits');
  assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill && c.targets.includes(e)).length > 0, '"攻击时" hooks see the icicles');
  clean(h);
});

test('缇缇 S3: the wake-up chain sleeps the highest-aggro enemy within 1.5 (PRTS), not merely the nearest', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy(), enemy_taunt: dummy('enemy_taunt', { taunt: 1 }) } },
    units: [{ chessId: 'chess_char_5_02_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_taunt', pos: [11, 7] }],
    hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_02_a');
  h.step();
  const [a, near, taunt] = h.b.enemies;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => a.s.flags.sleep, 5));
  assert.ok(!near.s.flags.sleep && !taunt.s.flags.sleep, 'the other two are out of her range');
  assert.ok(h.runUntil(() => tagged(h, 'titiWake', a).length > 0, 8));
  assert.ok(taunt.s.flags.sleep, 'the taunting enemy (1.41 tiles) is put to sleep');
  assert.ok(!near.s.flags.sleep, 'the nearer one (1 tile) is not');
  clean(h);
});

test('乌尔比安 S3: lands one tile beyond an occupied anchor tile; the anchor stops in front of a crate', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_blk: ally('t_blk', { stats: { blockCnt: 1 } }) } },
    units: [{ chessId: 'chess_char_5_05_a', row: 9, col: 3 }, { chessId: 't_blk', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_05_a');
  h.step();
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  assert.deepEqual([u.tileR, u.tileC], [9, 7], 'anchor tile taken by an ally → the tile beyond');
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  assert.deepEqual([u.tileR, u.tileC], [9, 3], 'back home');
  const g = makeBattle({
    flat: { crates: [[9, 5]] },
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_05_a', row: 9, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 7] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 60,
  });
  const v = g.unit('chess_char_5_05_a');
  g.step();
  v.skill.gainSp(1000);
  assert.ok(g.runUntil(() => v.skill.active, 2));
  const anchor = fxOf(g, 'anchor')[0];
  assert.equal(anchor[2], 4, 'stopped in front of the crate');
  assert.deepEqual([v.tileR, v.tileC], [9, 4]);
  assert.equal(tagged(g, 'anchor').length, 0, 'the enemy 3 tiles further is out of the 1.8 radius');
  clean(h); clean(g);
});

test('引星棘刺 S2: with no enemy in range the unit is thrown at the farthest tile straight ahead (PRTS)', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_5_15_a', row: 10, col: 3 }], autoFinish: false, timeLimit: 30 });
  const u = h.unit('chess_char_5_15_a');
  h.step();
  u.skill.gainSp(1000);
  assert.ok(u.skill.activate('test'));
  const z = u.mem.zones[0];
  assert.ok(z, 'a unit was thrown');
  assert.deepEqual([z.y, z.x], [10, 5]);
  assert.ok(z.vx > 0 && z.vy === 0, 'drifting away from her');
  clean(h);
});

test('隐德来希 S3: candles have their own record (neutral, no attack, original weight) and ignore other sources entirely', () => {
  const h = makeBattle({
    defs: { enemies: { e_a: dummy('e_a', { hp: 1e6, mass: 3 }) } },
    units: [{ chessId: 'chess_char_5_06_a', row: 9, col: 4 }],
    enemies: [{ key: 'e_a', pos: [10, 5] }], autoFinish: false, timeLimit: 60,
  });
  const u = h.unit('chess_char_5_06_a');
  h.step();
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const cd = h.b.enemies.find((e) => e.alive && e.mem.candleOwner === u);
  assert.ok(cd);
  assert.equal(cd.def.name, '心烛');
  assert.equal(cd.def.dmgType, 'none');
  assert.equal(cd.counted, false);
  assert.equal(cd.base.massLevel, 3);
  h.b.dealDamage(null, cd, { type: 'element', element: 'burn', amount: 5000 });
  assert.equal(cd.elem.burn, 0, 'other element sources cannot fill a candle gauge');
  assert.equal(h.b.applyStatus(cd, 'stun', { duration: 3, source: null }), false, 'nor apply statuses');
  h.run(1);
  assert.ok(cd.alive && !cd.moving, 'it never walks off (no leak)');
  assert.equal(h.result?.()?.perPlayer?.p1?.leaked?.length ?? 0, 0);
  clean(h);
});

test('隐德来希 T1 萃血: stealing max HP never lowers a wounded target\'s current HP (only caps it); never below 1 max HP', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy(), enemy_tiny: dummy('enemy_tiny', { hp: 100 }) } },
    units: [{ chessId: 'chess_char_5_06_a', row: 9, col: 4 }], autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_06_a');
  const t0 = tal(u, 0);
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [12, 8] });
  e.hp = e.s.maxHp * 0.5;
  const hp = e.hp, max = e.s.maxHp;
  h.b.dealDamage(u, e, { amount: 1, type: 'true', isAttack: true });
  approx(e.s.maxHp, max - t0['attack@steal_hp']);
  approx(e.hp, hp - 1, 1e-9, 'only the hit itself');
  const tiny = h.spawn('enemy_tiny', { pos: [12, 7] });
  h.b.dealDamage(u, tiny, { amount: 1, type: 'true', isAttack: true });
  assert.ok(tiny.alive && tiny.s.maxHp >= 1 && tiny.hp <= tiny.s.maxHp);
  approx(tiny.s.maxHp, 100 - Math.min(t0['attack@steal_hp'], 99));
  clean(h);
});

test('凛御银灰 S2: the slash ignores 隐匿 (PRTS) and reveals the stealthed enemy', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_14_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 4] }, { key: 'enemy_dummy', pos: [10, 5] }], hooks: ['damaged'], captureNoisy: true, autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_14_a');
  h.step();
  const [, hid] = h.b.enemies;
  h.b.applyStatus(hid, 'stealth', { duration: 99 });
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.activations > 0, 3));
  assert.equal(tagged(h, 'svash2', hid).length, 1, 'the stealthed enemy is slashed');
  assert.ok(hid.findBuff('reveal'), '… and revealed');
  clean(h);
});

test('华法琳 S1: the bandage bonus is part of the heal (healer healingDealtMul applies)', () => {
  const h = makeBattle({
    defs: { chess: { t_ally: ally('t_ally') } },
    units: [{ chessId: 'chess_char_5_04_a', row: 10, col: 3 }, { chessId: 't_ally', row: 10, col: 5 }], autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_04_a'), a = h.unit('t_ally');
  h.step();
  h.b.addBuff(u, { key: 't:heal', mods: { healingDealtMul: 1.5 } });
  u.skill.gainSp(1000);
  a.hp = 3000;
  assert.ok(h.runUntil(() => a.hp > 3000, 10));
  approx(a.hp - 3000, (u.s.atk + a.s.maxHp * bbOf(u).hp_ratio) * 1.5, 1e-6);
  clean(h);
});

test('elite 夕 / 白面鸮: the module range is part of the initial range the DEFAULT trigger checks', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_12_b', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_12_b');
  h.step();
  assert.ok(!absKeysHas(u.def.raw.rangeGrid, u, 10, 6), 'the enemy stands on the module tile only (not in the base range)');
  assert.ok(absKeysHas(u.rangeGrid, u, 10, 6), 'the module grid adds that centre tile');
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.activations > 0, 5), 'cast on the enemy in the module range');
  clean(h);
});

test('安洁莉娜 T2 兼职工作: an HP-regen attribute — allies under 禁疗 regenerate too (PRTS 备注 "不受治疗加成和禁疗影响")', () => {
  const h = makeBattle({
    defs: { chess: { t_a: ally('t_a'), t_b: ally('t_b') } },
    units: [{ chessId: 'chess_char_5_20_a', row: 10, col: 4 }, { chessId: 't_a', row: 12, col: 4 }, { chessId: 't_b', row: 12, col: 6 }],
    autoFinish: false, timeLimit: 30,
  });
  h.step();
  const a = h.unit('t_a'), b = h.unit('t_b');
  h.b.applyStatus(b, 'noHeal', { duration: 20 });
  a.hp = b.hp = 5000;
  h.run(2);
  assert.ok(a.hp > 5000);
  assert.ok(b.hp > 5000, '禁疗 does not stop a 生命回复速度 attribute (PRTS 异常效果 禁疗)');
  approx(b.hp, a.hp, 1e-6, 'same regen');
  assert.equal(h.b.heal(h.unit('chess_char_5_20_a'), b, 100), 0, 'while heals still miss it');
  clean(h);
});

test('铃兰 T2 画地为牢 is an aura: any 停顿 enemy in her range is 脆弱 (standard status, highest wins, not stacked)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_10_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 5] }, { key: 'enemy_dummy', pos: [9, 5] }, { key: 'enemy_dummy', pos: [10, 8] }],
    autoFinish: false, timeLimit: 30,
  });
  const u = h.unit('chess_char_5_10_a');
  const t1 = tal(u, 1);
  h.step();
  const [s1, s2, out] = h.b.enemies;
  h.b.addBuff(u, { key: 't:disarm', flags: { disarm: true } }); // she never attacks here: only others' 停顿
  h.b.applyStatus(s1, 'sluggish', { duration: 3 });
  h.b.applyStatus(s2, 'sluggish', { duration: 3 });
  h.b.applyStatus(s2, 'fragile', { duration: 10, value: 0.3 });
  h.b.applyStatus(out, 'sluggish', { duration: 3 });
  h.run(0.5);
  approx(s1.s.dmgTakenMul, t1.damage_scale, 1e-9, 'someone else\'s 停顿 counts');
  approx(s2.s.dmgTakenMul, 1.3, 1e-9, 'a stronger 脆弱 wins, no stacking');
  approx(out.s.dmgTakenMul, 1, 1e-9, 'outside her range');
  h.run(3.2);
  approx(s1.s.dmgTakenMul, 1, 1e-9, 'ends with the 停顿');
  clean(h);
});

// ------------------------------------------------------------------------------------------------------------------
// elite (精锐) module trait upgrades
test('elite modules: burst ×1.1 (烛煌/妮芙), heal ×1.15 below 50 % (华法琳/塞雷娅/录武官), ×1.1 vs blocked (号角/百炼嘉维尔)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_a: ally('t_a') } },
    units: [
      { chessId: 'chess_char_5_03_b', row: 9, col: 3 }, { chessId: 'chess_char_5_22_b', row: 9, col: 4 }, { chessId: 'chess_char_5_04_b', row: 10, col: 3 },
      { chessId: 'chess_char_5_11_b', row: 10, col: 4 }, { chessId: 'chess_char_5_23_b', row: 11, col: 3 }, { chessId: 'chess_char_5_08_b', row: 11, col: 4 },
      { chessId: 'chess_char_5_18_b', row: 12, col: 3 }, { chessId: 't_a', row: 12, col: 9 },
    ],
    autoFinish: false, timeLimit: 10,
  });
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [12, 8] });
  for (const id of ['chess_char_5_03_b', 'chess_char_5_22_b']) approx(h.b.dealDamage(h.unit(id), e, { amount: 1000, type: 'true' }), 1000, 1e-9, id);
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 1000 });
  for (const id of ['chess_char_5_03_b', 'chess_char_5_22_b']) approx(h.b.dealDamage(h.unit(id), e, { amount: 1000, type: 'true' }), 1000 * h.unit(id).def.traitBb.damage_scale, 1e-9, id);
  const a = h.unit('t_a');
  for (const id of ['chess_char_5_04_b', 'chess_char_5_11_b', 'chess_char_5_23_b']) {
    const m = h.unit(id).def.traitBb;
    a.hp = 8000;
    approx(h.b.heal(h.unit(id), a, 100), 100, 1e-9, id);
    a.hp = 3000;
    approx(h.b.heal(h.unit(id), a, 100), 100 * m.heal_scale, 1e-9, id);
  }
  for (const id of ['chess_char_5_08_b', 'chess_char_5_18_b']) {
    const u = h.unit(id);
    assert.equal(u.profile.dmgMul(h.b, u, { blockedBy: a }), u.def.traitBb.atk_scale, id);
    assert.equal(u.profile.dmgMul(h.b, u, { blockedBy: null }), 1, id);
  }
  clean(h);
});

test('elite modules: range = the module grid (夕/白面鸮), ASPD +8 unblocking (史尔特尔), +10 above half HP (山), SP +0.2 with enemies (铃兰), ATK +8 % (魔王)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() }, chess: { t_a: ally('t_a'), t_b: ally('t_b') } },
    units: [
      { chessId: 'chess_char_5_12_b', row: 12, col: 3 }, { chessId: 'chess_char_5_16_b', row: 12, col: 4 }, { chessId: 'chess_char_5_07_b', row: 9, col: 3 },
      { chessId: 'chess_char_5_17_b', row: 9, col: 8 }, { chessId: 'chess_char_5_10_b', row: 11, col: 7 }, { chessId: 'chess_char_5_09_b', row: 10, col: 5 },
      { chessId: 't_a', row: 10, col: 4 }, { chessId: 't_b', row: 10, col: 6 },
    ],
    autoFinish: false, timeLimit: 10,
  });
  h.run(0.5);
  // integration review (like tier4 莫斯提马 SPC-X): the range becomes the module's own grid — ONE centre tile [0,3] more
  // (not a whole +1 column, which also widened skill ranges)
  for (const id of ['chess_char_5_12_b', 'chess_char_5_16_b']) {
    const u = h.unit(id);
    const rel = u.rangeKeys.map((k) => `${Math.floor(k / 21) - u.tileR},${(k % 21) - u.tileC}`);
    assert.equal(u.s.rangeExtend, 0, id);
    assert.equal(rel.length, u.def.raw.rangeGrid.length + 1, `${id}: exactly one tile more`);
    assert.ok(rel.includes('0,3') && !rel.includes('1,3') && !rel.includes('-1,3'), `${id}: ${rel.join(' ')}`);
  }
  for (const id of ['chess_char_5_12_a', 'chess_char_5_16_a']) {
    const n = makeBattle({ units: [{ chessId: id, row: 12, col: 3 }], autoFinish: false, timeLimit: 3 });
    n.step();
    assert.equal(n.unit(id).s.rangeExtend, 0, id);
    assert.equal(n.unit(id).rangeKeys.length, n.unit(id).def.raw.rangeGrid.length, id);
  }
  const surtr = h.unit('chess_char_5_07_b');
  assert.equal(surtr.s.aspd, surtr.base.aspd + surtr.def.traitBb.attack_speed);
  const mtn = h.unit('chess_char_5_17_b');
  assert.equal(mtn.s.aspd, mtn.base.aspd + mtn.def.traitBb.attack_speed);
  mtn.hp = mtn.s.maxHp * 0.4;
  h.run(0.5);
  assert.equal(mtn.s.aspd, mtn.base.aspd, '山 below 50 %');
  const cet = h.unit('chess_char_5_09_b');
  approx(cet.s.atk, cet.base.atk * (1 + (cet.def.raw.talents.find((t) => t.index === -1).bb.atk)), 1e-9, '魔王 ≥2 ops in range');
  const lisa = h.unit('chess_char_5_10_b');
  assert.equal(lisa.findBuff('lisa:module'), null, 'no enemy in range yet');
  h.spawn('enemy_dummy', { pos: [11, 8] });
  h.run(0.5);
  assert.ok(lisa.findBuff('lisa:module'));
  clean(h);
});

test('elite modules: 归溟幽灵鲨 substitute ATK +15 %; 引星棘刺 2 charges and +0.1 SP/s while a unit is out', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_5_13_b', row: 9, col: 5 }, { chessId: 'chess_char_5_15_b', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], autoFinish: false, timeLimit: 30,
  });
  const g = h.unit('chess_char_5_13_b'), t = h.unit('chess_char_5_15_b');
  h.step();
  const atk0 = g.s.atk;
  h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
  assert.ok(g.trait.doll);
  h.run(0.3);
  approx(g.s.atk, atk0 * (1 + g.def.traitBb.atk));
  assert.equal(t.skill.maxCharges, 2);
  assert.equal(t.kit.skill.kind, 'charges');
  t.skill.gainSp(1000);
  assert.ok(h.runUntil(() => (t.mem.zones || []).length > 0, 5));
  h.run(0.3);
  assert.ok(t.findBuff('thorn2:module'));
  clean(h);
});

test('determinism: a full tier-5 lineup on a real wave replays identically', () => {
  const run = () => {
    const h = makeBattle({
      waveTemplate: 'act1autochess_05', seed: 42,
      units: [
        { chessId: 'chess_char_5_05_a', row: 9, col: 3 }, { chessId: 'chess_char_5_02_b', row: 10, col: 3 }, { chessId: 'chess_char_5_12_a', row: 11, col: 3 },
        { chessId: 'chess_char_5_06_a', row: 12, col: 4 }, { chessId: 'chess_char_5_15_a', row: 10, col: 5 }, { chessId: 'chess_char_5_14_a', row: 9, col: 6 },
        { chessId: 'chess_char_5_20_a', row: 11, col: 6 }, { chessId: 'chess_char_5_09_a', row: 12, col: 7 },
      ],
    });
    const r = h.runToEnd(200);
    clean(h);
    return JSON.stringify({ t: r.time, k: r.killed, s: r.perPlayer.p1.unitStats });
  };
  assert.equal(run(), run());
});

test('soak: random tier-5 lineups (normal + elite) on real stages/waves — normal, unite and boss fields — zero content errors', async () => {
  const { getDefaultSource, spawnsFromTemplate } = await import('../../server/sim/simdata.js');
  const { Battle } = await import('../../server/sim/Battle.js');
  const { createRng } = await import('../../server/sim/rng.js');
  const ds = getDefaultSource();
  const T5 = ds.chessIds().filter((id) => /^chess_char_5_\d+_[ab]$/.test(id));
  const stages = ds.stageIds().filter((id) => { const s = ds.getStage(id); return s && s.raw && s.raw.active !== false && s.rows && s.rows.length === 19; });
  const waves = ds.waveIds().filter((id) => { const w = ds.getWave(id); return w && (w.kind === 'normal' || (!w.kind && /_0\d$|_h0[1-6]$/.test(id))); });
  const boss = ds.waveIds().filter((id) => ['boss', 'hidden'].includes(ds.getWave(id)?.kind));
  const escaped = ds.waveIds().filter((id) => ds.getWave(id)?.kind === 'escaped');
  if (!stages.length || !waves.length) return;
  const rng = createRng(Number(process.env.SIM_T5_SEED) || 2026);
  const place = (stage, n, where) => {
    const dt = stage.raw.deployTiles?.[where] ?? (where === 'normal' ? { melee: stage.raw.normalDeployTiles?.melee_or_any, rangedOnly: stage.raw.normalDeployTiles?.rangedOnly } : null);
    const melee = dt?.melee ?? [], ranged = dt?.rangedOnly ?? [];
    const used = new Set(), units = [];
    for (let i = 0; i < n * 3 && units.length < n; i++) {
      const id = rng.pick(T5);
      const free = (ds.getChess(id).position === 'RANGED' ? ranged.concat(melee) : melee).filter(([r, c]) => !used.has(`${r},${c}`));
      if (!free.length) continue;
      const [r, c] = rng.pick(free);
      used.add(`${r},${c}`);
      units.push({ uid: units.length + 1, kind: 'chess', chessId: id, row: r, col: c, abs: true });
    }
    return units;
  };
  const N = Number(process.env.SIM_T5_N) || 12;
  let casts = 0;
  for (let i = 0; i < N; i++) {
    const stage = ds.getStage(rng.pick(stages));
    const kind = i % 4 === 3 && boss.length ? 'boss' : i % 4 === 2 && escaped.length ? 'unite' : 'normal';
    const tpl = ds.getWave(rng.pick(kind === 'boss' ? boss : kind === 'unite' ? escaped : waves));
    const { routes, spawns, maxPlayTime } = spawnsFromTemplate(tpl, { mods: { hpMul: 1.5, atkMul: 1.5 } });
    let players, sharedBoss = null;
    if (kind === 'boss') {
      players = [{ playerId: 'A', side: 'L', units: place(stage, 6, 'bossLeft') }, { playerId: 'B', seat: 1, side: 'R', units: place(stage, 6, 'bossRight') }];
      sharedBoss = { hp: 3e5, maxHp: 3e5, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } };
    } else if (kind === 'unite') {
      players = [{ playerId: 'A', side: 'L', units: place(stage, 6, 'normal').map((u) => ({ ...u, carryState: { hpPct: 0.5, sp: 5, skillActive: rng() < 0.5 } })) },
        { playerId: 'B', seat: 1, side: 'L', colOffset: 8, units: place(stage, 6, 'normal').map((u) => ({ ...u, col: u.col + 8 })) }];
    } else players = [{ playerId: 'P', side: 'L', units: place(stage, 8, 'normal') }];
    const b = new Battle({ seed: 100 + i, kind: tpl.kind === 'hidden' ? 'hidden' : kind, stageId: stage.id, routes, spawns, players, sharedBoss,
      timeLimit: kind === 'boss' ? Infinity : (maxPlayTime ?? 60), logger: { error() {}, warn() {} }, quiet: true, modeId: 'mode_multi_normal', round: 6 });
    for (let n = 0; !b.finished && b.time < 90; n++) { b.step(); if (n % 45 === 0) checkInvariants(b); }
    if (!b.finished) b.forceEnd('forced');
    checkInvariants(b);
    assert.deepEqual(b.errors.map((e) => `${e.label} ${e.who}: ${e.message}`), [], `battle ${i} (${kind})`);
    const ops = b.allyUnits.filter((u) => u.kind === 'op');
    assert.ok(ops.length >= 3, `battle ${i}: lineup deployed`);
    casts += ops.reduce((s, u) => s + u.skill.activations, 0);
  }
  assert.ok(casts >= N, `skills were cast (${casts})`);
});
