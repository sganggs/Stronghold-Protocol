// test/content/enemies_bosses.test.js — enemy special types / abilities (content/enemies.js) and scripted leaders
// (content/bosses.js). Every authored enemy / leader / part has at least one real battle asserting its signature effect.
// Battles run with content 'generic' (no domain modules) + extraContent [enemies, bosses] so other content modules never
// interfere (injected kits are honoured, unlike content 'none'); allies are
// synthetic (t_wall: blocks, never attacks; t_gun / t_mage: instant long-range phys / arts; t_blade: melee).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { spawnYanyou } from '../../server/sim/content/tokens.js';
import { attackWindup } from '../../server/sim/ai.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
const { KITS, STATS_ONLY, EROSION, EROSION_BURST } = enemiesMod;
const { BOSS_KITS, PART_TRANSFER, BLADE_TRANSFER, DRONE_LINK_BASE, droneLinkBase } = bossesMod;
const { HUSK_REBIRTH, TRANSLATOR_CHANGE } = enemiesMod;

const BIG = [];
for (let dr = -4; dr <= 4; dr++) for (let dc = -12; dc <= 12; dc++) BIG.push([dr, dc]);
const WALL = (id, o = {}) => chessRec({ id, profession: 'TANK', stats: { atk: o.atk ?? 0, maxHp: 1e7, def: o.def ?? 0, res: o.res ?? 0, blockCnt: o.block ?? 3, ...o.stats }, rangeGrid: [[0, 0]], skill: null });
const CHESS = {
  t_wall: WALL('t_wall'), t_wall2: WALL('t_wall2'), t_wall3: WALL('t_wall3'), t_wall4: WALL('t_wall4'),
  t_gun: chessRec({ id: 't_gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 50, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: BIG, skill: null }),
  t_mage: chessRec({ id: 't_mage', profession: 'CASTER', projectile: 'none', stats: { atk: 50, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: BIG, skill: null }),
  t_blade: chessRec({ id: 't_blade', profession: 'WARRIOR', stats: { atk: 50, maxHp: 1e7, bat: 1, blockCnt: 1 }, rangeGrid: [[0, 0], [0, 1]], skill: null }),
};
const NOATK = () => ({ trait: { noAttack: true } });
const KITSIN = { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK, t_wall4: NOATK };

function arena(o = {}) {
  const { chess = {}, kits = {}, enemies = [], ...rest } = o;
  return makeBattle({
    content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 600,
    defs: { chess: { ...CHESS, ...chess } }, kits: { ...KITSIN, ...kits }, enemies, captureNoisy: !!o.captureNoisy, ...rest,
  });
}
const pool = (hp) => ({ hp, maxHp: hp, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } });
/** Spawn a pinned enemy (speed ×0) at a tile. */
const put = (h, key, pos, o = {}) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: o.move ? 1 : 0, ...(o.mods || {}) }, tag: o.tag ?? null, route: o.route });
const tb = (key, k) => E[key].talents.bb[k];
const skb = (key, p) => E[key].skills.find((s) => s.prefabKey === p);
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const nm = (k) => `${k} ${E[k] ? E[k].name : ''}`;
const statuses = (h, id, key) => h.hooksOf('statusApplied').filter((c) => c.target.id === id && c.status === key);
const killed = (h, e, by = null) => h.b.kill(e, by);
const alive = (h, key) => h.enemies().filter((e) => e.defId === key);

// ---------------------------------------------------------------------------------------------------------------
// coverage

test('every enemy key is authored (enemies.js / bosses.js) or listed as stats-only with a reason', () => {
  for (const k of Object.keys(E)) {
    const n = (KITS[k] ? 1 : 0) + (BOSS_KITS[k] ? 1 : 0) + (STATS_ONLY[k] ? 1 : 0);
    assert.equal(n, 1, `${k} ${E[k].name}`);
  }
  for (const k of [...Object.keys(KITS), ...Object.keys(BOSS_KITS), ...Object.keys(STATS_ONLY)]) assert.ok(E[k], `unknown key ${k}`);
});

test('stats-only enemies attach no ability and fight with their data stats', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  for (const k of Object.keys(STATS_ONLY)) {
    const e = put(h, k, [10, 7]);
    assert.ok(!e.mem.ab || !e.mem.ab.list.length, k);
    assert.equal(e.s.atk, E[k].stats.atk, k);
  }
});

// Abilities the client makes silenceable although their handbook line is NORMAL (the battle prefab's buff template checks
// SILENCED): 萨卡兹枯朽战士 / 组长's PollutedDie = template projectile_on_killed, the 死亡爆炸 template of 高能源石虫's
// SILENCE-flagged blast too (community report of 2026-10-06, item 10; DESIGN §25.18.2)
const SILENCE_BY_TEMPLATE = new Set(['enemy_1267_nhpbr', 'enemy_1267_nhpbr_2']);

test('沉默: exactly the abilities whose handbook line is SILENCE-flagged can be silenced (every authored enemy), plus the ones whose client template checks it', () => {
  const h = arena();
  h.step();
  for (const key of [...Object.keys(KITS), ...Object.keys(BOSS_KITS)]) {
    const e = put(h, key, [10, 7]);
    const data = E[key].abilities.some((a) => a.format === 'SILENCE') || SILENCE_BY_TEMPLATE.has(key);
    const kit = !!(e.mem.ab && e.mem.ab.list.some((a) => a && (a.sil || a.silAware)));
    assert.equal(kit, data, `${nm(key)}: ${E[key].abilities.map((a) => `[${a.format}]${a.text}`).join(' / ')}`);
    h.b.kill(e, null);
    if (e.alive) { for (const a of e.mem.ab.list) a.state = 'form2'; h.b.kill(e, null); }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// INVISIBLE 隐匿

for (const key of ['enemy_1009_lurker', 'enemy_1019_jshoot', 'enemy_1019_jshoot_2', 'enemy_1023_jmage', 'enemy_1283_sgkill', 'enemy_1283_sgkill_2', 'enemy_1389_winbab_2', 'enemy_10031_cnvsld', 'enemy_10042_prtrop', 'enemy_10042_prtrop_2']) {
  test(`${nm(key)}: 隐匿 — ranged operators cannot target it until it is blocked`, () => {
    const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
    h.step();
    const e = put(h, key, [10, 7]);
    h.run(3);
    assert.ok(e.s.flags.stealth);
    assert.equal(e.stats.taken, 0);
    // blocked ⇒ targetable
    const h2 = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }, { chessId: 't_wall', row: 10, col: 7 }] });
    h2.step();
    const e2 = put(h2, key, [10, 7]);
    h2.run(3);
    assert.ok(e2.blockedBy && e2.stats.taken > 0);
    checkInvariants(h2.b);
  });
}

for (const key of ['enemy_1299_ymkilr', 'enemy_1299_ymkilr_2']) {
  test(`${nm(key)}: 隐匿; first attack after its stealth is broken (blocked) deals ×InvisibleCombat.atk_scale`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged', 'statusApplied', 'blocked'] });
    h.step();
    const e = put(h, key, [9, 5]);
    assert.ok(e.s.flags.stealth);
    h.runUntil(() => e.stats.attacks >= 2, 30);
    const hits = h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.isAttack).map((c) => c.amount);
    const scale = skb(key, 'InvisibleCombat').bb.atk_scale;
    approx(hits[0], e.s.atk * scale);
    approx(hits[1], e.s.atk);
  });
}

// PRTS 重弩突袭者 直击: "蓄力1.4s后向目标方向发射1支弩箭，对击中的首个目标造成攻击力100%的法术伤害与5s晕眩 ※技能持续2.5s"; 天赋
// "隐匿（被阻挡，主动攻击期间均可解除）" (0.1.3: the bolt left at once and the reveal lasted the blackboard's 2 s)
test(`${nm('enemy_1404_msnip')}: 直击 — 1.4 s after the cast a unit in line is shot (arts ATK×atk_scale) and stunned; revealed and standing for the skill's 2.5 s`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 4 }], hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_1404_msnip', [9, 8]);
  const s = skb('enemy_1404_msnip', 'CrossAttack');
  const w = h.unit('t_wall');
  h.run(s.initCooldown + 0.1);
  assert.ok(e.findBuff('ab:revealed') && e.s.flags.noMove, 'cast: revealed, standing');
  h.run(1.2);                                               // 1.3 s into the skill: still charging
  assert.equal(w.stats.taken, 0, 'no bolt before the 1.4 s charge');
  h.run(0.8);                                               // 2.1 s in: the bolt (4 tiles at 12/s) has landed
  assert.equal(statuses(h, w.id, 'stun').length, 1);
  approx(statuses(h, w.id, 'stun')[0].duration, s.bb.stun);
  approx(w.stats.taken, e.s.atk * s.bb.atk_scale * (1 - 0 / 100));
  assert.ok(e.findBuff('ab:revealed'), 'still revealed at 2.1 s');
  h.run(0.5);                                               // 2.6 s in: the skill is over
  assert.ok(!e.findBuff('ab:revealed') && !e.s.flags.noMove, 'skill over after 2.5 s');
  // stunned during the charge: no bolt
  const h2 = arena({ units: [{ chessId: 't_wall', row: 9, col: 4 }] });
  h2.step();
  const e2 = put(h2, 'enemy_1404_msnip', [9, 8]);
  h2.run(s.initCooldown + 0.5);
  h2.b.applyStatus(e2, 'stun', { duration: 1.5 });
  h2.run(2);
  assert.equal(h2.unit('t_wall').stats.taken, 0, 'a stun during the charge cancels the shot');
});

test(`${nm('enemy_10034_cnvsax')}: never attacks while stealthed; once blocked it counter-attacks and burns its locked target`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }] });
  h.step();
  const free = put(h, 'enemy_10034_cnvsax', [9, 5]);           // next to the wall, not blocked
  h.run(4);
  assert.equal(free.stats.attacks, 0);
  const e = put(h, 'enemy_10034_cnvsax', [10, 5]);             // blocked by the wall
  h.run(5);
  const w = h.unit('t_wall');
  assert.ok(e.stats.attacks > 0);
  assert.ok(w.elem.burn > 0, '狂欢式演奏 burns its target (the blocker)');
});

test(`${nm('enemy_10034_cnvsax')}: revealed (反隐) and not blocked it makes no normal attack and walks on — 反击模式 "仅进行阻挡攻击"`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  h.b.addBuff(h.unit('t_wall'), { key: 'test:noBlock', persist: true, flags: { noBlock: true } });
  const e = put(h, 'enemy_10034_cnvsax', [9, 8], { move: true, route: { motion: 'WALK', start: [9, 8], end: [9, 1], checkpoints: [] } });
  h.b.addBuff(e, { key: 'test:reveal', persist: true, flags: { reveal: true } });
  const x0 = e.x;
  h.run(4);
  assert.equal(e.stats.attacks, 0, 'no ranged attack (until 0.1.3 it shot the wall and stood still)');
  approx(x0 - e.x, 4 * e.s.moveSpeed * 0.5, 0.02, 'walked the whole 4 s');
});

test(`${nm('enemy_9008_acbunn')}: attacks several targets at once while stealthed`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 10, col: 6 }, { chessId: 't_mage', row: 11, col: 6 }, { chessId: 't_blade', row: 10, col: 7 }], captureNoisy: true, hooks: ['attack'] });
  h.step();
  const e = put(h, 'enemy_9008_acbunn', [9, 6]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  const atk = h.hooksOf('attack').find((c) => c.attacker === e);
  assert.ok(atk.targets.length >= 2, `targets ${atk.targets.length}`);
});

// 骨刺 — PRTS 天赋 (级别0) 「自身普通攻击索敌不受阻挡影响 / 不会攻击飞行单位，隐匿（解除阻挡0秒后恢复） / 隐匿期间可同时攻击3个目标」
// and the level description 「隐匿；隐匿状态下同时攻击3个目标。」 (PR #365, the targeting part checked against PRTS).
function boneArena(o = {}) {
  const h = arena({
    units: ['t_wall', 't_wall2', 't_wall3', 't_wall4'].map((chessId, i) => ({ chessId, row: 9 + (i % 2), col: 6 + Math.floor(i / 2) })),
    captureNoisy: true, hooks: ['attack'], ...o,
  });
  h.step();
  for (const u of h.allies()) h.b.addBuff(u, { key: 'test:noBlock', persist: true, flags: { noBlock: true } });
  const e = put(h, 'enemy_9008_acbunn', [9, 6]);
  return { h, e };
}
/** The targets of `e`'s next attack. */
function boneNext(h, e) {
  const n = h.hooksOf('attack').filter((c) => c.attacker === e).length;
  assert.ok(h.runUntil(() => h.hooksOf('attack').filter((c) => c.attacker === e).length > n, 8), 'a new attack');
  return h.hooksOf('attack').filter((c) => c.attacker === e)[n].targets;
}

test(`${nm('enemy_9008_acbunn')}: 3 targets while hidden, 1 once blocked or revealed — by priority, not its blocker first; 3 again when hidden`, () => {
  for (const cause of ['block', 'reveal']) {
    const { h, e } = boneArena();
    const wall = h.unit('t_wall'), taunter = h.unit('t_wall4');
    assert.equal(new Set(boneNext(h, e)).size, 3, `${cause}: hidden — three distinct targets of the four in reach`);
    h.b.addBuff(taunter, { key: 'test:taunt', mods: { taunt: 5 } });
    if (cause === 'block') { h.b.removeBuff(wall, 'test:noBlock'); h.step(2); assert.equal(e.blockedBy, wall); }
    else h.b.addBuff(e, { key: 'test:reveal', persist: true, flags: { reveal: true } });
    assert.deepEqual(boneNext(h, e), [taunter], `${cause}: one target, the taunt-5 one (索敌不受阻挡影响)`);
    if (cause === 'block') { h.b.addBuff(wall, { key: 'test:noBlock', persist: true, flags: { noBlock: true } }); h.b.releaseBlocked(wall); }
    else h.b.removeBuff(e, 'test:reveal');
    assert.equal(boneNext(h, e).length, 3, `${cause}: hidden again (0 s after the block) — three`);
    checkInvariants(h.b);
  }
});

test(`${nm('enemy_9008_acbunn')}: never targets a flying unit (炎佑, taunt 5), hidden or revealed`, () => {
  for (const revealed of [false, true]) {
    const { h, e } = boneArena({ content: 'full', extraContent: [] });
    const [air] = spawnYanyou(h.b, 'p1', { count: 1, hp: 50000 });
    assert.ok(air?.isFlying);
    air.x = 6.5; air.y = 9;
    h.b.applyStatus(air, 'stun', { duration: 30, force: true });
    h.b.addBuff(air, { key: 'test:taunt', mods: { taunt: 5 } });
    if (revealed) h.b.addBuff(e, { key: 'test:reveal', persist: true, flags: { reveal: true } });
    const t = boneNext(h, e);
    assert.equal(t.length, revealed ? 1 : 3);
    assert.ok(!t.includes(air), `${revealed ? 'revealed' : 'hidden'}: the flyer is no target`);
  }
});

test(`${nm('enemy_9008_acbunn')}: its 3 hidden targets come from its normal attack's reach (2 + the 0.25 ally collider)`, () => {
  const { h, e } = boneArena();
  const edge = h.unit('t_wall3'), outside = h.unit('t_wall4');
  edge.x = e.x + 2.1; edge.y = e.y;
  outside.x = e.x + 2.3; outside.y = e.y;
  h.b.addBuff(edge, { key: 'test:taunt', mods: { taunt: 5 } });
  const t = boneNext(h, e);
  assert.ok(t.includes(edge), 'the ally 2.1 away is one of the three');
  assert.ok(!t.includes(outside), 'the one 2.3 away is out of reach');
});

test(`${nm('enemy_1175_dushdo_2')}: stealth; next to 深池伙友卫队精英 its attack interval drops by traitAbility.base_attack_time`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_1175_dushdo_2', [10, 6]);
  const base = e.s.interval;
  assert.ok(e.s.flags.stealth);
  put(h, 'enemy_1174_duholy_2', [10, 7]);
  h.run(1);
  approx(e.s.bat, E.enemy_1175_dushdo_2.stats.bat + tb('enemy_1175_dushdo_2', 'traitAbility.base_attack_time'), 1e-6);
  assert.ok(e.s.interval < base);
});

for (const key of ['enemy_2034_sythef', 'enemy_2034_sythef_2']) {
  test(`${nm(key)}: stealth and every attack stuns (Combat.attack@stun s)`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['statusApplied'] });
    h.step();
    const e = put(h, key, [9, 5]);
    assert.ok(e.s.flags.stealth);
    h.runUntil(() => e.stats.attacks >= 1, 10);
    const st = statuses(h, h.unit('t_wall').id, 'stun');
    assert.equal(st.length, 1);
    approx(st[0].duration, tb(key, 'Combat.attack@stun'));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// TIMES 频次

const TIMES_KEYS = ['enemy_1196_msfyin', 'enemy_1196_msfyin_2', 'enemy_1198_msfshu', 'enemy_1198_msfshu_2', 'enemy_1200_msfjin', 'enemy_1200_msfjin_2',
  'enemy_1202_msfzhi', 'enemy_1202_msfzhi_2', 'enemy_1204_msfhu', 'enemy_1204_msfhu_2', 'enemy_1208_msfji', 'enemy_1208_msfji_2', 'enemy_1210_msfden', 'enemy_1210_msfden_2'];
for (const key of TIMES_KEYS) {
  const artsOnly = /1204/.test(key);
  test(`${nm(key)}: 频次 — needs ${E[key].stats.maxHp} × the round's HP ${artsOnly ? 'arts/true ' : ''}hits, unblockable`, () => {
    const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }], hooks: ['death'], mods: { hpMul: 3 } });
    h.step();
    const e = put(h, key, [10, 7], { mods: { hpMul: 3 } });   // the round's HP multiplier (攻坚装备) scales the hit count (PR #272)
    const n = E[key].stats.maxHp * 3;
    assert.equal(e.s.maxHp, n);
    assert.ok(e.s.flags.unblockable);
    const g = h.unit('t_gun');
    const type = artsOnly ? 'arts' : 'phys';
    if (artsOnly) { h.b.dealDamage(g, e, { amount: 1e7, type: 'phys' }); assert.equal(e.hp, n, 'physical hits do not count'); }
    for (let i = 0; i < n - 1; i++) h.b.dealDamage(g, e, { amount: 1e7, type });
    assert.ok(e.alive);
    assert.equal(e.hp, 1);
    h.b.dealDamage(g, e, { amount: 0.01, type });
    assert.ok(!e.alive);
  });
}

// PR #272 (感谢 @CXUtk): 补给线 / 补给线II leave out exactly these 14 keys (+ 炎佑); 攻坚装备 / II / III and 急行军 only 炎佑
const EFFECTS = JSON.parse(fs.readFileSync(new URL('../../data/effects.json', import.meta.url), 'utf8'));
const excludeOf = (id) => new Set(String(EFFECTS[id].params.enemy_exclude).split('|'));
test('频次 器物 vs the round effects: the 14 kitTimes keys are exactly 补给线 / 补给线II\'s enemy_exclude (+ 炎佑); 攻坚装备 / II / III / 急行军 leave out only 炎佑', () => {
  for (const id of ['aceffect_enemy_2', 'aceffect_enemy_2_2']) assert.deepEqual([...excludeOf(id)].sort(), ['enemy_9012_acloon', ...TIMES_KEYS].sort(), id);
  for (const id of ['aceffect_enemy_1', 'aceffect_enemy_3', 'aceffect_enemy_4', 'aceffect_enemy_5']) assert.deepEqual([...excludeOf(id)], ['enemy_9012_acloon'], id);
});

test('频次 器物: hits = data × hpMul / supplyHpMul (补给线\'s share out, 攻坚装备 kept), rounded [ASSUMED]; a 频次 enemy\'s death spawn inherits that', () => {
  const h = arena();
  h.step();
  // co-op 终极 R6: hp 1.2⁴ × 1.08 (补给线) — the mirror takes 1.2⁴ only: 30 × 2.0736 = 62.2 → 62
  const mods = { hpMul: 2.239488, atkMul: 1.4641, speedMul: 0, supplyHpMul: 1.08 };
  const jin = put(h, 'enemy_1200_msfjin', [10, 7], { mods });
  assert.equal(jin.s.maxHp, 62);
  const parent = put(h, 'enemy_1199_sfjin', [10, 9], { mods });
  approx(parent.s.maxHp, E.enemy_1199_sfjin.stats.maxHp * 2.239488, 1e-9, '身观 itself takes 补给线');
  h.b.kill(parent, null);
  h.step();
  const child = h.enemies().find((e) => e.defId === 'enemy_1200_msfjin' && e !== jin);
  assert.ok(child, '身观 leaves its 青铜镜');
  assert.equal(child.s.maxHp, 62);
  // solo 标准 (攻坚装备III, HP ×0.75): fewer hits — 2 → 1.5 → 2, 3 → 2.25 → 2, 30 → 22.5 → 23
  for (const [key, n] of [['enemy_1196_msfyin', 2], ['enemy_1196_msfyin_2', 2], ['enemy_1200_msfjin', 23]]) assert.equal(put(h, key, [11, 7], { mods: { hpMul: 0.75 } }).s.maxHp, n, key);
  assert.equal(put(h, 'enemy_1196_msfyin', [11, 8]).s.maxHp, 2, 'no mods: the data\'s count');
});

for (const key of ['enemy_1200_msfjin', 'enemy_1204_msfhu', 'enemy_1288_duskls']) {
  test(`${nm(key)}: 频次 hits keep their DamageInfo — a self-excluding bonus-on-damaged attacker never recurses, death hooks fire`, () => {
    const h = arena({
      units: [{ chessId: 't_mage', row: 12, col: 3 }], hooks: ['death'],
      setup(b) {
        b.on('damaged', (c) => {
          if (!c.source || c.source.side !== 'ally' || !c.target.alive || (c.dmg.tags && c.dmg.tags.includes('bonusTest'))) return;
          b.dealDamage(c.source, c.target, { amount: 10, type: 'arts', tags: ['bonusTest'] });
        });
      },
    });
    h.step();
    const e = put(h, key, [10, 7]);
    const g = h.unit('t_mage');
    if (/duskls/.test(key)) { killed(h, e, g); assert.ok(e.alive, 'ember'); h.run(HUSK_REBIRTH + 0.05); }
    const hits = e.s.maxHp;
    assert.ok(hits > 1 && hits <= 30);
    let n = 0;
    while (e.alive && n++ < 40) h.b.dealDamage(g, e, { amount: 1e7, type: 'arts', isAttack: true });
    assert.equal(n, Math.ceil(hits / 2), 'every attack + its bonus remove exactly 2 hits');
    assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
    assert.ok(h.hooksOf('death').some((c) => c.unit.id === e.id && c.reason === 'killed'));
    checkInvariants(h.b);
  });
}

test('茶器 (hitCountArts): physical instances remove nothing, true / elemental remove 1 each; element fills do not count', () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
  h.step();
  const e = put(h, 'enemy_1204_msfhu', [10, 7]);
  const g = h.unit('t_gun');
  const n = e.hp;
  for (let i = 0; i < 5; i++) h.b.dealDamage(g, e, { amount: 1e6, type: 'phys', isAttack: true });
  assert.equal(e.hp, n);
  h.b.dealDamage(g, e, { type: 'element', element: 'burn', amount: 100 });
  assert.equal(e.hp, n);
  h.b.dealDamage(g, e, { amount: 1, type: 'true' });
  h.b.dealDamage(g, e, { amount: 1, type: 'elemental' });
  assert.equal(e.hp, n - 2);
  checkInvariants(h.b);
});

const DEATH_SPAWN = { enemy_1195_sfyin: 2, enemy_1195_sfyin_2: 2, enemy_1197_sfshu: 3, enemy_1197_sfshu_2: 3, enemy_1199_sfjin: 1, enemy_1209_sfden: 1, enemy_1209_sfden_2: 1 };
for (const [key, n] of Object.entries(DEATH_SPAWN)) {
  test(`${nm(key)}: when knocked out spawns ${n}× ${E[E[key].talents.bbStr['DeadSpawn.enemy_key']].name} that continue its route`, () => {
    const h = arena();
    h.step();
    const e = put(h, key, [10, 7], { move: true });
    h.run(1);
    killed(h, e, null);
    const child = E[key].talents.bbStr['DeadSpawn.enemy_key'];
    const kids = alive(h, child);
    assert.equal(kids.length, n);
    assert.equal(kids[0].s.maxHp, E[child].stats.maxHp);
    h.run(3);
    assert.ok(kids[0].x < 7, 'the children walk on');
  });
}

for (const key of ['enemy_1207_sfji', 'enemy_1207_sfji_2']) {
  // PRTS 天赋 "攻击力+X%，持有4个【断刃】 / 每次成功攻击后消耗1个【断刃】，攻击结束时若已耗尽【断刃】，则立刻切换为无断刃模式并失去攻击力
  // 加成" (popup: "清空当次攻击间隔" — it attacks again at once: since 0.2.0 its next swing starts at once and strikes at the
  // clip's damage frame, ai.js attackWindup); GitHub #107: until 0.2.0 each attack stacked another layer
  test(`${nm(key)}: one ATK layer while it holds a blade, gone with the 4th attack (which is followed at once by the next swing); unspent blades become 矛头 on death (at least 1)`, () => {
    const per = tb(key, 'Atkup.atk') ?? tb(key, 'AtkUp.atk'), cnt = tb(key, 'DeadSpawn.cnt');
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const e = put(h, key, [9, 5]);
    const base = e.base.atk;
    approx(e.s.atk, base * (1 + per), 1e-6, 'holding 4 blades: one layer from the spawn');
    h.runUntil(() => e.stats.attacks >= 2, 20);
    approx(e.s.atk, base * (1 + per), 1e-6, 'two blades spent: still one layer (never stacked)');
    h.runUntil(() => e.stats.attacks >= cnt, 20);
    approx(e.s.atk, base, 1e-6, 'the last blade spent: 无断刃模式, no bonus');
    const tLast = h.b.time;
    const wind = attackWindup(e);
    assert.ok(wind > 0 && h.runUntil(() => e.stats.attacks >= cnt + 1, wind + 0.2), 'the mode switch clears the attack interval: the next swing at once');
    assert.ok(Math.abs(h.b.time - tLast - wind) <= 3 * h.TICK, `${h.b.time - tLast} s after the 4th attack: its wind-up (${wind} s)`);
    assert.ok(h.b.time - tLast < e.s.interval / 2);
    const child = E[key].talents.bbStr['DeadSpawn.enemy_key'];
    killed(h, e, null);
    assert.equal(alive(h, child).length, 1, 'no blade left: still one 矛头');
    // killed after two attacks: the two unspent blades; untouched: all four
    const h2 = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h2.step();
    const e2 = put(h2, key, [9, 5]);
    h2.runUntil(() => e2.stats.attacks >= 2, 20);
    killed(h2, e2, null);
    assert.equal(alive(h2, child).length, cnt + tb(key, 'DeadSpawn.cnt_add') * 2);
    const h3 = arena();
    h3.step();
    const e3 = put(h3, key, [10, 7]);
    killed(h3, e3, null);
    assert.equal(alive(h3, child).length, cnt);
  });
}

for (const key of ['enemy_1209_sfden', 'enemy_1209_sfden_2']) {
  // PRTS 清明 / 堂皇 辉光照耀 "使【范围隐匿】生效3s" = the talent's InvisibleShield.duration (清明's skill blackboard says 5 — used
  // until 0.1.3)
  test(`${nm(key)}: InvisibleShield veils nearby enemies (stealth) for the talent's ${tb(key, 'InvisibleShield.duration')} s`, () => {
    const h = arena();
    h.step();
    put(h, key, [10, 7]);
    const o = put(h, 'enemy_1007_slime', [10, 6]);
    const s = skb(key, 'InvisibleShield');
    assert.equal(tb(key, 'InvisibleShield.duration'), 3);
    h.run(s.initCooldown + 0.1);
    assert.ok(o.s.flags.stealth);
    h.run(3 - 0.3);
    assert.ok(o.s.flags.stealth, 'still veiled at 2.8 s');
    h.run(0.4);
    assert.ok(!o.s.flags.stealth, 'gone after 3 s');
  });
}

for (const key of ['enemy_1203_sfhu', 'enemy_1203_sfhu_2']) {
  // PRTS 烹泉 / 沏虹 天赋: "死亡爆炸（爆炸半径1.25，造成攻击力100%法术溅射伤害并施加15s【烹泉减益】…不可对空）", 【烹泉减益】 "可叠加，每层
  // 持续时间和效果独立计算"; "普通攻击对目标对及目标周围半径1.0范围内的所有我方单位造成法术普通伤害" (0.1.3: the blast took the attack
  // radius 2 and left a steam zone; the attack hit its target only)
  test(`${nm(key)}: death spawns 4 茶器; the blast (r 1.25, ATK arts) gives each unit hit one ${tb(key, 'DeadBoom.duration')} s layer of ASPD ${tb(key, 'DeadBoom.attack_speed')}; its attacks splash r 1.0`, () => {
    // t_gun deploys last (column 6, below t_wall): the attack's target, t_wall2 and t_wall within 1.0 of it
    const h = arena({ units: [{ chessId: 't_gun', row: 10, col: 6 }, { chessId: 't_wall', row: 11, col: 6 }, { chessId: 't_wall2', row: 10, col: 5 }], hooks: ['damaged'], captureNoisy: true });
    h.step();
    const e = put(h, key, [10, 7]);
    h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === e && c.dmg.isAttack), 10);
    h.run(0.6);
    const tgt = h.hooksOf('damaged').find((c) => c.source === e && c.dmg.isAttack).target;
    const near = h.allies().filter((u) => u !== tgt && Math.hypot(u.x - tgt.x, u.y - tgt.y) <= 1 + 1e-6);
    const splashed = h.hooksOf('damaged').filter((c) => c.source === e && !c.dmg.isAttack && c.dmg.tags.includes('splash')).map((c) => c.target);
    assert.ok(near.length >= 1, 'a unit within 1.0 of the target');
    for (const u of near) assert.ok(splashed.includes(u), `${u.defId} splashed`);
    for (const u of splashed) assert.ok(Math.hypot(u.x - tgt.x, u.y - tgt.y) <= 1 + 1e-6, 'only within 1.0');
    approx(h.hooksOf('damaged').find((c) => c.source === e && !c.dmg.isAttack).amount, e.s.atk, 1e-6, 'arts, 100 % (RES 0)');
    const atk = e.s.atk;
    const taken0 = new Map(h.allies().map((u) => [u, u.stats.taken]));
    killed(h, e, null);
    assert.equal(alive(h, E[key].talents.bbStr['DeadSpawn.enemy_key']).length, tb(key, 'DeadSpawn.cnt'));
    const g = h.unit('t_gun'), w = h.unit('t_wall'), w2 = h.unit('t_wall2');
    approx(g.stats.taken - taken0.get(g), atk, 1e-6, '1.0 away: blasted');
    assert.equal(w2.stats.taken - taken0.get(w2), 0, '2.0 away: outside 1.25');
    assert.equal(w.stats.taken - taken0.get(w), 0, '√2 away: outside 1.25');
    approx(g.s.aspd, 100 + tb(key, 'DeadBoom.attack_speed'));
    assert.equal(w.s.aspd, 100);
    h.run(tb(key, 'DeadBoom.duration') - 0.5);
    approx(g.s.aspd, 100 + tb(key, 'DeadBoom.attack_speed'), 1e-6, 'one layer for 15 s');
    h.run(1);
    assert.equal(g.s.aspd, 100);
  });
}

for (const key of ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld']) {
  test(`${nm(key)}: knocked out ⇒ ${HUSK_REBIRTH} s 重生, then a walking, disarmed, 隐匿 ember needing ${tb(key, 'Revive[Trigger].prop_max_hp')} hits; full HP again ${tb(key, 'Revive[Trigger].interval')} s later`, () => {
    const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
    h.step();
    const e = put(h, key, [10, 7]);
    const max = e.s.maxHp;
    killed(h, e, h.unit('t_gun'));
    assert.ok(e.alive);
    assert.equal(e.s.maxHp, tb(key, 'Revive[Trigger].prop_max_hp'));
    assert.ok(e.s.flags.invulnerable && e.s.flags.unblockable && e.s.flags.noMove, '重生');
    h.run(HUSK_REBIRTH + 0.05);
    assert.ok(e.s.flags.stealth && e.s.flags.disarm && e.profile.noAttack, '余烬: 隐匿, 缴械');
    assert.ok(!e.s.flags.unblockable && !e.s.flags.noMove, 'blockable, walks');
    h.run(tb(key, 'Revive[Trigger].interval'));
    assert.equal(e.s.maxHp, max);
    assert.equal(e.hp, max);
    assert.ok(!e.s.flags.stealth);
    // an ember hit N times dies for good
    killed(h, e, null);
    h.run(HUSK_REBIRTH + 0.05);
    for (let i = 0; i < tb(key, 'Revive[Trigger].prop_max_hp'); i++) h.b.dealDamage(null, e, { amount: 1, type: 'arts' });
    assert.ok(!e.alive);
  });
}

test(`${nm('enemy_9010_acpupp')}: knocked out ⇒ an unblockable 15-hit 傀儡 that walks on and revives, and nearby enemies get a 5-hit shield`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_9010_acpupp', [10, 7]);
  const o = put(h, 'enemy_1007_slime', [10, 6]);
  killed(h, e, null);
  assert.ok(e.alive);
  assert.equal(e.s.maxHp, tb('enemy_9010_acpupp', 'Revive[Trigger].prop_max_hp'));
  h.run(HUSK_REBIRTH + 0.05);
  assert.ok(e.s.flags.unblockable && e.s.flags.disarm && !e.s.flags.stealth && !e.s.flags.noMove, '傀儡: 不可被阻挡, not stealthed');
  const hp = o.hp;
  for (let i = 0; i < tb('enemy_9010_acpupp', 'Aura.max_damage_block_cnt'); i++) h.b.dealDamage(null, o, { amount: 100, type: 'phys' });
  assert.equal(o.hp, hp, 'shield negates the hits');
  h.b.dealDamage(null, o, { amount: 100, type: 'phys' });
  assert.ok(o.hp < hp);
  h.run(tb('enemy_9010_acpupp', 'Revive[Trigger].interval') + 0.1);
  assert.equal(e.hp, E.enemy_9010_acpupp.stats.maxHp);
  assert.ok(!e.s.flags.unblockable);
});

// ---------------------------------------------------------------------------------------------------------------
// ELEMENT 元素 (element damage = ATK × ep_damage_ratio per attack hit)

const EP = [
  ['enemy_1148_dssbr', 'neural', 'epdamage.attack@ep_damage_ratio'], ['enemy_1148_dssbr_2', 'neural', 'epdamage.attack@ep_damage_ratio'],
  ['enemy_1305_mhslim', 'burn', 'EpDamage.attack@ep_damage_ratio'], ['enemy_1305_mhslim_2', 'burn', 'EpDamage.attack@ep_damage_ratio'],
  ['enemy_2021_syfish', EROSION, 'EpDamage.attack@ep_damage_ratio'], ['enemy_1229_darmy', 'apoptosis', 'epdamage.attack@ep_damage_ratio'],
  ['enemy_1229_darmy_2', 'apoptosis', 'epdamage.attack@ep_damage_ratio'], ['enemy_2009_csaudc', 'neural', 'combat.attack@ep_damage_ratio'],
  ['enemy_10094_crstf', 'neural', 'ep.ep_damage_ratio'], ['enemy_10098_crhro', 'neural', 'inside.attack@ep_damage_ratio'],
  ['enemy_10099_crvln', 'neural', 'inside.attack@ep_damage_ratio'], ['enemy_1183_mlasrt', EROSION, 'EpDamage.attack@ep_damage_ratio'],
];
for (const [key, el, k] of EP) {
  test(`${nm(key)}: attacks add ATK×${tb(key, k)} ${el === EROSION ? '侵蚀 (erosion)' : el} to the target's gauge`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const e = put(h, key, [9, 5]);
    h.runUntil(() => e.stats.attacks >= 1, 20);
    h.run(0.6);   // projectile flight
    approx(h.unit('t_wall').elem[el], e.s.atk * tb(key, k) * e.stats.attacks, 1e-6, key);
  });
}

test('侵蚀 burst: 1000 erosion permanently lowers DEF by 100 and deals 800 physical damage (official term)', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const w = h.unit('t_wall');
  const src = put(h, 'enemy_2021_syfish', [11, 8]);
  h.b.addBuff(w, { key: 'test:def', mods: { defFlat: 300 } });
  const hp = w.hp;
  enemiesMod.elem(h.b, src, w, 'erosion', 1000);
  h.step(2);
  assert.ok(!w.findBuff('necrosisBurst'));
  assert.equal(w.s.def, 300 - EROSION_BURST.defDown);
  approx(hp - w.hp, EROSION_BURST.physDamage - (300 - EROSION_BURST.defDown), 1e-6);
});

test(`${nm('enemy_1158_divman')}: in deep water ATK +Swim.atk and stealth; immune to the deep-water damage`, () => {
  const rows = { 10: '##hddddrrrfrrrrrrrf##' };
  const h = arena({ flat: { rows } });
  h.step();
  const e = put(h, 'enemy_1158_divman', [10, 4]);
  const dry = put(h, 'enemy_1158_divman', [11, 7]);
  h.run(0.5);
  approx(e.s.atk, dry.s.atk * (1 + tb('enemy_1158_divman', 'Swim.atk')));
  assert.ok(e.s.flags.stealth && !dry.s.flags.stealth);
  // 免疫水蚀: devices.js' deep-water tick (tag 'deepsea'); 环境伤害 ('terrain', e.g. 活性源石) still lands
  h.b.dealDamage(null, e, { amount: 40, type: 'true', canDodge: false, sourceless: true, noSp: true, tags: ['dot', 'periodic', 'deepsea'] });
  assert.equal(e.hp, e.s.maxHp);
  h.b.dealDamage(null, e, { amount: 40, type: 'true', tags: ['terrain'] });
  assert.equal(e.hp, e.s.maxHp - 40);
});

for (const key of ['enemy_1160_hvyslr', 'enemy_1160_hvyslr_2']) {
  // enemy SP +1 per attack: spCost 3 ⇒ "攻击3次后，下一次攻击" = the 4th (the official 粉碎攻坚手 text pins spCost 2 ⇒ 3rd)
  test(`${nm(key)}: after ${skb(key, 'stuncombat').spCost} attacks the next one stuns its blocker (${skb(key, 'stuncombat').bb.stun} s); loses Drown.damage HP/s in deep water`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['statusApplied'], flat: { rows: { 11: '##hddddrrrfrrrrrrrf##' } } });
    h.step();
    const e = put(h, key, [9, 5]);
    const n = skb(key, 'stuncombat').spCost + 1;
    assert.equal(enemiesMod.nthOf(e.mem.ab.sk.stuncombat), n);
    h.runUntil(() => e.stats.attacks >= n - 1, 60);
    assert.equal(statuses(h, h.unit('t_wall').id, 'stun').length, 0);
    h.runUntil(() => e.stats.attacks >= n, 30);
    const st = statuses(h, h.unit('t_wall').id, 'stun');
    assert.equal(st.length, 1);
    approx(st[0].duration, skb(key, 'stuncombat').bb.stun);
    const wet = put(h, key, [11, 4]);
    h.run(1);
    approx(wet.s.maxHp - wet.hp, tb(key, 'Drown.damage'), 0.02);
  });
}

test(`${nm('enemy_1160_hvyslr')}: silenced, its stun attack (SILENCE-flagged) never comes`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_1160_hvyslr', [9, 5]);
  h.b.applyStatus(e, 'silence', { duration: 60 });
  h.runUntil(() => e.stats.attacks >= 8, 60);
  assert.equal(statuses(h, h.unit('t_wall').id, 'stun').length, 0);
});

for (const key of ['enemy_1161_tidmag', 'enemy_1161_tidmag_2', 'enemy_1162_magmot']) {
  test(`${nm(key)}: attack hits the target and the 4 neighbouring tiles, adding erosion to each`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }, { chessId: 't_wall3', row: 11, col: 5 }] });
    h.step();
    const e = put(h, key, [9, 5]);
    h.runUntil(() => e.stats.attacks >= 1, 20);
    h.run(0.6);
    const ratio = tb(key, 'EpDamage.attack@ep_damage_ratio');
    approx(h.unit('t_wall2').elem[EROSION], e.s.atk * ratio);
    assert.equal(h.unit('t_wall3').stats.taken, 0, 'two tiles away: not hit');
    if (key === 'enemy_1162_magmot') { killed(h, e, null); assert.equal(alive(h, 'enemy_1161_tidmag').length, 1); }
  });
}

test(`${nm('enemy_2025_syufo')}: 近地悬浮 — unblockable, immune to melee attacks; erosion on hit`, () => {
  const h = arena({ units: [{ chessId: 't_blade', row: 10, col: 6 }, { chessId: 't_gun', row: 12, col: 3 }] });
  h.step();
  const e = put(h, 'enemy_2025_syufo', [10, 6]);
  assert.ok(e.s.flags.unblockable);
  h.run(3);
  assert.ok(!e.blockedBy);
  assert.equal(h.unit('t_blade').stats.dmg, 0);
  assert.ok(h.unit('t_gun').stats.dmg > 0);
  put(h, 'enemy_1007_slime', [10, 7]);
  h.run(3);
  assert.ok(h.unit('t_blade').stats.dmg > 0, 'the melee operator hits another enemy instead');
  assert.ok(h.unit('t_blade').elem[EROSION] > 0 || h.unit('t_gun').elem[EROSION] > 0);
});

test(`${nm('enemy_1275_dwlock_2')}: apoptosis on hit; DeathEye channels arts damage then bursts apoptosis ATK×2 on the group`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1275_dwlock_2', [9, 7]);
  const s = skb('enemy_1275_dwlock_2', 'DeathEye');
  h.run(s.initCooldown + s.bb.hit_duration + 1);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'beam' && f[4].kind === 'deathEye'));
  const w2 = h.unit('t_wall2');
  assert.ok(w2.elem.apoptosis >= e.s.atk * s.bb.ep_damage_ratio - 1e-6 || w2.findBuff('apoptosisBurst'));
});

for (const key of ['enemy_1439_dslntf', 'enemy_1439_dslntf_2']) {
  test(`${nm(key)}: first damage ⇒ combat state (move ×${tb(key, '0.move_speed')}) and a neural pulse around it every s`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }] });
    h.step();
    const e = put(h, key, [10, 7], { move: true });
    const v0 = e.s.moveSpeed;
    h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    approx(e.s.moveSpeed, v0 * tb(key, '0.move_speed'));
    h.run(1.05);
    approx(h.unit('t_wall').elem.neural, e.s.atk * tb(key, '1.ep_damage_ratio'), 1e-6);
  });
}

test(`${nm('enemy_9007_acelem')}: harder to target (taunt −1); parasitises its blocker (arts/s, element damage taken ×)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_9007_acelem', [9, 5]);
  assert.equal(e.s.taunt, -1);
  h.run(2.6);
  const w = h.unit('t_wall');
  assert.ok(w.findBuff('ab:parasite'));
  // "受到的元素损伤提高至130%": an elementHit multiplier on the host's gauge fills (SIM.md §7.2), not the elemTakenMul mod
  assert.equal(w.s.elemTakenMul, 1);
  const n0 = w.elem.neural;
  h.b.dealDamage(null, w, { type: 'element', element: 'neural', amount: 100 });
  approx(w.elem.neural - n0, 100 * tb('enemy_9007_acelem', '1.ep_damage_scale'), 1e-9);
  approx(w.stats.taken, 2 * e.s.atk * tb('enemy_9007_acelem', '1.atk_scale'), 1e-6);
  killed(h, e, null);
  assert.ok(!w.findBuff('ab:parasite'));
});

test(`${nm('enemy_10067_ftsjc')} + ${nm('enemy_10065_ftzlc')}: ATK ramps until the first attack (AoE arts + burn); ignites 卷心籽, whose ignited death blasts`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }] });
  h.step();
  const cab0 = put(h, 'enemy_10065_ftzlc', [11, 8]);
  killed(h, cab0, null);                                       // not ignited: no blast
  assert.equal(h.unit('t_wall2').stats.taken, 0);
  const v = put(h, 'enemy_10067_ftsjc', [10, 8]);
  const base = v.s.atk;
  h.run(10);
  approx(v.s.atk, base * (1 + tb('enemy_10067_ftsjc', 'pow.add_max_atk') * Math.min(1, 10 / tb('enemy_10067_ftsjc', 'pow.time'))), 0.01);
  const cab = put(h, 'enemy_10065_ftzlc', [9, 6]);
  h.b.relocate(h.unit('t_wall'), 9, 7);
  v.x = 7; v.y = 9;                                             // bring the vine to the wall
  h.runUntil(() => v.stats.attacks >= 1, 10);
  assert.ok(h.unit('t_wall').elem.burn > 0);
  assert.ok(!v.findBuff('ab:pow'), 'ramp ends at the first attack');
  assert.ok(cab.mem.ab.ignited);
  const t0 = h.unit('t_wall').stats.taken;
  killed(h, cab, null);
  assert.ok(h.unit('t_wall').stats.taken > t0, 'ignited cabbage explodes');
});

// ---------------------------------------------------------------------------------------------------------------
// DOT 持续

for (const key of ['enemy_1234_dsubrl', 'enemy_1234_dsubrl_2']) {
  test(`${nm(key)}: pulses hit every ally in range with neural damage; 抵抗 halves stun; immune to 停顿`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 10, col: 8 }] });
    h.step();
    const e = put(h, key, [10, 7]);
    h.run(1.2);
    for (const id of ['t_wall', 't_wall2']) assert.ok(h.unit(id).elem.neural > 0 && h.unit(id).stats.taken > 0, id);
    approx(h.b.resistOf(e), -tb(key, 'Buff.one_minus_status_resistance'), 1e-12, '抵抗 = the engine resist status (talent value)');
    h.b.applyStatus(e, 'stun', { duration: 4 });
    approx(e.findBuff('stun').timeLeft, 2);
    assert.equal(h.b.applyStatus(e, 'sluggish', { duration: 4 }), false);
  });

  // community report 「有个持续造成范围伤害的海嗣敌人错误的设置了攻击时不移动导致卡在原地」: PRTS 天赋 "不进行普通攻击", "未处于消失状态
  // 时，令攻击范围内的所有我方单位每秒受到攻击力100%的无途径法术伤害", "每次输出伤害时，再造成攻击力5%的神经损伤"
  test(`${nm(key)}: no normal attack — walks on past an unblocking operator while it pulses 100 % ATK arts + 5 % neural each second; no pulse while hidden`, () => {
    const h = arena({ units: [{ chessId: 't_gun', row: 10, col: 6 }], hooks: ['damaged'], captureNoisy: true });
    h.step();
    const g = h.unit('t_gun');
    h.b.addBuff(g, { key: 'test:noBlock', persist: true, flags: { noBlock: true } });
    g.profile.noAttack = true;
    const e = put(h, key, [9, 8], { move: true, route: { motion: 'WALK', start: [9, 8], end: [9, 1], checkpoints: [] } });
    const x0 = e.x;
    h.run(4);
    assert.ok(e.profile.noAttack && e.stats.attacks === 0, 'never attacks');
    approx(x0 - e.x, 4 * e.s.moveSpeed * 0.5, 0.02, 'walked the whole 4 s (MOVE_SCALE 0.5) with the operator in range');
    const mine = h.hooksOf('damaged').filter((c) => c.source === e && c.target === g);
    const arts = mine.filter((c) => c.dmg.type === 'arts');
    assert.ok(arts.length >= 3 && arts.every((c) => !c.dmg.isAttack && c.dmg.tags.includes('nestPulse')), `pulses, not attacks (${arts.length})`);
    approx(arts[0].dmg.amount, e.s.atk, 1e-9, '100 % ATK');
    const neural = mine.filter((c) => c.dmg.type === 'element');
    assert.equal(neural.length, arts.length, 'one 神经 per pulse');
    approx(neural[0].dmg.amount, e.s.atk * tb(key, 'EpDamage.ep_damage_ratio'), 1e-9, '5 % ATK 神经');
    const times = arts.map((c) => c.t ?? null).filter((t) => t != null);
    if (times.length > 1) approx(times[1] - times[0], 1, 1e-6, 'one per second');
    // 消失 (a DISAPPEAR leg): no pulse
    const n0 = arts.length;
    h.b._setHidden(e, true);
    e.x = g.x + 1; e.y = g.y;
    h.run(2.05);
    assert.equal(h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.type === 'arts').length, n0, 'hidden: no pulse');
  });
}

test('GitHub #93: 深溟巢涌者 keeps walking with the 炎佑 dragon in range; only its pulse (no attack) reaches the dragon', () => {
  const h = makeBattle({ seed: 7, autoFinish: false, timeLimit: 120, defs: { chess: { t_wall: WALL('t_wall') } }, kits: { t_wall: NOATK },
    units: [{ chessId: 't_wall', row: 12, col: 1 }], hooks: ['damaged'], captureNoisy: true });
  h.step();
  const [y] = spawnYanyou(h.b, 'p1', { atk: 0, hp: 50000 });
  assert.ok(y && y.isFlying, 'a flying ally');
  const e = h.spawn('enemy_1234_dsubrl', { pos: [Math.round(y.y), Math.round(y.x) + 2], routeIndex: 0, mods: { speedMul: 1 },
    route: { motion: 'WALK', start: [Math.round(y.y), Math.round(y.x) + 2], end: [Math.round(y.y), 0], checkpoints: [] } });
  const x0 = e.x;
  h.run(5);
  assert.equal(e.stats.attacks, 0, 'no normal attack');
  assert.ok(x0 - e.x >= 5 * e.s.moveSpeed * 0.5 - 0.05, `walked on (${(x0 - e.x).toFixed(2)} tiles in 5 s)`);
  const onDragon = h.hooksOf('damaged').filter((c) => c.source === e && c.target === y);
  assert.ok(onDragon.length > 0, 'the dragon in range is pulsed');
  assert.ok(onDragon.every((c) => !c.dmg.isAttack && (c.dmg.type === 'element' || c.dmg.tags.includes('nestPulse'))), 'pulse and its 神经 only');
});

for (const key of ['enemy_1267_nhpbr', 'enemy_1267_nhpbr_2']) {
  test(`${nm(key)}: death releases 污染秽蚀 — ground allies within ${tb(key, 'PollutedDie.projectile_range')} lose ${tb(key, 'PollutedDie.polluted_damage_low')} HP/s`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
    h.step();
    const e = put(h, key, [10, 7]);
    killed(h, e, null);
    h.run(3.05);
    approx(h.unit('t_wall').stats.taken, 3 * tb(key, 'PollutedDie.polluted_damage_low'));
  });

  // PRTS 特殊机制 死亡爆炸 "默认可沉默…若不处于沉默状态，将会…释放"; client template projectile_on_killed: CheckAbnormalFlag
  // SILENCED (unset) before EmitProjectile (community report of 2026-10-06, item 10: a silenced one still poisoned)
  test(`${nm(key)}: silenced when it dies, it releases no 污染秽蚀; a silence that ran out does not stop it`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
    h.step();
    const e = put(h, key, [10, 7]);
    h.b.applyStatus(e, 'silence', { duration: 30 });
    h.step();
    assert.ok(e.s.flags.silence);
    killed(h, e, null);
    h.run(3.05);
    assert.equal(h.unit('t_wall').stats.taken, 0);
    assert.equal(h.eventsOf('fx').filter((x) => x[1] === 'zone' && x[4] && x[4].kind === 'pollution').length, 0, 'no zone');
    const h2 = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
    h2.step();
    const e2 = put(h2, key, [10, 7]);
    h2.b.applyStatus(e2, 'silence', { duration: 1 });
    h2.run(1.5);
    assert.ok(!e2.s.flags.silence);
    killed(h2, e2, null);
    h2.run(3.05);
    approx(h2.unit('t_wall').stats.taken, 3 * tb(key, 'PollutedDie.polluted_damage_low'));
  });
}

for (const key of ['enemy_1270_nhstlk', 'enemy_1270_nhstlk_2']) {
  test(`${nm(key)}: attacks inflict bleeding (${tb(key, 'Bleeding.attack@bleeding_damage')} arts/s), removed by healing`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const e = put(h, key, [9, 5]);
    h.runUntil(() => e.stats.attacks >= 1, 10);
    const w = h.unit('t_wall');
    assert.ok(w.findBuff('ab:bleed'));
    killed(h, e, null);
    const t0 = w.stats.taken;
    h.run(2);
    approx(w.stats.taken - t0, 2 * tb(key, 'Bleeding.attack@bleeding_damage'));
    h.b.heal(h.unit('t_wall'), w, 1);
    assert.ok(!w.findBuff('ab:bleed'));
  });
}

for (const key of ['enemy_1272_nhtank', 'enemy_1272_nhtank_2']) {
  test(`${nm(key)}: ground targets only, melee hits ×${tb(key, 'Empty.attack@chuang_atk_scale')}, 秽蚀轰击 (a pollution zone) on the 1st attack, then every 3rd`, () => {
    const hi = arena({ units: [{ chessId: 't_gun', row: 10, col: 2 }] });   // (10,2) is high ground
    hi.step();
    put(hi, key, [10, 3]);
    hi.run(6);
    assert.equal(hi.unit('t_gun').stats.taken, 0);
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
    h.step();
    const e = put(h, key, [9, 5]);
    h.runUntil(() => e.stats.attacks >= 3, 30);
    const hits = h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.isAttack).map((c) => c.amount);
    assert.ok(hits.some((a) => Math.abs(a - e.s.atk * tb(key, 'Empty.attack@chuang_atk_scale')) < 1e-6), `${hits}`);
    assert.ok(h.eventsOf('fx').some((f) => f[1] === 'zone' && f[4].kind === 'pollution'));
  });
}

test(`${nm('enemy_9006_actoxi')}: when knocked out it throws a poison cloud at its killer (arts ATK×0.15/s)`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 11, col: 4 }] });
  h.step();
  const e = put(h, 'enemy_9006_actoxi', [10, 7]);
  const g = h.unit('t_gun');
  const atk = e.s.atk;
  killed(h, e, g);
  h.run(3.1);
  const per = atk * tb('enemy_9006_actoxi', '1.damage_atk_scale');
  assert.ok(g.stats.taken >= 2 * per - 1e-6 && g.stats.taken <= 3 * per + 1e-6, `${g.stats.taken}`);
});

test(`${nm('enemy_10122_uacann_2')}: each hit leaves a burning zone (${tb('enemy_10122_uacann_2', 'ProjectileBoomRange.attack@value')}/s)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 3 }] });
  h.step();
  const e = put(h, 'enemy_10122_uacann_2', [10, 9]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(2);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'zone' && f[4].kind === 'burning'));
  assert.ok(h.unit('t_wall').stats.taken >= e.s.atk + tb('enemy_10122_uacann_2', 'ProjectileBoomRange.attack@value') - 1e-6);
});

test(`${nm('enemy_10054_cjhot')}: pulses arts + burn around itself; immune to 停顿`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_10054_cjhot', [10, 7]);
  h.run(e.base.bat + 0.1);
  assert.ok(h.unit('t_wall').elem.burn > 0 && h.unit('t_wall').stats.taken > 0);
  assert.equal(h.b.applyStatus(e, 'sluggish', { duration: 3 }), false);
});

// ---------------------------------------------------------------------------------------------------------------
// REFLECTION 折射

for (const key of ['enemy_1165_duhond', 'enemy_1165_duhond_2', 'enemy_1166_dusbr', 'enemy_1166_dusbr_2', 'enemy_1168_dumage', 'enemy_1168_dumage_2', 'enemy_1170_dushld', 'enemy_1170_dushld_2']) {
  test(`${nm(key)}: 折射 — RES +${tb(key, 'refracting.magic_resistance')} while not silenced`, () => {
    const h = arena();
    h.step();
    const e = put(h, key, [10, 7]);
    h.step();
    assert.equal(e.s.res, Math.min(100, E[key].stats.res + tb(key, 'refracting.magic_resistance')));
    h.b.applyStatus(e, 'silence', { duration: 2 });
    h.step();
    assert.equal(e.s.res, E[key].stats.res);
    h.run(2.1);
    assert.equal(e.s.res, Math.min(100, E[key].stats.res + tb(key, 'refracting.magic_resistance')));
  });
}

for (const key of ['enemy_1169_duphlx', 'enemy_1169_duphlx_2']) {
  test(`${nm(key)}: refraction; DEF +${tb(key, 'auraDefup.def')} per other ${E[key].name} nearby (stacking)`, () => {
    const h = arena();
    h.step();
    const a = put(h, key, [10, 7]);
    put(h, key, [10, 6]);
    put(h, key, [11, 7]);
    h.run(0.6);
    assert.equal(a.s.def, E[key].stats.def + 2 * tb(key, 'auraDefup.def'));
    assert.ok(a.s.res >= 70);
  });
}

for (const key of ['enemy_1172_dugago', 'enemy_1172_dugago_2']) {
  test(`${nm(key)}: melee only while blocked; first knock-out ⇒ unblockable statue (DEF +${tb(key, 'stone.def')}, 失衡 / 浮空 immune) for ${tb(key, 'stone.duration')} s, then a flyer with ranged arts attacks that skip flyers (PRTS 天赋)`, () => {
    // 地面模式: an operator in its 1.6 radius but not blocking it is never attacked
    const h0 = arena({ units: [{ chessId: 't_gun', row: 11, col: 7 }] });
    h0.step();
    put(h0, key, [10, 7]);
    h0.run(6);
    assert.equal(h0.unit('t_gun').stats.taken, 0, 'no ranged attack in its ground mode');
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 7 }, { chessId: 't_gun', row: 11, col: 7 }], kits: { t_gun: NOATK }, hooks: ['damaged'], captureNoisy: true });
    h.step();
    const e = put(h, key, [10, 7]);
    h.step();
    killed(h, e, null);
    assert.ok(e.alive);
    assert.equal(e.hp, e.s.maxHp, 'an instant 重生 to full HP');
    assert.equal(e.s.def, E[key].stats.def + tb(key, 'stone.def'));
    h.step();
    assert.ok(e.s.flags.unblockable && e.s.flags.noDisplace && !e.blockedBy, '转换模式: 无法被阻挡, 失衡免疫');
    assert.equal(h.b.applyStatus(e, 'levitate', { duration: 2 }), false, '免疫浮空');
    h.b.dealDamage(h.unit('t_gun'), e, { amount: e.s.maxHp * 0.3, type: 'true' });
    const hp = e.hp;
    h.run(tb(key, 'stone.duration') + 0.5);
    assert.equal(e.motion, 'FLY');
    assert.ok(!e.blockedBy);
    assert.equal(e.hp, hp, 'no second refill when it takes off');
    assert.ok(h.runUntil(() => e.stats.attacks > 0, 10), '飞行模式 attacks at range');
    assert.ok(h.unit('t_gun').stats.taken + h.unit('t_wall').stats.taken > 0, 'an operator in its radius');
    assert.ok(h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.isAttack).every((c) => c.dmg.type === 'arts'), 'arts damage');
    killed(h, e, null);
    assert.ok(!e.alive, 'second knock-out is final');
  });
}

for (const key of ['enemy_1174_duholy', 'enemy_1174_duholy_2']) {
  test(`${nm(key)}: refraction + taunt; with 影刃 nearby its force field lowers operators' ASPD by ${-tb(key, 'traitAbility.attack_speed')}`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
    h.step();
    const e = put(h, key, [10, 7]);
    h.run(0.6);
    assert.equal(h.unit('t_wall').s.aspd, 100);
    assert.equal(e.s.taunt, 1);
    put(h, 'enemy_1175_dushdo_2', [11, 7]);
    h.run(0.6);
    assert.equal(h.unit('t_wall').s.aspd, 100 + tb(key, 'traitAbility.attack_speed'));
  });
}

test(`${nm('enemy_9011_acrefr')}: refraction also doubles max HP while active`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_9011_acrefr', [10, 7]);
  h.step();
  assert.equal(e.s.maxHp, E.enemy_9011_acrefr.stats.maxHp * (1 + tb('enemy_9011_acrefr', 'Refracting.max_hp')));
  assert.equal(e.s.res, 70);
  h.b.applyStatus(e, 'silence', { duration: 1 });
  h.step();
  assert.equal(e.s.maxHp, E.enemy_9011_acrefr.stats.maxHp);
});

// ---------------------------------------------------------------------------------------------------------------
// FLY 飞行

test(`${nm('enemy_1017_defdrn')}: nearby enemies get DEF +${tb('enemy_1017_defdrn', 'defup.def')} (silence stops it)`, () => {
  const h = arena();
  h.step();
  const d = put(h, 'enemy_1017_defdrn', [10, 7], { route: 2 });
  const o = put(h, 'enemy_1007_slime', [10, 6]);
  h.run(0.6);
  assert.equal(o.s.def, tb('enemy_1017_defdrn', 'defup.def'));
  h.b.applyStatus(d, 'silence', { duration: 3 });
  h.run(1);
  assert.equal(o.s.def, 0);
});

for (const key of ['enemy_1355_mrfly', 'enemy_1355_mrfly_2']) {
  test(`${nm(key)}: nearby enemies get RES +${tb(key, 'magdef_add.magic_resistance')}`, () => {
    const h = arena();
    h.step();
    put(h, key, [10, 7]);
    const o = put(h, 'enemy_1007_slime', [10, 6]);
    h.run(0.6);
    assert.equal(o.s.res, tb(key, 'magdef_add.magic_resistance'));
  });
}

test(`${nm('enemy_1042_frostd')}: operators within ${tb('enemy_1042_frostd', 'defup.range_radius')} tiles lose 50 ASPD`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 10, col: 6 }, { chessId: 't_mage', row: 12, col: 3 }] });
  h.step();
  put(h, 'enemy_1042_frostd', [10, 7]);
  h.run(0.6);
  assert.equal(h.unit('t_gun').s.aspd, 100 + tb('enemy_1042_frostd', 'atkSpeedDown.attack_speed') * 100);
  assert.equal(h.unit('t_mage').s.aspd, 100);
});

test(`${nm('enemy_1040_bombd')}: no normal attack; ONE bomb on the target + its 8 tiles, then move speed ×${skb('enemy_1040_bombd', 'boomb').bb.move_speed}`, () => {
  // PRTS 暴鸰: "不进行普通攻击" · 投弹 "对目标及其周围八格的我方单位造成100%物理伤害 … 技能结束后移速最终提升至200% ※此技能仅能触发一次"
  // (the bomb leaves on the Attack clip's OnAttack and flies 1 tile at 5 tiles/s; the speed-up when the cast ends —
  // feedback D4, test/sim/feedback1d-bombd)
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 10, col: 6 }, { chessId: 't_wall3', row: 12, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_1040_bombd', [10, 7], { route: 2 });
  const s = skb('enemy_1040_bombd', 'boomb');
  h.run(s.initCooldown + enemiesMod.BOMBD_RELEASE + enemiesMod.BOMBD_POST_DELAY + 0.1);
  const [w1, w2, w3] = ['t_wall', 't_wall2', 't_wall3'].map((id) => h.unit(id));
  approx(w2.stats.taken, e.s.atk, 1e-6, 'the target (latest deployed in range): 100 % ATK');
  approx(w1.stats.taken, e.s.atk, 1e-6, 'a tile next to it: splash 100 %');
  assert.equal(w3.stats.taken, 0, 'two rows away: outside the 3×3');
  assert.equal(e.stats.attacks, 0, 'never a normal attack');
  approx(e.findBuff('ab:bombRun').mods.moveMul, s.bb.move_speed, 1e-9, '移速最终提升至200%');
  h.run(20);
  approx(w2.stats.taken + w1.stats.taken, 2 * e.s.atk, 1e-6, 'only once');
  assert.equal(e.stats.attacks, 0);
});

for (const key of ['enemy_10083_hlbird', 'enemy_10084_hlegle', 'enemy_10085_hllevi_2']) {
  test(`${nm(key)}: first time below half HP ⇒ fear ${tb(key, 'SelfFear.fear')} s and flees faster`, () => {
    const h = arena({ hooks: ['statusApplied'] });
    h.step();
    const e = put(h, key, [10, 7], { route: 2 });
    h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' });
    const f = statuses(h, e.id, 'fear');
    assert.equal(f.length, 1);
    approx(f[0].duration, tb(key, 'SelfFear.fear'));
    assert.ok(e.findBuff('ab:fearRun'));
    approx(e.findBuff('ab:fearRun').mods.moveMul, tb(key, 'SelfFear.move_speed'), 1e-9, '移动速度最终提升至150%');
    h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    assert.equal(statuses(h, e.id, 'fear').length, 1, 'only once');
  });
}

test(`${nm('enemy_10084_hlegle')}: steals one bullet from an ammo skill instead of hitting`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 10, col: 6 }] });
  h.step();
  const g = h.unit('t_gun');
  g.skill.kind = 'ammo'; g.skill.active = true; g.skill.ammoLeft = 3;
  const e = put(h, 'enemy_10084_hlegle', [10, 7], { route: 2 });
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(0.5);
  assert.equal(g.skill.ammoLeft, 3 - tb('enemy_10084_hlegle', 'DamageOrBullet.attack@minus_bullet'));
  assert.equal(g.stats.taken, 0);
  g.skill.active = false;
});

test(`${nm('enemy_10085_hllevi_2')}: 祈祷邀约 lowers every operator's ASPD by ${-skb('enemy_10085_hllevi_2', 'Roar').bb.attack_speed}`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
  h.step();
  put(h, 'enemy_10085_hllevi_2', [10, 7], { route: 2 });
  const s = skb('enemy_10085_hllevi_2', 'Roar');
  h.run(s.initCooldown + 0.1);
  assert.equal(h.unit('t_gun').s.aspd, 100 + s.bb.attack_speed);
});

test(`${nm('enemy_1407_hummbd')}: death exposes nearby operators (damage taken ×${tb('enemy_1407_hummbd', 'Expose.damage_scale')} for ${tb('enemy_1407_hummbd', 'Expose.weak[limit]')} s)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 12, col: 3 }] });
  h.step();
  const e = put(h, 'enemy_1407_hummbd', [10, 7], { route: 2 });
  killed(h, e, null);
  approx(h.unit('t_wall').s.dmgTakenMul, tb('enemy_1407_hummbd', 'Expose.damage_scale'));
  assert.equal(h.unit('t_wall2').s.dmgTakenMul, 1);
});

test(`${nm('enemy_9009_acfort')}: grabs ≤ 3 normal flyers within 2.5 × range_radius for ammo, then fires one ATK×1.3 hit per ammo at random allies`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 12, col: 2 }] });
  h.step();
  const e = put(h, 'enemy_9009_acfort', [10, 7], { route: 2 });
  e.profile.noAttack = true;
  const k = skb('enemy_9009_acfort', 'KillOthers'), f = skb('enemy_9009_acfort', 'FireWeapon');
  const R = k.bb.range_radius * 2.5;                                   // PRTS: 半径3.75 (2.5倍可变半径)
  assert.equal(R, 3.75);
  // four prey inside 3.75 (the nearest three are taken), one outside
  const near = [[10, 7], [11, 7], [10, 9], [12, 10]].map((p) => put(h, 'enemy_1005_yokai', p, { route: 2 }));
  const out = put(h, 'enemy_1005_yokai', [9, 2], { route: 2 });
  assert.ok(Math.hypot(out.x - e.x, out.y - e.y) > R && Math.hypot(near[3].x - e.x, near[3].y - e.y) <= R);
  h.run(k.initCooldown + 0.1);
  assert.ok(e.findBuff('ab:grabbing')?.flags.bind, '黑云 holds still while grabbing');
  h.run(0.5 + k.bb.duration + 0.1);
  assert.deepEqual(near.map((y) => y.alive), [false, false, false, true], 'the nearest three are devoured');
  assert.ok(out.alive, 'out of reach');
  const w1 = h.unit('t_wall'), w2 = h.unit('t_wall2');
  // 全弹发射 fires as soon as it has ammo: 3 hits of ATK×1.3, each on a random ally of the whole field
  assert.ok(h.runUntil(() => w1.stats.taken + w2.stats.taken > 0, f.cooldown + 1));
  h.run(0.1);
  approx(w1.stats.taken + w2.stats.taken, 3 * e.s.atk * f.bb.atk_scale, 1e-6, 'one hit per ammo');
  assert.equal(e.mem.ab.ammo, 0, 'all SP spent');
  checkInvariants(h.b);
});

test(`${nm('enemy_1112_emppnt')} / 中枢: every attack is a shell that lands 3 s later on the target's spot (all allies within 1.2)`, () => {
  for (const key of ['enemy_1112_emppnt', 'enemy_1112_emppnt_2']) {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 11, col: 6 }, { chessId: 't_wall3', row: 12, col: 6 }], captureNoisy: true });
    h.step();
    const e = put(h, key, [10, 7], { route: 2 });
    assert.ok(h.runUntil(() => e.stats.attacks >= 1, 10), 'attacks');
    const [w1, w2, w3] = ['t_wall', 't_wall2', 't_wall3'].map((id) => h.unit(id));
    const t0 = h.b.time;
    assert.equal(w1.stats.taken + w2.stats.taken + w3.stats.taken, 0, 'nothing on launch');
    assert.ok(h.events.some((ev) => ev[0] === 'atk' && ev[1] === e.id && ev[3] === 'mortar'), 'attack event without a projectile');
    const shell = h.eventsOf('fx').find((ev) => ev[1] === 'bombardShell');
    assert.ok(shell, 'the shell fx (3 s flight)');
    h.run(2.8);
    assert.equal(w1.stats.taken + w2.stats.taken + w3.stats.taken, 0, 'still in the air');
    h.run(0.3);
    const hit = [w1, w2, w3].filter((w) => w.stats.taken > 0);
    // the target (latest deployed in range 2) is t_wall3 or t_wall2; the blast covers every wall within 1.2 of it
    assert.ok(hit.length >= 2 && hit.every((w) => Math.abs(w.stats.taken - e.s.atk) < 1e-6), `${key}: ${hit.map((w) => w.defId)}`);
    assert.ok(h.b.time - t0 >= 3 - 1e-6);
  }
});

test(`${nm('enemy_1112_emppnt_2')} / 先兆者: the shell's 1.2 circle takes every ally whose collider touches it — the impact tile and the 8 around it, not the cross (GitHub #364)`, () => {
  for (const key of ['enemy_1112_emppnt_2', 'enemy_1112_emppnt']) {
    // the enemy on (10, 8) reaches only the wall on (10, 6): the impact; the others stand around it, out of its reach
    const h = arena({ units: [
      { chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 10, col: 5 },
      { chessId: 't_wall3', row: 9, col: 5 }, { chessId: 't_wall4', row: 10, col: 4 },
    ], captureNoisy: true });
    h.step();
    const e = put(h, key, [10, 8], { route: 2 });
    assert.ok(h.runUntil(() => e.stats.attacks >= 1, 10), 'attacks');
    const shell = h.eventsOf('fx').find((ev) => ev[1] === 'bombardShell');
    assert.ok(Math.abs(shell[4].r - 1.45) < 1e-9, 'drawn at the reach: 1.2 + the 0.25 collider');
    h.run(3.1);
    const taken = (id) => h.unit(id).stats.taken;
    for (const [id, what] of [['t_wall', 'the impact'], ['t_wall2', 'its orthogonal neighbour (1 away)'], ['t_wall3', 'a diagonal neighbour (√2 away)']]) {
      assert.ok(Math.abs(taken(id) - e.s.atk) < 1e-6, `${key}: ${what} takes the shell`);
    }
    assert.equal(taken('t_wall4'), 0, `${key}: two tiles away stays out`);
    checkInvariants(h.b);
  }
});

test(`${nm('enemy_10084_hlegle')}: never attacks a flying ally (不会攻击飞行单位) — a ground one in range instead`, () => {
  // a flying ally (the 炎佑 is one) deployed after the wall, so the engine's order (latest deployed) would pick it
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 10, col: 8 }] });
  h.step();
  const w = h.unit('t_wall'), fly = h.unit('t_wall2');
  fly.motion = 'FLY';
  assert.ok(fly.isFlying && fly.deploySeq > w.deploySeq);
  const e = put(h, 'enemy_10084_hlegle', [10, 7], { route: 2 });
  assert.ok(h.runUntil(() => e.stats.attacks >= 1, 10));
  h.run(0.5);
  assert.equal(fly.stats.taken ?? 0, 0, 'the flyer is never hit');
  assert.ok(w.stats.taken > 0, 'the ground wall is');
});

test(`${nm('enemy_1321_wdarft')} + ${nm('enemy_1269_nhfly')}: the apostle spawns seeds that dive onto operators and self-destruct`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 4 }] });
  h.step();
  put(h, 'enemy_1321_wdarft', [9, 8], { route: 2, move: true });
  h.run(skb('enemy_1321_wdarft', 'BornBugs').initCooldown + 0.1);
  const seeds = alive(h, 'enemy_1269_nhfly');
  assert.ok(seeds.length > 0);
  h.runUntil(() => seeds.some((s) => !s.alive), 60);
  assert.ok(seeds.some((s) => !s.alive), 'a seed self-destructed');
  approx(h.unit('t_wall').stats.taken % E.enemy_1269_nhfly.stats.atk, 0, 1e-6);
  assert.ok(h.unit('t_wall').stats.taken > 0);
});

// ---------------------------------------------------------------------------------------------------------------
// SPECIAL and others

for (const key of ['enemy_1045_hammer', 'enemy_1045_hammer_2']) {
  test(`${nm(key)}: after 2 attacks the next one stuns (${skb(key, 'stuncombat').bb.stun} s)`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['statusApplied'] });
    h.step();
    const e = put(h, key, [9, 5]);
    h.runUntil(() => e.stats.attacks >= 2, 20);
    assert.equal(statuses(h, h.unit('t_wall').id, 'stun').length, 0);
    h.runUntil(() => e.stats.attacks >= 3, 20);
    assert.equal(statuses(h, h.unit('t_wall').id, 'stun').length, 1);
  });
}

for (const key of ['enemy_1116_liprr', 'enemy_1116_liprr_2', 'enemy_1118_lidbox_2', 'enemy_1119_vofsd', 'enemy_1121_lifbos', 'enemy_1121_lifbos_2']) {
  test(`${nm(key)}: confined (ASPD ${tb(key, 'confinement.attack_speed')}) until ${tb(key, 'confinement.times')} attacks, then freed (ATK +${tb(key, 'liberty.atk') * 100} %)`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const e = put(h, key, [9, 5]);
    const other = put(h, 'enemy_1116_liprr', [11, 8]);
    assert.equal(e.s.aspd, 100 + tb(key, 'confinement.attack_speed'));
    if (tb(key, 'confinement.def')) assert.equal(e.s.def, E[key].stats.def + tb(key, 'confinement.def'));
    h.runUntil(() => e.stats.attacks >= tb(key, 'confinement.times'), 60);
    assert.equal(e.s.aspd, 100);
    approx(e.s.atk, E[key].stats.atk * (1 + tb(key, 'liberty.atk')));
    if (tb(key, 'liberty.def_penetrate')) approx(e.s.defIgnorePct, tb(key, 'liberty.def_penetrate'));
    if (tb(key, 'liberty.magic_resistance')) assert.equal(e.s.res, tb(key, 'liberty.magic_resistance'));
    if (tb(key, 'liberty.hp_recovery_per_sec')) assert.equal(e.s.hpRegen, tb(key, 'liberty.hp_recovery_per_sec'));
    const freeAll = /1121/.test(key);
    assert.equal(!other.findBuff('ab:confined'), freeAll, 'first liberation of 重犯 frees every prisoner');
  });
}

// PRTS 天赋 + the client's templates dlancer_t_listener[a/b/c], dlancer_t[trigger], dlancer_t_atk (DESIGN §25.18): every
// 0.1 s 晕眩 / 束缚 end the acceleration (its layers with it), not blocked starts it; a layer of move speed +50 % every
// 0.5 s, at most 25 tries, blocked or not; a hit while it accelerates adds 当前移动速度 × 600 phys (its own instance) and
// ends it (community report of 2026-10-06, item 36: until 0.2.0 a stun kept the speed, and the hit was multiplied)
const DL = 'enemy_1072_dlancer';
const dlBase = () => E[DL].stats.moveSpeed;
const dlMul = (n) => 1 + tb(DL, 'rush.dlancer_t[trigger].move_speed') * n;
const DL_ROUTE = { motion: 'WALK', start: [9, 18], end: [9, 2], checkpoints: [] };
test(`${nm(DL)}: a layer of move speed +${tb(DL, 'rush.dlancer_t[trigger].move_speed') * 100} % every ${tb(DL, 'rush.dlancer_t[trigger].interval')} s while it walks, at most ${tb(DL, 'rush.dlancer_t[trigger].trig_cnt')}`, () => {
  const h = arena();
  h.step();
  const e = h.spawn(DL, { route: DL_ROUTE });
  h.run(0.45);
  approx(e.s.moveSpeed, dlBase(), 1e-9, 'the first layer 0.5 s after the start');
  h.run(2.6);
  approx(e.s.moveSpeed, dlBase() * dlMul(6), 1e-9, '6 layers after 3 s');
  // the cap: a pinned one (speed ×0, never blocked) keeps trying — 25 tries, then the layers stay
  const p = put(h, DL, [11, 12]);
  h.run(14);
  const max = tb(DL, 'rush.dlancer_t[trigger].trig_cnt');
  assert.equal(p.mem.ab.list[0].n, max);
  approx(p.findBuff('ab:rush').mods.moveMul, dlMul(max), 1e-9, 'capped at 25 layers');
});

test(`${nm(DL)}: a stun or a 束缚 ends the acceleration — its speed back to the base, building up again only afterwards; a slow, a freeze or a sleep does not`, () => {
  for (const [status, value, resets] of [['stun', undefined, true], ['bind', undefined, true], ['slow', 0.5, false], ['freeze', undefined, false], ['sleep', undefined, false]]) {
    const h = arena();
    h.step();
    const e = h.spawn(DL, { route: DL_ROUTE });
    h.run(3.05);
    approx(e.s.moveSpeed, dlBase() * dlMul(6), 1e-9, status);
    h.b.applyStatus(e, status, { duration: 2, value });
    h.run(2.2);
    if (resets) {
      approx(e.s.moveSpeed, dlBase(), 1e-9, `${status}: reset`);
      h.run(1.05);
      approx(e.s.moveSpeed, dlBase() * dlMul(2), 1e-9, `${status}: a fresh build-up`);
    } else assert.ok(e.s.moveSpeed > dlBase() * dlMul(6) - 1e-9, `${status}: kept (${e.s.moveSpeed})`);
  }
});

test(`${nm(DL)}: blocked, its first hit adds 当前移动速度 × ${tb(DL, 'firstattack.atk_scale')} physical damage (a second instance) and ends the acceleration; a stun between the block and the hit takes it away`, () => {
  const hitsOf = (stunAtBlock) => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 4 }], captureNoisy: true, hooks: ['damaged'] });
    h.step();
    const e = h.spawn(DL, { route: DL_ROUTE });
    let speedAtHit = null;
    h.b.on('damaged', (c) => { if (c.source === e && c.dmg.isAttack && speedAtHit === null) speedAtHit = e.s.moveSpeed; }, { priority: 100 });
    assert.ok(h.runUntil(() => e.blockedBy, 120), 'blocked');
    if (stunAtBlock) h.b.applyStatus(e, 'stun', { duration: 1 });
    assert.ok(h.runUntil(() => e.stats.attacks >= 2, 60));
    const own = h.hooksOf('damaged').filter((c) => c.source === e);
    return { e, speedAtHit, attacks: own.filter((c) => c.dmg.isAttack).map((c) => c.amount), extra: own.filter((c) => !c.dmg.isAttack).map((c) => c.amount) };
  };
  const r = hitsOf(false);
  assert.ok(r.speedAtHit > dlBase() * 4, `built up: ${r.speedAtHit}`);
  assert.deepEqual(r.attacks.map((a) => Math.round(a)), [r.e.s.atk, r.e.s.atk], 'the attacks themselves are plain');
  assert.equal(r.extra.length, 1, 'one extra instance, on the first hit only');
  approx(r.extra[0], r.speedAtHit * tb(DL, 'firstattack.atk_scale'), 1e-6, 'speed × 600 (DEF 0)');
  approx(r.e.s.moveSpeed, dlBase(), 1e-9, 'the hit ended the acceleration');
  const s = hitsOf(true);
  assert.deepEqual(s.extra, [], 'stunned after the block: no extra damage');
});

test(`${nm('enemy_1320_wdrrl_2')}: only blockers with block ≥3; first attack splashes ATK×${tb('enemy_1320_wdrrl_2', 'AOEAttack.atk_scale')} around the target`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }], chess: { t_wall: WALL('t_wall', { block: 2 }) } });
  h.step();
  const e = put(h, 'enemy_1320_wdrrl_2', [9, 5]);
  h.step(2);
  assert.ok(!e.blockedBy, 'block 2 cannot hold it');
  const h2 = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }] });
  h2.step();
  const e2 = put(h2, 'enemy_1320_wdrrl_2', [9, 5]);
  h2.runUntil(() => e2.stats.attacks >= 2, 20);
  approx(h2.unit('t_wall2').stats.taken, e2.s.atk * tb('enemy_1320_wdrrl_2', 'AOEAttack.atk_scale'));
});

test(`${nm('enemy_1302_ymtro_2')}: only blockers with block ≥4`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1302_ymtro_2', [9, 5]);
  h.step(2);
  assert.equal(e.blockWeight, 4);
  assert.ok(!e.blockedBy);
});

for (const key of ['enemy_1329_cbshld', 'enemy_1329_cbshld_2']) {
  test(`${nm(key)}: DEF/RES drop with every damage instance (−${-tb(key, 'def_reduce.def')} DEF over ${tb(key, 'def_reduce.max_stack_cnt')} hits)`, () => {
    const h = arena();
    h.step();
    const e = put(h, key, [10, 7]);
    for (let i = 0; i < 10; i++) h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    const max = tb(key, 'def_reduce.max_stack_cnt');
    approx(e.s.def, E[key].stats.def + (10 * tb(key, 'def_reduce.def')) / max);
    for (let i = 0; i < max + 10; i++) h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    assert.equal(e.s.def, Math.max(0, E[key].stats.def + tb(key, 'def_reduce.def')));
  });
}

test(`${nm('enemy_1249_lysdb_2')}: negates one physical or arts hit`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_1249_lysdb_2', [10, 7]);
  h.b.dealDamage(null, e, { amount: 5000, type: 'arts' });
  assert.equal(e.hp, e.s.maxHp);
  h.b.dealDamage(null, e, { amount: 1000, type: 'phys' });
  assert.ok(e.hp < e.s.maxHp);
});

test(`${nm('enemy_1402_tgshd_2')}: attackers are exposed (damage taken ×${tb('enemy_1402_tgshd_2', 'Expose.damage_scale')} for ${tb('enemy_1402_tgshd_2', 'Expose.weak[limit]')} s)`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 11, col: 4 }] });
  h.step();
  put(h, 'enemy_1402_tgshd_2', [10, 7]);
  h.run(1.1);
  const g = h.unit('t_gun');
  approx(g.s.dmgTakenMul, tb('enemy_1402_tgshd_2', 'Expose.damage_scale'));
});

test(`${nm('enemy_1081_sotisd')}: taunt +${tb('enemy_1081_sotisd', 'taunt.taunt_level')} (operators prefer it)`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
  h.step();
  const s = put(h, 'enemy_1081_sotisd', [11, 8]);
  const o = put(h, 'enemy_1007_slime', [10, 5]);
  assert.equal(s.s.taunt, 1);
  h.run(1.5);
  assert.ok(s.stats.taken > 0);
  assert.equal(o.stats.taken, 0);
});

test(`${nm('enemy_1427_lrnazg')}: its attack hits every operator around it`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }, { chessId: 't_wall3', row: 9, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_1427_lrnazg', [9, 5]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(0.5);
  for (const id of ['t_wall', 't_wall2', 't_wall3']) assert.ok(h.unit(id).stats.taken > 0, id);
});

for (const key of ['enemy_1422_lrsldr', 'enemy_1422_lrsldr_2']) {
  test(`${nm(key)}: attacks deal arts damage while it stands on 源石污染区 (infection tiles)`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 11, col: 6 }], flat: { rows: { 11: '##hrrriirrfrrrrrrrf##' } } });
    h.step();
    const dry = put(h, key, [9, 5]);
    const wet = put(h, key, [11, 6]);
    h.runUntil(() => dry.stats.attacks >= 1 && wet.stats.attacks >= 1, 20);
    const types = h.eventsOf('dmg');
    assert.ok(types.some((d) => d[1] === h.unit('t_wall2').id && d[3] === 'arts'));
    assert.ok(types.some((d) => d[1] === h.unit('t_wall').id && d[3] === 'phys'));
  });
}

for (const key of ['enemy_1425_lrcmra', 'enemy_1425_lrcmra_2']) {
  test(`${nm(key)}: after touching 源石污染区 it attacks with arts and pollutes around itself (HP loss, SP recovery −80 %)`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 11, col: 6 }], flat: { rows: { 11: '##hrrriirrfrrrrrrrf##' } } });
    h.step();
    const e = put(h, key, [11, 6]);
    h.run(1.3);
    assert.equal(e.mem.ab.atkType, 'arts');
    const w = h.unit('t_wall');
    approx(w.s.spRecovery, CHESS.t_wall.stats.spRecovery * (1 + tb(key, 'OrigAura.sp_recover_ratio')));
    assert.ok(w.stats.taken >= tb(key, 'OrigAura.damage'));
  });
}

test(`${nm('enemy_1430_lrrook')}: absorbs ${tb('enemy_1430_lrrook', 'takeDmg.damage_scale') * 100} % of the damage dealt to nearby ground enemies`, () => {
  const h = arena();
  h.step();
  const c = put(h, 'enemy_1430_lrrook', [10, 7], { route: 2 });
  const o = put(h, 'enemy_1007_slime', [10, 6]);
  h.b.dealDamage(null, o, { amount: 100, type: 'true' });
  const share = tb('enemy_1430_lrrook', 'takeDmg.damage_scale');
  approx(o.s.maxHp - o.hp, 100 * (1 - share));
  approx(c.s.maxHp - c.hp, 100 * share);
});

test(`${nm('enemy_1025_reveng')}: ATK +${tb('enemy_1025_reveng', 'atkup.atk') * 100} % below half HP`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_1025_reveng', [10, 7]);
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' });
  approx(e.s.atk, E.enemy_1025_reveng.stats.atk * (1 + tb('enemy_1025_reveng', 'atkup.atk')));
});

test(`${nm('enemy_1021_bslime')}: death blast deals ATK×${tb('enemy_1021_bslime', 'boom.atk_scale')} physical around it`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_1021_bslime', [10, 7]);
  killed(h, e, null);
  approx(h.unit('t_wall').stats.taken, E.enemy_1021_bslime.stats.atk * tb('enemy_1021_bslime', 'boom.atk_scale'));
});

test(`${nm('enemy_1067_snslime')}: death blast deals ATK×${tb('enemy_1067_snslime', 'boom.atk_scale')} physical and chills (cold ${tb('enemy_1067_snslime', 'boom.freeze')} s)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }], hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_1067_snslime', [10, 7]);
  killed(h, e, null);
  const w = h.unit('t_wall');
  approx(w.stats.taken, E.enemy_1067_snslime.stats.atk * tb('enemy_1067_snslime', 'boom.atk_scale'));
  assert.equal(statuses(h, w.id, 'cold').length, 1);
});

test(`${nm('enemy_1069_icebrk_2')}: ×${tb('enemy_1069_icebrk_2', 'atkup.atk_scale')} damage against frozen targets`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
  h.step();
  h.b.applyStatus(h.unit('t_wall'), 'freeze', { duration: 30 });
  const e = put(h, 'enemy_1069_icebrk_2', [9, 5]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  const d = h.hooksOf('damaged').find((c) => c.source === e);
  approx(d.amount, e.s.atk * tb('enemy_1069_icebrk_2', 'atkup.atk_scale'));
});

test(`${nm('enemy_1026_aghost')}: unblockable`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1026_aghost', [9, 5]);
  h.step(3);
  assert.ok(e.s.flags.unblockable && !e.blockedBy);
});

test(`${nm('enemy_1062_rager_2')}: loses ${tb('enemy_1062_rager_2', 'periodic_damage.damage')} HP per second`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_1062_rager_2', [10, 7]);
  h.run(3.05);
  approx(e.s.maxHp - e.hp, 3 * tb('enemy_1062_rager_2', 'periodic_damage.damage'));
});

test(`${nm('enemy_1273_stmgun_2')}: Cannon locks the highest-max-HP unit in range, bombards the highest HP% of its 9 tiles every 0.5 s up to 10 times (arts ATK×${skb('enemy_1273_stmgun_2', 'Cannon').bb.atk_scale}), 失衡免疫 + control immunity meanwhile (PRTS)`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }, { chessId: 't_wall', row: 11, col: 3 }], chess: { t_wall: WALL('t_wall', { stats: { maxHp: 2e7 } }) } });
  h.step();
  const far = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
  far.step();
  const e0 = put(far, 'enemy_1273_stmgun_2', [10, 9]);
  e0.profile.noAttack = true;
  const s = skb('enemy_1273_stmgun_2', 'Cannon');
  far.run(s.initCooldown + 1);
  assert.ok(!far.eventsOf('fx').some((f) => f[1] === 'telegraph' && f[4].kind === 'cannon'), 'nobody in its range: no cast');
  const e = put(h, 'enemy_1273_stmgun_2', [11, 5]);
  e.profile.noAttack = true;
  h.run(s.initCooldown + 0.1);
  const tel = h.eventsOf('fx').find((f) => f[1] === 'telegraph' && f[4].kind === 'cannon');
  assert.ok(tel && tel[2] === 3 && tel[3] === 11, 'centred on the highest max-HP unit\'s tile');
  assert.ok(e.findBuff('ab:cannon')?.flags.noDisplace, '失衡免疫 during the bombardment');
  assert.equal(h.b.applyStatus(e, 'stun', { duration: 1 }), false, '晕眩免疫 during it');
  h.run(5.5);
  assert.equal(h.eventsOf('fx').filter((f) => f[1] === 'explode' && f[4].kind === 'cannon').length, 10, '10 shots');
  assert.ok(h.unit('t_wall').stats.taken + h.unit('t_gun').stats.taken > 0);
  assert.ok(!e.findBuff('ab:cannon') && h.b.applyStatus(e, 'stun', { duration: 1 }) !== false, 'over afterwards');
});

for (const key of ['enemy_1501_demonk', 'enemy_10018_sgrobh']) {
  test(`${nm(key)}: attacks two targets at once`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 11, col: 7 }], captureNoisy: true, hooks: ['attack'] });
    h.step();
    const e = put(h, key, [10, 7]);
    h.runUntil(() => e.stats.attacks >= 1, 10);
    assert.equal(h.hooksOf('attack').find((c) => c.attacker === e).targets.length, 2);
  });
}

for (const key of ['enemy_2001_duckmi', 'enemy_2001_duckmi_2']) {
  // PRTS 鸭爵 "移动速度+400%" (run 4); the 鸭爵 strategy's version "受伤后移动速度+300%" (run 3): ×(1 + run)
  test(`${nm(key)}: unblockable, no attack; runs ×${1 + tb(key, 'run.attack@move_speed')} once hit`, () => {
    const h = arena();
    h.step();
    const e = put(h, key, [10, 7], { move: true });
    const v = e.s.moveSpeed;
    assert.ok(e.s.flags.unblockable);
    assert.ok(e.profile.noAttack);
    h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    approx(e.s.moveSpeed, v * (1 + tb(key, 'run.attack@move_speed')));
    h.b.dealDamage(null, e, { amount: 1, type: 'true' });
    approx(e.s.moveSpeed, v * (1 + tb(key, 'run.attack@move_speed')), 1e-6, 'once');
  });
}

test(`${nm('enemy_10159_mntrjn')}: unblockable`, () => {
  const h = arena();
  h.step();
  assert.ok(put(h, 'enemy_10159_mntrjn', [10, 7]).s.flags.unblockable);
});

test(`${nm('enemy_10001_trslim')}: below half HP it runs (move ×${1 + skb('enemy_10001_trslim', 'StartRun').bb.move_speed}, unblockable ${skb('enemy_10001_trslim', 'StartRun').bb.block_free_time} s)`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_10001_trslim', [10, 7], { move: true });
  const v = e.s.moveSpeed;
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' });
  h.step();
  assert.ok(e.s.flags.unblockable);
  approx(e.s.moveSpeed, v * (1 + skb('enemy_10001_trslim', 'StartRun').bb.move_speed));
});

test(`${nm('enemy_10027_vtsk')}: entrance barrage (${skb('enemy_10027_vtsk', 'Appear').bb.times} hits on the highest-HP unit); ranged hits ×0.8; charged triple attack`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 7 }, { chessId: 't_gun', row: 12, col: 3 }], captureNoisy: true, hooks: ['damaged'], chess: { t_wall: WALL('t_wall', { stats: { maxHp: 2e7 } }) } });
  h.step();
  const e = put(h, 'enemy_10027_vtsk', [10, 8]);
  h.run(0.6);
  const barrage = h.hooksOf('damaged').filter((c) => c.source === e && !c.dmg.isAttack);
  assert.equal(barrage.length, skb('enemy_10027_vtsk', 'Appear').bb.times);
  assert.ok(barrage.every((c) => c.target === h.unit('t_wall')), 'the highest-HP unit');
  approx(barrage[0].amount, e.s.atk);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(1);   // (its shot lands: since 0.2.0 the first strike comes at the clip's damage frame, after the barrage window)
  const d = h.hooksOf('damaged').find((c) => c.source === e && c.dmg.isAttack);
  approx(d.amount, e.s.atk * tb('enemy_10027_vtsk', 'range.attack@atk_scale_range'));
  h.run(skb('enemy_10027_vtsk', 'MultiCombat').initCooldown + 6);
  assert.ok(h.hooksOf('damaged').filter((c) => c.source === e && !c.dmg.isAttack).length > skb('enemy_10027_vtsk', 'Appear').bb.times);
});

test(`${nm('enemy_10044_wintun')}: fast with its barrel; first hit ×${skb('enemy_10044_wintun', 'BlockedBoom').bb.blockee_atk_scale} and a buff zone for enemies`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
  h.step();
  const e = put(h, 'enemy_10044_wintun', [9, 5]);
  assert.ok(e.findBuff('ab:barrel'));
  h.runUntil(() => e.stats.attacks >= 1, 10);
  approx(h.hooksOf('damaged').find((c) => c.source === e).amount, e.s.atk * skb('enemy_10044_wintun', 'BlockedBoom').bb.blockee_atk_scale);
  assert.ok(!e.findBuff('ab:barrel'));
  h.run(0.6);
  approx(e.s.dodgePhys, skb('enemy_10044_wintun', 'BlockedBoom').bb.prob);
});

test(`${nm('enemy_10045_parrot')}: 近地悬浮; sprints when first hit (final ×M0SpeedUp.move_speed — PRTS "最终提升至300%")`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_10045_parrot', [10, 7], { move: true });
  const v = e.s.moveSpeed;
  assert.ok(e.findBuff('ab:float') && e.s.flags.unblockable && e.isFlying && e.motion === 'WALK');
  h.b.dealDamage(null, e, { amount: 1, type: 'true' });
  approx(e.s.moveSpeed, v * tb('enemy_10045_parrot', 'M0SpeedUp.move_speed'));
  h.run(tb('enemy_10045_parrot', 'M0SpeedUp.duration') + 0.1);
  approx(e.s.moveSpeed, v);
});

test(`${nm('enemy_10087_hlchgr')}: spends ammo every ${tb('enemy_10087_hlchgr', 'SkillTrigger.interval')} s for permanent speed and ATK`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_10087_hlchgr', [10, 7]);
  h.run(2 * tb('enemy_10087_hlchgr', 'SkillTrigger.interval') + 0.1);
  approx(e.s.atk, E.enemy_10087_hlchgr.stats.atk * (1 + 2 * skb('enemy_10087_hlchgr', 'ForeverEnhance').bb.atk_add));
});

test(`${nm('enemy_10097_crshd')}: neural damage to its blocker every second`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_10097_crshd', [9, 5]);
  h.run(2.05);
  approx(h.unit('t_wall').elem.neural, 2 * e.s.atk * tb('enemy_10097_crshd', 'block.ep_damage_ratio'));
});

test(`${nm('enemy_10116_ymgtop')}: spinning phase deals ATK×${tb('enemy_10116_ymgtop', 'RotateDamage.attack@atk_scale')} physical around it every second; 失衡 stops it`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_10116_ymgtop', [10, 7]);
  h.run(skb('enemy_10116_ymgtop', 'SwitchModeTrigger').initCooldown + 3.05);
  const w = h.unit('t_wall');
  assert.ok(w.stats.taken >= 2 * e.s.atk * tb('enemy_10116_ymgtop', 'RotateDamage.attack@atk_scale') - 1e-6);
  // pushed towards the wall (to x 6.8): still in reach, not in contact (0.8 > block radius 0.71: the wall would
  // block it)
  h.b.displace(e, { x: -1, y: 0 }, 0.2, { force: 3 });
  h.step();
  const t0 = w.stats.taken;
  h.run(3);
  assert.equal(w.stats.taken, t0, 'no more spin damage');
});

test(`${nm('enemy_10116_ymgtop')}: 漩涡形态 — no normal attack on its blocker while it spins; no spin damage while stunned (阻止攻击)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 7 }] });
  h.step();
  const e = put(h, 'enemy_10116_ymgtop', [10, 7]);           // blocked by the wall
  const icd = skb('enemy_10116_ymgtop', 'SwitchModeTrigger').initCooldown;
  h.run(icd - 1);
  assert.ok(e.blockedBy && e.stats.attacks > 0, 'its blocked attack before the spin (初始形态 仅进行阻挡攻击)');
  h.run(1.5);
  const a0 = e.stats.attacks;
  h.run(4);
  assert.ok(e.profile.noAttack && e.stats.attacks === a0, `no normal attack while spinning (${e.stats.attacks - a0})`);
  const w = h.unit('t_wall');
  h.b.applyStatus(e, 'stun', { duration: 3, force: true });
  const t0 = w.stats.taken;
  h.run(2.5);
  assert.equal(w.stats.taken, t0, 'stunned: no spin damage');
});

test(`${nm('enemy_10118_ymgprc')}: double hits; after ${skb('enemy_10118_ymgprc', 'PowerAttack').spCost} attacks the next double hit is ×${skb('enemy_10118_ymgprc', 'PowerAttack').bb.atk_scale}`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
  h.step();
  const e = put(h, 'enemy_10118_ymgprc', [9, 5]);
  const n = skb('enemy_10118_ymgprc', 'PowerAttack').spCost + 1;                 // 4th attack (enemy SP +1 per attack)
  h.runUntil(() => e.stats.attacks >= n + 1, 60);
  const d = h.hooksOf('damaged').filter((c) => c.source === e).map((c) => Math.round(c.amount));
  const a = Math.round(e.s.atk), p = Math.round(e.s.atk * skb('enemy_10118_ymgprc', 'PowerAttack').bb.atk_scale);
  const exp = [];
  for (let i = 1; i <= n + 1; i++) exp.push(...(i === n ? [p, p] : [a, a]));
  assert.deepEqual(d.slice(0, exp.length), exp);
});

test(`${nm('enemy_10127_rkmbst_2')}: M0 shield — damage taken ×${1 - tb('enemy_10127_rkmbst_2', 'M0Shield.damage_resistance')}, ASPD +${tb('enemy_10127_rkmbst_2', 'M0Shield.attack_speed')}, barrier`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_10127_rkmbst_2', [10, 7]);
  assert.equal(e.s.aspd, 100 + tb('enemy_10127_rkmbst_2', 'M0Shield.attack_speed'));
  approx(e.s.shield, e.s.maxHp * tb('enemy_10127_rkmbst_2', 'M0Shield.init_shield_hp_ratio'));
  approx(e.s.dmgTakenMul, 1 - tb('enemy_10127_rkmbst_2', 'M0Shield.damage_resistance'));
});

test(`${nm('enemy_10156_mncrer')}: death heals nearby enemies (ATK×${tb('enemy_10156_mncrer', 'Boom.heal_scale')})`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_10156_mncrer', [10, 7]);
  const o = put(h, 'enemy_1007_slime', [10, 6.5]);
  h.b.dealDamage(null, o, { amount: 500, type: 'true' });
  killed(h, e, null);
  assert.equal(o.hp, o.s.maxHp);
});

test(`${nm('enemy_10162_mnctpt')}: three hits per attack with a small splash`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 4 }] });
  h.step();
  const e = put(h, 'enemy_10162_mnctpt', [10, 7]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(0.5);
  approx(h.unit('t_wall').stats.taken, tb('enemy_10162_mnctpt', 'Attack.attack@times') * e.s.atk);
});

test(`${nm('enemy_2010_csdcr')}: neural on hit; after ${tb('enemy_2010_csdcr', 'AttackSpeedUp.stack_cnt')} hits taken every enemy gets ASPD +${tb('enemy_2010_csdcr', 'AttackSpeedUp.attack_speed')}`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_2010_csdcr', [9, 5]);
  const o = put(h, 'enemy_1007_slime', [11, 8]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(0.5);
  approx(h.unit('t_wall').elem.neural, e.s.atk * tb('enemy_2010_csdcr', 'attack.attack@ep_damage_ratio') * e.stats.attacks);
  for (let i = 0; i < tb('enemy_2010_csdcr', 'AttackSpeedUp.stack_cnt'); i++) h.b.dealDamage(null, e, { amount: 1, type: 'true' });
  assert.equal(o.s.aspd, 100 + tb('enemy_2010_csdcr', 'AttackSpeedUp.attack_speed'));
});

test(`${nm('enemy_1364_spnaxe_2')}: heals and stacks ATK when a unit within ${tb('enemy_1364_spnaxe_2', 'Attack.range_radius')} tile is knocked out; leaves 2 inert 血珀 in place`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_1364_spnaxe_2', [10, 7]);
  const o = put(h, 'enemy_1007_slime', [10, 6.5]);
  const far = put(h, 'enemy_1007_slime', [10, 5.8]);                 // 1.2 tiles away: outside Attack.range_radius
  h.b.dealDamage(null, e, { amount: 5000, type: 'true' });
  const hp = e.hp;
  killed(h, far, null);
  assert.equal(e.hp, hp);
  killed(h, o, null);
  approx(e.hp - hp, e.s.maxHp * tb('enemy_1364_spnaxe_2', 'Attack.hp_ratio'));
  approx(e.s.atk, E.enemy_1364_spnaxe_2.stats.atk * (1 + tb('enemy_1364_spnaxe_2', 'Attack.atk')));
  const total = h.b.total;
  const x = e.x, y = e.y;
  killed(h, e, null);
  const seeds = alive(h, 'enemy_1367_dseed');
  assert.equal(seeds.length, tb('enemy_1364_spnaxe_2', 'Summon.cnt'));
  assert.equal(h.b.total, total, '血珀 are not counted (no altar in this mode)');
  h.run(20);
  for (const d of seeds) { assert.ok(d.alive); assert.ok(Math.hypot(d.x - x, d.y - y) < 0.5, 'stays where it fell'); }
  checkInvariants(h.b);
});

// leaders that only appear as bounties
test(`${nm('enemy_1050_lslime')}: 4 targets, burning DoT on hit, ASPD up below half, self-blast while blocked`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_1050_lslime', [9, 5]);
  assert.equal(e.profile.maxTargets, 4);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(0.5);
  assert.ok(h.unit('t_wall').findBuff('ab:burnDot'));
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' });
  assert.equal(e.s.aspd, 100 + tb('enemy_1050_lslime', 'selfbuff.attack_speed'));
  h.run(tb('enemy_1050_lslime', 'rangedamage.interval'));
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'explode' && f[4].kind === 'selfBlast'));
});

// PRTS 碎骨 天赋: "未被阻挡时发射榴弹对目标及其周围八格的我方单位造成相当于攻击力26%的物理伤害，并令其在5秒内防御力下降50%" ("榴弹对主
// 目标造成物理普通伤害，对溅射目标造成物理溅射伤害") — community report #14: until 0.1.3 the target took a full attack and the 4
// orthogonal neighbours 100 % ATK (no diagonal), DEF down for 3 s
test(`${nm('enemy_1500_skulsr')}: an unblocked attack is a grenade — 26 % ATK on the target and on its 8 surrounding tiles, DEF −50 % for 5 s; blocked a plain hit; ATK up below half`, () => {
  // t_wall3 is the one in range (√5): the target; t_wall2 on its diagonal, t_wall two tiles away
  const h = arena({ units: [{ chessId: 't_wall', row: 11, col: 3 }, { chessId: 't_wall2', row: 12, col: 4 }, { chessId: 't_wall3', row: 11, col: 5 }], captureNoisy: true, hooks: ['statusApplied', 'damaged'] });
  h.step();
  const e = put(h, 'enemy_1500_skulsr', [10, 7]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(1);
  const by = (u) => h.hooksOf('damaged').filter((c) => c.source === e && c.target === u);
  const main = h.unit('t_wall3'), diag = h.unit('t_wall2'), far = h.unit('t_wall');
  assert.equal(by(main).length, 1);
  assert.ok(by(main)[0].dmg.isAttack, 'the target: the attack itself (普通伤害)');
  approx(by(main)[0].amount, 0.26 * e.s.atk);
  assert.equal(by(diag).length, 1, 'a diagonal neighbour is splashed (周围八格)');
  assert.ok(!by(diag)[0].dmg.isAttack && by(diag)[0].dmg.tags.includes('splash'));
  approx(by(diag)[0].amount, 0.26 * e.s.atk);
  assert.equal(by(far).length, 0, 'two tiles away: outside the 3×3');
  for (const u of [main, diag]) {
    const d = statuses(h, u.id, 'defDown');
    assert.equal(d.length, 1);
    approx(d[0].duration, 5);
    approx(d[0].value, -tb('enemy_1500_skulsr', 'defdown.def'));
  }
  assert.equal(statuses(h, far.id, 'defDown').length, 0);
  h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.6, type: 'true' });
  approx(e.s.atk, E.enemy_1500_skulsr.stats.atk * (1 + tb('enemy_1500_skulsr', 'atkup.atk')));
  // blocked: its plain melee hit, no splash, no DEF down
  const hb = arena({ units: [{ chessId: 't_wall', row: 10, col: 7 }, { chessId: 't_wall2', row: 11, col: 7 }], captureNoisy: true, hooks: ['statusApplied', 'damaged'] });
  hb.step();
  const eb = put(hb, 'enemy_1500_skulsr', [10, 7]);
  hb.step();
  eb.atkCd = 0;                                              // (its first tick, before the block, threw a grenade)
  const n0 = hb.hooksOf('damaged').length, s0 = hb.hooksOf('statusApplied').length;
  hb.runUntil(() => hb.hooksOf('damaged').slice(n0).some((c) => c.source === eb && c.dmg.isAttack), 10);
  hb.run(0.5);
  assert.equal(eb.blockedBy, hb.unit('t_wall'));
  const hits = hb.hooksOf('damaged').slice(n0).filter((c) => c.source === eb);
  assert.deepEqual(hits.map((c) => [c.target.defId, c.dmg.isAttack]), [['t_wall', true]]);
  approx(hits[0].amount, eb.s.atk);
  assert.equal(hb.hooksOf('statusApplied').slice(s0).filter((c) => c.status === 'defDown').length, 0);
});

test(`${nm('enemy_1502_crowns')}: blinks past its blocker`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1502_crowns', [9, 7], { move: true });
  h.run(skb('enemy_1502_crowns', 'blink').initCooldown + 1);
  assert.ok(e.x < 5 - 0.5, `x ${e.x}`);
});

test(`${nm('enemy_1504_cqbw')}: C4 blasts (ATK×${skb('enemy_1504_cqbw', 'C4').bb.atk_scale}) after a fuse`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_1504_cqbw', [10, 7]);
  e.profile.noAttack = true;
  h.run(skb('enemy_1504_cqbw', 'C4').initCooldown + 1.2);
  approx(h.unit('t_wall').stats.taken, e.s.atk * skb('enemy_1504_cqbw', 'C4').bb.atk_scale);
});

test(`${nm('enemy_1509_mousek')}: opening arts-only barrier (${tb('enemy_1509_mousek', 'shield.dynamic')}) with DEF +${tb('enemy_1509_mousek', 'defup.def')} while it holds; ×${tb('enemy_1509_mousek', 'enrage.damage_scale')} damage below half`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_1509_mousek', [10, 7]);
  h.run(0.3);
  const cap = tb('enemy_1509_mousek', 'shield.dynamic'), res = E.enemy_1509_mousek.stats.res;
  assert.equal(e.s.def, E.enemy_1509_mousek.stats.def + tb('enemy_1509_mousek', 'defup.def'));
  // arts is absorbed after RES (like a shield); physical and true damage pass the barrier
  assert.equal(h.b.dealDamage(null, e, { amount: 1000, type: 'arts' }), 0);
  approx(e.mem.ab.list[0].left, cap - 1000 * (1 - res / 100));
  approx(h.b.dealDamage(null, e, { amount: 500, type: 'true' }), 500);
  const need = e.mem.ab.list[0].left / (1 - res / 100);
  approx(h.b.dealDamage(null, e, { amount: need + 1000, type: 'arts' }), 1000 * (1 - res / 100), 1e-6, 'overflow past the barrier');
  assert.equal(e.s.def, E.enemy_1509_mousek.stats.def, 'barrier broken ⇒ DEF bonus gone');
  h.b.loseHp(e, e.s.maxHp * 0.6);
  h.b.dealDamage(null, e, { amount: 1, type: 'true' });
  approx(e.s.dmgDealtMul, tb('enemy_1509_mousek', 'enrage.damage_scale'));
});

test(`${nm('enemy_1509_mousek')}: 【唱沙】 ${skb('enemy_1509_mousek', 'DriftSand').bb.damage} physical on the highest-max-HP unit's cross; 【沙狱】 ATK ${skb('enemy_1509_mousek', 'SandStorm').bb.atk * 100} % and ${skb('enemy_1509_mousek', 'SandStorm').bb.damage} arts/s on the lowest-max-HP unit and those around it`, () => {
  const big = WALL('t_wall', { stats: { maxHp: 2e7 } });
  const small = WALL('t_wall3', { stats: { maxHp: 5e6 }, atk: 100 });
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 4 }, { chessId: 't_wall2', row: 10, col: 5 }, { chessId: 't_wall3', row: 12, col: 8 }, { chessId: 't_wall4', row: 11, col: 4 }],
    chess: { t_wall: big, t_wall3: small } });
  h.step();
  const e = put(h, 'enemy_1509_mousek', [9, 9]);
  e.profile.noAttack = true;
  const ds = skb('enemy_1509_mousek', 'DriftSand'), ss = skb('enemy_1509_mousek', 'SandStorm');
  h.run(ds.initCooldown + 0.1);
  approx(h.unit('t_wall').stats.taken, ds.bb.damage, 1e-6, 'target');
  approx(h.unit('t_wall2').stats.taken, ds.bb.damage, 1e-6, 'cross neighbour');
  approx(h.unit('t_wall4').stats.taken, ds.bb.damage, 1e-6, 'cross neighbour');
  assert.equal(h.unit('t_wall3').stats.taken, 0);
  h.run(ss.initCooldown - h.b.time + 1.05);
  const w3 = h.unit('t_wall3');
  approx(w3.s.atk, 100 * (1 + ss.bb.atk));
  approx(w3.stats.taken, ss.bb.damage, 1e-6);
  checkInvariants(h.b);
});

test(`${nm('enemy_1511_mdrock')}: stacking ATK on attacks; barrier raises max HP and ASPD while it holds`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1511_mdrock', [9, 5]);
  h.run(0.3);
  assert.equal(e.s.aspd, 100 + tb('enemy_1511_mdrock', 'shield.attack_speed'));
  h.runUntil(() => e.stats.attacks >= 2, 20);
  approx(e.s.atk, E.enemy_1511_mdrock.stats.atk * (1 + 2 * tb('enemy_1511_mdrock', 'charge.attack@enemy_mdrock_s_1[charge].atk') / 6));
});

test(`${nm('enemy_1513_dekght')} + ${nm('enemy_1513_dekght_2')}: plus-shaped hits / two targets; each rages when the other dies`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }] });
  h.step();
  const a = put(h, 'enemy_1513_dekght', [9, 5]);
  const b = put(h, 'enemy_1513_dekght_2', [11, 8]);
  assert.equal(b.profile.maxTargets, 2);
  h.runUntil(() => a.stats.attacks >= 1, 10);
  assert.ok(h.unit('t_wall2').stats.taken > 0);
  killed(h, b, null);
  approx(a.s.atk, E.enemy_1513_dekght.stats.atk * (1 + tb('enemy_1513_dekght', 'triggerrage.atk')));
});

test(`${nm('enemy_1539_reid')}: ATK up below half; first KO ⇒ ${tb('enemy_1539_reid', 'Reborn.duration')} s rebirth (invulnerable, inert), back at ${tb('enemy_1539_reid', 'Reborn.hp_ratio') * 100} %; 【冲锋】 speeds up near a unit`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }], kits: { t_gun: NOATK } });
  h.step();
  const e = put(h, 'enemy_1539_reid', [10, 7]);
  const coins0 = h.result().perPlayer.p1.killed;
  killed(h, e, h.unit('t_gun'));
  assert.ok(e.alive, 'revived');
  assert.equal(h.result().perPlayer.p1.killed, coins0, 'the first KO is not a kill');
  assert.ok(e.s.flags.invulnerable && e.s.flags.untargetable);
  assert.equal(h.b.dealDamage(h.unit('t_gun'), e, { amount: 1e6, type: 'true' }), 0);
  h.run(tb('enemy_1539_reid', 'Reborn.duration') + 0.1);
  assert.ok(!e.s.flags.invulnerable);
  approx(e.hp, e.s.maxHp * tb('enemy_1539_reid', 'Reborn.hp_ratio'));
  h.b.dealDamage(null, e, { amount: 1, type: 'true' });
  approx(e.s.atk, E.enemy_1539_reid.stats.atk * (1 + tb('enemy_1539_reid', 'AtkUp.atk')));
  killed(h, e, null);
  assert.ok(!e.alive);
  // 【冲锋】 (PRTS: "仅自身未被阻挡且存在符合条件的可选目标时可触发：选择3.0半径内位于自身下个检查点前的后续路径上(包含自身当前所在地块)
  // 的距离自身最近的我方单位"; 0.1.3: any unit within the blackboard's 1.5, 隐匿 / 迷彩 ones too, off its path too)
  const rush = skb('enemy_1539_reid', 'Rush');
  const charge = (units, status = null) => {
    const hh = arena({ units });
    hh.step();
    if (status) for (const u of hh.allies()) hh.b.applyStatus(u, status, { duration: 99, source: u });
    const r = put(hh, 'enemy_1539_reid', [9, 8], { move: true });   // route 0 walks row 9 towards (9, 2)
    hh.step(2);
    return r;
  };
  const r = charge([{ chessId: 't_wall', row: 9, col: 5 }]);      // on its path, 3 tiles ahead
  assert.ok(r.findBuff('ab:rush'), 'a unit on its path within 3.0');
  approx(r.s.moveSpeed, E.enemy_1539_reid.stats.moveSpeed * (1 + rush.bb.move_speed));
  assert.ok(!charge([{ chessId: 't_wall', row: 10, col: 7 }]).findBuff('ab:rush'), 'a unit next to it but off its path: no charge');
  assert.ok(!charge([{ chessId: 't_wall', row: 9, col: 4 }]).findBuff('ab:rush'), '4 tiles ahead: beyond 3.0');
  assert.ok(!charge([{ chessId: 't_wall', row: 9, col: 6 }], 'stealth').findBuff('ab:rush'), 'a 隐匿 unit is no selectable target');
  assert.ok(!charge([{ chessId: 't_wall', row: 9, col: 6 }], 'camou').findBuff('ab:rush'), 'nor a 迷彩 one');
});

test(`${nm('enemy_2003_rockman')}: boulder stuns a non-stunned unit for ${skb('enemy_2003_rockman', 'StunAttack').bb.stun} s`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }], hooks: ['statusApplied'] });
  h.step();
  put(h, 'enemy_2003_rockman', [10, 8]);
  h.run(skb('enemy_2003_rockman', 'StunAttack').initCooldown + 1);
  const s = statuses(h, h.unit('t_wall').id, 'stun');
  assert.equal(s.length, 1);
  approx(s[0].duration, skb('enemy_2003_rockman', 'StunAttack').bb.stun);
});

test(`${nm('enemy_2004_balloon')}: takes off (unblockable) when blocked`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_2004_balloon', [9, 5]);
  h.run(skb('enemy_2004_balloon', 'TakeOff').initCooldown + 0.2);
  assert.ok(e.s.flags.unblockable && !e.blockedBy);
});

test(`${nm('enemy_2005_axetro')}: stacking ATK/ASPD while attacking, reset after ${tb('enemy_2005_axetro', 'checker.delay')} s idle`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_2005_axetro', [10, 7]);
  h.runUntil(() => e.stats.attacks >= 3, 30);
  assert.equal(e.findBuff('ab:axeStack').stacks, 3);
  h.b.retreat(h.unit('t_wall'), { permanent: true });
  h.run(tb('enemy_2005_axetro', 'checker.delay') + 1);
  assert.ok(!e.findBuff('ab:axeStack'));
});

test(`${nm('enemy_2008_flking')}: operators' ATK and DEF are halved while it lives; periodic barrier`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
  h.step();
  const e = put(h, 'enemy_2008_flking', [10, 7]);
  h.run(0.6);
  approx(h.unit('t_gun').s.atk, CHESS.t_gun.stats.atk * 0.5);
  h.run(skb('enemy_2008_flking', 'refreshshield').initCooldown);
  assert.ok(e.findBuff('ab:tombShield'));
});

test(`${nm('enemy_2048_smgrd')}: 国度 lowers ASPD around it; ×${tb('enemy_2048_smgrd', 'DamageUp.atk_scale')} against units inside`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }], captureNoisy: true, hooks: ['damaged'] });
  h.step();
  const e = put(h, 'enemy_2048_smgrd', [10, 7]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(0.6);
  assert.equal(h.unit('t_wall').s.aspd, 100 + tb('enemy_2048_smgrd', 'BlackFog.attack_speed'));
  approx(h.hooksOf('damaged').find((c) => c.source === e).amount, e.s.atk * tb('enemy_2048_smgrd', 'DamageUp.atk_scale'));
});

test(`${nm('enemy_2050_smsha')}: attacks chill and chain to ${tb('enemy_2050_smsha', 'Attack.attack@chain.max_target')} targets`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 10, col: 4 }, { chessId: 't_wall3', row: 11, col: 4 }], hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_2050_smsha', [10, 7]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(0.6);
  const hit = ['t_wall', 't_wall2', 't_wall3'].filter((id) => h.unit(id).stats.taken > 0);
  assert.equal(hit.length, 3);
  assert.ok(statuses(h, h.unit('t_wall').id, 'cold').length >= 1);
});

test(`${nm('enemy_2052_smgia')}: every 3rd attack stuns ${skb('enemy_2052_smgia', 'StunAttack').bb.stun} s`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_2052_smgia', [9, 5]);
  h.runUntil(() => e.stats.attacks >= 3, 30);
  approx(statuses(h, h.unit('t_wall').id, 'stun')[0].duration, skb('enemy_2052_smgia', 'StunAttack').bb.stun);
});

// ---------------------------------------------------------------------------------------------------------------
// abilities added in the verification pass (silence, skills of leaders, second forms, 失衡, facing)

test(`${nm('enemy_1275_dwlock_2')}: a stun during 死亡之眼 interrupts the channel — no apoptosis burst`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1275_dwlock_2', [9, 7]);
  e.profile.noAttack = true;
  const s = skb('enemy_1275_dwlock_2', 'DeathEye');
  h.run(s.initCooldown + 2.1);
  const w = h.unit('t_wall');
  assert.ok(w.stats.taken > 0, 'channel ticking');
  h.b.applyStatus(e, 'stun', { duration: 1 });
  h.run(s.bb.hit_duration + 1);
  assert.equal(w.elem.apoptosis, 0);
  assert.ok(!e.findBuff('ab:channel'));
});

test(`${nm('enemy_10044_wintun')}: its first attack (SILENCE-flagged) is plain while silenced — the barrel is kept for later`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
  h.step();
  const e = put(h, 'enemy_10044_wintun', [9, 5]);
  h.b.applyStatus(e, 'silence', { duration: 4 });
  h.runUntil(() => e.stats.attacks >= 1, 10);
  approx(h.hooksOf('damaged').find((c) => c.source === e).amount, e.s.atk);
  assert.ok(e.findBuff('ab:barrel'));
  h.run(4);
  h.runUntil(() => e.stats.attacks >= 3, 20);
  const hits = h.hooksOf('damaged').filter((c) => c.source === e).map((c) => c.amount);
  assert.ok(hits.some((v) => Math.abs(v - e.s.atk * skb('enemy_10044_wintun', 'BlockedBoom').bb.blockee_atk_scale) < 1e-6));
  assert.ok(!e.findBuff('ab:barrel'));
});

test(`${nm('enemy_1203_sfhu')}: one arts blast (ATK) on death; the steam keeps ASPD ${tb('enemy_1203_sfhu', 'DeadBoom.attack_speed')} for ${tb('enemy_1203_sfhu', 'DeadBoom.duration')} s`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_1203_sfhu', [10, 7]);
  const atk = e.s.atk;
  killed(h, e, null);
  const w = h.unit('t_wall');
  approx(w.stats.taken, atk);
  h.run(tb('enemy_1203_sfhu', 'DeadBoom.duration') - 1);
  approx(w.stats.taken, atk, 1e-6, 'a single blast');
  assert.equal(w.s.aspd, 100 + tb('enemy_1203_sfhu', 'DeadBoom.attack_speed'));
  h.run(5);
  assert.equal(w.s.aspd, 100);
});

test(`${nm('enemy_1511_mdrock')}: the barrier absorbs arts only (after RES); 刷新屏障 restores it`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_1511_mdrock', [10, 7]);
  h.run(0.2);
  const s = skb('enemy_1511_mdrock', 'RefreshShield');
  approx(e.s.maxHp, E.enemy_1511_mdrock.stats.maxHp * (1 + s.bb.max_hp));
  assert.equal(h.b.dealDamage(null, e, { amount: 1000, type: 'arts' }), 0);
  assert.ok(h.b.dealDamage(null, e, { amount: 1000, type: 'phys' }) > 0, 'physical passes');
  h.b.dealDamage(null, e, { amount: 1e5, type: 'arts' });
  approx(e.s.maxHp, E.enemy_1511_mdrock.stats.maxHp, 1e-6, 'barrier broken ⇒ HP / ASPD bonus gone');
  assert.equal(e.s.aspd, 100);
  h.run(s.initCooldown);
  assert.equal(e.s.aspd, 100 + s.bb.attack_speed, 'refreshed');
});

test(`${nm('enemy_1513_dekght')}: 蓄力攻击 — ${skb('enemy_1513_dekght', 'ChargeAttack').bb.duration} s charge (no attacks), then ATK×${skb('enemy_1513_dekght', 'ChargeAttack').bb.atk_scale} on its blocker's cross`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 11, col: 5 }, { chessId: 't_wall3', row: 12, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
  h.step();
  const e = put(h, 'enemy_1513_dekght', [10, 5]);
  const s = skb('enemy_1513_dekght', 'ChargeAttack');
  h.run(s.initCooldown + 0.1);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'telegraph' && f[4].kind === 'chargeAttack'));
  const n0 = e.stats.attacks;
  h.run(s.bb.duration - 0.2);
  assert.equal(e.stats.attacks, n0, 'disarmed while charging');
  h.run(0.3);
  const blow = (id) => h.hooksOf('damaged').filter((c) => c.source === e && !c.dmg.isAttack && c.target.id === h.unit(id).id);
  approx(blow('t_wall2')[0].amount, e.s.atk * s.bb.atk_scale);
  approx(blow('t_wall')[0].amount, e.s.atk * s.bb.atk_scale);
  assert.equal(blow('t_wall3').length, 0, 'two tiles away');
});

test(`${nm('enemy_1513_dekght_2')}: 爆炸箭 — 3 targets, ${skb('enemy_1513_dekght_2', 'TripleAttack').bb['dekght_2[aoe].interval']} s later ATK×${skb('enemy_1513_dekght_2', 'TripleAttack').bb['dekght_2[aoe].atk_scale']} arts on each cross`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 11, col: 7 }, { chessId: 't_wall3', row: 9, col: 8 }, { chessId: 't_wall4', row: 12, col: 4 }] });
  h.step();
  const e = put(h, 'enemy_1513_dekght_2', [10, 8]);
  e.profile.noAttack = true;
  const s = skb('enemy_1513_dekght_2', 'TripleAttack');
  h.run(s.initCooldown + 0.1);
  assert.equal(h.eventsOf('fx').filter((f) => f[1] === 'telegraph' && f[4].kind === 'blastArrow').length, 3);
  assert.equal(h.unit('t_wall').stats.taken, 0, 'delayed');
  h.run(s.bb['dekght_2[aoe].interval']);
  approx(h.unit('t_wall').stats.taken, e.s.atk * s.bb['dekght_2[aoe].atk_scale']);
  assert.equal(h.unit('t_wall4').stats.taken, 0, 'out of range');
});

test(`${nm('enemy_2008_flking')}: redeploy time doubled and DP recovery halved while it lives`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }], flags: { dpInit: 0 } });
  h.step();
  const e = put(h, 'enemy_2008_flking', [10, 8]);
  e.profile.noAttack = true;
  h.run(10);
  approx(h.b.getPlayer('p1').dp, 5, 0.02);
  const w = h.unit('t_wall');
  h.b.kill(w, null);
  approx(w.respawnAt - h.b.time, 2 * w.base.respawnTime, 1e-6);
});

test(`${nm('enemy_2048_smgrd')}: 【国度】 covers the 8 tiles around it (diagonals included)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 11, col: 6 }, { chessId: 't_wall2', row: 12, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_2048_smgrd', [10, 7]);
  e.profile.noAttack = true;
  h.run(0.6);
  assert.equal(h.unit('t_wall').s.aspd, 100 + tb('enemy_2048_smgrd', 'BlackFog.attack_speed'), 'diagonal');
  assert.equal(h.unit('t_wall2').s.aspd, 100, 'two tiles away');
});

test(`${nm('enemy_2050_smsha')}: 【反自然馈赠】 chains over ${skb('enemy_2050_smsha', 'ChainBuff').bb['chain.max_target']} enemies (move ×${1 + skb('enemy_2050_smsha', 'ChainBuff').bb.move_speed}, ASPD +${skb('enemy_2050_smsha', 'ChainBuff').bb.attack_speed}); silence stops it`, () => {
  const run = (silenced) => {
    const h = arena();
    h.step();
    const e = put(h, 'enemy_2050_smsha', [10, 8]);
    const others = [[10, 6], [10, 5], [11, 4], [12, 3]].map((p) => put(h, 'enemy_1007_slime', p));
    if (silenced) h.b.applyStatus(e, 'silence', { duration: 60 });
    h.run(skb('enemy_2050_smsha', 'ChainBuff').initCooldown + 0.1);
    return others.map((o) => !!o.findBuff('ab:chainBuff'));
  };
  assert.deepEqual(run(false), [true, true, true, false]);
  assert.deepEqual(run(true), [false, false, false, false]);
});

test(`${nm('enemy_2052_smgia')}: terrain damage ⇒ damage taken ×${tb('enemy_2052_smgia', 'Weak.damage_scale')} for ${tb('enemy_2052_smgia', 'Weak.weak[limit]')} s`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_2052_smgia', [10, 7]);
  h.b.dealDamage(null, e, { amount: 100, type: 'true' });
  assert.equal(e.s.dmgTakenMul, 1);
  h.b.dealDamage(null, e, { amount: 40, type: 'true', tags: ['terrain'] });
  assert.equal(e.s.dmgTakenMul, tb('enemy_2052_smgia', 'Weak.damage_scale'));
  h.run(tb('enemy_2052_smgia', 'Weak.weak[limit]') + 0.1);
  assert.equal(e.s.dmgTakenMul, 1);
});

test(`${nm('enemy_10097_crshd')} / ${nm('enemy_2085_skzjxd')}: physical / arts damage from the front ×${1 - tb('enemy_10097_crshd', 'weakness.damage_resistance')} (walking direction / the side with more operators)`, () => {
  const h = arena({ units: [{ chessId: 't_gun', row: 10, col: 3 }, { chessId: 't_mage', row: 12, col: 3 }, { chessId: 't_blade', row: 11, col: 9 }], kits: { t_gun: NOATK, t_mage: NOATK, t_blade: NOATK } });
  h.step();
  const d = put(h, 'enemy_10097_crshd', [11, 6], { move: true, route: { motion: 'WALK', start: [11, 6], end: [11, 3], checkpoints: [] } });
  const y = put(h, 'enemy_2085_skzjxd', [9, 6]);
  h.run(0.5);
  const cut = 1 - tb('enemy_10097_crshd', 'weakness.damage_resistance');
  const front = h.unit('t_gun'), back = h.unit('t_blade');           // gun / mage on the left, blade on the right
  approx(h.b.dealDamage(front, d, { amount: 1000, type: 'phys' }), (1000 - d.s.def) * cut, 1e-6, 'designer walks left: gun is in front');
  approx(h.b.dealDamage(back, d, { amount: 1000, type: 'phys' }), 1000 - d.s.def, 1e-6, 'from behind');
  approx(h.b.dealDamage(front, y, { amount: 1000, type: 'arts' }), 1000 * (1 - y.s.res / 100) * (1 - tb('enemy_2085_skzjxd', 'Weakness.damage_resistance')), 1e-6, '圆仔 faces the two operators on the left');
  approx(h.b.dealDamage(back, y, { amount: 1000, type: 'true' }), 1000, 1e-6, 'true damage is never reduced');
});

for (const key of ['enemy_2085_skzjxd', 'enemy_2085_skzjxd_2']) {
  test(`${nm(key)}: 无法攻击/被阻挡 (PRTS 天赋) — walks through a blocker, never attacks`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }], hooks: ['blocked'] });
    h.step();
    const e = put(h, key, [10, 7], { move: true, route: { motion: 'WALK', start: [10, 7], end: [10, 2], checkpoints: [] } });
    assert.ok(e.s.flags.unblockable);
    assert.ok(e.profile.noAttack);
    h.runUntil(() => e.x < 4, 60);
    assert.ok(e.x < 4, `passed the wall (x ${e.x})`);
    assert.equal(h.hooksOf('blocked').length, 0);
    assert.equal(e.stats.attacks, 0);
  });
}

test(`${nm('enemy_10098_crhro')}: 重生 once after ${tb('enemy_10098_crhro', 'reborn.duration')} s at full HP`, () => {
  const h = arena();
  h.step();
  const e = put(h, 'enemy_10098_crhro', [10, 7]);
  killed(h, e, null);
  assert.ok(e.alive && e.s.flags.untargetable);
  h.run(tb('enemy_10098_crhro', 'reborn.duration') + 0.1);
  approx(e.hp, e.s.maxHp);
  killed(h, e, null);
  assert.ok(!e.alive);
});

test('失衡: 弧光锋卫 bleeds every 0.066 s while unbalanced; 冒失的小弟 is stunned; 拥霜羽兽 drops its egg (faster, unblockable)', () => {
  const h = arena({ hooks: ['statusApplied'] });
  h.step();
  const j = put(h, 'enemy_1328_cbjedi', [10, 7]);
  const g = put(h, 'enemy_10112_ymgds', [11, 7]);
  const p = put(h, 'enemy_10141_xdpeng_2', [12, 7]);
  h.step(2);
  const hp0 = j.hp;
  // 弧光锋卫: its 失衡 state — a 受力等级 0 push holds 0.8 s (24 frames) — bleeds unbalanced_bleed.damage every .interval s
  // (PRTS "处于失衡状态时，每0.066s受到400点无来源真实持续伤害"): 12 hits; until 0.2.2 one hit per tile moved [ASSUMED]
  h.b.push(j, j.s.massLevel, { from: { x: j.x - 1, y: j.y } });
  h.b.displace(g, { x: 1, y: 0 }, 1, { force: 3 });
  h.b.displace(p, { x: 1, y: 0 }, 1, { force: 3 });
  h.step();
  assert.equal(statuses(h, g.id, 'stun').length, 1);
  approx(statuses(h, g.id, 'stun')[0].duration, tb('enemy_10112_ymgds', 'StunAfterUnbalance.stun'));
  assert.ok(p.s.flags.unblockable);
  assert.equal(p.findBuff('ab:noEgg').mods.moveMul, 1 + tb('enemy_10141_xdpeng_2', 'speed.move_speed'));
  assert.ok(p.profile.noAttack, '拥霜羽兽 失去蛋的模式: 不进行普通攻击 (no attack, so no stand for its clip)');
  assert.equal(typeof p.profile.canTarget === 'function' && p.profile.canTarget({ isFlying: true }), false, '拥霜羽兽: 不会攻击飞行单位');
  h.run(0.8);
  approx(hp0 - j.hp, 12 * tb('enemy_1328_cbjedi', 'unbalanced_bleed.damage'), 1e-6);
  // 雪孩子: pushed into high ground (row 12 col 2 is 'h' on the flat stage) ⇒ hitWall.value
  const sn = put(h, 'enemy_10138_xdsnow', [10, 3]);
  const sn2 = put(h, 'enemy_10138_xdsnow', [11, 6]);
  h.step(2);
  const s0 = sn.hp, s20 = sn2.hp;
  h.b.displace(sn, { x: -1, y: 0 }, 1, { force: 3 });                // (10,3) → wall at (10,2)
  h.b.displace(sn2, { x: 1, y: 0 }, 0.5, { force: 3 });              // open road: no collision
  h.step();
  approx(s0 - sn.hp, tb('enemy_10138_xdsnow', 'hitWall.value'));
  assert.equal(sn2.hp, s20);
  // walking alone never counts as 失衡
  const w = put(h, 'enemy_10112_ymgds', [9, 9], { move: true });
  h.run(5);
  assert.equal(statuses(h, w.id, 'stun').length, 0);
});

// multi-form leaders (悬赏 targets): the first KO is hidden (no kill, no bounty) and switches the form

test(`${nm('enemy_1512_mcmstr')}: melee ×${tb('enemy_1512_mcmstr', 'combat.attack@mcmstr_rage_attack.atk_scale')}; KO ⇒ self-destruct (stun ${skb('enemy_1512_mcmstr', 'bomb[reborning]').bb.stun} s) and after ${tb('enemy_1512_mcmstr', 'reborn.duration')} s the fleeing 大祭司 (no attack, unblockable, −${tb('enemy_1512_mcmstr', 'bird_run.damage')} HP/s)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged', 'statusApplied'] });
  h.step();
  const e = put(h, 'enemy_1512_mcmstr', [9, 5]);
  e.bounty = { coins: 4, ownerPlayerId: 'p1' };
  h.step();
  e.atkCd = 0;                                               // (its very first tick, before the block, was a ranged attack)
  const n0 = h.hooksOf('damaged').length;
  h.runUntil(() => h.hooksOf('damaged').slice(n0).some((c) => c.source === e && c.dmg.isAttack), 10);
  assert.equal(e.blockedBy, h.unit('t_wall'));
  approx(h.hooksOf('damaged').slice(n0).find((c) => c.source === e && c.dmg.isAttack).amount, e.s.atk * tb('enemy_1512_mcmstr', 'combat.attack@mcmstr_rage_attack.atk_scale'));
  killed(h, e, h.unit('t_wall'));
  assert.ok(e.alive);
  assert.equal(h.result().perPlayer.p1.coins, 0, 'no bounty for the first form');
  // PRTS: "重生开始的2.17s后进行自爆，对半径3.0范围内所有我方单位造成攻击力150%的物理伤害和16s晕眩" (0.1.3: at once, radius 2.5)
  assert.equal(statuses(h, h.unit('t_wall').id, 'stun').length, 0, 'not yet: 2.17 s into the 重生');
  h.run(2.1);
  assert.equal(statuses(h, h.unit('t_wall').id, 'stun').length, 0);
  h.run(0.2);
  const st = statuses(h, h.unit('t_wall').id, 'stun');
  assert.equal(st.length, 1);
  approx(st[0].duration, skb('enemy_1512_mcmstr', 'bomb[reborning]').bb.stun);
  h.run(tb('enemy_1512_mcmstr', 'reborn.duration') - 2.3 + 0.1);
  assert.ok(e.profile.noAttack && e.s.flags.unblockable);
  assert.equal(e.s.def, tb('enemy_1512_mcmstr', 'bird_run.def'));
  assert.equal(e.s.res, tb('enemy_1512_mcmstr', 'bird_run.magic_resistance'));
  const hp = e.hp;
  h.run(1);
  approx(hp - e.hp, tb('enemy_1512_mcmstr', 'bird_run.damage'), 0.01);
  killed(h, e, h.unit('t_wall'));
  assert.ok(!e.alive);
  assert.equal(h.result().perPlayer.p1.coins, 4);
});

test(`${nm('enemy_1516_jakill')}: 狱警 — RES +${tb('enemy_1516_jakill', 'enhance.magic_resistance')}, ranged arts, every 4th attack stuns 2 units; KO frees every prisoner ⇒ 杀手 — melee phys, DEF +${tb('enemy_1516_jakill', 'enhance.def')}, every 4th attack twice ignoring ${skb('enemy_1516_jakill', 'armorpiercing').bb.def_penetrate * 100} % DEF`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 10, col: 5 }, { chessId: 't_wall3', row: 9, col: 5 }],
    chess: { t_wall3: WALL('t_wall3', { def: 500 }) }, captureNoisy: true, hooks: ['damaged', 'statusApplied'] });
  h.step();
  const e = put(h, 'enemy_1516_jakill', [10, 7]);
  const pr = put(h, 'enemy_1116_liprr', [12, 8]);
  assert.equal(e.s.res, E.enemy_1516_jakill.stats.res + tb('enemy_1516_jakill', 'enhance.magic_resistance'));
  const iron = skb('enemy_1516_jakill', 'ironsandstorm');
  h.runUntil(() => e.stats.attacks >= iron.spCost + 1, 60);
  const hit = h.hooksOf('damaged').find((c) => c.source === e && c.dmg.isAttack);
  assert.equal(hit.dmg.type, 'arts');
  const stunned = new Set(h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.source === e).map((c) => c.target.id));
  assert.equal(stunned.size, iron.bb.max_target);
  killed(h, e, null);
  assert.ok(pr.mem.ab.list[0].free, 'prisoners freed');
  h.run(tb('enemy_1516_jakill', 'reborn.duration') + 0.1);
  assert.equal(e.s.def, E.enemy_1516_jakill.stats.def + tb('enemy_1516_jakill', 'enhance.def'));
  assert.equal(e.s.atk, E.enemy_1516_jakill.stats.atk + tb('enemy_1516_jakill', 'enhance.atk'));
  assert.equal(e.profile.melee, true);
  // killer form: melee against its blocker
  const h2 = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], chess: { t_wall: WALL('t_wall', { def: 500 }) }, captureNoisy: true, hooks: ['damaged'] });
  h2.step();
  const k = put(h2, 'enemy_1516_jakill', [9, 5]);
  killed(h2, k, null);
  h2.run(tb('enemy_1516_jakill', 'reborn.duration') + 0.1);
  const t0 = h2.b.time;
  const pierce = skb('enemy_1516_jakill', 'armorpiercing');
  h2.runUntil(() => k.stats.attacks >= pierce.spCost + 1, 60);
  const d = h2.hooksOf('damaged').filter((c) => c.source === k && c.t > t0);
  assert.ok(d.every((c) => c.dmg.type === 'phys'));
  const atk = k.s.atk, pen = pierce.bb.def_penetrate;
  approx(d[0].amount, atk - 500);
  const last = d.slice(-2).map((c) => c.amount);
  approx(last[0], atk - 500 * (1 - pen));
  approx(last[1], atk - 500 * (1 - pen));
});

test(`${nm('enemy_1517_xi')}: 纬地经天 cross on the nearest unit; 破桎而出 barrier unbroken ⇒ ATK×${skb('enemy_1517_xi', 'ShieldBurst').bb.atk_scale} arts around; KO ⇒ form 2 (invincible ${tb('enemy_1517_xi', 'reborn.invincible')} s, double hits, crosses on nearest + farthest)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 12, col: 6 }, { chessId: 't_wall3', row: 9, col: 3 }], captureNoisy: true, hooks: ['damaged'] });
  h.step();
  const e = put(h, 'enemy_1517_xi', [10, 8]);
  e.profile.noAttack = true;
  const cr = skb('enemy_1517_xi', 'CrossAttack'), sb = skb('enemy_1517_xi', 'ShieldBurst');
  h.run(cr.initCooldown + 0.1);
  approx(h.unit('t_wall').stats.taken, e.s.atk * cr.bb.atk_scale, 1e-6, 'nearest');
  approx(h.unit('t_wall2').stats.taken, e.s.atk * cr.bb.atk_scale, 1e-6, 'same column, 2 rows away: inside the cross');
  assert.equal(h.unit('t_wall3').stats.taken, 0, 'outside the cross');
  h.run(sb.initCooldown - h.b.time + 0.1);
  approx(e.s.shield, sb.bb.dynamic);
  const w0 = h.unit('t_wall').stats.taken;
  h.run(sb.bb.duration);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'explode' && f[4].kind === 'breakFree'));
  approx(h.unit('t_wall').stats.taken - w0, e.s.atk * (sb.bb.atk_scale + cr.bb.atk_scale), 1e-6, 'barrier held ⇒ blast (+ the next cross)');
  // a broken barrier never blasts
  const h3 = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h3.step();
  const x3 = put(h3, 'enemy_1517_xi', [10, 8]);
  x3.profile.noAttack = true;
  h3.run(sb.initCooldown + 0.1);
  h3.b.dealDamage(null, x3, { amount: 1e5, type: 'true' });
  h3.run(sb.bb.duration);
  assert.ok(!h3.eventsOf('fx').some((f) => f[1] === 'explode' && f[4].kind === 'breakFree'));
  killed(h, e, null);
  h.run(tb('enemy_1517_xi', 'reborn.duration') + 0.1);
  assert.ok(e.s.flags.invulnerable, 'reborn invincibility');
  approx(e.s.atk, E.enemy_1517_xi.stats.atk * (1 + tb('enemy_1517_xi', 'reborn.atk')));
  h.run(tb('enemy_1517_xi', 'reborn.invincible'));
  assert.ok(!e.s.flags.invulnerable);
});

test(`${nm('enemy_1525_blkswb')}: 抵抗; ignores ${tb('enemy_1525_blkswb', 'DefPenetrate.enemy_blkswb_t_2.def_penetrate') * 100} % of its blocker's DEF; 速杀 passes through the blocker (ATK×${skb('enemy_1525_blkswb', 'Blink').bb.atk_scale}); KO ⇒ stealth, double hits, SP cleared + disarm at every 25 % HP lost`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_blade', row: 9, col: 3 }], chess: { t_wall: WALL('t_wall', { def: 500 }) }, kits: { t_blade: NOATK }, captureNoisy: true, hooks: ['damaged', 'statusApplied'] });
  h.step();
  const e = put(h, 'enemy_1525_blkswb', [9, 6], { move: true, route: { motion: 'WALK', start: [9, 6], end: [9, 2], checkpoints: [] } });
  h.b.applyStatus(e, 'cold', { duration: 4 });
  assert.equal(statuses(h, e.id, 'cold')[0].duration, 2, '抵抗 halves');
  h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === e), 20);
  const first = h.hooksOf('damaged').find((c) => c.source === e);
  approx(first.amount, e.s.atk * skb('enemy_1525_blkswb', 'Blink').bb.atk_scale - 500, 1e-6, '速杀 on its blocker');
  assert.ok(e.x < 5 - 0.4, `passed through (x ${e.x})`);
  // form 2
  const CASTER = chessRec({ id: 't_caster', profession: 'CASTER', projectile: 'none', stats: { atk: 1, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: { spCost: 999 } });
  const h2 = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_caster', row: 10, col: 4 }], chess: { t_wall: WALL('t_wall', { def: 500 }), t_caster: CASTER },
    captureNoisy: true, hooks: ['damaged', 'statusApplied'] });
  h2.step();
  const k = put(h2, 'enemy_1525_blkswb', [9, 5]);
  // its 速杀 held back so it keeps fighting the wall (form 2's starts from its initial cooldown 0 when the 重生 ends)
  for (const a of k.mem.ab.list) if (a.id === 'blink') a.left = 999; else if (a.id === 'blink2') a.cond = () => false;
  killed(h2, k, null);
  assert.ok(h2.runUntil(() => k.form === 'form2', 10), 'the 重生 ends');
  // PRTS 特殊机制 §重生 "重生结束时，重置自身的通用技能与当前形态的技能冷却为初始冷却"
  const b1 = k.mem.ab.list.find((a) => a.id === 'blink');
  assert.ok(b1.left > (b1.icd ?? 0) - 0.04 && b1.left <= (b1.icd ?? 0) + 1e-9, `速杀 (held at 999) back to its initial cooldown (${b1.left} vs ${b1.icd})`);
  h2.run(tb('enemy_1525_blkswb', 'Reborn.invincible') + 0.1);
  assert.ok(k.s.flags.stealth, 'second form: 隐匿');
  const t0 = h2.b.time, a0 = k.stats.attacks;
  h2.runUntil(() => k.stats.attacks >= a0 + 1, 20);
  h2.step();
  const pen2 = tb('enemy_1525_blkswb', 'DefPenetrate.enemy_blkswb_t_2[reborn].def_penetrate');
  const hits = h2.hooksOf('damaged').filter((c) => c.source === k && c.t > t0 && c.target === h2.unit('t_wall'));
  assert.equal(hits.length, 2, 'double hit');
  for (const c of hits) approx(c.amount, k.s.atk - 500 * (1 - pen2));
  const cs = h2.unit('t_caster');
  assert.ok(cs.skill.sp > 5);
  h2.b.loseHp(k, k.s.maxHp * 0.3);
  h2.b.dealDamage(null, k, { amount: 1, type: 'true' });
  assert.ok(cs.skill.sp < 0.1, 'SP cleared');
  assert.equal(statuses(h2, cs.id, 'disarm').length, 1);
  approx(statuses(h2, cs.id, 'disarm')[0].duration, tb('enemy_1525_blkswb', 'ClearSp.duration'));
});

test(`${nm('enemy_1535_wlfmster')}: −${tb('enemy_1535_wlfmster', 'Passive.damage_resistance') * 100} % damage and not stunnable; 溶血骇惧 (3 units, ASPD ${skb('enemy_1535_wlfmster', 'FearCage').bb.attack_speed}, HP loss rising to ${skb('enemy_1535_wlfmster', 'FearCage').bb.hp_ratio * 100} %/s over ${skb('enemy_1535_wlfmster', 'FearCage').bb.duration_bleed} s, no end, cured after it loses ${-skb('enemy_1535_wlfmster', 'FearCage').bb.hp_ratio_offset * 100} %); KO ⇒ ${tb('enemy_1535_wlfmster', 'Reborn.duration')} s 远古威慑 (r 1.5, −50) ⇒ ranged double hits within 1.25, 远古威慑 still on`, () => {
  // PRTS 扎罗，“狼之主”: 天赋 "【远古威慑】：自身1.5半径范围内的我方单位攻击速度-50(指定状况下生效)", "重生期间【远古威慑】生效", second form
  // "【远古威慑】生效 … 攻击范围半径1.25"; 溶血骇惧 "逐渐流失生命（从0/秒开始线性递增，在40秒后达到最大流失速度30%最大生命值/秒），持续时间
  // 无限 … 累计损失20%生命值后解除" (0.1.3: 2.5 / −30 only while reborning, range 2.5, a 5 % peak for 40 s, cured at 30 %)
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 11, col: 5 }, { chessId: 't_wall3', row: 12, col: 5 }, { chessId: 't_wall4', row: 9, col: 5 }], hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_1535_wlfmster', [10, 6]);
  e.profile.noAttack = true;
  approx(e.s.dmgTakenMul, 1 - tb('enemy_1535_wlfmster', 'Passive.damage_resistance'));
  assert.equal(h.b.applyStatus(e, 'stun', { duration: 2 }), false);
  const fc = skb('enemy_1535_wlfmster', 'FearCage');
  h.run(fc.spCost + 0.1);
  const caged = h.allies().filter((u) => u.findBuff('ab:fearCage'));
  assert.equal(caged.length, fc.bb.max_target);
  assert.equal(caged[0].s.aspd, 100 + fc.bb.attack_speed);
  const hp0 = caged[0].hp, mh = caged[0].s.maxHp;
  h.run(10);
  // 1 tick per second at maxHp × hp_ratio × t / duration_bleed: 10 ticks ≈ 30 % × (0+1+…+10)/40 of max HP
  approx((hp0 - caged[0].hp) / mh, fc.bb.hp_ratio * 55 / fc.bb.duration_bleed, 0.03, 'linear loss rate');
  assert.equal(caged[0].findBuff('ab:fearCage').duration, Infinity, '"持续时间无限"');
  e.mem.ab.list.find((a) => a.fire).left = 0;               // its cooldown over: still no cast while units are caught
  h.step(3);
  assert.equal(h.allies().filter((u) => u.findBuff('ab:fearCage')).length, fc.bb.max_target, 'no new cast while units are caught (静默)');
  h.b.loseHp(e, e.s.maxHp * (-fc.bb.hp_ratio_offset - 0.02));
  h.run(0.3);
  assert.equal(h.allies().filter((u) => u.findBuff('ab:fearCage')).length, fc.bb.max_target, 'not yet cured at 18 %');
  h.b.loseHp(e, e.s.maxHp * 0.03);
  h.run(0.3);
  assert.equal(h.allies().filter((u) => u.findBuff('ab:fearCage')).length, 0, 'cured at 20 %');
  h.run(fc.bb.duration_wait - 0.7);
  assert.equal(h.allies().filter((u) => u.findBuff('ab:fearCage')).length, 0, '"场上技能效果全部结束时狼之主获得7s静默"');
  h.run(0.6);
  assert.equal(h.allies().filter((u) => u.findBuff('ab:fearCage')).length, fc.bb.max_target, 'cast again once the 静默 is over');
  killed(h, e, null);
  assert.equal(h.allies().filter((u) => u.findBuff('ab:fearCage')).length, 0, '重生: every 溶血骇惧 ends');
  assert.ok(e.alive && e.s.flags.untargetable);
  h.run(tb('enemy_1535_wlfmster', 'Reborn.duration') / 2);
  approx(e.hpRatio, 0.5, 0.05, 'HP refills during 远古威慑');
  assert.equal(h.unit('t_wall').s.aspd, 100 - 50, 'aura slows the units within 1.5');
  assert.equal(h.unit('t_wall4').s.aspd, 100 - 50, '√2 away: inside');
  assert.equal(h.unit('t_wall3').s.aspd, 100, '√5 away: outside');
  h.run(tb('enemy_1535_wlfmster', 'Reborn.duration') / 2 + 0.1);
  assert.equal(h.unit('t_wall').s.aspd, 100 - 50, 'second form: 远古威慑 still on');
  assert.equal(e.base.rangeRadius, 1.25, 'second-form attack radius');
  approx(e.hpRatio, 1);
  assert.equal(e.s.dmgTakenMul, 1, 'no damage reduction any more');
  assert.equal(e.profile.melee, false);
  assert.ok(e.s.flags.invulnerable, 'Passive2.invincible_time');
  assert.equal(h.b.applyStatus(e, 'stun', { duration: 1 }), true, 'stunnable in the second form');
});

test(`${nm('enemy_10081_mpplai')}: original form cancels every damage instance; 4th physical hit ⇒ 寻仇者 (melee), 4th arts hit ⇒ 特战术师 (ranged arts), blocked ⇒ 幽灵 (unblockable) — each after a ${TRANSLATOR_CHANGE} s change`, () => {
  const mk = () => { const h = arena({ units: [{ chessId: 't_gun', row: 12, col: 3 }, { chessId: 't_mage', row: 12, col: 4 }], kits: { t_gun: NOATK, t_mage: NOATK } }); h.step(); return h; };
  let h = mk();
  let e = put(h, 'enemy_10081_mpplai', [10, 7]);
  const hp = e.hp;
  for (let i = 0; i < 4; i++) assert.equal(h.b.dealDamage(h.unit('t_gun'), e, { amount: 1e6, type: 'phys' }), 0);
  assert.equal(e.hp, hp, 'no damage lands in the original form');
  h.run(TRANSLATOR_CHANGE + 0.05);
  approx(e.s.atk, E.enemy_10081_mpplai.stats.atk + tb('enemy_10081_mpplai', 'Mode_Fuchou_Passive.atk'));
  approx(e.s.maxHp, E.enemy_10081_mpplai.stats.maxHp + tb('enemy_10081_mpplai', 'Mode_Fuchou_Passive.max_hp'));
  const h2 = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h2.step();
  const f = put(h2, 'enemy_10081_mpplai', [10, 7]);
  for (let i = 0; i < 4; i++) h2.b.dealDamage(null, f, { amount: 1, type: 'arts' });
  // arts hits from nobody (terrain) do not count
  h2.run(TRANSLATOR_CHANGE + 0.05);
  assert.equal(f.findBuff('ab:form'), null);
  h = mk();
  e = put(h, 'enemy_10081_mpplai', [11, 5]);
  for (let i = 0; i < 4; i++) h.b.dealDamage(h.unit('t_mage'), e, { amount: 10, type: 'arts' });
  h.run(TRANSLATOR_CHANGE + 0.05);
  approx(e.s.res, E.enemy_10081_mpplai.stats.res + tb('enemy_10081_mpplai', 'Mode_Shushi_Passive.magic_resistance'));
  h.run(3);
  assert.ok(e.stats.attacks > 0 && h.unit('t_gun').stats.taken + h.unit('t_mage').stats.taken > 0, '特战术师 attacks in range');
  const h3 = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h3.step();
  const g = put(h3, 'enemy_10081_mpplai', [9, 5]);
  h3.run(TRANSLATOR_CHANGE + 0.3);
  assert.ok(g.findBuff('ab:form') && g.s.flags.unblockable, '幽灵');
  assert.equal(g.stats.attacks, 0);
});

test(`${nm('enemy_10144_xdelk_2')}: 角力对决 — blocked ⇒ ${skb('enemy_10144_xdelk_2', 'skill').bb.duration} s charge; the push fails ⇒ ×2 damage and a ${tb('enemy_10144_xdelk_2', 'data.attack@fail_duration')} s stun; a stun interrupts`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['statusApplied', 'damaged'] });
  h.step();
  const e = put(h, 'enemy_10144_xdelk_2', [9, 5]);
  const s = skb('enemy_10144_xdelk_2', 'skill');
  h.run(1);
  assert.ok(e.findBuff('ab:elkCharge'));
  const n = e.stats.attacks;
  h.run(s.bb.duration - 1.5);
  assert.equal(e.stats.attacks, n, 'no attacks while charging');
  assert.equal(statuses(h, h.unit('t_wall').id, 'stun').length, 0);
  h.runUntil(() => statuses(h, h.unit('t_wall').id, 'stun').length > 0, 3);
  const clash = h.hooksOf('damaged').find((c) => c.source === e && !c.dmg.isAttack);
  approx(clash.amount, e.s.atk * s.bb.atk_scale_s * 2);
  approx(statuses(h, h.unit('t_wall').id, 'stun')[0].duration, tb('enemy_10144_xdelk_2', 'data.attack@fail_duration'));
  // interrupted
  const h2 = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], hooks: ['statusApplied'] });
  h2.step();
  const k = put(h2, 'enemy_10144_xdelk_2', [9, 5]);
  h2.run(1);
  h2.b.applyStatus(k, 'stun', { duration: 1 });
  h2.run(s.bb.duration + 1);
  assert.equal(statuses(h2, h2.unit('t_wall').id, 'stun').length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// leaders: shared rules

test('最终攻势: leaders take no 侵蚀 (erosion) damage; other enemies do', () => {
  const h = bossArena();
  h.step();
  const e = put(h, 'enemy_9021_acduml', [3, 10], { tag: 'boss' });
  const o = put(h, 'enemy_1007_slime', [3, 8]);
  assert.equal(h.b.dealDamage(null, e, { type: 'element', element: 'erosion', amount: 5000 }), 0);
  assert.equal(e.elem.erosion, 0);
  assert.ok(h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 100 }) > 0);
  assert.ok(h.b.dealDamage(null, o, { type: 'element', element: 'erosion', amount: 100 }) > 0);
});

test('template overrides of talents/skills are honoured (卢西恩 evade 0.2 in act2autochess_h07_05)', () => {
  const h = arena({ kind: 'boss', sharedBoss: pool(1e6), setup(b) { b.enemyOverrides = W.act2autochess_h07_05.overrides; } });
  h.step();
  const e = put(h, 'enemy_2016_csphtm', [3, 12], { tag: 'boss' });
  h.step(2);
  assert.equal(e.s.dodgePhys, W.act2autochess_h07_05.overrides.enemy_2016_csphtm.talents.bb['evade.prob']);
});

// ---------------------------------------------------------------------------------------------------------------
// leaders (boss rounds: field rows 0–5; board rows 9–12 map to 2–5)

const bossArena = (o = {}) => arena({ kind: 'boss', sharedBoss: pool(o.hp ?? 1e6), ...o });
const setTpl = (id) => (b) => { b.opts.templateId = id; };

// PR #272 (感谢 @CXUtk): a leader's mid-fight summons are enemies like any other — the round's effects reach them
test('leader summons take the round\'s enemy effects (flags.enemyScale): HP — hit counts too — ATK, speed; the leader keeps the pool', () => {
  const enemyScale = { hpMul: 2, atkMul: 1.5, speedMul: 1.15, supplyHpMul: 1.08 };
  const stats = (u, msg) => {
    assert.ok(u, msg);
    const d = E[u.defId].stats;
    approx(u.base.atk, d.atk * 1.5, 1e-9, `${msg}: ATK`);
    approx(u.base.moveSpeed, d.moveSpeed * 1.15, 1e-9, `${msg}: speed`);
  };
  for (const [key, tpl] of [['enemy_9013_acstmk', 'act1autochess_h07_01'], ['enemy_9013_acstmk_2', 'act1autochess_h08_01']]) {
    const h = bossArena({ flags: { enemyScale }, units: [{ chessId: 't_wall', row: 10, col: 6 }], setup: setTpl(tpl) });
    h.step();
    const boss = put(h, key, [3, 10], { tag: 'boss', mods: { atkMul: 1.5, speedMul: 1.15 } });
    boss.profile.noAttack = true;
    assert.equal(boss.s.maxHp, h.b.sharedBoss.maxHp, `${key}: the leader's HP is the pool`);
    assert.ok(h.runUntil(() => alive(h, 'enemy_1005_yokai').length > 0, 90), `${key}: 死亡集群`);
    const drone = alive(h, 'enemy_1005_yokai')[0];
    stats(drone, `${key} 妖怪`);
    approx(drone.s.maxHp, E.enemy_1005_yokai.stats.maxHp * 2 * (skb(key, '2').bb['summon.hp_ratio'] ?? 1), 1e-9, `${key} 妖怪: HP × the round × its summon.hp_ratio`);
    assert.ok(h.runUntil(() => alive(h, 'enemy_9016_acstmr').length > 0, 90), `${key}: 刺胄之弹`);
    const shell = alive(h, 'enemy_9016_acstmr')[0];
    stats(shell, `${key} 刺胄之弹`);
    assert.equal(shell.s.maxHp, E.enemy_9016_acstmr.stats.maxHp * 2, `${key} 刺胄之弹: hits × the round's HP`);
  }
  const p = bossArena({ flags: { enemyScale }, setup: setTpl('act1autochess_h07_03') });
  p.step();
  put(p, 'enemy_9021_acduml', [3, 10], { tag: 'boss', mods: { atkMul: 1.5, speedMul: 1.15 } });
  assert.ok(p.runUntil(() => alive(p, 'enemy_9023_acdums').length > 0, 90), '假想敌：管 summons');
  const echo = alive(p, 'enemy_9023_acdums')[0];
  stats(echo, '余音');
  assert.equal(echo.s.maxHp, E.enemy_9023_acdums.stats.maxHp * 2, '余音: hits × the round\'s HP');
  // without the flag (tools, tests): the data's numbers
  const q = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 6 }], setup: setTpl('act1autochess_h07_01') });
  q.step();
  put(q, 'enemy_9013_acstmk', [3, 10], { tag: 'boss' }).profile.noAttack = true;
  assert.ok(q.runUntil(() => alive(q, 'enemy_9016_acstmr').length > 0, 90));
  assert.equal(alive(q, 'enemy_9016_acstmr')[0].s.maxHp, E.enemy_9016_acstmr.stats.maxHp);
});

test('假想敌：胄: arts ray on a random target in range; <20 % pool: damage taken ×0.5, still one 刺胄之弹 (PRTS 能力修正)', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 12, col: 4 }] });
  h.step();
  const e = put(h, 'enemy_9013_acstmk', [3, 10], { tag: 'boss' });
  h.run(9);
  const arts = h.eventsOf('dmg').filter((d) => d[3] === 'arts' && (d[1] === h.unit('t_wall').id || d[1] === h.unit('t_wall2').id));
  assert.ok(arts.length >= 2);
  h.b.sharedBoss.hp = h.b.sharedBoss.maxHp * 0.1;
  h.run(0.5);
  approx(e.s.physTakenMul, tb('enemy_9013_acstmk', '1.damage_scale'));
  approx(e.s.artsTakenMul, tb('enemy_9013_acstmk', '1.damage_scale'));
  assert.equal(e.s.trueTakenMul, 1);
  h.run(skb('enemy_9013_acstmk', '1').initCooldown - 9);
  assert.equal(h.eventsOf('fx').filter((f) => f[1] === 'shell').length, 1);
  assert.equal(alive(h, 'enemy_9016_acstmr').length, 1);
});

test('假想敌：胄 + 刺胄之弹: the shell flies to the highest-ATK operator; on arrival 3×3 stun + physical DoT; 8 hits shoot it down', () => {
  const hi = WALL('t_wall', { atk: 900 });
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 10, col: 7 }, { chessId: 't_wall3', row: 12, col: 3 }], chess: { t_wall: hi }, hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_9013_acstmk', [3, 10], { tag: 'boss' });
  e.profile.noAttack = true;
  h.run(skb('enemy_9013_acstmk', '1').initCooldown + 0.1);
  const shell = alive(h, 'enemy_9016_acstmr')[0];
  assert.ok(shell, 'shell launched');
  assert.equal(shell.s.maxHp, E.enemy_9016_acstmr.stats.maxHp);
  const target = h.unit('t_wall');
  h.runUntil(() => !shell.alive, 60);
  const st = statuses(h, target.id, 'stun');
  assert.equal(st.length, 1);
  approx(st[0].duration, tb('enemy_9016_acstmr', 'killed.duration'));
  assert.equal(statuses(h, h.unit('t_wall2').id, 'stun').length, 1, 'neighbour tile stunned too');
  assert.equal(statuses(h, h.unit('t_wall3').id, 'stun').length, 0);
  assert.ok(target.findBuff('boss:helmShellDot'));
  // a second shell is shot down: 8 hits, no explosion
  h.run(skb('enemy_9013_acstmk', '1').cooldown - (h.b.time - skb('enemy_9013_acstmk', '1').initCooldown) + 0.2);
  const s2 = alive(h, 'enemy_9016_acstmr')[0];
  assert.ok(s2);
  for (let i = 0; i < E.enemy_9016_acstmr.stats.maxHp; i++) h.b.dealDamage(h.unit('t_wall3'), s2, { amount: 1, type: 'phys' });
  assert.ok(!s2.alive);
});

test('假想敌：胄 死亡集群: drones from the branch; a drone that dies (whoever kills it) costs the leader 2 % max HP, a leak nothing', () => {
  const h = bossArena({ hp: 675000, units: [{ chessId: 't_gun', row: 12, col: 3 }], kits: { t_gun: NOATK }, setup: setTpl('act1autochess_h07_01') });
  h.step();
  const boss = put(h, 'enemy_9013_acstmk', [3, 10], { tag: 'boss' });
  h.step();
  const s2 = skb('enemy_9013_acstmk', '2');
  const loss = 675000 * s2.bb.hp_ratio;
  const d = alive(h, 'enemy_1005_yokai')[0];
  assert.ok(d, 'drone summoned at once (icd 0)');
  assert.equal(d.s.maxHp, E.enemy_1005_yokai.stats.maxHp, 'boss_1 drones: no summon.hp_ratio — data HP (max_hp is not read)');
  let before = h.b.sharedBoss.hp;
  h.b.kill(d, h.unit('t_gun'));
  approx(before - h.b.sharedBoss.hp, loss);
  const newest = () => alive(h, 'enemy_1005_yokai').sort((a, b) => b.id - a.id)[0];
  h.run(s2.cooldown + 0.5);
  const d2 = newest();
  assert.ok(d2);
  before = h.b.sharedBoss.hp;
  h.b.kill(d2, null);                                                   // 无来源: "该无人机单位死亡时"
  approx(before - h.b.sharedBoss.hp, loss);
  h.run(s2.cooldown);
  const d3 = newest();
  assert.notEqual(d3, d2);
  assert.ok(d3);
  before = h.b.sharedBoss.hp;
  h.b.leak(d3);
  assert.equal(h.b.sharedBoss.hp, before, 'a leaked drone does not die');
  approx(h.result().perPlayer.p1.bossDamage, loss, 1e-6, 'only the operator kill is credited');
  assert.ok(boss.alive);
});

test('假想敌：胄 死亡集群: the 2 % reads the leader\'s shown max HP (the pool)', () => {
  // PRTS "该妖怪死亡时令假想敌：胄受到最大生命值2%的真实伤害" — which max HP is [ASSUMED] (DESIGN §20.10): default 'pool' = the
  // HP the battle shows (synced to the shared pool, the same HP the <20 % talent reads), so 2 % of the bar in every mode:
  // 72 000 with the 终极 pool (3 600 000); the 'unit' reading (data 600 000 → 12 000) stays a switch
  assert.equal(DRONE_LINK_BASE, 'pool');
  const h = bossArena({ hp: 3600000, units: [{ chessId: 't_gun', row: 12, col: 3 }], setup: setTpl('act1autochess_h07_01') });
  h.step();
  const boss = put(h, 'enemy_9013_acstmk', [3, 10], { tag: 'boss' });
  h.step();
  assert.equal(boss.s.maxHp, 3600000, 'the unit shows the pool');
  assert.equal(droneLinkBase(boss), 3600000, 'the link reads the shown max HP (the pool)');
  assert.equal(droneLinkBase(boss, 'unit'), 600000, "the 'unit' switch reads the data max HP");
  const d = alive(h, 'enemy_1005_yokai')[0];
  assert.ok(d, 'drone summoned at once (icd 0)');
  const before = h.b.sharedBoss.hp;
  h.b.kill(d, h.unit('t_gun'));
  approx(before - h.b.sharedBoss.hp, 3600000 * skb('enemy_9013_acstmk', '2').bb.hp_ratio);
  approx(before - h.b.sharedBoss.hp, 72000);
  assert.ok(h.result().perPlayer.p1.bossDamage >= 72000 - 1e-6);
  // a solo-sized pool (标准 247 500 × 0.25): still 2 % of the bar, never the 19 % a fixed 12 000 would take
  const solo = bossArena({ hp: 61875, units: [{ chessId: 't_gun', row: 12, col: 3 }], setup: setTpl('act1autochess_h07_01') });
  solo.step();
  put(solo, 'enemy_9013_acstmk', [3, 10], { tag: 'boss' });
  solo.step();
  const d2 = alive(solo, 'enemy_1005_yokai')[0];
  assert.ok(d2);
  const b2 = solo.b.sharedBoss.hp;
  solo.b.kill(d2, solo.unit('t_gun'));
  approx(b2 - solo.b.sharedBoss.hp, 61875 * 0.02);
  const hidden = bossArena({ hp: 7200000 });
  hidden.step();
  const hb = put(hidden, 'enemy_9013_acstmk_2', [3, 10], { tag: 'boss' });
  hidden.step();
  assert.equal(droneLinkBase(hb), 7200000, '隐秘核心 终极: 144 000 per drone');
  assert.equal(droneLinkBase(hb, 'unit'), 1200000);
});

test('假想敌：胄 (隐秘核心) 死亡集群 past 限伤: with 3 / 4 players alive the drone share (432 000 / 576 000) still lands — a share, no hit (DESIGN §25.13.4)', () => {
  // the pool counts every player alive at the fight's start (the owner's decision of 2026-10-06, PR #209): hidden 胄 终极
  // 7 200 000 × 3 / × 4 — 2 % is ≥ BOSS_HIT_LIMIT (300000), which cancels a hit; the drone link is no hit
  for (const [n, loss] of [[3, 432000], [4, 576000]]) {
    const h = bossArena({ kind: 'hidden', hp: 7200000 * n, units: [{ chessId: 't_gun', row: 12, col: 3 }], setup: setTpl('act1autochess_h08_01') });
    h.step();
    const boss = put(h, 'enemy_9013_acstmk_2', [3, 10], { tag: 'boss' });
    boss.profile.noAttack = true;
    h.run(skb('enemy_9013_acstmk_2', '2').initCooldown + 0.1);
    const d = alive(h, 'enemy_1005_yokai')[0];
    assert.ok(d, `${n} players: a drone`);
    const before = h.b.sharedBoss.hp;
    h.b.kill(d, h.unit('t_gun'));
    approx(before - h.b.sharedBoss.hp, loss, 1e-6, `${n} players: 2 % of ${7200000 * n}`);
    assert.ok(!h.eventsOf('fx').some((f) => f[1] === 'hitCap'), `${n} players: not cancelled`);
    // a hit of the same size is still cancelled (限伤)
    const hp = h.b.sharedBoss.hp;
    h.b.dealDamage(h.unit('t_gun'), boss, { amount: loss, type: 'true', canDodge: false });
    assert.equal(h.b.sharedBoss.hp, hp, `${n} players: a ${loss} hit is cancelled`);
    assert.ok(h.eventsOf('fx').some((f) => f[1] === 'hitCap'));
  }
});

test('假想敌：胄 (隐秘核心) 死亡集群: summon.hp_ratio scales the drone HP', () => {
  const h = bossArena({ units: [{ chessId: 't_gun', row: 12, col: 3 }], setup: setTpl('act1autochess_h08_01') });
  h.step();
  put(h, 'enemy_9013_acstmk_2', [3, 10], { tag: 'boss' }).profile.noAttack = true;
  const s2 = skb('enemy_9013_acstmk_2', '2');
  h.run(s2.initCooldown + 0.1);
  const d = alive(h, 'enemy_1005_yokai')[0];
  assert.ok(d);
  approx(d.s.maxHp, E.enemy_1005_yokai.stats.maxHp * s2.bb['summon.hp_ratio']);
});

for (const key of ['enemy_9013_acstmk', 'enemy_9013_acstmk_2']) {
  test(`${nm(key)}: shells only at operators within its range (PRTS 技能 "选择攻击范围内攻击力最高的1名我方干员")`, () => {
    const hi = WALL('t_wall', { atk: 900 });
    const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 2 }, { chessId: 't_wall2', row: 12, col: 6 }], chess: { t_wall: hi } });
    h.step();
    const e = put(h, key, [3, 12], { tag: 'boss' });
    e.profile.noAttack = true;
    h.run(skb(key, '1').initCooldown + 0.1);
    const f = h.eventsOf('fx').find((x) => x[1] === 'shell');
    assert.ok(f);
    assert.equal(f[4].tx, h.unit('t_wall2').tileC, 'the high-ATK operator is out of range (col 2 vs 12, range 8)');
  });
}

const H08 = 'act1autochess_h08_01';
const handRoute = (key, kind) => {
  const t = W[H08];
  const s = t.branches[`${key === 'enemy_9014_acstma' ? 'left' : 'right'}_hand_${kind}`][0][0];
  return t.extraRoutes[s.routeIndex];
};

for (const key of ['enemy_9014_acstma', 'enemy_9015_acstmb']) {
  const s = skb(key, '1');
  test(`${nm(key)}: 初始模式 invulnerable; 掷 blinks to its preset route at the lowest-ATK operator, no normal attack; damage passes ${BLADE_TRANSFER * 100} % to 胄; ${s.bb.max_hit_cnt} hits → 【瘫痪】 (stun ${s.bb.stun} s, ground, ×${s.bb.damage_scale}), then a new 初始模式 copy with its HP replaces it`, () => {
    const h = bossArena({ hp: 1e7, units: [{ chessId: 't_wall', row: 12, col: 3 }, { chessId: 't_gun', row: 9, col: 4 }], chess: { t_gun: chessRec({ id: 't_gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 5000, maxHp: 1e7, blockCnt: 0 }, rangeGrid: BIG, skill: null }) }, kits: { t_gun: NOATK }, setup: setTpl(H08), hooks: ['statusApplied'] });
    h.step();
    const boss = put(h, 'enemy_9013_acstmk_2', [3, 10], { tag: 'boss' });
    boss.profile.noAttack = true;
    const origin = handRoute(key, 'origin'), blink = handRoute(key, 'blink');
    const p = put(h, key, origin.start, { tag: 'part' });              // pinned: the dive never lands
    assert.ok(p.s.flags.invulnerable && p.s.flags.untargetable && p.s.flags.unblockable);
    h.run(s.initCooldown + 0.1);
    assert.ok(!p.s.flags.invulnerable && !p.s.flags.untargetable, '出击模式');
    assert.deepEqual([p.y, p.x], blink.start, 'blinked to the start of its blink route');
    assert.ok(p.s.flags.disarm, '出击模式: no normal attack');
    const g = h.unit('t_gun');
    const seen = [];
    h.b.on('damaged', (c) => { if (c.target === boss) seen.push(c); }, { priority: -1e9 });
    let pool0 = h.b.sharedBoss.hp;
    const d1 = h.b.dealDamage(g, p, { amount: 1000, type: 'true' });
    approx(pool0 - h.b.sharedBoss.hp, d1 * BLADE_TRANSFER, 1e-6, 'passed on during the dive too');
    for (let i = 1; i < s.bb.max_hit_cnt - 1; i++) h.b.dealDamage(g, p, { amount: 1, type: 'true' });
    assert.equal(p.motion, 'FLY');
    h.b.dealDamage(g, p, { amount: 1, type: 'true' });                 // the 15th
    assert.equal(p.motion, 'WALK', 'a ground unit');
    approx(p.s.dmgTakenMul, s.bb.damage_scale);
    assert.ok(p.s.flags.stun);
    approx(statuses(h, p.id, 'stun')[0].duration, s.bb.stun);
    pool0 = h.b.sharedBoss.hp;
    const d2 = h.b.dealDamage(g, p, { amount: 1000, type: 'true' });
    approx(d2, 1000 * s.bb.damage_scale);
    approx(pool0 - h.b.sharedBoss.hp, d2 * BLADE_TRANSFER);
    approx(pool0 - h.b.sharedBoss.hp, 1000 * s.bb.damage_scale, 1e-6, '等量: all of the ×1.3 damage');
    assert.ok(seen.length && seen.every((c) => c.source === null && c.credit === g), '无来源 (hooks see no source), credited to the attacker');
    assert.ok(h.result().perPlayer.p1.bossDamage >= d1 + (s.bb.max_hit_cnt - 2) + 1 + d2 - 1e-6, 'the per-player pool tally');
    const hp = p.hp, killed0 = h.b.killed;
    h.run(s.bb.stun - 0.2);
    assert.ok(p.alive && p.motion === 'WALK', 'still 瘫痪');
    h.run(0.3);                                                       // the stun ends → 【瘫痪】 ends (not the 20 s)
    assert.ok(!p.alive, 'the old one is killed');
    const n = alive(h, key);
    assert.equal(n.length, 1);
    assert.notEqual(n[0].id, p.id);
    assert.deepEqual([n[0].y, n[0].x], origin.start, 'summoned on its origin route');
    approx(n[0].hp, hp, 1e-9, 'inherits the HP');
    assert.ok(n[0].s.flags.invulnerable && n[0].motion === 'FLY' && n[0].tag === 'part');
    assert.equal(h.b.killed, killed0, 'a part: not counted');
    h.run(s.initCooldown - 0.2);
    assert.ok(n[0].s.flags.invulnerable, 'a new unit: 掷 waits for its initial cooldown');
    h.run(0.3);
    assert.ok(!n[0].s.flags.invulnerable);
  });
}

test('“斩胄之剑” dive that lands: 3×3 stun + physical DoT at the lowest-ATK operator, then a new copy with its HP at home', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 12, col: 15 }, { chessId: 't_wall2', row: 12, col: 16 }, { chessId: 't_wall3', row: 9, col: 3 }], chess: { t_wall2: WALL('t_wall2', { atk: 50 }), t_wall3: WALL('t_wall3', { atk: 100 }) }, hooks: ['statusApplied'], setup: setTpl(H08) });
  h.step();
  const origin = handRoute('enemy_9014_acstma', 'origin');
  const p = put(h, 'enemy_9014_acstma', origin.start, { tag: 'part', move: true });
  const s = skb('enemy_9014_acstma', '1');
  h.run(s.initCooldown + 0.1);
  assert.ok(p.alive && !p.s.flags.invulnerable, 'flying from the blink start (5,16) to t_wall (5,15)');
  p.hp -= 1000;
  h.runUntil(() => statuses(h, h.unit('t_wall').id, 'stun').length > 0, 30);
  approx(statuses(h, h.unit('t_wall').id, 'stun')[0].duration, s.bb.stun);
  assert.equal(statuses(h, h.unit('t_wall2').id, 'stun').length, 1, 'the 3×3 around the target');
  assert.equal(statuses(h, h.unit('t_wall3').id, 'stun').length, 0);
  assert.ok(h.unit('t_wall').findBuff('boss:bladeDiveDot'));
  assert.ok(!p.alive);
  const n = alive(h, 'enemy_9014_acstma')[0];
  assert.ok(n && n.id !== p.id && n.s.flags.invulnerable);
  assert.deepEqual([n.y, n.x], origin.start);
  approx(n.hp, n.s.maxHp - 1000);
});

test('“斩胄之剑” / “破胄之锤” 初始模式 attack: every ally in range, 锤 150 % ATK (PRTS 天赋)', () => {
  for (const [key, scale] of [['enemy_9014_acstma', 1], ['enemy_9015_acstmb', 1.5]]) {
    const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 10, col: 7 }] });
    h.step();
    put(h, key, [3, 8], { tag: 'part' });
    // (the first attack: its 0.8 / 0.867 s wind-up, then the shots — since 0.2.0 an attack strikes at its damage frame)
    h.runUntil(() => h.unit('t_wall').stats.taken > 0 && h.unit('t_wall2').stats.taken > 0, 3);
    approx(h.unit('t_wall').stats.taken, E[key].stats.atk * scale, 1e-6, key);
    approx(h.unit('t_wall2').stats.taken, E[key].stats.atk * scale, 1e-6, key);
  }
});

test('假想敌：铳: unblockable, targets the highest DEF in range, ASPD ramps on the same target, erosion on hit', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 10, col: 11 }], chess: { t_wall: WALL('t_wall', { def: 100 }), t_wall2: WALL('t_wall2', { def: 500 }) } });
  h.step();
  const e = put(h, 'enemy_9017_achunt', [3, 10], { tag: 'boss' });
  assert.ok(e.s.flags.unblockable);
  assert.equal(e.s.aspd, 20, 'data ASPD 0 → floor 20');
  h.runUntil(() => e.stats.attacks >= 3, 120);
  assert.equal(h.unit('t_wall').stats.taken, 0);
  assert.ok(h.unit('t_wall2').stats.taken > 0);
  assert.equal(e.s.aspd, 2 * tb('enemy_9017_achunt', '2.attack_speed'));
  assert.ok(h.unit('t_wall2').elem[EROSION] > 0);
});

test('假想敌：铳 最终之罚: charges at the highest-DEF ground unit, trampling units on the way (ATK×1.2)', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 10, col: 7 }], chess: { t_wall: WALL('t_wall', { def: 300 }) } });
  h.step();
  const e = put(h, 'enemy_9017_achunt', [3, 10], { tag: 'boss' });
  const s = skb('enemy_9017_achunt', '1');
  h.run(s.initCooldown + 0.1);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'charge' && f[4].kind === 'finalPenance'));
  h.run(8);
  assert.ok(e.x < 8, `moved toward the target (x ${e.x})`);
  assert.ok(h.unit('t_wall2').stats.taken >= e.s.atk * tb('enemy_9017_achunt', '3.atk_scale') - 1e-6, 'trampled on the way');
});

test('假想敌：铳 (h07_02 override) never uses 最终之罚 in the regular boss round', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 5 }], setup(b) { b.enemyOverrides = W.act1autochess_h07_02.overrides; } });
  h.step();
  put(h, 'enemy_9017_achunt', [3, 10], { tag: 'boss' });
  h.run(60);
  assert.ok(!h.eventsOf('fx').some((f) => f[1] === 'charge'));
});

test('隐秘核心 铳: another gun alone grants 80% reduction from the very first hit; no stale reduction after it leaves', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 7 }] });
  h.step();
  const g = put(h, 'enemy_9017_achunt_2', [3, 10], { tag: 'boss' });
  const other = put(h, 'enemy_9017_achunt_2', [3, 4], { tag: 'boss' });
  const full = 1000 * (1 - g.s.res / 100);
  approx(h.b.dealDamage(null, g, { amount: 1000, type: 'arts' }), full * 0.2);
  // Leaving the field without killing the shared boss pool isolates the companion condition.
  other.alive = false; other.deployed = false;
  approx(h.b.dealDamage(null, g, { amount: 1000, type: 'arts' }), full);
  const spring = put(h, 'enemy_9020_actrpc', [3, 6], { tag: 'part' });
  approx(h.b.dealDamage(null, g, { amount: 1000, type: 'arts' }), full * 0.2);
  spring.alive = false; spring.deployed = false;
  approx(h.b.dealDamage(null, g, { amount: 1000, type: 'arts' }), full);
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});

test('假想敌：铳 (隐秘核心): damage ×0.2 while springs live; 盲信之誓 lines hurt operators on them; 末日布道 dash', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 7 }], setup(b) { b.enemyOverrides = W.act1autochess_h08_02.overrides; } });
  h.step();
  const g = put(h, 'enemy_9017_achunt_2', [3, 10], { tag: 'boss' });
  const sp = put(h, 'enemy_9020_actrpc', [3, 4], { tag: 'part' });
  h.run(0.5);
  const before = h.b.sharedBoss.hp;
  const dealt = h.b.dealDamage(null, g, { amount: 1000, type: 'arts' });
  approx(before - h.b.sharedBoss.hp, 1000 * (1 - g.s.res / 100) * tb('enemy_9017_achunt_2', '4.damage_scale'));
  approx(dealt, before - h.b.sharedBoss.hp);
  const w = h.unit('t_wall');
  const t0 = w.stats.taken;
  h.run(2);
  assert.ok(w.stats.taken - t0 >= skb('enemy_9017_achunt_2', '3').bb.value, 'standing on the link');
  const s2 = W.act1autochess_h08_02.overrides.enemy_9017_achunt_2.skills.find((s) => s.prefabKey === '2');
  h.run(s2.initCooldown - h.b.time + 0.2);
  assert.ok(sp.s.flags.invulnerable && sp.mem.ab.dash);
  assert.ok(sp.s.flags.disarm, '追逐模式: 不进行普通攻击');
});

test('“碎铳之簧” 法术护盾 (9018): barrier absorbs arts, physical ×0.1 with a counter; damage passes to 铳', () => {
  const h = bossArena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
  h.step();
  put(h, 'enemy_9017_achunt_2', [3, 18], { tag: 'boss' }).profile.noAttack = true;
  const sp = put(h, 'enemy_9018_actrpa', [3, 10], { tag: 'part' });
  sp.profile.noAttack = true;
  const g = h.unit('t_gun');
  assert.ok(sp.s.flags.unblockable);
  h.b.dealDamage(g, sp, { amount: 1000, type: 'arts' });
  assert.equal(sp.hp, sp.s.maxHp, 'absorbed by the barrier');
  const pool0 = h.b.sharedBoss.hp;
  const dealt = h.b.dealDamage(g, sp, { amount: 10000, type: 'phys' });
  approx(dealt, (10000 - sp.s.def) * tb('enemy_9018_actrpa', '1.damage_scale'));
  approx(pool0 - h.b.sharedBoss.hp, dealt * PART_TRANSFER);
  assert.ok(g.stats.taken > 0 && g.elem[EROSION] > 0, 'counter');
});

test('“碎铳之簧” 元素护盾 (9019): phys/arts ×0.1 until its own element burst breaks the shield; every (spCost+1)-th attack adds a bouncing erosion shot', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 10, col: 8 }] });
  h.step();
  const sp = put(h, 'enemy_9019_actrpb', [3, 10], { tag: 'part' });
  const d = h.b.dealDamage(null, sp, { amount: 10000, type: 'true' });
  approx(d, 10000);
  const p = h.b.dealDamage(null, sp, { amount: 10000, type: 'phys' });
  approx(p, (10000 - sp.s.def) * tb('enemy_9019_actrpb', '1.damage_scale'));
  const sk = skb('enemy_9019_actrpb', '1');
  h.runUntil(() => sp.stats.attacks >= sk.spCost, 60);
  assert.ok(!h.eventsOf('fx').some((f) => f[1] === 'beam' && f[4].kind === 'springBullet'), 'not before the skill attack');
  h.runUntil(() => sp.stats.attacks >= sk.spCost + 1, 30);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'beam' && f[4].kind === 'springBullet'));
  assert.ok(h.unit('t_wall').elem[EROSION] > 0 && h.unit('t_wall2').elem[EROSION] > 0, 'bounced');
  h.b.dealDamage(null, sp, { type: 'element', element: 'burn', amount: 1000 });
  assert.ok(!sp.s.flags.unblockable, 'shield down');
  approx(h.b.dealDamage(null, sp, { amount: 10000, type: 'phys' }), 10000 - sp.s.def);
});

test('“碎铳之簧” 频次护盾 (9020): negates 5 hits, then comes back 25 s after breaking; every (spCost+1)-th attack adds a ten-hit combo while shielded', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 9 }] });
  h.step();
  const sp = put(h, 'enemy_9020_actrpc', [3, 10], { tag: 'part' });
  sp.profile.noAttack = true;
  for (let i = 0; i < tb('enemy_9020_actrpc', '1.block_damage_max_times'); i++) h.b.dealDamage(null, sp, { amount: 5000, type: 'true' });
  assert.equal(sp.hp, sp.s.maxHp);
  assert.ok(!sp.s.flags.unblockable);
  assert.ok(sp.hp - h.b.dealDamage(null, sp, { amount: 5000, type: 'true' }) < sp.s.maxHp);
  h.run(tb('enemy_9020_actrpc', '1.regenerate_duration') + 0.2);
  assert.ok(sp.s.flags.unblockable, 'shield regenerated');
  sp.profile.noAttack = false;
  const w = h.unit('t_wall');
  const sk = skb('enemy_9020_actrpc', '1');
  const n = sk.spCost + 1;
  h.runUntil(() => sp.stats.attacks >= n, 60);
  h.run(0.5);
  const combos = h.eventsOf('fx').filter((f) => f[1] === 'beam' && f[4].kind === 'springCombo').length;
  assert.equal(combos, 1);
  approx(w.stats.taken, n * sp.s.atk + 10 * sp.s.atk * sk.bb.atk_scale);
});

test('“碎铳之簧”: damage taken costs 假想敌：铳 as much (等量, 无来源) and, split, the other springs (never passed on twice)', () => {
  // PRTS 碎铳之簧 "受到伤害时令全场范围内仇恨值最高的1名假想敌：铳受到等量的无来源生命流失" (DESIGN §20.10; v2.5: half)
  assert.equal(PART_TRANSFER, 1);
  const h = bossArena({ units: [{ chessId: 't_gun', row: 12, col: 3 }], kits: { t_gun: NOATK } });
  h.step();
  const g = put(h, 'enemy_9017_achunt_2', [3, 18], { tag: 'boss' });
  g.profile.noAttack = true;
  const [a, b, c] = ['enemy_9018_actrpa', 'enemy_9019_actrpb', 'enemy_9020_actrpc'].map((k, i) => put(h, k, [1 + i * 2, 4], { tag: 'part' }));
  for (const x of [a, b, c]) x.profile.noAttack = true;
  h.step();
  const seen = [];
  h.b.on('damaged', (x) => { if (x.target === g) seen.push(x); }, { priority: -1e9 });
  const pool0 = h.b.sharedBoss.hp, b0 = b.hp, c0 = c.hp;
  const dealt = h.b.dealDamage(h.unit('t_gun'), a, { amount: 1e5, type: 'true' });
  assert.ok(dealt > 0);
  approx(pool0 - h.b.sharedBoss.hp, dealt);
  approx(b0 - b.hp, dealt / 2);
  approx(c0 - c.hp, dealt / 2);
  assert.ok(seen.length === 1 && seen[0].source === null && seen[0].credit === h.unit('t_gun'), '无来源, credited to the attacker');
  assert.ok(h.result().perPlayer.p1.bossDamage >= dealt - 1e-6, 'the per-player pool tally');
});

test('假想敌：管: strikes dark 余音 (their pulse hurts operators); 裂管之奏 at 40 s; summons 余音 every 40 s', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 6 }], setup: setTpl('act1autochess_h07_03') });
  h.step();
  const e = put(h, 'enemy_9021_acduml', [3, 10], { tag: 'boss' });
  const echo = put(h, 'enemy_9023_acdums', [3, 6], { tag: 'part' });
  assert.equal(echo.mem.ab.form, 'dark');
  assert.equal(e.s.interval, E.enemy_9021_acduml.stats.bat * 100 / 20);
  h.run(e.s.interval + 0.2);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'beam' && f[4].kind === 'acdumlStrike'));
  assert.ok(h.unit('t_wall').stats.taken > 0 && h.unit('t_wall').elem.apoptosis > 0);
  h.run(skb('enemy_9021_acduml', '1').initCooldown - h.b.time + 1.2);
  const strikes = h.eventsOf('fx').filter((f) => f[1] === 'explode' && f[4].kind === 'pipeStrike').length;
  assert.ok(strikes >= 3 && strikes % 3 === 0, `three strikes per dark echo (${strikes})`);
  assert.ok(alive(h, 'enemy_9023_acdums').length >= 2, 'summoned');
});

test('假想敌：管 (隐秘核心) + 假想敌：弦: 弦 is invulnerable, 断弦之奏 flips gold 余音 dark; 弦 leaves when 管 falls', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 6 }], setup: setTpl('act1autochess_h08_03') });
  h.step();
  const pipe = put(h, 'enemy_9021_acduml_2', [3, 10], { tag: 'boss' });
  const str = put(h, 'enemy_9022_acdumm', [3, 11], { tag: 'part' });
  assert.ok(str.s.flags.invulnerable);
  const echo = put(h, 'enemy_9023_acdums', [3, 6], { tag: 'part' });
  bossesMod.setEchoForm(h.b, echo, 'gold');
  h.run(skb('enemy_9022_acdumm', '1').initCooldown + 0.1);
  assert.equal(echo.mem.ab.form, 'dark');
  assert.ok(h.unit('t_wall').stats.taken > 0);
  h.b.kill(pipe, null);
  assert.ok(!str.alive);
});

test('“余音”: 10-hit unit held only by block ≥2; pulses when hit; forms swap after 10 strikes; 合奏 every 5 s', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_blade', row: 11, col: 6 }], kits: { t_blade: NOATK } });
  h.step();
  const e = put(h, 'enemy_9023_acdums', [3, 6], { tag: 'part' });
  assert.equal(e.s.maxHp, E.enemy_9023_acdums.stats.maxHp);
  assert.equal(e.blockWeight, 2);
  assert.equal(e.mem.ab.form, 'dark');
  approx(e.s.atk, E.enemy_9023_acdums.stats.atk * (1 + tb('enemy_9023_acdums', '2.atk')));
  h.b.dealDamage(h.unit('t_blade'), e, { amount: 1e6, type: 'phys' });
  assert.equal(e.hp, e.s.maxHp - 1, 'one hit = 1');
  assert.ok(h.unit('t_wall').stats.taken > 0, 'pulse when hit');
  for (let i = 1; i < tb('enemy_9023_acdums', '2.hit_times_to_switch'); i++) bossesMod.echoHit(h.b, e);
  assert.equal(e.mem.ab.form, 'gold');
  assert.equal(e.s.aspd, 100 + tb('enemy_9023_acdums', '1.attack_speed'));
  const e2 = put(h, 'enemy_9023_acdums', [4, 7], { tag: 'part' });
  const t0 = h.unit('t_wall').stats.taken;
  h.run(skb('enemy_9023_acdums', 'Skill').initCooldown + 0.1);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'explode' && /ensemble/.test(f[4].kind)));
  assert.ok(h.unit('t_wall').stats.taken > t0 && e2.alive);
  for (let i = 0; i < E.enemy_9023_acdums.stats.maxHp - 1; i++) h.b.dealDamage(h.unit('t_blade'), e, { amount: 1, type: 'phys' });
  assert.ok(!e.alive, 'the 10th hit knocks it out');
});

test('盐风主教昆图斯: 2 highest-DEF targets + neural; 崩坍 / 大潮 / 断裂生殖; growth by lost HP; 物种爆发 LP loss', () => {
  const tpl = W.act1autochess_h07_04;
  const ov = JSON.parse(JSON.stringify(tpl.overrides));
  ov.enemy_1521_dslily.skills.find((s) => s.prefabKey === 'Doom').initCooldown = 1;
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }, { chessId: 't_wall3', row: 12, col: 4 }],
    chess: { t_wall: WALL('t_wall', { def: 300 }), t_wall2: WALL('t_wall2', { def: 200 }) }, hooks: ['statusApplied', 'lpLoss'],
    setup(b) { b.opts.templateId = 'act1autochess_h07_04'; b.enemyOverrides = ov; } });
  h.step();
  const e = put(h, 'enemy_1521_dslily', [3, 10], { tag: 'boss' });
  h.runUntil(() => e.stats.attacks >= 1, 20);
  h.run(0.5);
  assert.ok(h.unit('t_wall').stats.taken > 0 && h.unit('t_wall2').stats.taken > 0);
  assert.equal(h.unit('t_wall3').stats.taken, 0);
  assert.ok(h.unit('t_wall').elem.neural > 0);
  h.run(skb('enemy_1521_dslily', 'Rockfall').initCooldown - h.b.time + ROCK);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'rockfall'));
  h.run(skb('enemy_1521_dslily', 'Tidewater').initCooldown - h.b.time + 0.2);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'tide') && h.unit('t_wall3').stats.taken > 0, 'global tide');
  h.run(skb('enemy_1521_dslily', 'SummonTentac').initCooldown - h.b.time + 0.2);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'tentacle'));
  const atk0 = e.s.atk;
  h.b.sharedBoss.hp = h.b.sharedBoss.maxHp * 0.6;
  h.run(0.5);
  approx(e.s.atk, atk0 * (1 + tb('enemy_1521_dslily', 'atkup1.atk')));
  h.b.sharedBoss.hp = h.b.sharedBoss.maxHp * 0.3;
  h.run(0.5);
  approx(e.s.atk, atk0 * (1 + tb('enemy_1521_dslily', 'atkup2.atk')));
  h.run(6);
  assert.equal(h.hooksOf('lpLoss')[0].amount, 100);
  assert.equal(h.result().lpLoss ?? h.b.result().lpLoss ?? 100, 100);
});
const ROCK = 1.3;

test('卢西恩: evades 40 % while unblocked, ignores 40 % DEF, neural on hit; blinks past its blocker leaving a 不祥幻影', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 9, col: 6 }], chess: { t_wall: WALL('t_wall', { def: 500 }) }, captureNoisy: true, hooks: ['damaged'] });
  h.step();
  const e = put(h, 'enemy_2016_csphtm', [2, 8], { tag: 'boss', move: true, route: { motion: 'WALK', start: [2, 8], end: [2, 2], checkpoints: [] } });
  h.step(2);
  assert.equal(e.s.dodgePhys, tb('enemy_2016_csphtm', 'evade.prob'));
  h.runUntil(() => e.blockedBy, 20);
  h.step(2);
  assert.equal(e.s.dodgePhys, 0);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  const hit = h.hooksOf('damaged').find((c) => c.source === e && c.dmg.isAttack);
  approx(hit.amount, e.s.atk - 500 * (1 - tb('enemy_2016_csphtm', 'penetrate.def_penetrate')));
  assert.ok(h.unit('t_wall').elem.neural > 0);
  h.run(skb('enemy_2016_csphtm', 'blink').initCooldown + 0.5);
  assert.equal(alive(h, 'enemy_2017_csphts').length, 1);
  assert.ok(e.x < 6 - 0.5, `blinked past (x ${e.x})`);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'explode' && f[4].kind === 'crimsonAoe'));
});

test('不祥幻影: same evade / DEF penetration / AoE skill (radius 2) as 卢西恩, no blink', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }, { chessId: 't_wall2', row: 11, col: 6 }] });
  h.step();
  const e = put(h, 'enemy_2017_csphts', [10, 7]);
  h.step(2);
  assert.equal(e.s.dodgePhys, tb('enemy_2017_csphts', 'evade.prob'));
  approx(e.s.defIgnorePct, tb('enemy_2017_csphts', 'penetrate.def_penetrate'));
  h.run(skb('enemy_2017_csphts', 'aoe').initCooldown + 0.1);
  assert.ok(h.unit('t_wall').stats.taken > 0 && h.unit('t_wall2').stats.taken > 0);
  assert.ok(h.unit('t_wall2').elem.neural > 0);
});

test('阿利斯泰尔: 王权号令 strikes a plus shape (ATK×2) and drops equipment; 莫非王土 animates it; ≤50 %: DEF/RES up; 斥退 LP loss', () => {
  const tpl = W.act1autochess_h07_06;
  const ov = JSON.parse(JSON.stringify(tpl.overrides));
  ov.enemy_9032_aclionk.skills.find((s) => s.prefabKey === 'Suicide').initCooldown = 30;
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 9 }, { chessId: 't_wall2', row: 11, col: 9 }], hooks: ['lpLoss'], setup(b) { b.enemyOverrides = ov; } });
  h.step();
  const e = put(h, 'enemy_9032_aclionk', [3, 11], { tag: 'boss' });
  e.profile.noAttack = true;
  const cost = ov.enemy_9032_aclionk.skills.find((s) => s.prefabKey === 'equip').spCost;
  h.run(cost + 0.1);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'telegraph' && f[4].kind === 'royalDecree'));
  approx(h.unit('t_wall').stats.taken + h.unit('t_wall2').stats.taken, 2 * e.s.atk * 2);
  const eq = h.b.units.filter((u) => /enemy_100(28|29|30)/.test(u.defId));
  assert.equal(eq.length, 1);
  assert.ok(eq[0].s.flags.invulnerable && eq[0].s.flags.untargetable);
  h.run(2.2);
  assert.ok(!eq[0].alive, 'animated & consumed');
  h.b.sharedBoss.hp = h.b.sharedBoss.maxHp * 0.4;
  h.step(2);
  assert.equal(e.s.def, Math.round(E.enemy_9032_aclionk.stats.def * (1 + tb('enemy_9032_aclionk', 'advance.def'))));
  h.run(30 - h.b.time + 0.2);
  assert.equal(h.hooksOf('lpLoss')[0].amount, 100);
});

for (const key of ['enemy_10028_vtswd', 'enemy_10029_vtshld', 'enemy_10030_vtwand']) {
  test(`${nm(key)}: dropped equipment is inert (invulnerable, untargetable, never moves) until animated`, () => {
    const h = bossArena({ units: [{ chessId: 't_gun', row: 12, col: 3 }] });
    h.step();
    const q = put(h, key, [3, 6], { tag: 'part', move: true, route: { motion: 'FLY', start: [3, 6], end: [3, 6], steps: [{ t: 'wait', s: 999 }] } });
    h.run(3);
    assert.ok(q.alive && q.s.flags.invulnerable && q.s.flags.untargetable);
    assert.equal(q.stats.taken, 0);
  });
}

test('阿利斯泰尔 防护背心: an animated vest gives a barrier and −80 % damage from its side', () => {
  const h = bossArena({ units: [{ chessId: 't_gun', row: 10, col: 4 }, { chessId: 't_mage', row: 10, col: 16 }], kits: { t_gun: NOATK, t_mage: NOATK } });
  h.step();
  const e = put(h, 'enemy_9032_aclionk', [3, 10], { tag: 'boss' });
  e.profile.noAttack = true;
  const vest = put(h, 'enemy_10029_vtshld', [3, 8], { tag: 'part' });
  h.run(2.2);
  assert.ok(!vest.alive, 'animated & consumed');
  const v = e.findBuff('boss:vest');
  const st = skb('enemy_9032_aclionk', 'store').bb;
  assert.equal(v.shield, st.dynamic);
  h.b.dealDamage(h.unit('t_gun'), e, { amount: 1000, type: 'true' });      // from the vest side (left)
  approx(v.shield, st.dynamic - 1000 * (1 - st.damage_resistance));
  h.b.dealDamage(h.unit('t_mage'), e, { amount: 1000, type: 'true' });     // from the other side
  approx(v.shield, st.dynamic - 1000 * (1 - st.damage_resistance) - 1000);
});

test('阿利斯泰尔 未装配刀片 / 冲击式施术单元: sword strike (ATK×2) / next attack becomes arts and disarms', () => {
  const h = bossArena({ units: [{ chessId: 't_wall', row: 10, col: 9 }], hooks: ['statusApplied'] });
  h.step();
  const e = put(h, 'enemy_9032_aclionk', [3, 10], { tag: 'boss' });
  e.profile.noAttack = true;
  put(h, 'enemy_10028_vtswd', [3, 8], { tag: 'part' });
  h.run(2.2);
  approx(h.unit('t_wall').stats.taken, e.s.atk * skb('enemy_9032_aclionk', 'store').bb.atk_scale);
  const w2 = put(h, 'enemy_10030_vtwand', [4, 8], { tag: 'part' });
  e.profile.noAttack = false;
  h.runUntil(() => !w2.alive, 30);
  h.runUntil(() => statuses(h, h.unit('t_wall').id, 'disarm').length > 0, 30);
  assert.ok(h.eventsOf('dmg').some((d) => d[1] === h.unit('t_wall').id && d[3] === 'arts'));
});

test('“萨米的意志”: 冰凌 hits a whole column; 自然涌动 stun + arts/s; <50 %: damage ×(1−0.6) and 2 columns; Doom LP loss', () => {
  const ov = { enemy_9033_acdeer: { skills: E.enemy_9033_acdeer.skills.map((s) => (s.prefabKey === 'Doom' ? { ...s, initCooldown: 50 } : s)) } };
  const h = bossArena({ units: [{ chessId: 't_wall', row: 9, col: 6 }, { chessId: 't_wall2', row: 12, col: 6 }, { chessId: 't_wall3', row: 10, col: 8 }], hooks: ['statusApplied', 'lpLoss'], setup(b) { b.enemyOverrides = ov; } });
  h.step();
  const e = put(h, 'enemy_9033_acdeer', [3, 10], { tag: 'boss' });
  h.run(e.s.interval + 0.1);
  const col = [h.unit('t_wall'), h.unit('t_wall2'), h.unit('t_wall3')].filter((u) => u.stats.taken > 0);
  assert.ok(col.length >= 1 && col.every((u) => u.tileC === col[0].tileC));
  if (col[0].tileC === 6) assert.equal(col.length, 2, 'both units of column 6');
  h.run(skb('enemy_9033_acdeer', 'Lasso').initCooldown - h.b.time + 0.1);
  const st = h.hooksOf('statusApplied').filter((c) => c.status === 'stun');
  assert.equal(st.length, 1);
  approx(st[0].duration, skb('enemy_9033_acdeer', 'Lasso').bb.projectile_life_time);
  h.b.sharedBoss.hp = h.b.sharedBoss.maxHp * 0.4;
  h.run(0.5);
  approx(e.s.physTakenMul, 1 - tb('enemy_9033_acdeer', 'Madness.damage_resistance'));
  approx(e.s.artsTakenMul, 1 - tb('enemy_9033_acdeer', 'Madness.damage_resistance'));
  h.run(50 - h.b.time + 0.2);
  assert.equal(h.hooksOf('lpLoss')[0].amount, Math.abs(skb('enemy_9033_acdeer', 'Doom').bb.value));
});

test('“萨米的意志” on a two-player field: 冰凌 columns alternate between the players (both deploy at t = 0)', () => {
  const players = ['p1', 'p2'].map((pid, i) => ({ playerId: pid, seat: i, side: i ? 'R' : 'L', colOffset: 0, units: [{ chessId: 't_wall', row: 10, col: 5 }], bonds: {}, playerEffects: [] }));
  const h = arena({ kind: 'boss', sharedBoss: pool(1e6), players });
  h.step();
  const e = put(h, 'enemy_9033_acdeer', [3, 10], { tag: 'boss' });
  h.run(e.s.interval * 3 + 0.2);
  const cols = h.eventsOf('fx').filter((f) => f[1] === 'column').map((f) => f[4].c);
  assert.equal(cols.length, 4);
  assert.deepEqual(new Set(cols), new Set([5, 15]));
  for (let i = 1; i < cols.length; i++) assert.notEqual(cols[i], cols[i - 1], 'alternates');
  const [a, b] = h.allies();
  assert.ok(a.stats.taken > 0 && b.stats.taken > 0);
});

test('boss template: patrol leaders loop instead of leaking, and the mirrored copy spawns for two players', () => {
  const tpl = W.act2autochess_h07_05;
  const players = ['p1', 'p2'].map((pid, i) => ({ playerId: pid, seat: i, side: i ? 'R' : 'L', colOffset: 0, units: [], bonds: {}, playerEffects: [] }));
  const h = arena({ kind: 'boss', sharedBoss: pool(1e6), players, waveTemplate: tpl, routes: undefined, setup(b) { b.enemyOverrides = tpl.overrides; } });
  h.run(1);
  assert.equal(h.enemies().filter((e) => e.defId === 'enemy_2016_csphtm').length, 2, 'mirrored 卢西恩');
  h.run(240);
  assert.equal(h.enemies().filter((e) => e.defId === 'enemy_2016_csphtm').length, 2, 'still patrolling');
  assert.ok(!h.result().perPlayer.p1.leaked.some((l) => l.enemyKey === 'enemy_2016_csphtm'));
  checkInvariants(h.b);
});

test('determinism: the same boss round with the same seed produces the same outcome', () => {
  const run = () => {
    const h = arena({ kind: 'hidden', sharedBoss: pool(5e5), waveTemplate: W.act1autochess_h08_02, routes: undefined,
      units: [{ chessId: 't_gun', row: 10, col: 5 }, { chessId: 't_wall', row: 9, col: 7 }, { chessId: 't_mage', row: 11, col: 4 }], setup(b) { b.enemyOverrides = W.act1autochess_h08_02.overrides; } });
    h.run(90);
    checkInvariants(h.b);
    return [Math.round(h.b.sharedBoss.hp), h.b.enemies.filter((e) => e.alive).length, h.unit('t_gun').stats.taken, h.b.errorCount];
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  assert.equal(a[3], 0);
});

// ---------------------------------------------------------------------------------------------------------------
// enemy numbers checked against PRTS in 0.1.3 (community report #14 and the 0.1.2 review list, DESIGN §22.12 "Found")

/** The first normal attack of `e` that landed, its target and the other units its splash took. */
function splashOf(h, e) {
  const all = h.hooksOf('damaged').filter((c) => c.source === e);
  const main = all.find((c) => c.dmg.isAttack);
  return { main, target: main && main.target, splash: all.filter((c) => !c.dmg.isAttack && (c.dmg.tags || []).includes('splash')) };
}

test(`${nm('enemy_1050_lslime')}: the self-blast while blocked — radius 1.4, every 10 s of block (the clock restarts on a new block, stands still while stunned)`, () => {
  // PRTS “庞贝” 天赋: "被阻挡时，每10秒（受晕眩/无法行动/沉睡/冻结/浮空影响时暂停计时，解除阻挡时重置计时）对半径1.4范围内的所有我方单位造成
  // 1000预计算的无途径法术溅射伤害（不可对空）" (0.1.3: radius 1, a fixed 10 s clock from its spawn)
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 10, col: 5 }, { chessId: 't_wall3', row: 10, col: 6 }], hooks: ['damaged'], captureNoisy: true });
  h.step();
  const e = put(h, 'enemy_1050_lslime', [9, 5], { mods: { atkMul: 0 } });
  const blasts = () => h.hooksOf('damaged').filter((c) => c.source === e && !c.dmg.isAttack && c.dmg.tags.includes('splash'));
  h.run(5);
  h.b.applyStatus(e, 'stun', { duration: 2 });              // 2 s paused
  h.run(6.5);                                               // 11.5 s, 9.5 s of it counting
  assert.equal(blasts().length, 0, 'the stun paused the clock');
  h.run(0.7);
  const hit = blasts().map((c) => c.target.defId).sort();
  assert.deepEqual(hit, ['t_wall', 't_wall2'], 'its blocker and the unit 1.0 away; √2 is outside 1.4');
  approx(blasts()[0].amount, tb('enemy_1050_lslime', 'rangedamage.attack@damage'));
  // unblocked for a moment: the clock restarts
  const n = blasts().length;
  h.run(4);
  h.b._unblock(e);
  h.unit('t_wall').s.flags.noBlock = true;
  h.step();
  delete h.unit('t_wall').s.flags.noBlock;
  h.run(8);
  assert.equal(blasts().length, n, 'a new block: 10 s again from its start');
  h.run(2.5);
  assert.ok(blasts().length > n);
});

test(`${nm('enemy_10122_uacann_2')}: the shell hits every unit within 1.0 of its target (100 % ATK, not flyers); the burning zone has radius 1.5`, () => {
  // PRTS 集团军重型火炮 天赋: "普通攻击向目标发射一枚炮弹，对目标半径1.0范围内的所有我方单位造成攻击力100%的物理伤害（此弹道会强制击中主目标，
  // 碰撞无视迷彩，不可对空）", 【燃烧区域】 "<1.5倍可变半径>碰撞半径1.5" (0.1.3: no splash, zone radius 1)
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 3 }, { chessId: 't_wall2', row: 11, col: 3 }, { chessId: 't_wall3', row: 10, col: 4 }, { chessId: 't_wall4', row: 12, col: 3 }], hooks: ['damaged'], captureNoisy: true });
  h.step();
  const e = put(h, 'enemy_10122_uacann_2', [10, 9]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(2);
  const { target, splash } = splashOf(h, e);
  assert.ok(target);
  const near = h.allies().filter((u) => u !== target && Math.hypot(u.x - target.x, u.y - target.y) <= 1 + 1e-6);
  assert.ok(near.length >= 1);
  assert.deepEqual(splash.map((c) => c.target).filter((u, i, l) => l.indexOf(u) === i).sort((a, b) => a.id - b.id), near.sort((a, b) => a.id - b.id));
  approx(splash[0].amount, e.s.atk);
  const zone = h.eventsOf('fx').find((f) => f[1] === 'zone' && f[4].kind === 'burning');
  approx(zone[4].r, tb('enemy_10122_uacann_2', 'ProjectileBoomRange.attack@projectile_range') * 1.5);
});

test(`${nm('enemy_2008_flking')}: unblocked, a ranged attack at ${tb('enemy_2008_flking', 'atkdown.atk_scale') * 100} % ATK on the target and its 8 surrounding tiles; blocked, a melee hit at 100 %`, () => {
  // PRTS “墓碑” 天赋: "自身造成的远程途径伤害的攻击倍率降低至40%", "未被阻挡时会进行远程攻击，对目标及其周围八格内的所有我方单位造成物理伤害，
  // 不会攻击飞行单位" (0.1.3: a single-target hit at 100 %)
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 11, col: 6 }, { chessId: 't_wall3', row: 12, col: 6 }], hooks: ['damaged'], captureNoisy: true });
  h.step();
  const e = put(h, 'enemy_2008_flking', [10, 7]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(1);
  const { main, target, splash } = splashOf(h, e);
  const scale = tb('enemy_2008_flking', 'atkdown.atk_scale');
  approx(main.amount, e.s.atk * scale);                     // (the walls' DEF is 0, halved by its own aura)
  const box = h.allies().filter((u) => u !== target && Math.max(Math.abs(u.tileR - target.tileR), Math.abs(u.tileC - target.tileC)) <= 1);
  assert.ok(box.length >= 1);
  for (const u of box) assert.ok(splash.some((c) => c.target === u), `${u.defId} in the 3×3`);
  assert.ok(splash.every((c) => box.includes(c.target)));
  approx(splash[0].amount, e.s.atk * scale);
  const hb = arena({ units: [{ chessId: 't_wall', row: 10, col: 7 }, { chessId: 't_wall2', row: 11, col: 7 }], hooks: ['damaged'], captureNoisy: true });
  hb.step();
  const eb = put(hb, 'enemy_2008_flking', [10, 7]);
  hb.step();
  eb.atkCd = 0;
  const n0 = hb.hooksOf('damaged').length;
  hb.runUntil(() => hb.hooksOf('damaged').slice(n0).some((c) => c.source === eb && c.dmg.isAttack), 10);
  hb.run(1);
  const hits = hb.hooksOf('damaged').slice(n0).filter((c) => c.source === eb);
  assert.deepEqual(hits.map((c) => [c.target.defId, c.dmg.isAttack]), [['t_wall', true]], 'blocked: its blocker only');
  approx(hits[0].amount, eb.s.atk);
});

test(`${nm('enemy_1512_mcmstr')}: unblocked, a ranged attack (radius 2.5, ground units) on the target and its 8 surrounding tiles at 100 %; the self-destruct reaches 3.0`, () => {
  // PRTS “巨大的丑东西” 天赋: "未被阻挡时，可对半径2.5范围内的1名非飞行的我方单位进行远程攻击，对目标及其周围8格内的所有我方单位造成攻击力100%的
  // 物理伤害", "重生开始的2.17s后进行自爆，对半径3.0范围内所有我方单位造成攻击力150%的物理伤害和16s晕眩" (0.1.3: no ranged attack, radius 2.5)
  const h = arena({ units: [{ chessId: 't_wall', row: 11, col: 5 }, { chessId: 't_wall2', row: 12, col: 6 }, { chessId: 't_wall3', row: 9, col: 4 }], hooks: ['damaged', 'statusApplied'], captureNoisy: true });
  h.step();
  const e = put(h, 'enemy_1512_mcmstr', [10, 7]);
  h.runUntil(() => e.stats.attacks >= 1, 10);
  h.run(1);
  const { main, target, splash } = splashOf(h, e);
  approx(main.amount, e.s.atk);
  assert.ok(Math.hypot(target.x - e.x, target.y - e.y) <= 2.5 + 0.25 + 1e-6);
  const box = h.allies().filter((u) => u !== target && Math.max(Math.abs(u.tileR - target.tileR), Math.abs(u.tileC - target.tileC)) <= 1);
  for (const u of box) assert.ok(splash.some((c) => c.target === u), `${u.defId} in the 3×3`);
  assert.ok(splash.every((c) => box.includes(c.target)));
  killed(h, e, null);
  h.run(2.3);
  const st = h.hooksOf('statusApplied').filter((c) => c.status === 'stun').map((c) => c.target.defId).sort();
  // t_wall (11,5): √5 ≈ 2.24, t_wall2 (12,6): √5, t_wall3 (9,4): √10 ≈ 3.16 — outside 3.0
  assert.deepEqual(st, ['t_wall', 't_wall2']);
});

test(`${nm('enemy_1535_wlfmster')}: leaking in its first form ends every 溶血骇惧 it cast — no drain afterwards`, () => {
  // [ASSUMED] (no official text): the buff ends once its 扎罗 is off the field without a 重生 (a leak, a removal); until
  // 0.1.3 the drain went on ramping after a leak and knocked the units out (Grok review of fb3-enemies-kits)
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 11, col: 5 }, { chessId: 't_wall3', row: 12, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1535_wlfmster', [10, 7]);
  e.profile.noAttack = true;
  const fc = skb('enemy_1535_wlfmster', 'FearCage');
  h.run(fc.spCost + 3.1);
  const caged = h.allies().filter((u) => u.findBuff('ab:fearCage'));
  assert.equal(caged.length, fc.bb.max_target);
  h.b.leak(e);
  assert.ok(!e.alive);
  const hp = caged.map((u) => u.hp);
  h.run(3);
  assert.equal(h.allies().filter((u) => u.findBuff('ab:fearCage')).length, 0, 'every 溶血骇惧 ended');
  assert.deepEqual(caged.map((u) => u.hp), hp, 'no HP lost after the leak');
});

test(`${nm('enemy_1203_sfhu')}: its attack splash (法术普通伤害) can be dodged; its death blast (法术溅射伤害) cannot`, () => {
  // PRTS 烹泉 天赋: "普通攻击对目标对及目标周围半径1.0范围内的所有我方单位造成法术普通伤害", "死亡爆炸（…造成攻击力100%法术溅射伤害…）"
  const h = arena({ units: [{ chessId: 't_gun', row: 10, col: 6 }, { chessId: 't_wall', row: 11, col: 6 }, { chessId: 't_wall2', row: 10, col: 5 }], hooks: ['damaged', 'dodge'], captureNoisy: true });
  h.step();
  const g = h.unit('t_gun'), w = h.unit('t_wall'), dodger = h.unit('t_wall2');
  h.b.addBuff(dodger, { key: 'test:dodge', persist: true, mods: { dodgeArts: 1 } });
  const e = put(h, 'enemy_1203_sfhu', [10, 7]);
  h.runUntil(() => h.hooksOf('damaged').some((c) => c.source === e && c.dmg.isAttack && c.target === g), 10);
  h.run(0.3);
  approx(w.stats.taken, e.s.atk, 1e-6, 'the plain neighbour: splashed');
  assert.equal(dodger.stats.taken, 0, 'the arts-dodge neighbour dodges the splash');
  assert.ok(h.hooksOf('dodge').some((c) => c.target === dodger && c.source === e));
  h.b.addBuff(g, { key: 'test:dodge', persist: true, mods: { dodgeArts: 1 } });
  const t0 = g.stats.taken, atk = e.s.atk;
  killed(h, e, null);
  approx(g.stats.taken - t0, atk, 1e-6, 'the death blast is not dodged');
});

test(`${nm('enemy_10122_uacann_2')}: its 燃烧区域 (不可对空) spares a flying ally standing in it`, () => {
  // PRTS 集团军重型火炮: 【燃烧区域】 "…（可叠加，碰撞不受迷彩制约，不可对空）" — until 0.1.3 the 炎佑 dragon in it burned
  const h = makeBattle({ seed: 7, autoFinish: false, timeLimit: 120, defs: { chess: { t_wall: WALL('t_wall') } }, kits: { t_wall: NOATK },
    units: [{ chessId: 't_wall', row: 10, col: 2 }], hooks: ['damaged'], captureNoisy: true });
  h.step();
  const [y] = spawnYanyou(h.b, 'p1', { atk: 0, hp: 50000 });
  assert.ok(y && y.isFlying, 'a flying ally');
  const e = h.spawn('enemy_10122_uacann_2', { pos: [10, 9], routeIndex: 0, mods: { speedMul: 0 } });
  const w = h.unit('t_wall');
  assert.ok(Math.hypot(y.x - w.x, y.y - w.y) <= 1.5, 'the dragon stands inside the zone around the wall');
  h.runUntil(() => e.stats.attacks >= 1, 15);
  h.run(3.5);
  const burns = h.hooksOf('damaged').filter((c) => c.source === e && (c.dmg.tags || []).includes('burning'));
  assert.ok(burns.some((c) => c.target === w), 'the wall burns');
  assert.ok(!burns.some((c) => c.target === y), 'the dragon does not');
  assert.ok(!h.hooksOf('damaged').some((c) => c.source === e && c.target === y), 'nor is it shot or splashed');
});
