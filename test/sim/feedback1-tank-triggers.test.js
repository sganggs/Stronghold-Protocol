// The owner's decision after 0.1.1's community feedback (2026-10-03, "反馈的人太多了"; GitHub issue #4, PR #12): six 重装
// skills cast with an enemy in range — the basic strategy, DEFAULT — instead of the official 下半 TANK class row's
// TAKE_DAMAGE. A deliberate, documented deviation (DESIGN §21.29): 深巡 S2 行动能力剥夺, 雷蛇 S2 反击电弧, 号角 S2 暴风号令
// and S3 终极防线, 灰毫 S1 攻击力强化·γ型 and S2 专注轰击. It lives in the data (tools/build-data.mjs TRIGGER_DEVIATIONS,
// keyed per chess: 灰毫 S1 is the generic skcom_atk_up[3] other chess carry too), `rawRule` keeps the official TAKE_DAMAGE.
// Every other MANUAL 重装 skill — 深巡 S1 侵袭破坏应对 among them — still waits for a hit. One kit carries its own
// DEFAULT line since 2026-10-18 (the owner's decision, KIT_DEFAULT below): 瑕光 S3 先贤化身 opens with an attackable
// target in range, at full HP too — "能攻击到人时就会开技能"; the data keeps the official row in `rawRule`.
// One more since 2026-10-04 (the owner's decision after GitHub issue #32 item 1, DESIGN §22.10): 余 S2 厚礼上宾 casts with an
// enemy on its own 技能范围 x-1 — SKILL_RANGE, customRangeGrid its range (his attack range is his own tile, so the basic
// strategy could not see an enemy he can pull); `rawRule` keeps TAKE_DAMAGE.
// And since 0.2.0 (the owner's decision of 2026-10-05): 深巡 S2's running range 3-2 strictly contains her 2-2, so the
// owner's ACTIVE_RANGE rule applies on top of her DEFAULT deviation — she casts with an enemy in the 3-2 (rule
// ACTIVE_RANGE, customRangeGrid the 3-2, rawRule still TAKE_DAMAGE; test/sim/feedback5-active-range.test.js).
//
// The battle check is real: the chess records of data/chess.json with their kits, the stage 战场#01(下半)
// (act2autochess_m01), a real enemy (萨卡兹枯朽前锋, melee, 0.8 tiles/s) walking the lane from the gate (9,10) to the
// objective; the operator stands on (9,5) facing the gate with its skill fully charged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { bodyInRange } from '../../server/sim/body.js';
import { absoluteRangeKeys } from '../../server/sim/targeting.js';

const CHESS = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
const ds = getDefaultSource();

/** [normal chess id, skill id] — both records (normal + elite) of each chess. */
const DEVIATED = [
  ['chess_char_1_04_a', 'skchr_udflow_2'],   // 深巡 S2 行动能力剥夺
  ['chess_char_1_20_a', 'skchr_liskam_2'],   // 雷蛇 S2 反击电弧
  ['chess_char_5_08_a', 'skchr_horn_2'],     // 号角 S2 暴风号令
  ['chess_char_5_08_a', 'skchr_horn_3'],     // 号角 S3 终极防线
  ['chess_char_2_18_a', 'skcom_atk_up[3]'],  // 灰毫 S1 攻击力强化·γ型
  ['chess_char_2_18_a', 'skchr_ashlok_2'],   // 灰毫 S2 专注轰击
];
/** The deviated skill whose running range strictly contains the own one: ACTIVE_RANGE on top (0.2.0). */
const ACTIVE = new Set(['skchr_udflow_2']);
/** 余 S2 厚礼上宾: SKILL_RANGE on its own x-1 (DESIGN §22.10). */
const SKILL_RANGE_DEVIATED = [['chess_char_6_03_a', 'skchr_yu_2']];
/**
 * A kit's own deviation, not a data one (the owner's decision of 2026-10-18): 瑕光 S3 先贤化身 opens with an attackable
 * target in range — the basic strategy DEFAULT — at full HP too ("能攻击到人时就会开技能"), not only after a hit. It is
 * `trigger: 'DEFAULT'` in `kits/ops/chess_char_3_12-blemsh.js`, so the data keeps the official 重装 row (TAKE_DAMAGE)
 * for traceability and the kit's spec overrides it. Cases: test/sim/blemsh-s3-trigger.test.js.
 */
const KIT_DEFAULT = [['chess_char_3_12_a', 'skchr_blemsh_3']];
const isKitDefault = (c, skillId) => KIT_DEFAULT.some(([id, s]) => id === c.baseId && s === skillId);
const both = (normalId) => [normalId, CHESS[normalId].goldenId];
const isDeviated = (c, skillId) => [...DEVIATED, ...SKILL_RANGE_DEVIATED].some(([id, s]) => id === c.baseId && s === skillId);
const ENEMY = 'enemy_1422_lrsldr';

/**
 * One real battle: `chessId` with skill `skillId` on (9,5) facing RIGHT, SP full; one 萨卡兹枯朽前锋 on the lane from
 * `spawnAt` s. Returns the first cast (time, reason, whether an enemy stood on the unit's initial range then, whether
 * the unit blocked it) and the time the unit first took damage (any `damaged` event: what TAKE_DAMAGE listens to).
 */
function firstCast(chessId, skillId, { spawnAt = 0, seconds = 40 } = {}) {
  const index = CHESS[chessId].skills.find((s) => s.skillId === skillId).index;
  const h = makeBattle({
    stageId: 'act2autochess_m01', seed: 3, timeLimit: 120, autoFinish: false,
    units: [{ chessId, row: 9, col: 5, dir: 'RIGHT', skillIndex: index, carryState: { sp: 999 } }],
    enemies: [{ key: ENEMY, route: 0, time: spawnAt }],
  });
  const u = h.unit(chessId);
  assert.equal(u.skill.id, skillId, `${chessId} runs ${skillId}`);
  const out = { rule: u.skill.rule, cast: null, reason: null, enemyInRange: false, enemyInSkillRange: false, blocking: false, hurt: null };
  h.b.on('damaged', (ctx) => { if (ctx.target === u && out.hurt == null) out.hurt = h.b.time; }, { priority: 1000 });
  h.b.on('skillStart', (ctx) => {
    if (ctx.unit !== u || out.cast != null) return;
    out.cast = h.b.time;
    out.reason = ctx.reason;
    const keys = new Set(u.baseRangeKeys || u.rangeKeys);
    // by the 0.1 collider, the engine's range test since 0.3.0
    out.enemyInRange = h.b.enemies.some((e) => e.alive && e.deployed && bodyInRange(e, keys));
    const sk = u.skill.triggerGrid ? new Set(absoluteRangeKeys(u.skill.triggerGrid, u.tileR, u.tileC, u.dir, 0)) : null;
    out.enemyInSkillRange = !!sk && h.b.enemies.some((e) => e.alive && e.deployed && bodyInRange(e, sk));
    out.blocking = u.blocking.length > 0;
  }, { priority: 1000 });
  h.runUntil(() => out.cast != null && out.hurt != null, seconds);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  return out;
}

test('data: the six deviated 重装 skills are DEFAULT (深巡 S2: ACTIVE_RANGE on its 3-2) and 余 S2 is SKILL_RANGE on its x-1, on the normal and the elite record, rawRule the official TAKE_DAMAGE', () => {
  let n = 0;
  for (const [normalId, skillId] of DEVIATED) {
    for (const id of both(normalId)) {
      const s = CHESS[id].skills.find((x) => x.skillId === skillId);
      assert.ok(s, `${id} ${skillId}`);
      assert.equal(CHESS[id].profession, 'TANK');
      const want = ACTIVE.has(skillId) ? { rule: 'ACTIVE_RANGE', rawRule: 'TAKE_DAMAGE', customRangeGrid: s.rangeGrid } : { rule: 'DEFAULT', rawRule: 'TAKE_DAMAGE', customRangeGrid: null };
      assert.deepEqual(s.trigger, want, `${id} ${skillId}`);
      // the sim's loadout def carries the data rule
      assert.equal(ds.getChess(id, { skillIndex: s.index }).skill.trigger.rule, want.rule, `${id} ${skillId} loadout def`);
      n++;
    }
  }
  assert.equal(n, 12);
  for (const [normalId, skillId] of SKILL_RANGE_DEVIATED) {
    for (const id of both(normalId)) {
      const s = CHESS[id].skills.find((x) => x.skillId === skillId);
      assert.equal(CHESS[id].profession, 'TANK');
      assert.ok(s.rangeGrid?.length, `${id} ${skillId}: a 技能范围 of its own`);
      assert.deepEqual(s.trigger, { rule: 'SKILL_RANGE', rawRule: 'TAKE_DAMAGE', customRangeGrid: s.rangeGrid }, `${id} ${skillId}`);
      const def = ds.getChess(id, { skillIndex: s.index });
      assert.equal(def.skill.trigger.rule, 'SKILL_RANGE', `${id} ${skillId} loadout def`);
      assert.deepEqual(def.skill.trigger.grid, s.rangeGrid, `${id} ${skillId}: the trigger grid is its x-1`);
    }
  }
  // nothing else changed: every other MANUAL 重装 skill keeps the row (深巡 S1 included), and the generic
  // skcom_atk_up[3] keeps each other carrier's own rule (the deviation is keyed per chess, never per skill id)
  for (const c of Object.values(CHESS)) {
    for (const s of c.skills || []) {
      if (isDeviated(c, s.skillId)) continue;
      if (s.trigger.rawRule === 'TAKE_DAMAGE') assert.equal(s.trigger.rule, 'TAKE_DAMAGE', `${c.chessId} ${s.skillId}`);
      if (c.profession === 'TANK' && s.skillType === 'MANUAL' && s.trigger.rawRule !== 'CUSTOM_RANGE_SEARCH_ENEMY') assert.equal(s.trigger.rule, 'TAKE_DAMAGE', `${c.chessId} ${s.skillId}`);
    }
  }
  for (const id of both('chess_char_1_04_a')) assert.equal(CHESS[id].skills.find((s) => s.skillId === 'skchr_udflow_1').trigger.rule, 'TAKE_DAMAGE', `${id} 深巡 S1`);
  const others = Object.values(CHESS).filter((c) => c.baseId !== 'chess_char_2_18_a' && c.skills?.some((s) => s.skillId === 'skcom_atk_up[3]'));
  assert.ok(others.length >= 10, 'skcom_atk_up[3] is shared');
  for (const c of others) assert.deepEqual(c.skills.find((s) => s.skillId === 'skcom_atk_up[3]').trigger, { rule: 'DEFAULT', rawRule: 'DEFAULT', customRangeGrid: null }, c.chessId);
});

test('PR #12\'s kit line agrees with the data: 雷蛇 S2\'s spec says DEFAULT, the other deviated skills (深巡 S2 since 0.2.0) read the data', async () => {
  const { KITS } = await import('../../server/sim/content/index.js');
  for (const [normalId, skillId] of [...DEVIATED, ...SKILL_RANGE_DEVIATED]) {
    for (const id of both(normalId)) {
      const rec = CHESS[id];
      const s = rec.skills.find((x) => x.skillId === skillId);
      const def = ds.getChess(id, { skillIndex: s.index });
      const kit = KITS[rec.baseId]?.(def.skill.bb, def.raw, def);
      const spec = s.isDefault ? kit?.skill : kit?.skills?.[skillId];
      const specRule = typeof spec?.trigger === 'string' ? spec.trigger : spec?.trigger?.rule;
      assert.ok(specRule == null || specRule === s.trigger.rule, `${id} ${skillId}: kit ${specRule} vs data ${s.trigger.rule}`);
      if (skillId === 'skchr_liskam_2') assert.equal(specRule, 'DEFAULT', `${id} ${skillId}: PR #12's trigger line`);
      if (skillId === 'skchr_udflow_2') assert.equal(specRule, undefined, `${id} ${skillId}: reads the data's ACTIVE_RANGE (PR #12's line would keep the 2-2)`);
    }
  }
});

test('real battle: each deviated skill casts with an enemy in range before anything hits the operator (normal + elite; 深巡 S2 in its 3-2)', () => {
  for (const [normalId, skillId] of DEVIATED) {
    for (const id of both(normalId)) {
      const r = firstCast(id, skillId, { spawnAt: 3 });
      const where = `${id} ${skillId}: ${JSON.stringify(r)}`;
      const rule = ACTIVE.has(skillId) ? 'ACTIVE_RANGE' : 'DEFAULT';
      assert.equal(r.rule, rule, where);
      assert.ok(r.cast != null, `never cast — ${where}`);
      assert.ok(r.cast >= 3, `no cast before an enemy is on the field — ${where}`);
      assert.equal(r.reason, rule, where);
      if (ACTIVE.has(skillId)) assert.ok(r.enemyInSkillRange && !r.enemyInRange, `an enemy on the 3-2, not yet on the 2-2, at the cast — ${where}`);
      else assert.ok(r.enemyInRange, `an enemy on its initial range at the cast — ${where}`);
      assert.ok(r.hurt == null || r.hurt > r.cast, `cast before the first hit — ${where}`);
    }
  }
});

test('real battle: 余 S2 casts once the walker steps onto its x-1, before anything hits him (normal + elite)', () => {
  for (const [normalId, skillId] of SKILL_RANGE_DEVIATED) {
    for (const id of both(normalId)) {
      const r = firstCast(id, skillId, { spawnAt: 3 });
      const where = `${id} ${skillId}: ${JSON.stringify(r)}`;
      assert.equal(r.rule, 'SKILL_RANGE', where);
      assert.ok(r.cast != null && r.cast >= 3, `cast once an enemy is on the field — ${where}`);
      assert.equal(r.reason, 'SKILL_RANGE', where);
      // (skillStart comes after the cast's own teleport: the walker already stands on his tile then, but he has not
      // blocked anyone yet — it was pulled in from x-1, it did not walk in)
      assert.ok(r.enemyInSkillRange && !r.blocking, `an enemy on x-1, pulled in rather than walked in — ${where}`);
      assert.ok(r.hurt == null || r.hurt > r.cast, `cast before the first hit — ${where}`);
    }
  }
});

test('real battle: 深巡 S1 and every other MANUAL 重装 skill still wait for a hit (TAKE_DAMAGE); 瑕光 S3 is the kit\'s DEFAULT', () => {
  let n = 0;
  for (const c of Object.values(CHESS)) {
    if (c.profession !== 'TANK' || c.isDiy) continue;
    for (const s of c.skills) {
      if (s.skillType !== 'MANUAL' || s.trigger.rule !== 'TAKE_DAMAGE') continue;
      if (isKitDefault(c, s.skillId)) continue; // 瑕光 S3: the kit's trigger: 'DEFAULT' (KIT_DEFAULT above)
      const r = firstCast(c.chessId, s.skillId);
      const where = `${c.chessId} ${c.name} ${s.skillId}: ${JSON.stringify(r)}`;
      assert.equal(r.rule, 'TAKE_DAMAGE', where);
      assert.ok(r.hurt != null && r.cast != null, `hit and cast — ${where}`);
      assert.equal(r.reason, 'TAKE_DAMAGE', where);
      assert.equal(r.cast, r.hurt, `cast by the first hit, not before — ${where}`);
      n++;
    }
  }
  assert.ok(n >= 38, `${n} TAKE_DAMAGE records checked`);
  // the kit's deviation: she casts with an enemy in range at full HP, before anything hits her
  for (const [normalId, skillId] of KIT_DEFAULT) {
    for (const id of both(normalId)) {
      const r = firstCast(id, skillId, { spawnAt: 3 });
      const where = `${id} ${skillId}: ${JSON.stringify(r)}`;
      assert.equal(r.rule, 'DEFAULT', where);
      assert.ok(r.cast != null && r.cast >= 3, `cast with an enemy in range — ${where}`);
      assert.equal(r.reason, 'DEFAULT', where);
      // an attackable target: an enemy on her range tiles, or the enemy she blocks (its block radius is off her 1-1 tile)
      assert.ok(r.enemyInRange || r.blocking, `an attackable target at the cast — ${where}`);
      assert.ok(r.hurt == null || r.hurt > r.cast, `cast before the first hit — ${where}`);
    }
  }
  const udflowS1 = firstCast('chess_char_1_04_a', 'skchr_udflow_1');
  assert.ok(udflowS1.cast > 10, `深巡 S1 waits for the enemy to reach and hit her: ${JSON.stringify(udflowS1)}`);
});
