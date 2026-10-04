// Tier-3 operator loadouts (DESIGN §16, server/sim/content/kits/tier3.js): every selectable NON-default skill of every
// visible tier-3 chess is hand-authored (`skills[skillId]`) and proves its signature effect for the normal (Lv4) and the
// elite (Lv7) chess with its own blackboard; non-default modules that change behaviour are exercised too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { skillSpecSource } from '../../server/sim/content/index.js';
import { effectiveProfile } from '../../server/sim/ai.js';
import { kitCoverage } from '../../tools/kit-coverage.mjs';
import KITS from '../../server/sim/content/kits/tier3.js';

const ds = getDefaultSource();
/** Skill index of `skillId` on chess `id`. */
const IDX = (id, skillId) => ds.rawChess(id).skills.find((s) => s.skillId === skillId).index;
/** Def of chess `id` with skill `skillId` selected (and module `moduleId`). */
const LD = (id, skillId, moduleId) => ds.getChess(id, { skillIndex: IDX(id, skillId), ...(moduleId ? { moduleId } : {}) });
const SB = (id, skillId) => LD(id, skillId).skill.bb;
const TB = (id, i) => ds.getChess(id).talents[i].bb;
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, def: 0, res: 0, ...o });
const fill = (u) => u.skill.gainSp(u.skill.spCost * u.skill.maxCharges + 1, 'test');
const tagged = (h, tag, src = null) => h.hooksOf('damaged').filter((c) => c.dmg?.tags?.includes(tag) && (!src || c.source === src));
const done = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []); checkInvariants(h.b); };
/** Chess record without its 特质 (garrisons re-type damage; they have their own tests). */
const noGarrison = (...ids) => Object.fromEntries(ids.map((id) => [id, { ...ds.rawChess(id), garrisonIds: [] }]));
const BOTH = (base) => [base, base.replace(/_a$/, '_b')];
/** A unit entry with a loadout. */
const U = (chessId, skillId, row, col, extra = {}) => ({ chessId, row, col, skillIndex: IDX(chessId, skillId), ...extra });
/** Damage instances of the unit's normal/skill attacks. */
const atkHits = (h, u, skill = null) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && (skill == null || !!c.dmg.isSkill === skill));

// ---------------------------------------------------------------------------------------------------------------

test('coverage: every selectable skill of every visible tier-3 chess is hand-authored (normal + 精锐)', () => {
  const rep = kitCoverage({ tier: 3 });
  assert.equal(rep.summary.chess, 19);
  assert.equal(rep.summary.covered, rep.summary.skills, rep.chess.filter((r) => r.skills.some((s) => !s.covered)).map((r) => r.name).join(' '));
  for (const r of rep.chess) for (const s of r.skills) if (!s.isDefault) assert.deepEqual([s.normal, s.elite], ['skills', 'skills'], `${r.name} S${s.index + 1}`);
});

test('skills map: each alternate spec is built from its OWN record whichever skill is selected', () => {
  const rows = kitCoverage({ tier: 3 }).chess;
  for (const r of rows) for (const id of BOTH(r.chessId)) {
    const d0 = ds.getChess(id);
    const kit = KITS[r.chessId](d0.skill.bb, d0.raw, d0);
    const alts = r.skills.filter((s) => !s.isDefault).map((s) => s.skillId);
    assert.deepEqual(Object.keys(kit.skills ?? {}).sort(), alts.slice().sort(), `${id} skills keys`);
    for (const sid of alts) {
      const dS = LD(id, sid);
      assert.equal(skillSpecSource(dS, KITS), 'skills', `${id} ${sid}`);
      const own = KITS[r.chessId](dS.skill.bb, dS.raw, dS).skills[sid];
      // same numbers from the default-selected kit and from the kit built for that skill
      assert.equal(JSON.stringify(kit.skills[sid], (k, v) => (typeof v === 'function' ? 'fn' : v)), JSON.stringify(own, (k, v) => (typeof v === 'function' ? 'fn' : v)), `${id} ${sid}`);
    }
  }
  const a = LD('chess_char_3_01_a', 'skchr_angel_1'), b = LD('chess_char_3_01_b', 'skchr_angel_1');
  const d0 = ds.getChess('chess_char_3_01_b');
  approx(KITS.chess_char_3_01_a(d0.skill.bb, d0.raw, d0).skills.skchr_angel_1.attack.atkScale, b.skill.bb.atk_scale, 1e-9, 'elite Lv7 number');
  assert.notEqual(a.skill.bb.atk_scale, b.skill.bb.atk_scale);
});

test('every alternate skill × module of the visible tier-3 chess fights and casts in a real battle without content errors', () => {
  const rows = kitCoverage({ tier: 3 }).chess;
  for (const r of rows) {
    const raw = ds.rawChess(r.chessId.replace(/_a$/, '_b'));
    const mods = [null, 'none', ...(raw.modules || []).map((m) => m.uniEquipId)];
    for (const s of r.skills) for (const id of BOTH(r.chessId)) for (const moduleId of id.endsWith('_b') ? mods : [null]) {
      if (s.isDefault && moduleId == null) continue; // default kit: kits_t3 smoke test
      const melee = ds.getChess(id).position === 'MELEE';
      const h = makeBattle({
        defs: { enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 2e4, speed: 1, def: 100, res: 10, atk: 200, bat: 1.5 }), enemy_fl: enemyRec({ key: 'enemy_fl', hp: 5000, speed: 1, motion: 'FLY', atk: 50 }) } },
        timeLimit: 25, seed: 11, autoFinish: false,
        units: [{ chessId: id, row: melee ? 9 : 10, col: 6, skillIndex: s.index, ...(moduleId ? { moduleId } : {}) }, { chessId: 'chess_char_3_16_a', row: 9, col: 7 }],
        enemies: [{ key: 'enemy_w', route: 0, count: 4, interval: 3 }, { key: 'enemy_fl', route: 2, time: 2 }],
      });
      const u = h.unit(id);
      const tag = `${id} S${s.index + 1} ${moduleId ?? ''}`;
      assert.equal(u.skill.id, s.skillId, tag);
      for (let t = 0; t < 20; t++) { h.run(1); if (t % 5 === 1 && u.alive && u.skill.kind !== 'passive') u.skill.gainSp(u.skill.spCost, 'test'); }
      if (u.skill.kind === 'passive') assert.ok(u.skill.active, `${tag} passive on`);
      else assert.ok(u.skill.activations >= 1, `${tag} cast`);
      assert.ok(u.stats.dmg > 0 || u.stats.heal > 0, `${tag} did something`);
      done(h);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------

test('3_01 能天使 S1 冲锋模式: next attack = times shots × atk_scale; S2 扫射模式: 4 shots × attack@atk_scale every attack', () => {
  for (const id of BOTH('chess_char_3_01_a')) {
    const b1 = SB(id, 'skchr_angel_1');
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['damaged', 'attack'], captureNoisy: true,
      units: [U(id, 'skchr_angel_1', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 6] }] });
    const u = h.unit(id);
    assert.equal(u.skill.kind, 'instant');
    assert.equal(u.skill.spType, 'attack');
    assert.ok(h.runUntil(() => u.skill.activations === 1, 30), 'cast after spCost attacks');
    h.run(1);
    const sk = atkHits(h, u, true);
    assert.equal(sk.length, b1.times, 'one 3-shot burst');
    for (const c of sk) approx(c.amount, u.s.atk * b1.atk_scale);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length, 1);
    assert.ok(atkHits(h, u, false).every((c) => Math.abs(c.amount - u.s.atk) < 1e-6), 'normal attacks one plain shot');
    done(h);

    const b2 = SB(id, 'skchr_angel_2');
    const g = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['damaged', 'attack'], captureNoisy: true,
      units: [U(id, 'skchr_angel_2', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 6] }] });
    const v = g.unit(id);
    g.step();
    fill(v);
    assert.ok(g.runUntil(() => v.skill.active, 5));
    assert.equal(effectiveProfile(v).hits, b2['attack@times']);
    approx(v.skill.timeLeft, LD(id, 'skchr_angel_2').skill.duration, 0.05);
    g.runUntil(() => !v.skill.active, 20);
    g.run(1);
    const atks = g.hooksOf('attack').filter((c) => c.attacker === v && c.isSkill).length;
    const hits = atkHits(g, v, true);
    assert.ok(atks >= 5);
    assert.equal(hits.length, atks * b2['attack@times']);
    for (const c of hits) approx(c.amount, v.s.atk * b2['attack@atk_scale']);
    done(g);
  }
});

test('3_01 能天使 精锐 module MAR-Y: ASPD + only while a ground enemy is in range (no fly bonus); MAR-X keeps the fly ×', () => {
  const id = 'chess_char_3_01_b';
  const tb = ds.getChess(id, { moduleId: 'uniequip_003_angel' }).traitBb;
  const h = makeBattle({ defs: { enemies: { enemy_g: dummy('enemy_g'), enemy_f: dummy('enemy_f', { motion: 'FLY' }) } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4, moduleId: 'uniequip_003_angel' }], enemies: [{ key: 'enemy_f', pos: [10, 6] }, { key: 'enemy_g', pos: [10, 7], time: 3 }] });
  const u = h.unit(id);
  h.run(2);
  const base = u.s.aspd;
  assert.equal(u.findBuff('trait:angel_ground'), null, 'only a flyer in range');
  const fl = atkHits(h, u, false).find((c) => c.target.defId === 'enemy_f');
  approx(fl.amount, u.s.atk, 1e-6, 'MAR-Y: no fly bonus');
  h.run(2);
  assert.ok(u.findBuff('trait:angel_ground'));
  approx(u.s.aspd, base + tb.attack_speed);
  done(h);
  const x = makeBattle({ defs: { enemies: { enemy_f: dummy('enemy_f', { motion: 'FLY' }) } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_f', pos: [10, 6] }] });
  const w = x.unit(id);
  x.run(2);
  approx(atkHits(x, w, false)[0].amount, w.s.atk * ds.getChess(id).traitBb.atk_scale, 1e-6, 'default MAR-X fly ×');
  assert.equal(w.findBuff('trait:angel_ground'), null);
  done(x);
});

test('3_02 断崖 S1 多导向散射弹丸: next attack hits max_target enemies (arts, lord ranged ×) and makes them 停顿', () => {
  for (const id of BOTH('chess_char_3_02_a')) {
    const b = SB(id, 'skchr_ayer_1');
    const rs = ds.getChess(id).traitBb.atk_scale ?? 0.8;
    const h = makeBattle({ defs: { enemies: { enemy_e1: dummy('enemy_e1'), enemy_e2: dummy('enemy_e2'), enemy_e3: dummy('enemy_e3'), enemy_e4: dummy('enemy_e4') } }, timeLimit: 60, hooks: ['damaged', 'attack'], captureNoisy: true,
      units: [U(id, 'skchr_ayer_1', 10, 4)], enemies: [{ key: 'enemy_e1', pos: [10, 5] }, { key: 'enemy_e2', pos: [9, 5] }, { key: 'enemy_e3', pos: [11, 5] }, { key: 'enemy_e4', pos: [10, 6] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 40));
    h.run(0.5);
    const atk = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
    assert.equal(atk.targets.length, b.max_target);
    const sk = atkHits(h, u, true);
    assert.equal(sk.length, b.max_target);
    for (const c of sk) {
      assert.equal(c.type, 'arts');
      approx(c.amount, u.s.atk * b.atk_scale * (Math.round(c.target.y) === 10 && Math.round(c.target.x) === 5 ? 1 : rs));
    }
    assert.ok(atk.targets.every((t) => t.findBuff('sluggish')), '停顿 on every target');
    assert.ok(!h.b.enemies.filter((e) => !atk.targets.includes(e)).some((e) => e.findBuff('sluggish')), 'only on them');
    done(h);
  }
});

test('3_03 诗怀雅 S1 指挥调度: the talent covers the skill range (x-1 / x-2) at ×talent_scale while it runs', () => {
  for (const id of BOTH('chess_char_3_03_a')) {
    const b = SB(id, 'skchr_swire_1'), t0 = TB(id, 0);
    const elite = id.endsWith('_b');
    // (10,6) = 2 tiles ahead (x-1 and x-2); (11,6) = [1,2] only in the elite's x-2
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60,
      units: [U(id, 'skchr_swire_1', 10, 4), { chessId: 'chess_char_3_16_a', row: 10, col: 6 }, { chessId: 'chess_char_3_02_a', row: 11, col: 6 }, { chessId: 'chess_char_3_18_a', row: 11, col: 4 }],
      enemies: [{ key: 'enemy_d', pos: [10, 5] }] });
    const u = h.unit(id), far = h.unit('chess_char_3_16_a'), diag = h.unit('chess_char_3_02_a'), near = h.unit('chess_char_3_18_a');
    h.run(0.5);
    approx(near.s.atk, near.base.atk * (1 + t0.atk), 1e-6, '3×3 as usual');
    approx(far.s.atk, far.base.atk, 1e-6, 'outside the talent range');
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.step();
    approx(u.s.atk, u.base.atk * (1 + t0.atk * b.talent_scale), 1e-6, 'no ATK of its own');
    approx(near.s.atk, near.base.atk * (1 + t0.atk * b.talent_scale));
    approx(far.s.atk, far.base.atk * (1 + t0.atk * b.talent_scale), 1e-6, 'range enlarged');
    approx(diag.s.atk, diag.base.atk * (elite ? 1 + t0.atk * b.talent_scale : 1), 1e-6, elite ? '大幅度扩大' : 'x-1 only');
    h.runUntil(() => !u.skill.active, 40);
    h.run(0.5);
    approx(far.s.atk, far.base.atk);
    approx(near.s.atk, near.base.atk * (1 + t0.atk));
    done(h);
  }
});

test('3_04 琳琅诗怀雅 S1 仗义疏财: 2 coins; an attack spends one to heal the most injured ally (< 70 %) around her; no bombs', () => {
  for (const id of BOTH('chess_char_3_04_a')) {
    const b = SB(id, 'skchr_swire2_1'), t0 = TB(id, 0);
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['heal', 'deploy'], captureNoisy: true, flags: { dpInit: 60, dpMax: 99 },
      units: [U(id, 'skchr_swire2_1', 9, 5), { chessId: 'chess_char_3_16_a', row: 10, col: 5 }, { chessId: 'chess_char_3_05_a', row: 9, col: 3 }],
      enemies: [{ key: 'enemy_d', pos: [9, 6] }] });
    const u = h.unit(id), ally = h.unit('chess_char_3_16_a'), far = h.unit('chess_char_3_05_a');
    h.step();
    assert.equal(u.skill.kind, 'passive');
    assert.equal(u.mem.coins, t0.sp, '开启技能 coin at deployment');
    far.hp = far.s.maxHp * 0.3; // two tiles away: not "周围八格"
    ally.hp = ally.s.maxHp * 0.75; // not below 70 %: no heal, the coin is kept
    h.run(2.5);
    assert.equal(h.hooksOf('heal').filter((c) => c.source === u).length, 0);
    assert.equal(u.mem.coins, t0.sp);
    ally.hp = ally.s.maxHp * 0.5;
    assert.ok(h.runUntil(() => h.hooksOf('heal').some((c) => c.source === u), 5));
    const heal = h.hooksOf('heal').find((c) => c.source === u);
    assert.equal(heal.target, ally);
    approx(heal.amount, u.s.atk * b['attack@heal_scale']);
    h.run(30);
    assert.ok(u.mem.coins <= b.sp, 'cap 2');
    assert.ok(!h.hooksOf('deploy').some((c) => c.unit.defId === 'token_10031_swire2_gdtrap'), 'no 香槟炸弹 with S1');
    done(h);
  }
});

// Owner's decision 2026-10-04 (community report #5 「琳琅诗怀雅1技能不会主动奶身边受伤的干员」), a deliberate deviation from the official
// 「下一次攻击会为…」: S1 heals an injured ally beside her without an attack or an enemy — at most once per attack cycle
// (her attack interval, ASPD included) [ASSUMED cadence]; with an enemy the heal stays on her attack.
test('3_04 琳琅诗怀雅 S1 仗义疏财 (owner\'s decision): an injured ally beside her is healed with no enemy on the field, once per attack cycle; with an enemy, once per attack', () => {
  const id = 'chess_char_3_04_a';
  const b = SB(id, 'skchr_swire2_1');
  const mk = (enemies = []) => makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, autoFinish: false, hooks: ['heal', 'attack'], captureNoisy: true,
    units: [U(id, 'skchr_swire2_1', 9, 5), { chessId: 'chess_char_3_16_a', row: 10, col: 5 }], enemies });
  // no enemy: an ally at 80 % is left alone, one at 50 % is healed and a coin is spent
  let h = mk();
  let u = h.unit(id), ally = h.unit('chess_char_3_16_a');
  h.step();
  u.mem.coins = 2;
  ally.hp = ally.s.maxHp * 0.8;
  h.run(3);
  assert.equal(h.hooksOf('heal').filter((c) => c.source === u).length, 0, '80 %: not below 70 %');
  assert.equal(u.mem.coins, 2, 'the coin is kept');
  ally.hp = ally.s.maxHp * 0.5;
  h.step();
  const heals = h.hooksOf('heal').filter((c) => c.source === u);
  assert.equal(heals.length, 1, 'healed at once, no enemy needed');
  assert.equal(heals[0].target, ally);
  approx(heals[0].amount, u.s.atk * b['attack@heal_scale']);
  assert.equal(u.mem.coins, 1, 'one coin spent');
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u).length, 0, 'without an attack');
  // kept injured with coins to spare: one heal per attack interval, never more
  const n0 = h.hooksOf('heal').length, t0 = h.b.time;
  for (let i = 0; i < 300; i++) { ally.hp = ally.s.maxHp * 0.3; u.mem.coins = 2; h.step(); }
  const per = h.hooksOf('heal').slice(n0).filter((c) => c.source === u).length;
  assert.equal(per, Math.floor((h.b.time - t0) / u.s.interval + 1e-6), `one heal per ${u.s.interval} s`);
  done(h);
  // with an enemy in her range: the heal rides on each attack, never a second one in the cycle
  h = mk([{ key: 'enemy_d', pos: [9, 6] }]);
  u = h.unit(id); ally = h.unit('chess_char_3_16_a');
  h.step();
  const a0 = h.hooksOf('attack').length, h0 = h.hooksOf('heal').length;   // (its first attack, at deployment, found the ally unhurt)
  for (let i = 0; i < 300; i++) { ally.hp = ally.s.maxHp * 0.3; u.mem.coins = 2; h.step(); }
  const atk = h.hooksOf('attack').slice(a0).filter((c) => c.attacker === u).length;
  const hl = h.hooksOf('heal').slice(h0).filter((c) => c.source === u).length;
  assert.ok(atk >= 5, `attacks (${atk})`);
  assert.equal(hl, atk, 'one heal per attack');
  done(h);
});

test('3_04 琳琅诗怀雅 S3 千金一掷: 二连击, kills pay a coin, a full purse is cashed out on the front range (hits + push)', () => {
  for (const id of BOTH('chess_char_3_04_a')) {
    const b = SB(id, 'skchr_swire2_3'), t0 = TB(id, 0);
    const h = makeBattle({ defs: { enemies: { enemy_heavy: dummy('enemy_heavy', { mass: 9 }), enemy_weak: dummy('enemy_weak', { hp: 1 }) } }, timeLimit: 90, hooks: ['damaged', 'attack', 'deploy'], captureNoisy: true, flags: { dpInit: 60, dpMax: 99 },
      units: [U(id, 'skchr_swire2_3', 9, 5)], enemies: [{ key: 'enemy_heavy', pos: [9, 6] }] });
    const u = h.unit(id);
    assert.equal(u.skill.kind, 'toggle');
    h.step();
    assert.equal(u.mem.coins ?? 0, 0, 'no coin before the cast');
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    assert.equal(u.mem.coins, t0.sp, '开启技能 coin');
    h.run(2);
    const atk = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
    assert.equal(atkHits(h, u, true).filter((c) => c.dmg.attackId === atkHits(h, u, true)[0].dmg.attackId).length, 2, '二连击');
    assert.ok(atk);
    const c0 = u.mem.coins;
    h.spawn('enemy_weak', { pos: [9, 5] });
    assert.ok(h.runUntil(() => u.mem.coins === c0 + 1, 3), 'a kill pays a coin');
    assert.ok(u.skill.active, 'still on');
    u.mem.coins = b.sp; // full purse (10)
    h.step();
    assert.equal(u.skill.active, false, 'closed once full');
    const cash = tagged(h, 'swire2Cash', u);
    assert.equal(cash.length, b.sp, 'one hit per coin');
    for (const c of cash) approx(c.amount, u.s.atk * b.atk_scale);
    assert.equal(u.mem.coins, 0);
    assert.equal(u.skill.activations, 1);
    assert.ok(h.runUntil(() => u.skill.activations === 2, 10), 'recast once SP is full again');
    assert.equal(u.mem.coins, t0.sp);
    assert.ok(!h.hooksOf('deploy').some((c) => c.unit.defId === 'token_10031_swire2_gdtrap'), 'no bombs');
    done(h);
  }
  // the push: a light enemy is shoved forward (and out of the range: the remaining coins are spent on nobody)
  const id = 'chess_char_3_04_a';
  const g = makeBattle({ defs: { enemies: { enemy_light: dummy('enemy_light') } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true, flags: { dpInit: 60, dpMax: 99 },
    units: [U(id, 'skchr_swire2_3', 9, 5)], enemies: [{ key: 'enemy_light', pos: [9, 6] }] });
  const v = g.unit(id);
  g.step();
  fill(v);
  assert.ok(g.runUntil(() => v.skill.active, 5));
  const e = g.enemy('enemy_light');
  const x0 = e.x;
  v.mem.coins = SB(id, 'skchr_swire2_3').sp;
  g.step();
  assert.ok(e.x > x0 + 0.3, 'pushed forward');
  assert.ok(tagged(g, 'swire2Cash', v).length >= 1);
  done(g);
});

test('3_04 琳琅诗怀雅 精锐 module MER-Y: ATK +4 % per trait payment (≤ 5 stacks) on top of 大买家; pays 3 DP', () => {
  const id = 'chess_char_3_04_b', mod = 'uniequip_003_swire2';
  const d = ds.getChess(id, { moduleId: mod });
  const mt = d.raw.talents.find((t) => t.hidden && t.fromModule).bb;
  const t0 = TB(id, 0);
  const h = makeBattle({ timeLimit: 60, flags: { dpInit: 90, dpMax: 99, dpPerSec: 0 },
    units: [{ chessId: id, row: 9, col: 5, moduleId: mod }] });
  const u = h.unit(id);
  const p = h.b.getPlayer('p1');
  h.step();
  const dp0 = p.dp;
  h.run(3.05);
  approx(dp0 - p.dp, Math.abs(d.traitBb.cost), 1e-6, 'MER-Y drain');
  assert.equal(u.findBuff('trait:swire2_module')?.stacks, 1);
  h.run(30);
  assert.equal(u.findBuff('trait:swire2_module')?.stacks, mt.max_stack_cnt);
  const buyer = u.findBuff('talent:swire2_buyer')?.stacks ?? 0;
  approx(u.s.atk, u.base.atk * (1 + mt.atk * mt.max_stack_cnt + t0.atk * buyer));
  done(h);
  // the default module MER-X has no such stack
  const g = makeBattle({ timeLimit: 20, flags: { dpInit: 90, dpMax: 99 }, units: [{ chessId: id, row: 9, col: 5 }] });
  g.run(10);
  assert.equal(g.unit(id).findBuff('trait:swire2_module'), null);
  done(g);
});

test('3_05 斯卡蒂 S1 迅捷打击·γ型 ATK/ASPD; S2 跃浪击 ATK + for `duration` s after deployment; 精锐 DRE-X ×vs blocked', () => {
  for (const id of BOTH('chess_char_3_05_a')) {
    const b1 = SB(id, 'skcom_quickattack[3]');
    const own = TB(id, 0).atk; // 深海掠食者: she is an Abyssal Hunter herself
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60,
      units: [U(id, 'skcom_quickattack[3]', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 5] }] });
    const u = h.unit(id);
    h.step();
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.step();
    approx(u.s.aspd, u.base.aspd + b1.attack_speed);
    approx(u.s.atk, u.base.atk * (1 + b1.atk + own));
    h.runUntil(() => !u.skill.active, 40);
    h.step();
    approx(u.s.aspd, u.base.aspd);
    done(h);

    const b2 = SB(id, 'skchr_skadi_2');
    const g = makeBattle({ timeLimit: 60, units: [U(id, 'skchr_skadi_2', 10, 4)] });
    const v = g.unit(id);
    g.step();
    assert.equal(v.skill.kind, 'passive');
    approx(v.s.atk, v.base.atk * (1 + b2.atk + own));
    g.run(b2.duration - 0.5);
    approx(v.s.atk, v.base.atk * (1 + b2.atk + own));
    g.run(1);
    approx(v.s.atk, v.base.atk * (1 + own), 1e-6, 'gone after its duration');
    // redeployed ⇒ again
    g.b.dealDamage(null, v, { type: 'true', amount: 1e7 });
    if (!v.alive) {
      g.b.redeploy(v, { free: true });
      g.step();
      approx(v.s.atk, v.base.atk * (1 + b2.atk + own), 1e-6, 'every deployment');
    }
    done(g);
  }
  // DRE-X: ×atk_scale on blocked enemies; no DRE-Y revive
  const id = 'chess_char_3_05_b', mod = 'uniequip_003_skadi';
  const tb = ds.getChess(id, { moduleId: mod }).traitBb;
  const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') }, chess: noGarrison(id) }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4, moduleId: mod }], enemies: [{ key: 'enemy_d', pos: [10, 4] }] });
  const u = h.unit(id);
  h.run(3);
  assert.equal(h.enemy('enemy_d').blockedBy, u);
  approx(atkHits(h, u, false)[0].amount, u.s.atk * tb.atk_scale, 1e-6, 'DRE-X ×');
  h.b.dealDamage(null, u, { type: 'true', amount: 1e7 });
  assert.equal(u.alive, false, 'no DRE-Y revive with DRE-X');
  done(h);
});

test('3_06 菲莱 S1 灵河护佑 (TAKE_DAMAGE): HP +, clears her element gauges, 损伤屏障 absorbs element damage; no S2 counters', () => {
  for (const id of BOTH('chess_char_3_06_a')) {
    const b = SB(id, 'skchr_philae_1'), t0 = TB(id, 0);
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d', { atk: 50 }) } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [U(id, 'skchr_philae_1', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 4] }] });
    const u = h.unit(id);
    assert.equal(u.skill.rule, 'TAKE_DAMAGE');
    h.step();
    const e = h.enemy('enemy_d');
    u.elem.burn = 300;
    fill(u);
    assert.equal(u.skill.active, false, 'waits for a hit');
    h.b.dealDamage(e, u, { type: 'phys', amount: 10 });
    assert.equal(u.skill.active, true);
    approx(u.s.maxHp, u.base.maxHp * (1 + b.max_hp));
    assert.equal(u.elem.burn, 0, 'element cleared');
    approx(u.mem.philaeBarrier, b.shield_value);
    const mul = 1 - t0.damage_resistance; // 神河谕使
    const a1 = (b.shield_value / mul) * 0.5;
    h.b.dealDamage(e, u, { type: 'element', element: 'burn', amount: a1 });
    assert.equal(u.elem.burn, 0, 'absorbed');
    approx(u.mem.philaeBarrier, b.shield_value * 0.5);
    h.b.dealDamage(e, u, { type: 'element', element: 'burn', amount: a1 * 2 });
    approx(u.elem.burn, b.shield_value * 0.5, 1e-6, 'the rest goes through');
    assert.equal(u.mem.philaeBarrier, 0);
    h.run(3);
    assert.equal(tagged(h, 'counter', u).length, 0, 'no 冥河诅咒 counter');
    assert.ok(atkHits(h, u).length > 0, 'keeps attacking');
    h.runUntil(() => !u.skill.active, 20);
    h.b.dealDamage(e, u, { type: 'element', element: 'burn', amount: 100 });
    approx(u.elem.burn, b.shield_value * 0.5 + 100 * mul, 1e-6, 'no barrier after the skill');
    done(h);
  }
});

test('3_08 薄绿 S1 风语 (阵法术师 技能1: "初始攻击范围内出现敌人后自动释放"): wider range, attacks at attack@atk_scale; guard/taunt rules kept', () => {
  for (const id of BOTH('chess_char_3_08_a')) {
    const b = SB(id, 'skchr_mint_1'), t0 = TB(id, 0);
    assert.equal(LD(id, 'skchr_mint_1').skill.trigger?.rule, 'SEARCH', 'data: the phalanx S1 row');
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d'), enemy_in: dummy('enemy_in') } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [U(id, 'skchr_mint_1', 10, 4)], enemies: [{ key: 'enemy_d', pos: [11, 6] }] }); // [1,2]: x-2 only
    const u = h.unit(id);
    h.run(1);
    assert.equal(atkHits(h, u).length, 0, 'phalanx: no attack while the skill is off');
    fill(u);
    h.run(2);
    assert.equal(u.skill.activations, 0, 'an enemy outside her INITIAL range does not open it (not a whole-field search)');
    h.spawn('enemy_in', { pos: [10, 6] }); // [0,2]: initial range
    assert.ok(h.runUntil(() => u.skill.active, 1), 'an enemy inside her initial range opens it at once (she never attacks before)');
    assert.ok(u.findBuff('talent:mint_taunt'));
    approx(u.s.taunt, (u.base.tauntLevel ?? 0) + t0.taunt_level);
    h.run(3);
    const hits = atkHits(h, u, true).filter((c) => c.target.defId === 'enemy_d');
    assert.ok(hits.length >= 1, 'reaches [1,2] with the S1 range');
    assert.equal(hits[0].type, 'arts');
    approx(hits[0].amount, u.s.atk * b['attack@atk_scale']);
    h.runUntil(() => !u.skill.active, 30);
    assert.equal(u.findBuff('talent:mint_taunt'), null);
    assert.equal(tagged(h, 'burst', u).length, 0, 'no 聚能涡旋 end burst');
    done(h);
  }
});

test('3_09 海霓 S1 迷惑性洋流图: next attack ×atk_scale on max_target enemies at once', () => {
  for (const id of BOTH('chess_char_3_09_a')) {
    const b = SB(id, 'skchr_haini_1');
    const keys = ['enemy_e1', 'enemy_e2', 'enemy_e3', 'enemy_e4', 'enemy_e5'];
    const h = makeBattle({ defs: { enemies: Object.fromEntries(keys.map((k) => [k, dummy(k)])) }, timeLimit: 60, hooks: ['damaged', 'attack'], captureNoisy: true,
      units: [U(id, 'skchr_haini_1', 10, 4)], enemies: keys.map((k, i) => ({ key: k, pos: [9 + (i % 3), 5 + Math.floor(i / 3)] })) });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 60));
    h.run(1);
    const atk = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
    assert.equal(atk.targets.length, b.max_target);
    const sk = atkHits(h, u, true);
    assert.equal(new Set(sk.map((c) => c.target)).size, b.max_target);
    // (a normal hit once 测绘器材's fragile aura is up — it is applied right after the first tick)
    const norm = atkHits(h, u, false).find((c) => c.t > 0.5 && sk.some((x) => x.target === c.target));
    const same = sk.find((x) => x.target === norm.target);
    approx(same.amount / norm.amount, b.atk_scale, 1e-6, 'skill hit / normal hit');
    done(h);
  }
});

test('3_10 松果 S1 RMA长钉 (charges): an immediate extra shot ×atk_scale ignoring def_penetrate_fixed DEF, all in range', () => {
  for (const id of BOTH('chess_char_3_10_a')) {
    const b = SB(id, 'skchr_pinecn_1');
    const d = LD(id, 'skchr_pinecn_1');
    const front = ds.getChess(id).traitBb.atk_scale ?? 1.5;
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d', { def: 300 }), enemy_s: dummy('enemy_s', { def: 300 }) }, chess: noGarrison(id) }, timeLimit: 60, hooks: ['damaged', 'attack'], captureNoisy: true,
      units: [U(id, 'skchr_pinecn_1', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 5] }, { key: 'enemy_s', pos: [9, 6] }] });
    const u = h.unit(id);
    assert.equal(u.skill.maxCharges, d.skill.maxCharges);
    h.run(1);
    const n0 = h.hooksOf('attack').length;
    fill(u);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 5));
    const at = h.hooksOf('attack').slice(n0).filter((c) => c.attacker === u);
    assert.ok(at.some((c) => c.isSkill) && at.some((c) => !c.isSkill), 'skill shot + the normal attack');
    assert.equal(new Set(at.map((c) => c.t)).size, 1, 'at the same moment');
    h.run(0.5);
    const sk = atkHits(h, u, true);
    const main = sk.find((c) => c.target.defId === 'enemy_d');
    approx(main.amount, u.s.atk * b.atk_scale * front - (300 - b.def_penetrate_fixed), 1e-6, 'front row × and DEF ignore');
    assert.ok(sk.some((c) => c.target.defId === 'enemy_s'), 'every enemy in range');
    const plain = atkHits(h, u, false).find((c) => c.target.defId === 'enemy_d');
    approx(plain.amount, u.s.atk * front - 300, 1e-6, 'the ignore is for the skill shot only');
    // every stored charge is used, one per attack — at least AUTO_OP_COOLDOWN (3 s) apart ("自动操作具有3s冷却")
    assert.ok(h.runUntil(() => u.skill.activations >= d.skill.maxCharges, 15), 'every stored charge is used');
    const casts = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).map((c) => c.t);
    for (let i = 1; i < casts.length; i++) assert.ok(casts[i] - casts[i - 1] >= 3 - 1e-6, `casts ${casts[i - 1]} → ${casts[i]}`);
    done(h);
  }
});

test('3_11 雪猎 S1 强力击·β型: next shot ×atk_scale (× trait), 裂云兽 on that enemy; no empty-magazine cast', () => {
  for (const id of BOTH('chess_char_3_11_a')) {
    const b = SB(id, 'skchr_snhunt_1'), t0 = TB(id, 0);
    const ammoScale = ds.getChess(id).traitBb.atk_scale ?? 1.2;
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') }, chess: noGarrison(id) }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [U(id, 'skchr_snhunt_1', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 6] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 30));
    h.run(1);
    const sk = atkHits(h, u, true);
    assert.equal(sk.length, 1);
    approx(sk[0].amount, u.s.atk * b.atk_scale * ammoScale);
    const beast = tagged(h, 'cloudbeast', u);
    assert.equal(beast.length, 1);
    approx(beast[0].amount, u.s.atk * t0.atk_scale);
    // empty magazine + SP full: S1 is a normal shot, it waits for a round
    const acts = u.skill.activations;
    u.trait.ammo = 0;
    fill(u);
    h.run(0.5);
    assert.equal(u.skill.activations, acts);
    done(h);
  }
});

test('3_12 瑕光 S1 光芒涌动 (自动触发 ⇒ DEFAULT, charges): next attack ×atk_scale + heals the most injured ally of the 3×3', () => {
  for (const id of BOTH('chess_char_3_12_a')) {
    const b = SB(id, 'skchr_blemsh_1');
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['damaged', 'heal'], captureNoisy: true,
      units: [U(id, 'skchr_blemsh_1', 10, 4), { chessId: 'chess_char_3_16_a', row: 11, col: 4 }, { chessId: 'chess_char_3_05_a', row: 12, col: 4 }],
      enemies: [{ key: 'enemy_d', pos: [10, 5] }] });
    const u = h.unit(id), ally = h.unit('chess_char_3_16_a'), far = h.unit('chess_char_3_05_a');
    // an AUTO skill takes no 技能策略 (the 重装 TAKE_DAMAGE row is for MANUAL skills): it fires with her next attack
    assert.equal(u.skill.rule, 'DEFAULT');
    h.step();
    ally.hp = ally.s.maxHp * 0.6;
    far.hp = far.s.maxHp * 0.3; // outside the 3×3
    fill(u);
    assert.ok(h.runUntil(() => u.skill.activations >= 1, 5), 'cast with her next attack, no hit needed');
    h.runUntil(() => !u.skill.active, 5);
    const sk = atkHits(h, u, true);
    assert.equal(sk.length, 1);
    approx(sk[0].amount, u.s.atk * b.atk_scale);
    const heals = h.hooksOf('heal').filter((c) => c.source === u);
    assert.equal(heals[0].target, ally);
    approx(heals[0].amount, u.s.atk * b.heal_scale);
    done(h);
  }
});

test('3_12 瑕光 S2 慑敌辉光: ATK +, ground enemies on her tile sleep for the skill, allies of the skill range healed each second', () => {
  for (const id of BOTH('chess_char_3_12_a')) {
    const b = SB(id, 'skchr_blemsh_2'), t1 = TB(id, 1);
    const dur = LD(id, 'skchr_blemsh_2').skill.duration;
    // (a MANUAL 重装 skill: TAKE_DAMAGE — the enemy she blocks hits her)
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d', { atk: 200, bat: 1 }), enemy_n: dummy('enemy_n') } }, timeLimit: 60, hooks: ['damaged', 'heal', 'skillStart'], captureNoisy: true,
      units: [U(id, 'skchr_blemsh_2', 10, 4), { chessId: 'chess_char_3_16_a', row: 10, col: 6 }],
      enemies: [{ key: 'enemy_d', pos: [10, 4] }, { key: 'enemy_n', pos: [10, 5] }] });
    const u = h.unit(id), ally = h.unit('chess_char_3_16_a');
    h.run(1);
    const e = h.enemy('enemy_d'), n = h.enemy('enemy_n');
    assert.equal(e.blockedBy, u);
    ally.hp = ally.s.maxHp * 0.3;
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 3));
    assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'TAKE_DAMAGE');
    h.step();
    approx(u.s.atk, u.base.atk * (1 + b.atk));
    assert.ok(e.s.flags.sleep, 'her tile: asleep');
    approx(e.findBuff('sleep').timeLeft, dur - h.b.dt, 0.05, 'for the skill duration');
    assert.ok(!n.s.flags.sleep, 'next tile: awake');
    const n0 = h.hooksOf('damaged').length;
    h.run(2.2);
    const onSleeper = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u && c.target === e && c.dmg?.isAttack);
    assert.ok(onSleeper.length >= 1, '仁慈: she hits the sleeper');
    approx(onSleeper[0].amount, u.s.atk * t1.atk_scale, 1e-6, '×仁慈');
    const regen = h.hooksOf('heal').filter((c) => c.source === u && c.target === ally);
    assert.equal(regen.length, 2, 'once per second');
    approx(regen[0].amount, u.s.atk * b['attack@atk_to_hp_recovery_ratio']);
    done(h);
  }
});

test('3_12 瑕光 精锐 module GUA-X: heals on allies under 50 % HP ×1.15 (not above); no GUA-Y damage cut', () => {
  const id = 'chess_char_3_12_b', mod = 'uniequip_003_blemsh';
  const tb = ds.getChess(id, { moduleId: mod }).traitBb;
  const b = SB(id, 'skchr_blemsh_1');
  const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['heal', 'damaged'], captureNoisy: true,
    units: [U(id, 'skchr_blemsh_1', 10, 4, { moduleId: mod }), { chessId: 'chess_char_3_16_a', row: 11, col: 4 }], enemies: [{ key: 'enemy_d', pos: [10, 5] }] });
  const u = h.unit(id), ally = h.unit('chess_char_3_16_a');
  h.step();
  assert.equal(u.findBuff('trait:blemsh_guard'), null);
  ally.hp = ally.s.maxHp * 0.4;
  fill(u);
  h.runUntil(() => u.skill.activations >= 1 && !u.skill.pending, 5);
  let heal = h.hooksOf('heal').filter((c) => c.source === u).at(-1);
  approx(heal.amount, u.s.atk * b.heal_scale * tb.heal_scale, 1e-6, 'under 50 %');
  ally.hp = ally.s.maxHp * 0.6;
  const n1 = u.skill.activations;
  fill(u);
  h.runUntil(() => u.skill.activations > n1 && !u.skill.pending, 5);
  heal = h.hooksOf('heal').filter((c) => c.source === u).at(-1);
  approx(heal.amount, u.s.atk * b.heal_scale, 1e-6, 'above 50 %');
  done(h);
});

test('3_13 至简 S1 / 3_16 蛇屠箱 S1 / 3_20 耶拉 S1: timed stat skills from their own blackboards (蛇屠箱 on TAKE_DAMAGE, keeps attacking)', () => {
  for (const [base, sid, check] of [
    ['chess_char_3_13_a', 'skcom_quickattack[3]', (u, b) => { approx(u.s.aspd, u.base.aspd + b.attack_speed); assert.ok(u.s.atk >= u.base.atk * (1 + b.atk) - 1e-6); }],
    // (精锐 PRO-X: + trait DEF while blocking — the enemy stands on her tile)
    ['chess_char_3_16_a', 'skcom_def_up[2]', (u, b) => approx(u.s.def, u.base.def * (1 + b.def + TB(u.defId, 0).def + (u.blocking.length ? ds.getChess(u.defId).traitBb.def ?? 0 : 0)))],
    ['chess_char_3_20_a', 'skcom_atk_up[3]', (u, b) => assert.ok(u.s.atk > u.base.atk * (1 + b.atk) - 1e-6)],
  ]) {
    for (const id of BOTH(base)) {
      const b = SB(id, sid);
      const d = LD(id, sid);
      const melee = ds.getChess(id).position === 'MELEE';
      const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d', { atk: 10 }) } }, timeLimit: 80, hooks: ['damaged'], captureNoisy: true,
        units: [U(id, sid, 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, melee ? 4 : 5] }] });
      const u = h.unit(id);
      h.run(1);
      const atk0 = u.s.atk;
      fill(u);
      if (d.skill.trigger.rule === 'TAKE_DAMAGE') {
        h.run(0.5);
        assert.equal(u.skill.activations, 0, `${id}: waits for a hit`);
        h.b.dealDamage(h.enemy('enemy_d'), u, { type: 'phys', amount: 1 });
      }
      assert.ok(h.runUntil(() => u.skill.active, 5), id);
      h.step();
      check(u, b);
      const n0 = atkHits(h, u).length;
      h.run(3);
      assert.ok(atkHits(h, u).length > n0, `${id} attacks during the skill`);
      approx(u.skill.timeLeft + 3 + h.b.dt, d.skill.duration, 0.2);
      h.runUntil(() => !u.skill.active, d.skill.duration + 1);
      h.step();
      approx(u.s.atk, atk0, 1e-6, `${id} back`);
      done(h);
    }
  }
});

test('3_14 初雪 S1 传音回响: 2 targets, enemies in range ASPD + attack_speed while it runs', () => {
  for (const id of BOTH('chess_char_3_14_a')) {
    const b = SB(id, 'skchr_slbell_1');
    const h = makeBattle({ defs: { enemies: { enemy_e1: dummy('enemy_e1'), enemy_e2: dummy('enemy_e2'), enemy_e3: dummy('enemy_e3') } }, timeLimit: 60, hooks: ['attack'], captureNoisy: true,
      units: [U(id, 'skchr_slbell_1', 10, 4)], enemies: [{ key: 'enemy_e1', pos: [10, 5] }, { key: 'enemy_e2', pos: [10, 6] }, { key: 'enemy_e3', pos: [9, 5] }] });
    const u = h.unit(id);
    h.run(0.5);
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.step();
    for (const e of h.enemies()) approx(e.s.aspd, e.base.aspd + b.attack_speed);
    h.run(2);
    const sa = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
    assert.ok(sa.length >= 1 && sa.every((c) => c.targets.length === b['attack@max_target']));
    h.runUntil(() => !u.skill.active, 30);
    h.step();
    for (const e of h.enemies()) approx(e.s.aspd, e.base.aspd, 1e-6, 'restored');
    done(h);
  }
});

test('3_17 流星 S1 碎甲击: next attack ×atk_scale and the target DEF − for `duration` s', () => {
  for (const id of BOTH('chess_char_3_17_a')) {
    const b = SB(id, 'skchr_shotst_1');
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d', { def: 200 }) }, chess: noGarrison(id) }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [U(id, 'skchr_shotst_1', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 6] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 30));
    h.run(0.3);
    const e = h.enemy('enemy_d');
    const sk = atkHits(h, u, true);
    assert.equal(sk.length, 1);
    approx(sk[0].amount, u.s.atk * b.atk_scale - 200);
    const shred = e.findBuff('skill:shotst_shred');
    assert.ok(shred);
    approx(e.s.def, 200 * (1 + b.def));
    h.run(b.duration + 0.5);
    if (!e.findBuff('skill:shotst_shred')) approx(e.s.def, 200, 1e-6, 'expired');
    done(h);
  }
});

test('3_18 忍冬 S1 小施惩戒: next attack + extra arts and +DP; S2 坠刃拷问: +DP, ≤6 in its range, 停顿, then stun if already 停顿', () => {
  for (const id of BOTH('chess_char_3_18_a')) {
    const b1 = SB(id, 'skchr_vulpis_1');
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true, flags: { dpPerSec: 0 },
      units: [U(id, 'skchr_vulpis_1', 10, 4)], enemies: [{ key: 'enemy_d', pos: [10, 4] }] });
    const u = h.unit(id), p = h.b.getPlayer('p1');
    h.run(0.5);
    const dp0 = p.dp;
    fill(u);
    assert.equal(u.skill.charges, LD(id, 'skchr_vulpis_1').skill.maxCharges);
    assert.ok(h.runUntil(() => tagged(h, 'vulpisPunish', u).length >= 1, 5));
    const x = tagged(h, 'vulpisPunish', u)[0];
    assert.equal(x.type, 'arts');
    approx(x.amount, u.s.atk * b1.extra_damage_ratio);
    approx(p.dp, dp0 + b1.cost * tagged(h, 'vulpisPunish', u).length);
    done(h);

    const b2 = SB(id, 'skchr_vulpis_2');
    const d2 = LD(id, 'skchr_vulpis_2');
    const keys = ['enemy_e1', 'enemy_e2', 'enemy_e3', 'enemy_e4', 'enemy_e5', 'enemy_e6', 'enemy_e7'];
    // [0,3] (10,7) is inside 3-12 but not in her melee range: the cast needs no enemy next to her
    const g = makeBattle({ defs: { enemies: Object.fromEntries(keys.map((k) => [k, dummy(k)])) }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true, flags: { dpPerSec: 0 },
      units: [U(id, 'skchr_vulpis_2', 10, 4)], enemies: [{ key: 'enemy_e1', pos: [10, 7] }] });
    const v = g.unit(id), gp = g.b.getPlayer('p1');
    g.run(0.5);
    assert.equal(atkHits(g, v).length, 0, 'nothing in her own range');
    const gdp = gp.dp;
    v.skill.gainSp(v.skill.spCost - v.skill.sp + 0.01, 'test'); // one charge
    assert.equal(v.skill.rule, 'SKILL_RANGE');
    assert.ok(g.runUntil(() => v.skill.activations === 1, 1), 'SKILL_RANGE: an enemy on the skill range');
    const first = g.b.time;
    approx(gp.dp, gdp + b2.cost);
    const e1 = g.enemy('enemy_e1');
    const hit = tagged(g, 'vulpisTorture', v);
    assert.equal(hit.length, 1);
    approx(hit[0].amount, v.s.atk * b2.atk_scale);
    assert.ok(e1.findBuff('sluggish'));
    assert.ok(!e1.s.flags.stun, 'not 停顿 before: no stun');
    for (const [i, k] of keys.slice(1).entries()) g.spawn(k, { pos: [[9, 5], [11, 5], [10, 5], [10, 6], [11, 4], [9, 4]][i] });
    v.skill.gainSp(v.skill.spCost + 0.01, 'test');
    assert.ok(g.runUntil(() => v.skill.activations === 2, 4));
    assert.ok(g.b.time - first >= 3 - 1e-6, 'the next automatic cast waits the 3 s operation cooldown');
    const second = tagged(g, 'vulpisTorture', v).slice(1);
    assert.equal(second.length, b2.max_target, '≤ max_target enemies');
    if (second.some((c) => c.target === e1)) assert.ok(e1.s.flags.stun, 'already 停顿 ⇒ stunned');
    assert.equal(d2.skill.maxCharges, 2);
    done(g);
  }
});

test('3_19 伺夜 S1 领袖的呼唤 (ALWAYS): +DP and one more “狼影” (≤ max)', () => {
  for (const id of BOTH('chess_char_3_19_a')) {
    const b = SB(id, 'skchr_vigil_1');
    const h = makeBattle({ defs: { chess: noGarrison(id) }, timeLimit: 60, flags: { dpPerSec: 0 }, units: [U(id, 'skchr_vigil_1', 10, 3)] });
    const u = h.unit(id), p = h.b.getPlayer('p1');
    assert.equal(u.skill.rule, 'SP_FULL');
    h.step();
    const w = u.trait.reinforcement;
    assert.equal(w.mem.wolves, 2);
    const dp0 = p.dp;
    fill(u);
    h.step();
    assert.equal(u.skill.activations, 1, 'no enemy needed');
    approx(p.dp, dp0 + b.cost);
    assert.equal(w.mem.wolves, 3);
    assert.equal(w.s.blockCnt, 3);
    fill(u);
    h.step();
    assert.equal(w.mem.wolves, 3, 'capped');
    approx(p.dp, dp0 + 2 * b.cost);
    done(h);
  }
  // a 狼群 piece placed in the prep phase (content/tokens.js pack) gets the shadow too
  const id = 'chess_char_3_19_a';
  const g = makeBattle({ defs: { chess: noGarrison(id) }, timeLimit: 30, flags: { dpPerSec: 0 },
    units: [U(id, 'skchr_vigil_1', 12, 3, { uid: 1 }), { kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 11, col: 5, uid: 2 }] });
  const u = g.unit(1), piece = g.unit(2);
  g.step();
  assert.equal(u.trait.reinforcement, piece);
  const n0 = piece.mem.shadows, blk = piece.s.blockCnt;
  fill(u);
  g.step();
  assert.equal(piece.mem.shadows, n0 + 1);
  assert.equal(piece.s.blockCnt, blk + 1);
  done(g);
});

test('3_19 伺夜 S2 领袖的馈赠: +DP, the pack recovers HP, its next attack ×atk_scale, a kill by it pays +DP', () => {
  for (const id of BOTH('chess_char_3_19_a')) {
    const b = SB(id, 'skchr_vigil_2');
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') }, chess: noGarrison(id) }, timeLimit: 60, hooks: ['damaged', 'attack'], captureNoisy: true, flags: { dpPerSec: 0 },
      units: [U(id, 'skchr_vigil_2', 10, 3)], enemies: [{ key: 'enemy_d', pos: [9, 3], time: 0.5 }] });
    const u = h.unit(id), p = h.b.getPlayer('p1');
    h.run(2);
    const w = u.trait.reinforcement, e = h.enemy('enemy_d');
    assert.equal(e.blockedBy, w);
    w.hp = w.s.maxHp * 0.5;
    const dp0 = p.dp;
    fill(u);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 3));
    approx(p.dp, dp0 + b.cost);
    approx(w.hp, w.s.maxHp * (0.5 + b['vigil_wolf_s_2.hp_ratio']));
    h.b.addBuff(u, { key: 'test:disarm', flags: { disarm: true } });
    const n0 = h.hooksOf('attack').length;
    assert.ok(h.runUntil(() => h.hooksOf('attack').slice(n0).filter((c) => c.attacker === w).length >= 2, 6));
    const bites = h.hooksOf('attack').slice(n0).filter((c) => c.attacker === w);
    const dmgOf = (a) => h.hooksOf('damaged').filter((c) => c.source === w && c.dmg?.isAttack && c.dmg.attackId === a);
    const ids = [...new Set(h.hooksOf('damaged').filter((c) => c.source === w && c.dmg?.isAttack).map((c) => c.dmg.attackId))].filter((a) => a > 0).slice(-bites.length);
    const first = dmgOf(ids[0]), second = dmgOf(ids[1]);
    assert.equal(first.length, w.mem.wolves);
    for (const c of first) approx(c.amount, w.s.atk * b['vigil_wolf_s_2.atk_scale'], 1e-6, 'empowered bite');
    for (const c of second) approx(c.amount, w.s.atk, 1e-6, 'one attack only');
    done(h);

    // kill by the empowered attack ⇒ +cost DP
    const g = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') }, chess: noGarrison(id) }, timeLimit: 60, flags: { dpPerSec: 0 },
      units: [U(id, 'skchr_vigil_2', 10, 3)], enemies: [{ key: 'enemy_d', pos: [9, 3], time: 0.5 }] });
    const v = g.unit(id), gp = g.b.getPlayer('p1');
    g.run(2);
    g.b.addBuff(v, { key: 'test:disarm', flags: { disarm: true } }); // (his own shots must not take the kill)
    g.run(1);
    fill(v);
    assert.ok(v.skill.activate('test'));
    const gdp = gp.dp;
    const ge = g.enemy('enemy_d');
    ge.hp = 1;
    assert.ok(g.runUntil(() => !ge.alive, 5));
    approx(gp.dp, gdp + b['vigil_wolf_s_2.cost'], 1e-6, 'kill bonus');
    done(g);
  }
});

test('3_19 伺夜 精锐 module TAC-Y: ×165 % on pack-blocked enemies; "援军阻挡的敌人更容易受到我方的攻击" = those enemies taunt +1 (not the pack); TAC-X guard not applied', () => {
  const id = 'chess_char_3_19_b', mod = 'uniequip_003_vigil';
  const tb = ds.getChess(id, { moduleId: mod }).traitBb;
  const h = makeBattle({ defs: { enemies: { enemy_h: dummy('enemy_h', { atk: 400, bat: 1 }) }, chess: noGarrison(id) }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true, flags: { dpPerSec: 0 },
    units: [{ chessId: id, row: 10, col: 3, moduleId: mod }], enemies: [{ key: 'enemy_h', pos: [9, 3], time: 0.5 }] });
  const u = h.unit(id);
  h.run(3);
  const w = u.trait.reinforcement, e = h.enemy('enemy_h');
  assert.equal(e.blockedBy, w);
  approx(w.s.taunt, w.base.tauntLevel ?? 0, 1e-9, 'the pack itself keeps its taunt level');
  assert.equal(e.s.taunt, 1, 'the enemy it blocks: taunt_level +1');
  approx(atkHits(h, u, false)[0].amount, u.s.atk * tb.atk_scale, 1e-6, 'trait ×1.65');
  const taken = h.hooksOf('damaged').find((c) => c.target === w && c.source === e);
  approx(taken.amount, 400 - w.s.def, 1e-6, 'no TAC-X damage cut');
  // released (the pack is withdrawn) ⇒ the mark goes away
  h.b.retreat(w, { reason: 'expired', permanent: true });
  h.run(0.5);
  assert.equal(e.s.taunt || 0, 0, 'no mark once no longer blocked by the pack');
  done(h);

  // operators pick the pack-blocked enemy over one nearer to the goal (a prep-placed 狼群 piece run by tokens.js);
  // the default TAC-X marks nothing
  for (const m of [mod, null]) {
    const g = makeBattle({ defs: { enemies: { enemy_h: dummy('enemy_h'), enemy_o: dummy('enemy_o') }, chess: noGarrison(id) }, timeLimit: 60, hooks: ['attack'], captureNoisy: true, flags: { dpPerSec: 0 },
      units: [{ chessId: id, row: 10, col: 4, uid: 1, ...(m ? { moduleId: m } : {}) }, { kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 9, col: 6, uid: 2 }],
      enemies: [{ key: 'enemy_h', pos: [9, 6], time: 0.5 }, { key: 'enemy_o', pos: [9, 5], time: 0.5 }] });
    const v = g.unit(1), piece = g.unit(2);
    g.run(3);
    const eh = g.enemy('enemy_h'), eo = g.enemy('enemy_o');
    assert.equal(v.trait.reinforcement, piece);
    assert.equal(eh.blockedBy, piece);
    assert.ok(g.b.remainingDistance(eo) < g.b.remainingDistance(eh), 'the other enemy is nearer to the goal');
    const shots = g.hooksOf('attack').filter((c) => c.attacker === v);
    assert.ok(shots.length >= 2);
    const want = m ? eh : eo;
    assert.ok(shots.every((c) => c.targets[0] === want), `${m ?? 'TAC-X'}: 伺夜 shoots ${want.defId}`);
    done(g);
  }
});

test('3_21 空弦 S1 箭矢·散逸: next attack ×atk_scale + up to 3 other enemies around × atk_scale_2', () => {
  for (const id of BOTH('chess_char_3_21_a')) {
    const b = SB(id, 'skchr_archet_1');
    const keys = ['enemy_e1', 'enemy_e2', 'enemy_e3', 'enemy_e4', 'enemy_e5'];
    const h = makeBattle({ defs: { enemies: Object.fromEntries(keys.map((k) => [k, dummy(k)])), chess: noGarrison(id) }, timeLimit: 60, hooks: ['damaged', 'attack'], captureNoisy: true,
      units: [U(id, 'skchr_archet_1', 10, 3)],
      enemies: [{ key: 'enemy_e1', pos: [10, 6] }, { key: 'enemy_e2', pos: [9, 6] }, { key: 'enemy_e3', pos: [11, 6] }, { key: 'enemy_e4', pos: [10, 7] }, { key: 'enemy_e5', pos: [9, 7] }] });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 30));
    h.run(1);
    const main = atkHits(h, u, true);
    assert.equal(main.length, 1);
    approx(main[0].amount, u.s.atk * b.atk_scale);
    const sc = tagged(h, 'archetScatter', u);
    assert.equal(sc.length, b.max_target - 1);
    assert.ok(!sc.some((c) => c.target === main[0].target), 'other enemies');
    for (const c of sc) {
      approx(c.amount, u.s.atk * b.atk_scale_2);
      assert.ok(Math.hypot(c.target.x - main[0].target.x, c.target.y - main[0].target.y) <= 1.5 + 1e-9);
    }
    done(h);
  }
});

test('3_21 空弦 S2 箭矢·追猎 (charges): times hits on the target, then bounces with one hit fewer each time', () => {
  for (const id of BOTH('chess_char_3_21_a')) {
    const b = SB(id, 'skchr_archet_2');
    const d = LD(id, 'skchr_archet_2');
    const h = makeBattle({ defs: { enemies: { enemy_e1: dummy('enemy_e1'), enemy_e2: dummy('enemy_e2'), enemy_e3: dummy('enemy_e3') }, chess: noGarrison(id) }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [U(id, 'skchr_archet_2', 10, 3)], enemies: [{ key: 'enemy_e1', pos: [10, 6] }, { key: 'enemy_e2', pos: [10, 7] }, { key: 'enemy_e3', pos: [10, 8] }] });
    const u = h.unit(id);
    assert.equal(u.skill.maxCharges, d.skill.maxCharges);
    h.run(0.5);
    u.skill.gainSp(u.skill.spCost - u.skill.sp + 0.01, 'test');
    assert.ok(h.runUntil(() => u.skill.activations === 1, 3));
    h.run(2);
    const hits = tagged(h, 'archetPursuit', u);
    const per = (k) => hits.filter((c) => c.target.defId === k).length;
    const first = hits[0].target.defId;
    assert.equal(per(first), b.times);
    const counts = ['enemy_e1', 'enemy_e2', 'enemy_e3'].map(per).sort((x, y) => y - x);
    assert.deepEqual(counts, [b.times, b.times - 1, b.times - 2], '5, 4, 3');
    for (const c of hits) approx(c.amount, u.s.atk * b.atk_scale);
    done(h);
  }
  // a lone target takes all the hits of the first volley only (no one to bounce to)
  const id = 'chess_char_3_21_a';
  const g = makeBattle({ defs: { enemies: { enemy_e1: dummy('enemy_e1') }, chess: noGarrison(id) }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [U(id, 'skchr_archet_2', 10, 3)], enemies: [{ key: 'enemy_e1', pos: [10, 6] }] });
  const v = g.unit(id);
  g.run(0.5);
  v.skill.gainSp(v.skill.spCost - v.skill.sp + 0.01, 'test');
  assert.ok(g.runUntil(() => v.skill.activations === 1, 3));
  g.run(2);
  assert.equal(tagged(g, 'archetPursuit', v).length, SB(id, 'skchr_archet_2').times);
  done(g);
});

test('3_21 空弦 精锐 modules: MAR-X fly × and no ground ASPD; ISW-A (集成战略 only) no range bonus', () => {
  const id = 'chess_char_3_21_b';
  const x = ds.getChess(id, { moduleId: 'uniequip_003_archet' });
  const h = makeBattle({ defs: { enemies: { enemy_f: dummy('enemy_f', { motion: 'FLY' }), enemy_g: dummy('enemy_g') }, chess: noGarrison(id) }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4, moduleId: 'uniequip_003_archet' }], enemies: [{ key: 'enemy_f', pos: [10, 6] }, { key: 'enemy_g', pos: [10, 7] }] });
  const u = h.unit(id);
  h.run(3);
  const fl = atkHits(h, u, false).find((c) => c.target.defId === 'enemy_f');
  approx(fl.amount, u.s.atk * x.traitBb.atk_scale, 1e-6, 'MAR-X fly ×');
  assert.equal(u.findBuff('trait:archet_ground'), null, 'MAR-Y ground ASPD not installed');
  done(h);
  const g = makeBattle({ defs: { chess: noGarrison(id) }, timeLimit: 10, units: [{ chessId: id, row: 10, col: 4, moduleId: 'uniequip_004_archet' }] });
  const v = g.unit(id);
  g.step();
  assert.equal(v.s.rangeExtend, 0);
  assert.equal(v.rangeKeys.length, ds.getChess(id).rangeGrid.length);
  done(g);
});

test('忍冬 精锐 module SOL-Y: stats only (the initial deployment is free), no SOL-X block buff', () => {
  const id = 'chess_char_3_18_b', mod = 'uniequip_003_vulpis';
  const d = ds.getChess(id, { moduleId: mod });
  const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 20, flags: { dpPerSec: 0 },
    units: [{ chessId: id, row: 10, col: 4, moduleId: mod }], enemies: [{ key: 'enemy_d', pos: [10, 4] }] });
  const u = h.unit(id);
  const dp0 = h.b.getPlayer('p1').dp;
  h.run(2);
  assert.equal(u.base.atk, d.stats.atk);
  assert.equal(h.enemy('enemy_d').blockedBy, u);
  assert.equal(u.findBuff('trait:vulpis_block'), null);
  assert.ok(h.b.getPlayer('p1').dp >= dp0, 'no DP spent or refunded');
  done(h);
});
