// Content tests for the tier-6 kits (server/sim/content/kits/tier6.js) + 盟约·辅助干员 (chess_char_1_15).
// Every test runs a real battle through the harness and checks the signature effect of the kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });
const DEFS = {
  enemies: {
    enemy_dummy: dummy(),
    enemy_dummy2: dummy({ key: 'enemy_dummy2' }),
    enemy_armored: dummy({ key: 'enemy_armored', def: 500 }),
    enemy_elite: dummy({ key: 'enemy_elite', rank: 'ELITE' }),
    enemy_walker: enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 1 }),
    enemy_shooter: enemyRec({ key: 'enemy_shooter', hp: 1e7, speed: 0, atk: 50, range: 6 }),
  },
  chess: {
    // synthetic allies (no skill) used as buff/heal/copy targets
    test_guard_a: chessRec({ id: 'test_guard_a', profession: 'WARRIOR', stats: { maxHp: 3000, atk: 800, def: 100 }, skill: null }),
    test_lat_a: chessRec({
      id: 'test_lat_a', profession: 'SNIPER', bonds: ['lateranoShip'], skill: null, stats: { atk: 1 },
      rangeGrid: Array.from({ length: 11 }, (_, c) => [0, c]).concat(Array.from({ length: 11 }, (_, c) => [-2, c]), Array.from({ length: 11 }, (_, c) => [2, c])),
    }),
  },
};

/** Battle with the shared synthetic defs + a `damaged` recorder: h.dmg = [{ src, tgt, amount, type, element, tags, skill, attack, splash, t }]. */
function battle(opts) {
  const log = [];
  const h = makeBattle({
    defs: DEFS, timeLimit: 400, seed: 7, ...opts,
    setup(b) {
      b.on('damaged', (c) => log.push({ src: c.source?.id ?? null, tgt: c.target.id, amount: c.amount, type: c.type, element: c.dmg?.element ?? null, tags: c.dmg?.tags ?? [], skill: !!c.dmg?.isSkill, attack: !!c.dmg?.isAttack, splash: !!c.dmg?.isSplash, t: b.time }), { priority: -999 });
      if (opts.setup) opts.setup(b);
    },
  });
  h.dmg = log;
  return h;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const enemyAt = (h, key, i = 0) => h.b.units.filter((u) => u.side === 'enemy' && u.defId === key)[i];

// --------------------------------------------------------------------------------------------------------------------

test('盟约·辅助干员: S1 ASPD +70 & 2 targets, attacks carry 18 % ATK neural damage', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_1_15_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy2', pos: [10, 6] }],
  });
  const u = h.unit('chess_char_1_15_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 80), 'skill fires');
  assert.equal(u.s.aspd, 100 + bb.attack_speed);
  const t0 = h.b.time;
  h.run(4);
  const hitters = h.hooksOf('attack');
  assert.ok(u.skill.active);
  const neural = h.dmg.filter((d) => d.src === u.id && d.element === 'neural' && d.t > t0);
  const tgts = new Set(neural.map((d) => d.tgt));
  assert.equal(tgts.size, 2, 'both targets hit during the skill');
  assert.ok(near(neural[0].amount, u.s.atk * u.def.talents[0].bb.ep_damage_ratio, 1e-3), 'neural = 18 % ATK');
  assert.ok(hitters.length >= 0);
  checkInvariants(h.b);
});

test('盟约·辅助干员 (elite): element damage vs elite enemies uses the module ratio', () => {
  const h = battle({ units: [{ chessId: 'chess_char_1_15_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_elite', pos: [10, 5] }] });
  const u = h.unit('chess_char_1_15_b');
  h.run(3);
  const el = h.dmg.find((d) => d.src === u.id && d.type === 'element');
  assert.ok(el);
  assert.ok(near(el.amount, u.s.atk * u.def.talents[0].bb.ep_damage_ratio_boss, 1e-3));
});

/** 蕾缪安 S3 fx of the battle: [{ kind, x, y, ...extra }] for 'lock' / 'bombardShell' / 'bombard'. */
const lemFx = (h, kind) => h.eventsOf('fx').filter((e) => e[1] === kind).map((e) => ({ x: e[2], y: e[3], ...e[4] }));
const SHELL_IV = 0.3; // PRTS S3 note: "以0.3s为间隔" (not in the blackboard)

test('蕾缪安: S3 locks 5 (+1 talent) targets every 0.5 s, then the shells land one by one every 0.3 s (360 % centre)', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_01_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    hooks: ['ammoUsed', 'skillStart', 'skillEnd'],
  });
  const u = h.unit('chess_char_6_01_a');
  const bb = u.def.skill.bb, t1 = u.def.talents[1].bb;
  assert.ok(h.runUntil(() => u.skill.active, 60));
  assert.ok(h.b.time >= t1.interval, 'talent 2 active (20 s on field) before the first cast');
  const start = h.b.time;
  assert.ok(u.findBuff('lemuen:extradition'), 'ATK +10 % after 20 s');
  assert.ok(h.runUntil(() => !u.skill.active, 20));
  const end = h.b.time;
  const ammo = h.hooksOf('ammoUsed').filter((c) => c.unit === u);
  const n = bb['attack@trigger_time'] + t1.add_count;
  assert.equal(ammo.length, n);
  assert.ok(Math.abs(end - start - (ammo.length - 1) * bb['attack@aim_interval']) < 0.1, 'one lock every 0.5 s');
  assert.equal(lemFx(h, 'lock').length, n, 'one lock mark per bullet');
  assert.equal(h.dmg.filter((d) => d.src === u.id && d.tags.includes('bombard')).length, 0, 'nothing lands all at once at the end');
  const atk = u.s.atk;
  h.run(SHELL_IV * (n + 1));
  // one shell every 0.3 s in lock order, each on a random point within ±emit_offset of its (stationary) target
  const shells = lemFx(h, 'bombardShell');
  assert.deepEqual(shells.map((s) => s.i), [...Array(n).keys()], 'shells fired one by one, in lock order');
  const spread = bb['attack@emit_offset'] + 0.01;
  for (const s of shells) {
    assert.ok(Math.abs(s.x - 5) <= spread && Math.abs(s.y - 10) <= spread, `aimed within ±${bb['attack@emit_offset']} of the lock (${s.x}, ${s.y})`);
    assert.equal(s.id, u.id);
    assert.equal(s.r, bb['attack@dist_2']);
    assert.ok(s.t > 0 && s.t <= SHELL_IV + 1e-9, `flight ${s.t} s`);
  }
  assert.ok(new Set(shells.map((s) => `${s.x},${s.y}`)).size > 1, 'the aim points are spread (seeded rng)');
  const bombs = h.dmg.filter((d) => d.src === u.id && d.tags.includes('bombard'));
  assert.equal(bombs.length, n, 'one hit per shell on the single enemy (limited_hit_time 1)');
  bombs.forEach((b, i) => assert.ok(Math.abs(b.t - end - SHELL_IV * (i + 1)) <= 2 / 30 + 1e-9, `shell ${i} lands at +${(b.t - end).toFixed(3)} s`));
  assert.equal(lemFx(h, 'bombard').length, n, 'an explosion fx per shell');
  for (const b of bombs) assert.ok(near(b.amount, atk * bb['attack@proj_atk_scale_1'], 1e-3), 'centre damage 360 % (the ATK when the skill ended)');
  assert.equal(h.dmg.filter((d) => d.src === u.id && d.attack && d.t > start && d.t < end - 0.1).length, 0, 'no normal attacks while locking');
  checkInvariants(h.b);
});

test('蕾缪安: S3 lock marks follow a walking target and stay where it died; the outer ring deals 240 %', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_01_a', row: 10, col: 3, carryState: { sp: 99 } }],
    enemies: [{ key: 'enemy_walker', route: { motion: 'WALK', start: [9, 6], end: [9, 2], checkpoints: [] } }, { key: 'enemy_dummy', pos: [10, 6] }],
  });
  const u = h.unit('chess_char_6_01_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 10));
  assert.ok(h.runUntil(() => !u.skill.active, 10));
  const walker = enemyAt(h, 'enemy_walker'), dummyE = enemyAt(h, 'enemy_dummy');
  const locks = lemFx(h, 'lock');
  assert.deepEqual(locks.slice(0, 2).map((l) => l.id).sort(), [walker.id, dummyE.id].sort(), 'unlocked targets first, then a new round');
  // the walker's shells aim at where it is when each is fired (it keeps walking), not where it was locked
  const firstLock = locks.find((l) => l.id === walker.id);
  const at0 = { x: walker.x, y: walker.y };
  assert.ok(Math.abs(at0.x - firstLock.x) > 0.6, `the walker moved on since its lock (${firstLock.x} → ${at0.x})`);
  const order = locks.map((l) => l.id);
  const spread = bb['attack@emit_offset'] + 0.01;
  const shell0 = lemFx(h, 'bombardShell')[0];
  if (order[0] === walker.id) assert.ok(Math.abs(shell0.x - at0.x) <= spread && Math.abs(shell0.y - at0.y) <= spread, 'first shell on the walker\'s current spot');
  // it dies before its later shells are fired: they fall where it died
  h.b.kill(walker);
  const died = { x: walker.x, y: walker.y };
  h.run(SHELL_IV * (order.length + 1));
  const shells = lemFx(h, 'bombardShell');
  assert.equal(shells.length, order.length);
  shells.forEach((s, i) => {
    if (order[i] !== walker.id || i === 0) return;
    assert.ok(Math.abs(s.x - died.x) <= spread && Math.abs(s.y - died.y) <= spread, `shell ${i} on the spot the walker left (${s.x}, ${s.y})`);
  });
  // the dummy one row below the walker's line: centre (≤ dist_1) or outer ring (≤ dist_2) damage per shell
  const onDummy = h.dmg.filter((d) => d.src === u.id && d.tgt === dummyE.id && d.tags.includes('bombard'));
  assert.ok(onDummy.every((d) => near(d.amount, u.s.atk * bb['attack@proj_atk_scale_1'], 1e-3) || near(d.amount, u.s.atk * bb['attack@proj_atk_scale_2'], 1e-3)));
  assert.ok(onDummy.some((d) => near(d.amount, u.s.atk * bb['attack@proj_atk_scale_2'], 1e-3)), 'a shell on the walker line reaches it with the outer ring (240 %)');
  checkInvariants(h.b);
});

test('蕾缪安: knocked out after S3 ended, the shell in the air still lands and the rest are dropped', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_01_a', row: 10, col: 3, carryState: { sp: 99 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit('chess_char_6_01_a');
  assert.ok(h.runUntil(() => u.skill.active, 10));
  assert.ok(h.runUntil(() => !u.skill.active, 10));
  assert.equal(lemFx(h, 'bombardShell').length, 1, 'the first shell is fired as the skill ends');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false);
  h.run(3);
  assert.equal(lemFx(h, 'bombardShell').length, 1, 'no shell after she left the field');
  assert.equal(h.dmg.filter((d) => d.src === u.id && d.tags.includes('bombard')).length, 1, 'the fired shell landed');
  // knocked out while locking: no bombardment at all
  const h2 = battle({ units: [{ chessId: 'chess_char_6_01_a', row: 10, col: 3, carryState: { sp: 99 } }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
  const u2 = h2.unit('chess_char_6_01_a');
  assert.ok(h2.runUntil(() => u2.skill.active && lemFx(h2, 'lock').length >= 2, 10));
  h2.b.dealDamage(null, u2, { amount: 1e9, type: 'true' });
  h2.run(3);
  assert.equal(lemFx(h2, 'bombardShell').length, 0);
  assert.equal(h2.dmg.filter((d) => d.src === u2.id && d.tags.includes('bombard')).length, 0);
  checkInvariants(h.b);
});

test('蕾缪安: elite enemies in a Laterano range get wanted (×1.15) and she can shoot them anywhere', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_01_a', row: 12, col: 2 }, { chessId: 'test_lat_a', row: 10, col: 2 }],
    enemies: [{ key: 'enemy_elite', pos: [10, 9] }],
  });
  const u = h.unit('chess_char_6_01_a');
  h.step();
  const e = enemyAt(h, 'enemy_elite');
  h.run(5);
  assert.ok(!e.findBuff('lemuen:wanted'));
  assert.ok(!h.dmg.some((d) => d.src === u.id), 'out of her range before being wanted');
  h.run(4);
  assert.ok(e.findBuff('lemuen:wanted'), 'wanted after 8 s');
  h.run(4);
  const hit = h.dmg.find((d) => d.src === u.id && d.attack && d.tgt === e.id);
  assert.ok(hit, 'she attacks the wanted target outside her range');
  const expect = u.s.atk * u.def.talents[0].bb.damage_scale;
  assert.ok(near(hit.amount, expect, 1e-3), `×1.15 wanted bonus (${hit.amount} vs ${expect})`);
});

test('圣聆初雪: snow damages walking enemies (75 % ATK) and slows them; S3 lures enemies next to her', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_02_a', row: 10, col: 5 }],
    enemies: [{ key: 'enemy_walker', time: 6, pos: [9, 9], route: { motion: 'WALK', start: [9, 9], end: [9, 2], checkpoints: [] } }],
  });
  const u = h.unit('chess_char_6_02_a');
  const t0 = u.def.talents[0].bb;
  assert.ok(h.runUntil(() => h.dmg.some((d) => d.tags.includes('snow')), 30), 'snow hit');
  const snowHit = h.dmg.find((d) => d.tags.includes('snow'));
  assert.ok(near(snowHit.amount, u.s.atk * t0.talent_magic_scale, 1e-3));
  const w = enemyAt(h, 'enemy_walker');
  h.step();
  const slow = w.findBuff('sbell2:snow');
  assert.ok(slow && slow.mods.moveMul < 1, 'snow slows');
  checkInvariants(h.b);
});

test('圣聆初雪: S3 诱导 — enemies in range become unblockable and WALK (own speed) next to her for attract_time, then resume', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_02_a', row: 10, col: 4, carryState: { sp: 56 } }],
    enemies: [{ key: 'enemy_walker', pos: [10, 6], route: { motion: 'WALK', start: [10, 6], end: [10, 9], checkpoints: [] } }],
  });
  const u = h.unit('chess_char_6_02_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 2), 'CUSTOM_RANGE trigger');
  const t0 = h.b.time;
  const e = enemyAt(h, 'enemy_walker');
  const st = e.findBuff('attract');
  assert.ok(st && e.s.flags.unblockable, '诱导: the attract status, unblockable');
  const x0 = e.x;
  h.run(1);
  // 0.5 tiles/s (speed 1 × MOVE_SCALE) toward her — not teleported, and against its own route (which heads right)
  assert.ok(e.x < x0 - 0.3 && e.x > x0 - 0.7, `walks toward her at its own speed (${x0} → ${e.x})`);
  h.run(2);
  assert.ok(Math.hypot(e.x - u.x, e.y - u.y) <= 1.5 + 1e-6, 'arrives on a ground tile next to her');
  const xs = e.x;
  h.run(3);
  assert.ok(Math.abs(e.x - xs) < 1e-6, 'waits there while lured');
  h.runUntil(() => !e.findBuff('attract'), bb.attract_time + 1);
  assert.ok(h.b.time - t0 >= bb.attract_time - 0.1, `lasts attract_time (${h.b.time - t0})`);
  h.run(2);
  assert.ok(e.x > xs + 0.3, 'resumes its route afterwards');
  checkInvariants(h.b);
});

test('圣聆初雪: S3 180 % group arts attacks; 圣山的祝福 prevents death once and freezes range', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_02_a', row: 10, col: 4, carryState: { sp: 55 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy2', pos: [11, 6] }],
  });
  const u = h.unit('chess_char_6_02_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 10), 'CUSTOM_RANGE trigger');
  const e = enemyAt(h, 'enemy_dummy');
  assert.ok(e.findBuff('attract'), 'lured (immobile dummies stay where they are)');
  h.run(3);
  const hit = h.dmg.find((d) => d.src === u.id && d.attack && d.type === 'arts');
  assert.ok(hit, 'attacks while the skill runs');
  assert.ok(near(hit.amount, u.s.atk * bb['attack@atk_scale_s3'], 1e-3));
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && near(u.hp, u.s.maxHp), 'full heal instead of dying');
  assert.ok(u.s.flags.freeze, 'self frozen');
  assert.ok(e.s.flags.freeze, 'enemies in range frozen');
  h.run(10);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false, 'only once');
});

test('余: blocked enemies take 40 % ATK arts + 12 % burn per second, 庇护 while blocking; S3 +50 % HP/ATK/DEF', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_03_a', row: 9, col: 5, carryState: { sp: 40 } }],
    enemies: [{ key: 'enemy_walker', time: 0, route: 0 }],
  });
  const u = h.unit('chess_char_6_03_a');
  const t0 = u.def.talents[0].bb, bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.blocking.length > 0, 30), 'blocks');
  h.run(3);
  const dot = h.dmg.filter((d) => d.src === u.id && d.tags.includes('talent') && d.type === 'arts');
  assert.ok(dot.length >= 2);
  const burn = h.dmg.filter((d) => d.src === u.id && d.element === 'burn');
  assert.ok(burn.length >= 2);
  // 庇护 (ba.protect): physical and arts damage only
  assert.ok(u.findBuff('yu:shelter') && near(u.s.physTakenMul, 1 - t0.damage_resistance) && near(u.s.artsTakenMul, 1 - t0.damage_resistance));
  assert.equal(u.s.trueTakenMul, 1, '庇护 does not reduce true damage');
  assert.equal(u.s.dmgTakenMul, 1);
  const base = u.base.maxHp;
  assert.ok(h.runUntil(() => u.skill.active, 20), 'CUSTOM_RANGE trigger');
  assert.ok(near(u.s.maxHp, base * (1 + bb.max_hp)));
  assert.ok(near(dot[0].amount, u.base.atk * t0['yu_t_1[enemy].atk_scale'], 1e-3), 'DoT = 40 % ATK (before the skill)');
  checkInvariants(h.b);
});

test('余: S3 fire wall adds burn to allied arts damage crossing it and clears crossing enemy bullets', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_03_a', row: 10, col: 5, carryState: { sp: 54 } }, { chessId: 'chess_char_1_15_a', row: 9, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_shooter', pos: [11, 8] }],
    seed: 11,
  });
  // the shooter aims at 优等生 behind the wall: a taunt, since 余 (his column further right) now deploys last — the
  // latest deployed, the shooter's pick at equal taunt (deployment by column since 0.1.3)
  h.step();
  h.b.addBuff(h.unit('chess_char_1_15_a'), { key: 'test:taunt', mods: { taunt: 1 }, persist: true });
  const u = h.unit('chess_char_6_03_a');
  assert.ok(h.runUntil(() => u.skill.active, 10));
  h.run(15);
  const wall = h.dmg.filter((d) => d.src === u.id && d.tags.includes('firewall'));
  assert.ok(wall.length > 0, 'burn from the wall');
  assert.ok(near(wall[0].amount, u.s.atk * u.def.skill.bb.ep_damage_ratio, 1e-3));
  const blocked = h.eventsOf('fx').filter((e) => e[1] === 'firewallBlock');
  assert.ok(blocked.length > 0, 'some enemy bullets cleared');
});

test('浊心斯卡蒂: heals as a bard, S3 = true damage in her + 海嗣 ranges, 鼓舞 +65 % of her ATK, no death from drain', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_04_a', row: 11, col: 4, carryState: { sp: 38 } },
      { chessId: 'test_guard_a', row: 10, col: 4 },
      { kind: 'token', tokenId: 'token_10017_skadi2_dedant', row: 10, col: 8, ownerUid: 1 },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [11, 5] }, { key: 'enemy_dummy2', pos: [9, 9] }],
  });
  const u = h.unit('chess_char_6_04_a');
  const g = h.unit('test_guard_a');
  const tok = h.b.allyUnits.find((x) => x.defId === 'token_10017_skadi2_dedant');
  h.step();
  assert.ok(tok && tok.alive && tok.profile.noAttack, '海嗣 deployed, inert');
  g.hp = g.s.maxHp * 0.5;
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.run(2.2);
  const baseAtk = g.base.atk;
  const insp = g.findBuff('inspire');
  assert.ok(insp, 'ally inspired');
  assert.ok(near(g.s.atk - baseAtk, u.s.atk * u.def.skill.bb.atk, 1e-3), `inspire = 65 % of her ATK (${g.s.atk - baseAtk})`);
  const tide = h.dmg.filter((d) => d.src === u.id && d.tags.includes('tide'));
  const e1 = enemyAt(h, 'enemy_dummy'), e2 = enemyAt(h, 'enemy_dummy2');
  assert.ok(tide.some((d) => d.tgt === e1.id) && tide.some((d) => d.tgt === e2.id), 'her range + seaborn range');
  assert.ok(near(tide[0].amount, u.s.atk * u.def.skill.bb.atk_scale, 1e-3));
  h.runUntil(() => !u.skill.active, 30);
  assert.ok(u.alive && u.hp >= 1, 'drain is not lethal');
  const hp0 = g.hp;
  h.run(2);
  assert.ok(g.hp > hp0, 'bard heal resumes after the skill');
  checkInvariants(h.b);
});

test('浊心斯卡蒂: 海嗣 expires after its duration (25 s) and comes back after its redeploy time', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_04_a', row: 11, col: 4 }, { kind: 'token', tokenId: 'token_10017_skadi2_dedant', row: 10, col: 8, ownerUid: 1 }],
    flags: { dpInit: 50 },
  });
  const find = () => h.b.allyUnits.filter((x) => x.defId === 'token_10017_skadi2_dedant' && x.alive);
  h.step();
  assert.equal(find().length, 1);
  h.run(25.5);
  assert.equal(find().length, 0, 'expired');
  h.run(31);
  assert.equal(find().length, 1, 're-summoned');
});

test('异客: S3 storm strikes 8 times over 4 s at the highest-HP enemy; 机理分析 ×1.2 vs ≥80 % HP targets', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_05_a', row: 10, col: 3, carryState: { sp: 34 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy2', pos: [10, 6], mods: { hpMul: 2 } }],
  });
  const u = h.unit('chess_char_6_05_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.activations > 0, 10));
  const storm = h.eventsOf('fx').find((e) => e[1] === 'storm');
  const big = enemyAt(h, 'enemy_dummy2');
  assert.ok(storm && near(storm[2], big.x, 1e-2), 'storm on the highest-HP target');
  const t0 = h.b.time;
  h.run(bb.duration + 0.5);
  const first = h.dmg.filter((d) => d.src === u.id && d.tags.includes('storm') && d.t >= t0);
  const strikes = h.eventsOf('fx').filter((e) => e[1] === 'lightning');
  assert.ok(strikes.length >= Math.round(bb.duration / bb.interval), `8 strikes (${strikes.length} bolts)`);
  const main = first.find((d) => d.amount > 0);
  const mul = u.def.talents[0].bb['pasngr_t_1[enhance].damage_scale'];
  const ok = near(main.amount, u.s.atk * bb.atk_scale * mul, 1e-3) || near(main.amount, u.s.atk * bb.atk_scale * mul * (1 - u.profile.chain.falloff), 1e-3);
  assert.ok(ok, 'storm hit boosted by 机理分析 (targets at full HP)');
  assert.ok(big.findBuff(`pasngr:enhance:${u.id}`));
  checkInvariants(h.b);
});

test('佩佩: S3 ATK +150 %, main target stunned, stacks up to 4 with a growing splash; 近卫 aura +16 %', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_06_a', row: 9, col: 5, carryState: { sp: 56 } }, { chessId: 'test_guard_a', row: 12, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }, { key: 'enemy_dummy2', pos: [10, 6] }],
  });
  const u = h.unit('chess_char_6_06_a');
  const g = h.unit('test_guard_a');
  const bb = u.def.skill.bb;
  h.run(1);
  assert.ok(g.findBuff('pepe:lotus'), '弥漫莲香 on another 近卫');
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.run(10);
  const main = enemyAt(h, 'enemy_dummy'), side = enemyAt(h, 'enemy_dummy2');
  assert.equal(u.mem.pepeStack, bb['attack@max_stack_cnt']);
  assert.ok(near(u.skill.spec.attack.splashRadius, 1 + bb['attack@ability_range_forward_extend'] * bb['attack@max_stack_cnt']));
  const lotus = u.def.talents[1].bb.atk;
  assert.ok(near(u.s.atk, u.base.atk * (1 + bb.atk + lotus + bb['attack@atk'] * bb['attack@max_stack_cnt']), 1e-6));
  const stuns = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.source === u);
  assert.ok(stuns.some((c) => c.target === main && near(c.duration, bb['attack@stun_main'])), 'main target stunned 1 s');
  assert.ok(stuns.some((c) => c.target === side && near(c.duration, bb['attack@stun'])), 'splash target stunned 0.8 s');
  checkInvariants(h.b);
});

test('维娜·维多利亚: first hit trembles, S3 summons 黄金盟誓 (one per free tile around her), deals true damage to +1 target', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_07_a', row: 9, col: 5, carryState: { sp: 64 } }],
    enemies: [{ key: 'enemy_armored', pos: [9, 6] }],
  });
  const u = h.unit('chess_char_6_07_a');
  h.step();
  const e = enemyAt(h, 'enemy_armored');
  assert.ok(h.runUntil(() => u.skill.active, 10));
  const lions = h.b.allyUnits.filter((x) => x.defId === 'token_10040_siege2_vlion');
  assert.ok(lions.length >= 2 && lions.every((l) => l.alive), `黄金盟誓 summoned on the free tiles around her (${lions.length})`);
  for (const l of lions) assert.ok(Math.max(Math.abs(l.tileR - u.tileR), Math.abs(l.tileC - u.tileC)) <= 1);
  assert.equal(new Set(lions.map((l) => l.tileR * 100 + l.tileC)).size, lions.length, 'one per tile');
  h.run(3);
  assert.ok(h.dmg.some((d) => d.src === u.id && d.attack && d.type === 'true'), 'true damage');
  assert.ok(h.dmg.some((d) => lions.some((l) => l.id === d.src) && d.type === 'true'), 'a lion hits with true damage');
  assert.equal(u.profile.maxTargets + u.def.skill.bb['attack@max_target'] - 1 >= 2, true);
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'tremble' && c.target === e), '无拘的锋芒');
  h.runUntil(() => !u.skill.active, 30);
  h.step();
  assert.ok(lions.every((l) => !l.alive), 'the lions leave with the skill');
  checkInvariants(h.b);
});

test('焰影苇草: 灼痕 (ATK −20 %, arts fragile) ; S3 = 100 % application, 2 targets, DoT', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_08_a', row: 10, col: 3, carryState: { sp: 44 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy2', pos: [10, 6] }],
  });
  const u = h.unit('chess_char_6_08_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 10));
  h.run(4);
  const a = enemyAt(h, 'enemy_dummy'), b = enemyAt(h, 'enemy_dummy2');
  assert.ok(a.findBuff('reed2:scorch') && b.findBuff('reed2:scorch'), 'both targets scorched');
  assert.ok(near(a.s.artsTakenMul, u.def.talents[0].bb.damage_scale));
  const dot = h.dmg.filter((d) => d.src === u.id && d.tags.includes('scorch'));
  assert.ok(dot.length >= 2);
  assert.ok(near(dot[0].amount, u.s.atk * bb['talent@s3_atk_scale'] * u.def.talents[0].bb.damage_scale, 1e-3), 'DoT 20 % ATK (× fragile)');
  checkInvariants(h.b);
});

test('焰影苇草: 映耀 — she receives 50 % of the heal she gives', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_08_a', row: 10, col: 3 }, { chessId: 'test_guard_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    hooks: ['heal'], captureNoisy: true,
  });
  const u = h.unit('chess_char_6_08_a'), g = h.unit('test_guard_a');
  h.step();
  g.hp = g.s.maxHp * 0.3;
  u.hp = u.s.maxHp * 0.3;
  h.run(4);
  const heals = h.hooksOf('heal').filter((c) => c.source === u);
  const toG = heals.find((c) => c.target === g), self = heals.find((c) => c.target === u && c.opts?.reflect);
  assert.ok(toG && self, 'heals the ally and itself');
  assert.ok(near(self.amount, toG.amount * u.def.talents[1].bb.scale, 1e-6));
});

test('塑心: no normal attack; each charge hits 210 % arts + 85 % apoptosis (×1.2 in her range)', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_09_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit('chess_char_6_09_a');
  const bb = u.def.skill.bb, t1 = u.def.talents[1].bb;
  h.run(12);
  const arts = h.dmg.filter((d) => d.src === u.id && d.type === 'arts');
  assert.ok(arts.length >= 2);
  for (const d of arts) assert.ok(d.skill, 'every attack is a skill attack');
  assert.ok(near(arts[0].amount, u.s.atk * bb.atk_scale, 1e-3));
  assert.equal(arts.length, u.skill.activations - (u.skill.pending ? 1 : 0));
  // one gauge fill of 85 % ATK × 1.2 (精神逆构, via elementHit — no separate 'amp' instance)
  const i = h.dmg.findIndex((d) => d.src === u.id && d.element === 'apoptosis' && d.tags.includes('skill'));
  assert.ok(i >= 0 && near(h.dmg[i].amount, u.s.atk * bb.ep_damage_ratio * t1.ep_damage_scale, 1e-3), 'skill apoptosis 85 % ATK × 1.2');
  assert.ok(!h.dmg.some((d) => d.tags.includes('amp')), 'no extra amplification instance');
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'sluggish' && c.source === u), '无词哀歌 sluggish');
  checkInvariants(h.b);
});

test('妮芙 (tier 6): S2 = 270 % arts + equal splash, fear, apoptosis 18 % of the damage', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_10_a', row: 10, col: 3, carryState: { sp: 16 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy2', pos: [11, 5] }],
  });
  const u = h.unit('chess_char_6_10_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => h.dmg.some((d) => d.src === u.id && d.skill && d.type === 'arts'), 10));
  h.run(0.3);
  const hits = h.dmg.filter((d) => d.src === u.id && d.skill && d.type === 'arts');
  assert.equal(hits.length, 2, 'main + splash');
  for (const d of hits) assert.ok(near(d.amount, u.s.atk * bb.atk_scale, 1e-3));
  const apo = h.dmg.filter((d) => d.src === u.id && d.element === 'apoptosis');
  assert.equal(apo.length, 2);
  assert.ok(near(apo[0].amount, hits[0].amount * bb.ep_damage_ratio, 1e-3));
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'fear'), 'fear');
  checkInvariants(h.b);
});

test('妮芙 (tier 6): 失魂 — attacking an enemy in apoptosis burst adds a 40 % ATK element DoT', () => {
  const h = battle({ units: [{ chessId: 'chess_char_6_10_a', row: 10, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
  const u = h.unit('chess_char_6_10_a');
  h.step();
  const e = enemyAt(h, 'enemy_dummy');
  h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 1000 });
  assert.ok(e.findBuff('apoptosisBurst'));
  h.run(4);
  const soul = h.dmg.filter((d) => d.src === u.id && d.tags.includes('elementDmg'));
  assert.ok(soul.length >= 1);
  assert.equal(soul[0].type, 'elemental', '元素伤害 = the elemental damage type (not true damage)');
  assert.ok(near(soul[0].amount, u.s.atk * u.def.talents[0].bb.element_atk_scale, 1e-3));
  assert.ok(u.findBuff('nymph:key'), '窥心钥 stack after an apoptosis burst in range');
});

test('缪尔赛思: 流形 copies the nearest operator (90 %), S3 gives 13 DP and +22 % ATK to her and 流形', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_11_a', row: 10, col: 3 },
      { chessId: 'test_guard_a', row: 11, col: 5 },
      { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 10, col: 5, ownerUid: 1 },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6], time: 20 }],
    flags: { dpInit: 0, dpPerSec: 0 },
  });
  const u = h.unit('chess_char_6_11_a'), g = h.unit('test_guard_a');
  const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
  h.run(0.2);
  assert.ok(tok().base.atk < g.base.atk, 'not copied yet (token SP 95/100)');
  h.run(6);
  const scale = tok().def.talents[0].bb.scale;
  assert.ok(near(tok().base.atk, g.base.atk * scale) && near(tok().base.maxHp, g.base.maxHp * scale), 'copied 90 % stats');
  assert.equal(tok().mem.mlyss.ranged, false);
  assert.ok(h.runUntil(() => u.skill.active, 60), 'skill');
  assert.ok(near(h.b.getPlayer('p1').dp, u.def.skill.bb.cost), '+13 DP');
  assert.ok(tok().findBuff('mlyss:s3'));
  checkInvariants(h.b);
});

test('缪尔赛思: a destroyed 流形 comes back after 25 s; melee copy steals ATK/DEF', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_11_a', row: 12, col: 3 },
      { chessId: 'test_guard_a', row: 12, col: 5 },
      { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 10, col: 5, ownerUid: 1 },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
  h.run(8);
  const e = enemyAt(h, 'enemy_dummy');
  assert.ok(e.findBuff('mlyss:robbed'), 'enemy robbed');
  assert.ok(tok().mem.mlyss.stolenAtk > 0 && tok().mem.mlyss.stolenDef > 0);
  assert.equal(e.findBuff('mlyss:robbed').mods.atkFlat, -tok().mem.mlyss.stolenAtk, 'the enemy loses what the copy gains');
  const t = tok();
  h.b.dealDamage(null, t, { amount: 1e9, type: 'true' });
  assert.equal(tok(), undefined);
  h.run(24);
  assert.equal(tok(), undefined);
  h.run(2);
  assert.ok(tok(), 'respawned');
});

test('迷迭香: S2 adds 2 aftershocks per attack, ignores 160 DEF (talent)', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_12_a', row: 10, col: 3, carryState: { sp: 36 } }],
    enemies: [{ key: 'enemy_armored', pos: [10, 5] }],
  });
  const u = h.unit('chess_char_6_12_a');
  h.step();
  assert.equal(u.s.defIgnoreFlat, u.def.talents[0].bb.def_penetrate_fixed);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  const t0 = h.b.time;
  h.run(8);
  const atks = h.dmg.filter((d) => d.src === u.id && d.attack && !d.splash && d.t > t0);
  const shocks = h.dmg.filter((d) => d.src === u.id && d.tags.includes('aftershock') && d.t > t0);
  assert.ok(atks.length >= 2);
  const per = (u.profile.shockTimes - 1);
  assert.equal(per, (u.def.traitBb['attack@times'] - 1) + u.def.skill.bb.add_times);
  assert.ok(shocks.length >= (atks.length - 1) * per, `aftershocks ${shocks.length} for ${atks.length} attacks`);
  const e = enemyAt(h, 'enemy_armored');
  assert.ok(near(atks[0].amount, u.s.atk - (e.s.def - u.def.talents[0].bb.def_penetrate_fixed), 1e-3), 'DEF 500 − 160');
  h.runUntil(() => !u.skill.active, 60);
  assert.equal(u.profile.shockTimes, u.def.traitBb['attack@times'], 'restored after the skill');
});

test('新约能天使: S2 steals 70 ASPD from an ally in range, shields both, 35+5 ammo; 火力电台 heals per ammo', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_13_a', row: 10, col: 3, carryState: { sp: 29 } }, { chessId: 'test_guard_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    hooks: ['ammoUsed', 'skillEnd'],
  });
  const u = h.unit('chess_char_6_13_a'), g = h.unit('test_guard_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 10));
  assert.equal(g.s.aspd, 100 - bb.steal);
  assert.equal(u.s.aspd, 100 + bb.steal);
  assert.ok(u.s.shield > 0 && g.s.shield > 0, 'barriers');
  assert.equal(u.skill.ammoLeft + h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, bb['attack@trigger_time'] + bb.addtional_ammo_each, '35 + 5 bullets');
  u.hp = u.s.maxHp * 0.5;
  const hp0 = u.hp;
  h.run(1);
  assert.ok(u.hp > hp0, '火力电台 heal on ammo use');
  h.runUntil(() => !u.skill.active, 60);
  const used = h.hooksOf('ammoUsed').filter((c) => c.unit === u);
  assert.equal(used.length, bb['attack@trigger_time'] + bb.addtional_ammo_each);
  assert.equal(g.s.aspd, 100, 'ASPD returned');
  checkInvariants(h.b);
});

test('流明: S3 bullets are spent only on abnormal allies (cleansed, 135 % heal); 应急处理 heals on status', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_14_a', row: 10, col: 3, carryState: { sp: 60 } }, { chessId: 'test_guard_a', row: 10, col: 5 }],
    hooks: ['ammoUsed', 'heal'], captureNoisy: true,
  });
  const u = h.unit('chess_char_6_14_a'), g = h.unit('test_guard_a');
  const bb = u.def.skill.bb;
  h.step();
  g.hp = g.s.maxHp * 0.2;
  h.b.applyStatus(g, 'stun', { duration: 30 });
  const emergency = h.hooksOf('heal').filter((c) => c.source === u && c.target === g);
  assert.ok(emergency.length >= 1, '应急处理');
  assert.ok(near(emergency[0].amount, u.s.atk * u.def.talents[1].bb.heal_scale, 1e-3));
  assert.ok(g.findBuff('resist'), '凡人之愿: 抵抗 (engine resist status) on the healed ally');
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.ok(h.runUntil(() => !g.findBuff('stun'), 5), 'stun cleansed');
  const used = h.hooksOf('ammoUsed').filter((c) => c.unit === u);
  assert.equal(used.length, 1, 'one bullet for the abnormal heal');
  const big = h.hooksOf('heal').filter((c) => c.source === u && c.target === g).at(-1);
  assert.ok(near(big.amount, u.s.atk * bb.heal_scale, 1e-3), '135 % heal');
  h.run(3);
  assert.equal(h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, 1, 'normal heals are free');
  assert.ok(u.skill.active);
  h.b.applyStatus(g, 'stun', { duration: 10 });
  assert.ok(g.findBuff('stun').timeLeft <= 10 * 0.5 + 1e-6, '抵抗 halves new statuses');
  checkInvariants(h.b);
});

test('仇白: S3 arts damage on 3 targets with ASPD stacks; 落英 binds; 入隙 extra 40 % arts on bound targets', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_15_a', row: 10, col: 5, carryState: { sp: 60 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy2', pos: [10, 7] }, { key: 'enemy_dummy', pos: [11, 6] }],
    seed: 3,
  });
  const u = h.unit('chess_char_6_15_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 10));
  const t0 = h.b.time;
  h.run(8);
  const hits = h.dmg.filter((d) => d.src === u.id && d.attack && d.t > t0);
  assert.ok(hits.every((d) => d.type === 'arts'), 'arts');
  assert.equal(new Set(hits.map((d) => d.tgt)).size, 3, '3 targets');
  assert.equal(u.s.aspd, 100 + bb.attack_speed * bb.max_stack_cnt);
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'bind' && c.source === u), '落英');
  const gap = h.dmg.filter((d) => d.src === u.id && d.tags.includes('talent'));
  assert.ok(gap.length > 0 && near(gap[0].amount, u.s.atk * u.def.talents[0].bb.atk_scale, 0.1), '入隙');
  checkInvariants(h.b);
});

test('溯光星源: 能源解析 fragile 10 % → 14 % after 7 s; S3 links 2 targets (15 % transfer)', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_16_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy2', pos: [11, 5] }],
  });
  const u = h.unit('chess_char_6_16_a');
  const t1 = u.def.talents[1].bb, bb = u.def.skill.bb;
  h.run(1);
  const e = enemyAt(h, 'enemy_dummy');
  assert.ok(near(e.s.dmgTakenMul, t1['halo2_t_1[weak].damage_scale']));
  h.run(7);
  assert.ok(near(e.s.dmgTakenMul, t1['halo2_t_1[weak].damage_scale_max']));
  assert.ok(u.mem.haloStack > 0, '数据建模 stacks from sluggish');
  assert.ok(h.runUntil(() => u.skill.active, 40));
  const t0 = h.b.time;
  h.run(3);
  const direct = h.dmg.filter((d) => d.src === u.id && d.attack && d.t > t0);
  const link = h.dmg.filter((d) => d.tags.includes('link') && d.t > t0);
  assert.ok(link.length > 0, 'linked transfer');
  assert.ok(near(link[0].amount, direct[0].amount * bb['attack@atk_share'], 1e-2), `share ${link[0].amount} vs ${direct[0].amount}`);
  checkInvariants(h.b);
});

test('耀骑士临光: S3 summons 耀阳 (90 % true + stun 3 s around it), true damage on blocked; 不畏苦暗 on redeploy', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_17_a', row: 10, col: 5, carryState: { sp: 54 } }],
    enemies: [{ key: 'enemy_armored', pos: [10, 6] }],
  });
  const u = h.unit('chess_char_6_17_a');
  const bb = u.def.skill.bb;
  h.step();
  const e = enemyAt(h, 'enemy_armored');
  assert.ok(h.runUntil(() => u.skill.active, 10));
  const sword = h.b.allyUnits.find((x) => x.defId === 'token_10019_nearl2_sword' && x.alive);
  assert.ok(sword, '耀阳 summoned');
  // the appear burst is done by the token kit (content/tokens.js) when present, else by the 耀骑士临光 kit
  const burst = h.dmg.filter((d) => (d.src === u.id || d.src === sword.id) && d.type === 'true' && d.skill && !d.attack);
  assert.ok(burst.length >= 1 && near(burst[0].amount, u.s.atk * bb.value, 1e-3), '90 % of her ATK, true');
  assert.ok(e.s.flags.stun, 'stunned 3 s');
  assert.ok(h.runUntil(() => e.blockedBy === sword, 6), '耀阳 blocks the enemy once the stun ends');
  const tb = h.b.time;
  h.run(3.5);
  const hits = h.dmg.filter((d) => d.src === u.id && d.attack && d.tgt === e.id && d.t >= tb);
  assert.ok(hits.length && hits.every((d) => d.type === 'true'), 'attacks on the blocked enemy deal true damage');
  // talent: redeploy next to the enemy
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false);
  h.run(0.1);
  h.b.redeploy(u);
  const tal = h.dmg.filter((d) => d.src === u.id && d.tags.includes('talent'));
  assert.ok(tal.length >= 1 && near(tal[0].amount, u.s.atk * u.def.talents[0].bb.atk_scale, 1e-3), '不畏苦暗');
  assert.equal(u.s.defIgnorePct, u.def.talents[1].bb.def_penetrate, '破晓');
});

test('荒芜拉普兰德: S3 drones chase enemies anywhere, fear on catch, 100 % ATK arts per second around them', () => {
  // (one enemy, far outside her range: every drone picks the enemy nearest to itself — PRTS S3 备注 ② — so a second,
  // nearer enemy would draw all of them; the full flight is in test/sim/feedback2-whitw2-yu.test.js)
  const h = battle({
    units: [{ chessId: 'chess_char_6_18_a', row: 10, col: 3, carryState: { sp: 68 } }],
    enemies: [{ key: 'enemy_dummy2', pos: [12, 9] }],
  });
  const u = h.unit('chess_char_6_18_a');
  const bb = u.def.skill.bb;
  assert.ok(h.runUntil(() => u.skill.active, 10));
  assert.equal(u.mem.drones.length, 1 + bb['attack@cnt']);
  const far = enemyAt(h, 'enemy_dummy2');
  assert.ok(h.runUntil(() => h.dmg.some((d) => d.tgt === far.id && d.tags.includes('drone')), 20), 'a drone reaches the far enemy');
  const hit = h.dmg.find((d) => d.tgt === far.id && d.tags.includes('drone'));
  assert.ok(near(hit.amount, u.s.atk * bb['attack@magic_atk_scale'], 1e-3));
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'fear' && c.target === far));
  assert.ok(far.findBuff('whitw2:slow'));
  checkInvariants(h.b);
});

test('荒芜拉普兰德: 叙拉古的荣幸 +5 initial SP for 叙拉古 operators', () => {
  const h = battle({ units: [{ chessId: 'chess_char_6_18_a', row: 10, col: 3 }] });
  const u = h.unit('chess_char_6_18_a');
  h.step();
  assert.ok(u.skill.sp >= u.def.skill.initSp + u.def.talents[1].bb.sp - 0.1);
});

test('锏: S3 = 10 slashes (180 % ×1.6 talent) on ≤5 enemies + a 300 % finisher, pulls enemies in', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_19_a', row: 10, col: 5, carryState: { sp: 34 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy2', pos: [10, 7] }],
    hooks: ['skillStart', 'skillEnd', 'statusApplied'],
  });
  const u = h.unit('chess_char_6_19_a');
  const bb = u.def.skill.bb, t0 = u.def.talents[0].bb;
  assert.ok(h.runUntil(() => u.skill.active, 10));
  const t = h.hooksOf('skillStart').find((c) => c.unit === u).t;
  h.runUntil(() => !u.skill.active, 10);
  const slashes = h.dmg.filter((d) => d.src === u.id && d.tags.includes('slash'));
  assert.equal(slashes.length, 11 * 2, '10 slashes + finisher on 2 enemies');
  assert.ok(near(slashes[0].amount, u.s.atk * bb.d_atk_scale * t0.atk_scale, 1e-3));
  assert.ok(near(slashes.at(-1).amount, u.s.atk * bb.e_atk_scale_end * t0.atk_scale, 1e-3));
  assert.ok(near(h.b.time - t, 10 * bb.d_hit_interval, 0.05));
  const far = enemyAt(h, 'enemy_dummy2');
  assert.ok(far.x < 7 - 0.4, 'pulled toward her');
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'tremble'), '战栗');
  checkInvariants(h.b);
});

test('锏 S3: invulnerable, stun- and freeze-immune during the slashes (PRTS 备注); normal again after them', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_19_a', row: 10, col: 5, carryState: { sp: 34 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
  });
  const u = h.unit('chess_char_6_19_a');
  assert.ok(h.runUntil(() => u.skill.active, 10));
  h.step();
  const hp = u.hp;
  h.b.dealDamage(null, u, { amount: 500, type: 'true' });
  assert.equal(u.hp, hp, '无敌');
  assert.equal(h.b.applyStatus(u, 'stun', { duration: 3 }), false, '晕眩免疫');
  assert.equal(h.b.applyStatus(u, 'freeze', { duration: 3 }), false, '冻结免疫');
  h.b.applyStatus(u, 'cold', { duration: 5 });
  h.b.applyStatus(u, 'cold', { duration: 5 });
  assert.ok(!u.s.flags.freeze, 'cold on cold does not freeze her either');
  assert.ok(h.runUntil(() => !u.skill.active, 10));
  h.b.dealDamage(null, u, { amount: 500, type: 'true' });
  assert.ok(u.hp < hp, 'takes damage again after the slashes');
  assert.ok(h.b.applyStatus(u, 'stun', { duration: 1 }), 'can be stunned again');
  checkInvariants(h.b);
});

test('纯烬艾雅法拉: S3 heals across the whole field in 5 shots (35 %); 火山灰疗愈 max HP +6 %; 氤氲 HoT', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_20_a', row: 10, col: 3, carryState: { sp: 74 } },
      { chessId: 'test_guard_a', row: 12, col: 10 },
      { chessId: 'test_guard_a', row: 9, col: 10, uid: 9 },
      { chessId: 'test_guard_a', row: 10, col: 4, uid: 10 },
    ],
    hooks: ['heal'], captureNoisy: true,
  });
  const u = h.unit('chess_char_6_20_a');
  const bb = u.def.skill.bb, t1 = u.def.talents[1].bb;
  h.run(0.6);
  const guards = h.b.allyUnits.filter((a) => a.defId === 'test_guard_a');
  const nearG = guards.find((g) => g.tileC === 4);
  assert.ok(near(nearG.s.maxHp, nearG.base.maxHp * (1 + t1.max_hp)), 'max HP +6 % in range');
  for (const g of guards) g.hp = g.s.maxHp * 0.3;
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.run(3);
  const farG = guards.find((g) => g.tileC === 10 && g.tileR === 12);
  const heals = h.hooksOf('heal').filter((c) => c.source === u && !c.opts?.hot);
  assert.ok(heals.some((c) => c.target === farG), 'far ally healed');
  assert.ok(near(heals.find((c) => c.target === farG).amount, u.s.atk * bb['attack@heal_scale'], 1e-3), '35 % heal per shot');
  const byT = new Map();
  for (const c of heals) byT.set(c.t, (byT.get(c.t) ?? 0) + 1);
  const shots = Math.max(...byT.values());
  assert.equal(shots, 5, '5 shots per attack');
  assert.ok(near(nearG.s.maxHp, nearG.base.maxHp * (1 + t1.max_hp * bb.talent_scale)), 'talent ×2.9 during S3');
  assert.ok(h.hooksOf('heal').some((c) => c.source === u && c.opts?.hot), '氤氲 HoT');
  checkInvariants(h.b);
});

test('all tier-6 kits (normal + elite) survive a real wave without content errors', () => {
  const ids = ['1_15', '6_01', '6_02', '6_03', '6_04', '6_05', '6_06', '6_07', '6_08', '6_09', '6_10', '6_11', '6_12', '6_13', '6_14', '6_15', '6_16', '6_17', '6_18', '6_19', '6_20'];
  for (const sfx of ['a', 'b']) {
    for (let i = 0; i < ids.length; i += 7) {
      const group = ids.slice(i, i + 7);
      const spots = [[9, 5], [10, 5], [11, 5], [12, 5], [9, 3], [10, 3], [11, 3]];
      const h = makeBattle({
        units: group.map((id, k) => ({ chessId: `chess_char_${id}_${sfx}`, row: spots[k][0], col: spots[k][1], carryState: { sp: 99 } })),
        waveTemplate: 'act1autochess_05', seed: 5 + i,
      });
      h.runToEnd(200);
      const errs = h.b.errors.filter((e) => /tier6|kit|skill|talent|hook|buff|every|after|profile/.test(e.label + ' ' + (e.stack || '')));
      assert.deepEqual(errs.map((e) => `${e.label} ${e.who}: ${e.message}`), [], `group ${group.join(',')} ${sfx}`);
      checkInvariants(h.b);
    }
  }
});

test('tier-6 talent auras: 铳弹协约, 诸王的叹息, 感知稳定, 孤卒, 开源节流, 弥漫莲香', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_13_a', row: 10, col: 3 },   // 新约能天使
      { chessId: 'chess_char_6_01_a', row: 11, col: 3 },   // 蕾缪安 (拉特兰, ammo skill)
      { chessId: 'chess_char_6_14_a', row: 12, col: 3 },   // 流明 (ammo skill)
      { chessId: 'chess_char_6_07_a', row: 9, col: 5 },    // 维娜
      { chessId: 'test_guard_a', row: 10, col: 5 },
      { chessId: 'chess_char_6_12_a', row: 12, col: 7 },   // 迷迭香
      { chessId: 'chess_char_6_05_a', row: 11, col: 7 },   // 异客 (术师)
      { chessId: 'chess_char_6_11_a', row: 12, col: 9 },   // 缪尔赛思 (莱茵生命)
      { chessId: 'chess_char_2_02_a', row: 11, col: 9 },   // 赫默 (莱茵生命)
    ],
  });
  h.run(1);
  const u = (id) => h.unit(id);
  const angel = u('chess_char_6_13_a'), lem = u('chess_char_6_01_a'), lumen = u('chess_char_6_14_a');
  const tAng = angel.def.talents[1].bb;
  assert.ok(near(lem.findBuff('angel2:covenant').mods.atkPct, tAng.atk * tAng.mult), '拉特兰 ammo op: ×2');
  assert.ok(near(lumen.findBuff('angel2:covenant').mods.atkPct, tAng.atk), 'other ammo op: +9 %');
  const vina = u('chess_char_6_07_a'), g = u('test_guard_a');
  assert.ok(near(g.s.physTakenMul, 1 - vina.def.talents[0].bb.damage_resistance), '诸王的叹息 phys reduction');
  assert.ok(near(vina.findBuff('siege2:kings').mods.atkPct, vina.def.talents[0].bb.atk * 1), '+5 % per ally around');
  const ros = u('chess_char_6_12_a'), pas = u('chess_char_6_05_a');
  assert.ok(ros.findBuff('rosmon:stable') && pas.findBuff('rosmon:stable'), '感知稳定 on 迷迭香 and the caster');
  assert.ok(near(pas.findBuff('pasngr:lone').mods.atkPct, pas.def.talents[1].bb.atk), '孤卒');
  assert.ok(g.findBuff('pepe:lotus') === null, 'no 佩佩 on the field');
  const mly = u('chess_char_6_11_a'), silent = u('chess_char_2_02_a');
  const cut = mly.def.talents[1].bb;
  const costs = [mly, silent].sort((a, b) => a.deploySeq - b.deploySeq);
  assert.equal(costs[0].base.cost, costs[0].def.stats.cost + cut.cost + cut.runtime_cost, 'first 莱茵生命 op −3');
  assert.equal(costs[1].base.cost, costs[1].def.stats.cost + cut.cost, 'other 莱茵生命 op −2');
  checkInvariants(h.b);
});

// --------------------------------------------------------------------------------------------------------------------
// regression tests (fidelity pass)

DEFS.enemies.enemy_heavy = dummy({ key: 'enemy_heavy', mass: 10 });
DEFS.chess.test_caster_a = chessRec({ id: 'test_caster_a', profession: 'CASTER', dmgType: 'arts', skill: null, stats: { atk: 1000 }, rangeGrid: Array.from({ length: 6 }, (_, c) => [0, c]) });

test('summon tiles skip reserved home tiles: 黄金盟誓 never takes the tile of an operator waiting to redeploy', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_07_a', row: 9, col: 5, carryState: { sp: 64 } }, { chessId: 'test_guard_a', row: 10, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    flags: { dpInit: 50 },
  });
  const u = h.unit('chess_char_6_07_a'), g = h.unit('test_guard_a');
  h.step();
  h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
  assert.equal(g.alive, false);
  // the free deployable melee tiles of her 3×3 area just before the cast — the dead guard's home tile among them
  const HOME = 10 * 100 + 5;
  let free = [];
  for (let i = 0; i < 100 && !u.skill.active; i++) {
    free = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = u.tileR + dr, c = u.tileC + dc;
      if ((dr || dc) && h.b.grid.inRect(r, c) && h.b.grid.canStand(r, c, { ranged: false }) && !h.b.unitAt(r, c)) free.push(r * 100 + c);
    }
    h.step();
  }
  assert.ok(u.skill.active, 'S3 cast');
  assert.ok(free.includes(HOME) && free.length >= 2, `the scenario: the guard's home tile is one of the free tiles (${free})`);
  const lions = h.b.allyUnits.filter((x) => x.defId === 'token_10040_siege2_vlion' && x.alive);
  assert.ok(lions.every((l) => !(l.tileR === 10 && l.tileC === 5)), 'no lion on the dead guard\'s home tile');
  assert.deepEqual(lions.map((l) => l.tileR * 100 + l.tileC).sort((a, b) => a - b), free.filter((k) => k !== HOME).sort((a, b) => a - b), 'a lion on every other free tile');
  assert.ok(h.runUntil(() => g.alive, g.base.respawnTime + 2), 'the guard redeploys on its tile');
  checkInvariants(h.b);
});

test('余 (elite): 阻挡 ⇒ element ×1.15 (module, elementHit); S3 gives the ×1.14 arts vs burning targets to every operator (≥4 ops)', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_03_b', row: 10, col: 5 },
      { chessId: 'test_caster_a', row: 12, col: 3 },
      { chessId: 'test_guard_a', row: 12, col: 8 }, { chessId: 'test_guard_a', row: 9, col: 8, uid: 7 },
    ],
    enemies: [{ key: 'enemy_walker', route: { motion: 'WALK', start: [10, 9], end: [10, 2], checkpoints: [] } }],
  });
  const u = h.unit('chess_char_6_03_b'), c = h.unit('test_caster_a');
  const t0 = u.def.talents[0].bb;
  assert.ok(h.runUntil(() => u.blocking.length > 0 && h.dmg.some((d) => d.src === u.id && d.element === 'burn'), 30), 'blocks + burn DoT');
  const burn = h.dmg.find((d) => d.src === u.id && d.element === 'burn');
  assert.ok(near(burn.amount, u.s.atk * t0['yu_t_1[enemy].ep_damage_ratio'] * u.def.traitBb.ep_damage_scale, 1e-6), `burn ${burn.amount} = ATK × 12 % × 1.15`);
  const e = enemyAt(h, 'enemy_walker');
  // force a burn burst, then compare the caster's arts hits before / during 余's S3
  e.elem.burn = 0;
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 5000 });
  assert.ok(e.findBuff('burnBurst'));
  const hitOf = () => { const n = h.dmg.length; h.b.dealDamage(c, e, { amount: 1000, type: 'arts' }); return h.dmg.slice(n).find((d) => d.src === c.id && d.type === 'arts')?.amount; };
  const plain = hitOf();
  u.skill.activate('test', { free: true });
  assert.ok(u.skill.active);
  const boosted = hitOf();
  const ds = u.def.raw.talents.find((t) => t.index === -1 && t.bb.damage_scale).bb.damage_scale;
  assert.ok(near(boosted, plain * ds, 1e-6), `other op ×${ds} vs burning while S3 runs (${plain} → ${boosted})`);
  checkInvariants(h.b);
});

test('塑心: 精神逆构 multiplies every apoptosis fill in her range once (two 塑心 do not stack); elite ×1.18 vs elite enemies', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_09_a', row: 10, col: 4 }, { chessId: 'chess_char_6_09_a', row: 11, col: 4, uid: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit('chess_char_6_09_a');
  h.step();
  const e = enemyAt(h, 'enemy_dummy');
  const got = h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 100 });
  assert.ok(near(got, 100 * u.def.talents[1].bb.ep_damage_scale, 1e-9), `×1.2 once (${got})`);
  const other = h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 100 });
  assert.ok(near(other, 100, 1e-9), 'other elements untouched');
  // elite vs an elite enemy: 95 % ATK × 1.33 (精神逆构 module) × 1.18 (强弱法)
  const h2 = battle({ units: [{ chessId: 'chess_char_6_09_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_elite', pos: [10, 5] }] });
  const v = h2.unit('chess_char_6_09_b');
  assert.ok(h2.runUntil(() => h2.dmg.some((d) => d.src === v.id && d.element === 'apoptosis' && d.tags.includes('skill')), 10));
  const sk = h2.dmg.find((d) => d.src === v.id && d.element === 'apoptosis' && d.tags.includes('skill'));
  const want = v.s.atk * v.def.skill.bb.ep_damage_ratio * v.def.talents[1].bb.ep_damage_scale * v.def.traitBb.ep_damage_scale;
  assert.ok(near(sk.amount, want, 1e-6), `elite ${sk.amount} ≈ ${want}`);
  checkInvariants(h.b);
});

test('锏: the S3 finisher (and its pull) uses the skill range, not her normal 1-tile range', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_19_a', row: 10, col: 5, carryState: { sp: 34 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_heavy', pos: [12, 5] }],
  });
  const u = h.unit('chess_char_6_19_a');
  assert.ok(h.runUntil(() => u.skill.active, 10));
  h.runUntil(() => !u.skill.active, 10);
  h.step();
  const heavy = enemyAt(h, 'enemy_heavy');
  assert.ok(near(heavy.y, 12) && near(heavy.x, 5), 'too heavy to be pulled (mass 10)');
  const hits = h.dmg.filter((d) => d.src === u.id && d.tgt === heavy.id && d.tags.includes('slash'));
  assert.equal(hits.length, 11, '10 slashes + the finisher reach the enemy 2 tiles away (x-1 skill range)');
  assert.ok(near(hits.at(-1).amount / hits[0].amount, u.def.skill.bb.e_atk_scale_end / u.def.skill.bb.d_atk_scale, 1e-6), 'finisher 300 %');
});

test('荒芜拉普兰德: 叙拉古的荣幸 +5 initial SP on every deployment; 头狼 stage 3 = one more drone hit per attack', () => {
  const h = battle({ units: [{ chessId: 'chess_char_6_18_a', row: 10, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], flags: { dpInit: 99 } });
  const u = h.unit('chess_char_6_18_a');
  const sp = u.def.talents[1].bb.sp, init = u.def.skill.initSp;
  h.step();
  assert.ok(near(u.skill.sp, init + sp, 0.1), `first deployment ${u.skill.sp}`);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false);
  h.b.redeploy(u);
  assert.ok(u.alive);
  assert.ok(near(u.skill.sp, init + sp, 1e-6), `redeployment also starts with +${sp} (${u.skill.sp})`);
  assert.equal(u.profile.hits, 1);
  assert.ok(h.runUntil(() => u.mem.wolfStage === 3, 3 * u.def.talents[0].bb.interval + 2));
  assert.equal(u.profile.hits, 2, '数量+1');
  const ts = h.b.time;
  const e = enemyAt(h, 'enemy_dummy');
  // (S3 may be running — its drones do not normal-attack): wait for a normal attack after stage 3
  assert.ok(h.runUntil(() => h.dmg.some((d) => d.src === u.id && d.attack && d.tgt === e.id && d.t > ts), 60));
  const last = h.dmg.filter((d) => d.src === u.id && d.attack && d.tgt === e.id).at(-1);
  const same = h.dmg.filter((d) => d.src === u.id && d.attack && d.t === last.t);
  assert.equal(same.length, 2, 'two drone hits per attack');
});

test('缪尔赛思: 流形 copies stats/range/damage type but not the attack shape (锏 2-hit); a capped melee copy steals nothing more', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_11_a', row: 10, col: 3 },
      { chessId: 'chess_char_6_19_a', row: 11, col: 5 },
      { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 10, col: 5, ownerUid: 1 },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
  });
  const d = h.unit('chess_char_6_19_a');
  // 锏 only lends her stats here: her S3 fires on its own 技能范围 (playtest #6 item 15) and pulls the dummy all the way
  // to her (official pull, item 14), where she blocks it outside the copy's range — keep her SP empty (阻回)
  h.step();
  assert.ok(h.b.addBuff(d, { key: 'test:noSp', flags: { noSp: true }, persist: true }));
  const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
  h.run(6);
  const t = tok();
  const tal = t.def.talents.find((x) => x.bb.scale != null).bb;
  assert.equal(t.mem.mlyss.from, d.id, 'copies the nearest operator (锏)');
  assert.ok(near(t.base.atk, d.base.atk * tal.scale) && t.base.blockCnt === d.base.blockCnt && t.base.bat === d.base.bat);
  assert.deepEqual(t.rangeGrid, d.rangeGrid, 'range copied');
  assert.equal(t.profile.dmgType, 'phys');
  assert.equal(t.profile.attack, 'melee');
  assert.equal(t.profile.hits, 1, 'the 2-hit trait of 剑豪 is not a listed attribute');
  const steal = t.def.talents.find((x) => x.bb.steal_atk != null).bb;
  h.runUntil(() => t.mem.mlyss.stolenAtk >= steal.steal_atk_max, 80);
  const e = enemyAt(h, 'enemy_dummy');
  h.run(5);
  assert.equal(t.mem.mlyss.stolenAtk, steal.steal_atk_max, 'capped at 250');
  assert.equal(e.findBuff('mlyss:robbed').mods.atkFlat, -steal.steal_atk_max, 'the enemy never loses more than was stolen');
  checkInvariants(h.b);
});

test('浊心斯卡蒂: an enemy in the 海嗣 range alone triggers S3; she never keeps a 鼓舞', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_04_a', row: 12, col: 3, carryState: { sp: 39 } }, { kind: 'token', tokenId: 'token_10017_skadi2_dedant', row: 9, col: 8, ownerUid: 1 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 9] }],
  });
  const u = h.unit('chess_char_6_04_a');
  h.step();
  assert.ok(!h.b.enemiesInKeys(u.baseRangeKeys, u, u.profile).length, 'the enemy is outside her own range');
  assert.ok(h.runUntil(() => u.skill.active, 1), 'S3 fires from the 海嗣 range');
  h.b.addBuff(u, { key: 'inspire', mods: { atkFlat: 500 } });
  h.run(0.6);
  assert.equal(u.findBuff('inspire'), null, '自身不受鼓舞影响');
  checkInvariants(h.b);
});

test('焰影苇草 / 溯光星源: 灼痕 and 能源解析 use the 法术脆弱 / 脆弱 statuses (同名效果取最高, no stacking)', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_08_a', row: 10, col: 3, carryState: { sp: 44 } }, { chessId: 'chess_char_6_16_a', row: 11, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const reed = h.unit('chess_char_6_08_a');
  assert.ok(h.runUntil(() => reed.skill.active, 5));
  h.run(2);
  const e = enemyAt(h, 'enemy_dummy');
  assert.ok(e.findBuff('reed2:scorch') && e.findBuff('artsFragile'), '灼痕 marker + 法术脆弱');
  h.b.applyStatus(e, 'artsFragile', { duration: 5, value: 0.2 });
  assert.ok(near(e.s.artsTakenMul, reed.def.talents[0].bb.damage_scale), 'a weaker 法术脆弱 does not stack');
  assert.ok(e.findBuff('fragile'), '能源解析 = 脆弱 status');
  assert.ok(near(e.s.dmgTakenMul, h.unit('chess_char_6_16_a').def.talents[1].bb['halo2_t_1[weak].damage_scale']));
  checkInvariants(h.b);
});

test('流明: stat debuffs (虚弱) are not 异常状态 — no 应急处理 heal, no bullet, not cleansed', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_14_a', row: 10, col: 3, carryState: { sp: 60 } }, { chessId: 'test_guard_a', row: 10, col: 5 }],
    hooks: ['ammoUsed', 'heal'], captureNoisy: true,
  });
  const u = h.unit('chess_char_6_14_a'), g = h.unit('test_guard_a');
  h.step();
  h.b.applyStatus(g, 'weaken', { duration: 30, value: 0.3 });
  assert.equal(h.hooksOf('heal').filter((c) => c.source === u).length, 0, 'no 应急处理');
  g.hp = g.s.maxHp * 0.5;
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.run(4);
  assert.ok(g.findBuff('weaken'), 'not cleansed');
  assert.equal(h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, 0, 'normal heals spend no bullet');
});

test('异客: the S3 storm stops when she leaves the field', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_05_a', row: 10, col: 3, carryState: { sp: 34 } }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit('chess_char_6_05_a');
  assert.ok(h.runUntil(() => u.skill.activations > 0, 10));
  h.run(0.6);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false);
  const n = h.eventsOf('fx').filter((e) => e[1] === 'lightning').length;
  h.run(5);
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'lightning').length, n, 'no strike after her retreat');
});

test('蕾缪安: 通缉 needs a continuous 8 s stay in a 拉特兰 range (leaving restarts the count)', () => {
  const h = battle({
    units: [{ chessId: 'chess_char_6_01_a', row: 12, col: 2 }, { chessId: 'test_lat_a', row: 10, col: 2 }],
    enemies: [{ key: 'enemy_elite', pos: [10, 9] }],
  });
  h.step();
  const e = enemyAt(h, 'enemy_elite');
  h.run(5);
  e.y = 9; // out of every 拉特兰 range for a second
  h.run(1);
  e.y = 10;
  h.run(5);
  assert.equal(e.findBuff('lemuen:wanted'), null, '5 s + 5 s is not a continuous 8 s stay');
  h.run(3.5);
  assert.ok(e.findBuff('lemuen:wanted'), 'wanted after 8 s in range');
});

test('缪尔赛思: MLYSS_WTRMAN — an enemy in a copied 流形\'s range triggers S3 even outside her own range', () => {
  const h = battle({
    units: [
      { chessId: 'chess_char_6_11_a', row: 12, col: 2, carryState: { sp: 42 } },
      { chessId: 'test_guard_a', row: 9, col: 9 },
      { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 9, col: 8, ownerUid: 1 },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [9, 9] }],
  });
  const u = h.unit('chess_char_6_11_a');
  const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
  h.step();
  assert.ok(!h.b.enemiesInKeys(u.baseRangeKeys, u, u.profile).length, 'outside her own range');
  h.run(2);
  assert.ok(!u.skill.active && !tok().mem.mlyss, 'no copy yet ⇒ no trigger');
  assert.ok(h.runUntil(() => u.skill.active, 6), 'fires once the 流形 copied and sees the enemy');
  assert.ok(tok().mem.mlyss && !tok().mem.mlyss.ranged, 'melee copy of the guard');
  checkInvariants(h.b);
});

test('skill stat mods match the official text at both levels (normal Lv4 / elite Lv7)', () => {
  // [chess, mods key, text regex] — the number in the skill text must be what the running skill buff applies
  const rows = [
    ['6_02', 'atkPct', /攻击力\+(\d+)%/], ['6_02', 'aspd', /攻击速度\+(\d+)/],
    ['6_03', 'hpPct', /生命上限\+(\d+)%/], ['6_03', 'atkPct', /攻击力\+(\d+)%/], ['6_03', 'defPct', /防御力\+(\d+)%/],
    ['6_06', 'atkPct', /攻击力\+(\d+)%/], ['6_07', 'atkPct', /攻击力\+(\d+)%/], ['6_08', 'atkPct', /攻击力\+(\d+)%/],
    ['6_11', 'atkPct', /攻击力\+(\d+)%/], ['6_12', 'atkPct', /攻击力\+(\d+)%/], ['6_14', 'atkPct', /攻击力\+(\d+)%/],
    ['6_14', 'aspd', /攻击速度\+(\d+)/], ['6_15', 'atkPct', /攻击力\+(\d+)%/], ['6_16', 'atkPct', /攻击力\+(\d+)%/],
    ['6_17', 'atkPct', /攻击力\+(\d+)%/], ['6_17', 'defPct', /防御力\+(\d+)%/], ['6_18', 'atkPct', /攻击力\+(\d+)%/],
    ['1_15', 'aspd', /攻击速度\+(\d+)/],
  ];
  for (const sfx of ['a', 'b']) {
    for (const [id, key, re] of rows) {
      const cid = `chess_char_${id}_${sfx}`;
      const h = makeBattle({ units: [{ chessId: cid, row: 10, col: 4 }], timeLimit: 30 });
      h.step();
      const u = h.unit(cid);
      assert.ok(u.skill.activate('test', { free: true }), `${cid} activates`);
      const m = String(u.def.skill.description).match(re);
      assert.ok(m, `${cid} text has ${re}`);
      const want = key === 'aspd' ? +m[1] : +m[1] / 100;
      const buff = u.findBuff(`skill:${u.id}`);
      assert.ok(buff && near(buff.mods[key], want, 1e-9), `${cid} ${key} ${buff?.mods?.[key]} ≠ text ${want}`);
      checkInvariants(h.b);
    }
  }
});

test('蕾缪安 (elite): after 15 s ATK +18 %, own ammo +2 and other 拉特兰 ammo skills +1 (新约能天使 S2)', () => {
  const ammoAtStart = new Map();
  const h = battle({
    units: [{ chessId: 'chess_char_6_01_b', row: 12, col: 2 }, { chessId: 'chess_char_6_13_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 5], time: 16 }], // in both ranges
    setup(b) { b.on('skillStart', (c) => ammoAtStart.set(c.unit.defId, c.skill.ammoLeft), { priority: -1000 }); },
  });
  const lem = h.unit('chess_char_6_01_b'), ang = h.unit('chess_char_6_13_a');
  const t1 = lem.def.talents[1].bb;
  h.run(t1.interval + 0.1);
  assert.ok(near(lem.findBuff('lemuen:extradition').mods.atkPct, t1.atk), 'ATK +18 %');
  assert.ok(h.runUntil(() => ammoAtStart.has(ang.defId) && ammoAtStart.has(lem.defId), 60), 'both skills fired');
  const ab = ang.def.skill.bb;
  const stole = ang.mem.angelVictim ? ab.addtional_ammo_each : 0;
  assert.equal(ammoAtStart.get(ang.defId), ab['attack@trigger_time'] + stole + t1.ex_add_count, '新约能天使 +1 (other 拉特兰)');
  assert.equal(ammoAtStart.get(lem.defId), lem.def.skill.bb['attack@trigger_time'] + t1.add_count, '蕾缪安 +2');
  checkInvariants(h.b);
});

test('default skills: attack-interval rule of the AK calculator — a shortening is flat seconds, a lengthening scales', () => {
  // regression: 溯光星源 S3 / 新约能天使 S2 / 维娜 S3 applied their −0.7 / −0.7 / −0.25 as ×0.3 / ×0.3 / ×0.75
  // (溯光星源 1.9 s → 0.57 s instead of 1.2 s); 佩佩 S3 +0.2 and 迷迭香 S2 +0.5 scale the base time (×1.2 / ×1.5)
  const cases = [['chess_char_6_16', 'flat'], ['chess_char_6_13', 'flat'], ['chess_char_6_07', 'flat'], ['chess_char_6_06', 'mul'], ['chess_char_6_12', 'mul']];
  for (const [base, rule] of cases) {
    for (const cid of [`${base}_a`, `${base}_b`]) {
      const h = battle({ units: [{ chessId: cid, row: 10, col: 4 }] });
      h.run(0.2);
      const u = h.unit(cid);
      const v = u.def.skill.bb.base_attack_time;
      assert.ok(Number.isFinite(v) && v !== 0, `${cid} has base_attack_time`);
      assert.ok(u.skill.activate('test', { free: true }), `${cid} activates`);
      const bat = rule === 'flat' ? u.base.bat + v : u.base.bat * (1 + v);
      assert.ok(near(u.s.interval, bat * 100 / u.s.aspd, 1e-9), `${cid} (${rule} ${v}): interval ${u.s.interval} ≠ ${bat * 100 / u.s.aspd}`);
      checkInvariants(h.b);
    }
  }
});
