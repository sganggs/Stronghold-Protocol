import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData, getVersionData, setData } from '../server/data.js';
import { DataSource } from '../server/sim/simdata.js';
import { setGameData } from '../server/sim/content/support/index.js';
import { createRegistry } from '../server/match/effectsMeta.js';
import { makeBattle, chessRec, enemyRec } from './helpers/battleHarness.js';
import { makeMatch, give, giveItem } from './match/harness.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';

const current = getData();
const ids = ['act1autochess@V1_1', 'act1autochess', 'act2autochess@V2_1'];
const bond = (tier, layers = 0) => ({ active: true, tier, layers, count: 6 });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function inVersion(id, fn) {
  const data = getVersionData(id);
  setData(data);
  setGameData(data);
  try { fn(data); } finally { setData(current); setGameData(current); }
}

function battle(data, opts = {}) {
  const chess = {
    t_melee: chessRec({ id: 't_melee', bonds: ['preciShip', 'skillfulShip'], skill: null }),
    t_range: chessRec({ id: 't_range', profession: 'SNIPER', position: 'RANGED', skill: null }),
    t_other: chessRec({ id: 't_other', skill: null }),
  };
  return makeBattle({ data: new DataSource({ ...data, chess: { ...data.chess, ...chess }, enemies: { ...data.enemies, enemy_test: enemyRec({ hp: 1e8, speed: 0, def: 300 }) } }),
    units: [{ chessId: 't_melee', row: 10, col: 4 }, { chessId: 't_range', row: 11, col: 5 }, { chessId: 't_other', row: 12, col: 3 }], ...opts });
}

for (const id of ids) {
  test(`${id}: BattleSpec carries identity, rejects wrong data; no ABYSS`, () => inVersion(id, (data) => {
    const spec = buildBattleSpec({ version: id, content: 'none' });
    assert.equal(spec.version, id);
    assert.throws(() => createBattleFromSpec(spec, new DataSource(current)), /does not match/);
    assert.doesNotThrow(() => createBattleFromSpec(spec, new DataSource(data)));
    assert.throws(() => makeMatch({ data, mode: 'solo', difficulty: 'ABYSS' }), /unavailable/);
    assert.ok(!Object.hasOwn(buildBattleSpec({ version: 'act2autochess' }), 'version'));
  }));

  test(`${id}: deployment order and old 以己之长 scope`, () => inVersion(id, (data) => {
    const h = battle(data, { bandId: 'band_chen' });
    h.b.start();
    const order = h.b.allyUnits.slice().sort((a, b) => a.deploySeq - b.deploySeq).map((u) => u.defId);
    assert.deepEqual(order, id.startsWith('act1') ? ['t_melee', 't_range', 't_other'] : ['t_other', 't_melee', 't_range']);
    const e = h.spawn('enemy_test', { pos: [10, 6] });
    for (const name of ['t_melee', 't_range']) {
      const dmg = { type: 'phys', amount: 100 };
      h.b.emit('hit', { source: h.unit(name), target: e, dmg });
      // V1_1 predates Chen's strategy entirely.
      if (data.bands.band_chen) assert.equal(dmg.type, name === 't_range' ? 'arts' : 'phys');
    }
    h.invariants();
  }));

  test(`${id}: 远见 old discount keys latch and affect real prices`, () => inVersion(id, (data) => {
    const h = makeMatch({ data, registry: createRegistry(), fake: true }).start().toPrep();
    const ps = h.ps('p_0');
    ps.bonds.visiShip = bond(1, 200);
    ps.layers.visiShip = 200;
    h.m.dispatch(ps, 'onLayers', { bondId: 'visiShip' });
    const ev = { kind: 'chess', id: 'chess_char_1_01_a', price: 3 };
    h.m.dispatch(ps, 'onPrice', ev);
    assert.equal(ev.price, 2);
    h.m.dispose();
  }));
}

for (const id of ids.slice(0, 2)) {
  test(`${id}: historical solo timers, unlimited opt-in and co-op convenience`, () => inVersion(id, (data) => {
    const h = makeMatch({ data, mode: 'solo', registry: createRegistry(), fake: true }).start().toPrep();
    assert.equal(h.m.soloUntimed, false);
    assert.equal(h.m.deadline - h.sched.now(), 300000);
    h.m.opts.soloUnlimited = true;
    h.m.enterPrep();
    assert.equal(h.m.deadline, 0);
    h.m.dispose();
    const coop = makeMatch({ data, registry: createRegistry(), fake: true });
    assert.equal(coop.m.soloUntimed, true);
    coop.m.dispose();
  }));

  test(`${id}: bench equipment still fails without moving pieces`, () => inVersion(id, (data) => {
    const h = makeMatch({ data, registry: createRegistry(), fake: true }).start().toPrep();
    const ps = h.ps('p_0');
    const opId = h.m.gd.visibleChess[0];
    const itemId = Object.keys(data.items).find((k) => data.items[k].effectId === 'eff_acarm055');
    const held = give(h.m, ps, opId);
    const item = giveItem(h.m, ps, itemId);
    const before = ps.privateView();
    assert.equal(ps.equip(item.uid, held.uid).error, 'BAD_TARGET');
    assert.deepEqual(ps.privateView(), before);
    h.m.dispose();
  }));

  test(`${id}: 精准, 灵巧, 突袭 milestones and 协防 scope follow old blackboards`, () => inVersion(id, (data) => {
    const h = battle(data, { bonds: { preciShip: bond(2), skillfulShip: bond(1), raidShip: bond(1, 30), emptyShip: bond(1) } });
    h.b.start();
    const melee = h.unit('t_melee'), range = h.unit('t_range'), other = h.unit('t_other');
    close(melee.s.atk, melee.base.atk);
    assert.ok(range.s.atk > range.base.atk);
    assert.ok(range.s.aspd > range.base.aspd, 'diagonal ally receives 灵巧 at zero layers');
    close(other.s.costMul, .5);
    close(other.s.dmgDealtMul, id.endsWith('V1_1') ? 1 : 1.2);
    const enemy = h.spawn('enemy_test', { pos: [10, 6] });
    h.b.emit('attack', { attacker: range, targets: [enemy] });
    assert.equal(enemy.s.flags.silence, true);
    h.invariants();
  }));

  test(`${id}: 标准模拟 clause and 伪装服 are active only in their intended windows`, () => inVersion(id, (data) => {
    const normal = battle(data, { modeId: 'mode_single_normal', bandId: 'band_amiya' });
    normal.b.start();
    close(normal.unit('t_other').s.atk, normal.unit('t_other').base.atk);
    const funny = battle(data, { modeId: 'mode_single_funny', bandId: 'band_amiya' });
    funny.b.start();
    close(funny.unit('t_other').s.atk, funny.unit('t_other').base.atk * 1.3);
    const itemId = Object.keys(data.items).find((k) => data.items[k].effectId === 'eff_acarm055');
    const h = battle(data, { units: [{ chessId: 't_other', row: 10, col: 4, items: [itemId] }] });
    h.b.start();
    assert.equal(h.unit('t_other').s.flags.camou, true);
    h.run(26);
    assert.equal(!!h.unit('t_other').s.flags.camou, false);
  }));
}

test('AUTO_STOP closes after half duration only with an enemy in running range', () => {
  const ends = [];
  const h = makeBattle({ autoFinish: false, defs: {
    chess: { t_stop: chessRec({ id: 't_stop', skill: { duration: 10, initSp: 10, spCost: 10, trigger: { rule: 'AUTO_STOP' } } }) },
    enemies: { enemy_test: enemyRec({ hp: 1e8, speed: 0, def: 300 }) },
  }, units: [{ chessId: 't_stop', row: 10, col: 4 }], kits: { t_stop: () => ({ skill: { kind: 'duration', onEnd: (c) => ends.push(c.reason) } }) } });
  h.b.start();
  h.unit('t_stop').skill.activate();
  h.run(6);
  assert.deepEqual(ends, []);
  h.spawn('enemy_test', { pos: [10, 5] });
  h.step();
  assert.deepEqual(ends, ['manual']);
});

function prep(data) {
  const h = makeMatch({ data, mode: 'solo', registry: createRegistry(), fake: true }).start().toPrep();
  const ps = h.ps('p_0');
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.bandId = null;
  ps.layers = {};
  for (const id of Object.keys(data.bonds)) if (id !== 'soloShip' && id !== 'investShip') ps.bondCountBonus[id] = 20;
  ps.recompute();
  return { h, ps, end: () => h.m.dispatch(ps, 'onPrepEnd', {}) };
}

test('historical prep traits: 煌 transforms, 蜜莓 repeats, 坚守 needs three in its row, 伊芙利特 follows facing', () => inVersion('act1autochess', (data) => {
  const { h, ps, end } = prep(data);
  const grants = [];
  const acquire = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, opts) => { grants.push(id); return acquire(id, opts); };
  const huang = give(h.m, ps, data.garrisons.garrison_52_a.owners[0]);
  h.m.dispatch(ps, 'onSold', { piece: huang, gain: 0 });
  assert.ok(grants.includes('chess_char_5_03_a'));
  const before = Object.values(ps.layers).reduce((a, b) => a + b, 0);
  ps.acquireChess(data.garrisons.garrison_58_a.owners[0]);
  assert.equal(Object.values(ps.layers).reduce((a, b) => a + b, 0) - before, 4);
  ps.hand.fill(null); ps.temp.fill(null); ps.layers = {};
  const gains = {};
  const addLayers = ps.addLayers.bind(ps);
  ps.addLayers = (id, n, opts = {}) => {
    const added = addLayers(id, n, opts);
    if (/^(SERVER_|garrison)/.test(String(opts.reason || ''))) gains[id] = (gains[id] || 0) + added;
    return added;
  };
  const guard = data.garrisons.garrison_69_a.owners[0];
  give(h.m, ps, guard, 'board', [10, 3]);
  end(); assert.equal(gains.steadShip || 0, 0);
  const filler = Object.values(data.chess).find((c) => c.visible && !c.isGolden && c.garrisonIds.every((g) => data.garrisons[g].eventType === 'IN_BATTLE'));
  give(h.m, ps, filler.chessId, 'board', [10, 4]);
  give(h.m, ps, filler.chessId, 'board', [10, 5]);
  end(); assert.equal(gains.steadShip, 3);
  ps.board.clear(); ps.layers = {};
  for (const id of Object.keys(gains)) delete gains[id];
  const ifrit = give(h.m, ps, data.garrisons.garrison_83_a.owners[0], 'board', [10, 3]);
  ifrit.dir = 'UP';
  give(h.m, ps, filler.chessId, 'board', [11, 3]);
  give(h.m, ps, filler.chessId, 'board', [10, 4]);
  end();
  for (const id of filler.bonds) if (id !== 'soloShip') assert.equal(gains[id], 2, id);
  h.m.dispose();
}));

test('historical shop handlers: first refresh equipment costs one; packaging grants the carrier; pager keeps its bonds', () => inVersion('act1autochess', (data) => {
  const { h, ps } = prep(data);
  const byEffect = (eff) => Object.values(data.items).find((r) => r.effectId === eff).id;
  const carrierId = h.m.gd.visibleChess.find((id) => h.m.pool.left(id) > 0);
  const carrier = give(h.m, ps, carrierId, 'board', [10, 3]);
  ps.layers.skillfulShip = 20;
  ps.recompute(); ps.round.refreshes = 1;
  ps.shop.slots = [{ kind: 'item', id: byEffect('eff_acarm055'), basePrice: 4, frozen: false }];
  h.m.dispatch(ps, 'onRefresh', { trigger: false });
  assert.equal(ps.shop.slots[0].basePrice, 1);
  ps.shop.slots[0].basePrice = 4; ps.round.refreshes = 2;
  h.m.dispatch(ps, 'onRefresh', { trigger: false });
  assert.equal(ps.shop.slots[0].basePrice, 4);
  const packageItem = giveItem(h.m, ps, byEffect('eff_acarm074'));
  assert.deepEqual(ps.equip(packageItem.uid, carrier.uid), { ok: true });
  const grants = [];
  const acquire = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, opts) => { grants.push(id); return acquire(id, opts); };
  for (let i = 0; i < 8; i++) h.m.dispatch(ps, 'onSold', { gain: 0 });
  assert.deepEqual(grants, [h.m.gd.baseIdOf(carrier.id)]);
  const pager = giveItem(h.m, ps, byEffect('eff_acarm075'));
  ps.shop.level = 6;
  assert.deepEqual(ps.equip(pager.uid, carrier.uid), { ok: true });
  for (const slot of ps.shop.slots.filter(Boolean)) {
    assert.equal(slot.kind, 'chess');
    assert.ok(data.chess[slot.id].bonds.some((b) => data.chess[carrier.id].bonds.includes(b)));
  }
  h.m.dispose();
}));

test('historical battle traits grant front skills, heal on freeze and never emit the later 坚守 retaliation', () => inVersion('act1autochess', (data) => {
  const fixture = { ...data, chess: { ...data.chess,
    t_grant: { ...chessRec({ id: 't_grant' }), garrisonIds: ['garrison_72_a'] },
    t_heal: { ...chessRec({ id: 't_heal', bonds: ['steadShip'], skill: null }), garrisonIds: ['garrison_27_a'] },
  } };
  const h = battle(fixture, { bonds: { preciShip: bond(1), steadShip: bond(2) }, units: [
    { chessId: 't_grant', row: 10, col: 3, dir: 'RIGHT' },
    { chessId: 't_melee', row: 10, col: 4 },
    { chessId: 't_heal', row: 11, col: 4 },
  ] });
  h.b.start();
  const target = h.unit('t_melee'), healer = h.unit('t_heal');
  const enemy = h.spawn('enemy_test', { pos: [11, 5] });
  h.b.emit('skillStart', { unit: target });
  assert.equal(h.result().perPlayer.p1.layerGains.preciShip, 1);
  healer.hp -= 300;
  const hp = healer.hp;
  h.b.applyStatus(enemy, 'freeze', { duration: 5, source: healer });
  h.step();
  assert.ok(healer.hp > hp);
  let hits = 0;
  h.b.on('hit', ({ target: t }) => { if (t === enemy) hits++; });
  h.b.dealDamage({ source: enemy, target: healer, amount: 100, type: 'phys' });
  assert.equal(hits, 0);
  h.invariants();
}));
