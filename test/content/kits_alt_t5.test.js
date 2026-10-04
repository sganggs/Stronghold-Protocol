// Tier 5 alternate skills & modules (DESIGN §16 operator loadouts; server/sim/content/kits/tier5.js `skills` maps).
// Every selectable non-default skill of every visible tier-5 chess runs a real battle — normal (Lv4) and elite (Lv7) —
// through the harness with its loadout (`skillIndex` / `moduleId` on the board entry, as a BattleSpec carries them),
// and its signature effect is asserted with numbers from that skill's own blackboard (data/chess.json skills[]).
// Non-default modules are checked where the module changes behaviour (REA-Y, PRI-Y, AFT-Y, FOR-Y, GUA-Y, PUM-Y, FGT-X,
// DEC-X/DEC-Y, SPC-Y, 'none').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { COLS } from '../../server/sim/constants.js';
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
const approx = (a, b, msg = '', rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const ally = (id, o = {}) => chessRec({ id, skill: null, ...o, stats: { maxHp: 10000, atk: 0, def: 0, blockCnt: 0, respawnTime: 5, ...(o.stats || {}) } });
const HOOKS = ['damaged', 'heal', 'hit', 'skillStart', 'skillEnd', 'statusApplied', 'ammoUsed', 'attack', 'death', 'deploy', 'kill'];
/** Battle + one tick (the spawns of t = 0 exist afterwards). */
const run = (o) => makeBattle({ seed: 7, autoFinish: false, timeLimit: 400, hooks: HOOKS, captureNoisy: true, ...o }).step();
/** No more casts (a silence buff): lets a test watch the end of an effect without a recast. */
const mute = (h, u) => h.b.addBuff(u, { key: 'test:mute', flags: { silence: true } });
/** Board entry of chess `id` carrying skill `skillId` (+ extra fields: module, tile). */
const entry = (id, skillId, o = {}) => ({ chessId: id, skillIndex: rec(id, skillId).index, ...o });
/** The unit of chess `id`, asserted to run the selected skill with its hand-authored spec. */
function sel(h, id, skillId) {
  const u = h.unit(id);
  assert.ok(u, `${id} on the board`);
  assert.equal(u.skill.id, skillId, `${id} carries ${skillId}`);
  assert.equal(u.kit.skillSource, 'skills', `${id} ${skillId}: hand-authored spec`);
  return u;
}
const bbOf = (u) => u.def.skill.bb;
const tal = (u, i) => (u.def.raw.talents || []).find((t) => t.index === i)?.bb ?? {};
const dealt = (h, u, f = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && f(c));
const tagged = (h, u, tag, target = null) => dealt(h, u, (c) => (c.dmg?.tags || []).includes(tag) && (!target || c.target === target));
const heals = (h, u, f = () => true) => h.hooksOf('heal').filter((c) => c.source === u && f(c));
const attacks = (h, u, f = () => true) => h.hooksOf('attack').filter((c) => c.attacker === u && f(c));
const statuses = (h, key, f = () => true) => h.hooksOf('statusApplied').filter((c) => c.status === key && f(c));
/** Events strictly inside the (first) run of u's skill. */
const during = (h, u, list) => {
  const s0 = h.hooksOf('skillStart').find((c) => c.unit === u)?.t ?? Infinity, s1 = h.hooksOf('skillEnd').find((c) => c.unit === u)?.t ?? Infinity;
  return list.filter((c) => c.t > s0 + 1e-9 && c.t < s1 - 1e-9);
};
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
const pair = (n) => [`chess_char_5_${n}_a`, `chess_char_5_${n}_b`];
/** Fill SP and run until the skill has been cast. */
function cast(h, u, max = 15) {
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.activations > 0, max), `${u.defId} ${u.skill.id} cast`);
}

// =================================================================================================================
// coverage & smoke

test('tier 5: every selectable skill of every visible chess has a hand-authored spec (normal + elite)', () => {
  const rep = kitCoverage({ tier: 5 });
  assert.equal(rep.summary.chess, 19);
  assert.equal(rep.summary.covered, rep.summary.skills, rep.chess.flatMap((r) => r.skills.filter((s) => !s.covered).map((s) => `${r.name} S${s.index + 1}`)).join(', '));
  assert.equal(rep.summary.chessFullyCovered, rep.summary.chess);
});

test('tier 5: every chess × every legal skill × every module fights with its authored spec and casts, no content errors', () => {
  const bases = ds.chessIds().filter((id) => /^chess_char_5_\d+_a$/.test(id) && raw(id).visible);
  assert.equal(bases.length, 19);
  let n = 0;
  for (const base of bases) {
    const gold = base.replace(/_a$/, '_b');
    const opt = loadoutOptions(raw(base), raw(gold));
    const mods = [undefined, 'none', ...(raw(gold).modules || []).map((m) => m.uniEquipId)];
    for (const skillIndex of opt.skills) {
      for (const [id, moduleId] of [[base, undefined], ...mods.map((m) => [gold, m])]) {
        const h = makeBattle({
          seed: 5, hooks: [],
          defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 30000, atk: 400, bat: 2, speed: 0.6 }) }, chess: { t_a: ally('t_a', { stats: { maxHp: 5000, atk: 100, blockCnt: 1 } }) } },
          units: [{ chessId: id, row: 10, col: 5, skillIndex, ...(moduleId ? { moduleId } : {}) }, { chessId: 't_a', row: 11, col: 5 }, { chessId: 'chess_char_5_11_a', row: 9, col: 4 }],
          enemies: [{ key: 'enemy_dummy', count: 6, interval: 2 }, { key: 'enemy_dummy', route: 1, count: 6, interval: 2 }],
          timeLimit: 90,
        });
        h.step();
        const u = h.b.allyUnits[0];
        const tag = `${id} S${skillIndex + 1} ${moduleId ?? 'default module'}`;
        assert.equal(u.def.loadout.skillIndex, skillIndex, tag);
        assert.ok(['skills', undefined].includes(u.kit.skillSource), `${tag}: ${u.kit.skillSource}`);
        const mate = h.b.allyUnits[1]; // (塞雷娅 S1 急救 casts only for an ally of its area below half HP)
        for (let t = 0; t < 60 && !h.b.finished; t += 5) { if (mate.alive) mate.hp = Math.min(mate.hp, mate.s.maxHp * 0.3); u.skill.gainSp(1000); h.run(5); }
        assert.ok(u.skill.activations > 0, `${tag}: cast`);
        assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), [], tag);
        checkInvariants(h.b);
        n++;
      }
    }
  }
  assert.ok(n > 200, `${n} loadouts`);
});

// =================================================================================================================
// 圣约送葬人

test('圣约送葬人 S1 遗嘱执行: 8-round ammo (+1 Laterano: himself), skill range, ATK +, ignores def_penetrate_fixed DEF', () => {
  for (const id of pair('01')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy'), enemy_armour: dummy('enemy_armour', { def: 400 }) } },
      units: [entry(id, 'skchr_excu2_1', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_armour', pos: [10, 6] }],
    });
    const u = sel(h, id, 'skchr_excu2_1');
    const bb = bbOf(u);
    h.step();
    const atk0 = u.s.atk;
    const e = h.enemy('enemy_armour');
    assert.ok(!u.rangeKeySet.has(10 * COLS + 6), 'the base range does not reach 2 tiles ahead');
    cast(h, u);
    assert.equal(u.skill.kind, 'ammo');
    assert.equal(u.skill.ammoLeft + h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, bb['attack@trigger_time'] + 1, 'ammo + 铳弹共感 (he is Laterano)');
    approx(u.s.atk, atk0 * (1 + bb.atk), id);
    assert.equal(u.s.defIgnoreFlat, bb.def_penetrate_fixed);
    assert.ok(u.rangeKeySet.has(10 * COLS + 6), 'the skill range does');
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.target === e && c.dmg.isAttack).length > 0, 5));
    const d = dealt(h, u, (c) => c.target === e && c.dmg.isAttack)[0];
    approx(d.amount, u.s.atk - (400 - bb.def_penetrate_fixed), `${id} DEF 400 − ${bb.def_penetrate_fixed}`);
    done(h);
  }
});

test('圣约送葬人 S3 圣约决裁: BAT +0.5 s, ATK + and +attack@atk per bullet, reaper heal ×2, the end hits every attacked enemy for 200 %', () => {
  for (const id of pair('01')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_excu2_3', { row: 10, col: 4 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [11, 5] }],
    });
    const u = sel(h, id, 'skchr_excu2_3');
    const bb = bbOf(u);
    h.step();
    const atk0 = u.s.atk, iv0 = u.s.interval, heal0 = u.profile.selfHeal;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk + bb['attack@atk'] * (u.findBuff('excu2:verdict')?.stacks ?? 0)), 'ATK');
    approx(u.s.interval, iv0 * (u.base.bat + bb.base_attack_time) / u.base.bat, 'BAT +0.5 s');
    assert.equal(u.profile.selfHeal, heal0 * bb.trait_ratio, 'trait heal ×2');
    assert.ok(h.runUntil(() => h.hooksOf('ammoUsed').filter((c) => c.unit === u).length >= 3, 20));
    const spent = h.hooksOf('ammoUsed').filter((c) => c.unit === u).length;
    assert.equal(u.findBuff('excu2:verdict').stacks, spent);
    approx(u.s.atk, atk0 * (1 + bb.atk + bb['attack@atk'] * spent), 'per-bullet ATK');
    let endAtk = 0;
    h.b.on('ammoUsed', (c) => { if (c.unit === u && c.left <= 0) endAtk = u.s.atk; }, { priority: -50 });
    assert.ok(h.runUntil(() => !u.skill.active, 60));
    const fin = tagged(h, u, 'verdict');
    assert.equal(new Set(fin.map((c) => c.target)).size, 2, 'both attacked enemies');
    for (const c of fin) approx(c.amount, endAtk * bb['attack@final_atk_scale'], 'final 200 %');
    assert.equal(u.profile.selfHeal, heal0, 'heal restored');
    assert.equal(u.findBuff('excu2:verdict'), null, 'stacks reset');
    done(h);
  }
});

test('圣约送葬人 module REA-Y (已知悉): ASPD +12 with ≥ 2 enemies in range (the default REA-X has no such rider)', () => {
  for (const [moduleId, want] of [['uniequip_003_excu2', 12], ['uniequip_002_excu2', 0]]) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [{ chessId: 'chess_char_5_01_b', row: 10, col: 4, moduleId }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    });
    const u = h.unit('chess_char_5_01_b');
    h.run(0.5);
    assert.equal(u.s.aspd, u.base.aspd, 'one enemy');
    h.spawn('enemy_dummy', { pos: [11, 5] });
    h.run(0.5);
    assert.equal(u.s.aspd, u.base.aspd + want, moduleId);
    done(h);
  }
});

// =================================================================================================================
// 缇缇

test('缇缇 S1 缓蚀: ATK +, each attack sleeps the target attack@sleep s with attack@prob', () => {
  for (const id of pair('02')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_titi_1', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    });
    const u = sel(h, id, 'skchr_titi_1');
    const bb = bbOf(u);
    h.step();
    const atk0 = u.s.atk;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    assert.ok(h.runUntil(() => !u.skill.active, 40));
    const n = attacks(h, u, (c) => c.isSkill).length;
    const slept = statuses(h, 'sleep', (c) => c.source === u);
    assert.ok(slept.length > 0 && slept.length < n, `${slept.length} sleeps in ${n} attacks`);
    for (const c of slept) approx(c.duration, bb['attack@sleep']);
    done(h);
  }
});

test('缇缇 S2 封护: no attacks; she and the lowest-HP op in range sleep (invulnerable) until the end; enemies around them sleep; T1 ×talent_scale', () => {
  for (const id of pair('02')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') }, chess: { t_hurt: ally('t_hurt'), t_fine: ally('t_fine') } },
      units: [entry(id, 'skchr_titi_2', { row: 10, col: 4 }), { chessId: 't_hurt', row: 10, col: 6 }, { chessId: 't_fine', row: 11, col: 5 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_dummy', pos: [12, 8] }],
    });
    const u = sel(h, id, 'skchr_titi_2');
    const bb = bbOf(u), t0 = tal(u, 0);
    const hurt = h.unit('t_hurt'), fine = h.unit('t_fine');
    const [near, far] = h.b.enemies;
    h.step();
    hurt.hp = hurt.s.maxHp * 0.3;
    fine.hp = fine.s.maxHp * 0.6;
    const atk0 = u.s.atk;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    assert.ok(u.findBuff('titi:ward') && u.s.flags.sleep, 'she sleeps');
    assert.ok(hurt.findBuff('titi:ward') && hurt.s.flags.sleep, 'the lowest-HP op sleeps');
    assert.ok(!fine.findBuff('titi:ward'));
    h.b.dealDamage(null, hurt, { amount: 1e9, type: 'true' });
    assert.ok(hurt.alive, 'asleep = invulnerable');
    h.run(1.2);
    assert.ok(near.s.flags.sleep, 'the enemy next to the ward sleeps');
    assert.ok(!far.s.flags.sleep, 'an enemy far away does not');
    const dream = tagged(h, u, 'titiDream', near);
    assert.ok(dream.length > 0);
    approx(dream.at(-1).amount, u.s.atk * t0.damage_atk_scale * bb.talent_scale, 'T1 ×talent_scale');
    assert.ok(h.runUntil(() => !u.skill.active, 30));
    assert.equal(during(h, u, attacks(h, u)).length, 0, 'no attacks during the skill');
    // …and every 凝固的时光 tick healed a 咒愈师 ally: the official trait buff (`titi_tr`) is ON_AFTER_OUTPUT_DAMAGE, so
    // the heal follows ANY damage she deals. The sim ran the trait from the attack path only and she does not attack at
    // all while this skill runs, so those ticks healed nothing (the same hook gap that left 隐德来希 S2 without heals).
    const dreams = during(h, u, dealt(h, u, (c) => (c.dmg?.tags || []).includes('titiDream')));
    const incHeals = during(h, u, heals(h, u, (c) => (c.opts?.tags || []).includes('incantation')));
    assert.ok(dreams.length > 0, `${dreams.length} 凝固的时光 ticks`);
    assert.equal(incHeals.length, dreams.length, 'one trait heal per tick');
    for (const c of incHeals) {
      approx(c.amount, dreams[0].amount * u.profile.healRatio, 'heal = 50 % of the tick');
      assert.ok([hurt, fine, u].includes(c.target), 'on an ally in her range');
    }
    assert.ok(!u.findBuff('titi:ward') && !hurt.findBuff('titi:ward'), 'both wake at the end');
    done(h);
  }
});

// =================================================================================================================
// 烛煌

test('烛煌 S1 炙手之援: the highest-max-HP op in range carries a fire aura: atk_scale × ATK arts/s + element_multiplier 灼燃 for 20 s', () => {
  for (const id of pair('03')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') }, chess: { t_big: ally('t_big', { stats: { maxHp: 30000 } }), t_small: ally('t_small') } },
      units: [entry(id, 'skchr_blaze2_1', { row: 10, col: 3 }), { chessId: 't_big', row: 10, col: 5 }, { chessId: 't_small', row: 11, col: 4 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    });
    const u = sel(h, id, 'skchr_blaze2_1');
    const bb = bbOf(u);
    const big = h.unit('t_big'), small = h.unit('t_small');
    h.step();
    cast(h, u);
    const aura = big.findBuff(`blaze2:aid:${u.id}`);
    assert.ok(aura, 'on the highest max HP op');
    approx(aura.timeLeft, bb.max_duration, 'duration', 0.02);
    assert.ok(!small.findBuff(`blaze2:aid:${u.id}`));
    const e = h.b.enemies[0];
    assert.ok(h.runUntil(() => tagged(h, u, 'blazeAid', e).length >= 4, 5));
    const arts = tagged(h, u, 'blazeAid', e).filter((c) => c.type === 'arts');
    const burn = tagged(h, u, 'blazeAid', e).filter((c) => c.type === 'element');
    approx(arts[0].amount, u.s.atk * bb.atk_scale, 'arts');
    approx(burn[0].amount, arts[0].amount * bb.element_multiplier, '灼燃损伤');
    mute(h, u);
    h.run(bb.max_duration);
    assert.equal(big.findBuff(`blaze2:aid:${u.id}`), null, 'ends');
    done(h);
  }
});

test('烛煌 S2 沸血燎原: BAT +0.9 s, ATK +, 3 targets, −5 % max HP per attack, burning tiles slow −50 % and burn per second', () => {
  for (const id of pair('03')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_blaze2_2', { row: 10, col: 4 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [9, 5] }, { key: 'enemy_dummy', pos: [11, 5] }, { key: 'enemy_dummy', pos: [10, 6] }],
    });
    const u = sel(h, id, 'skchr_blaze2_2');
    const bb = bbOf(u);
    h.step();
    const atk0 = u.s.atk, iv0 = u.s.interval;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    approx(u.s.interval, iv0 * (u.base.bat + bb.base_attack_time) / u.base.bat, 'BAT +0.9 s');
    assert.ok(h.runUntil(() => attacks(h, u, (c) => c.isSkill).length > 0, 5));
    const a = attacks(h, u, (c) => c.isSkill)[0];
    assert.equal(a.targets.length, bb['attack@max_target']);
    approx(u.hp, u.s.maxHp * (1 - attacks(h, u, (c) => c.isSkill).length * bb['attack@hp_ratio']), 'HP loss per attack', 1e-3);
    const e = a.targets[0];
    h.run(1.3);
    const g = e.findBuff(`blaze2:ground:${u.id}`);
    assert.ok(g, 'standing on a burning tile');
    approx(g.mods.moveMul, 1 + bb.move_speed);
    const ground = tagged(h, u, 'blazeGround', e);
    const arts = ground.find((c) => c.type === 'arts'), burn = ground.find((c) => c.type === 'element');
    approx(arts.amount, u.s.atk * bb.atk_scale, 'ground arts');
    approx(burn.amount, arts.amount * bb.element_damage_scale, 'ground 灼燃');
    assert.ok(h.runUntil(() => !u.skill.active, 60));
    h.run(0.6);
    assert.equal(e.findBuff(`blaze2:ground:${u.id}`), null, 'the tiles go out with the skill');
    done(h);
  }
});

test('烛煌 / 妮芙 module PRI-Y: SP +0.2/s while an enemy in range is in an element burst, and no ×1.1 burst damage', () => {
  for (const [id, moduleId] of [['chess_char_5_03_b', 'uniequip_003_blaze2'], ['chess_char_5_22_b', 'uniequip_003_nymph']]) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [{ chessId: id, row: 10, col: 4, moduleId }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    });
    const u = h.unit(id);
    const e = h.b.enemies[0];
    h.run(0.5);
    assert.equal(u.s.spRecovery, u.base.spRecovery, 'no burst yet');
    h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 5000 });
    h.run(0.5);
    approx(u.s.spRecovery, u.base.spRecovery + tal(u, -1).sp_recovery_per_sec, moduleId);
    approx(h.b.dealDamage(u, e, { amount: 1000, type: 'true' }), 1000, 'PRI-Y: no damage bonus');
    done(h);
  }
});

// =================================================================================================================
// 乌尔比安

test('乌尔比安 S1 必须促成的接触: the anchor drags up to 2 enemies around the target in front of him, atk_scale × ATK phys each', () => {
  for (const id of pair('05')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_ulpia_1', { row: 10, col: 3 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 4] }, { key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [11, 6] }, { key: 'enemy_dummy', pos: [9, 9] }],
    });
    const u = sel(h, id, 'skchr_ulpia_1');
    const bb = bbOf(u);
    const [front, far, side, away] = h.b.enemies;
    h.step();
    cast(h, u);
    const pulled = tagged(h, u, 'anchorPull');
    assert.equal(pulled.length, bb.max_target, 'max_target enemies');
    assert.deepEqual(new Set(pulled.map((c) => c.target)), new Set([far, side]), 'the unblocked target and the one around it');
    for (const c of pulled) approx(c.amount, u.s.atk * bb.atk_scale, 'atk_scale');
    assert.ok(far.x < 6 - 0.5 && side.x < 6 - 0.5, `dragged towards him (${far.x}, ${side.x})`);
    assert.equal(away.x, 9);
    assert.equal(front.x, 4);
    done(h);
  }
});

test('乌尔比安 S2 必须维系的界限: never ends; ATK +, max HP +, block +1; T1 heals ×talent_scale', () => {
  for (const id of pair('05')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_ulpia_2', { row: 10, col: 3 })], enemies: [{ key: 'enemy_dummy', pos: [10, 4] }],
    });
    const u = sel(h, id, 'skchr_ulpia_2');
    const bb = bbOf(u), t0 = tal(u, 0);
    h.step();
    const atk0 = u.s.atk, hp0 = u.s.maxHp, blk0 = u.s.blockCnt;
    h.b.dealDamage(null, u, { amount: 10, type: 'true' });
    const before = heals(h, u, (c) => c.target === u).at(-1).amount;
    approx(before, t0.value1 * u.s.healingTakenMul, 'T1 before (× CRU-X healing on the elite)');
    cast(h, u);
    assert.equal(u.skill.kind, 'toggle');
    approx(u.s.atk, atk0 * (1 + bb.atk));
    approx(u.s.maxHp, hp0 * (1 + bb.max_hp));
    assert.equal(u.s.blockCnt, blk0 + bb.block_cnt);
    h.b.dealDamage(null, u, { amount: 10, type: 'true' });
    approx(heals(h, u, (c) => c.target === u).at(-1).amount, t0.value1 * bb.talent_scale * u.s.healingTakenMul, 'T1 ×talent_scale');
    h.run(120);
    assert.ok(u.skill.active, 'duration unlimited');
    done(h);
  }
});

// =================================================================================================================
// 隐德来希

test('隐德来希 S1 玫影觅迹: the next attack hits twice at atk_scale × ATK', () => {
  for (const id of pair('06')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_etlchi_1', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
    const u = sel(h, id, 'skchr_etlchi_1');
    const bb = bbOf(u);
    h.step();
    cast(h, u);
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isSkill && c.dmg.isAttack).length >= 2, 5));
    const hits = dealt(h, u, (c) => c.dmg.isSkill && c.dmg.isAttack);
    assert.equal(new Set(hits.map((c) => c.dmg.attackId)).size, 1, 'one attack');
    assert.equal(hits.length, 2, 'two hits');
    for (const c of hits) approx(c.amount, u.s.atk * bb.atk_scale);
    done(h);
  }
});

test('隐德来希 S2 绯红壁合: no attacks; blood sickles on her and on the ground ally with enemies around cut every 0.5 s', () => {
  for (const id of pair('06')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') }, chess: { t_g: ally('t_g'), t_idle: ally('t_idle') } },
      units: [entry(id, 'skchr_etlchi_2', { row: 10, col: 4 }), { chessId: 't_g', row: 12, col: 7 }, { chessId: 't_idle', row: 10, col: 3 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [12, 8] }, { key: 'enemy_dummy', pos: [9, 9] }],
    });
    const u = sel(h, id, 'skchr_etlchi_2');
    const bb = bbOf(u);
    const [mine, other, none] = h.b.enemies;
    h.step();
    cast(h, u);
    assert.deepEqual(u.mem.sickles.map((a) => a.defId), [u.defId, 't_g']);
    assert.ok(h.runUntil(() => !u.skill.active, 30));
    assert.equal(during(h, u, attacks(h, u)).length, 0, 'no attacks');
    for (const e of [mine, other]) {
      const cuts = tagged(h, u, 'bloodSickle', e);
      assert.ok(Math.abs(cuts.length - rec(id, 'skchr_etlchi_2').duration / bb.interval) <= 1, `${cuts.length} cuts`);
      approx(cuts[0].amount, u.s.atk * bb.atk_scale);
    }
    assert.equal(tagged(h, u, 'bloodSickle', none).length, 0);
    done(h);
  }
});

test('隐德来希 S2 绯红壁合: every 血镰 cut heals the 收割者 trait (每攻击到一个敌人回复自身50生命)', () => {
  for (const id of pair('06')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_etlchi_2', { row: 10, col: 4 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    });
    const u = sel(h, id, 'skchr_etlchi_2');
    h.step();
    cast(h, u);
    u.hp = u.s.maxHp * 0.4; // wounded (and above 重盈's 25 %), so every heal shows
    const hp0 = u.hp, t0 = h.b.time;
    h.run(3);
    const cuts = tagged(h, u, 'bloodSickle').filter((c) => c.t > t0 + 1e-9);
    const healed = heals(h, u, (c) => c.target === u && c.t > t0 + 1e-9);
    assert.ok(cuts.length >= 5, `${cuts.length} cuts`);
    assert.equal(healed.length, cuts.length, 'one trait heal per cut (the trait fires on every damage she outputs)');
    for (const c of healed) approx(c.amount, u.profile.selfHeal, 'per-hit heal = the trait 生命值');
    approx(u.hp - hp0, healed.length * u.profile.selfHeal, 'HP restored');
    done(h);
  }
});

test('隐德来希 S2 绯红壁合: the 收割者 heal is capped by the block count per cut (最大生效数等于阻挡数)', () => {
  const h = run({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
    units: [entry('chess_char_5_06_a', 'skchr_etlchi_2', { row: 10, col: 4 })],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [9, 4] }, { key: 'enemy_dummy', pos: [11, 4] }],
  });
  const u = sel(h, 'chess_char_5_06_a', 'skchr_etlchi_2');
  h.step();
  cast(h, u);
  u.hp = u.s.maxHp * 0.4;
  const hp0 = u.hp, t0 = h.b.time;
  h.run(3);
  const cuts = tagged(h, u, 'bloodSickle').filter((c) => c.t > t0 + 1e-9);
  const healed = heals(h, u, (c) => c.target === u && c.t > t0 + 1e-9);
  const ticks = cuts.length / 3; // three enemies stand in the sickle's ring
  assert.ok(ticks >= 5 && Number.isInteger(ticks), `${cuts.length} cuts over ${ticks} ticks`);
  assert.equal(healed.length, ticks * Math.max(1, u.s.blockCnt), `${healed.length} heals (阻挡数 ${u.s.blockCnt})`);
  for (const c of healed) approx(c.amount, u.profile.selfHeal, 'per-hit heal');
  approx(u.hp - hp0, healed.length * u.profile.selfHeal, 'HP restored');
  done(h);
});

test('隐德来希 module REA-Y (玫瑰色故事集): ASPD +12 with ≥ 2 enemies in range', () => {
  const h = run({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
    units: [{ chessId: 'chess_char_5_06_b', row: 10, col: 4, moduleId: 'uniequip_003_etlchi' }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit('chess_char_5_06_b');
  h.run(0.5);
  assert.equal(u.s.aspd, u.base.aspd);
  h.spawn('enemy_dummy', { pos: [11, 5] });
  h.run(0.5);
  assert.equal(u.s.aspd, u.base.aspd + u.def.traitBb.attack_speed);
  assert.equal(u.profile.selfHeal, u.def.traitBb.value, 'reaper heal back to 50');
  done(h);
});

// =================================================================================================================
// 史尔特尔

test('史尔特尔 S1 烈焰魔剑: next attack atk_scale × ATK; a kill refills the SP at once', () => {
  for (const id of pair('07')) {
    const h = run({
      defs: { enemies: { enemy_weak: dummy('enemy_weak', { hp: 100 }), enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_surtr_1', { row: 10, col: 4 })],
    });
    const u = sel(h, id, 'skchr_surtr_1');
    const bb = bbOf(u);
    u.skill.gainSp(1000);
    const w = h.spawn('enemy_weak', { pos: [10, 5] });
    assert.ok(h.runUntil(() => !w.alive, 5), 'the skill hit kills');
    assert.equal(u.skill.activations, 1);
    assert.ok(dealt(h, u, (c) => c.target === w)[0].dmg.isSkill, 'by the skill');
    assert.ok(u.skill.ready, 'SP refilled');
    const e = h.spawn('enemy_dummy', { pos: [10, 5] });
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.target === e && c.dmg.isSkill).length > 0, 5), 'next attack is the skill again');
    approx(dealt(h, u, (c) => c.target === e && c.dmg.isSkill)[0].amount, u.s.atk * bb.atk_scale);
    assert.ok(!u.skill.ready, 'no kill: no refill');
    done(h);
  }
});

test('史尔特尔 S2 熔核巨影: ATK +, range +1, 2 targets; a lone target takes ×critical atk_scale', () => {
  for (const id of pair('07')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_surtr_2', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
    const u = sel(h, id, 'skchr_surtr_2');
    const bb = bbOf(u);
    h.step();
    const atk0 = u.s.atk;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    assert.ok(u.rangeKeySet.has(10 * COLS + 6), 'range +1');
    assert.equal(h.b.effectiveProfile(u).maxTargets, bb['attack@max_target']);
    const [e1] = h.b.enemies;
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isSkill && c.dmg.isAttack).length > 0, 5));
    approx(dealt(h, u, (c) => c.dmg.isSkill && c.dmg.isAttack)[0].amount, u.s.atk * bb['attack@surtr_s_2[critical].atk_scale'], 'lone target');
    const e2 = h.spawn('enemy_dummy', { pos: [10, 6] });
    const k = dealt(h, u).length;
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.target === e2 && c.dmg.isAttack).length > 0, 5));
    for (const c of dealt(h, u).slice(k).filter((c) => c.dmg.isAttack)) approx(c.amount, u.s.atk, 'two targets: plain ATK');
    assert.ok(e1.alive);
    done(h);
  }
});

test('史尔特尔 module AFT-Y (旅游必需品): blocked enemies are 法术脆弱 +10 %; no ASPD +8 unblocking', () => {
  const h = run({
    defs: { enemies: { enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e7, speed: 1 }) } },
    units: [{ chessId: 'chess_char_5_07_b', row: 9, col: 5, moduleId: 'uniequip_003_surtr' }], enemies: [{ key: 'enemy_walk', route: 0 }],
  });
  const u = h.unit('chess_char_5_07_b');
  h.run(0.5);
  assert.equal(u.s.aspd, u.base.aspd, 'no AFT-X rider');
  const e = h.b.enemies[0];
  assert.ok(h.runUntil(() => e.blockedBy === u, 20));
  h.run(0.5);
  const f = e.buffs.find((b) => (b.status ?? b.key) === 'artsFragile');
  assert.ok(f, '法术脆弱');
  approx(e.s.artsTakenMul, u.def.traitBb.damage_scale);
  done(h);
});

// =================================================================================================================
// 号角

test('号角 S1 照明榴弹 (自动触发 ⇒ DEFAULT): the next ranged shot deals atk_scale × ATK, splashes projectile_range and lights the impact', () => {
  for (const id of pair('08')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_horn_1', { row: 10, col: 2 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [11.6, 6] }],
    });
    const u = sel(h, id, 'skchr_horn_1');
    const bb = bbOf(u);
    const [e1, e2] = h.b.enemies;
    h.step();
    u.skill.gainSp(1000);
    assert.equal(u.skill.rule, 'DEFAULT', 'an AUTO skill takes no 技能策略 (the 重装 row is for MANUAL skills)');
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isSkill && c.target === e1).length > 0, 5), 'her next shot, no hit needed');
    u.skill.charges = 0; // (no further flare in the window below: it would light the targets again)
    u.skill.spCostMul = 1000;
    approx(dealt(h, u, (c) => c.dmg.isSkill && c.target === e1)[0].amount, u.s.atk * bb.atk_scale, 'atk_scale');
    assert.ok(dealt(h, u, (c) => c.dmg.isSkill && c.target === e2).length > 0, `the splash reaches 1.6 tiles (${bb.projectile_range})`);
    h.run(0.5);
    assert.ok(e1.findBuff('reveal') && e2.findBuff('reveal'), 'lit');
    h.run(bb.projectile_delay_time + 0.5);
    assert.ok(!e1.findBuff('reveal'), 'the light fades');
    done(h);
  }
});

test('号角 S2 暴风号令: cast with an enemy in range (DEFAULT, DESIGN §21.29); 10 rounds of attack@s2.atk_scale × ATK splash; the second half adds magic_atk_scale × ATK arts (过载)', () => {
  for (const id of pair('08')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_horn_2', { row: 10, col: 2 })], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
    const u = sel(h, id, 'skchr_horn_2');
    const bb = bbOf(u);
    const e = h.b.enemies[0];
    h.step();
    // the owner's deliberate deviation from the 重装 TAKE_DAMAGE row (DESIGN §21.29): cast with an enemy in range
    assert.equal(u.skill.rule, 'DEFAULT');
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 3), 'cast with the enemy in range');
    assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'DEFAULT');
    assert.ok(!h.hooksOf('damaged').some((c) => c.target === u), 'no hit needed');
    assert.equal(u.skill.kind, 'ammo');
    assert.equal(u.skill.ammoLeft + h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, bb['attack@s2.trigger_time']);
    assert.ok(h.runUntil(() => !u.skill.active, 60));
    h.run(1);
    const shots = dealt(h, u, (c) => c.dmg.isSkill && c.dmg.isAttack && c.target === e && c.type === 'phys');
    assert.equal(shots.length, bb['attack@s2.trigger_time']);
    for (const c of shots) approx(c.amount, u.s.atk * bb['attack@s2.atk_scale']);
    const over = tagged(h, u, 'hornOverload', e);
    assert.equal(over.length, bb['attack@s2.trigger_time'] / 2, 'second half');
    for (const c of over) approx(c.amount, u.s.atk * bb['attack@s2.magic_atk_scale']);
    assert.ok(over[0].t > shots[bb['attack@s2.trigger_time'] / 2 - 1].t, 'after the first half');
    done(h);
  }
});

test('号角 module FOR-Y (旧日新装): ASPD +10 while not blocking; no ×1.1 vs blocked', () => {
  const h = run({
    defs: { enemies: { enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e7, speed: 1 }) } },
    units: [{ chessId: 'chess_char_5_08_b', row: 9, col: 5, moduleId: 'uniequip_003_horn' }], enemies: [{ key: 'enemy_walk', route: 0, time: 3 }],
  });
  const u = h.unit('chess_char_5_08_b');
  h.run(0.5);
  assert.equal(u.s.aspd, u.base.aspd + tal(u, -1).attack_speed);
  assert.ok(!u.profile.dmgMul, 'no FOR-X blocked bonus');
  assert.ok(h.runUntil(() => u.blocking.length > 0, 30));
  h.run(0.5);
  assert.equal(u.s.aspd, u.base.aspd, 'blocking');
  done(h);
});

// =================================================================================================================
// 铃兰

test('铃兰 S1 全力以赴: ATK +, ASPD + for the duration; S2 儿时的舞乐: toggle ATK +, 2 targets', () => {
  for (const id of pair('10')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_lisa_1', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
    const u = sel(h, id, 'skchr_lisa_1');
    const bb = bbOf(u);
    h.step();
    const atk0 = u.s.atk, aspd0 = u.s.aspd;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    assert.equal(u.s.aspd, aspd0 + bb.attack_speed);
    h.run(rec(id, 'skchr_lisa_1').duration + 0.5);
    assert.equal(u.s.aspd, aspd0, 'ends');
    done(h);

    const g = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_lisa_2', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [10, 6] }] });
    const v = sel(g, id, 'skchr_lisa_2');
    const b2 = bbOf(v);
    g.step();
    const a0 = v.s.atk;
    cast(g, v);
    assert.equal(v.skill.kind, 'toggle');
    approx(v.s.atk, a0 * (1 + b2.atk));
    assert.ok(g.runUntil(() => attacks(g, v, (c) => c.isSkill).length > 0, 5));
    assert.equal(attacks(g, v, (c) => c.isSkill)[0].targets.length, b2['attack@max_target']);
    g.run(200);
    assert.ok(v.skill.active, 'duration unlimited');
    done(g);
  }
});

test('铃兰 module DEC-Y (孩子们): longer 停顿 (1.2 s) and no SP rider', () => {
  const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [{ chessId: 'chess_char_5_10_b', row: 10, col: 4, moduleId: 'uniequip_003_lisa' }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
  const u = h.unit('chess_char_5_10_b');
  assert.ok(h.runUntil(() => statuses(h, 'sluggish', (c) => c.source === u).length > 0, 5));
  approx(statuses(h, 'sluggish', (c) => c.source === u)[0].duration, u.def.traitBb.sluggish);
  assert.equal(u.findBuff('lisa:module'), null);
  done(h);
});

// =================================================================================================================
// 塞雷娅

test('塞雷娅 S1 急救 (自动触发, at her attack: an ally of the area at ≤ half HP): that attack heals the lowest such ally for heal_scale × ATK instead', () => {
  for (const id of pair('11')) {
    // PRTS 备注 "此技能仅在周围有符合血量条件的友方单位时可触发，触发时会替换当次攻击"; "血量小于等于一半" (PRTS 修正)
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') }, chess: { t_low: ally('t_low'), t_mid: ally('t_mid') } },
      units: [entry(id, 'skchr_demkni_1', { row: 10, col: 4 }), { chessId: 't_low', row: 11, col: 3 }, { chessId: 't_mid', row: 9, col: 4 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 4] }],
    });
    const u = sel(h, id, 'skchr_demkni_1');
    const bb = bbOf(u), tb = u.def.traitBb;
    const low = h.unit('t_low'), mid = h.unit('t_mid');
    const e = h.b.enemies[0];
    h.step();
    low.hp = low.s.maxHp * 0.3;
    mid.hp = mid.s.maxHp * 0.45;
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => heals(h, u, (c) => c.target === low).length > 0, 10));
    const first = heals(h, u, (c) => c.target === low)[0];
    assert.ok(first.amount > 0 && heals(h, u)[0] === first, 'the first heal goes to the lowest ratio');
    approx(first.amount, u.s.atk * bb.heal_scale * (tb.heal_scale && tb.hp_ratio != null ? tb.heal_scale : 1), 'heal_scale (× GUA-X below 50 % on the elite)', 1e-3);
    const start = h.hooksOf('skillStart').find((x) => x.unit === u);
    assert.equal(start.reason, 'DEFAULT');
    assert.equal(dealt(h, u, (c) => c.target === e && c.t === start.t).length, 0, 'the heal replaced the attack of that moment');
    assert.ok(heals(h, u).every((c) => c.t >= start.t), 'only skill heals: she has no heal of her own');
    done(h);
  }
});

test('塞雷娅 S3 钙质化: allies in the area heal attack@heal_scale × ATK/s; enemies there take arts ×damage_scale and move −60 %', () => {
  for (const id of pair('11')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { atk: 100, bat: 1 }) }, chess: { t_a: ally('t_a') } }, // 重装: TAKE_DAMAGE
      units: [entry(id, 'skchr_demkni_3', { row: 10, col: 4 }), { chessId: 't_a', row: 10, col: 6 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 4] }, { key: 'enemy_dummy', pos: [9, 6] }, { key: 'enemy_dummy', pos: [12, 9] }],
    });
    const u = sel(h, id, 'skchr_demkni_3');
    const bb = bbOf(u);
    const a = h.unit('t_a');
    const [e1, e2, out] = h.b.enemies;
    h.step();
    a.hp = a.s.maxHp * 0.6;
    cast(h, u);
    h.run(1.2);
    for (const e of [e1, e2]) {
      const b = e.findBuff('saria:calcify');
      assert.ok(b, 'debuffed in the area');
      approx(e.s.artsTakenMul, bb['demkni_s_3.damage_scale']);
      approx(b.mods.moveMul, 1 + bb['demkni_s_3.move_speed']);
    }
    assert.equal(out.findBuff('saria:calcify'), null, 'outside the area');
    const hh = heals(h, u, (c) => c.target === a);
    assert.ok(hh.length >= 1);
    approx(hh[0].amount, u.s.atk * bb['attack@heal_scale']);
    done(h);
  }
});

test('塞雷娅 module GUA-Y (科技新星): damage taken −15 %; the S2 auto-cast only runs for S2', () => {
  const h = run({ units: [{ chessId: 'chess_char_5_11_b', row: 10, col: 4, moduleId: 'uniequip_003_demkni' }] });
  const u = h.unit('chess_char_5_11_b');
  h.step();
  approx(h.b.dealDamage(null, u, { amount: 1000, type: 'true' }), 1000 * (1 - u.def.traitBb.damage_resistance));
  done(h);
  const g = run({ defs: { chess: { t_a: ally('t_a') } }, units: [entry('chess_char_5_11_a', 'skchr_demkni_3', { row: 10, col: 4 }), { chessId: 't_a', row: 10, col: 5 }] });
  const v = g.unit('chess_char_5_11_a');
  g.step();
  g.unit('t_a').hp = 1000;
  v.skill.gainSp(1000);
  g.run(2);
  assert.equal(v.skill.activations, 0, 'S3 is not cast by the S2 injured-ally rule (no enemy in range)');
  done(g);
});

// =================================================================================================================
// 夕

test('夕 S2 泼墨淋漓: skill range, ATK/ASPD +, one hit on every enemy in range (no splash), ×damage_scale below half HP', () => {
  for (const id of pair('12')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_dusk_2', { row: 10, col: 3 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [9, 4] }, { key: 'enemy_dummy', pos: [11, 5] }],
    });
    const u = sel(h, id, 'skchr_dusk_2');
    const bb = bbOf(u);
    const [far, e2, low] = h.b.enemies;
    h.step();
    low.hp = low.s.maxHp * 0.4;
    const atk0 = u.s.atk, aspd0 = u.s.aspd;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    assert.equal(u.s.aspd, aspd0 + bb.attack_speed);
    assert.ok(h.runUntil(() => attacks(h, u, (c) => c.isSkill).length > 0, 5));
    h.run(1);
    const first = dealt(h, u, (c) => c.dmg.isSkill && c.dmg.isAttack);
    const id0 = first[0].dmg.attackId;
    const one = first.filter((c) => c.dmg.attackId === id0);
    assert.deepEqual(new Set(one.map((c) => c.target)), new Set([far, e2, low]), 'every enemy in range (col 6 = skill range)');
    assert.equal(one.length, 3, 'one hit each, no splash');
    approx(one.find((c) => c.target === far).amount, u.s.atk);
    approx(one.find((c) => c.target === low).amount, u.s.atk * bb.damage_scale, 'below half HP');
    done(h);
  }
});

test('夕 S3 写意胜形: BAT +0.4 s, ATK +, splash 1.7; every attack summons / moves one 小自在 (refreshed 25 s)', () => {
  for (const id of pair('12')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_dusk_3', { row: 10, col: 3 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [11.4, 5] }],
    });
    const u = sel(h, id, 'skchr_dusk_3');
    const bb = bbOf(u), t1 = tal(u, 1);
    const [e1, e2] = h.b.enemies;
    const atk0 = u.s.atk, iv0 = u.s.interval;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    approx(u.s.interval, iv0 * (u.base.bat + bb.base_attack_time) / u.base.bat, 'BAT +0.4 s');
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isSkill && c.dmg.isSplash && c.target === e2).length > 0, 8), 'splash 1.7 reaches 1.4 tiles');
    const toks = () => h.b.allyUnits.filter((x) => x.kind === 'token' && x.alive && x.defId === 'token_10015_dusk_drgn');
    assert.equal(toks().length, 1, 'one 小自在');
    const tk = toks()[0];
    approx(tk.mem.duskUntil - h.b.time, t1['attack@tokenduration'], 'refreshed at every attack', 0.2);
    // the target leaves: the next attack lands on another tile → the same 小自在 moves there, refreshed
    h.b.kill(e1, null); h.b.kill(e2, null);
    const e3 = h.spawn('enemy_dummy', { pos: [9, 6] });
    assert.ok(h.runUntil(() => tk.tileR === 9 && tk.tileC === 6, 8), 'moved onto the new target');
    assert.equal(toks().length, 1);
    assert.ok(tk.alive && e3.alive);
    mute(h, u);
    assert.ok(h.runUntil(() => !u.skill.active, 70));
    const until = tk.mem.duskUntil;
    h.run(until - h.b.time + 0.2);
    assert.equal(tk.alive, false, 'expires 25 s after the last refresh');
    done(h);
  }
});

test('夕 S3 写意胜形: unblocked enemies first (the blocked one is attacked only without another choice)', () => {
  const h = run({
    defs: { enemies: { enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e7, speed: 1 }), enemy_dummy: dummy('enemy_dummy') }, chess: { t_block: ally('t_block', { stats: { blockCnt: 1 } }) } },
    // (the blocker at col 4: the walker stops 0.71 tile in front of it — block radius, user playtest #5 — on col 5,
    // inside 夕's 3-column range)
    units: [entry('chess_char_5_12_a', 'skchr_dusk_3', { row: 10, col: 3 }), { chessId: 't_block', row: 9, col: 4 }],
    enemies: [{ key: 'enemy_walk', route: 0 }, { key: 'enemy_dummy', pos: [10, 6] }],
  });
  const u = h.unit('chess_char_5_12_a');
  const [walker, free] = h.b.enemies;
  assert.ok(h.runUntil(() => walker.blockedBy != null, 20), 'blocked by t_block');
  const k = attacks(h, u).length;
  assert.ok(h.runUntil(() => attacks(h, u).length > k, 8));
  assert.equal(attacks(h, u)[k].targets[0], walker, 'default order: the blocked walker is nearer the goal');
  cast(h, u);
  assert.ok(h.runUntil(() => attacks(h, u, (c) => c.isSkill).length > 0, 8));
  assert.equal(attacks(h, u, (c) => c.isSkill)[0].targets[0], free, 'S3: the unblocked enemy');
  // (the 小自在 summoned on its tile blocks it from then on)
  done(h);
});

test('夕 modules: SPC-Y (终夜无寐) −8 cost and no range +1; no module: no range +1 either', () => {
  for (const moduleId of ['uniequip_003_dusk', 'none']) {
    const h = run({ units: [{ chessId: 'chess_char_5_12_b', row: 10, col: 4, moduleId }] });
    const u = h.unit('chess_char_5_12_b');
    h.step();
    assert.equal(u.s.rangeExtend, 0, moduleId);
    if (moduleId !== 'none') assert.equal(u.base.cost, raw('chess_char_5_12_b').statsBase.cost - 8);
    done(h);
  }
});

// =================================================================================================================
// 归溟幽灵鲨

test('归溟幽灵鲨 S1 生存的技巧: swaps HP ratios with the lowest-ratio other op around her; ATK +', () => {
  for (const id of pair('13')) {
    const h = run({
      defs: { chess: { t_low: ally('t_low'), t_mid: ally('t_mid'), t_far: ally('t_far') }, enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_ghost2_1', { row: 10, col: 4 }), { chessId: 't_low', row: 11, col: 4 }, { chessId: 't_mid', row: 9, col: 3 }, { chessId: 't_far', row: 12, col: 8 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    });
    const u = sel(h, id, 'skchr_ghost2_1');
    const bb = bbOf(u);
    const low = h.unit('t_low'), mid = h.unit('t_mid'), far = h.unit('t_far');
    h.step();
    low.hp = low.s.maxHp * 0.2; mid.hp = mid.s.maxHp * 0.5; far.hp = far.s.maxHp * 0.1;
    u.hp = u.s.maxHp * 0.9;
    const atk0 = u.s.atk;
    cast(h, u);
    approx(u.hpRatio, 0.2, 'she takes 20 %', 1e-3);
    approx(low.hpRatio, 0.9, 'it takes 90 %', 1e-3);
    approx(mid.hpRatio, 0.5);
    approx(far.hpRatio, 0.1, 'outside the area');
    approx(u.s.atk, atk0 * (1 + bb.atk));
    done(h);
  }
});

test('归溟幽灵鲨 S3 生存的重压: ATK/HP +, BAT +1 s, hits all blocked; enemies at ≥ her HP ratio take +atk_scale_ex, else she loses 3 %', () => {
  for (const id of pair('13')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_ghost2_3', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
    const u = sel(h, id, 'skchr_ghost2_3');
    const bb = bbOf(u);
    const e = h.b.enemies[0];
    h.step();
    const atk0 = u.s.atk, iv0 = u.s.interval;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    approx(u.s.maxHp, u.base.maxHp * (1 + tal(u, 1).max_hp + bb.max_hp), 'max HP + (with her own 阿戈尔的深邃)');
    approx(u.s.interval, iv0 * (u.base.bat + bb.base_attack_time) / u.base.bat);
    assert.equal(h.b.effectiveProfile(u).hitAllBlocked, true);
    assert.ok(h.runUntil(() => tagged(h, u, 'ghost2Weight', e).length > 0, 5), 'full-HP enemy: extra hit');
    approx(tagged(h, u, 'ghost2Weight', e)[0].amount, u.s.atk * bb['attack@atk_scale_ex']);
    e.hp = e.s.maxHp * 0.05;
    const n = tagged(h, u, 'ghost2Weight').length;
    const k = attacks(h, u).length;
    const hpBefore = u.hp;
    assert.ok(h.runUntil(() => attacks(h, u).length > k, 5));
    approx(u.hp, hpBefore - u.s.maxHp * bb['attack@hp_ratio'], 'HP loss', 1e-3);
    assert.equal(tagged(h, u, 'ghost2Weight').length, n, 'no extra hit');
    done(h);
  }
});

test('归溟幽灵鲨 S1/S3: the S2 "HP never below 1" guard does not run under other skills; module PUM-Y substitute HP +20 %', () => {
  const h = run({ units: [entry('chess_char_5_13_a', 'skchr_ghost2_3', { row: 10, col: 4 })], defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
  const u = h.unit('chess_char_5_13_a');
  h.step();
  cast(h, u);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.trait.doll, 'lethal damage during S3 → substitute (trait), not a 1-HP guard');
  done(h);
  const hx = run({ units: [{ chessId: 'chess_char_5_13_b', row: 10, col: 4 }] });
  const hy = run({ units: [{ chessId: 'chess_char_5_13_b', row: 10, col: 4, moduleId: 'uniequip_003_ghost2' }] });
  const x = hx.unit('chess_char_5_13_b'), y = hy.unit('chess_char_5_13_b');
  hx.step(); hy.step();
  for (const [g, v] of [[hx, x], [hy, y]]) { g.b.dealDamage(null, v, { amount: 1e9, type: 'true' }); g.run(0.5); assert.ok(v.trait.doll); }
  const t2 = tal(y, 1).max_hp;
  approx(y.s.maxHp / y.base.maxHp, (x.s.maxHp / x.base.maxHp) * (1 + t2 + y.def.traitBb.max_hp) / (1 + t2), 'PUM-Y +20 % substitute HP', 1e-3);
  assert.ok(!y.findBuff('ghost2:module'), 'no PUM-X ATK');
  approx(y.hpRatio, 1, 'full');
  done(hx); done(hy);
});

// =================================================================================================================
// 凛御银灰

test('凛御银灰 S1 周旋的谋略: +10 DP; the waiting op nearest to the eye (cost 16) gets −5 cost and a 50 % max-HP barrier on redeploy', () => {
  for (const id of pair('14')) {
    const h = run({
      defs: { chess: { t_guard: ally('t_guard', { profession: 'WARRIOR', stats: { cost: 20, respawnTime: 999 } }), t_cheap: ally('t_cheap', { stats: { cost: 8, respawnTime: 999 } }) }, enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_svash2_1', { row: 10, col: 4 }), { chessId: 't_guard', row: 12, col: 3 }, { chessId: 't_cheap', row: 12, col: 5 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], flags: { dpPerSec: 0 },
    });
    const u = sel(h, id, 'skchr_svash2_1');
    const bb = bbOf(u);
    const g = h.unit('t_guard'), c = h.unit('t_cheap');
    h.step();
    assert.equal(u.mem.eyeCost, 16, 'the S1 eye');
    for (const a of [g, c]) h.b.dealDamage(null, a, { amount: 1e9, type: 'true' });
    const dp0 = h.b.getPlayer(u.ownerId).dp;
    cast(h, u);
    assert.equal(h.b.getPlayer(u.ownerId).dp, Math.min(h.b.flags.dpMax, dp0 + bb.cost), '+cost DP');
    assert.equal(g.base.cost, 20 - bb['svash2_s_1[deck].cost'], 'right of the eye, guard');
    assert.equal(c.base.cost, 8);
    h.b.redeploy(g);
    const bar = g.findBuff('svash2:barrier');
    assert.ok(bar, 'barrier');
    approx(g.s.shield ?? bar.shield, u.s.maxHp * bb['svash2_s_1[deck].shield']);
    assert.equal(g.base.cost, 20, 'the cut applied to that redeploy');
    done(h);
  }
});

test('凛御银灰 S1 周旋的谋略 (AUTO): fires as soon as SP is full — no enemy, no attack needed (like 伺夜 S1; playtest #6 review)', () => {
  for (const id of pair('14')) {
    const h = run({ units: [entry(id, 'skchr_svash2_1', { row: 10, col: 4 })], flags: { dpPerSec: 0 } });
    const u = sel(h, id, 'skchr_svash2_1');
    assert.equal(u.skill.rule, 'SP_FULL');
    const due = h.b.time + (u.skill.spCost - u.skill.sp) / u.s.spRecovery;   // 精锐 talents start her with more SP
    assert.ok(h.runUntil(() => u.skill.activations === 1, 60), `${id}: cast with no enemy on the field`);
    const st = h.hooksOf('skillStart').find((c) => c.unit === u);
    assert.ok(Math.abs(st.t - due) <= 0.05, `${id}: at full SP (${st.t} vs ${due})`);
    done(h);
  }
});

test('凛御银灰 S3 变革已至: skill range, line attacks bird_atk_scale × ATK + 脆弱, DP 5/6 then +1 per 2 s, first cast swaps waiting costs', () => {
  for (const id of pair('14')) {
    const h = run({
      defs: { chess: { t_hi: ally('t_hi', { profession: 'CASTER', stats: { cost: 30, respawnTime: 999 } }), t_lo: ally('t_lo', { stats: { cost: 6, respawnTime: 999 } }) }, enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_svash2_3', { row: 10, col: 3 }), { chessId: 't_hi', row: 12, col: 3 }, { chessId: 't_lo', row: 12, col: 5 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 4] }, { key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [9, 5] }], flags: { dpPerSec: 0 },
    });
    const u = sel(h, id, 'skchr_svash2_3');
    const bb = bbOf(u);
    const [e1, e2, e3] = h.b.enemies;
    const hi = h.unit('t_hi'), lo = h.unit('t_lo');
    h.step();
    assert.equal(u.mem.eyeCost, 19, 'the S3 eye');
    for (const a of [hi, lo]) h.b.dealDamage(null, a, { amount: 1e9, type: 'true' });
    h.b.getPlayer(u.ownerId).dp = 0;
    cast(h, u);
    const t0 = h.b.time;
    assert.equal(h.b.getPlayer(u.ownerId).dp, bb['svash2_s_3[start_cost].cost']);
    assert.deepEqual([hi.base.cost, lo.base.cost], [6, 30], 'costs swapped');
    assert.ok(u.rangeKeySet.has(10 * COLS + 6), 'skill range');
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack && c.target === e2).length > 0, 5));
    const hit = dealt(h, u, (c) => c.dmg.isAttack);
    const aid = hit.find((c) => c.target === e2).dmg.attackId;
    assert.deepEqual(new Set(hit.filter((c) => c.dmg.attackId === aid).map((c) => c.target)), new Set([e1, e2]), 'the line only');
    for (const c of hit.filter((c) => c.dmg.attackId === aid)) approx(c.amount, u.s.atk * bb.bird_atk_scale);
    assert.ok(!hit.some((c) => c.target === e3 && c.dmg.attackId === aid));
    const f = e2.buffs.find((b) => (b.status ?? b.key) === 'fragile');
    assert.ok(f, '脆弱');
    approx(e2.s.dmgTakenMul, bb.damage_scale);
    h.run(Math.max(0, t0 + 4.1 - h.b.time));
    assert.equal(h.b.getPlayer(u.ownerId).dp, bb['svash2_s_3[start_cost].cost'] + 2 * bb['svash2_s_3[cost].cost'], '+1 per 2 s');
    // second cast: no second swap
    h.run(60);
    cast(h, u);
    assert.deepEqual([hi.base.cost, lo.base.cost], [6, 30], 'first activation only');
    done(h);
  }
});

// =================================================================================================================
// 引星棘刺

test('引星棘刺 S1 度算浪波: an alchemy unit on the lowest-HP ally: DEF +def and hp ratio × ATK/s on the 3×3 around it (+3 s 心相)', () => {
  for (const id of pair('15')) {
    const h = run({
      defs: { chess: { t_low: ally('t_low', { stats: { def: 100 } }), t_near: ally('t_near', { stats: { def: 100 } }), t_far: ally('t_far', { stats: { def: 100 } }) }, enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [entry(id, 'skchr_thorn2_1', { row: 10, col: 3 }), { chessId: 't_low', row: 10, col: 5 }, { chessId: 't_near', row: 11, col: 6 }, { chessId: 't_far', row: 12, col: 9 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 4] }],
    });
    const u = sel(h, id, 'skchr_thorn2_1');
    const bb = bbOf(u), t0 = tal(u, 0);
    const low = h.unit('t_low'), near = h.unit('t_near'), far = h.unit('t_far');
    h.step();
    low.hp = low.s.maxHp * 0.3; near.hp = near.s.maxHp * 0.8; far.hp = far.s.maxHp * 0.8;
    cast(h, u);
    const z = u.mem.zones.at(-1);
    assert.deepEqual([z.type, z.r, z.c], ['guard', 10, 5], 'on the lowest-HP ally');
    approx(z.dur, bb.projectile_delay_time + t0.projectile_extend, '+3 s: another op in her range');
    h.run(1.1);
    for (const a of [low, near]) assert.equal(a.s.def, 100 + bb.def, a.defId);
    assert.equal(far.s.def, 100);
    approx(heals(h, u, (c) => c.target === near)[0].amount, u.s.atk * bb.hp_recovery_per_sec_ratio);
    mute(h, u);
    h.run(z.dur);
    assert.ok(!u.mem.zones.includes(z), 'expired');
    assert.equal(low.s.def, 100, 'no DEF bonus afterwards');
    done(h);
  }
});

test('引星棘刺 S3 “我的海疆”: passive skill range; alchemy units on the 3 lowest-block ops debuff (不叠加) and burn enemies around them, ramping to the max after 15 s', () => {
  for (const id of pair('15')) {
    const h = run({
      defs: {
        chess: { t_b0: ally('t_b0', { stats: { blockCnt: 0 } }), t_b1: ally('t_b1', { stats: { blockCnt: 1 } }), t_b2: ally('t_b2', { stats: { blockCnt: 2 } }), t_b3: ally('t_b3', { stats: { blockCnt: 3 } }) },
        enemies: { enemy_dummy: dummy('enemy_dummy', { atk: 100, def: 100 }), enemy_res: dummy('enemy_res', { res: 50 }) },
      },
      units: [entry(id, 'skchr_thorn2_3', { row: 10, col: 3 }), { chessId: 't_b0', row: 12, col: 8 }, { chessId: 't_b1', row: 12, col: 9 }, { chessId: 't_b2', row: 9, col: 9 }, { chessId: 't_b3', row: 9, col: 5 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_dummy', pos: [11, 9] }, { key: 'enemy_dummy', pos: [9, 7] }, { key: 'enemy_res', pos: [12, 7] }],
    });
    const u = sel(h, id, 'skchr_thorn2_3');
    const bb = bbOf(u);
    const [e1, e2, e3, er] = h.b.enemies;
    h.step();
    assert.ok(u.rangeKeySet.has(10 * COLS + 7) && u.baseRangeKeys.includes(10 * COLS + 7), 'passive: the skill range is her range (and trigger range)');
    cast(h, u);
    const anchors = u.mem.zones.map((z) => z.anchor.defId).sort();
    const ownBlk = u.s.blockCnt;
    assert.deepEqual(anchors, (ownBlk <= 1 ? [u.defId, 't_b0', 't_b1'] : ['t_b0', 't_b1', 't_b2']).sort(), 'the 3 lowest block counts');
    h.run(0.6);
    const b = e2.findBuff('thorn2:sea');
    assert.ok(b, 'around t_b0 / t_b1');
    approx(e2.s.atk, 100 * (1 + bb.atk));
    approx(e2.s.def, 100 * (1 + bb.def));
    approx(er.s.res, 50 * (1 + bb.magic_resistance), 'RES −%');
    assert.equal(e2.buffs.filter((x) => x.key === 'thorn2:sea').length, 1, '不叠加: one debuff under two units');
    const first = tagged(h, u, 'mySea', e2);
    assert.equal(first.length, 2, 'the first burn lands with the units (two units around e2)');
    for (const c of first) approx(c.amount, u.s.atk * bb.atk_scale, 'first burn');
    h.run(bb.max_stack_cnt * bb.interval + 0.5);
    approx(e2.s.atk, 100 * (1 + bb.max_atk), 'max ATK cut');
    approx(e2.s.def, 100 * (1 + bb.max_def), 'max DEF cut');
    approx(er.s.res, 50 * (1 + bb.max_magic_resistance), 'max RES cut');
    approx(tagged(h, u, 'mySea', e2).at(-1).amount, u.s.atk * bb.max_atk_scale, 'max scale');
    assert.equal(tagged(h, u, 'mySea', e3).length, 0, 'not around an anchor');
    h.run(bb.projectile_delay_time);
    assert.equal(e2.findBuff('thorn2:sea'), null, 'expired');
    assert.ok(e1);
    done(h);
  }
});

// =================================================================================================================
// 山

test('山 S1 左勾扫拳: next attack atk_scale × ATK on 2 enemies (×1.6 巨力重拳 crits allowed)', () => {
  for (const id of pair('17')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_f12yin_1', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }, { key: 'enemy_dummy', pos: [10, 4] }] });
    const u = sel(h, id, 'skchr_f12yin_1');
    const bb = bbOf(u), t0 = tal(u, 0);
    h.step();
    cast(h, u);
    assert.ok(h.runUntil(() => attacks(h, u, (c) => c.isSkill).length > 0, 5));
    const a = attacks(h, u, (c) => c.isSkill)[0];
    assert.equal(a.targets.length, bb.max_target);
    for (const c of dealt(h, u, (c) => c.dmg.isSkill)) {
      const r = c.amount / (u.s.atk * bb.atk_scale);
      assert.ok(Math.abs(r - 1) < 1e-6 || Math.abs(r - t0.atk_scale) < 1e-6, `×${r}`);
    }
    done(h);
  }
});

test('山 S3 震地碎岩击: BAT +0.7 s, ATK +, double hits on up to 3 enemies, pushes them; 巨力重拳 chance → talent@prob', () => {
  for (const id of pair('17')) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { mass: 0 }) } },
      units: [entry(id, 'skchr_f12yin_3', { row: 10, col: 5 })],
      enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [9, 5] }, { key: 'enemy_dummy', pos: [11, 5] }, { key: 'enemy_dummy', pos: [10, 4] }],
    });
    const u = sel(h, id, 'skchr_f12yin_3');
    const bb = bbOf(u), t0 = tal(u, 0);
    h.step();
    const probs = [];
    const chance = h.b.rng.chance.bind(h.b.rng);
    h.b.rng.chance = (p) => { probs.push(p); return chance(p); };
    h.run(2);
    const atk0 = u.s.atk, iv0 = u.s.interval;
    assert.ok(probs.includes(t0.prob), 'plain chance before');
    probs.length = 0;
    const pos0 = h.b.enemies.map((e) => [e.x, e.y]);
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    approx(u.s.interval, iv0 * (u.base.bat + bb.base_attack_time) / u.base.bat);
    assert.ok(h.runUntil(() => attacks(h, u, (c) => c.isSkill).length > 0, 5));
    const a = attacks(h, u, (c) => c.isSkill)[0];
    assert.equal(a.targets.length, bb['attack@max_target']);
    for (const t of a.targets) assert.equal(dealt(h, u, (c) => c.target === t && c.dmg.isSkill).length, 2, 'double hit');
    const moved = h.b.enemies.filter((e, i) => Math.hypot(e.x - pos0[i][0], e.y - pos0[i][1]) > 0.4);
    assert.equal(moved.length, bb['attack@max_target'], 'pushed');
    assert.ok(probs.length && probs.every((p) => p === bb['talent@prob']), `talent@prob ${probs}`);
    done(h);
  }
});

test('山 module FGT-X (夜深人静): an own 15 % physical dodge on top of 强壮肉体; no ASPD rider', () => {
  const h = run({ units: [{ chessId: 'chess_char_5_17_b', row: 10, col: 4, moduleId: 'uniequip_003_f12yin' }] });
  const u = h.unit('chess_char_5_17_b');
  h.step();
  approx(u.s.dodgePhys, 1 - (1 - tal(u, 1).prob) * (1 - u.def.traitBb.prob));
  assert.equal(u.s.aspd, u.base.aspd);
  done(h);
});

// =================================================================================================================
// 玛恩纳

test('玛恩纳 S1 未声张的怒火 (SEARCH): cast once an enemy is inside his initial range, not before; attacks attack@atk_scale × ATK (×1.1 游侠), DEF +', () => {
  for (const id of pair('19')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_mlynar_1', { row: 10, col: 3 })], enemies: [{ key: 'enemy_dummy', pos: [12, 9] }] });
    const u = sel(h, id, 'skchr_mlynar_1');
    const bb = bbOf(u), t0 = tal(u, 0);
    h.step();
    const def0 = u.s.def;
    // research 03 Addendum C1 (BWIKI): "解放者/阵法术师子职业干员 技能1，初始攻击范围内出现敌人后自动释放"
    u.skill.gainSp(1000);
    h.run(2);
    assert.equal(u.skill.activations, 0, `${id}: an enemy elsewhere on the field does not trigger SEARCH`);
    const e = h.spawn('enemy_dummy', { pos: [10, 4] });
    assert.ok(h.runUntil(() => u.skill.activations > 0, 1), `${id}: cast once an enemy is in range`);
    assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'SEARCH');
    approx(u.s.def, def0 * (1 + bb.def));
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.target === e && c.dmg.isAttack).length > 0, 5));
    approx(dealt(h, u, (c) => c.target === e && c.dmg.isAttack)[0].amount, u.s.atk * bb['attack@atk_scale'] * t0.atk_scale_base);
    done(h);
  }
});

test('玛恩纳 S2 未宽解的悲哀: skill range, BAT +0.3 s, double hits at attack@atk_scale; a kill keeps the trait ramp at the end', () => {
  for (const id of pair('19')) {
    for (const kill of [true, false]) {
      const h = run({
        defs: { enemies: { enemy_dummy: dummy('enemy_dummy'), enemy_weak: dummy('enemy_weak', { hp: 10 }) } },
        units: [entry(id, 'skchr_mlynar_2', { row: 10, col: 3 })], enemies: [{ key: 'enemy_dummy', pos: [10, 4] }],
      });
      const u = sel(h, id, 'skchr_mlynar_2');
      const bb = bbOf(u), t0 = tal(u, 0);
      h.run(10);
      const iv0 = u.s.interval;
      cast(h, u);
      const ramp = u.trait.ramp;
      assert.ok(ramp > 0);
      approx(u.s.interval, iv0 * (u.base.bat + bb.base_attack_time) / u.base.bat);
      assert.ok(u.rangeKeySet.has(10 * COLS + 5), 'skill range (2 ahead)');
      assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 2, 5));
      const hits = dealt(h, u, (c) => c.dmg.isAttack);
      assert.equal(hits.filter((c) => c.dmg.attackId === hits[0].dmg.attackId).length, 2, '二连击');
      approx(hits[0].amount, u.s.atk * bb['attack@atk_scale'] * t0.atk_scale_base);
      if (kill) { const e = h.b.enemies[0]; e.hp = 1; assert.ok(h.runUntil(() => !e.alive, 5), 'killed during the skill'); }
      assert.ok(h.runUntil(() => !u.skill.active, 30));
      if (kill) approx(u.trait.ramp, ramp, 'kept'); else assert.equal(u.trait.ramp, 0, 'reset');
      done(h);
    }
  }
});

// =================================================================================================================
// 安洁莉娜

test('安洁莉娜 S1 秘杖·速充模式: she attacks without the skill (attack SP), then ATK +', () => {
  for (const id of pair('20')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_aglina_1', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
    const u = sel(h, id, 'skchr_aglina_1');
    const bb = bbOf(u);
    h.step();
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSkill).length > 0, 5), 'plain attacks off-skill');
    const atk0 = u.s.atk;
    assert.ok(h.runUntil(() => u.skill.active, 60), 'attack SP fills');
    approx(u.s.atk, atk0 * (1 + bb.atk));
    done(h);
  }
});

test('安洁莉娜 S2 秘杖·微粒模式 (SEARCH): no attack off-skill; interval ×base_attack_time, each attack damage_scale × ATK arts', () => {
  for (const id of pair('20')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_aglina_2', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
    const u = sel(h, id, 'skchr_aglina_2');
    const bb = bbOf(u);
    h.run(2);
    assert.equal(dealt(h, u).length, 0, 'no attack off-skill');
    const iv0 = u.s.interval;
    cast(h, u);
    approx(u.s.interval, iv0 * bb.base_attack_time, '极大幅度缩短');
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack).length >= 5, 5));
    approx(dealt(h, u, (c) => c.dmg.isAttack)[0].amount, u.s.atk * bb.damage_scale);
    done(h);
  }
});

test('安洁莉娜 module DEC-X (实验用反重力模块): SP +0.2/s with an enemy in range', () => {
  const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [{ chessId: 'chess_char_5_20_b', row: 10, col: 4, moduleId: 'uniequip_003_aglina' }] });
  const u = h.unit('chess_char_5_20_b');
  h.run(0.5);
  assert.equal(u.s.spRecovery, u.base.spRecovery);
  h.spawn('enemy_dummy', { pos: [10, 5] });
  h.run(0.5);
  approx(u.s.spRecovery, u.base.spRecovery + tal(u, -1).sp_recovery_per_sec);
  done(h);
});

// =================================================================================================================
// 寒檀

test('寒檀 S1 迅捷打击·γ型: ATK +, ASPD + for the duration', () => {
  for (const id of pair('21')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skcom_quickattack[3]', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }] });
    const u = sel(h, id, 'skcom_quickattack[3]');
    const bb = bbOf(u);
    h.step();
    const atk0 = u.s.atk, aspd0 = u.s.aspd;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    assert.equal(u.s.aspd, aspd0 + bb.attack_speed);
    h.run(rec(id, 'skcom_quickattack[3]').duration + 0.5);
    assert.equal(u.s.aspd, aspd0);
    done(h);
  }
});

// =================================================================================================================
// 妮芙

test('妮芙 S1 笞心击: ATK +; attacks add 10 % 凋亡 and, on a bursting target, extra_ep_damage_scale × ATK elemental', () => {
  for (const id of pair('22')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_nymph_1', { row: 10, col: 4 })], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
    const u = sel(h, id, 'skchr_nymph_1');
    const bb = bbOf(u), tb = u.def.traitBb;
    const e = h.b.enemies[0];
    h.step();
    const atk0 = u.s.atk;
    cast(h, u);
    approx(u.s.atk, atk0 * (1 + bb.atk));
    assert.ok(h.runUntil(() => during(h, u, dealt(h, u, (c) => c.dmg.isAttack && c.type === 'arts')).length > 0, 5));
    const hit = during(h, u, dealt(h, u, (c) => c.dmg.isAttack && c.type === 'arts'))[0];
    const ep = dealt(h, u, (c) => c.type === 'element' && c.t === hit.t);
    assert.ok(ep.length > 0, '凋亡损伤');
    approx(ep[0].amount, hit.amount * bb['attack@ep_damage_ratio']);
    assert.equal(tagged(h, u, 'nymphLash').length, 0, 'no burst yet');
    h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 5000 });
    assert.ok(h.runUntil(() => tagged(h, u, 'nymphLash', e).length > 0, 5));
    approx(tagged(h, u, 'nymphLash', e)[0].amount, u.s.atk * bb['attack@extra_ep_damage_scale'] * (tb.damage_scale ?? 1), 'extra (× PRI-X on the elite)');
    done(h);
  }
});

test('妮芙 S3 心防溃决: skill range, ATK/ASPD +, 2 targets; attacks on a bursting target are elemental damage', () => {
  for (const id of pair('22')) {
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy', { res: 50 }) } }, units: [entry(id, 'skchr_nymph_3', { row: 10, col: 3 })], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [9, 5] }] });
    const u = sel(h, id, 'skchr_nymph_3');
    const bb = bbOf(u), tb = u.def.traitBb;
    const [e1, e2] = h.b.enemies;
    h.step();
    h.b.dealDamage(null, e1, { type: 'element', element: 'apoptosis', amount: 5000 });
    const aspd0 = u.s.aspd;
    cast(h, u);
    approx(u.s.atk, u.base.atk * (1 + bb.atk + (u.findBuff('nymph:key')?.stacks ?? 0) * tal(u, 1).atk), 'ATK + (with the 窥心钥 stack of that burst)');
    assert.equal(u.s.aspd, aspd0 + bb.attack_speed);
    assert.ok(u.rangeKeySet.has(10 * COLS + 6), 'skill range');
    assert.ok(h.runUntil(() => attacks(h, u, (c) => c.isSkill).length > 0, 5));
    h.run(1);
    assert.equal(attacks(h, u, (c) => c.isSkill)[0].targets.length, bb['attack@max_target']);
    const b1 = dealt(h, u, (c) => c.target === e1 && c.dmg.isAttack && c.dmg.isSkill)[0];
    assert.equal(b1.type, 'elemental', 'burst target: elemental');
    const n2 = dealt(h, u, (c) => c.target === e2 && c.dmg.attackId === b1.dmg.attackId)[0];
    assert.equal(n2.type, 'arts');
    approx(b1.amount, 2 * n2.amount * bb['attack@split_atk_scale'] * (tb.damage_scale ?? 1), 'elemental ignores RES 50 (× PRI-X on the elite)');
    done(h);
  }
});

// =================================================================================================================
// 录武官

test('录武官 S1 触类旁通 (charges): the next heal restores heal_scale × ATK to 2 allies', () => {
  for (const id of pair('23')) {
    const h = run({
      defs: { chess: { t_a: ally('t_a'), t_b: ally('t_b') } },
      units: [entry(id, 'skchr_reckpr_1', { row: 10, col: 3 }), { chessId: 't_a', row: 10, col: 4 }, { chessId: 't_b', row: 10, col: 5 }],
    });
    const u = sel(h, id, 'skchr_reckpr_1');
    const bb = bbOf(u);
    const a = h.unit('t_a'), b = h.unit('t_b');
    h.step();
    assert.equal(u.skill.maxCharges, rec(id, 'skchr_reckpr_1').maxChargeTime);
    a.hp = a.s.maxHp * 0.6; b.hp = b.s.maxHp * 0.7;
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => attacks(h, u, (c) => c.isSkill).length > 0, 5));
    const at = attacks(h, u, (c) => c.isSkill)[0];
    assert.equal(at.targets.length, bb.max_target);
    for (const t of [a, b]) approx(heals(h, u, (c) => c.target === t)[0].amount, u.s.atk * bb.heal_scale, t.defId);
    done(h);
  }
});

// =================================================================================================================
// modules: 'none' on the chess whose only module is the default one; default-skill machinery under other skills

test('module "none": 缇缇 heals 50 % (not 60 %), 乌尔比安 no healing ×1.2, 引星棘刺 no SP while a unit is out, 玛恩纳 no +100 % at deploy, 寒檀 full cost, 录武官 no ×1.15', () => {
  const h = run({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') }, chess: { t_a: ally('t_a') } },
    units: [
      { chessId: 'chess_char_5_02_b', row: 9, col: 3, moduleId: 'none' }, { chessId: 'chess_char_5_05_b', row: 9, col: 4, moduleId: 'none' },
      { chessId: 'chess_char_5_15_b', row: 10, col: 3, moduleId: 'none' }, { chessId: 'chess_char_5_19_b', row: 10, col: 4, moduleId: 'none' },
      { chessId: 'chess_char_5_21_b', row: 11, col: 3, moduleId: 'none' }, { chessId: 'chess_char_5_23_b', row: 11, col: 4, moduleId: 'none' },
      { chessId: 't_a', row: 12, col: 9 },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const titi = h.unit('chess_char_5_02_b'), ulpia = h.unit('chess_char_5_05_b'), thorn = h.unit('chess_char_5_15_b');
  const mly = h.unit('chess_char_5_19_b'), sntlla = h.unit('chess_char_5_21_b'), reck = h.unit('chess_char_5_23_b');
  assert.equal(titi.profile.healRatio, 0.5);
  assert.equal(ulpia.s.healingTakenMul, 1);
  assert.equal(mly.trait.ramp, 0, 'no init_atk');
  assert.equal(sntlla.base.cost, raw('chess_char_5_21_b').statsBase.cost);
  const a = h.unit('t_a');
  a.hp = 3000;
  approx(h.b.heal(reck, a, 100), 100, 'no PHY-X');
  thorn.skill.gainSp(1000);
  assert.ok(h.runUntil(() => (thorn.mem.zones || []).length > 0, 5));
  h.run(0.5);
  assert.equal(thorn.findBuff('thorn2:module'), null, 'no ALC-X');
  done(h);
});

test('default-skill machinery stays with the default skill: 圣约送葬人 S1 never dodges, 缇缇 S1 has no sleep guard, 玛恩纳 S1 adds no Kazimierz mark', () => {
  const h = run({
    defs: { enemies: { enemy_hitter: dummy('enemy_hitter', { atk: 300, bat: 0.5 }) }, chess: { t_a: ally('t_a'), t_kaz: ally('t_kaz', { bonds: ['kazimierzShip'], stats: { atk: 500 } }) } },
    units: [entry('chess_char_5_01_a', 'skchr_excu2_1', { row: 9, col: 5 }), entry('chess_char_5_02_a', 'skchr_titi_1', { row: 10, col: 3 }), { chessId: 't_a', row: 10, col: 4 },
      entry('chess_char_5_19_a', 'skchr_mlynar_1', { row: 12, col: 5 }), { chessId: 't_kaz', row: 12, col: 4 }],
    enemies: [{ key: 'enemy_hitter', pos: [9, 5] }, { key: 'enemy_hitter', pos: [12, 5] }],
  });
  const ex = h.unit('chess_char_5_01_a'), ti = h.unit('chess_char_5_02_a'), ml = h.unit('chess_char_5_19_a');
  for (const u of [ex, ti, ml]) u.skill.gainSp(1000);
  h.run(3);
  assert.ok(ex.skill.activations > 0 && ti.skill.activations > 0 && ml.skill.activations > 0);
  assert.equal(h.hooksOf('dodge')?.length ?? 0, 0);
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'dodge' && e[4]?.id === ex.id).length, 0, 'no S2 dodge');
  const a = h.unit('t_a');
  h.b.dealDamage(null, a, { amount: 1e9, type: 'true' });
  assert.ok(!a.alive, 'no S3 sleep guard');
  assert.equal(tagged(h, ml, 'mlynarMark').length, 0, 'no S3 mark');
  done(h);
});

// =================================================================================================================
// adversarial review regressions

test('号角 S1 / 塞雷娅 S1 (自动触发, elite: 2 charges): hits never arm them; a cast "next attack" still waiting never spends the other charge', () => {
  // 号角 S1: the data rule DEFAULT — each charge is cast with one of her attacks (hits taken do nothing)
  {
    const id = 'chess_char_5_08_b';
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, units: [entry(id, 'skchr_horn_1', { row: 10, col: 2 })], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
    const u = sel(h, id, 'skchr_horn_1');
    const e = h.b.enemies[0];
    const starts = () => h.hooksOf('skillStart').filter((c) => c.unit === u);
    h.step();
    u.atkCd = 3;
    u.skill.gainSp(1000);
    assert.equal(u.skill.charges, 2, `${id}: 2 charges`);
    for (let i = 0; i < 3; i++) h.b.dealDamage(e, u, { amount: 10, type: 'phys' });
    assert.equal(starts().length, 0, 'hits do not arm it');
    assert.ok(h.runUntil(() => starts().length >= 2, 15), 'both charges are cast');
    const shots = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
    assert.equal(new Set(shots.slice(0, 2).map((c) => c.t)).size, 2, 'one charge per attack');
    done(h);
  }
  // 塞雷娅 S1: DEFAULT + an ally of the area at ≤ half HP — each charge replaces one of her attacks (no heal mode waits)
  {
    const id = 'chess_char_5_11_b';
    const h = run({ defs: { enemies: { enemy_dummy: dummy('enemy_dummy') }, chess: { t_low: ally('t_low'), t_low2: ally('t_low2') } },
      units: [entry(id, 'skchr_demkni_1', { row: 10, col: 4 }), { chessId: 't_low', row: 11, col: 4 }, { chessId: 't_low2', row: 9, col: 4 }],
      enemies: [{ key: 'enemy_dummy', pos: [10, 4] }] });
    const u = sel(h, id, 'skchr_demkni_1');
    const e = h.b.enemies[0];
    const starts = () => h.hooksOf('skillStart').filter((c) => c.unit === u).length;
    h.step();
    u.atkCd = 2;
    u.skill.gainSp(1000);
    assert.equal(u.skill.charges, 2, `${id}: 2 charges`);
    h.unit('t_low').hp = h.unit('t_low').s.maxHp * 0.3;
    h.unit('t_low2').hp = h.unit('t_low2').s.maxHp * 0.3;
    for (let i = 0; i < 3; i++) h.b.dealDamage(e, u, { amount: 10, type: 'phys' });
    h.run(1);
    assert.equal(starts(), 0, 'hits do not arm it, nor does the injured ally alone: it waits for her attack');
    assert.ok(h.runUntil(() => starts() === 1, 2), 'her attack casts one charge');
    assert.ok(!u.skill.pending, 'and is the heal');
    assert.equal(u.skill.charges, 1, 'the second charge stays stored');
    assert.ok(h.runUntil(() => starts() === 2, 5), 'her next attack heals the other one');
    assert.equal(heals(h, u).length, 2);
    assert.notEqual(heals(h, u)[0].target, heals(h, u)[1].target);
    assert.ok(!u.skill.pending);
    mute(h, u);
    u.skill.gainSp(1000);
    h.unit('t_low').hp = h.unit('t_low').s.maxHp * 0.3;
    h.run(3);
    assert.equal(starts(), 2, `${id}: silenced`);
    done(h);
  }
});

test('圣约送葬人 module REA-Y: the reaper heal stays the base 50 per enemy hit (the module trait "value" 12 is display-only: the ASPD text); REA-X 60, none 50', () => {
  for (const [moduleId, want] of [['uniequip_003_excu2', 50], ['uniequip_002_excu2', 60], ['none', 50]]) {
    const h = run({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } },
      units: [{ chessId: 'chess_char_5_01_b', row: 10, col: 4, moduleId }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    });
    const u = h.unit('chess_char_5_01_b');
    assert.equal(u.profile.selfHeal, want, moduleId);
    mute(h, u);
    u.hp = u.s.maxHp / 2;
    assert.ok(h.runUntil(() => heals(h, u, (c) => c.target === u).length > 0, 5), moduleId);
    approx(heals(h, u, (c) => c.target === u)[0].amount, want, `${moduleId}: one enemy hit`);
    done(h);
  }
});
