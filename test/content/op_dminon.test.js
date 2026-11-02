// test/content/op_dminon.test.js — the 自选 operator kit of 国度 (char_4246_dminon, 6★ 伏击客; kit
// server/sim/content/kits/ops/op-dminon.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or AMB-X
// “空瓶罐们” at stage 1 (tier 5) / 3 (tier 6). Numbers from data/backups.json; the fidelity checklist of kits/README.md.
// The field: the normal battle rect is rows 9–12, cols 2–10; 国度 stands at (10, 4) facing RIGHT unless a test says
// otherwise — y-1 = rows 9–11 × cols 3–5 and (10, 6).
// Run: node --test test/content/op_dminon.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { COLS } from '../../server/sim/constants.js';
import {
  COLLAPSE, BOUNDARY_TAG, SPREAD_TAG, KO_DELAY, haltKey, guardKey, ambxKey,
} from '../../server/sim/content/kits/ops/op-dminon.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const DOM = 'char_4246_dminon';
const FORMS = BACKUPS.units[DOM].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const AX = 'uniequip_002_dminon';
const S1 = 'skchr_dminon_1', S2 = 'skchr_dminon_2', S3 = 'skchr_dminon_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
/** 实质坍缩 of a form: the module's change at stage 3, else the form's own. */
const collapseOf = (tier, elite, mod) => (elite && mod && tier === 6
  ? modOf(6, mod).talentChanges.find((t) => t.talentIndex === 0).bb : formOf(tier, elite).talents.find((t) => t.index === 0).bb);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_hitter: dummy('enemy_hitter', { atk: 200, range: 1.5, bat: 0.5 }),
  enemy_walkslow: enemyRec({ key: 'enemy_walkslow', hp: 1e9, speed: 1, mass: 0 }),
};
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, AX].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;
const tileKey = (r, c) => r * COLS + c;

/** 国度 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 4, others = [], seed = 5, potential } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'dodge'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: DOM, skillIndex: skill, uniEquipId: mod }, elite, row, col, ...(potential ? { potential } : {}) }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
/** A second 国度 (another slot) of the same player. */
const second = (o) => ({ uid: 2, diy: { slot: SLOT[o.tier], charId: DOM, skillIndex: o.skill ?? 0, uniEquipId: o.mod ?? null }, elite: !!o.elite, row: o.row, col: o.col });
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
const tagged = (h, u, tag) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes(tag));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
/** Keep a unit from casting (no SP). */
function noSkill(h, u) {
  u.skill.charges = 0; u.skill.sp = 0;
  h.b.addBuff(u, { key: 'test:noSp', flags: { noSp: true } });
}

test('国度 in every 自选 form: his kit (all three skills authored), the form\'s stats + module attributes, y-1, 伏击客 (melee, every enemy in range, ground only, 50 % dodge, taunt level −1 — not −2), blocks 0, the data triggers; offered as a pick', () => {
  assert.equal(OPERATOR_KITS[DOM], KITS[DOM]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [DOM, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res],
        [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0), 30], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.profile.allInRange, u.profile.sub, u.base.bat],
        [0, 'melee', false, 'phys', true, 'stalker', 3.5], `${label(f)}: 伏击客`);
      assert.deepEqual([u.s.dodgePhys, u.s.dodgeArts, u.s.taunt], [0.5, 0.5, -1], `${label(f)}: dodge, taunt −1`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: y-1`);
      assert.equal(u.skill.rule, form.skills[skill].trigger.rule, `${label(f)}: the data's trigger`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth && !u.s.flags.untargetable, `${label(f)}: ground enemies can target him`);
      done(h);
    }
  }
  assert.deepEqual(formOf(6, true).skills.map((s) => s.trigger.rule), ['DEFAULT', 'ACTIVE_RANGE', 'ACTIVE_RANGE']);
  assert.deepEqual([formOf(5, false).rangeId, formOf(6, true).skills[1].rangeId, formOf(6, true).skills[2].rangeId], ['y-1', 'y-3', 'y-10']);
  assert.deepEqual([modOf(5, AX).attr, modOf(6, AX).attr], [{ maxHp: 180, atk: 60 }, { maxHp: 230, atk: 80 }]);
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(DOM) && [5, 6].every((t) => diyPool(t, { data, kitted: KITTED_CHARS }).includes(DOM)));
  assert.equal(validateDiyPicks({ [SLOT[6]]: { charId: DOM, skillIndex: 2, uniEquipId: AX } }, { data, kitted: KITTED_CHARS }).ok, true);
});

test('trait 伏击客: one attack strikes every ground enemy of his y-1 at once (physical), never a flyer; 50 % of the enemy hits are dodged', () => {
  for (const [tier, elite, mod] of [[5, false, null], [6, true, AX]]) {
    const { h, u } = field({ tier, elite, mod });
    noSkill(h, u);
    const a = h.spawn('enemy_dummy', { pos: [10, 5] }), b = h.spawn('enemy_dummy', { pos: [11, 3] }), c = h.spawn('enemy_dummy', { pos: [10, 6] });
    const fly = h.spawn('enemy_fly', { pos: [9, 4] });
    assert.ok(h.runUntil(() => atkHits(h, u).length >= 3, 6));
    const id = atkHits(h, u)[0].dmg.attackId;
    const hit = atkHits(h, u).filter((x) => x.dmg.attackId === id);
    assert.deepEqual(new Set(hit.map((x) => x.target)), new Set([a, b, c]), `T${tier}: every ground enemy of y-1 ([0,2] included)`);
    for (const x of hit) assert.equal(x.type, 'phys');
    assert.ok(!atkHits(h, u).some((x) => x.target === fly), 'never the flyer');
    const hitter = h.spawn('enemy_hitter', { pos: [10, 5] });
    h.b.addBuff(u, { key: 'test:tough', mods: { defFlat: 1e6 } });
    h.run(200);
    const dodged = h.hooksOf('dodge').filter((x) => x.target === u && x.source === hitter).length;
    const landed = h.hooksOf('damaged').filter((x) => x.target === u && x.source === hitter).length;
    const r = dodged / (dodged + landed);
    assert.ok(dodged + landed > 200 && Math.abs(r - 0.5) < 0.06, `T${tier}: dodge rate ${r}`);
    done(h);
  }
});

test('T1 实质坍缩: ground enemies standing on his y-1 (the tile of their position) ASPD −15 / AMB-X stage 3 −20, and every second (from his deployment) 13 % / 20 % of his ATK as arts 普通伤害; not a flyer, not an enemy whose collider only reaches the field, not after it leaves', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const tb = collapseOf(tier, elite, mod);
    assert.deepEqual(tb, elite && mod && tier === 6 ? { attack_speed: -20, atk_scale: 0.2 } : { attack_speed: -15, atk_scale: 0.13 }, label(f));
    const { h, u } = field({ tier, elite, mod });
    noSkill(h, u);
    const on = h.spawn('enemy_dummy', { pos: [9, 3] });
    const fly = h.spawn('enemy_fly', { pos: [11, 5] });
    const off = h.spawn('enemy_dummy', { pos: [10, 8] });
    const edge = h.spawn('enemy_dummy', { pos: [10, 7] });
    edge.x = 6.55;                                  // its tile is (10, 7); its collider reaches (10, 6) of his range
    for (const e of [on, off, edge]) h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });   // his attacks never land
    h.run(2.05);
    approx(on.s.aspd, 100 + tb.attack_speed, `${label(f)}: ASPD on the field`);
    for (const e of [fly, off, edge]) assert.equal(e.s.aspd, 100, `${label(f)}: ${e.defId} at x ${e.x} untouched`);
    assert.ok(atkHits(h, u).length === 0 && h.hooksOf('dodge').some((x) => x.source === u && x.target === edge), 'he attacks the edge enemy (range rule)');
    const ticks = tagged(h, u, COLLAPSE);
    assert.deepEqual(ticks.map((c) => c.target), [on, on], `${label(f)}: one hit a second on the ground enemy on the field`);
    for (const [i, c] of ticks.entries()) {
      approx(c.t, i + 1, 'from his deployment, once a second', 0.04);
      approx(c.amount, u.s.atk * tb.atk_scale, `${label(f)}: ${tb.atk_scale * 100} % ATK`);
      assert.deepEqual([c.type, c.dmg.isAttack, c.dmg.isSkill, c.dmg.canDodge, c.dmg.attackType], ['arts', false, false, true, 'NORMAL'], 'arts 普通伤害');
    }
    // it leaves the field: the cut lapses within a tick, no more damage
    on.x = 7.6;
    h.step(2);
    assert.equal(on.s.aspd, 100, `${label(f)}: the cut lapses`);
    h.run(2);
    assert.equal(tagged(h, u, COLLAPSE).length, 2, 'no damage off the field');
    done(h);
  }
});

test('T1 the shared 国度: two 国度 — an enemy on either field takes both talents\' damage every second and one ASPD cut, the strongest of those on the field (−20 then −15 once the AMB-X stage-3 one leaves)', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: AX, col: 3, others: [second({ tier: 5, row: 10, col: 8 })] });
  const v = h.unit(2);
  noSkill(h, u); noSkill(h, v);
  const onA = h.spawn('enemy_dummy', { pos: [9, 2] });     // his field only
  const onB = h.spawn('enemy_dummy', { pos: [11, 9] });    // the other's only
  for (const e of [onA, onB]) h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  h.run(2.05);
  for (const e of [onA, onB]) approx(e.s.aspd, 80, `${e.tileC}: −20, not −35`);
  for (const [src, scale] of [[u, 0.2], [v, 0.13]]) {
    for (const e of [onA, onB]) {
      const ts = tagged(h, src, COLLAPSE).filter((c) => c.target === e);
      assert.equal(ts.length, 2, `${src.id} on the enemy of ${e === onA ? 'his' : 'the other'} field`);
      approx(ts[0].amount, src.s.atk * scale, `${src.id}: ${scale * 100} %`);
    }
  }
  h.b.retreat(u);
  h.step(2);
  assert.equal(onA.s.aspd, 100, 'his field went with him');
  approx(onB.s.aspd, 85, 'the other\'s cut: −15');
  done(h);
});

test('T2 此身为界: knocked out — 0.7 s later 600 % (潜能 5+; 500 % below) of the ATK he had (temporary buffs included) as arts and a 5 s stun on every ground enemy standing on his field as it was; his field is gone at once', () => {
  for (const [tier, elite, mod, potential] of [[5, false, null, 6], [6, true, AX, 6], [5, false, null, 1], [6, true, AX, 4]]) {
    const tb = (elite ? formOf(tier, true) : formOf(tier, false)).talents.find((t) => t.index === 1);
    const scale = potential >= 5 ? 6 : 5;
    assert.deepEqual([tb.bb, tb.potBelow.bb], [{ atk_scale: 6, stun: 5 }, { atk_scale: 5, stun: 5 }]);
    const { h, u } = field({ tier, elite, mod, potential });
    noSkill(h, u);
    assert.equal(u.def.raw.talents.find((t) => t.index === 1).bb.atk_scale, scale, 'the composed record at that potential');
    const a = h.spawn('enemy_dummy', { pos: [10, 5] }), b = h.spawn('enemy_dummy', { pos: [9, 3] });
    const fly = h.spawn('enemy_fly', { pos: [11, 5] }), out = h.spawn('enemy_dummy', { pos: [10, 8] }), walker = h.spawn('enemy_dummy', { pos: [12, 8] });
    for (const e of [a, b, out, walker]) h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    h.run(0.5);
    h.b.addBuff(u, { key: 'test:atk', mods: { atkPct: 0.5 } });
    const atk = u.s.atk;
    approx(atk, u.base.atk * 1.5, 'ATK +50 % before the knock-out');
    h.b.kill(u, null);
    h.step(2);
    assert.equal(a.s.aspd, 100, 'his field is gone at once');
    b.x = 7.6;                                     // leaves the cached field before it lands
    walker.x = 5; walker.y = 11;                   // steps onto it
    h.run(KO_DELAY - 0.15);
    assert.equal(tagged(h, u, BOUNDARY_TAG).length, 0, `${label([tier, elite, mod])}: not before 0.7 s`);
    h.run(0.2);
    const hits = tagged(h, u, BOUNDARY_TAG);
    assert.deepEqual(new Set(hits.map((c) => c.target)), new Set([a, walker]), 'the ground enemies standing on his field as it was');
    for (const c of hits) {
      approx(c.amount, atk * scale, `${scale * 100} % of the cached ATK`);
      assert.equal(c.type, 'arts');
    }
    const stuns = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'stun');
    assert.deepEqual(new Set(stuns.map((c) => c.target)), new Set([a, walker]), 'stunned');
    for (const c of stuns) approx(c.duration, 5, '5 s');
    assert.ok(![b, fly, out].some((e) => e.s.flags.stun), 'not the flyer, not off the field');
    done(h);
  }
});

test('T2 此身为界: a retreat triggers it at once; a 复活 inside the `death` hook does not change what it cached; with S3 running, the cached ATK has the skill bonus and the expanded field (y-10, the spread tiles) counts', () => {
  {
    const { h, u } = field({ tier: 5 });
    noSkill(h, u);
    const a = h.spawn('enemy_dummy', { pos: [11, 4] });
    h.b.addBuff(a, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    h.run(0.3);
    const atk = u.s.atk;
    h.b.retreat(u);
    const hits = tagged(h, u, BOUNDARY_TAG);
    assert.equal(hits.length, 1, 'at once');
    approx(hits[0].amount, atk * 6, '600 %');
    assert.ok(a.s.flags.stun, 'stunned');
    done(h);
  }
  {
    // a revive at the 复活 priority (M3茧甲: 13) redeploys him inside the hook: the knock-out's ATK (+50 % then) still counts
    const { h, u } = field({ tier: 5 });
    noSkill(h, u);
    const a = h.spawn('enemy_dummy', { pos: [10, 5] });
    h.b.addBuff(a, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    h.b.on('death', (c) => { if (c.unit === u && c.reason === 'killed') h.b.redeploy(u); }, { priority: 13 });
    h.run(0.3);
    h.b.addBuff(u, { key: 'test:atk', mods: { atkPct: 0.5 } });
    const atk = u.s.atk;
    h.b.kill(u, null);
    assert.ok(u.alive && u.deployed && !u.findBuff('test:atk'), 'revived at once, without the buff');
    h.run(KO_DELAY + 0.05);
    const hits = tagged(h, u, BOUNDARY_TAG).filter((c) => c.target === a);
    assert.equal(hits.length, 1, 'it fired');
    approx(hits[0].amount, atk * 6, 'with the ATK of the knock-out');
    done(h);
  }
  const sk = skillOf(6, true, S3);
  const { h, u } = field({ tier: 6, elite: true, mod: AX, skill: 2, col: 3, others: [{ uid: 3, chessId: 'chess_char_1_02_a', row: 11, col: 3 }] });
  const ally = h.unit(3);
  const low = h.spawn('enemy_dummy', { pos: [12, 3] });    // y-10 only ([2,0])
  h.b.addBuff(low, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 1), 'S3 cast');
  h.run(0.2);
  const src = h.spawn('enemy_dummy', { pos: [10, 9] });
  h.b.addBuff(src, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  h.b.dealDamage({ source: src, target: ally, amount: 1, type: 'phys' });
  assert.ok(u.rangeKeySet.has(tileKey(10, 9)), 'spread');
  h.run(0.3);
  const atk = u.s.atk;
  approx(atk, u.base.atk * (1 + sk.bb.atk), 'S3 ATK');
  h.b.kill(u, null);
  h.run(KO_DELAY + 0.05);
  const hits = tagged(h, u, BOUNDARY_TAG);
  assert.deepEqual(new Set(hits.map((c) => c.target)), new Set([low, src]), 'the y-10 tile and the spread tile');
  for (const c of hits) approx(c.amount, atk * 6, 'with the S3 ATK');
  assert.ok(u.extraRangeKeys === null, 'the spread is gone');
  done(h);
});

test('S1 停步 (MANUAL, data DEFAULT, 20 s): ASPD +58 / +70; each enemy on the 国度 (air units too) is 停顿 3 / 4 s once — his mark holds until the skill ends —, a newcomer at once; marks gone at the end, a new cast again', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.bb], [20, elite ? 35 : 40, elite ? 18 : 14, elite ? { attack_speed: 70, sluggish: 4 } : { attack_speed: 58, sluggish: 3 }]);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['duration', 'DEFAULT']);
    const e = h.spawn('enemy_dummy', { pos: [10, 5] }), fly = h.spawn('enemy_fly', { pos: [9, 4] }), off = h.spawn('enemy_dummy', { pos: [10, 8] });
    for (const x of [e, off]) h.b.addBuff(x, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 2), `T${tier}: cast on his attack`);
    approx(u.skill.timeLeft, 20, '20 s', 0.05);
    approx(u.s.aspd, 100 + sk.bb.attack_speed, 'ASPD');
    const slugs = (t) => h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'sluggish' && c.target === t);
    h.step();
    for (const t of [e, fly]) {
      assert.equal(slugs(t).length, 1, `T${tier}: ${t.defId} 停顿`);
      approx(slugs(t)[0].duration, sk.bb.sluggish, `${sk.bb.sluggish} s`);
      assert.ok(t.findBuff(haltKey(u)), 'his mark');
    }
    assert.equal(slugs(off).length, 0, 'not off the field');
    // off the field and back: still marked, no second 停顿; a newcomer at once
    e.x = 8; h.step(3); e.x = 5; h.run(sk.bb.sluggish + 0.5);
    assert.equal(slugs(e).length, 1, 'once per cast');
    off.x = 6; h.step(2);
    assert.equal(slugs(off).length, 1, 'a newcomer at once');
    u.skill.extend(-999);
    h.step(2);
    assert.ok(!u.skill.active && ![e, fly, off].some((t) => t.findBuff(haltKey(u))), 'the marks end with the skill');
    assert.equal(u.s.aspd, 100);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 2, 3), 'again');
    h.step();
    assert.equal(slugs(e).length, 2, 'a new cast: 停顿 again');
    // he leaves: his marks go with him
    h.b.retreat(u);
    assert.ok(![e, fly, off].some((t) => t.findBuff(haltKey(u))), 'the marks end when he leaves');
    done(h);
  }
});

test('S2 受戮 (MANUAL, data ACTIVE_RANGE on y-3): an enemy only on y-3 casts it; y-3, ATK +40 % / +55 %; no phys / arts hit an enemy on the 国度 takes is cancelled by its dodge (whoever deals it); the first cast 20 s, from the second of a deployment ASPD +30 and no end', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.bb], [20, 50, elite ? 29 : 23, { atk: elite ? 0.55 : 0.4, attack_speed: 30 }]);
    const { h, u } = field({ tier, elite, skill: 1, others: [{ uid: 3, chessId: 'chess_char_1_08_a', row: 12, col: 7 }] });
    assert.deepEqual([u.skill.kind, u.skill.rule], ['toggle', 'ACTIVE_RANGE']);
    const on = h.spawn('enemy_dummy', { pos: [10, 7] });      // [0,3] of y-3, outside y-1
    const off = h.spawn('enemy_dummy', { pos: [12, 8] });
    for (const e of [on, off]) h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1, dodgeArts: 1 } });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: cast for [0,3]`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, 'y-3 while it runs');
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), 'ATK');
    assert.equal(u.s.aspd, 100, 'no ASPD on the first cast');
    approx(u.skill.timeLeft, 20, '20 s', 0.05);
    h.run(3);
    const mine = atkHits(h, u).filter((c) => c.target === on);
    assert.ok(mine.length >= 1 && mine.every((c) => c.amount > 0), `T${tier}: his attacks land on the dodging enemy on the 国度`);
    for (const type of ['phys', 'arts']) {
      assert.ok(h.b.dealDamage({ source: h.unit(3), target: on, amount: 100, type }) > 0, `${type}: another's hit on it lands`);
      assert.equal(h.b.dealDamage({ source: h.unit(3), target: off, amount: 100, type }), 0, `${type}: off the 国度 it dodges`);
    }
    h.run(17.5);
    assert.ok(!u.skill.active, `T${tier}: the first cast ends after 20 s`);
    assert.equal(h.b.dealDamage({ source: u, target: on, amount: 100, type: 'phys' }), 0, 'it dodges again');
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1), 'second cast');
    approx(u.s.aspd, 100 + sk.bb.attack_speed, 'ASPD +30');
    h.run(120);
    assert.ok(u.skill.active && u.skill.activations === 2, 'no end');
    // a new deployment counts again
    h.b.retreat(u);
    assert.ok(h.b.redeploy(u), 'redeployed');
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 1), 'first cast of the new deployment');
    assert.equal(u.s.aspd, 100);
    approx(u.skill.timeLeft, 20, '20 s again', 0.05);
    done(h);
  }
});

test('S3 无人的国度 (MANUAL, data ACTIVE_RANGE on y-10): y-10, ATK +55 % / +70 %, ASPD +20 / +30; a ground enemy damaging an ally on the 国度 spreads it to its tile and the four next to them (once per 0.5 s) for 50 % / 60 % ATK physical there, and he attacks there; flyer / hidden sources and allies off the 国度 spread nothing; reset at the end', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    assert.deepEqual([sk.duration, sk.spCost, sk.initSp, sk.bb], [36, elite ? 51 : 57, elite ? 30 : 25,
      elite ? { atk: 0.7, 'attack@aoe_atk_scale': 0.6, attack_speed: 30, 'attack@cd': 0.5 } : { atk: 0.55, 'attack@aoe_atk_scale': 0.5, attack_speed: 20, 'attack@cd': 0.5 }]);
    const { h, u } = field({ tier, elite, skill: 2, col: 3, others: [{ uid: 3, chessId: 'chess_char_1_02_a', row: 11, col: 3 }, { uid: 4, chessId: 'chess_char_1_08_a', row: 12, col: 10 }] });
    const ally = h.unit(3), away = h.unit(4);
    assert.deepEqual([u.skill.kind, u.skill.rule], ['duration', 'ACTIVE_RANGE']);
    u.skill.gainSp(999);
    const low = h.spawn('enemy_dummy', { pos: [12, 3] });   // [2,0]: y-10, not y-1
    h.b.addBuff(low, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    assert.ok(h.runUntil(() => u.skill.active, 1), `T${tier}: cast for [2,0]`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, 'y-10 while it runs');
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), 'ATK');
    approx(u.s.aspd, 100 + sk.bb.attack_speed, 'ASPD');
    h.run(0.2);
    assert.ok(ally.findBuff(guardKey(u)) && u.findBuff(guardKey(u)) && !away.findBuff(guardKey(u)), 'his buff on the allies on the 国度');
    const src = h.spawn('enemy_dummy', { pos: [10, 8] }), nearFly = h.spawn('enemy_fly', { pos: [9, 8] }), apart = h.spawn('enemy_dummy', { pos: [12, 8] });
    const flyer = h.spawn('enemy_fly', { pos: [11, 9] });
    const edge = h.spawn('enemy_dummy', { pos: [10, 10] });
    edge.x = 9.55;                                 // its tile is (10, 10); its collider reaches (10, 9), a spread tile
    h.step();
    const spreads = () => tagged(h, u, SPREAD_TAG);
    // a flyer's damage, damage to an ally off the 国度, a hidden enemy's damage: nothing
    h.b.dealDamage({ source: flyer, target: ally, amount: 1, type: 'phys' });
    h.b.dealDamage({ source: src, target: away, amount: 1, type: 'phys' });
    src.hidden = true;
    h.b.dealDamage({ source: src, target: ally, amount: 1, type: 'phys' });
    src.hidden = false;
    assert.deepEqual([spreads().length, u.extraRangeKeys ?? null], [0, null], 'no spread');
    // the ground enemy's damage on the ally: its tile and the four next to it, 60 % ATK physical to every enemy there
    h.b.dealDamage({ source: src, target: ally, amount: 1, type: 'phys' });
    assert.deepEqual([...u.extraRangeKeys].sort((a, b) => a - b), [tileKey(9, 8), tileKey(10, 7), tileKey(10, 8), tileKey(10, 9), tileKey(11, 8)].sort((a, b) => a - b), 'x-5 around it');
    assert.ok(u.rangeKeySet.has(tileKey(10, 8)) && u.rangeKeySet.has(tileKey(12, 3)), 'his range grows');
    assert.deepEqual(new Set(spreads().map((c) => c.target)), new Set([src, nearFly]), 'the enemies standing there, air units too');
    assert.ok(!spreads().some((c) => c.target === edge), 'not the enemy whose collider only reaches a spread tile (the tile rule)');
    for (const c of spreads()) {
      approx(c.amount, u.s.atk * sk.bb['attack@aoe_atk_scale'], `${sk.bb['attack@aoe_atk_scale'] * 100} % ATK`);
      assert.deepEqual([c.type, c.dmg.isSkill], ['phys', true]);
    }
    // once per 0.5 s
    h.b.dealDamage({ source: apart, target: u, amount: 1, type: 'phys' });   // he stands on the 国度 too
    assert.equal(spreads().length, 2, 'cooling down');
    h.run(0.5);
    h.b.dealDamage({ source: apart, target: u, amount: 1, type: 'phys' });
    assert.ok(u.rangeKeySet.has(tileKey(12, 8)) && spreads().some((c) => c.target === apart), 'after 0.5 s');
    // he attacks the enemy on the spread tiles
    const n0 = atkHits(h, u).length;
    h.run(4);
    assert.ok(atkHits(h, u).slice(n0).some((c) => c.target === src), 'attacked there');
    approx(src.s.aspd, 100 + collapseOf(tier, elite, null).attack_speed, 'the field\'s ASPD cut there');
    u.skill.extend(-999);
    h.step(2);
    assert.deepEqual([u.skill.active, u.extraRangeKeys, u.liveRangeGrid], [false, null, formOf(tier, elite).rangeGrid], 'reset to y-1');
    assert.ok(!ally.findBuff(guardKey(u)), 'his buff gone');
    h.step(2);
    assert.equal(src.s.aspd, 100, 'off the 国度 again');
    done(h);
  }
});

test('S3 "同时攻击“国度”上的所有敌人": with a second 国度, the ground enemies on its field join each of his attacks', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: AX, skill: 2, col: 3, others: [second({ tier: 5, row: 10, col: 8 })] });
  const v = h.unit(2);
  noSkill(h, v);
  const mine = h.spawn('enemy_dummy', { pos: [10, 4] }), theirs = h.spawn('enemy_dummy', { pos: [9, 8] }), fly = h.spawn('enemy_fly', { pos: [11, 8] });
  for (const e of [mine, theirs]) h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 1));
  const n0 = h.hooksOf('dodge').length;
  h.run(6);
  const struck = h.hooksOf('dodge').slice(n0).filter((c) => c.source === u && c.dmg.isAttack);
  const ids = new Set(struck.filter((c) => c.target === theirs).map((c) => c.dmg.attackId));
  assert.ok(ids.size >= 1, 'the enemy on the other field is struck');
  for (const id of ids) assert.ok(struck.some((c) => c.target === mine && c.dmg.attackId === id), 'by his attacks on his own targets');
  assert.ok(!h.hooksOf('damaged').some((c) => c.source === u && c.dmg.isAttack && c.target === fly), 'ground only');
  done(h);
});

test('AMB-X “空瓶罐们”: every enemy of his range (air units too) moves ×0.8 (stages 1 and 3), the S3 spread tiles included; two 国度 with it: ×0.64; none without it', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod });
    noSkill(h, u);
    const e = h.spawn('enemy_dummy', { pos: [10, 5] }), fly = h.spawn('enemy_fly', { pos: [9, 4] }), off = h.spawn('enemy_dummy', { pos: [10, 8] });
    h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    h.run(0.6);
    const x = elite && mod === AX;
    if (x) assert.deepEqual(modOf(tier, AX).talentChanges.find((t) => t.talentIndex === -1).bb, { move_speed: -0.2 });
    for (const t of [e, fly]) approx(t.findBuff(ambxKey(u))?.mods.moveMul ?? 1, x ? 0.8 : 1, `${label(f)}: ${t.defId}`);
    assert.equal(off.findBuff(ambxKey(u)), null, 'not off his range');
    done(h);
  }
  {
    const { h } = field({ tier: 5, elite: true, mod: AX, others: [second({ tier: 6, elite: true, mod: AX, row: 11, col: 4 })] });
    for (const id of [1, 2]) noSkill(h, h.unit(id));
    const e = h.spawn('enemy_walkslow', { pos: [10, 5] });
    h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
    h.run(0.5);
    approx(e.s.moveSpeed, e.base.moveSpeed * 0.8 * 0.8, 'two AMB-X slows multiply');
    done(h);
  }
  // S3's spread tiles are his attack range: the slow reaches them
  const { h, u } = field({ tier: 6, elite: true, mod: AX, skill: 2, col: 3 });
  const low = h.spawn('enemy_dummy', { pos: [12, 3] });
  h.b.addBuff(low, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 1), 'S3 cast');
  h.run(0.2);
  const far = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.step();
  assert.equal(far.findBuff(ambxKey(u)), null, 'not in his range yet');
  h.b.dealDamage({ source: far, target: u, amount: 1, type: 'phys' });
  h.run(0.3);
  approx(far.findBuff(ambxKey(u))?.mods.moveMul ?? 1, 0.8, 'slowed on the spread tile');
  done(h);
});

test('国度 on screen: a \'domain\' fx with his field\'s tiles every 0.5 s, keyed by the unit (render/fx/zones.js domainField)', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: AX });
  h.run(1.1);
  const fx = h.eventsOf('fx').filter((f) => f[1] === 'domain' && f[4]?.id === u.id);
  assert.ok(fx.length >= 2, `a pulse every 0.5 s: ${fx.length}`);
  const last = fx.at(-1)[4];
  assert.equal(last.key, `domain:${u.id}`);
  assert.deepEqual(last.tiles.map(([r, c]) => r * COLS + c).sort((a, b) => a - b), [...u.rangeKeys].sort((a, b) => a - b), 'his range tiles');
  assert.ok(last.dur > 0.5, 'it outlives the next pulse');
  checkInvariants(h.b);
});
