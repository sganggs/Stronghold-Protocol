// Operator loadouts (DESIGN §16) for the tier-6 kits (server/sim/content/kits/ops/): every selectable NON-default
// skill of every visible tier-6 chess is hand-authored (tools/kit-coverage.mjs) and shows its signature effect for the
// normal (Lv4) and the elite (Lv7) chess — numbers from the selected skill's blackboard (data/chess.json skills[]) —
// and the elite's non-default module choices (Y / RA modules, or 'none') change what the kit does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { KITS, skillSpecSource } from '../../server/sim/content/index.js';
import { kitCoverage } from '../../tools/kit-coverage.mjs';
import { COLS } from '../../server/sim/constants.js';

const ds = getDefaultSource();
const raw = (id) => ds.rawChess(id);
const rec = (id, sid) => raw(id).skills.find((s) => s.skillId === sid);
const bbOf = (id, sid) => rec(id, sid).bb;
/** Named talent blackboard / trait blackboard / hidden module parts of the loadout-resolved def. */
const tal = (id, lo = null, i = 0) => ds.getChess(id, lo).talents[i]?.bb ?? {};
const tbOf = (id, lo = null) => ds.getChess(id, lo).traitBb ?? {};
const both = (base) => [`${base}_a`, `${base}_b`];
const MOD = (id) => ({ moduleId: id });

const approx = (a, b, msg = '', rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const READY = { sp: 999 };
const IDLE = { sp: 0 };
const HOOKS = ['damaged', 'heal', 'skillStart', 'skillEnd', 'statusApplied', 'attack', 'death', 'deploy', 'ammoUsed', 'elementHit'];
const plain = (id, o = {}) => chessRec({ id, skill: null, ...o });

function run(o) {
  return makeBattle({ seed: 7, autoFinish: false, timeLimit: 400, hooks: HOOKS, captureNoisy: true, ...o });
}
/** Unit entry with skill `sid` selected (plus loadout / carry extras). */
const U = (id, sid, row, col, o = {}) => ({ chessId: id, row, col, skillIndex: rec(id, sid).index, ...o });
const dealt = (h, u, f = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && f(c));
const statuses = (h, key, f = () => true) => h.hooksOf('statusApplied').filter((c) => c.status === key && f(c));
const heals = (h, u, f = () => true) => h.hooksOf('heal').filter((c) => c.source === u && f(c));
const tagged = (tag) => (c) => (c.dmg?.tags || []).includes(tag);
const started = (h, u) => h.hooksOf('skillStart').filter((c) => c.unit === u);
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
function usesSkill(u, sid) {
  assert.equal(u.skill.id, sid, `${u.defId} runs ${sid}`);
  assert.equal(u.kit.skillSource, 'skills', `${u.defId}: hand-authored spec`);
}
/** Synthetic enemy records are keyed `enemy_<key>` by the data source. */
const isKey = (x, key) => !!x && (x.defId === key || x.defId === `enemy_${key}`);
const enemyOf = (h, key, i = 0) => h.b.units.filter((x) => x.side === 'enemy' && isKey(x, key))[i];
const skillBuff = (u) => u.findBuff(`skill:${u.id}`);

// =================================================================================================================
// coverage

test('kit coverage: every selectable skill of every visible tier-6 chess is hand-authored (normal + elite, every module)', () => {
  const rep = kitCoverage({ tier: 6 });
  assert.equal(rep.summary.chess, 19);
  assert.equal(rep.summary.covered, rep.summary.skills, JSON.stringify(rep.chess.filter((r) => r.skills.some((s) => !s.covered)).map((r) => r.name)));
  for (const r of rep.chess) {
    for (const s of r.skills.filter((x) => !x.isDefault)) {
      assert.deepEqual([s.normal, s.elite], ['skills', 'skills'], `${r.name} S${s.index + 1} ${s.name}`);
      const gid = raw(r.chessId).goldenId;
      for (const moduleId of [null, 'none', ...(raw(gid).modules || []).map((m) => m.uniEquipId)]) {
        const def = ds.getChess(gid, { skillIndex: s.index, moduleId });
        assert.equal(def.skill.id, s.skillId);
        assert.equal(skillSpecSource(def, KITS), 'skills', `${gid} ${s.skillId} module ${moduleId}`);
      }
    }
  }
});

test('every tier-6 skill × module choice (normal + elite) survives a real wave without content errors and casts', () => {
  for (const r of kitCoverage({ tier: 6 }).chess) {
    const base = raw(r.chessId);
    for (const id of [r.chessId, base.goldenId]) {
      const mods = id === base.goldenId ? [null, 'none', ...(raw(id).modules || []).map((m) => m.uniEquipId)] : [null];
      for (const s of r.skills) for (const moduleId of mods) {
        const h = makeBattle({
          seed: 3, timeLimit: 60,
          units: [{ chessId: id, row: 10, col: 4, skillIndex: s.index, moduleId, carryState: READY }, { chessId: 'chess_char_1_01_a', row: 9, col: 4 }, { chessId: 'chess_char_2_06_a', row: 11, col: 5 }],
          enemies: [{ key: 'enemy_1007_slime', count: 8, interval: 1.5 }, { key: 'enemy_1007_slime', route: 1, count: 8, interval: 1.5, time: 3 }],
        });
        // (a medic acts on the hurt only, and the slimes may fall before they reach anyone: the team starts at half HP)
        if (base.profession === 'MEDIC') { h.step(); for (const a of h.b.allyUnits) a.hp = a.s.maxHp / 2; }
        h.runToEnd(90);
        done(h);
        const u = h.b.allyUnits.find((x) => x.defId === id);
        assert.equal(u.skill.id, s.skillId);
        // (a TAKE_DAMAGE skill needs an attacker: these slimes walk past)
        if (u.skill.kind !== 'passive' && u.skill.rule !== 'TAKE_DAMAGE') assert.ok(u.skill.activations > 0, `${id} ${s.name} (module ${moduleId}) casts`);
      }
    }
  }
});

// =================================================================================================================
// 6_01 蕾缪安

test('6_01 蕾缪安 S1 重逢问候: 5 bullets, each attack hits 2 enemies at attack@atk_scale × ATK', () => {
  for (const id of both('chess_char_6_01')) {
    const sid = 'skchr_lemuen_1', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    const t0 = h.b.time;
    assert.equal(u.skill.ammoLeft + h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length, bb['attack@trigger_time'], '5 bullets');
    assert.ok(h.runUntil(() => !u.skill.active, 60));
    h.run(1); // arrows in flight
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    void t0;
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
    assert.equal(atks.length, bb['attack@trigger_time'], 'one bullet per attack');
    assert.equal(hits.length, 2 * atks.length, 'two targets per attack');
    for (const x of hits) approx(x.amount, u.s.atk * bb['attack@atk_scale'], `${id} ×atk_scale`);
    done(h);
  }
});

test('6_01 蕾缪安 S2 归乡邀约: ASPD/ATK +; a wanted enemy is aimed at for aim_duration s, then sniped at fin_atk_scale × ATK (no dodge)', () => {
  for (const id of both('chess_char_6_01')) {
    const sid = 'skchr_lemuen_2', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { el: dummy('el', { rank: 'ELITE' }) } },
      units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'el', pos: [10, 6] }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    approx(skillBuff(u).mods.aspd, bb.attack_speed, 'ASPD +');
    approx(skillBuff(u).mods.atkPct, bb.atk, 'ATK +');
    assert.ok(h.runUntil(() => !!h.enemies()[0]?.findBuff('lemuen:wanted'), 10), 'real detection marks the enemy');
    assert.ok(h.runUntil(() => !!u.mem.lemAim, 5), 'aims at the wanted enemy');
    const ammo = u.skill.ammoLeft, t0 = h.b.time, aimingAtk = u.s.atk;
    const atks0 = h.hooksOf('attack').filter((c) => c.attacker === u).length;
    assert.ok(h.runUntil(() => !u.mem.lemAim, 10));
    approx(h.b.time - t0, bb['attack@aim_duration'], 'aims the full time (1e7 HP)', 0.03);
    const snipe = dealt(h, u, tagged('snipe'));
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t < snipe[0].t).length, atks0, 'no normal attack while aiming');
    assert.ok(u.skill.ammoLeft <= ammo, 'the aim spent its bullet when it began');
    assert.equal(snipe.length, 1);
    assert.equal(snipe[0].dmg.canDodge, false);
    const wanted = u.def.bonds.includes('lateranoShip') ? tal(id).damage_scale : 1;
    approx(snipe[0].amount, aimingAtk * bb['attack@fin_atk_scale'] * wanted, `${id} fin × wanted`);
    done(h);
  }
});

test('6_01 蕾缪安 S2: a low-HP wanted target is sniped at once (ATK × scale > HP + DEF)', () => {
  const id = 'chess_char_6_01_a', sid = 'skchr_lemuen_2', bb = bbOf(id, sid);
  const h = run({
    defs: { enemies: { el: dummy('el', { rank: 'ELITE', hp: 800 }), big: dummy('big') } },
    units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'big', pos: [10, 5] }, { key: 'el', pos: [10, 7], time: 2 }],
    setup(b) { b.on('enemySpawn', ({ enemy }) => { if (isKey(enemy, 'el')) b.addBuff(enemy, { key: 'lemuen:wanted' }); }); },
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => dealt(h, u, tagged('snipe')).length > 0, 10));
  const sn = dealt(h, u, tagged('snipe'))[0];
  assert.ok(sn.t - 2 < 0.2, `fired at once (${sn.t})`);
  assert.ok(isKey(sn.target, 'el'));
  assert.ok(sn.amount >= u.s.atk * bb['attack@main_atk_scale'] - 1e-6);
  done(h);
});

// =================================================================================================================
// 6_02 圣聆初雪

test('6_02 圣聆初雪 S1 铃音吹雪: 2 charges (cast with enemies in range); atk_scale × ATK arts + cold on every enemy in range, pushed along her direction, snow spreads 5 tiles forward', () => {
  for (const id of both('chess_char_6_02')) {
    const sid = 'skchr_sbell2_1', bb = bbOf(id, sid);
    // weight-2 dummies: 中力 (1) − 2 = 受力等级 −1 ⇒ the official 0.44-tile push (PRTS 游戏数据基础 §重量公式), so they stay
    // in her range for the second charge
    const h = run({ defs: { enemies: { e: dummy('e', { mass: 2 }) } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [11, 5] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.equal(u.skill.maxCharges, rec(id, sid).maxChargeTime);
    h.step(2);
    const s = started(h, u);
    assert.ok(s.length >= 1, 'cast at once (enemies in range)');
    const t0 = s[0].t;
    const burst = dealt(h, u, (c) => c.t === t0 && c.dmg.isSkill && c.type === 'arts');
    assert.equal(burst.length, 2);
    for (const x of burst) approx(x.amount, u.s.atk * bb.atk_scale * u.s.dmgDealtMul, 'atk_scale × ATK');
    const colds = statuses(h, 'cold', (c) => c.source === u && c.t === t0);
    assert.equal(colds.length, 2);
    for (const c of colds) approx(c.duration, bb.cold, 'cold');
    const [e1] = h.enemies();
    approx(e1.x, 5 + 0.44 * started(h, u).length, 'pushed forward along her direction by the official 0.44 tiles per cast');
    approx(e1.y, 10, 'no sideways push');
    // (the pushed enemies clear the snow of the tiles they leave: "首个敌人离开该地块时积雪消失")
    for (let d = 3; d <= bb.trig_cnt; d++) assert.ok((u.mem.snow.get(10 * COLS + 4 + d) ?? 0) >= 1, `snow ${d} tiles ahead`);
    h.run(2.5);
    assert.equal(started(h, u).length, 1, 'the next automatic cast waits the 3 s operation cooldown ("自动操作具有3s冷却")');
    h.run(1);
    assert.equal(started(h, u).length, 2, 'the second charge fires too');
    assert.ok(started(h, u)[1].t - t0 >= 3 - 1e-6);
    done(h);
  }
});

// PRTS 圣聆初雪 S2 霜涛覆岭 "积雪在目标点积累至5层时，使目标点变为冻结状态", 备注 "目标点冻结的实际效果为令圣聆初雪在该地块上召唤一个保护目标
// （冻结状态）（无视部署属性），并去除相应地块上的积雪（且存在自身的该召唤物的地块不会积雪）", "可以被'变为冻结状态'的目标点包括常规的保护目标点…";
// the token's page: "技能发动后于保护目标叠加5层积雪". Community report #32: until 0.1.3 any free standable tile froze and the blue
// gate never did (nobody can stand on it).
test('6_02 圣聆初雪 S2 霜涛覆岭: toggle; group attacks at atk_scale_s2 × ATK; ground enemies on snow take 20 %/s, leaving snow chills, 5 layers on the protection point freeze it (保护目标（冻结状态）), no other tile', () => {
  for (const id of both('chess_char_6_02')) {
    const sid = 'skchr_sbell2_2', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { e: dummy('e'), w: enemyRec({ key: 'w', hp: 1e7, speed: 1 }) } },
      units: [U(id, sid, 10, 3, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'w', route: 0, time: 1 }, { key: 'w', route: 0, time: 40 }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.kind, 'toggle');
    const e = enemyOf(h, 'e');
    const k = 10 * COLS + 5;
    u.mem.snow.set(k, 1); // snow under the dummy
    u.mem.snow.set(9 * COLS + 7, 1); // on the walker's path
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack && c.target === e).length > 0, 10));
    const hit = dealt(h, u, (c) => c.dmg.isAttack && c.target === e)[0];
    approx(hit.amount, u.s.atk * bb['attack@atk_scale_s2'] * u.s.dmgDealtMul, 'atk_scale_s2');
    h.run(1.5);
    const dot = dealt(h, u, (c) => c.target === e && c.dmg.isSkill && !c.dmg.isAttack && (c.dmg.tags || []).includes('snow'));
    assert.ok(dot.length >= 1, 'snow DoT');
    approx(dot[0].amount, u.s.atk * bb['talent@s2_magic_scale'] * u.s.dmgDealtMul, '20 % ATK per second');
    assert.ok(h.runUntil(() => statuses(h, 'cold', (c) => c.source === u && isKey(c.target, 'w')).length > 0, 20), 'leaving snow ⇒ cold');
    approx(statuses(h, 'cold', (c) => c.source === u && isKey(c.target, 'w'))[0].duration, bb['talent@cold'], 'cold duration');
    const iceOf = () => h.b.allyUnits.find((t) => t.defId === 'token_10058_sbell2_icetgt' && t.alive);
    // a free ground tile of her range reaching 5 layers: no freeze (until 0.1.3 it turned into the token)
    const fk = 11 * COLS + 4;
    assert.ok(u.rangeKeys.includes(fk));
    u.mem.snow.set(fk, 4);
    h.run(7);
    assert.equal(u.mem.snow.get(fk), 5);
    assert.equal(iceOf(), undefined, 'only a protection point freezes');
    // the blue gate (9,2) — build NONE, nobody may stand there — at 4 layers: the next layer freezes it
    const gk = 9 * COLS + 2;
    assert.equal(h.b.grid.tile(9, 2).special, 'end');
    assert.ok(u.rangeKeys.includes(gk));
    u.mem.snow.set(gk, 4);
    assert.ok(h.runUntil(() => !!iceOf(), 7), '保护目标（冻结状态）');
    const ice = iceOf();
    assert.deepEqual([ice.tileR, ice.tileC], [9, 2]);
    assert.equal(ice.s.blockCnt, 3);
    assert.equal(u.mem.snow.get(gk), undefined, 'its snow is used up');
    h.run(7);
    assert.equal(u.mem.snow.get(gk), undefined, 'no snow gathers under her token');
    // a walker reaching the gate is held there by it, not leaked
    const leaks0 = h.result().perPlayer.p1.leaked.length;
    assert.ok(h.runUntil(() => h.b.enemies.some((x) => x.alive && isKey(x, 'w') && x.blockedBy === ice), 60), 'blocked by the frozen gate');
    assert.equal(h.result().perPlayer.p1.leaked.length, leaks0);
    done(h);
  }
});

// =================================================================================================================
// 6_03 余

test('6_03 余 S1 今日做东: taunt +1 while carried; TAKE_DAMAGE cast, HP/DEF +, every attack taken burns the attacker (ep_damage_ratio × ATK)', () => {
  for (const id of both('chess_char_6_03')) {
    const sid = 'skchr_yu_1', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { hit: enemyRec({ key: 'hit', hp: 1e7, speed: 0, atk: 300, bat: 1 }) } },
      units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'hit', pos: [10, 4] }], hooks: [...HOOKS, 'elementBurst'],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    h.step();
    assert.equal(u.s.taunt, bb.taunt_level, 'passive taunt');
    assert.ok(h.runUntil(() => u.skill.active, 10), 'cast when hit');
    assert.equal(started(h, u)[0].reason, 'TAKE_DAMAGE');
    approx(skillBuff(u).mods.hpPct, bb.max_hp);
    approx(skillBuff(u).mods.defPct, bb.def);
    const t0 = h.b.time;
    h.run(4);
    // the burns build a 燃烧 burst on the attacker, which refuses same-element fills while it runs: compare up to it
    const end = h.hooksOf('elementBurst').find((c) => c.element === 'burn' && c.t > t0)?.t ?? Infinity;
    const burns = h.hooksOf('elementHit').filter((c) => c.source === u && c.dmg.element === 'burn' && c.t > t0 && c.t <= end && (c.dmg.tags || []).includes('skill'));
    const taken = h.hooksOf('damaged').filter((c) => c.target === u && c.dmg?.isAttack && c.t > t0 && c.t <= end);
    assert.ok(burns.length >= 1 && burns.length === taken.length, `one burn per attack taken (${burns.length}/${taken.length})`);
    approx(burns[0].dmg.amount, u.s.atk * bb.ep_damage_ratio, 'ep_damage_ratio × ATK');
    done(h);
  }
  // the default skill carries no taunt
  const d = run({ units: [{ chessId: 'chess_char_6_03_a', row: 10, col: 4 }] });
  d.step();
  assert.equal(d.unit('chess_char_6_03_a').s.taunt, 0);
});

test('6_03 余 S2 厚礼上宾: cast with an enemy on its x-1 (SKILL_RANGE — a deliberate deviation from the 重装 TAKE_DAMAGE, DESIGN §22.10); atk_scale × ATK arts around him, reachable ground enemies teleported onto his tile; block +2, HP/ATK +, arts attacks', () => {
  for (const id of both('chess_char_6_03')) {
    const sid = 'skchr_yu_2', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { e: dummy('e', { atk: 100, bat: 1 }) } },
      units: [U(id, sid, 10, 4, { carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 4] }, { key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 5] }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    assert.equal(started(h, u)[0].reason, 'SKILL_RANGE');
    const t0 = started(h, u)[0].t;
    const burst = dealt(h, u, (c) => c.t === t0 && c.dmg.isSkill && !c.dmg.isAttack);
    assert.equal(burst.length, 3);
    for (const x of burst) { assert.equal(x.type, 'arts'); approx(x.amount, u.s.atk * bb.atk_scale, 'atk_scale × ATK'); }
    for (const e of h.enemies()) assert.deepEqual([Math.round(e.y), Math.round(e.x)], [10, 4], 'teleported');
    h.step();
    assert.equal(u.s.blockCnt, u.base.blockCnt + bb.block_cnt);
    assert.ok(h.enemies().every((e) => e.blockedBy === u), 'all blocked by him');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    h.run(3);
    const atk = dealt(h, u, (c) => c.dmg.isAttack && c.t > t0);
    assert.ok(atk.length > 0 && atk.every((c) => c.type === 'arts'), 'normal attacks deal arts');
    done(h);
  }
});

// =================================================================================================================
// 6_04 浊心斯卡蒂

test('6_04 浊心斯卡蒂 S1 同归殊途之吟: SP_FULL, full HP + max HP +; trait (生命回复速度) raised; 50 % of the damage of allies in range goes to her', () => {
  for (const id of both('chess_char_6_04')) {
    const sid = 'skchr_skadi2_1', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { ally_a: plain('ally_a', { stats: { def: 0, maxHp: 1e6 } }) }, enemies: { hit: enemyRec({ key: 'hit', hp: 1e7, speed: 0, atk: 1000, bat: 2 }) } },
      units: [U(id, sid, 10, 4, { carryState: READY }), { chessId: 'ally_a', row: 10, col: 5 }], enemies: [{ key: 'hit', pos: [10, 5], time: 1 }],
    });
    const u = h.unit(id), a = h.unit('ally_a');
    usesSkill(u, sid);
    h.step(2);
    assert.ok(u.skill.active, 'SP_FULL');
    approx(skillBuff(u).mods.hpPct, bb.max_hp);
    assert.ok(u.hp >= u.s.maxHp - 1, 'full HP');
    h.run(5);
    const onAlly = h.hooksOf('damaged').filter((c) => c.target === a && isKey(c.source, 'hit'));
    const onHer = h.hooksOf('damaged').filter((c) => c.target === u && (c.dmg?.tags || []).includes('transfer'));
    assert.ok(onAlly.length >= 1 && onHer.length === onAlly.length, 'every hit on the ally is shared');
    approx(onAlly[0].amount, 1000 * (1 - bb.damage_resistance), 'the ally takes the rest');
    approx(onHer[0].amount, 1000 * bb.damage_resistance, 'she takes the transferred part');
    assert.equal(onHer[0].type, 'true');
    // the trait is an hpRegen buff on the ally (PRTS 分支特性信息 吟游者; professions.js bardRegen), no heal of hers
    approx(a.findBuff(`trait:bard:${u.id}`)?.mods.hpRegen ?? 0, u.s.atk * bb['attack@atk_to_hp_recovery_ratio'], 'trait raised');
    assert.equal(heals(h, u, (c) => c.target === a).length, 0, 'no heal of hers');
    done(h);
  }
});

test('6_04 浊心斯卡蒂 S2 同葬无光之愿: toggle; 鼓舞 ATK and DEF (atk / def × hers) on the other allies of her range, trait 16/17 % (生命回复速度)', () => {
  for (const id of both('chess_char_6_04')) {
    const sid = 'skchr_skadi2_2', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { ally_a: plain('ally_a', { stats: { maxHp: 1e5, atk: 400, def: 100 } }) }, enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 4, { carryState: READY }), { chessId: 'ally_a', row: 10, col: 5 }], enemies: [{ key: 'e', pos: [10, 6] }],
    });
    const u = h.unit(id), a = h.unit('ally_a');
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.kind, 'toggle');
    h.run(1.1);
    const ia = a.findBuff('inspire'), id2 = a.findBuff('inspire:def');
    assert.ok(ia && id2, '鼓舞 ATK + DEF');
    approx(ia.data.val, u.s.atk * bb.atk, 'ATK 鼓舞', 1e-3);
    approx(id2.data.val, u.s.def * bb.def, 'DEF 鼓舞', 1e-3);
    approx(a.s.def, a.base.def + u.s.def * bb.def, 'DEF raised by the flat value', 1e-3);
    assert.ok(!u.findBuff('inspire') && !u.findBuff('inspire:def'), 'never on herself');
    a.hp = a.s.maxHp * 0.5;
    const hp0 = a.hp, t1 = h.b.time;
    h.run(1.1);
    const v = u.s.atk * bb['attack@atk_to_hp_recovery_ratio'];
    approx(a.findBuff(`trait:bard:${u.id}`)?.mods.hpRegen ?? 0, v, 'trait ratio');
    assert.ok(Math.abs(a.hp - hp0 - (a.s.hpRegen) * (h.b.time - t1)) <= 1.5, `regenerated ${a.hp - hp0}`);
    done(h);
  }
});

test('6_04 浊心斯卡蒂 S2 同葬无光之愿 (自动触发, effects on her allies only): on as soon as its SP is full — no enemy needed', () => {
  for (const id of both('chess_char_6_04')) {
    const sid = 'skchr_skadi2_2';
    const h = run({
      defs: { chess: { ally_a: plain('ally_a', { stats: { maxHp: 1e5, atk: 400, def: 100 } }) } },
      units: [U(id, sid, 10, 4, { carryState: READY }), { chessId: 'ally_a', row: 10, col: 5 }],
    });
    const u = h.unit(id), a = h.unit('ally_a');
    usesSkill(u, sid);
    assert.equal(u.skill.rule, 'SP_FULL');
    assert.ok(h.runUntil(() => u.skill.active, 2), 'on with nobody on the field (the data DEFAULT waited for an enemy in her range)');
    h.run(1.1);
    assert.ok(a.findBuff('inspire') && a.findBuff('inspire:def'), '鼓舞 on the ally beside her');
    done(h);
  }
});

// =================================================================================================================
// 6_05 异客

test('6_05 异客 S1 电能之触: next attack atk_scale × ATK, 4 bounces with the trait falloff (module: 0.9 / none: 0.85), 1.5 s 停顿', () => {
  for (const id of both('chess_char_6_05')) {
    const sid = 'skchr_pasngr_1', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 4, { carryState: { sp: 5 } })], // (孤卒's aura settled before the cast)
      enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }, { key: 'e', pos: [11, 7] }, { key: 'e', pos: [11, 8] }, { key: 'e', pos: [12, 8] }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill), 5));
    h.run(0.8); // bolt in flight
    const a = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    const aid = hits[0].dmg.attackId;
    const one = hits.filter((c) => c.dmg.attackId === aid);
    assert.equal(one.length, bb['pasngr_s_1.max_target'], '4 targets');
    const main = one[0];
    approx(main.amount, u.s.atk * bb['pasngr_s_1.atk_scale'] * tal(id)['pasngr_t_1[enhance].damage_scale'], 'main (机理分析 on a full-HP target)');
    const tb = tbOf(id);
    const fall = tb['skill@pasngr_s_1.chain.atk_scale'] != null ? 1 - tb['skill@pasngr_s_1.chain.atk_scale'] : 0.15;
    for (let k = 1; k < one.length; k++) approx(one[k].amount / main.amount, Math.pow(1 - fall, k), `bounce ${k}`);
    const sl = statuses(h, 'sluggish', (c) => c.source === u && c.t >= a.t);
    assert.ok(sl.some((c) => Math.abs(c.duration - bb['pasngr_s_1.sluggish']) < 1e-9), '1.5 s 停顿');
    done(h);
  }
});

test('6_05 异客 S2 聚焦指令: range +1, ATK +, base attack time ×0.7/×0.6 (akdata 乘算负数), 5 bounces', () => {
  for (const id of both('chess_char_6_05')) {
    const sid = 'skchr_pasngr_2', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 4, { carryState: READY })],
      enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }, { key: 'e', pos: [11, 7] }, { key: 'e', pos: [11, 8] }, { key: 'e', pos: [12, 8] }, { key: 'e', pos: [12, 9] }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd, 'base attack time ×(1 − 0.3 / 0.4), not a flat −0.3 / −0.4 s');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    assert.ok(u.rangeKeySet.has(10 * COLS + 8) && !u.baseRangeKeys.includes(10 * COLS + 8), 'range +1');
    h.run(3);
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    const aid = hits[0].dmg.attackId;
    assert.equal(hits.filter((c) => c.dmg.attackId === aid).length, bb['attack@max_target'], '5 targets');
    done(h);
  }
});

// =================================================================================================================
// 6_06 佩佩

test('6_06 佩佩 S1 盖戳！: next attack atk_scale × ATK; cast while stunned, cleansing the stun', () => {
  for (const id of both('chess_char_6_06')) {
    const sid = 'skchr_pepe_1', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill), 5));
    const main = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill && !c.dmg.isSplash)[0];
    approx(main.amount, u.s.atk * bb.atk_scale, 'atk_scale × ATK');
    done(h);

    const g = run({ units: [U(id, sid, 10, 4, { carryState: READY })] });
    const v = g.unit(id);
    g.step();
    g.b.applyStatus(v, 'stun', { duration: 10, force: true });
    assert.ok(v.findBuff('stun'));
    g.step(2);
    assert.ok(!v.findBuff('stun'), 'cleansed');
    assert.equal(started(g, v)[0]?.reason, 'abnormal');
    assert.ok(v.skill.active && v.skill.pending, 'the stamp waits for her next attack');
    done(g);
  }
});

test('6_06 佩佩 S2 阻遏混乱锤: skill range, ATK/ASPD +, random targets; every use adds ASPD +attack_speed_extra to later casts (2 stacks)', () => {
  for (const id of both('chess_char_6_06')) {
    const sid = 'skchr_pepe_2', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4)], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    h.step();
    const as0 = u.s.aspd;
    const aspdAt = () => { u.markDirty(); return u.s.aspd; };
    assert.ok(u.skill.activate('test', { free: true }));
    approx(aspdAt(), as0 + bb.attack_speed, '1st use');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    assert.ok(u.rangeKeySet.has(10 * COLS + 6), 'skill range reaches 2 tiles');
    h.run(2.5);
    assert.ok(dealt(h, u, (c) => c.dmg.isAttack).some((c) => c.target.x > 5.5), 'hits the enemy only the skill range reaches');
    u.skill.end('test');
    assert.ok(u.skill.activate('test', { free: true }));
    approx(aspdAt(), as0 + bb.attack_speed + bb.attack_speed_extra, '2nd use');
    u.skill.end('test');
    assert.ok(u.skill.activate('test', { free: true }));
    approx(aspdAt(), as0 + bb.attack_speed + bb.attack_speed_extra * bb.max_stack_cnt, '3rd use (max stacks)');
    u.skill.end('test');
    u.skill.activate('test', { free: true });
    approx(aspdAt(), as0 + bb.attack_speed + bb.attack_speed_extra * bb.max_stack_cnt, 'capped');
    done(h);
  }
});

// =================================================================================================================
// 6_07 维娜·维多利亚

test('6_07 维娜 S1 重铸晖光: next attack adds atk_scale × ATK true damage to every ground enemy around her', () => {
  for (const id of both('chess_char_6_07')) {
    const sid = 'skchr_siege2_1', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [9, 4] }, { key: 'e', pos: [11, 4] }, { key: 'e', pos: [10, 3] }, { key: 'e', pos: [11, 5] }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill), 5));
    const tr = dealt(h, u, (c) => c.type === 'true' && c.dmg.isSkill);
    assert.equal(tr.length, 4, 'the 4 enemies of the plus shape (not the diagonal one)');
    for (const x of tr) approx(x.amount, u.s.atk * bb.atk_scale, 'atk_scale × ATK true');
    done(h);
  }
});

test('6_07 维娜 S2 进赴故土: passive SP +0.3/0.5 with ≥2 allies around her; toggle: ATK +, range +1, 2 targets', () => {
  for (const id of both('chess_char_6_07')) {
    const sid = 'skchr_siege2_2', bb = bbOf(id, sid);
    const p = run({
      defs: { chess: { a1: plain('a1'), a2: plain('a2') } },
      units: [U(id, sid, 10, 4, { carryState: IDLE }), { chessId: 'a1', row: 9, col: 4 }, { chessId: 'a2', row: 11, col: 4 }],
    });
    const pu = p.unit(id);
    p.run(0.5);
    approx(pu.s.spRecovery, pu.base.spRecovery + bb.sp_recovery_per_sec, 'passive SP');
    done(p);

    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.kind, 'toggle');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    const t0 = h.b.time;
    h.run(3);
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.t > t0);
    assert.equal(new Set(hits.map((c) => c.target)).size, 2, 'both enemies (the far one only via range +1)');
    done(h);
  }
});

// =================================================================================================================
// 6_08 焰影苇草

test('6_08 焰影苇草 S1 迅捷打击·γ型: ATK / ASPD +', () => {
  for (const id of both('chess_char_6_08')) {
    const sid = 'skcom_quickattack[3]', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    approx(skillBuff(u).mods.atkPct, bb.atk);
    approx(skillBuff(u).mods.aspd, bb.attack_speed);
    approx(u.skill.duration, rec(id, sid).duration);
    done(h);
  }
});

test('6_08 焰影苇草 S2 枯荣共息: fireballs on ground operators of her range: every 1.5 s atk_scale × her ATK arts, healing only the carrier', () => {
  for (const id of both('chess_char_6_08')) {
    const sid = 'skchr_reed2_2', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { g1: plain('g1', { stats: { maxHp: 1e5 } }), g2: plain('g2', { stats: { maxHp: 1e5 } }) }, enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 3, { carryState: READY }), { chessId: 'g1', row: 10, col: 5 }, { chessId: 'g2', row: 11, col: 5 }],
      enemies: [{ key: 'e', pos: [10, 6] }],
    });
    const u = h.unit(id), g1 = h.unit('g1'), g2 = h.unit('g2');
    usesSkill(u, sid);
    h.step();
    g1.hp = g1.s.maxHp * 0.5; g2.hp = g2.s.maxHp * 0.5;
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const carriers = u.mem.reedFire.map((f) => f.a);
    assert.equal(carriers.length, bb.max_target, `${bb.max_target} carrier(s)`);
    const t0 = h.b.time;
    h.run(bb.cooldown * 2 + 0.05);
    const fb = dealt(h, u, (c) => (c.dmg.tags || []).includes('fireball'));
    assert.equal(fb.length, 2 * carriers.length, 'one shot per carrier every cooldown');
    approx(fb[0].t - t0, bb.cooldown, 'cooldown', 0.05);
    for (const x of fb) {
      const r = x.amount / (u.s.atk * bb.atk_scale);
      assert.ok(Math.abs(r - 1) < 1e-6 || Math.abs(r - tal(id).damage_scale) < 1e-6, `atk_scale × ATK (灼痕 fragile allowed): ${r}`);
    }
    // her trait on each fireball heals only its carrier: trait scale × the damage (× 映耀's boost on the elite)
    const want = tbOf(id).scale * (tal(id, null, 1).heal_scale ?? 1);
    for (const x of fb) {
      const same = fb.filter((y) => Math.abs(y.t - x.t) < 1e-9 && Math.abs(y.amount - x.amount) < 1e-6 * x.amount).length;
      const fh = heals(h, u, (c) => c.opts?.tags?.includes('incantation') && Math.abs(c.t - x.t) < 1e-9 && Math.abs(c.amount - x.amount * want) < 1e-6 * x.amount);
      assert.equal(fh.length, same, 'one trait heal per fireball');
      assert.ok(fh.every((c) => carriers.includes(c.target)), 'on a carrier');
    }
    done(h);
  }
});

// =================================================================================================================
// 6_09 塑心

test('6_09 塑心 S2 “安魂的弥撒”: normal attacks allowed; ASPD +, 2 targets; her and the top-ATK ally\'s damage adds ep_damage_ratio × her ATK 凋亡', () => {
  for (const id of both('chess_char_6_09')) {
    const sid = 'skchr_cello_2', bb = bbOf(id, sid);
    const idle = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: IDLE })], enemies: [{ key: 'e', pos: [10, 6] }] });
    const iu = idle.unit(id);
    idle.run(3);
    assert.ok(idle.hooksOf('attack').some((c) => c.attacker === iu && !c.isSkill), 'attacks without the skill (S1-only rule)');
    done(idle);

    const h = run({
      defs: { chess: { big: plain('big', { stats: { atk: 2000 } }), small: plain('small', { stats: { atk: 100 } }) }, enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 4, { carryState: READY }), { chessId: 'big', row: 10, col: 5 }, { chessId: 'small', row: 11, col: 5 }],
      enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 6] }],
    });
    const u = h.unit(id), big = h.unit('big'), small = h.unit('small');
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    approx(skillBuff(u).mods.aspd, bb.attack_speed);
    const t0 = started(h, u)[0].t;
    assert.equal(u.mem.celloPartner, big, 'highest-ATK other operator of her range');
    h.run(1.5); // (before a 凋亡 burst locks the gauges)
    assert.ok(h.enemies().every((e) => !e.findBuff('apoptosisBurst')));
    const direct = (c) => c.type !== 'element' && c.type !== 'elemental' && c.amount > 0 && c.target.side === 'enemy' && c.t >= t0 - 1e-9;
    const fills = h.hooksOf('elementHit').filter((c) => c.source === u && c.dmg.element === 'apoptosis' && (c.dmg.tags || []).includes('skill'));
    const own = h.hooksOf('damaged').filter((c) => (c.source === u || c.source === big) && direct(c));
    assert.ok(h.hooksOf('damaged').some((c) => c.source === big && direct(c)) && h.hooksOf('damaged').some((c) => c.source === small && direct(c)), 'both allies hit');
    assert.equal(fills.length, own.length, 'one 凋亡 per damage of hers or the partner\'s — none for the other ally');
    approx(fills[0].dmg.amount, u.s.atk * bb.ep_damage_ratio, 'ep_damage_ratio × her ATK', 1e-3);
    const hits = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
    assert.ok(hits.some((c) => c.targets.length === 2), '2 targets');
    done(h);
  }
});

test('6_09 塑心 S3 “自由的探戈”: no attack, skill range, ATK +; 精神逆构 ×scale_delta_to_one; top max HP / ATK / DEF allies +20/25 %', () => {
  for (const id of both('chess_char_6_09')) {
    const sid = 'skchr_cello_3', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { tank: plain('tank', { stats: { maxHp: 9000, atk: 100, def: 900 } }), dps: plain('dps', { stats: { maxHp: 1000, atk: 1500, def: 50 } }) }, enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 4, { carryState: READY }), { chessId: 'tank', row: 10, col: 5 }, { chessId: 'dps', row: 11, col: 5 }],
      enemies: [{ key: 'e', pos: [10, 6] }],
    });
    const u = h.unit(id), tank = h.unit('tank'), dps = h.unit('dps');
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    approx(skillBuff(u).mods.atkPct, bb.atk);
    assert.ok(u.rangeKeySet.has(10 * COLS + 7) && !u.baseRangeKeys.includes(10 * COLS + 7), 'range expanded');
    const t0 = h.b.time;
    h.run(3);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0).length, 0, 'stops attacking');
    approx(tank.findBuff('cello:tango:hp').mods.hpPct, bb['cello_s_3[max_hp].max_hp']);
    approx(tank.findBuff('cello:tango:def').mods.defPct, bb['cello_s_3[def].def']);
    approx(dps.findBuff('cello:tango:atk').mods.atkPct, bb['cello_s_3[atk].atk']);
    assert.ok(!dps.findBuff('cello:tango:hp') && !tank.findBuff('cello:tango:atk'));
    const fills = h.hooksOf('elementHit').filter((c) => c.source === u && c.dmg.element === 'apoptosis' && c.t > t0);
    assert.ok(fills.length > 0);
    approx(fills[0].dmg.mul, 1 + (tal(id, null, 1).ep_damage_scale - 1) * bb.scale_delta_to_one, '精神逆构 × N', 1e-9);
    done(h);
  }
});

// =================================================================================================================
// 6_11 缪尔赛思

function mlyssBattle(id, sid, extra = {}) {
  const log = [];
  const h = run({
    defs: { chess: { guard: plain('guard', { profession: 'WARRIOR', stats: { maxHp: 3000, atk: 800, def: 100 } }), ...(extra.chess || {}) }, enemies: { e: dummy('e') } },
    units: [U(id, sid, 10, 3, extra.unit ?? { carryState: READY }), { chessId: extra.copyId ?? 'guard', row: 11, col: 5 }, { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 10, col: 5, ownerUid: 1 }],
    enemies: [{ key: 'e', pos: [10, 6], time: extra.enemyAt ?? 7 }],
    flags: { dpInit: 0, dpPerSec: 0 },
    setup(b) { const add = b.addDp.bind(b); b.addDp = (pid, n) => { log.push({ t: b.time, n }); return add(pid, n); }; },
  });
  h.dpLog = log;
  return h;
}

test('6_11 缪尔赛思 S1 渐进性润化: fake_cost DP gradually over the skill; she and the 流形 ATK / ASPD +', () => {
  for (const id of both('chess_char_6_11')) {
    const sid = 'skchr_mlyss_1', bb = bbOf(id, sid);
    const h = mlyssBattle(id, sid);
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 20));
    const t0 = h.b.time;
    approx(skillBuff(u).mods.atkPct, bb.atk);
    approx(skillBuff(u).mods.aspd, bb.attack_speed);
    const tok = h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
    assert.ok(tok.findBuff('mlyss:s3') && tok.findBuff('mlyss:s3').mods.aspd === bb.attack_speed, '流形 buffed too');
    h.run(bb['mlyss_s_1[cost].interval'] * 3 + 0.05);
    const gains = h.dpLog.filter((x) => x.t >= t0 - 1e-9);
    assert.equal(gains.length, 3, 'one DP per interval');
    assert.ok(h.runUntil(() => !u.skill.active, 20));
    const total = h.dpLog.filter((x) => x.t >= t0 - 1e-9).reduce((s, x) => s + x.n, 0);
    assert.equal(total, bb.fake_cost, `${bb.fake_cost} DP in all`);
    done(h);
  }
});

test('6_11 缪尔赛思 S2 生态耦合: +cost DP; melee copies regenerate and take 庇护, ranged copies double-hit random targets', () => {
  for (const id of both('chess_char_6_11')) {
    const sid = 'skchr_mlyss_2', bb = bbOf(id, sid);
    const h = mlyssBattle(id, sid);
    const u = h.unit(id);
    usesSkill(u, sid);
    const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
    assert.ok(h.runUntil(() => u.skill.active, 20));
    assert.ok(h.dpLog.some((x) => x.n === bb.cost), `+${bb.cost} DP`);
    assert.equal(tok().mem.mlyss?.ranged, false, 'melee copy of the guard');
    h.run(0.3);
    const eco = tok().findBuff('mlyss:eco');
    assert.ok(eco, 'melee copy buffed');
    approx(eco.mods.hpRegenRatio, bb.hp_recovery_per_sec_by_max_hp_ratio);
    // 庇护: the shared effect of every source (同名效果取最高 — kits/shared/tier1.js holdProtect)
    const protect = tok().findBuff('protect');
    assert.ok(protect && protect.source === u, 'the 庇护 she grants');
    approx(protect.mods.physTakenMul, 1 - bb.damage_resistance);
    approx(protect.mods.artsTakenMul, 1 - bb.damage_resistance);
    done(h);

    // ranged copy: a sniper to copy
    const r = mlyssBattle(id, sid, { copyId: 'chess_char_1_01_a' });
    const ru = r.unit(id);
    assert.ok(r.runUntil(() => ru.skill.active, 20));
    const rt = r.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive && x.mem.mlyss);
    assert.equal(rt.mem.mlyss.ranged, true);
    r.run(0.3);
    assert.equal(rt.profile.hits, 2 * rt.mem.mlyssHits, '二连击');
    assert.ok(r.runUntil(() => !ru.skill.active, 20));
    r.run(0.3);
    assert.equal(rt.profile.hits, rt.mem.mlyssHits, 'back to one hit');
    done(r);
  }
});

// =================================================================================================================
// 6_12 迷迭香

test('6_12 迷迭香 S1 思维膨大: the next attack adds extra_atk_scale × ATK arts to every enemy it hits', () => {
  for (const id of both('chess_char_6_12')) {
    const sid = 'skchr_rosmon_1', bb = bbOf(id, sid);
    // the second enemy inside the 投掷手 splash (PRTS 溅射半径一览 0.9) of the first
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 7] }, { key: 'e', pos: [10, 7.6] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.type === 'arts').length >= 2, 6));
    const extra = dealt(h, u, (c) => c.type === 'arts' && c.dmg.isSkill);
    assert.equal(new Set(extra.map((c) => c.target)).size, 2, 'main + splash');
    for (const x of extra) approx(x.amount, u.s.atk * bb.extra_atk_scale, 'extra arts');
    done(h);
  }
});

test('6_12 迷迭香 S3 “如你所愿”: two 战术装备 in range, base attack time ×0.5 (akdata 乘算负数), ATK +, 2 targets — blocked enemies only', () => {
  for (const id of both('chess_char_6_12')) {
    const sid = 'skchr_rosmon_3', bb = bbOf(id, sid);
    const h = run({
      defs: { enemies: { e: dummy('e'), f: dummy('f', { motion: 'FLY' }) } },
      units: [U(id, sid, 10, 3, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 7] }, { key: 'e', pos: [9, 8] }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const gears = h.b.allyUnits.filter((t) => t.defId === 'token_10012_rosmon_shield' && t.alive);
    assert.equal(gears.length, 2, 'two gears');
    approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd, 'base attack time ×0.5, not a flat −0.5 s');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    const t0 = h.b.time;
    h.run(6);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0);
    assert.ok(atks.length > 0);
    for (const a of atks) for (const e of a.targets) assert.ok(e.blockedBy, 'blocked targets only');
    assert.ok(atks.some((a) => a.targets.length === 2) || h.enemies().filter((e) => e.blockedBy).length < 2, '2 targets');
    assert.ok(statuses(h, 'stun', (c) => c.source?.defId === 'token_10012_rosmon_shield').length > 0, 'gear appear stun');
    done(h);
  }
});

// =================================================================================================================
// 6_13 新约能天使

test('6_13 新约能天使 S1 天空大扫除: 8 bullets at attack@atk_scale × ATK, flyers first; stopped by hand ⇒ the rest is fired at random', () => {
  for (const id of both('chess_char_6_13')) {
    const sid = 'skchr_angel2_1', bb = bbOf(id, sid);
    const mk = () => run({
      defs: { enemies: { g: dummy('g'), f: dummy('f', { motion: 'FLY' }) } },
      units: [U(id, sid, 10, 4, { carryState: { sp: rec(id, sid).spCost - 1 } })], // (铳弹协约's aura settled first)
      enemies: [{ key: 'g', pos: [10, 5] }, { key: 'f', pos: [10, 7] }],
    });
    const h = mk();
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.ammoLeft + h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length, bb['attack@trigger_time']);
    const t0 = h.b.time;
    assert.ok(h.runUntil(() => !u.skill.active, 60));
    h.run(1); // shots in flight
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill && c.t >= t0 - 1e-9);
    assert.equal(hits.length, bb['attack@trigger_time']);
    assert.ok(hits.every((c) => isKey(c.target, 'f')), 'the flyer first');
    for (const x of hits) approx(x.amount, u.s.atk * bb['attack@atk_scale'], 'atk_scale');
    done(h);

    const g = mk();
    const v = g.unit(id);
    assert.ok(g.runUntil(() => g.hooksOf('attack').filter((c) => c.attacker === v && c.isSkill).length >= 2, 12));
    const left = v.mem.angelLeft;
    assert.equal(left, bb['attack@trigger_time'] - 2);
    const used0 = g.hooksOf('ammoUsed').filter((c) => c.unit === v).length;
    v.skill.stop();
    const volley = dealt(g, v, tagged('volley'));
    assert.equal(volley.length, left, 'every remaining bullet fired');
    assert.equal(g.hooksOf('ammoUsed').filter((c) => c.unit === v).length - used0, left);
    done(g);
  }
});

test('6_13 新约能天使 S3 使命必达！: 5 hits per attack spending 5 bullets; 投递坐标 after deploy: bombardment + a knocked-out ground operator delivered with 6 SP', () => {
  for (const id of both('chess_char_6_13')) {
    const sid = 'skchr_angel2_3', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { vg: plain('vg', { skill: { skillId: 'sk_vg', spCost: 30, initSp: 0 }, stats: { respawnTime: 60 } }) }, enemies: { e: dummy('e') } },
      units: [U(id, sid, 10, 3, { carryState: { sp: rec(id, sid).spCost - 2 } }), { chessId: 'vg', row: 12, col: 3 }], enemies: [{ key: 'e', pos: [10, 6] }],
    });
    const u = h.unit(id), vg = h.unit('vg');
    usesSkill(u, sid);
    h.step(2);
    const coord = h.b.allyUnits.find((t) => t.defId === 'token_10056_angel2_target' && t.alive);
    assert.ok(coord, '投递坐标 placed after deployment (next to the enemy entering her range)');
    assert.ok(Math.hypot(coord.x - 6, coord.y - 10) <= 1 + 1e-9, 'on the enemy side');
    const at = [coord.tileR, coord.tileC];
    h.b.dealDamage(null, vg, { amount: 1e9, type: 'true' });
    assert.ok(!vg.alive);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    assert.ok(h.b.time > 1, 'cast after the knock-out');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    assert.ok(vg.alive, 'delivered');
    assert.deepEqual([vg.tileR, vg.tileC], at, 'onto the coordinate');
    assert.ok(vg.skill.sp >= bb['attack@sp'] - 1e-9 && vg.skill.sp < bb['attack@sp'] + 0.2, `+${bb['attack@sp']} SP (${vg.skill.sp})`);
    const boom = dealt(h, u, tagged('delivery'));
    assert.equal(boom.length, 1);
    approx(boom[0].amount, u.s.atk * bb['attack@cannon_atk_scale'], 'cannon');
    h.run(4);
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    const aid = hits[0].dmg.attackId;
    assert.equal(hits.filter((c) => c.dmg.attackId === aid).length, 5, '5 连击');
    for (const x of hits) approx(x.amount, u.s.atk * bb['attack@atk_scale'], 'atk_scale per hit');
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length;
    assert.equal(h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, 5 * atks, '5 bullets per attack');
    done(h);
  }
});

// =================================================================================================================
// 6_14 流明

test('6_14 流明 S1 沐雨: the next heal gives its target and the allies around it aura.heal_scale × ATK per second', () => {
  for (const id of both('chess_char_6_14')) {
    const sid = 'skchr_lumen_1', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { a1: plain('a1', { stats: { maxHp: 1e5 } }), a2: plain('a2', { stats: { maxHp: 1e5 } }), far: plain('far', { stats: { maxHp: 1e5 } }) } },
      units: [U(id, sid, 10, 3, { carryState: READY }), { chessId: 'a1', row: 10, col: 5 }, { chessId: 'a2', row: 11, col: 5 }, { chessId: 'far', row: 9, col: 7 }],
    });
    const u = h.unit(id), a1 = h.unit('a1'), a2 = h.unit('a2'), far = h.unit('far');
    usesSkill(u, sid);
    h.step();
    a1.hp = a1.s.maxHp * 0.3; a2.hp = a2.s.maxHp * 0.9; far.hp = far.s.maxHp * 0.9;
    assert.ok(h.runUntil(() => started(h, u).length > 0, 5));
    h.run(0.5);
    const key = `lumen:rain:${u.id}`;
    assert.ok(a1.findBuff(key) && a2.findBuff(key), 'target and its neighbour');
    assert.ok(!far.findBuff(key), 'not a distant ally');
    approx(a1.findBuff(key).duration, bb['aura.projectile_life_time']);
    h.run(1.1);
    const hot = heals(h, u, (c) => c.target === a2 && c.opts?.hot);
    assert.ok(hot.length >= 1);
    approx(hot[0].amount, u.s.atk * bb['aura.heal_scale'], 'per second');
    done(h);
  }
});

test('6_14 流明 S2 沛霖: 2 charges; heals 2 allies for heal_scale × ATK; with full charges also cleanses their 异常状态', () => {
  for (const id of both('chess_char_6_14')) {
    const sid = 'skchr_lumen_2', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { a1: plain('a1', { stats: { maxHp: 1e5 } }), a2: plain('a2', { stats: { maxHp: 1e5 } }), a3: plain('a3', { stats: { maxHp: 1e5 } }) } },
      units: [U(id, sid, 10, 3, { carryState: READY }), { chessId: 'a1', row: 10, col: 5 }, { chessId: 'a2', row: 11, col: 5 }, { chessId: 'a3', row: 9, col: 5 }],
    });
    const u = h.unit(id), a1 = h.unit('a1'), a2 = h.unit('a2'), a3 = h.unit('a3');
    usesSkill(u, sid);
    assert.equal(u.skill.maxCharges, 2);
    h.step();
    a1.hp = a1.s.maxHp * 0.3; a2.hp = a2.s.maxHp * 0.5; a3.hp = a3.s.maxHp * 0.7;
    h.b.applyStatus(a1, 'stun', { duration: 30, force: true });
    assert.ok(h.runUntil(() => started(h, u).length > 0, 5));
    const t0 = started(h, u)[0].t;
    const hh = heals(h, u, (c) => c.t === t0 && c.opts?.skillHeal);
    assert.equal(hh.length, bb.max_target, 'two allies');
    assert.deepEqual(hh.map((c) => c.target).sort((a, b) => a.id - b.id), [a1, a2].sort((a, b) => a.id - b.id), 'the most injured');
    for (const c of hh) approx(c.amount, u.s.atk * bb.heal_scale, 'heal_scale × ATK');
    assert.ok(!a1.findBuff('stun'), 'full charges ⇒ cleansed');
    done(h);
  }
});

// =================================================================================================================
// 6_15 仇白

test('6_15 仇白 S1 留羽: the next attack binds `duration` s; when it ends the target and its neighbours take aoe_scale × ATK arts', () => {
  for (const id of both('chess_char_6_15')) {
    const sid = 'skchr_qiubai_1', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [11, 5] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill), 5));
    const a = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
    const own = (c) => c.source === u && c.t >= a.t - 1e-9 && Math.abs(c.duration - bb.duration) < 1e-9;
    assert.ok(h.runUntil(() => statuses(h, 'bind', own).length > 0, 2));
    const bind = statuses(h, 'bind', own);
    approx(bind[0].duration, bb.duration, 'bound for `duration`');
    const tb0 = bind[0].t;
    h.run(bb.duration + 0.1);
    const aoe = dealt(h, u, (c) => c.dmg.isSkill && !c.dmg.isAttack && c.type === 'arts');
    assert.equal(aoe.length, 2, 'target + neighbour');
    approx(aoe[0].t - tb0, bb.duration, 'when the bind ends', 0.02);
    void a;
    for (const x of aoe) approx(x.amount, u.s.atk * bb.aoe_scale, 'aoe_scale × ATK');
    done(h);
  }
});

test('6_15 仇白 S2 承影: begin arts burst, skill range + ATK +, ground enemies in range 停顿, end physical burst', () => {
  for (const id of both('chess_char_6_15')) {
    const sid = 'skchr_qiubai_2', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 8] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    const t0 = started(h, u)[0].t;
    approx(skillBuff(u).mods.atkPct, bb.atk);
    const begin = dealt(h, u, (c) => c.t === t0 && c.dmg.isSkill && c.type === 'arts');
    assert.equal(begin.length, 2, 'both ground enemies of the 5-tile line');
    for (const x of begin) approx(x.amount, u.s.atk * bb.sword_begin_atk_scale, 'begin');
    h.run(1);
    assert.ok(h.enemies().every((e) => e.findBuff('sluggish')), '停顿');
    const atkEnd = u.s.atk;
    assert.ok(h.runUntil(() => !u.skill.active, 10));
    const end = dealt(h, u, (c) => c.dmg.isSkill && c.type === 'phys' && !c.dmg.isAttack);
    assert.equal(end.length, 2);
    for (const x of end) approx(x.amount, atkEnd * bb.sword_end_atk_scale, 'end');
    approx(end[0].t - t0, rec(id, sid).duration, 'at the end', 0.05);
    done(h);
  }
});

// =================================================================================================================
// 6_16 溯光星源

test('6_16 溯光星源 S1 星图闪烁: ATK +; every attack bounces 3 more times between enemies (back and forth)', () => {
  for (const id of both('chess_char_6_16')) {
    const sid = 'skchr_halo2_1', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    approx(skillBuff(u).mods.atkPct, bb.atk);
    assert.ok(h.runUntil(() => dealt(h, u, tagged('chain')).length >= bb['attack@chain.max_target'], 5));
    const ch = dealt(h, u, tagged('chain')).slice(0, bb['attack@chain.max_target']);
    for (let i = 1; i < ch.length; i++) assert.notEqual(ch[i].target, ch[i - 1].target, 'never twice in a row');
    assert.equal(ch[0].target, ch[2].target, 'back and forth');
    for (const x of ch) approx(x.amount, u.s.atk, 'full hits');
    done(h);
  }
});

test('6_16 溯光星源 S2 星束引力: the target farthest from its goal, atk_scale × ATK + 3 s 停顿; up to 2 linked neighbours pulled in and hit', () => {
  for (const id of both('chess_char_6_16')) {
    const sid = 'skchr_halo2_2', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill), 5));
    const [n0, f0] = [enemyOf(h, 'e', 0), enemyOf(h, 'e', 1)];
    const a = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
    const main = n0.x > f0.x ? n0 : f0, side = main === n0 ? f0 : n0;
    assert.deepEqual(a.targets, [main], 'the enemy farthest from its goal');
    const x0 = 5;
    h.run(1);
    const hit = dealt(h, u, (c) => c.target === main && c.dmg.isAttack && c.dmg.isSkill)[0];
    approx(hit.amount, u.s.atk * bb.atk_scale, 'atk_scale');
    assert.ok(statuses(h, 'sluggish', (c) => c.source === u && c.target === main && Math.abs(c.duration - bb.sluggish) < 1e-9).length === 1, '3 s 停顿');
    const link = dealt(h, u, (c) => c.target === side && (c.dmg.tags || []).includes('link'));
    assert.equal(link.length, 1, 'linked neighbour hit');
    approx(link[0].amount, u.s.atk * bb.atk_scale_link, 'link');
    assert.ok(side.x > x0 + 0.05 || main.x < side.x, `pulled toward the target (${x0} → ${side.x})`);
    done(h);
  }
});

// =================================================================================================================
// 6_17 耀骑士临光

test('6_17 耀骑士临光 S1 灿焰长刃: toggle, skill range, ATK / ASPD +', () => {
  for (const id of both('chess_char_6_17')) {
    const sid = 'skchr_nearl2_1', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.kind, 'toggle');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    approx(skillBuff(u).mods.aspd, bb.attack_speed);
    assert.ok(u.rangeKeySet.has(10 * COLS + 6));
    done(h);
  }
});

test('6_17 耀骑士临光 S2 逐夜烁光: on deploy ATK + and 3 护盾 layers for the skill time, then she withdraws; redeploy ×1.25 (×1 after a 卡西米尔 deploy)', () => {
  for (const id of both('chess_char_6_17')) {
    const sid = 'skchr_nearl2_2', bb = bbOf(id, sid), dur = rec(id, sid).duration;
    const h = run({
      defs: { enemies: { hit: enemyRec({ key: 'hit', hp: 1e7, speed: 0, atk: 500, bat: 1 }) } },
      units: [U(id, sid, 10, 4)], enemies: [{ key: 'hit', pos: [10, 4] }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    h.step();
    approx(u.skill.spec.mods.atkPct, bb.atk);
    assert.equal(u.skill.kind, 'duration');
    assert.equal(u.skill.active, true);
    assert.equal(u.skill.ready, false);
    assert.equal(h.snapshot().units.find((t) => t[0] === u.id)[6], dur);
    assert.equal(u.findBuff('nearl2:shield').shieldHits, bb.times);
    h.run(bb.times * 1.2 + 1);
    const taken = h.hooksOf('damaged').filter((c) => c.target === u);
    assert.ok(taken.slice(0, bb.times).every((c) => c.amount === 0), 'the first 3 hits are negated');
    assert.ok(taken.slice(bb.times).some((c) => c.amount > 0));
    for (const e of h.enemies()) h.b.dealDamage(null, e, { amount: 1e9, type: 'true' });
    assert.ok(h.runUntil(() => !u.alive, dur + 1));
    approx(h.b.time, dur, 'withdraws when it ends', 0.05);
    approx(u.respawnAt - h.b.time, u.base.respawnTime * bb.respawn_time, 'this redeploy ×1.25', 1e-3);
    assert.equal(u.removeReason, 'retreat');
    assert.equal(u.skill.active, false);
    assert.deepEqual(h.hooksOf('skillEnd').filter((c) => c.unit === u).map((c) => c.reason), ['duration']);
    done(h);

    const k = run({ defs: { chess: { kaz: plain('kaz', { bonds: ['kazimierzShip'] }) } }, units: [U(id, sid, 10, 4), { chessId: 'kaz', row: 12, col: 4 }] });
    const ku = k.unit(id);
    k.step(2);
    assert.ok(ku.alive && ku.skill.active);
    assert.ok(k.runUntil(() => !ku.alive, dur + 1));
    approx(ku.respawnAt - k.b.time, ku.base.respawnTime, '卡西米尔 before her: no extension', 1e-3);
    done(k);

    const dead = run({ units: [U(id, sid, 10, 4, { moduleId: 'none' })] });
    dead.step();
    const du = dead.unit(id);
    dead.b.kill(du);
    const respawnAt = du.respawnAt;
    approx(respawnAt - dead.b.time, du.base.respawnTime, 'early death keeps ordinary redeployment');
    assert.equal(du.findBuff('nearl2:shield'), null);
    dead.run(dur + 1);
    assert.equal(du.respawnAt, respawnAt, 'no delayed retreat or multiplier after death');
    assert.deepEqual(dead.hooksOf('skillEnd').filter((c) => c.unit === du).map((c) => c.reason), ['death']);
    done(dead);
  }
});

// =================================================================================================================
// 6_18 荒芜拉普兰德

test('6_18 荒芜拉普兰德 S1 慵怠者悲鸣: passive 浮游单元+1 (2 hits per attack); toggled on: ATK + and the drones lock still enemies anywhere', () => {
  for (const id of both('chess_char_6_18')) {
    const sid = 'skchr_whitw2_1', bb = bbOf(id, sid);
    const idle = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: IDLE })], enemies: [{ key: 'e', pos: [10, 6] }] });
    const iu = idle.unit(id);
    idle.run(3);
    const a0 = idle.hooksOf('attack').find((c) => c.attacker === iu);
    assert.ok(a0);
    idle.run(1);
    assert.equal(dealt(idle, iu, (c) => c.dmg.attackId === dealt(idle, iu)[0].dmg.attackId).length, 2, 'drone +1');
    done(idle);

    const h = run({
      defs: { enemies: { far: dummy('far'), w: enemyRec({ key: 'w', hp: 1e7, speed: 1 }) } },
      units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'far', pos: [12, 16] }, { key: 'w', route: 0 }],
    });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 20), 'toggled on when the walker is in range');
    assert.equal(u.skill.kind, 'toggle');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    const t0 = h.b.time;
    h.run(4);
    const far = enemyOf(h, 'far');
    assert.ok(dealt(h, u, (c) => c.target === far && c.t > t0).length > 0, 'hits the still enemy far outside her range');
    assert.ok(dealt(h, u, (c) => isKey(c.target, 'w') && c.t > t0 + 1).length === 0 || enemyOf(h, 'w').blockedBy, 'not the walking one');
    done(h);
  }
});

test('6_18 荒芜拉普兰德 S2 逐猎狂飙: 1 + attack@cnt drones lock random enemies of the skill range, ATK +, each drone ramps on its own target', () => {
  for (const id of both('chess_char_6_18')) {
    const sid = 'skchr_whitw2_2', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    approx(skillBuff(u).mods.atkPct, bb.atk);
    const t0 = h.b.time;
    h.run(4);
    const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill && c.t >= t0 - 1e-9);
    assert.ok(atks.length >= 2);
    for (const a of atks) assert.equal(a.targets.length, 1 + bb['attack@cnt'], '4 drones');
    const f = u.profile.funnel;
    const first = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill)[0];
    approx(first.amount / (u.s.atk * u.s.dmgDealtMul), f.init, 'a fresh lock starts at the initial scale', 1e-3);
    const all = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.ok(all.some((c) => c.amount > first.amount * 1.01), 'ramps up');
    assert.ok(all.every((c) => c.amount <= u.s.atk * u.s.dmgDealtMul * f.max * 1.0001), 'capped');
    done(h);
  }
});

// =================================================================================================================
// 6_19 锏

test('6_19 锏 S1 纯粹的武力: the next attack hits up to 5/6 ground enemies around her, twice each, at atk_scale_s1 × ATK', () => {
  for (const id of both('chess_char_6_19')) {
    const sid = 'skchr_blkkgt_1', bb = bbOf(id, sid);
    const pos = [[9, 3], [9, 4], [9, 5], [10, 3], [10, 5], [11, 3], [11, 4], [11, 5]];
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: pos.map((p) => ({ key: 'e', pos: p })) });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill), 5));
    const a = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
    assert.equal(a.targets.length, bb.max_target, `${bb.max_target} targets`);
    const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
    assert.equal(hits.length, 2 * bb.max_target, 'two hits each');
    const base = u.s.atk * bb.atk_scale_s1 * (tbOf(id).damage_scale ?? 1), sc = tal(id).atk_scale;
    for (const x of hits) assert.ok(Math.abs(x.amount - base) < 1e-6 || Math.abs(x.amount - base * sc) < 1e-6, `atk_scale_s1 (talent proc allowed): ${x.amount} vs ${base}`);
    done(h);
  }
});

test('6_19 锏 S2 无声的嘲笑: 2 slashes (3 on blocked enemies) of dot_scale × ATK on ≤5 ground enemies in front, talent at 100 %', () => {
  for (const id of both('chess_char_6_19')) {
    const sid = 'skchr_blkkgt_2', bb = bbOf(id, sid);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, sid, 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 4] }, { key: 'e', pos: [10, 5] }, { key: 'e', pos: [11, 5] }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    assert.ok(h.runUntil(() => started(h, u).length > 0, 5));
    const t0 = started(h, u)[0].t;
    const sl = dealt(h, u, (c) => c.t === t0 && (c.dmg.tags || []).includes('slash'));
    const blocked = h.enemies().filter((e) => e.blockedBy === u);
    assert.ok(blocked.length >= 1);
    for (const e of h.enemies()) {
      const n = sl.filter((c) => c.target === e).length;
      assert.equal(n, e.blockedBy === u ? bb['blkkgt_s_2[blocked].trig_cnt'] : bb['blkkgt_s_2[not_blocked].trig_cnt'], `slashes on ${e.id}`);
    }
    const sc = tal(id).atk_scale, mul = tbOf(id).damage_scale ?? 1;
    for (const x of sl) approx(x.amount, u.s.atk * bb.dot_scale * sc * mul, 'dot_scale × ATK × talent (100 %)');
    assert.ok(statuses(h, 'tremble', (c) => c.source === u && c.t === t0).length > 0, 'talent 战栗');
    done(h);
  }
});

// =================================================================================================================
// 6_20 纯烬艾雅法拉

test('6_20 纯烬艾雅法拉 S1 无声润物: toggle heal; ATK +, 2 heal targets; allies in range recover ep_heal_ratio × ATK 元素损伤 per second', () => {
  for (const id of both('chess_char_6_20')) {
    const sid = 'skchr_agoat2_1', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { a1: plain('a1', { stats: { maxHp: 1e5 } }), a2: plain('a2', { stats: { maxHp: 1e5 } }), a3: plain('a3') } },
      units: [U(id, sid, 10, 3, { carryState: READY }), { chessId: 'a1', row: 10, col: 5 }, { chessId: 'a2', row: 11, col: 5 }, { chessId: 'a3', row: 9, col: 5 }],
    });
    const u = h.unit(id), a1 = h.unit('a1'), a2 = h.unit('a2'), a3 = h.unit('a3');
    usesSkill(u, sid);
    h.step();
    a1.hp = a1.s.maxHp * 0.3; a2.hp = a2.s.maxHp * 0.4;
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.skill.kind, 'toggle');
    approx(skillBuff(u).mods.atkPct, bb.atk);
    h.run(3);
    const hh = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
    assert.ok(hh.some((c) => c.targets.length === 2), 'two heal targets');
    h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } }); // (no heals: a3 never gets a 氤氲 HoT)
    a3.elem.burn = 800;
    h.run(1.05);
    approx(800 - a3.elem.burn, u.s.atk * bb['agoat2_s_1[aura].ep_heal_ratio'], 'per second', 1e-3);
    done(h);
  }
});

test('6_20 纯烬艾雅法拉 S1 无声润物 (自动触发, effects on her allies only): on as soon as its SP is full — nobody injured, no enemy (the owner\'s decision of 2026-10-05)', () => {
  for (const id of both('chess_char_6_20')) {
    const sid = 'skchr_agoat2_1', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { a1: plain('a1', { stats: { maxHp: 1e5 } }) } },
      units: [U(id, sid, 10, 3, { carryState: READY }), { chessId: 'a1', row: 10, col: 5 }],
    });
    const u = h.unit(id), a1 = h.unit('a1');
    usesSkill(u, sid);
    assert.equal(u.skill.rule, 'SP_FULL');
    assert.ok(h.runUntil(() => u.skill.active, 2), 'on with every ally at full HP and no enemy (the data DEFAULT heal rule waited for an injured ally)');
    assert.equal(a1.hp, a1.s.maxHp);
    h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } }); // (no heals: only the skill's 元素损伤 recovery)
    a1.elem.burn = 800;
    h.run(1.05);
    approx(800 - a1.elem.burn, u.s.atk * bb['agoat2_s_1[aura].ep_heal_ratio'], 'its 元素损伤 recovery runs at full HP', 1e-3);
    done(h);
  }
});

test('6_20 纯烬艾雅法拉 S2 云霭荫佑: one heal on every ally of her range, then a barrier absorbing atk_scale × ATK of 元素损伤 for `duration` s', () => {
  for (const id of both('chess_char_6_20')) {
    const sid = 'skchr_agoat2_2', bb = bbOf(id, sid);
    const h = run({
      defs: { chess: { a1: plain('a1', { stats: { maxHp: 1e5 } }), a2: plain('a2', { stats: { maxHp: 1e5 } }) } },
      units: [U(id, sid, 10, 3, { carryState: READY }), { chessId: 'a1', row: 10, col: 5 }, { chessId: 'a2', row: 11, col: 5 }],
    });
    const u = h.unit(id), a1 = h.unit('a1'), a2 = h.unit('a2');
    usesSkill(u, sid);
    h.step();
    a1.hp = a1.s.maxHp * 0.3; a2.hp = a2.s.maxHp * 0.4;
    assert.ok(h.runUntil(() => started(h, u).length > 0, 5));
    const t0 = started(h, u)[0].t;
    const hh = heals(h, u, (c) => c.t === t0);
    assert.equal(new Set(hh.map((c) => c.target)).size, 2, 'every ally of her range');
    const pool = u.s.atk * bb['agoat2_s_2[shield].atk_scale'];
    h.b.dealDamage(null, a1, { type: 'element', element: 'burn', amount: pool * 0.6 });
    assert.equal(a1.elem.burn, 0, 'absorbed');
    h.b.dealDamage(null, a2, { type: 'element', element: 'burn', amount: pool * 0.6 });
    approx(a2.elem.burn, pool * 0.2 * (a2.s.elemTakenMul ?? 1), 'the rest of the pool absorbed, the excess lands', 1e-3);
    h.run(bb.duration + 0.5);
    h.b.dealDamage(null, a1, { type: 'element', element: 'burn', amount: 100 });
    assert.ok(a1.elem.burn > 0, 'gone after its duration');
    done(h);
  }
});

// =================================================================================================================
// default-skill hooks stay with the default skill (kit talents / install run under every selected skill)

test('default-skill-only hooks do not run under an alternate skill (余 / 维娜 / 焰影苇草 / 流明 / 溯光星源 / 耀骑士临光 / 缪尔赛思)', () => {
  // 余 S2 active: 闲云隐市 is NOT given to every operator (S3 only)
  {
    const h = run({
      defs: { chess: { o1: plain('o1'), o2: plain('o2'), o3: plain('o3') }, enemies: { e: dummy('e', { atk: 100, bat: 1 }) } }, // (S2: an enemy on x-1)
      units: [U('chess_char_6_03_a', 'skchr_yu_2', 10, 4, { carryState: READY }), { chessId: 'o1', row: 9, col: 6 }, { chessId: 'o2', row: 11, col: 6 }, { chessId: 'o3', row: 12, col: 6 }],
      enemies: [{ key: 'e', pos: [10, 4] }],
    });
    const u = h.unit('chess_char_6_03_a'), o1 = h.unit('o1');
    assert.ok(h.runUntil(() => u.skill.active, 5));
    o1.hp = o1.s.maxHp * 0.5;
    h.run(2.2);
    assert.equal(heals(h, u, (c) => c.target === o1).length, 0, 'no regen for the others');
    assert.equal(u.mem.yuWall ?? null, null, 'no fire wall');
    done(h);
  }
  // 维娜 S2 (toggle) active: enemies blocked by allies around her are NOT added to her range (S3 only)
  {
    const h = run({
      defs: { chess: { b1: plain('b1') }, enemies: { e: dummy('e') } },
      units: [U('chess_char_6_07_a', 'skchr_siege2_2', 10, 4, { carryState: READY }), { chessId: 'b1', row: 11, col: 3 }],
      enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [11, 3] }],
    });
    const u = h.unit('chess_char_6_07_a');
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.run(1);
    assert.equal((u.extraRangeKeys || []).length, 0);
    done(h);
  }
  // 焰影苇草 S1: 灼痕 lasts its own 6 s, not "until the skill ends"
  {
    const id = 'chess_char_6_08_a';
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, 'skcom_quickattack[3]', 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => enemyOf(h, 'e')?.findBuff('reed2:scorch'), 30));
    assert.ok(u.skill.active);
    approx(enemyOf(h, 'e').findBuff('reed2:scorch').timeLeft, tal(id).duration, '6 s', 0.02);
    done(h);
  }
  // 流明 S1: her heals are not redirected to abnormal allies at full HP (S3 bookkeeping)
  {
    const id = 'chess_char_6_14_a';
    const h = run({
      defs: { chess: { a1: plain('a1', { stats: { maxHp: 1e5 } }), a2: plain('a2', { stats: { maxHp: 1e5 } }) } },
      units: [U(id, 'skchr_lumen_1', 10, 3, { carryState: READY }), { chessId: 'a1', row: 10, col: 5 }, { chessId: 'a2', row: 11, col: 5 }],
    });
    const u = h.unit(id), a1 = h.unit('a1'), a2 = h.unit('a2');
    h.step();
    a1.hp = a1.s.maxHp * 0.5;
    h.b.applyStatus(a2, 'stun', { duration: 30, force: true }); // (应急处理 heals it once right now — the talent)
    const ts = h.b.time;
    h.run(4);
    const hh = heals(h, u, (c) => !c.opts?.hot && !c.opts?.aura && c.t > ts + 0.05);
    assert.ok(hh.length > 0 && hh.every((c) => c.target !== a2 || c.amount === 0), 'the stunned full-HP ally is not forced a heal');
    assert.ok(a2.findBuff('stun'), 'nor cleansed');
    done(h);
  }
  // 溯光星源 S1: no persistent S3 locks / link transfer
  {
    const id = 'chess_char_6_16_a';
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [U(id, 'skchr_halo2_1', 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 5] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.run(3);
    assert.equal((u.mem.haloLocks || []).length, 0);
    assert.equal(dealt(h, u, tagged('link')).length, 0);
    done(h);
  }
  // 耀骑士临光 S1 (toggle): attacks on enemies she blocks stay physical (S3's true damage)
  {
    const id = 'chess_char_6_17_a';
    const h = run({ defs: { enemies: { e: dummy('e', { def: 300 }) } }, units: [U(id, 'skchr_nearl2_1', 10, 4, { carryState: READY })], enemies: [{ key: 'e', pos: [10, 4] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.run(3);
    const atk = dealt(h, u, (c) => c.dmg.isAttack);
    assert.ok(atk.length > 0 && atk.every((c) => c.type === 'phys'));
    done(h);
  }
  // 缪尔赛思 S1: ranged copies do not bind (S3 only)
  {
    const h = mlyssBattle('chess_char_6_11_a', 'skchr_mlyss_1', { copyId: 'chess_char_1_01_a', enemyAt: 0 });
    h.run(12);
    assert.equal(statuses(h, 'bind', (c) => c.source === h.unit('chess_char_6_11_a')).length, 0);
    done(h);
  }
});

// =================================================================================================================
// modules (elite): the non-default choices change what the kit does

const ELITE = (base) => `${base}_b`;

test('module 浊心斯卡蒂 新生代: 捕食习性 ATK +9 % / DEF +8 %, +3 SP when an operator deploys in her range; −30 flat damage for allies in range during her skill', () => {
  const id = ELITE('chess_char_6_04'), M = 'uniequip_003_skadi2';
  const mk = (moduleId, o = {}) => run({
    defs: { chess: { ally_a: plain('ally_a', { stats: { def: 0, maxHp: 1e6 } }) }, enemies: { hit: enemyRec({ key: 'hit', hp: 1e7, speed: 0, atk: 500, bat: 2 }) } },
    units: [{ chessId: id, row: 11, col: 4, moduleId, ...o }, { chessId: 'ally_a', row: 10, col: 5 }],
    enemies: o.enemies ?? [],
  });
  const y = mk(M), x = mk(null);
  y.step(); x.step();
  const uy = y.unit(id), ux = x.unit(id);
  approx(uy.skill.sp - ux.skill.sp, tal(id, MOD(M), 1).sp, '+3 SP (the ally deployed after her, in her range)');
  y.run(1);
  const pb = uy.findBuff('skadi2:predator');
  approx(pb.mods.atkPct, tal(id, MOD(M), 1)['skadi2_e_003_t_2[atk][1].atk']);
  approx(pb.mods.defPct, tal(id, MOD(M), 1)['skadi2_e_003_t_2[def].def']);
  done(y); done(x);

  for (const moduleId of [M, null]) {
    const h = mk(moduleId, { carryState: READY, enemies: [{ key: 'hit', pos: [10, 5], time: 0.5 }] });
    const u = h.unit(id), a = h.unit('ally_a');
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.ok(h.runUntil(() => h.hooksOf('damaged').some((c) => c.target === a && isKey(c.source, 'hit')), 5));
    const d = h.hooksOf('damaged').find((c) => c.target === a && isKey(c.source, 'hit'));
    approx(d.amount, moduleId ? 500 - 30 : 500, `module ${moduleId}: flat reduction`);
    done(h);
  }
});

test('module 异客 王权金币: bounces lose nothing and 机理分析 is ×1.28 from 70 % HP; 特限证章 keeps the 15 % falloff', () => {
  const id = ELITE('chess_char_6_05');
  for (const [moduleId, fall] of [['uniequip_003_pasngr', 0], ['uniequip_004_pasngr', 0.15], ['none', 0.15], [null, 0.1]]) {
    const h = run({
      defs: { enemies: { e: dummy('e') } },
      units: [{ chessId: id, row: 10, col: 4, moduleId, carryState: IDLE }],
      enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }, { key: 'e', pos: [11, 7] }, { key: 'e', pos: [11, 8] }],
    });
    const u = h.unit(id);
    h.run(4);
    const hits = dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSkill && c.t > 1); // (孤卒's aura settled)
    const one = hits.filter((c) => c.dmg.attackId === hits[0].dmg.attackId);
    assert.equal(one.length, 4);
    for (let k = 1; k < 4; k++) approx(one[k].amount / one[0].amount, Math.pow(1 - fall, k), `module ${moduleId} bounce ${k}`);
    const t0 = tal(id, MOD(moduleId));
    approx(one[0].amount, u.s.atk * t0['pasngr_t_1[enhance].damage_scale'], `module ${moduleId}: 机理分析`);
    done(h);
  }
  approx(tal(id, MOD('uniequip_003_pasngr')).hp_ratio, 0.7);
});

test('module 佩佩 特限证章: no ×1.15 when 3 enemies stand in the splash (晴雨 only)', () => {
  const id = ELITE('chess_char_6_06');
  for (const [moduleId, mul] of [[null, tbOf(id).atk_scale_e], ['uniequip_003_pepe', 1], ['none', 1]]) {
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, moduleId, carryState: IDLE }], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 5] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash).length > 0, 5));
    approx(dealt(h, u, (c) => c.dmg.isAttack && !c.dmg.isSplash)[0].amount, u.s.atk * mul, `module ${moduleId}`);
    done(h);
  }
});

test('module 维娜 秩序圣“球”: 战栗 6 s (elite / leader 12 s), ×1.15 on 战栗 targets, 10 % 脆弱 on enemies she blocks', () => {
  const id = ELITE('chess_char_6_07'), M = 'uniequip_003_siege2';
  const h = run({
    defs: { enemies: { n: dummy('n'), el: dummy('el', { rank: 'ELITE' }) } },
    units: [{ chessId: id, row: 10, col: 4, moduleId: M, carryState: IDLE }], enemies: [{ key: 'el', pos: [10, 5] }, { key: 'n', pos: [10, 4], time: 2 }],
  });
  const u = h.unit(id);
  h.run(4);
  const tr = statuses(h, 'tremble', (c) => c.source === u);
  const t1 = tal(id, MOD(M), 1);
  approx(tr.find((c) => isKey(c.target, 'n')).duration, t1.not_combat_normal, 'normal enemy');
  approx(tr.find((c) => isKey(c.target, 'el')).duration, t1.not_combat_elite, 'elite enemy');
  const n = enemyOf(h, 'n');
  assert.ok(statuses(h, 'fragile', (c) => c.target === n && c.source === u && Math.abs(c.value - (tbOf(id, MOD(M)).damage_scale - 1)) < 1e-9).length > 0, 'blocked ⇒ 脆弱');
  const onEl = dealt(h, u, (c) => c.dmg.isAttack && isKey(c.target, 'el') && c.t < 2);
  assert.ok(onEl.length >= 2);
  approx(onEl[1].amount / onEl[0].amount, ds.getChess(id, MOD(M)).talents.find((t) => t.bb.damage_scale && !t.name)?.bb.damage_scale ?? 1.15, '×1.15 once trembling', 1e-3);
  done(h);
  // the default module: 4 s everywhere, no ×1.15
  const d = run({ defs: { enemies: { el: dummy('el', { rank: 'ELITE' }) } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE }], enemies: [{ key: 'el', pos: [10, 5] }] });
  const du = d.unit(id);
  d.run(4);
  approx(statuses(d, 'tremble', (c) => c.source === du)[0].duration, tal(id, null, 1).not_combat);
  const de = dealt(d, du, (c) => c.dmg.isAttack);
  approx(de[1].amount / de[0].amount, 1, 'no bonus', 1e-3);
  done(d);
});

test('module 焰影苇草 “独属自己的一隅”: damage ×1.1 while an operator of her range is injured; 灼痕 40 % / 8 s (full potential)', () => {
  const id = ELITE('chess_char_6_08'), M = 'uniequip_003_reed2';
  const h = run({ defs: { chess: { a: plain('a') }, enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, moduleId: M, carryState: IDLE }, { chessId: 'a', row: 11, col: 5 }], enemies: [{ key: 'e', pos: [10, 6] }] });
  const u = h.unit(id), a = h.unit('a');
  h.run(0.5);
  assert.ok(!u.findBuff('reed2:corner'), 'nobody injured');
  a.hp = a.s.maxHp * 0.5;
  h.run(0.5);
  approx(u.findBuff('reed2:corner')?.mods.dmgDealtMul ?? 1, 1.1, 'injured ally ⇒ ×1.1');
  approx(tal(id, MOD(M)).damage_scale, 1.4);   // 1.38 + the potential step
  done(h);
  const d = run({ defs: { chess: { a: plain('a') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE }, { chessId: 'a', row: 11, col: 5 }] });
  d.step();
  d.unit('a').hp = 1;
  d.run(0.5);
  assert.ok(!d.unit(id).findBuff('reed2:corner'), 'default module: no bonus');
  done(d);
});

test('module 塑心 音乐家的旅程: 精神逆构 field-wide ×1.2 and 150 元素伤害/s during 凋亡 bursts; 10 % 元素脆弱 in her range', () => {
  const id = ELITE('chess_char_6_09'), M = 'uniequip_003_cello';
  for (const moduleId of [M, null]) {
    const h = run({ defs: { enemies: { far: dummy('far'), near: dummy('near') } }, units: [{ chessId: id, row: 10, col: 4, moduleId, carryState: IDLE }], enemies: [{ key: 'far', pos: [12, 16] }, { key: 'near', pos: [10, 5] }] });
    const u = h.unit(id);
    h.run(0.5);
    const far = enemyOf(h, 'far');
    h.b.dealDamage(null, far, { type: 'element', element: 'apoptosis', amount: 100 });
    const fill = h.hooksOf('elementHit').filter((c) => c.target === far).pop();
    approx(fill.dmg.mul, moduleId ? tal(id, MOD(M), 1).ep_damage_scale : 1, `module ${moduleId}: far enemy`);
    if (moduleId) {
      assert.ok(statuses(h, 'elemFragile', (c) => isKey(c.target, 'near') && Math.abs(c.value - 0.1) < 1e-9).length > 0, '10 % 元素脆弱 in range');
      h.b.dealDamage(null, far, { type: 'element', element: 'apoptosis', amount: 5000 });
      assert.ok(far.findBuff('apoptosisBurst'));
      const t0 = h.b.time;
      h.run(2.05);
      const dot = dealt(h, u, (c) => c.target === far && c.type === 'elemental' && c.t > t0);
      assert.equal(dot.length, 2, 'every second');
      approx(dot[0].amount, tal(id, MOD(M), 1).damage_value, '150 per second');
    }
    done(h);
  }
});

test('module 缪尔赛思 落叶四季: copying a 莱茵生命 operator gives her 10 SP;援军 bonus ×1.65', () => {
  const id = ELITE('chess_char_6_11'), M = 'uniequip_003_mlyss';
  const sp = {};
  for (const moduleId of [M, 'none']) {
    const h = mlyssBattle(id, 'skchr_mlyss_3', { copyId: 'rh', chess: { rh: plain('rh', { charId: 'char_108_silent', profession: 'WARRIOR' }) }, unit: { moduleId, carryState: IDLE }, enemyAt: 60 });
    const u = h.unit(id);
    const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
    assert.ok(h.runUntil(() => tok()?.mem.mlyss, 10), 'copied');
    sp[moduleId] = u.skill.sp;
    if (moduleId === M) approx(u.profile.reinforceScale, 1.65);
    done(h);
  }
  approx(sp[M] - sp.none, 10, '+10 SP', 0.02);
});

test('module 迷迭香 特限证章: two hits (one aftershock) instead of three', () => {
  const id = ELITE('chess_char_6_12');
  for (const [moduleId, n] of [[null, 3], ['uniequip_003_rosmon', 2], ['none', 2]]) {
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, moduleId, carryState: IDLE }], enemies: [{ key: 'e', pos: [10, 7] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => h.hooksOf('attack').some((c) => c.attacker === u), 5));
    h.run(1.5);
    const e = enemyOf(h, 'e');
    const first = h.hooksOf('attack').find((c) => c.attacker === u).t;
    const hits = dealt(h, u, (c) => c.target === e && c.t < first + 1.4);
    assert.equal(hits.length, n, `module ${moduleId}`);
    done(h);
  }
});

test('module 流明 “幸运”: far heals are not reduced; 应急处理 heals 100 % with an 8 s cooldown (full potential)', () => {
  const id = ELITE('chess_char_6_14'), M = 'uniequip_003_lumen';
  for (const [moduleId, mul] of [[M, 1], [null, tbOf(id).heal_scale]]) {
    const h = run({ defs: { chess: { f: plain('f', { stats: { maxHp: 1e5 } }) } }, units: [{ chessId: id, row: 10, col: 3, moduleId, carryState: IDLE }, { chessId: 'f', row: 10, col: 6 }] });
    const u = h.unit(id), f = h.unit('f');
    h.step();
    f.hp = f.s.maxHp * 0.5;
    assert.ok(h.runUntil(() => heals(h, u, (c) => c.target === f).length > 0, 5));
    approx(heals(h, u, (c) => c.target === f)[0].amount, u.s.atk * mul, `module ${moduleId}: far heal`);
    done(h);
  }
  approx(tal(id, MOD(M), 1).heal_scale, 1);
  approx(tal(id, MOD(M), 1).duration, 8);   // 10 s − the potential step
});

test('module 仇白 欲雪时: the first hit on an enemy binds it 3 s; ASPD +12 with ≥2 enemies in range', () => {
  const id = ELITE('chess_char_6_15'), M = 'uniequip_003_qiubai';
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, moduleId: M, carryState: IDLE }], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }] });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => statuses(h, 'bind', (c) => c.source === u).length > 0, 5));
  approx(statuses(h, 'bind', (c) => c.source === u)[0].duration, tal(id, MOD(M), 1).duration_advanced, 'first hit ⇒ 3 s');
  h.run(0.5);
  approx(u.findBuff('qiubai:crowd').mods.aspd, tal(id, MOD(M)).attack_speed, 'ASPD +12');
  done(h);
  const d = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: IDLE }], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }] });
  d.run(1);
  assert.ok(!d.unit(id).findBuff('qiubai:crowd'), 'default module: no crowd ASPD');
  done(d);
});

test('module 耀骑士临光 “骑士家族”: the first knock-out of a deployment keeps her up (max HP −60 %, ASPD +30) and bursts 不畏苦暗 again', () => {
  const id = ELITE('chess_char_6_17'), M = 'uniequip_003_nearl2';
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, moduleId: M, carryState: IDLE }], enemies: [{ key: 'e', pos: [10, 5], time: 1 }] });
  const u = h.unit(id);
  h.run(1.5);
  const max0 = u.s.maxHp, as0 = u.s.aspd;
  const bursts0 = dealt(h, u, tagged('talent')).length;
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive, 'stays');
  approx(u.s.maxHp, max0 * (1 - tbOf(id, MOD(M)).value), 'max HP −60 %');
  approx(u.hp, u.s.maxHp, 'full (reduced) HP');
  approx(u.s.aspd, as0 + tbOf(id, MOD(M)).attack_speed, 'ASPD +30');
  assert.ok(dealt(h, u, tagged('talent')).length > bursts0, '不畏苦暗 again');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(!u.alive, 'only once per deployment');
  done(h);
  const d = run({ units: [{ chessId: id, row: 10, col: 4, carryState: IDLE }] });
  d.step();
  d.b.dealDamage(null, d.unit(id), { amount: 1e9, type: 'true' });
  assert.ok(!d.unit(id).alive, 'default module: knocked out');
});

test('module 锏 新合同: ATK +8 %, ignores 70 DEF, ground enemies entering her range tremble 6 s', () => {
  const id = ELITE('chess_char_6_19'), M = 'uniequip_003_blkkgt';
  const h = run({ defs: { enemies: { w: enemyRec({ key: 'w', hp: 1e7, speed: 1 }) } }, units: [{ chessId: id, row: 9, col: 5, moduleId: M, carryState: IDLE }], enemies: [{ key: 'w', route: 0 }] });
  const u = h.unit(id);
  h.step();
  const b = u.findBuff('blkkgt:contract');
  approx(b.mods.atkPct, tal(id, MOD(M), 1).atk);
  approx(b.mods.defIgnoreFlat, tbOf(id, MOD(M)).def_penetrate_fixed);
  const entry = (c) => c.source === u && Math.abs(c.duration - tal(id, MOD(M), 1).not_combat) < 1e-9;
  assert.ok(h.runUntil(() => statuses(h, 'tremble', entry).length > 0, 20), '6 s 战栗 on entering her range');
  done(h);
  const d = run({ units: [{ chessId: id, row: 9, col: 5, carryState: IDLE }] });
  d.step();
  assert.ok(!d.unit(id).findBuff('blkkgt:contract'), 'default module: none');
});

test('module 纯烬艾雅法拉 想要留下的生命: ASPD +8 while an ally of her range carries 元素损伤', () => {
  const id = ELITE('chess_char_6_20'), M = 'uniequip_003_agoat2';
  const h = run({ defs: { chess: { a: plain('a') } }, units: [{ chessId: id, row: 10, col: 3, moduleId: M, carryState: IDLE }, { chessId: 'a', row: 10, col: 5 }] });
  const u = h.unit(id), a = h.unit('a');
  h.run(0.5);
  assert.ok(!u.findBuff('agoat2:linger'));
  a.elem.burn = 300;
  h.run(0.3);
  approx(u.findBuff('agoat2:linger').mods.aspd, tbOf(id, MOD(M)).attack_speed, 'ASPD +8');
  done(h);
});

test('module none (elites whose only module is the default): the module-only parts are gone', () => {
  // 蕾缪安: 攻击的敌人未被击倒时额外获得1点技力 (trait) / 逃犯引渡手续 numbers
  const lem = ELITE('chess_char_6_01');
  for (const [moduleId, gain] of [[null, true], ['none', false]]) {
    const h = run({ hooks: [...HOOKS, 'spGain'], defs: { enemies: { e: dummy('e') } }, units: [{ chessId: lem, row: 10, col: 4, moduleId, carryState: IDLE }], enemies: [{ key: 'e', pos: [10, 6] }] });
    const u = h.unit(lem);
    h.run(6);
    assert.equal(h.hooksOf('attack').some((c) => c.attacker === u), true);
    assert.equal(h.hooksOf('spGain').some((c) => c.unit === u && c.reason === 'trait'), gain, `module ${moduleId}: trait SP`);
    done(h);
  }
  // 溯光星源: 数据建模 max stacks 25 + ATK at max (module) vs 18, no ATK
  const halo = ELITE('chess_char_6_16');
  assert.equal(tal(halo, MOD('none')).max_stack_cnt, 18);
  // 荒芜拉普兰德: initial drone scale 0.35 (module) vs 0.2
  const w = ELITE('chess_char_6_18');
  for (const [moduleId, init] of [[null, 0.35], ['none', 0.2]]) {
    const h = run({ units: [{ chessId: w, row: 10, col: 4, moduleId }] });
    h.step();
    approx(h.unit(w).profile.funnel.init, init, `module ${moduleId}`);
  }
  // 圣聆初雪: 范围内敌人越多造成的伤害越高 (module) — none: no bonus
  const sb = ELITE('chess_char_6_02');
  for (const [moduleId, on] of [[null, true], ['none', false]]) {
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: sb, row: 10, col: 4, moduleId }], enemies: [{ key: 'e', pos: [10, 5] }] });
    h.run(0.6);
    assert.equal(!!h.unit(sb).findBuff('sbell2:heart'), on, `module ${moduleId}`);
  }
});

test('module 缪尔赛思 落叶四季: enemies blocked by her 流形 are more likely attacked (token module part taunt_level +1)', () => {
  // regression: the trait "援军阻挡的敌人更容易受到我方的攻击" was left unmodelled although the 流形's 落叶四季 variant
  // carries the number (token talent taunt_level 1); 梳妆流形 / no module ⇒ nothing
  const id = ELITE('chess_char_6_11');
  for (const moduleId of ['uniequip_003_mlyss', 'uniequip_002_mlyss', 'none']) {
    const h = run({
      defs: {
        chess: { guard: plain('guard', { profession: 'WARRIOR', stats: { maxHp: 3000, atk: 800, def: 100, blockCnt: 2 } }) },
        enemies: { w: enemyRec({ key: 'w', hp: 1e7, speed: 1 }) },
      },
      units: [U(id, 'skchr_mlyss_3', 10, 3, { moduleId, carryState: IDLE }), { chessId: 'guard', row: 11, col: 5 }, { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 9, col: 6, ownerUid: 1 }],
      enemies: [{ key: 'w', route: 0, time: 12 }],
    });
    const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
    assert.ok(h.runUntil(() => tok()?.mem.mlyss, 12), 'copied');
    assert.ok(h.runUntil(() => h.enemies().some((e) => e.blockedBy === tok()), 30), `${moduleId}: blocked by the 流形`);
    h.run(0.5);
    const e = h.enemies().find((x) => x.blockedBy === tok());
    const want = moduleId === 'uniequip_003_mlyss' ? 1 : 0;
    assert.equal(e.s.taunt, want, `${moduleId}: blocked enemy taunt`);
    if (want) { // released: the mark fades once it is no longer blocked
      tok().hp = 0; h.b.kill(tok());
      h.run(1);
      assert.equal(e.s.taunt, 0, 'no longer blocked ⇒ no taunt');
    }
    done(h);
  }
});

test('6_02 圣聆初雪 S1: the charges are not dumped on an enemy far outside her range (SEARCH ⇒ enemy in range)', () => {
  // regression: the data trigger SEARCH (engine: any enemy on the field) fired both charges the tick an enemy spawned at
  // the gate 7 tiles away — "立即对范围内所有敌人…" hit nothing
  for (const id of both('chess_char_6_02')) {
    const sid = 'skchr_sbell2_1';
    const h = run({ defs: { enemies: { w: enemyRec({ key: 'w', hp: 1e7, speed: 0.6 }) } }, units: [U(id, sid, 10, 3, { carryState: READY })], enemies: [{ key: 'w', route: 0, time: 1 }] });
    const u = h.unit(id);
    usesSkill(u, sid);
    h.run(4);
    assert.equal(started(h, u).length, 0, `${id}: no cast while the enemy is far away`);
    assert.equal(u.skill.charges, u.skill.maxCharges, 'charges kept');
    assert.ok(h.runUntil(() => started(h, u).length > 0, 40), 'casts once it walks into range');
    const t0 = started(h, u)[0].t;
    assert.ok(dealt(h, u, (c) => c.t === t0 && c.dmg.isSkill && c.type === 'arts').length >= 1, 'the burst hits it');
    done(h);
  }
});
