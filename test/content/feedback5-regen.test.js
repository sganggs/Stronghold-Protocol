// test/content/feedback5-regen.test.js — 生命回复速度 is not 治疗 (GitHub #96 / #137). Effects PRTS describes as raising the
// target's 「生命回复速度」 attribute — the 吟游者 trait (分支特性信息 吟游者; 魔王, 浊心斯卡蒂), 调香师's 熏衣草, 瑕光 S2, 铃兰 S3 —
// are hpRegen buffs: 无法被友方治疗 (隐德来希 收割者, 折桠 不屈者) and 禁疗 do not stop them, 治疗加成 does not scale them
// (attack/heal.js heal `regen`); a direct heal is still refused / scaled as before.
// Run: node --test test/content/feedback5-regen.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const REAPER = 'chess_char_5_06_a', UNYIELD = 'chess_char_2_17_a';
const DEFS = { chess: { t_plain: chessRec({ id: 't_plain', profession: 'TANK', skill: null, stats: { maxHp: 10000, atk: 0, def: 0 } }) } };

/** Provider on (10,4) facing right with 隐德来希 on (10,5) and 折桠 on (11,4) at half HP (both "无法被友方角色治疗"). */
function field(provider, extra = []) {
  const h = makeBattle({
    defs: DEFS, autoFinish: false, timeLimit: 120,
    units: [{ row: 10, col: 4, ...provider }, { chessId: REAPER, row: 10, col: 5 }, { chessId: UNYIELD, row: 11, col: 4 }, ...extra],
  });
  h.step();
  const p = h.unit(provider.chessId), r = h.unit(REAPER), z = h.unit(UNYIELD);
  for (const x of [r, z]) x.hp = x.s.maxHp * 0.5;
  return { h, p, r, z };
}

/** HP gained over `secs` s against the unit's own 生命回复速度 (at most ~1 HP pending in the regeneration tick). */
function regenOver(h, u, secs) {
  const hp0 = u.hp, rate = u.s.hpRegen;
  h.run(secs);
  return { gained: u.hp - hp0, expected: rate * secs, rate };
}

const PROVIDERS = [
  // [label, unit entry, prepare(h, p) → buff key of the provider's 生命回复速度]
  ['魔王 trait (吟游者)', { chessId: 'chess_char_4_25_a' }, (h, p) => `trait:bard:${p.id}`],
  ['浊心斯卡蒂 trait (吟游者, S2 loadout: on, trait raised)', { chessId: 'chess_char_6_04_a', skillIndex: 1, carryState: { sp: 999 } }, (h, p) => {
    assert.ok(h.runUntil(() => p.skill.active, 5));
    return `trait:bard:${p.id}`;
  }],
  ['调香师 熏衣草', { chessId: 'chess_char_2_14_a' }, (h, p) => `flower:lavender:${p.id}`],
  ['瑕光 S2 慑敌辉光', { chessId: 'chess_char_3_12_a', skillIndex: 1 }, (h, p) => { assert.ok(p.skill.activate('test', { free: true })); return `blemsh:regen:${p.id}`; }],
  ['铃兰 S3 狐火渺然', { chessId: 'chess_char_5_10_a' }, (h, p) => { assert.ok(p.skill.activate('test', { free: true })); h.run(1.05); return `lisa:fox:${p.id}`; }],
];

test('隐德来希 (收割者) and 折桠 (不屈者) regenerate under 魔王 / 浊心斯卡蒂 / 调香师 / 瑕光 S2 / 铃兰 S3 — none of it is a heal; a direct heal from the same provider is still refused', () => {
  for (const [label, entry, prepare] of PROVIDERS) {
    const { h, p, r, z } = field(entry);
    const key = prepare(h, p);
    h.run(1.2); // (the providers' own talent auras settle their ATK first)
    for (const x of [r, z]) {
      const b = x.findBuff(key);
      assert.ok(b && b.mods.hpRegen > 0, `${label}: ${x.defId} carries the 生命回复速度 buff`);
      const { gained, expected } = regenOver(h, x, 2);
      assert.ok(gained > 0 && Math.abs(gained - expected) <= 1.5, `${label}: ${x.defId} +${gained.toFixed(2)} ≈ ${expected.toFixed(2)}`);
      assert.equal(h.b.heal(p, x, 100), 0, `${label}: a direct heal on ${x.defId} is still refused (无法被友方角色治疗)`);
    }
    assert.equal(h.hooksOf('heal').filter((c) => c.source === p && (c.target === r || c.target === z)).length, 0, `${label}: no heal of the provider reached them`);
    checkInvariants(h.b);
    assert.equal(h.b.errors.length, 0);
  }
});

test('禁疗 does not stop 生命回复速度 (异常效果 禁疗 「增减生命回复速度…的效果不会被识别为治疗类能力」); it still stops heals, the unit\'s own included', () => {
  const { h, p } = field({ chessId: 'chess_char_2_14_a' }, [{ chessId: 't_plain', row: 9, col: 4 }]);
  const t = h.unit('t_plain');
  h.b.addBuff(t, { key: 'test:healFree', status: 'healFree', flags: { noHeal: true, healFree: true } });
  t.hp = 4000;
  h.run(0.6);
  const { gained, expected } = regenOver(h, t, 2);
  assert.ok(gained > 0 && Math.abs(gained - expected) <= 1.5, `under 禁疗: +${gained} ≈ ${expected}`);
  assert.equal(h.b.heal(p, t, 100), 0, 'a heal from her: refused');
  assert.equal(h.b.heal(t, t, 100, { self: true }), 0, 'its own heal: 0 under 禁疗');
  checkInvariants(h.b);
});

test('治疗加成 does not scale 生命回复速度: a healing-received multiplier and 百炼嘉维尔\'s 医学背景 (a heal hook) leave the regeneration as it is; a direct heal is scaled', () => {
  const { h, p } = field({ chessId: 'chess_char_2_14_a' }, [{ chessId: 't_plain', row: 9, col: 4 }, { chessId: 'chess_char_4_23_a', row: 12, col: 4 }]);
  const t = h.unit('t_plain'), gv = h.unit('chess_char_4_23_a');
  h.b.addBuff(t, { key: 'test:healUp', mods: { healingTakenMul: 1.5 } });
  t.hp = 4000;
  gv.hp = gv.s.maxHp * 0.3; // 医学背景: healing received ×1.4 below half HP
  h.run(0.6);
  const v = p.s.atk * p.def.talents[0].bb.atk_to_hp_recovery_ratio;
  for (const x of [t, gv]) {
    assert.ok(Math.abs(x.s.hpRegen - x.base.hpRecoveryPerSec - v) < 1e-6, `${x.defId}: 生命回复速度 +ATK × ratio, unscaled`);
    const { gained, expected } = regenOver(h, x, 2);
    assert.ok(Math.abs(gained - expected) <= 1.5, `${x.defId}: +${gained} ≈ ${expected} (no ×1.5 / ×1.4)`);
  }
  assert.ok(Math.abs(h.b.heal(p, t, 100) - 150) < 1e-6, 'a heal: ×1.5 healing received');
  assert.ok(h.b.heal(p, gv, 100) > 100 + 1e-6, 'a heal on 百炼嘉维尔: her 医学背景 applies');
  checkInvariants(h.b);
});
