// Unreleased funnel drones add damage to the caster's attack (PRTS 分支特性信息 驭械术师).
// Controlled Battle inputs; the production Match / browser reproduction is recorded separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hitCount } from '../../server/sim/content/enemies/helpers.js';
import { bodyInKeys } from '../../server/sim/body.js';
import { DRONE_TAG } from '../../server/sim/content/kits/ops/chess_char_3_20-kjera.js';

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} vs ${b}`);
const ordinary = ['2_10', '3_13', '3_20', '4_03', '6_18'].flatMap((id) => ['a', 'b'].map((f) => ({ chessId: `chess_char_${id}_${f}` })));
const glow = [5, 6].flatMap((slot) => [false, true].flatMap((elite) => (elite ? [null, 'uniequip_002_gdglow', 'uniequip_003_gdglow'] : [null]).map((uniEquipId) => ({
  diy: { slot, charId: 'char_377_gdglow', skillIndex: 2, uniEquipId }, elite,
}))));

function field(unit, enemy = {}, opts = {}) {
  const h = makeBattle({
    seed: 3, autoFinish: false, timeLimit: 120, captureNoisy: true, hooks: ['damaged', 'attack'],
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e8, speed: 0, mass: 0, ...enemy }) } },
    units: [{ uid: 1, row: 10, col: 4, ...unit }], ...opts,
  });
  h.step();
  return { h, u: h.unit(1), e: h.spawn('enemy_dummy', { pos: [10, 6] }) };
}
const mine = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u);
const volleys = (h, u) => {
  const out = new Map();
  for (const c of mine(h, u)) {
    const key = c.dmg.attackId;
    if (key > 0) { const l = out.get(key) ?? []; l.push(c); out.set(key, l); }
  }
  return [...out.values()];
};
function done(h) { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); }

test('all normal/elite funnel casters and eight Goldenglow forms: a body hit plus a separate ramped addition', () => {
  for (const unit of [...ordinary, ...glow]) {
    const { h, u, e } = field(unit);
    h.run(2);
    const vs = volleys(h, u);
    assert.ok(vs.length >= 2, `${u.defId}: two attacks`);
    for (const [i, v] of vs.slice(0, 2).entries()) {
      assert.equal(v.length, 2, `${u.defId}: body and drone, attack ${i + 1}`);
      const [body, drone] = v;
      assert.ok(body.dmg.isAttack && !body.dmg.tags.includes('addition'));
      assert.ok(!drone.dmg.isAttack && drone.dmg.tags.includes('addition') && drone.dmg.tags.includes('funnel'));
      const crit = u.def.charId === 'char_4054_malist' ? u.def.talents[0].bb.atk_scale : 1;
      assert.ok([u.s.atk, u.s.atk * crit].some((n) => Math.abs(body.amount - n) < 1e-6));
      near(drone.amount / body.amount, u.profile.funnel.init + i * u.profile.funnel.delta, 'independent drone ramp');
    }
    near(1e8 - e.hp, mine(h, u).reduce((sum, c) => sum + c.amount, 0), 'actual HP agrees with all damage events');
    done(h);
  }
});

test('Lolo ATK 283: each component passes through RES, hit-count HP and a one-hit barrier separately', () => {
  for (const mode of ['plain', 'res', 'times', 'barrier']) {
    const { h, u, e } = field({ chessId: 'chess_char_2_10_a' }, { res: mode === 'res' ? 50 : 0, hp: mode === 'times' ? 100 : 1e8 });
    near(u.s.atk, 283, 'unbuffed Lolo');
    if (mode === 'times') hitCount(h.b, e, true);
    if (mode === 'barrier') h.b.addBuff(e, { key: 'test:barrier', shieldHits: 1 });
    h.run(0.7);
    const loss = (mode === 'times' ? 100 : 1e8) - e.hp;
    near(loss, { plain: 339.6, res: 169.8, times: 2, barrier: 56.6 }[mode], mode);
    assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u).length, 1, 'one attack action');
    done(h);
  }
});

test('unreleased attribute skills keep a body hit; released Kjera drones and Lolo S2 do not gain one', () => {
  // S1 (skillIndex 0) keeps the unreleased pair. S2 (skillIndex 1) releases the drone; rockrock-s2-lock covers it.
  for (const id of ['chess_char_2_10_a', 'chess_char_2_10_b']) {
    const { h, u } = field({ chessId: id, skillIndex: 0 });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 2));
    const start = mine(h, u).length;
    h.run(2);
    const active = mine(h, u).slice(start);
    assert.ok(active.some((c) => c.dmg.isAttack && !c.dmg.tags.includes('addition')), `${id} S1: body`);
    assert.ok(active.some((c) => c.dmg.tags.includes('funnel')), `${id} S1: drone`);
    for (const v of volleys(h, u)) assert.equal(v.length, 2, `${id}: one pair per attack`);
    done(h);
  }
  for (const id of ['chess_char_3_20_a', 'chess_char_3_20_b', 'chess_char_4_03_a', 'chess_char_4_03_b']) {
    const { h, u } = field({ chessId: id });
    h.run(2);
    const before = mine(h, u).filter((c) => c.dmg.tags?.includes('funnel'));
    assert.ok(before.length >= 1, `${id}: a pre-skill drone hit`);
    const preScale = before.at(-1).amount / u.s.atk;
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    const t0 = h.b.time;
    h.run(2);
    const full = u.s.atk * u.s.atkScaleMul;
    const later = mine(h, u).filter((c) => c.t + 1e-9 >= t0 - h.b.dt);
    const body = later.filter((c) => c.dmg.isAttack && !c.dmg.isSkill && !(c.dmg.tags || []).includes('funnel'));
    const drones = later.filter((c) => (c.dmg.tags || []).includes(DRONE_TAG));
    assert.ok(body.length > 0, `${id}: the operator's own hit`);
    assert.ok(drones.length >= 2, `${id}: both released drones`);
    for (const c of body) {
      near(c.amount, full, `${id} body is 100% ATK`);
      assert.ok(!(c.dmg.tags || []).includes('addition'));
    }
    for (const c of drones) {
      assert.ok(c.dmg.isSkill && !c.dmg.isAttack && c.type === 'arts', `${id}: drone skill hit`);
      assert.ok(!(c.dmg.tags || []).includes('addition') && !(c.dmg.tags || []).includes('funnel'));
      const r = c.amount / full;
      assert.ok(r + 1e-6 >= u.profile.funnel.init && r <= u.profile.funnel.max + 1e-6, `${id} drone scale ${r}`);
    }
    const first = drones[0].amount / full;
    if (id.startsWith('chess_char_4_03')) near(first, u.profile.funnel.init, `${id} restarts at the initial scale`);
    else assert.ok(first > u.profile.funnel.init + 1e-6 && first + 1e-6 >= Math.min(u.profile.funnel.max, preScale + u.profile.funnel.delta) - 1e-6,
      `${id} continues the pre-skill ramp (${first} after ${preScale})`);
    done(h);
  }
});

test('Whitw2 S1 passive and head-wolf stage 3: only the drone count grows', () => {
  for (const id of ['chess_char_6_18_a', 'chess_char_6_18_b']) {
    const { h, u } = field({ chessId: id, skillIndex: 0 });
    h.run(0.7);
    assert.equal(volleys(h, u)[0].filter((c) => c.dmg.isAttack).length, 1);
    assert.equal(volleys(h, u)[0].filter((c) => c.dmg.tags.includes('funnel')).length, 2);
    // Controlled input keeps S1 off while its deployment-time talent progresses.
    h.b.addBuff(u, { key: 'test:no-skill', flags: { silence: true } });
    h.run(65);
    assert.equal(u.mem.wolfStage, 3);
    const last = volleys(h, u).at(-1);
    assert.equal(last.filter((c) => c.dmg.isAttack).length, 1);
    assert.equal(last.filter((c) => c.dmg.tags.includes('funnel')).length, 3);
    done(h);
  }
});

test('Minimalist charged S2: two body hits and two drone additions share one talent roll and one attack action', () => {
  for (const id of ['chess_char_3_13_a', 'chess_char_3_13_b']) {
    const { h, u } = field({ chessId: id });
    u.skill.gainSp(999);
    h.run(2);
    const vs = volleys(h, u).filter((v) => v[0].dmg.isSkill);
    assert.ok(vs.length > 0);
    for (const v of vs) {
      assert.equal(v.length, 4);
      const body = v.filter((c) => c.dmg.isAttack), drone = v.filter((c) => c.dmg.tags.includes('funnel'));
      assert.equal(body.length, 2); assert.equal(drone.length, 2);
      near(body[0].amount, body[1].amount, 'same talent roll on both body hits');
      near(drone[0].amount, drone[1].amount, 'same ramp and talent roll on both drone hits');
      assert.ok(drone[0].amount / body[0].amount <= u.profile.funnel.max + 1e-6);
    }
    done(h);
  }
});

test('Whitw2 S1 on: the toggle keeps one body hit and both unreleased additions', () => {
  for (const id of ['chess_char_6_18_a', 'chess_char_6_18_b']) {
    const { h, u } = field({ chessId: id, skillIndex: 0 });
    assert.ok(u.skill.activate('test', { free: true }));
    const t0 = h.b.time;
    h.run(2);
    const vs = volleys(h, u).filter((v) => v[0].t + 1e-9 >= t0);
    assert.ok(vs.length >= 1, `${id}: attacks while S1 is on`);
    for (const v of vs) {
      const body = v.filter((c) => c.dmg.isAttack && !(c.dmg.tags || []).includes('addition'));
      const drone = v.filter((c) => (c.dmg.tags || []).includes('funnel'));
      assert.equal(body.length, 1, `${id}: the 100% body is not dropped`);
      assert.equal(drone.length, 2, `${id}: both unreleased drones`);
      near(body[0].amount, u.s.atk * u.s.atkScaleMul, `${id} body`);
      for (const c of drone) {
        assert.ok(!c.dmg.isAttack);
        const r = c.amount / body[0].amount;
        assert.ok(r + 1e-6 >= u.profile.funnel.init && r <= u.profile.funnel.max + 1e-6, `${id} ramp ${r}`);
      }
    }
    done(h);
  }
});

test('Whitw2 S2 stays drone-only: no full-ATK body beside the ramp', () => {
  for (const id of ['chess_char_6_18_a', 'chess_char_6_18_b']) {
    const { h, u } = field({ chessId: id, skillIndex: 1 });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 8));
    const t0 = h.b.time;
    h.run(2);
    const full = u.s.atk * u.s.atkScaleMul;
    const active = mine(h, u).filter((c) => c.t + 1e-9 >= t0 - h.b.dt && c.dmg.isSkill);
    assert.ok(active.length > 0, `${id}: skill hits`);
    assert.ok(active.every((c) => c.dmg.isAttack && !(c.dmg.tags || []).includes('funnel')), `${id}: ramp stays on the attack`);
    assert.equal(active.filter((c) => Math.abs(c.amount - full) < 1e-4).length, 0, `${id}: no 100% body`);
    done(h);
  }
});

test('Kjera S2: a lock that leaves her range still takes drone hits, and the body does not follow it', () => {
  const route = {
    motion: 'FLY', start: [10, 6], end: [9, 2],
    steps: [{ t: 'wait', s: 1.2 }, { t: 'move', p: [12, 6] }, { t: 'wait', s: 20 }, { t: 'move', p: [9, 2] }],
  };
  for (const id of ['chess_char_3_20_a', 'chess_char_4_03_a']) {
    const h = makeBattle({
      seed: 4, autoFinish: false, timeLimit: 40, captureNoisy: true, hooks: ['damaged', 'attack'],
      defs: { enemies: { enemy_lock: enemyRec({ key: 'enemy_lock', hp: 1e8, speed: 1, motion: 'FLY' }) } },
      units: [{ uid: 1, row: 10, col: 4, chessId: id, carryState: { sp: 999 } }],
      enemies: [{ key: 'enemy_lock', route }],
    });
    h.step();
    const u = h.unit(1), e = h.enemies()[0];
    assert.ok(u.skill.active, `${id} opens on the carried SP`);
    assert.ok(h.runUntil(() => e.alive && !bodyInKeys(e, u.rangeKeySet), 8), `${id}: the lock leaves range`);
    h.run(1.5);
    const t = h.b.time, attacks = u.stats.attacks;
    h.run(3);
    assert.ok(e.alive && u.skill.active && !bodyInKeys(e, u.rangeKeySet));
    const out = mine(h, u).filter((c) => c.target === e && c.t + 1e-9 >= t);
    assert.ok(out.length > 0, `${id}: damage outside range`);
    assert.ok(out.every((c) => (c.dmg.tags || []).includes(DRONE_TAG) && c.dmg.isSkill && !c.dmg.isAttack), `${id}: drone only`);
    assert.equal(u.stats.attacks, attacks, `${id}: the body does not attack with nobody in range`);
    done(h);
  }
});

test('one attached volley: attack-SP, attack equipment and afterHit fire once while two damage instances share attackId', () => {
  const h = makeBattle({
    content: 'full', autoFinish: false, captureNoisy: true, hooks: ['damaged', 'attack'],
    defs: {
      chess: { test_funnel: chessRec({ id: 'test_funnel', profession: 'CASTER', subProf: 'funnel',
        rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 100, bat: 2 },
        skill: { spType: 'INCREASE_WHEN_ATTACK', spCost: 100, initSp: 0 } }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 10000, speed: 0, mass: 0 }) },
    },
    units: [{ uid: 1, chessId: 'test_funnel', row: 10, col: 4, items: ['chess_item_4_03_e_a'] }],
  });
  h.step();
  const u = h.unit(1), e = h.spawn('enemy_dummy', { pos: [10, 6] });
  const callbacks = [];
  // Read-only callback observer on the controlled profile; no damage or attack is added by it.
  u.profile.afterHit = (b, source, target, ctx) => callbacks.push({ source, target, dealt: ctx.dealt });
  h.run(0.7);
  const hits = mine(h, u);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].dmg.attackId, hits[1].dmg.attackId);
  assert.equal(h.hooksOf('attack').length, 1);
  assert.equal(u.stats.attacks, 1);
  assert.equal(u.skill.spType, 'attack');
  near(u.skill.spTotal, 1, 'one attack-SP gain');
  assert.equal(u.s.aspd, u.base.aspd + 1, 'one accelerator stack');
  assert.equal(callbacks.length, 1);
  near(callbacks[0].dealt, 120, 'afterHit receives the combined actual HP damage');
  near(10000 - e.hp, 120, 'body and addition HP damage');
  done(h);
});

test('damage equipment: Pegasus riders stay bounded and burn sees both arts components without recursive attack events', () => {
  for (const items of [['chess_item_6_01_e_a', 'chess_item_5_09_e_a'], ['chess_item_4_09_e_a']]) {
    const { h, u, e } = field({ chessId: 'chess_char_2_10_a', items });
    h.run(0.7);
    const main = mine(h, u).filter((c) => c.dmg.attackId > 0);
    assert.equal(main.length, 2, 'body plus drone');
    assert.equal(main[0].type, 'arts'); assert.equal(main[1].type, 'arts');
    assert.equal(h.hooksOf('attack').length, 1, 'riders are not extra attack actions');
    if (items.length === 2) {
      const riders = h.hooksOf('damaged').filter(c => c.credit === u && c.dmg.tags.includes('item:pegasus'));
      assert.equal(riders.length, 2, 'one rider per component; no recursion');
      assert.ok(riders.every(c => c.source === null && c.type === 'true' && c.dmg.attackType === 'ADDITION' && !c.dmg.isAttack));
      near(1e8 - e.hp, [...mine(h, u), ...riders].reduce((sum, c) => sum + c.amount, 0), 'sourced components plus source-less credited riders agree with HP');
    } else {
      near(e.elem.burn, 0.1 * main.reduce((sum, c) => sum + c.amount, 0), 'burn from body and drone arts damage');
    }
    done(h);
  }
});

test('lethal body or addition: one death and no remaining instances redirected to another target', () => {
  for (const hp of [200, 320]) {
    const { h, u, e } = field({ chessId: 'chess_char_2_10_a' }, { hp }, { hooks: ['damaged', 'attack', 'death', 'kill'] });
    const other = h.spawn('enemy_dummy', { pos: [11, 6] });
    h.run(0.7);
    assert.equal(e.alive, false);
    const hits = mine(h, u);
    assert.equal(hits.length, hp === 200 ? 1 : 2);
    assert.ok(hits.every((c) => c.target === e));
    near(hits.reduce((sum, c) => sum + c.amount, 0), hp === 200 ? 283 : 339.6, 'mitigated amounts before HP clamping');
    near(u.stats.dmg, hp, 'damage statistics count only HP actually removed');
    near(other.hp, hp, 'no transfer to a spare target');
    assert.equal(h.hooksOf('death').filter((c) => c.unit === e).length, 1);
    assert.equal(h.hooksOf('kill').filter((c) => c.victim === e && c.killer === u).length, 1);
    done(h);
  }
});

test('a target killed during projectile flight receives neither the body nor drone on impact', () => {
  const { h, u, e } = field({ chessId: 'chess_char_2_10_a' });
  assert.ok(h.runUntil(() => h.hooksOf('attack').length === 1, 1));
  assert.equal(mine(h, u).length, 0, 'projectile is still flying');
  h.b.kill(e, null);
  h.run(0.7);
  assert.equal(mine(h, u).length, 0);
  done(h);
});

test('Minimalist S2: one charge and one talent roll for all four arts instances', () => {
  for (const id of ['chess_char_3_13_a', 'chess_char_3_13_b']) {
    const { h, u } = field({ chessId: id });
    const original = h.b.rng.chance;
    let talentRolls = 0;
    h.b.rng.chance = (p) => { talentRolls++; return original(p); };
    u.skill.gainSp(999);
    h.run(0.7);
    const hits = mine(h, u);
    assert.equal(hits.length, 4);
    assert.ok(hits.every((c) => c.type === 'arts' && c.dmg.isSkill));
    assert.equal(new Set(hits.map((c) => c.dmg.attackId)).size, 1);
    assert.equal(u.skill.activations, 1);
    assert.equal(u.skill.charges, u.skill.maxCharges - 1);
    assert.equal(talentRolls, 1);
    assert.equal(h.hooksOf('attack').length, 1);
    done(h);
  }
});

test('Siracusa rolls once for each body, while two attached additions and its own riders do not roll again', () => {
  const { h, u } = field({ chessId: 'chess_char_6_18_a', skillIndex: 0 }, {}, {
    bonds: { siracusaShip: { count: 6, active: true, tier: 2, layers: 0 } },
  });
  const original = h.b.rng;
  let rolls = 0;
  h.b.rng = Object.assign(() => { rolls++; return original(); }, original);
  h.run(0.7);
  const attacks = h.hooksOf('attack').filter((c) => c.attacker === u).length;
  assert.ok(attacks > 0);
  assert.equal(mine(h, u).filter((c) => c.dmg.tags.includes('funnel')).length, attacks * 2);
  assert.equal(rolls, attacks, 'one ordinary-damage roll, no additional/rider recursion');
  done(h);
});
