// 规程·序列Ⅰ hand-written kits (摆渡人, 夏栎, 褐果, 陨星, 矩, 真理, 车尔尼, 旅骨, 历阵锐枪芬, “暴躁铁皮”).
// File-level setGameData: node:test runs the tests in one file concurrently, so a per-test before/after would race.
// Run this file in its own `node --test` process, apart from test/versions-keying.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { COLS } from '../../server/sim/constants.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { DYING, isDying } from '../../server/sim/content/kits/ops/op-saga.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const V3 = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: QUIET });

const CHAR = Object.freeze({
  varkis: 'char_4166_varkis',
  quercu: 'char_492_quercu',
  chnut: 'char_4041_chnut',
  meteo: 'char_219_meteo',
  ju: 'char_4221_ju',
  glassb: 'char_195_glassb',
  pianst: 'char_4047_pianst',
  hbound: 'char_4232_hbound',
  fang2: 'char_1036_fang2',
  acrbot: 'char_618_acrbot',
});

/** Normal `_a` whose charId matches. Elite is that record's goldenId. */
function chessId(charId, elite) {
  const normal = Object.keys(V3.chess).find((id) => {
    const rec = V3.chess[id];
    return rec?.charId === charId && id.endsWith('_a') && (!rec.baseId || rec.baseId === id);
  });
  if (!normal) throw new Error(`no normal chess for ${charId}`);
  if (!elite) return normal;
  const golden = V3.chess[normal].goldenId;
  if (V3.chess[golden]?.charId !== charId) throw new Error(`no elite chess for ${charId}`);
  return golden;
}

const ID = Object.freeze(Object.fromEntries(Object.entries(CHAR).flatMap(([name, charId]) => [
  [name, chessId(charId, false)],
  [`${name}E`, chessId(charId, true)],
])));

before(() => setGameData(V3));
after(() => setGameData(null));

function approx(actual, expected, eps = 1e-4, msg = '') {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < eps,
    `${msg} expected ${expected} got ${actual} (eps ${eps})`);
}

function open(u) {
  u.skill.gainSp(9999, 'test');
  return u.skill.activate('test');
}

function pin(battle, v) {
  const prev = battle.rng;
  const fn = () => v;
  fn.chance = (p) => v < p;
  fn.int = prev.int.bind(prev);
  fn.range = prev.range.bind(prev);
  fn.pick = prev.pick.bind(prev);
  fn.shuffle = prev.shuffle.bind(prev);
  fn.weighted = prev.weighted.bind(prev);
  fn.state = prev.state.bind(prev);
  fn.clone = prev.clone.bind(prev);
  battle.rng = fn;
}

function foe(battle, row, col, o = {}) {
  return battle.spawnEnemy('enemy_reg_b2', {
    pos: [row, col],
    tag: o.tag,
    def: enemyRec({
      hp: o.hp ?? 10000, def: o.def ?? 0, res: o.res ?? 0, atk: o.atk ?? 0,
      mass: o.mass ?? 1, motion: o.motion ?? 'WALK', taunt: o.taunt ?? 0, speed: o.speed ?? 0,
    }),
  });
}

function battle(units, extra = {}) {
  return makeBattle({
    seed: 1, autoFinish: false, timeLimit: extra.timeLimit ?? 40,
    data: new DataSource(V3),
    flags: { dpInit: 0, dpPerSec: 0 },
    units,
    sharedBoss: extra.sharedBoss,
  });
}

function op(uid, id, col, skillIndex, row = 9) {
  return { uid, chessId: id, row, col, skillIndex };
}

function rec(key) { return V3.chess[ID[key]]; }
function lost(before, unit) { return before - unit.hp; }
const tileKey = (row, col) => row * COLS + col;

// ---------------------------------------------------------------------------------------------------------------
// 摆渡人

test('varkis minos multiplies a full-HP hit and skips a low-HP one', () => {
  assert.equal(rec('varkis').talents[0].bb.talent_atk_scale, 1.09);
  const full = battle([op(1, ID.varkis, 5, 0)]);
  const fullFoe = foe(full.battle, 9, 6, { hp: 10000 });
  full.step();
  approx(lost(10000, fullFoe), 544 * 1.09, 1e-4, 'both full');

  const even = battle([op(1, ID.varkis, 5, 0)]);
  const evenFoe = foe(even.battle, 9, 6, { hp: 10000 });
  even.battle.on('battleStart', () => {
    even.unit(1).hp = even.unit(1).s.maxHp * 0.5;
    evenFoe.hp = evenFoe.s.maxHp * 0.5;
  });
  even.step();
  approx(lost(5000, evenFoe), 544 * 1.09, 1e-4, 'equal ratio still multiplies');

  const low = battle([op(1, ID.varkis, 5, 0)]);
  const lowFoe = foe(low.battle, 9, 6, { hp: 10000 });
  low.battle.on('battleStart', () => { low.unit(1).hp = 100; });
  low.step();
  approx(lost(10000, lowFoe), 544, 1e-6, 'low self HP');
});

test('varkis S1 hits three times', () => {
  const h = battle([op(1, ID.varkis, 5, 0)]);
  const e = foe(h.battle, 9, 6, { hp: 10000 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    assert.equal(u.skill.bb.atk_scale, 1.1);
    assert.ok(open(u));
  });
  h.step();
  approx(lost(10000, e), 544 * 1.09 * 1.1 * 3, 1e-4, 'S1');
});

test('varkis S2 barrier is one pour per attack and then decays', () => {
  const h = battle([op(1, ID.varkis, 5, 1)]);
  foe(h.battle, 9, 5, { atk: 0 });
  foe(h.battle, 9, 5, { atk: 0 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    assert.equal(u.skill.bb['attack@hp_ratio'], 0.06);
    assert.equal(u.skill.bb.dynamic_dec_per_sec, 100);
    assert.ok(open(u));
  });
  h.step();
  const shield = h.unit(1).findBuff('varkis:barrier');
  assert.ok(shield, 'barrier');
  approx(shield.shield, 1872 * 0.06, 1e-4, 'one pour, not two');

  const cap = battle([op(1, ID.varkis, 5, 1)], { timeLimit: 40 });
  // One pour is 6% max HP. The foe has to survive the whole 22s or the pours stop short of the cap.
  foe(cap.battle, 9, 6, { atk: 0, hp: 200000 });
  cap.battle.on('battleStart', () => { assert.ok(open(cap.unit(1))); });
  cap.run(22);
  const full = cap.unit(1).findBuff('varkis:barrier');
  assert.ok(full, 'capped barrier');
  approx(full.shield, 1872, 1e-4, 'cap');
  cap.unit(1).skill.stop();
  const before = cap.unit(1).findBuff('varkis:barrier').shield;
  cap.run(1);
  const after = cap.unit(1).findBuff('varkis:barrier');
  assert.ok(after, 'barrier still up after 1s');
  approx(before - after.shield, 100, 5, 'decay HP/s');
});

test('varkis elite guard is 80% physical damage above half HP', () => {
  assert.equal(rec('varkisE').trait.bb.hp_ratio, 0.5);
  assert.equal(rec('varkisE').trait.bb.damage_resistance, 0.2);
  assert.equal(rec('varkisE').stats.def, 310);
  const h = battle([op(1, ID.varkisE, 5, 0)]);
  const e = foe(h.battle, 9, 6, { atk: 0 });
  h.battle.on('battleStart', () => { h.unit(1).atkCd = 999; });
  h.step();
  const u = h.unit(1);
  const hp = u.hp;
  h.battle.dealDamage({ source: e, target: u, amount: 1000, type: 'phys' });
  approx(lost(hp, u), (1000 - 310) * 0.8, 1e-4, 'above half');
  u.hp = 1000;
  h.step();
  const low = u.hp;
  h.battle.dealDamage({ source: e, target: u, amount: 1000, type: 'phys' });
  approx(lost(low, u), 1000 - 310, 1e-4, 'below half');
});

// ---------------------------------------------------------------------------------------------------------------
// 夏栎

test('quercu idle bolt is arts and S1 heals', () => {
  assert.equal(rec('quercu').trait.bb.heal_scale, 0.75);
  assert.equal(rec('quercu').stats.atk, 366);
  const idle = battle([op(1, ID.quercu, 7, 0)]);
  const e = foe(idle.battle, 9, 8);
  idle.step();
  assert.equal(idle.unit(1).profile.dmgType, 'arts');
  idle.run(0.5);
  approx(lost(10000, e), 366, 1e-4, 'idle arts');

  const h = battle([
    op(1, ID.quercu, 7, 0),
    op(2, ID.varkis, 8, 0),
  ]);
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    assert.equal(u.skill.bb.atk, 0.2);
    h.unit(2).hp = 500;
    assert.ok(open(u));
  });
  h.step();
  approx(h.unit(1).s.atk, 366 * 1.2, 1e-4, 'S1 atk');
  approx(h.unit(2).hp - 500, 366 * 1.2 * 0.75, 1e-4, 'S1 heal');
});

test('quercu shelter holds allies strictly above 70% HP', () => {
  assert.equal(rec('quercu').talents[0].bb.hp_ratio, 0.7);
  assert.equal(rec('quercu').talents[0].bb.damage_resistance, 0.1);
  const h = battle([
    op(1, ID.quercu, 7, 0),
    op(2, ID.varkis, 8, 0),
    op(3, ID.varkis, 9, 0),
  ]);
  h.battle.on('battleStart', () => {
    const a = h.unit(2);
    const b = h.unit(3);
    a.hp = a.s.maxHp * 0.9;
    b.hp = b.s.maxHp * 0.5;
  });
  h.step();
  const self = h.unit(1).findBuff('protect');
  const high = h.unit(2).findBuff('protect');
  assert.ok(self && high, 'self and the 90% ally');
  assert.equal(self.data.value, 0.1);
  assert.equal(high.data.value, 0.1);
  assert.ok(self.timeLeft > 0.7 && self.timeLeft <= 0.75, `hold ${self.timeLeft}`);
  assert.equal(h.unit(3).findBuff('protect'), null);
});

test('quercu S2 gives the patient 1 SP', () => {
  const h = battle([
    op(1, ID.quercu, 7, 1),
    op(2, ID.varkis, 8, 0),
  ]);
  h.battle.on('battleStart', () => {
    assert.equal(h.unit(1).skill.bb.sp, 1);
    h.unit(2).hp = 500;
    assert.ok(open(h.unit(1)));
  });
  h.step();
  assert.equal(h.unit(2).skill.sp, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// 褐果

test('chnut S1 heals HP by ATK and element by trait scale times the ground talent', () => {
  assert.equal(rec('chnut').skills[0].bb.trait_scale, 2);
  assert.equal(rec('chnut').talents[0].bb.ep_heal_scale, 1.13);
  assert.equal(rec('chnut').stats.atk, 319);
  const h = battle([
    op(1, ID.chnut, 5, 0),
    op(2, ID.varkis, 6, 0),
  ]);
  h.battle.on('battleStart', () => {
    h.unit(1).atkCd = 999;
    h.unit(2).hp = 1000;
    h.unit(2).elem.burn = 1000;
  });
  h.step();
  assert.ok(open(h.unit(1)));
  assert.equal(h.unit(2).hp, 1319);
  approx(h.unit(2).elem.burn, 1000 - 319 * 2 * 1.13, 1e-4, 'S1 element');
});

test('chnut S2 boosts the second heal of the same patient', () => {
  const h = battle([
    op(1, ID.chnut, 5, 1),
    op(2, ID.varkis, 6, 0),
  ]);
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    assert.equal(u.skill.bb.attack_speed, 90);
    assert.equal(u.skill.bb['attack@heal_continuously_scale'], 1.2);
    h.unit(2).hp = 100;
    h.unit(2).elem.burn = 1000;
    assert.ok(open(u));
  });
  h.step();
  const u = h.unit(1);
  const p = h.unit(2);
  approx(u.s.interval, 2.85 * 100 / 190, 1e-6, 'S2 interval');
  approx(p.hp - 100, 319, 1e-4, 'first HP');
  approx(1000 - p.elem.burn, 319 * 0.5 * 1.13, 1e-4, 'first element');
  const hp = p.hp;
  const burn = p.elem.burn;
  u.atkCd = 0;
  h.step();
  approx(p.hp - hp, 319 * 1.2, 1e-4, 'second HP');
  approx(burn - p.elem.burn, 319 * 0.5 * 1.13 * 1.2, 1e-4, 'second element');
});

test('chnut S2 range does not reach the idle [2,1] tile', () => {
  assert.deepEqual(rec('chnut').skills[1].rangeGrid, [[0, 0], [0, 1], [0, 2], [0, 3]]);
  const idle = battle([
    op(1, ID.chnut, 5, 0, 9),
    op(2, ID.varkis, 6, 0, 11),
  ]);
  idle.battle.on('battleStart', () => { idle.unit(2).hp = 400; });
  idle.step();
  approx(idle.unit(2).hp - 400, 319, 1e-4, 'idle range heals [2,1]');

  const h = battle([
    op(1, ID.chnut, 5, 1, 9),
    op(2, ID.varkis, 6, 0, 11),
  ]);
  h.battle.on('battleStart', () => {
    h.unit(2).hp = 400;
    assert.ok(open(h.unit(1)));
  });
  h.step();
  assert.equal(h.unit(1).stats.attacks, 0);
  assert.equal(h.unit(2).hp, 400);
});

// ---------------------------------------------------------------------------------------------------------------
// 陨星

test('meteo talent is one roll per attack', () => {
  assert.equal(rec('meteo').talents[0].bb.prob, 0.15);
  assert.equal(rec('meteo').talents[0].bb.atk, 0.6);
  assert.equal(rec('meteo').stats.atk, 680);
  function shot(rng) {
    const h = battle([op(1, ID.meteo, 5, 0)]);
    const e = foe(h.battle, 9, 6);
    h.battle.on('battleStart', () => {
      h.unit(1).atkCd = 999;
      pin(h.battle, rng);
    });
    h.step();
    h.unit(1).atkCd = 0;
    h.run(0.5);
    return lost(10000, e);
  }
  approx(shot(0), 680 * 1.6, 1e-4, 'proc');
  approx(shot(0.99), 680, 1e-4, 'no proc');
});

test('meteo S1 splash hits a second enemy two tiles away', () => {
  const h = battle([op(1, ID.meteo, 5, 0)]);
  const nearE = foe(h.battle, 9, 6);
  const far = foe(h.battle, 9, 8);
  h.battle.on('battleStart', () => {
    assert.equal(h.unit(1).skill.bb.atk_scale, 1.5);
    pin(h.battle, 0.99);
    assert.ok(open(h.unit(1)));
  });
  h.run(0.5);
  approx(lost(10000, nearE), 680 * 1.5, 1e-4, 'primary');
  approx(lost(10000, far), 680 * 1.5, 1e-4, 'splash');
});

test('meteo S2 bursts the near enemy and cuts its DEF', () => {
  const h = battle([op(1, ID.meteo, 5, 1)]);
  const nearE = foe(h.battle, 9, 6, { def: 200, hp: 20000 });
  const far = foe(h.battle, 9, 8, { def: 200, hp: 20000 });
  h.battle.on('battleStart', () => { h.unit(1).atkCd = 999; });
  // The enemy tile index is built after battleStart, so the cast waits until that step has indexed them.
  h.step();
  const u = h.unit(1);
  assert.equal(u.skill.bb.atk_scale, 2.1);
  assert.equal(u.skill.bb.def, -170);
  pin(h.battle, 0);
  assert.ok(open(u));
  approx(lost(20000, nearE), 680 * 2.1 * 1.6 - 200, 1e-4, 'S2');
  assert.equal(far.hp, 20000);
  approx(nearE.s.def, 30, 1e-4, 'near def');
  approx(far.s.def, 200, 1e-4, 'far def');
});

test('meteo elite ignores 100 DEF', () => {
  assert.equal(rec('meteoE').trait.bb.def_penetrate_fixed, 100);
  assert.equal(rec('meteoE').stats.atk, 864);
  const h = battle([op(1, ID.meteoE, 5, 0)]);
  const e = foe(h.battle, 9, 6, { def: 150 });
  h.battle.on('battleStart', () => { h.unit(1).atkCd = 999; });
  h.step();
  h.unit(1).atkCd = 0;
  h.run(0.5);
  approx(lost(10000, e), 864 - (150 - 100), 1e-4, 'pierce');
});

// ---------------------------------------------------------------------------------------------------------------
// 矩

test('ju attacks the heaviest enemy', () => {
  const h = battle([op(1, ID.ju, 5, 0)]);
  const light = foe(h.battle, 9, 7, { mass: 1 });
  const heavy = foe(h.battle, 9, 9, { mass: 5 });
  h.step();
  assert.equal(h.unit(1).profile.priority, 'heaviest');
  h.run(0.5);
  assert.equal(light.hp, 10000);
  approx(lost(10000, heavy), 817, 1e-4, 'heavy');
});

test('ju S1 hits an enemy at half HP and not a full one', () => {
  function cast(ratio) {
    const h = battle([op(1, ID.ju, 5, 0)]);
    const e = foe(h.battle, 9, 7, { hp: 10000 });
    h.battle.on('battleStart', () => {
      assert.equal(h.unit(1).skill.bb.atk_scale_s1, 2.1);
      e.hp = e.s.maxHp * ratio;
      assert.ok(open(h.unit(1)));
    });
    h.run(0.5);
    return lost(e.s.maxHp * ratio, e);
  }
  approx(cast(0.4), 817 * 2.1, 1e-4, 'half');
  approx(cast(1), 0, 1e-6, 'full HP is not a target');
});

test('ju S2 extra hit waits 0.5s and is dropped if the skill stops', () => {
  function setup() {
    const h = battle([op(1, ID.ju, 5, 1)], { timeLimit: 20 });
    const e = foe(h.battle, 9, 7, { hp: 10000 });
    h.battle.on('battleStart', () => {
      const u = h.unit(1);
      u.atkCd = 999;
      assert.equal(u.skill.bb.atk, 0.62);
      assert.equal(u.skill.bb.atk_scale_s2_extra, 1);
      assert.equal(u.skill.bb.hp_ratio, 0.5);
      e.hp = 4000;
      assert.ok(open(u));
    });
    return { h, e };
  }
  const fired = setup();
  fired.h.step();
  assert.ok(fired.h.runUntil((b) => b.time >= 0.5 - 1e-9));
  assert.equal(fired.e.hp, 4000);
  fired.h.step();
  approx(lost(4000, fired.e), 817 * 1.62, 1e-4, 'extra');

  const stopped = setup();
  stopped.h.step();
  assert.ok(stopped.h.runUntil((b) => b.time >= 0.5 - 1e-9));
  stopped.h.unit(1).skill.stop();
  stopped.h.step();
  assert.equal(stopped.e.hp, 4000);
});

test('ju dying gives the killer 1 SP and a boss pool never enters it', () => {
  assert.equal(rec('ju').talents[0].bb.sp, 1);
  assert.equal(rec('ju').talents[0].bb.move_speed, -0.8);
  const h = battle([
    op(1, ID.ju, 5, 0),
    op(2, ID.varkis, 6, 0),
  ]);
  const e = foe(h.battle, 9, 8, { hp: 1000 });
  h.battle.on('battleStart', () => {
    h.unit(1).atkCd = 999;
    h.unit(2).atkCd = 999;
  });
  h.step();
  h.battle.dealDamage({ source: h.unit(1), target: e, amount: 5000, type: 'phys' });
  assert.equal(e.hp, 1);
  assert.ok(isDying(e));
  approx(e.findBuff(DYING).mods.moveMul, 0.2, 1e-6, 'moveMul');
  const attacks = h.unit(1).stats.attacks;
  h.unit(1).atkCd = 0;
  h.run(3);
  assert.equal(h.unit(1).stats.attacks, attacks);
  const sp = h.unit(2).skill.sp;
  h.battle.dealDamage({ source: h.unit(2), target: e, amount: 50, type: 'true' });
  assert.equal(e.alive, false);
  assert.equal(h.unit(2).skill.sp, sp + 1);

  const pool = { hp: 100, maxHp: 10000, damage(pid, n) { this.hp = Math.max(0, this.hp - n); } };
  const boss = battle([op(1, ID.ju, 5, 0)], { sharedBoss: pool });
  const b = foe(boss.battle, 9, 7, { tag: 'boss', hp: 5000 });
  boss.battle.on('battleStart', () => { boss.unit(1).atkCd = 999; });
  boss.step();
  boss.battle.dealDamage({ source: boss.unit(1), target: b, amount: 5000, type: 'phys' });
  assert.equal(pool.hp, 0);
  assert.equal(isDying(b), false);
});

test('ju elite weight bonus is 1.15 and the normal form has none', () => {
  assert.equal(rec('juE').talents[0].bb.atk_scale, 1.15);
  assert.equal(rec('juE').talents[0].bb.value, 3);
  assert.equal(rec('ju').talents[0].bb.atk_scale, undefined);
  const elite = battle([op(1, ID.juE, 5, 0)]);
  const heavy = foe(elite.battle, 9, 7, { mass: 5 });
  const light = foe(elite.battle, 9, 8, { mass: 1 });
  elite.battle.on('battleStart', () => { elite.unit(1).atkCd = 999; });
  elite.step();
  const ju = elite.unit(1);
  elite.battle.dealDamage({ source: ju, target: heavy, amount: 1012, type: 'phys', isAttack: true });
  elite.battle.dealDamage({ source: ju, target: light, amount: 1012, type: 'phys', isAttack: true });
  approx(lost(10000, heavy), 1012 * 1.15, 1e-4, 'weight >= 3');
  approx(lost(10000, light), 1012, 1e-4, 'light');

  const normal = battle([op(1, ID.ju, 5, 0)]);
  const e = foe(normal.battle, 9, 7, { mass: 5 });
  normal.battle.on('battleStart', () => { normal.unit(1).atkCd = 999; });
  normal.step();
  normal.battle.dealDamage({ source: normal.unit(1), target: e, amount: 817, type: 'phys', isAttack: true });
  approx(lost(10000, e), 817, 1e-4, 'normal');
});

// ---------------------------------------------------------------------------------------------------------------
// 真理

test('glassb S1 interval is 1 and the elite talent keeps attack speed 21', () => {
  const h = battle([op(1, ID.glassb, 5, 0)]);
  h.battle.on('battleStart', () => {
    assert.equal(h.unit(1).skill.bb.base_attack_time, -0.9);
    assert.ok(open(h.unit(1)));
  });
  h.step();
  approx(h.unit(1).s.interval, 1, 1e-9, 'normal interval');

  assert.equal(rec('glassbE').talents[0].bb.attack_speed, 21);
  assert.equal(rec('glassbE').talents[0].potBelow.bb.attack_speed, 18);
  const elite = battle([op(1, ID.glassbE, 5, 0)]);
  elite.battle.on('battleStart', () => {
    assert.equal(elite.unit(1).skill.bb.base_attack_time, -1);
    assert.ok(open(elite.unit(1)));
  });
  elite.step();
  const u = elite.unit(1);
  approx(u.s.aspd, 124, 1e-6, 'aspd');
  approx(u.s.interval, 90 / 124, 1e-6, 'elite interval');
});

test('glassb S2 hits three targets including the tile behind her', () => {
  assert.equal(rec('glassb').skills[1].rangeGrid.length, 21);
  assert.equal(rec('glassb').rangeGrid.length, 12);
  const h = battle([op(1, ID.glassb, 5, 1)]);
  const behind = foe(h.battle, 9, 3);
  const mid = foe(h.battle, 9, 6);
  const front = foe(h.battle, 9, 7);
  let idle = 0;
  let hadBehind = false;
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    idle = u.rangeKeys.length;
    hadBehind = u.rangeKeySet.has(tileKey(9, 3));
    assert.equal(u.skill.bb.atk, 0.25);
    assert.equal(u.skill.bb['attack@max_target'], 3);
    assert.ok(open(u));
  });
  h.step();
  assert.equal(idle, 12);
  assert.equal(hadBehind, false);
  assert.equal(h.unit(1).rangeKeys.length, 21);
  assert.ok(h.unit(1).rangeKeySet.has(tileKey(9, 3)));
  h.run(0.5);
  for (const e of [behind, mid, front]) approx(lost(10000, e), 436 * 1.25, 1e-4, `target @${e.x}`);
});

// ---------------------------------------------------------------------------------------------------------------
// 车尔尼

test('pianst reflects arts and S1 multiplies RES', () => {
  assert.equal(rec('pianst').talents[0].bb.magic_resistance, 10);
  assert.equal(rec('pianst').talents[0].bb.atk_scale, 0.85);
  assert.equal(rec('pianst').stats.res, 15);
  const plain = battle([op(1, ID.pianst, 5, 0)]);
  const pe = foe(plain.battle, 9, 5, { atk: 0, hp: 20000 });
  plain.battle.on('battleStart', () => { plain.unit(1).atkCd = 999; });
  plain.step();
  const pu = plain.unit(1);
  approx(pu.s.res, 25, 1e-6, 'res');
  const php = pu.hp;
  plain.battle.dealDamage({ source: pe, target: pu, amount: 1000, type: 'arts' });
  approx(lost(php, pu), 750, 1e-4, 'taken');
  approx(lost(20000, pe), 500 * 0.85, 1e-4, 'echo');

  const h = battle([op(1, ID.pianst, 5, 0)]);
  const e = foe(h.battle, 9, 5, { atk: 0, hp: 20000 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    u.atkCd = 999;
    assert.equal(u.skill.bb.magic_resistance, 0.65);
    assert.equal(u.skill.bb.atk, 0.35);
    assert.ok(open(u));
  });
  h.step();
  const u = h.unit(1);
  approx(u.s.res, (15 + 10) * 1.65, 1e-4, 'S1 res');
  approx(u.s.atk, 500 * 1.35, 1e-4, 'S1 atk');
  const hp = u.hp;
  h.battle.dealDamage({ source: e, target: u, amount: 1000, type: 'arts' });
  approx(lost(hp, u), 587.5, 1e-4, 'S1 taken');
  approx(lost(20000, e), 675 * 0.85, 1e-4, 'S1 echo');
});

test('pianst S1 attack is arts, so DEF does not floor it', () => {
  const h = battle([op(1, ID.pianst, 5, 0)]);
  const e = foe(h.battle, 9, 5, { def: 1000, atk: 0, hp: 20000 });
  h.battle.on('battleStart', () => { assert.ok(open(h.unit(1))); });
  h.step();
  approx(lost(20000, e), 500 * 1.35, 1e-4, 'arts');
});

test('pianst S2 stacks and bursts the enemy on his tile', () => {
  const h = battle([op(1, ID.pianst, 5, 1)]);
  const e = foe(h.battle, 9, 5, { atk: 0, hp: 20000 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    u.atkCd = 999;
    assert.equal(u.skill.bb.atk, 0.2);
    assert.equal(u.skill.bb.atk_scale, 1.7);
    assert.equal(u.skill.bb.max_hp, 0.5);
    assert.equal(u.skill.bb.max_stack_cnt, 10);
    assert.ok(open(u));
  });
  h.step();
  const u = h.unit(1);
  approx(u.s.maxHp, 2247 * 1.5, 1e-4, 'maxHp');
  const hp = u.hp;
  h.battle.dealDamage({ source: e, target: u, amount: 100, type: 'phys' });
  h.battle.dealDamage({ source: e, target: u, amount: 100, type: 'phys' });
  approx(lost(hp, u), 10, 1e-4, 'two minimum hits');
  approx(u.s.atk, 700, 1e-4, 'two stacks');
  u.skill.stop();
  approx(lost(20000, e), 700 * 1.7, 1e-4, 'burst');
});

test('pianst elite trait adds 10% ATK arts when he is hit', () => {
  assert.equal(rec('pianstE').trait.bb.atk_scale, 0.1);
  assert.equal(rec('pianstE').stats.atk, 593);
  const h = battle([op(1, ID.pianstE, 5, 0)]);
  const e = foe(h.battle, 9, 5, { atk: 0, hp: 20000 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    u.atkCd = 999;
    assert.equal(u.skill.bb.atk, 0.5);
    assert.ok(open(u));
  });
  h.step();
  const u = h.unit(1);
  approx(u.s.atk, 593 * 1.5, 1e-4, 'S1 atk');
  h.battle.dealDamage({ source: e, target: u, amount: 1000, type: 'phys' });
  approx(lost(20000, e), 593 * 1.5 * 0.1, 1e-4, 'trait extra');
});

// ---------------------------------------------------------------------------------------------------------------
// 旅骨

test('hbound S1 pulse slows ground enemies and keeps ticking after she leaves', () => {
  const h = battle([op(1, ID.hbound, 5, 0)], { timeLimit: 20 });
  const e = foe(h.battle, 9, 6, { atk: 0 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    u.atkCd = 999;
    assert.equal(u.skill.bb.atk_scale, 0.4);
    assert.equal(u.skill.bb.move_speed, -0.3);
    assert.equal(u.skill.bb.projectile_delay_time, 8);
    assert.ok(open(u));
  });
  h.step();
  approx(lost(10000, e), 373 * 0.4, 1e-4, 'pulse');
  const slow = e.findBuff('slow');
  assert.ok(slow, 'slow');
  approx(slow.mods.moveMul, 0.7, 1e-6, 'moveMul');
  const hp = e.hp;
  h.battle.retreat(h.unit(1));
  h.run(1.2);
  approx(lost(hp, e), 373 * 0.4, 1e-4, 'second pulse');
});

test('hbound S2 hits a heavy enemy harder and only slows that one', () => {
  const h = battle([op(1, ID.hbound, 5, 1)]);
  const light = foe(h.battle, 9, 6, { mass: 1, atk: 0 });
  const heavy = foe(h.battle, 9, 6, { mass: 5, atk: 0 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    u.atkCd = 999;
    assert.equal(u.skill.bb.atk_scale, 0.14);
    assert.equal(u.skill.bb.heavy_atk_scale, 1.2);
    assert.equal(u.skill.bb.move_speed, -0.6);
    assert.equal(u.skill.bb.value, 3);
    assert.ok(open(u));
  });
  h.step();
  approx(lost(10000, light), 373 * 0.14, 1e-4, 'light');
  approx(lost(10000, heavy), 373 * 0.14 + 373 * 1.2, 1e-4, 'heavy');
  assert.equal(light.findBuff('slow'), null);
  approx(heavy.findBuff('slow').mods.moveMul, 0.4, 1e-6, 'heavy slow');
});

test('hbound zones miss ground attacks and do not roll flyers', () => {
  assert.equal(rec('hbound').talents[0].bb.hitrate, -0.1);
  assert.equal(rec('hbound').talents[0].bb.heavy_hitrate, -0.15);
  function swing({ mass = 1, motion = 'WALK', rng = 0, casts = 1, col = 5 }) {
    const h = battle([op(1, ID.hbound, 5, 0)]);
    const e = foe(h.battle, 9, col, { mass, motion, atk: 0 });
    h.battle.on('battleStart', () => {
      const u = h.unit(1);
      u.atkCd = 999;
      for (let i = 0; i < casts; i++) assert.ok(open(u));
    });
    h.step();
    pin(h.battle, rng);
    const u = h.unit(1);
    const hp = u.hp;
    h.battle.dealDamage({ source: e, target: u, amount: 800, type: 'phys', isAttack: true });
    return lost(hp, u);
  }
  approx(swing({ rng: 0, mass: 1 }), 0, 1e-6, 'rng 0 misses');
  approx(swing({ rng: 0.12, mass: 1 }), 800 - 84, 1e-4, 'rng 0.12 hits');
  approx(swing({ rng: 0.12, mass: 5, casts: 2 }), 0, 1e-6, 'overlapping heavy cut misses');
  approx(swing({ rng: 0, motion: 'FLY', col: 6 }), 800 - 84, 1e-4, 'flyer is not rolled');
});

test('hbound elite module adds SP while a zone is up', () => {
  assert.equal(rec('hboundE').skills[0].bb.projectile_delay_time, 9);
  assert.equal(rec('hboundE').talents.find((t) => t.index === -1).bb.sp_recovery_per_sec, 0.1);
  function delta(cast) {
    const h = battle([op(1, ID.hboundE, 5, 0)], { timeLimit: 20 });
    h.battle.on('battleStart', () => {
      const u = h.unit(1);
      u.atkCd = 999;
      if (cast) assert.ok(open(u));
    });
    h.step();
    const u = h.unit(1);
    if (cast) assert.ok(u.mem.hZones > 0, 'zone');
    const sp = u.skill.sp;
    h.run(2);
    return u.skill.sp - sp;
  }
  approx(delta(true) - delta(false), 0.2, 0.02, 'SP bonus');
});

// ---------------------------------------------------------------------------------------------------------------
// 历阵锐枪芬

test('fang2 S1 strikes twice and a kill during it refunds both DP grants', () => {
  assert.equal(rec('fang2').trait.bb.cost, 1);
  const hits = battle([op(1, ID.fang2, 5, 0)]);
  const e = foe(hits.battle, 9, 6, { hp: 20000 });
  hits.battle.on('battleStart', () => {
    assert.equal(hits.unit(1).skill.bb.atk_scale, 1.35);
    assert.equal(hits.unit(1).skill.bb.cost, 1);
    assert.ok(open(hits.unit(1)));
  });
  hits.step();
  approx(lost(20000, e), 503 * 1.35 * 2, 1e-4, 'two hits');

  const kill = battle([op(1, ID.fang2, 5, 0)]);
  foe(kill.battle, 9, 6, { hp: 30 });
  kill.battle.on('battleStart', () => { assert.ok(open(kill.unit(1))); });
  kill.step();
  assert.equal(kill.battle.getPlayer('p1').dp, 2);
});

test('fang2 refunds base cost on a manual retreat', () => {
  for (const id of [ID.fang2, ID.fang2E]) {
    const h = battle([op(1, id, 5, 0)]);
    h.step();
    const u = h.unit(1);
    assert.equal(u.base.cost, 10);
    h.battle.retreat(u);
    assert.equal(h.battle.getPlayer('p1').dp, 10);
  }
});

test('fang2 S2 opens on deploy and hits both blocked enemies', () => {
  assert.equal(rec('fang2').skills[1].bb.atk, 0.85);
  assert.equal(rec('fang2').skills[1].bb.block_cnt, 1);
  const h = battle([op(1, ID.fang2, 5, 1)]);
  const a = foe(h.battle, 9, 5, { atk: 0 });
  const b = foe(h.battle, 9, 5, { atk: 0 });
  h.step();
  const u = h.unit(1);
  assert.equal(u.skill.active, true);
  assert.equal(u.s.blockCnt, 2);
  assert.equal(u.blocking.length, 2);
  approx(lost(10000, a), 503 * 1.85, 1e-4, 'a');
  approx(lost(10000, b), 503 * 1.85, 1e-4, 'b');
});

// ---------------------------------------------------------------------------------------------------------------
// 暴躁铁皮

test('acrbot S1 swings at an ally in the extended range', () => {
  assert.equal(rec('acrbot').skills[0].bb.base_attack_time, -0.6);
  assert.equal(rec('acrbot').skills[0].bb.atk, 1.6);
  assert.equal(rec('acrbot').skills[0].bb.max_hp, 0.6);
  assert.equal(rec('acrbot').stats.atk, 691);
  assert.equal(rec('acrbot').stats.maxHp, 3249);
  // Garrison 攻击力和生命上限+60% is an atkMul / hpMul on the chess stats (GAIN_BUFF), under the skill's own +60% HP / +160% ATK.
  assert.deepEqual(V3.garrisons[rec('acrbot').garrisonIds[0]].bb, { atk: 1.6, max_hp: 1.6 });
  const h = battle([
    op(1, ID.acrbot, 5, 0),
    op(2, ID.varkis, 7, 0),
    op(3, ID.quercu, 8, 0),
  ]);
  let startHp = 0;
  h.battle.on('battleStart', () => {
    assert.ok(open(h.unit(1)));
    // The garrison swing exceeds 摆渡人's HP. Half HP also keeps her under 夏栎's 70% shelter, which would cut 10%.
    const ally = h.unit(2);
    h.battle.addBuff(ally, { key: 'test:hp', mods: { hpFlat: 20000 } });
    ally.hp = ally.s.maxHp * 0.5;
    startHp = ally.hp;
  });
  h.step();
  const u = h.unit(1);
  approx(u.s.interval, 1, 1e-6, 'interval');
  approx(u.s.maxHp, 3249 * 1.6 * 1.6, 1e-4, 'maxHp');
  assert.ok(u.stats.attacks >= 1);
  const ally = h.unit(2);
  approx(startHp - ally.hp, 691 * 1.6 * 2.6 - 258, 1e-4, 'ally');
  assert.equal(h.unit(3).hp, h.unit(3).s.maxHp);
});

test('acrbot death splash uses stripped ATK and a retreat does not splash', () => {
  assert.equal(rec('acrbot').talents[0].bb.atk_scale, 1.5);
  assert.equal(rec('acrbot').talents[0].bb.stun, 5);
  const h = battle([op(1, ID.acrbot, 5, 0)]);
  const e = foe(h.battle, 9, 6, { atk: 0, hp: 20000 });
  h.battle.on('battleStart', () => {
    const u = h.unit(1);
    u.atkCd = 999;
    assert.ok(open(u));
  });
  h.step();
  h.battle.dealDamage({ source: e, target: h.unit(1), amount: 1e7, type: 'true' });
  // Skill mods are gone; the garrison atkMul stays, so the splash is garrison ATK × talent 1.5.
  approx(lost(20000, e), 691 * 1.6 * 1.5, 1e-4, 'splash');
  const stun = e.findBuff('stun');
  assert.ok(stun, 'stun');
  approx(stun.duration ?? stun.timeLeft, 5, 1e-6, 'stun duration');

  const retreat = battle([op(1, ID.acrbot, 5, 0)]);
  const re = foe(retreat.battle, 9, 6, { atk: 0 });
  retreat.battle.on('battleStart', () => {
    const u = retreat.unit(1);
    u.atkCd = 999;
    assert.ok(open(u));
  });
  retreat.step();
  retreat.battle.retreat(retreat.unit(1));
  assert.equal(re.hp, 10000);
  assert.equal(re.findBuff('stun'), null);
});

test('acrbot elite blocked damage is 85% and S1 cleanses stun', () => {
  assert.equal(rec('acrbot').trait.bb.damage_scale, undefined);
  assert.equal(rec('acrbotE').trait.bb.damage_scale, 0.85);
  assert.equal(rec('acrbotE').stats.def, 619);
  assert.equal(rec('acrbot').stats.def, 504);
  const normal = battle([op(1, ID.acrbot, 5, 0)]);
  const ne = foe(normal.battle, 9, 5, { atk: 0 });
  normal.battle.on('battleStart', () => { normal.unit(1).atkCd = 999; });
  normal.step();
  const nu = normal.unit(1);
  assert.ok(nu.blocking.includes(ne));
  const nh = nu.hp;
  normal.battle.dealDamage({ source: ne, target: nu, amount: 1000, type: 'phys' });
  approx(lost(nh, nu), 1000 - 504, 1e-4, 'normal');

  const h = battle([op(1, ID.acrbotE, 5, 0)]);
  const e = foe(h.battle, 9, 5, { atk: 0 });
  h.battle.on('battleStart', () => { h.unit(1).atkCd = 999; });
  h.step();
  const u = h.unit(1);
  assert.ok(u.blocking.includes(e));
  const hp = u.hp;
  h.battle.dealDamage({ source: e, target: u, amount: 1000, type: 'phys' });
  approx(lost(hp, u), (1000 - 619) * 0.85, 1e-4, 'elite');

  const stun = battle([op(1, ID.acrbot, 5, 0)]);
  stun.battle.on('battleStart', () => { stun.unit(1).atkCd = 999; });
  stun.step();
  const bot = stun.unit(1);
  assert.equal(stun.battle.applyStatus(bot, 'stun', { duration: 5 }), true);
  assert.ok(bot.findBuff('stun'));
  assert.ok(open(bot));
  assert.equal(bot.findBuff('stun'), null);
  assert.equal(stun.battle.applyStatus(bot, 'stun', { duration: 5 }), false);
  assert.equal(bot.findBuff('stun'), null);
});

// ---------------------------------------------------------------------------------------------------------------

test('the ten operators fight for 60s without a sim error', () => {
  const cols = [5, 6, 7, 8, 9, 11, 12, 13, 14, 15];
  const ids = [ID.varkis, ID.quercu, ID.chnut, ID.meteo, ID.ju, ID.glassb, ID.pianst, ID.hbound, ID.fang2, ID.acrbot];
  const units = ids.map((id, i) => op(i + 1, id, cols[i], 0, 9 + (i % 4)));
  const h = battle(units, { timeLimit: 70 });
  foe(h.battle, 9, 6, { hp: 8000, atk: 50 });
  foe(h.battle, 12, 9, { hp: 8000, atk: 50 });
  h.run(60);
  assert.equal(h.battle.errorCount, 0, JSON.stringify(h.battle.errors));
  for (const u of h.battle.units) {
    if (!u.alive) continue;
    assert.ok(u.hp >= 0 && u.hp <= u.s.maxHp + 1e-6, `${u.defId} hp ${u.hp}/${u.s.maxHp}`);
  }
  h.invariants();
});
