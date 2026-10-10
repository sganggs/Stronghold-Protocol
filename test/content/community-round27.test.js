// Community follow-up: deployment clocks, air-only casts, champagne healing and airborne splash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const TRAP = 'token_10031_swire2_gdtrap';
const SW = 'chess_char_3_04_a';
const wall = chessRec({ id: 'wall', skill: null, stats: { maxHp: 1e7, atk: 0, def: 0, blockCnt: 3 } });
const dummy = enemyRec({ key: 'dummy', hp: 1e9, atk: 0, speed: 0 });
const done = (h) => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };
const diy = (charId, skillIndex, tier = 5) => ({ slot: `chess_char_${tier}_diy1_a`, charId, skillIndex });

test('deployment duration starts at battle start, never advances from repeated start/read calls', () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 1, diy: diy('char_1015_aglna2', 0), row: 10, col: 4 }] });
  const u = h.unit(1);
  assert.equal(h.b.started, false); assert.equal(u.deployed, false);
  assert.ok(!u.skill?.active);
  h.b.start(); const duration = u.skill.duration;
  assert.equal(u.skill.timeLeft, duration); assert.equal(u.skill.activations, 1);
  for (let i = 0; i < 10; i++) { h.b.start(); h.b.snapshot(); }
  assert.equal(h.b.time, 0); assert.equal(u.skill.timeLeft, duration);
  h.run(2); assert.ok(Math.abs(u.skill.timeLeft - (duration - 2)) < 1e-8);
  done(h);
});

for (const tier of [5, 6]) for (const elite of [false, true]) {
  test(`赤刃陈 S3 opens for a flyer in its expanded range and only the wave damages it (T${tier}, elite=${elite})`, () => {
    const h = makeBattle({ autoFinish: false, flags: { startOpCooldown: 3 }, hooks: ['damaged'], captureNoisy: true,
      defs: { enemies: { fly: enemyRec({ key: 'fly', hp: 1e9, atk: 0, speed: 0, motion: 'FLY' }) } },
      units: [{ uid: 1, diy: diy('char_1050_chen3', 2, tier), elite, row: 10, col: 4 }] });
    h.step(); const u = h.unit(1); const e = h.spawn('fly', { pos: [10, 6] });
    u.skill.gainSp(999, 'init'); h.run(2);
    assert.equal(u.skill.activations, 0, 'the operation cooldown still applies');
    assert.ok(h.runUntil(() => u.skill.active, 2), 'air-only target can start the sword wave');
    h.run(2);
    const hits = h.hooksOf('damaged').filter(c => c.source === u && c.target === e);
    assert.ok(hits.length > 0, 'the wave hits the flyer');
    assert.ok(hits.every(c => c.dmg.tags.includes('chen3:wave')), 'normal S3 swings remain ground-only');
    done(h);
  });
}

test('赤刃陈 S3 still rejects an out-of-range, hidden or sleeping flyer, and cannot cast while stunned', () => {
  const h = makeBattle({ autoFinish: false,
    defs: { enemies: { fly: enemyRec({ key: 'fly', hp: 1e9, atk: 0, speed: 0, motion: 'FLY' }) } },
    units: [{ uid: 1, diy: diy('char_1050_chen3', 2), row: 10, col: 4 }] });
  h.step(); const u = h.unit(1); u.skill.gainSp(999, 'init');
  const far = h.spawn('fly', { pos: [12, 12] }); h.run(0.3); assert.equal(u.skill.activations, 0);
  const e = h.spawn('fly', { pos: [10, 6] });
  h.b.addBuff(e, { key: 'test:stealth', flags: { stealth: true } });
  h.run(0.3); assert.equal(u.skill.activations, 0);
  h.b.removeBuff(e, 'test:stealth'); h.b.applyStatus(e, 'sleep', { duration: 0.4 });
  h.run(0.2); assert.equal(u.skill.activations, 0);
  h.b.applyStatus(u, 'stun', { duration: 0.7 }); h.run(0.5); assert.equal(u.skill.activations, 0);
  h.run(0.4); assert.equal(u.skill.activations, 1); assert.ok(far.alive); done(h);
});

test('琳琅诗怀雅 S2 receives the deployment coin and throws without waiting for the first merchant payment', () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: SW, row: 10, col: 4, skillIndex: 1, potential: 1 }] });
  h.b.start(); const u = h.unit(1);
  assert.equal(u.skill.kind, 'passive'); assert.equal(u.mem.coins, 1);
  assert.equal(h.b.allyUnits.filter(a => a.defId === TRAP).length, 0);
  h.step(); assert.equal(h.b.allyUnits.filter(a => a.defId === TRAP).length, 1); assert.equal(u.mem.coins, 0);
  h.run(1); assert.equal(h.b.allyUnits.filter(a => a.defId === TRAP).length, 1, 'no free extra bombs');
  done(h);
});

for (const skillIndex of [0, 1]) {
  test(`莎草 S${skillIndex + 1} heals/shields an adjacent operator but never chains to 琳琅诗怀雅's actual bomb`, () => {
    const h = makeBattle({ autoFinish: false, hooks: ['heal'], captureNoisy: true,
      flat: { rows: { 9: '##ERRrrRrrSrrrrrrrS##', 10: '##hrrRrrrrfrrrrrrrf##', 11: '##hrrRrrrrfrrrrrrrf##' } },
      defs: { chess: { wall } },
      units: [{ uid: 1, chessId: SW, row: 9, col: 5 },
        { uid: 2, chessId: 'chess_char_2_06_a', row: 10, col: 6, skillIndex }, { uid: 3, chessId: 'wall', row: 10, col: 5 }] });
    h.step(); const bomb = h.b.allyUnits.find(a => a.defId === TRAP); assert.ok(bomb);
    assert.deepEqual([bomb.tileR, bomb.tileC], [9, 6]);
    const p = h.unit(2), a = h.unit(3); a.hp = 100;
    p.skill.gainSp(999, 'init');
    assert.ok(h.runUntil(() => !!a.findBuff('papyrs:shield'), 5), 'a real heal gave the operator a shield');
    h.run(3);
    assert.equal(bomb.findBuff('papyrs:shield'), null);
    assert.ok(!h.hooksOf('heal').some(c => c.source === p && c.target === bomb));
    if (skillIndex === 1) assert.notEqual(p.mem.papyrsLock, bomb);
    done(h);
  });
}

for (const skillIndex of [0, 1, 2]) {
  test(`予愿 S${skillIndex + 1}: ground caster splash skips her while airborne and hits after landing`, () => {
    const h = makeBattle({ autoFinish: false, timeLimit: 120, hooks: ['damaged'], captureNoisy: true,
      defs: { chess: { wall }, enemies: { dummy } },
      units: [{ uid: 1, diy: diy('char_1015_aglna2', skillIndex), row: 9, col: 5 },
        { uid: 2, chessId: 'wall', row: 10, col: 5 }] });
    h.step(); const u = h.unit(1), bait = h.unit(2);
    if (skillIndex > 0) assert.ok(u.skill.activate('test', { free: true }));
    h.run(3); assert.ok(u.s.flags.liftoff, 'past S2 invulnerable chant, still airborne');
    const e = h.spawn('enemy_1161_tidmag', { pos: [10, 7], mods: { hpMul: 1e4, speedMul: 0, atkMul: 0.1 } });
    h.run(7);
    assert.ok(h.hooksOf('damaged').some(c => c.source === e && c.target === bait), 'caster attacked the adjacent bait');
    assert.ok(!h.hooksOf('damaged').some(c => c.source === e && c.target === u), 'ordinary ground splash cannot hit her');
    u.skill.end('test'); u.skill.spCostMul = 1000; h.run(7);
    assert.ok(h.hooksOf('damaged').some(c => c.source === e && c.target === u), 'same splash reaches her after landing');
    done(h);
  });
}

test('予愿起飞 still takes the brute leader splash explicitly marked 无视无法选择', () => {
  const h = makeBattle({ autoFinish: false, hooks: ['damaged'], captureNoisy: true,
    defs: { chess: { wall } },
    units: [{ uid: 1, diy: diy('char_1015_aglna2', 0), row: 9, col: 5 }, { uid: 2, chessId: 'wall', row: 9, col: 4 }],
    enemies: [{ key: 'enemy_1320_wdrrl_2', route: { motion: 'WALK', start: [9, 8], end: [9, 1], checkpoints: [] }, mods: { hpMul: 1e3, atkMul: 0.1 } }] });
  h.run(14); const u = h.unit(1);
  assert.ok(u.s.flags.liftoff);
  assert.ok(h.hooksOf('damaged').some(c => c.target === u && c.dmg.ignoreSelect));
  done(h);
});
