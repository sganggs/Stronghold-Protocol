// test/content/op_cgbird.test.js — the 自选 operator kit of 夜莺 (char_179_cgbird, 6★ 群愈师; kit
// server/sim/content/kits/ops/op-cgbird.js) and her summon 幻影 (token_10003_cgbird_bird), fielded the production way (a DIY
// slot + its `diy` pick, simdata getDiy; the 幻影 as a board token piece of hers) in every form: tiers 5 / 6, normal (E2 Lv1,
// skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module, RIN-X “封闭的希望” or RIN-Y “莺歌” at stage 1
// (tier 5) / 3 (tier 6). Every number is read back from data/backups.json; the fidelity checklist of kits/README.md.
// Run: node --test test/content/op_cgbird.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks, diyRecord } from '../../shared/diy.js';
import { attackRangeGrid } from '../../shared/loadoutRecord.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const CGBIRD = 'char_179_cgbird';
const PHANTOM = 'token_10003_cgbird_bird';
const FORMS = BACKUPS.units[CGBIRD].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const RINX = 'uniequip_002_cgbird', RINY = 'uniequip_003_cgbird';
const S1 = 'skcom_heal_up[3]', S2 = 'skchr_cgbird_2', S3 = 'skchr_cgbird_3';
const statusOf = (tier, elite) => (elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0');
const formOf = (tier, elite) => FORMS[statusOf(tier, elite)];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const tokenVariant = (tier, elite, mod) => {
  const v = BACKUPS.tokens[PHANTOM].variants[`${CGBIRD}@${statusOf(tier, elite)}`];
  return mod && v.byModule?.[mod] ? { ...v, ...v.byModule[mod] } : v;
};
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const ENEMIES = { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, mass: 0 }) };
const ALLIES = { test_melee_a: chessRec({ id: 'test_melee_a', profession: 'WARRIOR', stats: { maxHp: 10000, def: 100, res: 10, atk: 0 }, skill: null }) };
const FORMS_ALL = [[5, false, null], [6, false, null], ...[5, 6].flatMap((t) => [null, RINX, RINY].map((m) => [t, true, m]))];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/**
 * 夜莺 as uid 1 on the 高台 tile (11,2) facing RIGHT — her y-2: rows 10–12, cols 1–4; RIN-X adds (11,5); 圣域's y-4 adds
 * (11,5) and (9,1)–(9,3) —, allies (melee, no skill) at (11,3) uid 2, (10,3) uid 3, (12,3) uid 4, (10,4) uid 5 (all in
 * y-2), (11,5) uid 6 (RIN-X / y-4 only), (9,3) uid 7 (y-4 only), (11,8) uid 8 (outside); `phantom` = a board 幻影 of hers.
 */
function field({ tier = 5, elite = false, mod = null, skill = 0, seed = 5, phantom = null, dp = 0 } = {}) {
  const ally = (uid, row, col) => ({ uid, chessId: 'test_melee_a', row, col });
  const h = makeBattle({
    defs: { enemies: ENEMIES, chess: ALLIES }, timeLimit: 900, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999, dpInit: dp }, hooks: ['damaged', 'heal', 'attack', 'skillStart', 'skillEnd', 'death', 'deploy'], captureNoisy: true,
    units: [
      { uid: 1, diy: { slot: SLOT[tier], charId: CGBIRD, skillIndex: skill, uniEquipId: mod }, elite, row: 11, col: 2 },
      ally(2, 11, 3), ally(3, 10, 3), ally(4, 12, 3), ally(5, 10, 4), ally(6, 11, 5), ally(7, 9, 3), ally(8, 11, 8),
      ...(phantom ? [{ uid: 9, kind: 'token', tokenId: PHANTOM, ownerUid: 1, row: phantom[0], col: phantom[1] }] : []),
    ],
  });
  h.step();
  const u = h.unit(1);
  return { h, u, a: (uid) => h.unit(uid), bird: phantom ? h.b.allyUnits.find((t) => t.kind === 'token' && t.uid === 9) : null };
}
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const rangeOf = (tier, elite, mod) => {
  const rec = diyRecord(SLOT[tier], { charId: CGBIRD, skillIndex: 0, uniEquipId: mod }, { elite, data: { chess: CHESS, backups: BACKUPS } });
  return attackRangeGrid(rec);
};

test('夜莺 in every 自选 form: her operator kit (all three skills authored), the form\'s stats + module attributes, y-2 (RIN-X: its grid), 3 heals (RIN-Y: 4), no 特质', () => {
  assert.equal(OPERATOR_KITS[CGBIRD], KITS[CGBIRD]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [CGBIRD, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res, u.base.aspd],
        [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def, form.stats.res + (m?.attr.res ?? 0), form.stats.aspd + (m?.attr.aspd ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.profile.dmgType, u.profile.heal?.mode, u.profile.heal?.count, u.profile.attack], ['heal', 'multi', elite && mod === RINY ? 4 : 3, 'ranged'], `${label(f)}: 群愈师`);
      const rinx = elite && mod === RINX;
      const mg = rinx ? modOf(tier, RINX).talentChanges.find((t) => t.talentIndex === -1).rangeGrid : form.rangeGrid;
      assert.deepEqual(u.liveRangeGrid, mg, `${label(f)}: range`);
      assert.deepEqual(u.liveRangeGrid, rangeOf(tier, elite, mod), `${label(f)}: the range the card draws (attackRangeGrid)`);
      assert.equal(mg.length, rinx ? 13 : 12, `${label(f)}: y-2 (+ [0,3])`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      assert.ok(!u.s.flags.liftoff && !u.s.flags.camou && !u.s.flags.stealth && !u.s.flags.untargetable, `${label(f)}: enemies target her`);
      done(h);
    }
  }
  assert.deepEqual([modOf(5, RINX).attr, modOf(6, RINX).attr, modOf(5, RINY).attr, modOf(6, RINY).attr], [{ atk: 40, res: 5 }, { atk: 65, res: 5 }, { maxHp: 160, aspd: 5 }, { maxHp: 220, aspd: 7 }]);
});

test('a 自选 pick: 夜莺 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(CGBIRD));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(CGBIRD), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: CGBIRD, skillIndex: 1, uniEquipId: RINY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: CGBIRD, skillIndex: 1, uniEquipId: RINY } } });
});

test('群愈师 heals 3 allies at once; RIN-Y “莺歌” 4 (stages 1 and 3)', () => {
  for (const f of [[5, false, null], [5, true, RINY], [6, true, RINY], [6, true, RINX]]) {
    const [tier, elite, mod] = f;
    const { h, u, a } = field({ tier, elite, mod, skill: 0 });
    for (const uid of [2, 3, 4, 5]) a(uid).hp = 1000 + uid;
    const n0 = h.hooksOf('attack').length;
    assert.ok(h.runUntil(() => h.hooksOf('attack').slice(n0).some((c) => c.attacker === u), 6), label(f));
    const at = h.hooksOf('attack').slice(n0).find((c) => c.attacker === u);
    assert.equal(new Set(at.targets.map((t) => t.uid)).size, elite && mod === RINY ? 4 : 3, `${label(f)}: heals per attack`);
    done(h);
  }
});

test('S1 治疗强化·γ型 (MANUAL, data DEFAULT): 30 s of ATK +55 % / +70 %, cast on an injured ally in range; 35 / 32 SP from 20', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u, a } = field({ tier, elite, mod: elite ? RINX : null, skill: 0 });
    assert.deepEqual([u.skill.rule, u.skill.spCost, sk.initSp, sk.duration, sk.bb.atk], ['DEFAULT', elite ? 32 : 35, 20, 30, elite ? 0.7 : 0.55], `T${tier}`);
    u.skill.gainSp(999);
    a(8).hp = 100; // outside her range: no cast
    h.run(2);
    assert.equal(u.skill.activations, 0, `T${tier}: nobody injured in range`);
    a(2).hp = 100;
    assert.ok(h.runUntil(() => u.skill.active, 5), `T${tier}: cast`);
    approx(u.skill.timeLeft, 30, `T${tier}: 30 s`, 0.01);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `T${tier}: ATK`);
    h.runUntil(() => !u.skill.active, 35);
    approx(u.s.atk, u.base.atk, `T${tier}: back`);
    done(h);
  }
});

test('S2 法术护盾 (AUTO, data DEFAULT, 2 charges): the next heal gives each of its targets a 屏障 of 50 % / 60 % ATK for 3.5 / 4 s that absorbs arts damage only, and RES +10 / +15 while it holds', () => {
  for (const f of [[5, false, null], [6, true, RINY]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S2);
    const { h, u, a } = field({ tier, elite, mod, skill: 1 });
    assert.deepEqual([u.skill.rule, u.skill.maxCharges, u.skill.kind, sk.spCost, sk.bb.atk_scale, sk.bb.duration, sk.bb.magic_resistance],
      ['DEFAULT', 2, 'charges', 10, elite ? 0.6 : 0.5, elite ? 4 : 3.5, elite ? 15 : 10], label(f));
    u.skill.gainSp(999);
    h.run(2);
    assert.equal(u.skill.activations, 0, `${label(f)}: nobody injured, no cast`);
    const hurt = [2, 3, 4, 5].map(a);
    hurt.forEach((x, i) => { x.hp = 1000 + i; });
    assert.ok(h.runUntil(() => u.skill.activations === 1 && hurt.some((x) => x.findBuff('cgbird:barrier')), 5), `${label(f)}: cast with a heal`);
    const got = hurt.filter((x) => x.findBuff('cgbird:barrier'));
    const first = got.map((x) => x.findBuff('cgbird:barrier'));
    assert.equal(got.length, elite && mod === RINY ? 4 : 3, `${label(f)}: every target of that heal`);
    for (const x of got) {
      const b = x.findBuff('cgbird:barrier');
      approx(b.shield, u.s.atk * sk.bb.atk_scale, `${label(f)}: ${sk.bb.atk_scale * 100} % ATK`);
      approx(b.duration, sk.bb.duration, `${label(f)}: ${sk.bb.duration} s`);
      assert.equal(b.shieldType, 'arts', `${label(f)}: arts only`);
      assert.deepEqual(x.findBuff('cgbird:barrierRes')?.mods, { resFlat: sk.bb.magic_resistance }, `${label(f)}: RES bonus`);
    }
    const x = got[0], b = x.findBuff('cgbird:barrier');
    const hp0 = x.hp, sh0 = b.shield;
    h.b.dealDamage(null, x, { amount: 50, type: 'phys', canDodge: false });
    assert.ok(x.hp < hp0, `${label(f)}: physical damage passes`);
    approx(b.shield, sh0, `${label(f)}: the barrier untouched by physical damage`);
    h.b.dealDamage(null, x, { amount: 20, type: 'true' });
    approx(b.shield, sh0, `${label(f)}: … and by true damage`);
    const hp1 = x.hp;
    h.b.dealDamage(null, x, { amount: 30, type: 'arts', canDodge: false });
    approx(x.hp, hp1, `${label(f)}: arts damage absorbed`);
    assert.ok(b.shield < sh0, `${label(f)}: the barrier took it`);
    h.b.dealDamage(null, x, { amount: 1e6, type: 'arts', canDodge: false, resIgnorePct: 1 });
    assert.equal(x.findBuff('cgbird:barrier'), null, `${label(f)}: broken`);
    assert.equal(x.findBuff('cgbird:barrierRes'), null, `${label(f)}: the RES bonus goes with it`);
    h.run(sk.bb.duration + 0.1);
    got.forEach((y, i) => assert.ok(!y.buffs.includes(first[i]), `${label(f)}: the first heal's barrier expired`));
    done(h);
  }
});

test('S3 圣域 (MANUAL, data ACTIVE_RANGE on y-4): cast for an injured ally inside y-4 only; 60 s, range y-4, ATK +40 % / +50 %, allies in it RES ×1.9 / ×2.05 and 15 % / 20 % arts dodge; all back after', () => {
  for (const f of [[5, false, null], [6, true, null], [6, true, RINX]]) {
    const [tier, elite, mod] = f;
    const sk = skillOf(tier, elite, S3);
    const { h, u, a } = field({ tier, elite, mod, skill: 2 });
    assert.deepEqual([u.skill.rule, sk.duration, sk.spCost, sk.rangeId, sk.bb.atk, sk.bb.magic_resistance, sk.bb.prob],
      ['ACTIVE_RANGE', 60, 120, 'y-4', elite ? 0.5 : 0.4, elite ? 1.05 : 0.9, elite ? 0.2 : 0.15], label(f));
    assert.deepEqual(sk.trigger.customRangeGrid, sk.rangeGrid, `${label(f)}: the trigger grid is its running range`);
    const base = u.liveRangeGrid;
    u.skill.gainSp(999);
    a(8).hp = 100; // outside y-4
    h.run(2);
    assert.equal(u.skill.activations, 0, `${label(f)}: no injured ally in y-4`);
    a(7).hp = 100; // (9,3): y-4 only
    assert.ok(h.runUntil(() => u.skill.active, 2), `${label(f)}: cast for the ally 2 rows down`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `${label(f)}: y-4 while it runs`);
    h.run(0.3);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `${label(f)}: ATK`);
    for (const uid of [2, 6, 7]) assert.deepEqual(a(uid).findBuff('skill:cgbird:sanctuary')?.mods, { resMul: 1 + sk.bb.magic_resistance, dodgeArts: sk.bb.prob }, `${label(f)}: uid ${uid} in y-4`);
    assert.deepEqual(u.findBuff('skill:cgbird:sanctuary')?.mods, { resMul: 1 + sk.bb.magic_resistance, dodgeArts: sk.bb.prob }, `${label(f)}: herself`);
    assert.equal(a(8).findBuff('skill:cgbird:sanctuary'), null, `${label(f)}: outside`);
    // RES = (10 + 17 talent) × (1 + v) on an ally (base 10)
    approx(a(7).s.res, Math.min(100, (10 + 17) * (1 + sk.bb.magic_resistance)), `${label(f)}: RES`);
    approx(a(7).s.dodgeArts, sk.bb.prob, `${label(f)}: arts dodge`);
    u.skill.end('test');
    h.run(0.3);
    assert.deepEqual(u.liveRangeGrid, base, `${label(f)}: own range back`);
    for (const uid of [2, 6, 7]) assert.equal(a(uid).findBuff('skill:cgbird:sanctuary'), null, `${label(f)}: uid ${uid} after`);
    done(h);
  }
});

test('T1 白恶魔的庇护: allies in her range RES +17 (herself too, not outside); RIN-X: its range tile too, stage 3 also 受到的治疗效果 ×1.05', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u, a } = field({ tier, elite, mod, skill: 0 });
    h.run(0.3);
    const rinx = elite && mod === RINX, x3 = rinx && tier === 6;
    const want = x3 ? { resFlat: 17, healingTakenMul: 1.05 } : { resFlat: 17 };
    for (const uid of [2, 3, 4, 5]) assert.deepEqual(a(uid).findBuff('talent:cgbird:res')?.mods, want, `${label(f)}: uid ${uid}`);
    assert.deepEqual(u.findBuff('talent:cgbird:res')?.mods, want, `${label(f)}: herself`);
    assert.deepEqual(a(6).findBuff('talent:cgbird:res')?.mods ?? null, rinx ? want : null, `${label(f)}: (11,5) — the RIN-X tile`);
    for (const uid of [7, 8]) assert.equal(a(uid).findBuff('talent:cgbird:res'), null, `${label(f)}: uid ${uid} outside`);
    approx(a(2).s.res, 10 + 17, `${label(f)}: RES`);
    if (x3) {
      a(2).hp = 1000;
      const n0 = h.hooksOf('heal').length;
      assert.ok(h.runUntil(() => h.hooksOf('heal').slice(n0).some((c) => c.target === a(2) && c.source === u), 6));
      const c = h.hooksOf('heal').slice(n0).find((x) => x.target === a(2) && x.source === u);
      approx(c.amount, u.s.atk * 1.05, `${label(f)}: healing received ×1.05`);
    }
    done(h);
  }
});

test('幻影 (T2): the token of her form — HP 3000 / 4989, RES 75, blocks nothing, taunt 1, no attack; 30 % physical dodge (RIN-Y stage 3: 40 %), loses 3 % of its max HP each second', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u, bird } = field({ tier, elite, mod, skill: 0, phantom: [12, 8] }); // outside her range: no heals on it
    const v = tokenVariant(tier, elite, mod);
    assert.ok(bird && bird.alive, `${label(f)}: deployed with the board`);
    assert.equal(bird.ownerUnit, u, `${label(f)}: hers`);
    assert.deepEqual([bird.base.maxHp, bird.base.res, bird.s.blockCnt, bird.s.taunt, bird.profile.noAttack], [v.stats.maxHp, 75, 0, 1, true], `${label(f)}: stats`);
    assert.equal(v.stats.maxHp, elite ? 4989 : 3000);
    const y3 = elite && tier === 6 && mod === RINY;
    approx(bird.s.dodgePhys, y3 ? 0.4 : 0.3, `${label(f)}: physical dodge`);
    assert.equal(bird.s.dodgeArts, 0, `${label(f)}: no arts dodge`);
    const hp0 = bird.hp;
    h.run(3.02);
    approx(hp0 - bird.hp, 3 * 0.03 * bird.s.maxHp, `${label(f)}: 3 × 3 % in 3 s`, 1e-6);
    assert.ok(h.hooksOf('damaged').some((c) => c.target === bird && c.dmg?.tags?.includes('hpLoss')), `${label(f)}: a 流失`);
    // enemies: a 30 % dodge on physical hits, none on arts
    let dodged = 0;
    for (let i = 0; i < 400; i++) if (h.b.dealDamage(null, bird, { amount: 1, type: 'phys' }) === 0) dodged++;
    assert.ok(Math.abs(dodged / 400 - (y3 ? 0.4 : 0.3)) < 0.08, `${label(f)}: ${dodged} / 400 dodged`);
    done(h);
  }
});

test('幻影: each 夜莺 deployment adds 2 (RIN-Y stage 3: 3) to her stock, at most 3; a fallen 幻影 comes back on its tile 20 s later using one and paying 5 DP; it stays when she leaves', () => {
  for (const f of [[5, true, RINY], [6, true, RINY], [6, false, null]]) {
    const [tier, elite, mod] = f;
    const { h, u, bird } = field({ tier, elite, mod, skill: 0, phantom: [12, 8], dp: 50 });
    const cnt = elite && tier === 6 && mod === RINY ? 3 : 2;
    assert.equal(u.mem.phantomStock, cnt, `${label(f)}: her deployment gave ${cnt}; the board piece used none`);
    const tile = [bird.tileR, bird.tileC];
    h.b.kill(bird, null);
    assert.ok(!bird.alive && !bird.removed, `${label(f)}: fallen, kept`);
    h.run(19.5);
    assert.ok(!bird.alive, `${label(f)}: not before its 20 s`);
    const dp0 = h.b.players[0].dp;
    assert.ok(h.runUntil(() => bird.alive, 1), `${label(f)}: back after 20 s`);
    assert.deepEqual([bird.tileR, bird.tileC], tile, `${label(f)}: on its own tile`);
    assert.equal(u.mem.phantomStock, cnt - 1, `${label(f)}: one used`);
    approx(dp0 - h.b.players[0].dp, 5, `${label(f)}: its DP cost`);
    approx(bird.hp, bird.s.maxHp, `${label(f)}: full HP`, 0.05);
    approx(bird.s.dodgePhys, tokenVariant(tier, elite, mod).talents.at(-1).bb.prob, `${label(f)}: its talent again`);
    // she leaves: the deployed 幻影 stays; she comes back: +cnt (cap 3)
    h.b.retreat(u);
    h.step();
    assert.ok(bird.alive, `${label(f)}: stays when she leaves`);
    h.b.redeploy(u, { free: true });
    assert.equal(u.mem.phantomStock, Math.min(3, cnt - 1 + cnt), `${label(f)}: +${cnt}, at most 3`);
    // none held: a fallen 幻影 waits
    u.mem.phantomStock = 0;
    h.b.kill(bird, null);
    h.run(30);
    assert.ok(!bird.alive, `${label(f)}: no 幻影 held, none comes`);
    u.mem.phantomStock = 1;
    assert.ok(h.runUntil(() => bird.alive, 1), `${label(f)}: comes as soon as one is held`);
    assert.equal(u.mem.phantomStock, 0);
    done(h);
  }
});

test('幻影 without DP waits for it; the 幻影 holds 禁疗 (PRTS 幻影 备注 "持有禁疗。", §37.201): 夜莺 neither heals it nor gives it her S2 barrier, an HP regen still restores it', () => {
  const { h, u, bird } = field({ tier: 6, elite: true, mod: RINY, skill: 1, phantom: [12, 4], dp: 0 });
  // the drain makes it injured, inside her range — still no patient of hers
  u.skill.gainSp(999);
  h.run(6);
  assert.ok(bird.alive && bird.hp < bird.s.maxHp, 'injured by its own drain');
  assert.equal(bird.findBuff('cgbird:barrier'), null, 'no S2 barrier on the 幻影');
  assert.equal(h.hooksOf('heal').filter((c) => c.target === bird && c.amount > 0).length, 0, 'never healed');
  assert.equal(h.b.heal(u, bird, 100), 0, 'a direct heal restores nothing (禁疗)');
  // 生命回复速度 is no 治疗 (PRTS 禁疗 "增减生命回复速度…的效果不会被识别为治疗类能力"): it outruns the 3 % drain
  const hp0 = bird.hp;
  h.b.addBuff(bird, { key: 'test:regen', duration: 3, mods: { hpRegen: 1000 } });
  h.run(2);
  assert.ok(bird.hp > hp0, `regenerates (${hp0.toFixed(0)} → ${bird.hp.toFixed(0)})`);
  h.b.kill(bird, null);
  h.run(25);
  assert.ok(!bird.alive, 'no DP: still down');
  h.b.players[0].dp = 5;
  assert.ok(h.runUntil(() => bird.alive, 1), 'back once the DP is there');
  approx(h.b.players[0].dp, 0, 'paid 5');
  done(h);
});
