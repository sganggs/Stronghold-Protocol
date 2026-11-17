// test/content/standin_sharp2.test.js — the 补位 stand-in 领主·Sharp (char_617_sharp2, 6★ 近卫·领主; kit
// server/sim/content/kits/ops/standin-sharp2.js) on every chess it replaces, always with S1 沉默的爆发: 水月 (tier 4),
// 玛恩纳 (tier 5, LOR-X), 维娜·维多利亚 / 妮芙 (tier 6, LOR-X), normal (E2 Lv1, skill 4) and elite (E2 Lv60, skill 7).
// Every number is read back from data/backups.json (the form of that chess's status).
// Run: node --test test/content/standin_sharp2.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitForm } from '../../shared/standIn.js';
import { isHpLoss } from '../../server/sim/attack.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const CHAR = 'char_617_sharp2';
const UNIT = BACKUPS.units[CHAR];
const formOf = (id) => unitForm(BACKUPS, CHAR, CHESS[id].status);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }), enemy_res: dummy('enemy_res', { res: 50 }),
};

function battle(units, o = {}) {
  return makeBattle({
    defs: { enemies: ENEMIES }, units, timeLimit: o.timeLimit ?? 200, autoFinish: false, seed: o.seed ?? 5,
    flags: { dpPerSec: 0 }, hooks: ['damaged', 'skillStart', 'skillEnd'], captureNoisy: true,
  });
}
const SHARP2 = (id, standIn = true) => ({ chessId: id, row: 10, col: 4, standIn });
/** Her normal / skill attack hits (no 流失). */
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
/** The LOR-X 流失 she causes. */
const lorx = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && isHpLoss(c.dmg) && c.dmg.tags.includes('sharp2:lorx'));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('领主·Sharp on every chess she replaces (normal + elite): her body and range 3-12, S1, this kit; LOR-X on the tier-5 / 6 elites only', () => {
  const ids = UNIT.standsIn.flatMap((a) => [a, a.replace(/_a$/, '_b')]);
  assert.equal(ids.length, 8);
  const withModule = [];
  for (const id of ids) {
    const c = CHESS[id], form = formOf(id);
    const h = battle([SHARP2(id)]);
    h.step();
    const u = h.unit(1);
    assert.deepEqual([u.def.charId, u.def.standInFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [CHAR, c.charId, 'skchr_sharp2_1', false, 'skills'], id);
    const mod = c.backup.uniEquipId && c.status.equipLevel > 0 ? form.modules.find((m) => m.uniEquipId === c.backup.uniEquipId) : null;
    assert.equal(!!u.def.raw.module?.active, !!mod, `${id}: module`);
    if (mod) withModule.push(`${id} L${mod.level}`);
    assert.equal(u.base.atk, form.stats.atk + (mod?.attr.atk ?? 0), `${id}: ATK`);
    assert.deepEqual([u.profile.sub, u.profile.attack, u.profile.canHitFly, u.s.blockCnt, u.profile.rangedScale], ['lord', 'ranged', true, 2, 0.8], `${id}: lord, ranged, hits air units, blocks 2, trait 80 %`);
    assert.deepEqual(u.rangeGrid, form.rangeGrid, `${id}: range`);
    assert.equal(form.rangeId, '3-12');
    assert.equal(u.skill.rule, 'DEFAULT', `${id}: S1 has no range of its own — the basic strategy`);
    assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth, `${id}: ground enemies can target her`);
    done(h);
  }
  assert.deepEqual(withModule, ['chess_char_5_19_b L1', 'chess_char_6_07_b L3', 'chess_char_6_10_b L3']);
});

test('领主·Sharp trait: ranged attacks at 80 % ATK — full ATK on her tile, the tile in front and an enemy she blocks; air units too; nothing beyond the 3-12 range', () => {
  const ratio = (key, pos) => {
    const h = battle([SHARP2('chess_char_4_09_a')]);
    h.step();
    const u = h.unit(1);
    const e = h.spawn(key, { pos, ...(key === 'enemy_fly' ? { route: 2 } : {}) });
    h.run(6); // S1 is not ready before 23 s
    const hits = atkHits(h, u);
    done(h);
    if (!hits.length) return null;
    assert.ok(hits.every((c) => c.target === e && !c.dmg.isSkill));
    return hits[0].amount / u.s.atk;
  };
  approx(ratio('enemy_dummy', [10, 6]), 0.8, 'two tiles ahead: ranged');
  approx(ratio('enemy_dummy', [10, 7]), 0.8, 'the far end of her line');
  approx(ratio('enemy_dummy', [9, 5]), 0.8, 'the diagonal tile');
  approx(ratio('enemy_dummy', [10, 5]), 1, 'the tile in front');
  approx(ratio('enemy_dummy', [10, 4]), 1, 'blocked on her tile');
  approx(ratio('enemy_fly', [10, 6]), 0.8, 'an air unit');
  assert.equal(ratio('enemy_dummy', [10, 8]), null, 'out of range');
});

test('领主·Sharp S1 沉默的爆发 (水月): ATK +130 % / +180 %, ASPD +35 / +50, two targets, no ranged reduction for 30 s; then one target at 80 % again', () => {
  for (const id of ['chess_char_4_09_a', 'chess_char_4_09_b']) {
    const sk = formOf(id).skills[0], bb = sk.bb;
    const h = battle([SHARP2(id)]);
    h.step();
    const u = h.unit(1);
    const t0 = u.def.raw.talents.find((t) => t.index === 0).bb, t1 = u.def.raw.talents.find((t) => t.index === 1).bb;
    const near = h.spawn('enemy_dummy', { pos: [10, 6] }), far = h.spawn('enemy_dummy', { pos: [10, 7] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3), `${id}: cast (DEFAULT)`);
    const t = h.b.time;
    approx(u.s.atk, u.base.atk * (1 + t0.atk + bb.atk), `${id}: ATK +${bb.atk}`);
    assert.equal(u.s.aspd, 100 + bb.attack_speed + t1.attack_speed, `${id}: ASPD +${bb.attack_speed} (and 陷阵勇气 with two enemies)`);
    assert.deepEqual(u.liveRangeGrid, formOf(id).rangeGrid, `${id}: the range stays 3-12`);
    h.run(10);
    const hits = atkHits(h, u).filter((c) => c.dmg.isSkill && c.t < t + 10);
    const per = new Map();
    for (const c of hits) per.set(c.dmg.attackId, [...(per.get(c.dmg.attackId) ?? []), c.target]);
    assert.ok(per.size >= 5, `${id}: ${per.size} attacks`);
    for (const targets of per.values()) assert.deepEqual(new Set(targets), new Set([near, far]), `${id}: both targets every attack`);
    for (const c of hits) approx(c.amount, u.s.atk, `${id}: full ATK at range`);
    assert.ok(h.runUntil(() => !u.skill.active, 25));
    approx(h.b.time - t, sk.duration, `${id}: ${sk.duration} s`, 0.01);
    const n = atkHits(h, u).length;
    h.run(5);
    const after = atkHits(h, u).slice(n).filter((c) => c.t > h.b.time - 4);
    assert.ok(after.length >= 2, `${id}: attacks after`);
    const ids = new Map();
    for (const c of after) { ids.set(c.dmg.attackId, (ids.get(c.dmg.attackId) ?? 0) + 1); approx(c.amount, u.s.atk * 0.8, `${id}: 80 % again`); }
    assert.ok([...ids.values()].every((v) => v === 1), `${id}: one target again`);
    done(h);
  }
});

test('领主·Sharp talents: 无声之锋 ATK + / arts dodge (LOR-X level 3: +25 % / 35 %); 陷阵勇气 ASPD +12 while two enemies she can target are on her range', () => {
  const want = { chess_char_4_09_a: [0.2, 0.25], chess_char_5_19_b: [0.2, 0.25], chess_char_6_10_b: [0.25, 0.35] };
  for (const [id, [atk, dodge]] of Object.entries(want)) {
    const h = battle([SHARP2(id)]);
    h.step();
    const u = h.unit(1);
    const t1 = u.def.raw.talents.find((t) => t.index === 1).bb;
    assert.deepEqual([t1.cnt, t1.attack_speed], [2, 12]);
    approx(u.s.atk, u.base.atk * (1 + atk), `${id}: ATK`);
    approx(u.s.dodgeArts, dodge, `${id}: arts dodge`);
    assert.equal(u.s.dodgePhys, 0, `${id}: no physical dodge`);
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.spawn('enemy_dummy', { pos: [10, 8] }); // out of her range
    h.run(0.5);
    assert.equal(u.s.aspd, 100, `${id}: one enemy on her range`);
    h.spawn('enemy_fly', { pos: [9, 5], route: 2 });
    h.run(0.5);
    assert.equal(u.s.aspd, 112, `${id}: two (an air unit counts: she can target it)`);
    done(h);
  }
});

test('领主·Sharp LOR-X (玛恩纳 / 妮芙 精锐): every damage she deals makes its target lose 10 % of her ATK — a 流失: no RES, through a shield; nothing without the module', () => {
  for (const id of ['chess_char_5_19_b', 'chess_char_6_10_b']) {
    const h = battle([SHARP2(id)]);
    h.step();
    const u = h.unit(1);
    const m = u.def.raw.talents.find((t) => t.index === -1).bb.magic_atk_scale;
    assert.equal(m, 0.1);
    const e = h.spawn('enemy_res', { pos: [10, 6] }); // RES 50
    h.run(4);
    const hits = atkHits(h, u), losses = lorx(h, u);
    assert.ok(hits.length >= 2 && losses.length === hits.length, `${id}: one loss per hit (${losses.length} / ${hits.length})`);
    for (const c of hits) approx(c.amount, u.s.atk * 0.8, `${id}: the attack: physical, 80 % at range (DEF 0)`);
    for (const c of losses) { assert.equal(c.target, e); approx(c.amount, u.s.atk * m, `${id}: the arts 流失 ignores RES 50`); }
    // a shield takes the attack but not the loss
    h.b.addBuff(e, { key: 'test:shield', shield: 1e9 });
    const hp = e.hp, n = lorx(h, u).length;
    h.run(4);
    const more = lorx(h, u).length - n;
    assert.ok(more >= 2, `${id}: losses behind the shield`);
    approx(hp - e.hp, more * u.s.atk * m, `${id}: only the losses reach the HP`);
    done(h);
  }
  for (const [id, standIn] of [['chess_char_4_09_b', true], ['chess_char_6_10_b', { moduleId: 'none' }], ['chess_char_6_10_a', true]]) {
    const h = battle([SHARP2(id, standIn)]);
    h.step();
    const u = h.unit(1);
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(4);
    assert.ok(atkHits(h, u).length >= 2);
    assert.equal(lorx(h, u).length, 0, `${id} ${JSON.stringify(standIn)}: no LOR-X`);
    done(h);
  }
});
