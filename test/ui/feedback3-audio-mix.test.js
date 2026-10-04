// test/ui/feedback3-audio-mix.test.js — community report #30 (0.1.3): "狗、飞机敌人音效声音过大". The official attack bank of
// 猎狗pro / 深池侦察犬 is 80 % silence (an empty asset weighs 80, e_atk_gopro_* 20), but the asset tool kept only the file
// paths, so the client barked on every attack at a fixed 0.55; 妖怪's attack bank is official at volume 0.7. The bank's
// play chance and volume now travel as sfx.units[id].mix (tools/assets/audio.mjs bankMix → plan.mjs) and audio.js plays a
// unit's own sound with chance `p` at its base gain × min(1, vol) — never louder than before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManager, unitGain, unitSoundPlays } from '../../public/js/audio.js';
import { indexAudio, pickUnitSfx, bankMix } from '../../tools/assets/audio.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const UNITS = manifest.audio.sfx.units;
const OFFICIAL = path.join(ROOT, '.cache', 'gamedata', 'excel', 'audio_data.json');

/** An audio manager with a context, recording what it would play: [{ url, volume, unitKey }]. */
function manager(rolls) {
  const a = new AudioManager({ win: null, getManifest: () => manifest, random: () => rolls.shift() ?? 0 });
  a.ctx = {};
  a.played = [];
  a._play = (url, o) => { a.played.push({ url, volume: o.volume, unitKey: o.unitKey }); };
  return a;
}

test('the bank mix: an empty asset is a chance of silence, the played file\'s volume (bankMix, indexAudio().mixOf)', () => {
  const gopro = [
    { asset: '', weight: 80, minVolume: 1, maxVolume: 1 },
    { asset: 'Audio/Sound_Beta_2/Enemy/e_atk/e_atk_gopro_1', weight: 10, minVolume: 1, maxVolume: 1 },
    { asset: 'Audio/Sound_Beta_2/Enemy/e_atk/e_atk_gopro_2', weight: 10, minVolume: 1, maxVolume: 1 },
  ];
  assert.deepEqual(bankMix(gopro, 'enemy/e_atk/e_atk_gopro_1.mp3'), { p: 0.2 });
  assert.deepEqual(bankMix([{ asset: 'Audio/Sound_Beta_2/Enemy/e_atk/e_atk_vehicle_n', weight: 1, minVolume: 0.7, maxVolume: 0.7 }], 'enemy/e_atk/e_atk_vehicle_n.mp3'), { vol: 0.7 });
  assert.equal(bankMix([{ asset: 'Audio/Sound_Beta_2/P/x', weight: 1, minVolume: 1, maxVolume: 1 }], 'p/x.mp3'), null, 'the default: nothing stored');
  const idx = indexAudio({ soundFXBanks: [
    { name: 'battle.ON_ABILITY_ON.enemy_1000_gopro_2.combat', sounds: gopro },
    { name: 'battle.ON_ABILITY_HIT.enemy_1000_gopro_2.combat', sounds: [{ asset: 'Audio/Sound_Beta_2/Enemy/e_imp/e_imp_general_w', weight: 1, minVolume: 1, maxVolume: 1 }] },
  ] });
  const sfx = pickUnitSfx(idx.unitBanks.get('enemy_1000_gopro_2'));
  assert.deepEqual(sfx.attack, ['enemy/e_atk/e_atk_gopro_1.mp3', 'enemy/e_atk/e_atk_gopro_2.mp3']);
  assert.deepEqual(idx.mixOf(sfx.attack), { p: 0.2 }, 'the picked list carries its bank\'s mix');
  assert.equal(idx.mixOf(sfx.hit), null);
  assert.equal(idx.mixOf(['enemy/e_atk/e_atk_gopro_1.mp3']), null, 'only the bank\'s own list');
});

test('data/assets.json carries the official mix: dogs 20 %, 妖怪 / 威龙 0.7 (and matches audio_data.json when cached)', () => {
  for (const id of ['enemy_1000_gopro_2', 'enemy_1165_duhond', 'enemy_1165_duhond_2']) assert.deepEqual(UNITS[id].mix, { attack: { p: 0.2 } }, id);
  for (const id of ['enemy_1005_yokai_2', 'enemy_1005_yokai_3']) assert.deepEqual(UNITS[id].mix, { attack: { vol: 0.7 } }, id);
  assert.equal(UNITS.char_002_amiya?.mix, undefined, 'default banks store nothing');
  if (!existsSync(OFFICIAL)) return;
  const banks = new Map(JSON.parse(readFileSync(OFFICIAL, 'utf8')).soundFXBanks.map((b) => [b.name, b]));
  const dog = banks.get('battle.ON_ABILITY_ON.enemy_1165_duhond.combat').sounds;
  assert.equal(dog.filter((s) => !s.asset).reduce((n, s) => n + s.weight, 0) / dog.reduce((n, s) => n + s.weight, 0), 0.8, 'official: 80 % silence');
  assert.equal(banks.get('battle.ON_ABILITY_ON.enemy_1005_yokai_2.attack').sounds[0].maxVolume, 0.7);
});

test('a dog barks only on its chance and never falls back to the generic enemy sound; at most the old gain', () => {
  assert.equal(unitSoundPlays({ p: 0.2 }, 0.19), true);
  assert.equal(unitSoundPlays({ p: 0.2 }, 0.2), false);
  assert.equal(unitSoundPlays(null, 0.99), true);
  const a = manager([0.5, 0.9, 0.1, 0.3, 0.05]);
  a.setFieldUnits([{ id: 1, side: 'enemy', kind: 'enemy', spine: 'enemy_1000_gopro_2' }, { id: 2, side: 'ally', kind: 'op', spine: 'char_002_amiya' }]);
  for (let i = 0; i < 5; i++) { a.limiter = new a.limiter.constructor(); a.handleBattleEvents([['atk', 1, 2, 'none']]); }
  const barks = a.played.filter((p) => p.url === UNITS.enemy_1000_gopro_2.attack);
  assert.equal(barks.length, 2, 'rolls 0.1 and 0.05 of 0.5 / 0.9 / 0.1 / 0.3 / 0.05');
  for (const b of barks) assert.equal(b.volume, 0.55, 'official volume 1: the same gain as before');
  assert.equal(a.played.length, 2, 'the silent rolls play nothing — not the generic enemyHit either');
});

test('妖怪 plays at 0.55 × 0.7; a bank louder than 1 stays at the old gain; die / born use the mix too', () => {
  assert.equal(unitGain(0.55, { vol: 0.7 }), 0.55 * 0.7);
  assert.equal(unitGain(0.55, { vol: 2 }), 0.55, 'never louder than before');
  assert.equal(unitGain(0.8, null), 0.8);
  const a = manager([]);
  assert.equal(a.unit('enemy_1005_yokai_2', 'attack', 7), true);
  assert.ok(Math.abs(a.played[0].volume - 0.385) < 1e-9);
  assert.equal(a.unit('char_1028_texas2', 'hit', 8), true);
  assert.equal(a.played[1].volume, 0.55, 'official 2: unchanged');
  a.setFieldUnits([{ id: 3, side: 'ally', kind: 'op', spine: 'char_2026_yu', defId: 'chess_char_x' }]);
  a.handleBattleEvents([['deploy', 3]]);
  const born = a.played.find((p) => p.url === UNITS.char_2026_yu.born);
  assert.ok(born && Math.abs(born.volume - 0.8 * 0.75) < 1e-9, '余 ON_UNIT_BORN at 0.75');
});
