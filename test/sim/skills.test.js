// Skills runtime: SP types, trigger rules, kinds (duration/ammo/instant/charges/passive/toggle), SkillSpec, generic kits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { genericSkillSpec, genericKind } from '../../server/sim/content/generic.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const RANGE3 = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]];
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });

function sniperWith(skill, o = {}) {
  return chessRec({ id: 't_sn', profession: 'SNIPER', subProfessionId: 'closerange', stats: { atk: 100, bat: 1, ...(o.stats || {}) }, rangeGrid: RANGE3, skill, ...o });
}

test('SP: time regen, starts at initSp, capped at cost; DEFAULT waits for an enemy in the initial range', () => {
  const h = makeBattle({
    defs: { chess: { t_sn: sniperWith({ spCost: 5, initSp: 2, duration: 3, bb: { atk: 1 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], content: 'generic',
  });
  h.step();
  const u = h.unit('t_sn');
  approx(u.skill.sp, 2 + 1 / 30, 1e-6);
  h.run(5);
  assert.equal(u.skill.sp, 5);
  assert.equal(u.skill.ready, true);
  assert.equal(u.skill.activations, 0, 'no enemy in range: DEFAULT waits');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.run(0.1);
  assert.equal(u.skill.activations, 1);
  assert.equal(u.skill.active, true);
  approx(u.s.atk, 200);
  const sp = u.skill.sp;
  h.run(1);
  assert.equal(u.skill.sp, sp, 'no SP gain during a duration skill');
  h.run(2.1);
  assert.equal(u.skill.active, false);
  approx(u.s.atk, 100);
  assert.equal(h.hooksOf('skillStart').length, 1);
  assert.equal(h.hooksOf('skillEnd').length, 1);
  assert.deepEqual(h.eventsOf('skill').map((e) => e[2]), [1, 0]);
});

test('SP types: attack (+1 per attack) and hurt (+1 per hit taken)', () => {
  const h = makeBattle({
    defs: {
      chess: {
        t_sn: sniperWith({ spType: 'INCREASE_WHEN_ATTACK', spCost: 100, initSp: 0, duration: 3 }),
        t_tank: chessRec({ id: 't_tank', profession: 'TANK', stats: { atk: 0, maxHp: 1e6, blockCnt: 3 }, skill: { spType: 'INCREASE_WHEN_TAKEN_DAMAGE', spCost: 100, initSp: 0, duration: 3 } }),
      },
      enemies: { enemy_dummy: dummy({ atk: 10, bat: 1 }) },
    },
    units: [{ chessId: 't_sn', row: 10, col: 4 }, { chessId: 't_tank', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], content: 'generic',
  });
  h.run(0.2);
  const e = h.enemy('enemy_dummy');
  assert.equal(e.blockedBy, h.unit('t_tank'));
  h.run(4.9);
  const sn = h.unit('t_sn'), tank = h.unit('t_tank');
  assert.equal(sn.skill.sp, sn.stats.attacks);
  assert.ok(tank.skill.sp >= 4 && tank.skill.sp === Math.round(tank.skill.sp), `hurt sp ${tank.skill.sp}`);
});

test('trigger TAKE_DAMAGE fires on the first hit once ready; SP_FULL fires immediately; SEARCH needs an enemy in the initial range', () => {
  const h = makeBattle({
    defs: {
      chess: {
        t_tank: chessRec({ id: 't_tank', profession: 'TANK', stats: { atk: 0, maxHp: 1e6, blockCnt: 3 }, skill: { spCost: 1, initSp: 1, duration: 2, trigger: { rule: 'TAKE_DAMAGE' } } }),
        t_bard: chessRec({ id: 't_bard', profession: 'SUPPORT', subProfessionId: 'bard', skill: { spCost: 1, initSp: 1, duration: 2, trigger: { rule: 'ALWAYS' } } }),
        t_ph: chessRec({ id: 't_ph', profession: 'CASTER', subProfessionId: 'phalanx', attackKind: 'none', rangeGrid: [[0, 0], [0, 1], [0, 2]], skill: { spCost: 2, initSp: 0, duration: 2, trigger: { rule: 'SEARCH' } } }),
      },
      enemies: { enemy_dummy: dummy({ atk: 10, bat: 1 }) },
    },
    units: [{ chessId: 't_tank', row: 9, col: 6 }, { chessId: 't_bard', row: 12, col: 3 }, { chessId: 't_ph', row: 11, col: 3 }],
    content: 'generic', autoFinish: false,
  });
  h.run(0.1);
  assert.equal(h.unit('t_bard').skill.activations, 1, 'SP_FULL');
  assert.equal(h.unit('t_tank').skill.activations, 0);
  h.run(3);
  assert.equal(h.unit('t_ph').skill.activations, 0, 'SEARCH: no enemy on field');
  h.spawn('enemy_dummy', { pos: [9, 6] });
  h.run(1.5);
  assert.equal(h.unit('t_tank').skill.activations, 1, 'TAKE_DAMAGE');
  // research 03 Addendum C1 (BWIKI): "解放者/阵法术师子职业干员 技能1，初始攻击范围内出现敌人后自动释放" — an enemy
  // elsewhere on the field is not enough (integration review: the old rule burnt the skill on enemies at the gate)
  assert.equal(h.unit('t_ph').skill.activations, 0, 'SEARCH: an enemy outside the initial range does not trigger');
  h.spawn('enemy_dummy', { pos: [11, 5] });
  h.run(0.2);
  assert.equal(h.unit('t_ph').skill.activations, 1, 'SEARCH: an enemy inside the initial range, without an attack');
});

test('trigger CUSTOM_RANGE uses the custom grid; unknown rules fall back to DEFAULT', () => {
  const h = makeBattle({
    defs: {
      chess: {
        t_cr: sniperWith({ spCost: 1, initSp: 1, duration: 2, trigger: { rule: 'CUSTOM_RANGE', customRangeGrid: [[0, 0], [0, 1]] } }, { id: 't_cr' }),
        t_unk: sniperWith({ spCost: 1, initSp: 1, duration: 2, trigger: { rule: 'MLYSS_WTRMAN' } }, { id: 't_unk' }),
      },
      enemies: { enemy_dummy: dummy() },
    },
    units: [{ chessId: 't_cr', row: 10, col: 4 }, { chessId: 't_unk', row: 12, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 7] }], content: 'generic',
  });
  h.run(1);
  assert.equal(h.unit('t_cr').skill.activations, 0, 'enemy in attack range but outside the custom grid');
  assert.ok(h.unit('t_cr').stats.attacks > 0);
  h.b.units.find((u) => u.defId === 'enemy_dummy').x = 5;
  h.run(0.2);
  assert.equal(h.unit('t_cr').skill.activations, 1);
  h.spawn('enemy_dummy', { pos: [12, 6] });
  h.run(0.2);
  assert.equal(h.unit('t_unk').skill.activations, 1, 'unknown rule behaves like DEFAULT');
});

test('ammo skills end when ammo runs out; ammoUsed fires per shot; no SP gain while active', () => {
  const h = makeBattle({
    defs: { chess: { t_sn: sniperWith({ durationType: 'AMMO', duration: 0, spCost: 5, initSp: 5, bb: { atk: 0.5, 'attack@trigger_time': 4 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], content: 'generic',
    hooks: ['ammoUsed', 'skillStart', 'skillEnd'],
  });
  h.run(0.1);
  const u = h.unit('t_sn');
  assert.equal(u.skill.kind, 'ammo');
  assert.equal(u.skill.active, true);
  h.run(3.1);
  assert.equal(u.skill.active, false);
  assert.deepEqual(h.hooksOf('ammoUsed').map((c) => c.left), [3, 2, 1, 0]);
  assert.equal(h.hooksOf('skillEnd').length, 1);
  assert.equal(h.hooksOf('skillEnd')[0].reason, 'ammo');
});

test('charges accumulate up to maxCharges and are spent one per cast, 3 s apart (the automatic operation cooldown)', () => {
  const h = makeBattle({
    defs: { chess: { t_sn: sniperWith({ duration: 0, spCost: 2, initSp: 0, maxChargeTime: 3, bb: { atk_scale: 3 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], content: 'generic', autoFinish: false,
  });
  h.run(7);
  const u = h.unit('t_sn');
  assert.equal(u.skill.kind, 'charges');
  assert.equal(u.skill.charges, 3);
  assert.equal(u.skill.sp, 2);
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step(1);
  const t1 = h.b.time;
  assert.equal(u.skill.charges, 2);
  assert.equal(u.skill.sp, 0, 'SP bar restarts after using a full stack');
  // PRTS 卫戍协议/帮助 技能操作 "自动操作具有3s冷却": a MANUAL skill's next automatic cast comes ≥ 3 s later
  h.run(2.8);
  assert.equal(u.skill.activations, 1, 'not within 3 s although she attacks every second');
  assert.ok(h.runUntil(() => u.skill.activations >= 2, 2));
  assert.ok(h.b.time - t1 >= 3 - 1e-6);
});

test('instant skills with an attack override apply to exactly one attack', () => {
  const h = makeBattle({
    defs: { chess: { t_sn: sniperWith({ duration: 0, spCost: 100, initSp: 100, bb: { atk_scale: 5 } }, { stats: { atk: 100 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], content: 'generic',
    captureNoisy: true, hooks: ['damaged', 'skillStart', 'skillEnd'],
  });
  h.run(2.2);
  const dmgs = h.hooksOf('damaged').map((c) => Math.round(c.amount));
  assert.deepEqual(dmgs.slice(0, 3), [500, 100, 100]);
  assert.equal(h.hooksOf('skillEnd').length, 1);
});

test('SkillSpec from a kit: mods, targeting override, attack override, onStart/onEnd/onHit', () => {
  const log = [];
  const h = makeBattle({
    defs: { chess: { t_sn: sniperWith({ spCost: 1, initSp: 1, duration: 2 }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [11, 6] }, { key: 'enemy_dummy', pos: [9, 6] }],
    kits: {
      t_sn: (bb) => ({
        skill: {
          kind: 'duration', duration: 2,
          mods: { aspd: 100 },
          targeting: { maxTargets: 3 },
          attack: { atkScale: 2, dmgType: 'arts', onHit: (c) => log.push(['hit', c.target.id]) },
          onStart: (c) => log.push(['start', c.skill.timeLeft]),
          onEnd: (c) => log.push(['end', c.reason]),
        },
      }),
    },
  });
  h.run(0.6); // arrows are in flight for ~0.15 s
  const u = h.unit('t_sn');
  assert.equal(u.s.aspd, 200);
  const hits = log.filter((x) => x[0] === 'hit');
  assert.equal(new Set(hits.map((x) => x[1])).size, 3, 'hits 3 targets while active');
  h.run(2);
  assert.deepEqual(log.find((x) => x[0] === 'start'), ['start', 2]);
  assert.deepEqual(log.find((x) => x[0] === 'end'), ['end', 'duration']);
  assert.equal(u.s.aspd, 100);
});

test('passive and toggle kinds; carryState restores hp/sp, never a running skill', () => {
  const h = makeBattle({
    defs: {
      chess: {
        t_p: sniperWith({ skillType: 'PASSIVE', durationType: 'NONE', duration: -1, spCost: 0, bb: { atk: 1 } }, { id: 't_p' }),
        t_t: sniperWith({ duration: -1, spCost: 3, initSp: 3, bb: { attack_speed: 50 }, desc: '攻击速度+50；持续时间无限' }, { id: 't_t' }),
        t_c: sniperWith({ duration: 10, spCost: 10, initSp: 0, bb: { atk: 1 } }, { id: 't_c' }),
      },
      enemies: { enemy_dummy: dummy() },
    },
    units: [{ chessId: 't_p', row: 10, col: 4 }, { chessId: 't_t', row: 11, col: 4 }, { chessId: 't_c', row: 12, col: 4, carryState: { hpPct: 0.5, sp: 10, skillActive: true } }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 6] }], content: 'generic',
  });
  h.run(0.1);
  assert.equal(h.unit('t_p').skill.kind, 'passive');
  approx(h.unit('t_p').s.atk, 200);
  const t = h.unit('t_t');
  assert.equal(t.skill.kind, 'toggle');
  h.run(30);
  assert.equal(t.skill.active, true, 'toggle stays on');
  const c = h.unit('t_c');
  assert.ok(c.skill.activations >= 1);
  const h2 = makeBattle({
    defs: { chess: { t_c: sniperWith({ duration: 10, spCost: 10, initSp: 0, bb: { atk: 1 } }, { id: 't_c' }) } },
    units: [{ chessId: 't_c', row: 12, col: 4, carryState: { hpPct: 0.5, sp: 10, skillActive: true } }], content: 'generic',
  });
  h2.step();
  const c2 = h2.unit('t_c');
  approx(c2.hpRatio, 0.5, 1e-9);
  // PRTS 卫戍协议/帮助 §联防阶段: only the HP ratio and the SP are set — the (old) skillActive flag starts nothing
  assert.equal(c2.skill.active, false);
  assert.equal(c2.skill.ready, true, 'the carried 10 SP fill the bar');
  assert.equal(c2.skill.activations, 0);
});

test('generic kit maps blackboards of every real chess to a sane SkillSpec', () => {
  const ds = getDefaultSource();
  const kinds = {};
  for (const id of ds.chessIds()) {
    const c = ds.getChess(id);
    if (!c || !c.skill) continue;
    const spec = genericSkillSpec(c.skill, c.skill.bb);
    assert.ok(spec, id);
    assert.ok(['duration', 'ammo', 'instant', 'charges', 'passive', 'toggle'].includes(spec.kind), `${id} kind ${spec.kind}`);
    if (spec.kind === 'ammo') assert.ok(spec.ammo >= 1, `${id} ammo`);
    if (spec.kind === 'duration') assert.ok(spec.duration > 0, `${id} duration`);
    for (const [k, v] of Object.entries(spec.mods || {})) assert.ok(Number.isFinite(v), `${id} mod ${k}=${v}`);
    kinds[spec.kind] = (kinds[spec.kind] || 0) + 1;
  }
  assert.ok(kinds.duration > 50 && kinds.ammo > 5, JSON.stringify(kinds));
  // explicit mapping check
  const spec = genericSkillSpec({ id: 's', skillType: 'MANUAL', durationType: 'AMMO', duration: 0, spCost: 20, maxCharges: 1, bb: {} }, { atk: 0.8, base_attack_time: -0.3, 'attack@trigger_time': 14 });
  assert.equal(spec.kind, 'ammo');
  assert.equal(spec.ammo, 14);
  assert.deepEqual(spec.mods, { atkPct: 0.8, batPct: -0.3 });
  assert.equal(genericKind({ skillType: 'MANUAL', durationType: 'NONE', duration: 0, spCost: 5, maxCharges: 2 }), 'charges');
  assert.equal(genericKind({ skillType: 'AUTO', durationType: 'NONE', duration: 0, spCost: 0, maxCharges: 1 }), 'passive', 'free skill = always on');
});

test('generic kit heuristics: self-stun after skill, on-hit statuses, displacement direction', () => {
  const ds = getDefaultSource();
  const ghost = ds.getChess('chess_char_2_07_a'); // 幽灵鲨: "技能结束后干员晕眩10秒"
  const g = genericSkillSpec(ghost.skill, ghost.skill.bb, ghost);
  assert.equal(g.attack?.onHit, undefined, 'no stun on targets');
  assert.equal(typeof g.onEnd, 'function', 'self stun on end');
  const texas = ds.getChess('chess_char_1_08_a'); // 德克萨斯: instant, stun targets 2 s
  const t = genericSkillSpec(texas.skill, texas.skill.bb, texas);
  assert.equal(t.kind, 'instant');
  assert.equal(typeof t.attack.onHit, 'function');
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 'chess_char_2_07_a', row: 9, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], content: 'generic',
  });
  const u = h.unit('chess_char_2_07_a');
  h.runUntil(() => u.skill.activations > 0, 60);
  assert.ok(u.skill.active);
  h.runUntil(() => !u.skill.active, 20);
  h.step();
  assert.ok(u.s.flags.stun, 'stunned after the skill ended');
});

test('spCostMul changes (绝技-style) keep SP within bounds and convert overflow into a charge', () => {
  const h = makeBattle({
    defs: { chess: { t_sn: sniperWith({ spCost: 10, initSp: 8, duration: 3 }) } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], content: 'generic',
    setup: (b) => b.on('battleStart', () => { for (const u of b.allyUnits) if (u.skill) u.skill.spCostMul = 0.7; }),
  });
  h.step(2);
  const u = h.unit('t_sn');
  assert.equal(u.skill.spCost, 7);
  assert.equal(u.skill.charges, 1);
  assert.ok(u.skill.sp <= u.skill.spCost);
});
