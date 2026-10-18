// test/content/op_weedy.test.js — the 自选 operator kit of 温蒂 (char_400_weedy, 6★ 推击手; kit
// server/sim/content/kits/ops/op-weedy.js) and of her summon 工程蓄水炮 (token_10009_weedy_cannon), fielded the production
// way (a DIY slot + its `diy` pick, simdata getDiy; the cannon as the placed hand piece of her player) in every form:
// tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, PUS-X 仿生海龙改型 or
// PUS-Y 新型仿生原型 at stage 1 (tier 5) / 3 (tier 6). Numbers from data/backups.json; the fidelity checklist of kits/README.md.
// Run: node --test test/content/op_weedy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks, diyRecord } from '../../shared/diy.js';
import { meleeOnHighGround } from '../../shared/highGround.js';
import { positionClass, placeClass } from '../../server/match/board.js';
import { PUSH_TILES } from '../../server/sim/constants.js';
import { CANNON, RUPTURE_KEY, NITRO_SPLASH, WATER_SPLASH, rupture } from '../../server/sim/content/kits/ops/op-weedy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const WEEDY = 'char_400_weedy';
const FORMS = BACKUPS.units[WEEDY].forms;
const TOKREC = BACKUPS.tokens[CANNON];
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const X = 'uniequip_002_weedy', Y = 'uniequip_003_weedy';
const S1 = 'skchr_weedy_1', S2 = 'skchr_weedy_2', S3 = 'skchr_weedy_3';
const statusOf = (tier, elite) => (elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0');
const formOf = (tier, elite) => FORMS[statusOf(tier, elite)];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
/** The cannon's variant of a form, with the pick's skill / module (getDiyToken). */
const tokOf = (tier, elite, skill, mod) => {
  let v = TOKREC.variants[`${WEEDY}@${statusOf(tier, elite)}`];
  if (v.bySkill?.[skill]) v = { ...v, ...v.bySkill[skill] };
  if (mod && v.byModule?.[mod]) v = { ...v, ...v.byModule[mod] };
  return v;
};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_heavy: dummy('enemy_heavy', { mass: 9 }),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, speed: 0.6, mass: 0 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, X, Y].map((m) => [t, true, m]))];

/** 温蒂 as uid 1 at (row, col) facing RIGHT; `cannon` = the cannon piece's tile (uid 2) or null. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, cannon = null, seed = 5, others = [], dp = 0 } = {}) {
  const op = { uid: 1, diy: { slot: SLOT[tier], charId: WEEDY, skillIndex: skill, uniEquipId: mod }, elite, row, col };
  const piece = cannon ? [{ uid: 2, kind: 'token', tokenId: CANNON, ownerUid: 1, row: cannon[0], col: cannon[1] }] : [];
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'deploy', 'attack'], captureNoisy: true,
    units: [op, ...piece, ...others],
  });
  h.b.players[0].dp = dp;
  h.step();
  return { h, u: h.unit(1), c: h.b.allyUnits.find((a) => a.kind === 'token' && a.defId === CANNON) ?? null };
}
const from = (h, src, tag = null) => h.hooksOf('damaged').filter((c) => c.source === src && (!tag || c.dmg.tags.includes(tag)));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

test('温蒂 in every 自选 form: her kit, stats + module attributes, 1-1, blocks 2, melee physical ground-only, hits every blocked enemy, the 高台 rule, 罗德岛 (协防), no 特质; S1 DEFAULT, S2 SP_FULL, S3 SKILL_RANGE', () => {
  assert.equal(OPERATOR_KITS[WEEDY], KITS[WEEDY]);
  const data = { chess: CHESS, backups: BACKUPS };
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [WEEDY, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.base.bat, u.profile.hitAllBlocked], [2, 'melee', false, 'phys', 1.2, true], `${label(f)}: 推击手`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      assert.equal(u.skill.rule, ['DEFAULT', 'SP_FULL', 'SKILL_RANGE'][skill], `${label(f)}: trigger`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      done(h);
    }
    // 「可以放置于远程位」: the composed 自选 record takes a 高台 (shared/highGround.js; the match's placeClass reads it)
    const rec = diyRecord(SLOT[tier], { charId: WEEDY, skillIndex: 0, uniEquipId: mod }, { elite, data });
    assert.equal(rec.placeOnRanged, true, `${label(f)}: placeOnRanged`);
    assert.ok(meleeOnHighGround(rec), `${label(f)}: 高台`);
    assert.equal(positionClass(rec), 'all', label(f));
    assert.equal(placeClass({ fieldRecord: () => rec }, CHESS[elite ? SLOT[tier].replace(/_a$/, '_b') : SLOT[tier]]), 'all', `${label(f)}: placeClass`);
  }
  assert.deepEqual(formOf(6, true).skills.map((s) => [s.skillType, s.trigger.rule]), [['AUTO', 'DEFAULT'], ['AUTO', 'DEFAULT'], ['MANUAL', 'SKILL_RANGE']]);
  assert.deepEqual([modOf(5, X).attr, modOf(6, X).attr, modOf(5, Y).attr, modOf(6, Y).attr], [{ maxHp: 140, atk: 50 }, { maxHp: 210, atk: 72 }, { atk: 46, def: 30 }, { atk: 68, def: 40 }]);
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(WEEDY), `tier ${t}`);
  assert.equal(validateDiyPicks({ [SLOT[5]]: { charId: WEEDY, skillIndex: 2, uniEquipId: Y } }, { data, kitted: KITTED_CHARS }).ok, true);
});

test('S1 炮管敲击 (AUTO, data DEFAULT): her next attack — 120 % / 135 % ATK physical, the target pushed along her facing with 中力 (weight 0: 2.14 tiles) and 晕眩 0.8 / 0.9 s; a weight-9 enemy is not moved', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.spCost, sk.bb.atk_scale, sk.bb.force, sk.bb.stun], elite ? [6, 1.35, 1, 0.9] : [6, 1.2, 1, 0.8], `T${tier}`);
    for (const key of ['enemy_dummy', 'enemy_heavy']) {
      const { h, u } = field({ tier, elite, skill: 0 });
      const e = h.spawn(key, { pos: [10, 6] });
      u.skill.gainSp(999);
      assert.ok(h.runUntil(() => u.skill.activations === 1, 3), `T${tier}: cast on her attack`);
      const hit = from(h, u).find((c) => c.dmg.isSkill);
      approx(hit.amount, u.s.atk * sk.bb.atk_scale, `T${tier}: ${sk.bb.atk_scale * 100} %`);
      assert.equal(hit.type, 'phys');
      const st = h.hooksOf('statusApplied').find((c) => c.source === u && c.status === 'stun' && c.target === e);
      approx(st.duration, sk.bb.stun, `T${tier}: stun`);
      if (key === 'enemy_dummy') approx(e.x - 6, PUSH_TILES[1], `T${tier}: pushed along +x`, 0.06);
      else assert.equal(e.x, 6, `T${tier}: weight 9 ⇒ not moved`);
      assert.equal(e.y, 10, `T${tier}: straight ahead`);
      done(h);
    }
  }
});

test('S2 水炮模式 (AUTO, SP_FULL): ATK +140 % / +170 %, interval ×3.2, range +1, one ranged shot with a 0.9 splash (flyers too), every enemy hit pushed with 小力 along her facing; 持续时间无限', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.spCost, sk.bb.atk, sk.bb.base_attack_time, sk.bb.ability_range_forward_extend, sk.bb.base_force_level], elite ? [78, 1.7, 2.2, 1, 0] : [84, 1.4, 2.2, 1, 0], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 1 });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['toggle', 'SP_FULL']);
    u.skill.gainSp(999);
    h.step();
    assert.ok(u.skill.active, `T${tier}: on at full SP, no enemy needed`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    // full potential: her ASPD is 108 (潜能「攻击速度+8」), so the interval ×100 / 108
    approx(u.s.interval, 1.2 * (1 + sk.bb.base_attack_time) * 100 / 108, `T${tier}: interval`);
    assert.deepEqual(u.liveRangeGrid, [[0, 0], [0, 1], [0, 2]], `T${tier}: +1 tile`);
    const main = h.spawn('enemy_dummy', { pos: [10, 7] });
    const side = h.spawn('enemy_fly', { pos: [10.6, 7] });
    const far = h.spawn('enemy_dummy', { pos: [12, 7] });
    assert.ok(h.runUntil(() => from(h, u).length >= 2, 6), `T${tier}: a shot lands`);
    const hit = from(h, u);
    const id = hit[0].dmg.attackId;
    const one = hit.filter((c) => c.dmg.attackId === id);
    assert.ok(one.some((c) => c.target === main) && one.some((c) => c.target === side), `T${tier}: target + the flyer within ${WATER_SPLASH}`);
    assert.ok(!one.some((c) => c.target === far));
    for (const c of one) approx(c.amount, u.s.atk, `T${tier}: full damage`);
    approx(main.x - 7, PUSH_TILES[0], `T${tier}: 小力 push (weight 0: 1.7 tiles)`, 0.06);
    h.run(60);
    assert.ok(u.skill.active, `T${tier}: stays on`);
    done(h);
  }
});

test('S3 液氮大炮 (MANUAL, SKILL_RANGE 4-1): 290 % / 320 % ATK arts on the target and within 1.2 (flyers too), pushed 中力 / 较大力, and the 移动创伤: 1200 true damage per tile moved for 5 / 6 s', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    assert.deepEqual([sk.spCost, sk.initSp, sk.bb.atk_scale, sk.bb.force, sk.bb.duration, sk.bb.value, sk.bb.dist, sk.bb.interval, sk.rangeId],
      elite ? [37, 16, 3.2, 2, 6, 1200, 1, 0.066, '4-1'] : [40, 13, 2.9, 1, 5, 1200, 1, 0.066, '4-1'], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 2 });
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, `T${tier}: nobody in the 4-1`);
    const t = h.spawn('enemy_dummy', { pos: [10, 7] });          // 2 tiles ahead: the skill range, not her 1-1
    const fly = h.spawn('enemy_fly', { pos: [11, 7] });
    const out = h.spawn('enemy_dummy', { pos: [12, 7] });
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), `T${tier}: cast`);
    const shot = from(h, u, 'weedy:nitro');
    assert.deepEqual(shot.map((c) => c.target).sort((a, b) => a.id - b.id), [t, fly].sort((a, b) => a.id - b.id), `T${tier}: within ${NITRO_SPLASH}`);
    for (const c of shot) { assert.equal(c.type, 'arts'); approx(c.amount, u.s.atk * sk.bb.atk_scale, `T${tier}: arts`); }
    assert.ok(!shot.some((c) => c.target === out));
    const x0 = 7, moved = t.x - x0;
    approx(moved, PUSH_TILES[Math.min(3, sk.bb.force)], `T${tier}: pushed`, 0.06);
    h.run(sk.bb.duration + 0.2);
    assert.equal(t.findBuff(RUPTURE_KEY), null, `T${tier}: ${sk.bb.duration} s`);
    const rup = from(h, u, RUPTURE_KEY).filter((c) => c.target === t);
    const total = rup.reduce((s, c) => s + c.amount, 0);
    approx(total, moved * sk.bb.value, `T${tier}: 1200 per tile of the push`, 0.02);
    assert.ok(rup.every((c) => c.type === 'true' && c.dmg.tags.includes('dot')), `T${tier}: true 持续伤害`);
    const fr = from(h, u, RUPTURE_KEY).filter((c) => c.target === fly).reduce((a, c) => a + c.amount, 0);
    approx(fr, Math.hypot(fly.x - 7, fly.y - 11) * sk.bb.value, `T${tier}: the flyer too (a test flyer is no 静态刚体)`, 0.02);
    done(h);
  }
});

test('移动创伤: a walker takes 1200 per tile it walks; a second application only refreshes the duration (the first source and ratio stay); an update of more than 4 tiles deals nothing', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2, row: 12, col: 3 });
  const w = h.spawn('enemy_walk', { routeIndex: 0 });
  h.run(1);
  const x0 = w.x;
  rupture(h.b, u, w, { duration: 5, perTile: 1200, interval: 0.066 });
  const first = w.findBuff(RUPTURE_KEY);
  h.run(3);
  rupture(h.b, null, w, { duration: 5, perTile: 9999, interval: 0.066 });
  assert.equal(w.findBuff(RUPTURE_KEY), first, 'one buff');
  approx(first.timeLeft, 5, 'refreshed to 5 s', 0.01);
  assert.ok(h.runUntil(() => !w.findBuff(RUPTURE_KEY), 6));
  const x1 = w.x;
  const rup = h.hooksOf('damaged').filter((c) => c.target === w && c.dmg.tags.includes(RUPTURE_KEY));
  assert.ok(rup.length > 50 && rup.every((c) => c.source === u), 'every update from the first source');
  approx(rup.reduce((a, c) => a + c.amount, 0), (x0 - x1) * 1200, '1200 per tile walked', 0.02);
  const d = h.spawn('enemy_dummy', { pos: [10, 8] });
  rupture(h.b, u, d, { duration: 2, perTile: 1200, interval: 0.066 });
  d.x -= 5;   // a 5-tile jump between two updates
  h.run(2.2);
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === d && c.dmg.tags.includes(RUPTURE_KEY)).length, 0, '> 4 tiles: nothing');
  done(h);
});

test('T1 工程蓄水炮: the placed cannon deploys with the board — untargetable, 禁疗, blocks nothing, 3-2, physical arrows at the nearest enemy (air too), its stats from the variant; its forced skill fires once per deployment with 温蒂\'s ATK and its own force +1', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u, c } = field({ tier, elite, mod, skill: 0, cannon: [11, 5], dp: 100 });
    const v = tokOf(tier, elite, 0, elite ? mod : null);
    assert.ok(c && c.alive && c.deployed && c.ownerUnit === u, `${label(f)}: deployed with the board`);
    assert.deepEqual([c.base.atk, c.base.respawnTime, c.base.cost, c.s.blockCnt, c.base.bat], [v.stats.atk, v.stats.respawnTime, v.stats.cost, 0, 2.4], `${label(f)}: stats`);
    assert.deepEqual([!!c.s.flags.untargetable, !!c.s.flags.noHeal, c.profile.attack, c.profile.canHitFly, c.profile.dmgType, c.profile.priority], [true, true, 'ranged', true, 'phys', 'nearest'], `${label(f)}: profile`);
    assert.deepEqual(c.liveRangeGrid, v.rangeGrid, `${label(f)}: 3-2`);
    assert.deepEqual([c.skill.id, c.skill.kind, c.skill.rule, c.skill.spCost], ['sktok_weedy_token', 'instant', 'DEFAULT', 0], `${label(f)}: its skill`);
    const near = h.spawn('enemy_dummy', { pos: [11, 7] }), farther = h.spawn('enemy_dummy', { pos: [11, 8] });
    assert.ok(h.runUntil(() => c.skill.activations === 1, 4), `${label(f)}: its skill on its first attack`);
    const sbb = v.skill.bb;
    const shot = from(h, u, 'weedy:nitro');
    assert.ok(shot.length >= 1 && shot.every((x) => Math.abs(x.amount - u.s.atk * sbb.atk_scale) < 1e-6), `${label(f)}: ${sbb.atk_scale * 100} % of 温蒂's ATK`);
    assert.ok(shot.some((x) => x.target === near), `${label(f)}: the nearest enemy`);
    approx(near.x - 7, PUSH_TILES[Math.min(3, sbb.force + 1)], `${label(f)}: its force +1`, 0.06);
    h.run(30);
    assert.equal(c.skill.activations, 1, `${label(f)}: once per deployment`);
    void farther;
    done(h);
  }
});

test('T1 工程蓄水炮: each attack pushes a ground target on the 3 tiles ahead with 小力 + 1 (weight 0: 2.14 tiles), a flyer is hit but not moved; it leaves after 20 s and comes back 35 s later (PUS-Y stage 3: 27 s) for 5 DP — not while 温蒂 is off the field', () => {
  for (const f of [[5, false, null], [6, true, Y], [6, true, X]]) {
    const [tier, elite, mod] = f;
    const { h, u, c } = field({ tier, elite, mod, skill: 0, cannon: [11, 5], dp: 100 });
    c.skill.charges = 0;   // its forced skill spent: plain attacks only
    const g = h.spawn('enemy_dummy', { pos: [11, 6] });
    assert.ok(h.runUntil(() => from(h, c).some((x) => x.target === g), 3), `${label(f)}: attacks`);
    h.run(0.2);
    approx(from(h, c).find((x) => x.target === g).amount, c.s.atk, `${label(f)}: its own ATK`);
    approx(g.x - 6, PUSH_TILES[1], `${label(f)}: 小力 + 1`, 0.06);
    h.b.kill(g, null);
    const fl = h.spawn('enemy_fly', { pos: [11, 6] });
    assert.ok(h.runUntil(() => from(h, c).some((x) => x.target === fl), 4), `${label(f)}: hits air`);
    assert.equal(fl.x, 6, `${label(f)}: no push on a flyer`);
    h.b.kill(fl, null);
    const t0 = c.deployedAt;
    assert.ok(h.runUntil(() => !c.alive, 25), `${label(f)}: leaves`);
    approx(h.b.time - t0, 20, `${label(f)}: after 20 s`, 0.05);
    const resp = tokOf(tier, elite, 0, elite ? mod : null).stats.respawnTime;
    assert.equal(resp, elite && tier === 6 && mod === Y ? 27 : 35);
    const dp0 = h.b.players[0].dp;
    h.run(resp - 0.5);
    assert.ok(!c.alive, `${label(f)}: not before ${resp} s`);
    assert.ok(h.runUntil(() => c.alive, 1), `${label(f)}: back`);
    approx(h.b.players[0].dp, dp0 - 5, `${label(f)}: 5 DP`);
    assert.deepEqual([c.tileR, c.tileC], [11, 5], `${label(f)}: on its tile`);
    // 温蒂 off the field: it does not come back
    h.run(20.1);
    assert.ok(!c.alive);
    h.b.retreat(u);
    h.run(resp + 2);
    assert.ok(!c.alive, `${label(f)}: not while she is away`);
    done(h);
  }
});

test('T2 蓄水炮强化: the cannon on one of the 4 tiles around her gives her 1 SP every 3 s (PUS-X stage 3: every 2 s and her ATK +20 %; stage 1: 3 s, no ATK); a diagonal cannon gives nothing', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const v = tokOf(tier, elite, 1, elite ? mod : null);
    const boost = v.talents.find((t) => t.bb.base_force_level != null).bb;
    const atkUp = v.talents.find((t) => t.bb.atk != null && t.bb.base_force_level == null)?.bb.atk ?? 0;
    const x3 = elite && tier === 6 && mod === X;
    assert.deepEqual([boost.interval, boost.sp, atkUp], x3 ? [2, 1, 0.2] : [3, 1, 0], label(f));
    for (const [tile, on] of [[[11, 5], true], [[11, 6], false]]) {
      const { h, u } = field({ tier, elite, mod, skill: 1, cannon: tile });
      const sp0 = u.skill.sp;
      h.run(6.01);
      approx(u.skill.sp - sp0, 6 + (on ? 6 / boost.interval : 0), `${label(f)} ${on ? 'beside' : 'diagonal'}: SP`, 0.02);
      approx(u.s.atk, u.base.atk * (1 + (on ? atkUp : 0)), `${label(f)}: ATK`);
      done(h);
    }
  }
});

test('S3 with the cannon beside her: it fires its own 液氮炮 too (its nearest enemy, her ATK, its force +1); not when it stands elsewhere', () => {
  for (const [tile, fires] of [[[11, 5], true], [[12, 5], false]]) {
    const { h, u, c } = field({ tier: 6, elite: true, skill: 2, cannon: tile });
    c.skill.charges = 0;
    const cbb = c.def.skill.bb;
    const a = h.spawn('enemy_dummy', { pos: [10, 9] });
    const b = h.spawn('enemy_dummy', { pos: [tile[0], 7] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1));
    const shot = from(h, u, 'weedy:nitro');
    assert.ok(shot.some((x) => x.target === a), 'hers');
    assert.equal(shot.some((x) => x.target === b), fires, `the cannon at ${tile}`);
    if (fires) approx(b.x - 7, PUSH_TILES[Math.min(3, cbb.force + 1)], 'its force +1', 0.06);
    done(h);
  }
});

test('PUS-X trait: redeployed on a 高台 she gets half her cost back (not at the battle start, not on the ground); PUS-Y trait: blocking two enemies her pushes are one level stronger', () => {
  for (const [tile, ranged] of [[[10, 2], true], [[10, 5], false]]) {
    for (const mod of [X, Y, null]) {
      const { h, u } = field({ tier: 6, elite: true, mod, skill: 0, row: tile[0], col: tile[1], dp: 0 });
      assert.equal(u.ground, !ranged, `${tile}: ground`);
      approx(h.b.players[0].dp, 0, 'nothing at the start');
      h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
      h.b.players[0].dp = u.base.cost;
      assert.ok(h.runUntil(() => u.alive, 80), 'redeployed');
      approx(h.b.players[0].dp, mod === X && ranged ? u.base.cost * 0.5 : 0, `${mod ?? 'none'} on ${ranged ? 'a 高台' : 'the ground'}`);
      done(h);
    }
  }
  for (const mod of [Y, null]) {
    const { h, u } = field({ tier: 6, elite: true, mod, skill: 0, row: 9, col: 5 });
    h.b.addBuff(u, { key: 'test:noSp', flags: { noSp: true } });   // no S1 before both are blocked
    const w1 = h.spawn('enemy_walk', { routeIndex: 0 });
    h.run(1.2);
    const w2 = h.spawn('enemy_walk', { routeIndex: 0 });
    assert.ok(h.runUntil(() => u.blocking.length === 2, 40), 'two blocked');
    const xs = [w1.x, w2.x];
    h.b.removeBuff(u, 'test:noSp');
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 3));
    h.step();
    const moved = [w1.x - xs[0], w2.x - xs[1]];
    for (const m of moved) approx(m, PUSH_TILES[mod === Y ? 2 : 1], `${mod ?? 'none'}: every blocked enemy pushed`, 0.08);
    done(h);
  }
});
