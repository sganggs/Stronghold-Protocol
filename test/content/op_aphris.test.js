// test/content/op_aphris.test.js — the 自选 operator kit of 谬因 (char_4229_aphris, 6★ 轰击术师; kit
// server/sim/content/kits/ops/op-aphris.js) and her summon “中继器” (token_10070_aphris_pc), fielded the production way (a DIY
// slot + its `diy` pick, simdata getDiy; the 中继器 as a token piece of hers) in every form: tiers 5 / 6, normal (E2 Lv1,
// skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or BLA-Y “第三相态” at stage 1 (tier 5) / 3 (tier 6).
// Every number is read back from data/backups.json (the form of that slot status, the token's variant); the fidelity
// checklist of kits/README.md item by item.
// Run: node --test test/content/op_aphris.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const APHRIS = 'char_4229_aphris';
const RELAY = 'token_10070_aphris_pc';
const FORMS = BACKUPS.units[APHRIS].forms;
const TOKEN = BACKUPS.tokens[RELAY];
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const BLAY = 'uniequip_002_aphris';
const S1 = 'skchr_aphris_1', S2 = 'skchr_aphris_2', S3 = 'skchr_aphris_3';
const statusKey = (tier, elite) => (elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0');
const formOf = (tier, elite) => FORMS[statusKey(tier, elite)];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }), enemy_hitter: dummy('enemy_hitter', { atk: 500, range: 3, bat: 1 }) };
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, BLAY].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
const K = (r, c) => r * 21 + c;
const sortN = (a) => [...a].sort((x, y) => x - y);
/** 谬因 at (9, 2) facing RIGHT; her own line (9, 2) … (9, 7). */
const OWN = [[9, 2], [9, 3], [9, 4], [9, 5], [9, 6], [9, 7]];
/** With her 中继器 on (9, 4) facing UP: two steps to it, then 5 more (5 + 2) turned up. */
const BENT = [[9, 2], [9, 3], [9, 4], [10, 4], [11, 4], [12, 4], [13, 4], [14, 4]];

/** A battle with 谬因 as uid 1 at (9, 2) facing RIGHT (`relay`: her piece as uid 2 at relay.row / col / dir), plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 1, relay = null, others = [], seed = 5, dp = 99 } = {}) {
  const units = [{ uid: 1, diy: { slot: SLOT[tier], charId: APHRIS, skillIndex: skill, uniEquipId: mod }, elite, row: 9, col: 2 }];
  if (relay) units.push({ uid: 2, kind: 'token', tokenId: RELAY, ownerUid: 1, row: relay.row, col: relay.col, dir: relay.dir });
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpInit: dp, dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'deploy'], captureNoisy: true,
    units: [...units, ...others],
  });
  h.step();
  return { h, u: h.unit(1), r: relay ? h.unit(2) : null };
}
const UP4 = { row: 9, col: 4, dir: 'UP' };
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
const tagged = (h, u, tag) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes(tag));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('谬因 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + module attributes (BLA-Y: 部署费用 −8), 5-1 line without a 中继器, 轰击术师, no 特质', () => {
  assert.equal(OPERATOR_KITS[APHRIS], KITS[APHRIS]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [APHRIS, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.cost], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def, form.stats.cost + (m?.attr.cost ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.profile.dmgType, u.profile.canHitFly, u.profile.allInRange, u.profile.projectile], ['arts', true, true, 'beam'], `${label(f)}: 轰击术师`);
      assert.deepEqual(sortN(u.rangeKeys), sortN(OWN.map(([a, b]) => K(a, b))), `${label(f)}: her own 5-1`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: the card shows 5-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds, u.def.tokens], [BACKUPS.diy.operators[APHRIS].bonds, [], [RELAY]], `${label(f)}: bonds / 特质 / summon`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: enemies target her`);
      done(h);
    }
  }
  // E2 Lv1 1261 / 762, E2 Lv60 1526 / 861, cost 32 (full potential); BLA-Y −8 cost, +120 / +45 → +200 / +70 HP / ATK
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk, FORMS['2/60/7/1'].stats.cost], [1261, 762, 1526, 861, 32]);
  assert.deepEqual([modOf(5, BLAY).attr, modOf(6, BLAY).attr], [{ cost: -8, maxHp: 120, atk: 45 }, { cost: -8, maxHp: 200, atk: 70 }]);
});

test('a 自选 pick: 谬因 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(APHRIS));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(APHRIS), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: APHRIS, skillIndex: 1, uniEquipId: BLAY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: APHRIS, skillIndex: 1, uniEquipId: BLAY } } });
});

test('链路协议 range: her 中继器 turns the path to its facing and allows 2 more tiles; one attack strikes every enemy of the bent path (air too), none of the straight line past it; the card shows the bent path', () => {
  for (const f of FORMS_ALL) {
    const { h, u, r } = field({ tier: f[0], elite: f[1], mod: f[2], skill: 1, relay: UP4 });
    assert.deepEqual([r.alive, r.dir, r.ownerUnit === u, r.def.id], [true, 'UP', true, RELAY], `${label(f)}: the piece`);
    assert.deepEqual(sortN(u.rangeKeys), sortN(BENT.map(([a, b]) => K(a, b))), `${label(f)}: bent path`);
    assert.deepEqual(sortN(u.baseRangeKeys), sortN(BENT.map(([a, b]) => K(a, b))), `${label(f)}: the DEFAULT trigger reads it too`);
    assert.equal(u.liveRangeGrid.length, BENT.length, `${label(f)}: the card`);
    const before = h.spawn('enemy_dummy', { pos: [9, 3] }), past = h.spawn('enemy_fly', { pos: [12, 4] }), straight = h.spawn('enemy_dummy', { pos: [9, 6] });
    h.runUntil(() => atkHits(h, u).length >= 2, 4);
    const hits = atkHits(h, u);
    const first = hits.filter((c) => c.dmg.attackId === hits[0].dmg.attackId);
    assert.deepEqual(first.map((c) => c.target.id).sort(), [before.id, past.id].sort(), `${label(f)}: the bent path`);
    assert.ok(!hits.some((c) => c.target === straight), `${label(f)}: not the straight line past the piece`);
    done(h);
  }
});

test('the 中继器 (T1 链路协议): ATK +25 % (T6 BLA-Y +35 %) while it stands; it withdraws after 25 s (T6 BLA-Y 35 s) and comes back on its tile 30 s (T6 BLA-Y 20 s) later for 3 DP; untargetable, 无敌, 禁疗, 孤立, blocks nothing', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u, r } = field({ tier, elite, mod, skill: 1, relay: UP4 });
    const y3 = elite && tier === 6 && mod === BLAY;
    const v = TOKEN.variants[`${APHRIS}@${statusKey(tier, elite)}`];
    const stats = (mod && v.byModule?.[mod]?.stats) || v.stats;
    const life = y3 ? 35 : 25, back = y3 ? 20 : 30, atk = y3 ? 0.35 : 0.25;
    assert.deepEqual([stats.respawnTime, stats.cost, r.base.respawnTime, r.base.blockCnt], [back, 3, back, 0], `${label(f)}: token data`);
    assert.equal(u.def.raw.talents.find((t) => t.index === 0).bb.atk, atk, `${label(f)}: talent`);
    assert.deepEqual([r.s.flags.untargetable, r.s.flags.invulnerable, r.s.flags.isolated, r.s.flags.noHeal], [true, true, true, true], `${label(f)}: flags`);
    h.run(0.1);
    approx(u.s.atk, u.base.atk * (1 + atk), `${label(f)}: ATK +${atk * 100} %`);
    h.run(life - 0.3);
    assert.ok(r.alive, `${label(f)}: still there before ${life} s`);
    const dp0 = h.b.players[0].dp;
    h.run(0.4);
    assert.ok(!r.alive && !r.removed, `${label(f)}: withdrawn after ${life} s, waiting`);
    h.step();
    approx(u.s.atk, u.base.atk, `${label(f)}: no bonus without it`);
    assert.deepEqual(sortN(u.rangeKeys), sortN(OWN.map(([a, b]) => K(a, b))), `${label(f)}: the straight line again`);
    h.run(back - 0.4);
    assert.ok(!r.alive, `${label(f)}: not before ${back} s`);
    h.run(0.6);
    assert.ok(r.alive && r.tileR === 9 && r.tileC === 4 && r.dir === 'UP', `${label(f)}: back on its tile`);
    approx(dp0 - h.b.players[0].dp, 3, `${label(f)}: 3 DP`);
    h.step();
    approx(u.s.atk, u.base.atk * (1 + atk), `${label(f)}: the bonus again`);
    done(h);
  }
});

test('T2 取样优化: every allied operator standing on her path — her own tile too — ignores 13 RES (法术穿透); none off it', () => {
  for (const f of FORMS_ALL) {
    const others = [{ uid: 3, chessId: 'chess_char_1_02_a', row: 10, col: 4 }, { uid: 4, chessId: 'chess_char_1_02_a', row: 9, col: 6 }];
    const { h, u } = field({ tier: f[0], elite: f[1], mod: f[2], skill: 1, relay: UP4, others });
    assert.equal(u.def.raw.talents.find((t) => t.index === 1).bb.magic_resist_penetrate_fixed, 13, label(f));
    h.run(0.3);
    assert.deepEqual([u.s.resIgnoreFlat, h.unit(3).s.resIgnoreFlat, h.unit(4).s.resIgnoreFlat], [13, 13, 0], `${label(f)}: herself, the one on the bent path, not the one on the straight line`);
    done(h);
  }
});

test('S1 连续映射 (AUTO, 持续时间无限 — the kit\'s SP_FULL: no enemy needed): at full SP (45 / 40); ATK +90 % / +120 %; a 中继器 whose time runs out stays', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, BLAY]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u, r } = field({ tier, elite, mod, skill: 0, relay: UP4 });
    assert.deepEqual([u.skill.rule, u.skill.kind, u.skill.spCost, sk.bb.atk], ['SP_FULL', 'toggle', elite ? 40 : 45, elite ? 1.2 : 0.9], `T${tier}`);
    h.run(sk.spCost - 1);
    assert.equal(u.skill.activations, 0, `T${tier}: not before full SP`);
    assert.ok(h.runUntil(() => u.skill.active, 2), `T${tier}: cast at full SP, no enemy on the field`);
    assert.equal(h.eventsOf('fx').some((e) => e[1] === 'beam' || e[1] === 'aphrisPath' || e[1] === 'aphrisHit'), false, `T${tier}: S1 is not the beam`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK (no 中继器 bonus: it withdrew at its time)`);
    // the piece back (cooldown), then its time runs out while 连续映射 runs: it stays
    h.runUntil(() => r.alive, 40);
    h.run((elite && tier === 6 ? 35 : 25) + 5);
    assert.ok(r.alive, `T${tier}: the 中继器 stays`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk + (elite && tier === 6 ? 0.35 : 0.25)), `T${tier}: both bonuses`);
    h.run(60);
    assert.deepEqual([u.skill.active, u.skill.activations], [true, 1], `T${tier}: infinite`);
    done(h);
  }
});

test('S2 临界瞬爆 (MANUAL, data DEFAULT, 8 s): no normal attack; from 0.167 s every 0.5 s the beam hits every enemy along an unbounded path — turned by her 中继器 and by any allied operator it reaches — for 90 % / 120 % ATK arts; 16 hits; her range is back after', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const others = [{ uid: 3, chessId: 'chess_char_1_02_a', row: 11, col: 4, dir: 'RIGHT' }];
    const { h, u } = field({ tier, elite, skill: 1, relay: UP4, others });
    assert.deepEqual([u.skill.rule, sk.duration, sk.bb.atk_scale, sk.bb.interval, u.skill.spCost], ['DEFAULT', 8, elite ? 1.2 : 0.9, 0.5, elite ? 20 : 22], `T${tier}`);
    const inPath = h.spawn('enemy_dummy', { pos: [10, 4] }), afterOp = h.spawn('enemy_fly', { pos: [11, 9] });
    const pastOp = h.spawn('enemy_dummy', { pos: [12, 4] }), straight = h.spawn('enemy_dummy', { pos: [9, 6] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 4), `T${tier}: cast`);
    // the beam: (9,2) → (9,4) 中继器 UP → (11,4) 角峰 RIGHT → the field's edge
    for (const [a, b] of [[10, 4], [11, 4], [11, 5], [11, 10], [11, 20]]) assert.ok(u.rangeKeySet.has(K(a, b)), `T${tier}: (${a}, ${b}) on the beam`);
    for (const [a, b] of [[12, 4], [9, 5], [9, 6]]) assert.ok(!u.rangeKeySet.has(K(a, b)), `T${tier}: (${a}, ${b}) off it`);
    const n0 = atkHits(h, u).length, cast = h.hooksOf('skillStart').at(-1).t;
    h.runUntil(() => !u.skill.active, 10);
    const endT = h.hooksOf('skillEnd').at(-1).t;
    const beam = tagged(h, u, 'aphris:beam');
    approx(beam[0].t - cast, 0.167, `T${tier}: the first hit after the Begin clip (0.167 s)`, 0.2);
    approx(beam.filter((c) => c.target === inPath)[1].t - beam[0].t, 0.5, `T${tier}: then every 0.5 s`, 0.07);
    for (const e of [inPath, afterOp]) {
      const mine = beam.filter((c) => c.target === e);
      assert.equal(mine.length, 16, `T${tier}: 16 beam hits on ${e.defId}`);
      approx(mine[0].amount, u.s.atk * sk.bb.atk_scale, `T${tier}: ${sk.bb.atk_scale * 100} % ATK`);
      assert.deepEqual([mine[0].type, mine[0].dmg.isAttack], ['arts', false], `T${tier}: arts, no normal attack`);
    }
    assert.ok(!beam.some((c) => c.target === pastOp || c.target === straight), `T${tier}: nothing off the beam`);
    assert.equal(atkHits(h, u).filter((c) => c.t < endT).length, n0, `T${tier}: no normal attack meanwhile`);
    assert.deepEqual(sortN(u.rangeKeys), sortN(BENT.map(([a, b]) => K(a, b))), `T${tier}: the bent 5-1 path again`);
    const fx = h.eventsOf('fx');
    const beams = fx.filter((e) => e[1] === 'beam');
    assert.equal(beams.length, 1, `T${tier}: one line at the cast`);
    assert.equal(beams[0][4].skill, 'aphris:beam');
    assert.deepEqual(beams[0][4].relays, [2], `T${tier}: the waypoint is the 中继器, not the ally bend`);
    assert.deepEqual(beams[0][4].path.slice(0, 6), [9, 2, 9, 3, 9, 4], `T${tier}: owner, then the relay tile`);
    const tiles = [];
    for (let i = 0; i < beams[0][4].path.length; i += 2) tiles.push([beams[0][4].path[i], beams[0][4].path[i + 1]]);
    assert.ok(tiles.some(([r, c]) => r === 11 && c === 4), `T${tier}: the ally bend is a corner of the same line`);
    assert.equal(fx.filter((e) => e[1] === 'aphrisPath').length, 0, `T${tier}: a stable path does not emit a second line`);
    const hits = fx.filter((e) => e[1] === 'aphrisHit');
    assert.equal(hits.length, 32, `T${tier}: one channel hit per damage that landed`);
    assert.ok(hits.every((e) => e[4].skill === 'aphris:beam' && (e[4].target === inPath.id || e[4].target === afterOp.id)));
    done(h);
  }
});

test('S3 混沌的本质 (MANUAL, data DEFAULT, 20 bullets): 3 s 强制缴械 from the cast, every 中继器 withdrawn and back at once; interval 2.9 → 1.8 s, ATK +95 % / +115 %, 140 % / 155 % + 停顿 0.2 / 0.4 s; past a 中继器 +25 % / +30 % ATK and 停顿 +0.2 / +0.4 s; no 中继器 withdraws until it ends, all do then and come back at once', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, BLAY]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u, r } = field({ tier, elite, mod, skill: 2, relay: UP4 });
    const atk = elite && tier === 6 ? 0.35 : 0.25;
    assert.deepEqual([u.skill.rule, u.skill.kind, u.skill.ammo, sk.bb.charge_time, sk.bb.base_attack_time, sk.bb.atk, sk.bb['attack@atk_scale'], sk.bb['attack@origin_sluggish'], sk.bb['attack@extra_atk_scale'], sk.bb['attack@extra_sluggish']],
      ['DEFAULT', 'ammo', 20, 3, -1.1, elite ? 1.15 : 0.95, elite ? 1.55 : 1.4, elite ? 0.4 : 0.2, elite ? 0.3 : 0.25, elite ? 0.4 : 0.2], `T${tier}`);
    const before = h.spawn('enemy_dummy', { pos: [9, 3] }), past = h.spawn('enemy_dummy', { pos: [11, 4] }), off = h.spawn('enemy_dummy', { pos: [9, 6] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 4), `T${tier}: cast`);
    assert.equal(h.eventsOf('fx').some((e) => e[1] === 'beam' || e[1] === 'aphrisPath'), false, `T${tier}: S3 is not the beam`);
    const t0 = h.hooksOf('skillStart').at(-1).t, n0 = atkHits(h, u).length;
    assert.ok(h.hooksOf('death').some((c) => c.unit === r && Math.abs(c.t - t0) < 1e-9), `T${tier}: the 中继器 withdrawn at the cast`);
    assert.ok(h.runUntil(() => r.alive, 0.5), `T${tier}: and back at once (redeploy time cleared)`);
    h.run(2.8 - (h.b.time - t0));
    assert.equal(atkHits(h, u).length, n0, `T${tier}: 强制缴械 3 s`);
    approx(u.s.interval, 1.8, `T${tier}: 1.8 s`);
    approx(u.s.atk, u.base.atk * (1 + atk + sk.bb.atk), `T${tier}: ATK`);
    h.runUntil(() => atkHits(h, u).length > n0, 1);
    const hits = atkHits(h, u).slice(n0);
    assert.ok(h.b.time - t0 >= 3 - 1e-6, `T${tier}: the first attack after 3 s`);
    assert.deepEqual(hits.map((c) => c.target.id).sort(), [before.id, past.id].sort(), `T${tier}: the bent path`);
    for (const c of hits) { approx(c.amount, u.s.atk * sk.bb['attack@atk_scale'], `T${tier}: ${sk.bb['attack@atk_scale'] * 100} %`); assert.equal(c.type, 'arts'); }
    assert.deepEqual(sortN(u.rangeKeys), sortN(BENT.map(([a, b]) => K(a, b))), `T${tier}: the bent 5-1 path while it runs`);
    const extra = tagged(h, u, 'aphris:relay');
    assert.deepEqual(extra.map((c) => c.target.id), [past.id], `T${tier}: the extra hit past the 中继器 only`);
    approx(extra[0].amount, u.s.atk * sk.bb['attack@extra_atk_scale'], `T${tier}: +${sk.bb['attack@extra_atk_scale'] * 100} % ATK`);
    const slow = (e) => h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish' && c.target === e).at(-1)?.duration;
    approx(slow(before), sk.bb['attack@origin_sluggish'], `T${tier}: 停顿 before it`);
    approx(slow(past), sk.bb['attack@origin_sluggish'] + sk.bb['attack@extra_sluggish'], `T${tier}: 停顿 past it`);
    assert.ok(!hits.some((c) => c.target === off));
    // its time runs out during the skill: it stays; all go when the skill ends — and come back at once (redeploy time
    // cleared again), with their normal time
    h.runUntil(() => !u.skill.active, 60);
    assert.equal(atkHits(h, u).filter((c) => c.dmg.isSkill).length, 2 * 20, `T${tier}: 20 bullets (2 targets each)`);
    const end = h.hooksOf('skillEnd').at(-1).t;
    assert.ok(end - t0 > (elite && tier === 6 ? 35 : 25), `T${tier}: it outlasted the piece's time`);
    assert.ok(h.hooksOf('death').some((c) => c.unit === r && Math.abs(c.t - end) < 1e-9), `T${tier}: withdrawn at the end`);
    assert.ok(h.runUntil(() => r.alive, 0.5), `T${tier}: back at once`);
    const back = h.b.time;
    h.run((elite && tier === 6 ? 35 : 25) + 0.5);
    assert.ok(h.hooksOf('death').some((c) => c.unit === r && c.t > back), `T${tier}: and withdraws at its time again`);
    done(h);
  }
});

test('BLA-Y “第三相态” (stages 1 and 3): the 部署费用 attribute (32 → 24); stage 3 only: 35 s 中继器, its redeploy time 30 → 20 s (再部署时间变短), ATK +35 %', () => {
  for (const tier of [5, 6]) {
    for (const mod of [null, BLAY]) {
      const { h, u, r } = field({ tier, elite: true, mod, relay: UP4 });
      assert.equal(u.base.cost, mod ? 24 : 32, `T${tier} ${mod}: cost`);
      const y3 = tier === 6 && mod === BLAY;
      assert.deepEqual(r.def.talents.map((t) => t.bb.duration), y3 ? [25, 35] : [25], `T${tier} ${mod}: the piece's talents`);
      assert.equal(r.base.respawnTime, y3 ? 20 : 30, `T${tier} ${mod}: redeploy time`);
      if (y3) assert.match(u.def.raw.talents.find((t) => t.index === 0).desc, /35秒.*再部署时间变短.*攻击力\+35%/);
      done(h);
    }
  }
});

test('链路协议: her 中继器 leaves the field with her (die_to_kill_token) and is back on its tile as soon as she is (charge_token[born]), not before', () => {
  const { h, u, r } = field({ tier: 6, elite: true, mod: BLAY, skill: 1, relay: UP4 });
  h.run(2);
  assert.ok(r.alive);
  const e = h.spawn('enemy_dummy', { pos: [9, 3] });
  h.b.dealDamage(e, u, { amount: 1e7, type: 'true' });
  assert.equal(u.alive, false, 'knocked out');
  assert.ok(!r.alive && !r.removed, 'the piece withdrawn with her');
  h.run(40);
  assert.ok(!r.alive, 'not while she is down (its redeploy time is long over)');
  h.runUntil(() => u.alive, 60);
  assert.ok(h.runUntil(() => r.alive, 0.5), 'back with her');
  assert.ok(r.tileR === 9 && r.tileC === 4 && r.dir === 'UP', 'on its tile');
  done(h);
});

test('谬因 searches by the tile of an enemy\'s position (PRTS 链路协议 备注 "索敌与攻击始终采用格子判定"), not by its 0.1 collider', () => {
  for (const [x, hit] of [[7.55, false], [7.45, true]]) {
    const { h, u } = field();
    assert.equal(u.profile.rangeTiles, true);
    const e = h.spawn('enemy_dummy', { pos: [9, 7] });
    e.x = x; e.y = 9;   // 7.55: on (9, 8), past her 5-1, while its collider overlaps (9, 7); 7.45: on (9, 7)
    h.step();
    e.x = x; e.y = 9;
    assert.equal(h.b.enemiesInKeys(u.rangeKeys, u, u.profile).includes(e), hit, `x ${x}`);
    h.run(3);
    assert.equal(atkHits(h, u).some((c) => c.target === e), hit, `x ${x}: attacked`);
    done(h);
  }
});
