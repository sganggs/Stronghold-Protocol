// Skill attack slots follow the operator's mode list, not the filename letter (#679).
// 玛恩纳's S2 swing is `_d` and his S3 swing is `_h`; mapping the letter onto slot 1/2/3 dropped S3.
// Run: node --test test/skill-mode-map.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignSkillModeSfx, indexAudio, pickModeAttacks, skillModeLetter, SLOT_MODE_LETTER } from '../tools/assets/audio.mjs';
import { buildPlan, charModesFromIndex } from '../tools/assets/plan.mjs';

const P = (f) => `player/${f}.mp3`;
const modes = (...names) => names.map((name) => ({ name }));
const row = (index, mode, skillId = `skchr_x_${index + 1}`, start = null) => ({ index, mode, skillId, start });

test('玛恩纳: S2 is attack.2 `_d`, S3 is attack.3 `_h`, S1 stays quiet, the shared `_n` hit stays off the skill table', () => {
  const banks = new Map([
    ['ON_ABILITY_HIT.attack.1', [P('p_imp_loyalsword_n')]],
    ['ON_ABILITY_START.attack.2', [P('p_imp_loyalsword_d')]],
    ['ON_ABILITY_START.attack.3', [P('p_imp_loyalsword_h')]],
  ]);
  const skills = [row(0, 1), row(1, 2), row(2, 3)];
  const got = assignSkillModeSfx(banks, skills, modes('Default', 'S1', 'S2', 'S3'), new Map(skills.map((s) => [s.skillId, s.mode])));
  assert.deepEqual(got.attacks, { 1: [P('p_imp_loyalsword_d')], 2: [P('p_imp_loyalsword_h')] });
  assert.deepEqual(got.hits, {});
});

test('银灰: attack.2 is the S3 mode, not skill N−1; a `_n` file on that mode is not a skill-table attack', () => {
  const listed = modes('Default', 'S2', 'S3');
  const skills = [row(0, null, 'skchr_sv_1'), row(1, 1, 'skchr_sv_2'), row(2, 2, 'skchr_sv_3')];
  const links = new Map([['skchr_sv_2', 1], ['skchr_sv_3', 2]]);
  const asN = assignSkillModeSfx(new Map([['ON_ABILITY_START.attack.2', [P('p_atk_silver_n')]]]), skills, listed, links);
  assert.deepEqual(asN.attacks, {});
  const asS = assignSkillModeSfx(new Map([['ON_ABILITY_START.attack.2', [P('p_atk_silver_s')]]]), skills, listed, links);
  assert.deepEqual(asS.attacks, { 2: [P('p_atk_silver_s')] });
  assert.equal(asS.attacks['1'], undefined);
});

test('司霆惊蛰: the first number is the mode; the rest of a dotted key stays on it; an unlinked S1 name fills skill 1', () => {
  const banks = new Map([
    ['ON_ABILITY_ON.attack.1.2.1', [P('p_atk_lzxqlkl_d1')]],
    ['ON_ABILITY_START.attack.4', [P('p_atk_lzxqlkl_h2')]],
    ['ON_ABILITY_ON.attack.4', [P('p_atk_lzxqlkl_h')]],
    ['ON_ABILITY_START.attack.7', [P('p_atk_lzxqlkl_s')]],
  ]);
  const listed = modes('Default', 'S1_Landing', 'S1_TakeOff', 'S2_Landing', 'S2', 'S2_TakeOff', 'S3_Landing', 'S3', 'S3_TakeOff');
  const skills = [row(0, null), row(1, 4), row(2, 7)];
  const got = assignSkillModeSfx(banks, skills, listed, new Map([['skchr_x_2', 4], ['skchr_x_3', 7]]));
  assert.deepEqual(got.attacks, {
    0: [P('p_atk_lzxqlkl_d1')],
    1: [P('p_atk_lzxqlkl_h2')],
    2: [P('p_atk_lzxqlkl_s')],
  });
});

test('no mode list: the letter fallback is unchanged, including a slot whose letter comes from the slot table', () => {
  const banks = new Map([
    ['ON_ABILITY_START.attack.2', [P('p_imp_loyalsword_d')]],
    ['ON_ABILITY_START.attack.3', [P('p_imp_loyalsword_h')]],
    ['ON_ABILITY_START.attack.7', [P('test_s')]],
  ]);
  const skills = [0, 1, 2].map((i) => row(i, null, `sk_${i + 1}`, null));
  const got = assignSkillModeSfx(banks, skills, null, null);
  const letters = pickModeAttacks(banks);
  const expect = {};
  for (const s of skills) {
    const letter = skillModeLetter(s.start) ?? SLOT_MODE_LETTER[s.index];
    if (letter && letters[letter]) expect[String(s.index)] = letters[letter];
  }
  assert.deepEqual(got.attacks, expect);
  assert.deepEqual(got.attacks['2'], [P('test_s')]);
  assert.deepEqual(got.hits, {});
});

test('an orphan `_d` with only a Default mode stays on slot 1 by the letter fallback (玛利斯 style)', () => {
  const banks = new Map([
    ['ON_ABILITY_START.attack.1', [P('p_atk_staffcannon_d')]],
    ['ON_ABILITY_HIT.attack.1', [P('p_imp_staffcannon_d')]],
  ]);
  const skills = [row(0, null)];
  const got = assignSkillModeSfx(banks, skills, modes('Default'), new Map([['skchr_x_1', null]]));
  assert.deepEqual(got.attacks, { 0: [P('p_atk_staffcannon_d')] });
  assert.deepEqual(got.hits, { 0: [P('p_imp_staffcannon_d')] });
});

test('a skill that switches to an empty mode does not borrow another mode\'s letter', () => {
  const banks = new Map([
    ['ON_ABILITY_START.attack.2', [P('p_imp_loyalsword_d')]],
    ['ON_ABILITY_START.attack.3', [P('p_imp_loyalsword_h')]],
  ]);
  const skills = [row(0, 1), row(1, 2), row(2, 3)];
  const got = assignSkillModeSfx(banks, skills, modes('Default', 'S1', 'S2', 'S3'), new Map(skills.map((s) => [s.skillId, s.mode])));
  assert.equal(got.attacks['0'], undefined);
});

test('a mode named S2 that skill 3 switches to stays on skill 3 (莫斯提马 style)', () => {
  const banks = new Map([['ON_ABILITY_ON.attack.1', [P('p_atk_whitetimewand_s')]]]);
  const skills = [row(1, 1, 'skchr_x_2'), row(2, 1, 'skchr_x_3')];
  const got = assignSkillModeSfx(banks, skills, modes('Default', 'S2'), new Map(skills.map((s) => [s.skillId, s.mode])));
  assert.deepEqual(got.attacks, { 1: [P('p_atk_whitetimewand_s')], 2: [P('p_atk_whitetimewand_s')] });
});

test('an unclaimed mode named S1 replaces the shared differently named link on skill 1 only', () => {
  const banks = new Map([
    ['ON_ABILITY_ON.attack.1', [P('p_atk_ice_d')]],
    ['ON_ABILITY_ON.attack.2', [P('p_atk_ice_h')]],
  ]);
  const skills = [row(0, 1), row(1, 1), row(2, 1)];
  const got = assignSkillModeSfx(banks, skills, modes('Default', 'S1_Default', 'S1', 'S2', 'S3'), new Map(skills.map((s) => [s.skillId, 1])));
  // Mode index 2 is named S1 and nobody links it, so skill 1 takes it. S2/S3 have no bank, so skills 2 and 3 keep the link.
  assert.deepEqual(got.attacks, { 0: [P('p_atk_ice_h')], 1: [P('p_atk_ice_d')], 2: [P('p_atk_ice_d')] });
});

test('unclaimed S<n> fills that skill; a mode another skill links is not stolen', () => {
  // 麦哲伦: every skill links to S1_Default (no bank). Unclaimed S1/S2/S3 each carry the same _h swing and hit.
  const mag = assignSkillModeSfx(new Map([
    ['ON_ABILITY_ON.attack.2', [P('p_atk_icecamera_h')]],
    ['ON_ABILITY_HIT.attack.2', [P('p_imp_icecamera_h')]],
    ['ON_ABILITY_ON.attack.3', [P('p_atk_icecamera_h')]],
    ['ON_ABILITY_HIT.attack.3', [P('p_imp_icecamera_h')]],
    ['ON_ABILITY_ON.attack.4', [P('p_atk_icecamera_h')]],
    ['ON_ABILITY_HIT.attack.4', [P('p_imp_icecamera_h')]],
  ]), [row(0, 1, 'skchr_mgllan_1'), row(1, 1, 'skchr_mgllan_2'), row(2, 1, 'skchr_mgllan_3')],
  modes('Default', 'S1_Default', 'S1', 'S2', 'S3'),
  new Map([['skchr_mgllan_1', 1], ['skchr_mgllan_2', 1], ['skchr_mgllan_3', 1]]));
  assert.deepEqual(mag.attacks, { 0: [P('p_atk_icecamera_h')], 1: [P('p_atk_icecamera_h')], 2: [P('p_atk_icecamera_h')] });
  assert.deepEqual(mag.hits, { 0: [P('p_imp_icecamera_h')], 1: [P('p_imp_icecamera_h')], 2: [P('p_imp_icecamera_h')] });

  // 白铁: S2 links to mode S1. Unclaimed S2 replaces that swing. S1 and S3 keep the modes they link.
  const iron = assignSkillModeSfx(new Map([
    ['ON_ABILITY_START.attack.1', [P('p_imp_elecdrill_d')]],
    ['ON_ABILITY_START.attack.2', [P('p_atk_elecdrill_h')]],
    ['ON_ABILITY_START.attack.3', [P('p_atk_elecdrill_s')]],
    ['ON_ABILITY_HIT.attack.3', [P('p_imp_elecdrill_s')]],
  ]), [row(0, 1, 'skchr_ironmn_1'), row(1, 1, 'skchr_ironmn_2'), row(2, 3, 'skchr_ironmn_3')],
  modes('Default', 'S1', 'S2', 'S3'),
  new Map([['skchr_ironmn_1', 1], ['skchr_ironmn_2', 1], ['skchr_ironmn_3', 3]]));
  assert.deepEqual(iron.attacks, {
    0: [P('p_imp_elecdrill_d')],
    1: [P('p_atk_elecdrill_h')],
    2: [P('p_atk_elecdrill_s')],
  });
  assert.deepEqual(iron.hits, { 2: [P('p_imp_elecdrill_s')] });

  // 归溟幽灵鲨: S1 links to Empty. Unclaimed S1 restores the sharpsaw _d swing and hit.
  const ghost = assignSkillModeSfx(new Map([
    ['ON_ABILITY_START.attack.3', [P('p_atk_sharpsaw_d')]],
    ['ON_ABILITY_HIT.attack.3', [P('p_imp_sharpsaw_d')]],
    ['ON_ABILITY_ON.attack.4', [P('p_imp_sharpsaw_h')]],
    ['ON_ABILITY_START.attack.5', [P('p_atk_sharpsaw_s')]],
  ]), [row(0, 2, 'skchr_ghost2_1'), row(1, 4, 'skchr_ghost2_2'), row(2, 5, 'skchr_ghost2_3')],
  modes('Default', 'Stand', 'Empty', 'S1', 'S2', 'S3'),
  new Map([['skchr_ghost2_1', 2], ['skchr_ghost2_2', 4], ['skchr_ghost2_3', 5]]));
  assert.deepEqual(ghost.attacks, {
    0: [P('p_atk_sharpsaw_d')],
    1: [P('p_imp_sharpsaw_h')],
    2: [P('p_atk_sharpsaw_s')],
  });
  assert.deepEqual(ghost.hits, { 0: [P('p_imp_sharpsaw_d')] });

  // 水月: S3 owns the mode named S2, so skill 2 keeps the S1 bank.
  const mizuki = assignSkillModeSfx(new Map([
    ['ON_ABILITY_ON.attack.2', [P('p_imp_tentacle_h')]],
    ['ON_ABILITY_ON.attack.3', [P('p_imp_tentacle_s')]],
  ]), [row(0, 2, 'skchr_mizuki_1'), row(1, 2, 'skchr_mizuki_2'), row(2, 3, 'skchr_mizuki_3')],
  modes('Default', 'T1', 'S1', 'S2'),
  new Map([['skchr_mizuki_1', 2], ['skchr_mizuki_2', 2], ['skchr_mizuki_3', 3]]));
  assert.deepEqual(mizuki.attacks, {
    0: [P('p_imp_tentacle_h')],
    1: [P('p_imp_tentacle_h')],
    2: [P('p_imp_tentacle_s')],
  });
});

test('a phase mode fills a skill whose own mode has no skill-mode bank; an End clip does not', () => {
  const banks = new Map([
    ['ON_ABILITY_START.attack.2.1', [P('p_atk_loop_n')]],
    ['ON_ABILITY_START.attack.3.1', [P('p_atk_loop_s')]],
    ['ON_ABILITY_START.attack.4', [P('p_atk_end_s')]],
  ]);
  const skills = [row(2, 2, 'skchr_x_3')];
  const respawn = assignSkillModeSfx(banks, skills, modes('Default', 'S2', 'S3', 'S3_Resapwn'), new Map([['skchr_x_3', 2]]));
  assert.deepEqual(respawn.attacks, { 2: [P('p_atk_loop_s')] });
  const end = assignSkillModeSfx(
    new Map([['ON_ABILITY_START.attack.4', [P('p_atk_end_s')]]]),
    skills, modes('Default', 'S1', 'S2', 'S3', 'S3_End'), new Map([['skchr_x_3', 3]]),
  );
  assert.deepEqual(end.attacks, {});
});

test('a mode claimed by a skill the plan does not ship is not given to the substitute in that slot', () => {
  const banks = new Map([
    ['ON_ABILITY_ON.attack.1', [P('p_atk_bird_h')]],
    ['ON_ABILITY_ON.attack.2', [P('p_atk_bird_d')]],
  ]);
  const skills = [row(0, null, 'skcom_quickattack'), row(1, 2, 'skchr_x_2')];
  const links = new Map([['skchr_x_1', 1], ['skchr_x_2', 2], ['skcom_quickattack', null]]);
  const got = assignSkillModeSfx(banks, skills, modes('Default', 'S1', 'S2', 'S3'), links);
  assert.equal(got.attacks['0'], undefined);
  assert.deepEqual(got.attacks['1'], [P('p_atk_bird_d')]);
});

test('charModesFromIndex reads mode names and skill links, and follows aliasOf', () => {
  const index = {
    units: {
      char_a: { aliasOf: 'char_b' },
      char_b: {
        modes: [{ name: 'Default' }, { name: 'S3' }],
        skills: { skchr_b_3: { mode: 1 }, skchr_b_1: { mode: null } },
      },
      enemy_1: { modes: [{ name: 'Default' }] },
    },
  };
  const map = charModesFromIndex(index);
  assert.equal(map.has('enemy_1'), false);
  assert.deepEqual(map.get('char_a').modes, [{ name: 'Default' }, { name: 'S3' }]);
  assert.equal(map.get('char_b').skillMode.get('skchr_b_3'), 1);
  assert.equal(map.get('char_b').skillMode.get('skchr_b_1'), null);
});

test('buildPlan without charModes still puts the `_s` bank of attack.7 on skill index 2', () => {
  const id = 'char_9_mode';
  const audio = indexAudio({ soundFXBanks: [{ name: `battle.ON_ABILITY_START.${id}.attack.7`, sounds: [
    { asset: 'Audio/Sound_Beta_2/Player/p_atk/test_s', weight: 1, minVolume: 0.6, maxVolume: 0.6 },
  ] }] });
  const { template } = buildPlan({
    assets07: {}, ops03: {}, extraOperators: { [id]: { skills: [{ index: 2, skillId: 'skchr_mode_3' }] } },
    enemies05: {}, maps05: {}, audio, modelsData: {},
  });
  const u = template.audio.sfx.units[id];
  assert.ok(u.attacks['2']);
  assert.equal(u.attacks['0'], undefined);
  assert.equal(u.attacks['1'], undefined);
});
