// Player report after the 0.1.0 release (second batch, B5): "飞机可以被薄绿的技能拉走（难道不能拉动吗？原版我没印象了，你去复核下）".
//
// Verdict: real. Officially no push or pull moves the air units of this mode:
//   - PRTS 特殊机制 静态刚体: "该单位的Unity刚体的刚体类型为部分静态（Kinematic）或静态（Static）。使用该类刚体的单位可以进入失衡
//     状态并启用物理，但物理层面上无法产生任何速度或移动 … ※与失衡免疫不同 … ※是否为静态刚体与单位的行动方式无关" (example: 妖怪);
//     PRTS 失衡位移机制: "这里的敌方单位也包括空中单位，但会因下述的判断而被取消位移".
//   - every air unit of data/enemies.json but “炎佑” (weight 10) lists "{{特殊机制|静态刚体}}" in its PRTS 天赋 (妖怪 "{{特殊机制|
//     静态刚体}}，不进行普通攻击", 寒霜, 暴鸰, 法术大师A1, 御4, 护障, 远眺 …), and so does the ground boss 盐风主教昆图斯 →
//     enemies.json `staticBody` (tools/build-data.mjs STATIC_BODIES) → Battle._displaceable: 0 tiles from every source.
//   - the skills keep their reach: 薄绿 (阵法术师 "攻击时可对空"), 锏 S3 ("※可对空"), the 钩索师 … still hit the drones.
//   - 刺胄之弹 / “斩胄之剑” / “破胄之锤” are also 失衡免疫 (PRTS 天赋 "{{特殊机制|静态刚体}}，…失衡免疫…").
//   - 喷气人's 飞行模式 (PRTS 喷气人 "近地悬浮，不可阻挡，失衡免疫，移动速度+50%，不进行攻击") hovers like the two 近地悬浮 enemies.
//   - 守墓石像 turns into a flyer at run time (data WALK, no 静态刚体): its statue ("无法被阻挡，自缚，失衡免疫，免疫浮空") and its
//     flight ("变为飞行单位，失衡免疫") are 失衡免疫 (PRTS 守墓石像 / 愤怒的守墓石像 天赋).
// Unchanged: ground enemies keep the 力度 − 重量 tables (DESIGN §20.3); the hovering 吉兆飞鳞 / 掠海漂移体 are 失衡免疫 while they
// hover and displaceable once grounded (no 静态刚体 on their pages). Since 0.2.2 a force > 0 on a 静态刚体 gives its 0.1 s 失衡
// floor (特殊机制 静态刚体 「失衡状态拥有 0.1 秒保底持续时间」; battle/displacement.js _staticForce): it pauses, never moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData, getDefaultSource, spawnsFromTemplate } from '../../server/sim/simdata.js';
import { PUSH_TILES, PULL_STOP_RADIUS } from '../../server/sim/constants.js';

const REAL = { skip: !hasGeneratedData() };
const approx = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const STILL = { hpMul: 1e4, speedMul: 0, atkMul: 0 };

const MINT = 'chess_char_3_08_a';
const YOKAI = 'enemy_1005_yokai';        // 妖怪: FLY, weight 0, 静态刚体
const FROST = 'enemy_1042_frostd';       // 寒霜: FLY, weight 1, 静态刚体
const SLIME = 'enemy_1007_slime';        // 源石虫: ground, weight 0
const AGENT = 'enemy_1046_agent';        // 步兵: ground, weight 1
const PARROT = 'enemy_10045_parrot';     // 吉兆飞鳞: 近地悬浮, weight 0
const SYUFO = 'enemy_2025_syufo';        // 掠海漂移体: 近地悬浮, weight 4
const SHELL = 'enemy_9016_acstmr';       // 刺胄之弹: FLY, weight 2, 静态刚体 + 失衡免疫
const BALLOON = 'enemy_2004_balloon';    // 喷气人: ground, weight 3; 飞行模式 = 近地悬浮 + 失衡免疫
const LOON = 'enemy_9012_acloon';        // “炎佑”: FLY, weight 10, no 静态刚体 on PRTS
// synthetic bodies: the rule is the rigidbody, not the movement ("是否为静态刚体与单位的行动方式无关")
const DYN_FLY = 'enemy_test_dynfly';     // a FLY body that is not static (none in this mode but “炎佑”)
const STATIC_WALK = 'enemy_test_staticwalk';
const SYNTH = {
  [DYN_FLY]: enemyRec({ key: DYN_FLY, hp: 1e8, speed: 0, mass: 0, motion: 'FLY' }),
  [STATIC_WALK]: { ...enemyRec({ key: STATIC_WALK, hp: 1e8, speed: 0, mass: 0 }), staticBody: true },
};

/** 薄绿 on (10,3) facing RIGHT (default loadout: S2 聚能涡旋), one still enemy at `pos`; S2 ready. */
function mintVs(key, pos, { chessId = MINT, route = 0, defs = null } = {}) {
  const h = makeBattle({
    ...(defs ? { defs: { enemies: defs } } : {}),
    units: [{ chessId, row: 10, col: 3, dir: 'RIGHT', carryState: { sp: 1e3 } }],
    enemies: [{ key, pos, route, mods: STILL }], autoFinish: false, timeLimit: 60, hooks: ['damaged'], captureNoisy: true,
  });
  return { h, u: h.unit(chessId) };
}

/** Distance the enemy moved on the first hit of `u` (the S2 drag rides on the hit) and the damage of that hit. */
function firstHitDrag(h, u, pos) {
  const x0 = pos[1], y0 = pos[0];
  const e = h.b.enemies[0];
  const hits = () => h.hooksOf('damaged').filter((c) => c.source === u && c.target === e);
  assert.ok(h.runUntil(() => hits().length > 0, 8), 'she hits it');
  assert.equal(hits().length, 1, 'one hit so far');
  return { e, moved: Math.hypot(e.x - x0, e.y - y0), dmg: hits()[0].amount };
}

test('B5: the data — every air unit of the mode but “炎佑” is a 静态刚体 (+ 昆图斯); 薄绿 S2 is 小力 and the default skill', REAL, () => {
  const ds = getDefaultSource();
  for (const id of [MINT, 'chess_char_3_08_b']) {
    const c = ds.rawChess(id);
    assert.equal(c.skill.skillId, 'skchr_mint_2', `${id}: S2 is the default`);
    assert.equal(c.skill.bb['attack@force'], 0, `${id}: 小力`);
  }
  const list = Object.values(ds.raw.enemies);
  const fly = list.filter((e) => e.stats.motion === 'FLY');
  assert.ok(fly.length >= 20, `the mode's air units (${fly.length})`);
  // PRTS: each one's 天赋 "{{特殊机制|静态刚体}}" — except “炎佑” (none; weight 10 — no 力度 reaches it)
  for (const e of fly) assert.equal(!!e.staticBody, e.key !== LOON, `${e.key} ${e.name}`);
  assert.ok(ds.rawEnemy(LOON).stats.massLevel >= 10);
  // the only static ground unit: 盐风主教昆图斯; the hovering enemies are dynamic bodies (their pages list none)
  assert.deepEqual(list.filter((e) => e.staticBody && e.stats.motion !== 'FLY').map((e) => e.key), ['enemy_1521_dslily']);
  for (const k of [PARROT, SYUFO, BALLOON, SLIME]) assert.ok(!ds.rawEnemy(k).staticBody, k);
  assert.equal(ds.getEnemy(YOKAI).staticBody, true, 'normalised def');
  assert.equal(ds.getEnemy(SLIME).staticBody, false);
});

test('B5 (the player\'s scenario): 薄绿 S2 hits the drones but never drags them; ground enemies of the same weight still come (normal + elite)', REAL, () => {
  const pos = [10, 5]; // two tiles ahead: the edge of her x-1 range
  for (const chessId of [MINT, 'chess_char_3_08_b']) {
    const res = {};
    for (const [key, route] of [[SLIME, 0], [YOKAI, 2], [AGENT, 0], [FROST, 2]]) {
      const { h, u } = mintVs(key, pos, { chessId, route });
      h.step();
      assert.equal(u.skill.id, 'skchr_mint_2');
      const { e, moved, dmg } = firstHitDrag(h, u, pos);
      assert.ok(dmg > 0, `${key}: hit`);
      assert.equal(e.isFlying, key === YOKAI || key === FROST);
      res[key] = moved;
      checkInvariants(h.b);
    }
    approx(res[YOKAI], 0, 1e-9, `${chessId}: 妖怪 (静态刚体) stays`);
    approx(res[FROST], 0, 1e-9, `${chessId}: 寒霜 (静态刚体) stays`);
    // 小力 (0) − weight 0 = 受力等级 0: 1.7 tiles, stopped at the 急停 radius 0.6708 from her centre; − weight 1 = −1: 0.44
    approx(res[SLIME], Math.min(PUSH_TILES[0], 2 - PULL_STOP_RADIUS), 1e-6, `${chessId}: 源石虫`);
    approx(res[AGENT], PUSH_TILES[-1], 1e-6, `${chessId}: 步兵`);
  }
});

test('B5 (the player\'s scenario): on act2 m01 a round-7 drone flies past 薄绿 on its route, hit after hit — never moved, only held 0.1 s per force', REAL, () => {
  // round 7's FLY route 10 (… (11,8) → (11,6) → (10,6) → (10,5) …) passes her x-1 range on the melee tile (10,7)
  const { routes } = spawnsFromTemplate(getDefaultSource().getWave('act1autochess_07'));
  assert.equal(routes[10].motion, 'FLY');
  const fly = (withMint) => {
    const h = makeBattle({
      stageId: 'act2autochess_m01', routes, timeLimit: 80, autoFinish: false, hooks: ['damaged', 'enemyLeak'], captureNoisy: true,
      units: withMint ? [{ chessId: MINT, row: 10, col: 7, dir: 'LEFT', carryState: { sp: 1e3 } }] : [],
    });
    h.step();
    const drone = h.spawn(YOKAI, { routeIndex: 10, mods: { hpMul: 1e4, atkMul: 0 } });
    assert.ok(drone && drone.isFlying && drone.motion === 'FLY');
    const path = [];
    while (drone.alive && !drone.leaked && h.b.time < 70) { h.step(); path.push([drone.x, drone.y]); }
    return { h, drone, path, hits: h.hooksOf('damaged').filter((c) => c.target === drone).length };
  };
  const ref = fly(false), got = fly(true);
  assert.ok(got.hits >= 5, `S2 hits the drone (${got.hits} hits)`);
  // every place it passes is a place of the undisturbed flight: the pulls never move it, they only hold it a moment
  const key = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const route = new Set(ref.path.map(key));
  assert.ok(got.path.every((p) => route.has(key(p))), 'its flight is the undisturbed one, with pauses');
  const late = got.path.length - ref.path.length;     // ticks; the 0.1 s floor is 3 ticks, overlapping holds merge
  assert.ok(late > 0 && late <= got.hits * 4, `held for ${late} ticks over ${got.hits} hits`);
  checkInvariants(got.h.b);
});

test('B5: 静态刚体 is the body, not the movement — a dynamic flyer is dragged, a static walker is not; push / pull give 0 at any 力度', REAL, () => {
  const pos = [10, 5];
  const drag = (key) => { const { h, u } = mintVs(key, pos, { route: key === DYN_FLY ? 2 : 0, defs: SYNTH }); h.step(); return firstHitDrag(h, u, pos).moved; };
  approx(drag(DYN_FLY), Math.min(PUSH_TILES[0], 2 - PULL_STOP_RADIUS), 1e-6, 'a non-static FLY body: the weight-0 table');
  approx(drag(STATIC_WALK), 0, 1e-9, 'a static ground body stays');
  const { h } = mintVs(YOKAI, pos, { route: 2 });
  h.step();
  const e = h.b.enemies[0];
  for (const f of [0, 1, 3, 5]) {
    assert.equal(h.b.pushDistance(e, f), 0, `pushDistance 力度 ${f}`);
    assert.equal(h.b.push(e, f, { from: { x: 3, y: 10 } }), 0, `push 力度 ${f}`);
    assert.equal(h.b.pull(e, f, { to: { x: 0, y: 0 }, stop: 0 }), 0, `pull 力度 ${f}`);
    assert.equal(h.b.pullToFront(e, h.unit(MINT), f), 0, `pullToFront 力度 ${f}`);
  }
  approx(Math.hypot(e.x - 5, e.y - 10), 0, 1e-9, 'in place');
});

test('B5: hovering enemies are 失衡免疫 while they hover, dragged once grounded (PRTS 吉兆飞鳞 / 掠海漂移体)', REAL, () => {
  const pos = [10, 5];
  for (const key of [PARROT, SYUFO]) {
    const { h, u } = mintVs(key, pos);
    h.step();
    const e = h.b.enemies[0];
    assert.ok(e.isFlying && e.s.flags.noDisplace, `${key}: hovering, 失衡免疫`);
    const { moved } = firstHitDrag(h, u, pos);
    approx(moved, 0, 1e-9, `${key}: hit while hovering, not moved`);
  }
  // grounded (吉兆飞鳞 晕眩模式 after a stun: no 失衡免疫, weight 0) → the 小力 drag moves it to her 急停 radius
  const { h, u } = mintVs(PARROT, pos);
  h.step();
  const e = h.b.enemies[0];
  h.b.applyStatus(e, 'stun', { duration: 1 });
  h.step();
  assert.ok(!e.isFlying && !e.s.flags.noDisplace, '晕眩模式: on the ground');
  const at = { x: e.x, y: e.y };
  // (her attacks are instant since the 阵法术师 strike every enemy in range at once — feedback E3: the first one may land
  // before the stun, while it still hovers; the next one, on the ground, drags it)
  const hitsOn = () => h.hooksOf('damaged').filter((c) => c.source === u && c.target === e).length;
  const n0 = hitsOn();
  assert.ok(h.runUntil(() => hitsOn() > n0, 8));
  approx(Math.hypot(e.x - at.x, e.y - at.y), Math.min(PUSH_TILES[0], Math.hypot(at.x - 3, at.y - 10) - PULL_STOP_RADIUS), 1e-6, 'dragged');
  // 掠海漂移体 爬行模式: no 失衡免疫, but weight 4 — 小力 − 4 = −4 → no movement (the table), 大力 (3) − 4 = −1 → 0.44
  const s = mintVs(SYUFO, pos).h;
  s.step();
  const z = s.b.enemies[0];
  s.b.applyStatus(z, 'stun', { duration: 0.5 });
  s.step();
  assert.ok(!z.isFlying && !z.s.flags.noDisplace, '爬行模式: a ground unit');
  assert.equal(s.b.pushDistance(z, 0), 0);
  approx(s.b.push(z, 3, { from: { x: 3, y: 10 } }), PUSH_TILES[-1], 1e-9, '大力 vs weight 4');
});

// ---------------------------------------------------------------------------------------------------------------------
// Audit: every displacement source of the pool × target class. Official: a 静态刚体 is never moved (every air unit of the
// mode, the 胄 parts too); a hovering enemy is 失衡免疫; a ground enemy follows the 力度 − 重量 tables. Whether a skill
// REACHES an air unit is its own selection — an attack-borne push / pull follows the operator's attack (melee attacks never
// select an air unit; 钩索师 / 阵法术师 / casters "可对空", PRTS 分支特性信息/data), an area effect takes every enemy in it
// unless its PRTS note says ground only (圣聆初雪 S1 "仅对地面单位产生推力") — checked as "hit" on the static drone and as
// "moved" on a synthetic dynamic flyer (DYN_FLY: what a non-static air unit would do).
//   [ASSUMED] (no PRTS note): 见行者 S2 "范围内所有敌人" and 歌蕾蒂娅 S3's tornado / 捕网 reach air units (阿消 S2's "可对空" is
//   the analogue); 乌尔比安 S1's anchor 捕网 skips them (a melee crusher's throw; 雪雉's 捕网 "不对空").

const SOURCES = [
  // name, chessId, skillIndex, ground, air: the push / pull reaches it, air: hit (default: as the push)
  ['野鬃 S2 夹枪冲锋', 'chess_char_1_19_a', 1, true, false],
  ['崖心 S1 锁链勾爪', 'chess_char_2_03_a', 0, true, true],
  ['崖心 S2 束缚链', 'chess_char_2_03_a', 1, true, true],
  ['见行者 S1 护身射击', 'chess_char_3_07_a', 0, true, false],
  ['见行者 S2 惊爆射击', 'chess_char_3_07_a', 1, true, true],
  ['薄绿 S2 聚能涡旋', 'chess_char_3_08_a', 1, true, true],
  ['莫斯提马 S3 序时之匙', 'chess_char_4_02_a', 2, true, true],
  ['歌蕾蒂娅 S1', 'chess_char_4_12_a', 0, true, true],
  ['歌蕾蒂娅 S2', 'chess_char_4_12_a', 1, true, true],
  ['歌蕾蒂娅 S3', 'chess_char_4_12_a', 2, true, true],
  ['百炼嘉维尔 S2 (4_23)', 'chess_char_4_23_a', 1, true, false],
  ['百炼嘉维尔 S2 (5_18)', 'chess_char_5_18_a', 1, true, false],
  ['乌尔比安 S1', 'chess_char_5_05_a', 0, true, false],
  ['山 S3 震地碎岩击', 'chess_char_5_17_a', 2, true, false],
  ['圣聆初雪 S1 铃音吹雪', 'chess_char_6_02_a', 0, true, false, true], // the push spares air units, the damage does not
  ['锏 S3 归于宁静', 'chess_char_6_19_a', 2, true, true],
];
const TARGETS = [['ground', SLIME, 0], ['static air', YOKAI, 2], ['dynamic air', DYN_FLY, 2], ['hover', PARROT, 0], ['胄 shell', SHELL, 2]];
const POS = [[10, 5], [10, 6], [10, 4], [11, 4]];

/**
 * One still enemy, the source's skill ready, `secs` s: the largest displacement and whether the source hit / stunned it
 * (positions tried in turn until it moves).
 */
function probe(chessId, skillIndex, key, route, secs = 10) {
  let best = 0, reached = false;
  for (const pos of POS) {
    const h = makeBattle({
      defs: { enemies: SYNTH },
      units: [{ chessId, row: 10, col: 3, dir: 'RIGHT', skillIndex, carryState: { sp: 1e3 } }],
      enemies: [{ key, pos, route, mods: STILL }], autoFinish: false, timeLimit: 60, hooks: ['damaged', 'statusApplied'], captureNoisy: true,
    });
    const e = () => h.b.enemies[0];
    for (let i = 0; i < secs * 30; i++) {
      h.step();
      if (!e() || !e().alive) break;
      best = Math.max(best, Math.hypot(e().x - pos[1], e().y - pos[0]));
    }
    const mine = (c) => c.target === e() && c.source && (c.source.defId === chessId || c.source.ownerUnit?.defId === chessId);
    reached = reached || h.hooksOf('damaged').some(mine) || h.hooksOf('statusApplied').some(mine);
    if (best > 0.01) break;
  }
  return { moved: best > 0.01, reached };
}

test('B5 audit: every displacement source × ground / static air / dynamic air / hovering / 胄 shell', REAL, () => {
  const wrong = [];
  for (const [name, id, si, ground, air, airHit = air] of SOURCES) {
    for (const [cls, key, route] of TARGETS) {
      const want = cls === 'ground' ? ground : cls === 'dynamic air' ? air : false;
      const { moved, reached } = probe(id, si, key, route);
      if (moved !== want) wrong.push(`${name} × ${cls}: ${moved ? 'moved' : 'stayed'}, official ${want ? 'moved' : 'stayed'}`);
      if (cls === 'static air' && reached !== airHit) wrong.push(`${name} × ${cls}: ${reached ? 'hit' : 'not hit'}, official ${airHit ? 'hit' : 'not hit'}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('B5 audit: 缪尔赛思 S3 — a melee 流形 copy\'s pulse reaches air units (PRTS 流形 "…可对空（包括近战流形）"), a static drone stays', REAL, () => {
  // the playtest #6 流形 layout (test/sim/playtest6-combat.test.js): the copy at (9,6) takes a melee guard's form
  const guard = chessRec({ id: 'test_guard_a', profession: 'WARRIOR', position: 'MELEE', stats: { atk: 500, blockCnt: 2, maxHp: 1e6, def: 0 }, skill: null });
  for (const [key, route, pulled] of [[SLIME, 0, true], [DYN_FLY, 2, true], [YOKAI, 2, false]]) {
    const h = makeBattle({
      defs: { chess: { test_guard_a: guard }, enemies: SYNTH },
      units: [
        { chessId: 'chess_char_6_11_a', row: 12, col: 3, skillIndex: 2 },
        { chessId: 'test_guard_a', row: 12, col: 6 },
        { kind: 'token', tokenId: 'token_10030_mlyss_wtrman', row: 9, col: 6, ownerUid: 1, dir: 'LEFT' },
      ],
      enemies: [{ key: SLIME, time: 9, route: 0, mods: { hpMul: 1e4, atkMul: 0 } }], autoFinish: false, timeLimit: 60,
    });
    const tok = () => h.b.allyUnits.find((x) => x.defId === 'token_10030_mlyss_wtrman' && x.alive);
    assert.ok(h.runUntil(() => tok()?.mem.mlyss && !tok().mem.mlyss.ranged, 12), 'a melee copy');
    const u = h.unit('chess_char_6_11_a');
    assert.equal(u.skill.id, 'skchr_mlyss_3');
    const t = tok();
    const e = h.spawn(key, { routeIndex: route, pos: [10, 7], mods: STILL });
    assert.ok(u.skill.activate('test', { free: true }), 'S3 on');
    h.step(2);
    // 小力 − weight 0 = 0: all the way to the 急停 radius around the copy's centre (from √2 tiles)
    if (pulled) approx(Math.hypot(e.x - t.x, e.y - t.y), PULL_STOP_RADIUS, 1e-6, `${key}: pulled to the copy`);
    else approx(Math.hypot(e.x - 7, e.y - 10), 0, 1e-9, `${key}: a 静态刚体 stays`);
  }
});

test('B5 audit: 溯光星源 S2 links (凝滞师, "可对空") pull a ground enemy to the target; a static drone stays linked in place', REAL, () => {
  const id = 'chess_char_6_16_a';
  // her range reaches col 5: the main target stands on (11,5), the linked enemy on (10,6) outside her range
  for (const [key, route, pulled] of [[SLIME, 0, true], [DYN_FLY, 2, true], [YOKAI, 2, false]]) {
    const h = makeBattle({
      defs: { enemies: SYNTH },
      units: [{ chessId: id, row: 10, col: 3, dir: 'RIGHT', skillIndex: 1, carryState: { sp: 1e3 } }],
      enemies: [{ key: SLIME, pos: [11, 5], mods: STILL }, { key, pos: [10, 6], route, mods: STILL }], autoFinish: false, timeLimit: 30,
    });
    const u = h.unit(id);
    assert.equal(u.skill.id, 'skchr_halo2_2');
    h.run(6);
    const [main, linked] = h.b.enemies;
    approx(Math.hypot(main.x - 5, main.y - 11), 0, 1e-9, 'the main target stays');
    // 小力 − weight 0 = 0: all the way, stopping 0.3 from the target (the kit's [ASSUMED] stop)
    if (pulled) approx(Math.hypot(linked.x - 5, linked.y - 11), 0.3, 1e-6, `${key}: linked and pulled to the target`);
    else approx(Math.hypot(linked.x - 6, linked.y - 10), 0, 1e-9, `${key}: a 静态刚体 stays`);
  }
});

test('B5: 刺胄之弹 / 斩胄之剑 / 破胄之锤 are 静态刚体 + 失衡免疫 — a fired shell pulled every tick still lands on time', REAL, () => {
  const pool = () => ({ hp: 1e7, maxHp: 1e7, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } });
  const run = (tug) => {
    const h = makeBattle({
      kind: 'boss', sharedBoss: pool(), autoFinish: false, timeLimit: 120, hooks: ['statusApplied'],
      defs: { chess: { t_hi: chessRec({ id: 't_hi', profession: 'TANK', stats: { atk: 900, maxHp: 1e7, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null }) } },
      kits: { t_hi: () => ({ trait: { noAttack: true } }) },
      units: [{ chessId: 't_hi', row: 10, col: 6 }],
    });
    h.step();
    // 灭顶之灾 takes an attack's turn (DESIGN §35.29): the leader attacks
    h.spawn('enemy_9013_acstmk', { pos: [3, 10], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
    const shell = () => h.b.enemies.find((x) => x.defId === SHELL);
    assert.ok(h.runUntil(() => !!shell(), 60), 'the shell is fired');
    const s = shell();
    assert.ok(s.s.flags.noDisplace && s.def.staticBody && s.isFlying, '失衡免疫 + 静态刚体');
    let moved = 0;
    while (s.alive && h.b.time < 110) {
      if (tug) {
        moved += h.b.pull(s, 5, { to: { x: 0, y: 0 }, stop: 0 }) + h.b.push(s, 5, { from: h.unit('t_hi') }) + h.b.pullToFront(s, h.unit('t_hi'), 5);
      }
      h.step();
    }
    const stun = h.hooksOf('statusApplied').find((c) => c.target === h.unit('t_hi') && c.status === 'stun');
    return { moved, landed: stun ? stun.t : null };
  };
  const ref = run(false), got = run(true);
  assert.ok(ref.landed != null, 'it explodes on its target');
  assert.equal(got.moved, 0, 'no pull or push moves it');
  approx(got.landed, ref.landed, 1e-9, 'on time');
  // the blades: 失衡免疫 in every mode (PRTS 天赋), 静态刚体 too
  const h = makeBattle({ autoFinish: false, timeLimit: 30 });
  h.step();
  for (const key of ['enemy_9014_acstma', 'enemy_9015_acstmb']) {
    const e = h.spawn(key, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0 } });
    assert.ok(e.s.flags.noDisplace && e.def.staticBody, key);
    e.motion = 'WALK'; // 【瘫痪】: a ground unit — still a 静态刚体 ("与单位的行动方式无关")
    h.b.removeBuff(e, 'boss:anchor');
    assert.equal(h.b.pull(e, 5, { to: { x: 2, y: 10 }, stop: 0 }), 0, `${key}: 瘫痪`);
  }
});

test('喷气人 飞行模式 = 近地悬浮 + 不可阻挡 + 失衡免疫 (PRTS 喷气人): an air unit nothing moves; then 1.333 s unblockable on the ground', REAL, () => {
  const ds = getDefaultSource();
  const s = ds.rawEnemy(BALLOON).skills.find((k) => k.prefabKey === 'TakeOff');
  const wall = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const h = makeBattle({
    defs: { chess: { t_wall: wall } }, kits: { t_wall: () => ({ trait: { noAttack: true } }) },
    units: [{ chessId: 't_wall', row: 9, col: 5 }], autoFinish: false, timeLimit: 60,
  });
  h.step();
  // nearly still (speed × 1e-3), so it stays on the wall's tile while the speed ratios stay measurable
  const e = h.spawn(BALLOON, { pos: [9, 5], routeIndex: 0, mods: { speedMul: 1e-3, atkMul: 0 } });
  const speed = () => e.s.moveSpeed / e.base.moveSpeed;
  const fly = 1 + s.bb['balloon_s[fly].move_speed'];
  assert.ok(h.runUntil(() => !!e.findBuff('ab:takeoff'), s.initCooldown + 1), 'takes off when blocked');
  const t0 = h.b.time;
  h.step();
  assert.ok(e.isFlying && e.s.flags.unblockable && e.s.flags.noDisplace && !e.blockedBy, '近地悬浮, 不可阻挡, 失衡免疫');
  assert.equal(e.motion, 'WALK', 'keeps the ground path');
  // "切换为飞行模式后，1.5秒内移动速度最终降低90%"
  approx(speed(), fly * 0.1, 1e-9, 'braking after the take-off');
  // 较大力 (2) − weight 3 = −1 would move a ground 喷气人 35 % of the way
  assert.equal(h.b.pull(e, 2, { to: { x: 9, y: 9 }, stop: 0 }), 0, 'not pulled');
  assert.equal(h.b.push(e, 3, { from: { x: 3, y: 9 } }), 0, 'not pushed');
  h.run(1.6);
  approx(speed(), fly, 1e-9, '移动速度+50%');
  // "飞行模式持续7秒；结束后，1.333秒内不可阻挡，移动速度最终降低90%"
  h.runUntil(() => !e.findBuff('ab:takeoff'), s.bb.duration);
  approx(h.b.time - t0, s.bb.duration, 0.05, '7 s of flight');
  h.step();
  assert.ok(!e.isFlying && !e.s.flags.noDisplace, 'landed: a ground unit');
  assert.ok(e.s.flags.unblockable && !e.blockedBy, 'unblockable for a while');
  approx(speed(), 0.1, 1e-9, 'braking after the landing');
  approx(h.b.push(e, 3, { from: { x: 3, y: 9 } }), PUSH_TILES[0], 1e-9, '大力 − 3 = 0 → 1.7 tiles');
  h.run(1.4);
  assert.ok(!e.s.flags.unblockable, 'blockable again after 1.333 s');
  approx(speed(), 1, 1e-9, 'its own speed');
});

test('守墓石像 (PRTS 天赋): the statue (无法被阻挡，自缚，失衡免疫，免疫浮空) and the flight (飞行单位，失衡免疫) — nothing moves it, even 失重', REAL, () => {
  const wall = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  for (const key of ['enemy_1172_dugago', 'enemy_1172_dugago_2']) {
    const h = makeBattle({
      defs: { chess: { t_wall: wall } }, kits: { t_wall: () => ({ trait: { noAttack: true } }) },
      units: [{ chessId: 't_wall', row: 10, col: 6 }], autoFinish: false, timeLimit: 60,
    });
    h.step();
    const e = h.spawn(key, { pos: [10, 6], routeIndex: 0, mods: { speedMul: 0, atkMul: 0 } });
    h.step();
    assert.ok(e.blockedBy && !e.def.staticBody && e.s.massLevel === 4, `${key}: blocked, a dynamic body of weight 4`);
    const dur = e.def.talent['stone.duration'];
    h.b.kill(e, null);
    h.step();
    assert.ok(e.alive && e.findBuff('ab:stone'), `${key}: the statue`);
    assert.ok(e.s.flags.unblockable && !e.blockedBy && e.s.flags.noMove && e.s.flags.noDisplace, `${key}: 无法被阻挡, 自缚, 失衡免疫`);
    assert.equal(h.b.applyStatus(e, 'levitate', { duration: 2 }), false, `${key}: 免疫浮空`);
    // 失重 (massFlat −1 → weight 3): 较大力 (2) − 3 = −1 would pull it 35 % of the way, 大力 (3) − 3 = 0 push it 1.7 tiles
    h.b.addBuff(e, { key: 'test:weightless', duration: 60, mods: { massFlat: -1 } });
    assert.equal(e.s.massLevel, 3);
    const at = { x: e.x, y: e.y };
    assert.equal(h.b.pull(e, 2, { to: { x: 2, y: 10 }, stop: 0 }), 0, `${key}: statue not pulled`);
    assert.equal(h.b.push(e, 3, { from: { x: 4, y: 10 } }), 0, `${key}: statue not pushed`);
    h.run(dur + 0.5);
    assert.ok(e.alive && e.motion === 'FLY' && e.isFlying && !e.findBuff('ab:stone'), `${key}: reborn as a flyer`);
    assert.ok(e.s.flags.noDisplace && !e.def.staticBody, `${key}: 失衡免疫 (not a 静态刚体)`);
    assert.equal(h.b.pull(e, 2, { to: { x: 2, y: 10 }, stop: 0 }), 0, `${key}: flyer not pulled`);
    assert.equal(h.b.push(e, 3, { from: { x: 4, y: 10 } }), 0, `${key}: flyer not pushed`);
    assert.equal(h.b.pullToFront(e, h.unit('t_wall'), 5), 0, `${key}: flyer not hooked`);
    approx(Math.hypot(e.x - at.x, e.y - at.y), 0, 1e-9, `${key}: in place`);
    checkInvariants(h.b);
  }
});
