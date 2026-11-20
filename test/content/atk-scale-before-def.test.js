// 「攻击力提升至 / 当次攻击的攻击力」is an attack-scale on dmg.amount (before DEF).
// A physical hit into DEF 80 separates that reading from a post-mitigation dmg.mul.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData, loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { mitigate } from '../../server/sim/attack/calculation.js';
import { install as installItems } from '../../server/sim/content/items/battle.js';
import { chessRec, enemyRec, makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const DEFAULT = getData({ log: QUIET });
const ACT1 = loadData(path.join(ROOT, 'data/versions/act1autochess'), { log: QUIET });
const REG = loadData(path.join(ROOT, 'data/versions/act3autochess-v3_1'), { log: QUIET });

const DEF = 80;
const AMT = 100;

function chessId(data, charId, elite = false) {
  const normal = Object.keys(data.chess).find((id) => {
    const rec = data.chess[id];
    return rec?.charId === charId && id.endsWith('_a') && (!rec.baseId || rec.baseId === id);
  });
  if (!normal) throw new Error(`no chess for ${charId}`);
  if (!elite) return normal;
  const golden = data.chess[normal].goldenId;
  if (!golden || data.chess[golden]?.charId !== charId) throw new Error(`no elite for ${charId}`);
  return golden;
}

function skillIndex(data, id, skillId) {
  const s = (data.chess[id].skills || []).find((x) => x && x.skillId === skillId);
  if (!s || s.index == null) throw new Error(`${id} has no ${skillId}`);
  return s.index;
}

function namedTalent(raw, i) {
  const list = (raw?.talents ?? []).filter((t) => t && t.index !== -1);
  return list[i]?.bb ?? {};
}

function use(t, data) {
  setGameData(data);
  t.after(() => setGameData(null));
}

function forceProc(h) {
  const orig = h.b.rng;
  h.b.rng = Object.assign(() => 0, orig, { chance() { return true; } });
}

/** HP removed by one physical attack of `AMT` (the two readings differ only against DEF). */
function strike(h, source, enemy) {
  const before = enemy.hp;
  h.b.dealDamage(source, enemy, { amount: AMT, type: 'phys', isAttack: true });
  return before - enemy.hp;
}

function assertPreDef(label, dealt, scale) {
  assert.equal(typeof scale, 'number', `${label}: scale`);
  assert.ok(scale > 1, `${label}: scale ${scale} does not separate the readings`);
  const want = mitigate(AMT * scale, 'phys', { def: DEF });
  const wrong = mitigate(AMT, 'phys', { def: DEF }) * scale;
  assert.ok(Math.abs(want - wrong) > 1, `${label}: pre ${want} vs post ${wrong}`);
  assert.ok(Math.abs(dealt - want) < 1e-6, `${label}: dealt ${dealt}, pre-DEF ${want}, post-mitigation ${wrong}`);
}

function armorRec(opts = {}) {
  // enemyRec hardcodes tags: []. Defs are frozen, so the drone tag has to be on the record.
  const rec = enemyRec({ key: 'armor', hp: 1e6, def: DEF, speed: 0, atk: 0, ...(opts.enemy || {}) });
  if (opts.tags) rec.tags = opts.tags;
  return rec;
}

function field(data, id, opts = {}) {
  const rec = data.chess[id];
  const src = {
    ...data,
    chess: { ...data.chess, [id]: { ...rec, garrisonIds: [] } },
    enemies: {
      ...data.enemies,
      armor: armorRec(opts),
    },
  };
  const h = makeBattle({
    data: new DataSource(src),
    seed: 1, autoFinish: false, timeLimit: 12,
    units: [{
      uid: 1, chessId: id, row: 10, col: 4,
      ...(opts.skillIndex == null ? {} : { skillIndex: opts.skillIndex }),
    }],
  });
  h.step();
  const unit = h.unit(1);
  const enemy = h.spawn('armor', { pos: [10, 5] });
  return { h, unit, enemy };
}

function finish(h) {
  assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []);
}

test('寒芒克洛丝 中的: atk_scale is this attack\'s ATK, before DEF', (t) => {
  use(t, DEFAULT);
  const id = 'chess_char_4_06_a';
  const { h, unit, enemy } = field(DEFAULT, id);
  forceProc(h);
  const scale = unit.def.talents[0].bb.atk_scale;
  assertPreDef('kroos2', strike(h, unit, enemy), scale);
  finish(h);
});

test('风笛 精密填弹: the boosted attack\'s ATK is raised before DEF', (t) => {
  use(t, DEFAULT);
  const { h, unit, enemy } = field(DEFAULT, 'chess_char_4_07_a');
  unit.mem.bpBoost = true;
  const scale = unit.def.talents[0].bb.atk_scale;
  assertPreDef('bpipe', strike(h, unit, enemy), scale);
  finish(h);
});

test('歌蕾蒂娅 弱肉强食: ATK vs light enemies is raised before DEF', (t) => {
  use(t, DEFAULT);
  const { h, unit, enemy } = field(DEFAULT, 'chess_char_4_12_a');
  assert.ok(enemy.s.massLevel <= unit.def.talents[1].bb.value);
  const scale = unit.def.talents[1].bb.atk_scale;
  assertPreDef('glady', strike(h, unit, enemy), scale);
  finish(h);
});

test('佩佩 module: splash-count ATK scale is applied before DEF', (t) => {
  use(t, DEFAULT);
  const { h, unit, enemy } = field(DEFAULT, 'chess_char_6_06_b');
  unit.mem.pepeBoost = true;
  const scale = unit.def.traitBb.atk_scale_e;
  assertPreDef('pepe', strike(h, unit, enemy), scale);
  finish(h);
});

test('瑕光 仁慈: ATK against a sleeper is raised before DEF', (t) => {
  use(t, DEFAULT);
  const { h, unit, enemy } = field(DEFAULT, 'chess_char_3_12_a');
  assert.equal(unit.profile.hitSleep, true);
  enemy.s.flags.sleep = true;
  const scale = unit.def.talents[1].bb.atk_scale;
  assertPreDef('blemsh', strike(h, unit, enemy), scale);
  finish(h);
});

test('伺夜 S2: the wolf\'s gifted attack ATK is raised before DEF', (t) => {
  use(t, DEFAULT);
  const id = 'chess_char_3_19_a';
  const { h, unit, enemy } = field(DEFAULT, id, { skillIndex: skillIndex(DEFAULT, id, 'skchr_vigil_2') });
  assert.equal(unit.skill.id, 'skchr_vigil_2');
  const wolf = unit.trait.reinforcement;
  assert.ok(wolf?.alive, 'the pack is on the field');
  const scale = unit.skill.bb['vigil_wolf_s_2.atk_scale'];
  wolf.mem.vigilGiftOn = { scale, paid: false };
  assertPreDef('vigil', strike(h, wolf, enemy), scale);
  finish(h);
});

test('百炼嘉维尔 t4: ATK against a blocked enemy is raised before DEF', (t) => {
  use(t, DEFAULT);
  const { h, unit, enemy } = field(DEFAULT, 'chess_char_4_23_b');
  enemy.blockedBy = unit;
  const scale = unit.def.traitBb.atk_scale;
  assertPreDef('gvial2', strike(h, unit, enemy), scale);
  finish(h);
});

test('芳汀 结构分解: ATK against a drone is raised before DEF', (t) => {
  use(t, ACT1);
  const id = chessId(ACT1, 'char_271_spikes', false);
  const { h, unit, enemy } = field(ACT1, id, { tags: ['drone'] });
  assert.equal(unit.def.charId, 'char_271_spikes');
  assert.ok(enemy.def.tags.includes('drone'));
  const scale = namedTalent(unit.def.raw, 0).atk_scale;
  assertPreDef('spikes', strike(h, unit, enemy), scale);
  finish(h);
});

test('槐琥 红眉咏春: the proc raises this attack\'s ATK before DEF', (t) => {
  use(t, ACT1);
  const id = chessId(ACT1, 'char_243_waaifu', false);
  const { h, unit, enemy } = field(ACT1, id);
  assert.equal(unit.def.charId, 'char_243_waaifu');
  forceProc(h);
  const scale = namedTalent(unit.def.raw, 0).atk_scale;
  assertPreDef('waaifu', strike(h, unit, enemy), scale);
  finish(h);
});

test('暴行 elite: ATK against a blocked enemy is raised before DEF', (t) => {
  use(t, ACT1);
  const id = chessId(ACT1, 'char_230_savage', true);
  const { h, unit, enemy } = field(ACT1, id);
  assert.equal(unit.def.charId, 'char_230_savage');
  enemy.blockedBy = unit;
  const scale = unit.def.raw.trait?.bb?.atk_scale;
  assertPreDef('savage', strike(h, unit, enemy), scale);
  finish(h);
});

test('狮蝎 隐匿的杀手: the reveal hit\'s ATK bonus is applied before DEF', (t) => {
  use(t, ACT1);
  const id = chessId(ACT1, 'char_215_mantic', false);
  const { h, unit, enemy } = field(ACT1, id);
  assert.equal(unit.def.charId, 'char_215_mantic');
  unit.mem.manticReveal = true;
  const scale = 1 + namedTalent(unit.def.raw, 0).atk;
  assertPreDef('mantic', strike(h, unit, enemy), scale);
  finish(h);
});

test('极光 S2: a frozen target takes atk_scale × base ATK, before DEF', (t) => {
  use(t, ACT1);
  const id = chessId(ACT1, 'char_422_aurora', false);
  const { h, unit, enemy } = field(ACT1, id, { skillIndex: skillIndex(ACT1, id, 'skchr_aurora_2') });
  assert.equal(unit.def.charId, 'char_422_aurora');
  assert.equal(unit.skill.activate('test', { free: true }), true);
  assert.equal(unit.skill.active, true);
  enemy.s.flags.freeze = true;
  const bb = unit.def.raw.skills.find((s) => s.skillId === 'skchr_aurora_2').bb;
  const scale = bb.atk_scale / (1 + bb.atk);
  assertPreDef('aurora', strike(h, unit, enemy), scale);
  finish(h);
});

test('乌有 出其不意: the ambush attack\'s ATK is raised before DEF', (t) => {
  use(t, REG);
  const id = chessId(REG, 'char_455_nothin', false);
  const { h, unit, enemy } = field(REG, id);
  assert.equal(unit.def.charId, 'char_455_nothin');
  unit.mem.nothinAmbush = true;
  const scale = namedTalent(unit.def.raw, 0).atk_scale;
  assertPreDef('nothin', strike(h, unit, enemy), scale);
  finish(h);
});

test('战线推进者: the first attack after a block raises ATK before DEF', (t) => {
  use(t, REG);
  const src = {
    ...REG,
    enemies: {
      ...REG.enemies,
      armor: enemyRec({ key: 'armor', hp: 1e6, def: DEF, speed: 0, atk: 0 }),
    },
  };
  const h = makeBattle({
    data: new DataSource(src), seed: 1, autoFinish: false, timeLimit: 8,
    units: [{ uid: 1, chessId: 'chess_char_1_01_a', row: 10, col: 4 }],
  });
  h.step();
  const chg = h.spawn('enemy_1406_chghmr', { pos: [10, 6] });
  const enemy = h.spawn('armor', { pos: [10, 5] });
  assert.ok(chg.mem.ab?.list?.length, '战线推进者 kit');
  h.b.emit('blocked', { blocker: h.unit(1), enemy: chg });
  const sheltr = chg.mem.ab.t['DmgUp.sheltr_atk_scale'];
  const atk = chg.mem.ab.sk.PowerHit.bb.atk;
  assertPreDef('chghmr', strike(h, chg, enemy), sheltr * (1 + atk));
  finish(h);
});

function itemScale(id) {
  const rec = REG.items[id];
  const buff = (rec?.buffs || []).find((b) => (b.bbStr && b.bbStr.key) === 'act3autochess_equip_acarm150_global_buff');
  if (!buff) throw new Error(`${id} has no acarm150 buff`);
  return buff.bb.atk_scale;
}

function itemField(itemId) {
  const h = makeBattle({
    content: 'lite', extraContent: [installItems],
    seed: 1, autoFinish: false, timeLimit: 8,
    defs: {
      chess: { t_op: chessRec({ id: 't_op', profession: 'SNIPER', stats: { atk: 500, def: 0, maxHp: 2000 } }) },
      enemies: { armor: enemyRec({ key: 'armor', hp: 1e6, def: DEF, speed: 0, atk: 0 }) },
    },
    units: [{ uid: 1, chessId: 't_op', row: 10, col: 4, items: [itemId] }],
  });
  h.step();
  forceProc(h);
  return { h, unit: h.unit(1), enemy: h.spawn('armor', { pos: [10, 5] }) };
}

test('动能单手弩: the proc raises that attack\'s ATK before DEF', (t) => {
  use(t, REG);
  const id = 'chess_item_4_13_e_a';
  const { h, unit, enemy } = itemField(id);
  assertPreDef('acarm150', strike(h, unit, enemy), itemScale(id));
  finish(h);
});

test('动能轰击弩: the shared acarm150 proc raises ATK before DEF', (t) => {
  use(t, REG);
  const id = 'chess_item_6_08_e_a';
  const { h, unit, enemy } = itemField(id);
  assertPreDef('acarm150 fused', strike(h, unit, enemy), itemScale(id));
  finish(h);
});
