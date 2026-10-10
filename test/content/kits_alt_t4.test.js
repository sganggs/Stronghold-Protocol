// Tier-4 operator loadouts (DESIGN §16): every selectable NON-default skill of every visible tier-4 chess has a
// hand-authored spec in its kit file (server/sim/content/kits/ops/, `skills[skillId]`), proven here by its signature effect for
// the normal (Lv4) and the elite (Lv7) chess; non-default modules (and 'none') change what their text says. Numbers
// are read back from the data blackboards (the SELECTED skill's `bb`), real battles through the harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { loadoutOptions } from '../../shared/protocol.js';
import { skillSpecSource } from '../../server/sim/content/index.js';
import { kitCoverage } from '../../tools/kit-coverage.mjs';
import { canTargetAlly } from '../../server/sim/targeting.js';
import { aggregateMods } from '../../server/sim/buffs.js';

const ds = getDefaultSource();
const C = ds.raw.chess;
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e8, speed: 0, ...o });
const gold = (id) => id.replace(/_a$/, '_b');
/** Both chess of a base id: [normal, elite]. */
const pair = (base) => [base, gold(base)];
/** Resolved def of a chess for a loadout. */
const D = (id, skillIndex, moduleId) => ds.getChess(id, { skillIndex, ...(moduleId ? { moduleId } : {}) });
/** Harness unit entry with a loadout. */
const U = (chessId, row, col, skillIndex = null, moduleId = null, extra = {}) =>
  ({ chessId, row, col, ...(skillIndex != null ? { skillIndex } : {}), ...(moduleId ? { moduleId } : {}), ...extra });
const dmgBy = (h, u, pred = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && pred(c));
const tagged = (tag) => (c) => (c.dmg?.tags || []).includes(tag);
const T4 = Object.values(C).filter((c) => c.tier === 4 && !c.isGolden && c.visible).map((c) => c.chessId).sort();

function battle(units, o = {}) {
  return makeBattle({
    defs: { enemies: { enemy_dummy: dummy(), ...(o.enemies || {}) } },
    units, timeLimit: o.timeLimit ?? 300, hooks: o.hooks ?? ['damaged', 'attack', 'skillStart', 'skillEnd', 'heal', 'death', 'deploy', 'dodge', 'spGain'],
    captureNoisy: true, seed: o.seed ?? 3, flags: o.flags, ...(o.extra || {}),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// coverage + smoke

test('tier4 loadouts: every selectable skill of every visible chess is hand-authored (normal + elite)', () => {
  const rep = kitCoverage({ tier: 4 });
  assert.equal(rep.summary.chess, 22);
  assert.equal(rep.summary.covered, rep.summary.skills, JSON.stringify(rep.chess.flatMap((r) => r.skills.filter((s) => !s.covered).map((s) => `${r.name} S${s.index + 1}`))));
  for (const base of T4) {
    const { skills } = loadoutOptions(C[base], C[gold(base)]);
    for (const i of skills) {
      if (C[base].skills.find((s) => s.index === i).isDefault) continue;
      for (const id of pair(base)) assert.equal(skillSpecSource(D(id, i)), 'skills', `${id} S${i + 1}`);
    }
  }
});

test('tier4 loadouts: every chess × selectable skill × module fights a mixed wave without content errors', () => {
  const runs = [];
  for (const base of T4) {
    const { skills } = loadoutOptions(C[base], C[gold(base)]);
    const mods = [null, 'none', ...(C[gold(base)].modules || []).filter((m) => !m.isDefault).map((m) => m.uniEquipId)];
    for (const i of skills) {
      runs.push([base, i, null]);
      for (const m of mods) runs.push([gold(base), i, m]);
    }
  }
  for (const [id, i, m] of runs) {
    const h = makeBattle({
      defs: { enemies: {
        e_walk: enemyRec({ key: 'e_walk', hp: 6000, atk: 300, def: 100, res: 20, speed: 1, bat: 1.5 }),
        e_fly: enemyRec({ key: 'e_fly', hp: 3000, atk: 150, motion: 'FLY', speed: 1, range: 1.5 }),
        e_elite: enemyRec({ key: 'e_elite', rank: 'ELITE', hp: 9000, atk: 400, def: 200, speed: 0.8, bat: 2 }),
      } },
      units: [U(id, 9, 6, i, m), U('chess_char_1_02_a', 10, 6), U('chess_char_1_01_a', 11, 5), U('chess_char_4_17_a', 12, 7)],
      enemies: [{ key: 'e_walk', route: 0, count: 6, interval: 3 }, { key: 'e_walk', route: 1, count: 4, interval: 4 },
        { key: 'e_fly', route: 2, count: 3, interval: 5 }, { key: 'e_elite', route: 0, time: 8 }],
      timeLimit: 70, seed: 5, hooks: [],
    });
    const u = h.unit(id);
    assert.equal(u.def.loadout?.skillIndex ?? u.def.skill.index, i, `${id} S${i + 1} selected`);
    u.skill.gainSp?.(1000, 'test');
    h.runToEnd(80);
    assert.equal(h.b.errorCount, 0, `${id} S${i + 1} ${m}: ${JSON.stringify(h.b.errors.map((e) => e.label + ' ' + e.message))}`);
    checkInvariants(h.b);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 信仰搅拌机

test('信仰搅拌机 S1 铳骑主考官 (自动触发 ⇒ DEFAULT: hurt SP, fires with the next attack); next attack = 3 hits × atk_scale; reloads one adjacent 拉特兰 ammo skill', () => {
  for (const id of pair('chess_char_4_01_a')) {
    const bb = D(id, 0).skill.bb;
    const h = battle([U(id, 9, 5, 0, gold(id) === id ? 'none' : null), U('chess_char_1_01_a', 10, 4)], {
      enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 50, bat: 1 }) },
    });
    h.step();
    const u = h.unit(id), ins = h.unit('chess_char_1_01_a');
    assert.equal(u.skill.id, 'skchr_rmixer_1');
    assert.equal(u.skill.rule, 'DEFAULT', 'an AUTO skill takes no 技能策略 (the 重装 row is for MANUAL skills)');
    assert.ok(ins.skill.activate('test', { free: true }));
    u.skill.gainSp(1000);
    const ammo0 = ins.skill.ammoLeft;
    h.hooksOf('attack').length = 0;
    h.spawn('enemy_hitter', { pos: [9, 5] });
    assert.ok(h.runUntil(() => h.hooksOf('skillStart').some((c) => c.unit === u), 10), `${id} S1 cast with the next attack`);
    assert.ok(h.runUntil(() => h.hooksOf('skillEnd').some((c) => c.unit === u), 10), 'the armed attack happened');
    const skillHits = dmgBy(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.equal(skillHits.length, 3, `${id}: triple hit`);
    assert.equal(new Set(skillHits.map((c) => c.dmg.attackId)).size, 1, 'one attack');
    for (const c of skillHits) approx(c.amount, u.s.atk * bb.atk_scale, 1e-6, `${id} hit`);
    const shots = h.hooksOf('attack').filter((c) => c.attacker === ins).length;
    assert.equal(ins.skill.ammoLeft, ammo0 - shots + bb.charge, `${id} reloaded ${bb.charge} bullet(s)`);
    checkInvariants(h.b);
  }
});

test('信仰搅拌机 S1 reloads the latest-deployed 拉特兰 ammo user around him, not the nearest (PRTS 备注; GitHub #325, PR #329)', () => {
  for (const redeploy of [false, true]) {
    // 隐现 ×2: the orthogonal neighbour deployed first, the diagonal one after it (both on his 8 surrounding tiles)
    const h = battle([U('chess_char_4_01_a', 10, 5, 0), U('chess_char_1_01_a', 10, 4, null, null, { uid: 2 }), U('chess_char_1_01_a', 9, 4, null, null, { uid: 3 })]);
    h.step();
    const u = h.unit('chess_char_4_01_a'), near = h.unit(2), far = h.unit(3);
    if (redeploy) { // a redeploy is the latest deployment
      h.b.retreat(near, { reason: 'raid' });
      assert.ok(h.b._deploy(near));
    }
    const latest = redeploy ? near : far, other = redeploy ? far : near;
    assert.ok(latest.deploySeq > other.deploySeq);
    for (const a of [near, far]) { assert.ok(a.skill.activate('test', { free: true })); a.skill.ammoLeft = 5; }
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(u.skill.activate('test', { free: true }));
    h.b.forceAttack(u, [e]);
    h.run(0.5);
    const reloads = h.eventsOf('fx').filter((x) => x[1] === 'reload');
    assert.ok(reloads.length > 0, 'a reload happened');
    assert.ok(reloads.every((x) => x[4].id === latest.id), `${redeploy ? 'after a redeploy, the redeployed one' : 'the later-deployed diagonal one'} is reloaded`);
    checkInvariants(h.b);
  }
});

test('信仰搅拌机 S2 八臂电锯侠: ammo skill, ATK/DEF up; a lethal hit is negated for ammo_cost bullets; with fewer it is still negated, every bullet goes and the skill ends (PRTS 备注)', () => {
  for (const id of pair('chess_char_4_01_a')) {
    const bb = D(id, 1).skill.bb;
    for (const enough of [true, false]) {
      const h = battle([U(id, 9, 5, 1)], { enemies: { enemy_killer: dummy({ key: 'enemy_killer', atk: 1e6, bat: 2 }) } });
      h.step();
      const u = h.unit(id);
      assert.ok(u.skill.activate('test', { free: true }));
      assert.equal(u.skill.kind, 'ammo');
      assert.equal(u.skill.ammoLeft, bb['attack@trigger_time']);
      approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-6, 'ATK');
      approx(u.s.def, u.base.def * (1 + bb.def), 1e-6, 'DEF');
      if (!enough) u.skill.ammoLeft = bb.ammo_cost - 1;
      u.hp = 500;
      const before = u.skill.ammoLeft;
      h.spawn('enemy_killer', { pos: [9, 5] });
      h.runUntil(() => h.hooksOf('damaged').some((c) => c.target === u) || !u.alive, 10);
      if (enough) {
        assert.ok(u.alive, `${id}: lethal hit negated`);
        approx(u.hp, 500, 1e-9, 'HP kept');
        const shots = h.hooksOf('attack').filter((c) => c.attacker === u).length;
        assert.equal(u.skill.ammoLeft, before - bb.ammo_cost - shots, `${bb.ammo_cost} bullets spent`);
      } else {
        // PRTS 备注 "弹药量不足时仍可抵挡致命伤害，此时将消耗所有剩余弹药并退出技能状态" (0.1.0: [ASSUMED] no guard)
        assert.ok(u.alive, `${id}: fewer than ${bb.ammo_cost} bullets still block the lethal hit`);
        approx(u.hp, 500, 1e-9, 'HP kept');
        assert.equal(u.skill.ammoLeft, 0, 'every bullet spent');
        assert.equal(u.skill.active, false, 'the skill ends');
      }
    }
  }
});

test('信仰搅拌机 modules: SPT-Y 老朋友 = range +1 and no reveal; SPT-X (default) reveals', () => {
  const size = (m) => {
    const h = battle([U('chess_char_4_01_b', 10, 5, null, m)]);
    h.step();
    const u = h.unit('chess_char_4_01_b');
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.b.applyStatus(e, 'stealth', { duration: 30 });
    h.run(0.5);
    return { n: u.rangeKeys.length, reveal: !!e.s.flags.reveal };
  };
  const def = size(null), y = size('uniequip_003_rmixer'), none = size('none');
  assert.ok(y.n > def.n, `range ${def.n} → ${y.n}`);
  assert.equal(def.n, none.n);
  assert.deepEqual([def.reveal, y.reveal, none.reveal], [true, false, false]);
});

// ---------------------------------------------------------------------------------------------------------------
// 莫斯提马

test('莫斯提马 S1 攻击力强化·γ型: ATK +45 %/+60 %; talent 2 slow is NOT tripled (S3 only)', () => {
  for (const id of pair('chess_char_4_02_a')) {
    const bb = D(id, 0).skill.bb, t1 = D(id, 0).talents[1].bb;
    const h = battle([U(id, 10, 3, 0)]);
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [10, 4] });
    assert.ok(u.skill.activate('test', { free: true }));
    h.run(0.5);
    approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-6, `${id} ATK`);
    approx(e.findBuff(`mostma:slow:${u.id}`).mods.moveMul, 1 + t1.move_speed, 1e-9, 'plain talent slow');
    approx(u.skill.timeLeft, D(id, 0).skill.duration - 0.5, 0.05);
  }
});

test('莫斯提马 S2 荒时之锁: every enemy in range stunned until the skill ends, atk_scale arts per second', () => {
  for (const id of pair('chess_char_4_02_a')) {
    const sk = D(id, 1).skill, bb = sk.bb;
    const h = battle([U(id, 10, 3, 1)]);
    h.step();
    const u = h.unit(id);
    const es = [h.spawn('enemy_dummy', { pos: [10, 4] }), h.spawn('enemy_dummy', { pos: [9, 5] }), h.spawn('enemy_dummy', { pos: [11, 5] })];
    const far = h.spawn('enemy_dummy', { pos: [10, 9] });
    assert.ok(u.skill.activate('test', { free: true }));
    h.run(0.2);
    for (const e of es) assert.ok(e.s.flags.stun, `${id}: enemy in range stunned`);
    assert.ok(!far.s.flags.stun, 'enemy out of range not stunned');
    h.runUntil(() => !u.skill.active, 20);
    const lock = dmgBy(h, u, tagged('timeLock'));
    for (const e of es) {
      const mine = lock.filter((c) => c.target === e);
      assert.equal(mine.length, Math.floor(sk.duration + 1e-6), `${id}: one tick per second (${sk.duration} s)`);
      approx(mine[0].amount, u.s.atk * bb.atk_scale, 1e-6, 'arts tick');
    }
    assert.ok(!lock.some((c) => c.target === far));
    h.run(0.2);
    for (const e of es) assert.ok(!e.s.flags.stun, 'stun ends with the skill');
    checkInvariants(h.b);
  }
});

test('莫斯提马 module SPC-X 资深万国信使定制斗篷: 攻击范围扩大 (default SPC-Y and none do not)', () => {
  const n = (m) => { const h = battle([U('chess_char_4_02_b', 10, 3, null, m)]); h.step(); return h.unit('chess_char_4_02_b').rangeKeys.length; };
  assert.ok(n('uniequip_003_mostma') > n(null));
  assert.equal(n(null), n('none'));
});

test('莫斯提马 SPC-X: the range becomes the module grid (only the centre tile [0,3] added, no rangeExtend); S3 keeps its own range', () => {
  const id = 'chess_char_4_02_b';
  const modGrid = C[id].modules.find((m) => m.uniEquipId === 'uniequip_003_mostma').talentChanges.find((t) => t.rangeGrid).rangeGrid;
  const rel = (u) => u.rangeKeys.map((k) => `${Math.floor(k / 21) - u.tileR},${(k % 21) - u.tileC}`).sort();
  const run = (m) => {
    const h = battle([U(id, 10, 3, null, m)]);
    h.step();
    const u = h.unit(id);
    const base = rel(u), initial = u.baseRangeKeys.length, ext = u.s.rangeExtend;
    assert.ok(u.skill.activate('test', { free: true }));
    h.step();
    return { base, initial, ext, skill: rel(u) };
  };
  const x = run('uniequip_003_mostma'), def = run(null);
  assert.deepEqual(x.base, modGrid.map(([r, c]) => `${r},${c}`).sort(), 'own range = module grid');
  assert.equal(x.base.length, C[id].rangeGrid.length + 1, 'exactly one tile more');
  assert.ok(x.base.includes('0,3') && !x.base.includes('1,3') && !x.base.includes('-1,3'));
  assert.equal(x.initial, x.base.length, 'DEFAULT trigger range follows');
  assert.equal(x.ext, 0, 'no forward extension');
  assert.deepEqual(x.skill, def.skill, 'S3 range unchanged by the module');
  assert.equal(x.skill.length, D(id, 2).skill.rangeGrid.length);
});

// ---------------------------------------------------------------------------------------------------------------
// 伊内丝

test('伊内丝 S1 淬影突袭: next attack +2 DP and a 3 s non-stacking arts DoT of 40 %/55 % ATK per second', () => {
  for (const id of pair('chess_char_4_04_a')) {
    const bb = D(id, 0).skill.bb;
    const h = battle([U(id, 10, 4, 0)], { flags: { dpPerSec: 0 } });
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    h.run(1.5); // first damage: 影织 binds + steals ATK (her ATK is stable afterwards)
    const dp0 = h.b.getPlayer('p1').dp;
    assert.ok(u.skill.activate('test', { free: true }));
    assert.ok(h.runUntil(() => !u.skill.active, 10));
    h.run(0.4); // the bolt lands
    assert.equal(h.b.getPlayer('p1').dp, dp0 + bb.cost, `${id}: +${bb.cost} DP`);
    assert.ok(e.findBuff(`ines:bleed:${u.id}`), 'DoT applied');
    h.run(bb.bleed_duration + 0.5);
    const dot = dmgBy(h, u, tagged('dot'));
    assert.equal(dot.length, bb.bleed_duration, `${id}: ${bb.bleed_duration} ticks`);
    for (const c of dot) approx(c.amount, u.s.atk * bb.bleed_atk_scale, 1e-6, 'arts per second');
    assert.ok(e.buffs.filter((b) => b.key === `ines:bleed:${u.id}`).length <= 1, '不叠加');
  }
});

test('伊内丝 S3 独影归途: first deployment leaves a sentry and retreats; the redeploy recalls it through ≤ 4/5 enemies; ATK up; +1 DP per damage', () => {
  for (const id of pair('chess_char_4_04_a')) {
    const sk = D(id, 2).skill, bb = sk.bb;
    const h = battle([U(id, 10, 5, 2)], { flags: { dpInit: 99, dpPerSec: 0 } });
    const u = h.unit(id);
    h.b.start();
    assert.equal(u.skill.kind, 'duration');
    assert.equal(u.skill.active, false, 'first deployment does not activate the skill');
    assert.equal(u.skill.activations, 0);
    assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === u).length, 0, 'placing a sentry emits no skillStart');
    assert.equal(u.skill.timeLeft, 0, 'first deployment places the sentry without a full effect window');
    assert.equal(u.findBuff('ines:s3'), null);
    const near = [];
    for (let i = 0; i < 3; i++) near.push(h.spawn('enemy_dummy', { pos: [10, 6] }), h.spawn('enemy_dummy', { pos: [10, 4] }));
    const far = h.spawn('enemy_dummy', { pos: [10, 8] });
    h.step(3);
    const left = h.hooksOf('death').find((c) => c.unit === u);
    assert.ok(left && left.reason === 'retreat', `${id}: leaves right after the first deployment`);
    assert.ok(h.runUntil(() => u.alive && u.deployed, 2), 'redeploy timer refreshed: back at once');
    const buff = u.findBuff('ines:s3');
    assert.ok(buff, 'ATK effect on the redeploy');
    approx(buff.mods.atkPct, bb.atk, 1e-9);
    approx(u.skill.timeLeft, sk.duration, 0.1);
    assert.equal(u.skill.active, true);
    assert.equal(u.skill.activations, 1);
    assert.equal(h.hooksOf('skillStart').filter((c) => c.unit === u).length, 1, 'the redeployment starts the skill once');
    assert.equal(u.skill.ready, false);
    assert.equal(h.snapshot().units.find((t) => t[0] === u.id)[6], sk.duration);
    const recall = dmgBy(h, u, tagged('sentryRecall'));
    assert.equal(recall.length, bb.max_target, `${id}: recall hits ≤ ${bb.max_target} of 6`);
    assert.ok(recall.every((c) => near.includes(c.target)) && !recall.some((c) => c.target === far));
    for (const c of recall) approx(c.amount, u.base.atk * (1 + bb.atk) * bb.atk_scale, 1e-6, 'recall damage');
    assert.equal(u.mem.sentry, null, 'sentry recalled');
    const dpAt = h.b.getPlayer('p1').dp, tAt = h.b.time;
    h.run(3);
    const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.t >= tAt - 1e-9 && c.amount > 0 && c.target.side === 'enemy').length;
    assert.ok(hits > 0);
    assert.equal(h.b.getPlayer('p1').dp, dpAt + hits * bb.cost, 'one DP per damage while the passive lasts');
    assert.equal(h.hooksOf('death').filter((c) => c.unit === u).length, 1, 'only the first deployment leaves');
    h.run(sk.duration);
    assert.equal(u.skill.active, false);
    assert.equal(u.skill.ready, false);
    assert.equal(u.findBuff('ines:s3'), null);
    const dpEnd = h.b.getPlayer('p1').dp;
    h.run(2);
    assert.equal(h.b.getPlayer('p1').dp, dpEnd, 'no skill DP after the actual window ends');
    assert.equal(h.hooksOf('death').filter((c) => c.unit === u).length, 1, 'stays deployed after the window');
    assert.deepEqual(h.hooksOf('skillEnd').filter((c) => c.unit === u).map((c) => c.reason), ['duration']);
    checkInvariants(h.b);
  }
});

test('伊内丝 module none: the first retreat keeps its full redeploy time (AGE-Y shortens it by 35 %)', () => {
  const wait = (m) => {
    const h = battle([U('chess_char_4_04_b', 10, 5, null, m)]);
    h.step();
    const u = h.unit('chess_char_4_04_b');
    h.b.retreat(u);
    return u.respawnAt - u.deathAt;
  };
  approx(wait(null), wait('none') * (1 + C.chess_char_4_04_b.modules[0].traitOverride.bb.respawn_time), 1e-6);
});

// ---------------------------------------------------------------------------------------------------------------
// 寒芒克洛丝 / 风笛

test('寒芒克洛丝 S1 无痕: ATK up, every attack is a double shot, 迷彩 (ranged enemies cannot target her); no S2 hit counting', () => {
  for (const id of pair('chess_char_4_06_a')) {
    const bb = D(id, 0).skill.bb;
    const h = battle([U(id, 10, 4, 0)]);
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(u.skill.kind, 'duration');
    approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-6, `${id} ATK`);
    assert.ok(u.s.flags.camou && !u.s.flags.stealth, '迷彩 (not 隐匿)');
    assert.equal(canTargetAlly(e, u, true), false, 'not a ranged target');
    h.run(3);
    const shots = dmgBy(h, u, (c) => c.dmg.isAttack);
    const per = new Map();
    for (const c of shots) per.set(c.dmg.attackId, (per.get(c.dmg.attackId) ?? 0) + 1);
    assert.ok(per.size >= 2 && [...per.values()].every((n) => n === 2), `${id}: 2 shots per attack`);
    assert.equal(u.mem.kroosHits ?? 0, 0, 'S2 hit counter untouched');
    h.runUntil(() => !u.skill.active, 30);
    assert.ok(!u.s.flags.camou);
  }
});

test('风笛 S1 迅捷打击·γ型 (ATK/ASPD) and S3 闭膛连发 (BAT +0.7 s, block +1, ATK/DEF up, triple hits)', () => {
  for (const id of pair('chess_char_4_07_a')) {
    const b1 = D(id, 0).skill.bb, b3 = D(id, 2).skill.bb;
    let h = battle([U(id, 10, 4, 0)]);
    h.step();
    let u = h.unit(id);
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.s.atk, u.base.atk * (1 + b1.atk), 1e-6, 'S1 ATK');
    assert.equal(u.s.aspd, u.base.aspd + b1.attack_speed);
    h = battle([U(id, 10, 4, 2)]);
    h.step();
    u = h.unit(id);
    h.spawn('enemy_dummy', { pos: [10, 5] });
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.s.atk, u.base.atk * (1 + b3.atk), 1e-6, 'S3 ATK');
    approx(u.s.def, u.base.def * (1 + b3.def), 1e-6, 'S3 DEF');
    assert.equal(u.s.blockCnt, u.base.blockCnt + b3.block_cnt);
    approx(u.s.interval, (u.base.bat + b3.base_attack_time) * 100 / u.s.aspd, 1e-6, 'BAT +0.7 s');
    h.run(4);
    const per = new Map();
    for (const c of dmgBy(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill)) per.set(`${c.dmg.attackId}:${c.target.id}`, (per.get(`${c.dmg.attackId}:${c.target.id}`) ?? 0) + 1);
    assert.ok(per.size >= 2 && [...per.values()].every((n) => n === 3), `${id}: three hits per target per attack`);
  }
});

test('风笛 module CHG-Y “棍棒与口袋”: attacks on enemies below 40 % HP use 115 % ATK (default / none do not)', () => {
  const minHit = (m, low) => {
    const h = battle([U('chess_char_4_07_b', 10, 4, 0, m)]);
    h.step();
    const u = h.unit('chess_char_4_07_b');
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    if (low) e.hp = e.s.maxHp * 0.3;
    h.run(6);
    const hits = dmgBy(h, u, (c) => c.dmg.isAttack && c.target === e).map((c) => c.amount / u.s.atk);
    assert.ok(hits.length >= 3);
    return Math.min(...hits);
  };
  const tb = C.chess_char_4_07_b.modules.find((m) => m.uniEquipId === 'uniequip_003_bpipe').traitOverride.bb;
  approx(minHit('uniequip_003_bpipe', true), tb.atk_scale, 1e-6, 'low HP ×1.15');
  approx(minHit('uniequip_003_bpipe', false), 1, 1e-6, 'healthy target ×1');
  approx(minHit(null, true), 1, 1e-6, 'default module: no bonus');
});

// ---------------------------------------------------------------------------------------------------------------
// 水月 / 阿罗玛 / 凯瑟琳

test('水月 S1 唤醒: charges; the next attack hits every enemy in range for atk_scale and talent 1 deals ×talent_scale', () => {
  for (const id of pair('chess_char_4_09_a')) {
    const d = D(id, 0), bb = d.skill.bb, t0 = d.talents[0].bb;
    const h = battle([U(id, 10, 4, 0)]);
    h.step();
    const u = h.unit(id);
    assert.equal(u.skill.maxCharges, bb.cnt);
    const es = [h.spawn('enemy_dummy', { pos: [10, 5] }), h.spawn('enemy_dummy', { pos: [9, 5] })];
    assert.ok(u.skill.activate('test', { free: true }));
    assert.ok(h.runUntil(() => !u.skill.active, 10));
    const sk = dmgBy(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.deepEqual(new Set(sk.map((c) => c.target)), new Set(es), `${id}: every enemy in range`);
    for (const c of sk) approx(c.amount, u.s.atk * bb.atk_scale, 1e-6, 'skill hit');
    const tal = dmgBy(h, u, tagged('talent'));
    assert.equal(tal.length, 1);
    approx(tal[0].amount, u.s.atk * t0['attack@mizuki_t_1.atk_scale'] * bb.talent_scale, 1e-6, 'talent ×2');
    h.run(8);
    for (const c of dmgBy(h, u, tagged('talent')).slice(1)) approx(c.amount, u.s.atk * t0['attack@mizuki_t_1.atk_scale'], 1e-6, 'plain talent afterwards');
  }
});

test('水月 S3 镜花水月: wider range, ATK up, talent 1 +2 targets with stun; an attack hitting < 3 enemies costs 15 % max HP', () => {
  for (const id of pair('chess_char_4_09_a')) {
    const bb = D(id, 2).skill.bb;
    for (const n of [1, 3]) {
      const h = battle([U(id, 10, 4, 2)]);
      h.step();
      const u = h.unit(id);
      const base = u.rangeKeys.length;
      const es = [];
      for (let i = 0; i < n; i++) es.push(h.spawn('enemy_dummy', { pos: [10 + (i === 1 ? -1 : i === 2 ? 1 : 0), 5] }));
      assert.ok(u.skill.activate('test', { free: true }));
      assert.ok(u.rangeKeys.length > base, 'range widened');
      approx(u.s.atk, u.base.atk * (1 + bb.atk) * (u.findBuff('mizuki:t2') ? 1 + D(id, 2).talents[1].bb.atk : 1), 1e-6);
      const hp0 = u.hp;
      assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 10));
      const tal = dmgBy(h, u, tagged('talent'));
      assert.equal(tal.length, Math.min(n, 1 + bb['attack@max_target']), `${id}: talent hits ${Math.min(n, 3)}`);
      for (const c of tal) assert.ok(c.target.s.flags.stun, 'talent stun');
      if (n < 3) approx(hp0 - u.hp, u.s.maxHp * bb['attack@hp_ratio'], 1e-6, 'HP loss');
      else assert.equal(u.hp, hp0, 'no loss with ≥ 3 enemies hit');
    }
  }
});

test('水月 module AMB-Y 深蓝之籽: 65 % physical and arts dodge (default AMB-X: 50 % + slow aura)', () => {
  const dodge = (m) => { const h = battle([U('chess_char_4_09_b', 10, 4, null, m)]); h.step(); return h.unit('chess_char_4_09_b').s.dodgePhys; };
  approx(dodge('uniequip_003_mizuki'), 0.65, 1e-9);
  approx(dodge(null), 0.5, 1e-9);
});

test('阿罗玛 S1 强效清洁: charges; next blast atk_scale arts, flying victims take +atk_scale_to_fly', () => {
  for (const id of pair('chess_char_4_10_a')) {
    const bb = D(id, 0).skill.bb;
    const h = battle([U(id, 10, 3, 0, gold(id) === id ? 'none' : null)], { enemies: { enemy_flyer: dummy({ key: 'enemy_flyer', motion: 'FLY' }) } });
    h.step();
    const u = h.unit(id);
    const g = h.spawn('enemy_dummy', { pos: [10, 6] }), f = h.spawn('enemy_flyer', { pos: [10, 6] });
    h.run(4); // the talent's first-hit bonus / levitation are spent
    assert.ok(u.skill.activate('test', { free: true }));
    assert.ok(h.runUntil(() => !u.skill.active, 10));
    h.run(1);
    const sk = dmgBy(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.deepEqual(new Set(sk.map((c) => c.target)), new Set([g, f]));
    for (const c of sk) approx(c.amount, u.s.atk * bb.atk_scale, 1e-6, `${id} blast`);
    const aa = dmgBy(h, u, tagged('antiAir'));
    assert.equal(aa.length, 1);
    assert.equal(aa[0].target, f, 'only the flyer');
    approx(aa[0].amount, u.s.atk * bb.atk_scale_to_fly, 1e-6, 'anti-air bonus');
  }
});

test('凯瑟琳 S1 岁月锻打: passive ATK/DEF up for her and every operator holding a device shield; the hand card is her deploy limit', () => {
  for (const id of pair('chess_char_4_11_a')) {
    const bb = D(id, 0).skill.bb;
    // her device is a placed piece (user playtest #6): facing 4_17 on its right
    const dev = { kind: 'token', tokenId: 'token_10041_cathy_catsld', ownerUid: 1, row: 10, col: 5, dir: 'RIGHT' };
    const h = battle([U(id, 10, 4, 0, null, { uid: 1 }), U('chess_char_4_17_a', 10, 6), U('chess_char_1_01_a', 12, 3), dev]);
    h.run(1);
    const u = h.unit(id), hs = h.unit('chess_char_4_17_a'), ins = h.unit('chess_char_1_01_a');
    assert.equal(u.skill.kind, 'passive');
    approx(u.s.atk, u.base.atk * (1 + bb.s1_atk), 1e-6, `${id} own ATK`);
    approx(u.s.def, u.base.def * (1 + bb.s1_def), 1e-6, 'own DEF');
    for (const a of [hs, ins]) {
      const f = a.findBuff(`cathy:forge:${u.id}`);
      assert.equal(!!f, !!a.findBuff('cathy:shield'), `${a.name}: forge buff iff device shield`);
      if (f) approx(f.mods.atkPct, bb.s1_atk, 1e-9);
    }
    assert.ok(hs.findBuff(`cathy:forge:${u.id}`), 'the shielded blocker gets it');
  }
  // the module changes how many devices she carries (none 3, CRA-X 4); the hand gets the deploy limit (2) either way
  // (PRTS 卫戍协议/帮助 "根据召唤物部署数量上限（非初始持有量），发送等量召唤物至手牌区")
  assert.deepEqual([C.chess_char_4_11_b.talentsBase[0].bb.cnt, C.chess_char_4_11_b.talents[0].bb.cnt], [3, 4]);
  for (const id of pair('chess_char_4_11_a')) assert.equal(ds.raw.tokens.token_10041_cathy_catsld.variants[id].stats.deployLimit, 2, `${id}: deploy limit`);
});

// ---------------------------------------------------------------------------------------------------------------
// 歌蕾蒂娅 / 灵知 / 莱恩哈特

test('歌蕾蒂娅 S1 缺水的大洋裂断: charges; next attack atk_scale (×1.3 vs weight ≤ 3) and pulls the target to her front', () => {
  for (const id of pair('chess_char_4_12_a')) {
    const d = D(id, 0), bb = d.skill.bb, t1 = d.talents[1].bb;
    const h = battle([U(id, 10, 3, 0)]);
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    const x0 = e.x;
    assert.ok(u.skill.activate('test', { free: true }));
    assert.ok(h.runUntil(() => !u.skill.active, 10));
    h.run(0.5);
    const sk = dmgBy(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.equal(sk.length, 1);
    approx(sk[0].amount, u.s.atk * bb.atk_scale * t1.atk_scale, 1e-6, `${id} hit`);
    assert.ok(e.x < x0 - 0.5, `${id}: pulled towards her (${x0} → ${e.x})`);
    assert.ok(h.eventsOf('fx').some((f) => f[1] === 'displace' && f[4]?.keepFacing === true),
      `${id}: S1 pull carries the common facing metadata`);
    // 中力 vs weight 1 (受力等级 0): "必定拉至身前" — to the 急停 radius 0.6708 around her centre (PRTS 推与拉), never past it
    approx(e.x, u.x + 0.6708, 1e-6, `${id}: stops at her front`);
  }
});

test('歌蕾蒂娅 S2 缺水的掌握怒海: BAT +0.5 s, wider range, 2 targets at attack@atk_scale, both pulled to her front', () => {
  for (const id of pair('chess_char_4_12_a')) {
    const d = D(id, 1), bb = d.skill.bb, t1 = d.talents[1].bb;
    const h = battle([U(id, 10, 3, 1)]);
    h.step();
    const u = h.unit(id);
    const es = [h.spawn('enemy_dummy', { pos: [10, 6] }), h.spawn('enemy_dummy', { pos: [11, 6] }), h.spawn('enemy_dummy', { pos: [9, 6] })];
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.s.interval, (u.base.bat + bb.base_attack_time) * 100 / u.s.aspd, 1e-6, 'BAT +0.5 s');
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 10));
    const atk = h.hooksOf('attack').find((c) => c.attacker === u);
    assert.equal(atk.targets.length, bb['attack@max_target'], `${id}: two targets`);
    h.run(0.6);
    const hits = dmgBy(h, u, (c) => c.dmg.isAttack && c.dmg.attackId === dmgBy(h, u)[0].dmg.attackId);
    assert.equal(hits.length, bb['attack@max_target']);
    for (const c of hits) approx(c.amount, u.s.atk * bb['attack@atk_scale'] * t1.atk_scale, 1e-6);
    for (const e of atk.targets) assert.ok(e.x < 6 - 0.4, `pulled (${e.x})`);
    assert.ok(h.eventsOf('fx').some((f) => f[1] === 'displace' && f[4]?.keepFacing === true),
      `${id}: S2 pull carries the common facing metadata`);
  }
});

test('歌蕾蒂娅 module HOK-Y 淡金坠饰: pulling a far enemy (> 2.5 tiles) to herself is one force level stronger', () => {
  // a weight-2 enemy: 中力 (1) − 2 = 受力等级 −1 ⇒ 35 % of the way; +1 level (HOK-Y) ⇒ 0 ⇒ all the way (PRTS 推与拉)
  const moved = (m) => {
    const h = battle([U('chess_char_4_12_b', 10, 3, 0, m)], { enemies: { enemy_heavy: dummy({ key: 'enemy_heavy', mass: 2 }) } });
    h.step();
    const u = h.unit('chess_char_4_12_b');
    const e = h.spawn('enemy_heavy', { pos: [10, 6] });
    assert.ok(u.skill.activate('test', { free: true }));
    h.runUntil(() => !u.skill.active, 10);
    h.run(0.5);
    return 6 - e.x;
  };
  const y = moved('uniequip_003_glady'), x = moved(null);
  assert.ok(y > x + 0.2, `HOK-Y ${y} > HOK-X ${x}`);
  approx(x, moved('none'), 1e-9);
});

test('灵知 S1 高速思考: next attack hits twice for atk_scale arts', () => {
  for (const id of pair('chess_char_4_13_a')) {
    const bb = D(id, 0).skill.bb;
    const h = battle([U(id, 10, 4, 0)]);
    h.step();
    const u = h.unit(id);
    h.spawn('enemy_dummy', { pos: [10, 5] });
    assert.ok(u.skill.activate('test', { free: true }));
    assert.ok(h.runUntil(() => !u.skill.active, 10));
    h.run(0.5);
    const sk = dmgBy(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.equal(sk.length, 2, `${id}: two hits`);
    assert.equal(sk[0].dmg.attackId, sk[1].dmg.attackId);
    for (const c of sk) { assert.equal(c.type, 'arts'); approx(c.amount, u.s.atk * bb.atk_scale, 1e-6); }
  }
});

test('灵知 S3 失温症: ASPD up, 2 targets (unfrozen first), freezes held until the end, then atk_scale arts on the frozen and thaw', () => {
  for (const id of pair('chess_char_4_13_a')) {
    const sk = D(id, 2).skill, bb = sk.bb;
    const h = battle([U(id, 10, 4, 2)]);
    h.step();
    const u = h.unit(id);
    const frozenOne = h.spawn('enemy_dummy', { pos: [10, 5] });
    const others = [h.spawn('enemy_dummy', { pos: [10, 6] }), h.spawn('enemy_dummy', { pos: [9, 5] })];
    h.b.applyStatus(frozenOne, 'freeze', { duration: 1 });
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(u.s.aspd, u.base.aspd + bb.attack_speed);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 5));
    const first = h.hooksOf('attack').find((c) => c.attacker === u);
    assert.equal(first.targets.length, bb.max_target);
    assert.ok(!first.targets.includes(frozenOne), 'unfrozen targets first');
    h.run(2);
    assert.ok(frozenOne.findBuff('freeze'), `${id}: freeze held past its own 1 s`);
    approx(frozenOne.findBuff('freeze').timeLeft, u.skill.timeLeft, 0.1, 'until the skill ends');
    const atkEnd = u.s.atk;
    assert.ok(h.runUntil(() => !u.skill.active, 20));
    const shatter = dmgBy(h, u, tagged('shatter'));
    assert.ok(shatter.some((c) => c.target === frozenOne), 'end burst on the frozen enemy');
    for (const c of shatter) assert.ok(c.amount >= atkEnd * bb.atk_scale - 1e-6, 'atk_scale arts (× fragile)');
    for (const c of shatter) assert.ok(!c.target.findBuff('freeze'), 'thawed');
  }
});

test('灵知 module UMD-Y 一号项目模型: +0.25 SP/s while an elite enemy is in range (default UMD-X: weaken on hit)', () => {
  const rate = (m, rank) => {
    const h = battle([U('chess_char_4_13_b', 10, 4, null, m)], { enemies: { enemy_r: dummy({ key: 'enemy_r', rank }) } });
    h.step();
    h.spawn('enemy_r', { pos: [10, 6] });
    h.run(0.5);
    return h.unit('chess_char_4_13_b').s.spRecovery;
  };
  const tb = C.chess_char_4_13_b.modules.find((m) => m.uniEquipId === 'uniequip_003_gnosis').traitOverride.bb;
  approx(rate('uniequip_003_gnosis', 'ELITE'), 1 + tb.sp_recovery_per_sec, 1e-9);
  approx(rate('uniequip_003_gnosis', 'NORMAL'), 1, 1e-9);
  approx(rate(null, 'ELITE'), 1, 1e-9);
});

test('莱恩哈特 S1 攻击力强化·γ型: ATK up for 30 s; module none: no range bonus', () => {
  for (const id of pair('chess_char_4_14_a')) {
    const d = D(id, 0);
    const h = battle([U(id, 10, 4, 0)]);
    h.step();
    const u = h.unit(id);
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.s.atk, u.base.atk * (1 + d.skill.bb.atk), 1e-6);
    approx(u.skill.timeLeft, d.skill.duration, 1e-6);
  }
  const n = (m) => { const h = battle([U('chess_char_4_14_b', 10, 4, null, m)]); h.step(); return h.unit('chess_char_4_14_b').rangeKeys.length; };
  assert.ok(n(null) > n('none'));
});

// ---------------------------------------------------------------------------------------------------------------
// 缄默德克萨斯 / 星熊 / 泥岩

test('缄默德克萨斯 S1 细雨无声: passive ATK up for its duration; hits silence 5 s/8 s with a fixed arts DoT per second', () => {
  for (const id of pair('chess_char_4_16_a')) {
    const sk = D(id, 0).skill, bb = sk.bb;
    const h = battle([U(id, 10, 4, 0)]);
    h.step();
    const u = h.unit(id);
    assert.equal(u.skill.kind, 'duration');
    assert.equal(u.skill.active, true);
    assert.equal(u.skill.charges, 0);
    approx(u.skill.spec.mods.atkPct, bb.atk + D(id, 0).talents[0].bb.atk, 1e-9, 'skill and 德克萨斯传统 ATK');
    assert.equal(h.snapshot().units.find((t) => t[0] === u.id)[6], sk.duration);
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    h.run(3);
    assert.ok(e.s.flags.silence, 'hit target silenced (失去特殊能力)');
    approx(e.findBuff('silence').timeLeft, bb['attack@silence'], 1.5);
    const dot = dmgBy(h, u, tagged('dot'));
    assert.ok(dot.length >= 2, `a DoT tick every second although she re-hits faster (${dot.length})`);
    for (const c of dot) approx(c.amount, bb['attack@texas2_s_1[dot].dot_damage'], 1e-9, 'fixed arts per second (RES 0)');
    h.run(sk.duration);
    assert.equal(u.skill.active, false, 'ends with the skill duration');
    assert.equal(u.skill.ready, false);
    assert.equal(h.hooksOf('skillEnd').filter((c) => c.unit === u && c.reason === 'duration').length, 1);
    assert.ok(e.s.flags.silence && e.findBuff(`texas2:drizzleDot:${u.id}`), 'applied enemy effects keep their own duration');
    h.run(bb['attack@silence'] + 1);
    assert.ok(!e.s.flags.silence && !e.findBuff(`texas2:drizzleDot:${u.id}`), 'no new silence / DoT after the passive');
  }
});

test('缄默德克萨斯 S2: two copies cut the RES of an enemy around both once (同名效果取最高, DESIGN §20.10)', () => {
  const id = 'chess_char_4_16_a', bb = D(id, 1).skill.bb;
  const h = battle([U(id, 10, 4, 1), U(id, 11, 4, 1)], { enemies: { enemy_res: dummy({ key: 'enemy_res', res: 50 }) } });
  h.step();
  const two = h.b.allyUnits.filter((u) => u.def.id === id);
  assert.equal(two.length, 2);
  const e = h.spawn('enemy_res', { pos: [10, 5] });
  for (const u of two) { h.b.retreat(u); assert.ok(h.b.redeploy(u)); }
  assert.equal(dmgBy(h, two[0], tagged('burst')).length + dmgBy(h, two[1], tagged('burst')).length, 2, 'both bursts hit it');
  assert.equal(e.buffs.filter((b) => String(b.key).startsWith('texas2:resDown')).length, 1, 'one RES cut');
  approx(e.s.res, 50 * (1 + bb.magic_resistance), 1e-6, 'once, not twice');
});

test('缄默德克萨斯 S2 阵雨连绵: deploy burst atk_scale arts + RES down around her; ATK up; attacks become arts double hits', () => {
  for (const id of pair('chess_char_4_16_a')) {
    const sk = D(id, 1).skill, bb = sk.bb;
    const h = battle([U(id, 10, 4, 1)], { enemies: { enemy_res: dummy({ key: 'enemy_res', res: 50 }) } });
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_res', { pos: [10, 5] });
    const far = h.spawn('enemy_res', { pos: [10, 8] });
    h.b.retreat(u);
    assert.ok(h.b.redeploy(u));
    const burst = dmgBy(h, u, tagged('burst'));
    assert.deepEqual(burst.map((c) => c.target), [e], `${id}: only enemies around her`);
    approx(burst[0].amount, u.s.atk * bb.atk_scale * 0.5, 1e-6, 'arts burst vs RES 50');
    approx(e.s.res, 50 * (1 + bb.magic_resistance), 1e-6, 'RES down');
    assert.equal(far.s.res, 50);
    approx(u.skill.spec.mods.atkPct, bb.atk + D(id, 1).talents[0].bb.atk, 1e-9);
    approx(u.skill.timeLeft, sk.duration, 1e-6);
    h.run(2);
    const hits = dmgBy(h, u, (c) => c.dmg.isAttack);
    assert.ok(hits.length >= 2 && hits.every((c) => c.type === 'arts'), 'arts attacks');
    const per = new Map();
    for (const c of hits) per.set(c.dmg.attackId, (per.get(c.dmg.attackId) ?? 0) + 1);
    assert.ok([...per.values()].every((v) => v === 2), 'double hits');
    h.run(sk.duration);
    assert.equal(u.skill.active, false);
    assert.equal(u.skill.ready, false);
    const n0 = dmgBy(h, u, (c) => c.dmg.isAttack).length;
    h.run(3);
    const late = dmgBy(h, u, (c) => c.dmg.isAttack).slice(n0);
    assert.ok(late.length >= 1 && late.every((c) => c.type === 'phys'), 'back to single phys hits after the duration');
  }
});

test('缄默德克萨斯 S1/S2/S3: first kill reopens a full window, including a kill inside the deployment burst', () => {
  for (const id of pair('chess_char_4_16_a')) for (const index of [0, 1, 2]) {
    const life = [];
    const h = battle([U(id, 10, 4, index)], { extra: { setup(b) {
      for (const name of ['skillStart', 'skillEnd']) b.on(name, (c) => life.push([name, c.reason]), { priority: 1000 });
    } } });
    h.b.start();
    const u = h.unit(id), sk = u.skill;
    h.run(2);
    u.hp = u.s.maxHp / 2;
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    h.b.kill(e, u);
    assert.equal(u.mem.texasKilled, true);
    approx(u.hpRatio, 1);
    assert.equal(u.findBuff('texas2:swordplay'), null);
    assert.equal(sk.activations, 2);
    approx(sk.timeLeft, sk.duration);
    assert.equal(sk.charges, 0);
    assert.equal(sk.ready, false);
    assert.deepEqual(h.hooksOf('skillEnd').map((c) => c.reason), ['recast']);
    h.b.kill(h.spawn('enemy_dummy', { pos: [10, 5] }), u);
    assert.equal(sk.activations, 2, 'only first kill recasts');
    h.run(sk.duration + 0.1);
    assert.equal(sk.active, false);
    assert.deepEqual(h.hooksOf('skillEnd').map((c) => c.reason), ['recast', 'duration']);
    assert.deepEqual(h.hooksOf('skillStart').map((c) => c.reason), ['deploy', 'kill']);
    h.b.retreat(u);
    const lifeAt = life.length;
    const weak = h.spawn('enemy_dummy', { pos: [10, 5] });
    weak.hp = 1;
    assert.ok(h.b.redeploy(u, { free: true }));
    if (index === 0) h.b.kill(weak, u); // S1 has no deployment burst
    assert.equal(u.mem.texasKilled, true);
    assert.equal(sk.activations, 4, 'new deployment and first-kill recast, including synchronous burst reentry');
    assert.deepEqual(life.slice(lifeAt), [['skillStart', 'deploy'], ['skillEnd', 'recast'], ['skillStart', 'kill']]);
    assert.equal(u.findBuff('texas2:swordplay'), null);
    approx(sk.timeLeft, sk.duration);
    if (index === 2) {
      const target = h.spawn('enemy_dummy', { pos: [10, 5] });
      h.run(sk.duration + 0.1);
      const waves = new Set(dmgBy(h, u, tagged('swordRain')).filter((c) => c.target === target).map((c) => c.t));
      assert.equal(waves.size, sk.duration, 'reentrant deployment keeps a full set of rain waves');
      const n = dmgBy(h, u, tagged('swordRain')).length;
      h.run(2);
      assert.equal(dmgBy(h, u, tagged('swordRain')).length, n, 'rain stops at skill end');
      assert.ok(target.alive);
    }
    checkInvariants(h.b);
  }
});

test('缄默德克萨斯 module none: no ATK +10 % when alone (EXE-Y default has it)', () => {
  const has = (m) => { const h = battle([U('chess_char_4_16_b', 10, 4, null, m)]); h.run(0.5); return !!h.unit('chess_char_4_16_b').findBuff('texas2:module'); };
  assert.equal(has(null), true);
  assert.equal(has('none'), false);
  assert.equal(has('uniequip_003_texas2'), false);
});

test('星熊 S1 战意 (TAKE_DAMAGE: DEF/ATK up, no thorns) and S3 力之锯 (ATK/DEF up, cuts every enemy in front)', () => {
  for (const id of pair('chess_char_4_17_a')) {
    const b1 = D(id, 0).skill.bb, b3 = D(id, 2).skill.bb;
    let h = battle([U(id, 10, 4, 0)], { enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 300, bat: 1 }) } });
    h.step();
    let u = h.unit(id);
    assert.equal(u.skill.rule, 'TAKE_DAMAGE');
    u.skill.gainSp(1000);
    h.spawn('enemy_hitter', { pos: [10, 4] });
    assert.ok(h.runUntil(() => u.skill.active, 5), `${id}: armed by a hit`);
    approx(u.s.def, u.base.def * (1 + b1.def + (u.findBuff('hsguma:def') ? D(id, 0).talents[1].bb.def : 0)), 1e-6, 'DEF');
    approx(u.s.atk, u.base.atk * (1 + b1.atk), 1e-6, 'ATK');
    h.run(3);
    assert.equal(dmgBy(h, u, tagged('counter')).length, 0, 'thorns belong to S2 only');
    h = battle([U(id, 10, 4, 2)]);
    h.step();
    u = h.unit(id);
    const es = [h.spawn('enemy_dummy', { pos: [10, 5] }), h.spawn('enemy_dummy', { pos: [10, 5] }), h.spawn('enemy_dummy', { pos: [10, 5] })];
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.s.atk, u.base.atk * (1 + b3.atk), 1e-6, 'S3 ATK');
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 5));
    assert.equal(h.hooksOf('attack').find((c) => c.attacker === u).targets.length, es.length, 'all enemies in front');
  }
});

test('星熊 module PRO-X 护身符: DEF +20 % while blocking', () => {
  const def = (m, block) => {
    const h = battle([U('chess_char_4_17_b', 10, 4, null, m)]);
    h.step();
    const u = h.unit('chess_char_4_17_b');
    if (block) h.spawn('enemy_dummy', { pos: [10, 4] });
    h.run(0.5);
    return u.s.def / u.base.def;
  };
  const tb = C.chess_char_4_17_b.modules.find((m) => m.uniEquipId === 'uniequip_003_hsguma').traitOverride.bb;
  approx(def('uniequip_003_hsguma', true) - def('uniequip_003_hsguma', false), tb.def, 1e-9);
  approx(def(null, true), def(null, false), 1e-9);
});

test('泥岩 S1 防御力强化·γ型 (TAKE_DAMAGE) and S3 秽壤的血脉 (闭锁: invulnerable, no attack, blocks nobody — the enemies she held walk on —, slow; then stun, buffs, hits all blocked)', () => {
  for (const id of pair('chess_char_4_18_a')) {
    const b1 = D(id, 0).skill.bb, sk = D(id, 2).skill, b3 = sk.bb;
    let h = battle([U(id, 10, 4, 0)], { enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 300, bat: 1 }) } });
    h.step();
    let u = h.unit(id);
    assert.equal(u.skill.rule, 'TAKE_DAMAGE');
    u.skill.gainSp(1000);
    h.spawn('enemy_hitter', { pos: [10, 4] });
    assert.ok(h.runUntil(() => u.skill.active, 5));
    approx(u.s.def, u.base.def * (1 + b1.def), 1e-6);
    h = battle([U(id, 9, 5, 2)], { enemies: { e_walk: enemyRec({ key: 'e_walk', hp: 1e8, atk: 500, speed: 1, bat: 1 }) } });
    for (let i = 0; i < 3; i++) h.spawn('e_walk', { routeIndex: 0 });
    u = h.unit(id);
    assert.ok(h.runUntil(() => u.blocking.length === 3, 30), 'blocks three walkers');
    const walkers = u.blocking.slice();
    const hp0 = u.hp;
    assert.ok(u.skill.activate('test', { free: true }));
    const t0 = h.b.time;
    h.step();
    // 闭锁 (PRTS 备注 "实际将会进入闭锁状态"; PRTS 异常效果 闭锁 = 强制缴械 + 无敌 + 不可阻挡, 不可阻挡 "无法阻挡/被阻挡，自动解除阻挡")
    assert.ok(u.blocking.length === 0 && walkers.every((e) => e.blockedBy !== u), `${id}: 闭锁 lets go of the enemies she held`);
    assert.ok(walkers.every((e) => e.findBuff(`mudrok:slow:${u.id}`)), 'enemies around slowed');
    const x0 = walkers.map((e) => e.x);
    h.run(1);
    assert.ok(walkers.every((e, i) => e.removed || e.x < x0[i] - 0.05), `${id}: they walk on`);
    h.run(b3.sleep - 2.5);
    assert.equal(u.hp >= hp0 - 1e-6, true, `${id}: no damage while dormant`);
    assert.equal(u.blocking.length, 0, `${id}: blocks nobody while dormant`);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0).length, 0, 'cannot act');
    const near = [0, 1, 2].map(() => h.spawn('enemy_dummy', { pos: [9, 5] }));   // on her tile before she wakes
    h.step();
    assert.equal(u.blocking.length, 0, `${id}: not blocked before she wakes`);
    assert.ok(h.runUntil(() => !!u.findBuff('mudrok:awake'), 2), 'awake');
    h.run(0.2);
    for (const e of near) assert.ok(e.s.flags.stun, 'ground enemies around stunned');
    approx(u.s.atk, u.base.atk * (1 + b3.atk) * (u.findBuff('mudrok:module') ? 1 + (u.def.traitBb.atk ?? 0) : 1), 1e-6, 'ATK');
    approx(u.s.interval, (u.base.bat + b3.base_attack_time) * 100 / u.s.aspd, 1e-6, 'BAT −0.3 s');
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.t > t0), 5));
    assert.equal(h.hooksOf('attack').find((c) => c.attacker === u && c.t > t0).targets.length, 3, 'attacks every blocked enemy');
    assert.ok(h.runUntil(() => u.blocking.length === 3, 4), `${id}: she blocks again once awake (their stun over)`);
    h.runUntil(() => !u.skill.active, sk.duration);
    assert.ok(!u.findBuff('mudrok:awake'));
    checkInvariants(h.b);
  }
});

test('泥岩 module UNY-Y 沃土的愿景: ATK/DEF +8 % with no ally on the 8 tiles around', () => {
  const buffed = (m, near) => {
    const h = battle([U('chess_char_4_18_b', 10, 4, null, m), ...(near ? [U('chess_char_1_01_a', 11, 5)] : [])]);
    h.run(0.5);
    return !!h.unit('chess_char_4_18_b').findBuff('mudrok:module');
  };
  assert.deepEqual([buffed('uniequip_003_mudrok', false), buffed('uniequip_003_mudrok', true), buffed(null, false)], [true, false, false]);
});

// ---------------------------------------------------------------------------------------------------------------
// 焰尾 / 远牙 / 白面鸮 / 银灰

test('焰尾 S1 迅敏直觉: +6 DP and the next physical attack on her is dodged (feeding 前锋剑术)', () => {
  for (const id of pair('chess_char_4_19_a')) {
    const bb = D(id, 0).skill.bb;
    const h = battle([U(id, 10, 4, 0)], { flags: { dpPerSec: 0 }, enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 300, bat: 1 }) } });
    h.step();
    const u = h.unit(id);
    const dp0 = h.b.getPlayer('p1').dp;
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(h.b.getPlayer('p1').dp, dp0 + bb.cost, `${id}: +${bb.cost} DP`);
    assert.ok(u.findBuff('flamtl:evade'));
    h.spawn('enemy_hitter', { pos: [10, 4] });
    assert.ok(h.runUntil(() => h.hooksOf('dodge').some((c) => c.target === u), 5), 'dodged');
    assert.ok(!u.findBuff('flamtl:evade'), 'only the next attack');
    assert.equal(h.hooksOf('damaged').filter((c) => c.target === u && c.source?.side === 'enemy').length, 0, 'no damage from the dodged hit');
    assert.ok(u.mem.riposte || u.mem.riposteNow || dmgBy(h, u, tagged('riposte')).length > 0, '前锋剑术 armed');
  }
});

test('焰尾 S1 迅敏直觉 (AUTO): fires as soon as SP is full — no enemy, no attack needed (like 伺夜 S1; playtest #6 review)', () => {
  for (const id of pair('chess_char_4_19_a')) {
    const h = battle([U(id, 10, 4, 0)], { flags: { dpPerSec: 0 } });
    h.step();
    const u = h.unit(id);
    assert.equal(u.skill.rule, 'SP_FULL');
    const due = h.b.time + (u.skill.spCost - u.skill.sp) / u.s.spRecovery;
    assert.ok(h.runUntil(() => u.skill.activations === 1, 40), `${id}: cast with no enemy on the field`);
    const st = h.hooksOf('skillStart').find((c) => c.unit === u);
    assert.ok(Math.abs(st.t - due) <= 0.05, `${id}: at full SP (${st.t} vs ${due})`);
  }
});

test('焰尾 S2 “红松林”: +11/12 DP; ≤ 6 enemies around: 2 × atk_scale phys + stun; allies around +40 %/45 % phys dodge 10 s', () => {
  for (const id of pair('chess_char_4_19_a')) {
    const bb = D(id, 1).skill.bb;
    const h = battle([U(id, 10, 5, 1), U('chess_char_1_01_a', 10, 4)], { flags: { dpPerSec: 0 } });
    h.step();
    const u = h.unit(id), ally = h.unit('chess_char_1_01_a');
    for (let i = 0; i < 7; i++) h.spawn('enemy_dummy', { pos: [10, 6] });
    const dp0 = h.b.getPlayer('p1').dp;
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(h.b.getPlayer('p1').dp, dp0 + bb.cost);
    const hits = dmgBy(h, u, tagged('redPine'));
    const victims = new Set(hits.map((c) => c.target));
    assert.equal(victims.size, bb.max_target, `${id}: ≤ ${bb.max_target} enemies`);
    assert.equal(hits.length, 2 * bb.max_target, 'two hits each');
    for (const c of hits) approx(c.amount, u.s.atk * bb.atk_scale, 1e-6);
    for (const e of victims) assert.ok(e.s.flags.stun);
    for (const a of [u, ally]) {
      const b = a.findBuff('flamtl:redPine');
      assert.ok(b, `${a.name} dodge buff`);
      approx(b.mods.dodgePhys, bb['flamtl_s_2.prob'], 1e-9);
      approx(b.timeLeft, bb['flamtl_s_2.duration'], 1e-6);
    }
  }
});

test('焰尾 module SOL-X 她们的未来: ATK/DEF +8 % while blocking', () => {
  const on = (m, block) => {
    const h = battle([U('chess_char_4_19_b', 10, 4, null, m)]);
    h.step();
    if (block) h.spawn('enemy_dummy', { pos: [10, 4] });
    h.run(0.5);
    return !!h.unit('chess_char_4_19_b').findBuff('flamtl:module');
  };
  assert.deepEqual([on('uniequip_003_flamtl', true), on('uniequip_003_flamtl', false), on(null, true)], [true, false, false]);
});

test('远牙 S1 迅捷打击·γ型 / S2 同盟支援: taunt −1 with any skill (屏息); S2 reaches enemies blocked anywhere on the field', () => {
  for (const id of pair('chess_char_4_20_a')) {
    const b1 = D(id, 0).skill.bb, b2 = D(id, 1).skill.bb;
    let h = battle([U(id, 12, 3, 0)]);
    h.step();
    let u = h.unit(id);
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.s.atk, u.base.atk * (1 + b1.atk + (u.findBuff('fartth:focus') ? D(id, 0).talents[0].bb.atk : 0)), 1e-6, 'S1 ATK (+ 凝神)');
    assert.equal(u.s.aspd, u.base.aspd + b1.attack_speed);
    assert.equal(u.s.taunt, -1, '屏息');
    h = battle([U(id, 12, 3, 1), U('chess_char_4_17_a', 9, 9)], { enemies: { e_walk: enemyRec({ key: 'e_walk', hp: 1e8, atk: 10, speed: 1, bat: 5 }) } });
    u = h.unit(id);
    h.spawn('e_walk', { routeIndex: 0 });
    const e = h.enemies()[0];
    assert.ok(h.runUntil(() => e.blockedBy && e.blockedBy.defId === 'chess_char_4_17_a', 20), 'blocked by 星熊 far away');
    h.run(2);
    assert.equal(dmgBy(h, u, (c) => c.target === e).length, 0, 'out of her range without S2');
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(u.s.aspd, u.base.aspd + b2.attack_speed);
    assert.equal(u.s.taunt, -1);
    h.run(4);
    assert.ok(dmgBy(h, u, (c) => c.target === e).length > 0, `${id}: S2 hits the blocked enemy`);
    h.runUntil(() => !u.skill.active, 40);
    assert.equal(u.extraRangeKeys, null, 'extra range cleared');
  }
});

test('远牙 S2 同盟支援: an UNBLOCKED enemy on a blocked enemy\'s tile outside her range is never a target', () => {
  for (const id of pair('chess_char_4_20_a')) {
    const h = battle([U(id, 12, 3, 1), U('chess_char_4_17_a', 9, 9)], { enemies: {
      e_walk: enemyRec({ key: 'e_walk', hp: 1e8, atk: 10, def: 800, speed: 1, bat: 5 }),
      e_fly: dummy({ key: 'e_fly', motion: 'FLY', def: 0 }),
    } });
    const u = h.unit(id);
    h.spawn('e_walk', { routeIndex: 0 });
    const e = h.enemies()[0];
    assert.ok(h.runUntil(() => e.blockedBy && e.blockedBy.defId === 'chess_char_4_17_a', 20), 'blocked by 星熊 far away');
    const fly = h.spawn('e_fly', { pos: [Math.round(e.y), Math.round(e.x)] });
    assert.ok(fly.isFlying && !fly.blockedBy, 'setup: unblocked flyer (lower DEF: her lowDef priority would pick it)');
    assert.ok(u.skill.activate('test', { free: true }));
    h.run(4);
    assert.ok(dmgBy(h, u, (c) => c.target === e).length > 0, `${id}: S2 hits the blocked enemy`);
    assert.equal(dmgBy(h, u, (c) => c.target === fly).length, 0, `${id}: not the unblocked flyer on its tile`);
    checkInvariants(h.b);
  }
});

test('远牙 module DEA-Y 支持者来信: +1 SP whenever the attacked enemy survives', () => {
  const gains = (m) => {
    const h = battle([U('chess_char_4_20_b', 10, 3, null, m)]);
    h.step();
    h.spawn('enemy_dummy', { pos: [10, 5] });
    h.run(8);
    return h.hooksOf('spGain').filter((c) => c.reason === 'module').length;
  };
  assert.ok(gains('uniequip_003_fartth') >= 2);
  assert.equal(gains(null), 0);
});

test('远牙 module DEA-Y: the hit that defeats its target gives no SP (未被击倒时 only; `damaged` precedes the kill)', () => {
  const id = 'chess_char_4_20_b';
  const h = battle([U(id, 10, 3, null, 'uniequip_003_fartth')], { enemies: { enemy_weak: dummy({ key: 'enemy_weak', hp: 1 }) } });
  h.step();
  const u = h.unit(id);
  const weak = [h.spawn('enemy_weak', { pos: [10, 5] }), h.spawn('enemy_weak', { pos: [10, 6] })];
  assert.ok(h.runUntil(() => weak.every((e) => !e.alive), 10), 'both one-HP enemies fall');
  assert.ok(dmgBy(h, u, (c) => c.dmg?.isAttack && weak.includes(c.target)).length >= 2, 'killed by her attacks');
  assert.equal(h.hooksOf('spGain').filter((c) => c.unit === u && c.reason === 'module').length, 0, 'no SP for a killing hit');
  checkInvariants(h.b);
});

test('白面鸮 S1 治疗强化·γ型: ATK up while healing; module none: no range bonus', () => {
  for (const id of pair('chess_char_4_21_a')) {
    const d = D(id, 0);
    const h = battle([U(id, 10, 3, 0), U('chess_char_4_17_a', 10, 4)]);
    h.step();
    const u = h.unit(id), hs = h.unit('chess_char_4_17_a');
    hs.hp = hs.s.maxHp * 0.3;
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.active, 5), 'heal skill fires on an injured ally');
    approx(u.s.atk, u.base.atk * (1 + d.skill.bb.atk), 1e-6);
  }
  const n = (m) => { const h = battle([U('chess_char_4_21_b', 10, 3, null, m)]); h.step(); return h.unit('chess_char_4_21_b').rangeKeys.length; };
  assert.ok(n(null) > n('none'));
});

test('银灰 S1 强力击·γ型: every 4th attack deals atk_scale; S2 雪境生存法则: toggled on for good — small range, DEF up, HP regen', () => {
  for (const id of pair('chess_char_4_22_a')) {
    const b1 = D(id, 0).skill.bb, s2 = D(id, 1).skill;
    let h = battle([U(id, 10, 4, 0, gold(id) === id ? 'none' : null)]);
    h.step();
    let u = h.unit(id);
    h.spawn('enemy_dummy', { pos: [10, 5] });
    h.run(12);
    const atks = dmgBy(h, u, (c) => c.dmg.isAttack);
    const sk = atks.filter((c) => c.dmg.isSkill);
    assert.ok(sk.length >= 2, `${id}: S1 fired`);
    for (const c of sk) approx(c.amount, u.s.atk * b1.atk_scale, 1e-6);
    for (const c of atks.filter((x) => !x.dmg.isSkill)) approx(c.amount, u.s.atk, 1e-6);
    const i1 = atks.indexOf(sk[0]), i2 = atks.indexOf(sk[1]);
    assert.equal(i2 - i1, D(id, 0).skill.spCost + 1, 'cost-3 attack SP: every 4th attack');
    h = battle([U(id, 10, 4, 1)]);
    h.step();
    u = h.unit(id);
    const n0 = u.rangeKeys.length;
    h.spawn('enemy_dummy', { pos: [10, 5] });
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.kind, 'toggle');
    assert.equal(u.rangeKeys.length, s2.rangeGrid.length, 'smaller range');
    assert.ok(n0 > u.rangeKeys.length);
    approx(u.s.def, u.base.def * (1 + s2.bb.def), 1e-6);
    approx(u.s.hpRegen, u.s.maxHp * s2.bb.hp_recovery_per_sec_by_max_hp_ratio, 1e-6);
    h.run(60);
    assert.ok(u.skill.active, 'stays on');
  }
});

test('银灰 module none: no 10 % ATK arts rider on attacks (LOR-X default has it)', () => {
  const rider = (m) => {
    const h = battle([U('chess_char_4_22_b', 10, 4, 1, m)]);
    h.step();
    h.spawn('enemy_dummy', { pos: [10, 5] });
    h.run(4);
    return dmgBy(h, h.unit('chess_char_4_22_b'), tagged('module')).length;
  };
  assert.ok(rider(null) > 0);
  assert.equal(rider('none'), 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 百炼嘉维尔 / 卡涅利安 / 魔王 / 华法琳

test('百炼嘉维尔 S1 精准痛击: ATK up, heals herself heal_scale of the damage dealt (× 医学背景); no S3 damage deferral', () => {
  for (const id of pair('chess_char_4_23_a')) {
    const d = D(id, 0), bb = d.skill.bb, t1 = d.talents[1].bb;
    const h = battle([U(id, 10, 4, 0)], { enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 400, bat: 1 }) } });
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [10, 4] });
    assert.ok(h.runUntil(() => e.blockedBy === u, 2));
    assert.ok(u.skill.activate('test', { free: true }));
    u.hp = u.s.maxHp * 0.3;
    const hp0 = u.hp, t0 = h.b.time;
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.t >= t0), 5));
    const dealt = dmgBy(h, u, (c) => c.dmg.isAttack && c.t >= t0).reduce((a, c) => a + c.amount, 0);
    assert.ok(dealt > 0);
    approx(u.hp - hp0, dealt * bb.heal_scale * t1.heal_scale_2, 1e-6, `${id}: self heal`);
    const hit = h.spawn('enemy_hitter', { pos: [10, 4] });
    h.run(2);
    assert.equal(u.mem.gvialDebt ?? 0, 0, 'no S3 deferral');
    assert.ok(hit.alive);
  }
});

test('百炼嘉维尔 S2 链锯强袭: wider range, ATK/DEF up, unblocked enemies it hits are pulled to her front', () => {
  for (const id of pair('chess_char_4_23_a')) {
    const bb = D(id, 1).skill.bb;
    const h = battle([U(id, 10, 4, 1)]);
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.run(0.2);
    assert.equal(dmgBy(h, u).length, 0, 'out of the normal range');
    assert.ok(u.skill.activate('test', { free: true }));
    approx(u.s.atk, u.base.atk * (1 + bb.atk + D(id, 1).talents[0].bb.atk), 1e-6, 'ATK (+ 战地巨斧)');
    assert.ok(h.runUntil(() => dmgBy(h, u).length > 0, 5), `${id}: reaches 2 tiles ahead`);
    assert.ok(e.x < 6 - 0.4, `pulled (${e.x})`);
  }
});

test('百炼嘉维尔 module CEN-Y 好锯多磨: −20 % physical damage taken above 50 % HP', () => {
  const taken = (m, ratio) => {
    const h = battle([U('chess_char_4_23_b', 10, 4, 0, m)], { enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 3000, bat: 1 }) } });
    h.step();
    const u = h.unit('chess_char_4_23_b');
    u.hp = u.s.maxHp * ratio;
    h.spawn('enemy_hitter', { pos: [10, 4] });
    h.runUntil(() => h.hooksOf('damaged').some((c) => c.target === u && c.amount > 0), 5);
    return h.hooksOf('damaged').find((c) => c.target === u && c.amount > 0).amount;
  };
  const tb = C.chess_char_4_23_b.modules.find((m) => m.uniEquipId === 'uniequip_003_gvial2').traitOverride.bb;
  approx(taken('uniequip_003_gvial2', 0.9) / taken('uniequip_003_gvial2', 0.4), 1 - tb.damage_resistance, 1e-6, 'reduced above half HP');
  approx(taken(null, 0.9), taken(null, 0.4), 1e-6, 'default CEN-X: no reduction');
});

test('卡涅利安 S1 沙暴守卫: SEARCH; ATK/DEF up; charged keeps the trait guard; 生命之餐 heals 40 %/80 %', () => {
  for (const id of pair('chess_char_4_24_a')) {
    const d = D(id, 0), bb = d.skill.bb, t0 = d.talents[0].bb;
    for (const charged of [false, true]) {
      const h = battle([U(id, 10, 4, 0, gold(id) === id ? 'none' : null)]);
      h.step();
      const u = h.unit(id);
      assert.equal(u.skill.rule, 'SEARCH');
      u.hp = u.s.maxHp * 0.1;
      u.skill.addCharge(charged ? 2 : 1);
      assert.ok(u.skill.activate('test'));
      assert.equal(!!u.findBuff('billro:s1guard'), charged, `${id}: guard kept iff charged`);
      const guard = charged ? u.profile.guardDef : 0;
      approx(u.s.def, u.base.def * (1 + bb.def + guard), 1e-6, 'DEF');
      approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-6, 'ATK');
      approx(u.hp, u.s.maxHp * (0.1 + (charged ? t0['billro_t_1[enhance].heal_scale'] : t0.heal_scale)), 1e-6, '生命之餐');
      h.runUntil(() => !u.skill.active, 30);
      assert.ok(!u.findBuff('billro:s1guard'));
    }
  }
});

test('卡涅利安 S3 食噬之印: wider range, ATK ramps to +atk over the skill; charged hits mark (+20 %/mark, ≤ 5) until it ends', () => {
  for (const id of pair('chess_char_4_24_a')) {
    const sk = D(id, 2).skill, bb = sk.bb;
    const h = battle([U(id, 10, 4, 2, gold(id) === id ? 'none' : null)]);
    h.step();
    const u = h.unit(id);
    const n0 = u.rangeKeys.length;
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    u.skill.addCharge(2);
    assert.ok(u.skill.activate('test'));
    u.skill.charges = 0; // (the spare charge would re-cast right after the end)
    u.skill.sp = 0;
    assert.ok(u.rangeKeys.length > n0);
    h.run(sk.duration / 2);
    approx(u.findBuff('billro:s3atk').mods.atkPct, bb.atk * 0.5, 0.02, `${id}: half-way ramp`);
    const m = e.findBuff('billro:mark');
    assert.ok(m && m.stacks === 5 && m.source === u, `${id}: marks capped at 5 (${m?.stacks})`);
    const hits = dmgBy(h, u, (c) => c.dmg.isAttack && c.target === e);
    const last = hits[hits.length - 1];
    approx(last.amount / (u.s.atk), 1 + bb['attack@damage_scale'] * 5, 0.05, '+100 % with 5 marks');
    h.runUntil(() => !u.skill.active, sk.duration);
    assert.ok(!e.findBuff('billro:mark'), 'marks end with the skill');
    assert.ok(!u.findBuff('billro:s3atk'));
  }
});

test('卡涅利安 module PLX-Y 乡音: +3 % damage per enemy in range (≤ 5); PLX-X keeps part of the guard during any skill', () => {
  const ratio = (m) => {
    const h = battle([U('chess_char_4_24_b', 10, 4, 1, m)]);
    h.step();
    const u = h.unit('chess_char_4_24_b');
    for (let i = 0; i < 3; i++) h.spawn('enemy_dummy', { pos: [10, 5] });
    u.skill.addCharge(1);
    assert.ok(u.skill.activate('test'));
    h.runUntil(() => dmgBy(h, u, (c) => c.dmg.isAttack).length > 0, 5);
    const c = dmgBy(h, u, (c) => c.dmg.isAttack)[0];
    return { r: c.amount / u.s.atk, keep: !!u.findBuff('billro:keep') };
  };
  const mb = C.chess_char_4_24_b.modules.find((m) => m.uniEquipId === 'uniequip_003_billro').talentChanges[0].bb;
  const y = ratio('uniequip_003_billro'), x = ratio(null), none = ratio('none');
  approx(y.r, 1 + mb.damage_scale * 3, 1e-6, 'three enemies');
  approx(none.r, 1, 1e-6);
  assert.deepEqual([x.keep, y.keep, none.keep], [true, false, false]);
  const s1keep = (charges) => { const h = battle([U('chess_char_4_24_b', 10, 4, 0)]); h.step(); const u = h.unit('chess_char_4_24_b'); u.skill.addCharge(charges); u.skill.activate('test'); return !!u.findBuff('billro:keep'); };
  assert.equal(s1keep(1), true, 'uncharged S1 keeps the PLX-X part');
  assert.equal(s1keep(2), false, 'charged S1 keeps the whole guard instead');
});

test('魔王 S1 往昔萦绕身旁: SP_FULL toggle — trait ratio raised for good, motes come back after talent_cool_down', () => {
  for (const id of pair('chess_char_4_25_a')) {
    const bb = D(id, 0).skill.bb;
    const h = battle([U(id, 10, 4, 0), U('chess_char_4_17_a', 10, 5)]);
    h.step();
    const u = h.unit(id), hs = h.unit('chess_char_4_17_a');
    assert.equal(u.skill.rule, 'SP_FULL');
    u.skill.gainSp(1000);
    h.step();
    assert.ok(u.skill.active && u.skill.kind === 'toggle');
    assert.equal(u.profile.auraRatio, bb['attack@atk_to_hp_recovery_ratio']);
    hs.hp = hs.s.maxHp * 0.5;
    h.run(0.5);
    const t = Math.max(...u.mem.motes.filter((x) => Number.isFinite(x)));
    assert.ok(Number.isFinite(t), 'a mote touched the operator');
    assert.ok(t - h.b.time <= bb.talent_cool_down + 1e-6, `${id}: faster mote respawn`);
    h.run(40);
    assert.ok(u.skill.active, 'duration unlimited');
  }
});

test('魔王 S2 明日渺远不及: 6 motes that hit enemies within 2 tiles (true damage + bind), not operators; 鼓舞 ATK to allies in range', () => {
  for (const id of pair('chess_char_4_25_a')) {
    const bb = D(id, 1).skill.bb;
    const h = battle([U(id, 10, 4, 1), U('chess_char_4_17_a', 10, 5)]);
    h.step();
    const u = h.unit(id), hs = h.unit('chess_char_4_17_a');
    const es = [h.spawn('enemy_dummy', { pos: [10, 6] }), h.spawn('enemy_dummy', { pos: [11, 5] })];
    assert.ok(u.skill.activate('test', { free: true }));
    assert.equal(u.mem.motes.length, D(id, 1).talents[0].bb.cnt + 3, '上限+3');
    h.run(1);
    const hits = dmgBy(h, u, tagged('mote'));
    assert.ok(es.every((e) => hits.some((c) => c.target === e)), `${id}: both enemies hit`);
    for (const c of hits) { assert.equal(c.type, 'true'); approx(c.amount, u.s.atk * bb.atk_scale, 1e-6); }
    for (const e of es) assert.ok(e.s.flags.bind, 'bound');
    assert.ok(!hs.findBuff(`cetsyr:mote:${u.id}`), 'motes no longer touch operators');
    const insp = hs.findBuff('inspire');
    assert.ok(insp, '鼓舞');
    approx(insp.data.val, u.s.atk * bb['attack@atk'], 1e-6);
    // 鼓舞 is added on top of the target's ATK multipliers: an ATK +100 % buff does not double it
    h.b.addBuff(hs, { key: 'test:atkUp', mods: { atkPct: 1 } });
    h.step();
    const { add, mul } = aggregateMods(hs.buffs.filter((x) => x.key !== 'inspire'));
    const own = (hs.base.atk + (add.atkFlat ?? 0)) * (1 + (add.atkPct ?? 0)) * (mul.atkMul ?? 1);
    approx(hs.s.atk, own + u.s.atk * bb['attack@atk'], 1e-6, `${id}: final ATK = own ATK + 鼓舞`);
    h.b.removeBuff(hs, 'test:atkUp');
    h.runUntil(() => !u.skill.active, 40);
    assert.equal(u.mem.motes.length, D(id, 1).talents[0].bb.cnt, 'cap back to normal');
  }
});

test('魔王 鼓舞: strongest source wins (never summed), a bard never receives it (自身不受鼓舞影响); S3 HP 鼓舞 on top of HP%', () => {
  const [na, el] = pair('chess_char_4_25_a');
  const h = battle([U(na, 10, 4, 1), U(el, 10, 5, 1), U('chess_char_4_17_a', 11, 4)]);
  h.step();
  const a = h.unit(na), b = h.unit(el), hs = h.unit('chess_char_4_17_a');
  assert.ok(a.skill.activate('test', { free: true }) && b.skill.activate('test', { free: true }));
  h.run(0.5);
  assert.ok(!a.findBuff('inspire') && !b.findBuff('inspire'), 'bards get no 鼓舞 from each other');
  const inRangeOfBoth = h.b.alliesInGrid(a).includes(hs) && h.b.alliesInGrid(b).includes(hs);
  assert.ok(inRangeOfBoth, 'setup: 星熊 inside both ranges');
  const va = a.s.atk * D(na, 1).skill.bb['attack@atk'], vb = b.s.atk * D(el, 1).skill.bb['attack@atk'];
  assert.equal(hs.buffs.filter((x) => x.key === 'inspire' || x.key.startsWith('cetsyr:inspire')).length, 1, 'one 鼓舞 buff');
  approx(hs.findBuff('inspire').data.val, Math.max(va, vb), 1e-6, 'the stronger one');
  // S3 (default): max-HP 鼓舞 is not scaled by the target's HP% buffs
  const h3 = battle([U(el, 10, 4), U('chess_char_4_17_a', 10, 5)]);
  h3.step();
  const m = h3.unit(el), t = h3.unit('chess_char_4_17_a');
  h3.b.addBuff(t, { key: 'test:hpUp', mods: { hpPct: 0.5 } });
  assert.ok(m.skill.activate('test', { free: true }));
  h3.run(0.3);
  const { add, mul } = aggregateMods(t.buffs.filter((x) => x.key !== 'inspire:hp'));
  approx(t.s.maxHp, (t.base.maxHp + (add.hpFlat ?? 0)) * (1 + (add.hpPct ?? 0)) * (mul.hpMul ?? 1) + m.s.maxHp * D(el).skill.bb.max_hp, 1e-6, 'max HP + 鼓舞');
  checkInvariants(h.b);
});

test('华法琳 S2 不稳定血浆: she and one random ally in range: ATK up, 3 % max HP lost per second for 15 s; no S1 bandage', () => {
  for (const id of pair('chess_char_4_26_a')) {
    const bb = D(id, 1).skill.bb;
    const h = battle([U(id, 10, 3, 1), U('chess_char_4_17_a', 10, 4)]);
    h.step();
    const u = h.unit(id), hs = h.unit('chess_char_4_17_a');
    hs.hp = hs.s.maxHp * 0.4;
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.activations > 0, 5), 'fires on an injured ally in range');
    for (const a of [u, hs]) {
      const b = a.findBuff('bldsk:plasma');
      assert.ok(b, `${a.name}: plasma`);
      approx(b.mods.atkPct, bb.atk, 1e-9);
    }
    h.run(3.05);
    const loss = h.hooksOf('damaged').filter((c) => c.target === u && (c.dmg?.tags || []).includes('plasma'));
    assert.equal(loss.length, 3, `${id}: one loss per second`);
    for (const c of loss) approx(c.amount, u.s.maxHp * bb.hp_ratio, 1e-6);
    assert.equal(u.mem.bandage ?? null, null, 'S1 logic not installed');
  }
});

test('module none on single-module elites removes the module effect (寒芒克洛丝 / 阿罗玛 / 魔王 / 华法琳)', () => {
  const unit = (id, m, extra = []) => { const h = battle([U(id, 10, 3, null, m), ...extra]); h.run(0.5); return { h, u: h.unit(id) }; };
  // 寒芒克洛丝 MAR-X: 攻击空中单位时攻击力提升至110%
  assert.equal(unit('chess_char_4_06_b', null).u.profile.flyScale, C.chess_char_4_06_b.trait.bb.atk_scale);
  assert.equal(unit('chess_char_4_06_b', 'none').u.profile.flyScale, 1);
  // 阿罗玛 BLA-X: farther targets take more damage
  const blast = (m) => {
    const { h, u } = unit('chess_char_4_10_b', m);
    const e = h.spawn('enemy_dummy', { pos: [10, 7] });
    h.run(6);
    const hits = dmgBy(h, u, (c) => c.dmg.isAttack && c.target === e).map((c) => c.amount / u.s.atk);
    return Math.min(...hits);
  };
  assert.ok(blast(null) > blast('none') + 0.05, 'distance bonus only with the module');
  approx(blast('none'), 1, 1e-6);
  // 魔王 BAR-X: ATK +8 % with ≥ 2 other operators in range
  const ops = [U('chess_char_4_17_a', 10, 4), U('chess_char_1_01_a', 11, 3)];
  assert.ok(unit('chess_char_4_25_b', null, ops).u.findBuff('cetsyr:module'));
  assert.ok(!unit('chess_char_4_25_b', 'none', ops).u.findBuff('cetsyr:module'));
  // 华法琳 PHY-X: heals on allies below 50 % HP +15 %
  const heal = (m) => {
    const { h, u } = unit('chess_char_4_26_b', m, [U('chess_char_4_17_a', 10, 4)]);
    const hs = h.unit('chess_char_4_17_a');
    hs.hp = hs.s.maxHp * 0.2;
    u.skill.charges = 0; u.skill.sp = 0;
    const n0 = h.hooksOf('heal').length;
    h.runUntil(() => h.hooksOf('heal').slice(n0).some((c) => c.source === u && c.target === hs), 5);
    return h.hooksOf('heal').slice(n0).find((c) => c.source === u && c.target === hs).amount / u.s.atk;
  };
  approx(heal(null) / heal('none'), C.chess_char_4_26_b.trait.bb.heal_scale, 1e-6);
});
