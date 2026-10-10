// Tier-4 operator kits (server/sim/content/kits/ops/chess_char_4_*.js): one signature test per chess (+ elite checks), real battles
// through the harness. Numbers are read back from the data blackboards so the tests follow data changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { TIER_KITS } from '../../server/sim/content/kits/index.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';

const kits = TIER_KITS[3];

const ds = getDefaultSource();
const D = (id) => ds.getChess(id);
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e8, speed: 0, ...o });
const withTags = (rec, tags) => ({ ...rec, tags });
const noisy = (h, name) => h.hooksOf(name);
const dmgBy = (h, u, pred = () => true) => noisy(h, 'damaged').filter((c) => c.source === u && pred(c));
const T4 = [];
for (let i = 1; i <= 26; i++) T4.push(`chess_char_4_${String(i).padStart(2, '0')}_a`);

test('tier4: every tier-4 chess has a hand-authored kit', () => {
  for (const id of T4) assert.equal(typeof kits[id], 'function', id);
  assert.equal(Object.keys(kits).length, 26);
});

test('tier4: all 52 kits (normal + elite) fight a mixed wave without content errors', () => {
  for (const id of T4.flatMap((a) => [a, a.replace(/_a$/, '_b')])) {
    const h = makeBattle({
      defs: { enemies: {
        e_walk: enemyRec({ key: 'e_walk', hp: 6000, atk: 300, def: 100, res: 20, speed: 1, bat: 1.5 }),
        e_fly: enemyRec({ key: 'e_fly', hp: 3000, atk: 150, motion: 'FLY', speed: 1, range: 1.5 }),
      } },
      units: [{ chessId: id, row: 9, col: 6 }, { chessId: 'chess_char_1_02_a', row: 10, col: 6 }, { chessId: 'chess_char_1_01_a', row: 11, col: 5 }],
      enemies: [{ key: 'e_walk', route: 0, count: 6, interval: 3 }, { key: 'e_walk', route: 1, count: 4, interval: 4 }, { key: 'e_fly', route: 2, count: 3, interval: 5 }],
      timeLimit: 70, seed: 5, hooks: [],
    });
    h.runToEnd(80);
    assert.equal(h.b.errorCount, 0, `${id}: ${JSON.stringify(h.b.errors.map((e) => e.label + ' ' + e.message))}`);
    checkInvariants(h.b);
  }
});

// ---------------------------------------------------------------------------------------------------------------

test('信仰搅拌机 S3: stops attacking, counters only when hit, 30 ammo; +HP/ATK/DEF; idle shield; DEF stacks', () => {
  const id = 'chess_char_4_01_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({
    defs: { enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 400, bat: 1 }) } },
    units: [{ chessId: id, row: 9, col: 5 }], timeLimit: 300, hooks: ['ammoUsed', 'attack', 'damaged'], captureNoisy: true,
  });
  const u = h.unit(id);
  h.run(t1.interval + 0.3);
  const sh = u.findBuff('rmixer:shield');
  assert.ok(sh, 'idle shield after 8 s');
  approx(sh.shield, u.s.maxHp * t1.shield);
  h.spawn('enemy_hitter', { pos: [9, 5] });
  assert.ok(h.runUntil(() => u.skill.active, 60), 'S3 fired');
  approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-6, 'ATK');
  approx(u.s.maxHp, u.base.maxHp * (1 + bb.max_hp), 1e-6, 'HP');
  const t0s = h.b.time;
  h.runUntil(() => !u.skill.active, 120);
  const tEnd = h.b.time - h.TICK;
  const mine = noisy(h, 'attack').filter((c) => c.attacker === u && c.t >= t0s);
  const during = mine.filter((c) => c.isSkill).length;
  assert.equal(mine.filter((c) => !c.isSkill && c.t < tEnd - 1e-9).length, 0, 'no active attack while the skill runs');
  assert.equal(h.hooksOf('ammoUsed').length, bb['attack@trigger_time'], '30 counters then the skill ends');
  assert.equal(during, bb['attack@trigger_time'], 'every shot during the skill was a counter');
  // talent 1: stacks of DEF +30 / ASPD +3 (≤ 3)
  const st = u.findBuff('rmixer:t1');
  assert.ok(st && st.stacks === t0.max_stack_cnt, 'DEF stacks capped');
  approx(u.s.def, u.base.def + t0.def * t0.max_stack_cnt, 1e-6, 'DEF flat stacks');
  checkInvariants(h.b);
});

test('信仰搅拌机 S3 start reloads other 拉特兰 operators (Lv4 +2 / elite +3)', () => {
  for (const id of ['chess_char_4_01_a', 'chess_char_4_01_b']) {
    const h = makeBattle({ units: [{ chessId: id, row: 9, col: 5 }, { chessId: 'chess_char_1_01_a', row: 10, col: 4 }], timeLimit: 60, hooks: [] });
    h.step();
    const ins = h.unit('chess_char_1_01_a'), mix = h.unit(id);
    assert.ok(ins.skill.activate('test', { free: true }));
    const before = ins.skill.ammoLeft;
    assert.ok(mix.skill.activate('test', { free: true }));
    assert.equal(ins.skill.ammoLeft, before + D(id).skill.bb.ammo);
  }
});

test('信仰搅拌机 elite module: reveals stealthed enemies in range', () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'chess_char_4_01_b', row: 9, col: 5 }], timeLimit: 60, hooks: [] });
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [9, 6] });
  h.b.applyStatus(e, 'stealth', { duration: 30 });
  h.run(0.5);
  assert.ok(e.s.flags.reveal);
});

test('莫斯提马 S3: ripple hits every enemy in range, ATK +90 %, knock-back; talents: SP aura (casters), slow ×3 during S3', () => {
  const id = 'chess_char_4_02_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_4_14_a', row: 12, col: 3 }], timeLimit: 120, hooks: ['damaged'], captureNoisy: true,
  });
  h.run(0.3);
  const u = h.unit(id), leo = h.unit('chess_char_4_14_a');
  approx(u.s.spRecovery, 1 + t0.sp_recovery_per_sec, 1e-9, 'caster SP aura (self)');
  approx(leo.s.spRecovery, 1 + t0.sp_recovery_per_sec, 1e-9, 'caster SP aura (other caster)');
  const es = [h.spawn('enemy_dummy', { pos: [10, 4] }), h.spawn('enemy_dummy', { pos: [9, 5] }), h.spawn('enemy_dummy', { pos: [11, 5] })];
  h.run(0.3);
  approx(es[0].findBuff(`mostma:slow:${u.id}`).mods.moveMul, 1 + t1.move_speed, 1e-9, 'slow');
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-6);
  h.run(0.3);
  const slowBuff = es[0].findBuff(`mostma:slow:${u.id}`);
  approx(slowBuff.mods.moveMul, 1 + t1.move_speed * bb.talent_scale, 1e-9, 'slow ×3');
  assert.equal(slowBuff.status, 'slow', 'carries the slow status so the client draws its icon');
  const x0 = es.map((e) => e.x);
  const n0 = dmgBy(h, u).length;
  h.run(u.s.interval + 0.1);
  const hits = dmgBy(h, u).slice(n0);
  assert.ok(es.every((e) => hits.some((c) => c.target === e)), 'all three enemies hit by one ripple');
  approx(hits[0].amount, u.s.atk, 1e-6, 'full damage (res 0)');
  assert.ok(es.some((e, i) => e.x > x0[i] + 0.2), 'knocked back');
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'displace' && f[4]?.keepFacing === true),
    'Mostima S3 inherits the common push facing rule');
  checkInvariants(h.b);
});

test('耶拉 S2: two drones ramp independently on two targets, ATK up; 低眉 +16 % with ground tiles; cold procs', () => {
  const id = 'chess_char_4_03_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, tr = D(id).traitBb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 120, hooks: ['damaged', 'statusApplied'], captureNoisy: true, seed: 11 });
  h.step();
  const u = h.unit(id);
  approx(u.findBuff('kjera:t1').mods.atkPct, t0['kjera_t_1[high].atk'], 1e-9, 'open ground in range');
  const a = h.spawn('enemy_dummy', { pos: [10, 4] }), b = h.spawn('enemy_dummy', { pos: [10, 5] });
  assert.ok(h.runUntil(() => u.skill.active, 60));
  approx(u.s.atk, u.base.atk * (1 + t0['kjera_t_1[high].atk'] + bb.atk), 1e-6);
  const n0 = dmgBy(h, u).length;
  h.run(8);
  const hits = dmgBy(h, u).slice(n0);
  const onA = hits.filter((c) => c.target === a).map((c) => c.amount), onB = hits.filter((c) => c.target === b).map((c) => c.amount);
  assert.ok(onA.length >= 3 && onB.length >= 3, 'both locked targets attacked');
  const atk = u.s.atk;
  approx(onA[0], atk * tr.init_atk_scale, 1e-6, 'ramp start');
  approx(onA[1], atk * (tr.init_atk_scale + tr.delta_atk_scale), 1e-6, 'ramp +15 %');
  approx(onB[1], atk * (tr.init_atk_scale + tr.delta_atk_scale), 1e-6, 'second drone ramps on its own');
  h.run(15);
  assert.ok(noisy(h, 'statusApplied').some((c) => c.source === u && c.status === 'cold' && c.duration === bb['attack@cold']), 'cold proc');
  checkInvariants(h.b);
});

test('伊内丝 S2: stealth, ATK +60 %, +1 DP per attack, steals ASPD (restored at the end); 影织 bind + ATK steal; 影哨 sentry', () => {
  const id = 'chess_char_4_04_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy({ atk: 500 }) } }, flags: { dpPerSec: 0 },
    units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 200, hooks: ['attack', 'statusApplied'], captureNoisy: true,
  });
  h.step();
  const u = h.unit(id);
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  h.runUntil(() => u.stats.attacks >= 1, 5);
  h.run(0.3);
  assert.ok(noisy(h, 'statusApplied').some((c) => c.target === e && c.status === 'bind' && c.duration === t0.duration), 'bind 5 s');
  approx(e.s.atk, e.base.atk - t0.steal_atk, 1e-9, 'enemy ATK stolen');
  assert.equal(u.findBuff('ines:atkGain').mods.atkFlat, t0.steal_atk);
  assert.ok(e.findBuff(`ines:sentry:${u.id}`)?.flags?.reveal, 'reveal aura');
  approx(e.findBuff(`ines:sentry:${u.id}`).mods.moveMul, 1 + t1.move_speed, 1e-9);
  assert.ok(h.runUntil(() => u.skill.active, 60));
  assert.ok(u.s.flags.stealth, 'stealth');
  const dp0 = h.b.players[0].dp, a0 = u.stats.attacks;
  h.runUntil(() => !u.skill.active, 30);
  const attacks = u.stats.attacks - a0;
  assert.ok(attacks >= 3);
  approx(h.b.players[0].dp - dp0, attacks * bb.cost, 1e-9, '+1 DP per attack');
  assert.equal(e.findBuff(`ines:aspd:${u.id}`), null, 'stolen ASPD returned');
  assert.equal(u.findBuff('ines:aspdGain'), null);
  // mid-skill steal magnitude
  u.skill.activate('test', { free: true });
  h.runUntil(() => u.stats.attacks >= a0 + attacks + 3, 10);
  h.run(0.3);
  const stolen = u.findBuff('ines:aspdGain').mods.aspd;
  assert.ok(stolen >= 3 * bb['attack@steal_atk_speed'] - 1e-9 && stolen <= bb['attack@steal_atk_speed_max']);
  approx(e.findBuff(`ines:aspd:${u.id}`).mods.aspd, -stolen, 1e-9);
  // leaving: stolen ATK returned, a sentry keeps the aura
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.alive, false);
  approx(e.s.atk, e.base.atk, 1e-9, 'ATK returned when Ines leaves');
  h.run(1);
  assert.ok(e.findBuff(`ines:sentry:${u.id}`), 'sentry aura persists');
  checkInvariants(h.b);
});

test('伊内丝 elite module: first redeploy 35 % faster', () => {
  const id = 'chess_char_4_04_b', tb = D(id).traitBb;
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 200, hooks: [] });
  h.step();
  const u = h.unit(id);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  approx(u.respawnAt - u.deathAt, u.base.respawnTime * (1 + tb.respawn_time), 1e-9);
  h.runUntil(() => u.alive, 60);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  approx(u.respawnAt - u.deathAt, u.base.respawnTime, 1e-9, 'only the first one');
});

test('蜜蜡 S2: obelisk on a melee tile in range, 200 % ATK arts + 1 s stun on appearance, expires; regen talent only while the skill is off', () => {
  const id = 'chess_char_4_05_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 9, col: 5 }], timeLimit: 200, hooks: ['damaged', 'statusApplied'], captureNoisy: true });
  h.run(0.2);
  const u = h.unit(id);
  approx(u.s.hpRegen, u.s.maxHp * t0.hp_recovery_per_sec_by_max_hp_ratio + u.base.hpRecoveryPerSec, 1e-6, 'regen when idle');
  const e = h.spawn('enemy_dummy', { pos: [9, 7] });
  assert.ok(h.runUntil(() => u.skill.active, 60));
  const ob = h.b.allyUnits.find((x) => x.defId === 'token_10011_beewax_oblisk' && x.alive);
  assert.ok(ob, 'obelisk summoned');
  assert.ok(h.b.grid.canStand(ob.tileR, ob.tileC), 'melee tile');
  assert.ok(u.rangeKeys.includes(ob.tileR * 21 + ob.tileC), 'inside her range');
  const burst = dmgBy(h, u, (c) => c.dmg?.tags?.includes('burst'));
  assert.equal(burst.length, 1);
  approx(burst[0].amount, u.s.atk * bb.atk_scale, 1e-6);
  assert.ok(noisy(h, 'statusApplied').some((c) => c.target === e && c.status === 'stun' && c.duration === bb.stun));
  assert.equal(u.findBuff('beewax:regen'), null, 'no regen during the skill');
  const tokDur = h.b.data.getToken('token_10011_beewax_oblisk', u.defId).talents[0].bb.duration;
  h.run(tokDur + 0.2);
  assert.equal(ob.alive, false, 'obelisk expired');
  checkInvariants(h.b);
});

test('寒芒克洛丝 S2: 2-shot, 4-shot after 40 hits; 中的 crits ×1.5 + 0.2 s stun', () => {
  const id = 'chess_char_4_06_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    timeLimit: 200, hooks: ['damaged', 'statusApplied'], captureNoisy: true, seed: 3 });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 60));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-9, 'flat BAT reduction');
  const n0 = dmgBy(h, u).length;
  h.runUntil(() => !u.skill.active, 40);
  const hits = dmgBy(h, u).slice(n0);
  const groups = new Map();
  for (const c of hits) groups.set(c.t, (groups.get(c.t) ?? 0) + 1);
  const sizes = [...groups.values()];
  assert.equal(sizes[0], 2, 'double shot');
  assert.ok(sizes.includes(4), 'quad shot after 40 hits');
  assert.equal(sizes.indexOf(4), bb['attack@max_stack_count'] / 2, 'switches exactly after 40 hits');
  const amounts = hits.map((c) => c.amount).sort((a, b) => a - b);
  approx(amounts[amounts.length - 1] / amounts[0], t0.atk_scale, 1e-6, 'crit ×1.5');
  assert.ok(noisy(h, 'statusApplied').some((c) => c.source === u && c.status === 'stun' && c.duration === t0.stun));
});

test('风笛 S2: next attack 145 % twice; 精密填弹 extra target ×1.3; 军事传统 +6 SP to 先锋', () => {
  const id = 'chess_char_4_07_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: id, row: 9, col: 5 }, { chessId: 'chess_char_4_19_a', row: 11, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }, { key: 'enemy_dummy', pos: [9, 6] }], timeLimit: 200,
    hooks: ['damaged', 'attack', 'skillStart'], captureNoisy: true, seed: 2,
  });
  h.step();
  const u = h.unit(id), fl = h.unit('chess_char_4_19_a');
  approx(fl.skill.sp, D('chess_char_4_19_a').skill.initSp + t1.sp, 0.1, '焰尾 initial SP +6');
  assert.equal(u.skill.activations, 1, '风笛 starts with a charge (0 + 6 SP) and uses it on her first attack');
  h.run(30);
  const atk = u.s.atk;
  const byAttack = new Map();
  for (const c of dmgBy(h, u)) (byAttack.get(c.t) ?? byAttack.set(c.t, []).get(c.t)).push(c);
  const sk = [...byAttack.values()].filter((l) => l.some((c) => c.dmg.isSkill));
  assert.ok(sk.length >= 2, 'skill attacks');
  for (const l of sk) {
    const perTarget = l.length / new Set(l.map((c) => c.target.id)).size;
    assert.equal(perTarget, 2, 'hits twice');
    const boosted = new Set(l.map((c) => c.target.id)).size === 2;
    approx(l[0].amount, atk * bb.atk_scale * (boosted ? t0.atk_scale : 1), 1e-6);
  }
  const normal = [...byAttack.values()].filter((l) => !l.some((c) => c.dmg.isSkill));
  const boosted = normal.filter((l) => new Set(l.map((c) => c.target.id)).size === 2);
  assert.ok(boosted.length > 0, '25 % extra-target attacks happen');
  for (const l of boosted) approx(l[0].amount, atk * t0.atk_scale, 1e-6);
  checkInvariants(h.b);
});

test('瑰盐 S2: allies in range take 80 % of phys/arts damage now, 20 % as 5 s HP loss; ATK −5 %, allies heal +15 %', () => {
  const id = 'chess_char_4_08_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 10, col: 4 }], timeLimit: 60, hooks: ['damaged'], captureNoisy: true });
  h.step();
  const u = h.unit(id), ally = h.unit('chess_char_1_02_a');
  approx(u.s.atk, u.base.atk * (1 + t0.atk), 1e-9);
  h.run(0.3);
  approx(ally.s.healingTakenMul, t0.heal_scale, 1e-9);
  assert.ok(u.skill.activate('test', { free: true }));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-9);
  const before = noisy(h, 'damaged').length;
  h.b.dealDamage(null, ally, { amount: 1000, type: 'arts' });
  const now = noisy(h, 'damaged')[before];
  const full = 1000 * (1 - ally.s.res / 100);
  approx(now.amount, full * bb['attack@damage_scale'], 1e-6, 'immediate part');
  h.run(bb['attack@final_duration'] + 0.5);
  const later = noisy(h, 'damaged').slice(before + 1).filter((c) => c.target === ally && c.dmg?.tags?.includes('hpLoss'));
  assert.equal(later.length, Math.round(bb['attack@final_duration'] / bb['attack@interval']));
  approx(later.reduce((s, c) => s + c.amount, 0), full * (1 - bb['attack@damage_scale']), 1e-6, 'deferred part');
  checkInvariants(h.b);
});

test('瑰盐 / 白面鸮 / 莱恩哈特 elite modules extend the range — the initial range of the DEFAULT trigger too', () => {
  // 攻击范围扩大 = the module's range grid (the chess range + the centre tile [0,3]), not a forward extension of every
  // row, and a skill with its own range keeps it (白面鸮 S2)
  for (const id of ['chess_char_4_08_b', 'chess_char_4_21_b', 'chess_char_4_14_b']) {
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 20, hooks: [] });
    h.step();
    const u = h.unit(id);
    const modGrid = D(id).raw.modules.find((m) => m.isDefault).talentChanges.find((t) => t.rangeGrid).rangeGrid;
    assert.equal(u.s.rangeExtend, 0, `${id}: no forward extension`);
    const own = absoluteRangeKeys(D(id).rangeGrid, u.tileR, u.tileC, u.facing, 0);
    const mod = absoluteRangeKeys(modGrid, u.tileR, u.tileC, u.facing, 0);
    assert.equal(mod.length, own.length + 1, `${id}: one tile more`);
    assert.deepEqual([...u.baseRangeKeys].sort((x, y) => x - y), [...mod].sort((x, y) => x - y), `${id}: module range = initial range`);
    assert.deepEqual([...u.rangeKeys].sort((x, y) => x - y), [...mod].sort((x, y) => x - y), `${id}: module range = range`);
    assert.ok(u.rangeKeys.includes(u.tileR * 21 + u.tileC + 3) && !u.rangeKeys.includes((u.tileR - 1) * 21 + u.tileC + 3), `${id}: only the centre row grows`);
  }
  {
    const id = 'chess_char_4_21_b';
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 20, hooks: [] });
    h.step();
    const u = h.unit(id);
    assert.ok(u.skill.activate('test', { free: true }));
    h.step();
    assert.equal(u.rangeKeys.length, D(id).skill.rangeGrid.length, '白面鸮 S2 keeps its own range');
  }
  // 莱恩哈特 (DEFAULT): an enemy standing only on the module tile fires S2
  const id = 'chess_char_4_14_b';
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3, carryState: { sp: 99 } }], timeLimit: 20, hooks: [] });
  h.step();
  const u = h.unit(id);
  const own = absoluteRangeKeys(D(id).rangeGrid, u.tileR, u.tileC, u.facing, 0);
  const extra = u.baseRangeKeys.find((k) => !own.includes(k) && Math.floor(k / 21) === 10);
  h.spawn('enemy_dummy', { pos: [Math.floor(extra / 21), extra % 21] });
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 3), 'DEFAULT trigger from the module tile');
  checkInvariants(h.b);
});

test('水月: 创伤性癔症 50 % arts to the lowest-HP target; S2 +1 target & bind, faster, +ATK; 反移情; elite slow', () => {
  const id = 'chess_char_4_09_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 4 }], timeLimit: 200,
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [11, 5] }], hooks: ['damaged', 'statusApplied'], captureNoisy: true, seed: 9 });
  const u = h.unit(id);
  h.runUntil(() => dmgBy(h, u, (c) => c.dmg?.tags?.includes('talent')).length >= 1, 20);
  const tal = dmgBy(h, u, (c) => c.dmg?.tags?.includes('talent'));
  approx(tal[0].amount, u.s.atk * t0['attack@mizuki_t_1.atk_scale'], 1e-6);
  assert.ok(h.runUntil(() => u.skill.active, 60));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-9, 'flat BAT');
  const n0 = dmgBy(h, u, (c) => c.dmg?.tags?.includes('talent')).length;
  h.runUntil(() => !u.skill.active, 30);
  const during = dmgBy(h, u, (c) => c.dmg?.tags?.includes('talent')).slice(n0);
  const perAttack = new Map();
  for (const c of during) perAttack.set(c.t, (perAttack.get(c.t) ?? 0) + 1);
  assert.ok([...perAttack.values()].every((n) => n === 2), 'talent hits two targets during S2');
  assert.ok(noisy(h, 'statusApplied').some((c) => c.source === u && c.status === 'bind' && c.duration === bb['attack@unmovable']));
  // 反移情
  const e = h.enemies()[0];
  h.b.dealDamage(null, e, { amount: e.hp * 0.6, type: 'true' });
  h.run(0.2);
  assert.equal(u.findBuff('mizuki:t2')?.mods.atkPct, t1.atk);
  // elite module slow
  const g = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'chess_char_4_09_b', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], timeLimit: 10, hooks: [] });
  g.run(0.5);
  const mv = D('chess_char_4_09_b').talents.find((t) => !t.name && t.bb.move_speed).bb.move_speed;
  approx(g.enemies()[0].findBuff(`mizuki:slow:${g.unit('chess_char_4_09_b').id}`).mods.moveMul, 1 + mv, 1e-9);
});

test('阿罗玛: first attack ×1.1 + 2.5 s levitation; S2: +ATK and landing damage 65 % ATK', () => {
  const id = 'chess_char_4_10_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 200, hooks: ['damaged', 'statusApplied'], captureNoisy: true });
  h.step();
  const u = h.unit(id);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.runUntil(() => dmgBy(h, u, (c) => c.target === e).length >= 2, 20);
  const hits = dmgBy(h, u, (c) => c.target === e && c.dmg.isAttack);
  approx(hits[0].amount, hits[1].amount * t0.damage_scale, 1e-6, 'first attack ×1.1');
  assert.ok(noisy(h, 'statusApplied').some((c) => c.target === e && c.status === 'levitate' && c.duration === t0.levitate_duration));
  // a second enemy: skill on before it is bubbled → landing damage
  assert.ok(u.skill.activate('test', { free: true }));
  const e2 = h.spawn('enemy_dummy', { pos: [10, 7] }); // on her line: struck by the next attack too (轰击术师)
  approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-9);
  h.runUntil(() => dmgBy(h, u, (c) => c.dmg?.tags?.includes('landing')).length >= 1, 15);
  const land = dmgBy(h, u, (c) => c.dmg?.tags?.includes('landing'));
  assert.ok(land.length >= 1 && land[0].target === e2, 'landing damage');
  approx(land[0].amount, u.s.atk * bb['attack@atk_scale_when_fly_finish'], 1e-6);
  checkInvariants(h.b);
});

test('阿罗玛 elite module: farther targets take up to ×1.1', () => {
  const id = 'chess_char_4_10_b', tb = D(id).traitBb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 2 }], enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], timeLimit: 30, hooks: ['damaged'], captureNoisy: true });
  const u = h.unit(id);
  h.runUntil(() => dmgBy(h, u, (c) => c.dmg.isAttack).length >= 2, 20);
  const hits = dmgBy(h, u, (c) => c.dmg.isAttack);
  approx(hits[1].amount, u.s.atk * (1 + tb.damage_scale), 1e-6, 'distance 5 ≥ max_dist');
});

test('凯瑟琳: 2 placed support devices shield allies (20 % of her HP), 6 %/s after 5 s unhit; S2: 6 %/s regardless, no attacks', () => {
  const id = 'chess_char_4_11_a', bb = D(id).skill.bb;
  // the devices are hand pieces the player places and turns (user playtest #6): one faces the ally, one faces her
  const h = makeBattle({
    units: [
      { chessId: id, row: 10, col: 5, uid: 1 }, { chessId: 'chess_char_1_02_a', row: 9, col: 6, uid: 2 },
      { kind: 'token', tokenId: 'token_10041_cathy_catsld', ownerUid: 1, row: 9, col: 5, uid: 3, dir: 'RIGHT' },
      { kind: 'token', tokenId: 'token_10041_cathy_catsld', ownerUid: 1, row: 10, col: 6, uid: 4, dir: 'LEFT' },
    ],
    timeLimit: 120, hooks: ['attack'], captureNoisy: true,
  });
  h.run(0.2);
  const u = h.unit(id), ally = h.unit('chess_char_1_02_a');
  const devs = h.b.allyUnits.filter((x) => x.defId === 'token_10041_cathy_catsld' && x.alive);
  assert.equal(devs.length, 2, 'two devices deployed');
  assert.ok(devs.every((d) => d.s.flags.untargetable && d.s.flags.invulnerable), 'untargetable and immune (不会受到攻击)');
  assert.equal(h.b.dealDamage(null, devs[0], { amount: 1e6, type: 'true' }), 0);
  const tb = h.b.data.getToken('token_10041_cathy_catsld', u.defId).talents[0].bb;
  approx(ally.findBuff('cathy:shield').shield, u.s.maxHp * tb.max_shield_ratio, 1e-6, 'initial shield');
  h.b.dealDamage(null, ally, { amount: u.s.maxHp * 0.15, type: 'true' });
  const left = ally.findBuff('cathy:shield').shield;
  h.run(tb.interval - 1);
  approx(ally.findBuff('cathy:shield').shield, left, 1e-6, 'no refill while recently hit');
  h.run(2.1);
  assert.ok(ally.findBuff('cathy:shield').shield > left + u.s.maxHp * tb.shield_ratio_each_trigger * 0.99, 'refills 6 %/s');
  // S2
  assert.ok(u.skill.activate('test', { free: true }));
  approx(u.s.maxHp, u.base.maxHp * (1 + bb.max_hp), 1e-9);
  const a0 = noisy(h, 'attack').filter((c) => c.attacker === u).length;
  h.b.dealDamage(null, ally, { amount: 1e5, type: 'phys' }); // breaks the shield (and more)
  h.run(0.05);
  if (!ally.alive) return;
  h.run(1.05);
  const s1 = ally.findBuff('cathy:shield')?.shield ?? 0;
  approx(s1, u.s.maxHp * bb.overwrite_ratio, 0.01, 'S2: +6 % even right after a hit');
  assert.equal(noisy(h, 'attack').filter((c) => c.attacker === u).length, a0, 'no attacks during S2');
});

test('歌蕾蒂娅 S3: binds the farthest target, tornado pulses 85 % ATK arts every 1.5 s + pull, slows −50 %, final pull; 弱肉强食 ×1.3', () => {
  const id = 'chess_char_4_12_a', bb = D(id).skill.bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 200,
    hooks: ['damaged', 'statusApplied'], captureNoisy: true });
  h.step();
  const u = h.unit(id);
  h.spawn('enemy_dummy', { pos: [10, 4] });
  const far = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.runUntil(() => dmgBy(h, u, (c) => c.dmg.isAttack).length >= 1, 10);
  approx(dmgBy(h, u, (c) => c.dmg.isAttack)[0].amount, u.s.atk * t1.atk_scale, 1e-6, 'weight ≤ 3 ×1.3');
  assert.ok(u.skill.activate('test', { free: true }));
  assert.ok(noisy(h, 'statusApplied').some((c) => c.target === far && c.status === 'bind'), 'farthest target bound');
  h.run(0.2);
  approx(far.findBuff(`glady:slow:${u.id}`).mods.moveMul, 1 + bb.move_speed, 1e-9);
  const x0 = far.x;
  h.runUntil(() => !u.skill.active, 20);
  const pulses = dmgBy(h, u, (c) => c.dmg?.tags?.includes('tornado') && c.target === far);
  assert.equal(pulses.length, Math.floor(D(id).skill.duration / bb.interval + 1e-9), 'one pulse every 1.5 s');
  approx(pulses[0].amount, u.s.atk * bb.atk_scale, 1e-6);
  assert.ok(far.x < x0 - 0.3, 'pulled towards her at the end');
  checkInvariants(h.b);
});

test('歌蕾蒂娅 S3: the skill-end 捕网 has radius 1, the tornado 1.5 (PRTS 备注; GitHub #324, PR #329)', () => {
  const id = 'chess_char_4_12_a';
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 200, autoFinish: false });
  h.step();
  const u = h.unit(id);
  h.spawn('enemy_dummy', { pos: [10, 6] });   // the farthest enemy: bound, the tornado sits on it
  h.step();
  assert.ok(u.skill.activate('test', { free: true }));
  assert.deepEqual([u.mem.tornado.x, u.mem.tornado.y], [6, 10]);
  const at = (x, y) => { const e = h.spawn('enemy_dummy', { pos: [10, 6] }); e.x = x; e.y = y; return e; };
  const inner = at(6, 9.1), outer = at(6, 11.25);   // 0.9 and 1.25 from the centre
  h.step();
  for (const e of [inner, outer]) assert.ok(e.findBuff(`glady:slow:${u.id}`), 'both inside the tornado (slowed)');
  const p0 = [inner.x, inner.y, outer.x, outer.y];
  u.skill.end('test');
  h.run(0.6);
  assert.ok(Math.hypot(inner.x - p0[0], inner.y - p0[1]) > 0.3, 'the net pulls the enemy 0.9 from the centre');
  assert.deepEqual([outer.x, outer.y], [p0[2], p0[3]], 'the one 1.25 from the centre stays: outside the net');
  checkInvariants(h.b);
});

test('歌蕾蒂娅 阿戈尔的波涛: 深海猎人 regen 2.5 %/s and −25 % damage from 海怪; elite drag damage', () => {
  const id = 'chess_char_4_12_a', t0 = D(id).talents[0].bb;
  const sea = withTags(dummy({ key: 'enemy_sea', atk: 0 }), ['seamonster']);
  const h = makeBattle({ defs: { enemies: { enemy_sea: sea } }, units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_2_07_a', row: 9, col: 5 }], timeLimit: 30, hooks: ['damaged'], captureNoisy: true });
  h.run(0.3);
  const ghost = h.unit('chess_char_2_07_a');
  approx(ghost.findBuff('glady:tide').mods.hpRegenRatio, t0.hp_recovery_per_sec_by_max_hp_ratio, 1e-9);
  const e = h.spawn('enemy_sea', { pos: [12, 9] });
  const n0 = noisy(h, 'damaged').length;
  h.b.dealDamage(e, ghost, { amount: 1000, type: 'arts' });
  const got = noisy(h, 'damaged')[n0];
  approx(got.amount, 1000 * (1 - ghost.s.res / 100) * (1 - t0.damage_resistance), 1e-6);
  // elite: drag damage during pulls
  const g = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'chess_char_4_12_b', row: 10, col: 3 }], timeLimit: 30, hooks: ['damaged'], captureNoisy: true });
  g.step();
  const gl = g.unit('chess_char_4_12_b');
  g.spawn('enemy_dummy', { pos: [10, 5] });
  g.spawn('enemy_dummy', { pos: [10, 6] });
  g.step();
  gl.skill.activate('test', { free: true });
  g.runUntil(() => !gl.skill.active, 20);
  assert.ok(dmgBy(g, gl, (c) => c.dmg?.tags?.includes('drag')).length > 0, 'drag damage');
});

test('灵知 S2: 130 % ATK arts + 2.5 s cold to all in range; fully charged cast freezes; 坚冰 fragile; 殊途同归 resistance', () => {
  const id = 'chess_char_4_13_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 12, col: 3 }], timeLimit: 300,
    hooks: ['damaged', 'statusApplied', 'skillStart'], captureNoisy: true });
  h.step();
  const u = h.unit(id), kj = h.unit('chess_char_1_02_a');
  // 殊途同归: after 10 s a 谢拉格 operator halves negative statuses
  h.run(t1.interval + 0.3);
  assert.ok(kj.findBuff('resist'), 'the engine 抵抗 status');
  h.b.applyStatus(kj, 'stun', { duration: 4 });
  approx(kj.findBuff('stun').timeLeft, 4 * (1 + t1.one_minus_status_resistance), 1e-9);
  // both charges stored (no enemy for a while) ⇒ the first cast is a charged one
  assert.ok(h.runUntil(() => u.skill.charges === u.skill.maxCharges, 30));
  const a = h.spawn('enemy_dummy', { pos: [10, 4] }), b = h.spawn('enemy_dummy', { pos: [11, 5] });
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 5));
  const burst = dmgBy(h, u, (c) => c.dmg?.tags?.includes('burst'));
  assert.equal(burst.length, 2, 'both enemies');
  approx(burst[0].amount, u.s.atk * bb.atk_scale, 1e-6);
  assert.ok(a.s.flags.freeze && b.s.flags.freeze, 'charged cast: second cold ⇒ freeze');
  h.run(0.2);
  approx(a.findBuff('gnosis:fragile').mods.dmgTakenMul, t0.damage_scale_freeze, 1e-9, 'frozen ×2 fragile');
  // next (single-charge) cast only chills once per enemy
  assert.ok(h.runUntil(() => u.skill.activations >= 2, 20));
  const starts = noisy(h, 'skillStart').filter((c) => c.unit === u).map((c) => c.t);
  const colds = (T) => noisy(h, 'statusApplied').filter((c) => c.source === u && c.status === 'cold' && c.duration === bb.cold && c.t === T).length;
  const freezes = (T) => noisy(h, 'statusApplied').filter((c) => c.source === u && c.status === 'freeze' && c.t === T).length;
  // charged: two colds on each of the two enemies — each enemy's pair becomes one freeze (友方寒冷 「两两一对」, since 0.2.0)
  assert.equal(colds(starts[0]), 2, 'charged: the first cold on each enemy lands as a cold');
  assert.equal(freezes(starts[0]), 2, 'charged: the second cold on each enemy turns the pair into a freeze');
  assert.equal(colds(starts[1]), 2, 'single charge: one cold each');
  // normal attacks chill for 1 s
  assert.ok(noisy(h, 'statusApplied').some((c) => c.source === u && c.status === 'cold' && c.duration === t0.cold));
  checkInvariants(h.b);
});

test('灵知 殊途同归 抵抗: scales the incoming status (never shortens a longer one), once for several 灵知, never on top of 流明’s 抵抗', () => {
  const id = 'chess_char_4_13_a', t1 = D(id).talents[1].bb;
  const mul = 1 + t1.one_minus_status_resistance;
  // two 灵知 on the board: still a single ×0.5
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_4_13_b', row: 11, col: 3 }, { chessId: 'chess_char_1_02_a', row: 12, col: 3 }], timeLimit: 300, hooks: [] });
  const kj = h.unit('chess_char_1_02_a');
  h.run(t1.interval + 0.3);
  assert.ok(kj.findBuff('resist'));
  h.b.applyStatus(kj, 'stun', { duration: 10 });
  approx(kj.findBuff('stun').timeLeft, 10 * mul, 1e-9, 'one 抵抗 for two 灵知');
  // a shorter resisted re-application never cuts the running one (8 s → 4 s < 5 s left)
  h.b.applyStatus(kj, 'stun', { duration: 8 });
  approx(kj.findBuff('stun').timeLeft, 10 * mul, 1e-9, 'the longer stun keeps running');
  checkInvariants(h.b);
  // 流明 (凡人之愿) also grants 抵抗 to the 谢拉格 operator he heals: the two never compound
  const g = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_6_14_a', row: 11, col: 3 }, { chessId: 'chess_char_1_02_a', row: 12, col: 3 }], timeLimit: 300, hooks: [] });
  const k2 = g.unit('chess_char_1_02_a');
  g.run(t1.interval + 0.3);
  k2.hp = k2.s.maxHp * 0.5;
  assert.ok(g.runUntil(() => k2.hp > k2.s.maxHp * 0.5 + 1, 10), '流明 healed the 谢拉格 operator');
  const r = k2.findBuff('resist');
  assert.ok(r && r.timeLeft > 1, '凡人之愿 抵抗 (outlasts the 灵知 pulse) — one single engine status');
  assert.equal(k2.buffs.filter((b) => b.status === 'resist').length, 1);
  g.b.applyStatus(k2, 'stun', { duration: 4 });
  approx(k2.findBuff('stun').timeLeft, 4 * mul, 1e-9, 'a single ×0.5');
  checkInvariants(g.b);
});

test('莱恩哈特 S2: 170 % ATK arts to all enemies in the wider skill range + RES −8 % for 6 s; 破片杀伤 +4 % per enemy', () => {
  const id = 'chess_char_4_14_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy({ res: 50 }) } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 120, hooks: ['damaged'], captureNoisy: true });
  h.step();
  const u = h.unit(id);
  const inR = h.spawn('enemy_dummy', { pos: [10, 5] }), outR = h.spawn('enemy_dummy', { pos: [10, 6] }); // +3 only in the skill range
  h.run(0.2);
  assert.equal(u.findBuff('lionhd:t1').mods.atkPct, t0.atk * 1, 'one enemy in the normal range');
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 30));
  const burst = dmgBy(h, u, (c) => c.dmg?.tags?.includes('burst'));
  assert.ok(burst.some((c) => c.target === outR), 'reaches the wider range');
  approx(burst[0].amount, u.s.atk * bb.atk_scale * 0.5, 1e-6);
  approx(outR.s.res, 50 * (1 + bb.magic_resistance), 1e-9);
  h.run(bb.duration + 0.1);
  approx(outR.s.res, 50, 1e-9, 'debuff expired');
  assert.ok(inR.alive);
});

test('同名效果取最高: two 灵知 never compound 坚冰, two 莱恩哈特 never compound the RES cut (one instance per enemy, the strongest)', () => {
  // DESIGN §20.10 (the 奥术 rule): a pair / 联防 partner's copy of the same operator puts the same-named effect on the
  // same enemy — one instance, the strongest (PRTS 作战机制 "同名buff…只能表现出一个"), never m × m
  const gn = 'chess_char_4_13_a', t0 = D(gn).talents[0].bb;
  const g = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: gn, row: 10, col: 3 }, { chessId: gn, row: 11, col: 3 }], timeLimit: 60, hooks: [] });
  g.step();
  const both = g.b.allyUnits.filter((u) => u.def.id === gn);
  assert.equal(both.length, 2, 'two 灵知 on the board');
  const e = g.spawn('enemy_dummy', { pos: [10, 4] });
  let seen = 0;
  for (let i = 0; i < 120; i++) { // 4 s: chilled / frozen by both
    g.step();
    const fr = e.buffs.filter((b) => String(b.key).startsWith('gnosis:fragile'));
    assert.ok(fr.length <= 1, `one 坚冰 instance (${fr.map((b) => b.key)})`);
    if (!fr.length) continue;
    seen++;
    const want = e.s.flags.freeze ? t0.damage_scale_freeze : t0.damage_scale_cold;
    approx(e.s.dmgTakenMul, fr[0].mods.dmgTakenMul, 1e-9, 'the only damage-taken modifier');
    assert.ok(e.s.dmgTakenMul <= t0.damage_scale_freeze + 1e-9 && fr[0].mods.dmgTakenMul >= want - 1e-9, `never ${t0.damage_scale_cold}² / ${t0.damage_scale_freeze}² (${e.s.dmgTakenMul})`);
  }
  assert.ok(seen > 30, `坚冰 was up (${seen})`);
  const lh = 'chess_char_4_14_a', bb = D(lh).skill.bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy({ res: 50 }) } }, units: [{ chessId: lh, row: 10, col: 3 }, { chessId: lh, row: 11, col: 3 }], timeLimit: 60, hooks: [] });
  h.step();
  const two = h.b.allyUnits.filter((u) => u.def.id === lh);
  assert.equal(two.length, 2);
  const x = h.spawn('enemy_dummy', { pos: [10, 5] });
  h.step();
  for (const u of two) assert.ok(u.skill.activate('test', { free: true }), 'S2 cast');
  assert.equal(x.buffs.filter((b) => String(b.key).startsWith('lionhd:res')).length, 1, 'one RES cut');
  approx(x.s.res, 50 * (1 + bb.magic_resistance), 1e-9, 'RES −8 % once, not twice');
  h.run(bb.duration + 0.1);
  approx(x.s.res, 50, 1e-9, 'expired');
});

test('录武官 S2: healed allies regain 80 HP whenever damaged for 10 s; 学成于聚 SP +1 & ASPD +16 when an operator in range casts', () => {
  const id = 'chess_char_4_15_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 10, col: 4 }], timeLimit: 60, hooks: ['heal'], captureNoisy: true });
  h.step();
  const u = h.unit(id), ally = h.unit('chess_char_1_02_a');
  const sp0 = u.skill.sp;
  ally.skill.activate('test', { free: true });
  approx(u.skill.sp, sp0 + t0.sp, 1e-9);
  approx(u.s.aspd, u.base.aspd + t0.attack_speed, 1e-9);
  assert.ok(u.skill.activate('test', { free: true }));
  approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-9);
  h.b.dealDamage(null, ally, { amount: ally.s.maxHp * 0.6, type: 'true' });
  h.runUntil(() => ally.findBuff(`reckpr:guard:${u.id}`), 5);
  assert.ok(ally.findBuff(`reckpr:guard:${u.id}`), 'guard buff after her heal');
  const n0 = noisy(h, 'heal').length;
  h.b.dealDamage(null, ally, { amount: 300, type: 'true' });
  const hl = noisy(h, 'heal').slice(n0).filter((c) => c.source === u && c.target === ally);
  assert.equal(hl.length, 1);
  approx(hl[0].amount, bb['attack@fixed_heal_value'] * ally.s.healingTakenMul, 1e-6);
});

test('录武官 / 华法琳 elite trait: heals on allies below 50 % are ×1.15', () => {
  for (const id of ['chess_char_4_15_b', 'chess_char_4_26_b']) {
    const tb = D(id).traitBb;
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 10, col: 4 }], timeLimit: 30, hooks: ['heal'], captureNoisy: true });
    h.step();
    const u = h.unit(id), ally = h.unit('chess_char_1_02_a');
    h.b.dealDamage(null, ally, { amount: ally.s.maxHp * 0.8, type: 'true' });
    h.runUntil(() => noisy(h, 'heal').some((c) => c.source === u && c.target === ally), 10);
    const first = noisy(h, 'heal').find((c) => c.source === u && c.target === ally);
    approx(first.amount, u.s.atk * tb.heal_scale, 1e-6, id);
  }
});

test('缄默德克萨斯 S3 (passive): deploy burst 2 × 115 % arts + 1.5 s stun, sword rain ≤ 2 targets/s for 6 s; talents', () => {
  const id = 'chess_char_4_16_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 120, hooks: ['damaged', 'statusApplied'], captureNoisy: true });
  h.step();
  const u = h.unit(id);
  approx(u.s.aspd, u.base.aspd + t1.attack_speed, 1e-9, 'swordplay ASPD');
  approx(u.s.dmgTakenMul, 1 - t1.damage_resistance, 1e-9);
  const es = [h.spawn('enemy_dummy', { pos: [9, 4] }), h.spawn('enemy_dummy', { pos: [11, 6] }), h.spawn('enemy_dummy', { pos: [10, 4] })];
  h.b.retreat(u);
  assert.ok(h.b.redeploy(u));
  approx(u.s.atk, u.base.atk * (1 + t0.atk), 1e-9, 'ATK +20 % during the passive');
  const burst = dmgBy(h, u, (c) => c.dmg?.tags?.includes('burst'));
  assert.equal(burst.length, 6, 'two hits on each of the 3 surrounding enemies');
  approx(burst[0].amount, u.s.atk * bb['appear.atk_scale'], 1e-6);
  assert.equal(noisy(h, 'statusApplied').filter((c) => c.source === u && c.status === 'stun' && c.duration === bb['appear.stun']).length, 3);
  h.run(D(id).skill.duration + 1.5);
  const rain = dmgBy(h, u, (c) => c.dmg?.tags?.includes('swordRain'));
  const waves = new Map();
  for (const c of rain) waves.set(c.t, (waves.get(c.t) ?? 0) + 1);
  assert.equal(waves.size, D(id).skill.duration, 'one rain per second while the passive lasts');
  assert.ok([...waves.values()].every((n) => n === bb.max_target), '≤ 2 distinct targets');
  approx(rain[0].amount, u.base.atk * (1 + t0.atk) * bb.atk_scale, 1e-6);
  assert.equal(u.skill.active, false, 'ATK bonus ends with the skill');
  approx(u.s.atk, u.base.atk);
});

test('缄默德克萨斯: first kill ⇒ full heal + recast; 剑术 buff removed', () => {
  const id = 'chess_char_4_16_a';
  const h = makeBattle({ defs: { enemies: { enemy_weak: dummy({ key: 'enemy_weak', hp: 50 }), enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 60, hooks: [] });
  h.step();
  const u = h.unit(id);
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.b.dealDamage(null, u, { amount: u.s.maxHp * 0.5, type: 'true' });
  h.spawn('enemy_weak', { pos: [9, 5] });
  h.runUntil(() => u.mem.texasKilled, 10);
  assert.ok(u.mem.texasKilled);
  approx(u.hpRatio, 1, 1e-3, 'full heal');
  assert.equal(u.findBuff('texas2:swordplay'), null);
  assert.equal(u.skill.active, true, 'skill recast');
  assert.equal(u.skill.activations, 2);
});

test('星熊 S2 (passive): DEF +13 % and 65 % ATK thorns; 战术装甲 negates ~25 % of hits; 重装 aura DEF +6 %', () => {
  const id = 'chess_char_4_17_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 900, bat: 0.5 }) } }, units: [{ chessId: id, row: 9, col: 5 }, { chessId: 'chess_char_1_02_a', row: 11, col: 5 }],
    timeLimit: 200, hooks: ['damaged', 'attack'], captureNoisy: true, seed: 4 });
  h.run(0.3);
  const u = h.unit(id), mh = h.unit('chess_char_1_02_a');
  approx(u.s.def, u.base.def * (1 + bb.def + t1.def), 1e-9);
  approx(mh.s.def, mh.base.def * (1 + t1.def), 1e-9, '角峰 (重装) aura');
  const e = h.spawn('enemy_hitter', { pos: [9, 5] });
  h.run(60);
  const swings = noisy(h, 'attack').filter((c) => c.attacker === e).length;
  const landed = noisy(h, 'damaged').filter((c) => c.source === e && c.target === u).length;
  const thorns = dmgBy(h, u, (c) => c.dmg?.tags?.includes('counter'));
  assert.equal(thorns.length, landed, 'one thorn per landed attack');
  approx(thorns[0].amount, u.s.atk * bb.atk_scale, 1e-6);
  const blockRate = 1 - landed / swings;
  assert.ok(Math.abs(blockRate - t0.prob) < 0.08, `block rate ${blockRate}`);
});

test('泥岩 S2: after 5 hits the next attack heals 4 % and deals 190 % phys to all ground enemies around; 沃土予身 layers; 萨卡兹 −30 %', () => {
  const id = 'chess_char_4_18_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const sarkaz = withTags(dummy({ key: 'enemy_sarkaz', atk: 300, bat: 1 }), ['sarkaz']);
  const h = makeBattle({ defs: { enemies: { enemy_sarkaz: sarkaz, enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }],
    timeLimit: 200, hooks: ['damaged', 'heal', 'skillStart'], captureNoisy: true, seed: 6 });
  h.step();
  const u = h.unit(id);
  assert.equal(u.findBuff('mudrok:layers').shieldHits, t0.times, '1 layer on deploy');
  const side = h.spawn('enemy_dummy', { pos: [11, 6] });   // diagonal: outside her normal range
  const hitter = h.spawn('enemy_sarkaz', { pos: [10, 5] }); // blocked, attacks her
  h.runUntil(() => noisy(h, 'damaged').some((c) => c.source === hitter && c.target === u), 5);
  const first = noisy(h, 'damaged').find((c) => c.source === hitter && c.target === u);
  assert.equal(first.amount, 0, 'first hit absorbed by the layer');
  assert.ok(noisy(h, 'heal').some((c) => c.source === u && c.target === u), 'broken layer heals');
  const second = noisy(h, 'damaged').filter((c) => c.source === hitter && c.target === u && c.amount > 0);
  h.runUntil(() => noisy(h, 'damaged').filter((c) => c.source === hitter && c.target === u && c.amount > 0).length >= 1, 5);
  const hit = noisy(h, 'damaged').find((c) => c.source === hitter && c.target === u && c.amount > 0);
  approx(hit.amount, Math.max(300 - u.s.def, 15) * (1 - t1.damage_resistance), 1e-6, 'sarkaz −30 %');
  assert.ok(second.length >= 0);
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 30));
  h.run(u.s.interval + 0.1);
  const slam = dmgBy(h, u, (c) => c.dmg.isSkill);
  assert.ok(slam.some((c) => c.target === side), 'hits the ground enemy around her');
  approx(slam.find((c) => c.target === side).amount, u.s.atk * bb.atk_scale, 1e-6);
  checkInvariants(h.b);
});

test('焰尾 S3: +8 DP over the skill, 60 % dodge, block +1; 前锋剑术 riposte after a dodge; 卡西米尔 aura +22 % dodge', () => {
  const id = 'chess_char_4_19_a', bb = D(id).skill.bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_hitter: dummy({ key: 'enemy_hitter', atk: 200, bat: 0.5 }) } }, flags: { dpPerSec: 0 },
    units: [{ chessId: id, row: 10, col: 5 }, { chessId: 'chess_char_4_20_a', row: 12, col: 3 }], timeLimit: 200, hooks: ['damaged', 'dodge'], captureNoisy: true, seed: 8 });
  h.run(0.3);
  const u = h.unit(id), ft = h.unit('chess_char_4_20_a');
  approx(ft.s.dodgePhys, t1.prob, 1e-9, '远牙 is 卡西米尔');
  h.spawn('enemy_hitter', { pos: [10, 5] });
  assert.ok(h.runUntil(() => u.skill.active, 60));
  approx(u.s.dodgePhys, t1.prob, 1e-9, 'talent aura on herself (the S3 dodge is an independent roll)');
  assert.equal(u.s.blockCnt, u.base.blockCnt + bb.block_cnt);
  approx(u.s.interval, u.base.bat * bb.base_attack_time * 100 / u.s.aspd, 1e-9, '×0.7 attack interval');
  const dp0 = h.b.players[0].dp;
  h.runUntil(() => !u.skill.active, 20);
  approx(h.b.players[0].dp - dp0, bb.value * bb.cost, 1e-9, '+8 DP');
  h.run(20);
  assert.ok(noisy(h, 'dodge').some((c) => c.target === u));
  assert.ok(dmgBy(h, u, (c) => c.dmg?.tags?.includes('riposte')).length > 0, 'riposte hit');
});

test('远牙 S3: infinite line, ATK +80 %, ×1.25 beyond the normal range, taunt −1; 凝神 +15 %', () => {
  const id = 'chess_char_4_20_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_near: dummy({ key: 'enemy_near', def: 200 }), enemy_far: dummy({ key: 'enemy_far', def: 0 }) } },
    units: [{ chessId: id, row: 10, col: 2 }], timeLimit: 120, hooks: ['damaged'], captureNoisy: true });
  h.run(0.2);
  const u = h.unit(id);
  approx(u.s.atk, u.base.atk * (1 + t0.atk), 1e-9, 'not hurt ⇒ +15 %');
  const far = h.spawn('enemy_far', { pos: [10, 10] });
  h.spawn('enemy_near', { pos: [10, 5] });
  assert.ok(h.runUntil(() => u.skill.active, 60));
  assert.equal(u.s.taunt, u.base.tauntLevel + t1.taunt_level);
  approx(u.s.atk, u.base.atk * (1 + t0.atk + bb.atk), 1e-9);
  h.runUntil(() => dmgBy(h, u, (c) => c.target === far).length >= 1, 10);
  approx(dmgBy(h, u, (c) => c.target === far)[0].amount, u.s.atk * bb.damage_scale, 1e-6, 'outside the original range ×1.25');
  h.b.dealDamage(null, u, { amount: 10, type: 'true' });
  h.run(0.2);
  assert.equal(u.findBuff('fartth:focus'), null, 'hurt ⇒ no 凝神');
});

test('白面鸮: SP aura +0.3/s for all allies (highest SP aura wins); S2 faster heals in a wider range', () => {
  const id = 'chess_char_4_21_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 9, col: 5 }, { chessId: 'chess_char_4_02_a', row: 12, col: 4 }], timeLimit: 30, hooks: [] });
  h.run(0.3);
  const u = h.unit(id), mh = h.unit('chess_char_1_02_a'), mo = h.unit('chess_char_4_02_a');
  approx(mh.s.spRecovery, 1 + t0.sp_recovery_per_sec, 1e-9);
  approx(mo.s.spRecovery, 1 + Math.max(t0.sp_recovery_per_sec, D('chess_char_4_02_a').talents[0].bb.sp_recovery_per_sec), 1e-9, 'not cumulative');
  assert.ok(u.skill.activate('test', { free: true }));
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-9);
  assert.ok(u.rangeKeys.length > u.baseRangeKeys.length);
});

test('银灰 S3: ATK +125 %, DEF −70 %, ≤ 4 targets at full (melee) scale; 领袖 −10 % redeploy for the team; 鹰眼视觉 reveals', () => {
  const id = 'chess_char_4_22_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 12, col: 3 }], timeLimit: 200, hooks: ['damaged'], captureNoisy: true });
  h.step();
  const u = h.unit(id), mh = h.unit('chess_char_1_02_a');
  const es = [[10, 6], [11, 4]].map((p) => h.spawn('enemy_dummy', { pos: p }));
  h.b.applyStatus(es[1], 'stealth', { duration: 100 });
  h.run(0.5);
  assert.ok(es[1].s.flags.reveal, 'revealed');
  h.runUntil(() => dmgBy(h, u, (c) => c.dmg.isAttack).length >= 1, 5);
  const pre = dmgBy(h, u, (c) => c.dmg.isAttack)[0];
  for (const p of [[10, 4], [10, 5], [9, 4]]) es.push(h.spawn('enemy_dummy', { pos: p }));
  approx(pre.amount, u.s.atk * D(id).traitBb.atk_scale, 1e-6, 'ranged ×0.8 before the skill');
  assert.ok(h.runUntil(() => u.skill.active, 90));
  approx(u.s.atk, u.base.atk * (1 + t0.atk + bb.atk), 1e-9);
  approx(u.s.def, u.base.def * (1 + bb.def), 1e-9);
  const n0 = dmgBy(h, u).length;
  h.run(u.s.interval + 0.05);
  const hits = dmgBy(h, u).slice(n0);
  assert.equal(new Set(hits.map((c) => c.target.id)).size, bb['attack@max_target']);
  approx(hits[0].amount, u.s.atk, 1e-6, 'melee scale');
  h.b.dealDamage(null, mh, { amount: 1e9, type: 'true' });
  approx(mh.respawnAt - mh.deathAt, mh.base.respawnTime * (1 + t0.respawn_time), 1e-9);
});

test('银灰 elite module: attacks add 10 % ATK arts', () => {
  const id = 'chess_char_4_22_b', tb = D(id).traitBb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [10, 4] }], timeLimit: 20, hooks: ['damaged'], captureNoisy: true });
  const u = h.unit(id);
  h.runUntil(() => dmgBy(h, u, (c) => c.dmg?.tags?.includes('module')).length >= 1, 5);
  approx(dmgBy(h, u, (c) => c.dmg?.tags?.includes('module'))[0].amount, u.s.atk * tb.atk_scale_m, 1e-6);
});

test('百炼嘉维尔 S3: ATK/ASPD/block up; only 50 % damage now, the rest as 20 s HP loss afterwards; talents', () => {
  const id = 'chess_char_4_23_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 120, hooks: ['heal', 'damaged'], captureNoisy: true });
  h.run(0.2);
  const u = h.unit(id);
  approx(u.s.atk, u.base.atk * (1 + t0.atk), 1e-9, '战地巨斧');
  assert.ok(u.skill.activate('test', { free: true }));
  approx(u.s.atk, u.base.atk * (1 + t0.atk + bb.atk), 1e-9);
  assert.equal(u.s.blockCnt, u.base.blockCnt + bb.block_cnt);
  const hp0 = u.hp;
  h.b.dealDamage(null, u, { amount: 1000, type: 'true' });
  approx(hp0 - u.hp, 1000 * (1 - bb.damage_resistance), 1e-9, 'half now');
  u.skill.end('test');
  const hp1 = u.hp;
  h.run(bb.final_duration + 0.5);
  const loss = noisy(h, 'damaged').filter((c) => c.target === u && c.dmg?.tags?.includes('hpLoss')).reduce((s, c) => s + c.amount, 0);
  approx(loss, 1000 * bb.damage_resistance, 1e-6, 'the rest over 20 s');
  assert.ok(u.hp <= hp1);
  // 医学背景
  h.b.heal(null, u, 100);
  const hl = noisy(h, 'heal').filter((c) => c.target === u).pop();
  approx(hl.amount, 100 * (u.hpRatio < t1.hp_ratio ? t1.heal_scale_2 : t1.heal_scale_1), 1e-9);
});

test('卡涅利安 S2: faster AoE with 0.3 s sluggish; charged cast: ATK +10 %, bind, 80 % heal; 蓄势待发 +0.6 SP/s', () => {
  const id = 'chess_char_4_24_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 300, hooks: ['statusApplied', 'heal'], captureNoisy: true });
  h.step();
  const u = h.unit(id);
  h.runUntil(() => u.skill.charges >= 1, 40);
  h.run(0.2);
  approx(u.s.spRecovery, 1 + t1.sp_recovery_per_sec, 1e-9, 'SP regen up once a charge is stored');
  h.runUntil(() => u.skill.charges >= u.skill.maxCharges, 60);
  h.b.dealDamage(null, u, { amount: u.s.maxHp * 0.9, type: 'true' });
  h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-9, 'charged ATK bonus');
  approx(u.s.interval, u.base.bat + bb.base_attack_time, 1e-9);
  const selfHeal = noisy(h, 'heal').filter((c) => c.source === u && c.target === u).pop();
  approx(selfHeal.amount, u.s.maxHp * t0['billro_t_1[enhance].heal_scale'], 1e-6, 'charged heal ×2');
  h.run(3);
  assert.ok(noisy(h, 'statusApplied').some((c) => c.source === u && c.status === 'bind' && c.duration === bb['attack@root']));
  h.runUntil(() => !u.skill.active, 30);
  // an uncharged cast: sluggish
  h.runUntil(() => u.skill.active, 40);
  h.run(3);
  assert.ok(noisy(h, 'statusApplied').some((c) => c.source === u && c.status === 'sluggish' && c.duration === bb['attack@sluggish']));
  checkInvariants(h.b);
});

test('卡涅利安 / 蜜蜡 elite trait: keep DEF +100 % / RES +10 during the skill', () => {
  for (const [id, pre] of [['chess_char_4_24_b', 'billro_e_002'], ['chess_char_4_05_b', 'soil_e_002']]) {
    const tb = D(id).traitBb;
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 30, hooks: [] });
    h.step();
    const u = h.unit(id);
    u.skill.activate('test', { free: true });
    approx(u.s.def, u.base.def * (1 + tb[`${pre}[buff].def`]), 1e-9, id);
    approx(u.s.res, u.base.res + tb[`${pre}[buff].magic_resistance`], 1e-9, id);
  }
});

test('魔王 S3: range up, trait 65 % ATK/s (生命回复速度), 鼓舞 +65 % of her max HP, HP redistributed every 2 s; motes ×1.5; 萨卡兹 −10 %', () => {
  const id = 'chess_char_4_25_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb, t1 = D(id).talents[1].bb;
  const sarkaz = withTags(dummy({ key: 'enemy_sarkaz' }), ['sarkaz']);
  const h = makeBattle({ defs: { enemies: { enemy_sarkaz: sarkaz } }, units: [{ chessId: id, row: 10, col: 5 }, { chessId: 'chess_char_1_02_a', row: 10, col: 6 }, { chessId: 'chess_char_4_17_a', row: 9, col: 5 }],
    timeLimit: 120, hooks: ['heal', 'damaged'], captureNoisy: true });
  h.run(0.5);
  const u = h.unit(id), a = h.unit('chess_char_1_02_a'), b = h.unit('chess_char_4_17_a');
  assert.ok(a.findBuff(`cetsyr:mote:${u.id}`) && b.findBuff(`cetsyr:mote:${u.id}`), 'adjacent operators collect motes');
  // 萨卡兹 damage reduction
  const e = h.spawn('enemy_sarkaz', { pos: [12, 9] });
  const n0 = noisy(h, 'damaged').length;
  h.b.dealDamage(e, a, { amount: 1000, type: 'true' });
  approx(noisy(h, 'damaged')[n0].amount, 1000 * (1 - t1.damage_resistance), 1e-9);
  // the trait: 生命回复速度 (an hpRegen buff — PRTS 分支特性信息 吟游者; professions.js bardRegen), ×1.5 with a mote
  const trait = (x) => x.findBuff(`trait:bard:${u.id}`)?.mods.hpRegen ?? 0;
  h.run(0.3);
  approx(trait(a), u.s.atk * D(id).traitBb['attack@atk_to_hp_recovery_ratio'] * t0['attack@trait_mul'], 1e-6, 'trait ×1.5 with a mote');
  assert.equal(noisy(h, 'heal').filter((c) => c.source === u && c.target === a).length, 0, 'no heal of hers');
  // S3
  h.b.dealDamage(null, b, { amount: b.s.maxHp * 0.7, type: 'true' });
  assert.ok(u.skill.activate('test', { free: true }));
  h.run(0.3);
  approx(a.s.maxHp, a.base.maxHp + u.s.maxHp * bb.max_hp, 1e-6, '鼓舞');
  approx(u.s.maxHp, u.base.maxHp, 1e-9, 'not on herself');
  let redistributed = false;
  for (let i = 0; i < 90 && !redistributed; i++) { h.step(); redistributed = h.events.some((ev) => ev[0] === 'fx' && ev[1] === 'redistribute'); }
  assert.ok(redistributed);
  approx(a.hpRatio, b.hpRatio, 1e-9, 'equal HP ratios after redistribution');
  h.run(0.3);
  approx(trait(b), u.s.atk * bb['attack@atk_to_hp_recovery_ratio'] * (b.findBuff(`cetsyr:mote:${u.id}`) ? t0['attack@trait_mul'] : 1), 1e-6, 'trait 65 %');
  h.runUntil(() => !u.skill.active, 40);
  h.run(0.3);
  approx(a.s.maxHp, a.base.maxHp, 1e-9, '鼓舞 gone');
  checkInvariants(h.b);
});

test('魔王 elite module: ATK +8 % with ≥ 2 other operators in her normal range', () => {
  const id = 'chess_char_4_25_b';
  const mb = D(id).talents.find((t) => !t.name && t.bb.atk).bb;
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }, { chessId: 'chess_char_1_02_a', row: 10, col: 6 }, { chessId: 'chess_char_4_17_a', row: 9, col: 5 }], timeLimit: 10, hooks: [] });
  h.run(0.5);
  approx(h.unit(id).s.atk, h.unit(id).base.atk * (1 + mb.atk), 1e-9);
});

test('华法琳 S1: only fires on an ally below 50 %: +15 % of its max HP; 血液样本回收 +2 SP (self + random ally)', () => {
  const id = 'chess_char_4_26_a', bb = D(id).skill.bb, t0 = D(id).talents[0].bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 10, col: 4 }], timeLimit: 60, hooks: ['heal', 'skillStart'], captureNoisy: true });
  h.step();
  const u = h.unit(id), ally = h.unit('chess_char_1_02_a');
  u.skill.gainSp(u.skill.spCost);
  assert.equal(u.skill.charges, 1);
  h.b.dealDamage(null, ally, { amount: ally.s.maxHp * 0.3, type: 'true' });
  h.runUntil(() => noisy(h, 'heal').some((c) => c.source === u), 5);
  assert.equal(noisy(h, 'skillStart').filter((c) => c.unit === u).length, 0, 'not cast above 50 %');
  h.b.dealDamage(null, ally, { amount: ally.hp - ally.s.maxHp * 0.3, type: 'true' });
  h.runUntil(() => noisy(h, 'skillStart').some((c) => c.unit === u), 5);
  const extra = noisy(h, 'heal').filter((c) => c.source === u && c.target === ally).pop();
  approx(extra.amount, ally.s.maxHp * bb.hp_ratio * ally.s.healingTakenMul, 1e-6);
  // talent: an enemy dies in range
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  const s0 = u.skill.sp, a0 = ally.skill.sp;
  h.b.dealDamage(null, e, { amount: 1e9, type: 'true' });
  approx(u.skill.sp, Math.min(u.skill.spCost, s0 + t0['bldsk_t_1[self].sp']), 1e-9);
  approx(ally.skill.sp, Math.min(ally.skill.spCost, a0 + t0['bldsk_t_1[rand].sp']), 1e-9);
});

test('elite modules: 泥岩 −15 % from blocked enemies, 百炼嘉维尔 ×1.1 on blocked, 远牙 up to +15 % by distance, 缄默德克萨斯 lonely ATK +10 %', () => {
  // 泥岩
  {
    const id = 'chess_char_4_18_b', tb = D(id).traitBb;
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 30, hooks: ['damaged'], captureNoisy: true });
    h.step();
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    h.step();
    assert.equal(e.blockedBy, u);
    u.findBuff('mudrok:layers') && h.b.removeBuff(u, 'mudrok:layers');
    u.mem.layers = 0;
    const n0 = noisy(h, 'damaged').length;
    h.b.dealDamage(e, u, { amount: 1000, type: 'true' });
    approx(noisy(h, 'damaged')[n0].amount, 1000 * tb.damage_scale, 1e-9);
  }
  // 百炼嘉维尔
  {
    const id = 'chess_char_4_23_b', tb = D(id).traitBb;
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], timeLimit: 30, hooks: ['damaged'], captureNoisy: true });
    const u = h.unit(id);
    h.runUntil(() => dmgBy(h, u).length >= 1, 5);
    approx(dmgBy(h, u)[0].amount, u.s.atk * tb.atk_scale, 1e-6);
  }
  // 远牙
  {
    const id = 'chess_char_4_20_b', tb = D(id).traitBb;
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 2 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], timeLimit: 30, hooks: ['damaged'], captureNoisy: true });
    const u = h.unit(id);
    h.runUntil(() => dmgBy(h, u).length >= 1, 5);
    approx(dmgBy(h, u)[0].amount, u.s.atk * (1 + tb.damage_scale * Math.min(1, (4 - tb.min_dist) / (tb.max_dist - tb.min_dist))), 1e-6);
  }
  // 缄默德克萨斯
  {
    const id = 'chess_char_4_16_b', tb = D(id).traitBb, t0 = D(id).talents[0].bb;
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }, { chessId: 'chess_char_1_02_a', row: 12, col: 8 }], timeLimit: 30, hooks: [] });
    h.run(0.3);
    const u = h.unit(id);
    approx(u.s.atk, u.base.atk * (1 + t0.atk + tb.atk), 1e-9, 'alone');
    const g = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }, { chessId: 'chess_char_1_02_a', row: 10, col: 6 }], timeLimit: 30, hooks: [] });
    g.run(0.3);
    approx(g.unit(id).s.atk, g.unit(id).base.atk * (1 + t0.atk), 1e-9, 'neighbour');
  }
});

// --------------------------------------------------------------------------------------------------------------
// fidelity-verification regressions

test('缄默德克萨斯: a kill by the deploy burst itself (redeploy) ⇒ full heal + recast, no 剑术 buff', () => {
  const id = 'chess_char_4_16_a';
  const h = makeBattle({ defs: { enemies: { enemy_weak: dummy({ key: 'enemy_weak', hp: 50 }), enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }],
    timeLimit: 60, hooks: ['heal', 'damaged'], captureNoisy: true });
  h.step();
  const u = h.unit(id);
  h.spawn('enemy_weak', { pos: [9, 5] });
  assert.ok(h.runUntil(() => u.mem.texasKilled, 10), 'first deployment: first kill');
  h.b.retreat(u);
  assert.equal(u.mem.texasKilled, false, 'per-deployment state reset when she leaves');
  h.spawn('enemy_weak', { pos: [9, 5] });
  h.spawn('enemy_dummy', { pos: [10, 6] });
  const heals0 = noisy(h, 'heal').filter((c) => c.source === u && c.target === u).length;
  const bursts0 = dmgBy(h, u, (c) => c.dmg?.tags?.includes('burst')).length;
  assert.ok(h.b.redeploy(u));
  assert.equal(u.mem.texasKilled, true, 'the deploy burst scored the kill');
  assert.equal(u.findBuff('texas2:swordplay'), null, '剑术 is not granted after the kill');
  assert.equal(noisy(h, 'heal').filter((c) => c.source === u && c.target === u).length, heals0 + 1, 'full-heal attempt');
  // burst (2 hits × 2 enemies, the weak one dies on the first) + recast burst (2 hits on the survivor)
  assert.ok(dmgBy(h, u, (c) => c.dmg?.tags?.includes('burst')).length - bursts0 >= 4, 'passive re-released');
  checkInvariants(h.b);
});

test('耶拉 S2: against a lone enemy both drones lock it and ramp independently', () => {
  const id = 'chess_char_4_03_a', tr = D(id).traitBb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 120, hooks: ['damaged', 'attack'], captureNoisy: true, seed: 11 });
  h.step();
  const u = h.unit(id);
  h.spawn('enemy_dummy', { pos: [10, 4] });
  assert.ok(h.runUntil(() => u.skill.active, 60));
  const n0 = dmgBy(h, u).length;
  h.run(4);
  const hits = dmgBy(h, u).slice(n0);
  const byT = new Map();
  for (const c of hits) (byT.get(c.t) ?? byT.set(c.t, []).get(c.t)).push(c.amount / u.s.atk);
  const volleys = [...byT.values()];
  assert.ok(volleys.length >= 3);
  assert.ok(volleys.every((v) => v.length === 2), 'two drone hits per attack');
  approx(volleys[0][0], tr.init_atk_scale, 1e-6);
  approx(volleys[0][1], tr.init_atk_scale, 1e-6, 'second drone starts its own ramp');
  approx(volleys[1][1], tr.init_atk_scale + tr.delta_atk_scale, 1e-6);
  checkInvariants(h.b);
});

test('寒芒克洛丝: dodged shots neither count towards the 40 hits nor stun', () => {
  const id = 'chess_char_4_06_a';
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 60, hooks: ['statusApplied', 'dodge'], seed: 3 });
  h.step();
  const u = h.unit(id);
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  h.b.addBuff(e, { key: 'test:dodge', mods: { dodgePhys: 1 } });
  assert.ok(u.skill.activate('test', { free: true }));
  h.run(6);
  assert.ok(h.hooksOf('dodge').length >= 8, 'shots were fired and dodged');
  assert.equal(u.mem.kroosHits ?? 0, 0);
  assert.equal(h.hooksOf('statusApplied').filter((c) => c.status === 'stun').length, 0);
});

test('星熊 战术装甲: blocks only physical/arts damage (true damage always lands)', () => {
  const id = 'chess_char_4_17_a';
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 9, col: 5 }], timeLimit: 60, hooks: ['damaged'], captureNoisy: true, seed: 4 });
  h.step();
  const u = h.unit(id);
  const e = h.spawn('enemy_dummy', { pos: [12, 9] });
  const n0 = noisy(h, 'damaged').filter((c) => c.target === u).length;
  for (let i = 0; i < 40; i++) h.b.dealDamage(e, u, { amount: 1, type: 'true' });
  assert.equal(noisy(h, 'damaged').filter((c) => c.target === u).length - n0, 40);
  for (let i = 0; i < 80; i++) h.b.dealDamage(e, u, { amount: 1, type: 'arts' });
  const arts = noisy(h, 'damaged').filter((c) => c.target === u).length - n0 - 40;
  assert.ok(arts < 75 && arts > 45, `arts blocked ~25 %: ${arts}/80 landed`);
});

test('华法琳 血液样本回收: the random SP gift skips allies whose timed skill is running', () => {
  const id = 'chess_char_4_26_a';
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 10, col: 4 }], timeLimit: 60, hooks: [] });
  h.step();
  const ally = h.unit('chess_char_1_02_a');
  assert.ok(ally.skill.activate('test', { free: true }) && ally.skill.isTimed);
  const sp0 = ally.skill.sp;
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  h.b.dealDamage(null, e, { amount: 1e9, type: 'true' });
  assert.equal(ally.skill.sp, sp0, 'no SP while its skill runs');
});

test('瑰盐 S2 only defers damage taken by operators (summons take it in full)', () => {
  const id = 'chess_char_4_08_a', bb = D(id).skill.bb;
  const h = makeBattle({ units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 60, hooks: ['damaged'], captureNoisy: true });
  h.step();
  const u = h.unit(id);
  const tok = h.b.spawnToken(u, 'test_token', 10, 4, { def: { name: 'tok', stats: { maxHp: 5000, atk: 0, def: 0, magicResistance: 0, blockCnt: 0, baseAttackTime: 1, attackSpeed: 100 }, rangeGrid: [[0, 0]], profession: 'TOKEN' } });
  assert.ok(tok && u.rangeKeys.includes(tok.tileR * 21 + tok.tileC));
  assert.ok(u.skill.activate('test', { free: true }));
  const n0 = noisy(h, 'damaged').length;
  h.b.dealDamage(null, tok, { amount: 1000, type: 'true' });
  h.b.dealDamage(null, tok, { amount: 1000, type: 'phys' });
  assert.equal(noisy(h, 'damaged')[n0 + 1].amount, 1000, 'full damage on the summon');
  h.run(bb['attack@final_duration'] + 0.5);
  assert.equal(noisy(h, 'damaged').filter((c) => c.target === tok && c.dmg?.tags?.includes('hpLoss')).length, 0);
});

test('卡涅利安 S2: every enemy hit by the group attack is slowed', () => {
  const id = 'chess_char_4_24_a', bb = D(id).skill.bb;
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 60, hooks: ['statusApplied'] });
  h.step();
  const u = h.unit(id);
  const a = h.spawn('enemy_dummy', { pos: [10, 6] }), b = h.spawn('enemy_dummy', { pos: [11, 6] });
  u.skill.gainSp(u.skill.spCost); // one charge (uncharged cast)
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.run(3);
  for (const e of [a, b]) assert.ok(h.hooksOf('statusApplied').some((c) => c.target === e && c.status === 'sluggish' && c.duration === bb['attack@sluggish']), `enemy ${e.id}`);
});

test('elite (精锐) kits read the Lv7 blackboard: skill magnitudes differ from Lv4 and match the data', () => {
  const mk = (id, extra = {}) => {
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 3 }], timeLimit: 120, hooks: ['damaged', 'statusApplied', 'heal'], captureNoisy: true, seed: 5, ...extra });
    h.step();
    return [h, h.unit(id), D(id).skill.bb];
  };
  // stat skills: activate and compare
  for (const [id, check] of [
    ['chess_char_4_01_b', (u, bb) => { approx(u.s.atk, u.base.atk * (1 + bb.atk)); approx(u.s.def, u.base.def * (1 + bb.def)); }],
    ['chess_char_4_02_b', (u, bb) => approx(u.s.atk, u.base.atk * (1 + bb.atk))],
    ['chess_char_4_04_b', (u, bb) => approx(u.s.atk, u.base.atk * (1 + bb.atk))],
    ['chess_char_4_06_b', (u, bb) => approx(u.s.interval, u.base.bat + bb.base_attack_time)],
    ['chess_char_4_09_b', (u, bb) => approx(u.s.interval, (u.base.bat + bb.base_attack_time) * 100 / u.s.aspd)],
    ['chess_char_4_11_b', (u, bb) => approx(u.s.maxHp, u.base.maxHp * (1 + bb.max_hp))],
    ['chess_char_4_15_b', (u, bb) => approx(u.s.atk, u.base.atk * (1 + bb.atk))],
    ['chess_char_4_21_b', (u, bb) => approx(u.s.interval, u.base.bat + bb.base_attack_time)],
    ['chess_char_4_22_b', (u, bb) => approx(u.s.atk, u.base.atk * (1 + D('chess_char_4_22_b').talents[0].bb.atk + bb.atk))],
    ['chess_char_4_23_b', (u, bb) => approx(u.s.aspd, u.base.aspd + bb.attack_speed)],
  ]) {
    const [h, u, bb] = mk(id);
    assert.notDeepEqual(bb, D(id.replace(/_b$/, '_a')).skill.bb, `${id}: Lv7 blackboard differs`);
    assert.ok(u.skill.activate('test', { free: true }), id);
    check(u, bb);
    checkInvariants(h.b);
  }
  // charges: 风笛 ×2 at 160 %, 华法琳 ×3
  { const [, u, bb] = mk('chess_char_4_07_b'); assert.equal(u.skill.maxCharges, 2); assert.equal(bb.atk_scale, 1.6); }
  { const [, u, bb] = mk('chess_char_4_26_b'); assert.equal(u.skill.maxCharges, bb.ct); }
  // 灵知: 160 % and 3 s cold
  {
    const [h, u, bb] = mk('chess_char_4_13_b');
    const e = h.spawn('enemy_dummy', { pos: [10, 4] });
    assert.ok(h.runUntil(() => u.skill.activations >= 1, 20));
    approx(dmgBy(h, u, (c) => c.dmg?.tags?.includes('burst'))[0].amount, u.s.atk * bb.atk_scale);
    assert.ok(noisy(h, 'statusApplied').some((c) => c.target === e && c.status === 'cold' && c.duration === bb.cold));
  }
  // 莱恩哈特: 200 % and RES −12 %
  {
    const [h, u, bb] = mk('chess_char_4_14_b', { defs: { enemies: { enemy_dummy: dummy({ res: 50 }) } } });
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    assert.ok(h.runUntil(() => u.skill.activations >= 1, 30));
    approx(e.s.res, 50 * (1 + bb.magic_resistance));
  }
  // 录武官: 120 HP per hit taken
  {
    const [h, u, bb] = mk('chess_char_4_15_b', { units: [{ chessId: 'chess_char_4_15_b', row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 10, col: 4 }] });
    const ally = h.unit('chess_char_1_02_a');
    u.skill.activate('test', { free: true });
    h.b.dealDamage(null, ally, { amount: ally.s.maxHp * 0.4, type: 'true' });
    assert.ok(h.runUntil(() => ally.findBuff(`reckpr:guard:${u.id}`), 5));
    const n0 = noisy(h, 'heal').length;
    h.b.dealDamage(null, ally, { amount: 10, type: 'true' });
    const hl = noisy(h, 'heal').slice(n0).find((c) => c.source === u && c.target === ally);
    assert.equal(bb['attack@fixed_heal_value'], 120);
    approx(hl.amount, bb['attack@fixed_heal_value'] * ally.s.healingTakenMul * (ally.hpRatio < D('chess_char_4_15_b').traitBb.hp_ratio ? D('chess_char_4_15_b').traitBb.heal_scale : 1), 1e-6);
  }
  // 缄默德克萨斯: 3 rain targets for 7 s
  {
    const [h, u, bb] = mk('chess_char_4_16_b', { units: [{ chessId: 'chess_char_4_16_b', row: 10, col: 5 }] });
    for (const p of [[9, 4], [11, 6], [10, 4], [9, 6]]) h.spawn('enemy_dummy', { pos: p });
    h.b.retreat(u); h.b.redeploy(u);
    h.run(D('chess_char_4_16_b').skill.duration + 1.5);
    const waves = new Map();
    for (const c of dmgBy(h, u, (c) => c.dmg?.tags?.includes('swordRain'))) waves.set(c.t, (waves.get(c.t) ?? 0) + 1);
    assert.equal(waves.size, D('chess_char_4_16_b').skill.duration);
    assert.ok([...waves.values()].every((n) => n === bb.max_target));
  }
  // 歌蕾蒂娅 S3 tornado pulse on a weight-1 enemy √2 from the marked point (PRTS 推与拉): elite 中力 (1) = 受力等级 0 ⇒ all the
  // way to the point (its 0.05 急停); normal 小力 (0) = −1 ⇒ 35 % of the starting distance
  {
    const pulled = (id) => {
      const [h, u] = mk(id);
      h.spawn('enemy_dummy', { pos: [10, 6] });
      const side = h.spawn('enemy_dummy', { pos: [11, 7] });
      h.step();
      const x0 = side.x, y0 = side.y;
      u.skill.activate('test', { free: true });
      h.run(D(id).skill.bb.interval + 0.1);
      return Math.hypot(side.x - x0, side.y - y0);
    };
    approx(pulled('chess_char_4_12_b'), Math.SQRT2 - 0.05, 0.02);
    approx(pulled('chess_char_4_12_a'), 0.35 * Math.SQRT2, 0.02);
  }
});

test('焰尾 S3 dodge stacks independently with the 卡西米尔 aura (elite 80 % + 22 % ≈ 84 %, never 100 %)', () => {
  for (const id of ['chess_char_4_19_a', 'chess_char_4_19_b']) {
    const bb = D(id).skill.bb, q = D(id).talents[1].bb.prob;
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: id, row: 10, col: 5 }], timeLimit: 200, hooks: ['dodge', 'damaged'], seed: 21 });
    h.run(0.3);
    const u = h.unit(id);
    const e = h.spawn('enemy_dummy', { pos: [12, 9] });
    assert.ok(u.skill.activate('test', { free: true }));
    let landed = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) if (h.b.dealDamage(e, u, { amount: 1, type: i % 2 ? 'phys' : 'arts', isAttack: true }) > 0 || u.hp < u.s.maxHp) { landed++; u.hp = u.s.maxHp; }
    const physRate = 1 - (1 - bb.prob) * (1 - q), artsRate = bb.prob;
    const expected = N * (1 - (physRate + artsRate) / 2);
    assert.ok(Math.abs(landed - expected) < 0.06 * N, `${id}: ${landed} landed, ~${Math.round(expected)} expected`);
    assert.ok(landed > 0, 'never fully immune');
  }
});

test('凯瑟琳: a placed device serves the operator it faces and re-shields it after it redeploys on that tile', () => {
  const id = 'chess_char_4_11_a';
  const h = makeBattle({
    units: [
      { chessId: id, row: 10, col: 5, uid: 1 }, { chessId: 'chess_char_1_02_a', row: 9, col: 7, uid: 2 },
      { kind: 'token', tokenId: 'token_10041_cathy_catsld', ownerUid: 1, row: 9, col: 6, uid: 3, dir: 'RIGHT' },
    ],
    timeLimit: 200, hooks: [],
  });
  h.run(0.2);
  const u = h.unit(id), ally = h.unit('chess_char_1_02_a');
  const tb = h.b.data.getToken('token_10041_cathy_catsld', u.defId).talents[0].bb;
  const dev = h.b.allyUnits.find((x) => x.defId === 'token_10041_cathy_catsld' && x.alive);
  assert.ok(dev && dev.tileR === 9 && dev.tileC === 6, 'on its placed tile');
  assert.equal(dev.mem.target, ally, 'serves the operator in front of it');
  h.b.dealDamage(null, ally, { amount: 1e9, type: 'true' });
  assert.equal(ally.alive, false);
  assert.ok(h.runUntil(() => ally.alive, 150), 'redeployed');
  h.run(1.1);
  approx(ally.findBuff('cathy:shield')?.shield ?? 0, u.s.maxHp * tb.max_shield_ratio, 1e-6, 'full talent shield again');
});
