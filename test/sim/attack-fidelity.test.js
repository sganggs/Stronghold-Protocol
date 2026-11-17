// Intentional differences from the v0.3.1 settlement (DESIGN §35.32 records its outcomes): assert the sourced rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mitigate } from '../../server/sim/attack.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function defensiveSkill(chessId, skillIndex = 0) {
  const h = makeBattle({ defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, speed: 0, atk: 0 }) } },
    units: [{ uid: 'defender', chessId, row: 10, col: 5, skillIndex, carryState: { sp: 999 } }], autoFinish: false });
  h.step();
  const u = h.unit('defender'), e = h.spawn('enemy_probe', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 3));
  return { h, b: h.b, u, e };
}

for (const type of ['phys', 'arts', 'true', 'elemental']) {
  test(`Executor S2: ${type} dodge uses the instance route and refills only its own successful dodge`, () => {
    for (const applyWay of ['MELEE', 'NONE', 'ALL', 'RANGED']) {
      const { b, u, e } = defensiveSkill('chess_char_5_01_a', 1);
      b.rng = () => 0;
      u.skill.ammoLeft = 1;
      // A route belongs to the instance, even when it disagrees with the source profile/projectile tag.
      e.profile = { ...e.profile, melee: applyWay === 'RANGED' };
      const dodges = [];
      b.on('dodge', c => dodges.push(c));
      const removed = b.dealDamage({ source: e, credit: null, target: u, amount: 100, type, applyWay, isProjectile: true });
      assert.equal(removed === 0, applyWay !== 'RANGED', applyWay);
      assert.equal(u.skill.ammoLeft, applyWay === 'RANGED' ? 1 : 2);
      assert.equal(dodges.length, applyWay === 'RANGED' ? 0 : 1);
      if (dodges.length) assert.equal(dodges[0].source, e);
    }
  });
}

test('Executor S2 obeys ignore/uncancellable modes, requires actual enemy source and ends with the skill', () => {
  for (const mode of ['normal', 'ignore', 'uncancellable']) {
    const { b, u, e } = defensiveSkill('chess_char_5_01_a', 1);
    let rolls = 0;
    b.rng = () => { rolls++; return 0; };
    u.skill.ammoLeft = 1;
    b.dealHPLose({ source: e, target: u, amount: 1 });
    b.dealElementDamage({ source: e, target: u, amount: 1, element: 'burn' });
    b.dealDamage({ source: null, credit: e, target: u, amount: 1, type: 'true', applyWay: 'MELEE' });
    b.dealDamage({ source: u, target: u, amount: 1, type: 'true', applyWay: 'MELEE' });
    assert.equal(u.skill.ammoLeft, 1);
    assert.equal(rolls, 0);
    const hp = u.hp;
    b.dealDamage({ source: e, target: u, amount: 100, type: 'true', applyWay: 'MELEE', dodgeMode: mode });
    assert.equal(u.hp === hp, mode === 'normal');
    assert.equal(u.skill.ammoLeft, mode === 'ignore' ? 1 : 2);
    assert.equal(rolls, mode === 'ignore' ? 0 : 1);
    u.skill.end('test');
    assert.equal(u.findBuff('excu2:meleeDodge'), null);
  }
});

test('Executor S2 legacy route inference follows instance projectile/attack metadata, not source range', () => {
  for (const isAttack of [false, true]) for (const isProjectile of [false, true]) {
    const { b, u, e } = defensiveSkill('chess_char_5_01_a', 1);
    b.rng = () => 0;
    u.skill.ammoLeft = 1;
    const removed = b.dealDamage(e, u, { amount: 100, type: 'true', isAttack, isProjectile });
    assert.equal(removed > 0, isProjectile);
    assert.equal(u.skill.ammoLeft, isProjectile ? 1 : 2);
  }
});

test('Executor S2 +2000 priority beats an earlier ordinary shield but stops after a +3000 shield', () => {
  for (const priority of [0, 3000]) {
    const { b, u, e } = defensiveSkill('chess_char_5_01_a', 1);
    u.skill.end('test');
    b.addBuff(u, { key: 'shield', shieldHits: 1, injuryPriority: priority });
    assert.ok(u.skill.activate('test', { free: true }));
    u.skill.ammoLeft = 1;
    let rolls = 0;
    b.rng = () => { rolls++; return 0; };
    b.dealDamage({ source: e, target: u, amount: 100, type: 'true', applyWay: 'MELEE' });
    assert.equal(!!u.findBuff('shield'), priority === 0);
    assert.equal(rolls, priority === 0 ? 1 : 0);
    assert.equal(u.skill.ammoLeft, priority === 0 ? 2 : 1);
  }
});

test('Lappland S1 uses dodge outcomes and request policy, independently of source/credit', () => {
  for (const mode of ['normal', 'ignore', 'uncancellable']) {
    const { b, u, e } = defensiveSkill('chess_char_2_16_a');
    b.rng = () => 0;
    const dodges = [], blocks = [];
    b.on('dodge', c => dodges.push(c));
    b.on('block', c => blocks.push(c));
    const hp = u.hp;
    b.dealDamage({ source: null, credit: e, target: u, amount: 500, type: 'phys', dodgeMode: mode });
    assert.equal(u.hp === hp, mode === 'normal');
    assert.deepEqual(dodges.map(c => c.cancelled), mode === 'ignore' ? [] : [mode === 'normal']);
    assert.equal(blocks.length, 0, 'PRTS corrects the old block description to dodge');
    const before = dodges.length;
    for (const type of ['arts', 'true']) {
      assert.ok(b.dealDamage({ target: u, amount: 10, type }) > 0, `${type} is outside physical dodge`);
    }
    assert.equal(dodges.length, before);
    u.skill.end('test');
    assert.equal(u.s.dodgePhys, 0, 'the skill owns the dodge lifetime');
  }
});

test('Lappland S1 acquired after a shield cannot dodge before that shield is consumed', () => {
  const { b, u } = defensiveSkill('chess_char_2_16_a');
  u.skill.end('test');
  b.addBuff(u, { key: 'earlier-shield', shieldHits: 1 });
  assert.ok(u.skill.activate('test', { free: true }));
  let rolls = 0;
  b.rng = () => { rolls++; return 0; };
  b.dealDamage({ target: u, amount: 500, type: 'phys' });
  assert.equal(u.findBuff('earlier-shield'), null);
  assert.equal(rolls, 0);
});

test('Liskarm S1 charge survives earlier dodge, gauges and HP loss; it blocks one true instance without SP', () => {
  const { b, u } = defensiveSkill('chess_char_1_20_a');
  b.addBuff(u, { key: 'earlier-dodge', injuryPriority: 1000, mods: { dodgePhys: 1 } });
  b.rng = () => 0;
  b.dealDamage({ target: u, amount: 500, type: 'phys' });
  assert.ok(u.findBuff('liskam:block'));
  b.dealElementDamage({ target: u, amount: 1, element: 'burn' });
  b.dealHPLose({ target: u, amount: 1 });
  assert.ok(u.findBuff('liskam:block'));
  let blocks = 0, gains = 0;
  b.on('block', c => { if (c.target === u) blocks++; });
  b.on('spGain', () => { gains++; });
  const hp = u.hp;
  b.dealDamage({ target: u, amount: 10, type: 'true', dodgeMode: 'ignore' });
  assert.equal(u.hp, hp);
  assert.equal(blocks, 1);
  assert.equal(gains, 0);
  assert.equal(u.findBuff('liskam:block'), null);
  b.dealDamage({ target: u, amount: 10, type: 'true' });
  assert.equal(u.hp, hp - 10);
  u.skill.end('test');
  assert.equal(u.findBuff('liskam:block'), null);
});

test('Liskarm S1 acquired after a barrier retains its charge when that earlier barrier fully absorbs damage', () => {
  const { b, u } = defensiveSkill('chess_char_1_20_a');
  u.skill.end('test');
  b.addBuff(u, { key: 'earlier-barrier', shield: 100 });
  assert.ok(u.skill.activate('test', { free: true }));
  b.dealDamage({ target: u, amount: 100, type: 'true' });
  assert.equal(u.findBuff('earlier-barrier'), null);
  assert.ok(u.findBuff('liskam:block'), 'the earlier barrier already blocked this instance');
  u.skill.end('test');
  assert.equal(u.findBuff('liskam:block'), null, 'an unused charge expires with the skill');
});

test('physical/arts element-burst damage uses normal dodge while burst status and cooldown still apply', () => {
  for (const element of ['erosion', 'burn', 'apoptosis']) {
    const h = makeBattle({ defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, def: 0 }, skill: null }) } },
      units: [{ uid: 'probe', chessId: 'probe', row: 10, col: 5 }], content: 'none', autoFinish: false });
    h.step();
    const u = h.unit('probe'), hp = u.hp;
    h.b.addBuff(u, { key: 'dodge', mods: { dodgePhys: 1, dodgeArts: 1 } });
    let rolls = 0;
    h.b.rng = () => { rolls++; return 0; };
    h.b.dealElementDamage({ target: u, amount: u.gaugeMax, element });
    if (element === 'apoptosis') h.run(1.01);
    assert.ok(u.findBuff(`${element}Burst`), 'dodging HP damage does not cancel the burst');
    assert.equal(u.hp, hp);
    assert.equal(rolls, 1);
  }
});

// Native ep_break_* NoSourceDamage carries no cancellation mask: the burst's HP damage is ordinary, the necrosis tick too
// (it had dodgeMode 'ignore' until the merge review of 2026-10-23; DESIGN §35.32).
test('the necrosis burst tick is ordinary 无来源 damage: an injury dodge effect cancels it, the burst stays', () => {
  const h = makeBattle({ defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 100000, def: 0 }, skill: null }) } },
    units: [{ uid: 'probe', chessId: 'probe', row: 10, col: 5 }], content: 'none', autoFinish: false });
  h.step();
  const u = h.unit('probe'), hp = u.hp;
  assert.ok('necrosis' in u.elem);
  let tries = 0;
  h.b.addBuff(u, { key: 'dodger', injury: (e) => { tries++; e.dodge(); } });
  h.b.dealElementDamage({ target: u, amount: u.gaugeMax, element: 'necrosis' });
  h.run(2.01);
  assert.ok(u.findBuff('necrosisBurst'), 'dodging HP damage does not cancel the burst');
  assert.ok(tries >= 2, `every tick reaches the injury effects (${tries})`);
  assert.equal(u.hp, hp);
});

// PRTS 游戏数据基础 + 数值范围: fixed penetration is subtracted before percentage penetration.
test('fixed/percentage penetration order: the PRTS formula (v0.3.1 gave 900 for both first cases)', () => {
  const target = { def: 300, res: 40 };
  assert.equal(mitigate(1000, 'phys', target, { defIgnoreFlat: 50, defIgnorePct: 0.5 }), 875);
  assert.equal(mitigate(1000, 'arts', target, { resIgnoreFlat: 10, resIgnorePct: 0.5 }), 850);
  assert.equal(mitigate(1000, 'phys', target, { defIgnoreFlat: 999, defIgnorePct: 0.5 }), 1000);
  assert.equal(mitigate(1000, 'phys', target, { defIgnorePct: 2 }), 1000);
  assert.equal(mitigate(1000, 'arts', { res: 100 }), 50);
});

function skadiArena(two = false) {
  const h = makeBattle({
    defs: { chess: { patient: chessRec({ id: 'patient', stats: { maxHp: 100000, def: 0 }, skill: null }) },
      enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, speed: 0, atk: 0, def: 0, res: 0 }) } },
    units: [
      { uid: 'skadi', chessId: 'chess_char_6_04_a', row: 10, col: 4, skillIndex: 0, carryState: { sp: 999 } },
      { uid: 'patient', chessId: 'patient', row: 10, col: 5 },
      ...(two ? [{ uid: 'stronger', chessId: 'chess_char_6_04_b', row: 11, col: 4, skillIndex: 0, carryState: { sp: 999 } }] : []),
    ], autoFinish: false, captureNoisy: true,
  });
  h.step();
  const s = h.unit('skadi'), t = h.unit('patient'), stronger = two ? h.unit('stronger') : null;
  assert.ok(h.runUntil(() => s.skill.active && (!stronger || stronger.skill.active), 5));
  return { h, b: h.b, s, t, stronger, enemy: h.spawn('enemy_probe', { pos: [10, 9] }) };
}

// PRTS 浊心斯卡蒂 S1: priority -2000 after barriers; receiver takes HP loss.
test('Skadi transfers only the damage after the patient barrier; receiver barriers and damage multipliers do not apply', () => {
  const { h, b, s, t, enemy } = skadiArena();
  b.addBuff(t, { key: 'patient-shield', shield: 300 });
  b.addBuff(s, { key: 'skadi-shield', shield: 1000, mods: { trueTakenMul: 0.1 } });
  const hp = [t.hp, s.hp], share = s.mem.skadiTransferShare;
  b.dealDamage({ source: enemy, target: t, amount: 500, type: 'true' });
  assert.equal(hp[0] - t.hp, 200 * (1 - share));
  assert.equal(hp[1] - s.hp, 200 * share);
  assert.equal(s.findBuff('skadi-shield').shield, 1000);
  const transferred = h.hooksOf('damaged').find(c => c.target === s && c.dmg?.tags.includes('transfer'));
  assert.ok(transferred.dmg.tags.includes('hpLoss'));
  assert.equal(transferred.source, enemy);
  checkInvariants(b);
});

test('Skadi does not transfer an entirely absorbed instance or ordinary HP loss', () => {
  const { b, s, t, enemy } = skadiArena();
  b.addBuff(t, { key: 'patient-shield', shield: 1000 });
  const hp = s.hp;
  b.dealDamage({ source: enemy, target: t, amount: 500, type: 'true' });
  assert.equal(s.hp, hp);
  assert.equal(t.findBuff('patient-shield').shield, 500);
  b.dealHPLose({ source: enemy, target: t, amount: 100 });
  assert.equal(s.hp, hp);
});

test('overlapping Skadi S1 uses the strongest value and transfers each instance once', () => {
  const { b, s, t, stronger, enemy } = skadiArena(true);
  const hp = [s.hp, stronger.hp, t.hp];
  const strong = [s, stronger].sort((a, b) => b.mem.skadiTransferShare - a.mem.skadiTransferShare || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const weak = strong === stronger ? s : stronger;
  const weakHp = weak.hp;
  b.dealDamage({ source: enemy, target: t, amount: 100, type: 'true' });
  assert.equal(weak.hp, weakHp);
  assert.equal(hp[2] - t.hp, 100 * (1 - strong.mem.skadiTransferShare));
  const strongHp = strong === s ? hp[0] : hp[1];
  assert.equal(strongHp - strong.hp, 100 * strong.mem.skadiTransferShare);
});

// PRTS 元素: character-class allies and enemy-class entities have different burst rules.
test('enemy-class allies retain enemy element bursts and leader gauge capacity, independently of their team', () => {
  const h = makeBattle({ defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, speed: 0, def: 0, res: 0 }) } },
    units: [], content: 'none', autoFinish: false });
  h.step();
  const target = h.spawn('enemy_probe', { pos: [10, 9] });
  target.side = 'ally';
  const before = target.hp;
  h.b.dealElementDamage({ source: null, target, amount: 1000, element: 'burn' });
  // the enemy burst (7000 元素伤害); v0.3.1 chose by the current side and dealt the operators' 1200 arts
  assert.equal(before - target.hp, 7000);
  target.isBoss = true;
  assert.equal(target.gaugeMax, 2000);
});

function skadiModuleArena(two = false) {
  const h = makeBattle({
    defs: { chess: { patient: chessRec({ id: 'patient', stats: { maxHp: 100000, def: 300, res: 50 }, skill: null }) },
      enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, speed: 0, atk: 0, def: 0, res: 0 }) } },
    units: [
      { uid: 'skadi', chessId: 'chess_char_6_04_b', moduleId: 'uniequip_003_skadi2', row: 10, col: 4, skillIndex: 1, carryState: { sp: 999 } },
      { uid: 'patient', chessId: 'patient', row: 10, col: 5 },
      ...(two ? [{ uid: 'second', chessId: 'chess_char_6_04_b', moduleId: 'uniequip_003_skadi2', row: 11, col: 4, skillIndex: 1, carryState: { sp: 999 } }] : []),
    ], autoFinish: false,
  });
  h.step();
  const s = h.unit('skadi'), t = h.unit('patient');
  assert.ok(h.runUntil(() => s.skill.active && (!two || h.unit('second').skill.active), 5));
  return { h, b: h.b, s, t, enemy: h.spawn('enemy_probe', { pos: [10, 9] }) };
}

test('Skadi module subtracts a flat 30 after penetration and source scaling, and overlapping copies do not stack', () => {
  for (const two of [false, true]) {
    const { b, t, enemy } = skadiModuleArena(two);
    b.addBuff(enemy, { key: 'penetration', mods: { defIgnoreFlat: 50, defIgnorePct: 0.5, resIgnoreFlat: 10, resIgnorePct: 0.25, dmgDealtMul: 1.5 } });
    const physical = (500 - (t.s.def - 50) * 0.5) * 1.5 - 30;
    assert.ok(Math.abs(b.dealDamage({ source: enemy, target: t, amount: 500, type: 'phys' }) - physical) < 1e-8);
    const arts = 700 * (1 - (t.s.res - 10) * 0.75 / 100) * 1.5 - 30;
    assert.ok(Math.abs(b.dealDamage({ source: enemy, target: t, amount: 700, type: 'arts' }) - arts) < 1e-8);
    assert.equal(b.dealDamage({ source: enemy, target: t, amount: 100, type: 'true' }), 150);
    assert.equal(b.dealHPLose({ source: enemy, target: t, amount: 100 }), 100);
  }
});

test('Skadi module follows current coverage before a hit and disappears immediately when the skill ends', () => {
  const { b, s, t } = skadiModuleArena();
  const key = `skadi2:reduction:${s.id}`;
  assert.ok(t.findBuff(key));
  assert.ok(b.relocate(t, 12, 8));
  const unprotected = mitigate(500, 'phys', t.s);
  assert.ok(Math.abs(b.dealDamage({ target: t, amount: 500, type: 'phys' }) - unprotected) < 1e-8);
  assert.equal(t.findBuff(key), null);
  assert.ok(b.relocate(t, 10, 5));
  assert.ok(Math.abs(b.dealDamage({ target: t, amount: 500, type: 'phys' }) - (unprotected - 30)) < 1e-8);
  assert.ok(t.findBuff(key));
  s.skill.stop();
  assert.equal(t.findBuff(key), null);
  assert.ok(Math.abs(b.dealDamage({ target: t, amount: 500, type: 'phys' }) - unprotected) < 1e-8);
});

test('Eyjafjalla alter S2 refreshes its source pool; element barriers absorb before resistance calculation', () => {
  const h = makeBattle({
    defs: { chess: { patient: chessRec({ id: 'patient', stats: { maxHp: 100000 }, skill: null, epResistance: 50 }) } },
    units: [{ uid: 'eyja', chessId: 'chess_char_6_20_a', row: 10, col: 4, skillIndex: 1 },
      { uid: 'patient', chessId: 'patient', row: 10, col: 5 }], autoFinish: false,
  });
  h.step();
  const u = h.unit('eyja'), t = h.unit('patient');
  // Data-source records expose resistance on the def; keep this fixture independent of record-builder defaults.
  t.def = { ...t.def, epResistance: 50 };
  const scale = u.def.skill.bb['agoat2_s_2[shield].atk_scale'];
  const pool = u.s.atk * scale;
  assert.ok(pool > 0);
  assert.ok(u.skill.activate('test', { free: true }));
  h.b.dealElementDamage({ target: t, amount: pool * 0.2, element: 'burn' });
  assert.equal(t.elem.burn, 0);
  assert.ok(u.skill.activate('test', { free: true }));
  const intake = t.s.elemTakenMul * 0.5;
  const applied = h.b.dealElementDamage({ target: t, amount: pool * 1.1, element: 'burn' });
  assert.ok(Math.abs(applied - pool * 0.1 * intake) < 1e-8);
  assert.ok(Math.abs(t.elem.burn - applied) < 1e-8);
});
