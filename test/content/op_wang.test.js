// test/content/op_wang.test.js — the 自选 operator kit of 望 (char_2027_wang, 6★ 陷阱师; kit
// server/sim/content/kits/ops/op-wang.js) and of her summon 棋子 (token_10064_wang_stone1) with its 跟子, fielded the
// production way (a DIY slot + its `diy` pick, simdata getDiy; the 棋子 as placed hand pieces of her player) in every form:
// tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or TRP-X 兽形棋盒 at stage
// 1 (tier 5) / 3 (tier 6). Numbers from data/backups.json; the fidelity checklist of kits/README.md.
// Run: node --test test/content/op_wang.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks, diyRecord } from '../../shared/diy.js';
import { STONE } from '../../server/sim/content/kits/ops/op-wang.js';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { diyGameData } from '../../server/match/player/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const WANG = 'char_2027_wang';
const FORMS = BACKUPS.units[WANG].forms;
const TOKREC = BACKUPS.tokens[STONE];
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const X = 'uniequip_002_wang';
const S1 = 'skchr_wang_1', S2 = 'skchr_wang_2', S3 = 'skchr_wang_3';
const statusOf = (tier, elite) => (elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0');
const formOf = (tier, elite) => FORMS[statusOf(tier, elite)];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const talentOf = (tier, elite, mod, index) => modOf(tier, elite ? mod : null)?.talentChanges.find((t) => t.talentIndex === index) ?? formOf(tier, elite).talents.find((t) => t.index === index);
const tokOf = (tier, elite, skill, mod) => {
  let v = TOKREC.variants[`${WANG}@${statusOf(tier, elite)}`];
  if (v.bySkill?.[skill]) v = { ...v, ...v.bySkill[skill] };
  if (mod && v.byModule?.[mod]) v = { ...v, ...v.byModule[mod] };
  return v;
};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, speed: 0.6, mass: 0 }),
  enemy_runner: enemyRec({ key: 'enemy_runner', hp: 1e9, speed: 1, mass: 0 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, X].map((m) => [t, true, m]))];

/** 望 as uid 1 at (row, col) facing RIGHT; `stones` = the tiles of her placed 棋子 (uids 2, 3 …). */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 12, col = 3, stones = [], seed = 5, dp = 100, others = [] } = {}) {
  const op = { uid: 1, diy: { slot: SLOT[tier], charId: WANG, skillIndex: skill, uniEquipId: mod }, elite, row, col };
  const pieces = stones.map(([r, c], i) => ({ uid: 2 + i, kind: 'token', tokenId: STONE, ownerUid: 1, row: r, col: c }));
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'deploy', 'ammoUsed'], captureNoisy: true,
    units: [op, ...pieces, ...others],
  });
  h.b.players[0].dp = dp;
  h.step();
  const u = h.unit(1);
  return { h, u, st: h.b.allyUnits.filter((a) => a.kind === 'token' && a.defId === STONE) };
}
const at = (st, r, c) => st.find((s) => s.homeR === r && s.homeC === c);
/** The tiles [r, c] the 跟子 were placed on, in order (the kit's 'summon' fx with `follower`). */
const placed = (h) => h.eventsOf('fx').filter((e) => e[1] === 'summon' && e[4]?.follower).map((e) => [e[3], e[2]]);
const stoneHits = (h) => h.hooksOf('damaged').filter((c) => c.dmg.tags.includes('wang:stone'));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

test('望 in every 自选 form: her kit, stats + module attributes, 3-3, blocks 1, ranged physical hitting air, ground-targetable, 炎, no 特质; S1 / S2 SP_FULL, S3 the data\'s ACTIVE_RANGE; her 棋子: untargetable, no attack, the variant\'s cost / redeploy time and skill', () => {
  assert.equal(OPERATOR_KITS[WANG], KITS[WANG]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u, st } = field({ tier, elite, mod, skill, stones: [[9, 6]] });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [WANG, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.base.bat], [1, 'ranged', true, 'phys', 0.85], `${label(f)}: 陷阱师`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-3`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['yanShip'], []], `${label(f)}: bonds / 特质`);
      assert.equal(u.skill.rule, ['SP_FULL', 'SP_FULL', 'ACTIVE_RANGE'][skill], `${label(f)}: trigger`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: ground enemies target her`);
      const v = tokOf(tier, elite, skill, elite ? mod : null);
      const s = st[0];
      assert.ok(s.alive && s.deployed && s.ownerUnit === u, `${label(f)}: the 棋子 deploys with the board`);
      assert.deepEqual([s.base.cost, s.base.respawnTime, s.def.skill.id, !!s.s.flags.untargetable, s.s.blockCnt, !!s.profile.noAttack],
        [v.stats.cost, v.stats.respawnTime, v.skill.skillId, true, 0, true], `${label(f)}: 棋子`);
      assert.equal(s.base.cost, elite && mod === X ? 2 : 3, `${label(f)}: TRP-X 部署费用更低（-1）`);
      assert.deepEqual([v.stats.deployLimit], [elite && mod === X ? 8 : 7], `${label(f)}: TRP-X 可同时部署的陷阱数量提升（+1）`);
      done(h);
    }
  }
  assert.deepEqual(formOf(6, true).skills.map((s) => [s.skillType, s.trigger.rule]), [['AUTO', 'DEFAULT'], ['AUTO', 'DEFAULT'], ['MANUAL', 'ACTIVE_RANGE']]);
  assert.deepEqual([modOf(5, X).attr, modOf(6, X).attr], [{ maxHp: 100, atk: 36 }, { maxHp: 150, atk: 60 }]);
  const data = { chess: CHESS, backups: BACKUPS };
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(WANG), `tier ${t}`);
  assert.equal(validateDiyPicks({ [SLOT[6]]: { charId: WANG, skillIndex: 2, uniEquipId: X } }, { data, kitted: KITTED_CHARS }).ok, true);
});

test('铸子: the battle-start deployment of a placed 棋子 is its 手动部署 — one 跟子 next to it, so a lone 棋子 is live; with no free neighbour it never sets off; two side by side activate each other — an enemy (air too) on one sets it off and it is used up; it stays active once its partner is gone', () => {
  { // lone: its 跟子 上 of it (its neighbours are road, 下 is off the field) — they connect
    const { h, u, st } = field({ tier: 6, elite: true, skill: 1, stones: [[9, 6]] });
    assert.deepEqual(placed(h), [[10, 6]], 'the battle start drops one 跟子, 上 first among equal tiles');
    assert.equal(u.mem.wang.stock, 6, 'the 棋子 takes one of her 7; the 跟子 none');
    h.spawn('enemy_dummy', { pos: [9, 6] });
    h.step();
    assert.ok(!st[0].alive && stoneHits(h).length > 0, 'a lone 棋子 with its 跟子 sets off');
    done(h);
  }
  { // no free neighbour (operators on 上 / 右 / 左, 下 off the field): no 跟子, never sets off
    const others = [[10, 6], [9, 7], [9, 5]].map(([row, col], i) => ({ uid: 10 + i, chessId: 'chess_char_1_01_a', row, col }));
    const { h, st } = field({ tier: 6, elite: true, skill: 1, stones: [[9, 6]], others });
    assert.equal(placed(h).length, 0, 'nowhere to put it');
    h.spawn('enemy_dummy', { pos: [9, 6] });
    h.run(3);
    assert.equal(stoneHits(h).length, 0, 'a 棋子 with no partner');
    assert.ok(st[0].alive);
    done(h);
  }
  { // a pair: the flyer sets one off, the other stays active and takes the next
    const { h, st } = field({ tier: 6, elite: true, skill: 1, stones: [[9, 6], [9, 7]] });
    h.step();
    const a = at(st, 9, 6), b = at(st, 9, 7);
    assert.ok(a.mem.wangNode.act && b.mem.wangNode.act, 'connected ⇒ active');
    assert.deepEqual(placed(h), [[10, 6], [10, 7]], 'the battle start drops one 跟子 上 of each');
    const fl = h.spawn('enemy_fly', { pos: [9, 7] });
    h.step();
    assert.ok(!b.alive && a.alive, 'the flyer set off its 棋子, which is used up');
    assert.ok(stoneHits(h).some((c) => c.target === fl), 'air units are hit');
    h.b.kill(fl, null);
    const n0 = stoneHits(h).length;
    h.spawn('enemy_dummy', { pos: [9, 6] });
    h.step();
    assert.ok(!a.alive && stoneHits(h).length > n0, 'still active without its partner');
    done(h);
  }
});

test('铸子: a spent 棋子 comes back on its tile 2 s later for its cost (TRP-X: 2 DP), not while a ground enemy stands there, not while 望 is away; each return drops one 跟子 next to it in the PRTS order (enemy tile, undeployable ground, ground, 高台; 上 右 下 左)', () => {
  for (const mod of [null, X]) {
    const { h, u, st } = field({ tier: 6, elite: true, mod, skill: 1, stones: [[10, 6], [10, 7]], dp: 50 });
    const b = at(st, 10, 7);
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.step();
    assert.ok(!b.alive, 'set off');
    h.run(3);
    assert.ok(!b.alive, 'a ground enemy stands on its tile');
    h.b.kill(e, null);
    const dp0 = h.b.players[0].dp;
    assert.ok(h.runUntil(() => b.alive, 1), 'back');
    approx(h.b.players[0].dp, dp0 - (mod === X ? 2 : 3), `${mod ?? 'none'}: its cost`);
    // the battle start dropped one 跟子 上 of each (equal road tiles: 上 > 右 > 下 > 左); the return of (10,7) finds its 上
    // (11,7) taken by its own and (10,6) by the other 棋子, so 右 (10,8)
    assert.deepEqual(placed(h), [[11, 6], [11, 7], [10, 8]], `${mod ?? 'none'}: 上 at the battle start, then 右`);
    assert.equal(u.mem.wang.followers.length, 3);
    done(h);
  }
  { // an enemy tile first; undeployable ground before deployable ground
    const { h, u, st } = field({ tier: 6, elite: true, skill: 1, stones: [[10, 9], [11, 9]], dp: 50 });
    const b = at(st, 10, 9);
    h.spawn('enemy_dummy', { pos: [10, 9] });
    h.step();
    assert.ok(!b.alive);
    h.b.kill(h.b.enemies.find((x) => x.alive), null);
    // the battle start: (11,9) deploys first (a column top to bottom) — its 右 (11,10) is undeployable floor, before its
    // road 上; then (10,9) takes its floor 右 (10,10)
    assert.deepEqual(placed(h), [[11, 10], [10, 10]], '不可部署地块 > 可部署地面地块 (before 上)');
    const fl = h.spawn('enemy_fly', { pos: [9, 9] });   // 下 of (10,9) holds an enemy (a flyer: no block on the trap rule)
    assert.ok(h.runUntil(() => b.alive, 3), 'back (a flyer does not stop it)');
    assert.deepEqual(placed(h)[2], [9, 9], 'the return: the enemy tile first');
    h.step();
    assert.ok(h.hooksOf('damaged').some((c) => c.target === fl && c.source === u && c.dmg.tags.includes('wang:stone')), 'the 跟子 sets off at once — its damage is 望\'s');
    assert.equal(u.mem.wang.followers.length, 2, 'the two on the floor stay; the one on the flyer is spent');
    done(h);
  }
  { // a return with no enemy around: undeployable ground (10,10) before the road
    const { h, u, st } = field({ tier: 6, elite: true, skill: 1, stones: [[10, 9], [11, 9]], dp: 50 });
    const b = at(st, 10, 9);
    const e = h.spawn('enemy_dummy', { pos: [10, 9] });
    h.step();
    h.b.kill(e, null);
    u.mem.wang.followers.length = 0;   // (the battle start's 跟子 gone: the floor beside it is free again)
    const n0 = placed(h).length;
    assert.ok(h.runUntil(() => b.alive, 3));
    assert.deepEqual(placed(h).slice(n0), [[10, 10]], '不可部署地块 > 可部署地面地块');
    done(h);
  }
  { // a 跟子 on the tile of a piece still to come at the battle start goes when that piece deploys there ("跟子所在格进行部署…
    // 时，该跟子会随之消失"): (10,3)'s 上 holds an operator, so its 跟子 takes 右 (10,4) — the next 棋子's tile —, which
    // deploys there and drops its own 上 (11,4)
    const { h, u } = field({ tier: 6, elite: true, skill: 1, stones: [[10, 3], [10, 4]], others: [{ uid: 10, chessId: 'chess_char_1_01_a', row: 11, col: 3 }] });
    assert.deepEqual(placed(h), [[10, 4], [11, 4]]);
    assert.deepEqual(u.mem.wang.followers.map((f) => [f.r, f.c]), [[11, 4]], 'the one on (10,4) is gone');
    assert.ok(h.eventsOf('fx').some((e) => e[1] === 'disappear' && e[2] === 4 && e[3] === 10), 'it vanishes');
    done(h);
  }
  { // 望 away ⇒ her 棋子 leave and wait for her; her 跟子 are gone
    const { h, u, st } = field({ tier: 6, elite: true, skill: 1, stones: [[10, 6], [10, 7]], dp: 200 });
    u.mem.wang.followers.push({ r: 11, c: 6, seq: 99, act: false, h: false, v: false, stacks: 0, follower: true });
    h.b.retreat(u);
    assert.ok(st.every((s) => !s.alive), 'they vanish with her');
    assert.equal(u.mem.wang.followers.length, 0);
    h.run(5);
    assert.ok(st.every((s) => !s.alive), 'not back while she is away');
    h.b.redeploy(u);
    assert.ok(h.runUntil(() => st.every((s) => s.alive), 2), 'back with her');
    done(h);
  }
});

test('料敌机先: a line of 2 pieces ⇒ 2 stacks (+24 % damage, 20 RES ignored), a line of 3 or more ⇒ 3 (the cap); TRP-X stage 3: 15 % / 13 per stack', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const tb = talentOf(tier, elite, mod, 1).bb;
    assert.deepEqual([tb['attack@per_atk_scale'], tb['attack@per_magic_resist_penetrate_fixed'], tb['attack@max_trigger_cnt']],
      elite && tier === 6 && mod === X ? [0.15, 13, 3] : [0.12, 10, 3], label(f));
    const sk = skillOf(tier, elite, S2);
    for (const [line, stacks] of [[[[10, 5], [10, 6]], 2], [[[10, 4], [10, 5], [10, 6], [10, 7]], 3]]) {
      const { h, u, st } = field({ tier, elite, mod, skill: 1, stones: line });
      h.step();
      for (const s of st) assert.equal(s.mem.wangNode.stacks, stacks, `${label(f)}: ${line.length} in a line`);
      const e = h.spawn('enemy_dummy', { pos: [10, 5] });
      h.b.addBuff(e, { key: 'test:res', mods: { resFlat: 50 } });
      h.step();
      const hit = stoneHits(h).find((c) => c.target === e);
      const res = Math.max(0, 50 - tb['attack@per_magic_resist_penetrate_fixed'] * stacks);
      approx(hit.amount, u.s.atk * sk.bb['attack@atk_scale'] * (1 + tb['attack@per_atk_scale'] * stacks) * (1 - res / 100), `${label(f)}: ×(1 + ${stacks} × per), ${stacks} × pen`, 1e-4);
      done(h);
    }
  }
});

test('S1 取势 (AUTO, SP_FULL): the triggering enemy is 停顿 6.5 s and takes 105 % / 120 % of 望\'s ATK as 法术 every second for 6.5 s (6 ticks, 无来源 credited to her, independent); the active +2 棋子 (≤ 8) and 阻回 at the cap', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.spCost, sk.bb.cnt, sk.bb['attack@atk_scale'], sk.bb['attack@sluggish']], elite ? [20, 2, 1.2, 6.5] : [21, 2, 1.05, 6.5], `T${tier}`);
    const { h, u, st } = field({ tier, elite, skill: 0, stones: [[10, 6], [10, 7]] });
    // her stock: 7 less the 2 placed 棋子 (the owner's decision of 2026-10-06 — see the stock test below)
    assert.deepEqual([u.skill.kind, u.skill.rule, u.mem.wang.stock], ['instant', 'SP_FULL', 5]);
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.step();
    const slug = h.hooksOf('statusApplied').find((c) => c.target === e && c.status === 'sluggish');
    assert.ok(slug && slug.source === u, `T${tier}: 停顿 from 望`);
    approx(slug.duration, sk.bb['attack@sluggish'], `T${tier}: 6.5 s`);
    h.run(7);
    const ticks = h.hooksOf('damaged').filter((c) => c.target === e && c.dmg.tags.includes('wang:qushi'));
    assert.equal(ticks.length, 6, `T${tier}: one per second`);
    for (const c of ticks) {
      assert.deepEqual([c.source, c.credit, c.type], [null, u, 'arts'], `T${tier}: 无来源 arts credited to her`);
      approx(c.amount, u.s.atk * sk.bb['attack@atk_scale'] * (1 + 0.12 * 2), `T${tier}: precomputed with 2 stacks`, 1e-4);
    }
    // independent: two triggers ⇒ two DoTs ticking together
    h.b.kill(e, null);
    assert.ok(h.runUntil(() => st.every((s) => s.alive), 5), `T${tier}: back once the tile is clear`);
    const e2 = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.step();
    e2.x = 6; e2.y = 10;   // onto the other (still active) 棋子
    h.step();
    h.step();
    assert.equal(e2.buffs.filter((b) => b.key === 'wang:qushi').length, 2, `T${tier}: independent`);
    // the active part: +2 stock (7 → 8: the cap — both pieces are off the field, their cards back in her hand), then 阻回
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), `T${tier}: cast at full SP`);
    assert.equal(u.mem.wang.stock, 8, `T${tier}: 最多拥有8枚`);
    h.step();
    assert.ok(u.s.flags.noSp, `T${tier}: 阻回 at the cap`);
    done(h);
  }
});

test('her stock (the owner\'s decision of 2026-10-06): the placed 棋子 occupy it like ones she deployed; a 棋子 that goes off goes back into it at once and its return takes one again; at the cap one that goes off is lost to the cap, so 阻回 lifts with its return and S1 / S2 keep casting', () => {
  for (const skill of [0, 1]) {
    const S = `S${skill + 1}`;
    const { h, u, st } = field({ tier: 6, elite: true, skill, stones: [[10, 6], [10, 7]] });
    const w = u.mem.wang;
    assert.equal(w.stock, 7 - 2, `${S}: 7 less the 2 placed`);
    const a = at(st, 10, 6), b = at(st, 10, 7);
    let e = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.step();
    assert.ok(!b.alive, `${S}: set off`);
    assert.equal(w.stock, 6, `${S}: its card is back in her stock at once`);
    h.b.kill(e, null);
    assert.ok(h.runUntil(() => b.alive, 5), `${S}: back on its tile`);
    assert.equal(w.stock, 5, `${S}: its return takes one`);
    // two casts: 5 → 7 → 8 (9, over the cap); 阻回 at the cap only
    u.skill.gainSp(999);
    h.step();
    assert.deepEqual([u.skill.activations, w.stock], [1, 7], `${S}: 立即获得两枚棋子`);
    h.step();
    assert.ok(!u.s.flags.noSp, `${S}: below the cap, no 阻回`);
    assert.ok(u.skill.nextCastAt > h.b.time, `${S}: the next cast waits one attack interval (GitHub #298)`);
    h.run(u.skill.nextCastAt - h.b.time);           // wait it out
    u.skill.gainSp(999);
    h.step();
    assert.deepEqual([u.skill.activations, w.stock], [2, 8], `${S}: 最多拥有8枚`);
    h.step();
    assert.ok(u.s.flags.noSp, `${S}: 阻回 at the cap`);
    const sp0 = u.skill.sp;
    h.run(2);
    assert.equal(u.skill.sp, sp0, `${S}: no SP under 阻回`);
    // at the cap: the piece that goes off is lost to the cap, its return takes one ⇒ 阻回 lifts, SP comes back
    e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.step();
    assert.ok(!a.alive, `${S}: set off at the cap`);
    assert.equal(w.stock, 8, `${S}: still the cap`);
    h.b.kill(e, null);
    assert.ok(h.runUntil(() => a.alive, 5), `${S}: back`);
    assert.equal(w.stock, 7, `${S}: its return took one`);
    h.step();
    assert.ok(!u.s.flags.noSp, `${S}: 阻回 lifted`);
    const sp1 = u.skill.sp;
    h.run(2);
    assert.ok(u.skill.sp > sp1, `${S}: her SP recovers again`);
    done(h);
  }
  // TRP-X: 8 placed 棋子 (its deploy limit) on a stock of 7 ⇒ 0, never below
  const { h, u, st } = field({ tier: 6, elite: true, mod: X, skill: 0, stones: [[10, 3], [10, 4], [10, 5], [10, 6], [10, 7], [10, 8], [10, 9], [11, 5]] });
  assert.ok(st.length === 8 && st.every((s) => s.alive), 'TRP-X: all 8 deploy');
  assert.equal(u.mem.wang.stock, 0, 'TRP-X: 8 placed on a stock of 7');
  done(h);
});

test('S2 连星 (AUTO, SP_FULL): a triggered piece hits every enemy on its connected lines (its tile ± 3; air too) for 420 % / 480 % ATK arts and slows them 35 % / 40 % for 6 s — each slow on its own timer, added up, speed ≥ 0.1', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.spCost, sk.bb['attack@atk_scale'], sk.bb['attack@move_speed'], sk.bb['attack@duration']], elite ? [16, 4.8, -0.4, 6] : [17, 4.2, -0.35, 6], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 1, stones: [[10, 6], [10, 7]] });
    const onLine = h.spawn('enemy_fly', { pos: [10, 9] });       // 3 tiles right of (10,6)…(10,7)+2: on the horizontal line
    const beyond = h.spawn('enemy_dummy', { pos: [10, 2] });     // 4 tiles before (10,6) (the field ends at column 10)
    const vertical = h.spawn('enemy_dummy', { pos: [12, 7] });   // its battle-start 跟子 (11,7) is 上 of it: the vertical line is on
    const off = h.spawn('enemy_dummy', { pos: [9, 4] });         // on neither line
    const trig = h.spawn('enemy_runner', { pos: [10, 7] });
    h.b.applyStatus(trig, 'stun', { duration: 99, force: true });   // it stays on the tile (the slow is read off its speed stat)
    h.step();
    const hit = stoneHits(h);
    const victims = new Set(hit.map((c) => c.target));
    assert.ok(victims.has(trig) && victims.has(onLine) && victims.has(vertical), `T${tier}: the lines, air included`);
    assert.ok(!victims.has(beyond) && !victims.has(off), `T${tier}: not beyond ± 3 / off the line`);
    for (const c of hit.filter((x) => x.target === trig)) approx(c.amount, u.s.atk * sk.bb['attack@atk_scale'] * 1.24, `T${tier}: 2 stacks`, 1e-4);
    const slow = trig.findBuff('wang:slow');
    approx(trig.s.moveSpeed, trig.base.moveSpeed * (1 + sk.bb['attack@move_speed']), `T${tier}: slowed`);
    // a second slow 3 s later adds up and keeps its own timer
    h.run(3);
    slow.data.list.push({ v: sk.bb['attack@move_speed'], until: h.b.time + 6 });
    h.step();
    approx(trig.s.moveSpeed, trig.base.moveSpeed * (1 + 2 * sk.bb['attack@move_speed']), `T${tier}: two add up`, 1e-3);
    h.run(3.1);
    approx(trig.s.moveSpeed, trig.base.moveSpeed * (1 + sk.bb['attack@move_speed']), `T${tier}: the first ended`, 1e-3);
    for (let i = 0; i < 5; i++) slow.data.list.push({ v: sk.bb['attack@move_speed'], until: h.b.time + 6 });
    h.step();
    approx(trig.s.moveSpeed, 0.1, `T${tier}: speed floor 0.1`, 1e-3);
    done(h);
  }
});

test('S3 天下劫 (MANUAL, ACTIVE_RANGE 4-12, 20 bullets): passive — the pieces set off and hit on x-6 (290 % / 320 %); active — no attacks, range 4-12, +8 棋子 with the overflow placed as 跟子 on the enemies of her range first; returns inside it drop 3 跟子 for 3 bullets; it ends with the last bullet', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const v = tokOf(tier, elite, 2, null);
    assert.deepEqual([sk.spCost, sk.initSp, sk.bb.cnt, sk.bb.trigger_time, sk.bb.atk_scale, sk.rangeId, v.skill.rangeId], elite ? [54, 38, 8, 20, 3.2, '4-12', 'x-6'] : [57, 38, 8, 20, 2.9, '4-12', 'x-6'], `T${tier}`);
    { // passive: x-6 trigger and damage
      const { h, u, st } = field({ tier, elite, skill: 2, stones: [[10, 6], [10, 7]] });
      const e = h.spawn('enemy_dummy', { pos: [10, 9] });            // 2 tiles right of (10,7): x-6
      const fl = h.spawn('enemy_fly', { pos: [12, 7] });             // 2 tiles up of (10,7)
      const diag = h.spawn('enemy_dummy', { pos: [11, 8] });         // diagonal: not x-6
      h.step();
      const hit = stoneHits(h);
      assert.ok(hit.some((c) => c.target === e) && hit.some((c) => c.target === fl), `T${tier}: x-6, air too`);
      assert.ok(!hit.some((c) => c.target === diag && c.source === at(st, 10, 7)), `T${tier}: (10,7)'s area`);
      for (const c of hit.filter((x) => x.target === e)) approx(c.amount, u.s.atk * sk.bb.atk_scale * 1.24, `T${tier}: ${sk.bb.atk_scale * 100} %, 2 stacks`, 1e-4);
      done(h);
    }
    { // active
      const { h, u } = field({ tier, elite, skill: 2, row: 10, col: 3, stones: [[11, 6], [11, 7]], dp: 300 });
      u.skill.gainSp(999);
      h.run(1);
      assert.equal(u.skill.activations, 0, `T${tier}: nobody in 4-12`);
      const a = h.spawn('enemy_dummy', { pos: [9, 5] }), b = h.spawn('enemy_dummy', { pos: [10, 7] });
      assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: an enemy inside 4-12 casts it`);
      assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: 4-12`);
      assert.equal(u.skill.attackOverride()?.noAttack, true, `T${tier}: 停止攻击`);
      assert.equal(u.mem.wang.stock, 8, `T${tier}: +8, capped`);
      const fl = placed(h).map(([r, c]) => `${r},${c}`);
      assert.deepEqual(fl.slice(0, 2), ['12,6', '12,7'], `T${tier}: the battle start's 跟子, 上 of each (${fl})`);
      assert.equal(fl.length, 7, `T${tier}: then (7 − 2 placed) + 8 − 8 over the cap`);
      assert.deepEqual(fl.slice(2, 4).sort(), ['10,7', '9,5'], `T${tier}: the overflow on the enemies' tiles first (${fl})`);
      assert.ok(h.hooksOf('damaged').some((c) => c.target === a && c.source === u && c.dmg.tags.includes('wang:stone')), `T${tier}: they set off`);
      // inside her range a 棋子 comes back onto an enemy ("可部署至敌人所在位置") — and sets off again
      h.b.kill(a, null); h.b.kill(b, null);
      u.mem.wang.followers.length = 0;
      const stay = h.spawn('enemy_dummy', { pos: [11, 7] });
      h.step();
      const back = h.hooksOf('deploy').filter((c) => c.unit.defId === STONE).length;
      h.run(2.5);
      assert.ok(h.hooksOf('deploy').filter((c) => c.unit.defId === STONE).length > back, `T${tier}: back on the enemy's tile during S3`);
      h.b.kill(stay, null);
      // the bullets: returns inside her range drop 3 跟子 each for 3 bullets — until none is left
      u.mem.wang.followers.length = 0;
      let guard = 0;
      while (u.skill.active && guard++ < 40) {
        const e = h.spawn('enemy_dummy', { pos: [11, 7] });
        h.step();
        h.b.kill(e, null);
        u.mem.wang.followers.length = 0;
        h.run(2.5);
      }
      assert.ok(!u.skill.active, `T${tier}: ends`);
      const used = h.hooksOf('ammoUsed').filter((c) => c.unit === u);
      assert.ok(used.length >= 4 && used[used.length - 1].left === 0, `T${tier}: the 20 bullets spent`);
      assert.ok(!u.skill.attackOverride(), `T${tier}: attacks again`);
      done(h);
    }
  }
});

test('S3 天下劫: the overflow 跟子 take her range by the 铸子 order (S3 备注 "采用相同的位置选择优先顺序") — enemy tiles first, an enemy on undeployable floor before one on the road her target order puts first, then the floor', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2, row: 10, col: 6, stones: [[11, 4], [11, 5]], dp: 300 });
  assert.deepEqual(placed(h), [[12, 4], [12, 5]], 'the battle start');
  u.skill.gainSp(999);
  h.spawn('enemy_dummy', { pos: [10, 10] });   // on tile_floor
  h.spawn('enemy_dummy', { pos: [10, 8] });    // on the road, nearer the goal
  assert.ok(h.runUntil(() => u.skill.active, 2));
  const fl = placed(h).slice(2).map(([r, c]) => `${r},${c}`);
  assert.deepEqual(fl, ['10,10', '10,8', '9,10', '11,10', '12,10'], `(7 − 2) + 8 − 8 = 5: the enemies' tiles by class, then the undeployable tiles (${fl})`);
  done(h);
});

test('the hand: deploying her in prep brings 7 棋子 (TRP-X "可同时部署的陷阱数量提升": 8) — the match\'s data view reads the module variant\'s deploy limit', () => {
  const gd = new GameData(getData({ log: { warn() {}, error() {}, info() {} } }), 'mode_multi_hard');
  const data = { chess: CHESS, backups: BACKUPS };
  for (const [tier, elite, mod, n] of [[5, false, null, 7], [6, false, null, 7], [5, true, null, 7], [6, true, null, 7], [5, true, X, 8], [6, true, X, 8]]) {
    const slot = elite ? SLOT[tier].replace(/_a$/, '_b') : SLOT[tier];
    const rec = diyRecord(SLOT[tier], { charId: WANG, skillIndex: 1, uniEquipId: mod }, { elite, data });
    const view = diyGameData(gd, new Map([[slot, rec]]));
    assert.deepEqual(view.placeableTokens(slot, { skillIndex: 1, moduleId: elite ? mod : null }), [{ tokenId: STONE, count: n }], `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`);
  }
});

test('the 棋子 is a 装置 (PRTS 实体类型): 活性源石 does not act on it — 战场#04 (11, 6) — while an operator on its neighbour 活性源石 tile takes the effect (community report 2026-11-14 「望的棋子会被烫死」, §37.205)', () => {
  const op = { uid: 1, diy: { slot: SLOT[6], charId: WANG, skillIndex: 0, uniEquipId: null }, elite: true, row: 12, col: 2 };
  const h = makeBattle({
    stageId: 'act1autochess_m04', defs: { enemies: ENEMIES }, timeLimit: 120, autoFinish: false, seed: 5,
    flags: { dpPerSec: 0, dpMax: 999 },
    units: [op, { uid: 2, kind: 'token', tokenId: STONE, ownerUid: 1, row: 11, col: 6 }, { uid: 3, chessId: 'chess_char_1_01_a', row: 10, col: 6 }],
  });
  h.b.players[0].dp = 100;
  h.step();
  assert.ok(h.unit(1).deployed, '望 on the field');
  const stone = h.b.allyUnits.find((a) => a.kind === 'token' && a.defId === STONE && a.homeR === 11 && a.homeC === 6);
  assert.equal(stone.mem.terrainImmune, true);
  h.run(3);
  assert.ok(h.unit(3).findBuff('terrain:infection'), 'an operator on 活性源石 takes it (the control)');
  assert.ok(!stone.findBuff('terrain:infection'), 'not the 棋子');
  h.run(17);
  assert.ok(stone.alive && stone.deployed, 'the 棋子 still stands after 20 s');
  assert.ok(!stone.findBuff('terrain:infection'));
  assert.equal(stone.hp, stone.s.maxHp, 'no HP lost (70 true damage a second had burned 1000 HP down in ~15 s)');
  done(h);
});
