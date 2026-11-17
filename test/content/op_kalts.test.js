// test/content/op_kalts.test.js — the 自选 operator kit of 凯尔希 (char_003_kalts, 6★ 医师; kit
// server/sim/content/kits/ops/op-kalts.js) and her summon Mon3tr (token_10002_kalts_mon3tr), fielded the production way (a
// DIY slot + its `diy` pick; Mon3tr as a token piece of hers) in every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no
// module) and elite (E2 Lv60, rank 7) with no module, PHY-X Mon2tr, PHY-Y 医者 or ISW-A 凯尔希特限证章 at stage 1 (tier 5) /
// 3 (tier 6). Every number is read back from data/backups.json (the form of that slot status, the token's variant); the
// fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_kalts.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const KALTS = 'char_003_kalts';
const MON3TR = 'token_10002_kalts_mon3tr';
const FORMS = BACKUPS.units[KALTS].forms;
const TOKEN = BACKUPS.tokens[MON3TR];
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const PHYX = 'uniequip_002_kalts', PHYY = 'uniequip_003_kalts', ISWA = 'uniequip_004_kalts';
const S1 = 'skchr_kalts_1', S2 = 'skchr_kalts_2', S3 = 'skchr_kalts_3';
const statusKey = (tier, elite) => (elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0');
const formOf = (tier, elite) => FORMS[statusKey(tier, elite)];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const variantOf = (tier, elite) => TOKEN.variants[`${KALTS}@${statusKey(tier, elite)}`];
const rattleOf = (tier, elite, mod) => ((elite && mod && variantOf(tier, elite).byModule?.[mod]?.talents) || variantOf(tier, elite).talents).find((t) => t.bb.value != null).bb;
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_biter: dummy('enemy_biter', { atk: 600, range: 1.2, bat: 1 }),
  enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, speed: 0.6, mass: 0, atk: 200, bat: 1 }),
  enemy_weak: enemyRec({ key: 'enemy_weak', hp: 50, speed: 0, mass: 0 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, PHYX, PHYY, ISWA].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** A battle with 凯尔希 as uid 1 at (10, 2) facing RIGHT (`mon3tr`: her piece as uid 2), plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 0, mon3tr = { row: 10, col: 4 }, others = [], seed = 5, dp = 99 } = {}) {
  const units = [{ uid: 1, diy: { slot: SLOT[tier], charId: KALTS, skillIndex: skill, uniEquipId: mod }, elite, row: 10, col: 2 }];
  if (mon3tr) units.push({ uid: 2, kind: 'token', tokenId: MON3TR, ownerUid: 1, row: mon3tr.row, col: mon3tr.col });
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpInit: dp, dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'heal', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'deploy', 'kill'], captureNoisy: true,
    units: [...units, ...others],
  });
  h.step();
  return { h, u: h.unit(1), m: mon3tr ? h.unit(2) : null };
}
const heals = (h, u) => h.hooksOf('heal').filter((c) => c.source === u && !c.opts?.regen);
const rattles = (h, m) => h.hooksOf('damaged').filter((c) => c.dmg?.tags?.includes('kalts:rattle') && (c.source === m || c.credit === m));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('凯尔希 in every 自选 form: her operator kit (all three skills authored), stats + module attributes, 3-10, one heal per attack, blocks 1, 罗德岛, no 特质; her Mon3tr: the form\'s token stats, 禁疗, 1-1, blocks 3, melee ground-only physical', () => {
  assert.equal(OPERATOR_KITS[KALTS], KITS[KALTS]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u, m } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), md = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [KALTS, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.aspd],
        [form.stats.maxHp + (md?.attr.maxHp ?? 0), form.stats.atk + (md?.attr.atk ?? 0), form.stats.def + (md?.attr.def ?? 0), form.stats.aspd + (md?.attr.aspd ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.profile.dmgType, u.profile.heal, u.s.blockCnt, u.base.bat], ['heal', { mode: 'single' }, 1, 2.85], `${label(f)}: 医师`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-10`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds, u.def.tokens], [BACKUPS.diy.operators[KALTS].bonds, [], [MON3TR]], `${label(f)}: bonds / 特质 / summon`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${label(f)}: enemies target her`);
      const ts = variantOf(tier, elite).stats;
      assert.deepEqual([m.base.maxHp, m.base.atk, m.base.def, m.s.blockCnt, m.base.bat, m.base.cost, m.base.respawnTime], [ts.maxHp, ts.atk, ts.def, 3, 2, 10, 25], `${label(f)}: Mon3tr stats`);
      assert.deepEqual([m.s.flags.noHeal, m.profile.attack, m.profile.dmgType, m.profile.canHitFly, m.liveRangeGrid], [true, 'melee', 'phys', false, [[0, 0], [0, 1]]], `${label(f)}: Mon3tr 禁疗 / melee ground-only`);
      done(h);
    }
  }
  // E2 Lv1 1469 / 417 / 172, E2 Lv60 1578 / 482 / 201 (full potential); PHY-X +35 / +15 → +60 / +25 ATK / DEF, PHY-Y +115 / +5 → +195 / +7
  // HP / ASPD, ISW-A +24 / +5 → +50 / +7 ATK / ASPD; Mon3tr 4292 / 1149 / 336 → 5048 / 1317 / 382
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [1469, 417, 1578, 482]);
  assert.deepEqual([modOf(5, PHYX).attr, modOf(6, PHYX).attr, modOf(5, PHYY).attr, modOf(6, PHYY).attr, modOf(5, ISWA).attr, modOf(6, ISWA).attr],
    [{ atk: 35, def: 15 }, { atk: 60, def: 25 }, { maxHp: 115, aspd: 5 }, { maxHp: 195, aspd: 7 }, { atk: 24, aspd: 5 }, { atk: 50, aspd: 7 }]);
  assert.deepEqual([variantOf(5, false).stats.maxHp, variantOf(5, false).stats.atk, variantOf(6, true).stats.maxHp], [4292, 1149, 5048]);
});

test('a 自选 pick: 凯尔希 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(KALTS));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(KALTS), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: KALTS, skillIndex: 1, uniEquipId: PHYX } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: KALTS, skillIndex: 1, uniEquipId: PHYX } } });
});

test('T1 heal order: herself and her Mon3tr first when injured (the lower HP ratio; ties: herself), else the lowest ratio; her heals pass Mon3tr\'s 禁疗, another medic never heals it; with no module an operator Mon3tr is first too', () => {
  const others = [{ uid: 3, chessId: 'chess_char_1_02_a', row: 9, col: 5 }, { uid: 4, chessId: 'chess_char_2_02_a', row: 11, col: 3 }];
  const { h, u, m } = field({ skill: 0, others });
  const yak = h.unit(3), silent = h.unit(4);
  const at = (x, r) => { x.hp = x.s.maxHp * r; };
  at(yak, 0.3); at(m, 0.6);
  const n0 = heals(h, u).length;
  assert.ok(h.runUntil(() => heals(h, u).length > n0, 4), 'a heal');
  assert.equal(heals(h, u)[n0].target, m, 'Mon3tr (60 %) before 角峰 (30 %)');
  approx(heals(h, u)[n0].amount, u.s.atk, 'a full heal through its 禁疗');
  assert.equal(h.hooksOf('heal').filter((c) => c.source === silent && c.target === m).length, 0, '赫默 never heals Mon3tr');
  // herself at the same ratio: herself
  at(m, 0.5); at(u, 0.5);
  const n1 = heals(h, u).length;
  assert.ok(h.runUntil(() => heals(h, u).length > n1, 4));
  assert.equal(heals(h, u)[n1].target, u, 'a tie: herself');
  // both full: the lowest ratio of the rest
  at(m, 1); at(u, 1); at(yak, 0.2);
  const n2 = heals(h, u).length;
  assert.ok(h.runUntil(() => heals(h, u).length > n2, 4));
  assert.equal(heals(h, u)[n2].target, yak, 'then 角峰');
  done(h);
  // the operator Mon3tr (char_4179_monstr): first with no module, an ordinary target with one
  for (const [elite, mod, first] of [[false, null, true], [true, PHYY, false]]) {
    const opM = [{ uid: 3, diy: { slot: 'chess_char_6_diy2_a', charId: 'char_4179_monstr', skillIndex: 0 }, row: 9, col: 4, dir: 'LEFT' },
      { uid: 4, chessId: 'chess_char_1_02_a', row: 11, col: 4 }];
    const r = field({ tier: 6, elite, mod, skill: 0, mon3tr: null, others: opM });
    const om = r.h.unit(3), y = r.h.unit(4);
    assert.equal(om.def.charId, 'char_4179_monstr');
    om.hp = om.s.maxHp * 0.7; y.hp = y.s.maxHp * 0.4;
    const k0 = heals(r.h, r.u).length;
    assert.ok(r.h.runUntil(() => heals(r.h, r.u).length > k0, 4));
    assert.equal(heals(r.h, r.u)[k0].target, first ? om : y, `${mod ?? 'no module'}: ${first ? 'the operator Mon3tr' : '角峰'} first`);
    done(r.h);
  }
});

test('T1 Mon3tr: DEF ×0 off her range (PHY-Y stage 3: inside ASPD +20, DEF +20 %); withdrawn when she leaves (no blast), back 25 s after it left paying 10 DP, only while she stands; her redeployment readies it at once', () => {
  for (const f of [[5, false, null], [6, true, PHYY], [5, true, PHYY]]) {
    const [tier, elite, mod] = f;
    const t0 = (elite && mod && modOf(tier, mod).talentChanges.find((x) => x.talentIndex === 0)?.bb) || formOf(tier, elite).talents.find((x) => x.index === 0).bb;
    const y3 = tier === 6 && mod === PHYY;
    assert.deepEqual([t0.def, t0.attack_speed], y3 ? [0.2, 20] : [0, 0], label(f));
    const { h, u, m } = field({ tier, elite, mod, skill: 0 });
    approx(m.s.def, m.base.def * (1 + t0.def), `${label(f)}: in her range`);
    approx(m.s.aspd, m.base.aspd + t0.attack_speed, `${label(f)}: ASPD`);
    const off = field({ tier, elite, mod, skill: 0, mon3tr: { row: 10, col: 1 } });   // behind her: off her 3-10
    assert.equal(off.m.s.def, 0, `${label(f)}: DEF 0 off her range`);
    approx(off.m.s.aspd, off.m.base.aspd, `${label(f)}: no bonus off her range`);
    done(off.h);
    // she leaves: it is withdrawn (no 不毁重构), then waits for her
    h.spawn('enemy_dummy', { pos: [10, 5] });
    h.b.kill(u, null);
    h.step();
    assert.ok(!m.alive && !m.removed, `${label(f)}: withdrawn with her`);
    assert.equal(h.hooksOf('death').find((c) => c.unit === m)?.reason, 'retreat', label(f));
    assert.equal(rattles(h, m).length, 0, `${label(f)}: no blast on a withdrawal`);
    assert.ok(h.runUntil(() => u.alive, 90), `${label(f)}: she redeploys`);
    const back = h.b.time;
    assert.ok(h.runUntil(() => m.alive, 0.2), `${label(f)}: Mon3tr at once`);
    assert.ok(h.b.time - back < 0.15, label(f));
    // killed: back 25 s later paying 10 DP
    const dp0 = h.b.players[0].dp;
    h.b.kill(m, null);
    h.run(24.5);
    assert.ok(!m.alive, `${label(f)}: not before 25 s`);
    h.run(0.7);
    assert.ok(m.alive, `${label(f)}: back`);
    approx(h.b.players[0].dp, dp0 - 10, `${label(f)}: 10 DP`);
    done(h);
  }
});

test('T2 不毁重构: Mon3tr knocked out ⇒ every enemy of its 3×3 (air units too) takes 1400 true damage (溅射) and a 3.5 s stun; PHY-X stage 3: 1700 / 4 s, and once per deployment when a hit leaves it at or below half HP', () => {
  for (const f of [[5, false, null], [6, true, PHYX], [5, true, PHYX], [6, true, PHYY]]) {
    const [tier, elite, mod] = f;
    const rb = rattleOf(tier, elite, mod);
    const x3 = tier === 6 && mod === PHYX;
    assert.deepEqual([rb.value, rb.stun, rb.hp_ratio ?? 0], x3 ? [1700, 4, 0.5] : [1400, 3.5, 0], label(f));
    const { h, m } = field({ tier, elite, mod, skill: 0 });
    const e1 = h.spawn('enemy_dummy', { pos: [11, 5] }), e2 = h.spawn('enemy_fly', { pos: [9, 3] }), far = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.step();   // the enemies on the tile index
    if (x3) {
      // a hit to 40 %: the half-HP blast, once
      h.b.dealDamage(null, m, { amount: m.s.maxHp * 0.6, type: 'true' });
      assert.equal(rattles(h, m).length, 2, `${label(f)}: the half-HP blast`);
      h.b.dealDamage(null, m, { amount: 1, type: 'true' });
      assert.equal(rattles(h, m).length, 2, `${label(f)}: once per deployment`);
    }
    const n0 = rattles(h, m).length;
    h.b.dealDamage(null, m, { amount: 1e9, type: 'true' });
    assert.ok(!m.alive, label(f));
    const r = rattles(h, m).slice(n0);
    assert.deepEqual(r.map((c) => c.target.id).sort(), [e1.id, e2.id].sort(), `${label(f)}: its 3×3, the flyer too`);
    for (const c of r) { approx(c.amount, rb.value, `${label(f)}: ${rb.value} true`); assert.deepEqual([c.type, c.dmg.isSplash], ['true', true]); }
    const st = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.target !== m);
    assert.ok(st.length >= 2 && st.every((c) => Math.abs(c.duration - rb.stun) < 1e-6), `${label(f)}: ${rb.stun} s`);
    assert.ok(!far.findBuff('stun'), `${label(f)}: two tiles away`);
    done(h);
  }
});

test('S1 指令：结构加固 (MANUAL, data DEFAULT — cast as she is about to heal): 33 / 36 s, her DEF +90 % / +120 % and Mon3tr\'s; 物理格挡 30 % / 40 %: a physical instance blocked whole (arts never)', () => {
  for (const f of [[5, false, null], [6, true, PHYX]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.trigger.rule, sk.duration, sk.bb.def, sk.bb['attack@def'], sk.bb.prob], ['DEFAULT', elite ? 36 : 33, elite ? 1.2 : 0.9, elite ? 1.2 : 0.9, elite ? 0.4 : 0.3], label(f));
    const { h, u, m } = field({ tier, elite, mod, skill: 0, seed: 23 });
    u.skill.gainSp(999);
    h.run(3);
    assert.equal(u.skill.activations, 0, `${label(f)}: nobody injured, no cast`);
    m.hp = m.s.maxHp * 0.5;
    assert.ok(h.runUntil(() => u.skill.active, 4), `${label(f)}: cast on her heal`);
    approx(u.skill.timeLeft, sk.duration, label(f), 0.01);
    approx(u.s.def, u.base.def * (1 + sk.bb.def), `${label(f)}: her DEF`);
    h.step();
    approx(m.s.def, m.base.def * (1 + sk.bb['attack@def']), `${label(f)}: Mon3tr DEF`);
    let blocked = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      if (h.b.dealDamage(null, u, { amount: 1000, type: 'phys', canDodge: false }) === 0) blocked++;
      u.hp = u.s.maxHp;
    }
    assert.ok(Math.abs(blocked / N - sk.bb.prob) < 0.07, `${label(f)}: ${blocked} / ${N} ≈ ${sk.bb.prob}`);
    let artsBlocked = 0;
    for (let i = 0; i < 100; i++) { if (h.b.dealDamage(null, u, { amount: 10, type: 'arts', canDodge: false }) === 0) artsBlocked++; u.hp = u.s.maxHp; }
    assert.equal(artsBlocked, 0, `${label(f)}: arts never`);
    h.runUntil(() => !u.skill.active, 40);
    h.step();
    approx(m.s.def, m.base.def, `${label(f)}: Mon3tr DEF back`);
    done(h);
  }
});

// PRTS 凯尔希 + 伤判效果: physical block is an ordinary injury effect, not a dodge.
test('S1 physical block follows acquisition order, ignores dodge policy and expires with the skill', () => {
  for (const earlier of ['barrier', 'dodge', 'none']) {
    const { h, u } = field({ mon3tr: null });
    if (earlier === 'barrier') h.b.addBuff(u, { key: 'earlier', shield: 10000 });
    if (earlier === 'dodge') h.b.addBuff(u, { key: 'earlier', mods: { dodgePhys: 1 } });
    assert.ok(u.skill.activate('test', { free: true }));
    let rolls = 0, blocks = 0, dodges = 0;
    h.b.rng = () => { rolls++; return 0; };
    h.b.on('block', () => { blocks++; });
    h.b.on('dodge', () => { dodges++; });
    const hp = u.hp;
    h.b.dealDamage({ target: u, amount: 100, type: 'phys' });
    assert.equal(u.hp, hp);
    assert.equal(rolls, earlier === 'barrier' ? 0 : 1);
    assert.equal(blocks, earlier === 'dodge' ? 0 : 1);
    assert.equal(dodges, earlier === 'dodge' ? 1 : 0);
    h.b.removeBuff(u, 'earlier');
    for (const dodgeMode of ['ignore', 'uncancellable']) {
      assert.equal(h.b.dealDamage({ source: null, credit: u, target: u, amount: 100, type: 'phys', dodgeMode }), 0);
    }
    const before = rolls;
    h.b.dealHPLose({ target: u, amount: 10 });
    h.b.dealElementDamage({ target: u, amount: 10, element: 'burn' });
    h.b.dealDamage({ target: u, amount: 10, type: 'true' });
    assert.equal(rolls, before, 'loss, gauges and nonphysical damage never attempt this block');
    u.skill.end('test');
    assert.equal(u.findBuff('kalts:physicalBlock'), null);
    assert.ok(h.b.dealDamage({ target: u, amount: 100, type: 'phys' }) > 0);
    assert.equal(rolls, before);
    done(h);
  }
});

test('S2 指令：战术协同 (MANUAL, data DEFAULT, 绑定 Mon3tr): her ASPD +45 / +60, Mon3tr ATK +35 % / +50 % and each attack strikes every enemy it blocks; no Mon3tr: no cast, SP emptied and frozen; it leaving ends the skill', () => {
  for (const f of [[5, false, null], [6, true, PHYY]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.trigger.rule, sk.duration, sk.bb.attack_speed, sk.bb['attack@atk']], ['DEFAULT', elite ? 17 : 16, elite ? 60 : 45, elite ? 0.5 : 0.35], label(f));
    const { h, u, m } = field({ tier, elite, mod, skill: 1, mon3tr: { row: 9, col: 5 } });
    const w1 = h.spawn('enemy_walk', { pos: [9, 6], routeIndex: 0 }), w2 = h.spawn('enemy_walk', { pos: [9, 7], routeIndex: 0 });
    assert.ok(h.runUntil(() => m.blocking.length === 2, 20), `${label(f)}: Mon3tr blocks both`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 6), `${label(f)}: cast on a heal of Mon3tr`);
    approx(u.s.aspd, u.base.aspd + sk.bb.attack_speed, `${label(f)}: her ASPD`);
    h.step();
    approx(m.s.atk, m.base.atk * (1 + sk.bb['attack@atk']), `${label(f)}: Mon3tr ATK`);
    const n0 = h.hooksOf('damaged').length;
    h.run(4.5);
    const hits = h.hooksOf('damaged').slice(n0).filter((c) => c.source === m && c.dmg?.isAttack);
    const ids = new Map();
    for (const c of hits) ids.set(c.dmg.attackId, (ids.get(c.dmg.attackId) ?? new Set()).add(c.target.id));
    assert.ok(ids.size >= 2 && [...ids.values()].every((s) => s.size === 2 && s.has(w1.id) && s.has(w2.id)), `${label(f)}: every attack on both`);
    // Mon3tr killed: the skill ends within 0.1 s, the SP is emptied and recovers no more until it is back
    h.b.kill(m, null);
    h.run(0.15);
    assert.ok(!u.skill.active, `${label(f)}: ended (绑定)`);
    assert.equal(u.skill.sp, 0, label(f));
    h.run(5);
    assert.equal(u.skill.sp, 0, `${label(f)}: no SP without Mon3tr`);
    assert.ok(u.findBuff('kalts:binding'), label(f));
    m.mem.readyAt = h.b.time;
    assert.ok(h.runUntil(() => m.alive, 1), label(f));
    h.run(2);
    assert.ok(u.skill.sp > 1.5, `${label(f)}: SP again with Mon3tr back`);
    done(h);
  }
  // no Mon3tr piece at all: S2 never gains SP, never casts
  const { h, u } = field({ skill: 1, mon3tr: null, others: [{ uid: 3, chessId: 'chess_char_1_02_a', row: 10, col: 4 }] });
  h.unit(3).hp = 100;
  h.run(30);
  assert.deepEqual([u.skill.sp, u.skill.activations], [0, 0], 'no Mon3tr: no SP');
  done(h);
});

test('S3 指令：熔毁 (MANUAL, data DEFAULT, 绑定 Mon3tr, 18 s): Mon3tr DEF +120 % / +140 %, ATK +160 % / +190 % down by 1/18 every second, true damage; no kill ⇒ 50 % max HP 流失 at the end (it may knock it out: 不毁重构); a kill ⇒ none', () => {
  for (const f of [[5, false, null], [6, true, ISWA]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S3);
    assert.deepEqual([sk.trigger.rule, sk.duration, sk.bb['attack@atk'], sk.bb['attack@def'], sk.bb['attack@hp_ratio']], ['DEFAULT', 18, elite ? 1.9 : 1.6, elite ? 1.4 : 1.2, 0.5], label(f));
    const { h, u, m } = field({ tier, elite, mod, skill: 2 });
    const e = h.spawn('enemy_biter', { pos: [10, 5] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 6), `${label(f)}: cast`);
    const cast = h.hooksOf('skillStart').find((c) => c.unit === u).t;
    h.step();
    approx(m.s.def, m.base.def * (1 + sk.bb['attack@def']), `${label(f)}: DEF`);
    approx(m.s.atk, m.base.atk * (1 + sk.bb['attack@atk']), `${label(f)}: ATK at the cast`);
    h.run(cast + 5.5 - h.b.time);
    approx(m.s.atk, m.base.atk * (1 + sk.bb['attack@atk'] * (1 - 5 / 18)), `${label(f)}: 5 s on`);
    const hits = h.hooksOf('damaged').filter((c) => c.source === m && c.target === e && c.dmg?.isAttack && c.t >= cast);
    assert.ok(hits.length > 0 && hits.every((c) => c.type === 'true'), `${label(f)}: true damage`);
    assert.ok(h.runUntil(() => !u.skill.active, 15), label(f));
    assert.equal(h.hooksOf('skillEnd').find((c) => c.unit === u)?.reason, 'duration', label(f));
    const loss = h.hooksOf('damaged').filter((c) => c.target === m && c.dmg?.tags?.includes('kalts:meltdown'));
    assert.equal(loss.length, 1, `${label(f)}: the 流失 (it killed nothing: the biter has 1e9 HP)`);
    approx(loss[0].amount, m.s.maxHp * sk.bb['attack@hp_ratio'], `${label(f)}: 50 % max HP`);
    assert.ok(loss[0].dmg.tags.includes('hpLoss'), `${label(f)}: a 流失`);
    h.step();
    approx(m.s.atk, m.base.atk, `${label(f)}: ATK back`);
    done(h);
  }
  // the loss knocks it out: 不毁重构
  {
    const { h, u, m } = field({ skill: 2 });
    h.spawn('enemy_dummy', { pos: [10, 5] });
    const near = h.spawn('enemy_dummy', { pos: [11, 4] });
    m.hp = m.s.maxHp * 0.3;
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 6));
    // her heals keep it up meanwhile: set it low just before the end
    assert.ok(h.runUntil(() => u.skill.timeLeft < 0.05, 20));
    m.hp = m.s.maxHp * 0.3;
    assert.ok(h.runUntil(() => !u.skill.active, 1));
    assert.ok(!m.alive, 'knocked out by the 流失');
    assert.equal(h.hooksOf('death').find((c) => c.unit === m)?.reason, 'killed');
    assert.ok(rattles(h, m).some((c) => c.target === near), '不毁重构');
    done(h);
  }
  // a kill keeps its HP
  {
    const { h, u, m } = field({ skill: 2 });
    h.spawn('enemy_weak', { pos: [10, 5] });
    m.hp = m.s.maxHp * 0.9;
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 6));
    assert.ok(h.runUntil(() => h.hooksOf('kill').some((c) => c.killer === m), 10), 'Mon3tr kills');
    assert.ok(h.runUntil(() => !u.skill.active, 20));
    assert.equal(h.hooksOf('damaged').filter((c) => c.target === m && c.dmg?.tags?.includes('kalts:meltdown')).length, 0, 'no 流失 after a kill');
    done(h);
  }
});

test('modules: PHY-X ×1.15 on a heal of a target at or below 50 %; PHY-Y ×1.15 on a heal of a target on a 地面 tile; ISW-A (集成战略-only trait and talent: no 2 targets, no Mon3tr +50 %) and no module: plain heals', () => {
  for (const f of [[5, true, PHYX], [6, true, PHYX], [5, true, PHYY], [6, true, PHYY], [5, true, ISWA], [6, true, ISWA], [6, true, null]]) {
    const [tier, elite, mod] = f;
    const md = modOf(tier, mod);
    if (md) assert.deepEqual([md.traitOverride.bb.heal_scale, md.traitOverride.bb.hp_ratio ?? null], [1.15, mod === PHYY ? null : 0.5], label(f));
    // 角峰 on a 地面 tile (10, 4), 德克萨斯 on high ground (11, 2)
    const { h, u } = field({ tier, elite, mod, skill: 0, mon3tr: null, others: [{ uid: 3, chessId: 'chess_char_1_02_a', row: 10, col: 4 }, { uid: 4, chessId: 'chess_char_1_08_a', row: 11, col: 2 }] });
    const yak = h.unit(3), tex = h.unit(4);
    assert.deepEqual([yak.ground, tex.ground], [true, false]);
    const healOf = (x, r) => {
      for (const o of [yak, tex]) o.hp = o.s.maxHp;
      x.hp = x.s.maxHp * r;
      const n = heals(h, u).length;
      assert.ok(h.runUntil(() => heals(h, u).length > n, 4), label(f));
      return heals(h, u)[n];
    };
    const a = healOf(yak, 0.45), b = healOf(yak, 0.8), c = healOf(tex, 0.45);
    const atk = u.s.atk;
    const want = (t, r) => atk * ((mod === PHYX && r <= 0.5) || (mod === PHYY && t.ground) ? 1.15 : 1);
    approx(a.amount, want(yak, 0.45), `${label(f)}: 地面, 45 %`);
    approx(b.amount, want(yak, 0.8), `${label(f)}: 地面, 80 %`);
    approx(c.amount, want(tex, 0.45), `${label(f)}: high ground, 45 %`);
    if (mod === ISWA) {
      // both injured: one heal per attack (no 集成战略 second target)
      yak.hp = yak.s.maxHp * 0.5; tex.hp = tex.s.maxHp * 0.5;
      const n = heals(h, u).length;
      assert.ok(h.runUntil(() => heals(h, u).length > n, 4));
      h.step();
      const att = new Set(heals(h, u).slice(n).map((x) => x.t));
      assert.ok([...att].every((t) => heals(h, u).filter((x) => x.t === t).length === 1), `${label(f)}: one target per heal`);
    }
    done(h);
  }
});
