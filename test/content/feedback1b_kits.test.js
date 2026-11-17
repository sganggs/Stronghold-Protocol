// Player reports after the public 0.1.0 release, second batch — operator kits (workstream WH):
//   B3 "干员维娜维多利亚三技能错误的只能召唤出一只黄金盟誓" — her default S3 俱以我之名 placed one 黄金盟誓. Official text:
//      "立即在天赋一生效范围内可部署地面召唤“黄金盟誓”" (skill_table skchr_siege2_3), the English client "Summons Golden
//      Vows on deployable tiles within Talent 1's range" (arknights.wiki.gg: "only be spawned on open low ground
//      tiles"): one on every free deployable melee tile of her talent-1 area (the 8 tiles around her). The token's
//      maxDeployCount 1 is its hand limit and does not cap the skill.
//   B4 "干员玛恩纳开技能没伤害" — his default S3 未照耀的荣光 (CUSTOM_RANGE: any enemy on the skill range, flyers too)
//      fired on a flying wave and hit nothing for 26 s: the kit never let it hit air units, although PRTS 备注 says
//      "※可对空" (DESIGN §19.1 lists it). The same note fixes the per-kill rule: "每击倒一名符合条件的敌人，特性提供的
//      攻击力加成-10%，特性最低降低至+0%", only kills by "自身普通攻击（与该次攻击附带的伤害）", "加成降低于当次攻击后统一
//      结算".
// The player scenarios run the real product path: a real solo Match, the player's board in PlayerState, the normal
// field's BattleSpec (Match._normalOpts — what the browser and the server both build their Battle from) on 战场#05
// (下半) with the real round waves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from '../match/harness.js';
import { checkLoadout } from '../../shared/protocol.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { COLS } from '../../server/sim/constants.js';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const VINA = 'chess_char_6_07_a';
const MLYNAR = 'chess_char_5_19_a';
const LION = 'token_10040_siege2_vlion';
const STAGE = 'act2autochess_m01';
const chess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≉ ${b}`);

/**
 * The normal field of a solo player at PREP of `round` (seed `seed`) with exactly `pieces` ([chessId, row, col, dir?])
 * on the board: the real Match, PlayerState, loadout and round wave, built like Match._ccField does.
 */
function realField({ pieces, round, seed, loadout = {}, stageId = STAGE, spawns = null }) {
  const lo = checkLoadout(loadout, chess).loadout;
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout: lo }], seed }).start();
  const ps = h.ps('p_0');
  const ok = h.drive(() => { if (ps.lp > 0 && ps.lp < 300) ps.lp = 300; return h.m.phase === 'PREP' && h.m.round === round; });
  assert.ok(ok, `PREP R${round}`);
  h.setStage(stageId);
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  for (const [id, r, c, dir] of pieces) { const p = ps.newPiece('chess', id); if (dir) p.dir = dir; ps.board.set(`${r},${c}`, p); }
  ps.recompute();
  const opts = h.m._normalOpts(ps);
  if (spawns) opts.spawns = spawns(opts);
  const spec = buildBattleSpec({ ...opts, battleId: 'feedback1b', fieldId: 'n:p_0', kind: 'normal', content: h.m.battleContent });
  const b = createBattleFromSpec(spec, h.m.ds, { quiet: true, recordEvents: false });
  return { h, m: h.m, ps, spec, b };
}

/** Free tiles of the 3×3 talent-1 area around `u` a melee piece could be deployed on (the official "可部署地面"). */
function deployableAround(b, u) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const r = u.tileR + dr, c = u.tileC + dc;
    if ((!dr && !dc) || !b.grid.inRect(r, c) || !b.grid.canStand(r, c, { ranged: false })) continue;
    if (b.unitAt(r, c) || b.isReservedTile(r, c)) continue;
    out.push(r * COLS + c);
  }
  return out.sort((x, y) => x - y);
}

// ------------------------------------------------------------------------------------------------------------------
// B3 维娜·维多利亚 S3 俱以我之名

test('B3 维娜·维多利亚 S3 (default skill, real match): a 黄金盟誓 on every free deployable tile around her — not one', () => {
  const ally = Object.values(DATA.chess).find((c) => c.tier === 1 && !c.isGolden && c.visible && c.position === 'MELEE');
  // (10,5) on 战场#05 (下半): melee tiles (11,5), (9,4), (9,5) around her; high ground and forbidden tiles take none.
  // The second layout puts an operator on (9,5): the lions take the two tiles left.
  for (const id of [VINA, chess(VINA).goldenId]) for (const extra of [[], [[ally.chessId, 9, 5]]]) {
    const { b, m } = realField({ pieces: [[id, 10, 5], ...extra], round: 8, seed: 11 });
    const u = b.allyUnits.find((x) => x.defId === id);
    assert.equal(u.def.skill.id, 'skchr_siege2_3', 'S3 is her default skill');
    let expected = null, lions = null, most = 0;
    b.on('skillStart', (c) => { if (c.unit === u && !lions) lions = b.allyUnits.filter((t) => t.defId === LION && t.alive); });
    while (!u.skill.active && b.time < 120 && !b.finished) { expected = deployableAround(b, u); b.step(); }
    assert.ok(u.skill.active, `${id}: S3 cast in the R8 wave (t=${b.time.toFixed(1)})`);
    assert.equal(expected.length, 3 - extra.length, 'the scenario: free melee tiles of her area');
    assert.deepEqual(lions.map((t) => t.tileR * COLS + t.tileC).sort((x, y) => x - y), expected, `${id} ${extra.length ? 'with an ally' : 'alone'}: one per free deployable tile`);
    if (extra.length) assert.ok(b.allyUnits.some((x) => x.defId === extra[0][0] && x.alive && x.tileR === 9 && x.tileC === 5), 'the operator keeps its tile');
    // they all stay for the skill (the token's maxDeployCount 1 caps hand deployments, not the skill) and count for
    // 诸王的叹息 ("此范围内每个友方单位使维娜攻击力+5%")
    const t0 = u.def.talents[0].bb;
    for (let i = 0; i < 14; i++) b.step();
    const around = b.allyUnits.filter((a) => a !== u && a.alive && Math.max(Math.abs(a.tileR - u.tileR), Math.abs(a.tileC - u.tileC)) <= 1);
    assert.equal(around.filter((a) => a.defId === LION).length, expected.length, 'every lion still around her');
    approx(u.findBuff('siege2:kings').mods.atkPct, t0.atk * around.length, 1e-9, '+5 % per ally around, lions included');
    while (u.skill.active && !b.finished) { b.step(); most = Math.max(most, b.allyUnits.filter((t) => t.defId === LION && t.alive).length); }
    assert.ok(most <= expected.length);
    b.step();
    assert.equal(b.allyUnits.filter((t) => t.defId === LION && t.alive).length, 0, 'every 黄金盟誓 leaves when the skill ends');
    m.dispose();
  }
});

test('B3 维娜·维多利亚 S3: fence tiles (low, deployable, not walkable) are deployable ground too; a re-cast summons a fresh set', () => {
  // 战场#01 act1autochess_m01 (11,4): road (12,4), (12,5), (10,4) and fence (12,3), (11,3), (10,3) — (10,5) / (11,5)
  // take no melee piece
  const dummy = enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, atk: 0 });
  const h = makeBattle({ stageId: 'act1autochess_m01', defs: { enemies: { enemy_dummy: dummy } }, units: [{ chessId: VINA, row: 11, col: 4, carryState: { sp: 64 } }], enemies: [{ key: 'enemy_dummy', pos: [12, 5] }], autoFinish: false, timeLimit: 120 });
  h.step();
  const u = h.unit(VINA);
  const expected = deployableAround(h.b, u);
  assert.equal(expected.length, 6, 'the scenario: 6 deployable tiles around her');
  assert.equal(expected.filter((k) => !h.b.grid.groundPassable((k / COLS) | 0, k % COLS, true)).length, 3, '3 of them fences');
  assert.ok(h.runUntil(() => u.skill.active, 10));
  const tiles = () => h.b.allyUnits.filter((t) => t.defId === LION && t.alive).map((t) => t.tileR * COLS + t.tileC).sort((x, y) => x - y);
  assert.deepEqual(tiles(), expected);
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  h.step();
  assert.deepEqual(tiles(), []);
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 5));
  assert.deepEqual(tiles(), expected, 'the next cast: a full set again');
  checkInvariants(h.b);
});

// ------------------------------------------------------------------------------------------------------------------
// B4 玛恩纳 S3 未照耀的荣光

/** A flying wave of the real match: the R2 wave of seed 21 is the FLY round; else the same flyers made explicit. */
const flyers = (opts) => {
  const fly = (s) => DATA.enemies[s.enemyKey]?.motion === 'FLY';
  if (opts.spawns.length && opts.spawns.every(fly)) return opts.spawns;
  const route = opts.routes.findIndex((r) => r.motion === 'FLY');
  return [{ time: 3, enemyKey: 'enemy_1005_yokai', count: 4, interval: 7, routeIndex: route }, { time: 15, enemyKey: 'enemy_1005_yokai', count: 5, interval: 7, routeIndex: route }];
};

test('B4 玛恩纳 S3 (default skill, real match, a flying wave): the cast hits the air units in its range (PRTS 备注 "※可对空")', () => {
  for (const id of [MLYNAR, chess(MLYNAR).goldenId]) {
    const { b, m } = realField({ pieces: [[id, 10, 5, 'RIGHT']], round: 2, seed: 21, spawns: flyers });
    const u = b.allyUnits.find((x) => x.defId === id);
    assert.equal(u.def.skill.id, 'skchr_mlynar_3', 'S3 is his default skill');
    const bb = u.def.skill.bb, t0 = u.def.talents[0].bb;
    const hits = [];
    let casts = 0, castFlyers = 0;
    b.on('skillStart', (c) => {
      if (c.unit !== u) return;
      casts++;
      castFlyers = b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }).filter((e) => e.isFlying).length;
    });
    b.on('hit', (c) => { if (c.source === u && c.dmg.isAttack) hits.push({ fly: c.target.isFlying, amount: c.dmg.amount, atk: u.s.atk, active: u.skill.active }); }, { priority: -999 });
    let killed = 0;
    b.on('kill', (c) => { if (c.killer === u && c.victim.isFlying) killed++; });
    while (!b.finished && b.time < 400) b.step();
    assert.ok(casts >= 1 && castFlyers >= 1, `${id}: S3 cast on the flyers entering its range`);
    const air = hits.filter((x) => x.fly && x.active);
    assert.ok(air.length >= 5, `${id}: skill attacks on air units (${air.length})`);
    for (const x of air) {
      const scale = x.amount / (x.atk * bb['attack@atk_scale']);
      assert.ok(Math.abs(scale - t0.atk_scale_base) < 1e-6 || Math.abs(scale - t0.atk_scale_up) < 1e-6, `125 / 150 % ATK × 游侠 (${scale})`);
    }
    assert.ok(killed >= 1, `${id}: flyers knocked out by his skill (${killed})`);
    m.dispose();
  }
});

test('B4 玛恩纳 S1 / S2 have no 对空 note: their attacks stay ground-only (and they never fire on flyers alone)', () => {
  for (const skill of [0, 1]) {
    const { b, m } = realField({ pieces: [[MLYNAR, 10, 5, 'RIGHT']], round: 2, seed: 21, spawns: flyers, loadout: { [MLYNAR]: { skill } } });
    const u = b.allyUnits.find((x) => x.defId === MLYNAR);
    let air = 0, casts = 0;
    b.on('skillStart', (c) => { if (c.unit === u) casts++; });
    b.on('hit', (c) => { if (c.source === u && c.dmg.isAttack && c.target.isFlying) air++; });
    while (!b.finished && b.time < 400) b.step();
    assert.equal(air, 0, `S${skill + 1}`);
    assert.equal(casts, 0, `S${skill + 1}: SEARCH needs a target of his own range`);
    m.dispose();
  }
});

test('B4 玛恩纳 S3 per-kill rule (PRTS 备注): trait ATK bonus −10 % per kill of his own attacks, settled after the attack, floor +0 %', () => {
  const weak = (key) => enemyRec({ key, hp: 1, def: 0, speed: 0, atk: 0 });
  const h = makeBattle({
    defs: { enemies: { enemy_weak: weak('enemy_weak'), enemy_foe: weak('enemy_foe') } },
    units: [{ chessId: MLYNAR, row: 10, col: 4, dir: 'RIGHT' }], hooks: ['damaged', 'damageOutput'], captureNoisy: true, autoFinish: false, timeLimit: 120,
  });
  const u = h.unit(MLYNAR);
  const bb = u.def.skill.bb;
  h.run(10.5);
  const ramp = u.trait.ramp;
  approx(ramp, 0.5, 1e-9, 'ramp after 10 s (+200 % over 40 s)');
  const wave = () => { for (const p of [[10, 5], [10, 6], [10, 7], [11, 5], [9, 5]]) h.spawn('enemy_weak', { pos: p }); };
  wave();
  const bonus = () => u.s.atk / u.base.atk - 1;
  let atCast = null;
  h.b.on('skillStart', (c) => { if (c.unit === u) atCast = bonus(); });
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  approx(atCast, ramp * bb.trait_up, 1e-9, 'trait ×2 at the cast');
  // The injury-stage mark can kill before the parent reaches HP settlement; observe its output instead.
  const own = () => h.hooksOf('damageOutput').filter((c) => c.source === u && c.dmg.isAttack);
  assert.ok(h.runUntil(() => own().length >= 5, 3));
  const vol = own().filter((c) => c.t === own()[0].t);
  assert.equal(vol.length, 5, '5 targets');
  for (const c of vol) approx(c.amount, vol[0].amount, 1e-9, 'one attack, one ATK: the reduction is settled after the attack');
  approx(bonus(), ramp * bb.trait_up + 5 * bb.per_kill_reduce, 1e-9, '5 kills: +100 % → +50 %');
  // a kill by 无动于衷's reflection is not a kill of his attacks
  const foe = h.spawn('enemy_foe', { pos: [12, 9] });
  h.b.dealDamage(foe, u, { amount: 1, type: 'phys', isAttack: true });
  assert.equal(foe.alive, false, 'reflected to death');
  approx(bonus(), ramp * bb.trait_up + 5 * bb.per_kill_reduce, 1e-9, 'reflect kill: no reduction');
  wave();
  assert.ok(h.runUntil(() => own().length >= 10, 3));
  h.step();
  approx(bonus(), 0, 1e-9, '10 kills: +0 %');
  wave();
  assert.ok(h.runUntil(() => own().length >= 15, 3));
  h.step();
  approx(bonus(), 0, 1e-9, 'never below +0 %');
  assert.ok(u.skill.active);
  assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []);
  checkInvariants(h.b);
});

test('B4 玛恩纳: a kill by the damage his attack carries (卡西米尔 bond true damage, 天马之枪) is a kill of his own attack — S2 keeps the ramp, S3 lowers the bonus', () => {
  const weak = (key) => enemyRec({ key, hp: 1, def: 0, speed: 0, atk: 0 });
  const KAZ6 = { kazimierzShip: { count: 6, active: true, tier: 2, layers: 0 } };
  const PEGASUS = ['chess_item_5_09_e_a', 'chess_item_6_01_e_a']; // 天马之盔 + 天马之枪: 30% scaled origin as source-less true addition
  for (const [label, items, bonds, carried] of [['卡西米尔 6', [], KAZ6, 'bond:kazimierz'], ['天马之盔 + 天马之枪', PEGASUS, {}, 'item:pegasus']]) {
    const setup = (skillIndex) => {
      const h = makeBattle({
        defs: { enemies: { enemy_weak: weak('enemy_weak') } },
        units: [{ chessId: MLYNAR, row: 10, col: 4, dir: 'RIGHT', items, skillIndex }], bonds, autoFinish: false, timeLimit: 200,
      });
      const u = h.unit(MLYNAR);
      // which damage instance of his knocked each victim out (the last one he dealt it before the kill)
      const lastTags = new Map(), killedBy = [];
      h.b.on('damaged', (c) => { if (c.credit === u) lastTags.set(c.target, c.dmg?.tags || []); });
      h.b.on('kill', (c) => { if (c.killer === u) killedBy.push(lastTags.get(c.victim) || []); });
      return { h, u, killedBy };
    };
    // S2 未宽解的悲哀: "技能期间若击倒敌人，技能结束时特性效果不重置"
    {
      const { h, u, killedBy } = setup(1);
      assert.equal(u.def.skill.id, 'skchr_mlynar_2');
      h.run(20.5);
      const ramp = u.trait.ramp;
      approx(ramp, 1, 1e-9, `${label}: ramp after 20 s`);
      h.spawn('enemy_weak', { pos: [10, 5] });
      u.skill.gainSp(1000);
      assert.ok(h.runUntil(() => u.skill.active, 2));
      assert.ok(h.runUntil(() => !u.skill.active, 40));
      h.step();
      assert.equal(killedBy.length, 1, `${label}: S2 knocked the enemy out`);
      assert.ok(killedBy[0].includes(carried), `${label}: the carried damage landed the kill (${killedBy[0]})`);
      approx(u.trait.ramp, ramp, 1e-9, `${label}: S2 kill of his attack keeps the ramp`);
    }
    // S3 未照耀的荣光: −10 % trait bonus per own kill
    {
      const { h, u, killedBy } = setup(2);
      assert.equal(u.def.skill.id, 'skchr_mlynar_3');
      const bb = u.def.skill.bb;
      h.run(10.5);
      const ramp = u.trait.ramp;
      for (const p of [[10, 5], [10, 6], [10, 7], [11, 5], [9, 5]]) h.spawn('enemy_weak', { pos: p });
      const bonus = () => u.s.atk / u.base.atk - 1;
      let atCast = null;
      h.b.on('skillStart', (c) => { if (c.unit === u) atCast = bonus(); }, { priority: -1000 });
      u.skill.gainSp(1000);
      assert.ok(h.runUntil(() => u.skill.active, 2));
      assert.ok(h.runUntil(() => killedBy.length >= 5, 3), `${label}: S3 knocks the 5 enemies out`);
      h.step();
      // the carried damage (or the S3 mark his attack set off, whichever hook runs first) landed the kills
      assert.ok(killedBy.every((t) => t.includes(carried) || t.includes('mlynarOwn')), `${label}: carried damage landed the kills`);
      assert.ok(killedBy.some((t) => t.includes(carried)) || carried === 'bond:kazimierz', `${label}: some kill by ${carried}`);
      assert.equal(u.mem.mlyKills, 5, `${label}: 5 own kills`);
      approx(bonus() - atCast, 5 * bb.per_kill_reduce, 1e-9, `${label}: 5 kills: −50 points (ramp ${ramp})`);
      assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []);
    }
  }
});

test('B4 玛恩纳: a kill outside his attack does not count, even of an enemy his attack hit — 无动于衷 reflection, a mark another operator set off (PRTS 备注 exclusions)', () => {
  const tough = enemyRec({ key: 'enemy_tough', hp: 1e9, def: 0, speed: 0, atk: 0 });
  // a Kazimierz teammate without attacks of its own here: the reflection's target and the mark's trigger
  const kaz = chessRec({ id: 'test_kaz_a', bonds: ['kazimierzShip'], skill: null, stats: { atk: 1 }, rangeGrid: [[0, 0]] });
  const setup = (skillIndex) => {
    const h = makeBattle({
      defs: { enemies: { enemy_tough: tough }, chess: { test_kaz_a: kaz } },
      units: [{ chessId: MLYNAR, row: 10, col: 4, dir: 'RIGHT', skillIndex }, { chessId: 'test_kaz_a', row: 9, col: 4, dir: 'RIGHT' }],
      autoFinish: false, timeLimit: 200,
    });
    const u = h.unit(MLYNAR), mate = h.unit('test_kaz_a');
    let attacked = 0;
    h.b.on('attack', (c) => { if (c.attacker === u) attacked++; }, { priority: -1000 });
    const kills = [];
    h.b.on('kill', (c) => kills.push(c));
    // his attack has hit `foe` and is over (the hit set is closed): the moment between two of his attacks
    const afterHisAttackOn = (foe) => {
      let hitFoe = false;
      const off = h.b.on('damaged', (c) => { if (c.source === u && c.target === foe && c.dmg?.isAttack) hitFoe = true; });
      for (let i = 0; i < 300 && !(hitFoe && attacked); i++) { if (!hitFoe) attacked = 0; h.step(); }
      h.b.off(off);
      assert.ok(hitFoe && attacked, 'his attack hit the enemy');
    };
    const nextAttack = () => { attacked = 0; assert.ok(h.runUntil(() => attacked > 0, 5), 'his next attack'); };
    return { h, u, mate, kills, afterHisAttackOn, nextAttack };
  };
  const killOutside = (h, u, mate, foe, how) => {
    foe.hp = 1;
    if (how === 'reflect') h.b.dealDamage(foe, mate, { amount: 1, type: 'phys', isAttack: true }); // 无动于衷 reflects onto it
    else h.b.dealDamage(mate, foe, { amount: 0.01, type: 'true', isAttack: true }); // the mate's attack sets off his mark
  };
  // S3: the bonus stays where it is
  for (const how of ['reflect', 'mark']) {
    const { h, u, mate, kills, afterHisAttackOn, nextAttack } = setup(2);
    h.run(10.5);
    const A = h.spawn('enemy_tough', { pos: [10, 5] });
    h.spawn('enemy_tough', { pos: [10, 7] }); // keeps him attacking
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.active, 2));
    afterHisAttackOn(A);
    const before = u.s.atk / u.base.atk - 1;
    killOutside(h, u, mate, A, how);
    assert.equal(A.alive, false, `S3 ${how}: the enemy is knocked out`);
    const k = kills.find((c) => c.victim === A);
    assert.equal(k?.killer, u, `S3 ${how}: by 玛恩纳`);
    nextAttack();
    h.step();
    assert.ok(u.skill.active);
    assert.equal(u.mem.mlyKills, 0, `S3 ${how}: not a kill of his own attack`);
    approx(u.s.atk / u.base.atk - 1, before, 1e-9, `S3 ${how}: trait bonus unchanged`);
    assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []);
  }
  // S2: a reflection kill of an enemy he hit does not keep the ramp
  {
    const { h, u, mate, kills, afterHisAttackOn } = setup(1);
    h.run(20.5);
    approx(u.trait.ramp, 1, 1e-9, 'ramp after 20 s');
    const A = h.spawn('enemy_tough', { pos: [10, 5] });
    h.spawn('enemy_tough', { pos: [10, 6] });
    u.skill.gainSp(1000);
    assert.ok(h.runUntil(() => u.skill.active, 2));
    afterHisAttackOn(A);
    killOutside(h, u, mate, A, 'reflect');
    assert.equal(A.alive, false);
    assert.equal(kills.find((c) => c.victim === A)?.killer, u);
    assert.ok(h.runUntil(() => !u.skill.active, 40));
    assert.ok(u.trait.ramp < 0.05, `S2: the ramp resets at the skill end (${u.trait.ramp})`);
    assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []);
  }
});


test('Mlynar excludes a nested reflection kill after his attack already produced a Pegasus child', () => {
  const h = makeBattle({ autoFinish: false, defs: { enemies: {
    enemy_reflector: enemyRec({ key: 'enemy_reflector', hp: 1000000, def: 0, atk: 0, speed: 0 }),
  } }, units: [{ chessId: MLYNAR, row: 10, col: 4, skillIndex: 2,
    items: ['chess_item_5_09_e_a', 'chess_item_6_01_e_a'] }] });
  h.step();
  const b = h.b, u = h.unit(MLYNAR), e = h.spawn('enemy_reflector', { pos: [10, 5] });
  u.skill.gainSp(1000);
  assert.ok(u.skill.activate('test'));
  u.atkCd = 999;
  let reflected = false, children = 0;
  b.on('damageApplied', c => { if (c.dmg.tags?.includes('item:pegasus')) children++; });
  b.addBuff(e, { key: 'nested-enemy-attack', observeInjury(c) {
    if (reflected || c.source !== u || !c.dmg.isAttack) return;
    reflected = true;
    e.hp = 1;
    b.dealDamage({ source: e, target: u, amount: 1, type: 'true', isAttack: true });
  } });
  b.dealDamage({ source: u, target: e, amount: 1000, type: 'phys', isAttack: true });
  assert.ok(children > 0, 'carried child was applied before the nested reflection');
  assert.ok(reflected);
  assert.equal(e.alive, false);
  assert.equal(u.mem.mlyPending || 0, 0, 'reflection queues no own-attack kill');
  b.emit('attack', { attacker: u, targets: [e] });
  assert.equal(u.mem.mlyKills, 0, 'reflection is excluded after the attack settles');
  assert.deepEqual(b.errors, []);
});
