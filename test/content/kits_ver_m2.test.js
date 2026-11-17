// Version kits (DESIGN §35.22.9): the 19 第一期 charId kits, the 35 borrowed 自选 kits, 泥岩's version SP and
// 异客's V2_1 module. The default data keeps the by-id kits (棋子 1_02 stays 角峰).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { KITS, officialKitKey, skillSpecSource } from '../../server/sim/content/index.js';
import { DIY_BORROW_CHARS, TIER_KIT_KEYS_BY_CHAR, VERSION_KITS } from '../../server/sim/content/kits/index.js';
import { makeBattle } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });
const load = (rel) => loadData(path.join(ROOT, rel), { log: QUIET });
const ACT1 = load('data/versions/act1autochess');
const V21 = load('data/versions/act2autochess-v2_1');
const V31 = load('data/versions/act3autochess-v3_1');
const TODAY = load('data');

const use = (t, data) => {
  setGameData(data);
  t.after(() => setGameData(null));
};

/** Normal `_a` (its own record: no baseId, or baseId is itself). Elite is that record's `goldenId`. */
function chessId(data, charId, elite) {
  const normal = Object.keys(data.chess).find((id) => {
    const rec = data.chess[id];
    return rec?.charId === charId && id.endsWith('_a') && (!rec.baseId || rec.baseId === id);
  });
  if (!normal) return null;
  if (!elite) return normal;
  const golden = data.chess[normal].goldenId;
  return data.chess[golden]?.charId === charId ? golden : null;
}

function poolHas(data, charId) {
  const diy = data.backups?.diy;
  if (!diy) return false;
  if ((diy.ownedPool ?? []).includes(charId)) return true;
  return Object.values(diy.prototypes ?? {}).some((list) => Array.isArray(list) && list.includes(charId));
}

/** First official version whose 自选 pool contains `charId` (银灰 is 第二期上半 only; the 10 规程 picks are V3_1 only). */
function diyHome(charId) {
  if (poolHas(ACT1, charId)) return ACT1;
  if (poolHas(V21, charId)) return V21;
  if (poolHas(V31, charId)) return V31;
  return null;
}

function numbersIn(obj, out = [], depth = 0) {
  if (obj == null || depth > 8) return out;
  if (typeof obj === 'number' && Number.isFinite(obj)) { out.push(obj); return out; }
  if (typeof obj !== 'object') return out;
  for (const v of Object.values(obj)) if (typeof v !== 'function') numbersIn(v, out, depth + 1);
  return out;
}

function hasBbNumber(spec, bb) {
  const got = numbersIn(spec);
  return Object.values(bb || {}).some((n) => typeof n === 'number' && n !== 0 && n !== 1
    && got.some((g) => Math.abs(g - n) < 1e-9));
}

/** The tier row whose shop-default skill is `id`, else the row ver-diy.js borrows first. */
function authorKey(charId, skillId) {
  if (charId === 'char_1026_gvial2') return skillId === 'skchr_gvial2_2' ? 'chess_char_5_18_a' : 'chess_char_4_23_a';
  if (charId === 'char_4146_nymph') return 'chess_char_5_22_a';
  return TIER_KIT_KEYS_BY_CHAR[charId][0];
}

function tierSpec(charId, skillId, def) {
  const key = authorKey(charId, skillId);
  const built = KITS[key](def.skill?.bb ?? {}, def.raw, def);
  if (built?.skills && Object.prototype.hasOwnProperty.call(built.skills, skillId) && built.skills[skillId]) return built.skills[skillId];
  if (built?.skill) return built.skill;
  return null;
}

function castBattle(data, unit) {
  return makeBattle({
    data: new DataSource(data), seed: 3, timeLimit: 20, autoFinish: false,
    units: [unit, { uid: 2, chessId: chessId(data, 'char_473_mberry', false), row: 9, col: 5, carryState: { hpPct: 0.4, sp: 0 } }],
    enemies: [{ key: 'enemy_1000_gopro_2', time: 0, pos: [10, 5] }],
  });
}

test('default data still runs 角峰 at chess_char_1_02; 第一期 runs 讯使', (t) => {
  use(t, null);
  const today = new DataSource(TODAY).getChess('chess_char_1_02_a');
  assert.equal(today.charId, 'char_199_yak');
  assert.equal(officialKitKey(today), 'chess_char_1_02_a');
  setGameData(ACT1);
  const ver = new DataSource(ACT1).getChess('chess_char_1_02_a');
  assert.equal(ver.charId, 'char_198_blackd');
  assert.equal(officialKitKey(ver), 'char_198_blackd');
});

for (const charId of Object.keys(VERSION_KITS)) {
  // Later seasons share VERSION_KITS. This file is the 第一期 set (those charIds exist in act1).
  if (!chessId(ACT1, charId, false)) continue;
  test(`第一期 ${charId}: both forms author every skill from the blackboard, and the shop skill casts`, (t) => {
    use(t, ACT1);
    const ds = new DataSource(ACT1);
    let sawNumber = false;
    for (const elite of [false, true]) {
      const id = chessId(ACT1, charId, elite);
      assert.ok(id, `${charId} ${elite ? 'elite' : 'normal'}`);
      const raw = ACT1.chess[id];
      for (let i = 0; i < raw.skills.length; i++) {
        const def = ds.getChess(id, { skillIndex: i });
        assert.equal(def.charId, charId);
        assert.equal(skillSpecSource(def), 'skills', `${id} skill ${i}`);
        const built = KITS[charId](def.skill.bb, def.raw, def);
        const spec = built.skills[def.skill.id];
        assert.ok(spec, `${id} skill ${i}: spec`);
        assert.equal(typeof spec.kind, 'string');
        if (spec.kind === 'duration' && def.skill.duration > 0) assert.equal(spec.duration, def.skill.duration);
        if (hasBbNumber(spec, def.skill.bb)) sawNumber = true;
      }
    }
    // 海蒂's scales live in the skill closures (鼓舞), checked on the shop cast below.
    assert.ok(sawNumber || charId === 'char_4045_heidi', `${charId}: a blackboard number is on a spec`);
    const shop = chessId(ACT1, charId, false);
    const h = castBattle(ACT1, { uid: 1, chessId: shop, row: 10, col: 4, carryState: { sp: 999 } });
    const u = h.unit(1);
    assert.ok(u, shop);
    const started = h.runUntil(() => u.skill.activations >= 1 || u.skill.active, 12);
    assert.ok(started, `${charId} shop skill did not start (kind ${u.skill.kind}, rule ${u.skill.rule})`);
    if (charId === 'char_4045_heidi') {
      const ally = h.unit(2);
      h.run(0.2);
      const buff = ally?.buffs?.find((b) => b.key === 'inspire:def');
      const scale = u.def.skill.bb.def;
      assert.ok(buff, '海蒂 S2 鼓舞');
      assert.ok(Math.abs(buff.data.val - u.s.def * scale) < 1e-6, `鼓舞 ${buff.data.val} vs def ${u.s.def} × ${scale}`);
    }
  });
}

for (const charId of DIY_BORROW_CHARS) {
  test(`自选 ${charId}: every skill matches its tier kit, and skill 0 casts`, (t) => {
    const data = diyHome(charId);
    assert.ok(data, `${charId}: in a version 自选 pool`);
    use(t, data);
    const ds = new DataSource(data);
    const slot = Object.keys(data.backups.diy.slots).find((id) => data.backups.diy.slots[id].tier === 6);
    assert.ok(slot, 'tier-6 自选 slot');
    let sawNumber = false;
    const probe = ds.getChess(slot, { diy: { charId, skillIndex: 0, uniEquipId: null } });
    assert.ok(probe, `${charId}: legal on the tier-6 slot`);
    const n = probe.raw.skills.length;
    for (const elite of [false, true]) {
      const id = elite ? data.backups.diy.slots[slot].goldenId : slot;
      for (let i = 0; i < n; i++) {
        const def = ds.getChess(id, { diy: { charId, skillIndex: i, uniEquipId: null } });
        assert.equal(skillSpecSource(def), 'skills', `${charId} ${id} skill ${i}`);
        assert.equal(officialKitKey(def), charId);
        const built = KITS[charId](def.skill.bb, def.raw, def);
        const spec = built.skills[def.skill.id];
        assert.ok(spec, `${charId} skill ${i}`);
        const direct = tierSpec(charId, def.skill.id, def);
        if (direct?.kind) assert.equal(spec.kind, direct.kind, `${charId} ${def.skill.id}`);
        if (hasBbNumber(spec, def.skill.bb)) sawNumber = true;
      }
    }
    // 琳琅诗怀雅's specs are `{ kind: 'passive' }` / `{ kind: 'toggle' }`. S1's heal scale stays in the install closure.
    if (charId === 'char_1033_swire2') {
      const i1 = probe.raw.skills.findIndex((s) => s.skillId === 'skchr_swire2_1');
      const s1 = ds.getChess(slot, { diy: { charId, skillIndex: i1, uniEquipId: null } });
      const scale = s1.skill.bb['attack@heal_scale'];
      const hv = makeBattle({
        data: ds, seed: 5, timeLimit: 20, autoFinish: false, hooks: ['heal'], captureNoisy: true,
        flags: { dpInit: 60, dpMax: 99 },
        units: [{ uid: 1, diy: { slot: 6, charId, skillIndex: i1, uniEquipId: null }, row: 10, col: 4 }],
      });
      hv.step();
      const op = hv.unit(1);
      assert.ok(op?.skill?.active, '琳琅 S1');
      op.hp = op.s.maxHp * 0.5;
      assert.ok((op.mem.coins ?? 0) >= 1, '琳琅 S1 coin');
      assert.ok(hv.runUntil(() => hv.hooksOf('heal').some((c) => c.source === op), 8), '琳琅 S1 heal');
      const heal = hv.hooksOf('heal').find((c) => c.source === op);
      assert.ok(Math.abs(heal.amount - op.s.atk * scale) < 1e-6, `heal ${heal.amount} vs atk ${op.s.atk} × ${scale}`);
      sawNumber = true;
    }
    // 伺夜's S3 spends `cost` every `interval` from the closure, not a field of the spec.
    if (charId === 'char_427_vigil') {
      const i3 = probe.raw.skills.findIndex((s) => s.skillId === 'skchr_vigil_3');
      const s3 = ds.getChess(slot, { diy: { charId, skillIndex: i3, uniEquipId: null } });
      const bb = s3.skill.bb;
      const hv = makeBattle({
        data: ds, seed: 5, timeLimit: 20, autoFinish: false,
        units: [{ uid: 1, diy: { slot: 6, charId, skillIndex: i3, uniEquipId: null }, row: 10, col: 4, carryState: { sp: 999 } }],
        enemies: [{ key: 'enemy_1000_gopro_2', time: 0, pos: [10, 6] }],
      });
      const op = hv.unit(1);
      assert.ok(hv.runUntil(() => op.skill.active, 8), '伺夜 S3');
      const startedAt = op.skill.lastStart;
      assert.ok(hv.runUntil(() => (op.mem.vigilDp ?? 0) >= 1, 8), '伺夜 S3 packet');
      assert.equal(op.mem.vigilDp, bb.cost);
      assert.ok(Math.abs(hv.b.time - startedAt - bb.interval) < 0.05, `packet at ${hv.b.time - startedAt}, interval ${bb.interval}`);
      sawNumber = true;
    }
    assert.ok(sawNumber, `${charId}: a blackboard number is on a borrowed spec`);
    const allyId = chessId(data, 'char_473_mberry', false);
    const units = [{ uid: 1, diy: { slot: 6, charId, skillIndex: 0, uniEquipId: null }, row: 10, col: 4, carryState: { sp: 999 } }];
    if (allyId) units.push({ uid: 2, chessId: allyId, row: 9, col: 5, carryState: { hpPct: 0.4, sp: 0 } });
    const h = makeBattle({
      data: ds, seed: 5, timeLimit: 20, autoFinish: false,
      units,
      enemies: [{ key: 'enemy_1000_gopro_2', time: 0, pos: [10, 5] }],
    });
    const u = h.unit(1);
    assert.ok(u, `${charId} deployed`);
    assert.equal(u.def.charId, charId);
    const started = h.runUntil(() => u.skill.activations >= 1 || u.skill.active, 12);
    assert.ok(started, `${charId} skill 0 did not start (kind ${u.skill?.kind}, rule ${u.skill?.rule}, id ${u.skill?.id})`);
  });
}

test('versioned today keeps shop 星熊 on the tier kit; a 第一期 自选 piece uses the charId kit', (t) => {
  const versioned = { ...TODAY, config: { ...TODAY.config, version: ACT1.config.version } };
  use(t, versioned);
  const shop = new DataSource(versioned).getChess('chess_char_4_17_a');
  assert.equal(shop.charId, 'char_136_hsguma');
  assert.equal(officialKitKey(shop), 'chess_char_4_17_a');
  setGameData(ACT1);
  const ds = new DataSource(ACT1);
  const slot = Object.keys(ACT1.backups.diy.slots).find((id) => ACT1.backups.diy.slots[id].tier === 6);
  const diy = ds.getChess(slot, { diy: { charId: 'char_136_hsguma', skillIndex: 1, uniEquipId: null } });
  assert.ok(diy, '星熊 自选');
  assert.equal(officialKitKey(diy), 'char_136_hsguma');
});

test('泥岩: a broken 沃土予身 layer returns 1 SP on 第一期 elite and none on today\'s record', (t) => {
  const talentSp = (data, id) => {
    setGameData(data);
    const h = makeBattle({
      data: new DataSource(data), seed: 1, timeLimit: 8, autoFinish: false, captureNoisy: true,
      units: [{ uid: 1, chessId: id, row: 10, col: 4, carryState: { sp: 0 } }],
    });
    h.run(0.05);
    const u = h.unit(1);
    assert.ok(u?.findBuff('mudrok:layers'), `${id} deployed with a layer`);
    const before = h.hooksOf('spGain').filter((c) => c.reason === 'talent').length;
    h.b.dealDamage(null, u, { amount: 40, type: 'true' });
    const after = h.hooksOf('spGain').filter((c) => c.reason === 'talent').length;
    return after - before;
  };
  t.after(() => setGameData(null));
  assert.equal(talentSp(ACT1, 'chess_char_6_16_b'), 1);
  assert.equal(talentSp(TODAY, 'chess_char_4_18_b'), 0);
});

test('异客 RA-A: V2_1 module 004 multiplies by 1.2, today\'s full potential by 1.25', (t) => {
  const dealt = (data) => {
    setGameData(data);
    const h = makeBattle({
      data: new DataSource(data), seed: 1, timeLimit: 8, autoFinish: false,
      units: [{ uid: 1, chessId: 'chess_char_6_05_b', row: 10, col: 4, moduleId: 'uniequip_004_pasngr', carryState: { sp: 0 } }],
    });
    h.run(0.05);
    const u = h.unit(1);
    assert.equal(u.def.module?.id ?? u.def.raw?.module?.id, 'uniequip_004_pasngr');
    const e = h.spawn('enemy_1000_gopro_2', { pos: [10, 6] });
    assert.ok(e?.alive, 'enemy');
    const before = e.hp;
    h.b.dealDamage(u, e, { amount: 100, type: 'true', isAttack: true });
    return before - e.hp;
  };
  t.after(() => setGameData(null));
  const v21 = dealt(V21);
  const today = dealt(TODAY);
  assert.ok(Math.abs(v21 - 120) < 1e-6, `V2_1 dealt ${v21}`);
  assert.ok(Math.abs(today - 125) < 1e-6, `today dealt ${today}`);
});
