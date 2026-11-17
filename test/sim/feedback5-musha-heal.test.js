// test/sim/feedback5-musha-heal.test.js — the 武者 trait heal on every damage instance (PRTS 分支特性信息 武者 "特性治疗于干员每次
// 输出伤害时触发（不局限于攻击）", "常态持有禁疗；通过自身特性/天赋/技能产生的作用于自身的治疗效果会无视自身的禁疗") —
// server/sim/professions.js installMushaHeal; 赫拉格's kit no longer patches his double strikes (op-helage.js), 左乐's S1 reads
// his HP when it fires (op-zuole.js).
// Run: node --test test/sim/feedback5-musha-heal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const VALUE = 50;
/** A 武者 (trait bb value 50) hitting `hits` times per attack; an enemy that dodges `dodge` of physical hits. */
function field({ hits = 1, dodge = 0, kit = null } = {}) {
  const musha = chessRec({ id: 't_musha', subProfessionId: 'musha', stats: { maxHp: 1e6, atk: 100, bat: 1, def: 0 }, skill: null });
  musha.trait = { desc: '', bb: { value: VALUE } };
  const medic = chessRec({ id: 't_medic', profession: 'MEDIC', stats: { maxHp: 1000, atk: 300, bat: 1 }, skill: null, rangeGrid: [[0, 0], [0, -1], [0, -2]] });
  const h = makeBattle({
    defs: { chess: { t_musha: musha, t_medic: medic }, enemies: { e: { ...enemyRec({ key: 'e', hp: 1e9, speed: 0 }) } } },
    kits: { t_musha: () => ({ trait: { hits, ...(kit?.trait ?? {}) }, ...(kit?.rest ?? {}) }) },
    units: [{ chessId: 't_musha', row: 10, col: 5 }, { chessId: 't_medic', row: 10, col: 7 }], enemies: [{ key: 'e', pos: [10, 6] }],
    content: 'generic', autoFinish: false, timeLimit: 60, hooks: ['heal', 'damaged', 'attack', 'dodge'], captureNoisy: true,
    setup: (b) => { if (dodge) b.on('enemySpawn', ({ enemy }) => { b.addBuff(enemy, { key: 'test:dodge', mods: { dodgePhys: dodge } }); }); },
  });
  h.step();
  const u = h.unit('t_musha');
  u.hp = u.s.maxHp / 2;
  return { h, u, e: h.enemies()[0] };
}
const traitHeals = (h, u) => h.hooksOf('heal').filter((c) => c.source === u && c.target === u && c.opts?.self && !c.opts?.tags);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

test('a double strike heals twice: one heal of the trait value per damage instance of the attack (it used to heal once per enemy struck)', () => {
  const { h, u } = field({ hits: 2 });
  h.run(3.05);
  const atks = h.hooksOf('attack').filter((c) => c.attacker === u).length;
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isAttack).length;
  assert.ok(atks >= 3 && hits === 2 * atks, `${atks} attacks, ${hits} hits`);
  assert.equal(traitHeals(h, u).length, hits, 'a heal per hit');
  assert.ok(traitHeals(h, u).every((c) => c.amount === VALUE));
  done(h);
});

test('source output heals before dodge and includes BUFF damage; HP loss and element gauges remain excluded', () => {
  const { h, u, e } = field({ dodge: 1 });
  h.run(2.05);
  assert.ok(h.hooksOf('dodge').some((c) => c.source === u), 'its hits were dodged');
  assert.equal(traitHeals(h, u).length, h.hooksOf('dodge').filter(c => c.source === u).length,
    'one source-output heal before each target dodge');
  const n0 = traitHeals(h, u).length;
  h.b.dealDamage(u, e, { amount: 100, type: 'arts', isSkill: true, canDodge: false, tags: ['skill'] });
  h.b.dealDamage(u, e, { amount: 100, type: 'true', canDodge: false, tags: ['item', 'item:test'] });
  assert.equal(traitHeals(h, u).length - n0, 2, 'skill and item damage heal');
  h.b.loseHp(e, 100, { source: u });
  h.b.dealDamage(u, e, { type: 'element', element: 'burn', amount: 100 });
  assert.equal(traitHeals(h, u).length - n0, 2, 'no source output for HP loss or an element gauge');
  h.b.dealDamage(u, e, { amount: 100, type: 'arts', canDodge: false, tags: ['talent', 'dot'] });
  assert.equal(traitHeals(h, u).length - n0, 3, 'native Musha templates do not exclude BUFF damage');
  done(h);
});

test('禁疗 does not stop the trait heal ("会无视自身的禁疗"); another unit\'s heal still does not reach it', () => {
  const { h, u } = field();
  h.b.addBuff(u, { key: 'test:healFree', status: 'healFree', flags: { noHeal: true, healFree: true } });
  const hp0 = u.hp;
  h.run(1.05);
  assert.ok(traitHeals(h, u).length >= 1 && u.hp > hp0, 'healed through 禁疗');
  assert.equal(h.hooksOf('heal').filter((c) => c.target === u && c.source !== u).length, 0, 'the medic never heals it');
  assert.equal(h.b.heal(h.unit('t_medic'), u, 500), 0);
  done(h);
});

test('宴 (the chess): one heal per hit of her attacks', () => {
  const h = makeBattle({
    defs: { enemies: { e: enemyRec({ key: 'e', hp: 1e9, speed: 0 }) } }, units: [{ chessId: 'chess_char_1_18_a', row: 10, col: 5 }],
    enemies: [{ key: 'e', pos: [10, 6] }], autoFinish: false, timeLimit: 60, hooks: ['heal', 'damaged'], captureNoisy: true, seed: 5,
  });
  h.run(8);
  const u = h.unit('chess_char_1_18_a');
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.target.side === 'enemy' && c.type !== 'element' && !(c.dmg.tags || []).includes('dot')).length;
  assert.ok(hits >= 3);
  assert.equal(traitHeals(h, u).length, hits);
  done(h);
});
