// test/full-potential.test.js — the data records are built at FULL potential (潜能 6: the default — the owner's decisions of
// 2026-10-07, GitHub #252 / PR #255, and 2026-10-08: a lower potential is the player's 干员调配 setting, test/potential.test.js;
// tools/build-data.mjs FULL_RANK, docs/DATA.md §2 / §2.3): every chess (normal and elite), 自选
// pick and 补位 stand-in adds its character_table `potentialRanks` attribute steps and takes its talent / module-talent
// candidates up to `requiredPotentialRank` 5; a summon picks its talent candidates at its owner's potential but takes
// none of the owner's attribute steps. The evidence: a tournament video shows 刺玫 (chess_char_1_06_a) at ATK 435 and
// cost 15 — her E1 Lv55 413 / 17 plus 攻击力+22 and two 部署费用-1. These numbers reach the battle, the 干员调配 局内数值
// and the detail card through the records (shared/loadoutRecord.js, simdata getChess).
// With the official-data cache (.cache/gamedata) the potential steps are re-derived from the raw character_table.
// Run: node --test test/full-potential.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLoadout, loadoutRecord } from '../server/sim/simdata.js';
import { diyRecordOf } from '../shared/diy.js';
import { standInRecord } from '../shared/standIn.js';
import { makeBattle } from './helpers/battleHarness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const CACHE = join(ROOT, '.cache', 'gamedata');
const HAS_CACHE = ['activity_table', 'character_table'].every((f) => existsSync(join(CACHE, 'excel', `${f}.json`)));
const load = (name) => JSON.parse(readFileSync(join(DATA, `${name}.json`), 'utf8'));
const chess = load('chess');
const tokens = load('tokens');
const backups = load('backups');
const raw = (f) => JSON.parse(readFileSync(join(CACHE, 'excel', `${f}.json`), 'utf8'));
const talent = (rec, name) => rec.talents.find((t) => t.name === name);

test('刺玫 at full potential: ATK 435 / cost 15 (the tournament video), 再部署 66 s, 土壤基肥改良 at its 「天赋效果增强」 step', () => {
  const v = chess.chess_char_1_06_a;
  assert.equal(v.name, '刺玫');
  assert.deepEqual([v.stats.atk, v.stats.cost, v.stats.respawnTime, v.stats.maxHp, v.stats.def], [435, 15, 66, 1137, 77]);
  assert.equal(talent(v, '土壤基肥改良').bb.heal_scale, 1.11, 'E1: 1.08 + the potential-5 step');
  assert.match(talent(v, '土壤基肥改良').desc, /111%|11%/);
  const e = chess.chess_char_1_06_b;   // the elite: its own E2 Lv50 record plus the same five steps
  assert.deepEqual([e.stats.atk, e.stats.cost, e.stats.respawnTime, e.statsBase.atk, e.statsBase.cost], [553, 15, 66, 530, 15]);
  assert.equal(talent(e, '土壤基肥改良').bb.heal_scale, 1.18);
});

test('the other potential kinds: 攻击速度 (格雷伊 +6, 崖心 / 伊内丝 +8), 生命 / 防御 / 法抗, and the redeploy times of GitHub #252', () => {
  const s = (id) => chess[id].stats;
  assert.deepEqual([s('chess_char_1_14_a').aspd, s('chess_char_1_14_b').aspd], [106, 109], '格雷伊 攻击速度+6');
  assert.deepEqual([s('chess_char_2_03_a').aspd, s('chess_char_4_04_a').aspd], [108, 108], '崖心 / 伊内丝 攻击速度+8');
  assert.equal(s('chess_char_1_02_a').maxHp, 2466, '角峰 生命上限 +250');
  assert.equal(s('chess_char_1_20_a').def, 516, '雷蛇 防御力 +27');
  assert.equal(s('chess_char_3_09_a').res, 33, '海霓 法术抗性 +8');
  // GitHub #252: 砾 18 → 16 s, 至简 80 → 70 s; 野鬃's two 再部署时间-10秒 steps: 80 → 60 s
  assert.deepEqual([s('chess_char_2_12_a').respawnTime, s('chess_char_2_12_a').cost], [16, 6]);
  assert.deepEqual([s('chess_char_3_13_a').respawnTime, s('chess_char_3_13_a').cost], [70, 20]);
  assert.deepEqual([s('chess_char_1_19_a').respawnTime, s('chess_char_1_19_a').cost], [60, 11]);
});

test('every chess, 自选 form and stand-in form: the raw keyframes plus every potential step (re-derived from character_table)', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const CT = raw('character_table');
  const KEY = { MAX_HP: 'maxHp', ATK: 'atk', DEF: 'def', MAGIC_RESISTANCE: 'res', COST: 'cost', RESPAWN_TIME: 'respawnTime', ATTACK_SPEED: 'aspd' };
  const steps = (charId) => {
    const out = {};
    for (const r of CT[charId].potentialRanks || []) {
      for (const m of r.buff?.attributes?.attributeModifiers || []) {
        assert.equal(m.formulaItem, 'ADDITION', `${charId}: ${m.attributeType}`);
        assert.ok(KEY[m.attributeType], `${charId}: unmapped potential attribute ${m.attributeType}`);
        out[KEY[m.attributeType]] = (out[KEY[m.attributeType]] || 0) + m.value;
      }
    }
    return out;
  };
  const frame = (charId, phase, level) => {
    const P = CT[charId].phases[phase];
    const k0 = P.attributesKeyFrames[0], k1 = P.attributesKeyFrames[P.attributesKeyFrames.length - 1];
    const t = (level - k0.level) / (k1.level - k0.level || 1);
    const f = (key) => k0.data[key] + (k1.data[key] - k0.data[key]) * t;
    return { maxHp: f('maxHp'), atk: f('atk'), def: f('def'), res: f('magicResistance'), cost: f('cost'), respawnTime: f('respawnTime'), aspd: f('attackSpeed') };
  };
  const check = (label, charId, status, stats) => {
    const exp = frame(charId, status.phase, status.level);
    for (const [k, v] of Object.entries(steps(charId))) exp[k] += v;
    for (const [k, v] of Object.entries(exp)) assert.ok(Math.abs(v - stats[k]) <= 0.5 + 1e-9, `${label}: ${k} ${stats[k]} vs official ${v}`);
  };
  let n = 0, withSteps = 0;
  for (const c of Object.values(chess)) {
    if (c.isDiy || !c.charId) continue;
    check(c.chessId, c.charId, c.status, c.statsBase ?? c.stats);
    n++;
    if (Object.keys(steps(c.charId)).length) withSteps++;
  }
  assert.equal(n, 258);
  assert.ok(withSteps >= 220, `chess with potential steps: ${withSteps}`);
  let forms = 0;
  for (const [charId, u] of Object.entries(backups.units)) {
    for (const f of Object.values(u.forms)) { check(`${charId}@${f.status.phase}/${f.status.level}`, charId, f.status, f.stats); forms++; }
  }
  assert.equal(forms, 259);
  // the 原型干员 stand-ins have no potential ranks: their numbers are the plain keyframes
  for (const id of ['char_600_cpione', 'char_602_cdfend', 'char_608_acpion', 'char_617_sharp2']) assert.equal((CT[id].potentialRanks || []).length, 0, id);
});

test('talent candidates: every chess talent is the last one unlocked at its status with requiredPotentialRank ≤ 5', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const CT = raw('character_table');
  const PH = { PHASE_0: 0, PHASE_1: 1, PHASE_2: 2 };
  const ok = (c, phase, level) => {
    const u = c.unlockCondition;
    const p = PH[u?.phase ?? 'PHASE_0'];
    return (c.requiredPotentialRank || 0) <= 5 && (p < phase || (p === phase && (u?.level || 1) <= level));
  };
  let potentialTalents = 0;
  for (const c of Object.values(chess)) {
    if (c.isDiy || !c.charId) continue;
    const base = c.talentsBase ?? c.talents;
    (CT[c.charId].talents || []).forEach((t, index) => {
      const cands = (t.candidates || []).filter((x) => ok(x, c.status.phase, c.status.level));
      const best = cands[cands.length - 1];
      const rec = base.find((x) => x.index === index);
      // a fully empty placeholder (no name / text / blackboard / token) is dropped from the record (mergeTalentChanges)
      if (!best || (!best.name && !best.description && !best.blackboard.length && !best.tokenKey)) return;
      assert.ok(rec, `${c.chessId} talent ${index}`);
      for (const b of best.blackboard) if (!(b.valueStr && b.value === 0)) assert.ok(Math.abs(rec.bb[b.key] - b.value) < 1e-9, `${c.chessId} talent ${index} ${b.key}: ${rec.bb[b.key]} vs ${b.value}`);
      if ((best.requiredPotentialRank || 0) > 0) potentialTalents++;
    });
  }
  assert.ok(potentialTalents >= 150, `chess talents at a potential step: ${potentialTalents}`);
});

test('summons: talent candidates at the owner\'s potential, none of the owner\'s attribute steps', () => {
  // 夕's “小自在” 化境: 15 → 18 层 (夕 潜能 5 「第一天赋效果增强」)
  assert.equal(tokens.token_10015_dusk_drgn.variants.chess_char_5_12_a.talents[0].bb.max_stack_cnt, 18);
  assert.equal(talent(chess.chess_char_5_12_a, '化境').bb.max_stack_cnt, 18);
  // 浊心斯卡蒂's 海嗣, 伺夜's 狼群, 凯瑟琳's 防护单元, 风丸's 纸偶
  assert.deepEqual(tokens.token_10017_skadi2_dedant.variants.chess_char_6_04_a.talents[1].bb, { 'skadi2_t_2[atk][1].atk': 0.09, 'skadi2_t_2[atk][2].atk': 0.18 });
  assert.equal(tokens.token_10028_vigil_wolf.variants.chess_char_3_19_a.talents[1].bb.def_penetrate_fixed, 200);
  assert.equal(tokens.token_10041_cathy_catsld.variants.chess_char_4_11_a.talents[0].bb.max_shield_ratio, 0.22);
  assert.equal(tokens.token_10022_kazema_shadow.variants.chess_char_2_11_a.talents[0].bb.damage_scale, 2.3);
  // 自选: 凯尔希's Mon3tr 不毁重构 — PRTS 凯尔希 潜能增强=5 "晕眩3.5（+0.5）秒…1400（+200）点真实伤害", X 模组 3 级 4 s / 1700
  const mon = backups.tokens.token_10002_kalts_mon3tr.variants;
  assert.deepEqual([mon['char_003_kalts@2/1/4/0'].talents[1].bb.stun, mon['char_003_kalts@2/1/4/0'].talents[1].bb.value], [3.5, 1400]);
  const x3 = mon['char_003_kalts@2/60/7/3'].byModule.uniequip_002_kalts.talents[1].bb;
  assert.deepEqual([x3.stun, x3.value], [4, 1700]);
  // 望's 棋子: its rank-2 candidate (望 潜能 3 「第一天赋效果增强」) holds and deploys one more, and 铸子 sends 7
  const stone = backups.tokens.token_10064_wang_stone1;
  assert.deepEqual([stone.deployLimit, stone.count, stone.stats.deckStack], [7, 7, 8]);
  assert.equal(backups.units.char_2027_wang.forms['2/1/4/0'].talents[0].bb.cnt, 7);
  // the token's own numbers: 凯尔希's 攻击力+25 / 部署费用-1 steps stay hers (Mon3tr's frame is its own)
  assert.equal(backups.units.char_003_kalts.forms['2/1/4/0'].stats.cost, 18);
  for (const v of Object.values(mon)) assert.equal(v.stats.cost, backups.tokens.token_10002_kalts_mon3tr.stats.cost);
});

test('the numbers reach the loadout record (局内数值 / detail card), the 自选 and 补位 compositions and the battle', () => {
  // a non-default module on the elite: statsBase (full potential) + the module's attr
  const e = chess.chess_char_1_06_b;
  const other = (e.modules || []).find((m) => !m.isDefault);
  const none = loadoutRecord(e, resolveLoadout(e, { moduleId: 'none' }));
  assert.deepEqual([none.stats.atk, none.stats.cost, none.stats.respawnTime], [530, 15, 66]);
  if (other) {
    const r = loadoutRecord(e, resolveLoadout(e, { moduleId: other.uniEquipId }));
    assert.equal(r.stats.atk, 530 + (other.attr.atk || 0));
  }
  // 自选 凯尔希 (an owned 6★): her form at full potential
  const diy = diyRecordOf(chess.chess_char_6_diy1_a, { charId: 'char_003_kalts', skillIndex: 0 }, { chess, backups });
  assert.deepEqual([diy.stats.atk, diy.stats.cost, diy.stats.respawnTime], [417, 18, 66]);
  // a 补位 stand-in is unchanged by the rule (预备干员 / 原型干员 have no potential ranks)
  const st = standInRecord(chess.chess_char_3_21_a, backups);
  assert.equal(st.stats.cost, backups.units[st.charId].forms[`${chess.chess_char_3_21_a.status.phase}/${chess.chess_char_3_21_a.status.level}/${chess.chess_char_3_21_a.status.skillLevel}/0`].stats.cost);
  // the battle fields 刺玫 with ATK 435 / cost 15 / 66 s
  const h = makeBattle({ units: [{ chessId: 'chess_char_1_06_a', row: 10, col: 5 }], timeLimit: 5 });
  const u = h.unit('chess_char_1_06_a');
  assert.deepEqual([u.base.atk, u.base.cost, u.base.respawnTime], [435, 15, 66]);
});
