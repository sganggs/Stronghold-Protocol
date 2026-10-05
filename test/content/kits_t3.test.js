// Tier-3 operator kits (server/sim/content/kits/tier3.js): every chess runs a real battle through the harness and
// its signature skill / talent / module effect is asserted with numbers taken from its own blackboards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { effectiveProfile } from '../../server/sim/ai.js';
import KITS from '../../server/sim/content/kits/tier3.js';

const ds = getDefaultSource();
const D = (id) => ds.getChess(id);
const BB = (id) => D(id).skill.bb;
const TB = (id, i) => D(id).talents[i].bb;
const TR = (id) => D(id).traitBb;
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, def: 0, res: 0, ...o });
const fill = (u) => u.skill.gainSp(u.skill.spCost * u.skill.maxCharges + 1, 'test');
const tagged = (h, tag, src = null) => h.hooksOf('damaged').filter((c) => c.dmg?.tags?.includes(tag) && (!src || c.source === src));
const done = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []); checkInvariants(h.b); };
/** defs.chess override: the chess without its 特质 (garrisons have their own tests) — isolates kit damage numbers/types. */
const noGarrison = (...ids) => Object.fromEntries(ids.map((id) => [id, { ...ds.rawChess(id), garrisonIds: [] }]));

test('tier3 kit registry covers every tier-3 chess (19 visible + 2 hidden)', () => {
  const ids = ds.chessIds().filter((id) => /^chess_char_3_\d+_a$/.test(id));
  assert.equal(ids.length, 21);
  for (const id of ids) assert.equal(typeof KITS[id], 'function', id);
  for (const id of ids) for (const v of [id, id.replace(/_a$/, '_b')]) {
    const d = D(v);
    const kit = KITS[id](d.skill.bb, d.raw, d);
    assert.ok(kit && kit.skill && kit.skill.kind, `${v} has a skill spec`);
  }
});

// ---------------------------------------------------------------------------------------------------------------

test('3_01 能天使: 过载模式 5-hit bursts at a shorter interval; talents ASPD/ATK/HP + one blessed ally', () => {
  const id = 'chess_char_3_01_a', bb = BB(id), t0 = TB(id, 0), t1 = TB(id, 1);
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 120, hooks: ['damaged', 'attack'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 12, col: 7 }], enemies: [{ key: 'enemy_d', pos: [10, 6] }],
  });
  const u = h.unit(id), ally = h.unit('chess_char_3_16_a');
  h.step(3);
  approx(u.s.aspd, 100 + t0.attack_speed);
  approx(u.s.atk, u.base.atk * (1 + t1.atk));
  approx(u.s.maxHp, u.base.maxHp * (1 + t1.max_hp));
  assert.ok(ally.findBuff('talent:angel_bless_ally'), 'the only other operator got the blessing');
  approx(ally.s.maxHp, ally.base.maxHp * (1 + t1.max_hp));
  assert.ok(h.runUntil(() => u.skill.active, 60));
  approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd);
  assert.equal(effectiveProfile(u).hits, bb['attack@times']);
  h.runUntil(() => !u.skill.active, 30);
  h.run(1);
  const skillAtks = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length;
  const skillHits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && c.dmg.isSkill).length;
  assert.ok(skillAtks >= 5);
  assert.equal(skillHits, skillAtks * bb['attack@times']);
  done(h);
});

test('3_02 断崖: 浮游刃 arts hits + blade damage on enemies blocked by adjacent allies; 索敌援助 ASPD aura; 精锐 module arts', () => {
  for (const id of ['chess_char_3_02_a', 'chess_char_3_02_b']) {
    const bb = BB(id), t0 = TB(id, 0), tb = TR(id);
    const h = makeBattle({
      defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 11, col: 4 }], enemies: [{ key: 'enemy_d', pos: [11, 4] }],
    });
    const u = h.unit(id), ally = h.unit('chess_char_3_16_a');
    h.run(0.5);
    approx(ally.s.aspd, 100 + t0.attack_speed, 1e-6, 'aura on the adjacent operator');
    approx(u.s.aspd, u.base.aspd + t0.attack_speed, 1e-6, 'and on herself');
    const e = h.enemy('enemy_d');
    assert.equal(e.blockedBy, ally);
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    h.run(4);
    const blades = tagged(h, 'ayerBlade', u);
    assert.ok(blades.length >= 2, 'one blade hit per attack');
    for (const c of blades) { assert.equal(c.type, 'arts'); approx(c.amount, u.s.atk * bb.atk_scale, 1e-6, 'blade'); }
    const main = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && c.dmg.isSkill);
    assert.ok(main.length && main.every((c) => c.type === 'arts'), 'skill attacks are arts');
    if (tb.atk_scale_m) {
      const m = tagged(h, 'module', u);
      assert.ok(m.length >= 3);
      approx(m[m.length - 1].amount, u.s.atk * tb.atk_scale_m, 1e-6, 'module arts');
    } else assert.equal(tagged(h, 'module', u).length, 0);
    done(h);
  }
});

test('3_03 诗怀雅: 近距离作战指导 melee ATK aura, ×talent_scale during 协同作战', () => {
  const id = 'chess_char_3_03_a', bb = BB(id), t0 = TB(id, 0);
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60,
    units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 11, col: 4 }, { chessId: 'chess_char_3_09_a', row: 11, col: 5 }],
    enemies: [{ key: 'enemy_d', pos: [10, 5] }],
  });
  const u = h.unit(id), melee = h.unit('chess_char_3_16_a'), ranged = h.unit('chess_char_3_09_a');
  h.run(0.5);
  approx(melee.s.atk, melee.base.atk * (1 + t0.atk));
  approx(ranged.s.atk, ranged.base.atk, 1e-6, 'ranged allies are not coached');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  h.step();
  approx(melee.s.atk, melee.base.atk * (1 + t0.atk * bb.talent_scale));
  approx(u.s.atk, u.base.atk * (1 + bb.atk + t0.atk * bb.talent_scale));
  h.runUntil(() => !u.skill.active, 30);
  h.run(0.5);
  approx(melee.s.atk, melee.base.atk * (1 + t0.atk));
  done(h);
});

test('3_04 琳琅诗怀雅: coins → champagne bomb (ATK% + 停顿), 大买家 coin/ATK per DP payment, 破财消灾 DP revive', () => {
  const id = 'chess_char_3_04_a', bb = BB(id), t0 = TB(id, 0), t1 = TB(id, 1);
  const booms = [];
  const h = makeBattle({
    defs: { enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 1e6, speed: 1, def: 0, atk: 0 }) } }, timeLimit: 60, hooks: ['damaged', 'deploy'], captureNoisy: true,
    units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'enemy_w', route: 0 }],
    setup: (b) => b.on('damaged', (c) => { if (c.dmg?.tags?.includes('trap')) booms.push({ amount: c.amount, atk: c.source.s.atk, t: b.time }); }),
  });
  const u = h.unit(id);
  h.step();
  assert.equal(u.mem.coins, t0.sp, '开启技能 coin');
  h.run(3.1);
  assert.equal(u.mem.coins, t0.sp + t0.trait_sp, 'coin from the first trait payment');
  assert.equal(u.findBuff('talent:swire2_buyer')?.stacks, 1);
  approx(u.s.atk, u.base.atk * (1 + t0.atk));
  assert.ok(h.runUntil(() => booms.length > 0, 20), 'bomb exploded');
  assert.ok(h.hooksOf('deploy').some((c) => c.unit.defId === 'token_10031_swire2_gdtrap'), 'bomb token placed');
  approx(booms[0].amount, booms[0].atk * bb.atk_scale, 1e-6, 'bomb damage');
  const e = h.enemy('enemy_w');
  assert.ok(e.findBuff('sluggish'), '停顿');
  assert.ok(u.mem.coins <= bb.sp);
  // 破财消灾
  const p = h.b.getPlayer('p1');
  p.dp = 30;
  h.b.dealDamage(null, u, { type: 'true', amount: 1e6 });
  assert.equal(u.alive, true);
  approx(u.hp, u.s.maxHp * t1.hp_ratio);
  approx(p.dp, 30 - Math.abs(t1.cost));
  h.b.dealDamage(null, u, { type: 'true', amount: 1e6 });
  assert.equal(u.alive, true);
  approx(p.dp, 30 - Math.abs(t1.cost) * (1 + t1.cost_multi), 1e-6, 'cost doubled');
  p.dp = 0;
  h.b.dealDamage(null, u, { type: 'true', amount: 1e6 });
  assert.equal(u.alive, false, 'no DP ⇒ no save');
  done(h);
});

test('3_05 斯卡蒂: 涌潮悲歌 ATK/DEF/HP; 深海掠食者 on Abyssal Hunters only; 迅捷出击 redeploy; 精锐 module revive', () => {
  const id = 'chess_char_3_05_a', bb = BB(id), t0 = TB(id, 0), t1 = TB(id, 1);
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60,
    units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_2_07_a', row: 11, col: 4 }, { chessId: 'chess_char_3_16_a', row: 12, col: 4 }],
    enemies: [{ key: 'enemy_d', pos: [10, 5] }],
  });
  const u = h.unit(id), ghost = h.unit('chess_char_2_07_a'), cuora = h.unit('chess_char_3_16_a');
  h.step();
  assert.equal(ghost.findBuff('talent:skadi_predator')?.mods.atkPct, t0.atk, '幽灵鲨 is an Abyssal Hunter');
  assert.equal(cuora.findBuff('talent:skadi_predator'), null);
  approx(u.s.atk, u.base.atk * (1 + t0.atk));
  assert.equal(u.base.respawnTime, D(id).stats.respawnTime + t1.respawn_time);
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  approx(u.s.atk, u.base.atk * (1 + t0.atk + bb.atk));
  approx(u.s.def, u.base.def * (1 + bb.def));
  approx(u.s.maxHp, u.base.maxHp * (1 + bb.max_hp));
  done(h);

  const gid = 'chess_char_3_05_b', tb = TR(gid);
  const g = makeBattle({ units: [{ chessId: gid, row: 10, col: 4 }], timeLimit: 30 });
  const s = g.unit(gid);
  g.step();
  g.b.dealDamage(null, s, { type: 'true', amount: 1e7 });
  assert.equal(s.alive, true, 'module: does not retreat');
  approx(s.s.maxHp, s.base.maxHp * (1 - tb.value));
  approx(s.hp, s.s.maxHp * tb.hp_ratio);
  approx(s.s.aspd, s.base.aspd + tb.attack_speed);
  g.b.dealDamage(null, s, { type: 'true', amount: 1e7 });
  assert.equal(s.alive, false, 'once per deployment');
  done(g);
});

test('3_06 菲莱: 冥河诅咒 no attacks, HP +, counter arts + apoptosis (cd), ATK + after element damage; 神河谕使; 精锐 element ×', () => {
  for (const id of ['chess_char_3_06_a', 'chess_char_3_06_b']) {
    const bb = BB(id), t0 = TB(id, 0), tb = TR(id);
    const h = makeBattle({
      defs: { enemies: { enemy_h: dummy('enemy_h', { atk: 150, bat: 0.5 }) } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: id, row: 10, col: 5 }], enemies: [{ key: 'enemy_h', pos: [10, 5] }],
    });
    const u = h.unit(id);
    h.run(0.2);
    const e = h.enemy('enemy_h');
    // 神河谕使: a 元素损伤 multiplier on the hit (the gauge fill), not elemTakenMul (元素伤害 / 元素脆弱)
    approx(u.s.elemTakenMul, 1);
    const sp0 = u.skill.sp, a0 = u.elem.apoptosis;
    h.b.dealDamage(e, u, { type: 'element', element: 'apoptosis', amount: 10 });
    approx(u.elem.apoptosis - a0, 10 * (1 - t0.damage_resistance), 1e-6, 'element taken −damage_resistance');
    approx(u.skill.sp, sp0 + t0.sp, 1e-6, '+SP on apoptosis');
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 10));
    const atks = u.stats.attacks;
    approx(u.s.maxHp, u.base.maxHp * (1 + bb.max_hp));
    h.run(5);
    assert.equal(u.stats.attacks, atks, '停止攻击');
    const counters = tagged(h, 'counter', u);
    assert.ok(counters.length >= 2 && counters.length <= Math.ceil(5 / bb.aoe_cd) + 1, `aoe_cd respected (${counters.length})`);
    for (let i = 1; i < counters.length; i++) assert.ok(counters[i].t - counters[i - 1].t >= bb.aoe_cd - 1e-6);
    approx(counters[0].amount, u.s.atk * bb.atk_scale, 1e-6, 'counter');
    const el = h.hooksOf('damaged').filter((c) => c.source === u && c.type === 'element');
    approx(el[0].amount, u.s.atk * bb.ep_damage_ratio * (tb.ep_damage_scale ?? 1), 1e-6, 'apoptosis (module × while blocking)');
    assert.equal(u.findBuff('skill:philae_rage'), null);
    h.b.dealDamage(e, u, { type: 'element', element: 'burn', amount: 10 });
    approx(u.s.atk, u.base.atk * (1 + bb.atk), 1e-6, 'rage');
    h.runUntil(() => !u.skill.active, 60);
    assert.equal(u.findBuff('skill:philae_rage'), null, 'until the skill ends');
    done(h);
  }
});

test('3_07 见行者: 惊爆射击 pushes enemies forward + stun (wall / collision); 技巧射击 DEF ignore vs heavy; 精锐 refund', () => {
  const id = 'chess_char_3_07_a', bb = BB(id), t0 = TB(id, 0);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a', { mass: 1 }), enemy_b: dummy('enemy_b', { mass: 1 }), enemy_c: dummy('enemy_c', { mass: 1 }) } },
    timeLimit: 60, hooks: ['statusApplied'],
    units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_a', pos: [10, 5] }, { key: 'enemy_c', pos: [10, 6.55] }],
  });
  const u = h.unit(id);
  h.step();
  const a = h.enemy('enemy_a'), c = h.enemy('enemy_c');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === 1, 5));
  assert.ok(a.x > 5.9, `pushed forward (${a.x})`);
  const stun = (x) => h.hooksOf('statusApplied').find((s) => s.target === x && s.status === 'stun');
  approx(stun(a).duration, bb['forcer_s_2[hit_directly].stun']);
  approx(stun(c).duration, bb['forcer_s_2[brush].stun'], 1e-6, 'collided enemy');
  done(h);

  const w = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a', { mass: 1 }) } }, timeLimit: 30, hooks: ['statusApplied'],
    units: [{ chessId: id, row: 12, col: 9 }], enemies: [{ key: 'enemy_a', pos: [12, 10] }],
  });
  const v = w.unit(id);
  w.step();
  fill(v);
  assert.ok(w.runUntil(() => v.skill.activations === 1, 5));
  approx(w.hooksOf('statusApplied').find((s) => s.status === 'stun').duration, bb.stun, 1e-6, 'slammed into the edge');
  done(w);

  const k = makeBattle({
    defs: { enemies: { enemy_heavy: dummy('enemy_heavy', { mass: t0.value, def: 300 }), enemy_light: dummy('enemy_light', { mass: t0.value - 1, def: 300 }) } },
    timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_heavy', pos: [10, 4] }, { key: 'enemy_light', pos: [10, 4] }],
  });
  const f = k.unit(id);
  k.run(3);
  const hitsOn = (key) => k.hooksOf('damaged').filter((x) => x.source === f && x.target.defId === key && x.dmg?.isAttack);
  approx(hitsOn('enemy_heavy')[0].amount, f.s.atk - (300 - t0.def_penetrate_fixed));
  approx(hitsOn('enemy_light')[0].amount, f.s.atk - 300, 1e-6, 'light enemies keep their DEF');
  done(k);

  const gid = 'chess_char_3_07_b';
  const r = makeBattle({ units: [{ chessId: gid, row: 10, col: 2 }], timeLimit: 30, flags: { dpPerSec: 0 } });
  const g = r.unit(gid);
  r.step();
  const p = r.b.getPlayer('p1');
  r.b.dealDamage(null, g, { type: 'true', amount: 1e7 });
  p.dp = 50;
  r.b.redeploy(g, { free: false });
  approx(p.dp, 50 - g.base.cost + g.base.cost * TR(gid).value, 1e-6, 'half the cost back on a ranged tile');
  done(r);
});

test('3_08 薄绿: 聚能涡旋 pull + ATK% arts, end burst; 地质学者 DEF aura / taunt −1; 精锐 keeps part of the guard', () => {
  for (const id of ['chess_char_3_08_a', 'chess_char_3_08_b']) {
    const bb = BB(id), t0 = TB(id, 0), tb = TR(id);
    const h = makeBattle({
      defs: { enemies: { enemy_d: dummy('enemy_d', { mass: 0 }) } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 11, col: 4 }], enemies: [{ key: 'enemy_d', pos: [10, 6] }],
    });
    const u = h.unit(id), ally = h.unit('chess_char_3_16_a');
    h.run(0.5);
    const e = h.enemy('enemy_d');
    approx(ally.s.def, ally.base.def * (1 + TB('chess_char_3_16_a', 0).def + t0.def), 1e-6, 'geo aura');
    approx(u.s.def, u.base.def * (1 + t0.def + tb.def), 1e-6, 'guard + own aura');
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.run(0.5);
    approx(u.s.taunt, t0.taunt_level);
    approx(ally.s.def, ally.base.def * (1 + TB('chess_char_3_16_a', 0).def), 1e-6, 'aura off during the skill');
    const keep = tb['soil_e_002[buff].def'] ?? 0;
    approx(u.s.def, u.base.def * (1 + keep));
    approx(u.s.res, u.base.res + (tb['soil_e_002[buff].magic_resistance'] ?? 0));
    h.run(3);
    assert.ok(e.x < 6 - 0.2, `pulled toward her front tile (${e.x})`);
    const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && c.target === e);
    approx(hits[0].amount, u.s.atk * bb['attack@atk_scale']);
    h.runUntil(() => !u.skill.active, 30);
    const burst = tagged(h, 'burst', u);
    assert.equal(burst.length, 1);
    approx(burst[0].amount, u.s.atk * bb.atk_scale, 1e-6, 'end burst');
    assert.equal(u.s.taunt, 0);
    done(h);
  }
});

test('3_09 海霓: 测绘器材 fragile on non-elite enemies; 阻滞性显色剂 ATK, 2 targets, slow, kills raise the talent', () => {
  const id = 'chess_char_3_09_a', bb = BB(id), t0 = TB(id, 0);
  const h = makeBattle({
    defs: { enemies: { enemy_n: dummy('enemy_n'), enemy_e: dummy('enemy_e', { rank: 'ELITE' }), enemy_f: dummy('enemy_f', { hp: 1 }) } },
    timeLimit: 60, hooks: ['attack'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_n', pos: [10, 4] }, { key: 'enemy_e', pos: [10, 5] }],
  });
  const u = h.unit(id);
  h.run(0.5);
  const n = h.enemy('enemy_n'), el = h.enemy('enemy_e');
  approx(n.s.dmgTakenMul, t0.damage_scale);
  approx(el.s.dmgTakenMul, 1, 1e-9, 'elites are not marked');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.step();
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  assert.equal(effectiveProfile(u).maxTargets, bb['attack@max_target']);
  approx(n.findBuff('skill:haini_slow').mods.moveMul, 1 + bb['attack@move_speed']);
  assert.equal(el.findBuff('skill:haini_slow'), null);
  h.run(2);
  assert.ok(h.hooksOf('attack').some((c) => c.attacker === u && c.targets.length === 2), 'attacks two targets');
  h.spawn('enemy_f', { pos: [9, 4] });
  assert.ok(h.runUntil(() => !h.enemy('enemy_f').alive, 5), 'fodder killed in range');
  h.run(0.3);
  approx(u.mem.hainiMul, 1 + bb['attack@talent_up']);
  approx(n.s.dmgTakenMul, 1 + (t0.damage_scale - 1) * (1 + bb['attack@talent_up']));
  h.runUntil(() => !u.skill.active, 40);
  h.run(0.5);
  approx(n.s.dmgTakenMul, t0.damage_scale, 1e-6, 'back to 1× after the skill');
  assert.equal(n.findBuff('skill:haini_slow'), null);
  done(h);
});

test('3_10 松果: 电能过载 ATK grows with each use + shorter range; 便携电源 SP regen for 60 s', () => {
  const id = 'chess_char_3_10_a', bb = BB(id), t0 = TB(id, 0);
  const steps = Object.keys(bb).filter((k) => /\[[a-z]\]\.atk$/.test(k)).sort().map((k) => bb[k]);
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 200,
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [10, 4] }],
  });
  const u = h.unit(id);
  h.step();
  approx(u.s.spRecovery, 1 + t0.sp_recovery_per_sec);
  const wide = u.rangeKeys.length;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + steps[0]));
  assert.equal(u.rangeKeys.length, D(id).skill.rangeGrid.length, 'range shortened');
  assert.ok(u.rangeKeys.length < wide);
  h.runUntil(() => !u.skill.active, 30);
  approx(u.s.atk, u.base.atk);
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + steps[1]), 1e-6, 'second use');
  h.runUntil(() => h.b.time > t0.duration + 0.5 && !u.skill.active, 60);
  approx(u.s.spRecovery, 1, 1e-9, 'talent expired');
  done(h);
});

test('3_11 雪猎: 风雪连弩 instant double shot (non-moving ×), 裂云一击 ATK% + cold; empty-mag cast; 精锐 extra reload', () => {
  const id = 'chess_char_3_11_a', bb = BB(id), t0 = TB(id, 0);
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['damaged', 'statusApplied'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [10, 6] }],
  });
  const u = h.unit(id);
  h.step();
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === 1, 5));
  h.run(1);
  const shots = tagged(h, 'snhunt', u);
  assert.equal(shots.length, 2);
  for (const s of shots) approx(s.amount, u.s.atk * bb.atk_scale_2, 1e-6, 'vs a non-moving target');
  const beast = tagged(h, 'cloudbeast', u);
  assert.equal(beast.length, 1);
  approx(beast[0].amount, u.s.atk * t0.atk_scale);
  assert.ok(h.hooksOf('statusApplied').some((s) => s.status === 'cold' && s.source === u && Math.abs(s.duration - t0.cold) < 1e-9));
  // magazine empty: the special bullets still fire
  u.trait.ammo = 0;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === 2, 2), 'cast with an empty magazine');
  done(h);

  const gid = 'chess_char_3_11_b', tb = TR(gid);
  const g = makeBattle({ units: [{ chessId: gid, row: 10, col: 3 }], timeLimit: 30 });
  const s = g.unit(gid);
  g.step();
  s.trait.ammo = 0;
  assert.ok(g.runUntil(() => s.trait.ammo > 0, 5));
  assert.equal(s.trait.ammo, 1 + tb.extra_add, 'reload from empty adds the extra round');
  done(g);
});

test('3_12 瑕光: 先贤化身 bonus arts + heals another ally; 剑盾骑士 SP on attack; 仁慈 sleeping targets ×; 精锐 guard', () => {
  const id = 'chess_char_3_12_a', bb = BB(id), t0 = TB(id, 0), t1 = TB(id, 1);
  const h = makeBattle({
    defs: { enemies: { enemy_h: dummy('enemy_h', { atk: 50, bat: 2 }) } }, timeLimit: 60, hooks: ['damaged', 'heal', 'spGain'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 11, col: 4 }], enemies: [{ key: 'enemy_h', pos: [10, 4] }],
  });
  const u = h.unit(id), ally = h.unit('chess_char_3_16_a');
  h.run(3);
  assert.ok(h.hooksOf('spGain').some((c) => c.unit === u && c.reason === 'talent' && c.amount === t0.sp), '剑盾骑士: hurt-SP skill gains SP on attack');
  ally.hp = ally.s.maxHp * 0.3;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  approx(u.s.def, u.base.def * (1 + bb.def));
  h.run(3);
  const bonus = tagged(h, 'blemshBonus', u);
  assert.ok(bonus.length >= 2);
  approx(bonus[0].amount, u.s.atk * bb['attack@blemsh_s_3_extra_dmg[magic].atk_scale']);
  const heals = h.hooksOf('heal').filter((c) => c.source === u && c.target === ally);
  assert.ok(heals.length >= 2, 'heals the other ally');
  approx(heals[0].amount, u.s.atk * bb.heal_scale);
  done(h);

  const s = makeBattle({
    defs: { enemies: { enemy_z: dummy('enemy_z') } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_z', pos: [10, 5] }],
  });
  const b = s.unit(id);
  s.step();
  s.b.applyStatus(s.enemy('enemy_z'), 'sleep', { duration: 20 });
  const tSleep = s.b.time;
  s.run(3);
  const hits = s.hooksOf('damaged').filter((c) => c.source === b && c.dmg?.isAttack && c.t >= tSleep);
  assert.ok(hits.length >= 1, 'attacks the sleeping enemy');
  approx(hits[0].amount, b.s.atk * t1.atk_scale);
  done(s);

  const gid = 'chess_char_3_12_b';
  const g = makeBattle({ units: [{ chessId: gid, row: 10, col: 4 }], timeLimit: 10 });
  g.step();
  approx(g.unit(gid).s.dmgTakenMul, 1 - TR(gid).damage_resistance);
  done(g);
});

test('3_12 瑕光 仁慈 (hitSleep): she picks the sleeper over an awake blocked enemy; 沉睡 stays 无敌 for everyone else', () => {
  const id = 'chess_char_3_12_a', t1 = TB(id, 1);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a'), enemy_z: dummy('enemy_z') } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_1_01_a', row: 10, col: 2 }],
    enemies: [{ key: 'enemy_a', pos: [10, 5] }, { key: 'enemy_z', pos: [10, 5] }],
  });
  const u = h.unit(id), sniper = h.unit('chess_char_1_01_a');
  h.step();
  const z = h.enemy('enemy_z');
  assert.ok(h.b.applyStatus(z, 'sleep', { duration: 20 }));
  const t0 = h.b.time;
  h.run(4);
  const mine = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && c.t >= t0);
  assert.ok(mine.length >= 2 && mine.every((c) => c.target === z), '优先攻击沉睡的目标');
  approx(mine[0].amount, u.s.atk * t1.atk_scale, 1e-6, '×atk_scale vs the sleeper');
  assert.ok(!h.hooksOf('damaged').some((c) => c.source === sniper && c.target === z && c.t >= t0), 'others never damage a sleeper');
  done(h);
});

test('3_13 至简: 神工意匠 charges: ATK% arts ×2 per cast; 忽有所悟 crits ×atk_scale; funnel ramp kept', () => {
  const id = 'chess_char_3_13_a', bb = BB(id), t0 = TB(id, 0), tb = TR(id);
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 80, hooks: ['damaged', 'attack'], captureNoisy: true, seed: 3,
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [10, 5] }],
  });
  const u = h.unit(id);
  assert.equal(u.skill.maxCharges, bb.ct);
  h.run(60);
  const normal = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && !c.dmg.isSkill).map((c) => c.amount / u.s.atk);
  const ramp = (v) => [tb.max_atk_scale, tb.max_atk_scale * t0.atk_scale].some((x) => Math.abs(v - x) < 1e-6);
  assert.ok(normal.slice(10).every(ramp), 'ramped drone hits: max or max × crit');
  assert.ok(normal.some((v) => Math.abs(v - tb.max_atk_scale * t0.atk_scale) < 1e-6), 'some crits');
  assert.ok(normal.some((v) => Math.abs(v - tb.max_atk_scale) < 1e-6), 'some plain hits');
  const skillAtks = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length;
  const sk = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isSkill).map((c) => c.amount / u.s.atk);
  assert.ok(skillAtks >= 2);
  assert.equal(sk.length, skillAtks * 2, 'two hits per cast');
  for (const v of sk) assert.ok([bb.atk_scale, bb.atk_scale * t0.atk_scale].some((x) => Math.abs(v - x) < 1e-6), `skill hit ${v}`);
  done(h);
});

test('3_14 初雪: 自然震慑 DEF/RES shred aura; 虚弱化 fragile under 40 % HP; 双响 two targets', () => {
  const id = 'chess_char_3_14_a', bb = BB(id), t0 = TB(id, 0), t1 = TB(id, 1);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a', { def: 500, res: 50 }), enemy_b: dummy('enemy_b', { def: 500 }) } }, timeLimit: 80, hooks: ['attack'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_a', pos: [10, 4] }, { key: 'enemy_b', pos: [10, 5] }],
  });
  const u = h.unit(id);
  h.run(2);
  assert.ok(h.hooksOf('attack').some((c) => c.attacker === u && c.targets.length === t1['attack@max_target']));
  const a = h.enemy('enemy_a'), b = h.enemy('enemy_b');
  b.hp = b.s.maxHp * (t0.hp_ratio - 0.05);
  h.run(0.3);
  approx(b.s.dmgTakenMul, t0.damage_scale);
  approx(a.s.dmgTakenMul, 1, 1e-9);
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.step();
  approx(a.s.def, 500 * (1 + bb.def));
  approx(a.s.res, 50 * (1 + bb.magic_resistance));
  h.runUntil(() => !u.skill.active, 30);
  h.step();
  approx(a.s.def, 500);
  done(h);
});

test('3_15 巫恋: S2 brings the placed 诅咒娃娃 onto its tile, −ATK/DEF around it, gone after its lifetime; 溃败暗示 fragile', () => {
  const id = 'chess_char_3_15_a', bb = BB(id), t0 = TB(id, 0);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a', { def: 200, atk: 100 }), enemy_b: dummy('enemy_b', { def: 200, atk: 100 }) } }, timeLimit: 80,
    units: [{ chessId: id, row: 10, col: 3, uid: 1 }, { kind: 'token', tokenId: 'token_10006_vodfox_doll', ownerUid: 1, row: 10, col: 4, uid: 2 }],
    enemies: [{ key: 'enemy_a', pos: [11, 5] }, { key: 'enemy_b', pos: [10, 5] }],
  });
  const u = h.unit(id);
  h.step();
  const a = h.enemy('enemy_a'), b = h.enemy('enemy_b');
  a.hp = a.s.maxHp * (t0.hp_ratio / 2);
  h.run(0.3);
  approx(a.s.dmgTakenMul, t0.damage_scale);
  const doll = h.unit(2);
  const life = ds.getToken('token_10006_vodfox_doll', id).skill.duration;
  assert.equal(doll.alive, true, 'the placed doll deploys once at the start (PRTS; shared/constants.js SKILL_SUMMON_START_DEPLOY)');
  assert.ok(h.runUntil(() => !doll.alive, life + 1), 'its lifetime');
  h.run(doll.base.respawnTime + 0.1);
  assert.equal(doll.alive, u.skill.activations > 0, 'then only with S2');
  const n0 = u.skill.activations;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === n0 + 1 && doll.alive, 5));
  assert.ok(doll.alive && doll.defId === 'token_10006_vodfox_doll');
  assert.deepEqual([doll.tileR, doll.tileC], [10, 4], 'on the tile the player chose');
  h.run(0.3);
  approx(b.s.def, 200 * (1 + bb.def));
  approx(b.s.atk, 100 * (1 + bb.atk));
  h.run(life);
  assert.equal(doll.alive, false, 'destroyed');
  h.run(0.3);
  approx(b.s.def, 200);
  done(h);
});

test('3_16 蛇屠箱: 壳状防御 stops attacks, block +1, DEF +, regen; 防御专精; 精锐 DEF + while blocking', () => {
  for (const id of ['chess_char_3_16_a', 'chess_char_3_16_b']) {
    const bb = BB(id), t0 = TB(id, 0), tb = TR(id);
    const h = makeBattle({
      defs: { enemies: { enemy_h: dummy('enemy_h', { atk: 300, bat: 1 }) } }, timeLimit: 60,
      units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_h', pos: [10, 4] }],
    });
    const u = h.unit(id);
    h.run(0.5);
    approx(u.s.def, u.base.def * (1 + t0.def + (tb.def ?? 0)));
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const atks = u.stats.attacks;
    approx(u.s.def, u.base.def * (1 + t0.def + (tb.def ?? 0) + bb.def));
    assert.equal(u.s.blockCnt, u.base.blockCnt + bb.block_cnt);
    approx(u.s.hpRegen, u.s.maxHp * bb.hp_recovery_per_sec_by_max_hp_ratio);
    h.run(5);
    assert.equal(u.stats.attacks, atks, '停止攻击');
    done(h);
  }
});

test('3_17 流星: 碎甲击·扩散 hits ≤5 enemies for ATK% + DEF shred; 空射专精 × vs flying (× module fly bonus on 精锐)', () => {
  for (const id of ['chess_char_3_17_a', 'chess_char_3_17_b']) {
    const bb = BB(id), t0 = TB(id, 0), tb = TR(id);
    const tiles = [[10, 4], [10, 5], [11, 4], [11, 5], [9, 4], [9, 5]];
    const h = makeBattle({
      // kit numbers in isolation: 流星's 特质 (garrison_137 / garrison_01 弱点伤害) would re-type the hits by DEF/RES
      defs: { enemies: { enemy_g: dummy('enemy_g', { def: 100 }), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) }, chess: noGarrison(id) }, timeLimit: 60,
      hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_fly', pos: [10, 6], route: 2 }, ...tiles.map((p) => ({ key: 'enemy_g', pos: p }))],
    });
    const u = h.unit(id);
    h.run(1.5);
    const fly = h.hooksOf('damaged').find((c) => c.source === u && c.target.defId === 'enemy_fly' && c.dmg?.isAttack);
    approx(fly.amount, u.s.atk * t0.atk_scale * (tb.atk_scale ?? 1), 1e-6, 'flying target');
    fill(u);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 5));
    const burst = tagged(h, 'burst', u);
    assert.equal(burst.length, 5, 'at most 5 enemies');
    const g = burst.find((c) => c.target.defId === 'enemy_g');
    approx(g.amount, u.s.atk * bb.atk_scale - 100, 1e-6, 'ATK% phys');
    approx(g.target.findBuff('skill:shotst_shred').mods.defPct, bb.def);
    approx(g.target.s.def, 100 * (1 + bb.def));
    h.run(bb.duration + 0.2);
    assert.ok(h.b.enemies.every((e) => !e.findBuff('skill:shotst_shred')), `shred lasts ${bb.duration} s`);
    done(h);
  }
});

test('3_18 忍冬: 隐狐之艺 DP, decaying ASPD, all blocked + stun, camouflage after a kill; 追凶 bonus arts; 蓄势 DP/regen', () => {
  const id = 'chess_char_3_18_a', bb = BB(id), t0 = TB(id, 0), t1 = TB(id, 1);
  const h = makeBattle({
    defs: { enemies: { enemy_h: dummy('enemy_h') } }, timeLimit: 80, hooks: ['damaged', 'attack', 'statusApplied'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_h', pos: [10, 4], count: 2 }], flags: { dpPerSec: 0 },
  });
  const u = h.unit(id);
  h.run(2);
  const hunt = tagged(h, 'vulpisHunt', u);
  assert.ok(hunt.length >= 1, '追凶 on repeated hits');
  approx(hunt[0].amount, u.s.atk * t0.atk_scale);
  const p = h.b.getPlayer('p1');
  const dp0 = p.dp;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(p.dp, dp0 + bb.cost);
  approx(u.s.aspd, u.base.aspd + bb.attack_speed, 0.02);
  h.run(D(id).skill.duration / 2);
  approx(u.s.aspd, u.base.aspd + bb.attack_speed / 2, 0.03, 'decays linearly');
  assert.ok(h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill && c.targets.length === 2), 'hits every blocked enemy');
  assert.ok(h.hooksOf('statusApplied').some((c) => c.source === u && c.status === 'stun' && Math.abs(c.duration - bb['attack@stun']) < 1e-9));
  h.runUntil(() => !u.skill.active, 20);
  assert.ok(!u.s.flags.camou, 'no kill ⇒ no camouflage');
  done(h);

  const c = makeBattle({
    defs: { enemies: { enemy_f: dummy('enemy_f', { hp: 1 }) } }, timeLimit: 60, autoFinish: false,
    units: [{ chessId: id, row: 10, col: 4 }],
  });
  const z = c.unit(id);
  c.step();
  fill(z);
  c.spawn('enemy_f', { pos: [10, 5] });
  assert.ok(c.runUntil(() => z.skill.active, 5));
  c.runUntil(() => !z.skill.active, 20);
  assert.ok(z.s.flags.camou && !z.s.flags.stealth, 'camouflage (迷彩, not 隐匿) after a kill during the skill');
  fill(z);
  c.spawn('enemy_f', { pos: [10, 5] });
  assert.ok(c.runUntil(() => z.skill.activations === 2, 5));
  assert.ok(!z.s.flags.camou, 'until the next cast');
  done(c);

  const q = makeBattle({ units: [{ chessId: id, row: 10, col: 4 }], timeLimit: 30 });
  const v = q.unit(id);
  q.run(5);
  approx(q.b.getPlayer('p1').dp, 10 + 5 * t1.delta_cost_increase_time, 0.01, '蓄势 DP regen');
  assert.ok(v.findBuff('talent:vulpis_regen'), 'regen after 4 s without damage');
  approx(v.s.hpRegen, v.s.maxHp * t1['vulpis_t_2[heal][interval].hp_recovery_per_sec_by_max_hp_ratio']);
  q.b.dealDamage(null, v, { type: 'true', amount: 10 });
  q.step();
  assert.equal(v.findBuff('talent:vulpis_regen'), null);
  done(q);
});

test('3_19 伺夜: wolf pack (2 → 3 wolves, block/bites, lose a wolf instead of dying), DEF ignore, ×trait; 领袖的尊严 DP/3 hits/bonus', () => {
  const id = 'chess_char_3_19_a', bb = BB(id), t1 = TB(id, 1), tb = TR(id);
  const h = makeBattle({
    // kit numbers in isolation: 伺夜's 特质 (garrison_152/153/01 弱点伤害) would turn these phys hits into arts (RES 0)
    // the pack takes the tactical point (Battle.findTacticalPoint): the flat stage’s enemy path tile (9,3) in range
    defs: { enemies: { enemy_d: dummy('enemy_d', { def: 300 }) }, chess: noGarrison(id) }, timeLimit: 120, hooks: ['damaged', 'attack'], captureNoisy: true, flags: { dpPerSec: 0 },
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [9, 3], time: 0.5 }],
  });
  const u = h.unit(id);
  h.step();
  const w = u.trait.reinforcement;
  assert.ok(w && w.alive && w.defId === 'token_10028_vigil_wolf', 'pack summoned on the tactical point');
  assert.equal(w.mem.wolves, 2);
  assert.equal(w.s.blockCnt, 2);
  h.run(3);
  const e = h.enemy('enemy_d');
  assert.equal(e.blockedBy, w);
  const mine = h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && c.dmg?.isAttack);
  approx(mine[0].amount, u.s.atk * tb.atk_scale - (300 - t1.def_penetrate_fixed), 1e-6, 'trait × and 狼群天性');
  const bites = h.hooksOf('attack').filter((c) => c.attacker === w).length;
  const wd = h.hooksOf('damaged').filter((c) => c.source === w && c.dmg?.isAttack);
  assert.equal(wd.length, bites * 2, 'one bite per wolf');
  approx(wd[0].amount, w.s.atk - (300 - t1.def_penetrate_fixed));
  approx(h.b.dealDamage(u, e, { amount: 1000, type: 'phys' }), 1000 - 300, 1e-6, '狼群天性: attacks only (a non-attack hit keeps the full DEF)');
  const p = h.b.getPlayer('p1');
  const dp0 = p.dp;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.run(2);
  const sAtk = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length;
  const sHit = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack && c.dmg.isSkill).length;
  assert.equal(sHit, sAtk * 3, '三连击');
  const bonus = tagged(h, 'vigilBonus', u);
  assert.ok(bonus.length >= sHit);
  approx(bonus[0].amount, u.s.atk * bb['attack@vigil_s_3.atk_scale']);
  const packBonus = tagged(h, 'vigilBonus', w);
  assert.ok(packBonus.length >= 2, 'each bite on a pack-blocked enemy adds the bonus, dealt by the pack');
  approx(packBonus[0].amount, u.s.atk * bb['attack@vigil_s_3.atk_scale'], 1e-6, 'sized on 伺夜 ATK');
  h.runUntil(() => !u.skill.active, 20);
  approx(p.dp, dp0 + bb.value, 1e-6, 'DP over the skill');
  h.runUntil(() => w.mem.wolves === 3, 30);
  assert.equal(w.s.blockCnt, 3);
  h.b.dealDamage(null, w, { type: 'true', amount: 1e7 });
  assert.equal(w.alive, true);
  assert.equal(w.mem.wolves, 2);
  approx(w.hp, w.s.maxHp);
  done(h);

  const gid = 'chess_char_3_19_b';
  const g = makeBattle({
    defs: { enemies: { enemy_h: dummy('enemy_h', { atk: 400, bat: 1 }) } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true, flags: { dpPerSec: 0 },
    units: [{ chessId: gid, row: 10, col: 3 }], enemies: [{ key: 'enemy_h', pos: [9, 3], time: 0.5 }],
  });
  const v = g.unit(gid);
  g.run(3);
  const gw = v.trait.reinforcement;
  const taken = g.hooksOf('damaged').filter((c) => c.target === gw && c.source?.defId === 'enemy_h');
  const scale = ds.getToken('token_10028_vigil_wolf', gid).talents.find((t) => t.bb.damage_scale != null).bb.damage_scale;
  approx(taken[0].amount, (400 - gw.s.def) * scale, 1e-6, 'module: less damage from blocked enemies');
  const gp = g.b.getPlayer('p1');
  const gdp = gp.dp;
  fill(v);
  assert.ok(g.runUntil(() => v.skill.active, 5));
  g.runUntil(() => !v.skill.active, 20);
  approx(gp.dp, gdp + BB(gid).value, 1e-6, '精锐 DP over the full duration');
  g.b.dealDamage(null, gw, { type: 'true', amount: 1e7 });
  g.b.dealDamage(null, gw, { type: 'true', amount: 1e7 });
  assert.equal(gw.alive, false);
  g.run(gw.base.respawnTime + 0.5);
  assert.ok(v.trait.reinforcement !== gw && v.trait.reinforcement?.alive, 'pack re-summoned after its respawn time');
  done(g);
});

test('3_17 流星 / 3_19 伺夜 with their 特质 弱点伤害: kit damage is re-typed by the garrison, which sees the kit’s DEF ignore', () => {
  // 流星: the 碎甲击 burst (phys) vs DEF 100 / RES 0 becomes arts at full ATK% (the DEF shred still lands)
  const sid = 'chess_char_3_17_a', sbb = BB(sid);
  assert.ok(ds.rawChess(sid).garrisonIds.includes('garrison_01_a'), 'real data: 流星 carries 弱点伤害');
  const h = makeBattle({
    defs: { enemies: { enemy_g: dummy('enemy_g', { def: 100 }) } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: sid, row: 10, col: 3 }], enemies: [{ key: 'enemy_g', pos: [10, 5] }],
  });
  const u = h.unit(sid);
  h.step();
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === 1, 5));
  const b0 = tagged(h, 'burst', u)[0];
  assert.equal(b0.type, 'arts');
  approx(b0.amount, u.s.atk * sbb.atk_scale, 1e-6, 'weakness burst');
  assert.ok(b0.target.findBuff('skill:shotst_shred'));
  done(h);
  // 伺夜: vs DEF 300 / RES 40, phys after 狼群天性 (A − 125) beats arts (0.6 A) — only if the garrison sees the ignore
  const vid = 'chess_char_3_19_a', t1 = TB(vid, 1), tb = TR(vid);
  assert.ok(ds.rawChess(vid).garrisonIds.includes('garrison_01_a'), 'real data: 伺夜 carries 弱点伤害');
  const g = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d', { def: 300, res: 40 }) } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true, flags: { dpPerSec: 0 },
    units: [{ chessId: vid, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [9, 3], time: 0.5 }],
  });
  const v = g.unit(vid);
  g.run(3);
  const e = g.enemy('enemy_d');
  assert.equal(e.blockedBy, v.trait.reinforcement);
  const mine = g.hooksOf('damaged').filter((c) => c.source === v && c.target === e && c.dmg?.isAttack);
  assert.ok(mine.length > 0);
  const A = v.s.atk * tb.atk_scale;
  assert.ok(A - (300 - t1.def_penetrate_fixed) > A * 0.6 && A - 300 < A * 0.6, 'the scenario discriminates');
  assert.equal(mine[0].type, 'phys');
  approx(mine[0].amount, A - (300 - t1.def_penetrate_fixed), 1e-6, 'phys with the pack DEF ignore');
  done(g);
});

test('3_20 耶拉: 低眉 ATK (ground tiles in range); 心随意动 +1 drone, ATK +, cold procs; per-target drone ramp', () => {
  const id = 'chess_char_3_20_a', bb = BB(id), t0 = TB(id, 0);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a'), enemy_b: dummy('enemy_b') } }, timeLimit: 120, hooks: ['damaged', 'attack', 'statusApplied'], captureNoisy: true, seed: 2,
    units: [{ chessId: id, row: 10, col: 2 }], enemies: [{ key: 'enemy_a', pos: [10, 4] }, { key: 'enemy_b', pos: [11, 4] }],
  });
  const u = h.unit(id);
  h.step();
  approx(u.s.atk, u.base.atk * (1 + t0['kjera_t_1[high].atk']));
  h.run(4);
  const first = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack).map((c) => c.amount / u.s.atk);
  assert.ok(first[1] > first[0], 'drone ramps on the same target');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  approx(u.s.atk, u.base.atk * (1 + t0['kjera_t_1[high].atk'] + bb.atk));
  h.runUntil(() => !u.skill.active, 30);
  const sk = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
  assert.ok(sk.length > 5 && sk.every((c) => c.targets.length === 1 + bb['attack@cnt']), 'two drone locks');
  const colds = h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'cold');
  assert.ok(colds.length >= 1 && colds.length < sk.length * 2, `cold procs (${colds.length}/${sk.length * 2})`);
  approx(colds[0].duration, bb['attack@cold']);
  done(h);
});

test('3_21 空弦: 箭矢·暴风 3 hits × 2 targets, range +1; 铁弦 shield → +SP; 兰登战术 sniper SP; 精锐 ASPD vs ground', () => {
  const id = 'chess_char_3_21_a', bb = BB(id), t0 = TB(id, 0), t1 = TB(id, 1);
  const h = makeBattle({
    defs: { enemies: { enemy_h: dummy('enemy_h', { atk: 100, bat: 1 }), enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['spGain', 'attack', 'damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_3_17_a', row: 12, col: 3 }],
    enemies: [{ key: 'enemy_h', pos: [10, 3], time: 1 }, { key: 'enemy_d', pos: [10, 5] }],
  });
  const u = h.unit(id), met = h.unit('chess_char_3_17_a');
  h.step();
  assert.ok(u.findBuff('talent:archet_shield'));
  h.run(3);
  assert.equal(u.findBuff('talent:archet_shield'), null, 'shield broken');
  assert.ok(h.hooksOf('spGain').some((c) => c.unit === u && c.reason === 'talent' && c.amount === t1.sp), '+SP when it breaks');
  const tact = h.hooksOf('spGain').filter((c) => c.unit === met && c.reason === 'talent');
  assert.ok(tact.length >= 1 && tact[0].amount === t0.sp, '兰登战术 on an attack-SP sniper');
  approx(tact[0].t % t0.interval, 0, 0.05);
  const wide = u.rangeKeys.length;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const p = effectiveProfile(u);
  assert.equal(p.hits, bb['attack@times']);
  assert.equal(p.maxTargets, bb['attack@max_target']);
  assert.ok(u.rangeKeys.length > wide, 'range +1');
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  h.run(2);
  assert.ok(h.hooksOf('attack').some((c) => c.attacker === u && c.isSkill && c.targets.length === 2));
  done(h);

  const gid = 'chess_char_3_21_b';
  const mod = D(gid).raw.talents.find((t) => t.hidden && t.fromModule).bb;
  const g = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 30,
    units: [{ chessId: gid, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [10, 5], time: 2 }],
  });
  const v = g.unit(gid);
  g.run(1);
  approx(v.s.aspd, v.base.aspd);
  g.run(1.5);
  approx(v.s.aspd, v.base.aspd + mod.attack_speed, 1e-6, 'ground enemy in range');
  done(g);
});

// ---------------------------------------------------------------------------------------------------------------
// verification pass: text fidelity fixes, board-piece summons, tile hygiene, 精锐 numbers, every variant casts

test('3_02 断崖: 浮游刃 blades hit enemies blocked by the allies around her, never the ones she blocks herself', () => {
  const id = 'chess_char_3_02_b', bb = BB(id);
  const h = makeBattle({
    defs: { enemies: { enemy_own: dummy('enemy_own'), enemy_ally: dummy('enemy_ally') } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 11, col: 4 }],
    enemies: [{ key: 'enemy_own', pos: [10, 4] }, { key: 'enemy_ally', pos: [11, 4] }],
  });
  const u = h.unit(id);
  h.run(0.5);
  assert.equal(h.enemy('enemy_own').blockedBy, u);
  assert.equal(h.enemy('enemy_ally').blockedBy, h.unit('chess_char_3_16_a'));
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 10));
  h.run(4);
  const blades = tagged(h, 'ayerBlade', u);
  assert.ok(blades.length >= 2);
  assert.ok(blades.every((c) => c.target.defId === 'enemy_ally'), 'only the adjacent ally’s blocked enemy');
  approx(blades[0].amount, u.s.atk * bb.atk_scale);
  done(h);
});

test('3_04 琳琅诗怀雅 精锐: MER-X drain, coin cap, armed bomb hits twice; bombs never land on a dead operator’s tile', () => {
  const gid = 'chess_char_3_04_b', bb = BB(gid), t0 = TB(gid, 0), tb = TR(gid);
  // drain + coin cap (no enemy: no attack spends a coin)
  const q = makeBattle({ units: [{ chessId: gid, row: 9, col: 5 }], timeLimit: 60, flags: { dpPerSec: 0 } });
  const s = q.unit(gid);
  q.step();
  q.b.getPlayer('p1').dp = 50;
  q.run(3.1);
  approx(q.b.getPlayer('p1').dp, 50 - Math.abs(tb.cost), 1e-6, 'module: 2 DP per payment');
  q.run(tb.interval * (bb.sp + 1));
  const paid = Math.floor((q.b.time + 1e-9) / tb.interval);
  assert.equal(s.mem.coins, bb.sp, 'coin cap = bb.sp');
  assert.equal(s.findBuff('talent:swire2_buyer').stacks, Math.min(t0.max_stack_cnt, paid), 'ATK stack per payment (coins capped, stacks not)');
  done(q);

  // a bomb that stayed duration_switch s on the field hits twice
  const booms = [];
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d'), enemy_w: enemyRec({ key: 'enemy_w', hp: 1e6, speed: 1, def: 0, atk: 0 }) } }, timeLimit: 60,
    units: [{ chessId: gid, row: 9, col: 5 }], enemies: [{ key: 'enemy_d', pos: [9, 5] }, { key: 'enemy_w', route: 0, time: 1 }],
    setup: (b) => b.on('damaged', (c) => { if (c.dmg?.tags?.includes('trap')) booms.push({ target: c.target.defId, amount: c.amount, atk: c.source.s.atk, t: b.time }); }),
  });
  const u = h.unit(gid);
  const switchT = ds.getToken('token_10031_swire2_gdtrap', gid).skill.bb.duration_switch;
  assert.ok(h.runUntil(() => h.b.allyUnits.some((t) => t.alive && t.defId === 'token_10031_swire2_gdtrap'), 5), 'bomb placed in front of her');
  const bomb = h.b.allyUnits.find((t) => t.alive && t.defId === 'token_10031_swire2_gdtrap');
  assert.deepEqual([bomb.tileR, bomb.tileC], [9, 6]);
  assert.ok(h.runUntil(() => booms.length > 0, 30), 'the walker triggered it');
  assert.ok(booms[0].t - bomb.deployedAt >= switchT);
  assert.equal(booms.length, 2, 'armed bomb: one extra hit');
  for (const b of booms) { assert.equal(b.target, 'enemy_w'); approx(b.amount, b.atk * bb.atk_scale); }
  assert.ok(h.enemy('enemy_w').findBuff('sluggish'));
  done(h);

  // the tile in front belongs to a dead operator waiting to redeploy: no bomb there (no coin spent)
  const k = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 30,
    units: [{ chessId: gid, row: 9, col: 5 }, { chessId: 'chess_char_3_16_a', row: 9, col: 6 }], enemies: [{ key: 'enemy_d', pos: [9, 5], time: 0.5 }],
  });
  const v = k.unit(gid), cu = k.unit('chess_char_3_16_a');
  k.step();
  k.b.dealDamage(null, cu, { type: 'true', amount: 1e7 });
  assert.equal(cu.alive, false);
  const coins = v.mem.coins;
  k.run(5);
  assert.ok(v.stats.attacks >= 2, 'she kept attacking');
  assert.equal(k.b.allyUnits.filter((t) => t.defId === 'token_10031_swire2_gdtrap').length, 0, 'no bomb on the dead operator’s tile');
  assert.ok(v.mem.coins >= coins, 'no coin spent');
  done(k);
});

test('3_07 见行者: 惊爆射击 fires on an enemy inside the skill range only; 精锐 refund only on a ranged tile', () => {
  const id = 'chess_char_3_07_a', bb = BB(id);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a', { mass: 1 }) } }, timeLimit: 30, hooks: ['statusApplied'],
    units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_a', pos: [10, 6] }],
  });
  const u = h.unit(id);
  h.step();
  const e = h.enemy('enemy_a');
  assert.equal(h.b.enemiesInKeys(u.baseRangeKeys, u, u.profile).length, 0, 'outside her attack range');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === 1, 2), 'skill range (3 tiles ahead) triggers it');
  assert.ok(e.x > 6.9, `pushed (${e.x})`);
  approx(h.hooksOf('statusApplied').find((s) => s.target === e && s.status === 'stun').duration, bb['forcer_s_2[hit_directly].stun']);
  done(h);

  const gid = 'chess_char_3_07_b';
  const r = makeBattle({ units: [{ chessId: gid, row: 10, col: 4 }], timeLimit: 30, flags: { dpPerSec: 0 } });
  const g = r.unit(gid);
  r.step();
  assert.equal(g.ground, true);
  r.b.dealDamage(null, g, { type: 'true', amount: 1e7 });
  const p = r.b.getPlayer('p1');
  p.dp = 50;
  assert.ok(r.b.redeploy(g, { free: false }));
  approx(p.dp, 50 - g.base.cost, 1e-6, 'ground tile: no refund');
  done(r);
});

test('3_10 松果: 电能过载 opens only once an enemy stands inside the shortened skill range', () => {
  const id = 'chess_char_3_10_a';
  const h = makeBattle({
    defs: { enemies: { enemy_far: dummy('enemy_far'), enemy_near: dummy('enemy_near') } }, timeLimit: 60, autoFinish: false,
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'enemy_far', pos: [10, 5] }],
  });
  const u = h.unit(id);
  h.step();
  fill(u);
  h.run(3);
  assert.ok(u.stats.attacks > 0, 'attacks the enemy two tiles ahead');
  assert.equal(u.skill.activations, 0, 'not inside the 1-3 skill range');
  h.spawn('enemy_near', { pos: [10, 4] });
  assert.ok(h.runUntil(() => u.skill.active, 1));
  done(h);
});

test('3_15 巫恋: the doll placed in the prep phase deploys at the start, then waits for S2 and is the one doll (each cast brings it back); 精锐 −30 %', () => {
  const gid = 'chess_char_3_15_b', bb = BB(gid);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a', { def: 200, atk: 100 }), enemy_b: dummy('enemy_b', { def: 200, atk: 100 }) } }, timeLimit: 120,
    units: [{ chessId: gid, row: 10, col: 3, uid: 1 }, { kind: 'token', tokenId: 'token_10006_vodfox_doll', ownerUid: 1, row: 10, col: 5, uid: 2 },
      { chessId: 'chess_char_3_16_a', row: 11, col: 4, uid: 3 }],
    enemies: [{ key: 'enemy_a', pos: [12, 4] }, { key: 'enemy_b', pos: [11, 5] }],
  });
  const u = h.unit(1), piece = h.unit(2);
  h.step();
  assert.ok(piece.alive && piece.ownerUnit === u, 'the board doll deploys once at the start');
  assert.ok(h.runUntil(() => !piece.alive, 20), 'its lifetime');
  h.run(piece.base.respawnTime + 0.1);
  const n0 = u.skill.activations;
  assert.equal(piece.alive, n0 > 0, 'then only with the skill');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === n0 + 1 && piece.alive, 5));
  const dolls = () => h.b.allyUnits.filter((t) => t.alive && t.defId === 'token_10006_vodfox_doll');
  assert.equal(dolls().length, 1, 'one doll');
  assert.equal(dolls()[0], piece, 'the prep-phase piece itself');
  assert.deepEqual([piece.tileR, piece.tileC], [10, 5]);
  h.run(0.3);
  const b = h.enemy('enemy_b');
  approx(b.s.def, 200 * (1 + bb.def));
  assert.equal(b.findBuff('token:curseDoll').mods.atkPct, bb.atk, 'ATK −30 % (her module weaken stacks on top)');
  // gone after its lifetime, back on the same tile with the next cast
  assert.ok(h.runUntil(() => !piece.alive, 20));
  const gone = h.b.time;
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === n0 + 2, 5));
  // the doll's redeploy time (data respawnTime 5 s) runs from the moment it left
  assert.ok(h.runUntil(() => piece.alive, 6));
  assert.ok(h.b.time - gone >= piece.base.respawnTime - 1e-6, 'after its redeploy time');
  assert.ok(piece.tileR === 10 && piece.tileC === 5, 'the next cast: the same tile');
  assert.equal(dolls().length, 1);
  done(h);
});

test('3_19 伺夜: the pack never takes a later board unit’s tile; a 狼群 piece placed in prep IS the pack (single effects)', () => {
  const id = 'chess_char_3_19_a', bb = BB(id), t1 = TB(id, 1);
  const a = makeBattle({ units: [{ chessId: id, row: 12, col: 3 }, { chessId: 'chess_char_3_16_a', row: 12, col: 4 }], timeLimit: 20 });
  a.step();
  const cu = a.unit('chess_char_3_16_a'), w0 = a.unit(id).trait.reinforcement;
  assert.ok(cu.deployed && cu.tileR === 12 && cu.tileC === 4, '蛇屠箱 deployed on its own tile');
  assert.ok(w0 && w0.alive && !(w0.tileR === 12 && w0.tileC === 4));
  done(a);

  // the piece sits lower on the board than 伺夜 (deploys after him): it is deployed early, no second pack
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d', { def: 300 }) } }, timeLimit: 60, hooks: ['damaged'], captureNoisy: true, flags: { dpPerSec: 0 },
    units: [{ chessId: id, row: 12, col: 3, uid: 1 }, { kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 11, col: 5, uid: 2 }],
    enemies: [{ key: 'enemy_d', pos: [11, 5], time: 0.5 }],
  });
  const u = h.unit(1), piece = h.unit(2);
  h.step();
  const packs = h.b.allyUnits.filter((t) => t.alive && t.defId === 'token_10028_vigil_wolf');
  assert.equal(packs.length, 1, 'one pack');
  assert.equal(packs[0], piece);
  assert.equal(u.trait.reinforcement, piece);
  assert.deepEqual([piece.tileR, piece.tileC], [11, 5], 'on the tactical point the player chose');
  h.run(3);
  const e = h.enemy('enemy_d');
  assert.equal(e.blockedBy, piece);
  const bite = h.hooksOf('damaged').find((c) => c.source === piece && c.dmg?.isAttack);
  approx(bite.amount, piece.s.atk - (300 - t1.def_penetrate_fixed), 1e-6, '狼群天性 applied once');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const n0 = h.hooksOf('damaged').length;
  h.run(3);
  const later = h.hooksOf('damaged').slice(n0);
  const hits = later.filter((c) => (c.source === piece || c.source === u) && c.dmg?.isAttack && c.target === e).length;
  const bonus = later.filter((c) => c.target === e && c.type === 'arts' && (c.dmg?.tags?.includes('vigilBonus') || c.dmg?.tags?.includes('vigil')));
  assert.ok(hits > 0);
  assert.equal(bonus.length, hits, 'one S3 bonus per damage instance');
  approx(bonus[0].amount, u.s.atk * bb['attack@vigil_s_3.atk_scale']);
  done(h);
});

test('3_20 耶拉: 心随意动 with a single enemy — both drones lock it and ramp in parallel', () => {
  const id = 'chess_char_3_20_b', bb = BB(id), tb = TR(id);
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a') } }, timeLimit: 80, hooks: ['damaged', 'attack'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 2 }], enemies: [{ key: 'enemy_a', pos: [10, 4] }],
  });
  const u = h.unit(id);
  h.run(12);
  const plain = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack).map((c) => c.amount / u.s.atk);
  approx(plain[plain.length - 1], tb.max_atk_scale, 1e-6, 'module ramp cap');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  const n0 = h.hooksOf('damaged').length;
  h.run(8);
  const sk = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
  assert.ok(sk.length >= 3 && sk.every((c) => c.targets.length === 1 + bb['attack@cnt'] && c.targets.every((t) => t.defId === 'enemy_a')));
  const hits = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u && c.dmg?.isAttack);
  assert.ok(hits.length >= 2 * (sk.length - 1));
  for (let i = 0; i + 1 < hits.length; i += 2) approx(hits[i].amount, hits[i + 1].amount, 1e-9, 'same volley, same scale');
  done(h);
});

test('精锐 numbers from the golden blackboards (module traits handled by the profession layer)', () => {
  // 能天使 MAR-X: ×1.1 vs flying (no skill); 诗怀雅 INS-X ×1.3 vs unblocked + 协同作战 ×2.7 aura
  const e1 = 'chess_char_3_01_b';
  const f = makeBattle({
    defs: { enemies: { enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) } }, timeLimit: 20, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: e1, row: 10, col: 3 }], enemies: [{ key: 'enemy_fly', pos: [10, 5], route: 2 }],
  });
  const a = f.unit(e1);
  f.run(1.5);
  const fly = f.hooksOf('damaged').find((c) => c.source === a && c.dmg?.isAttack && !c.dmg.isSkill);
  approx(fly.amount, a.s.atk * TR(e1).atk_scale);
  done(f);

  const e3 = 'chess_char_3_03_b';
  const s = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: e3, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 11, col: 4 }, { chessId: 'chess_char_3_16_a', row: 10, col: 5 }],
    enemies: [{ key: 'enemy_d', pos: [10, 5] }],
  });
  const sw = s.unit(e3), mate = s.unit(2);
  s.run(1.5);
  const hit = s.hooksOf('damaged').filter((c) => c.source === sw && c.dmg?.isAttack).pop();
  approx(hit.amount, sw.s.atk * TR(e3).atk_scale, 1e-6, 'enemy blocked by the ally in front, not by her');
  fill(sw);
  assert.ok(s.runUntil(() => sw.skill.active, 10));
  s.step();
  approx(mate.s.atk, mate.base.atk * (1 + TB(e3, 0).atk * BB(e3).talent_scale));
  done(s);

  // 海霓 / 初雪 UMD-X: 10 % weaken for 2 s on hit
  for (const gid of ['chess_char_3_09_b', 'chess_char_3_14_b']) {
    const w = makeBattle({
      defs: { enemies: { enemy_d: dummy('enemy_d', { atk: 200 }) } }, timeLimit: 20, hooks: ['statusApplied'],
      units: [{ chessId: gid, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [10, 4] }],
    });
    const x = w.unit(gid);
    w.step();
    assert.ok(w.runUntil(() => w.enemy('enemy_d').findBuff('weaken'), 5), `${gid} weakens`);
    approx(w.enemy('enemy_d').s.atk, 200 * (1 + TR(gid).atk));
    approx(w.hooksOf('statusApplied').find((c) => c.status === 'weaken' && c.source === x).duration, TR(gid).duration);
    done(w);
  }

  // 松果 RPR-X ×1.6 on the front row; 至简 FUN-Y ramp cap 1.2 and 3 charges
  const e10 = 'chess_char_3_10_b';
  const p = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 20, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: e10, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [10, 4] }],
  });
  const pc = p.unit(e10);
  p.run(3);
  const ph = p.hooksOf('damaged').find((c) => c.source === pc && c.dmg?.isAttack && !c.dmg.isSkill);
  approx(ph.amount, pc.s.atk * TR(e10).atk_scale);
  done(p);
  const e13 = 'chess_char_3_13_b';
  const m = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true, seed: 5,
    units: [{ chessId: e13, row: 10, col: 3 }], enemies: [{ key: 'enemy_d', pos: [10, 5] }],
  });
  const ml = m.unit(e13);
  assert.equal(ml.skill.maxCharges, BB(e13).ct);
  m.run(25);
  const ramps = m.hooksOf('damaged').filter((c) => c.source === ml && c.dmg?.isAttack && !c.dmg.isSkill).map((c) => c.amount / ml.s.atk);
  assert.ok(ramps.some((v) => Math.abs(v - TR(e13).max_atk_scale) < 1e-6), 'module cap 120 %');
  assert.ok(ramps.every((v) => v <= TR(e13).max_atk_scale * TB(e13, 0).atk_scale + 1e-6));
  done(m);

  // 瑕光 精锐 heal; 忍冬 SOL-X ATK/DEF while blocking
  const e12 = 'chess_char_3_12_b';
  const g = makeBattle({
    defs: { enemies: { enemy_h: dummy('enemy_h', { atk: 50, bat: 2 }) } }, timeLimit: 30, hooks: ['heal'], captureNoisy: true,
    units: [{ chessId: e12, row: 10, col: 4 }, { chessId: 'chess_char_3_16_a', row: 11, col: 4 }, { chessId: 'chess_char_3_16_b', row: 12, col: 7 }],
    enemies: [{ key: 'enemy_h', pos: [10, 4] }],
  });
  const bl = g.unit(e12), near = g.unit('chess_char_3_16_a'), far = g.unit('chess_char_3_16_b');
  g.step();
  near.hp = near.s.maxHp * 0.3;
  far.hp = far.s.maxHp * 0.1;
  fill(bl);
  assert.ok(g.runUntil(() => bl.skill.active, 5));
  g.run(3);
  const heals = g.hooksOf('heal').filter((c) => c.source === bl);
  assert.ok(heals.length >= 1 && heals.every((c) => c.target === near), 'the heal stays inside the skill range');
  approx(heals[0].amount, bl.s.atk * BB(e12).heal_scale);
  done(g);
  const e18 = 'chess_char_3_18_b';
  const v = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 20, units: [{ chessId: e18, row: 10, col: 4 }], enemies: [{ key: 'enemy_d', pos: [10, 4], time: 1 }],
  });
  const vu = v.unit(e18);
  v.run(0.5);
  approx(vu.s.atk, vu.base.atk);
  v.run(1);
  approx(vu.s.atk, vu.base.atk * (1 + TR(e18).atk));
  approx(vu.s.def, vu.base.def * (1 + TR(e18).def));
  done(v);
});

test('忍冬 迷彩: after a kill during 隐狐之艺 ranged enemies stop targeting her until the next cast', () => {
  const id = 'chess_char_3_18_a';
  const h = makeBattle({
    defs: { enemies: { enemy_f: dummy('enemy_f', { hp: 1 }), enemy_r: dummy('enemy_r', { atk: 100, range: 3, applyWay: 'RANGED', bat: 1 }) } }, timeLimit: 60, autoFinish: false,
    hooks: ['damaged'], captureNoisy: true, units: [{ chessId: id, row: 10, col: 4 }],
  });
  const u = h.unit(id);
  h.step();
  fill(u);
  h.spawn('enemy_f', { pos: [10, 5] });
  assert.ok(h.runUntil(() => u.skill.active, 5));
  h.runUntil(() => !u.skill.active, 20);
  assert.ok(u.s.flags.camou);
  h.spawn('enemy_r', { pos: [11, 6] });
  h.run(4);
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === u && c.source?.defId === 'enemy_r').length, 0, 'not targeted while camouflaged');
  done(h);
});

test('every tier-3 variant (normal + 精锐) fights and casts in a real battle without content errors', () => {
  const ids = ds.chessIds().filter((id) => /^chess_char_3_\d+_[ab]$/.test(id)).sort();
  assert.equal(ids.length, 42);
  for (const id of ids) {
    const melee = D(id).position === 'MELEE';
    const h = makeBattle({
      defs: { enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 2e4, speed: 1, def: 100, res: 10, atk: 200, bat: 1.5 }), enemy_fl: enemyRec({ key: 'enemy_fl', hp: 5000, speed: 1, motion: 'FLY', atk: 50 }) } },
      timeLimit: 25, seed: 11, autoFinish: false,
      units: [{ chessId: id, row: melee ? 9 : 10, col: 6 }],
      enemies: [{ key: 'enemy_w', route: 0, count: 4, interval: 3 }, { key: 'enemy_fl', route: 2, time: 2 }],
    });
    const u = h.unit(id);
    for (let t = 0; t < 20; t++) { h.run(1); if (t % 5 === 1 && u.alive && u.skill.kind !== 'passive') u.skill.gainSp(u.skill.spCost, 'test'); }
    if (u.skill.kind === 'passive') assert.ok(u.skill.active, `${id} passive on`);
    else assert.ok(u.skill.activations >= 1, `${id} cast (${u.skill.activations})`);
    assert.ok(u.stats.dmg > 0 || u.skill.spec.attack?.noAttack, `${id} dealt damage`);
    done(h);
  }
});

test('忍冬 追凶 never feeds on itself: a hit turned into HP loss credited to her (频次-style enemy) adds one bonus, no recursion', () => {
  const id = 'chess_char_3_18_a';
  const h = makeBattle({
    defs: { enemies: { enemy_times: dummy('enemy_times', { hp: 1000 }) } }, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'enemy_times', pos: [10, 5] }],
    // every phys/arts instance on this enemy is cancelled and replaced by 1 HP of HP loss credited to the attacker
    setup: (b) => b.on('hit', (c) => {
      if (c.target.defId === 'enemy_times' && (c.dmg.type === 'phys' || c.dmg.type === 'arts')) { c.dmg.cancel = true; b.loseHp(c.target, 1, { source: c.source }); }
    }, { priority: 100 }),
  });
  const u = h.unit(id);
  h.run(5);
  const e = h.enemy('enemy_times');
  const atks = u.stats.attacks;
  assert.ok(atks >= 3);
  // first attack marks the enemy (1 HP), every later attack: 1 HP + one 追凶 bonus instance (1 HP)
  assert.equal(e.s.maxHp - e.hp, 1 + 2 * (atks - 1));
  done(h);
});
