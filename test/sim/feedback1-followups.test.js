// Follow-ups of the 0.1.1 integration (the workstreams' cross-workstream notes and last review rounds), each against its
// primary source:
//   * PRTS 作战机制 §AOE伤害判定 "AOE的判定是对攻击范围内的每个可以被选中的敌人进行判定" + 隐匿 "无法被敌方的索敌机制和Buff选择器选中":
//     radius area damage of an operator (profession splash, skill circles — Battle.foesInRadius) skips an unblocked,
//     unrevealed 隐匿 enemy and the untargetable (player report #8: the 逐火 余烬; until 0.1.1 they were hit);
//   * PRTS 溅射半径一览: 投掷手 0.9, 链术师 1.7, 扩散术师 1.1 (格雷伊 1.0), 迷迭香 末梢阻断 1.5;
//   * PRTS 阿罗玛 天赋 备注: the 非首次标记 is shared by every 阿罗玛 and leaves with its setter;
//   * PRTS 盟约记录 奥术法阵 备注: 炎佑's damage silences its target while a carrier is on the field;
//   * PRTS 特殊机制 §重生: skills restart from their initial cooldown when a 重生 ends (test/content/enemies_bosses 锏);
//   * PRTS 高准度伦蒂尼姆城防自行炮 (test/content/enemies_bosses); PRTS 琳琅诗怀雅 S3 备注 range 2-4 (below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { resolveProfile } from '../../server/sim/professions.js';
import { CHAIN_RADIUS } from '../../server/sim/constants.js';
import { spawnYanyou } from '../../server/sim/content/tokens.js';

const ds = getDefaultSource();
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e8, atk: 0, speed: 0, ...o });
const stealth = (h, e) => h.b.addBuff(e, { key: 'test:stealth', flags: { stealth: true }, persist: true });
const dmgTo = (h, src, e) => h.hooksOf('damaged').filter((c) => c.source === src && c.target === e).reduce((s, c) => s + c.amount, 0);

test('profession splash skips an unblocked 隐匿 enemy and hits it once revealed (PRTS §AOE伤害判定: only enemies that can be selected)', () => {
  for (const reveal of [false, true]) {
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'chess_char_1_14_a', row: 10, col: 3 }], timeLimit: 60, hooks: ['damaged'], captureNoisy: true, autoFinish: false });
    h.step();
    const u = h.unit('chess_char_1_14_a');
    const main = h.spawn('enemy_dummy', { pos: [10, 5] });
    const hid = h.spawn('enemy_dummy', { pos: [10, 4.4] });   // 0.6 from the main target: inside 格雷伊's 1.0 splash
    stealth(h, hid);
    if (reveal) h.b.addBuff(hid, { key: 'test:reveal', flags: { reveal: true }, persist: true });
    h.run(6);
    assert.ok(dmgTo(h, u, main) > 0, 'the main target is struck');
    if (reveal) assert.ok(dmgTo(h, u, hid) > 0, 'revealed: splashed (and targetable)');
    else assert.equal(dmgTo(h, u, hid), 0, 'unblocked 隐匿: never splashed (it used to be)');
    checkInvariants(h.b);
  }
});

test('Battle.foesInRadius: no untargetable or unblocked 隐匿 enemy; a blocked or revealed one counts; enemiesInRadius keeps them all', () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [], timeLimit: 30, autoFinish: false });
  h.step();
  const [a, b, c, d] = [[10, 5], [10, 5.2], [10, 5.4], [10, 5.6]].map((pos) => h.spawn('enemy_dummy', { pos }));
  stealth(h, b);
  h.b.addBuff(c, { key: 'test:untargetable', flags: { untargetable: true }, persist: true });
  stealth(h, d);
  h.b.addBuff(d, { key: 'test:reveal', flags: { reveal: true }, persist: true });
  assert.deepEqual(h.b.foesInRadius(5, 10, 1).map((e) => e.id).sort(), [a.id, d.id].sort());
  assert.equal(h.b.enemiesInRadius(5, 10, 1).length, 4, 'enemy-side auras and heals still reach them all');
});

test('PRTS 溅射半径一览: 投掷手 0.9, 扩散术师 1.1 but 格雷伊 1.0, 链术师 jumps 1.7', () => {
  const prof = (id) => resolveProfile(ds.getChess(id));
  assert.equal(prof('chess_char_6_12_a').splashRadius, 0.9, '迷迭香 (投掷手)');
  assert.equal(prof('chess_char_1_14_a').splashRadius, 1.0, '格雷伊');
  assert.equal(prof('chess_char_1_14_b').splashRadius, 1.0, '格雷伊 (elite)');
  for (const id of ['chess_char_4_02_a', 'chess_char_4_14_a', 'chess_char_5_12_a', 'chess_char_5_21_a']) assert.equal(prof(id).splashRadius, 1.1, id);
  assert.equal(CHAIN_RADIUS, 1.7);
  for (const id of ['chess_char_1_03_a', 'chess_char_6_05_a']) assert.equal(prof(id).chain.radius, 1.7, id);
});

test('阿罗玛\'s 非首次标记 is shared (PRTS 备注 "不同阿罗玛之间的非首次标记通用") and leaves with its setter ("自身离场时移除自身已施加的标记")', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ uid: 'A', chessId: 'chess_char_4_10_a', row: 10, col: 1 }, { uid: 'B', chessId: 'chess_char_4_10_a', row: 10, col: 2 }],
    timeLimit: 60, hooks: ['statusApplied', 'damaged'], captureNoisy: true, autoFinish: false,
  });
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  const [A, B] = ['A', 'B'].map((uid) => h.b.allyUnits.find((u) => u.uid === uid));
  assert.ok(h.runUntil(() => dmgTo(h, A, e) > 0 && dmgTo(h, B, e) > 0, 15), 'both 阿罗玛 strike it');
  h.run(1);
  const lev = () => h.hooksOf('statusApplied').filter((c) => c.target === e && c.status === 'levitate');
  assert.equal(lev().length, 1, 'one 浮空 for the pair (each used to trigger her own)');
  const mark = e.findBuff('aroma:bubbled');
  assert.ok(mark, 'the shared mark');
  const setter = mark.source, other = setter === A ? B : A;
  h.b.kill(setter, null);
  assert.ok(!e.findBuff('aroma:bubbled'), 'its setter left: the mark goes');
  const n = lev().length;
  assert.ok(h.runUntil(() => lev().length > n, 10), 'the other 阿罗玛\'s next attack is a first attack again');
  assert.equal(e.findBuff('aroma:bubbled').source, other);
  checkInvariants(h.b);
});

test('奥术法阵 on the field: 炎佑\'s damage silences its target (PRTS 盟约记录 备注 "造成伤害时使目标失去特殊能力5秒"); none without a carrier', () => {
  const ARC = 'chess_item_3_08_e_a';
  for (const carried of [true, false]) {
    const units = [{ chessId: 'chess_char_1_02_a', row: 12, col: 2, ...(carried ? { items: [ARC] } : {}) }];
    const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units, timeLimit: 60, hooks: ['statusApplied', 'damaged'], captureNoisy: true, autoFinish: false });
    h.step();
    const [y] = spawnYanyou(h.b, 'p1', { atk: 400, hp: 50000 });
    const e = h.spawn('enemy_dummy', { pos: [9, 7] });
    assert.ok(h.runUntil(() => dmgTo(h, y, e) > 0, 20), '炎佑 deals damage');
    h.run(0.2);
    const sil = h.hooksOf('statusApplied').filter((c) => c.target === e && c.status === 'silence' && c.source === y);
    if (carried) {
      assert.ok(sil.length > 0, 'silenced by 炎佑');
      assert.ok(Math.abs(sil[0].duration - 5) < 1e-9, '5 s');
    } else assert.equal(sil.length, 0, 'no carrier: no rider');
    checkInvariants(h.b);
  }
});
