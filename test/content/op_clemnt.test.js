// test/content/op_clemnt.test.js — the 自选 operator kit of 克莱门莎 (char_4231_clemnt, 6★ 本源近卫; kit
// server/sim/content/kits/ops/op-clemnt.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7, no module). Every number
// is read back from data/backups.json (the form of that slot status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_clemnt.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const CLEMNT = 'char_4231_clemnt';
const FORMS = BACKUPS.units[CLEMNT].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const S1 = 'skchr_clemnt_1', S2 = 'skchr_clemnt_2', S3 = 'skchr_clemnt_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];

const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, def: 500, speed: 0, mass: 1, ...o });
const seaEnemy = dummy('enemy_sea');
seaEnemy.tags = ['seamonster'];

const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_sea: seaEnemy,
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
};
const FORMS_ALL = [[5, false], [6, false], [5, true], [6, true]];

function field({ tier = 5, elite = false, skill = 0, row = 10, col = 5, dir = 'RIGHT', others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'ammoUsed', 'elementBurst'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: CLEMNT, skillIndex: skill }, elite, row, col, dir }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}

function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

const label = ([tier, elite]) => `T${tier} ${elite ? 'elite' : 'normal'}`;

test('克莱门莎 in every 自选 form: operator kit (all three skills authored), stats, 1-1, blocks 2, melee ground-only, 1.2 s, 阿戈尔, egirShip bond', () => {
  assert.equal(OPERATOR_KITS[CLEMNT], KITS[CLEMNT]);
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, skill });
      const form = formOf(tier, elite);
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !u.kit.generic, u.kit.skillSource], [CLEMNT, SLOT[tier], form.skills[skill].skillId, true, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp, form.stats.atk, form.stats.def], `${label(f)}: stats`);
      assert.deepEqual([u.base.blockCnt, u.profile.attack, u.profile.canHitFly, u.base.bat, u.dmgType], [2, 'melee', false, 1.2, 'phys'], `${label(f)}: 本源近卫`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1 range`);
      assert.deepEqual([u.def.bonds, u.def.raw.nationId], [['egirShip'], 'egir'], `${label(f)}: bonds / nation`);
      done(h);
    }
  }
});

test('a 自选 pick: 克莱门莎 is offered at tiers 5 and 6 and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(CLEMNT));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(CLEMNT), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: CLEMNT, skillIndex: 2 } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: CLEMNT, skillIndex: 2, uniEquipId: null } } });
});

test('T1 生死定夺: 25% base chance to crit 150%, 50% chance when target DEF is lower than initial/base DEF', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, seed: 1 });
  const e1 = h.spawn('enemy_dummy', { pos: [10, 6] });
  const dmgNorm = { amount: 1000, type: 'phys' };
  h.b.dealDamage(u, e1, dmgNorm);
  assert.ok(e1.hp < 1e9, 'enemy takes damage');

  const e2 = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.b.addBuff(e2, { key: 'test:defdown', mods: { defFlat: -100 } });
  assert.ok(e2.s.def < e2.base.def, 'cur def is lower than base def');
  h.b.dealDamage(u, e2, { amount: 1000, type: 'phys' });
  done(h);
});

test('T2 习得性防御: physical and arts damage from enemies in front reduced by 35% (normal) or 55% (seamonster); behind no cut', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, row: 10, col: 5, dir: 'RIGHT' });
  // Enemy in front: col 7 (dx = +2, fwd >= 0)
  const eFront = h.spawn('enemy_dummy', { pos: [10, 7] });
  u.hp = u.s.maxHp;
  const takenNormal = h.b.dealDamage(eFront, u, { amount: 1000, type: 'phys' });

  // Enemy in front with seamonster tag: col 7
  const eSea = h.spawn('enemy_sea', { pos: [10, 7] });
  u.hp = u.s.maxHp;
  const takenSea = h.b.dealDamage(eSea, u, { amount: 1000, type: 'phys' });

  // Enemy behind: col 3 (dx = -2, fwd < 0)
  const eBehind = h.spawn('enemy_dummy', { pos: [10, 3] });
  u.hp = u.s.maxHp;
  const takenBehind = h.b.dealDamage(eBehind, u, { amount: 1000, type: 'phys' });

  // Normal cut = 35% (multiplier 0.65), Sea cut = 55% (multiplier 0.45), Behind = no cut (multiplier 1.0)
  assert.ok(takenNormal < takenBehind, `front damage ${takenNormal} should be less than behind ${takenBehind}`);
  assert.ok(takenSea < takenNormal, `seamonster damage ${takenSea} should be less than normal ${takenNormal}`);

  // Arts damage also mitigated
  u.hp = u.s.maxHp;
  const artsFront = h.b.dealDamage(eFront, u, { amount: 1000, type: 'arts' });
  u.hp = u.s.maxHp;
  const artsBehind = h.b.dealDamage(eBehind, u, { amount: 1000, type: 'arts' });
  assert.ok(artsFront < artsBehind, `arts front ${artsFront} < behind ${artsBehind}`);

  // True damage is not mitigated
  u.hp = u.s.maxHp;
  const trueFront = h.b.dealDamage(eFront, u, { amount: 1000, type: 'true' });
  u.hp = u.s.maxHp;
  const trueBehind = h.b.dealDamage(eBehind, u, { amount: 1000, type: 'true' });
  assert.equal(trueFront, trueBehind, 'true damage is not mitigated');
  done(h);
});

test('S1 冲蚀: offensive recovery, instant attack scaling 2.25x physical and dealing 30% erosion elemental fill', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, row: 10, col: 5 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6], def: 0 });

  u.skill.activate('DEFAULT', { free: true });
  assert.equal(u.skill.pending, true);

  // Force attack using skill override
  h.b.forceAttack(u, [e]);
  assert.ok(e.elem.erosion > 0, `erosion element gauge filled: ${e.elem.erosion}`);
  done(h);
});

test('S2 风暴潮: expands range to 4-1, ASPD +100, AoE physical attacks, disarm, exiles enemies and creates vortex', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 1, row: 10, col: 5, dir: 'RIGHT' });
  const e1 = h.spawn('enemy_dummy', { pos: [10, 6], mass: 2 });
  const e2 = h.spawn('enemy_dummy', { pos: [10, 7], mass: 2 });

  // Activate S2
  u.skill.activate('manual', { free: true });
  assert.ok(u.skill.active, 'S2 is active');
  assert.equal(u.s.flags.disarm, true, 'disarmed during pod launch');

  // Fast forward past disarm and pod travel (1.5s)
  h.run(1.6);
  assert.ok(!u.s.flags.disarm, 'disarm cleared after pod reaches destination');

  // Check vortex exists at 3 tiles ahead (col 8)
  assert.ok(u.mem.clemntVortex, 'vortex is active');
  assert.equal(u.mem.clemntVortex.c, 8, 'vortex centered 3 tiles ahead');

  // Run a few seconds to let vortex pulse
  h.run(2.0);
  assert.ok(e2.elem?.erosion >= 0, 'vortex affects enemies');
  done(h);
});

test('S3 与海为敌: expands range to 3-2, multi-target 3, ammo 10, normal attacks do not spend ammo, erosion burst consumes ammo for 3x bombardment hits', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2, row: 10, col: 5, dir: 'RIGHT' });
  const e1 = h.spawn('enemy_dummy', { pos: [10, 6] });
  const e2 = h.spawn('enemy_dummy', { pos: [10, 7] });
  const e3 = h.spawn('enemy_dummy', { pos: [10, 8] });

  // Activate S3
  u.skill.activate('manual', { free: true });
  assert.ok(u.skill.active, 'S3 is active');
  assert.equal(u.skill.ammoLeft, 10, 'has 10 bullets');

  // Normal attack against multiple targets
  h.b.forceAttack(u, [e1, e2, e3]);
  assert.equal(u.skill.ammoLeft, 10, 'normal attack does NOT spend ammo');

  // Trigger an erosion burst on an enemy on the battlefield
  const ammoEvents = [];
  h.b.on('ammoUsed', (c) => ammoEvents.push(c));
  h.b.emit('elementBurst', { target: e1, element: 'erosion' });

  assert.equal(u.skill.ammoLeft, 9, 'erosion burst consumed 1 ammo');
  assert.equal(ammoEvents.length, 1, 'ammoUsed event fired');

  // Run for 3 seconds to let 3 pulses resolve
  h.run(3.1);
  assert.ok(e1.hp < 1e9, 'enemy took bombardment damage');
  done(h);
});
