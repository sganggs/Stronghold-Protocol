// Summon outfits (#876) under the operators' 显示其他玩家的皮肤 gate — round-54 audit: the detail head / thumbnails showed the
// default avatar, and the DOM fallback combat kept the spawn-time skin after the owner changed outfits mid-battle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenSkinShown } from '../../public/js/ui/skins.js';
import { unitArt } from '../../public/js/ui/fallbackField.js';

const manifest = { tokens: { token_a: { avatar: '/tok.png', skins: { s1: { avatar: '/tok-s1.png' }, s2: { avatar: '/tok-s2.png' } } } } };

test('tokenSkinShown: own summons always, another seat\'s only with the switch on, nothing without a skin', () => {
  assert.equal(tokenSkinShown('s1', { ownerId: 'p1', myId: 'p1', otherSkins: false }), 's1');
  assert.equal(tokenSkinShown('s1', { ownerId: 'p2', myId: 'p1', otherSkins: true }), 's1');
  assert.equal(tokenSkinShown('s1', { ownerId: 'p2', myId: 'p1', otherSkins: false }), null);
  assert.equal(tokenSkinShown('s1', { ownerId: null, myId: 'p1', otherSkins: false }), 's1', 'no owner: no seat to hide');
  assert.equal(tokenSkinShown('', { ownerId: 'p1', myId: 'p1' }), null);
  assert.equal(tokenSkinShown(null), null);
});

test('fallback combat: a summon follows its owner operator\'s current outfit, gated like an operator', () => {
  const appearance = (otherSkins, skins = { char_owner: 's2' }) => ({ myId: 'p1', otherSkins, localSkins: {},
    players: [{ playerId: 'p2', skins }, { playerId: 'p1', skins: { char_owner: 's1' } }] });
  const foreign = { defId: 'token_a', ownerId: 'p2', ownerCharId: 'char_owner', skin: 's1' }; // spawned in s1, owner now s2
  assert.equal(unitArt(manifest, foreign, appearance(true)), '/tok-s2.png', 'the current outfit, not the spawn-time one');
  assert.equal(unitArt(manifest, foreign, appearance(false)), '/tok.png', 'another seat hidden with the switch off');
  assert.equal(unitArt(manifest, foreign, appearance(true, {})), '/tok.png', 'the owner went back to the default outfit');
  const own = { defId: 'token_a', ownerId: 'p1', ownerCharId: 'char_owner', skin: 's2' };
  assert.equal(unitArt(manifest, own, appearance(false)), '/tok-s1.png', 'one\'s own summon follows one\'s own choice');
  const noChar = { defId: 'token_a', ownerId: 'p2', skin: 's1' };
  assert.equal(unitArt(manifest, noChar, appearance(true)), '/tok-s1.png', 'without ownerCharId the spawn skin stays');
  assert.equal(unitArt(manifest, noChar, appearance(false)), '/tok.png');
});
