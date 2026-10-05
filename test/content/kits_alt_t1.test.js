// Tier 1 alternate skills & modules (DESIGN §16 operator loadouts; server/sim/content/kits/tier1.js `skills` maps).
// Every selectable non-default skill of every visible tier-1 chess runs a real battle — normal (Lv4) and elite (Lv7) —
// through the harness with its loadout (`skillIndex` / `moduleId` on the board entry, as a BattleSpec carries them),
// and its signature effect is asserted with numbers from that skill's own blackboard (data/chess.json skills[]).
// Non-default modules ('none' — every tier-1 elite has one module) are checked where the module changes behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';
import { loadoutOptions } from '../../shared/protocol.js';
import { kitCoverage } from '../../tools/kit-coverage.mjs';

const ds = getDefaultSource();
const raw = (id) => ds.rawChess(id);
/** SkillRecord `skillId` of chess `id` (its level's bb / duration / grid). */
const rec = (id, skillId) => {
  const r = raw(id).skills.find((s) => s.skillId === skillId);
  assert.ok(r, `${id} has ${skillId}`);
  return r;
};
const tal = (id, i = 0) => raw(id).talents.filter((t) => t.index !== -1)[i].bb;
const approx = (a, b, msg = '', rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
/** |a − b| ≤ tol (timings: skill start/end hooks fire inside ticks — allow ~1.5 ticks). */
const within = (a, b, tol = 0.05, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} ≈ ${b} ± ${tol}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const READY = { sp: 999 };
const HOOKS = ['damaged', 'heal', 'hit', 'skillStart', 'skillEnd', 'statusApplied', 'ammoUsed', 'attack', 'death', 'deploy'];
const run = (o) => makeBattle({ seed: 7, autoFinish: false, timeLimit: 400, hooks: HOOKS, captureNoisy: true, ...o });
/** defs.chess: the chess without its 特质 (garrisons have their own tests) — isolates kit numbers. */
const noGarrison = (...ids) => Object.fromEntries(ids.map((id) => [id, { ...raw(id), garrisonIds: [] }]));
/** Board entry of chess `id` carrying skill `skillId` (+ extra fields: module, tile, carry state). */
const entry = (id, skillId, o = {}) => ({ chessId: id, skillIndex: rec(id, skillId).index, ...o });
/** The unit of chess `id`, asserted to run the selected skill with its hand-authored spec. */
function sel(h, id, skillId) {
  const u = h.unit(id);
  assert.ok(u, `${id} on the board`);
  assert.equal(u.skill.id, skillId, `${id} carries ${skillId}`);
  assert.equal(u.kit.skillSource, 'skills', `${id} ${skillId}: hand-authored spec`);
  return u;
}
const dealt = (h, u, f = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && f(c));
const heals = (h, u, f = () => true) => h.hooksOf('heal').filter((c) => c.source === u && f(c));
const attacks = (h, u, f = () => true) => h.hooksOf('attack').filter((c) => c.attacker === u && f(c));
const statuses = (h, key, f = () => true) => h.hooksOf('statusApplied').filter((c) => c.status === key && f(c));
const started = (h, u) => h.hooksOf('skillStart').filter((c) => c.unit === u);
const ended = (h, u) => h.hooksOf('skillEnd').filter((c) => c.unit === u);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
const pair = (n) => [`chess_char_1_${n}_a`, `chess_char_1_${n}_b`];

// =================================================================================================================
// coverage

test('tier 1: every selectable skill of every visible chess has a hand-authored spec (normal + elite)', () => {
  const rep = kitCoverage({ tier: 1 });
  assert.equal(rep.summary.chess, 16);
  assert.equal(rep.summary.covered, rep.summary.skills, rep.chess.flatMap((r) => r.skills.filter((s) => !s.covered).map((s) => `${r.name} S${s.index + 1}`)).join(', '));
  assert.equal(rep.summary.chessFullyCovered, rep.summary.chess);
});

test('tier 1: every chess × every legal skill × module (default / none) fights 30 s with its authored spec, no content errors', () => {
  const bases = ds.chessIds().filter((id) => /^chess_char_1_\d+_a$/.test(id) && raw(id).visible);
  assert.equal(bases.length, 16);
  for (const base of bases) {
    const gold = base.replace(/_a$/, '_b');
    const opt = loadoutOptions(raw(base), raw(gold));
    for (const skillIndex of opt.skills) {
      for (const [id, moduleId] of [[base, undefined], [gold, undefined], [gold, 'none']]) {
        const h = makeBattle({
          stageId: 'act2autochess_m04', seed: 5,
          defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 20000, atk: 300, bat: 2, speed: 0.6 }) } },
          units: [{ chessId: id, row: 9, col: 7, skillIndex, ...(moduleId ? { moduleId } : {}) }, { chessId: 'chess_char_1_02_a', row: 9, col: 4 }, { chessId: 'chess_char_2_14_a', row: 10, col: 5 }],
          enemies: [{ key: 'enemy_dummy', count: 4, interval: 2 }, { key: 'enemy_dummy', route: 1, count: 2, interval: 3 }],
          timeLimit: 60,
        });
        h.run(30);
        const u = h.unit(id);
        const tag = `${id} S${skillIndex + 1} ${moduleId ?? 'default module'}`;
        assert.equal(u.def.loadout.skillIndex, skillIndex, tag);
        assert.ok(['skills', undefined].includes(u.kit.skillSource), `${tag}: ${u.kit.skillSource}`);
        if (moduleId === 'none') assert.equal(u.def.raw.module.active, false, tag);
        checkInvariants(h.b);
        assert.equal(h.b.errors.length, 0, `${tag}: ${JSON.stringify(h.b.errors[0])}`);
      }
    }
  }
});

// =================================================================================================================
// alternate skills (normal Lv4 + elite Lv7)

test('1_01 隐现 S1 “不惹麻烦”: attack@trigger_time rounds of attack@atk_scale × ATK physical, then it ends', () => {
  for (const id of pair('01')) {
    const s = rec(id, 'skchr_inside_1'), bb = s.bb;
    const h = run({
      defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 6] }],
    });
    const u = sel(h, id, s.skillId);
    assert.equal(u.skill.kind, 'ammo');
    assert.ok(h.runUntil(() => u.skill.activations === 1 && !u.skill.active, 15));
    h.run(0.5); // the last round is still in flight
    assert.equal(h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, bb['attack@trigger_time'], `${id} rounds`);
    const shots = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.equal(shots.length, bb['attack@trigger_time']);
    for (const c of shots) { assert.equal(c.type, 'phys'); approx(c.amount, u.s.atk * bb['attack@atk_scale'], `${id} shot`); }
    assert.equal(u.s.taunt, 0, 'no taunt change (S2 only)');
    done(h);
    // 火力支援 (弹药类技能): after `duration` s on the field the S1 magazine is +self_ammo too
    const t = tal(id);
    const mags = [];
    const h2 = run({
      defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 10, col: 4 })],
      enemies: [{ key: 'e', pos: [10, 6] }],
      setup: (b) => b.on('skillStart', (c) => mags.push({ t: b.time, ammo: c.skill.ammoLeft }), { priority: -500 }),
    });
    const u2 = sel(h2, id, s.skillId);
    assert.ok(h2.runUntil(() => mags.some((m) => m.t >= t.duration), 120));
    assert.ok(mags.filter((m) => m.t < t.duration).every((m) => m.ammo === bb['attack@trigger_time']));
    assert.equal(mags.find((m) => m.t >= t.duration).ammo, bb['attack@trigger_time'] + t.self_ammo, `${id} +self_ammo`);
    assert.equal(u2.skill.id, s.skillId);
    done(h2);
  }
});

test('1_02 角峰 S1 体能强化: TAKE_DAMAGE (TANK S1) — HP +max_hp, +hp_recovery_per_sec HP per second', () => {
  for (const id of pair('02')) {
    const s = rec(id, 'skchr_yak_1'), bb = s.bb;
    assert.equal(s.trigger.rule, 'TAKE_DAMAGE');
    const h = run({
      defs: { enemies: { e: dummy('e', { atk: 400, bat: 1.5 }) }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 9, col: 5, carryState: READY })],
      enemies: [{ key: 'e', pos: [9, 5] }],
    });
    const u = sel(h, id, s.skillId);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    assert.equal(started(h, u)[0].reason, 'TAKE_DAMAGE');
    approx(u.s.maxHp, u.base.maxHp * (1 + bb.max_hp), `${id} HP`);
    approx(u.s.def, u.base.def, 'DEF unchanged (抗寒体质 only)');
    approx(u.s.hpRegen, u.base.hpRecoveryPerSec + bb.hp_recovery_per_sec, 'regen');
    u.hp = u.s.maxHp * 0.5;
    const t0 = h.b.time;
    h.run(3);
    const regen = heals(h, u, (c) => c.target === u && c.opts?.regen && c.t > t0).reduce((n, c) => n + c.amount, 0);
    assert.ok(Math.abs(regen - 3 * bb.hp_recovery_per_sec) <= 2, `${id} regenerated ${regen}`);
    h.runUntil(() => !u.skill.active, 40);
    within(ended(h, u)[0].t - started(h, u)[0].t, s.duration, 0.05, 'duration');
    done(h);
  }
});

test('1_03 惊蛰 S1 攻击力强化·γ型: ATK +atk and the chain keeps its falloff (unlike 初雷)', () => {
  for (const id of pair('03')) {
    const s = rec(id, 'skcom_atk_up[3]'), t = tal(id);
    const h = run({
      defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 6] }],
    });
    const u = sel(h, id, s.skillId);
    h.runUntil(() => dealt(h, u).length >= 3, 10);
    assert.ok(u.skill.active);
    approx(u.s.atk, u.base.atk * (1 + s.bb.atk), `${id} ATK`);
    const f = u.profile.chain.falloff;
    assert.ok(f > 0);
    const a = dealt(h, u).slice(0, 3).map((c) => c.amount);
    approx(a[0], u.s.atk * t.atk_scale, 'primary');
    approx(a[1], u.s.atk * t.atk_scale * (1 - f), 'jump 1 loses damage');
    approx(a[2], u.s.atk * t.atk_scale * (1 - f) ** 2, 'jump 2');
    done(h);
  }
});

test('1_04 深巡 S1 侵袭破坏应对: TAKE_DAMAGE — ATK/DEF +x, normal single-target attacks in the normal range', () => {
  for (const id of pair('04')) {
    const s = rec(id, 'skchr_udflow_1');
    assert.equal(s.trigger.rule, 'TAKE_DAMAGE');
    const h = run({
      defs: { enemies: { e: dummy('e'), a: dummy('a', { atk: 300 }) }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 9, col: 4, carryState: READY })],
      enemies: [{ key: 'a', pos: [9, 4] }, { key: 'e', pos: [9, 5] }, { key: 'e', pos: [9, 6] }],
    });
    const u = sel(h, id, s.skillId);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    assert.equal(started(h, u)[0].reason, 'TAKE_DAMAGE');
    approx(u.s.atk, u.base.atk * (1 + s.bb.atk), 'ATK');
    approx(u.s.def, u.base.def * (1 + s.bb.def), 'DEF');
    assert.deepEqual([...u.rangeKeys].sort(), [...u.baseRangeKeys].sort(), 'range unchanged');
    const t0 = h.b.time;
    h.run(4);
    const atks = attacks(h, u, (c) => c.t > t0);
    assert.ok(atks.length > 0 && atks.every((c) => c.targets.length === 1), 'no piercing darts');
    done(h);
  }
});

test('1_06 刺玫 S1 战术咏唱·γ型: ASPD +attack_speed; the trait heal goes to the most injured ally, nobody is taunted', () => {
  for (const id of pair('06')) {
    const s = rec(id, 'skcom_magic_rage[3]');
    const ally = chessRec({ id: 't_ally', profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: null, stats: { maxHp: 5000 } });
    const h = run({
      defs: { enemies: { e: dummy('e') }, chess: { ...noGarrison(id), t_ally: ally } },
      units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY }), { chessId: 't_ally', row: 10, col: 5 }],
      enemies: [{ key: 'e', pos: [10, 7] }],
    });
    const u = sel(h, id, s.skillId), a = h.unit('t_ally');
    h.step();
    a.hp = a.s.maxHp * 0.3;
    assert.ok(h.runUntil(() => heals(h, u).length >= 2, 10));
    assert.ok(u.skill.active);
    approx(u.s.aspd, u.base.aspd + s.bb.attack_speed, `${id} ASPD`);
    assert.ok(heals(h, u).every((c) => c.target === a), 'most injured ally healed');
    assert.equal(a.findBuff('vendla:taunt'), null, 'no taunt (荆藤庇荫 only)');
    assert.equal(dealt(h, u, (c) => c.dmg.tags?.includes('counter')).length, 0);
    done(h);
  }
});

test('1_07 普罗旺斯 S2 杀戮嗅觉: ATK +atk; normal attacks skip enemies above 80 % HP; holds fire with only those', () => {
  for (const id of pair('07')) {
    const s = rec(id, 'skchr_prove_2'), t = tal(id);
    // (a) a full-HP enemy in front and a wounded one behind it: every skill attack goes to the wounded one
    const h = run({
      defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }],
    });
    const u = sel(h, id, s.skillId);
    h.step();
    const [full, hurt] = h.enemies().sort((x, y) => x.x - y.x);
    hurt.hp = hurt.s.maxHp * 0.5;
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const atk = u.s.atk;
    approx(atk, u.base.atk * (1 + s.bb.atk), `${id} ATK`);
    h.runUntil(() => !u.skill.active, 40);
    const [st, en] = [started(h, u)[0].t, ended(h, u)[0].t];
    within(en - st, s.duration, 0.05, 'duration');
    const during = dealt(h, u, (c) => c.dmg.isAttack && c.t >= st && c.t < en);
    assert.ok(during.length >= 5);
    assert.ok(during.every((c) => c.target === hurt), 'only the ≤ 80 % enemy is targeted');
    // 狼眼 is S1: the damage is ATK (×狩猎箭头 on procs), never raised by the target's missing HP
    for (const c of during) assert.ok([1, t.atk_scale].some((k) => Math.abs(c.amount - atk * k) < 1e-6 * c.amount + 1e-6), `${c.amount}`);
    done(h);
    // (b) only a full-HP enemy: the skill starts (enemy in range) but she holds her fire until it ends
    const h2 = run({
      defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 6] }],
    });
    const u2 = sel(h2, id, s.skillId);
    assert.ok(h2.runUntil(() => u2.skill.active, 5));
    const t0 = h2.b.time;
    h2.runUntil(() => !u2.skill.active, 40);
    const t1 = ended(h2, u2)[0].t;
    assert.equal(attacks(h2, u2, (c) => c.t > t0 && c.t < t1).length, 0, 'no attack at a > 80 % HP enemy');
    h2.run(3);
    assert.ok(attacks(h2, u2, (c) => c.t >= t1).length > 0, 'attacks again after the skill');
    done(h2);
  }
});

test('1_08 德克萨斯 S1 冲锋号令·γ型 (AUTO): +cost DP as soon as SP is full — no enemy needed, no damage', () => {
  for (const id of pair('08')) {
    const s = rec(id, 'skcom_charge_cost[3]'), t = tal(id);
    const h = run({ flags: { dpPerSec: 0 }, defs: { chess: noGarrison(id) }, units: [entry(id, s.skillId, { row: 9, col: 5 })] });
    const u = sel(h, id, s.skillId);
    h.step();
    const p = h.b.getPlayer('p1');
    const dp0 = p.dp;
    approx(dp0, h.b.flags.dpInit + t.cost, 'initial DP (+战术快递)');
    assert.ok(h.runUntil(() => u.skill.activations === 1, 60));
    const st = started(h, u)[0];
    assert.equal(st.reason, 'SP_FULL');
    approx(st.t, (s.spCost - s.initSp) / u.s.spRecovery, 'fires when SP is full', 0.02);
    approx(p.dp, dp0 + s.bb.cost, `${id} +${s.bb.cost} DP`);
    assert.equal(dealt(h, u).length, 0);
    assert.equal(statuses(h, 'stun').length, 0, 'no 剑雨');
    done(h);
  }
});

test('1_09 跃跃 S1 强力击·β型: every (cost+1)-th attack hits at atk_scale × ATK', () => {
  for (const id of pair('09')) {
    const s = rec(id, 'skchr_caper_1'), t = tal(id);
    const h = run({
      defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 10, col: 3, carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 6] }],
    });
    const u = sel(h, id, s.skillId);
    assert.ok(h.runUntil(() => attacks(h, u).length >= s.spCost + 2, 30));
    h.run(0.5); // boomerangs in flight
    const flags = attacks(h, u).slice(0, s.spCost + 2).map((c) => !!c.isSkill);
    assert.deepEqual(flags, [true, ...Array(s.spCost).fill(false), true], `${id}: skill attack, ${s.spCost} normal ones, skill attack`);
    const hits = dealt(h, u, (c) => c.dmg.isAttack);
    const skillHits = hits.filter((c) => c.dmg.isSkill);
    assert.ok(skillHits.length >= 2);
    const ok = (c, k) => [1, t.atk_scale].some((p) => Math.abs(c.amount - u.s.atk * k * p) < 1e-6 * c.amount + 1e-6);
    for (const c of skillHits) assert.ok(ok(c, s.bb.atk_scale), `skill hit ${c.amount}`);
    for (const c of hits.filter((x) => !x.dmg.isSkill)) assert.ok(ok(c, 1), `normal hit ${c.amount}`);
    done(h);
  }
});

test('1_10 古米 S2 食粮烹制: disarm s cooking (no attacks, DEF +def), then heals in the skill grid (ATK +atk, interval +130 %)', () => {
  for (const id of pair('10')) {
    const s = rec(id, 'skchr_sunbr_2'), bb = s.bb, tb = raw(id).trait.bb;
    const ally = chessRec({ id: 't_ally', profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: null, stats: { maxHp: 20000 } });
    const h = run({
      // a MANUAL 重装 skill: the TAKE_DAMAGE strategy (PRTS 卫戍协议/帮助 "不受技能范围影响，受到伤害时释放技能")
      defs: { enemies: { e: dummy('e', { atk: 300, bat: 1 }) }, chess: { ...noGarrison(id), t_ally: ally } },
      units: [entry(id, s.skillId, { row: 9, col: 5, carryState: READY }), { chessId: 't_ally', row: 10, col: 6 }],
      enemies: [{ key: 'e', pos: [9, 5] }],
    });
    const u = sel(h, id, s.skillId), a = h.unit('t_ally');
    h.step();
    a.hp = a.s.maxHp * 0.3;
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const st = started(h, u)[0].t;
    assert.equal(started(h, u)[0].reason, 'TAKE_DAMAGE');
    approx(u.s.def, u.base.def * (1 + bb.def), `${id} cooking DEF`);
    approx(u.s.atk, u.base.atk, 'no ATK while cooking');
    h.runUntil(() => h.b.time >= st + bb.disarm - 0.2, 20);
    assert.equal(attacks(h, u, (c) => c.t >= st).length, 0, 'no attack while cooking');
    assert.ok(h.runUntil(() => heals(h, u).length > 0, 5));
    const first = heals(h, u)[0];
    assert.ok(first.t >= st + bb.disarm - 1e-6, 'heals once cooking is done');
    assert.equal(first.target, a);
    approx(u.s.atk, u.base.atk * (1 + bb.atk), 'served: ATK +atk');
    approx(u.s.def, u.base.def, 'served: DEF back');
    approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd, 'interval +130 %');
    const k = tb.hp_ratio != null ? tb.heal_scale : 1; // elite module GUA-X below 50 % HP
    approx(first.amount, u.s.atk * k, `${id} heal`);
    h.runUntil(() => !u.skill.active, 60);
    within(ended(h, u)[0].t - st, bb.disarm + s.duration, 0.05, 'real duration = disarm + duration');
    assert.equal(dealt(h, u, (c) => c.t > st && c.t < ended(h, u)[0].t).length, 0, 'no damage dealt during the skill');
    done(h);
  }
});

test('1_12 艾丝黛尔 S1 攻击力强化·β型: ATK +atk (time SP) and she can still be healed', () => {
  for (const id of pair('12')) {
    const s = rec(id, 'skcom_atk_up[2]');
    const h = run({ defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) }, units: [entry(id, s.skillId, { row: 9, col: 5, carryState: READY })], enemies: [{ key: 'e', pos: [9, 6] }] });
    const u = sel(h, id, s.skillId);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.spType, 'time');
    approx(u.s.atk, u.base.atk * (1 + s.bb.atk), `${id} ATK`);
    u.hp = u.s.maxHp * 0.5;
    assert.ok(h.b.heal(null, u, 100) > 0, 'a heal target (舍身突击 only forbids it)');
    done(h);
  }
});

test('1_13 波登可 S1 花香疗法: a heal skill — ATK +atk, attacks heal the most injured ally; fires with no enemy, never without injured', () => {
  for (const id of pair('13')) {
    const s = rec(id, 'skchr_podego_1');
    const ally = chessRec({ id: 't_ally', profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: null, stats: { maxHp: 20000 } });
    const defs = { enemies: { e: dummy('e') }, chess: { ...noGarrison(id), t_ally: ally } };
    // (a) enemy and injured ally in range: heals only, for ATK
    const h = run({ defs, units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY }), { chessId: 't_ally', row: 10, col: 5 }], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = sel(h, id, s.skillId), a = h.unit('t_ally');
    h.step();
    a.hp = a.s.maxHp * 0.3;
    assert.ok(h.runUntil(() => heals(h, u).length >= 2, 10));
    assert.ok(u.skill.active);
    approx(u.s.atk, u.base.atk * (1 + s.bb.atk + tal(id).atk), `${id} ATK (+园丁 on herself, a 【辅助】)`);
    for (const c of heals(h, u)) { assert.equal(c.target, a); approx(c.amount, u.s.atk, 'heal = ATK'); }
    const st = started(h, u)[0].t;
    h.runUntil(() => !u.skill.active, 40);
    within(ended(h, u)[0].t - st, s.duration, 0.05, 'duration');
    assert.equal(attacks(h, u, (c) => c.t > st && c.t < ended(h, u)[0].t && c.targets.some((x) => x.side === 'enemy')).length, 0, 'no attack on enemies');
    done(h);
    // (b) no enemy on the field: an injured ally in range is enough
    const h2 = run({ defs, units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY }), { chessId: 't_ally', row: 10, col: 5 }] });
    const u2 = sel(h2, id, s.skillId);
    h2.step();
    h2.unit('t_ally').hp = 5000;
    assert.ok(h2.runUntil(() => heals(h2, u2).length > 0, 5), 'heals without an enemy');
    assert.equal(started(h2, u2)[0].reason, 'DEFAULT');
    done(h2);
    // (c) an enemy but nobody injured: the heal skill waits
    const h3 = run({ defs, units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY }), { chessId: 't_ally', row: 10, col: 5 }], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u3 = sel(h3, id, s.skillId);
    h3.run(6);
    assert.equal(u3.skill.activations, 0);
    assert.ok(dealt(h3, u3, (c) => c.dmg.isAttack).length > 0, 'keeps attacking the enemy');
    done(h3);
  }
});

test('1_14 格雷伊 S1 战术咏唱·β型: ASPD +attack_speed; the talent 停顿 keeps its length (no ×talent_scale)', () => {
  for (const id of pair('14')) {
    const s = rec(id, 'skcom_magic_rage[2]'), t = tal(id);
    const h = run({ defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) }, units: [entry(id, s.skillId, { row: 10, col: 4, carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = sel(h, id, s.skillId);
    assert.ok(h.runUntil(() => u.skill.active && statuses(h, 'sluggish', (c) => c.source === u).length > 0, 10));
    approx(u.s.aspd, u.base.aspd + s.bb.attack_speed, `${id} ASPD`);
    for (const c of statuses(h, 'sluggish', (x) => x.source === u)) approx(c.duration, t.sluggish, '停顿');
    done(h);
  }
});

test('1_17 深靛 S1 灯塔守卫者: skill range, attack interval ×0.2 (−80 %), attack@atk_scale × ATK arts per hit, 4 s', () => {
  for (const id of pair('17')) {
    const s = rec(id, 'skchr_indigo_1'), bb = s.bb;
    const h = run({
      defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 10, col: 3, carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }],
      // 柔光缚目 binds are tested with S2: here bound enemies would stop being targets
      setup: (b) => b.on('beforeStatus', (c) => { if (c.status === 'bind') c.cancel = true; }),
    });
    const u = sel(h, id, s.skillId);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const st = h.b.time;
    assert.deepEqual([...u.rangeKeys].sort((x, y) => x - y), absoluteRangeKeys(s.rangeGrid, u.tileR, u.tileC, u.dir, 0).sort((x, y) => x - y), 'skill range');
    approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd, `${id} interval ×0.2`);
    h.runUntil(() => !u.skill.active, 10);
    within(h.b.time - st, s.duration, 0.05, 'duration');
    h.run(0.5); // bolts in flight
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.ok(hits.length >= Math.floor(s.duration / (u.base.bat * (1 + bb.base_attack_time))) - 1, `${hits.length} hits in ${s.duration} s`);
    for (const c of hits) { assert.equal(c.type, 'arts'); approx(c.amount, u.s.atk * bb['attack@atk_scale'], 'hit'); }
    assert.deepEqual([...u.rangeKeys].sort(), [...u.baseRangeKeys].sort(), 'range restored');
    done(h);
  }
});

test('1_18 宴 S1 分神: no attacks, block 0 (releases), DEF +def, regenerates hp ratio × max HP per s (under 武者 no-heal)', () => {
  for (const id of pair('18')) {
    const s = rec(id, 'skchr_utage_1'), bb = s.bb;
    const h = run({
      defs: { enemies: { e: dummy('e', { atk: 1 }) }, chess: noGarrison(id) },
      units: [entry(id, s.skillId, { row: 9, col: 5, carryState: READY })],
      enemies: [{ key: 'e', pos: [9, 5] }],
    });
    const u = sel(h, id, s.skillId);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const st = h.b.time;
    const e = h.enemies()[0];
    assert.equal(u.s.blockCnt, 0);
    assert.equal(u.blocking.length, 0);
    assert.equal(e.blockedBy, null, 'blocked enemy released');
    h.b.dealDamage(u, e, { amount: 100, type: 'phys', isAttack: true });
    assert.equal(dealt(h, u).at(-1).type, 'phys', 'active S1 does not inherit S2 arts conversion');
    approx(u.s.def, u.base.def * (1 + bb.def), `${id} DEF`);
    approx(u.s.hpRegen, u.s.maxHp * bb.hp_recovery_per_sec_by_max_hp_ratio, 'regen');
    u.hp = u.s.maxHp * 0.3;
    const hp0 = u.hp;
    h.run(2);
    assert.equal(e.blockedBy, null, 'blocks nothing while the skill runs');
    assert.ok(u.hp - hp0 >= 2 * u.s.maxHp * bb.hp_recovery_per_sec_by_max_hp_ratio - 50, `${id} regenerates (${u.hp - hp0})`);
    h.runUntil(() => !u.skill.active, 20);
    const en = ended(h, u)[0].t;
    within(en - started(h, u)[0].t, s.duration, 0.05, 'duration');
    assert.equal(attacks(h, u, (c) => c.t > st && c.t < en).length, 0, 'stops attacking');
    assert.ok(u.s.blockCnt >= 1, 'block restored');
    h.run(3);
    assert.ok(attacks(h, u, (c) => c.t >= en).length > 0, 'attacks again');
    done(h);
  }
});

test('1_18 宴 S2: deployment loses current HP once; ATK and normal-attack arts conversion end with the duration', () => {
  for (const id of pair('18')) {
    const s = rec(id, 'skchr_utage_2'), bb = s.bb;
    const h = run({ defs: { chess: noGarrison(id), enemies: { e: dummy('e') } },
      units: [entry(id, s.skillId, { row: 10, col: 4, carryState: { hpPct: 0.5, skillActive: true } })] });
    h.b.start();
    const u = h.unit(id);
    assert.equal(u.skill.kind, 'duration');
    assert.equal(u.skill.activations, 1);
    assert.equal(u.skill.charges, 0);
    approx(u.hp, u.s.maxHp * 0.5 * (1 - bb.hp_ratio), 'one loss from carried current HP');
    approx(u.s.atk, u.base.atk * (1 + bb.atk));
    const e = h.spawn('e', { pos: [10, 8] });
    const hit = () => { h.b.dealDamage(u, e, { amount: 100, type: 'phys', isAttack: true }); return dealt(h, u).at(-1); };
    assert.equal(hit().type, 'arts');
    assert.ok(!hit().dmg.isSkill, 'normal attack marker retained');
    h.run(bb.duration / 2);
    approx(u.skill.timeLeft, bb.duration / 2);
    h.run(bb.duration / 2 + 0.1);
    assert.equal(u.skill.active, false);
    assert.equal(u.skill.ready, false);
    approx(u.s.atk, u.base.atk);
    assert.equal(hit().type, 'phys');
    assert.deepEqual(ended(h, u).map((c) => c.reason), ['duration']);
    const hp = u.hp;
    h.run(3);
    approx(u.hp, hp, 'no second loss while staying deployed');
    h.b.retreat(u);
    assert.ok(h.b.redeploy(u, { free: true }));
    assert.equal(u.skill.activations, 2);
    approx(u.hp, u.s.maxHp * (1 - bb.hp_ratio), 'new deployment loses current HP once');
    done(h);
  }
});

test('1_19 野鬃 S1 骑枪刺击: ASPD +attack_speed for `duration` s after every deployment', () => {
  for (const id of pair('19')) {
    const s = rec(id, 'skchr_wildmn_1');
    const h = run({ defs: { chess: noGarrison(id) }, units: [entry(id, s.skillId, { row: 9, col: 5 })] });
    const u = sel(h, id, s.skillId);
    h.b.start();
    assert.equal(u.skill.kind, 'duration');
    assert.equal(u.skill.active, true);
    assert.equal(u.skill.activations, 1);
    assert.equal(u.skill.charges, 0);
    assert.equal(u.skill.ready, false);
    assert.equal(started(h, u)[0].reason, 'deploy');
    approx(u.s.aspd, u.base.aspd + s.bb.attack_speed, `${id} ASPD after deployment`);
    h.run(s.duration / 2);
    approx(u.skill.timeLeft, s.duration / 2);
    assert.deepEqual(h.snapshot().units.find((t) => t[0] === u.id).slice(5, 7), [s.duration / 2, s.duration]);
    h.run(s.duration / 2 - 0.5);
    approx(u.s.aspd, u.base.aspd + s.bb.attack_speed, 'still up');
    h.run(1);
    approx(u.s.aspd, u.base.aspd, `expired after ${s.duration} s`);
    assert.equal(u.skill.active, false);
    assert.equal(u.skill.ready, false);
    assert.deepEqual(ended(h, u).map((c) => c.reason), ['duration']);
    h.b.kill(u, null);
    h.step();
    assert.ok(h.b.redeploy(u, { free: true }));
    h.step();
    approx(u.s.aspd, u.base.aspd + s.bb.attack_speed, 'again after the redeployment');
    assert.equal(u.skill.activations, 2);
    assert.equal(ended(h, u).length, 1, 'expired skill does not end again on death');
    done(h);
  }
});

test('1_20 雷蛇 S1 充能防御: 自动触发 "技能自动开启" (SP_FULL, no 技能策略) — DEF +def for bb.duration s; the next hit is blocked (no 战术防御 SP from it)', () => {
  for (const id of pair('20')) {
    const s = rec(id, 'skchr_liskam_1'), bb = s.bb, t = tal(id);
    const mate = chessRec({ id: 't_mate', profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: { spType: 'INCREASE_WHEN_ATTACK', spCost: 200 } });
    const h = run({
      defs: { enemies: { a: dummy('a', { atk: 700, bat: 1 }) }, chess: { ...noGarrison(id), t_mate: mate } },
      units: [entry(id, s.skillId, { row: 9, col: 4, carryState: READY }), { chessId: 't_mate', row: 10, col: 4 }],
      enemies: [{ key: 'a', pos: [9, 4], time: 1 }], // arrives after the skill is on (it needs no hit to start)
    });
    const u = sel(h, id, s.skillId), m = h.unit('t_mate');
    assert.ok(h.runUntil(() => u.skill.active, 10));
    const st = h.b.time;
    assert.equal(started(h, u)[0].reason, 'SP_FULL');
    assert.ok(st < 0.5, 'on as soon as it is ready, before any hit');
    approx(u.s.def, u.base.def * (1 + bb.def), `${id} DEF`);
    const hp = u.hp;
    const sp = m.skill.sp;
    assert.ok(h.runUntil(() => h.hooksOf('hit').some((c) => c.target === u && c.t > st), 5));
    h.step();
    const blocked = h.hooksOf('hit').filter((c) => c.target === u && c.t > st);
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].dmg.cancel, true, 'the next hit is blocked');
    assert.equal(u.hp, hp, 'no HP lost');
    assert.equal(m.skill.sp, sp, 'a blocked hit gives no 战术防御 SP');
    h.runUntil(() => h.hooksOf('hit').filter((c) => c.target === u && c.t > st).length >= 2, 5);
    h.step();
    assert.equal(h.hooksOf('hit').filter((c) => c.target === u && c.t > st)[1].dmg.cancel, false, 'only one hit blocked');
    assert.ok(u.hp < hp);
    approx(m.skill.sp, sp + t.sp, 'the following hit feeds the talent again');
    h.runUntil(() => !u.skill.active, 20);
    within(h.b.time - st, bb.duration, 0.05, 'duration');
    approx(u.s.def, u.base.def, 'DEF back');
    done(h);
  }
});

// =================================================================================================================
// modules: every tier-1 elite has one module; 'none' is the non-default choice

test('modules: 无模组 stats = statsBase; the default module adds its attr', () => {
  for (const base of ds.chessIds().filter((id) => /^chess_char_1_\d+_a$/.test(id) && raw(id).visible)) {
    const id = base.replace(/_a$/, '_b');
    const r = raw(id);
    assert.equal(r.modules.length, 1, id);
    const h = run({ units: [{ chessId: id, row: 9, col: 4, uid: 1 }, { chessId: id, row: 10, col: 4, uid: 2, moduleId: 'none' }] });
    const [dm, nm] = [h.unit(1), h.unit(2)];
    for (const k of ['maxHp', 'atk', 'def', 'res', 'blockCnt', 'cost', 'respawnTime']) {
      approx(nm.base[k], r.statsBase[k], `${id} none ${k}`);
      approx(dm.base[k], r.statsBase[k] + (r.modules[0].attr[k] ?? 0), `${id} default ${k}`);
    }
    assert.equal(nm.def.raw.module.active, false);
    done(h);
  }
});

test('modules: profile traits follow the module (隐现 air ×1.1, 惊蛰 chain, 刺玫 heal ratio, 深靛 store, 野鬃 DP, 角峰 block)', () => {
  const cases = [
    ['01', (u) => u.profile.flyScale, 1.1, 1],
    ['03', (u) => [u.profile.chain.count, +u.profile.chain.falloff.toFixed(6), u.profile.chain.sluggish].join('/'), [4, 0.1, 0.8].join('/'), [4, 0.15, 0.5].join('/')],
    ['06', (u) => u.profile.healRatio, 0.6, 0.5],
    ['17', (u) => u.profile.storeMax, 4, 3],
    ['19', (u) => u.profile.dpOnKill, 2, 1],
    ['02', (u) => u.s.blockCnt, 4, 3],
  ];
  for (const [n, get, withMod, without] of cases) {
    const id = `chess_char_1_${n}_b`;
    const h = run({ units: [{ chessId: id, row: 9, col: 4, uid: 1 }, { chessId: id, row: 10, col: 4, uid: 2, moduleId: 'none' }] });
    h.step();
    assert.deepEqual([get(h.unit(1)), get(h.unit(2))], [withMod, without], id);
    done(h);
  }
  // 隐现: the air bonus is real damage
  const id = 'chess_char_1_01_b';
  const h = run({
    defs: { enemies: { f: dummy('f', { motion: 'FLY' }) }, chess: noGarrison(id) },
    units: [{ chessId: id, row: 9, col: 4, uid: 1 }, { chessId: id, row: 11, col: 4, uid: 2, moduleId: 'none' }],
    enemies: [{ key: 'f', pos: [10, 6], route: 2 }],
  });
  h.runUntil(() => dealt(h, h.unit(1)).length && dealt(h, h.unit(2)).length, 10);
  approx(dealt(h, h.unit(1))[0].amount, h.unit(1).s.atk * 1.1, 'MAR-X vs air');
  approx(dealt(h, h.unit(2))[0].amount, h.unit(2).s.atk, 'no module');
  done(h);
});

test('modules none: 深巡 / 雷蛇 lose the SPT-X reveal (kept with the default module, also when S1 is carried)', () => {
  for (const n of ['04', '20']) {
    const id = `chess_char_1_${n}_b`;
    const s1 = raw(id).skills.find((x) => !x.isDefault).skillId;
    const h = run({
      defs: { enemies: { e: dummy('e') } },
      units: [{ chessId: id, row: 9, col: 4, uid: 1 }, entry(id, s1, { row: 11, col: 4, uid: 2 }), { chessId: id, row: 12, col: 4, uid: 3, moduleId: 'none' }],
      enemies: [{ key: 'e', pos: [9, 6] }, { key: 'e', pos: [11, 6] }, { key: 'e', pos: [12, 6] }],
    });
    h.step();
    for (const e of h.enemies()) h.b.applyStatus(e, 'stealth', { duration: 100 });
    h.run(0.5);
    const at = (r) => h.enemies().find((e) => Math.round(e.y) === r);
    assert.ok(at(9).s.flags.reveal, `${id} default`);
    assert.ok(at(11).s.flags.reveal, `${id} S1 + module`);
    assert.ok(!at(12).s.flags.reveal, `${id} no module: no reveal`);
    done(h);
  }
});

test('modules none: 跃跃 no ×1.1 on adjacent enemies; 艾丝黛尔 no −20 % physical above 50 %; 宴 no 庇护 below 50 %', () => {
  // 跃跃: adjacent target, no skill
  {
    const id = 'chess_char_1_09_b', t = tal(id);
    for (const [moduleId, k] of [[undefined, 1.1], ['none', 1]]) {
      const h = run({ defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) }, units: [{ chessId: id, row: 10, col: 4, ...(moduleId ? { moduleId } : {}) }], enemies: [{ key: 'e', pos: [10, 5] }] });
      const u = h.unit(id);
      h.runUntil(() => dealt(h, u).length >= 4, 20);
      for (const c of dealt(h, u).filter((x) => !x.dmg.isSkill)) assert.ok([1, t.atk_scale].some((p) => Math.abs(c.amount - u.s.atk * k * p) < 1e-6 * c.amount), `跃跃 ${moduleId ?? 'LPS-X'} ${c.amount}`);
      done(h);
    }
  }
  // 艾丝黛尔 above 50 % HP / 宴 below 50 % HP: a physical enemy hit of 1000
  for (const [id, hpRatio, red] of [
    ['chess_char_1_12_b', 0.9, raw('chess_char_1_12_b').trait.bb.damage_resistance],
    ['chess_char_1_18_b', 0.3, raw('chess_char_1_18_b').modules[0].talentChanges[0].bb.damage_resistance],
  ]) {
    for (const [moduleId, k] of [[undefined, 1 - red], ['none', 1]]) {
      const h = run({ defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) }, units: [{ chessId: id, row: 9, col: 5, ...(moduleId ? { moduleId } : {}) }], enemies: [{ key: 'e', pos: [9, 7] }] });
      const u = h.unit(id);
      h.step();
      u.hp = u.s.maxHp * hpRatio;
      const got = h.b.dealDamage(h.enemies()[0], u, { amount: 1000, type: 'phys', isAttack: true, canDodge: false });
      approx(got, (1000 - u.s.def) * k, `${id} ${moduleId ?? 'module'}`);
      done(h);
    }
  }
});

test('modules none: 古米 heals without the GUA-X bonus (S1 and S2); 波登可 without +sp_recovery_per_sec SP/s', () => {
  const id = 'chess_char_1_10_b';
  for (const skillId of ['skchr_sunbr_1', 'skchr_sunbr_2']) {
    const s = rec(id, skillId);
    const ally = chessRec({ id: 't_ally', profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: null, stats: { maxHp: 20000 } });
    const h = run({
      defs: { enemies: { e: dummy('e', { atk: 1 }) }, chess: { ...noGarrison(id), t_ally: ally } },
      units: [entry(id, skillId, { row: 9, col: 5, carryState: READY, moduleId: 'none' }), { chessId: 't_ally', row: 10, col: 5 }],
      enemies: [{ key: 'e', pos: [9, 5] }],
    });
    const u = h.unit(id), a = h.unit('t_ally');
    h.step();
    a.hp = a.s.maxHp * 0.3;
    assert.ok(h.runUntil(() => heals(h, u).length > 0, 20), skillId);
    approx(heals(h, u)[0].amount, u.s.atk * (s.bb.heal_scale ?? 1), `${skillId}: no ×1.15 without the module`);
    done(h);
  }
  const pid = 'chess_char_1_13_b', bonus = raw(pid).modules[0].talentChanges.find((x) => x.talentIndex === -1).bb.sp_recovery_per_sec;
  const sp = {};
  for (const moduleId of [undefined, 'none']) {
    const h = run({ defs: { enemies: { e: dummy('e') }, chess: noGarrison(pid) }, units: [{ chessId: pid, row: 10, col: 4, ...(moduleId ? { moduleId } : {}) }], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = h.unit(pid);
    h.step();
    const s0 = u.skill.sp;
    h.run(5);
    sp[moduleId ?? 'DEC-X'] = u.skill.sp - s0;
    done(h);
  }
  approx(sp['DEC-X'] - sp.none, 5 * bonus, '波登可 module SP bonus', 1e-2);
});

// =================================================================================================================
// review fixes (default skills / talents met by the alternate loadouts) — regression tests

test('1_07 普罗旺斯 狼眼 is continuous (PRTS: ×(1 + lost / 20 % × atk_scale_up)), not in 20 % steps', () => {
  for (const id of pair('07')) {
    const bb = raw(id).skill.bb;
    assert.equal(raw(id).skill.skillId, 'skchr_prove_1');
    const h = run({ defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 6] }] });
    h.step();
    const u = h.unit(id), e = h.enemies()[0];
    for (const ratio of [0.9, 0.55, 0.3, 0.05]) {
      e.hp = e.s.maxHp * ratio;
      // an attack instance (splash ⇒ no 狩猎箭头 roll)
      const got = h.b.dealDamage(u, e, { amount: 1000, type: 'true', canDodge: false, isAttack: true, isSplash: true });
      approx(got, 1000 * (1 + ((1 - ratio) / bb.hp_ratio_drop) * bb.atk_scale_up), `${id} at ${ratio * 100} % HP`);
    }
    e.hp = e.s.maxHp;
    approx(h.b.dealDamage(u, e, { amount: 1000, type: 'true', canDodge: false, isAttack: true, isSplash: true }), 1000, 'full HP: no bonus');
    done(h);
  }
});

test('1_20 雷蛇 反击电弧: attack interval +70 % of the base (PRTS 增大(+70%)), normal and elite', () => {
  for (const id of pair('20')) {
    const bb = raw(id).skill.bb;
    assert.equal(raw(id).skill.skillId, 'skchr_liskam_2');
    // 重装 S2 反击电弧 is an OFFENSIVE skill: the basic strategy casts it with an enemy in the skill range (issue #4; the
    // deliberate deviation from the official 重装 row, DESIGN §21.29) —
    // the enemy here stands two tiles ahead and, being a speed-0 dummy, never touches her
    const h = run({ defs: { enemies: { e: dummy('e', { atk: 300, bat: 1 }) }, chess: noGarrison(id) }, units: [{ chessId: id, row: 9, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [9, 6] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(started(h, u)[0].reason, 'DEFAULT');
    approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd, `${id} interval ×${1 + bb.base_attack_time}`);
    h.runUntil(() => !u.skill.active, 30);
    approx(u.s.interval, u.base.bat * 100 / u.s.aspd, 'restored');
    done(h);
  }
});

test('刺玫 土壤基肥改良 (+heal_scale healing received) never boosts HP regeneration (角峰 S1 / 宴 S1 regen)', () => {
  const vendla = 'chess_char_1_06_a', yak = 'chess_char_1_02_a', s = rec(yak, 'skchr_yak_1');
  const t = tal(vendla);
  const h = run({
    defs: { enemies: { e: dummy('e', { atk: 1, bat: 5 }) }, chess: noGarrison(vendla, yak) },
    units: [{ chessId: vendla, row: 10, col: 3 }, entry(yak, s.skillId, { row: 9, col: 5, carryState: READY })],
    enemies: [{ key: 'e', pos: [9, 5] }],
  });
  const v = h.unit(vendla), y = h.unit(yak);
  assert.ok(h.runUntil(() => y.skill.active, 10), '体能强化 running');
  y.hp = y.s.maxHp * 0.3;
  approx(h.b.heal(null, y, 100), 100 * t.heal_scale, '治疗: ×heal_scale (the highest max-HP ally in range)');
  assert.equal(h.b.heal(y, y, 100, { self: true, silent: true, regen: true }), 100, '生命回复: unchanged');
  const t0 = h.b.time;
  h.run(3);
  const regen = heals(h, y, (c) => c.target === y && c.opts?.regen && c.t > t0).reduce((n, c) => n + c.amount, 0);
  assert.ok(Math.abs(regen - 3 * (y.s.hpRegen)) <= 2, `regen ${regen} ≈ ${3 * y.s.hpRegen} (no ×${t.heal_scale})`);
  assert.ok(v.alive && v.deployed);
  done(h);
});
