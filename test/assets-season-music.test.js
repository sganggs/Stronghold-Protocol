// Per-season BGM (tools/assets/versions.mjs seasonMusicSpec → plan.mjs audio.seasons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { indexAudio } from '../tools/assets/audio.mjs';
import { buildPlan } from '../tools/assets/plan.mjs';
import { literal, resolveTemplate } from '../tools/assets/manifest.mjs';
import { seasonMusicSpec, seasonMusicFiles, versionAudioData } from '../tools/assets/versions.mjs';
import { DEFAULT_VERSION } from '../shared/versions.js';

const root = path.resolve(import.meta.dirname, '..');
const relOf = (leaf) => leaf?.alts?.[0]?.rel;

test('resolveTemplate keeps literal(null) and drops a plain null', () => {
  const { value } = resolveTemplate(
    { unite: literal(null), gone: null },
    { root: '/tmp/sp-no-assets', spine: new Map(), available: () => false },
  );
  assert.equal(value.unite, null);
  assert.equal(Object.hasOwn(value, 'unite'), true);
  assert.equal(Object.hasOwn(value, 'gone'), false);
});

test('a broken 开战 split is a note; the default season is not planned', () => {
  const spec = seasonMusicSpec(root, { versions: [
    { season: DEFAULT_VERSION, waves: {
      a: { kind: 'normal', bgm: 'one', usedBy: [{ modeId: 'mode_single', round: 1 }] },
      b: { kind: 'normal', bgm: 'two', usedBy: [{ modeId: 'mode_single', round: 2 }] },
    } },
    { season: 'act9fun', waves: {
      a: { kind: 'normal', bgm: 'earlyA', usedBy: [{ modeId: 'mode_single', round: 1 }] },
      b: { kind: 'normal', bgm: 'earlyB', usedBy: [{ modeId: 'mode_single', round: 3 }] },
      c: { kind: 'normal', bgm: 'late', usedBy: [{ modeId: 'mode_single', round: 9 }] },
      train: { kind: 'training', bgm: 'trainBank', usedBy: [{ modeId: 'mode_training', round: 1 }] },
      trainUse: { kind: 'normal', bgm: 'trainOnly', usedBy: [{ modeId: 'mode_training', round: 1 }] },
      outside: { kind: 'normal', bgm: 'wayLate', usedBy: [{ modeId: 'mode_single', round: 14 }] },
      gap: { kind: 'normal', bgm: null, usedBy: [{ modeId: 'mode_single', round: 8 }] },
      e1: { kind: 'escaped', bgm: null, usedBy: [] },
      e2: { kind: 'escaped', bgm: 'corrosion', usedBy: [] },
      boss: { kind: 'boss', bossId: ['boss_1', 'not_a_boss'], bgm: 'bankA' },
      hidden: { kind: 'hidden', bossId: 'boss_1', bgm: 'bankB' },
    } },
  ] });
  assert.equal(spec.seasons[DEFAULT_VERSION], undefined);
  const fun = spec.seasons.act9fun;
  assert.equal(fun.combat, undefined);
  const notes = fun.notes.join('\n');
  assert.match(notes, /开战 BGM split does not hold \(rounds 1–7: earlyA, earlyB; rounds 8–13: late, none\)/);
  assert.match(notes, /联防 BGM does not agree/);
  assert.match(notes, /boss boss_1 BGM does not agree/);
  assert.doesNotMatch(notes, /trainBank|trainOnly|wayLate/);
  assert.equal(fun.unite, undefined);
  assert.equal(fun.bosses.boss_1, undefined);
});

test('unite is null when escaped levels name no music, and training does not break a clean split', () => {
  const spec = seasonMusicSpec('/missing', { versions: [
    { season: 'act1autochess', waves: {
      e: { kind: 'normal', bgm: 'early', usedBy: [{ modeId: 'mode_single', round: 2 }] },
      l: { kind: 'normal', bgm: 'late', usedBy: [{ modeId: 'mode_single', round: 10 }] },
      t: { kind: 'training', bgm: 'other', usedBy: [{ modeId: 'mode_training', round: 1 }] },
      esc: { kind: 'escaped', bgm: null, usedBy: [] },
    } },
    { season: 'act0', waves: {
      e: { kind: 'normal', bgm: 'early', usedBy: [{ modeId: 'mode_single', round: 1 }] },
      l: { kind: 'normal', bgm: 'late', usedBy: [{ modeId: 'mode_single', round: 8 }] },
    } },
  ] });
  assert.deepEqual(spec.seasons.act1autochess.combat, { early: 'early', late: 'late' });
  assert.equal(spec.seasons.act1autochess.unite, null);
  assert.deepEqual(spec.seasons.act1autochess.notes, []);
  assert.equal(Object.hasOwn(spec.seasons.act0, 'unite'), false);
});

test('第一期 and 规程 tables come from the built waves; the default season stays out', () => {
  const spec = seasonMusicSpec(root);
  assert.equal(spec.seasons.act2autochess, undefined);
  assert.deepEqual(Object.keys(spec.seasons), ['act1autochess', 'act3autochess']);
  const act1 = spec.seasons.act1autochess;
  assert.deepEqual(act1.combat, { early: 'bat_act35side_01', late: 'bat_act35side_02' });
  assert.equal(act1.unite, null);
  assert.deepEqual(act1.notes, []);
  assert.equal(act1.bosses.boss_1, 'bat_boss_ancestor');
  assert.equal(act1.bosses.boss_4, 'abyssalhunters');
  assert.equal(act1.bosses.boss_6, 'bat_boss_vtlionk');
  assert.equal(act1.bosses.boss_7, 'rl3boss1');
  assert.equal(act1.bosses.boss_8, 'act2mainss_boss1');
  assert.equal(act1.bosses.boss_5, undefined);
  const act3 = spec.seasons.act3autochess;
  assert.deepEqual(act3.combat, { early: 'chernobog', late: 'act3mainss_bat2' });
  assert.equal(act3.unite, 'corrosion');
  assert.deepEqual(act3.notes, []);
  assert.equal(act3.bosses.boss_1, 'bat_boss_ancestor');
  assert.equal(act3.bosses.boss_4, 'abyssalhunters');
  assert.equal(act3.bosses.boss_6, 'bat_boss_vtlionk');
  assert.equal(act3.bosses.boss_7, 'rl3boss1');
  assert.equal(act3.bosses.boss_10, 'act2mainss_boss1');
  assert.equal(act3.bosses.boss_11, 'act3autochess_boss');
  assert.equal(act3.bosses.boss_17, 'act3autochess_boss');
  assert.equal(act3.bosses.boss_14, 'act3autochess_hideBoss');
  assert.equal(act3.bosses.boss_16, 'act3autochess_hideBoss');
  assert.deepEqual(Object.keys(act3.bosses), [
    'boss_1', 'boss_2', 'boss_3', 'boss_4', 'boss_6', 'boss_7', 'boss_8', 'boss_9', 'boss_10',
    'boss_11', 'boss_12', 'boss_13', 'boss_14', 'boss_15', 'boss_16', 'boss_17',
  ]);
});

test('a missing combat bank omits combatAlts, and the default season is not copied under seasons', () => {
  const audio = indexAudio({ bgmBanks: [
    { name: 'sys.ON_ACTIVITY_LOADED.act9fun', loop: 'music/x/m_sys_loop.mp3', intro: 'music/x/m_sys_intro.mp3' },
    { name: 'battle.ON_GAME_READY.late', loop: 'music/x/m_late_loop.mp3' },
    { name: 'battle.ON_GAME_READY.bossbank', loop: 'music/x/m_boss_loop.mp3' },
  ] });
  const plan = buildPlan({
    assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio, modelsData: {},
    seasonMusic: { seasons: {
      [DEFAULT_VERSION]: {
        combat: { early: 'nope', late: 'nope' }, bosses: { boss_1: 'bossbank' }, unite: null, notes: ['should not appear'],
      },
      act9fun: {
        combat: { early: 'missing-early', late: 'late' },
        bosses: { boss_2: 'bossbank', boss_1: 'missingboss', nope: 'bossbank' },
        unite: null,
        notes: ['season act9fun: noted'],
      },
    } },
  });
  const slot = plan.template.audio.seasons.act9fun;
  assert.equal(plan.template.audio.seasons[DEFAULT_VERSION], undefined);
  assert.equal(slot.bgm.combatAlts, undefined);
  assert.equal(relOf(slot.bgm.lobby.loop), 'audio/bgm/m_sys_loop.mp3');
  assert.equal(relOf(slot.bgm.lobby.intro), 'audio/bgm/m_sys_intro.mp3');
  const syms = Object.getOwnPropertySymbols(slot.bgm.unite);
  assert.equal(syms.length, 1);
  assert.equal(slot.bgm.unite[syms[0]], null);
  assert.deepEqual(Object.keys(slot.bossBgm), ['boss_2']);
  assert.equal(relOf(slot.bossBgm.boss_2.loop), 'audio/bgm/m_boss_loop.mp3');
  assert.ok(plan.notes.includes('season act9fun: noted'));
  assert.equal(plan.notes.includes('should not appear'), false);
  assert.ok(plan.notes.some((n) => n.includes('battle.ON_GAME_READY.missing-early')));
  assert.deepEqual(Object.keys(plan.template.audio).slice(0, 3), ['bgm', 'bossBgm', 'seasons']);
});

// The official audio_data.json is in the local gamedata cache only (CI has none), like audio-pools-data.test.js.
const cachedAudio = path.join(root, '.cache/gamedata/excel/audio_data.json');

test('planned season files, and the default bgm / bossBgm stay byte-identical', { skip: !existsSync(cachedAudio) }, () => {
  const baseAudio = JSON.parse(readFileSync(cachedAudio, 'utf8'));
  const maps05 = JSON.parse(readFileSync(path.join(root, 'docs/research/05-maps.json'), 'utf8'));
  const audio = indexAudio(versionAudioData(root, baseAudio));
  const args = { assets07: {}, ops03: {}, enemies05: {}, maps05, audio, modelsData: {} };
  const plain = buildPlan(args);
  const withSeasons = buildPlan({ ...args, seasonMusic: seasonMusicSpec(root) });
  assert.equal(JSON.stringify(withSeasons.template.audio.bgm), JSON.stringify(plain.template.audio.bgm));
  assert.equal(JSON.stringify(withSeasons.template.audio.bossBgm), JSON.stringify(plain.template.audio.bossBgm));
  assert.equal(plain.template.audio.seasons, undefined);
  assert.equal(withSeasons.template.audio.seasons.act2autochess, undefined);
  assert.deepEqual(withSeasons.notes, plain.notes);
  assert.equal(Object.keys(plain.template.audio).includes('seasons'), false);
  const files = seasonMusicFiles(withSeasons.template.audio.seasons);
  assert.equal(files.act1autochess.bgm.unite, null);
  assert.deepEqual(files.act1autochess.bgm.combatAlts, [
    { loop: 'm_bat2_act35side_loop.mp3' },
    { intro: 'm_bat1_act35side_intro.mp3', loop: 'm_bat1_act35side_loop.mp3' },
  ]);
  assert.deepEqual(files.act1autochess.bgm.lobby, { intro: 'm_sys_act1autochess_intro.mp3', loop: 'm_sys_act1autochess_loop.mp3' });
  assert.equal(relOf(withSeasons.template.audio.bgm.lobby.loop).split('/').pop(), 'm_sys_act1autochess_loop.mp3');
  assert.equal(files.act1autochess.bossBgm.boss_1.loop, 'm_bat_ancestor_loop.mp3');
  assert.equal(files.act1autochess.bossBgm.boss_4.loop, 'm_bat_abyssalhunters_loop.mp3');
  assert.equal(files.act1autochess.bossBgm.boss_7.loop, 'm_bat_rouge3boss1_loop.mp3');
  assert.equal(files.act1autochess.bossBgm.boss_8.loop, 'm_bat_prtsstage1_loop.mp3');
  assert.equal(files.act1autochess.bossBgm.boss_5, undefined);
  assert.deepEqual(files.act3autochess.bgm.combatAlts, [
    { intro: 'm_bat2_act16main_intro.mp3', loop: 'm_bat2_act16main_loop.mp3' },
    { intro: 'm_bat_chernobog_intro.mp3', loop: 'm_bat_chernobog_loop.mp3' },
  ]);
  assert.equal(files.act3autochess.bgm.unite.loop, 'm_bat_corrosion_loop.mp3');
  assert.deepEqual(files.act3autochess.bgm.lobby, { loop: 'm_sys_act3autochess_loop.mp3' });
  assert.equal(files.act3autochess.bossBgm.boss_11.loop, 'm_boss1_act3autochess_loop.mp3');
  assert.equal(files.act3autochess.bossBgm.boss_14.loop, 'm_boss2_act3autochess_loop.mp3');
  assert.equal(files.act3autochess.bossBgm.boss_6.loop, 'm_bat_vtlionk_loop.mp3');
});
