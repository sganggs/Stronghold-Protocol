// test/feedback7-chen3-s3-sfx.test.js — user report 「赤刃明霄陈开启三技能后斩击音效应该和普通攻击不一样」 (2026-10-08).
//
// 赤刃明霄陈 (char_1050_chen3) has both kinds of bank, and BOTH of her S3's sounds differ from her normal attack —
// excel/audio_data.json, her ability banks (`attack.<n>` = the mode; the mode is in the file name):
//
//   battle.ON_ABILITY_START.char_1050_chen3.attack.0    → p_atk_hljdswd_n   普通攻击（默认形态）
//   battle.ON_ABILITY_HIT.char_1050_chen3.attack.0      → p_imp_hljdswd_n   普通攻击的命中
//   battle.ON_ABILITY_START.char_1050_chen3.attack.1    → p_atk_hljdfswd_d   技能1
//   battle.ON_ABILITY_HIT.char_1050_chen3.attack.1.0    → p_imp_hljdrfswd_d  技能1 的命中
//   battle.ON_ABILITY_HIT.char_1050_chen3.attack.1.1    → p_imp_hljdylfswd_d  技能1 的命中（第二个变体）
//   battle.ON_ABILITY_START.char_1050_chen3.attack.3    → p_atk_hljdswd_s    技能3
//   battle.ON_ABILITY_HIT.char_1050_chen3.attack.3      → p_imp_hljdswd_s    技能3 的命中 ← 这就是「斩击」
//
// `pickUnitSfx` refuses skill-mode files for the NORMAL attack / impact (社区反馈 #54, 银灰) and therefore keeps the `_n`
// pair — correct. The fix of 司霆惊蛰 (test/feedback6-…) already plays the mode's own swing while the skill runs; this
// report is the other half: without a per-mode IMPACT the S3 slash still landed with p_imp_hljdswd_n, i.e. it sounded
// like her normal attack. tools/assets/audio.mjs pickModeHits() now reads `ON_ABILITY_HIT` per mode (same mode letters,
// same slot rule), plan.mjs writes it as sfx.units[id].hits = { '<skillIndex>': url }, and public/js/audio.js plays it for
// an attack that was aimed while that skill ran (the attacker's state travels with its impact bookkeeping).
//
// Run: node --test test/feedback7-chen3-s3-sfx.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickModeAttacks, pickModeHits, skillModeLetter, SLOT_MODE_LETTER } from '../tools/assets/audio.mjs';

const P = (f) => `player/${f.startsWith('p_imp') ? 'p_imp' : 'p_atk'}/${f}.mp3`;
const CHEN3 = 'char_1050_chen3';
const manifest = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));

/** 赤刃明霄陈's own banks, exactly as excel/audio_data.json lists them. */
const CHEN3_BANKS = new Map([
  ['ON_ABILITY_START.attack.0', [P('p_atk_hljdswd_n')]],
  ['ON_ABILITY_HIT.attack.0', [P('p_imp_hljdswd_n')]],
  ['ON_ABILITY_START.attack.1', [P('p_atk_hljdfswd_d')]],
  ['ON_ABILITY_HIT.attack.1.0', [P('p_imp_hljdrfswd_d')]],
  ['ON_ABILITY_HIT.attack.1.1', [P('p_imp_hljdylfswd_d')]],
  ['ON_ABILITY_START.attack.3', [P('p_atk_hljdswd_s')]],
  ['ON_ABILITY_HIT.attack.3', [P('p_imp_hljdswd_s')]],
]);

test('pickModeAttacks / pickModeHits: 赤刃明霄陈 S3 的挥砍与命中都和普通攻击不同（技能1 两个命中变体取第一个）', () => {
  assert.deepEqual(pickModeAttacks(CHEN3_BANKS), { d: [P('p_atk_hljdfswd_d')], s: [P('p_atk_hljdswd_s')] });
  assert.deepEqual(pickModeHits(CHEN3_BANKS), { d: [P('p_imp_hljdrfswd_d')], s: [P('p_imp_hljdswd_s')] });
  // the normal pair (`attack.0`, files ending in `_n`) belongs to pickUnitSfx, never to a mode
  assert.equal(skillModeLetter(P('p_atk_hljdswd_n')), null);
  assert.equal(skillModeLetter(P('p_imp_hljdswd_n')), null);
});

test('pickModeHits: only ON_ABILITY_HIT banks, and a mode without one keeps the unit\'s normal impact', () => {
  // a START bank alone is a swing, not an impact
  assert.deepEqual(pickModeHits(new Map([['ON_ABILITY_START.attack.4', [P('p_atk_lzxqlkl_h2')]]])), {});
  // 司霆惊蛰: 技能2 swings and lands `_h`, 技能3 has no HIT bank at all (its slash keeps the normal impact)
  const leizi = new Map([
    ['ON_ABILITY_ON.attack.1.2.1', [P('p_atk_lzxqlkl_d1')]],
    ['ON_ABILITY_HIT.attack.4', [P('p_imp_lzxqlkl_h')]],
    ['ON_ABILITY_START.attack.7', [P('p_atk_lzxqlkl_s')]],
  ]);
  assert.deepEqual(pickModeHits(leizi), { h: [P('p_imp_lzxqlkl_h')] });
  assert.deepEqual(pickModeAttacks(leizi), { d: [P('p_atk_lzxqlkl_d1')], s: [P('p_atk_lzxqlkl_s')] });
  assert.deepEqual(pickModeHits(new Map()), {});
  assert.deepEqual(pickModeHits(undefined), {});
});

test('the committed manifest: her S3 swing and impact are the `_s` pair, her normal pair is untouched', () => {
  const u = manifest.audio.sfx.units[CHEN3];
  assert.equal(u.attack, '/assets/audio/sfx/player/p_atk/p_atk_hljdswd_n.mp3', '普通攻击的挥砍');
  assert.equal(u.hit, '/assets/audio/sfx/player/p_imp/p_imp_hljdswd_n.mp3', '普通攻击的命中');
  assert.equal(u.attacks?.['2'], '/assets/audio/sfx/player/p_atk/p_atk_hljdswd_s.mp3', 'S3 的挥砍');
  assert.equal(u.hits?.['2'], '/assets/audio/sfx/player/p_imp/p_imp_hljdswd_s.mp3', 'S3 的斩击（命中）');
  assert.equal(u.attacks?.['0'], '/assets/audio/sfx/player/p_atk/p_atk_hljdfswd_d.mp3', '技能1 的挥砍');
  assert.equal(u.hits?.['0'], '/assets/audio/sfx/player/p_imp/p_imp_hljdrfswd_d.mp3', '技能1 的命中');
});

test('every manifest unit with a hits table agrees with the mode convention (d / h / s = 技能1 / 2 / 3)', () => {
  const units = manifest.audio.sfx.units;
  let n = 0;
  for (const [id, u] of Object.entries(units)) {
    for (const [i, url] of Object.entries(u?.hits || {})) {
      n++;
      const letter = skillModeLetter(url);
      assert.ok(letter, `${id}: hits[${i}] is a skill-mode file (${url})`);
      assert.equal(letter, SLOT_MODE_LETTER[i], `${id}: hits[${i}] is 技能${Number(i) + 1} (the _${letter} mode)`);
    }
  }
  assert.ok(n >= 10, `some operators carry mode impacts (found ${n})`);
});

test('no operator takes a skill-mode file as its normal attack or impact (community report #54 stays fixed)', () => {
  const units = manifest.audio.sfx.units;
  let n = 0;
  for (const [id, u] of Object.entries(units)) {
    if (!id.startsWith('char_')) continue;
    for (const kind of ['attack', 'hit']) {
      const url = u?.[kind];
      if (typeof url !== 'string') continue;
      n++;
      assert.equal(skillModeLetter(url), null, `${id}.${kind} = ${url} is a skill mode's file`);
    }
  }
  assert.ok(n > 300, `${n} normal attack / impact entries checked`);
});
