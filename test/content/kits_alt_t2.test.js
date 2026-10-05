// Operator loadouts (DESIGN §16) for the tier-2 kits (server/sim/content/kits/tier2.js): every selectable NON-default
// skill of every visible tier-2 chess is hand-authored (tools/kit-coverage.mjs) and shows its signature effect for the
// normal (Lv4) and the elite (Lv7) chess — numbers from the selected skill's blackboard (data/chess.json skills[]) —
// and the elite's module choice ('none' instead of the default module) changes what the kit / profile does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { KITS, skillSpecSource } from '../../server/sim/content/index.js';
import { kitCoverage } from '../../tools/kit-coverage.mjs';

const ds = getDefaultSource();
const raw = (id) => ds.rawChess(id);
/** The selectable non-default SkillRecord of a chess (tier 2 chess are E1: one alternative). */
const alt = (id) => raw(id).skills.find((s) => !s.isDefault);
const bbAlt = (id) => alt(id).bb;
/** Named talent blackboard / trait blackboard of the loadout-resolved record. */
const tal = (id, lo = null, i = 0) => ds.getChess(id, lo).raw.talents.filter((t) => t.index !== -1)[i]?.bb ?? {};
const tbOf = (id, lo = null) => ds.getChess(id, lo).raw.trait?.bb ?? {};
const both = (base) => [`${base}_a`, `${base}_b`];
const NONE = { moduleId: 'none' };

const approx = (a, b, msg = '', rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const READY = { sp: 999 }; // carryState: skill fully charged at deployment
const IDLE = { sp: 0 };    // carryState: no initial SP
const HOOKS = ['damaged', 'heal', 'skillStart', 'skillEnd', 'statusApplied', 'attack', 'death', 'deploy'];

function run(o) {
  return makeBattle({ seed: 7, autoFinish: false, timeLimit: 400, hooks: HOOKS, captureNoisy: true, ...o });
}
/** Unit entry with the alternate skill selected (plus loadout / carry extras). */
const U = (id, row, col, o = {}) => ({ chessId: id, row, col, skillIndex: alt(id).index, ...o });
const dealt = (h, u, f = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && f(c));
const statuses = (h, key, f = () => true) => h.hooksOf('statusApplied').filter((c) => c.status === key && f(c));
const heals = (h, u, f = () => true) => h.hooksOf('heal').filter((c) => c.source === u && f(c));
const tagged = (tag) => (c) => (c.dmg?.tags || c.opts?.tags || []).includes(tag);
const started = (h, u) => h.hooksOf('skillStart').filter((c) => c.unit === u);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
/** The selected skill is the alternative one, authored by the kit (not the generic fallback). */
function usesAlt(u, id) {
  assert.equal(u.skill.id, alt(id).skillId, `${id} runs ${alt(id).name}`);
  assert.equal(u.kit.skillSource, 'skills', `${id}: hand-authored spec`);
}
/** defs.chess override: the chess without its 特质 (garrison buffs would blur the ATK numbers). */
const noGarrison = (id) => ({ [id]: { ...raw(id), garrisonIds: [] } });
/** Plain operator without skill / talents (heal targets, lock candidates). */
const plain = (id, o = {}) => chessRec({ id, skill: null, ...o });

// =================================================================================================================
// coverage

test('kit coverage: every selectable skill of every visible tier-2 chess is hand-authored (normal + elite)', () => {
  const rep = kitCoverage({ tier: 2 });
  assert.equal(rep.summary.chess, 17);
  assert.equal(rep.summary.covered, rep.summary.skills, JSON.stringify(rep.chess.filter((r) => r.skills.some((s) => !s.covered)).map((r) => r.name)));
  for (const r of rep.chess) {
    for (const s of r.skills.filter((x) => !x.isDefault)) {
      assert.deepEqual([s.normal, s.elite], ['skills', 'skills'], `${r.name} S${s.index + 1} ${s.name}`);
      // the def of every legal loadout (module choices included) resolves to the authored spec
      for (const id of [r.chessId, raw(r.chessId).goldenId].filter(Boolean)) {
        for (const moduleId of [null, 'none']) {
          const def = ds.getChess(id, { skillIndex: s.index, moduleId });
          assert.equal(def.skill.id, s.skillId);
          assert.equal(skillSpecSource(def, KITS), 'skills', `${id} ${s.skillId} module ${moduleId}`);
        }
      }
    }
  }
});

// =================================================================================================================
// alternate skills (normal Lv4 + elite Lv7)

test('2_01 送葬人 S1 铳口收束: ATK +atk; the trait multiplier hits every enemy in range (not only the front row); no double hits', () => {
  for (const id of both('chess_char_2_01')) {
    const bb = bbAlt(id), fs = tbOf(id).atk_scale;
    const setup = (carry) => run({
      defs: { enemies: { e: dummy('e') } },
      units: [U(id, 10, 4, { carryState: carry })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [11, 6] }],
    });
    // control: without the skill the off-row enemy takes ×1
    const c = setup(IDLE);
    c.step();
    const cu = c.unit(id), off0 = c.enemies()[1];
    c.run(1);
    assert.ok(!cu.skill.active);
    approx(dealt(c, cu, (x) => x.target === off0)[0].amount, cu.s.atk, `${id} off-row ×1 without the skill`);
    done(c);

    const h = setup(READY);
    const u = h.unit(id);
    usesAlt(u, id);
    h.run(3);
    assert.ok(u.skill.active);
    approx(u.s.atk, u.base.atk * (1 + bb.atk), 'ATK');
    approx(u.s.interval, u.base.bat * 100 / u.s.aspd, 'attack interval unchanged (最终旅程 only)');
    const [front, off] = h.enemies();
    const hits = dealt(h, u, (x) => x.dmg.isAttack);
    const atks = h.hooksOf('attack').filter((x) => x.attacker === u).length;
    assert.equal(hits.length, 2 * atks, 'one hit per enemy and attack');
    for (const x of hits.filter((y) => y.target === off)) approx(x.amount, u.s.atk * fs, `${id} off-row ×${fs}`);
    for (const x of hits.filter((y) => y.target === front)) approx(x.amount, u.s.atk * fs, `${id} front ×${fs}`);
    assert.ok(hits.some((y) => y.target === off));
    assert.equal(u.skill.duration, alt(id).duration);
    done(h);
  }
});

test('2_02 赫默 S1 治疗强化·γ型: ATK +atk heals for its duration, no drone', () => {
  for (const id of both('chess_char_2_02')) {
    const bb = bbAlt(id);
    const h = run({ defs: { chess: { t_a: plain('t_a') } }, units: [U(id, 10, 4, { carryState: READY }), { chessId: 't_a', row: 9, col: 6 }] });
    const u = h.unit(id), a = h.unit('t_a');
    usesAlt(u, id);
    h.step();
    a.hp = a.s.maxHp * 0.3;
    h.run(1);
    assert.ok(u.skill.active);
    approx(u.s.atk, u.base.atk * (1 + bb.atk));
    const hh = heals(h, u, (c) => c.target === a);
    assert.ok(hh.length > 0);
    approx(hh[0].amount, u.s.atk * (tbOf(id).heal_scale ?? 1), 'heal (elite module: ×heal_scale on ground units)');
    assert.ok(h.b.allyUnits.every((x) => x.kind !== 'token'), 'no medical drone');
    const t0 = started(h, u)[0].t;
    h.runUntil(() => !u.skill.active, 40);
    approx(h.b.time - t0, alt(id).duration, 'duration', 0.02);
    done(h);
  }
});

test('2_04 小满 S1 竹笛飞声: two charges; each next attack deals atk_scale × ATK arts to one extra enemy; no sleep', () => {
  for (const id of both('chess_char_2_04')) {
    const bb = bbAlt(id);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 5] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    assert.equal(u.skill.maxCharges, bb.ct);
    h.run(u.s.interval * 2.5);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u);
    assert.ok(atks.length >= 3);
    assert.deepEqual(atks.slice(0, 3).map((c) => [c.isSkill, c.targets.length]), [[true, 2], [true, 2], [false, 1]], 'two charged attacks on 2 targets, then normal');
    for (const c of dealt(h, u, (x) => x.dmg.isAttack && x.t <= atks[1].t + 1e-9)) {
      assert.equal(c.type, 'arts');
      approx(c.amount, u.s.atk * bb.atk_scale, `${id} ×${bb.atk_scale}`);
    }
    for (const c of dealt(h, u, (x) => x.dmg.isAttack && x.t >= atks[2].t - 1e-9)) approx(c.amount, u.s.atk, 'normal attack ×1');
    assert.equal(statuses(h, 'sleep').length, 0, 'no 乡音沉沉 sleep');
    done(h);
  }
});

test('2_05 哈洛德 S1 治疗强化·γ型: ATK +atk; the 重症优先 target order is S2-only (lowest HP first)', () => {
  for (const id of both('chess_char_2_05')) {
    const bb = bbAlt(id);
    const h = run({ defs: { chess: { ...noGarrison(id), t_low: plain('t_low'), t_el: plain('t_el') } }, units: [U(id, 10, 4, { carryState: READY }), { chessId: 't_low', row: 10, col: 5 }, { chessId: 't_el', row: 11, col: 5 }] });
    const u = h.unit(id), low = h.unit('t_low'), el = h.unit('t_el');
    usesAlt(u, id);
    h.step();
    low.hp = low.s.maxHp * 0.3;
    el.elem.neural = 900;
    h.step();
    assert.ok(u.skill.active);
    approx(u.s.atk, u.base.atk * (1 + bb.atk));
    const first = h.hooksOf('attack').find((c) => c.attacker === u);
    assert.equal(first.targets[0], low, 'lowest HP ratio first, not the element-damaged ally');
    done(h);
  }
});

test('2_06 莎草 S2 临考发挥: locks the highest-max-HP ally as the only main target; ATK +atk, shorter interval, +1 chain jump', () => {
  for (const id of both('chess_char_2_06')) {
    const bb = bbAlt(id);
    const defs = { chess: { t_big: plain('t_big', { stats: { maxHp: 9000 } }), t_1: plain('t_1'), t_2: plain('t_2'), t_3: plain('t_3') } };
    const h = run({ defs, units: [U(id, 10, 4, { carryState: READY }), { chessId: 't_big', row: 10, col: 5 }, { chessId: 't_1', row: 9, col: 5 }, { chessId: 't_2', row: 11, col: 5 }, { chessId: 't_3', row: 10, col: 6 }] });
    const u = h.unit(id), big = h.unit('t_big');
    usesAlt(u, id);
    const count0 = u.profile.heal.count;
    h.step();
    for (const k of ['t_1', 't_2', 't_3']) { const a = h.unit(k); a.hp = a.s.maxHp * 0.2; }
    h.runUntil(() => u.skill.active, 5);
    assert.equal(u.mem.papyrsLock, big, 'locked: highest max HP (at full HP)');
    approx(u.s.atk, u.base.atk * (1 + bb.atk));
    approx(u.s.interval, (u.base.bat + bb.base_attack_time) * 100 / u.s.aspd, 'base attack time −1.1 s');
    assert.equal(u.profile.heal.count, count0 + bb['attack@chain.extra_value']);
    h.run(u.s.interval * 2.2);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u);
    assert.ok(atks.length >= 2);
    for (const c of atks) assert.equal(c.targets[0], big, 'the locked ally is the only main target');
    const firstHeals = heals(h, u, (c) => Math.abs(c.t - atks[0].t) < 1e-9 && !(c.opts?.tags || []).length);
    assert.equal(firstHeals.length, count0 + bb['attack@chain.extra_value'], 'main target + jumps (one more)');
    // the lock leaves the field ⇒ the skill stops at once; the chain count is restored
    h.b.retreat(big, { reason: 'retreat', permanent: true });
    h.step(2);
    assert.ok(!u.skill.active);
    assert.equal(h.hooksOf('skillEnd').find((c) => c.unit === u).reason, 'target');
    assert.equal(u.profile.heal.count, count0);
    done(h);
  }
});

test('2_06 莎草 S2 临考发挥: "无法可选单位时无法开启技能" — no lockable ally ⇒ never activates (no skillStart / 萨尔贡 gains, SP kept)', () => {
  for (const id of both('chess_char_2_06')) {
    // alone and injured, then with a 禁疗 ally in range: the DEFAULT heal trigger holds, but nothing can be locked
    const h = run({ defs: { chess: { t_a: plain('t_a') } }, units: [U(id, 10, 4, { carryState: READY }), { chessId: 't_a', row: 10, col: 5 }] });
    const u = h.unit(id), a = h.unit('t_a');
    h.step();
    h.b.retreat(a, { reason: 'retreat', permanent: true });
    const hurt = () => { if (u.hp > u.s.maxHp * 0.6) u.hp = u.s.maxHp * 0.3; };
    for (let i = 0; i < 30; i++) { hurt(); h.run(0.2); }
    assert.ok(heals(h, u, (c) => c.target === u).length >= 3, `${id} heals herself`);
    assert.equal(started(h, u).length, 0, 'never started (a phantom start would fire 特质 / 萨尔贡 skillStart gains)');
    assert.equal(h.hooksOf('skillEnd').filter((c) => c.unit === u).length, 0);
    assert.equal(u.skill.activations, 0);
    assert.equal(h.eventsOf('skill').filter((e) => e[1] === u.id).length, 0, 'no skill cast on the client');
    assert.ok(!u.skill.active && u.skill.ready && u.skill.charges === 1, 'charge kept');
    for (const c of heals(h, u, (x) => x.target === u)) approx(c.amount, u.s.atk, 'no boosted heal (ATK +atk never applied)');
    done(h);

    const h2 = run({ defs: { chess: { t_a: plain('t_a') } }, units: [U(id, 10, 4, { carryState: READY }), { chessId: 't_a', row: 10, col: 5 }] });
    const u2 = h2.unit(id), a2 = h2.unit('t_a');
    h2.step();
    h2.b.applyStatus(a2, 'noHeal', { duration: 2, source: u2 });
    assert.ok(a2.s.flags.noHeal);
    u2.hp = u2.s.maxHp * 0.3;
    h2.run(1.5);
    assert.equal(started(h2, u2).length, 0, `${id}: a 禁疗 ally is never locked`);
    assert.ok(heals(h2, u2, (c) => c.target === u2).length > 0);
    u2.hp = u2.s.maxHp * 0.3;
    assert.ok(h2.runUntil(() => u2.skill.active, 5), 'starts once the ally can be locked');
    assert.equal(u2.mem.papyrsLock, a2);
    assert.equal(started(h2, u2).length, 1);
    done(h2);
  }
});

test('2_07 幽灵鲨 S1 攻击力强化·γ型: ATK +atk; no undying and no self-stun (肉斩骨断 only)', () => {
  for (const id of both('chess_char_2_07')) {
    const bb = bbAlt(id);
    const h = run({ defs: { enemies: { e: dummy('e', { atk: 4000, bat: 0.5 }) } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'e', pos: [9, 5] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.step();
    assert.ok(u.skill.active);
    approx(u.s.atk, u.base.atk * (1 + bb.atk));
    assert.ok(h.runUntil(() => h.hooksOf('death').some((c) => c.unit === u), 10), 'lethal hits kill her during the skill');
    assert.equal(statuses(h, 'stun', (c) => c.target === u).length, 0);
    done(h);
  }
});

test('2_08 泡泡 S1 防御力强化·β型: set off by a hit (TAKE_DAMAGE); DEF +def; keeps attacking; no counter, no taunt', () => {
  for (const id of both('chess_char_2_08')) {
    const bb = bbAlt(id), tb = tbOf(id);
    const h = run({ defs: { enemies: { e: dummy('e', { atk: 300, bat: 1 }) } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'e', pos: [9, 5] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.runUntil(() => u.skill.active, 3);
    assert.equal(started(h, u)[0].reason, 'TAKE_DAMAGE');
    approx(u.s.def, u.base.def * (1 + bb.def + (tb.def ?? 0)), 'DEF (+ elite module while blocking)');
    assert.equal(u.s.taunt, 0);
    const t0 = started(h, u)[0].t;
    h.run(4);
    assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0).length > 0, 'still attacks');
    assert.equal(dealt(h, u, tagged('counter')).length, 0, 'no “挨打” counter');
    done(h);
  }
});

test('2_09 休谟斯 S1 固废切割: next attack atk_scale × ATK on every enemy it reaches + `value` HP once; every spCost+1 attacks', () => {
  for (const id of both('chess_char_2_09')) {
    const bb = bbAlt(id);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'e', pos: [9, 6] }, { key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.step();
    const first = h.hooksOf('attack').find((c) => c.attacker === u);
    assert.ok(first && first.isSkill && first.targets.length === 2);
    const hits = dealt(h, u, (c) => c.t === first.t && c.dmg.isAttack);
    assert.equal(hits.length, 2);
    for (const c of hits) approx(c.amount, u.s.atk * bb.atk_scale, `${id} ×${bb.atk_scale}`);
    const sh = heals(h, u, (c) => c.target === u && tagged('skill')(c));
    assert.equal(sh.length, 1, 'one extra heal per cast');
    assert.equal(sh[0].amount, bb.value);
    assert.ok(!u.findBuff('humus:peak'), 'no 精力充沛 (S2)');
    h.runUntil(() => started(h, u).length >= 2, 30);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u);
    const i2 = atks.findIndex((c, i) => i > 0 && c.isSkill);
    assert.equal(i2, alt(id).spCost + 1, 'the next cast after spCost normal attacks');
    done(h);
  }
});

test('2_10 洛洛 S1 战术咏唱·γ型: ASPD +attack_speed; no overload, no stun, no target lock (自负此轭 only)', () => {
  for (const id of both('chess_char_2_10')) {
    const bb = bbAlt(id);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.step();
    assert.ok(u.skill.active);
    approx(u.s.aspd - u.base.aspd, bb.attack_speed);
    h.run(alt(id).duration / 2 + 1);
    assert.ok(!u.findBuff('rockr:overload'));
    assert.equal(u.mem.rockLock ?? null, null);
    h.runUntil(() => !u.skill.active, 40);
    h.run(1);
    assert.equal(statuses(h, 'stun', (c) => c.target === u).length, 0);
    done(h);
  }
});

test('2_11 风丸 S1 纸艺·迅击: next attack atk_scale × ATK, loses hp_ratio × max HP; the loss can set off the <替身>', () => {
  for (const id of both('chess_char_2_11')) {
    const bb = bbAlt(id);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'e', pos: [9, 6] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.step();
    const first = h.hooksOf('attack').find((c) => c.attacker === u);
    assert.ok(first && first.isSkill);
    approx(dealt(h, u, (c) => c.dmg.isAttack)[0].amount, u.s.atk * bb.atk_scale, `${id} ×${bb.atk_scale}`);
    const loss = h.hooksOf('damaged').filter((c) => c.target === u && tagged('hpLoss')(c));
    assert.equal(loss.length, 1);
    approx(loss[0].amount, u.s.maxHp * bb.hp_ratio, 'max-HP based loss');
    assert.ok(h.b.allyUnits.every((x) => x.kind !== 'token'), 'no <纸偶> summon');
    // a cast at low HP is fatal ⇒ the dollkeeper substitution
    u.hp = u.s.maxHp * bb.hp_ratio * 0.5;
    assert.ok(h.runUntil(() => started(h, u).length >= 2, 15));
    h.step();
    assert.ok(u.alive && u.findBuff('trait:substitute'), 'switched to the <替身>');
    done(h);
  }
});

test('2_12 砾 S1 影袭: at deployment DEF +def decaying to 0 over `duration` s, updated once per second; no barrier', () => {
  for (const id of both('chess_char_2_12')) {
    const bb = bbAlt(id), aura = tal(id).def ?? 0; // elite 小个子支援 (cost ≤ 10) includes herself
    const h = run({ units: [U(id, 9, 5)] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.run(0.5);
    approx(u.s.def, u.base.def * (1 + aura + bb.def), `${id} full bonus`);
    assert.equal(u.s.shield, 0, 'no 鼠群 barrier');
    assert.equal(u.skill.kind, 'duration');
    assert.equal(u.skill.active, true);
    assert.equal(u.skill.ready, false);
    assert.equal(h.snapshot().units.find((t) => t[0] === u.id)[6], bb.duration);
    h.run(1);
    approx(u.s.def, u.base.def * (1 + aura + bb.def * (bb.duration - 1) / bb.duration), 'one step down after 1 s');
    h.run(0.4);
    approx(u.s.def, u.base.def * (1 + aura + bb.def * (bb.duration - 1) / bb.duration), 'steps once per second');
    h.run(bb.duration);
    approx(u.s.def, u.base.def * (1 + aura), 'gone');
    assert.equal(u.skill.active, false);
    assert.equal(u.skill.ready, false);
    assert.equal(u.findBuff('gravel:shadow'), null);
    assert.equal(h.hooksOf('skillEnd').filter((c) => c.unit === u && c.reason === 'duration').length, 1);
    done(h);
  }
});

test('2_13 蒂比 S1 专业喷绘技巧: DEFAULT trigger, takes off (skill range, ATK +atk, blocks flyers), single shots; hits never set it off', () => {
  for (const id of both('chess_char_2_13')) {
    const bb = bbAlt(id);
    const h = run({ defs: { enemies: { e: dummy('e'), f: dummy('f', { motion: 'FLY' }) } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'e', pos: [9, 6] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.step();
    const range0 = u.baseRangeKeys.length;
    h.runUntil(() => u.skill.active, 3);
    assert.equal(started(h, u)[0].reason, 'DEFAULT');
    assert.equal(u.s.flags.liftoff, true, 'airborne (起飞)');
    assert.equal(u.ground, true, 'still a ground unit on her low tile');
    approx(u.s.atk, u.base.atk * (1 + bb.atk));
    assert.ok(u.rangeKeys.length > range0, 'skill range');
    const fl = h.spawn('f', { pos: [9, 5] });
    h.step();
    assert.equal(fl.blockedBy, u, 'blocks flyers while airborne');
    h.run(3);
    const atk = h.hooksOf('attack').filter((c) => c.attacker === u);
    const hits = dealt(h, u, (c) => c.dmg.isAttack);
    assert.equal(hits.length, atk.reduce((n, c) => n + c.targets.length, 0), 'one shot per target (no 3 连射)');
    h.runUntil(() => !u.skill.active, 40);
    h.step();
    assert.ok(!u.s.flags.liftoff, 'landed');
    done(h);
    // an enemy attack from outside her range never sets S1 off (S2's 受到攻击后触发 is not hers)
    const h2 = run({ defs: { enemies: { r: dummy('r', { atk: 300, bat: 1, range: 3.2 }) } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'r', pos: [9, 8] }] });
    const u2 = h2.unit(id);
    h2.run(4);
    assert.ok(h2.hooksOf('damaged').some((c) => c.target === u2), 'she is being shot');
    assert.equal(started(h2, u2).length, 0, 'not triggered by hits');
    done(h2);
  }
});

test('2_14 调香师 S1 治疗强化·β型: ATK +atk (ASPD unchanged); heals 3 allies (elite module: 4)', () => {
  for (const id of both('chess_char_2_14')) {
    const bb = bbAlt(id), ids = ['t_1', 't_2', 't_3', 't_4', 't_5'];
    const defs = { chess: Object.fromEntries(ids.map((k) => [k, plain(k)])) };
    const h = run({ defs, units: [U(id, 10, 4, { carryState: READY }), ...ids.map((c, i) => ({ chessId: c, row: [9, 10, 11, 9, 11][i], col: [4, 5, 5, 5, 4][i] }))] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.step();
    for (const k of ids) { const a = h.unit(k); a.hp = a.s.maxHp * 0.4; }
    h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 5);
    assert.ok(u.skill.active);
    approx(u.s.atk, u.base.atk * (1 + bb.atk));
    approx(u.s.aspd, u.base.aspd, 'no 精调 ASPD −50');
    const n = h.hooksOf('attack').find((c) => c.attacker === u).targets.length;
    assert.equal(n, id.endsWith('_b') ? 4 : 3);
    done(h);
  }
});

test('2_16 拉普兰德 S1 日晷: toggle (持续时间无限) ATK +atk; blocks enemy physical damage with `prob`; physical normal attacks', () => {
  for (const id of both('chess_char_2_16')) {
    const bb = bbAlt(id);
    for (const roll of [true, false]) {
      const seen = [];
      const h = run({
        defs: { enemies: { e: dummy('e', { atk: 300, bat: 0.5 }) } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'e', pos: [9, 5] }],
        setup: (b) => { b.rng.chance = (p) => { seen.push(p); return roll; }; },
      });
      const u = h.unit(id);
      usesAlt(u, id);
      h.runUntil(() => u.skill.active, 3);
      assert.equal(u.skill.kind, 'toggle');
      approx(u.s.atk, u.base.atk * (1 + bb.atk));
      const taken0 = u.stats.taken;
      h.run(60);
      assert.ok(u.skill.active, 'still active after 60 s');
      assert.ok(seen.includes(bb.prob), 'rolls prob');
      if (roll) assert.equal(u.stats.taken, taken0, 'every blocked roll negates the physical hit');
      else assert.ok(u.stats.taken > taken0, 'a failed roll lands');
      assert.ok(dealt(h, u, (c) => c.dmg.isAttack).every((c) => c.type === 'phys'), 'no 狼魂 arts conversion');
      done(h);
    }
  }
});

test('2_17 折桠 S1 绝境抵抗: TAKE_DAMAGE; DEF +def and 抵抗 (control statuses halved) for its duration; 简易包扎 at the end', () => {
  for (const id of both('chess_char_2_17')) {
    const bb = bbAlt(id), t = tal(id);
    const h = run({ defs: { enemies: { e: dummy('e', { atk: 300, bat: 1 }) } }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'e', pos: [9, 5] }] });
    const u = h.unit(id);
    usesAlt(u, id);
    h.runUntil(() => u.skill.active, 3);
    assert.equal(started(h, u)[0].reason, 'TAKE_DAMAGE');
    approx(u.s.def, u.base.def * (1 + bb.def));
    approx(h.b.resistOf(u), -bb.one_minus_status_resistance, '抵抗');
    h.b.applyStatus(u, 'stun', { duration: 4, source: h.enemies()[0] });
    approx(statuses(h, 'stun', (c) => c.target === u)[0].duration, 4 * (1 + bb.one_minus_status_resistance), 'stun halved');
    assert.equal(statuses(h, 'tremble').length, 0, 'no 生存决心 tremble');
    u.hp = u.s.maxHp * 0.3;
    h.runUntil(() => !u.skill.active, 20);
    const end = heals(h, u, (c) => c.target === u && tagged('talent')(c));
    assert.equal(end.length, 1);
    approx(end[0].amount, u.s.maxHp * t.hp_ratio);
    h.run(0.2);
    assert.equal(h.b.resistOf(u), 0, '抵抗 ends with the skill');
    done(h);
  }
});

test('2_18 灰毫 S2 专注轰击: cast with an enemy in range (DEFAULT, the deliberate deviation from the 重装 row — DESIGN §21.29), then blocks nothing, ranged splash bombs only, shorter interval, ATK +atk', () => {
  for (const id of both('chess_char_2_18')) {
    const bb = bbAlt(id);
    const enemies = { w: enemyRec({ key: 'w', hp: 1e7, speed: 2, atk: 50, bat: 1 }) };
    // control: the default skill blocks the walker
    const c = run({ defs: { enemies }, units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'w', route: 0 }] });
    assert.ok(c.runUntil(() => c.enemies()[0]?.blockedBy === c.unit(id), 10), 'default: blocked');
    done(c);

    // (a second walker, 2 s behind the first, comes by while the skill runs — 10 s from the cast, made as the first one
    // comes into range: she bombs it from range, unblocked)
    const h = run({ defs: { enemies }, units: [U(id, 9, 5, { carryState: READY })], enemies: [{ key: 'w', route: 0 }, { key: 'w', route: 0, time: 2 }] });
    const u = h.unit(id);
    usesAlt(u, id);
    // the official 下半 重装 row (TAKE_DAMAGE) is overridden for this skill by the owner's decision (data rawRule keeps it)
    assert.equal(u.skill.rule, 'DEFAULT', 'an offensive 重装 skill of the deviation: the basic strategy');
    assert.ok(h.runUntil(() => u.skill.active, 8));
    const st = h.b.time;
    const atk0 = h.eventsOf('atk').length;
    assert.equal(started(h, u)[0].reason, 'DEFAULT', 'cast by the basic strategy');
    assert.ok(!h.hooksOf('damaged').some((x) => x.target === u), 'with the walker in range, before anything hit her');
    assert.ok(u.s.flags.noBlock);
    approx(u.s.atk, u.base.atk * (1 + u.findBuff('talent:ashlok').mods.atkPct + bb.atk), 'ATK (+ 炮术研习)');
    approx(u.s.interval, (u.base.bat + bb.base_attack_time) * 100 / u.s.aspd, 'base attack time shortened');
    const w = h.enemies()[0];
    assert.ok(h.runUntil(() => w.x < 4.5, 8), 'walks past her');
    const w2 = h.enemies()[1];
    assert.ok(h.runUntil(() => w2 && w2.x < 4.5, 12), 'the second one walks past her too');
    assert.ok(u.skill.active);
    assert.ok(!h.hooksOf('damaged').some((x) => x.target === u && x.t > st + 0.1), 'released, never blocked again ⇒ not hit again');
    const shots = h.eventsOf('atk').slice(atk0).filter((e) => e[1] === u.id);
    assert.ok(shots.length > 0 && shots.every((e) => e[3] !== 'none'), `ranged shots only ${JSON.stringify(shots)}`);
    done(h);
  }
});

test('2_19 锡人 S1 “老科利”: alchemy unit — 8 s of weaken −atk and atk_scale × ATK arts/s on ground enemies within 1 tile', () => {
  for (const id of both('chess_char_2_19')) {
    const bb = bbAlt(id), wither = tal(id, null, 1)['skill@damage_scale'] ?? 1;
    const h = run({
      defs: { enemies: { g: dummy('g', { atk: 100 }), f: dummy('f', { atk: 100, motion: 'FLY' }) } },
      units: [U(id, 10, 4, { carryState: READY })],
      enemies: [{ key: 'g', pos: [10, 6] }, { key: 'f', pos: [10, 6] }, { key: 'g', pos: [11, 6] }, { key: 'g', pos: [10, 8] }],
    });
    const u = h.unit(id);
    usesAlt(u, id);
    h.step();
    assert.equal(started(h, u).length, 1);
    const atk0 = u.s.atk;
    const [g, f, g2, far] = h.enemies();
    h.run(0.5);
    approx(g.s.atk, 100 * (1 + bb.atk), 'weakened');
    approx(g2.s.atk, 100 * (1 + bb.atk), 'neighbour inside the unit radius');
    approx(f.s.atk, 100, 'flyers unaffected');
    approx(far.s.atk, 100, 'outside');
    h.run(bb.projectile_delay_time);
    const zone = dealt(h, u, (c) => c.target === g && (c.dmg.tags || []).includes('zone'));
    assert.equal(zone.length, bb.projectile_delay_time, 'one pulse per second');
    for (const c of zone) { assert.equal(c.type, 'arts'); approx(c.amount, atk0 * bb.atk_scale * wither, `${id} ×${bb.atk_scale}${wither > 1 ? ' ×凋敝魂灵' : ''}`); }
    assert.equal(dealt(h, u, (c) => (c.target === f || c.target === far) && (c.dmg.tags || []).includes('zone')).length, 0);
    approx(g.s.atk, 100, 'weaken over');
    assert.equal(u.mem.tinZones, 0);
    done(h);
  }
});

// =================================================================================================================
// module choice: 'none' instead of the elite's default module (the kit reads the loadout-resolved record)

/** Elite (default module) vs the same elite without module: [measure(default), measure(none)]. */
function withAndWithout(fn) { return [fn(null), fn('none')]; }
const mod = (moduleId) => (moduleId ? { moduleId } : {});

test('modules: removing the elite module changes the trait / talent behaviour the kit and profile implement', async (t) => {
  await t.test('2_01 送葬人 RPR-X: front-row ×1.6 → ×1.5', () => {
    const id = 'chess_char_2_01_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [10, 5] }] });
      h.run(1);
      const u = h.unit(id);
      const d = dealt(h, u)[0].amount / u.s.atk;
      done(h);
      return d;
    });
    approx(a, tbOf(id).atk_scale);
    approx(b, tbOf(id, NONE).atk_scale);
    assert.ok(a > b);
  });
  await t.test('2_02 赫默 PHY-Y: ground heals ×1.15 → ×1', () => {
    const id = 'chess_char_2_02_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { chess: { t_a: plain('t_a') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE, ...mod(m) }, { chessId: 't_a', row: 9, col: 6 }] });
      h.step();
      const x = h.unit('t_a'), u = h.unit(id);
      x.hp = x.s.maxHp * 0.3;
      h.runUntil(() => heals(h, u).length > 0, 10);
      const r = heals(h, u)[0].amount / u.s.atk;
      done(h);
      return r;
    });
    approx(a, 1.15);
    approx(b, 1);
  });
  await t.test('2_04 小满 DEC-X: +0.2 SP/s with an enemy in range → none', () => {
    const id = 'chess_char_2_04_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [10, 6] }] });
      h.run(2);
      const sp = h.unit(id).skill.sp;
      done(h);
      return sp;
    });
    approx(a, 2 * (1 + 0.2), 'module', 1e-3);
    approx(b, 2, 'none', 1e-3);
  });
  await t.test('2_05 哈洛德 WDM-X: element recovery 0.6 → 0.5 × ATK', () => {
    const id = 'chess_char_2_05_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { chess: { t_el: plain('t_el') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE, ...mod(m) }, { chessId: 't_el', row: 10, col: 5 }] });
      h.step();
      const x = h.unit('t_el'), u = h.unit(id);
      x.elem.neural = 900;
      h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 5);
      const r = (900 - x.elem.neural) / u.s.atk;
      done(h);
      return r;
    });
    approx(a, tbOf(id).ep_heal_ratio);
    approx(b, tbOf(id, NONE).ep_heal_ratio);
    assert.ok(a > b);
  });
  await t.test('2_06 莎草 XAH-X: chain heal falloff −15 % → −25 % per jump', () => {
    const id = 'chess_char_2_06_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { chess: { t_1: plain('t_1'), t_2: plain('t_2') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE, ...mod(m) }, { chessId: 't_1', row: 10, col: 5 }, { chessId: 't_2', row: 10, col: 6 }] });
      h.step();
      const u = h.unit(id), x1 = h.unit('t_1'), x2 = h.unit('t_2');
      x1.hp = x1.s.maxHp * 0.2; x2.hp = x2.s.maxHp * 0.3;
      h.runUntil(() => heals(h, u).length >= 2, 5);
      const [m0, j1] = heals(h, u).filter((c) => !(c.opts?.tags || []).length);
      done(h);
      return j1.amount / m0.amount;
    });
    approx(a, 0.85);
    approx(b, 0.75);
  });
  await t.test('2_07 幽灵鲨 CEN-X: vs blocked ×1.1 → ×1', () => {
    const id = 'chess_char_2_07_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 5, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [9, 5] }] });
      h.run(1);
      const u = h.unit(id);
      const r = dealt(h, u)[0].amount / u.s.atk;
      done(h);
      return r;
    });
    approx(a, 1.1);
    approx(b, 1);
  });
  await t.test('2_08 泡泡 PRO-X: DEF +20 % while blocking → none', () => {
    const id = 'chess_char_2_08_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 5, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [9, 5] }] });
      h.run(0.3);
      const u = h.unit(id);
      const r = u.s.def / u.base.def;
      done(h);
      return r;
    });
    approx(a, 1.2);
    approx(b, 1);
  });
  await t.test('2_09 休谟斯 REA-X: trait self heal 60 → 50 per enemy hit', () => {
    const id = 'chess_char_2_09_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 5, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [9, 5] }] });
      h.step();
      const u = h.unit(id);
      u.hp = u.s.maxHp * 0.5;
      h.runUntil(() => heals(h, u, (c) => c.target === u).length > 0, 3);
      const r = heals(h, u, (c) => c.target === u)[0].amount;
      done(h);
      return r;
    });
    assert.equal(a, tbOf(id).value);
    assert.equal(b, tbOf(id, NONE).value);
    assert.ok(a > b);
  });
  await t.test('2_10 洛洛 FUN-X: drone first hit 0.35 → 0.2 × ATK', () => {
    const id = 'chess_char_2_10_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [10, 6] }] });
      h.runUntil(() => dealt(h, h.unit(id)).length > 0, 5);
      const u = h.unit(id);
      const r = dealt(h, u)[0].amount / u.s.atk;
      done(h);
      return r;
    });
    approx(a, tbOf(id).init_atk_scale);
    approx(b, tbOf(id, NONE).init_atk_scale);
    assert.ok(a > b);
  });
  await t.test('2_11 风丸 PUM-X: substituted ATK +15 % → +0 %', () => {
    const id = 'chess_char_2_11_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e', { atk: 8000, bat: 1 }) } }, units: [{ chessId: id, row: 9, col: 5, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [9, 5] }] });
      const u = h.unit(id);
      h.runUntil(() => u.findBuff('trait:substitute'), 20);
      h.step();
      const tokAtk = h.b.data.getToken('token_10022_kazema_shadow', id).stats.atk;
      const r = u.s.atk / tokAtk;
      done(h);
      return r;
    });
    approx(a, 1 + tbOf(id).atk);
    approx(b, 1);
  });
  await t.test('2_14 调香师 RIN-Y: heals 4 → 3 allies', () => {
    const id = 'chess_char_2_14_b', ids = ['t_1', 't_2', 't_3', 't_4', 't_5'];
    const defs = { chess: Object.fromEntries(ids.map((k) => [k, plain(k)])) };
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE, ...mod(m) }, ...ids.map((c, i) => ({ chessId: c, row: [9, 10, 11, 9, 11][i], col: [4, 5, 5, 5, 4][i] }))] });
      h.step();
      for (const k of ids) { const x = h.unit(k); x.hp = x.s.maxHp * 0.4; }
      const u = h.unit(id);
      h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 5);
      const n = h.hooksOf('attack').find((c) => c.attacker === u).targets.length;
      done(h);
      return n;
    });
    assert.deepEqual([a, b], [4, 3]);
  });
  await t.test('2_16 拉普兰德 LOR-X: +10 % ATK arts on hit → none', () => {
    const id = 'chess_char_2_16_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 4, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [9, 6] }] });
      h.run(1);
      const n = dealt(h, h.unit(id), (c) => (c.dmg.tags || []).includes('module')).length;
      done(h);
      return n;
    });
    assert.ok(a > 0);
    assert.equal(b, 0);
  });
  await t.test('2_17 折桠 UNY-X: damage from blocked attackers ×0.85 → ×1', () => {
    const id = 'chess_char_2_17_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e', { atk: 1500, bat: 1 }) } }, units: [{ chessId: id, row: 9, col: 5, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [9, 5] }] });
      const u = h.unit(id);
      h.runUntil(() => h.hooksOf('damaged').some((c) => c.target === u), 3);
      const r = h.hooksOf('damaged').find((c) => c.target === u).amount / (1500 - u.s.def);
      done(h);
      return r;
    });
    approx(a, 0.85);
    approx(b, 1);
  });
  await t.test('2_18 灰毫 FOR-X: vs blocked ×1.1 → ×1', () => {
    const id = 'chess_char_2_18_b';
    const [a, b] = withAndWithout((m) => {
      const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 5, carryState: IDLE, ...mod(m) }], enemies: [{ key: 'e', pos: [10, 5] }] });
      h.run(4);
      const u = h.unit(id);
      const r = dealt(h, u)[0].amount / u.s.atk;
      done(h);
      return r;
    });
    approx(a, 1.1);
    approx(b, 1);
  });
});

// =================================================================================================================
// smoke: every loadout of every tier-2 chess fights without content errors

test('every tier-2 loadout (skill × module, normal & elite) fights 30 s with its authored kit and no content errors', () => {
  const bases = Object.values(ds.raw.chess).filter((c) => c.tier === 2 && c.visible && !c.isGolden);
  for (const base of bases) {
    for (const id of [base.chessId, base.goldenId].filter(Boolean)) {
      const r = raw(id);
      const mods = Array.isArray(r.modules) && r.modules.length ? [null, 'none'] : [null];
      for (const s of r.skills) {
        for (const moduleId of mods) {
          const h = makeBattle({
            seed: 11, timeLimit: 30, autoFinish: false,
            units: [{ chessId: id, row: 10, col: 5, skillIndex: s.index, ...(moduleId ? { moduleId } : {}), carryState: READY }, { chessId: 'chess_char_1_02_a', row: 9, col: 5 }],
            enemies: [{ key: 'enemy_1007_slime', route: 0, count: 6, interval: 2 }, { key: 'enemy_1007_slime', route: 1, count: 4, interval: 3 }],
          });
          const u = h.unit(id);
          assert.equal(u.skill.id, s.skillId);
          assert.equal(u.kit.skillSource ?? 'kit', s.isDefault ? 'kit' : 'skills', `${id} ${s.skillId}`);
          h.run(30);
          assert.equal(h.b.errors.length, 0, `${id} S${s.index + 1} module ${moduleId}: ${JSON.stringify(h.b.errors[0])}`);
          checkInvariants(h.b);
        }
      }
    }
  }
});
