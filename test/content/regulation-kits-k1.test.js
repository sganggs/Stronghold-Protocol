// K1 regression checks for the 规程-only Tier 1 / Tier 2 operator kits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { enemyRec, makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const REG = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: QUIET });

function armoredBattle(chessId, opts = {}) {
  const { enemy: enemyOpts = {}, skillIndex, ...battleOpts } = opts;
  const data = new DataSource({
    ...REG,
    enemies: { ...REG.enemies, k1_armored: enemyRec({ key: 'k1_armored', hp: 1e6, def: 80, speed: 0, atk: 0, ...enemyOpts }) },
  });
  return makeBattle({
    data, seed: 1, autoFinish: false, timeLimit: 10,
    ...battleOpts,
    units: [{ uid: 1, chessId, ...(skillIndex == null ? {} : { skillIndex }), row: 10, col: 4 }],
  });
}

function attackWithFlatMitigation(h, unit, opts = {}) {
  const enemy = h.spawn('k1_armored', { pos: [10, 5], ...opts });
  enemy.hp = enemy.s.maxHp * 0.5;
  const before = enemy.hp;
  h.b.dealDamage(unit, enemy, { amount: 100, type: 'phys', isAttack: true });
  return { enemy, dealt: before - enemy.hp };
}

test('规程 褐果 S1: 200% element recovery multiplies the 50% trait ratio, then the ground talent', (t) => {
  setGameData(REG);
  t.after(() => setGameData(null));
  const h = makeBattle({
    data: new DataSource(REG), seed: 1, autoFinish: false, timeLimit: 10,
    units: [
      { uid: 1, chessId: 'chess_char_1_15_a', row: 10, col: 4 },
      { uid: 2, chessId: 'chess_char_1_05_a', row: 10, col: 5 },
    ],
  });
  h.step();
  const chnut = h.unit(1);
  const ally = h.unit(2);
  assert.equal(chnut.def.charId, 'char_4041_chnut');
  assert.equal(chnut.kit.skillSource, 'skills');
  assert.equal(chnut.skill.id, 'skchr_chnut_1');

  ally.elem.burn = 900;
  ally.elem.neural = 900;
  assert.ok(chnut.skill.gainSp(chnut.skill.spCost, 'test') > 0);
  assert.equal(chnut.skill.activate('test'), true);

  const talentScale = chnut.def.raw.talents.find((x) => x.index !== -1).bb.ep_heal_scale;
  const expected = chnut.s.atk * 0.5 * chnut.skill.bb.trait_scale * talentScale;
  assert.ok(Math.abs((900 - ally.elem.burn) - expected) < 1e-6, 'burn recovery uses the trait ratio');
  assert.ok(Math.abs((900 - ally.elem.neural) - expected) < 1e-6, 'neural recovery uses the trait ratio');
  assert.deepEqual(h.b.errors, []);
});

test('规程 褐果 module S1: 200% recovery multiplies the module trait 60% and module talent', (t) => {
  setGameData(REG);
  t.after(() => setGameData(null));
  const h = makeBattle({
    data: new DataSource(REG), seed: 1, autoFinish: false, timeLimit: 10,
    units: [
      { uid: 1, chessId: 'chess_char_1_15_b', row: 10, col: 4 },
      { uid: 2, chessId: 'chess_char_1_05_a', row: 10, col: 5 },
    ],
  });
  h.step();
  const chnut = h.unit(1);
  const ally = h.unit(2);
  ally.elem.burn = 900;
  assert.equal(chnut.def.raw.trait.bb.ep_heal_ratio, 0.6);
  assert.ok(chnut.skill.gainSp(chnut.skill.spCost, 'test') > 0);
  assert.equal(chnut.skill.activate('test'), true);
  const talentScale = chnut.def.raw.talents.find((x) => x.index !== -1).bb.ep_heal_scale;
  const expected = chnut.s.atk * 0.6 * chnut.skill.bb.trait_scale * talentScale;
  assert.ok(Math.abs((900 - ally.elem.burn) - expected) < 1e-6);
  assert.deepEqual(h.b.errors, []);
});

test('规程 摆渡人 talent: ATK raised to talent_atk_scale before enemy DEF', (t) => {
  setGameData(REG);
  t.after(() => setGameData(null));
  const h = armoredBattle('chess_char_1_10_a');
  h.step();
  const varkis = h.unit(1);
  const scale = varkis.def.raw.talents.find((x) => x.index !== -1).bb.talent_atk_scale;
  const { enemy, dealt } = attackWithFlatMitigation(h, varkis);
  const expected = Math.max(100 * scale - enemy.s.def, 5);
  assert.ok(Math.abs(dealt - expected) < 1e-6, `expected pre-DEF attack scale ${expected}, got ${dealt}`);
  assert.deepEqual(h.b.errors, []);
});

test('规程 云迹 talent: airborne ATK scale is applied before enemy DEF', (t) => {
  setGameData(REG);
  t.after(() => setGameData(null));
  const h = armoredBattle('chess_char_2_11_a', { skillIndex: 0 });
  h.step();
  const ctrail = h.unit(1);
  assert.equal(ctrail.s.flags.liftoff, true, 'S1 deploy effect has taken off');
  const scale = ctrail.def.raw.talents.find((x) => x.index !== -1).bb.atk_scale;
  const { enemy, dealt } = attackWithFlatMitigation(h, ctrail);
  const expected = Math.max(100 * scale - enemy.s.def, 5);
  assert.ok(Math.abs(dealt - expected) < 1e-6, `expected pre-DEF attack scale ${expected}, got ${dealt}`);
  assert.deepEqual(h.b.errors, []);
});

test('规程 矩 module talent: ATK raised to atk_scale against weight 3 before enemy DEF', (t) => {
  setGameData(REG);
  t.after(() => setGameData(null));
  const h = armoredBattle('chess_char_2_18_b', { enemy: { mass: 3 } });
  h.step();
  const ju = h.unit(1);
  const scale = ju.def.raw.talents.find((x) => x.index !== -1).bb.atk_scale;
  const { enemy, dealt } = attackWithFlatMitigation(h, ju);
  const expected = Math.max(100 * scale - enemy.s.def, 5);
  assert.ok(Math.abs(dealt - expected) < 1e-6, `expected pre-DEF attack scale ${expected}, got ${dealt}`);
  assert.deepEqual(h.b.errors, []);
});

test('规程 渡桥 S1 blast is skill damage', (t) => {
  setGameData(REG);
  t.after(() => setGameData(null));
  const h = armoredBattle('chess_char_2_17_a', { skillIndex: 0 });
  h.step();
  const mitm = h.unit(1);
  const car = mitm.mem.mitmCar;
  assert.ok(car?.alive && car.deployed, 'the tactical car is deployed');
  const target = h.spawn('k1_armored', { pos: [car.tileR + 1, car.tileC] });
  h.step();
  assert.ok(mitm.skill.gainSp(mitm.skill.spCost, 'test') > 0);
  const hits = [];
  h.b.on('hit', ({ source, target: hit, dmg }) => {
    if (source === mitm && hit === target) hits.push(dmg);
  });
  assert.equal(mitm.skill.activate('test'), true);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].isSkill, true);
  assert.deepEqual(h.b.errors, []);
});

test('规程 复奏 S2 direct and tick damage are skill damage', (t) => {
  setGameData(REG);
  t.after(() => setGameData(null));
  const h = armoredBattle('chess_char_2_07_a', { skillIndex: 1 });
  h.step();
  const liesel = h.unit(1);
  const target = h.spawn('k1_armored', { pos: [10, 5] });
  h.step();
  assert.ok(liesel.skill.gainSp(liesel.skill.spCost, 'test') > 0);
  const hits = [];
  h.b.on('hit', ({ source, target: hit, dmg }) => {
    if (source === liesel && hit === target) hits.push(dmg);
  });
  assert.equal(liesel.skill.activate('test'), true);
  assert.ok(hits.length > 0, 'S2 cast damages its selected target');
  assert.ok(hits.every((dmg) => dmg.isSkill), 'S2 cast and DoT are skill damage');
  h.run(1.05);
  assert.ok(hits.some((dmg) => dmg.tags.includes('liesel:dot')), 'S2 applies a skill damage tick');
  assert.deepEqual(h.b.errors, []);
});
