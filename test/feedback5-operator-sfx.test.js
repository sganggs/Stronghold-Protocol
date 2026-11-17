// test/feedback5-operator-sfx.test.js — community report of 2026-10-06 (item 54) 「干员银灰的普通攻击的音效错误的使用了3技能期间
// 的攻击音效」. The official banks of 银灰 (excel/audio_data.json): ON_ABILITY_HIT.char_172_svrash.combat (p_imp_spear_n — his
// Default mode's Combat, the normal attack, which has no swing bank), ON_ABILITY_START / HIT .attack.2 (p_atk_silver_n /
// p_imp_sword_n — his S3 mode; the charpack's modes are Default, S2, S3) and HIT .attack.1 (p_imp_sword_n — S2). The picker
// took the numbered variants because their files end in _n. Now an operator whose default mode is the unsuffixed ability (a
// plain attack / combat bank of any event) never takes a numbered variant (tools/assets/audio.mjs pickUnitSfx). The same
// rule drops 雷蛇's S2 lightning impact, 初雪's S1-2 mode impact and 圣约送葬人's S3_End impact from their normal attacks.
// Run: node --test test/feedback5-operator-sfx.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickUnitSfx } from '../tools/assets/audio.mjs';

const P = (f) => [`player/${f.startsWith('p_imp') ? 'p_imp' : 'p_atk'}/${f}.mp3`];
const op = (entries, projectile = {}) => pickUnitSfx(new Map(entries.map(([k, f]) => [k, P(f)])), { operator: true, projectile });

test('银灰: the normal attack is the Default mode\'s Combat — spear impact, no swing; the S3 swing and the S2 / S3 impact never', () => {
  const sfx = op([
    ['ON_ABILITY_HIT.combat', 'p_imp_spear_n'],
    ['ON_ABILITY_START.attack.2', 'p_atk_silver_n'],
    ['ON_ABILITY_HIT.attack.2', 'p_imp_sword_n'],
    ['ON_ABILITY_HIT.attack.1', 'p_imp_sword_n'],
  ]);
  assert.deepEqual(sfx, { hit: P('p_imp_spear_n') });
});

test('雷蛇 / 初雪 / 圣约送葬人: a plain swing, and no skill mode\'s impact on the normal attack', () => {
  assert.deepEqual(op([['ON_ABILITY_ON.attack', 'p_atk_pistol_n'], ['ON_ABILITY_HIT.attack.1', 'p_imp_lightning_n'], ['ON_ABILITY_START.attack.1', 'p_atk_lightning_n']]),
    { attack: P('p_atk_pistol_n') }, '雷蛇 (attack.1 = S2)');
  assert.deepEqual(op([['ON_ABILITY_ON.attack', 'p_atk_shakebell_n'], ['ON_ABILITY_HIT.attack.1', 'p_imp_shakebell_n']]),
    { attack: P('p_atk_shakebell_n') }, '初雪 (attack.1 = the S1-2 mode)');
  assert.deepEqual(op([['ON_ABILITY_ON.attack', 'p_atk_shotgunx_n'], ['ON_ABILITY_ON.attack.1', 'p_atk_shotgunx_d'], ['ON_ABILITY_START.attack.4', 'p_atk_bngel'], ['ON_ABILITY_HIT.attack.4', 'p_imp_bngel']]),
    { attack: P('p_atk_shotgunx_n') }, '圣约送葬人 (attack.4 = S3_End)');
  // the operator's own projectile bank still serves when the plain ability has no impact bank
  assert.deepEqual(op([['ON_ABILITY_ON.attack', 'p_atk_x_n'], ['ON_ABILITY_HIT.attack.1', 'p_imp_x_s']], { hit: P('p_imp_x_n') }), { attack: P('p_atk_x_n'), hit: P('p_imp_x_n') });
});

test('operators that number their default mode (attack.0 …) keep the earlier rule; a plain bank that is a skill-mode file does not count', () => {
  assert.deepEqual(op([['ON_ABILITY_START.attack.0', 'p_atk_y_n'], ['ON_ABILITY_HIT.attack.0', 'p_imp_y_n'], ['ON_ABILITY_START.attack.1', 'p_atk_y_n2']]),
    { attack: P('p_atk_y_n'), hit: P('p_imp_y_n') });
  // 荒芜拉普兰德: the unsuffixed START bank is her _d file (a skill mode), her default is attack.0
  assert.deepEqual(op([['ON_ABILITY_START.attack.0', 'p_atk_whtolfdrksl_n'], ['ON_ABILITY_START.attack', 'p_atk_whtolfdrksl_d'], ['ON_ABILITY_ON.attack.2', 'p_atk_whtolfdrksl_h']]),
    { attack: P('p_atk_whtolfdrksl_n') });
});

// The #848 merge review (DESIGN §35.38): firstMatching orders numbered banks by depth, so 弑君者's S3 `attack.3` impact and S2
// `attack.4` swing (plain-named) outranked her normal `attack.0.1`; 莱伊's S3 reload `attack.3` outranked `attack.0.3`. The default
// mode's banks (attack.0, attack.0.N) now come first for an operator, as assignSkillModeSfx already counts them.
test('弑君者 / 莱伊 / 望: the default mode\'s numbered banks (attack.0 …) beat a shallower skill-mode bank', () => {
  assert.deepEqual(op([
    ['ON_ABILITY_START.attack.0.1', 'p_atk_asndgr_n'], ['ON_ABILITY_HIT.attack.0.1', 'p_imp_asndgr_n'],
    ['ON_ABILITY_START.attack.4', 'p_atk_asndgrbm'], ['ON_ABILITY_HIT.attack.3', 'p_imp_asndgrsmk'],
  ]), { attack: P('p_atk_asndgr_n'), hit: P('p_imp_asndgr_n') }, '弑君者');
  assert.deepEqual(op([['ON_ABILITY_START.attack.3', 'p_atk_sndshotgun_sreload'], ['ON_ABILITY_START.attack.0.3', 'p_atk_sndshotgun_nreload']]),
    { attack: P('p_atk_sndshotgun_nreload') }, '莱伊');
  assert.deepEqual(op([['ON_ABILITY_START.attack.1', 'p_atk_stwctp_n'], ['ON_ABILITY_ON.attack.0', 'p_atk_stwctp_n']]).attack, P('p_atk_stwctp_n'), '望');
  // an enemy keeps the old order
  const enemy = pickUnitSfx(new Map([['ON_ABILITY_HIT.attack.3', P('p_imp_a')], ['ON_ABILITY_HIT.attack.0.1', P('p_imp_b')]]), {});
  assert.deepEqual(enemy.hit, P('p_imp_a'));
});
