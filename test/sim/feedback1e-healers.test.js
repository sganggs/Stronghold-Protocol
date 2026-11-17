// Community feedback after the 0.1.0 release, batch 5 (feedback1e), workstream WQ — report E2:
//   "走炎盟约的时候，如果是那种会到处跑的BOSS，被医疗阻挡之后，医疗不奶人了，会输出BOSS而且如果是那种强力击类型的技能也会在BOSS
//    身上打出正确数值的伤害" — and the user: "也看下其他的奶，不同的盟约会不会也有相同问题".
// Official (PRTS 卫戍协议/帮助 §作战阶段 技能操作, the note of the basic strategy): "对于医疗干员（咒愈师分支除外），攻击目标为
// 需要治疗的单位"; PRTS 仇恨 §仇恨过滤器: a medic's normal heal selects with HP_RATIO_NOT_FULL_ASC ("排除所有满生命值单位…
// 典型使用者：各类医疗干员的普通治疗"); PRTS 选择器: the blocked-first selector (BlockedOrAdvancedSelector) belongs to the
// units that attack what they block — a medic's selector picks allies. So a medic standing on a melee tile that blocks
// an enemy keeps healing and never strikes it; the user's playtest #6 rule "阻挡了就一定要能打到" (DESIGN §20.3) is for
// the units whose attack hits enemies (咒愈师 included: "攻击造成法术伤害").
// Verified on the real sim: NOT reproduced. Every healer of the pool (医师 / 群愈师 / 疗养师 / 链愈师 / 行医, the map
// characters, normal and elite, every skill — each skill made ready while the healer blocks, so it is cast then) blocking
// an enemy keeps healing and deals no damage from its normal attack or its skills: under every bond (as a member), with
// every equipment item, and on the 20 boss / hidden fields, where healers block the roaming 卢西恩 and its 不祥幻影
// (act2 h07_05) and a patrolling 碎铳之簧 once its shield is down (h08_02); the other leaders and parts cannot be blocked
// (自缚 / 无法被阻挡, the 剑 / 锤 anchored, 余音 only by block ≥ 2). The only damage a pure healer deals is a bond's own
// effect by its text (卡西米尔: "阻挡敌人时每2秒对周围敌人造成120%攻击力真实伤害", members of every class). These tests lock
// that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const PURE = new Set(['physician', 'ringhealer', 'healer', 'chainhealer', 'wandermedic']);
const pool = (hp) => ({ hp, maxHp: hp, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } });
const waves = () => JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
/** A bond's own effect on its members by its text (not the unit's attack): 卡西米尔's pulse while blocking. */
const bondEffect = (c) => !c.dmg?.isAttack && (c.dmg?.tags || []).includes('bond:kazimierz');
/** 卢西恩 and its 不祥幻影 — the boss that roams the field (patrol) and can be blocked. */
const LUCIEN = /^enemy_201[67]_csph/;

// =====================================================================================================================
// the reported case

test('E2 (not reproduced): 录武官 blocking 卢西恩 on the real 炎 boss round keeps healing and never hits it — normal attack or 触类旁通', REAL, () => {
  const tpl = waves().act2autochess_h07_05;
  for (const sfx of ['_a', '_b']) {
    for (const skillIndex of [0, 1]) {
      const g = (id) => id.replace(/_a$/, sfx);
      // nine distinct 炎 operators (炎 at tier 3: 炎佑 ×2), 录武官 on the lower lane's melee tile of the boss field
      // (board (9,4) → boss (2,4)), where the patrolling 卢西恩 walks into her
      const units = [
        { chessId: g('chess_char_5_23_a'), row: 9, col: 4, dir: 'RIGHT', skillIndex },
        { chessId: g('chess_char_6_03_a'), row: 12, col: 6 }, { chessId: g('chess_char_4_17_a'), row: 12, col: 7 },
        { chessId: g('chess_char_3_03_a'), row: 12, col: 5 }, { chessId: g('chess_char_6_15_a'), row: 9, col: 8 },
        { chessId: g('chess_char_1_03_a'), row: 10, col: 5 }, { chessId: g('chess_char_2_04_a'), row: 11, col: 5 },
        { chessId: g('chess_char_5_12_a'), row: 11, col: 7 }, { chessId: g('chess_char_5_03_a'), row: 10, col: 7 },
      ];
      const h = makeBattle({ kind: 'boss', stageId: 'act2autochess_m01', waveTemplate: tpl, sharedBoss: pool(3e6), seed: 9, units,
        bonds: { yanShip: { count: 9, active: true, tier: 3, layers: 120 } }, autoFinish: false, captureNoisy: true,
        hooks: ['damaged', 'attack', 'blocked', 'skillStart'], setup(b) { b.enemyOverrides = tpl.overrides; } });
      const M = h.unit(units[0].chessId);
      const boss = () => M.blocking.some((e) => LUCIEN.test(e.defId));
      let healsBlocking = 0, othersBlocking = 0, topped = false, skillOnBoss = 0;
      h.b.on('heal', (c) => { if (c.source === M && M.blocking.length && c.amount > 0) { healsBlocking++; if (c.target !== M) othersBlocking++; } });
      h.b.on('attack', (c) => { if (c.attacker === M && c.isSkill && boss()) skillOnBoss++; });
      h.b.on('skillStart', (c) => { if (c.unit === M && boss()) skillOnBoss++; });
      for (let i = 0; i < 120 * 30; i++) {
        h.step();
        // the skill becomes ready while she holds 卢西恩 / its 不祥幻影: the report's 强力击 moment
        if (!topped && boss()) { topped = true; M.skill.gainSp(M.skill.spCost * M.skill.maxCharges, 'init', true); }
        if (boss() && M.skill.active && M.skill.isTimed) skillOnBoss++;   // 一点关窍 running while she holds it
      }
      const tag = `${M.def.name}${sfx} S${skillIndex + 1}`;
      assert.ok(h.hooksOf('blocked').some((c) => c.blocker === M && c.enemy.defId === 'enemy_2016_csphtm'), `${tag}: blocks 卢西恩`);
      assert.ok(h.b.allyUnits.some((u) => u.defId === 'enemy_9012_acloon' || /yanyou|acloon/.test(u.defId)), '炎佑 on the field');
      const dmg = h.hooksOf('damaged').filter((c) => c.source === M && c.target.side === 'enemy');
      assert.equal(dmg.length, 0, `${tag}: no damage to enemies (${dmg.map((c) => c.target.def?.name).join(',')})`);
      const atks = h.hooksOf('attack').filter((c) => c.attacker === M);
      assert.ok(atks.length > 0 && atks.every((c) => c.targets.every((t) => t.side === 'ally')), `${tag}: every attack heals an ally`);
      assert.ok(topped && skillOnBoss > 0, `${tag}: casts / runs its skill while blocking 卢西恩 / 不祥幻影 (${skillOnBoss})`);
      if (skillIndex === 0) assert.ok(atks.some((c) => c.isSkill), `${tag}: 触类旁通's heal went to allies`);
      assert.ok(healsBlocking > 0, `${tag}: heals while blocking (${healsBlocking}, others ${othersBlocking})`);
    }
  }
});

// =====================================================================================================================
// every healer × every bond

const PATIENT = 'fb1e_patient';
const DEFS = {
  chess: { [PATIENT]: chessRec({ id: PATIENT, stats: { atk: 0, maxHp: 1e7, blockCnt: 0, def: 0 }, rangeGrid: [[0, 0]], skill: null }) },
  enemies: { enemy_fb1e: enemyRec({ key: 'enemy_fb1e', hp: 1e9, atk: 1, speed: 1 }) },
};
/**
 * One healer (or token) on (9,6) of the flat normal field blocks a big walking enemy from ~6.6 s on while a patient on
 * (10,6) stays injured (华法琳 S2's 不稳定血浆 may drain it out: then she heals herself). The skill's SP is filled — and
 * the patient put back to 5 % — the first tick the unit blocks (`fillSp`, default on: the skill becomes ready while it
 * blocks — the report's 强力击 moment; the default initial SP leaves half the skills uncast in the window). Returns the hooks seen; `healsBlocking` = heals by the
 * unit (any ally, itself included) while it blocks; `skillBlocking` = casts, skill attacks and ticks of a running skill
 * while it blocks.
 */
function blockRun(unit, { member = null, bonds = {}, secs = 20, rec = null, fillSp = true } = {}) {
  const defs = member && rec ? { ...DEFS, chess: { ...DEFS.chess, [rec.chessId]: { ...rec, bonds: [member] } } } : DEFS;
  const h = makeBattle({ defs, timeLimit: 60, seed: 5, autoFinish: false, bonds, captureNoisy: true, hooks: ['damaged', 'attack', 'heal'],
    units: [{ row: 9, col: 6, dir: 'RIGHT', ...unit }, { chessId: PATIENT, row: 10, col: 6, carryState: { hpPct: 0.05 } }],
    enemies: [{ key: 'enemy_fb1e', time: 0, route: 0 }] });
  const M = h.b.allyUnits.find((u) => u.defId === (unit.chessId ?? unit.tokenId));
  const P = h.b.allyUnits.find((u) => u.defId === PATIENT);
  let blocking = 0, healsBlocking = 0, skillBlocking = 0, filled = !fillSp;
  h.b.on('heal', (c) => { if (c.source === M && M.blocking.length && c.amount > 0) healsBlocking++; });
  h.b.on('skillStart', (c) => { if (c.unit === M && M.blocking.length) skillBlocking++; });
  h.b.on('attack', (c) => { if (c.attacker === M && c.isSkill && M.blocking.length) skillBlocking++; });
  for (let i = 0; i < secs * 30; i++) {
    h.step();
    if (!M.blocking.length) continue;
    blocking++;
    const sk = M.skill;
    if (!filled && sk && !sk.noSkill) {
      // the patient back to 5 % (a skill spent before the block may have healed it above 50 %: 华法琳 S1 紧急包扎 fires
      // only on a heal target below half HP)
      filled = true;
      P.hp = P.s.maxHp * 0.05;
      sk.gainSp(sk.spCost * sk.maxCharges, 'init', true);
    }
    if (sk?.active && sk.kind !== 'passive') skillBlocking++;
  }
  return {
    M, blocking: blocking / 30, healsBlocking, skillBlocking,
    dmg: h.hooksOf('damaged').filter((c) => c.source === M && c.target.side === 'enemy'),
    atks: h.hooksOf('attack').filter((c) => c.attacker === M),
  };
}

test('E2 audit: every pure healer (医师 / 群愈师 / 疗养师 / 链愈师 / 行医, normal and elite, every skill cast while blocking) keeps healing while it blocks, under every bond as a member, and never hits the enemy', REAL, () => {
  const ds = getDefaultSource();
  const healers = Object.values(ds.raw.chess).filter((c) => c.stats && c.dmgType === 'heal' && PURE.has(c.subProfessionId));
  assert.ok(healers.length >= 20, `healers ${healers.length}`);
  const BONDS = JSON.parse(fs.readFileSync(new URL('../../data/bonds.json', import.meta.url), 'utf8'));
  const bonds = Object.keys(BONDS);
  assert.ok(bonds.length >= 23);
  let runs = 0, pulses = 0;
  for (const c of healers) {
    for (let si = 0; si < (c.skills || []).length; si++) {
      for (const member of [null, ...bonds]) {
        const tiers = member ? (BONDS[member].thresholds ?? [1]).length : 0;
        const r = blockRun({ chessId: c.chessId, skillIndex: si }, member ? { member, rec: c, bonds: { [member]: { count: 12, active: true, tier: Math.max(1, tiers), layers: 60 } } } : {});
        const tag = `${c.name} ${c.chessId} S${si + 1}${member ? ' ' + member : ''}`;
        runs++;
        assert.ok(r.blocking > 8, `${tag}: blocks (${r.blocking.toFixed(1)} s)`);
        assert.ok(r.skillBlocking > 0, `${tag}: the skill is cast / runs while it blocks`);
        assert.ok(r.atks.every((a) => a.targets.every((t) => t.side === 'ally')), `${tag}: attacks heal allies only`);
        const hits = r.dmg.filter((d) => !bondEffect(d));
        pulses += r.dmg.length - hits.length;
        assert.equal(hits.length, 0, `${tag}: no damage to the blocked enemy (${hits.map((d) => d.dmg?.tags?.join('/')).join(' ')})`);
        assert.ok(r.healsBlocking >= 2, `${tag}: heals while blocking (${r.healsBlocking})`);
      }
    }
  }
  assert.ok(runs >= 1000, `runs ${runs}`);
  assert.ok(pulses > 0, 'the member bonds are live (卡西米尔 pulses while blocking)');
});

test('E2 audit: every equipment item on a blocking healer (录武官 S1, elite 调香师 S2, 流明 S3, each skill cast while blocking) — still healing, no hit', REAL, () => {
  const ITEMS = JSON.parse(fs.readFileSync(new URL('../../data/items.json', import.meta.url), 'utf8'));
  const equips = Object.values(ITEMS).filter((i) => i && i.itemType === 'EQUIP');
  assert.ok(equips.length >= 100, `items ${equips.length}`);
  for (const [chessId, skillIndex] of [['chess_char_5_23_a', 0], ['chess_char_2_14_b', 1], ['chess_char_6_14_a', 2]]) {
    for (const it of equips) {
      const r = blockRun({ chessId, skillIndex, items: [it.id] });
      const tag = `${r.M.def.name} ${chessId} + ${it.name} ${it.id}`;
      assert.ok(r.skillBlocking > 0, `${tag}: the skill is cast / runs while it blocks`);
      assert.ok(r.atks.every((a) => a.targets.every((t) => t.side === 'ally')), `${tag}: attacks heal allies only`);
      assert.equal(r.dmg.length, 0, `${tag}: no damage to the blocked enemy`);
      assert.ok(r.healsBlocking >= 2, `${tag}: heals while blocking (${r.healsBlocking})`);
    }
  }
});

test('E2 audit: the map characters 预备干员-医疗 / Touch heal while they block and never hit the enemy', REAL, () => {
  for (const tokenId of ['char_605_cmedic', 'char_613_acmedc']) {
    const r = blockRun({ kind: 'token', tokenId });
    assert.ok(r.blocking > 8, `${tokenId} blocks`);
    assert.equal(r.dmg.length, 0, tokenId);
    assert.ok(r.atks.length > 0 && r.atks.every((a) => a.targets.every((t) => t.side === 'ally')), tokenId);
    assert.ok(r.healsBlocking >= 2, `${tokenId}: heals while blocking (${r.healsBlocking})`);
  }
});

test('E2 audit: skills that turn attacks into heals (古米 S1 / S2, 塞雷娅 S1, 波登可 S1) heal allies while blocking; 瑕光 S1 "造成…伤害，且恢复" still strikes', REAL, () => {
  const cases = [
    ['chess_char_1_10', 0, 'heal'], ['chess_char_1_10', 1, 'heal'], ['chess_char_5_11', 0, 'heal'], ['chess_char_1_13', 0, 'heal'],
    ['chess_char_3_12', 0, 'strike'],
  ];
  for (const [base, si, kind] of cases) {
    for (const sfx of ['_a', '_b']) {
      const r = blockRun({ chessId: base + sfx, skillIndex: si }, { secs: 45 });
      const tag = `${r.M.def.name}${sfx} S${si + 1}`;
      const skillAtks = r.atks.filter((a) => a.isSkill);
      assert.ok(r.blocking > 30 && skillAtks.length > 0, `${tag}: blocks and casts (${skillAtks.length})`);
      if (kind === 'heal') {
        assert.ok(skillAtks.every((a) => a.targets.every((t) => t.side === 'ally')), `${tag}: the heal-mode attacks heal allies`);
        assert.equal(r.dmg.filter((d) => d.dmg?.isSkill).length, 0, `${tag}: no skill damage to the blocked enemy`);
        assert.ok(r.healsBlocking >= 2, `${tag}: heals while blocking (${r.healsBlocking})`);
      } else {
        assert.ok(skillAtks.every((a) => a.targets.some((t) => t.side === 'enemy')), `${tag}: strikes the enemy it blocks`);
        assert.ok(r.healsBlocking >= 2, `${tag}: and heals (${r.healsBlocking})`);
      }
    }
  }
});

test('E2 audit: 咒愈师 strike the enemy they block and heal by their trait (DESIGN §20.3); 吟游者 make no normal attack', REAL, () => {
  for (const id of ['chess_char_1_06_a', 'chess_char_5_02_a', 'chess_char_6_08_a']) {
    const r = blockRun({ chessId: id, skillIndex: 0 });
    assert.ok(r.dmg.some((d) => d.dmg?.isAttack), `${r.M.def.name}: hits the enemy it blocks`);
    assert.ok(r.healsBlocking > 0, `${r.M.def.name}: heals an ally ("为攻击范围内一名友方干员治疗相当于50%伤害")`);
  }
  for (const id of ['chess_char_4_25_a', 'chess_char_6_04_a']) {
    const r = blockRun({ chessId: id, skillIndex: 0 });
    assert.equal(r.dmg.filter((d) => d.dmg?.isAttack).length, 0, `${r.M.def.name}: 不攻击`);
  }
});

// =====================================================================================================================
// every boss round

test('E2 audit: healers on every boss / hidden field deal no damage; they block roaming 卢西恩 / 不祥幻影 and heal, while 碎铳之簧 stays unblockable', REAL, () => {
  const ds = getDefaultSource();
  const W = waves();
  const HEALERS = ['chess_char_5_23_a', 'chess_char_2_14_a', 'chess_char_6_14_a', 'chess_char_2_06_a', 'chess_char_6_20_a', 'chess_char_4_26_a', 'chess_char_4_21_a', 'chess_char_4_08_a', 'chess_char_2_05_a', 'chess_char_2_02_a'];
  const SPRING = /^enemy_90(18|19|20)_actrp/;
  /** The leaders / parts a block-1 operator can block at all (the rest: 自缚 / 无法被阻挡, the 剑 / 锤 anchored, 余音 block ≥ 2). */
  const EXPECT = { act2autochess_h07_05: [LUCIEN], act2autochess_h07_05_s: [LUCIEN] };
  let templates = 0;
  for (const [key, tpl] of Object.entries(W)) {
    if (tpl.kind !== 'boss' && tpl.kind !== 'hidden') continue;
    templates++;
    const stageId = key.startsWith('act2') ? 'act2autochess_m01' : 'act1autochess_m01';
    const rows = ds.getStage(stageId).rows;
    const tiles = [];
    for (let r = 1; r <= 5; r++) for (let c = 3; c <= 9; c++) if (rows[r][c] === 'r') tiles.push([r, c]);
    const units = [];
    HEALERS.forEach((id, i) => {
      const t = tiles[(i * 3) % tiles.length];
      // board coordinates (row + 7 = the boss row): the Battle maps them onto the boss field
      if (!units.some((u) => u.row === t[0] + 7 && u.col === t[1])) units.push({ chessId: id, row: t[0] + 7, col: t[1], dir: 'RIGHT' });
    });
    // two players on the co-op fields (the right one mirrored), one on the solo ones
    const players = (tpl.solo ? ['L'] : ['L', 'R']).map((side, i) => ({ playerId: `p${i + 1}`, seat: i, side, colOffset: 0, units: units.map((u, k) => ({ ...u, uid: k + 1 })), bonds: {}, playerEffects: [] }));
    const h = makeBattle({ kind: tpl.kind, stageId, waveTemplate: tpl, sharedBoss: pool(5e6), seed: 4, players, autoFinish: false,
      captureNoisy: true, hooks: ['damaged', 'attack', 'blocked'], setup(b) { b.enemyOverrides = tpl.overrides; } });
    const healers = h.b.allyUnits.filter((u) => u.def?.dmgType === 'heal');
    const lead = (e) => e.isBoss || e.tag === 'boss' || e.tag === 'part' || LUCIEN.test(e.defId);
    let healsOnLead = 0;
    h.b.on('heal', (c) => { if (healers.includes(c.source) && c.amount > 0 && c.source.blocking.some(lead)) healsOnLead++; });
    // Keep 200 s on roaming fields: springs first meet a healer at 145 s, so a shorter no-block check is vacuous.
    const longRun = EXPECT[key] || key.startsWith('act1autochess_h08_02');
    for (let i = 0; i < (longRun ? 200 : 120) * 30; i++) {
      h.step();
      // Break each held shield too: PRTS corrects the handbook's claim that this makes springs blockable.
      for (const e of h.b.enemies) {
        if (!e.alive || !SPRING.test(e.defId) || !e.findBuff('boss:springShield')) continue;
        if (/9018/.test(e.defId)) h.b.dealDamage(null, e, { amount: e.s.maxHp * 0.02, type: 'arts' });   // 法术屏障 (0.5 % max HP)
        else if (/9019/.test(e.defId)) h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 1000 }); // 元素护盾: its burst
        else h.b.dealDamage(null, e, { amount: 1, type: 'true' });                                        // 频次护盾: 5 hits
      }
    }
    const dmg = h.hooksOf('damaged').filter((c) => healers.includes(c.source) && c.target.side === 'enemy');
    assert.equal(dmg.length, 0, `${key}: healer damage ${dmg.map((c) => `${c.source.def.name}→${c.target.def?.name}`).join(', ')}`);
    assert.ok(h.hooksOf('attack').filter((c) => healers.includes(c.attacker)).every((c) => c.targets.every((t) => t.side === 'ally')), `${key}: heals only`);
    const leads = h.hooksOf('blocked').filter((c) => healers.includes(c.blocker) && lead(c.enemy)).map((c) => c.enemy.defId);
    for (const re of EXPECT[key] ?? []) assert.ok(leads.some((id) => re.test(id)), `${key}: a healer blocks ${re} (${[...new Set(leads)]})`);
    if (EXPECT[key]) assert.ok(healsOnLead > 0, `${key}: healers heal while they block it (${healsOnLead})`);
    else assert.equal(leads.length, 0, `${key}: its leaders / parts cannot be blocked (${[...new Set(leads)]})`);
  }
  assert.equal(templates, 20);
});
