// test/content/op_wisdel.test.js — the 自选 operator kit of 维什戴尔 (char_1035_wisdel, 6★ 投掷手; kit
// server/sim/content/kits/ops/op-wisdel.js) and of her summon “魂灵之影” (token_10035_wisdel_wward), fielded the production
// way (a DIY slot + its `diy` pick, simdata getDiy) in every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module)
// and elite (E2 Lv60, rank 7) with no module or BOM-X “‘祖宗发射器’” at stage 1 (tier 5) / 3 (tier 6). Every number is read
// back from data/backups.json (the form of that slot status); the fidelity checklist of kits/README.md.
// Run: node --test test/content/op_wisdel.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const WD = 'char_1035_wisdel';
const SHADOW = 'token_10035_wisdel_wward';
const FORMS = BACKUPS.units[WD].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const BOM = 'uniequip_002_wisdel';
const S1 = 'skchr_wisdel_1', S2 = 'skchr_wisdel_2', S3 = 'skchr_wisdel_3';
const statusOf = (tier, elite) => (elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0');
const formOf = (tier, elite) => FORMS[statusOf(tier, elite)];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const shadowOf = (tier, elite) => BACKUPS.tokens[SHADOW].variants[`${WD}@${statusOf(tier, elite)}`];
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }), enemy_atk: dummy('enemy_atk', { atk: 100, range: 3 }) };
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, BOM].map((m) => [t, true, m]))];

/** 维什戴尔 as uid 1 at (10, 4) facing RIGHT (3-9: rows 8–12; (10, 4..8), (9 / 11, 4..7), (8 / 12, 4..6)). */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 4, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 1200, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'deploy', 'heal'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: WD, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const from = (h, src) => h.hooksOf('damaged').filter((c) => c.source === src);
const on = (h, e) => h.hooksOf('damaged').filter((c) => c.target === e);
const shadowsOf = (h, u) => h.b.allyUnits.filter((t) => t.kind === 'token' && t.defId === SHADOW && t.ownerUnit === u);
const tag = (c, t) => !!c.dmg.tags?.includes(t);
const markKey = (u) => `wisdel:mark:${u.id}`;
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
const t0Of = (tier, elite, mod) => (elite && mod === BOM && tier === 6 ? modOf(6, BOM).talentChanges[0].bb : formOf(tier, elite).talents[0].bb);

test('维什戴尔 in every 自选 form: her kit (all three skills authored), the form\'s stats + module attributes, 3-9, 投掷手 (ground-only 0.9 splash, never air), blocks 1, the data triggers, a 魂灵之影 beside her at once; offered as a pick', () => {
  assert.equal(OPERATOR_KITS[WD], KITS[WD]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [WD, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res, u.base.aspd], [form.stats.maxHp, form.stats.atk + (m?.attr.atk ?? 0), form.stats.def, form.stats.res, 100 + (m?.attr.aspd ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.groundOnly, u.profile.dmgType, u.base.bat, u.profile.splashRadius, u.profile.sub],
        [1, 'ranged', false, true, 'phys', 2.1, 0.9, 'bombarder'], `${label(f)}: 投掷手`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-9`);
      assert.equal(u.skill.rule, form.skills[skill].trigger.rule, `${label(f)}: the data's trigger`);
      const sh = shadowsOf(h, u);
      assert.deepEqual(sh.map((t) => [t.tileR, t.tileC]), [[9, 4]], `${label(f)}: a shadow on the nearest free tile of her range (lower row first)`);
      assert.ok(u.s.flags.camou && !u.s.flags.liftoff && !u.s.flags.stealth, `${label(f)}: 迷彩 beside it, ground-targetable otherwise`);
      done(h);
    }
  }
  assert.deepEqual(formOf(6, true).skills.map((s) => [s.skillType, s.trigger.rule, s.trigger.rawRule]), [['AUTO', 'DEFAULT', 'DEFAULT'], ['MANUAL', 'DEFAULT', 'DEFAULT'], ['MANUAL', 'SP_FULL', 'ALWAYS']]);
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [1434, 615, 1735, 684]);
  assert.deepEqual([modOf(5, BOM).attr, modOf(6, BOM).attr], [{ atk: 45, aspd: 5 }, { atk: 65, aspd: 7 }]);
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(WD) && [5, 6].every((t) => diyPool(t, { data, kitted: KITTED_CHARS }).includes(WD)));
  assert.equal(validateDiyPicks({ [SLOT[6]]: { charId: WD, skillIndex: 2, uniEquipId: BOM } }, { data, kitted: KITTED_CHARS }).ok, true);
});

test('trait 投掷手 + T1 好礼: the main target ×1.15 (BOM-X stage 3 ×1.25), the 0.9 splash in full, then 0.3 s later an aftershock at 50 % ATK on the spot (×1.15 on the main one); BOM-X: two; flyers never hit; her 残影 on the main target', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const t0 = t0Of(tier, elite, mod);
    const shocks = elite && mod ? 2 : 1;
    assert.deepEqual([t0['attack@main_atk_scale'], t0['attack@bomb_atk_scale']], elite && mod === BOM && tier === 6 ? [1.25, 1.85] : [1.15, 1.6], label(f));
    assert.equal(formOf(tier, elite).trait.bb['attack@append_atk_scale'], 0.5, label(f));
    if (elite && mod) assert.equal(modOf(tier, mod).traitOverride.bb['attack@enable_third_attack'], 1, label(f));
    const { h, u } = field({ tier, elite, mod, skill: 1, seed: 21 });
    const main = h.spawn('enemy_dummy', { pos: [10, 8] });
    const sp = h.spawn('enemy_dummy', { pos: [10, 8.85] });   // 0.85: her splash, outside her range
    const out = h.spawn('enemy_dummy', { pos: [11, 8.75] });  // √(1 + 0.5625) = 1.25
    const fly = h.spawn('enemy_fly', { pos: [9, 8] });          // in her range, an air unit
    assert.ok(h.runUntil(() => on(h, main).length > 0, 4), `${label(f)}: an attack`);
    const t = h.b.time;
    h.run(0.8);
    const atk = u.s.atk;
    const ms = t0['attack@main_atk_scale'];
    const plain = (c) => !tag(c, 'wisdel:bomb');
    const first = from(h, u).filter((c) => plain(c) && c.t <= t + 1e-9);
    assert.deepEqual(new Set(first.map((c) => c.target)), new Set([main, sp]), `${label(f)}: the main target and the splash`);
    approx(first.find((c) => c.target === main).amount, atk * ms, `${label(f)}: main ×${ms}`);
    approx(first.find((c) => c.target === sp).amount, atk, `${label(f)}: splash in full`);
    const shockHits = from(h, u).filter((c) => plain(c) && tag(c, 'aftershock') && c.t <= t + 0.75);
    assert.equal(shockHits.filter((c) => c.target === main).length, shocks, `${label(f)}: ${shocks} aftershock(s)`);
    for (const c of shockHits) approx(c.amount, atk * 0.5 * (c.target === main ? ms : 1), `${label(f)}: 50 %`);
    assert.ok(Math.abs(shockHits[0].t - t - 0.3) < 0.04, `${label(f)}: 0.3 s later`);
    assert.deepEqual([on(h, out).length, on(h, fly).length], [0, 0], `${label(f)}: 1.25 away and the flyer untouched`);
    assert.ok(main.findBuff(markKey(u)) || on(h, main).some((c) => tag(c, 'wisdel:bomb')), `${label(f)}: marked (or the mark went off)`);
    done(h);
  }
});

test('T1 好礼: each aftershock on a marked enemy goes off 15 % of the time — 160 % (185 %) ATK physical to every enemy within 1.1, air too, stun 1 s, the mark spent; the 残影 leave with her', () => {
  for (const f of [[5, false, null], [6, true, BOM]]) {
    const [tier, elite, mod] = f;
    const t0 = t0Of(tier, elite, mod);
    const { h, u } = field({ tier, elite, mod, skill: 1, seed: 33 });
    const main = h.spawn('enemy_dummy', { pos: [10, 8] });
    const fly = h.spawn('enemy_fly', { pos: [10, 9] });   // 1.0 from the main target: only the explosion reaches it
    h.run(400);
    const bombs = from(h, u).filter((c) => tag(c, 'wisdel:bomb') && c.target === main);
    const rolls = from(h, u).filter((c) => tag(c, 'aftershock') && c.target === main).length;
    assert.ok(rolls > 150, `${label(f)}: ${rolls} rolls`);
    const r = bombs.length / rolls;
    assert.ok(r > 0.09 && r < 0.21, `${label(f)}: ${bombs.length} / ${rolls} ≈ 15 %`);
    for (const c of bombs) assert.equal(c.type, 'phys', label(f));
    const flyBombs = on(h, fly).filter((c) => tag(c, 'wisdel:bomb'));
    assert.equal(flyBombs.length, bombs.length, `${label(f)}: the flyer 1.0 away takes every explosion`);
    assert.equal(on(h, fly).length, flyBombs.length, `${label(f)}: and nothing else`);
    const stuns = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'stun' && c.target === fly);
    assert.equal(stuns.length, bombs.length, `${label(f)}: each explosion stuns`);
    for (const c of stuns) approx(c.duration, t0['attack@stun'], `${label(f)}: 1 s`);
    // the amounts: her ATK × bomb_atk_scale (the explosion is no attack: no ×main)
    h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } });
    h.run(2);
    main.buffs = main.buffs.filter((b) => b.key !== markKey(u));
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.b.addBuff(e, { key: markKey(u), source: u });
    h.b.removeBuff(u, 'test:disarm');
    assert.ok(h.runUntil(() => on(h, e).some((c) => tag(c, 'wisdel:bomb')), 200), `${label(f)}: it goes off on a marked one`);
    const b = on(h, e).find((c) => tag(c, 'wisdel:bomb'));
    approx(b.amount, u.s.atk * t0['attack@bomb_atk_scale'], `${label(f)}: ×${t0['attack@bomb_atk_scale']}`);
    assert.ok(!e.findBuff(markKey(u)) || on(h, e).filter((c) => c.t > b.t && !tag(c, 'wisdel:bomb')).length > 0, `${label(f)}: spent (or re-marked by a later attack)`);
    h.b.addBuff(e, { key: markKey(u), source: u });
    h.b.retreat(u);
    assert.ok(!e.findBuff(markKey(u)) && !main.findBuff(markKey(u)), `${label(f)}: her 残影 leave with her`);
    done(h);
  }
});

test('T2 死魂灵的余息: a 魂灵之影 (the form\'s stats, 禁疗, no attack, attackable) at each deployment on the nearest free tile of her range, at most 3; 迷彩 while one that came in on her x-5 stands; the shadows stay when she leaves', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const v = shadowOf(tier, elite);
    assert.deepEqual([v.stats.maxHp, v.stats.atk, v.stats.def, v.stats.res, v.stats.respawnTime, v.stats.deployLimit], [3500, elite ? 738 : 660, elite ? 628 : 585, 50, 5, 3], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 1 });
    const [t] = shadowsOf(h, u);
    assert.deepEqual([t.base.maxHp, t.base.atk, t.base.def, t.base.res, t.s.blockCnt, !!t.s.flags.noHeal, !!t.s.flags.untargetable, t.profile.noAttack],
      [3500, v.stats.atk, v.stats.def, 50, 0, true, false, true], `T${tier}: stats, 禁疗, attackable, no attack`);
    assert.ok(u.findBuff(`wisdel:camou:${t.id}`) && u.s.flags.camou, `T${tier}: 迷彩`);
    // a ranged enemy in reach: she is not its target while camouflaged and not blocking
    const shooter = h.spawn('enemy_atk', { pos: [10, 6] });
    h.run(4);
    assert.ok(!h.hooksOf('damaged').some((c) => c.source === shooter && c.target === u), `T${tier}: 迷彩: the shooter does not pick her`);
    h.b.kill(shooter, null);
    h.b.kill(t, null);
    assert.ok(!u.s.flags.camou, `T${tier}: gone with its shadow`);
    for (let i = 0; i < 4; i++) {
      h.b.retreat(u);
      h.run(0.2);
      assert.ok(h.b.redeploy(u, { free: true }), `T${tier}: redeploy ${i}`);
      h.run(0.2);
    }
    assert.equal(shadowsOf(h, u).filter((s) => s.alive).length, 3, `T${tier}: at most 3 (they stay when she leaves)`);
    done(h);
  }
  // no free tile next to her: the shadow lands on the next nearest (lower row first) and gives no 迷彩
  const others = [[9, 4], [11, 4], [10, 5]].map(([r, c], i) => ({ uid: 10 + i, chessId: 'chess_char_1_02_a', row: r, col: c }));
  const { h, u } = field({ skill: 1, others });
  assert.deepEqual(shadowsOf(h, u).map((t) => [t.tileR, t.tileC]), [[9, 5]], 'the nearest free one: √2 away, lower row first');
  assert.ok(!u.s.flags.camou, 'not on its x-5: no 迷彩');
  done(h);
});

test('user #557 (PR #558 by IceCodeNew): Given a bottom-row boss lineup, When the talent and S3 summon, Then shadows skip the bench and use only free combat tiles', () => {
  for (const kind of ['boss', 'hidden']) for (const side of ['L', 'R']) for (const free of [false, true]) {
    // Board (9, 7) becomes field (2, 7)/(2, 13). Row 1 is the temporary bench, inside BOSS_RECT.
    const units = [{ uid: 1, chessId: SLOT[5], diy: { charId: WD, skillIndex: 2 }, row: 9, col: 7, dir: 'DOWN' }];
    for (let col = 5; col <= 9; col++) {
      if (col === 7 || free && col === 8) continue;
      units.push({ uid: col, chessId: 'chess_char_1_01_a', row: 9, col });
    }
    const h = makeBattle({ kind, stageId: 'act2autochess_m02', players: [{ playerId: 'p1', side, units }], autoFinish: false });
    h.step();
    const u = h.unit(1);
    const expected = free ? [[2, side === 'L' ? 8 : 12]] : [];
    assert.deepEqual(shadowsOf(h, u).map(t => [t.tileR, t.tileC]), expected, `${kind}/${side}/${free}: deployment talent`);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 40), 'S3 actually activates without an enemy');
    assert.deepEqual(shadowsOf(h, u).map(t => [t.tileR, t.tileC]), expected, `${kind}/${side}/${free}: S3 cannot spill into the bench`);
    done(h);
  }
});

test('#557: a shadow may stand on the teammate\'s half of a pair field (Battle.onFieldBoard), never on the empty half of a solo boss field — no summon when nothing else fits', () => {
  // board (10, 8) facing RIGHT = field (3, 8) on the left half / (3, 12) mirrored; her own free tiles of range filled,
  // the bench tile (1, 8 / 12) and the other half's (2, 11 / 9) and (3, 12 / 8) stay in range
  for (const kind of ['boss', 'hidden']) for (const side of ['L', 'R']) for (const pair of [false, true]) {
    const units = [{ uid: 1, chessId: SLOT[6], diy: { charId: WD, skillIndex: 0 }, row: 10, col: 8, dir: 'RIGHT' },
      ...[[9, 8], [11, 8], [12, 8], [9, 9]].map(([row, col], i) => ({ uid: 2 + i, chessId: 'chess_char_1_01_a', row, col }))];
    const players = [{ playerId: 'p1', side, units }];
    if (pair) players.push({ playerId: 'p2', side: side === 'L' ? 'R' : 'L', units: [{ uid: 11, chessId: 'chess_char_1_01_a', row: 12, col: 2 }] });
    const h = makeBattle({ kind, stageId: 'act2autochess_m02', players, autoFinish: false });
    h.step();
    const u = h.unit(1);
    const expected = pair ? [[2, side === 'L' ? 11 : 9]] : [];
    assert.deepEqual(shadowsOf(h, u).map(t => [t.tileR, t.tileC]), expected, `${kind}/${side}/${pair ? 'pair' : 'solo'}`);
    done(h);
  }
});

test('魂灵之影\'s skill: every 5 SP (time; +0–2 after each cast) a ground enemy of 维什戴尔\'s range — unmarked first — takes its ATK as arts damage, 停顿 1 s and her 残影; never an air unit', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const v = shadowOf(tier, elite);
    assert.deepEqual([v.skill.skillType, v.skill.spType, v.skill.spCost, v.skill.bb], ['AUTO', 'INCREASE_WITH_TIME', 5, { sluggish: 1, sp_min: 0, sp_max: 3 }], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 1 });
    h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } });
    const [t] = shadowsOf(h, u);
    const fly = h.spawn('enemy_fly', { pos: [10, 6] });
    h.run(8);
    assert.deepEqual([t.skill.activations, on(h, fly).length], [0, 0], `T${tier}: an air unit only: nothing, SP kept`);
    assert.equal(t.skill.charges, 1, `T${tier}`);
    const a = h.spawn('enemy_dummy', { pos: [10, 7] });
    const b = h.spawn('enemy_dummy', { pos: [11, 7] });
    const outside = h.spawn('enemy_dummy', { pos: [10, 9] });   // outside her 3-9
    h.b.addBuff(a, { key: markKey(u), source: u });             // already marked
    h.step();
    assert.equal(t.skill.activations, 1, `T${tier}: cast at once`);
    const hit = from(h, t);
    assert.deepEqual(hit.map((c) => c.target), [b], `T${tier}: the unmarked one`);
    approx(hit[0].amount, t.s.atk, `T${tier}: its ATK`);
    assert.deepEqual([hit[0].type, hit[0].dmg.isSkill], ['arts', true], `T${tier}: arts`);
    assert.ok(b.findBuff(markKey(u)), `T${tier}: her 残影`);
    const slow = h.hooksOf('statusApplied').find((c) => c.source === t && c.target === b);
    assert.deepEqual([slow?.status, slow?.duration], ['sluggish', 1], `T${tier}: 停顿 1 s`);
    h.run(60);
    const casts = t.skill.activations;
    assert.ok(casts >= 60 / 5 + 1 && casts <= 60 / 3 + 2, `T${tier}: 5 SP a cast, 0–2 back each time (${casts} in 60 s)`);
    assert.equal(on(h, outside).length, 0, `T${tier}: outside her range: never`);
    done(h);
  }
});

test('S1 定点清算 (AUTO, attack SP 4 / 3, data DEFAULT): the next attack splashes 1.1, makes 2 more aftershocks at 75 % / 90 % ATK and stuns every enemy it hits 0.5 / 1 s', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S1), t0 = t0Of(tier, elite, mod);
    assert.deepEqual([sk.spType, sk.spCost, sk.bb.append_atk_scale, sk.bb.stun_duration], ['INCREASE_WHEN_ATTACK', elite ? 3 : 4, elite ? 0.9 : 0.75, elite ? 1 : 0.5], label(f));
    const { h, u } = field({ tier, elite, mod, skill: 0, seed: 2 });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['instant', 'DEFAULT'], label(f));
    h.b.addBuff(shadowsOf(h, u)[0], { key: 'test:silence', flags: { silence: true } });
    const main = h.spawn('enemy_dummy', { pos: [10, 8] });
    const sp = h.spawn('enemy_dummy', { pos: [10, 9.05] });   // 1.05: only the 1.1 splash
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 4), `${label(f)}: cast on her next attack`);
    h.run(2);
    const atk = u.s.atk;
    const hits = from(h, u).filter((c) => !tag(c, 'wisdel:bomb') && c.dmg.isSkill);
    const n = (elite && mod ? 2 : 1) + 2;
    assert.equal(hits.filter((c) => c.target === main && tag(c, 'aftershock')).length, n, `${label(f)}: ${n} aftershocks`);
    for (const c of hits.filter((x) => tag(x, 'aftershock'))) approx(c.amount, atk * sk.bb.append_atk_scale * (c.target === main ? t0['attack@main_atk_scale'] : 1), `${label(f)}: ${sk.bb.append_atk_scale * 100} %`);
    assert.ok(hits.some((c) => c.target === sp && !tag(c, 'aftershock')), `${label(f)}: the 1.1 splash`);
    const stuns = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'stun' && c.target === sp);
    assert.ok(stuns.length >= 1 && stuns.every((c) => Math.abs(c.duration - sk.bb.stun_duration) < 1e-9), `${label(f)}: stunned ${sk.bb.stun_duration} s`);
    done(h);
  }
});

test('S2 饱和复仇 (MANUAL, 32 / 29 SP from 15, 25 s, data DEFAULT): ATK +16 % / +25 %, interval −0.5 / −0.7 s, 3 targets; 过载 the second half: every attack 4 rounds of 65 % / 70 % on random enemies of her range', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.spCost, sk.initSp, sk.duration, sk.bb.atk, sk.bb.base_attack_time, sk.bb['attack@atk_scale_ol']], elite ? [29, 15, 25, 0.25, -0.7, 0.7] : [32, 15, 25, 0.16, -0.5, 0.65], `T${tier}`);
    const { h, u } = field({ tier, elite, skill: 1, seed: 8 });
    h.b.addBuff(shadowsOf(h, u)[0], { key: 'test:silence', flags: { silence: true } });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['duration', 'DEFAULT'], `T${tier}`);
    for (const p of [[10, 6], [11, 6], [9, 6], [12, 5]]) h.spawn('enemy_dummy', { pos: p });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 4), `T${tier}: cast`);
    const ts = h.b.time;
    approx(u.s.interval, 2.1 + sk.bb.base_attack_time, `T${tier}: interval`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    h.run(26);
    const mains = from(h, u).filter((c) => c.dmg.isAttack && !c.dmg.isSplash && c.dmg.isSkill);
    const early = mains.filter((c) => c.t < ts + 12.4), late = mains.filter((c) => c.t > ts + 12.6 && c.t < ts + 25);
    const byAttack = (list) => { const m = new Map(); for (const c of list) m.set(c.dmg.attackId, [...(m.get(c.dmg.attackId) ?? []), c]); return [...m.values()]; };
    for (const g of byAttack(early)) {
      assert.equal(new Set(g.map((c) => c.target)).size, 3, `T${tier}: 3 targets at once`);
      for (const c of g) approx(c.amount, u.base.atk * (1 + sk.bb.atk) * 1.15, `T${tier}: ×1.15 on each main target`);
    }
    const lg = byAttack(late);
    assert.ok(lg.length >= 5, `T${tier}: overload attacks`);
    for (const g of lg) {
      assert.equal(g.length, 4, `T${tier}: 4 rounds`);
      for (const c of g) approx(c.amount, u.base.atk * (1 + sk.bb.atk) * sk.bb['attack@atk_scale_ol'] * 1.15, `T${tier}: ${sk.bb['attack@atk_scale_ol'] * 100} %`);
    }
    assert.ok(lg.some((g) => new Set(g.map((c) => c.target)).size < 4), `T${tier}: random picks (repeats happen)`);
    assert.ok(new Set(lg.flatMap((g) => g.map((c) => c.target))).size === 4, `T${tier}: every enemy of her range drawn some time`);
    assert.ok(!u.skill.active, `T${tier}: ends after 25 s`);
    done(h);
  }
});

test('S3 爆裂黎明 (MANUAL, data SP_FULL: at once, no enemy needed): 1 / 2 shadows (the first with 3 SP), ATK +120 % / +150 %, interval +2.9 s, 6 attacks at 175 % / 190 % with a 2.5 splash on air units too, 好礼 at 100 %', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, null], [6, true, BOM]]) {
    const sk = skillOf(tier, elite, S3);
    assert.deepEqual([sk.spCost, sk.initSp, sk.bb.max_cnt, sk.bb.atk, sk.bb.base_attack_time, sk.bb['attack@atk_scale_3'], sk.bb['attack@trigger_time'], sk.bb['attack@prob'], sk.bb.sp],
      elite ? [58, 35, 2, 1.5, 2.9, 1.9, 6, 1, 3] : [64, 30, 1, 1.2, 2.9, 1.75, 6, 1, 3], `T${tier}`);
    const { h, u } = field({ tier, elite, mod, skill: 2, seed: 4 });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['ammo', 'SP_FULL'], `T${tier}`);
    for (const t of shadowsOf(h, u)) h.b.addBuff(t, { key: 'test:silence', flags: { silence: true } });
    u.skill.gainSp(999);
    h.step();
    assert.ok(u.skill.active, `T${tier}: cast at once, no enemy on the field`);
    const sh = shadowsOf(h, u);
    assert.equal(sh.length, 1 + sk.bb.max_cnt, `T${tier}: the talent's + ${sk.bb.max_cnt}`);
    assert.ok(Math.floor(sh[1].skill.sp) === 3 && (sh.length < 3 || Math.floor(sh[2].skill.sp) === 0), `T${tier}: the first S3 shadow with 3 SP`);
    approx(u.s.interval, (2.1 + 2.9) * 100 / u.s.aspd, `T${tier}: interval +2.9 s`);
    const fly = h.spawn('enemy_fly', { pos: [10, 7] });
    assert.ok(h.runUntil(() => on(h, fly).length > 0, 2), `T${tier}: an air unit alone in her range is her target now`);
    const g = h.spawn('enemy_dummy', { pos: [11, 8] });          // √2 from the flyer: her 2.5 splash, her aftershocks
    const ring = h.spawn('enemy_fly', { pos: [11.5, 8.9] });     // 2.42 from the flyer, outside her range
    h.b.addBuff(g, { key: markKey(u), source: u });
    assert.ok(h.runUntil(() => !u.skill.active, 60), `T${tier}: 6 attacks and done`);
    h.run(1);
    const mains = from(h, u).filter((c) => c.dmg.isAttack && !c.dmg.isSplash);
    assert.equal(new Set(mains.map((c) => c.dmg.attackId)).size, 6, `T${tier}: 6 attacks`);
    // ATK +atk while it runs (the last shell lands after its 6th bullet ended it: the engine's ammo rule, skills.js)
    const tEnd = h.hooksOf('skillEnd').find((c) => c.unit === u).t;
    const atkAt = (t) => u.base.atk * (t <= tEnd + 1e-9 ? 1 + sk.bb.atk : 1);
    const ms = t0Of(tier, elite, mod)['attack@main_atk_scale'];
    for (const c of mains) approx(c.amount, atkAt(c.t) * sk.bb['attack@atk_scale_3'] * ms, `T${tier}: ×${sk.bb['attack@atk_scale_3']} × main`);
    assert.ok(mains.filter((c) => c.t <= tEnd).length >= 5, `T${tier}: five land while it runs`);
    assert.ok(mains.every((c) => c.target === fly), `T${tier}: the flyer was her target throughout`);
    const splash = from(h, u).filter((c) => c.dmg.isSplash && !tag(c, 'aftershock') && !tag(c, 'wisdel:bomb'));
    assert.ok(splash.some((c) => c.target === ring) && splash.some((c) => c.target === g), `T${tier}: the 2.5 splash reaches the air unit 2.42 away and the ground one`);
    for (const c of splash) approx(c.amount, atkAt(c.t) * sk.bb['attack@atk_scale_3'], `T${tier}: splash in full`);
    assert.ok(on(h, fly).every((c) => !tag(c, 'aftershock')) && on(h, ring).every((c) => !tag(c, 'aftershock')), `T${tier}: aftershocks only on ground enemies`);
    const shocks = from(h, u).filter((c) => tag(c, 'aftershock') && c.target === g);
    assert.equal(shocks.length, 6 * (elite && mod ? 2 : 1), `T${tier}: every aftershock reaches the ground one (it came before the first one)`);
    for (const c of shocks) approx(c.amount, atkAt(c.t) * sk.bb['attack@atk_scale_3'] * 0.5, `T${tier}: 50 % of the boosted ATK`);
    assert.ok(on(h, g).some((c) => tag(c, 'wisdel:bomb') && Math.abs(c.t - shocks[0].t) < 1e-9), `T${tier}: 好礼 at 100 %: the marked one went off on the first aftershock`);
    done(h);
  }
});
