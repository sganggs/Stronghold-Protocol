// test/potential.test.js — potential (潜能 1–6) is a per-player runtime input (0.2.2, the owner's decision of 2026-10-08:
// 「调配干员里自己设置吧，默认满潜满加成」): the data records are built at full potential and carry what every lower
// potential changes (shared/potential.js; docs/DATA.md §2.3 — `potDown` leaves, chained talent entries). These tests
// check the composition at every potential against the raw official tables (character_table keyframes plus the
// `potentialRanks` steps up to the potential, talent candidates up to `requiredPotentialRank`), the summons at their
// owner's potential, and the data model (full potential = the record itself; a resolved record carries no annotation).
// With the official-data cache (.cache/gamedata) the re-derivations run; the spot checks always do.
// Run: node --test test/potential.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atPotential, atRank, talentAtRank, stripPotential, hasPotentialData, rankOf, isPotential, isCultivate, cultivateMul,
  cultivatedStats, cultivationOf, CULTIVATE_EFFECTS, POTENTIAL_DEFAULT, CULTIVATE_DEFAULT, FULL_RANK,
} from '../shared/potential.js';
import { composeTalents } from '../shared/loadoutRecord.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const CACHE = join(ROOT, '.cache', 'gamedata');
const HAS_CACHE = ['activity_table', 'character_table'].every((f) => existsSync(join(CACHE, 'excel', `${f}.json`)));
const load = (name) => JSON.parse(readFileSync(join(DATA, `${name}.json`), 'utf8'));
const chess = load('chess');
const tokens = load('tokens');
const backups = load('backups');
const effects = load('effects');
const raw = (f) => JSON.parse(readFileSync(join(CACHE, 'excel', `${f}.json`), 'utf8'));
const talent = (rec, name) => rec.talents.find((t) => t.name === name);

test('刺玫 at every potential: 潜能1 ATK 413 / cost 17 / 70 s and 土壤基肥改良 8%, each step at its rank, 潜能6 = the record itself', () => {
  const v = chess.chess_char_1_06_a;
  const at = (p) => atPotential(v, p);
  const row = (p) => [at(p).stats.atk, at(p).stats.cost, at(p).stats.respawnTime, talent(at(p), '土壤基肥改良').bb.heal_scale];
  assert.deepEqual(row(1), [413, 17, 70, 1.08]);
  assert.deepEqual(row(2), [413, 16, 70, 1.08], '潜能2 部署费用-1');
  assert.deepEqual(row(3), [413, 16, 66, 1.08], '潜能3 再部署时间-4秒');
  assert.deepEqual(row(4), [435, 16, 66, 1.08], '潜能4 攻击力+22');
  assert.deepEqual(row(5), [435, 16, 66, 1.11], '潜能5 天赋效果增强');
  assert.deepEqual(row(6), [435, 15, 66, 1.11], '潜能6 部署费用-1');
  assert.equal(at(6), v, 'full potential is the record itself');
  assert.equal(at(null), v);
  assert.equal(talent(at(1), '土壤基肥改良').desc, '攻击范围内生命上限最高的友方角色受到的治疗效果提升8%');
  // the elite: statsBase and stats move together, the talent from its own E2 candidates
  const e = chess.chess_char_1_06_b;
  assert.deepEqual([atPotential(e, 1).stats.atk, atPotential(e, 1).statsBase.atk, atPotential(e, 1).stats.cost], [531, 508, 17]);
  assert.equal(talent(atPotential(e, 4), '土壤基肥改良').bb.heal_scale, 1.15);
});

test('a resolved record carries no annotation; the full record minus them is what 0.2.1 shipped (the stats and talents of 潜能6)', () => {
  let n = 0;
  for (const c of Object.values(chess)) {
    if (c.isDiy || !c.charId) continue;
    for (let p = 1; p <= 5; p++) {
      const r = atPotential(c, p);
      assert.notEqual(r, c);
      assert.equal(JSON.stringify(r).match(/"pot(Down|Min|Below)"/), null, `${c.chessId} @${p}`);
    }
    if (hasPotentialData(c)) n++;
  }
  assert.ok(n >= 250, `chess records that change below full potential: ${n}`);
  // composed lists never carry chains (shared/loadoutRecord.js composeTalents)
  const e = chess.chess_char_1_06_b;
  assert.equal(JSON.stringify(composeTalents(e.talentsBase, e.modules[0].talentChanges)).includes('potBelow'), false);
  assert.deepEqual(stripPotential({ a: [{ potMin: 4, potBelow: { x: 1 }, x: 2 }], potDown: { 0: {} } }), { a: [{ x: 2 }] });
});

test('every chess and 自选 form at every potential: the raw keyframes plus the potential steps up to it (character_table)', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const CT = raw('character_table');
  const KEY = { MAX_HP: 'maxHp', ATK: 'atk', DEF: 'def', MAGIC_RESISTANCE: 'res', COST: 'cost', RESPAWN_TIME: 'respawnTime', ATTACK_SPEED: 'aspd' };
  const steps = (charId, rank) => {
    const out = {};
    for (const r of (CT[charId].potentialRanks || []).slice(0, rank)) {
      for (const m of r.buff?.attributes?.attributeModifiers || []) out[KEY[m.attributeType]] = (out[KEY[m.attributeType]] || 0) + m.value;
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
  const check = (label, charId, status, stats, rank) => {
    const exp = frame(charId, status.phase, status.level);
    for (const [k, v] of Object.entries(steps(charId, rank))) exp[k] += v;
    for (const [k, v] of Object.entries(exp)) assert.ok(Math.abs(v - stats[k]) <= 0.5 + 1e-9, `${label} rank ${rank}: ${k} ${stats[k]} vs official ${v}`);
  };
  let n = 0;
  for (const c of Object.values(chess)) {
    if (c.isDiy || !c.charId) continue;
    for (let rank = 0; rank <= FULL_RANK; rank++) { const r = atRank(c, rank); check(c.chessId, c.charId, c.status, r.statsBase ?? r.stats, rank); n++; }
  }
  assert.equal(n, 258 * 6);
  let forms = 0;
  for (const [charId, u] of Object.entries(backups.units)) {
    for (const f of Object.values(u.forms)) {
      for (let rank = 0; rank <= FULL_RANK; rank++) check(`${charId}@${f.status.phase}/${f.status.level}`, charId, f.status, atRank(f, rank).stats, rank);
      forms++;
    }
  }
  assert.equal(forms, 259);
});

test('talent candidates at every potential: each talent is the last one unlocked with requiredPotentialRank ≤ the rank', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const CT = raw('character_table');
  const PH = { PHASE_0: 0, PHASE_1: 1, PHASE_2: 2 };
  const ok = (c, phase, level, rank) => {
    const u = c.unlockCondition;
    const p = PH[u?.phase ?? 'PHASE_0'];
    return (c.requiredPotentialRank || 0) <= rank && (p < phase || (p === phase && (u?.level || 1) <= level));
  };
  let moved = 0;
  const checkList = (label, charId, status, list) => {
    for (let rank = 0; rank <= FULL_RANK; rank++) {
      (CT[charId].talents || []).forEach((t, index) => {
        const cands = (t.candidates || []).filter((x) => ok(x, status.phase, status.level, rank));
        const best = cands[cands.length - 1];
        if (!best || (!best.name && !best.description && !best.blackboard.length && !best.tokenKey)) return;
        const rec = talentAtRank(list.find((x) => x.index === index), rank);
        assert.ok(rec, `${label} talent ${index}`);
        for (const b of best.blackboard) if (!(b.valueStr && b.value === 0)) assert.ok(Math.abs(rec.bb[b.key] - b.value) < 1e-9, `${label} talent ${index} rank ${rank} ${b.key}: ${rec.bb[b.key]} vs ${b.value}`);
        if (rank === 0 && (best.requiredPotentialRank || 0) === 0 && (CT[charId].talents[index].candidates || []).some((x) => (x.requiredPotentialRank || 0) > 0 && ok(x, status.phase, status.level, FULL_RANK))) moved++;
      });
    }
  };
  for (const c of Object.values(chess)) {
    if (c.isDiy || !c.charId) continue;
    checkList(c.chessId, c.charId, c.status, c.talentsBase ?? c.talents);
  }
  for (const [charId, u] of Object.entries(backups.units)) for (const f of Object.values(u.forms)) checkList(`${charId}@${f.status.phase}/${f.status.level}`, charId, f.status, f.talents);
  assert.ok(moved >= 150, `talents whose potential step moves them: ${moved}`);
});

test('summons follow their owner\'s potential: Mon3tr 不毁重构 3 s / 1200 below 潜能5, 望\'s 棋子 6 deployed / 7 held below 潜能3, “小自在” 15 层', () => {
  const mon = backups.tokens.token_10002_kalts_mon3tr.variants['char_003_kalts@2/1/4/0'];
  assert.deepEqual([atPotential(mon, 4).talents[1].bb.stun, atPotential(mon, 4).talents[1].bb.value], [3, 1200]);
  assert.deepEqual([atPotential(mon, 5).talents[1].bb.stun, atPotential(mon, 5).talents[1].bb.value], [3.5, 1400]);
  const stone = backups.tokens.token_10064_wang_stone1.variants['char_2027_wang@2/1/4/0'];
  assert.deepEqual([atPotential(stone, 2).stats.deployLimit, atPotential(stone, 2).stats.deckStack], [6, 7]);
  assert.deepEqual([atPotential(stone, 3).stats.deployLimit, atPotential(stone, 3).stats.deckStack], [7, 8]);
  const tvar = backups.tokens.token_10064_wang_stone1.variants['char_2027_wang@2/60/7/1'];
  assert.equal(atPotential(tvar, 1).byModule.uniequip_002_wang.stats.deployLimit, 7, 'TRP-X: 6 + 1 below 潜能3');
  assert.equal(tvar.byModule.uniequip_002_wang.stats.deployLimit, 8);
  // tokens.json: 夕's “小自在” 化境 18 → 15 层 below 潜能5
  const dusk = tokens.token_10015_dusk_drgn.variants.chess_char_5_12_a;
  assert.deepEqual([atPotential(dusk, 4).talents[0].bb.max_stack_cnt, dusk.talents[0].bb.max_stack_cnt], [15, 18]);
  // the owner's own talent text follows too (望's kit reads 「最多拥有N枚」 from it)
  assert.match(atPotential(backups.units.char_2027_wang.forms['2/60/7/1'], 1).talents[0].desc, /最多拥有7枚/);
});

test('练度 (自持有): the CHAR_MAP effects in cultivateEffectList order, their char_attribute_mul as ×ATK / ×DEF / ×HP', { skip: !HAS_CACHE && 'no .cache/gamedata' }, () => {
  const list = raw('activity_table').autoChessData.cultivateEffectList.slice().sort((a, b) => a.cultivateNum - b.cultivateNum);
  assert.deepEqual(list.map((x) => x.effectId), [...CULTIVATE_EFFECTS]);
  list.forEach((row, tier) => {
    const m = cultivateMul(effects, tier);
    assert.equal(effects[row.effectId].effectType, 'CHAR_MAP');
    assert.deepEqual([m.atk, m.def, m.hp].map((x) => Math.round((x - 1) * 100)), [row.atkPer, row.defPer, row.hpPer], row.effectId);
  });
});

test('练度 helpers: the four tiers, the default, the products, who has neither (补位 / 原型 自选)', () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => cultivateMul(effects, n)), [
    { atk: 1, def: 1, hp: 1 }, { atk: 1.05, def: 1.05, hp: 1 }, { atk: 1.1, def: 1.05, hp: 1.05 }, { atk: 1.1, def: 1.1, hp: 1.1 },
  ]);
  assert.equal(cultivateMul(effects, 4), null);
  assert.equal(cultivateMul(effects, null), null);
  assert.deepEqual(cultivatedStats({ atk: 435, def: 77, maxHp: 1137, cost: 15 }, cultivateMul(effects, 3)), { atk: 435 * 1.1, def: 77 * 1.1, maxHp: 1137 * 1.1, cost: 15 });
  assert.deepEqual([POTENTIAL_DEFAULT, CULTIVATE_DEFAULT, rankOf(1), rankOf(6), rankOf(0), rankOf('6')], [6, 3, 0, 5, 5, 5]);
  assert.deepEqual([isPotential(0), isPotential(1), isPotential(6), isPotential(7), isPotential(2.5)], [false, true, true, false, false]);
  assert.deepEqual([isCultivate(-1), isCultivate(0), isCultivate(3), isCultivate(4)], [false, true, true, false]);
  const v = chess.chess_char_1_06_a;
  assert.deepEqual(cultivationOf(v, null), { potential: 6, cultivate: 3 }, 'no setting: 满潜满加成');
  assert.deepEqual(cultivationOf(v, { [v.charId]: { potential: 1 } }), { potential: 1, cultivate: 3 });
  assert.deepEqual(cultivationOf(v, { [v.charId]: { potential: 9, cultivate: 0 } }), { potential: 6, cultivate: 0 }, 'a bad value is the default');
  assert.equal(cultivationOf({ ...v, standInFor: 'char_x' }, null), null, '补位');
  assert.equal(cultivationOf({ ...v, diyProto: true }, null), null, '原型 自选');
});
