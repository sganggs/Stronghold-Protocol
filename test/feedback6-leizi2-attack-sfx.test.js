// test/feedback6-leizi2-attack-sfx.test.js — user report 「司霆惊蛰三技能攻击没有音效」 (2026-10-08).
//
// 司霆惊蛰 (char_1043_leizi2, 自选 6★ 解放者) attacks only while a skill runs (the trait: 通常不攻击), and the official
// client has no normal-mode bank for her at all: every bank of hers is a numbered ABILITY variant whose file names the
// skill mode — excel/audio_data.json:
//
//   battle.ON_ABILITY_ON.char_1043_leizi2.attack.1.2.1   → p_atk_lzxqlkl_d1   技能1
//   battle.ON_ABILITY_START.char_1043_leizi2.attack.4    → p_atk_lzxqlkl_h2   技能2 (ON also carries _h)
//   battle.ON_ABILITY_START.char_1043_leizi2.attack.7    → p_atk_lzxqlkl_s    技能3
//
// `pickUnitSfx` refuses skill-mode files for an operator's NORMAL attack (community report #54, 银灰 — the file of a
// skill mode must not ring on every normal attack), so she had no `attack` sound at all and her attacks were silent.
// The fix keeps that rule and adds the mode's own file per skill index: tools/assets/audio.mjs pickModeAttacks() reads
// the mode letter of each bank's file (_d / _h / _s = 技能1 / 2 / 3, the same letter an operator's activation sounds
// use), plan.mjs writes it as sfx.units[id].attacks = { '<skillIndex>': url }, and public/js/audio.js plays it while
// that skill is active (the ['skill', id, 1] / 0 events) — never outside it.
//
// Run: node --test test/feedback6-leizi2-attack-sfx.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickModeAttacks, skillModeLetter, SLOT_MODE_LETTER } from '../tools/assets/audio.mjs';

const P = (f) => `player/${f.startsWith('p_imp') ? 'p_imp' : 'p_atk'}/${f}.mp3`;
const LEIZI2 = 'char_1043_leizi2';
const manifest = JSON.parse(readFileSync(new URL('../data/assets.json', import.meta.url), 'utf8'));

/** 司霆惊蛰's own banks, exactly as excel/audio_data.json lists them. */
const LEIZI2_BANKS = new Map([
  ['ON_UNIT_BORN', [P('b_char_lzxqlkl')]],
  ['ON_ABILITY_ON.attack.1.2.1', [P('p_atk_lzxqlkl_d1')]],
  ['ON_ABILITY_HIT.attack.1.2.1', [P('p_imp_lzxqlkl_n')]],
  ['ON_ABILITY_HIT.attack.1.2.2', [P('p_imp_lzxqlkl_n')]],
  ['ON_ABILITY_HIT.attack.1.2.3', [P('p_imp_lzxqlkl_n')]],
  ['ON_ABILITY_START.attack.4', [P('p_atk_lzxqlkl_h2')]],
  ['ON_ABILITY_ON.attack.4', [P('p_atk_lzxqlkl_h')]],
  ['ON_ABILITY_HIT.attack.4', [P('p_imp_lzxqlkl_h')]],
  ['ON_ABILITY_START.attack.7', [P('p_atk_lzxqlkl_s')]],
  ['ON_UNIT_DEAD', [P('b_char_dead')]],
]);

test('pickModeAttacks: 司霆惊蛰 gets one attack sound per skill mode (d / h / s), the START bank first', () => {
  assert.deepEqual(pickModeAttacks(LEIZI2_BANKS), {
    d: [P('p_atk_lzxqlkl_d1')],
    h: [P('p_atk_lzxqlkl_h2')],   // ON_ABILITY_START.attack.4, not the ON_ABILITY_ON.attack.4 (_h) variant
    s: [P('p_atk_lzxqlkl_s')],
  });
  // nothing else is taken from her banks: the _n impacts and the born / dead sounds are pickUnitSfx's business
  assert.deepEqual(Object.keys(pickModeAttacks(LEIZI2_BANKS)).sort(), ['d', 'h', 's']);
});

test('pickModeAttacks: only ability banks, only skill-mode files, nothing for a normal-mode unit', () => {
  // a normal attack bank (_n) is never a mode: it stays the operator's normal attack (pickUnitSfx)
  assert.deepEqual(pickModeAttacks(new Map([['ON_ABILITY_START.attack', [P('p_atk_sword_n')]]])), {});
  // the unsuffixed default mode of an operator whose library is normal-mode only
  assert.deepEqual(pickModeAttacks(new Map([['ON_ABILITY_HIT.combat', [P('p_imp_spear_n')]]])), {});
  // a mode file under a non-attack ability (a talent, a mode switch) is not an attack sound
  assert.deepEqual(pickModeAttacks(new Map([['ON_ABILITY_START.T.1', [P('p_atk_x_s')]]])), {});
  // empty / absent banks
  assert.deepEqual(pickModeAttacks(new Map()), {});
  assert.deepEqual(pickModeAttacks(undefined), {});
  // ON_ABILITY_ON only (no START bank): still read
  assert.deepEqual(pickModeAttacks(new Map([['ON_ABILITY_ON.attack.2', [P('p_atk_firesword_h')]]])), { h: [P('p_atk_firesword_h')] });
});

test('skillModeLetter / SLOT_MODE_LETTER: 技能1 / 2 / 3 = _d / _h / _s (+ digits), _n is the normal mode', () => {
  assert.equal(skillModeLetter(P('p_atk_lzxqlkl_s')), 's');
  assert.equal(skillModeLetter(P('p_atk_lzxqlkl_d1')), 'd');
  assert.equal(skillModeLetter('/assets/audio/sfx/player/p_skill/p_skill_khlrftcrdfr_h.mp3'), 'h');
  assert.equal(skillModeLetter(P('p_atk_sword_n')), null);
  assert.equal(skillModeLetter(P('p_atk_snwlprdg_n1')), null);
  assert.equal(skillModeLetter(null), null);
  assert.deepEqual(SLOT_MODE_LETTER, { 0: 'd', 1: 'h', 2: 's' });
});

test('the committed manifest carries her three mode attacks under the skill indexes', () => {
  const u = manifest.audio.sfx.units[LEIZI2];
  assert.equal(u.attack, undefined, 'she has no normal-mode attack bank — that was the silent attack');
  assert.deepEqual(u.attacks, {
    0: '/assets/audio/sfx/player/p_atk/p_atk_lzxqlkl_d1.mp3',
    1: '/assets/audio/sfx/player/p_atk/p_atk_lzxqlkl_h2.mp3',
    2: '/assets/audio/sfx/player/p_atk/p_atk_lzxqlkl_s.mp3',
  });
  // her activation sounds (the other half of the chain) name the same modes: _d / _h / _s for 技能1 / 2 / 3
  assert.deepEqual(u.skills, {
    0: '/assets/audio/sfx/player/p_skill/p_skill_lzxqlkl_d.mp3',
    1: '/assets/audio/sfx/player/p_skill/p_skill_lzxqlkl_h.mp3',
    2: '/assets/audio/sfx/player/p_skill/p_skill_lzxqlkl_s.mp3',
  });
  assert.equal(u.hit, '/assets/audio/sfx/player/p_imp/p_imp_lzxqlkl_n.mp3', 'her normal impact is untouched');
});

test('every manifest unit with both tables agrees with the mode convention (d / h / s = 技能1 / 2 / 3)', () => {
  const units = manifest.audio.sfx.units;
  let both = 0;
  for (const [id, u] of Object.entries(units)) {
    if (!u?.attacks || !u?.skills) continue;
    both++;
    for (const [i, url] of Object.entries(u.attacks)) {
      const a = skillModeLetter(url);
      assert.ok(a, `${id}: attacks[${i}] is a skill-mode file (${url})`);
      assert.equal(a, SLOT_MODE_LETTER[i], `${id}: attacks[${i}] is 技能${Number(i) + 1} (the _${a} mode)`);
    }
  }
  assert.ok(both >= 5, `some operators carry both tables (found ${both})`);
});

test('no operator takes a skill-mode file as its normal attack or impact (community report #54 stays fixed)', () => {
  const units = manifest.audio.sfx.units;
  for (const [id, u] of Object.entries(units)) {
    if (!id.startsWith('char_')) continue;
    for (const kind of ['attack', 'hit']) {
      const url = u?.[kind];
      if (typeof url !== 'string') continue;
      assert.equal(skillModeLetter(url), null, `${id}.${kind} = ${url} is a skill mode's file`);
    }
  }
});
