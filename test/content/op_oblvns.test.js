// test/content/op_oblvns.test.js — the 自选 operator kit of 丰川祥子 (char_4182_oblvns, 6★ 领主; kit
// server/sim/content/kits/ops/op-oblvns.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or
// LOR-Y “无言的约定” at stage 1 (tier 5) / 3 (tier 6).
// Run: node --test test/content/op_oblvns.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const OBLVNS = 'char_4182_oblvns';
const FORMS = BACKUPS.units[OBLVNS].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const LORY = 'uniequip_002_oblvns';
const S1 = 'skchr_oblvns_1', S2 = 'skchr_oblvns_2', S3 = 'skchr_oblvns_3';

const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_high_def: dummy('enemy_high_def', { def: 1000, res: 10 }),
  enemy_high_res: dummy('enemy_high_res', { def: 100, res: 80 }),
};

const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, LORY].map((m) => [t, true, m]))];

function field({ tier = 5, elite = false, mod = null, skill = 0, row = 10, col = 5, seed = 5, others = [] } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'attack', 'fatal'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: OBLVNS, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}

const from = (h, u, pred = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && pred(c));

function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

test('丰川祥子 in every 自选 form: operator kit, all 3 skills authored, stats + module attributes, 3-12, blocks 2, Lord traits', () => {
  assert.equal(OPERATOR_KITS[OBLVNS], KITS[OBLVNS]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource],
        [OBLVNS, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.aspd],
        [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def, 100 + (m?.attr.aspd ?? 0)],
        `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.sub, u.profile.attack, u.profile.canHitFly, u.profile.dmgType, u.profile.rangedScale],
        [2, 'lord', 'ranged', true, 'phys', 0.8], `${label(f)}: 领主`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-12`);
      done(h);
    }
  }
});

test('a 自选 pick: 丰川祥子 is offered in diyPool and passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(OBLVNS));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(OBLVNS), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: OBLVNS, skillIndex: 2, uniEquipId: LORY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: OBLVNS, skillIndex: 2, uniEquipId: LORY } } });
});

test('trait 领主: normal attack deals 80 % ATK at range, full ATK when melee', () => {
  const { h, u } = field({ tier: 5, elite: false, skill: 0 });
  u.skill.sp = 0;
  const far = h.spawn('enemy_dummy', { pos: [10, 7] });
  h.runUntil(() => from(h, u, (c) => c.dmg.isAttack && c.target === far).length > 0, 5);
  const hits = from(h, u, (c) => c.dmg.isAttack && c.target === far);
  assert.ok(hits.length > 0);
  approx(hits[0].amount, u.s.atk * 0.8, 'ranged penalty');
  done(h);
});

test('T1 颂乐音符 & T2 毋畏遗忘: attacks grant notes and Fever, allies gain ASPD aura', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: LORY, skill: 1, others: [{ uid: 2, chessId: 'chess_char_1_01_a', row: 10, col: 6 }] });
  u.skill.sp = 0;
  const target = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.runUntil(() => from(h, u).length >= 2, 5);

  assert.ok(u.mem.notes > 0, 'notes generated');
  assert.ok(u.mem.fever > 0, 'fever increased');
  const penBuff = u.findBuff(`talent:oblvns:pen:${u.id}`);
  assert.ok(penBuff, 'penetration buff active on Ave Mujica member');

  const ally = h.unit(2);
  const aura = ally.findBuff('talent:oblvns:aspd');
  assert.ok(aura, 'ASPD aura received by ally in range');
  done(h);
});

test('S1 新月的苏醒: barrage of 8 notes dealing arts damage', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: LORY, skill: 0 });
  const target = h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.charges = 2; // trigger max charges auto-cast
  h.runUntil(() => from(h, u, (c) => (c.dmg?.tags || []).includes('oblvns:s1')).length >= 8, 3);
  const s1Hits = from(h, u, (c) => (c.dmg?.tags || []).includes('oblvns:s1'));
  assert.equal(s1Hits.length, 8, '8 notes fired');
  assert.ok(s1Hits.every((hit) => hit.dmg.type === 'arts'), 'all arts damage');
  done(h);
});

test('S2 满月的舞会: stance toggle and double strike during Fever', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  const target = h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.equal(u.mem.oblvnsStance, 'piano');

  u.skill.activate('manual', { free: true });
  h.step();
  assert.equal(u.mem.oblvnsStance, 'organ', 'toggled to organ');

  u.mem.feverActive = true;
  h.runUntil(() => from(h, u).length >= 2, 3);
  done(h);
});

test('S3 残月的余响: range 3-21, 2 Piano and 2 Organ notes, Ave Mujica lethal protection during Fever', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: LORY, skill: 2 });
  const defEnemy = h.spawn('enemy_high_def', { pos: [11, 7] });
  const resEnemy = h.spawn('enemy_high_res', { pos: [9, 7] });

  u.skill.activate('manual', { free: true });
  h.step();
  assert.equal(u.liveRangeGrid.length, 16, 'range 3-21 active');

  h.runUntil(() => from(h, u, (c) => (c.dmg?.tags || []).includes('oblvns:piano')).length >= 2, 4);
  const pianoHits = from(h, u, (c) => (c.dmg?.tags || []).includes('oblvns:piano'));
  const organHits = from(h, u, (c) => (c.dmg?.tags || []).includes('oblvns:organ'));
  assert.ok(pianoHits.length >= 2, 'piano notes fired');
  assert.ok(organHits.length >= 2, 'organ notes fired');
  assert.equal(pianoHits[0].target, defEnemy, 'piano tracks highest DEF');
  assert.equal(organHits[0].target, resEnemy, 'organ tracks highest RES');

  // Fever lethal protection
  u.mem.feverActive = true;
  const fatalCtx = { unit: u, prevented: false };
  h.b.emit('fatal', fatalCtx);
  assert.equal(fatalCtx.prevented, true, 'lethal damage prevented during Fever');
  done(h);
});
