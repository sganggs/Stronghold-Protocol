import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { branchSpawn } from '../../server/sim/content/bosses.js';
import { MAX_ALIVE_ENEMIES } from '../../server/sim/constants.js';
import { PLUGIN_SPAWN_TOTAL, PLUGIN_TIMES_MAX, PLUGIN_GAIN_COUNT_MAX, boundedCount } from '../../shared/plugins/limits.js';
import { getData } from '../../server/data.js';
import { applyCard } from '../../server/match/choices.js';
import { DATA, makeMatch } from '../match/harness.js';

const walker = (o = {}) => enemyRec({ key: 'enemy_w', hp: 1000, speed: 0, ...o });

test('shared spawn cap equals the engine cap and a fractional count is not floored', () => {
  assert.equal(PLUGIN_SPAWN_TOTAL, MAX_ALIVE_ENEMIES);
  assert.equal(boundedCount(2.5, PLUGIN_TIMES_MAX, 0), 2.5);
  assert.equal(boundedCount(1e9, PLUGIN_TIMES_MAX, 0), PLUGIN_TIMES_MAX);
  assert.equal(boundedCount(Number.POSITIVE_INFINITY, PLUGIN_TIMES_MAX, 3), 3);
});

test('branchSpawn stops at the living cap and does not allocate a refusal per extra count', () => {
  const h = makeBattle({ defs: { enemies: { enemy_w: walker() } }, content: 'none', timeLimit: 5, recordEvents: false });
  h.step();
  for (let i = 0; i < MAX_ALIVE_ENEMIES; i++) h.b.spawnEnemy('enemy_w', { pos: [10, 8] });
  assert.equal(h.b.aliveEnemies().length, MAX_ALIVE_ENEMIES);
  const before = h.b.errorCount;
  const t0 = Date.now();
  const got = branchSpawn(h.b, { branches: { bomb: [[{ key: 'enemy_w', count: 1e9, routeIndex: 0 }]] }, extraRoutes: [] }, 'bomb', 0);
  const ms = Date.now() - t0;
  assert.equal(got.length, 0);
  assert.equal(h.b.aliveEnemies().length, MAX_ALIVE_ENEMIES);
  assert.equal(h.b.errorCount, before);
  assert.ok(ms < 1000, `branchSpawn took ${ms}ms`);
});

test('one branch count on an empty field spawns at most MAX_ALIVE_ENEMIES', () => {
  const h = makeBattle({ defs: { enemies: { enemy_w: walker() } }, content: 'none', timeLimit: 5, recordEvents: false });
  h.step();
  const before = h.b.errorCount;
  const t0 = Date.now();
  const got = branchSpawn(h.b, { branches: { bomb: [[{ key: 'enemy_w', count: 1e6, routeIndex: 0 }]] }, extraRoutes: [] }, 'bomb', 0);
  assert.equal(got.length, MAX_ALIVE_ENEMIES);
  assert.equal(h.b.aliveEnemies().length, MAX_ALIVE_ENEMIES);
  assert.equal(h.b.errorCount, before);
  assert.ok(Date.now() - t0 < 2000, `spawn took ${Date.now() - t0}ms`);
});

test('catapult extra hits stop at PLUGIN_TIMES_MAX', () => {
  const src = getData().enemies.enemy_10162_mnctpt;
  const enemy = structuredClone(src);
  assert.equal(typeof enemy.talents.bb['Attack.attack@times'], 'number');
  enemy.talents.bb['Attack.attack@times'] = 1e6;
  enemy.stats = { ...enemy.stats, atk: 750, rangeRadius: 8, moveSpeed: 0, bat: 2.5 };
  const h = makeBattle({
    defs: {
      enemies: { enemy_10162_mnctpt: enemy },
      chess: { t_wall: chessRec({ id: 't_wall', profession: 'WARRIOR', skill: null, stats: { maxHp: 1e12, atk: 0, def: 0, res: 0, blockCnt: 99, bat: 5 } }) },
    },
    units: [{ chessId: 't_wall', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_10162_mnctpt', pos: [9, 7] }],
    timeLimit: 6,
    recordEvents: false,
  });
  const t0 = Date.now();
  h.run(3);
  const ms = Date.now() - t0;
  const wall = h.unit('t_wall');
  const lost = wall.base.maxHp - wall.hp;
  assert.ok(ms < 1500, `attack loop took ${ms}ms`);
  assert.ok(lost > 0, 'the catapult dealt no damage');
  assert.equal(lost % 750, 0);
  const hits = lost / 750;
  assert.ok(hits <= PLUGIN_TIMES_MAX * 4, `hits ${hits}`);
  assert.ok(hits <= PLUGIN_TIMES_MAX || hits % PLUGIN_TIMES_MAX === 0);
});

test('列装 and bond-chess grants loop at most PLUGIN_GAIN_COUNT_MAX', () => {
  const data = structuredClone(DATA);
  const equip = data.effects.allybuff_select_1.buffs.find(b => b.key === 'global_special_choice_gain_equip');
  equip.bb.count = 1e9;
  const bondEff = Object.values(data.effects).find(e => e.buffs?.some(b => b.key === 'single_special_choice_gain_bond_chess'));
  bondEff.buffs.find(b => b.key === 'single_special_choice_gain_bond_chess').bb.count = 1e9;
  const h = makeMatch({ mode: 'solo', humans: 1, fake: true, data, seed: 1 }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  let pools = 0, items = 0;
  m.rollPool = () => { pools++; return null; };
  m.rollItemId = () => { items++; return null; };
  const t0 = Date.now();
  applyCard(m, ps, { kind: 'tactic', id: 'allybuff_select_1', family: 'tactic', team: false });
  assert.equal(items, PLUGIN_GAIN_COUNT_MAX);
  assert.ok(pools === 0 || pools === PLUGIN_GAIN_COUNT_MAX);
  assert.ok(Date.now() - t0 < 1000, `content grant took ${Date.now() - t0}ms`);
  items = 0;
  pools = 0;
  const runKey = m.dispatcher.runKey.bind(m.dispatcher);
  m.dispatcher.runKey = () => false;
  const t1 = Date.now();
  applyCard(m, ps, { kind: 'tactic', id: 'allybuff_select_1', family: 'tactic', team: false });
  assert.equal(items, PLUGIN_GAIN_COUNT_MAX);
  assert.equal(pools, 0);
  assert.ok(Date.now() - t1 < 1000, `fallback grant took ${Date.now() - t1}ms`);
  // Granting the same chess 32 times merges and rolls a reward. Stub the grant so the count is the choice loop.
  let rolls = 0;
  let gained = 0;
  ps.acquireChess = () => { gained++; return null; };
  m.pool.roll = () => { rolls++; return 'chess_char_1_01_a'; };
  m.dispatcher.runKey = runKey;
  const t2 = Date.now();
  applyCard(m, ps, { kind: 'tactic', id: bondEff.effectId, family: 'tactic', team: false });
  assert.equal(rolls, PLUGIN_GAIN_COUNT_MAX);
  assert.equal(gained, PLUGIN_GAIN_COUNT_MAX);
  assert.ok(Date.now() - t2 < 1000, `bond grant took ${Date.now() - t2}ms`);
  rolls = 0;
  gained = 0;
  m.dispatcher.runKey = () => false;
  const t3 = Date.now();
  applyCard(m, ps, { kind: 'tactic', id: bondEff.effectId, family: 'tactic', team: false });
  assert.equal(rolls, PLUGIN_GAIN_COUNT_MAX);
  assert.equal(gained, PLUGIN_GAIN_COUNT_MAX);
  assert.ok(Date.now() - t3 < 1000, `bond fallback took ${Date.now() - t3}ms`);
  m.dispose();
});

test('named operator, band, hammer, 黑云 and warden loops stop at the official cap', async () => {
  const { bbCap, fieldCap } = await import('../../shared/plugins/officialBounds.js');
  const { setGameData } = await import('../../server/sim/content/support/index.js');
  const { bandMetaHandler } = await import('../../server/sim/content/bands/meta.js');
  const { payHammers } = await import('../../server/sim/content/bonds/core.js');
  const { FLY_KITS } = await import('../../server/sim/content/enemies/fly.js');
  const { LEADER_KITS } = await import('../../server/sim/content/enemies/leaders.js');
  const zuole = (await import('../../server/sim/content/kits/ops/op-zuole.js')).default;
  const acpion = (await import('../../server/sim/content/kits/ops/standin-acpion.js')).default;
  const wisdel = (await import('../../server/sim/content/kits/ops/op-wisdel.js')).default;
  getData();
  const timesCap = bbCap('times');
  const countCap = bbCap('count');
  const shockCap = bbCap('attack@times');
  const ammoCap = fieldCap('enemy.sp.maxSp');
  assert.ok(timesCap >= 64 && timesCap < 1000);
  assert.ok(countCap >= 64 && countCap < 1000);
  assert.ok(shockCap >= 64 && shockCap < 1000);
  assert.ok(ammoCap >= 64 && ammoCap < 1000);

  const form = (id) => structuredClone(getData().backups.units[id].forms['2/1/4/0']);
  const zuoleForm = form('char_4121_zuole');
  zuoleForm.skills[2].bb.times = 1e9;
  let slashes = 0;
  const zuoleBattle = {
    enemiesInKeys() { slashes++; return []; },
    fx() {}, dealDamage() {}, applyStatus() {},
  };
  const unit = { alive: true, deployed: true, tileR: 8, tileC: 4, dir: 0, x: 4, y: 8, fwd: { x: 1, y: 0 }, s: { atk: 100 }, mem: {}, id: 'u' };
  const tZuole = Date.now();
  zuole.char_4121_zuole({}, zuoleForm).skills.skchr_zuole_3.onStart({ battle: zuoleBattle, unit });
  assert.equal(slashes, timesCap);
  assert.ok(Date.now() - tZuole < 1000, `zuole ${Date.now() - tZuole}ms`);

  const acpionForm = form('char_608_acpion');
  acpionForm.skills[2].bb.times = 1e9;
  let timers = 0;
  const acpionBattle = { after() { timers++; }, addBuff() {}, releaseBlocked() {}, addDp() {}, fx() {} };
  const tAcpion = Date.now();
  acpion.char_608_acpion({}, acpionForm).skills.skchr_acpion_3.onStart({ battle: acpionBattle, unit: { ...unit, deploySeq: 1, ownerId: 'p' } });
  assert.equal(timers, timesCap);
  assert.ok(Date.now() - tAcpion < 1000, `acpion ${Date.now() - tAcpion}ms`);

  const chess = structuredClone(getData().chess.chess_char_6_12_a);
  chess.trait.bb['attack@times'] = 1e9;
  chess.trait.bb['attack@enable_third_attack'] = 0;
  let shocks = 0;
  const tWis = Date.now();
  wisdel.char_1035_wisdel({}, chess).trait.afterHit({ after() { shocks++; } }, { s: { atk: 1, atkScaleMul: 1 } }, {}, { x: 0, y: 0 });
  assert.equal(shocks, shockCap);
  assert.ok(Date.now() - tWis < 1000, `wisdel ${Date.now() - tWis}ms`);

  const data = structuredClone(getData());
  const orchid = data.bands.band_orchid.buffs.find(b => b.key === 'preparation_start_gain_chess_from_round');
  orchid.bb.count = 1e9;
  setGameData(data);
  try {
    let grants = 0;
    const ctx = {
      round: orchid.bb.round,
      gd: { item: () => ({}), chess: () => null },
      grantItem() { grants++; return true; },
      grantChess() { grants++; return true; },
    };
    const tBand = Date.now();
    bandMetaHandler('band_orchid').onPrepStart(ctx); // the prep start since GitHub #851
    assert.equal(grants, countCap);
    assert.ok(Date.now() - tBand < 1000, `orchid ${Date.now() - tBand}ms`);
  } finally {
    setGameData(null);
  }

  const bond = structuredClone(getData().bonds.victoriaShip);
  bond.buffs.find(b => b.key === 'bond_layer_added_reward_equip').bb.count = 1e9;
  const counters = {};
  let rolls = 0;
  const tVic = Date.now();
  const granted = payHammers({
    bondActive: () => true,
    layers: () => 25,
    counter: (k) => counters[k] || 0,
    setCounter: (k, v) => { counters[k] = v; },
    rollItem: () => { rolls++; return 'item_x'; },
    grantItem: () => true,
    data: { bonds: { victoriaShip: bond } },
  });
  assert.equal(rolls, countCap);
  assert.equal(granted, countCap);
  assert.ok(Date.now() - tVic < 1000, `victoria ${Date.now() - tVic}ms`);

  const enemy = { alive: true, def: { raw: { sp: { maxSp: 1e9 } } }, s: { atk: 100 }, mem: { ab: { ammo: 1e9 } }, id: 'cloud' };
  const ab = { sk: { KillOthers: { bb: { sp: 1e9, range_radius: 1.5, duration: 4 } }, FireWeapon: { bb: { atk_scale: 1.3 }, sp: 1 } } };
  const salvo = FLY_KITS.enemy_9009_acfort(ab, enemy)[1];
  const ally = { alive: true, deployed: true, hidden: false, kind: 'op', s: { flags: {} }, id: 'a' };
  let hits = 0;
  const tCloud = Date.now();
  salvo.fire({ allies: () => [ally], rng: { pick: (xs) => xs[0] }, fx() {}, dealDamage() { hits++; } }, enemy);
  assert.equal(hits, ammoCap);
  assert.ok(Date.now() - tCloud < 1000, `black cloud ${Date.now() - tCloud}ms`);

  const wardenAb = { t: {}, sk: { ironsandstorm: { bb: { max_target: 1, stun: 0 }, sp: 1 }, armorpiercing: { bb: { times: 1e9, def_penetrate: 0.5 }, sp: 1 } } };
  const hooks = LEADER_KITS.enemy_1516_jakill(wardenAb);
  const e = { alive: true, s: { atk: 10, maxHp: 100 }, x: 0, y: 0, id: 'w', buffs: [], mem: { ab: { list: [] } }, profile: {}, base: { bat: 1, def: 0 }, form: null, atkCd: 0 };
  let pierces = 0;
  const b = { aliveEnemies: () => [], addBuff() {}, removeBuff() {}, fx() {}, time: 0, dealDamage() { pierces++; } };
  hooks[1].killed({}, b, e, {});
  hooks[0].attack({}, b, e);
  hooks[0].before({}, b);
  const tWard = Date.now();
  hooks[0].dealt({ target: { alive: true }, dmg: { isAttack: true } }, b, e);
  assert.equal(pierces, timesCap - 1);
  assert.ok(Date.now() - tWard < 1000, `warden ${Date.now() - tWard}ms`);
});
