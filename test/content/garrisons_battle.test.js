// IN_BATTLE 特质 (server/sim/content/garrisons/battle.js). Every garrison id carried by a visible chess (and every id
// such a garrison grants) is exercised with its own blackboard numbers; one normal and one elite id per key are also
// asserted with literal numbers. The last test checks that coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getData } from '../../server/data.js';

const D = getData({ log: { warn() {}, error() {}, info() {} } });
const GR = (gid) => D.garrisons[gid];
const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (v, d = 0) => (Number.isFinite(+v) && v !== '' && v != null ? +v : d);
const capOf = (gid) => (num(GR(gid).bb.max_add_count_per_battle) > 0 ? num(GR(gid).bb.max_add_count_per_battle) : Infinity);

/** IN_BATTLE garrison ids carried by visible chess, and the ids those grant. */
const VISIBLE_IDS = new Set();
for (const c of Object.values(D.chess)) if (c.visible) for (const g of c.garrisonIds || []) if (GR(g).eventType === 'IN_BATTLE') VISIBLE_IDS.add(g);
for (const g of [...VISIBLE_IDS]) if (GR(g).bbStr.give_garrison_id) VISIBLE_IDS.add(GR(g).bbStr.give_garrison_id);
const idsOfKey = (key) => [...VISIBLE_IDS].filter((g) => GR(g).effectKey === key).sort();
const COVER = new Set();
const cover = (gid) => { assert.ok(GR(gid), gid); COVER.add(gid); };

const rec = (id, garrisonIds, o = {}) => ({ ...chessRec({ id, ...o }), garrisonIds });
const B = (layers = 0, active = true) => ({ count: active ? 3 : 0, active, tier: active ? 1 : 0, layers });
const dummy = (o = {}) => ({ ...enemyRec({ key: 'e_dummy', hp: 1e7, speed: 0, ...o }), tags: o.tags ?? [] });
const gains = (h, pid = 'p1') => h.result().perPlayer[pid].layerGains;
const approx = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${msg} ${a} ≈ ${b}`);

/** Battle with synthetic operators: units = [{ id, g: garrisonIds, row, col, bonds?, o? }]. */
function battle({ units, bonds = {}, enemies = [], edefs = {}, kind, seed = 3, players } = {}) {
  const chess = {};
  for (const u of units) chess[u.id] = rec(u.id, u.g ?? [], { bonds: u.bonds ?? [], ...(u.o || {}) });
  const h = makeBattle({
    kind, seed, bonds, players,
    defs: { chess, enemies: { e_dummy: dummy(), ...edefs } },
    units: units.map((u) => ({ chessId: u.id, row: u.row, col: u.col })),
    enemies, autoFinish: false, timeLimit: 400,
  });
  h.step(1);
  return h;
}
const skill = (h, u) => h.b.emit('skillStart', { unit: u, skill: u.skill, reason: 'test' });
const alwaysHit = (h) => { h.b.rng = Object.assign(() => 0, h.b.rng); };

/**
 * Layer-gain scenario of a garrison: the holder's own bonds, the player's bond states and the expected target bonds.
 *   bond_by_id             listed bonds active (0 layers) + an unrelated active bond that must not move
 *   bond_self              holder bonds 炎 / 谢拉格 (active) / 阿戈尔 (inactive) → 炎, 谢拉格
 *   bond_actived_maxstack  炎 5, 坚守 9 (active), 阿戈尔 50 (inactive) → 坚守
 */
function scenario(gid) {
  const st = GR(gid).bbStr;
  if (st.bond_type === 'bond_self') return { unitBonds: ['yanShip', 'kjeragShip', 'egirShip'], bonds: { yanShip: B(0), kjeragShip: B(0), egirShip: B(0, false) }, targets: ['yanShip', 'kjeragShip'] };
  if (st.bond_type === 'bond_actived_maxstack') return { unitBonds: [], bonds: { yanShip: B(5), steadShip: B(9), egirShip: B(50, false) }, targets: ['steadShip'] };
  const t = ids(st.bond_id);
  const bonds = Object.fromEntries(t.map((b) => [b, B(0)]));
  const other = ['suntShip', 'emptyShip'].find((b) => !t.includes(b));
  bonds[other] = B(0);
  return { unitBonds: [], bonds, targets: t };
}
const expectAll = (h, targets, n, msg) => {
  const g = gains(h);
  for (const b of targets) assert.equal(g[b] ?? 0, n, `${msg} ${b}`);
  for (const b of Object.keys(g)) assert.ok(targets.includes(b), `${msg}: unexpected gain on ${b}`);
};

// ---------------------------------------------------------------------------------------------------------------------
// layer events

test('useskill (莎草 42 / 菲莱 43 / 百炼嘉维尔 128 / 塑心 90 / 纯烬艾雅法拉 140): per-id amount per skill and per-battle cap', () => {
  for (const gid of idsOfKey('act1autochess_gar_event_useskill')) {
    if (!D.garrisons[gid].owners.some((o) => D.chess[o].visible)) continue; // granted ids: see the ADD_BOND tests
    const g = GR(gid);
    const sc = scenario(gid);
    const row = g.bbStr.bond_add_type === 'by_charcount_samerow';
    const units = [{ id: 'op', g: [gid], row: 10, col: 4, bonds: sc.unitBonds }];
    if (row) units.push({ id: 'm1', row: 10, col: 6 }, { id: 'm2', row: 10, col: 8 }, { id: 'o', row: 11, col: 4 });
    const h = battle({ units, bonds: sc.bonds });
    const per = row ? 3 * num(g.bb.bond_add_count_multi) : num(g.bb.bond_add_count);
    skill(h, h.unit('op'));
    expectAll(h, sc.targets, Math.min(per, capOf(gid)), gid);
    for (let i = 0; i < 29; i++) skill(h, h.unit('op'));
    expectAll(h, sc.targets, Math.min(30 * per, capOf(gid)), `${gid} ×30`);
    cover(gid);
  }
  // literal numbers (normal / elite)
  const one = (gid, n, bonds, units = []) => {
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }, ...units], bonds });
    for (let i = 0; i < n; i++) skill(h, h.unit('op'));
    return gains(h);
  };
  assert.deepEqual(one('garrison_43_a', 2, { sargonShip: B(0) }), { sargonShip: 12 }, '菲莱 +6 per skill');
  assert.deepEqual(one('garrison_43_b', 1, { sargonShip: B(0) }), { sargonShip: 12 }, '菲莱 精锐 +12');
  assert.deepEqual(one('garrison_42_a', 3, { sargonShip: B(0) }), { sargonShip: 5 }, '莎草: first skill only');
  assert.deepEqual(one('garrison_42_b', 3, { sargonShip: B(0) }), { sargonShip: 10 });
  assert.deepEqual(one('garrison_128_a', 1, { sargonShip: B(0) }), { sargonShip: 9 });
  assert.deepEqual(one('garrison_128_b', 1, { sargonShip: B(0) }), { sargonShip: 18 });
  assert.deepEqual(one('garrison_140_a', 1, { yanShip: B(5), steadShip: B(9) }), { steadShip: 3 });
  assert.deepEqual(one('garrison_140_b', 1, { yanShip: B(5), steadShip: B(9) }), { steadShip: 6 });
  const mates = [{ id: 'm1', row: 10, col: 6 }];
  assert.deepEqual(one('garrison_90_a', 1, { yanShip: B(1) }, mates), { yanShip: 2 }, '塑心: 2 in the row × 1');
  assert.deepEqual(one('garrison_90_a', 9, { yanShip: B(1) }, mates), { yanShip: 10 }, 'cap 10');
  assert.deepEqual(one('garrison_90_b', 9, { yanShip: B(1) }, mates), { yanShip: 20 }, 'elite: × 2, cap 20');
  assert.deepEqual(one('garrison_43_a', 1, { sargonShip: B(0, false) }), {}, 'inactive bond: nothing');
});

test('selfkillenemy (送葬人 / 休谟斯 / 斯卡蒂 / 海霓 / 伺夜 / 风笛 / 荒芜拉普兰德): every check_cnt kills, per-id caps', () => {
  for (const gid of idsOfKey('act1autochess_gar_event_selfkillenemy')) {
    if (!D.garrisons[gid].owners.some((o) => D.chess[o].visible)) continue; // 117_b: granted (ADD_BOND test)
    const g = GR(gid);
    const sc = scenario(gid);
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4, bonds: sc.unitBonds }], bonds: sc.bonds, enemies: [{ key: 'e_dummy', pos: [9, 9] }] });
    const e = h.enemies()[0];
    const per = num(g.bb.bond_add_count), every = Math.max(1, num(g.bb.check_cnt, 1));
    for (let k = 1; k <= 12; k++) {
      h.b.emit('kill', { killer: h.unit('op'), victim: e });
      expectAll(h, sc.targets, Math.min(Math.floor(k / every) * per, capOf(gid)), `${gid} after ${k} kills`);
    }
    cover(gid);
  }
  const run = (gid, kills, bonds, victim = 'enemy') => {
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }, { id: 'ally', row: 11, col: 4 }], bonds, enemies: [{ key: 'e_dummy', pos: [9, 9] }] });
    for (let i = 0; i < kills; i++) h.b.emit('kill', { killer: h.unit('op'), victim: victim === 'ally' ? h.unit('ally') : h.enemies()[0] });
    return gains(h);
  };
  assert.deepEqual(run('garrison_38_a', 5, { egirShip: B(0), steadShip: B(0), raidShip: B(0) }), { egirShip: 2, steadShip: 2, raidShip: 2 }, '斯卡蒂: every 2 kills +1');
  assert.deepEqual(run('garrison_38_b', 4, { egirShip: B(0), steadShip: B(0), raidShip: B(0) }), { egirShip: 4, steadShip: 4, raidShip: 4 });
  assert.deepEqual(run('garrison_50_a', 5, { victoriaShip: B(0), visiShip: B(0), indomShip: B(0) }), { victoriaShip: 6, visiShip: 6, indomShip: 6 }, '风笛: first 3 kills');
  assert.deepEqual(run('garrison_50_b', 5, { victoriaShip: B(0), visiShip: B(0), indomShip: B(0) }), { victoriaShip: 12, visiShip: 12, indomShip: 12 });
  assert.deepEqual(run('garrison_152_a', 5, { siracusaShip: B(0) }), { siracusaShip: 6 }, '伺夜 叙拉古 +2 × 3');
  assert.deepEqual(run('garrison_153_b', 5, { miraShip: B(0) }), { miraShip: 6 }, '伺夜 精锐 奇迹 +2 × 3');
  assert.deepEqual(run('garrison_131_a', 1, { egirShip: B(0), arcaneShip: B(0) }, 'ally'), { egirShip: 3, arcaneShip: 3 }, '海霓: an ally victim counts');
  assert.deepEqual(run('garrison_138_a', 1, { preciShip: B(0), lateranoShip: B(0) }, 'ally'), {}, '送葬人: allies do not count');
  assert.deepEqual(run('garrison_138_b', 3, { preciShip: B(0), lateranoShip: B(0) }), { preciShip: 6, lateranoShip: 6 }, 'first kill only');
  assert.deepEqual(run('garrison_118_a', 60, { siracusaShip: B(0) }), { siracusaShip: 100 }, '荒芜拉普兰德: +2 per kill, cap 100');
});

test('selfdead (幽灵鲨 46 / 砾 75 / 归溟幽灵鲨 40): per knock-out; 归溟幽灵鲨 also on every substitute ⇄ body swap', () => {
  for (const gid of idsOfKey('act1autochess_gar_event_selfdead')) {
    const sc = scenario(gid);
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4, bonds: sc.unitBonds }], bonds: sc.bonds });
    h.b.dealDamage(null, h.unit('op'), { amount: 1e9, type: 'true' });
    h.step(1);
    expectAll(h, sc.targets, num(GR(gid).bb.bond_add_count), gid);
    cover(gid);
  }
  const ko = (gid, bonds) => {
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }], bonds });
    const u = h.unit('op');
    h.b.retreat(u, { reason: 'test' });
    assert.deepEqual(gains(h), {}, `${gid}: a retreat is not a knock-out`);
    h.b.redeploy(u, { free: true });
    h.step(1);
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    h.step(1);
    return gains(h);
  };
  assert.deepEqual(ko('garrison_46_a', { egirShip: B(0) }), { egirShip: 3 });
  assert.deepEqual(ko('garrison_46_b', { egirShip: B(0) }), { egirShip: 6 });
  assert.deepEqual(ko('garrison_75_a', { indomShip: B(0), kazimierzShip: B(0) }), { indomShip: 2 }, '砾 75: 不屈 only (卡西米尔 is garrison_143)');
  assert.deepEqual(ko('garrison_75_b', { indomShip: B(0) }), { indomShip: 4 });

  const h = battle({ units: [{ id: 'ghost', g: ['garrison_40_b'], row: 11, col: 4, o: { profession: 'SPECIAL', subProfessionId: 'dollkeeper' } }], bonds: { egirShip: B(0), indomShip: B(0) } });
  const g = h.unit('ghost');
  h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
  h.step(1);
  assert.ok(g.alive && g.trait.doll, 'substitute');
  assert.deepEqual(gains(h), { egirShip: 10, indomShip: 10 }, 'body → substitute');
  h.run(21);
  assert.ok(g.alive && !g.trait.doll, 'swapped back');
  assert.deepEqual(gains(h), { egirShip: 20, indomShip: 20 }, 'substitute → body');
  checkInvariants(h.b);
});

test('consume_ammo (莫斯提马 22 x-5 / 圣约送葬人 23+55 / 蕾缪安 24 row of 3): per consume_count ammo, per-id caps', () => {
  for (const gid of idsOfKey('act1autochess_gar_event_consume_ammo')) {
    const g = GR(gid);
    const sc = scenario(gid);
    const x5 = g.bbStr.range_id === 'x-5';
    const units = [{ id: 'op', g: [gid], row: 10, col: 5, bonds: sc.unitBonds }, { id: 'nb', row: 11, col: 5 }, { id: 'far', row: 12, col: 8 }];
    if (g.bbStr.conditionkey === 'character_same_row') units.push({ id: 'r1', row: 10, col: 7 }, { id: 'r2', row: 10, col: 9 });
    const h = battle({ units, bonds: sc.bonds });
    const shooter = h.unit(x5 ? 'nb' : 'op');
    const every = num(g.bb.consume_count, 1), per = num(g.bb.bond_add_count);
    for (let i = 0; i < every * 3; i++) h.b.emit('ammoUsed', { unit: h.unit('far') });
    expectAll(h, sc.targets, 0, `${gid}: ammo of an operator out of scope`);
    for (let k = 1; k <= 12; k++) {
      for (let i = 0; i < every; i++) h.b.emit('ammoUsed', { unit: shooter, left: 0 });
      expectAll(h, sc.targets, Math.min(k * per, capOf(gid)), `${gid} × ${k}`);
    }
    cover(gid);
  }
  const exe = (gids) => {
    const h = battle({ units: [{ id: 'exe', g: gids, row: 10, col: 4 }], bonds: { lateranoShip: B(0), visiShip: B(0) } });
    const u = h.unit('exe');
    const out = [];
    for (const n of [7, 70]) { for (let i = 0; i < n; i++) h.b.emit('ammoUsed', { unit: u, left: 0 }); out.push({ ...gains(h) }); }
    return out;
  };
  assert.deepEqual(exe(['garrison_23_a', 'garrison_55_a']), [{ lateranoShip: 7, visiShip: 3 }, { lateranoShip: 49, visiShip: 21 }], '圣约送葬人: 7 triggers max');
  assert.deepEqual(exe(['garrison_23_b', 'garrison_55_b']), [{ lateranoShip: 14, visiShip: 6 }, { lateranoShip: 98, visiShip: 42 }]);
  const rem = (gid, n) => {
    const h = battle({ units: [{ id: 'rem', g: [gid], row: 10, col: 3 }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `m${i}`, row: 10, col: 5 + i * 2 }))], bonds: { lateranoShip: B(0), preciShip: B(0) } });
    for (let i = 0; i < 10; i++) h.b.emit('ammoUsed', { unit: h.unit('rem') });
    return gains(h);
  };
  assert.deepEqual(rem('garrison_24_a', 2), {}, '蕾缪安: 2 in the row');
  assert.deepEqual(rem('garrison_24_a', 3), { lateranoShip: 2, preciShip: 2 });
  assert.deepEqual(rem('garrison_24_b', 3), { lateranoShip: 4, preciShip: 4 });
  const most = (gid) => {
    const h = battle({ units: [{ id: 'most', g: [gid], row: 10, col: 5 }, { id: 'nb', row: 10, col: 6 }, { id: 'nb2', row: 9, col: 5 }], bonds: { lateranoShip: B(0) } });
    for (let i = 0; i < 3; i++) h.b.emit('ammoUsed', { unit: h.unit('nb') });
    for (let i = 0; i < 3; i++) h.b.emit('ammoUsed', { unit: h.unit('nb2') });
    return gains(h);
  };
  assert.deepEqual(most('garrison_22_a'), { lateranoShip: 1 }, '莫斯提马: ammo of the 4 neighbours is pooled');
  assert.deepEqual(most('garrison_22_b'), { lateranoShip: 2 });
});

test('enemy_abflag_inrange (初雪 / 银灰 28): entering 冻结 in range × prob; a refreshed freeze is not a new entry', () => {
  for (const gid of idsOfKey('act1autochess_gar_event_enemy_abflag_inrange')) {
    if (!D.garrisons[gid].owners.some((o) => D.chess[o].visible)) continue; // 29: granted by 凛御银灰 (ADD_BOND test)
    const h = battle({ units: [{ id: 'sa', g: [gid], row: 10, col: 4 }], bonds: { kjeragShip: B(0) }, enemies: [{ key: 'e_dummy', pos: [10, 5] }, { key: 'e_dummy', pos: [12, 9] }] });
    alwaysHit(h);
    const near = h.enemies().find((e) => Math.round(e.y) === 10), far = h.enemies().find((e) => Math.round(e.y) === 12);
    h.b.applyStatus(far, 'freeze', { duration: 1 });
    assert.deepEqual(gains(h), {}, `${gid}: out of range`);
    h.b.applyStatus(near, 'freeze', { duration: 1 });
    const per = num(GR(gid).bb.bond_add_count);
    assert.deepEqual(gains(h), { kjeragShip: per }, gid);
    h.b.applyStatus(near, 'freeze', { duration: 2 });
    assert.deepEqual(gains(h), { kjeragShip: per }, `${gid}: already frozen`);
    h.b.removeStatus(near, 'freeze');
    h.b.applyStatus(near, 'freeze', { duration: 1 });
    assert.deepEqual(gains(h), { kjeragShip: 2 * per }, `${gid}: frozen again`);
    cover(gid);
  }
  // probability (deterministic battle rng): ≈ 50 % of 40 entries × 2
  const h = battle({ units: [{ id: 'sa', g: ['garrison_28_b'], row: 10, col: 4 }], bonds: { kjeragShip: B(0) }, enemies: [{ key: 'e_dummy', pos: [10, 5] }], seed: 11 });
  const e = h.enemies()[0];
  for (let i = 0; i < 40; i++) { h.b.removeStatus(e, 'freeze'); h.b.applyStatus(e, 'freeze', { duration: 1 }); }
  const g = gains(h).kjeragShip;
  assert.ok(g > 10 && g < 70 && g % 2 === 0, `≈ 50 % of 40 × 2, got ${g}`);
  // cold → cold ⇒ freeze counts as an entry
  const c = battle({ units: [{ id: 'sa', g: ['garrison_28_a'], row: 10, col: 4 }], bonds: { kjeragShip: B(0) }, enemies: [{ key: 'e_dummy', pos: [10, 5] }] });
  alwaysHit(c);
  c.b.applyStatus(c.enemies()[0], 'cold', { duration: 5 });
  c.b.applyStatus(c.enemies()[0], 'cold', { duration: 5 });
  assert.deepEqual(gains(c), { kjeragShip: 1 });
  checkInvariants(c.b);
});

test('onstart (砾 143 / 瑕光 106 / 史尔特尔 107 / 锏 155): every deploy, per-id caps', () => {
  for (const gid of idsOfKey('act2autochess_gar_event_onstart')) {
    if (!D.garrisons[gid].owners.some((o) => D.chess[o].visible)) continue; // 108: granted by 远牙 (ADD_BOND test)
    const sc = scenario(gid);
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4, bonds: sc.unitBonds }], bonds: sc.bonds });
    const per = num(GR(gid).bb.bond_add_count);
    expectAll(h, sc.targets, Math.min(per, capOf(gid)), `${gid} first deploy`);
    const u = h.unit('op');
    for (let k = 2; k <= 9; k++) {
      h.b.retreat(u, { reason: 'test' });
      h.b.redeploy(u, { free: true });
      h.step(1);
      expectAll(h, sc.targets, Math.min(k * per, capOf(gid)), `${gid} deploy ${k}`);
    }
    cover(gid);
  }
  const deploys = (gid, n, bonds, unitBonds = []) => {
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4, bonds: unitBonds }], bonds });
    const u = h.unit('op');
    for (let i = 1; i < n; i++) { h.b.retreat(u, { reason: 'test' }); h.b.redeploy(u, { free: true }); h.step(1); }
    return gains(h);
  };
  assert.deepEqual(deploys('garrison_143_a', 3, { kazimierzShip: B(0) }), { kazimierzShip: 3 });
  assert.deepEqual(deploys('garrison_143_b', 3, { kazimierzShip: B(0) }), { kazimierzShip: 6 });
  assert.deepEqual(deploys('garrison_107_a', 9, { raidShip: B(0) }), { raidShip: 50 }, '史尔特尔 8 × 7 capped at 50');
  assert.deepEqual(deploys('garrison_107_b', 9, { raidShip: B(0) }), { raidShip: 100 });
  const self = { yanShip: B(0), kjeragShip: B(0, false) };
  assert.deepEqual(deploys('garrison_106_a', 5, self, ['yanShip', 'kjeragShip']), { yanShip: 12 }, '瑕光: own active bonds, cap 12');
  assert.deepEqual(deploys('garrison_155_b', 5, self, ['yanShip', 'kjeragShip']), { yanShip: 48 }, '锏 精锐: +16, cap 48');
});

test('allyenemy_sleepstun_inrange (缇缇 125): enemies or operators entering 沉睡 / 晕眩 in range; cap 24 / 48', () => {
  for (const gid of idsOfKey('act2autochess_gar_event_allyenemy_sleepstun_inrange')) {
    const per = num(GR(gid).bb.bond_add_count);
    const h = battle({ units: [{ id: 'tt', g: [gid], row: 10, col: 4 }, { id: 'ally', row: 10, col: 5 }], bonds: { sargonShip: B(0), preciShip: B(0) }, enemies: [{ key: 'e_dummy', pos: [12, 9] }, { key: 'e_dummy', pos: [10, 5] }] });
    const far = h.enemies().find((e) => Math.round(e.y) === 12), near = h.enemies().find((e) => Math.round(e.y) === 10);
    h.b.applyStatus(h.unit('ally'), 'sleep', { duration: 1 });
    expectAll(h, ['sargonShip', 'preciShip'], per, `${gid}: an operator in range fell asleep`);
    h.b.applyStatus(far, 'stun', { duration: 1 });
    expectAll(h, ['sargonShip', 'preciShip'], per, `${gid}: enemy out of range`);
    h.b.applyStatus(near, 'stun', { duration: 5 });
    h.b.applyStatus(near, 'stun', { duration: 5 });
    expectAll(h, ['sargonShip', 'preciShip'], 2 * per, `${gid}: a stun refresh is not a new entry`);
    for (let i = 0; i < 40; i++) { h.b.removeStatus(near, 'stun'); h.b.applyStatus(near, 'stun', { duration: 1 }); }
    expectAll(h, ['sargonShip', 'preciShip'], capOf(gid), `${gid}: cap`);
    cover(gid);
  }
  assert.equal(capOf('garrison_125_a'), 24);
  assert.equal(capOf('garrison_125_b'), 48);
});

test('缇缇 125 + S2 封护 (GitHub #162): every 0.25 s sleep pulse of the ward is a new entry — 8 s climb to the cap; a sleeper outside her range does not count', () => {
  // the reporter's memory of the official mode: 「攻击范围内有陷入沉睡就开始迅速增加直至上限」; the pulse timing is [ASSUMED]
  for (const id of ['chess_char_5_02_a', 'chess_char_5_02_b']) {
    const gid = D.chess[id].garrisonIds.find((g) => GR(g).effectKey === 'act2autochess_gar_event_allyenemy_sleepstun_inrange');
    const per = num(GR(gid).bb.bond_add_count), cap = capOf(gid);
    const s2 = D.chess[id].skills.find((x) => x.skillId === 'skchr_titi_2').index;
    // 缇缇 (10,4) facing right: range 3-3 = rows 9–11, cols 4–7. The ward ally (10,6) is the only operator in it; the
    // enemy (10,5) stands beside both wards (in her range), the one at (10,3) beside her back (out of her range)
    const run = (enemies) => {
      const h = makeBattle({
        seed: 3, autoFinish: false, timeLimit: 400, hooks: ['statusApplied'],
        defs: { chess: { ward: rec('ward', []) }, enemies: { e_dummy: dummy() } },
        units: [{ chessId: id, skillIndex: s2, row: 10, col: 4 }, { chessId: 'ward', row: 10, col: 6 }],
        bonds: { sargonShip: B(0), preciShip: B(0) }, enemies,
      });
      h.step(1);
      const tt = h.unit(id);
      tt.skill.gainSp(1000);
      assert.ok(tt.skill.activate('test'), `${id}: S2 cast`);
      assert.equal(tt.skill.id, 'skchr_titi_2');
      return { h, tt };
    };
    // out of range only: the pulses sleep it (each one an entry for the engine) but her trait ignores it
    {
      const { h, tt } = run([{ key: 'e_dummy', pos: [10, 3] }]);
      const back = h.enemies()[0];
      expectAll(h, ['sargonShip', 'preciShip'], 2 * per, `${id}: the ward's two operators fall asleep in her range`);
      h.run(8);
      assert.ok(tt.skill.active && back.s.flags.sleep, `${id}: the enemy at her back sleeps`);
      const pulses = h.hooksOf('statusApplied').filter((c) => c.target === back && c.source === tt && c.entered);
      assert.ok(pulses.length >= 30, `${id}: ${pulses.length} pulse entries in 8 s`);
      expectAll(h, ['sargonShip', 'preciShip'], 2 * per, `${id}: an out-of-range sleeper does not count`);
      checkInvariants(h.b);
    }
    // in range: one entry per pulse (beside both wards: still one), the cap within the 8 s
    {
      const { h, tt } = run([{ key: 'e_dummy', pos: [10, 5] }, { key: 'e_dummy', pos: [10, 3] }]);
      const near = h.enemies().find((e) => Math.round(e.x) === 5);
      let capAt = null;
      for (let t = 0; t < 8 - 1e-9; t += 0.25) {
        h.run(0.25);
        if (capAt == null && (gains(h).sargonShip ?? 0) >= cap) capAt = t + 0.25;
      }
      assert.ok(tt.skill.active && near.s.flags.sleep, `${id}: still asleep after 8 s`);
      const mine = h.hooksOf('statusApplied').filter((c) => c.target === near && c.source === tt && c.status === 'sleep');
      assert.equal(mine.filter((c) => c.entered).length * 2, mine.length, `${id}: two wards, one entry per pulse`);
      expectAll(h, ['sargonShip', 'preciShip'], cap, `${id}: the cap (${cap})`);
      assert.ok(capAt != null && capAt <= 6.5, `${id}: capped after ${capAt} s`);
      checkInvariants(h.b);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// ADD_BOND grants

// PRTS 卫戍协议：盟约 下半, 3月27日更新#2: 「[Ⅳ阶]华法琳：赋予的特质的叠层上限从 初始12/精锐24 降低至 初始7/精锐14」 — the
// data's 7 / 14 (GitHub #175; from PR #192 by @kukiC)
test('ADD_BOND 华法琳 72: the front operator gets garrison_95 (own active bonds +1 / +2), capped at the data\'s 7 / 14 (GitHub #175)', () => {
  for (const [gid, per, cap] of [['garrison_72_a', 1, 7], ['garrison_72_b', 2, 14]]) {
    const give = GR(gid).bbStr.give_garrison_id;
    const h = battle({
      units: [{ id: 'warfarin', g: [gid], row: 10, col: 4 }, { id: 'front', row: 10, col: 5, bonds: ['yanShip', 'kjeragShip', 'egirShip'] }, { id: 'side', row: 11, col: 4, bonds: ['yanShip'] }],
      bonds: { yanShip: B(0), kjeragShip: B(0), egirShip: B(0, false) },
    });
    const f = h.unit('front');
    assert.equal(num(GR(give).bb.bond_add_count), per);
    skill(h, f);
    assert.deepEqual(gains(h), { yanShip: per, kjeragShip: per });
    assert.equal(num(GR(give).bb.max_add_count_per_battle), cap, `${give}: the data cap`);
    for (let i = 1; i < 7; i++) skill(h, f);
    assert.deepEqual(gains(h), { yanShip: cap, kjeragShip: cap }, `${gid}: the seventh activation reaches the cap`);
    skill(h, f);
    assert.deepEqual(gains(h), { yanShip: cap, kjeragShip: cap }, `${gid}: the eighth adds no layers`);
    for (let i = 0; i < 30; i++) skill(h, f);
    assert.deepEqual(gains(h), { yanShip: cap, kjeragShip: cap }, `${gid}: later activations stay capped`);
    skill(h, h.unit('warfarin'));
    skill(h, h.unit('side'));
    assert.equal(gains(h).yanShip, cap, '华法琳 herself / other operators do not carry the trait');
    assert.ok(h.eventsOf('fx').some((e) => e[1] === 'garrisonGrant' && e[4].id === f.id && e[4].key === give), 'grant fx');
    checkInvariants(h.b);
    cover(gid); cover(give);
  }
});

test('ADD_BOND 寒芒克洛丝 73 (front → 精准 +1 / +2, cap 10 / 20) and 凛御银灰 126 (front 【谢拉格】 → 60 % freeze trait)', () => {
  for (const [gid, per, cap] of [['garrison_73_a', 1, 10], ['garrison_73_b', 2, 20]]) {
    const give = GR(gid).bbStr.give_garrison_id;
    const h = battle({ units: [{ id: 'cross', g: [gid], row: 10, col: 4 }, { id: 'front', row: 10, col: 5 }], bonds: { preciShip: B(0) } });
    skill(h, h.unit('front'));
    assert.deepEqual(gains(h), { preciShip: per });
    for (let i = 0; i < 30; i++) skill(h, h.unit('front'));
    assert.deepEqual(gains(h), { preciShip: cap }, gid);
    cover(gid); cover(give);
  }
  for (const [gid, per] of [['garrison_126_a', 1], ['garrison_126_b', 2]]) {
    const give = GR(gid).bbStr.give_garrison_id;
    assert.equal(num(GR(give).bb.prob), 0.6);
    const h = battle({
      units: [{ id: 'svash', g: [gid], row: 10, col: 4 }, { id: 'kj', row: 10, col: 5, bonds: ['kjeragShip'] }],
      bonds: { kjeragShip: B(0) }, enemies: [{ key: 'e_dummy', pos: [10, 6] }],
    });
    alwaysHit(h);
    assert.deepEqual(h.eventsOf('fx').filter((e) => e[1] === 'garrisonGrant').map((e) => e[4].key), [give]);
    h.b.applyStatus(h.enemies()[0], 'freeze', { duration: 1 });
    assert.deepEqual(gains(h), { kjeragShip: per }, `${gid}: the granted trait fires (enemy in the front operator's range)`);
    const other = battle({ units: [{ id: 'svash', g: [gid], row: 10, col: 4 }, { id: 'o', row: 10, col: 5, bonds: ['yanShip'] }], bonds: { kjeragShip: B(0) } });
    assert.equal(other.eventsOf('fx').filter((e) => e[1] === 'garrisonGrant').length, 0, 'not a 【谢拉格】 operator');
    cover(gid); cover(give);
  }
});

test('ADD_BOND 荒芜拉普兰德 118_b: every 【叙拉古】 operator (herself included) gets "击倒敌人时 叙拉古 +2" (garrison_117_b)', () => {
  const give = GR('garrison_118_b').bbStr.give_garrison_id;
  const h = battle({
    units: [{ id: 'lap', g: ['garrison_118_b'], row: 10, col: 4, bonds: ['siracusaShip'] }, { id: 'sira', row: 11, col: 6, bonds: ['siracusaShip'] }, { id: 'other', row: 12, col: 6 }],
    bonds: { siracusaShip: B(0) }, enemies: [{ key: 'e_dummy', pos: [9, 9] }],
  });
  const e = h.enemies()[0];
  for (const id of ['lap', 'sira', 'other']) h.b.emit('kill', { killer: h.unit(id), victim: e });
  assert.deepEqual(gains(h), { siracusaShip: 4 });
  assert.equal(capOf(give), 200);
  cover('garrison_118_b'); cover(give);
});

test('ADD_BOND 远牙 148: the rightmost operator of the row gets "<部署时>卡西米尔/精准 +4 / +8 (cap 24 / 48)"', () => {
  for (const [gid, per, cap] of [['garrison_148_a', 4, 24], ['garrison_148_b', 8, 48]]) {
    const give = GR(gid).bbStr.give_garrison_id;
    const h = battle({
      units: [{ id: 'fang', g: [gid], row: 10, col: 3 }, { id: 'mid', row: 10, col: 5 }, { id: 'right', row: 10, col: 8 }, { id: 'other', row: 11, col: 9 }],
      bonds: { kazimierzShip: B(0), preciShip: B(0) },
    });
    assert.deepEqual(gains(h), { kazimierzShip: per, preciShip: per }, 'initial deployment of the rightmost operator');
    const r = h.unit('right');
    for (let i = 0; i < 8; i++) { h.b.retreat(r, { reason: 'test' }); h.b.redeploy(r, { free: true }); h.step(1); }
    assert.deepEqual(gains(h), { kazimierzShip: cap, preciShip: cap });
    const alone = battle({ units: [{ id: 'fang', g: [gid], row: 10, col: 8 }, { id: 'left', row: 10, col: 4 }], bonds: { kazimierzShip: B(0), preciShip: B(0) } });
    assert.deepEqual(gains(alone), { kazimierzShip: per, preciShip: per }, '远牙 herself when she is the rightmost');
    checkInvariants(h.b);
    cover(gid); cover(give);
  }
});

test('ADD_BOND 耀骑士临光 145 / 160 (real chess): self + front get 144 (redeploy) and 159 (ASPD) once each', () => {
  for (const [id, as, rd] of [['chess_char_6_17_a', 0.5, -0.015], ['chess_char_6_17_b', 1, -0.03]]) {
    const sfx = id.slice(-1);
    const h = makeBattle({
      defs: { chess: { front: rec('front', []) } },
      units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'front', row: 10, col: 5 }],
      bonds: { kazimierzShip: B(9) }, autoFinish: false,
    });
    h.step(1);
    const f = h.unit('front'), n = h.unit(id);
    for (const u of [f, n]) {
      approx(u.findBuff(`gar:garrison_159_${sfx}`).mods.aspd, 3 * as, '9 layers / 3 × ASPD');
      approx(u.findBuff(`gar:garrison_144_${sfx}`).mods.redeployMul, 1 + 3 * rd, 'redeploy');
      assert.equal(u.buffs.filter((b) => b.key === `gar:garrison_159_${sfx}`).length, 1);
    }
    assert.ok(!f.findBuff(`gar:garrison_144_${sfx}`).mods.aspd, 'ASPD comes from 159 only (no double count)');
    checkInvariants(h.b);
    for (const g of D.chess[id].garrisonIds) cover(g);
  }
});

test('respawnTimeByBond 144 has no 5% floor (#370): redeployMul is max(0, 1 + respawn_time * steps)', () => {
  for (const [gid, rt] of [['garrison_144_a', -0.015], ['garrison_144_b', -0.03]]) {
    assert.equal(GR(gid).bb.respawn_time, rt);
    assert.deepEqual(Object.keys(GR(gid).bb).sort(), ['divide_num', 'respawn_time']);
    // 96 / 192 layers: the old 0.05 floor bound the elite / the normal form (raw 0.04); 300: below zero
    for (const layers of [9, 96, 192, 300]) {
      const k = Math.floor(layers / 3);
      const want = Math.max(0, 1 + rt * k);
      const h = battle({
        units: [{ id: 'op', g: [gid], row: 10, col: 4, o: { stats: { respawnTime: 100 } } }],
        bonds: { kazimierzShip: B(layers) },
      });
      const u = h.unit('op');
      approx(u.findBuff(`gar:${gid}`).mods.redeployMul, want, `${gid} @ ${layers}`);
      h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
      assert.equal(u.alive, false);
      approx(u.respawnAt - u.deathAt, 100 * want, `${gid} timer @ ${layers}`);
      if (want === 0) {
        h.step(2);
        assert.ok(u.alive && u.deployed, `${gid} @ ${layers}: a 0 s timer brings it straight back`);
        assert.equal(h.b.errorCount, 0);
      }
    }
    cover(gid);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 魔王

test('魔王 59: +1 / +2 on trait gains of the operator in front (not counted toward its cap); not on other reasons', () => {
  for (const [gid, extra] of [['garrison_59_a', 1], ['garrison_59_b', 2]]) {
    assert.equal(num(GR(gid).bb.extra_cnt), extra);
    const h = battle({
      units: [{ id: 'mw', g: [gid], row: 10, col: 4 }, { id: 'front', g: ['garrison_42_a'], row: 10, col: 5 }, { id: 'side', g: ['garrison_43_a'], row: 11, col: 4 }],
      bonds: { sargonShip: B(0) },
    });
    skill(h, h.unit('front'));
    skill(h, h.unit('front'));
    assert.equal(gains(h).sargonShip, 5 + extra, 'first skill only (cap 5 not eaten by the extra)');
    skill(h, h.unit('side'));
    assert.equal(gains(h).sargonShip, 11 + extra, 'side operator: no extra');
    h.b.addLayers('p1', 'sargonShip', 3, 'bond', { source: h.unit('front') });
    assert.equal(gains(h).sargonShip, 14 + extra, 'non-garrison gain: no extra');
    cover(gid);
  }
});

test('regression: 魔王 also boosts the "被击倒时" gain of the operator that was knocked out in front of it', () => {
  const h = battle({ units: [{ id: 'mw', g: ['garrison_59_a'], row: 10, col: 4 }, { id: 'ghost', g: ['garrison_46_a'], row: 10, col: 5 }], bonds: { egirShip: B(0) } });
  h.b.dealDamage(null, h.unit('ghost'), { amount: 1e9, type: 'true' });
  h.step(1);
  assert.deepEqual(gains(h), { egirShip: 3 + 1 });
  const far = battle({ units: [{ id: 'mw', g: ['garrison_59_a'], row: 10, col: 4 }, { id: 'ghost', g: ['garrison_46_a'], row: 11, col: 5 }], bonds: { egirShip: B(0) } });
  far.b.dealDamage(null, far.unit('ghost'), { amount: 1e9, type: 'true' });
  far.step(1);
  assert.deepEqual(gains(far), { egirShip: 3 });
});

test('no IN_BATTLE gains in 联防 / boss fields', () => {
  for (const kind of ['unite', 'boss']) {
    const h = battle({ kind, units: [{ id: 'surt', g: ['garrison_107_a', 'garrison_43_a'], row: 10, col: 4 }], bonds: { raidShip: B(0), sargonShip: B(0) } });
    skill(h, h.unit('surt'));
    assert.deepEqual(gains(h), {}, kind);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// stat traits

test('GAIN_BUFF (哈洛德 / 锡人 / 迷迭香 03, 流星 137) and 古米 08: direct multipliers / SP regen from the blackboard', () => {
  for (const gid of [...idsOfKey('GAIN_BUFF'), ...idsOfKey('attr_common_global_buff')]) {
    const bb = GR(gid).bb;
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }] });
    const u = h.unit('op');
    if (GR(gid).effectKey === 'GAIN_BUFF') {
      approx(u.s.atk, 500 * bb.atk, `${gid} ATK`);
      approx(u.s.maxHp, 2000 * bb.max_hp, `${gid} HP`);
    } else {
      approx(u.s.spRecovery, 1 + bb.sp_recovery_per_sec, `${gid} SP`);
    }
    cover(gid);
  }
  const stat = (gid) => { const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }] }); return h.unit('op').s; };
  assert.equal(Math.round(stat('garrison_03_a').atk), 600);
  assert.equal(Math.round(stat('garrison_03_b').maxHp), 2800);
  assert.equal(Math.round(stat('garrison_137_a').atk), 625);
  assert.equal(Math.round(stat('garrison_137_b').maxHp), 3000);
  approx(stat('garrison_08_a').spRecovery, 1.15);
  approx(stat('garrison_08_b').spRecovery, 1.3);
});

test('attrByBond (26 ids): floor(Σ layers of the listed ACTIVE bonds / divide_num) × per-step values; live recompute', () => {
  for (const gid of idsOfKey('act1autochess_gar_eff_attrByBond')) {
    const { bb, bbStr } = GR(gid);
    const list = ids(bbStr.bond_id);
    const div = num(bb.divide_num, 1);
    const L = 2 * div + 1;
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }], bonds: Object.fromEntries(list.map((b) => [b, B(L)])) });
    const k = Math.floor((L * list.length) / div);
    const m = h.unit('op').findBuff(`gar:${gid}`).mods;
    const want = {};
    // "每叠加N层…+X%" is 直接乘算: the additive percentage bucket (support directMods)
    if (bb.atk) want.atkPct = bb.atk * k;
    if (bb.max_hp) want.hpPct = bb.max_hp * k;
    if (bb.def) want.defPct = bb.def * k;
    if (bb.attack_speed) want.aspd = bb.attack_speed * k;
    if (bb.hp_recovery_per_sec) want.hpRegen = bb.hp_recovery_per_sec * k;
    if (bb.sp_recovery_per_sec) want.spRecoveryFlat = bb.sp_recovery_per_sec * k;
    assert.deepEqual(Object.keys(m).sort(), Object.keys(want).sort(), gid);
    for (const [key, v] of Object.entries(want)) approx(m[key], v, `${gid} ${key}`);
    cover(gid);
  }
  const h = battle({
    units: [{ id: 'mz', g: ['garrison_07_a'], row: 9, col: 4 }, { id: 'ur', g: ['garrison_12_b'], row: 9, col: 6 }, { id: 'rs', g: ['garrison_09_b'], row: 12, col: 6 },
      { id: 'yx', g: ['garrison_16_a'], row: 11, col: 4 }, { id: 'yx2', g: ['garrison_16_b'], row: 11, col: 6 }, { id: 'sk', g: ['garrison_84_b'], row: 10, col: 4 }],
    bonds: { egirShip: B(25), yanShip: B(6), kjeragShip: B(30, false), lateranoShip: B(10) },
  });
  approx(h.unit('mz').s.atk, 500 * 1.08, '水月: 25 / 3 = 8 × 1 %');
  approx(h.unit('ur').s.atk, 500 * 1.24, '乌尔比安 精锐: 25 / 2 = 12 × 2 %');
  approx(h.unit('rs').s.atk, 500 * (1 + 0.02 * 13), '迷迭香 精锐 core bonds: (25 + 6 + 10) / 3 = 13 × 2 %, inactive 谢拉格 ignored');
  assert.equal(h.unit('yx').findBuff('gar:garrison_16_a').mods.aspd, 2, '隐现: 10 / 5 × 1');
  assert.equal(h.unit('yx2').findBuff('gar:garrison_16_b').mods.aspd, 4);
  assert.deepEqual(h.unit('sk').findBuff('gar:garrison_84_b').mods, { hpRegen: 200, spRecoveryFlat: 0.6 }, '浊心斯卡蒂: 2 steps × (100 HP/s, 0.3 SP/s)');
  h.b.addLayers('p1', 'egirShip', 2, 'test');
  h.step(2);
  approx(h.unit('mz').s.atk, 500 * 1.09, 'recomputed after a layer gain');
  checkInvariants(h.b);
});

test('respawnTimeByBond 144, attrByBond_add_onstart 115 (玛恩纳, 100 s after each deploy), ab_damageScaleByBond 101 (仇白)', () => {
  for (const gid of idsOfKey('act1autochess_gar_eff_respawnTimeByBond')) {
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }], bonds: { kazimierzShip: B(10) } });
    approx(h.unit('op').findBuff(`gar:${gid}`).mods.redeployMul, 1 + 3 * GR(gid).bb.respawn_time, gid);
    cover(gid);
  }
  for (const gid of idsOfKey('act2autochess_gar_eff_attrByBond_add_onstart')) {
    const bb = GR(gid).bb;
    const h = battle({ units: [{ id: 'mn', g: [gid], row: 9, col: 4 }], bonds: { kazimierzShip: B(12) } });
    const mn = h.unit('mn');
    assert.deepEqual(mn.findBuff(`gar:${gid}`).mods, { atkFlat: 2 * bb.atk, hpFlat: 2 * bb.max_hp }, `${gid}: 12 / 5 = 2 steps`);
    h.b.addLayers('p1', 'kazimierzShip', 3, 'test');
    h.step(2);
    assert.deepEqual(mn.findBuff(`gar:${gid}`).mods, { atkFlat: 3 * bb.atk, hpFlat: 3 * bb.max_hp }, 'live');
    const atk = mn.s.atk;
    h.run(bb.duration + 1);
    assert.equal(mn.findBuff(`gar:${gid}`), null, `expired after ${bb.duration} s`);
    assert.ok(mn.s.atk < atk);
    h.b.retreat(mn, { reason: 'test' });
    h.b.redeploy(mn, { free: true });
    h.step(1);
    assert.ok(mn.findBuff(`gar:${gid}`), 'again after a redeploy');
    cover(gid);
  }
  const mn = battle({ units: [{ id: 'mn', g: ['garrison_115_a'], row: 9, col: 4 }], bonds: { kazimierzShip: B(10) } }).unit('mn');
  assert.deepEqual(mn.findBuff('gar:garrison_115_a').mods, { atkFlat: 20, hpFlat: 100 });
  approx(mn.s.atk, 520, '基础攻击力 +20');

  for (const [gid, per] of [['garrison_101_a', 0.01], ['garrison_101_b', 0.02]]) {
    const h = battle({ units: [{ id: 'qb', g: [gid], row: 12, col: 4 }], enemies: [{ key: 'e_dummy', pos: [12, 9] }], bonds: { yanShip: B(6), raidShip: B(3) } });
    const t = h.enemies()[0];
    const lost = () => { const hp = t.hp; h.b.dealDamage(h.unit('qb'), t, { amount: 1000, type: 'true' }); return Math.round(hp - t.hp); };
    assert.equal(lost(), 1000);
    h.b.applyStatus(t, 'bind', { duration: 5 });
    assert.equal(lost(), Math.round(1000 * (1 + 3 * per)), `${gid}: (6 + 3) / 3 × ${per}`);
    h.b.removeStatus(t, 'bind');
    h.b.applyStatus(t, 'sluggish', { duration: 5 });
    assert.equal(lost(), Math.round(1000 * (1 + 3 * per)));
    cover(gid);
  }
});

test('attack_enemy (深巡 18 海怪, 跃跃 19 无人机): ATK ×1.5 / ×2 against tagged enemies only', () => {
  for (const gid of idsOfKey('act1autochess_gar_eff_attack_enemy')) {
    const { bb, bbStr } = GR(gid);
    const h = battle({
      units: [{ id: 'op', g: [gid], row: 10, col: 4 }],
      edefs: { e_tag: dummy({ key: 'e_tag', tags: [bbStr.check_tag] }) },
      enemies: [{ key: 'e_tag', pos: [9, 9] }, { key: 'e_dummy', pos: [12, 9] }],
    });
    const tag = h.enemies().find((e) => e.defId.endsWith('e_tag')), plain = h.enemies().find((e) => e.defId.endsWith('e_dummy'));
    const lost = (e) => { const hp = e.hp; h.b.dealDamage(h.unit('op'), e, { amount: 100, type: 'true' }); return Math.round(hp - e.hp); };
    assert.equal(lost(tag), Math.round(100 * bb.atk), gid);
    assert.equal(lost(plain), 100);
    cover(gid);
  }
  assert.equal(GR('garrison_18_a').bb.atk, 1.5);
  assert.equal(GR('garrison_19_b').bb.atk, 2);
  assert.deepEqual([GR('garrison_18_b').bbStr.check_tag, GR('garrison_19_a').bbStr.check_tag], ['seamonster', 'drone']);
  assert.ok(Object.values(D.enemies).some((e) => (e.tags || []).includes('seamonster')) && Object.values(D.enemies).some((e) => (e.tags || []).includes('drone')));
});

test('弱点伤害 (宴 / 流星 / 伺夜 garrison_01): phys / arts become whichever deals more; ties keep the type', () => {
  for (const gid of idsOfKey('act1autochess_gar_eff_chaos')) {
    const h = battle({
      units: [{ id: 'op', g: [gid], row: 11, col: 4 }],
      edefs: { e_def: dummy({ key: 'e_def', def: 1000 }), e_res: dummy({ key: 'e_res', res: 90 }) },
      enemies: [{ key: 'e_def', pos: [10, 9] }, { key: 'e_res', pos: [11, 9] }, { key: 'e_dummy', pos: [12, 9] }],
    });
    const E = (key) => h.enemies().find((e) => e.defId.endsWith(key));
    const lost = (e, dmg) => { const hp = e.hp; h.b.dealDamage(h.unit('op'), e, dmg); return Math.round(hp - e.hp); };
    assert.equal(lost(E('e_def'), { amount: 500, type: 'phys' }), 500, `${gid}: DEF 1000 ⇒ arts`);
    assert.equal(lost(E('e_res'), { amount: 500, type: 'arts' }), 500, `${gid}: RES 90 ⇒ phys`);
    assert.equal(lost(E('e_def'), { amount: 500, type: 'true' }), 500, 'true damage untouched');
    cover(gid);
  }
});

test('regression: 弱点伤害 keeps the type on a tie, counts the attacker\'s DEF ignore, and runs after ATK multipliers', () => {
  const h = battle({
    units: [{ id: 'op', g: ['garrison_01_a'], row: 11, col: 4 }, { id: 'sea', g: ['garrison_01_b', 'garrison_18_b'], row: 12, col: 4 }],
    edefs: { e_mix: dummy({ key: 'e_mix', def: 300, res: 50 }), e_sea: dummy({ key: 'e_sea', def: 150, res: 50, tags: ['seamonster'] }) },
    enemies: [{ key: 'e_dummy', pos: [10, 9] }, { key: 'e_mix', pos: [11, 9] }, { key: 'e_sea', pos: [12, 9] }],
  });
  const types = [];
  h.b.on('damaged', (c) => { if (c.dmg) types.push(c.dmg.type); });
  const zero = h.enemies().find((e) => e.defId.endsWith('e_dummy'));
  h.b.dealDamage(h.unit('op'), zero, { amount: 500, type: 'arts' });
  h.b.dealDamage(h.unit('op'), zero, { amount: 500, type: 'phys' });
  assert.deepEqual(types.splice(0), ['arts', 'phys'], 'DEF 0 / RES 0: a tie keeps the original type');
  const mix = h.enemies().find((e) => e.defId.endsWith('e_mix'));
  h.b.dealDamage(h.unit('op'), mix, { amount: 500, type: 'phys' });
  assert.deepEqual(types.splice(0), ['arts'], '500 − 300 = 200 < 250 ⇒ arts');
  h.unit('op').s.defIgnoreFlat = 200;
  h.b.dealDamage(h.unit('op'), mix, { amount: 500, type: 'arts' });
  assert.deepEqual(types.splice(0), ['phys'], 'with 200 DEF ignore: 400 > 250 ⇒ phys');
  const sea = h.enemies().find((e) => e.defId.endsWith('e_sea'));
  h.b.dealDamage(h.unit('sea'), sea, { amount: 200, type: 'arts' });
  assert.deepEqual(types.splice(0), ['phys'], 'decided on the multiplied amount: 400 − 150 = 250 > 200 ⇒ phys (on 200: 100 = 100 → arts)');
});

test('风丸 93 (NONE): no battle effect (the 2-copy merge is a prep rule, see garrisons_meta)', () => {
  for (const gid of idsOfKey('NONE')) {
    const h = battle({ units: [{ id: 'op', g: [gid], row: 10, col: 4 }] });
    assert.equal(h.unit('op').buffs.filter((b) => String(b.key).startsWith('gar:')).length, 0);
    assert.deepEqual(h.b.errors, []);
    cover(gid);
  }
});

test('real data: every owned IN_BATTLE garrison installs without errors on its real chess', () => {
  const owners = new Set();
  for (const g of Object.values(D.garrisons)) if (g.eventType === 'IN_BATTLE') for (const o of g.owners) owners.add(o);
  const list = [...owners].sort();
  for (let i = 0; i < list.length; i += 8) {
    const units = list.slice(i, i + 8).map((id, k) => ({ chessId: id, row: 9 + (k % 4), col: 3 + 2 * Math.floor(k / 4) }));
    const bonds = Object.fromEntries(Object.keys(D.bonds).map((b) => [b, B(12)]));
    const h = makeBattle({ units, bonds, enemies: [{ key: 'enemy_1007_slime', time: 0, route: 0, count: 6, interval: 1 }], seed: i + 1, timeLimit: 40 });
    h.runToEnd(60);
    assert.deepEqual(h.b.errors.filter((e) => /garrison|content:garrisons/.test(JSON.stringify(e))), [], `batch ${i}`);
    checkInvariants(h.b);
  }
});

test('coverage: every IN_BATTLE garrison id of a visible chess (and every id they grant) was exercised above', () => {
  const missing = [...VISIBLE_IDS].filter((g) => !COVER.has(g)).sort();
  assert.deepEqual(missing, []);
  assert.ok(VISIBLE_IDS.size >= 100, `${VISIBLE_IDS.size} ids`);
});

test('weakness conversion follows source calculation modifiers and is omitted by precomputed/resolved damage', () => {
  const h = battle({ units: [{ id: 'op', g: ['garrison_01_a'], row: 11, col: 4 }],
    edefs: { e_mix: dummy({ key: 'e_mix', def: 150, res: 50 }) }, enemies: [{ key: 'e_mix', pos: [11, 9] }] });
  const b = h.b, u = h.unit('op'), e = h.enemies()[0], types = [];
  b.on('damageCalculate', c => { if (c.source === u) c.dmg.amount *= 2; });
  b.on('damageOutput', c => { if (c.source === u) types.push(c.dmg.type); });
  // At 200 the types tie; source calculation first raises it to 400, where physical wins 250 over 200.
  approx(b.dealDamage({ source: u, target: e, amount: 200, type: 'arts' }), 250);
  assert.deepEqual(types.splice(0), ['phys']);
  approx(b.dealDamage({ source: u, target: e, amount: 200, type: 'arts', calculation: 'precomputed' }), 100);
  assert.deepEqual(types.splice(0), ['arts']);
  approx(b.dealDamage({ source: u, target: e, amount: 200, type: 'arts', calculation: 'resolved' }), 200);
  assert.deepEqual(types.splice(0), ['arts']);
  checkInvariants(b);
  assert.deepEqual(b.errors, []);
});

test('weakness theory excludes dealt/taken multipliers, instance damage scale, flat reduction and barriers', () => {
  const h = battle({ units: [{ id: 'op', g: ['garrison_01_a'], row: 11, col: 4 }],
    edefs: { e_mix: dummy({ key: 'e_mix', def: 10, res: 50 }) }, enemies: [{ key: 'e_mix', pos: [11, 9] }] });
  const b = h.b, u = h.unit('op'), e = h.enemies()[0], types = [];
  b.addBuff(u, { key: 'dealt', mods: { physDealtMul: 0.1, artsDealtMul: 10, dmgDealtMul: 5 } });
  b.addBuff(e, { key: 'taken', mods: { physTakenMul: 1, artsTakenMul: 10, dmgTakenMul: 2 } });
  b.on('damageOutput', c => { if (c.source === u) types.push(c.dmg.type); });
  // Theoretical 100-10=90 > 100*0.5=50, even though actual arts multipliers would produce much more damage.
  approx(b.dealDamage({ source: u, target: e, amount: 100, type: 'arts', mul: 20 }), 1800);
  assert.deepEqual(types.splice(0), ['phys']);
  b.addBuff(e, { key: 'flat', damageReduction: { phys: 1000 } });
  b.addBuff(e, { key: 'barrier', shield: 100000, shieldType: 'phys' });
  approx(b.dealDamage({ source: u, target: e, amount: 100, type: 'arts' }), 0);
  assert.deepEqual(types.splice(0), ['phys'], 'target injury effects cannot alter the theoretical choice');
  checkInvariants(b);
  assert.deepEqual(b.errors, []);
});
